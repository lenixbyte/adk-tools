import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { log } from '../utils/output';
import { detectCurrentModel } from './modelSwitcher';

// ─── Context builders ─────────────────────────────────────────────────────────

function readAgentFileSnippet(agentFile: string): string {
  try {
    const content = fs.readFileSync(agentFile, 'utf-8');
    const lines = content.split('\n').slice(0, 200);
    return lines.join('\n');
  } catch {
    return '(could not read agent file)';
  }
}

function describeAuth(root: string): string {
  const envFile = path.join(root, '.env');
  if (!fs.existsSync(envFile)) return 'unknown (no .env file found)';

  try {
    const content = fs.readFileSync(envFile, 'utf-8');
    if (content.includes('GOOGLE_GENAI_USE_VERTEXAI=true')) {
      const projectMatch = content.match(/GOOGLE_CLOUD_PROJECT\s*=\s*(.+)/);
      const regionMatch = content.match(/GOOGLE_CLOUD_LOCATION\s*=\s*(.+)/);
      return `Vertex AI (project=${projectMatch?.[1]?.trim() ?? 'unknown'}, region=${regionMatch?.[1]?.trim() ?? 'unknown'})`;
    }
    if (content.includes('GOOGLE_API_KEY')) {
      const keyMatch = content.match(/GOOGLE_API_KEY\s*=\s*(.+)/);
      const key = keyMatch?.[1]?.trim() ?? '';
      const masked = key.length > 8
        ? key.slice(0, 4) + '****' + key.slice(-4)
        : '****';
      return `GOOGLE_API_KEY set (${masked})`;
    }
    return 'not configured';
  } catch {
    return 'unknown (could not read .env)';
  }
}

function readEvalHistorySummary(root: string): string {
  const historyFile = path.join(root, '.adk', 'eval_history.json');
  if (!fs.existsSync(historyFile)) return 'No eval history found.';

  try {
    const raw = fs.readFileSync(historyFile, 'utf-8');
    const history = JSON.parse(raw) as Array<{
      timestamp?: string;
      eval_set?: string;
      model?: string;
      pass_rate?: number;
      cases_total?: number;
      cases_passed?: number;
    }>;
    if (!Array.isArray(history) || history.length === 0) return 'No eval history found.';

    // Show last 3 entries
    const recent = history.slice(-3).reverse();
    return recent
      .map((e) => {
        const rate = e.pass_rate != null ? `${Math.round(e.pass_rate * 100)}% pass rate` : 'unknown rate';
        return `- ${e.eval_set ?? 'unknown'} (${e.timestamp?.slice(0, 10) ?? 'unknown date'}): ${rate}, ${e.cases_passed ?? '?'}/${e.cases_total ?? '?'} cases`;
      })
      .join('\n');
  } catch {
    return 'Could not read eval history.';
  }
}

function buildSystemPrompt(
  agentName: string,
  language: string,
  runner: string,
  agentFile: string,
  model: string,
  authDesc: string,
  agentSnippet: string,
  evalHistory: string
): string {
  return `You are an expert on Google Agent Development Kit (ADK). Help the developer with their specific project.

Current project context:
- Agent: ${agentName} (${language}, ${runner})
- Agent file: ${agentFile}
- Model in use: ${model}
- Auth: ${authDesc}

Agent file content (first 200 lines):
\`\`\`python
${agentSnippet}
\`\`\`

Recent eval history:
${evalHistory}

ADK knowledge:
- Agents: LlmAgent, SequentialAgent, ParallelAgent, LoopAgent, BaseAgent
- Tools: function tools (docstring required), AgentTool, MCPToolset, google_search
- Callbacks: before_model_callback, after_model_callback, before_tool_callback, after_tool_callback
- State scopes: session (key), user (user:key), app (app:key)
- Deployment: adk deploy cloud_run / agent_engine / gke
- Eval: adk eval for regression testing agent behavior
- CallbackContext: from google.adk.agents.callback_context import CallbackContext
- ToolContext: from google.adk.tools.tool_context import ToolContext

Answer with specific code examples. When generating agent code, match the model (${model}) and auth method already in use. Keep answers concise and practical.`;
}

// ─── Chat participant handler ─────────────────────────────────────────────────

async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  const project = detectAdkProject();

  if (!project) {
    stream.markdown(
      'No ADK project detected. Open a folder containing an ADK agent, then try again.\n\n' +
      'You can create a new project with the **ADK: Create New Agent Project** command.'
    );
    return {};
  }

  const env = detectEnv(project.root);
  const model = detectCurrentModel(project.agentFile) ?? 'gemini-2.0-flash';
  const authDesc = describeAuth(project.root);
  const agentSnippet = readAgentFileSnippet(project.agentFile);
  const evalHistory = readEvalHistorySummary(project.root);

  const systemPrompt = buildSystemPrompt(
    project.name,
    project.language,
    env.runner,
    project.agentFile,
    model,
    authDesc,
    agentSnippet,
    evalHistory
  );

  // Select the best available language model — try preferred families in order,
  // then fall back to whatever the host editor provides (Copilot, Cursor, etc.)
  let lmModels: readonly vscode.LanguageModelChat[] = [];
  const families = ['claude-sonnet', 'gpt-4o', 'gpt-4', 'claude-haiku'];
  for (const family of families) {
    if (lmModels.length > 0) break;
    try { lmModels = await vscode.lm.selectChatModels({ family }); } catch { /* try next */ }
  }
  if (lmModels.length === 0) {
    try { lmModels = await vscode.lm.selectChatModels({}); } catch { /* no models */ }
  }

  if (lmModels.length === 0) {
    stream.markdown(
      '**No language model available.** Make sure you have GitHub Copilot or another LM provider extension installed and signed in.'
    );
    return {};
  }

  const lm = lmModels[0];
  log(`ADK chat: using model ${lm.name} (${lm.family})`);

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(request.prompt),
  ];

  try {
    const response = await lm.sendRequest(messages, {}, token);
    for await (const chunk of response.text) {
      stream.markdown(chunk);
    }
  } catch (e) {
    if (e instanceof vscode.LanguageModelError) {
      log(`ADK chat LM error: ${e.message} (${e.code})`);
      stream.markdown(`**Language model error:** ${e.message}`);
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      log(`ADK chat error: ${msg}`);
      stream.markdown(`**Error:** ${msg}`);
    }
  }

  return {};
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  let participant: vscode.ChatParticipant;
  try {
    participant = vscode.chat.createChatParticipant('adk', handleChatRequest);
  } catch (e) {
    log(`Could not register chat participant: ${e}`);
    return;
  }

  participant.iconPath = new vscode.ThemeIcon('rocket');

  // Handle follow-up suggestions
  participant.followupProvider = {
    provideFollowups(
      _result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
      return [
        { prompt: 'How do I add a tool to this agent?', label: 'Add a tool' },
        { prompt: 'How do I deploy this agent to Cloud Run?', label: 'Deploy to Cloud Run' },
        { prompt: 'How do I write an eval for this agent?', label: 'Write an eval' },
        { prompt: 'How do I use session state in this agent?', label: 'Use session state' },
      ];
    },
  };

  context.subscriptions.push(participant);
  log('ADK chat participant registered.');
}
