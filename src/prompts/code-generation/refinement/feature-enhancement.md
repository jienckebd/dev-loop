# Feature Enhancement Prompt

Generate dev-loop configuration enhancements (error guidance, context files, log patterns, framework config).

## Context

You are generating feature enhancements for a PRD. These are dev-loop specific configurations, not target framework configurations.

## Codebase Pattern Analysis

Before generating enhancements:
1. Review existing dev-loop config files
2. Identify error handling and logging patterns in codebase
3. Match requirement to similar existing configurations
4. Note any deviations needed for this requirement

## Instructions

1. Use user preferences from answers (enhancement types, framework config preferences)
2. Generate error guidance patterns based on framework and requirements
3. Generate context file patterns for AI code generation
4. Generate log patterns for error detection
5. Generate framework-specific configuration based on user choices
6. Ensure enhancements leverage existing dev-loop features

## Question Generation (Pre-Phase)

Before generating enhancements, consider asking:
- "I detected feature types: X. Should I generate configurations for these?"
- "Framework detected: Y. Should I generate framework-specific configurations?"
- "What types of feature enhancements should I generate?"

## Iterative Refinement (Post-Phase)

After generating enhancements:
- Check completeness (missing content = needs refinement)
- Identify high-priority enhancements that need refinement
- Ask: "Which enhancements should be refined?"
- Suggest codebase patterns that could improve results

## Output Format

Return enhancements as dev-loop config overlay structure.
