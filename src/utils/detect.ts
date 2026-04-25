import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface AdkProject {
  name: string;
  root: string;
  agentFile: string;
  language: string;
}

export function detectAdkProject(): AdkProject | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;

  for (const folder of folders) {
    const result = tryDetect(folder.uri.fsPath);
    if (result) return result;
  }
  return null;
}

function tryDetect(root: string): AdkProject | null {
  // Most reliable: .adk directory exists at root
  if (fs.existsSync(path.join(root, '.adk'))) {
    const agentFile = findAgentFile(root) ?? path.join(root, '.adk');
    return {
      name: path.basename(root),
      root,
      agentFile,
      language: agentFile.endsWith('.ts') ? 'TypeScript' : agentFile.endsWith('.go') ? 'Go' : 'Python',
    };
  }

  // Check pyproject.toml or requirements.txt at any depth (up to 2 levels)
  const depFiles = [
    path.join(root, 'requirements.txt'),
    path.join(root, 'pyproject.toml'),
    ...subdirs(root).map((d) => path.join(root, d, 'requirements.txt')),
  ];

  for (const depFile of depFiles) {
    if (fs.existsSync(depFile)) {
      try {
        const content = fs.readFileSync(depFile, 'utf-8');
        if (content.includes('google-adk')) {
          const agentFile = findAgentFile(root) ?? depFile;
          return {
            name: path.basename(root),
            root,
            agentFile,
            language: 'Python',
          };
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  // Search for agent.py / agent.ts / agent.go up to 3 levels deep
  const agentFile = findAgentFile(root);
  if (agentFile) {
    const language = agentFile.endsWith('.ts') ? 'TypeScript' : agentFile.endsWith('.go') ? 'Go' : 'Python';
    return { name: path.basename(root), root, agentFile, language };
  }

  return null;
}

function findAgentFile(root: string, depth = 0): string | null {
  if (depth > 3) return null;

  const names = ['agent.py', 'agent.ts', 'agent.go', 'Agent.java'];

  for (const name of names) {
    const fullPath = path.join(root, name);
    if (fs.existsSync(fullPath) && looksLikeAdk(fullPath)) {
      return fullPath;
    }
  }

  // Recurse into subdirectories (skip hidden dirs and node_modules)
  for (const sub of subdirs(root)) {
    const found = findAgentFile(path.join(root, sub), depth + 1);
    if (found) return found;
  }

  return null;
}

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          e.name !== 'node_modules' &&
          e.name !== '__pycache__' &&
          e.name !== 'venv' &&
          e.name !== '.venv' &&
          e.name !== 'out' &&
          e.name !== 'dist'
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function looksLikeAdk(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return (
      content.includes('google.adk') ||
      content.includes('from google.adk') ||
      content.includes('@google/adk') ||
      content.includes('google-adk') ||
      content.includes('LlmAgent') ||
      content.includes('google.adk.agents') ||
      content.includes('google/adk-go')
    );
  } catch {
    return false;
  }
}
