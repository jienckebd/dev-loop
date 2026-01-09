/**
 * Refactoring Engine - Automated code refactoring using AST
 *
 * Provides:
 * - Symbol renaming (across files)
 * - Method extraction
 * - Code movement (between files)
 * - Safe refactoring with validation
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { ASTParser, FileAST, SymbolInfo } from './ast-parser';
import { CodebaseGraph } from './codebase-graph';

export interface RefactoringOperation {
  type: 'rename' | 'extract' | 'move' | 'inline';
  description: string;
  files: FileChange[];
  validated: boolean;
  rollback?: FileChange[];
}

export interface FileChange {
  path: string;
  operation: 'modify' | 'create' | 'delete';
  originalContent?: string;
  newContent?: string;
  patches?: Patch[];
}

export interface Patch {
  startLine: number;
  endLine: number;
  oldText: string;
  newText: string;
}

export interface RenameResult {
  success: boolean;
  filesChanged: number;
  occurrencesReplaced: number;
  errors: string[];
}

export interface ExtractResult {
  success: boolean;
  extractedTo: string;
  newSymbolName: string;
  callSitesUpdated: number;
  errors: string[];
}

export interface RefactoringSuggestion {
  type: 'extract' | 'rename' | 'inline' | 'move';
  priority: 'high' | 'medium' | 'low';
  description: string;
  file: string;
  line?: number;
  benefit: string;
}

/**
 * Refactoring Engine with AST-based transformations
 */
export class RefactoringEngine {
  private astParser: ASTParser;
  private codebaseGraph?: CodebaseGraph;
  private debug: boolean;

  constructor(
    astParser: ASTParser,
    codebaseGraph?: CodebaseGraph,
    debug: boolean = false
  ) {
    this.astParser = astParser;
    this.codebaseGraph = codebaseGraph;
    this.debug = debug;
  }

  /**
   * Rename a symbol across the codebase
   */
  async renameSymbol(
    filePath: string,
    oldName: string,
    newName: string,
    options: { dryRun?: boolean; scope?: 'file' | 'project' } = {}
  ): Promise<RenameResult> {
    const result: RenameResult = {
      success: false,
      filesChanged: 0,
      occurrencesReplaced: 0,
      errors: [],
    };

    // Validate new name
    if (!this.isValidIdentifier(newName)) {
      result.errors.push(`Invalid identifier: ${newName}`);
      return result;
    }

    try {
      // Find all files to update
      const filesToUpdate: string[] = [filePath];

      if (options.scope !== 'file' && this.codebaseGraph) {
        const dependents = this.codebaseGraph.getDependents(filePath);
        filesToUpdate.push(...dependents);
      }

      // Process each file
      for (const file of filesToUpdate) {
        try {
          const usages = await this.astParser.findSymbolUsages(file, oldName);
          if (usages.length === 0) continue;

          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');
          let newContent = content;

          // Replace occurrences (use word boundary to avoid partial matches)
          const regex = new RegExp(`\\b${this.escapeRegex(oldName)}\\b`, 'g');
          newContent = newContent.replace(regex, newName);

          if (newContent !== content) {
            if (!options.dryRun) {
              await fs.writeFile(file, newContent, 'utf-8');
            }
            result.filesChanged++;
            result.occurrencesReplaced += usages.length;
          }
        } catch (error) {
          result.errors.push(`Failed to process ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      result.success = result.errors.length === 0;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * Extract code into a new function or method
   */
  async extractMethod(
    filePath: string,
    startLine: number,
    endLine: number,
    newMethodName: string,
    options: { dryRun?: boolean } = {}
  ): Promise<ExtractResult> {
    const result: ExtractResult = {
      success: false,
      extractedTo: filePath,
      newSymbolName: newMethodName,
      callSitesUpdated: 0,
      errors: [],
    };

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Extract the code block
      const extractedLines = lines.slice(startLine - 1, endLine);
      const extractedCode = extractedLines.join('\n');

      // Analyze the extracted code for variables
      const variables = this.findVariablesInCode(extractedCode);

      // Build new method
      const params = variables.used.filter(v => !variables.declared.includes(v));
      const returnVars = variables.declared.filter(v => {
        // Check if variable is used after the extracted block
        const afterCode = lines.slice(endLine).join('\n');
        return afterCode.includes(v);
      });

      const paramList = params.join(', ');
      const returnStatement = returnVars.length > 0
        ? `\n  return ${returnVars.length === 1 ? returnVars[0] : `{ ${returnVars.join(', ')} }`};`
        : '';

      const newMethod = `
function ${newMethodName}(${paramList}) {
${extractedCode.split('\n').map(l => '  ' + l).join('\n')}${returnStatement}
}
`;

      // Create call site
      const callArgs = params.join(', ');
      const callSite = returnVars.length > 0
        ? (returnVars.length === 1
            ? `const ${returnVars[0]} = ${newMethodName}(${callArgs});`
            : `const { ${returnVars.join(', ')} } = ${newMethodName}(${callArgs});`)
        : `${newMethodName}(${callArgs});`;

      // Build new content
      const newLines = [
        ...lines.slice(0, startLine - 1),
        callSite,
        ...lines.slice(endLine),
      ];

      // Find a good place to insert the new method (before the first function)
      let insertIndex = newLines.findIndex(l => l.match(/^(export\s+)?(async\s+)?function\s+/));
      if (insertIndex === -1) insertIndex = newLines.length;

      newLines.splice(insertIndex, 0, newMethod);

      if (!options.dryRun) {
        await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');
      }

      result.success = true;
      result.callSitesUpdated = 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * Generate refactoring suggestions based on code analysis
   */
  async suggestRefactorings(filePaths: string[]): Promise<RefactoringSuggestion[]> {
    const suggestions: RefactoringSuggestion[] = [];

    for (const filePath of filePaths) {
      try {
        const ast = await this.astParser.parse(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        // Check for long functions
        for (const symbol of ast.symbols) {
          if (symbol.type === 'function' || symbol.type === 'method') {
            const length = symbol.endLine - symbol.line;
            if (length > 50) {
              suggestions.push({
                type: 'extract',
                priority: 'medium',
                description: `Consider extracting parts of ${symbol.name} (${length} lines)`,
                file: filePath,
                line: symbol.line,
                benefit: 'Improved readability and testability',
              });
            }
          }
        }

        // Check for duplicate code patterns
        const duplicatePatterns = this.findDuplicatePatterns(lines);
        for (const pattern of duplicatePatterns) {
          suggestions.push({
            type: 'extract',
            priority: 'high',
            description: `Duplicate code pattern found at lines ${pattern.lines.join(', ')}`,
            file: filePath,
            line: pattern.lines[0],
            benefit: 'Reduced code duplication',
          });
        }

        // Check for poor naming
        for (const symbol of ast.symbols) {
          if (this.isPoorName(symbol.name)) {
            suggestions.push({
              type: 'rename',
              priority: 'low',
              description: `Consider renaming '${symbol.name}' to a more descriptive name`,
              file: filePath,
              line: symbol.line,
              benefit: 'Improved code readability',
            });
          }
        }

        // Check for files that could be split
        if (ast.exports.length > 10) {
          suggestions.push({
            type: 'move',
            priority: 'medium',
            description: `File has ${ast.exports.length} exports - consider splitting into multiple files`,
            file: filePath,
            benefit: 'Better organization and maintainability',
          });
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`[RefactoringEngine] Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestions.slice(0, 20); // Limit results
  }

  /**
   * Create a refactoring operation that can be previewed and applied
   */
  async createOperation(
    type: RefactoringOperation['type'],
    options: {
      file: string;
      symbol?: string;
      newName?: string;
      startLine?: number;
      endLine?: number;
      targetFile?: string;
    }
  ): Promise<RefactoringOperation> {
    const operation: RefactoringOperation = {
      type,
      description: '',
      files: [],
      validated: false,
    };

    switch (type) {
      case 'rename':
        if (!options.symbol || !options.newName) {
          throw new Error('rename requires symbol and newName');
        }
        operation.description = `Rename '${options.symbol}' to '${options.newName}'`;
        break;

      case 'extract':
        if (!options.startLine || !options.endLine || !options.newName) {
          throw new Error('extract requires startLine, endLine, and newName');
        }
        operation.description = `Extract lines ${options.startLine}-${options.endLine} to '${options.newName}'`;
        break;

      case 'move':
        if (!options.symbol || !options.targetFile) {
          throw new Error('move requires symbol and targetFile');
        }
        operation.description = `Move '${options.symbol}' to ${options.targetFile}`;
        break;

      case 'inline':
        if (!options.symbol) {
          throw new Error('inline requires symbol');
        }
        operation.description = `Inline '${options.symbol}'`;
        break;
    }

    return operation;
  }

  /**
   * Validate a refactoring operation
   */
  async validateOperation(operation: RefactoringOperation): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const file of operation.files) {
      if (file.operation === 'modify' && file.newContent) {
        // Check for syntax errors in the new content
        // This would use the AST parser to validate
        try {
          // Write to temp file and parse
          const ext = path.extname(file.path);
          const tempPath = `/tmp/refactor-validate-${Date.now()}${ext}`;
          await fs.writeFile(tempPath, file.newContent, 'utf-8');
          await this.astParser.parse(tempPath);
          await fs.remove(tempPath);
        } catch (error) {
          errors.push(`Syntax error in ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    operation.validated = errors.length === 0;
    return { valid: operation.validated, errors };
  }

  /**
   * Apply a validated refactoring operation
   */
  async applyOperation(operation: RefactoringOperation): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!operation.validated) {
      const validation = await this.validateOperation(operation);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }
    }

    // Create rollback data
    operation.rollback = [];

    for (const file of operation.files) {
      try {
        const fullPath = path.resolve(process.cwd(), file.path);

        switch (file.operation) {
          case 'modify':
            if (await fs.pathExists(fullPath)) {
              const original = await fs.readFile(fullPath, 'utf-8');
              operation.rollback.push({
                path: file.path,
                operation: 'modify',
                originalContent: original,
              });
            }
            if (file.newContent) {
              await fs.writeFile(fullPath, file.newContent, 'utf-8');
            }
            break;

          case 'create':
            await fs.ensureDir(path.dirname(fullPath));
            if (file.newContent) {
              await fs.writeFile(fullPath, file.newContent, 'utf-8');
            }
            operation.rollback.push({
              path: file.path,
              operation: 'delete',
            });
            break;

          case 'delete':
            if (await fs.pathExists(fullPath)) {
              const original = await fs.readFile(fullPath, 'utf-8');
              operation.rollback.push({
                path: file.path,
                operation: 'create',
                newContent: original,
              });
              await fs.remove(fullPath);
            }
            break;
        }
      } catch (error) {
        errors.push(`Failed to process ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { success: errors.length === 0, errors };
  }

  /**
   * Rollback a refactoring operation
   */
  async rollbackOperation(operation: RefactoringOperation): Promise<{ success: boolean; errors: string[] }> {
    if (!operation.rollback) {
      return { success: false, errors: ['No rollback data available'] };
    }

    const errors: string[] = [];

    for (const file of operation.rollback) {
      try {
        const fullPath = path.resolve(process.cwd(), file.path);

        switch (file.operation) {
          case 'modify':
            if (file.originalContent) {
              await fs.writeFile(fullPath, file.originalContent, 'utf-8');
            }
            break;

          case 'create':
            await fs.ensureDir(path.dirname(fullPath));
            if (file.newContent) {
              await fs.writeFile(fullPath, file.newContent, 'utf-8');
            }
            break;

          case 'delete':
            if (await fs.pathExists(fullPath)) {
              await fs.remove(fullPath);
            }
            break;
        }
      } catch (error) {
        errors.push(`Failed to rollback ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { success: errors.length === 0, errors };
  }

  // Private helper methods

  private isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private findVariablesInCode(code: string): { declared: string[]; used: string[] } {
    const declared: string[] = [];
    const used: string[] = [];

    // Find variable declarations
    const declMatches = code.matchAll(/(?:const|let|var)\s+(\w+)/g);
    for (const match of declMatches) {
      declared.push(match[1]);
    }

    // Find all identifiers (simplified)
    const identMatches = code.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g);
    const keywords = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'true', 'false', 'null', 'undefined', 'async', 'await']);

    for (const match of identMatches) {
      if (!keywords.has(match[1]) && !declared.includes(match[1])) {
        used.push(match[1]);
      }
    }

    return { declared, used: [...new Set(used)] };
  }

  private findDuplicatePatterns(lines: string[]): Array<{ pattern: string; lines: number[] }> {
    const patterns: Array<{ pattern: string; lines: number[] }> = [];
    const seen = new Map<string, number[]>();

    // Look for 3+ consecutive lines that repeat
    for (let i = 0; i < lines.length - 2; i++) {
      const pattern = lines.slice(i, i + 3).map(l => l.trim()).join('|');
      if (pattern.length > 20) { // Only meaningful patterns
        const existing = seen.get(pattern) || [];
        existing.push(i + 1);
        seen.set(pattern, existing);
      }
    }

    for (const [pattern, lineNumbers] of seen) {
      if (lineNumbers.length > 1) {
        patterns.push({ pattern, lines: lineNumbers });
      }
    }

    return patterns;
  }

  private isPoorName(name: string): boolean {
    // Single letter names (except common loop vars)
    if (name.length === 1 && !['i', 'j', 'k', 'x', 'y'].includes(name)) {
      return true;
    }

    // Generic names
    const genericNames = ['data', 'temp', 'tmp', 'foo', 'bar', 'baz', 'x1', 'x2'];
    if (genericNames.includes(name.toLowerCase())) {
      return true;
    }

    return false;
  }
}

