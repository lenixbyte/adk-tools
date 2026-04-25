import * as vscode from 'vscode';
import * as cp from 'child_process';

interface Tool {
  name: string;
  versionCmd: string;
  installUrl: string;
  required: boolean;
}

const TOOLS: Tool[] = [
  {
    name: 'adk',
    versionCmd: 'adk --version',
    installUrl: 'https://adk.dev/',
    required: true,
  },
  {
    name: 'gcloud',
    versionCmd: 'gcloud --version',
    installUrl: 'https://cloud.google.com/sdk/docs/install',
    required: false,
  },
  {
    name: 'agent-starter-pack',
    versionCmd: 'agent-starter-pack --version',
    installUrl: 'https://github.com/GoogleCloudPlatform/agent-starter-pack',
    required: false,
  },
];

export async function checkToolsInstalled(): Promise<void> {
  const results = await Promise.all(
    TOOLS.map(async (tool) => ({
      tool,
      installed: await isCommandAvailable(tool.versionCmd),
    }))
  );

  const missing = results.filter((r) => !r.installed);
  const missingRequired = missing.filter((r) => r.tool.required);
  const missingOptional = missing.filter((r) => !r.tool.required);

  const installed = results.filter((r) => r.installed).map((r) => `✓ ${r.tool.name}`);
  const missingLabels = missing.map((r) =>
    r.tool.required ? `✗ ${r.tool.name} (required)` : `○ ${r.tool.name} (optional)`
  );

  const lines = [...installed, ...missingLabels].join('\n');

  if (missingRequired.length > 0) {
    const action = await vscode.window.showWarningMessage(
      `ADK Tools: ${missingRequired.map((r) => r.tool.name).join(', ')} not found. Install to use ADK Tools.`,
      'Install adk',
      'Show Status'
    );
    if (action === 'Install adk') {
      vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/'));
    } else if (action === 'Show Status') {
      vscode.window.showInformationMessage(`Tool Status:\n${lines}`);
    }
  } else if (missingOptional.length > 0) {
    vscode.window.showInformationMessage(
      `ADK Tools ready. Optional tools not found: ${missingOptional.map((r) => r.tool.name).join(', ')}`,
      'Show Status'
    ).then((action) => {
      if (action === 'Show Status') {
        vscode.window.showInformationMessage(`Tool Status:\n${lines}`);
      }
    });
  } else {
    vscode.window.showInformationMessage(`ADK Tools: all tools found.\n${lines}`);
  }
}

export function isCommandAvailable(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    cp.exec(cmd, { timeout: 5000 }, (err) => resolve(!err));
  });
}
