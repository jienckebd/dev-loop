/**
 * Issue Classifier
 * 
 * Classifies event types into actionable categories and determines
 * confidence levels for automated intervention.
 */

import { DevLoopEvent, EventType } from '../utils/event-stream';
import { logger } from '../utils/logger';

export interface IssueClassification {
  issueType: string;
  category: 'json-parsing' | 'task-execution' | 'boundary-enforcement' | 'validation' | 'contribution-mode' | 'ipc' | 'agent' | 'health' | 'other';
  confidence: number;  // 0-1 confidence level
  severity: 'low' | 'medium' | 'high' | 'critical';
  pattern: string;     // Pattern description
  suggestedAction: string;
  context: Record<string, unknown>;
}

export class IssueClassifier {
  /**
   * Classify an issue based on event type and history
   */
  async classify(eventType: EventType, events: DevLoopEvent[]): Promise<IssueClassification> {
    // Get classification strategy based on event type
    const strategy = this.getClassificationStrategy(eventType);
    
    return strategy(events);
  }

  /**
   * Get classification strategy for event type
   */
  private getClassificationStrategy(eventType: EventType): (events: DevLoopEvent[]) => IssueClassification {
    // JSON parsing events
    if (eventType.startsWith('json:')) {
      return this.classifyJsonParsing;
    }

    // Task events
    if (eventType.startsWith('task:')) {
      return this.classifyTaskExecution;
    }

    // File filtering events
    if (eventType.startsWith('file:')) {
      return this.classifyBoundaryEnforcement;
    }

    // Validation events
    if (eventType.startsWith('validation:')) {
      return this.classifyValidation;
    }

    // Contribution mode issues
    if (eventType === 'contribution:issue_detected') {
      return this.classifyContributionMode;
    }

    // IPC events
    if (eventType.startsWith('ipc:')) {
      return this.classifyIPC;
    }

    // Agent events
    if (eventType.startsWith('agent:')) {
      return this.classifyAgent;
    }

    // Health events
    if (eventType.startsWith('health:')) {
      return this.classifyHealth;
    }

    // Default classification
    return this.classifyGeneric;
  }

  /**
   * Classify JSON parsing issues
   */
  private classifyJsonParsing(events: DevLoopEvent[]): IssueClassification {
    const failures = events.filter(e => e.type === 'json:parse_failed');
    const retries = events.filter(e => e.type === 'json:parse_retry');
    const aiFallback = events.filter(e => e.type === 'json:ai_fallback_success' || e.type === 'json:ai_fallback_failed');

    const totalAttempts = failures.length + retries.length;
    const hasRetryPattern = retries.length > 0;
    const hasAIFallbackPattern = aiFallback.length > 0;

    // High confidence if consistent failure pattern
    let confidence = 0.85;
    if (hasRetryPattern) confidence = 0.75;
    if (hasAIFallbackPattern) confidence = 0.65;

    // Extract failure reasons from event data
    const failureReasons: string[] = [];
    for (const event of failures) {
      if (event.data.reason && typeof event.data.reason === 'string') {
        failureReasons.push(event.data.reason);
      }
    }

    const mostCommonReason = this.getMostCommon(failureReasons);

    return {
      issueType: 'json-parsing-failure',
      category: 'json-parsing',
      confidence,
      severity: totalAttempts >= 5 ? 'high' : 'medium',
      pattern: `JSON parsing failures (${totalAttempts} attempts, ${mostCommonReason || 'unknown reason'})`,
      suggestedAction: 'enhance-json-parser',
      context: {
        totalAttempts,
        failureCount: failures.length,
        retryCount: retries.length,
        aiFallbackCount: aiFallback.length,
        mostCommonReason,
      },
    };
  }

  /**
   * Classify task execution issues
   */
  private classifyTaskExecution(events: DevLoopEvent[]): IssueClassification {
    const blocked = events.filter(e => e.type === 'task:blocked');
    const failed = events.filter(e => e.type === 'task:failed');

    const taskIds = new Set(events.map(e => e.taskId).filter(Boolean));
    const isSingleTask = taskIds.size === 1;
    
    // Higher confidence for single task blocking (clear issue)
    let confidence = isSingleTask ? 0.80 : 0.70;
    
    // Extract failure reasons
    const reasons: string[] = [];
    for (const event of [...blocked, ...failed]) {
      if (event.data.reason && typeof event.data.reason === 'string') {
        reasons.push(event.data.reason);
      } else if (event.data.error && typeof event.data.error === 'string') {
        reasons.push(event.data.error);
      }
    }

    const mostCommonReason = this.getMostCommon(reasons);
    const hasRetryPattern = events.some(e => e.data.retryCount && (e.data.retryCount as number) > 0);

    return {
      issueType: blocked.length > 0 ? 'task-blocked' : 'task-failed',
      category: 'task-execution',
      confidence: hasRetryPattern ? 0.75 : confidence,
      severity: 'high',
      pattern: `${blocked.length > 0 ? 'Blocked' : 'Failed'} task(s) (${taskIds.size} unique, ${mostCommonReason || 'unknown reason'})`,
      suggestedAction: 'unblock-task',
      context: {
        blockedCount: blocked.length,
        failedCount: failed.length,
        taskIds: Array.from(taskIds),
        mostCommonReason,
        hasRetryPattern,
      },
    };
  }

  /**
   * Classify boundary enforcement issues
   */
  private classifyBoundaryEnforcement(events: DevLoopEvent[]): IssueClassification {
    const filtered = events.filter(e => e.type === 'file:filtered');
    const violations = events.filter(e => e.type === 'file:boundary_violation');
    const unauthorized = events.filter(e => e.type === 'change:unauthorized');

    // Violations are critical - high confidence for fix
    if (violations.length > 0 || unauthorized.length > 0) {
      return {
        issueType: 'boundary-violation',
        category: 'boundary-enforcement',
        confidence: 0.90, // Critical - immediate fix required
        severity: 'critical',
        pattern: `Boundary violations detected (${violations.length} violations, ${unauthorized.length} unauthorized)`,
        suggestedAction: 'enhance-boundary-enforcement',
        context: {
          violationCount: violations.length,
          unauthorizedCount: unauthorized.length,
        },
      };
    }

    // High filtering rate suggests module confusion
    const targetModules = new Set(events.map(e => e.targetModule).filter(Boolean));
    const hasMultipleModules = targetModules.size > 1;

    return {
      issueType: 'excessive-file-filtering',
      category: 'boundary-enforcement',
      confidence: hasMultipleModules ? 0.75 : 0.70,
      severity: filtered.length >= 10 ? 'high' : 'medium',
      pattern: `Excessive file filtering (${filtered.length} files, ${targetModules.size} modules)`,
      suggestedAction: 'enhance-boundary-warnings',
      context: {
        filteredCount: filtered.length,
        targetModules: Array.from(targetModules),
        hasMultipleModules,
      },
    };
  }

  /**
   * Classify validation issues
   */
  private classifyValidation(events: DevLoopEvent[]): IssueClassification {
    const failed = events.filter(e => e.type === 'validation:failed');
    const errors = events.filter(e => e.type === 'validation:error_with_suggestion');

    // Extract error categories
    const categories: string[] = [];
    for (const event of failed) {
      if (event.data.category && typeof event.data.category === 'string') {
        categories.push(event.data.category);
      }
    }

    const mostCommonCategory = this.getMostCommon(categories);
    const hasSuggestions = errors.length > 0;

    return {
      issueType: 'validation-failure',
      category: 'validation',
      confidence: hasSuggestions ? 0.75 : 0.70,
      severity: 'medium',
      pattern: `Validation failures (${failed.length} failures, ${mostCommonCategory || 'various categories'})`,
      suggestedAction: 'enhance-validation-gates',
      context: {
        failureCount: failed.length,
        suggestionCount: errors.length,
        mostCommonCategory,
      },
    };
  }

  /**
   * Classify contribution mode issues
   */
  private classifyContributionMode(events: DevLoopEvent[]): IssueClassification {
    const issueTypes = new Set<string>();
    const context: Record<string, unknown> = {};
    
    for (const event of events) {
      if (event.data.issueType && typeof event.data.issueType === 'string') {
        issueTypes.add(event.data.issueType);
        
        // Extract additional context from event data
        if (event.data.degradationRate !== undefined) {
          context.degradationRate = event.data.degradationRate;
        }
        if (event.data.successRateTrend !== undefined) {
          context.successRateTrend = event.data.successRateTrend;
        }
        if (event.data.efficiencyRatio !== undefined) {
          context.efficiencyRatio = event.data.efficiencyRatio;
        }
        if (event.data.missingFileRate !== undefined) {
          context.missingFileRate = event.data.missingFileRate;
        }
        if (event.data.blockedTasks !== undefined) {
          context.blockedTasks = event.data.blockedTasks;
        }
        if (event.data.circularDependencies !== undefined) {
          context.circularDependencies = event.data.circularDependencies;
        }
        if (event.data.avgWaitTime !== undefined) {
          context.avgWaitTime = event.data.avgWaitTime;
        }
        if (event.data.successRate !== undefined) {
          context.successRate = event.data.successRate;
        }
        if (event.data.immediateFailureRate !== undefined) {
          context.immediateFailureRate = event.data.immediateFailureRate;
        }
        if (event.data.falsePositiveRate !== undefined) {
          context.falsePositiveRate = event.data.falsePositiveRate;
        }
        if (event.data.blockedValidChanges !== undefined) {
          context.blockedValidChanges = event.data.blockedValidChanges;
        }
        if (event.data.errorRate !== undefined) {
          context.errorRate = event.data.errorRate;
        }
        if (event.data.timeoutRate !== undefined) {
          context.timeoutRate = event.data.timeoutRate;
        }
        if (event.data.qualityTrend !== undefined) {
          context.qualityTrend = event.data.qualityTrend;
        }
        if (event.data.stalledPhases !== undefined) {
          context.stalledPhases = event.data.stalledPhases;
        }
        if (event.data.avgProgressRate !== undefined) {
          context.avgProgressRate = event.data.avgProgressRate;
        }
        if (event.data.stallDuration !== undefined) {
          context.stallDuration = event.data.stallDuration;
        }
        if (event.data.matchToApplicationRate !== undefined) {
          context.matchToApplicationRate = event.data.matchToApplicationRate;
        }
        if (event.data.applicationSuccessRate !== undefined) {
          context.applicationSuccessRate = event.data.applicationSuccessRate;
        }
        if (event.data.recurringPatternRate !== undefined) {
          context.recurringPatternRate = event.data.recurringPatternRate;
        }
        if (event.data.validationTimeTrend !== undefined) {
          context.validationTimeTrend = event.data.validationTimeTrend;
        }
        if (event.data.inconsistencyRate !== undefined) {
          context.inconsistencyRate = event.data.inconsistencyRate;
        }
        if (event.data.memoryUsageTrend !== undefined) {
          context.memoryUsageTrend = event.data.memoryUsageTrend;
        }
        if (event.data.diskUsageTrend !== undefined) {
          context.diskUsageTrend = event.data.diskUsageTrend;
        }
      }
    }

    const issueTypeList = Array.from(issueTypes);
    const primaryIssueType = issueTypeList[0] || 'unknown';

    // High confidence for contribution mode issues (clear patterns)
    // Adjust confidence based on issue type severity
    let confidence = 0.85;
    if (issueTypeList.length > 1) {
      confidence = 0.75; // Multiple issue types reduce confidence
    }
    
    // Adjust confidence based on issue type
    const criticalIssues = ['boundary-violations', 'change:unauthorized', 'task-dependency-deadlock'];
    if (criticalIssues.includes(primaryIssueType)) {
      confidence = 0.90; // Higher confidence for critical issues
    }
    
    // Adjust severity based on issue type
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'high';
    if (criticalIssues.includes(primaryIssueType)) {
      severity = 'critical';
    } else if (['code-generation-degradation', 'ai-provider-instability'].includes(primaryIssueType)) {
      severity = 'high';
    } else if (['context-window-inefficiency', 'validation-gate-over-blocking', 'pattern-learning-inefficacy'].includes(primaryIssueType)) {
      severity = 'medium';
    }

    return {
      issueType: 'contribution:issue_detected', // Use consistent issue type for strategy lookup
      category: 'contribution-mode',
      confidence,
      severity,
      pattern: `Contribution mode issue: ${primaryIssueType} (${issueTypeList.length} types detected)`,
      suggestedAction: `fix-${primaryIssueType.replace(/-/g, '-')}`,
      context: {
        issueTypes: issueTypeList,
        primaryIssueType, // Store actual issue type in context
        ...context,
      },
    };
  }

  /**
   * Classify IPC connection issues
   */
  private classifyIPC(events: DevLoopEvent[]): IssueClassification {
    const failed = events.filter(e => e.type === 'ipc:connection_failed');
    const retries = events.filter(e => e.type === 'ipc:connection_retry');

    const hasRetryPattern = retries.length > 0;
    const isConsistent = failed.length >= 3;

    return {
      issueType: 'ipc-connection-failure',
      category: 'ipc',
      confidence: isConsistent ? 0.85 : 0.70,
      severity: 'high',
      pattern: `IPC connection failures (${failed.length} failures, ${retries.length} retries)`,
      suggestedAction: 'enhance-ipc-connection',
      context: {
        failureCount: failed.length,
        retryCount: retries.length,
        hasRetryPattern,
        isConsistent,
      },
    };
  }

  /**
   * Classify agent errors
   */
  private classifyAgent(events: DevLoopEvent[]): IssueClassification {
    const errors = events.filter(e => e.type === 'agent:error');
    
    // Lower confidence - agent errors are complex
    return {
      issueType: 'agent-error',
      category: 'agent',
      confidence: 0.60, // Lower confidence - requires analysis
      severity: 'medium',
      pattern: `Agent errors (${errors.length} errors)`,
      suggestedAction: 'enhance-error-handling',
      context: {
        errorCount: errors.length,
      },
    };
  }

  /**
   * Classify health check issues
   */
  private classifyHealth(events: DevLoopEvent[]): IssueClassification {
    const failed = events.filter(e => e.type === 'health:check_failed');
    
    // Low confidence - health issues require investigation
    return {
      issueType: 'health-check-failure',
      category: 'health',
      confidence: 0.50, // Low confidence - requires investigation
      severity: 'high',
      pattern: `Health check failures (${failed.length} failures)`,
      suggestedAction: 'investigate-site-health',
      context: {
        failureCount: failed.length,
      },
    };
  }

  /**
   * Generic classification for unknown event types
   */
  private classifyGeneric(events: DevLoopEvent[]): IssueClassification {
    return {
      issueType: 'unknown-issue',
      category: 'other',
      confidence: 0.50, // Low confidence for unknown patterns
      severity: 'medium',
      pattern: `Unknown issue pattern (${events.length} events)`,
      suggestedAction: 'analyze-pattern',
      context: {
        eventCount: events.length,
        eventTypes: Array.from(new Set(events.map(e => e.type))),
      },
    };
  }

  /**
   * Get most common value from array
   */
  private getMostCommon(values: string[]): string | null {
    if (values.length === 0) return null;

    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }

    let maxCount = 0;
    let mostCommon: string | null = null;

    for (const value of Array.from(counts.keys())) {
      const count = counts.get(value) || 0;
      if (count > maxCount) {
        maxCount = count;
        mostCommon = value;
      }
    }

    return mostCommon;
  }
}
