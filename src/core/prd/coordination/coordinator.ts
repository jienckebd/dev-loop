import { logger } from '../../utils/logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdMetadata } from '../parser/config-parser';

export interface PrdSet {
  prds: Array<{
    id: string;
    path: string;
    metadata: PrdMetadata;
  }>;
}

export interface CoordinationResult {
  success: boolean;
  prdStates: Map<string, PrdState>;
  sharedState: Record<string, any>;
  errors: string[];
}

export interface PrdState {
  prdId: string;
  status: 'pending' | 'running' | 'complete' | 'blocked' | 'failed';
  currentPhase?: number;
  completedPhases: number[];
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

export interface SharedKey {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
}

/**
 * PrdCoordinator coordinates execution across multiple PRDs in a PRD set.
 *
 * Supports:
 * - PRD dependency tracking
 * - State sharing between PRDs
 * - Cross-PRD validation
 * - Parallel PRD execution coordination
 */
export class PrdCoordinator {
  private statePath: string;
  private debug: boolean;

  constructor(statePath: string = '.devloop/execution-state.json', debug: boolean = false) {
    this.statePath = statePath;
    this.debug = debug;
  }

  /**
   * Coordinate execution of a PRD set.
   */
  async coordinatePrdSet(prdSet: PrdSet): Promise<CoordinationResult> {
    const result: CoordinationResult = {
      success: true,
      prdStates: new Map(),
      sharedState: {},
      errors: [],
    };

    // Load existing state
    const existingState = await this.loadState();
    result.prdStates = existingState.prdStates || new Map();
    result.sharedState = existingState.sharedState || {};

    // Track PRD states
    for (const prd of prdSet.prds) {
      if (!result.prdStates.has(prd.id)) {
        result.prdStates.set(prd.id, {
          prdId: prd.id,
          status: 'pending',
          completedPhases: [],
        });
      }
    }

    // Save state, preserving activePrdSetId if it exists
    await this.saveState({
      ...result,
      activePrdSetId: existingState.activePrdSetId,
    });

    return result;
  }

  /**
   * Wait for PRD dependencies to complete.
   */
  async waitForDependencies(
    prd: PrdMetadata,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<{ success: boolean; message?: string }> {
    const { timeout = 3600000, pollInterval = 5000 } = options; // Default: 1 hour timeout, 5s poll
    const dependencies = prd.relationships?.dependsOn || [];
    const startTime = Date.now();

    for (const dep of dependencies) {
      const depId = typeof dep === 'string' ? dep : dep.prd;
      const waitForCompletion = typeof dep === 'string' ? true : (dep.waitForCompletion ?? true);

      if (!waitForCompletion) {
        continue;
      }

      while (Date.now() - startTime < timeout) {
        const depState = await this.getPrdState(depId);

        if (depState?.status === 'complete') {
          if (this.debug) {
            logger.debug(`[PrdCoordinator] PRD ${depId} dependency complete`);
          }
          break;
        }

        if (depState?.status === 'failed' || depState?.status === 'blocked') {
          return {
            success: false,
            message: `Dependency PRD ${depId} is ${depState.status}`,
          };
        }

        if (this.debug) {
          logger.debug(`[PrdCoordinator] Waiting for PRD ${depId} to complete... (status: ${depState?.status || 'unknown'})`);
        }

        // Poll interval
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      // Check if timeout exceeded
      const finalState = await this.getPrdState(depId);
      if (finalState?.status !== 'complete') {
        return {
          success: false,
          message: `Timeout waiting for PRD ${depId} to complete (status: ${finalState?.status || 'unknown'})`,
        };
      }
    }

    return { success: true };
  }

  /**
   * Share state between PRDs.
   */
  async shareState(sourcePrd: string, targetPrd: string, keys: string[]): Promise<void> {
    const state = await this.loadState();
    const sourceState = state.sharedState[sourcePrd] || {};

    if (!state.sharedState[targetPrd]) {
      state.sharedState[targetPrd] = {};
    }

    for (const key of keys) {
      if (sourceState[key] !== undefined) {
        state.sharedState[targetPrd][key] = sourceState[key];
      }
    }

    await this.saveState(state);
  }

  /**
   * Validate cross-PRD dependencies.
   */
  async validateCrossPrdDependencies(prd: PrdMetadata): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];
    const dependencies = prd.relationships?.dependsOn || [];

    for (const dep of dependencies) {
      const depId = typeof dep === 'string' ? dep : dep.prd;
      const waitForCompletion = typeof dep === 'string' ? true : (dep.waitForCompletion ?? true);

      const depState = await this.getPrdState(depId);
      if (!depState) {
        errors.push(`Dependent PRD ${depId} not found in state`);
      } else if (waitForCompletion && depState.status !== 'complete') {
        errors.push(`Dependent PRD ${depId} is not complete (status: ${depState.status})`);
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Get PRD state.
   */
  async getPrdState(prdId: string): Promise<PrdState | null> {
    const state = await this.loadState();
    return state.prdStates.get(prdId) || null;
  }

  /**
   * Update PRD state.
   */
  async updatePrdState(prdId: string, updates: Partial<PrdState>): Promise<void> {
    const state = await this.loadState();
    const currentState = state.prdStates.get(prdId) || {
      prdId,
      status: 'pending',
      completedPhases: [],
    };

    state.prdStates.set(prdId, { ...currentState, ...updates });
    await this.saveState(state);
  }

  /**
   * Load state from file.
   */
  private async loadState(): Promise<{ prdStates: Map<string, PrdState>; sharedState: Record<string, any>; activePrdSetId?: string }> {
    try {
      if (await fs.pathExists(this.statePath)) {
        const data = await fs.readJson(this.statePath);
        // Convert prdStates array back to Map
        const prdStates = new Map<string, PrdState>();
        if (data.prdStates) {
          for (const [key, value] of Object.entries(data.prdStates)) {
            prdStates.set(key, value as PrdState);
          }
        }
        return {
          prdStates,
          sharedState: data.sharedState || {},
          activePrdSetId: data.active?.prdSetId,  // Preserve existing activePrdSetId
        };
      }
    } catch (error: any) {
      if (this.debug) {
        logger.debug(`[PrdCoordinator] Failed to load state: ${error.message}`);
      }
    }

    return {
      prdStates: new Map(),
      sharedState: {},
    };
  }

  /**
   * Save state to file.
   */
  private async saveState(state: { prdStates: Map<string, PrdState>; sharedState: Record<string, any>; activePrdSetId?: string }): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.statePath));
      
      // Load existing state to preserve fields we don't manage (e.g., active, prds, sessions)
      let existingData: any = {};
      try {
        if (await fs.pathExists(this.statePath)) {
          existingData = await fs.readJson(this.statePath);
        }
      } catch {
        // Ignore read errors, start fresh
      }

      // Convert Map to object for JSON serialization
      const prdStatesObj: Record<string, PrdState> = {};
      for (const [key, value] of state.prdStates.entries()) {
        prdStatesObj[key] = value;
      }

      // Ensure active field exists
      const active = existingData.active || {};
      if (state.activePrdSetId) {
        active.prdSetId = state.activePrdSetId;
      }

      // Merge our state with existing state, preserving fields we don't manage
      await fs.writeJson(this.statePath, {
        ...existingData,  // Preserve existing fields (prds, sessions, etc.)
        active,           // Preserve and update active context
        prdStates: prdStatesObj,
        sharedState: state.sharedState,
      }, { spaces: 2 });
    } catch (error: any) {
      if (this.debug) {
        logger.debug(`[PrdCoordinator] Failed to save state: ${error.message}`);
      }
    }
  }

  /**
   * Set the active PRD set ID for task filtering
   */
  async setActivePrdSetId(prdSetId: string): Promise<void> {
    const state = await this.loadState();
    await this.saveState({ ...state, activePrdSetId: prdSetId });
    if (this.debug) {
      logger.debug(`[PrdCoordinator] Set active PRD set: ${prdSetId}`);
    }
  }
}

