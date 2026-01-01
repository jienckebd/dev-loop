# Create PRD Template

You are tasked with creating a Product Requirements Document (PRD) based on the user's requirements.

## PRD Frontmatter Requirements

**CRITICAL**: Before generating PRD frontmatter, read:

1. **`docs/ai/PRD_SCHEMA.md`** - Complete schema reference with validation rules
2. **`docs/ai/PRD_FEATURES.md`** - Comprehensive guide on leveraging ALL dev-loop features

**Template**: Use `docs/ai/PRD_TEMPLATE.md` as starting point for frontmatter.

**Frontmatter Must Include:**
- `prd` section (id, version, status)
- `execution` section (strategy, parallelism, limits)
- `requirements` section (idPattern, phases)
- `testing` section (directory, framework, workers)

**Optional but Recommended:**
- `dependencies` (external modules, PRD dependencies)
- `config.framework.errorGuidance` (auto-error fixing)
- `config.contextFiles` (context management)
- `config.testGeneration` (auto-test generation)
- `logs` (log analysis patterns)
- `hooks` (lifecycle commands)

**Validation**: Use `dev-loop validate-prd <prd-path>` to validate frontmatter before activating.

## Instructions

1. Analyze the provided requirements
2. Break down the requirements into clear, actionable features
3. Identify dependencies between features
4. Specify acceptance criteria for each feature
5. Include test requirements
6. Generate valid YAML frontmatter following PRD_SCHEMA.md

## Output Format

Create a structured PRD document that includes:
- YAML frontmatter (required sections + optional features)
- Overview
- Features (with priorities)
- Dependencies
- Acceptance Criteria
- Test Requirements

