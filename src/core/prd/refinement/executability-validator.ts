/**
 * Executability Validator
 *
 * Comprehensive validation beyond basic PRD structure.
 * Validates that PRD set is 100% executable by dev-loop.
 */

import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { DiscoveredPrdSet } from '../set/discovery';
import { PrdSet } from '../coordination/coordinator';
import { validateConfigOverlay } from '../../../config/schema/validation';
import { SchemaEnhancementResult } from './schema-enhancer';
import { TestPlanningResult } from './test-planner';
import { FeatureEnhancementResult } from './feature-enhancer';
import { logger } from '../../utils/logger';

/**
 * Validation Result
 */
export interface ExecutabilityValidationResult {
  executable: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  score: number; // 0-100, where 100 means 100% executable
  summary: string;
}

/**
 * Validation Error
 */
export interface ValidationError {
  type: 'missing-schema' | 'missing-test' | 'missing-config' | 'invalid-config' | 'incomplete-phase' | 'invalid-structure';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  phase?: number;
  task?: string;
  suggestion?: string;
}

/**
 * Validation Warning
 */
export interface ValidationWarning {
  type: 'deprecated-pattern' | 'optimization-opportunity' | 'missing-optional';
  message: string;
  phase?: number;
  task?: string;
  suggestion?: string;
}

/**
 * Executability Validator Configuration
 */
export interface ExecutabilityValidatorConfig {
  strict?: boolean; // Strict validation (fails on warnings)
  debug?: boolean;
}

/**
 * Validates that PRD set is executable by dev-loop
 */
export class ExecutabilityValidator {
  private config: Required<ExecutabilityValidatorConfig>;
  private debug: boolean;

  constructor(config: ExecutabilityValidatorConfig = {}) {
    this.config = {
      strict: config.strict || false,
      debug: config.debug || false,
    };
    this.debug = this.config.debug;
  }

  /**
   * Validate PRD set for executability
   */
  async validateExecutability(
    prd: ParsedPlanningDoc | DiscoveredPrdSet,
    enhancements?: {
      schemas?: SchemaEnhancementResult;
      tests?: TestPlanningResult;
      features?: FeatureEnhancementResult;
    }
  ): Promise<ExecutabilityValidationResult> {
    logger.debug(`[ExecutabilityValidator] Validating PRD set for executability`);

    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Get PRD structure (handle both ParsedPlanningDoc and DiscoveredPrdSet)
    const prdDoc = this.extractPrdDoc(prd);

    // 1. Validate basic PRD structure
    this.validateBasicStructure(prdDoc, errors, warnings);

    // 2. Validate config overlay
    this.validateConfigOverlay(prdDoc, errors, warnings);

    // 3. Validate phases and tasks
    this.validatePhasesAndTasks(prdDoc, errors, warnings);

    // 4. Validate enhancements (if provided)
    if (enhancements) {
      this.validateEnhancements(enhancements, errors, warnings, prdDoc);
    }

    // 5. Validate dependencies
    this.validateDependencies(prdDoc, errors, warnings);

    // 6. Validate testing configuration
    this.validateTestingConfig(prdDoc, errors, warnings);

    // Calculate score
    const score = this.calculateScore(prdDoc, errors, warnings, enhancements);

    // Determine if executable
    // For 100% executability (as required by plan), need:
    // - No critical errors
    // - No high-priority errors  
    // - Score must be 100
    const hasCriticalOrHighErrors = errors.filter(e => e.severity === 'critical' || e.severity === 'high').length > 0;
    const executable = this.config.strict
      ? errors.length === 0 && warnings.length === 0 && score === 100
      : !hasCriticalOrHighErrors && score === 100; // Require 100% score for executability

    // Generate summary
    const summary = this.generateSummary(errors, warnings, score, executable);

    return {
      executable,
      errors,
      warnings,
      score,
      summary,
    };
  }

  /**
   * Extract PRD document from input (handles both types)
   */
  private extractPrdDoc(prd: ParsedPlanningDoc | DiscoveredPrdSet): ParsedPlanningDoc {
    if ('prdSet' in prd) {
      // DiscoveredPrdSet - extract structure from manifest
      const discoveredSet = prd as DiscoveredPrdSet;
      const manifest = discoveredSet.manifest;
      const parentMetadata = manifest.parentPrd.metadata;
      
      // Extract phases and tasks from requirements.phases
      // Note: phaseMeta may have tasks even though type doesn't include it
      const phases: any[] = [];
      if (parentMetadata.requirements?.phases) {
        for (const phaseMeta of parentMetadata.requirements.phases) {
          // Type assertion needed because tasks may exist in actual data
          const phaseWithTasks = phaseMeta as any;
          phases.push({
            id: phaseMeta.id,
            name: phaseMeta.name || `Phase ${phaseMeta.id}`,
            description: phaseWithTasks.description || '',
            parallel: phaseMeta.parallel || false,
            status: phaseMeta.status || 'pending',
            dependsOn: phaseMeta.dependsOn,
            checkpoint: phaseMeta.checkpoint || false,
            tasks: phaseWithTasks.tasks || [],
          });
        }
      }
      
      // Convert testing config from PrdMetadata format to ParsedPlanningDoc format
      const testingConfig = parentMetadata.testing ? {
        directory: parentMetadata.testing.directory,
        runner: (parentMetadata.testing as any).runner,
        framework: parentMetadata.testing.framework,
        command: (parentMetadata.testing as any).command,
      } : undefined;
      
      // Store requirements.idPattern in rawFrontmatter so it's accessible for validation
      const rawFrontmatter: any = {
        requirements: parentMetadata.requirements,
      };
      
      return {
        prdId: discoveredSet.setId,
        version: parentMetadata.prd?.version || '1.0.0',
        status: parentMetadata.prd?.status || 'ready',
        title: (parentMetadata.prd as any)?.title || discoveredSet.setId,
        description: (parentMetadata.prd as any)?.description || '',
        phases,
        testing: testingConfig,
        dependencies: parentMetadata.dependencies,
        rawFrontmatter,
        rawContent: '',
      };
    }
    return prd as ParsedPlanningDoc;
  }

  /**
   * Validate basic PRD structure
   */
  private validateBasicStructure(
    prd: ParsedPlanningDoc,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Check required fields
    if (!prd.prdId || prd.prdId.trim().length === 0) {
      errors.push({
        type: 'invalid-structure',
        severity: 'critical',
        message: 'PRD ID is required',
        suggestion: 'Add prd.id to PRD frontmatter or metadata',
      });
    }

    if (!prd.title || prd.title.trim().length === 0) {
      errors.push({
        type: 'invalid-structure',
        severity: 'high',
        message: 'PRD title is required',
        suggestion: 'Add title to PRD document',
      });
    }

    if (!prd.phases || prd.phases.length === 0) {
      errors.push({
        type: 'invalid-structure',
        severity: 'critical',
        message: 'PRD must have at least one phase',
        suggestion: 'Add at least one phase to the PRD',
      });
    }

    // Check version
    if (!prd.version || prd.version === '1.0.0') {
      warnings.push({
        type: 'optimization-opportunity',
        message: 'PRD version is default (1.0.0), consider setting explicit version',
        suggestion: 'Set prd.version in PRD frontmatter',
      });
    }
  }

  /**
   * Validate config overlay
   */
  private validateConfigOverlay(
    prd: ParsedPlanningDoc,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (prd.configOverlay) {
      const validation = validateConfigOverlay(prd.configOverlay, 'prd');

      for (const error of validation.errors) {
        errors.push({
          type: 'invalid-config',
          severity: 'high',
          message: error,
          suggestion: 'Review config overlay structure and fix validation errors',
        });
      }

      for (const warning of validation.warnings) {
        warnings.push({
          type: 'optimization-opportunity',
          message: warning,
          suggestion: 'Review config keys for typos or deprecated options',
        });
      }
    }
  }

  /**
   * Validate phases and tasks
   */
  private validatePhasesAndTasks(
    prd: ParsedPlanningDoc,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!prd.phases || prd.phases.length === 0) {
      return; // Already handled in basic structure validation
    }

    const phaseIds = new Set<number>();
    const taskIds = new Set<string>();

    for (const phase of prd.phases) {
      // Check for duplicate phase IDs
      if (phaseIds.has(phase.id)) {
        errors.push({
          type: 'invalid-structure',
          severity: 'critical',
          message: `Duplicate phase ID: ${phase.id}`,
          phase: phase.id,
          suggestion: 'Ensure each phase has a unique ID',
        });
      }
      phaseIds.add(phase.id);

      // Check phase structure
      if (!phase.name || phase.name.trim().length === 0) {
        errors.push({
          type: 'invalid-structure',
          severity: 'high',
          message: `Phase ${phase.id} is missing a name`,
          phase: phase.id,
          suggestion: 'Add name to phase',
        });
      }

      // Validate tasks
      if (phase.tasks) {
        for (const task of phase.tasks) {
          // Check for duplicate task IDs
          if (taskIds.has(task.id)) {
            errors.push({
              type: 'invalid-structure',
              severity: 'critical',
              message: `Duplicate task ID: ${task.id}`,
              phase: phase.id,
              task: task.id,
              suggestion: 'Ensure each task has a unique ID',
            });
          }
          taskIds.add(task.id);

          // Check task structure
          if (!task.title || task.title.trim().length === 0) {
            errors.push({
              type: 'invalid-structure',
              severity: 'high',
              message: `Task ${task.id} is missing a title`,
              phase: phase.id,
              task: task.id,
              suggestion: 'Add title to task',
            });
          }

          if (!task.description || task.description.trim().length === 0) {
            errors.push({
              type: 'invalid-structure',
              severity: 'high',
              message: `Task ${task.id} is missing a description`,
              phase: phase.id,
              task: task.id,
              suggestion: 'Add description to task',
            });
          }

          // Check for missing test strategy (warning, not error)
          if (!task.testStrategy) {
            warnings.push({
              type: 'optimization-opportunity',
              message: `Task ${task.id} is missing test strategy`,
              phase: phase.id,
              task: task.id,
              suggestion: 'Add testStrategy to task for better test generation',
            });
          }

          // Check for missing validation checklist (warning)
          if (!task.validationChecklist || task.validationChecklist.length === 0) {
            warnings.push({
              type: 'optimization-opportunity',
              message: `Task ${task.id} is missing validation checklist`,
              phase: phase.id,
              task: task.id,
              suggestion: 'Add validationChecklist to task for better validation',
            });
          }
        }
      } else {
        errors.push({
          type: 'invalid-structure',
          severity: 'high',
          message: `Phase ${phase.id} has no tasks`,
          phase: phase.id,
          suggestion: 'Add tasks to phase or remove phase if not needed',
        });
      }

      // Check phase dependencies
      if (phase.dependsOn) {
        for (const depId of phase.dependsOn) {
          if (!phaseIds.has(depId)) {
            errors.push({
              type: 'invalid-structure',
              severity: 'high',
              message: `Phase ${phase.id} depends on non-existent phase ${depId}`,
              phase: phase.id,
              suggestion: 'Remove invalid dependency or add missing phase',
            });
          }
        }
      }

      // Check task dependencies within phase
      if (phase.tasks) {
        for (const task of phase.tasks) {
          if (task.dependencies) {
            for (const depTaskId of task.dependencies) {
              // Check if dependency exists in this phase or previous phases
              if (!taskIds.has(depTaskId)) {
                errors.push({
                  type: 'invalid-structure',
                  severity: 'high',
                  message: `Task ${task.id} in phase ${phase.id} depends on non-existent task ${depTaskId}`,
                  phase: phase.id,
                  task: task.id,
                  suggestion: 'Remove invalid dependency or add missing task',
                });
              }
            }
          }
        }
      }
    }

    // Check ID pattern consistency
    // Get idPattern from rawFrontmatter (for ParsedPlanningDoc) or from extracted metadata
    const idPattern = (prd as any).rawFrontmatter?.requirements?.idPattern;
    if (idPattern && prd.phases) {
      // Convert pattern to regex (e.g., "REQ-{id}" -> /^REQ-(.+)$/)
      const patternPrefix = idPattern.split('{id}')[0];
      const patternRegex = new RegExp(`^${patternPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.+)$`);

      for (const phase of prd.phases) {
        if (phase.tasks) {
          for (const task of phase.tasks) {
            if (!patternRegex.test(task.id)) {
              errors.push({
                type: 'invalid-structure',
                severity: 'high',
                message: `Task ID "${task.id}" does not match idPattern "${idPattern}"`,
                phase: phase.id,
                task: task.id,
                suggestion: `Update idPattern to match actual task ID format (e.g., "${this.detectPatternFromTaskId(task.id)}")`,
              });
            }
          }
        }
      }
    }

    // Check for missing phase IDs (gaps in sequence)
    const maxPhaseId = Math.max(...Array.from(phaseIds), 0);
    for (let i = 1; i <= maxPhaseId; i++) {
      if (!phaseIds.has(i)) {
        warnings.push({
          type: 'optimization-opportunity',
          message: `Missing phase ID ${i} (gap in sequence)`,
          suggestion: 'Consider renumbering phases to remove gaps',
        });
      }
    }

    // Validate phase sequencing (ensure phases are logically ordered)
    this.validatePhaseSequencing(prd, errors, warnings);

    // Check for circular dependencies in phase ordering
    this.validateCircularDependencies(prd, errors);
  }

  /**
   * Validate phase sequencing (ensure phases are logically ordered)
   */
  private validatePhaseSequencing(
    prd: ParsedPlanningDoc,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!prd.phases || prd.phases.length === 0) {
      return;
    }

    // Check that phases are in logical order (phase N should generally come before phase N+1)
    const phases = prd.phases.sort((a, b) => a.id - b.id);
    
    for (let i = 0; i < phases.length - 1; i++) {
      const currentPhase = phases[i];
      const nextPhase = phases[i + 1];

      // If current phase depends on a future phase, that's a sequencing issue
      if (currentPhase.dependsOn && currentPhase.dependsOn.some(depId => depId > currentPhase.id)) {
        const futureDeps = currentPhase.dependsOn.filter(depId => depId > currentPhase.id);
        warnings.push({
          type: 'optimization-opportunity',
          message: `Phase ${currentPhase.id} depends on future phase(s) ${futureDeps.join(', ')} - consider reordering`,
          phase: currentPhase.id,
          suggestion: 'Ensure phases are ordered logically (earlier phases should not depend on later phases)',
        });
      }

      // If phases are out of order based on IDs, warn
      if (currentPhase.id > nextPhase.id) {
        warnings.push({
          type: 'optimization-opportunity',
          message: `Phases are not in sequential order (phase ${currentPhase.id} comes before ${nextPhase.id})`,
          phase: currentPhase.id,
          suggestion: 'Reorder phases so phase IDs are sequential (1, 2, 3, ...)',
        });
      }
    }
  }

  /**
   * Check for circular dependencies in phase ordering
   */
  private validateCircularDependencies(
    prd: ParsedPlanningDoc,
    errors: ValidationError[]
  ): void {
    if (!prd.phases || prd.phases.length === 0) {
      return;
    }

    // Build dependency graph
    const dependencyGraph = new Map<number, Set<number>>();
    for (const phase of prd.phases) {
      dependencyGraph.set(phase.id, new Set(phase.dependsOn || []));
    }

    // Check for circular dependencies using DFS
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const hasCycle = (phaseId: number): boolean => {
      if (recursionStack.has(phaseId)) {
        return true; // Circular dependency detected
      }

      if (visited.has(phaseId)) {
        return false; // Already processed, no cycle from this node
      }

      visited.add(phaseId);
      recursionStack.add(phaseId);

      const deps = dependencyGraph.get(phaseId) || new Set();
      for (const depId of deps) {
        if (hasCycle(depId)) {
          return true;
        }
      }

      recursionStack.delete(phaseId);
      return false;
    };

    // Check each phase for cycles
    for (const phase of prd.phases) {
      visited.clear();
      recursionStack.clear();
      
      if (hasCycle(phase.id)) {
        errors.push({
          type: 'invalid-structure',
          severity: 'critical',
          message: `Circular dependency detected in phase dependencies (phase ${phase.id} is part of a cycle)`,
          phase: phase.id,
          suggestion: 'Remove circular dependencies - phase dependencies must form a directed acyclic graph (DAG)',
        });
        break; // One cycle is enough to invalidate the PRD
      }
    }

    // Also check task dependencies for cycles within phases
    for (const phase of prd.phases) {
      if (!phase.tasks || phase.tasks.length === 0) {
        continue;
      }

      const taskGraph = new Map<string, Set<string>>();
      for (const task of phase.tasks) {
        taskGraph.set(task.id, new Set(task.dependencies || []));
      }

      const taskVisited = new Set<string>();
      const taskRecursionStack = new Set<string>();

      const hasTaskCycle = (taskId: string): boolean => {
        if (taskRecursionStack.has(taskId)) {
          return true;
        }

        if (taskVisited.has(taskId)) {
          return false;
        }

        taskVisited.add(taskId);
        taskRecursionStack.add(taskId);

        const taskDeps = taskGraph.get(taskId) || new Set();
        for (const depTaskId of taskDeps) {
          if (hasTaskCycle(depTaskId)) {
            return true;
          }
        }

        taskRecursionStack.delete(taskId);
        return false;
      };

      for (const task of phase.tasks) {
        taskVisited.clear();
        taskRecursionStack.clear();
        
        if (hasTaskCycle(task.id)) {
          errors.push({
            type: 'invalid-structure',
            severity: 'critical',
            message: `Circular dependency detected in task dependencies within phase ${phase.id} (task ${task.id} is part of a cycle)`,
            phase: phase.id,
            task: task.id,
            suggestion: 'Remove circular task dependencies - task dependencies must form a directed acyclic graph (DAG)',
          });
          break; // One cycle is enough
        }
      }
    }
  }

  /**
   * Validate enhancements
   */
  private validateEnhancements(
    enhancements: {
      schemas?: SchemaEnhancementResult;
      tests?: TestPlanningResult;
      features?: FeatureEnhancementResult;
    },
    errors: ValidationError[],
    warnings: ValidationWarning[],
    prd?: ParsedPlanningDoc
  ): void {
    // Validate schema enhancements
    if (enhancements.schemas) {
      if (enhancements.schemas.schemas.length === 0) {
        warnings.push({
          type: 'missing-optional',
          message: 'No schema enhancements generated',
          suggestion: 'Consider adding schema definitions for better type safety',
        });
      } else if (enhancements.schemas.confidence < 0.5) {
        warnings.push({
          type: 'optimization-opportunity',
          message: `Low confidence in schema enhancements (${Math.round(enhancements.schemas.confidence * 100)}%)`,
          suggestion: 'Review generated schemas and refine based on codebase patterns',
        });
      }

      // Validate that schema references are valid (check relatedSchemas)
      for (const schema of enhancements.schemas.schemas || []) {
        if (schema.relatedSchemas && schema.relatedSchemas.length > 0) {
          const validSchemaIds = new Set(enhancements.schemas.schemas.map(s => s.id));
          for (const relatedSchemaId of schema.relatedSchemas) {
            if (!validSchemaIds.has(relatedSchemaId)) {
              warnings.push({
                type: 'optimization-opportunity',
                message: `Schema ${schema.id} references non-existent schema: ${relatedSchemaId}`,
                suggestion: 'Remove invalid schema reference or add missing schema',
              });
            }
          }
        }
      }
    } else {
      warnings.push({
        type: 'missing-optional',
        message: 'Schema enhancements not provided',
        suggestion: 'Consider running schema enhancement to improve PRD quality',
      });
    }

    // Validate test planning
    if (enhancements.tests) {
      const coverage = enhancements.tests.coverage;
      if (coverage.coveragePercentage < 100) {
        warnings.push({
          type: 'optimization-opportunity',
          message: `Test coverage is ${coverage.coveragePercentage}% (${coverage.tasksWithTests}/${coverage.totalTasks} tasks have tests)`,
          suggestion: 'Generate test plans for all tasks to achieve 100% coverage',
        });
      }

      if (coverage.coveragePercentage < 50) {
        errors.push({
          type: 'missing-test',
          severity: 'high',
          message: `Low test coverage: ${coverage.coveragePercentage}%`,
          suggestion: 'Generate test plans for at least 50% of tasks',
        });
      }

      // Validate that all test plans reference valid tasks
      if (prd && enhancements.tests.testPlans) {
        const allTaskIds = new Set<string>();
        for (const phase of prd.phases) {
          if (phase.tasks) {
            for (const task of phase.tasks) {
              allTaskIds.add(task.id);
            }
          }
        }

        for (const testPlan of enhancements.tests.testPlans) {
          if (testPlan.taskId && !allTaskIds.has(testPlan.taskId)) {
            errors.push({
              type: 'invalid-structure',
              severity: 'high',
              message: `Test plan references non-existent task: ${testPlan.taskId}`,
              suggestion: 'Remove invalid task reference or add missing task',
            });
          }

          // Validate test plan dependencies
          if (testPlan.dependencies) {
            for (const depTaskId of testPlan.dependencies) {
              if (!allTaskIds.has(depTaskId)) {
                errors.push({
                  type: 'invalid-structure',
                  severity: 'medium',
                  message: `Test plan for task ${testPlan.taskId} depends on non-existent task: ${depTaskId}`,
                  suggestion: 'Remove invalid dependency or add missing task',
                });
              }
            }
          }
        }
      }
    } else {
      warnings.push({
        type: 'missing-optional',
        message: 'Test planning not provided',
        suggestion: 'Consider running test planning to improve PRD quality',
      });
    }

    // Validate feature enhancements
    if (enhancements.features) {
      if (enhancements.features.enhancements.length === 0) {
        warnings.push({
          type: 'missing-optional',
          message: 'No feature enhancements generated',
          suggestion: 'Consider adding feature configurations for better dev-loop integration',
        });
      }
    }
  }

  /**
   * Validate dependencies
   */
  private validateDependencies(
    prd: ParsedPlanningDoc,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (prd.dependencies) {
      // Validate external modules
      if (prd.dependencies.externalModules) {
        for (const module of prd.dependencies.externalModules) {
          if (!module || module.trim().length === 0) {
            warnings.push({
              type: 'optimization-opportunity',
              message: 'Empty external module dependency',
              suggestion: 'Remove empty dependency or specify module name',
            });
          }
        }
      }

      // Validate PRD dependencies
      if (prd.dependencies.prds) {
        for (const prdDep of prd.dependencies.prds) {
          if (!prdDep || (typeof prdDep === 'string' && prdDep.trim().length === 0)) {
            warnings.push({
              type: 'optimization-opportunity',
              message: 'Empty PRD dependency',
              suggestion: 'Remove empty dependency or specify PRD ID',
            });
          }
        }
      }

      // Validate code requirements
      if (prd.dependencies.codeRequirements) {
        for (const req of prd.dependencies.codeRequirements) {
          if (!req || req.trim().length === 0) {
            warnings.push({
              type: 'optimization-opportunity',
              message: 'Empty code requirement',
              suggestion: 'Remove empty requirement or specify requirement',
            });
          }
        }
      }
    }
  }

  /**
   * Validate testing configuration
   */
  private validateTestingConfig(
    prd: ParsedPlanningDoc,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!prd.testing) {
      warnings.push({
        type: 'missing-optional',
        message: 'PRD is missing testing configuration',
        suggestion: 'Add testing configuration (directory, runner, command) to PRD',
      });
      return;
    }

    // Check required testing fields
    if (!prd.testing.directory || prd.testing.directory.trim().length === 0) {
      errors.push({
        type: 'invalid-config',
        severity: 'high',
        message: 'Testing directory is required',
        suggestion: 'Add testing.directory to PRD configuration',
      });
    }

    // Check test runner/framework configuration
    const testingWithFramework = prd.testing as any;
    // Check for incorrect 'runner' field at top level (should be in testing section)
    if (testingWithFramework.runner && !testingWithFramework.framework) {
      warnings.push({
        type: 'optimization-opportunity',
        message: 'Testing configuration uses "runner" field - should use "framework" and "runner" structure',
        suggestion: 'Update testing configuration: framework from project config, runner from testing.runner',
      });
    }

    // Check that framework is set (if project config has framework)
    if (!testingWithFramework.framework) {
      warnings.push({
        type: 'missing-optional',
        message: 'Testing framework not specified',
        suggestion: 'Add testing.framework from project config (e.g., "drupal")',
      });
    }

    // Check test runner (warning if missing)
    if (!prd.testing.runner) {
      warnings.push({
        type: 'missing-optional',
        message: 'Test runner not specified',
        suggestion: 'Add testing.runner (playwright, cypress, jest, etc.) to PRD configuration',
      });
    }

    // Check test command (warning if missing)
    if (!prd.testing.command) {
      warnings.push({
        type: 'missing-optional',
        message: 'Test command not specified',
        suggestion: 'Add testing.command (e.g., "npx playwright test") to PRD configuration',
      });
    }
  }

  /**
   * Calculate executability score (0-100)
   */
  private calculateScore(
    prd: ParsedPlanningDoc,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    enhancements?: {
      schemas?: SchemaEnhancementResult;
      tests?: TestPlanningResult;
      features?: FeatureEnhancementResult;
    }
  ): number {
    let score = 100;

    // Deduct points for errors
    for (const error of errors) {
      switch (error.severity) {
        case 'critical':
          score -= 20;
          break;
        case 'high':
          score -= 10;
          break;
        case 'medium':
          score -= 5;
          break;
        case 'low':
          score -= 2;
          break;
      }
    }

    // Deduct points for warnings (if strict mode)
    if (this.config.strict) {
      for (const warning of warnings) {
        score -= 2;
      }
    }

    // Add points for enhancements
    if (enhancements) {
      if (enhancements.schemas && enhancements.schemas.schemas.length > 0) {
        score += Math.min(enhancements.schemas.schemas.length * 2, 10); // Up to 10 points
      }
      if (enhancements.tests && enhancements.tests.coverage.coveragePercentage >= 80) {
        score += 10; // Bonus for good test coverage
      }
      if (enhancements.features && enhancements.features.enhancements.length > 0) {
        score += Math.min(enhancements.features.enhancements.length * 2, 5); // Up to 5 points
      }
    }

    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Generate validation summary
   */
  private generateSummary(
    errors: ValidationError[],
    warnings: ValidationWarning[],
    score: number,
    executable: boolean
  ): string {
    const parts: string[] = [];

    parts.push(`Executability Score: ${score}/100`);
    parts.push(`Status: ${executable ? 'EXECUTABLE' : 'NOT EXECUTABLE'}`);
    parts.push('');

    if (errors.length === 0 && warnings.length === 0) {
      parts.push('✓ PRD set is 100% executable and ready for dev-loop execution.');
      return parts.join('\n');
    }

    // Error summary
    if (errors.length > 0) {
      parts.push(`Errors: ${errors.length}`);
      const bySeverity = new Map<string, number>();
      for (const error of errors) {
        bySeverity.set(error.severity, (bySeverity.get(error.severity) || 0) + 1);
      }
      for (const [severity, count] of bySeverity.entries()) {
        parts.push(`  - ${count} ${severity} severity error(s)`);
      }
      parts.push('');
    }

    // Warning summary
    if (warnings.length > 0) {
      parts.push(`Warnings: ${warnings.length}`);
      const byType = new Map<string, number>();
      for (const warning of warnings) {
        byType.set(warning.type, (byType.get(warning.type) || 0) + 1);
      }
      for (const [type, count] of byType.entries()) {
        parts.push(`  - ${count} ${type} warning(s)`);
      }
      parts.push('');
    }

    // Suggestions
    if (errors.length > 0 || warnings.length > 0) {
      parts.push('To make PRD set executable:');
      const criticalErrors = errors.filter(e => e.severity === 'critical');
      const highErrors = errors.filter(e => e.severity === 'high');
      
      if (criticalErrors.length > 0) {
        parts.push(`1. Fix ${criticalErrors.length} critical error(s) (required)`);
      }
      if (highErrors.length > 0) {
        parts.push(`2. Fix ${highErrors.length} high severity error(s) (recommended)`);
      }
      if (warnings.length > 0 && !this.config.strict) {
        parts.push(`3. Address ${warnings.length} warning(s) (optional but recommended)`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Check if PRD set is 100% executable
   */
  async isExecutable(
    prd: ParsedPlanningDoc | DiscoveredPrdSet,
    enhancements?: {
      schemas?: SchemaEnhancementResult;
      tests?: TestPlanningResult;
      features?: FeatureEnhancementResult;
    }
  ): Promise<boolean> {
    const result = await this.validateExecutability(prd, enhancements);
    // Require 100% score for executability
    return result.executable && result.score === 100;
  }

  /**
   * Detect ID pattern from task ID
   * @param taskId - Task ID (e.g., "REQ-1.1", "TASK-1")
   * @returns Detected pattern (e.g., "REQ-{id}", "TASK-{id}")
   */
  private detectPatternFromTaskId(taskId: string): string {
    // REQ-1.1 -> REQ-{id}
    // TASK-1 -> TASK-{id}
    const match = taskId.match(/^([A-Z]+)-/);
    if (match) {
      return `${match[1]}-{id}`;
    }
    return 'TASK-{id}'; // Default
  }
}
