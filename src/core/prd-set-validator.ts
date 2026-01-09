import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdSetManifest } from './prd-manifest-parser';
import { DiscoveredPrdSet } from './prd-set-discovery';
import { PrdMetadata } from './prd-config-parser';
import { logger } from './logger';

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  setLevel: SetLevelValidation;
  prdLevel: PrdLevelValidation[];
  phaseLevel: PhaseLevelValidation[];
}

export interface SetLevelValidation {
  cycles: boolean;
  discoverability: boolean;
  consistency: boolean;
  prerequisites: boolean;
  errors: string[];
}

export interface PrdLevelValidation {
  prdId: string;
  frontmatter: boolean;
  dependencies: boolean;
  phases: boolean;
  errors: string[];
}

export interface PhaseLevelValidation {
  prdId: string;
  phaseId: number;
  dependencies: boolean;
  prerequisites: boolean;
  gates: boolean;
  errors: string[];
}

/**
 * PRD Set Validator
 *
 * Validates PRD sets at multiple levels:
 * - Set Level: Dependency cycles, PRD discoverability, frontmatter consistency
 * - PRD Level: PRD frontmatter, dependencies, phase definitions
 * - Phase Level: Phase dependencies, prerequisites, gates
 */
export class PrdSetValidator {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Validate entire PRD set
   */
  async validatePrdSet(discoveredSet: DiscoveredPrdSet): Promise<ValidationResult> {
    const result: ValidationResult = {
      success: true,
      errors: [],
      warnings: [],
      setLevel: {
        cycles: false,
        discoverability: false,
        consistency: false,
        prerequisites: false,
        errors: [],
      },
      prdLevel: [],
      phaseLevel: [],
    };

    // Set-level validation
    const setValidation = await this.validateSetLevel(discoveredSet);
    result.setLevel = setValidation;
    if (!setValidation.cycles || !setValidation.discoverability || !setValidation.consistency) {
      result.success = false;
      result.errors.push(...setValidation.errors);
    }

    // PRD-level validation
    for (const prd of discoveredSet.prdSet.prds) {
      const prdValidation = await this.validatePrdLevel(prd.metadata, discoveredSet.prdSet);
      result.prdLevel.push(prdValidation);
      if (prdValidation.errors.length > 0) {
        result.success = false;
        result.errors.push(...prdValidation.errors.map(e => `[${prd.id}] ${e}`));
      }
    }

    // Phase-level validation
    for (const prd of discoveredSet.prdSet.prds) {
      const phases = prd.metadata.requirements?.phases || [];
      for (const phase of phases) {
        const phaseValidation = this.validatePhaseLevel(prd.id, phase.id, prd.metadata);
        result.phaseLevel.push(phaseValidation);
        if (phaseValidation.errors.length > 0) {
          result.success = false;
          result.errors.push(...phaseValidation.errors.map(e => `[${prd.id}:Phase ${phase.id}] ${e}`));
        }
      }
    }

    return result;
  }

  /**
   * Validate set-level structure
   */
  private async validateSetLevel(discoveredSet: DiscoveredPrdSet): Promise<SetLevelValidation> {
    const validation: SetLevelValidation = {
      cycles: false,
      discoverability: false,
      consistency: false,
      prerequisites: false,
      errors: [],
    };

    // Check for dependency cycles
    try {
      const hasCycles = this.detectCycles(discoveredSet.prdSet);
      validation.cycles = !hasCycles;
      if (hasCycles) {
        validation.errors.push('Dependency cycle detected in PRD set');
      }
    } catch (error: any) {
      validation.errors.push(`Error checking for cycles: ${error.message}`);
    }

    // Check PRD discoverability (files exist and are readable)
    const discoverabilityErrors: string[] = [];
    for (const prd of discoveredSet.prdSet.prds) {
      if (!await fs.pathExists(prd.path)) {
        discoverabilityErrors.push(`PRD file not found: ${prd.path}`);
      } else {
        try {
          await fs.readFile(prd.path, 'utf-8');
        } catch (error: any) {
          discoverabilityErrors.push(`PRD file not readable: ${prd.path} - ${error.message}`);
        }
      }
    }
    validation.discoverability = discoverabilityErrors.length === 0;
    validation.errors.push(...discoverabilityErrors);

    // Check frontmatter consistency
    const consistencyErrors: string[] = [];
    const parentId = discoveredSet.manifest.parentPrd.id;

    // Verify parent PRD has status: split
    if (discoveredSet.manifest.parentPrd.metadata.prd?.status !== 'split') {
      consistencyErrors.push(`Parent PRD ${parentId} must have status: split`);
    }

    // Verify relationships.dependedOnBy matches child PRD parentPrd references
    const expectedChildIds = new Set(
      discoveredSet.manifest.parentPrd.metadata.relationships?.dependedOnBy?.map(d => d.prd) || []
    );
    const actualChildIds = new Set(
      discoveredSet.manifest.childPrds.map(c => c.id)
    );

    for (const expectedId of expectedChildIds) {
      if (!actualChildIds.has(expectedId)) {
        consistencyErrors.push(`Child PRD ${expectedId} listed in dependedOnBy but not found or invalid`);
      }
    }

    for (const child of discoveredSet.manifest.childPrds) {
      if (child.metadata.prd?.parentPrd !== parentId) {
        consistencyErrors.push(`Child PRD ${child.id} has parentPrd: ${child.metadata.prd?.parentPrd}, expected: ${parentId}`);
      }
    }

    // Check prdSequence numbers are unique and sequential
    const sequences = discoveredSet.manifest.childPrds.map(c => c.sequence).sort((a, b) => a - b);
    const uniqueSequences = new Set(sequences);
    if (uniqueSequences.size !== sequences.length) {
      consistencyErrors.push('Duplicate prdSequence numbers found in child PRDs');
    }

    // Check sequences are positive
    if (sequences.some(s => s <= 0)) {
      consistencyErrors.push('prdSequence numbers must be positive integers');
    }

    validation.consistency = consistencyErrors.length === 0;
    validation.errors.push(...consistencyErrors);

    // Prerequisites validation (environment, test infrastructure)
    // This is a placeholder - actual prerequisite validation is done by PrerequisiteValidator
    validation.prerequisites = true;

    return validation;
  }

  /**
   * Validate PRD-level structure
   */
  private async validatePrdLevel(
    metadata: PrdMetadata,
    prdSet: { prds: Array<{ id: string; metadata: PrdMetadata }> }
  ): Promise<PrdLevelValidation> {
    const validation: PrdLevelValidation = {
      prdId: metadata.prd?.id || 'unknown',
      frontmatter: false,
      dependencies: false,
      phases: false,
      errors: [],
    };

    // Validate frontmatter structure
    if (!metadata.prd) {
      validation.errors.push('Missing prd metadata');
      return validation;
    }

    if (!metadata.prd.id) {
      validation.errors.push('Missing prd.id');
    }

    if (!metadata.prd.version) {
      validation.errors.push('Missing prd.version');
    }

    if (!metadata.prd.status) {
      validation.errors.push('Missing prd.status');
    }

    validation.frontmatter = validation.errors.length === 0;

    // Validate PRD dependencies reference valid PRD IDs
    const prdIds = new Set(prdSet.prds.map(p => p.id));
    const dependencies = metadata.relationships?.dependsOn || [];
    const dependencyErrors: string[] = [];

    for (const dep of dependencies) {
      const depId = typeof dep === 'string' ? dep : dep.prd;
      if (!prdIds.has(depId)) {
        dependencyErrors.push(`Dependency references unknown PRD: ${depId}`);
      }
    }

    validation.dependencies = dependencyErrors.length === 0;
    validation.errors.push(...dependencyErrors);

    // Validate phase definitions
    const phases = metadata.requirements?.phases || [];
    const phaseIds = new Set<number>();
    const phaseErrors: string[] = [];

    for (const phase of phases) {
      // Check for duplicate phase IDs
      if (phaseIds.has(phase.id)) {
        phaseErrors.push(`Duplicate phase ID: ${phase.id}`);
      }
      phaseIds.add(phase.id);

      // Validate phase dependencies
      if (phase.dependsOn) {
        for (const depPhaseId of phase.dependsOn) {
          if (!phaseIds.has(depPhaseId) && !phases.some(p => p.id === depPhaseId)) {
            phaseErrors.push(`Phase ${phase.id} depends on unknown phase: ${depPhaseId}`);
          }
        }
      }
    }

    // Check for cycles in phase dependencies
    const hasPhaseCycle = this.detectPhaseCycles(phases);
    if (hasPhaseCycle) {
      phaseErrors.push('Cycle detected in phase dependencies');
    }

    validation.phases = phaseErrors.length === 0;
    validation.errors.push(...phaseErrors);

    return validation;
  }

  /**
   * Validate phase-level structure
   */
  private validatePhaseLevel(
    prdId: string,
    phaseId: number,
    metadata: PrdMetadata
  ): PhaseLevelValidation {
    const validation: PhaseLevelValidation = {
      prdId,
      phaseId,
      dependencies: false,
      prerequisites: false,
      gates: false,
      errors: [],
    };

    const phases = metadata.requirements?.phases || [];
    const phase = phases.find(p => p.id === phaseId);

    if (!phase) {
      validation.errors.push(`Phase ${phaseId} not found in PRD`);
      return validation;
    }

    // Validate phase dependencies reference valid phase IDs
    if (phase.dependsOn) {
      const validPhaseIds = new Set(phases.map(p => p.id));
      const invalidDeps = phase.dependsOn.filter(depId => !validPhaseIds.has(depId));
      if (invalidDeps.length > 0) {
        validation.errors.push(`Phase ${phaseId} depends on invalid phases: ${invalidDeps.join(', ')}`);
      }
    }

    validation.dependencies = validation.errors.length === 0;

    // Phase prerequisites (placeholder - actual validation done by PrerequisiteValidator)
    validation.prerequisites = true;

    // Phase gates (placeholder - actual validation done by ValidationGateExecutor)
    validation.gates = true;

    return validation;
  }

  /**
   * Detect cycles in PRD dependencies
   */
  private detectCycles(prdSet: { prds: Array<{ id: string; metadata: PrdMetadata }> }): boolean {
    const graph = new Map<string, string[]>();
    const prdIds = prdSet.prds.map(p => p.id);

    // Build dependency graph
    for (const prd of prdSet.prds) {
      const deps: string[] = [];
      const dependencies = prd.metadata.relationships?.dependsOn || [];
      for (const dep of dependencies) {
        const depId = typeof dep === 'string' ? dep : dep.prd;
        if (prdIds.includes(depId)) {
          deps.push(depId);
        }
      }
      graph.set(prd.id, deps);
    }

    // DFS to detect cycles
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (node: string): boolean => {
      if (recStack.has(node)) {
        return true; // Cycle detected
      }
      if (visited.has(node)) {
        return false;
      }

      visited.add(node);
      recStack.add(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor)) {
          return true;
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const prdId of prdIds) {
      if (!visited.has(prdId)) {
        if (hasCycle(prdId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detect cycles in phase dependencies within a PRD
   */
  private detectPhaseCycles(phases: Array<{ id: number; dependsOn?: number[] }>): boolean {
    const graph = new Map<number, number[]>();
    const phaseIds = phases.map(p => p.id);

    // Build dependency graph
    for (const phase of phases) {
      const deps = phase.dependsOn?.filter(depId => phaseIds.includes(depId)) || [];
      graph.set(phase.id, deps);
    }

    // DFS to detect cycles
    const visited = new Set<number>();
    const recStack = new Set<number>();

    const hasCycle = (node: number): boolean => {
      if (recStack.has(node)) {
        return true;
      }
      if (visited.has(node)) {
        return false;
      }

      visited.add(node);
      recStack.add(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor)) {
          return true;
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const phaseId of phaseIds) {
      if (!visited.has(phaseId)) {
        if (hasCycle(phaseId)) {
          return true;
        }
      }
    }

    return false;
  }
}






