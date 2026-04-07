import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import type { CallData } from './types.js';
import { circledNumber, formatCost, formatTokens } from '../../format.js';

const CORAL = '#e8607a';
const DIM = '#505050';

const TOOL_MAP: Record<string, string> = {
  read_file: 'Read', view: 'Read', cat: 'Read',
  bash: 'Bash', run_command: 'Bash',
  edit_file: 'Edit', str_replace: 'Edit', MultiEdit: 'Edit',
  write_file: 'Write', create_file: 'Write',
  glob: 'Glob', grep: 'Grep', search: 'Grep',
};
const norm = (n: string) => TOOL_MAP[n] ?? n;

function safeParse<T>(s: any, fb: T): T {
  if (s == null) return fb;
  if (typeof s !== 'string') return s as T;
  try { return JSON.parse(s); } catch { return fb; }
}

function toolCounts(tc: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tc) {
    const n = norm(t.toolName ?? t.name ?? '');
    if (!n) continue;
    out[n] = (out[n] ?? 0) + 1;
  }
  return out;
}

function summarize(tc: any[]): string {
  return Object.entries(toolCounts(tc)).map(([n, c]) => (c > 1 ? `${n}×${c}` : n)).join(', ');
}

function skillBar(width: number, max: number, val: number): string {
  const w = max > 0 ? Math.round((val / max) * width) : 0;
  return chalk.bgHex(CORAL)(' '.repeat(Math.max(0, Math.min(width, w))));
}

function realLossItems(s: any): string[] {
  const arr = safeParse<any[]>(s, []);
  return arr
    .map((m: any) => (typeof m === 'string' ? m : m?.content ?? ''))
    .filter((x: string) => /[a-zA-Z]{4,}/.test(x));
}

interface Props {
  call: CallData;
  prev?: CallData;
  width: number;
  scroll: number;
}

export function DetailView({ call, prev, width, scroll }: Props) {
  const tc = safeParse<any[]>(call.tool_calls, []);
  const prevTc = prev ? safeParse<any[]>(prev.tool_calls, []) : [];
  const idx = circledNumber(call.call_index);
  const headerSummary = call.call_index === 1 ? 'system loaded' : `user → ${summarize(tc) || '...'}`;

  const lines: React.ReactNode[] = [];
  lines.push(<Text key="h" color={CORAL}>call ({idx})  {headerSummary}</Text>);
  lines.push(<Text key="hb"> </Text>);

  // Section 1: WHAT CHANGED
  if (prev) {
    const changed = computeChanged(call, prev, tc, prevTc);
    if (changed) {
      lines.push(<Text key="c1" color="white">▼ WHAT CHANGED</Text>);
      changed.forEach((l, i) => lines.push(<Text key={`c-${i}`}>  {l}</Text>));
      lines.push(<Text key="c-sep"> </Text>);
    }
  }

  // Section 2: WHAT IT WAS GIVEN
  lines.push(<Text key="g1" color="white">▼ WHAT IT WAS GIVEN</Text>);
  const breakdown: any = safeParse(call.system_breakdown, null);
  const sysToks = breakdown?.baseClaude?.tokens ?? 0;
  const reqBody = safeParse<any>(call.request_body, { messages: [] });
  const turns = (reqBody.messages ?? []).length;
  const total = (call.token_count_input ?? 0) + (call.token_count_cache_read ?? 0);
  const convTok = Math.max(0, total - sysToks);
  const convWarn = total > 0 && convTok / total > 0.5;
  lines.push(
    <Text key="g-conv" color={convWarn ? CORAL : undefined}>
      {'  '}conv  {formatTokens(convTok)} tok  ({turns} turns){convWarn ? '  ⚠' : ''}
    </Text>,
  );
  if (breakdown?.skills?.length) {
    const skills = [...breakdown.skills].sort((a: any, b: any) => (b.tokens ?? 0) - (a.tokens ?? 0));
    const max = Math.max(...skills.map((s: any) => s.tokens ?? 0));
    const shown = skills.slice(0, 4);
    shown.forEach((s: any, i: number) => {
      const b = skillBar(4, max, s.tokens ?? 0);
      const name = (s.name ?? '?').padEnd(14);
      lines.push(
        <Text key={`g-s-${i}`}>  {name} {b}  {formatTokens(s.tokens ?? 0)}</Text>,
      );
    });
    if (skills.length > 4) {
      lines.push(<Text key="g-more" color={DIM}>  +{skills.length - 4} more skills</Text>);
    }
  }

  // Section 3: WHAT IT WAS MISSING
  const missing = realLossItems(call.missing_context);
  if (missing.length > 0) {
    lines.push(<Text key="m-sep"> </Text>);
    lines.push(<Text key="m1" color="white">▼ WHAT IT WAS MISSING</Text>);
    missing.slice(0, 5).forEach((m, i) => {
      const max = width - 8;
      const t = m.length > max ? m.slice(0, max - 3) + '...' : m;
      lines.push(<Text key={`m-${i}`} color={CORAL}>  △ "{t}"</Text>);
    });
  }

  const visible = lines.slice(Math.min(scroll, Math.max(0, lines.length - 1)));
  return <>{visible}</>;
}

function computeChanged(call: CallData, prev: CallData, tc: any[], prevTc: any[]): string[] | null {
  const cur = toolCounts(tc);
  const prv = toolCounts(prevTc);
  const allKeys = new Set<string>([...Object.keys(cur), ...Object.keys(prv)]);
  if (allKeys.size === 0) return null;
  let shareAny = false;
  for (const k of allKeys) {
    if (cur[k] && prv[k]) { shareAny = true; break; }
  }
  if (!shareAny) return null;

  const out: string[] = [];
  for (const k of allKeys) {
    const d = (cur[k] ?? 0) - (prv[k] ?? 0);
    if (d > 0) out.push(`+ ${k}×${d} added   (${cur[k]} total, was ${prv[k] ?? 0})`);
    else if (d < 0) out.push(`- ${k}×${-d} removed   (${cur[k] ?? 0} total, was ${prv[k]})`);
  }
  const curTok = (call.token_count_input ?? 0) + (call.token_count_cache_read ?? 0);
  const prvTok = (prev.token_count_input ?? 0) + (prev.token_count_cache_read ?? 0);
  const tokDelta = curTok - prvTok;
  if (Math.abs(tokDelta) > 0) {
    const sign = tokDelta >= 0 ? '+' : '−';
    out.push(`${sign} ${Math.abs(tokDelta)} tok        (${formatTokens(curTok)} total)`);
  }
  const costDelta = (call.estimated_cost_usd ?? 0) - (prev.estimated_cost_usd ?? 0);
  if (Math.abs(costDelta) > 0.0001) {
    const sign = costDelta >= 0 ? '+' : '−';
    out.push(`${sign} ${formatCost(Math.abs(costDelta))}        (${formatCost(call.estimated_cost_usd ?? 0)} total)`);
  }
  return out;
}
