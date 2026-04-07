// Pro users table in ~/.starnose/starnose.db
// Minimal, synchronous, SQLite-backed. Does not touch any existing schema
// managed by the proxy — only creates/uses its own pro_users table.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  const dir = path.join(os.homedir(), '.starnose');
  mkdirSync(dir, { recursive: true });
  const d = new Database(path.join(dir, 'starnose.db'));
  d.pragma('journal_mode = WAL');
  d.exec(`
    CREATE TABLE IF NOT EXISTS pro_users (
      email TEXT PRIMARY KEY,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT,
      current_period_end INTEGER,
      updated_at INTEGER
    )
  `);
  _db = d;
  return d;
}

export function upsertProUser(row: {
  email: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  status: string;
  current_period_end?: number | null;
}) {
  db()
    .prepare(
      `INSERT INTO pro_users
         (email, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)
       VALUES (@email, @stripe_customer_id, @stripe_subscription_id, @status, @current_period_end, @updated_at)
       ON CONFLICT(email) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         status = excluded.status,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`,
    )
    .run({
      email: row.email.toLowerCase(),
      stripe_customer_id: row.stripe_customer_id ?? null,
      stripe_subscription_id: row.stripe_subscription_id ?? null,
      status: row.status,
      current_period_end: row.current_period_end ?? null,
      updated_at: Date.now(),
    });
}

export function isPro(email: string): boolean {
  if (!email) return false;
  const row = db()
    .prepare('SELECT status, current_period_end FROM pro_users WHERE email = ?')
    .get(email.toLowerCase()) as { status?: string; current_period_end?: number } | undefined;
  if (!row) return false;
  const active = row.status === 'active' || row.status === 'trialing';
  if (!active) return false;
  if (row.current_period_end && row.current_period_end * 1000 < Date.now()) return false;
  return true;
}
