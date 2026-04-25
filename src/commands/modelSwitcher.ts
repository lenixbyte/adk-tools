import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as cp from 'child_process';
import { promisify } from 'util';
import { detectAdkProject } from '../utils/detect';
import { log } from '../utils/output';

const execAsync = promisify(cp.exec);

// Fallback lists used when live fetch fails
const FALLBACK_GOOGLE_AI = [
  { label: 'gemini-2.0-flash',      description: 'Fast + capable — recommended default' },
  { label: 'gemini-2.5-pro',        description: 'Most capable' },
  { label: 'gemini-2.5-flash',      description: 'Fast + capable, latest generation' },
  { label: 'gemini-2.0-flash-lite', description: 'Fastest, lowest cost' },
  { label: 'gemini-1.5-pro',        description: 'Previous generation Pro' },
  { label: 'gemini-1.5-flash',      description: 'Previous generation Flash' },
  { label: 'claude-3-5-sonnet@20241022', description: 'Anthropic via Vertex AI' },
  { label: 'claude-3-haiku@20240307',    description: 'Anthropic via Vertex AI (fast)' },
];

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      { hostname: u.hostname, path: u.pathname + u.search, headers },
      (res) => { let d = ''; res.on('data', (c: string) => (d += c)); res.on('end', () => resolve(d)); }
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Vertex AI publisher models API is not publicly listable — region-specific static lists
const VERTEX_AI_MODELS_ASIA_SOUTH1: vscode.QuickPickItem[] = [
  { label: 'gemini-2.5-flash-lite-preview-09-2025', description: 'Recommended for asia-south1' },
  { label: 'gemini-2.5-flash-preview-04-17',        description: 'Fast + capable' },
  { label: 'gemini-2.5-pro-preview-05-06',          description: 'Most capable' },
  { label: 'gemini-1.5-flash-002',                  description: 'Previous gen — widely available' },
  { label: 'gemini-1.5-pro-002',                    description: 'Previous gen Pro' },
  { label: 'claude-3-5-sonnet@20241022',             description: 'Anthropic via Vertex AI' },
];

async function fetchLiveModels(
  useVertexAi: boolean,
  apiKey?: string,
  _project?: string,
  region?: string
): Promise<vscode.QuickPickItem[]> {
  if (useVertexAi) {
    if (region === 'asia-south1') return VERTEX_AI_MODELS_ASIA_SOUTH1;
    return FALLBACK_GOOGLE_AI; // standard GA names work in all other supported regions
  }

  if (apiKey) {
    try {
      const raw = await httpsGet(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`
      );
      const json = JSON.parse(raw);
      const items: vscode.QuickPickItem[] = (json.models ?? [])
        .filter((m: any) =>
          m.name?.toLowerCase().includes('gemini') &&
          (m.supportedGenerationMethods as string[] ?? []).includes('generateContent')
        )
        .map((m: any) => ({
          label: (m.name as string).replace('models/', ''),
          description: m.displayName ?? '',
        }));
      return items.length > 0 ? items : FALLBACK_GOOGLE_AI;
    } catch (e) {
      log(`Model fetch failed: ${e}`);
    }
  }
  return FALLBACK_GOOGLE_AI;
}

function readEnvVar(envFile: string, key: string): string | undefined {
  try {
    const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
  return undefined;
}

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

  // Read .env to determine auth context for live model fetching
  const envFile = path.join(project.root, '.env');
  const useVertexAi = ['1', 'true', 'yes'].includes(
    (readEnvVar(envFile, 'GOOGLE_GENAI_USE_VERTEXAI') ?? '').toLowerCase()
  );
  const apiKey   = readEnvVar(envFile, 'GOOGLE_API_KEY');
  const gcpRegion = readEnvVar(envFile, 'GOOGLE_CLOUD_LOCATION');

  const current = detectCurrentModel(project.agentFile);

  const liveItems = fetchLiveModels(useVertexAi, apiKey, undefined, gcpRegion).then((items) =>
    items.map((m) => ({
      ...m,
      picked: m.label === current,
      description: m.label === current ? `${m.description}  ← current` : m.description,
    }))
  );

  const pick = await vscode.window.showQuickPick(liveItems, {
    title: `Switch Model${current ? ` (current: ${current})` : ''}`,
    placeHolder: 'Loading available models…',
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
