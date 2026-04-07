import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import EventSource from 'eventsource';
import { fetchApi, isProxyRunning, getBaseUrl } from '../api.js';
import {
  formatTokens, formatCost, formatLatency, formatDuration,
} from '../format.js';
import { CallData } from './dig/types.js';
import { DetailView } from './dig/DetailView.js';

// ═══════════════════════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════════════════════

const C = {
  normal: '#F0F0F0',
  dim: '#505050',
  mid: '#A0A0A0',
  mauve: '#e62050',
  yellow: '#B8A060',
  red: '#e62050',
  bgDim: '#2A2A2A',
};

const CONTEXT_LIMIT = 200_000;

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface SSECall {
  callIndex: number;
  summary: string;
  latencyMs: number;
  tokenInput: number;
  tokenOutput: number;
  tokenThinking: number;
  tokenCacheCreation?: number;
  tokenCacheRead?: number;
  cost: number;
  status: string;
  model?: string;
  toolCalls: ToolCallInfo[];
  skillsDetected: string[];
  compactionDetected: boolean;
  missingContext: any[];
  systemBreakdown?: any;
  tokensBeforeCompaction?: number;
}

interface ToolCallInfo {
  toolName: string;
  toolInput?: string;
  toolResult?: string;
}

interface LiveState {
  callIndex: number;
  startTime: number;
  toolName: string | null;
}

type Mode = 'stream' | 'browse' | 'detail';

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function safeParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function fromCallData(c: CallData): SSECall {
  return {
    callIndex: c.call_index,
    summary: c.summary ?? '',
    latencyMs: c.latency_ms ?? 0,
    tokenInput: c.token_count_input ?? 0,
    tokenOutput: c.token_count_output ?? 0,
    tokenThinking: c.token_count_thinking ?? 0,
    tokenCacheCreation: c.token_count_cache_creation ?? 0,
    tokenCacheRead: c.token_count_cache_read ?? 0,
    cost: c.estimated_cost_usd ?? 0,
    status: c.status ?? 'success',
    model: c.model,
    toolCalls: safeParse(c.tool_calls, []),
    skillsDetected: safeParse(c.skills_detected, []),
    compactionDetected: !!c.compaction_detected,
    missingContext: safeParse(c.missing_context ?? 'null', []) ?? [],
    systemBreakdown: safeParse(c.system_breakdown ?? 'null', null),
    tokensBeforeCompaction: c.tokens_before_compaction ?? undefined,
  };
}

function totalInputTokens(call: SSECall): number {
  return call.tokenInput + (call.tokenCacheRead ?? 0);
}

const TOOL_NAME_MAP: Record<string, string> = {
  read_file: 'Read', view: 'Read', cat: 'Read',
  bash: 'Bash', run_command: 'Bash',
  edit_file: 'Edit', str_replace: 'Edit', MultiEdit: 'Edit',
  write_file: 'Write', create_file: 'Write',
  glob: 'Glob', grep: 'Grep', search: 'Grep',
};
const norm = (n: string) => TOOL_NAME_MAP[n] ?? n;

function summarizeTools(tools: ToolCallInfo[]): string {
  if (!tools?.length) return '';
  const counts = new Map<string, number>();
  for (const t of tools) {
    const n = norm(t.toolName ?? '');
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const entries = [...counts.entries()];
  if (entries.length === 1) {
    const [n, c] = entries[0];
    return c > 1 ? `${n}×${c}` : n;
  }
  // Show top tool by count + "+N tools"
  entries.sort((a, b) => b[1] - a[1]);
  const [topN, topC] = entries[0];
  const rest = entries.length - 1;
  const head = topC > 1 ? `${topN}×${topC}` : topN;
  return rest > 0 ? `${head} +${rest} tool${rest > 1 ? 's' : ''}` : head;
}

function makeBar(filled: number, width: number): { fill: string; empty: string } {
  const f = Math.max(0, Math.min(width, filled));
  return { fill: '▓'.repeat(f), empty: '░'.repeat(width - f) };
}

function ctxColor(pct: number): string {
  if (pct >= 0.8) return C.mauve;
  if (pct >= 0.6) return C.yellow;
  return C.normal;
}

function isRealCompaction(call: SSECall): boolean {
  return !!call.compactionDetected;
}

function hasRealContent(text: string): boolean {
  return /[a-zA-Z]{4,}/.test(text ?? '');
}

function computeCostBreakdown(calls: SSECall[]) {
  const totalCost = calls.reduce((s, c) => s + c.cost, 0);
  const totalTokens = calls.reduce(
    (s, c) => s + c.tokenInput + (c.tokenCacheRead ?? 0) + c.tokenOutput, 0,
  );
  const ppt = totalTokens > 0 ? totalCost / totalTokens : 0;
  let skillTok = 0, ctxTok = 0;
  for (const c of calls) {
    const bd = c.systemBreakdown;
    const totalIn = totalInputTokens(c);
    if (bd) {
      const sk = (bd.skills ?? []).reduce((s: number, x: any) => s + (x.tokens ?? 0), 0);
      const sys = bd.baseClaude?.tokens ?? 0;
      skillTok += sk;
      ctxTok += Math.max(0, totalIn - sys - sk);
    } else {
      ctxTok += totalIn;
    }
  }
  const skillCost = skillTok * ppt;
  const contextCost = ctxTok * ppt;
  const workCost = Math.max(0, totalCost - skillCost - contextCost);
  return { skillCost, contextCost, workCost, totalCost, skillTokens: skillTok };
}

// ─── Insights ─────────────────────────────────────────────

interface Insight {
  text: string;
  color: string;
  priority: number; // lower = more urgent
}

function deriveInsights(calls: SSECall[]): Insight[] {
  if (calls.length === 0) return [];
  const out: Insight[] = [];

  const latest = calls[calls.length - 1];
  const totalIn = totalInputTokens(latest);
  const ctxPct = totalIn / CONTEXT_LIMIT;

  // ── 1. CONTEXT PREDICTION ──
  if (ctxPct >= 0.95) {
    out.push({ text: '⚠ compaction imminent — next call likely', color: C.red, priority: 0 });
  } else if (ctxPct >= 0.8) {
    // Estimate calls remaining via avg growth
    const window = calls.slice(-5);
    let avgGrowth = 0;
    if (window.length >= 2) {
      const deltas: number[] = [];
      for (let i = 1; i < window.length; i++) {
        const d = totalInputTokens(window[i]) - totalInputTokens(window[i - 1]);
        if (d > 0) deltas.push(d);
      }
      if (deltas.length > 0) {
        avgGrowth = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      }
    }
    const remain = avgGrowth > 0 ? Math.max(1, Math.round((CONTEXT_LIMIT - totalIn) / avgGrowth)) : 0;
    out.push({
      text: `⚠ context at ${Math.round(ctxPct * 100)}% — compaction in ~${remain} calls`,
      color: C.red,
      priority: 1,
    });
  } else if (ctxPct >= 0.5) {
    const window = calls.slice(-5);
    let avgGrowth = 0;
    if (window.length >= 2) {
      const deltas: number[] = [];
      for (let i = 1; i < window.length; i++) {
        const d = totalInputTokens(window[i]) - totalInputTokens(window[i - 1]);
        if (d > 0) deltas.push(d);
      }
      if (deltas.length > 0) avgGrowth = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    }
    if (avgGrowth > 0) {
      const remain = Math.max(1, Math.round((CONTEXT_LIMIT - totalIn) / avgGrowth));
      if (remain < 30) {
        out.push({
          text: `⚠ context at ${Math.round(ctxPct * 100)}% — compaction in ~${remain} calls`,
          color: C.yellow,
          priority: 5,
        });
      }
    }
  }

  // ── 2. LOOP DETECTION ──
  if (calls.length >= 6) {
    // Look at last min(20, length) calls
    const window = calls.slice(-Math.min(20, calls.length));
    const sigCounts = new Map<string, number>();
    for (const c of window) {
      const sig = summarizeTools(c.toolCalls);
      if (!sig) continue;
      sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
    }
    let topSig = '';
    let topCount = 0;
    for (const [sig, n] of sigCounts) {
      if (n > topCount) { topSig = sig; topCount = n; }
    }
    if (topCount >= 5 && topCount / window.length > 0.5) {
      out.push({
        text: `⚠ ${topSig} on ${topCount} of last ${window.length} calls — possible loop`,
        color: C.red,
        priority: 2,
      });
    }
  }

  // ── 3. LATENCY SPIKE ──
  if (calls.length >= 4) {
    const others = calls.slice(0, -1);
    const avgLat = others.reduce((s, c) => s + c.latencyMs, 0) / others.length;
    if (avgLat > 0 && latest.latencyMs > avgLat * 10) {
      const factor = (latest.latencyMs / avgLat).toFixed(0);
      out.push({
        text: `⚠ call (${latest.callIndex}) took ${formatLatency(latest.latencyMs)} — ${factor}× slower than avg`,
        color: C.yellow,
        priority: 3,
      });
    }
  }

  // ── 4. COST PACE ──
  const totalCost = calls.reduce((s, c) => s + c.cost, 0);
  if (totalCost > 2) {
    const avgCall = totalCost / calls.length;
    const totalTime = calls.reduce((s, c) => s + c.latencyMs, 0);
    const hourly = totalTime > 0 ? (totalCost / (totalTime / 3_600_000)) : 0;
    out.push({
      text: `⚠ ${formatCost(totalCost)} spent — ${formatCost(avgCall)}/call · at this pace: ${formatCost(hourly)}/hr`,
      color: C.yellow,
      priority: 6,
    });
  }

  // ── 6. UPGRADE CTA — high-value moments ──
  if (totalCost >= 5) {
    out.push({
      text: `→ see exactly where ${formatCost(totalCost)} went · starnose.dev/upgrade`,
      color: C.mauve,
      priority: 4,
    });
  } else if (calls.length >= 40) {
    out.push({
      text: `→ ${calls.length} calls this session · pro keeps every session forever · starnose.dev/upgrade`,
      color: C.mauve,
      priority: 8,
    });
  }

  // ── 5. SKILL WASTE ──
  const first = calls[0];
  const bd = first?.systemBreakdown;
  if (bd && calls.length >= 3) {
    const skillTok = (bd.skills ?? []).reduce((s: number, x: any) => s + (x.tokens ?? 0), 0);
    const firstIn = totalInputTokens(first);
    const ppt = firstIn > 0 ? first.cost / firstIn : 0;
    const overhead = skillTok * ppt;
    if (overhead > 0.05) {
      const totalOverhead = overhead * calls.length;
      out.push({
        text: `⚠ ${formatCost(overhead)} skill overhead per call · at ${calls.length} calls: ${formatCost(totalOverhead)}`,
        color: C.yellow,
        priority: 7,
      });
    }
  }

  out.sort((a, b) => a.priority - b.priority);
  return out.slice(0, 3);
}

// Returns true if this call had >3× session avg latency
function isSlow(call: SSECall, allCalls: SSECall[]): boolean {
  if (allCalls.length < 3) return false;
  const others = allCalls.filter(c => c !== call);
  const avg = others.reduce((s, c) => s + c.latencyMs, 0) / others.length;
  return avg > 0 && call.latencyMs > avg * 3;
}

function isCostly(call: SSECall, allCalls: SSECall[]): boolean {
  if (allCalls.length < 3) return false;
  const others = allCalls.filter(c => c !== call);
  const avg = others.reduce((s, c) => s + c.cost, 0) / others.length;
  return avg > 0 && call.cost > avg * 3;
}

// ═══════════════════════════════════════════════════════════
// ZONE 1: SESSION OVERVIEW
// ═══════════════════════════════════════════════════════════

function ZoneOverview({ sessionKey, title, calls, elapsedMs, isRunning, width }: {
  sessionKey: string; title: string; calls: SSECall[]; elapsedMs: number; isRunning: boolean; width: number;
}) {
  const latest = calls[calls.length - 1];
  const totalIn = latest ? totalInputTokens(latest) : 0;
  const ctxPct = totalIn / CONTEXT_LIMIT;
  const totalCost = calls.reduce((s, c) => s + c.cost, 0);
  const avgCost = calls.length > 0 ? totalCost / calls.length : 0;

  const color = ctxColor(ctxPct);
  const pct = Math.round((totalIn / 200000) * 100)
  const filled = Math.round((totalIn / 200000) * 40)
  const empty = 40 - filled
  const filledChar = chalk.hex('#e62050')('▓').repeat(filled)
  const emptyChar = chalk.dim('░').repeat(empty)
  const bar = '\x1b[0m' + filledChar + emptyChar

  const headerText = `── ${sessionKey}  "${truncate(title || 'untitled', Math.max(10, width - 20))}"  `;
  const headerFill = '─'.repeat(Math.max(0, width - headerText.length));

  return (
    <Box flexDirection="column">
      <Text color={C.dim}>{headerText + headerFill}</Text>
      <Text> </Text>
      <Text>
        <Text color={C.mid}>  context  </Text>
        <Text color={C.dim}>[</Text>
        <Text>{bar}</Text>
        <Text color={C.dim}>] </Text>
        <Text color={color}> {String(Math.round(ctxPct * 100)).padStart(3)}%</Text>
      </Text>
      <Text>
        <Text color={C.mid}>  cost     </Text>
        <Text color={C.normal}>{formatCost(totalCost)}</Text>
        <Text color={C.dim}>  ·  </Text>
        <Text color={C.mid}>{formatCost(avgCost)}/call avg</Text>
        <Text color={C.dim}>  ·  </Text>
        <Text color={C.mid}>{calls.length} calls</Text>
      </Text>
      <Text>
        <Text color={C.mid}>  time     </Text>
        <Text color={isRunning ? C.normal : C.dim}>{formatDuration(elapsedMs)}</Text>
        {isRunning && <Text color={C.dim}>  running</Text>}
        {!isRunning && <Text color={C.dim}>  done</Text>}
      </Text>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════
// ZONE 2: RECENT CALLS
// ═══════════════════════════════════════════════════════════

function CallLine({ call, allCalls, selected }: {
  call: SSECall; allCalls: SSECall[]; selected: boolean;
}) {
  const idxStr = `(${call.callIndex})`.padStart(5);
  const lat = formatLatency(call.latencyMs).padStart(6);
  const totalIn = totalInputTokens(call);
  const tok = formatTokens(totalIn).padStart(10);
  const cost = formatCost(call.cost).padStart(6);
  const tools = summarizeTools(call.toolCalls);
  const summary = tools || call.summary || 'response';

  const flags: string[] = [];
  if (call.compactionDetected) flags.push('⚡');
  if (isSlow(call, allCalls)) flags.push('⚠ slow');
  if (isCostly(call, allCalls)) flags.push('⚠ costly');
  const flagText = flags.length > 0 ? '  ' + flags.join(' ') : '';

  const cursor = selected ? '►' : ' ';
  if (selected) {
    return (
      <Text backgroundColor={C.mauve} color="#0F0F0F">
        {`${cursor} ${idxStr}  ${lat}  ${tok}  ${cost}  ${truncate(summary, 40)}${flagText}`}
      </Text>
    );
  }

  return (
    <Text>
      <Text color={C.dim}>  </Text>
      <Text color={C.mid}>{idxStr}  </Text>
      <Text color={C.dim}>{lat}  </Text>
      <Text color={C.normal}>{tok}  </Text>
      <Text color={C.dim}>{cost}  </Text>
      <Text color={C.normal}>{truncate(summary, 40)}</Text>
      {flags.length > 0 && <Text color={C.red}>{flagText}</Text>}
    </Text>
  );
}

function CompactionBlock({ call }: { call: SSECall }) {
  const before = call.tokensBeforeCompaction ?? 0;
  const after = totalInputTokens(call);
  const lost = Math.max(0, before - after);
  const real = (call.missingContext ?? []).filter((m: any) => hasRealContent(m?.content ?? ''));
  return (
    <Box flexDirection="column">
      <Text color={C.mauve}>  ⚡ compaction: {formatTokens(before)} → {formatTokens(after)}  lost {formatTokens(lost)}</Text>
      {real.slice(0, 2).map((m: any, i: number) => (
        <Text key={i} color={C.dim}>     △ "{truncate((m.content ?? '').replace(/\n/g, ' '), 60)}"</Text>
      ))}
    </Box>
  );
}

function ZoneRecentCalls({ calls, mode, cursor }: {
  calls: SSECall[]; mode: Mode; cursor: number;
}) {
  if (calls.length === 0) {
    return <Text color={C.dim}>  waiting for first call...</Text>;
  }

  // BROWSE: show all calls
  if (mode === 'browse') {
    return (
      <Box flexDirection="column">
        {calls.map((call, i) =>
          call.compactionDetected
            ? <CompactionBlock key={`c-${call.callIndex}`} call={call} />
            : <CallLine key={call.callIndex} call={call} allCalls={calls} selected={i === cursor} />
        )}
      </Box>
    );
  }

  // STREAM: show pinned (call ① + compactions) + last 5 non-pinned recent
  const recentLimit = 5;
  const pinnedCall1 = calls[0];
  const compactions = calls.filter(c => c.compactionDetected && c !== pinnedCall1);
  const tail = calls.slice(-recentLimit);
  const tailSet = new Set(tail);
  const pinnedSet = new Set<SSECall>();
  if (pinnedCall1 && !tailSet.has(pinnedCall1)) pinnedSet.add(pinnedCall1);
  for (const c of compactions) {
    if (!tailSet.has(c)) pinnedSet.add(c);
  }

  // Render pinned first (in their natural order), then tail
  const pinnedOrdered = calls.filter(c => pinnedSet.has(c));

  // ── Inline subline dedup per spec ──
  // Skills subline appears ONLY on call ① (the very first call) — handled by Call1Header.
  // Reads subline: only when read file set changes from previous call in the tail.
  let lastReadsKey = '';

  return (
    <Box flexDirection="column">
      {pinnedOrdered.map(call =>
        call.compactionDetected
          ? <CompactionBlock key={`pc-${call.callIndex}`} call={call} />
          : <Call1Header key={`p-${call.callIndex}`} call={call} />
      )}
      {pinnedOrdered.length > 0 && tail.length > 0 && (
        <Text color={C.dim}>  ⋮</Text>
      )}
      {tail.map(call => {
        if (call.compactionDetected) {
          lastReadsKey = '';
          return <CompactionBlock key={`tc-${call.callIndex}`} call={call} />;
        }

        const readFiles = (call.toolCalls || [])
          .filter(t => ['Read', 'read_file', 'view'].includes(t.toolName))
          .map(t => {
            try {
              const obj = JSON.parse(t.toolInput ?? '');
              const fp = obj.file_path ?? obj.path ?? '';
              return (String(fp).split('/').pop() || '').trim();
            } catch { return ''; }
          })
          .filter(f => f.length > 2);
        const readsKey = [...new Set(readFiles)].sort().join('|');
        const showReads = readsKey !== '' && readsKey !== lastReadsKey;
        if (showReads) lastReadsKey = readsKey;

        return (
          <Box key={call.callIndex} flexDirection="column">
            <CallLine call={call} allCalls={calls} selected={false} />
            {showReads && (
              <Text color={C.dim}>       read: {[...new Set(readFiles)].slice(0, 3).join(' · ')}{readFiles.length > 3 ? ` · +${readFiles.length - 3}` : ''}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function Call1Header({ call }: { call: SSECall }) {
  const totalIn = totalInputTokens(call);
  const pct = totalIn / CONTEXT_LIMIT;
  const bar = makeBar(Math.round(pct * 28), 28);
  const skills: { name: string; tokens: number }[] = call.systemBreakdown?.skills ?? [];
  const sortedSkills = [...skills].sort((a, b) => b.tokens - a.tokens);
  const shown = sortedSkills.slice(0, 3).map(s => `${s.name}(${formatTokens(s.tokens)})`);
  const more = Math.max(0, sortedSkills.length - 3);
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={C.mid}>  ① system loaded  </Text>
        <Text color={ctxColor(pct)}>{bar.fill}</Text>
        <Text color={C.bgDim}>{bar.empty}</Text>
        <Text color={C.dim}>  {String(Math.round(pct * 100)).padStart(3)}%</Text>
      </Text>
      {shown.length > 0 && (
        <Text color={C.dim}>     skills: {shown.join(' · ')}{more > 0 ? ` · +${more}` : ''}</Text>
      )}
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════
// ZONE 3: ACTIVE INSIGHTS
// ═══════════════════════════════════════════════════════════

function ZoneInsights({ calls }: { calls: SSECall[] }) {
  const insights = deriveInsights(calls);
  if (insights.length === 0) return null;
  return (
    <Box flexDirection="column">
      {insights.map((ins, i) => (
        <Text key={i} color={ins.color}>  {ins.text}</Text>
      ))}
    </Box>
  );
}

function SessionCompleteBox({ calls, sessionKey: _sessionKey }: {
  calls: SSECall[]; sessionKey: string;
}) {
  const totalTok = calls.reduce((s, c) => s + totalInputTokens(c) + c.tokenOutput, 0);
  const totalLat = calls.reduce((s, c) => s + c.latencyMs, 0);
  const bd = computeCostBreakdown(calls);
  const skillPct = bd.totalCost > 0 ? Math.round((bd.skillCost / bd.totalCost) * 100) : 0;
  const histPct = bd.totalCost > 0 ? Math.round((bd.contextCost / bd.totalCost) * 100) : 0;
  const workPct = bd.totalCost > 0 ? Math.round((bd.workCost / bd.totalCost) * 100) : 0;

  const W = 50;
  const top = '┌' + '─'.repeat(W - 2) + '┐';
  const bot = '└' + '─'.repeat(W - 2) + '┘';
  const pad = (s: string) => s.padEnd(W - 4);

  return (
    <Box flexDirection="column">
      <Text color={C.mid}>  session complete</Text>
      <Text color={C.dim}>  {top}</Text>
      <Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.normal}>{pad(`${calls.length} calls  ·  ${formatTokens(totalTok)}  ·  ${formatCost(bd.totalCost)}  ·  ${formatDuration(totalLat)}`)}</Text>
        <Text color={C.dim}>│</Text>
      </Text>
      <Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.mid}>{pad(`skill     ${formatCost(bd.skillCost).padEnd(7)} ${String(skillPct).padStart(3)}%`)}</Text>
        <Text color={C.dim}>│</Text>
      </Text>
      <Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.mid}>{pad(`history   ${formatCost(bd.contextCost).padEnd(7)} ${String(histPct).padStart(3)}%`)}</Text>
        <Text color={C.dim}>│</Text>
      </Text>
      <Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.mid}>{pad(`work      ${formatCost(bd.workCost).padEnd(7)} ${String(workPct).padStart(3)}%`)}</Text>
        <Text color={C.dim}>│</Text>
      </Text>
      {workPct < 10 && (
        <Text>
          <Text color={C.dim}>  │  </Text>
          <Text color={C.red}>{pad(`⚠ only ${workPct}% was actual work`)}</Text>
          <Text color={C.dim}>│</Text>
        </Text>
      )}
      <Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.dim}>{pad('→ snose dig to inspect')}</Text>
        <Text color={C.dim}>│</Text>
      </Text>
      <Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.mauve}>{pad('→ keep every session forever · starnose.dev/upgrade')}</Text>
        <Text color={C.dim}>│</Text>
      </Text>
      <Text>
        <Text color={C.dim}>  │  </Text>
        <Text color={C.dim}>{pad('  free tier keeps this session for 24h only')}</Text>
        <Text color={C.dim}>│</Text>
      </Text>
      <Text color={C.mauve}>  {bot}</Text>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════
// LIVE INDICATOR + STATUS BAR
// ═══════════════════════════════════════════════════════════

function LiveIndicator({ live, tick }: { live: LiveState | null; tick: number }) {
  if (!live) {
    return <Text color={C.dim}>  waiting for claude...</Text>;
  }
  const elapsed = Date.now() - live.startTime;
  const pulse = tick % 2 === 0;
  const dotColor = pulse ? C.mauve : C.dim;
  const tool = live.toolName ? `   ${live.toolName}` : '';
  return (
    <Text>
      <Text color={dotColor}>  ●</Text>
      <Text color={C.normal}>  running...</Text>
      <Text color={C.dim}>  [{formatDuration(elapsed)}]{tool}</Text>
    </Text>
  );
}

function StatusBar({ mode }: { mode: Mode }) {
  switch (mode) {
    case 'stream':
      return <Text><Text color={C.mauve}>  LIVE</Text><Text color={C.dim}>  space browse · q quit</Text></Text>;
    case 'browse':
      return <Text><Text color={C.mauve}>  BROWSE</Text><Text color={C.dim}>  ↑↓ navigate · enter inspect · space stream · q quit</Text></Text>;
    case 'detail':
      return <Text><Text color={C.mauve}>  DETAIL</Text><Text color={C.dim}>  esc back</Text></Text>;
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════

function SenseApp({ initialCalls, initialSession }: {
  initialCalls: SSECall[];
  initialSession: { key: string; title: string; id: string } | null;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  const [mode, setMode] = useState<Mode>('stream');
  const [calls, setCalls] = useState<SSECall[]>(initialCalls);
  const [sessionKey, setSessionKey] = useState(initialSession?.key ?? '...');
  const [sessionTitle, setSessionTitle] = useState(initialSession?.title ?? '');
  const [sessionId, setSessionId] = useState(initialSession?.id ?? '');
  const sessionStartedAtRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState(Math.max(0, initialCalls.length - 1));
  const [live, setLive] = useState<LiveState | null>(null);
  const [tick, setTick] = useState(0);
  const [sessionDone, setSessionDone] = useState(initialCalls.length > 0);
  const [detailCallData, setDetailCallData] = useState<CallData | null>(null);

  const lastCallTimeRef = useRef(initialCalls.length > 0 ? Date.now() - 60_000 : Date.now());
  const callsRef = useRef(calls);
  callsRef.current = calls;

  // Tick timer + session done detection
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
      if (callsRef.current.length > 0 && !sessionDone && !live) {
        if (Date.now() - lastCallTimeRef.current > 3_000) {
          setSessionDone(true);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [sessionDone, live]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource(`${getBaseUrl()}/internal/events`);
    es.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === 'ping') return;

      if (data.type === 'call_started') {
        if (sessionStartedAtRef.current == null) sessionStartedAtRef.current = Date.now();
        setLive({
          callIndex: data.callIndex ?? 0,
          startTime: Date.now(),
          toolName: data.toolName ?? null,
        });
        setSessionDone(false);
      }

      if (data.type === 'call_progress') {
        setLive(prev => prev ? { ...prev, toolName: data.toolName ?? prev.toolName } : prev);
      }

      if (data.type === 'call_completed') {
        setLive(null);
        lastCallTimeRef.current = Date.now();
        setSessionDone(false);

        const call = data.call as SSECall;
        if (typeof call.toolCalls === 'string') call.toolCalls = safeParse(call.toolCalls as any, []);
        if (typeof call.skillsDetected === 'string') call.skillsDetected = safeParse(call.skillsDetected as any, []);
        if (typeof call.missingContext === 'string') call.missingContext = safeParse(call.missingContext as any, []);

        setCalls(prev => {
          if (data.sessionId && data.sessionId !== sessionId) {
            setSessionId(data.sessionId);
            setSessionKey(data.key ?? sessionKey);
            setSessionTitle(data.title ?? '');
            return [call];
          }
          const idx = prev.findIndex(c => c.callIndex === call.callIndex);
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = call;
            return next;
          }
          return [...prev, call];
        });
      }
    };
    return () => es.close();
  }, [sessionId]);

  // Update cursor when new calls arrive (in stream mode)
  useEffect(() => {
    if (mode === 'stream') {
      setCursor(Math.max(0, calls.length - 1));
    }
  }, [calls.length, mode]);

  const loadDetailCall = useCallback(async (idx: number) => {
    if (!sessionId) return;
    try {
      const dbCalls = await fetchApi<CallData[]>(`/internal/calls/${sessionId}`);
      const call = dbCalls.find(c => c.call_index === calls[idx]?.callIndex);
      if (call) {
        setDetailCallData(call);
        setMode('detail');
      }
    } catch {}
  }, [sessionId, calls]);

  // Keyboard
  useInput((input, key) => {
    if (mode === 'stream') {
      if (input === ' ') {
        setMode('browse');
        setCursor(Math.max(0, calls.length - 1));
      }
      if (input === 'q') exit();
    } else if (mode === 'browse') {
      if (key.upArrow) setCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setCursor(c => Math.min(calls.length - 1, c + 1));
      if (key.return && calls.length > 0) loadDetailCall(cursor);
      if (input === ' ') setMode('stream');
      if (input === 'q') exit();
    } else if (mode === 'detail') {
      if (key.escape) {
        setMode('browse');
        setDetailCallData(null);
      }
    }
  }, { isActive: mode !== 'detail' });

  // ── RENDER ──

  if (mode === 'detail' && detailCallData) {
    return (
      <DetailView
        call={detailCallData}
        width={width}
        isActive={true}
        onBlur={() => { setMode('browse'); setDetailCallData(null); }}
      />
    );
  }

  const elapsedMs = sessionDone
    ? calls.reduce((s, c) => s + c.latencyMs, 0)
    : Math.max(0, Date.now() - (sessionStartedAtRef.current ?? Date.now()));

  const sep = '─'.repeat(Math.max(20, width - 2));

  return (
    <Box flexDirection="column">
      {/* ZONE 1 */}
      <ZoneOverview
        sessionKey={sessionKey}
        title={sessionTitle}
        calls={calls}
        elapsedMs={elapsedMs}
        isRunning={!!live}
        width={width}
      />

      <Text> </Text>
      <Text color={C.dim}>{sep}</Text>
      <Text> </Text>

      {/* ZONE 2 */}
      <ZoneRecentCalls calls={calls} mode={mode} cursor={cursor} />

      {(() => {
        const showZone3 = (sessionDone && calls.length > 0) || deriveInsights(calls).length > 0;
        if (!showZone3) {
          return (
            <>
              <Text> </Text>
              <Text color={C.dim}>{sep}</Text>
            </>
          );
        }
        return (
          <>
            <Text> </Text>
            <Text color={C.dim}>{sep}</Text>
            <Text> </Text>
            {sessionDone && calls.length > 0 ? (
              <SessionCompleteBox calls={calls} sessionKey={sessionKey} />
            ) : (
              <ZoneInsights calls={calls} />
            )}
            <Text> </Text>
            <Text color={C.dim}>{sep}</Text>
          </>
        );
      })()}

      {/* Live indicator */}
      {mode === 'stream' && !sessionDone && (
        <LiveIndicator live={live} tick={tick} />
      )}

      <Text> </Text>
      <StatusBar mode={mode} />
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════

export async function commandSense(): Promise<void> {
  const running = await isProxyRunning();
  if (!running) {
    console.log('\x1b[38;2;157;127;140m✗ daemon not running — snose on\x1b[0m');
    process.exit(1);
  }

  let initialSession: { key: string; title: string; id: string } | null = null;
  let initialCalls: SSECall[] = [];

  try {
    const session = await fetchApi<any>('/internal/session/current');
    if (session?.id) {
      initialSession = { key: session.key, title: session.title ?? '', id: session.id };
      const dbCalls = await fetchApi<CallData[]>(`/internal/calls/${session.id}`);
      initialCalls = dbCalls.map(fromCallData);
    }
  } catch {}

  const { waitUntilExit } = render(
    <SenseApp initialCalls={initialCalls} initialSession={initialSession} />
  );
  await waitUntilExit();
}

// Suppress unused warnings for symbols kept for clarity
void isRealCompaction;
