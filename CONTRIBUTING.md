# Contributing to Copilot Telegram Bot

Thank you for considering contributing to this project! We welcome contributions from the community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style Guide](#code-style-guide)
- [Commit Message Convention](#commit-message-convention)
- [Pull Request Process](#pull-request-process)
- [Testing Requirements](#testing-requirements)
- [Creating New Wizards](#creating-new-wizards)
- [Roadmap](#roadmap)

---

## Code of Conduct

This project adheres to a Code of Conduct. By participating, you are expected to:

- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards others

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- Git
- GitHub Copilot subscription
- Familiarity with TypeScript

### Setup Development Environment

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/Rios-Guerrero-Juan-Manuel/copilot-telegram-bot.git
   cd copilot-telegram-bot
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create `.env` file (see `SETUP.md`)
5. Build the project:
   ```bash
   npm run build
   ```
6. Run tests:
   ```bash
   npm test
   ```

---

## Development Workflow

1. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feat/my-new-feature
   # or
   git checkout -b fix/bug-description
   ```

2. **Make your changes** following the code style guide

3. **Test your changes**:
   ```bash
   npm run build
   npm test
   ```

4. **Commit your changes** using conventional commits (see below)

5. **Push to your fork**:
   ```bash
   git push origin feat/my-new-feature
   ```

6. **Open a Pull Request** with a clear description

---

## Code Style Guide

### TypeScript

- **Strict mode enabled**: All code must pass TypeScript strict checks
- **No `any` types**: Use proper types or `unknown` if necessary
- **Explicit return types**: Always specify function return types
- **No unused variables**: Clean up all unused imports and variables

**Example:**
```typescript
// ✅ Good
export function processMessage(message: string): ProcessedMessage {
  const sanitized = sanitizeInput(message);
  return { content: sanitized, timestamp: Date.now() };
}

// ❌ Bad
export function processMessage(message: any) {
  const sanitized = sanitizeInput(message);
  const unused = "something"; // unused variable
  return { content: sanitized, timestamp: Date.now() };
}
```

### File Organization

- One export per file when possible
- Group related functionality
- Use barrel exports (`index.ts`) for public APIs

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `user-state.ts`)
- **Classes**: `PascalCase` (e.g., `UserState`)
- **Functions**: `camelCase` (e.g., `getUserState`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`)
- **Interfaces**: `PascalCase` (e.g., `UserSession`)

### Error Handling

- Always handle errors explicitly
- Use try-catch for async operations
- Log errors with context using `logger` or `safeLogger`

**Example:**
```typescript
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  logger.error('Operation failed', {
    error: error instanceof Error ? error.message : String(error),
    context: 'specific-operation'
  });
  throw error; // or handle gracefully
}
```

---

## Commit Message Convention

We use **Conventional Commits** for clear, semantic commit messages.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks (deps, config, etc.)
- `refactor:` - Code refactoring without feature changes
- `test:` - Adding or updating tests
- `perf:` - Performance improvements
- `ci:` - CI/CD changes

### Examples

```bash
# Feature
feat(wizard): add project selection wizard

# Bug fix
fix(logger): prevent token leakage in error logs

# Documentation
docs(readme): update installation instructions

# Chore
chore(deps): update dependencies to latest versions

# Refactor
refactor(state): simplify session management logic
```

### Scope (optional)

Use scope to indicate which part of the codebase is affected:
- `bot` - Telegram bot handlers
- `wizard` - Wizard implementations
- `mcp` - MCP server integration
- `state` - State management
- `logger` - Logging system
- `security` - Security-related changes

---

## Pull Request Process

### Before Submitting

✅ **Checklist**:
- [ ] Code builds without errors (`npm run build`)
- [ ] All tests pass (`npm test`)
- [ ] No TypeScript errors
- [ ] No secrets or credentials in commits
- [ ] Code follows style guide
- [ ] Commits follow conventional commits
- [ ] Documentation updated (if needed)

### PR Description

Include in your PR description:

1. **What changed**: Brief summary of changes
2. **Why**: Reason for the change
3. **How**: Technical approach used
4. **Testing**: How you tested the changes
5. **Risks**: Any potential risks or breaking changes
6. **Screenshots**: If UI/UX changes

**Template:**
```markdown
## What Changed
Added interactive project selection wizard

## Why
Users requested easier project switching without typing full paths

## How
- Created new wizard using existing wizard-utils
- Added inline keyboard navigation
- Integrated with existing /switch command

## Testing
- Manual testing with 5+ projects
- Verified pagination works correctly
- Tested timeout and cancellation

## Risks
- Low risk - new feature, doesn't modify existing code

## Screenshots
[Attach screenshots if applicable]
```

### Review Process

1. **Automated checks** will run (build, tests, linting)
2. **Maintainer review** will provide feedback
3. **Address feedback** by pushing new commits
4. **Approval and merge** once all checks pass

---

## Testing Requirements

### Required Tests

All new features must include tests:

- **Unit tests** for business logic
- **Integration tests** for complex flows
- **Mock external dependencies** (Telegram API, Copilot SDK)

### Writing Tests

Use Jest testing framework:

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('MyFeature', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it('should do something correctly', () => {
    const result = myFunction('input');
    expect(result).toBe('expected-output');
  });

  it('should handle errors gracefully', async () => {
    await expect(riskyFunction()).rejects.toThrow('Expected error');
  });
});
```

### Testing Requirements

- All new features must include tests
- Run `npm test` before submitting
- Aim for >80% code coverage

```bash
npm test                # Run all tests
npm run test:coverage   # Tests with coverage
```

---

## Questions or Need Help?

- **Documentation**: Check `README.md` and `SETUP.md`
- **Issues**: Search existing issues or create a new one

Thank you for contributing to Copilot Telegram Bot! 🚀

