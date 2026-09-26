// admin.js — every power gated on the "x" account. All of it logged.
import { one, all, run } from './db.js';

function log(admin, action, target) {
  run(`INSERT INTO admin_log (admin_id,action,target,created_at) VALUES (?,?,?,?)`,
    admin.id, action, String(target ?? ''), Date.now());
}

export function banIp(admin, ip, reason = '') {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  if (!ip || ip === 'unknown') return { error: 'No IP to ban.' };
  run(`INSERT INTO ip_bans (ip,reason,created_at) VALUES (?,?,?)
       ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason`, ip, String(reason).slice(0, 200), Date.now());
  run('UPDATE users SET banned = 1 WHERE id IN (SELECT user_id FROM ips WHERE ip = ?)', ip);
  log(admin, 'ip-ban', `${ip} ${reason}`.trim());
  return { ok: true };
}

export function unbanIp(admin, ip) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  const info = run('DELETE FROM ip_bans WHERE ip = ?', ip);
  if (!info.changes) return { error: 'That IP is not banned.' };
  run('UPDATE users SET banned = 0 WHERE id IN (SELECT user_id FROM ips WHERE ip = ?)', ip);
  log(admin, 'ip-unban', ip);
  return { ok: true };
}

export function bannedIps() {
  return all('SELECT ip, reason, created_at FROM ip_bans ORDER BY created_at DESC');
}

// Ban a user for making junk tickets, plus the plain account ban.
export function banUser(admin, userId, reason = '') {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  if (admin.id === Number(userId)) return { error: "You can't ban yourself." };
  run('UPDATE users SET banned = 1 WHERE id = ?', Number(userId));
  log(admin, 'user-ban', `${userId} ${reason}`.trim());
  return { ok: true };
}

export function unbanUser(admin, userId) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  run('UPDATE users SET banned = 0 WHERE id = ?', Number(userId));
  log(admin, 'user-unban', userId);
  return { ok: true };
}

// Timeout for a custom number of minutes.
export function timeoutUser(admin, userId, minutes) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 60 * 24 * 30) {
    return { error: 'Give a timeout between 1 minute and 30 days.' };
  }
  run('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() + mins * 60_000, Number(userId));
  log(admin, 'timeout', `${userId} ${mins}m`);
  return { ok: true };
}

export function clearTimeout(admin, userId) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  run('UPDATE users SET muted_until = 0 WHERE id = ?', Number(userId));
  log(admin, 'untimeout', userId);
  return { ok: true };
}

// Delete an account and everything hanging off it (cascade).
export function deleteUser(admin, userId) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  if (admin.id === Number(userId)) return { error: "You can't delete your own account here." };
  const u = one('SELECT username FROM users WHERE id = ?', Number(userId));
  if (!u) return { error: 'No such user.' };
  run('DELETE FROM users WHERE id = ?', Number(userId));
  log(admin, 'user-delete', u.username);
  return { ok: true };
}

export function dashboard() {
  return {
    users: all(`SELECT id, username, credits, is_admin, banned, muted_until,
                        is_founder, created_at FROM users ORDER BY created_at ASC`),
    ips: all(`SELECT i.user_id, i.ip, u.username FROM ips i
              JOIN users u ON u.id = i.user_id ORDER BY i.created_at DESC LIMIT 300`),
    bans: bannedIps(),
    junkTickets: all(`SELECT t.id, t.subject, u.username AS owner FROM tickets t
                      JOIN users u ON u.id = t.owner_id WHERE t.is_junk = 1`),
    log: all(`SELECT a.action, a.target, a.created_at, u.username AS admin FROM admin_log a
              LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT 100`),
  };
}