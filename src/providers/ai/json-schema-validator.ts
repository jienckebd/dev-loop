/**
 * JSON Schema Validator for CodeChanges
 * 
 * Validates AI provider responses against the CodeChanges JSON schema
 * to ensure consistent parsing across all providers.
 */

import { CodeChanges } from '../../types';
import { CODE_CHANGES_JSON_SCHEMA } from './code-changes-schema';
import { logger } from '../../core/utils/logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized?: CodeChanges;
}

/**
 * Simple JSON Schema validator (lightweight, no external dependencies)
 * 
 * This implements basic JSON Schema validation for CodeChanges structure.
 * For production use, consider using ajv or similar library.
 */
export class JsonSchemaValidator {
  /**
   * Validate an object against the CodeChanges JSON schema
   */
  static validate(data: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

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
   * Extract and validate JSON from text using schema
   * 
   * This method tries multiple strategies to extract valid JSON,
   * then validates it against the schema.
   */
  static extractAndValidate(text: string): ValidationResult {
    // Strategy 1: Try direct JSON parse
    try {
      const parsed = JSON.parse(text);
      return this.validate(parsed);
    } catch {
      // Not valid JSON, continue to extraction strategies
    }

    // Strategy 2: Extract from markdown code blocks
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1].trim());
        return this.validate(parsed);
      } catch {
        // Continue to next strategy
      }
    }

    // Strategy 3: Find JSON object after common phrases
    const jsonAfterPhraseMatch = text.match(/(?:returning|json format|response|result|json response)[:\s]*\n?\s*(\{[\s\S]*\})/i);
    if (jsonAfterPhraseMatch) {
      try {
        const parsed = JSON.parse(jsonAfterPhraseMatch[1]);
        return this.validate(parsed);
      } catch {
        // Continue to next strategy
      }
    }

    // Strategy 4: Find largest valid JSON object (balanced braces)
    const jsonObjects: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const prevChar = i > 0 ? text[i - 1] : '';

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
            // Validate it's likely JSON by checking for common fields
            if (candidate.includes('files') || candidate.includes('summary')) {
              jsonObjects.push(candidate);
            }
            start = -1;
          }
        }
      }
    }

    // Try to parse and validate each candidate
    for (const candidate of jsonObjects.sort((a, b) => b.length - a.length)) {
      try {
        const parsed = JSON.parse(candidate);
        const result = this.validate(parsed);
        if (result.valid) {
          return result;
        }
      } catch {
        // Continue to next candidate
      }
    }

    return {
      valid: false,
      errors: ['Could not extract valid JSON from text'],
      warnings: []
    };
  }
}
