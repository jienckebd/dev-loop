/**
 * MCP Response Truncation Utility
 *
 * Truncates large MCP tool responses to prevent context overflow.
 * Approximates token count using character count (rough estimate: 1 token ≈ 4 characters).
 */

/**
 * Estimate token count from text (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  // Rough approximation: average token is ~4 characters for English text/code
  return Math.ceil(text.length / 4);
}

/**
 * Truncate JSON string response while preserving JSON validity
 *
 * @param jsonString - JSON string to truncate
 * @param maxTokens - Maximum tokens allowed
 * @param warningThreshold - Token count threshold for warnings
 * @returns Truncated JSON string with warning if truncated
 */
export function truncateMcpResponse(
  jsonString: string,
  maxTokens: number = 25000,
  warningThreshold: number = 10000
): { response: string; truncated: boolean; warning?: string } {
  const estimatedTokens = estimateTokens(jsonString);

  // No truncation needed
  if (estimatedTokens <= maxTokens) {
    // Log warning if approaching limit
    if (estimatedTokens > warningThreshold) {
      return {
        response: jsonString,
        truncated: false,
        warning: `Response size (${estimatedTokens} estimated tokens) is approaching limit (${maxTokens} tokens)`,
      };
    }
    return { response: jsonString, truncated: false };
  }

  // Need to truncate - try to truncate while preserving JSON structure
  // Strategy: If it's a JSON object, truncate array items or large string values
  try {
    const parsed = JSON.parse(jsonString);
    const truncated = truncateJsonObject(parsed, maxTokens);
    const truncatedString = JSON.stringify(truncated);
    const finalTokenCount = estimateTokens(truncatedString);

    return {
      response: truncatedString,
      truncated: true,
      warning: `Response truncated from ${estimatedTokens} to ${finalTokenCount} tokens (limit: ${maxTokens})`,
    };
  } catch {
    // Not valid JSON, truncate as plain string
    const maxChars = maxTokens * 4; // Rough char limit
    const truncated = jsonString.substring(0, maxChars) + '...[truncated]';
    return {
      response: truncated,
      truncated: true,
      warning: `Response truncated from ${estimatedTokens} to ${maxTokens} tokens (limit: ${maxTokens})`,
    };
  }
}

/**
 * Truncate a JSON object while preserving structure
 * Prioritizes keeping object structure over array content
 */
function truncateJsonObject(obj: any, maxTokens: number): any {
  const jsonString = JSON.stringify(obj);
  const estimatedTokens = estimateTokens(jsonString);

  if (estimatedTokens <= maxTokens) {
    return obj;
  }

  // If it's an array, truncate items
  if (Array.isArray(obj)) {
    const itemSize = estimatedTokens / obj.length;
    const maxItems = Math.floor(maxTokens / itemSize);
    return obj.slice(0, maxItems);
  }

  // If it's an object, truncate large string values and arrays
  if (typeof obj === 'object' && obj !== null) {
    const truncated: any = {};
    let currentTokens = 0;
    const baseTokens = estimateTokens('{}'); // Base object overhead

    for (const [key, value] of Object.entries(obj)) {
      const keyTokens = estimateTokens(key + ':');
      const valueString = JSON.stringify(value);
      const valueTokens = estimateTokens(valueString);

      if (currentTokens + baseTokens + keyTokens + valueTokens <= maxTokens) {
        truncated[key] = value;
        currentTokens += keyTokens + valueTokens;
      } else {
        // Truncate this value if it's large
        if (Array.isArray(value)) {
          truncated[key] = value.slice(0, Math.max(1, Math.floor((maxTokens - currentTokens - keyTokens) / (valueTokens / value.length))));
        } else if (typeof value === 'string') {
          const maxStringTokens = maxTokens - currentTokens - keyTokens - 100; // Buffer
          truncated[key] = value.substring(0, maxStringTokens * 4) + '...[truncated]';
        } else {
          truncated[key] = '[truncated]';
        }
        break;
      }
    }

    return truncated;
  }

  // Primitive value - truncate string
  if (typeof obj === 'string') {
    const maxChars = maxTokens * 4;
    return obj.substring(0, maxChars) + '...[truncated]';
  }

  return obj;
}
