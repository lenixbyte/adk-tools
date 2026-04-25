import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as https from 'https';
import { promisify } from 'util';
import { AdkTreeProvider } from '../providers/adkTreeProvider';
import { isCommandAvailable } from '../utils/tools';
import { log, showOutput } from '../utils/output';

const execAsync = promisify(cp.exec);

const MODELS_GOOGLE_AI = [
  { label: 'gemini-2.0-flash',      description: 'Recommended — fast, capable (default)' },
  { label: 'gemini-2.5-pro',        description: 'Most capable, higher latency' },
  { label: 'gemini-2.5-flash',      description: 'Fast + capable, latest generation' },
  { label: 'gemini-2.0-flash-lite', description: 'Fastest, lowest cost' },
  { label: 'gemini-1.5-pro',        description: 'Previous generation Pro' },
  { label: 'gemini-1.5-flash',      description: 'Previous generation Flash' },
];

// Vertex AI — use fully-versioned names; shorthand aliases are not available in all regions
const MODELS_VERTEX_AI = [
  { label: 'gemini-2.0-flash-001',                        description: 'Recommended — available in all supported regions' },
  { label: 'gemini-2.5-pro-preview-05-06',                description: 'Most capable — us-central1 / europe-west4' },
  { label: 'gemini-2.5-flash-preview-04-17',              description: 'Fast + capable — us-central1 / europe-west4' },
  { label: 'gemini-2.5-flash-lite-preview-06-17',         description: 'Fastest — works in asia regions with preview name' },
  { label: 'gemini-2.0-flash-lite-001',                   description: 'Lowest cost — us-central1 recommended' },
  { label: 'gemini-1.5-pro-002',                          description: 'Previous generation Pro' },
  { label: 'gemini-1.5-flash-002',                        description: 'Previous generation Flash' },
];

// ─── Live Model Fetchers ──────────────────────────────────────────────────────

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get(
      { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchGoogleAiModels(apiKey?: string): Promise<vscode.QuickPickItem[]> {
  if (!apiKey) return MODELS_GOOGLE_AI;
  try {
    const raw = await httpsGet(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`
    );
    const json = JSON.parse(raw);
    const items: vscode.QuickPickItem[] = (json.models ?? [])
      .filter((m: any) =>
        m.name?.toLowerCase().includes('gemini') &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m: any) => ({
        label: (m.name as string).replace('models/', ''),
        description: m.displayName ?? '',
      }));
    return items.length > 0 ? items : MODELS_GOOGLE_AI;
  } catch (e) {
    log(`Could not fetch Google AI models: ${e}`);
    return MODELS_GOOGLE_AI;
  }
}

function vertexAiModelsForRegion(region: string): vscode.QuickPickItem[] {
  // asia-south1 (Mumbai) only supports specific preview builds — not the GA shorthand names
  if (region === 'asia-south1') {
    return [
      { label: 'gemini-2.5-flash-lite-preview-09-2025', description: 'Recommended for asia-south1' },
      { label: 'gemini-2.5-flash-preview-04-17',        description: 'Fast + capable' },
      { label: 'gemini-2.5-pro-preview-05-06',          description: 'Most capable' },
      { label: 'gemini-1.5-flash-002',                  description: 'Previous gen — widely available' },
      { label: 'gemini-1.5-pro-002',                    description: 'Previous gen Pro' },
    ];
  }
  // All other supported regions use the standard GA names
  return MODELS_VERTEX_AI;
}

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

// ─── GCP Project Picker ───────────────────────────────────────────────────────

async function pickGcpProject(): Promise<string | undefined> {
  // Try to load projects from gcloud
  let items: (vscode.QuickPickItem & { projectId: string })[] = [];
  try {
    const { stdout } = await execAsync(
      'gcloud projects list --format="value(projectId,name)" 2>/dev/null',
      { timeout: 15_000 }
    );
    items = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [projectId, ...rest] = line.split('\t');
        return { label: projectId, description: rest.join(' ').trim(), projectId };
      });
  } catch { /* gcloud unavailable — fall through to manual input */ }

  if (items.length > 0) {
    // Detect current active project to pre-select it
    let activeProject = '';
    try {
      const { stdout } = await execAsync('gcloud config get-value project 2>/dev/null');
      activeProject = stdout.trim();
    } catch { /* ignore */ }

    const pick = await vscode.window.showQuickPick(
      items.map((item) => ({
        ...item,
        label: item.projectId,
        description: item.description,
        detail: item.projectId === activeProject ? '$(check) active project' : undefined,
      })),
      {
        title: 'Vertex AI — Select GCP Project',
        placeHolder: 'Search projects…',
        matchOnDescription: true,
      }
    );
    return pick?.projectId;
  }

  // Fallback: manual input (gcloud not available or no projects)
  const manual = await vscode.window.showInputBox({
    title: 'Vertex AI — GCP Project ID',
    prompt: 'Enter your Google Cloud project ID (gcloud not found or no projects listed)',
    placeHolder: 'my-gcp-project',
    validateInput: (v) => v.trim() ? null : 'Project ID is required',
  });
  return manual?.trim() || undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Move the .env generated by `adk create` from the agent subfolder up to the
 * parent (root) directory, merging with any existing .env there.
 * Also ensures .env is listed in the root .gitignore.
 */
function promoteEnvToRoot(agentDir: string, rootDir: string): void {
  const agentEnvPath = path.join(agentDir, '.env');
  const rootEnvPath  = path.join(rootDir, '.env');

  if (!fs.existsSync(agentEnvPath)) return;

  try {
    const agentContent = fs.readFileSync(agentEnvPath, 'utf-8').trim();
    if (!agentContent) { fs.unlinkSync(agentEnvPath); return; }

    // Parse agent .env into a key→value map
    const agentVars: Map<string, string> = new Map();
    for (const line of agentContent.split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      agentVars.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }

    // Update existing root .env: overwrite matching keys, keep everything else
    const existingLines = fs.existsSync(rootEnvPath)
      ? fs.readFileSync(rootEnvPath, 'utf-8').split('\n')
      : [];

    const updatedLines = existingLines.map((line) => {
      const eq = line.indexOf('=');
      if (eq <= 0) return line;
      const key = line.slice(0, eq).trim();
      if (agentVars.has(key)) {
        const newVal = agentVars.get(key)!;
        agentVars.delete(key); // mark as handled
        return `${key}=${newVal}`;
      }
      return line;
    });

    // Append any keys from agent .env that weren't in the root .env yet
    for (const [key, val] of agentVars) {
      updatedLines.push(`${key}=${val}`);
    }

    const merged = updatedLines.filter((l) => l.trim()).join('\n') + '\n';
    fs.writeFileSync(rootEnvPath, merged, 'utf-8');

    // Remove the agent-level .env so there is only one source of truth
    fs.unlinkSync(agentEnvPath);
    log(`.env promoted to ${rootEnvPath}`);

    // Ensure .gitignore covers .env at the root level
    const gitignorePath = path.join(rootDir, '.gitignore');
    try {
      const gi = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, 'utf-8')
        : '';
      if (!gi.split('\n').some((l) => l.trim() === '.env')) {
        fs.appendFileSync(gitignorePath, gi.endsWith('\n') ? '.env\n' : '\n.env\n');
      }
    } catch { /* gitignore update is best-effort */ }
  } catch (e) {
    log(`Could not promote .env: ${e}`);
  }
}

// ─── Create Wizard ────────────────────────────────────────────────────────────

const GCP_REGIONS = [
  { label: 'us-central1',     description: 'Iowa — widest model availability' },
  { label: 'us-east4',        description: 'Virginia' },
  { label: 'us-west1',        description: 'Oregon' },
  { label: 'europe-west4',    description: 'Netherlands' },
  { label: 'europe-west1',    description: 'Belgium' },
  { label: 'asia-south1',     description: 'Mumbai' },
  { label: 'asia-northeast1', description: 'Tokyo' },
  { label: 'asia-southeast1', description: 'Singapore' },
  { label: '$(edit) Enter manually…', description: 'Type any GCP region' },
];

async function runCreateWizard(tree: AdkTreeProvider): Promise<void> {
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 1/4 — Name
  const name = await vscode.window.showInputBox({
    title: 'New ADK Agent — 1/4: Name',
    prompt: 'Agent name (lowercase letters, numbers, underscores)',
    placeHolder: 'my_agent',
    validateInput: (v) => {
      if (!v.trim()) return 'Name is required';
      if (!/^[a-z][a-z0-9_]*$/.test(v.trim())) return 'Use lowercase letters, numbers, underscores (no hyphens)';
      return null;
    },
  });
  if (!name) return;

  // 2/4 — Backend / Auth  (before model so we can show the right model list)
  type Backend = 'google_ai' | 'vertex_ai' | 'skip';
  const backendPick = await vscode.window.showQuickPick(
    [
      {
        label: '$(key) Google AI',
        description: 'Gemini API key — free tier available',
        value: 'google_ai' as Backend,
      },
      {
        label: '$(cloud) Vertex AI',
        description: 'GCP project + region required',
        value: 'vertex_ai' as Backend,
      },
      {
        label: '$(circle-slash) Skip — configure later',
        description: 'Add credentials to .env manually',
        value: 'skip' as Backend,
      },
    ],
    { title: 'New ADK Agent — 2/4: Backend', placeHolder: 'How will this agent authenticate?' }
  );
  if (!backendPick) return;

  let apiKey: string | undefined;
  let gcpProject: string | undefined;
  let gcpRegion: string | undefined;

  if (backendPick.value === 'google_ai') {
    const key = await vscode.window.showInputBox({
      title: 'Google AI — API Key',
      prompt: 'Paste your Gemini API key (leave blank to configure later)',
      placeHolder: 'AIza...',
      password: true,
    });
    if (key === undefined) return;
    if (key.trim()) apiKey = key.trim();
  }

  if (backendPick.value === 'vertex_ai') {
    gcpProject = await pickGcpProject();
    if (!gcpProject) return;

    const regionPick = await vscode.window.showQuickPick(GCP_REGIONS, {
      title: 'Vertex AI — Region',
      placeHolder: 'Select region or choose "Enter manually…" for any region',
      matchOnDescription: true,
    });
    if (!regionPick) return;

    if (regionPick.label.includes('Enter manually')) {
      const manual = await vscode.window.showInputBox({
        title: 'Vertex AI — Region',
        prompt: 'Enter any GCP region (e.g. asia-south1, me-central1)',
        placeHolder: 'asia-south1',
        validateInput: (v) => v.trim() ? null : 'Region is required',
      });
      if (!manual) return;
      gcpRegion = manual.trim();
    } else {
      gcpRegion = regionPick.label;
    }
  }

  // 3/4 — Model
  // Vertex AI: use region-aware static list (publisher models API is not publicly listable)
  // Google AI: fetch live from API using the key entered above
  const modelItems: vscode.QuickPickItem[] | Promise<vscode.QuickPickItem[]> =
    backendPick.value === 'vertex_ai'
      ? vertexAiModelsForRegion(gcpRegion!)
      : fetchGoogleAiModels(apiKey);

  const model = await vscode.window.showQuickPick(modelItems, {
    title: 'New ADK Agent — 3/4: Model',
    placeHolder: backendPick.value === 'google_ai' ? 'Loading available models…' : 'Select model',
    matchOnDescription: true,
  });
  if (!model) return;

  // 4/4 — Parent folder (default to workspace root when already in a project)
  const folderUri = await vscode.window.showOpenDialog({
    title: 'New ADK Agent — 4/4: Parent Folder',
    defaultUri: workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined,
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create project here',
  });
  if (!folderUri || folderUri.length === 0) return;
  const outputDir = folderUri[0].fsPath;

  // Build fully non-interactive command
  const args: string[] = [`create`, name.trim(), `--model`, model.label];
  if (apiKey)     { args.push('--api_key', apiKey); }
  if (gcpProject) { args.push('--project', gcpProject); }
  if (gcpRegion)  { args.push('--region', gcpRegion); }
  const cmd = `adk ${args.join(' ')}`;
  const projectPath = path.join(outputDir, name.trim());

  log(`Scaffolding: ${cmd} (in ${outputDir})`);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating agent "${name.trim()}"…`, cancellable: false },
    async () => {
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd: outputDir, timeout: 60_000 });
        if (stdout) log(stdout);
        if (stderr) log(stderr);

        // Promote .env from agent subfolder → parent (root) folder so that
        // `adk web` running from the parent picks it up naturally.
        promoteEnvToRoot(projectPath, outputDir);

        tree.refresh();

        if (hasWorkspace) {
          // Already in a project — agent folder is now visible in explorer
          vscode.window.showInformationMessage(`Agent "${name.trim()}" created.`);
        } else {
          // No workspace open — open the selected parent folder (contains the new agent)
          vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(outputDir), false);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`adk create failed: ${msg}`);
        const action = await vscode.window.showErrorMessage(
          `adk create failed. Check the output log for details.`,
          'Show Output', 'Open Docs'
        );
        if (action === 'Show Output') showOutput();
        else if (action === 'Open Docs') {
          vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/installation/'));
        }
      }
    }
  );
}
