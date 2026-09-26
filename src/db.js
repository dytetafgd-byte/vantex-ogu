// db.js — sqlite connection + schema bootstrap. Synchronous, so no async bugs.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Zawsze obok pliku server.js — działa niezależnie od katalogu uruchomienia.
const DB_PATH = (process.env.DB_PATH && process.env.DB_PATH.trim())
  || join(here, '..', 'ogu.db');

export const db = new Database(DB_PATH);
console.log('Baza danych:', DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate() {
  const sql = readFileSync(join(here, '..', 'schema.sql'), 'utf8');
  db.exec(sql);
  seedBadges();
}

function seedBadges() {
  const now = Date.now();
  const rows = [
    ['star', 'Star', '⭐', 250],
    ['verified', 'Verified', '✅', 500],
    ['flame', 'Flame', '🔥', 400],
    ['moon', 'Moon', '🌙', 350],
    ['skull', 'Skull', '💀', 450],
    ['pumpkin', 'Pumpkin', '🎃', 300],
    ['crown', 'Crown', '👑', 900],
    ['diamond', 'Diamond', '💎', 800],
    ['ghost', 'Ghost', '👻', 375],
    ['spider', 'Spider', '🕷️', 325],
  ];
  const ins = db.prepare(
    `INSERT INTO badges (slug,label,emoji,price,custom,created_at)
     VALUES (?,?,?,?,0,?) ON CONFLICT(slug) DO NOTHING`
  );
  const tx = db.transaction(() => rows.forEach(r => ins.run(r[0], r[1], r[2], r[3], now)));
  tx();
}

// --- tiny helpers so route code stays readable -------------------------
export const one = (sql, ...args) => db.prepare(sql).get(...args);
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);