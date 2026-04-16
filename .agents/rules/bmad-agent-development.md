# BMAD Agent — Development Rules

You are working on the **BMAD Agent** VS Code extension. This extension wraps the
[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) into a GitHub Copilot
Chat participant that guides users through Brainstorm → Map → Assemble → Deploy and
pipes the captured context into Copilot or a custom LM Studio model.

## Project Structure

```
src/
├── extension.ts           # Entry point — chat participants, commands, activation
├── bmadResources.ts       # Phase definitions (questions, deliverables, checklists)
├── copilotBridge.ts       # Prompt construction and Copilot LLM delegation
├── lmStudioClient.ts      # HTTP client for LM Studio OpenAI-compatible endpoint
├── lmChatContext.ts        # Persistent LM Studio conversation storage
├── lmChatViewProvider.ts   # Webview: LM Studio Chat panel
├── sidebarProvider.ts      # Webview: BMAD Control Panel
├── scaffolding.ts          # Workspace artifact generation
├── accessControl.ts        # Access mode types (read/workspace/full)
├── modelSelection.ts       # Model configuration and selection
├── resourceLoader.ts       # JSON resource loader from dist/
├── storageKeys.ts          # Storage key constants
├── taskQueue.ts            # Task queue for LM Studio tool calls
├── resources/prompts/      # Phase-specific JSON guidance files
└── test/                   # Mocha integration tests
```

## Coding Standards

- TypeScript strict mode, ES2020 target, CommonJS modules.
- Use `vscode.workspace.fs` for all file operations (not Node `fs`).
- Webview HTML must include nonce-based Content Security Policy.
- Prefer `const`; use `let` only when reassignment is needed.
- Use explicit return types on exported functions.
- Never commit secrets or API keys.

## Build Commands

```bash
npm install               # Install dependencies
npm run compile           # Compile TypeScript + copy resources
npm run lint              # Run ESLint
npm run test              # Electron-based integration tests
npm run smoke             # Headless smoke check
npm run smoke:lmstudio    # LM Studio mock validation
```

## Key Architecture Decisions

- Chat participants (`@bmad.agent`, `@bmad.lmchat`) are registered via VS Code Chat API.
- Webview providers use inline HTML with `vscode.WebviewViewProvider`.
- Phase identifiers use the `PhaseId` union type (`"brainstorm" | "map" | "assemble" | "deploy"`).
- Copilot bridge maintains an LRU model cache (max 5 per conversation).
- LM Studio requests use `just_in_time: true` for on-demand context rehydration.
- Resources are copied from `src/resources/` to `dist/resources/` at build time.

## BMAD-METHOD Alignment

This extension aligns with the upstream BMAD-METHOD v6 framework:
- Four delivery phases map to Analysis → Planning → Solutioning → Implementation.
- Scaffolding output follows `_bmad-output/` conventions where possible.
- Agent skills reference patterns like `bmad-help`, `bmad-create-prd`, etc.
