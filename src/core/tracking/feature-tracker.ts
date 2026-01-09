/**
 * Feature Usage Tracker
 *
 * Tracks which PRD features are used during execution and measures their performance.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { FeatureMetrics } from '../metrics/types';
import { logger } from '../utils/logger';

export interface FeatureUsage {
  featureName: string;
  prdId: string;
  timestamp: string;
  success: boolean;
  duration: number;
  tokens: {
    input: number;
    output: number;
  };
  error?: string;
}

export interface FeatureTrackerData {
  version: string;
  features: Record<string, FeatureMetrics>;
  usageHistory: FeatureUsage[];
}

export class FeatureTracker {
  private metricsPath: string;
  private data: FeatureTrackerData;
  private currentPrdId?: string;

  constructor(metricsPath: string = '.devloop/feature-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.data = this.loadData();
  }

  private loadData(): FeatureTrackerData {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[FeatureTracker] Failed to load data: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      version: '1.0',
      features: {},
      usageHistory: [],
    };
  }

  private saveData(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.metricsPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[FeatureTracker] Failed to save data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start tracking features for a PRD
   */
  startPrdTracking(prdId: string, features: string[]): void {
    this.currentPrdId = prdId;
    // Initialize feature metrics for this PRD if not exists
    for (const featureName of features) {
      if (!this.data.features[featureName]) {
        this.data.features[featureName] = {
          featureName,
          usageCount: 0,
          successCount: 0,
          failureCount: 0,
          avgDuration: 0,
          totalTokens: 0,
          errors: {
            total: 0,
            byType: {},
          },
        };
      }
    }
    this.saveData();
  }

  /**
   * Record feature usage
   */
  recordFeatureUsage(
    featureName: string,
    success: boolean,
    duration: number,
    tokens: { input: number; output: number },
    error?: string
  ): void {
    if (!this.currentPrdId) {
      logger.warn(`[FeatureTracker] Cannot record feature usage: no PRD tracking active`);
      return;
    }

    // Initialize feature if not exists
    if (!this.data.features[featureName]) {
      this.data.features[featureName] = {
        featureName,
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: 0,
        totalTokens: 0,
        errors: {
          total: 0,
          byType: {},
        },
      };
    }

    const featureMetric = this.data.features[featureName];

    // Update metrics
    featureMetric.usageCount++;
    if (success) {
      featureMetric.successCount++;
    } else {
      featureMetric.failureCount++;
      featureMetric.errors.total++;
      if (error) {
        const errorType = error.split(':')[0] || 'unknown';
        featureMetric.errors.byType[errorType] = (featureMetric.errors.byType[errorType] || 0) + 1;
      }
    }

    // Update average duration
    const totalUsages = featureMetric.successCount + featureMetric.failureCount;
    featureMetric.avgDuration = totalUsages > 0
      ? ((featureMetric.avgDuration * (totalUsages - 1)) + duration) / totalUsages
      : duration;

    featureMetric.totalTokens += tokens.input + tokens.output;

    // Record usage history
    const usage: FeatureUsage = {
      featureName,
      prdId: this.currentPrdId,
      timestamp: new Date().toISOString(),
      success,
      duration,
      tokens,
      error,
    };
    this.data.usageHistory.push(usage);

    // Keep only last 1000 usage records to prevent bloat
    if (this.data.usageHistory.length > 1000) {
      this.data.usageHistory = this.data.usageHistory.slice(-1000);
    }

    this.saveData();
  }

  /**
   * Get feature metrics for a specific feature
   */
  getFeatureMetrics(featureName: string): FeatureMetrics | undefined {
    return this.data.features[featureName];
  }

  /**
   * Get all feature metrics
   */
  getAllFeatureMetrics(): Record<string, FeatureMetrics> {
    return this.data.features;
  }

  /**
   * Get feature usage history for a PRD
   */
  getPrdFeatureUsage(prdId: string): FeatureUsage[] {
    return this.data.usageHistory.filter(u => u.prdId === prdId);
  }

  /**
   * Get unused features (features declared but never used)
   */
  getUnusedFeatures(declaredFeatures: string[]): string[] {
    return declaredFeatures.filter(f => !this.data.features[f] || this.data.features[f].usageCount === 0);
  }

  /**
   * Get most used features
   */
  getMostUsedFeatures(limit: number = 10): FeatureMetrics[] {
    return Object.values(this.data.features)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * Get most effective features (highest success rate)
   */
  getMostEffectiveFeatures(limit: number = 10): FeatureMetrics[] {
    return Object.values(this.data.features)
      .filter(f => f.usageCount > 0)
      .map(f => ({
        ...f,
        successRate: f.usageCount > 0 ? f.successCount / f.usageCount : 0,
      }))
      .sort((a, b) => (b as any).successRate - (a as any).successRate)
      .slice(0, limit) as FeatureMetrics[];
  }
}





