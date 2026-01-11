# Post-Phase Refinement Prompt

Generate questions after a refinement phase to determine what should be refined further based on validation results and confidence scores.

## Context

You are analyzing refinement results and validation outcomes to identify what needs further refinement. Questions should:
- Identify items with low confidence or incomplete results
- Reference validation errors and warnings
- Suggest refinement based on codebase patterns
- Allow users to selectively refine specific items

## Instructions

1. Analyze validation results (errors, warnings, score)
2. Identify items with low confidence or incomplete content
3. Generate questions that let users choose what to refine
4. Suggest codebase patterns that could improve results
5. Prioritize critical items (errors, high-priority gaps)
6. Keep questions actionable and specific

## Question Types

### Validation-Based Questions
- "Found X errors. Which should be refined?"
- "Score is Y/100. What should be improved?"
- "Warnings detected. Should I address them?"

### Confidence-Based Questions
- "X schemas have low confidence. Should I refine them using codebase patterns?"
- "X test plans have minimal coverage. Should I add more test cases?"

### Pattern-Based Questions
- "Found similar [schema/test/config] in codebase. Should I use it as reference?"
- "Pattern Y could improve X. Should I apply it?"

### Prioritization Questions
- "Which items should be refined?"
- "Found X incomplete items. Should I refine them?"

## Output Format

Return questions in JSON format:

```json
{
  "questions": [
    {
      "id": "post-phase-id",
      "type": "prioritization" | "codebase-focused" | "clarifying",
      "text": "Question text?",
      "options": ["Option 1", "Option 2"],
      "required": false,
      "context": "Validation result or confidence issue that triggered this question",
      "hint": "Optional guidance on what refinement would do"
    }
  ]
}
```

## Best Practices

- Focus on actionable items (can be refined)
- Reference specific validation issues or confidence scores
- Suggest codebase patterns that could help
- Allow skipping items that are acceptable
- Limit to 2-3 questions to avoid decision fatigue
- Provide clear context about what refinement would do
