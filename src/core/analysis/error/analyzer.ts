/**
 * Error Analyzer
 *
 * Categorizes errors by type, tracks error frequencies, identifies patterns,
 * and suggests fixes based on historical patterns.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';

export type ErrorCategory = 'validation' | 'test' | 'log' | 'timeout' | 'patch' | 'ai' | 'feature' | 'schema' | 'other';
export type ErrorType = string; // Specific error type (e.g., "syntax-error", "test-failure")

export interface ErrorRecord {
  id: string;
  category: ErrorCategory;
  type: ErrorType;
  message: string;
  prdSetId?: string;
  prdId?: string;
  phaseId?: number;
  taskId?: string;
  featureName?: string;
  schemaOperation?: string;
  timestamp: string;
  resolved: boolean;
  resolution?: string;
}

export interface ErrorPattern {
  pattern: string;
  category: ErrorCategory;
  frequency: number;
  suggestedFix: string;
  examples: string[];
}

export interface ErrorAnalysisData {
  version: string;
  errors: ErrorRecord[];
  patterns: ErrorPattern[];
  metrics: {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    byType: Record<string, number>;
    byFeature: Record<string, number>;
    bySchemaOperation: Record<string, number>;
    resolutionRate: number;
  };
}

export class ErrorAnalyzer {
  private dataPath: string;
  private data: ErrorAnalysisData;
  private currentContext?: {
    prdSetId?: string;
    prdId?: string;
    phaseId?: number;
    taskId?: string;
  };

  constructor(dataPath: string = '.devloop/error-analysis.json') {
    this.dataPath = path.resolve(process.cwd(), dataPath);
    this.data = this.loadData();
  }

  private loadData(): ErrorAnalysisData {
    try {
      if (fs.existsSync(this.dataPath)) {
        const content = fs.readFileSync(this.dataPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[ErrorAnalyzer] Failed to load data: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      version: '1.0',
      errors: [],
      patterns: [],
      metrics: {
        total: 0,
        byCategory: {
          'validation': 0,
          'test': 0,
          'log': 0,
          'timeout': 0,
          'patch': 0,
          'ai': 0,
          'feature': 0,
          'schema': 0,
          'other': 0,
        },
        byType: {},
        byFeature: {},
        bySchemaOperation: {},
        resolutionRate: 0,
      },
    };
  }

  private saveData(): void {
    try {
      const dir = path.dirname(this.dataPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[ErrorAnalyzer] Failed to save data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private updateMetrics(): void {
    const metrics = this.data.metrics;
    const errors = this.data.errors;

    // Reset counters
    metrics.total = errors.length;
    metrics.byCategory = {
      'validation': 0,
      'test': 0,
      'log': 0,
      'timeout': 0,
      'patch': 0,
      'ai': 0,
      'feature': 0,
      'schema': 0,
      'other': 0,
    };
    metrics.byType = {};
    metrics.byFeature = {};
    metrics.bySchemaOperation = {};

    let resolvedCount = 0;

    for (const error of errors) {
      metrics.byCategory[error.category] = (metrics.byCategory[error.category] || 0) + 1;
      metrics.byType[error.type] = (metrics.byType[error.type] || 0) + 1;

      if (error.featureName) {
        metrics.byFeature[error.featureName] = (metrics.byFeature[error.featureName] || 0) + 1;
      }

      if (error.schemaOperation) {
        metrics.bySchemaOperation[error.schemaOperation] = (metrics.bySchemaOperation[error.schemaOperation] || 0) + 1;
      }

      if (error.resolved) {
        resolvedCount++;
      }
    }

    metrics.resolutionRate = errors.length > 0 ? resolvedCount / errors.length : 0;
  }

  /**
   * Set current context for error tracking
   */
  setContext(context: {
    prdSetId?: string;
    prdId?: string;
    phaseId?: number;
    taskId?: string;
  }): void {
    this.currentContext = context;
  }

  /**
   * Record an error
   */
  recordError(
    category: ErrorCategory,
    type: ErrorType,
    message: string,
    featureName?: string,
    schemaOperation?: string
  ): string {
    const errorId = `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const error: ErrorRecord = {
      id: errorId,
      category,
      type,
      message: message.substring(0, 1000), // Limit message length
      prdSetId: this.currentContext?.prdSetId,
      prdId: this.currentContext?.prdId,
      phaseId: this.currentContext?.phaseId,
      taskId: this.currentContext?.taskId,
      featureName,
      schemaOperation,
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    this.data.errors.push(error);

    // Keep only last 10000 errors to prevent bloat
    if (this.data.errors.length > 10000) {
      this.data.errors = this.data.errors.slice(-10000);
    }

    this.updateMetrics();
    this.identifyPatterns();
    this.saveData();

    return errorId;
  }

  /**
   * Resolve an error
   */
  resolveError(errorId: string, resolution?: string): void {
    const error = this.data.errors.find(e => e.id === errorId);
    if (error) {
      error.resolved = true;
      if (resolution) {
        error.resolution = resolution;
      }
      this.updateMetrics();
      this.saveData();
    }
  }

  /**
   * Identify common error patterns
   */
  private identifyPatterns(): void {
    const patterns: Record<string, { category: ErrorCategory; messages: string[] }> = {};

    // Group errors by type
    for (const error of this.data.errors) {
      const key = `${error.category}:${error.type}`;
      if (!patterns[key]) {
        patterns[key] = { category: error.category, messages: [] };
      }
      patterns[key].messages.push(error.message);
    }

    // Create pattern objects
    this.data.patterns = Object.entries(patterns)
      .map(([pattern, data]) => ({
        pattern,
        category: data.category,
        frequency: data.messages.length,
        suggestedFix: this.suggestFix(data.category, data.messages[0]),
        examples: data.messages.slice(0, 3), // Keep 3 examples
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 20); // Keep top 20 patterns
  }

  /**
   * Suggest fix based on error category and message
   */
  private suggestFix(category: ErrorCategory, message: string): string {
    // Basic fix suggestions based on category
    const suggestions: Record<ErrorCategory, string> = {
      'validation': 'Check syntax and validate code before applying changes',
      'test': 'Review test failures and fix underlying code issues',
      'log': 'Check application logs for runtime errors',
      'timeout': 'Increase timeout or optimize slow operations',
      'patch': 'Verify patch targets exist and are correct',
      'ai': 'Retry AI request or check API connectivity',
      'feature': 'Review feature implementation and configuration',
      'schema': 'Validate schema structure and dependencies',
      'other': 'Review error message for specific guidance',
    };

    return suggestions[category] || suggestions.other;
  }

  /**
   * Get errors for a PRD
   */
  getPrdErrors(prdId: string): ErrorRecord[] {
    return this.data.errors.filter(e => e.prdId === prdId);
  }

  /**
   * Get errors by category
   */
  getErrorsByCategory(category: ErrorCategory): ErrorRecord[] {
    return this.data.errors.filter(e => e.category === category);
  }

  /**
   * Get common error patterns
   */
  getCommonPatterns(limit: number = 10): ErrorPattern[] {
    return this.data.patterns.slice(0, limit);
  }

  /**
   * Get error metrics
   */
  getMetrics(): ErrorAnalysisData['metrics'] {
    return this.data.metrics;
  }

  /**
   * Get suggested fixes for a specific error
   */
  getSuggestedFixes(errorId: string): string[] {
    const error = this.data.errors.find(e => e.id === errorId);
    if (!error) {
      return [];
    }

    // Find similar errors that were resolved
    const similarErrors = this.data.errors.filter(
      e => e.category === error.category && e.type === error.type && e.resolved && e.resolution
    );

    if (similarErrors.length > 0) {
      return similarErrors.map(e => e.resolution || '').filter(r => r);
    }

    // Fallback to pattern-based suggestion
    const pattern = this.data.patterns.find(p =>
      p.category === error.category && p.pattern.includes(error.type)
    );

    return pattern ? [pattern.suggestedFix] : [];
  }
}





