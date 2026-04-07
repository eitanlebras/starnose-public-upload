import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CallData } from './types.js';
import { DetailView } from './DetailView.js';
import {
  formatTokens, formatCost, formatDuration,
  circledNumber,
} from '../../format.js';

interface Props {
  calls: CallData[];
  selectedIndex: number;
  setSelectedIndex: (idx: number) => void;
  sessionKey: string;
  width: number;
}

const CONTEXT_LIMIT = 200_000;
const BAR_WIDTH = 20;
const HEADER_BAR_WIDTH = 10;

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

const TOOL_NAME_MAP: Record<string, string> = {
  read_file: 'Read', view: 'Read', cat: 'Read',
  bash: 'Bash', run_command: 'Bash',
  edit_file: 'Edit', str_replace: 'Edit', MultiEdit: 'Edit',
  write_file: 'Write', create_file: 'Write',
  glob: 'Glob', grep: 'Grep', search: 'Grep',
};
const norm = (n: string) => TOOL_NAME_MAP[n] ?? n;

function normCounts(toolCalls: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of toolCalls || []) {
    const n = norm(t.toolName ?? '');
    if (!n) continue;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
}

// Similar = same set of tool names, all counts within 20% of each other.
function similar(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  if (a.size !== b.size) return false;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (vb === undefined) return false;
    const hi = Math.max(va, vb);
    const lo = Math.min(va, vb);
    if (hi === 0) continue;
    if ((hi - lo) / hi > 0.2) return false;
  }
  return true;
}

function summarizeTools(toolCalls: any[]): string {
  if (!toolCalls.length) return '';
  const counts = new Map<string, number>();
  for (const t of toolCalls) {
    const n = norm(t.toolName ?? '');
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const entries = [...counts.entries()].map(([n, c]) => c > 1 ? `${n}×${c}` : n);
  const full = entries.join(', ');
  if (full.length <= 60) return full;
  let out: string[] = [];
  let len = 0;
  for (let i = 0; i < entries.length; i++) {
    const add = (i === 0 ? 0 : 2) + entries[i].length;
    const suffix = ` +${entries.length - i} more`;
    if (len + add + suffix.length > 60) {
      return out.join(', ') + ` +${entries.length - out.length} more`;
    }
    out.push(entries[i]);
    len += add;
  }
  return full;
}

function makeBar(filled: number, width: number): { fill: string; empty: string } {
  const f = Math.max(0, Math.min(width, filled));
  return { fill: '█'.repeat(f), empty: '░'.repeat(width - f) };
}

function makeShadeBar(filled: number, width: number): { fill: string; empty: string } {
  const f = Math.max(0, Math.min(width, filled));
  return { fill: '▓'.repeat(f), empty: '░'.repeat(width - f) };
}

function barColor(pct: number): string {
  if (pct >= 0.8) return '#e62050';
  if (pct >= 0.6) return '#B8A060';
  return '#F0F0F0';
}

function computeCostBreakdown(calls: CallData[]) {
  const totalCost = calls.reduce((s, c) => s + c.estimated_cost_usd, 0);
  const totalTokens = calls.reduce((s, c) => s + c.token_count_input + (c.token_count_cache_read ?? 0) + c.token_count_output, 0);
  const ppt = totalTokens > 0 ? totalCost / totalTokens : 0;
  let skillTok = 0, ctxTok = 0;
  for (const c of calls) {
    const bd: any = safeJsonParse(c.system_breakdown, null);
    const totalIn = c.token_count_input + (c.token_count_cache_read ?? 0);
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
  return { skillCost, contextCost, workCost, totalCost };
}

// ─── Grouping ───
type Group = { id: number; start: number; end: number };

function computeGroups(calls: CallData[], metas: { counts: Map<string, number>; compaction: boolean }[]): (Group | null)[] {
  const byCall: (Group | null)[] = new Array(calls.length).fill(null);
  let i = 0;
  let gid = 0;
  while (i < calls.length) {
    let j = i;
    while (
      j + 1 < calls.length &&
      !metas[j].compaction &&
      !metas[j + 1].compaction &&
      similar(metas[j].counts, metas[j + 1].counts)
    ) {
      j++;
    }
    if (j - i + 1 >= 3) {
      const g: Group = { id: gid++, start: i, end: j };
      for (let k = i; k <= j; k++) byCall[k] = g;
    }
    i = j + 1;
  }
  return byCall;
}

type Row =
  | { kind: 'call'; callIdx: number }
  | { kind: 'collapsed'; group: Group };

function buildRows(calls: CallData[], callGroup: (Group | null)[], expanded: Set<number>): Row[] {
  const rs: Row[] = [];
  for (let i = 0; i < calls.length; i++) {
    const g = callGroup[i];
    if (!g || expanded.has(g.id)) {
      rs.push({ kind: 'call', callIdx: i });
      continue;
    }
    if (i === g.start) rs.push({ kind: 'call', callIdx: i });
    else if (i === g.start + 1) rs.push({ kind: 'collapsed', group: g });
    else if (i === g.end) rs.push({ kind: 'call', callIdx: i });
    // else skip — hidden interior call
  }
  return rs;
}

export function TreeView({ calls, selectedIndex: _parentSel, setSelectedIndex, sessionKey: _sessionKey, width }: Props) {
  const termWidth = process.stdout.columns ?? width ?? 100;
  const termHeight = process.stdout.rows ?? 40;
  const leftWidth = Math.max(40, Math.floor(termWidth * 0.38));
  const rightWidth = Math.max(20, termWidth - leftWidth - 3);
  const hr = '─'.repeat(Math.max(10, leftWidth - 2));

  const metas = calls.map(c => ({
    counts: normCounts(safeJsonParse(c.tool_calls, [])),
    compaction: !!c.compaction_detected,
  }));
  const callGroup = computeGroups(calls, metas);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [rowIndex, setRowIndex] = useState(0);

  const rows = buildRows(calls, callGroup, expanded);
  const safeRowIndex = Math.min(rowIndex, Math.max(0, rows.length - 1));

  useInput((_input, key) => {
    if (key.upArrow) setRowIndex(Math.max(0, safeRowIndex - 1));
    else if (key.downArrow) setRowIndex(Math.min(rows.length - 1, safeRowIndex + 1));
    else if (key.rightArrow) {
      const row = rows[safeRowIndex];
      if (row?.kind === 'collapsed') {
        const next = new Set(expanded);
        next.add(row.group.id);
        const newRows = buildRows(calls, callGroup, next);
        const target = newRows.findIndex(r => r.kind === 'call' && r.callIdx === row.group.start + 1);
        setExpanded(next);
        if (target >= 0) setRowIndex(target);
      }
    } else if (key.leftArrow) {
      const row = rows[safeRowIndex];
      if (row?.kind === 'call') {
        const g = callGroup[row.callIdx];
        if (g && expanded.has(g.id)) {
          const next = new Set(expanded);
          next.delete(g.id);
          const newRows = buildRows(calls, callGroup, next);
          // Land on the collapsed summary row
          const target = newRows.findIndex(r => r.kind === 'collapsed' && r.group.id === g.id);
          setExpanded(next);
          if (target >= 0) setRowIndex(target);
        }
      }
    }
  });

  // Keep parent vaguely in sync so DetailView-related state outside stays coherent
  const currentRow = rows[safeRowIndex];
  const currentCallIdx =
    currentRow?.kind === 'call' ? currentRow.callIdx :
    currentRow?.kind === 'collapsed' ? currentRow.group.start :
    0;
  React.useEffect(() => { setSelectedIndex(currentCallIdx); }, [currentCallIdx]);

  const totalLatency = calls.reduce((s, c) => s + c.latency_ms, 0);
  const totalTokens = calls.reduce((s, c) => s + c.token_count_input + (c.token_count_cache_read ?? 0) + c.token_count_output, 0);

  const bd = computeCostBreakdown(calls);
  const skillPct = bd.totalCost > 0 ? bd.skillCost / bd.totalCost : 0;
  const histPct = bd.totalCost > 0 ? bd.contextCost / bd.totalCost : 0;
  const workPct = bd.totalCost > 0 ? bd.workCost / bd.totalCost : 0;
  const skillBar = makeShadeBar(Math.round(skillPct * HEADER_BAR_WIDTH), HEADER_BAR_WIDTH);
  const histBar = makeShadeBar(Math.round(histPct * HEADER_BAR_WIDTH), HEADER_BAR_WIDTH);
  const workBar = makeShadeBar(Math.round(workPct * HEADER_BAR_WIDTH), HEADER_BAR_WIDTH);

  const selectedCall = calls[currentCallIdx];
  const prevCall = currentCallIdx > 0 ? calls[currentCallIdx - 1] : undefined;
  const isSimilarToPrev =
    prevCall ? similar(metas[currentCallIdx].counts, metas[currentCallIdx - 1].counts) : false;

  function renderCollapsedRow(g: Group, isSelected: boolean): React.ReactNode {
    const members = calls.slice(g.start, g.end + 1);
    const totalCost = members.reduce((s, c) => s + c.estimated_cost_usd, 0);
    const lo = calls[g.start].call_index;
    const hi = calls[g.end].call_index;
    const summary = `similar calls (${lo}-${hi}) · ${members.length} calls · ${formatCost(totalCost)}`;
    const line = summary.length > leftWidth - 4 ? summary.slice(0, leftWidth - 5) + '…' : summary;
    const color = isSelected ? '#e62050' : '#808080';

    return (
      <Box key={`g-${g.id}`}>
        <Text color={color}> · {line}</Text>
      </Box>
    );
  }

  const headerRows = 10;
  const footerRows = 4;
  const listRows = Math.max(6, termHeight - headerRows - footerRows);
  const start = Math.max(0, Math.min(safeRowIndex - Math.floor(listRows / 2), Math.max(0, rows.length - listRows)));
  const end = Math.min(rows.length, start + listRows);
  const visibleRows = rows.slice(start, end);

  return (
    <Box flexDirection="row">
      {/* ═══ LEFT PANE ═══ */}
      <Box flexDirection="column" width={leftWidth}>
      {/* HEADER */}
      <Box flexDirection="column" paddingX={1}>
        <Text color="#505050">{hr}</Text>
        <Text color="#505050">
          {calls.length} calls · {formatTokens(totalTokens)} · {formatCost(bd.totalCost)} · {formatDuration(totalLatency)} · {calls.length > 0 && calls[calls.length - 1].status === 'error' ? '✗ failed' : '✓ done'}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color="#A0A0A0">  skill    </Text>
            <Text color="#e62050">{skillBar.fill}</Text>
            <Text color="#2A2A2A">{skillBar.empty}</Text>
            <Text color="#A0A0A0">  {formatCost(bd.skillCost).padEnd(7)}</Text>
            <Text color="#505050">{String(Math.round(skillPct * 100)).padStart(3)}%</Text>
          </Text>
          <Text>
            <Text color="#A0A0A0">  history  </Text>
            <Text color="#e62050">{histBar.fill}</Text>
            <Text color="#2A2A2A">{histBar.empty}</Text>
            <Text color="#A0A0A0">  {formatCost(bd.contextCost).padEnd(7)}</Text>
            <Text color="#505050">{String(Math.round(histPct * 100)).padStart(3)}%</Text>
          </Text>
          <Text>
            <Text color="#A0A0A0">  work     </Text>
            <Text color="#F0F0F0">{workBar.fill}</Text>
            <Text color="#2A2A2A">{workBar.empty}</Text>
            <Text color="#A0A0A0">  {formatCost(bd.workCost).padEnd(7)}</Text>
            <Text color="#505050">{String(Math.round(workPct * 100)).padStart(3)}%</Text>
          </Text>
        </Box>
        {bd.totalCost > 0 && workPct < 0.10 && (
          <Text color="#e62050">  ⚠ you paid {formatCost(bd.totalCost)} for {formatCost(bd.workCost)} of actual work</Text>
        )}
        <Text color="#505050">{hr}</Text>
      </Box>

      {/* ROWS */}
      <Box flexDirection="column" marginTop={1}>
        {visibleRows.map((row, localIdx) => {
          const rIdx = start + localIdx;
          const isSelected = rIdx === safeRowIndex;

          if (row.kind === 'collapsed') {
            return renderCollapsedRow(row.group, isSelected);
          }

          const i = row.callIdx;
          const call = calls[i];
          const idx = circledNumber(call.call_index);
          const totalIn = call.token_count_input + (call.token_count_cache_read ?? 0);
          const ctxPct = Math.min(1, totalIn / CONTEXT_LIMIT);

          const toolCalls: any[] = safeJsonParse(call.tool_calls, []);
          const isCompaction = !!call.compaction_detected;
          const isFailed = call.status === 'error';

          const SMALL_BAR = 6;
          const smallFilled = Math.round(ctxPct * SMALL_BAR);
          const smallBar = makeBar(smallFilled, SMALL_BAR);
          const pctStr = `${String(Math.round(ctxPct * 100)).padStart(3)}%`;

          if (isCompaction) {
            const before = call.tokens_before_compaction ?? 0;
            const after = totalIn;
            const lost = Math.max(0, before - after);
            const label = `⚡ ${formatTokens(before)}→${formatTokens(after)} lost ${formatTokens(lost)}`;
            return (
              <Box key={call.id}>
                <Text color="#e62050"> {isSelected ? '►' : ' '} {label.slice(0, leftWidth - 6)}</Text>
              </Box>
            );
          }

          const toolSummary = summarizeTools(toolCalls);
          const summary = toolSummary
            ? `${isFailed ? '✗ ' : ''}user → ${toolSummary}`
            : `${isFailed ? '✗ ' : ''}${call.summary}`;

          const cursor = isSelected ? '►' : ' ';
          const rightMetricsWidth = SMALL_BAR + 2 + 4;
          const summaryWidth = Math.max(4, leftWidth - 4 - rightMetricsWidth);
          const inGroupExpanded = callGroup[i] && expanded.has(callGroup[i]!.id);
          const prefix = inGroupExpanded ? '· ' : '';
          const summaryText = `${prefix}${idx} ${summary}`;
          const clippedSummary = summaryText.length > summaryWidth
            ? summaryText.slice(0, summaryWidth - 1) + '…'
            : summaryText.padEnd(summaryWidth);

          const bg = isSelected ? '#e62050' : undefined;
          const fg = isSelected ? '#0F0F0F' : (isFailed ? '#e62050' : '#F0F0F0');
          const dimFg = isSelected ? '#0F0F0F' : '#505050';
          const fillColor = ctxPct >= 0.8 ? '#e62050' : '#FFFFFF';

          return (
            <Box key={call.id}>
              <Box>
                <Text backgroundColor={bg} color={fg}> {cursor} {clippedSummary} </Text>
                <Text backgroundColor={bg} color={fillColor}>{smallBar.fill}</Text>
                <Text backgroundColor={bg} color={dimFg}>{smallBar.empty}</Text>
                <Text backgroundColor={bg} color={dimFg}> {pctStr}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* FOOTER */}
      <Box marginTop={1} flexDirection="column" paddingX={1}>
        <Text color="#505050">{hr}</Text>
        <Text color="#505050">  total: {formatDuration(totalLatency)}  ·  {formatCost(bd.totalCost)}</Text>
        <Text color="#e62050">  SESSIONS HUB: press s</Text>
        <Text color="#505050">  / search · ↑↓ nav · →← group · tab delta · f flame · q quit</Text>
      </Box>
      </Box>

      {/* ═══ VERTICAL DIVIDER ═══ */}
      <Box flexDirection="column" marginLeft={1} marginRight={1}>
        {Array.from({ length: Math.max(10, termHeight - 2) }).map((_, i) => (
          <Text key={i} color="#2A2A2A">│</Text>
        ))}
      </Box>

      {/* ═══ RIGHT PANE ═══ */}
      <Box flexDirection="column" width={rightWidth}>
        {selectedCall ? (
          <DetailView
            key={selectedCall.id}
            call={selectedCall}
            prevCall={prevCall}
            isSimilarToPrev={isSimilarToPrev}
            width={rightWidth}
          />
        ) : (
          <Text color="#505050">  (no call selected)</Text>
        )}
      </Box>
    </Box>
  );
}
