/**
 * JSON Parser for AI Provider Responses
 *
 * Handles extraction of CodeChanges from various AI provider response formats,
 * including recursively nested result objects from Cursor AI.
 */

import { CodeChanges } from '../../types';
import { ObservationTracker } from '../../core/tracking/observation-tracker';
import { logger } from '../../core/utils/logger';
import { JsonSchemaValidator } from './json-schema-validator';

export interface JsonParsingContext {
  providerName?: string;
  taskId?: string;
  prdId?: string;
  phaseId?: string | number;
  projectType?: string;
}

/**
 * Extract CodeChanges from various response formats
 *
 * Supports:
 * - Direct CodeChanges objects
 * - Text responses containing JSON (including markdown code blocks)
 * - Response objects with 'text' or 'result' fields
 *
 * @param response - The AI provider response (can be object or string)
 * @param observationTracker - Optional observation tracker for logging
 * @param context - Optional parsing context for debugging
 * @returns CodeChanges object or null if extraction fails
 */
export function extractCodeChanges(
  response: any,
  observationTracker?: ObservationTracker,
  context?: JsonParsingContext
): CodeChanges | null {
  if (!response) {
    return null;
  }

  // Convert response to text for schema validation
  let textToValidate: string = '';
  
  if (typeof response === 'string') {
    textToValidate = response;
  } else if (response && typeof response === 'object') {
    // Handle direct CodeChanges object
    if (response.files && Array.isArray(response.files)) {
      return response as CodeChanges;
    }
    
    // Extract text from common fields
    if (response.text && typeof response.text === 'string') {
      textToValidate = response.text;
    } else if (response.result && typeof response.result === 'string') {
      textToValidate = response.result;
    } else if (response.response && typeof response.response === 'string') {
      textToValidate = response.response;
    } else {
      // Convert object to JSON string for validation
      textToValidate = JSON.stringify(response);
    }
  }

  // Primary method: Use schema-based validation (handles markdown code blocks, escaped JSON, etc.)
  if (textToValidate) {
    try {
      const validationResult = JsonSchemaValidator.extractAndValidate(textToValidate);
      if (validationResult.valid && validationResult.normalized) {
        logger.info(`[json-parser] Successfully extracted CodeChanges using JSON Schema validation`);
        return validationResult.normalized;
      } else {
        // Log validation errors for debugging
        if (validationResult.errors.length > 0) {
          logger.debug(`[json-parser] Schema validation failed: ${validationResult.errors.join(', ')}`);
        }
      }
    } catch (error) {
      logger.debug(`[json-parser] Schema validation attempt failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Fallback: Use text parsing (extracts JSON from markdown code blocks)
  if (textToValidate) {
    return parseCodeChangesFromText(textToValidate, observationTracker, context);
  }

  return null;
}

/**
 * Parse CodeChanges from text response
 *
 * Extracts JSON from text, handling markdown code blocks.
 * Uses schema validator for robust extraction.
 *
 * @param text - Text containing JSON (may include markdown formatting)
 * @param observationTracker - Optional observation tracker for logging
 * @param context - Optional parsing context for debugging
 * @returns CodeChanges object or null if parsing fails
 */
export function parseCodeChangesFromText(
  text: string,
  observationTracker?: ObservationTracker,
  context?: JsonParsingContext
): CodeChanges | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // Use schema validator - it handles markdown code blocks, escaped JSON, etc.
  try {
    const validationResult = JsonSchemaValidator.extractAndValidate(text);
    if (validationResult.valid && validationResult.normalized) {
      logger.debug(`[json-parser] Successfully extracted CodeChanges from text using schema validation`);
      return validationResult.normalized;
    } else {
      // Enhanced error logging
      if (validationResult.errors.length > 0) {
        logger.debug(`[json-parser] Schema validation failed: ${validationResult.errors.join(', ')}`);
        if (validationResult.warnings.length > 0) {
          logger.debug(`[json-parser] Schema validation warnings: ${validationResult.warnings.join(', ')}`);
        }
      }
    }
  } catch (error) {
    logger.debug(`[json-parser] Schema validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Fallback: Try extracting from markdown code blocks manually
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed && parsed.files && Array.isArray(parsed.files)) {
        return parsed as CodeChanges;
      }
    } catch {
      // Not valid JSON
    }
  }

  // Final fallback: Try direct JSON parse
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.files && Array.isArray(parsed.files)) {
      return parsed as CodeChanges;
    }
  } catch (error) {
    // Enhanced error tracking with strategy information
    const extractionAttempts: string[] = [];
    
    // Try to get strategy information from validation result
    try {
      const validationResult = JsonSchemaValidator.extractAndValidate(text);
      if (!validationResult.valid) {
        extractionAttempts.push(`Validation errors: ${validationResult.errors.join(', ')}`);
      }
    } catch {
      // Could not get validation info
    }
    
    // Track parsing failure with detailed information
    if (observationTracker && context?.providerName) {
      const responseSample = text.substring(0, 1000);
      observationTracker.trackJsonParsingFailure(
        responseSample,
        extractionAttempts,
        context.projectType || 'unknown',
        context.providerName,
        context.taskId,
        context.prdId,
        typeof context.phaseId === 'number' ? context.phaseId : undefined
      ).catch(err => {
        logger.warn(`[json-parser] Failed to track observation: ${err}`);
      });
    } else {
      logger.warn(`[json-parser] Failed to parse JSON from text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return null;
}

/**
 * Check if AI fallback should be used for JSON parsing
 */
export function shouldUseAiFallback(response: any): boolean {
  // Use AI fallback if response is a string (text that might contain JSON) or has text/result fields
  return response && (typeof response === 'string' || response.text || response.result);
}

/**
 * Extract CodeChanges with AI fallback for complex cases
 */
export async function extractCodeChangesWithAiFallback(
  response: any,
  promptFunction: (prompt: string) => Promise<string>,
  context: JsonParsingContext
): Promise<CodeChanges | null> {
  // First try standard extraction
  const codeChanges = extractCodeChanges(response, undefined, context);
  if (codeChanges) {
    return codeChanges;
  }

  // If standard extraction fails, use AI to extract
  try {
    const extractionPrompt = `Extract the CodeChanges JSON from this response. Return ONLY valid JSON in this exact format:
{
  "files": [
    {
      "path": "path/to/file",
      "content": "file content",
      "operation": "create"
    }
  ],
  "summary": "description"
}

Response to extract from:
${typeof response === 'string' ? response : JSON.stringify(response, null, 2)}`;

    const aiResponse = await promptFunction(extractionPrompt);
    if (aiResponse) {
      return extractCodeChanges(aiResponse, undefined, context);
    }
  } catch (error) {
    logger.warn(`[json-parser] AI fallback failed: ${error}`);
  }

  return null;
}
