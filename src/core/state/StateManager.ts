import { produce } from 'immer';
import * as fs from 'fs-extra';
import * as path from 'path';
import { z } from 'zod';
import { executionStateFileSchema, type ExecutionState } from '../../config/schema/execution-state';
import { metricsFileSchema, patternsFileSchema, observationsFileSchema } from '../../config/schema/runtime';
import type { PatternEntry, ObservationEntry } from '../../core/prd/learning/types';

/**
 * Unified State Manager
 *
 * Consolidates all execution state and metrics management using:
 * - Immer for immutable state updates
 * - Zod for schema validation
 * - Atomic file writes with locking
 */

// Simple in-memory lock to prevent concurrent writes from same process
const writeLocks: Map<string, Promise<void>> = new Map();

export class UnifiedStateManager {
  private executionStateFile: string;
  private metricsFile: string;
  private patternsFile: string;
  private observationsFile: string;
  private lockFile: string;

  constructor(private projectRoot: string = process.cwd()) {
    const stateDir = path.join(projectRoot, '.devloop');
    this.executionStateFile = path.join(stateDir, 'execution-state.json');
    this.metricsFile = path.join(stateDir, 'metrics.json');
    this.patternsFile = path.join(stateDir, 'patterns.json');
    this.observationsFile = path.join(stateDir, 'observations.json');
    this.lockFile = path.join(stateDir, '.state.lock');
  }

  async initialize(): Promise<void> {
    const stateDir = path.dirname(this.executionStateFile);
    await fs.ensureDir(stateDir);

    // Initialize execution-state.json if it doesn't exist
    if (!(await fs.pathExists(this.executionStateFile))) {
      const defaultState: ExecutionState = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        active: {
          workflowState: 'idle',
        },
        prdSets: {},
        prds: {},
        contribution: {
          fileCreation: {},
          investigationTasks: {},
        },
        contributionMode: {
          active: false,
        },
        sessions: {},
      };
      await this.writeExecutionState(defaultState);
    }

    // Initialize metrics.json if it doesn't exist
    if (!(await fs.pathExists(this.metricsFile))) {
      const defaultMetrics = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        runs: [],
        prdSets: {},
        prds: {},
        phases: {},
        features: {},
        parallel: {
          executions: [],
        },
        schema: {
          operations: [],
          metrics: {},
        },
        insights: {
          efficiency: {},
          trends: {},
          bottlenecks: {},
          quality: {},
          resources: {},
        },
        summary: {},
      };
      await this.writeMetrics(defaultMetrics);
    }
  }

  /**
   * Acquire a simple file lock with timeout
   */
  private async acquireLock(lockPath: string, timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    const lockContent = `${process.pid}-${Date.now()}`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
        return true;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          try {
            const stat = await fs.stat(lockPath);
            const age = Date.now() - stat.mtimeMs;
            if (age > 30000) {
              await fs.remove(lockPath);
            }
          } catch {
            // Ignore stat errors
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          throw error;
        }
      }
    }
    return false;
  }

  /**
   * Release file lock
   */
  private async releaseLock(lockPath: string): Promise<void> {
    try {
      await fs.remove(lockPath);
    } catch {
      // Ignore errors when releasing lock
    }
  }

  /**
   * Atomic file write using temp file and rename pattern with file locking
   */
  private async atomicWriteJson(filePath: string, data: any): Promise<void> {
    const existingLock = writeLocks.get(filePath);
    if (existingLock) {
      await existingLock;
    }

    let resolveLock: () => void;
    const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
    writeLocks.set(filePath, lockPromise);

    const lockPath = `${filePath}.lock`;
    let hasLock = false;

    try {
      hasLock = await this.acquireLock(lockPath);
      if (!hasLock) {
        console.warn(`[UnifiedStateManager] Could not acquire lock for ${filePath}, proceeding anyway`);
      }

      const tempFile = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
      );

      try {
        await fs.writeJson(tempFile, data, { spaces: 2 });
        const written = await fs.readJson(tempFile);
        if (!written || typeof written !== 'object') {
          throw new Error('Invalid JSON written to temp file');
        }
        await fs.rename(tempFile, filePath);
      } catch (error) {
        try {
          if (await fs.pathExists(tempFile)) {
            await fs.remove(tempFile);
          }
        } catch {
          // Ignore cleanup errors
        }
        throw error;
      }
    } finally {
      if (hasLock) {
        await this.releaseLock(lockPath);
      }
      writeLocks.delete(filePath);
      resolveLock!();
    }
  }

  /**
   * Get execution state
   */
  async getExecutionState(): Promise<ExecutionState> {
    await this.initialize();

    if (await fs.pathExists(this.executionStateFile)) {
      const maxRetries = 3;
      const retryDelayMs = 50;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const data = await fs.readJson(this.executionStateFile);
          const validated = executionStateFileSchema.parse(data);
          return validated;
        } catch (error: any) {
          if (attempt < maxRetries && error instanceof z.ZodError) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
            continue;
          }
          console.warn(`[UnifiedStateManager] Failed to read execution state (attempt ${attempt}): ${error.message}`);
          if (error instanceof z.ZodError) {
            console.warn(`[UnifiedStateManager] Schema validation failed, returning default state`);
          }
          return this.getDefaultExecutionState();
        }
      }
    }

    return this.getDefaultExecutionState();
  }

  /**
   * Update execution state using Immer producer
   */
  async updateExecutionState(producer: (draft: ExecutionState) => void): Promise<void> {
    await this.initialize();
    const current = await this.getExecutionState();
    const updated = produce(current, (draft) => {
      producer(draft);
      draft.updatedAt = new Date().toISOString();
    });

    // Validate before writing
    executionStateFileSchema.parse(updated);
    await this.writeExecutionState(updated);
  }

  /**
   * Write execution state (internal)
   */
  private async writeExecutionState(state: ExecutionState): Promise<void> {
    await this.atomicWriteJson(this.executionStateFile, state);
  }

  /**
   * Get default execution state
   */
  private getDefaultExecutionState(): ExecutionState {
    return {
      version: '1.0',
      updatedAt: new Date().toISOString(),
      active: {
        workflowState: 'idle',
      },
      prdSets: {},
      prds: {},
      contribution: {
        fileCreation: {},
        investigationTasks: {},
      },
      contributionMode: {
        active: false,
      },
      sessions: {},
    };
  }

  /**
   * Get metrics
   */
  async getMetrics(): Promise<any> {
    await this.initialize();

    if (await fs.pathExists(this.metricsFile)) {
      const maxRetries = 3;
      const retryDelayMs = 50;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const data = await fs.readJson(this.metricsFile);
          // Use passthrough validation for metrics (more flexible)
          return data;
        } catch (error: any) {
          if (attempt < maxRetries && error instanceof SyntaxError) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
            continue;
          }
          console.warn(`[UnifiedStateManager] Failed to read metrics (attempt ${attempt}): ${error.message}`);
          return this.getDefaultMetrics();
        }
      }
    }

    return this.getDefaultMetrics();
  }

  /**
   * Update metrics using Immer producer
   */
  async updateMetrics(producer: (draft: any) => void): Promise<void> {
    await this.initialize();
    const current = await this.getMetrics();
    const updated = produce(current, (draft: any) => {
      producer(draft);
      draft.updatedAt = new Date().toISOString();
    });

    await this.writeMetrics(updated);
  }

  /**
   * Write metrics (internal)
   */
  private async writeMetrics(metrics: any): Promise<void> {
    await this.atomicWriteJson(this.metricsFile, metrics);
  }

  /**
   * Get default metrics
   */
  private getDefaultMetrics(): any {
    return {
      version: '1.0',
      updatedAt: new Date().toISOString(),
      runs: [],
      prdSets: {},
      prds: {},
      phases: {},
      features: {},
      parallel: {
        executions: [],
      },
      schema: {
        operations: [],
        metrics: {},
      },
      insights: {
        efficiency: {},
        trends: {},
        bottlenecks: {},
        quality: {},
        resources: {},
      },
      summary: {},
    };
  }

  // Convenience methods for common operations

  /**
   * Get active execution context
   */
  async getActiveContext() {
    const state = await this.getExecutionState();
    return state.active;
  }

  /**
   * Set active execution context
   */
  async setActiveContext(context: Partial<ExecutionState['active']>) {
    await this.updateExecutionState((draft) => {
      Object.assign(draft.active, context);
    });
  }

  /**
   * Get active PRD set
   */
  async getActivePRDSet() {
    const state = await this.getExecutionState();
    if (!state.active.prdSetId) return null;
    return state.prdSets[state.active.prdSetId] || null;
  }

  /**
   * Get active PRD
   */
  async getActivePRD() {
    const state = await this.getExecutionState();
    if (!state.active.prdId) return null;
    return state.prds[state.active.prdId] || null;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(taskId: string, status: string) {
    await this.updateExecutionState((draft) => {
      if (draft.active.taskId === taskId) {
        draft.active.workflowState = status as any;
      }
      // Update in PRD state if applicable
      if (draft.active.prdId && draft.prds[draft.active.prdId]) {
        const prd = draft.prds[draft.active.prdId];
        if (prd.currentTask?.id === taskId) {
          prd.currentTask.status = status;
        }
      }
    });
  }

  /**
   * Increment retry count for a task
   */
  async incrementRetryCount(taskId: string) {
    await this.updateExecutionState((draft) => {
      if (draft.active.prdId && draft.prds[draft.active.prdId]) {
        const prd = draft.prds[draft.active.prdId];
        prd.retryCounts[taskId] = (prd.retryCounts[taskId] || 0) + 1;
      }
    });
  }

  /**
   * Record metrics at any level
   */
  async recordMetrics(level: 'prdSet' | 'prd' | 'phase' | 'run', id: string, metrics: any) {
    await this.updateMetrics((draft) => {
      if (level === 'prdSet') {
        if (!draft.prdSets) draft.prdSets = {};
        draft.prdSets[id] = metrics;
      } else if (level === 'prd') {
        if (!draft.prds) draft.prds = {};
        draft.prds[id] = metrics;
      } else if (level === 'phase') {
        if (!draft.phases) draft.phases = {};
        const [prdId, phaseId] = id.split(':');
        if (!draft.phases[prdId]) draft.phases[prdId] = {};
        draft.phases[prdId][phaseId] = metrics;
      } else if (level === 'run') {
        if (!draft.runs) draft.runs = [];
        draft.runs.push({ ...metrics, timestamp: new Date().toISOString() });
      }
    });
  }

  /**
   * Clear execution state
   */
  async clearExecutionState(): Promise<void> {
    await this.initialize();
    if (await fs.pathExists(this.executionStateFile)) {
      await fs.remove(this.executionStateFile);
    }
    await this.initialize();
  }

  // Patterns and Observations Management

  /**
   * Get patterns
   */
  async getPatterns(): Promise<z.infer<typeof patternsFileSchema>['patterns']> {
    await this.initialize();

    if (await fs.pathExists(this.patternsFile)) {
      try {
        const data = await fs.readJson(this.patternsFile);
        const validated = patternsFileSchema.parse(data);
        return validated.patterns || [];
      } catch (error: any) {
        console.warn(`[UnifiedStateManager] Failed to read patterns: ${error.message}`);
        return [];
      }
    }

    return [];
  }

  /**
   * Update patterns using Immer producer
   */
  async updatePatterns(producer: (draft: z.infer<typeof patternsFileSchema>) => void): Promise<void> {
    await this.initialize();
    
    let current: z.infer<typeof patternsFileSchema>;
    if (await fs.pathExists(this.patternsFile)) {
      try {
        current = await fs.readJson(this.patternsFile);
        patternsFileSchema.parse(current);
      } catch {
        current = { version: '2.0', patterns: [], updatedAt: new Date().toISOString() };
      }
    } else {
      current = { version: '2.0', patterns: [], updatedAt: new Date().toISOString() };
    }

    const updated = produce(current, (draft) => {
      producer(draft);
      draft.updatedAt = draft.updatedAt || new Date().toISOString();
    });

    patternsFileSchema.parse(updated);
    await this.atomicWriteJson(this.patternsFile, updated);
  }

  /**
   * Add a new pattern
   */
  async addPattern(pattern: z.infer<typeof patternsFileSchema>['patterns'][number]): Promise<void> {
    await this.updatePatterns((draft) => {
      const existingIndex = draft.patterns.findIndex(p => p.id === pattern.id);
      if (existingIndex >= 0) {
        draft.patterns[existingIndex] = pattern;
      } else {
        draft.patterns.push(pattern);
      }
    });
  }

  /**
   * Get observations
   */
  async getObservations(): Promise<z.infer<typeof observationsFileSchema>['observations']> {
    await this.initialize();

    if (await fs.pathExists(this.observationsFile)) {
      try {
        const data = await fs.readJson(this.observationsFile);
        const validated = observationsFileSchema.parse(data);
        return validated.observations || [];
      } catch (error: any) {
        console.warn(`[UnifiedStateManager] Failed to read observations: ${error.message}`);
        return [];
      }
    }

    return [];
  }

  /**
   * Update observations using Immer producer
   */
  async updateObservations(producer: (draft: z.infer<typeof observationsFileSchema>) => void): Promise<void> {
    await this.initialize();
    
    let current: z.infer<typeof observationsFileSchema>;
    if (await fs.pathExists(this.observationsFile)) {
      try {
        current = await fs.readJson(this.observationsFile);
        observationsFileSchema.parse(current);
      } catch {
        current = { version: '2.0', observations: [], updatedAt: new Date().toISOString() };
      }
    } else {
      current = { version: '2.0', observations: [], updatedAt: new Date().toISOString() };
    }

    const updated = produce(current, (draft) => {
      producer(draft);
      draft.updatedAt = draft.updatedAt || new Date().toISOString();
    });

    observationsFileSchema.parse(updated);
    await this.atomicWriteJson(this.observationsFile, updated);
  }

  /**
   * Add a new observation
   */
  async addObservation(observation: z.infer<typeof observationsFileSchema>['observations'][number]): Promise<void> {
    await this.updateObservations((draft) => {
      const existingIndex = draft.observations.findIndex(o => o.id === observation.id);
      if (existingIndex >= 0) {
        draft.observations[existingIndex] = observation;
      } else {
        draft.observations.push(observation);
      }
    });
  }
}
