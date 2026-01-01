---
title: "Pull Request Process"
type: "guide"
category: "contributing"
audience: "both"
keywords: ["pull-request", "pr", "code-review", "commit-messages", "releases"]
related_docs:
  - "README.md"
  - "DEVELOPMENT_WORKFLOW.md"
  - "TESTING.md"
prerequisites:
  - "GETTING_STARTED.md"
estimated_read_time: 15
contribution_mode: true
---

# Pull Request Process

How to submit pull requests for dev-loop contributions.

## Before Submitting

- [ ] Code builds successfully (`npm run build`)
- [ ] All tests pass (`npm test`)
- [ ] Code follows style guidelines
- [ ] Documentation updated (if needed)
- [ ] Commit messages follow conventions

## Creating a Pull Request

### 1. Fork and Clone

If contributing from a project using dev-loop as a dependency:

```bash
# Work directly in node_modules/dev-loop
cd node_modules/dev-loop

# Create branch
git checkout -b feature/your-feature-name

# Make changes, build, test
npm run build
npm test

# Commit
git add -A
git commit -m "feat: add your feature"

# Push to your fork
git push origin feature/your-feature-name
```

### 2. Create PR on GitHub

1. Go to dev-loop repository on GitHub
2. Click "New Pull Request"
3. Select your branch
4. Fill out PR template

## PR Requirements

### Title

Use conventional commit format:
- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `refactor: restructure code`
- `test: add tests`

### Description

Include:
- **What** - What does this PR do?
- **Why** - Why is this change needed?
- **How** - How does it work?
- **Testing** - How was it tested?

### Code Quality

- ✅ Code builds without errors
- ✅ All tests pass
- ✅ TypeScript types are correct
- ✅ No console.log or debug code
- ✅ Follows existing code style

### Framework-Agnostic

- ✅ No framework-specific code in core
- ✅ Framework-specific code in plugins
- ✅ Configurable via `devloop.config.js` if needed

## Code Review Process

### Review Criteria

Reviewers check for:
1. **Correctness** - Does it work as intended?
2. **Test coverage** - Are there tests?
3. **Documentation** - Is it documented?
4. **Style** - Does it follow conventions?
5. **Framework-agnostic** - No hardcoded framework assumptions

### Responding to Feedback

1. Address all review comments
2. Make requested changes
3. Rebuild and test
4. Push updates
5. Mark comments as resolved

### Review Timeline

- Initial review: Within 2-3 business days
- Follow-up reviews: Within 1-2 business days
- Merge: After approval and CI passes

## Commit Message Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style (formatting, etc.)
- `refactor` - Code restructuring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

### Examples

```
feat(core): add pattern learning system

Implements PatternLearningSystem to learn from task outcomes
and inject guidance into AI prompts.

Closes #123
```

```
fix(cli): resolve build command error

Fixes issue where build command failed on Windows paths.

Fixes #456
```

## After PR is Merged

1. ✅ Delete your branch
2. ✅ Update local main branch
3. ✅ Celebrate! 🎉

## Release Process

Releases are handled by maintainers:
- Version bumping
- Changelog generation
- NPM publishing
- Release notes

You don't need to do anything special after merge.

## See Also

- [Development Workflow](DEVELOPMENT_WORKFLOW.md) - Making changes
- [Testing](TESTING.md) - Writing tests
- [Getting Started](GETTING_STARTED.md) - Setup guide
