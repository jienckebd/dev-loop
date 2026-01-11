# Schema Enhancement Prompt

Generate schema definitions for PRD requirements based on codebase patterns and framework conventions.

## Context

You are generating schema definitions for a PRD requirement. Use existing codebase patterns as reference.

## Codebase Pattern Analysis

Before generating schemas:
1. Review existing schema files in the codebase
2. Identify patterns (naming conventions, structure, organization)
3. Match requirement to similar existing schemas
4. Note any deviations needed for this requirement

## Instructions

1. Analyze the requirement to identify schema needs
2. Match with existing codebase schema patterns
3. Use user preferences from answers (patterns to follow, entity types to prioritize)
4. Generate schema definition following framework conventions
5. Ensure schema matches existing patterns where applicable
6. Return schema in appropriate format (YAML for Drupal, Python for Django, etc.)

## Question Generation (Pre-Phase)

Before generating schemas, consider asking:
- "I found X existing schema files. Should I follow these patterns?"
- "Which entity types need schema definitions?"
- "Should I generate config schemas or entity type schemas?"

## Iterative Refinement (Post-Phase)

After generating schemas:
- Check confidence scores (low confidence = needs refinement)
- Identify incomplete schemas (missing content or structure)
- Ask: "Which schemas should be refined?"
- Suggest codebase patterns that could improve results

## Output Format

Return schema definitions in the framework's standard format (YAML for Drupal config schemas, etc.).
