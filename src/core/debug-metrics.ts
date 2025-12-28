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
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`[DebugMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
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

  completeRun(status: 'completed' | 'failed'): void {
    if (!this.currentRun.timestamp) {
      return; // No run in progress
    }

    this.currentRun.status = status;
    const run = this.currentRun as RunMetrics;
    this.metrics.runs.push(run);

    // Update summary
    this.updateSummary();

    this.saveMetrics();
    this.currentRun = {};
  }

  private updateSummary(): void {
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
