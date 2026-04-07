import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CallData } from './types.js';
import { formatTokens, formatCost, formatLatency, circledNumber } from '../../format.js';

interface Props {
  call: CallData;
  prevCall?: CallData;
  isSimilarToPrev?: boolean;
  width: number;
  isActive?: boolean;
  onBlur?: () => void;
}

type SectionKey =
  | 'given'
  | 'changed'
  | 'stats'
  | 'read'
  | 'thinking'
  | 'sent'
  | 'missing'
  | 'decision';

const SECTION_ORDER: SectionKey[] = [
  'given', 'changed', 'stats', 'read', 'thinking', 'sent', 'missing', 'decision',
];

const SECTION_LABELS: Record<SectionKey, string> = {
  given: 'WHAT IT WAS GIVEN',
  changed: 'WHAT CHANGED',
  stats: 'STATS',
  read: 'WHAT IT READ',
  thinking: 'WHAT IT WAS THINKING',
  sent: 'WHAT YOU SENT',
  missing: 'WHAT IT WAS MISSING',
  decision: 'DECISION',
};

const FORCE_COLLAPSED: SectionKey[] = [];

interface ToolCallInfo {
  toolName: string;
  toolInput?: string;
  toolResult?: string;
}

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function normalizeToolName(name: string): string {
  const map: Record<string, string> = {
    read_file: 'Read', view: 'Read', cat: 'Read',
    bash: 'Bash', run_command: 'Bash',
    glob: 'Glob', grep: 'Grep', search: 'Grep',
    edit_file: 'Edit', str_replace: 'Edit', MultiEdit: 'Edit',
    write_file: 'Write', create_file: 'Write',
  };
  return map[name] ?? name;
}

function groupToolCalls(toolCalls: ToolCallInfo[]): Map<string, ToolCallInfo[]> {
  const groups = new Map<string, ToolCallInfo[]>();
  for (const tc of toolCalls) {
    const n = normalizeToolName(tc.toolName);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n)!.push(tc);
  }
  return groups;
}

function countsByTool(toolCalls: ToolCallInfo[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const tc of toolCalls) {
    const n = normalizeToolName(tc.toolName);
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
}

function extractFilename(input: any): string {
  try {
    let obj: any = input;
    if (typeof input === 'string') {
      if (!input || !input.startsWith('{')) return '';
      obj = JSON.parse(input);
    }
    if (!obj || typeof obj !== 'object') return '';
    const fp = obj.file_path ?? obj.path ?? '';
    if (!fp) return '';
    return String(fp).split('/').pop() || '';
  } catch {
    return '';
  }
}

function extractBashCommand(input: any): string {
  try {
    let obj: any = input;
    if (typeof input === 'string') {
      if (!input || !input.startsWith('{')) return String(input ?? '').slice(0, 80);
      obj = JSON.parse(input);
    }
    return String(obj?.command ?? '').trim().slice(0, 120);
  } catch {
    return '';
  }
}

function isBashFailure(tc: ToolCallInfo): boolean {
  const r = (tc.toolResult ?? '').toLowerCase();
  if (!r) return false;
  return /\berror\b|\bfailed\b|not found|cannot|fatal|command not found|no such file/.test(r);
}

function firstErrorLine(tc: ToolCallInfo): string {
  const r = tc.toolResult ?? '';
  const line = r.split('\n').find(l => /error|failed|not found|cannot|fatal/i.test(l));
  return (line ?? r.split('\n')[0] ?? '').trim().slice(0, 80);
}

function isSystemReminder(text: string): boolean {
  return text.includes('<system-reminder>') || text.includes('system-reminder');
}

function hasRealContent(text: string): boolean {
  return /[a-zA-Z]{4,}/.test(text ?? '');
}

function filterRealMissing(missingCtx: any[]): any[] {
  return (missingCtx ?? []).filter((mc: any) => hasRealContent(mc?.content ?? ''));
}

function formatToolSummary(toolCalls: ToolCallInfo[]): string {
  const counts = countsByTool(toolCalls);
  return [...counts.entries()].map(([n, c]) => `${n}×${c}`).join(', ');
}

export function DetailView({ call, prevCall, isSimilarToPrev, width }: Props) {
  const toolCalls: ToolCallInfo[] = safeJsonParse(call.tool_calls, []);
  const missingCtx: any[] = safeJsonParse(call.missing_context ?? 'null', []) ?? [];
  const breakdown: any = safeJsonParse(call.system_breakdown ?? 'null', null);

  let reqBody: any = {};
  try { reqBody = JSON.parse(call.request_body ?? '{}'); } catch {}
  const messages = reqBody.messages ?? [];
  const userMsg = messages.filter((m: any) => m.role === 'user').pop();
  const userMsgText = typeof userMsg?.content === 'string'
    ? userMsg.content
    : Array.isArray(userMsg?.content)
      ? userMsg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      : '';

  const totalIn = call.token_count_input + (call.token_count_cache_read ?? 0);
  const skillsRaw: { name: string; tokens: number }[] = breakdown?.skills ?? [];
  const skillsSorted = [...skillsRaw].sort((a, b) => b.tokens - a.tokens);
  const sysTokens = breakdown?.baseClaude?.tokens ?? 0;
  const skillsTotal = skillsSorted.reduce((s, sk) => s + sk.tokens, 0);
  const convTokens = Math.max(0, totalIn - sysTokens - skillsTotal);
  const toolGroups = groupToolCalls(toolCalls);
  const idx = circledNumber(call.call_index);

  // ─── View mode (delta ↔ full) ───
  const canDelta = !!prevCall && !!isSimilarToPrev;
  const [viewMode, setViewMode] = useState<'delta' | 'full'>('full');

  // ─── Section expand/collapse state (for full view) ───
  // Default: all sections expanded except the raw_* ones.
  const realMissing = filterRealMissing(missingCtx);
  const initialExpanded: SectionKey[] = SECTION_ORDER.filter(
    s => !FORCE_COLLAPSED.includes(s),
  );
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(initialExpanded));
  const [sectionCursor, setSectionCursor] = useState(0);

  useInput((_input, key) => {
    if (key.tab && prevCall) {
      setViewMode(m => m === 'delta' ? 'full' : 'delta');
      return;
    }
    if (viewMode !== 'full') return;
    if (key.upArrow) setSectionCursor(c => Math.max(0, c - 1));
    else if (key.downArrow) setSectionCursor(c => Math.min(SECTION_ORDER.length - 1, c + 1));
    else if (key.rightArrow || key.return) {
      const sec = SECTION_ORDER[sectionCursor];
      if (FORCE_COLLAPSED.includes(sec)) return;
      setExpandedSections(prev => {
        const next = new Set(prev);
        next.add(sec);
        return next;
      });
    } else if (key.leftArrow) {
      const sec = SECTION_ORDER[sectionCursor];
      setExpandedSections(prev => {
        const next = new Set(prev);
        next.delete(sec);
        return next;
      });
    }
  });

  // ─── Bash loop detection ───
  const bashCalls = toolCalls.filter(tc => normalizeToolName(tc.toolName) === 'Bash');
  const bashByCmd = new Map<string, { calls: ToolCallInfo[]; failures: number }>();
  for (const b of bashCalls) {
    const cmd = extractBashCommand(b.toolInput ?? '');
    if (!cmd) continue;
    if (!bashByCmd.has(cmd)) bashByCmd.set(cmd, { calls: [], failures: 0 });
    const e = bashByCmd.get(cmd)!;
    e.calls.push(b);
    if (isBashFailure(b)) e.failures++;
  }
  // Consecutive-failure streak per command (longest)
  const bashStreaks = new Map<string, number>();
  {
    let curCmd = '';
    let curStreak = 0;
    for (const b of bashCalls) {
      const cmd = extractBashCommand(b.toolInput ?? '');
      if (cmd === curCmd && isBashFailure(b)) {
        curStreak++;
      } else {
        curStreak = isBashFailure(b) ? 1 : 0;
        curCmd = cmd;
      }
      const prev = bashStreaks.get(cmd) ?? 0;
      if (curStreak > prev) bashStreaks.set(cmd, curStreak);
    }
  }
  const bashLoop = [...bashStreaks.entries()].find(([_, s]) => s > 2);

  // ─── DELTA VIEW ───
  function renderDelta(): React.ReactNode {
    const prev = prevCall!;
    const prevTools: ToolCallInfo[] = safeJsonParse(prev.tool_calls, []);
    const curCounts = countsByTool(toolCalls);
    const prevCounts = countsByTool(prevTools);

    const allTools = new Set([...curCounts.keys(), ...prevCounts.keys()]);
    const toolDiffs: { name: string; delta: number; cur: number }[] = [];
    for (const name of allTools) {
      const cur = curCounts.get(name) ?? 0;
      const p = prevCounts.get(name) ?? 0;
      if (cur !== p) toolDiffs.push({ name, delta: cur - p, cur });
    }

    const prevTotalIn = prev.token_count_input + (prev.token_count_cache_read ?? 0);
    const tokDelta = totalIn - prevTotalIn;
    const costDelta = call.estimated_cost_usd - prev.estimated_cost_usd;

    let prevTurns = 0;
    try { prevTurns = (JSON.parse(prev.request_body ?? '{}').messages ?? []).length; } catch {}
    const turnDelta = messages.length - prevTurns;

    const curFiles = new Set(
      toolCalls
        .filter(tc => ['Read', 'Edit', 'Write'].includes(normalizeToolName(tc.toolName)))
        .map(tc => extractFilename(tc.toolInput ?? ''))
        .filter(Boolean)
    );
    const prevFiles = new Set(
      prevTools
        .filter(tc => ['Read', 'Edit', 'Write'].includes(normalizeToolName(tc.toolName)))
        .map(tc => extractFilename(tc.toolInput ?? ''))
        .filter(Boolean)
    );
    const sameFiles = [...curFiles].filter(f => prevFiles.has(f));

    const toolPatternSame = (() => {
      if (curCounts.size !== prevCounts.size) return false;
      for (const [k] of curCounts) if (!prevCounts.has(k)) return false;
      return true;
    })();

    return (
      <Box flexDirection="column" width={width}>
        <Text color="#e62050">  call {idx}  user → {formatToolSummary(toolCalls)}</Text>
        <Text> </Text>

        <Text color="#e62050" bold>  WHAT CHANGED</Text>
        {toolDiffs.length === 0 && tokDelta === 0 && costDelta === 0 && turnDelta === 0 && (
          <Text color="#505050">    (nothing changed from previous call)</Text>
        )}
        {toolDiffs.map(d => {
          const sign = d.delta > 0 ? '+' : '−';
          const abs = Math.abs(d.delta);
          const wasVal = d.cur - d.delta;
          return (
            <Text key={d.name} color="#e62050">
              {'    '}{sign} {d.name}×{abs} {d.delta > 0 ? 'added' : 'removed'}   ({d.cur} total, was {wasVal})
            </Text>
          );
        })}
        {tokDelta !== 0 && (
          <Text color="#e62050">
            {'    '}{tokDelta > 0 ? '+' : '−'} {formatTokens(Math.abs(tokDelta))} tok {tokDelta > 0 ? 'added' : 'removed'}   ({formatTokens(totalIn)} total)
          </Text>
        )}
        {costDelta !== 0 && (
          <Text color="#e62050">
            {'    '}{costDelta > 0 ? '+' : '−'} {formatCost(Math.abs(costDelta))} {costDelta > 0 ? 'added' : 'removed'}   ({formatCost(call.estimated_cost_usd)} total)
          </Text>
        )}
        {turnDelta !== 0 && (
          <Text color="#e62050">
            {'    '}{turnDelta > 0 ? '+' : '−'} {Math.abs(turnDelta)} more turns   ({messages.length} turns total)
          </Text>
        )}

        <Text> </Text>
        <Text color="#e62050" bold>  UNCHANGED</Text>
        {toolPatternSame && (
          <Text color="#A0A0A0">    Same tool pattern as previous call</Text>
        )}
        {sameFiles.length > 0 && (
          <Text color="#A0A0A0">    Same files: {sameFiles.slice(0, 4).join(' · ')}{sameFiles.length > 4 ? ` · +${sameFiles.length - 4} more` : ''}</Text>
        )}
        {!toolPatternSame && sameFiles.length === 0 && (
          <Text color="#505050">    (nothing notably unchanged)</Text>
        )}

        {bashLoop && (
          <>
            <Text> </Text>
            <Text color="#e62050" bold>  ⚠ BASH LOOP: {bashLoop[0]} failed {bashLoop[1]} times in a row</Text>
          </>
        )}

        <Text> </Text>
        <Text color="#505050">  [tab] for full detail view</Text>
      </Box>
    );
  }

  // ─── FULL VIEW (section renderer) ───
  function renderSectionContent(section: SectionKey): React.ReactNode {
    switch (section) {
      case 'changed': {
        if (!prevCall) {
          return <Text color="#505050">    (no previous call to diff against)</Text>;
        }
        const prev = prevCall;
        const prevTools: ToolCallInfo[] = safeJsonParse(prev.tool_calls, []);
        const curCounts = countsByTool(toolCalls);
        const prevCounts = countsByTool(prevTools);
        const allTools = new Set([...curCounts.keys(), ...prevCounts.keys()]);
        const toolDiffs: { name: string; delta: number; cur: number }[] = [];
        for (const name of allTools) {
          const cur = curCounts.get(name) ?? 0;
          const p = prevCounts.get(name) ?? 0;
          if (cur !== p) toolDiffs.push({ name, delta: cur - p, cur });
        }
        const prevTotalIn = prev.token_count_input + (prev.token_count_cache_read ?? 0);
        const tokDelta = totalIn - prevTotalIn;
        const costDelta = call.estimated_cost_usd - prev.estimated_cost_usd;
        let prevTurns = 0;
        try { prevTurns = (JSON.parse(prev.request_body ?? '{}').messages ?? []).length; } catch {}
        const turnDelta = messages.length - prevTurns;
        const nothing = toolDiffs.length === 0 && tokDelta === 0 && costDelta === 0 && turnDelta === 0;
        if (nothing) {
          return <Text color="#505050">    (nothing changed from previous call)</Text>;
        }
        return (
          <Box flexDirection="column">
            {toolDiffs.map(d => {
              const sign = d.delta > 0 ? '+' : '−';
              const abs = Math.abs(d.delta);
              const wasVal = d.cur - d.delta;
              return (
                <Text key={d.name} color="#e62050">
                  {'    '}{sign} {d.name}×{abs} {d.delta > 0 ? 'added' : 'removed'}   ({d.cur} total, was {wasVal})
                </Text>
              );
            })}
            {tokDelta !== 0 && (
              <Text color="#e62050">
                {'    '}{tokDelta > 0 ? '+' : '−'} {formatTokens(Math.abs(tokDelta))} tok {tokDelta > 0 ? 'added' : 'removed'}   ({formatTokens(totalIn)} total)
              </Text>
            )}
            {costDelta !== 0 && (
              <Text color="#e62050">
                {'    '}{costDelta > 0 ? '+' : '−'} {formatCost(Math.abs(costDelta))} {costDelta > 0 ? 'added' : 'removed'}   ({formatCost(call.estimated_cost_usd)} total)
              </Text>
            )}
            {turnDelta !== 0 && (
              <Text color="#e62050">
                {'    '}{turnDelta > 0 ? '+' : '−'} {Math.abs(turnDelta)} more turns   ({messages.length} turns total)
              </Text>
            )}
          </Box>
        );
      }
      case 'stats':
        return (
          <Box flexDirection="column">
            <Text color="#A0A0A0">    status    {call.status}</Text>
            <Text color="#A0A0A0">    latency   {formatLatency(call.latency_ms)}</Text>
            <Text color="#A0A0A0">    tokens    {formatTokens(totalIn)} in / {formatTokens(call.token_count_output)} out</Text>
            <Text color="#A0A0A0">    cost      {formatCost(call.estimated_cost_usd)}</Text>
            <Text color="#A0A0A0">    model     {call.model}</Text>
            {convTokens > 0 && convTokens / Math.max(1, totalIn) > 0.5 && (
              <Text color="#e62050">    ⚠ {formatTokens(convTokens)} is conversation history ({messages.length} turns)</Text>
            )}
          </Box>
        );
      case 'read':
        if (toolCalls.length === 0) return <Text color="#505050">    (no tool calls)</Text>;
        return (
          <Box flexDirection="column">
            {[...toolGroups.entries()].slice(0, 8).map(([name, calls]) => {
              const names = calls.map(tc => extractFilename(tc.toolInput ?? '')).filter(Boolean);
              const shown = names.slice(0, 2);
              const extra = names.length - shown.length;
              const suffix = shown.length > 0
                ? `  ${shown.join(' · ')}${extra > 0 ? ` · +${extra} more` : ''}`
                : '';
              return (
                <Text key={name} color="#A0A0A0">    {name.padEnd(8)} ×{calls.length}{suffix}</Text>
              );
            })}
          </Box>
        );
      case 'thinking':
        if (!call.thinking) {
          return (
            <Box flexDirection="column">
              <Text color="#505050">    extended thinking not enabled</Text>
            </Box>
          );
        }
        return (
          <Box flexDirection="column">
            {call.thinking.split('\n').slice(0, 10).map((line, i) => (
              <Text key={i} color="#A0A0A0">    {line.slice(0, 80)}</Text>
            ))}
          </Box>
        );
      case 'given':
        if (!breakdown) return <Text color="#505050">    (no system breakdown)</Text>;
        return (
          <Box flexDirection="column">
            <Text color="#A0A0A0">    system   {String(formatTokens(sysTokens)).padEnd(8)} {totalIn > 0 ? Math.round((sysTokens / totalIn) * 100) : 0}%</Text>
            {skillsSorted.slice(0, 8).map(sk => {
              const pct = sysTokens > 0 ? sk.tokens / sysTokens : 0;
              const n = Math.max(0, Math.min(20, Math.round(pct * 20)));
              const filled = '▓'.repeat(n);
              const empty = '░'.repeat(20 - n);
              return (
                <Text key={sk.name} color="#A0A0A0">{'    \x1b[0m' + filled + empty + '  ' + sk.name.padEnd(16) + ' ' + formatTokens(sk.tokens)}</Text>
              );
            })}
            {skillsSorted.length > 8 && (
              <Text color="#505050">    +{skillsSorted.length - 8} more skills</Text>
            )}
            <Text color="#A0A0A0">    conv     {formatTokens(convTokens)}  ({messages.length} turns)</Text>
          </Box>
        );
      case 'sent':
        if (!userMsgText) return <Text color="#505050">    (no user message)</Text>;
        if (isSystemReminder(userMsgText)) {
          return (
            <Box flexDirection="column">
              <Text color="#e62050">    system-reminder (injected)</Text>
              <Text color="#A0A0A0">    "{userMsgText.replace(/\n/g, ' ').slice(0, 80)}"</Text>
            </Box>
          );
        }
        return <Text color="#A0A0A0">    "{userMsgText.slice(0, 200)}"</Text>;
      case 'missing': {
        const real = filterRealMissing(missingCtx);
        if (real.length === 0) return <Text color="#505050">    none</Text>;
        return (
          <Box flexDirection="column">
            {real.slice(0, 5).map((mc: any, i: number) => (
              <Text key={i} color="#e62050">    △ "{(mc.content ?? '').replace(/\n/g, ' ').slice(0, 60)}"</Text>
            ))}
          </Box>
        );
      }
      case 'decision':
        if (toolCalls.length === 0) return <Text color="#505050">    (no tool calls)</Text>;
        return (
          <Box flexDirection="column">
            {bashLoop && (
              <Text color="#e62050" bold>    ⚠ BASH LOOP: {bashLoop[0]} failed {bashLoop[1]} times in a row</Text>
            )}
            {[...toolGroups.entries()].map(([name, tcs]) => {
              if (name !== 'Bash') {
                return <Text key={name} color="#A0A0A0">    {name.padEnd(10)} ×{tcs.length}</Text>;
              }
              // Bash: break down by command
              const byCmd = new Map<string, { n: number; fails: number; firstErr: string }>();
              for (const b of tcs) {
                const cmd = extractBashCommand(b.toolInput ?? '') || '(no command)';
                if (!byCmd.has(cmd)) byCmd.set(cmd, { n: 0, fails: 0, firstErr: '' });
                const e = byCmd.get(cmd)!;
                e.n++;
                if (isBashFailure(b)) {
                  e.fails++;
                  if (!e.firstErr) e.firstErr = firstErrorLine(b);
                }
              }
              return (
                <Box key={name} flexDirection="column">
                  <Text color="#A0A0A0">    {name.padEnd(10)} ×{tcs.length}</Text>
                  {[...byCmd.entries()].map(([cmd, info], ci) => {
                    const allFailed = info.n > 1 && info.fails === info.n;
                    const multi = info.n > 1;
                    const cmdShort = cmd.length > 48 ? cmd.slice(0, 45) + '…' : cmd;
                    return (
                      <Box key={ci} flexDirection="column">
                        <Text color={allFailed ? '#e62050' : '#808080'}>
                          {'            '}{cmdShort}  ×{info.n}{info.fails > 0 ? `  (${info.fails} err)` : ''}
                        </Text>
                        {multi && allFailed && (
                          <Text color="#e62050">{'            '}⚠ ran {info.n} times · all returned errors</Text>
                        )}
                        {info.firstErr && allFailed && (
                          <Text color="#e62050">{'            '}first error: "{info.firstErr}"</Text>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        );
    }
  }

  // ─── Render ───
  if (viewMode === 'delta' && prevCall) {
    return renderDelta();
  }

  // ── Section summary (collapsed view) ──
  function summarizeFor(sec: SectionKey): string {
    switch (sec) {
      case 'changed':
        return prevCall ? 'vs previous call' : '(no previous call)';
      case 'stats':
        return `${call.status} · ${formatLatency(call.latency_ms)} · ${formatTokens(totalIn)} · ${formatCost(call.estimated_cost_usd)}`;
      case 'read':
        return toolCalls.length === 0
          ? '(no tool calls)'
          : [...toolGroups.entries()].slice(0, 4).map(([n, c]) => `${n}×${c.length}`).join(' · ');
      case 'thinking':
        return call.thinking ? `${call.thinking.split('\n').length} lines` : 'not enabled';
      case 'given':
        return breakdown
          ? `${formatTokens(sysTokens)} sys · ${skillsSorted.length} skills · ${formatTokens(convTokens)} conv`
          : '(no breakdown)';
      case 'sent':
        if (!userMsgText) return '(no user message — tool result)';
        if (isSystemReminder(userMsgText)) return 'system-reminder injected';
        return `"${userMsgText.replace(/\n/g, ' ').slice(0, 50)}…"`;
      case 'missing':
        return realMissing.length > 0 ? `⚠ ${realMissing.length} instructions lost` : 'none';
      case 'decision':
        return toolCalls.length === 0
          ? '(no tool calls)'
          : [...toolGroups.entries()].slice(0, 4).map(([n, c]) => `${n}×${c.length}`).join(' · ');
    }
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text color="#e62050">  call {idx}  {call.summary}</Text>
      <Text> </Text>
      {SECTION_ORDER.map((sec, i) => {
        // Force-collapsed sections can NEVER expand.
        const forceCollapsed = FORCE_COLLAPSED.includes(sec);
        const isExpanded = !forceCollapsed && expandedSections.has(sec);
        const isCursor = i === sectionCursor;
        const arrow = isExpanded ? '▼' : '►';
        const isMissingWithContent = sec === 'missing' && realMissing.length > 0;
        const headerColor = isMissingWithContent || isCursor ? '#e62050' : '#707070';

        return (
          <Box key={sec} flexDirection="column">
            <Text color={headerColor} bold={isCursor}>
              {isCursor ? '►' : ' '} {arrow} {SECTION_LABELS[sec]}
              {!isExpanded && <Text color="#505050">   {summarizeFor(sec)}</Text>}
            </Text>
            {isExpanded && (
              <Box flexDirection="column" marginBottom={1}>
                {renderSectionContent(sec)}
              </Box>
            )}
          </Box>
        );
      })}
      <Text> </Text>
      <Text color="#505050">
        ↑↓ section · → expand · ← collapse{prevCall ? ' · tab delta' : ''}
      </Text>
    </Box>
  );
}
