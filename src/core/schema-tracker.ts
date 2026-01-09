/**
 * Schema Operation Tracker
 *
 * Tracks all schema operations (create, update, delete, validate, parse) and measures their performance.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { SchemaOperation, SchemaMetrics } from './hierarchical-metrics';
import { logger } from './logger';

export interface SchemaTrackerData {
  version: string;
  operations: SchemaOperation[];
  metrics: SchemaMetrics;
}

export class SchemaTracker {
  private metricsPath: string;
  private data: SchemaTrackerData;
  private currentPrdId?: string;

  constructor(metricsPath: string = '.devloop/schema-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.data = this.loadData();
  }

  private loadData(): SchemaTrackerData {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[SchemaTracker] Failed to load data: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      version: '1.0',
      operations: [],
      metrics: {
        totalOperations: 0,
        operationsByType: {},
        operationsBySchemaType: {},
        successRate: 0,
        avgDuration: 0,
        errors: {
          total: 0,
          byOperation: {},
          bySchemaType: {},
        },
      },
    };
  }

  private saveData(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.metricsPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[SchemaTracker] Failed to save data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private updateMetrics(): void {
    const metrics = this.data.metrics;
    const operations = this.data.operations;

    metrics.totalOperations = operations.length;

    // Reset counters
    metrics.operationsByType = {};
    metrics.operationsBySchemaType = {};
    metrics.errors.byOperation = {};
    metrics.errors.bySchemaType = {};

    let totalDuration = 0;
    let successfulOps = 0;
    let errorCount = 0;

    for (const op of operations) {
      // Count by operation type
      metrics.operationsByType[op.operation] = (metrics.operationsByType[op.operation] || 0) + 1;

      // Count by schema type
      metrics.operationsBySchemaType[op.schemaType] = (metrics.operationsBySchemaType[op.schemaType] || 0) + 1;

      // Track duration
      totalDuration += op.duration;

      // Track success
      if (op.success) {
        successfulOps++;
      } else {
        errorCount++;
        metrics.errors.total++;
        metrics.errors.byOperation[op.operation] = (metrics.errors.byOperation[op.operation] || 0) + 1;
        metrics.errors.bySchemaType[op.schemaType] = (metrics.errors.bySchemaType[op.schemaType] || 0) + 1;
      }
    }

    // Calculate averages
    metrics.successRate = operations.length > 0 ? successfulOps / operations.length : 0;
    metrics.avgDuration = operations.length > 0 ? totalDuration / operations.length : 0;
  }

  /**
   * Start tracking schema operations for a PRD
   */
  startPrdTracking(prdId: string): void {
    this.currentPrdId = prdId;
  }

  /**
   * Record a schema operation
   */
  recordOperation(operation: SchemaOperation): void {
    if (!this.currentPrdId) {
      logger.warn(`[SchemaTracker] Cannot record schema operation: no PRD tracking active`);
      return;
    }

    // Add PRD ID to operation if not present
    const opWithPrd: SchemaOperation = {
      ...operation,
      timestamp: operation.timestamp || new Date().toISOString(),
    };

    this.data.operations.push(opWithPrd);

    // Keep only last 5000 operations to prevent bloat
    if (this.data.operations.length > 5000) {
      this.data.operations = this.data.operations.slice(-5000);
    }

    this.updateMetrics();
    this.saveData();
  }

  /**
   * Record schema parsing operation
   */
  recordParse(schemaType: string, schemaId: string, duration: number, success: boolean, error?: string): void {
    this.recordOperation({
      operation: 'parse',
      schemaType,
      schemaId,
      duration,
      success,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record schema validation operation
   */
  recordValidate(schemaType: string, schemaId: string, duration: number, success: boolean, error?: string): void {
    this.recordOperation({
      operation: 'validate',
      schemaType,
      schemaId,
      duration,
      success,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record schema creation operation
   */
  recordCreate(schemaType: string, schemaId: string, duration: number, success: boolean, error?: string): void {
    this.recordOperation({
      operation: 'create',
      schemaType,
      schemaId,
      duration,
      success,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record schema update operation
   */
  recordUpdate(schemaType: string, schemaId: string, duration: number, success: boolean, error?: string): void {
    this.recordOperation({
      operation: 'update',
      schemaType,
      schemaId,
      duration,
      success,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record schema deletion operation
   */
  recordDelete(schemaType: string, schemaId: string, duration: number, success: boolean, error?: string): void {
    this.recordOperation({
      operation: 'delete',
      schemaType,
      schemaId,
      duration,
      success,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get schema metrics
   */
  getMetrics(): SchemaMetrics {
    return this.data.metrics;
  }

  /**
   * Get operations for a specific PRD
   */
  getPrdOperations(prdId: string): SchemaOperation[] {
    // Note: We'd need to store prdId in operations to filter by PRD
    // For now, return all operations
    return this.data.operations;
  }

  /**
   * Get operations by type
   */
  getOperationsByType(operation: 'create' | 'update' | 'delete' | 'validate' | 'parse'): SchemaOperation[] {
    return this.data.operations.filter(op => op.operation === operation);
  }

  /**
   * Get operations by schema type
   */
  getOperationsBySchemaType(schemaType: string): SchemaOperation[] {
    return this.data.operations.filter(op => op.schemaType === schemaType);
  }
}





