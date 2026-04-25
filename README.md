# ADK Tools for VS Code

**Build, run, and deploy Google ADK agents without touching the terminal.**

ADK Tools brings the full [Google Agent Development Kit](https://adk.dev/) workflow into VS Code, Cursor, and Windsurf — project scaffolding, one-click server management, model switching, deployment, eval, and auth setup, all from the sidebar.

---

## Features

### Sidebar — ADK Project View

Open the ADK icon in the Activity Bar to see your project at a glance.

- **Project row** — name, language, detected runner (`uv`, `pipenv`, `venv`, direct)
- **Model row** — current model name (click to switch inline)
- **Development** section — run servers, CLI, open files, auth, run options
- **Deployment** section — Cloud Run, Agent Engine, GKE
- **Evaluation** section — run evals, generate eval cases
- **Help & Diagnostics** — getting started, diagnostics, docs

### Status Bar

Three persistent status bar items appear whenever an ADK project is open:

| State | Items |
|-------|-------|
| Idle | `⚡ ADK · pipenv` &nbsp; `▶ Web` &nbsp; `⊙ API` |
| Web running | `⚡ ADK · pipenv` &nbsp; `$(broadcast) :8000` (click → browser) &nbsp; `◼ Stop` |
| API running | `⚡ ADK · pipenv` &nbsp; `⊙ :8000` (click → browser) &nbsp; `◼ Stop` |
| Hot reload on | `$(sync~spin) hot reload` badge in yellow |

### One-Click Servers

**Run Web UI** (`ADK: Run Web UI`)
Starts `adk web` with your configured port, log level, and session backend. If a server is already running on that port, a modal offers Kill & Restart, Open Browser, or Show What's Running.

**Run API Server** (`ADK: Run API Server`)
Starts `adk api_server`. Web and API share port 8000 by default — starting one gracefully stops the other.

**Stop All Servers** (`ADK: Stop All Servers`)
Disposes terminals and resets status bar.

**Port polling** — even if you Ctrl+C in the terminal, the extension detects the port going idle within 4 seconds and resets UI state automatically.

### Run CLI — `adk run`

`ADK: Run CLI (adk run)` opens a picker for:
- Which agent to target (for multi-agent repos)
- Session mode: New Session · Debug Logging · Resume Last · New + Save

### Model Switcher

`ADK: Switch Model` reads the current `model=` value from your `agent.py`, shows a QuickPick with the current model marked `← current`, and rewrites the file in-place. Offers Restart Web UI or Restart API Server after switching.

**Supported models:**
- `gemini-2.5-pro` — Most capable
- `gemini-2.0-flash` — Fast + capable (recommended default)
- `gemini-2.0-flash-lite` — Fastest, lowest cost
- `gemini-1.5-pro` / `gemini-1.5-flash` — Previous generation
- `claude-3-5-sonnet@20241022` — Anthropic via Vertex AI
- `claude-3-haiku@20240307` — Anthropic via Vertex AI (fast)

### Run Options

`ADK: Run Options` persists per-workspace:

| Setting | CLI flag | Default |
|---------|----------|---------|
| Port | `--port` | `8000` |
| Hot Reload | `--reload_agents` | off |
| Log Level | `--log_level` | `INFO` |
| Session Storage | `--session_service_uri` | `memory://` |

Session storage options: `memory://` · `sqlite:///./sessions.db` · `agentengine://`

### Auth Setup

`ADK: Auth Setup` guides you through two auth paths:

**Gemini API Key**
- Enter key → writes `GOOGLE_API_KEY` to `.env`
- Opens [aistudio.google.com](https://aistudio.google.com/apikey) to create a key
- Verifies `.env` exists and `.gitignore` covers it

**Vertex AI**
- Runs `gcloud auth application-default login` in a terminal
- Sets `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` in `.env`

### Project Scaffolding

`ADK: Create New Agent Project` walks through:
1. Project name (validates lowercase + underscores)
2. Model picker (Gemini 2.0 Flash default)
3. Output directory

Runs `adk create NAME --model MODEL` and offers to open the new project.

### Deployment

`ADK: Deploy Agent` → pick target:

**Cloud Run** (4 steps)
- GCP Project ID · Region · Service Name · With/Without Web UI
- Command: `adk deploy cloud_run --project P --region R --service_name S [--with_ui] .`

**Agent Engine** (3 steps)
- GCP Project ID · Region · Display Name
- Command: `adk deploy agent_engine --project P --region R --display_name "N" --validate-agent-import .`

**GKE** (4 steps)
- GCP Project ID · Region · Cluster Name · Service Type (ClusterIP/LoadBalancer)
- Command: `adk deploy gke --project P --region R --cluster_name C --service_type T .`

All deployment commands use the correct environment prefix (pipenv/uv/venv) automatically.

### Evaluation

`ADK: Run Eval` — discovers `*.test.json` and `*.evalset.json` files in your project tree, shows a picker if multiple found, and runs `adk eval <file>`.

`ADK: Generate Eval Cases` — prompts for an eval set name and runs `adk eval_set generate_eval_cases`.

### Environment & .env

`ADK: Edit .env File` — opens `.env`, creating it from `.env.example` if missing.

`ADK: Show .env Summary` — displays all keys with sensitive values masked.

### Diagnostics

`ADK: Run Diagnostics` — checks:
- `adk`, `gcloud`, `pipenv`, `uv` availability
- Port 8000 status and what process holds it
- Active environment runner

`ADK: Kill Port 8000` — shows the process, asks for confirmation, then kills it.

---

## Code Snippets

Trigger in `.py` or `.ts` files:

### Python

| Prefix | Description |
|--------|-------------|
| `adk-agent` | LlmAgent definition |
| `adk-root` | Root agent (required entry point) |
| `adk-tool` | Tool function with docstring |
| `adk-before-model` | `before_model_callback` |
| `adk-after-model` | `after_model_callback` |
| `adk-before-tool` | `before_tool_callback` |
| `adk-sequential` | SequentialAgent |
| `adk-parallel` | ParallelAgent |
| `adk-loop` | LoopAgent |
| `adk-state` | Session state read/write |
| `adk-agent-file` | Complete agent.py template |

### TypeScript

| Prefix | Description |
|--------|-------------|
| `adk-agent` | LlmAgent |
| `adk-root` | Root agent |
| `adk-tool` | FunctionTool |
| `adk-sequential` | SequentialAgent |
| `adk-parallel` | ParallelAgent |

---

## Environment Auto-Detection

The extension detects your Python environment automatically:

| Environment | Detection | Command prefix |
|-------------|-----------|----------------|
| Pipenv | `Pipfile` present | `pipenv run adk ...` |
| uv | `uv.lock` or `[tool.uv]` in pyproject | `uv run adk ...` |
| .venv | `.venv/bin/adk` exists | `/path/to/.venv/bin/adk ...` |
| System | fallback | `adk ...` |

---

## Requirements

- VS Code 1.85+ (also works in Cursor and Windsurf)
- [ADK CLI](https://adk.dev/get-started/installation/) — `pip install google-adk`
- Python 3.9+
- For deployment: `gcloud` CLI authenticated

---

## Project Detection

The extension recognizes ADK projects by checking (in order):
1. `.adk/` directory at workspace root
2. `agent.py` containing ADK imports (`google.adk`, `LlmAgent`, etc.) within 3 directory levels
3. `requirements.txt` or `pyproject.toml` containing `google-adk`

---

## Getting Started

1. Install the extension
2. Open an ADK project folder (or create one with `ADK: Create New Agent Project`)
3. The ADK icon appears in the Activity Bar — click it
4. Run `ADK: Auth Setup` to configure your API key
5. Click **Run Web UI** — browser opens automatically

---

## Commands

All commands are accessible from:
- The ADK sidebar
- The status bar (`⚡ ADK` badge → command menu)
- The Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → type `ADK`

| Command | Description |
|---------|-------------|
| `ADK: Run Web UI` | Start `adk web` |
| `ADK: Run API Server` | Start `adk api_server` |
| `ADK: Stop All Servers` | Stop running servers |
| `ADK: Open ADK Web UI in Browser` | Open localhost in browser |
| `ADK: Run CLI (adk run)` | Interactive CLI session |
| `ADK: Switch Model` | Change model in agent.py |
| `ADK: Run Options` | Configure port/hotReload/logLevel |
| `ADK: Auth Setup` | Gemini API key or Vertex AI setup |
| `ADK: Deploy Agent` | Deploy to Cloud Run / Agent Engine / GKE |
| `ADK: Run Eval` | Run `adk eval` on eval files |
| `ADK: Generate Eval Cases` | Run `adk eval_set generate_eval_cases` |
| `ADK: Create New Agent Project` | Scaffold with `adk create` |
| `ADK: Open Agent File` | Open agent.py in editor |
| `ADK: Edit .env File` | Open or create .env |
| `ADK: Show .env Summary` | Preview .env with masked secrets |
| `ADK: Run Diagnostics` | Check tools, port, environment |
| `ADK: Kill Port 8000` | Force-free port 8000 |
| `ADK: Show Output Log` | Open ADK Tools output channel |
| `ADK: Getting Started` | Open getting started panel |
| `ADK: Open ADK Documentation` | Open adk.dev |

---

## Extension Settings

Run Options are stored per-workspace via `workspaceState` — no `settings.json` entries needed.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
