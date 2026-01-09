import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdCoordinator, PrdState } from '../coordination/coordinator';
import { DiscoveredPrdSet } from './discovery';
import { ExecutionLevel } from '../../utils/dependency-graph';
import { logger } from '../../utils/logger';

export interface ProgressReport {
  setId: string;
  status: 'pending' | 'in-progress' | 'complete' | 'blocked' | 'failed';
  startTime?: Date;
  lastUpdate?: Date;
  estimatedCompletion?: Date;
  prdStatuses: Array<{
    prdId: string;
    status: PrdState['status'];
    currentPhase?: number;
    completedPhases: number[];
    progress: number; // 0-100
  }>;
  executionLevels: ExecutionLevel[];
  currentLevel: number;
  completedPrds: number;
  totalPrds: number;
  failedPrds: number;
}

/**
 * PRD Set Progress Tracker
 *
 * Tracks and reports progress for PRD set execution.
 */
export class PrdSetProgressTracker {
  private coordinator: PrdCoordinator;
  private metricsPath: string;
  private debug: boolean;

  constructor(
    coordinator: PrdCoordinator,
    metricsPath: string = '.devloop/prd-set-metrics.json',
    debug: boolean = false
  ) {
    this.coordinator = coordinator;
    this.metricsPath = metricsPath;
    this.debug = debug;
  }

  /**
   * Generate progress report for PRD set
   */
  async generateReport(
    discoveredSet: DiscoveredPrdSet,
    executionLevels: ExecutionLevel[]
  ): Promise<ProgressReport> {
    const prdStatuses: ProgressReport['prdStatuses'] = [];
    let completedCount = 0;
    let failedCount = 0;
    let currentLevel = 0;

    // Get status for each PRD
    for (const prd of discoveredSet.prdSet.prds) {
      const state = await this.coordinator.getPrdState(prd.id);
      const status = state?.status || 'pending';

      // Calculate progress (0-100)
      const phases = prd.metadata.requirements?.phases || [];
      const totalPhases = phases.length;
      const completedPhases = state?.completedPhases || [];
      const progress = totalPhases > 0
        ? Math.round((completedPhases.length / totalPhases) * 100)
        : (status === 'complete' ? 100 : 0);

      prdStatuses.push({
        prdId: prd.id,
        status,
        currentPhase: state?.currentPhase,
        completedPhases: completedPhases,
        progress,
      });

      if (status === 'complete') {
        completedCount++;
      } else if (status === 'failed' || status === 'blocked') {
        failedCount++;
      }

      // Determine current execution level
      for (let i = 0; i < executionLevels.length; i++) {
        if (executionLevels[i].prds.includes(prd.id) && status !== 'complete') {
          currentLevel = Math.max(currentLevel, i);
        }
      }
    }

    // Determine overall status
    let overallStatus: ProgressReport['status'] = 'pending';
    if (completedCount === discoveredSet.prdSet.prds.length) {
      overallStatus = 'complete';
    } else if (failedCount > 0 && completedCount === 0) {
      overallStatus = 'failed';
    } else if (failedCount > 0 || prdStatuses.some(s => s.status === 'blocked')) {
      overallStatus = 'blocked';
    } else if (completedCount > 0 || prdStatuses.some(s => s.status === 'running')) {
      overallStatus = 'in-progress';
    }

    // Estimate completion time (placeholder - would use historical data)
    const estimatedCompletion = this.estimateCompletion(prdStatuses, executionLevels);

    return {
      setId: discoveredSet.setId,
      status: overallStatus,
      lastUpdate: new Date(),
      estimatedCompletion,
      prdStatuses,
      executionLevels,
      currentLevel,
      completedPrds: completedCount,
      totalPrds: discoveredSet.prdSet.prds.length,
      failedPrds: failedCount,
    };
  }

  /**
   * Generate markdown progress report
   */
  async generateMarkdownReport(
    discoveredSet: DiscoveredPrdSet,
    executionLevels: ExecutionLevel[]
  ): Promise<string> {
    const report = await this.generateReport(discoveredSet, executionLevels);

    const statusEmoji = {
      'complete': '✅',
      'in-progress': '🔄',
      'blocked': '⏸️',
      'failed': '❌',
      'pending': '⏳',
    };

    const prdStatusEmoji = {
      'complete': '✅',
      'running': '🔄',
      'blocked': '⏸️',
      'failed': '❌',
      'pending': '⏳',
    };

    let markdown = `# PRD Set Execution Status\n\n`;
    markdown += `**Set**: ${report.setId}\n`;
    markdown += `**Status**: ${statusEmoji[report.status]} ${report.status}\n`;
    markdown += `**Progress**: ${report.completedPrds}/${report.totalPrds} PRDs complete\n`;

    if (report.startTime) {
      markdown += `**Started**: ${report.startTime.toLocaleString()}\n`;
    }
    if (report.lastUpdate) {
      markdown += `**Last Update**: ${report.lastUpdate.toLocaleString()}\n`;
    }
    if (report.estimatedCompletion) {
      markdown += `**Estimated Completion**: ${report.estimatedCompletion.toLocaleString()}\n`;
    }

    markdown += `\n## PRD Status\n\n`;

    for (const prdStatus of report.prdStatuses) {
      const emoji = prdStatusEmoji[prdStatus.status] || '⏳';
      markdown += `- ${emoji} **${prdStatus.prdId}** (${prdStatus.status})`;

      if (prdStatus.status === 'running' && prdStatus.currentPhase !== undefined) {
        markdown += ` - Phase ${prdStatus.currentPhase}`;
      }

      if (prdStatus.progress > 0) {
        markdown += ` - ${prdStatus.progress}% complete`;
      }

      if (prdStatus.status === 'blocked') {
        markdown += ` - waiting for dependencies`;
      }

      markdown += `\n`;
    }

    return markdown;
  }

  /**
   * Save progress metrics
   */
  async saveMetrics(report: ProgressReport): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.metricsPath));

      let metrics: ProgressReport[] = [];
      if (await fs.pathExists(this.metricsPath)) {
        metrics = await fs.readJson(this.metricsPath);
      }

      metrics.push(report);
      await fs.writeJson(this.metricsPath, metrics, { spaces: 2 });
    } catch (error: any) {
      if (this.debug) {
        logger.debug(`[PrdSetProgressTracker] Failed to save metrics: ${error.message}`);
      }
    }
  }

  /**
   * Estimate completion time based on historical data
   */
  private estimateCompletion(
    prdStatuses: ProgressReport['prdStatuses'],
    executionLevels: ExecutionLevel[]
  ): Date | undefined {
    // Placeholder - would use historical metrics
    // For now, return undefined (no estimate available)
    return undefined;
  }
}






