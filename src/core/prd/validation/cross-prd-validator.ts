import { logger } from '../../utils/logger';
import { PrdCoordinator, PrdSet } from '../coordination/coordinator';
import { PrdMetadata } from '../parser/config-parser';

export interface IntegrationResult {
  success: boolean;
  prdIntegration: PrdIntegrationResult[];
  sharedState: StateValidationResult;
  dependencies: DependencyResult;
  coordination: CoordinationResult;
  errors: string[];
}

export interface PrdIntegrationResult {
  prdId: string;
  success: boolean;
  errors: string[];
}

export interface StateValidationResult {
  success: boolean;
  inconsistencies: string[];
}

export interface DependencyResult {
  success: boolean;
  missingDependencies: string[];
  circularDependencies: string[];
}

export interface CoordinationResult {
  success: boolean;
  phaseOverlaps: string[];
  sequenceErrors: string[];
}

/**
 * CrossPrdValidator validates integration between PRDs in a PRD set.
 *
 * Supports:
 * - PRD set integration validation
 * - Shared state consistency
 * - Cross-PRD dependency validation
 * - Phase coordination validation
 */
export class CrossPrdValidator {
  private coordinator: PrdCoordinator;
  private debug: boolean;

  constructor(coordinator: PrdCoordinator, debug: boolean = false) {
    this.coordinator = coordinator;
    this.debug = debug;
  }

  /**
   * Validate PRD set integration.
   */
  async validatePrdIntegration(prdSet: PrdSet): Promise<IntegrationResult> {
    const result: IntegrationResult = {
      success: true,
      prdIntegration: [],
      sharedState: { success: true, inconsistencies: [] },
      dependencies: { success: true, missingDependencies: [], circularDependencies: [] },
      coordination: { success: true, phaseOverlaps: [], sequenceErrors: [] },
      errors: [],
    };

    // Validate each PRD
    for (const prd of prdSet.prds) {
      const prdResult = await this.validatePrd(prd.metadata);
      result.prdIntegration.push({
        prdId: prd.id,
        success: prdResult.success,
        errors: prdResult.errors,
      });
      if (!prdResult.success) {
        result.success = false;
      }
    }

    // Validate shared state
    result.sharedState = await this.validateSharedState(prdSet);
    if (!result.sharedState.success) {
      result.success = false;
    }

    // Validate dependencies
    result.dependencies = await this.validateCrossPrdDependencies(prdSet);
    if (!result.dependencies.success) {
      result.success = false;
    }

    // Validate phase coordination
    result.coordination = await this.validatePhaseCoordination(prdSet);
    if (!result.coordination.success) {
      result.success = false;
    }

    return result;
  }

  /**
   * Validate a single PRD.
   */
  private async validatePrd(prd: PrdMetadata): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];
    const dependencies = prd.relationships?.dependsOn || [];

    for (const dep of dependencies) {
      const depValidation = await this.coordinator.validateCrossPrdDependencies(prd);
      if (!depValidation.success) {
        errors.push(...depValidation.errors);
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate shared state consistency.
   */
  async validateSharedState(prdSet: PrdSet): Promise<StateValidationResult> {
    const inconsistencies: string[] = [];
    // Implementation would check shared state keys are consistent
    // For now, return success
    return {
      success: inconsistencies.length === 0,
      inconsistencies,
    };
  }

  /**
   * Validate cross-PRD dependencies.
   */
  async validateCrossPrdDependencies(prdSet: PrdSet): Promise<DependencyResult> {
    const missingDependencies: string[] = [];
    const circularDependencies: string[] = [];

    // Check for missing dependencies
    const prdIds = new Set(prdSet.prds.map(p => p.id));
    for (const prd of prdSet.prds) {
      const deps = prd.metadata.relationships?.dependsOn || [];
      for (const dep of deps) {
        if (!prdIds.has(dep.prd)) {
          missingDependencies.push(`PRD ${prd.metadata.prd?.id || 'unknown'} depends on ${dep.prd} which is not in the PRD set`);
        }
      }
    }

    // Check for circular dependencies (simplified)
    // A full implementation would use graph algorithms
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (prdId: string): boolean => {
      visited.add(prdId);
      recStack.add(prdId);

      const prd = prdSet.prds.find(p => p.id === prdId);
      if (prd) {
        const deps = prd.metadata.relationships?.dependsOn || [];
        for (const dep of deps) {
          if (!visited.has(dep.prd)) {
            if (hasCycle(dep.prd)) {
              return true;
            }
          } else if (recStack.has(dep.prd)) {
            circularDependencies.push(`Circular dependency detected: ${prdId} -> ${dep.prd}`);
            return true;
          }
        }
      }

      recStack.delete(prdId);
      return false;
    };

    for (const prd of prdSet.prds) {
      if (!visited.has(prd.id)) {
        hasCycle(prd.id);
      }
    }

    return {
      success: missingDependencies.length === 0 && circularDependencies.length === 0,
      missingDependencies,
      circularDependencies,
    };
  }

  /**
   * Validate phase coordination.
   */
  async validatePhaseCoordination(prdSet: PrdSet): Promise<CoordinationResult> {
    const phaseOverlaps: string[] = [];
    const sequenceErrors: string[] = [];

    // Check for phase ID overlaps when globalPhaseNumbering is enabled
    // This would require checking PRD metadata for globalPhaseNumbering flag
    // For now, return success

    return {
      success: phaseOverlaps.length === 0 && sequenceErrors.length === 0,
      phaseOverlaps,
      sequenceErrors,
    };
  }
}






