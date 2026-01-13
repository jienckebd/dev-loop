/**
 * Build Metrics
 *
 * Tracks metrics for PRD set building (build-prd-set command).
 * Captures timing, AI usage, validation, and quality metrics.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { getEventStream } from '../utils/event-stream';

/**
 * Build metrics data structure
 */
export interface BuildMetricsData {
  buildId: string;
  mode: 'convert' | 'enhance' | 'create';
  sourceFile?: string;
  prdSetId: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  status: 'in-progress' | 'completed' | 'failed';

  timing: {
    codebaseAnalysisMs: number;
    schemaEnhancementMs: number;
    testPlanningMs: number;
    featureEnhancementMs: number;
    validationMs: number;
    fileGenerationMs: number;
  };

  aiCalls: {
    total: number;
    successful: number;
    failed: number;
    retried: number;
    avgDurationMs: number;
    byComponent: Record<string, number>;
  };

  tokens: {
    totalInput: number;
    totalOutput: number;
    estimatedCost?: number;
    byComponent: Record<string, { input: number; output: number }>;
  };

  validation: {
    iterations: number;
    autoFixesApplied: string[];
    initialScore: number;
    finalScore: number;
    errorsFixed: number;
    warningsFixed: number;
  };

  output: {
    directory: string;
    filesGenerated: number;
    phasesCount: number;
    tasksCount: number;
    indexSizeBytes: number;
  };

  quality: {
    executabilityScore: number;
    schemaCompleteness: number;
    testCoverage: number;
    taskSpecificity: number;
  };

  warnings?: {
    total: number;
    byType: Record<string, number>;
    samples: string[]; // First 10 warning messages
  };

  batching?: {
    batchesAttempted: number;
    batchesSucceeded: number;
    totalTasks: number;
    fallbacks: number;
  };
}

/**
 * Build pattern for contribution mode learning
 */
export interface BuildPattern {
  type: 'validation_error' | 'schema_enhancement' | 'ai_failure' | 'quality_issue';
  pattern: string;
  resolution?: string;
  frequency: number;
  lastSeen: string;
  successRate?: number;
}

/**
 * Create default timing structure
 */
function createDefaultTiming(): BuildMetricsData['timing'] {
  return {
    codebaseAnalysisMs: 0,
    schemaEnhancementMs: 0,
    testPlanningMs: 0,
    featureEnhancementMs: 0,
    validationMs: 0,
    fileGenerationMs: 0,
  };
}

/**
 * Create default AI calls structure
 */
function createDefaultAICalls(): BuildMetricsData['aiCalls'] {
  return {
    total: 0,
    successful: 0,
    failed: 0,
    retried: 0,
    avgDurationMs: 0,
    byComponent: {},
  };
}

/**
 * Create default tokens structure
 */
function createDefaultTokens(): BuildMetricsData['tokens'] {
  return {
    totalInput: 0,
    totalOutput: 0,
    estimatedCost: 0,
    byComponent: {},
  };
}

/**
 * Create default validation structure
 */
function createDefaultValidation(): BuildMetricsData['validation'] {
  return {
    iterations: 0,
    autoFixesApplied: [],
    initialScore: 0,
    finalScore: 0,
    errorsFixed: 0,
    warningsFixed: 0,
  };
}

/**
 * Create default output structure
 */
function createDefaultOutput(): BuildMetricsData['output'] {
  return {
    directory: '',
    filesGenerated: 0,
    phasesCount: 0,
    tasksCount: 0,
    indexSizeBytes: 0,
  };
}

/**
 * Create default quality structure
 */
function createDefaultQuality(): BuildMetricsData['quality'] {
  return {
    executabilityScore: 0,
    schemaCompleteness: 0,
    testCoverage: 0,
    taskSpecificity: 0,
  };
}

/**
 * BuildMetrics class for tracking build-prd-set metrics
 */
export class BuildMetrics {
  private metricsPath: string;
  private patternsPath: string;
  private metrics: Map<string, BuildMetricsData> = new Map();
  private patterns: BuildPattern[] = [];
  private currentBuild?: BuildMetricsData;
  private aiCallDurations: number[] = [];

  constructor(metricsPath: string = '.devloop/build-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.patternsPath = path.resolve(process.cwd(), '.devloop/build-patterns.json');
    this.loadMetrics();
    this.loadPatterns();
  }

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          data.forEach((metric: BuildMetricsData) => {
            this.metrics.set(metric.buildId, this.normalizeMetric(metric));
          });
        } else if (typeof data === 'object' && data.builds) {
          data.builds.forEach((metric: BuildMetricsData) => {
            this.metrics.set(metric.buildId, this.normalizeMetric(metric));
          });
        }
      }
    } catch (error) {
      logger.warn(`[BuildMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private loadPatterns(): void {
    try {
      if (fs.existsSync(this.patternsPath)) {
        const content = fs.readFileSync(this.patternsPath, 'utf-8');
        const data = JSON.parse(content);
        this.patterns = data.patterns || [];
      }
    } catch (error) {
      logger.warn(`[BuildMetrics] Failed to load patterns: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private normalizeMetric(metric: Partial<BuildMetricsData>): BuildMetricsData {
    return {
      buildId: metric.buildId || `build-${Date.now()}`,
      mode: metric.mode || 'convert',
      sourceFile: metric.sourceFile,
      prdSetId: metric.prdSetId || 'unknown',
      startTime: metric.startTime || new Date().toISOString(),
      endTime: metric.endTime,
      duration: metric.duration,
      status: metric.status || 'in-progress',
      timing: { ...createDefaultTiming(), ...metric.timing },
      aiCalls: { ...createDefaultAICalls(), ...metric.aiCalls },
      tokens: { ...createDefaultTokens(), ...metric.tokens },
      validation: { ...createDefaultValidation(), ...metric.validation },
      output: { ...createDefaultOutput(), ...metric.output },
      quality: { ...createDefaultQuality(), ...metric.quality },
    };
  }

  private saveMetrics(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        builds: Array.from(this.metrics.values()),
      };

      fs.writeFileSync(this.metricsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.warn(`[BuildMetrics] Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private savePatterns(): void {
    try {
      const dir = path.dirname(this.patternsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        patterns: this.patterns,
      };

      fs.writeFileSync(this.patternsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.warn(`[BuildMetrics] Failed to save patterns: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start tracking a new build
   */
  startBuild(mode: 'convert' | 'enhance' | 'create', prdSetId: string, sourceFile?: string): string {
    const buildId = `build-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.currentBuild = {
      buildId,
      mode,
      sourceFile,
      prdSetId,
      startTime: new Date().toISOString(),
      status: 'in-progress',
      timing: createDefaultTiming(),
      aiCalls: createDefaultAICalls(),
      tokens: createDefaultTokens(),
      validation: createDefaultValidation(),
      output: createDefaultOutput(),
      quality: createDefaultQuality(),
    };

    this.aiCallDurations = [];
    this.metrics.set(buildId, this.currentBuild);
    this.saveMetrics();

    // Emit build started event
    getEventStream().emit(
      'build:started',
      { buildId, mode, prdSetId, sourceFile },
      { severity: 'info', buildId }
    );

    logger.debug(`[BuildMetrics] Started build: ${buildId}`);
    return buildId;
  }

  /**
   * Record timing for a build phase
   */
  recordTiming(phase: keyof BuildMetricsData['timing'], ms: number): void {
    if (!this.currentBuild) {
      logger.warn('[BuildMetrics] No active build to record timing');
      return;
    }

    this.currentBuild.timing[phase] = ms;
    
    // Emit phase completed event
    getEventStream().emit(
      'build:phase_completed',
      { phase, durationMs: ms },
      { severity: 'info', buildId: this.currentBuild.buildId }
    );
    
    logger.debug(`[BuildMetrics] Recorded timing: ${phase}=${ms}ms`);
  }

  /**
   * Start a build phase (for timing)
   */
  startPhase(phase: keyof BuildMetricsData['timing']): void {
    if (!this.currentBuild) {
      return;
    }

    getEventStream().emit(
      'build:phase_started',
      { phase },
      { severity: 'info', buildId: this.currentBuild.buildId }
    );
  }

  /**
   * Get the current build ID
   */
  getCurrentBuildId(): string | undefined {
    return this.currentBuild?.buildId;
  }

  /**
   * Record an AI call
   */
  recordAICall(
    component: string,
    success: boolean,
    durationMs?: number,
    tokens?: { input: number; output: number },
    retried?: boolean
  ): void {
    if (!this.currentBuild) {
      logger.warn('[BuildMetrics] No active build to record AI call');
      return;
    }

    this.currentBuild.aiCalls.total++;

    if (success) {
      this.currentBuild.aiCalls.successful++;
    } else {
      this.currentBuild.aiCalls.failed++;
    }

    if (retried) {
      this.currentBuild.aiCalls.retried++;
    }

    // Track by component
    if (!this.currentBuild.aiCalls.byComponent[component]) {
      this.currentBuild.aiCalls.byComponent[component] = 0;
    }
    this.currentBuild.aiCalls.byComponent[component]++;

    // Track duration for average
    if (durationMs) {
      this.aiCallDurations.push(durationMs);
      this.currentBuild.aiCalls.avgDurationMs =
        this.aiCallDurations.reduce((a, b) => a + b, 0) / this.aiCallDurations.length;
    }

    // Track tokens
    if (tokens) {
      this.currentBuild.tokens.totalInput += tokens.input;
      this.currentBuild.tokens.totalOutput += tokens.output;

      // Estimate cost (rough estimate: $0.01 per 1K tokens)
      this.currentBuild.tokens.estimatedCost =
        ((this.currentBuild.tokens.totalInput + this.currentBuild.tokens.totalOutput) / 1000) * 0.01;

      // Track by component
      if (!this.currentBuild.tokens.byComponent[component]) {
        this.currentBuild.tokens.byComponent[component] = { input: 0, output: 0 };
      }
      this.currentBuild.tokens.byComponent[component].input += tokens.input;
      this.currentBuild.tokens.byComponent[component].output += tokens.output;
    }

    // Emit AI call event
    const eventType = success ? 'build:ai_call_completed' : 'build:ai_call_failed';
    getEventStream().emit(
      eventType,
      { component, success, durationMs, tokens, retried, totalCalls: this.currentBuild.aiCalls.total },
      { severity: success ? 'info' : 'warn', buildId: this.currentBuild.buildId }
    );
  }

  /**
   * Record validation iteration
   */
  recordValidation(iteration: number, score: number, fixes: string[], errors?: number, warnings?: number): void {
    if (!this.currentBuild) {
      logger.warn('[BuildMetrics] No active build to record validation');
      return;
    }

    this.currentBuild.validation.iterations = iteration;

    if (iteration === 1) {
      this.currentBuild.validation.initialScore = score;
    }

    this.currentBuild.validation.finalScore = score;

    // Add new fixes (avoid duplicates)
    for (const fix of fixes) {
      if (!this.currentBuild.validation.autoFixesApplied.includes(fix)) {
        this.currentBuild.validation.autoFixesApplied.push(fix);
        
        // Emit auto-fix event
        getEventStream().emit(
          'build:auto_fix_applied',
          { fix, iteration, score },
          { severity: 'info', buildId: this.currentBuild.buildId }
        );
      }
    }

    // Track errors/warnings fixed
    if (errors !== undefined) {
      this.currentBuild.validation.errorsFixed = errors;
    }
    if (warnings !== undefined) {
      this.currentBuild.validation.warningsFixed = warnings;
    }

    // Record validation patterns for contribution mode
    for (const fix of fixes) {
      this.recordPattern('validation_error', fix, fix);
    }

    // Emit validation event
    getEventStream().emit(
      'build:validation_completed',
      { iteration, score, fixesApplied: fixes.length, errors, warnings },
      { severity: 'info', buildId: this.currentBuild.buildId }
    );
  }

  /**
   * Record a warning during build
   */
  recordWarning(type: string, message: string): void {
    if (!this.currentBuild) return;
    if (!this.currentBuild.warnings) {
      this.currentBuild.warnings = { total: 0, byType: {}, samples: [] };
    }
    this.currentBuild.warnings.total++;
    this.currentBuild.warnings.byType[type] = (this.currentBuild.warnings.byType[type] || 0) + 1;
    if (this.currentBuild.warnings.samples.length < 10) {
      this.currentBuild.warnings.samples.push(`[${type}] ${message}`);
    }
  }

  /**
   * Record a batch processing result
   */
  recordBatchResult(success: boolean, taskCount: number, fallback: boolean): void {
    if (!this.currentBuild) return;
    if (!this.currentBuild.batching) {
      this.currentBuild.batching = {
        batchesAttempted: 0,
        batchesSucceeded: 0,
        totalTasks: 0,
        fallbacks: 0,
      };
    }
    this.currentBuild.batching.batchesAttempted++;
    if (success) this.currentBuild.batching.batchesSucceeded++;
    this.currentBuild.batching.totalTasks += taskCount;
    if (fallback) this.currentBuild.batching.fallbacks++;
  }

  /**
   * Record a build pattern for contribution mode learning
   */
  recordPattern(type: BuildPattern['type'], pattern: string, resolution?: string): void {
    const existingIndex = this.patterns.findIndex(
      p => p.type === type && p.pattern === pattern
    );

    if (existingIndex >= 0) {
      // Update existing pattern
      this.patterns[existingIndex].frequency++;
      this.patterns[existingIndex].lastSeen = new Date().toISOString();
      if (resolution) {
        this.patterns[existingIndex].resolution = resolution;
      }
    } else {
      // Add new pattern
      this.patterns.push({
        type,
        pattern,
        resolution,
        frequency: 1,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  /**
   * Finish the current build
   */
  finishBuild(
    status: 'completed' | 'failed',
    output: Partial<BuildMetricsData['output']>,
    quality: Partial<BuildMetricsData['quality']>
  ): BuildMetricsData | undefined {
    if (!this.currentBuild) {
      logger.warn('[BuildMetrics] No active build to finish');
      return undefined;
    }

    this.currentBuild.endTime = new Date().toISOString();
    this.currentBuild.status = status;
    this.currentBuild.duration =
      new Date(this.currentBuild.endTime).getTime() -
      new Date(this.currentBuild.startTime).getTime();

    // Update output metrics
    this.currentBuild.output = {
      ...this.currentBuild.output,
      ...output,
    };

    // Update quality metrics
    this.currentBuild.quality = {
      ...this.currentBuild.quality,
      ...quality,
    };

    // Save metrics and patterns
    this.saveMetrics();
    this.savePatterns();

    // Emit build completed/failed event
    const eventType = status === 'completed' ? 'build:completed' : 'build:failed';
    getEventStream().emit(
      eventType,
      {
        buildId: this.currentBuild.buildId,
        mode: this.currentBuild.mode,
        prdSetId: this.currentBuild.prdSetId,
        duration: this.currentBuild.duration,
        executabilityScore: this.currentBuild.quality.executabilityScore,
        aiCalls: this.currentBuild.aiCalls.total,
        tokensUsed: this.currentBuild.tokens.totalInput + this.currentBuild.tokens.totalOutput,
        filesGenerated: this.currentBuild.output.filesGenerated,
      },
      { severity: status === 'completed' ? 'info' : 'error', buildId: this.currentBuild.buildId }
    );

    logger.info(
      `[BuildMetrics] Build completed: ${this.currentBuild.buildId}, ` +
      `duration=${this.currentBuild.duration}ms, ` +
      `score=${this.currentBuild.quality.executabilityScore}`
    );

    const result = this.currentBuild;
    this.currentBuild = undefined;
    return result;
  }

  /**
   * Get metrics for a specific build
   */
  getBuildMetrics(buildId: string): BuildMetricsData | undefined {
    return this.metrics.get(buildId);
  }

  /**
   * Get the current build metrics (in progress)
   */
  getCurrentBuild(): BuildMetricsData | undefined {
    return this.currentBuild;
  }

  /**
   * Get all build metrics
   */
  getAllBuildMetrics(): BuildMetricsData[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get recent builds (last N)
   */
  getRecentBuilds(count: number = 10): BuildMetricsData[] {
    return Array.from(this.metrics.values())
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, count);
  }

  /**
   * Get all patterns
   */
  getPatterns(): BuildPattern[] {
    return this.patterns;
  }

  /**
   * Get recommendations based on patterns
   */
  getRecommendations(): string[] {
    const recommendations: string[] = [];

    // Analyze patterns for recommendations
    const frequentPatterns = this.patterns
      .filter(p => p.frequency >= 3)
      .sort((a, b) => b.frequency - a.frequency);

    for (const pattern of frequentPatterns.slice(0, 5)) {
      if (pattern.type === 'validation_error') {
        recommendations.push(
          `Frequent validation fix "${pattern.pattern}" (${pattern.frequency}x) - consider pre-applying`
        );
      } else if (pattern.type === 'ai_failure') {
        recommendations.push(
          `AI failures for "${pattern.pattern}" (${pattern.frequency}x) - review prompt or context`
        );
      } else if (pattern.type === 'quality_issue') {
        recommendations.push(
          `Quality issue "${pattern.pattern}" (${pattern.frequency}x) - enhance validation rules`
        );
      }
    }

    return recommendations;
  }

  /**
   * Get build statistics
   */
  getStatistics(): {
    totalBuilds: number;
    successRate: number;
    avgDuration: number;
    avgExecutabilityScore: number;
    byMode: Record<string, number>;
  } {
    const builds = Array.from(this.metrics.values());
    const completedBuilds = builds.filter(b => b.status === 'completed');

    const totalBuilds = builds.length;
    const successRate = totalBuilds > 0 ? completedBuilds.length / totalBuilds : 0;

    const avgDuration =
      completedBuilds.length > 0
        ? completedBuilds.reduce((sum, b) => sum + (b.duration || 0), 0) / completedBuilds.length
        : 0;

    const avgExecutabilityScore =
      completedBuilds.length > 0
        ? completedBuilds.reduce((sum, b) => sum + b.quality.executabilityScore, 0) /
          completedBuilds.length
        : 0;

    const byMode: Record<string, number> = {};
    for (const build of builds) {
      byMode[build.mode] = (byMode[build.mode] || 0) + 1;
    }

    return {
      totalBuilds,
      successRate,
      avgDuration,
      avgExecutabilityScore,
      byMode,
    };
  }
}

// Singleton instance for global access
let globalBuildMetrics: BuildMetrics | null = null;

/**
 * Get the global BuildMetrics instance
 */
export function getBuildMetrics(): BuildMetrics {
  if (!globalBuildMetrics) {
    globalBuildMetrics = new BuildMetrics();
  }
  return globalBuildMetrics;
}

/**
 * Set a custom BuildMetrics instance (for testing or specific configuration)
 */
export function setBuildMetrics(metrics: BuildMetrics): void {
  globalBuildMetrics = metrics;
}
