// badges.js — badge catalog + granting.
// Admin-created custom badges are the only way a badge is made by hand, and
// they are 1-20 chars with an emoji.
import { one, all, run } from './db.js';

// Bought badges are rendered as an emoji next to the name by the client.
// Custom badges carry their emoji from the catalog row.
export function badgesFor(userId) {
  return all(
    `SELECT b.slug, b.label, b.emoji, b.custom FROM user_badges ub
     JOIN badges b ON b.id = ub.badge_id
     WHERE ub.user_id = ? ORDER BY b.price DESC`,
    userId
  );
}

export function allBadges() {
  return all('SELECT * FROM badges ORDER BY custom, price ASC');
}

// Only "x" reaches this. label is the 1-20 char string, emoji is the glyph
// that shows up beside a username.
export function createCustomBadge(admin, { label, emoji, price }) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  if (typeof label !== 'string' || label.trim().length < 1 || label.trim().length > 20) {
    return { error: 'Custom badges must be 1-20 characters.' };
  }
  const glyph = (emoji || '🏷️').trim().slice(0, 8); // a couple of codepoints max
  const slug = 'custom-' + label.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18)
    + '-' + Math.random().toString(36).slice(2, 6);
  const p = Number.isFinite(+price) ? Math.max(0, Math.floor(+price)) : 750;
  run(`INSERT INTO badges (slug,label,emoji,price,custom,created_at)
       VALUES (?,?,?,?,1,?)`, slug, label.trim(), glyph, p, Date.now());
  return { ok: true, badge: one('SELECT * FROM badges WHERE slug = ?', slug) };
}

export function grantBadge(admin, userId, badgeId) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  if (!one('SELECT id FROM badges WHERE id = ?', badgeId)) return { error: 'No such badge.' };
  if (!one('SELECT id FROM users WHERE id = ?', userId)) return { error: 'No such user.' };
  run(`INSERT INTO user_badges (user_id,badge_id,granted_by,created_at)
       VALUES (?,?,?,?) ON CONFLICT DO NOTHING`, userId, badgeId, admin.id, Date.now());
  return { ok: true };
}

export function revokeBadge(admin, userId, badgeId) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  const info = run('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?',
    userId, badgeId);
  if (!info.changes) return { error: 'They do not have that badge.' };
  return { ok: true };
}

export function deleteBadge(admin, badgeId) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  run('DELETE FROM badges WHERE id = ?', badgeId);
  return { ok: true };
}