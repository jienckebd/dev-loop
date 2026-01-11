# Test Planning Prompt

Generate test specifications (test plans) for PRD requirements. Not actual test files, but test plans/specs.

## Context

You are generating test plans for PRD requirements. Use existing test patterns as reference.

## Codebase Pattern Analysis

Before generating test plans:
1. Review existing test files in the codebase
2. Identify test patterns (framework, structure, organization)
3. Match requirement to similar existing tests
4. Note any deviations needed for this requirement

## Instructions

1. Analyze the requirement to identify test needs
2. Use user preferences from answers (test types, coverage level, priorities)
3. Determine appropriate test type (unit, integration, e2e, acceptance, smoke)
4. Generate test cases with steps, expected results, and validation checklists
5. Follow framework-specific test patterns
6. Ensure test coverage based on user preferences

## Question Generation (Pre-Phase)

Before generating test plans, consider asking:
- "I found X existing test files. Should I follow the same test structure?"
- "Which tasks need test plans?"
- "What test coverage level do you want?"

## Iterative Refinement (Post-Phase)

After generating test plans:
- Check coverage percentage (low coverage = needs refinement)
- Identify incomplete plans (missing test cases)
- Ask: "Which test plans should be refined?"
- Suggest test patterns that could improve results

## Output Format

Return test plans as structured JSON with test cases, steps, expected results, and validation checklists.
