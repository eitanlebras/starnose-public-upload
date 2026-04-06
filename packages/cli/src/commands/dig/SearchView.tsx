import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionData } from './types.js';
import { fetchApi } from '../../api.js';
import { formatTokens, formatRelativeTime } from '../../format.js';

interface Props {
  onBack: () => void;
  onSelect: (sessionId: string) => void;
}

interface ParsedFilters {
  q: string;
  file: string;
  skill: string;
  outcome: string;
  costOp: string;
  costVal: string;
}

function parseQuery(input: string): ParsedFilters {
  let remaining = input;
  const f: ParsedFilters = { q: '', file: '', skill: '', outcome: '', costOp: '', costVal: '' };

  const fileMatch = remaining.match(/\bfile:(\S+)/);
  if (fileMatch) { f.file = fileMatch[1]; remaining = remaining.replace(fileMatch[0], ''); }

  const skillMatch = remaining.match(/\bskill:(\S+)/);
  if (skillMatch) { f.skill = skillMatch[1]; remaining = remaining.replace(skillMatch[0], ''); }

  const costMatch = remaining.match(/\bcost:([><])(\$?)([\d.]+)/);
  if (costMatch) { f.costOp = costMatch[1]; f.costVal = costMatch[3]; remaining = remaining.replace(costMatch[0], ''); }

  const outcomeMatch = remaining.match(/\b(failed|success)\b/);
  if (outcomeMatch) { f.outcome = outcomeMatch[1]; remaining = remaining.replace(outcomeMatch[0], ''); }

  f.q = remaining.trim();
  return f;
}

function hasFilters(f: ParsedFilters): boolean {
  return !!(f.file || f.skill || f.outcome || f.costOp);
}

function buildUrl(f: ParsedFilters): string {
  if (!f.q && !hasFilters(f)) return '';
  if (hasFilters(f)) {
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.file) p.set('file', f.file);
    if (f.skill) p.set('skill', f.skill);
    if (f.outcome) p.set('outcome', f.outcome);
    if (f.costOp) { p.set('cost_op', f.costOp); p.set('cost_val', f.costVal); }
    return `/internal/search-advanced?${p.toString()}`;
  }
  return `/internal/search?q=${encodeURIComponent(f.q)}`;
}

export function SearchView({ onBack, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SessionData[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filters = parseQuery(query);
  const showHint = !query.trim();

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.return && results.length > 0) { onSelect(results[selectedIndex].id); return; }
    if (key.upArrow) { setSelectedIndex(Math.max(0, selectedIndex - 1)); return; }
    if (key.downArrow) { setSelectedIndex(Math.min(results.length - 1, selectedIndex + 1)); return; }
    if (key.backspace || key.delete) { setQuery(q => q.slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta && input.length === 1) { setQuery(q => q + input); }
  });

  useEffect(() => {
    const url = buildUrl(filters);
    if (!url) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetchApi<SessionData[]>(url);
        setResults(res);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1}>
        <Text color="#c4607a">search sessions</Text>
        <Text color="#505050">                       [esc to close]</Text>
      </Box>

      <Box paddingX={2} gap={1}>
        <Text color="#c4607a">/ </Text>
        <Text color="#F0F0F0">{query}</Text>
        <Text color="#c4607a">_</Text>
      </Box>

      {hasFilters(filters) && (
        <Box paddingX={4} gap={1} marginBottom={1}>
          {filters.file   && <Text color="#7EC8A0">[file:{filters.file}]</Text>}
          {filters.skill  && <Text color="#7EB8C8">[skill:{filters.skill}]</Text>}
          {filters.costOp && <Text color="#C8B87E">[cost:{filters.costOp}{filters.costVal}]</Text>}
          {filters.outcome && (
            <Text color={filters.outcome === 'failed' ? '#C87E7E' : '#7EC8A0'}>[{filters.outcome}]</Text>
          )}
        </Box>
      )}

      {showHint && (
        <Box paddingX={2} marginTop={1}>
          <Text color="#3A3A3A">  file:path   skill:name   cost:{'>'}0.50   failed   success</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {results.map((session, i) => {
          const isSelected = i === selectedIndex;
          const isOld = Date.now() - session.created_at > 7 * 24 * 60 * 60 * 1000;

          return (
            <Box key={session.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text backgroundColor={isSelected ? '#c4607a' : undefined} color={isSelected ? '#0F0F0F' : '#F0F0F0'}>
                  {isSelected ? '►' : ' '}  {session.key}   {formatRelativeTime(session.created_at)}    "{session.title}"
                </Text>
              </Box>
              <Box>
                <Text color="#505050">
                  {'               '}{session.call_count} calls · {formatTokens(session.total_tokens)} · {session.last_status === 'running' ? '● active' : '✓ ' + (session.last_status ?? 'done')}
                </Text>
              </Box>
              {isOld && (
                <Text color="#505050">               [locked — upgrade $19/mo]</Text>
              )}
            </Box>
          );
        })}
        {query && results.length === 0 && (
          <Text color="#505050">no results</Text>
        )}
        {results.length > 0 && (
          <Text color="#505050">{results.length} sessions found</Text>
        )}
      </Box>
    </Box>
  );
}
