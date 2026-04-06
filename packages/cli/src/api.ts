import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STARNOSE_DIR = join(homedir(), '.starnose');

export function getProxyPort(): number {
  const portFile = join(STARNOSE_DIR, 'port');
  try {
    if (existsSync(portFile)) {
      return parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
    }
  } catch { /* ignore */ }
  return 3001;
}

export function getBaseUrl(): string {
  return `http://localhost:${getProxyPort()}`;
}

export async function fetchApi<T = any>(path: string): Promise<T> {
  const resp = await fetch(`${getBaseUrl()}${path}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json() as Promise<T>;
}

export async function isProxyRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${getBaseUrl()}/internal/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function getPidFile(): string {
  return join(STARNOSE_DIR, 'starnose.pid');
}

export function getLogFile(): string {
  return join(STARNOSE_DIR, 'starnose.log');
}

export function getUserFile(): string {
  return join(STARNOSE_DIR, 'user.json');
}

export function getStarnoseDir(): string {
  return STARNOSE_DIR;
}

export function getRecordingFile(): string {
  return join(STARNOSE_DIR, 'recording');
}

export function isRecording(): boolean {
  return existsSync(getRecordingFile());
}

export function setRecording(on: boolean): void {
  const file = getRecordingFile();
  if (on) {
    writeFileSync(file, String(Date.now()));
  } else {
    try { unlinkSync(file); } catch { /* ignore */ }
  }
}

export function getLaunchAgentPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'dev.starnose.proxy.plist');
}
