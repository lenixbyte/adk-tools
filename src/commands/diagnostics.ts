import * as cp from 'child_process';
import * as vscode from 'vscode';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { isCommandAvailable } from '../utils/tools';
import { isPortInUse, lsofPort } from '../utils/port';
import { log, showOutput, getOutput } from '../utils/output';

export async function runDiagnostics(): Promise<void> {
  getOutput().clear();
  showOutput();

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('ADK Tools — Diagnostics');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Project
  const project = detectAdkProject();
  if (project) {
    log(`Project:      ${project.name}`);
    log(`Root:         ${project.root}`);
    log(`Language:     ${project.language}`);
    log(`Agent file:   ${project.agentFile}`);
    const env = detectEnv(project.root);
    log(`Env runner:   ${env.runner}  (command: ${env.adkCmd('<subcmd>')})`);
  } else {
    log('Project:      ✗ not detected in current workspace');
  }

  log('');
  log('── Tools ──────────────────────────────');

  const tools: { name: string; cmd: string }[] = [
    { name: 'adk', cmd: 'adk --version' },
    { name: 'gcloud', cmd: 'gcloud --version' },
    { name: 'pipenv', cmd: 'pipenv --version' },
    { name: 'uv', cmd: 'uv --version' },
    { name: 'agents-cli', cmd: 'agents-cli --version' },
    { name: 'agent-starter-pack', cmd: 'agent-starter-pack --version' },
  ];

  for (const { name, cmd } of tools) {
    const version = await getVersion(cmd);
    log(`${name.padEnd(20)} ${version}`);
  }

  log('');
  log('── Port 8000 ───────────────────────────');

  const busy = await isPortInUse(8000);
  log(`Status: ${busy ? '● IN USE' : '○ available'}`);

  if (busy) {
    const lsof = await lsofPort(8000);
    log('');
    log('lsof -i :8000:');
    lsof.split('\n').forEach((line) => log(`  ${line}`));
    log('');
    log('Run "ADK: Kill Port 8000" or use "Kill & Restart" when starting a server.');
  }

  log('');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('Tip: if adk is not found, make sure your virtual environment is active.');
  if (project) {
    const env = detectEnv(project.root);
    if (env.runner === 'pipenv') {
      log('     Run: pipenv shell  (then reload VS Code window)');
    } else if (env.runner === 'uv') {
      log('     Run: uv sync  then use "uv run adk ..."');
    }
  }
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  vscode.window.showInformationMessage('Diagnostics complete — see Output → ADK Tools', 'Show Output')
    .then((a) => a && showOutput());
}

export async function killPort8000(): Promise<void> {
  const busy = await isPortInUse(8000);
  if (!busy) {
    vscode.window.showInformationMessage('Port 8000 is not in use.');
    return;
  }
  const lsof = await lsofPort(8000);
  showOutput();
  log('');
  log('── Kill Port 8000 ──────────────────────');
  log(lsof);

  const confirm = await vscode.window.showWarningMessage(
    'Kill all processes on port 8000?',
    { modal: true },
    'Kill'
  );
  if (confirm !== 'Kill') return;

  return new Promise((resolve) => {
    cp.exec('lsof -ti:8000 | xargs kill -9', (err) => {
      if (err && err.code !== 1) {
        log(`Error killing port: ${err.message}`);
        vscode.window.showErrorMessage(`Could not kill port 8000: ${err.message}`);
      } else {
        log('Port 8000 freed.');
        vscode.window.showInformationMessage('Port 8000 freed.');
      }
      resolve();
    });
  });
}

function getVersion(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    cp.exec(cmd, { timeout: 4000 }, (err, stdout) => {
      if (err) { resolve('✗ not found'); return; }
      const first = stdout.trim().split('\n')[0];
      resolve(`✓  ${first}`);
    });
  });
}
