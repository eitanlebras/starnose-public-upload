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
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? 'sk-ant-test-fake-key';

  const body: any = {
    model: 'claude-haiku-4-5',
    max_tokens: 128,
    stream: false,
    messages,
  };
  if (system) body.system = system;

  const res = await fetch(`http://localhost:${port}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  // Consume response body to ensure proxy finishes processing
  await res.text();
}

export default async function search({ port, db }: CallContext): Promise<void> {
  // Step 1: Create sessions with content by sending API calls through the proxy.
  // The proxy's FTS trigger inserts into sessions_fts on each call insert,
  // indexing the system prompt and request body.

  // Session 1: about authentication
  await sendProxyCall(
    port,
    [{ role: 'user', content: 'Help me implement auth middleware for the Express server' }],
    'You are an expert in authentication and authorization patterns.'
  );

  await new Promise(r => setTimeout(r, 150));

  // Need a 30+ second gap for a new session, but we can't wait that long in tests.
  // Instead, we work within the same session — the FTS indexes call content
  // per-call via the trigger, so search will find content from any call.

  // Session 1, call 2: about database
  await sendProxyCall(
    port,
    [
      { role: 'user', content: 'Help me implement auth middleware for the Express server' },
      { role: 'assistant', content: 'I can help with auth middleware.' },
      { role: 'user', content: 'Now help me set up the database connection pool with PostgreSQL' },
    ],
    'You are an expert in authentication and database management.'
  );

  await new Promise(r => setTimeout(r, 150));

  // Step 2: Search for "auth" — should return results
  const authRes = await fetch(`http://localhost:${port}/internal/search?q=auth`);
  assert.equal(authRes.status, 200, `Search for 'auth' should return 200`);
  const authResults = await authRes.json() as any[];
  assert.ok(Array.isArray(authResults), 'Search results should be an array');
  assert.ok(authResults.length > 0, `Search for 'auth' should return results, got ${authResults.length}`);

  // Step 3: Search for nonexistent term — should return empty
  const noRes = await fetch(`http://localhost:${port}/internal/search?q=xyznonexistent`);
  assert.equal(noRes.status, 200, `Search for nonexistent should return 200`);
  const noResults = await noRes.json() as any[];
  assert.ok(Array.isArray(noResults), 'Search results should be an array');
  assert.equal(noResults.length, 0, `Search for 'xyznonexistent' should return empty, got ${noResults.length}`);

  // Bonus: search for "database" should also return results
  const dbRes = await fetch(`http://localhost:${port}/internal/search?q=database`);
  assert.equal(dbRes.status, 200);
  const dbResults = await dbRes.json() as any[];
  assert.ok(dbResults.length > 0, `Search for 'database' should return results, got ${dbResults.length}`);

  // Empty query should return empty array
  const emptyRes = await fetch(`http://localhost:${port}/internal/search?q=`);
  assert.equal(emptyRes.status, 200);
  const emptyResults = await emptyRes.json() as any[];
  assert.equal(emptyResults.length, 0, 'Empty query should return empty results');
}
