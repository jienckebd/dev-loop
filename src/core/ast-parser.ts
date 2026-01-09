/**
 * AST Parser - Multi-language Abstract Syntax Tree parsing using tree-sitter
 *
 * Provides accurate code analysis for:
 * - Dependency extraction (imports/exports)
 * - Symbol detection (functions, classes, interfaces)
 * - Cross-language support (TypeScript, JavaScript, Python, PHP)
 * - Structural pattern detection
 */

import * as fs from 'fs-extra';
import * as path from 'path';

// Tree-sitter types (dynamic imports handle optional dependencies)
interface TreeSitterParser {
  setLanguage(language: any): void;
  parse(sourceCode: string): SyntaxTree;
}

interface SyntaxTree {
  rootNode: SyntaxNode;
  language: any;
}

interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  parent: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'default' | 'namespace';
  line: number;
  isDefault: boolean;
}

export interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'property';
  line: number;
  endLine: number;
  signature?: string;
  parameters?: string[];
  returnType?: string;
  modifiers?: string[];
  docComment?: string;
}

export interface FileAST {
  filePath: string;
  language: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
  errors: string[];
}

export interface ASTParserConfig {
  /** Languages to support (default: all available) */
  languages?: ('typescript' | 'javascript' | 'python' | 'php')[];
  /** Extract doc comments */
  includeDocComments?: boolean;
  /** Extract method signatures */
  includeSignatures?: boolean;
  /** Maximum file size to parse (default: 1MB) */
  maxFileSizeBytes?: number;
}

const DEFAULT_CONFIG: Required<ASTParserConfig> = {
  languages: ['typescript', 'javascript', 'python', 'php'],
  includeDocComments: true,
  includeSignatures: true,
  maxFileSizeBytes: 1024 * 1024,
};

/**
 * AST Parser using tree-sitter for accurate multi-language parsing
 */
export class ASTParser {
  private config: Required<ASTParserConfig>;
  private parsers: Map<string, TreeSitterParser> = new Map();
  private languages: Map<string, any> = new Map();
  private initialized: boolean = false;
  private initError: string | null = null;
  private debug: boolean;

  constructor(config: ASTParserConfig = {}, debug: boolean = false) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.debug = debug;
  }

  /**
   * Initialize tree-sitter parsers for configured languages
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Try to load tree-sitter (may not be installed)
      const Parser = await this.loadTreeSitter();
      if (!Parser) {
        this.initError = 'tree-sitter not installed';
        this.initialized = true;
        return;
      }

      // Load language parsers
      for (const lang of this.config.languages) {
        try {
          const langParser = await this.loadLanguage(lang);
          if (langParser) {
            const parser = new Parser() as TreeSitterParser;
            parser.setLanguage(langParser);
            this.parsers.set(lang, parser);
            this.languages.set(lang, langParser);
            if (this.debug) {
              console.log(`[ASTParser] Loaded language: ${lang}`);
            }
          }
        } catch (error) {
          if (this.debug) {
            console.warn(`[ASTParser] Failed to load ${lang}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      this.initialized = true;
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      this.initialized = true;
    }
  }

  /**
   * Check if parser is available
   */
  isAvailable(): boolean {
    return this.initialized && this.parsers.size > 0;
  }

  /**
   * Get initialization error if any
   */
  getInitError(): string | null {
    return this.initError;
  }

  /**
   * Parse a file and extract AST information
   */
  async parse(filePath: string): Promise<FileAST> {
    await this.initialize();

    const result: FileAST = {
      filePath,
      language: 'unknown',
      imports: [],
      exports: [],
      symbols: [],
      errors: [],
    };

    // Check file size
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > this.config.maxFileSizeBytes) {
        result.errors.push(`File too large: ${stats.size} bytes (max: ${this.config.maxFileSizeBytes})`);
        return result;
      }
    } catch (error) {
      result.errors.push(`Cannot stat file: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }

    // Determine language from extension
    const ext = path.extname(filePath).toLowerCase();
    const language = this.getLanguageFromExtension(ext);
    result.language = language;

    if (!language || !this.parsers.has(language)) {
      // Fall back to regex-based parsing
      return await this.parseWithRegex(filePath, result);
    }

    // Read file content
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      result.errors.push(`Cannot read file: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }

    // Parse with tree-sitter
    try {
      const parser = this.parsers.get(language)!;
      const tree = parser.parse(content);

      // Extract information based on language
      switch (language) {
        case 'typescript':
        case 'javascript':
          this.extractTypeScriptInfo(tree, result, content);
          break;
        case 'python':
          this.extractPythonInfo(tree, result, content);
          break;
        case 'php':
          this.extractPhpInfo(tree, result, content);
          break;
      }
    } catch (error) {
      result.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
      // Fall back to regex
      return await this.parseWithRegex(filePath, result);
    }

    return result;
  }

  /**
   * Extract imports from a file
   */
  async extractImports(filePath: string): Promise<ImportInfo[]> {
    const ast = await this.parse(filePath);
    return ast.imports;
  }

  /**
   * Extract exports from a file
   */
  async extractExports(filePath: string): Promise<ExportInfo[]> {
    const ast = await this.parse(filePath);
    return ast.exports;
  }

  /**
   * Extract all symbols from a file
   */
  async extractSymbols(filePath: string): Promise<SymbolInfo[]> {
    const ast = await this.parse(filePath);
    return ast.symbols;
  }

  /**
   * Get function/method signatures for a file
   */
  async getSignatures(filePath: string): Promise<Map<string, string>> {
    const ast = await this.parse(filePath);
    const signatures = new Map<string, string>();

    for (const symbol of ast.symbols) {
      if (symbol.signature) {
        signatures.set(symbol.name, symbol.signature);
      }
    }

    return signatures;
  }

  /**
   * Find all usages of a symbol in a file
   */
  async findSymbolUsages(filePath: string, symbolName: string): Promise<number[]> {
    await this.initialize();

    const lines: number[] = [];
    const ext = path.extname(filePath).toLowerCase();
    const language = this.getLanguageFromExtension(ext);

    if (!language || !this.parsers.has(language)) {
      // Regex fallback
      const content = await fs.readFile(filePath, 'utf-8');
      const regex = new RegExp(`\\b${this.escapeRegex(symbolName)}\\b`, 'g');
      const contentLines = content.split('\n');

      for (let i = 0; i < contentLines.length; i++) {
        if (regex.test(contentLines[i])) {
          lines.push(i + 1);
        }
      }
      return lines;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const parser = this.parsers.get(language)!;
    const tree = parser.parse(content);

    // Find identifier nodes matching the symbol name
    const identifiers = tree.rootNode.descendantsOfType('identifier');
    for (const id of identifiers) {
      if (id.text === symbolName) {
        lines.push(id.startPosition.row + 1);
      }
    }

    return [...new Set(lines)].sort((a, b) => a - b);
  }

  // Private helper methods

  private async loadTreeSitter(): Promise<any> {
    try {
      // Dynamic import to handle optional dependency
      // Using Function constructor to avoid static import analysis
      const treeSitter = await (Function('return import("tree-sitter")')() as Promise<any>);
      return treeSitter.default || treeSitter;
    } catch {
      return null;
    }
  }

  private async loadLanguage(lang: string): Promise<any> {
    try {
      // Using Function constructor to avoid static import analysis for optional deps
      switch (lang) {
        case 'typescript': {
          const ts = await (Function('return import("tree-sitter-typescript")')() as Promise<any>);
          return (ts.default || ts).typescript;
        }
        case 'javascript': {
          const js = await (Function('return import("tree-sitter-javascript")')() as Promise<any>);
          return js.default || js;
        }
        case 'python': {
          const py = await (Function('return import("tree-sitter-python")')() as Promise<any>);
          return py.default || py;
        }
        case 'php': {
          const php = await (Function('return import("tree-sitter-php")')() as Promise<any>);
          return (php.default || php).php;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private getLanguageFromExtension(ext: string): string {
    const extMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.php': 'php',
    };
    return extMap[ext] || '';
  }

  private extractTypeScriptInfo(tree: SyntaxTree, result: FileAST, content: string): void {
    const root = tree.rootNode;

    // Extract imports
    const importNodes = root.descendantsOfType([
      'import_statement',
      'import_declaration',
    ]);

    for (const node of importNodes) {
      const importInfo = this.parseTypeScriptImport(node);
      if (importInfo) {
        result.imports.push(importInfo);
      }
    }

    // Extract exports
    const exportNodes = root.descendantsOfType([
      'export_statement',
      'export_declaration',
    ]);

    for (const node of exportNodes) {
      const exportInfos = this.parseTypeScriptExport(node);
      result.exports.push(...exportInfos);
    }

    // Extract symbols (functions, classes, interfaces)
    this.extractTypeScriptSymbols(root, result, content);
  }

  private parseTypeScriptImport(node: SyntaxNode): ImportInfo | null {
    try {
      // Find the source string
      const sourceNode = node.descendantsOfType('string')[0];
      if (!sourceNode) return null;

      const source = sourceNode.text.replace(/['"]/g, '');
      const specifiers: string[] = [];
      let isDefault = false;
      let isNamespace = false;

      // Check for default import
      const defaultImport = node.childForFieldName('default');
      if (defaultImport) {
        specifiers.push(defaultImport.text);
        isDefault = true;
      }

      // Check for namespace import (import * as X)
      const namespaceImport = node.descendantsOfType('namespace_import')[0];
      if (namespaceImport) {
        const name = namespaceImport.descendantsOfType('identifier')[0];
        if (name) {
          specifiers.push(name.text);
          isNamespace = true;
        }
      }

      // Check for named imports
      const namedImports = node.descendantsOfType('import_specifier');
      for (const spec of namedImports) {
        const name = spec.descendantsOfType('identifier')[0];
        if (name) {
          specifiers.push(name.text);
        }
      }

      return {
        source,
        specifiers,
        isDefault,
        isNamespace,
        line: node.startPosition.row + 1,
      };
    } catch {
      return null;
    }
  }

  private parseTypeScriptExport(node: SyntaxNode): ExportInfo[] {
    const exports: ExportInfo[] = [];

    try {
      const isDefault = node.text.includes('export default');

      // Function exports
      const functions = node.descendantsOfType(['function_declaration', 'function']);
      for (const fn of functions) {
        const name = fn.childForFieldName('name');
        if (name) {
          exports.push({
            name: name.text,
            type: 'function',
            line: fn.startPosition.row + 1,
            isDefault,
          });
        }
      }

      // Class exports
      const classes = node.descendantsOfType('class_declaration');
      for (const cls of classes) {
        const name = cls.childForFieldName('name');
        if (name) {
          exports.push({
            name: name.text,
            type: 'class',
            line: cls.startPosition.row + 1,
            isDefault,
          });
        }
      }

      // Interface exports
      const interfaces = node.descendantsOfType('interface_declaration');
      for (const iface of interfaces) {
        const name = iface.childForFieldName('name');
        if (name) {
          exports.push({
            name: name.text,
            type: 'interface',
            line: iface.startPosition.row + 1,
            isDefault,
          });
        }
      }

      // Type alias exports
      const types = node.descendantsOfType('type_alias_declaration');
      for (const t of types) {
        const name = t.childForFieldName('name');
        if (name) {
          exports.push({
            name: name.text,
            type: 'type',
            line: t.startPosition.row + 1,
            isDefault,
          });
        }
      }

      // Variable exports
      const variables = node.descendantsOfType('variable_declarator');
      for (const v of variables) {
        const name = v.childForFieldName('name');
        if (name) {
          exports.push({
            name: name.text,
            type: 'variable',
            line: v.startPosition.row + 1,
            isDefault,
          });
        }
      }
    } catch {
      // Ignore parse errors
    }

    return exports;
  }

  private extractTypeScriptSymbols(root: SyntaxNode, result: FileAST, content: string): void {
    // Functions
    const functions = root.descendantsOfType(['function_declaration', 'arrow_function']);
    for (const fn of functions) {
      const name = fn.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(fn, name.text, 'function', content));
      }
    }

    // Classes
    const classes = root.descendantsOfType('class_declaration');
    for (const cls of classes) {
      const name = cls.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(cls, name.text, 'class', content));

        // Extract methods
        const methods = cls.descendantsOfType('method_definition');
        for (const method of methods) {
          const methodName = method.childForFieldName('name');
          if (methodName) {
            result.symbols.push(this.createSymbolInfo(method, methodName.text, 'method', content));
          }
        }
      }
    }

    // Interfaces
    const interfaces = root.descendantsOfType('interface_declaration');
    for (const iface of interfaces) {
      const name = iface.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(iface, name.text, 'interface', content));
      }
    }

    // Type aliases
    const types = root.descendantsOfType('type_alias_declaration');
    for (const t of types) {
      const name = t.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(t, name.text, 'type', content));
      }
    }
  }

  private extractPythonInfo(tree: SyntaxTree, result: FileAST, content: string): void {
    const root = tree.rootNode;

    // Extract imports
    const importStatements = root.descendantsOfType(['import_statement', 'import_from_statement']);
    for (const stmt of importStatements) {
      const importInfo = this.parsePythonImport(stmt);
      if (importInfo) {
        result.imports.push(importInfo);
      }
    }

    // Extract function definitions
    const functions = root.descendantsOfType('function_definition');
    for (const fn of functions) {
      const name = fn.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(fn, name.text, 'function', content));
      }
    }

    // Extract class definitions
    const classes = root.descendantsOfType('class_definition');
    for (const cls of classes) {
      const name = cls.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(cls, name.text, 'class', content));
        result.exports.push({
          name: name.text,
          type: 'class',
          line: cls.startPosition.row + 1,
          isDefault: false,
        });
      }
    }
  }

  private parsePythonImport(node: SyntaxNode): ImportInfo | null {
    try {
      const specifiers: string[] = [];
      let source = '';

      if (node.type === 'import_statement') {
        // import module
        const names = node.descendantsOfType('dotted_name');
        for (const name of names) {
          source = name.text;
          specifiers.push(name.text);
        }
      } else if (node.type === 'import_from_statement') {
        // from module import x, y
        const module = node.childForFieldName('module_name');
        if (module) {
          source = module.text;
        }
        const names = node.descendantsOfType('identifier');
        for (const name of names) {
          if (name.parent?.type !== 'dotted_name') {
            specifiers.push(name.text);
          }
        }
      }

      if (!source) return null;

      return {
        source,
        specifiers,
        isDefault: false,
        isNamespace: false,
        line: node.startPosition.row + 1,
      };
    } catch {
      return null;
    }
  }

  private extractPhpInfo(tree: SyntaxTree, result: FileAST, content: string): void {
    const root = tree.rootNode;

    // Extract use statements (PHP imports)
    const useStatements = root.descendantsOfType('use_declaration');
    for (const use of useStatements) {
      const names = use.descendantsOfType('qualified_name');
      for (const name of names) {
        result.imports.push({
          source: name.text,
          specifiers: [name.text.split('\\').pop() || name.text],
          isDefault: false,
          isNamespace: false,
          line: use.startPosition.row + 1,
        });
      }
    }

    // Extract class definitions
    const classes = root.descendantsOfType('class_declaration');
    for (const cls of classes) {
      const name = cls.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(cls, name.text, 'class', content));
        result.exports.push({
          name: name.text,
          type: 'class',
          line: cls.startPosition.row + 1,
          isDefault: false,
        });

        // Extract methods
        const methods = cls.descendantsOfType('method_declaration');
        for (const method of methods) {
          const methodName = method.childForFieldName('name');
          if (methodName) {
            result.symbols.push(this.createSymbolInfo(method, methodName.text, 'method', content));
          }
        }
      }
    }

    // Extract function definitions
    const functions = root.descendantsOfType('function_definition');
    for (const fn of functions) {
      const name = fn.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(fn, name.text, 'function', content));
      }
    }

    // Extract interface definitions
    const interfaces = root.descendantsOfType('interface_declaration');
    for (const iface of interfaces) {
      const name = iface.childForFieldName('name');
      if (name) {
        result.symbols.push(this.createSymbolInfo(iface, name.text, 'interface', content));
        result.exports.push({
          name: name.text,
          type: 'interface',
          line: iface.startPosition.row + 1,
          isDefault: false,
        });
      }
    }
  }

  private createSymbolInfo(
    node: SyntaxNode,
    name: string,
    type: SymbolInfo['type'],
    content: string
  ): SymbolInfo {
    const info: SymbolInfo = {
      name,
      type,
      line: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };

    if (this.config.includeSignatures) {
      // Extract first line as signature
      const startLine = node.startPosition.row;
      const lines = content.split('\n');
      if (lines[startLine]) {
        info.signature = lines[startLine].trim();
      }
    }

    if (this.config.includeDocComments) {
      // Look for preceding comment
      const docComment = this.findDocComment(node, content);
      if (docComment) {
        info.docComment = docComment;
      }
    }

    return info;
  }

  private findDocComment(node: SyntaxNode, content: string): string | null {
    const lines = content.split('\n');
    const startLine = node.startPosition.row;

    // Look for comment on previous lines
    for (let i = startLine - 1; i >= Math.max(0, startLine - 20); i--) {
      const line = lines[i].trim();
      if (line.startsWith('*/')) {
        // Found end of block comment, find start
        for (let j = i; j >= Math.max(0, i - 50); j--) {
          if (lines[j].trim().startsWith('/**') || lines[j].trim().startsWith('/*')) {
            return lines.slice(j, i + 1).join('\n');
          }
        }
      } else if (line.startsWith('//') || line.startsWith('#')) {
        // Single line comment
        return line;
      } else if (line.startsWith('"""') || line.startsWith("'''")) {
        // Python docstring
        return line;
      } else if (line && !line.startsWith('*')) {
        // Non-comment, non-empty line
        break;
      }
    }

    return null;
  }

  /**
   * Fallback regex-based parsing when tree-sitter is not available
   */
  private async parseWithRegex(filePath: string, result: FileAST): Promise<FileAST> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const ext = path.extname(filePath).toLowerCase();

      if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
        // TypeScript/JavaScript regex patterns
        const importRegex = /^import\s+(?:(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\}|\*\s+as\s+(\w+))?)\s*from\s*['"]([^'"]+)['"]/;
        const exportFuncRegex = /^export\s+(?:async\s+)?function\s+(\w+)/;
        const exportClassRegex = /^export\s+class\s+(\w+)/;
        const exportConstRegex = /^export\s+(?:const|let|var)\s+(\w+)/;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          // Imports
          const importMatch = line.match(importRegex);
          if (importMatch) {
            const [, defaultImport, namedImports, namespaceImport, source] = importMatch;
            const specifiers: string[] = [];

            if (defaultImport) specifiers.push(defaultImport);
            if (namedImports) {
              specifiers.push(...namedImports.split(',').map(s => s.trim().split(/\s+as\s+/)[0]));
            }
            if (namespaceImport) specifiers.push(namespaceImport);

            result.imports.push({
              source,
              specifiers,
              isDefault: !!defaultImport,
              isNamespace: !!namespaceImport,
              line: i + 1,
            });
          }

          // Exports
          const funcMatch = line.match(exportFuncRegex);
          if (funcMatch) {
            result.exports.push({ name: funcMatch[1], type: 'function', line: i + 1, isDefault: false });
            result.symbols.push({ name: funcMatch[1], type: 'function', line: i + 1, endLine: i + 1 });
          }

          const classMatch = line.match(exportClassRegex);
          if (classMatch) {
            result.exports.push({ name: classMatch[1], type: 'class', line: i + 1, isDefault: false });
            result.symbols.push({ name: classMatch[1], type: 'class', line: i + 1, endLine: i + 1 });
          }

          const constMatch = line.match(exportConstRegex);
          if (constMatch) {
            result.exports.push({ name: constMatch[1], type: 'variable', line: i + 1, isDefault: false });
          }
        }
      } else if (ext === '.php') {
        // PHP regex patterns
        const useRegex = /^use\s+([^;]+);/;
        const classRegex = /^(?:abstract\s+)?class\s+(\w+)/;
        const interfaceRegex = /^interface\s+(\w+)/;
        const functionRegex = /^(?:public|private|protected|static|\s)*function\s+(\w+)/;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          const useMatch = line.match(useRegex);
          if (useMatch) {
            const fullPath = useMatch[1].trim();
            const name = fullPath.split('\\').pop() || fullPath;
            result.imports.push({
              source: fullPath,
              specifiers: [name],
              isDefault: false,
              isNamespace: false,
              line: i + 1,
            });
          }

          const classMatch = line.match(classRegex);
          if (classMatch) {
            result.exports.push({ name: classMatch[1], type: 'class', line: i + 1, isDefault: false });
            result.symbols.push({ name: classMatch[1], type: 'class', line: i + 1, endLine: i + 1 });
          }

          const ifaceMatch = line.match(interfaceRegex);
          if (ifaceMatch) {
            result.exports.push({ name: ifaceMatch[1], type: 'interface', line: i + 1, isDefault: false });
            result.symbols.push({ name: ifaceMatch[1], type: 'interface', line: i + 1, endLine: i + 1 });
          }

          const funcMatch = line.match(functionRegex);
          if (funcMatch) {
            result.symbols.push({ name: funcMatch[1], type: 'method', line: i + 1, endLine: i + 1 });
          }
        }
      } else if (ext === '.py') {
        // Python regex patterns
        const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(.+)/;
        const classRegex = /^class\s+(\w+)/;
        const defRegex = /^def\s+(\w+)/;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          const importMatch = line.match(importRegex);
          if (importMatch) {
            const [, fromModule, imports] = importMatch;
            const source = fromModule || imports.split(',')[0].trim();
            const specifiers = imports.split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
            result.imports.push({
              source,
              specifiers,
              isDefault: false,
              isNamespace: false,
              line: i + 1,
            });
          }

          const classMatch = line.match(classRegex);
          if (classMatch) {
            result.exports.push({ name: classMatch[1], type: 'class', line: i + 1, isDefault: false });
            result.symbols.push({ name: classMatch[1], type: 'class', line: i + 1, endLine: i + 1 });
          }

          const defMatch = line.match(defRegex);
          if (defMatch) {
            result.symbols.push({ name: defMatch[1], type: 'function', line: i + 1, endLine: i + 1 });
          }
        }
      }
    } catch (error) {
      result.errors.push(`Regex parse error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

