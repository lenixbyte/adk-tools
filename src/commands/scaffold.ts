import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { promisify } from 'util';
import { AdkTreeProvider } from '../providers/adkTreeProvider';
import { isCommandAvailable } from '../utils/tools';
import { log } from '../utils/output';

const execAsync = promisify(cp.exec);

const MODELS = [
  { label: 'gemini-2.0-flash', description: 'Recommended — fast, capable (default)' },
  { label: 'gemini-2.5-pro', description: 'Most capable, higher latency' },
  { label: 'gemini-2.0-flash-lite', description: 'Fastest, lowest cost' },
  { label: 'gemini-1.5-pro', description: 'Previous generation Pro' },
  { label: 'gemini-1.5-flash', description: 'Previous generation Flash' },
];

export async function createProject(tree: AdkTreeProvider): Promise<void> {
  const hasAdk = await isCommandAvailable('adk --version');

  if (!hasAdk) {
    const installed = await runInstallWizard();
    if (!installed) return;
  }

  await runCreateWizard(tree);
}

// ─── Install Wizard ───────────────────────────────────────────────────────────

async function runInstallWizard(): Promise<boolean> {
  const python = await detectPython();
  const hasUv = await isCommandAvailable('uv --version');
  const hasPipenv = await isCommandAvailable('pipenv --version');

  type Method = 'uv' | 'pip' | 'venv' | 'pipenv' | 'docs';

  const options: (vscode.QuickPickItem & { value: Method })[] = [];

  if (hasUv) {
    options.push({
      label: '$(package) Install with uv  (recommended)',
      description: 'uv tool install google-adk',
      detail: 'Fast — uv detected in your environment',
      value: 'uv',
    });
  }
  if (python) {
    options.push({
      label: '$(package) Install with pip',
      description: `${python} -m pip install google-adk`,
      detail: 'Installs globally into your system Python',
      value: 'pip',
    });
    options.push({
      label: '$(folder) Create .venv and install  (isolated)',
      description: 'python -m venv .venv && pip install google-adk',
      detail: 'Recommended for keeping projects self-contained',
      value: 'venv',
    });
  }
  if (hasPipenv) {
    options.push({
      label: '$(package) Install with pipenv',
      description: 'pipenv install google-adk',
      detail: 'Adds to current Pipfile',
      value: 'pipenv',
    });
  }
  options.push({
    label: '$(link-external) Open install docs',
    description: 'adk.dev/get-started/installation',
    value: 'docs',
  });

  if (options.length === 1) {
    // Only docs option — Python not found at all
    vscode.window.showErrorMessage(
      'Python 3 not found. Install Python 3.9+ first, then retry.',
      'python.org', 'Install Docs'
    ).then((a) => {
      if (a === 'python.org') vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
      else if (a === 'Install Docs') vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/installation/'));
    });
    return false;
  }

  const pick = await vscode.window.showQuickPick(options, {
    title: 'ADK CLI not found — Install google-adk',
    placeHolder: 'Choose how to install ADK',
    matchOnDetail: true,
  });
  if (!pick) return false;

  if (pick.value === 'docs') {
    vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/installation/'));
    return false;
  }

  if (pick.value === 'venv') {
    return installInVenv(python!);
  }

  return installWithProgress(pick.value, python);
}

async function detectPython(): Promise<string | undefined> {
  for (const cmd of ['python3', 'python']) {
    try {
      const { stdout, stderr } = await execAsync(`${cmd} --version`);
      if ((stdout + stderr).includes('Python 3')) return cmd;
    } catch { /* not found */ }
  }
  return undefined;
}

async function installWithProgress(
  method: 'uv' | 'pip' | 'pipenv',
  python: string | undefined
): Promise<boolean> {
  // uv tool install puts adk on PATH as a global CLI tool (uv pip install does not)
  let cmd: string;
  if (method === 'uv') cmd = 'uv tool install google-adk';
  else if (method === 'pipenv') cmd = 'pipenv install google-adk';
  else cmd = `${python ?? 'pip'} -m pip install google-adk`;

  log(`Installing ADK: ${cmd}`);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Installing google-adk…',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'This may take a minute…' });
      try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 180_000 });
        log(`Install stdout: ${stdout}`);
        if (stderr) log(`Install stderr: ${stderr}`);

        const nowAvailable = await isCommandAvailable('adk --version');
        if (nowAvailable) {
          vscode.window.showInformationMessage('google-adk installed — ready to create your project!');
          return true;
        }

        // Exec succeeded but adk still not on PATH — PATH refresh needed.
        // This is common after pip installs on Mac (~/Library/Python/x.x/bin not in VS Code PATH).
        vscode.window.showInformationMessage(
          'google-adk installed! Open a new terminal, run `adk --version` to confirm, then run "ADK: Create New Agent Project" again.',
          'Try Again'
        ).then((a) => {
          if (a) vscode.commands.executeCommand('adk.createProject');
        });
        return false;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`Install failed: ${msg}`);
        // Exec itself threw — genuine failure, show terminal with error
        const action = await vscode.window.showErrorMessage(
          'Install command failed — opening terminal so you can see the error.',
          'Show Terminal', 'Open Docs'
        );
        if (action === 'Show Terminal') fallbackToTerminal(cmd);
        else if (action === 'Open Docs') {
          vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/installation/'));
        }
        return false;
      }
    }
  );
}

async function installInVenv(python: string): Promise<boolean> {
  const folderUri = await vscode.window.showOpenDialog({
    title: 'Select folder for the new virtual environment',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create .venv here',
  });
  if (!folderUri || folderUri.length === 0) return false;

  const dir = folderUri[0].fsPath;
  const venvPath = path.join(dir, '.venv');
  const pipBin = process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'pip.exe')
    : path.join(venvPath, 'bin', 'pip');
  const adkBin = process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'adk.exe')
    : path.join(venvPath, 'bin', 'adk');

  log(`Creating venv at ${venvPath} and installing google-adk`);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Setting up virtual environment…',
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: `Creating .venv with ${python}` });
        await execAsync(`${python} -m venv "${venvPath}"`, { timeout: 60_000 });

        progress.report({ message: 'Installing google-adk into .venv' });
        await execAsync(`"${pipBin}" install google-adk`, { timeout: 180_000 });

        log(`google-adk installed at ${adkBin}`);
        vscode.window.showInformationMessage(
          `google-adk installed in .venv at ${dir}. ADK Tools will auto-detect it when you open this folder.`,
          'Open Folder'
        ).then((a) => {
          if (a) vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir));
        });

        // adk is now at adkBin — not on global PATH, so return false to
        // let user open the folder; the env detector will pick up .venv/bin/adk
        return false;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`Venv install failed: ${msg}`);
        vscode.window.showErrorMessage(`Could not create environment: ${msg}`);
        return false;
      }
    }
  );
}

function fallbackToTerminal(cmd: string): void {
  const terminal = vscode.window.createTerminal({ name: 'ADK: Install' });
  terminal.show();
  terminal.sendText(cmd);
  vscode.window.showInformationMessage(
    'Running install in terminal. Once complete, run "ADK: Create New Agent Project" again.',
    'OK'
  );
}

// ─── Create Wizard ────────────────────────────────────────────────────────────

async function runCreateWizard(tree: AdkTreeProvider): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: 'New ADK Agent — 1/3: Name',
    prompt: 'Project name (lowercase letters, numbers, underscores)',
    placeHolder: 'my_agent',
    validateInput: (v) => {
      if (!v.trim()) return 'Name is required';
      if (!/^[a-z][a-z0-9_]*$/.test(v.trim())) return 'Use lowercase letters, numbers, underscores (no hyphens)';
      return null;
    },
  });
  if (!name) return;

  const model = await vscode.window.showQuickPick(MODELS, {
    title: 'New ADK Agent — 2/3: Model',
    placeHolder: 'Select Gemini model',
    matchOnDescription: true,
  });
  if (!model) return;

  const folderUri = await vscode.window.showOpenDialog({
    title: 'New ADK Agent — 3/3: Parent Folder',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create project here',
  });
  if (!folderUri || folderUri.length === 0) return;
  const outputDir = folderUri[0].fsPath;

  const cmd = `adk create ${name.trim()} --model ${model.label}`;
  log(`Scaffolding: ${cmd} (in ${outputDir})`);

  const terminal = vscode.window.createTerminal({ name: 'ADK: Create Project', cwd: outputDir });
  terminal.show();
  terminal.sendText(cmd);

  await new Promise((r) => setTimeout(r, 1500));

  const openAction = await vscode.window.showInformationMessage(
    `Creating "${name}" with ${model.label}…`,
    'Open in Current Window', 'Open in New Window'
  );

  if (openAction) {
    const projectPath = path.join(outputDir, name.trim());
    vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(projectPath),
      openAction === 'Open in New Window'
    );
    tree.refresh();
  }
}
