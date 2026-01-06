/**
 * PRD Report Generator
 *
 * Generates comprehensive reports after PRD Set, PRD, or Phase completion.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdSetMetricsData, PrdMetricsData, PhaseMetricsData } from './hierarchical-metrics';
import { PrdSetMetrics } from './prd-set-metrics';
import { PrdMetrics } from './prd-metrics';
import { PhaseMetrics } from './phase-metrics';
import { CostCalculator } from './cost-calculator';
import { logger } from './logger';

export type ReportFormat = 'json' | 'markdown' | 'html';

export interface ReportOptions {
  format?: ReportFormat;
  output?: string;
  compareWith?: string; // PRD ID or PRD Set ID to compare with
}

export class PrdReportGenerator {
  private reportsPath: string;

  constructor(reportsPath: string = '.devloop/reports') {
    this.reportsPath = path.resolve(process.cwd(), reportsPath);
  }

  /**
   * Generate report for a PRD Set
   */
  async generatePrdSetReport(setId: string, options: ReportOptions = {}): Promise<string> {
    const prdSetMetrics = new PrdSetMetrics();
    const metrics = prdSetMetrics.getPrdSetMetrics(setId);

    if (!metrics) {
      throw new Error(`PRD Set metrics not found: ${setId}`);
    }

    const format = options.format || 'markdown';
    const outputPath = options.output || path.join(this.reportsPath, `prd-set-${setId}.${format}`);

    let content: string;
    switch (format) {
      case 'json':
        content = this.generatePrdSetJson(metrics);
        break;
      case 'html':
        content = this.generatePrdSetHtml(metrics);
        break;
      case 'markdown':
      default:
        content = this.generatePrdSetMarkdown(metrics);
    }

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, content, 'utf-8');

    logger.info(`Report generated: ${outputPath}`);
    return outputPath;
  }

  /**
   * Generate report for a PRD
   */
  async generatePrdReport(prdId: string, options: ReportOptions = {}): Promise<string> {
    const prdMetrics = new PrdMetrics();
    const metrics = prdMetrics.getPrdMetrics(prdId);

    if (!metrics) {
      throw new Error(`PRD metrics not found: ${prdId}`);
    }

    const format = options.format || 'markdown';
    const outputPath = options.output || path.join(this.reportsPath, `prd-${prdId}.${format}`);

    let content: string;
    switch (format) {
      case 'json':
        content = this.generatePrdJson(metrics);
        break;
      case 'html':
        content = this.generatePrdHtml(metrics);
        break;
      case 'markdown':
      default:
        content = this.generatePrdMarkdown(metrics);
    }

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, content, 'utf-8');

    logger.info(`Report generated: ${outputPath}`);
    return outputPath;
  }

  /**
   * Generate report for a Phase
   */
  async generatePhaseReport(prdId: string, phaseId: number, options: ReportOptions = {}): Promise<string> {
    const phaseMetrics = new PhaseMetrics();
    const metrics = phaseMetrics.getPhaseMetrics(phaseId, prdId);

    if (!metrics) {
      throw new Error(`Phase metrics not found: ${prdId}-${phaseId}`);
    }

    const format = options.format || 'markdown';
    const outputPath = options.output || path.join(this.reportsPath, `phase-${prdId}-${phaseId}.${format}`);

    let content: string;
    switch (format) {
      case 'json':
        content = JSON.stringify(metrics, null, 2);
        break;
      case 'html':
        content = this.generatePhaseHtml(metrics);
        break;
      case 'markdown':
      default:
        content = this.generatePhaseMarkdown(metrics);
    }

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, content, 'utf-8');

    logger.info(`Report generated: ${outputPath}`);
    return outputPath;
  }

  // Markdown generators
  private generatePrdSetMarkdown(metrics: PrdSetMetricsData): string {
    const duration = metrics.duration ? this.formatDuration(metrics.duration) : 'N/A';
    const cost = metrics.tokens.totalCost ? CostCalculator.formatCost(metrics.tokens.totalCost) : 'N/A';

    return `# PRD Set Execution Report: ${metrics.setId}

## Executive Summary

- **Status**: ${metrics.status}
- **Duration**: ${duration}
- **PRDs**: ${metrics.prds.completed}/${metrics.prds.total} completed (${(metrics.prds.successRate * 100).toFixed(1)}% success rate)
- **Tests**: ${metrics.tests.passing}/${metrics.tests.total} passing (${(metrics.tests.passRate * 100).toFixed(1)}% pass rate)
- **Cost**: ${cost}

## PRD Breakdown

${metrics.prdIds.map(prdId => `- ${prdId}`).join('\n')}

## Detailed Metrics

### Timing
- Total: ${this.formatDuration(metrics.timing.totalMs)}
- Average per PRD: ${this.formatDuration(metrics.timing.avgPrdMs)}
- Average per Task: ${this.formatDuration(metrics.timing.avgTaskMs)}

### Token Usage
- Input: ${metrics.tokens.totalInput.toLocaleString()}
- Output: ${metrics.tokens.totalOutput.toLocaleString()}
- Total Cost: ${cost}

### Test Results
- Total: ${metrics.tests.total}
- Passing: ${metrics.tests.passing}
- Failing: ${metrics.tests.failing}
- Pass Rate: ${(metrics.tests.passRate * 100).toFixed(1)}%

## Execution Levels

- Total Levels: ${metrics.executionLevels.total}
- Completed: ${metrics.executionLevels.completed}
- Current: ${metrics.executionLevels.current}

---
*Report generated at ${new Date().toISOString()}*
`;
  }

  private generatePrdMarkdown(metrics: PrdMetricsData): string {
    const duration = metrics.duration ? this.formatDuration(metrics.duration) : 'N/A';
    const cost = metrics.tokens.totalCost ? CostCalculator.formatCost(metrics.tokens.totalCost) : 'N/A';

    return `# PRD Execution Report: ${metrics.prdId}

## Executive Summary

- **Status**: ${metrics.status}
- **Version**: ${metrics.prdVersion}
- **Duration**: ${duration}
- **Phases**: ${metrics.phases.completed}/${metrics.phases.total} completed (${(metrics.phases.successRate * 100).toFixed(1)}% success rate)
- **Tasks**: ${metrics.tasks.completed}/${metrics.tasks.total} completed (${(metrics.tasks.successRate * 100).toFixed(1)}% success rate)
- **Tests**: ${metrics.tests.passing}/${metrics.tests.total} passing (${(metrics.tests.passRate * 100).toFixed(1)}% pass rate)
- **Cost**: ${cost}

## Phase Breakdown

${metrics.phases.phaseMetrics.map(phase => `### Phase ${phase.phaseId}: ${phase.phaseName}
- Status: ${phase.status}
- Duration: ${phase.duration ? this.formatDuration(phase.duration) : 'N/A'}
- Tasks: ${phase.tasks.completed}/${phase.tasks.total} completed
- Tests: ${phase.tests.passing}/${phase.tests.failing} passing/failing
`).join('\n')}

## Feature Usage

${Object.entries(metrics.features.featureMetrics).map(([name, feature]) => `### ${name}
- Usage Count: ${feature.usageCount}
- Success Rate: ${feature.usageCount > 0 ? ((feature.successCount / feature.usageCount) * 100).toFixed(1) : 0}%
- Average Duration: ${this.formatDuration(feature.avgDuration)}
- Total Tokens: ${feature.totalTokens.toLocaleString()}
`).join('\n')}

## Schema Operations

- Total Operations: ${metrics.schema.schemaMetrics.totalOperations}
- Success Rate: ${(metrics.schema.schemaMetrics.successRate * 100).toFixed(1)}%
- Average Duration: ${this.formatDuration(metrics.schema.schemaMetrics.avgDuration)}

## Detailed Metrics

### Timing
- Total: ${this.formatDuration(metrics.timing.totalMs)}
- Average per Phase: ${this.formatDuration(metrics.timing.avgPhaseMs)}
- Average per Task: ${this.formatDuration(metrics.timing.avgTaskMs)}
- Average AI Call: ${this.formatDuration(metrics.timing.avgAiCallMs)}
- Average Test Run: ${this.formatDuration(metrics.timing.avgTestRunMs)}

### Token Usage
- Input: ${metrics.tokens.totalInput.toLocaleString()}
- Output: ${metrics.tokens.totalOutput.toLocaleString()}
- Total Cost: ${cost}

### Errors
- Total: ${metrics.errors.total}
${Object.entries(metrics.errors.byCategory).map(([cat, count]) => `- ${cat}: ${count}`).join('\n')}

### Efficiency
- Tokens per Task: ${metrics.efficiency.tokensPerTask.toFixed(0)}
- Iterations per Task: ${metrics.efficiency.iterationsPerTask.toFixed(1)}
- Average Retries: ${metrics.efficiency.avgRetries.toFixed(1)}

---
*Report generated at ${new Date().toISOString()}*
`;
  }

  private generatePhaseMarkdown(metrics: PhaseMetricsData): string {
    const duration = metrics.duration ? this.formatDuration(metrics.duration) : 'N/A';

    return `# Phase Execution Report: ${metrics.phaseName} (${metrics.prdId})

## Executive Summary

- **Status**: ${metrics.status}
- **Duration**: ${duration}
- **Tasks**: ${metrics.tasks.completed}/${metrics.tasks.total} completed (${(metrics.tasks.successRate * 100).toFixed(1)}% success rate)
- **Tests**: ${metrics.tests.passing}/${metrics.tests.failing} passing/failing
- **Parallel**: ${metrics.parallel ? 'Yes' : 'No'}

## Detailed Metrics

### Timing
- Total: ${this.formatDuration(metrics.timing.totalMs)}
- Average per Task: ${this.formatDuration(metrics.timing.avgTaskMs)}

### Token Usage
- Input: ${metrics.tokens.totalInput.toLocaleString()}
- Output: ${metrics.tokens.totalOutput.toLocaleString()}

---
*Report generated at ${new Date().toISOString()}*
`;
  }

  // JSON generators
  private generatePrdSetJson(metrics: PrdSetMetricsData): string {
    return JSON.stringify(metrics, null, 2);
  }

  private generatePrdJson(metrics: PrdMetricsData): string {
    return JSON.stringify(metrics, null, 2);
  }

  // HTML generators (simplified)
  private generatePrdSetHtml(metrics: PrdSetMetricsData): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>PRD Set Report: ${metrics.setId}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>PRD Set Execution Report: ${metrics.setId}</h1>
  <p><strong>Status:</strong> ${metrics.status}</p>
  <p><strong>Duration:</strong> ${metrics.duration ? this.formatDuration(metrics.duration) : 'N/A'}</p>
  <p><strong>PRDs:</strong> ${metrics.prds.completed}/${metrics.prds.total} completed</p>
</body>
</html>`;
  }

  private generatePrdHtml(metrics: PrdMetricsData): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>PRD Report: ${metrics.prdId}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>PRD Execution Report: ${metrics.prdId}</h1>
  <p><strong>Status:</strong> ${metrics.status}</p>
  <p><strong>Duration:</strong> ${metrics.duration ? this.formatDuration(metrics.duration) : 'N/A'}</p>
  <p><strong>Tasks:</strong> ${metrics.tasks.completed}/${metrics.tasks.total} completed</p>
</body>
</html>`;
  }

  private generatePhaseHtml(metrics: PhaseMetricsData): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Phase Report: ${metrics.phaseName}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>Phase Execution Report: ${metrics.phaseName}</h1>
  <p><strong>Status:</strong> ${metrics.status}</p>
  <p><strong>Duration:</strong> ${metrics.duration ? this.formatDuration(metrics.duration) : 'N/A'}</p>
</body>
</html>`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }
}

