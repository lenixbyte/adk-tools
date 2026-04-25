import * as fs from 'fs';
import * as path from 'path';

export type EnvRunner = 'pipenv' | 'uv' | 'venv' | 'conda' | 'direct';

export interface ProjectEnv {
  runner: EnvRunner;
  adkCmd: (subcmd: string) => string;
  activateHint: string;
}

export function detectEnv(root: string): ProjectEnv {
  // pipenv: Pipfile present
  if (fs.existsSync(path.join(root, 'Pipfile'))) {
    return {
      runner: 'pipenv',
      adkCmd: (sub) => `pipenv run adk ${sub}`,
      activateHint: 'pipenv shell',
    };
  }

  // uv: uv.lock or pyproject.toml with [tool.uv]
  if (fs.existsSync(path.join(root, 'uv.lock'))) {
    return {
      runner: 'uv',
      adkCmd: (sub) => `uv run adk ${sub}`,
      activateHint: 'uv sync',
    };
  }
  if (fs.existsSync(path.join(root, 'pyproject.toml'))) {
    try {
      const content = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf-8');
      if (content.includes('[tool.uv]')) {
        return {
          runner: 'uv',
          adkCmd: (sub) => `uv run adk ${sub}`,
          activateHint: 'uv sync',
        };
      }
    } catch { /* ignore */ }
  }

  // local .venv
  const venvAdk = findVenvAdk(root);
  if (venvAdk) {
    return {
      runner: 'venv',
      adkCmd: (sub) => `${venvAdk} ${sub}`,
      activateHint: `source ${path.join(root, '.venv', 'bin', 'activate')}`,
    };
  }

  // conda env.yml
  if (fs.existsSync(path.join(root, 'environment.yml'))) {
    return {
      runner: 'conda',
      adkCmd: (sub) => `adk ${sub}`,
      activateHint: 'conda activate <env-name>',
    };
  }

  return {
    runner: 'direct',
    adkCmd: (sub) => `adk ${sub}`,
    activateHint: '',
  };
}

function findVenvAdk(root: string): string | null {
  const candidates = [
    path.join(root, '.venv', 'bin', 'adk'),
    path.join(root, 'venv', 'bin', 'adk'),
    path.join(root, '.env', 'bin', 'adk'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
