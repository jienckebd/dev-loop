/**
 * Provider-Agnostic JSON Parser
 *
 * Shared utility for parsing CodeChanges from AI provider responses.
 * Handles various response formats and robustly extracts JSON code blocks.
 *
 * This module centralizes JSON parsing logic to avoid duplication between
 * different AI providers (Cursor, OpenAI, Anthropic, Gemini, Ollama).
 */

import { CodeChanges } from '../../types';
import { logger } from '../../core/logger';
import { ObservationTracker } from '../../core/observation-tracker';

/**
 * Context for tracking JSON parsing failures
 */
export interface JsonParsingContext {
  providerName: string;
  projectType?: string;
  taskId?: string;
  prdId?: string;
  phaseId?: number;
}

/**
 * Extract CodeChanges from various response formats
 *
 * Handles:
 * - Direct CodeChanges objects
 * - Nested codeChanges property
 * - AI agent result format (response.raw, response.result, response.text, response.stdout)
 * - Text responses (string or response.text)
 * - Content property responses
 * - Parsed JSON strings that may contain CodeChanges in various fields
 *
 * @param response - Response from AI provider (various formats)
 * @param observationTracker - Optional ObservationTracker instance for logging failures
 * @param context - Optional context for tracking observations
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

  const attemptedStrategies: string[] = [];
  const providerName = context?.providerName || 'unknown';

  const tryParse = (data: any, strategy: string): CodeChanges | null => {
    attemptedStrategies.push(strategy);
    if (data && typeof data === 'object' && data.files && Array.isArray(data.files) && data.summary) {
      logger.debug(`[JsonParser] Extracted CodeChanges from ${strategy} object: ${data.files.length} files`);
      return data as CodeChanges;
    }
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
          logger.debug(`[JsonParser] Extracted CodeChanges from ${strategy} (parsed string): ${parsed.files.length} files`);
          return parsed as CodeChanges;
        }
      } catch {
        // Not JSON, continue
      }
    }
    return null;
  };

  // Case 1: Direct CodeChanges object
  let result = tryParse(response, 'direct-object');
  if (result) return result;

  // Case 2: CodeChanges nested in response
  result = tryParse(response.codeChanges, 'nested-codeChanges');
  if (result) return result;

  // Case 2a: Check for common nested properties (result, data, response, output, content)
  const nestedPaths = ['result', 'data', 'response', 'output', 'content'];
  for (const path of nestedPaths) {
    if (response[path]) {
      result = tryParse(response[path], `nested-${path}`);
      if (result) return result;
    }
  }

  // Case 3: AI agent result format - check result field first
  if (response.raw && response.raw.type === 'result' && response.raw.result) {
    const resultText = response.raw.result;
    result = tryParse(resultText, 'raw-result-field');
    if (result) return result;
    result = parseCodeChangesFromText(resultText, attemptedStrategies);
    if (result) return result;
  }

  // Case 3b: Check if response itself is a result object
  if (response.type === 'result' && response.result) {
    const resultText = typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
    result = parseCodeChangesFromText(resultText, attemptedStrategies);
    if (result) {
      logger.debug(`[JsonParser] Extracted CodeChanges from response.result: ${result.files.length} files`);
      return result;
    }
  }

  // Case 3c: Check text field (may contain stringified result object with JSON inside)
  if (response.text && typeof response.text === 'string') {
    // Try parsing as JSON first (might be stringified result object)
    try {
      const parsedText = JSON.parse(response.text);
      // If it's a result object, extract from result field
      if (parsedText.type === 'result' && parsedText.result) {
        let resultText = parsedText.result;
        if (typeof resultText === 'string') {
          // Multiple passes to handle triple-escaped JSON (\\\\n -> \\n -> \n)
          // First pass: unescape \\n to newlines, \\" to quotes
          if (resultText.includes('\\n') || resultText.includes('\\"')) {
            resultText = resultText.replace(/\\n/g, '\n').replace(/\\"/g, '"');
          }
          // Second pass: handle remaining backslashes (for nested JSON in content)
          if (resultText.includes('\\\\')) {
            resultText = resultText.replace(/\\\\/g, '\\');
          }
          attemptedStrategies.push('result-object-deep-unescape');
        }
        result = parseCodeChangesFromText(resultText, attemptedStrategies);
        if (result) {
          logger.debug(`[JsonParser] Extracted CodeChanges from response.text (result object): ${result.files.length} files`);
          return result;
        }
      }
    } catch {
      // Not JSON, try extracting directly from text
    }
    result = parseCodeChangesFromText(response.text, attemptedStrategies);
    if (result) {
      logger.debug(`[JsonParser] Extracted CodeChanges from response.text: ${result.files.length} files`);
      return result;
    }
  }

  // Case 3d: Check stdout field (background agent output)
  if (response.stdout && typeof response.stdout === 'string') {
    result = parseCodeChangesFromText(response.stdout, attemptedStrategies);
    if (result) {
      logger.debug(`[JsonParser] Extracted CodeChanges from stdout: ${result.files.length} files`);
      return result;
    }
  }

  // Case 4: Text response - try to extract JSON code blocks
  if (typeof response === 'string') {
    result = parseCodeChangesFromText(response, attemptedStrategies);
    if (result) return result;
  }

  // Case 5: Check for common patterns in response object
  if (response.content) {
    result = parseCodeChangesFromText(response.content, attemptedStrategies);
    if (result) {
      logger.debug(`[JsonParser] Extracted CodeChanges from content: ${result.files.length} files`);
      return result;
    }
  }

  // Log diagnostic info and track failure
  const responseSample = typeof response === 'string'
    ? response.substring(0, 500)
    : JSON.stringify(response).substring(0, 500);

  if (observationTracker && context) {
    observationTracker.trackJsonParsingFailure(
      responseSample,
      attemptedStrategies,
      context.projectType || 'unknown',
      providerName,
      context.taskId,
      context.prdId,
      context.phaseId
    );
  }

  if (typeof response === 'object' && response !== null) {
    const responseKeys = Object.keys(response);
    logger.debug(`[JsonParser] Could not extract CodeChanges. Response keys: ${responseKeys.join(', ')}. Response type: ${response.constructor?.name || typeof response}`);
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
      logger.debug(`[JsonParser] Response sample: ${JSON.stringify(sample)}`);
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
 * @param attemptedStrategies - Array to record strategies attempted (for tracking)
 * @returns CodeChanges object or null if parsing fails
 */
export function parseCodeChangesFromText(text: string, attemptedStrategies: string[] = []): CodeChanges | null {
  if (!text) {
    return null;
  }

  // Pre-processing: Strip common prefixes that Claude adds before JSON
  const prefixPatterns = [
    /^[\s\S]*?Here (?:is|are) the (?:JSON|code changes|changes):\s*/i,
    /^[\s\S]*?I'll (?:generate|create|provide)[\s\S]*?:\s*/i,
    /^[\s\S]*?Based on [\s\S]*?, here['']?s the [\s\S]*?:\s*/i,
    /^[\s\S]*?The (?:code changes|JSON|response) (?:is|are):\s*/i,
  ];

  let processedText = text;
  for (const pattern of prefixPatterns) {
    const match = processedText.match(pattern);
    if (match && match[0].length < 500) {
      processedText = processedText.substring(match[0].length);
      logger.debug(`[JsonParser] Stripped prefix: "${match[0].substring(0, 50)}..."`);
      attemptedStrategies.push('stripped-prefix');
      break;
    }
  }

  // Try to find JSON code blocks (most common format)
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?"files"[\s\S]*?"summary"[\s\S]*?\})\s*```/;
  let match = processedText.match(jsonBlockRegex);

  if (match) {
    let jsonStr = match[1];
    attemptedStrategies.push('json-code-block');

    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
        logger.debug(`[JsonParser] Extracted CodeChanges from JSON code block: ${parsed.files.length} files`);
        return parsed as CodeChanges;
      }
    } catch (error) {
      // Try progressive unescaping for deeply nested escaped JSON
      const unescapeStrategies = [
        // Double-escaped: \\n -> \n, \\" -> "
        (s: string) => s.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\'),
        // Triple-escaped: \\\\ -> \\, then \\n -> \n
        (s: string) => {
          let result = s.replace(/\\\\\\\\/g, '\\\\');
          result = result.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"');
          return result;
        },
        // Simple unescape: \\n -> newline, \\" -> "
        (s: string) => s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
      ];

      for (let i = 0; i < unescapeStrategies.length; i++) {
        try {
          const unescaped = unescapeStrategies[i](jsonStr);
          const parsed = JSON.parse(unescaped);
          if (parsed.files && Array.isArray(parsed.files)) {
            if (!parsed.summary) parsed.summary = `Generated ${parsed.files.length} file(s)`;
            logger.debug(`[JsonParser] Extracted CodeChanges from JSON code block (unescape level ${i + 1}): ${parsed.files.length} files`);
            attemptedStrategies.push(`json-code-block-unescape-${i + 1}`);
            return parsed as CodeChanges;
          }
        } catch {
          // Continue to next strategy
        }
      }

      // Log error if all strategies failed
      const errorMsg = error instanceof Error ? error.message : String(error);
      const snippet = jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '');
      logger.warn(`[JsonParser] Failed to parse JSON from code block: ${errorMsg}. Snippet: ${snippet}`);
    }
  }

  // Try to find CodeChanges structure anywhere in text (more flexible regex)
  const codeChangesRegex = /\{\s*"files"\s*:\s*\[[\s\S]{0,50000}?\]\s*,\s*"summary"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}/;
  const codeChangesMatch = processedText.match(codeChangesRegex);
  if (codeChangesMatch) {
    let jsonStr = codeChangesMatch[0];
    attemptedStrategies.push('codeChanges-regex');

    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
        logger.debug(`[JsonParser] Extracted CodeChanges from text: ${parsed.files.length} files`);
        return parsed as CodeChanges;
      }
    } catch (error) {
      try {
        if (jsonStr.includes('\\\\n') || jsonStr.includes('\\\\"')) {
          jsonStr = jsonStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\');
          const parsed = JSON.parse(jsonStr);
          if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
            logger.debug(`[JsonParser] Extracted CodeChanges from text (double-escaped): ${parsed.files.length} files`);
            attemptedStrategies.push('codeChanges-regex-double-escaped');
            return parsed as CodeChanges;
          }
        }
      } catch (retryError) {
        logger.debug(`[JsonParser] Failed to parse CodeChanges JSON: ${error}`);
      }
    }
  }

  // Try finding JSON object with balanced braces (more robust extraction)
  const braceStart = processedText.indexOf('{"files"');
  if (braceStart !== -1) {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let endPos = braceStart;

    for (let i = braceStart; i < processedText.length; i++) {
      const char = processedText[i];

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
      const jsonStr = processedText.substring(braceStart, endPos);
      attemptedStrategies.push('balanced-braces');
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.files && Array.isArray(parsed.files)) {
          if (!parsed.summary) {
            parsed.summary = `Generated ${parsed.files.length} file(s)`;
          }
          logger.debug(`[JsonParser] Extracted CodeChanges using balanced brace algorithm: ${parsed.files.length} files`);
          return parsed as CodeChanges;
        }
      } catch (error) {
        logger.debug(`[JsonParser] Failed to parse balanced brace JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Try to find JSON object that starts with "files" key (even if not in code block)
  const filesKeyRegex = /\{\s*"files"\s*:[\s\S]{0,50000}\}/;
  const filesMatch = processedText.match(filesKeyRegex);
  if (filesMatch) {
    let jsonStr = filesMatch[0];
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
      attemptedStrategies.push('files-key-regex');

      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.files && Array.isArray(parsed.files)) {
          if (!parsed.summary) {
            parsed.summary = `Generated ${parsed.files.length} file(s)`;
          }
          logger.debug(`[JsonParser] Extracted CodeChanges from files key: ${parsed.files.length} files`);
          return parsed as CodeChanges;
        }
      } catch (error) {
        try {
          if (jsonStr.includes('\\\\n') || jsonStr.includes('\\\\"')) {
            jsonStr = jsonStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\');
            const parsed = JSON.parse(jsonStr);
            if (parsed.files && Array.isArray(parsed.files)) {
              if (!parsed.summary) {
                parsed.summary = `Generated ${parsed.files.length} file(s)`;
              }
              logger.debug(`[JsonParser] Extracted CodeChanges from files key (double-escaped): ${parsed.files.length} files`);
              attemptedStrategies.push('files-key-regex-double-escaped');
              return parsed as CodeChanges;
            }
          }
        } catch (retryError) {
          logger.debug(`[JsonParser] Failed to parse files key JSON: ${error}`);
        }
      }
    }
  }

  // Check for "already complete" responses without code changes
  const completePhrases = [
    'phase is complete', 'already complete', 'no changes needed', 'no changes required',
    'already exists', 'all.*files.*exist', 'already implemented', 'nothing to change',
    'task is complete', 'module creation phase is complete', 'content type.*phase is complete',
    'plugin system.*complete', 'already done', 'no modifications needed', 'no code changes',
  ];

  const lowerText = text.toLowerCase();
  for (const phrase of completePhrases) {
    const regex = new RegExp(phrase, 'i');
    if (regex.test(lowerText)) {
      let summary = 'Task already complete - no changes needed';
      const sentences = text.split(/[.!?\n]/).filter(s => s.trim().length > 20);
      if (sentences.length > 0) {
        summary = sentences[0].trim().substring(0, 500);
      }
      logger.debug(`[JsonParser] Detected "already complete" response, returning empty CodeChanges`);
      attemptedStrategies.push('already-complete-phrase');
      return { files: [], summary: summary };
    }
  }

  return null;
}

