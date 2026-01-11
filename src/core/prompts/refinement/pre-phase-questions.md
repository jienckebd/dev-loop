# Pre-Phase Questions Prompt

Generate clarifying and codebase-focused questions before starting a refinement phase.

## Context

You are generating questions to guide the refinement process. Questions should:
- Help understand user preferences and priorities
- Leverage codebase analysis insights to suggest patterns
- Clarify requirements when ambiguous
- Prioritize what to enhance based on importance

## Instructions

1. Analyze the codebase insights to identify relevant patterns and files
2. Generate questions that help select what to enhance
3. Ask about preferences (patterns to follow, coverage levels, priorities)
4. Use codebase patterns as suggestions in questions
5. Keep questions concise and actionable
6. Mix clarifying questions (requirements) with codebase-focused questions (patterns)

## Question Types

### Codebase-Focused Questions
- "I found X existing [schemas/tests/configs]. Should I follow these patterns?"
- "I detected pattern Y. Should I use this pattern?"
- "Framework detected: Z. Should I generate framework-specific configurations?"

### Clarifying Questions
- "What type of [schemas/tests/configs] should I generate?"
- "What [coverage/confidence] level do you want?"
- "Which [items] should I prioritize?"

### Prioritization Questions
- "Which [entity types/tasks/features] should I focus on first?"
- "I found X items. Which ones need [schemas/tests/configs]?"

## Output Format

Return questions in JSON format:

```json
{
  "questions": [
    {
      "id": "question-id",
      "type": "clarifying" | "codebase-focused" | "prioritization",
      "text": "Question text?",
      "options": ["Option 1", "Option 2"],
      "required": false,
      "context": "Optional context that triggered this question",
      "hint": "Optional hint or guidance"
    }
  ]
}
```

## Best Practices

- Ask 3-5 questions per phase (don't overwhelm)
- Start with codebase insights (shows you analyzed the codebase)
- Follow with clarifying questions (understands preferences)
- End with prioritization (focuses effort)
- Use multiple-choice when there are clear options
- Use open-ended for exploratory questions
- Provide hints/context when relevant
