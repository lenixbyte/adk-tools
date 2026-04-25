import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectAdkProject } from '../utils/detect';
import { log } from '../utils/output';

export async function openEnvFile(): Promise<void> {
  const project = detectAdkProject();
  if (!project) {
    vscode.window.showWarningMessage('No ADK project detected.');
    return;
  }

  const envPath = path.join(project.root, '.env');
  const examplePath = path.join(project.root, '.env.example');

  if (!fs.existsSync(envPath)) {
    const action = await vscode.window.showInformationMessage(
      '.env file not found.',
      fs.existsSync(examplePath) ? 'Create from .env.example' : 'Create Empty .env'
    );
    if (!action) return;

    const content = fs.existsSync(examplePath)
      ? fs.readFileSync(examplePath, 'utf-8')
      : '# ADK environment variables\nGOOGLE_CLOUD_PROJECT=\nGOOGLE_CLOUD_LOCATION=us-central1\n';

    fs.writeFileSync(envPath, content, 'utf-8');
    log(`Created .env at ${envPath}`);
  }

  const doc = await vscode.workspace.openTextDocument(envPath);
  vscode.window.showTextDocument(doc);
}

export async function showEnvSummary(): Promise<void> {
  const project = detectAdkProject();
  if (!project) return;

  const envPath = path.join(project.root, '.env');
  if (!fs.existsSync(envPath)) {
    vscode.window.showInformationMessage('No .env file found.', 'Create .env').then((a) => {
      if (a) openEnvFile();
    });
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  const vars = lines
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [key, ...rest] = l.split('=');
      const val = rest.join('=').trim();
      // Mask secrets
      const masked = isSensitive(key)
        ? val.slice(0, 4) + '****'
        : val || '(empty)';
      return `${key.trim()}: ${masked}`;
    });

  const summary = vars.length > 0 ? vars.join('\n') : '(no variables set)';
  vscode.window.showInformationMessage(
    `.env (${vars.length} vars):\n${summary}`,
    'Edit .env'
  ).then((a) => a && openEnvFile());
}

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('key') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('password') ||
    lower.includes('credential')
  );
}
