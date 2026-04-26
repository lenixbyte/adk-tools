## v1.0.7 — 2026-04-25

### Bug Fixes
- pass AGENT_MODULE_FILE_PATH to eval_set generate_eval_cases command

### Other
- ci: add Open VSX publish step to release workflow


# Changelog

## v1.0.9 — 2026-04-27

### Added

- **Agent Graph** — Interactive webview that visualizes the full agent hierarchy as a connected graph. Fetches live DOT source from the running ADK server (`/dev/{app}/graph`) with automatic disk-parse fallback when offline. Supports pan, zoom, fit, and click-to-source navigation. Multi-agent repos show an agent picker; a port config button opens Run Options directly from the graph toolbar.

- **Debug Agent** — One click generates `.vscode/launch.json` with a debugpy configuration pointed at the resolved ADK binary. Preserves any existing launch configurations and handles venv, PATH, and global installs automatically. Hit F5 to debug with full breakpoint support in agent code.

- **@adk Chat Participant** — Type `@adk` in GitHub Copilot Chat, Cursor, or Windsurf to get project-aware ADK assistance. Automatically reads the agent file, active model, auth configuration, and recent eval history to provide context-rich answers and code examples.

- **Eval History panel** — Tracks every `adk eval` run in `.adk/eval_history.json`. The Eval History webview shows pass rates, case counts, and model used across runs with color-coded badges.

- **Scaffold wizard — 4 agent type templates** — Create New Agent Project now offers Single Agent, Multi-Agent Pipeline, MCP Agent, and A2A Agent templates. Each generates a complete, runnable file structure including `agent.py`, `__init__.py`, `.env`, and `.gitignore`.

- **Expanded code snippets** — 17 Python snippets and 11 TypeScript snippets covering all agent types (`LlmAgent`, `SequentialAgent`, `ParallelAgent`, `LoopAgent`), `MCPToolset`, `AgentTool`, all four callback hooks, session/user/app state patterns, and a full `.env` template.

### Fixed

- **Server startup command truncation** — Commands sent via `sendText` were silently dropping the first character on shells with oh-my-zsh update prompts active (e.g. `ipenv` instead of `pipenv`). Switched to `shellPath` / `shellArgs: ['-c', cmd]` to bypass interactive shell startup entirely.

### Improved

- **README** — Full restructure: side-by-side screenshots with captions, new Agent Graph screenshot, Quick Start guide, commands table grouped by category, snippet tables moved to collapsible `<details>` blocks, VS Code Marketplace badge added, `@adk` description updated to mention Cursor and Windsurf.

---

## v1.0.7 — 2026-04-25

### Fixed

- Pass `AGENT_MODULE_FILE_PATH` to `eval_set generate_eval_cases` command

---

## v1.0.6 — 2026-04-25

### Added

- Live Vertex AI model fetch, CI/CD release pipeline, marketplace categories
