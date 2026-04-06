import React from 'react';
import { Box, Text } from 'ink';
import { CallData } from './types.js';
import {
  formatTokens, formatCost, formatLatency, formatDuration,
  circledNumber,
} from '../../format.js';

interface Props {
  calls: CallData[];
  selectedIndex: number;
  sessionKey: string;
  width: number;
}

export function TreeView({ calls, selectedIndex, sessionKey, width }: Props) {
  const totalLatency = calls.reduce((s, c) => s + c.latency_ms, 0);
  const totalTokens = calls.reduce((s, c) => s + c.token_count_input + (c.token_count_cache_read ?? 0) + c.token_count_output, 0);
  const totalCost = calls.reduce((s, c) => s + c.estimated_cost_usd, 0);

  return (
    <Box flexDirection="column">
      {calls.map((call, i) => {
        const isSelected = i === selectedIndex;
        const isLast = i === calls.length - 1;
        const subConnector = isLast ? '  ' : '│ ';

        const idx = circledNumber(call.call_index);
        const lat = formatLatency(call.latency_ms);
        const totalIn = call.token_count_input + (call.token_count_cache_read ?? 0);
        const tok = formatTokens(totalIn);
        const costStr = formatCost(call.estimated_cost_usd);
        const cursor = isSelected ? '►' : ' ';

        const breakdown: any = safeJsonParse(call.system_breakdown ?? 'null', null);
        const toolCalls: any[] = safeJsonParse(call.tool_calls, []);

        const isCompaction = !!call.compaction_detected;
        const isFailed = call.status === 'error';

        // Skills sorted by token count, max 3
        const skillsWithTokens: { name: string; tokens: number }[] = breakdown?.skills ?? [];
        const sortedSkills = [...skillsWithTokens].sort((a, b) => b.tokens - a.tokens);
        const shownSkills = sortedSkills.slice(0, 3);
        const moreSkills = Math.max(0, sortedSkills.length - 3);

        // Files read — deduplicated filenames
        const reads = toolCalls.filter(t => ['Read', 'read_file', 'view', 'cat'].includes(t.toolName));
        const readNames = [...new Set(reads.map(t => {
          const input = t.toolInput ?? '';
          const m = input.match(/[^/\\]+\.[a-z]+/i);
          return m ? m[0] : input.slice(0, 20);
        }))];
        const shownReads = readNames.slice(0, 3);
        const moreReads = Math.max(0, reads.length - 3);

        return (
          <Box key={call.id} flexDirection="column">
            {/* PRIMARY LINE — one line per call */}
            {isCompaction ? (
              <Box>
                <Text color={isSelected ? '#9D7F8C' : '#505050'}>  {cursor} </Text>
                <Text color="#9D7F8C">{idx}  {lat.padStart(7)}   {tok.padStart(10)}   {costStr.padStart(7)}   ⚡ {call.summary}</Text>
              </Box>
            ) : (
              <Box>
                <Text color={isSelected ? '#9D7F8C' : '#505050'}>  {cursor} </Text>
                <Text color={isFailed ? '#9D7F8C' : '#F0F0F0'}>{idx}</Text>
                <Text color="#505050">  {lat.padStart(7)}   {tok.padStart(10)}   {costStr.padStart(7)}   {isFailed ? '✗ ' : ''}{call.summary}</Text>
              </Box>
            )}

            {/* Subline 1: skills (max 3, with token counts) */}
            {shownSkills.length > 0 && (
              <Box>
                <Text color="#505050">    {subConnector}    skills: {shownSkills.map(s => `${s.name}(${formatTokens(s.tokens)})`).join(' · ')}{moreSkills > 0 ? ` · +${moreSkills} more` : ''}</Text>
              </Box>
            )}

            {/* Subline 2: files read */}
            {shownReads.length > 0 && (
              <Box>
                <Text color="#505050">    {subConnector}    read: {shownReads.join(' · ')}{moreReads > 0 ? ` · +${moreReads} more` : ''}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="#505050">  ──────────────────────────────────────────────────</Text>
      </Box>
      <Box>
        <Text color="#505050">  total: {formatDuration(totalLatency)}   {formatTokens(totalTokens)}   {formatCost(totalCost)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="#505050">  ↑↓ nav  enter inspect  r refresh  f flame  / search  s sessions  ? keys  q quit</Text>
      </Box>
    </Box>
  );
}

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
