/**
 * Codebase Graph - File and symbol dependency tracking
 *
 * Builds and maintains a graph of:
 * - File imports/exports
 * - Class inheritance relationships
 * - Function/method calls
 * - Cross-language dependencies
 *
 * Provides impact analysis and change detection capabilities.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { ASTParser, FileAST, ImportInfo, ExportInfo, SymbolInfo } from './ast-parser';

export interface GraphNode {
  id: string; // File path
  type: 'file';
  language: string;
  exports: ExportInfo[];
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  lastModified: number;
}

export interface GraphEdge {
  from: string; // Source file path
  to: string; // Target file path
  type: 'imports' | 'extends' | 'implements' | 'uses' | 'calls';
  symbols: string[]; // Symbols involved in the relationship
}

export interface ImpactAnalysis {
  /** Files directly impacted by the change */
  directImpact: string[];
  /** Files transitively impacted (depend on directly impacted files) */
  transitiveImpact: string[];
  /** Symbols affected by the change */
  affectedSymbols: string[];
  /** Total impact score (0-1, higher = more impactful) */
  impactScore: number;
}

export interface BreakingChange {
  type: 'removed_export' | 'removed_symbol' | 'signature_change' | 'type_change';
  file: string;
  symbol: string;
  description: string;
  impactedFiles: string[];
}

export interface CodebaseGraphConfig {
  /** Root directory */
  projectRoot: string;
  /** Directories to include */
  searchDirs?: string[];
  /** Directories to exclude */
  excludeDirs?: string[];
  /** File extensions to include */
  extensions?: string[];
  /** Maximum depth for transitive impact analysis */
  maxTransitiveDepth?: number;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.php', '.py'];
const DEFAULT_EXCLUDE_DIRS = ['node_modules', 'vendor', '.git', 'dist', 'build', 'coverage'];

/**
 * Codebase Graph for dependency and impact analysis
 */
export class CodebaseGraph {
  private config: CodebaseGraphConfig;
  private astParser: ASTParser;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private reverseEdges: Map<string, GraphEdge[]> = new Map(); // To -> Edges pointing to it
  private initialized: boolean = false;
  private debug: boolean;

  constructor(config: CodebaseGraphConfig, astParser?: ASTParser, debug: boolean = false) {
    this.config = {
      ...config,
      searchDirs: config.searchDirs || [config.projectRoot],
      excludeDirs: config.excludeDirs || DEFAULT_EXCLUDE_DIRS,
      extensions: config.extensions || DEFAULT_EXTENSIONS,
      maxTransitiveDepth: config.maxTransitiveDepth || 5,
    };
    this.astParser = astParser || new ASTParser({}, debug);
    this.debug = debug;
  }

  /**
   * Inject AST parser (for enhanced parsing)
   */
  setASTParser(parser: ASTParser): void {
    this.astParser = parser;
  }

  /**
   * Build the complete codebase graph
   */
  async buildGraph(): Promise<void> {
    const startTime = Date.now();

    // Clear existing data
    this.nodes.clear();
    this.edges = [];
    this.reverseEdges.clear();

    // Find all files
    const files = await this.getAllFiles();

    if (this.debug) {
      console.log(`[CodebaseGraph] Building graph for ${files.length} files...`);
    }

    // Parse each file
    for (const filePath of files) {
      try {
        await this.addFile(filePath);
      } catch (error) {
        if (this.debug) {
          console.warn(`[CodebaseGraph] Failed to add ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Build edges
    await this.buildEdges();

    // Build reverse edge index
    this.buildReverseEdgeIndex();

    this.initialized = true;

    if (this.debug) {
      const duration = Date.now() - startTime;
      console.log(`[CodebaseGraph] Built graph: ${this.nodes.size} nodes, ${this.edges.length} edges (${duration}ms)`);
    }
  }

  /**
   * Get all nodes in the graph
   */
  getNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges in the graph
   */
  getEdges(): GraphEdge[] {
    return this.edges;
  }

  /**
   * Get a specific node
   */
  getNode(filePath: string): GraphNode | undefined {
    return this.nodes.get(filePath);
  }

  /**
   * Get files that import from a given file
   */
  getDependents(filePath: string): string[] {
    const edges = this.reverseEdges.get(filePath) || [];
    return [...new Set(edges.map(e => e.from))];
  }

  /**
   * Get files that a given file imports from
   */
  getDependencies(filePath: string): string[] {
    return this.edges
      .filter(e => e.from === filePath)
      .map(e => e.to);
  }

  /**
   * Get all related files (imports + dependents)
   */
  getRelatedFiles(filePath: string, depth: number = 1): string[] {
    const related = new Set<string>();
    const toProcess: Array<{ file: string; currentDepth: number }> = [{ file: filePath, currentDepth: 0 }];
    const processed = new Set<string>();

    while (toProcess.length > 0) {
      const { file, currentDepth } = toProcess.shift()!;

      if (processed.has(file) || currentDepth > depth) continue;
      processed.add(file);

      // Add dependents
      for (const dep of this.getDependents(file)) {
        related.add(dep);
        if (currentDepth < depth) {
          toProcess.push({ file: dep, currentDepth: currentDepth + 1 });
        }
      }

      // Add dependencies
      for (const dep of this.getDependencies(file)) {
        related.add(dep);
        if (currentDepth < depth) {
          toProcess.push({ file: dep, currentDepth: currentDepth + 1 });
        }
      }
    }

    related.delete(filePath); // Don't include the file itself
    return Array.from(related);
  }

  /**
   * Analyze impact of changes to a file
   */
  async getImpactAnalysis(filePath: string): Promise<ImpactAnalysis> {
    const directImpact = this.getDependents(filePath);
    const transitiveImpact: string[] = [];
    const affectedSymbols: string[] = [];
    const processed = new Set<string>(directImpact);
    processed.add(filePath);

    // Get symbols from the changed file
    const node = this.nodes.get(filePath);
    if (node) {
      affectedSymbols.push(...node.exports.map(e => e.name));
    }

    // Find transitive dependents
    let currentLevel = directImpact;
    let depth = 0;
    const maxDepth = this.config.maxTransitiveDepth || 5;

    while (currentLevel.length > 0 && depth < maxDepth) {
      const nextLevel: string[] = [];

      for (const file of currentLevel) {
        const dependents = this.getDependents(file);
        for (const dep of dependents) {
          if (!processed.has(dep)) {
            processed.add(dep);
            transitiveImpact.push(dep);
            nextLevel.push(dep);
          }
        }
      }

      currentLevel = nextLevel;
      depth++;
    }

    // Calculate impact score
    const totalFiles = this.nodes.size;
    const impactedCount = directImpact.length + transitiveImpact.length;
    const impactScore = totalFiles > 0 ? Math.min(impactedCount / totalFiles, 1) : 0;

    return {
      directImpact,
      transitiveImpact,
      affectedSymbols,
      impactScore,
    };
  }

  /**
   * Detect breaking changes between two versions of the graph
   */
  detectBreakingChanges(oldGraph: CodebaseGraph): BreakingChange[] {
    const changes: BreakingChange[] = [];

    // Check for removed exports
    for (const [filePath, oldNode] of oldGraph.nodes) {
      const newNode = this.nodes.get(filePath);

      if (!newNode) {
        // File was deleted - all exports are removed
        for (const exp of oldNode.exports) {
          const impactedFiles = oldGraph.getDependents(filePath);
          changes.push({
            type: 'removed_export',
            file: filePath,
            symbol: exp.name,
            description: `Export '${exp.name}' removed (file deleted)`,
            impactedFiles,
          });
        }
        continue;
      }

      // Check for removed exports
      for (const oldExport of oldNode.exports) {
        const newExport = newNode.exports.find(e => e.name === oldExport.name);
        if (!newExport) {
          const impactedFiles = this.getDependents(filePath);
          changes.push({
            type: 'removed_export',
            file: filePath,
            symbol: oldExport.name,
            description: `Export '${oldExport.name}' was removed`,
            impactedFiles,
          });
        }
      }

      // Check for removed symbols
      for (const oldSymbol of oldNode.symbols) {
        const newSymbol = newNode.symbols.find(s => s.name === oldSymbol.name && s.type === oldSymbol.type);
        if (!newSymbol) {
          changes.push({
            type: 'removed_symbol',
            file: filePath,
            symbol: oldSymbol.name,
            description: `${oldSymbol.type} '${oldSymbol.name}' was removed`,
            impactedFiles: this.getDependents(filePath),
          });
        } else if (oldSymbol.signature !== newSymbol.signature) {
          changes.push({
            type: 'signature_change',
            file: filePath,
            symbol: oldSymbol.name,
            description: `Signature of '${oldSymbol.name}' changed from '${oldSymbol.signature}' to '${newSymbol.signature}'`,
            impactedFiles: this.getDependents(filePath),
          });
        }
      }
    }

    return changes;
  }

  /**
   * Find dead code (exports not imported anywhere)
   */
  findDeadExports(): Array<{ file: string; export: string }> {
    const deadExports: Array<{ file: string; export: string }> = [];
    const importedSymbols = new Set<string>();

    // Collect all imported symbols
    for (const edge of this.edges) {
      for (const symbol of edge.symbols) {
        importedSymbols.add(`${edge.to}:${symbol}`);
      }
    }

    // Find exports not in imported symbols
    for (const [filePath, node] of this.nodes) {
      for (const exp of node.exports) {
        const key = `${filePath}:${exp.name}`;
        if (!importedSymbols.has(key)) {
          // Check if it's a default export or main entry point
          if (!exp.isDefault && !filePath.includes('index')) {
            deadExports.push({ file: filePath, export: exp.name });
          }
        }
      }
    }

    return deadExports;
  }

  /**
   * Find circular dependencies
   */
  findCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (node: string): void => {
      if (recStack.has(node)) {
        // Found cycle - extract it
        const cycleStart = pathStack.indexOf(node);
        if (cycleStart !== -1) {
          const cycle = pathStack.slice(cycleStart);
          cycle.push(node); // Complete the cycle
          cycles.push(cycle);
        }
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      recStack.add(node);
      pathStack.push(node);

      for (const dep of this.getDependencies(node)) {
        dfs(dep);
      }

      pathStack.pop();
      recStack.delete(node);
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Update graph for changed files
   */
  async updateFiles(changedFiles: string[]): Promise<void> {
    for (const filePath of changedFiles) {
      // Remove old data
      this.nodes.delete(filePath);
      this.edges = this.edges.filter(e => e.from !== filePath && e.to !== filePath);

      // Re-add if file exists
      if (await fs.pathExists(filePath)) {
        await this.addFile(filePath);
      }
    }

    // Rebuild edges for changed files
    for (const filePath of changedFiles) {
      if (this.nodes.has(filePath)) {
        await this.buildEdgesForFile(filePath);
      }
    }

    // Rebuild reverse edge index
    this.buildReverseEdgeIndex();
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    avgDependencies: number;
    avgDependents: number;
    mostDependent: string[];
    mostDependencies: string[];
  } {
    const dependentCounts: Map<string, number> = new Map();
    const dependencyCounts: Map<string, number> = new Map();

    for (const edge of this.edges) {
      dependencyCounts.set(edge.from, (dependencyCounts.get(edge.from) || 0) + 1);
      dependentCounts.set(edge.to, (dependentCounts.get(edge.to) || 0) + 1);
    }

    const nodeCount = this.nodes.size;
    const edgeCount = this.edges.length;

    let totalDeps = 0;
    let totalDependents = 0;
    for (const [, count] of dependencyCounts) totalDeps += count;
    for (const [, count] of dependentCounts) totalDependents += count;

    const avgDependencies = nodeCount > 0 ? totalDeps / nodeCount : 0;
    const avgDependents = nodeCount > 0 ? totalDependents / nodeCount : 0;

    // Find most dependent files (most files depend on them)
    const sortedByDependents = [...dependentCounts.entries()].sort((a, b) => b[1] - a[1]);
    const mostDependent = sortedByDependents.slice(0, 5).map(([file]) => file);

    // Find files with most dependencies
    const sortedByDependencies = [...dependencyCounts.entries()].sort((a, b) => b[1] - a[1]);
    const mostDependencies = sortedByDependencies.slice(0, 5).map(([file]) => file);

    return {
      nodeCount,
      edgeCount,
      avgDependencies,
      avgDependents,
      mostDependent,
      mostDependencies,
    };
  }

  // Private helper methods

  private async getAllFiles(): Promise<string[]> {
    const files: string[] = [];
    const searchDirs = this.config.searchDirs!;

    for (const dir of searchDirs) {
      const fullDir = path.isAbsolute(dir) ? dir : path.join(this.config.projectRoot, dir);
      await this.walkDirectory(fullDir, files);
    }

    return files;
  }

  private async walkDirectory(dir: string, files: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!this.config.excludeDirs!.includes(entry.name) && !entry.name.startsWith('.')) {
            await this.walkDirectory(fullPath, files);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (this.config.extensions!.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
  }

  private async addFile(filePath: string): Promise<void> {
    const ast = await this.astParser.parse(filePath);
    const stats = await fs.stat(filePath);

    const node: GraphNode = {
      id: filePath,
      type: 'file',
      language: ast.language,
      exports: ast.exports,
      symbols: ast.symbols,
      imports: ast.imports,
      lastModified: stats.mtimeMs,
    };

    this.nodes.set(filePath, node);
  }

  private async buildEdges(): Promise<void> {
    for (const [filePath] of this.nodes) {
      await this.buildEdgesForFile(filePath);
    }
  }

  private async buildEdgesForFile(filePath: string): Promise<void> {
    const node = this.nodes.get(filePath);
    if (!node) return;

    for (const imp of node.imports) {
      const resolvedPath = await this.resolveImport(imp.source, filePath);
      if (resolvedPath && this.nodes.has(resolvedPath)) {
        this.edges.push({
          from: filePath,
          to: resolvedPath,
          type: 'imports',
          symbols: imp.specifiers,
        });
      }
    }
  }

  private buildReverseEdgeIndex(): void {
    this.reverseEdges.clear();

    for (const edge of this.edges) {
      const existing = this.reverseEdges.get(edge.to) || [];
      existing.push(edge);
      this.reverseEdges.set(edge.to, existing);
    }
  }

  private async resolveImport(importSource: string, fromFile: string): Promise<string | null> {
    const dir = path.dirname(fromFile);

    // Handle relative imports
    if (importSource.startsWith('.')) {
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.php', '.py', ''];

      for (const ext of extensions) {
        const candidate = path.join(dir, importSource + ext);
        if (this.nodes.has(candidate) || await fs.pathExists(candidate)) {
          return candidate;
        }

        // Try index file
        const indexCandidate = path.join(dir, importSource, 'index' + ext);
        if (this.nodes.has(indexCandidate) || await fs.pathExists(indexCandidate)) {
          return indexCandidate;
        }
      }
    }

    // Handle node_modules imports (just check if we have it in the graph)
    if (!importSource.startsWith('.') && !importSource.startsWith('/')) {
      // Try common locations
      const nodeModulePaths = [
        path.join(this.config.projectRoot, 'node_modules', importSource, 'index.ts'),
        path.join(this.config.projectRoot, 'node_modules', importSource, 'index.js'),
        path.join(this.config.projectRoot, 'node_modules', importSource, 'src', 'index.ts'),
      ];

      for (const candidate of nodeModulePaths) {
        if (this.nodes.has(candidate)) {
          return candidate;
        }
      }
    }

    // Handle PHP namespaces
    if (importSource.includes('\\')) {
      const namePath = importSource.replace(/\\/g, path.sep);
      const candidates = [
        path.join(this.config.projectRoot, 'docroot/modules', namePath + '.php'),
        path.join(this.config.projectRoot, 'src', namePath + '.php'),
      ];

      for (const candidate of candidates) {
        if (this.nodes.has(candidate) || await fs.pathExists(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }
}

