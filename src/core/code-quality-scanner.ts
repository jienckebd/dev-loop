import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { CodeQualityTool, TechDebtIndicator } from '../frameworks/interface';

const execAsync = promisify(exec);

export interface ScanResult {
  tool: string;
  purpose: string;
  issues: ScanIssue[];
  summary: {
    total: number;
    bySeverity: Record<string, number>;
  };
  duration: number;
  success: boolean;
  error?: string;
}

export interface ScanIssue {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule?: string;
  remediation?: string;
}

export interface ScanOptions {
  projectRoot: string;
  tools?: CodeQualityTool[];
  techDebtIndicators?: TechDebtIndicator[];
  types?: Array<'static-analysis' | 'duplicate-detection' | 'security' | 'complexity' | 'tech-debt' | 'dependency-audit'>;
  minSeverity?: 'info' | 'warning' | 'error';
}

/**
 * Code Quality Scanner
 *
 * Orchestrates code quality tool execution and result parsing.
 * Supports multiple output formats (JSON, XML, text, SARIF).
 */
export class CodeQualityScanner {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Run all configured scans
   */
  async runScans(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const tools = options.tools || [];

    // Filter tools by type if specified
    const filteredTools = options.types
      ? tools.filter(tool => options.types!.includes(tool.purpose))
      : tools;

    for (const tool of filteredTools) {
      try {
        const startTime = Date.now();
        const result = await this.runTool(tool, options.projectRoot);
        const duration = Date.now() - startTime;

        results.push({
          ...result,
          duration,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (this.debug) {
          console.warn(`[CodeQualityScanner] Tool ${tool.name} failed: ${errorMessage}`);
        }

        results.push({
          tool: tool.name,
          purpose: tool.purpose,
          issues: [],
          summary: { total: 0, bySeverity: {} },
          duration: 0,
          success: false,
          error: errorMessage,
        });
      }
    }

    // Run tech debt scan if indicators provided
    if (options.techDebtIndicators && options.techDebtIndicators.length > 0) {
      const techDebtResult = await this.runTechDebtScan(
        options.techDebtIndicators,
        options.projectRoot,
        options.minSeverity
      );
      results.push(techDebtResult);
    }

    return results;
  }

  /**
   * Run a single tool
   */
  private async runTool(tool: CodeQualityTool, projectRoot: string): Promise<Omit<ScanResult, 'duration'>> {
    try {
      const { stdout, stderr } = await execAsync(tool.command, {
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const output = stdout || stderr;
      const issues = this.parseToolOutput(tool, output);

      const summary = {
        total: issues.length,
        bySeverity: issues.reduce((acc, issue) => {
          acc[issue.severity] = (acc[issue.severity] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      };

      return {
        tool: tool.name,
        purpose: tool.purpose,
        issues,
        summary,
        success: true,
      };
    } catch (error) {
      // Some tools return non-zero exit codes even with valid output
      const errorOutput = error instanceof Error ? error.message : String(error);
      const issues = this.parseToolOutput(tool, errorOutput);

      return {
        tool: tool.name,
        purpose: tool.purpose,
        issues,
        summary: {
          total: issues.length,
          bySeverity: issues.reduce((acc, issue) => {
            acc[issue.severity] = (acc[issue.severity] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
        },
        success: issues.length > 0, // Success if we parsed any issues
      };
    }
  }

  /**
   * Run tech debt scan using regex patterns
   */
  async runTechDebtScan(
    indicators: TechDebtIndicator[],
    projectRoot: string,
    minSeverity: 'info' | 'warning' | 'error' = 'info'
  ): Promise<ScanResult> {
    const startTime = Date.now();
    const issues: ScanIssue[] = [];

    const severityOrder = { info: 0, warning: 1, error: 2 };
    const minSeverityLevel = severityOrder[minSeverity];

    // Get all source files
    const sourceFiles = await this.getSourceFiles(projectRoot);

    for (const file of sourceFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');

        for (const indicator of indicators) {
          const severityLevel = severityOrder[indicator.severity as keyof typeof severityOrder] ?? 0;
          if (severityLevel < minSeverityLevel) {
            continue;
          }

          const regex = new RegExp(indicator.pattern, 'g');
          let match;

          while ((match = regex.exec(content)) !== null) {
            // Find line number
            const beforeMatch = content.substring(0, match.index);
            const lineNumber = beforeMatch.split('\n').length;

            issues.push({
              file: path.relative(projectRoot, file),
              line: lineNumber,
              severity: this.mapSeverity(indicator.severity),
              message: indicator.description,
              rule: indicator.category,
              remediation: indicator.remediation,
            });
          }
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`[CodeQualityScanner] Failed to scan ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const duration = Date.now() - startTime;

    return {
      tool: 'tech-debt-scan',
      purpose: 'tech-debt',
      issues,
      summary: {
        total: issues.length,
        bySeverity: issues.reduce((acc, issue) => {
          acc[issue.severity] = (acc[issue.severity] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      duration,
      success: true,
    };
  }

  /**
   * Parse tool output based on format
   */
  private parseToolOutput(tool: CodeQualityTool, output: string): ScanIssue[] {
    const issues: ScanIssue[] = [];

    try {
      switch (tool.outputFormat) {
        case 'json':
          issues.push(...this.parseJsonOutput(output, tool.name));
          break;
        case 'xml':
          // XML parsing would require a library like xml2js
          // For now, fall back to text parsing
          issues.push(...this.parseTextOutput(output, tool.name));
          break;
        case 'sarif':
          issues.push(...this.parseSarifOutput(output));
          break;
        case 'text':
        default:
          issues.push(...this.parseTextOutput(output, tool.name));
          break;
      }
    } catch (error) {
      if (this.debug) {
        console.warn(`[CodeQualityScanner] Failed to parse ${tool.name} output: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return issues;
  }

  /**
   * Parse JSON output (ESLint, PHPStan JSON format, etc.)
   */
  private parseJsonOutput(output: string, toolName: string): ScanIssue[] {
    const issues: ScanIssue[] = [];

    try {
      const data = JSON.parse(output);

      // ESLint format
      if (Array.isArray(data) && data[0]?.messages) {
        for (const file of data) {
          for (const message of file.messages || []) {
            issues.push({
              file: file.filePath || '',
              line: message.line,
              column: message.column,
              severity: message.severity === 2 ? 'error' : message.severity === 1 ? 'warning' : 'info',
              message: message.message,
              rule: message.ruleId,
            });
          }
        }
      }
      // PHPStan format
      else if (data.totals?.errors || data.totals?.warnings) {
        for (const file of data.files || []) {
          for (const message of file.messages || []) {
            issues.push({
              file: file.path || '',
              line: message.line,
              severity: message.severity === 'error' ? 'error' : 'warning',
              message: message.message,
            });
          }
        }
      }
      // Generic array of issues
      else if (Array.isArray(data)) {
        for (const item of data) {
          issues.push({
            file: item.file || item.path || '',
            line: item.line,
            column: item.column,
            severity: item.severity || 'warning',
            message: item.message || item.description || '',
            rule: item.rule || item.ruleId,
          });
        }
      }
      // npm audit format
      else if (data.vulnerabilities) {
        for (const [name, vuln] of Object.entries(data.vulnerabilities)) {
          const v = vuln as any;
          issues.push({
            file: 'package.json',
            severity: v.severity === 'critical' || v.severity === 'high' ? 'error' : 'warning',
            message: `${name}: ${v.title || v.overview || ''}`,
            rule: 'security',
            remediation: v.recommendation || `Update ${name} to ${v.patchedVersions || 'latest'}`,
          });
        }
      }
    } catch (error) {
      // Not valid JSON, try text parsing
      return this.parseTextOutput(output, toolName);
    }

    return issues;
  }

  /**
   * Parse SARIF output
   */
  private parseSarifOutput(output: string): ScanIssue[] {
    const issues: ScanIssue[] = [];

    try {
      const data = JSON.parse(output);
      if (data.runs && Array.isArray(data.runs)) {
        for (const run of data.runs) {
          for (const result of run.results || []) {
            const location = result.locations?.[0]?.physicalLocation;
            issues.push({
              file: location?.artifactLocation?.uri || '',
              line: location?.region?.startLine,
              column: location?.region?.startColumn,
              severity: result.level === 'error' ? 'error' : result.level === 'warning' ? 'warning' : 'info',
              message: result.message?.text || '',
              rule: result.ruleId,
            });
          }
        }
      }
    } catch (error) {
      // Fall back to text parsing
      return this.parseTextOutput(output, 'sarif');
    }

    return issues;
  }

  /**
   * Parse text output (fallback for any format)
   */
  private parseTextOutput(output: string, toolName: string): ScanIssue[] {
    const issues: ScanIssue[] = [];
    const lines = output.split('\n');

    // Common patterns for text output
    const fileLinePattern = /^(.+?):(\d+)(?::(\d+))?:\s*(.+)$/;
    const errorPattern = /(error|warning|info|notice)/i;

    for (const line of lines) {
      const match = line.match(fileLinePattern);
      if (match) {
        const [, file, lineStr, colStr, message] = match;
        const severityMatch = message.match(errorPattern);
        const severity = severityMatch
          ? (severityMatch[1].toLowerCase().includes('error') ? 'error' : 'warning')
          : 'warning';

        issues.push({
          file: file.trim(),
          line: parseInt(lineStr, 10),
          column: colStr ? parseInt(colStr, 10) : undefined,
          severity,
          message: message.trim(),
        });
      }
    }

    return issues;
  }

  /**
   * Get all source files in project
   */
  private async getSourceFiles(projectRoot: string): Promise<string[]> {
    const files: string[] = [];
    const excludeDirs = ['node_modules', 'vendor', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv'];

    async function walkDir(dir: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
              await walkDir(fullPath);
            }
          } else if (entry.isFile()) {
            // Include common source file extensions
            const ext = path.extname(entry.name);
            if (['.ts', '.tsx', '.js', '.jsx', '.py', '.php', '.java', '.go', '.rs'].includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Ignore permission errors
      }
    }

    await walkDir(projectRoot);
    return files;
  }

  /**
   * Map indicator severity to scan issue severity
   */
  private mapSeverity(severity: string): 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
      default:
        return 'info';
    }
  }
}
