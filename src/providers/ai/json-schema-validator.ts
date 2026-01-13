/**
 * JSON Schema Validator for CodeChanges
 * 
 * Validates AI provider responses against the CodeChanges JSON schema
 * to ensure consistent parsing across all providers.
 * 
 * Uses a multi-strategy extraction pipeline with adaptive ordering
 * and hybrid approach (custom extraction + partial-json-parser-js).
 */

import { CodeChanges } from '../../types';
import { CODE_CHANGES_JSON_SCHEMA } from './code-changes-schema';
import { logger } from '../../core/utils/logger';
import * as fs from 'fs-extra';
import * as path from 'path';

// Import partial-json-parser-js for edge cases
let parsePartialJson: ((jsonString: string, allowPartial?: number) => any) | null = null;
let Allow: any = null;
try {
  const partialJson = require('partial-json');
  parsePartialJson = partialJson.parse || partialJson.parseJSON;
  Allow = partialJson.Allow;
} catch (error) {
  logger.warn('[JsonSchemaValidator] partial-json not available, will use fallback methods only');
}

/**
 * Validation modes for different JSON structures
 */
export type ValidationMode = 'code-changes' | 'array' | 'object' | 'any';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized?: CodeChanges;
}

/**
 * Generic validation result for non-CodeChanges validation
 */
export interface GenericValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  extracted?: any;
  type: 'object' | 'array' | 'null' | 'primitive';
}

export interface Candidate {
  json: string;
  strategy: string;
  score: number;
  validationResult?: ValidationResult;
}

/**
 * Extraction Strategy Interface
 */
interface ExtractionStrategy {
  name: string;
  extract(text: string): string[]; // Returns array of candidate JSON strings
  score(candidate: string): number; // Confidence score 0-1
}

/**
 * Strategy Statistics for Adaptive Ordering
 */
interface StrategyStats {
  attempts: number;
  successes: number;
  lastSuccess?: number; // Timestamp of last success
}

/**
 * Simple JSON Schema validator (lightweight, no external dependencies)
 * 
 * This implements basic JSON Schema validation for CodeChanges structure.
 * Enhanced with multi-strategy extraction and adaptive learning.
 */
export class JsonSchemaValidator {
  // Strategy statistics for adaptive ordering
  private static strategyStats: Map<string, StrategyStats> = new Map();
  private static statsPath: string = path.resolve(process.cwd(), '.devloop/json-parsing-stats.json');
  private static statsLoaded: boolean = false;

  /**
   * Load strategy statistics from disk
   */
  private static loadStrategyStats(): void {
    if (this.statsLoaded) return;
    
    try {
      if (fs.existsSync(this.statsPath)) {
        const data = fs.readJsonSync(this.statsPath);
        this.strategyStats = new Map(Object.entries(data));
        logger.debug(`[JsonSchemaValidator] Loaded strategy stats: ${this.strategyStats.size} strategies`);
      }
    } catch (error) {
      logger.warn(`[JsonSchemaValidator] Failed to load strategy stats: ${error}`);
    }
    
    this.statsLoaded = true;
  }

  /**
   * Save strategy statistics to disk
   */
  private static saveStrategyStats(): void {
    try {
      fs.ensureDirSync(path.dirname(this.statsPath));
      const data = Object.fromEntries(this.strategyStats);
      fs.writeJsonSync(this.statsPath, data, { spaces: 2 });
    } catch (error) {
      logger.warn(`[JsonSchemaValidator] Failed to save strategy stats: ${error}`);
    }
  }

  /**
   * Update strategy statistics
   */
  private static updateStrategyStats(strategyName: string, success: boolean): void {
    this.loadStrategyStats();
    
    const stats = this.strategyStats.get(strategyName) || { attempts: 0, successes: 0 };
    stats.attempts++;
    if (success) {
      stats.successes++;
      stats.lastSuccess = Date.now();
    }
    this.strategyStats.set(strategyName, stats);
    
    // Save periodically (every 10 attempts)
    if (stats.attempts % 10 === 0) {
      this.saveStrategyStats();
    }
  }

  /**
   * Get strategy success rate
   */
  private static getStrategySuccessRate(strategyName: string): number {
    this.loadStrategyStats();
    const stats = this.strategyStats.get(strategyName);
    if (!stats || stats.attempts === 0) {
      return 0.5; // Default confidence for untested strategies
    }
    return stats.successes / stats.attempts;
  }

  /**
   * Unescape JSON string (handle escaped quotes, newlines, etc.)
   * Uses partial-json-parser-js as fallback for complex cases
   */
  private static unescapeJsonString(text: string): string {
    // First attempt: Standard unescaping
    // Handle: {\"files\": [...]} -> {"files": [...]}
    // Handle: \\" -> "
    // Handle: \\n -> \n
    
    let unescaped = text;
    
    // Multiple passes for nested escaping
    for (let pass = 0; pass < 3; pass++) {
      // Unescape double-escaped quotes: \\\" -> \"
      unescaped = unescaped.replace(/\\\\"/g, '\\"');
      // Unescape escaped quotes: \" -> "
      unescaped = unescaped.replace(/\\"/g, '"');
      // Unescape escaped newlines: \\n -> \n
      unescaped = unescaped.replace(/\\\\n/g, '\\n');
      // Unescape newlines: \n -> newline
      unescaped = unescaped.replace(/\\n/g, '\n');
      // Unescape escaped backslashes: \\\\ -> \\
      unescaped = unescaped.replace(/\\\\\\\\/g, '\\\\');
    }
    
    return unescaped;
  }

  /**
   * Try to parse JSON with multiple methods
   */
  private static tryParseJson(jsonString: string): { success: boolean; parsed?: any; method: string } {
    // Method 1: Standard JSON.parse
    try {
      const parsed = JSON.parse(jsonString);
      return { success: true, parsed, method: 'standard' };
    } catch {
      // Continue to next method
    }

    // Method 2: Unescape and try again
    try {
      const unescaped = this.unescapeJsonString(jsonString);
      const parsed = JSON.parse(unescaped);
      return { success: true, parsed, method: 'unescaped' };
    } catch {
      // Continue to next method
    }

    // Method 3: partial-json-parser-js (for truncated/incomplete JSON)
    if (parsePartialJson && Allow) {
      try {
        // Try with all partial types allowed
        const parsed = parsePartialJson(jsonString, Allow.ALL);
        return { success: true, parsed, method: 'partial-json' };
      } catch {
        // Continue to next method
      }
    }

    return { success: false, method: 'none' };
  }

  /**
   * Strategy 1: Direct JSON Parse
   */
  private static strategy1_DirectParse(text: string): ExtractionStrategy {
    return {
      name: 'direct-parse',
      extract: (text: string): string[] => {
        const result = this.tryParseJson(text);
        return result.success ? [text] : [];
      },
      score: (candidate: string): number => {
        return 1.0; // High confidence for direct parse
      }
    };
  }

  /**
   * Strategy 2: Markdown Code Blocks
   */
  private static strategy2_MarkdownBlocks(text: string): ExtractionStrategy {
    return {
      name: 'markdown-blocks',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        // Match various markdown code block formats
        const patterns = [
          /```json\s*([\s\S]*?)\s*```/g,
          /```\s*([\s\S]*?)\s*```/g,
          /`([^`]+)`/g // Inline code blocks
        ];
        
        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const candidate = match[1].trim();
            if (candidate.startsWith('{') && candidate.includes('files')) {
              candidates.push(candidate);
            }
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        // Higher score if it looks like CodeChanges
        let score = 0.7;
        if (candidate.includes('"files"') && candidate.includes('"summary"')) {
          score = 0.9;
        }
        return score;
      }
    };
  }

  /**
   * Strategy 3: JSON After Phrases
   */
  private static strategy3_AfterPhrases(text: string): ExtractionStrategy {
    return {
      name: 'after-phrases',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        // Expanded phrase list based on observed patterns
        const phrases = [
          'returning the json response:',
          'returning json confirmation:',
          'returning json:',
          'json format:',
          'json response:',
          'response:',
          'result:',
          'here\'s the json:',
          'json:',
          'returning:',
          'format:'
        ];
        
        for (const phrase of phrases) {
          const regex = new RegExp(`${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\n]*([\\s\\S]*?)(?=\\n\\n|\\n\\*|$)`, 'i');
          const match = text.match(regex);
          if (match && match[1]) {
            const candidate = match[1].trim();
            if (candidate.startsWith('{') || candidate.startsWith('[')) {
              candidates.push(candidate);
            }
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        let score = 0.6;
        if (candidate.includes('"files"')) {
          score = 0.8;
        }
        return score;
      }
    };
  }

  /**
   * Strategy 4: Balanced Brace Matching (Improved)
   */
  private static strategy4_BalancedBraces(text: string): ExtractionStrategy {
    return {
      name: 'balanced-braces',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        const jsonObjects: string[] = [];
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
                // Check for schema fields
                if (candidate.includes('files') || candidate.includes('summary')) {
                  jsonObjects.push(candidate);
                }
                start = -1;
              }
            }
          }
        }

        // Sort by size (largest first) and return top candidates
        return jsonObjects.sort((a, b) => b.length - a.length).slice(0, 5);
      },
      score: (candidate: string): number => {
        let score = 0.5;
        if (candidate.includes('"files"') && candidate.includes('"summary"')) {
          score = 0.85;
        } else if (candidate.includes('"files"')) {
          score = 0.7;
        }
        return score;
      }
    };
  }

  /**
   * Strategy 5: Unescape JSON Strings (using partial-json-parser-js)
   */
  private static strategy5_UnescapeJson(text: string): ExtractionStrategy {
    return {
      name: 'unescape-json',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Find escaped JSON patterns: {\"files\": or {\\\"files\\\":
        const escapedPatterns = [
          /\{\\*"files\\*"/g,
          /\{\\*"summary\\*"/g,
          /\\*"files\\*":/g
        ];
        
        for (const pattern of escapedPatterns) {
          const matches = text.matchAll(pattern);
          for (const match of matches) {
            // Extract JSON object starting from this position
            const startPos = Math.max(0, match.index! - 50);
            const endPos = Math.min(text.length, match.index! + 2000);
            const candidate = text.substring(startPos, endPos);
            
            // Try to find the complete JSON object
            const jsonMatch = candidate.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const unescaped = this.unescapeJsonString(jsonMatch[0]);
              candidates.push(unescaped);
            }
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        return 0.75; // Medium-high confidence
      }
    };
  }

  /**
   * Strategy 6: Extract from Nested Result Objects
   */
  private static strategy6_NestedResults(text: string): ExtractionStrategy {
    return {
      name: 'nested-results',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Try to parse as JSON object first
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') {
            // Recursively extract from result fields
            const extractFromResult = (obj: any, depth: number = 0): void => {
              if (depth > 5) return; // Prevent infinite recursion
              
              if (obj && typeof obj === 'object') {
                if (obj.result && typeof obj.result === 'string') {
                  candidates.push(obj.result);
                  // Try to parse the result string as JSON
                  try {
                    const nested = JSON.parse(obj.result);
                    extractFromResult(nested, depth + 1);
                  } catch {
                    // Not JSON, continue
                  }
                } else if (obj.text && typeof obj.text === 'string') {
                  candidates.push(obj.text);
                } else if (obj.response && typeof obj.response === 'string') {
                  candidates.push(obj.response);
                }
              }
            };
            
            extractFromResult(parsed);
          }
        } catch {
          // Not valid JSON, continue
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        return 0.65; // Medium confidence
      }
    };
  }

  /**
   * Strategy 7: Find JSON Objects by Schema Field Presence
   */
  private static strategy7_SchemaFieldDetection(text: string): ExtractionStrategy {
    return {
      name: 'schema-field-detection',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Find positions of "files" and "summary" fields
        const filesMatches = [...text.matchAll(/"files"\s*:/gi)];
        const summaryMatches = [...text.matchAll(/"summary"\s*:/gi)];
        
        // For each "files" match, try to extract the containing JSON object
        for (const match of filesMatches) {
          const startPos = match.index!;
          // Look backwards for opening brace
          let braceStart = -1;
          for (let i = startPos; i >= 0; i--) {
            if (text[i] === '{') {
              braceStart = i;
              break;
            }
          }
          
          if (braceStart !== -1) {
            // Look forwards for matching closing brace
            let depth = 0;
            let inString = false;
            let escapeNext = false;
            let braceEnd = -1;
            
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
                if (char === '{') {
                  depth++;
                } else if (char === '}') {
                  depth--;
                  if (depth === 0) {
                    braceEnd = i;
                    break;
                  }
                }
              }
            }
            
            if (braceEnd !== -1) {
              const candidate = text.substring(braceStart, braceEnd + 1);
              candidates.push(candidate);
            }
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        let score = 0.8;
        if (candidate.includes('"files"') && candidate.includes('"summary"')) {
          score = 0.95; // Very high confidence
        }
        return score;
      }
    };
  }

  /**
   * Strategy 8: Regex-based Extraction with Validation
   */
  private static strategy8_RegexExtraction(text: string): ExtractionStrategy {
    return {
      name: 'regex-extraction',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Multiple regex patterns to find JSON objects
        const patterns = [
          /\{\s*"files"\s*:\s*\[[\s\S]*?\]\s*,\s*"summary"\s*:\s*"[^"]*"\s*\}/g,
          /\{\s*"files"\s*:\s*\[[\s\S]*?\]\s*\}/g,
          /\{\s*"summary"\s*:\s*"[^"]*"\s*,\s*"files"\s*:\s*\[[\s\S]*?\]\s*\}/g
        ];
        
        for (const pattern of patterns) {
          const matches = text.matchAll(pattern);
          for (const match of matches) {
            candidates.push(match[0]);
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        return 0.6; // Medium confidence
      }
    };
  }

  /**
   * Strategy 9: Partial JSON Parser Fallback
   */
  private static strategy9_PartialJsonFallback(text: string): ExtractionStrategy {
    return {
      name: 'partial-json-fallback',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        if (!parsePartialJson || !Allow) {
          return candidates; // Not available
        }
        
        // Try to find incomplete JSON objects that might be truncated
        // Look for patterns that suggest incomplete JSON
        const incompletePatterns = [
          /\{\s*"files"\s*:\s*\[[\s\S]*$/g, // Ends with array
          /\{\s*"summary"\s*:\s*"[^"]*$/g, // Ends with string
          /\{\s*"files"\s*:\s*\[[\s\S]*?,\s*\{[\s\S]*$/g // Ends in middle of object
        ];
        
        for (const pattern of incompletePatterns) {
          const matches = text.matchAll(pattern);
          for (const match of matches) {
            try {
              // Try to parse as partial JSON
              const parsed = parsePartialJson(match[0], Allow.ALL);
              if (parsed && typeof parsed === 'object') {
                // Convert back to JSON string for validation
                candidates.push(JSON.stringify(parsed));
              }
            } catch {
              // Not parseable even as partial
            }
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        return 0.5; // Lower confidence for partial JSON
      }
    };
  }

  /**
   * Strategy 10: YAML to JSON Conversion
   * Handles multi-document YAML separated by ---
   */
  private static strategy10_YamlToJson(text: string): ExtractionStrategy {
    return {
      name: 'yaml-to-json',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Check if text contains YAML document separators
        if (!text.includes('---')) {
          return candidates;
        }
        
        try {
          // Try to import yaml parser
          const yaml = require('js-yaml');
          
          // Split by YAML document separator and parse each
          const documents = text.split(/^---$/m).filter(doc => doc.trim());
          
          for (const doc of documents) {
            try {
              const parsed = yaml.load(doc.trim());
              if (parsed && typeof parsed === 'object') {
                // Check if it looks like CodeChanges
                if (parsed.files && Array.isArray(parsed.files)) {
                  candidates.push(JSON.stringify(parsed));
                }
              }
            } catch {
              // Not valid YAML
            }
          }
          
          // Also try parsing entire text as YAML
          try {
            const parsed = yaml.load(text);
            if (parsed && typeof parsed === 'object' && parsed.files) {
              candidates.push(JSON.stringify(parsed));
            }
          } catch {
            // Not valid YAML
          }
        } catch {
          // js-yaml not available, skip this strategy
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        return 0.7; // Medium-high confidence for YAML conversion
      }
    };
  }

  /**
   * Strategy 11: Strip Conversational Preamble
   * Removes conversational text before JSON/code blocks
   */
  private static strategy11_StripPreamble(text: string): ExtractionStrategy {
    return {
      name: 'strip-preamble',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Common preamble patterns to strip
        const preamblePatterns = [
          /^.*?(?=\{)/s, // Everything before first {
          /^.*?Here(?:'s| is)(?: the)? (?:JSON|response|result)[:\s]*/is, // "Here's the JSON:"
          /^.*?(?:The |This )?(?:JSON|response|result|output)(?: is)?[:\s]*/is, // "The JSON is:"
          /^.*?(?:Returning|Generated)[:\s]*/is, // "Returning:" or "Generated:"
          /^.*?(?:I've |I have )?(?:created|generated|produced)[^{]*\{/is // "I've created..." before {
        ];
        
        for (const pattern of preamblePatterns) {
          const strippedText = text.replace(pattern, '{');
          if (strippedText !== text && strippedText.startsWith('{')) {
            // Find matching closing brace
            let depth = 0;
            let inString = false;
            let escapeNext = false;
            let endPos = -1;
            
            for (let i = 0; i < strippedText.length; i++) {
              const char = strippedText[i];
              
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
                if (char === '{') depth++;
                else if (char === '}') {
                  depth--;
                  if (depth === 0) {
                    endPos = i;
                    break;
                  }
                }
              }
            }
            
            if (endPos > 0) {
              const candidate = strippedText.substring(0, endPos + 1);
              if (candidate.includes('files')) {
                candidates.push(candidate);
              }
            }
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        let score = 0.65;
        if (candidate.includes('"files"') && candidate.includes('"summary"')) {
          score = 0.85;
        }
        return score;
      }
    };
  }

  /**
   * Strategy 12: Extract from Array Response
   * Handles responses that are arrays instead of objects with files key
   * Enhanced to handle more array patterns including test cases and generic arrays
   */
  private static strategy12_ArrayToCodeChanges(text: string): ExtractionStrategy {
    return {
      name: 'array-to-code-changes',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Find array bounds
        const arrayStart = text.indexOf('[');
        if (arrayStart === -1) return candidates;
        
        // Balance brackets to find array end
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let arrayEnd = -1;
        
        for (let i = arrayStart; i < text.length; i++) {
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
            if (char === '[') depth++;
            else if (char === ']') {
              depth--;
              if (depth === 0) {
                arrayEnd = i;
                break;
              }
            }
          }
        }
        
        if (arrayEnd > arrayStart) {
          const arrayText = text.substring(arrayStart, arrayEnd + 1);
          try {
            const parsed = JSON.parse(arrayText);
            if (Array.isArray(parsed) && parsed.length > 0) {
              // Check if items look like file operations
              const looksLikeFiles = parsed.some((item: any) => 
                item && typeof item === 'object' && 
                (item.path || item.file || item.filename) &&
                (item.content || item.operation || item.action)
              );
              
              if (looksLikeFiles) {
                // Convert to CodeChanges format
                const files = parsed.map((item: any) => ({
                  path: item.path || item.file || item.filename || 'unknown',
                  content: item.content || '',
                  operation: item.operation || item.action || 'create'
                }));
                const codeChanges = {
                  files,
                  summary: `Converted from array response with ${files.length} file(s)`
                };
                candidates.push(JSON.stringify(codeChanges));
              }
              
              // Check if items look like test cases (taskId, testCases pattern)
              const looksLikeTestCases = parsed.some((item: any) =>
                item && typeof item === 'object' &&
                (item.taskId || item.task_id) &&
                (item.testCases || item.test_cases || item.tests)
              );
              
              if (looksLikeTestCases) {
                // Wrap in object for test case responses
                const testPlan = {
                  testCases: parsed,
                  summary: `Converted from test case array with ${parsed.length} task(s)`
                };
                candidates.push(JSON.stringify(testPlan));
              }
              
              // Generic array - wrap in a results object
              if (!looksLikeFiles && !looksLikeTestCases) {
                const wrapped = {
                  results: parsed,
                  summary: `Wrapped array response with ${parsed.length} item(s)`
                };
                candidates.push(JSON.stringify(wrapped));
              }
            }
          } catch {
            // Not valid JSON array
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        return 0.6; // Medium confidence for converted arrays
      }
    };
  }

  /**
   * Strategy 13: Strip Conversational Preamble More Aggressively
   * Handles AI responses that start with explanatory text before the JSON
   */
  private static strategy13_AggressivePreambleStrip(text: string): ExtractionStrategy {
    return {
      name: 'aggressive-preamble-strip',
      extract: (text: string): string[] => {
        const candidates: string[] = [];
        
        // Common preamble patterns to strip
        const preamblePatterns = [
          /^.*?Generated\s+\d+.*?:\s*/si,
          /^.*?Here(?:'s| is) the (?:JSON|response|output).*?:\s*/si,
          /^.*?Test plans? (?:are|is) ready.*?:\s*/si,
          /^.*?I(?:'ve| have) (?:created|generated).*?:\s*/si,
          /^.*?Summary:?\s*/si,
          /^.*?(?:The )?following (?:is|are).*?:\s*/si,
        ];
        
        for (const pattern of preamblePatterns) {
          const stripped = text.replace(pattern, '');
          if (stripped !== text && stripped.trim()) {
            // Try to find JSON in the stripped text
            const jsonMatch = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
            if (jsonMatch) {
              try {
                JSON.parse(jsonMatch[1]);
                candidates.push(jsonMatch[1]);
              } catch {
                // Not valid JSON
              }
            }
          }
        }
        
        return candidates;
      },
      score: (candidate: string): number => {
        return 0.55; // Lower confidence for stripped preamble
      }
    };
  }

  /**
   * Get all extraction strategies
   */
  private static getAllStrategies(text: string): ExtractionStrategy[] {
    return [
      this.strategy1_DirectParse(text),
      this.strategy2_MarkdownBlocks(text),
      this.strategy3_AfterPhrases(text),
      this.strategy4_BalancedBraces(text),
      this.strategy5_UnescapeJson(text),
      this.strategy6_NestedResults(text),
      this.strategy7_SchemaFieldDetection(text),
      this.strategy8_RegexExtraction(text),
      this.strategy9_PartialJsonFallback(text),
      this.strategy10_YamlToJson(text),
      this.strategy11_StripPreamble(text),
      this.strategy12_ArrayToCodeChanges(text),
      this.strategy13_AggressivePreambleStrip(text)
    ];
  }

  /**
   * Get strategies ordered by success rate
   */
  private static getOrderedStrategies(text: string): ExtractionStrategy[] {
    const allStrategies = this.getAllStrategies(text);
    
    // Sort by success rate (highest first)
    return allStrategies.sort((a, b) => {
      const rateA = this.getStrategySuccessRate(a.name);
      const rateB = this.getStrategySuccessRate(b.name);
      return rateB - rateA;
    });
  }

  /**
   * Score a candidate based on multiple factors
   */
  private static scoreCandidate(candidate: Candidate, strategy: ExtractionStrategy): number {
    let score = strategy.score(candidate.json);
    
    // Factor 1: Schema validation (valid = 1.0, invalid = 0.0)
    if (candidate.validationResult) {
      if (candidate.validationResult.valid) {
        score = 1.0; // Valid schema = highest score
      } else {
        score = 0.0; // Invalid schema = lowest score
      }
    }
    
    // Factor 2: Strategy success rate (if valid)
    if (candidate.validationResult?.valid) {
      const strategyRate = this.getStrategySuccessRate(strategy.name);
      score = score * 0.7 + strategyRate * 0.3; // Weighted combination
    }
    
    // Factor 3: JSON completeness
    if (candidate.json.includes('"files"') && candidate.json.includes('"summary"')) {
      score += 0.1;
    }
    
    // Factor 4: Size/complexity (prefer larger, more complete objects)
    const sizeScore = Math.min(candidate.json.length / 1000, 0.1); // Max 0.1 bonus
    score += sizeScore;
    
    return Math.min(1.0, score);
  }

  /**
   * Validate an object against a schema based on validation mode
   * 
   * @param data - The data to validate
   * @param mode - Validation mode: 'code-changes' (default), 'array', 'object', or 'any'
   * @param arrayItemSchema - Optional schema for array item validation
   */
  static validate(
    data: any,
    mode: ValidationMode = 'code-changes',
    arrayItemSchema?: { requiredFields?: string[] }
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Handle 'any' mode - just check if data exists
    if (mode === 'any') {
      if (data === null || data === undefined) {
        return { valid: false, errors: ['No data provided'], warnings: [] };
      }
      return { valid: true, errors: [], warnings: [] };
    }

    // Handle 'array' mode - validate as array with optional item schema
    if (mode === 'array') {
      if (!Array.isArray(data)) {
        return { valid: false, errors: ['Expected array'], warnings: [] };
      }
      // Validate items if schema provided
      if (arrayItemSchema?.requiredFields && arrayItemSchema.requiredFields.length > 0) {
        const invalidItems: number[] = [];
        data.forEach((item: any, index: number) => {
          if (!item || typeof item !== 'object') {
            invalidItems.push(index);
          } else {
            const hasAllFields = arrayItemSchema.requiredFields!.every(f => f in item);
            if (!hasAllFields) {
              invalidItems.push(index);
            }
          }
        });
        if (invalidItems.length > 0) {
          warnings.push(`Items at indices [${invalidItems.slice(0, 5).join(', ')}${invalidItems.length > 5 ? '...' : ''}] missing required fields`);
        }
      }
      return { valid: true, errors: [], warnings };
    }

    // Handle 'object' mode - just check if it's an object
    if (mode === 'object') {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, errors: ['Expected object'], warnings: [] };
      }
      return { valid: true, errors: [], warnings: [] };
    }

    // Default 'code-changes' mode - full CodeChanges schema validation
    // Check if data is an object
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        valid: false,
        errors: ['Root must be an object'],
        warnings: []
      };
    }

    // Check required fields
    if (!('files' in data)) {
      errors.push('Missing required field: files');
    }
    if (!('summary' in data)) {
      errors.push('Missing required field: summary');
    }

    // Validate files array
    if ('files' in data) {
      if (!Array.isArray(data.files)) {
        errors.push('Field "files" must be an array');
      } else {
        data.files.forEach((file: any, index: number) => {
          const fileErrors = this.validateFile(file, index);
          errors.push(...fileErrors);
        });
      }
    }

    // Validate summary
    if ('summary' in data) {
      if (typeof data.summary !== 'string') {
        errors.push('Field "summary" must be a string');
      } else if (data.summary.length === 0) {
        warnings.push('Field "summary" is empty');
      }
    }

    // Check for additional properties
    const allowedProperties = ['files', 'summary'];
    const dataProperties = Object.keys(data);
    const extraProperties = dataProperties.filter(p => !allowedProperties.includes(p));
    if (extraProperties.length > 0) {
      warnings.push(`Additional properties found (will be ignored): ${extraProperties.join(', ')}`);
    }

    // If valid, normalize the data
    let normalized: CodeChanges | undefined;
    if (errors.length === 0) {
      normalized = this.normalize(data);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      normalized
    };
  }

  /**
   * Validate a single file object
   */
  private static validateFile(file: any, index: number): string[] {
    const errors: string[] = [];
    const prefix = `files[${index}]`;

    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      return [`${prefix}: must be an object`];
    }

    // Check required fields
    if (!('path' in file)) {
      errors.push(`${prefix}: missing required field "path"`);
    } else if (typeof file.path !== 'string') {
      errors.push(`${prefix}.path: must be a string`);
    }

    if (!('operation' in file)) {
      errors.push(`${prefix}: missing required field "operation"`);
    } else {
      const validOperations = ['create', 'update', 'delete', 'patch'];
      if (!validOperations.includes(file.operation)) {
        errors.push(`${prefix}.operation: must be one of ${validOperations.join(', ')}`);
      }
    }

    // Validate operation-specific requirements
    if (file.operation === 'create' || file.operation === 'update') {
      if (!('content' in file)) {
        errors.push(`${prefix}: operation "${file.operation}" requires "content" field`);
      } else if (typeof file.content !== 'string') {
        errors.push(`${prefix}.content: must be a string`);
      } else if (file.content.length === 0) {
        errors.push(`${prefix}.content: cannot be empty for ${file.operation} operation`);
      }
    }

    if (file.operation === 'patch') {
      if (!('patches' in file)) {
        errors.push(`${prefix}: operation "patch" requires "patches" array`);
      } else if (!Array.isArray(file.patches)) {
        errors.push(`${prefix}.patches: must be an array`);
      } else if (file.patches.length === 0) {
        errors.push(`${prefix}.patches: cannot be empty for patch operation`);
      } else {
        file.patches.forEach((patch: any, patchIndex: number) => {
          if (!patch || typeof patch !== 'object') {
            errors.push(`${prefix}.patches[${patchIndex}]: must be an object`);
            return;
          }
          if (!('search' in patch)) {
            errors.push(`${prefix}.patches[${patchIndex}]: missing required field "search"`);
          }
          if (!('replace' in patch)) {
            errors.push(`${prefix}.patches[${patchIndex}]: missing required field "replace"`);
          }
        });
      }
    }

    return errors;
  }

  /**
   * Normalize validated data to ensure it matches CodeChanges interface exactly
   */
  private static normalize(data: any): CodeChanges {
    return {
      files: data.files.map((file: any) => {
        const normalized: any = {
          path: file.path,
          operation: file.operation
        };

        if (file.content !== undefined) {
          normalized.content = file.content;
        }

        if (file.patches !== undefined) {
          normalized.patches = file.patches;
        }

        return normalized;
      }),
      summary: data.summary
    };
  }

  /**
   * Extract and validate JSON from text using multi-strategy approach
   * 
   * This method tries multiple strategies to extract valid JSON,
   * then validates it against the schema.
   * 
   * @param text - Text to extract JSON from
   * @param suppressWarnings - If true, don't log warnings or record to build metrics
   */
  static extractAndValidate(text: string, suppressWarnings: boolean = false): ValidationResult {
    if (!text || typeof text !== 'string') {
      return {
        valid: false,
        errors: ['Input must be a non-empty string'],
        warnings: []
      };
    }

    // Get strategies ordered by success rate
    const strategies = this.getOrderedStrategies(text);
    const allCandidates: Candidate[] = [];

    // Try each strategy
    for (const strategy of strategies) {
      try {
        const candidates = strategy.extract(text);
        
        for (const candidateJson of candidates) {
          // Try to parse the candidate
          const parseResult = this.tryParseJson(candidateJson);
          
          if (parseResult.success && parseResult.parsed) {
            // Validate against schema
            const validationResult = this.validate(parseResult.parsed);
            
            const candidate: Candidate = {
              json: candidateJson,
              strategy: strategy.name,
              score: 0, // Will be calculated
              validationResult
            };
            
            // Score the candidate
            candidate.score = this.scoreCandidate(candidate, strategy);
            allCandidates.push(candidate);
            
            // If valid, update stats and return immediately
            if (validationResult.valid) {
              this.updateStrategyStats(strategy.name, true);
              logger.debug(`[JsonSchemaValidator] Successfully extracted using strategy: ${strategy.name}`);
              return validationResult;
            }
          }
        }
        
        // Update stats (strategy attempted but didn't find valid result)
        if (candidates.length > 0) {
          this.updateStrategyStats(strategy.name, false);
        }
      } catch (error) {
        logger.debug(`[JsonSchemaValidator] Strategy ${strategy.name} failed: ${error}`);
        this.updateStrategyStats(strategy.name, false);
      }
    }

    // If we have candidates but none are valid, return the highest-scoring one's validation result
    if (allCandidates.length > 0) {
      allCandidates.sort((a, b) => b.score - a.score);
      const bestCandidate = allCandidates[0];
      
      // Only log and record warning if not suppressed
      if (!suppressWarnings) {
        const warningMsg = `Best candidate (strategy: ${bestCandidate.strategy}, score: ${bestCandidate.score.toFixed(2)}) failed validation: ${bestCandidate.validationResult?.errors.join(', ')}`;
        logger.warn(`[JsonSchemaValidator] ${warningMsg}`);
        
        // Record warning in build metrics if available
        try {
          const { getBuildMetrics } = require('../../core/metrics/build');
          getBuildMetrics().recordWarning('JsonSchemaValidator', warningMsg);
        } catch {
          // Build metrics not available
        }
      }
      
      return bestCandidate.validationResult || {
        valid: false,
        errors: ['Could not extract valid JSON from text'],
        warnings: []
      };
    }

    // No candidates found
    return {
      valid: false,
      errors: ['Could not extract valid JSON from text'],
      warnings: []
    };
  }

  /**
   * Extract and validate JSON from text with configurable validation mode
   * 
   * This method uses the same extraction strategies but validates according
   * to the specified mode, avoiding CodeChanges-specific validation errors
   * when extracting arrays or generic objects.
   * 
   * @param text - Text to extract JSON from
   * @param mode - Validation mode: 'code-changes', 'array', 'object', or 'any'
   * @param options - Additional options for validation
   */
  static extractAndValidateGeneric(
    text: string,
    mode: ValidationMode = 'any',
    options?: {
      arrayItemSchema?: { requiredFields?: string[] };
      suppressWarnings?: boolean;
    }
  ): GenericValidationResult {
    if (!text || typeof text !== 'string') {
      return {
        valid: false,
        errors: ['Input must be a non-empty string'],
        warnings: [],
        type: 'null'
      };
    }

    const suppressWarnings = options?.suppressWarnings ?? false;

    // Get strategies ordered by success rate
    const strategies = this.getOrderedStrategies(text);

    // Try each strategy
    for (const strategy of strategies) {
      try {
        const candidates = strategy.extract(text);
        
        for (const candidateJson of candidates) {
          // Try to parse the candidate
          const parseResult = this.tryParseJson(candidateJson);
          
          if (parseResult.success && parseResult.parsed !== undefined) {
            const parsed = parseResult.parsed;
            
            // Determine type
            let type: GenericValidationResult['type'] = 'null';
            if (Array.isArray(parsed)) {
              type = 'array';
            } else if (parsed !== null && typeof parsed === 'object') {
              type = 'object';
            } else if (parsed !== null) {
              type = 'primitive';
            }

            // Validate according to mode
            const validationResult = this.validate(parsed, mode, options?.arrayItemSchema);
            
            if (validationResult.valid) {
              this.updateStrategyStats(strategy.name, true);
              logger.debug(`[JsonSchemaValidator] Successfully extracted ${type} using strategy: ${strategy.name}`);
              return {
                valid: true,
                errors: [],
                warnings: validationResult.warnings,
                extracted: parsed,
                type
              };
            }
          }
        }
        
        // Update stats (strategy attempted but didn't find valid result)
        if (candidates.length > 0) {
          this.updateStrategyStats(strategy.name, false);
        }
      } catch (error) {
        logger.debug(`[JsonSchemaValidator] Strategy ${strategy.name} failed: ${error}`);
        this.updateStrategyStats(strategy.name, false);
      }
    }

    // No valid candidates found - only log warning if not suppressed
    if (!suppressWarnings) {
      logger.debug(`[JsonSchemaValidator] Could not extract valid JSON (mode: ${mode}) from text`);
    }

    return {
      valid: false,
      errors: ['Could not extract valid JSON from text'],
      warnings: [],
      type: 'null'
    };
  }
}
