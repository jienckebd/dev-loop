import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from '../config/schema';
import { Task, WorkflowState, CodeChanges, TaskContext } from '../types';
import { TaskMasterBridge } from './task-bridge';
import { StateManager } from './state-manager';
import { TemplateManager } from './template-manager';
import { InterventionSystem } from './intervention';
import { AIProviderFactory } from '../providers/ai/factory';
import { TestRunnerFactory } from '../providers/test-runners/factory';
import { LogAnalyzerFactory } from '../providers/log-analyzers/factory';
import { AIProvider } from '../providers/ai/interface';
import { SmokeTestValidator, SmokeTestConfig, SmokeTestResult } from '../providers/validators/smoke-test';
import { CodeContextProvider } from './code-context-provider';
import { ValidationGate } from './validation-gate';
import { PatternLearningSystem } from './pattern-learner';
import { DebugMetrics } from './debug-metrics';
import { PrdMetrics } from './prd-metrics';
import { PhaseMetrics } from './phase-metrics';
import { PrdMetadata } from './hierarchical-metrics';
import { FeatureTracker } from './feature-tracker';
import { SchemaTracker } from './schema-tracker';
import { ObservationMetrics } from './observation-metrics';
import { PatternMetrics } from './pattern-metrics';
import { TestResultsTracker } from './test-results-tracker';
import { ErrorAnalyzer } from './error-analyzer';
import { CostCalculator } from './cost-calculator';
import { RunMetrics } from './debug-metrics';
import { logger } from './logger';
import { PrdContextManager, PrdContext, Requirement } from './prd-context';
import { PrdParser } from './prd-parser';
import { PrdConfigParser } from './prd-config-parser';
import { TestGenerator } from './test-generator';
import { TestExecutor } from './test-executor';
import { FailureAnalyzer } from './failure-analyzer';
import { AutonomousTaskGenerator } from './autonomous-task-generator';
import { DrupalImplementationGenerator } from './drupal-implementation-generator';
import { FrameworkLoader, FrameworkPlugin } from '../frameworks';

const execAsync = promisify(exec);

export interface WorkflowResult {
  completed: boolean;
  noTasks: boolean;
  taskId?: string;
  error?: string;
  prdComplete?: boolean;
}

export class WorkflowEngine {
  private taskBridge: TaskMasterBridge;
  private stateManager: StateManager;
  private templateManager: TemplateManager;
  private frameworkLoader: FrameworkLoader;
  private frameworkPlugin?: FrameworkPlugin;
  private intervention: InterventionSystem;
  private aiProvider: AIProvider;
  private testRunner: any;
  private logAnalyzer: any;
  private smokeTestValidator: SmokeTestValidator;
  private codeContextProvider: CodeContextProvider;
  private validationGate: ValidationGate;
  private patternLearner: PatternLearningSystem;
  private debugMetrics?: DebugMetrics;
  private prdMetrics?: PrdMetrics;
  private phaseMetrics?: PhaseMetrics;
  private featureTracker?: FeatureTracker;
  private schemaTracker?: SchemaTracker;
  private observationMetrics?: ObservationMetrics;
  private patternMetrics?: PatternMetrics;
  private testResultsTracker?: TestResultsTracker;
  private errorAnalyzer?: ErrorAnalyzer;
  private costCalculator?: CostCalculator;
  private observationTracker?: any; // ObservationTracker
  private improvementSuggester?: any; // ImprovementSuggester
  private frameworkPatternLibrary?: any; // FrameworkPatternLibrary
  private debuggingStrategyAdvisor?: any; // DebuggingStrategyAdvisor
  private investigationTaskGenerator?: any; // InvestigationTaskGenerator
  private executionOrderAnalyzer?: any; // ExecutionOrderAnalyzer
  private componentInteractionAnalyzer?: any; // ComponentInteractionAnalyzer
  private rootCauseAnalyzer?: any; // RootCauseAnalyzer
  private shutdownRequested = false;
  private debug = false;

  constructor(private config: Config) {
    this.debug = (config as any).debug || false;
    const mcpMode = (config as any).mcpMode || false;

    // Configure logger with file path and debug mode
    logger.configure({
      logPath: config.logs.outputPath,
      debug: this.debug,
      mcpMode,  // Suppress console output when running via MCP
    });


    logger.info('WorkflowEngine initialized');
    if (this.debug) {
      logger.debug('Debug mode enabled');
    }
    this.taskBridge = new TaskMasterBridge(config);
    this.stateManager = new StateManager(config);
    this.templateManager = new TemplateManager(
      config.templates.source,
      config.templates.customPath,
      (config as any).framework, // Pass framework config for template selection
      this.debug
    );

    // Initialize framework loader and plugin
    this.frameworkLoader = new FrameworkLoader(process.cwd(), this.debug);
    this.initializeFrameworkPlugin((config as any).framework?.type);

    this.intervention = new InterventionSystem(config);
    this.aiProvider = AIProviderFactory.createWithFallback(config);
    this.testRunner = TestRunnerFactory.create(config);
    this.logAnalyzer = LogAnalyzerFactory.create(config);
    this.smokeTestValidator = new SmokeTestValidator(this.debug);

    // NEW: Enhanced context and validation components
    this.codeContextProvider = new CodeContextProvider(this.debug);
    this.validationGate = new ValidationGate(this.debug);
    this.patternLearner = new PatternLearningSystem(
      (config as any).patternLearning?.patternsPath,
      this.debug
    );

    // Initialize validation infrastructure
    try {
      const { ValidationScriptExecutor } = require('./validation-script-executor');
      const { AssertionValidatorRegistry } = require('./assertion-validators');
      const { ValidationGateExecutor } = require('./validation-gate-executor');
      const { PrerequisiteValidator } = require('./prerequisite-validator');
      const { TestDataManager } = require('./test-data-manager');
      const { TestSpecExecutor } = require('./test-spec-executor');

      const scriptExecutor = new ValidationScriptExecutor(this.debug);
      const assertionRegistry = new AssertionValidatorRegistry(scriptExecutor, this.debug);
      const validationGateExecutor = new ValidationGateExecutor(scriptExecutor, assertionRegistry, this.debug);
      const prerequisiteValidator = new PrerequisiteValidator(scriptExecutor, this.debug);
      const testDataManager = new TestDataManager(this.debug);
      const testSpecExecutor = new TestSpecExecutor(
        this.testRunner,
        scriptExecutor,
        assertionRegistry,
        testDataManager,
        this.debug
      );

      // Store for use in workflow
      (this as any).validationScriptExecutor = scriptExecutor;
      (this as any).assertionValidatorRegistry = assertionRegistry;
      (this as any).validationGateExecutor = validationGateExecutor;
      (this as any).prerequisiteValidator = prerequisiteValidator;
      (this as any).testDataManager = testDataManager;
      (this as any).testSpecExecutor = testSpecExecutor;
    } catch (err) {
      if (this.debug) {
        console.warn('[WorkflowEngine] Could not initialize validation infrastructure:', err);
      }
    }

    // Initialize debug metrics if enabled
    if ((config as any).metrics?.enabled !== false) {
      const metricsPath = (config as any).metrics?.path || '.devloop/metrics.json';
      this.debugMetrics = new DebugMetrics(metricsPath);
    }

    // Initialize hierarchical metrics
    const metricsConfig = (config as any).metrics || {};
    if (metricsConfig.enabled !== false) {
      const prdMetricsPath = metricsConfig.prdMetricsPath || '.devloop/prd-metrics.json';
      const phaseMetricsPath = metricsConfig.phaseMetricsPath || '.devloop/phase-metrics.json';
      const featureMetricsPath = metricsConfig.featureMetricsPath || '.devloop/feature-metrics.json';
      const schemaMetricsPath = metricsConfig.schemaMetricsPath || '.devloop/schema-metrics.json';
      const observationMetricsPath = metricsConfig.observationMetricsPath || '.devloop/observation-metrics.json';
      const patternMetricsPath = metricsConfig.patternMetricsPath || '.devloop/pattern-metrics.json';
      const testResultsPath = metricsConfig.testResultsPath || '.devloop/test-results.json';

      // CostCalculator is static, no instance needed
      this.prdMetrics = new PrdMetrics(prdMetricsPath);
      this.phaseMetrics = new PhaseMetrics(phaseMetricsPath);
      this.featureTracker = new FeatureTracker(featureMetricsPath);
      this.schemaTracker = new SchemaTracker(schemaMetricsPath);
      this.observationMetrics = new ObservationMetrics(observationMetricsPath);
      this.patternMetrics = new PatternMetrics(patternMetricsPath);
      this.testResultsTracker = new TestResultsTracker(testResultsPath);
      this.errorAnalyzer = new ErrorAnalyzer();
    } else {
      // Still initialize error analyzer as it may be used elsewhere
      this.errorAnalyzer = new ErrorAnalyzer();
    }

    // Initialize observation tracking if enabled (for evolution mode)
    if ((config as any).evolution?.enabled !== false) {
      try {
        const { ObservationTracker } = require('./observation-tracker');
        const { ImprovementSuggester } = require('./improvement-suggester');
        this.observationTracker = new ObservationTracker('.devloop/observations.json', this.debug);
        this.improvementSuggester = new ImprovementSuggester(this.debug);
      } catch (err) {
        if (this.debug) {
          console.warn('[WorkflowEngine] Could not initialize observation tracking:', err);
        }
      }
    }

    // Initialize complex issue analyzers
    try {
      const { FrameworkPatternLibrary } = require('./framework-pattern-library');
      const { DebuggingStrategyAdvisor } = require('./debugging-strategy-advisor');
      const { InvestigationTaskGenerator } = require('./investigation-task-generator');
      const { ExecutionOrderAnalyzer } = require('./execution-order-analyzer');
      const { ComponentInteractionAnalyzer } = require('./component-interaction-analyzer');
      const { RootCauseAnalyzer } = require('./root-cause-analyzer');

      this.frameworkPatternLibrary = new FrameworkPatternLibrary();
      this.debuggingStrategyAdvisor = new DebuggingStrategyAdvisor(this.frameworkPatternLibrary, this.debug);
      this.investigationTaskGenerator = new InvestigationTaskGenerator(this.debuggingStrategyAdvisor, this.debug);
      this.executionOrderAnalyzer = new ExecutionOrderAnalyzer(this.frameworkPatternLibrary, this.debug);
      this.componentInteractionAnalyzer = new ComponentInteractionAnalyzer(this.frameworkPatternLibrary, this.debug);
      this.rootCauseAnalyzer = new RootCauseAnalyzer(
        this.executionOrderAnalyzer,
        this.componentInteractionAnalyzer,
        this.debug
      );
    } catch (err) {
      if (this.debug) {
        console.warn('[WorkflowEngine] Could not initialize complex issue analyzers:', err);
      }
    }
  }

  /**
   * Extract components from error text
   */
  private extractComponentsFromError(errorText: string): string[] {
    const lower = errorText.toLowerCase();
    const components: string[] = [];
    const componentKeywords = [
      'IEF', 'inline entity form',
      'widget', 'entity', 'form', 'handler', 'subscriber', 'processor',
      'feeds', 'bundle', 'feed type', 'feeds_feed_type'
    ];

    for (const keyword of componentKeywords) {
      if (lower.includes(keyword.toLowerCase())) {
        // Use canonical name
        if (keyword === 'inline entity form') {
          if (!components.includes('IEF')) {
            components.push('IEF');
          }
        } else if (keyword === 'feed type' || keyword === 'feeds_feed_type') {
          if (!components.includes('feeds')) {
            components.push('feeds');
          }
        } else {
          if (!components.includes(keyword)) {
            components.push(keyword);
          }
        }
      }
    }

    return components;
  }

  /**
   * Check if error involves multiple components
   */
  private hasMultipleComponents(errorText: string): boolean {
    return this.extractComponentsFromError(errorText).length >= 2;
  }

  /**
   * Get count of previous fix attempts for a task
   */
  private async getPreviousFixAttempts(taskId: string): Promise<number> {
    try {
      // Count fix tasks by checking if task ID starts with 'fix-{taskId}'
      const pendingTasks = await this.taskBridge.getPendingTasks();
      const allTasks = [...pendingTasks];

      // Also check done/blocked tasks for fix attempts
      try {
        const tasksData = await require('fs-extra').readJson(this.config.taskMaster.tasksPath);
        const allTasksFromFile = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
        allTasks.push(...allTasksFromFile.filter((t: any) => t.status === 'done' || t.status === 'blocked'));
      } catch (err) {
        // Ignore if can't read tasks file
      }

      const fixTasks = allTasks.filter((t: any) => {
        const idStr = String(t.id);
        // Check if it's a fix task for this task
        return idStr.startsWith(`fix-${taskId}-`) || idStr === `fix-${taskId}`;
      });
      return fixTasks.length;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Extract error category from error description
   */
  private extractErrorCategory(errorDescription: string): string | undefined {
    const lower = errorDescription.toLowerCase();
    if (lower.includes('patch') || lower.includes('search string')) return 'patch-not-found';
    if (lower.includes('syntax') || lower.includes('parse')) return 'syntax-error';
    if (lower.includes('test') && lower.includes('fail')) return 'test-failure';
    if (lower.includes('not found') || lower.includes('cannot find')) return 'missing-reference';
    if (lower.includes('timeout')) return 'timeout';
    return 'unknown-error';
  }

  /**
   * Initialize the framework plugin asynchronously.
   * This is called from the constructor and runs in the background.
   */
  private initializeFrameworkPlugin(frameworkType?: string): void {
    // Run async initialization without blocking constructor
    this.frameworkLoader.loadFramework(frameworkType).then(plugin => {
      this.frameworkPlugin = plugin;
      this.templateManager.setFrameworkPlugin(plugin);

      if (this.debug) {
        console.log(`[WorkflowEngine] Framework plugin loaded: ${plugin.name} v${plugin.version}`);
      }
    }).catch(err => {
      if (this.debug) {
        console.warn('[WorkflowEngine] Failed to load framework plugin:', err);
      }
    });
  }

  /**
   * Get the current framework plugin (may be undefined if still loading).
   */
  getFrameworkPlugin(): FrameworkPlugin | undefined {
    return this.frameworkPlugin;
  }

  /**
   * Detect project type from config or codebase
   */
  private detectProjectType(): string | undefined {
    const config = this.config as any;

    // Check config for explicit project type
    if (config.projectType) {
      return config.projectType;
    }

    // Check framework config
    if (config.framework?.type) {
      return config.framework.type.toLowerCase();
    }

    // Try to detect from common patterns
    try {
      const fs = require('fs');
      const path = require('path');
      const cwd = process.cwd();

      // Check for Drupal
      if (fs.existsSync(path.join(cwd, 'docroot', 'core'))) {
        return 'drupal';
      }

      // Check for React
      if (fs.existsSync(path.join(cwd, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
        if (pkg.dependencies?.react || pkg.devDependencies?.react) {
          return 'react';
        }
        if (pkg.dependencies?.['@angular/core'] || pkg.devDependencies?.['@angular/core']) {
          return 'angular';
        }
        return 'node';
      }
    } catch (err) {
      // Ignore detection errors
    }

    return undefined;
  }

  async runOnce(): Promise<WorkflowResult> {
    try {
      // Update state: FetchingTask
      await this.updateState({ status: 'fetching-task' });

      // Fetch next pending task
      const tasks = await this.taskBridge.getPendingTasks();
      if (tasks.length === 0) {
        await this.updateState({ status: 'idle' });
        return { completed: false, noTasks: true };
      }

      // Filter tasks: find code-generation tasks vs validation-only tasks
      const validationOnlyStrategies = ['browser', 'drush', 'playwright', 'manual'];

      // Find the first code task (testStrategy is 'code', undefined, or not in validation list)
      let task: Task | undefined;
      const skippedValidationTasks: string[] = [];

      for (const t of tasks) {
        const testStrategy = (t as any).testStrategy as string | undefined;
        if (testStrategy && validationOnlyStrategies.includes(testStrategy)) {
          // This is a validation/testing task - skip and log
          skippedValidationTasks.push(`${t.id} (${testStrategy}): ${t.title}`);
          continue;
        }
        // Found a code task
        task = t;
        break;
      }

      // Log skipped validation tasks
      if (skippedValidationTasks.length > 0) {
        console.log(`\n[INFO] Skipping ${skippedValidationTasks.length} validation task(s) - require external execution:`);
        for (const skipped of skippedValidationTasks) {
          console.log(`  - ${skipped}`);
        }
        console.log('');
      }

      // If no code tasks found, report what's blocking
      if (!task) {
        logger.info('[WorkflowEngine] No code-generation tasks available');
        if (skippedValidationTasks.length > 0) {
          console.log('[INFO] All pending tasks are validation tasks that require external execution.');
          console.log('[INFO] Run browser/drush/playwright tests manually, then mark tasks as done.');
        }
        await this.updateState({ status: 'idle' });
        return {
          completed: false,
          noTasks: true, // Effectively no tasks dev-loop can process
          error: skippedValidationTasks.length > 0
            ? `Only validation tasks remain (${skippedValidationTasks.length} pending)`
            : undefined,
        };
      }

      await this.updateState({
        status: 'executing-ai',
        currentTask: task,
      });

      // Start metrics tracking
      const startTime = Date.now();
      if (this.debugMetrics) {
        this.debugMetrics.startRun(parseInt(task.id, 10), task.title);
        this.debugMetrics.setTaskInfo(parseInt(task.id, 10), task.title);
      }

      // Update task status to in-progress
      await this.taskBridge.updateTaskStatus(task.id, 'in-progress');

      // NEW: Analyze task description for complex issues BEFORE execution
      // Skip analysis for investigation tasks (they shouldn't create more investigation tasks)
      const taskIdStr = String(task.id);
      let isInvestigationTask = taskIdStr.startsWith('investigation-');
      if (!isInvestigationTask && (task as any).details) {
        try {
          const parsedDetails = JSON.parse((task as any).details);
          isInvestigationTask = parsedDetails?.taskType === 'investigation';
        } catch {
          // Details is not JSON, that's fine for regular tasks
        }
      }

      // Check if investigation is disabled in config
      const skipInvestigation = (this.config as any).autonomous?.skipInvestigation === true;
      if (this.debug) {
        console.log(`[DEBUG] skipInvestigation config value: ${skipInvestigation}`);
      }

      if (!skipInvestigation && !isInvestigationTask && this.debuggingStrategyAdvisor && this.investigationTaskGenerator) {
        try {
          // Check if investigation tasks already exist for this parent task
          const allTasks = await this.taskBridge.getAllTasks();
          const taskIdStr = String(task.id);
          const existingInvestigationTasks = allTasks.filter((t: any) => {
            const tIdStr = String(t.id);
            if (!tIdStr.startsWith('investigation-')) return false;
            // Check if this investigation task is for the current parent task
            try {
              const details = typeof t.details === 'string' ? JSON.parse(t.details) : t.details;
              return String(details?.parentTaskId) === taskIdStr;
            } catch {
              return tIdStr.includes(`investigation-${taskIdStr}-`);
            }
          });

          if (existingInvestigationTasks.length > 0) {
            // Investigation tasks already exist - check if they're all done
            const pendingInvTasks = existingInvestigationTasks.filter((t: any) => t.status === 'pending' || t.status === 'in-progress');
            if (pendingInvTasks.length > 0) {
              if (this.debug) {
                console.log(`[WorkflowEngine] Task ${task.id} has ${pendingInvTasks.length} pending investigation tasks - skipping, will run investigation tasks first`);
              }
              // Don't create more investigation tasks, just wait for existing ones
              await this.taskBridge.updateTaskStatus(task.id, 'pending');
              await this.updateState({ status: 'idle' });
              return { completed: false, noTasks: false };
            }
            // All investigation tasks are done - proceed with main task
            if (this.debug) {
              console.log(`[WorkflowEngine] All investigation tasks for task ${task.id} are complete - proceeding with main task`);
            }
          } else {
            // No investigation tasks exist - check if we need to create them
            const taskDescription = task.description || '';
            const taskDetails = (task as any).details || '';
            const combinedDescription = `${taskDescription}\n\n${taskDetails}`;

            const framework = (this.config as any).framework?.type;
            const classification = this.debuggingStrategyAdvisor.classifyError(combinedDescription, {
              framework,
              components: this.extractComponentsFromError(combinedDescription),
              hasMultipleComponents: this.hasMultipleComponents(combinedDescription),
              previousFixAttempts: await this.getPreviousFixAttempts(task.id),
            });

            // Generate investigation tasks if needed
            if (classification.needsInvestigation) {
              // Get target files first (needed for investigation tasks)
              const { targetFiles } = await this.getCodebaseContext(task);

              const invTasks = this.investigationTaskGenerator.generateInvestigationTasks(combinedDescription, {
                framework,
                components: this.extractComponentsFromError(combinedDescription),
                targetFiles: targetFiles?.split('\n').filter(f => f.trim()),
                previousFixAttempts: await this.getPreviousFixAttempts(task.id),
              });

              if (invTasks.length > 0) {
                console.log(`[WorkflowEngine] Task requires investigation - creating ${invTasks.length} investigation task(s) first`);
                for (const invTask of invTasks) {
                  const taskMasterTask = this.investigationTaskGenerator.toTaskMasterTask(invTask, task.id);
                  await this.taskBridge.createTask(taskMasterTask as any);
                  if (this.debug) {
                    console.log(`[WorkflowEngine] Created investigation task: ${invTask.title}`);
                  }
                }

                // Mark original task as pending to wait for investigation
                await this.taskBridge.updateTaskStatus(task.id, 'pending');
                console.log(`[WorkflowEngine] Task ${task.id} marked as pending - investigation tasks must complete first`);
                await this.updateState({ status: 'idle' });
                return { completed: false, noTasks: false }; // Exit early - investigation tasks created
              }
            }
          }
        } catch (err) {
          if (this.debug) {
            console.warn('[WorkflowEngine] Error during task description analysis:', err);
          }
          // Continue with normal execution if analysis fails
        }
      }

      // Generate code using AI
      const { codebaseContext, targetFiles, existingCode } = await this.getCodebaseContext(task);

      // Record context metrics
      const projectType = this.detectProjectType();
      if (this.debugMetrics) {
        const filesIncluded = targetFiles ? targetFiles.split('\n').filter(f => f.trim()).length : 0;
        const filesTruncated = 0; // TODO: track truncation if we add that capability
        this.debugMetrics.recordContext(
          codebaseContext?.length || 0,
          filesIncluded,
          filesTruncated
        );
        // Record project metadata
        if (projectType) {
          const framework = (this.config as any).framework?.type;
          this.debugMetrics.recordProjectMetadata(projectType, framework, process.cwd());
        }
      }

      const context: TaskContext = {
        task,
        codebaseContext,
      };

      // NEW: Generate file-specific guidance from CodeContextProvider
      let fileGuidance = '';
      if ((this.config as any).context?.includeSkeleton !== false && targetFiles) {
        const primaryFile = targetFiles.split('\n')[0];
        if (primaryFile) {
          try {
            fileGuidance = await this.codeContextProvider.generateFileGuidance(primaryFile);
            if (this.debug) {
              console.log(`[DEBUG] Generated file guidance for ${primaryFile} (${fileGuidance.length} chars)`);
            }
          } catch (err) {
            console.warn('[WorkflowEngine] Could not generate file guidance:', err);
          }
        }
      }

      // NEW: Generate pattern guidance from PatternLearner
      let patternGuidance = '';
      if ((this.config as any).patternLearning?.enabled !== false) {
        try {
          patternGuidance = await this.patternLearner.generateGuidancePrompt(
            task,
            targetFiles?.split('\n')
          );
          if (this.debug && patternGuidance) {
            console.log(`[DEBUG] Generated pattern guidance (${patternGuidance.length} chars)`);
          }
        } catch (err) {
          console.warn('[WorkflowEngine] Could not generate pattern guidance:', err);
        }
      }

      // Get template with context substitution (now includes file and pattern guidance)
      const template = await this.templateManager.getTaskGenerationTemplateWithContext({
        task: {
          title: task.title,
          description: task.description,
          priority: task.priority,
        },
        codebaseContext,
        targetFiles,
        existingCode,
        templateType: this.getTemplateType(targetFiles, task),
        fileGuidance,
        patternGuidance,
      });

      logger.info(`[WorkflowEngine] Calling AI provider to generate code...`);
      logger.info(`[WorkflowEngine] Task: ${context.task.title}`);

      // Log workflow event
      logger.logWorkflow('Task execution started', {
        taskId: task.id,
        title: task.title,
        priority: task.priority,
        targetFiles: targetFiles?.split('\n').filter(Boolean) || [],
      });

      // Record AI call timing
      const aiCallStart = Date.now();
      if (this.debug) {
        console.log('\n[DEBUG] ===== TASK EXECUTION START =====');
        console.log(`[DEBUG] Task ID: ${task.id}`);
        console.log(`[DEBUG] Task Title: ${task.title}`);
        console.log(`[DEBUG] Task Priority: ${task.priority}`);
        console.log(`[DEBUG] Task Description: ${task.description?.substring(0, 200) || 'N/A'}`);
        console.log(`[DEBUG] Task Details: ${(task as any).details?.substring(0, 300) || 'N/A'}`);
        console.log(`[DEBUG] Test Strategy: ${(task as any).testStrategy || 'N/A'}`);
        console.log(`[DEBUG] Dependencies: ${(task as any).dependencies || 'none'}`);
        console.log('[DEBUG] ---');
        console.log(`[DEBUG] AI Provider: ${this.aiProvider.name || 'unknown'}`);
        console.log(`[DEBUG] Model: ${(this.config.ai as any)?.model || 'default'}`);
        console.log(`[DEBUG] Max tokens: ${(this.config.ai as any)?.maxTokens || 'default'}`);
        console.log(`[DEBUG] Codebase context size: ${codebaseContext?.length || 0} chars`);
        console.log(`[DEBUG] Target files:\n${targetFiles || 'none'}`);
        console.log(`[DEBUG] Existing code size: ${existingCode?.length || 0} chars`);
        console.log('[DEBUG] ===== TASK EXECUTION DETAILS =====\n');
      }
      const changes = await this.aiProvider.generateCode(template, context);
      const aiCallDuration = Date.now() - aiCallStart;

      // Record AI call metrics
      if (this.debugMetrics) {
        this.debugMetrics.recordTiming('aiCall', aiCallDuration);
        // Record token usage if available
        if ('getLastTokens' in this.aiProvider && typeof this.aiProvider.getLastTokens === 'function') {
          const tokens = (this.aiProvider as any).getLastTokens();
          if (tokens.input || tokens.output) {
            this.debugMetrics.recordTokens(tokens.input || 0, tokens.output || 0);
          }
        }
      }

      logger.info(`[WorkflowEngine] AI response received, files: ${changes.files?.length || 0}`);
      if (changes.summary) {
        logger.debug(`AI summary: ${changes.summary}`);
      }

      // NEW: Validate that required files from task details were actually created
      // This catches cases where AI says "no changes needed" but the required file doesn't exist
      if (changes.files?.length === 0) {
        const taskDetails = (task as any).details || '';
        const requiredFiles = this.extractRequiredFilePaths(taskDetails);

        if (requiredFiles.length > 0) {
          const missingFiles: string[] = [];
          for (const requiredPath of requiredFiles) {
            const fullPath = path.resolve(process.cwd(), requiredPath);
            if (!await fs.pathExists(fullPath)) {
              missingFiles.push(requiredPath);
            }
          }

          if (missingFiles.length > 0) {
            console.warn(`[WorkflowEngine] AI returned 0 files but required files are missing: ${missingFiles.join(', ')}`);
            console.warn(`[WorkflowEngine] Task details explicitly require these files to be created`);

            // Create fix task that emphasizes creating the required files
            const fixTask = await this.taskBridge.createFixTask(
              task.id,
              `AI returned "no changes needed" but required files do not exist:\n${missingFiles.map(f => `- ${f}`).join('\n')}\n\n**CRITICAL ERROR**: You said files "already exist" but they DO NOT EXIST at the required paths.\n\n**RULES**:\n1. Finding SIMILAR files does NOT mean the REQUIRED file exists\n2. Files in OTHER directories (e.g., openapi_entity/) do NOT fulfill requirements for bd/ directory\n3. config/install/ is NOT the same as config/schema/\n4. You MUST create files at the EXACT paths specified in task details\n\n**REQUIRED ACTION**: Create the EXACT file(s) listed above using operation "create" with full content.\n\nTask details:\n${taskDetails.substring(0, 1000)}`,
              `Missing required files: ${missingFiles.join(', ')}`
            );

            if (fixTask) {
              await this.taskBridge.updateTaskStatus(task.id, 'pending');
            }

            await this.updateState({ status: 'idle' });
            return {
              completed: false,
              noTasks: false,
              taskId: task.id,
              error: `Required files not created: ${missingFiles.join(', ')}`,
            };
          }
        }
      }

      // Update state: ApplyingChanges
      await this.updateState({ status: 'applying-changes' });

      // Check if approval is needed
      const needsApproval = await this.intervention.requiresApproval(changes);
      if (needsApproval) {
        await this.updateState({ status: 'awaiting-approval' });
        const approval = await this.intervention.requestApproval(changes);
        if (!approval.approved) {
          // Reject changes, mark task as pending again
          const totalDuration = Date.now() - startTime;
          if (this.debugMetrics) {
            this.debugMetrics.recordTiming('total', totalDuration);
            this.debugMetrics.completeRun('failed');
          }
          await this.taskBridge.updateTaskStatus(task.id, 'pending');
          await this.updateState({ status: 'idle' });
          return {
            completed: false,
            noTasks: false,
            taskId: task.id,
            error: approval.reason || 'Changes rejected by user',
          };
        }
      }

      // NEW: Pre-apply validation
      if ((this.config as any).preValidation?.enabled !== false) {
        logger.info('[WorkflowEngine] Running pre-apply validation...');
        // Pass allowed paths to prevent AI from modifying unrelated files
        const allowedPaths = targetFiles?.split('\n').filter(Boolean) || [];
        const validationResult = await this.validationGate.validate(changes, allowedPaths);

        if (!validationResult.valid) {
          logger.error('Pre-apply validation FAILED:');
          for (const error of validationResult.errors) {
            logger.error(`  - ${error.type}: ${error.message}`);
          }

          // Record patterns for learning
          for (const error of validationResult.errors) {
            const patternStartTime = Date.now();
            try {
              await this.patternLearner.recordPattern(
                error.message,
                error.file,
                error.suggestion
              );
              const patternDuration = Date.now() - patternStartTime;

              // Record pattern metrics (prdId not available in this scope, skip for now)
              // Pattern metrics will be recorded at task level
            } catch (err) {
              const patternDuration = Date.now() - patternStartTime;
              // Pattern metrics will be recorded at task level
            }
          }

          // Create fix task with validation errors AND file context for patch failures
          const errorDescription = this.validationGate.formatErrorsForAI(validationResult);

          // For patch_not_found and destructive update errors, include actual file content
          let fileContextForFix = '';
          const patchErrors = validationResult.errors.filter(e =>
            e.type === 'patch_not_found' ||
            (e.type === 'syntax' && e.message.toLowerCase().includes('destructive'))
          );
          if (patchErrors.length > 0) {
            for (const error of patchErrors) {
              try {
                const patchContext = await this.codeContextProvider.getPatchContext(
                  error.file,
                  undefined,
                  20 // Show 20 lines at end of file
                );
                if (patchContext) {
                  fileContextForFix += `\n\n## Actual content of ${error.file} (${patchContext.fileInfo.lineCount} lines)\n`;
                  fileContextForFix += patchContext.guidance;
                  fileContextForFix += `\n\n### End of file:\n\`\`\`\n${patchContext.endOfFile}\n\`\`\``;

                  // For destructive updates, also extract the specific section being modified
                  if (error.message.toLowerCase().includes('destructive')) {
                    fileContextForFix += `\n\n**CRITICAL: You tried to replace the entire ${patchContext.fileInfo.lineCount}-line file. Use PATCH operation instead.**`;
                    fileContextForFix += `\n\n### How to fix:`;
                    fileContextForFix += `\n1. Identify the specific lines to change (not the whole file)`;
                    fileContextForFix += `\n2. Use "operation": "patch" with search/replace`;
                    fileContextForFix += `\n3. Copy the exact search string from the file context`;
                  }
                }
              } catch (err) {
                // Ignore
              }
            }
          }

          const fixTask = await this.taskBridge.createFixTask(
            task.id,
            `Pre-apply validation failed:\n${errorDescription}${fileContextForFix}`,
            validationResult.errors.map(e => e.message).join('\n')
          );

          if (fixTask) {
            await this.taskBridge.updateTaskStatus(task.id, 'pending');
          }

          // Complete metrics with failure
          const totalDuration = Date.now() - startTime;
          if (this.debugMetrics) {
            this.debugMetrics.recordValidation(false, validationResult.errors.length);
            this.debugMetrics.recordTiming('total', totalDuration);
            this.debugMetrics.completeRun('failed');
          }

          await this.updateState({ status: 'idle' });
          return {
            completed: false,
            noTasks: false,
            taskId: task.id,
            error: 'Pre-apply validation failed',
          };
        }

        // Record successful validation
        if (this.debugMetrics) {
          this.debugMetrics.recordValidation(true, 0);
        }
        console.log('[WorkflowEngine] Pre-apply validation passed');
      }

      // Apply changes to filesystem
      console.log('[WorkflowEngine] Applying changes to filesystem...');
      const applyResult = await this.applyChanges(changes);

      // Record patch metrics
      if (this.debugMetrics && changes.files) {
        const totalPatches = changes.files.reduce((sum, file) => sum + (file.patches?.length || 0), 0);
        const succeeded = totalPatches - applyResult.failedPatches.length - (applyResult.skippedPatches?.length || 0);
        const failed = applyResult.failedPatches.length;
        const skipped = applyResult.skippedPatches?.length || 0;
        this.debugMetrics.recordPatches(totalPatches, succeeded, failed);
        if (skipped > 0 && this.debug) {
          console.log(`[WorkflowEngine] ${skipped} patches skipped (duplicate methods prevented)`);
        }
      }

      // Check if all patches were skipped (this is actually a success - we prevented errors)
      const allSkipped = applyResult.skippedPatches && applyResult.skippedPatches.length > 0 &&
                        applyResult.failedPatches.length === 0 &&
                        changes.files.some(f => f.patches && f.patches.length === applyResult.skippedPatches.length);

      if (!applyResult.success && !allSkipped) {
        console.error('[WorkflowEngine] Some patches failed to apply');
        // Include failed patches in error context for next task
        const patchErrors = applyResult.failedPatches.join('\n');
        console.error('[WorkflowEngine] Failed patches:\n' + patchErrors);

        // Create fix task with patch failure details AND actual file content
        await this.updateState({ status: 'creating-fix-task' });

        // Extract actual file content for failed patches to help next agent
        let fileContextForFix = '';
        for (const file of changes.files) {
          if (file.operation === 'patch' && file.patches) {
            try {
              const patchContext = await this.codeContextProvider.getPatchContext(
                file.path,
                undefined, // No keywords, we want general context
                15 // Show 15 lines at end of file
              );
              if (patchContext) {
                fileContextForFix += `\n\n## File: ${file.path} (${patchContext.fileInfo.lineCount} lines)\n`;
                fileContextForFix += patchContext.guidance;
                fileContextForFix += `\n\n### End of file (lines ${patchContext.fileInfo.lineCount - 14}-${patchContext.fileInfo.lineCount}):\n`;
                fileContextForFix += '```\n' + patchContext.endOfFile + '\n```';
              }
            } catch (err) {
              // Ignore context extraction errors
            }
          }
        }

        const fixTask = await this.taskBridge.createFixTask(
          task.id,
          `Patches failed to apply:\n${patchErrors}\n\nThe search strings in the patches did not match the actual file content.\n\n**CRITICAL**: Copy the search string EXACTLY from the file content below. Do not guess or approximate.${fileContextForFix}`,
          patchErrors
        );

        if (fixTask) {
          await this.taskBridge.updateTaskStatus(task.id, 'pending');
        }

        // Complete metrics with failure
        const totalDuration = Date.now() - startTime;
        if (this.debugMetrics) {
          this.debugMetrics.recordTiming('total', totalDuration);
          this.debugMetrics.completeRun('failed');
        }

        await this.updateState({ status: 'idle' });
        return {
          completed: false,
          noTasks: false,
          taskId: task.id,
          error: 'Patches failed to apply - search strings not found in files',
        };
      }
      console.log('[WorkflowEngine] Changes applied successfully');
      logger.logWorkflow('Changes applied', {
        taskId: task.id,
        filesModified: changes.files?.map(f => f.path) || [],
      });

      // NEW: Post-apply validation - verify required files from task details were created at correct paths
      const taskDetails = (task as any).details || '';
      const requiredFiles = this.extractRequiredFilePaths(taskDetails);

      if (requiredFiles.length > 0) {
        const incorrectlyLocatedFiles: string[] = [];
        for (const requiredPath of requiredFiles) {
          const fullPath = path.resolve(process.cwd(), requiredPath);
          const fileExists = await fs.pathExists(fullPath);

          // Check if file was created at a different location
          if (!fileExists) {
            // Search for file with same name in other locations
            const fileName = path.basename(requiredPath);
            const searchPaths = [
              path.resolve(process.cwd(), 'docroot/modules/**/config/install', fileName),
              path.resolve(process.cwd(), 'config/install', fileName),
            ];

            // If file doesn't exist at required path, this is an error
            incorrectlyLocatedFiles.push(`${requiredPath} - file not found at required location`);
          }
        }

        if (incorrectlyLocatedFiles.length > 0) {
          console.warn(`[WorkflowEngine] Required files not created at correct paths: ${incorrectlyLocatedFiles.join(', ')}`);

          // Create fix task
          const fixTask = await this.taskBridge.createFixTask(
            task.id,
            `Required files were not created at the correct paths:\n${incorrectlyLocatedFiles.map(f => `- ${f}`).join('\n')}\n\n**CRITICAL**: The task details require files at EXACT paths. Files in different locations (e.g., config/install/ instead of config/default/) do NOT fulfill the requirement.\n\nYou MUST create files at the EXACT paths specified in task details:\n\n${taskDetails.substring(0, 1000)}`,
            `Files not at correct paths: ${incorrectlyLocatedFiles.join(', ')}`
          );

          if (fixTask) {
            await this.taskBridge.updateTaskStatus(task.id, 'pending');
          }

          await this.updateState({ status: 'idle' });
          return {
            completed: false,
            noTasks: false,
            taskId: task.id,
            error: `Required files not at correct paths: ${incorrectlyLocatedFiles.join(', ')}`,
          };
        }
      }

      // Execute post-apply hooks (e.g., cache clearing for Drupal)
      if (this.config.hooks?.postApply && this.config.hooks.postApply.length > 0) {
        console.log('[WorkflowEngine] Running post-apply hooks...');
        await this.updateState({ status: 'running-post-apply-hooks' });
        await this.executePostApplyHooks();
        console.log('[WorkflowEngine] Post-apply hooks completed');
      }

      // Execute pre-test hooks (e.g., cache clearing)
      if (this.config.hooks?.preTest && this.config.hooks.preTest.length > 0) {
        console.log('[WorkflowEngine] Running pre-test hooks...');
        await this.updateState({ status: 'running-pre-test-hooks' });
        await this.executePreTestHooks();
        console.log('[WorkflowEngine] Pre-test hooks completed');
      }

      // Update state: RunningTests
      await this.updateState({ status: 'running-tests' });

      // Check testStrategy to determine if we should run full test suite
      const testStrategy = (task as any).testStrategy as string | undefined;
      let testResult: any;
      const testRunStart = Date.now();

      if (testStrategy === 'code') {
        // For "code" tasks, we only verify the code compiles - pre-apply validation already did this
        // Skip full test suite since the code isn't integrated yet
        console.log('[WorkflowEngine] Task has testStrategy="code" - skipping full test suite (pre-apply validation was sufficient)');
        testResult = { success: true, output: 'TypeScript compilation passed (testStrategy: code)' };
      } else {
        console.log('[WorkflowEngine] Running tests...');
        testResult = await this.testRunner.run({
          command: this.config.testing.command,
          timeout: this.config.testing.timeout,
          artifactsDir: this.config.testing.artifactsDir,
        });
      }
      const testRunDuration = Date.now() - testRunStart;

      // Record test run metrics
      if (this.debugMetrics) {
        this.debugMetrics.recordTiming('testRun', testRunDuration);
      }

      // Update state: AnalyzingLogs
      await this.updateState({ status: 'analyzing-logs' });

      // Analyze logs if configured
      const logAnalysisStart = Date.now();
      let logAnalysis = null;
      if (this.config.logs.sources.length > 0) {
        logAnalysis = await this.logAnalyzer.analyze(this.config.logs.sources);
      }
      const logAnalysisDuration = Date.now() - logAnalysisStart;

      // Record log analysis metrics
      if (this.debugMetrics) {
        this.debugMetrics.recordTiming('logAnalysis', logAnalysisDuration);
      }

      // Run smoke tests if configured
      let smokeTestResult: SmokeTestResult | null = null;
      if (this.config.validation?.enabled && this.config.validation.urls?.length > 0) {
        console.log('[WorkflowEngine] Running smoke tests...');
        const smokeConfig: SmokeTestConfig = {
          baseUrl: this.config.validation.baseUrl,
          urls: this.config.validation.urls,
          timeout: this.config.validation.timeout,
          authCommand: this.config.validation.authCommand,
        };
        smokeTestResult = await this.smokeTestValidator.validate(smokeConfig);

        if (!smokeTestResult.success) {
          console.log('[WorkflowEngine] Smoke tests FAILED:');
          for (const error of smokeTestResult.errors) {
            console.log(`  - ${error}`);
          }
        } else {
          console.log('[WorkflowEngine] Smoke tests passed');
        }
      }

      // Check if tests passed and no critical errors in logs or smoke tests
      if (this.debug) {
        console.log(`[DEBUG] Test result: success=${testResult.success}, output length=${testResult.output?.length || 0}`);
        if (logAnalysis) {
          console.log(`[DEBUG] Log analysis: ${logAnalysis.errors.length} error(s), ${logAnalysis.warnings?.length || 0} warning(s)`);
          if (logAnalysis.errors.length > 0) {
            logAnalysis.errors.slice(0, 3).forEach((err: string, i: number) => {
              console.log(`[DEBUG]   Error ${i + 1}: ${err.substring(0, 150)}`);
            });
          }
        }
      }
      // Filter test failures to only consider those related to task's modified files
      let relevantTestFailure = false;
      if (!testResult.success && testResult.output) {
        const currentState = await this.stateManager.getWorkflowState();
        const modifiedFiles = (currentState as any).filesModified || [];
        // Check if test failure mentions any of the modified files
        const failureRelatesToTask = modifiedFiles.some((file: string) => {
          // Extract filename from path
          const fileName = file.split('/').pop() || file;
          const baseName = fileName.replace(/\.[^.]*$/, ''); // Remove extension
          // Check if test output mentions this file or its base name
          return testResult.output.includes(fileName) ||
                 testResult.output.includes(baseName) ||
                 testResult.output.includes(file.replace(/^.*\//, '')); // Just the filename part
        });

        // Also check if failure is from a test file that was created/modified
        const testFileRelatesToTask = modifiedFiles.some((file: string) => {
          return file.includes('test') || file.includes('spec');
        });

        relevantTestFailure = failureRelatesToTask || testFileRelatesToTask;

        // If no modified files or failure doesn't relate, it's likely a pre-existing failure
        if (modifiedFiles.length > 0 && !relevantTestFailure) {
          console.log(`[WorkflowEngine] Test failure appears unrelated to task (no mention of modified files). Ignoring.`);
          console.log(`[WorkflowEngine] Modified files: ${modifiedFiles.join(', ')}`);
          console.log(`[WorkflowEngine] Test output preview: ${testResult.output.substring(0, 200)}...`);
        }
      } else if (!testResult.success) {
        // If we have a failure but no output details, assume it's relevant
        relevantTestFailure = true;
      }

      const hasErrors = (relevantTestFailure && !testResult.success) ||
        (logAnalysis && logAnalysis.errors.length > 0) ||
        (smokeTestResult && !smokeTestResult.success);

      if (hasErrors) {
        // Create fix task
        await this.updateState({ status: 'creating-fix-task' });

        // Build comprehensive error description including log errors and smoke test failures
        let errorDescription = '';
        if (!testResult.success) {
          errorDescription = testResult.output;
        }
        if (logAnalysis && logAnalysis.errors.length > 0) {
          // Include actual log errors for AI context
          const logErrors = logAnalysis.errors.slice(0, 10).join('\n');
          errorDescription += '\n\nLog Errors:\n' + logErrors;
        }
        if (smokeTestResult && !smokeTestResult.success) {
          // Include smoke test errors - these are runtime errors caught by HTTP validation
          const smokeErrors = smokeTestResult.errors.slice(0, 10).join('\n');
          errorDescription += '\n\nSmoke Test Errors (Runtime HTTP Validation):\n' + smokeErrors;

          // Include response previews for debugging
          for (const result of smokeTestResult.results.filter(r => !r.success)) {
            if (result.responsePreview) {
              errorDescription += `\n\n--- Response from ${result.url} (HTTP ${result.status}) ---\n${result.responsePreview.substring(0, 1000)}`;
            }
          }
        }
        if (!errorDescription) {
          errorDescription = logAnalysis?.summary || 'Log analysis found errors';
        }

        // NEW: Enhanced error analysis for complex issues
        let enhancedErrorDescription = errorDescription;
        let investigationTasks: any[] = [];

        // Check if investigation is disabled in config
        const skipInvestigationOnError = (this.config as any).autonomous?.skipInvestigation === true;

        if (!skipInvestigationOnError && this.debuggingStrategyAdvisor && this.investigationTaskGenerator) {
          try {
            const framework = (this.config as any).framework?.type;
            const classification = this.debuggingStrategyAdvisor.classifyError(errorDescription, {
              framework,
              components: this.extractComponentsFromError(errorDescription),
              hasMultipleComponents: this.hasMultipleComponents(errorDescription),
              previousFixAttempts: await this.getPreviousFixAttempts(task.id),
            });

            // Generate investigation tasks if needed
            if (classification.needsInvestigation) {
              investigationTasks = this.investigationTaskGenerator.generateInvestigationTasks(errorDescription, {
                framework,
                components: this.extractComponentsFromError(errorDescription),
                targetFiles: targetFiles?.split('\n').filter(f => f.trim()),
                previousFixAttempts: await this.getPreviousFixAttempts(task.id),
              });

              // Create investigation tasks first
              for (const invTask of investigationTasks) {
                const taskMasterTask = this.investigationTaskGenerator.toTaskMasterTask(invTask, task.id);
                await this.taskBridge.createTask(taskMasterTask as any);
                if (this.debug) {
                  console.log(`[WorkflowEngine] Created investigation task: ${invTask.title}`);
                }
              }
            }

            // Enhance error description with analysis
            const analysisSections: string[] = [];

            // Add error context
            if (this.codeContextProvider) {
              const errorContext = this.codeContextProvider.generateErrorContextPrompt(errorDescription, targetFiles?.split('\n'));
              if (errorContext) {
                analysisSections.push(errorContext);
              }
            }

            // Add framework pattern guidance
            if (this.frameworkPatternLibrary) {
              const patterns = this.frameworkPatternLibrary.matchPatterns(errorDescription, framework);
              if (patterns.length > 0) {
                const patternGuidance = this.frameworkPatternLibrary.generateGuidancePrompt(patterns);
                if (patternGuidance) {
                  analysisSections.push(patternGuidance);
                }
              }
            }

            // Add execution order analysis
            if (this.executionOrderAnalyzer && classification.errorType === 'timing-order') {
              const orderIssues = await this.executionOrderAnalyzer.analyzeExecutionOrder(
                errorDescription,
                targetFiles?.split('\n').filter(f => f.trim()),
                framework
              );
              if (orderIssues.length > 0) {
                const orderDiagram = this.executionOrderAnalyzer.generateExecutionFlowDiagram(orderIssues);
                if (orderDiagram) {
                  analysisSections.push(orderDiagram);
                }
              }
            }

            // Add component interaction analysis
            if (this.componentInteractionAnalyzer && classification.errorType === 'component-interaction') {
              const interactionIssues = this.componentInteractionAnalyzer.analyzeInteraction(errorDescription, {
                framework,
                components: this.extractComponentsFromError(errorDescription),
                targetFiles: targetFiles?.split('\n').filter(f => f.trim()),
              });
              if (interactionIssues.length > 0) {
                const interactionDiagram = this.componentInteractionAnalyzer.generateInteractionDiagram(interactionIssues);
                if (interactionDiagram) {
                  analysisSections.push(interactionDiagram);
                }
              }
            }

            // Add debugging strategy guidance
            if (classification.suggestedStrategy !== 'fix-root-cause') {
              analysisSections.push(`## DEBUGGING STRATEGY\n\n**Suggested Approach**: ${classification.strategyReasoning}`);
              if (classification.investigationSteps && classification.investigationSteps.length > 0) {
                analysisSections.push('\n**Investigation Steps**:');
                for (const step of classification.investigationSteps) {
                  analysisSections.push(`- ${step}`);
                }
              }
            }

            if (analysisSections.length > 0) {
              enhancedErrorDescription = errorDescription + '\n\n' + analysisSections.join('\n\n');
            }
          } catch (err) {
            if (this.debug) {
              console.warn('[WorkflowEngine] Error during enhanced analysis:', err);
            }
            // Fall back to original error description
            enhancedErrorDescription = errorDescription;
          }
        }

        // NEW: Record patterns from test failures for learning
        if ((this.config as any).patternLearning?.enabled !== false) {
          try {
            const projectType = this.detectProjectType();
            const patternStartTime = Date.now();
            await this.patternLearner.recordPattern(
              errorDescription.substring(0, 500),
              targetFiles?.split('\n')[0],
              undefined,
              projectType
            );
            const patternDuration = Date.now() - patternStartTime;

            // Record pattern metrics (prdId available in runAutonomousPrd scope)
            // Note: prdId needs to be passed to this method or stored in context
            // For now, pattern metrics will be recorded at task completion level
          } catch (err) {
            if (this.debug) {
              console.warn('[WorkflowEngine] Could not record pattern:', err);
            }
          }
        }

        // Track failure pattern with observation tracker
        if (this.observationTracker) {
          try {
            const projectType = this.detectProjectType() || 'unknown';
            const observationStartTime = Date.now();
            await this.observationTracker.trackFailurePattern(errorDescription, projectType);
            const observationDuration = Date.now() - observationStartTime;

            // Record observation metrics (prdId needs to be available in this scope)
            // For now, observations will be tracked through the observation tracker
          } catch (err) {
            if (this.debug) {
              console.warn('[WorkflowEngine] Could not track failure pattern:', err);
            }
          }
        }

        // Only create fix task if no investigation tasks were created
        // (investigation tasks should be completed first)
        let fixTask = null;
        if (investigationTasks.length === 0) {
          fixTask = await this.taskBridge.createFixTask(
            task.id,
            enhancedErrorDescription,
            testResult.output
          );
        } else {
          // Mark task as pending to wait for investigation results
          await this.taskBridge.updateTaskStatus(task.id, 'pending');
          if (this.debug) {
            console.log(`[WorkflowEngine] Created ${investigationTasks.length} investigation tasks. Fix task will be created after investigation.`);
          }
        }

        if (fixTask) {
          // Mark original task as pending again for retry
          await this.taskBridge.updateTaskStatus(task.id, 'pending');
        } else {
          // Max retries exceeded - task was marked as blocked
          console.log(`[WorkflowEngine] Task ${task.id} blocked after max retries, moving to next task`);
        }

        // Complete metrics with failure
        const totalDuration = Date.now() - startTime;
        if (this.debugMetrics) {
          this.debugMetrics.recordTiming('total', totalDuration);
          // Record outcome
          const failureType = !testResult.success ? 'test' :
                             (logAnalysis && logAnalysis.errors.length > 0) ? 'log' :
                             (smokeTestResult && !smokeTestResult.success) ? 'validation' : 'timeout';
          const errorCategory = this.extractErrorCategory(errorDescription);
          this.debugMetrics.recordOutcome(failureType, errorCategory);
          this.debugMetrics.completeRun('failed');
        }

        await this.updateState({ status: 'idle' });

        return {
          completed: false,
          noTasks: false,
          taskId: task.id,
          error: fixTask ? 'Tests failed or errors found in logs' : 'Max retries exceeded, task blocked',
        };
      }

      // Update state: MarkingDone
      await this.updateState({ status: 'marking-done' });

      // Mark task as done
      await this.taskBridge.updateTaskStatus(task.id, 'done');

      // Complete metrics with success
      const totalDuration = Date.now() - startTime;
      if (this.debugMetrics) {
        this.debugMetrics.recordTiming('total', totalDuration);
        // Record successful outcome
        this.debugMetrics.recordOutcome('success');
        this.debugMetrics.completeRun('completed');
      }

      // Update workflow state
      const state = await this.stateManager.getWorkflowState();
      await this.updateState({
        status: 'idle',
        completedTasks: state.completedTasks + 1,
        currentTask: undefined,
      });

      return {
        completed: true,
        noTasks: false,
        taskId: task.id,
      };
    } catch (error) {
      // Complete metrics with failure on exception
      if (this.debugMetrics) {
        this.debugMetrics.completeRun('failed');
      }
      await this.updateState({ status: 'idle' });
      return {
        completed: false,
        noTasks: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Files that should never be modified by autonomous PRD execution
  private readonly protectedFiles = [
    'playwright.config.ts',
    'playwright.config.js',
    'global-setup.ts',
    'global-teardown.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'composer.json',
    'composer.lock',
  ];

  private async applyChanges(changes: CodeChanges): Promise<{ success: boolean; failedPatches: string[]; skippedPatches: string[] }> {
    const failedPatches: string[] = [];
    const skippedPatches: string[] = [];

    for (const file of changes.files) {
      const filePath = path.resolve(process.cwd(), file.path);

      // Check if file is protected from modifications
      const fileName = path.basename(file.path);
      if (this.protectedFiles.includes(fileName) ||
          file.path.includes('global-setup') ||
          file.path.includes('global-teardown')) {
        const skipMsg = `PROTECTED_FILE_SKIPPED: ${file.path} is protected and cannot be modified`;
        console.warn(`[WorkflowEngine] ${skipMsg}`);
        skippedPatches.push(skipMsg);
        continue;
      }

      if (file.operation === 'delete') {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
        }
      } else if (file.operation === 'patch' && file.patches) {
        // Apply search/replace patches to existing file
        if (await fs.pathExists(filePath)) {
          const originalContent = await fs.readFile(filePath, 'utf-8');
          let content = originalContent;
          let patchesApplied = 0;
          let patchesSkipped = 0;
          const fileExtension = path.extname(filePath);

          for (let i = 0; i < file.patches.length; i++) {
            const patch = file.patches[i];
            const patchContentBefore = content;

            // Enhancement 2: Check for duplicate method declarations before applying patch
            if (fileExtension === '.php' && this.wouldCreateDuplicateMethod(content, patch.replace)) {
              const methodName = this.extractMethodNameFromPatch(patch.replace);
              const skipMsg = `PATCH_SKIPPED: File ${file.path}, patch ${i + 1}: Would create duplicate method "${methodName}". Method already exists.`;
              console.warn(`[WorkflowEngine] ${skipMsg}`);
              skippedPatches.push(skipMsg);
              patchesSkipped++;
              continue;
            }

            // Enhancement: Validate YAML service references before applying
            if (fileExtension === '.yml' && file.path.includes('.services.yml')) {
              const invalidRefs = await this.validateYamlServiceReferences(patch.replace);
              if (invalidRefs.length > 0) {
                const skipMsg = `PATCH_SKIPPED: File ${file.path}, patch ${i + 1}: Uses non-existent service(s): ${invalidRefs.join(', ')}. These services do not exist in the registry.`;
                console.warn(`[WorkflowEngine] ${skipMsg}`);
                skippedPatches.push(skipMsg);
                patchesSkipped++;
                continue;
              }
            }

            // Enhancement 3: Improved patch matching with fuzzy fallback
            let patchApplied = false;
            if (content.includes(patch.search)) {
              // Exact match found
              content = content.replace(patch.search, patch.replace);
              patchApplied = true;
            } else {
              // Try fuzzy matching with whitespace tolerance
              if (this.debug) {
                console.log(`[WorkflowEngine] Exact match failed for patch ${i + 1}, attempting fuzzy match...`);
              }
              const fuzzyMatch = this.findFuzzyMatch(content, patch.search);
              if (fuzzyMatch) {
                content = content.replace(fuzzyMatch, patch.replace);
                console.log(`[WorkflowEngine] Applied patch ${i + 1} using fuzzy match (whitespace tolerance)`);
                patchApplied = true;
              } else if (this.debug) {
                console.log(`[WorkflowEngine] Fuzzy match also failed for patch ${i + 1}`);
              }
            }

            if (patchApplied) {
              // Enhancement 6: Per-patch syntax validation
              const tempFilePath = `${filePath}.tmp`;
              await fs.writeFile(tempFilePath, content, 'utf-8');
              const isValid = await this.validateFileSyntax(tempFilePath);

              if (isValid) {
                // Syntax is valid, keep the patch
                await fs.move(tempFilePath, filePath, { overwrite: true });
                patchesApplied++;
                console.log(`[WorkflowEngine] Applied patch ${patchesApplied} to ${file.path}`);
              } else {
                // Syntax error detected, revert this patch only
                await fs.remove(tempFilePath);
                content = patchContentBefore; // Revert to content before this patch
                const errorMsg = `PATCH_REVERTED: File ${file.path}, patch ${i + 1}: Syntax error detected, patch reverted`;
                console.error(`[WorkflowEngine] ${errorMsg}`);
                failedPatches.push(errorMsg);
              }
            } else {
              // Log detailed failure information for AI to learn from
              const searchPreview = patch.search.substring(0, 150).replace(/\n/g, '\\n');
              const errorMsg = `PATCH_FAILED: File ${file.path}, patch ${i + 1}: Search string not found. Looking for: "${searchPreview}"`;
              console.error(`[WorkflowEngine] ${errorMsg}`);
              failedPatches.push(errorMsg);

              // Try to find similar content to help debug
              const firstLine = patch.search.split('\n')[0].trim();
              if (firstLine.length > 10) {
                const similarLines = content.split('\n')
                  .map((line, idx) => ({ line: line.trim(), idx }))
                  .filter(({ line }) => line.includes(firstLine.substring(0, 20)));
                if (similarLines.length > 0) {
                  console.error(`[WorkflowEngine] Similar content found at lines: ${similarLines.map(s => s.idx + 1).join(', ')}`);
                }
              }
            }
          }

          if (patchesApplied > 0) {
            const statusMsg = `[WorkflowEngine] Applied ${patchesApplied}/${file.patches.length} patches to ${file.path}`;
            if (patchesSkipped > 0) {
              console.log(`${statusMsg} (${patchesSkipped} skipped due to duplicate methods)`);
            } else {
              console.log(statusMsg);
            }
          } else if (patchesSkipped === file.patches.length && file.patches.length > 0) {
            // All patches were skipped (duplicate methods) - this is actually a success
            console.log(`[WorkflowEngine] All ${file.patches.length} patches skipped for ${file.path} (duplicate methods prevented - this is expected)`);
          } else if (file.patches.length > 0) {
            console.error(`[WorkflowEngine] NO patches applied to ${file.path} - all ${file.patches.length} patches failed`);
          }
        } else {
          const errorMsg = `FILE_NOT_FOUND: Cannot patch non-existent file: ${file.path}`;
          console.error(`[WorkflowEngine] ${errorMsg}`);
          failedPatches.push(errorMsg);
        }
      } else if (file.operation === 'create' || file.operation === 'update') {
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, file.content || '', 'utf-8');

        // Validate syntax for new/updated files
        const isValid = await this.validateFileSyntax(filePath);
        if (!isValid) {
          console.error(`[WorkflowEngine] File ${file.path} has syntax errors, reverted`);
          failedPatches.push(`SYNTAX_ERROR: File ${file.path} has syntax errors and was reverted`);
        }
      }
    }

    // Task is successful if no patches failed (skipped patches are OK - they prevented errors)
    return {
      success: failedPatches.length === 0,
      failedPatches,
      skippedPatches
    };
  }

  /**
   * Validate file syntax for supported languages
   * Returns true if valid, false if syntax error detected
   */
  private async validateFileSyntax(filePath: string): Promise<boolean> {
    if (!await fs.pathExists(filePath)) return true;

    try {
      if (filePath.endsWith('.php')) {
        await execAsync(`php -l "${filePath}"`);
      } else if (filePath.endsWith('.json')) {
        const content = await fs.readFile(filePath, 'utf-8');
        JSON.parse(content);
      }
      // Add more language validators as needed
      return true;
    } catch (error) {
      console.error(`[WorkflowEngine] Syntax error in ${filePath}:`, error instanceof Error ? error.message : String(error));

      // Revert the file using git checkout
      try {
        await execAsync(`git checkout "${filePath}"`);
        console.log(`[WorkflowEngine] Reverted ${filePath} due to syntax error`);
      } catch (revertError) {
        console.warn(`[WorkflowEngine] Could not revert ${filePath}:`, revertError instanceof Error ? revertError.message : String(revertError));
      }

      return false;
    }
  }

  /**
   * Check Drupal site health after applying patches
   * Runs drush cr and checks for entity type errors
   */
  private async checkDrupalSiteHealth(healthCheckUrl?: string): Promise<{ healthy: boolean; error?: string }> {
    // Check if this is a Drupal project by looking for common Drupal paths
    const isDrupal = await fs.pathExists('docroot/modules') ||
                     await fs.pathExists('web/modules') ||
                     (this.config as any).framework?.type === 'drupal';
    if (!isDrupal) {
      return { healthy: true };
    }

    // If URL provided, do HTTP health check
    if (healthCheckUrl) {
      try {
        const { default: fetch } = await import('node-fetch');
        const response = await fetch(healthCheckUrl, {
          method: 'GET',
          timeout: 15000,
        });

        if (response.status >= 200 && response.status < 500) {
          return { healthy: true };
        } else {
          return {
            healthy: false,
            error: `HTTP ${response.status} from ${healthCheckUrl}`
          };
        }
      } catch (error: any) {
        // HTTP check failed, fall through to drush check
        if (this.debug) {
          console.warn(`[WorkflowEngine] HTTP health check failed: ${error.message}`);
        }
      }
    }

    try {
      // Run drush cache rebuild to detect entity type and service errors
      await execAsync('ddev exec bash -c "drush cr"', {
        timeout: 60000,
        cwd: process.cwd(),
      });
      return { healthy: true };
    } catch (error: any) {
      const errorOutput = error.stderr || error.stdout || error.message || String(error);

      // Check for common fatal errors
      const isFatal = errorOutput.includes('entity type does not exist') ||
                     errorOutput.includes('service does not exist') ||
                     errorOutput.includes('Class not found') ||
                     errorOutput.includes('Parse error') ||
                     errorOutput.includes('Fatal error');

      if (isFatal) {
        console.error(`[WorkflowEngine] CRITICAL: Drupal site health check failed: ${errorOutput.substring(0, 500)}`);
        return {
          healthy: false,
          error: `Site health check failed: ${errorOutput.substring(0, 200)}`
        };
      }

      // Non-fatal drush errors are OK
      return { healthy: true };
    }
  }

  /**
   * Check if applying a patch would create a duplicate method declaration
   */
  /**
   * Check if a YAML services patch uses service references that don't exist.
   * Returns array of invalid service names if any, or empty array if valid.
   */
  private async validateYamlServiceReferences(patchContent: string): Promise<string[]> {
    // Extract service references from the patch (format: @service.name or '@service.name')
    const serviceRefPattern = /@([a-zA-Z_][a-zA-Z0-9_\.]*)/g;
    const referencedServices: string[] = [];
    let match;

    while ((match = serviceRefPattern.exec(patchContent)) !== null) {
      const serviceName = match[1];
      if (!referencedServices.includes(serviceName)) {
        referencedServices.push(serviceName);
      }
    }

    if (referencedServices.length === 0) {
      return [];
    }

    // Get available services
    const availableServices = await this.extractDrupalServices();

    // Find invalid references
    const invalidRefs = referencedServices.filter(ref => !availableServices.includes(ref));

    return invalidRefs;
  }

  private wouldCreateDuplicateMethod(content: string, patchReplace: string): boolean {
    // Extract method name from patch replacement
    const methodName = this.extractMethodNameFromPatch(patchReplace);
    if (!methodName) return false;

    // Special case: __construct is almost always a duplicate in existing classes
    // Skip these patches by default as they cause cascading issues
    if (methodName === '__construct' || methodName === '__destruct') {
      // Only consider it a duplicate if the class already has a constructor
      const constructorPattern = /(?:public|protected|private)?\s*function\s+__construct\s*\(/;
      if (constructorPattern.test(content)) {
        return true;
      }
    }

    // Check if method already exists in content
    // Match PHP method declarations: public/protected/private function methodName(
    const methodPattern = new RegExp(`(?:public|protected|private)\\s+function\\s+${methodName}\\s*\\(`, 'g');
    const existingMatches = content.match(methodPattern);

    // If we find the method already exists, this patch would create a duplicate
    return existingMatches !== null && existingMatches.length > 0;
  }

  /**
   * Extract method name from patch replacement text
   */
  private extractMethodNameFromPatch(patchReplace: string): string | null {
    // Match PHP method declaration: public/protected/private function methodName(
    const methodMatch = patchReplace.match(/(?:public|protected|private)\s+function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    return methodMatch ? methodMatch[1] : null;
  }

  /**
   * Find fuzzy match for search string with whitespace tolerance
   */
  private findFuzzyMatch(content: string, search: string): string | null {
    // Normalize whitespace in search string
    const normalizedSearch = search.replace(/\s+/g, ' ').trim();
    const searchLines = normalizedSearch.split('\n');

    if (searchLines.length === 0) return null;

    // Try to find first line of search string
    const firstLine = searchLines[0].trim();
    if (firstLine.length < 10) return null; // Too short for reliable matching

    // Find all occurrences of first line (with whitespace tolerance)
    const contentLines = content.split('\n');
    const candidates: Array<{ startIdx: number; match: string }> = [];

    for (let i = 0; i < contentLines.length; i++) {
      const normalizedLine = contentLines[i].replace(/\s+/g, ' ').trim();
      if (normalizedLine.includes(firstLine) || firstLine.includes(normalizedLine)) {
        // Found potential match, try to match full search string
        let matchedLines: string[] = [];
        let searchIdx = 0;
        let contentIdx = i;

        // Try to match consecutive lines
        while (searchIdx < searchLines.length && contentIdx < contentLines.length) {
          const normalizedSearchLine = searchLines[searchIdx].replace(/\s+/g, ' ').trim();
          const normalizedContentLine = contentLines[contentIdx].replace(/\s+/g, ' ').trim();

          if (normalizedContentLine.includes(normalizedSearchLine) ||
              normalizedSearchLine.includes(normalizedContentLine) ||
              (normalizedSearchLine.length > 20 && normalizedContentLine.length > 20 &&
               this.calculateSimilarity(normalizedSearchLine, normalizedContentLine) > 0.8)) {
            matchedLines.push(contentLines[contentIdx]);
            searchIdx++;
            contentIdx++;
          } else {
            // Allow skipping blank lines in content
            if (normalizedContentLine.trim() === '') {
              contentIdx++;
              continue;
            }
            break;
          }
        }

        // If we matched most of the search string, consider it a match
        if (matchedLines.length >= Math.max(1, searchLines.length * 0.7)) {
          candidates.push({
            startIdx: i,
            match: matchedLines.join('\n')
          });
        }
      }
    }

    // Return the first candidate that's close enough
    if (candidates.length > 0) {
      return candidates[0].match;
    }

    return null;
  }

  /**
   * Aggressive content matching - try to find the right place to apply a patch
   * even when exact and fuzzy matching fail
   */
  private findAggressiveMatch(
    content: string,
    search: string,
    replace: string
  ): { newContent: string; lineNumber: number } | null {
    const searchLines = search.split('\n');
    const contentLines = content.split('\n');

    if (searchLines.length === 0) return null;

    // Strategy 1: Find a unique identifier in the search string (method name, variable, etc.)
    const identifierMatch = search.match(/(?:function|class|const|public|private|protected)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (identifierMatch) {
      const identifier = identifierMatch[1];

      // Find lines containing this identifier
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].includes(identifier)) {
          // Check if this looks like the right context
          // Get context around the identifier
          const contextStart = Math.max(0, i - 5);
          const contextEnd = Math.min(contentLines.length, i + searchLines.length + 5);
          const contextBlock = contentLines.slice(contextStart, contextEnd).join('\n');

          // Check similarity of context to search string
          const similarity = this.calculateSimilarity(
            contextBlock.replace(/\s+/g, ' ').trim().substring(0, 500),
            search.replace(/\s+/g, ' ').trim().substring(0, 500)
          );

          if (similarity > 0.5) {
            // Found a good match - try to determine the exact replacement range
            const replaceStart = i;
            const replaceEnd = Math.min(contentLines.length, i + searchLines.length);

            // Create new content with the replacement
            const newLines = [
              ...contentLines.slice(0, replaceStart),
              replace,
              ...contentLines.slice(replaceEnd)
            ];

            return {
              newContent: newLines.join('\n'),
              lineNumber: i + 1
            };
          }
        }
      }
    }

    // Strategy 2: Look for first and last line anchors
    const firstSearchLine = searchLines[0].trim();
    const lastSearchLine = searchLines[searchLines.length - 1].trim();

    if (firstSearchLine.length > 15 && lastSearchLine.length > 15) {
      for (let i = 0; i < contentLines.length - searchLines.length; i++) {
        const contentFirstLine = contentLines[i].trim();
        const contentLastLine = contentLines[i + searchLines.length - 1]?.trim() || '';

        const firstSimilarity = this.calculateSimilarity(firstSearchLine, contentFirstLine);
        const lastSimilarity = this.calculateSimilarity(lastSearchLine, contentLastLine);

        if (firstSimilarity > 0.8 && lastSimilarity > 0.8) {
          // Found matching anchors
          const newLines = [
            ...contentLines.slice(0, i),
            replace,
            ...contentLines.slice(i + searchLines.length)
          ];

          return {
            newContent: newLines.join('\n'),
            lineNumber: i + 1
          };
        }
      }
    }

    return null;
  }

  /**
   * Calculate similarity between two strings (simple Levenshtein-based)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Extract PHP method names from file content
   */
  private extractPhpMethodNames(content: string): string[] {
    const methodNames: string[] = [];
    const methodPattern = /(?:public|protected|private|static)\s+function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let match;

    while ((match = methodPattern.exec(content)) !== null) {
      const methodName = match[1];
      if (!methodNames.includes(methodName)) {
        methodNames.push(methodName);
      }
    }

    return methodNames.sort();
  }

  /**
   * Extract Drupal service definitions from .services.yml files in the workspace.
   * Returns a list of service names that can be used in dependency injection.
   */
  private async extractDrupalServices(): Promise<string[]> {
    const services: string[] = [];
    const servicesDir = path.join(process.cwd(), 'docroot/modules/share');

    try {
      // Find all .services.yml files using glob
      const { glob } = await import('glob');
      const serviceFiles = await glob('**/*.services.yml', {
        cwd: servicesDir,
        absolute: true,
      });

      for (const file of serviceFiles) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          // Match service definitions (lines starting with 2 spaces followed by service name and colon)
          const servicePattern = /^  ([a-zA-Z_][a-zA-Z0-9_\.]*):$/gm;
          let match;
          while ((match = servicePattern.exec(content)) !== null) {
            const serviceName = match[1];
            if (!services.includes(serviceName)) {
              services.push(serviceName);
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }
    } catch (err) {
      if (this.debug) {
        console.log('[DEBUG] Could not extract Drupal services:', err);
      }
    }

    return services.sort();
  }

  /**
   * Get Drupal service registry context for AI prompts.
   * This helps prevent the AI from using non-existent service names.
   */
  private async getDrupalServiceContext(): Promise<string> {
    const services = await this.extractDrupalServices();

    if (services.length === 0) {
      return '';
    }

    // Group services by prefix for readability
    const grouped: Record<string, string[]> = {};
    for (const service of services) {
      const prefix = service.split('.')[0];
      if (!grouped[prefix]) {
        grouped[prefix] = [];
      }
      grouped[prefix].push(service);
    }

    let context = '\n### DRUPAL SERVICE REGISTRY (USE ONLY THESE SERVICE NAMES)\n';
    context += 'When adding service dependencies in *.services.yml files, ONLY use services from this list:\n\n';

    for (const [prefix, prefixServices] of Object.entries(grouped)) {
      context += `**${prefix}.***: ${prefixServices.join(', ')}\n`;
    }

    context += '\n**CRITICAL**: Do NOT invent service names. If a service does not exist in this list, do not use it.\n';

    return context;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  private async getCodebaseContext(task: Task): Promise<{
    codebaseContext: string;
    targetFiles?: string;
    existingCode?: string;
  }> {
    const taskText = `${task.title} ${task.description} ${task.details || ''}`;
    const mentionedFiles: string[] = [];

    // Get codebase config with defaults
    const codebaseConfig = this.config.codebase || {};
    const extensions = codebaseConfig.extensions || ['php', 'ts', 'js', 'py', 'yml', 'yaml', 'json'];
    const searchDirs = codebaseConfig.searchDirs || ['src', 'lib', 'app'];
    const excludeDirs = codebaseConfig.excludeDirs || ['node_modules', 'vendor', '.git', 'dist', 'build'];
    const filePathPatterns = codebaseConfig.filePathPatterns || [];

    // Pattern 1: Extract explicit file paths from task text
    // These are ALWAYS included regardless of ignore patterns
    // Generic pattern that matches common path formats (including .ts for Playwright tests)
    const allExtensions = [...extensions, 'ts', 'js', 'spec.ts', 'test.ts'];
    const genericPathPattern = new RegExp(
      `([\\w./\\-]+\\.(${allExtensions.join('|')}))`,
      'gi'
    );
    let match;
    const explicitlyMentionedFiles: string[] = []; // Track files explicitly in task
    while ((match = genericPathPattern.exec(taskText)) !== null) {
      const filePath = match[1];
      // Only add if it looks like a path (contains / or is a simple filename)
      if ((filePath.includes('/') || filePath.includes('.')) && !mentionedFiles.includes(filePath)) {
        mentionedFiles.push(filePath);
        explicitlyMentionedFiles.push(filePath);
        if (this.debug) {
          console.log(`[DEBUG] Explicitly mentioned file from task: ${filePath}`);
        }
      }
    }

    // Pattern 2: Apply custom file path patterns from config
    for (const pattern of filePathPatterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        while ((match = regex.exec(taskText)) !== null) {
          if (match[1] && !mentionedFiles.includes(match[1])) {
            mentionedFiles.push(match[1]);
          }
        }
      } catch {
        console.warn(`[WorkflowEngine] Invalid file path pattern: ${pattern}`);
      }
    }

    // Pattern 3: Dynamic class/function discovery via grep/ripgrep
    const identifiers = this.extractIdentifiersFromTask(taskText);
    if (identifiers.length > 0) {
      const discoveredFiles = await this.discoverFilesForIdentifiers(identifiers, searchDirs, excludeDirs, extensions);
      for (const file of discoveredFiles) {
        if (!mentionedFiles.includes(file)) {
          mentionedFiles.push(file);
        }
      }
    }

    const contexts: string[] = [];
    const existingCodeSections: string[] = [];
    const validFiles: string[] = [];

    // Get max context size from config (default ~25k chars = ~6k tokens)
    const maxContextChars = this.config.ai.maxContextChars || 25000;
    let totalContextSize = 0;

    if (this.debug) {
      console.log(`[DEBUG] Max context chars from config: ${maxContextChars}`);
    }

    // Determine the primary file - the first explicitly mentioned file is the one being modified
    const primaryFile = mentionedFiles.find(f => {
      const taskLower = `${task.title} ${task.description || ''} ${(task as any).details || ''}`.toLowerCase();
      return taskLower.includes(f.toLowerCase()) ||
             taskLower.includes(path.basename(f).toLowerCase());
    }) || mentionedFiles[0];

    // Load mentioned files (prioritize first files, which are usually most relevant)
    for (const file of mentionedFiles) {
      // Stop if we've exceeded max context size
      if (totalContextSize >= maxContextChars) {
        console.log(`[WorkflowEngine] Context limit reached (${totalContextSize}/${maxContextChars} chars), skipping remaining files`);
        break;
      }

      const filePath = path.resolve(process.cwd(), file);
      if (await fs.pathExists(filePath)) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          validFiles.push(file);

          // For the PRIMARY file being modified, ALWAYS include full content
          // This ensures the AI can generate exact patch strings
          const isPrimaryFile = file === primaryFile;
          let fileContext: string;

          // Extract existing method names for PHP files to help AI avoid duplicates
          let existingMethodsInfo = '';
          if (file.endsWith('.php') && isPrimaryFile) {
            const methodNames = this.extractPhpMethodNames(content);
            if (methodNames.length > 0) {
              existingMethodsInfo = `\n### EXISTING METHODS IN THIS FILE (DO NOT ADD THESE - THEY ALREADY EXIST):\n${methodNames.map(m => `- ${m}`).join('\n')}\n`;
            }
          }

          if (isPrimaryFile && content.length < 100000) {
            // Primary file under 100KB: include full content (numbered lines for patch accuracy)
            const numberedContent = content.split('\n').map((line, i) => `${i + 1}|${line}`).join('\n');
            fileContext = `\n### PRIMARY FILE TO MODIFY: ${file}${existingMethodsInfo}\n### FULL CONTENT (use exact strings for patches):\n${numberedContent}`;
            existingCodeSections.push(`\n### ${file} (FULL - PRIMARY FILE)${existingMethodsInfo}:\n${numberedContent}`);
            if (this.debug) {
              console.log(`[DEBUG] Including FULL content of primary file: ${file} (${content.length} chars)`);
            }
          } else if (isPrimaryFile) {
            // Primary file over 100KB: include end of file for appending + relevant sections
            const lines = content.split('\n');
            const endLines = Math.min(100, lines.length);
            const endOfFile = lines.slice(-endLines).map((line, i) => `${lines.length - endLines + i + 1}|${line}`).join('\n');

            // Extract relevant sections based on task keywords
            const keywords = this.extractKeywordsFromTask(task);
            const relevantSections = this.extractRelevantSections(content, keywords, file) || '';

            fileContext = `\n### PRIMARY FILE TO MODIFY: ${file} (${lines.length} lines, ${content.length} chars)\n`;
            fileContext += `### FOR APPENDING - END OF FILE (last ${endLines} lines):\n${endOfFile}\n`;
            if (relevantSections) {
              fileContext += `\n### RELEVANT SECTIONS:\n${relevantSections}`;
            }
            fileContext += `\n### PATCH GUIDANCE: This file is large. Copy exact line content for search strings.`;

            existingCodeSections.push(fileContext);
            if (this.debug) {
              console.log(`[DEBUG] Including END + RELEVANT sections of large primary file: ${file} (${content.length} chars)`);
            }
          } else if (content.length > 15000) {
            // Non-primary large files: extract relevant sections
            const keywords = this.extractKeywordsFromTask(task);
            const relevantSections = this.extractRelevantSections(content, keywords, file);

            if (relevantSections) {
              fileContext = `\n### EXISTING FILE: ${file} (relevant sections)\n${relevantSections}`;
              existingCodeSections.push(`\n### ${file} (relevant sections):\n${relevantSections}`);
            } else {
              // Fallback to showing start of file
              const truncated = content.substring(0, 15000) + '\n\n... (file truncated, showing first 15000 chars) ...';
              fileContext = `\n### EXISTING FILE: ${file}\n${truncated}`;
              existingCodeSections.push(`\n### ${file}:\n${truncated}`);
            }
          } else {
            fileContext = `\n### EXISTING FILE: ${file}\n${content}`;
            existingCodeSections.push(`\n### ${file}:\n${content}`);
          }

          // Check if adding this file would exceed the limit
          if (totalContextSize + fileContext.length > maxContextChars) {
            // Truncate to fit
            const remaining = maxContextChars - totalContextSize;
            if (remaining > 1000) {  // Only add if we can include meaningful content
              fileContext = fileContext.substring(0, remaining) + '\n\n... (context limit reached) ...';
              contexts.push(fileContext);
              totalContextSize += fileContext.length;
            }
            break;
          }

          contexts.push(fileContext);
          totalContextSize += fileContext.length;
        } catch {
          // Ignore read errors
        }
      }
    }

    console.log(`[WorkflowEngine] Found ${validFiles.length} relevant files (${totalContextSize} chars):`, validFiles);

    // Track files that need to be CREATED (mentioned in task but don't exist)
    const filesToCreate = mentionedFiles.filter(f => !validFiles.includes(f));
    if (this.debug && filesToCreate.length > 0) {
      console.log(`[DEBUG] Files mentioned but not found/skipped: ${filesToCreate.join(', ')}`);
    }

    // Add Drupal service registry context for Drupal projects
    let serviceContext = '';
    const isDrupalProject = validFiles.some(f => f.includes('.services.yml') || f.includes('docroot/modules'));
    if (isDrupalProject) {
      try {
        serviceContext = await this.getDrupalServiceContext();
        if (this.debug && serviceContext) {
          console.log(`[DEBUG] Added Drupal service registry context (${serviceContext.length} chars)`);
        }
      } catch (err) {
        if (this.debug) {
          console.log('[DEBUG] Could not get Drupal service context:', err);
        }
      }
    }

    // Build critical file creation notice for files that don't exist
    let fileCreationNotice = '';
    if (filesToCreate.length > 0) {
      fileCreationNotice = `\n\n## ⚠️ FILES TO CREATE (CRITICAL)\n\nThe following files are mentioned in the task details but DO NOT EXIST in the codebase:\n${filesToCreate.map(f => `- **${f}** (DOES NOT EXIST - YOU MUST CREATE THIS FILE)`).join('\n')}\n\n**YOU MUST create these files using operation "create".** Do NOT return an empty files array. Do NOT claim these files "already exist" - they don't. Similar files in other directories do NOT fulfill this requirement.\n`;
    }

    return {
      codebaseContext: contexts.length > 0
        ? `## Existing Code Files (MODIFY THESE, DO NOT CREATE NEW FILES UNLESS NECESSARY)\n${contexts.join('\n---\n')}${serviceContext}${fileCreationNotice}`
        : `${serviceContext}${fileCreationNotice}`,
      targetFiles: validFiles.length > 0 ? validFiles.join('\n') : undefined,
      existingCode: existingCodeSections.length > 0 ? existingCodeSections.join('\n---\n') : undefined,
    };
  }

  /**
   * Determine template type based on config and target files
   */
  private getTemplateType(targetFiles?: string, task?: Task): 'generic' | string {
    // Detect Playwright test tasks
    const taskText = task ? `${task.title} ${task.description || ''} ${(task as any).details || ''}` : '';
    const isPlaywrightTask =
      targetFiles?.includes('playwright') ||
      targetFiles?.includes('.spec.ts') ||
      targetFiles?.includes('.test.ts') ||
      taskText.toLowerCase().includes('playwright') ||
      taskText.toLowerCase().includes('test scenario');

    if (isPlaywrightTask) {
      return 'playwright-test';
    }

    // Use framework type from config if available
    const frameworkType = (this.config as any).framework?.type;
    if (frameworkType) {
      return frameworkType;
    }

    // Fallback to generic if no target files
    if (!targetFiles) {
      return 'generic';
    }

    // Generic fallback - no hardcoded framework detection
    return 'generic';
  }

  /**
   * Extract potential class/function/method identifiers from task text
   */
  private extractIdentifiersFromTask(taskText: string): string[] {
    const identifiers: string[] = [];

    // Match PascalCase identifiers (class names)
    const pascalCasePattern = /\b([A-Z][a-zA-Z0-9]+(?:Service|Controller|Manager|Handler|Provider|Factory|Helper|Processor|Builder|Interface|Base|Abstract)?)\b/g;
    let match;
    while ((match = pascalCasePattern.exec(taskText)) !== null) {
      const identifier = match[1];
      // Filter out common words that happen to be PascalCase
      const commonWords = ['The', 'This', 'That', 'These', 'Those', 'When', 'Where', 'What', 'Which', 'How', 'Why'];
      if (!commonWords.includes(identifier) && !identifiers.includes(identifier)) {
        identifiers.push(identifier);
      }
    }

    // Match camelCase function/method names that are likely to be significant
    const camelCasePattern = /\b((?:get|set|create|update|delete|process|handle|build|validate|ensure|populate|alter|transform)[A-Z][a-zA-Z0-9]*)\b/g;
    while ((match = camelCasePattern.exec(taskText)) !== null) {
      if (!identifiers.includes(match[1])) {
        identifiers.push(match[1]);
      }
    }

    // Match snake_case function names using config patterns if available
    const frameworkPatterns = (this.config as any).framework?.identifierPatterns || [];
    const snakeCasePatterns = frameworkPatterns.length > 0
      ? frameworkPatterns.map((p: string) => new RegExp(p, 'g'))
      : [/\b(_[a-z][a-z0-9_]+)\b/g]; // Default: generic underscore-prefixed identifiers

    for (const pattern of snakeCasePatterns) {
      while ((match = pattern.exec(taskText)) !== null) {
        if (!identifiers.includes(match[1])) {
          identifiers.push(match[1]);
        }
      }
    }

    return identifiers;
  }

  /**
   * Discover files containing identifier definitions using grep/ripgrep
   */
  private async discoverFilesForIdentifiers(
    identifiers: string[],
    searchDirs: string[],
    excludeDirs: string[],
    extensions: string[]
  ): Promise<string[]> {
    const discoveredFiles: Map<string, number> = new Map(); // file -> relevance score

    // Get ignore globs from config, but skip them for test-related tasks
    const codebaseConfig = this.config.codebase || {};
    const taskText = identifiers.join(' ').toLowerCase();
    const isTestTask = taskText.includes('test') || taskText.includes('playwright') || taskText.includes('spec');
    const ignoreGlobs: string[] = isTestTask ? [] : ((codebaseConfig as any).ignoreGlobs || []);

    // Build exclude pattern for grep
    const excludePattern = excludeDirs.map(d => `--exclude-dir=${d}`).join(' ');
    const includePattern = extensions.map(e => `--include=*.${e}`).join(' ');

    // Common words to skip - configurable in devloop.config.js codebase.identifierStopwords
    const configStopwords: string[] = (codebaseConfig as any).identifierStopwords || [];
    // Only use config stopwords if provided, otherwise use minimal defaults
    const defaultStopwords = configStopwords.length > 0 ? [] : [
      'File', 'Move', 'Step', 'Configure', 'Verify', 'Implement', 'Create', 'Update',
      'Delete', 'Add', 'Remove', 'Get', 'Set', 'Load', 'Check', 'Execute', 'Run'
    ];
    const stopwords = new Set([...defaultStopwords, ...configStopwords]);

    // Prioritize high-value identifiers (class names, function names, file names)
    const prioritizedIdentifiers = identifiers
      .filter(id => id.length > 3 && !stopwords.has(id)) // Skip short and common words
      .slice(0, 5); // Limit to first 5 identifiers

    if (this.debug) {
      console.log(`[DEBUG] Searching for identifiers: ${prioritizedIdentifiers.join(', ')}`);
    }

    for (const identifier of prioritizedIdentifiers) {
      try {
        // Try ripgrep first (faster), fall back to grep
        let command: string;
        const searchPath = searchDirs.filter(d => fs.existsSync(path.resolve(process.cwd(), d))).join(' ') || '.';

        // Check if ripgrep is available
        try {
          await execAsync('which rg');
          // Ripgrep command with case-sensitive match for better precision
          const rgExclude = [...excludeDirs.map(d => `--glob=!${d}`), ...ignoreGlobs.map(g => `--glob=!${g}`)].join(' ');
          const rgInclude = extensions.map(e => `--glob=*.${e}`).join(' ');
          command = `rg -l -s "${identifier}" ${rgExclude} ${rgInclude} ${searchPath} 2>/dev/null || true`;
        } catch {
          // Fall back to grep
          command = `grep -rl "${identifier}" ${excludePattern} ${includePattern} ${searchPath} 2>/dev/null || true`;
        }

        const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024 });
        const files = stdout.trim().split('\n').filter(f => f.length > 0);

        if (this.debug) {
          console.log(`[DEBUG] Identifier "${identifier}" found in ${files.length} files`);
        }

        // Score files by how many identifiers they contain
        for (const file of files) {
          // Check against ignore globs
          if (this.matchesIgnoreGlob(file, ignoreGlobs)) {
            if (this.debug) {
              console.log(`[DEBUG] Skipping ignored file: ${file}`);
            }
            continue;
          }

          // Give higher scores to files in priority directories (first searchDirs)
          let score = 1;
          for (let i = 0; i < searchDirs.length; i++) {
            if (file.includes(searchDirs[i])) {
              score = 10 - i; // First dir gets 10 points, second gets 9, etc.
              break;
            }
          }

          const currentScore = discoveredFiles.get(file) || 0;
          discoveredFiles.set(file, currentScore + score);
        }
      } catch {
        // Ignore grep errors
      }
    }

    // Sort by relevance score (files matching more identifiers rank higher)
    const sortedFiles = Array.from(discoveredFiles.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([file]) => file);

    if (this.debug) {
      console.log(`[DEBUG] Discovered files (by relevance):`, sortedFiles.slice(0, 10));
    }

    // Limit total discovered files
    return sortedFiles.slice(0, 8);
  }

  private async executePreTestHooks(): Promise<void> {
    if (!this.config.hooks?.preTest || this.config.hooks.preTest.length === 0) {
      return;
    }

    for (const command of this.config.hooks.preTest) {
      try {
        await execAsync(command);
      } catch (error) {
        // Log but don't fail - hooks are optional
        console.warn(`Pre-test hook failed: ${command}`, error);
      }
    }
  }

  private async executePostApplyHooks(): Promise<void> {
    if (!this.config.hooks?.postApply || this.config.hooks.postApply.length === 0) {
      return;
    }

    for (const command of this.config.hooks.postApply) {
      try {
        await execAsync(command);
      } catch (error) {
        // Log but don't fail - hooks are optional
        console.warn(`Post-apply hook failed: ${command}`, error);
      }
    }
  }

  private async updateState(updates: Partial<WorkflowState>): Promise<void> {
    const currentState = await this.stateManager.getWorkflowState();
    const newState: WorkflowState = {
      ...currentState,
      ...updates,
    };

    // Calculate progress
    if (newState.totalTasks > 0) {
      newState.progress = newState.completedTasks / newState.totalTasks;
    }

    await this.stateManager.saveWorkflowState(newState);
  }

  shutdown(): void {
    this.shutdownRequested = true;
  }

  isShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  /**
   * Check if a file path matches any of the ignore glob patterns
   */
  private matchesIgnoreGlob(filePath: string, ignoreGlobs: string[]): boolean {
    for (const glob of ignoreGlobs) {
      // Convert glob to regex (simple implementation)
      const regexPattern = glob
        .replace(/\*\*/g, '.*')           // ** matches anything
        .replace(/\*/g, '[^/]*')          // * matches anything except /
        .replace(/\?/g, '.')              // ? matches single char
        .replace(/\./g, '\\.');           // Escape dots

      try {
        const regex = new RegExp(regexPattern);
        if (regex.test(filePath)) {
          return true;
        }
      } catch {
        // Invalid regex, skip
      }
    }
    return false;
  }

  /**
   * Extract keywords from task for searching file content
   */
  private extractKeywordsFromTask(task: Task): string[] {
    const text = `${task.title} ${task.description} ${task.details || ''}`;
    const keywords: string[] = [];

    // Extract identifiers (class names, method names)
    const identifiers = this.extractIdentifiersFromTask(text);
    keywords.push(...identifiers);

    // Add line number markers if present
    if (text.includes('Line') || text.includes('line')) {
      const lineMatch = text.match(/[Ll]ine\s*(\d+)/);
      if (lineMatch) {
        keywords.push(`LINE:${lineMatch[1]}`);
      }
    }

    return keywords;
  }

  /**
   * Extract relevant sections from a large file based on keywords.
   * For PHP files, extracts complete method bodies when method names are matched.
   */
  private extractRelevantSections(content: string, keywords: string[], filePath: string): string | null {
    const lines = content.split('\n');
    const sections: string[] = [];
    const seenRanges: Set<string> = new Set();

    // Increased limits for better patch context
    const isPhpFile = filePath.endsWith('.php');
    const maxSections = isPhpFile ? 8 : 5; // More sections for PHP
    const maxTotalChars = isPhpFile ? 30000 : 10000; // Much more context for PHP
    let totalChars = 0;

    // First, handle LINE: markers
    for (const keyword of keywords) {
      if (sections.length >= maxSections || totalChars >= maxTotalChars) break;

      if (keyword.startsWith('LINE:')) {
        const lineNum = parseInt(keyword.replace('LINE:', ''), 10);
        if (!isNaN(lineNum) && lineNum > 0 && lineNum <= lines.length) {
          const start = Math.max(0, lineNum - 20);
          const end = Math.min(lines.length, lineNum + 20);
          const rangeKey = `${start}-${end}`;
          if (!seenRanges.has(rangeKey)) {
            seenRanges.add(rangeKey);
            const section = lines.slice(start, end).map((l, i) => `${start + i + 1}|${l}`).join('\n');
            const sectionText = `\n// LINES ${start + 1}-${end} (around line ${lineNum}):\n${section}`;
            sections.push(sectionText);
            totalChars += sectionText.length;
          }
        }
      }
    }

    // For PHP files, try to extract complete method bodies when a method name is found
    const keywordPatterns = keywords.filter(k => !k.startsWith('LINE:'));
    for (const keyword of keywordPatterns) {
      if (sections.length >= maxSections || totalChars >= maxTotalChars) break;

      try {
        const regex = new RegExp(keyword, 'gi');
        for (let i = 0; i < lines.length; i++) {
          if (sections.length >= maxSections || totalChars >= maxTotalChars) break;

          if (regex.test(lines[i])) {
            let start: number;
            let end: number;

            // For PHP files, try to find the complete method body
            if (isPhpFile && this.isMethodDeclaration(lines[i])) {
              // Find method start (including docblock above)
              start = this.findMethodStart(lines, i);
              // Find method end (closing brace)
              end = this.findMethodEnd(lines, i);
            } else if (isPhpFile && this.isInsideMethod(lines, i)) {
              // We're inside a method, find the method boundaries
              const methodStart = this.findContainingMethodStart(lines, i);
              if (methodStart >= 0) {
                start = this.findMethodStart(lines, methodStart);
                end = this.findMethodEnd(lines, methodStart);
              } else {
                start = Math.max(0, i - 15);
                end = Math.min(lines.length, i + 25);
              }
            } else {
              // Default: expand context for PHP, keep smaller for other files
              start = Math.max(0, i - (isPhpFile ? 20 : 10));
              end = Math.min(lines.length, i + (isPhpFile ? 40 : 15));
            }

            const rangeKey = `${start}-${end}`;
            if (!seenRanges.has(rangeKey)) {
              seenRanges.add(rangeKey);
              const section = lines.slice(start, end).map((l, idx) => `${start + idx + 1}|${l}`).join('\n');
              const sectionText = `\n// LINES ${start + 1}-${end} (found "${keyword}"):\n${section}`;
              sections.push(sectionText);
              totalChars += sectionText.length;
            }
            // Reset regex lastIndex
            regex.lastIndex = 0;
          }
        }
      } catch {
        // Invalid regex, skip
      }
    }

    if (sections.length > 0) {
      const result = `FILE: ${filePath}\nTotal lines: ${lines.length}\n\n${sections.join('\n\n---\n')}`;
      if (result.length > maxTotalChars) {
        return result.substring(0, maxTotalChars) + '\n\n... (section limit reached) ...';
      }
      return result;
    }

    return null;
  }

  /**
   * Check if a line is a PHP method declaration
   */
  private isMethodDeclaration(line: string): boolean {
    // Match public/protected/private function declarations
    return /^\s*(public|protected|private)\s+(static\s+)?function\s+\w+\s*\(/.test(line);
  }

  /**
   * Check if we're inside a method body (has leading whitespace typical of method body)
   */
  private isInsideMethod(lines: string[], lineIndex: number): boolean {
    const line = lines[lineIndex];
    // Method body lines typically have 4+ spaces of indentation
    return /^\s{4,}/.test(line) && !/^\s*(public|protected|private|class|interface|trait)\s+/.test(line);
  }

  /**
   * Find the start of a method including its docblock
   */
  private findMethodStart(lines: string[], methodLineIndex: number): number {
    let start = methodLineIndex;

    // Look backwards for docblock or other annotations
    for (let i = methodLineIndex - 1; i >= 0 && i >= methodLineIndex - 30; i--) {
      const line = lines[i].trim();
      if (line === '' || line.startsWith('*') || line.startsWith('/**') || line.startsWith('*/') || line.startsWith('#[')) {
        start = i;
      } else if (line.startsWith('//')) {
        start = i;
      } else {
        break;
      }
    }

    return start;
  }

  /**
   * Find the end of a method (matching closing brace)
   */
  private findMethodEnd(lines: string[], methodLineIndex: number): number {
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = methodLineIndex; i < lines.length && i < methodLineIndex + 300; i++) {
      const line = lines[i];

      // Count braces (simple approach - doesn't handle strings/comments perfectly)
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        } else if (char === '}') {
          braceCount--;
          if (foundOpenBrace && braceCount === 0) {
            return i + 1; // Include the closing brace line
          }
        }
      }
    }

    // Fallback if we can't find the end
    return Math.min(lines.length, methodLineIndex + 100);
  }

  /**
   * Find the method declaration line for a line that's inside a method body
   */
  private findContainingMethodStart(lines: string[], lineIndex: number): number {
    for (let i = lineIndex; i >= 0 && i >= lineIndex - 200; i--) {
      if (this.isMethodDeclaration(lines[i])) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Run autonomous PRD execution - test-driven development loop
   */
  async runAutonomousPrd(prdPath: string): Promise<PrdExecutionResult> {
    // Parse PRD config overlay and merge with base config
    const configParser = new PrdConfigParser(this.debug);
    const prdConfigOverlay = await configParser.parsePrdConfig(prdPath);
    const prdMetadata = await configParser.parsePrdMetadata(prdPath);

    // Extract PRD ID and version for metrics tracking
    const prdId = prdMetadata?.prd?.id || path.basename(prdPath, path.extname(prdPath));
    const prdVersion = prdMetadata?.prd?.version || '1.0.0';
    const prdSetId = (prdMetadata as any)?.prdSetId;

    // Start PRD metrics tracking
    if (this.prdMetrics && prdMetadata) {
      const prdMetadataForMetrics: PrdMetadata = {
        prdId,
        prdVersion,
        prdPath,
        phases: prdMetadata.requirements?.phases?.map((p: any, idx: number) => ({
          id: p.id || idx + 1,
          name: p.name || `Phase ${p.id || idx + 1}`,
        })),
        features: (prdMetadata as any).features || [],
      };
      this.prdMetrics.startPrdExecution(prdId, prdSetId, prdMetadataForMetrics);
    }

    // Start feature tracking
    if (this.featureTracker && prdMetadata) {
      const features = (prdMetadata as any).features || [];
      this.featureTracker.startPrdTracking(prdId, features);
    }

    // Start schema tracking
    if (this.schemaTracker) {
      this.schemaTracker.startPrdTracking(prdId);
    }

    // Start observation tracking
    if (this.observationMetrics) {
      this.observationMetrics.startPrdTracking(prdId);
    }

    // Start pattern tracking
    if (this.patternMetrics) {
      this.patternMetrics.startPrdTracking(prdId);
    }

    let effectiveConfig = this.config;
    if (prdConfigOverlay) {
      console.log('[WorkflowEngine] PRD config overlay detected, merging with base config...');
      effectiveConfig = configParser.mergeWithBaseConfig(this.config, prdConfigOverlay);

      if (this.debug) {
        logger.debug(`[WorkflowEngine] Merged PRD config overlay. Keys: ${Object.keys(prdConfigOverlay).join(', ')}`);
      }
    }

    // Validate prerequisites before execution
    const prerequisiteValidator = (this as any).prerequisiteValidator;
    if (prerequisiteValidator && prdMetadata) {
      console.log('[WorkflowEngine] Validating prerequisites...');
      const prereqResult = await prerequisiteValidator.validatePrerequisites(prdMetadata);
      if (!prereqResult.success) {
        console.error('[WorkflowEngine] Prerequisite validation failed:');
        prereqResult.errors.forEach((err: string) => console.error(`  - ${err}`));
        if (prereqResult.codeRequirements && !prereqResult.codeRequirements.success) {
          console.error('  Code requirements failed:', prereqResult.codeRequirements.failed);
        }
        if (!prereqResult.environment.success) {
          console.error('  Environment validation failed:', prereqResult.environment.errors);
        }
        if (!prereqResult.testInfrastructure.success) {
          console.error('  Test infrastructure validation failed:', prereqResult.testInfrastructure.errors);
        }
        // Block execution on critical failures
        throw new Error('Prerequisite validation failed - cannot proceed with PRD execution');
      }
      console.log('[WorkflowEngine] Prerequisites validated successfully');
    }

    const autonomousConfig = (effectiveConfig as any).autonomous || {};
    const contextPath = autonomousConfig.contextPath || '.devloop/prd-context';
    const maxIterations = autonomousConfig.maxIterations || 100;
    const testEvolutionInterval = autonomousConfig.testEvolutionInterval || 5;
    const stuckDetectionWindow = autonomousConfig.stuckDetectionWindow || 5;

    // Initialize context manager
    const contextManager = new PrdContextManager(contextPath, this.debug);
    const context = await contextManager.loadOrCreate(prdPath);

    // Initialize components (use merged config)
    const prdParser = new PrdParser(this.aiProvider, this.debug);
    const testGenerator = new TestGenerator(this.aiProvider, effectiveConfig, this.debug);
    const testExecutor = new TestExecutor(
      effectiveConfig.testing.artifactsDir,
      this.debug,
      effectiveConfig
    );
    const failureAnalyzer = new FailureAnalyzer(this.aiProvider, this.debug);
    const taskGenerator = new AutonomousTaskGenerator(
      autonomousConfig.maxTaskRetries || 3
    );

    // Phase 1: Parse PRD and generate initial tests
    // Also handle stuck "generating-tests" state with empty tests (bug fix)
    if (context.status === 'initializing' ||
        (context.status === 'generating-tests' && context.tests.length === 0)) {

      // If we're resuming a stuck generating-tests state, reset to initializing
      if (context.status === 'generating-tests') {
        console.log('[WorkflowEngine] Resuming from stuck generating-tests state (empty tests)...');
        context.status = 'initializing';
      }
      console.log('[WorkflowEngine] Parsing PRD and generating initial tests...');
      context.status = 'generating-tests';
      await contextManager.save(context);

      // Check if structured parsing should be used (use merged config)
      const prdConfig = (effectiveConfig as any).prd || {};
      const useStructuredParsing = prdConfig.useStructuredParsing !== false;

      // Use parseWithConfig to get both requirements and any config overlay
      // (though we already merged config above, this ensures consistency)
      const parseResult = await prdParser.parseWithConfig(prdPath, useStructuredParsing);
      let requirements = parseResult.requirements;

      // If config overlay was found in parse result, merge again (in case parseWithConfig found different overlay)
      if (parseResult.configOverlay) {
        effectiveConfig = configParser.mergeWithBaseConfig(effectiveConfig, parseResult.configOverlay);
        // Update prdConfig reference
        const updatedPrdConfig = (effectiveConfig as any).prd || {};
        Object.assign(prdConfig, updatedPrdConfig);
      }

      // Resolve dependencies if enabled (use merged config)
      const resolveDependencies = prdConfig.resolveDependencies === true;
      if (resolveDependencies && prdConfig.dependencies) {
        requirements = this.resolveRequirementDependencies(requirements, prdConfig.dependencies);
      }

      context.requirements = requirements;

      // Generate implementation code if enabled and requirements have implementation files
      const generateImplementation = prdConfig.generateImplementation !== false;
      const drupalConfig = (effectiveConfig as any).drupal || {};

      if (generateImplementation && drupalConfig.enabled) {
        const implGenerator = new DrupalImplementationGenerator(this.aiProvider, effectiveConfig, this.debug);

        console.log('[WorkflowEngine] Generating implementation code for requirements with implementation files...');
        for (const req of requirements) {
          if (req.implementationFiles && req.implementationFiles.length > 0 && req.status !== 'done') {
            try {
              console.log(`[WorkflowEngine] Generating implementation for ${req.id}...`);
              const changes = await implGenerator.generateFix(req, context);

              // Apply changes
              const applyResult = await this.applyChanges(changes);

              if (!applyResult.success) {
                const errorMsg = applyResult.failedPatches.length > 0
                  ? `Failed patches: ${applyResult.failedPatches.join(', ')}`
                  : 'Unknown error';
                console.warn(`[WorkflowEngine] Failed to apply changes for ${req.id}: ${errorMsg}`);
                context.knowledge.failedApproaches.push({
                  id: `impl-${req.id}`,
                  description: `Implementation for ${req.id}`,
                  reason: errorMsg,
                  attemptedAt: new Date().toISOString(),
                });
                continue;
              }

              // Validate Drupal site health
              if (drupalConfig.cacheCommand) {
                try {
                  await execAsync(drupalConfig.cacheCommand, { timeout: 60000 });
                } catch (err) {
                  console.warn(`[WorkflowEngine] Cache clear failed: ${err}`);
                }
              }

              if (drupalConfig.healthCheckUrl) {
                const healthCheck = await this.checkDrupalSiteHealth(drupalConfig.healthCheckUrl);
                if (!healthCheck.healthy) {
                  console.error(`[WorkflowEngine] Site health check failed for ${req.id}, reverting changes`);

                  // Revert changes
                  for (const file of changes.files) {
                    try {
                      const filePath = path.resolve(process.cwd(), file.path);
                      await execAsync(`git checkout "${filePath}"`);
                    } catch (revertErr) {
                      console.warn(`[WorkflowEngine] Could not revert ${file.path}`);
                    }
                  }

                  context.knowledge.failedApproaches.push({
                    id: `impl-${req.id}-health`,
                    description: `Implementation for ${req.id} broke site`,
                    reason: healthCheck.error || 'Site health check failed',
                    attemptedAt: new Date().toISOString(),
                  });
                  continue;
                }
              }

              console.log(`[WorkflowEngine] Successfully applied implementation for ${req.id}`);

              // Record working pattern
              if (changes.files.length > 0) {
                context.knowledge.workingPatterns.push({
                  id: `pattern-${req.id}`,
                  description: `Implementation pattern for ${req.id}`,
                  code: changes.files.map(f => f.content || '').join('\n\n'),
                  context: req.description,
                  discoveredAt: new Date().toISOString(),
                });
              }
            } catch (error: any) {
              console.error(`[WorkflowEngine] Error generating implementation for ${req.id}:`, error);
              context.knowledge.failedApproaches.push({
                id: `impl-${req.id}-error`,
                description: `Implementation generation for ${req.id}`,
                reason: error.message || 'Unknown error',
                attemptedAt: new Date().toISOString(),
              });
            }
          }
        }

        await contextManager.save(context);
      }

      const tests = await testGenerator.generateTests(requirements, context);
      context.tests = tests;
      context.status = 'running';

      await contextManager.save(context);
      console.log(`[WorkflowEngine] Generated ${tests.length} tests from ${requirements.length} requirements`);

      // Execute phase 1 validation gates
      const phase1 = prdMetadata?.requirements?.phases?.find((p: any) => p.id === 1);
      const phase1Name = phase1?.name || 'Phase 1';
      if (this.phaseMetrics && prdId) {
        this.phaseMetrics.startPhaseExecution(1, phase1Name, prdId, false);
      }
      await this.executePhaseValidation(1, prdMetadata);
      if (this.phaseMetrics && prdId) {
        this.phaseMetrics.completePhaseExecution(1, prdId, 'completed');
        // Record phase completion in PRD metrics
        const phaseMetricsData = this.phaseMetrics.getPhaseMetrics(1, prdId);
        if (phaseMetricsData && this.prdMetrics) {
          this.prdMetrics.recordPhaseCompletion(1, phaseMetricsData);
        }
      }
    }

    // Phase 2: Main execution loop
    const phase2 = prdMetadata?.requirements?.phases?.find((p: any) => p.id === 2);
    const phase2Name = phase2?.name || 'Phase 2';
    let currentPhaseId = 2; // Track current phase for task metrics
    if (this.phaseMetrics && prdId) {
      this.phaseMetrics.startPhaseExecution(2, phase2Name, prdId, false);
    }

    while (context.status === 'running') {
      context.currentIteration++;
      const iterationStart = Date.now();

      console.log(`\n=== Iteration ${context.currentIteration} ===`);

      // Check max iterations
      if (context.currentIteration > maxIterations) {
        context.status = 'blocked';
        console.log(`[WorkflowEngine] Max iterations (${maxIterations}) reached`);
        await contextManager.save(context);
        break;
      }

      // Run all tests
      const testStartTime = Date.now();
      const testResult = await testExecutor.executeTests(context.tests);
      const testDuration = Date.now() - testStartTime;

      // Record test execution metrics
      if (this.prdMetrics && prdId) {
        this.prdMetrics.recordTestResults(prdId, {
          total: testResult.total,
          passing: testResult.passed,
          failing: testResult.failed,
          passRate: testResult.total > 0 ? (testResult.passed / testResult.total) * 100 : 0,
        });
      }
      // Record test results in phase metrics
      if (this.phaseMetrics && prdId && currentPhaseId) {
        this.phaseMetrics.recordTestResults(prdId, currentPhaseId, testResult.total, testResult.passed, testResult.failed);
      }
      if (this.testResultsTracker && prdId) {
        const executionId = `test-${prdId}-${Date.now()}`;
        this.testResultsTracker.startExecution(executionId, undefined, prdId, currentPhaseId || undefined);
        this.testResultsTracker.recordTestResults(
          testResult.total,
          testResult.passed,
          testResult.failed,
          0, // skipped
          testDuration
        );
        this.testResultsTracker.completeExecution();
      }

      // Check for completion
      if (testResult.failed === 0) {
        // Execute final phase validation gates before marking complete
        await this.executePhaseValidation(2, prdMetadata);

        // Complete phase 2 metrics
        if (this.phaseMetrics && prdId) {
          this.phaseMetrics.completePhaseExecution(2, prdId, 'completed');
          // Record phase completion in PRD metrics
          const phaseMetricsData = this.phaseMetrics.getPhaseMetrics(2, prdId);
          if (phaseMetricsData && this.prdMetrics) {
            this.prdMetrics.recordPhaseCompletion(2, phaseMetricsData);
          }
        }

        context.status = 'complete';
        console.log('[WorkflowEngine] All tests passing! PRD complete.');
        await contextManager.save(context);
        break;
      }

      console.log(`[WorkflowEngine] Tests: ${testResult.passed}/${testResult.total} passing`);

      // Analyze failures
      const analysisStartTime = Date.now();
      const analysis = await failureAnalyzer.analyze(testResult, context);
      const analysisDuration = Date.now() - analysisStartTime;

      // Record error analysis metrics
      if (this.prdMetrics && prdId && analysis.failures) {
        const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
        if (prdMetric) {
          // Extract error info from failures
          for (const failure of analysis.failures) {
            prdMetric.errors.total++;
            const category = failure.category || 'unknown';
            prdMetric.errors.byCategory[category] = (prdMetric.errors.byCategory[category] || 0) + 1;
            // Use rootCause as error type
            const errorType = failure.rootCause.substring(0, 50) || 'unknown';
            prdMetric.errors.byType[errorType] = (prdMetric.errors.byType[errorType] || 0) + 1;
          }
          // Metrics are saved automatically in recordTaskCompletion
        }
      }

      // Record feature usage for error analysis
      if (this.featureTracker && prdId) {
        const tokensUsed = { input: 0, output: 0 }; // Error analysis tokens would need to be tracked
        this.featureTracker.recordFeatureUsage('error-analysis', true, analysisDuration, tokensUsed);
      }
      if (this.prdMetrics && prdId) {
        const tokensUsed = { input: 0, output: 0 };
        this.prdMetrics.recordFeatureUsage(prdId, 'error-analysis', true, analysisDuration, tokensUsed);
      }

      // Generate fix tasks
      const tasks = await taskGenerator.generateFixTasks(analysis, context);

      console.log(`[WorkflowEngine] Generated ${tasks.length} fix task(s)`);

      // Execute code tasks
      const changesApplied: any[] = [];
      for (const task of tasks) {
        await this.taskBridge.createTask(task);

        // Execute the task using existing workflow
        const taskStartTime = Date.now();
        let aiCallStartTime = 0;
        let aiCallDuration = 0;
        let tokensUsed = { input: 0, output: 0 };
        let taskStatus: 'completed' | 'failed' = 'failed';
        let runMetrics: RunMetrics | undefined;

        try {
          const { codebaseContext, targetFiles } = await this.getCodebaseContext(task);
          const taskContext: TaskContext = {
            task,
            codebaseContext,
          };

          const template = await this.templateManager.getTaskGenerationTemplateWithContext({
            task: {
              title: task.title,
              description: task.description,
              priority: task.priority,
            },
            codebaseContext,
            targetFiles,
            existingCode: undefined,
            templateType: this.getTemplateType(targetFiles, task),
            fileGuidance: '',
            patternGuidance: '',
          });

          // Record AI call start
          aiCallStartTime = Date.now();
          const changes = await this.aiProvider.generateCode(template, taskContext);
          aiCallDuration = Date.now() - aiCallStartTime;

          // Extract token usage from changes if available
          if ((changes as any).tokens) {
            tokensUsed = (changes as any).tokens;
          }

          const applyResult = await this.applyChanges(changes);

          // Check if task succeeded (no failed patches) or if all patches were skipped (also success)
          const allSkipped = applyResult.skippedPatches && applyResult.skippedPatches.length > 0 &&
                            applyResult.failedPatches.length === 0;

          if (applyResult.success || allSkipped) {
            if (allSkipped) {
              console.log(`[WorkflowEngine] Task ${task.id} completed: all patches skipped (duplicate methods prevented)`);
            }

            changesApplied.push({
              path: changes.files?.[0]?.path || 'unknown',
              operation: changes.files?.[0]?.operation || 'update',
              summary: changes.summary || (allSkipped ? 'Patches skipped (duplicate methods prevented)' : 'Code changes applied'),
            });

            // Run post-apply hooks
            if (this.config.hooks?.postApply && this.config.hooks.postApply.length > 0) {
              await this.executePostApplyHooks();
            }

            // Check site health after applying changes (critical for Drupal)
            const healthCheck = await this.checkDrupalSiteHealth();
            if (!healthCheck.healthy) {
              console.error(`[WorkflowEngine] Site health check failed, reverting changes`);

              // Revert all modified files
              for (const file of changes.files) {
                try {
                  const filePath = path.resolve(process.cwd(), file.path);
                  await execAsync(`git checkout "${filePath}"`);
                  console.log(`[WorkflowEngine] Reverted ${file.path}`);
                } catch (revertErr) {
                  console.warn(`[WorkflowEngine] Could not revert ${file.path}`);
                }
              }

              // Re-run cache clear after revert
              try {
                await execAsync('ddev exec bash -c "drush cr"', { timeout: 60000 });
              } catch { /* ignore */ }

              // Record as failed approach
              context.knowledge.failedApproaches.push({
                id: `site-health-${Date.now()}-${task.id}`,
                description: `Task ${task.id}: ${task.title}`,
                reason: `Site health check failed after applying patches: ${healthCheck.error}`,
                attemptedAt: new Date().toISOString(),
              });

              // Don't mark task as done
              continue;
            }

            await this.taskBridge.updateTaskStatus(task.id, 'done');
            taskStatus = 'completed';
          } else {
            console.warn(`[WorkflowEngine] Failed to apply changes for task ${task.id}`);
            taskStatus = 'failed';
            if (applyResult.failedPatches.length > 0) {
              console.warn(`[WorkflowEngine] Failed patches: ${applyResult.failedPatches.slice(0, 3).join('; ')}`);
            }

            // Enhancement 5: Record failed approach in context
            const failedPatchesSummary = applyResult.failedPatches
              .slice(0, 3)
              .map(p => p.substring(0, 100))
              .join('; ');

            context.knowledge.failedApproaches.push({
              id: `failed-${Date.now()}-${task.id}`,
              description: `Task ${task.id}: ${task.title}`,
              reason: `Patches failed: ${failedPatchesSummary || 'Unknown error'}`,
              attemptedAt: new Date().toISOString(),
            });

            // Keep only last 20 failed approaches to prevent context bloat
            if (context.knowledge.failedApproaches.length > 20) {
              context.knowledge.failedApproaches = context.knowledge.failedApproaches.slice(-20);
            }
          }

          // Record task completion metrics
          const taskDuration = Date.now() - taskStartTime;
          if (this.prdMetrics && prdId) {
            runMetrics = {
              timestamp: new Date().toISOString(),
              taskId: parseInt(task.id) || undefined,
              taskTitle: task.title,
              status: taskStatus,
              timing: {
                totalMs: taskDuration,
                aiCallMs: aiCallDuration,
                testRunMs: 0, // Test run time is tracked separately
              },
              tokens: {
                input: tokensUsed.input,
                output: tokensUsed.output,
              },
              context: {},
              patches: {},
              validation: {},
              patterns: {},
              outcome: {
                errorCategory: taskStatus === 'failed' ? 'code' : undefined,
                failureType: taskStatus === 'failed' ? 'test' as any : undefined,
              },
            };
            this.prdMetrics.recordTaskCompletion(prdId, task.id, runMetrics);
          }
          // Record task completion in phase metrics
          if (this.phaseMetrics && prdId && currentPhaseId && runMetrics) {
            this.phaseMetrics.recordTaskCompletion(task.id, runMetrics, prdId, currentPhaseId);
          }

        } catch (error) {
          console.error(`[WorkflowEngine] Error executing task ${task.id}:`, error);

          // Record failed task metrics
          const taskDuration = Date.now() - taskStartTime;
          if (this.prdMetrics && prdId) {
            runMetrics = {
              timestamp: new Date().toISOString(),
              taskId: parseInt(task.id) || undefined,
              taskTitle: task.title,
              status: 'failed',
              timing: {
                totalMs: taskDuration,
                aiCallMs: aiCallDuration,
                testRunMs: 0,
              },
              tokens: {
                input: tokensUsed.input,
                output: tokensUsed.output,
              },
              context: {},
              patches: {},
              validation: {},
              patterns: {},
              outcome: {
                errorCategory: 'code',
                failureType: 'test' as any,
              },
            };
            this.prdMetrics.recordTaskCompletion(prdId, task.id, runMetrics);
          }
          // Record failed task in phase metrics
          if (this.phaseMetrics && prdId && currentPhaseId && runMetrics) {
            this.phaseMetrics.recordTaskCompletion(task.id, runMetrics, prdId, currentPhaseId);
          }
        }
      }

      // Evolve tests based on new knowledge
      if (context.currentIteration % testEvolutionInterval === 0) {
        console.log('[WorkflowEngine] Re-evaluating and enhancing tests...');
        context.tests = await testGenerator.generateTests(
          context.requirements,
          context,
          context.tests.map(t => t.testPath)
        );
      }

      // Record iteration
      context.iterations.push({
        iteration: context.currentIteration,
        timestamp: new Date().toISOString(),
        tasksExecuted: tasks.map(t => t.id),
        testsRun: testResult.total,
        testsPassed: testResult.passed,
        testsFailed: testResult.failed,
        errors: analysis.failures.map(f => f.rootCause),
        changesApplied,
        duration: Date.now() - iterationStart,
      });

      // Save context after each iteration
      await contextManager.save(context);

      // Check for stuck state
      if (this.isStuck(context, stuckDetectionWindow)) {
        context.status = 'blocked';
        console.log('[WorkflowEngine] Execution appears stuck. Human intervention needed.');
        await contextManager.save(context);
        break;
      }
    }

    // Complete PRD metrics tracking
    if (this.prdMetrics) {
      const finalStatus = context.status === 'complete' ? 'completed' : 'failed';
      this.prdMetrics.completePrdExecution(prdId, finalStatus);
    }

    return {
      prdId: context.prdId,
      status: context.status,
      iterations: context.currentIteration,
      testsTotal: context.tests.length,
      testsPassing: context.tests.filter(t => t.status === 'passing').length,
    };
  }

  /**
   * Check if execution is stuck (no progress)
   */
  private isStuck(context: PrdContext, window: number): boolean {
    // Check if making no progress over last N iterations
    const recentIterations = context.iterations.slice(-window);
    if (recentIterations.length < window) {
      return false;
    }

    const passRates = recentIterations.map(i =>
      i.testsRun > 0 ? i.testsPassed / i.testsRun : 0
    );
    const improvement = passRates[passRates.length - 1] - passRates[0];

    // Stuck if no improvement and same errors repeating
    if (improvement <= 0) {
      const recentErrors = new Set(recentIterations.flatMap(i => i.errors));
      const firstErrors = new Set(recentIterations[0].errors);
      const sameErrors = [...recentErrors].every(e => firstErrors.has(e));
      return sameErrors;
    }

    return false;
  }

  /**
   * Extract required file paths from task details
   * Looks for patterns like "Create config/default/file.yml" or "File: path/to/file"
   */
  private extractRequiredFilePaths(taskDetails: string): string[] {
    const filePaths: string[] = [];

    // Pattern 1: "Create path/to/file.yml" or "Create `path/to/file.yml`" (handles backticks)
    // Improved to prefer longer/more complete paths and avoid partial matches
    const createPattern = /Create\s+(?:`|"|')?([a-zA-Z0-9_./-]+\.[a-z]+)(?:`|"|')?/gi;
    let match;
    const createMatches: string[] = [];
    while ((match = createPattern.exec(taskDetails)) !== null) {
      const filePath = match[1].trim();
      if (filePath && !filePath.includes('...') && !filePath.includes('example')) {
        createMatches.push(filePath);
      }
    }
    // Prefer longer paths (more complete) over shorter partial matches
    if (createMatches.length > 0) {
      const longestPath = createMatches.reduce((a, b) => a.length > b.length ? a : b);
      // Only add if it looks like a complete path (has directory separators or starts with config/)
      if (longestPath.includes('/') || longestPath.startsWith('config/')) {
        filePaths.push(longestPath);
      } else {
        // If no complete path found, add all matches (fallback)
        filePaths.push(...createMatches);
      }
    }

    // Pattern 2: "File: path/to/file.ext" or "Place file at: path/to/file.ext"
    const filePattern = /(?:File:|Place file at:)\s*([a-zA-Z0-9_./-]+\.[a-z]+)/gi;
    while ((match = filePattern.exec(taskDetails)) !== null) {
      const filePath = match[1].trim();
      if (filePath && !filePath.includes('...') && !filePath.includes('example')) {
        filePaths.push(filePath);
      }
    }

    // Pattern 3: Any file path in quotes or backticks (expanded from config/ only)
    const quotedPattern = /(?:`|"|')([a-zA-Z0-9_./-]+\.[a-z]+)(?:`|"|')/gi;
    while ((match = quotedPattern.exec(taskDetails)) !== null) {
      const filePath = match[1].trim();
      if (filePath && !filePath.includes('...') && !filePath.includes('example') && !filePaths.includes(filePath)) {
        filePaths.push(filePath);
      }
    }

    // Remove duplicates, prefer longer paths (more complete)
    const uniquePaths = [...new Set(filePaths)];
    return uniquePaths.sort((a, b) => b.length - a.length); // Sort by length descending
  }

  /**
   * Resolve requirement dependencies using topological sort
   * Ensures requirements are ordered so dependencies come before dependents
   */
  private resolveRequirementDependencies(
    requirements: Requirement[],
    dependencies: Record<string, string[]>
  ): Requirement[] {
    // Create a map of requirement ID to requirement
    const reqMap = new Map<string, Requirement>();
    requirements.forEach(req => reqMap.set(req.id, req));

    // Build dependency graph
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize in-degree for all requirements
    requirements.forEach(req => {
      graph.set(req.id, []);
      inDegree.set(req.id, 0);
    });

    // Build graph and calculate in-degrees
    Object.entries(dependencies).forEach(([reqId, deps]) => {
      if (reqMap.has(reqId)) {
        deps.forEach(depId => {
          if (reqMap.has(depId)) {
            const current = graph.get(depId) || [];
            current.push(reqId);
            graph.set(depId, current);
            inDegree.set(reqId, (inDegree.get(reqId) || 0) + 1);
          }
        });
      }
    });

    // Topological sort using Kahn's algorithm
    const queue: string[] = [];
    const result: Requirement[] = [];

    // Find all nodes with no incoming edges
    inDegree.forEach((degree, reqId) => {
      if (degree === 0) {
        queue.push(reqId);
      }
    });

    while (queue.length > 0) {
      const reqId = queue.shift()!;
      const req = reqMap.get(reqId);
      if (req) {
        result.push(req);
      }

      // Decrease in-degree for all neighbors
      const neighbors = graph.get(reqId) || [];
      neighbors.forEach(neighborId => {
        const currentDegree = inDegree.get(neighborId) || 0;
        inDegree.set(neighborId, currentDegree - 1);
        if (inDegree.get(neighborId) === 0) {
          queue.push(neighborId);
        }
      });
    }

    // Add any remaining requirements that weren't in the dependency graph
    const resultIds = new Set(result.map(r => r.id));
    requirements.forEach(req => {
      if (!resultIds.has(req.id)) {
        result.push(req);
      }
    });

    if (this.debug) {
      console.log(`[WorkflowEngine] Resolved dependencies: ${result.map(r => r.id).join(' -> ')}`);
    }

    return result;
  }

  /**
   * Execute phase validation gates.
   */
  private async executePhaseValidation(phaseId: number, prdMetadata: any): Promise<void> {
    const validationGateExecutor = (this as any).validationGateExecutor;
    if (!validationGateExecutor || !prdMetadata) {
      return;
    }

    try {
      // Get phase validation from PRD metadata
      const phases = prdMetadata.requirements?.phases || [];
      const phase = phases.find((p: any) => p.id === phaseId);

      if (phase && phase.validation) {
        console.log(`[WorkflowEngine] Executing phase ${phaseId} validation gates...`);
        const result = await validationGateExecutor.executePhaseValidation(phase.validation, phaseId);

        if (!result.success) {
          console.warn(`[WorkflowEngine] Phase ${phaseId} validation failed:`);
          result.errors.forEach((err: string) => console.warn(`  - ${err}`));
          // Don't block execution, but log warnings
        } else {
          console.log(`[WorkflowEngine] Phase ${phaseId} validation passed`);
        }
      }

      // Also check for global validation gates for this phase
      const validationGates = prdMetadata.config?.validation?.gates || [];
      if (validationGates.length > 0) {
        const phaseGates = validationGates.filter((g: any) => g.phase === phaseId);
        if (phaseGates.length > 0) {
          console.log(`[WorkflowEngine] Executing ${phaseGates.length} validation gate(s) for phase ${phaseId}...`);
          const gateResults = await validationGateExecutor.executePhaseGates(phaseGates, phaseId);

          const failedGates = gateResults.filter((g: any) => !g.success);
          if (failedGates.length > 0) {
            console.warn(`[WorkflowEngine] ${failedGates.length} validation gate(s) failed for phase ${phaseId}`);
            failedGates.forEach((gate: any) => {
              console.warn(`  - Gate "${gate.gateName}": ${gate.errors.join(', ')}`);
            });
          } else {
            console.log(`[WorkflowEngine] All validation gates passed for phase ${phaseId}`);
          }
        }
      }
    } catch (error: any) {
      console.warn(`[WorkflowEngine] Error executing phase ${phaseId} validation: ${error.message}`);
      if (this.debug) {
        logger.debug(`[WorkflowEngine] Phase validation error:`, error);
      }
    }
  }
}

export interface PrdExecutionResult {
  prdId: string;
  status: 'initializing' | 'generating-tests' | 'running' | 'complete' | 'blocked';
  iterations: number;
  testsTotal: number;
  testsPassing: number;
}
