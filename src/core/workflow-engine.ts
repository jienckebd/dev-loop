import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from '../config/schema';
import { Task, WorkflowState, CodeChanges, TaskContext } from '../types';
import { TaskMasterBridge } from './task-bridge';
import { StateManager } from './state-manager';
import { TemplateManager } from './template-manager';
import { InterventionSystem, ApprovalResult } from './intervention';
import { AIProviderFactory } from '../providers/ai/factory';
import { TestRunnerFactory } from '../providers/test-runners/factory';
import { LogAnalyzerFactory } from '../providers/log-analyzers/factory';
import { AIProvider } from '../providers/ai/interface';

const execAsync = promisify(exec);

export interface WorkflowResult {
  completed: boolean;
  noTasks: boolean;
  taskId?: string;
  error?: string;
}

export class WorkflowEngine {
  private taskBridge: TaskMasterBridge;
  private stateManager: StateManager;
  private templateManager: TemplateManager;
  private intervention: InterventionSystem;
  private aiProvider: AIProvider;
  private testRunner: any;
  private logAnalyzer: any;
  private shutdownRequested = false;

  constructor(private config: Config) {
    this.taskBridge = new TaskMasterBridge(config);
    this.stateManager = new StateManager(config);
    this.templateManager = new TemplateManager(
      config.templates.source,
      config.templates.customPath
    );
    this.intervention = new InterventionSystem(config);
    this.aiProvider = AIProviderFactory.createWithFallback(config);
    this.testRunner = TestRunnerFactory.create(config);
    this.logAnalyzer = LogAnalyzerFactory.create(config);
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

      const task = tasks[0];
      await this.updateState({
        status: 'executing-ai',
        currentTask: task,
      });

      // Update task status to in-progress
      await this.taskBridge.updateTaskStatus(task.id, 'in-progress');

      // Generate code using AI
      const codebaseContext = await this.getCodebaseContext();
      const context: TaskContext = {
        task,
        codebaseContext,
      };

      // Get template with context substitution
      const template = await this.templateManager.getTaskGenerationTemplateWithContext({
        task: {
          title: task.title,
          description: task.description,
          priority: task.priority,
        },
        codebaseContext,
      });

      const changes = await this.aiProvider.generateCode(template, context);

      // Update state: ApplyingChanges
      await this.updateState({ status: 'applying-changes' });

      // Check if approval is needed
      const needsApproval = await this.intervention.requiresApproval(changes);
      if (needsApproval) {
        await this.updateState({ status: 'awaiting-approval' });
        const approval = await this.intervention.requestApproval(changes);
        if (!approval.approved) {
          // Reject changes, mark task as pending again
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

      // Apply changes to filesystem
      await this.applyChanges(changes);

      // Execute pre-test hooks (e.g., cache clearing)
      if (this.config.hooks?.preTest && this.config.hooks.preTest.length > 0) {
        await this.updateState({ status: 'running-pre-test-hooks' });
        await this.executePreTestHooks();
      }

      // Update state: RunningTests
      await this.updateState({ status: 'running-tests' });

      // Run tests
      const testResult = await this.testRunner.run({
        command: this.config.testing.command,
        timeout: this.config.testing.timeout,
        artifactsDir: this.config.testing.artifactsDir,
      });

      // Update state: AnalyzingLogs
      await this.updateState({ status: 'analyzing-logs' });

      // Analyze logs if configured
      let logAnalysis = null;
      if (this.config.logs.sources.length > 0) {
        logAnalysis = await this.logAnalyzer.analyze(this.config.logs.sources);
      }

      // Check if tests passed and no critical errors in logs
      const hasErrors = !testResult.success ||
        (logAnalysis && logAnalysis.errors.length > 0);

      if (hasErrors) {
        // Create fix task
        await this.updateState({ status: 'creating-fix-task' });
        const errorDescription = testResult.success
          ? logAnalysis?.summary || 'Log analysis found errors'
          : testResult.output;

        await this.taskBridge.createFixTask(
          task.id,
          errorDescription,
          testResult.output
        );

        // Mark original task as pending again
        await this.taskBridge.updateTaskStatus(task.id, 'pending');
        await this.updateState({ status: 'idle' });

        return {
          completed: false,
          noTasks: false,
          taskId: task.id,
          error: 'Tests failed or errors found in logs',
        };
      }

      // Update state: MarkingDone
      await this.updateState({ status: 'marking-done' });

      // Mark task as done
      await this.taskBridge.updateTaskStatus(task.id, 'done');

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
      await this.updateState({ status: 'idle' });
      return {
        completed: false,
        noTasks: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async applyChanges(changes: CodeChanges): Promise<void> {
    for (const file of changes.files) {
      const filePath = path.resolve(process.cwd(), file.path);

      if (file.operation === 'delete') {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
        }
      } else if (file.operation === 'create' || file.operation === 'update') {
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, file.content, 'utf-8');
      }
    }
  }

  private async getCodebaseContext(): Promise<string> {
    // Simple implementation: read key files
    // In a real implementation, this could be more sophisticated
    const contextFiles = [
      'package.json',
      'README.md',
      'tsconfig.json',
    ];

    const contexts: string[] = [];
    for (const file of contextFiles) {
      const filePath = path.join(process.cwd(), file);
      if (await fs.pathExists(filePath)) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          contexts.push(`\n${file}:\n${content}`);
        } catch {
          // Ignore read errors
        }
      }
    }

    return contexts.join('\n---\n');
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
}

