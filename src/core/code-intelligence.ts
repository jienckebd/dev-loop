/**
 * Code Intelligence - Comprehensive code analysis and insights
 *
 * Provides:
 * - Code explanation (natural language)
 * - Health scoring (quality metrics)
 * - Test coverage analysis
 * - Code complexity analysis
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { ASTParser, FileAST, SymbolInfo } from './ast-parser';
import { CodebaseGraph } from './codebase-graph';
import { CodeQualityScanner, ScanResult } from './code-quality-scanner';

// ============================================================================
// Code Explainer
// ============================================================================

export interface CodeExplanation {
  summary: string;
  purpose: string;
  keyComponents: ComponentExplanation[];
  dependencies: string[];
  complexity: 'simple' | 'moderate' | 'complex';
  suggestions?: string[];
}

export interface ComponentExplanation {
  name: string;
  type: string;
  description: string;
  usedBy?: string[];
}

/**
 * Generates natural language explanations of code
 */
export class CodeExplainer {
  private astParser: ASTParser;
  private debug: boolean;

  constructor(astParser: ASTParser, debug: boolean = false) {
    this.astParser = astParser;
    this.debug = debug;
  }

  /**
   * Generate explanation for a file
   */
  async explainFile(filePath: string): Promise<CodeExplanation> {
    const ast = await this.astParser.parse(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));

    // Analyze components
    const components: ComponentExplanation[] = [];
    for (const symbol of ast.symbols) {
      components.push({
        name: symbol.name,
        type: symbol.type,
        description: this.generateSymbolDescription(symbol, ast),
      });
    }

    // Determine complexity
    const complexity = this.assessComplexity(ast);

    // Generate summary
    const summary = this.generateSummary(fileName, ast, components);
    const purpose = this.inferPurpose(fileName, ast);

    // Extract dependencies
    const dependencies = ast.imports.map(i => i.source);

    // Generate suggestions
    const suggestions = this.generateSuggestions(ast, complexity);

    return {
      summary,
      purpose,
      keyComponents: components.slice(0, 10),
      dependencies,
      complexity,
      suggestions,
    };
  }

  /**
   * Generate explanation for a specific symbol
   */
  async explainSymbol(filePath: string, symbolName: string): Promise<string> {
    const ast = await this.astParser.parse(filePath);
    const symbol = ast.symbols.find(s => s.name === symbolName);

    if (!symbol) {
      throw new Error(`Symbol '${symbolName}' not found in ${filePath}`);
    }

    return this.generateSymbolDescription(symbol, ast);
  }

  private generateSymbolDescription(symbol: SymbolInfo, ast: FileAST): string {
    let description = '';

    switch (symbol.type) {
      case 'function':
        description = `A function named '${symbol.name}'`;
        if (symbol.signature) {
          description += ` with signature: ${symbol.signature}`;
        }
        break;
      case 'class':
        description = `A class named '${symbol.name}' that encapsulates`;
        const methods = ast.symbols.filter(s => s.type === 'method' && s.line > symbol.line && s.line < symbol.endLine);
        if (methods.length > 0) {
          description += ` ${methods.length} method(s): ${methods.slice(0, 3).map(m => m.name).join(', ')}`;
        }
        break;
      case 'interface':
        description = `An interface '${symbol.name}' defining a contract for`;
        break;
      case 'method':
        description = `A method '${symbol.name}'`;
        break;
      default:
        description = `A ${symbol.type} named '${symbol.name}'`;
    }

    if (symbol.docComment) {
      // Extract first sentence from doc comment
      const lines = symbol.docComment.split('\n').filter(l => !l.trim().startsWith('@') && !l.trim().startsWith('*') && l.trim());
      if (lines.length > 0) {
        description += `. ${lines[0].trim()}`;
      }
    }

    return description;
  }

  private assessComplexity(ast: FileAST): 'simple' | 'moderate' | 'complex' {
    const symbolCount = ast.symbols.length;
    const importCount = ast.imports.length;
    const classCount = ast.symbols.filter(s => s.type === 'class').length;

    const score = symbolCount + (importCount * 0.5) + (classCount * 2);

    if (score < 10) return 'simple';
    if (score < 30) return 'moderate';
    return 'complex';
  }

  private generateSummary(fileName: string, ast: FileAST, components: ComponentExplanation[]): string {
    const typeCount = components.reduce((acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeSummary = Object.entries(typeCount)
      .map(([type, count]) => `${count} ${type}(s)`)
      .join(', ');

    return `${fileName} contains ${typeSummary}. It imports from ${ast.imports.length} module(s).`;
  }

  private inferPurpose(fileName: string, ast: FileAST): string {
    // Infer purpose from filename and exports
    const lowerName = fileName.toLowerCase();

    if (lowerName.includes('test') || lowerName.includes('spec')) {
      return 'Contains tests for validating functionality';
    }
    if (lowerName.includes('util') || lowerName.includes('helper')) {
      return 'Provides utility functions for common operations';
    }
    if (lowerName.includes('service')) {
      return 'Implements a service layer for business logic';
    }
    if (lowerName.includes('controller') || lowerName.includes('api')) {
      return 'Handles API requests and responses';
    }
    if (lowerName.includes('model') || lowerName.includes('entity')) {
      return 'Defines data models and entities';
    }
    if (lowerName.includes('config')) {
      return 'Manages configuration settings';
    }

    // Default based on exports
    if (ast.exports.some(e => e.type === 'class')) {
      return 'Defines reusable class(es) for the application';
    }
    if (ast.exports.some(e => e.type === 'function')) {
      return 'Provides reusable function(s) for the application';
    }

    return 'Implements functionality for the application';
  }

  private generateSuggestions(ast: FileAST, complexity: string): string[] {
    const suggestions: string[] = [];

    if (complexity === 'complex') {
      suggestions.push('Consider breaking this file into smaller, focused modules');
    }

    if (ast.symbols.length > 20) {
      suggestions.push('This file has many symbols - consider organizing into separate files');
    }

    if (ast.imports.length > 15) {
      suggestions.push('High number of imports - some may be unused or could be consolidated');
    }

    const undocumented = ast.symbols.filter(s => !s.docComment).length;
    if (undocumented > ast.symbols.length * 0.5) {
      suggestions.push('Consider adding documentation comments to exported symbols');
    }

    return suggestions;
  }
}

// ============================================================================
// Health Scorer
// ============================================================================

export interface HealthScore {
  overall: number; // 0-100
  categories: {
    quality: number;
    maintainability: number;
    testCoverage: number;
    documentation: number;
    security: number;
  };
  trends: {
    improving: boolean;
    changePercent: number;
  };
  issues: HealthIssue[];
  recommendations: string[];
}

export interface HealthIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  message: string;
  file?: string;
  line?: number;
}

/**
 * Calculates and tracks codebase health metrics
 */
export class HealthScorer {
  private astParser: ASTParser;
  private codebaseGraph?: CodebaseGraph;
  private scanner?: CodeQualityScanner;
  private debug: boolean;
  private historyPath: string;

  constructor(
    astParser: ASTParser,
    codebaseGraph?: CodebaseGraph,
    scanner?: CodeQualityScanner,
    debug: boolean = false
  ) {
    this.astParser = astParser;
    this.codebaseGraph = codebaseGraph;
    this.scanner = scanner;
    this.debug = debug;
    this.historyPath = '.devloop/health-history.json';
  }

  /**
   * Calculate health score for the codebase
   */
  async calculateHealth(filePaths: string[]): Promise<HealthScore> {
    const issues: HealthIssue[] = [];
    let qualityScore = 100;
    let maintainabilityScore = 100;
    let documentationScore = 100;
    let securityScore = 100;
    let testCoverageScore = 50; // Default assumption

    // Analyze each file
    for (const filePath of filePaths.slice(0, 100)) { // Limit for performance
      try {
        const ast = await this.astParser.parse(filePath);

        // Check documentation
        const undocumentedExports = ast.exports.filter(e => {
          const symbol = ast.symbols.find(s => s.name === e.name);
          return !symbol?.docComment;
        });

        if (undocumentedExports.length > 0) {
          documentationScore -= undocumentedExports.length * 2;
          issues.push({
            severity: 'low',
            category: 'documentation',
            message: `${undocumentedExports.length} undocumented export(s)`,
            file: filePath,
          });
        }

        // Check complexity
        if (ast.symbols.length > 30) {
          maintainabilityScore -= 5;
          issues.push({
            severity: 'medium',
            category: 'maintainability',
            message: 'File has too many symbols (>30)',
            file: filePath,
          });
        }

        // Check for circular dependencies
        if (this.codebaseGraph) {
          const cycles = this.codebaseGraph.findCircularDependencies();
          if (cycles.length > 0) {
            maintainabilityScore -= cycles.length * 3;
          }
        }
      } catch (error) {
        // Skip files that fail to parse
      }
    }

    // Run quality scanner if available
    if (this.scanner) {
      try {
        const scanResults = await this.scanner.runScans({
          projectRoot: process.cwd(),
          types: ['static-analysis', 'security'],
        });

        for (const result of scanResults) {
          for (const issue of result.issues) {
            if (issue.severity === 'error') {
              qualityScore -= 3;
              securityScore -= result.purpose === 'security' ? 5 : 0;
            } else if (issue.severity === 'warning') {
              qualityScore -= 1;
            }

            issues.push({
              severity: issue.severity === 'error' ? 'high' : 'medium',
              category: result.purpose,
              message: issue.message,
              file: issue.file,
              line: issue.line,
            });
          }
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`[HealthScorer] Scanner failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Normalize scores
    qualityScore = Math.max(0, Math.min(100, qualityScore));
    maintainabilityScore = Math.max(0, Math.min(100, maintainabilityScore));
    documentationScore = Math.max(0, Math.min(100, documentationScore));
    securityScore = Math.max(0, Math.min(100, securityScore));

    // Calculate overall
    const overall = Math.round(
      (qualityScore * 0.3) +
      (maintainabilityScore * 0.25) +
      (testCoverageScore * 0.2) +
      (documentationScore * 0.15) +
      (securityScore * 0.1)
    );

    // Calculate trends
    const trends = await this.calculateTrends(overall);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      { quality: qualityScore, maintainability: maintainabilityScore, testCoverage: testCoverageScore, documentation: documentationScore, security: securityScore },
      issues
    );

    // Save to history
    await this.saveToHistory(overall);

    return {
      overall,
      categories: {
        quality: qualityScore,
        maintainability: maintainabilityScore,
        testCoverage: testCoverageScore,
        documentation: documentationScore,
        security: securityScore,
      },
      trends,
      issues: issues.slice(0, 50), // Limit issues
      recommendations,
    };
  }

  private async calculateTrends(currentScore: number): Promise<{ improving: boolean; changePercent: number }> {
    try {
      if (await fs.pathExists(this.historyPath)) {
        const history = await fs.readJson(this.historyPath);
        const previousScores = history.scores || [];

        if (previousScores.length > 0) {
          const previousScore = previousScores[previousScores.length - 1].score;
          const change = ((currentScore - previousScore) / previousScore) * 100;

          return {
            improving: change >= 0,
            changePercent: Math.round(change * 10) / 10,
          };
        }
      }
    } catch (error) {
      // Ignore history errors
    }

    return { improving: true, changePercent: 0 };
  }

  private async saveToHistory(score: number): Promise<void> {
    try {
      let history = { scores: [] as Array<{ date: string; score: number }> };

      if (await fs.pathExists(this.historyPath)) {
        history = await fs.readJson(this.historyPath);
      }

      history.scores.push({
        date: new Date().toISOString(),
        score,
      });

      // Keep last 30 entries
      if (history.scores.length > 30) {
        history.scores = history.scores.slice(-30);
      }

      await fs.ensureDir(path.dirname(this.historyPath));
      await fs.writeJson(this.historyPath, history);
    } catch (error) {
      // Ignore save errors
    }
  }

  private generateRecommendations(
    scores: Record<string, number>,
    issues: HealthIssue[]
  ): string[] {
    const recommendations: string[] = [];

    if (scores.documentation < 70) {
      recommendations.push('Add documentation comments to exported functions and classes');
    }

    if (scores.maintainability < 70) {
      recommendations.push('Break down large files into smaller, focused modules');
    }

    if (scores.quality < 70) {
      recommendations.push('Address linting errors and code quality issues');
    }

    if (scores.security < 80) {
      recommendations.push('Review and fix security vulnerabilities');
    }

    if (scores.testCoverage < 60) {
      recommendations.push('Increase test coverage for critical paths');
    }

    // Issue-specific recommendations
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.unshift(`Fix ${criticalIssues.length} critical issue(s) immediately`);
    }

    return recommendations.slice(0, 5);
  }
}

// ============================================================================
// Coverage Analyzer
// ============================================================================

export interface CoverageReport {
  summary: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
  files: FileCoverage[];
  uncoveredFiles: string[];
  gaps: CoverageGap[];
}

export interface FileCoverage {
  path: string;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  uncoveredLines: number[];
}

export interface CoverageGap {
  file: string;
  type: 'function' | 'branch' | 'line';
  description: string;
  line?: number;
  importance: 'high' | 'medium' | 'low';
}

/**
 * Analyzes test coverage and identifies gaps
 */
export class CoverageAnalyzer {
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
   * Analyze coverage from coverage report file
   */
  async analyzeCoverage(coveragePath: string): Promise<CoverageReport> {
    if (!await fs.pathExists(coveragePath)) {
      throw new Error(`Coverage file not found: ${coveragePath}`);
    }

    const coverageData = await fs.readJson(coveragePath);
    return this.parseCoverageData(coverageData);
  }

  /**
   * Find untested code based on codebase analysis
   */
  async findUntestedCode(
    sourceDir: string,
    testDir: string
  ): Promise<CoverageGap[]> {
    const gaps: CoverageGap[] = [];
    const sourceFiles = await this.getFiles(sourceDir, ['.ts', '.tsx', '.js', '.jsx', '.php']);
    const testFiles = await this.getFiles(testDir, ['.spec.ts', '.test.ts', '.spec.js', '.test.js']);

    // Find which source files have tests
    const testedFiles = new Set<string>();
    for (const testFile of testFiles) {
      try {
        const content = await fs.readFile(testFile, 'utf-8');
        // Extract imported/tested files
        const importMatches = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
        for (const match of importMatches) {
          const importPath = match[1];
          if (importPath.startsWith('.')) {
            const resolved = path.resolve(path.dirname(testFile), importPath);
            testedFiles.add(resolved);
            testedFiles.add(resolved + '.ts');
            testedFiles.add(resolved + '.tsx');
          }
        }
      } catch (error) {
        // Ignore read errors
      }
    }

    // Find untested source files
    for (const sourceFile of sourceFiles) {
      const normalizedPath = sourceFile.replace(/\.(ts|tsx|js|jsx)$/, '');
      const isTested = testedFiles.has(sourceFile) || testedFiles.has(normalizedPath);

      if (!isTested) {
        const ast = await this.astParser.parse(sourceFile);

        // Check if file has exports (worth testing)
        if (ast.exports.length > 0) {
          const importance = this.determineImportance(sourceFile, ast);
          gaps.push({
            file: sourceFile,
            type: 'function',
            description: `No tests found for ${ast.exports.length} export(s)`,
            importance,
          });
        }
      }
    }

    return gaps;
  }

  private parseCoverageData(data: any): CoverageReport {
    const files: FileCoverage[] = [];
    let totalStatements = 0;
    let coveredStatements = 0;
    let totalBranches = 0;
    let coveredBranches = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;
    let totalLines = 0;
    let coveredLines = 0;

    // Parse Istanbul/Jest coverage format
    for (const [filePath, fileCoverage] of Object.entries(data)) {
      if (typeof fileCoverage !== 'object' || !fileCoverage) continue;

      const fc = fileCoverage as any;
      const statements = fc.s || {};
      const branches = fc.b || {};
      const functions = fc.f || {};
      const lineMap = fc.statementMap || {};

      const stmtTotal = Object.keys(statements).length;
      const stmtCovered = Object.values(statements).filter((v: any) => v > 0).length;
      const branchTotal = Object.values(branches).flat().length;
      const branchCovered = Object.values(branches).flat().filter((v: any) => v > 0).length;
      const funcTotal = Object.keys(functions).length;
      const funcCovered = Object.values(functions).filter((v: any) => v > 0).length;

      // Calculate uncovered lines
      const uncoveredLines: number[] = [];
      for (const [key, value] of Object.entries(statements)) {
        if (value === 0 && lineMap[key]) {
          uncoveredLines.push(lineMap[key].start.line);
        }
      }

      totalStatements += stmtTotal;
      coveredStatements += stmtCovered;
      totalBranches += branchTotal;
      coveredBranches += branchCovered;
      totalFunctions += funcTotal;
      coveredFunctions += funcCovered;
      totalLines += stmtTotal;
      coveredLines += stmtCovered;

      files.push({
        path: filePath,
        statements: stmtTotal > 0 ? (stmtCovered / stmtTotal) * 100 : 100,
        branches: branchTotal > 0 ? (branchCovered / branchTotal) * 100 : 100,
        functions: funcTotal > 0 ? (funcCovered / funcTotal) * 100 : 100,
        lines: stmtTotal > 0 ? (stmtCovered / stmtTotal) * 100 : 100,
        uncoveredLines,
      });
    }

    // Find gaps
    const gaps: CoverageGap[] = [];
    for (const file of files) {
      if (file.functions < 80) {
        gaps.push({
          file: file.path,
          type: 'function',
          description: `Only ${file.functions.toFixed(1)}% of functions covered`,
          importance: file.functions < 50 ? 'high' : 'medium',
        });
      }
      if (file.branches < 60) {
        gaps.push({
          file: file.path,
          type: 'branch',
          description: `Only ${file.branches.toFixed(1)}% of branches covered`,
          importance: file.branches < 30 ? 'high' : 'medium',
        });
      }
    }

    const uncoveredFiles = files.filter(f => f.statements === 0).map(f => f.path);

    return {
      summary: {
        statements: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
        branches: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0,
        functions: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
        lines: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
      },
      files,
      uncoveredFiles,
      gaps,
    };
  }

  private determineImportance(filePath: string, ast: FileAST): 'high' | 'medium' | 'low' {
    const fileName = path.basename(filePath).toLowerCase();

    // Core files are high importance
    if (fileName.includes('service') || fileName.includes('controller') || fileName.includes('api')) {
      return 'high';
    }

    // Files with many exports are medium-high importance
    if (ast.exports.length > 5) {
      return 'high';
    }

    // Utility files are medium
    if (fileName.includes('util') || fileName.includes('helper')) {
      return 'medium';
    }

    // Check if file is depended upon by many others
    if (this.codebaseGraph) {
      const dependents = this.codebaseGraph.getDependents(filePath);
      if (dependents.length > 5) {
        return 'high';
      }
      if (dependents.length > 2) {
        return 'medium';
      }
    }

    return 'low';
  }

  private async getFiles(dir: string, extensions: string[]): Promise<string[]> {
    const files: string[] = [];
    const excludeDirs = ['node_modules', 'vendor', '.git', 'dist', 'build'];

    const walk = async (currentDir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
              await walk(fullPath);
            }
          } else if (entry.isFile()) {
            if (extensions.some(ext => entry.name.endsWith(ext))) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Ignore permission errors
      }
    };

    if (await fs.pathExists(dir)) {
      await walk(dir);
    }

    return files;
  }
}

