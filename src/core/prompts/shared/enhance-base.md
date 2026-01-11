# Enhance Mode Base Prompt

Base prompt for enhancing existing PRD sets.

## Mode: Enhance

Enhance an existing PRD set by adding missing elements (schemas, tests, config, etc.).

## Key Requirements

1. Preserve existing valid configurations
2. Detect gaps in schemas, tests, config, validation
3. Generate enhancements only for missing elements
4. Maintain backward compatibility
5. Ensure 100% executability after enhancement

## Process

1. Load existing PRD set
2. Analyze current state and detect gaps
3. Generate enhancements for gaps
4. Apply enhancements (preserve existing)
5. Validate executability
6. Update PRD set files
