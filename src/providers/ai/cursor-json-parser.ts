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
    return response as CodeChanges;
  }

  // Case 2: CodeChanges nested in response
  if (response.codeChanges) {
    return response.codeChanges as CodeChanges;
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
    return parseCodeChangesFromText(resultText);
  }

  // Case 4: Text response - try to extract JSON code blocks
  if (typeof response === 'string' || response.text) {
    const text = typeof response === 'string' ? response : response.text;
    return parseCodeChangesFromText(text);
  }

  // Case 5: Check for common patterns in response object
  if (response.content) {
    return parseCodeChangesFromText(response.content);
  }

  logger.debug('[CursorJsonParser] Could not extract code changes from response');
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
  const codeChangesRegex = /\{\s*"files"\s*:\s*\[[\s\S]{0,50000}\]\s*,\s*"summary"\s*:\s*"[^"]*"\s*\}/;
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

