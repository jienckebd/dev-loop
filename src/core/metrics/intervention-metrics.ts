/**
 * Intervention Metrics Tracking
 * 
 * Tracks all automated interventions and their outcomes for analysis
 * and improvement of intervention strategies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { InterventionMetrics, createDefaultInterventionMetrics } from './types';
import { logger } from '../utils/logger';
import { getEventStream, DevLoopEvent } from '../utils/event-stream';
import { EventType } from '../utils/event-stream';

export interface InterventionRecord {
  interventionId: string;
  timestamp: string;
  eventType: EventType;
  issueType: string;
  strategy: string;
  confidence: number;
  success: boolean;
  fixApplied: boolean;
  rollbackRequired: boolean;
  error?: string;
  detectionTimeMs: number;
  fixTimeMs: number;
  validationTimeMs?: number;
}

export class InterventionMetricsTracker {
  private metrics: InterventionMetrics;
  private records: InterventionRecord[] = [];
  private metricsPath: string;

  constructor(metricsPath: string = '.devloop/intervention-metrics.json') {
    this.metricsPath = metricsPath;
    this.metrics = this.loadMetrics();
    
    // Listen to intervention events
    const eventStream = getEventStream();
    eventStream.addListener((event) => {
      if (event.type === 'intervention:triggered' || 
          event.type === 'intervention:successful' || 
          event.type === 'intervention:failed' || 
          event.type === 'intervention:rolled_back') {
        this.handleInterventionEvent(event);
      }
    });
  }

  /**
   * Track a new intervention
   */
  recordIntervention(record: InterventionRecord): void {
    this.records.push(record);
    
    // Update metrics
    this.metrics.totalInterventions++;
    
    if (record.success) {
      this.metrics.successfulInterventions++;
    } else {
      this.metrics.failedInterventions++;
    }

    if (record.rollbackRequired) {
      this.metrics.rolledBackInterventions++;
    }

    // Update success rate
    this.metrics.successRate = this.metrics.totalInterventions > 0
      ? this.metrics.successfulInterventions / this.metrics.totalInterventions
      : 0;

    // Update by issue type
    if (!this.metrics.byIssueType[record.issueType]) {
      this.metrics.byIssueType[record.issueType] = {
        count: 0,
        successful: 0,
        failed: 0,
        rolledBack: 0,
        avgFixTimeMs: 0,
        effectiveness: 0,
      };
    }

    const issueMetrics = this.metrics.byIssueType[record.issueType];
    issueMetrics.count++;
    
    if (record.success) {
      issueMetrics.successful++;
    } else {
      issueMetrics.failed++;
    }

    if (record.rollbackRequired) {
      issueMetrics.rolledBack++;
    }

    // Update average fix time
    const totalFixTime = issueMetrics.avgFixTimeMs * (issueMetrics.count - 1) + record.fixTimeMs;
    issueMetrics.avgFixTimeMs = totalFixTime / issueMetrics.count;

    // Update effectiveness
    const total = issueMetrics.successful + issueMetrics.failed + issueMetrics.rolledBack;
    issueMetrics.effectiveness = total > 0
      ? issueMetrics.successful / total
      : 0;

    // Update by event type
    if (!this.metrics.byEventType[record.eventType]) {
      this.metrics.byEventType[record.eventType] = {
        interventions: 0,
        preventedIssues: 0,
        avgPreventionTimeMs: 0,
      };
    }

    const eventMetrics = this.metrics.byEventType[record.eventType];
    eventMetrics.interventions++;
    
    if (record.success && record.fixApplied) {
      eventMetrics.preventedIssues++;
    }

    // Update average prevention time
    if (record.validationTimeMs) {
      const totalPreventionTime = eventMetrics.avgPreventionTimeMs * (eventMetrics.preventedIssues - 1) + record.validationTimeMs;
      eventMetrics.avgPreventionTimeMs = totalPreventionTime / eventMetrics.preventedIssues;
    }

    // Update timing metrics
    const totalDetection = this.metrics.timing.avgDetectionTimeMs * (this.metrics.totalInterventions - 1) + record.detectionTimeMs;
    this.metrics.timing.avgDetectionTimeMs = totalDetection / this.metrics.totalInterventions;

    const totalFix = this.metrics.timing.avgFixTimeMs * (this.metrics.totalInterventions - 1) + record.fixTimeMs;
    this.metrics.timing.avgFixTimeMs = totalFix / this.metrics.totalInterventions;

    if (record.validationTimeMs) {
      const totalValidation = this.metrics.timing.avgValidationTimeMs * (this.metrics.totalInterventions - 1) + record.validationTimeMs;
      this.metrics.timing.avgValidationTimeMs = totalValidation / this.metrics.totalInterventions;
    }

    this.metrics.timing.totalTimeMs += record.detectionTimeMs + record.fixTimeMs + (record.validationTimeMs || 0);

    // Analyze patterns periodically (every 10 interventions)
    if (this.metrics.totalInterventions % 10 === 0) {
      this.analyzePatterns();
    }

    // Save metrics
    this.saveMetrics();
  }

  /**
   * Record threshold exceeded
   */
  recordThresholdExceeded(eventType: EventType): void {
    this.metrics.thresholds.exceededCount++;
    this.saveMetrics();
  }

  /**
   * Record issue prevented
   */
  recordIssuePrevented(eventType: EventType): void {
    this.metrics.thresholds.preventedCount++;
    this.saveMetrics();
  }

  /**
   * Record false positive
   */
  recordFalsePositive(interventionId: string): void {
    this.metrics.thresholds.falsePositives++;
    
    // Find the record and mark it
    const record = this.records.find(r => r.interventionId === interventionId);
    if (record) {
      // Adjust metrics
      this.metrics.successfulInterventions--;
      this.metrics.failedInterventions++;
      
      const issueMetrics = this.metrics.byIssueType[record.issueType];
      if (issueMetrics) {
        issueMetrics.successful--;
        issueMetrics.failed++;
      }
    }

    this.saveMetrics();
  }

  /**
   * Handle intervention events from event stream
   */
  private handleInterventionEvent(event: DevLoopEvent): void {
    // Check if this is an intervention event
    const interventionEventTypes = [
      'intervention:triggered',
      'intervention:successful',
      'intervention:failed',
      'intervention:rolled_back',
    ] as EventType[];
    
    if (interventionEventTypes.includes(event.type)) {
      // This will be called automatically when intervention events are emitted
      // Actual tracking is handled by recordIntervention() which is called explicitly
      // from the event monitor after intervention execution
    }
  }

  /**
   * Analyze intervention patterns
   */
  private analyzePatterns(): void {
    // Analyze most/least effective strategies
    const strategyStats = new Map<string, { successful: number; total: number }>();

    for (const record of this.records) {
      if (!strategyStats.has(record.strategy)) {
        strategyStats.set(record.strategy, { successful: 0, total: 0 });
      }

      const stats = strategyStats.get(record.strategy)!;
      stats.total++;
      if (record.success) {
        stats.successful++;
      }
    }

    // Calculate success rates
    const strategies: Array<{ strategy: string; successRate: number }> = [];
    for (const [strategy, stats] of strategyStats.entries()) {
      strategies.push({
        strategy,
        successRate: stats.total > 0 ? stats.successful / stats.total : 0,
      });
    }

    // Sort by success rate
    strategies.sort((a, b) => b.successRate - a.successRate);

    this.metrics.patterns.mostEffectiveStrategies = strategies.slice(0, 5);
    this.metrics.patterns.leastEffectiveStrategies = strategies.slice(-5).reverse();

    // Analyze common failure modes
    const failureModes = new Map<string, number>();

    for (const record of this.records) {
      if (!record.success && record.error) {
        const key = `${record.issueType}:${record.error}`;
        failureModes.set(key, (failureModes.get(key) || 0) + 1);
      }
    }

    this.metrics.patterns.commonFailureModes = Array.from(failureModes.entries())
      .map(([key, count]) => {
        const [issueType, failureReason] = key.split(':');
        return { issueType, failureReason, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    this.saveMetrics();
  }

  /**
   * Get current metrics
   */
  getMetrics(): InterventionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get intervention records
   */
  getRecords(limit?: number): InterventionRecord[] {
    const records = [...this.records].reverse(); // Most recent first
    return limit ? records.slice(0, limit) : records;
  }

  /**
   * Get metrics for specific issue type
   */
  getIssueTypeMetrics(issueType: string): InterventionMetrics['byIssueType'][string] | null {
    return this.metrics.byIssueType[issueType] || null;
  }

  /**
   * Get effectiveness analysis
   */
  getEffectivenessAnalysis(): {
    overallSuccessRate: number;
    mostEffectiveStrategies: Array<{ strategy: string; successRate: number }>;
    leastEffectiveStrategies: Array<{ strategy: string; successRate: number }>;
    issueTypesNeedingImprovement: Array<{ issueType: string; effectiveness: number }>;
  } {
    const issueTypesNeedingImprovement = Object.entries(this.metrics.byIssueType)
      .filter(([_, metrics]) => metrics.effectiveness < 0.7)
      .map(([issueType, metrics]) => ({
        issueType,
        effectiveness: metrics.effectiveness,
      }))
      .sort((a, b) => a.effectiveness - b.effectiveness);

    return {
      overallSuccessRate: this.metrics.successRate,
      mostEffectiveStrategies: this.metrics.patterns.mostEffectiveStrategies,
      leastEffectiveStrategies: this.metrics.patterns.leastEffectiveStrategies,
      issueTypesNeedingImprovement,
    };
  }

  /**
   * Load metrics from file
   */
  private loadMetrics(): InterventionMetrics {
    const fullPath = path.resolve(this.metricsPath);
    
    if (!fs.existsSync(fullPath)) {
      return createDefaultInterventionMetrics();
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const data = JSON.parse(content);
      
      // Merge with defaults to ensure all fields exist
      return {
        ...createDefaultInterventionMetrics(),
        ...data,
      };
    } catch (error) {
      logger.warn(`[InterventionMetrics] Failed to load metrics from ${fullPath}, using defaults:`, error);
      return createDefaultInterventionMetrics();
    }
  }

  /**
   * Save metrics to file
   */
  private saveMetrics(): void {
    try {
      const fullPath = path.resolve(this.metricsPath);
      const dir = path.dirname(fullPath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, JSON.stringify(this.metrics, null, 2), 'utf8');
    } catch (error) {
      logger.error(`[InterventionMetrics] Failed to save metrics to ${this.metricsPath}:`, error);
    }
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.metrics = createDefaultInterventionMetrics();
    this.records = [];
    this.saveMetrics();
  }
}

/**
 * Get or create intervention metrics tracker instance
 */
let metricsTrackerInstance: InterventionMetricsTracker | null = null;

export function getInterventionMetricsTracker(metricsPath?: string): InterventionMetricsTracker {
  if (!metricsTrackerInstance) {
    metricsTrackerInstance = new InterventionMetricsTracker(metricsPath);
  }
  return metricsTrackerInstance;
}
