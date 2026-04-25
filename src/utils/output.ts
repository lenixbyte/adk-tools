import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | undefined;

export function getOutput(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel('ADK Tools');
  }
  return _channel;
}

export function log(msg: string): void {
  getOutput().appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

export function showOutput(): void {
  getOutput().show(true);
}

export function disposeOutput(): void {
  _channel?.dispose();
  _channel = undefined;
}
