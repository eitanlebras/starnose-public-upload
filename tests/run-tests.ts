import { createProxyServer, stopServer, resetDb, closeDb, ensureDir, getStarnoseDir, resetSessionState } from '../packages/proxy/src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_PORT = 3099;

interface Scenario {
  name: string;
  run: (ctx: { port: number; db: ReturnType<typeof resetDb> }) => Promise<void>;
}

async function loadScenarios(): Promise<Scenario[]> {
  const modules = [
    { name: 'skill-detection', path: './scenarios/skill-detection.js' },
    { name: 'thinking-detection', path: './scenarios/thinking-detection.js' },
    { name: 'missing-context', path: './scenarios/missing-context.js' },
    { name: 'live-tracking', path: './scenarios/live-tracking.js' },
    { name: 'search', path: './scenarios/search.js' },
  ];

  const scenarios: Scenario[] = [];
  for (const mod of modules) {
    const m = await import(mod.path);
    scenarios.push({ name: mod.name, run: m.default });
  }
  return scenarios;
}

async function main() {
  ensureDir();

  // Enable recording for tests
  const recordingFile = join(getStarnoseDir(), 'recording');
  writeFileSync(recordingFile, String(Date.now()));

  console.log('Starting proxy on port %d...', TEST_PORT);
  const { server, port } = await createProxyServer(TEST_PORT);
  console.log('Proxy listening on port %d\n', port);

  const scenarios = await loadScenarios();
  const results: { name: string; passed: boolean; duration: number; error?: string }[] = [];

  for (const scenario of scenarios) {
    const db = resetDb();
    resetSessionState();
    const start = performance.now();
    try {
      await scenario.run({ port, db });
      const duration = Math.round(performance.now() - start);
      console.log('\x1b[32m  \u2713 %s\x1b[0m (%dms)', scenario.name, duration);
      results.push({ name: scenario.name, passed: true, duration });
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      const message = err?.message ?? String(err);
      console.log('\x1b[31m  \u2717 %s\x1b[0m (%dms)', scenario.name, duration);
      console.log('    %s', message);
      results.push({ name: scenario.name, passed: false, duration, error: message });
    }
  }

  // Run agent simulation if API key is available
  if (process.env.ANTHROPIC_API_KEY) {
    const db = resetDb();
    resetSessionState();
    const start = performance.now();
    try {
      const agentMod = await import('./agents/claude-code-sim.js');
      await agentMod.default({ port, db });
      const duration = Math.round(performance.now() - start);
      console.log('\x1b[32m  \u2713 claude-code-sim\x1b[0m (%dms)', duration);
      results.push({ name: 'claude-code-sim', passed: true, duration });
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      const message = err?.message ?? String(err);
      console.log('\x1b[31m  \u2717 claude-code-sim\x1b[0m (%dms)', duration);
      console.log('    %s', message);
      results.push({ name: 'claude-code-sim', passed: false, duration, error: message });
    }
  } else {
    console.log('\x1b[33m  - claude-code-sim (skipped: no ANTHROPIC_API_KEY)\x1b[0m');
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  console.log('\n%d/%d passed, %d failed', passed, total, failed);

  // Teardown
  try { unlinkSync(recordingFile); } catch { /* ignore */ }
  closeDb();
  await stopServer(server);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
