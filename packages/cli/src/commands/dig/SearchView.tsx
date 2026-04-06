import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionData } from './types.js';
import { fetchApi } from '../../api.js';
import { formatTokens, formatCost, formatRelativeTime } from '../../format.js';

interface Props {
  onBack: () => void;
  onSelect: (sessionId: string) => void;
}

export function SearchView({ onBack, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SessionData[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.return && results.length > 0) {
      onSelect(results[selectedIndex].id);
      return;
    }
    if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
    if (key.downArrow) setSelectedIndex(Math.min(results.length - 1, selectedIndex + 1));
    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && input.length === 1) {
      setQuery(q => q + input);
    }
  });

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetchApi<SessionData[]>(`/internal/search?q=${encodeURIComponent(query)}`);
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
        <Text color="#9D7F8C">search sessions</Text>
        <Text color="#505050">                       [esc to close]</Text>
      </Box>
      <Box paddingX={2}>
        <Text color="#9D7F8C">/ </Text>
        <Text color="#F0F0F0">{query}</Text>
        <Text color="#9D7F8C">_</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {results.map((session, i) => {
          const isSelected = i === selectedIndex;
          const isOld = Date.now() - session.created_at > 7 * 24 * 60 * 60 * 1000;

          return (
            <Box key={session.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text backgroundColor={isSelected ? '#9D7F8C' : undefined} color={isSelected ? '#0F0F0F' : '#F0F0F0'}>
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
