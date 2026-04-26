import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { detectAdkProject } from '../utils/detect';
import { log } from '../utils/output';

function stripJsonComments(json: string): string {
  return json
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

interface LaunchConfiguration {
  name: string;
  type: string;
  request: string;
  program?: string;
  args?: string[];
  cwd?: string;
  envFile?: string;
  justMyCode?: boolean;
  console?: string;
  [key: string]: unknown;
}

interface LaunchJson {
  version: string;
  configurations: LaunchConfiguration[];
}

function resolveAdkBinary(projectRoot: string): string {
  // Check project-local venvs first
  const candidates = [
    path.join(projectRoot, '.venv', 'bin', 'adk'),
    path.join(projectRoot, 'venv', 'bin', 'adk'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to PATH
  try {
    const result = cp.execSync('which adk', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (result) return result;
  } catch {
    // which failed — return plain "adk" and let debugpy find it
  }

  return 'adk';
}

function buildAdkConfig(adkPath: string): LaunchConfiguration {
  return {
    name: 'ADK: Debug Agent',
    type: 'debugpy',
    request: 'launch',
    program: adkPath,
    args: ['api_server', '--no-reload', '--port', '8000', '.'],
    cwd: '${workspaceFolder}',
    envFile: '${workspaceFolder}/.env',
    justMyCode: false,
    console: 'integratedTerminal',
  };
}

export async function debugAgent(): Promise<void> {
  const project = detectAdkProject();
  if (!project) {
    vscode.window.showWarningMessage('No ADK project detected. Open a folder containing an ADK agent.');
    return;
  }

  const projectRoot = project.root;
  const adkPath = resolveAdkBinary(projectRoot);
  log(`Resolved ADK binary for debug: ${adkPath}`);

  const vscodeDirPath = path.join(projectRoot, '.vscode');
  const launchJsonPath = path.join(vscodeDirPath, 'launch.json');

  // Ensure .vscode directory exists
  if (!fs.existsSync(vscodeDirPath)) {
    fs.mkdirSync(vscodeDirPath, { recursive: true });
  }

  const adkConfig = buildAdkConfig(adkPath);

  let launchJson: LaunchJson;

  if (fs.existsSync(launchJsonPath)) {
    // Read and parse existing launch.json (may have comments)
    const raw = fs.readFileSync(launchJsonPath, 'utf-8');
    try {
      const stripped = stripJsonComments(raw);
      launchJson = JSON.parse(stripped) as LaunchJson;
    } catch {
      // If parsing fails, start fresh but warn
      log('Could not parse existing launch.json — creating new one.');
      launchJson = { version: '0.2.0', configurations: [] };
    }

    if (!Array.isArray(launchJson.configurations)) {
      launchJson.configurations = [];
    }

    // Replace existing "ADK: Debug Agent" config or append
    const existingIdx = launchJson.configurations.findIndex(
      (c) => c.name === 'ADK: Debug Agent'
    );
    if (existingIdx >= 0) {
      launchJson.configurations[existingIdx] = adkConfig;
    } else {
      launchJson.configurations.push(adkConfig);
    }
  } else {
    // Create fresh launch.json
    launchJson = {
      version: '0.2.0',
      configurations: [adkConfig],
    };
  }

  fs.writeFileSync(launchJsonPath, JSON.stringify(launchJson, null, 2) + '\n', 'utf-8');
  log(`Written launch.json at ${launchJsonPath}`);

  // Open the file in the editor
  const doc = await vscode.workspace.openTextDocument(launchJsonPath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(
    "launch.json ready — open the Run & Debug panel (Ctrl+Shift+D) and select 'ADK: Debug Agent'. Breakpoints in your agent files will now work."
  );
}
