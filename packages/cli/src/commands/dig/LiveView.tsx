import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { CallData } from './types.js';
import { formatTokens, formatDuration, circledNumber, formatRelativeTime } from '../../format.js';
import { fetchApi } from '../../api.js';

interface Props {
  calls: CallData[];
  sessionKey: string;
  onBack: () => void;
}

export function LiveView({ calls, sessionKey, onBack }: Props) {
  const [liveCall, setLiveCall] = useState<any>(null);

  useInput((input, key) => {
    if (key.escape || input === 'w') { onBack(); return; }
  });

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const live = await fetchApi('/internal/live');
        setLiveCall(live && live.sessionId ? live : null);
      } catch { /* ignore */ }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Files read this session
  const filesRead: Map<string, number> = new Map();
  for (const call of calls) {
    const toolCalls: any[] = safeJsonParse(call.tool_calls, []);
    for (const tc of toolCalls) {
      if (['Read', 'read_file', 'view', 'cat'].includes(tc.toolName)) {
        const input = tc.toolInput ?? '';
        const match = input.match(/[^/\\]+\.[a-z]+/i);
        const name = match ? match[0] : input.slice(0, 30);
        filesRead.set(name, (filesRead.get(name) ?? 0) + 1);
      }
    }
  }

  // Context growth
  const maxTokens = Math.max(...calls.map(c => c.token_count_input), 1);
  const barMaxWidth = 40;

  // Bash commands
  const bashCmds: { cmd: string; result: string; callIndex: number }[] = [];
  for (const call of calls) {
    const toolCalls: any[] = safeJsonParse(call.tool_calls, []);
    for (const tc of toolCalls) {
      if (['Bash', 'bash', 'run_command'].includes(tc.toolName)) {
        bashCmds.push({
          cmd: (tc.toolInput ?? '').slice(0, 30),
          result: (tc.toolResult ?? '').slice(0, 30),
          callIndex: call.call_index,
        });
      }
    }
  }

  const elapsed = liveCall?.startTime ? Date.now() - liveCall.startTime : 0;
  const lastActivity = liveCall?.lastActivityAt ? Date.now() - liveCall.lastActivityAt : 0;
  const lastSecs = Math.floor(lastActivity / 1000);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1}>
        <Text color="#9D7F8C">live activity</Text>
        <Text color="#505050">                        {sessionKey}</Text>
      </Box>

      {liveCall?.sessionId ? (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text color="#F0F0F0">call {circledNumber(liveCall.callIndex ?? calls.length + 1)}  in progress</Text>
          {liveCall.toolName && <Text color="#A0A0A0">action   {liveCall.toolName}</Text>}
          <Text color="#A0A0A0">elapsed  {formatDuration(elapsed)}</Text>
          {lastSecs > 120 ? (
            <Text color="#9D7F8C">status   ✗ likely stuck — consider ctrl+c</Text>
          ) : lastSecs > 30 ? (
            <Text color="#9D7F8C">status   ⚠ no activity for {lastSecs}s</Text>
          ) : (
            <Text color="#A0A0A0">status   ● alive  (activity {lastSecs}s ago)</Text>
          )}
        </Box>
      ) : (
        <Box marginTop={1} paddingX={2}>
          <Text color="#505050">waiting for claude code...</Text>
        </Box>
      )}

      <Box marginTop={1} paddingX={2}>
        <Text color="#505050">──────────────────────────────────────────────────</Text>
      </Box>

      {/* Files read */}
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text color="#F0F0F0">files read this session</Text>
        {[...filesRead.entries()].slice(0, 10).map(([name, count], i) => (
          <Text key={i} color="#A0A0A0">  {name.padEnd(30)} ×{count}</Text>
        ))}
        {filesRead.size === 0 && <Text color="#505050">  (none yet)</Text>}
      </Box>

      <Box marginTop={1} paddingX={2}>
        <Text color="#505050">──────────────────────────────────────────────────</Text>
      </Box>

      {/* Context growth */}
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text color="#F0F0F0">context growth</Text>
        {calls.map((call, i) => {
          const barWidth = Math.max(1, Math.floor((call.token_count_input / maxTokens) * barMaxWidth));
          const bar = '█'.repeat(barWidth);
          const isLast = i === calls.length - 1;
          const isCompaction = !!call.compaction_detected;
          const isPeak = call.token_count_input === maxTokens;

          return (
            <Box key={call.id}>
              <Text color="#505050">{circledNumber(call.call_index)}  {formatTokens(call.token_count_input).padEnd(8)}</Text>
              <Text color={isCompaction ? '#9D7F8C' : '#A0A0A0'}>{bar}</Text>
              <Text color="#505050">
                {isPeak ? ' ⚠ peak' : isCompaction ? ' ⚡ compacted' : isLast ? ' ← now' : ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Bash commands */}
      {bashCmds.length > 0 && (
        <>
          <Box marginTop={1} paddingX={2}>
            <Text color="#505050">──────────────────────────────────────────────────</Text>
          </Box>
          <Box flexDirection="column" marginTop={1} paddingX={2}>
            <Text color="#F0F0F0">bash commands run this session</Text>
            {bashCmds.slice(-8).map((bc, i) => (
              <Text key={i} color="#A0A0A0">  {bc.cmd.padEnd(25)} → {bc.result}</Text>
            ))}
          </Box>
        </>
      )}

      <Box marginTop={1} paddingX={2}>
        <Text color="#505050">esc or w: back</Text>
      </Box>
    </Box>
  );
}

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
