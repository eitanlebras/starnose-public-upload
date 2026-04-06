import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { isProxyRunning, getPidFile, getLogFile, getUserFile, getStarnoseDir, getProxyPort, setRecording, getLaunchAgentPath } from '../api.js';
import { normal, accent, dimmed, box } from '../format.js';

async function promptEmail(): Promise<string> {
  const userFile = getUserFile();
  if (existsSync(userFile)) {
    try {
      const data = JSON.parse(readFileSync(userFile, 'utf-8'));
      if (data.email) return data.email;
    } catch { /* ignore */ }
  }

  const width = Math.min(process.stdout.columns ?? 60, 60);
  console.log(box([
    accent('welcome to starnose'),
    '',
    'enter your email to activate:',
  ], width));

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(accent('  > '), (answer) => {
      rl.close();
      const email = answer.trim();
      if (email) {
        const dir = getStarnoseDir();
        mkdirSync(dir, { recursive: true });
        writeFileSync(userFile, JSON.stringify({ email, activatedAt: new Date().toISOString() }));

        // Best-effort remote activation
        fetch('https://starnose.dev/api/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, version: '0.1.0' }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => { /* ignore network failures */ });
      }
      resolve(email);
    });
  });
}

function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

function findProxyScript(): { script: string; useTsx: boolean } | null {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const proxyPaths = [
    resolve(__dirname, '../../../proxy/dist/index.js'),
    resolve(__dirname, '../../../proxy/src/index.ts'),
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

  // Email capture on first run
  const userFile = getUserFile();
  if (!existsSync(userFile)) {
    await promptEmail();
  }

  // Ensure proxy is running
  const running = await ensureProxyRunning();
  if (!running) {
    console.error(accent('✗ daemon failed to start. check ~/.starnose/starnose.log'));
    process.exit(1);
  }

  // Enable recording
  setRecording(true);

  const port = getProxyPort();
  const width = Math.min(process.stdout.columns ?? 60, 60);

  // Check if env vars are already in .zshrc
  const zshrc = join(homedir(), '.zshrc');
  const envLine1 = 'export ANTHROPIC_BASE_URL=http://localhost:3001';
  const envLine2 = 'export OPENAI_BASE_URL=http://localhost:3001/v1';
  let hasEnvVars = false;

  if (existsSync(zshrc)) {
    const content = readFileSync(zshrc, 'utf-8');
    hasEnvVars = content.includes('ANTHROPIC_BASE_URL') && content.includes('localhost:3001');
  }

  if (hasEnvVars) {
    // Already set up — just confirm recording is on
    const lines = [
      accent('starnose recording'),
      '---',
      `proxy running on port ${port}`,
      '',
      `${normal('snose sense')}    →  watch it work live`,
      `${normal('snose dig')}      →  understand every decision`,
    ];
    console.log(box(lines, width));
    return;
  }

  // First-time setup: show env var instructions
  const lines = [
    accent('starnose started'),
    '---',
    'add to ~/.zshrc (once):',
    '',
    normal(envLine1),
    normal(envLine2),
    '',
  ];

  const shouldAdd = await askYesNo(
    box(lines, width) + '\n\n  add these to ~/.zshrc automatically? (y/n) '
  );

  if (shouldAdd) {
    const marker = '\n# starnose proxy\n';
    const block = `${marker}${envLine1}\n${envLine2}\n`;

    const existing = existsSync(zshrc) ? readFileSync(zshrc, 'utf-8') : '';
    writeFileSync(zshrc, existing + block);

    console.log('');
    console.log(box([
      accent('added to ~/.zshrc'),
      '---',
      `run ${normal('source ~/.zshrc')} or open a new terminal.`,
      '',
      'after that, just use claude normally.',
      'starnose captures everything automatically.',
      '',
      `${normal('snose sense')}    →  watch it work live`,
      `${normal('snose dig')}      →  understand every decision`,
    ], width));
  } else {
    console.log('');
    console.log(box([
      'add these lines to ~/.zshrc manually:',
      '',
      normal(envLine1),
      normal(envLine2),
      '',
      `then: ${normal('source ~/.zshrc')}`,
      '',
      'after that, just use claude normally.',
      'starnose captures everything automatically.',
      '',
      `${normal('snose sense')}    →  watch it work live`,
      `${normal('snose dig')}      →  understand every decision`,
    ], width));
  }
}
