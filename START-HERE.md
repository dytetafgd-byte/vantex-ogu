# Start here

## The fast way (Windows)

1. Unzip the folder anywhere — Desktop is fine.
2. Double-click **START-WINDOWS.bat**.
3. The first time, it installs what it needs (about a minute) and then opens the
   site in your browser at `http://localhost:3000`.
4. Keep the black window open while you use the site. Close it to stop the site.

## Mac / Linux

Double-click **START-MAC-OR-LINUX.command**. If macOS refuses to run it, open
Terminal, drag the file in, and press Enter. You may need to run
`chmod +x START-MAC-OR-LINUX.command` once first.

## What it needs

**Node.js**, installed once, from https://nodejs.org — pick the green LTS button.
The launcher will offer to open that page for you if it can't find Node.

If Node isn't installed, double-clicking will not work, and no amount of
zipping will change that: a web app has to be run by something, and Node is
that something.

## First account

Register the username **x** first if you want the admin panel. The first
account whose name matches `ADMIN_USERNAME` in `.env` (default: `x`) becomes
the admin, and only that account passes the admin checks. If someone else
claims it first, edit `ADMIN_USERNAME` in `.env` before anyone signs up.

## Everyday use

- The launcher does everything. Use it every time.
- Your data lives in `ogu.db`, next to the launcher. Back that file up to keep
  your accounts; delete it to start over with a blank site.
- If you want the site reachable from other computers, that's a separate job —
  this is set up for your own machine only, and that's also the safest way to
  run it while you're testing.