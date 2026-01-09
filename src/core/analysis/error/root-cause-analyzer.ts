import { ExecutionOrderAnalyzer, ExecutionOrderIssue } from '../code/execution-order-analyzer';
import { ComponentInteractionAnalyzer, InteractionIssue } from '../code/component-interaction-analyzer';

export interface FixAttempt {
  taskId: string;
  description: string;
  outcome: 'success' | 'partial' | 'failed';
  errorMessage?: string;
  fixedPaths?: string[];
  remainingPaths?: string[];
}

export interface RootCauseAnalysis {
  isPartialFix: boolean;
  partialFixReason?: string;
  fixedPaths: string[];
  brokenPaths: string[];
  comprehensiveFix: string;
  confidence: number;
}

export class RootCauseAnalyzer {
  private executionOrderAnalyzer: ExecutionOrderAnalyzer;
  private componentInteractionAnalyzer: ComponentInteractionAnalyzer;
  private debug: boolean;

  constructor(
    executionOrderAnalyzer: ExecutionOrderAnalyzer,
    componentInteractionAnalyzer: ComponentInteractionAnalyzer,
    debug: boolean = false
  ) {
    this.executionOrderAnalyzer = executionOrderAnalyzer;
    this.componentInteractionAnalyzer = componentInteractionAnalyzer;
    this.debug = debug;
  }

  /**
   * Analyze why a fix attempt was partial or failed
   */
  analyzePartialFix(
    fixAttempt: FixAttempt,
    currentError: string,
    errorContext?: {
      framework?: string;
      components?: string[];
      targetFiles?: string[];
    }
  ): RootCauseAnalysis {
    const analysis: RootCauseAnalysis = {
      isPartialFix: fixAttempt.outcome === 'partial',
      fixedPaths: fixAttempt.fixedPaths || [],
      brokenPaths: fixAttempt.remainingPaths || [],
      comprehensiveFix: '',
      confidence: 0.7,
    };

    // Analyze why fix was partial
    if (fixAttempt.outcome === 'partial') {
      analysis.partialFixReason = this.identifyPartialFixReason(
        fixAttempt,
        currentError,
        errorContext
      );
      analysis.comprehensiveFix = this.suggestComprehensiveFix(
        fixAttempt,
        currentError,
        analysis.partialFixReason,
        errorContext
      );
    }

    return analysis;
  }

  private identifyPartialFixReason(
    fixAttempt: FixAttempt,
    currentError: string,
    context?: { framework?: string; components?: string[] }
  ): string {
    const lowerError = currentError.toLowerCase();
    const lowerDescription = fixAttempt.description.toLowerCase();

    // Check for path-specific issues
    if (fixAttempt.fixedPaths && fixAttempt.remainingPaths) {
      const hasIEF = lowerError.includes('ief') || lowerDescription.includes('ief');
      const hasDirect = lowerDescription.includes('direct') || lowerDescription.includes('service');

      if (hasIEF && hasDirect) {
        return 'Fix works for direct service calls but not via IEF widget. IEF widget has separate execution path that bypasses the fix.';
      }

      if (fixAttempt.remainingPaths.some(p => p.toLowerCase().includes('widget'))) {
        return 'Fix works for one code path but not widget-based paths. Widgets have separate execution flow.';
      }
    }

    // Check for component-specific issues
    if (context?.components && context.components.length > 1) {
      const componentInError = context.components.find(c => lowerError.includes(c.toLowerCase()));
      const componentInFix = context.components.find(c => lowerDescription.includes(c.toLowerCase()));

      if (componentInError && componentInFix && componentInError !== componentInFix) {
        return `Fix addressed ${componentInFix} but error occurs via ${componentInError}. Different components have different execution paths.`;
      }
    }

    // Check for timing/order issues
    if (lowerError.includes('before') || lowerError.includes('after') || lowerError.includes('order')) {
      return 'Fix addressed validation but not execution order. Handler execution order needs adjustment.';
    }

    // Generic partial fix reason
    return 'Fix works for one execution path but not others. Multiple code paths need to be addressed.';
  }

  private suggestComprehensiveFix(
    fixAttempt: FixAttempt,
    currentError: string,
    reason: string,
    context?: { framework?: string; components?: string[]; targetFiles?: string[] }
  ): string {
    const suggestions: string[] = [];

    // If IEF path is broken
    if (reason.includes('IEF') || reason.includes('widget')) {
      if (context?.framework === 'drupal') {
        suggestions.push('Add form submit handler that clears IEF form state before IEF save handler runs');
        suggestions.push('Use array_unshift() on #ief_element_submit array to ensure handler runs first');
        suggestions.push('Clear feed type entities from IEF form state in submit handler with high priority');
      } else {
        suggestions.push('Handle widget save separately from direct service calls');
        suggestions.push('Add widget-specific validation or state clearing');
      }
    }

    // If execution order issue
    if (reason.includes('execution order') || reason.includes('handler')) {
      if (context?.framework === 'drupal') {
        suggestions.push('Adjust form submit handler order using array_unshift() or weight');
        suggestions.push('Ensure clear/validation handler runs before save handlers');
        suggestions.push('Check #ief_element_submit array order for IEF widgets');
      } else {
        suggestions.push('Adjust handler/event listener execution order');
        suggestions.push('Add explicit priority/weight to handlers');
      }
    }

    // If component interaction issue
    if (reason.includes('component') && context?.components && context.components.length > 1) {
      suggestions.push('Address all component interaction paths, not just one');
      suggestions.push('Add validation/clearing at component boundaries');
      suggestions.push('Ensure state exists before component interactions');
    }

    // Generic comprehensive fix
    if (suggestions.length === 0) {
      suggestions.push('Apply fix to all code paths, not just the direct path');
      suggestions.push('Add validation/state checking at entry points for all paths');
      suggestions.push('Consider refactoring to unify code paths if possible');
    }

    return suggestions.join('\n- ');
  }

  /**
   * Analyze multiple fix attempts to identify patterns
   */
  analyzeFixAttempts(fixAttempts: FixAttempt[]): {
    pattern: string;
    suggestedApproach: string;
  } {
    const partialFixes = fixAttempts.filter(f => f.outcome === 'partial');
    const failedFixes = fixAttempts.filter(f => f.outcome === 'failed');

    if (partialFixes.length > 0) {
      // Check for common pattern in partial fixes
      const hasIEFPattern = partialFixes.some(f =>
        f.description.toLowerCase().includes('ief') || f.remainingPaths?.some(p => p.toLowerCase().includes('ief'))
      );

      if (hasIEFPattern) {
        return {
          pattern: 'Partial fixes consistently fail for IEF/widget paths',
          suggestedApproach: 'Focus on IEF form state management and handler execution order. Add handler that clears IEF state before IEF save handlers run.',
        };
      }

      const hasOrderPattern = partialFixes.some(f =>
        f.description.toLowerCase().includes('order') || f.description.toLowerCase().includes('handler')
      );

      if (hasOrderPattern) {
        return {
          pattern: 'Partial fixes suggest execution order issues',
          suggestedApproach: 'Investigate handler execution order. Use array_unshift() or weight adjustments to ensure handlers run in correct sequence.',
        };
      }
    }

    if (failedFixes.length > 0 && partialFixes.length === 0) {
      return {
        pattern: 'All fix attempts failed completely',
        suggestedApproach: 'Error may require investigation before fixing. Add debug logging to understand execution flow and component interactions.',
      };
    }

    return {
      pattern: 'Mixed fix outcomes',
      suggestedApproach: 'Analyze which paths work vs which fail. Apply comprehensive fix addressing all execution paths.',
    };
  }

  /**
   * Generate root cause analysis prompt for AI
   */
  generateRootCausePrompt(analysis: RootCauseAnalysis, fixAttempt?: FixAttempt): string {
    const sections: string[] = [
      '## ROOT CAUSE ANALYSIS',
      '',
    ];

    if (analysis.isPartialFix) {
      sections.push('**Partial Fix Detected**: The previous fix attempt was only partially successful.');
      sections.push('');
      sections.push(`**Why Partial**: ${analysis.partialFixReason}`);
      sections.push('');
      sections.push('**Fixed Paths**:');
      for (const path of analysis.fixedPaths) {
        sections.push(`- ${path}`);
      }
      sections.push('');
      sections.push('**Broken Paths**:');
      for (const path of analysis.brokenPaths) {
        sections.push(`- ${path}`);
      }
      sections.push('');
      sections.push('**Comprehensive Fix Needed**:');
      sections.push(analysis.comprehensiveFix);
    } else {
      sections.push('**Fix Analysis**: Previous fix attempt failed completely.');
      if (fixAttempt?.errorMessage) {
        sections.push(`**Error**: ${fixAttempt.errorMessage}`);
      }
    }

    return sections.join('\n');
  }
}
