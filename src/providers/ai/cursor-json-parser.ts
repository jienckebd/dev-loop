/**
 * Cursor JSON Parser
 *
 * Shared utility for parsing CodeChanges from Cursor background agent responses.
 * Handles various response formats and robustly extracts JSON code blocks.
 *
 * This module centralizes JSON parsing logic to avoid duplication between
 * CursorProvider and CursorChatOpener.
 */

import { CodeChanges } from '../../types';
import { logger } from '../../core/logger';

/**
 * Extract CodeChanges from various response formats
 *
 * Handles:
 * - Direct CodeChanges objects
 * - Nested codeChanges property
 * - Cursor agent result format (response.raw)
 * - Text responses (string or response.text)
 * - Content property responses
 * - Parsed JSON strings that may contain CodeChanges in various fields
 *
 * @param response - Response from Cursor background agent (various formats)
 * @returns CodeChanges object or null if extraction fails
 */
export function extractCodeChanges(response: any): CodeChanges | null {
  if (!response) {
    return null;
  }

  // Case 1: Direct CodeChanges object
  if (response.files && Array.isArray(response.files) && response.summary) {
    logger.debug(`[CursorJsonParser] Extracted CodeChanges from direct object: ${response.files.length} files`);
    return response as CodeChanges;
  }

  // Case 2: CodeChanges nested in response
  if (response.codeChanges) {
    logger.debug(`[CursorJsonParser] Extracted CodeChanges from codeChanges property: ${response.codeChanges.files?.length || 0} files`);
    return response.codeChanges as CodeChanges;
  }

  // Case 2a: Check for common nested properties (result, data, response, output)
  const nestedPaths = ['result', 'data', 'response', 'output', 'content'];
  for (const path of nestedPaths) {
    if (response[path]) {
      const nested = response[path];
      // Check if nested object is CodeChanges
      if (nested.files && Array.isArray(nested.files) && nested.summary) {
        logger.debug(`[CursorJsonParser] Extracted CodeChanges from ${path} property: ${nested.files.length} files`);
        return nested as CodeChanges;
      }
      // Try parsing as stringified JSON
      if (typeof nested === 'string') {
        try {
          const parsed = JSON.parse(nested);
          if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
            logger.debug(`[CursorJsonParser] Extracted CodeChanges from ${path} (parsed string): ${parsed.files.length} files`);
            return parsed as CodeChanges;
          }
        } catch {
          // Not JSON, continue
        }
      }
    }
  }

  // Case 3: Cursor agent result format - check result field first
  if (response.raw && response.raw.type === 'result' && response.raw.result) {
    const resultText = response.raw.result;
    // Try parsing result as JSON first
    try {
      const parsed = JSON.parse(resultText);
      if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
        return parsed as CodeChanges;
      }
    } catch {
      // Not JSON, try extracting from text
    }
    // Extract from text (may contain JSON code blocks)
    const extracted = parseCodeChangesFromText(resultText);
    if (extracted) return extracted;
  }

  // Case 3b: Check if response itself is a Cursor result object
  if (response.type === 'result' && response.result) {
    const resultText = typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
    const extracted = parseCodeChangesFromText(resultText);
    if (extracted) {
      logger.debug(`[CursorJsonParser] Extracted CodeChanges from response.result: ${extracted.files.length} files`);
      return extracted;
    }
  }

  // Case 3c: Check text field (may contain stringified result object with JSON inside)
  if (response.text && typeof response.text === 'string') {
    // Try parsing as JSON first (might be stringified result object)
    try {
      const parsedText = JSON.parse(response.text);
      // If it's a result object, extract from result field
      if (parsedText.type === 'result' && parsedText.result) {
        // The result field may contain escaped JSON that needs to be unescaped first
        let resultText = parsedText.result;
        // If result contains escaped JSON code blocks, unescape them
        if (typeof resultText === 'string' && resultText.includes('\\n')) {
          // Unescape common patterns: \\n -> newline, \\" -> quote
          resultText = resultText.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        const extracted = parseCodeChangesFromText(resultText);
        if (extracted) {
          logger.debug(`[CursorJsonParser] Extracted CodeChanges from response.text (result object): ${extracted.files.length} files`);
          return extracted;
        }
      }
    } catch {
      // Not JSON, try extracting directly from text
    }
    // Extract directly from text (may contain JSON code blocks)
    const extracted = parseCodeChangesFromText(response.text);
    if (extracted) {
      logger.debug(`[CursorJsonParser] Extracted CodeChanges from response.text: ${extracted.files.length} files`);
      return extracted;
    }
  }

  // Case 3d: Check stdout field (background agent output)
  if (response.stdout && typeof response.stdout === 'string') {
    const extracted = parseCodeChangesFromText(response.stdout);
    if (extracted) {
      logger.debug(`[CursorJsonParser] Extracted CodeChanges from stdout: ${extracted.files.length} files`);
      return extracted;
    }
  }

  // Case 4: Text response - try to extract JSON code blocks
  if (typeof response === 'string' || response.text) {
    const text = typeof response === 'string' ? response : response.text;
    return parseCodeChangesFromText(text);
  }

  // Case 5: Check for common patterns in response object
  if (response.content) {
    const extracted = parseCodeChangesFromText(response.content);
    if (extracted) {
      logger.debug(`[CursorJsonParser] Extracted CodeChanges from content: ${extracted.files.length} files`);
      return extracted;
    }
  }

  // Log diagnostic info before returning null (for contribution mode debugging)
  if (typeof response === 'object' && response !== null) {
    const responseKeys = Object.keys(response);
    logger.debug(`[CursorJsonParser] Could not extract CodeChanges. Response keys: ${responseKeys.join(', ')}. Response type: ${response.constructor?.name || typeof response}`);
    // Log sample of response structure (limited size) - focus on keys that might contain CodeChanges
    try {
      const sample: any = {};
      for (const key of ['text', 'raw', 'result', 'data', 'response', 'output', 'content']) {
        if (response[key] !== undefined) {
          const value = response[key];
          if (typeof value === 'string') {
            sample[key] = value.substring(0, 200) + (value.length > 200 ? '...' : '');
          } else if (typeof value === 'object' && value !== null) {
            sample[key] = Object.keys(value).join(', ');
          } else {
            sample[key] = typeof value;
          }
        }
      }
      logger.debug(`[CursorJsonParser] Response sample: ${JSON.stringify(sample)}`);
    } catch {
      // Can't stringify, skip
    }
  }

  return null;
}

/**
 * Parse code changes from text response with robust error handling
 *
 * Strategy:
 * 1. Try parsing raw JSON first (no unescaping - JSON should already be valid)
 * 2. If that fails, try with minimal unescaping (only for double-escaped cases)
 * 3. Multiple extraction strategies: JSON code blocks, CodeChanges structure, files key
 *
 * This function fixes the "Bad control character" errors by:
 * - Not incorrectly unescaping valid JSON escape sequences
 * - Only unescaping when double-escaping is detected (\\\\n -> \\n)
 * - Using multiple regex patterns to find JSON in various formats
 *
 * @param text - Text response containing JSON code blocks or CodeChanges structure
 * @returns CodeChanges object or null if parsing fails
 */
export function parseCodeChangesFromText(text: string): CodeChanges | null {
  if (!text) {
    return null;
  }

  // Try to find JSON code blocks (most common format)
  // Match: ```json { ... } ``` or ``` { ... } ```
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?"files"[\s\S]*?"summary"[\s\S]*?\})\s*```/;
  let match = text.match(jsonBlockRegex);

  if (match) {
    let jsonStr = match[1];

    // Strategy 1: Try parsing raw JSON first (no unescaping)
    // JSON strings should already have proper escaping
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
        logger.debug(`[CursorJsonParser] Extracted CodeChanges from JSON code block: ${parsed.files.length} files`);
        return parsed as CodeChanges;
      }
    } catch (error) {
      // Strategy 2: If raw parsing fails, check if it's double-escaped
      // Only unescape if we detect double-escaping (e.g., \\\\n instead of \\n)
      try {
        // Check for double-escaping pattern
        if (jsonStr.includes('\\\\n') || jsonStr.includes('\\\\"')) {
          // Only unescape double-escaped sequences
          jsonStr = jsonStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\');
          const parsed = JSON.parse(jsonStr);
          if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
            logger.debug(`[CursorJsonParser] Extracted CodeChanges from JSON code block (double-escaped): ${parsed.files.length} files`);
            return parsed as CodeChanges;
          }
        } else {
          // Log error with context for debugging
          const errorMsg = error instanceof Error ? error.message : String(error);
          const snippet = jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '');
          logger.warn(`[CursorJsonParser] Failed to parse JSON from code block: ${errorMsg}. Snippet: ${snippet}`);
        }
      } catch (retryError) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug(`[CursorJsonParser] Failed to parse JSON from code block after retry: ${errorMsg}`);
      }
    }
  }

  // Try to find CodeChanges structure anywhere in text (more flexible regex)
  // Match: {"files": [...], "summary": "..."}
  // Enhanced: Support multi-line, nested objects, and various whitespace patterns
  const codeChangesRegex = /\{\s*"files"\s*:\s*\[[\s\S]{0,50000}?\]\s*,\s*"summary"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}/;
  const codeChangesMatch = text.match(codeChangesRegex);
  if (codeChangesMatch) {
    let jsonStr = codeChangesMatch[0];

    // Try raw parsing first
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
        logger.debug(`[CursorJsonParser] Extracted CodeChanges from text: ${parsed.files.length} files`);
        return parsed as CodeChanges;
      }
    } catch (error) {
      // Try with minimal unescaping only if double-escaped
      try {
        if (jsonStr.includes('\\\\n') || jsonStr.includes('\\\\"')) {
          jsonStr = jsonStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\');
          const parsed = JSON.parse(jsonStr);
          if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
            logger.debug(`[CursorJsonParser] Extracted CodeChanges from text (double-escaped): ${parsed.files.length} files`);
            return parsed as CodeChanges;
          }
        }
      } catch (retryError) {
        logger.debug(`[CursorJsonParser] Failed to parse CodeChanges JSON: ${error}`);
      }
    }
  }

  // NEW: Try finding JSON object with balanced braces (more robust extraction)
  // This handles cases where the regex might miss nested structures
  const braceStart = text.indexOf('{"files"');
  if (braceStart !== -1) {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let endPos = braceStart;

    for (let i = braceStart; i < text.length; i++) {
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
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            endPos = i + 1;
            break;
          }
        }
      }
    }

    if (endPos > braceStart && braceCount === 0) {
      const jsonStr = text.substring(braceStart, endPos);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.files && Array.isArray(parsed.files)) {
          if (!parsed.summary) {
            parsed.summary = `Generated ${parsed.files.length} file(s)`;
          }
          logger.debug(`[CursorJsonParser] Extracted CodeChanges using balanced brace algorithm: ${parsed.files.length} files`);
          return parsed as CodeChanges;
        }
      } catch (error) {
        logger.debug(`[CursorJsonParser] Failed to parse balanced brace JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Try to find JSON object that starts with "files" key (even if not in code block)
  const filesKeyRegex = /\{\s*"files"\s*:[\s\S]{0,50000}\}/;
  const filesMatch = text.match(filesKeyRegex);
  if (filesMatch) {
    let jsonStr = filesMatch[0];
    // Try to find the end of the JSON object by counting braces
    let braceCount = 0;
    let endPos = 0;
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') braceCount++;
      if (jsonStr[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endPos = i + 1;
          break;
        }
      }
    }
    if (endPos > 0) {
      jsonStr = jsonStr.substring(0, endPos);

      // Try raw parsing first
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.files && Array.isArray(parsed.files)) {
          // Ensure summary exists (default if missing)
          if (!parsed.summary) {
            parsed.summary = `Generated ${parsed.files.length} file(s)`;
          }
          logger.debug(`[CursorJsonParser] Extracted CodeChanges from files key: ${parsed.files.length} files`);
          return parsed as CodeChanges;
        }
      } catch (error) {
        // Try with minimal unescaping only if double-escaped
        try {
          if (jsonStr.includes('\\\\n') || jsonStr.includes('\\\\"')) {
            jsonStr = jsonStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\');
            const parsed = JSON.parse(jsonStr);
            if (parsed.files && Array.isArray(parsed.files)) {
              if (!parsed.summary) {
                parsed.summary = `Generated ${parsed.files.length} file(s)`;
              }
              logger.debug(`[CursorJsonParser] Extracted CodeChanges from files key (double-escaped): ${parsed.files.length} files`);
              return parsed as CodeChanges;
            }
          }
        } catch (retryError) {
          logger.debug(`[CursorJsonParser] Failed to parse files key JSON: ${error}`);
        }
      }
    }
  }

  return null;
}

