# BMAD Agent VS Code Extension

BMAD Agent wraps the [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) into a GitHub Copilot Chat participant that walks you through Brainstorm → Map → Assemble → Deploy and pipes the curated context into Copilot (or a custom LM Studio model) to kick-start delivery.

![BMAD Agent Icon](media/icon.png)

## Features
- `@bmad.agent` participant that launches the BMAD interview when you say `start bmad project`.
- Structured prompts for each BMAD phase stored under `src/resources/prompts`.
- Optional hand-off to GitHub Copilot or a custom LM Studio model via Copilot custom models.
- BMAD Control panel in the Activity Bar that surfaces access level switches, live LM Studio model discovery, and a one-click Copilot hand-off.
- Dedicated LM Studio Chat view that mirrors Copilot/Gemini side panels for an inline conversation against the captured BMAD context.
- Support for LM Studio tool calls that emit actionable TODOs and queue them inside the extension for follow-up.
- `BMAD: Generate Scaffolding` command that materializes a `bmad/` workspace folder with a delivery plan, context JSON, and task checklist driven by your latest answers.
- `BMAD: Refine Current Phase` command that opens phase-specific guidance sourced from the BMAD resources.
- MIT-licensed project with contributing, security, and code-of-conduct guidelines to support community collaboration.

## Installation

### From VSIX
1. Create the packaged extension:
   ```bash
   npm install
   npm run compile
   npx vsce package --no-dependencies
   ```
   The command emits `bmad-agent-<version>.vsix`.
2. In VS Code, open the Extensions view, click the “⋯” menu, choose **Install from VSIX…**, and select the generated file.

### From Source (Extension Development Host)
1. Install dependencies and compile:
   ```bash
   npm install
   npm run compile
   ```
2. Press `F5` inside VS Code to launch a development host with the extension preloaded.

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile the extension:
   ```bash
   npm run compile
   ```
3. Press `F5` in VS Code to launch the Extension Development Host.
4. Open the Copilot Chat panel and type `@bmad.agent start bmad project` to run through the guided intake.

## Scaffolding
- After completing the BMAD intake, run the command palette (`Ctrl+Shift+P`) and choose `BMAD: Generate Scaffolding`.
- Pick a destination folder (defaults to your first workspace folder). The extension creates a `bmad/` directory with:
  - `BMAD_PLAN.md` – a phase-by-phase summary of your responses with deliverables and follow-up prompts.
  - `bmad-context.json` – structured JSON capturing all answers.
  - `TASKS.todo.md` – a checklist combining BMAD phase checklists with your captured context.
- Use `BMAD: Refine Current Phase` anytime to open detailed guidance, deliverables, and references for a specific phase.

## Custom Models with LM Studio
1. Run LM Studio and expose an OpenAI-compatible HTTP endpoint (e.g. `http://127.0.0.1:1234/v1`).
2. Open the **BMAD Control** view in the Activity Bar. The panel fetches the available models from LM Studio on demand—pick the model you want and the extension persists it to your workspace settings.
3. Hop into the **LM Studio Chat** view (also in the Activity Bar) to chat against the stored BMAD context. The panel issues just-in-time LM Studio calls (`just_in_time: true`) so every turn rehydrates context on demand. `Ctrl+Enter` (or `⌘+Enter` on macOS) submits a message, and the transcript sticks around for later hand-off.
4. Choose the desired access mode (Read-only, Workspace, or Full access). Selecting **Full access** requires explicit confirmation so you understand the risks of granting the agent broad filesystem control.
5. Trigger `@bmad.agent start bmad project` in Copilot Chat to capture context. When LM Studio processes the summary it can emit `record_task` tool calls; the extension queues them, surfaces the backlog in both views, and keeps the transcript hydrated.
6. Use the `Copy BMAD context` button or mention `@bmad-lmchat` within the Copilot window to pull the latest LM Studio response, summary, and queued tasks back into Copilot for further prompting.

## Testing & Smoke Checks
- Unit / integration harness:
  ```bash
  npm run test
  ```
- Smoke script that boots the extension with `@vscode/test-electron`:
  ```bash
  npm run smoke
  ```

The smoke script launches a headless VS Code instance, ensures the `bmad.agent` participant registers, and attempts a sample chat turn. When running in restricted or containerised environments, you may need to export `ELECTRON_DISABLE_SANDBOX=1` or add `--no-sandbox --disable-setuid-sandbox` to the VS Code launch arguments if Electron cannot initialise the sandbox.

### LM Studio Smoke Test
Use the repository’s stubbed LM Studio runner to sanity-check tool call parsing without a live LM Studio instance:
```bash
npm run smoke:lmstudio
```

## Project Governance

- [CONTRIBUTING](CONTRIBUTING.md) – development workflow, coding standards, and PR expectations.
- [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) – community expectations based on the Contributor Covenant.
- [SECURITY](SECURITY.md) – how to report and track vulnerabilities.
- [CHANGELOG](CHANGELOG.md) – version history and release notes.

## Packaging BMAD Resources
BMAD resources in `src/resources/` mirror the open-source BMAD-METHOD documentation. Update these files as the upstream project evolves and retain attribution in this README. The extension loads these JSON assets to enrich prompts and future automation (e.g., scaffolding generation).

## Roadmap
- Expand scaffolding to generate starter code or workspace templates beyond the initial plan/task set.
- Persist session answers between runs and surface them in a dedicated view.
- Deepen Copilot hand-off by streaming BMAD-derived tool invocations.
- Add more robust tests covering Copilot delegation and LM Studio integration.
