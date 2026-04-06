import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';

// 10 minutes — Claude Code regularly pauses 2-5 minutes between calls
const SESSION_GAP_MS = 10 * 60 * 1000;

// If input tokens drop below this, it's a fresh invocation (back to base system prompt)
const NEW_SESSION_TOKEN_THRESHOLD = 15_000;

let currentSessionId: string | null = null;
let currentClaudeSessionHeader: string | null = null;
let lastCallTime = 0;

function generateKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'sn_';
  for (let i = 0; i < 6; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/**
 * Extract the human-readable user intent from a message.
 * Claude Code wraps user input in internal framing — skip that.
 */
function extractCleanTitle(raw: string): string {
  if (!raw || raw.length <= 3) return '';

  let text = raw;

  // Strip XML tags like <system-reminder>, <context>, etc.
  text = text.replace(/<[^>]+>/g, '').trim();

  // Skip common Claude Code internal prefixes
  const skipPrefixes = [
    /^You are\b.*?\n/i,
    /^As (an AI|Claude|a helpful)\b.*?\n/i,
    /^<system.*?\n/i,
    /^# ?(System|Instructions|Context)\b.*?\n/i,
    /^IMPORTANT:.*?\n/i,
  ];
  for (const pat of skipPrefixes) {
    text = text.replace(pat, '').trim();
  }

  // Take the first meaningful line
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
  if (lines.length === 0) return raw.replace(/\n/g, ' ').slice(0, 60).trim();

  return lines[0].slice(0, 60);
}

export interface SessionSignals {
  /** X-Claude-Session-Id or equivalent header */
  claudeSessionHeader?: string;
  /** Total input tokens for this call (fresh + cache_read) */
  totalInputTokens?: number;
  /** Number of messages in the request (including system) */
  messageCount?: number;
  /** Number of user messages */
  userMessageCount?: number;
  /** Whether this looks like a fresh conversation (system + 1 user, no history) */
  isFreshConversation?: boolean;
  /** Raw user message text for title extraction */
  userMessageText?: string;
}

/**
 * Determine session identity for a call.
 * Detection hierarchy:
 *   1. Process identity (X-Claude-Session-Id header)
 *   2. Context size reset (tokens drop to near-base = new invocation)
 *   3. Fresh conversation signal (only system + 1 user message)
 *   4. Time gap (10 minute silence = new session)
 */
export function getOrCreateSession(signals: SessionSignals): string {
  const now = Date.now();
  const db = getDb();

  const needsNew = shouldStartNewSession(signals, now, db);

  if (!needsNew && currentSessionId) {
    lastCallTime = now;

    // Update title if current one is placeholder
    maybeUpdateTitle(db, currentSessionId, signals.userMessageText);

    return currentSessionId;
  }

  // Mark previous session as done
  if (currentSessionId) {
    db.prepare('UPDATE sessions SET status = ?, last_status = ? WHERE id = ?')
      .run('done', 'done', currentSessionId);
  }

  // New session
  const id = uuidv4();
  const key = generateKey();
  const title = extractCleanTitle(signals.userMessageText ?? '') || 'untitled session';

  db.prepare(`
    INSERT INTO sessions (id, key, title, created_at, status, call_count, total_tokens, total_cost)
    VALUES (?, ?, ?, ?, 'active', 0, 0, 0)
  `).run(id, key, title, now);

  currentSessionId = id;
  currentClaudeSessionHeader = signals.claudeSessionHeader ?? null;
  lastCallTime = now;
  return id;
}

function shouldStartNewSession(
  signals: SessionSignals,
  now: number,
  db: ReturnType<typeof getDb>
): boolean {
  // No current session — always start new
  if (!currentSessionId) return true;

  // 1. PROCESS IDENTITY — most reliable
  if (signals.claudeSessionHeader) {
    if (currentClaudeSessionHeader && signals.claudeSessionHeader !== currentClaudeSessionHeader) {
      return true; // Different process
    }
    if (currentClaudeSessionHeader && signals.claudeSessionHeader === currentClaudeSessionHeader) {
      return false; // Same process — definitely same session
    }
    // First time seeing a header — set it and continue with other checks
  }

  // 2. CONTEXT SIZE RESET — second most reliable
  if (signals.totalInputTokens != null && signals.totalInputTokens > 0) {
    const recentCalls = db.prepare(
      'SELECT token_count_input, token_count_cache_read FROM calls WHERE session_id = ? ORDER BY call_index DESC LIMIT 3'
    ).all(currentSessionId) as { token_count_input: number; token_count_cache_read: number }[];

    if (recentCalls.length > 0) {
      const peakRecent = Math.max(...recentCalls.map(
        c => c.token_count_input + (c.token_count_cache_read ?? 0)
      ));

      // Tokens dropped significantly AND new count is near base system prompt size
      if (
        peakRecent > 0 &&
        signals.totalInputTokens < peakRecent * 0.5 &&
        signals.totalInputTokens < NEW_SESSION_TOKEN_THRESHOLD
      ) {
        return true; // Dropped to base = new invocation
      }
    }
  }

  // 3. FRESH CONVERSATION — system + 1 user message, no prior history
  if (signals.isFreshConversation) {
    // Only treat as new session if there are already calls in the current session
    const callCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM calls WHERE session_id = ?'
    ).get(currentSessionId) as { cnt: number } | undefined;

    if ((callCount?.cnt ?? 0) > 0) {
      return true; // New conversation starting after an existing session
    }
  }

  // 4. TIME GAP — least reliable, 10 minute threshold
  if ((now - lastCallTime) >= SESSION_GAP_MS) {
    return true;
  }

  return false;
}

function maybeUpdateTitle(
  db: ReturnType<typeof getDb>,
  sessionId: string,
  userMessageText?: string
): void {
  if (!userMessageText || userMessageText.length <= 3) return;

  const session = db.prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string } | undefined;

  if (session && (session.title === 'untitled session' || session.title.length <= 3)) {
    const cleanTitle = extractCleanTitle(userMessageText);
    if (cleanTitle && cleanTitle !== 'untitled session') {
      db.prepare('UPDATE sessions SET title = ? WHERE id = ?')
        .run(cleanTitle, sessionId);
    }
  }
}

export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export function getNextCallIndex(sessionId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT MAX(call_index) as max_idx FROM calls WHERE session_id = ?'
  ).get(sessionId) as { max_idx: number | null } | undefined;
  return (row?.max_idx ?? 0) + 1;
}

export function updateSessionStats(sessionId: string, tokens: number, cost: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE sessions SET
      call_count = call_count + 1,
      total_tokens = total_tokens + ?,
      total_cost = total_cost + ?,
      peak_tokens = MAX(peak_tokens, total_tokens + ?)
    WHERE id = ?
  `).run(tokens, cost, tokens, sessionId);
}

export function setSessionStatus(sessionId: string, status: string): void {
  const db = getDb();
  db.prepare('UPDATE sessions SET last_status = ? WHERE id = ?').run(status, sessionId);
}

export function resetSessionState(): void {
  currentSessionId = null;
  currentClaudeSessionHeader = null;
  lastCallTime = 0;
}
