import * as vscode from 'vscode';
import { StatusBarManager } from '../providers/statusBarManager';
import { AdkTreeProvider } from '../providers/adkTreeProvider';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { isPortInUse, killPort, lsofPort } from '../utils/port';
import { log, showOutput } from '../utils/output';
import { getRunSettings } from '../utils/settings';


let webTerminal: vscode.Terminal | undefined;
let apiTerminal: vscode.Terminal | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

export function initServerListeners(
  statusBar: StatusBarManager,
  tree: AdkTreeProvider
): vscode.Disposable {
  return vscode.window.onDidCloseTerminal((terminal) => {
    if (terminal === webTerminal) {
      webTerminal = undefined;
      statusBar.setWebRunning(false);
      statusBar.setHotReload(false);
      stopPoll();
      tree.refresh();
      log('Web UI terminal closed.');
    }
    if (terminal === apiTerminal) {
      apiTerminal = undefined;
      statusBar.setApiRunning(false);
      statusBar.setHotReload(false);
      stopPoll();
      tree.refresh();
      log('API Server terminal closed.');
    }
  });
}

export async function runWeb(statusBar: StatusBarManager, tree: AdkTreeProvider): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  if (statusBar.isWebRunning() && webTerminal) {
    webTerminal.show();
    vscode.window.showInformationMessage(
      `ADK Web UI is running on localhost:${statusBar.getPort()}`, 'Open Browser'
    ).then((a) => a && openBrowser(statusBar.getPort()));
    return;
  }

  if (statusBar.isApiRunning()) { disposeApiTerminal(statusBar, tree); }

  const settings = getRunSettings();
  if (!await handlePortConflict(settings.port, 'Web UI')) return;

  const env = detectEnv(project.root);
  const flags = buildFlags(settings, 'web');
  const cmd = env.adkCmd(`web${flags}`);

  log(`Starting Web UI: ${cmd} (cwd: ${project.webRoot})`);
  webTerminal = vscode.window.createTerminal({ name: 'ADK Web UI', cwd: project.webRoot });
  webTerminal.show();
  webTerminal.sendText(cmd);

  statusBar.setWebRunning(true, settings.port);
  statusBar.setHotReload(settings.hotReload);
  tree.refresh();
  startPoll(settings.port, statusBar, tree);

  setTimeout(() => {
    vscode.window.showInformationMessage(
      `ADK Web UI on localhost:${settings.port}`,
      'Open Browser', 'Copy URL'
    ).then((a) => {
      if (a === 'Open Browser') openBrowser(settings.port);
      else if (a === 'Copy URL') vscode.env.clipboard.writeText(`http://localhost:${settings.port}`);
    });
  }, 2500);
}

export async function runApiServer(statusBar: StatusBarManager, tree: AdkTreeProvider): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  if (statusBar.isApiRunning() && apiTerminal) {
    apiTerminal.show();
    vscode.window.showInformationMessage(
      `ADK API Server is running on localhost:${statusBar.getPort()}`, 'Copy URL'
    ).then((a) => a && vscode.env.clipboard.writeText(`http://localhost:${statusBar.getPort()}`));
    return;
  }

  if (statusBar.isWebRunning()) { disposeWebTerminal(statusBar, tree); }

  const settings = getRunSettings();
  if (!await handlePortConflict(settings.port, 'API Server')) return;

  const env = detectEnv(project.root);
  const flags = buildFlags(settings, 'api_server');
  const cmd = env.adkCmd(`api_server${flags}`);

  log(`Starting API Server: ${cmd} (cwd: ${project.webRoot})`);
  apiTerminal = vscode.window.createTerminal({ name: 'ADK API Server', cwd: project.webRoot });
  apiTerminal.show();
  apiTerminal.sendText(cmd);

  statusBar.setApiRunning(true, settings.port);
  statusBar.setHotReload(settings.hotReload);
  tree.refresh();
  startPoll(settings.port, statusBar, tree);

  setTimeout(() => {
    vscode.window.showInformationMessage(
      `ADK API Server on localhost:${settings.port}`, 'Copy URL'
    ).then((a) => a && vscode.env.clipboard.writeText(`http://localhost:${settings.port}`));
  }, 2000);
}

export function stopServers(statusBar: StatusBarManager, tree: AdkTreeProvider): void {
  let stopped = 0;
  if (webTerminal) { disposeWebTerminal(statusBar, tree); stopped++; }
  if (apiTerminal) { disposeApiTerminal(statusBar, tree); stopped++; }
  if (statusBar.isAnyRunning()) { statusBar.clearRunning(); stopped++; }
  statusBar.setHotReload(false);
  stopPoll();
  tree.refresh();
  const msg = stopped > 0 ? 'ADK servers stopped.' : 'No ADK servers were running.';
  log(msg);
  vscode.window.showInformationMessage(msg);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFlags(settings: ReturnType<typeof getRunSettings>, mode: 'web' | 'api_server'): string {
  const parts: string[] = [];
  if (settings.port !== 8000) parts.push(`--port ${settings.port}`);
  if (settings.hotReload) parts.push('--reload_agents');
  if (settings.logLevel !== 'INFO') parts.push(`--log_level ${settings.logLevel}`);
  if (settings.sessionUri !== 'memory://') parts.push(`--session_service_uri ${settings.sessionUri}`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

function disposeWebTerminal(statusBar: StatusBarManager, tree: AdkTreeProvider): void {
  webTerminal?.dispose(); webTerminal = undefined;
  statusBar.setWebRunning(false); statusBar.setHotReload(false);
  tree.refresh();
}

function disposeApiTerminal(statusBar: StatusBarManager, tree: AdkTreeProvider): void {
  apiTerminal?.dispose(); apiTerminal = undefined;
  statusBar.setApiRunning(false); statusBar.setHotReload(false);
  tree.refresh();
}

function startPoll(port: number, statusBar: StatusBarManager, tree: AdkTreeProvider): void {
  stopPoll();
  pollTimer = setInterval(async () => {
    if (!statusBar.isAnyRunning()) { stopPoll(); return; }
    const busy = await isPortInUse(port);
    if (!busy) {
      log(`Port ${port} no longer in use — server process exited.`);
      statusBar.clearRunning();
      statusBar.setHotReload(false);
      webTerminal = undefined; apiTerminal = undefined;
      stopPoll(); tree.refresh();
    }
  }, 4000);
}

function stopPoll(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
}

async function handlePortConflict(port: number, serverName: string): Promise<boolean> {
  const busy = await isPortInUse(port);
  if (!busy) return true;

  const lsof = await lsofPort(port);
  log(`Port ${port} busy when starting ${serverName}:\n${lsof}`);

  const action = await vscode.window.showWarningMessage(
    `Port ${port} is already in use — can't start ADK ${serverName}.`,
    { modal: true },
    'Kill & Restart', 'Open Browser', "Show What's Running"
  );

  if (action === 'Kill & Restart') {
    try {
      await killPort(port);
      await new Promise((r) => setTimeout(r, 600));
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`Kill failed: ${msg}`);
      vscode.window.showErrorMessage(`Could not free port ${port}: ${msg}`);
      return false;
    }
  }
  if (action === 'Open Browser') { openBrowser(port); return false; }
  if (action === "Show What's Running") { showOutput(); return false; }
  return false;
}

export function openBrowser(port?: number): void {
  const p = port ?? getRunSettings().port;
  vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${p}`));
}
