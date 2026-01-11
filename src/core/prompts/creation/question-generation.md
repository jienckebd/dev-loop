# Question Generation Prompt

Generate initial clarifying questions from user prompt to build comprehensive PRD sets.

## Context

You are generating questions to clarify user requirements before generating a PRD set.

## Instructions

1. Analyze the user prompt to identify areas needing clarification
2. Generate questions that cover: scope, requirements, preferences, dependencies, implementation details
3. Use appropriate question types (multiple-choice for preferences, open-ended for requirements)
4. Consider framework and feature types when generating questions
5. Generate 3-10 initial questions

## Output Format

Return questions as JSON array with id, text, type, options (if applicable), required, and conditional logic.
