import * as vscode from 'vscode';

type ServerState = 'idle' | 'web' | 'api';

export class StatusBarManager implements vscode.Disposable {
  private badge: vscode.StatusBarItem;   // ⚡ ADK · pipenv
  private leftBtn: vscode.StatusBarItem; // ▶ Web | $(broadcast) :8000
  private rightBtn: vscode.StatusBarItem;// ▶ API | $(stop-circle) Stop
  private hotBadge: vscode.StatusBarItem;// $(sync~spin) hot reload badge

  private _state: ServerState = 'idle';
  private _runner: string | undefined;
  private _port = 8000;
  private _hotReload = false;

  constructor() {
    this.badge = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
    this.badge.text = '$(zap) ADK';
    this.badge.tooltip = 'ADK Tools — click for command menu';
    this.badge.command = 'adk.showMenu';
    this.badge.show();

    this.leftBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
    this.rightBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);

    this.hotBadge = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.hotBadge.text = '$(sync~spin) hot reload';
    this.hotBadge.tooltip = 'Hot reload active — agent restarts on file changes (--reload_agents)';
    this.hotBadge.command = 'adk.runOptions';
    this.hotBadge.color = new vscode.ThemeColor('charts.yellow');
  }

  setProject(runner?: string): void {
    this._runner = runner;
    this.badge.text = runner ? `$(zap) ADK · ${runner}` : '$(zap) ADK';
    if (runner) {
      this._render();
    } else {
      this.leftBtn.hide();
      this.rightBtn.hide();
      this.hotBadge.hide();
    }
  }

  isWebRunning(): boolean { return this._state === 'web'; }
  isApiRunning(): boolean { return this._state === 'api'; }
  isAnyRunning(): boolean { return this._state !== 'idle'; }

  setWebRunning(running: boolean, port?: number): void {
    this._state = running ? 'web' : 'idle';
    if (port) this._port = port;
    this._render();
  }

  setApiRunning(running: boolean, port?: number): void {
    this._state = running ? 'api' : 'idle';
    if (port) this._port = port;
    this._render();
  }

  setHotReload(active: boolean): void {
    this._hotReload = active;
    this._render();
  }

  clearRunning(): void {
    this._state = 'idle';
    this._render();
  }

  private _render(): void {
    if (!this._runner) return;

    switch (this._state) {
      case 'idle':
        this.leftBtn.text = '$(play) Web';
        this.leftBtn.tooltip = `Run ADK Web UI on localhost:${this._port}`;
        this.leftBtn.command = 'adk.runWeb';
        this.leftBtn.backgroundColor = undefined;
        this.rightBtn.text = '$(server-process) API';
        this.rightBtn.tooltip = `Run ADK API Server on localhost:${this._port}`;
        this.rightBtn.command = 'adk.runApiServer';
        this.rightBtn.backgroundColor = undefined;
        this.leftBtn.show();
        this.rightBtn.show();
        this.hotBadge.hide();
        break;

      case 'web':
        this.leftBtn.text = `$(broadcast) :${this._port}`;
        this.leftBtn.tooltip = `ADK Web UI — click to open in browser`;
        this.leftBtn.command = 'adk.openWebBrowser';
        this.leftBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.rightBtn.text = '$(stop-circle) Stop';
        this.rightBtn.tooltip = 'Stop ADK Web UI';
        this.rightBtn.command = 'adk.stopServers';
        this.rightBtn.backgroundColor = undefined;
        this.leftBtn.show();
        this.rightBtn.show();
        if (this._hotReload) this.hotBadge.show(); else this.hotBadge.hide();
        break;

      case 'api':
        this.leftBtn.text = `$(server-process) :${this._port}`;
        this.leftBtn.tooltip = `ADK API Server — click to open in browser`;
        this.leftBtn.command = 'adk.openWebBrowser';
        this.leftBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.rightBtn.text = '$(stop-circle) Stop';
        this.rightBtn.tooltip = 'Stop ADK API Server';
        this.rightBtn.command = 'adk.stopServers';
        this.rightBtn.backgroundColor = undefined;
        this.leftBtn.show();
        this.rightBtn.show();
        if (this._hotReload) this.hotBadge.show(); else this.hotBadge.hide();
        break;
    }
  }

  getPort(): number { return this._port; }

  dispose(): void {
    this.badge.dispose();
    this.leftBtn.dispose();
    this.rightBtn.dispose();
    this.hotBadge.dispose();
  }
}
