// ══════════════════════════════════════════
//  HOME: THE PLAZA
//  Who's here, and what they've got to say. The owner (2026-11-02): no
//  welcome, no date ("kinda useless"); a list of who's online and who
//  isn't, and the notes floating around "to be silly", only from people
//  who have one.
//    · Online / Offline: Music's rows (face, name, the song or where
//      they are; offline, when they were last here). A row opens the
//      profile.
//    · The sky: everyone with a note, as their face under the note's
//      bubble, drifting and bouncing off the walls and each other like a
//      screensaver. A bubble stops under the pointer; pressing it opens
//      the profile (yours sets your note). It moves only while Home is up,
//      the tab's visible and the window has focus (html.win-idle); still
//      in Performance mode and with reduced motion.
// ══════════════════════════════════════════
(function () {
  const page = document.getElementById('homePage');
  const host = document.getElementById('hpPlaza');
  if (!page || !host) return;
  const root = document.documentElement;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || root.dataset.fx === 'low';
  const zf = () => (typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1);
  const me = () => window.KLAB_USER?.username;

  host.innerHTML =
    '<div class="pz-sky" id="pzSky"><button class="app-btn pz-set-note" id="pzSetNote" type="button" hidden><i class="ti ti-pencil"></i>Set a note</button>' +
      '<p class="pz-sky-empty" id="pzSkyEmpty" hidden>No one has a note up.</p></div>' +
    '<div class="pz-people">' +
      '<div class="picker-section-label">Online <span class="pz-count" id="pzOnN"></span></div><div class="pz-list" id="pzOn"></div>' +
      '<div class="picker-section-label">Offline <span class="pz-count" id="pzOffN"></span></div><div class="pz-list" id="pzOff"></div>' +
    '</div>';
  const sky = host.querySelector('#pzSky');
  const $ = id => host.querySelector('#' + id);

  let stats = new Map(), statsAt = 0, active = false;

  // ── Who ──
  async function loadStats() {
    if (Date.now() - statsAt < 5 * 60e3) return;
    statsAt = Date.now();
    try {
      const r = await fetchTimeout('/api/posts/people', {}, 8000);
      if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return;
      const data = await r.json();
      stats = new Map((data.people || []).map(p => [p.username, p]));
      paint();
    } catch (e) {}
  }
  function everyone() {
    const set = new Set([...stats.keys(), ...(window.klabRoster?.() || []), ...(window.KLAB_ONLINE_USERNAMES || [])]);
    const m = me();
    if (m && m !== 'anonymous') set.add(m);
    set.delete('anonymous');
    return [...set].filter(u => u && !u.endsWith('-bot'));
  }
  function state(u) {
    const p = window.klabPresenceOf?.(u) || {};
    const mine = u === me();
    const on = mine || !!p.online;
    return {
      mine, on, away: on && (mine ? p.status === 'away' : !!p.away), note: (p.note || '').trim(),
      avatar: window.klabResolveUserAvatar?.(u) || null,
      song: on ? p.song || '' : '', artist: p.artist || '',
      color: on ? p.color : null, plat: on ? p.platformInfo : null,
      paused: on ? p.paused : null, where: on ? p.where || '' : '', status: on ? p.status || '' : '',
    };
  }
  const when = s => s ? new Date(String(s).replace(' ', 'T') + (/[Z+]/.test(s) ? '' : 'Z')).getTime() : 0;
  function face(u, s, cls) {
    const color = typeof profileColor === 'function' ? profileColor(u) : 'var(--text)';
    return '<span class="' + cls + '">' + (s.avatar
      ? '<img src="' + esc(s.avatar) + '" alt="" draggable="false" />'
      : '<b style="--c:' + color + '">' + esc(u[0].toUpperCase()) + '</b>') + '</span>';
  }

  // ── The lists ──
  const WHERE = { home: 'Home', social: 'Social', feed: 'On the feed', chat: 'In chat', photos: 'Looking at photos', music: 'In music', radio: 'On the radio' };
  function row(u, s) {
    let sub = '';
    // What they're doing: the song, or that they're not listening and
    // where they are; Away / Do not disturb in front of it.
    if (s.song) sub = '<span class="pz-eq"><i></i><i></i><i></i></span>' + esc(s.song) + (s.artist ? ' · ' + esc(s.artist) : '');
    else if (s.on) {
      const doing = s.paused ? 'Paused · ' + esc(s.paused.song) : ['Not listening', WHERE[s.where]].filter(Boolean).join(' · ');
      sub = s.status === 'dnd' ? 'Do not disturb · ' + doing : s.away ? 'Away' : doing;
    }
    else { const t = when(stats.get(u)?.lastSeen); sub = t ? 'Last here ' + esc(shortAgo(t)) : ''; }
    const cls = 'pz-row' + (s.on ? s.status === 'dnd' ? ' dnd' : s.away ? ' away' : ' on' : ' off') + (s.song ? ' playing' : '');
    const glow = s.color ? ' style="--glow:' + s.color.join(',') + '"' : '';
    return '<button class="' + cls + '" data-u="' + esc(u) + '"' + glow + ' type="button">' +
      '<span class="pz-row-face">' + face(u, s, 'pz-av') + '<i class="pz-dot"></i></span>' +
      '<span class="pz-row-text"><span class="pz-row-name">' + esc(s.mine ? u + ' (you)' : u) + '</span>' +
      (sub ? '<span class="pz-row-sub">' + sub + '</span>' : '') + '</span></button>';
  }
  let listKey = '';
  function paintLists(names, states) {
    const on = names.filter(u => states.get(u).on), off = names.filter(u => !states.get(u).on);
    // Online: you, then who's playing, then by name. Offline: most recent first.
    on.sort((a, b) => (states.get(b).mine - states.get(a).mine) || (!!states.get(b).song - !!states.get(a).song) || a.localeCompare(b));
    off.sort((a, b) => when(stats.get(b)?.lastSeen) - when(stats.get(a)?.lastSeen) || a.localeCompare(b));
    const html = [on.map(u => row(u, states.get(u))).join(''), off.map(u => row(u, states.get(u))).join('')];
    const k = html.join('|');
    if (k === listKey) return;
    listKey = k;
    $('pzOn').innerHTML = html[0] || '<p class="pz-empty">No one</p>';
    $('pzOff').innerHTML = html[1] || '<p class="pz-empty">No one</p>';
    $('pzOnN').textContent = on.length;
    $('pzOffN').textContent = off.length;
  }
  host.querySelector('.pz-people').addEventListener('click', e => {
    const r = e.target.closest('.pz-row');
    if (r && typeof openProfileView === 'function') openProfileView(r.dataset.u);
  });

  // ── The sky ──
  const bubbles = new Map(); // username -> { el, x, y, vx, vy, w, h, html }
  let W = 0, H = 0;
  function bubbleHTML(u, s) {
    return '<div class="pz-note"><span>' + esc(s.note) + '</span></div>' + face(u, s, 'pz-face') +
      '<div class="pz-name">' + esc(s.mine ? 'you' : u) + '</div>';
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function paintSky(names, states) {
    const noted = names.filter(u => states.get(u).note);
    for (const [u, b] of bubbles) if (!noted.includes(u)) { b.el.remove(); bubbles.delete(u); }
    measureSky();
    noted.forEach((u, i) => {
      const s = states.get(u);
      let b = bubbles.get(u);
      if (!b) {
        const el = document.createElement('div');
        el.className = 'pz-b';
        el.dataset.u = u;
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        sky.appendChild(el);
        // Somewhere of its own, heading off its own way, slowly (px/s).
        const h = hash(u), a = (h % 6283) / 1000, v = 14 + (h >> 13) % 12;
        b = { u, el, x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 0, h: 0, html: '', fresh: true, seed: h };
        bubbles.set(u, b);
      }
      b.el.classList.toggle('off', !s.on);
      b.el.classList.toggle('me', s.mine);
      b.el.setAttribute('aria-label', u + ': ' + s.note);
      const html = bubbleHTML(u, s);
      if (html !== b.html) { b.html = html; b.el.innerHTML = html; b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; }
    });
    // Fresh ones (and all of them, held still): spread over the sky, a
    // loose grid with a nudge each, so a still sky doesn't stack them.
    const list = [...bubbles.values()];
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length * W / Math.max(1, H))));
    const rows = Math.max(1, Math.ceil(list.length / cols));
    list.forEach((b, i) => {
      if (!b.fresh && !still()) return;
      b.fresh = false;
      const cx = (i % cols + 0.5) / cols, cy = (Math.floor(i / cols) + 0.5) / rows;
      const j = n => (((b.seed >> n) % 1000) / 1000 - 0.5) * 0.4;
      b.x = (cx + j(3) / cols) * W - b.w / 2;
      b.y = (cy + j(9) / rows) * H - b.h / 2;
      clamp(b);
    });
    const mine = states.get(me());
    $('pzSetNote').hidden = !mine || !!mine.note;
    $('pzSkyEmpty').hidden = bubbles.size > 0;
    draw();
    wake();
  }
  function measureSky() {
    W = sky.clientWidth; H = sky.clientHeight;
    for (const b of bubbles.values()) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; clamp(b); }
  }
  function clamp(b) {
    b.x = Math.max(0, Math.min(W - b.w, b.x));
    b.y = Math.max(0, Math.min(H - b.h, b.y));
  }

  // ── Floating ──
  let raf = 0, last = 0, hover = null;
  const running = () => active && !document.hidden && !root.classList.contains('win-idle') && !still();
  function step(dt) {
    const list = [...bubbles.values()];
    for (const b of list) {
      if (b === hover) continue;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); }
      if (b.x > W - b.w) { b.x = Math.max(0, W - b.w); b.vx = -Math.abs(b.vx); }
      if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); }
      if (b.y > H - b.h) { b.y = Math.max(0, H - b.h); b.vy = -Math.abs(b.vy); }
    }
    // Bumping: two that overlap push apart and swap their headings along
    // the line between them (like billiard balls, gently).
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      if (ox <= 0 || oy <= 0) continue;
      const sx = Math.sign((a.x + a.w / 2) - (c.x + c.w / 2)) || 1, sy = Math.sign((a.y + a.h / 2) - (c.y + c.h / 2)) || 1;
      const push = Math.min(ox, oy) / 2 * 0.2;
      if (ox < oy) {
        if (a !== hover) a.x += sx * push; if (c !== hover) c.x -= sx * push;
        if (sx * (a.vx - c.vx) < 0) [a.vx, c.vx] = [c.vx, a.vx];
      } else {
        if (a !== hover) a.y += sy * push; if (c !== hover) c.y -= sy * push;
        if (sy * (a.vy - c.vy) < 0) [a.vy, c.vy] = [c.vy, a.vy];
      }
      // One held under the pointer doesn't move: the other bounces off.
      if (a === hover) { c.vx = -sx * Math.abs(c.vx); }
      if (c === hover) { a.vx = sx * Math.abs(a.vx); }
    }
  }
  function draw() {
    for (const b of bubbles.values()) b.el.style.transform = `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0)`;
  }
  function frame(now) {
    raf = 0;
    if (!running()) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    step(dt);
    draw();
    if (bubbles.size) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (raf || !running() || !bubbles.size) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  // Back from another window: on again.
  new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ['class', 'data-fx'] });
  document.addEventListener('visibilitychange', wake);

  sky.addEventListener('pointerover', e => {
    const el = e.target.closest('.pz-b');
    hover = el ? bubbles.get(el.dataset.u) || null : null;
  });
  sky.addEventListener('pointerleave', () => { hover = null; });
  function press(el) {
    const u = el.dataset.u;
    if (u === me()) window.klabEditNote?.();
    else if (typeof openProfileView === 'function') openProfileView(u);
  }
  sky.addEventListener('click', e => {
    if (e.target.closest('#pzSetNote')) { window.klabEditNote?.(); return; }
    const el = e.target.closest('.pz-b');
    if (el) press(el);
  });
  sky.addEventListener('keydown', e => {
    const el = e.target.closest('.pz-b');
    if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    press(el);
  });

  // ── The page ──
  // A wide window: the plaza on the left (the lists, the sky beside
  // them), the changelog a column on the right and the only thing that
  // scrolls. Home is then exactly the window's height. Wide is the
  // page's own width (the sidebar takes some of the window).
  const wide = matchMedia('(pointer: fine)');
  const SPLIT_AT = 900;
  function fitPage() {
    const room = (page.parentElement?.clientWidth || page.clientWidth) / zf();
    const on = wide.matches && active && room >= SPLIT_AT;
    page.classList.toggle('hp-split', on);
    if (!on) { page.style.removeProperty('height'); return; }
    const z = zf();
    const top = page.getBoundingClientRect().top + scrollY;
    const h = (innerHeight - top) / z - 12;
    page.style.height = Math.max(420, h) + 'px';
    const over = document.documentElement.scrollHeight - innerHeight;
    if (over > 0) page.style.height = Math.max(420, h - over / z) + 'px';
  }

  function paint() {
    if (!active) return;
    const names = everyone();
    const states = new Map(names.map(u => [u, state(u)]));
    paintLists(names, states);
    paintSky(names, states);
  }
  function relayout() {
    if (!active) return;
    fitPage();
    measureSky();
    draw();
  }
  new ResizeObserver(relayout).observe(page.parentElement || page);
  new ResizeObserver(() => { if (active) { measureSky(); draw(); } }).observe(sky);
  wide.addEventListener('change', relayout);

  // ── Hooks ──
  const presenceChanged = window.klabHomePresenceChanged;
  window.klabHomePresenceChanged = () => { presenceChanged?.(); if (active) paint(); };
  window.addEventListener('klab:status', () => { if (active) paint(); });
  const tabChanged = window.klabHomeTabChanged;
  window.klabHomeTabChanged = show => {
    tabChanged?.(show);
    if (show === active) return;
    active = show;
    if (active) { fitPage(); paint(); loadStats(); }
    else { cancelAnimationFrame(raf); raf = 0; hover = null; fitPage(); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && active) loadStats(); });
  if (document.body.classList.contains('tab-home-active')) window.klabHomeTabChanged(true);
})();
