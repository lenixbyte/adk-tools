import * as vscode from 'vscode';
import { StatusBarManager } from './statusBarManager';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { detectCurrentModel } from '../commands/modelSwitcher';
import { getRunSettings } from '../utils/settings';

type SectionId = 'development' | 'deployment' | 'evaluation' | 'help';

export class AdkTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      command?: vscode.Command;
      description?: string;
      icon?: vscode.ThemeIcon;
      contextValue?: string;
      tooltip?: string | vscode.MarkdownString;
    }
  ) {
    super(label, collapsibleState);
    if (options?.command) this.command = options.command;
    if (options?.description !== undefined) this.description = options.description;
    if (options?.icon) this.iconPath = options.icon;
    if (options?.contextValue) this.contextValue = options.contextValue;
    if (options?.tooltip) this.tooltip = options.tooltip;
  }
}

export class AdkTreeProvider implements vscode.TreeDataProvider<AdkTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly statusBar: StatusBarManager) {}

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: AdkTreeItem): vscode.TreeItem { return element; }

  getChildren(element?: AdkTreeItem): AdkTreeItem[] {
    if (!element) return this.getRootItems();
    const id = element.contextValue as SectionId | undefined;
    if (id === 'development') return this.getDevItems();
    if (id === 'deployment') return this.getDeployItems();
    if (id === 'evaluation') return this.getEvalItems();
    if (id === 'help') return this.getHelpItems();
    return [];
  }

  private getRootItems(): AdkTreeItem[] {
    const project = detectAdkProject();

    if (!project) {
      return [
        new AdkTreeItem('No ADK project detected', vscode.TreeItemCollapsibleState.None, {
          icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
          description: 'open a folder with an agent',
        }),
        new AdkTreeItem('Create New Agent Project', vscode.TreeItemCollapsibleState.None, {
          command: { command: 'adk.createProject', title: 'Create New Agent Project' },
          icon: new vscode.ThemeIcon('add'),
        }),
        new AdkTreeItem('Getting Started', vscode.TreeItemCollapsibleState.None, {
          command: { command: 'adk.gettingStarted', title: 'Getting Started' },
          icon: new vscode.ThemeIcon('book'),
        }),
      ];
    }

    const env = detectEnv(project.root);
    const model = detectCurrentModel(project.agentFile);
    const settings = getRunSettings();

    const items: AdkTreeItem[] = [];

    items.push(new AdkTreeItem(project.name, vscode.TreeItemCollapsibleState.None, {
      icon: new vscode.ThemeIcon('folder-active'),
      description: `${project.language} · ${env.runner}`,
      tooltip: new vscode.MarkdownString(
        `**${project.name}**\n\n` +
        `- Language: ${project.language}\n` +
        `- Runner: \`${env.runner}\`\n` +
        `- Model: \`${model ?? 'unknown'}\`\n` +
        `- Port: \`${settings.port}\`\n` +
        `- Root: \`${project.root}\``
      ),
    }));

    if (model) {
      items.push(new AdkTreeItem(model, vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.switchModel', title: 'Switch Model' },
        icon: new vscode.ThemeIcon('symbol-enum'),
        description: 'click to switch',
        tooltip: `Current model: ${model} — click to switch`,
      }));
    }

    items.push(new AdkTreeItem('Development', vscode.TreeItemCollapsibleState.Expanded, {
      icon: new vscode.ThemeIcon('rocket'),
      contextValue: 'development',
    }));

    items.push(new AdkTreeItem('Deployment', vscode.TreeItemCollapsibleState.Collapsed, {
      icon: new vscode.ThemeIcon('cloud-upload'),
      contextValue: 'deployment',
    }));

    items.push(new AdkTreeItem('Evaluation', vscode.TreeItemCollapsibleState.Collapsed, {
      icon: new vscode.ThemeIcon('beaker'),
      contextValue: 'evaluation',
    }));

    items.push(new AdkTreeItem('Help & Diagnostics', vscode.TreeItemCollapsibleState.Collapsed, {
      icon: new vscode.ThemeIcon('question'),
      contextValue: 'help',
    }));

    return items;
  }

  private getDevItems(): AdkTreeItem[] {
    const webRunning = this.statusBar.isWebRunning();
    const apiRunning = this.statusBar.isApiRunning();
    const port = this.statusBar.getPort();

    return [
      new AdkTreeItem(
        webRunning ? 'Web UI  ●' : 'Run Web UI',
        vscode.TreeItemCollapsibleState.None,
        {
          command: { command: webRunning ? 'adk.stopServers' : 'adk.runWeb', title: '' },
          description: webRunning ? `localhost:${port}` : undefined,
          icon: new vscode.ThemeIcon(
            webRunning ? 'stop-circle' : 'play',
            webRunning ? new vscode.ThemeColor('charts.green') : undefined
          ),
          tooltip: webRunning ? 'Running — click to stop' : `Start ADK Web UI on localhost:${port}`,
        }
      ),
      new AdkTreeItem(
        apiRunning ? 'API Server  ●' : 'Run API Server',
        vscode.TreeItemCollapsibleState.None,
        {
          command: { command: apiRunning ? 'adk.stopServers' : 'adk.runApiServer', title: '' },
          description: apiRunning ? `localhost:${port}` : undefined,
          icon: new vscode.ThemeIcon(
            apiRunning ? 'stop-circle' : 'server-process',
            apiRunning ? new vscode.ThemeColor('charts.green') : undefined
          ),
          tooltip: apiRunning ? 'Running — click to stop' : `Start ADK API Server on localhost:${port}`,
        }
      ),
      new AdkTreeItem('Run CLI (adk run)', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.runCli', title: 'Run CLI' },
        icon: new vscode.ThemeIcon('terminal'),
        tooltip: 'Interactive CLI session — pick agent and session mode',
      }),
      ...(webRunning || apiRunning
        ? [new AdkTreeItem('Open in Browser', vscode.TreeItemCollapsibleState.None, {
            command: { command: 'adk.openWebBrowser', title: 'Open in Browser' },
            icon: new vscode.ThemeIcon('browser'),
            description: `localhost:${port}`,
          })]
        : []),
      new AdkTreeItem('Open Agent File', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.openConfig', title: 'Open Agent File' },
        icon: new vscode.ThemeIcon('go-to-file'),
      }),
      new AdkTreeItem('Edit .env', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.openEnv', title: 'Edit .env' },
        icon: new vscode.ThemeIcon('key'),
        tooltip: 'Open .env file (create if missing)',
      }),
      new AdkTreeItem('Auth Setup', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.authWizard', title: 'Auth Setup' },
        icon: new vscode.ThemeIcon('shield'),
        tooltip: 'Set up Gemini API key or Vertex AI credentials',
      }),
      new AdkTreeItem('Run Options', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.runOptions', title: 'Run Options' },
        icon: new vscode.ThemeIcon('settings-gear'),
        tooltip: 'Configure port, hot reload, log level, session storage',
      }),
    ];
  }

  private getDeployItems(): AdkTreeItem[] {
    return [
      new AdkTreeItem('Deploy to Cloud Run', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.deploy', title: 'Deploy to Cloud Run', arguments: ['cloud_run'] },
        icon: new vscode.ThemeIcon('cloud-upload'),
        description: 'adk deploy cloud_run',
      }),
      new AdkTreeItem('Deploy to Agent Engine', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.deploy', title: 'Deploy to Agent Engine', arguments: ['agent_engine'] },
        icon: new vscode.ThemeIcon('azure'),
        description: 'Vertex AI',
      }),
      new AdkTreeItem('Deploy to GKE', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.deploy', title: 'Deploy to GKE', arguments: ['gke'] },
        icon: new vscode.ThemeIcon('server'),
        description: 'Kubernetes',
      }),
    ];
  }

  private getEvalItems(): AdkTreeItem[] {
    return [
      new AdkTreeItem('Run Eval', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.runEval', title: 'Run Eval' },
        icon: new vscode.ThemeIcon('play-circle'),
        tooltip: 'Run adk eval on an eval file',
      }),
      new AdkTreeItem('Generate Eval Cases', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.createEvalFile', title: 'Generate Eval Cases' },
        icon: new vscode.ThemeIcon('add'),
        tooltip: 'Generate eval test cases with adk eval_set',
      }),
    ];
  }

  private getHelpItems(): AdkTreeItem[] {
    return [
      new AdkTreeItem('Getting Started', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.gettingStarted', title: 'Getting Started' },
        icon: new vscode.ThemeIcon('book'),
      }),
      new AdkTreeItem('Run Diagnostics', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.diagnostics', title: 'Run Diagnostics' },
        icon: new vscode.ThemeIcon('pulse'),
        tooltip: 'Check tools, port, environment',
      }),
      new AdkTreeItem('Kill Port 8000', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.killPort', title: 'Kill Port 8000' },
        icon: new vscode.ThemeIcon('trash'),
        tooltip: 'Force-free port 8000 if stuck',
      }),
      new AdkTreeItem('Show Output Log', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.showOutput', title: 'Show Output Log' },
        icon: new vscode.ThemeIcon('output'),
      }),
      new AdkTreeItem('ADK Documentation', vscode.TreeItemCollapsibleState.None, {
        command: { command: 'adk.openDocs', title: 'Open ADK Docs' },
        icon: new vscode.ThemeIcon('link-external'),
      }),
    ];
  }
}
