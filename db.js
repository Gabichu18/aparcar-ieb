// Tiny database layer. Uses Postgres when DATABASE_URL is set (e.g. a free Neon database),
// otherwise a local SQLite file (handy for trying the app on your own computer).
// Queries are written with ? placeholders and work on both.
const path = require('node:path');
const fs = require('node:fs');

const TABLES = (pg) => `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id ${pg ? 'BIGSERIAL' : 'INTEGER'} PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_codes (
    id ${pg ? 'BIGSERIAL' : 'INTEGER'} PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plates (
    plate TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sub_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id ${pg ? 'BIGSERIAL' : 'INTEGER'} PRIMARY KEY,
    reporter_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    plate TEXT NOT NULL,
    zone TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS alerts_reporter ON alerts(reporter_id, created_at);
  CREATE INDEX IF NOT EXISTS alerts_owner ON alerts(owner_id, created_at);
  CREATE INDEX IF NOT EXISTS alerts_plate ON alerts(plate, created_at);
  CREATE TABLE IF NOT EXISTS checkin_prefs (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    time TEXT NOT NULL,
    last_sent TEXT
  );
  CREATE TABLE IF NOT EXISTS spot_reports (
    id ${pg ? 'BIGSERIAL' : 'INTEGER'} PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    zone TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS spot_reports_time ON spot_reports(created_at);
  CREATE TABLE IF NOT EXISTS telegram_chats (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS telegram_links (
    code TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  );
`;

// Columns added after the first version (added automatically to existing databases).
const NEW_COLUMNS = [['spot_x', 'REAL'], ['spot_y', 'REAL'], ['spot', 'TEXT'], ['reminded', 'INTEGER'], ['escalated', 'INTEGER']];

async function openDb() {
  if (process.env.DATABASE_URL) {
    const { Pool, types } = require('pg');
    types.setTypeParser(20, (v) => Number(v)); // BIGINT -> JS number (timestamps, ids, counts)
    const url = process.env.DATABASE_URL;
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
    const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };
    const db = {
      kind: 'postgres',
      async all(sql, ...p) { return (await pool.query(toPg(sql), p)).rows; },
      async get(sql, ...p) { return (await pool.query(toPg(sql), p)).rows[0]; },
      async run(sql, ...p) { await pool.query(toPg(sql), p); },
    };
    await pool.query(TABLES(true));
    for (const [col, type] of NEW_COLUMNS) await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    return db;
  }

  const { DatabaseSync } = require('node:sqlite');
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const s = new DatabaseSync(path.join(dir, 'app.db'));
  s.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  s.exec(TABLES(false));
  const have = s.prepare('PRAGMA table_info(alerts)').all().map((c) => c.name);
  for (const [col, type] of NEW_COLUMNS) if (!have.includes(col)) s.exec(`ALTER TABLE alerts ADD COLUMN ${col} ${type}`);
  return {
    kind: 'sqlite',
    async all(sql, ...p) { return s.prepare(sql).all(...p); },
    async get(sql, ...p) { return s.prepare(sql).get(...p); },
    async run(sql, ...p) { s.prepare(sql).run(...p); },
  };
}

module.exports = { openDb };
