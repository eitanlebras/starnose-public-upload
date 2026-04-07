import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { isProxyRunning } from '../../api.js';
import chalk from 'chalk';

const accent = chalk.hex('#e62050');

export async function commandDig(sessionId?: string): Promise<void> {
  const running = await isProxyRunning();
  if (!running) {
    console.log(accent('✗ daemon not running — snose on'));
    process.exit(1);
  }

  // Use alternate screen buffer so view switches fully replace the screen
  // and do not leave previous inspector frames in scrollback.
  const out = process.stdout;
  const canAltScreen = !!out.isTTY;
  if (canAltScreen) {
    out.write('\x1b[?1049h');
    out.write('\x1b[2J\x1b[H');
  }

  try {
    const { waitUntilExit } = render(<App initialSessionId={sessionId} />);
    await waitUntilExit();
  } finally {
    if (canAltScreen) {
      out.write('\x1b[?1049l');
    }
  }
}
