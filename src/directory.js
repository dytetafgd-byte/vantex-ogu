// directory.js — search + listings. Membership logic is a single function so
// the API and the page agree, which is where edits to a directory usually rot.
import { all, run, one } from './db.js';

export const MAX_USERNAME = 20;

export function search({ q = '', limit = 50 }) {
  const term = `%${String(q).trim()}%`;
  return all(
    `SELECT u.username, u.bio, u.avatar, u.created_at, u.is_founder,
            (SELECT COUNT(*) FROM user_badges ub WHERE ub.user_id = u.id) AS badge_count,
            (SELECT MIN(price_usd) FROM listings l WHERE l.user_id = u.id AND l.active = 1) AS price
     FROM users u
     WHERE u.banned = 0 AND u.username LIKE ? COLLATE NOCASE
     ORDER BY u.username ASC LIMIT ?`,
    term, Math.min(200, Math.max(1, limit))
  );
}

export function listUsers() {
  return all(
    `SELECT username, avatar, created_at, is_founder FROM users
     WHERE banned = 0 ORDER BY created_at ASC LIMIT 200`
  );
}

// Listings are USD, per the brief.
export function createListing({ user, priceUsd, note }) {
  const price = Number(priceUsd);
  if (!Number.isFinite(price) || price < 0) return { error: 'Enter a USD price.' };
  run(`INSERT INTO listings (user_id,price_usd,note,active,created_at) VALUES (?,?,?,1,?)`,
    user.id, price, String(note || '').slice(0, 200), Date.now());
  return { ok: true };
}

export function deactivateListing(user, listingId) {
  const l = one('SELECT * FROM listings WHERE id = ?', listingId);
  if (!l) return { error: 'No such listing.' };
  if (l.user_id !== user.id && !user.is_admin) return { error: 'Not yours.' };
  run('UPDATE listings SET active = 0 WHERE id = ?', listingId);
  return { ok: true };
}

export function listings() {
  return all(
    `SELECT l.id, l.price_usd, l.note, l.created_at, u.username FROM listings l
     JOIN users u ON u.id = l.user_id WHERE l.active = 1 ORDER BY l.created_at DESC`
  );
}

// Leaderboard: who made the first account, plus the first-five checkmarks.
export function firstAccount() {
  return one('SELECT username, created_at FROM users ORDER BY created_at ASC LIMIT 1');
}

export function founders() {
  return all('SELECT username, created_at FROM users ORDER BY created_at ASC LIMIT 5');
}