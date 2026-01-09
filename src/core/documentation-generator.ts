/**
 * Documentation Generator - Automated documentation generation
 *
 * Generates:
 * - API documentation from code
 * - README updates
 * - Architecture diagrams (Mermaid)
 * - Change logs
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { ASTParser, FileAST, SymbolInfo, ExportInfo } from './ast-parser';
import { CodebaseGraph } from './codebase-graph';

export interface APIDoc {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'method';
  signature?: string;
  description?: string;
  parameters?: ParameterDoc[];
  returns?: string;
  examples?: string[];
  since?: string;
  deprecated?: string;
}

export interface ParameterDoc {
  name: string;
  type: string;
  description?: string;
  optional?: boolean;
  default?: string;
}

export interface ModuleDoc {
  name: string;
  path: string;
  description?: string;
  exports: APIDoc[];
  dependencies: string[];
}

export interface ArchitectureDiagram {
  type: 'dependency' | 'class' | 'sequence' | 'flowchart';
  title: string;
  mermaid: string;
}

export interface DocumentationConfig {
  /** Output directory for documentation */
  outputDir?: string;
  /** Include private members */
  includePrivate?: boolean;
  /** Include examples from tests */
  includeExamples?: boolean;
  /** Generate Mermaid diagrams */
  generateDiagrams?: boolean;
  /** Template for README */
  readmeTemplate?: string;
}

const DEFAULT_CONFIG: Required<DocumentationConfig> = {
  outputDir: 'docs/api',
  includePrivate: false,
  includeExamples: true,
  generateDiagrams: true,
  readmeTemplate: '',
};

/**
 * Documentation Generator using AST analysis
 */
export class DocumentationGenerator {
  private config: Required<DocumentationConfig>;
  private astParser: ASTParser;
  private codebaseGraph?: CodebaseGraph;
  private debug: boolean;

  constructor(
    astParser: ASTParser,
    codebaseGraph?: CodebaseGraph,
    config: DocumentationConfig = {},
    debug: boolean = false
  ) {
    this.astParser = astParser;
    this.codebaseGraph = codebaseGraph;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.debug = debug;
  }

  /**
   * Generate documentation for a file
   */
  async generateFileDoc(filePath: string): Promise<ModuleDoc> {
    const ast = await this.astParser.parse(filePath);
    const exports: APIDoc[] = [];

    for (const exp of ast.exports) {
      const symbol = ast.symbols.find(s => s.name === exp.name);
      exports.push(this.createAPIDoc(exp, symbol));
    }

    const dependencies = this.codebaseGraph
      ? this.codebaseGraph.getDependencies(filePath).map(d => path.basename(d))
      : ast.imports.map(i => i.source);

    return {
      name: path.basename(filePath, path.extname(filePath)),
      path: filePath,
      description: this.extractModuleDescription(ast),
      exports,
      dependencies,
    };
  }

  /**
   * Generate API documentation for multiple files
   */
  async generateAPIDocs(filePaths: string[]): Promise<ModuleDoc[]> {
    const docs: ModuleDoc[] = [];

    for (const filePath of filePaths) {
      try {
        const doc = await this.generateFileDoc(filePath);
        if (doc.exports.length > 0) {
          docs.push(doc);
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`[DocGenerator] Failed to generate docs for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return docs;
  }

  /**
   * Generate Markdown documentation
   */
  async generateMarkdown(docs: ModuleDoc[]): Promise<string> {
    const sections: string[] = [];

    sections.push('# API Documentation\n');
    sections.push(`Generated: ${new Date().toISOString()}\n`);

    // Table of contents
    sections.push('## Table of Contents\n');
    for (const doc of docs) {
      sections.push(`- [${doc.name}](#${doc.name.toLowerCase().replace(/[^a-z0-9]/g, '-')})`);
    }
    sections.push('');

    // Module documentation
    for (const doc of docs) {
      sections.push(`## ${doc.name}\n`);

      if (doc.description) {
        sections.push(doc.description + '\n');
      }

      sections.push(`**File:** \`${doc.path}\`\n`);

      if (doc.dependencies.length > 0) {
        sections.push('**Dependencies:**');
        for (const dep of doc.dependencies) {
          sections.push(`- \`${dep}\``);
        }
        sections.push('');
      }

      sections.push('### Exports\n');

      for (const exp of doc.exports) {
        sections.push(`#### ${exp.name}\n`);
        sections.push(`\`\`\`typescript`);
        sections.push(exp.signature || `${exp.type} ${exp.name}`);
        sections.push('```\n');

        if (exp.description) {
          sections.push(exp.description + '\n');
        }

        if (exp.parameters && exp.parameters.length > 0) {
          sections.push('**Parameters:**\n');
          sections.push('| Name | Type | Description |');
          sections.push('|------|------|-------------|');
          for (const param of exp.parameters) {
            const optionalStr = param.optional ? '?' : '';
            sections.push(`| \`${param.name}${optionalStr}\` | \`${param.type}\` | ${param.description || '-'} |`);
          }
          sections.push('');
        }

        if (exp.returns) {
          sections.push(`**Returns:** \`${exp.returns}\`\n`);
        }

        if (exp.examples && exp.examples.length > 0) {
          sections.push('**Examples:**\n');
          for (const example of exp.examples) {
            sections.push('```typescript');
            sections.push(example);
            sections.push('```\n');
          }
        }
      }
    }

    return sections.join('\n');
  }

  /**
   * Generate architecture diagram in Mermaid format
   */
  async generateArchitectureDiagram(
    filePaths: string[],
    type: 'dependency' | 'class' = 'dependency'
  ): Promise<ArchitectureDiagram> {
    if (type === 'dependency') {
      return this.generateDependencyDiagram(filePaths);
    } else {
      return this.generateClassDiagram(filePaths);
    }
  }

  /**
   * Generate README from template
   */
  async generateREADME(
    projectName: string,
    description: string,
    docs: ModuleDoc[]
  ): Promise<string> {
    const sections: string[] = [];

    sections.push(`# ${projectName}\n`);
    sections.push(description + '\n');

    sections.push('## Installation\n');
    sections.push('```bash');
    sections.push('npm install');
    sections.push('```\n');

    sections.push('## Usage\n');
    sections.push('```typescript');
    sections.push(`import { ... } from '${projectName}';`);
    sections.push('```\n');

    sections.push('## API Overview\n');

    // Group by directory
    const byDir = new Map<string, ModuleDoc[]>();
    for (const doc of docs) {
      const dir = path.dirname(doc.path);
      const existing = byDir.get(dir) || [];
      existing.push(doc);
      byDir.set(dir, existing);
    }

    for (const [dir, dirDocs] of byDir) {
      sections.push(`### ${path.basename(dir)}\n`);
      for (const doc of dirDocs) {
        const exportNames = doc.exports.slice(0, 5).map(e => e.name).join(', ');
        sections.push(`- **${doc.name}**: ${exportNames}${doc.exports.length > 5 ? ', ...' : ''}`);
      }
      sections.push('');
    }

    sections.push('## Documentation\n');
    sections.push('See [API Documentation](docs/api/README.md) for detailed API reference.\n');

    sections.push('## License\n');
    sections.push('MIT\n');

    return sections.join('\n');
  }

  /**
   * Write documentation to output directory
   */
  async writeDocumentation(docs: ModuleDoc[]): Promise<string[]> {
    const outputDir = path.resolve(process.cwd(), this.config.outputDir);
    await fs.ensureDir(outputDir);

    const writtenFiles: string[] = [];

    // Write API documentation
    const apiMd = await this.generateMarkdown(docs);
    const apiPath = path.join(outputDir, 'README.md');
    await fs.writeFile(apiPath, apiMd, 'utf-8');
    writtenFiles.push(apiPath);

    // Write individual module docs
    for (const doc of docs) {
      const modulePath = path.join(outputDir, `${doc.name}.md`);
      const moduleMd = await this.generateMarkdown([doc]);
      await fs.writeFile(modulePath, moduleMd, 'utf-8');
      writtenFiles.push(modulePath);
    }

    // Generate and write architecture diagram
    if (this.config.generateDiagrams && docs.length > 1) {
      const diagram = await this.generateDependencyDiagram(docs.map(d => d.path));
      const diagramPath = path.join(outputDir, 'architecture.md');
      const diagramMd = `# Architecture\n\n\`\`\`mermaid\n${diagram.mermaid}\n\`\`\`\n`;
      await fs.writeFile(diagramPath, diagramMd, 'utf-8');
      writtenFiles.push(diagramPath);
    }

    return writtenFiles;
  }

  // Private helper methods

  private createAPIDoc(exp: ExportInfo, symbol?: SymbolInfo): APIDoc {
    const doc: APIDoc = {
      name: exp.name,
      type: exp.type === 'function' ? 'function' : exp.type === 'class' ? 'class' : exp.type === 'interface' ? 'interface' : exp.type === 'type' ? 'type' : 'function',
    };

    if (symbol) {
      doc.signature = symbol.signature;

      // Parse doc comment for description
      if (symbol.docComment) {
        const parsed = this.parseDocComment(symbol.docComment);
        doc.description = parsed.description;
        doc.parameters = parsed.parameters;
        doc.returns = parsed.returns;
        doc.examples = parsed.examples;
        doc.deprecated = parsed.deprecated;
      }
    }

    return doc;
  }

  private parseDocComment(comment: string): {
    description?: string;
    parameters: ParameterDoc[];
    returns?: string;
    examples: string[];
    deprecated?: string;
  } {
    const result = {
      parameters: [] as ParameterDoc[],
      examples: [] as string[],
    } as {
      description?: string;
      parameters: ParameterDoc[];
      returns?: string;
      examples: string[];
      deprecated?: string;
    };

    const lines = comment.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim());
    let inExample = false;
    let exampleBuffer: string[] = [];

    for (const line of lines) {
      if (line.startsWith('@param')) {
        const match = line.match(/@param\s+(?:\{([^}]+)\})?\s*(\w+)\s*-?\s*(.*)/);
        if (match) {
          result.parameters.push({
            name: match[2],
            type: match[1] || 'any',
            description: match[3],
          });
        }
      } else if (line.startsWith('@returns') || line.startsWith('@return')) {
        const match = line.match(/@returns?\s+(?:\{([^}]+)\})?\s*(.*)/);
        if (match) {
          result.returns = match[1] || match[2];
        }
      } else if (line.startsWith('@example')) {
        inExample = true;
      } else if (line.startsWith('@deprecated')) {
        result.deprecated = line.replace('@deprecated', '').trim() || 'This is deprecated';
      } else if (line.startsWith('@')) {
        inExample = false;
        if (exampleBuffer.length > 0) {
          result.examples.push(exampleBuffer.join('\n'));
          exampleBuffer = [];
        }
      } else if (inExample) {
        exampleBuffer.push(line);
      } else if (!line.startsWith('/*') && !line.startsWith('*/') && line) {
        if (!result.description) {
          result.description = line;
        } else {
          result.description += ' ' + line;
        }
      }
    }

    if (exampleBuffer.length > 0) {
      result.examples.push(exampleBuffer.join('\n'));
    }

    return result;
  }

  private extractModuleDescription(ast: FileAST): string | undefined {
    // Look for module-level doc comment (first comment in file)
    for (const symbol of ast.symbols) {
      if (symbol.docComment && symbol.line <= 10) {
        const lines = symbol.docComment.split('\n');
        for (const line of lines) {
          const cleaned = line.replace(/^\s*\*?\s?/, '').trim();
          if (cleaned && !cleaned.startsWith('@') && !cleaned.startsWith('/*') && !cleaned.startsWith('*/')) {
            return cleaned;
          }
        }
      }
    }
    return undefined;
  }

  private async generateDependencyDiagram(filePaths: string[]): Promise<ArchitectureDiagram> {
    const lines: string[] = ['graph TD'];
    const nodes = new Set<string>();

    for (const filePath of filePaths) {
      const nodeName = this.sanitizeNodeName(path.basename(filePath, path.extname(filePath)));
      nodes.add(nodeName);

      if (this.codebaseGraph) {
        const deps = this.codebaseGraph.getDependencies(filePath);
        for (const dep of deps) {
          const depName = this.sanitizeNodeName(path.basename(dep, path.extname(dep)));
          if (filePaths.some(f => f === dep)) {
            lines.push(`    ${nodeName} --> ${depName}`);
          }
        }
      }
    }

    return {
      type: 'dependency',
      title: 'Module Dependencies',
      mermaid: lines.join('\n'),
    };
  }

  private async generateClassDiagram(filePaths: string[]): Promise<ArchitectureDiagram> {
    const lines: string[] = ['classDiagram'];

    for (const filePath of filePaths) {
      try {
        const ast = await this.astParser.parse(filePath);

        for (const symbol of ast.symbols) {
          if (symbol.type === 'class') {
            lines.push(`    class ${symbol.name} {`);

            // Find methods in this class
            const classSymbols = ast.symbols.filter(s => s.type === 'method' && s.line > symbol.line && s.line < symbol.endLine);
            for (const method of classSymbols) {
              const visibility = method.signature?.includes('private') ? '-' : method.signature?.includes('protected') ? '#' : '+';
              lines.push(`        ${visibility}${method.name}()`);
            }

            lines.push('    }');
          }
        }
      } catch (error) {
        // Skip files that fail to parse
      }
    }

    return {
      type: 'class',
      title: 'Class Diagram',
      mermaid: lines.join('\n'),
    };
  }

  private sanitizeNodeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

