import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { log, getOutput } from '../utils/output';

// ─── Eval History ─────────────────────────────────────────────────────────────

interface EvalHistoryEntry {
  timestamp: string;
  eval_set: string;
  model: string | null;
  pass_rate: number | null;
  cases_total: number | null;
  cases_passed: number | null;
}

function getNewestJsonFile(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? path.join(dir, files[0].name) : null;
  } catch {
    return null;
  }
}

interface EvalResultMetrics {
  pass_rate?: number | null;
  cases_total?: number | null;
  cases_passed?: number | null;
  total?: number | null;
  passed?: number | null;
  score?: number;
  [key: string]: unknown;
}

function parseEvalResultFile(filePath: string): EvalResultMetrics | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw) as EvalResultMetrics | EvalResultMetrics[];

    // Handle array of results
    if (Array.isArray(json)) {
      const total = json.length;
      const passed = json.filter((item) => {
        const score = (item as EvalResultMetrics).score;
        return typeof score === 'number' ? score >= 0.5 : false;
      }).length;
      return {
        cases_total: total,
        cases_passed: passed,
        pass_rate: total > 0 ? passed / total : null,
      };
    }

    // Handle object with summary fields
    const obj = json as EvalResultMetrics;
    const total = (obj.cases_total ?? obj.total) as number | undefined;
    const passed = (obj.cases_passed ?? obj.passed) as number | undefined;
    const rate = obj.pass_rate as number | undefined;

    return {
      cases_total: total ?? null,
      cases_passed: passed ?? null,
      pass_rate: rate ?? (total && passed ? passed / total : null),
    };
  } catch {
    return null;
  }
}

function appendEvalHistory(
  root: string,
  evalSetName: string,
  model: string | null,
  metrics: EvalResultMetrics | null
): void {
  const adkDir = path.join(root, '.adk');
  if (!fs.existsSync(adkDir)) {
    fs.mkdirSync(adkDir, { recursive: true });
  }

  const historyFile = path.join(adkDir, 'eval_history.json');
  let history: EvalHistoryEntry[] = [];

  if (fs.existsSync(historyFile)) {
    try {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf-8')) as EvalHistoryEntry[];
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }

  const entry: EvalHistoryEntry = {
    timestamp: new Date().toISOString(),
    eval_set: evalSetName,
    model,
    pass_rate: metrics?.pass_rate ?? null,
    cases_total: metrics?.cases_total ?? null,
    cases_passed: metrics?.cases_passed ?? null,
  };

  history.push(entry);

  try {
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2) + '\n', 'utf-8');
    log(`Eval history updated: ${historyFile}`);
  } catch (e) {
    log(`Could not write eval history: ${e}`);
  }
}

interface EvalFile {
  label: string;
  filePath: string;
  relPath: string;
}

export async function runEval(): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  const evalFiles = findEvalFiles(project.root);

  let evalPath: string;
  if (evalFiles.length === 0) {
    const action = await vscode.window.showWarningMessage(
      'No eval files found (*.test.json or *.evalset.json). Create one?',
      'Generate Eval Cases', 'Specify Path'
    );
    if (action === 'Generate Eval Cases') {
      vscode.commands.executeCommand('adk.createEvalFile');
      return;
    }
    if (action === 'Specify Path') {
      evalPath = project.root;
    } else {
      return;
    }
  } else if (evalFiles.length === 1) {
    evalPath = evalFiles[0].filePath;
  } else {
    const pick = await vscode.window.showQuickPick(
      evalFiles.map((f) => ({ label: f.label, description: f.relPath, evalFile: f })),
      {
        title: 'Run Eval — Select Eval File',
        placeHolder: `${evalFiles.length} eval files found`,
        matchOnDescription: true,
      }
    );
    if (!pick) return;
    evalPath = pick.evalFile.filePath;
  }

  const env = detectEnv(project.root);
  const relEval = path.relative(project.root, evalPath);
  const evalSetName = path.basename(evalPath, path.extname(evalPath))
    .replace('.test', '')
    .replace('.evalset', '')
    .replace('_test', '');
  const cmd = env.adkCmd(`eval ${relEval}`);

  log(`Running eval: ${cmd}`);

  // Load .env variables for the child process
  const dotenvFile = path.join(project.root, '.env');
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (fs.existsSync(dotenvFile)) {
    try {
      for (const line of fs.readFileSync(dotenvFile, 'utf-8').split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (m) childEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch { /* ignore */ }
  }

  // Detect model
  const { detectCurrentModel } = await import('./modelSwitcher');
  const model = detectCurrentModel(project.agentFile) ?? null;

  const out = getOutput();
  out.show(true);
  out.appendLine(`\n[ADK] Running eval: ${relEval}`);

  const proc = cp.spawn('bash', ['-c', cmd], { cwd: project.root, env: childEnv });
  proc.stdout.on('data', (d: Buffer) => out.append(d.toString()));
  proc.stderr.on('data', (d: Buffer) => out.append(d.toString()));
  proc.on('close', (code) => {
    if (code === 0) {
      out.appendLine(`\n[ADK] ✅ Eval completed.`);

      // Read newest result file and record history
      const resultsDir = path.join(project.root, '.adk', 'eval_results');
      const newestFile = getNewestJsonFile(resultsDir);
      const metrics = newestFile ? parseEvalResultFile(newestFile) : null;
      appendEvalHistory(project.root, evalSetName, model, metrics);

      const passRate = metrics?.pass_rate;
      const summary = passRate != null
        ? ` (${Math.round(passRate * 100)}% pass rate)`
        : '';
      vscode.window.showInformationMessage(`Eval "${evalSetName}" completed${summary}. History saved.`);
    } else {
      out.appendLine(`\n[ADK] ❌ Eval failed (exit ${code}).`);
      vscode.window.showErrorMessage(`Eval failed (exit ${code}). See ADK Tools output for details.`);
    }
  });
}

async function ensureEvalDeps(): Promise<boolean> {
  const ok = await new Promise<boolean>((resolve) => {
    cp.exec(
      'python -c "from google.cloud.aiplatform import evals"',
      { env: process.env },
      (err) => resolve(!err)
    );
  });
  if (ok) return true;

  const action = await vscode.window.showWarningMessage(
    'Eval case generation requires google-cloud-aiplatform[evaluation]. Install it now?',
    'Install', 'Cancel'
  );
  if (action !== 'Install') return false;

  return new Promise((resolve) => {
    const out = getOutput();
    out.show(true);
    out.appendLine('\n[ADK] Installing google-cloud-aiplatform[evaluation]…');
    const proc = cp.spawn(
      'bash', ['-c', 'uv tool install google-adk --with "google-cloud-aiplatform[evaluation]"'],
      { env: process.env }
    );
    proc.stdout.on('data', (d: Buffer) => out.append(d.toString()));
    proc.stderr.on('data', (d: Buffer) => out.append(d.toString()));
    proc.on('close', (code) => {
      if (code === 0) {
        out.appendLine('[ADK] ✅ Eval dependencies installed.');
        resolve(true);
      } else {
        out.appendLine('[ADK] ❌ Installation failed. Run manually: uv tool install google-adk --with "google-cloud-aiplatform[evaluation]"');
        resolve(false);
      }
    });
  });
}

export async function generateEvalCases(): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  if (!await ensureEvalDeps()) return;

  // Step 1 — eval set name
  const evalSetName = await vscode.window.showInputBox({
    title: 'Generate Eval Cases (1/4) — Eval Set Name',
    prompt: 'Name for the eval set (letters, numbers, underscores only)',
    placeHolder: 'my_agent_eval',
    validateInput: (v) => {
      if (!v.trim()) return 'Name is required';
      if (!/^[a-zA-Z0-9_]+$/.test(v.trim())) return 'Only letters, numbers, and underscores allowed (no hyphens or dots)';
      return null;
    },
  });
  if (!evalSetName) return;

  // Step 2 — number of eval cases to generate
  const countStr = await vscode.window.showInputBox({
    title: 'Generate Eval Cases (2/4) — Number of Cases',
    prompt: 'How many synthetic eval cases should Gemini generate?',
    value: '5',
    validateInput: (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 50) return 'Enter a number between 1 and 50';
      return null;
    },
  });
  if (!countStr) return;

  // Step 3 — generation instruction (what kind of conversations to create)
  const genInstruction = await vscode.window.showInputBox({
    title: 'Generate Eval Cases (3/4) — Generation Instruction (optional)',
    prompt: 'Guide what types of user conversations to generate (leave blank for default)',
    placeHolder: 'e.g. Generate diverse questions about product features and pricing',
  });
  if (genInstruction === undefined) return;

  // Step 4 — environment context (ground truth about agent's data/tools)
  const envContext = await vscode.window.showInputBox({
    title: 'Generate Eval Cases (4/4) — Environment Context (optional)',
    prompt: 'Describe the data or tools the agent has access to, so Gemini generates realistic queries',
    placeHolder: 'e.g. The agent has access to a product catalog with 50 items across 5 categories',
  });
  if (envContext === undefined) return;

  // Read the model from the agent file to reuse it for generation
  const { detectCurrentModel } = await import('./modelSwitcher');
  const agentModel = detectCurrentModel(project.agentFile) ?? 'gemini-2.5-flash';

  // Write the user simulation config file
  const simConfig: Record<string, unknown> = {
    count: parseInt(countStr, 10),
    model_name: agentModel,
  };
  if (genInstruction.trim()) simConfig.generation_instruction = genInstruction.trim();
  if (envContext.trim())     simConfig.environment_context    = envContext.trim();

  const simConfigFile = path.join(project.root, '.adk_sim_config.json');
  fs.writeFileSync(simConfigFile, JSON.stringify(simConfig, null, 2), 'utf-8');
  log(`Wrote sim config: ${simConfigFile}`);

  const env = detectEnv(project.root);
  const evalSetId = evalSetName.trim();
  const agentModule = path.relative(project.root, path.dirname(project.agentFile));
  const adkCmd = env.adkCmd(
    `eval_set generate_eval_cases ${agentModule} ${evalSetId} --user_simulation_config_file .adk_sim_config.json`
  );

  // Load .env into the child process environment so credentials are available
  const dotenvFile = path.join(project.root, '.env');
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (fs.existsSync(dotenvFile)) {
    for (const line of fs.readFileSync(dotenvFile, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m) childEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }

  const out = getOutput();
  out.show(true);
  out.appendLine(`\n[ADK] Generating ${countStr} eval cases for "${evalSetId}"…`);
  log(`Spawning: ${adkCmd}`);

  const outPath = path.join(project.root, `${evalSetId}.evalset.json`);

  let outputBuffer = '';
  const proc = cp.spawn('bash', ['-c', adkCmd], { cwd: project.root, env: childEnv });
  proc.stdout.on('data', (d: Buffer) => { const s = d.toString(); out.append(s); outputBuffer += s; });
  proc.stderr.on('data', (d: Buffer) => { const s = d.toString(); out.append(s); outputBuffer += s; });
  proc.on('close', (code) => {
    if (code === 0) {
      out.appendLine(`\n[ADK] ✅ Done — ${evalSetId}.evalset.json`);
      vscode.window.showInformationMessage(
        `Eval cases generated → ${evalSetId}.evalset.json`,
        'Open File'
      ).then((a) => {
        if (a && fs.existsSync(outPath)) {
          vscode.workspace.openTextDocument(outPath).then((doc) => vscode.window.showTextDocument(doc));
        }
      });
    } else {
      out.appendLine(`\n[ADK] ❌ Failed (exit ${code})`);
      vscode.window.showErrorMessage(`Eval case generation failed (exit ${code}). See ADK Tools output for details.`);
    }
  });
}

function findEvalFiles(root: string): EvalFile[] {
  const results: EvalFile[] = [];
  scanDir(root, root, results, 0);
  return results;
}

function scanDir(dir: string, root: string, out: EvalFile[], depth: number): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, root, out, depth + 1);
    } else if (entry.isFile() && isEvalFile(entry.name)) {
      out.push({ label: entry.name, filePath: fullPath, relPath: path.relative(root, fullPath) });
    }
  }
}

function isEvalFile(name: string): boolean {
  return name.endsWith('.test.json') || name.endsWith('.evalset.json') || name.endsWith('_test.json');
}

// ─── Eval History Webview ─────────────────────────────────────────────────────

function getPassRateBadge(rate: number | null): string {
  if (rate === null) return '<span class="badge badge-gray">N/A</span>';
  const pct = Math.round(rate * 100);
  const cls = pct >= 80 ? 'badge-green' : pct >= 60 ? 'badge-yellow' : 'badge-red';
  return `<span class="badge ${cls}">${pct}%</span>`;
}

function buildEvalHistoryHtml(history: EvalHistoryEntry[]): string {
  const rows = history.length === 0
    ? '<tr><td colspan="5" class="empty">No eval history yet. Run <strong>ADK: Run Eval</strong> to start recording.</td></tr>'
    : [...history].reverse().map((e) => `
      <tr>
        <td>${new Date(e.timestamp).toLocaleString()}</td>
        <td class="mono">${escapeHtml(e.eval_set)}</td>
        <td class="mono">${e.model ? escapeHtml(e.model) : '<span class="muted">—</span>'}</td>
        <td class="center">${getPassRateBadge(e.pass_rate)}</td>
        <td class="center">${e.cases_passed ?? '—'} / ${e.cases_total ?? '—'}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eval History</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      padding: 24px;
    }
    h1 {
      font-size: 16px;
      font-weight: 600;
      color: #cccccc;
      margin-bottom: 20px;
    }
    .summary {
      font-size: 12px;
      color: #888;
      margin-bottom: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead th {
      text-align: left;
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #888;
      background: #252526;
      border-bottom: 1px solid #3c3c3c;
    }
    thead th.center { text-align: center; }
    tbody tr {
      border-bottom: 1px solid #2d2d2d;
      transition: background 0.1s;
    }
    tbody tr:hover { background: #2a2d2e; }
    td {
      padding: 9px 12px;
      vertical-align: middle;
      color: #d4d4d4;
    }
    td.center { text-align: center; }
    td.mono { font-family: 'SF Mono', 'Consolas', monospace; font-size: 12px; }
    td.empty { text-align: center; padding: 32px; color: #666; }
    td.muted { color: #666; }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      min-width: 42px;
      text-align: center;
    }
    .badge-green  { background: #166534; color: #86efac; }
    .badge-yellow { background: #854d0e; color: #fde68a; }
    .badge-red    { background: #7f1d1d; color: #fca5a5; }
    .badge-gray   { background: #3c3c3c; color: #888; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>Eval History</h1>
  <p class="summary">${history.length} run${history.length !== 1 ? 's' : ''} recorded — most recent first</p>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Eval Set</th>
        <th>Model</th>
        <th class="center">Pass Rate</th>
        <th class="center">Total Cases</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let historyPanel: vscode.WebviewPanel | undefined;

export function showEvalHistory(context: vscode.ExtensionContext): void {
  if (historyPanel) {
    historyPanel.reveal();
    refreshHistoryPanel(historyPanel);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'adkEvalHistory',
    'Eval History',
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    }
  );
  historyPanel = panel;

  panel.onDidDispose(() => {
    historyPanel = undefined;
  }, null, context.subscriptions);

  refreshHistoryPanel(panel);
}

function refreshHistoryPanel(panel: vscode.WebviewPanel): void {
  const project = detectAdkProject();
  let history: EvalHistoryEntry[] = [];

  if (project) {
    const historyFile = path.join(project.root, '.adk', 'eval_history.json');
    if (fs.existsSync(historyFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf-8')) as EvalHistoryEntry[];
        if (Array.isArray(parsed)) history = parsed;
      } catch { /* use empty */ }
    }
  }

  panel.webview.html = buildEvalHistoryHtml(history);
}
