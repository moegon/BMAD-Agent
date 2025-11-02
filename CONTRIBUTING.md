# Contributing to BMAD Agent

Thanks for your interest in improving BMAD Agent! This project automates the BMAD-METHOD inside VS Code, and contributions are welcome whether you’re fixing bugs, improving documentation, or shaping the roadmap.

## Development Workflow

1. **Clone & Install**
   ```bash
   git clone https://github.com/<your-org>/bmad-agent.git
   cd bmad-agent
   npm install
   ```
2. **Build & Iterate**
   ```bash
   npm run compile    # one-shot build
   npm run watch      # incremental build in watch mode
   ```
3. **Launch the Extension Host**
   * Open the repository in VS Code.
   * Press `F5` to start the Extension Development Host.
   * Use Copilot Chat with `@bmad.agent start bmad project` to exercise the workflow.

## Testing

| Command | Description |
| --- | --- |
| `npm run test` | Runs the Electron-based extension harness. Requires Electron sandbox disabled in containerised environments (set `ELECTRON_DISABLE_SANDBOX=1`). |
| `npm run smoke` | Basic registration smoke test using `@vscode/test-electron`. |
| `npm run smoke:lmstudio` | Offline smoke test that stubs LM Studio responses and validates task parsing. |

Please make sure the smoke tests pass before opening a pull request. If the Electron sandbox prevents execution, include the failure details in your PR.

## Branching & Pull Requests

* Create a feature branch from `main`: `git checkout -b feature/your-change`.
* Keep changes focused and include tests or documentation updates where relevant.
* Run `npm run compile` and the smoke tests prior to submission.
* Describe the motivation, testing performed, and any follow-up steps in the PR body.

## Coding Standards

* TypeScript code lives under `src/`. Maintain strict typing and leverage the existing patterns for VS Code APIs.
* Keep UI strings and configuration keys centralised and documented in `README.md`.
* Add succinct comments only when the code’s intent is not obvious.
* Use `npm run lint` (ESLint) if you introduce new TypeScript utilities.

## Reporting Issues

* Use the GitHub issue tracker to report bugs or request enhancements.
* Include reproduction steps, expected/actual behaviour, logs (if available), and environment info (VS Code version, platform, LM Studio setup).

## Code of Conduct

Please read and follow the [Code of Conduct](CODE_OF_CONDUCT.md). We expect all community members to uphold a welcoming, harassment-free environment.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
