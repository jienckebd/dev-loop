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
import { emitEvent } from '../../core/event-stream';

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
 * Sanitize JSON string to handle literal newlines and control characters
 *
 * AI providers sometimes include literal newlines in JSON string values,
 * which is invalid JSON. This function detects and escapes them.
 *
 * @param jsonStr - Raw JSON string that may contain literal control characters
 * @returns Sanitized JSON string safe for parsing
 */
export function sanitizeJsonString(jsonStr: string): { sanitized: string; modified: boolean; fixes: string[] } {
  const fixes: string[] = [];
  let modified = false;
  let result = jsonStr;

  // Fix 1: Escape literal newlines inside string values
  // This regex finds strings and escapes any literal newlines within them
  const stringContentRegex = /"(?:[^"\\]|\\.)*"/g;
  result = result.replace(stringContentRegex, (match) => {
    // Check for literal control characters (not already escaped)
    let fixed = match;

    // Replace literal newlines (not \n) with \\n
    if (fixed.includes('\n')) {
      fixed = fixed.replace(/\n/g, '\\n');
      if (!fixes.includes('literal-newline')) {
        fixes.push('literal-newline');
        modified = true;
      }
    }

    // Replace literal carriage returns with \\r
    if (fixed.includes('\r')) {
      fixed = fixed.replace(/\r/g, '\\r');
      if (!fixes.includes('literal-carriage-return')) {
        fixes.push('literal-carriage-return');
        modified = true;
      }
    }

    // Replace literal tabs with \\t
    if (fixed.includes('\t')) {
      fixed = fixed.replace(/\t/g, '\\t');
      if (!fixes.includes('literal-tab')) {
        fixes.push('literal-tab');
        modified = true;
      }
    }

    return fixed;
  });

  // Fix 2: Handle unescaped control characters outside strings (rare but possible)
  // Control chars 0x00-0x1F except those already handled
  const controlCharRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
  if (controlCharRegex.test(result)) {
    result = result.replace(controlCharRegex, (char) => {
      if (!fixes.includes('control-character')) {
        fixes.push('control-character');
        modified = true;
      }
      return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
    });
  }

  return { sanitized: result, modified, fixes };
}

/**
 * Try to parse JSON with multiple sanitization strategies
 * Returns the parsed object or null if all attempts fail
 */
function tryParseJsonWithSanitization(
  jsonStr: string,
  context?: JsonParsingContext
): { parsed: any; strategy: string } | null {
  const taskId = context?.taskId;
  const prdId = context?.prdId;
  const phaseId = context?.phaseId;

  // Strategy 1: Try raw parse first (most common success case)
  try {
    const parsed = JSON.parse(jsonStr);
    return { parsed, strategy: 'raw' };
  } catch (rawError) {
    // Continue to sanitization strategies
  }

  // Strategy 2: Sanitize control characters in strings
  const { sanitized, modified, fixes } = sanitizeJsonString(jsonStr);
  if (modified) {
    try {
      const parsed = JSON.parse(sanitized);
      emitEvent('json:sanitized', {
        fixes,
        originalLength: jsonStr.length,
        sanitizedLength: sanitized.length,
      }, { taskId, prdId, phaseId, severity: 'info' });
      logger.debug(`[JsonParser] Sanitized JSON with fixes: ${fixes.join(', ')}`);
      return { parsed, strategy: 'sanitized-' + fixes.join('-') };
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Double-escaped JSON (\\n -> \n, \\" -> ")
  try {
    const unescaped = jsonStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\');
    const parsed = JSON.parse(unescaped);
    return { parsed, strategy: 'double-escaped' };
  } catch {
    // Continue
  }

  // Strategy 4: Triple-escaped JSON
  try {
    let unescaped = jsonStr.replace(/\\\\\\\\/g, '\\\\');
    unescaped = unescaped.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"');
    const parsed = JSON.parse(unescaped);
    return { parsed, strategy: 'triple-escaped' };
  } catch {
    // Continue
  }

  // Strategy 5: Simple unescape (\\n -> newline literal, then re-sanitize)
  try {
    let unescaped = jsonStr.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const { sanitized: reSanitized } = sanitizeJsonString(unescaped);
    const parsed = JSON.parse(reSanitized);
    return { parsed, strategy: 'unescape-resanitize' };
  } catch {
    // All strategies failed
  }

  return null;
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
          // Log for debugging
          const hasJsonBlock = resultText.includes('```json') || resultText.includes('```\n{');
          logger.debug(`[JsonParser] Result text length: ${resultText.length}, has JSON block: ${hasJsonBlock}`);

          // Strategy A: Detect Cursor's nested markdown format: "```json\\n{...}\\n```"
          // This pattern occurs when Cursor stringifies a markdown code block
          const cursorNestedEscapedPattern = /```json\\n([\s\S]*?)\\n```/;
          const cursorNestedMatch = resultText.match(cursorNestedEscapedPattern);
          if (cursorNestedMatch) {
            // Extract the JSON from the escaped markdown block
            let extractedJson = cursorNestedMatch[1];
            // Unescape: \\n -> \n, \\" -> ", \\\\ -> \
            extractedJson = extractedJson
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\');
            attemptedStrategies.push('cursor-nested-markdown-extraction');
            logger.debug(`[JsonParser] Extracted from Cursor nested markdown pattern`);

            // Try to parse the extracted JSON directly
            try {
              const directParsed = JSON.parse(extractedJson);
              if (directParsed.files && directParsed.summary !== undefined) {
                logger.debug(`[JsonParser] Successfully parsed CodeChanges from nested markdown: ${directParsed.files.length} files`);
                return directParsed as CodeChanges;
              }
            } catch {
              // Continue with text extraction
            }

            // Try extracting from the unescaped text
            result = parseCodeChangesFromText(extractedJson, attemptedStrategies);
            if (result) {
              logger.debug(`[JsonParser] Extracted CodeChanges from nested markdown via text parser: ${result.files.length} files`);
              return result;
            }
          }

          // Strategy B: Multiple passes to handle triple-escaped JSON (\\\\n -> \\n -> \n)
          // First pass: unescape \\n to newlines, \\" to quotes (for doubly-escaped content)
          if (resultText.includes('\\n') || resultText.includes('\\"')) {
            resultText = resultText.replace(/\\n/g, '\n').replace(/\\"/g, '"');
            logger.debug(`[JsonParser] Applied first unescape pass`);
          }
          // Second pass: handle remaining backslashes (for nested JSON in content)
          if (resultText.includes('\\\\')) {
            resultText = resultText.replace(/\\\\/g, '\\');
            logger.debug(`[JsonParser] Applied second unescape pass`);
          }
          attemptedStrategies.push('result-object-deep-unescape');

          // Log a snippet of the processed text
          const hasJsonBlockAfter = resultText.includes('```json') || resultText.includes('```\n{');
          logger.debug(`[JsonParser] After unescape - has JSON block: ${hasJsonBlockAfter}, snippet: ${resultText.substring(0, 300).replace(/\n/g, '\\n')}`);
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

  // Emit json:parse_failed event for observability
  emitEvent('json:parse_failed', {
    attemptedStrategies,
    responseSample,
    providerName,
    responseType: typeof response,
  }, {
    taskId: context?.taskId,
    prdId: context?.prdId,
    phaseId: context?.phaseId,
    severity: 'warn',
  });

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
 * Wrapper for extractCodeChanges that emits success/retry events
 */
export function extractCodeChangesWithEvents(
  response: any,
  observationTracker?: ObservationTracker,
  context?: JsonParsingContext,
  retryCount: number = 0
): CodeChanges | null {
  const result = extractCodeChanges(response, observationTracker, context);

  if (result) {
    // Emit success event
    emitEvent('json:parse_success', {
      fileCount: result.files.length,
      retryCount,
      providerName: context?.providerName || 'unknown',
    }, {
      taskId: context?.taskId,
      prdId: context?.prdId,
      phaseId: context?.phaseId,
      severity: 'info',
    });
  } else if (retryCount > 0) {
    // Emit retry event (already failed once, now retrying)
    emitEvent('json:parse_retry', {
      retryCount,
      providerName: context?.providerName || 'unknown',
    }, {
      taskId: context?.taskId,
      prdId: context?.prdId,
      phaseId: context?.phaseId,
      severity: 'warn',
    });
  }

  return result;
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

    // Use the new sanitization-aware parser
    const parseResult = tryParseJsonWithSanitization(jsonStr);
    if (parseResult) {
      const { parsed, strategy } = parseResult;
      if (parsed.files && Array.isArray(parsed.files)) {
        if (!parsed.summary) parsed.summary = `Generated ${parsed.files.length} file(s)`;
        logger.debug(`[JsonParser] Extracted CodeChanges from JSON code block (strategy: ${strategy}): ${parsed.files.length} files`);
        attemptedStrategies.push(`json-code-block-${strategy}`);
        return parsed as CodeChanges;
      }
    }

    // Try progressive unescaping for deeply nested escaped JSON (fallback)
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
        // Try sanitization on unescaped result
        const { sanitized } = sanitizeJsonString(unescaped);
        const parsed = JSON.parse(sanitized);
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

    // Log warning if all strategies failed for this block
    const snippet = jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '');
    logger.warn(`[JsonParser] Failed to parse JSON from code block after all strategies. Snippet: ${snippet}`);
  }

  // Try to find CodeChanges structure anywhere in text (more flexible regex)
  const codeChangesRegex = /\{\s*"files"\s*:\s*\[[\s\S]{0,50000}?\]\s*,\s*"summary"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}/;
  const codeChangesMatch = processedText.match(codeChangesRegex);
  if (codeChangesMatch) {
    let jsonStr = codeChangesMatch[0];
    attemptedStrategies.push('codeChanges-regex');

    // Use sanitization-aware parser
    const parseResult = tryParseJsonWithSanitization(jsonStr);
    if (parseResult) {
      const { parsed, strategy } = parseResult;
      if (parsed.files && Array.isArray(parsed.files) && parsed.summary) {
        logger.debug(`[JsonParser] Extracted CodeChanges from text (strategy: ${strategy}): ${parsed.files.length} files`);
        attemptedStrategies.push(`codeChanges-regex-${strategy}`);
        return parsed as CodeChanges;
      }
    }
    logger.debug(`[JsonParser] Failed to parse CodeChanges JSON with all sanitization strategies`);
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

      // Use sanitization-aware parser
      const parseResult = tryParseJsonWithSanitization(jsonStr);
      if (parseResult) {
        const { parsed, strategy } = parseResult;
        if (parsed.files && Array.isArray(parsed.files)) {
          if (!parsed.summary) {
            parsed.summary = `Generated ${parsed.files.length} file(s)`;
          }
          logger.debug(`[JsonParser] Extracted CodeChanges using balanced brace algorithm (strategy: ${strategy}): ${parsed.files.length} files`);
          attemptedStrategies.push(`balanced-braces-${strategy}`);
          return parsed as CodeChanges;
        }
      }
      logger.debug(`[JsonParser] Failed to parse balanced brace JSON with all sanitization strategies`);
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

      // Use sanitization-aware parser
      const parseResult = tryParseJsonWithSanitization(jsonStr);
      if (parseResult) {
        const { parsed, strategy } = parseResult;
        if (parsed.files && Array.isArray(parsed.files)) {
          if (!parsed.summary) {
            parsed.summary = `Generated ${parsed.files.length} file(s)`;
          }
          logger.debug(`[JsonParser] Extracted CodeChanges from files key (strategy: ${strategy}): ${parsed.files.length} files`);
          attemptedStrategies.push(`files-key-regex-${strategy}`);
          return parsed as CodeChanges;
        }
      }
      logger.debug(`[JsonParser] Failed to parse files key JSON with all sanitization strategies`);
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

/**
 * AI-Assisted JSON Extraction Fallback
 *
 * When all regex-based parsing strategies fail, use AI to extract
 * CodeChanges from complex/nested response formats.
 *
 * This is a "medium-term" solution that provides reliability while
 * the root cause (nested JSON formats) is addressed.
 *
 * @param response - The raw response that failed parsing
 * @param execCommand - Function to execute AI command (injected to avoid circular deps)
 * @param context - Parsing context for tracking
 * @returns CodeChanges or null
 */
export async function extractCodeChangesWithAiFallback(
  response: any,
  execCommand: (prompt: string) => Promise<string>,
  context?: JsonParsingContext
): Promise<CodeChanges | null> {
  // Only attempt AI fallback if response looks like it contains JSON-like content
  const responseStr = typeof response === 'string'
    ? response
    : JSON.stringify(response);

  // Quick check: must contain JSON indicators
  const hasJsonIndicators =
    responseStr.includes('"files"') ||
    responseStr.includes('```json') ||
    responseStr.includes('"path"') ||
    responseStr.includes('"content"');

  if (!hasJsonIndicators) {
    logger.debug(`[JsonParser] AI fallback skipped: no JSON indicators in response`);
    return null;
  }

  // Limit response size to avoid token waste
  const truncatedResponse = responseStr.length > 12000
    ? responseStr.substring(0, 12000) + '...[truncated]'
    : responseStr;

  const extractionPrompt = `You are a JSON extraction tool. Extract the CodeChanges structure from this AI response.

The response may contain:
- Nested JSON objects (response.text containing stringified JSON)
- Markdown code blocks (\`\`\`json ... \`\`\`)
- Escaped or double-escaped JSON (\\n, \\", etc.)
- Narrative text before/after the JSON

Find and return ONLY the valid JSON object with this EXACT structure:
{
  "files": [
    {
      "path": "path/to/file.ext",
      "content": "file content here",
      "operation": "create"
    }
  ],
  "summary": "Description of changes"
}

CRITICAL RULES:
1. Return ONLY the JSON object, no explanation
2. If multiple JSON blocks exist, use the one with "files" array
3. Properly unescape any escaped content
4. If no valid CodeChanges found, return: {"files": [], "summary": "No code changes found"}

Response to parse:
${truncatedResponse}`;

  try {
    logger.info(`[JsonParser] Attempting AI-assisted extraction fallback`);

    const aiResponse = await execCommand(extractionPrompt);

    // Try to parse the AI response
    if (aiResponse) {
      // Extract JSON from AI response (may include markdown)
      const jsonMatch = aiResponse.match(/\{[\s\S]*"files"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.files && Array.isArray(parsed.files)) {
            logger.info(`[JsonParser] AI fallback succeeded: ${parsed.files.length} files extracted`);

            // Emit success event
            emitEvent('json:ai_fallback_success', {
              fileCount: parsed.files.length,
              providerName: context?.providerName || 'unknown',
              originalResponseLength: responseStr.length,
            }, {
              taskId: context?.taskId,
              prdId: context?.prdId,
              phaseId: context?.phaseId,
              severity: 'info',
            });

            return parsed as CodeChanges;
          }
        } catch (parseError) {
          logger.warn(`[JsonParser] AI fallback response not valid JSON: ${parseError}`);
        }
      }

      // Try sanitization on AI response
      const { sanitized } = sanitizeJsonString(aiResponse);
      try {
        const parsed = JSON.parse(sanitized);
        if (parsed.files && Array.isArray(parsed.files)) {
          logger.info(`[JsonParser] AI fallback succeeded after sanitization: ${parsed.files.length} files`);
          return parsed as CodeChanges;
        }
      } catch {
        // Continue
      }
    }

    logger.warn(`[JsonParser] AI fallback did not return valid CodeChanges`);

    // Emit failure event
    emitEvent('json:ai_fallback_failed', {
      providerName: context?.providerName || 'unknown',
      originalResponseLength: responseStr.length,
    }, {
      taskId: context?.taskId,
      prdId: context?.prdId,
      phaseId: context?.phaseId,
      severity: 'warn',
    });

  } catch (error) {
    logger.error(`[JsonParser] AI fallback error: ${error}`);

    emitEvent('json:ai_fallback_error', {
      error: error instanceof Error ? error.message : String(error),
      providerName: context?.providerName || 'unknown',
    }, {
      taskId: context?.taskId,
      prdId: context?.prdId,
      phaseId: context?.phaseId,
      severity: 'error',
    });
  }

  return null;
}

/**
 * Check if a response is a candidate for AI fallback
 *
 * Returns true if:
 * - Response contains JSON-like structures
 * - Standard parsing has failed
 * - Response is not obviously non-JSON
 */
export function shouldUseAiFallback(response: any): boolean {
  if (!response) return false;

  const responseStr = typeof response === 'string'
    ? response
    : JSON.stringify(response);

  // Must have some JSON indicators
  const hasJsonIndicators =
    responseStr.includes('"files"') ||
    responseStr.includes('```json') ||
    (responseStr.includes('"path"') && responseStr.includes('"content"'));

  // Must not be too short (likely error message)
  const isSubstantial = responseStr.length > 100;

  // Must not be obviously an error
  const isNotError = !responseStr.toLowerCase().includes('error:') ||
    responseStr.includes('"files"');

  return hasJsonIndicators && isSubstantial && isNotError;
}

