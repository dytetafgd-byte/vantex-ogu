# ogu — username claiming site

Build order:
1. package.json + .env.example + schema.sql
2. db.js (sqlite, sync)
3. auth.js (signup/login/session, 1-20 chars [A-Za-z0-9./-_], no email)
4. themes.js (theme list + gradient toggle, applied server-side so it's identical on signup/login/profile/directory/leaderboard)
5. credits.js (daily 5, badge shop, no self-grant paths)
6. badges.js (bought badge -> emoji, custom 1-20ch created by x)
7. tickets.js (own page, max 3 seats incl x, trade/middleman inside)
8. chat.js (ws: DMs, servers, typing indicator, images/gifs/stickers, 5x spam -> 5min mute)
9. admin.js (x only: ip ban/unban, delete username, grant/revoke credits, timeout, ban junk-ticket makers)
10. directory.js (search, listings in USD)
11. halloween.css (skull/pumpkin/cobweb, restrained)
12. server.js (wire everything)
13. public/ (signup, login, profile, directory, leaderboard, ticket, admin)

Roles: only username "x" is admin. Everything admin-gated is checked server-side by user id.