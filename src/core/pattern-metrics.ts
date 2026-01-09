/**
 * Pattern Metrics Tracker
 *
 * Tracks pattern learning system usage, match rates, and effectiveness.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from './logger';

export interface PatternMatch {
  id: string;
  patternId: string;
  patternType: string;
  prdId: string;
  phaseId?: number;
  taskId?: string;
  timestamp: string;
  matched: boolean;
  applied: boolean;
  success: boolean;
  guidance?: string;
}

export interface PatternMetricsData {
  version: string;
  matches: PatternMatch[];
  metrics: {
    totalMatches: number;
    matchesByType: Record<string, number>;
    matchSuccessRate: number;
    guidanceEffectiveness: number;
    mostEffectivePatterns: Array<{ patternId: string; successRate: number }>;
  };
}

export class PatternMetrics {
  private metricsPath: string;
  private data: PatternMetricsData;
  private currentPrdId?: string;

  constructor(metricsPath: string = '.devloop/pattern-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.data = this.loadData();
  }

  private loadData(): PatternMetricsData {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[PatternMetrics] Failed to load data: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      version: '1.0',
      matches: [],
      metrics: {
        totalMatches: 0,
        matchesByType: {},
        matchSuccessRate: 0,
        guidanceEffectiveness: 0,
        mostEffectivePatterns: [],
      },
    };
  }

  private saveData(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.metricsPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[PatternMetrics] Failed to save data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private updateMetrics(): void {
    const matches = this.data.matches;
    const metrics = this.data.metrics;

    metrics.totalMatches = matches.length;

    // Reset counters
    metrics.matchesByType = {};

    let successfulMatches = 0;
    let guidanceApplied = 0;
    let guidanceSuccessful = 0;

    const patternSuccess: Record<string, { total: number; successful: number }> = {};

    for (const match of matches) {
      // Count by type
      metrics.matchesByType[match.patternType] = (metrics.matchesByType[match.patternType] || 0) + 1;

      // Track success
      if (match.success) {
        successfulMatches++;
      }

      // Track guidance effectiveness
      if (match.applied && match.guidance) {
        guidanceApplied++;
        if (match.success) {
          guidanceSuccessful++;
        }
      }

      // Track pattern-specific success
      if (!patternSuccess[match.patternId]) {
        patternSuccess[match.patternId] = { total: 0, successful: 0 };
      }
      patternSuccess[match.patternId].total++;
      if (match.success) {
        patternSuccess[match.patternId].successful++;
      }
    }

    // Calculate rates
    metrics.matchSuccessRate = matches.length > 0 ? successfulMatches / matches.length : 0;
    metrics.guidanceEffectiveness = guidanceApplied > 0 ? guidanceSuccessful / guidanceApplied : 0;

    // Calculate most effective patterns
    metrics.mostEffectivePatterns = Object.entries(patternSuccess)
      .map(([patternId, stats]) => ({
        patternId,
        successRate: stats.total > 0 ? stats.successful / stats.total : 0,
      }))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 10);
  }

  /**
   * Start tracking patterns for a PRD
   */
  startPrdTracking(prdId: string): void {
    this.currentPrdId = prdId;
  }

  /**
   * Record a pattern match
   */
  recordPatternMatch(
    patternId: string,
    patternType: string,
    matched: boolean,
    applied: boolean,
    success: boolean,
    guidance?: string,
    phaseId?: number,
    taskId?: string
  ): string {
    if (!this.currentPrdId) {
      logger.warn(`[PatternMetrics] Cannot record pattern match: no PRD tracking active`);
      return '';
    }

    const match: PatternMatch = {
      id: `${this.currentPrdId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      patternId,
      patternType,
      prdId: this.currentPrdId,
      phaseId,
      taskId,
      timestamp: new Date().toISOString(),
      matched,
      applied,
      success,
      guidance,
    };

    this.data.matches.push(match);

    // Keep only last 10000 matches to prevent bloat
    if (this.data.matches.length > 10000) {
      this.data.matches = this.data.matches.slice(-10000);
    }

    this.updateMetrics();
    this.saveData();

    return match.id;
  }

  /**
   * Get pattern matches for a PRD
   */
  getPrdMatches(prdId: string): PatternMatch[] {
    return this.data.matches.filter(m => m.prdId === prdId);
  }

  /**
   * Get metrics
   */
  getMetrics(): PatternMetricsData['metrics'] {
    return this.data.metrics;
  }
}





