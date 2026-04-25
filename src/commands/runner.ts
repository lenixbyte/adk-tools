import * as vscode from 'vscode';
import * as path from 'path';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { findAllAgents, AgentInfo } from '../utils/agents';
import { log } from '../utils/output';
import { getRunSettings } from '../utils/settings';

let cliTerminal: vscode.Terminal | undefined;

export async function runCli(): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  // Pick agent if multiple exist
  const agent = await pickAgentForCli(project.root);
  if (agent === null) return; // user cancelled

  // Pick run mode
  const settings = getRunSettings();
  const mode = await vscode.window.showQuickPick(
    [
      {
        label: '$(play) New Session',
        description: 'Start a fresh interactive session',
        flags: '',
      },
      {
        label: '$(debug) New Session — Debug Logging',
        description: '--log_level DEBUG',
        flags: ' --log_level DEBUG',
      },
      {
        label: '$(history) Resume Last Session',
        description: '--resume  (continues most recent saved session)',
        flags: ' --resume',
      },
      {
        label: '$(save) New Session + Save',
        description: '--save_session  (persists session to file after exit)',
        flags: ' --save_session',
      },
    ],
    { title: 'ADK CLI — Run Mode', placeHolder: 'How do you want to run the agent?' }
  );
  if (!mode) return;

  const env = detectEnv(project.root);
  const agentArg = agent ? toRelativePath(project.root, agent) : '.';
  const cmd = env.adkCmd(`run${mode.flags} ${agentArg}`);

  log(`CLI run: ${cmd}`);

  if (cliTerminal) {
    // reuse existing terminal
    cliTerminal.show();
    const reuse = await vscode.window.showInformationMessage(
      'ADK CLI terminal is already open. Run new command in it?',
      'Yes', 'Open New Terminal'
    );
    if (reuse === 'Yes') {
      cliTerminal.sendText(cmd);
      return;
    }
    if (!reuse) return;
  }

  cliTerminal = vscode.window.createTerminal({ name: 'ADK CLI', cwd: project.root });
  cliTerminal.show();
  cliTerminal.sendText(cmd);

  vscode.window.onDidCloseTerminal((t) => {
    if (t === cliTerminal) { cliTerminal = undefined; }
  });
}

// Returns selected AgentInfo, or undefined if single/root agent, or null if cancelled
async function pickAgentForCli(root: string): Promise<AgentInfo | undefined | null> {
  const agents = findAllAgents(root);
  if (agents.length === 0) return undefined;
  if (agents.length === 1) return agents[0];

  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: a.name,
      description: a.relDir,
      detail: a.agentFile,
      agent: a,
    })),
    {
      title: 'Select Agent to Run',
      placeHolder: `${agents.length} agents found — pick one for adk run`,
      matchOnDescription: true,
    }
  );
  return pick ? pick.agent : null;
}

function toRelativePath(root: string, agent: AgentInfo): string {
  // adk run accepts either a directory or file path relative to cwd
  return path.relative(root, agent.dir);
}
