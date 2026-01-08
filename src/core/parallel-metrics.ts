import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Metrics for a single agent execution
 */
export interface AgentMetrics {
  agentId: string;
  taskId: string;
  prdId: string;
  phaseId?: number;
  startTime: string;
  endTime?: string;
  durationMs: number;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  tokens: {
    input: number;
    output: number;
    estimated: boolean;
  };
  overlappedWith: string[]; // Other agent IDs running concurrently
  promptLength: number;
  responseLength: number;
}

/**
 * Concurrency statistics for parallel execution
 */
export interface ConcurrencyStats {
  maxConcurrent: number;
  avgConcurrent: number;
  peakTime: string;
  totalAgents: number;
}

/**
 * Coordination timing breakdown
 */
export interface CoordinationStats {
  waitTimeMs: number;        // Time spent waiting for dependencies
  overlapTimeMs: number;     // Time agents ran in parallel
  sequentialTimeMs: number;  // Time in sequential execution
  parallelEfficiency: number; // 0-1, ratio of parallel vs sequential time
}

/**
 * Complete parallel execution metrics
 */
export interface ParallelExecutionMetrics {
  executionId: string;
  prdSetId?: string;
  startTime: string;
  endTime?: string;
  totalDurationMs: number;
  agents: AgentMetrics[];
  concurrency: ConcurrencyStats;
  coordination: CoordinationStats;
  tokens: {
    totalInput: number;
    totalOutput: number;
    avgPerAgent: number;
  };
}

/**
 * Stored metrics data
 */
interface ParallelMetricsData {
  version: string;
  executions: ParallelExecutionMetrics[];
  summary: {
    totalExecutions: number;
    avgAgentsPerExecution: number;
    avgParallelEfficiency: number;
    totalTokensUsed: number;
  };
}

/**
 * Tracks parallel agent execution metrics
 */
export class ParallelMetricsTracker {
  private metricsPath: string;
  private data: ParallelMetricsData;
  private currentExecution: ParallelExecutionMetrics | null = null;
  private runningAgents: Map<string, AgentMetrics> = new Map();

  constructor(metricsPath: string = '.devloop/parallel-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.data = this.loadMetrics();
  }

  private loadMetrics(): ParallelMetricsData {
    const defaultData: ParallelMetricsData = {
      version: '1.0',
      executions: [],
      summary: {
        totalExecutions: 0,
        avgAgentsPerExecution: 0,
        avgParallelEfficiency: 0,
        totalTokensUsed: 0,
      },
    };

    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        const parsed = JSON.parse(content);
        return {
          version: parsed.version || defaultData.version,
          executions: Array.isArray(parsed.executions) ? parsed.executions : [],
          summary: { ...defaultData.summary, ...parsed.summary },
        };
      }
    } catch (error) {
      console.warn(`[ParallelMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }

    return defaultData;
  }

  private saveMetrics(): void {
    try {
      fs.ensureDirSync(path.dirname(this.metricsPath));
      fs.writeFileSync(this.metricsPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.warn(`[ParallelMetrics] Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start a new parallel execution session
   */
  startExecution(executionId: string, prdSetId?: string): void {
    this.currentExecution = {
      executionId,
      prdSetId,
      startTime: new Date().toISOString(),
      totalDurationMs: 0,
      agents: [],
      concurrency: {
        maxConcurrent: 0,
        avgConcurrent: 0,
        peakTime: '',
        totalAgents: 0,
      },
      coordination: {
        waitTimeMs: 0,
        overlapTimeMs: 0,
        sequentialTimeMs: 0,
        parallelEfficiency: 0,
      },
      tokens: {
        totalInput: 0,
        totalOutput: 0,
        avgPerAgent: 0,
      },
    };
    this.runningAgents.clear();
    console.log(`[ParallelMetrics] Started execution: ${executionId}`);
  }

  /**
   * Record an agent starting execution
   */
  startAgent(agentId: string, taskId: string, prdId: string, phaseId?: number, promptLength: number = 0): void {
    if (!this.currentExecution) {
      this.startExecution(`auto-${Date.now()}`);
    }

    const agent: AgentMetrics = {
      agentId,
      taskId,
      prdId,
      phaseId,
      startTime: new Date().toISOString(),
      durationMs: 0,
      status: 'running',
      tokens: { input: 0, output: 0, estimated: true },
      overlappedWith: [],
      promptLength,
      responseLength: 0,
    };

    // Record which other agents are currently running (for overlap tracking)
    agent.overlappedWith = Array.from(this.runningAgents.keys());

    this.runningAgents.set(agentId, agent);

    // Update concurrency stats
    const currentConcurrency = this.runningAgents.size;
    if (currentConcurrency > this.currentExecution!.concurrency.maxConcurrent) {
      this.currentExecution!.concurrency.maxConcurrent = currentConcurrency;
      this.currentExecution!.concurrency.peakTime = new Date().toISOString();
    }

    console.log(`[ParallelMetrics] Agent started: ${agentId} (${currentConcurrency} concurrent)`);
  }

  /**
   * Record an agent completing execution
   */
  completeAgent(
    agentId: string,
    status: 'completed' | 'failed' | 'timeout',
    responseLength: number = 0
  ): void {
    const agent = this.runningAgents.get(agentId);
    if (!agent) {
      // Check if agent was already completed (might have been moved to completed list)
      if (this.currentExecution) {
        const alreadyCompleted = this.currentExecution.agents.find(a => a.agentId === agentId);
        if (alreadyCompleted) {
          // Agent was already completed - this is a duplicate call, ignore
          return;
        }
      }
      // Agent not found and not completed - log warning but don't fail
      console.warn(`[ParallelMetrics] Agent not found: ${agentId} (may have been cleared by new execution)`);
      return;
    }

    const endTime = new Date();
    agent.endTime = endTime.toISOString();
    agent.durationMs = endTime.getTime() - new Date(agent.startTime).getTime();
    agent.status = status;
    agent.responseLength = responseLength;

    // Estimate tokens (approx 4 chars per token)
    agent.tokens = {
      input: Math.ceil(agent.promptLength / 4),
      output: Math.ceil(responseLength / 4),
      estimated: true,
    };

    // Move from running to completed
    this.runningAgents.delete(agentId);
    this.currentExecution!.agents.push(agent);

    // Update token totals
    this.currentExecution!.tokens.totalInput += agent.tokens.input;
    this.currentExecution!.tokens.totalOutput += agent.tokens.output;

    console.log(`[ParallelMetrics] Agent completed: ${agentId} (${agent.durationMs}ms, ${agent.tokens.input + agent.tokens.output} tokens)`);
  }

  /**
   * Record token usage for an agent
   */
  recordAgentTokens(agentId: string, tokens: { input: number; output: number; estimated?: boolean }): void {
    const agent = this.runningAgents.get(agentId);
    if (agent) {
      agent.tokens = { ...tokens, estimated: tokens.estimated ?? true };
    }
  }

  /**
   * Complete the current execution and calculate final metrics
   */
  completeExecution(): ParallelExecutionMetrics | null {
    if (!this.currentExecution) {
      return null;
    }

    const endTime = new Date();
    this.currentExecution.endTime = endTime.toISOString();
    this.currentExecution.totalDurationMs = endTime.getTime() - new Date(this.currentExecution.startTime).getTime();

    // Mark any still-running agents as failed
    for (const [agentId, agent] of this.runningAgents) {
      agent.status = 'timeout';
      agent.endTime = endTime.toISOString();
      agent.durationMs = endTime.getTime() - new Date(agent.startTime).getTime();
      this.currentExecution.agents.push(agent);
    }
    this.runningAgents.clear();

    // Calculate final stats
    this.calculateConcurrencyStats();
    this.calculateCoordinationStats();
    this.calculateTokenStats();

    // Store execution
    this.data.executions.push(this.currentExecution);
    this.updateSummary();
    this.saveMetrics();

    console.log(`[ParallelMetrics] Execution completed: ${this.currentExecution.executionId}`);
    console.log(`  Duration: ${this.currentExecution.totalDurationMs}ms`);
    console.log(`  Agents: ${this.currentExecution.agents.length}`);
    console.log(`  Max Concurrency: ${this.currentExecution.concurrency.maxConcurrent}`);
    console.log(`  Parallel Efficiency: ${(this.currentExecution.coordination.parallelEfficiency * 100).toFixed(1)}%`);
    console.log(`  Tokens: ${this.currentExecution.tokens.totalInput + this.currentExecution.tokens.totalOutput}`);

    const result = this.currentExecution;
    this.currentExecution = null;
    return result;
  }

  private calculateConcurrencyStats(): void {
    if (!this.currentExecution) return;

    const agents = this.currentExecution.agents;
    if (agents.length === 0) {
      return;
    }

    this.currentExecution.concurrency.totalAgents = agents.length;

    // Calculate average concurrency by sampling time intervals
    if (agents.length > 1) {
      // Find the time range
      const startTimes = agents.map(a => new Date(a.startTime).getTime());
      const endTimes = agents.map(a => a.endTime ? new Date(a.endTime).getTime() : Date.now());
      const minStart = Math.min(...startTimes);
      const maxEnd = Math.max(...endTimes);

      // Sample at 1-second intervals
      const sampleInterval = 1000;
      let totalConcurrency = 0;
      let sampleCount = 0;

      for (let t = minStart; t < maxEnd; t += sampleInterval) {
        const concurrent = agents.filter(a => {
          const start = new Date(a.startTime).getTime();
          const end = a.endTime ? new Date(a.endTime).getTime() : Date.now();
          return t >= start && t < end;
        }).length;
        totalConcurrency += concurrent;
        sampleCount++;
      }

      this.currentExecution.concurrency.avgConcurrent = sampleCount > 0
        ? totalConcurrency / sampleCount
        : 1;
    } else {
      this.currentExecution.concurrency.avgConcurrent = 1;
    }
  }

  private calculateCoordinationStats(): void {
    if (!this.currentExecution) return;

    const agents = this.currentExecution.agents;
    if (agents.length === 0) {
      return;
    }

    // Calculate total sequential time (sum of all durations)
    const totalSequentialTime = agents.reduce((sum, a) => sum + a.durationMs, 0);

    // Calculate overlap time
    let overlapTime = 0;
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a1 = agents[i];
        const a2 = agents[j];

        const start1 = new Date(a1.startTime).getTime();
        const end1 = a1.endTime ? new Date(a1.endTime).getTime() : Date.now();
        const start2 = new Date(a2.startTime).getTime();
        const end2 = a2.endTime ? new Date(a2.endTime).getTime() : Date.now();

        // Calculate overlap
        const overlapStart = Math.max(start1, start2);
        const overlapEnd = Math.min(end1, end2);
        if (overlapEnd > overlapStart) {
          overlapTime += overlapEnd - overlapStart;
        }
      }
    }

    this.currentExecution.coordination.overlapTimeMs = overlapTime;
    this.currentExecution.coordination.sequentialTimeMs = totalSequentialTime;

    // Parallel efficiency: how much time was saved by running in parallel
    // 1.0 = perfect parallelism (all ran simultaneously)
    // 0.0 = sequential (no parallelism)
    if (totalSequentialTime > 0 && this.currentExecution.totalDurationMs > 0) {
      const theoreticalSequential = totalSequentialTime;
      const actualParallel = this.currentExecution.totalDurationMs;
      const timeSaved = theoreticalSequential - actualParallel;
      this.currentExecution.coordination.parallelEfficiency = Math.max(0, timeSaved / theoreticalSequential);
    }
  }

  private calculateTokenStats(): void {
    if (!this.currentExecution) return;

    const agents = this.currentExecution.agents;
    if (agents.length > 0) {
      const totalTokens = this.currentExecution.tokens.totalInput + this.currentExecution.tokens.totalOutput;
      this.currentExecution.tokens.avgPerAgent = totalTokens / agents.length;
    }
  }

  private updateSummary(): void {
    const executions = this.data.executions;
    if (executions.length === 0) {
      return;
    }

    const totalAgents = executions.reduce((sum, e) => sum + e.agents.length, 0);
    const totalEfficiency = executions.reduce((sum, e) => sum + e.coordination.parallelEfficiency, 0);
    const totalTokens = executions.reduce((sum, e) => sum + e.tokens.totalInput + e.tokens.totalOutput, 0);

    this.data.summary = {
      totalExecutions: executions.length,
      avgAgentsPerExecution: totalAgents / executions.length,
      avgParallelEfficiency: totalEfficiency / executions.length,
      totalTokensUsed: totalTokens,
    };
  }

  /**
   * Get current execution metrics
   */
  getCurrentExecution(): ParallelExecutionMetrics | null {
    return this.currentExecution;
  }

  /**
   * Get all stored metrics
   */
  getAllMetrics(): ParallelMetricsData {
    return this.data;
  }

  /**
   * Get metrics for a specific execution
   */
  getExecution(executionId: string): ParallelExecutionMetrics | undefined {
    return this.data.executions.find(e => e.executionId === executionId);
  }

  /**
   * Get the count of currently running agents
   */
  getRunningAgentCount(): number {
    return this.runningAgents.size;
  }

  /**
   * Check if there's an active execution
   */
  hasActiveExecution(): boolean {
    return this.currentExecution !== null;
  }
}

// Singleton instance for global access
let globalTracker: ParallelMetricsTracker | null = null;

export function getParallelMetricsTracker(metricsPath?: string): ParallelMetricsTracker {
  if (!globalTracker) {
    globalTracker = new ParallelMetricsTracker(metricsPath);
  }
  return globalTracker;
}

export function resetParallelMetricsTracker(): void {
  globalTracker = null;
}

