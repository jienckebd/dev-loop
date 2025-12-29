import { DebuggingStrategyAdvisor, ErrorClassification } from './debugging-strategy-advisor';
import { Task } from '../types';

export interface InvestigationTask {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  investigationType: 'logging' | 'verification' | 'analysis' | 'tracing';
  debugCode?: string;
  targetFiles?: string[];
  expectedOutcome: string;
}

export class InvestigationTaskGenerator {
  private strategyAdvisor: DebuggingStrategyAdvisor;
  private debug: boolean;

  constructor(strategyAdvisor: DebuggingStrategyAdvisor, debug: boolean = false) {
    this.strategyAdvisor = strategyAdvisor;
    this.debug = debug;
  }

  /**
   * Generate investigation tasks based on error classification
   */
  generateInvestigationTasks(
    errorText: string,
    errorContext?: {
      framework?: string;
      components?: string[];
      targetFiles?: string[];
      previousFixAttempts?: number;
    }
  ): InvestigationTask[] {
    // Store errorContext for use in generateDrupalInvestigationTasks
    const storedContext = errorContext;
    const classification = this.strategyAdvisor.classifyError(errorText, errorContext);

    if (!classification.needsInvestigation) {
      return [];
    }

    const tasks: InvestigationTask[] = [];

    // Generate tasks based on investigation steps
    if (classification.investigationSteps) {
      for (const step of classification.investigationSteps) {
        const task = this.createTaskFromStep(step, classification, errorContext);
        if (task) {
          tasks.push(task);
        }
      }
    }

    // Add framework-specific investigation tasks
    if (errorContext?.framework === 'drupal') {
      const drupalTasks = this.generateDrupalInvestigationTasks(classification, storedContext, errorText);
      tasks.push(...drupalTasks);
    }

    return tasks;
  }

  private createTaskFromStep(
    step: string,
    classification: ErrorClassification,
    context?: { targetFiles?: string[]; framework?: string }
  ): InvestigationTask | null {
    const lowerStep = step.toLowerCase();

    if (lowerStep.includes('debug logging') || lowerStep.includes('add logging')) {
      return {
        title: `Add debug logging: ${step}`,
        description: step,
        priority: 'high',
        investigationType: 'logging',
        debugCode: this.strategyAdvisor.generateDebugCode(classification, context?.targetFiles?.[0], context?.framework),
        targetFiles: context?.targetFiles,
        expectedOutcome: 'Debug logs showing execution order or component interaction flow',
      };
    }

    if (lowerStep.includes('verify') || lowerStep.includes('check')) {
      return {
        title: `Verify: ${step}`,
        description: step,
        priority: 'medium',
        investigationType: 'verification',
        targetFiles: context?.targetFiles,
        expectedOutcome: 'Confirmation of current state or execution order',
      };
    }

    if (lowerStep.includes('map') || lowerStep.includes('identify') || lowerStep.includes('analyze')) {
      return {
        title: `Analyze: ${step}`,
        description: step,
        priority: 'medium',
        investigationType: 'analysis',
        targetFiles: context?.targetFiles,
        expectedOutcome: 'Documentation of execution flow or component interactions',
      };
    }

    if (lowerStep.includes('trace') || lowerStep.includes('flow')) {
      return {
        title: `Trace: ${step}`,
        description: step,
        priority: 'high',
        investigationType: 'tracing',
        targetFiles: context?.targetFiles,
        expectedOutcome: 'Complete execution trace showing order of operations',
      };
    }

    return null;
  }

  private generateDrupalInvestigationTasks(
    classification: ErrorClassification,
    context?: { targetFiles?: string[]; components?: string[] },
    errorText?: string
  ): InvestigationTask[] {
    const tasks: InvestigationTask[] = [];

    if (classification.errorType === 'timing-order') {
      tasks.push({
        title: 'Investigate Drupal form submit handler execution order',
        description: `Add debug logging to verify the order of form submit handlers. Check if handlers are executing in the expected sequence.

Key points to log:
- Form submit handler array order ($form['#submit'])
- Handler execution timestamps
- Handler weight/priority values
- IEF element submit handlers ($form['#ief_element_submit'])`,
        priority: 'high',
        investigationType: 'logging',
        debugCode: `// In form_alter or form submit handler
\\Drupal::logger('module_name')->debug('Form submit handlers: @handlers', [
  '@handlers' => print_r(array_keys($form['#submit'] ?? []), TRUE),
]);

// Log IEF handlers if present
if (isset($form['#ief_element_submit'])) {
  \\Drupal::logger('module_name')->debug('IEF element submit handlers: @handlers', [
    '@handlers' => print_r($form['#ief_element_submit'], TRUE),
  ]);
}

// In each submit handler
\\Drupal::logger('module_name')->debug('SUBMIT HANDLER: @handler called at @time', [
  '@handler' => __FUNCTION__,
  '@time' => microtime(TRUE),
]);`,
        targetFiles: context?.targetFiles,
        expectedOutcome: 'Logs showing exact order of handler execution, confirming if handlers run in expected sequence',
      });
    }

    const hasIEF = context?.components?.some((c: string) => c.toLowerCase().includes('ief')) ||
                   errorText?.toLowerCase().includes('ief') ||
                   errorText?.toLowerCase().includes('inline entity form');

    if (classification.errorType === 'component-interaction' && hasIEF) {
      tasks.push({
        title: 'Investigate IEF widget save interaction with entity lifecycle',
        description: `Verify when IEF widget saves entities relative to the main form entity save. Check if widget entity save triggers entity lifecycle hooks before the main entity bundle exists.

Key points to investigate:
- When FeedTypeIefHandler::save() is called
- Whether entity bundle exists at that point
- Form state before and after IEF save
- Whether clear handler runs before IEF save handler
- Check if clear handler is registered with array_unshift() or array_push() on #ief_element_submit`,
        priority: 'high',
        investigationType: 'tracing',
        debugCode: `// In form_alter, check handler registration method
if (isset($form['#ief_element_submit'])) {
  \\Drupal::logger('module_name')->debug('IEF element submit handlers BEFORE: @handlers', [
    '@handlers' => print_r($form['#ief_element_submit'], TRUE),
  ]);
}

// In FeedTypeIefHandler::save() or similar
\\Drupal::logger('module_name')->debug('IEF HANDLER: @handler called at @time', [
  '@handler' => __FUNCTION__,
  '@time' => microtime(TRUE),
]);

// Check if bundle exists
$entity_type_id = 'your_entity_type';
$bundle = 'your_bundle';
$bundle_exists = \\Drupal::entityTypeManager()
  ->getStorage($entity_type_id)
  ->load($bundle) !== NULL;

\\Drupal::logger('module_name')->debug('Bundle exists: @exists', [
  '@exists' => $bundle_exists ? 'YES' : 'NO',
]);

// In clear handler, verify it's called
\\Drupal::logger('module_name')->debug('CLEAR HANDLER: @handler called at @time', [
  '@handler' => __FUNCTION__,
  '@time' => microtime(TRUE),
]);`,
        targetFiles: context?.targetFiles,
        expectedOutcome: 'Execution trace showing IEF save timing relative to bundle creation and clear handler execution order',
      });
    }

    return tasks;
  }

  /**
   * Convert investigation task to TaskMaster task format
   */
  toTaskMasterTask(investigationTask: InvestigationTask, parentTaskId?: string): Partial<Task> & { id: string } {
    // Generate a unique ID for the investigation task
    const taskId = `investigation-${parentTaskId || 'unknown'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: taskId,
      title: investigationTask.title,
      description: investigationTask.description +
        (investigationTask.debugCode ? `\n\nDebug code to add:\n\`\`\`php\n${investigationTask.debugCode}\n\`\`\`` : '') +
        `\n\nExpected outcome: ${investigationTask.expectedOutcome}`,
      priority: investigationTask.priority,
      status: 'pending',
      details: JSON.stringify({
        investigationType: investigationTask.investigationType,
        targetFiles: investigationTask.targetFiles,
        parentTaskId,
        taskType: 'investigation',
      }),
    };
  }
}
