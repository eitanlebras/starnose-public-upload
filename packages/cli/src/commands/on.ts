import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { isProxyRunning, getPidFile, getLogFile, getStarnoseDir, getProxyPort, setRecording, getLaunchAgentPath } from '../api.js';
import { normal, accent, dimmed } from '../format.js';


function findProxyScript(): { script: string; useTsx: boolean } | null {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const proxyPaths = [
    resolve(__dirname, './proxy.js'),                    // npm published bundle
    resolve(__dirname, '../../../proxy/dist/index.js'),  // local monorepo build
    resolve(__dirname, '../../../proxy/src/index.ts'),   // local monorepo dev
  ];

  for (const p of proxyPaths) {
    if (existsSync(p)) {
      return { script: p, useTsx: p.endsWith('.ts') };
    }
  }
  return null;
}

function installLaunchAgent(proxyInfo: { script: string; useTsx: boolean }): void {
  const plistPath = getLaunchAgentPath();
  const launchAgentsDir = dirname(plistPath);
  mkdirSync(launchAgentsDir, { recursive: true });

  const nodePath = process.execPath;
  let programArgs: string[];

  if (proxyInfo.useTsx) {
    // Find npx path
    const npxPath = join(dirname(nodePath), 'npx');
    programArgs = [npxPath, 'tsx', proxyInfo.script];
  } else {
    programArgs = [nodePath, proxyInfo.script];
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.starnose.proxy</string>
  <key>ProgramArguments</key>
  <array>
${programArgs.map(a => `    <string>${a}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(getStarnoseDir(), 'starnose.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(getStarnoseDir(), 'starnose.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(plistPath, plist);
}

async function ensureProxyRunning(): Promise<boolean> {
  // Check if already running
  if (await isProxyRunning()) return true;

  // Clean up stale PID if needed
  const pidFile = getPidFile();
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
    try { unlinkSync(pidFile); } catch { /* ignore */ }
  }

  // Find proxy script
  const proxyInfo = findProxyScript();
  if (!proxyInfo) {
    console.error(accent('✗ could not find proxy server. run npm run build first.'));
    process.exit(1);
  }

  // Install launchd plist
  installLaunchAgent(proxyInfo);

  // Spawn proxy daemon now
  const logFile = getLogFile();
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');

  const cmd = proxyInfo.useTsx ? 'npx' : 'node';
  const args = proxyInfo.useTsx ? ['tsx', proxyInfo.script] : [proxyInfo.script];

  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env },
  });

  child.unref();

  if (child.pid) {
    writeFileSync(pidFile, String(child.pid));
  }

  // Poll for health
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (await isProxyRunning()) return true;
  }

  return false;
}

export async function commandOn(): Promise<void> {
  const dir = getStarnoseDir();
  mkdirSync(dir, { recursive: true });

  // Ensure proxy is running
  const running = await ensureProxyRunning();
  if (!running) {
    console.error(accent('✗ daemon failed to start. check ~/.starnose/starnose.log'));
    process.exit(1);
  }

  // Enable recording
  setRecording(true);

  const port = getProxyPort();
  const baseUrl = `http://localhost:${port}`;

  // Set env vars at session level — applies to all new terminals automatically, no .zshrc needed
  const alreadySet = process.env.ANTHROPIC_BASE_URL === baseUrl;
  try {
    execSync(`launchctl setenv ANTHROPIC_BASE_URL ${baseUrl}`);
    execSync(`launchctl setenv OPENAI_BASE_URL ${baseUrl}/v1`);
  } catch { /* not macOS or launchctl unavailable */ }

  console.log();
  console.log(`${accent('✓')} starnose daemon started on :${port}`);
  console.log(`${accent('✓')} ANTHROPIC_BASE_URL=${baseUrl}`);
  console.log(`  ${dimmed('recording to ~/.starnose/starnose.db')}`);
  console.log();
  console.log(`  ${accent('→')} ${normal('snose sense')}    ${dimmed('watch live')}`);
  console.log(`  ${accent('→')} ${normal('snose dig')}      ${dimmed('inspect after')}`);
  console.log();
  void alreadySet;
}
