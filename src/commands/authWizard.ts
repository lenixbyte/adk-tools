import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectAdkProject } from '../utils/detect';
import { log } from '../utils/output';

export async function showAuthWizard(): Promise<void> {
  const project = detectAdkProject();
  if (!project) {
    vscode.window.showWarningMessage('No ADK project found. Open a project folder first.');
    return;
  }

  type MethodValue = 'gemini_api_key' | 'vertex_ai' | 'explain';
  const method = await vscode.window.showQuickPick(
    [
      {
        label: '$(key) Gemini API Key',
        description: 'Google AI Studio — free tier available',
        detail: 'Uses GOOGLE_API_KEY. Easiest to get started.',
        value: 'gemini_api_key' as MethodValue,
      },
      {
        label: '$(azure) Vertex AI',
        description: 'Google Cloud — enterprise scale',
        detail: 'Uses GOOGLE_CLOUD_PROJECT + Application Default Credentials.',
        value: 'vertex_ai' as MethodValue,
      },
      {
        label: "$(info) What's the difference?",
        description: 'Show guidance',
        value: 'explain' as MethodValue,
      },
    ],
    {
      title: 'ADK Auth Setup — Choose Authentication Method',
      placeHolder: 'How will your agent authenticate with Google AI?',
    }
  );

  if (!method) return;

  if (method.value === 'explain') { await showAuthExplainer(); return; }
  if (method.value === 'gemini_api_key') { await setupGeminiApiKey(project.root); return; }
  if (method.value === 'vertex_ai') { await setupVertexAI(project.root); }
}

async function setupGeminiApiKey(root: string): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(edit) Enter API Key Now', description: 'Paste key into .env', value: 'enter' },
      { label: '$(link-external) Get API Key from Google AI Studio', description: 'Opens aistudio.google.com', value: 'open' },
      { label: '$(checklist) Check Current .env', description: 'Verify GOOGLE_API_KEY is set', value: 'check' },
    ],
    { title: 'Gemini API Key Setup', placeHolder: 'Select action' }
  );
  if (!action) return;

  if (action.value === 'open') {
    vscode.env.openExternal(vscode.Uri.parse('https://aistudio.google.com/apikey'));
    vscode.window.showInformationMessage(
      'Opening Google AI Studio. After creating your key, run Auth Setup again.',
      'Run Again'
    ).then((a) => { if (a) vscode.commands.executeCommand('adk.authWizard'); });
    return;
  }

  if (action.value === 'check') {
    const envPath = path.join(root, '.env');
    if (!fs.existsSync(envPath)) {
      vscode.window.showWarningMessage('.env not found. Enter your key to create it.', 'Enter Key').then((a) => {
        if (a) vscode.commands.executeCommand('adk.authWizard');
      });
      return;
    }
    const content = fs.readFileSync(envPath, 'utf-8');
    const match = content.match(/^GOOGLE_API_KEY\s*=\s*(.+)$/m);
    if (match) {
      const val = match[1].trim();
      const masked = val.length > 8 ? '*'.repeat(val.length - 4) + val.slice(-4) : '****';
      vscode.window.showInformationMessage(`GOOGLE_API_KEY is set (${masked})`);
    } else {
      vscode.window.showWarningMessage('GOOGLE_API_KEY not found in .env.', 'Enter Key').then((a) => {
        if (a) vscode.commands.executeCommand('adk.authWizard');
      });
    }
    return;
  }

  const key = await vscode.window.showInputBox({
    title: 'Enter Gemini API Key',
    prompt: 'Paste your GOOGLE_API_KEY — will be saved to .env',
    placeHolder: 'AIza...',
    password: true,
    validateInput: (v) => {
      if (!v.trim()) return 'API key is required';
      if (v.trim().length < 20) return 'Key looks too short — check it';
      return null;
    },
  });
  if (!key) return;

  await writeEnvVar(root, 'GOOGLE_API_KEY', key.trim());
  log('GOOGLE_API_KEY written to .env');
  vscode.window.showInformationMessage(
    'GOOGLE_API_KEY saved to .env. Make sure .env is in .gitignore!',
    'Open .env', 'Check .gitignore'
  ).then((a) => {
    if (a === 'Open .env') vscode.commands.executeCommand('adk.openEnv');
    else if (a === 'Check .gitignore') checkGitignore(root);
  });
}

async function setupVertexAI(root: string): Promise<void> {
  const step = await vscode.window.showQuickPick(
    [
      {
        label: '$(terminal) Run gcloud auth login',
        description: 'Step 1 — Application Default Credentials',
        detail: 'Runs: gcloud auth application-default login',
        value: 'gcloud_auth',
      },
      {
        label: '$(edit) Set GOOGLE_CLOUD_PROJECT',
        description: 'Step 2 — GCP Project ID',
        detail: 'Saves GOOGLE_CLOUD_PROJECT to .env',
        value: 'set_project',
      },
      {
        label: '$(edit) Set GOOGLE_CLOUD_LOCATION',
        description: 'Step 3 — Region (default: us-central1)',
        detail: 'Saves GOOGLE_CLOUD_LOCATION to .env',
        value: 'set_region',
      },
      {
        label: '$(link-external) Vertex AI Quickstart Docs',
        description: 'Full setup guide at adk.dev',
        value: 'docs',
      },
    ],
    { title: 'Vertex AI Auth Setup', placeHolder: 'Follow steps in order' }
  );
  if (!step) return;

  if (step.value === 'docs') {
    vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/quickstart/#vertex-ai'));
    return;
  }

  if (step.value === 'gcloud_auth') {
    const terminal = vscode.window.createTerminal({ name: 'ADK: gcloud auth', cwd: root });
    terminal.show();
    terminal.sendText('gcloud auth application-default login');
    vscode.window.showInformationMessage(
      'Follow the browser prompts, then set GOOGLE_CLOUD_PROJECT.',
      'Set Project ID'
    ).then((a) => { if (a) vscode.commands.executeCommand('adk.authWizard'); });
    return;
  }

  if (step.value === 'set_project') {
    const projectId = await vscode.window.showInputBox({
      title: 'GCP Project ID',
      prompt: 'Your Google Cloud project ID',
      placeHolder: 'my-project-123456',
      validateInput: (v) => v.trim() ? null : 'Project ID is required',
    });
    if (!projectId) return;
    await writeEnvVar(root, 'GOOGLE_CLOUD_PROJECT', projectId.trim());
    log(`GOOGLE_CLOUD_PROJECT set to ${projectId.trim()}`);
    vscode.window.showInformationMessage(`GOOGLE_CLOUD_PROJECT=${projectId.trim()} saved to .env.`);
    return;
  }

  if (step.value === 'set_region') {
    const region = await vscode.window.showQuickPick(
      [
        { label: 'us-central1', description: 'Default' },
        { label: 'us-east1' },
        { label: 'europe-west1' },
        { label: 'asia-northeast1' },
        { label: 'Other...' },
      ],
      { title: 'Select Region' }
    );
    if (!region) return;
    let loc = region.label;
    if (loc === 'Other...') {
      const custom = await vscode.window.showInputBox({ prompt: 'Enter region (e.g. us-east4)' });
      if (!custom) return;
      loc = custom;
    }
    await writeEnvVar(root, 'GOOGLE_CLOUD_LOCATION', loc);
    log(`GOOGLE_CLOUD_LOCATION set to ${loc}`);
    vscode.window.showInformationMessage(`GOOGLE_CLOUD_LOCATION=${loc} saved to .env.`);
  }
}

async function showAuthExplainer(): Promise<void> {
  const pick = await vscode.window.showInformationMessage(
    'Gemini API Key: Free tier, great for development. Get from aistudio.google.com.\n\n' +
    'Vertex AI: Enterprise-grade on GCP. Required for Agent Engine deployment. ' +
    'Needs gcloud CLI + a billing-enabled project.',
    { modal: true },
    'Set Up API Key', 'Set Up Vertex AI'
  );
  if (pick === 'Set Up API Key' || pick === 'Set Up Vertex AI') {
    vscode.commands.executeCommand('adk.authWizard');
  }
}

async function writeEnvVar(root: string, key: string, value: string): Promise<void> {
  const envPath = path.join(root, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const re = new RegExp(`^${key}\\s*=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content = content.trimEnd() + (content ? '\n' : '') + `${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf-8');
}

function checkGitignore(root: string): void {
  const gitignorePath = path.join(root, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    vscode.window.showWarningMessage('.gitignore not found. Create one and add .env to it!');
    return;
  }
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (content.includes('.env')) {
    vscode.window.showInformationMessage('.env is already in .gitignore.');
  } else {
    vscode.window.showWarningMessage(
      '.env is NOT in .gitignore — your API key could be committed!',
      'Add .env to .gitignore'
    ).then((a) => {
      if (a) {
        fs.appendFileSync(gitignorePath, '\n.env\n', 'utf-8');
        vscode.window.showInformationMessage('.env added to .gitignore.');
      }
    });
  }
}
