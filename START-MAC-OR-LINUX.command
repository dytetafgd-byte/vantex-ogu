#!/usr/bin/env bash
# ogu — double-click START-MAC-OR-LINUX.command to start the site.
# On first run it installs dependencies, then opens the website.
# Keep this window open while you use the site. Close it to stop.

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed on this computer."
  echo
  echo "  Download it here, install it, then double-click this file again:"
  echo "      https://nodejs.org"
  echo
  open "https://nodejs.org" 2>/dev/null || xdg-open "https://nodejs.org" 2>/dev/null
  read -rp "Press Enter to close..."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Generated a .env file for you."
fi

if [ ! -d node_modules ]; then
  echo "Installing the project's dependencies. This happens once and takes a minute..."
  npm install || { echo "npm install failed. Scroll up to see why."; read -rp "Press Enter..."; exit 1; }
fi

echo
echo "  Starting ogu at http://localhost:3000"
echo "  Your browser will open shortly. Keep this window open."
echo

# open the browser a moment after the server boots
( sleep 4; open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null ) &

node server.js

echo
echo "  The site has stopped."
read -rp "Press Enter to close..."