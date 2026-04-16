# BMAD Agent — Security and Quality Rules

## Security

- Never commit API keys, tokens, passwords, or other secrets to source control.
- Webview scripts must always use nonce-based Content Security Policy headers.
- Access mode escalation to "full" requires explicit user confirmation via modal dialog.
- LM Studio API keys are stored in VS Code settings, not in source code.
- External HTTP calls (LM Studio) must use timeout and abort controllers.
- Validate all data received from webview `postMessage` before acting on it.

## Code Quality

- All TypeScript files must compile with zero errors under strict mode.
- Run `npm run lint` before committing — no ESLint warnings or errors.
- Every exported function should have an explicit return type annotation.
- Prefer immutable data structures; avoid mutating shared state.
- Error paths must either surface a user-facing message or log a diagnostic.
- Never silently swallow exceptions.

## Testing Requirements

- New features must include at least one corresponding test.
- Integration tests go in `src/test/suite/` with `.test.ts` extension.
- Smoke tests go in `scripts/` and run via `npm run smoke`.
- Tests must pass in containerised environments with `ELECTRON_DISABLE_SANDBOX=1`.

## Pull Request Standards

- Follow conventional commit messages (e.g., `feat:`, `fix:`, `chore:`).
- Keep PRs focused on a single concern.
- Update CHANGELOG.md for user-facing changes.
- Update README.md if the change affects installation, usage, or configuration.
