# Base PRD Building Prompt

This is the base prompt template for PRD building. It provides common instructions and guidelines that apply to all modes.

## Instructions

Generate comprehensive PRD (Product Requirements Document) sets for dev-loop execution. Follow these guidelines:

1. **Structure**: Create well-organized PRD sets with phases, tasks, and clear dependencies
2. **Completeness**: Include all necessary configuration, testing, and validation requirements
3. **Framework Awareness**: Consider framework-specific patterns and conventions
4. **Testability**: Ensure all requirements can be tested and validated
5. **Executability**: Generate PRD sets that are 100% executable by dev-loop

## Output Format

Return PRD structures in YAML frontmatter format (ParsedPlanningDoc structure) compatible with dev-loop's PRD parser.
