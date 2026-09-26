// auth.js — signup, login, sessions. No email, no verification.
import crypto from 'node:crypto';
import { one, run, all } from './db.js';

const USERNAME_RE = /^[A-Za-z0-9._/-]{1,20}$/;   // 1-20: letters digits . / - _
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'x').toLowerCase();
const MAX_ACCOUNTS_PER_IP = 10;
const SESSION_DAYS = 30;

// Usernames we refuse outright so nobody can register something that looks
// like a route or a file path.
// 'x' jest celowo NIE zablokowane — to konto administratora.
// Blokujemy tylko nazwy, ktore koliduja ze sciezkami i sa bezuzyteczne.
const RESERVED = new Set([
  'admin', 'api', 'static', 'public', 'login', 'signup', 'logout',
  'null', 'undefined', 'favicon.ico', 'robots.txt',
]);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [, saltHex, keyHex] = stored.split('$');
    const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
  } catch {
    return false;
  }
}

export function validateUsername(name) {
  if (typeof name !== 'string') return 'Username must be text.';
  if (!USERNAME_RE.test(name)) {
    return '1-20 characters, letters, numbers and . / - _ only.';
  }
  if (RESERVED.has(name.toLowerCase())) return 'That name is taken.';
  return null;
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function ipBanned(ip) {
  return !!one('SELECT ip FROM ip_bans WHERE ip = ?', ip);
}

export function accountsOnIp(ip) {
  return one('SELECT COUNT(*) AS n FROM ips WHERE ip = ?', ip).n;
}

// Odrzuca żądania, które nie przyszły z przeglądarki.
// Python, curl i skrypty masowe nie wysyłają tych nagłówków.
export function looksLikeBrowser(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || ua.length < 20) return false;
  const lower = ua.toLowerCase();
  const bots = ['python', 'curl', 'wget', 'httpie', 'axios', 'node-fetch', 'okhttp', 'go-http', 'java/', 'libwww', 'scrapy', 'requests'];
  for (const b of bots) {
    if (lower.includes(b)) return false;
  }
  const known = ['mozilla', 'chrome', 'safari', 'firefox', 'edg/', 'opera'];
  for (const k of known) {
    if (lower.includes(k)) return true;
  }
  return false;
}

// Limit prób rejestracji z jednego IP.
export function tooManyAttempts(ip, max = 6, windowMs = 3600000) {
  const since = Date.now() - windowMs;
  const row = one('SELECT COUNT(*) AS n FROM signup_attempts WHERE ip = ? AND created_at > ?', ip, since);
  return row.n >= max;
}

export function noteAttempt(ip) {
  run('INSERT INTO signup_attempts (ip, created_at) VALUES (?,?)', ip, Date.now());
}

export function signup({ username, password, ip }) {
  const bad = validateUsername(username);
  if (bad) return { error: bad };
  if (typeof password !== 'string' || password.length < 6) {
    return { error: 'Password needs at least 6 characters.' };
  }
  if (ipBanned(ip)) return { error: 'This network is banned.' };
  if (tooManyAttempts(ip)) {
    return { error: 'Too many sign-ups from this network. Try again later.' };
  }
  if (accountsOnIp(ip) >= MAX_ACCOUNTS_PER_IP) {
    return { error: `Limit of ${MAX_ACCOUNTS_PER_IP} accounts per network reached.` };
  }
  if (one('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username)) {
    return { error: 'That username is already claimed.' };
  }

  const now = Date.now();
  // first 5 accounts get the checkmark
  const total = one('SELECT COUNT(*) AS n FROM users').n;
  const isFounder = total < 5 ? 1 : 0;

  const info = run(
    `INSERT INTO users (username,password_hash,is_admin,is_founder,created_at,last_reward)
     VALUES (?,?,?,?,?,0)`,
    username, hashPassword(password), username.toLowerCase() === ADMIN_USERNAME ? 1 : 0,
    isFounder, now
  );
  run('INSERT INTO ips (user_id,ip,created_at) VALUES (?,?,?)', info.lastInsertRowid, ip, now);
  noteAttempt(ip);
  return { userId: Number(info.lastInsertRowid) };
}

export function login({ username, password, ip }) {
  const user = one('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username || '');
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return { error: 'Wrong username or password.' };
  }
  if (user.banned) return { error: 'This account is banned.' };
  if (ipBanned(ip)) return { error: 'This network is banned.' };
  return { userId: user.id };
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  run('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)',
    token, userId, now, now + SESSION_DAYS * 864e5);
  return token;
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

// Attaches req.user (or null). Called on every request.
export function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.sid;
  if (!token) return next();
  const row = one(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
    token, Date.now()
  );
  if (row) {
    row.is_admin = !!row.is_admin;
    row.is_founder = !!row.is_founder;
    req.user = row;
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Log in first.' });
  if (req.user.banned) return res.status(403).json({ error: 'This account is banned.' });
  next();
}

// Every admin power runs through here. Username "x" only, checked by id on
// the row, not by anything the client sends.
export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only.' });
  }
  next();
}

export function publicUser(u) {
  if (!u) return null;
  const badges = all(
    `SELECT b.slug, b.label, b.emoji FROM user_badges ub
     JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?`,
    u.id
  );
  return {
    id: u.id,
    username: u.username,
    bio: u.bio,
    avatar: u.avatar,
    banner: u.banner,
    avatarFx: u.avatar_fx,
    bannerFx: u.banner_fx,
    theme: u.theme,
    gradients: !!u.gradients,
    credits: u.credits,
    isAdmin: !!u.is_admin,
    isFounder: !!u.is_founder,
    badges,
    createdAt: u.created_at,
  };
}