import { Task } from '../../types';
import { PrdContext } from '../prd/coordination/context';
import { FailureInfo, FailureAnalysis } from '../analysis/error/failure-analyzer';

export class AutonomousTaskGenerator {
  private maxRetries: number;

  constructor(maxRetries: number = 3) {
    this.maxRetries = maxRetries;
  }

  /**
   * Generate fix tasks from failure analysis
   */
  async generateFixTasks(
    analysis: FailureAnalysis,
    context: PrdContext
  ): Promise<Task[]> {
    const tasks: Task[] = [];

    for (const failure of analysis.failures) {
      // Check if we've already tried this fix
      if (this.hasTriedSimilarFix(failure, context)) {
        // Escalate - try a different approach
        const escalatedTask = this.generateEscalatedTask(failure, context);
        tasks.push(escalatedTask);
      } else {
        // Standard fix task
        const task = this.generateFixTask(failure, context);
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * Generate a standard fix task
   */
  private generateFixTask(
    failure: FailureInfo,
    context: PrdContext
  ): Task {
    // Build comprehensive task description with all context
    const description = [
      `## Error`,
      failure.rootCause,
      '',
      `## Category`,
      failure.category,
      '',
      `## Affected Files`,
      failure.affectedFiles.length > 0
        ? failure.affectedFiles.map((f: any) => `- ${f.path}: ${f.purpose}`).join('\n')
        : 'No specific files identified',
      '',
      `## Suggested Fix`,
      failure.suggestedFix,
      '',
      `## Context from Previous Iterations`,
      this.formatPreviousContext(context),
      '',
    ];

    // Add working patterns to apply
    const relevantPatterns = context.knowledge.workingPatterns.filter(
      p => this.isRelevant(p, failure)
    );
    if (relevantPatterns.length > 0) {
      description.push(
        `## Working Patterns to Apply`,
        ...relevantPatterns.map((p: any) => `- ${p.description}`),
        ''
      );
    }

    // Add failed approaches to avoid
    const relevantFailedApproaches = context.knowledge.failedApproaches.filter(
      a => this.isRelevant(a, failure)
    );
    if (relevantFailedApproaches.length > 0) {
      description.push(
        `## Approaches That Failed (DO NOT REPEAT)`,
        ...relevantFailedApproaches.map((a: any) => `- ${a.description}: ${a.reason}`),
        ''
      );
    }

    // Add learnings
    if (failure.learnings.length > 0) {
      description.push(
        `## Learnings from This Failure`,
        ...failure.learnings.map(l => `- ${l}`),
        ''
      );
    }

    return {
      id: `fix-${failure.testId}-${context.currentIteration}`,
      title: `Fix: ${failure.rootCause.substring(0, 60)}${failure.rootCause.length > 60 ? '...' : ''}`,
      description: description.join('\n'),
      status: 'pending',
      priority: 'critical',
      details: JSON.stringify({
        failureInfo: failure,
        iteration: context.currentIteration,
        previousAttempts: this.getAttemptCount(failure.testId, context),
      }),
    };
  }

  /**
   * Generate escalated task after multiple failures
   */
  private generateEscalatedTask(
    failure: FailureInfo,
    context: PrdContext
  ): Task {
    const failedApproaches = context.knowledge.failedApproaches.filter(
      a => a.description.includes(failure.testId)
    );

    return {
      id: `investigate-${failure.testId}-${context.currentIteration}`,
      title: `Investigate: Root cause of ${failure.testId}`,
      description: `
Multiple fix attempts have failed. Investigate the root cause.

## Test ID
${failure.testId}

## Current Root Cause
${failure.rootCause}

## Failed Approaches
${failedApproaches.length > 0
  ? failedApproaches.map(a => `- ${a.description}: ${a.reason}`).join('\n')
  : 'No previous approaches recorded'}

## Instructions
1. Read the relevant files completely
2. Trace the execution flow from test to implementation
3. Identify the actual root cause (not just symptoms)
4. Check for similar patterns in the codebase
5. Propose a comprehensive fix that addresses the root cause

## Affected Files
${failure.affectedFiles.map((f: any) => `- ${f.path}: ${f.purpose}`).join('\n')}

## Context
This is attempt ${this.getAttemptCount(failure.testId, context) + 1} for this test.
Previous attempts have not resolved the issue.
      `.trim(),
      status: 'pending',
      priority: 'critical',
      details: JSON.stringify({
        failureInfo: failure,
        iteration: context.currentIteration,
        previousAttempts: this.getAttemptCount(failure.testId, context),
        escalated: true,
      }),
    };
  }

  /**
   * Check if we've already tried a similar fix
   */
  private hasTriedSimilarFix(failure: FailureInfo, context: PrdContext): boolean {
    const attemptCount = this.getAttemptCount(failure.testId, context);

    // If we've tried multiple times, escalate
    if (attemptCount >= this.maxRetries) {
      return true;
    }

    // Check if we've tried fixing the same root cause before
    const similarFailures = context.knowledge.failedApproaches.filter(
      a => a.description.includes(failure.testId) &&
           a.reason.toLowerCase().includes(failure.rootCause.toLowerCase().substring(0, 30))
    );

    return similarFailures.length > 0;
  }

  /**
   * Get attempt count for a test
   */
  private getAttemptCount(testId: string, context: PrdContext): number {
    const test = context.tests.find(t => t.id === testId);
    return test?.attempts || 0;
  }

  /**
   * Check if a pattern is relevant to a failure
   */
  private isRelevant(pattern: any, failure: FailureInfo): boolean {
    // Simple relevance check - could be enhanced
    const patternText = (pattern.description || '').toLowerCase();
    const failureText = failure.rootCause.toLowerCase();

    // Check for keyword overlap
    const keywords = ['error', 'fail', 'issue', 'bug', 'fix'];
    const patternHasKeywords = keywords.some(k => patternText.includes(k));
    const failureHasKeywords = keywords.some(k => failureText.includes(k));

    // Check file overlap
    const patternFiles = pattern.context || '';
    const failureFiles = failure.affectedFiles.map(f => f.path).join(' ');

    return patternHasKeywords && failureHasKeywords ||
           patternFiles && failureFiles && patternFiles.includes(failureFiles.substring(0, 20));
  }

  /**
   * Format previous context for task description
   */
  private formatPreviousContext(context: PrdContext): string {
    if (context.iterations.length === 0) {
      return 'No previous iterations';
    }

    const recent = context.iterations.slice(-3); // Last 3 iterations
    const sections: string[] = [];

    for (const iter of recent) {
      sections.push(
        `Iteration ${iter.iteration}:`,
        `  - Tests: ${iter.testsPassed}/${iter.testsRun} passing`,
        `  - Tasks executed: ${iter.tasksExecuted.length}`,
        `  - Errors: ${iter.errors.length > 0 ? iter.errors.slice(0, 2).join(', ') : 'none'}`
      );
    }

    return sections.join('\n');
  }
}
