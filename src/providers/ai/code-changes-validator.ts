/**
 * Code Changes Validator
 *
 * Unified validation for CodeChanges extraction from AI provider responses.
 * Provides a single interface for all providers to use, with schema-first validation
 * and fallback extraction methods.
 */

import { CodeChanges } from '../../types';
import { JsonSchemaValidator } from './json-schema-validator';
import { extractCodeChanges, JsonParsingContext } from './json-parser';

export interface ValidationResult {
  valid: boolean;
  codeChanges?: CodeChanges;
  method: 'schema' | 'fallback' | 'failed';
  errors?: string[];
}

/**
 * Unified validator for CodeChanges extraction
 *
 * Strategy:
 * 1. Try schema validation first (preferred, most robust)
 * 2. Fallback to extractCodeChanges (handles edge cases)
 * 3. Return validation result with method used
 */
export class CodeChangesValidator {
  /**
   * Validate and extract CodeChanges from a response
   *
   * @param response - The AI provider response (string or object)
   * @param context - Optional parsing context for debugging
   * @returns ValidationResult with codeChanges if valid
   */
  static validate(response: string | object, context?: JsonParsingContext): ValidationResult {
    const text = typeof response === 'string' ? response : JSON.stringify(response);

    // Strategy 1: Schema validation (preferred)
    const schemaResult = JsonSchemaValidator.extractAndValidate(text, true);
    if (schemaResult.valid && schemaResult.normalized) {
      return {
        valid: true,
        codeChanges: schemaResult.normalized,
        method: 'schema',
      };
    }

    // Strategy 2: Fallback extraction (handles edge cases)
    const extracted = extractCodeChanges(response, undefined, context);
    if (extracted) {
      return {
        valid: true,
        codeChanges: extracted,
        method: 'fallback',
      };
    }

    // Strategy 3: Failed
    return {
      valid: false,
      method: 'failed',
      errors: schemaResult.errors || ['Could not extract CodeChanges from response'],
    };
  }
}
