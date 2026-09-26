// server.js — wires everything together.
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer as createHttpServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate, one, run, all } from './src/db.js';
import * as auth from './src/auth.js';
import { THEMES, themeCss, isValidTheme, DEFAULT_THEME } from './src/themes.js';
import * as credits from './src/credits.js';
import * as badges from './src/badges.js';
import * as tickets from './src/tickets.js';
import * as directory from './src/directory.js';
import * as admin from './src/admin.js';
import * as puzzles from './src/puzzles.js';
import { attachChat, dmHistory, channelHistory, createServer, joinServer,
  myServers, sendFriendRequest, acceptFriend, friendsOf, pendingRequests } from './src/chat.js';

const here = dirname(fileURLToPath(import.meta.url));

// Zamiast zniknąć bez śladu — pokaż, co się stało.
process.on('uncaughtException', (err) => {
  console.error('\n--- BŁĄD ---');
  console.error(err && err.stack ? err.stack : err);
  console.error('-----------\n');
});

try {
  migrate();
} catch (err) {
  console.error('\n--- BŁĄD BAZY DANYCH ---');
  console.error(err && err.stack ? err.stack : err);
  console.error('Nie udało się utworzyć bazy w:', here);
  console.error('------------------------\n');
}

const app = express();
// trust proxy: potrzebne, żeby HTTPS i adresy za VPN/proxy działały poprawnie.
// VPN-y nie są blokowane — liczy się adres widziany przez serwer.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(auth.loadUser);

const DISCORD = process.env.DISCORD_INVITE || 'https://discord.gg/A4nUU4UJ5';
const adminId = () => one('SELECT id FROM users WHERE is_admin = 1 LIMIT 1')?.id ?? null;

// ------------------------------------------------------------------ pages
// Every page renders the SAME theme variables, which is what stops the theme
// from drifting between signup, login, profile and the rest.
function page(file, req, extra = {}) {
  return (_req, res) => {
    const theme = req.user?.theme || DEFAULT_THEME;
    const gradients = req.user ? !!req.user.gradients : true;
    res.render(file, {
      theme,
      themeVars: themeCss(theme, gradients),
      themes: THEMES,
      gradients,
      discord: DISCORD,
      user: req.user ? auth.publicUser(req.user) : null,
      ...extra,
    });
  };
}
app.set('view engine', 'ejs');
app.set('views', join(here, 'views'));

// ------------------------------------------------------------------ session
// Automatyczne sprawdzanie nazwy w trakcie pisania.
app.get('/api/check/:username', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const name = String(req.params.username || '');
  const bad = auth.validateUsername(name);
  if (bad) {
    return res.json({ ok: true, available: false, reason: bad });
  }
  const taken = !!one('SELECT id FROM users WHERE username = ? COLLATE NOCASE', name);
  if (taken) {
    return res.json({ ok: true, available: false, reason: 'That username is already taken.' });
  }
  res.json({ ok: true, available: true });
});

app.post('/api/signup', (req, res) => {
  const ip = auth.clientIp(req);
  if (!auth.looksLikeBrowser(req)) {
    return res.status(403).json({ error: 'Sign-ups must come from a browser.' });
  }
  const out = auth.signup({ username: req.body?.username, password: req.body?.password, ip });
  if (out.error) return res.status(400).json(out);
  const token = auth.createSession(out.userId);
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 864e5,
    secure: req.secure,
  });
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const ip = auth.clientIp(req);
  const out = auth.login({ username: req.body?.username, password: req.body?.password, ip });
  if (out.error) return res.status(400).json(out);
  const token = auth.createSession(out.userId);
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 864e5,
    secure: req.secure,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req.cookies?.sid);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user ? auth.publicUser(req.user) : null, themes: THEMES, discord: DISCORD });
});

// ------------------------------------------------------------------ settings
app.post('/api/settings', auth.requireUser, (req, res) => {
  const { theme, gradients, bio, avatar, banner } = req.body || {};
  if (theme !== undefined) {
    if (!isValidTheme(theme)) return res.status(400).json({ error: 'Unknown theme.' });
    run('UPDATE users SET theme = ? WHERE id = ?', theme, req.user.id);
  }
  if (gradients !== undefined) {
    run('UPDATE users SET gradients = ? WHERE id = ?', gradients ? 1 : 0, req.user.id);
  }
  if (bio !== undefined) {
    run('UPDATE users SET bio = ? WHERE id = ?', String(bio).slice(0, 300), req.user.id);
  }
  if (avatar !== undefined) run('UPDATE users SET avatar = ? WHERE id = ?', String(avatar).slice(0, 400), req.user.id);
  if (banner !== undefined) run('UPDATE users SET banner = ? WHERE id = ?', String(banner).slice(0, 400), req.user.id);
  res.json({ ok: true, user: auth.publicUser(one('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// animated avatar / banner: setting it requires owning it
app.post('/api/fx', auth.requireUser, (req, res) => {
  const out = credits.setFx(req.user, req.body?.which, !!req.body?.on);
  if (out.error) return res.status(400).json(out);
  res.json({ ok: true });
});

app.get('/api/reward', auth.requireUser, (req, res) => {
  const out = credits.dailyReward(req.user);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

// ------------------------------------------------------------------ account
app.post('/api/password', auth.requireUser, (req, res) => {
  const { current, next } = req.body || {};
  if (!auth.verifyPassword(current || '', req.user.password_hash)) {
    return res.status(400).json({ error: 'Current password is wrong.' });
  }
  if (typeof next !== 'string' || next.length < 6) {
    return res.status(400).json({ error: 'New password needs 6+ characters.' });
  }
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(next), req.user.id);
  res.json({ ok: true });
});

app.post('/api/delete-profile', auth.requireUser, (req, res) => {
  const { password } = req.body || {};
  if (!auth.verifyPassword(password || '', req.user.password_hash)) {
    return res.status(400).json({ error: 'Password is wrong.' });
  }
  auth.destroySession(req.cookies?.sid);
  run('DELETE FROM users WHERE id = ?', req.user.id);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/profile/:username', (req, res) => {
  const u = one('SELECT * FROM users WHERE username = ? COLLATE NOCASE', req.params.username);
  if (!u) return res.status(404).json({ error: 'No such user.' });
  res.json({
    user: auth.publicUser(u),
    listing: one('SELECT price_usd FROM listings WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', u.id) || null,
    ticket: tickets.currentTicketFor(u.id) || null,
  });
});

// ------------------------------------------------------------------ badges
app.get('/api/badges', (_req, res) => res.json({ badges: badges.allBadges() }));

app.post('/api/badges/buy', auth.requireUser, (req, res) => {
  const out = credits.buyBadge(req.user, req.body?.slug);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/fx/buy', auth.requireUser, (req, res) => {
  const out = credits.buyFx(req.user, req.body?.which);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

// ------------------------------------------------------------------ tickets
app.post('/api/tickets', auth.requireUser, (req, res) => {
  const out = tickets.createTicket({
    user: req.user,
    subject: req.body?.subject,
    kind: req.body?.kind || 'general',
    withUsers: Array.isArray(req.body?.with) ? req.body.with : [],
    adminId: adminId(),
  });
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.get('/api/tickets/:id', auth.requireUser, (req, res) => {
  const id = Number(req.params.id);
  if (!tickets.canView(req.user.id, id)) return res.status(403).json({ error: 'Not your ticket.' });
  res.json(tickets.thread(id));
});

app.post('/api/tickets/:id/messages', auth.requireUser, (req, res) => {
  const out = tickets.postMessage({ userId: req.user.id, ticketId: Number(req.params.id), body: req.body?.body });
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/tickets/:id/members', auth.requireAdmin, (req, res) => {
  const out = tickets.addMember(req.user, Number(req.params.id), req.body?.username);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.get('/api/my-ticket', auth.requireUser, (req, res) => {
  res.json({ ticket: tickets.currentTicketFor(req.user.id) || null });
});

// ------------------------------------------------------------------ directory
app.get('/api/directory', (req, res) => {
  res.json({ users: directory.search({ q: req.query.q || '' }), listings: directory.listings() });
});

app.post('/api/listings', auth.requireUser, (req, res) => {
  const out = directory.createListing({
    user: req.user, priceUsd: req.body?.price, note: req.body?.note,
  });
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/listings/:id/remove', auth.requireUser, (req, res) => {
  const out = directory.deactivateListing(req.user, Number(req.params.id));
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.get('/api/leaderboard', (_req, res) => {
  res.json({ first: directory.firstAccount(), founders: directory.founders() });
});

// ------------------------------------------------------------------ social
app.get('/api/friends', auth.requireUser, (req, res) => {
  res.json({ friends: friendsOf(req.user.id), pending: pendingRequests(req.user.id) });
});
app.post('/api/friends/request', auth.requireUser, (req, res) => {
  const out = sendFriendRequest(req.user, req.body?.username);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});
app.post('/api/friends/accept', auth.requireUser, (req, res) => {
  const out = acceptFriend(req.user, req.body?.userId);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});
app.get('/api/servers', auth.requireUser, (req, res) => res.json({ servers: myServers(req.user.id) }));
app.post('/api/servers', auth.requireUser, (req, res) => {
  const out = createServer(req.user, req.body?.name);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});
app.post('/api/servers/join', auth.requireUser, (req, res) => {
  const out = joinServer(req.user, Number(req.body?.serverId));
  if (out.error) return res.status(400).json(out);
  res.json(out);
});
app.get('/api/dm/:userId', auth.requireUser, (req, res) => {
  res.json({ messages: dmHistory(req.user.id, Number(req.params.userId)) });
});
app.get('/api/channel/:id', auth.requireUser, (req, res) => {
  const history = channelHistory(Number(req.params.id), req.user.id);
  if (!history) return res.status(403).json({ error: 'Not your channel.' });
  res.json({ messages: history });
});

// ------------------------------------------------------------------ puzzles
app.get('/api/puzzle', auth.requireUser, (req, res) => res.json(puzzles.puzzleState(req.user.id)));
app.post('/api/puzzle/guess', auth.requireUser, (req, res) => {
  const out = puzzles.submitGuess(req.user, req.body?.guess);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

// ------------------------------------------------------------------ admin
app.get('/api/admin', auth.requireAdmin, (_req, res) => res.json(admin.dashboard()));
app.post('/api/admin/ip/ban', auth.requireAdmin, (req, res) => {
  const out = admin.banIp(req.user, req.body?.ip, req.body?.reason); ok(res, out);
});
app.post('/api/admin/ip/unban', auth.requireAdmin, (req, res) => {
  const out = admin.unbanIp(req.user, req.body?.ip); ok(res, out);
});
app.post('/api/admin/user/ban', auth.requireAdmin, (req, res) => {
  const out = admin.banUser(req.user, req.body?.userId, req.body?.reason); ok(res, out);
});
app.post('/api/admin/user/unban', auth.requireAdmin, (req, res) => {
  const out = admin.unbanUser(req.user, req.body?.userId); ok(res, out);
});
app.post('/api/admin/user/delete', auth.requireAdmin, (req, res) => {
  const out = admin.deleteUser(req.user, req.body?.userId); ok(res, out);
});
app.post('/api/admin/user/timeout', auth.requireAdmin, (req, res) => {
  const out = admin.timeoutUser(req.user, req.body?.userId, req.body?.minutes); ok(res, out);
});
app.post('/api/admin/user/untimeout', auth.requireAdmin, (req, res) => {
  const out = admin.clearTimeout(req.user, req.body?.userId); ok(res, out);
});
app.post('/api/admin/credits', auth.requireAdmin, (req, res) => {
  const out = credits.adminAdjustCredits(req.user, Number(req.body?.userId), Number(req.body?.delta)); ok(res, out);
});
app.post('/api/admin/badges/create', auth.requireAdmin, (req, res) => {
  const out = badges.createCustomBadge(req.user, req.body || {}); ok(res, out);
});
app.post('/api/admin/badges/grant', auth.requireAdmin, (req, res) => {
  const out = badges.grantBadge(req.user, Number(req.body?.userId), Number(req.body?.badgeId)); ok(res, out);
});
app.post('/api/admin/badges/revoke', auth.requireAdmin, (req, res) => {
  const out = badges.revokeBadge(req.user, Number(req.body?.userId), Number(req.body?.badgeId)); ok(res, out);
});
app.post('/api/admin/tickets/junk', auth.requireAdmin, (req, res) => {
  const out = tickets.setJunk(req.user, Number(req.body?.ticketId), !!req.body?.junk); ok(res, out);
});

function ok(res, out) {
  if (out.error) return res.status(400).json(out);
  res.json(out);
}

// ------------------------------------------------------------------ static + views
// /landing.css i /halloween.css wychodzą z public/ przez ten sam statyczny handler
app.use(express.static(join(here, 'public')));

// The public HTML is served from views/, rendered with the theme baked in.
// Keeping the theme server-side is the whole reason these are templates.
const pages = {
  '/': 'index',
  '/login': 'login',
  '/signup': 'signup',
  '/directory': 'directory',
  '/leaderboard': 'leaderboard',
  '/settings': 'settings',
  '/tickets': 'tickets',
  '/admin': 'admin',
  '/puzzle': 'puzzle',
  '/chat': 'chat',
};
for (const [route, file] of Object.entries(pages)) {
  app.get(route, page(file, { get user() { return null; } }));
}
app.get('/u/:username', (req, res, next) => {
  const u = one('SELECT username, theme, gradients FROM users WHERE username = ? COLLATE NOCASE',
    req.params.username);
  if (!u) return next();
  // Profile keeps the VIEWER's theme, per the brief: the site stays consistent
  // for whoever is looking, rather than swapping to the owner's palette.
  const theme = req.user?.theme || DEFAULT_THEME;
  const gradients = req.user ? !!req.user.gradients : true;
  res.render('profile', {
    theme, themeVars: themeCss(theme, gradients), themes: THEMES, gradients,
    discord: DISCORD, viewed: u.username,
    user: req.user ? auth.publicUser(req.user) : null,
  });
});
app.get('/ticket/:id', (req, res) => {
  const theme = req.user?.theme || DEFAULT_THEME;
  const gradients = req.user ? !!req.user.gradients : true;
  res.render('ticket', {
    theme, themeVars: themeCss(theme, gradients), themes: THEMES, gradients,
    discord: DISCORD, ticketId: Number(req.params.id),
    user: req.user ? auth.publicUser(req.user) : null,
  });
});

app.use((_req, res) => res.status(404).send('Not found'));

const server = createHttpServer(app);
attachChat(server);
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => {
  console.log(`ogu running on http://localhost:${process.env.PORT || 3000}`);
});