/**
 * Report Command
 *
 * Generate comprehensive reports for PRD Sets, PRDs, or Phases.
 */

import chalk from 'chalk';
import { loadConfig } from '../../config/loader';
import { PrdReportGenerator, ReportFormat } from '../../core/prd-report-generator';

export interface ReportCommandOptions {
  config?: string;
  prd?: string;
  prdSet?: string;
  phase?: string; // Format: "prdId:phaseId"
  latest?: boolean;
  all?: boolean;
  format?: 'json' | 'markdown' | 'html';
  output?: string;
  compare?: string;
}

export async function reportCommand(options: ReportCommandOptions): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const reportsPath = (config as any).metrics?.reportsPath || '.devloop/reports';
    const generator = new PrdReportGenerator(reportsPath);

    const format = (options.format || 'markdown') as ReportFormat;

    if (options.all) {
      // Generate reports for all PRDs
      const { PrdMetrics } = await import('../../core/prd-metrics');
      const prdMetrics = new PrdMetrics();
      const allPrds = prdMetrics.getAllPrdMetrics();

      console.log(chalk.cyan(`Generating reports for ${allPrds.length} PRD(s)...`));
      for (const prd of allPrds) {
        const outputPath = await generator.generatePrdReport(prd.prdId, {
          format,
          output: options.output,
        });
        console.log(chalk.green(`✓ Generated: ${outputPath}`));
      }
      return;
    }

    if (options.latest) {
      // Generate report for most recent PRD
      const { PrdMetrics } = await import('../../core/prd-metrics');
      const prdMetrics = new PrdMetrics();
      const allPrds = prdMetrics.getAllPrdMetrics();

      if (allPrds.length === 0) {
        console.error(chalk.red('No PRD metrics found'));
        process.exit(1);
      }

      // Sort by start time, most recent first
      const sorted = allPrds.sort((a, b) => {
        const timeA = new Date(a.startTime).getTime();
        const timeB = new Date(b.startTime).getTime();
        return timeB - timeA;
      });

      const latestPrd = sorted[0];
      const outputPath = await generator.generatePrdReport(latestPrd.prdId, {
        format,
        output: options.output,
      });
      console.log(chalk.green(`✓ Report generated: ${outputPath}`));
      return;
    }

    if (options.prdSet) {
      const outputPath = await generator.generatePrdSetReport(options.prdSet, {
        format,
        output: options.output,
        compareWith: options.compare,
      });
      console.log(chalk.green(`✓ Report generated: ${outputPath}`));
      return;
    }

    if (options.phase) {
      const [prdId, phaseId] = options.phase.split(':');
      if (!prdId || !phaseId) {
        console.error(chalk.red('Phase format must be "prdId:phaseId"'));
        process.exit(1);
      }
      const outputPath = await generator.generatePhaseReport(prdId, parseInt(phaseId, 10), {
        format,
        output: options.output,
      });
      console.log(chalk.green(`✓ Report generated: ${outputPath}`));
      return;
    }

    if (options.prd) {
      const outputPath = await generator.generatePrdReport(options.prd, {
        format,
        output: options.output,
        compareWith: options.compare,
      });
      console.log(chalk.green(`✓ Report generated: ${outputPath}`));
      return;
    }

    console.error(chalk.red('Please specify --prd, --prd-set, --phase, --latest, or --all'));
    process.exit(1);
  } catch (error) {
    console.error(chalk.red(`Failed to generate report: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

