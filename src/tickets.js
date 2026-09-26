// tickets.js — a ticket is a real page with its own thread, not a modal.
// Hard rule: at most 3 members, and "x" is always one of them.
import { one, all, run } from './db.js';

export const MAX_MEMBERS = 3;
const KINDS = new Set(['general', 'trade', 'middleman', 'listing']);

export function createTicket({ user, subject, kind = 'general', withUsers = [], adminId }) {
  if (typeof subject !== 'string' || subject.trim().length < 3 || subject.trim().length > 80) {
    return { error: 'Give the ticket a subject (3-80 characters).' };
  }
  if (!KINDS.has(kind)) return { error: 'Unknown ticket type.' };

  const now = Date.now();
  const info = run(
    `INSERT INTO tickets (subject,kind,owner_id,status,created_at)
     VALUES (?,?,?,?,?)`, subject.trim(), kind, user.id, 'open', now
  );
  const id = Number(info.lastInsertRowid);

  const addMember = (userId, role) => run(
    `INSERT OR IGNORE INTO ticket_members (ticket_id,user_id,role) VALUES (?,?,?)`,
    id, userId, role
  );

  addMember(user.id, 'owner');
  if (adminId && adminId !== user.id) addMember(adminId, 'admin');

  // requested participants, capped so the 3-seat rule can't be bypassed
  for (const name of withUsers.slice(0, MAX_MEMBERS)) {
    const u = one('SELECT id FROM users WHERE username = ? COLLATE NOCASE', String(name));
    if (!u || u.id === user.id) continue;
    const count = one('SELECT COUNT(*) AS n FROM ticket_members WHERE ticket_id = ?', id).n;
    if (count >= MAX_MEMBERS) break;
    addMember(u.id, 'member');
  }

  run(`INSERT INTO ticket_messages (ticket_id,user_id,body,created_at) VALUES (?,?,?,?)`,
    id, user.id, `Opened a ${kind} ticket.`, now);
  return { ok: true, ticketId: id };
}

export function membersOf(ticketId) {
  return all(
    `SELECT u.id, u.username, tm.role FROM ticket_members tm
     JOIN users u ON u.id = tm.user_id WHERE tm.ticket_id = ?`,
    ticketId
  );
}

export function addMember(admin, ticketId, username) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  const count = one('SELECT COUNT(*) AS n FROM ticket_members WHERE ticket_id = ?', ticketId).n;
  if (count >= MAX_MEMBERS) return { error: `Tickets hold ${MAX_MEMBERS} people, including x.` };
  const u = one('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username);
  if (!u) return { error: 'No such user.' };
  run(`INSERT OR IGNORE INTO ticket_members (ticket_id,user_id,role) VALUES (?,?,'member')`,
    ticketId, u.id);
  return { ok: true };
}

// The newest open ticket a user belongs to — powers the "Go to ticket" button.
export function currentTicketFor(userId) {
  return one(
    `SELECT t.* FROM tickets t JOIN ticket_members tm ON tm.ticket_id = t.id
     WHERE tm.user_id = ? AND t.status = 'open'
     ORDER BY t.created_at DESC LIMIT 1`,
    userId
  );
}

export function canView(userId, ticketId) {
  return !!one('SELECT 1 AS x FROM ticket_members WHERE ticket_id = ? AND user_id = ?',
    ticketId, userId);
}

export function postMessage({ userId, ticketId, body }) {
  if (!canView(userId, ticketId)) return { error: 'Not your ticket.' };
  if (typeof body !== 'string' || !body.trim() || body.length > 2000) {
    return { error: 'Message must be 1-2000 characters.' };
  }
  run(`INSERT INTO ticket_messages (ticket_id,user_id,body,created_at) VALUES (?,?,?,?)`,
    ticketId, userId, body.trim(), Date.now());
  return { ok: true };
}

export function thread(ticketId) {
  const ticket = one('SELECT * FROM tickets WHERE id = ?', ticketId);
  if (!ticket) return null;
  return {
    ticket,
    members: membersOf(ticketId),
    messages: all(
      `SELECT m.id, m.body, m.created_at, u.username FROM ticket_messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.ticket_id = ? ORDER BY m.created_at ASC`, ticketId
    ),
  };
}

export function setJunk(admin, ticketId, isJunk) {
  if (!admin?.is_admin) return { error: 'Admin only.' };
  run('UPDATE tickets SET is_junk = ? WHERE id = ?', isJunk ? 1 : 0, ticketId);
  return { ok: true };
}

export function openTickets() {
  return all(
    `SELECT t.*, u.username AS owner FROM tickets t
     JOIN users u ON u.id = t.owner_id
     WHERE t.status = 'open' ORDER BY t.created_at DESC`
  );
}