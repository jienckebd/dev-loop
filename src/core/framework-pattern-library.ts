/**
 * Framework-Specific Pattern Library
 * 
 * Understands framework-specific execution patterns to help identify
 * common issues like form handler ordering, hook execution order, etc.
 */

export interface FrameworkPattern {
  id: string;
  framework: string;
  patternType: 'execution-order' | 'lifecycle' | 'interaction' | 'state';
  name: string;
  description: string;
  errorIndicators: string[]; // Keywords that suggest this pattern
  solutionGuidance: string;
  exampleErrors: string[];
}

export class FrameworkPatternLibrary {
  private patterns: Map<string, FrameworkPattern[]> = new Map();

  constructor() {
    this.loadPatterns();
  }

  private loadPatterns(): void {
    // Drupal-specific patterns
    const drupalPatterns: FrameworkPattern[] = [
      {
        id: 'drupal-form-handler-order',
        framework: 'drupal',
        patternType: 'execution-order',
        name: 'Drupal Form Handler Execution Order',
        description: 'Form submit handlers execute in order based on #submit array order and weight. Handlers added later or with higher weight execute first.',
        errorIndicators: [
          'form submit',
          'submit handler',
          '#submit',
          'handler order',
          'before',
          'after',
          'IEF',
          'inline entity form',
        ],
        solutionGuidance: 'Use array_unshift() to add handlers at the beginning, or set explicit weight/priority. For IEF, use #ief_element_submit array.',
        exampleErrors: [
          'Attempt to create a field without a bundle',
          'Entity not found during form submission',
          'Handler runs after entity is saved',
        ],
      },
      {
        id: 'drupal-hook-execution-order',
        framework: 'drupal',
        patternType: 'execution-order',
        name: 'Drupal Hook Execution Order',
        description: 'Hooks execute in module weight order. hook_alter() hooks run after base hooks. Priority can be set in hook_module_implements_alter().',
        errorIndicators: [
          'hook_alter',
          'module weight',
          'hook execution',
          'alter hook',
        ],
        solutionGuidance: 'Adjust module weight in system.module.yml or use hook_module_implements_alter() to change priority.',
        exampleErrors: [
          'Configuration not applied',
          'Alter not working',
          'Module runs too early/late',
        ],
      },
      {
        id: 'drupal-entity-lifecycle',
        framework: 'drupal',
        patternType: 'lifecycle',
        name: 'Drupal Entity Lifecycle',
        description: 'Entity fields must exist on bundles before they can be used. Bundles must exist before fields can be created. preSave() runs before save, postSave() after.',
        errorIndicators: [
          'without a bundle',
          'bundle does not exist',
          'field does not exist',
          'preSave',
          'postSave',
          'entity lifecycle',
        ],
        solutionGuidance: 'Ensure bundles exist before creating fields. Use preSave() for validation, postSave() for operations that need saved entity.',
        exampleErrors: [
          'Attempt to create a field without a bundle',
          'Bundle does not exist',
          'Field not found on entity',
        ],
      },
      {
        id: 'drupal-widget-entity-save',
        framework: 'drupal',
        patternType: 'interaction',
        name: 'Widget to Entity Save Interaction',
        description: 'Form widgets (like IEF) save entities during form submission. This can trigger entity lifecycle hooks before the main form entity is saved.',
        errorIndicators: [
          'IEF',
          'inline entity form',
          'widget save',
          'entity save during form',
          'feeds_item',
        ],
        solutionGuidance: 'Clear widget entities from form state before save, or delay widget entity save until after main entity is saved. Use form submit handler with high priority.',
        exampleErrors: [
          'Attempt to create a field without a bundle',
          'Entity not found',
          'Widget entity saved before parent',
        ],
      },
      {
        id: 'drupal-event-subscriber-order',
        framework: 'drupal',
        patternType: 'execution-order',
        name: 'Drupal Event Subscriber Order',
        description: 'Event subscribers execute in priority order. Higher priority numbers execute first. Default priority is 0.',
        errorIndicators: [
          'event subscriber',
          'subscriber priority',
          'KernelEvents',
          'event order',
        ],
        solutionGuidance: 'Set priority in getSubscribedEvents() return value. Higher numbers = earlier execution.',
        exampleErrors: [
          'Subscriber runs too late',
          'Event already processed',
          'State changed before subscriber',
        ],
      },
    ];

    // React-specific patterns
    const reactPatterns: FrameworkPattern[] = [
      {
        id: 'react-component-lifecycle',
        framework: 'react',
        patternType: 'lifecycle',
        name: 'React Component Lifecycle',
        description: 'useEffect runs after render. Dependencies array controls when effect re-runs. State updates are batched.',
        errorIndicators: [
          'useEffect',
          'component lifecycle',
          'state update',
          'render cycle',
        ],
        solutionGuidance: 'Add dependencies to useEffect array. Use useCallback/useMemo for stable references. Batch state updates.',
        exampleErrors: [
          'State not updated',
          'Effect runs too often',
          'Stale closure',
        ],
      },
    ];

    // Framework-agnostic patterns
    const genericPatterns: FrameworkPattern[] = [
      {
        id: 'async-sequencing',
        framework: 'generic',
        patternType: 'execution-order',
        name: 'Async Operation Sequencing',
        description: 'Async operations complete in unpredictable order. Promises/async-await must be properly sequenced.',
        errorIndicators: [
          'async',
          'await',
          'promise',
          'race condition',
          'timing',
          'order',
        ],
        solutionGuidance: 'Use await to sequence operations. Use Promise.all() for parallel operations. Add explicit dependencies.',
        exampleErrors: [
          'Undefined before assignment',
          'Operation completes too early',
          'Race condition',
        ],
      },
      {
        id: 'event-handler-order',
        framework: 'generic',
        patternType: 'execution-order',
        name: 'Event Handler Execution Order',
        description: 'Event handlers execute in registration order unless priority is specified.',
        errorIndicators: [
          'event handler',
          'listener order',
          'event order',
          'handler priority',
        ],
        solutionGuidance: 'Set explicit priority/weight for handlers. Use prepend/append methods to control order.',
        exampleErrors: [
          'Handler runs too late',
          'Event already processed',
          'State changed before handler',
        ],
      },
    ];

    this.patterns.set('drupal', drupalPatterns);
    this.patterns.set('react', reactPatterns);
    this.patterns.set('generic', genericPatterns);
  }

  /**
   * Match error message to framework patterns
   */
  matchPatterns(errorText: string, framework?: string): FrameworkPattern[] {
    const lowerError = errorText.toLowerCase();
    const matches: FrameworkPattern[] = [];

    // Get patterns for specified framework, or all if not specified
    const frameworksToCheck = framework
      ? [framework, 'generic']
      : Array.from(this.patterns.keys());

    for (const fw of frameworksToCheck) {
      const patterns = this.patterns.get(fw) || [];
      for (const pattern of patterns) {
        // Check if any error indicators match
        const hasMatch = pattern.errorIndicators.some(indicator =>
          lowerError.includes(indicator.toLowerCase())
        );

        // Also check example errors
        const hasExampleMatch = pattern.exampleErrors.some(example =>
          lowerError.includes(example.toLowerCase())
        );

        if (hasMatch || hasExampleMatch) {
          matches.push(pattern);
        }
      }
    }

    // Sort by relevance (more indicators matched = higher relevance)
    return matches.sort((a, b) => {
      const aMatches = a.errorIndicators.filter(i =>
        lowerError.includes(i.toLowerCase())
      ).length;
      const bMatches = b.errorIndicators.filter(i =>
        lowerError.includes(i.toLowerCase())
      ).length;
      return bMatches - aMatches;
    });
  }

  /**
   * Get pattern by ID
   */
  getPattern(framework: string, patternId: string): FrameworkPattern | undefined {
    const patterns = this.patterns.get(framework);
    return patterns?.find(p => p.id === patternId);
  }

  /**
   * Get all patterns for a framework
   */
  getPatternsForFramework(framework: string): FrameworkPattern[] {
    return this.patterns.get(framework) || [];
  }

  /**
   * Generate guidance prompt from matched patterns
   */
  generateGuidancePrompt(patterns: FrameworkPattern[]): string {
    if (patterns.length === 0) {
      return '';
    }

    const sections: string[] = [
      '## FRAMEWORK PATTERN ANALYSIS',
      '',
      'The error matches the following framework patterns:',
      '',
    ];

    for (const pattern of patterns.slice(0, 3)) {
      sections.push(`### ${pattern.name} (${pattern.framework})`);
      sections.push(`**Pattern Type**: ${pattern.patternType}`);
      sections.push(`**Description**: ${pattern.description}`);
      sections.push(`**Solution Guidance**: ${pattern.solutionGuidance}`);
      sections.push('');
    }

    return sections.join('\n');
  }
}
