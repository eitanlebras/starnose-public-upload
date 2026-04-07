import React from 'react';
import { Box, Text, useInput } from 'ink';
import { CallData } from './types.js';
import { formatTokens, formatCost } from '../../format.js';

interface Props {
  calls: CallData[];
  sessionKey: string;
  onBack: () => void;
  width: number;
}

interface Category {
  name: string;
  tokens: number;
  color: string;
  children: { name: string; tokens: number }[];
}

export function FlameView({ calls, sessionKey, onBack, width }: Props) {
  useInput((input, key) => {
    if (key.escape || input === 'f') { onBack(); return; }
  });

  // Aggregate tokens across all calls
  let systemTokens = 0;
  let skillTokensMap: Map<string, number> = new Map();
  let conversationTokens = 0;
  let toolTokens = 0;
  let toolBreakdown: Map<string, { count: number; tokens: number }> = new Map();
  let thinkingTokens = 0;

  for (const call of calls) {
    const breakdown = safeJsonParse<any>(call.system_breakdown ?? 'null', null);
    if (breakdown) {
      systemTokens += breakdown.baseClaude?.tokens ?? 0;
      for (const skill of breakdown.skills ?? []) {
        skillTokensMap.set(skill.name, (skillTokensMap.get(skill.name) ?? 0) + skill.tokens);
      }
    }

    // Estimate conversation tokens
    const totalIn = call.token_count_input;
    const systemPart = breakdown ? (breakdown.baseClaude?.tokens ?? 0) + (breakdown.skills?.reduce((s: number, sk: any) => s + sk.tokens, 0) ?? 0) : 0;
    conversationTokens += Math.max(0, totalIn - systemPart);

    thinkingTokens += call.token_count_thinking;

    // Tool calls
    const tc: any[] = safeJsonParse(call.tool_calls, []);
    for (const t of tc) {
      const name = t.toolName ?? 'unknown';
      const est = Math.ceil(((t.toolInput ?? '').length + (t.toolResult ?? '').length) / 4);
      toolTokens += est;
      const existing = toolBreakdown.get(name) ?? { count: 0, tokens: 0 };
      toolBreakdown.set(name, { count: existing.count + 1, tokens: existing.tokens + est });
    }
  }

  const totalTokens = systemTokens + [...skillTokensMap.values()].reduce((s, v) => s + v, 0) +
    conversationTokens + toolTokens + thinkingTokens;
  const totalCost = calls.reduce((s, c) => s + c.estimated_cost_usd, 0);

  const maxBarWidth = Math.max(20, width - 45);

  const categories: Category[] = [
    {
      name: 'SYSTEM PROMPT',
      tokens: systemTokens + [...skillTokensMap.values()].reduce((s, v) => s + v, 0),
      color: '#e62050',
      children: [
        ...[...skillTokensMap.entries()].map(([name, tokens]) => ({
          name: `skill: ${name}`,
          tokens,
        })),
        { name: 'base', tokens: systemTokens },
      ],
    },
    {
      name: 'CONVERSATION',
      tokens: conversationTokens,
      color: '#F0F0F0',
      children: [],
    },
    {
      name: 'TOOL CALLS',
      tokens: toolTokens,
      color: '#A0A0A0',
      children: [...toolBreakdown.entries()].map(([name, info]) => ({
        name: `${name} ×${info.count}`,
        tokens: info.tokens,
      })),
    },
    {
      name: 'THINKING',
      tokens: thinkingTokens,
      color: '#505050',
      children: [],
    },
  ];

  // Find top cost driver
  let topDriver = '';
  let topDriverPct = 0;
  for (const cat of categories) {
    for (const child of cat.children) {
      const pct = totalTokens > 0 ? (child.tokens / totalTokens) * 100 : 0;
      if (pct > topDriverPct) {
        topDriverPct = pct;
        topDriver = child.name;
      }
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1}>
        <Text color="#e62050">token breakdown  {sessionKey}</Text>
        <Text color="#505050">           [esc to close]</Text>
      </Box>
      <Box paddingX={2}>
        <Text color="#A0A0A0">total: {formatTokens(totalTokens)}  ·  {formatCost(totalCost)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {categories.map((cat, i) => {
          const pct = totalTokens > 0 ? (cat.tokens / totalTokens) * 100 : 0;
          const barWidth = Math.max(1, Math.floor((pct / 100) * maxBarWidth));
          const bar = '█'.repeat(barWidth);

          return (
            <Box key={i} flexDirection="column">
              <Box>
                <Text color={cat.color}>
                  {'  '}{cat.name.padEnd(20)} {bar.padEnd(maxBarWidth + 2)}
                </Text>
                <Text color="#A0A0A0">
                  {formatTokens(cat.tokens).padStart(10)}  {pct.toFixed(0).padStart(3)}%
                </Text>
              </Box>

              {cat.children.map((child, j) => {
                const childPct = totalTokens > 0 ? (child.tokens / totalTokens) * 100 : 0;
                const childBarWidth = Math.max(0, Math.floor((childPct / 100) * maxBarWidth));
                const childBar = '█'.repeat(childBarWidth);

                return (
                  <Box key={j}>
                    <Text color="#505050">
                      {'    '}{child.name.padEnd(18)} {childBar.padEnd(maxBarWidth)}
                    </Text>
                    <Text color="#505050">
                      {formatTokens(child.tokens).padStart(10)}  {childPct.toFixed(0).padStart(3)}%
                    </Text>
                  </Box>
                );
              })}
              <Text>{' '}</Text>
            </Box>
          );
        })}
      </Box>

      {topDriver && (
        <Box paddingX={2}>
          <Text color="#505050">
            ──────────────────────────────────────────────────{'\n'}
            top cost driver: {topDriver} — {topDriverPct.toFixed(0)}% of all tokens
          </Text>
        </Box>
      )}

      <Box marginTop={1} paddingX={2}>
        <Text color="#505050">esc or f: back</Text>
      </Box>
    </Box>
  );
}

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
