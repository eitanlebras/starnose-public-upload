import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionData } from './types.js';
import { fetchApi } from '../../api.js';
import { formatTokens, formatCost, formatRelativeTime } from '../../format.js';

interface Props {
  onBack: () => void;
  onSelect: (sessionId: string) => void;
}

type QuickFilter = 'all' | 'today' | 'failed' | 'active' | 'expensive';
const QUICK_FILTERS: QuickFilter[] = ['all', 'today', 'failed', 'active', 'expensive'];
const ONE_DAY = 24 * 60 * 60 * 1000;

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

    const m = raw.match(/^(cost|calls|tok|tokens|skill|file):(.+)$/i);
    if (m) {
      const field = m[1].toLowerCase();
      const rest = m[2];

      if (field === 'cost' || field === 'calls' || field === 'tok' || field === 'tokens') {
        const opMatch = rest.match(/^([<>])(.+)$/);
        if (opMatch) {
          const num = parseNumberWithSuffix(opMatch[2]);
          if (num !== null) {
            const f = field === 'tokens' ? 'tok' : field;
            tokens.push({ kind: 'cmp', field: f as 'cost' | 'calls' | 'tok', op: opMatch[1] as '>' | '<', value: num });
            continue;
          }
        }
      } else if (field === 'skill' || field === 'file') {
        tokens.push({ kind: 'sub', field: field as 'skill' | 'file', needle: rest.toLowerCase() });
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

function matchQuickFilter(s: SessionData, f: QuickFilter): boolean {
  if (f === 'all') return true;
  if (f === 'today') return Date.now() - s.created_at < ONE_DAY;
  if (f === 'failed') return s.last_status === 'failed';
  if (f === 'active') return s.last_status === 'running' || s.status === 'active';
  return (s.total_cost ?? 0) > 0.5;
}

function tokenMatches(s: SessionData, t: Token): boolean {
  switch (t.kind) {
    case 'cmp': {
      let v = 0;
      if (t.field === 'cost') v = s.total_cost ?? 0;
      else if (t.field === 'calls') v = s.call_count ?? 0;
      else v = s.total_tokens ?? 0;
      return t.op === '>' ? v > t.value : v < t.value;
    }
    case 'sub': {
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

export function SearchView({ onBack, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [quickFilterIdx, setQuickFilterIdx] = useState(0);

  useEffect(() => {
    fetchApi<SessionData[]>('/internal/sessions')
      .then((rows) => setSessions(rows.filter(s => (s.call_count ?? 0) > 0 || (s.total_tokens ?? 0) > 0))
      )
      .catch(() => setSessions([]));
  }, []);

  const activeQuick = QUICK_FILTERS[quickFilterIdx];
  const tokens = useMemo(() => parseQuery(query), [query]);

  const results = useMemo(() => {
    return sessions
      .filter((s) => matchQuickFilter(s, activeQuick))
      .filter((s) => tokens.every((t) => tokenMatches(s, t)));
  }, [sessions, activeQuick, tokens]);

  useEffect(() => {
    setSelectedIndex((i) => Math.max(0, Math.min(i, Math.max(0, results.length - 1))));
  }, [results.length]);

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }

    if (key.tab) {
      setQuickFilterIdx((i) => (i + 1) % QUICK_FILTERS.length);
      setSelectedIndex(0);
      return;
    }

    if (key.return) {
      if (results.length > 0) onSelect(results[selectedIndex].id);
      return;
    }

    if (key.upArrow) { setSelectedIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setSelectedIndex((i) => Math.min(results.length - 1, i + 1)); return; }

    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      setQuery((q) => q + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1}>
        <Text color="#c4607a">cross-session search</Text>
        <Text color="#505050">                [tab filter] [esc close]</Text>
      </Box>

      <Box paddingX={2} marginTop={1}>
        {QUICK_FILTERS.map((f, i) => {
          const active = i === quickFilterIdx;
          return (
            <Text
              key={f}
              backgroundColor={active ? '#c4607a' : undefined}
              color={active ? '#0F0F0F' : '#505050'}
            >
              {' '}{f}{' '}
            </Text>
          );
        })}
      </Box>

      <Box paddingX={2} gap={1}>
        <Text color="#c4607a">/ </Text>
        <Text color="#F0F0F0">{query}</Text>
        <Text color="#c4607a">_</Text>
      </Box>

      <Box paddingX={2}>
        <Text color="#505050">cost:&gt;N  cost:&lt;N  tok:&gt;Nk  calls:&gt;N  failed  active  today  [text]</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {results.map((session, i) => {
          const isSelected = i === selectedIndex;
          const status = session.last_status === 'failed'
            ? '✗ failed'
            : session.last_status === 'running' || session.status === 'active'
              ? '● active'
              : '✓ done';

          return (
            <Box key={session.id} flexDirection="column" marginBottom={1}>
              <Text backgroundColor={isSelected ? '#c4607a' : undefined} color={isSelected ? '#0F0F0F' : '#F0F0F0'}>
                {isSelected ? '►' : ' '}  {session.key}  {formatRelativeTime(session.created_at)}  "{session.title}"
              </Text>
              <Text color="#505050">
                {'   '}{session.call_count} calls · {formatTokens(session.total_tokens)} · {formatCost(session.total_cost)} · {status}
              </Text>
            </Box>
          );
        })}

        {results.length === 0 && <Text color="#505050">no results</Text>}
        <Text color="#505050">{results.length} session{results.length === 1 ? '' : 's'} found</Text>
      </Box>
    </Box>
  );
}
