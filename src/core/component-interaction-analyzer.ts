import { FrameworkPatternLibrary } from './framework-pattern-library';

export interface Component {
  name: string;
  type: 'module' | 'service' | 'widget' | 'entity' | 'handler' | 'subscriber' | 'processor';
  file?: string;
}

export interface ComponentInteraction {
  from: Component;
  to: Component;
  interactionType: 'calls' | 'triggers' | 'saves' | 'creates' | 'validates' | 'subscribes';
  description: string;
}

export interface InteractionIssue {
  description: string;
  severity: 'high' | 'medium' | 'low';
  components: Component[];
  interaction: ComponentInteraction;
  problem: string;
  suggestedFix: string;
  confidence: number;
}

export class ComponentInteractionAnalyzer {
  private patternLibrary: FrameworkPatternLibrary;
  private debug: boolean;

  constructor(patternLibrary: FrameworkPatternLibrary, debug: boolean = false) {
    this.patternLibrary = patternLibrary;
    this.debug = debug;
  }

  /**
   * Analyze error for component interaction issues
   */
  analyzeInteraction(
    errorText: string,
    errorContext?: {
      components?: string[];
      framework?: string;
      targetFiles?: string[];
    }
  ): InteractionIssue[] {
    const issues: InteractionIssue[] = [];
    const lowerError = errorText.toLowerCase();

    // Extract components from error
    const components = this.extractComponents(errorText, errorContext?.components);

    if (components.length < 2) {
      return issues; // Need at least 2 components for interaction
    }

    // Check for known interaction patterns
    const patterns = this.patternLibrary.matchPatterns(errorText, errorContext?.framework);
    const interactionPatterns = patterns.filter(p => p.patternType === 'interaction');

    for (const pattern of interactionPatterns) {
      const issue = this.createIssueFromPattern(pattern, components, errorText);
      if (issue) {
        issues.push(issue);
      }
    }

    // Detect common interaction problems
    const commonIssues = this.detectCommonInteractionProblems(components, errorText, errorContext?.framework);
    issues.push(...commonIssues);

    return issues;
  }

  private extractComponents(
    errorText: string,
    explicitComponents?: string[]
  ): Component[] {
    const components: Component[] = [];
    const lowerError = errorText.toLowerCase();

    // Component name patterns
    const componentPatterns: Array<{ name: string; type: Component['type'] }> = [
      { name: 'IEF', type: 'widget' },
      { name: 'inline entity form', type: 'widget' },
      { name: 'FeedType', type: 'entity' },
      { name: 'feeds_feed_type', type: 'entity' },
      { name: 'entity bundle', type: 'entity' },
      { name: 'form', type: 'handler' },
      { name: 'submit handler', type: 'handler' },
      { name: 'processor', type: 'processor' },
      { name: 'subscriber', type: 'subscriber' },
    ];

    // Check for explicit components
    if (explicitComponents) {
      for (const compName of explicitComponents) {
        const type = this.inferComponentType(compName);
        components.push({ name: compName, type });
      }
    }

    // Extract from error text
    for (const pattern of componentPatterns) {
      if (lowerError.includes(pattern.name.toLowerCase())) {
        // Avoid duplicates
        if (!components.some(c => c.name.toLowerCase() === pattern.name.toLowerCase())) {
          components.push({ name: pattern.name, type: pattern.type });
        }
      }
    }

    return components;
  }

  private inferComponentType(name: string): Component['type'] {
    const lower = name.toLowerCase();
    if (lower.includes('widget') || lower.includes('ief')) return 'widget';
    if (lower.includes('entity') || lower.includes('bundle')) return 'entity';
    if (lower.includes('handler') || lower.includes('form')) return 'handler';
    if (lower.includes('service')) return 'service';
    if (lower.includes('subscriber')) return 'subscriber';
    if (lower.includes('processor')) return 'processor';
    return 'module';
  }

  private createIssueFromPattern(
    pattern: any,
    components: Component[],
    errorText: string
  ): InteractionIssue | null {
    if (pattern.id === 'drupal-widget-entity-save') {
      const widget = components.find(c => c.type === 'widget');
      const entity = components.find(c => c.type === 'entity');

      if (widget && entity) {
        return {
          description: `Widget (${widget.name}) tries to save entity (${entity.name}) before parent entity bundle exists`,
          severity: 'high',
          components: [widget, entity],
          interaction: {
            from: widget,
            to: entity,
            interactionType: 'saves',
            description: `${widget.name} widget saves ${entity.name} entity during form submission`,
          },
          problem: 'Entity lifecycle issue: widget saves entity before bundle exists, triggering field creation on non-existent bundle',
          suggestedFix: pattern.solutionGuidance,
          confidence: 0.9,
        };
      }
    }

    return null;
  }

  private detectCommonInteractionProblems(
    components: Component[],
    errorText: string,
    framework?: string
  ): InteractionIssue[] {
    const issues: InteractionIssue[] = [];
    const lowerError = errorText.toLowerCase();

    // Entity lifecycle issues
    if (lowerError.includes('without a bundle') || lowerError.includes('bundle does not exist')) {
      const entity = components.find(c => c.type === 'entity');
      const widget = components.find(c => c.type === 'widget');
      const handler = components.find(c => c.type === 'handler');

      if (entity && (widget || handler)) {
        const trigger = widget || handler;
        if (trigger) {
          issues.push({
            description: `${trigger.name} tries to create field on ${entity.name} before bundle exists`,
            severity: 'high',
            components: [trigger, entity],
            interaction: {
              from: trigger,
              to: entity,
              interactionType: 'creates',
              description: `${trigger.name} creates field on ${entity.name} entity`,
            },
            problem: 'Entity bundle must exist before fields can be created. Widget/handler runs before bundle is created.',
            suggestedFix: framework === 'drupal'
              ? 'Clear widget entities from form state before save, or delay widget entity save until after main entity bundle is created. Use form submit handler with high priority (array_unshift on #submit or #ief_element_submit).'
              : 'Ensure entity bundle exists before creating fields. Delay field creation until after bundle creation.',
            confidence: 0.85,
          });
        }
      }
    }

    // Widget → Entity save conflicts
    if (lowerError.includes('widget') && lowerError.includes('save')) {
      const widget = components.find(c => c.type === 'widget');
      const entity = components.find(c => c.type === 'entity');

      if (widget && entity) {
        issues.push({
          description: `${widget.name} widget saves ${entity.name} entity during form submission, causing timing conflicts`,
          severity: 'medium',
          components: [widget, entity],
          interaction: {
            from: widget,
            to: entity,
            interactionType: 'saves',
            description: `${widget.name} saves ${entity.name} during form submission`,
          },
          problem: 'Widget saves entity before main form entity is saved, triggering entity lifecycle hooks prematurely',
          suggestedFix: framework === 'drupal'
            ? 'Clear widget entities from form state before IEF save handler runs. Use #ief_element_submit handler with array_unshift to run before IEF handlers.'
            : 'Delay widget entity save until after main entity save, or clear widget state before save',
          confidence: 0.8,
        });
      }
    }

    return issues;
  }

  /**
   * Generate interaction diagram text for AI prompts
   */
  generateInteractionDiagram(issues: InteractionIssue[]): string {
    if (issues.length === 0) {
      return '';
    }

    const sections: string[] = [
      '## COMPONENT INTERACTION ANALYSIS',
      '',
      'The following component interaction issues were detected:',
      '',
    ];

    for (const issue of issues) {
      sections.push(`### ${issue.description}`);
      sections.push(`**Components Involved**:`);
      for (const component of issue.components) {
        sections.push(`- ${component.name} (${component.type})`);
      }
      sections.push(`**Interaction**: ${issue.interaction.from.name} ${issue.interaction.interactionType} ${issue.interaction.to.name}`);
      sections.push(`**Problem**: ${issue.problem}`);
      sections.push(`**Suggested Fix**: ${issue.suggestedFix}`);
      sections.push('');
    }

    return sections.join('\n');
  }
}
