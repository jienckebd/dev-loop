/**
 * Observation Analyzer
 *
 * Analyzes observations to detect patterns, generate reports,
 * and provide actionable insights for dev-loop improvement.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { Observation, ObservationTracker } from '../tracking/observation-tracker';

export interface PatternAnalysis {
  pattern: string;
  count: number;
  affectedProviders: string[];
  affectedProjects: string[];
  severity: 'low' | 'medium' | 'high';
  trend: 'increasing' | 'stable' | 'decreasing';
  suggestedFixes: string[];
}

export interface ProviderAnalysis {
  provider: string;
  totalFailures: number;
  uniquePatterns: number;
  mostCommonPattern: string;
  failureRate: number; // Relative to total failures across providers
  suggestedImprovements: string[];
}

export interface TaskTypeAnalysis {
  taskType: string;
  failureCount: number;
  successCount: number;
  failureRate: number;
  commonErrors: string[];
}

export interface ObservationReport {
  generatedAt: string;
  summary: {
    totalObservations: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    mostAffectedProvider: string | null;
    mostCommonPattern: string | null;
  };
  patterns: PatternAnalysis[];
  providerAnalysis: ProviderAnalysis[];
  recommendations: string[];
  historicalComparison?: {
    previousPeriod: {
      totalObservations: number;
      byType: Record<string, number>;
    };
    trend: 'improving' | 'stable' | 'degrading';
  };
}

export interface AnalyzerOptions {
  prdSetId?: string;
  providerFilter?: string;
  typeFilter?: Observation['type'];
  severityFilter?: Observation['severity'];
  timeRangeStart?: string;
  timeRangeEnd?: string;
}

export class ObservationAnalyzer {
  private observationsPath: string;
  private reportsPath: string;

  constructor(
    observationsPath: string = '.devloop/observations.json',
    reportsPath: string = '.devloop/reports'
  ) {
    this.observationsPath = path.resolve(process.cwd(), observationsPath);
    this.reportsPath = path.resolve(process.cwd(), reportsPath);
  }

  /**
   * Load observations from file
   */
  private async loadObservations(): Promise<Observation[]> {
    try {
      if (await fs.pathExists(this.observationsPath)) {
        const content = await fs.readFile(this.observationsPath, 'utf-8');
        const data = JSON.parse(content);
        return data.observations || [];
      }
    } catch (error) {
      console.warn(`[ObservationAnalyzer] Failed to load observations: ${error}`);
    }
    return [];
  }

  /**
   * Filter observations based on options
   */
  private filterObservations(
    observations: Observation[],
    options: AnalyzerOptions
  ): Observation[] {
    let filtered = [...observations];

    // Filter by PRD set ID (check evidence for PRD: mentions)
    if (options.prdSetId) {
      filtered = filtered.filter(obs =>
        obs.evidence?.some(e => e.includes(`PRD: ${options.prdSetId}`))
      );
    }

    // Filter by provider
    if (options.providerFilter) {
      filtered = filtered.filter(obs =>
        obs.affectedProviders?.includes(options.providerFilter!)
      );
    }

    // Filter by type
    if (options.typeFilter) {
      filtered = filtered.filter(obs => obs.type === options.typeFilter);
    }

    // Filter by severity
    if (options.severityFilter) {
      filtered = filtered.filter(obs => obs.severity === options.severityFilter);
    }

    // Filter by time range
    if (options.timeRangeStart) {
      const startTime = new Date(options.timeRangeStart).getTime();
      filtered = filtered.filter(obs =>
        new Date(obs.lastSeen).getTime() >= startTime
      );
    }

    if (options.timeRangeEnd) {
      const endTime = new Date(options.timeRangeEnd).getTime();
      filtered = filtered.filter(obs =>
        new Date(obs.firstSeen).getTime() <= endTime
      );
    }

    return filtered;
  }

  /**
   * Analyze patterns in observations
   */
  async analyzePatterns(options: AnalyzerOptions = {}): Promise<PatternAnalysis[]> {
    const observations = await this.loadObservations();
    const filtered = this.filterObservations(observations, options);

    // Group by description (pattern)
    const patternMap = new Map<string, Observation[]>();

    for (const obs of filtered) {
      const existing = patternMap.get(obs.description) || [];
      existing.push(obs);
      patternMap.set(obs.description, existing);
    }

    // Analyze each pattern
    const patterns: PatternAnalysis[] = [];

    for (const [pattern, obsGroup] of patternMap) {
      const totalCount = obsGroup.reduce((sum, o) => sum + o.occurrences, 0);
      const providers = new Set<string>();
      const projects = new Set<string>();
      const suggestions = new Set<string>();

      let maxSeverity: 'low' | 'medium' | 'high' = 'low';

      for (const obs of obsGroup) {
        obs.affectedProviders?.forEach(p => providers.add(p));
        obs.affectedProjects.forEach(p => projects.add(p));
        obs.suggestedImprovements.forEach(s => suggestions.add(s));

        if (obs.severity === 'high') maxSeverity = 'high';
        else if (obs.severity === 'medium' && maxSeverity !== 'high') maxSeverity = 'medium';
      }

      // Determine trend based on timestamps
      const sortedByTime = [...obsGroup].sort(
        (a, b) => new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime()
      );

      let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
      if (sortedByTime.length > 1) {
        const recentObs = sortedByTime.slice(-Math.ceil(sortedByTime.length / 2));
        const olderObs = sortedByTime.slice(0, Math.floor(sortedByTime.length / 2));

        const recentCount = recentObs.reduce((sum, o) => sum + o.occurrences, 0);
        const olderCount = olderObs.reduce((sum, o) => sum + o.occurrences, 0);

        if (recentCount > olderCount * 1.2) trend = 'increasing';
        else if (recentCount < olderCount * 0.8) trend = 'decreasing';
      }

      patterns.push({
        pattern,
        count: totalCount,
        affectedProviders: Array.from(providers),
        affectedProjects: Array.from(projects),
        severity: maxSeverity,
        trend,
        suggestedFixes: Array.from(suggestions),
      });
    }

    // Sort by count (most common first)
    return patterns.sort((a, b) => b.count - a.count);
  }

  /**
   * Analyze observations by provider
   */
  async analyzeByProvider(options: AnalyzerOptions = {}): Promise<ProviderAnalysis[]> {
    const observations = await this.loadObservations();
    const filtered = this.filterObservations(observations, options);

    // Group by provider
    const providerMap = new Map<string, Observation[]>();

    for (const obs of filtered) {
      if (!obs.affectedProviders) continue;

      for (const provider of obs.affectedProviders) {
        const existing = providerMap.get(provider) || [];
        existing.push(obs);
        providerMap.set(provider, existing);
      }
    }

    // Calculate total failures across all providers
    const totalFailures = filtered.reduce((sum, o) => sum + o.occurrences, 0);

    // Analyze each provider
    const analyses: ProviderAnalysis[] = [];

    for (const [provider, obsGroup] of providerMap) {
      const providerFailures = obsGroup.reduce((sum, o) => sum + o.occurrences, 0);
      const patterns = new Set(obsGroup.map(o => o.description));
      const suggestions = new Set<string>();

      obsGroup.forEach(obs => {
        obs.suggestedImprovements.forEach(s => suggestions.add(s));
      });

      // Find most common pattern
      const patternCounts = new Map<string, number>();
      for (const obs of obsGroup) {
        const current = patternCounts.get(obs.description) || 0;
        patternCounts.set(obs.description, current + obs.occurrences);
      }

      let mostCommonPattern = '';
      let maxCount = 0;
      for (const [pattern, count] of patternCounts) {
        if (count > maxCount) {
          maxCount = count;
          mostCommonPattern = pattern;
        }
      }

      analyses.push({
        provider,
        totalFailures: providerFailures,
        uniquePatterns: patterns.size,
        mostCommonPattern,
        failureRate: totalFailures > 0 ? providerFailures / totalFailures : 0,
        suggestedImprovements: Array.from(suggestions),
      });
    }

    // Sort by failure rate (worst first)
    return analyses.sort((a, b) => b.failureRate - a.failureRate);
  }

  /**
   * Generate comprehensive observation report
   */
  async generateReport(options: AnalyzerOptions = {}): Promise<ObservationReport> {
    const observations = await this.loadObservations();
    const filtered = this.filterObservations(observations, options);

    // Calculate summary statistics
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const obs of filtered) {
      byType[obs.type] = (byType[obs.type] || 0) + obs.occurrences;
      bySeverity[obs.severity] = (bySeverity[obs.severity] || 0) + obs.occurrences;
    }

    // Get patterns and provider analysis
    const patterns = await this.analyzePatterns(options);
    const providerAnalysis = await this.analyzeByProvider(options);

    // Find most affected provider and common pattern
    let mostAffectedProvider: string | null = null;
    if (providerAnalysis.length > 0) {
      mostAffectedProvider = providerAnalysis[0].provider;
    }

    let mostCommonPattern: string | null = null;
    if (patterns.length > 0) {
      mostCommonPattern = patterns[0].pattern;
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(patterns, providerAnalysis);

    const report: ObservationReport = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalObservations: filtered.reduce((sum, o) => sum + o.occurrences, 0),
        byType,
        bySeverity,
        mostAffectedProvider,
        mostCommonPattern,
      },
      patterns: patterns.slice(0, 10), // Top 10 patterns
      providerAnalysis,
      recommendations,
    };

    return report;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    patterns: PatternAnalysis[],
    providerAnalysis: ProviderAnalysis[]
  ): string[] {
    const recommendations: string[] = [];

    // High severity patterns
    const highSeverity = patterns.filter(p => p.severity === 'high');
    if (highSeverity.length > 0) {
      recommendations.push(
        `CRITICAL: ${highSeverity.length} high-severity patterns detected. ` +
        `Address "${highSeverity[0].pattern}" first.`
      );
    }

    // Increasing trends
    const increasing = patterns.filter(p => p.trend === 'increasing');
    if (increasing.length > 0) {
      recommendations.push(
        `TREND: ${increasing.length} patterns are increasing in frequency. ` +
        `Investigate "${increasing[0].pattern}" to prevent escalation.`
      );
    }

    // Provider-specific issues
    const providerWithMostIssues = providerAnalysis[0];
    if (providerWithMostIssues && providerWithMostIssues.failureRate > 0.5) {
      recommendations.push(
        `PROVIDER: ${providerWithMostIssues.provider} accounts for ` +
        `${(providerWithMostIssues.failureRate * 100).toFixed(0)}% of failures. ` +
        `Consider provider-specific fixes.`
      );
    }

    // Multi-provider patterns
    const multiProvider = patterns.filter(p => p.affectedProviders.length > 1);
    if (multiProvider.length > 0) {
      recommendations.push(
        `FRAMEWORK: ${multiProvider.length} patterns affect multiple providers. ` +
        `These may indicate framework-level issues in dev-loop.`
      );
    }

    // Aggregate suggestions from top patterns
    const topSuggestions = new Set<string>();
    patterns.slice(0, 5).forEach(p => {
      p.suggestedFixes.slice(0, 2).forEach(s => topSuggestions.add(s));
    });

    recommendations.push(...Array.from(topSuggestions).slice(0, 3));

    return recommendations;
  }

  /**
   * Save report to file
   */
  async saveReport(report: ObservationReport, filename?: string): Promise<string> {
    await fs.ensureDir(this.reportsPath);

    const reportFilename = filename || `observation-analysis-${Date.now()}.json`;
    const reportPath = path.join(this.reportsPath, reportFilename);

    await fs.writeJson(reportPath, report, { spaces: 2 });

    return reportPath;
  }

  /**
   * Generate markdown report
   */
  async generateMarkdownReport(options: AnalyzerOptions = {}): Promise<string> {
    const report = await this.generateReport(options);

    let md = `# Observation Analysis Report\n\n`;
    md += `Generated: ${report.generatedAt}\n\n`;

    md += `## Summary\n\n`;
    md += `- **Total Observations**: ${report.summary.totalObservations}\n`;
    md += `- **Most Affected Provider**: ${report.summary.mostAffectedProvider || 'N/A'}\n`;
    md += `- **Most Common Pattern**: ${report.summary.mostCommonPattern || 'N/A'}\n\n`;

    md += `### By Type\n\n`;
    for (const [type, count] of Object.entries(report.summary.byType)) {
      md += `- ${type}: ${count}\n`;
    }
    md += `\n`;

    md += `### By Severity\n\n`;
    for (const [severity, count] of Object.entries(report.summary.bySeverity)) {
      md += `- ${severity}: ${count}\n`;
    }
    md += `\n`;

    md += `## Top Patterns\n\n`;
    for (const pattern of report.patterns.slice(0, 5)) {
      md += `### ${pattern.pattern}\n\n`;
      md += `- **Count**: ${pattern.count}\n`;
      md += `- **Severity**: ${pattern.severity}\n`;
      md += `- **Trend**: ${pattern.trend}\n`;
      md += `- **Providers**: ${pattern.affectedProviders.join(', ')}\n`;
      md += `- **Projects**: ${pattern.affectedProjects.join(', ')}\n`;
      md += `\n**Suggested Fixes:**\n`;
      for (const fix of pattern.suggestedFixes.slice(0, 3)) {
        md += `- ${fix}\n`;
      }
      md += `\n`;
    }

    md += `## Provider Analysis\n\n`;
    for (const provider of report.providerAnalysis) {
      md += `### ${provider.provider}\n\n`;
      md += `- **Total Failures**: ${provider.totalFailures}\n`;
      md += `- **Unique Patterns**: ${provider.uniquePatterns}\n`;
      md += `- **Failure Rate**: ${(provider.failureRate * 100).toFixed(1)}%\n`;
      md += `- **Most Common Pattern**: ${provider.mostCommonPattern}\n\n`;
    }

    md += `## Recommendations\n\n`;
    for (const rec of report.recommendations) {
      md += `- ${rec}\n`;
    }
    md += `\n`;

    return md;
  }

  /**
   * Export observations in various formats
   */
  async exportObservations(
    format: 'json' | 'csv' | 'markdown',
    options: AnalyzerOptions = {}
  ): Promise<string> {
    const observations = await this.loadObservations();
    const filtered = this.filterObservations(observations, options);

    switch (format) {
      case 'json':
        return JSON.stringify(filtered, null, 2);

      case 'csv': {
        const headers = ['id', 'type', 'severity', 'description', 'occurrences',
                        'affectedProjects', 'affectedProviders', 'firstSeen', 'lastSeen'];
        const rows = filtered.map(obs => [
          obs.id,
          obs.type,
          obs.severity,
          `"${obs.description.replace(/"/g, '""')}"`,
          obs.occurrences.toString(),
          `"${obs.affectedProjects.join(';')}"`,
          `"${(obs.affectedProviders || []).join(';')}"`,
          obs.firstSeen,
          obs.lastSeen,
        ].join(','));

        return [headers.join(','), ...rows].join('\n');
      }

      case 'markdown': {
        let md = `# Observations Export\n\n`;
        md += `Exported: ${new Date().toISOString()}\n\n`;
        md += `| Type | Severity | Description | Occurrences | Providers |\n`;
        md += `|------|----------|-------------|-------------|----------|\n`;

        for (const obs of filtered) {
          const desc = obs.description.substring(0, 50) + (obs.description.length > 50 ? '...' : '');
          const providers = (obs.affectedProviders || []).join(', ');
          md += `| ${obs.type} | ${obs.severity} | ${desc} | ${obs.occurrences} | ${providers} |\n`;
        }

        return md;
      }
    }
  }
}

