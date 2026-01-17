/**
 * JSON Parsing Metrics
 *
 * Tracks OutputFixingParser performance across providers.
 * Monitors fix attempts, success rates, and common error patterns.
 */

import { logger } from '../utils/logger';

export interface ProviderJsonMetrics {
  attempts: number;
  successes: number;
  failures: number;
  programmaticFixes: number;
  aiFixes: number;
  avgAttemptsToFix: number;
}

export interface JsonParsingMetrics {
  totalAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  programmaticFixes: number;
  aiFixes: number;
  byProvider: Map<string, ProviderJsonMetrics>;
  byErrorType: Map<string, { attempts: number; successes: number }>;
}

/**
 * Singleton tracker for JSON parsing metrics
 */
class JsonParsingMetricsTracker {
  private metrics: JsonParsingMetrics = {
    totalAttempts: 0,
    successfulFixes: 0,
    failedFixes: 0,
    programmaticFixes: 0,
    aiFixes: 0,
    byProvider: new Map(),
    byErrorType: new Map(),
  };

  /**
   * Track a fix attempt starting
   */
  trackFixAttempt(provider: string, errorType: string): void {
    this.metrics.totalAttempts++;

    // Update provider metrics
    const providerMetrics = this.getOrCreateProviderMetrics(provider);
    providerMetrics.attempts++;
    this.metrics.byProvider.set(provider, providerMetrics);

    // Update error type metrics
    const errorMetrics = this.metrics.byErrorType.get(errorType) || {
      attempts: 0,
      successes: 0,
    };
    errorMetrics.attempts++;
    this.metrics.byErrorType.set(errorType, errorMetrics);
  }

  /**
   * Track a successful fix
   */
  trackFixSuccess(
    provider: string,
    errorType: string,
    attemptsNeeded: number,
    method: 'programmatic' | 'ai'
  ): void {
    this.metrics.successfulFixes++;

    if (method === 'programmatic') {
      this.metrics.programmaticFixes++;
    } else {
      this.metrics.aiFixes++;
    }

    // Update provider metrics
    const providerMetrics = this.getOrCreateProviderMetrics(provider);
    providerMetrics.successes++;
    if (method === 'programmatic') {
      providerMetrics.programmaticFixes++;
    } else {
      providerMetrics.aiFixes++;
    }
    // Update running average
    if (providerMetrics.successes > 0) {
      providerMetrics.avgAttemptsToFix =
        (providerMetrics.avgAttemptsToFix * (providerMetrics.successes - 1) + attemptsNeeded) /
        providerMetrics.successes;
    }
    this.metrics.byProvider.set(provider, providerMetrics);

    // Update error type metrics
    const errorMetrics = this.metrics.byErrorType.get(errorType);
    if (errorMetrics) {
      errorMetrics.successes++;
      this.metrics.byErrorType.set(errorType, errorMetrics);
    }

    logger.debug(
      `[JsonParsingMetrics] Fix success: ${provider}/${errorType} via ${method} (attempt ${attemptsNeeded})`
    );
  }

  /**
   * Track a failed fix (all attempts exhausted)
   */
  trackFixFailure(provider: string, errorType: string): void {
    this.metrics.failedFixes++;

    const providerMetrics = this.getOrCreateProviderMetrics(provider);
    providerMetrics.failures++;
    this.metrics.byProvider.set(provider, providerMetrics);

    logger.debug(`[JsonParsingMetrics] Fix failed: ${provider}/${errorType}`);
  }

  /**
   * Get current metrics
   */
  getMetrics(): JsonParsingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get overall success rate
   */
  getSuccessRate(): number {
    if (this.metrics.totalAttempts === 0) return 0;
    return this.metrics.successfulFixes / this.metrics.totalAttempts;
  }

  /**
   * Get success rate by provider
   */
  getProviderSuccessRate(provider: string): number {
    const metrics = this.metrics.byProvider.get(provider);
    if (!metrics || metrics.attempts === 0) return 0;
    return metrics.successes / metrics.attempts;
  }

  /**
   * Get success rate by error type
   */
  getErrorTypeSuccessRate(errorType: string): number {
    const metrics = this.metrics.byErrorType.get(errorType);
    if (!metrics || metrics.attempts === 0) return 0;
    return metrics.successes / metrics.attempts;
  }

  /**
   * Get summary for logging/reporting
   */
  getSummary(): string {
    const successRate = (this.getSuccessRate() * 100).toFixed(1);
    const providerSummaries: string[] = [];

    this.metrics.byProvider.forEach((metrics, provider) => {
      const rate = ((metrics.successes / metrics.attempts) * 100).toFixed(1);
      providerSummaries.push(`${provider}: ${rate}% (${metrics.successes}/${metrics.attempts})`);
    });

    return `JSON Parsing: ${successRate}% success (${this.metrics.successfulFixes}/${this.metrics.totalAttempts})
  Programmatic: ${this.metrics.programmaticFixes}, AI: ${this.metrics.aiFixes}
  By Provider: ${providerSummaries.join(', ') || 'none'}`;
  }

  /**
   * Reset metrics (for testing)
   */
  reset(): void {
    this.metrics = {
      totalAttempts: 0,
      successfulFixes: 0,
      failedFixes: 0,
      programmaticFixes: 0,
      aiFixes: 0,
      byProvider: new Map(),
      byErrorType: new Map(),
    };
  }

  private getOrCreateProviderMetrics(provider: string): ProviderJsonMetrics {
    return (
      this.metrics.byProvider.get(provider) || {
        attempts: 0,
        successes: 0,
        failures: 0,
        programmaticFixes: 0,
        aiFixes: 0,
        avgAttemptsToFix: 0,
      }
    );
  }
}

// Export singleton instance
export const jsonParsingMetrics = new JsonParsingMetricsTracker();

// Export class for testing
export { JsonParsingMetricsTracker };
