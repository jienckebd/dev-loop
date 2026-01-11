/**
 * PRD Set Enhancer
 *
 * Applies enhancements to existing PRD sets.
 * Preserves existing valid configurations and only adds missing elements.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { DiscoveredPrdSet } from '../set/discovery';
import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { Gap, GapAnalysisResult } from './gap-analyzer';
import { SchemaEnhancementResult } from '../refinement/schema-enhancer';
import { TestPlanningResult } from '../refinement/test-planner';
import { FeatureEnhancementResult } from '../refinement/feature-enhancer';
import { PlanningDocParser } from '../parser/planning-doc-parser';
import { logger } from '../../utils/logger';

/**
 * Enhancement Application Result
 */
export interface EnhancementApplicationResult {
  success: boolean;
  enhancedPrd: ParsedPlanningDoc;
  appliedEnhancements: {
    schemas?: SchemaEnhancementResult;
    tests?: TestPlanningResult;
    features?: FeatureEnhancementResult;
  };
  summary: string;
  errors: string[];
}

/**
 * PRD Set Enhancer Configuration
 */
export interface PrdSetEnhancerConfig {
  preserveExisting?: boolean; // Preserve existing valid configurations
  debug?: boolean;
}

/**
 * Applies enhancements to existing PRD sets
 */
export class PrdSetEnhancer {
  private config: Required<PrdSetEnhancerConfig>;
  private planningParser: PlanningDocParser;
  private debug: boolean;

  constructor(config: PrdSetEnhancerConfig = {}) {
    this.config = {
      preserveExisting: config.preserveExisting !== false, // Default to true
      debug: config.debug || false,
    };
    this.debug = this.config.debug;
    this.planningParser = new PlanningDocParser(this.debug);
  }

  /**
   * Apply enhancements to PRD set
   */
  async applyEnhancements(
    prdSet: DiscoveredPrdSet,
    gaps: Gap[],
    enhancements: {
      schemas?: SchemaEnhancementResult;
      tests?: TestPlanningResult;
      features?: FeatureEnhancementResult;
    }
  ): Promise<EnhancementApplicationResult> {
    logger.debug(`[PrdSetEnhancer] Applying enhancements to PRD set: ${prdSet.setId}`);

    const errors: string[] = [];
    let enhancedPrd: ParsedPlanningDoc;

    try {
      // Load existing PRD document (parse first PRD file)
      enhancedPrd = await this.loadPrdDocument(prdSet);

      // Apply schema enhancements
      if (enhancements.schemas) {
        enhancedPrd = await this.applySchemaEnhancements(enhancedPrd, enhancements.schemas, gaps);
      }

      // Apply test planning
      if (enhancements.tests) {
        enhancedPrd = await this.applyTestPlanning(enhancedPrd, enhancements.tests, gaps);
      }

      // Apply feature enhancements
      if (enhancements.features) {
        enhancedPrd = await this.applyFeatureEnhancements(enhancedPrd, enhancements.features, gaps);
      }

      // Generate summary
      const summary = this.generateSummary(enhancements, gaps);

      return {
        success: true,
        enhancedPrd,
        appliedEnhancements: enhancements,
        summary,
        errors: [],
      };
    } catch (error) {
      logger.error(`[PrdSetEnhancer] Failed to apply enhancements: ${error}`);
      errors.push(error instanceof Error ? error.message : String(error));

      return {
        success: false,
        enhancedPrd: await this.loadPrdDocument(prdSet).catch(() => ({
          prdId: prdSet.setId,
          version: '1.0.0',
          status: 'ready',
          title: prdSet.setId,
          phases: [],
          rawContent: '',
        })),
        appliedEnhancements: {},
        summary: 'Enhancement application failed',
        errors,
      };
    }
  }

  /**
   * Load PRD document from PRD set
   */
  private async loadPrdDocument(prdSet: DiscoveredPrdSet): Promise<ParsedPlanningDoc> {
    // Try to load the main PRD file (first PRD in set)
    if (prdSet.prdSet.prds && prdSet.prdSet.prds.length > 0) {
      const firstPrd = prdSet.prdSet.prds[0];
      const prdPath = path.resolve(prdSet.directory, firstPrd.path);

      if (await fs.pathExists(prdPath)) {
        try {
          return await this.planningParser.parse(prdPath);
        } catch (error) {
          logger.warn(`[PrdSetEnhancer] Failed to parse PRD file ${prdPath}: ${error}`);
        }
      }
    }

    // Fallback: parse index.md.yml if available
    if (await fs.pathExists(prdSet.indexPath)) {
      // Parse index file and construct basic PRD structure
      // This is a simplified version - full implementation would parse all PRD files
      const content = await fs.readFile(prdSet.indexPath, 'utf-8');
      return this.planningParser.parseContent(content, path.basename(prdSet.indexPath));
    }

    // Last resort: return empty structure
    return {
      prdId: prdSet.setId,
      version: '1.0.0',
      status: 'ready',
      title: prdSet.setId,
      phases: [],
      rawContent: '',
    };
  }

  /**
   * Apply schema enhancements to PRD
   */
  private async applySchemaEnhancements(
    prd: ParsedPlanningDoc,
    schemas: SchemaEnhancementResult,
    gaps: Gap[]
  ): Promise<ParsedPlanningDoc> {
    // Add schema definitions to PRD metadata
    // In a full implementation, we would add schema references to the PRD structure
    // For now, we'll add them to configOverlay

    if (!prd.configOverlay) {
      prd.configOverlay = {};
    }

    if (!prd.configOverlay.schemas) {
      prd.configOverlay.schemas = {};
    }

    // Add schema paths to config
    for (const schema of schemas.schemas) {
      (prd.configOverlay.schemas as any)[schema.id] = {
        path: schema.path,
        type: schema.type,
        description: schema.description,
      };
    }

    logger.debug(`[PrdSetEnhancer] Applied ${schemas.schemas.length} schema enhancement(s)`);

    return prd;
  }

  /**
   * Apply test planning to PRD
   */
  private async applyTestPlanning(
    prd: ParsedPlanningDoc,
    tests: TestPlanningResult,
    gaps: Gap[]
  ): Promise<ParsedPlanningDoc> {
    // Add test plans to PRD tasks
    const testPlanMap = new Map(tests.testPlans.map(plan => [plan.taskId, plan]));

    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        const testPlan = testPlanMap.get(task.id);
        if (testPlan) {
          // Add test strategy if missing
          if (!task.testStrategy) {
            task.testStrategy = `${testPlan.testType} tests using ${testPlan.testRunner || 'playwright'}`;
          }

          // Add validation checklist if missing
          if (!task.validationChecklist || task.validationChecklist.length === 0) {
            task.validationChecklist = testPlan.testCases
              .flatMap(tc => tc.validationChecklist || [])
              .filter((item, index, arr) => arr.indexOf(item) === index); // Remove duplicates
          }

          // Add test file reference if missing
          if (testPlan.testFile && (!task.files || !task.files.includes(testPlan.testFile))) {
            if (!task.files) {
              task.files = [];
            }
            task.files.push(testPlan.testFile);
          }
        }
      }
    }

    logger.debug(`[PrdSetEnhancer] Applied ${tests.testPlans.length} test plan(s)`);

    return prd;
  }

  /**
   * Apply feature enhancements to PRD
   */
  private async applyFeatureEnhancements(
    prd: ParsedPlanningDoc,
    features: FeatureEnhancementResult,
    gaps: Gap[]
  ): Promise<ParsedPlanningDoc> {
    // Merge feature enhancements into PRD configOverlay
    if (!prd.configOverlay) {
      prd.configOverlay = {};
    }

    for (const enhancement of features.enhancements) {
      // Merge enhancement config into PRD configOverlay
      prd.configOverlay = this.mergeConfig(prd.configOverlay, enhancement.config);
    }

    logger.debug(`[PrdSetEnhancer] Applied ${features.enhancements.length} feature enhancement(s)`);

    return prd;
  }

  /**
   * Merge config objects (deep merge, preserving existing values if preserveExisting is true)
   */
  private mergeConfig(
    existing: Record<string, any>,
    newConfig: Record<string, any>
  ): Record<string, any> {
    const merged = { ...existing };

    for (const [key, value] of Object.entries(newConfig)) {
      if (this.config.preserveExisting && existing[key] !== undefined) {
        // Preserve existing value if it's already set
        continue;
      }

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Deep merge objects
        merged[key] = this.mergeConfig(existing[key] || {}, value);
      } else {
        // Overwrite with new value
        merged[key] = value;
      }
    }

    return merged;
  }

  /**
   * Generate summary
   */
  private generateSummary(
    enhancements: {
      schemas?: SchemaEnhancementResult;
      tests?: TestPlanningResult;
      features?: FeatureEnhancementResult;
    },
    gaps: Gap[]
  ): string {
    const parts: string[] = [];

    parts.push('Enhancement Application Summary:');
    parts.push('');

    if (enhancements.schemas) {
      parts.push(`Schema Enhancements: ${enhancements.schemas.schemas.length} schema(s) applied`);
    }

    if (enhancements.tests) {
      parts.push(`Test Planning: ${enhancements.tests.testPlans.length} test plan(s) applied`);
      parts.push(`  Test Coverage: ${enhancements.tests.coverage.coveragePercentage}%`);
    }

    if (enhancements.features) {
      parts.push(`Feature Enhancements: ${enhancements.features.enhancements.length} enhancement(s) applied`);
    }

    parts.push('');
    parts.push(`Gaps Addressed: ${gaps.length} gap(s)`);

    return parts.join('\n');
  }
}
