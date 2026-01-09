import * as fs from 'fs-extra';
import * as path from 'path';
import { TestResult, LogAnalysis, Task } from '../../types';

export interface WorkflowResults {
  tasks: Array<{
    task: Task;
    testResult?: TestResult;
    logAnalysis?: LogAnalysis;
    success: boolean;
    timestamp: string;
  }>;
  summary: {
    total: number;
    completed: number;
    failed: number;
    duration: number;
  };
}

export class OutputFormatter {
  private results: WorkflowResults['tasks'] = [];
  private startTime = Date.now();

  addResult(
    task: Task,
    testResult?: TestResult,
    logAnalysis?: LogAnalysis,
    success = true
  ): void {
    this.results.push({
      task,
      testResult,
      logAnalysis,
      success,
      timestamp: new Date().toISOString(),
    });
  }

  async generateJSON(outputPath?: string): Promise<string> {
    const results: WorkflowResults = {
      tasks: this.results,
      summary: {
        total: this.results.length,
        completed: this.results.filter((r) => r.success).length,
        failed: this.results.filter((r) => !r.success).length,
        duration: Date.now() - this.startTime,
      },
    };

    const json = JSON.stringify(results, null, 2);
    const filePath = outputPath || path.join(process.cwd(), 'devloop-results.json');

    await fs.writeFile(filePath, json, 'utf-8');
    return filePath;
  }

  async generateJUnitXML(outputPath?: string): Promise<string> {
    const filePath = outputPath || path.join(process.cwd(), 'devloop-results.xml');
    const duration = Date.now() - this.startTime;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += `<testsuites name="dev-loop" tests="${this.results.length}" failures="${this.results.filter((r) => !r.success).length}" time="${duration / 1000}">\n`;

    for (const result of this.results) {
      const testDuration = result.testResult?.duration || 0;
      xml += `  <testsuite name="${this.escapeXml(result.task.title)}" tests="1" failures="${result.success ? 0 : 1}" time="${testDuration / 1000}">\n`;
      xml += `    <testcase name="${this.escapeXml(result.task.title)}" time="${testDuration / 1000}">\n`;

      if (!result.success) {
        xml += `      <failure message="${this.escapeXml(result.testResult?.output || 'Task failed')}">\n`;
        xml += `        ${this.escapeXml(result.testResult?.output || '')}\n`;
        xml += `      </failure>\n`;
      }

      xml += `    </testcase>\n`;
      xml += `  </testsuite>\n`;
    }

    xml += '</testsuites>\n';

    await fs.writeFile(filePath, xml, 'utf-8');
    return filePath;
  }

  async generateMarkdown(outputPath?: string): Promise<string> {
    const filePath = outputPath || path.join(process.cwd(), 'devloop-summary.md');
    const duration = Date.now() - this.startTime;
    const completed = this.results.filter((r) => r.success).length;
    const failed = this.results.filter((r) => !r.success).length;

    let md = '# dev-loop Workflow Summary\n\n';
    md += `**Generated:** ${new Date().toISOString()}\n`;
    md += `**Duration:** ${(duration / 1000).toFixed(2)}s\n`;
    md += `**Total Tasks:** ${this.results.length}\n`;
    md += `**Completed:** ${completed} ✅\n`;
    md += `**Failed:** ${failed} ❌\n\n`;

    md += '## Task Results\n\n';

    for (const result of this.results) {
      const status = result.success ? '✅' : '❌';
      md += `### ${status} ${result.task.title}\n\n`;
      md += `- **ID:** ${result.task.id}\n`;
      md += `- **Priority:** ${result.task.priority}\n`;
      md += `- **Status:** ${result.task.status}\n`;
      md += `- **Timestamp:** ${result.timestamp}\n`;

      if (result.testResult) {
        md += `- **Test Duration:** ${(result.testResult.duration / 1000).toFixed(2)}s\n`;
        md += `- **Test Success:** ${result.testResult.success ? 'Yes' : 'No'}\n`;
      }

      if (result.logAnalysis) {
        md += `- **Errors Found:** ${result.logAnalysis.errors.length}\n`;
        md += `- **Warnings Found:** ${result.logAnalysis.warnings.length}\n`;
      }

      md += '\n';
    }

    md += '## Summary\n\n';
    md += `- **Success Rate:** ${((completed / this.results.length) * 100).toFixed(1)}%\n`;
    md += `- **Average Duration:** ${(duration / this.results.length / 1000).toFixed(2)}s per task\n`;

    await fs.writeFile(filePath, md, 'utf-8');
    return filePath;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

