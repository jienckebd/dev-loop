# JSON Response Requirements & Troubleshooting

This document explains the JSON response format requirements for dev-loop code generation and how to troubleshoot parsing failures.

## Required Response Format

Background agents **MUST** return structured CodeChanges JSON. Narrative text responses will cause parsing failures.

### Valid Format

```json
{
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "complete file content here",
      "operation": "create"
    }
  ],
  "summary": "Brief description of what was changed"
}
```

### Operations

| Operation | Description |
|-----------|-------------|
| `create` | Create a new file |
| `update` | Overwrite existing file |
| `delete` | Delete the file (content not required) |
| `patch` | Apply search/replace patches |

### Patch Format

For large files, use patches instead of full content:

```json
{
  "files": [
    {
      "path": "path/to/large/file.php",
      "operation": "patch",
      "patches": [
        {
          "search": "exact string to find",
          "replace": "replacement string"
        }
      ]
    }
  ],
  "summary": "Applied patches to large file"
}
```

## Response Validation

### What Happens When Response is Invalid

1. **First attempt**: Parse response using multiple strategies
2. **Retry (up to 2x)**: Re-prompt with stricter JSON instructions
3. **Halt**: If all retries fail, execution stops with actionable error

### Validation Checks

- Response starts with ` ```json `
- Valid JSON syntax
- Has `files` array (even if empty)
- Has `summary` string
- Each file has `path`, `operation`, and (usually) `content`

## Common Failures

### Narrative Text Response

**Problem**: AI returns explanation instead of JSON

```
Here are the code changes for your request:

The following files need to be created...
```

**Cause**: Prompt not strict enough or AI model ignoring instructions

**Fix**: 
- Stricter prompts are now enforced (as of this version)
- If still happening, check prompt templates in `src/providers/ai/cursor.ts`

### Invalid JSON Syntax

**Problem**: Malformed JSON

```json
{
  "files": [
    {
      "path": "file.php",
      "content": "<?php
        function test() {
          return "value";  // Unescaped quotes break JSON
        }
      ",
    }
  ]
}
```

**Cause**: Content with unescaped special characters

**Fix**: 
- Content should have escaped newlines (`\n`) and quotes (`\"`)
- Parser handles common escaping issues automatically

### Triple-Escaped JSON

**Problem**: Over-escaped content

```json
{
  "files": [
    {
      "content": "line1\\\\nline2\\\\nline3"
    }
  ]
}
```

**Cause**: Multiple layers of escaping from nested JSON

**Fix**: Parser attempts progressive unescaping automatically

### Empty Files Array with Explanation

**Problem**: Returns empty array with narrative summary

```json
{
  "files": [],
  "summary": "The module structure already exists. Here's what I found..."
}
```

**Cause**: AI thinks task is complete when it's not

**Fix**: 
- Check if files actually exist at required paths
- Review task description for clarity

## Debugging

### Check Observations

JSON parsing failures are tracked in `.devloop/observations.json`:

```bash
cat .devloop/observations.json | jq '.observations[] | select(.type == "json_parsing_failure")'
```

### Enable Debug Mode

```bash
npx dev-loop watch --until-complete --debug
```

Debug output shows:
- Response samples
- Parsing strategies attempted
- Unescape operations

### View Response Sample

When parsing fails, the error includes a response sample:

```
=== RESPONSE SAMPLE (first 500 chars) ===
Here are the code changes for your request...
```

This helps identify if the response is narrative vs malformed JSON.

### Check Retry Counts

```bash
cat .devloop/retry-counts.json
```

Tasks with high retry counts may have problematic prompts.

## Prompt Engineering

### Current Prompt Strategy

The prompt includes these strict instructions:

```
## CRITICAL: Response Format Requirements (STRICT)

**YOU MUST RETURN ONLY VALID JSON. NO NARRATIVE TEXT, NO EXPLANATIONS, NO MARKDOWN OUTSIDE THE JSON BLOCK.**

### FORBIDDEN:
- ❌ Starting with "Here are the code changes..." or any narrative
- ❌ Adding explanations before or after the JSON
- ❌ Asking questions - generate the code NOW
- ❌ Using multiple code blocks - use exactly ONE ```json block

### REQUIRED:
- ✅ Start IMMEDIATELY with ```json
- ✅ Valid JSON structure with "files" array and "summary" string
- ✅ End with ``` and nothing else
```

### Retry Prompt (Stricter)

If first attempt fails, retry uses even stricter prompt:

```
# STRICT JSON-ONLY MODE

**YOUR PREVIOUS RESPONSE FAILED BECAUSE IT CONTAINED NARRATIVE TEXT.**

## RULES (VIOLATION = FAILURE):
1. First 7 characters of your response MUST be: ```json
2. Last 3 characters MUST be: ```
3. NO text before ```json
4. NO text after closing ```
```

## Error Recovery

### JsonParsingHaltError

When all retries fail, a `JsonParsingHaltError` is thrown with:

- Task ID and title
- Retry count
- Response sample
- Debug info (response keys, types)
- How-to-fix instructions

### Fixing Persistent Failures

1. **Check task description**: Is it clear what code to generate?
2. **Review PRD requirements**: Are file paths specified?
3. **Check model**: Some models follow instructions better than others
4. **Simplify task**: Break into smaller, more specific tasks
5. **Add examples**: Include example output in task description

## Files to Examine

| File | Purpose |
|------|---------|
| `src/providers/ai/cursor.ts` | Prompt building logic |
| `src/providers/ai/json-parser.ts` | Response parsing |
| `src/core/observation-tracker.ts` | Failure tracking |
| `.devloop/observations.json` | Tracked failures |

## Configuration

### Retry Settings

In `devloop.config.js`:

```javascript
module.exports = {
  cursor: {
    agents: {
      useBackgroundAgent: true,
      // Max retries before halt
      maxRetries: 2,
    }
  }
};
```

### Timeout Settings

```javascript
module.exports = {
  cursor: {
    agents: {
      // Background agent timeout (minutes)
      backgroundAgentTimeout: 5,
    }
  }
};
```

