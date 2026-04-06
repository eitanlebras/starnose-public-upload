import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';

interface CallContext {
  port: number;
  db: Database.Database;
}

export default async function thinkingDetection({ port, db }: CallContext): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Thinking/extended thinking requires a real API key and a model that supports it.
  // claude-haiku-4-5 supports extended thinking with budget_tokens.
  if (!apiKey) {
    // Without a real key, we send a request that will fail at upstream but
    // the proxy still records it. However, thinking tokens come from the response,
    // so we cannot validate thinking detection without a real call.
    // We do a minimal structural test: send the request, verify it is recorded.
    const body = {
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      stream: false,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [{ role: 'user', content: 'What is 15 * 37? Think step by step.' }],
    };

    await fetch(`http://localhost:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk-ant-test-fake-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    await new Promise(r => setTimeout(r, 100));

    const calls = db.prepare('SELECT * FROM calls ORDER BY call_index ASC').all() as any[];
    assert.ok(calls.length >= 1, 'Call should be recorded even on error');
    // Can't assert thinking tokens without real response, just confirm recording
    return;
  }

  // Real API call with extended thinking
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    stream: false,
    thinking: { type: 'enabled', budget_tokens: 1024 },
    messages: [{ role: 'user', content: 'What is 15 * 37? Think carefully step by step.' }],
  };

  const res = await fetch(`http://localhost:${port}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  assert.ok(res.ok, `Expected 200, got ${res.status}: ${await res.clone().text()}`);
  const resBody = await res.json();

  // The response should contain a thinking block
  const hasThinking = Array.isArray(resBody.content) &&
    resBody.content.some((b: any) => b.type === 'thinking');
  assert.ok(hasThinking, 'Response should contain a thinking block');

  await new Promise(r => setTimeout(r, 100));

  const calls = db.prepare('SELECT * FROM calls ORDER BY call_index ASC').all() as any[];
  assert.ok(calls.length >= 1, `Expected at least 1 call, got ${calls.length}`);

  const call = calls[0] as any;

  // Assert thinking content was captured
  assert.ok(call.thinking, 'calls.thinking should be non-null');
  assert.ok(call.thinking.length > 0, 'calls.thinking should have content');

  // Assert thinking token count > 0
  assert.ok(
    call.token_count_thinking > 0,
    `token_count_thinking should be > 0, got ${call.token_count_thinking}`
  );
}
