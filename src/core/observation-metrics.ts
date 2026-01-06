/**
 * Observation Metrics Tracker
 *
 * Tracks observation types, frequency, severity, and resolution rates.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from './logger';

export type ObservationType = 'failure-pattern' | 'efficiency-issue' | 'validation-trend' | 'token-spike' | 'other';
export type ObservationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Observation {
  id: string;
  type: ObservationType;
  severity: ObservationSeverity;
  prdId: string;
  phaseId?: number;
  taskId?: string;
  timestamp: string;
  description: string;
  resolved: boolean;
  resolvedAt?: string;
  resolution?: string;
}

export interface ObservationMetricsData {
  version: string;
  observations: Observation[];
  metrics: {
    total: number;
    byType: Record<ObservationType, number>;
    bySeverity: Record<ObservationSeverity, number>;
    resolutionRate: number;
    mostCommon: Array<{ type: ObservationType; count: number }>;
  };
}

export class ObservationMetrics {
  private metricsPath: string;
  private data: ObservationMetricsData;
  private currentPrdId?: string;

  constructor(metricsPath: string = '.devloop/observation-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.data = this.loadData();
  }

  private loadData(): ObservationMetricsData {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[ObservationMetrics] Failed to load data: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      version: '1.0',
      observations: [],
      metrics: {
        total: 0,
        byType: {
          'failure-pattern': 0,
          'efficiency-issue': 0,
          'validation-trend': 0,
          'token-spike': 0,
          'other': 0,
        },
        bySeverity: {
          'low': 0,
          'medium': 0,
          'high': 0,
          'critical': 0,
        },
        resolutionRate: 0,
        mostCommon: [],
      },
    };
  }

  private saveData(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.metricsPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[ObservationMetrics] Failed to save data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private updateMetrics(): void {
    const observations = this.data.observations;
    const metrics = this.data.metrics;

    metrics.total = observations.length;

    // Reset counters
    metrics.byType = {
      'failure-pattern': 0,
      'efficiency-issue': 0,
      'validation-trend': 0,
      'token-spike': 0,
      'other': 0,
    };
    metrics.bySeverity = {
      'low': 0,
      'medium': 0,
      'high': 0,
      'critical': 0,
    };

    let resolvedCount = 0;

    for (const obs of observations) {
      metrics.byType[obs.type] = (metrics.byType[obs.type] || 0) + 1;
      metrics.bySeverity[obs.severity] = (metrics.bySeverity[obs.severity] || 0) + 1;
      if (obs.resolved) {
        resolvedCount++;
      }
    }

    // Calculate resolution rate
    metrics.resolutionRate = observations.length > 0 ? resolvedCount / observations.length : 0;

    // Calculate most common observations
    const typeCounts: Record<string, number> = {};
    for (const obs of observations) {
      typeCounts[obs.type] = (typeCounts[obs.type] || 0) + 1;
    }
    metrics.mostCommon = Object.entries(typeCounts)
      .map(([type, count]) => ({ type: type as ObservationType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Start tracking observations for a PRD
   */
  startPrdTracking(prdId: string): void {
    this.currentPrdId = prdId;
  }

  /**
   * Record an observation
   */
  recordObservation(
    type: ObservationType,
    severity: ObservationSeverity,
    description: string,
    phaseId?: number,
    taskId?: string
  ): string {
    if (!this.currentPrdId) {
      logger.warn(`[ObservationMetrics] Cannot record observation: no PRD tracking active`);
      return '';
    }

    const observation: Observation = {
      id: `${this.currentPrdId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      prdId: this.currentPrdId,
      phaseId,
      taskId,
      timestamp: new Date().toISOString(),
      description,
      resolved: false,
    };

    this.data.observations.push(observation);

    // Keep only last 10000 observations to prevent bloat
    if (this.data.observations.length > 10000) {
      this.data.observations = this.data.observations.slice(-10000);
    }

    this.updateMetrics();
    this.saveData();

    return observation.id;
  }

  /**
   * Resolve an observation
   */
  resolveObservation(observationId: string, resolution?: string): void {
    const observation = this.data.observations.find(obs => obs.id === observationId);
    if (observation) {
      observation.resolved = true;
      observation.resolvedAt = new Date().toISOString();
      if (resolution) {
        observation.resolution = resolution;
      }
      this.updateMetrics();
      this.saveData();
    }
  }

  /**
   * Get observations for a PRD
   */
  getPrdObservations(prdId: string): Observation[] {
    return this.data.observations.filter(obs => obs.prdId === prdId);
  }

  /**
   * Get unresolved observations
   */
  getUnresolvedObservations(prdId?: string): Observation[] {
    const observations = prdId
      ? this.data.observations.filter(obs => obs.prdId === prdId)
      : this.data.observations;
    return observations.filter(obs => !obs.resolved);
  }

  /**
   * Get metrics
   */
  getMetrics(): ObservationMetricsData['metrics'] {
    return this.data.metrics;
  }
}

