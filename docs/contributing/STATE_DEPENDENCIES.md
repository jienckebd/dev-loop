# State Dependencies Matrix

This document maps dev-loop features to their state file dependencies and expected usage patterns.

## State Files

### Unified State Files (via UnifiedStateManager)

- **execution-state.json** - Unified execution state
  - `active` - Active context (PRD set, PRD, phase, task)
  - `prdSets` - PRD set states
  - `prds` - PRD states (includes retry counts)
  - `contribution` - Contribution tracking (file creation, investigation tasks)
  - `contributionMode` - Contribution mode activation state
  - `sessions` - Cursor session management

- **metrics.json** - Unified hierarchical metrics
  - `runs` - Task-level metrics
  - `prdSets` - PRD set-level metrics
  - `prds` - PRD-level metrics
  - `phases` - Phase-level metrics (nested by PRD)
  - `features` - Feature usage metrics
  - `parallel` - Parallel execution metrics
  - `schema` - Schema operation metrics
  - `insights` - Performance insights
  - `summary` - Aggregated summary metrics

- **patterns.json** - Learned patterns (via UnifiedStateManager)
- **observations.json** - System observations (via UnifiedStateManager)

### Other Files (not managed by UnifiedStateManager)

- **test-results.json/test-results.json** - Test execution results (separate loader)
- **config/*.json** - Framework patterns (unchanged)
- **prd-building-checkpoints/*.json** - PRD building checkpoints
- **prd-context-v2/*.json** - PRD context files
- **reports/*.md** - Generated reports

## Feature State Dependencies

### Core System Features

| Feature | State Files | Expected Usage |
|---------|-------------|----------------|
| State Management | execution-state.json, metrics.json | UnifiedStateManager methods |
| Session Management | execution-state.json.sessions | UnifiedStateManager (via execution state) |
| Context Management | Context files, execution-state.json.active | Context files + UnifiedStateManager for active context |
| Codebase Indexing | None (in-memory/cache) | No state file dependency |
| Pattern Learning | patterns.json | UnifiedStateManager.getPatterns(), addPattern(), updatePatterns() |
| Observations | observations.json | UnifiedStateManager.getObservations(), addObservation(), updateObservations() |
| Metrics Collection | metrics.json | UnifiedStateManager.recordMetrics(), updateMetrics() |
| Archive System | execution-state.json, metrics.json | Archive/reset commands |

### PRD Features

| Feature | State Files | Expected Usage |
|---------|-------------|----------------|
| Framework Plugin Configuration | Minimal | Configuration only, no state file |
| Pattern Learning System | patterns.json | UnifiedStateManager methods |
| Test Generation Features | metrics.json | UnifiedStateManager.recordMetrics() |
| Log Analysis Configuration | observations.json | UnifiedStateManager.addObservation() |
| Codebase Discovery | Context files | No state file dependency |
| PRD-Specific Configuration | execution-state.json.prds | UnifiedStateManager for PRD state |
| Requirement Management | execution-state.json.prds | UnifiedStateManager for PRD state |
| Intervention Modes | metrics.json | UnifiedStateManager.recordMetrics() |
| Contribution Mode Features | execution-state.json.contribution, execution-state.json.contributionMode | UnifiedStateManager for contribution tracking and mode state |
| Hooks and Lifecycle | metrics.json | UnifiedStateManager.recordMetrics() |
| Validation and Smoke Tests | metrics.json | UnifiedStateManager.recordMetrics() |
| Metrics and Learning | metrics.json | UnifiedStateManager.recordMetrics(), updateMetrics() |
| Testing Configuration | metrics.json | UnifiedStateManager.recordMetrics() |
| Entity Generation Templates | Minimal | Configuration only, no state file |
| Product Metadata | execution-state.json.prds | UnifiedStateManager for PRD state |
| Context File Management | Context files, execution-state.json.active | Context files + UnifiedStateManager |
| Error Guidance System | Minimal | Configuration only, no state file |
| Configuration Overlays | execution-state.json.prds | UnifiedStateManager for PRD state |

## Expected vs Actual Usage

### Files Using UnifiedStateManager (Expected)

- `src/core/state/StateManager.ts` - UnifiedStateManager implementation
- `src/core/execution/task-bridge.ts` - Retry counts via UnifiedStateManager
- `src/core/monitoring/action-strategies.ts` - Retry counts via UnifiedStateManager
- `src/mcp/server.mts` - Retry counts via UnifiedStateManager
- `src/cli/commands/archive.ts` - Archive/reset with unified files

### Files That Should Use UnifiedStateManager (Migration Needed)

- Metrics classes (prd-set.ts, prd.ts, phase.ts, feature-tracker.ts, schema-tracker.ts, analyzer.ts)
  - Currently: Direct file I/O to metrics.json
  - Expected: UnifiedStateManager.recordMetrics()

- Session managers (cursor-session-manager.ts, background-agent.ts, observation-enhanced.ts)
  - Currently: Direct file I/O or separate file handling
  - Expected: UnifiedStateManager for sessions in execution-state.json

- Pattern/Observation loaders
  - Currently: Direct file I/O
  - Expected: UnifiedStateManager methods (already implemented in StateManager)

- Workflow execution (workflow.ts)
  - Currently: May use metrics classes with direct I/O
  - Expected: UnifiedStateManager.recordMetrics()

### Files With Intentional Direct I/O (OK)

- Test results loader - Uses separate loader with filtering
- Config files - Framework patterns, not state
- PRD building checkpoints - Separate file structure
- PRD context files - Separate file structure
- Reports - Markdown files, not JSON state

## Migration Checklist

- [x] UnifiedStateManager implemented
- [x] Execution state schema defined
- [x] Metrics schema enhanced with insights
- [x] Archive command updated
- [x] Validation command updated
- [x] Config schema defaults updated
- [x] Task bridge uses UnifiedStateManager for retry counts
- [x] Action strategies use UnifiedStateManager for retry counts
- [x] Documentation updated
- [ ] Metrics classes migrated to UnifiedStateManager
- [ ] Session managers migrated to UnifiedStateManager
- [ ] Pattern/observation loaders use UnifiedStateManager methods
- [ ] All old file paths removed from codebase
- [ ] Validation tests created
- [ ] Integration tests created
