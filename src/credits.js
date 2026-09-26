// credits.js — daily reward, badge shop, admin grants.
// Every mutation takes the acting user explicitly so there is exactly one
// place where "can this person do it?" is decided.
import { one, run } from './db.js';

export const DAILY_CREDITS = 5;

export function dailyReward(user) {
  const today = new Date().toISOString().slice(0, 10);
  const last = user.last_reward
    ? new Date(user.last_reward).toISOString().slice(0, 10)
    : '';
  if (last === today) return { ok: false, error: 'Already claimed today.' };
  run('UPDATE users SET credits = credits + ?, last_reward = ? WHERE id = ?',
    DAILY_CREDITS, Date.now(), user.id);
  return { ok: true, credits: DAILY_CREDITS };
}

export function balance(userId) {
  return one('SELECT credits FROM users WHERE id = ?', userId)?.credits ?? 0;
}

// Only an admin moves credits by hand. The signature makes it impossible to
// call this as a normal user, and it refuses an admin paying themselves.
export function adminAdjustCredits(admin, targetUserId, delta) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  if (admin.id === targetUserId) return { error: "You can't adjust your own credits." };
  const target = one('SELECT id, credits FROM users WHERE id = ?', targetUserId);
  if (!target) return { error: 'No such user.' };
  const next = target.credits + Number(delta);
  if (next < 0) return { error: 'That would put them below zero.' };
  run('UPDATE users SET credits = ? WHERE id = ?', next, targetUserId);
  return { ok: true, credits: next };
}

// Buying a badge. Server decides the price; the client only sends a slug.
export function buyBadge(user, badgeSlug) {
  const badge = one('SELECT * FROM badges WHERE slug = ?', badgeSlug);
  if (!badge) return { error: 'No such badge.' };
  const owned = one('SELECT 1 AS x FROM user_badges WHERE user_id = ? AND badge_id = ?',
    user.id, badge.id);
  if (owned) return { error: 'You already own that badge.' };
  if (user.credits < badge.price) return { error: 'Not enough credits.' };
  run('UPDATE users SET credits = credits - ? WHERE id = ?', badge.price, user.id);
  run(`INSERT INTO user_badges (user_id,badge_id,granted_by,created_at)
       VALUES (?,?,?,?)`, user.id, badge.id, user.id, Date.now());
  return { ok: true, badge, credits: user.credits - badge.price };
}

// Animated avatar / banner are entitlements you buy once.
const FX_PRICES = { avatar_fx: 400, banner_fx: 600 };

export function buyFx(user, which) {
  if (!(which in FX_PRICES)) return { error: 'Unknown upgrade.' };
  if (user[which]) return { error: 'You already own that.' };
  const price = FX_PRICES[which];
  if (user.credits < price) return { error: 'Not enough credits.' };
  run(`UPDATE users SET credits = credits - ?, ${which} = 'animated' WHERE id = ?`,
    price, user.id);
  return { ok: true, spent: price };
}

// Setting an animated avatar/banner requires owning the entitlement —
// this is the error the brief asked for.
export function setFx(user, which, on) {
  if (!(which in FX_PRICES)) return { error: 'Unknown upgrade.' };
  if (on && !user[which]) {
    return { error: `You don't own the animated ${which === 'avatar_fx' ? 'profile' : 'background'} yet.` };
  }
  run(`UPDATE users SET ${which} = ? WHERE id = ?`, on ? 'animated' : '', user.id);
  return { ok: true };
}