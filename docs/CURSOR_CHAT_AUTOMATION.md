# Cursor Chat Automation

This document describes how dev-loop opens chats in Cursor IDE, including both terminal agent and IDE composer integration.

## Overview

Dev-loop supports two distinct integration modes:

1. **IDE Composer Integration** (Recommended) - Opens prompt files for easy copy-paste to Cursor's composer (Cmd+L)
2. **Terminal Agent** - Starts `cursor agent` in terminal with MCP tool access

## Architecture

```
┌─────────────────────────┐
│   Dev-Loop              │
│   ChatAutoProcessor     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   CursorChatOpener      │
│   openChat()            │
└─────┬───────────┬───────┘
      │           │
      ▼           ▼
┌──────────┐  ┌──────────────┐
│ IDE Mode │  │ Agent Mode   │
│ (Cmd+L)  │  │ (Terminal)   │
└────┬─────┘  └──────┬───────┘
     │               │
     ▼               ▼
┌──────────┐  ┌──────────────┐
│ .prompt  │  │ cursor agent │
│ .md file │  │ CLI process  │
└────┬─────┘  └──────────────┘
     │
     ▼
┌─────────────────────────┐
│ Cursor IDE Composer     │
│ User: Cmd+L, Paste      │
└─────────────────────────┘
```

## IDE Composer Integration (Recommended)

The IDE mode creates composer-ready prompt files that you can easily copy-paste into Cursor's composer.

### How It Works

1. Dev-loop creates a `.prompt.md` file with your task
2. The file opens in Cursor's editor
3. You select the prompt text, copy it (Cmd+C)
4. Open Composer (Cmd+L), paste (Cmd+V), and send

### Configuration

```javascript
module.exports = {
  cursor: {
    agents: {
      // Enable IDE chat integration (default: true)
      preferIdeChat: true,

      // Strategy: 'ide' for composer, 'agent' for terminal
      openStrategy: 'auto',

      // Enable keyboard automation on macOS (experimental)
      keyboardAutomation: false,

      // Prompt file format: 'markdown' or 'plain'
      promptFileFormat: 'markdown',

      // Path to prompt files
      chatPromptsPath: '.cursor/chat-prompts',
    }
  }
};
```

### Keyboard Automation (macOS)

On macOS, dev-loop can automatically trigger Cmd+L to open the composer:

```javascript
cursor: {
  agents: {
    keyboardAutomation: true,  // Enable AppleScript automation
  }
}
```

**Note**: Requires Accessibility permissions in System Preferences.

## Terminal Agent Mode

The terminal agent mode starts `cursor agent` in a terminal session with full MCP access.

### When to Use Terminal Agent

- When you need MCP tool access
- For long-running autonomous tasks
- When IDE composer isn't suitable

### Configuration for Terminal Agent

```javascript
cursor: {
  agents: {
    preferIdeChat: false,  // Disable IDE mode
    openStrategy: 'agent', // Force terminal agent
  }
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoOpenChats` | boolean | true | Automatically open chats when processed |
| `preferIdeChat` | boolean | true | Prefer IDE composer over terminal agent |
| `openStrategy` | string | 'auto' | Opening strategy (see below) |
| `keyboardAutomation` | boolean | false | Enable macOS keyboard automation |
| `promptFileFormat` | string | 'markdown' | Format for prompt files |
| `fallbackToManual` | boolean | true | Show manual instructions if auto fails |

### Open Strategies

| Strategy | Description |
|----------|-------------|
| `auto` | Try IDE first (if `preferIdeChat`), then agent, then file, then manual |
| `ide` | Open composer-ready prompt file in editor |
| `agent` | Start terminal-based cursor agent |
| `file` | Open JSON instruction file in editor |
| `manual` | Provide CLI commands for user to run |

## CLI Commands

### IDE Mode Commands

```bash
# Process pending requests (opens prompt files)
npx dev-loop open-chat-instructions

# Open latest prompt only
npx dev-loop open-chat-instructions --latest

# List all pending instructions
npx dev-loop list-pending-chats
```

### Terminal Agent Commands

```bash
# Create new terminal agent chat
npx dev-loop open-chat-instructions --create

# Start agent with a prompt
npx dev-loop open-chat-instructions --prompt "Generate tests"

# Force agent mode for pending instructions
npx dev-loop open-chat-instructions --agent
```

### Direct Cursor CLI

```bash
# Create new chat (returns chat ID)
cursor agent create-chat

# Start agent with prompt
cursor agent "Your prompt here"

# Resume latest chat
cursor agent resume

# List chat sessions
cursor agent ls
```

## API Usage

### IDE Composer Integration

```typescript
import { CursorChatOpener, quickOpenForIdeComposer } from 'dev-loop/providers/ai/cursor-chat-opener';

// Quick IDE integration
const result = await quickOpenForIdeComposer(chatRequest);
if (result.success) {
  console.log(`Prompt file: ${result.promptFilePath}`);
  console.log(result.instructions); // User instructions
}

// Full control
const opener = new CursorChatOpener({
  preferIdeChat: true,
  keyboardAutomation: true,
});

const result = await opener.openForIdeComposer(chatRequest);
```

### Keyboard Automation (macOS)

```typescript
import { KeyboardAutomation, triggerComposer } from 'dev-loop/providers/ai/cursor-keyboard-automation';

// Quick trigger
await triggerComposer(); // Sends Cmd+L

// Full automation class
const automation = new KeyboardAutomation({ enabled: true });
await automation.executeSequence(['focus', 'composer', 'paste']);
```

### Terminal Agent

```typescript
import { quickCreateChat, quickStartAgent } from 'dev-loop/providers/ai/cursor-chat-opener';

// Create empty chat
const { chatId } = await quickCreateChat();

// Start agent with prompt
await quickStartAgent("Generate tests", process.cwd());
```

## Prompt File Format

### Markdown Format (Default)

```markdown
<!-- DEV-LOOP PROMPT FILE -->
<!-- Select all (Cmd+A), Copy (Cmd+C), then open Composer (Cmd+L) and Paste (Cmd+V) -->

@codebase Generate tests for the authentication module.
Include unit tests for login, logout, and session management.

PRD: api-spec
Task ID: task-123

---

**Request ID:** req-1234567890
**Agent:** DevLoopCodeGen
**Model:** Auto
**Created:** 2026-01-06T12:00:00.000Z

### Quick Start
1. Select the prompt text (above the --- line)
2. Copy: Cmd+C (Mac) / Ctrl+C (Windows)
3. Open Composer: **Cmd+L** (Mac) or **Ctrl+L** (Windows)
4. Paste and send
```

### Plain Format

```
@codebase Generate tests for the authentication module.
Include unit tests for login, logout, and session management.

PRD: api-spec
Task: task-123
```

## Troubleshooting

### Prompt File Not Opening

1. Check Cursor CLI is installed:
   ```bash
   which cursor
   ```

2. Verify the file was created:
   ```bash
   ls .cursor/chat-prompts/
   ```

### Keyboard Automation Not Working (macOS)

1. Check Accessibility permissions:
   - System Preferences → Security & Privacy → Privacy → Accessibility
   - Add Terminal or your shell application

2. Verify AppleScript works:
   ```bash
   osascript -e 'tell application "Cursor" to activate'
   ```

### Terminal Agent Issues

See the dedicated section in the original troubleshooting guide.

## Best Practices

1. **Use IDE mode for most tasks**: Easier integration with Cursor's composer
2. **Reserve terminal agent for MCP-heavy tasks**: When you need tool access
3. **Enable keyboard automation cautiously**: Requires permissions, may be fragile
4. **Use markdown format**: Better readability and instructions
5. **Keep fallbacks enabled**: Always have a manual option

## Platform Support

| Feature | macOS | Linux | Windows |
|---------|-------|-------|---------|
| IDE Mode (prompt files) | ✅ | ✅ | ✅ |
| Keyboard Automation | ✅ | ❌ | ❌ |
| Terminal Agent | ✅ | ✅ | ✅ |
| Auto-open files | ✅ | ✅ | ✅ |

## Related Documentation

- [HANDOFF_CURSOR_AI_PROVIDER.md](../../HANDOFF_CURSOR_AI_PROVIDER.md) - Full Cursor AI provider documentation
- [Cursor CLI Documentation](https://docs.cursor.com/cli) - Official Cursor CLI docs
