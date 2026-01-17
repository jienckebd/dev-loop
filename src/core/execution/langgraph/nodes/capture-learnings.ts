/**
 * Capture Learnings Node
 *
 * LangGraph node that captures learnings from the current iteration.
 * Implements Ralph's pattern of extracting insights after each iteration.
 */

import * as path from 'path';
import { CodeChanges } from '../../../../types';
import { WorkflowState, IterationLearning } from '../state';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';

export interface CaptureLearningsNodeConfig {
  config: Config;
  debug?: boolean;
}

/**
 * Create the capture learnings node function
 */
export function captureLearnings(nodeConfig: CaptureLearningsNodeConfig) {
  const { debug } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    try {
      if (debug) {
        logger.debug('[CaptureLearnings] Extracting learnings from iteration');
      }

      const learnings: IterationLearning[] = [];

      // Extract patterns from successful code generation
      if (state.codeChanges?.files?.length && state.testResult?.success) {
        const patterns = extractPatternsFromChanges(state.codeChanges, state.context);
        learnings.push(...patterns);
      }

      // Extract gotchas from failures
      if (state.error || state.testResult?.success === false) {
        const gotchas = extractGotchasFromFailure(state);
        learnings.push(...gotchas);
      }

      // Extract conventions from validation
      if (state.validationResult) {
        const conventions = extractConventions(state.validationResult);
        learnings.push(...conventions);
      }

      // Merge with existing learnings (from suggest-improvements)
      const allLearnings = [...(state.learnings || []), ...learnings];

      // Track files modified (accumulate from state)
      const filesModified = state.codeChanges?.files?.map(f => f.path) || [];

      // Determine final status
      const status = state.testResult?.success ? 'complete' : 'failed';

      if (debug) {
        logger.debug(`[CaptureLearnings] Captured ${learnings.length} learning(s)`);
      }

      return {
        status,
        learnings: allLearnings,
        filesModified,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CaptureLearnings] Error: ${errorMessage}`);

      // Don't fail the workflow for learning capture errors
      return {
        status: state.testResult?.success ? 'complete' : 'failed',
      };
    }
  };
}

/**
 * Extract patterns from successful code changes
 */
function extractPatternsFromChanges(
  changes: CodeChanges,
  context: any
): IterationLearning[] {
  const learnings: IterationLearning[] = [];

  for (const file of changes.files || []) {
    const content = file.content || '';
    const fileName = path.basename(file.path);

    // Detect service injection patterns in PHP
    if (file.path.endsWith('.php') && content.includes('__construct')) {
      const services = extractInjectedServices(content);
      if (services.length > 0) {
        learnings.push({
          type: 'pattern',
          name: `Service injection in ${fileName}`,
          guidance: `Uses services: ${services.join(', ')}`,
        });
      }
    }

    // Detect config schema patterns
    if (file.path.endsWith('.schema.yml')) {
      learnings.push({
        type: 'pattern',
        name: `Config schema for ${fileName.replace('.schema.yml', '')}`,
        guidance: 'Define schema before config form implementation',
      });
    }

    // Detect plugin patterns
    if (content.includes('@Plugin') || content.includes('#[Plugin')) {
      learnings.push({
        type: 'convention',
        name: 'Plugin annotation',
        guidance: 'Use Drupal plugin annotations for discovery',
      });
    }

    // Detect entity type patterns
    if (content.includes('EntityType') || content.includes('@ContentEntityType')) {
      learnings.push({
        type: 'pattern',
        name: 'Entity type definition',
        guidance: 'Use bd entity configuration files for entity types',
      });
    }
  }

  return learnings;
}

/**
 * Extract injected services from PHP constructor
 */
function extractInjectedServices(content: string): string[] {
  const services: string[] = [];

  // Match constructor parameter types
  const constructorMatch = content.match(/__construct\s*\([^)]+\)/s);
  if (constructorMatch) {
    const params = constructorMatch[0];
    // Match type hints
    const typeMatches = params.matchAll(/(\w+Interface|\w+Manager|\w+Factory|\w+Service)\s+\$/g);
    for (const match of typeMatches) {
      services.push(match[1]);
    }
  }

  return services;
}

/**
 * Extract gotchas from failures
 */
function extractGotchasFromFailure(state: WorkflowState): IterationLearning[] {
  const learnings: IterationLearning[] = [];
  const error = state.error || '';
  const testOutput = state.testResult?.output || '';
  const combined = `${error} ${testOutput}`;

  // Common gotcha patterns
  const gotchaPatterns = [
    {
      pattern: /class ['"]([^'"]+)['"] not found/i,
      name: 'Missing class dependency',
      guidance: 'Ensure all classes are properly imported and autoloaded',
    },
    {
      pattern: /undefined (method|property|variable)/i,
      name: 'Undefined reference',
      guidance: 'Check that all methods and properties are defined before use',
    },
    {
      pattern: /syntax error/i,
      name: 'Syntax error',
      guidance: 'Validate code syntax before committing changes',
    },
    {
      pattern: /permission denied/i,
      name: 'Permission error',
      guidance: 'Check file and directory permissions',
    },
    {
      pattern: /SQLSTATE\[/,
      name: 'Database error',
      guidance: 'Verify database schema and query syntax',
    },
    {
      pattern: /service.*not found/i,
      name: 'Missing service',
      guidance: 'Register services in *.services.yml before injection',
    },
  ];

  for (const { pattern, name, guidance } of gotchaPatterns) {
    if (pattern.test(combined)) {
      learnings.push({
        type: 'gotcha',
        name,
        guidance,
        evidence: combined.substring(0, 200),
      });
    }
  }

  return learnings;
}

/**
 * Extract conventions from validation results
 */
function extractConventions(
  validationResult: { errors: string[]; warnings: string[] }
): IterationLearning[] {
  const learnings: IterationLearning[] = [];

  // Learn from validation warnings
  for (const warning of validationResult.warnings || []) {
    if (warning.includes('deprecated')) {
      learnings.push({
        type: 'convention',
        name: 'Avoid deprecated code',
        guidance: warning,
      });
    }
    if (warning.includes('tab')) {
      learnings.push({
        type: 'convention',
        name: 'Use spaces not tabs',
        guidance: 'YAML and most code should use spaces for indentation',
      });
    }
  }

  return learnings;
}
