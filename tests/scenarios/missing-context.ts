import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';

interface CallContext {
  port: number;
  db: Database.Database;
}

async function sendProxyCall(
  port: number,
  messages: any[],
  system?: string
): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? 'sk-ant-test-fake-key';

  const body: any = {
    model: 'claude-haiku-4-5',
    max_tokens: 128,
    stream: false,
    messages,
  };
  if (system) body.system = system;

  return fetch(`http://localhost:${port}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
}

export default async function missingContext({ port, db }: CallContext): Promise<void> {
  const system = 'You are a helpful coding assistant.';

  // Call A: Contains instruction "don't modify tests"
  await sendProxyCall(port, [
    { role: 'user', content: 'Help me refactor this project' },
    { role: 'assistant', content: 'Sure, I can help with that.' },
    { role: 'user', content: "don't modify any test files" },
    { role: 'assistant', content: 'Understood, I will leave test files untouched.' },
    { role: 'user', content: 'Start with the utils module' },
  ], system);

  await new Promise(r => setTimeout(r, 200));

  // Verify call A was recorded
  const callsAfterA = db.prepare('SELECT * FROM calls ORDER BY call_index ASC').all() as any[];
  assert.ok(callsAfterA.length >= 1, `Expected at least 1 call after A, got ${callsAfterA.length}`);

  // Call B: Same session (within 30s gap), but the instruction is GONE (simulates compaction)
  await sendProxyCall(port, [
    { role: 'user', content: 'Start with the utils module' },
    { role: 'assistant', content: 'I will refactor the utils module now.' },
    { role: 'user', content: 'Now do the auth module' },
  ], system);

  await new Promise(r => setTimeout(r, 200));

  const allCalls = db.prepare('SELECT * FROM calls ORDER BY call_index ASC').all() as any[];
  assert.ok(allCalls.length >= 2, `Expected at least 2 calls, got ${allCalls.length}`);

  const callB = allCalls[1] as any;

  // Call B should have detected missing context
  assert.ok(callB.missing_context, 'Call B should have non-null missing_context');
  const missing = JSON.parse(callB.missing_context);
  assert.ok(Array.isArray(missing), 'missing_context should be an array');
  assert.ok(missing.length > 0, `missing_context should be non-empty, got ${JSON.stringify(missing)}`);

  // The lost instruction should be about not modifying test files
  const hasLostInstruction = missing.some(
    (m: any) => typeof m.content === 'string' && m.content.includes("don't modify any test files")
  );
  assert.ok(
    hasLostInstruction,
    `missing_context should contain the lost instruction about test files, got: ${JSON.stringify(missing)}`
  );
}
