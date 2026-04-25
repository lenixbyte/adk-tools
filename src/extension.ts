import * as vscode from 'vscode';
import { AdkTreeProvider } from './providers/adkTreeProvider';
import { StatusBarManager } from './providers/statusBarManager';
import { createProject } from './commands/scaffold';
import { runWeb, runApiServer, stopServers, initServerListeners, openBrowser } from './commands/servers';
import { deploy } from './commands/deploy';
import { runDiagnostics, killPort8000 } from './commands/diagnostics';
import { openEnvFile, showEnvSummary } from './commands/envEditor';
import { showGettingStarted } from './webviews/gettingStarted';
import { runCli } from './commands/runner';
import { switchModel } from './commands/modelSwitcher';
import { showAuthWizard } from './commands/authWizard';
import { runEval, generateEvalCases } from './commands/evalRunner';
import { initSettings, showRunOptionsMenu, getRunSettings } from './utils/settings';
import { detectAdkProject } from './utils/detect';
import { detectEnv } from './utils/env';
import { showOutput, log, disposeOutput } from './utils/output';

export function activate(context: vscode.ExtensionContext): void {
  initSettings(context);

  const statusBar = new StatusBarManager();
  const tree = new AdkTreeProvider(statusBar);

  vscode.window.registerTreeDataProvider('adkProjectView', tree);
  updateStatusBarProject(statusBar);

  context.subscriptions.push(
    statusBar,
    { dispose: disposeOutput },
    initServerListeners(statusBar, tree),

    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateStatusBarProject(statusBar);
      tree.refresh();
    }),

    // ── Server commands ───────────────────────────────────────────────────────
    vscode.commands.registerCommand('adk.runWeb', () => runWeb(statusBar, tree)),
    vscode.commands.registerCommand('adk.runApiServer', () => runApiServer(statusBar, tree)),
    vscode.commands.registerCommand('adk.stopServers', () => stopServers(statusBar, tree)),
    vscode.commands.registerCommand('adk.openWebBrowser', () => openBrowser()),

    // ── Project commands ──────────────────────────────────────────────────────
    vscode.commands.registerCommand('adk.createProject', () => createProject(tree)),
    vscode.commands.registerCommand('adk.openConfig', openAgentFile),
    vscode.commands.registerCommand('adk.openEnv', openEnvFile),
    vscode.commands.registerCommand('adk.showEnvSummary', showEnvSummary),
    vscode.commands.registerCommand('adk.deploy', (target?: string) => deploy(target)),

    // ── Run / Dev commands ────────────────────────────────────────────────────
    vscode.commands.registerCommand('adk.runCli', runCli),
    vscode.commands.registerCommand('adk.switchModel', switchModel),
    vscode.commands.registerCommand('adk.runOptions', async () => {
      await showRunOptionsMenu();
      tree.refresh();
    }),
    vscode.commands.registerCommand('adk.authWizard', showAuthWizard),

    // ── Eval commands ─────────────────────────────────────────────────────────
    vscode.commands.registerCommand('adk.runEval', runEval),
    vscode.commands.registerCommand('adk.createEvalFile', generateEvalCases),

    // ── UI / help commands ────────────────────────────────────────────────────
    vscode.commands.registerCommand('adk.showMenu', showMenu),
    vscode.commands.registerCommand('adk.gettingStarted', () => showGettingStarted(context)),
    vscode.commands.registerCommand('adk.diagnostics', runDiagnostics),
    vscode.commands.registerCommand('adk.killPort', killPort8000),
    vscode.commands.registerCommand('adk.showOutput', showOutput),
    vscode.commands.registerCommand('adk.openDocs', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/'))
    ),
    vscode.commands.registerCommand('adk.refresh', () => {
      updateStatusBarProject(statusBar);
      tree.refresh();
    }),
  );

  log('ADK Tools activated.');

  const isFirstRun = !context.globalState.get<boolean>('adk.welcomed');
  if (isFirstRun) {
    context.globalState.update('adk.welcomed', true);
    showGettingStarted(context);
  }
}

export function deactivate(): void { /* cleanup via subscriptions */ }

function updateStatusBarProject(statusBar: StatusBarManager): void {
  const project = detectAdkProject();
  if (project) {
    const env = detectEnv(project.root);
    statusBar.setProject(env.runner);
    log(`Project: ${project.name} (${project.language}, ${env.runner})`);
  } else {
    statusBar.setProject(undefined);
  }
}

function openAgentFile(): void {
  const project = detectAdkProject();
  if (!project) {
    vscode.window.showWarningMessage('No ADK project detected.');
    return;
  }
  vscode.workspace.openTextDocument(project.agentFile)
    .then((doc) => vscode.window.showTextDocument(doc));
}

async function showMenu(): Promise<void> {
  const project = detectAdkProject();
  const settings = getRunSettings();
  type Item = vscode.QuickPickItem & { command?: string };

  const items: Item[] = [
    { label: '$(play) Run Web UI', description: `localhost:${settings.port}`, command: 'adk.runWeb' },
    { label: '$(server-process) Run API Server', description: `localhost:${settings.port}`, command: 'adk.runApiServer' },
    { label: '$(terminal) Run CLI (adk run)', description: 'interactive session', command: 'adk.runCli' },
    { label: '$(stop-circle) Stop All Servers', command: 'adk.stopServers' },
    { label: '$(browser) Open Browser', description: `localhost:${settings.port}`, command: 'adk.openWebBrowser' },
    { kind: vscode.QuickPickItemKind.Separator, label: '' },
    { label: '$(symbol-enum) Switch Model', description: 'change Gemini/Claude model', command: 'adk.switchModel' },
    { label: '$(settings-gear) Run Options', description: 'port · hot reload · log level', command: 'adk.runOptions' },
    { label: '$(shield) Auth Setup', description: 'API key or Vertex AI', command: 'adk.authWizard' },
    { kind: vscode.QuickPickItemKind.Separator, label: '' },
    { label: '$(cloud-upload) Deploy Agent', description: 'Cloud Run · Agent Engine · GKE', command: 'adk.deploy' },
    { label: '$(beaker) Run Eval', description: 'adk eval', command: 'adk.runEval' },
    { label: '$(add) Generate Eval Cases', command: 'adk.createEvalFile' },
    { kind: vscode.QuickPickItemKind.Separator, label: '' },
    { label: '$(go-to-file) Open Agent File', command: 'adk.openConfig' },
    { label: '$(key) Edit .env', description: 'environment variables', command: 'adk.openEnv' },
    { label: '$(add) Create New Agent Project', command: 'adk.createProject' },
    { kind: vscode.QuickPickItemKind.Separator, label: '' },
    { label: '$(book) Getting Started', command: 'adk.gettingStarted' },
    { label: '$(pulse) Run Diagnostics', description: 'tools · port · environment', command: 'adk.diagnostics' },
    { label: '$(trash) Kill Port 8000', description: 'free stuck port', command: 'adk.killPort' },
    { label: '$(output) Show Output Log', command: 'adk.showOutput' },
    { label: '$(link-external) ADK Documentation', command: 'adk.openDocs' },
  ];

  const title = project ? `⚡ ADK — ${project.name}` : '⚡ ADK Tools';

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Select an action',
    matchOnDescription: true,
  });

  if (pick?.command) {
    vscode.commands.executeCommand(pick.command);
  }
}
