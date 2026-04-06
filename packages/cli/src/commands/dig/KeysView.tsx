import React from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  onBack: () => void;
}

const BINDINGS = [
  ['↑ ↓', 'navigate calls'],
  ['← →', 'collapse / expand'],
  ['enter', 'inspect call'],
  ['w', 'live activity view'],
  ['f', 'token flame graph'],
  ['/', 'search sessions'],
  ['s', 'sessions browser'],
  ['space', 'pause / resume live'],
  ['?', 'close this'],
  ['q', 'quit'],
  ['esc', 'back / close'],
];

export function KeysView({ onBack }: Props) {
  useInput((input, key) => {
    if (key.escape || input === '?') { onBack(); return; }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="#2A2A2A" paddingX={1} flexDirection="column">
        <Text color="#c4607a">  starnose keybindings</Text>
        <Text>{' '}</Text>
        {BINDINGS.map(([key, desc], i) => (
          <Text key={i} color="#A0A0A0">
            {'  '}{key.padEnd(10)} {desc}
          </Text>
        ))}
        <Text>{' '}</Text>
      </Box>
    </Box>
  );
}
