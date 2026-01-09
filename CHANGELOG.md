# Changelog

All notable changes to dev-loop will be documented in this file.

## [Unreleased]

### Added

- **Unix Domain Socket IPC System** - Reliable inter-process communication between parent workflow engine and background agents
  - New `AgentIPCServer` class for parent process
  - New `AgentIPCClient` class for child agents
  - Structured message protocol with status, progress, code_changes, error, complete types
  - Environment variable passing of socket path to child processes
  - See `docs/architecture/ipc.md` for full documentation

- **Stricter JSON Format Enforcement** - Prevents narrative text responses from AI agents
  - Updated prompt templates with explicit format requirements
  - Added retry prompts with even stricter instructions
  - Clear FORBIDDEN and REQUIRED sections in prompts

- **JsonParsingHaltError** - Actionable error when JSON parsing fails
  - Stops execution after configured retry attempts (default: 2)
  - Provides detailed debugging information:
    - Response sample
    - Response type and keys
    - Task context (ID, title, PRD, phase)
  - Includes how-to-fix instructions in error message

- **PRD maxConcurrency Detection in Watch Mode** - Parallel execution now works in watch mode
  - `runOnce()` now loads maxConcurrency from PRD set index files
  - Falls back to config.autonomous.maxConcurrency or default of 1
  - Scans `.taskmaster/planning/*/index.md.yml` for configuration

- **Comprehensive Validation PRD Set** - `devloop-validation-set` for testing all features
  - 6-phase PRD targeting bd_devloop_test module
  - Tests parallel execution (phases 2-3, 4-5 run concurrently)
  - Tests all recently implemented features

- **Documentation**
  - `docs/architecture/ipc.md` - IPC system architecture and usage
  - `docs/troubleshooting/json-parsing.md` - JSON parsing requirements and troubleshooting

### Changed

- **CursorChatOpener** - Integrated IPC server for background agent communication
  - Creates IPC server before spawning background agents
  - Passes socket path via environment variables
  - Cleans up socket on completion or error

- **CursorProvider** - Enhanced error handling and validation
  - Added response validation before accepting CodeChanges
  - Stricter prompt building with explicit format requirements
  - Throws JsonParsingHaltError instead of generic errors

- **WorkflowEngine** - Improved parallel execution support
  - Added `loadPrdMaxConcurrencyFromConfig()` method
  - Loads PRD set configuration at start of `runOnce()`
  - Respects maxConcurrency from PRD metadata

### Fixed

- **Parallel Execution in Watch Mode** - Now correctly uses maxConcurrency from PRD configuration
- **Narrative Response Handling** - Stricter prompts reduce narrative text responses
- **Error Messages** - More actionable error messages with debugging information

## [Previous Versions]

See git history for earlier changes.


