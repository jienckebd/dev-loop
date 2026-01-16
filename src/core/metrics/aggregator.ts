/**
 * Metrics Aggregator
 *
 * Unified interface for all metrics systems.
 * Provides shared save/load operations and cross-system analysis.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { BuildMetrics, BuildMetricsData } from './build';
import { PatternMetrics, PatternMetricsData } from './pattern';
import { ExecutionIntelligenceCollector, ExecutionIntelligence } from '../analysis/execution-intelligence-collector';
import { CorrelationAnalyzer } from './correlation-analyzer';

/**
 * Configuration for MetricsAggregator
 */
export interface MetricsAggregatorConfig {
  projectRoot: string;
  buildMetricsPath?: string;
  patternMetricsPath?: string;
  executionIntelligencePath?: string;
  debug?: boolean;
}

/**
 * Unified metrics data structure
 */
export interface UnifiedMetrics {
  build: BuildMetricsData[];
  pattern: PatternMetricsData;
  execution: ExecutionIntelligence;
  metadata: {
    lastUpdated: string;
    version: string;
  };
}

/**
 * Cross-system correlation insights
 */
export interface CorrelationInsights {
  patternEffectiveness: {
    patternId: string;
    buildSuccessRate: number;
    executionSuccessRate: number;
    overallImpact: number;
  }[];
  providerPerformance: {
    provider: string;
    buildQuality: number;
    executionSuccess: number;
    patternMatchRate: number;
  }[];
  configEffectiveness: {
    configKey: string;
    buildImprovement: number;
    executionImprovement: number;
  }[];
}

/**
 * Aggregates metrics from all systems
 */
export class MetricsAggregator {
  private projectRoot: string;
  private buildMetricsPath: string;
  private patternMetricsPath: string;
  private executionIntelligencePath: string;
  private debug: boolean;
  private buildMetrics: BuildMetrics;
  private patternMetrics: PatternMetrics;
  private executionCollector: ExecutionIntelligenceCollector;

  constructor(config: MetricsAggregatorConfig) {
    this.projectRoot = config.projectRoot;
    this.buildMetricsPath = config.buildMetricsPath || path.join(config.projectRoot, '.devloop', 'build-metrics.json');
    this.patternMetricsPath = config.patternMetricsPath || path.join(config.projectRoot, '.devloop', 'pattern-metrics.json');
    this.executionIntelligencePath = config.executionIntelligencePath || path.join(config.projectRoot, '.devloop', 'execution-intelligence.json');
    this.debug = config.debug || false;

    // Initialize individual metrics systems
    this.buildMetrics = new BuildMetrics(this.buildMetricsPath);
    this.patternMetrics = new PatternMetrics(this.patternMetricsPath);
    this.executionCollector = new ExecutionIntelligenceCollector({
      projectRoot: config.projectRoot,
      dataPath: this.executionIntelligencePath,
      debug: this.debug,
    });
  }

  /**
   * Get BuildMetrics instance for direct access.
   *
   * @returns The BuildMetrics instance
   */
  getBuildMetrics(): BuildMetrics {
    return this.buildMetrics;
  }

  /**
   * Get PatternMetrics instance for direct access.
   *
   * @returns The PatternMetrics instance
   */
  getPatternMetrics(): PatternMetrics {
    return this.patternMetrics;
  }

  /**
   * Get ExecutionIntelligenceCollector instance for direct access.
   *
   * @returns The ExecutionIntelligenceCollector instance
   */
  getExecutionCollector(): ExecutionIntelligenceCollector {
    return this.executionCollector;
  }

  /**
   * Load all metrics data from all systems.
   *
   * @returns Unified metrics containing build, pattern, and execution intelligence data
   */
  async loadAll(): Promise<UnifiedMetrics> {
    // Load build metrics
    const buildData = this.buildMetrics.getAllBuildMetrics();

    // Load pattern metrics - need full data structure
    const patternMetrics = this.patternMetrics.getMetrics();
    const patternData: PatternMetricsData = {
      version: '1.0',
      matches: [], // PatternMetrics doesn't expose matches directly
      metrics: patternMetrics,
    };

    // Load execution intelligence
    const executionData = await this.executionCollector.analyze();

    return {
      build: buildData,
      pattern: patternData,
      execution: executionData,
      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0',
      },
    };
  }

  /**
   * Save all metrics (delegates to individual systems).
   *
   * Each system manages its own save operations. This provides a unified interface.
   */
  async saveAll(): Promise<void> {
    // Each system manages its own save operations
    // This method provides a unified interface
    // Note: BuildMetrics.saveMetrics() is private, but it's called automatically
    // PatternMetrics saves automatically after each record, but we can force save
    this.patternMetrics.saveMetrics();
    await this.executionCollector.save();
    // BuildMetrics saves are handled internally
  }

  /**
   * Get correlation analyzer instance for cross-system analysis.
   *
   * @returns A CorrelationAnalyzer configured with this aggregator
   */
  getCorrelationAnalyzer(): CorrelationAnalyzer {
    return new CorrelationAnalyzer({
      aggregator: this,
    });
  }

  /**
   * Analyze correlations across all metrics systems
   * @deprecated Use getCorrelationAnalyzer().analyze() instead
   */
  async analyzeCorrelations(): Promise<CorrelationInsights> {
    const unified = await this.loadAll();

    const insights: CorrelationInsights = {
      patternEffectiveness: [],
      providerPerformance: [],
      configEffectiveness: [],
    };

    // Analyze pattern effectiveness across systems
    if (unified.pattern.metrics.mostEffectivePatterns) {
      for (const pattern of unified.pattern.metrics.mostEffectivePatterns) {
        // Find related build metrics
        const relatedBuilds = unified.build.filter(b => {
          // This would need pattern tracking in build metrics
          return true; // Placeholder
        });

        const buildSuccessRate = relatedBuilds.length > 0
          ? relatedBuilds.filter(b => b.status === 'completed').length / relatedBuilds.length
          : 0;

        const executionSuccessRate = pattern.successRate || 0;

        insights.patternEffectiveness.push({
          patternId: pattern.patternId,
          buildSuccessRate,
          executionSuccessRate,
          overallImpact: (buildSuccessRate + executionSuccessRate) / 2,
        });
      }
    }

    // Analyze provider performance
    if (unified.execution.configEffectiveness?.providerPerformance) {
      for (const [provider, perf] of Object.entries(unified.execution.configEffectiveness.providerPerformance)) {
        // Find builds using this provider
        const providerBuilds = unified.build.filter(b => {
          // Would need provider tracking in build metrics
          return true; // Placeholder
        });

        const buildQuality = providerBuilds.length > 0
          ? providerBuilds.reduce((sum, b) => sum + (b.quality?.executabilityScore || 0), 0) / providerBuilds.length
          : 0;

        const patternMatchRate = unified.pattern.metrics.matchSuccessRate || 0;

        insights.providerPerformance.push({
          provider,
          buildQuality,
          executionSuccess: perf.successRate,
          patternMatchRate,
        });
      }
    }

    return insights;
  }

  /**
   * Get unified summary of all metrics across systems.
   *
   * @returns Summary with key statistics from all metrics systems
   */
  async getSummary(): Promise<{
    totalBuilds: number;
    successfulBuilds: number;
    avgExecutabilityScore: number;
    totalPatternMatches: number;
    patternSuccessRate: number;
    avgTaskSuccessRate: number;
    topProviders: Array<{ provider: string; successRate: number }>;
  }> {
    const unified = await this.loadAll();

    const successfulBuilds = unified.build.filter(b => b.status === 'completed');
    const avgExecutabilityScore = successfulBuilds.length > 0
      ? successfulBuilds.reduce((sum, b) => sum + (b.quality?.executabilityScore || 0), 0) / successfulBuilds.length
      : 0;

    const topProviders: Array<{ provider: string; successRate: number }> = [];
    if (unified.execution.configEffectiveness?.providerPerformance) {
      for (const [provider, perf] of Object.entries(unified.execution.configEffectiveness.providerPerformance)) {
        topProviders.push({
          provider,
          successRate: perf.successRate,
        });
      }
      topProviders.sort((a, b) => b.successRate - a.successRate);
    }

    return {
      totalBuilds: unified.build.length,
      successfulBuilds: successfulBuilds.length,
      avgExecutabilityScore,
      totalPatternMatches: unified.pattern.metrics.totalMatches,
      patternSuccessRate: unified.pattern.metrics.matchSuccessRate,
      avgTaskSuccessRate: 0, // Would need to calculate from execution intelligence
      topProviders: topProviders.slice(0, 5),
    };
  }

  /**
   * Clear all metrics (use with caution)
   */
  async clearAll(): Promise<void> {
    // Clear individual systems
    // Note: This would need clear methods on each system
    if (this.debug) {
      logger.warn('[MetricsAggregator] Clear all metrics requested');
    }
  }
}

/**
 * Global instance getter (singleton pattern)
 */
let globalAggregator: MetricsAggregator | null = null;

export function getMetricsAggregator(config?: MetricsAggregatorConfig): MetricsAggregator {
  if (!globalAggregator && config) {
    globalAggregator = new MetricsAggregator(config);
  }
  if (!globalAggregator) {
    throw new Error('MetricsAggregator not initialized. Call getMetricsAggregator with config first.');
  }
  return globalAggregator;
}
