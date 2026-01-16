/**
 * Correlation Analyzer
 *
 * Analyzes correlations across metrics systems to identify patterns,
 * effectiveness relationships, and optimization opportunities.
 */

import { MetricsAggregator, CorrelationInsights } from './aggregator';
import { BuildMetricsData } from './build';
import { PatternMetricsData } from './pattern';
import { ExecutionIntelligence } from '../analysis/execution-intelligence-collector';

/**
 * Configuration for correlation analysis
 */
export interface CorrelationAnalyzerConfig {
  aggregator: MetricsAggregator;
  minSampleSize?: number; // Minimum samples needed for correlation
  confidenceThreshold?: number; // Minimum confidence for insights (0-1)
}

/**
 * Pattern effectiveness correlation
 */
export interface PatternEffectivenessCorrelation {
  patternId: string;
  patternType: string;
  buildSuccessRate: number;
  executionSuccessRate: number;
  patternMatchRate: number;
  overallImpact: number;
  confidence: number;
  sampleSize: number;
}

/**
 * Provider performance correlation
 */
export interface ProviderPerformanceCorrelation {
  provider: string;
  model?: string;
  buildQuality: number;
  executionSuccess: number;
  patternMatchRate: number;
  avgResponseTime: number;
  costEfficiency: number;
  overallScore: number;
  recommendedFor: string[];
  sampleSize: number;
}

/**
 * Config effectiveness correlation
 */
export interface ConfigEffectivenessCorrelation {
  configKey: string;
  configValue: any;
  buildImprovement: number;
  executionImprovement: number;
  patternImprovement: number;
  overallImpact: number;
  confidence: number;
  sampleSize: number;
}

/**
 * Complete correlation analysis results
 */
export interface CorrelationAnalysis {
  patternEffectiveness: PatternEffectivenessCorrelation[];
  providerPerformance: ProviderPerformanceCorrelation[];
  configEffectiveness: ConfigEffectivenessCorrelation[];
  insights: {
    topPerformingPatterns: string[];
    recommendedProviders: Array<{ provider: string; useCase: string }>;
    configRecommendations: Array<{ key: string; value: any; reason: string }>;
  };
  metadata: {
    analyzedAt: string;
    totalBuilds: number;
    totalPatternMatches: number;
    totalTaskExecutions: number;
  };
}

/**
 * Analyzes correlations across metrics systems
 */
export class CorrelationAnalyzer {
  private aggregator: MetricsAggregator;
  private minSampleSize: number;
  private confidenceThreshold: number;

  constructor(config: CorrelationAnalyzerConfig) {
    this.aggregator = config.aggregator;
    this.minSampleSize = config.minSampleSize || 3;
    this.confidenceThreshold = config.confidenceThreshold || 0.7;
  }

  /**
   * Perform comprehensive correlation analysis across all metrics systems.
   *
   * Analyzes relationships between patterns, providers, and config settings
   * to identify what works best for your project.
   *
   * @returns Complete correlation analysis with insights and recommendations
   */
  async analyze(): Promise<CorrelationAnalysis> {
    const unified = await this.aggregator.loadAll();

    const analysis: CorrelationAnalysis = {
      patternEffectiveness: await this.analyzePatternEffectiveness(unified),
      providerPerformance: await this.analyzeProviderPerformance(unified),
      configEffectiveness: await this.analyzeConfigEffectiveness(unified),
      insights: {
        topPerformingPatterns: [],
        recommendedProviders: [],
        configRecommendations: [],
      },
      metadata: {
        analyzedAt: new Date().toISOString(),
        totalBuilds: unified.build.length,
        totalPatternMatches: unified.pattern.metrics.totalMatches,
        totalTaskExecutions: 0, // Would need to count from execution data
      },
    };

    // Generate insights
    analysis.insights.topPerformingPatterns = analysis.patternEffectiveness
      .filter(p => p.confidence >= this.confidenceThreshold)
      .sort((a, b) => b.overallImpact - a.overallImpact)
      .slice(0, 10)
      .map(p => p.patternId);

    analysis.insights.recommendedProviders = analysis.providerPerformance
      .filter(p => p.sampleSize >= this.minSampleSize)
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 5)
      .map(p => ({
        provider: p.provider,
        useCase: p.recommendedFor.join(', ') || 'general',
      }));

    analysis.insights.configRecommendations = analysis.configEffectiveness
      .filter(c => c.confidence >= this.confidenceThreshold && c.overallImpact > 0.1)
      .sort((a, b) => b.overallImpact - a.overallImpact)
      .slice(0, 5)
      .map(c => ({
        key: c.configKey,
        value: c.configValue,
        reason: `Improves build quality by ${(c.buildImprovement * 100).toFixed(1)}% and execution success by ${(c.executionImprovement * 100).toFixed(1)}%`,
      }));

    return analysis;
  }

  /**
   * Analyze pattern effectiveness across systems
   */
  private async analyzePatternEffectiveness(unified: {
    build: BuildMetricsData[];
    pattern: PatternMetricsData;
    execution: ExecutionIntelligence;
  }): Promise<PatternEffectivenessCorrelation[]> {
    const correlations: PatternEffectivenessCorrelation[] = [];

    if (!unified.pattern.metrics.mostEffectivePatterns) {
      return correlations;
    }

    for (const pattern of unified.pattern.metrics.mostEffectivePatterns) {
      // Find builds that might have used this pattern
      // This is a simplified correlation - in practice, we'd need pattern tracking in builds
      const relatedBuilds = unified.build.filter(b => {
        // Placeholder: would need actual pattern tracking
        return b.status === 'completed';
      });

      const buildSuccessRate = relatedBuilds.length >= this.minSampleSize
        ? relatedBuilds.filter(b => b.status === 'completed').length / relatedBuilds.length
        : 0;

      const executionSuccessRate = pattern.successRate || 0;
      const patternMatchRate = unified.pattern.metrics.matchSuccessRate || 0;

      const overallImpact = (buildSuccessRate + executionSuccessRate + patternMatchRate) / 3;
      const confidence = Math.min(1, relatedBuilds.length / (this.minSampleSize * 2));

      if (relatedBuilds.length >= this.minSampleSize) {
        correlations.push({
          patternId: pattern.patternId,
          patternType: 'error', // Would need to determine from pattern data
          buildSuccessRate,
          executionSuccessRate,
          patternMatchRate,
          overallImpact,
          confidence,
          sampleSize: relatedBuilds.length,
        });
      }
    }

    return correlations.sort((a, b) => b.overallImpact - a.overallImpact);
  }

  /**
   * Analyze provider performance across systems
   */
  private async analyzeProviderPerformance(unified: {
    build: BuildMetricsData[];
    pattern: PatternMetricsData;
    execution: ExecutionIntelligence;
  }): Promise<ProviderPerformanceCorrelation[]> {
    const correlations: ProviderPerformanceCorrelation[] = [];

    if (!unified.execution.configEffectiveness?.providerPerformance) {
      return correlations;
    }

    for (const [provider, perf] of Object.entries(unified.execution.configEffectiveness.providerPerformance)) {
      // Find builds using this provider (would need provider tracking in builds)
      const providerBuilds = unified.build.filter(b => {
        // Placeholder: would need actual provider tracking
        return true;
      });

      const buildQuality = providerBuilds.length >= this.minSampleSize
        ? providerBuilds.reduce((sum, b) => sum + (b.quality?.executabilityScore || 0), 0) / providerBuilds.length
        : 0;

      const patternMatchRate = unified.pattern.metrics.matchSuccessRate || 0;

      // Calculate cost efficiency (lower is better, normalized)
      const costEfficiency = perf.avgResponseTime > 0 ? 1 / (1 + perf.avgResponseTime / 10000) : 0.5;

      const overallScore = (buildQuality * 0.4 + perf.successRate * 0.4 + patternMatchRate * 0.1 + costEfficiency * 0.1);

      const recommendedFor: string[] = [];
      if (perf.preferredForTaskTypes) {
        recommendedFor.push(...perf.preferredForTaskTypes);
      }

      if (providerBuilds.length >= this.minSampleSize) {
        correlations.push({
          provider,
          buildQuality,
          executionSuccess: perf.successRate,
          patternMatchRate,
          avgResponseTime: perf.avgResponseTime,
          costEfficiency,
          overallScore,
          recommendedFor,
          sampleSize: providerBuilds.length,
        });
      }
    }

    return correlations.sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * Analyze config effectiveness (simplified - would need config tracking)
   */
  private async analyzeConfigEffectiveness(unified: {
    build: BuildMetricsData[];
    pattern: PatternMetricsData;
    execution: ExecutionIntelligence;
  }): Promise<ConfigEffectivenessCorrelation[]> {
    // This is a placeholder - actual implementation would need to track
    // config changes and correlate with outcomes
    const correlations: ConfigEffectivenessCorrelation[] = [];

    // Example: analyze if certain configs correlate with better outcomes
    // In practice, this would require tracking config versions with builds

    return correlations;
  }

  /**
   * Get actionable recommendations based on correlation analysis.
   *
   * Provides specific recommendations for patterns, providers, and config
   * based on historical performance data.
   *
   * @returns Recommendations for patterns, providers, and config optimizations
   */
  async getRecommendations(): Promise<{
    patterns: string[];
    providers: Array<{ provider: string; reason: string }>;
    config: Array<{ key: string; value: any; reason: string }>;
  }> {
    const analysis = await this.analyze();

    return {
      patterns: analysis.insights.topPerformingPatterns,
      providers: analysis.insights.recommendedProviders.map(p => ({
        provider: p.provider,
        reason: `Recommended for: ${p.useCase}`,
      })),
      config: analysis.insights.configRecommendations,
    };
  }
}
