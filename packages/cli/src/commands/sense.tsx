import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import EventSource from 'eventsource';
import { fetchApi, isProxyRunning, getBaseUrl } from '../api.js';
import chalk from 'chalk';
import {
  formatTokens, formatCost, formatLatency, formatDuration,
  circledNumber, box,
} from '../format.js';
import { CallData } from './dig/types.js';
import { DetailView } from './dig/DetailView.js';

// ═══════════════════════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════════════════════

const C = {
  normal: '#F0F0F0',
  dim: '#505050',
  mauve: '#c4607a',
  secondary: '#A0A0A0',
};

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

/** Shape of call data from SSE call_completed events (camelCase) */
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
// PURE HELPERS — no side effects, no React
// ═══════════════════════════════════════════════════════════

function safeParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** Convert a CallData (snake_case from DB) to our normalized shape */
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
  };
}

function totalInputTokens(call: SSECall): number {
  return call.tokenInput + (call.tokenCacheRead ?? 0);
}

function isFullyCached(call: SSECall): boolean {
  return call.tokenInput === 0 && (call.tokenCacheRead ?? 0) > 0;
}

/** Build clean summary — pick first that applies */
function buildSummary(call: SSECall, allCalls: SSECall[]): string {
  if (call.compactionDetected) {
    const idx = allCalls.indexOf(call);
    const prev = idx > 0 ? allCalls[idx - 1] : null;
    const after = totalInputTokens(call);
    const before = prev ? totalInputTokens(prev) : 0;
    if (after > 1000 && before > 1000) {
      return `⚡ compaction: ${formatTokens(before)}→${formatTokens(after)}`;
    }
    return '⚡ compaction';
  }

  if (call.callIndex === 1 && call.toolCalls.length === 0) {
    return 'system prompt loaded';
  }

  if (call.toolCalls.length > 0) {
    return 'user → ' + summarizeTools(call.toolCalls);
  }

  return 'user → response';
}

/** "Bash, Glob, Read×12" — tool names deduped with counts, max 3 */
function summarizeTools(tools: ToolCallInfo[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) {
    const name = normalizeToolName(t.toolName);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const entries = [...counts.entries()].slice(0, 3);
  const parts = entries.map(([name, count]) => {
    // Check for Agent subagent_type
    if (name === 'Agent') {
      const agentTool = tools.find(t => normalizeToolName(t.toolName) === 'Agent');
      const subtype = extractAgentSubtype(agentTool?.toolInput);
      if (subtype) return `Agent(${subtype})`;
    }
    return count > 1 ? `${name}×${count}` : name;
  });

  return parts.join(', ');
}

function normalizeToolName(name: string): string {
  const map: Record<string, string> = {
    read_file: 'Read', view: 'Read', cat: 'Read',
    bash: 'Bash', run_command: 'Bash',
    glob: 'Glob', grep: 'Grep', search: 'Grep',
  };
  return map[name] ?? name;
}

function extractAgentSubtype(input?: string): string | null {
  if (!input) return null;
  // Try JSON parse first
  const val = extractFromJson(input, ['subagent_type']);
  if (val) return val;
  // Fallback to regex
  const m = input.match(/subagent_type['":\s]+(\w+)/);
  return m ? m[1] : null;
}

/** Extract just the filename from a toolInput (may be JSON or plain path) */
function extractFilename(input: string): string {
  // Try to parse as JSON first (e.g. {"file_path":"/foo/bar.ts"})
  const path = extractFromJson(input, ['file_path', 'path']) ?? input;
  const m = path.match(/([^/\\]+\.[a-z]+)/i);
  return m ? m[1] : 'file';
}

/** Extract a bash command from toolInput (may be JSON or plain string) */
function extractBashCommand(input: string): string {
  return extractFromJson(input, ['command', 'cmd']) ?? input.split('\n')[0];
}

/** Try to extract a field from JSON-encoded toolInput */
function extractFromJson(input: string, keys: string[]): string | null {
  if (!input.startsWith('{')) return null;
  try {
    const obj = JSON.parse(input);
    for (const key of keys) {
      if (typeof obj[key] === 'string') return obj[key];
    }
  } catch {}
  return null;
}

/** Summarize bash result to a short string — NEVER raw output */
function summarizeBashResult(result?: string): string {
  if (!result) return 'done';
  const lines = result.split('\n').filter(l => l.trim());
  if (lines.length === 0) return 'done';
  if (lines.length === 1) {
    const first = lines[0].trim();
    // Reject ls/find output, file trees, etc.
    if (/^[drwx-]{10}/.test(first)) return '1 item';
    if (first.startsWith('/') || first.startsWith('./')) return 'done';
    if (first.length <= 30 && !first.includes('\t')) return first;
    return 'done';
  }
  // Multiple lines — check for ls-style output
  if (lines.some(l => /^[drwx-]{10}/.test(l.trim()))) return `${lines.length} items`;
  return `${lines.length} lines`;
}

// ═══════════════════════════════════════════════════════════
// A. SESSION HEADER
// ═══════════════════════════════════════════════════════════

function SessionHeader({ sessionKey, title, width }: {
  sessionKey: string; title: string; width: number;
}) {
  const content = `── ${sessionKey}  "${truncate(title, 50)}"  `;
  const fill = '─'.repeat(Math.max(0, width - content.length));
  return <Text color={C.dim}>{content + fill}</Text>;
}

// ═══════════════════════════════════════════════════════════
// B. CALL PRIMARY LINE
// ═══════════════════════════════════════════════════════════

function CallPrimaryLine({ call, allCalls, cursor }: {
  call: SSECall; allCalls: SSECall[]; cursor?: boolean;
}) {
  const idx = circledNumber(call.callIndex).padStart(3);
  const lat = formatLatency(call.latencyMs).padStart(6);
  const cached = isFullyCached(call);
  const bothZero = call.tokenInput === 0 && (call.tokenCacheRead ?? 0) === 0;
  const tokStr = cached ? '⚡ cached' : bothZero ? 'cached' : formatTokens(totalInputTokens(call));
  const tok = tokStr.padStart(10);
  const costVal = cached ? '$0.00' : formatCost(call.cost);
  const cost = costVal.padStart(7);
  const summary = truncate(buildSummary(call, allCalls), 60);
  const isCompaction = call.compactionDetected;

  // Selected row: full mauve background, dark text
  if (cursor) {
    const line = `► ${idx}  ${lat}  ${tok}  ${cost}  ${isCompaction ? '⚡ ' : call.status === 'error' ? '✗ ' : ''}${summary}`;
    return <Text backgroundColor="#c4607a" color="#0F0F0F">{line}</Text>;
  }

  const prefix = '  ';

  if (isCompaction) {
    return (
      <Text>
        <Text>{prefix}</Text>
        <Text color={C.mauve}>{idx}  {lat}  {tok}  {cost}  {summary}</Text>
      </Text>
    );
  }

  if (call.status === 'error') {
    return (
      <Text>
        <Text>{prefix}</Text>
        <Text color={C.normal}>{idx}</Text>
        <Text color={C.dim}>  {lat}  {tok}  {cost}  </Text>
        <Text color={C.mauve}>✗ </Text>
        <Text color={C.dim}>{summary}</Text>
      </Text>
    );
  }

  return (
    <Text>
      <Text>{prefix}</Text>
      <Text color={C.normal}>{idx}</Text>
      <Text color={C.dim}>  {lat}  </Text>
      <Text color={bothZero ? C.dim : cached ? C.dim : C.normal}>{tok}</Text>
      <Text color={C.dim}>  {cost}  {summary}</Text>
    </Text>
  );
}

// ═══════════════════════════════════════════════════════════
// C. CALL SUBLINES (max 3 total per call)
// ═══════════════════════════════════════════════════════════

function CallSublines({ call, allCalls }: {
  call: SSECall; allCalls: SSECall[];
}) {
  const subs: React.ReactNode[] = [];
  const indent = '      ';
  let count = 0;

  // SKILLS — only on call ①
  if (call.callIndex === 1 && call.skillsDetected.length > 0 && count < 3) {
    const skills = call.skillsDetected;
    const shown = skills.slice(0, 3);
    const more = skills.length > 3 ? ` · +${skills.length - 3} more` : '';
    subs.push(
      <Text key="skills" color={C.dim}>{indent}skills: {shown.join(' · ')}{more}</Text>
    );
    count++;
  }

  // FILES — only when Read calls exist
  const reads = call.toolCalls.filter(t =>
    ['Read', 'read_file', 'view', 'cat'].includes(t.toolName)
  );
  if (reads.length > 0 && count < 3) {
    const allNames = [...new Set(reads.map(t => extractFilename(t.toolInput ?? '')))];
    const names = allNames.slice(0, 3);
    const remaining = reads.length - names.length;
    const more = remaining > 0 ? ` · +${remaining} more` : '';
    subs.push(
      <Text key="read" color={C.dim}>{indent}read: {names.join(' · ')}{more}</Text>
    );
    count++;
  }

  // BASH — one line total, command → brief result
  const bashes = call.toolCalls.filter(t =>
    ['Bash', 'bash', 'run_command'].includes(t.toolName)
  );
  if (bashes.length > 0 && count < 3) {
    const b = bashes[0];
    const cmd = truncate(extractBashCommand(b.toolInput ?? ''), 40);
    const result = summarizeBashResult(b.toolResult);
    const suffix = bashes.length > 1 ? ` (+${bashes.length - 1} more)` : '';
    subs.push(
      <Text key="bash" color={C.dim}>{indent}bash: {cmd} → {result}{suffix}</Text>
    );
    count++;
  }

  // COMPACTION △ — max 2, only on compaction calls
  if (call.compactionDetected && count < 3) {
    const mc = call.missingContext ?? [];
    for (const item of mc.slice(0, Math.min(2, 3 - count))) {
      const text = (item.content ?? '').replace(/\n/g, ' ');
      subs.push(
        <Text key={`mc-${subs.length}`} color={C.dim}>
          {indent}△ "{truncate(text, 55)}"
        </Text>
      );
      count++;
    }
  }

  // AGENT — when Agent tool used with subagent_type
  const agents = call.toolCalls.filter(t =>
    normalizeToolName(t.toolName) === 'Agent'
  );
  if (agents.length > 0 && count < 3 && !call.compactionDetected) {
    const a = agents[0];
    const subtype = extractAgentSubtype(a.toolInput) ?? 'general';
    const result = summarizeBashResult(a.toolResult);
    subs.push(
      <Text key="agent" color={C.dim}>{indent}agent: {subtype} → {result}</Text>
    );
    count++;
  }

  if (subs.length === 0) return null;
  return <Box flexDirection="column">{subs}</Box>;
}

// ═══════════════════════════════════════════════════════════
// ONE CALL ROW = primary line + sublines
// ═══════════════════════════════════════════════════════════

function CallRow({ call, allCalls, cursor }: {
  call: SSECall; allCalls: SSECall[]; cursor?: boolean;
}) {
  return (
    <Box flexDirection="column">
      <CallPrimaryLine call={call} allCalls={allCalls} cursor={cursor} />
      <CallSublines call={call} allCalls={allCalls} />
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════
// D. LIVE INDICATOR
// ═══════════════════════════════════════════════════════════

function LiveIndicator({ live, tick }: {
  live: LiveState | null; tick: number;
}) {
  if (!live) {
    return <Text color={C.dim}>  waiting for claude...</Text>;
  }

  const elapsed = Date.now() - live.startTime;
  const elapsedStr = formatDuration(elapsed);
  const pulse = tick % 2 === 0;
  const dotColor = pulse ? C.mauve : C.dim;
  const tool = live.toolName ? `   ${live.toolName}` : '';

  return (
    <Text>
      <Text color={dotColor}>  ●</Text>
      <Text color={C.normal}>  running...</Text>
      <Text color={C.dim}>  [{elapsedStr}]{tool}</Text>
    </Text>
  );
}

// ═══════════════════════════════════════════════════════════
// F. SUMMARY BOX
// ═══════════════════════════════════════════════════════════

function SummaryBox({ calls, sessionKey }: {
  calls: SSECall[]; sessionKey: string;
}) {
  const totalTok = calls.reduce((s, c) => s + totalInputTokens(c) + c.tokenOutput, 0);
  const totalCostVal = calls.reduce((s, c) => s + c.cost, 0);
  const totalLat = calls.reduce((s, c) => s + c.latencyMs, 0);

  const dim = chalk.hex(C.dim);
  const norm = chalk.hex(C.normal);

  const line1 = `${norm('done')}  ${sessionKey}  ·  ${formatDuration(totalLat)}`;
  const line2 = `${norm(`${calls.length} calls`)}  ·  ${formatTokens(totalTok)}  ·  ${formatCost(totalCostVal)}`;
  const line3 = `→ snose dig to inspect`;

  const boxStr = box([line1, line2, line3], 53);
  return <Text color={C.dim}>{boxStr}</Text>;
}

// ═══════════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════════

function StatusBar({ mode }: { mode: Mode }) {
  switch (mode) {
    case 'stream':
      return <Text><Text color={C.mauve}>  LIVE</Text><Text color={C.dim}>  space browse · q quit</Text></Text>;
    case 'browse':
      return <Text><Text color={C.mauve}>  BROWSE</Text><Text color={C.dim}>  ↑↓ nav · enter inspect · space stream · q quit</Text></Text>;
    case 'detail':
      return <Text><Text color={C.mauve}>  DETAIL</Text><Text color={C.dim}>  ↑↓ scroll · esc back</Text></Text>;
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
  const [cursor, setCursor] = useState(Math.max(0, initialCalls.length - 1));
  const [live, setLive] = useState<LiveState | null>(null);
  const [tick, setTick] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [detailCallData, setDetailCallData] = useState<CallData | null>(null);

  const lastCallTimeRef = useRef(Date.now());
  const callsRef = useRef(calls);
  callsRef.current = calls;

  // Tick timer for live indicator pulse + summary check
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);

      // Summary box after 30s inactivity
      if (callsRef.current.length > 0 && !showSummary) {
        if (Date.now() - lastCallTimeRef.current > 30_000) {
          setShowSummary(true);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [showSummary]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource(`${getBaseUrl()}/internal/events`);

    es.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === 'ping') return;

      if (data.type === 'call_started') {
        setLive({
          callIndex: data.callIndex ?? 0,
          startTime: Date.now(),
          toolName: data.toolName ?? null,
        });
        setShowSummary(false);
      }

      if (data.type === 'call_progress') {
        setLive(prev => prev ? { ...prev, toolName: data.toolName ?? prev.toolName } : prev);
      }

      if (data.type === 'call_completed') {
        setLive(null);
        lastCallTimeRef.current = Date.now();
        setShowSummary(false);

        const call = data.call as SSECall;
        // Ensure arrays are arrays not strings
        if (typeof call.toolCalls === 'string') {
          call.toolCalls = safeParse(call.toolCalls as any, []);
        }
        if (typeof call.skillsDetected === 'string') {
          call.skillsDetected = safeParse(call.skillsDetected as any, []);
        }
        if (typeof call.missingContext === 'string') {
          call.missingContext = safeParse(call.missingContext as any, []);
        }

        setCalls(prev => {
          // Detect new session (different sessionId)
          if (data.sessionId && data.sessionId !== sessionId) {
            setSessionId(data.sessionId);
            setSessionKey(data.key ?? sessionKey);
            setSessionTitle(data.title ?? '');
            return [call];
          }
          return [...prev, call];
        });
        setCursor(prev => prev + 1);
      }
    };

    return () => es.close();
  }, [sessionId]);

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
      if (key.return && calls.length > 0) {
        // Load full CallData for detail view
        loadDetailCall(cursor);
      }
      if (input === ' ') setMode('stream');
      if (input === 'q') exit();
    } else if (mode === 'detail') {
      // DetailView handles its own input; esc goes back
      if (key.escape) {
        setMode('browse');
        setDetailCallData(null);
      }
    }
  }, { isActive: mode !== 'detail' });

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

  // ── RENDER ──

  // Detail overlay — full screen
  if (mode === 'detail' && detailCallData) {
    return (
      <DetailView
        call={detailCallData}
        onBack={() => { setMode('browse'); setDetailCallData(null); }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {/* A. Session header */}
      <SessionHeader sessionKey={sessionKey} title={sessionTitle} width={width} />
      <Text>{' '}</Text>

      {/* B+C. Call list */}
      {calls.length === 0 && !live && (
        <Text color={C.dim}>  waiting for claude...</Text>
      )}

      {calls.map((call, i) => (
        <CallRow
          key={`${call.callIndex}-${i}`}
          call={call}
          allCalls={calls}
          cursor={mode === 'browse' && i === cursor}
        />
      ))}

      {/* Spacing after calls */}
      {calls.length > 0 && <Text>{' '}</Text>}

      {/* D. Live indicator — stream mode only */}
      {mode === 'stream' && !showSummary && (
        <LiveIndicator live={live} tick={tick} />
      )}

      {/* F. Summary box — stream mode only */}
      {mode === 'stream' && showSummary && calls.length > 0 && (
        <SummaryBox calls={calls} sessionKey={sessionKey} />
      )}

      {/* Status bar */}
      <Text>{' '}</Text>
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

  // Load current session + existing calls before rendering
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
