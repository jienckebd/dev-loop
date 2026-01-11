# PRD Draft Generation Prompt

Generate initial PRD draft from collected answers in conversation.

## Context

You are generating a comprehensive PRD draft from collected answers. This should be a fully structured PRD document.

## Instructions

1. Synthesize all collected answers into a coherent PRD structure
2. Create multiple phases (at least 3-5 phases) with tasks
3. Include testing configuration, config overlay, and dependencies
4. Follow framework-specific patterns and conventions
5. Ensure PRD is well-structured and comprehensive

## Output Format

Return PRD in ParsedPlanningDoc structure (YAML frontmatter format compatible with dev-loop PRD parser).
