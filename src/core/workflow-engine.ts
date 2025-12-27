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
      const { codebaseContext, targetFiles, existingCode } = await this.getCodebaseContext(task);
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
        targetFiles,
        existingCode,
        templateType: targetFiles ? 'drupal' : 'generic',
      });

      console.log('[WorkflowEngine] Calling AI provider to generate code...');
      console.log('[WorkflowEngine] Task:', context.task.title);
      const changes = await this.aiProvider.generateCode(template, context);
      console.log('[WorkflowEngine] AI response received, files:', changes.files?.length || 0);

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
      console.log('[WorkflowEngine] Applying changes to filesystem...');
      await this.applyChanges(changes);
      console.log('[WorkflowEngine] Changes applied');

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
      console.log('[WorkflowEngine] Running tests...');

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

        // Build comprehensive error description including log errors
        let errorDescription = '';
        if (!testResult.success) {
          errorDescription = testResult.output;
        }
        if (logAnalysis && logAnalysis.errors.length > 0) {
          // Include actual log errors for AI context
          const logErrors = logAnalysis.errors.slice(0, 10).join('\n');
          errorDescription += '\n\nLog Errors:\n' + logErrors;
        }
        if (!errorDescription) {
          errorDescription = logAnalysis?.summary || 'Log analysis found errors';
        }

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
      } else if (file.operation === 'patch' && file.patches) {
        // Apply search/replace patches to existing file
        if (await fs.pathExists(filePath)) {
          let content = await fs.readFile(filePath, 'utf-8');
          let patchesApplied = 0;

          for (const patch of file.patches) {
            if (content.includes(patch.search)) {
              content = content.replace(patch.search, patch.replace);
              patchesApplied++;
              console.log(`[WorkflowEngine] Applied patch ${patchesApplied} to ${file.path}`);
            } else {
              console.warn(`[WorkflowEngine] Patch search string not found in ${file.path}:`, patch.search.substring(0, 100));
            }
          }

          if (patchesApplied > 0) {
            await fs.writeFile(filePath, content, 'utf-8');
            console.log(`[WorkflowEngine] Applied ${patchesApplied}/${file.patches.length} patches to ${file.path}`);
          }
        } else {
          console.warn(`[WorkflowEngine] Cannot patch non-existent file: ${file.path}`);
        }
      } else if (file.operation === 'create' || file.operation === 'update') {
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, file.content || '', 'utf-8');
      }

      // Validate syntax for supported languages
      await this.validateFileSyntax(filePath);
    }
  }

  /**
   * Validate file syntax for supported languages
   */
  private async validateFileSyntax(filePath: string): Promise<void> {
    if (!await fs.pathExists(filePath)) return;

    try {
      if (filePath.endsWith('.php')) {
        await execAsync(`php -l "${filePath}"`);
      } else if (filePath.endsWith('.json')) {
        const content = await fs.readFile(filePath, 'utf-8');
        JSON.parse(content);
      }
      // Add more language validators as needed
    } catch (error) {
      console.warn(`Syntax check failed for ${filePath}:`, error instanceof Error ? error.message : String(error));
      // Don't fail - let the framework handle validation
    }
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
    // Generic pattern that matches common path formats
    const genericPathPattern = new RegExp(
      `([\\w./\\-]+\\.(${extensions.join('|')}))`,
      'gi'
    );
    let match;
    while ((match = genericPathPattern.exec(taskText)) !== null) {
      const filePath = match[1];
      // Only add if it looks like a path (contains / or is a simple filename)
      if ((filePath.includes('/') || filePath.includes('.')) && !mentionedFiles.includes(filePath)) {
        mentionedFiles.push(filePath);
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

    // Load mentioned files
    for (const file of mentionedFiles) {
      const filePath = path.resolve(process.cwd(), file);
      if (await fs.pathExists(filePath)) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          validFiles.push(file);

          // For large files, extract relevant sections based on task keywords
          if (content.length > 15000) {
            const keywords = this.extractKeywordsFromTask(task);
            const relevantSections = this.extractRelevantSections(content, keywords, file);

            if (relevantSections) {
              contexts.push(`\n### EXISTING FILE: ${file} (relevant sections)\n${relevantSections}`);
              existingCodeSections.push(`\n### ${file} (relevant sections):\n${relevantSections}`);
            } else {
              // Fallback to showing start of file
              const truncated = content.substring(0, 15000) + '\n\n... (file truncated, showing first 15000 chars) ...';
              contexts.push(`\n### EXISTING FILE: ${file}\n${truncated}`);
              existingCodeSections.push(`\n### ${file}:\n${truncated}`);
            }
          } else {
            contexts.push(`\n### EXISTING FILE: ${file}\n${content}`);
            existingCodeSections.push(`\n### ${file}:\n${content}`);
          }
        } catch {
          // Ignore read errors
        }
      }
    }

    console.log(`[WorkflowEngine] Found ${validFiles.length} relevant files:`, validFiles);

    return {
      codebaseContext: contexts.length > 0
        ? `## Existing Code Files (MODIFY THESE, DO NOT CREATE NEW FILES UNLESS NECESSARY)\n${contexts.join('\n---\n')}`
        : '',
      targetFiles: validFiles.length > 0 ? validFiles.join('\n') : undefined,
      existingCode: existingCodeSections.length > 0 ? existingCodeSections.join('\n---\n') : undefined,
    };
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

    // Match snake_case function names (common in Python, PHP hooks, etc.)
    const snakeCasePattern = /\b((?:hook_|_)[a-z][a-z0-9_]+)\b/g;
    while ((match = snakeCasePattern.exec(taskText)) !== null) {
      if (!identifiers.includes(match[1])) {
        identifiers.push(match[1]);
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
    const discoveredFiles: string[] = [];

    // Build exclude pattern for grep
    const excludePattern = excludeDirs.map(d => `--exclude-dir=${d}`).join(' ');
    const includePattern = extensions.map(e => `--include=*.${e}`).join(' ');

    for (const identifier of identifiers.slice(0, 10)) { // Limit to first 10 identifiers
      try {
        // Try ripgrep first (faster), fall back to grep
        let command: string;
        const searchPath = searchDirs.filter(d => fs.existsSync(path.resolve(process.cwd(), d))).join(' ') || '.';

        // Check if ripgrep is available
        try {
          await execAsync('which rg');
          // Ripgrep command
          const rgExclude = excludeDirs.map(d => `--glob=!${d}`).join(' ');
          const rgInclude = extensions.map(e => `--glob=*.${e}`).join(' ');
          command = `rg -l "${identifier}" ${rgExclude} ${rgInclude} ${searchPath} 2>/dev/null || true`;
        } catch {
          // Fall back to grep
          command = `grep -rl "${identifier}" ${excludePattern} ${includePattern} ${searchPath} 2>/dev/null || true`;
        }

        const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024 });
        const files = stdout.trim().split('\n').filter(f => f.length > 0);

        // Limit files per identifier to avoid overwhelming context
        for (const file of files.slice(0, 3)) {
          if (!discoveredFiles.includes(file)) {
            discoveredFiles.push(file);
          }
        }
      } catch {
        // Ignore grep errors
      }
    }

    // Limit total discovered files
    return discoveredFiles.slice(0, 10);
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
   * Extract relevant sections from a large file based on keywords
   */
  private extractRelevantSections(content: string, keywords: string[], filePath: string): string | null {
    const lines = content.split('\n');
    const sections: string[] = [];
    const seenRanges: Set<string> = new Set();

    // First, handle LINE: markers
    for (const keyword of keywords) {
      if (keyword.startsWith('LINE:')) {
        const lineNum = parseInt(keyword.replace('LINE:', ''), 10);
        if (!isNaN(lineNum) && lineNum > 0 && lineNum <= lines.length) {
          const start = Math.max(0, lineNum - 20);
          const end = Math.min(lines.length, lineNum + 20);
          const rangeKey = `${start}-${end}`;
          if (!seenRanges.has(rangeKey)) {
            seenRanges.add(rangeKey);
            const section = lines.slice(start, end).map((l, i) => `${start + i + 1}|${l}`).join('\n');
            sections.push(`\n// LINES ${start + 1}-${end} (around line ${lineNum}):\n${section}`);
          }
        }
      }
    }

    // Search for keyword occurrences in the file
    const keywordPatterns = keywords.filter(k => !k.startsWith('LINE:'));
    for (const keyword of keywordPatterns) {
      try {
        const regex = new RegExp(keyword, 'gi');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const start = Math.max(0, i - 10);
            const end = Math.min(lines.length, i + 15);
            const rangeKey = `${start}-${end}`;
            if (!seenRanges.has(rangeKey)) {
              seenRanges.add(rangeKey);
              const section = lines.slice(start, end).map((l, idx) => `${start + idx + 1}|${l}`).join('\n');
              sections.push(`\n// LINES ${start + 1}-${end} (found "${keyword}"):\n${section}`);
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
      return `FILE: ${filePath}\nTotal lines: ${lines.length}\n\n${sections.join('\n\n---\n')}`;
    }

    return null;
  }
}
