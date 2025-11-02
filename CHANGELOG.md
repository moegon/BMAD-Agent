# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) where possible (pre-1.0 releases may introduce breaking changes between minors).

## [0.0.2] - 2025-11-02
### Added
- Activity Bar **BMAD Control** view with access mode controls, LM Studio model discovery, and Copilot hand-off helper.
- Activity Bar **LM Studio Chat** view that mirrors Codex/Gemini-style side panels, supports just-in-time LM Studio calls, and surfaces the running conversation history.
- Persistent LM Studio conversation storage, enabling the `@bmad.lmchat` bridge and clipboard command to replay the captured context.
- Tool-call ingestion that queues LM Studio `record_task` payloads for follow-up inside the extension.
- Project metadata: MIT license, contribution guidelines, code of conduct, and security policy.

### Changed
- Package activation events and chat participant IDs now align (`bmad.lmchat`).
- README expanded with workflow diagrams for the new views and testing guidance.

### Known Issues
- `npm run test` may fail in sandboxed environments unless Electron sandboxing is disabled (`ELECTRON_DISABLE_SANDBOX=1`).

## [0.0.1] - 2025-10-31
### Added
- Initial BMAD chat participant that collects Brainstorm → Map → Assemble → Deploy answers.
- Optional hand-off to GitHub Copilot or LM Studio via the `sendToCopilot` and `sendToLmStudio` paths.
- Scaffolding generator that emits BMAD deliverables into the workspace.
- LM Studio smoke harness for offline development.

[0.0.2]: https://github.com/gpurig/bmad-agent/releases/tag/v0.0.2
[0.0.1]: https://github.com/gpurig/bmad-agent/releases/tag/v0.0.1
