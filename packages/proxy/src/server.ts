import { createServer, IncomingMessage, ServerResponse } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getDbPath } from './db.js';
import { estimateCost } from './pricing.js';
import {
  parseSystemPrompt,
  extractToolCalls,
  extractToolCallsFromResponse,
  extractUserMessages,
  detectMissingContext,
} from './parsing.js';
import { getOrCreateSession, getNextCallIndex, updateSessionStats, type SessionSignals } from './sessions.js';
import { addSSEClient, broadcast, stopSSE } from './sse.js';
import { setLiveCall, getLiveCall, updateLiveActivity } from './live.js';
import { processAnthropicStream } from './streaming.js';
import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ANTHROPIC_API = 'https://api.anthropic.com';
const OPENAI_API = 'https://api.openai.com';
const STARNOSE_DIR = join(homedir(), '.starnose');

function isRecording(): boolean {
  try {
    return existsSync(join(STARNOSE_DIR, 'recording'));
  } catch {
    return false;
  }
}

let liveProgressInterval: NodeJS.Timeout | null = null;

function logValidationError(message: string, details: any): void {
  const logPath = join(STARNOSE_DIR, 'starnose.log');
  const entry = `[${new Date().toISOString()}] VALIDATION: ${message}\n${JSON.stringify(details, null, 2).slice(0, 2000)}\n\n`;
  try {
    appendFileSync(logPath, entry);
  } catch { /* ignore */ }
}

function generateSummary(
  reqBody: any,
  resBody: any,
  toolCalls: any[],
  status: string,
  compactionDetected: boolean,
  tokensBefore?: number,
  tokensAfter?: number
): string {
  if (status === 'error') {
    const errMsg = resBody?.error?.message ?? resBody?.error ?? 'unknown error';
    const errStr = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg);
    return `✗ ${errStr.slice(0, 50)}`;
  }
  if (compactionDetected && tokensBefore && tokensAfter) {
    const before = tokensBefore >= 1000 ? `${(tokensBefore / 1000).toFixed(0)}k` : `${tokensBefore}`;
    const after = tokensAfter >= 1000 ? `${(tokensAfter / 1000).toFixed(0)}k` : `${tokensAfter}`;
    return `⚡ compaction: ${before}→${after} tok`;
  }

  const messages = reqBody?.messages ?? [];
  const hasUser = messages.some((m: any) => m.role === 'user');
  const hasToolResult = messages.some((m: any) =>
    Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
  );

  if (toolCalls.length > 0) {
    const first = toolCalls[0];
    const argSnippet = first.toolInput?.slice(0, 30) ?? '';
    if (hasUser) return `user → tool: ${first.toolName}(${argSnippet})`;
    if (hasToolResult) return `tool result → response`;
    return `tool: ${first.toolName}(${argSnippet})`;
  }

  if (!hasUser && messages.length <= 1) return 'system prompt loaded';
  if (hasToolResult) return 'tool result → response';
  if (hasUser) return 'user → response';
  return 'response';
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function sendJSON(res: ServerResponse, status: number, data: any): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  });
  res.end(body);
}

function handleCORS(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }
  return false;
}

async function handleInternalRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  url: URL
): Promise<boolean> {
  const db = getDb();

  if (pathname === '/internal/health') {
    sendJSON(res, 200, { status: 'ok', timestamp: Date.now() });
    return true;
  }

  if (pathname === '/internal/events') {
    addSSEClient(req, res);
    return true;
  }

  if (pathname === '/internal/live') {
    sendJSON(res, 200, getLiveCall() ?? {});
    return true;
  }

  if (pathname === '/internal/sessions') {
    const rows = db.prepare(
      'SELECT * FROM sessions ORDER BY created_at DESC LIMIT 100'
    ).all();
    sendJSON(res, 200, rows);
    return true;
  }

  if (pathname === '/internal/session/current') {
    const { getCurrentSessionId } = await import('./sessions.js');
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      sendJSON(res, 200, null);
      return true;
    }
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    sendJSON(res, 200, session ?? null);
    return true;
  }

  const sessionMatch = pathname.match(/^\/internal\/session\/(.+)$/);
  if (sessionMatch) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? OR key = ?')
      .get(sessionMatch[1], sessionMatch[1]);
    sendJSON(res, 200, session ?? null);
    return true;
  }

  const callsMatch = pathname.match(/^\/internal\/calls\/(.+)$/);
  if (callsMatch) {
    const rows = db.prepare(
      'SELECT * FROM calls WHERE session_id = ? ORDER BY call_index ASC'
    ).all(callsMatch[1]);
    sendJSON(res, 200, rows);
    return true;
  }

  if (pathname === '/internal/search') {
    const q = url.searchParams.get('q') ?? '';
    if (!q) {
      sendJSON(res, 200, []);
      return true;
    }
    try {
      const rows = db.prepare(`
        SELECT DISTINCT s.*
        FROM sessions_fts fts
        JOIN sessions s ON s.id = fts.session_id
        WHERE sessions_fts MATCH ?
        ORDER BY s.created_at DESC
        LIMIT 20
      `).all(q);
      sendJSON(res, 200, rows);
    } catch {
      sendJSON(res, 200, []);
    }
    return true;
  }

  return false;
}

async function transparentForward(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  bodyStr: string,
  isAnthropicFormat: boolean
): Promise<void> {
  const authHeader = req.headers['authorization'] ?? '';
  let apiKey = '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.slice(7);
  }
  if (!apiKey) {
    apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  }

  const baseUrl = isAnthropicFormat ? ANTHROPIC_API : OPENAI_API;
  const targetUrl = `${baseUrl}${pathname}`;

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isAnthropicFormat) {
    fetchHeaders['x-api-key'] = apiKey;
    fetchHeaders['anthropic-version'] = (req.headers['anthropic-version'] as string) ?? '2023-06-01';
    for (const [key, val] of Object.entries(req.headers)) {
      if (key.startsWith('anthropic-') && typeof val === 'string') {
        fetchHeaders[key] = val;
      }
    }
  } else {
    fetchHeaders['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const fetchResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: fetchHeaders,
      body: bodyStr,
    });

    // Forward all response headers
    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
    };
    fetchResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'transfer-encoding') {
        responseHeaders[key] = value;
      }
    });

    if (fetchResponse.body) {
      res.writeHead(fetchResponse.status, responseHeaders);
      const reader = fetchResponse.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          try { res.write(value); } catch { break; }
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } else {
      const text = await fetchResponse.text();
      res.writeHead(fetchResponse.status, responseHeaders);
      res.end(text);
    }
  } catch (err: any) {
    sendJSON(res, 502, { error: `Proxy error: ${err.message}` });
  }
}

async function proxyToAPI(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  bodyStr: string,
  isAnthropicFormat: boolean
): Promise<void> {
  const startTime = Date.now();
  let reqBody: any;

  try {
    reqBody = JSON.parse(bodyStr);
  } catch {
    sendJSON(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  // Extract API key
  const authHeader = req.headers['authorization'] ?? '';
  let apiKey = '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.slice(7);
  }
  if (!apiKey) {
    apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  }

  // Determine target
  const baseUrl = isAnthropicFormat ? ANTHROPIC_API : OPENAI_API;
  const targetUrl = `${baseUrl}${pathname}`;

  // Extract data from request
  const requestModel = reqBody.model ?? 'unknown';
  const systemPrompt = typeof reqBody.system === 'string'
    ? reqBody.system
    : Array.isArray(reqBody.system)
      ? reqBody.system.map((s: any) => typeof s === 'string' ? s : s.text ?? '').join('\n')
      : '';
  const messages = reqBody.messages ?? [];

  // Extract user messages for session title and signals
  const userMessages = extractUserMessages(messages);
  const lastUserMsg = userMessages.length > 0
    ? userMessages[userMessages.length - 1]
    : '';

  // Detect fresh conversation: only system + 1 user message, no tool results or assistant turns
  const hasToolResult = messages.some((m: any) =>
    Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
  );
  const assistantCount = messages.filter((m: any) => m.role === 'assistant').length;
  const userCount = messages.filter((m: any) => m.role === 'user').length;
  const isFreshConversation = userCount <= 1 && assistantCount === 0 && !hasToolResult;

  // Session management with full signal hierarchy
  const claudeSessionHeader = (req.headers['x-claude-session-id'] as string)
    ?? (req.headers['x-session-id'] as string)
    ?? undefined;

  const sessionSignals: SessionSignals = {
    claudeSessionHeader,
    userMessageText: lastUserMsg,
    messageCount: messages.length,
    userMessageCount: userCount,
    isFreshConversation,
    // totalInputTokens set after we get the response — for first call we don't have it yet
  };

  const sessionId = getOrCreateSession(sessionSignals);
  const callIndex = getNextCallIndex(sessionId);
  const callId = uuidv4();

  // Set live call
  setLiveCall({
    sessionId,
    callIndex,
    startTime,
    status: 'in_progress',
    lastActivityAt: Date.now(),
  });

  broadcast({
    type: 'call_started',
    sessionId,
    callIndex,
    timestamp: Date.now(),
  });

  // Start progress emitter
  if (!liveProgressInterval) {
    liveProgressInterval = setInterval(() => {
      const live = getLiveCall();
      if (live && live.status === 'in_progress') {
        broadcast({
          type: 'call_progress',
          sessionId: live.sessionId,
          callIndex: live.callIndex,
          elapsedMs: Date.now() - live.startTime,
          lastActivityMs: Date.now() - live.lastActivityAt,
          toolName: live.toolName,
        });
      }
    }, 1000);
  }

  // Build fetch headers
  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isAnthropicFormat) {
    fetchHeaders['x-api-key'] = apiKey;
    fetchHeaders['anthropic-version'] = (req.headers['anthropic-version'] as string) ?? '2023-06-01';
    for (const [key, val] of Object.entries(req.headers)) {
      if (key.startsWith('anthropic-') && typeof val === 'string') {
        fetchHeaders[key] = val;
      }
    }
  } else {
    fetchHeaders['Authorization'] = `Bearer ${apiKey}`;
  }

  const isStreaming = reqBody.stream === true;

  let status = 'success';
  let model = requestModel;
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let thinkingContent: string | null = null;
  let textContent = '';
  let responseBody: any = null;
  let toolCallsFromResponse: any[] = [];

  try {
    const fetchResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: fetchHeaders,
      body: bodyStr,
    });

    if (!fetchResponse.ok && !isStreaming) {
      const errorText = await fetchResponse.text();
      status = 'error';
      responseBody = { error: errorText };
      res.writeHead(fetchResponse.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(errorText);
    } else if (isStreaming && fetchResponse.body) {
      // Stream response: write headers to caller, then stream chunks
      // progressively while also buffering for analysis
      res.writeHead(fetchResponse.status, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const result = await processAnthropicStream(
        fetchResponse,
        // Write each chunk to caller immediately
        (chunk: string) => {
          try { res.write(chunk); } catch { /* client disconnected */ }
        },
      );
      res.end();

      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      thinkingTokens = result.thinkingTokens;
      cacheCreationTokens = result.cacheCreationTokens;
      cacheReadTokens = result.cacheReadTokens;
      thinkingContent = result.thinkingContent || null;
      textContent = result.textContent;
      responseBody = result.fullResponse;
      toolCallsFromResponse = result.toolUseBlocks;

      // Use model from response (most reliable)
      if (result.model) {
        model = result.model;
      }
    } else {
      // Non-streaming response
      const responseText = await fetchResponse.text();
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = { raw: responseText };
      }

      // Use model from response (most reliable), fall back to request
      if (responseBody.model) {
        model = responseBody.model;
      }

      // Extract tokens from response
      if (responseBody.usage) {
        inputTokens = responseBody.usage.input_tokens ?? 0;
        outputTokens = responseBody.usage.output_tokens ?? 0;
        cacheCreationTokens = responseBody.usage.cache_creation_input_tokens ?? 0;
        cacheReadTokens = responseBody.usage.cache_read_input_tokens ?? 0;
      }

      // Extract thinking and text
      if (Array.isArray(responseBody.content)) {
        for (const block of responseBody.content) {
          if (block.type === 'thinking' && block.thinking) {
            thinkingContent = block.thinking;
            thinkingTokens = Math.ceil(block.thinking.length / 4);
          }
          if (block.type === 'text' && block.text) {
            textContent = block.text;
          }
          if (block.type === 'tool_use') {
            toolCallsFromResponse.push(block);
          }
        }
      }

      res.writeHead(fetchResponse.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(responseText);
    }
  } catch (err: any) {
    status = 'error';
    responseBody = { error: err.message };
    sendJSON(res, 502, { error: `Proxy error: ${err.message}` });
  }

  const latencyMs = Date.now() - startTime;

  // Cost calculation with cache pricing
  const cost = estimateCost({
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    thinkingTokens,
  });

  // Validation: log warnings for suspicious values on real calls
  if (status === 'success') {
    if (!model || model === 'unknown') {
      logValidationError('model is unknown', { callId, requestModel, responseModel: responseBody?.model });
    }
    if (inputTokens === 0) {
      logValidationError('input_tokens is 0', { callId, model, responseUsage: responseBody?.usage });
    }
    if (inputTokens > 0 && inputTokens < 100 && systemPrompt) {
      logValidationError('input_tokens suspiciously low for call with system prompt', {
        callId, model, inputTokens, cacheReadTokens, cacheCreationTokens,
        responseUsage: responseBody?.usage,
      });
    }
    if (outputTokens === 0) {
      logValidationError('output_tokens is 0', { callId, model, responseUsage: responseBody?.usage });
    }
    if (cost === 0) {
      logValidationError('cost is 0', { callId, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens });
    }
    if (latencyMs === 0) {
      logValidationError('latency is 0', { callId });
    }
  }

  // Parse system prompt
  const systemBreakdown = systemPrompt ? parseSystemPrompt(systemPrompt) : null;
  const skillsDetected = systemBreakdown?.skills.map(s => s.name) ?? [];

  // Extract tool calls from request messages and response
  const requestToolCalls = extractToolCalls(messages);
  const responseToolCallsInfo = extractToolCallsFromResponse(toolCallsFromResponse);
  const allToolCalls = [...requestToolCalls, ...responseToolCallsInfo];

  // Detect compaction — compare against peak of recent calls
  const db = getDb();
  let compactionDetected = false;
  let tokensBefore: number | undefined;

  const totalInputTokens = inputTokens + cacheReadTokens;
  if (callIndex > 1 && totalInputTokens > 0) {
    const recentCalls = db.prepare(
      'SELECT token_count_input, token_count_cache_read FROM calls WHERE session_id = ? AND call_index < ? AND (token_count_input + token_count_cache_read) > 0 ORDER BY call_index DESC LIMIT 5'
    ).all(sessionId, callIndex) as { token_count_input: number; token_count_cache_read: number }[];

    if (recentCalls.length > 0) {
      const peakRecent = Math.max(...recentCalls.map(c => c.token_count_input + (c.token_count_cache_read ?? 0)));
      if (peakRecent > 0 && totalInputTokens < peakRecent * 0.5) {
        compactionDetected = true;
        tokensBefore = peakRecent;
      }
    }
  }

  // Detect missing context
  let missingContext: any[] = [];
  if (callIndex > 1) {
    const prevCalls = db.prepare(
      'SELECT call_index, request_body FROM calls WHERE session_id = ? AND call_index < ? ORDER BY call_index DESC LIMIT 10'
    ).all(sessionId, callIndex) as { call_index: number; request_body: string }[];

    const previousCallsMessages = prevCalls.map(c => {
      let msgs: any[] = [];
      try {
        const body = JSON.parse(c.request_body);
        msgs = body.messages ?? [];
      } catch { /* ignore */ }
      return { callIndex: c.call_index, messages: msgs };
    }).reverse();

    missingContext = detectMissingContext(messages, previousCallsMessages);
  }

  // Generate summary
  const summary = generateSummary(
    reqBody, responseBody, allToolCalls, status,
    compactionDetected, tokensBefore, totalInputTokens
  );

  // Write to database — add cache token columns
  try {
    db.prepare(`
      INSERT INTO calls (
        id, session_id, call_index, timestamp, model,
        request_body, response_body, system_prompt, thinking,
        latency_ms, token_count_input, token_count_output, token_count_thinking,
        token_count_cache_creation, token_count_cache_read,
        estimated_cost_usd, tool_calls, status, summary,
        system_breakdown, skills_detected, missing_context,
        compaction_detected, tokens_before_compaction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      callId, sessionId, callIndex, startTime, model,
      JSON.stringify(reqBody),
      JSON.stringify(responseBody),
      systemPrompt || null,
      thinkingContent,
      latencyMs, inputTokens, outputTokens, thinkingTokens,
      cacheCreationTokens, cacheReadTokens,
      cost,
      JSON.stringify(allToolCalls),
      status, summary,
      systemBreakdown ? JSON.stringify(systemBreakdown) : null,
      JSON.stringify(skillsDetected),
      missingContext.length > 0 ? JSON.stringify(missingContext) : null,
      compactionDetected ? 1 : 0,
      tokensBefore ?? null
    );
  } catch (dbErr: any) {
    // If new columns don't exist yet in existing DB, fall back to old schema
    if (dbErr.message?.includes('token_count_cache')) {
      try {
        db.exec('ALTER TABLE calls ADD COLUMN token_count_cache_creation INTEGER DEFAULT 0');
        db.exec('ALTER TABLE calls ADD COLUMN token_count_cache_read INTEGER DEFAULT 0');
      } catch { /* columns may already exist */ }
      // Retry insert
      db.prepare(`
        INSERT INTO calls (
          id, session_id, call_index, timestamp, model,
          request_body, response_body, system_prompt, thinking,
          latency_ms, token_count_input, token_count_output, token_count_thinking,
          token_count_cache_creation, token_count_cache_read,
          estimated_cost_usd, tool_calls, status, summary,
          system_breakdown, skills_detected, missing_context,
          compaction_detected, tokens_before_compaction
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId, sessionId, callIndex, startTime, model,
        JSON.stringify(reqBody),
        JSON.stringify(responseBody),
        systemPrompt || null,
        thinkingContent,
        latencyMs, inputTokens, outputTokens, thinkingTokens,
        cacheCreationTokens, cacheReadTokens,
        cost,
        JSON.stringify(allToolCalls),
        status, summary,
        systemBreakdown ? JSON.stringify(systemBreakdown) : null,
        JSON.stringify(skillsDetected),
        missingContext.length > 0 ? JSON.stringify(missingContext) : null,
        compactionDetected ? 1 : 0,
        tokensBefore ?? null
      );
    } else {
      throw dbErr;
    }
  }

  // Update session stats
  updateSessionStats(sessionId, totalInputTokens + outputTokens, cost);

  // Clear live call
  setLiveCall(null);

  // Broadcast completion
  broadcast({
    type: 'call_completed',
    sessionId,
    call: {
      callIndex,
      summary,
      latencyMs,
      tokenInput: inputTokens,
      tokenOutput: outputTokens,
      tokenThinking: thinkingTokens,
      tokenCacheCreation: cacheCreationTokens,
      tokenCacheRead: cacheReadTokens,
      cost,
      status,
      model,
      toolCalls: allToolCalls,
      skillsDetected,
      compactionDetected,
      missingContext,
    },
  });

  if (compactionDetected) {
    broadcast({
      type: 'compaction_detected',
      sessionId,
      callIndex,
      tokensBefore: tokensBefore ?? 0,
      tokensAfter: totalInputTokens,
      tokensLost: (tokensBefore ?? 0) - totalInputTokens,
    });
  }
}

export async function createProxyServer(port?: number): Promise<{
  server: ReturnType<typeof createServer>;
  port: number;
}> {
  const startPort = port ?? 3001;

  const server = createServer(async (req, res) => {
    if (handleCORS(req, res)) return;

    const url = new URL(req.url ?? '/', `http://localhost`);
    const pathname = url.pathname;

    // Internal routes
    if (pathname.startsWith('/internal/')) {
      const handled = await handleInternalRoutes(req, res, pathname, url);
      if (handled) return;
      sendJSON(res, 404, { error: 'Not found' });
      return;
    }

    // Model passthrough
    if (pathname === '/v1/models' && req.method === 'GET') {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      try {
        const resp = await fetch(`${ANTHROPIC_API}/v1/models`, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        const text = await resp.text();
        res.writeHead(resp.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(text);
      } catch (err: any) {
        sendJSON(res, 502, { error: err.message });
      }
      return;
    }

    // API proxy routes
    if (req.method === 'POST' && (pathname === '/v1/messages' || pathname === '/v1/chat/completions')) {
      const bodyStr = await readBody(req);
      const isAnthropicFormat = pathname === '/v1/messages';

      // When not recording, just forward transparently
      if (!isRecording()) {
        await transparentForward(req, res, pathname, bodyStr, isAnthropicFormat);
        return;
      }

      await proxyToAPI(req, res, pathname, bodyStr, isAnthropicFormat);
      return;
    }

    sendJSON(res, 404, { error: 'Not found' });
  });

  return new Promise((resolve, reject) => {
    let currentPort = startPort;
    const maxPort = startPort + 10;

    function tryListen() {
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && currentPort < maxPort) {
          currentPort++;
          tryListen();
        } else {
          reject(err);
        }
      });

      server.listen(currentPort, () => {
        // Write port file
        try {
          writeFileSync(join(STARNOSE_DIR, 'port'), String(currentPort));
        } catch { /* ignore */ }
        resolve({ server, port: currentPort });
      });
    }

    tryListen();
  });
}

export function stopServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    stopSSE();
    if (liveProgressInterval) {
      clearInterval(liveProgressInterval);
      liveProgressInterval = null;
    }
    server.close(() => resolve());
  });
}
