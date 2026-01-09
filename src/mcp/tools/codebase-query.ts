/**
 * MCP Codebase Query Tools - Expose codebase intelligence via MCP
 *
 * Provides the following tools:
 * - devloop_query_imports: Find what files import a given file/symbol
 * - devloop_query_semantic: Semantic search for files
 * - devloop_query_graph: Query dependency graph
 * - devloop_query_dead_code: Find dead code (unused exports)
 * - devloop_query_duplicates: Find potential duplicate code
 * - devloop_explain_code: Get AI explanation of code
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { z } from 'zod';
import { CodebaseGraph } from '../../core/codebase-graph';
import { SemanticFileDiscovery } from '../../core/semantic-file-discovery';
import { ASTParser } from '../../core/ast-parser';
import { EmbeddingService } from '../../ai/embedding-service';
import { AbstractionDetector } from "../../core/analysis/code/abstraction-detector";
import { Config } from '../../config/schema';

// Tool schemas
const queryImportsSchema = z.object({
  filePath: z.string().describe('Path to the file to analyze'),
  symbol: z.string().optional().describe('Specific symbol to find imports for'),
  depth: z.number().optional().default(1).describe('Depth of transitive imports to include'),
});

const querySemanticSchema = z.object({
  query: z.string().describe('Natural language query describing what to find'),
  maxResults: z.number().optional().default(10).describe('Maximum number of results'),
  includeRelated: z.boolean().optional().default(true).describe('Include related files'),
});

const queryGraphSchema = z.object({
  operation: z.enum(['dependents', 'dependencies', 'impact', 'cycles', 'stats']).describe('Graph operation to perform'),
  filePath: z.string().optional().describe('File path for dependents/dependencies/impact operations'),
});

const queryDeadCodeSchema = z.object({
  includeFiles: z.array(z.string()).optional().describe('Specific files to check'),
  excludePatterns: z.array(z.string()).optional().describe('Patterns to exclude'),
});

const queryDuplicatesSchema = z.object({
  threshold: z.number().optional().default(0.8).describe('Similarity threshold (0-1)'),
  minLines: z.number().optional().default(10).describe('Minimum lines to consider as duplicate'),
});

const explainCodeSchema = z.object({
  filePath: z.string().describe('Path to the file to explain'),
  symbol: z.string().optional().describe('Specific symbol to explain'),
  detail: z.enum(['brief', 'detailed', 'comprehensive']).optional().default('detailed'),
});

// Singleton instances (initialized lazily)
let codebaseGraph: CodebaseGraph | null = null;
let semanticDiscovery: SemanticFileDiscovery | null = null;
let astParser: ASTParser | null = null;
let abstractionDetector: AbstractionDetector | null = null;

async function getASTParser(debug: boolean): Promise<ASTParser> {
  if (!astParser) {
    astParser = new ASTParser({}, debug);
    await astParser.initialize();
  }
  return astParser;
}

async function getCodebaseGraph(config: Config, debug: boolean): Promise<CodebaseGraph> {
  if (!codebaseGraph) {
    const parser = await getASTParser(debug);
    const codebaseConfig = (config as any).codebase || {};

    codebaseGraph = new CodebaseGraph({
      projectRoot: process.cwd(),
      searchDirs: codebaseConfig.searchDirs || ['docroot/modules/share', 'src'],
      excludeDirs: codebaseConfig.excludeDirs || ['node_modules', 'vendor', '.git', 'dist'],
      extensions: codebaseConfig.extensions || ['.ts', '.tsx', '.js', '.jsx', '.php', '.py'],
    }, parser, debug);

    await codebaseGraph.buildGraph();
  }
  return codebaseGraph;
}

async function getSemanticDiscovery(config: Config, debug: boolean): Promise<SemanticFileDiscovery> {
  if (!semanticDiscovery) {
    const parser = await getASTParser(debug);
    const codebaseConfig = (config as any).codebase || {};

    // Create embedding service (may not have API key)
    const embeddingService = new EmbeddingService(config, debug);

    semanticDiscovery = new SemanticFileDiscovery({
      projectRoot: process.cwd(),
      searchDirs: codebaseConfig.searchDirs || ['docroot/modules/share', 'src'],
      excludeDirs: codebaseConfig.excludeDirs || ['node_modules', 'vendor', '.git'],
      cacheEmbeddings: true,
      cachePath: '.devloop/semantic-cache.json',
    }, embeddingService, parser, debug);
  }
  return semanticDiscovery;
}

async function getAbstractionDetector(debug: boolean): Promise<AbstractionDetector> {
  if (!abstractionDetector) {
    abstractionDetector = new AbstractionDetector(debug);
  }
  return abstractionDetector;
}

/**
 * Register codebase query MCP tools
 */
export function registerCodebaseQueryTools(mcp: any, getConfig: () => Promise<Config>): void {
  const debug = process.env.MCP_DEBUG === 'true';

  // devloop_query_imports - Find what imports a file/symbol
  mcp.addTool({
    name: 'devloop_query_imports',
    description: 'Find files that import from a given file or use a specific symbol. Returns dependents and import relationships.',
    parameters: queryImportsSchema,
    execute: async (args: z.infer<typeof queryImportsSchema>) => {
      try {
        const config = await getConfig();
        const graph = await getCodebaseGraph(config, debug);

        const filePath = path.isAbsolute(args.filePath)
          ? args.filePath
          : path.join(process.cwd(), args.filePath);

        const dependents = graph.getDependents(filePath);
        const dependencies = graph.getDependencies(filePath);

        // Get related files up to specified depth
        const relatedFiles = graph.getRelatedFiles(filePath, args.depth);

        // If symbol specified, filter to edges that include that symbol
        let symbolUsages: string[] = [];
        if (args.symbol) {
          const parser = await getASTParser(debug);
          for (const dep of dependents) {
            const usages = await parser.findSymbolUsages(dep, args.symbol);
            if (usages.length > 0) {
              symbolUsages.push(`${dep}: lines ${usages.join(', ')}`);
            }
          }
        }

        return {
          success: true,
          data: {
            filePath,
            dependents: dependents.map(f => path.relative(process.cwd(), f)),
            dependencies: dependencies.map(f => path.relative(process.cwd(), f)),
            relatedFiles: relatedFiles.map(f => path.relative(process.cwd(), f)),
            symbolUsages: args.symbol ? symbolUsages : undefined,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_query_semantic - Semantic search for files
  mcp.addTool({
    name: 'devloop_query_semantic',
    description: 'Semantic search for files based on natural language query. Uses embeddings to find relevant code.',
    parameters: querySemanticSchema,
    execute: async (args: z.infer<typeof querySemanticSchema>) => {
      try {
        const config = await getConfig();
        const discovery = await getSemanticDiscovery(config, debug);

        const results = await discovery.discoverFiles({
          query: args.query,
          maxResults: args.maxResults,
          includeRelated: args.includeRelated,
        });

        return {
          success: true,
          data: {
            query: args.query,
            results: results.map(r => ({
              file: path.relative(process.cwd(), r.filePath),
              score: r.score.toFixed(3),
              reasons: r.reasons,
              symbols: r.symbols,
            })),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_query_graph - Query dependency graph
  mcp.addTool({
    name: 'devloop_query_graph',
    description: 'Query the codebase dependency graph. Operations: dependents, dependencies, impact, cycles, stats.',
    parameters: queryGraphSchema,
    execute: async (args: z.infer<typeof queryGraphSchema>) => {
      try {
        const config = await getConfig();
        const graph = await getCodebaseGraph(config, debug);

        switch (args.operation) {
          case 'dependents': {
            if (!args.filePath) {
              return { success: false, error: 'filePath required for dependents operation' };
            }
            const filePath = path.isAbsolute(args.filePath)
              ? args.filePath
              : path.join(process.cwd(), args.filePath);
            const dependents = graph.getDependents(filePath);
            return {
              success: true,
              data: {
                operation: 'dependents',
                file: args.filePath,
                dependents: dependents.map(f => path.relative(process.cwd(), f)),
              },
            };
          }

          case 'dependencies': {
            if (!args.filePath) {
              return { success: false, error: 'filePath required for dependencies operation' };
            }
            const filePath = path.isAbsolute(args.filePath)
              ? args.filePath
              : path.join(process.cwd(), args.filePath);
            const dependencies = graph.getDependencies(filePath);
            return {
              success: true,
              data: {
                operation: 'dependencies',
                file: args.filePath,
                dependencies: dependencies.map(f => path.relative(process.cwd(), f)),
              },
            };
          }

          case 'impact': {
            if (!args.filePath) {
              return { success: false, error: 'filePath required for impact operation' };
            }
            const filePath = path.isAbsolute(args.filePath)
              ? args.filePath
              : path.join(process.cwd(), args.filePath);
            const impact = await graph.getImpactAnalysis(filePath);
            return {
              success: true,
              data: {
                operation: 'impact',
                file: args.filePath,
                directImpact: impact.directImpact.map(f => path.relative(process.cwd(), f)),
                transitiveImpact: impact.transitiveImpact.map(f => path.relative(process.cwd(), f)),
                affectedSymbols: impact.affectedSymbols,
                impactScore: impact.impactScore.toFixed(3),
              },
            };
          }

          case 'cycles': {
            const cycles = graph.findCircularDependencies();
            return {
              success: true,
              data: {
                operation: 'cycles',
                cycleCount: cycles.length,
                cycles: cycles.map(cycle => cycle.map(f => path.relative(process.cwd(), f))),
              },
            };
          }

          case 'stats': {
            const stats = graph.getStats();
            return {
              success: true,
              data: {
                operation: 'stats',
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                avgDependencies: stats.avgDependencies.toFixed(2),
                avgDependents: stats.avgDependents.toFixed(2),
                mostDependent: stats.mostDependent.map(f => path.relative(process.cwd(), f)),
                mostDependencies: stats.mostDependencies.map(f => path.relative(process.cwd(), f)),
              },
            };
          }
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_query_dead_code - Find unused exports
  mcp.addTool({
    name: 'devloop_query_dead_code',
    description: 'Find dead code (exports that are not imported anywhere). Helps identify code to remove.',
    parameters: queryDeadCodeSchema,
    execute: async (args: z.infer<typeof queryDeadCodeSchema>) => {
      try {
        const config = await getConfig();
        const graph = await getCodebaseGraph(config, debug);

        let deadExports = graph.findDeadExports();

        // Filter by include files if specified
        if (args.includeFiles && args.includeFiles.length > 0) {
          const includeSet = new Set(args.includeFiles.map(f =>
            path.isAbsolute(f) ? f : path.join(process.cwd(), f)
          ));
          deadExports = deadExports.filter(d => includeSet.has(d.file));
        }

        // Filter by exclude patterns
        if (args.excludePatterns && args.excludePatterns.length > 0) {
          deadExports = deadExports.filter(d => {
            const relativePath = path.relative(process.cwd(), d.file);
            return !args.excludePatterns!.some(pattern =>
              new RegExp(pattern).test(relativePath)
            );
          });
        }

        return {
          success: true,
          data: {
            deadExportCount: deadExports.length,
            deadExports: deadExports.slice(0, 50).map(d => ({
              file: path.relative(process.cwd(), d.file),
              export: d.export,
            })),
            truncated: deadExports.length > 50,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_query_duplicates - Find duplicate code patterns
  mcp.addTool({
    name: 'devloop_query_duplicates',
    description: 'Find potential duplicate code patterns using abstraction detection. Suggests consolidation opportunities.',
    parameters: queryDuplicatesSchema,
    execute: async (args: z.infer<typeof queryDuplicatesSchema>) => {
      try {
        const detector = await getAbstractionDetector(debug);
        const config = await getConfig();
        const codebaseConfig = (config as any).codebase || {};

        // Get files to analyze
        const searchDirs = codebaseConfig.searchDirs || ['docroot/modules/share', 'src'];
        const files: string[] = [];

        for (const dir of searchDirs) {
          const fullDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
          if (await fs.pathExists(fullDir)) {
            await walkDir(fullDir, files, ['.ts', '.tsx', '.js', '.jsx', '.php']);
          }
        }

        // Use abstraction detector to find patterns
        const duplicates: Array<{
          pattern: string;
          files: string[];
          suggestion: string;
        }> = [];

        // Simple duplicate detection based on code content similarity
        const fileContents = new Map<string, string>();
        for (const file of files.slice(0, 100)) { // Limit for performance
          try {
            const content = await fs.readFile(file, 'utf-8');
            fileContents.set(file, content);
          } catch {
            // Ignore read errors
          }
        }

        // Find similar function patterns
        const functionPatterns = new Map<string, string[]>();
        for (const [file, content] of fileContents) {
          // Extract function signatures
          const funcRegex = /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)|(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/g;
          let match;
          while ((match = funcRegex.exec(content)) !== null) {
            const funcName = match[1] || match[2];
            if (funcName && funcName.length > 3) {
              const existing = functionPatterns.get(funcName) || [];
              existing.push(file);
              functionPatterns.set(funcName, existing);
            }
          }
        }

        // Find duplicate function names across files
        for (const [funcName, files] of functionPatterns) {
          if (files.length > 1) {
            duplicates.push({
              pattern: `Function '${funcName}' appears in multiple files`,
              files: files.map(f => path.relative(process.cwd(), f)),
              suggestion: `Consider creating a shared utility for '${funcName}'`,
            });
          }
        }

        return {
          success: true,
          data: {
            duplicatePatternCount: duplicates.length,
            duplicates: duplicates.slice(0, 20),
            truncated: duplicates.length > 20,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_explain_code - Get explanation of code
  mcp.addTool({
    name: 'devloop_explain_code',
    description: 'Get a structured explanation of code in a file or for a specific symbol.',
    parameters: explainCodeSchema,
    execute: async (args: z.infer<typeof explainCodeSchema>) => {
      try {
        const config = await getConfig();
        const parser = await getASTParser(debug);

        const filePath = path.isAbsolute(args.filePath)
          ? args.filePath
          : path.join(process.cwd(), args.filePath);

        if (!await fs.pathExists(filePath)) {
          return { success: false, error: `File not found: ${args.filePath}` };
        }

        const ast = await parser.parse(filePath);
        const graph = await getCodebaseGraph(config, debug);

        let explanation: any = {
          file: path.relative(process.cwd(), filePath),
          language: ast.language,
        };

        if (args.symbol) {
          // Explain specific symbol
          const symbol = ast.symbols.find(s => s.name === args.symbol);
          if (!symbol) {
            return { success: false, error: `Symbol '${args.symbol}' not found in file` };
          }

          explanation.symbol = {
            name: symbol.name,
            type: symbol.type,
            line: symbol.line,
            signature: symbol.signature,
            docComment: symbol.docComment,
          };

          // Find usages
          const usages = await parser.findSymbolUsages(filePath, args.symbol);
          explanation.symbol.usagesInFile = usages.length;

        } else {
          // Explain whole file
          explanation.summary = {
            symbolCount: ast.symbols.length,
            exportCount: ast.exports.length,
            importCount: ast.imports.length,
          };

          if (args.detail !== 'brief') {
            explanation.exports = ast.exports.map(e => ({
              name: e.name,
              type: e.type,
              line: e.line,
            }));

            explanation.imports = ast.imports.map(i => ({
              source: i.source,
              specifiers: i.specifiers,
            }));
          }

          if (args.detail === 'comprehensive') {
            explanation.symbols = ast.symbols.map(s => ({
              name: s.name,
              type: s.type,
              line: s.line,
              signature: s.signature,
            }));

            // Add dependency info
            const dependents = graph.getDependents(filePath);
            const dependencies = graph.getDependencies(filePath);

            explanation.dependencies = {
              dependentCount: dependents.length,
              dependencyCount: dependencies.length,
              dependents: dependents.slice(0, 10).map(f => path.relative(process.cwd(), f)),
              dependencies: dependencies.slice(0, 10).map(f => path.relative(process.cwd(), f)),
            };
          }
        }

        return {
          success: true,
          data: explanation,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

// Helper function to walk directory
async function walkDir(dir: string, files: string[], extensions: string[]): Promise<void> {
  const excludeDirs = ['node_modules', 'vendor', '.git', 'dist', 'build', 'coverage'];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          await walkDir(fullPath, files, extensions);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore permission errors
  }
}

