import * as vscode from 'vscode';
import * as path from 'path';
import { AdkTreeProvider } from '../providers/adkTreeProvider';
import { isCommandAvailable } from '../utils/tools';
import { log } from '../utils/output';

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
    const action = await vscode.window.showWarningMessage(
      'adk CLI not found. Install it first to create projects.',
      'Copy Install Command', 'Open Docs'
    );
    if (action === 'Copy Install Command') vscode.env.clipboard.writeText('pip install google-adk');
    else if (action === 'Open Docs') vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/'));
    return;
  }

  // Step 1: Name
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

  // Step 2: Model
  const model = await vscode.window.showQuickPick(MODELS, {
    title: 'New ADK Agent — 2/3: Model',
    placeHolder: 'Select Gemini model',
    matchOnDescription: true,
  });
  if (!model) return;

  // Step 3: Output directory
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
    `Creating "${name}" with ${model.label}...`,
    'Open in Current Window', 'Open in New Window'
  );

  if (openAction) {
    const projectPath = path.join(outputDir, name.trim());
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), openAction === 'Open in New Window');
    tree.refresh();
  }
}
