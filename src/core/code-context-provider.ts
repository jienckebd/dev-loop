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

    // Include full content for small files
    let fullContent: string | undefined;
    if (await fs.pathExists(absolutePath)) {
      const content = await fs.readFile(absolutePath, 'utf-8');
      if (content.length < 20000) { // Under 20KB
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
}
