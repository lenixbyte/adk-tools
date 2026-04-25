import * as vscode from 'vscode';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { isPortInUse } from '../utils/port';
import { isCommandAvailable } from '../utils/tools';

let panel: vscode.WebviewPanel | undefined;

export async function showGettingStarted(context: vscode.ExtensionContext): Promise<void> {
  if (panel) {
    panel.reveal();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'adkGettingStarted',
    'ADK Tools — Getting Started',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.onDidDispose(() => { panel = undefined; });

  panel.webview.onDidReceiveMessage(async (msg: { command: string }) => {
    switch (msg.command) {
      case 'runWeb':        vscode.commands.executeCommand('adk.runWeb'); break;
      case 'runApi':        vscode.commands.executeCommand('adk.runApiServer'); break;
      case 'createProject': vscode.commands.executeCommand('adk.createProject'); break;
      case 'diagnostics':   vscode.commands.executeCommand('adk.diagnostics'); break;
      case 'openDocs':      vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/')); break;
      case 'openBrowser':   vscode.env.openExternal(vscode.Uri.parse('http://localhost:8000')); break;
    }
  });

  panel.webview.html = await buildHtml();
}

async function buildHtml(): Promise<string> {
  const project = detectAdkProject();
  const env = project ? detectEnv(project.root) : null;

  const adkOk = await isCommandAvailable('adk --version');
  const gcloudOk = await isCommandAvailable('gcloud --version');
  const port8000 = await isPortInUse(8000);

  const projectSection = project
    ? `<div class="card info-card">
        <div class="card-label">Detected Project</div>
        <div class="info-row"><span class="label">Name</span><span class="value">${project.name}</span></div>
        <div class="info-row"><span class="label">Language</span><span class="value">${project.language}</span></div>
        <div class="info-row"><span class="label">Runner</span><span class="value">${env?.runner ?? '—'}</span></div>
        <div class="info-row"><span class="label">Command</span><span class="value mono">${env?.adkCmd('web') ?? 'adk web'}</span></div>
      </div>`
    : `<div class="card warn-card">
        <div class="card-label">No ADK project detected</div>
        <p>Open a folder that contains an ADK agent, or create a new project.</p>
        <button onclick="send('createProject')">+ Create New Agent Project</button>
      </div>`;

  const toolRow = (name: string, ok: boolean) =>
    `<div class="info-row">
      <span class="label">${name}</span>
      <span class="value ${ok ? 'ok' : 'err'}">${ok ? '✓ installed' : '✗ not found'}</span>
    </div>`;

  const portRow = `<div class="info-row">
    <span class="label">Port 8000</span>
    <span class="value ${port8000 ? 'warn' : 'ok'}">${port8000 ? '● in use' : '○ free'}</span>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px;
    line-height: 1.6;
  }
  h1 { font-size: 1.4em; font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  h2 { font-size: 1em; font-weight: 600; margin-bottom: 12px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.08em; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; font-size: 0.9em; }
  .card {
    background: var(--vscode-editorWidget-background, var(--vscode-editor-inactiveSelectionBackground));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .info-card { border-left: 3px solid var(--vscode-activityBarBadge-background); }
  .warn-card { border-left: 3px solid var(--vscode-editorWarning-foreground); }
  .card-label { font-weight: 600; margin-bottom: 12px; }
  .info-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15)); }
  .info-row:last-child { border-bottom: none; }
  .label { color: var(--vscode-descriptionForeground); }
  .value { font-weight: 500; }
  .value.mono { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .ok { color: var(--vscode-charts-green, #4caf50); }
  .warn { color: var(--vscode-editorWarning-foreground, #ff9800); }
  .err { color: var(--vscode-charts-red, #f44336); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    cursor: pointer;
    font-size: var(--vscode-font-size);
    font-family: var(--vscode-font-family);
    display: flex; align-items: center; gap: 6px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .tip {
    padding: 10px 14px;
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-activityBarBadge-background);
    border-radius: 0 4px 4px 0;
    margin-bottom: 8px;
    font-size: 0.9em;
  }
  .tip strong { display: block; margin-bottom: 2px; }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); margin: 20px 0; }
  section { margin-bottom: 24px; }
  .zap { font-size: 1.1em; }
</style>
</head>
<body>

<h1><span class="zap">⚡</span> ADK Tools</h1>
<p class="subtitle">Google Agent Development Kit — VS Code Extension</p>

<section>
  <h2>Your Project</h2>
  ${projectSection}
</section>

<section>
  <h2>Quick Actions</h2>
  <div class="actions">
    <button onclick="send('runWeb')">▶ Run Web UI</button>
    <button onclick="send('runApi')">▶ Run API Server</button>
    <button onclick="send('openBrowser')" class="secondary">⬡ Open localhost:8000</button>
    <button onclick="send('diagnostics')" class="secondary">🩺 Diagnostics</button>
  </div>
</section>

<hr>

<section>
  <h2>Environment Check</h2>
  <div class="card">
    ${toolRow('adk', adkOk)}
    ${toolRow('gcloud', gcloudOk)}
    ${portRow}
  </div>
</section>

<section>
  <h2>Tips</h2>
  <div class="tip">
    <strong>Web UI and API Server share port 8000</strong>
    Only one can run at a time. Use "Stop All Servers" before switching.
  </div>
  <div class="tip">
    <strong>adk not found?</strong>
    The extension auto-detects your environment (pipenv, uv, .venv). If it still fails,
    make sure your virtual environment is active in the terminal, then reload the window.
  </div>
  <div class="tip">
    <strong>Port 8000 already in use?</strong>
    Click Run Web UI — you'll get a dialog to kill the existing process or open the browser if it's already running.
  </div>
  <div class="tip">
    <strong>Status bar buttons</strong>
    Look at the bottom bar for <code>⚡ ADK · pipenv  ▶ Web  ▶ API</code> — one-click access without opening this panel.
  </div>
</section>

<hr>

<div class="actions">
  <button onclick="send('openDocs')" class="secondary">↗ ADK Documentation</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function send(command) { vscode.postMessage({ command }); }
</script>
</body>
</html>`;
}
