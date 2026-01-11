# JSON Schema Solution for Consistent AI Provider Parsing

## Problem

AI providers (OpenAI, Anthropic, Gemini, Cursor, etc.) return responses in various formats:
- Nested result objects with escaped JSON strings
- Narrative text with embedded JSON
- Markdown code blocks
- Pure JSON (ideal case)

This inconsistency causes parsing failures, requiring complex extraction logic that's fragile and provider-specific.

## Solution: JSON Schema Validation

We've implemented a **JSON Schema-based validation system** that:

1. **Defines a strict schema** for `CodeChanges` structure
2. **Validates responses** against the schema before parsing
3. **Normalizes responses** to ensure consistent structure
4. **Works across all providers** - schema is provider-agnostic
5. **Provides clear error messages** when validation fails

## Implementation

### 1. JSON Schema Definition (`code-changes-schema.ts`)

Defines the exact structure expected:

```typescript
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["files", "summary"],
  "properties": {
    "files": { /* array of file changes */ },
    "summary": { /* string description */ }
  }
}
```

### 2. Schema Validator (`json-schema-validator.ts`)

- Validates objects against the schema
- Extracts JSON from various text formats
- Normalizes validated data to `CodeChanges` interface
- Provides detailed error messages

### 3. Integration Points

#### Prompt Enhancement
- Prompts now include the JSON Schema
- Example responses show correct structure
- Clear rules about forbidden formats

#### Parser Integration
- Primary: Schema-based validation (robust, provider-agnostic)
- Fallback: Original parsing logic (for edge cases)

## Benefits

1. **Consistency**: Same validation logic across all providers
2. **Reliability**: Schema validation catches structural issues early
3. **Maintainability**: Single source of truth for expected format
4. **Debugging**: Clear error messages show what's wrong
5. **Future-proof**: Easy to extend schema for new fields

## Usage

### In Prompts

The schema is automatically included in prompts:

```markdown
## JSON SCHEMA (MUST FOLLOW EXACTLY):

Your response MUST conform to this JSON Schema:
[Schema definition]

## EXAMPLE RESPONSE:
[Example JSON]
```

### In Code

```typescript
import { JsonSchemaValidator } from './json-schema-validator';

// Extract and validate
const result = JsonSchemaValidator.extractAndValidate(responseText);
if (result.valid && result.normalized) {
  return result.normalized; // Guaranteed to match CodeChanges interface
}
```

## Error Handling

When validation fails:
1. Schema validator provides detailed error messages
2. Falls back to original parsing logic
3. Logs validation errors for debugging
4. Tracks failures in observations for pattern detection

## Future Enhancements

1. **Strict Mode**: Use OpenAI's structured outputs API when available
2. **Schema Evolution**: Version the schema for backward compatibility
3. **Provider-Specific**: Use provider-native structured output features
4. **Validation Metrics**: Track validation success rates per provider

## References

- [JSON Schema Specification](https://json-schema.org/)
- [OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [JSON Schema Validator](https://ajv.js.org/) (consider for production)
