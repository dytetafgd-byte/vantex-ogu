// chat.js — DMs, servers, channels over WebSocket. Instant, no refresh.
// Also owns the anti-spam rule: same text 5x in a row -> 5 minute mute.
import { WebSocketServer } from 'ws';
import { one, all, run } from './db.js';
import { publicUser } from './auth.js';

const SPAM_LIMIT = 5;
const MUTE_MS = 5 * 60 * 1000;

// last few message bodies per user, in memory — a mute is derived from this,
// so a restart clears streak state but not an ongoing mute (that's in the DB).
const recent = new Map(); // userId -> [{body, at}]

export function isMuted(user) {
  return user?.muted_until > Date.now();
}

function spamCheck(userId, body) {
  const now = Date.now();
  const cut = now - 60_000;
  const list = (recent.get(userId) || []).filter(m => m.at > cut);
  list.push({ body, at: now });
  recent.set(userId, list);
  const last = list.slice(-SPAM_LIMIT);
  if (last.length === SPAM_LIMIT && last.every(m => m.body === last[0].body)) {
    run('UPDATE users SET muted_until = ? WHERE id = ?', now + MUTE_MS, userId);
    recent.delete(userId);
    return true;
  }
  return false;
}

const sockets = new Map(); // userId -> Set(ws)

function broadcast(userIds, payload) {
  const msg = JSON.stringify(payload);
  for (const uid of new Set(userIds)) {
    for (const ws of sockets.get(uid) || []) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}

function dmPartners(userId) {
  return all(
    `SELECT DISTINCT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS id
     FROM dm_messages WHERE from_id = ? OR to_id = ?`, userId, userId, userId
  ).map(r => r.id);
}

function serverMembersOf(userId) {
  return all('SELECT server_id FROM server_members WHERE user_id = ?', userId)
    .map(r => r.server_id);
}

export function attachChat(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const token = new URL(req.url, 'http://x').searchParams.get('sid') || '';
    const row = one(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`, token, Date.now()
    );
    if (!row) return ws.close(4001, 'auth');
    if (row.banned) return ws.close(4003, 'banned');

    const userId = row.id;
    if (!sockets.has(userId)) sockets.set(userId, new Set());
    sockets.get(userId).add(ws);

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const me = one('SELECT * FROM users WHERE id = ?', userId);
      if (!me) return;

      // typing indicator -> "username is typing" (no brackets) on the client
      if (msg.type === 'typing') {
        const targets = msg.toUserId ? [Number(msg.toUserId)] : [];
        const payload = { type: 'typing', from: me.username, scope: msg.scope };
        if (targets.length) broadcast(targets, payload);
        else broadcast(serverMembersOf(userId), payload);
        return;
      }

      if (msg.type === 'dm') {
        if (isMuted(me)) return send(ws, { type: 'error', error: 'You are muted.' });
        const body = String(msg.body || '').slice(0, 2000);
        if (!body.trim() || !Number(msg.toUserId)) return;
        if (spamCheck(userId, body)) {
          return broadcast([userId], { type: 'muted', until: Date.now() + MUTE_MS });
        }
        run(`INSERT INTO dm_messages (from_id,to_id,body,kind,created_at) VALUES (?,?,?,?,?)`,
          userId, Number(msg.toUserId), body,
          ['text', 'image', 'gif', 'sticker'].includes(msg.kind) ? msg.kind : 'text',
          Date.now());
        broadcast([userId, Number(msg.toUserId)], {
          type: 'dm', from: me.username, fromId: userId,
          toId: Number(msg.toUserId), body, kind: msg.kind || 'text', at: Date.now(),
        });
        return;
      }

      if (msg.type === 'channel') {
        if (isMuted(me)) return send(ws, { type: 'error', error: 'You are muted.' });
        const channelId = Number(msg.channelId);
        const ch = one('SELECT * FROM channels WHERE id = ?', channelId);
        if (!ch) return;
        const member = one('SELECT 1 AS x FROM server_members WHERE server_id = ? AND user_id = ?',
          ch.server_id, userId);
        if (!member) return;
        const body = String(msg.body || '').slice(0, 2000);
        if (!body.trim()) return;
        if (spamCheck(userId, body)) {
          return broadcast([userId], { type: 'muted', until: Date.now() + MUTE_MS });
        }
        run(`INSERT INTO channel_messages (channel_id,user_id,body,kind,created_at)
             VALUES (?,?,?,?,?)`, channelId, userId, body,
             ['text', 'image', 'gif', 'sticker'].includes(msg.kind) ? msg.kind : 'text',
             Date.now());
        const members = all('SELECT user_id FROM server_members WHERE server_id = ?', ch.server_id)
          .map(r => r.user_id);
        broadcast(members, {
          type: 'channel', channelId, serverId: ch.server_id, from: me.username,
          body, kind: msg.kind || 'text', at: Date.now(),
        });
        return;
      }

      if (msg.type === 'hello') {
        send(ws, {
          type: 'hello',
          user: publicUser(me),
          partners: dmPartners(userId),
          servers: serverMembersOf(userId),
        });
        // announce presence to everyone we can talk to
        broadcast([...dmPartners(userId), ...serverMembersOf(userId)].length
          ? [] : [], { type: 'noop' });
        broadcast([userId], { type: 'ready' });
      }
    });

    ws.on('close', () => {
      sockets.get(userId)?.delete(ws);
      if (!sockets.get(userId)?.size) sockets.delete(userId);
    });
  });

  return wss;
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

// REST fallbacks so a page load shows history without a socket round-trip.
export function dmHistory(a, b, limit = 100) {
  return all(
    `SELECT m.*, uf.username AS from_name, ut.username AS to_name
     FROM dm_messages m
     JOIN users uf ON uf.id = m.from_id
     JOIN users ut ON ut.id = m.to_id
     WHERE (m.from_id = ? AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = ?)
     ORDER BY m.created_at DESC LIMIT ?`,
    a, b, b, a, limit
  ).reverse();
}

export function channelHistory(channelId, userId, limit = 100) {
  const ch = one('SELECT * FROM channels WHERE id = ?', channelId);
  if (!ch) return null;
  const member = one('SELECT 1 AS x FROM server_members WHERE server_id = ? AND user_id = ?',
    ch.server_id, userId);
  if (!member) return null;
  return all(
    `SELECT m.*, u.username FROM channel_messages m JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT ?`, channelId, limit
  ).reverse();
}

export function createServer(user, name) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40) {
    return { error: 'Server name must be 2-40 characters.' };
  }
  const now = Date.now();
  const info = run('INSERT INTO servers (name,owner_id,created_at) VALUES (?,?,?)',
    name.trim(), user.id, now);
  const id = Number(info.lastInsertRowid);
  run('INSERT INTO server_members (server_id,user_id) VALUES (?,?)', id, user.id);
  run('INSERT INTO channels (server_id,name,created_at) VALUES (?,?,?)', id, 'general', now);
  return { ok: true, serverId: id };
}

export function joinServer(user, serverId) {
  if (!one('SELECT id FROM servers WHERE id = ?', serverId)) return { error: 'No such server.' };
  run('INSERT OR IGNORE INTO server_members (server_id,user_id) VALUES (?,?)', serverId, user.id);
  return { ok: true };
}

export function myServers(userId) {
  return all(
    `SELECT s.id, s.name, s.owner_id,
            (SELECT id FROM channels c WHERE c.server_id = s.id ORDER BY c.id LIMIT 1) AS channel_id
     FROM servers s JOIN server_members sm ON sm.server_id = s.id
     WHERE sm.user_id = ? ORDER BY s.created_at ASC`, userId
  );
}

export function sendFriendRequest(user, username) {
  const other = one('SELECT id FROM users WHERE username = ? COLLATE NOCASE', String(username || ''));
  if (!other) return { error: 'No such user.' };
  if (other.id === user.id) return { error: "You can't add yourself." };
  run(`INSERT INTO friends (user_id,friend_id,status,created_at) VALUES (?,?,?,?)
       ON CONFLICT DO NOTHING`, user.id, other.id, 'pending', Date.now());
  return { ok: true };
}

export function acceptFriend(user, fromUserId) {
  const info = run(`UPDATE friends SET status = 'accepted'
                    WHERE user_id = ? AND friend_id = ? AND status = 'pending'`,
    Number(fromUserId), user.id);
  if (!info.changes) return { error: 'No pending request from them.' };
  run(`INSERT INTO friends (user_id,friend_id,status,created_at) VALUES (?,?,?,?)
       ON CONFLICT DO NOTHING`, user.id, Number(fromUserId), 'accepted', Date.now());
  return { ok: true };
}

export function friendsOf(userId) {
  return all(
    `SELECT u.id, u.username, f.status FROM friends f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? ORDER BY u.username ASC`, userId
  );
}

export function pendingRequests(userId) {
  return all(
    `SELECT u.id, u.username FROM friends f JOIN users u ON u.id = f.user_id
     WHERE f.friend_id = ? AND f.status = 'pending'`, userId
  );
}