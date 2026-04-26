import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as https from 'https';
import { promisify } from 'util';
import { AdkTreeProvider } from '../providers/adkTreeProvider';
import { isCommandAvailable } from '../utils/tools';
import { log, showOutput } from '../utils/output';

const execAsync = promisify(cp.exec);

const MODELS_GOOGLE_AI = [
  { label: 'gemini-2.0-flash',      description: 'Recommended — fast, capable (default)' },
  { label: 'gemini-2.5-pro',        description: 'Most capable, higher latency' },
  { label: 'gemini-2.5-flash',      description: 'Fast + capable, latest generation' },
  { label: 'gemini-2.0-flash-lite', description: 'Fastest, lowest cost' },
  { label: 'gemini-1.5-pro',        description: 'Previous generation Pro' },
  { label: 'gemini-1.5-flash',      description: 'Previous generation Flash' },
];

// Vertex AI — use fully-versioned names; shorthand aliases are not available in all regions
const MODELS_VERTEX_AI = [
  { label: 'gemini-2.0-flash-001',                        description: 'Recommended — available in all supported regions' },
  { label: 'gemini-2.5-pro-preview-05-06',                description: 'Most capable — us-central1 / europe-west4' },
  { label: 'gemini-2.5-flash-preview-04-17',              description: 'Fast + capable — us-central1 / europe-west4' },
  { label: 'gemini-2.5-flash-lite-preview-06-17',         description: 'Fastest — works in asia regions with preview name' },
  { label: 'gemini-2.0-flash-lite-001',                   description: 'Lowest cost — us-central1 recommended' },
  { label: 'gemini-1.5-pro-002',                          description: 'Previous generation Pro' },
  { label: 'gemini-1.5-flash-002',                        description: 'Previous generation Flash' },
];

// ─── Live Model Fetchers ──────────────────────────────────────────────────────

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get(
      { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchGoogleAiModels(apiKey?: string): Promise<vscode.QuickPickItem[]> {
  if (!apiKey) return MODELS_GOOGLE_AI;
  try {
    const raw = await httpsGet(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`
    );
    const json = JSON.parse(raw);
    const items: vscode.QuickPickItem[] = (json.models ?? [])
      .filter((m: any) =>
        m.name?.toLowerCase().includes('gemini') &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m: any) => ({
        label: (m.name as string).replace('models/', ''),
        description: m.displayName ?? '',
      }));
    return items.length > 0 ? items : MODELS_GOOGLE_AI;
  } catch (e) {
    log(`Could not fetch Google AI models: ${e}`);
    return MODELS_GOOGLE_AI;
  }
}

function vertexAiModelsForRegion(region: string): vscode.QuickPickItem[] {
  // asia-south1 (Mumbai) only supports specific preview builds — not the GA shorthand names
  if (region === 'asia-south1') {
    return [
      { label: 'gemini-2.5-flash-lite-preview-09-2025', description: 'Recommended for asia-south1' },
      { label: 'gemini-2.5-flash-preview-04-17',        description: 'Fast + capable' },
      { label: 'gemini-2.5-pro-preview-05-06',          description: 'Most capable' },
      { label: 'gemini-1.5-flash-002',                  description: 'Previous gen — widely available' },
      { label: 'gemini-1.5-pro-002',                    description: 'Previous gen Pro' },
    ];
  }
  // All other supported regions use the standard GA names
  return MODELS_VERTEX_AI;
}

export async function createProject(tree: AdkTreeProvider): Promise<void> {
  const hasAdk = await isCommandAvailable('adk --version');

  if (!hasAdk) {
    const installed = await runInstallWizard();
    if (!installed) return;
  }

  await runCreateWizard(tree);
}

// ─── Install Wizard ───────────────────────────────────────────────────────────

async function runInstallWizard(): Promise<boolean> {
  const python = await detectPython();
  const hasUv = await isCommandAvailable('uv --version');
  const hasPipenv = await isCommandAvailable('pipenv --version');

  type Method = 'uv' | 'pip' | 'venv' | 'pipenv' | 'docs';

  const options: (vscode.QuickPickItem & { value: Method })[] = [];

  if (hasUv) {
    options.push({
      label: '$(package) Install with uv  (recommended)',
      description: 'uv tool install google-adk',
      detail: 'Fast — uv detected in your environment',
      value: 'uv',
    });
  }
  if (python) {
    options.push({
      label: '$(package) Install with pip',
      description: `${python} -m pip install google-adk`,
      detail: 'Installs globally into your system Python',
      value: 'pip',
    });
    options.push({
      label: '$(folder) Create .venv and install  (isolated)',
      description: 'python -m venv .venv && pip install google-adk',
      detail: 'Recommended for keeping projects self-contained',
      value: 'venv',
    });
  }
  if (hasPipenv) {
    options.push({
      label: '$(package) Install with pipenv',
      description: 'pipenv install google-adk',
      detail: 'Adds to current Pipfile',
      value: 'pipenv',
    });
  }
  options.push({
    label: '$(link-external) Open install docs',
    description: 'adk.dev/get-started/installation',
    value: 'docs',
  });

  if (options.length === 1) {
    // Only docs option — Python not found at all
    vscode.window.showErrorMessage(
      'Python 3 not found. Install Python 3.9+ first, then retry.',
      'python.org', 'Install Docs'
    ).then((a) => {
      if (a === 'python.org') vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
      else if (a === 'Install Docs') vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/installation/'));
    });
    return false;
  }

  const pick = await vscode.window.showQuickPick(options, {
    title: 'ADK CLI not found — Install google-adk',
    placeHolder: 'Choose how to install ADK',
    matchOnDetail: true,
  });
  if (!pick) return false;

  if (pick.value === 'docs') {
    vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/installation/'));
    return false;
  }

  if (pick.value === 'venv') {
    return installInVenv(python!);
  }

  return installWithProgress(pick.value, python);
}

async function detectPython(): Promise<string | undefined> {
  for (const cmd of ['python3', 'python']) {
    try {
      const { stdout, stderr } = await execAsync(`${cmd} --version`);
      if ((stdout + stderr).includes('Python 3')) return cmd;
    } catch { /* not found */ }
  }
  return undefined;
}

async function installWithProgress(
  method: 'uv' | 'pip' | 'pipenv',
  python: string | undefined
): Promise<boolean> {
  // uv tool install puts adk on PATH as a global CLI tool (uv pip install does not)
  let cmd: string;
  if (method === 'uv') cmd = 'uv tool install google-adk';
  else if (method === 'pipenv') cmd = 'pipenv install google-adk';
  else cmd = `${python ?? 'pip'} -m pip install google-adk`;

  log(`Installing ADK: ${cmd}`);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Installing google-adk…',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'This may take a minute…' });
      try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 180_000 });
        log(`Install stdout: ${stdout}`);
        if (stderr) log(`Install stderr: ${stderr}`);

        const nowAvailable = await isCommandAvailable('adk --version');
        if (nowAvailable) {
          vscode.window.showInformationMessage('google-adk installed — ready to create your project!');
          return true;
        }

        // Exec succeeded but adk still not on PATH — PATH refresh needed.
        // This is common after pip installs on Mac (~/Library/Python/x.x/bin not in VS Code PATH).
        vscode.window.showInformationMessage(
          'google-adk installed! Open a new terminal, run `adk --version` to confirm, then run "ADK: Create New Agent Project" again.',
          'Try Again'
        ).then((a) => {
          if (a) vscode.commands.executeCommand('adk.createProject');
        });
        return false;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`Install failed: ${msg}`);
        // Exec itself threw — genuine failure, show terminal with error
        const action = await vscode.window.showErrorMessage(
          'Install command failed — opening terminal so you can see the error.',
          'Show Terminal', 'Open Docs'
        );
        if (action === 'Show Terminal') fallbackToTerminal(cmd);
        else if (action === 'Open Docs') {
          vscode.env.openExternal(vscode.Uri.parse('https://adk.dev/get-started/installation/'));
        }
        return false;
      }
    }
  );
}

async function installInVenv(python: string): Promise<boolean> {
  const folderUri = await vscode.window.showOpenDialog({
    title: 'Select folder for the new virtual environment',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create .venv here',
  });
  if (!folderUri || folderUri.length === 0) return false;

  const dir = folderUri[0].fsPath;
  const venvPath = path.join(dir, '.venv');
  const pipBin = process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'pip.exe')
    : path.join(venvPath, 'bin', 'pip');
  const adkBin = process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'adk.exe')
    : path.join(venvPath, 'bin', 'adk');

  log(`Creating venv at ${venvPath} and installing google-adk`);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Setting up virtual environment…',
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: `Creating .venv with ${python}` });
        await execAsync(`${python} -m venv "${venvPath}"`, { timeout: 60_000 });

        progress.report({ message: 'Installing google-adk into .venv' });
        await execAsync(`"${pipBin}" install google-adk`, { timeout: 180_000 });

        log(`google-adk installed at ${adkBin}`);
        vscode.window.showInformationMessage(
          `google-adk installed in .venv at ${dir}. ADK Tools will auto-detect it when you open this folder.`,
          'Open Folder'
        ).then((a) => {
          if (a) vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir));
        });

        // adk is now at adkBin — not on global PATH, so return false to
        // let user open the folder; the env detector will pick up .venv/bin/adk
        return false;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`Venv install failed: ${msg}`);
        vscode.window.showErrorMessage(`Could not create environment: ${msg}`);
        return false;
      }
    }
  );
}

function fallbackToTerminal(cmd: string): void {
  const terminal = vscode.window.createTerminal({ name: 'ADK: Install' });
  terminal.show();
  terminal.sendText(cmd);
  vscode.window.showInformationMessage(
    'Running install in terminal. Once complete, run "ADK: Create New Agent Project" again.',
    'OK'
  );
}

// ─── GCP Project Picker ───────────────────────────────────────────────────────

async function pickGcpProject(): Promise<string | undefined> {
  // Try to load projects from gcloud
  let items: (vscode.QuickPickItem & { projectId: string })[] = [];
  try {
    const { stdout } = await execAsync(
      'gcloud projects list --format="value(projectId,name)" 2>/dev/null',
      { timeout: 15_000 }
    );
    items = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [projectId, ...rest] = line.split('\t');
        return { label: projectId, description: rest.join(' ').trim(), projectId };
      });
  } catch { /* gcloud unavailable — fall through to manual input */ }

  if (items.length > 0) {
    // Detect current active project to pre-select it
    let activeProject = '';
    try {
      const { stdout } = await execAsync('gcloud config get-value project 2>/dev/null');
      activeProject = stdout.trim();
    } catch { /* ignore */ }

    const pick = await vscode.window.showQuickPick(
      items.map((item) => ({
        ...item,
        label: item.projectId,
        description: item.description,
        detail: item.projectId === activeProject ? '$(check) active project' : undefined,
      })),
      {
        title: 'Vertex AI — Select GCP Project',
        placeHolder: 'Search projects…',
        matchOnDescription: true,
      }
    );
    return pick?.projectId;
  }

  // Fallback: manual input (gcloud not available or no projects)
  const manual = await vscode.window.showInputBox({
    title: 'Vertex AI — GCP Project ID',
    prompt: 'Enter your Google Cloud project ID (gcloud not found or no projects listed)',
    placeHolder: 'my-gcp-project',
    validateInput: (v) => v.trim() ? null : 'Project ID is required',
  });
  return manual?.trim() || undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Move the .env generated by `adk create` from the agent subfolder up to the
 * parent (root) directory, merging with any existing .env there.
 * Also ensures .env is listed in the root .gitignore.
 */
function promoteEnvToRoot(agentDir: string, rootDir: string): void {
  const agentEnvPath = path.join(agentDir, '.env');
  const rootEnvPath  = path.join(rootDir, '.env');

  if (!fs.existsSync(agentEnvPath)) return;

  try {
    const agentContent = fs.readFileSync(agentEnvPath, 'utf-8').trim();
    if (!agentContent) { fs.unlinkSync(agentEnvPath); return; }

    // Parse agent .env into a key→value map
    const agentVars: Map<string, string> = new Map();
    for (const line of agentContent.split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      agentVars.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }

    // Update existing root .env: overwrite matching keys, keep everything else
    const existingLines = fs.existsSync(rootEnvPath)
      ? fs.readFileSync(rootEnvPath, 'utf-8').split('\n')
      : [];

    const updatedLines = existingLines.map((line) => {
      const eq = line.indexOf('=');
      if (eq <= 0) return line;
      const key = line.slice(0, eq).trim();
      if (agentVars.has(key)) {
        const newVal = agentVars.get(key)!;
        agentVars.delete(key); // mark as handled
        return `${key}=${newVal}`;
      }
      return line;
    });

    // Append any keys from agent .env that weren't in the root .env yet
    for (const [key, val] of agentVars) {
      updatedLines.push(`${key}=${val}`);
    }

    const merged = updatedLines.filter((l) => l.trim()).join('\n') + '\n';
    fs.writeFileSync(rootEnvPath, merged, 'utf-8');

    // Remove the agent-level .env so there is only one source of truth
    fs.unlinkSync(agentEnvPath);
    log(`.env promoted to ${rootEnvPath}`);

    // Ensure .gitignore covers .env at the root level
    const gitignorePath = path.join(rootDir, '.gitignore');
    try {
      const gi = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, 'utf-8')
        : '';
      if (!gi.split('\n').some((l) => l.trim() === '.env')) {
        fs.appendFileSync(gitignorePath, gi.endsWith('\n') ? '.env\n' : '\n.env\n');
      }
    } catch { /* gitignore update is best-effort */ }
  } catch (e) {
    log(`Could not promote .env: ${e}`);
  }
}

// ─── Agent Templates ──────────────────────────────────────────────────────────

type AgentType = 'single' | 'multi' | 'mcp' | 'a2a';

function buildEnvContent(
  backend: 'google_ai' | 'vertex_ai' | 'skip',
  apiKey?: string,
  gcpProject?: string,
  gcpRegion?: string
): string {
  if (backend === 'google_ai') {
    return `GOOGLE_API_KEY=${apiKey ?? 'YOUR_API_KEY_HERE'}\n`;
  }
  if (backend === 'vertex_ai') {
    return `GOOGLE_GENAI_USE_VERTEXAI=true\nGOOGLE_CLOUD_PROJECT=${gcpProject ?? ''}\nGOOGLE_CLOUD_LOCATION=${gcpRegion ?? 'us-central1'}\n`;
  }
  return `# Configure your auth:\n# GOOGLE_API_KEY=your_key_here\n# or for Vertex AI:\n# GOOGLE_GENAI_USE_VERTEXAI=true\n# GOOGLE_CLOUD_PROJECT=your-project\n# GOOGLE_CLOUD_LOCATION=us-central1\n`;
}

function writeSingleAgent(agentDir: string, name: string, model: string): string {
  const agentPy = `from google.adk.agents import LlmAgent


def sample_tool(query: str) -> str:
    """Answer a user query.

    Args:
        query: The user's question.

    Returns:
        The answer as a string.
    """
    return f"You asked: {query}"


root_agent = LlmAgent(
    name='${name}',
    model='${model}',
    description='A helpful assistant.',
    instruction='You are a helpful assistant. Use the available tools to answer questions.',
    tools=[sample_tool],
)
`;
  fs.writeFileSync(path.join(agentDir, 'agent.py'), agentPy, 'utf-8');
  return path.join(agentDir, 'agent.py');
}

function writeMultiAgent(agentDir: string, name: string, model: string): string {
  const agentPy = `from google.adk.agents import SequentialAgent
from .agents.researcher import researcher_agent
from .agents.responder import responder_agent

root_agent = SequentialAgent(
    name='${name}',
    description='A multi-agent pipeline: researcher gathers information, responder formulates the reply.',
    sub_agents=[researcher_agent, responder_agent],
)
`;
  fs.writeFileSync(path.join(agentDir, 'agent.py'), agentPy, 'utf-8');

  const agentsDir = path.join(agentDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, '__init__.py'), '', 'utf-8');

  const researcherPy = `from google.adk.agents import LlmAgent

researcher_agent = LlmAgent(
    name='researcher',
    model='${model}',
    description='Researches the topic and stores findings in session state.',
    instruction=(
        'Analyze the user request thoroughly. '
        'Store key findings in state["research_results"] for the next agent to use.'
    ),
    output_key='research_results',
)
`;
  fs.writeFileSync(path.join(agentsDir, 'researcher.py'), researcherPy, 'utf-8');

  const responderPy = `from google.adk.agents import LlmAgent

responder_agent = LlmAgent(
    name='responder',
    model='${model}',
    description='Formulates the final response using research findings from state.',
    instruction=(
        'Read state["research_results"] and use those findings to write '
        'a clear, concise response for the user.'
    ),
)
`;
  fs.writeFileSync(path.join(agentsDir, 'responder.py'), responderPy, 'utf-8');

  return path.join(agentDir, 'agent.py');
}

function writeMcpAgent(agentDir: string, name: string, model: string): string {
  const agentPy = `from google.adk.agents import LlmAgent
from google.adk.tools import MCPToolset
from mcp import StdioServerParameters

# Replace the MCPToolset connection_params with your MCP server of choice.
# Example below uses the filesystem MCP server.
# See: https://github.com/modelcontextprotocol/servers
root_agent = LlmAgent(
    name='${name}',
    model='${model}',
    description='An agent with MCP tool integration.',
    instruction='Use the available MCP tools to help the user accomplish tasks.',
    tools=[
        MCPToolset(
            connection_params=StdioServerParameters(
                command='npx',
                args=['-y', '@modelcontextprotocol/server-filesystem', '.'],
            ),
        ),
    ],
)
`;
  fs.writeFileSync(path.join(agentDir, 'agent.py'), agentPy, 'utf-8');
  return path.join(agentDir, 'agent.py');
}

function writeA2aAgent(agentDir: string, name: string, model: string): string {
  const agentPy = `from google.adk.agents import LlmAgent

# This agent is designed to be called by other agents via the A2A protocol.
# Run with: adk api_server --port 8001 .
# Other agents connect using: AgentTool(agent=...) or A2A HTTP client.
#
# Keep the description precise — it is published in the A2A agent card
# and used by orchestrating agents to decide when to call this agent.
root_agent = LlmAgent(
    name='${name}',
    model='${model}',
    description=(
        'Specialist agent for ${name}. '
        'Accepts a plain-text task description and returns a structured result.'
    ),
    instruction=(
        'You are a specialist agent. '
        'Complete the task described by the caller and return a clear, structured result. '
        'Be concise — your output will be consumed by another agent, not a human directly.'
    ),
    tools=[],
)
`;
  fs.writeFileSync(path.join(agentDir, 'agent.py'), agentPy, 'utf-8');
  return path.join(agentDir, 'agent.py');
}

function scaffoldFiles(
  agentType: AgentType,
  outputDir: string,
  name: string,
  model: string,
  backend: 'google_ai' | 'vertex_ai' | 'skip',
  apiKey?: string,
  gcpProject?: string,
  gcpRegion?: string
): string {
  const agentDir = path.join(outputDir, name);
  fs.mkdirSync(agentDir, { recursive: true });

  // Write __init__.py
  fs.writeFileSync(
    path.join(agentDir, '__init__.py'),
    `from .agent import root_agent\n\n__all__ = ['root_agent']\n`,
    'utf-8'
  );

  // Write agent.py based on type
  let agentFile: string;
  if (agentType === 'single') {
    agentFile = writeSingleAgent(agentDir, name, model);
  } else if (agentType === 'multi') {
    agentFile = writeMultiAgent(agentDir, name, model);
  } else if (agentType === 'mcp') {
    agentFile = writeMcpAgent(agentDir, name, model);
  } else {
    agentFile = writeA2aAgent(agentDir, name, model);
  }

  // Write .env in outputDir (not agentDir)
  const envPath = path.join(outputDir, '.env');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, buildEnvContent(backend, apiKey, gcpProject, gcpRegion), 'utf-8');
  }

  // Write .gitignore in outputDir
  const gitignorePath = path.join(outputDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '.env\n__pycache__/\n*.pyc\n.venv/\n', 'utf-8');
  } else {
    const gi = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gi.split('\n').some((l) => l.trim() === '.env')) {
      fs.appendFileSync(gitignorePath, gi.endsWith('\n') ? '.env\n' : '\n.env\n');
    }
  }

  // Create .adk directory marker in outputDir
  const adkDir = path.join(outputDir, '.adk');
  if (!fs.existsSync(adkDir)) {
    fs.mkdirSync(adkDir, { recursive: true });
  }

  return agentFile;
}

// ─── Create Wizard ────────────────────────────────────────────────────────────

const GCP_REGIONS = [
  { label: 'us-central1',     description: 'Iowa — widest model availability' },
  { label: 'us-east4',        description: 'Virginia' },
  { label: 'us-west1',        description: 'Oregon' },
  { label: 'europe-west4',    description: 'Netherlands' },
  { label: 'europe-west1',    description: 'Belgium' },
  { label: 'asia-south1',     description: 'Mumbai' },
  { label: 'asia-northeast1', description: 'Tokyo' },
  { label: 'asia-southeast1', description: 'Singapore' },
  { label: '$(edit) Enter manually…', description: 'Type any GCP region' },
];

async function runCreateWizard(tree: AdkTreeProvider): Promise<void> {
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 0/5 — Agent type
  const agentTypePick = await vscode.window.showQuickPick(
    [
      {
        label: '$(person) Single Agent',
        description: 'one LlmAgent with custom tools',
        detail: 'Best for most use cases — a single agent with function tools',
        value: 'single' as AgentType,
      },
      {
        label: '$(type-hierarchy) Multi-Agent Pipeline',
        description: 'SequentialAgent orchestrating sub-agents',
        detail: 'Researcher + Responder pattern — good for complex workflows',
        value: 'multi' as AgentType,
      },
      {
        label: '$(plug) Agent with MCP Tools',
        description: 'LlmAgent connected to MCP servers',
        detail: 'Integrates any Model Context Protocol server (filesystem, databases, APIs)',
        value: 'mcp' as AgentType,
      },
      {
        label: '$(link) A2A Agent',
        description: 'agent exposed as an A2A service for other agents to call',
        detail: 'Specialist agent callable by orchestrators via the A2A protocol',
        value: 'a2a' as AgentType,
      },
    ],
    {
      title: 'New ADK Agent — 1/5: Agent Type',
      placeHolder: 'What kind of agent are you building?',
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );
  if (!agentTypePick) return;
  const agentType = agentTypePick.value;

  // 1/5 — Name
  const name = await vscode.window.showInputBox({
    title: 'New ADK Agent — 2/5: Name',
    prompt: 'Agent name (lowercase letters, numbers, underscores)',
    placeHolder: 'my_agent',
    validateInput: (v) => {
      if (!v.trim()) return 'Name is required';
      if (!/^[a-z][a-z0-9_]*$/.test(v.trim())) return 'Use lowercase letters, numbers, underscores (no hyphens)';
      return null;
    },
  });
  if (!name) return;

  // 2/5 — Backend / Auth  (before model so we can show the right model list)
  type Backend = 'google_ai' | 'vertex_ai' | 'skip';
  const backendPick = await vscode.window.showQuickPick(
    [
      {
        label: '$(key) Google AI',
        description: 'Gemini API key — free tier available',
        value: 'google_ai' as Backend,
      },
      {
        label: '$(cloud) Vertex AI',
        description: 'GCP project + region required',
        value: 'vertex_ai' as Backend,
      },
      {
        label: '$(circle-slash) Skip — configure later',
        description: 'Add credentials to .env manually',
        value: 'skip' as Backend,
      },
    ],
    { title: 'New ADK Agent — 3/5: Backend', placeHolder: 'How will this agent authenticate?' }
  );
  if (!backendPick) return;

  let apiKey: string | undefined;
  let gcpProject: string | undefined;
  let gcpRegion: string | undefined;

  if (backendPick.value === 'google_ai') {
    const key = await vscode.window.showInputBox({
      title: 'Google AI — API Key',
      prompt: 'Paste your Gemini API key (leave blank to configure later)',
      placeHolder: 'AIza...',
      password: true,
    });
    if (key === undefined) return;
    if (key.trim()) apiKey = key.trim();
  }

  if (backendPick.value === 'vertex_ai') {
    gcpProject = await pickGcpProject();
    if (!gcpProject) return;

    const regionPick = await vscode.window.showQuickPick(GCP_REGIONS, {
      title: 'Vertex AI — Region',
      placeHolder: 'Select region or choose "Enter manually…" for any region',
      matchOnDescription: true,
    });
    if (!regionPick) return;

    if (regionPick.label.includes('Enter manually')) {
      const manual = await vscode.window.showInputBox({
        title: 'Vertex AI — Region',
        prompt: 'Enter any GCP region (e.g. asia-south1, me-central1)',
        placeHolder: 'asia-south1',
        validateInput: (v) => v.trim() ? null : 'Region is required',
      });
      if (!manual) return;
      gcpRegion = manual.trim();
    } else {
      gcpRegion = regionPick.label;
    }
  }

  // 3/4 — Model
  // Vertex AI: use region-aware static list (publisher models API is not publicly listable)
  // Google AI: fetch live from API using the key entered above
  const modelItems: vscode.QuickPickItem[] | Promise<vscode.QuickPickItem[]> =
    backendPick.value === 'vertex_ai'
      ? vertexAiModelsForRegion(gcpRegion!)
      : fetchGoogleAiModels(apiKey);

  const model = await vscode.window.showQuickPick(modelItems, {
    title: 'New ADK Agent — 4/5: Model',
    placeHolder: backendPick.value === 'google_ai' ? 'Loading available models…' : 'Select model',
    matchOnDescription: true,
  });
  if (!model) return;

  // 4/5 — Parent folder (default to workspace root when already in a project)
  const folderUri = await vscode.window.showOpenDialog({
    title: 'New ADK Agent — 5/5: Parent Folder',
    defaultUri: workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined,
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create project here',
  });
  if (!folderUri || folderUri.length === 0) return;
  const outputDir = folderUri[0].fsPath;

  const trimmedName = name.trim();
  log(`Scaffolding ${agentType} agent "${trimmedName}" in ${outputDir}`);

  try {
    const agentFile = scaffoldFiles(
      agentType,
      outputDir,
      trimmedName,
      model.label,
      backendPick.value,
      apiKey,
      gcpProject,
      gcpRegion
    );

    tree.refresh();

    // Open agent.py in the editor
    const doc = await vscode.workspace.openTextDocument(agentFile);
    await vscode.window.showTextDocument(doc);

    const typeLabel: Record<AgentType, string> = {
      single: 'Single Agent',
      multi: 'Multi-Agent Pipeline',
      mcp: 'MCP Agent',
      a2a: 'A2A Agent',
    };

    if (hasWorkspace) {
      vscode.window.showInformationMessage(
        `${typeLabel[agentType]} "${trimmedName}" created — open the ADK panel to run it.`
      );
    } else {
      vscode.window.showInformationMessage(
        `${typeLabel[agentType]} "${trimmedName}" created. Opening folder…`
      );
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(outputDir), false);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Scaffold failed: ${msg}`);
    vscode.window.showErrorMessage(`Failed to create agent: ${msg}`);
  }
}
