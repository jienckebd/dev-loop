---
title: Init Command User Guide
description: Set up dev-loop configuration for your project
category: users
keywords: [init, setup, configuration, framework detection]
related: [users/CONFIG, users/ARCHIVE]
---

# Init Command User Guide

## Overview

The `dev-loop init` command sets up dev-loop configuration for your project. It analyzes your codebase, detects your framework, and generates an optimized configuration.

## Features

### Intelligent Configuration Generation

The init command uses multiple sources to generate optimal configuration:

1. **Codebase Analysis**: Scans your project to detect:
   - Framework type (Drupal, React, Django, etc.)
   - Test framework (Playwright, Jest, etc.)
   - File structure and patterns
   - Configuration files

2. **Execution Intelligence**: Learns from past executions to suggest:
   - Best AI provider/model for your project type
   - Optimal refinement settings based on PRD quality history
   - Effective configuration patterns

3. **Config Evolution**: Applies learned preferences from manual config edits:
   - Common overrides you've made
   - Always-enabled features
   - Ignored features

4. **Constitution Analysis**: Extracts hints from `.cursorrules`:
   - Editable/protected paths
   - Framework hints
   - Tool requirements
   - Coding conventions

5. **AI Enhancement**: Optionally uses AI to:
   - Deep analyze codebase patterns
   - Generate comprehensive configuration
   - Suggest optimizations

## Usage

### Basic Usage

```bash
npx dev-loop init
```

This will:
1. Analyze your codebase
2. Detect framework
3. Generate configuration suggestions
4. Prompt for user input
5. Create `devloop.config.js`

### Dry-Run Mode

Preview the generated configuration without writing it:

```bash
npx dev-loop init --dry-run
```

This is useful for:
- Testing configuration generation
- Comparing with existing config
- Validating suggestions

### Debug Mode

See detailed analysis information:

```bash
npx dev-loop init --debug
```

## Configuration Sources

### 1. Framework Detection

The init command automatically detects your framework:

- **Drupal**: Detects `.ddev/`, `docroot/`, Drupal-specific files
- **React**: Detects `package.json` with React dependencies
- **Django**: Detects `manage.py`, `settings.py`
- **Generic**: Falls back to generic framework if none detected

Framework detection influences:
- Default test commands
- Cache commands
- File structure assumptions
- Error guidance patterns

### 2. Execution Intelligence

If you've run dev-loop before, the init command uses historical data:

- **Provider Performance**: Suggests providers with >80% success rate
- **PRD Quality**: Adjusts refinement iterations based on executability achievement
- **Task Patterns**: Learns which approaches work best

### 3. Config Evolution

Tracks manual config edits to learn preferences:

- **Common Overrides**: Frequently changed settings are pre-filled
- **Always-Enabled Features**: Features you always enable are suggested
- **Ignored Features**: Features you disable are not suggested

### 4. Constitution Rules

Analyzes `.cursorrules` for:
- Path constraints (editable/protected)
- Framework hints
- Tool requirements
- Coding conventions

## Interactive Prompts

The init command prompts for:

1. **AI Provider**: Select from detected providers or choose manually
2. **AI Model**: Choose model for the selected provider
3. **Test Framework**: Confirm detected test framework
4. **Test Command**: Confirm or modify test command
5. **Framework-Specific Questions**: If framework provides questionnaire

## Framework Questionnaires

Some frameworks provide additional questions:

### Drupal
- DDEV usage confirmation
- Cache command preferences

## AI Enhancement

When enabled, AI analyzes your codebase to generate comprehensive configuration:

- Analyzes code patterns
- Suggests optimal settings
- Generates complete config matching full schema

AI enhancement is optional and can be skipped to use framework defaults only.

## Output

The init command creates `devloop.config.js` with:

- Framework-specific defaults
- Codebase-derived settings
- Execution intelligence insights
- Learned preferences
- Constitution-based constraints

## Best Practices

1. **Run init early**: Set up configuration before first PRD build
2. **Use dry-run first**: Preview configuration before accepting
3. **Review suggestions**: Check AI suggestions match your needs
4. **Let it learn**: Run multiple times to improve suggestions
5. **Manual tweaks**: Fine-tune config manually - system learns from edits

## Troubleshooting

### Framework Not Detected
- Check framework-specific files exist
- Use `--debug` to see detection process
- Manually select framework if needed

### Poor Suggestions
- Run init multiple times to build execution intelligence
- Manually edit config - system learns from changes
- Check codebase analysis results with `--debug`

### AI Enhancement Fails
- Check AI provider API key is set
- Falls back to framework defaults automatically
- Can skip AI enhancement if needed
