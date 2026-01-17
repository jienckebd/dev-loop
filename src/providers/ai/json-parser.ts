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
import { emitEvent } from '../../core/utils/event-stream';

export interface JsonParsingContext {
  providerName?: string;
  taskId?: string;
  prdId?: string;
  phaseId?: string | number;
  projectType?: string;
}

/**
 * Recursively extract result text from nested result objects
 *
 * Handles cases like: {"type": "result", "result": "{\"type\": \"result\", \"result\": \"...\"}"}
 * This fixes the issue where Cursor AI returns narrative text wrapped in multiple layers of result objects.
 *
 * @param data - Data that might be a result object or contain nested result objects
 * @param maxDepth - Maximum recursion depth (default: 5 to prevent infinite loops)
 * @returns Extracted text or the original data if not a result object
 */
function extractResultTextRecursively(data: any, maxDepth: number = 5): any {
  if (maxDepth <= 0) {
    logger.warn('[json-parser] Maximum recursion depth reached in extractResultTextRecursively');
    return data;
  }

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && parsed.type === 'result' && parsed.result !== undefined) {
        // Found a nested result object, recurse
        return extractResultTextRecursively(parsed.result, maxDepth - 1);
      }
    } catch {
      // Not JSON, return original string
    }
    return data;
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.type === 'result' && data.result !== undefined) {
      // Found a result object, recurse into result field
      return extractResultTextRecursively(data.result, maxDepth - 1);
    }
  }

  return data;
}

/**
 * Extract CodeChanges from various response formats
 *
 * Supports:
 * - Direct CodeChanges objects
 * - Text responses containing JSON (including markdown code blocks)
 * - Response objects with 'text' or 'result' fields
 * - Recursively nested result objects (e.g., {"type":"result","result":"{\"type\":\"result\",\"result\":\"...\"}"})
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

  // Handle direct CodeChanges object
  if (response && typeof response === 'object' && response.files && Array.isArray(response.files)) {
    return response as CodeChanges;
  }

  // Handle result objects - recursively extract nested result structures
  if (response && typeof response === 'object' && response.type === 'result' && response.result !== undefined) {
    const extractedResult = extractResultTextRecursively(response.result);

    // Try to parse extracted result as JSON if it's a string
    if (typeof extractedResult === 'string') {
      try {
        const parsed = JSON.parse(extractedResult);
        if (parsed && parsed.files && Array.isArray(parsed.files)) {
          return parsed as CodeChanges;
        }
        // If parsed is still a result object, recurse
        if (parsed && typeof parsed === 'object' && parsed.type === 'result') {
          return extractCodeChanges(parsed, observationTracker, context);
        }
      } catch {
        // Not valid JSON, continue to text extraction
      }
    } else if (extractedResult && typeof extractedResult === 'object' && extractedResult.files && Array.isArray(extractedResult.files)) {
      // Extracted result is already a CodeChanges object
      return extractedResult as CodeChanges;
    } else if (extractedResult && typeof extractedResult === 'object' && extractedResult.type === 'result') {
      // Extracted result is still a result object, recurse
      return extractCodeChanges(extractedResult, observationTracker, context);
    }

    // If extracted result is still a string, try text extraction
    const resultText = typeof extractedResult === 'string' ? extractedResult : JSON.stringify(extractedResult);
    return parseCodeChangesFromText(resultText, observationTracker, context);
  }

  // Convert response to text for schema validation
  let textToValidate: string = '';

  if (typeof response === 'string') {
    textToValidate = response;
  } else if (response && typeof response === 'object') {
    // Extract text from common fields
    if (response.text && typeof response.text === 'string') {
      // Check if text contains nested result objects
      try {
        const parsedText = JSON.parse(response.text);
        if (parsedText && typeof parsedText === 'object' && parsedText.type === 'result' && parsedText.result !== undefined) {
          // Recursively extract from nested result objects
          const extractedResult = extractResultTextRecursively(parsedText.result);
          textToValidate = typeof extractedResult === 'string' ? extractedResult : JSON.stringify(extractedResult);
        } else {
          textToValidate = response.text;
        }
      } catch {
        // Not JSON, proceed with direct text parsing
        textToValidate = response.text;
      }
    } else if (response.result && typeof response.result === 'string') {
      // Check if result contains nested result objects
      try {
        const parsedResult = JSON.parse(response.result);
        if (parsedResult && typeof parsedResult === 'object' && parsedResult.type === 'result' && parsedResult.result !== undefined) {
          // Recursively extract from nested result objects
          const extractedResult = extractResultTextRecursively(parsedResult.result);
          textToValidate = typeof extractedResult === 'string' ? extractedResult : JSON.stringify(extractedResult);
        } else {
          textToValidate = response.result;
        }
      } catch {
        // Not JSON, proceed with direct text parsing
        textToValidate = response.result;
      }
    } else if (response.response && typeof response.response === 'string') {
      textToValidate = response.response;
    } else {
      // Convert object to JSON string for validation
      textToValidate = JSON.stringify(response);
    }
  }

  // Primary method: Use schema-based validation (handles markdown code blocks, escaped JSON, etc.)
  // Suppress warnings since we have fallback methods
  if (textToValidate) {
    try {
      const validationResult = JsonSchemaValidator.extractAndValidate(textToValidate, true);
      if (validationResult.valid && validationResult.normalized) {
        logger.info(`[json-parser] Successfully extracted CodeChanges using JSON Schema validation`);
        return validationResult.normalized;
      } else {
        // Log validation errors for debugging (at debug level only)
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
  // Suppress warnings since we have fallback methods
  const startTime = Date.now();
  try {
    const validationResult = JsonSchemaValidator.extractAndValidate(text, true);
    if (validationResult.valid && validationResult.normalized) {
      logger.debug(`[json-parser] Successfully extracted CodeChanges from text using schema validation`);

      // Emit json:parse_success event
      emitEvent('json:parse_success', {
        strategy: 'schema_validation',
        retryCount: 0,
        durationMs: Date.now() - startTime,
        fileCount: validationResult.normalized.files?.length || 0,
      }, {
        taskId: context?.taskId,
        prdId: context?.prdId,
        phaseId: context?.phaseId ? Number(context.phaseId) : undefined,
      });

      return validationResult.normalized;
    } else {
      // Enhanced error logging (at debug level only)
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

    // Try to get strategy information from validation result (suppress warnings)
    try {
      const validationResult = JsonSchemaValidator.extractAndValidate(text, true);
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
 * Generic JSON Array Extraction
 *
 * Extracts JSON arrays from text using multiple strategies.
 * Handles various formats: markdown code blocks, escaped JSON, partial JSON, YAML, etc.
 *
 * @param text - Text containing JSON array (may include markdown formatting, prose, etc.)
 * @param itemSchema - Optional schema description to help with extraction
 * @returns Parsed array or null if extraction fails
 */
export function extractJsonArray<T = any>(
  text: string,
  itemSchema?: { requiredFields?: string[]; typeHint?: string }
): T[] | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const requiredFields = itemSchema?.requiredFields || [];
  const typeHint = itemSchema?.typeHint || 'object';

  // Strategy 0: Handle YAML document separator (---) format
  if (text.includes('---')) {
    try {
      const yaml = require('js-yaml');
      const documents = text.split(/^---$/m).filter(doc => doc.trim());
      const items: any[] = [];

      for (const doc of documents) {
        try {
          const parsed = yaml.load(doc.trim());
          if (parsed && typeof parsed === 'object') {
            items.push(parsed);
          }
        } catch {
          // Skip invalid YAML documents
        }
      }

      if (items.length > 0) {
        const validated = validateArrayItems(items, requiredFields);
        if (validated.length > 0) {
          logger.debug(`[json-parser] Extracted ${validated.length} items from YAML documents`);
          return validated as T[];
        }
      }
    } catch {
      // js-yaml not available, continue with other strategies
    }
  }

  // Strategy 1: Extract from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const result = tryParseJsonArray<T>(codeBlockMatch[1].trim(), requiredFields);
    if (result) {
      logger.debug('[json-parser] Extracted JSON array from markdown code block');
      return result;
    }
  }

  // Strategy 2: Find JSON array bounds [ ... ]
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const arrayText = text.substring(arrayStart, arrayEnd + 1);
    const result = tryParseJsonArray<T>(arrayText, requiredFields);
    if (result) {
      logger.debug('[json-parser] Extracted JSON array from bounds detection');
      return result;
    }
  }

  // Strategy 3: Balance brackets extraction (handles nested arrays)
  const balancedArrays = extractBalancedArrays(text);
  for (const arrayText of balancedArrays) {
    const result = tryParseJsonArray<T>(arrayText, requiredFields);
    if (result) {
      logger.debug('[json-parser] Extracted JSON array using balanced brackets');
      return result;
    }
  }

  // Strategy 4: Extract individual objects and combine into array
  const objects = extractIndividualObjects(text, requiredFields);
  if (objects.length > 0) {
    logger.debug(`[json-parser] Extracted ${objects.length} individual objects into array`);
    return objects as T[];
  }

  // Strategy 5: Try partial JSON parsing (for truncated responses)
  let parsePartialJson: ((jsonString: string, allowPartial?: number) => any) | null = null;
  let Allow: any = null;
  try {
    const partialJson = require('partial-json');
    parsePartialJson = partialJson.parse || partialJson.parseJSON;
    Allow = partialJson.Allow;
  } catch {
    // partial-json not available
  }

  if (parsePartialJson && Allow && arrayStart >= 0) {
    try {
      const partialText = text.substring(arrayStart);
      const parsed = parsePartialJson(partialText, Allow.ALL);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validated = validateArrayItems(parsed, requiredFields);
        if (validated.length > 0) {
          logger.debug(`[json-parser] Extracted ${validated.length} items using partial JSON parser`);
          return validated as T[];
        }
      }
    } catch {
      // Partial parsing failed
    }
  }

  // Strategy 6: Try to fix common JSON errors and retry
  const fixedText = fixCommonJsonErrors(text);
  if (fixedText !== text) {
    const fixedArrayStart = fixedText.indexOf('[');
    const fixedArrayEnd = fixedText.lastIndexOf(']');
    if (fixedArrayStart >= 0 && fixedArrayEnd > fixedArrayStart) {
      const result = tryParseJsonArray<T>(fixedText.substring(fixedArrayStart, fixedArrayEnd + 1), requiredFields);
      if (result) {
        logger.debug('[json-parser] Extracted JSON array after fixing common errors');
        return result;
      }
    }
  }

  // Strategy 7: Strip conversational preamble and retry
  const strippedText = stripConversationalPreamble(text);
  if (strippedText !== text) {
    const strippedArrayStart = strippedText.indexOf('[');
    const strippedArrayEnd = strippedText.lastIndexOf(']');
    if (strippedArrayStart >= 0 && strippedArrayEnd > strippedArrayStart) {
      const result = tryParseJsonArray<T>(strippedText.substring(strippedArrayStart, strippedArrayEnd + 1), requiredFields);
      if (result) {
        logger.debug('[json-parser] Extracted JSON array after stripping preamble');
        return result;
      }
    }
  }

  logger.debug('[json-parser] Failed to extract JSON array using all strategies');
  return null;
}

/**
 * Strip conversational preamble from AI responses
 */
function stripConversationalPreamble(text: string): string {
  // Common patterns where AI provides summary before JSON
  const preamblePatterns = [
    /^.*?(?=\[)/s, // Everything before first [
    /^.*?Here(?:'s| is)(?: the)? (?:JSON|array|list|response|result)[:\s]*/is,
    /^.*?(?:The |This )?(?:JSON|array|list|response|result|output)(?: is)?[:\s]*/is,
    /^.*?(?:Returning|Generated|Created|Produced)[:\s]*/is,
    /^.*?Summary[:\s]*\n+/is, // "Summary:" followed by newlines
    /^.*?(?:Test (?:plans?|cases?))[:\s]*/is, // "Test plans:" prefix
  ];

  let stripped = text;
  for (const pattern of preamblePatterns) {
    const match = text.match(pattern);
    if (match && match[0].length < text.length * 0.5) { // Only strip if preamble is less than half
      const candidate = text.substring(match[0].length);
      if (candidate.trim().startsWith('[') || candidate.trim().startsWith('{')) {
        stripped = candidate.trim();
        break;
      }
    }
  }

  return stripped;
}

/**
 * Try to parse text as JSON array and validate items
 */
function tryParseJsonArray<T>(text: string, requiredFields: string[]): T[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const validated = validateArrayItems(parsed, requiredFields);
      if (validated.length > 0) {
        return validated as T[];
      }
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Validate array items have required fields
 */
function validateArrayItems(items: any[], requiredFields: string[]): any[] {
  if (requiredFields.length === 0) {
    return items.filter(item => item && typeof item === 'object');
  }
  return items.filter(item => {
    if (!item || typeof item !== 'object') return false;
    return requiredFields.every(field => field in item);
  });
}

/**
 * Extract balanced arrays from text using bracket matching
 */
function extractBalancedArrays(text: string): string[] {
  const arrays: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '[') {
        if (depth === 0) {
          start = i;
        }
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0 && start !== -1) {
          arrays.push(text.substring(start, i + 1));
          start = -1;
        }
      }
    }
  }

  // Sort by size (largest first) - larger arrays are more likely to be complete
  return arrays.sort((a, b) => b.length - a.length);
}

/**
 * Extract individual JSON objects from text
 */
function extractIndividualObjects(text: string, requiredFields: string[]): any[] {
  const objects: any[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        if (depth === 0) {
          start = i;
        }
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = text.substring(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') {
              // Check if it has required fields or looks like the expected type
              if (requiredFields.length === 0 || requiredFields.some(f => f in parsed)) {
                objects.push(parsed);
              }
            }
          } catch {
            // Not valid JSON
          }
          start = -1;
        }
      }
    }
  }

  return objects;
}

/**
 * Fix common JSON errors in text
 */
function fixCommonJsonErrors(text: string): string {
  let fixed = text;

  // Fix trailing commas before ] or }
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');

  // Fix missing commas between objects
  fixed = fixed.replace(/}\s*{/g, '},{');

  // Fix unescaped quotes in strings (simple heuristic)
  // This is a simple fix for common cases - more complex cases need partial-json
  fixed = fixed.replace(/:\s*"([^"]*)"([^,}\]]*)"([^"]*)"([,}\]])/g, ': "$1\\"$2\\"$3"$4');

  // Fix single quotes to double quotes (only for object keys/values pattern)
  fixed = fixed.replace(/'([^']+)':/g, '"$1":');
  fixed = fixed.replace(/:\s*'([^']*)'/g, ': "$1"');

  // Remove control characters that break JSON parsing
  fixed = fixed.replace(/[\x00-\x1f\x7f]/g, (match) => {
    if (match === '\n' || match === '\r' || match === '\t') return match;
    return '';
  });

  return fixed;
}

/**
 * JSON Error Diagnosis Types
 *
 * Categorizes parsing failures to enable targeted fix prompts.
 */
export type JsonErrorType =
  | 'string-instead-of-array'
  | 'double-encoded'
  | 'double-wrapped'
  | 'truncated'
  | 'narrative-mixed'
  | 'wrong-structure'
  | 'trailing-content'
  | 'escaped-content'
  | 'unknown';

export interface JsonErrorDiagnosis {
  type: JsonErrorType;
  message: string;
  details?: Record<string, any>;
}

/**
 * Diagnose JSON parsing error type
 *
 * Analyzes the malformed text to determine what went wrong,
 * enabling targeted fix prompts that are more effective than generic ones.
 *
 * @param text - The malformed JSON text
 * @returns Diagnosis with error type and description
 */
export function diagnoseJsonError(text: string): JsonErrorDiagnosis {
  // 0. Double-wrapped JSON (whole response is stringified)
  // Pattern: ""{\"files\":..." or starts with quote and has escaped structure
  if (text.startsWith('""') || (text.startsWith('"') && text.match(/^\s*["']\s*\{\\"/))) {
    return {
      type: 'double-wrapped',
      message: 'Entire JSON response is wrapped in quotes and escaped',
    };
  }

  // 1. Files as string instead of array (most common error)
  // Pattern: "files": "[{...}]" instead of "files": [{...}]
  if (text.match(/"files"\s*:\s*"[\[\{]/)) {
    return {
      type: 'string-instead-of-array',
      message: 'The files field is a JSON string instead of an array',
    };
  }

  // 2. Double-encoded JSON (escaped quotes throughout)
  if (text.match(/\\\\"/g) || (text.match(/\\"/g) || []).length > 10) {
    return {
      type: 'double-encoded',
      message: 'JSON appears to be double-encoded with escaped quotes',
    };
  }

  // 3. Escaped content in file content fields
  if (text.match(/\\\\n|\\\\t/) && text.includes('"content"')) {
    return {
      type: 'escaped-content',
      message: 'File content contains double-escaped characters',
    };
  }

  // 4. Truncated response (unbalanced brackets)
  const openBraces = (text.match(/\{/g) || []).length;
  const closeBraces = (text.match(/\}/g) || []).length;
  const openBrackets = (text.match(/\[/g) || []).length;
  const closeBrackets = (text.match(/\]/g) || []).length;

  if (openBraces !== closeBraces || openBrackets !== closeBrackets) {
    return {
      type: 'truncated',
      message: 'JSON appears to be truncated (unbalanced brackets)',
      details: { openBraces, closeBraces, openBrackets, closeBrackets },
    };
  }

  // 5. Narrative text mixed with JSON
  if (text.match(/^[A-Z][a-z].*[\n\r]/) && text.includes('{') && text.includes('"files"')) {
    return {
      type: 'narrative-mixed',
      message: 'Response contains narrative text mixed with JSON',
    };
  }

  // 6. Trailing content after JSON
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace !== -1 && lastBrace < text.length - 1) {
    const trailing = text.substring(lastBrace + 1).trim();
    if (trailing.length > 0 && !trailing.match(/^[\s\n]*$/)) {
      return {
        type: 'trailing-content',
        message: 'Extra content after JSON object',
        details: { trailingSample: trailing.substring(0, 100) },
      };
    }
  }

  // 7. Wrong structure (files exists but not an array)
  if (text.includes('"files"') && !text.match(/"files"\s*:\s*\[/)) {
    return {
      type: 'wrong-structure',
      message: 'Files field exists but has wrong structure',
    };
  }

  return {
    type: 'unknown',
    message: 'Unknown parsing error',
  };
}

/**
 * Build a targeted fix prompt based on error diagnosis
 *
 * Creates specific prompts that address the diagnosed error type,
 * which are more effective than generic "fix this JSON" prompts.
 *
 * @param malformedOutput - The original malformed output
 * @param diagnosis - The diagnosed error type
 * @param attempt - Current attempt number (for escalating prompts)
 * @returns Targeted fix prompt
 */
export function buildTargetedFixPrompt(
  malformedOutput: string,
  diagnosis: JsonErrorDiagnosis,
  attempt: number = 1
): string {
  const baseSchema = `{
  "files": [
    {
      "path": "string (file path relative to project root)",
      "content": "string (complete file content)",
      "operation": "create" | "update" | "delete" | "patch"
    }
  ],
  "summary": "string (brief description of changes)"
}`;

  // Truncate if too long to save tokens
  const maxLength = 4000;
  const truncatedOutput =
    malformedOutput.length > maxLength
      ? malformedOutput.substring(0, maxLength) + '\n... [truncated for length]'
      : malformedOutput;

  const attemptNote =
    attempt > 1
      ? '\n\nIMPORTANT: Previous fix attempt failed. Be extra careful with JSON syntax and ensure all brackets/braces are balanced.'
      : '';

  switch (diagnosis.type) {
    case 'string-instead-of-array':
      return `The following JSON has the "files" field as a string instead of an array.
The files content is stringified JSON that needs to be parsed and returned as a proper array.

REQUIRED FORMAT:
${baseSchema}

MALFORMED OUTPUT:
${truncatedOutput}

Parse the stringified "files" field and return properly structured JSON.
Return ONLY the corrected JSON, no explanation or markdown.${attemptNote}`;

    case 'double-encoded':
      return `The following JSON is double-encoded (contains escaped quotes like \\" and escaped backslashes like \\\\).
Please decode it and return proper JSON.

REQUIRED FORMAT:
${baseSchema}

MALFORMED OUTPUT:
${truncatedOutput}

Decode the escaped characters and return valid JSON.
Return ONLY the corrected JSON, no explanation or markdown.${attemptNote}`;

    case 'double-wrapped':
      return `The following response has the entire JSON wrapped in quotes and escaped (double-wrapped).
The response looks like: "{\\"files\\": \\"[...]\\", \\"summary\\": \\"...\\"}"
This needs to be unwrapped and the stringified "files" array needs to be parsed.

REQUIRED FORMAT:
${baseSchema}

MALFORMED OUTPUT:
${truncatedOutput}

1. First, unwrap the outer string (remove leading/trailing quotes and unescape)
2. Then, parse the "files" field which is also a stringified array
3. Return the properly structured JSON

Return ONLY the corrected JSON, no explanation or markdown.${attemptNote}`;

    case 'escaped-content':
      return `The following JSON has file content with incorrectly escaped characters.
The content fields contain \\\\n instead of actual newlines.

REQUIRED FORMAT:
${baseSchema}

MALFORMED OUTPUT:
${truncatedOutput}

Fix the escaping in content fields and return valid JSON.
Return ONLY the corrected JSON, no explanation or markdown.${attemptNote}`;

    case 'truncated':
      return `The following JSON appears to be truncated (unbalanced brackets/braces).
Please complete the JSON structure based on what's visible.

REQUIRED FORMAT:
${baseSchema}

PARTIAL OUTPUT:
${truncatedOutput}

Complete the JSON by adding missing closing brackets/braces.
Return ONLY the completed JSON, no explanation or markdown.${attemptNote}`;

    case 'narrative-mixed':
      return `The following response contains narrative text mixed with JSON.
Extract ONLY the JSON code changes.

REQUIRED FORMAT:
${baseSchema}

RESPONSE:
${truncatedOutput}

Extract the JSON portion and return it.
Return ONLY the extracted JSON, no explanation or markdown.${attemptNote}`;

    case 'trailing-content':
      return `The following has extra content after the JSON object.
Extract only the valid JSON portion.

REQUIRED FORMAT:
${baseSchema}

OUTPUT WITH TRAILING CONTENT:
${truncatedOutput}

Remove trailing content and return valid JSON.
Return ONLY the JSON, no explanation or markdown.${attemptNote}`;

    case 'wrong-structure':
      return `The following JSON has the "files" field with wrong structure (not an array).
Restructure it to match the required format.

REQUIRED FORMAT:
${baseSchema}

MALFORMED OUTPUT:
${truncatedOutput}

Fix the files field to be a proper array.
Return ONLY the corrected JSON, no explanation or markdown.${attemptNote}`;

    default:
      // Generic fix prompt for unknown errors
      return `The following output failed to parse as valid CodeChanges JSON.
Please extract or reconstruct the code changes in the correct format.

REQUIRED FORMAT:
${baseSchema}

MALFORMED OUTPUT:
${truncatedOutput}

Return ONLY valid JSON matching the format above.
Do not include any explanation, markdown formatting, or code blocks.
Just the raw JSON object.${attemptNote}`;
  }
}

/**
 * Try programmatic fixes for common JSON errors
 *
 * Attempts to fix JSON without using AI, which is faster and cheaper.
 *
 * @param text - The malformed JSON text
 * @param diagnosis - The diagnosed error type
 * @returns Fixed CodeChanges or null if programmatic fix fails
 */
export function tryProgrammaticFix(text: string, diagnosis: JsonErrorDiagnosis): CodeChanges | null {
  try {
    switch (diagnosis.type) {
      case 'string-instead-of-array': {
        // Try to parse the outer JSON, then parse the files string
        const parsed = JSON.parse(text);
        if (typeof parsed.files === 'string') {
          const filesArray = JSON.parse(parsed.files);
          if (Array.isArray(filesArray)) {
            return {
              files: filesArray,
              summary: parsed.summary || 'Code changes extracted',
            };
          }
        }
        break;
      }

      case 'double-encoded': {
        // Try un-escaping once
        let unescaped = text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        // If it starts/ends with quotes, remove them
        if (unescaped.startsWith('"') && unescaped.endsWith('"')) {
          unescaped = unescaped.slice(1, -1);
        }
        const parsed = JSON.parse(unescaped);
        if (parsed.files && Array.isArray(parsed.files)) {
          return parsed as CodeChanges;
        }
        break;
      }

      case 'double-wrapped': {
        // Multi-layer unwrapping for deeply escaped JSON
        let inner = text;

        // Remove leading/trailing quotes
        while ((inner.startsWith('"') && inner.endsWith('"')) ||
               (inner.startsWith("'") && inner.endsWith("'"))) {
          inner = inner.slice(1, -1);
        }

        // Unescape the JSON
        inner = inner
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');

        const parsed = JSON.parse(inner);

        // Check if files is still a string (double stringified)
        if (typeof parsed.files === 'string') {
          let filesString = parsed.files
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');

          const filesArray = JSON.parse(filesString);
          if (Array.isArray(filesArray)) {
            return {
              files: filesArray,
              summary: parsed.summary || 'Code changes extracted',
            };
          }
        } else if (Array.isArray(parsed.files)) {
          return parsed as CodeChanges;
        }
        break;
      }

      case 'trailing-content': {
        // Extract just the JSON part
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.files && Array.isArray(parsed.files)) {
            return parsed as CodeChanges;
          }
        }
        break;
      }

      case 'narrative-mixed': {
        // Try to find JSON block after narrative
        const jsonStart = text.indexOf('{');
        if (jsonStart > 0) {
          const jsonPart = text.substring(jsonStart);
          const match = jsonPart.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.files && Array.isArray(parsed.files)) {
              return parsed as CodeChanges;
            }
          }
        }
        break;
      }
    }
  } catch {
    // Programmatic fix failed
  }

  return null;
}

/**
 * Extract CodeChanges with AI fallback for complex cases
 *
 * Uses a multi-stage approach:
 * 1. Try standard extraction (JsonSchemaValidator strategies)
 * 2. Diagnose the error type
 * 3. Try programmatic fixes based on diagnosis
 * 4. Use AI with targeted prompts as last resort
 *
 * @param response - The AI response to extract from
 * @param promptFunction - Function to invoke AI for fix attempts
 * @param context - Parsing context for logging
 * @param maxRetries - Maximum AI fix attempts (default: 2)
 * @returns Extracted CodeChanges or null
 */
export async function extractCodeChangesWithAiFallback(
  response: any,
  promptFunction: (prompt: string) => Promise<string>,
  context: JsonParsingContext,
  maxRetries: number = 2
): Promise<CodeChanges | null> {
  // Stage 1: Try standard extraction
  const codeChanges = extractCodeChanges(response, undefined, context);
  if (codeChanges && codeChanges.files && Array.isArray(codeChanges.files) && codeChanges.files.length > 0) {
    return codeChanges;
  }

  // Stage 2: Diagnose the error
  const responseText = typeof response === 'string' ? response : JSON.stringify(response);
  const diagnosis = diagnoseJsonError(responseText);

  logger.debug(`[json-parser] Diagnosis: ${diagnosis.type} - ${diagnosis.message}`);

  // Stage 3: Try programmatic fix (no AI needed)
  const programmaticFix = tryProgrammaticFix(responseText, diagnosis);
  if (programmaticFix && programmaticFix.files && Array.isArray(programmaticFix.files) && programmaticFix.files.length > 0) {
    logger.info(`[json-parser] Programmatic fix succeeded for ${diagnosis.type}`);

    // Emit json:sanitized event for programmatic fix
    emitEvent('json:sanitized', {
      diagnosisType: diagnosis.type,
      strategy: 'programmatic_fix',
      fileCount: programmaticFix.files.length,
    }, {
      taskId: context?.taskId,
      prdId: context?.prdId,
      phaseId: context?.phaseId ? Number(context.phaseId) : undefined,
    });

    return programmaticFix;
  }

  // Stage 4: Use AI with targeted prompts
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const fixPrompt = buildTargetedFixPrompt(responseText, diagnosis, attempt);

      logger.debug(`[json-parser] AI fix attempt ${attempt} for ${diagnosis.type}`);

      const aiResponse = await promptFunction(fixPrompt);
      if (aiResponse) {
        const parsed = extractCodeChanges(aiResponse, undefined, context);
        if (parsed && parsed.files && Array.isArray(parsed.files) && parsed.files.length > 0) {
          logger.info(`[json-parser] AI fix succeeded on attempt ${attempt} for ${diagnosis.type}`);

          // Emit json:ai_fallback_success event
          emitEvent('json:ai_fallback_success', {
            diagnosisType: diagnosis.type,
            attempt,
            fileCount: parsed.files.length,
          }, {
            taskId: context?.taskId,
            prdId: context?.prdId,
            phaseId: context?.phaseId ? Number(context.phaseId) : undefined,
          });

          return parsed;
        }
      }

      // Emit json:parse_retry event
      emitEvent('json:parse_retry', {
        diagnosisType: diagnosis.type,
        attempt,
      }, {
        taskId: context?.taskId,
        prdId: context?.prdId,
        phaseId: context?.phaseId ? Number(context.phaseId) : undefined,
      });
    } catch (error) {
      logger.warn(`[json-parser] AI fix attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);

      // Emit json:ai_fallback_error event
      emitEvent('json:ai_fallback_error', {
        diagnosisType: diagnosis.type,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      }, {
        taskId: context?.taskId,
        prdId: context?.prdId,
        phaseId: context?.phaseId ? Number(context.phaseId) : undefined,
      });
    }
  }

  logger.error(`[json-parser] All ${maxRetries} AI fix attempts failed for ${diagnosis.type}`);

  // Emit json:ai_fallback_failed event
  emitEvent('json:ai_fallback_failed', {
    diagnosisType: diagnosis.type,
    attempts: maxRetries,
  }, {
    taskId: context?.taskId,
    prdId: context?.prdId,
    phaseId: context?.phaseId ? Number(context.phaseId) : undefined,
  });

  return null;
}
