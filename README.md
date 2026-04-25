<div align="center">

<img src="resources/logo.png" width="128" height="128" alt="ADK Tools logo"/>

# ADK Tools

---

**Build, run, and deploy Google ADK agents — without touching the terminal.**

A VS Code, Cursor, and Windsurf extension that brings the full [Google Agent Development Kit](https://adk.dev/) workflow into your editor: one-click servers, model switching, deployment to Cloud Run and Vertex AI, eval runner, auth setup, and code snippets.

[![Open VSX](https://img.shields.io/open-vsx/v/lenixbyte/adk-tools?label=Open%20VSX&color=purple&logo=eclipse&logoColor=white)](https://open-vsx.org/extension/lenixbyte/adk-tools)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/lenixbyte/adk-tools?color=6a5acd&label=downloads)](https://open-vsx.org/extension/lenixbyte/adk-tools)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)

</div>

---

## Preview

<div align="center">

<img src="media/screenshot-running.png" width="720" alt="ADK Tools — server running with syntax-highlighted agent.py and live status bar"/>

*Web UI running on :8000 · live status bar · syntax-highlighted agent.py*

</div>

<br/>

<div align="center">
<img src="media/screenshot-sidebar.png" width="340" alt="ADK sidebar tree view"/>
&nbsp;&nbsp;&nbsp;
<img src="media/screenshot-quickpick.png" width="520" alt="Model switcher QuickPick"/>
</div>

<div align="center">

*Sidebar with project info, running state, and sections · Model switcher with current model highlighted*

</div>

<br/>

<div align="center">

<img src="media/screenshot-install.png" width="580" alt="ADK install wizard"/>

*Auto-detects uv / pip / pipenv and installs google-adk in one click*

</div>

---

## What it does

| | |
|---|---|
| **⚡ One-click servers** | Start `adk web` or `adk api_server` with port conflict detection, hot reload, and status bar live state |
| **🔄 Model switcher** | Detect and rewrite `model=` in your agent file — Gemini 2.0/2.5, Claude via Vertex AI |
| **☁️ Deploy anywhere** | Cloud Run, Agent Engine, and GKE via native `adk deploy` — with guided step-by-step inputs |
| **🧪 Eval runner** | Discover eval files and run `adk eval` or generate cases with `adk eval_set` |
| **🔑 Auth wizard** | Set up Gemini API key (writes to `.env`, checks `.gitignore`) or Vertex AI credentials |
| **📦 Project scaffolding** | 3-step wizard using `adk create` — name, model, output folder |
| **💻 CLI runner** | `adk run` with multi-agent picker and session mode selection |
| **📝 Code snippets** | Python & TypeScript snippets for agents, tools, callbacks, pipelines |

---

## Installation

**Open VSX (Cursor, Windsurf, Gitpod)**
Search `ADK Tools` in the Extensions panel, or:
```
ext install lenixbyte.adk-tools
```

**Manual (.vsix)**
Download from [Releases](https://github.com/lenixbyte/adk-tools/releases) and drag into the Extensions panel.

**Requirements**
- VS Code 1.85+ / Cursor / Windsurf
- [ADK CLI](https://adk.dev/get-started/installation/) — `pip install google-adk`

---

## Features

### Sidebar

Open the **ADK icon** in the Activity Bar to see your project at a glance.

```
ADK Project
├── my_agent          python · uv          ← project row
│   └── gemini-2.0-flash  click to switch  ← model row
├── Development  (expanded)
│   ├── ▶ Run Web UI
│   ├── ⊙ Run API Server
│   ├── ⬛ Run CLI (adk run)
│   ├── 🔑 Auth Setup
│   └── ⚙ Run Options
├── Deployment  (collapsed)
│   ├── ☁ Deploy to Cloud Run
│   ├── ⬡ Deploy to Agent Engine
│   └── ⎔ Deploy to GKE
├── Evaluation  (collapsed)
│   ├── ▷ Run Eval
│   └── + Generate Eval Cases
└── Help & Diagnostics  (collapsed)
```

### Status Bar

Three persistent items appear when an ADK project is detected:

| State | Status Bar |
|-------|-----------|
| Idle | `⚡ ADK · uv` &ensp; `▶ Web` &ensp; `⊙ API` |
| Web running | `⚡ ADK · uv` &ensp; `📡 :8000` (→ browser) &ensp; `◼ Stop` |
| API running | `⚡ ADK · uv` &ensp; `⊙ :8000` (→ browser) &ensp; `◼ Stop` |
| Hot reload | `↻ hot reload` (yellow badge) |

The extension polls the port every 4 seconds — if your server exits via Ctrl+C, the UI resets automatically.

### Server Management

**`ADK: Run Web UI`** / **`ADK: Run API Server`**

- Detects your environment (pipenv / uv / .venv / system) and builds the right command
- Port conflict modal: **Kill & Restart**, **Open Browser**, or **Show What's Running**
- Web and API share port 8000 — starting one gracefully stops the other

**Run Options** (persisted per workspace)

| Setting | Flag | Default |
|---------|------|---------|
| Port | `--port` | `8000` |
| Hot Reload | `--reload_agents` | off |
| Log Level | `--log_level` | `INFO` |
| Session Storage | `--session_service_uri` | `memory://` |

Session backends: `memory://` · `sqlite:///./sessions.db` · `agentengine://`

### Model Switcher

`ADK: Switch Model` reads `model=` from your `agent.py`, marks the current model with `← current`, and rewrites the file in-place. Offers to restart the server after switching.

**Supported models**

| Model | Notes |
|-------|-------|
| `gemini-2.5-pro` | Most capable |
| `gemini-2.0-flash` | Recommended default |
| `gemini-2.0-flash-lite` | Fastest / lowest cost |
| `gemini-1.5-pro` / `gemini-1.5-flash` | Previous generation |
| `claude-3-5-sonnet@20241022` | Anthropic via Vertex AI |
| `claude-3-haiku@20240307` | Anthropic via Vertex AI (fast) |

### Auth Setup

**Gemini API Key** — enters key, writes `GOOGLE_API_KEY` to `.env`, verifies `.gitignore` covers it. Opens [AI Studio](https://aistudio.google.com/apikey) if you need a key.

**Vertex AI** — runs `gcloud auth application-default login`, sets `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` in `.env`.

### Deployment

`ADK: Deploy Agent` → pick target:

**Cloud Run** (4 steps) — project, region, service name, with/without Web UI
```
adk deploy cloud_run --project P --region R --service_name S [--with_ui] .
```

**Agent Engine** (3 steps) — project, region, display name
```
adk deploy agent_engine --project P --region R --display_name "N" --validate-agent-import .
```

**GKE** (4 steps) — project, region, cluster name, service type
```
adk deploy gke --project P --region R --cluster_name C --service_type T .
```

### Code Snippets

Type a prefix in `.py` or `.ts` files and press Tab.

**Python**

| Prefix | Inserts |
|--------|---------|
| `adk-agent` | `LlmAgent(...)` |
| `adk-root` | `root_agent = LlmAgent(...)` |
| `adk-tool` | Tool function with full docstring |
| `adk-before-model` | `before_model_callback` |
| `adk-after-model` | `after_model_callback` |
| `adk-before-tool` | `before_tool_callback` |
| `adk-sequential` | `SequentialAgent(...)` |
| `adk-parallel` | `ParallelAgent(...)` |
| `adk-loop` | `LoopAgent(...)` |
| `adk-state` | Session state read/write |
| `adk-agent-file` | Complete `agent.py` template |

**TypeScript**

| Prefix | Inserts |
|--------|---------|
| `adk-agent` | `new LlmAgent({...})` |
| `adk-root` | `export const rootAgent = ...` |
| `adk-tool` | `new FunctionTool({...})` |
| `adk-sequential` | `new SequentialAgent({...})` |
| `adk-parallel` | `new ParallelAgent({...})` |

---

## Environment Detection

The extension detects your Python environment automatically — no configuration required.

| Environment | Detected by | Command |
|-------------|-------------|---------|
| Pipenv | `Pipfile` present | `pipenv run adk ...` |
| uv | `uv.lock` or `[tool.uv]` in pyproject | `uv run adk ...` |
| .venv | `.venv/bin/adk` exists | `/path/.venv/bin/adk ...` |
| System | fallback | `adk ...` |

---

## Project Detection

The extension recognizes ADK projects by checking (in order):

1. `.adk/` directory at workspace root
2. `agent.py` with ADK imports (`google.adk`, `LlmAgent`, etc.) within 3 directory levels
3. `requirements.txt` or `pyproject.toml` containing `google-adk`

Multi-agent repos are supported — the CLI runner lets you pick which agent to target.

---

## All Commands

Access from the sidebar, status bar (`⚡ ADK` → command menu), or `Ctrl+Shift+P` → type `ADK`.

| Command | Description |
|---------|-------------|
| `ADK: Run Web UI` | Start `adk web` |
| `ADK: Run API Server` | Start `adk api_server` |
| `ADK: Stop All Servers` | Stop running servers |
| `ADK: Open ADK Web UI in Browser` | Open localhost |
| `ADK: Run CLI (adk run)` | Interactive CLI with mode picker |
| `ADK: Switch Model` | Change model in `agent.py` |
| `ADK: Run Options` | Configure port / hot reload / log level |
| `ADK: Auth Setup` | Gemini API key or Vertex AI setup |
| `ADK: Deploy Agent` | Cloud Run / Agent Engine / GKE |
| `ADK: Run Eval` | Run `adk eval` |
| `ADK: Generate Eval Cases` | Run `adk eval_set generate_eval_cases` |
| `ADK: Create New Agent Project` | Scaffold with `adk create` |
| `ADK: Open Agent File` | Open `agent.py` |
| `ADK: Edit .env File` | Open or create `.env` |
| `ADK: Show .env Summary` | Preview with masked secrets |
| `ADK: Run Diagnostics` | Check tools, port, environment |
| `ADK: Kill Port 8000` | Force-free port 8000 |
| `ADK: Show Output Log` | Open ADK Tools output channel |
| `ADK: Getting Started` | Getting started panel |
| `ADK: Open ADK Documentation` | Open adk.dev |

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

---

<div align="center">

Made with ♥ for the [Google ADK](https://adk.dev/) community

</div>
