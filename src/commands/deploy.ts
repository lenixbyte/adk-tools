import * as vscode from 'vscode';
import { detectAdkProject } from '../utils/detect';
import { detectEnv } from '../utils/env';
import { isCommandAvailable } from '../utils/tools';
import { log } from '../utils/output';

const REGIONS = [
  'us-central1', 'us-east1', 'us-west1',
  'europe-west1', 'europe-west4',
  'asia-northeast1', 'asia-southeast1',
  'Other...',
];

export async function deploy(target?: string): Promise<void> {
  const project = detectAdkProject();
  if (!project) { vscode.window.showWarningMessage('No ADK project found.'); return; }

  const hasAdk = await isCommandAvailable('adk --version');
  if (!hasAdk) {
    vscode.window.showErrorMessage('adk CLI not found. Install it first: pip install google-adk');
    return;
  }

  const deployTarget = target ?? (await vscode.window.showQuickPick(
    [
      { label: '$(cloud-upload) Cloud Run', description: 'Serverless — easiest to start', value: 'cloud_run' },
      { label: '$(azure) Agent Engine', description: 'Vertex AI managed agent runtime', value: 'agent_engine' },
      { label: '$(server) GKE', description: 'Google Kubernetes Engine', value: 'gke' },
    ],
    { title: 'Deploy ADK Agent', placeHolder: 'Select deployment target' }
  ))?.value;

  if (!deployTarget) return;

  if (deployTarget === 'cloud_run') await deployCloudRun(project);
  else if (deployTarget === 'agent_engine') await deployAgentEngine(project);
  else if (deployTarget === 'gke') await deployGke(project);
}

async function deployCloudRun(project: { root: string; name: string }): Promise<void> {
  const gcpProject = await inputRequired('Deploy to Cloud Run — 1/4', 'GCP Project ID', 'my-gcp-project');
  if (!gcpProject) return;

  const region = await pickRegion('Deploy to Cloud Run — 2/4');
  if (!region) return;

  const serviceName = await vscode.window.showInputBox({
    title: 'Deploy to Cloud Run — 3/4: Service Name',
    value: project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    prompt: 'Cloud Run service name',
  });
  if (!serviceName) return;

  const withUi = await vscode.window.showQuickPick(
    [
      { label: 'API only (recommended for production)', value: false },
      { label: 'API + Web UI (development only)', value: true },
    ],
    { title: 'Deploy to Cloud Run — 4/4: Include Web UI?' }
  );
  if (!withUi) return;

  const env = detectEnv(project.root);
  const agentPath = '.'; // deploy from project root
  const flags = [
    `--project ${gcpProject}`,
    `--region ${region}`,
    `--service_name ${serviceName}`,
    withUi.value ? '--with_ui' : '',
  ].filter(Boolean).join(' ');

  const cmd = env.adkCmd(`deploy cloud_run ${flags} ${agentPath}`);
  log(`Deploying to Cloud Run: ${cmd}`);
  run(cmd, `ADK: Deploy → Cloud Run`, project.root);
}

async function deployAgentEngine(project: { root: string; name: string }): Promise<void> {
  const gcpProject = await inputRequired('Deploy to Agent Engine — 1/3', 'GCP Project ID', 'my-gcp-project');
  if (!gcpProject) return;

  const region = await pickRegion('Deploy to Agent Engine — 2/3');
  if (!region) return;

  const displayName = await vscode.window.showInputBox({
    title: 'Deploy to Agent Engine — 3/3: Display Name',
    value: project.name,
    prompt: 'Human-readable agent name in Agent Engine',
  });
  if (!displayName) return;

  const env = detectEnv(project.root);
  const agentPath = '.';
  const flags = [
    `--project ${gcpProject}`,
    `--region ${region}`,
    `--display_name "${displayName}"`,
    '--validate-agent-import',
  ].join(' ');

  const cmd = env.adkCmd(`deploy agent_engine ${flags} ${agentPath}`);
  log(`Deploying to Agent Engine: ${cmd}`);
  run(cmd, `ADK: Deploy → Agent Engine`, project.root);
}

async function deployGke(project: { root: string; name: string }): Promise<void> {
  const gcpProject = await inputRequired('Deploy to GKE — 1/4', 'GCP Project ID', 'my-gcp-project');
  if (!gcpProject) return;

  const region = await pickRegion('Deploy to GKE — 2/4');
  if (!region) return;

  const cluster = await inputRequired('Deploy to GKE — 3/4', 'GKE Cluster Name', 'my-cluster');
  if (!cluster) return;

  const serviceType = await vscode.window.showQuickPick(
    [
      { label: 'ClusterIP (default — internal only)', value: 'ClusterIP' },
      { label: 'LoadBalancer (public endpoint)', value: 'LoadBalancer' },
    ],
    { title: 'Deploy to GKE — 4/4: Service Type' }
  );
  if (!serviceType) return;

  const env = detectEnv(project.root);
  const agentPath = '.';
  const flags = [
    `--project ${gcpProject}`,
    `--region ${region}`,
    `--cluster_name ${cluster}`,
    `--service_type ${serviceType.value}`,
  ].join(' ');

  const cmd = env.adkCmd(`deploy gke ${flags} ${agentPath}`);
  log(`Deploying to GKE: ${cmd}`);
  run(cmd, `ADK: Deploy → GKE`, project.root);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function pickRegion(title: string): Promise<string | undefined> {
  const pick = await vscode.window.showQuickPick(REGIONS, { title, placeHolder: 'Select GCP region' });
  if (!pick) return undefined;
  if (pick !== 'Other...') return pick;
  return vscode.window.showInputBox({ prompt: 'Enter region (e.g. us-east4)' });
}

async function inputRequired(title: string, prompt: string, placeholder: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    prompt,
    placeHolder: placeholder,
    validateInput: (v) => v.trim() ? null : `${prompt} is required`,
  });
}

function run(cmd: string, name: string, cwd: string): void {
  const terminal = vscode.window.createTerminal({ name, cwd });
  terminal.show();
  terminal.sendText(cmd);
}
