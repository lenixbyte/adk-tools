import * as net from 'net';
import * as cp from 'child_process';
import { log } from './output';

export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, '127.0.0.1');
  });
}

export function lsofPort(port: number): Promise<string> {
  return new Promise((resolve) => {
    cp.exec(`lsof -i :${port}`, (_err, stdout) => resolve(stdout || '(no output)'));
  });
}

export function killPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    cp.exec(`lsof -ti:${port}`, (_err, stdout) => {
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length === 0) { resolve(); return; }

      log(`Killing PIDs on port ${port}: ${pids.join(', ')}`);
      cp.exec(`lsof -ti:${port} | xargs kill -9`, (err) => {
        if (err && err.code !== 1) {
          reject(err);
        } else {
          log(`Port ${port} freed.`);
          resolve();
        }
      });
    });
  });
}
