# Cursor Multi-Agent Configuration for Dev-Loop

This document describes how to configure dev-loop to use Cursor's multi-agent capabilities with model-specific contexts.

## Overview

Dev-loop can be configured to include agent and model metadata in its AI requests when using the Cursor provider. This allows projects to leverage Cursor 2.0's multi-agent features.

## Configuration

### 1. AGENTS.md (Project Root)

Create an `AGENTS.md` file in your project root to define agents:

```markdown
# Dev-Loop Agents Configuration

## DevLoopCodeGen Agent

- **Name**: DevLoopCodeGen
- **Model**: auto
- **Purpose**: Process dev-loop code generation requests

### Request Format

Requests are stored in `files-private/cursor/pending-requests.json`

### Response Format

Responses should be written to `files-private/cursor/completed/{request-id}.json`
```

### 2. devloop.config.js

Configure the cursor provider settings:

```javascript
module.exports = {
  ai: {
    provider: 'cursor',
    model: 'auto',  // Uses Cursor's Auto model selection
    maxTokens: 32000,
    maxContextChars: 75000
  },
  cursor: {
    requestsPath: 'files-private/cursor',  // Path for request/response files
    agentName: 'DevLoopCodeGen',           // Agent name (matches AGENTS.md)
    model: 'auto',                         // Default model
  },
  // ... other config
};
```

### 3. Cursor Rules (Optional)

Create `.cursor/rules/devloop-agent.mdc` to provide context-specific rules when processing dev-loop requests:

```markdown
---
description: Rules for dev-loop code generation agent
globs:
  - files-private/cursor/**
alwaysApply: false
---

# Dev-Loop Code Generation Agent Rules

Use the model specified in the request. Follow project coding standards.
```

## Request Format

Dev-loop creates requests with the following structure:

```json
{
  "id": "req-{timestamp}-{random}",
  "task": {
    "id": "task-id",
    "title": "Task title",
    "description": "Task description"
  },
  "model": "auto",
  "agent": "DevLoopCodeGen",
  "timestamp": 1234567890
}
```

## Response Format

Responses should be JSON files with the following structure:

```json
{
  "codeChanges": {
    "files": [
      {
        "path": "path/to/file",
        "operation": "create|update|delete",
        "content": "file content"
      }
    ],
    "summary": "Description of changes made"
  }
}
```

## How It Works

1. Dev-loop creates a pending request file in `files-private/cursor/pending-requests.json`
2. A Cursor agent (or MCP tool) processes the request
3. The agent writes a completion file to `files-private/cursor/completed/{request-id}.json`
4. Dev-loop polls for completion and continues workflow

## Model Selection

The `model` field in requests indicates the preferred model. Currently, this is advisory:

- `auto` - Use Cursor's automatic model selection
- Specific models can be specified (e.g., `claude-sonnet`, `gpt-4`)

Note: The actual model used depends on the Cursor agent configuration and may not match the requested model if the current Cursor session uses a different model.

## Limitations

1. Model selection is advisory - the active Cursor session's model is used
2. Requests have a timeout (default: varies by request type)
3. The agent processing requests must have access to the project files


