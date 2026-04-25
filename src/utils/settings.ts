import * as vscode from 'vscode';

export interface RunSettings {
  port: number;
  hotReload: boolean;
  logLevel: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
  sessionUri: string;
}

const DEFAULTS: RunSettings = {
  port: 8000,
  hotReload: false,
  logLevel: 'INFO',
  sessionUri: 'memory://',
};

let _ctx: vscode.ExtensionContext | undefined;

export function initSettings(ctx: vscode.ExtensionContext): void {
  _ctx = ctx;
}

export function getRunSettings(): RunSettings {
  if (!_ctx) return { ...DEFAULTS };
  return {
    port: _ctx.workspaceState.get('adk.port', DEFAULTS.port),
    hotReload: _ctx.workspaceState.get('adk.hotReload', DEFAULTS.hotReload),
    logLevel: _ctx.workspaceState.get('adk.logLevel', DEFAULTS.logLevel),
    sessionUri: _ctx.workspaceState.get('adk.sessionUri', DEFAULTS.sessionUri),
  };
}

export async function updateRunSettings(update: Partial<RunSettings>): Promise<void> {
  if (!_ctx) return;
  for (const [k, v] of Object.entries(update)) {
    await _ctx.workspaceState.update(`adk.${k}`, v);
  }
}

/** Show interactive run options menu, returns true if settings were changed */
export async function showRunOptionsMenu(): Promise<boolean> {
  const s = getRunSettings();

  type Item = vscode.QuickPickItem & { key?: keyof RunSettings };
  const items: Item[] = [
    {
      label: s.hotReload ? '$(sync~spin) Hot Reload  ON' : '$(sync) Hot Reload  OFF',
      description: '--reload_agents',
      detail: 'Auto-restart server when agent files change',
      key: 'hotReload',
    },
    {
      label: `$(plug) Port  :${s.port}`,
      description: '--port',
      detail: 'Server port (default 8000)',
      key: 'port',
    },
    {
      label: `$(output) Log Level  ${s.logLevel}`,
      description: '--log_level',
      detail: 'Logging verbosity for the ADK server',
      key: 'logLevel',
    },
    {
      label: `$(database) Session Storage  ${s.sessionUri}`,
      description: '--session_service_uri',
      detail: 'memory:// | sqlite:///./sessions.db | agentengine://',
      key: 'sessionUri',
    },
    { label: '$(discard) Reset to Defaults', description: '' },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: 'ADK Run Options',
    placeHolder: 'Select a setting to change',
  });
  if (!pick) return false;

  if (pick.label.startsWith('$(discard)')) {
    await updateRunSettings(DEFAULTS);
    vscode.window.showInformationMessage('ADK run options reset to defaults.');
    return true;
  }

  switch (pick.key) {
    case 'hotReload':
      await updateRunSettings({ hotReload: !s.hotReload });
      return true;

    case 'port': {
      const input = await vscode.window.showInputBox({
        title: 'Server Port',
        value: String(s.port),
        prompt: 'Port number for adk web / adk api_server',
        validateInput: (v) => {
          const n = parseInt(v);
          if (isNaN(n) || n < 1024 || n > 65535) return 'Enter a port between 1024 and 65535';
          return null;
        },
      });
      if (input) { await updateRunSettings({ port: parseInt(input) }); return true; }
      return false;
    }

    case 'logLevel': {
      const level = await vscode.window.showQuickPick(['DEBUG', 'INFO', 'WARNING', 'ERROR'], {
        title: 'Log Level',
        placeHolder: 'Select log verbosity',
      });
      if (level) { await updateRunSettings({ logLevel: level as RunSettings['logLevel'] }); return true; }
      return false;
    }

    case 'sessionUri': {
      const uri = await vscode.window.showQuickPick(
        [
          { label: 'memory://', description: 'Ephemeral — lost when server stops (default)' },
          { label: 'sqlite:///./sessions.db', description: 'Persistent local file' },
          { label: 'agentengine://', description: 'Google Cloud Agent Engine (requires Vertex AI auth)' },
        ],
        { title: 'Session Storage Backend' }
      );
      if (uri) { await updateRunSettings({ sessionUri: uri.label }); return true; }
      return false;
    }
  }
  return false;
}
