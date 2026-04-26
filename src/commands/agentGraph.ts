import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { detectAdkProject } from '../utils/detect';
import { getRunSettings } from '../utils/settings';
import { log } from '../utils/output';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentInfo {
  name: string;
  model?: string;
  tools: string[];
  subAgents: AgentInfo[];
  agentFile?: string;
  depth: number;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Parse agent hierarchy from app-info JSON ─────────────────────────────────

interface AppInfoAgent {
  name?: string;
  model?: string;
  tools?: Array<{ name?: string } | string>;
  sub_agents?: AppInfoAgent[];
}

interface AppInfo {
  agents?: AppInfoAgent[];
}

function parseAgentFromAppInfo(raw: AppInfoAgent, depth: number): AgentInfo {
  const tools: string[] = (raw.tools ?? []).map((t) => {
    if (typeof t === 'string') return t;
    return (t as { name?: string }).name ?? 'tool';
  });

  const subAgents: AgentInfo[] = (raw.sub_agents ?? []).map((s) =>
    parseAgentFromAppInfo(s, depth + 1)
  );

  return {
    name: raw.name ?? 'agent',
    model: raw.model,
    tools,
    subAgents,
    depth,
  };
}

// ─── Parse agent hierarchy from disk (fallback) ───────────────────────────────

function parseAgentFromDisk(agentFile: string, depth: number): AgentInfo {
  let content = '';
  try {
    content = fs.readFileSync(agentFile, 'utf-8');
  } catch {
    return { name: path.basename(path.dirname(agentFile)), tools: [], subAgents: [], depth };
  }

  const nameMatch = content.match(/name\s*=\s*['"]([^'"]+)['"]/);
  const modelMatch = content.match(/model\s*=\s*['"]([^'"]+)['"]/);

  const tools: string[] = [];
  const toolsMatch = content.match(/tools\s*=\s*\[([^\]]*)\]/s);
  if (toolsMatch) {
    const raw = toolsMatch[1];

    // AgentTool(agent=X) → extract X as the wrapped agent name
    for (const m of raw.matchAll(/AgentTool\s*\(\s*agent\s*=\s*(\w+)/g)) {
      if (!tools.includes(m[1])) tools.push(m[1]);
    }
    // FunctionTool(func=X) → extract X
    for (const m of raw.matchAll(/FunctionTool\s*\(\s*func\s*=\s*(\w+)/g)) {
      if (!tools.includes(m[1])) tools.push(m[1]);
    }

    // Bare identifiers (plain function tools) — skip ADK class names
    const skipIds = new Set([
      'None', 'True', 'False',
      'AgentTool', 'FunctionTool', 'MCPToolset', 'BaseTool',
      'LlmAgent', 'SequentialAgent', 'ParallelAgent', 'LoopAgent',
      'agent', 'func', 'connection_params', 'StdioServerParameters',
      'command', 'args', 'google_search',
    ]);
    const bareIds = raw.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g) ?? [];
    for (const id of bareIds) {
      if (!skipIds.has(id) && !tools.includes(id)) {
        tools.push(id);
      }
    }
  }

  const subAgents: AgentInfo[] = [];
  const subAgentsMatch = content.match(/sub_agents\s*=\s*\[([^\]]*)\]/s);
  if (subAgentsMatch) {
    const skipWords = new Set([
      'None', 'True', 'False', 'AgentTool', 'LlmAgent', 'SequentialAgent',
      'ParallelAgent', 'LoopAgent', 'BaseAgent', 'agent',
    ]);
    const refs = subAgentsMatch[1].match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g) ?? [];
    for (const ref of refs) {
      if (!skipWords.has(ref) && !subAgents.some((a) => a.name === ref)) {
        subAgents.push({ name: ref, tools: [], subAgents: [], depth: depth + 1 });
      }
    }
  }

  return {
    name: nameMatch?.[1] ?? path.basename(path.dirname(agentFile)),
    model: modelMatch?.[1],
    tools,
    subAgents,
    agentFile,
    depth,
  };
}

// ─── Parse DOT graph format ───────────────────────────────────────────────────

function parseDotGraph(dot: string): AgentInfo[] {
  // Extract edges: source -> target (with optional quoted names)
  const edgeRegex = /"?(\w+)"?\s*->\s*"?(\w+)"?/g;
  const edges: Array<{ from: string; to: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = edgeRegex.exec(dot)) !== null) {
    edges.push({ from: m[1], to: m[2] });
  }

  // Extract node labels (name -> display label)
  const labelMap = new Map<string, string>();
  const labelRegex = /"?(\w+)"?\s*\[([^\]]*)\]/g;
  while ((m = labelRegex.exec(dot)) !== null) {
    const attrs = m[2];
    const labelMatch = attrs.match(/label\s*=\s*"([^"]+)"/);
    if (labelMatch) {
      // label may be "name\nAgentType" — take first line
      labelMap.set(m[1], labelMatch[1].split('\\n')[0].trim());
    }
  }

  // Build adjacency + collect all node IDs
  const children = new Map<string, string[]>();
  const allNodes = new Set<string>();
  const targetNodes = new Set<string>();

  for (const edge of edges) {
    allNodes.add(edge.from);
    allNodes.add(edge.to);
    targetNodes.add(edge.to);
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from)!.push(edge.to);
  }

  // Single-node graph (no edges) — root_agent with no sub-agents
  if (edges.length === 0) {
    const skipIds = new Set(['node', 'edge', 'graph', 'digraph']);
    const singles: AgentInfo[] = [];
    for (const [id, label] of labelMap) {
      if (!skipIds.has(id)) {
        singles.push({ name: cleanLabel(label), tools: [], subAgents: [], depth: 0 });
      }
    }
    return singles.length > 0 ? singles : [];
  }

  // Root nodes = nodes that are never a target
  const roots = [...allNodes].filter((n) => !targetNodes.has(n));

  // Tool nodes have a wrench/tool emoji in their label, or no outgoing edges
  function isTool(id: string): boolean {
    const label = labelMap.get(id) ?? id;
    return label.startsWith('🔧') || // 🔧
           label.startsWith('⚙') ||        // ⚙
           label.startsWith('[tool]') ||
           label.toLowerCase().includes('tool:');
  }

  function buildNode(id: string, depth: number, visited = new Set<string>()): AgentInfo {
    if (visited.has(id)) return { name: cleanLabel(labelMap.get(id) ?? id), tools: [], subAgents: [], depth };
    visited.add(id);

    const childIds = children.get(id) ?? [];
    const toolNames: string[] = [];
    const subAgentInfos: AgentInfo[] = [];

    for (const childId of childIds) {
      if (isTool(childId)) {
        toolNames.push(cleanLabel(labelMap.get(childId) ?? childId));
      } else {
        subAgentInfos.push(buildNode(childId, depth + 1, new Set(visited)));
      }
    }

    return {
      name: cleanLabel(labelMap.get(id) ?? id),
      tools: toolNames,
      subAgents: subAgentInfos,
      depth,
    };
  }

  return roots.map((r) => buildNode(r, 0));
}

function cleanLabel(label: string): string {
  // Strip leading emoji characters and whitespace
  return label.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+/u, '').trim();
}

// ─── Fetch live agent info ─────────────────────────────────────────────────────

async function fetchAgentInfo(
  appName: string, port: number
): Promise<{ agents: AgentInfo[]; serverRunning: boolean }> {
  // Try /dev/{app_name}/graph — returns DOT source
  try {
    const raw = await httpGet(`http://localhost:${port}/dev/${appName}/graph`);
    const json = JSON.parse(raw) as { dotSrc?: string };
    // Server responded — it is definitely running
    if (json.dotSrc) {
      const agents = parseDotGraph(json.dotSrc);
      log(`Agent Graph: DOT parsed ${agents.length} root(s) for ${appName}`);
      if (agents.length > 0) return { agents, serverRunning: true };
    }
    // Server responded but DOT was empty; try app-info before giving up
    try {
      const raw2 = await httpGet(`http://localhost:${port}/apps/${appName}/app-info`);
      const json2 = JSON.parse(raw2) as AppInfo;
      const agents = (json2.agents ?? []).map((a) => parseAgentFromAppInfo(a, 0));
      return { agents, serverRunning: true };
    } catch {
      return { agents: [], serverRunning: true };
    }
  } catch {
    // Server not reachable
    return { agents: [], serverRunning: false };
  }
}

// ─── Webview content ──────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function agentToJson(agents: AgentInfo[]): string {
  return JSON.stringify(agents);
}

export function getWebviewContent(
  agents: AgentInfo[],
  webview: vscode.Webview,
  serverRunning: boolean,
  appName: string,
  port: number
): string {
  const agentsJson = agentToJson(agents);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Graph</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #1a1a1a;
      color: #d4d4d4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ── Toolbar ─────────────────────────────────────────────────────────── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: #252526;
      border-bottom: 1px solid #333;
      flex-shrink: 0;
      min-height: 40px;
    }
    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: #cccccc;
      flex: 1;
      letter-spacing: 0.01em;
    }
    .status-dot {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 10px;
      background: rgba(255,255,255,0.06);
    }
    .status-dot.online { color: #4ec94e; }
    .status-dot.offline { color: #e04040; }
    .btn {
      padding: 3px 11px;
      border-radius: 4px;
      border: 1px solid #484848;
      background: #383838;
      color: #cccccc;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.12s;
      white-space: nowrap;
    }
    .btn:hover { background: #454545; }
    .btn-primary { background: #1565c0; border-color: #1565c0; color: #fff; }
    .btn-primary:hover { background: #1976d2; }
    .zoom-controls { display: flex; gap: 2px; }
    .zoom-controls .btn { padding: 3px 8px; }

    /* ── Canvas ──────────────────────────────────────────────────────────── */
    .canvas-outer {
      flex: 1;
      overflow: hidden;
      position: relative;
      cursor: grab;
    }
    .canvas-outer.dragging { cursor: grabbing; }
    .canvas-inner {
      position: absolute;
      transform-origin: 0 0;
    }

    /* ── Agent card ──────────────────────────────────────────────────────── */
    .agent-card {
      position: absolute;
      width: 200px;
      border-radius: 10px;
      padding: 12px 14px 10px;
      cursor: default;
      box-shadow: 0 2px 12px rgba(0,0,0,0.5);
      transition: box-shadow 0.15s, transform 0.15s;
      user-select: none;
    }
    .agent-card:hover {
      box-shadow: 0 6px 22px rgba(0,0,0,0.7);
      transform: translateY(-1px);
    }
    .agent-card.clickable { cursor: pointer; }
    .agent-card.root {
      background: linear-gradient(150deg, #1e6fcc 0%, #0d47a1 100%);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .agent-card.sub {
      background: linear-gradient(150deg, #6b28d4 0%, #3d1a85 100%);
      border: 1px solid rgba(255,255,255,0.1);
    }

    .card-badge {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.5);
      margin-bottom: 5px;
    }
    .card-name {
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      line-height: 1.3;
      word-break: break-all;
    }
    .card-model {
      font-size: 10px;
      color: rgba(255,255,255,0.5);
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-divider {
      height: 1px;
      background: rgba(255,255,255,0.12);
      margin: 8px 0 6px;
    }
    .tools-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.4);
      margin-bottom: 5px;
    }
    .tools-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tool-chip {
      background: rgba(22, 163, 74, 0.75);
      border: 1px solid rgba(22,163,74,0.4);
      color: #d1fae5;
      font-size: 9px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 8px;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tools-overflow {
      font-size: 9px;
      color: rgba(255,255,255,0.45);
      padding: 2px 0;
    }

    /* ── SVG edges ───────────────────────────────────────────────────────── */
    #svg-edges {
      position: absolute;
      top: 0; left: 0;
      overflow: visible;
      pointer-events: none;
    }

    /* ── Empty state ─────────────────────────────────────────────────────── */
    .empty-state {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #666;
      font-size: 13px;
      text-align: center;
      padding: 40px;
    }
    .empty-state svg { opacity: 0.35; margin-bottom: 8px; }
    .empty-state p { max-width: 300px; line-height: 1.6; color: #888; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="toolbar-title">Agent Graph${appName ? ` — ${escapeHtml(appName)}` : ''}</span>
    <span class="status-dot ${serverRunning ? 'online' : 'offline'}">
      &#9679; ${serverRunning ? `live :${port}` : `offline :${port}`}
    </span>
    <button class="btn" onclick="configPort()" title="Change port (currently ${port})">&#9881; :${port}</button>
    <div class="zoom-controls">
      <button class="btn" onclick="zoom(-0.15)" title="Zoom out">&#8722;</button>
      <button class="btn" onclick="zoom(0.15)" title="Zoom in">&#43;</button>
      <button class="btn" onclick="fitGraph()" title="Fit to screen">&#8982;</button>
    </div>
    <button class="btn" onclick="switchAgent()">&#8644; Switch</button>
    <button class="btn" onclick="refresh()">&#8635; Refresh</button>
    ${!serverRunning ? `<button class="btn btn-primary" onclick="startServer()">Start Server</button>` : ''}
  </div>

  <div class="canvas-outer" id="canvasOuter">
    <div class="canvas-inner" id="canvasInner">
      <svg id="svg-edges"></svg>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const AGENTS = ${agentsJson};
    let serverRunning = ${serverRunning};

    // ── Pan / zoom state ──────────────────────────────────────────────────────
    let scale = 1, panX = 40, panY = 40;
    const outer = document.getElementById('canvasOuter');
    const inner = document.getElementById('canvasInner');
    let dragging = false, lastMX = 0, lastMY = 0;

    function applyTransform() {
      inner.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
    }

    outer.addEventListener('mousedown', (e) => {
      if (e.target.closest('.agent-card')) return;
      dragging = true; lastMX = e.clientX; lastMY = e.clientY;
      outer.classList.add('dragging');
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panX += e.clientX - lastMX; panY += e.clientY - lastMY;
      lastMX = e.clientX; lastMY = e.clientY;
      applyTransform();
    });
    window.addEventListener('mouseup', () => { dragging = false; outer.classList.remove('dragging'); });
    outer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const rect = outer.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const newScale = Math.max(0.2, Math.min(3, scale + delta));
      panX = mx - (mx - panX) * (newScale / scale);
      panY = my - (my - panY) * (newScale / scale);
      scale = newScale;
      applyTransform();
    }, { passive: false });

    function zoom(delta) {
      scale = Math.max(0.2, Math.min(3, scale + delta));
      applyTransform();
    }

    function fitGraph() {
      const cards = inner.querySelectorAll('.agent-card');
      if (cards.length === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const card of cards) {
        const x = parseFloat(card.style.left), y = parseFloat(card.style.top);
        const w = card.offsetWidth, h = card.offsetHeight;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      }
      const gw = maxX - minX + 80, gh = maxY - minY + 80;
      const ow = outer.clientWidth, oh = outer.clientHeight;
      scale = Math.min(ow / gw, oh / gh, 1);
      panX = (ow - gw * scale) / 2 - minX * scale + 40;
      panY = (oh - gh * scale) / 2 - minY * scale + 40;
      applyTransform();
    }

    function refresh() { vscode.postMessage({ type: 'refresh' }); }
    function startServer() { vscode.postMessage({ type: 'startServer' }); }
    function switchAgent() { vscode.postMessage({ type: 'switchAgent' }); }
    function configPort() { vscode.postMessage({ type: 'configPort' }); }

    // ── Layout constants ──────────────────────────────────────────────────────
    const CARD_W = 200;
    const CARD_H_MIN = 60;       // name only
    const TOOL_ROW_H = 20;       // per row of tool chips
    const H_GAP = 60;
    const V_GAP = 90;

    function estimateCardHeight(node) {
      let h = CARD_H_MIN;
      if (node.tools && node.tools.length > 0) {
        h += 8 + 14; // divider + tools-label
        const rows = Math.ceil(node.tools.length / 3);
        h += rows * TOOL_ROW_H;
      }
      return h;
    }

    // Measure total subtree width needed for node and all its sub-agents
    function subtreeWidth(node) {
      const children = node.subAgents || [];
      if (children.length === 0) return CARD_W;
      const childTotal = children.reduce((s, c) => s + subtreeWidth(c), 0);
      const gaps = (children.length - 1) * H_GAP;
      return Math.max(CARD_W, childTotal + gaps);
    }

    // Assign absolute x/y positions; returns { x, y } for this node
    function layoutNode(node, leftX, depth, positions) {
      const sw = subtreeWidth(node);
      const x = leftX + (sw - CARD_W) / 2;
      const y = depth * (CARD_H_MIN + V_GAP);
      positions.set(node.name, { x, y, h: estimateCardHeight(node) });

      let childX = leftX;
      for (const child of (node.subAgents || [])) {
        layoutNode(child, childX, depth + 1, positions);
        childX += subtreeWidth(child) + H_GAP;
      }
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function renderGraph(agents) {
      // Clear
      const existingCards = inner.querySelectorAll('.agent-card, .empty-state');
      existingCards.forEach(el => el.remove());
      const svg = document.getElementById('svg-edges');
      svg.innerHTML = '';

      if (!agents || agents.length === 0) {
        const el = document.createElement('div');
        el.className = 'empty-state';
        el.innerHTML = serverRunning
          ? '<p>No agents found. Make sure your agent exports <code>root_agent</code> and refresh.</p>'
          : '<p>Start the ADK server to load the live graph, or open an agent file with a root_agent.</p>';
        outer.appendChild(el);
        return;
      }

      const positions = new Map();
      let offsetX = 0;
      for (const root of agents) {
        layoutNode(root, offsetX, 0, positions);
        offsetX += subtreeWidth(root) + H_GAP * 2;
      }

      // SVG arrow marker
      svg.innerHTML = \`<defs>
        <marker id="arr" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
          <polygon points="0 0, 7 2.5, 0 5" fill="#4a5568"/>
        </marker>
      </defs>\`;

      // Collect edges + draw cards
      const edges = [];

      function collectEdges(node) {
        for (const child of (node.subAgents || [])) {
          edges.push({ from: node.name, to: child.name });
          collectEdges(child);
        }
      }
      for (const a of agents) collectEdges(a);

      // Draw edges first (behind cards)
      for (const edge of edges) {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) continue;
        const x1 = from.x + CARD_W / 2;
        const y1 = from.y + from.h;
        const x2 = to.x + CARD_W / 2;
        const y2 = to.y - 2;
        const cy = (y1 + y2) / 2;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', \`M \${x1} \${y1} C \${x1} \${cy}, \${x2} \${cy}, \${x2} \${y2}\`);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#4a5568');
        p.setAttribute('stroke-width', '1.5');
        p.setAttribute('marker-end', 'url(#arr)');
        svg.appendChild(p);
      }

      // Draw cards
      const rootNames = new Set(agents.map(a => a.name));

      function renderNode(node) {
        const pos = positions.get(node.name);
        if (!pos) return;

        const card = document.createElement('div');
        card.className = 'agent-card ' + (rootNames.has(node.name) ? 'root' : 'sub');
        if (node.agentFile) card.classList.add('clickable');
        card.style.left = pos.x + 'px';
        card.style.top = pos.y + 'px';
        card.style.width = CARD_W + 'px';
        card.title = node.agentFile ? 'Click to open file' : '';

        if (node.agentFile) {
          card.addEventListener('click', () =>
            vscode.postMessage({ type: 'openFile', path: node.agentFile })
          );
        }

        card.innerHTML = \`
          <div class="card-badge">\${rootNames.has(node.name) ? 'Root Agent' : 'Sub-Agent'}</div>
          <div class="card-name">\${escHtml(node.name)}</div>
          \${node.model ? \`<div class="card-model">\${escHtml(node.model)}</div>\` : ''}
          \${(node.tools && node.tools.length > 0) ? \`
            <div class="card-divider"></div>
            <div class="tools-label">Tools</div>
            <div class="tools-row">
              \${node.tools.slice(0, 6).map(t => \`<span class="tool-chip" title="\${escHtml(t)}">\${escHtml(t)}</span>\`).join('')}
              \${node.tools.length > 6 ? \`<span class="tools-overflow">+\${node.tools.length - 6} more</span>\` : ''}
            </div>
          \` : ''}
        \`;

        inner.appendChild(card);

        for (const child of (node.subAgents || [])) {
          renderNode(child);
        }
      }

      for (const a of agents) renderNode(a);

      // Resize SVG to fit content
      let maxX = 0, maxY = 0;
      for (const [, pos] of positions) {
        maxX = Math.max(maxX, pos.x + CARD_W + 60);
        maxY = Math.max(maxY, pos.y + pos.h + 60);
      }
      svg.setAttribute('width', maxX);
      svg.setAttribute('height', maxY);

      // Auto-fit on first render
      setTimeout(fitGraph, 50);
    }

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    window.addEventListener('message', (e) => {
      if (e.data.type === 'update') renderGraph(e.data.agents);
    });

    applyTransform();
    renderGraph(AGENTS);
  </script>
</body>
</html>`;
}

// ─── Agent discovery ──────────────────────────────────────────────────────────

interface AgentEntry {
  label: string;
  agentFile: string;
  appName: string;
}

function findAllAgentFiles(root: string): string[] {
  // Only scan direct children of the workspace root (depth 1).
  // Sub-agents live inside those folders and should not appear as picker options.
  const results: string[] = [];
  const skip = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'out', 'dist', '.adk']);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (skip.has(entry.name) || entry.name.startsWith('.')) continue;

    const dir = path.join(root, entry.name);
    for (const name of ['agent.py', 'agent.ts']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        results.push(candidate);
      }
    }
  }

  return results;
}

async function pickAgent(workspaceRoot: string): Promise<AgentEntry | undefined> {
  const agentFiles = findAllAgentFiles(workspaceRoot);
  log(`Agent Graph: found ${agentFiles.length} agent(s) in ${workspaceRoot}: ${agentFiles.map(f => path.basename(path.dirname(f))).join(', ')}`);

  if (agentFiles.length === 0) return undefined;

  const items: (vscode.QuickPickItem & { agentFile: string; appName: string })[] = agentFiles.map((f) => {
    const appName = path.basename(path.dirname(f));
    const rel = path.relative(workspaceRoot, f);
    return {
      label: appName,
      description: rel,
      agentFile: f,
      appName,
    };
  });

  // Always show picker — even with 1 item — so user is aware what's available
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Agent Graph — Select Agent',
    placeHolder: 'Choose which agent to visualize',
    matchOnDescription: true,
  });

  if (!pick) return undefined;
  return { label: pick.label, agentFile: pick.agentFile, appName: pick.appName };
}

// ─── Command ──────────────────────────────────────────────────────────────────

let graphPanel: vscode.WebviewPanel | undefined;
let graphAgentFile: string | undefined;

export async function showAgentGraph(context: vscode.ExtensionContext): Promise<void> {
  const project = detectAdkProject();
  if (!project) {
    vscode.window.showWarningMessage('No ADK project detected. Open a folder containing an ADK agent.');
    return;
  }

  const entry = await pickAgent(project.root);
  if (!entry) {
    vscode.window.showWarningMessage('No ADK agents found in this workspace.');
    return;
  }

  graphAgentFile = entry.agentFile;

  // Reuse or create panel
  if (graphPanel) {
    graphPanel.title = `Agent Graph — ${entry.appName}`;
    graphPanel.reveal(vscode.ViewColumn.Beside);
    await refreshGraph(graphPanel, entry.agentFile);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'adkAgentGraph',
    `Agent Graph — ${entry.appName}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );
  graphPanel = panel;

  panel.onDidDispose(() => {
    graphPanel = undefined;
    graphAgentFile = undefined;
  }, null, context.subscriptions);

  panel.webview.onDidReceiveMessage(
    async (message: { type: string; path?: string }) => {
      if (message.type === 'refresh') {
        await refreshGraph(panel, graphAgentFile);
      } else if (message.type === 'switchAgent') {
        const project = detectAdkProject();
        if (project) {
          const newEntry = await pickAgent(project.root);
          if (newEntry) {
            graphAgentFile = newEntry.agentFile;
            panel.title = `Agent Graph — ${newEntry.appName}`;
            await refreshGraph(panel, newEntry.agentFile);
          }
        }
      } else if (message.type === 'configPort') {
        await vscode.commands.executeCommand('adk.runOptions');
        await refreshGraph(panel, graphAgentFile);
      } else if (message.type === 'startServer') {
        vscode.commands.executeCommand('adk.runApiServer');
      } else if (message.type === 'openFile' && message.path) {
        try {
          const doc = await vscode.workspace.openTextDocument(message.path);
          await vscode.window.showTextDocument(doc);
        } catch (e) {
          log(`Could not open agent file: ${e}`);
        }
      }
    },
    null,
    context.subscriptions
  );

  await refreshGraph(panel, entry.agentFile);
}

async function refreshGraph(panel: vscode.WebviewPanel, agentFile?: string): Promise<void> {
  const project = detectAdkProject();
  const settings = getRunSettings();
  const port = settings.port;

  if (!project || !agentFile) {
    panel.webview.html = getWebviewContent([], panel.webview, false, '', port);
    return;
  }

  const appName = path.basename(path.dirname(agentFile));
  const { agents: liveAgents, serverRunning } = await fetchAgentInfo(appName, port);

  let agents = liveAgents;
  if (agents.length === 0) {
    // Fall back to disk parsing (works offline or when agent failed to load)
    const diskAgent = parseAgentFromDisk(agentFile, 0);
    agents = [diskAgent];
    log(`Agent Graph: using disk parse for ${appName} (serverRunning=${serverRunning})`);
  }

  panel.webview.html = getWebviewContent(agents, panel.webview, serverRunning, appName, port);
}
