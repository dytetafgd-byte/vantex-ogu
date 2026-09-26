// app.js — shared client helpers. Keeps the profile page instant: the socket
// pushes, plus a light poll as a safety net so nothing needs a manual refresh.
(() => {
  const ME = document.body.dataset.viewed;
  const isMe = false;

  // ---- profile page ----
  if (ME) {
    fetch('/api/profile/' + encodeURIComponent(ME))
      .then(r => r.json())
      .then(({ user, listing, ticket }) => {
        if (!user) return;
        const banner = document.getElementById('banner');
        if (user.banner) banner.style.backgroundImage = `url("${user.banner}")`;
        if (user.bannerFx === 'animated') banner.classList.add('animated');

        const av = document.getElementById('avatar');
        if (user.avatar) {
          av.innerHTML = `<img src="${user.avatar}" alt=""
            style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
        } else {
          av.textContent = user.username[0].toUpperCase();
        }
        if (user.avatarFx === 'animated') av.classList.add('animated');

        document.getElementById('uname').textContent = user.username;
        document.getElementById('bio').textContent = user.bio || '';
        document.getElementById('credits').textContent = user.credits;
        document.getElementById('joined').textContent =
          new Date(user.createdAt).toLocaleDateString();
        document.getElementById('price').textContent =
          listing ? '$' + Number(listing.price_usd).toFixed(2) : 'not listed';

        // bought badges render as emoji, custom ones keep theirs
        document.getElementById('badges').innerHTML = user.badges
          .map(b => `<span class="badge-emoji" title="${b.label}">${b.emoji}</span>`).join('');
        if (user.isFounder) document.getElementById('founder').hidden = false;

        const gt = document.getElementById('goTicket');
        if (ticket) { gt.hidden = false; gt.onclick = () => location.href = '/ticket/' + ticket.id; }

        document.getElementById('addFriend')?.addEventListener('click', async () => {
          await fetch('/api/friends/request', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: user.username }),
          });
          alert('Request sent.');
        });
        window.__profileUserId = user.id;
      });
  }

  // ---- websocket: instant chat, typing indicator ----
  const sid = document.cookie.split('; ').find(c => c.startsWith('sid='))?.split('=')[1];
  let ws = null;

  function connect() {
    if (!sid) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?sid=${sid}`);

    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }

      if (m.type === 'typing') {
        const el = document.getElementById('typing');
        if (el) {
          el.textContent = `${m.from} is typing`;
          clearTimeout(el._t);
          el._t = setTimeout(() => { el.textContent = ''; }, 2500);
        }
      }

      if (m.type === 'muted') {
        const el = document.getElementById('typing');
        if (el) el.textContent = 'You are muted for five minutes.';
      }

      if (m.type === 'dm' || m.type === 'channel') {
        const log = document.getElementById('log');
        if (log) {
          const bubble = document.createElement('div');
          bubble.className = 'bubble' + (m.from === ME ? ' me' : '');
          bubble.innerHTML = `<div class="muted" style="font-size:12px">${m.from}</div>`
            + (m.kind === 'sticker' ? `<span style="font-size:28px">${m.body}</span>`
               : m.kind === 'image' || m.kind === 'gif'
                 ? `<img src="${m.body}" alt="" style="max-width:220px;border-radius:8px">`
                 : m.body);
          log.appendChild(bubble);
          log.scrollTop = log.scrollHeight;
        }
      }
    };

    // reconnect without a page refresh if the socket drops
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();

  window.ogu = { send: (obj) => ws && ws.readyState === 1 && ws.send(JSON.stringify(obj)) };

  // ---- chat box wiring (profile DM view) ----
  const send = document.getElementById('send');
  if (send) {
    const input = document.getElementById('msg');
    const log = document.getElementById('log');

    const push = (text, kind = 'text') => {
      const to = window.__profileUserId;
      window.ogu.send({ type: 'dm', toUserId: to, body: text, kind });
      // optimistic bubble so it feels instant, then the socket echo confirms it
      const bubble = document.createElement('div');
      bubble.className = 'bubble me';
      bubble.innerHTML = `<div class="muted" style="font-size:12px">you</div>`
        + (kind === 'sticker' ? `<span style="font-size:28px">${text}</span>` : text);
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
    };

    send.addEventListener('click', () => {
      const v = input.value.trim();
      if (!v) return;
      push(v);
      input.value = '';
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });
    input.addEventListener('input', () => {
      window.ogu.send({ type: 'typing', toUserId: window.__profileUserId, scope: 'dm' });
    });
    document.getElementById('sticker')?.addEventListener('click', () => push('🎃', 'sticker'));

    if (window.__profileUserId) {
      fetch('/api/dm/' + window.__profileUserId).then(r => r.json()).then(d => {
        log.innerHTML = d.messages.map(m => `
          <div class="bubble ${m.from_name === ME ? 'me' : ''}">
            <div class="muted" style="font-size:12px">${m.from_name}</div>
            ${m.body}
          </div>`).join('');
        log.scrollTop = log.scrollHeight;
      });
    }
  }
})();

// ---- motyw trzyma się spójnie na każdej stronie ----
(async function syncTheme() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return;
    const { user, themes } = await res.json();
    if (!user || !themes) return;
    const t = themes.find(x => x.id === user.theme);
    if (!t) return;
    const a2 = t.accent2 || t.accent;
    const s = document.documentElement.style;
    s.setProperty('--bg', t.bg);
    s.setProperty('--panel', t.panel);
    s.setProperty('--text', t.text);
    s.setProperty('--accent', t.accent);
    s.setProperty('--accent2', a2);
    s.setProperty('--accent-grad',
      user.gradients ? 'linear-gradient(135deg,' + t.accent + ',' + a2 + ')' : t.accent);
    document.body.dataset.theme = user.theme;
  } catch {}
})();
