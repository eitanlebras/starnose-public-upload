// Waitlist storage with two backends:
//   - sqlite (default for local dev): ~/.starnose/waitlist.db
//   - firestore (Cloud Run): set WAITLIST_BACKEND=firestore
//
// Both backends are loaded dynamically so the unused one is not bundled
// or required at runtime in the deployed image.

export type WaitlistResult =
  | { ok: true; count: number }
  | { ok: false; reason: 'duplicate' | 'error' };

interface Backend {
  add(email: string, ip: string): Promise<WaitlistResult>;
  count(): Promise<number>;
}

let backendPromise: Promise<Backend> | null = null;

function pickBackend(): Promise<Backend> {
  const choice = process.env.WAITLIST_BACKEND?.toLowerCase() ||
    (process.env.GOOGLE_CLOUD_PROJECT ? 'firestore' : 'sqlite');
  return choice === 'firestore' ? loadFirestore() : loadSqlite();
}

export function getBackend(): Promise<Backend> {
  if (!backendPromise) backendPromise = pickBackend();
  return backendPromise;
}

// ── SQLite backend ────────────────────────────────────────────────
async function loadSqlite(): Promise<Backend> {
  const [{ default: Database }, { mkdirSync }, os, path] = await Promise.all([
    import('better-sqlite3'),
    import('node:fs'),
    import('node:os'),
    import('node:path'),
  ]);

  const dir = path.join(os.homedir(), '.starnose');
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'waitlist.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT UNIQUE,
      created_at INTEGER,
      ip TEXT
    )
  `);
  const insert = db.prepare('INSERT INTO waitlist (email, created_at, ip) VALUES (?, ?, ?)');
  const countStmt = db.prepare('SELECT COUNT(*) as c FROM waitlist');

  return {
    async add(email, ip) {
      try {
        insert.run(email, Date.now(), ip);
      } catch (err: any) {
        if (typeof err?.code === 'string' && err.code.includes('SQLITE_CONSTRAINT')) {
          return { ok: false, reason: 'duplicate' };
        }
        return { ok: false, reason: 'error' };
      }
      const row = countStmt.get() as { c: number };
      return { ok: true, count: row.c };
    },
    async count() {
      const row = countStmt.get() as { c: number };
      return row.c;
    },
  };
}

// ── Firestore backend ────────────────────────────────────────────
async function loadFirestore(): Promise<Backend> {
  // @google-cloud/firestore is CJS; dynamic import shape varies depending on
  // whether Next bundles it or leaves it external. Handle both.
  const mod: any = await import('@google-cloud/firestore');
  const Firestore = mod.Firestore || mod.default?.Firestore || mod.default;
  const fs = new Firestore();
  const col = fs.collection('waitlist');

  const totalCount = async (): Promise<number> => {
    const snap = await col.count().get();
    return snap.data().count;
  };

  return {
    async add(email, ip) {
      const docId = encodeURIComponent(email);
      const ref = col.doc(docId);
      try {
        const created = await fs.runTransaction(async (tx: any) => {
          const existing = await tx.get(ref);
          if (existing.exists) return false;
          tx.set(ref, { email, created_at: Date.now(), ip });
          return true;
        });
        if (!created) return { ok: false, reason: 'duplicate' };
      } catch {
        return { ok: false, reason: 'error' };
      }
      try {
        return { ok: true, count: await totalCount() };
      } catch {
        return { ok: true, count: 0 };
      }
    },
    async count() {
      try {
        return await totalCount();
      } catch {
        return 0;
      }
    },
  };
}
