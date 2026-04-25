import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { log } from '../utils/output';

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
  const cmd = env.adkCmd(`eval ${relEval}`);

  log(`Running eval: ${cmd}`);
  const terminal = vscode.window.createTerminal({ name: 'ADK Eval', cwd: project.root });
  terminal.show();
  terminal.sendText(cmd);
}

export async function generateEvalCases(): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  const evalSetName = await vscode.window.showInputBox({
    title: 'Generate Eval Cases — Eval Set Name',
    prompt: 'Name for the eval set file (without extension)',
    placeHolder: 'my_agent_eval',
    validateInput: (v) => {
      if (!v.trim()) return 'Name is required';
      if (!/^[a-zA-Z0-9_-]+$/.test(v.trim())) return 'Use letters, numbers, underscores, hyphens only';
      return null;
    },
  });
  if (!evalSetName) return;

  const env = detectEnv(project.root);
  const outFile = `${evalSetName.trim()}.evalset.json`;
  // CLI: adk eval_set generate_eval_cases AGENT_MODULE_FILE_PATH EVAL_SET_ID
  const agentModule = path.relative(project.root, path.dirname(project.agentFile));
  const cmd = env.adkCmd(`eval_set generate_eval_cases ${agentModule} ${outFile}`);

  log(`Generating eval cases: ${cmd}`);
  const terminal = vscode.window.createTerminal({ name: 'ADK: Generate Eval Cases', cwd: project.root });
  terminal.show();
  terminal.sendText(cmd);

  const outPath = path.join(project.root, outFile);
  vscode.window.showInformationMessage(
    `Generating eval cases → ${outFile}`,
    'Open When Done'
  ).then((a) => {
    if (a && fs.existsSync(outPath)) {
      vscode.workspace.openTextDocument(outPath).then((doc) => vscode.window.showTextDocument(doc));
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
