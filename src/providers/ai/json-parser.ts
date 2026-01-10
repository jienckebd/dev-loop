/**
 * JSON Parser for AI Provider Responses
 * 
 * Handles extraction of CodeChanges from various AI provider response formats,
 * including recursively nested result objects from Cursor AI.
 */

import { CodeChanges } from '../../types';
import { ObservationTracker } from '../../core/tracking/observation-tracker';
import { logger } from '../../core/utils/logger';

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
 * - Response objects with 'files' and 'summary' fields
 * - Result objects with nested result structures (recursive extraction)
 * - Text responses containing JSON
 * - Markdown code blocks containing JSON
 * 
 * @param response - The AI provider response (can be object, string, or nested result object)
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
  if (response.files && Array.isArray(response.files)) {
    return response as CodeChanges;
  }

  // Handle response objects with nested CodeChanges
  if (response.response && response.response.files) {
    return response.response as CodeChanges;
  }

  // Handle result objects - recursively extract nested result structures
  if (response.type === 'result' && response.result !== undefined) {
    const extractedResult = extractResultTextRecursively(response.result);
    
    // Try to parse extracted result as JSON if it's a string
    if (typeof extractedResult === 'string') {
      try {
        const parsed = JSON.parse(extractedResult);
        if (parsed && parsed.files && Array.isArray(parsed.files)) {
          return parsed as CodeChanges;
        }
      } catch {
        // Not valid JSON, continue to text extraction
      }
    } else if (extractedResult && extractedResult.files && Array.isArray(extractedResult.files)) {
      // Extracted result is already a CodeChanges object
      return extractedResult as CodeChanges;
    }
    
    // If extracted result is still a string, try text extraction
    const resultText = typeof extractedResult === 'string' ? extractedResult : JSON.stringify(extractedResult);
    return parseCodeChangesFromText(resultText, observationTracker, context);
  }

  // Handle text responses
  if (typeof response === 'string') {
    return parseCodeChangesFromText(response, observationTracker, context);
  }

  // Handle response objects with 'text' field
  if (response.text && typeof response.text === 'string') {
    // Check if text contains nested result objects
    try {
      const parsedText = JSON.parse(response.text);
      if (parsedText && typeof parsedText === 'object' && parsedText.type === 'result' && parsedText.result !== undefined) {
        // Recursively extract from nested result objects
        const extractedResult = extractResultTextRecursively(parsedText.result);
        const resultText = typeof extractedResult === 'string' ? extractedResult : JSON.stringify(extractedResult);
        return parseCodeChangesFromText(resultText, observationTracker, context);
      }
    } catch {
      // Not JSON, proceed with direct text parsing
    }
    return parseCodeChangesFromText(response.text, observationTracker, context);
  }

  // Try to extract from common nested paths
  const nestedPaths = ['data', 'content', 'output', 'result', 'response'];
  for (const path of nestedPaths) {
    if (response[path]) {
      const nested = extractCodeChanges(response[path], observationTracker, context);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

/**
 * Parse CodeChanges from text response
 * 
 * Extracts JSON from text, handling markdown code blocks and plain JSON.
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

  // Try to extract JSON from markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    text = jsonBlockMatch[1].trim();
  }

  // Try to find JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    text = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.files && Array.isArray(parsed.files)) {
      return parsed as CodeChanges;
    }
  } catch (error) {
    if (observationTracker && context?.providerName && context?.taskId) {
      // Track JSON parsing failure using the proper method signature
      observationTracker.trackJsonParsingFailure(
        text.substring(0, 500),
        [],
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
  return response && (response.text || response.result);
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
