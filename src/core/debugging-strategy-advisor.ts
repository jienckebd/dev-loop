import { FrameworkPatternLibrary, FrameworkPattern } from './framework-pattern-library';

export type ErrorType = 'timing-order' | 'missing-state' | 'component-interaction' | 'simple-bug' | 'unknown';
export type DebuggingStrategy = 'add-logging' | 'fix-root-cause' | 'add-validation' | 'refactor-interaction' | 'investigate';

export interface ErrorClassification {
  errorType: ErrorType;
  confidence: number; // 0-1
  reasoning: string;
  suggestedStrategy: DebuggingStrategy;
  strategyReasoning: string;
  needsInvestigation: boolean;
  investigationSteps?: string[];
}

export class DebuggingStrategyAdvisor {
  private patternLibrary: FrameworkPatternLibrary;
  private debug: boolean;

  constructor(patternLibrary: FrameworkPatternLibrary, debug: boolean = false) {
    this.patternLibrary = patternLibrary;
    this.debug = debug;
  }

  /**
   * Classify error and suggest debugging strategy
   */
  classifyError(
    errorText: string,
    errorContext?: {
      framework?: string;
      components?: string[];
      hasMultipleComponents?: boolean;
      previousFixAttempts?: number;
    }
  ): ErrorClassification {
    const lowerError = errorText.toLowerCase();
    const framework = errorContext?.framework || this.detectFramework(errorText);
    const patterns = this.patternLibrary.matchPatterns(errorText, framework);

    // Classify error type
    const classification = this.classifyErrorType(errorText, patterns, errorContext);

    // Determine strategy
    const strategy = this.determineStrategy(classification, patterns, errorContext);

    // Check if investigation is needed
    const needsInvestigation = this.needsInvestigation(classification, errorContext);

    return {
      errorType: classification.type,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      suggestedStrategy: strategy.strategy,
      strategyReasoning: strategy.reasoning,
      needsInvestigation,
      investigationSteps: needsInvestigation ? this.generateInvestigationSteps(classification, patterns) : undefined,
    };
  }

  private classifyErrorType(
    errorText: string,
    patterns: FrameworkPattern[],
    context?: { components?: string[]; hasMultipleComponents?: boolean }
  ): { type: ErrorType; confidence: number; reasoning: string } {
    const lowerError = errorText.toLowerCase();
    let type: ErrorType = 'unknown';
    let confidence = 0.5;
    const reasons: string[] = [];

    // Check for timing/order issues
    const timingKeywords = ['before', 'after', 'order', 'timing', 'execution order', 'handler order', 'priority'];
    const hasTimingKeywords = timingKeywords.some(kw => lowerError.includes(kw));
    const hasExecutionOrderPattern = patterns.some(p => p.patternType === 'execution-order');

    if (hasTimingKeywords || hasExecutionOrderPattern) {
      type = 'timing-order';
      confidence = 0.8;
      reasons.push('Error mentions timing/order keywords or matches execution-order pattern');
    }

    // Check for missing state
    const missingStateKeywords = ['without', 'does not exist', 'not found', 'missing', 'not yet', 'not created'];
    const hasMissingState = missingStateKeywords.some(kw => lowerError.includes(kw));
    const hasLifecyclePattern = patterns.some(p => p.patternType === 'lifecycle');

    if (hasMissingState || hasLifecyclePattern) {
      if (type === 'unknown' || confidence < 0.7) {
        type = 'missing-state';
        confidence = 0.75;
        reasons.push('Error indicates missing state/entity/bundle');
      }
    }

    // Check for component interaction
    const hasMultipleComponents = context?.hasMultipleComponents ||
                                 (context?.components && context.components.length > 1) ||
                                 this.detectMultipleComponents(errorText);
    const hasInteractionPattern = patterns.some(p => p.patternType === 'interaction');

    if (hasMultipleComponents || hasInteractionPattern) {
      // Only override if we haven't already classified as timing-order with high confidence
      if (type === 'unknown' || (type !== 'timing-order' && confidence < 0.7)) {
        type = 'component-interaction';
        confidence = 0.8;
        reasons.push('Error involves multiple components or matches interaction pattern');
      }
    }

    // Check for simple bugs (syntax, typos, simple logic errors)
    const simpleBugKeywords = ['syntax', 'parse error', 'undefined', 'null pointer', 'type error'];
    const hasSimpleBug = simpleBugKeywords.some(kw => lowerError.includes(kw)) &&
                        !hasTimingKeywords &&
                        !hasMultipleComponents;

    if (hasSimpleBug && type === 'unknown') {
      type = 'simple-bug';
      confidence = 0.7;
      reasons.push('Error appears to be a simple syntax or type error');
    }

    return {
      type,
      confidence,
      reasoning: reasons.join('; ') || 'Unable to classify error type',
    };
  }

  private determineStrategy(
    classification: { type: ErrorType; confidence: number },
    patterns: FrameworkPattern[],
    context?: { previousFixAttempts?: number }
  ): { strategy: DebuggingStrategy; reasoning: string } {
    const { type } = classification;
    const hasPreviousAttempts = (context?.previousFixAttempts || 0) > 0;

    switch (type) {
      case 'timing-order':
        if (hasPreviousAttempts) {
          return {
            strategy: 'add-logging',
            reasoning: 'Timing/order issue with previous fix attempts - need to verify execution order with logging',
          };
        }
        return {
          strategy: 'investigate',
          reasoning: 'Timing/order issues require investigation to understand execution flow before fixing',
        };

      case 'missing-state':
        if (hasPreviousAttempts) {
          return {
            strategy: 'add-validation',
            reasoning: 'Missing state issue with previous attempts - add validation to prevent or handle missing state',
          };
        }
        return {
          strategy: 'fix-root-cause',
          reasoning: 'Missing state issue - fix root cause by ensuring state exists before use',
        };

      case 'component-interaction':
        if (hasPreviousAttempts) {
          return {
            strategy: 'refactor-interaction',
            reasoning: 'Component interaction issue with previous attempts - may need to refactor interaction pattern',
          };
        }
        return {
          strategy: 'investigate',
          reasoning: 'Component interaction issues require investigation to understand interaction flow',
        };

      case 'simple-bug':
        return {
          strategy: 'fix-root-cause',
          reasoning: 'Simple bug - can fix directly without investigation',
        };

      default:
        return {
          strategy: 'investigate',
          reasoning: 'Unknown error type - investigation needed to understand issue',
        };
    }
  }

  private needsInvestigation(
    classification: { type: ErrorType },
    context?: { previousFixAttempts?: number; components?: string[] }
  ): boolean {
    const { type } = classification;
    const hasPreviousAttempts = (context?.previousFixAttempts || 0) > 0;
    const hasMultipleComponents = context?.components && context.components.length > 1;

    // Always investigate timing/order and component interaction issues
    if (type === 'timing-order' || type === 'component-interaction') {
      return true;
    }

    // Investigate if previous fix attempts failed
    const currentType = classification.type;
    if (hasPreviousAttempts && (currentType === 'missing-state' || currentType === 'component-interaction')) {
      return true;
    }

    // Investigate if multiple components involved
    if (hasMultipleComponents && currentType !== 'simple-bug') {
      return true;
    }

    return false;
  }

  private generateInvestigationSteps(
    classification: { type: ErrorType },
    patterns: FrameworkPattern[]
  ): string[] {
    const steps: string[] = [];
    const { type } = classification;

    if (type === 'timing-order') {
      steps.push('Add debug logging to verify execution order');
      steps.push('Check handler/function execution sequence');
      if (patterns.some(p => p.id === 'drupal-form-handler-order')) {
        steps.push('Log form submit handler array order');
        steps.push('Verify handler weight/priority settings');
      }
    }

    if (type === 'component-interaction') {
      steps.push('Identify all components involved in the interaction');
      steps.push('Map component interaction flow');
      steps.push('Add logging at component boundaries');
      if (patterns.some(p => p.id === 'drupal-widget-entity-save')) {
        steps.push('Check if widget save handler is being called');
        steps.push('Verify form state before widget save');
      }
    }

    if (type === 'missing-state') {
      steps.push('Add validation to check if state exists');
      steps.push('Log state at key points in execution');
      steps.push('Verify state creation timing');
    }

    return steps;
  }

  private detectFramework(errorText: string): string | undefined {
    const lower = errorText.toLowerCase();
    if (lower.includes('drupal') || lower.includes('hook_') || lower.includes('form_alter')) {
      return 'drupal';
    }
    if (lower.includes('react') || lower.includes('useEffect') || lower.includes('component')) {
      return 'react';
    }
    return undefined;
  }

  private detectMultipleComponents(errorText: string): boolean {
    const lower = errorText.toLowerCase();
    const componentKeywords = ['IEF', 'widget', 'entity', 'form', 'handler', 'subscriber', 'processor'];
    const matches = componentKeywords.filter(kw => lower.includes(kw.toLowerCase()));
    return matches.length >= 2;
  }

  /**
   * Generate debug code snippet for investigation
   */
  generateDebugCode(
    classification: ErrorClassification,
    targetFile?: string,
    framework?: string
  ): string {
    const { errorType, suggestedStrategy } = classification;

    if (suggestedStrategy !== 'add-logging' && suggestedStrategy !== 'investigate') {
      return '';
    }

    if (framework === 'drupal' || errorType === 'timing-order') {
      return `// Add debug logging to verify execution order
\\Drupal::logger('module_name')->debug('EXECUTION ORDER: @function called at @time', [
  '@function' => __FUNCTION__,
  '@time' => microtime(TRUE),
]);

// For form handlers, log the handler array
if (isset($form['#submit'])) {
  \\Drupal::logger('module_name')->debug('Form submit handlers: @handlers', [
    '@handlers' => print_r(array_keys($form['#submit']), TRUE),
  ]);
}`;
    }

    if (errorType === 'component-interaction') {
      return `// Add debug logging at component boundaries
\\Drupal::logger('module_name')->debug('COMPONENT INTERACTION: @component @action', [
  '@component' => 'ComponentName',
  '@action' => 'action description',
]);`;
    }

    return `// Add debug logging
error_log('DEBUG: ' . __FUNCTION__ . ' called at ' . microtime(TRUE));`;
  }
}
