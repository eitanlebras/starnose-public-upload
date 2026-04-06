import { existsSync, readFileSync, statSync } from 'fs';
import chalk from 'chalk';
import { isProxyRunning, getPidFile, getProxyPort, fetchApi, getStarnoseDir, isRecording } from '../api.js';
import { normal, dimmed, accent, box, formatTokens, numberWithCommas } from '../format.js';
import { join } from 'path';

export async function commandStatus(): Promise<void> {
  const pidFile = getPidFile();
  const running = await isProxyRunning();

  let pid = 0;
  if (existsSync(pidFile)) {
    pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
  }

  const port = getProxyPort();
  const dbPath = join(getStarnoseDir(), 'starnose.db');
  let dbSize = '0b';
  if (existsSync(dbPath)) {
    const stats = statSync(dbPath);
    const mb = stats.size / (1024 * 1024);
    dbSize = mb >= 1 ? `${mb.toFixed(1)}mb` : `${(stats.size / 1024).toFixed(0)}kb`;
  }

  const width = Math.min(process.stdout.columns ?? 60, 60);
  const lines: string[] = [
    accent('starnose status'),
    '---',
  ];

  if (running) {
    lines.push(`proxy       ${chalk.green('●')} running  (pid ${pid}, port ${port})`);
    const recording = isRecording();
    lines.push(`recording   ${recording ? chalk.green('●') + ' on' : chalk.yellow('●') + ' off'}`);
  } else {
    lines.push(`proxy       ${chalk.red('●')} stopped`);
    lines.push('');
    lines.push(`run ${normal('snose on')} to start`);
  }

  lines.push(`database    ${dimmed(dbPath)}  (${dbSize})`);

  if (running) {
    try {
      const sessions = await fetchApi<any[]>('/internal/sessions');
      const now = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      const todaySessions = sessions.filter((s: any) => s.created_at >= todayMs);
      const todayCalls = todaySessions.reduce((sum: number, s: any) => sum + (s.call_count ?? 0), 0);
      const todayTokens = todaySessions.reduce((sum: number, s: any) => sum + (s.total_tokens ?? 0), 0);

      const allCalls = sessions.reduce((sum: number, s: any) => sum + (s.call_count ?? 0), 0);
      const allTokens = sessions.reduce((sum: number, s: any) => sum + (s.total_tokens ?? 0), 0);

      lines.push('');
      lines.push(`today       ${numberWithCommas(todayCalls)} calls · ${formatTokens(todayTokens)} · ${todaySessions.length} sessions`);
      lines.push(`all time    ${numberWithCommas(allCalls)} calls · ${formatTokens(allTokens)} · ${sessions.length} sessions`);

      if (sessions.length > 0) {
        const last = sessions[0];
        const ago = Math.floor((now - last.created_at) / 60000);
        const agoStr = ago < 1 ? 'just now' : `${ago} min ago`;
        lines.push('');
        lines.push(`last run    ${dimmed(last.key)}  "${last.title}"`);
        lines.push(`            ${last.call_count} calls · ${agoStr} · ${last.last_status === 'running' ? '● active' : '✓ ' + (last.last_status ?? 'done')}`);
      }
    } catch {
      lines.push('');
      lines.push(dimmed('(could not fetch session data)'));
    }
  }

  console.log(box(lines, width));
}
