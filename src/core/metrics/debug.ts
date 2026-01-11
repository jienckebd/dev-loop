import * as fs from 'fs-extra';
import * as path from 'path';

export interface RunMetrics {
  timestamp: string;
  taskId?: number;
  taskTitle?: string;
  status: 'completed' | 'failed' | 'pending';
  timing: {
    aiCallMs?: number;
    testRunMs?: number;
    logAnalysisMs?: number;
    totalMs?: number;
  };
  tokens: {
    input?: number;
    output?: number;
  };
  context: {
    sizeChars?: number;
    filesIncluded?: number;
    filesTruncated?: number;
  };
  patches: {
    attempted?: number;
    succeeded?: number;
    failed?: number;
  };
  validation: {
    preValidationPassed?: boolean;
    syntaxErrorsFound?: number;
  };
  patterns: {
    matched?: number;
    applied?: number;
  };
  // Enhanced metrics for contribution mode
  projectMetadata?: {
    projectType?: string; // e.g., "drupal", "react", "node"
    framework?: string; // from config
    projectPath?: string; // normalized path
  };
  outcome?: {
    failureType?: 'validation' | 'test' | 'log' | 'timeout' | 'success';
    errorCategory?: string; // e.g., "patch-not-found", "syntax-error", "test-failure"
    retryCount?: number;
  };
  efficiency?: {
    tokensPerSuccess?: number; // tokens used per successful task
    iterationsToSuccess?: number; // how many attempts before success
  };
  // Contribution mode metrics for file creation tracking
  contribution?: {
    fileCreation?: {
      filesRequested: string[];      // Files explicitly required by task
      filesCreated: string[];        // Files AI actually created
      missingFiles: string[];        // Files that should have been created but weren't
      wrongLocationFiles: string[];  // Files created in wrong location
    };
    investigationTasks?: {
      requested: boolean;            // Whether investigation was requested
      skipped: boolean;              // Whether it was skipped due to config
      created: number;               // Number of investigation tasks created
    };
    blockingReason?: string;         // Why task was blocked (if blocked)
    aiSummary?: string;              // What AI said it did
  };
}

export interface MetricsData {
  version: string;
  runs: RunMetrics[];
  summary: {
    totalRuns: number;
    successRate: number;
    avgAiCallMs: number;
    avgTestRunMs: number;
    totalTokensInput: number;
    totalTokensOutput: number;
  };
}

export class DebugMetrics {
  private metricsPath: string;
  private metrics: MetricsData;
  private currentRun: Partial<RunMetrics> = {};

  constructor(metricsPath: string = '.devloop/metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.metrics = this.loadMetrics();
  }

  private loadMetrics(): MetricsData {
    const defaultMetrics: MetricsData = {
      version: '1.0',
      runs: [],
      summary: {
        totalRuns: 0,
        successRate: 0,
        avgAiCallMs: 0,
        avgTestRunMs: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
      },
    };

    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        const parsed = JSON.parse(content);
        // Ensure the loaded data has all required properties
        return {
          version: parsed.version || defaultMetrics.version,
          runs: Array.isArray(parsed.runs) ? parsed.runs : [],
          summary: {
            ...defaultMetrics.summary,
            ...parsed.summary,
          },
        };
      }
    } catch (error) {
      console.warn(`[DebugMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }

    return defaultMetrics;
  }

  private saveMetrics(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[DebugMetrics] Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  startRun(taskId?: number, taskTitle?: string): void {
    this.currentRun = {
      timestamp: new Date().toISOString(),
      taskId,
      taskTitle,
      status: 'pending',
      timing: {},
      tokens: {},
      context: {},
      patches: {},
      validation: {},
      patterns: {},
      projectMetadata: {},
      outcome: {},
      efficiency: {},
    };
  }

  setTaskInfo(taskId: number, taskTitle: string): void {
    this.currentRun.taskId = taskId;
    this.currentRun.taskTitle = taskTitle;
  }

  recordTiming(phase: 'aiCall' | 'testRun' | 'logAnalysis' | 'total', ms: number): void {
    if (!this.currentRun.timing) {
      this.currentRun.timing = {};
    }
    const key = `${phase}Ms` as keyof RunMetrics['timing'];
    this.currentRun.timing[key] = ms;
  }

  recordTokens(input: number, output: number): void {
    this.currentRun.tokens = { input, output };
  }

  recordContext(sizeChars: number, filesIncluded: number, filesTruncated: number = 0): void {
    this.currentRun.context = { sizeChars, filesIncluded, filesTruncated };
  }

  recordPatches(attempted: number, succeeded: number, failed: number): void {
    this.currentRun.patches = { attempted, succeeded, failed };
  }

  recordValidation(preValidationPassed: boolean, syntaxErrorsFound: number = 0): void {
    this.currentRun.validation = { preValidationPassed, syntaxErrorsFound };
  }

  recordPatterns(matched: number, applied: number): void {
    this.currentRun.patterns = { matched, applied };
  }

  recordProjectMetadata(projectType?: string, framework?: string, projectPath?: string): void {
    if (!this.currentRun.projectMetadata) {
      this.currentRun.projectMetadata = {};
    }
    if (projectType) this.currentRun.projectMetadata.projectType = projectType;
    if (framework) this.currentRun.projectMetadata.framework = framework;
    if (projectPath) this.currentRun.projectMetadata.projectPath = projectPath;
  }

  recordOutcome(failureType?: 'validation' | 'test' | 'log' | 'timeout' | 'success', errorCategory?: string, retryCount?: number): void {
    if (!this.currentRun.outcome) {
      this.currentRun.outcome = {};
    }
    if (failureType) this.currentRun.outcome.failureType = failureType;
    if (errorCategory) this.currentRun.outcome.errorCategory = errorCategory;
    if (retryCount !== undefined) this.currentRun.outcome.retryCount = retryCount;
  }

  recordEfficiency(tokensPerSuccess?: number, iterationsToSuccess?: number): void {
    if (!this.currentRun.efficiency) {
      this.currentRun.efficiency = {};
    }
    if (tokensPerSuccess !== undefined) this.currentRun.efficiency.tokensPerSuccess = tokensPerSuccess;
    if (iterationsToSuccess !== undefined) this.currentRun.efficiency.iterationsToSuccess = iterationsToSuccess;
  }

  /**
   * Record file creation attempt for contribution mode analysis
   */
  recordFileCreation(
    filesRequested: string[],
    filesCreated: string[],
    missingFiles: string[],
    wrongLocationFiles: string[] = []
  ): void {
    if (!this.currentRun.contribution) {
      this.currentRun.contribution = {};
    }
    this.currentRun.contribution.fileCreation = {
      filesRequested,
      filesCreated,
      missingFiles,
      wrongLocationFiles,
    };
  }

  /**
   * Record investigation task handling for contribution mode analysis
   */
  recordInvestigationHandling(requested: boolean, skipped: boolean, created: number): void {
    if (!this.currentRun.contribution) {
      this.currentRun.contribution = {};
    }
    this.currentRun.contribution.investigationTasks = {
      requested,
      skipped,
      created,
    };
  }

  /**
   * Record blocking reason for contribution mode analysis
   */
  recordBlockingReason(reason: string): void {
    if (!this.currentRun.contribution) {
      this.currentRun.contribution = {};
    }
    this.currentRun.contribution.blockingReason = reason;
  }

  /**
   * Record AI summary for contribution mode analysis
   */
  recordAiSummary(summary: string): void {
    if (!this.currentRun.contribution) {
      this.currentRun.contribution = {};
    }
    this.currentRun.contribution.aiSummary = summary?.substring(0, 500); // Truncate to prevent bloat
  }

  /**
   * Get contribution mode analytics for diagnosis
   */
  getContributionAnalytics(): {
    totalFileCreationAttempts: number;
    successfulFileCreations: number;
    fileCreationSuccessRate: number;
    commonMissingPatterns: string[];
    investigationTasksCreated: number;
    investigationTasksSkipped: number;
    commonBlockingReasons: Record<string, number>;
  } {
    const runs = this.metrics.runs.filter(r => r.contribution);

    let totalAttempts = 0;
    let successfulCreations = 0;
    const missingPatterns: string[] = [];
    let invCreated = 0;
    let invSkipped = 0;
    const blockingReasons: Record<string, number> = {};

    for (const run of runs) {
      if (run.contribution?.fileCreation) {
        totalAttempts++;
        const fc = run.contribution.fileCreation;
        if (fc.missingFiles.length === 0 && fc.wrongLocationFiles.length === 0) {
          successfulCreations++;
        }
        missingPatterns.push(...fc.missingFiles);
      }
      if (run.contribution?.investigationTasks) {
        if (run.contribution.investigationTasks.skipped) {
          invSkipped++;
        }
        invCreated += run.contribution.investigationTasks.created;
      }
      if (run.contribution?.blockingReason) {
        const reason = run.contribution.blockingReason;
        blockingReasons[reason] = (blockingReasons[reason] || 0) + 1;
      }
    }

    // Get top 5 most common missing file patterns
    const patternCounts: Record<string, number> = {};
    for (const pattern of missingPatterns) {
      // Extract pattern from filename (e.g., "node.type.*.yml" from "node.type.test_content.yml")
      const match = pattern.match(/^(.+?)\..+\.([^.]+)$/);
      const normalized = match ? `${match[1]}.*.${match[2]}` : pattern;
      patternCounts[normalized] = (patternCounts[normalized] || 0) + 1;
    }
    const commonMissingPatterns = Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern]) => pattern);

    return {
      totalFileCreationAttempts: totalAttempts,
      successfulFileCreations: successfulCreations,
      fileCreationSuccessRate: totalAttempts > 0 ? successfulCreations / totalAttempts : 0,
      commonMissingPatterns,
      investigationTasksCreated: invCreated,
      investigationTasksSkipped: invSkipped,
      commonBlockingReasons: blockingReasons,
    };
  }

  completeRun(status: 'completed' | 'failed'): void {
    if (!this.currentRun.timestamp) {
      return; // No run in progress
    }

    this.currentRun.status = status;
    const run = this.currentRun as RunMetrics;

    // Defensive check - ensure runs array exists
    if (!this.metrics.runs) {
      this.metrics.runs = [];
    }
    this.metrics.runs.push(run);

    // Update summary
    this.updateSummary();

    this.saveMetrics();
    this.currentRun = {};
  }

  private updateSummary(): void {
    // Defensive check - ensure runs array exists
    if (!this.metrics.runs) {
      this.metrics.runs = [];
    }
    const runs = this.metrics.runs;
    const completed = runs.filter(r => r.status === 'completed').length;

    this.metrics.summary = {
      totalRuns: runs.length,
      successRate: runs.length > 0 ? completed / runs.length : 0,
      avgAiCallMs: this.average(runs.map(r => r.timing?.aiCallMs).filter((v): v is number => v !== undefined)),
      avgTestRunMs: this.average(runs.map(r => r.timing?.testRunMs).filter((v): v is number => v !== undefined)),
      totalTokensInput: runs.reduce((sum, r) => sum + (r.tokens?.input || 0), 0),
      totalTokensOutput: runs.reduce((sum, r) => sum + (r.tokens?.output || 0), 0),
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  getMetrics(): MetricsData {
    return this.metrics;
  }

  getLastNRuns(n: number): RunMetrics[] {
    return this.metrics.runs.slice(-n).reverse();
  }

  getRunsForTask(taskId: number): RunMetrics[] {
    return this.metrics.runs.filter(r => r.taskId === taskId);
  }

  clear(): void {
    this.metrics = {
      version: '1.0',
      runs: [],
      summary: {
        totalRuns: 0,
        successRate: 0,
        avgAiCallMs: 0,
        avgTestRunMs: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
      },
    };
    this.saveMetrics();
  }
}
