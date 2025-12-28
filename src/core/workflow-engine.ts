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
  private debug = false;

  constructor(private config: Config) {
    this.debug = (config as any).debug || false;
    if (this.debug) {
      console.log('[DEBUG] WorkflowEngine initialized with debug mode');
    }
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
      if (this.debug) {
        console.log(`[DEBUG] AI Provider: ${this.aiProvider.name || 'unknown'}`);
        console.log(`[DEBUG] Model: ${(this.config.ai as any)?.model || 'default'}`);
        console.log(`[DEBUG] Max tokens: ${(this.config.ai as any)?.maxTokens || 'default'}`);
        console.log(`[DEBUG] Context size: ${(context as any).existingCode?.length || 0} chars`);
      }
      const changes = await this.aiProvider.generateCode(template, context);
      console.log('[WorkflowEngine] AI response received, files:', changes.files?.length || 0);
      if (this.debug && changes.summary) {
        console.log(`[DEBUG] AI summary: ${changes.summary}`);
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

        const fixTask = await this.taskBridge.createFixTask(
          task.id,
          errorDescription,
          testResult.output
        );

        if (fixTask) {
          // Mark original task as pending again for retry
          await this.taskBridge.updateTaskStatus(task.id, 'pending');
        } else {
          // Max retries exceeded - task was marked as blocked
          console.log(`[WorkflowEngine] Task ${task.id} blocked after max retries, moving to next task`);
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
      const isValid = await this.validateFileSyntax(filePath);
      if (!isValid) {
        console.error(`[WorkflowEngine] File ${file.path} has syntax errors, reverted`);
      }
    }
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

    // Get max context size from config (default ~80k chars = ~20k tokens)
    const maxContextChars = (this.config.ai as any)?.maxContextChars || 80000;
    let totalContextSize = 0;

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

          // For large files, extract relevant sections based on task keywords
          let fileContext: string;
          if (content.length > 15000) {
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
    if (this.debug && mentionedFiles.length > validFiles.length) {
      console.log(`[DEBUG] Files mentioned but not found/skipped: ${mentionedFiles.filter(f => !validFiles.includes(f)).join(', ')}`);
    }

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
    const discoveredFiles: Map<string, number> = new Map(); // file -> relevance score

    // Get ignore globs from config
    const codebaseConfig = this.config.codebase || {};
    const ignoreGlobs: string[] = (codebaseConfig as any).ignoreGlobs || [];

    // Build exclude pattern for grep
    const excludePattern = excludeDirs.map(d => `--exclude-dir=${d}`).join(' ');
    const includePattern = extensions.map(e => `--include=*.${e}`).join(' ');

    // Common words to skip - these match too many files
    const stopwords = new Set([
      'File', 'Move', 'Step', 'Steps', 'Configure', 'Verify', 'Create', 'Update',
      'Delete', 'Add', 'Remove', 'Get', 'Set', 'Load', 'Save', 'Check', 'Validate',
      'Process', 'Handle', 'Build', 'Execute', 'Run', 'Start', 'Stop', 'Implement',
      'Test', 'Tests', 'Config', 'Settings', 'Options', 'Data', 'Info', 'Field',
      'Entity', 'Bundle', 'Type', 'Form', 'View', 'Display', 'Render', 'Output'
    ]);

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
   * Extract relevant sections from a large file based on keywords
   */
  private extractRelevantSections(content: string, keywords: string[], filePath: string): string | null {
    const lines = content.split('\n');
    const sections: string[] = [];
    const seenRanges: Set<string> = new Set();
    const maxSections = 5; // Limit number of sections to prevent massive context
    const maxTotalChars = 10000; // Limit total chars from this file
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

    // Search for keyword occurrences in the file
    const keywordPatterns = keywords.filter(k => !k.startsWith('LINE:'));
    for (const keyword of keywordPatterns) {
      if (sections.length >= maxSections || totalChars >= maxTotalChars) break;

      try {
        const regex = new RegExp(keyword, 'gi');
        for (let i = 0; i < lines.length; i++) {
          if (sections.length >= maxSections || totalChars >= maxTotalChars) break;

          if (regex.test(lines[i])) {
            const start = Math.max(0, i - 10);
            const end = Math.min(lines.length, i + 15);
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
}
