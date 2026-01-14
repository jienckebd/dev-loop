---
title: "Troubleshooting Guide"
type: "index"
category: "troubleshooting"
audience: "both"
keywords: ["troubleshooting", "errors", "warnings", "issues", "debugging"]
related_docs:
  - "../contributing/ARCHITECTURE.md"
  - "../CURSOR_INTEGRATION.md"
prerequisites: []
estimated_read_time: 5
---

# Troubleshooting Guide

Common issues and solutions for dev-loop.

## Available Guides

- [JSON Parsing Issues](json-parsing.md) - Troubleshooting JSON parsing errors
- [PatternLoader Issues](patterns.md) - Troubleshooting pattern loading and version warnings

## Quick Reference

### Build Issues

- **PatternLoader version warnings**: See [PatternLoader Issues](patterns.md#version-mismatch-warnings)
- **JSON parsing failures**: See [JSON Parsing Issues](json-parsing.md)

### Execution Issues

- **Session warnings**: These are debug-level logs for expected behavior (new session creation)
- **Timeout errors**: Timeout kills (code 143) are logged as warnings, not errors
- **Task count incorrect**: Ensure PRD set structure uses `requirements.phases[].tasks` format

### Common Warnings and Their Meanings

| Warning | Meaning | Action |
|---------|---------|--------|
| `[PatternLoader] Schema validation errors` | Patterns file has old version format | Update `.devloop/patterns.json` version to `"2.0"` |
| `[CursorSessionManager] Session not found` | Debug-level log for new session creation | No action needed (expected behavior) |
| `[CursorChatOpener] Background agent timed out` | Agent exceeded timeout limit | Increase `backgroundAgentTimeout` if needed |
| `[CursorChatOpener] Background agent failed with code 143` | Agent was killed due to timeout (SIGTERM) | This is expected for timeouts |

### Log Levels

Dev-loop uses appropriate log levels to reduce noise:

- **Debug**: Expected lifecycle events (session creation, session resume)
- **Info**: Normal operations and progress
- **Warning**: Recoverable issues or expected kills (timeouts)
- **Error**: Actual failures requiring investigation

To see debug logs, enable debug logging in your configuration.

## Getting Help

For additional help:
1. Check relevant troubleshooting guide above
2. Review [Architecture Documentation](../contributing/ARCHITECTURE.md)
3. Check [CHANGELOG.md](../../CHANGELOG.md) for recent fixes
4. Review [Cursor Integration Guide](../CURSOR_INTEGRATION.md) for Cursor-specific issues

## Reporting Issues

When reporting issues, include:
1. dev-loop version (`npx dev-loop --version`)
2. Node.js version (`node --version`)
3. Relevant error messages and stack traces
4. Configuration (sanitized of sensitive data)
5. Steps to reproduce
