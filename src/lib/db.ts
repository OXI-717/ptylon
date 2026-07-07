import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function getAppRoot(): string {
  if (process.env.WEB_CONSOLE_ROOT) return process.env.WEB_CONSOLE_ROOT;

  const cwd = process.cwd();
  if (cwd.endsWith(path.join('.next', 'standalone'))) {
    return path.resolve(cwd, '..', '..');
  }

  return cwd;
}

const DB_PATH = process.env.WEB_CONSOLE_DB_PATH || path.join(getAppRoot(), 'data', 'web-console.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    // Create table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_state (
        id TEXT PRIMARY KEY DEFAULT 'default',
        data TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }
  return db;
}

export function loadWorkspaceState(): string | null {
  const row = getDb().prepare('SELECT data FROM workspace_state WHERE id = ?').get('default') as { data: string } | undefined;
  return row?.data ?? null;
}

export function saveWorkspaceState(data: string): void {
  getDb().prepare(`
    INSERT INTO workspace_state (id, data, updated_at) VALUES ('default', ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
  `).run(data);
}
