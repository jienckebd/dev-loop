/**
 * Execution Intelligence Collector
 *
 * Collects and persists execution metrics for learning purposes.
 * Tracks task execution patterns, PRD generation insights, and config effectiveness.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Task execution result for tracking
 */
export interface TaskExecutionResult {
  taskId: string;
  taskType: string;
  taskPattern: string; // e.g., "create-entity", "add-field", "fix-bug"
  success: boolean;
  iterations: number;
  errorMessages?: string[];
  approach?: string; // What approach was used
  durationMs: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

/**
 * PRD generation result for tracking
 */
export interface PRDGenerationResult {
  prdId: string;
  phaseCount: number;
  taskCount: number;
  refinementIterations: number;
  executabilityScore?: number; // 0-1
  concepts: string[];
  durationMs: number;
}

/**
 * Provider performance result for tracking
 */
export interface ProviderPerformanceResult {
  provider: string;
  model?: string;
  taskType: string;
  responseTimeMs: number;
  success: boolean;
  tokenUsage?: {
    input: number;
    output: number;
  };
  quality?: number; // 0-1, subjective or derived from test results
}

/**
 * Aggregated execution intelligence
 */
export interface ExecutionIntelligence {
  taskExecution?: {
    successfulTaskPatterns?: Array<{
      taskType: string;
      taskPattern: string;
      successRate: number;
      averageIterations: number;
      commonApproaches?: string[];
    }>;
    problematicTaskPatterns?: Array<{
      taskType: string;
      taskPattern: string;
      failureRate: number;
      commonErrors?: string[];
      suggestedWorkarounds?: string[];
    }>;
  };
  prdGeneration?: {
    typicalPhaseCount?: number;
    averageTasksPerPhase?: number;
    commonConcepts?: string[];
    refinementIterations?: number;
    executabilityAchievement?: number;
  };
  configEffectiveness?: {
    providerPerformance?: Record<string, {
      avgResponseTime: number;
      successRate: number;
      preferredForTaskTypes?: string[];
    }>;
    modelPerformance?: Record<string, {
      avgQuality: number;
      avgTokens: number;
      bestForConcepts?: string[];
    }>;
  };
}

/**
 * Raw execution data stored on disk
 */
interface ExecutionDataStore {
  taskResults: TaskExecutionResult[];
  prdResults: PRDGenerationResult[];
  providerResults: ProviderPerformanceResult[];
  lastUpdated: string;
  version: string;
}

/**
 * Configuration for the collector
 */
export interface ExecutionIntelligenceCollectorConfig {
  projectRoot: string;
  dataPath?: string; // Defaults to .devloop/execution-intelligence.json
  maxResults?: number; // Max results to keep per category
  debug?: boolean;
}

/**
 * Collects and analyzes execution intelligence for learning
 */
export class ExecutionIntelligenceCollector {
  private projectRoot: string;
  private dataPath: string;
  private maxResults: number;
  private debug: boolean;
  private data: ExecutionDataStore | null = null;

  constructor(config: ExecutionIntelligenceCollectorConfig) {
    this.projectRoot = config.projectRoot;
    this.dataPath = config.dataPath || path.join(config.projectRoot, '.devloop', 'execution-intelligence.json');
    this.maxResults = config.maxResults || 1000;
    this.debug = config.debug || false;
  }

  /**
   * Load execution data from disk
   */
  async load(): Promise<ExecutionDataStore> {
    if (this.data) {
      return this.data;
    }

    try {
      if (await fs.pathExists(this.dataPath)) {
        this.data = await fs.readJson(this.dataPath);

        if (this.debug) {
          logger.debug(`[ExecutionIntelligenceCollector] Loaded ${this.data?.taskResults.length || 0} task results`);
        }

        return this.data!;
      }
    } catch (error) {
      logger.warn(`[ExecutionIntelligenceCollector] Failed to load execution data: ${error}`);
    }

    // Initialize empty data store
    this.data = {
      taskResults: [],
      prdResults: [],
      providerResults: [],
      lastUpdated: new Date().toISOString(),
      version: '1.0.0',
    };

    return this.data;
  }

  /**
   * Save execution data to disk
   */
  async save(): Promise<void> {
    if (!this.data) {
      return;
    }

    try {
      // Prune old data if over limit
      this.pruneData();

      // Update timestamp
      this.data.lastUpdated = new Date().toISOString();

      // Ensure directory exists
      await fs.ensureDir(path.dirname(this.dataPath));

      // Write data to disk
      await fs.writeJson(this.dataPath, this.data, { spaces: 2 });

      if (this.debug) {
        logger.debug(`[ExecutionIntelligenceCollector] Saved execution data to ${this.dataPath}`);
      }
    } catch (error) {
      logger.error(`[ExecutionIntelligenceCollector] Failed to save execution data: ${error}`);
      throw error;
    }
  }

  /**
   * Record a task execution result
   */
  async recordTaskExecution(result: TaskExecutionResult): Promise<void> {
    await this.load();

    this.data!.taskResults.push(result);

    if (this.debug) {
      logger.debug(`[ExecutionIntelligenceCollector] Recorded task execution: ${result.taskId} (success: ${result.success})`);
    }

    await this.save();
  }

  /**
   * Record a PRD generation result
   */
  async recordPRDGeneration(result: PRDGenerationResult): Promise<void> {
    await this.load();

    this.data!.prdResults.push(result);

    if (this.debug) {
      logger.debug(`[ExecutionIntelligenceCollector] Recorded PRD generation: ${result.prdId} (${result.phaseCount} phases, ${result.taskCount} tasks)`);
    }

    await this.save();
  }

  /**
   * Record provider performance
   */
  async recordProviderPerformance(result: ProviderPerformanceResult): Promise<void> {
    await this.load();

    this.data!.providerResults.push(result);

    await this.save();
  }

  /**
   * Analyze collected data and return aggregated intelligence
   */
  async analyze(): Promise<ExecutionIntelligence> {
    await this.load();

    const intelligence: ExecutionIntelligence = {
      taskExecution: this.analyzeTaskExecution(),
      prdGeneration: this.analyzePRDGeneration(),
      configEffectiveness: this.analyzeConfigEffectiveness(),
    };

    return intelligence;
  }

  /**
   * Analyze task execution patterns
   */
  private analyzeTaskExecution(): ExecutionIntelligence['taskExecution'] {
    if (!this.data || this.data.taskResults.length === 0) {
      return undefined;
    }

    // Group by task type and pattern
    const patternGroups: Record<string, TaskExecutionResult[]> = {};

    for (const result of this.data.taskResults) {
      const key = `${result.taskType}::${result.taskPattern}`;
      if (!patternGroups[key]) {
        patternGroups[key] = [];
      }
      patternGroups[key].push(result);
    }

    // Analyze patterns
    const successfulPatterns: Array<{
      taskType: string;
      taskPattern: string;
      successRate: number;
      averageIterations: number;
      commonApproaches?: string[];
    }> = [];

    const problematicPatterns: Array<{
      taskType: string;
      taskPattern: string;
      failureRate: number;
      commonErrors?: string[];
      suggestedWorkarounds?: string[];
    }> = [];

    for (const [key, results] of Object.entries(patternGroups)) {
      const [taskType, taskPattern] = key.split('::');
      const totalCount = results.length;
      const successCount = results.filter(r => r.success).length;
      const successRate = successCount / totalCount;

      if (successRate >= 0.8 && totalCount >= 3) {
        // Successful pattern
        const approaches = results
          .filter(r => r.success && r.approach)
          .map(r => r.approach!)
          .reduce((acc: Record<string, number>, approach) => {
            acc[approach] = (acc[approach] || 0) + 1;
            return acc;
          }, {});

        const commonApproaches = Object.entries(approaches)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([approach]) => approach);

        const avgIterations = results
          .filter(r => r.success)
          .reduce((sum, r) => sum + r.iterations, 0) / successCount;

        successfulPatterns.push({
          taskType,
          taskPattern,
          successRate,
          averageIterations: Math.round(avgIterations * 10) / 10,
          commonApproaches: commonApproaches.length > 0 ? commonApproaches : undefined,
        });
      } else if (successRate < 0.5 && totalCount >= 2) {
        // Problematic pattern
        const errors = results
          .filter(r => !r.success && r.errorMessages)
          .flatMap(r => r.errorMessages!)
          .reduce((acc: Record<string, number>, error) => {
            // Normalize error messages for grouping
            const normalized = error.slice(0, 100);
            acc[normalized] = (acc[normalized] || 0) + 1;
            return acc;
          }, {});

        const commonErrors = Object.entries(errors)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([error]) => error);

        problematicPatterns.push({
          taskType,
          taskPattern,
          failureRate: 1 - successRate,
          commonErrors: commonErrors.length > 0 ? commonErrors : undefined,
        });
      }
    }

    return {
      successfulTaskPatterns: successfulPatterns.length > 0 ? successfulPatterns : undefined,
      problematicTaskPatterns: problematicPatterns.length > 0 ? problematicPatterns : undefined,
    };
  }

  /**
   * Analyze PRD generation patterns
   */
  private analyzePRDGeneration(): ExecutionIntelligence['prdGeneration'] {
    if (!this.data || this.data.prdResults.length === 0) {
      return undefined;
    }

    const results = this.data.prdResults;

    // Calculate averages
    const totalPhases = results.reduce((sum, r) => sum + r.phaseCount, 0);
    const totalTasks = results.reduce((sum, r) => sum + r.taskCount, 0);
    const totalRefinements = results.reduce((sum, r) => sum + r.refinementIterations, 0);
    const executabilityScores = results.filter(r => r.executabilityScore !== undefined).map(r => r.executabilityScore!);

    // Count concept occurrences
    const conceptCounts: Record<string, number> = {};
    for (const result of results) {
      for (const concept of result.concepts) {
        conceptCounts[concept] = (conceptCounts[concept] || 0) + 1;
      }
    }

    const commonConcepts = Object.entries(conceptCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([concept]) => concept);

    return {
      typicalPhaseCount: Math.round(totalPhases / results.length),
      averageTasksPerPhase: Math.round((totalTasks / totalPhases) * 10) / 10,
      commonConcepts: commonConcepts.length > 0 ? commonConcepts : undefined,
      refinementIterations: Math.round(totalRefinements / results.length),
      executabilityAchievement: executabilityScores.length > 0
        ? Math.round((executabilityScores.reduce((a, b) => a + b, 0) / executabilityScores.length) * 100) / 100
        : undefined,
    };
  }

  /**
   * Analyze config effectiveness (provider/model performance)
   */
  private analyzeConfigEffectiveness(): ExecutionIntelligence['configEffectiveness'] {
    if (!this.data || this.data.providerResults.length === 0) {
      return undefined;
    }

    // Group by provider
    const providerGroups: Record<string, ProviderPerformanceResult[]> = {};
    for (const result of this.data.providerResults) {
      if (!providerGroups[result.provider]) {
        providerGroups[result.provider] = [];
      }
      providerGroups[result.provider].push(result);
    }

    // Analyze provider performance
    const providerPerformance: Record<string, {
      avgResponseTime: number;
      successRate: number;
      preferredForTaskTypes?: string[];
    }> = {};

    for (const [provider, results] of Object.entries(providerGroups)) {
      const successCount = results.filter(r => r.success).length;
      const avgResponseTime = results.reduce((sum, r) => sum + r.responseTimeMs, 0) / results.length;

      // Find task types where this provider performs best
      const taskTypePerformance: Record<string, { success: number; total: number }> = {};
      for (const result of results) {
        if (!taskTypePerformance[result.taskType]) {
          taskTypePerformance[result.taskType] = { success: 0, total: 0 };
        }
        taskTypePerformance[result.taskType].total++;
        if (result.success) {
          taskTypePerformance[result.taskType].success++;
        }
      }

      const preferredForTaskTypes = Object.entries(taskTypePerformance)
        .filter(([, perf]) => perf.success / perf.total >= 0.9 && perf.total >= 3)
        .map(([taskType]) => taskType);

      providerPerformance[provider] = {
        avgResponseTime: Math.round(avgResponseTime),
        successRate: Math.round((successCount / results.length) * 100) / 100,
        preferredForTaskTypes: preferredForTaskTypes.length > 0 ? preferredForTaskTypes : undefined,
      };
    }

    // Group by model
    const modelGroups: Record<string, ProviderPerformanceResult[]> = {};
    for (const result of this.data.providerResults) {
      if (result.model) {
        if (!modelGroups[result.model]) {
          modelGroups[result.model] = [];
        }
        modelGroups[result.model].push(result);
      }
    }

    // Analyze model performance
    const modelPerformance: Record<string, {
      avgQuality: number;
      avgTokens: number;
      bestForConcepts?: string[];
    }> = {};

    for (const [model, results] of Object.entries(modelGroups)) {
      const qualityScores = results.filter(r => r.quality !== undefined).map(r => r.quality!);
      const tokenUsages = results.filter(r => r.tokenUsage).map(r => r.tokenUsage!.input + r.tokenUsage!.output);

      modelPerformance[model] = {
        avgQuality: qualityScores.length > 0
          ? Math.round((qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length) * 100) / 100
          : 0,
        avgTokens: tokenUsages.length > 0
          ? Math.round(tokenUsages.reduce((a, b) => a + b, 0) / tokenUsages.length)
          : 0,
      };
    }

    return {
      providerPerformance: Object.keys(providerPerformance).length > 0 ? providerPerformance : undefined,
      modelPerformance: Object.keys(modelPerformance).length > 0 ? modelPerformance : undefined,
    };
  }

  /**
   * Prune old data to stay under limits
   */
  private pruneData(): void {
    if (!this.data) return;

    // Keep most recent results
    if (this.data.taskResults.length > this.maxResults) {
      this.data.taskResults = this.data.taskResults.slice(-this.maxResults);
    }
    if (this.data.prdResults.length > this.maxResults) {
      this.data.prdResults = this.data.prdResults.slice(-this.maxResults);
    }
    if (this.data.providerResults.length > this.maxResults * 10) {
      this.data.providerResults = this.data.providerResults.slice(-this.maxResults * 10);
    }
  }

  /**
   * Get task success rate for a given pattern
   */
  async getTaskSuccessRate(taskType: string, taskPattern: string): Promise<number | undefined> {
    await this.load();

    const matches = this.data!.taskResults.filter(
      r => r.taskType === taskType && r.taskPattern === taskPattern
    );

    if (matches.length === 0) {
      return undefined;
    }

    const successCount = matches.filter(r => r.success).length;
    return successCount / matches.length;
  }

  /**
   * Get provider recommendation for a task type
   */
  async getRecommendedProvider(taskType: string): Promise<string | undefined> {
    await this.load();

    const providerSuccess: Record<string, { success: number; total: number }> = {};

    for (const result of this.data!.providerResults) {
      if (result.taskType === taskType) {
        if (!providerSuccess[result.provider]) {
          providerSuccess[result.provider] = { success: 0, total: 0 };
        }
        providerSuccess[result.provider].total++;
        if (result.success) {
          providerSuccess[result.provider].success++;
        }
      }
    }

    // Find provider with highest success rate (with minimum sample size)
    let bestProvider: string | undefined;
    let bestRate = 0;

    for (const [provider, stats] of Object.entries(providerSuccess)) {
      if (stats.total >= 3) {
        const rate = stats.success / stats.total;
        if (rate > bestRate) {
          bestRate = rate;
          bestProvider = provider;
        }
      }
    }

    return bestProvider;
  }

  /**
   * Clear all collected data
   */
  async clear(): Promise<void> {
    this.data = {
      taskResults: [],
      prdResults: [],
      providerResults: [],
      lastUpdated: new Date().toISOString(),
      version: '1.0.0',
    };
    await this.save();
  }

  /**
   * Check if data file exists
   */
  async exists(): Promise<boolean> {
    return fs.pathExists(this.dataPath);
  }

  /**
   * Get the data file path
   */
  getDataPath(): string {
    return this.dataPath;
  }
}
