/**
 * Spec-Kit Integration Utilities
 *
 * Shared utilities for spec-kit methodology integration.
 * Used by ConvertModeHandler and AIRefinementOrchestrator.
 */

import { Question } from '../../conversation/types';
import { logger } from '../../utils/logger';

/**
 * Result of filtering questions by confidence
 */
export interface AutoApplyResult<T extends Question> {
  /** Questions that were auto-applied (high confidence) */
  autoApplied: T[];
  /** Questions that need user prompting (low confidence) */
  needsPrompt: T[];
  /** Map of question ID to auto-applied answer */
  answers: Map<string, string>;
}

/**
 * Spec-kit configuration for auto-apply behavior
 */
export interface SpecKitConfig {
  /** Confidence threshold for auto-applying answers (default: 0.85) */
  autoAnswerThreshold?: number;
  /** Skip prompting for high-confidence answers (default: true) */
  skipIfHighConfidence?: boolean;
  /** Infer parallel execution from phase dependencies (default: true) */
  inferParallelFromDependencies?: boolean;
  /** Generate questions from constitution gaps (default: true) */
  constitutionDrivenQuestions?: boolean;
}

/**
 * Filter questions by confidence threshold and auto-apply high-confidence answers.
 * Shared between ConvertModeHandler and AIRefinementOrchestrator.
 *
 * @param questions - Array of questions with optional confidence scores
 * @param specKitConfig - Config from prdBuilding.specKit
 * @param logPrefix - Prefix for log messages (e.g., "[Refinement:schema]")
 * @returns Object with autoApplied questions, needsPrompt questions, and answers map
 */
export function filterAndAutoApply<T extends Question>(
  questions: T[],
  specKitConfig?: SpecKitConfig,
  logPrefix: string = '[SpecKit]'
): AutoApplyResult<T> {
  const threshold = specKitConfig?.autoAnswerThreshold ?? 0.85;
  const skipIfHigh = specKitConfig?.skipIfHighConfidence ?? true;

  const autoApplied: T[] = [];
  const needsPrompt: T[] = [];
  const answers = new Map<string, string>();

  for (const q of questions) {
    const conf = q.confidence ?? 0;
    if (conf >= threshold && skipIfHigh && q.inferredAnswer) {
      logger.info(`${logPrefix} Auto-applied: "${q.text}" → "${q.inferredAnswer}" (confidence: ${conf.toFixed(2)})`);
      autoApplied.push(q);
      answers.set(q.id, q.inferredAnswer);
    } else {
      needsPrompt.push(q);
    }
  }

  if (autoApplied.length > 0) {
    logger.info(`${logPrefix} Auto-applied ${autoApplied.length} answer(s), ${needsPrompt.length} need prompting`);
  }

  return { autoApplied, needsPrompt, answers };
}
