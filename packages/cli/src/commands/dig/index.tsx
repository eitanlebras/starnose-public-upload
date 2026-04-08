import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fetchApi, isProxyRunning } from '../../api.js';

// ────────────────────────────────────────────────────────────────────
// types (mapped to actual db schema; the spec's field names like
// `cost`/`input_tokens` are aliases for the real columns)
// ────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  key: string;
  title: string | null;
  created_at: number;
  status: string;
  call_count: number;
  total_cost: number;
  last_status: string;
}

interface Call {
  id: string;
  session_id: string;
  call_index: number;
  timestamp: number;
  model: string;
  request_body: string;
  response_body: string;
  latency_ms: number;
  token_count_input: number;
  token_count_output: number;
  estimated_cost_usd: number;
  tool_calls: string;
  status: string;
  summary: string;
  compaction_detected: number;
  tokens_before_compaction: number | null;
}

// ────────────────────────────────────────────────────────────────────
// colors
// ────────────────────────────────────────────────────────────────────
const ACCENT = '#e8607a';
const BG_DK  = '#0A0A0A';
const SEC    = '#777';

// ────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function fmtCost(n: number): string {
  if (n == null || isNaN(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function fmtTok(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function safeJson<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function toolName(tu: any): string {
  return tu?.name || '';
}

function toolArg(tu: any): string {
  const i = tu?.input || {};
  if (i.file_path) return (String(i.file_path).split('/').pop() || String(i.file_path));
  if (i.path) return (String(i.path).split('/').pop() || String(i.path));
  if (i.command) return String(i.command).slice(0, 40);
  if (i.pattern) return String(i.pattern).slice(0, 40);
  if (i.url) return String(i.url).slice(0, 40);
  // fallback: first short scalar field
  for (const k of Object.keys(i)) {
    const v = i[k];
    if (typeof v === 'string' && v.length < 80) return v.slice(0, 40);
  }
  return '';
}

function toolSummary(tools: any[]): string {
  if (!tools.length) return '(text response — no tool calls)';
  // group consecutive same-name
  const groups: { name: string; n: number }[] = [];
  for (const t of tools) {
    const n = toolName(t);
    if (groups.length && groups[groups.length - 1].name === n) groups[groups.length - 1].n++;
    else groups.push({ name: n, n: 1 });
  }
  return groups.map((g) => (g.n > 1 ? `${g.name}×${g.n}` : g.name)).join(', ');
}

function callShortSummary(call: Call): string {
  const tools = safeJson<any[]>(call.tool_calls, []);
  const head = tools.length ? toolSummary(tools) : (call.summary || '(text)');
  const out = `user → ${head}`;
  return out.length > 45 ? out.slice(0, 44) + '…' : out;
}

function bar(inputTokens: number, width = 8): string {
  const ratio = Math.min(1, Math.max(0, (inputTokens || 0) / 200000));
  const n = Math.round(ratio * width);
  const filled = chalk.bgHex(ACCENT)(' '.repeat(n));
  const empty = chalk.bgHex('#1E1E1E')(' '.repeat(width - n));
  return filled + empty;
}

function pct(inputTokens: number): string {
  const r = Math.min(1, Math.max(0, (inputTokens || 0) / 200000));
  return `${Math.round(r * 100)}%`;
}

function callIndexBadge(idx: number): string {
  const circled = ['⓪','①','②','③','④','⑤','⑥','⑦','⑧','⑨'];
  if (idx >= 0 && idx <= 9) return circled[idx];
  return `(${idx})`;
}

function statusGlyph(s: Session): string {
  const v = (s.last_status || s.status || '').toLowerCase();
  if (v === 'failed' || v === 'error') return '✗';
  if (v === 'running' || v === 'active') return '·';
  return '✓';
}

// ────────────────────────────────────────────────────────────────────
// system prompt extraction
// ────────────────────────────────────────────────────────────────────

function getSystemPrompt(call: Call): string {
  const req = safeJson<any>(call.request_body, null);
  if (!req) return '';
  const sys = req.system;
  if (typeof sys === 'string') return sys;
  if (Array.isArray(sys)) return sys.map((b: any) => (typeof b === 'string' ? b : b?.text || '')).join('\n');
  return '';
}

// extract files-in-context from request_body (cumulative across the conversation)
function extractFiles(call: Call): { name: string; tokens: number }[] {
  const req = safeJson<any>(call.request_body, null);
  if (!req?.messages) return [];
  const toolUses = new Map<string, string>(); // id -> filename
  const files = new Map<string, number>(); // filename -> tokens
  for (const msg of req.messages) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'tool_use' && (block.name === 'Read' || block.name === 'view')) {
        const p = block.input?.file_path || block.input?.path || '';
        const fn = String(p).split('/').pop() || String(p);
        if (fn) toolUses.set(block.id, fn);
      }
      if (block?.type === 'tool_result') {
        const fn = toolUses.get(block.tool_use_id);
        if (fn) {
          let text = '';
          if (typeof block.content === 'string') text = block.content;
          else if (Array.isArray(block.content)) text = block.content.map((c: any) => c?.text || '').join('');
          const toks = Math.ceil(text.length / 4);
          files.set(fn, (files.get(fn) || 0) + toks);
        }
      }
    }
  }
  return Array.from(files.entries()).map(([name, tokens]) => ({ name, tokens }));
}

// for each filename, the call_index values (in this session) at which Read appeared
function buildReadHistory(calls: Call[], upToIdx: number): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (let i = 0; i <= upToIdx; i++) {
    const arr = safeJson<any[]>(calls[i].tool_calls, []);
    for (const tu of arr) {
      if (tu?.name === 'Read' || tu?.name === 'view') {
        const p = tu.input?.file_path || tu.input?.path || '';
        const fn = String(p).split('/').pop() || String(p);
        if (!fn) continue;
        const list = m.get(fn) || [];
        if (!list.includes(calls[i].call_index)) list.push(calls[i].call_index);
        m.set(fn, list);
      }
    }
  }
  return m;
}

function conversationStats(call: Call): { tokens: number; turns: number } {
  const req = safeJson<any>(call.request_body, null);
  if (!req?.messages) return { tokens: 0, turns: 0 };
  let total = 0;
  for (const msg of req.messages) {
    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
    for (const block of content) {
      if (typeof block === 'string') total += block.length;
      else if (block?.type === 'text') total += String(block.text || '').length;
      else if (block?.type === 'tool_use') total += JSON.stringify(block.input || {}).length;
      else if (block?.type === 'tool_result') {
        if (typeof block.content === 'string') total += block.content.length;
        else if (Array.isArray(block.content)) total += block.content.map((c: any) => (c?.text || '').length).reduce((a: number, b: number) => a + b, 0);
      }
    }
  }
  return { tokens: Math.ceil(total / 4), turns: req.messages.length };
}

// ────────────────────────────────────────────────────────────────────
// search filter — parses cost:>N calls:>N today failed plus substring
// ────────────────────────────────────────────────────────────────────

function applySearch(sessions: Session[], q: string): Session[] {
  if (!q.trim()) return sessions;
  const tokens = q.trim().split(/\s+/);
  const text: string[] = [];
  let costOp: '>' | '<' | null = null, costVal = NaN;
  let callsOp: '>' | '<' | null = null, callsVal = NaN;
  let onlyToday = false;
  let onlyFailed = false;
  for (const t of tokens) {
    let m = t.match(/^cost:([<>])(.+)$/);
    if (m) { costOp = m[1] as any; costVal = parseFloat(m[2]); continue; }
    m = t.match(/^calls:([<>])(.+)$/);
    if (m) { callsOp = m[1] as any; callsVal = parseFloat(m[2]); continue; }
    if (t === 'today') { onlyToday = true; continue; }
    if (t === 'failed') { onlyFailed = true; continue; }
    text.push(t.toLowerCase());
  }
  return sessions.filter((s) => {
    if (onlyToday && !isToday(s.created_at)) return false;
    if (onlyFailed && (s.last_status || s.status) !== 'failed' && (s.last_status || s.status) !== 'error') return false;
    if (costOp === '>' && !(s.total_cost > costVal)) return false;
    if (costOp === '<' && !(s.total_cost < costVal)) return false;
    if (callsOp === '>' && !(s.call_count > callsVal)) return false;
    if (callsOp === '<' && !(s.call_count < callsVal)) return false;
    if (text.length) {
      const hay = `${s.title || ''} ${s.key} ${s.id}`.toLowerCase();
      for (const w of text) if (!hay.includes(w)) return false;
    }
    return true;
  });
}

// ────────────────────────────────────────────────────────────────────
// CLAUDE.md writer — walk up from cwd
// ────────────────────────────────────────────────────────────────────

function findClaudeMd(): string | null {
  let dir = process.cwd();
  while (true) {
    const p = join(dir, 'CLAUDE.md');
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function writeInstruction(instr: string): string {
  let p = findClaudeMd();
  if (!p) {
    p = join(process.cwd(), 'CLAUDE.md');
    writeFileSync(p, `# CLAUDE.md\n\n${instr}\n`);
    return p;
  }
  const cur = readFileSync(p, 'utf-8');
  const sep = cur.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(p, `${sep}${instr}\n`);
  return p;
}

// ────────────────────────────────────────────────────────────────────
// whatif — replay a call against the real Anthropic API
// ────────────────────────────────────────────────────────────────────

interface ReplayResult {
  ok: boolean;
  error?: string;
  responseBody?: any; // parsed
}

async function replayCall(call: Call, extra: string): Promise<ReplayResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!key && !oauth) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not set (or CLAUDE_CODE_OAUTH_TOKEN for Claude Max OAuth).' };
  }
  let req: any;
  try { req = JSON.parse(call.request_body); }
  catch { return { ok: false, error: 'request_body could not be parsed' }; }

  // append instruction to system
  if (typeof req.system === 'string') {
    req.system = req.system + '\n' + extra;
  } else if (Array.isArray(req.system)) {
    req.system = [...req.system, { type: 'text', text: extra }];
  } else {
    req.system = extra;
  }
  // strip stream so we can read JSON
  req.stream = false;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (oauth) headers['authorization'] = `Bearer ${oauth}`;
  else if (key) headers['x-api-key'] = key;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    const text = await resp.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!resp.ok) return { ok: false, error: body?.error?.message || `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    return { ok: true, responseBody: body };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error' };
  }
}

// estimate cost for replay (input only — output unknown)
function estimateReplayCost(call: Call): number {
  const inputTok = call.token_count_input || 0;
  // Sonnet 4.x default
  return (inputTok / 1_000_000) * 3 + 0.5 * (1024 / 1_000_000) * 15;
}

// extract tool-call summary lines from a response body
function responseToolLines(body: any): string[] {
  if (!body) return [];
  let content = body.content;
  // proxy may store sse chunks; if string, wrap
  if (typeof body === 'string') return [body.slice(0, 120)];
  if (!Array.isArray(content)) return [];
  const lines: string[] = [];
  for (const block of content) {
    if (block?.type === 'tool_use') {
      lines.push(`${block.name}("${toolArg(block)}")`);
    } else if (block?.type === 'text') {
      const t = String(block.text || '').trim();
      if (t) lines.push(t.slice(0, 120));
    }
  }
  return lines.length ? lines : ['(empty response)'];
}

// for the original side, parse stored response_body. The proxy stores either
// a JSON object or a raw SSE stream — handle both.
function originalToolLines(call: Call): string[] {
  const tools = safeJson<any[]>(call.tool_calls, []);
  if (tools.length) {
    return tools.map((t) => `${toolName(t)}("${toolArg(t)}")`);
  }
  // fall back to response_body
  const body = safeJson<any>(call.response_body, null);
  return responseToolLines(body);
}

// ────────────────────────────────────────────────────────────────────
// React app
// ────────────────────────────────────────────────────────────────────

type Screen = 'sessions' | 'inspector' | 'whatif' | 'result';

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout.columns || 100);
  const [rows, setRows] = useState(stdout.rows || 30);

  useEffect(() => {
    const onResize = () => { setCols(stdout.columns || 100); setRows(stdout.rows || 30); };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const [screen, setScreen] = useState<Screen>('sessions');

  // sessions data
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessSel, setSessSel] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  // inspector data
  const [calls, setCalls] = useState<Call[]>([]);
  const [callSel, setCallSel] = useState(0);
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // whatif
  const [whatifInput, setWhatifInput] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [replayErr, setReplayErr] = useState<string | null>(null);
  const [replayResp, setReplayResp] = useState<any>(null);
  const [savedInstr, setSavedInstr] = useState('');

  // result
  const [writeMsg, setWriteMsg] = useState<string | null>(null);

  // ────── load sessions on mount ──────
  useEffect(() => {
    (async () => {
      try {
        const list = await fetchApi<Session[]>('/internal/sessions');
        const filtered = (list || []).filter((s) => {
          if (!s.call_count || s.call_count <= 0) return false;
          const t = (s.title || '').toLowerCase();
          if (t === 'quota' || t === 'untitled session') return false;
          return true;
        });
        setSessions(filtered);
      } catch { /* ignore */ }
    })();
  }, []);

  const visibleSessions = useMemo(() => applySearch(sessions, searchQ), [sessions, searchQ]);

  // ────── open a session ──────
  async function openSession(s: Session) {
    try {
      const rows = await fetchApi<Call[]>(`/internal/calls/${s.id}`);
      setCalls(rows || []);
      setCallSel(Math.max(0, (rows || []).length - 1));
      setActiveSession(s);
      setScreen('inspector');
    } catch { /* ignore */ }
  }

  // ────── global key routing ──────
  useInput((input, key) => {
    // q always quits, except when typing in a text input
    if (screen === 'sessions' && !searchMode) {
      if (input === 'q') { exit(); return; }
      if (input === '/') { setSearchMode(true); return; }
      if (key.upArrow) { setSessSel((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSessSel((i) => Math.min(visibleSessions.length - 1, i + 1)); return; }
      if (key.return) {
        const s = visibleSessions[sessSel];
        if (s) void openSession(s);
        return;
      }
    } else if (screen === 'inspector') {
      if (input === 'q') { exit(); return; }
      if (input === 's') { setScreen('sessions'); return; }
      if (input === 'w') {
        setWhatifInput(''); setReplayErr(null); setReplayResp(null);
        setScreen('whatif'); return;
      }
      if (key.upArrow) { setCallSel((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setCallSel((i) => Math.min(calls.length - 1, i + 1)); return; }
    } else if (screen === 'whatif') {
      if (key.escape) { setScreen('inspector'); return; }
      // enter handled by TextInput onSubmit
    } else if (screen === 'result') {
      if (input === 'q') { exit(); return; }
      if (input === 'y' || key.return) {
        try {
          const p = writeInstruction(savedInstr);
          setWriteMsg(`written to ${p}`);
          setTimeout(() => { setWriteMsg(null); setScreen('inspector'); }, 800);
        } catch (e: any) {
          setWriteMsg(`error: ${e?.message || 'failed'}`);
        }
        return;
      }
      if (input === 'n' || key.escape) { setScreen('inspector'); return; }
      if (input === 'r') { setScreen('whatif'); return; }
    }
  });

  // ────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────

  if (screen === 'sessions') {
    return <SessionsScreen
      cols={cols} rows={rows}
      sessions={visibleSessions}
      sel={sessSel}
      searchMode={searchMode}
      searchQ={searchQ}
      onSearchChange={setSearchQ}
      onSearchSubmit={() => { setSearchMode(false); setSessSel(0); }}
    />;
  }

  if (screen === 'inspector') {
    return <InspectorScreen
      cols={cols} rows={rows}
      session={activeSession!}
      calls={calls}
      sel={callSel}
    />;
  }

  if (screen === 'whatif') {
    const call = calls[callSel];
    return <WhatifScreen
      cols={cols} rows={rows}
      call={call}
      input={whatifInput}
      onChange={setWhatifInput}
      replaying={replaying}
      error={replayErr}
      onSubmit={async (text) => {
        if (!text.trim()) return;
        setReplaying(true); setReplayErr(null);
        const r = await replayCall(call, text);
        setReplaying(false);
        if (!r.ok) { setReplayErr(r.error || 'failed'); return; }
        setReplayResp(r.responseBody);
        setSavedInstr(text);
        setScreen('result');
      }}
    />;
  }

  if (screen === 'result') {
    const call = calls[callSel];
    return <ResultScreen
      cols={cols} rows={rows}
      call={call}
      newResp={replayResp}
      instruction={savedInstr}
      writeMsg={writeMsg}
    />;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// SCREEN 1: SESSIONS
// ────────────────────────────────────────────────────────────────────

function SessionsScreen(props: {
  cols: number; rows: number;
  sessions: Session[]; sel: number;
  searchMode: boolean; searchQ: string;
  onSearchChange: (s: string) => void;
  onSearchSubmit: () => void;
}) {
  const { cols, rows, sessions, sel, searchMode, searchQ } = props;
  const headerRows = 2;
  const footerRows = 1;
  const searchRow = searchMode ? 1 : 0;
  const perItem = 3; // 2 lines + divider
  const avail = Math.max(2, rows - headerRows - footerRows - searchRow - 1);
  const maxItems = Math.max(1, Math.floor(avail / perItem));
  // window
  const start = Math.max(0, Math.min(sessions.length - maxItems, sel - Math.floor(maxItems / 2)));
  const end = Math.min(sessions.length, start + maxItems);
  const window = sessions.slice(start, end);

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{chalk.bold('snose dig')}{'  '}{chalk.dim('— sessions')}</Text>
        <Box flexGrow={1} />
        <Text>{chalk.dim('[q quit]')}</Text>
      </Box>
      <Text>{chalk.hex(SEC)('─'.repeat(Math.max(0, cols - 1)))}</Text>

      {searchMode && (
        <Box>
          <Text>{chalk.hex(ACCENT)('/ ')}</Text>
          <TextInput
            value={searchQ}
            onChange={props.onSearchChange}
            onSubmit={props.onSearchSubmit}
            placeholder="text · cost:>1 · calls:>10 · today · failed"
          />
        </Box>
      )}

      {sessions.length === 0 && (
        <Box paddingY={1}><Text>{chalk.dim('  no sessions yet')}</Text></Box>
      )}

      {window.map((s, i) => {
        const realIdx = start + i;
        const isSel = realIdx === sel;
        const marker = isSel ? '►' : ' ';
        const head = `${marker} ${s.key}  ${timeAgo(s.created_at)}  ${fmtCost(s.total_cost)}  ${s.call_count} calls  ${statusGlyph(s)}`;
        const title = `  "${s.title || '(no title)'}"`;
        const padHead = head.padEnd(cols - 1, ' ');
        const padTitle = title.padEnd(cols - 1, ' ');
        const styled = isSel
          ? <>
              <Text>{chalk.bgHex(ACCENT).hex(BG_DK)(padHead)}</Text>
              <Text>{chalk.bgHex(ACCENT).hex(BG_DK)(padTitle)}</Text>
            </>
          : <>
              <Text>{padHead}</Text>
              <Text>{chalk.dim(padTitle)}</Text>
            </>;
        return (
          <Box key={s.id} flexDirection="column">
            {styled}
            <Text>{chalk.hex(SEC)('─'.repeat(Math.max(0, cols - 1)))}</Text>
          </Box>
        );
      })}

      <Box flexGrow={1} />
      <Text>{chalk.dim('↑↓ navigate · enter open · / search · q quit')}</Text>
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────────
// SCREEN 2: INSPECTOR
// ────────────────────────────────────────────────────────────────────

function InspectorScreen(props: {
  cols: number; rows: number;
  session: Session; calls: Call[]; sel: number;
}) {
  const { cols, rows, session, calls, sel } = props;
  const leftWidth = Math.floor(cols * 0.4);
  const rightWidth = cols - leftWidth - 2; // divider char + space
  const headerRows = 3;
  const footerRows = 1;
  const bodyRows = Math.max(4, rows - headerRows - footerRows - 1);

  const totalLatency = calls.reduce((a, c) => a + (c.latency_ms || 0), 0);

  // build left list (window around sel)
  const start = Math.max(0, Math.min(calls.length - bodyRows, sel - Math.floor(bodyRows / 2)));
  const end = Math.min(calls.length, start + bodyRows);
  const win = calls.slice(start, end);

  const leftLines: React.ReactNode[] = [];
  win.forEach((c, i) => {
    const realIdx = start + i;
    const isSel = realIdx === sel;
    if (c.compaction_detected) {
      const before = c.tokens_before_compaction || 0;
      const after = (calls[realIdx + 1]?.token_count_input) || 0;
      const lost = Math.max(0, before - after);
      const text = `⚡ compaction: ${fmtTok(before)} → ${fmtTok(after)}  (lost ${fmtTok(lost)})`;
      leftLines.push(<Text key={`comp-${c.id}`}>{chalk.hex(ACCENT)(text.padEnd(leftWidth, ' '))}</Text>);
      return;
    }
    const badge = callIndexBadge(c.call_index);
    const summary = callShortSummary(c);
    const b = bar(c.token_count_input);
    const p = pct(c.token_count_input);
    const arrow = isSel ? '►' : ' ';
    // construct line; we cannot mix bg per char + bg per row easily, so when selected
    // we use a flat coral background and forgo the inner bar gradient.
    if (isSel) {
      const raw = `${arrow}${badge.padStart(3, ' ')}  ${summary.padEnd(46, ' ')} ${'█'.repeat(Math.round(((c.token_count_input || 0) / 200000) * 8)).padEnd(8, ' ')} ${p}`;
      leftLines.push(<Text key={c.id}>{chalk.bgHex(ACCENT).hex(BG_DK)(raw.padEnd(leftWidth, ' '))}</Text>);
    } else {
      const left = `${arrow}${badge.padStart(3, ' ')}  ${summary.padEnd(46, ' ')} `;
      const right = ` ${p}`;
      const used = left.length + 8 + right.length;
      const padTail = ' '.repeat(Math.max(0, leftWidth - used));
      leftLines.push(
        <Text key={c.id}>{left}{b}{right}{padTail}</Text>
      );
    }
  });
  // pad
  while (leftLines.length < bodyRows) {
    leftLines.push(<Text key={`pad-${leftLines.length}`}>{' '.repeat(leftWidth)}</Text>);
  }

  // ────── right pane: 4 sections ──────
  const cur = calls[sel];
  const sys = cur ? getSystemPrompt(cur) : '';
  const sysTok = Math.ceil(sys.length / 4);
  const files = cur ? extractFiles(cur) : [];
  const filesTok = files.reduce((a, f) => a + f.tokens, 0);
  const readHistory = cur ? buildReadHistory(calls, sel) : new Map<string, number[]>();
  const tools = cur ? safeJson<any[]>(cur.tool_calls, []) : [];
  const conv = cur ? conversationStats(cur) : { tokens: 0, turns: 0 };
  const inputTokens = cur?.token_count_input || 0;
  const convWarn = conv.tokens > inputTokens * 0.8;

  // construct right pane lines, truncated to bodyRows
  const rightLines: string[] = [];
  const addLine = (s: string) => {
    // wrap to rightWidth
    if (!s) { rightLines.push(''); return; }
    let remaining = s;
    while (remaining.length > 0) {
      // strip ansi when measuring length — naive: just chunk
      const chunk = remaining.slice(0, rightWidth);
      rightLines.push(chunk);
      remaining = remaining.slice(rightWidth);
    }
  };

  addLine(chalk.bold(`SYSTEM PROMPT  ${chalk.dim(`[${fmtTok(sysTok)} tok]`)}`));
  if (sys) {
    const lines = sys.split('\n');
    for (const l of lines) addLine(chalk.dim(l));
  } else {
    addLine(chalk.dim('(none)'));
  }
  addLine('');
  addLine(chalk.bold(`FILES IN CONTEXT  ${chalk.dim(`[${fmtTok(filesTok)} tok]`)}`));
  if (files.length === 0) addLine(chalk.dim('(none)'));
  for (const f of files) {
    const reads = readHistory.get(f.name) || [];
    const at = reads.length ? `(read at call ${reads.join(', ')})` : '';
    addLine(`${f.name}  ${chalk.dim(at)}`);
  }
  addLine('');
  addLine(chalk.bold('WHAT IT DID'));
  if (tools.length === 0) {
    addLine(chalk.dim('(text response — no tool calls)'));
  } else {
    for (const t of tools) {
      addLine(`${toolName(t)}("${toolArg(t)}")`);
    }
  }
  addLine('');
  const convStr = `${fmtTok(conv.tokens)} tok  (${conv.turns} turns)`;
  addLine(chalk.bold('CONVERSATION  ') + chalk.dim(`[${convStr}]`) + (convWarn ? '  ' + chalk.hex(ACCENT)('⚠') : ''));

  // truncate
  const visibleRight = rightLines.slice(0, bodyRows);
  while (visibleRight.length < bodyRows) visibleRight.push('');

  // build the body row by row
  const bodyRowsRendered: React.ReactNode[] = [];
  for (let i = 0; i < bodyRows; i++) {
    bodyRowsRendered.push(
      <Box key={i}>
        {leftLines[i] ?? <Text>{' '.repeat(leftWidth)}</Text>}
        <Text>{chalk.dim(' │ ')}</Text>
        <Text>{visibleRight[i]}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{chalk.bold(`"${session.title || '(no title)'}"`)}</Text>
        <Box flexGrow={1} />
        <Text>{chalk.dim(session.key)}</Text>
      </Box>
      <Text>{chalk.hex(SEC)(`${calls.length} calls · ${fmtCost(session.total_cost)} · ${fmtDur(totalLatency)}`)}</Text>
      <Text>{chalk.hex(SEC)('─'.repeat(Math.max(0, cols - 1)))}</Text>
      {bodyRowsRendered}
      <Text>{chalk.dim('↑↓ navigate · w whatif · s sessions · q quit')}</Text>
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────────
// SCREEN 3: WHATIF
// ────────────────────────────────────────────────────────────────────

function WhatifScreen(props: {
  cols: number; rows: number;
  call: Call;
  input: string; onChange: (s: string) => void;
  replaying: boolean; error: string | null;
  onSubmit: (text: string) => void;
}) {
  const { cols, rows, call, input, onChange, replaying, error, onSubmit } = props;
  const sys = getSystemPrompt(call);
  const sysTok = Math.ceil(sys.length / 4);
  const cost = estimateReplayCost(call);
  const headerRows = 4;
  const tailRows = 6;
  const sysRows = Math.max(3, rows - headerRows - tailRows);
  const sysLines = sys.split('\n').slice(0, sysRows);

  return (
    <Box flexDirection="column">
      <Text>{chalk.bold(`whatif — call ${callIndexBadge(call.call_index)}`)}</Text>
      <Text>{chalk.hex(SEC)('─'.repeat(Math.max(0, cols - 1)))}</Text>
      <Text>{chalk.dim(`system prompt at this call (${fmtTok(sysTok)} tok):`)}</Text>
      <Box flexDirection="column">
        {sysLines.map((l, i) => <Text key={i}>{chalk.dim(l)}</Text>)}
        {sys.split('\n').length > sysLines.length && (
          <Text>{chalk.dim(`… (${sys.split('\n').length - sysLines.length} more lines)`)}</Text>
        )}
      </Box>
      <Text>{chalk.hex(SEC)('─'.repeat(Math.max(0, cols - 1)))}</Text>
      <Text>{chalk.bold('add an instruction to test:')}</Text>
      <Box>
        <Text>{chalk.hex(ACCENT)('> ')}</Text>
        {replaying
          ? <Text>{chalk.dim('replaying…')}</Text>
          : <TextInput value={input} onChange={onChange} onSubmit={onSubmit} />}
      </Box>
      {error && <Text>{chalk.hex(ACCENT)(`✗ ${error}`)}</Text>}
      <Text>{chalk.dim(`costs ~${fmtCost(cost)} to replay · uses ANTHROPIC_API_KEY`)}</Text>
      <Text>{chalk.dim('enter replay · esc cancel')}</Text>
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────────
// SCREEN 4: RESULT
// ────────────────────────────────────────────────────────────────────

function ResultScreen(props: {
  cols: number; rows: number;
  call: Call;
  newResp: any;
  instruction: string;
  writeMsg: string | null;
}) {
  const { cols, call, newResp, instruction, writeMsg } = props;
  const colW = Math.floor((cols - 4) / 2);
  const orig = originalToolLines(call);
  const next = responseToolLines(newResp);
  const same = orig.join('|') === next.join('|');
  const max = Math.max(orig.length, next.length);
  const rowsR: React.ReactNode[] = [];
  for (let i = 0; i < max; i++) {
    const a = (orig[i] || '').slice(0, colW).padEnd(colW, ' ');
    const b = (next[i] || '').slice(0, colW).padEnd(colW, ' ');
    rowsR.push(<Text key={i}>{a}{'  '}{b}</Text>);
  }

  return (
    <Box flexDirection="column">
      <Text>{chalk.bold(`result — call ${callIndexBadge(call.call_index)}`)}</Text>
      <Text>{chalk.hex(SEC)('─'.repeat(Math.max(0, cols - 1)))}</Text>
      <Box>
        <Text>{chalk.bold('ORIGINAL'.padEnd(colW, ' '))}{'  '}{chalk.bold('WITH YOUR INSTRUCTION')}</Text>
      </Box>
      <Text>{chalk.hex(SEC)('─'.repeat(colW))}{'  '}{chalk.hex(SEC)('─'.repeat(colW))}</Text>
      {rowsR}
      {same && <Text>{chalk.dim('(no change)')}</Text>}
      <Text>{chalk.hex(SEC)('─'.repeat(Math.max(0, cols - 1)))}</Text>
      <Text>{chalk.dim('your instruction:')}</Text>
      <Text>{chalk.hex(ACCENT)(`"${instruction}"`)}</Text>
      <Text> </Text>
      {writeMsg
        ? <Text>{chalk.hex(ACCENT)(writeMsg)}</Text>
        : <Text>{chalk.dim('add to CLAUDE.md? [Y/n]   (r retry · esc skip)')}</Text>}
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────────
// entry point
// ────────────────────────────────────────────────────────────────────

export async function commandDig(): Promise<void> {
  const running = await isProxyRunning();
  if (!running) {
    console.log(chalk.hex(ACCENT)('✗ daemon not running — snose on'));
    process.exit(1);
  }

  const out = process.stdout;
  const canAlt = !!out.isTTY;
  if (canAlt) {
    out.write('\x1b[?1049h');
    out.write('\x1b[2J\x1b[H');
  }
  // restore terminal on any exit
  const cleanup = () => {
    if (canAlt) out.write('\x1b[?1049l');
    out.write('\x1b[?25h'); // show cursor
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  try {
    const { waitUntilExit } = render(<App />);
    await waitUntilExit();
  } finally {
    cleanup();
  }
}
