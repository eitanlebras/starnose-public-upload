import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionData } from './types.js';
import { fetchApi } from '../../api.js';
import { formatTokens, formatCost, formatRelativeTime, formatTime } from '../../format.js';

interface Props {
  onBack: () => void;
  onSelect: (sessionId: string) => void;
}

export function SessionsView({ onBack, onSelect }: Props) {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.return && sessions.length > 0) {
      const session = sessions[selectedIndex];
      const isOld = Date.now() - session.created_at > 7 * 24 * 60 * 60 * 1000;
      if (!isOld) onSelect(session.id);
      return;
    }
    if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
    if (key.downArrow) setSelectedIndex(Math.min(sessions.length - 1, selectedIndex + 1));
  });

  useEffect(() => {
    fetchApi<SessionData[]>('/internal/sessions')
      .then(setSessions)
      .catch(() => {});
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1}>
        <Text color="#9D7F8C">sessions</Text>
        <Text color="#505050">                      [enter open]  [esc back]</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {sessions.map((session, i) => {
          const isSelected = i === selectedIndex;
          const isOld = Date.now() - session.created_at > 7 * 24 * 60 * 60 * 1000;

          return (
            <Box key={session.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text
                  backgroundColor={isSelected ? '#9D7F8C' : undefined}
                  color={isSelected ? '#0F0F0F' : '#F0F0F0'}
                >
                  {isSelected ? '►' : ' '}  {session.key}   {formatRelativeTime(session.created_at)}
                </Text>
              </Box>
              <Box>
                <Text color="#A0A0A0">   "{session.title}"</Text>
              </Box>
              <Box>
                <Text color="#505050">
                  {'   '}{session.call_count} calls · {formatTokens(session.total_tokens)} · {formatCost(session.total_cost)} · {session.last_status === 'running' ? '● active' : '✓ ' + (session.last_status ?? 'done')}
                </Text>
              </Box>
              {isOld && (
                <>
                  <Text color="#505050">   ────────────────────────────────────────────────</Text>
                  <Text color="#505050">   [locked — upgrade]</Text>
                </>
              )}
            </Box>
          );
        })}

        {sessions.length === 0 && (
          <Text color="#505050">no sessions yet</Text>
        )}
      </Box>
    </Box>
  );
}
