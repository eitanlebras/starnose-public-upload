import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { isProxyRunning } from '../../api.js';
import chalk from 'chalk';

const accent = chalk.hex('#c4607a');

export async function commandDig(sessionId?: string): Promise<void> {
  const running = await isProxyRunning();
  if (!running) {
    console.log(accent('✗ daemon not running — snose on'));
    process.exit(1);
  }

  const { waitUntilExit } = render(<App initialSessionId={sessionId} />);
  await waitUntilExit();
}
