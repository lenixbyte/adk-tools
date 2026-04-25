import * as vscode from 'vscode';
import * as fs from 'fs';
import { detectAdkProject } from '../utils/detect';
import { log } from '../utils/output';

const MODELS = [
  { label: 'gemini-2.5-pro', description: 'Most capable' },
  { label: 'gemini-2.0-flash', description: 'Fast + capable — recommended default' },
  { label: 'gemini-2.0-flash-lite', description: 'Fastest, lowest cost' },
  { label: 'gemini-1.5-pro', description: 'Previous generation Pro' },
  { label: 'gemini-1.5-flash', description: 'Previous generation Flash' },
  { label: 'claude-3-5-sonnet@20241022', description: 'Anthropic via Vertex AI' },
  { label: 'claude-3-haiku@20240307', description: 'Anthropic via Vertex AI (fast)' },
];

// Patterns that match: model='...', model="...", model = '...', model = "..."
const MODEL_RE = /(\bmodel\s*=\s*)(['"])([^'"]+)(['"])/;

export function detectCurrentModel(agentFile: string): string | undefined {
  try {
    const content = fs.readFileSync(agentFile, 'utf-8');
    const match = content.match(MODEL_RE);
    return match ? match[3] : undefined;
  } catch {
    return undefined;
  }
}

export async function switchModel(): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  const current = detectCurrentModel(project.agentFile);
  const picks = MODELS.map((m) => ({
    ...m,
    picked: m.label === current,
    description: m.label === current ? `${m.description}  ← current` : m.description,
  }));

  const pick = await vscode.window.showQuickPick(picks, {
    title: `Switch Model${current ? ` (current: ${current})` : ''}`,
    placeHolder: 'Select a model',
    matchOnDescription: true,
  });
  if (!pick) return;
  if (pick.label === current) {
    vscode.window.showInformationMessage(`Already using ${current}.`);
    return;
  }

  await applyModelChange(project.agentFile, pick.label);
}

async function applyModelChange(agentFile: string, newModel: string): Promise<void> {
  let content: string;
  try {
    content = fs.readFileSync(agentFile, 'utf-8');
  } catch {
    vscode.window.showErrorMessage(`Could not read ${agentFile}`);
    return;
  }

  if (!MODEL_RE.test(content)) {
    // Model string not found — open the file so user can add it
    const doc = await vscode.workspace.openTextDocument(agentFile);
    await vscode.window.showTextDocument(doc);
    vscode.window.showWarningMessage(
      `Couldn't find a model= string in ${agentFile}. Add it manually: model='${newModel}'`
    );
    return;
  }

  const updated = content.replace(MODEL_RE, `$1$2${newModel}$4`);
  fs.writeFileSync(agentFile, updated, 'utf-8');
  log(`Model changed to ${newModel} in ${agentFile}`);

  vscode.window.showInformationMessage(
    `Model switched to ${newModel}. Restart the server to apply.`,
    'Restart Web UI', 'Restart API Server'
  ).then((a) => {
    if (a === 'Restart Web UI') vscode.commands.executeCommand('adk.runWeb');
    else if (a === 'Restart API Server') vscode.commands.executeCommand('adk.runApiServer');
  });
}
