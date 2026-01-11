# Prevent Duplicate and Dead Code

## Purpose

Ensure generated PRD sets and code extend existing code correctly without duplicating or creating dead code.

## Guidelines

1. **Search Before Creating**: Always search the codebase for existing implementations before generating new code
2. **Extend, Don't Duplicate**: Prefer extending existing services, plugins, or utilities over creating new ones
3. **Reuse Patterns**: Identify and reuse existing patterns from the codebase
4. **Avoid Dead Code**: Only generate code that will actually be used
5. **Integration Points**: Identify proper integration points with existing systems
6. **Framework Conventions**: Follow framework-specific conventions and patterns

## Questions to Consider

- Does similar functionality already exist?
- Can we extend existing services/plugins instead of creating new ones?
- Are there existing patterns we should follow?
- Will this code be used or will it become dead code?
- What are the proper integration points with existing systems?
