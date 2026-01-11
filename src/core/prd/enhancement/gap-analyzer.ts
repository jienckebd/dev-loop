/**
 * Gap Analyzer
 *
 * Analyzes existing PRD set for missing elements.
 * Detects gaps in schemas, tests, config, incomplete phases, and missing validation.
 */

import { DiscoveredPrdSet } from '../set/discovery';
import { PrdSet } from '../coordination/coordinator';
import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureTypeDetector } from '../../analysis/feature-type-detector';
import { logger } from '../../utils/logger';

/**
 * Gap Type
 */
export type GapType =
  | 'missing-schema'
  | 'missing-test'
  | 'missing-config'
  | 'incomplete-phase'
  | 'missing-validation'
  | 'missing-feature-config'
  | 'missing-dependency'
  | 'incomplete-task';

/**
 * Gap Analysis Result
 */
export interface GapAnalysisResult {
  gaps: Gap[];
  summary: string;
  totalGaps: number;
  criticalGaps: number;
  highPriorityGaps: number;
}

/**
 * Gap
 */
export interface Gap {
  type: GapType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
  affectedPhase?: number;
  affectedRequirement?: string;
  affectedTask?: string;
  evidence?: string[]; // Evidence for why this gap exists
}

/**
 * Gap Analyzer Configuration
 */
export interface GapAnalyzerConfig {
  projectRoot: string;
  codebaseAnalysis: CodebaseAnalysisResult;
  featureTypeDetector?: FeatureTypeDetector;
  debug?: boolean;
}

/**
 * Analyzes PRD set for gaps
 */
export class GapAnalyzer {
  private config: GapAnalyzerConfig;
  private debug: boolean;

  constructor(config: GapAnalyzerConfig) {
    this.config = config;
    this.debug = config.debug || false;
  }

  /**
   * Analyze PRD set for gaps
   */
  async analyzeGaps(
    prdSet: DiscoveredPrdSet | PrdSet,
    context?: {
      parsedDoc?: ParsedPlanningDoc;
      existingSchemas?: string[];
      existingTests?: string[];
    }
  ): Promise<GapAnalysisResult> {
    logger.debug(`[GapAnalyzer] Analyzing PRD set for gaps`);

    const gaps: Gap[] = [];

    // Get PRD structure
    const parsedDoc = context?.parsedDoc || (await this.loadParsedDoc(prdSet));

    // 1. Detect missing schemas
    const schemaGaps = await this.detectMissingSchemas(parsedDoc, context);
    gaps.push(...schemaGaps);

    // 2. Detect missing tests
    const testGaps = await this.detectMissingTests(parsedDoc, context);
    gaps.push(...testGaps);

    // 3. Detect missing config
    const configGaps = await this.detectMissingConfig(parsedDoc);
    gaps.push(...configGaps);

    // 4. Detect incomplete phases
    const phaseGaps = await this.detectIncompletePhases(parsedDoc);
    gaps.push(...phaseGaps);

    // 5. Detect missing validation
    const validationGaps = await this.detectMissingValidation(parsedDoc);
    gaps.push(...validationGaps);

    // 6. Detect missing feature config
    const featureConfigGaps = await this.detectMissingFeatureConfig(parsedDoc);
    gaps.push(...featureConfigGaps);

    // 7. Detect missing dependencies
    const dependencyGaps = await this.detectMissingDependencies(parsedDoc);
    gaps.push(...dependencyGaps);

    // 8. Detect incomplete tasks
    const taskGaps = await this.detectIncompleteTasks(parsedDoc);
    gaps.push(...taskGaps);

    // Calculate summary
    const totalGaps = gaps.length;
    const criticalGaps = gaps.filter(g => g.severity === 'critical').length;
    const highPriorityGaps = gaps.filter(g => g.severity === 'critical' || g.severity === 'high').length;
    const summary = this.generateSummary(gaps, totalGaps, criticalGaps, highPriorityGaps);

    logger.debug(`[GapAnalyzer] Found ${totalGaps} gap(s): ${criticalGaps} critical, ${highPriorityGaps - criticalGaps} high`);

    return {
      gaps,
      summary,
      totalGaps,
      criticalGaps,
      highPriorityGaps,
    };
  }

  /**
   * Load parsed PRD document from PRD set
   */
  private async loadParsedDoc(prdSet: DiscoveredPrdSet | PrdSet): Promise<ParsedPlanningDoc> {
    // This is a simplified version - in a full implementation, we'd parse the actual PRD files
    // For now, return a basic structure
    if ('prdSet' in prdSet) {
      // DiscoveredPrdSet
      return {
        prdId: prdSet.setId,
        version: '1.0.0',
        status: 'ready',
        title: prdSet.setId,
        phases: [],
        rawContent: '',
      };
    }

    // PrdSet - would need to parse individual PRD files
    return {
      prdId: 'unknown',
      version: '1.0.0',
      status: 'ready',
      title: 'Unknown',
      phases: [],
      rawContent: '',
    };
  }

  /**
   * Detect missing schemas
   */
  private async detectMissingSchemas(
    prd: ParsedPlanningDoc,
    context?: {
      existingSchemas?: string[];
    }
  ): Promise<Gap[]> {
    const gaps: Gap[] = [];
    const existingSchemas = new Set(context?.existingSchemas || []);

    // Analyze PRD requirements for schema needs
    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        const taskText = `${task.title} ${task.description}`.toLowerCase();

        // Check if task needs a schema
        const needsSchema =
          taskText.includes('config') ||
          taskText.includes('configuration') ||
          taskText.includes('schema') ||
          taskText.includes('entity') ||
          taskText.includes('model');

        if (needsSchema) {
          // Check if schema already exists (simple check - could be enhanced)
          const schemaId = `${task.id}-schema`;
          if (!existingSchemas.has(schemaId) && !existingSchemas.has(task.id)) {
            gaps.push({
              type: 'missing-schema',
              severity: 'high',
              description: `Task "${task.title}" requires a schema definition but none exists`,
              recommendation: `Generate schema definition for ${task.id} based on requirements and codebase patterns`,
              affectedPhase: phase.id,
              affectedTask: task.id,
              affectedRequirement: task.id,
              evidence: [
                `Task description mentions: ${taskText.includes('config') ? 'config' : ''} ${taskText.includes('schema') ? 'schema' : ''} ${taskText.includes('entity') ? 'entity' : ''}`.trim(),
              ],
            });
          }
        }
      }
    }

    return gaps;
  }

  /**
   * Detect missing tests
   */
  private async detectMissingTests(
    prd: ParsedPlanningDoc,
    context?: {
      existingTests?: string[];
    }
  ): Promise<Gap[]> {
    const gaps: Gap[] = [];
    const existingTests = new Set(context?.existingTests || []);

    // Analyze PRD requirements for test needs
    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        // Check if test already exists (simple check - could be enhanced)
        const testId = `test-${task.id}`;
        if (!existingTests.has(testId) && !existingTests.has(task.id)) {
          // Check if task has test strategy
          if (!task.testStrategy) {
            gaps.push({
              type: 'missing-test',
              severity: 'high',
              description: `Task "${task.title}" has no test plan or test strategy`,
              recommendation: `Generate test plan for ${task.id} including test cases, steps, and expected results`,
              affectedPhase: phase.id,
              affectedTask: task.id,
              affectedRequirement: task.id,
              evidence: [
                'Task has no testStrategy specified',
                'No test plan found for this task',
              ],
            });
          } else if (!task.validationChecklist || task.validationChecklist.length === 0) {
            gaps.push({
              type: 'missing-test',
              severity: 'medium',
              description: `Task "${task.title}" has test strategy but no validation checklist`,
              recommendation: `Add validation checklist to task ${task.id} for better test coverage`,
              affectedPhase: phase.id,
              affectedTask: task.id,
              affectedRequirement: task.id,
              evidence: ['Task has testStrategy but no validationChecklist'],
            });
          }
        }
      }
    }

    return gaps;
  }

  /**
   * Detect missing config
   */
  private async detectMissingConfig(prd: ParsedPlanningDoc): Promise<Gap[]> {
    const gaps: Gap[] = [];

    // Check for missing config overlay
    if (!prd.configOverlay || Object.keys(prd.configOverlay).length === 0) {
      gaps.push({
        type: 'missing-config',
        severity: 'medium',
        description: 'PRD is missing config overlay',
        recommendation: 'Add config overlay to PRD for framework-specific configuration',
        evidence: ['No configOverlay found in PRD'],
      });
    }

    // Check for missing testing config
    if (!prd.testing) {
      gaps.push({
        type: 'missing-config',
        severity: 'high',
        description: 'PRD is missing testing configuration',
        recommendation: 'Add testing configuration (directory, runner, command) to PRD',
        evidence: ['No testing configuration found in PRD'],
      });
    } else {
      if (!prd.testing.directory) {
        gaps.push({
          type: 'missing-config',
          severity: 'high',
          description: 'PRD testing configuration is missing directory',
          recommendation: 'Add testing.directory to PRD configuration',
          evidence: ['testing.directory is missing'],
        });
      }
    }

    return gaps;
  }

  /**
   * Detect incomplete phases
   */
  private async detectIncompletePhases(prd: ParsedPlanningDoc): Promise<Gap[]> {
    const gaps: Gap[] = [];

    if (!prd.phases || prd.phases.length === 0) {
      gaps.push({
        type: 'incomplete-phase',
        severity: 'critical',
        description: 'PRD has no phases',
        recommendation: 'Add at least one phase to the PRD',
      });
      return gaps;
    }

    for (const phase of prd.phases) {
      // Check for phases without tasks
      if (!phase.tasks || phase.tasks.length === 0) {
        gaps.push({
          type: 'incomplete-phase',
          severity: 'high',
          description: `Phase ${phase.id} "${phase.name}" has no tasks`,
          recommendation: `Add tasks to phase ${phase.id} or remove phase if not needed`,
          affectedPhase: phase.id,
          evidence: ['Phase has no tasks defined'],
        });
      }

      // Check for phases without description
      if (!phase.description || phase.description.trim().length === 0) {
        gaps.push({
          type: 'incomplete-phase',
          severity: 'medium',
          description: `Phase ${phase.id} "${phase.name}" is missing description`,
          recommendation: `Add description to phase ${phase.id} for better context`,
          affectedPhase: phase.id,
        });
      }

      // Check for invalid phase dependencies
      if (phase.dependsOn && phase.dependsOn.length > 0) {
        const validPhaseIds = new Set(prd.phases.map(p => p.id));
        for (const depId of phase.dependsOn) {
          if (!validPhaseIds.has(depId)) {
            gaps.push({
              type: 'missing-dependency',
              severity: 'high',
              description: `Phase ${phase.id} depends on non-existent phase ${depId}`,
              recommendation: `Remove invalid dependency or add missing phase ${depId}`,
              affectedPhase: phase.id,
              evidence: [`Phase ${depId} does not exist`],
            });
          }
        }
      }
    }

    return gaps;
  }

  /**
   * Detect missing validation
   */
  private async detectMissingValidation(prd: ParsedPlanningDoc): Promise<Gap[]> {
    const gaps: Gap[] = [];

    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        // Check for missing validation checklist
        if (!task.validationChecklist || task.validationChecklist.length === 0) {
          gaps.push({
            type: 'missing-validation',
            severity: 'medium',
            description: `Task "${task.title}" is missing validation checklist`,
            recommendation: `Add validation checklist to task ${task.id} for better validation coverage`,
            affectedPhase: phase.id,
            affectedTask: task.id,
          });
        }
      }
    }

    return gaps;
  }

  /**
   * Detect missing feature config
   */
  private async detectMissingFeatureConfig(prd: ParsedPlanningDoc): Promise<Gap[]> {
    const gaps: Gap[] = [];

    // Check if PRD has feature-specific configuration
    const hasErrorGuidance = prd.configOverlay?.framework?.errorGuidance;
    const hasContextFiles = prd.configOverlay?.codebase?.contextFiles;

    if (!hasErrorGuidance) {
      gaps.push({
        type: 'missing-feature-config',
        severity: 'low',
        description: 'PRD is missing error guidance configuration',
        recommendation: 'Add error guidance patterns to framework config for better error handling',
      });
    }

    if (!hasContextFiles) {
      gaps.push({
        type: 'missing-feature-config',
        severity: 'low',
        description: 'PRD is missing context file patterns',
        recommendation: 'Add context file patterns to codebase config for better AI context',
      });
    }

    return gaps;
  }

  /**
   * Detect missing dependencies
   */
  private async detectMissingDependencies(prd: ParsedPlanningDoc): Promise<Gap[]> {
    const gaps: Gap[] = [];

    if (prd.dependencies) {
      // Check external modules
      if (prd.dependencies.externalModules) {
        for (const module of prd.dependencies.externalModules) {
          if (!module || module.trim().length === 0) {
            gaps.push({
              type: 'missing-dependency',
              severity: 'low',
              description: 'Empty external module dependency',
              recommendation: 'Remove empty dependency or specify module name',
            });
          }
        }
      }

      // Check PRD dependencies (would need PRD set context to validate)
      if (prd.dependencies.prds) {
        for (const prdDep of prd.dependencies.prds) {
          if (!prdDep || (typeof prdDep === 'string' && prdDep.trim().length === 0)) {
            gaps.push({
              type: 'missing-dependency',
              severity: 'medium',
              description: 'Empty PRD dependency',
              recommendation: 'Remove empty dependency or specify PRD ID',
            });
          }
        }
      }
    }

    return gaps;
  }

  /**
   * Detect incomplete tasks
   */
  private async detectIncompleteTasks(prd: ParsedPlanningDoc): Promise<Gap[]> {
    const gaps: Gap[] = [];

    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        // Check for missing task title
        if (!task.title || task.title.trim().length === 0) {
          gaps.push({
            type: 'incomplete-task',
            severity: 'critical',
            description: `Task ${task.id} is missing a title`,
            recommendation: `Add title to task ${task.id}`,
            affectedPhase: phase.id,
            affectedTask: task.id,
          });
        }

        // Check for missing task description
        if (!task.description || task.description.trim().length === 0) {
          gaps.push({
            type: 'incomplete-task',
            severity: 'high',
            description: `Task ${task.id} is missing a description`,
            recommendation: `Add description to task ${task.id}`,
            affectedPhase: phase.id,
            affectedTask: task.id,
          });
        }

        // Check for invalid task dependencies
        if (task.dependencies && task.dependencies.length > 0) {
          const allTaskIds = new Set<string>();
          for (const p of prd.phases) {
            if (p.tasks) {
              for (const t of p.tasks) {
                allTaskIds.add(t.id);
              }
            }
          }

          for (const depId of task.dependencies) {
            if (!allTaskIds.has(depId)) {
              gaps.push({
                type: 'missing-dependency',
                severity: 'high',
                description: `Task ${task.id} depends on non-existent task ${depId}`,
                recommendation: `Remove invalid dependency or add missing task ${depId}`,
                affectedPhase: phase.id,
                affectedTask: task.id,
                evidence: [`Task ${depId} does not exist`],
              });
            }
          }
        }
      }
    }

    return gaps;
  }

  /**
   * Generate summary
   */
  private generateSummary(
    gaps: Gap[],
    totalGaps: number,
    criticalGaps: number,
    highPriorityGaps: number
  ): string {
    const parts: string[] = [];

    parts.push(`Gap Analysis Summary: ${totalGaps} gap(s) found`);
    parts.push(`  - ${criticalGaps} critical gap(s)`);
    parts.push(`  - ${highPriorityGaps - criticalGaps} high priority gap(s)`);
    parts.push(`  - ${totalGaps - highPriorityGaps} medium/low priority gap(s)`);
    parts.push('');

    // Group by type
    const byType = new Map<GapType, number>();
    for (const gap of gaps) {
      byType.set(gap.type, (byType.get(gap.type) || 0) + 1);
    }

    parts.push('Gaps by type:');
    for (const [type, count] of byType.entries()) {
      parts.push(`  - ${count} ${type} gap(s)`);
    }

    parts.push('');
    parts.push('Recommendations:');
    if (criticalGaps > 0) {
      parts.push(`  - Fix ${criticalGaps} critical gap(s) (required for executability)`);
    }
    if (highPriorityGaps - criticalGaps > 0) {
      parts.push(`  - Address ${highPriorityGaps - criticalGaps} high priority gap(s) (recommended)`);
    }
    if (totalGaps - highPriorityGaps > 0) {
      parts.push(`  - Consider addressing ${totalGaps - highPriorityGaps} medium/low priority gap(s) (optional)`);
    }

    return parts.join('\n');
  }

  /**
   * Get gaps by type
   */
  getGapsByType(gaps: Gap[], type: GapType): Gap[] {
    return gaps.filter(gap => gap.type === type);
  }

  /**
   * Get gaps by severity
   */
  getGapsBySeverity(gaps: Gap[], severity: Gap['severity']): Gap[] {
    return gaps.filter(gap => gap.severity === severity);
  }
}
