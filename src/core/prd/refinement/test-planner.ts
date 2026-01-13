/**
 * Test Planner
 *
 * Generates test specifications (not actual test files, but test plans/specs).
 * Integrates with existing TestGenerator for templates and framework-specific generation.
 */

import { ParsedPlanningDoc, ParsedPhase, ParsedTask } from '../parser/planning-doc-parser';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureType } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { TestGenerator } from '../../testing/generator';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { TextGenerationAdapter } from './text-generation-adapter';
import { CodebaseInsight } from './codebase-insight-extractor';
import { Answer } from '../../conversation/types';
import { CodeContextProvider, FileContext } from '../../analysis/code/context-provider';
import { extractJsonArray } from '../../../providers/ai/json-parser';
import { logger } from '../../utils/logger';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * Test Plan Specification
 */
export interface TestPlanSpec {
  id: string; // e.g., "test-{task-id}"
  taskId: string;
  phaseId: number;
  testType: 'unit' | 'integration' | 'e2e' | 'acceptance' | 'smoke';
  description: string;
  testCases: TestCase[];
  framework?: string;
  testRunner?: 'playwright' | 'cypress' | 'jest' | 'phpunit' | 'pytest';
  testFile?: string; // Suggested test file path
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependencies?: string[]; // Other test plans this depends on
}

/**
 * Test Case
 */
export interface TestCase {
  name: string;
  description: string;
  steps: string[];
  expectedResult: string;
  validationChecklist?: string[];
}

/**
 * Test Planning Result
 */
export interface TestPlanningResult {
  testPlans: TestPlanSpec[];
  summary: string;
  coverage: {
    totalTasks: number;
    tasksWithTests: number;
    coveragePercentage: number;
  };
}

/**
 * Test Planner Configuration
 */
export interface TestPlannerConfig {
  projectRoot: string;
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  codebaseAnalysis: CodebaseAnalysisResult;
  promptSelector: PromptSelector;
  testGenerator?: TestGenerator; // Optional: leverage existing TestGenerator
  debug?: boolean;
  /**
   * Whether @codebase tag is being used for AI calls.
   * When true, prompts will be minimal since Cursor provides indexed context.
   * When false, full codebase context is included in prompts.
   * 
   * Default behavior:
   * - For Cursor provider: true (uses Cursor's indexed codebase)
   * - For API providers (Anthropic, OpenAI, etc.): false (include full context)
   * 
   * This can be explicitly set to override the default behavior.
   */
  useCodebaseTag?: boolean;
}

/**
 * Generates test specifications for PRD requirements
 */
export class TestPlanner {
  private config: TestPlannerConfig;
  private textGenerator: TextGenerationAdapter;
  private contextProvider: CodeContextProvider;
  private debug: boolean;

  constructor(config: TestPlannerConfig) {
    this.config = config;
    this.debug = config.debug || false;
    this.textGenerator = new TextGenerationAdapter(
      config.aiProvider,
      config.aiProviderConfig,
      this.debug
    );
    this.contextProvider = new CodeContextProvider(this.debug);
  }

  /**
   * Execute an operation with retry logic and exponential backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const isJsonError = error instanceof Error &&
          (error.message.includes('JSON') || error.message.includes('parse'));
        const isRetryable = isJsonError || (error instanceof Error && error.message.includes('timeout'));

        if (attempt === maxRetries || !isRetryable) {
          logger.warn(`[TestPlanner] ${operationName} failed after ${attempt} attempts: ${error}`);
          return null;
        }

        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.debug(`[TestPlanner] ${operationName} retry ${attempt}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return null;
  }

  /**
   * Generate test plans for PRD
   *
   * Uses batch AI calls to reduce the number of AI invocations.
   * Instead of one AI call per task (26 calls for 26 tasks),
   * batches multiple tasks into single prompts (5-8 calls total).
   */
  async generateTestPlans(
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<TestPlanningResult> {
    logger.debug(`[TestPlanner] Generating test plans for PRD ${prd.prdId}`);

    const testPlans: TestPlanSpec[] = [];

    // Flatten all tasks across phases
    const allTasks: Array<{ task: ParsedTask; phase: ParsedPhase }> = [];
    for (const phase of prd.phases) {
      if (!phase.tasks) continue;
      for (const task of phase.tasks) {
        allTasks.push({ task, phase });
      }
    }

    // Filter out tasks that already have valid test files
    const tasksNeedingTests: Array<{ task: ParsedTask; phase: ParsedPhase }> = [];
    for (const { task, phase } of allTasks) {
      const testFile = this.determineTestFilePath(task, phase, prd);
      const fullPath = path.join(this.config.projectRoot, testFile);

      if (await fs.pathExists(fullPath)) {
        try {
          const existingContent = await fs.readFile(fullPath, 'utf-8');
          if (this.isValidTestFile(existingContent)) {
            logger.debug(`[TestPlanner] Skipping ${task.id} - test file already exists`);
            // Create test plan from existing file
            const testType = this.determineTestType(task, phase, prd.phases.length);
            const testRunner = this.determineTestRunner();
            const priority = this.determinePriority(task, phase);
            testPlans.push({
              id: `test-${task.id}`,
              taskId: task.id,
              phaseId: phase.id,
              testType,
              description: `Test plan for ${task.title} (existing)`,
              testCases: [], // Existing file, no need to generate
              framework: this.config.codebaseAnalysis.framework,
              testRunner,
              testFile,
              priority,
              dependencies: task.dependencies || [],
            });
            continue;
          }
        } catch (error) {
          // Continue to add to needs tests
        }
      }
      tasksNeedingTests.push({ task, phase });
    }

    if (tasksNeedingTests.length === 0) {
      logger.info(`[TestPlanner] All ${allTasks.length} tasks already have valid test files`);
    } else {
      // Batch size: 5 tasks per AI call (reduces 20 tasks from 20 calls to 4 calls)
      const BATCH_SIZE = 5;
      logger.info(`[TestPlanner] Generating test plans for ${tasksNeedingTests.length} tasks in batches of ${BATCH_SIZE}`);

      // Import build metrics for batch tracking
      let buildMetrics: any = null;
      try {
        const { getBuildMetrics } = await import('../../../core/metrics/build');
        buildMetrics = getBuildMetrics();
      } catch {
        // Build metrics not available
      }

      for (let i = 0; i < tasksNeedingTests.length; i += BATCH_SIZE) {
        const batch = tasksNeedingTests.slice(i, i + BATCH_SIZE);
        logger.debug(`[TestPlanner] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} tasks`);

        try {
          const batchPlans = await this.generateBatchTestPlans(batch, prd, context);
          testPlans.push(...batchPlans);
          // Record successful batch
          if (buildMetrics) {
            buildMetrics.recordBatchResult(true, batch.length, false);
          }
        } catch (error) {
          logger.warn(`[TestPlanner] Batch generation failed, falling back to individual: ${error}`);
          // Record failed batch with fallback
          if (buildMetrics) {
            buildMetrics.recordBatchResult(false, batch.length, true);
          }
          // Fallback to individual generation for this batch
          for (const { task, phase } of batch) {
            try {
              const testPlan = await this.generateTestPlanForTask(task, phase, prd, context);
              if (testPlan) {
                testPlans.push(testPlan);
              }
            } catch (err) {
              logger.warn(`[TestPlanner] Failed to generate test plan for task ${task.id}: ${err}`);
            }
          }
        }
      }
    }

    // Calculate coverage
    const totalTasks = prd.phases.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0);
    const tasksWithTests = testPlans.length;
    const coveragePercentage = totalTasks > 0 ? Math.round((tasksWithTests / totalTasks) * 100) : 0;

    // Generate summary
    const summary = this.generateSummary(testPlans, totalTasks, tasksWithTests, coveragePercentage);

    return {
      testPlans,
      summary,
      coverage: {
        totalTasks,
        tasksWithTests,
        coveragePercentage,
      },
    };
  }

  /**
   * Generate test plans for multiple tasks in a single AI call
   * Reduces AI calls by batching tasks together
   */
  private async generateBatchTestPlans(
    tasks: Array<{ task: ParsedTask; phase: ParsedPhase }>,
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<TestPlanSpec[]> {
    // Get prompt template
    const prompt = await this.config.promptSelector.getPromptForUseCase('test-planning', {
      mode: 'convert',
      framework: this.config.codebaseAnalysis.framework,
      featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
    });

    // Build batch prompt
    const batchPrompt = this.buildBatchTestPlanPrompt(tasks, prd, prompt);

    // Execute with retry
    const batchResponse = await this.executeWithRetry(
      async () => {
        const response = await this.textGenerator.generate(batchPrompt, {
          maxTokens: 6000, // More tokens for batch response
          temperature: 0.4,
          systemPrompt: 'You are an expert at generating test plans. Generate test cases for ALL tasks provided.',
        });

        if (!response || response.trim().length < 50) {
          throw new Error('Empty or too short batch response');
        }

        return response;
      },
      `generateBatchTestPlans(${tasks.length} tasks)`
    );

    // Parse batch response
    return this.parseBatchTestPlansResponse(batchResponse || '', tasks, prd);
  }

  /**
   * Build prompt for batch test plan generation
   *
   * Uses explicit JSON format instructions to maximize parsing reliability.
   */
  private buildBatchTestPlanPrompt(
    tasks: Array<{ task: ParsedTask; phase: ParsedPhase }>,
    prd: ParsedPlanningDoc,
    basePrompt: string
  ): string {
    const parts: string[] = [];

    // Emphasize JSON-only output at the start
    parts.push('**CRITICAL: Your entire response must be ONLY a valid JSON array. No explanation, no markdown, no text before or after.**');
    parts.push('');
    parts.push(basePrompt);
    parts.push('\n---\n');
    parts.push('## Batch Test Plan Generation');
    parts.push(`Generate test plans for ${tasks.length} tasks. Output ONLY a JSON array.`);
    parts.push('');

    // Framework context (brief)
    if (this.config.codebaseAnalysis.frameworkPlugin) {
      parts.push(`Framework: ${this.config.codebaseAnalysis.frameworkPlugin.name}`);
      parts.push('');
    }

    // List all tasks concisely
    parts.push('## Tasks');
    for (let i = 0; i < tasks.length; i++) {
      const { task, phase } = tasks[i];
      parts.push(`${i + 1}. **${task.id}**: ${task.title} (Phase: ${phase.name})`);
      if (task.description.length > 100) {
        parts.push(`   ${task.description.substring(0, 100)}...`);
      } else {
        parts.push(`   ${task.description}`);
      }
    }
    parts.push('');

    parts.push('## Required JSON Format');
    parts.push('Output EXACTLY this format (replace placeholders with actual values):');
    parts.push('');
    parts.push('[');
    for (let i = 0; i < Math.min(tasks.length, 2); i++) {
      const { task } = tasks[i];
      parts.push(`  {"taskId": "${task.id}", "testCases": [{"name": "test name", "description": "test desc", "steps": ["step1"], "expectedResult": "expected"}]}${i < Math.min(tasks.length, 2) - 1 ? ',' : ''}`);
    }
    if (tasks.length > 2) {
      parts.push(`  // ... include all ${tasks.length} tasks`);
    }
    parts.push(']');
    parts.push('');
    parts.push('**REMINDER: Output ONLY the JSON array. No other text.**');

    return parts.join('\n');
  }

  /**
   * Parse batch test plans response
   *
   * Uses robust JSON extraction that handles:
   * - Markdown code blocks
   * - Escaped JSON
   * - Partial/truncated JSON
   * - Mixed text and JSON responses
   */
  private parseBatchTestPlansResponse(
    response: string,
    tasks: Array<{ task: ParsedTask; phase: ParsedPhase }>,
    prd: ParsedPlanningDoc
  ): TestPlanSpec[] {
    const testPlans: TestPlanSpec[] = [];

    // Use generic JSON array extraction with schema hints
    interface BatchTestPlanItem {
      taskId?: string;
      task?: string;
      testCases?: any[];
      tests?: any[];
      cases?: any[];
    }

    const parsed = extractJsonArray<BatchTestPlanItem>(response, {
      requiredFields: ['taskId'], // At minimum need taskId to match
    });

    if (parsed && parsed.length > 0) {
      logger.debug(`[TestPlanner] Successfully extracted ${parsed.length} batch items`);

      for (const item of parsed) {
        // Find matching task - try multiple matching strategies
        const matchingTask = this.findMatchingTask(item, tasks);

        if (matchingTask) {
          const { task, phase } = matchingTask;
          // testCases might be under different keys
          const rawTestCases = item.testCases || item.tests || item.cases || [];
          const testCases = this.normalizeTestCases(rawTestCases);

          if (testCases.length > 0) {
            testPlans.push({
              id: `test-${task.id}`,
              taskId: task.id,
              phaseId: phase.id,
              testType: this.determineTestType(task, phase, prd.phases.length),
              description: `Test plan for ${task.title}`,
              testCases,
              framework: this.config.codebaseAnalysis.framework,
              testRunner: this.determineTestRunner(),
              testFile: this.determineTestFilePath(task, phase, prd),
              priority: this.determinePriority(task, phase),
              dependencies: task.dependencies || [],
            });
          }
        } else {
          logger.debug(`[TestPlanner] Could not match batch item to task: ${JSON.stringify(item).substring(0, 100)}`);
        }
      }
    }

    // If we got some results from batch parsing, return them
    if (testPlans.length > 0) {
      logger.debug(`[TestPlanner] Parsed ${testPlans.length} test plans from batch response`);
      return testPlans;
    }

    // Fallback: try to extract individual task sections from text
    logger.debug('[TestPlanner] Batch parsing yielded no results, trying text extraction fallback');
    for (const { task, phase } of tasks) {
      const testCases = this.parseTestCasesResponse(response, task);
      if (testCases && testCases.length > 0) {
        testPlans.push({
          id: `test-${task.id}`,
          taskId: task.id,
          phaseId: phase.id,
          testType: this.determineTestType(task, phase, prd.phases.length),
          description: `Test plan for ${task.title}`,
          testCases,
          framework: this.config.codebaseAnalysis.framework,
          testRunner: this.determineTestRunner(),
          testFile: this.determineTestFilePath(task, phase, prd),
          priority: this.determinePriority(task, phase),
          dependencies: task.dependencies || [],
        });
      }
    }

    logger.debug(`[TestPlanner] Parsed ${testPlans.length} test plans from batch response (after fallback)`);
    return testPlans;
  }

  /**
   * Find matching task for a batch item using multiple strategies
   */
  private findMatchingTask(
    item: { taskId?: string; task?: string; [key: string]: any },
    tasks: Array<{ task: ParsedTask; phase: ParsedPhase }>
  ): { task: ParsedTask; phase: ParsedPhase } | undefined {
    const taskIdNeedle = (item.taskId || item.task || '').toLowerCase().trim();

    // Strategy 1: Exact ID match
    let match = tasks.find(t => t.task.id.toLowerCase() === taskIdNeedle);
    if (match) return match;

    // Strategy 2: ID contains match
    match = tasks.find(t =>
      t.task.id.toLowerCase().includes(taskIdNeedle) ||
      taskIdNeedle.includes(t.task.id.toLowerCase())
    );
    if (match) return match;

    // Strategy 3: Title contains match
    match = tasks.find(t =>
      t.task.title.toLowerCase().includes(taskIdNeedle) ||
      taskIdNeedle.includes(t.task.title.toLowerCase())
    );
    if (match) return match;

    // Strategy 4: Fuzzy number match (e.g., "Task 1" matches "REQ-1.1")
    const numbers = taskIdNeedle.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      const numStr = numbers.join('.');
      match = tasks.find(t => t.task.id.includes(numStr));
      if (match) return match;
    }

    return undefined;
  }

  /**
   * Normalize test cases from parsed JSON
   */
  private normalizeTestCases(testCases: any[]): TestCase[] {
    return testCases
      .filter(tc => tc && (tc.name || tc.title))
      .map(tc => ({
        name: tc.name || tc.title || 'Unnamed test',
        description: tc.description || '',
        steps: Array.isArray(tc.steps) ? tc.steps : [],
        expectedResult: tc.expectedResult || tc.expected || '',
        validationChecklist: tc.validationChecklist || undefined,
      }));
  }

  /**
   * Generate test plans with context from user answers
   */
  async generateTestPlansWithContext(
    prd: ParsedPlanningDoc,
    answers: Map<string, any>,
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[] = [],
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<TestPlanningResult> {
    logger.debug(`[TestPlanner] Generating test plans with context from answers`);

    // Extract file contexts for test files
    const testFileContexts: Map<string, FileContext> = new Map();
    const testFiles = codebaseAnalysis.relevantFiles.filter(f =>
      f.includes('test') || f.includes('spec') || f.endsWith('.test.ts') || f.endsWith('.spec.ts')
    );

    for (const testFile of testFiles.slice(0, 10)) { // Limit to 10 files to avoid performance issues
      try {
        const fileContext = await this.contextProvider.getFileContext(testFile);
        if (fileContext) {
          testFileContexts.set(testFile, fileContext);
        }
      } catch (error) {
        logger.debug(`[TestPlanner] Failed to extract context from ${testFile}: ${error}`);
      }
    }

    // Extract helper method signatures from test files
    const helperMethods = new Set<string>();
    for (const fileContext of testFileContexts.values()) {
      if (fileContext.helperSignatures) {
        fileContext.helperSignatures.forEach(sig => helperMethods.add(sig));
      }
    }

    // Extract test patterns
    const testPatterns: Array<{ name: string; structure: string; lineNumber: number }> = [];
    for (const fileContext of testFileContexts.values()) {
      if (fileContext.testPatterns) {
        testPatterns.push(...fileContext.testPatterns);
      }
    }

    logger.debug(`[TestPlanner] Extracted ${helperMethods.size} helper method(s) and ${testPatterns.length} test pattern(s) from ${testFileContexts.size} test file(s)`);

    // Filter tasks based on answers
    let tasksToTest = prd.phases.flatMap(phase => (phase.tasks || []).map(task => ({ task, phase })));

    // Apply prioritization from answers
    if (answers.has('test-priority')) {
      const selectedTasks = answers.get('test-priority');
      if (Array.isArray(selectedTasks)) {
        // Extract task IDs from selected items (format: "task-id: title")
        const selectedIds = selectedTasks.map((item: string) => {
          const match = item.match(/^([^:]+):/);
          return match ? match[1].trim() : item.trim();
        });
        tasksToTest = tasksToTest.filter(({ task }) => selectedIds.includes(task.id));
      }
    }

    // Apply coverage level preference
    let coverageLevel: 'high' | 'medium' | 'low' = 'medium';
    if (answers.has('test-coverage-level')) {
      const level = answers.get('test-coverage-level');
      if (typeof level === 'string') {
        if (level.includes('High')) coverageLevel = 'high';
        else if (level.includes('Low')) coverageLevel = 'low';
      }
    }

    // Apply test type preference
    let preferredTypes: Array<'unit' | 'integration' | 'e2e'> = ['unit', 'integration', 'e2e'];
    if (answers.has('test-type-preference')) {
      const preference = answers.get('test-type-preference');
      if (typeof preference === 'string') {
        if (preference.includes('Unit')) preferredTypes = ['unit'];
        else if (preference.includes('Integration')) preferredTypes = ['integration'];
        else if (preference.includes('E2E')) preferredTypes = ['e2e'];
      }
    }

    // Use framework preference from answers
    let useFrameworkPatterns = true;
    if (answers.has('test-pattern-follow')) {
      const patternChoice = answers.get('test-pattern-follow');
      useFrameworkPatterns = patternChoice && patternChoice.includes('use');
    }

    // Generate test plans with context (including helper methods and test patterns)
    const testPlans: TestPlanSpec[] = [];

    // Limit tasks based on coverage level
    if (coverageLevel === 'low') {
      tasksToTest = tasksToTest.slice(0, Math.ceil(tasksToTest.length * 0.3));
    } else if (coverageLevel === 'medium') {
      tasksToTest = tasksToTest.slice(0, Math.ceil(tasksToTest.length * 0.7));
    }
    // High coverage = all tasks

    for (const { task, phase } of tasksToTest) {
      try {
        // Determine test type based on preference
        const testType = this.selectTestType(task, phase, prd.phases.length, preferredTypes);

        // Generate test plan with helper methods and patterns context
        const testPlan = await this.generateTestPlanForTask(
          task,
          phase,
          prd,
          context,
          {
            helperMethods: Array.from(helperMethods),
            testPatterns,
            fileContexts: testFileContexts,
          }
        );

        if (testPlan) {
          // Override test type if preference was set
          if (preferredTypes.length === 1) {
            testPlan.testType = preferredTypes[0] as any;
          }

          testPlans.push(testPlan);
        }
      } catch (error) {
        logger.warn(`[TestPlanner] Failed to generate test plan for task ${task.id}: ${error}`);
      }
    }

    // Calculate coverage
    const totalTasks = prd.phases.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0);
    const tasksWithTests = testPlans.length;
    const coveragePercentage = totalTasks > 0 ? Math.round((tasksWithTests / totalTasks) * 100) : 0;

    // Generate summary
    const summary = this.generateSummary(testPlans, totalTasks, tasksWithTests, coveragePercentage);

    return {
      testPlans,
      summary,
      coverage: {
        totalTasks,
        tasksWithTests,
        coveragePercentage,
      },
    };
  }

  /**
   * Refine specific test plans
   */
  async refineSpecificTestPlans(
    tests: TestPlanningResult,
    refineIds: string[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<TestPlanningResult> {
    logger.debug(`[TestPlanner] Refining ${refineIds.length} specific test plan(s): ${refineIds.join(', ')}`);

    const refinedPlans: TestPlanSpec[] = [];
    const plansToRefine = tests.testPlans.filter(
      tp => refineIds.includes(tp.id) || refineIds.includes(tp.taskId) || refineIds.some(id => tp.id.includes(id))
    );

    for (const plan of plansToRefine) {
      try {
        // Find related test patterns in codebase
        const relatedPatterns = this.findRelatedTestPatterns(plan, codebaseAnalysis);

        // Refine test plan using patterns
        const refined = await this.refineTestPlanWithPatterns(plan, relatedPatterns, codebaseAnalysis);
        refinedPlans.push(refined);
      } catch (error) {
        logger.warn(`[TestPlanner] Failed to refine test plan ${plan.id}: ${error}`);
        refinedPlans.push(plan); // Keep original if refinement fails
      }
    }

    // Keep plans that weren't refined
    const unchangedPlans = tests.testPlans.filter(p => !plansToRefine.includes(p));
    const allPlans = [...unchangedPlans, ...refinedPlans];

    // Recalculate coverage
    const totalTasks = tests.coverage.totalTasks;
    const tasksWithTests = allPlans.length;
    const coveragePercentage = totalTasks > 0 ? Math.round((tasksWithTests / totalTasks) * 100) : 0;

    return {
      testPlans: allPlans,
      summary: `Refined ${refinedPlans.length} test plan(s): ${refinedPlans.map(p => p.id).join(', ')}`,
      coverage: {
        totalTasks,
        tasksWithTests,
        coveragePercentage: Math.max(coveragePercentage, tests.coverage.coveragePercentage), // Don't decrease coverage
      },
    };
  }

  /**
   * Select test type based on preferences
   */
  private selectTestType(
    task: ParsedTask,
    phase: ParsedPhase,
    totalPhases: number,
    preferredTypes: Array<'unit' | 'integration' | 'e2e'>
  ): 'unit' | 'integration' | 'e2e' | 'acceptance' | 'smoke' {
    // Use preferred types if only one is specified
    if (preferredTypes.length === 1) {
      return preferredTypes[0] as any;
    }

    // Otherwise use existing determineTestType logic
    return this.determineTestType(task, phase, totalPhases);
  }

  /**
   * Find related test patterns for a test plan
   */
  private findRelatedTestPatterns(
    plan: TestPlanSpec,
    codebaseAnalysis: CodebaseAnalysisResult
  ): any[] {
    const related: any[] = [];

    if (codebaseAnalysis.testPatterns) {
      for (const pattern of codebaseAnalysis.testPatterns) {
        if (pattern.framework === plan.framework || pattern.framework === plan.testRunner) {
          related.push(pattern);
        }
      }
    }

    return related;
  }

  /**
   * Refine a test plan using patterns
   */
  private async refineTestPlanWithPatterns(
    plan: TestPlanSpec,
    patterns: any[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<TestPlanSpec> {
    if (patterns.length === 0) {
      // No patterns found, try to improve test plan anyway
      logger.debug(`[TestPlanner] No patterns found for test plan ${plan.id}, keeping as-is`);
      return plan;
    }

    // Use the first/best pattern to refine test plan
    const pattern = patterns[0];

    // Get prompt for test planning
    const prompt = await this.config.promptSelector.getPromptForUseCase('test-planning', {
      mode: 'convert',
      framework: codebaseAnalysis.frameworkPlugin?.name,
      featureTypes: codebaseAnalysis.featureTypes as FeatureType[],
    });

    // Build refinement prompt
    const refinementPrompt = this.buildTestPlanRefinementPrompt(plan, pattern, prompt);

    try {
      const response = await this.textGenerator.generate(refinementPrompt, {
        maxTokens: 3000,
        temperature: 0.4,
        systemPrompt: 'You are an expert at refining test plans based on codebase patterns.',
      });

      // Parse refined test cases (pass a ParsedTask-like object)
      const refinedTestCases = this.parseTestCasesResponse(response, {
        id: plan.taskId,
        title: plan.description?.substring(0, 100) || plan.taskId,
        description: plan.description || '',
        status: 'pending',
      } as ParsedTask);

      if (refinedTestCases && refinedTestCases.length > plan.testCases.length) {
        return {
          ...plan,
          testCases: refinedTestCases,
        };
      }
    } catch (error) {
      logger.warn(`[TestPlanner] Failed to refine test plan ${plan.id} using patterns: ${error}`);
    }

    // Return original plan if refinement failed
    return plan;
  }

  /**
   * Build prompt for test plan refinement
   */
  private buildTestPlanRefinementPrompt(
    plan: TestPlanSpec,
    pattern: any,
    basePrompt: string
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');
    parts.push('## Refine Existing Test Plan');
    parts.push(`Test Plan ID: ${plan.id}`);
    parts.push(`Task ID: ${plan.taskId}`);
    parts.push(`Description: ${plan.description}`);
    parts.push(`Current Test Cases: ${plan.testCases.length}`);
    parts.push('');
    parts.push('Current test cases:');
    for (const testCase of plan.testCases) {
      parts.push(`- ${testCase.name}: ${testCase.description}`);
    }
    parts.push('');

    parts.push('## Codebase Test Pattern (Use as Reference)');
    parts.push(`Framework: ${pattern.framework || 'unknown'}`);
    if (pattern.structure) {
      parts.push(`Structure: ${pattern.structure}`);
    }
    if (pattern.examples && pattern.examples.length > 0) {
      parts.push(`Example Files: ${pattern.examples.slice(0, 3).join(', ')}`);
    }
    parts.push('');

    parts.push('## Instructions');
    parts.push('Refine the test plan above to better match the codebase test pattern.');
    parts.push('Add more test cases if needed, improve test case descriptions, and ensure test steps are clear.');
    parts.push('Return the refined test cases in JSON format.');

    return parts.join('\n');
  }

  /**
   * Generate test plan for a single task
   */
  private async generateTestPlanForTask(
    task: ParsedTask,
    phase: ParsedPhase,
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    },
    testContext?: {
      helperMethods?: string[];
      testPatterns?: Array<{ name: string; structure: string; lineNumber: number }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): Promise<TestPlanSpec | null> {
    // Determine test file path first to check if it exists
    const testFile = this.determineTestFilePath(task, phase, prd);
    const fullPath = path.join(this.config.projectRoot, testFile);
    
    // Check if test file already exists and is valid (skip AI call if so)
    if (await fs.pathExists(fullPath)) {
      try {
        const existingContent = await fs.readFile(fullPath, 'utf-8');
        if (this.isValidTestFile(existingContent)) {
          logger.info(`[TestPlanner] Skipping ${task.id} - test file already exists and is valid at ${testFile}`);
          
          // Determine test type based on task
          const testType = this.determineTestType(task, phase, prd.phases.length);
          // Determine test runner based on framework
          const testRunner = this.determineTestRunner();
          // Determine priority
          const priority = this.determinePriority(task, phase);
          
          // Parse existing test file to extract test cases (or create minimal structure)
          const testCases = this.parseTestCasesFromFile(existingContent) || [
            {
              name: `Test ${task.title}`,
              description: `Test plan for ${task.title}`,
              steps: ['Test already exists'],
              expectedResult: 'Test file exists',
            },
          ];
          
          return {
            id: `test-${task.id}`,
            taskId: task.id,
            phaseId: phase.id,
            testType,
            description: `Test plan for ${task.title} (already exists)`,
            testCases,
            framework: this.config.codebaseAnalysis.framework,
            testRunner,
            testFile,
            priority,
            dependencies: task.dependencies || [],
          };
        }
      } catch (error) {
        logger.debug(`[TestPlanner] Failed to read existing test file ${fullPath}: ${error}`);
        // Continue to generate new test plan if reading fails
      }
    }

    // Determine test type based on task
    const testType = this.determineTestType(task, phase, prd.phases.length);

    // Determine test runner based on framework
    const testRunner = this.determineTestRunner();

    // Get appropriate prompt
    const prompt = await this.config.promptSelector.getPromptForUseCase('test-planning', {
      mode: 'convert', // Default to convert mode
      framework: this.config.codebaseAnalysis.framework,
      featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
    });

    // Generate test cases using AI with helper methods and test patterns context
    const testCases = await this.generateTestCases(task, phase, prd, prompt, context, testContext);

    if (!testCases || testCases.length === 0) {
      return null;
    }

    // Determine priority
    const priority = this.determinePriority(task, phase);

    return {
      id: `test-${task.id}`,
      taskId: task.id,
      phaseId: phase.id,
      testType,
      description: `Test plan for ${task.title}`,
      testCases,
      framework: this.config.codebaseAnalysis.framework,
      testRunner,
      testFile,
      priority,
      dependencies: task.dependencies || [],
    };
  }

  /**
   * Generate test cases using AI
   */
  private async generateTestCases(
    task: ParsedTask,
    phase: ParsedPhase,
    prd: ParsedPlanningDoc,
    basePrompt: string,
    context?: {
      conversationId?: string;
      iteration?: number;
    },
    testContext?: {
      helperMethods?: string[];
      testPatterns?: Array<{ name: string; structure: string; lineNumber: number }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): Promise<TestCase[] | null> {
    // Build prompt for test case generation with helper methods and test patterns
    const aiPrompt = this.buildTestCaseGenerationPrompt(task, phase, prd, basePrompt, testContext);

    // Use retry logic for AI call
    return await this.executeWithRetry(
      async () => {
        const response = await this.textGenerator.generate(aiPrompt, {
          maxTokens: 3000,
          temperature: 0.4,
          systemPrompt: 'You are an expert at generating test plans and test cases for software requirements.',
        });

        // Parse AI response to extract test cases
        const testCases = this.parseTestCasesResponse(response, task);

        if (!testCases || testCases.length === 0) {
          throw new Error('Failed to parse test cases response');
        }

        return testCases;
      },
      `generateTestCases(${task.id})`
    );
  }

  /**
   * Build prompt for test case generation
   */
  private buildTestCaseGenerationPrompt(
    task: ParsedTask,
    phase: ParsedPhase,
    prd: ParsedPlanningDoc,
    basePrompt: string,
    testContext?: {
      helperMethods?: string[];
      testPatterns?: Array<{ name: string; structure: string; lineNumber: number }>;
      fileContexts?: Map<string, FileContext>;
    }
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');

    parts.push('## Task to Test');
    parts.push(`Title: ${task.title}`);
    parts.push(`Description: ${task.description}`);
    parts.push(`Phase: ${phase.name} (Phase ${phase.id})`);
    parts.push('');

    if (task.testStrategy) {
      parts.push(`Test Strategy: ${task.testStrategy}`);
      parts.push('');
    }

    if (task.validationChecklist) {
      parts.push('Validation Checklist:');
      for (const item of task.validationChecklist) {
        parts.push(`- ${item}`);
      }
      parts.push('');
    }

    // Determine if we should include verbose context
    // When @codebase tag is used (Cursor provider), prompts can be minimal
    // For API providers (Anthropic, OpenAI, etc.), always include full context
    const isCursorProvider = this.config.aiProvider.name === 'cursor';
    const useCodebaseTag = this.config.useCodebaseTag ?? isCursorProvider; // Default: true only for Cursor

    // Framework context - always useful as a brief hint
    if (this.config.codebaseAnalysis.frameworkPlugin) {
      parts.push('## Framework');
      parts.push(`Framework: ${this.config.codebaseAnalysis.frameworkPlugin.name}`);
      parts.push('');
    }

    if (useCodebaseTag) {
      // Minimal context when @codebase is available
      // Just hint at what to look for, Cursor's index provides the rest
      if (testContext?.helperMethods && testContext.helperMethods.length > 0) {
        parts.push('## Helper Methods');
        parts.push('Use existing helper methods from the test suite. Key helpers:');
        for (const method of testContext.helperMethods.slice(0, 3)) {
          parts.push(`- ${method}`);
        }
        parts.push('');
      }

      if (this.config.codebaseAnalysis.testPatterns && this.config.codebaseAnalysis.testPatterns.length > 0) {
        parts.push('## Test Patterns');
        parts.push('Follow existing test patterns in the codebase. Framework:');
        parts.push(`- ${this.config.codebaseAnalysis.testPatterns[0].framework}`);
        parts.push('');
      }
    } else {
      // Full context when @codebase is not available
      // Helper methods from existing test files
      if (testContext?.helperMethods && testContext.helperMethods.length > 0) {
        parts.push('## Available Helper Methods (Use These in Tests)');
        for (const method of testContext.helperMethods.slice(0, 10)) {
          parts.push(`- ${method}`);
        }
        if (testContext.helperMethods.length > 10) {
          parts.push(`... and ${testContext.helperMethods.length - 10} more`);
        }
        parts.push('');
        parts.push('**IMPORTANT**: Use these existing helper methods in generated test cases. Do not create duplicate helper methods.');
        parts.push('');
      }

      // Test patterns from existing test files
      if (testContext?.testPatterns && testContext.testPatterns.length > 0) {
        parts.push('## Existing Test Patterns (Follow These Structures)');
        for (const pattern of testContext.testPatterns.slice(0, 5)) {
          parts.push(`- ${pattern.name}`);
          parts.push(`  Structure: ${pattern.structure}`);
          parts.push(`  Location: Line ${pattern.lineNumber}`);
        }
        if (testContext.testPatterns.length > 5) {
          parts.push(`... and ${testContext.testPatterns.length - 5} more patterns`);
        }
        parts.push('');
      }

      // Test patterns from codebase analysis
      if (this.config.codebaseAnalysis.testPatterns && this.config.codebaseAnalysis.testPatterns.length > 0) {
        parts.push('## Detected Test Framework Patterns');
        for (const pattern of this.config.codebaseAnalysis.testPatterns.slice(0, 3)) {
          parts.push(`- Framework: ${pattern.framework}`);
          parts.push(`  Structure: ${pattern.structure}`);
          if (pattern.examples && pattern.examples.length > 0) {
            parts.push(`  Example: ${pattern.examples[0]}`);
          }
          parts.push('');
        }
      }

      // File contexts for reference
      if (testContext?.fileContexts && testContext.fileContexts.size > 0) {
        parts.push('## Example Test Files (Reference for Structure)');
        let fileCount = 0;
        for (const [filePath, fileContext] of testContext.fileContexts.entries()) {
          if (fileCount >= 3) break;
          parts.push(`- ${path.basename(filePath)}`);
          if (fileContext.skeleton) {
            parts.push(`  Structure: ${fileContext.skeleton.substring(0, 200)}${fileContext.skeleton.length > 200 ? '...' : ''}`);
          }
          fileCount++;
        }
        parts.push('');
      }
    }

    // Leverage existing TestGenerator templates if available
    if (this.config.testGenerator) {
      parts.push('## Test Framework');
      parts.push(`Test Runner: ${this.determineTestRunner()}`);
      parts.push('Follow framework-specific test patterns and conventions.');
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('Generate comprehensive test cases for the task above.');
    parts.push('Include:');
    parts.push('- Test case name and description');
    parts.push('- Step-by-step test steps (use existing helper methods when available)');
    parts.push('- Expected result');
    parts.push('- Validation checklist items (if applicable)');
    if (testContext?.helperMethods && testContext.helperMethods.length > 0) {
      parts.push('- **CRITICAL**: Reference and use the available helper methods listed above');
      parts.push('- Follow the test patterns and structures from existing test files');
    }
    parts.push('Return test cases in a structured format (JSON or markdown list).');

    return parts.join('\n');
  }

  /**
   * Parse AI response to extract test cases
   */
  private parseTestCasesResponse(response: string, task: ParsedTask): TestCase[] {
    const testCases: TestCase[] = [];

    // Try to parse JSON response
    try {
      const jsonMatch = response.match(/```(?:json)?\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed as TestCase[];
        } else if (parsed.testCases && Array.isArray(parsed.testCases)) {
          return parsed.testCases as TestCase[];
        }
      }
    } catch {
      // JSON parsing failed, try other formats
    }

    // Try to parse markdown list format
    const sections = response.split(/### |## /);
    for (const section of sections) {
      if (section.toLowerCase().includes('test') || section.toLowerCase().includes('case')) {
        const testCase = this.parseTestCaseFromMarkdown(section);
        if (testCase) {
          testCases.push(testCase);
        }
      }
    }

    // If no structured format found, create a basic test case from the response
    if (testCases.length === 0 && response.length > 50) {
      testCases.push({
        name: `Test ${task.title}`,
        description: task.description,
        steps: response.split('\n').filter(line => line.trim().length > 0).slice(0, 10),
        expectedResult: 'Task completes successfully',
        validationChecklist: task.validationChecklist,
      });
    }

    return testCases;
  }

  /**
   * Parse a test case from markdown format
   */
  private parseTestCaseFromMarkdown(markdown: string): TestCase | null {
    const lines = markdown.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      return null;
    }

    const name = lines[0].replace(/^#+\s*/, '').trim();
    let description = '';
    const steps: string[] = [];
    let expectedResult = '';
    const validationChecklist: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes('description:')) {
        description = line.replace(/description:\s*/i, '').trim();
      } else if (line.toLowerCase().includes('steps:') || line.match(/^\d+\./)) {
        // Collect steps
        if (line.match(/^\d+\./)) {
          steps.push(line.replace(/^\d+\.\s*/, '').trim());
        }
      } else if (line.toLowerCase().includes('expected:') || line.toLowerCase().includes('result:')) {
        expectedResult = line.replace(/expected|result:\s*/i, '').trim();
      } else if (line.match(/^[-*]\s/)) {
        // Could be a checklist item or step
        const item = line.replace(/^[-*]\s/, '').trim();
        if (line.toLowerCase().includes('check') || line.toLowerCase().includes('validate')) {
          validationChecklist.push(item);
        } else {
          steps.push(item);
        }
      }
    }

    return {
      name: name || 'Test Case',
      description: description || '',
      steps: steps.length > 0 ? steps : ['Execute task', 'Verify results'],
      expectedResult: expectedResult || 'Task completes successfully',
      validationChecklist: validationChecklist.length > 0 ? validationChecklist : undefined,
    };
  }

  /**
   * Determine test type based on task and phase
   */
  private determineTestType(task: ParsedTask, phase: ParsedPhase, totalPhases: number = 10): TestPlanSpec['testType'] {
    const taskText = `${task.title} ${task.description}`.toLowerCase();

    // Determine based on task description
    if (taskText.includes('e2e') || taskText.includes('end-to-end') || taskText.includes('integration')) {
      return 'integration';
    }
    if (taskText.includes('unit') || taskText.includes('component')) {
      return 'unit';
    }
    if (taskText.includes('acceptance') || taskText.includes('user story')) {
      return 'acceptance';
    }
    if (taskText.includes('smoke') || taskText.includes('basic')) {
      return 'smoke';
    }

    // Default based on phase
    if (phase.id === 1) {
      return 'smoke'; // Early phases: smoke tests
    } else if (phase.id >= totalPhases - 1) {
      return 'e2e'; // Late phases: e2e tests
    } else {
      return 'integration'; // Middle phases: integration tests
    }
  }

  /**
   * Determine test runner based on framework
   */
  private determineTestRunner(): TestPlanSpec['testRunner'] {
    const framework = this.config.codebaseAnalysis.framework;

    if (framework === 'drupal') {
      return 'playwright'; // Drupal typically uses Playwright for E2E
    } else if (framework === 'django') {
      return 'pytest'; // Django uses pytest
    } else if (framework === 'react') {
      return 'jest'; // React uses Jest
    } else {
      return 'playwright'; // Default to Playwright
    }
  }

  /**
   * Determine test file path
   */
  private determineTestFilePath(task: ParsedTask, phase: ParsedPhase, prd: ParsedPlanningDoc): string {
    const framework = this.config.codebaseAnalysis.framework;
    const testRunner = this.determineTestRunner();

    // Use PRD's test directory if specified
    const testDir = prd.testing?.directory || 'tests';

    // Generate test file name from task
    const taskId = task.id.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const fileName = `${taskId}.spec.ts`; // Default to Playwright format

    if (framework === 'drupal') {
      return `${testDir}/playwright/${prd.prdId}-phase${phase.id}-${fileName}`;
    } else if (framework === 'django') {
      return `${testDir}/${taskId}_test.py`;
    } else if (framework === 'react') {
      return `${testDir}/${taskId}.test.tsx`;
    } else {
      return `${testDir}/${fileName}`;
    }
  }

  /**
   * Determine priority
   */
  /**
   * Validate if test file content is valid
   */
  private isValidTestFile(content: string): boolean {
    if (!content || content.trim().length === 0) {
      return false;
    }

    const trimmed = content.trim();
    
    // Check for test-like patterns (test, describe, it, test(), etc.)
    const testPatterns = [
      /test\s*\(/i,
      /describe\s*\(/i,
      /it\s*\(/i,
      /async\s+test\s*\(/i,
      /function\s+test/i,
      /def\s+test_/i,  // Python pytest
      /@test/i,        // JUnit-style
      /test\./i,       // Playwright test object
    ];

    for (const pattern of testPatterns) {
      if (pattern.test(trimmed)) {
        // Additional check: ensure it's not just a comment or minimal structure
        const nonCommentLines = trimmed.split('\n').filter(line => {
          const trimmedLine = line.trim();
          return trimmedLine.length > 0 && !trimmedLine.startsWith('//') && !trimmedLine.startsWith('#');
        });
        return nonCommentLines.length >= 3; // At least 3 non-comment lines
      }
    }

    // If no test pattern found but has substantial content, might be valid
    return trimmed.length > 100;
  }

  /**
   * Parse test cases from existing test file content
   */
  private parseTestCasesFromFile(content: string): TestCase[] | null {
    try {
      // Try to extract test case names using common patterns
      const testCasePatterns = [
        /test\s*\(['"`]([^'"`]+)['"`]/gi,  // test('name')
        /it\s*\(['"`]([^'"`]+)['"`]/gi,    // it('name')
        /describe\s*\(['"`]([^'"`]+)['"`]/gi, // describe('name')
        /def\s+test_(\w+)/gi,              // def test_name
        /@test\s+['"]?(\w+)/gi,            // @test name
      ];

      const testCases: TestCase[] = [];
      
      for (const pattern of testCasePatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          testCases.push({
            name: match[1] || 'Test case',
            description: `Extracted from existing test file`,
            steps: ['Test already implemented'],
            expectedResult: 'Test file exists and is valid',
          });
        }
      }

      return testCases.length > 0 ? testCases : null;
    } catch (error) {
      logger.debug(`[TestPlanner] Failed to parse test cases from file: ${error}`);
      return null;
    }
  }

  private determinePriority(task: ParsedTask, phase: ParsedPhase): TestPlanSpec['priority'] {
    // Early phases are critical
    if (phase.id === 1) {
      return 'critical';
    }

    // Check task description for priority indicators
    const taskText = `${task.title} ${task.description}`.toLowerCase();
    if (taskText.includes('critical') || taskText.includes('blocking')) {
      return 'critical';
    }
    if (taskText.includes('important') || taskText.includes('high')) {
      return 'high';
    }
    if (taskText.includes('low') || taskText.includes('nice to have')) {
      return 'low';
    }

    return 'medium'; // Default
  }

  /**
   * Generate summary
   */
  private generateSummary(
    testPlans: TestPlanSpec[],
    totalTasks: number,
    tasksWithTests: number,
    coveragePercentage: number
  ): string {
    const parts: string[] = [];

    parts.push(`Generated ${testPlans.length} test plan(s) covering ${coveragePercentage}% of tasks.`);

    // Group by test type
    const byType = new Map<TestPlanSpec['testType'], number>();
    for (const plan of testPlans) {
      byType.set(plan.testType, (byType.get(plan.testType) || 0) + 1);
    }

    parts.push('\nTest plans by type:');
    for (const [type, count] of byType.entries()) {
      parts.push(`- ${count} ${type} test plan(s)`);
    }

    // Group by priority
    const byPriority = new Map<TestPlanSpec['priority'], number>();
    for (const plan of testPlans) {
      byPriority.set(plan.priority, (byPriority.get(plan.priority) || 0) + 1);
    }

    parts.push('\nTest plans by priority:');
    for (const [priority, count] of byPriority.entries()) {
      parts.push(`- ${count} ${priority} priority test plan(s)`);
    }

    return parts.join('\n');
  }
}
