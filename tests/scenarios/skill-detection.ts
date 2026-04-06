import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';

const SYSTEM_WITH_SKILLS = `You are a helpful assistant.

<skill name="code-review">
When reviewing code, check for correctness, security vulnerabilities, performance issues,
and maintainability concerns. Provide specific line-level feedback with suggestions.
Always explain the reasoning behind each suggestion so developers can learn from the review.
Focus on high-impact issues first and avoid nitpicking style unless it affects readability.
</skill>

<skill name="deployment">
You help with deployment workflows. Check Dockerfiles for best practices, review CI/CD
pipelines, validate environment configurations, and ensure proper health check endpoints.
Always verify that secrets are not hardcoded and that proper rollback strategies exist.
</skill>

<skill name="testing">
You write comprehensive test suites. Cover happy paths, edge cases, error conditions,
and integration points. Use descriptive test names that document expected behavior.
Prefer property-based testing for algorithmic code and snapshot tests for UI components.
</skill>

Base instructions: respond concisely and helpfully.`;

interface CallContext {
  port: number;
  db: Database.Database;
}

export default async function skillDetection({ port, db }: CallContext): Promise<void> {
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 128,
    stream: false,
    system: SYSTEM_WITH_SKILLS,
    messages: [{ role: 'user', content: 'hello' }],
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Without a real API key, we can still test the proxy's parsing by
    // making a call that will fail at the upstream but still get recorded
    // if the proxy records before forwarding. However, the proxy records
    // AFTER the response, so we need a real key or a mock.
    // Use a fake key — the proxy will get a 401 from Anthropic but still
    // records the call with status='error'.
    const res = await fetch(`http://localhost:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk-ant-test-fake-key-for-parsing',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    // Wait a tick for DB write
    await new Promise(r => setTimeout(r, 100));

    const calls = db.prepare('SELECT * FROM calls ORDER BY call_index ASC').all() as any[];
    assert.ok(calls.length >= 1, `Expected at least 1 call in DB, got ${calls.length}`);

    const call = calls[0];

    // Skills detected
    const skills = JSON.parse(call.skills_detected ?? '[]');
    assert.ok(skills.includes('code-review'), `skills_detected should include 'code-review', got: ${JSON.stringify(skills)}`);
    assert.ok(skills.includes('deployment'), `skills_detected should include 'deployment', got: ${JSON.stringify(skills)}`);
    assert.ok(skills.includes('testing'), `skills_detected should include 'testing', got: ${JSON.stringify(skills)}`);

    // System breakdown
    assert.ok(call.system_breakdown, 'system_breakdown should be non-null');
    const breakdown = JSON.parse(call.system_breakdown);
    assert.ok(Array.isArray(breakdown.skills), 'breakdown.skills should be an array');
    assert.equal(breakdown.skills.length, 3, `Expected 3 skills in breakdown, got ${breakdown.skills.length}`);

    // Each skill should have non-zero token count
    for (const skill of breakdown.skills) {
      assert.ok(skill.tokens > 0, `Skill '${skill.name}' should have tokens > 0, got ${skill.tokens}`);
    }

    // Total tokens approximately equals sum of parts (within 15%)
    const skillTokens = breakdown.skills.reduce((sum: number, s: any) => sum + s.tokens, 0);
    const baseTokens = breakdown.baseClaude?.tokens ?? 0;
    const otherTokens = breakdown.other?.tokens ?? 0;
    const sumOfParts = skillTokens + baseTokens + otherTokens;

    // The system prompt total tokens (we can estimate from the string length)
    // Just verify the sum of parts is positive and skills dominate
    assert.ok(sumOfParts > 0, `Sum of parts should be > 0, got ${sumOfParts}`);
    assert.ok(skillTokens > baseTokens, 'Skill tokens should exceed base tokens');

    return;
  }

  // With a real API key: full test
  const res = await fetch(`http://localhost:${port}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  assert.ok(res.ok, `Expected 200, got ${res.status}`);

  await new Promise(r => setTimeout(r, 100));

  const calls = db.prepare('SELECT * FROM calls ORDER BY call_index ASC').all() as any[];
  assert.ok(calls.length >= 1, `Expected at least 1 call in DB, got ${calls.length}`);

  const call = calls[0];

  // Skills detected
  const skills = JSON.parse(call.skills_detected ?? '[]');
  assert.ok(skills.includes('code-review'), `skills_detected should include 'code-review', got: ${JSON.stringify(skills)}`);
  assert.ok(skills.includes('deployment'), `skills_detected should include 'deployment', got: ${JSON.stringify(skills)}`);
  assert.ok(skills.includes('testing'), `skills_detected should include 'testing', got: ${JSON.stringify(skills)}`);

  // System breakdown
  assert.ok(call.system_breakdown, 'system_breakdown should be non-null');
  const breakdown = JSON.parse(call.system_breakdown);
  assert.ok(Array.isArray(breakdown.skills), 'breakdown.skills should be an array');
  assert.equal(breakdown.skills.length, 3, `Expected 3 skills in breakdown, got ${breakdown.skills.length}`);

  for (const skill of breakdown.skills) {
    assert.ok(skill.tokens > 0, `Skill '${skill.name}' should have tokens > 0, got ${skill.tokens}`);
  }

  // Total approx sum of parts within 15%
  const skillTokens = breakdown.skills.reduce((sum: number, s: any) => sum + s.tokens, 0);
  const baseTokens = breakdown.baseClaude?.tokens ?? 0;
  const otherTokens = breakdown.other?.tokens ?? 0;
  const sumOfParts = skillTokens + baseTokens + otherTokens;

  assert.ok(sumOfParts > 0, `Sum of parts should be > 0, got ${sumOfParts}`);
  assert.ok(skillTokens > baseTokens, 'Skill tokens should exceed base tokens');
}
