import { logger } from './logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdMetadata } from './prd-config-parser';

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
  status: 'pending' | 'running' | 'complete' | 'blocked';
  currentPhase?: number;
  completedPhases: number[];
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

  constructor(statePath: string = '.devloop/prd-state.json', debug: boolean = false) {
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

    // Save state
    await this.saveState(result);

    return result;
  }

  /**
   * Wait for PRD dependencies to complete.
   */
  async waitForDependencies(prd: PrdMetadata): Promise<void> {
    const dependencies = prd.relationships?.dependsOn || [];

    for (const dep of dependencies) {
      if (dep.waitForCompletion) {
        const depState = await this.getPrdState(dep.prd);
        if (depState && depState.status !== 'complete') {
          if (this.debug) {
            logger.debug(`[PrdCoordinator] Waiting for PRD ${dep.prd} to complete...`);
          }
          // In a real implementation, this would wait/poll
          // For now, just check state
        }
      }
    }
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
      const depState = await this.getPrdState(dep.prd);
      if (!depState) {
        errors.push(`Dependent PRD ${dep.prd} not found in state`);
      } else if (dep.waitForCompletion && depState.status !== 'complete') {
        errors.push(`Dependent PRD ${dep.prd} is not complete (status: ${depState.status})`);
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
  private async loadState(): Promise<{ prdStates: Map<string, PrdState>; sharedState: Record<string, any> }> {
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
  private async saveState(state: { prdStates: Map<string, PrdState>; sharedState: Record<string, any> }): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.statePath));
      // Convert Map to object for JSON serialization
      const prdStatesObj: Record<string, PrdState> = {};
      for (const [key, value] of state.prdStates.entries()) {
        prdStatesObj[key] = value;
      }
      await fs.writeJson(this.statePath, {
        prdStates: prdStatesObj,
        sharedState: state.sharedState,
      }, { spaces: 2 });
    } catch (error: any) {
      if (this.debug) {
        logger.debug(`[PrdCoordinator] Failed to save state: ${error.message}`);
      }
    }
  }
}

