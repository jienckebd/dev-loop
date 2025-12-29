import { FrameworkPatternLibrary } from './framework-pattern-library';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface ExecutionDependency {
  from: string; // Function/method/handler name
  to: string; // Function/method/handler that it calls/triggers
  type: 'call' | 'hook' | 'event' | 'handler' | 'lifecycle';
  order: number; // Execution order (if determinable)
}

export interface ExecutionOrderIssue {
  description: string;
  severity: 'high' | 'medium' | 'low';
  dependencies: ExecutionDependency[];
  suggestedFix: string;
  confidence: number; // 0-1
}

export class ExecutionOrderAnalyzer {
  private patternLibrary: FrameworkPatternLibrary;
  private debug: boolean;

  constructor(patternLibrary: FrameworkPatternLibrary, debug: boolean = false) {
    this.patternLibrary = patternLibrary;
    this.debug = debug;
  }

  /**
   * Analyze code for execution order issues
   */
  async analyzeExecutionOrder(
    errorText: string,
    targetFiles?: string[],
    framework?: string
  ): Promise<ExecutionOrderIssue[]> {
    const issues: ExecutionOrderIssue[] = [];
    const patterns = this.patternLibrary.matchPatterns(errorText, framework);

    // Check for execution-order patterns
    const executionOrderPatterns = patterns.filter(p => p.patternType === 'execution-order');
    if (executionOrderPatterns.length === 0) {
      return issues;
    }

    // Analyze target files if provided
    if (targetFiles && targetFiles.length > 0) {
      for (const file of targetFiles.slice(0, 5)) {
        try {
          const filePath = path.resolve(process.cwd(), file);
          if (await fs.pathExists(filePath)) {
            const content = await fs.readFile(filePath, 'utf-8');
            const fileIssues = this.analyzeFileForOrderIssues(content, file, framework);
            issues.push(...fileIssues);
          }
        } catch (err) {
          if (this.debug) {
            console.warn(`[ExecutionOrderAnalyzer] Could not analyze file ${file}:`, err);
          }
        }
      }
    }

    // Generate generic issues based on patterns
    for (const pattern of executionOrderPatterns) {
      const issue = this.createIssueFromPattern(pattern, errorText);
      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  }

  private analyzeFileForOrderIssues(
    content: string,
    fileName: string,
    framework?: string
  ): ExecutionOrderIssue[] {
    const issues: ExecutionOrderIssue[] = [];

    if (framework === 'drupal') {
      // Check for form handler order issues
      const formHandlerIssues = this.analyzeDrupalFormHandlers(content, fileName);
      issues.push(...formHandlerIssues);

      // Check for hook order issues
      const hookIssues = this.analyzeDrupalHooks(content, fileName);
      issues.push(...hookIssues);
    }

    return issues;
  }

  private analyzeDrupalFormHandlers(content: string, fileName: string): ExecutionOrderIssue[] {
    const issues: ExecutionOrderIssue[] = [];

    // Look for form_alter with submit handlers
    const formAlterMatch = content.match(/function\s+\w+_form_alter[^{]*\{([^}]*)\}/s);
    if (!formAlterMatch) {
      return issues;
    }

    const formAlterContent = formAlterMatch[1];

    // Check for #submit array manipulation
    const submitArrayMatches = [
      ...formAlterContent.matchAll(/\$form\['#submit'\]\s*=\s*\[([^\]]*)\]/g),
      ...formAlterContent.matchAll(/array_unshift\s*\(\s*\$form\['#submit'\]/g),
      ...formAlterContent.matchAll(/array_push\s*\(\s*\$form\['#submit'\]/g),
    ];

    // Check for IEF element submit handlers
    const iefSubmitMatches = formAlterContent.match(/\$form\['#ief_element_submit'\]/g);

    if (submitArrayMatches.length > 0 || iefSubmitMatches) {
      // Check if handlers are added in correct order
      const hasUnshift = formAlterContent.includes('array_unshift');
      const hasPush = formAlterContent.includes('array_push');

      if (hasPush && !hasUnshift) {
        issues.push({
          description: `Form submit handlers in ${fileName} are added with array_push(), which adds them at the end. For handlers that need to run first (like clearing IEF state), use array_unshift() instead.`,
          severity: 'high',
          dependencies: [],
          suggestedFix: 'Change array_push($form[\'#submit\'], ...) to array_unshift($form[\'#submit\'], ...) to ensure handler runs first',
          confidence: 0.8,
        });
      }

      if (iefSubmitMatches && !hasUnshift) {
        issues.push({
          description: `IEF element submit handlers in ${fileName} may need to run before IEF's default handlers. Consider using array_unshift() on #ief_element_submit array.`,
          severity: 'medium',
          dependencies: [],
          suggestedFix: 'Use array_unshift($form[\'#ief_element_submit\'], \'handler_name\') to ensure handler runs before IEF handlers',
          confidence: 0.7,
        });
      }
    }

    return issues;
  }

  private analyzeDrupalHooks(content: string, fileName: string): ExecutionOrderIssue[] {
    const issues: ExecutionOrderIssue[] = [];

    // Check for hook_module_implements_alter (priority adjustment)
    const hasModuleImplementsAlter = content.includes('hook_module_implements_alter');

    // Check for hook_alter implementations
    const alterHooks = content.match(/(\w+)_alter\s*\(/g);

    if (alterHooks && alterHooks.length > 0 && !hasModuleImplementsAlter) {
      issues.push({
        description: `File ${fileName} implements alter hooks but doesn't adjust module weight. If hooks need to run in specific order, consider using hook_module_implements_alter().`,
        severity: 'low',
        dependencies: [],
        suggestedFix: 'Add hook_module_implements_alter() to adjust execution order if needed',
        confidence: 0.5,
      });
    }

    return issues;
  }

  private createIssueFromPattern(
    pattern: any,
    errorText: string
  ): ExecutionOrderIssue | null {
    if (pattern.id === 'drupal-form-handler-order') {
      return {
        description: `Error suggests form handler execution order issue. ${pattern.description}`,
        severity: 'high',
        dependencies: [],
        suggestedFix: pattern.solutionGuidance,
        confidence: 0.8,
      };
    }

    if (pattern.id === 'drupal-hook-execution-order') {
      return {
        description: `Error suggests hook execution order issue. ${pattern.description}`,
        severity: 'medium',
        dependencies: [],
        suggestedFix: pattern.solutionGuidance,
        confidence: 0.7,
      };
    }

    return null;
  }

  /**
   * Generate execution flow diagram text for AI prompts
   */
  generateExecutionFlowDiagram(issues: ExecutionOrderIssue[]): string {
    if (issues.length === 0) {
      return '';
    }

    const sections: string[] = [
      '## EXECUTION ORDER ANALYSIS',
      '',
      'The following execution order issues were detected:',
      '',
    ];

    for (const issue of issues) {
      sections.push(`### ${issue.description}`);
      sections.push(`**Severity**: ${issue.severity}`);
      sections.push(`**Suggested Fix**: ${issue.suggestedFix}`);
      sections.push('');
    }

    return sections.join('\n');
  }
}
