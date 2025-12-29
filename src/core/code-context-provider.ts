import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Represents structured context extracted from a source file.
 */
export interface FileContext {
  path: string;
  imports: string[];           // Import statements from file header
  helperSignatures: string[];  // Function/class signatures in file
  testPatterns: TestPattern[]; // For test files: existing test structure
  skeleton: string;            // Abbreviated structure showing available helpers
  fullContent?: string;        // Full file content (optional, for small files)
}

export interface TestPattern {
  name: string;                // Test name/description
  structure: string;           // Brief structure description
  lineNumber: number;          // Line where test starts
}

/**
 * CodeContextProvider extracts rich, structured context from target files
 * to help AI understand existing code patterns and available helpers.
 *
 * This prevents common AI errors like:
 * - Using non-existent function names
 * - Wrong import paths
 * - Removing existing helper functions
 */
export class CodeContextProvider {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Extract TypeScript/JavaScript function and class signatures from a file.
   * Uses regex patterns - no AST required for basic signature extraction.
   */
  async extractSignatures(filePath: string): Promise<string[]> {
    if (!await fs.pathExists(filePath)) {
      return [];
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const signatures: string[] = [];

    // Match function declarations (regular and async)
    const functionPatterns = [
      // Regular function: function name(...) { or function name(...): ReturnType {
      /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)(?:\s*:\s*[^{]+)?/gm,
      // Arrow function assigned to const: const name = (...) => or const name = async (...) =>
      /^(?:export\s+)?const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/gm,
      // Class methods: async methodName(...) { or methodName(...): ReturnType {
      /^\s+(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)(?:\s*:\s*[^{]+)?\s*\{/gm,
    ];

    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const fullMatch = match[0].trim();
        const funcName = match[1];

        // Skip common noise
        if (['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(funcName)) {
          continue;
        }

        // Create clean signature
        const signature = this.cleanSignature(fullMatch);
        if (signature && !signatures.includes(signature)) {
          signatures.push(signature);
        }
      }
    }

    // Match class declarations
    const classPattern = /^(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
    let match;
    while ((match = classPattern.exec(content)) !== null) {
      const className = match[1];
      signatures.unshift(`class ${className}`); // Classes at the front
    }

    if (this.debug) {
      console.log(`[CodeContextProvider] Extracted ${signatures.length} signatures from ${filePath}`);
    }

    return signatures;
  }

  /**
   * Clean up a function signature for display.
   */
  private cleanSignature(signature: string): string {
    // Remove export/async prefixes, keep the core signature
    let clean = signature
      .replace(/^export\s+/, '')
      .replace(/\{$/, '')
      .replace(/\s*=>\s*$/, '')
      .trim();

    // Truncate very long signatures
    if (clean.length > 100) {
      clean = clean.substring(0, 97) + '...';
    }

    return clean;
  }

  /**
   * Extract import statements from file header (first 50 lines).
   */
  async extractImports(filePath: string): Promise<string[]> {
    if (!await fs.pathExists(filePath)) {
      return [];
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 50);
    const imports: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ') || trimmed.startsWith('import{')) {
        imports.push(trimmed);
      }
      // Stop at first non-import, non-comment, non-empty line after imports start
      if (imports.length > 0 &&
          !trimmed.startsWith('import') &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('/*') &&
          !trimmed.startsWith('*') &&
          trimmed.length > 0) {
        break;
      }
    }

    return imports;
  }

  /**
   * Extract test patterns from a Playwright/Jest test file.
   */
  async extractTestPatterns(filePath: string): Promise<TestPattern[]> {
    if (!await fs.pathExists(filePath)) {
      return [];
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const patterns: TestPattern[] = [];

    // Match test.describe and test() blocks
    const testDescribePattern = /test\.describe\s*\(\s*['"`]([^'"`]+)['"`]/;
    const testPattern = /^\s*test\s*\(\s*['"`]([^'"`]+)['"`]/;

    let currentDescribe = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const describeMatch = line.match(testDescribePattern);
      if (describeMatch) {
        currentDescribe = describeMatch[1];
      }

      const testMatch = line.match(testPattern);
      if (testMatch) {
        patterns.push({
          name: testMatch[1],
          structure: currentDescribe ? `${currentDescribe} > ${testMatch[1]}` : testMatch[1],
          lineNumber: i + 1,
        });
      }
    }

    return patterns;
  }

  /**
   * Generate a skeleton view of a file showing structure without full content.
   */
  async generateSkeleton(filePath: string): Promise<string> {
    const signatures = await this.extractSignatures(filePath);
    const imports = await this.extractImports(filePath);
    const testPatterns = await this.extractTestPatterns(filePath);

    const sections: string[] = [];

    // Imports section
    if (imports.length > 0) {
      sections.push('// === IMPORTS (copy these EXACTLY) ===');
      sections.push(...imports);
      sections.push('');
    }

    // Available functions/helpers
    if (signatures.length > 0) {
      sections.push('// === AVAILABLE FUNCTIONS (use ONLY these) ===');
      for (const sig of signatures.slice(0, 30)) { // Limit to 30
        sections.push(`// ${sig}`);
      }
      sections.push('');
    }

    // Test structure (for test files)
    if (testPatterns.length > 0) {
      sections.push('// === EXISTING TESTS (add new tests after these) ===');
      for (const pattern of testPatterns.slice(0, 10)) { // Limit to 10
        sections.push(`// Line ${pattern.lineNumber}: test('${pattern.name}', ...)`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Get comprehensive file context for AI consumption.
   */
  async getFileContext(filePath: string): Promise<FileContext> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    const [imports, signatures, testPatterns, skeleton] = await Promise.all([
      this.extractImports(absolutePath),
      this.extractSignatures(absolutePath),
      this.extractTestPatterns(absolutePath),
      this.generateSkeleton(absolutePath),
    ]);

    // Include full content for files under 50KB (increased from 20KB for better patch context)
    let fullContent: string | undefined;
    if (await fs.pathExists(absolutePath)) {
      const content = await fs.readFile(absolutePath, 'utf-8');
      if (content.length < 50000) { // Under 50KB - enough for most source files
        fullContent = content;
      }
    }

    return {
      path: filePath,
      imports,
      helperSignatures: signatures,
      testPatterns,
      skeleton,
      fullContent,
    };
  }

  /**
   * Generate file-specific guidance prompt for AI.
   */
  async generateFileGuidance(filePath: string): Promise<string> {
    const context = await this.getFileContext(filePath);

    const sections: string[] = [
      `## File-Specific Guidance for ${filePath}`,
      '',
    ];

    // Critical rules
    sections.push('### CRITICAL RULES:');
    sections.push('1. NEVER remove or modify existing helper functions');
    sections.push('2. NEVER change import paths - copy them EXACTLY as shown');
    sections.push('3. Use ONLY function names listed in "Available Functions"');
    sections.push('4. ADD new code - do not replace existing code');
    sections.push('');

    // Available helpers
    if (context.helperSignatures.length > 0) {
      sections.push('### Available Helper Functions (use ONLY these):');
      for (const sig of context.helperSignatures.slice(0, 20)) {
        sections.push(`- \`${sig}\``);
      }
      sections.push('');
    }

    // Import pattern
    if (context.imports.length > 0) {
      sections.push('### Import Pattern (copy EXACTLY):');
      sections.push('```typescript');
      sections.push(...context.imports.slice(0, 10));
      sections.push('```');
      sections.push('');
    }

    // Test structure for test files
    if (context.testPatterns.length > 0) {
      sections.push('### Existing Test Structure (add new tests AFTER the last one):');
      const lastTest = context.testPatterns[context.testPatterns.length - 1];
      sections.push(`- Last test at line ${lastTest.lineNumber}: "${lastTest.name}"`);
      sections.push('- Add your new test() block AFTER this test');
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Extract exact lines from a file around a search pattern.
   * Used to provide precise context for patch operations.
   */
  async extractLinesAroundPattern(
    filePath: string,
    searchPattern: string,
    contextLines: number = 3
  ): Promise<{ found: boolean; lines: string; startLine: number } | null> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!await fs.pathExists(absolutePath)) {
      return null;
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    const allLines = content.split('\n');

    // Find the line containing the pattern
    const searchLower = searchPattern.toLowerCase();
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].toLowerCase().includes(searchLower)) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(allLines.length, i + contextLines + 1);
        const extractedLines = allLines.slice(start, end).join('\n');

        return {
          found: true,
          lines: extractedLines,
          startLine: start + 1,  // 1-indexed
        };
      }
    }

    return { found: false, lines: '', startLine: 0 };
  }

  /**
   * Get exact lines from a file by line numbers.
   */
  async getExactLines(
    filePath: string,
    startLine: number,
    endLine: number
  ): Promise<string | null> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!await fs.pathExists(absolutePath)) {
      return null;
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    const allLines = content.split('\n');

    // Convert to 0-indexed
    const start = Math.max(0, startLine - 1);
    const end = Math.min(allLines.length, endLine);

    return allLines.slice(start, end).join('\n');
  }

  /**
   * Get comprehensive patch context for a file.
   * This provides everything an AI agent needs to construct valid patches:
   * - File size info (to know if patches are required vs update)
   * - Last N lines of the file (common append location)
   * - Specific sections if keywords are provided
   *
   * Used when agents need to modify large files via patches.
   */
  async getPatchContext(
    filePath: string,
    keywords?: string[],
    contextLines: number = 10
  ): Promise<{
    fileInfo: { path: string; lineCount: number; charCount: number; requiresPatch: boolean };
    endOfFile: string;
    keywordSections: { keyword: string; context: string; lineNumber: number }[];
    guidance: string;
  } | null> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!await fs.pathExists(absolutePath)) {
      return null;
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    const allLines = content.split('\n');
    const lineCount = allLines.length;
    const charCount = content.length;

    // Files over 500 lines or 50KB should use patch operation
    const requiresPatch = lineCount > 500 || charCount > 50000;

    // Get last N lines (common location for appending new content)
    const endStart = Math.max(0, lineCount - contextLines);
    const endOfFile = allLines.slice(endStart).map((line, i) =>
      `${endStart + i + 1}|${line}`
    ).join('\n');

    // Find keyword sections
    const keywordSections: { keyword: string; context: string; lineNumber: number }[] = [];
    if (keywords && keywords.length > 0) {
      for (const keyword of keywords) {
        const result = await this.extractLinesAroundPattern(absolutePath, keyword, contextLines);
        if (result && result.found) {
          keywordSections.push({
            keyword,
            context: result.lines,
            lineNumber: result.startLine,
          });
        }
      }
    }

    // Generate guidance for the AI
    const guidance = requiresPatch
      ? `## PATCH OPERATION REQUIRED for ${filePath}

This file has ${lineCount} lines (${Math.round(charCount / 1024)}KB). You MUST use operation "patch" with search/replace.

CRITICAL PATCH RULES:
1. The "search" string must EXACTLY match content in the file (including whitespace, newlines)
2. Copy the search string VERBATIM from the file context provided
3. Use minimal context - just enough lines to uniquely identify the location
4. For appending at end of file, use the last few lines as your search string

Example patch format:
{
  "path": "${filePath}",
  "operation": "patch",
  "patches": [
    {
      "search": "// Exact content from file\\n// that you want to find",
      "replace": "// Exact content from file\\n// that you want to find\\n// Plus your new code"
    }
  ]
}`
      : `File ${filePath} (${lineCount} lines) can use "update" operation with full content.`;

    return {
      fileInfo: { path: filePath, lineCount, charCount, requiresPatch },
      endOfFile,
      keywordSections,
      guidance,
    };
  }

  /**
   * Extract execution context from error message
   */
  extractExecutionContext(errorText: string): {
    executionPath?: string;
    trigger?: string;
    missingState?: string;
    components?: string[];
  } {
    const lowerError = errorText.toLowerCase();
    const context: {
      executionPath?: string;
      trigger?: string;
      missingState?: string;
      components?: string[];
    } = {};

    // Extract execution path hints
    if (lowerError.includes('during form submission') || lowerError.includes('form submit')) {
      context.executionPath = 'form submission';
      context.trigger = 'form submission';
    } else if (lowerError.includes('during save') || lowerError.includes('preSave') || lowerError.includes('postSave')) {
      context.executionPath = 'entity save lifecycle';
      context.trigger = 'entity save';
    } else if (lowerError.includes('handler') || lowerError.includes('submit handler')) {
      context.executionPath = 'handler execution';
      context.trigger = 'handler';
    }

    // Extract missing state
    if (lowerError.includes('without a bundle') || lowerError.includes('bundle does not exist')) {
      context.missingState = 'entity bundle';
    } else if (lowerError.includes('not found') || lowerError.includes('does not exist')) {
      const match = errorText.match(/(?:field|entity|bundle|module)\s+['"]?([^'"]+)['"]?\s+(?:does not exist|not found)/i);
      if (match) {
        context.missingState = match[1];
      }
    }

    // Extract components
    const componentKeywords = ['IEF', 'widget', 'entity', 'form', 'handler', 'subscriber', 'processor', 'feeds'];
    const foundComponents = componentKeywords.filter(kw => lowerError.includes(kw.toLowerCase()));
    if (foundComponents.length > 0) {
      context.components = foundComponents;
    }

    return context;
  }

  /**
   * Generate error story from execution context
   */
  generateErrorStory(
    errorText: string,
    executionContext: ReturnType<typeof this.extractExecutionContext>
  ): string {
    const parts: string[] = [];

    if (executionContext.trigger) {
      parts.push(`When ${executionContext.trigger} occurs`);
    }

    if (executionContext.components && executionContext.components.length > 0) {
      parts.push(`${executionContext.components.join(' and ')} tries to`);
    }

    // Extract the action from error
    const lowerError = errorText.toLowerCase();
    if (lowerError.includes('create') || lowerError.includes('save')) {
      parts.push('create/save');
    } else if (lowerError.includes('access') || lowerError.includes('use')) {
      parts.push('access/use');
    }

    if (executionContext.missingState) {
      parts.push(`${executionContext.missingState}, but it doesn't exist yet`);
    } else {
      parts.push('something that requires state that doesn\'t exist');
    }

    return parts.join(' ') + '.';
  }

  /**
   * Generate enhanced error context for AI prompts
   */
  generateErrorContextPrompt(
    errorText: string,
    targetFiles?: string[]
  ): string {
    const executionContext = this.extractExecutionContext(errorText);
    const errorStory = this.generateErrorStory(errorText, executionContext);

    const sections: string[] = [
      '## ERROR CONTEXT ANALYSIS',
      '',
      `**Error Story**: ${errorStory}`,
      '',
    ];

    if (executionContext.executionPath) {
      sections.push(`**Execution Path**: ${executionContext.executionPath}`);
    }

    if (executionContext.trigger) {
      sections.push(`**Trigger**: ${executionContext.trigger}`);
    }

    if (executionContext.missingState) {
      sections.push(`**Missing State**: ${executionContext.missingState}`);
    }

    if (executionContext.components && executionContext.components.length > 0) {
      sections.push(`**Components Involved**: ${executionContext.components.join(', ')}`);
      if (executionContext.components.length > 1) {
        sections.push('');
        sections.push('**Multi-Component Interaction Detected**: This error involves multiple components interacting.');
        sections.push('Consider:');
        sections.push('- Execution order of components');
        sections.push('- Component lifecycle dependencies');
        sections.push('- State availability at interaction time');
      }
    }

    if (targetFiles && targetFiles.length > 0) {
      sections.push('');
      sections.push(`**Target Files**: ${targetFiles.join(', ')}`);
    }

    return sections.join('\n');
  }
}
