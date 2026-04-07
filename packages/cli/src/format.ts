import chalk from 'chalk';

const normal = chalk.hex('#F0F0F0');
const dimmed = chalk.hex('#505050');
const accent = chalk.ansi256(204);
const secondary = chalk.hex('#A0A0A0');

export { normal, dimmed, accent, secondary };

export const selected = chalk.bgAnsi256(204).hex('#0F0F0F');
export const warning = accent;

export function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  return `${(n / 1000).toFixed(1)}k tok`;
}

export function formatCost(n: number): string {
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n >= 0.001) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const h = hours % 12 || 12;
  return `${h}:${mins}${ampm}`;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

export function circledNumber(n: number): string {
  if (n >= 1 && n <= 9) return CIRCLED[n - 1];
  return `(${n})`;
}

export function box(lines: string[], width: number): string {
  const hr = '─'.repeat(width - 2);
  const result: string[] = [];
  result.push(`┌${hr}┐`);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '---') {
      result.push(`├${hr}┤`);
    } else {
      const stripped = stripAnsi(lines[i]);
      const pad = Math.max(0, width - 4 - stripped.length);
      result.push(`│  ${lines[i]}${' '.repeat(pad)}│`);
    }
  }
  result.push(`└${hr}┘`);
  return result.join('\n');
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function numberWithCommas(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
