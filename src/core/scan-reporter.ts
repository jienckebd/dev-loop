import * as fs from 'fs-extra';
import * as path from 'path';
import { ScanResult, ScanIssue } from './code-quality-scanner';
import { PluginRecommendation } from '../frameworks/interface';
import { TaskMasterBridge } from './task-bridge';

/**
 * Scan Reporter
 *
 * Generates reports from scan results and creates tasks.
 */
export class ScanReporter {
  private outputPath: string;
  private debug: boolean;

  constructor(outputPath: string = '.devloop/scan-results', debug: boolean = false) {
    this.outputPath = path.resolve(process.cwd(), outputPath);
    this.debug = debug;
  }

  /**
   * Generate structured JSON report for CI integration
   */
  generateJsonReport(results: ScanResult[], recommendations?: PluginRecommendation[]): string {
    const report = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      summary: {
        totalIssues: results.reduce((sum, r) => sum + r.summary.total, 0),
        totalTools: results.length,
        successfulTools: results.filter(r => r.success).length,
        bySeverity: this.aggregateSeverity(results),
        byPurpose: this.aggregateByPurpose(results),
      },
      results: results.map(r => ({
        tool: r.tool,
        purpose: r.purpose,
        success: r.success,
        error: r.error,
        summary: r.summary,
        duration: r.duration,
        issueCount: r.issues.length,
      })),
      issues: results.flatMap(r => r.issues),
      recommendations: recommendations || [],
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate human-readable markdown summary
   */
  generateMarkdownReport(results: ScanResult[], recommendations?: PluginRecommendation[]): string {
    const totalIssues = results.reduce((sum, r) => sum + r.summary.total, 0);
    const successfulTools = results.filter(r => r.success).length;
    const totalTools = results.length;

    let markdown = `# Code Quality Scan Report\n\n`;
    markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
    markdown += `## Summary\n\n`;
    markdown += `- **Total Issues:** ${totalIssues}\n`;
    markdown += `- **Tools Run:** ${totalTools} (${successfulTools} successful)\n`;
    markdown += `- **Duration:** ${results.reduce((sum, r) => sum + r.duration, 0)}ms\n\n`;

    // Severity breakdown
    const severity = this.aggregateSeverity(results);
    markdown += `### By Severity\n\n`;
    markdown += `- **Errors:** ${severity.error || 0}\n`;
    markdown += `- **Warnings:** ${severity.warning || 0}\n`;
    markdown += `- **Info:** ${severity.info || 0}\n\n`;

    // Results by tool
    markdown += `## Results by Tool\n\n`;
    for (const result of results) {
      const status = result.success ? '✓' : '✗';
      markdown += `### ${status} ${result.tool} (${result.purpose})\n\n`;
      markdown += `- **Issues:** ${result.summary.total}\n`;
      markdown += `- **Duration:** ${result.duration}ms\n`;
      if (result.error) {
        markdown += `- **Error:** ${result.error}\n`;
      }
      markdown += `\n`;

      // Top issues
      if (result.issues.length > 0) {
        const topIssues = result.issues.slice(0, 5);
        markdown += `**Top Issues:**\n\n`;
        for (const issue of topIssues) {
          markdown += `- \`${issue.file}${issue.line ? `:${issue.line}` : ''}\` - ${issue.message}\n`;
          if (issue.remediation) {
            markdown += `  - *Remediation:* ${issue.remediation}\n`;
          }
        }
        if (result.issues.length > 5) {
          markdown += `\n*... and ${result.issues.length - 5} more issues*\n`;
        }
        markdown += `\n`;
      }
    }

    // Recommendations
    if (recommendations && recommendations.length > 0) {
      markdown += `## Recommendations\n\n`;
      for (const rec of recommendations.slice(0, 10)) {
        markdown += `### ${rec.type} (${rec.priority})\n\n`;
        markdown += `**Trigger:** ${rec.trigger}\n\n`;
        markdown += `**Suggestion:** ${rec.suggestion}\n\n`;
        if (rec.evidence.length > 0) {
          markdown += `**Evidence:**\n`;
          for (const evidence of rec.evidence) {
            markdown += `- ${evidence}\n`;
          }
          markdown += `\n`;
        }
      }
    }

    return markdown;
  }

  /**
   * Save reports to disk
   */
  async saveReports(results: ScanResult[], recommendations?: PluginRecommendation[]): Promise<void> {
    await fs.ensureDir(this.outputPath);

    // Save JSON report
    const jsonReport = this.generateJsonReport(results, recommendations);
    await fs.writeFile(
      path.join(this.outputPath, 'devloop-scan-results.json'),
      jsonReport,
      'utf-8'
    );

    // Save markdown report
    const markdownReport = this.generateMarkdownReport(results, recommendations);
    await fs.writeFile(
      path.join(this.outputPath, 'devloop-scan-summary.md'),
      markdownReport,
      'utf-8'
    );

    if (this.debug) {
      console.log(`[ScanReporter] Reports saved to ${this.outputPath}`);
    }
  }

  /**
   * Create fix tasks from scan issues
   */
  async createFixTasks(
    issues: ScanIssue[],
    taskBridge: TaskMasterBridge,
    options: {
      minSeverity?: 'info' | 'warning' | 'error';
      groupBy?: 'file' | 'rule' | 'severity';
    } = {}
  ): Promise<string[]> {
    const { minSeverity = 'warning', groupBy = 'rule' } = options;
    const severityOrder = { info: 0, warning: 1, error: 2 };
    const minSeverityLevel = severityOrder[minSeverity];

    // Filter by severity
    const filteredIssues = issues.filter(issue => {
      const issueSeverity = severityOrder[issue.severity];
      return issueSeverity >= minSeverityLevel;
    });

    if (filteredIssues.length === 0) {
      return [];
    }

    const taskIds: string[] = [];

    // Group issues
    const grouped = this.groupIssues(filteredIssues, groupBy);

    for (const [groupKey, groupIssues] of Object.entries(grouped)) {
      const title = this.generateTaskTitle(groupKey, groupIssues, groupBy);
      const description = this.generateTaskDescription(groupIssues, groupBy);

      try {
        const task = await taskBridge.createTask({
          id: `scan-fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          title,
          description,
          priority: 'medium',
          status: 'pending',
        });

        taskIds.push(task.id || task.title);
      } catch (error) {
        if (this.debug) {
          console.warn(`[ScanReporter] Failed to create task for ${groupKey}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return taskIds;
  }

  /**
   * Group issues by specified criteria
   */
  private groupIssues(issues: ScanIssue[], groupBy: 'file' | 'rule' | 'severity'): Record<string, ScanIssue[]> {
    const grouped: Record<string, ScanIssue[]> = {};

    for (const issue of issues) {
      let key: string;

      switch (groupBy) {
        case 'file':
          key = issue.file;
          break;
        case 'rule':
          key = issue.rule || 'unknown';
          break;
        case 'severity':
          key = issue.severity;
          break;
        default:
          key = 'other';
      }

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(issue);
    }

    return grouped;
  }

  /**
   * Generate task title
   */
  private generateTaskTitle(groupKey: string, issues: ScanIssue[], groupBy: 'file' | 'rule' | 'severity'): string {
    const count = issues.length;

    switch (groupBy) {
      case 'file':
        return `Fix ${count} issue(s) in ${path.basename(groupKey)}`;
      case 'rule':
        return `Fix ${count} ${groupKey} issue(s)`;
      case 'severity':
        return `Fix ${count} ${groupKey} issue(s)`;
      default:
        return `Fix ${count} code quality issue(s)`;
    }
  }

  /**
   * Generate task description
   */
  private generateTaskDescription(issues: ScanIssue[], groupBy: 'file' | 'rule' | 'severity'): string {
    let description = `## Issues to Fix\n\n`;
    description += `Total: ${issues.length}\n\n`;

    // Group by file for display
    const byFile: Record<string, ScanIssue[]> = {};
    for (const issue of issues) {
      if (!byFile[issue.file]) {
        byFile[issue.file] = [];
      }
      byFile[issue.file].push(issue);
    }

    for (const [file, fileIssues] of Object.entries(byFile)) {
      description += `### ${file}\n\n`;
      for (const issue of fileIssues.slice(0, 10)) {
        description += `- **Line ${issue.line || 'N/A'}**: ${issue.message}\n`;
        if (issue.remediation) {
          description += `  - *Remediation:* ${issue.remediation}\n`;
        }
      }
      if (fileIssues.length > 10) {
        description += `\n*... and ${fileIssues.length - 10} more issues in this file*\n`;
      }
      description += `\n`;
    }

    return description;
  }

  /**
   * Aggregate severity across all results
   */
  private aggregateSeverity(results: ScanResult[]): Record<string, number> {
    const aggregated: Record<string, number> = {};

    for (const result of results) {
      for (const [severity, count] of Object.entries(result.summary.bySeverity)) {
        aggregated[severity] = (aggregated[severity] || 0) + count;
      }
    }

    return aggregated;
  }

  /**
   * Aggregate by purpose
   */
  private aggregateByPurpose(results: ScanResult[]): Record<string, number> {
    const aggregated: Record<string, number> = {};

    for (const result of results) {
      aggregated[result.purpose] = (aggregated[result.purpose] || 0) + result.summary.total;
    }

    return aggregated;
  }
}
