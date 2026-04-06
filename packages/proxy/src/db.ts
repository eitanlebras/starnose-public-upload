import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STARNOSE_DIR = join(homedir(), '.starnose');
const DB_PATH = join(STARNOSE_DIR, 'starnose.db');

let _db: Database.Database | null = null;

export function getDbPath(): string {
  return DB_PATH;
}

export function getStarnoseDir(): string {
  return STARNOSE_DIR;
}

export function ensureDir(): void {
  if (!existsSync(STARNOSE_DIR)) {
    mkdirSync(STARNOSE_DIR, { recursive: true });
  }
}

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;
  ensureDir();
  _db = new Database(dbPath ?? DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

export function resetDb(dbPath?: string): Database.Database {
  if (_db) {
    _db.close();
    _db = null;
  }
  const db = new Database(dbPath ?? DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('DROP TABLE IF EXISTS sessions_fts');
  db.exec('DROP TABLE IF EXISTS snapshots');
  db.exec('DROP TABLE IF EXISTS calls');
  db.exec('DROP TABLE IF EXISTS sessions');

  initSchema(db);
  _db = db;
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      key             TEXT UNIQUE,
      title           TEXT,
      created_at      INTEGER NOT NULL,
      status          TEXT DEFAULT 'active',
      call_count      INTEGER DEFAULT 0,
      total_tokens    INTEGER DEFAULT 0,
      total_cost      REAL DEFAULT 0,
      last_status     TEXT DEFAULT 'running',
      peak_tokens     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS calls (
      id                    TEXT PRIMARY KEY,
      session_id            TEXT NOT NULL,
      call_index            INTEGER NOT NULL,
      timestamp             INTEGER NOT NULL,
      model                 TEXT,
      request_body          TEXT,
      response_body         TEXT,
      system_prompt         TEXT,
      thinking              TEXT,
      latency_ms            INTEGER DEFAULT 0,
      token_count_input     INTEGER DEFAULT 0,
      token_count_output    INTEGER DEFAULT 0,
      token_count_thinking  INTEGER DEFAULT 0,
      token_count_cache_creation INTEGER DEFAULT 0,
      token_count_cache_read INTEGER DEFAULT 0,
      estimated_cost_usd    REAL DEFAULT 0,
      tool_calls            TEXT,
      status                TEXT DEFAULT 'success',
      summary               TEXT,
      system_breakdown      TEXT,
      skills_detected       TEXT,
      missing_context       TEXT,
      compaction_detected   INTEGER DEFAULT 0,
      tokens_before_compaction INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id            TEXT PRIMARY KEY,
      call_id       TEXT NOT NULL,
      session_id    TEXT NOT NULL,
      call_index    INTEGER NOT NULL,
      file_tree     TEXT,
      file_contents TEXT,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calls_session ON calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_calls_index ON calls(session_id, call_index);
  `);

  // Create FTS table if not exists
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        session_id UNINDEXED,
        title,
        content,
        tokenize='porter ascii'
      );
    `);
  } catch {
    // FTS table may already exist
  }

  // Create trigger if not exists
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS sessions_fts_update
      AFTER INSERT ON calls BEGIN
        INSERT INTO sessions_fts(session_id, title, content)
        SELECT s.id, s.title, COALESCE(NEW.system_prompt, '') || ' ' || COALESCE(NEW.request_body, '')
        FROM sessions s WHERE s.id = NEW.session_id;
      END;
    `);
  } catch {
    // Trigger may already exist
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
