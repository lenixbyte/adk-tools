import * as fs from 'fs';
import * as path from 'path';

export interface AgentInfo {
  name: string;
  dir: string;       // absolute path to directory containing agent.py
  relDir: string;    // relative to project root, e.g. "agentsv2/marketing_agent"
  agentFile: string; // absolute path to agent.py
}

export function findAllAgents(root: string): AgentInfo[] {
  const agents: AgentInfo[] = [];
  scan(root, root, agents, 0);
  return agents;
}

function scan(root: string, dir: string, out: AgentInfo[], depth: number): void {
  if (depth > 4) return;

  const agentPy = path.join(dir, 'agent.py');
  if (fs.existsSync(agentPy) && looksLikeAdk(agentPy)) {
    const relDir = path.relative(root, dir) || '.';
    out.push({
      name: path.basename(dir) === path.basename(root) ? path.basename(root) : path.basename(dir),
      dir,
      relDir,
      agentFile: agentPy,
    });
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (
        e.isDirectory() &&
        !e.name.startsWith('.') &&
        !['node_modules', '__pycache__', 'venv', '.venv', 'dist', 'out', 'build'].includes(e.name)
      ) {
        scan(root, path.join(dir, e.name), out, depth + 1);
      }
    }
  } catch { /* unreadable dir */ }
}

function looksLikeAdk(file: string): boolean {
  try {
    const c = fs.readFileSync(file, 'utf-8');
    return (
      c.includes('google.adk') ||
      c.includes('from google.adk') ||
      c.includes('LlmAgent') ||
      c.includes('google.adk.agents')
    );
  } catch {
    return false;
  }
}
