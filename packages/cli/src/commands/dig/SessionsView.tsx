import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { SessionData } from './types.js';
import { fetchApi } from '../../api.js';
import { formatTokens, formatCost, formatRelativeTime } from '../../format.js';

interface Props {
  onBack: () => void;
  onSelect: (sessionId: string) => void;
  currentSessionId?: string | null;
}

type FilterKey = 'all' | 'today' | 'expensive' | 'failed' | 'long';
const FILTERS: FilterKey[] = ['all', 'today', 'expensive', 'failed', 'long'];
type SortKey = 'cost' | 'tokens' | 'calls';
type SortDir = 'asc' | 'desc';
const SORTS: SortKey[] = ['cost', 'tokens', 'calls'];

const ONE_DAY = 24 * 60 * 60 * 1000;

function isGhost(s: SessionData): boolean {
  if ((s.call_count ?? 0) === 0 && (s.total_tokens ?? 0) === 0) return true;
  const t = (s.title ?? '').trim().toLowerCase();
  if (t === 'quota' || t === 'untitled session') return true;
  return false;
}

function matchesFilter(s: SessionData, f: FilterKey): boolean {
  switch (f) {
    case 'all':       return (s.call_count ?? 0) >= 1;
    case 'today':     return Date.now() - s.created_at < ONE_DAY;
    case 'expensive': return (s.total_cost ?? 0) > 0.5;
    case 'failed':    return s.last_status === 'failed';
    case 'long':      return (s.call_count ?? 0) > 20;
  }
}

// ─── Custom filter syntax parser ─────────────────────────────

type Token =
  | { kind: 'cmp'; field: 'cost' | 'calls' | 'tok'; op: '>' | '<'; value: number }
  | { kind: 'sub'; field: 'skill' | 'file'; needle: string }
  | { kind: 'flag'; flag: 'failed' | 'active' | 'today' }
  | { kind: 'text'; text: string };

function parseNumberWithSuffix(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^([\d.]+)\s*([km])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  if (m[2] === 'k') return n * 1000;
  if (m[2] === 'm') return n * 1_000_000;
  return n;
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && input[i] === ' ') i++;
    if (i >= input.length) break;
    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) { out.push(input.slice(i + 1)); break; }
      out.push(input.slice(i + 1, end));
      i = end + 1;
    } else {
      let j = i;
      while (j < input.length && input[j] !== ' ') j++;
      out.push(input.slice(i, j));
      i = j;
    }
  }
  return out;
}

function parseQuery(input: string): Token[] {
  const tokens: Token[] = [];
  const freeText: string[] = [];
  for (const raw of tokenize(input)) {
    const lower = raw.toLowerCase();
    if (lower === 'failed' || lower === 'active' || lower === 'today') {
      tokens.push({ kind: 'flag', flag: lower as any });
      continue;
    }
    // Incomplete filter tokens should be ignored while typing:
    // cost:   cost:>   tok:   file:
    if (/^(cost|calls|tok|skill|file):?$/i.test(raw) || /^(cost|calls|tok):[<>]?$/i.test(raw)) {
      continue;
    }

    const m = raw.match(/^(cost|calls|tok|skill|file):(.+)$/i);
    if (m) {
      const field = m[1].toLowerCase();
      const rest = m[2];
      if (field === 'cost' || field === 'calls' || field === 'tok') {
        const opMatch = rest.match(/^([<>])(.+)$/);
        if (opMatch) {
          const num = parseNumberWithSuffix(opMatch[2]);
          if (num !== null) {
            tokens.push({ kind: 'cmp', field: field as any, op: opMatch[1] as '>' | '<', value: num });
            continue;
          }
        }
        // Invalid/incomplete numeric comparator: ignore instead of treating as free text.
        continue;
      } else if (field === 'skill' || field === 'file') {
        if (!rest.trim()) continue;
        tokens.push({ kind: 'sub', field: field as any, needle: rest.toLowerCase() });
        continue;
      }
    }
    freeText.push(raw);
  }
  if (freeText.length > 0) {
    tokens.push({ kind: 'text', text: freeText.join(' ').toLowerCase() });
  }
  return tokens;
}

function tokenMatches(s: SessionData, t: Token): boolean {
  switch (t.kind) {
    case 'cmp': {
      let v: number;
      if (t.field === 'cost') v = s.total_cost ?? 0;
      else if (t.field === 'calls') v = s.call_count ?? 0;
      else v = s.total_tokens ?? 0;
      return t.op === '>' ? v > t.value : v < t.value;
    }
    case 'sub': {
      // skill / file searches require richer session data; fall back to title match
      const hay = ((s as any)[`${t.field}s`] ?? s.title ?? '').toString().toLowerCase();
      return hay.includes(t.needle);
    }
    case 'flag':
      if (t.flag === 'failed') return s.last_status === 'failed';
      if (t.flag === 'active') return s.last_status === 'running' || s.status === 'active';
      return Date.now() - s.created_at < ONE_DAY;
    case 'text': {
      const hay = `${s.title ?? ''} ${s.key ?? ''}`.toLowerCase();
      return hay.includes(t.text);
    }
  }
}

function matchesQuery(s: SessionData, query: string): boolean {
  const tokens = parseQuery(query);
  if (tokens.length === 0) return true;
  return tokens.every(t => tokenMatches(s, t));
}

function statusLabel(s: SessionData): { text: string; mauve: boolean } {
  if (s.last_status === 'running' || s.status === 'active') return { text: '● active', mauve: true };
  if (s.last_status === 'failed') return { text: '✗ failed', mauve: true };
  return { text: '✓ done', mauve: false };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function clipLine(s: string, max: number): string {
  if (max <= 0) return '';
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…';
}

export function SessionsView({ onBack, onSelect, currentSessionId }: Props) {
  const pickSession = (sid: string) => onSelect(sid);
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const height = stdout?.rows ?? 40;

  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterIdx, setFilterIdx] = useState(0);
  const [sortIdx, setSortIdx] = useState(0);
  const [sortDirByKey, setSortDirByKey] = useState<Record<SortKey, SortDir>>({
    cost: 'desc',
    tokens: 'desc',
    calls: 'desc',
  });
  const [focusZone, setFocusZone] = useState<'filters' | 'sorts' | 'list'>('list');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchApi<SessionData[]>('/internal/sessions')
      .then(setSessions)
      .catch(() => {});
  }, []);

  // Hide ghost sessions globally
  const cleanSessions = useMemo(
    () => sessions.filter(s => !isGhost(s)),
    [sessions]
  );

  // Counts per filter (computed off cleanSessions)
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, today: 0, expensive: 0, failed: 0, long: 0 };
    for (const f of FILTERS) c[f] = cleanSessions.filter(s => matchesFilter(s, f)).length;
    return c;
  }, [cleanSessions]);

  const currentFilter = FILTERS[filterIdx];
  const activeSort = SORTS[sortIdx];
  const activeSortDir = sortDirByKey[activeSort];

  // Filter + search
  const visible = useMemo(() => {
    let list = cleanSessions.filter(s => matchesFilter(s, currentFilter));
    if (searching && query.trim()) {
      list = list.filter(s => matchesQuery(s, query));
    }
    list = [...list].sort((a, b) => {
      let av = 0;
      let bv = 0;
      if (activeSort === 'cost') {
        av = a.total_cost ?? 0;
        bv = b.total_cost ?? 0;
      } else if (activeSort === 'tokens') {
        av = a.total_tokens ?? 0;
        bv = b.total_tokens ?? 0;
      } else {
        av = a.call_count ?? 0;
        bv = b.call_count ?? 0;
      }
      return activeSortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [cleanSessions, currentFilter, searching, query, activeSort, activeSortDir]);

  // Clamp selection when list changes
  useEffect(() => {
    if (selectedIndex >= visible.length) {
      setSelectedIndex(Math.max(0, visible.length - 1));
    }
  }, [visible.length, selectedIndex]);

  useInput((input, key) => {
    // ── Search input mode ──
    if (searching) {
      if (key.escape) {
        setSearching(false);
        setQuery('');
        setSelectedIndex(0);
        return;
      }
      if (key.return) {
        if (visible.length > 0) pickSession(visible[selectedIndex].id);
        return;
      }
      if (key.upArrow) { setSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSelectedIndex(i => Math.min(visible.length - 1, i + 1)); return; }
      if (key.backspace || key.delete) {
        setQuery(q => q.slice(0, -1));
        setSelectedIndex(0);
        return;
      }
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
        setQuery(q => q + input);
        setSelectedIndex(0);
        return;
      }
      return;
    }

    // ── Browse mode ──
    if (key.escape) { onBack(); return; }
    if (input === '/') {
      setSearching(true);
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    if (key.tab) {
      setFocusZone(z => z === 'filters' ? 'sorts' : z === 'sorts' ? 'list' : 'filters');
      return;
    }
    if (key.leftArrow) {
      if (focusZone === 'filters') {
        setFilterIdx(i => (i - 1 + FILTERS.length) % FILTERS.length);
        setSelectedIndex(0);
      } else if (focusZone === 'sorts') {
        setSortIdx(i => (i - 1 + SORTS.length) % SORTS.length);
      }
      return;
    }
    if (key.rightArrow) {
      if (focusZone === 'filters') {
        setFilterIdx(i => (i + 1) % FILTERS.length);
        setSelectedIndex(0);
      } else if (focusZone === 'sorts') {
        setSortIdx(i => (i + 1) % SORTS.length);
      }
      return;
    }
    if (key.return) {
      if (focusZone === 'sorts') {
        const k = SORTS[sortIdx];
        setSortDirByKey(prev => ({ ...prev, [k]: prev[k] === 'asc' ? 'desc' : 'asc' }));
        setSelectedIndex(0);
        return;
      }
      if (visible.length > 0) pickSession(visible[selectedIndex].id);
      return;
    }
    if (key.upArrow && focusZone === 'list') setSelectedIndex(i => Math.max(0, i - 1));
    if (key.downArrow && focusZone === 'list') setSelectedIndex(i => Math.min(visible.length - 1, i + 1));
  });

  // ── Render ──

  const titleMax = Math.max(20, Math.min(70, width - 8));
  const fullWidth = Math.max(0, width - 4);
  const sepLine = '─'.repeat(Math.max(20, Math.min(60, width - 6)));

  const headerRows = searching ? 8 : 4;
  const footerRows = searching ? 2 : 0;
  const rowsPerItem = 4; // conservative: line wraps + divider safety margin
  const maxItems = Math.max(5, Math.floor((height - headerRows - footerRows) / rowsPerItem));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxItems / 2), Math.max(0, visible.length - maxItems)));
  const end = Math.min(visible.length, start + maxItems);
  const windowed = visible.slice(start, end);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header / filter tabs */}
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1} flexDirection="column">
        <Box>
          <Text color="#e62050">sessions  </Text>
          {FILTERS.map((f, i) => {
            const isActive = i === filterIdx;
            const label = `[ ${f} ${counts[f]} ]`;
            return (
              <Text key={f}>
                <Text
                  backgroundColor={isActive ? '#e62050' : undefined}
                  color={isActive ? '#0F0F0F' : '#A0A0A0'}
                >
                  {label}
                </Text>
                <Text> </Text>
              </Text>
            );
          })}
        </Box>
        <Box>
          <Text color="#505050">sort  </Text>
          {SORTS.map((s, i) => {
            const isSelected = i === sortIdx;
            const dir = sortDirByKey[s] === 'asc' ? 'a-z' : 'z-a';
            const selectedInFocus = isSelected && focusZone === 'sorts';
            return (
              <Text key={s}>
                <Text
                  backgroundColor={selectedInFocus ? '#e62050' : undefined}
                  color={selectedInFocus ? '#0F0F0F' : '#A0A0A0'}
                >
                  [ {s} {dir} ]
                </Text>
                <Text> </Text>
              </Text>
            );
          })}
        </Box>
        <Text color="#505050">
          {searching
            ? '  type to filter · ↑↓ nav · enter open · esc clear'
            : `  tab focus(${focusZone}) · ←→ move · enter ${focusZone === 'sorts' ? 'toggle sort' : 'open'} · / search · esc back`}
        </Text>
      </Box>

      {/* Search input */}
      {searching && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Box>
            <Text color="#e62050">filter: </Text>
            <Text color="#F0F0F0">{query}</Text>
            <Text color="#505050">_</Text>
          </Box>
          <Text color="#505050">  cost:&gt;N  calls:&gt;N  tok:&gt;Nk  skill:name  file:name  failed  today</Text>
        </Box>
      )}

      {/* Sessions list */}
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        {visible.length === 0 && searching && query && (
          <Text color="#505050">  no sessions match filter</Text>
        )}
        {visible.length === 0 && !(searching && query) && (
          <Text color="#505050">  no sessions in this filter</Text>
        )}

        {windowed.map((session, idx) => {
          const i = start + idx;
          const isSelected = i === selectedIndex;
          const isLive = currentSessionId && session.id === currentSessionId;
          const badge = isLive ? '● live' : '';
          const status = statusLabel(session);
          const titleText = `"${truncate(session.title ?? '', titleMax)}"`;
          const line1 = `${badge}  ${session.key}  ${formatRelativeTime(session.created_at)}  ${session.call_count} calls  ${formatTokens(session.total_tokens)}  ${formatCost(session.total_cost)}  ${status.text}`;
          const line1Clipped = clipLine(line1, Math.max(10, fullWidth - 3));
          const titleClipped = clipLine(titleText, Math.max(10, fullWidth - 12));

          if (isSelected) {
            return (
              <Box key={session.id} flexDirection="column">
                <Text backgroundColor="#e62050" color="#0F0F0F">{('► ' + line1Clipped).padEnd(fullWidth)}</Text>
                <Text backgroundColor="#e62050" color="#0F0F0F">{('  ' + titleClipped).padEnd(fullWidth)}</Text>
                {i < visible.length - 1 && <Text color="#2A2A2A">  {sepLine}</Text>}
              </Box>
            );
          }

          return (
            <Box key={session.id} flexDirection="column">
              <Text>
                <Text color={isLive ? '#e62050' : '#505050'}>  {badge ? `${badge}  ` : ''}</Text>
                <Text color="#F0F0F0">{session.key}</Text>
                <Text color="#505050">  {formatRelativeTime(session.created_at)}  </Text>
                <Text color="#A0A0A0">{session.call_count} calls  {formatTokens(session.total_tokens)}  {formatCost(session.total_cost)}  </Text>
                <Text color={status.mauve ? '#e62050' : '#A0A0A0'}>{status.text}</Text>
              </Text>
              <Text color="#505050">          {titleClipped}</Text>
              {i < visible.length - 1 && <Text color="#2A2A2A">  {sepLine}</Text>}
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      {searching && (
        <Box marginTop={1} paddingX={1}>
          <Text color="#505050">{visible.length} session{visible.length === 1 ? '' : 's'} match  ·  esc clear  ·  enter open</Text>
        </Box>
      )}
    </Box>
  );
}
