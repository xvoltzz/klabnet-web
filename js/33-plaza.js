// ══════════════════════════════════════════
//  HOME: THE PLAZA
//  Everyone klabnet knows, on Home: a honeycomb of faces (the owner's
//  brief started from the 3DS and Wii U's plazas; then "calmer, more
//  polished", so it's packed like the Apple Watch's home screen rather
//  than scattered). Each cell is someone's face and name, their note over
//  it (online or not: notes are back) and what they're playing under it.
//  The most active are in the middle and drawn bigger: posts, replies and
//  hours listened (klabnet-api /api/posts/people). Online: a green dot,
//  and their system's or browser's mark (what they're on); away, a yellow
//  dot; offline people smaller and dimmer. Listening, a bubble comes
//  alive: it glows in the song's colour, rings ripple out from it, it
//  pulses, and bars move by the song's name (the owner: "we want it to feel alive").
//
//  Each sits a little off the grid and floats slowly on its own path
//  (alive, not a static diamond: the owner). Near the pointer the faces
//  ease aside a little and the one under it grows. Pressing one opens that person's profile; your own edits your
//  note. It animates only while that happens; still in Performance mode
//  and with reduced motion.
// ══════════════════════════════════════════
(function () {
  const page = document.getElementById('homePage');
  const host = document.getElementById('hpPlaza');
  if (!page || !host) return;
  const root = document.documentElement;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || root.dataset.fx === 'low';
  const zf = () => (typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1);

  const stage = document.createElement('div');
  stage.className = 'pz-stage';
  host.appendChild(stage);

  let stats = new Map(), statsAt = 0, active = false;
  const bodies = new Map(); // username -> { el, x, y, hx, hy, vx, vy, ... }
  let W = 0, H = 0;

  // ── Who, and how active ──
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
    const me = window.KLAB_USER?.username;
    const set = new Set([...stats.keys(), ...(window.klabRoster?.() || []), ...(window.KLAB_ONLINE_USERNAMES || [])]);
    if (me && me !== 'anonymous') set.add(me);
    set.delete('anonymous');
    return [...set].filter(u => u && !u.endsWith('-bot'));
  }
  const score = u => {
    const s = stats.get(u);
    return s ? s.posts + s.replies * 0.4 + (s.listened / 3600) * 0.8 : 0;
  };

  // ── A cell ──
  function state(u) {
    const p = window.klabPresenceOf?.(u) || {};
    const me = u === window.KLAB_USER?.username;
    const on = me || p.online;
    return {
      me, on, away: on && !me && !!p.away, note: p.note || '', avatar: window.klabResolveUserAvatar?.(u) || null,
      song: on ? p.song || '' : '', artist: p.artist || '', radio: !!p.radio,
      color: on ? p.color : null,
      plat: on ? p.platformInfo : null,
    };
  }
  function inner(u, s) {
    const color = typeof profileColor === 'function' ? profileColor(u) : 'var(--text)';
    const note = s.note
      ? '<div class="pz-note"><span>' + esc(s.note) + '</span></div>'
      : s.me ? '<div class="pz-note pz-note-add">add a note</div>' : '';
    const face = s.avatar
      ? '<img src="' + esc(s.avatar) + '" alt="" draggable="false" />'
      : '<span style="--c:' + color + '">' + esc(u[0].toUpperCase()) + '</span>';
    // Where they are: their system's or browser's mark.
    const plat = s.plat ? '<i class="pz-plat ti ' + s.plat[0] + '" title="' + esc(s.plat[1]) + '"></i>' : '';
    return note +
      '<div class="pz-face">' + face + '<i class="pz-dot"></i>' + plat + '</div>' +
      '<div class="pz-name">' + esc(s.me ? 'you' : u) + '</div>' +
      (s.song ? '<div class="pz-song" title="' + esc(s.song + (s.artist ? ' · ' + s.artist : '')) + '"><span class="pz-eq"><i></i><i></i><i></i></span>' + esc(s.song) + '</div>' : '');
  }

  // ── The stage ──
  // A wide window: the plaza fills the left, the changelog is a column on
  // the right and the only thing that scrolls (the owner's idea). Home is
  // then exactly the window's height. The column takes about a third of
  // the page (css .hp-split), the plaza the rest.
  // Wide is the page's own width (the sidebar takes some of the window),
  // enough for the changelog's column and a plaza beside it.
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
    // Whatever's under it (the page's padding, the dock's room) still made it scroll.
    const over = document.documentElement.scrollHeight - innerHeight;
    if (over > 0) page.style.height = Math.max(420, h - over / z) + 'px';
  }

  // Cells: a honeycomb (every other row half a cell over), as big as fits
  // everyone in the stage, up to CELL_W across.
  const CELL_W = 150, CELL_H = 168;
  let cell = { w: CELL_W, h: CELL_H, k: 1 };
  function measure() {
    fitPage();
    const n = Math.max(1, bodies.size);
    if (page.classList.contains('hp-split')) {
      host.style.removeProperty('height');
      W = host.clientWidth; H = host.clientHeight;
    } else {
      const avail = (page.parentElement?.clientWidth || page.clientWidth) - 48;
      W = Math.max(320, Math.min(1100, avail));
      host.style.setProperty('--pw', W + 'px');
      const cols = Math.max(1, Math.floor(W / CELL_W));
      H = Math.max(260, (Math.ceil(n / cols) + 0.6) * CELL_H);
      host.style.height = H + 'px';
    }
    // Shrink the cells until there are a few more than people.
    // Bigger while there's plenty of room (up to 1.7×), smaller until
    // there are a few more cells than people, but never so small a note
    // runs into the name over it (0.85×). Still not enough room: the
    // plaza is taller than its space and scrolls (no bar).
    const fits = k => Math.floor(W / (CELL_W * k)) * Math.floor(H / (CELL_H * k * 0.9));
    let k = 1.7;
    while (k > 0.85 && fits(k) < n * 1.5) k -= 0.05;
    cell = { w: CELL_W * k, h: CELL_H * k * 0.9, k };
    if (fits(k) < n) {
      const cols = Math.max(1, Math.floor(W / cell.w));
      H = (Math.ceil(n / cols) + 1) * cell.h;
    }
    stage.style.height = H + 'px';
    stage.style.setProperty('--k', k.toFixed(2));
  }

  // The cells nearest the middle, nearest first: the most active get
  // those. Hex distance, so it fills in rings.
  function cells(n) {
    const cols = Math.max(1, Math.floor(W / cell.w)), rows = Math.max(1, Math.floor(H / cell.h));
    const out = [];
    const r0 = (rows - 1) / 2, c0 = (cols - 1) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const shift = (r % 2) * 0.5;
        if (c + shift > cols - 0.5) continue;
        const dx = (c + shift - c0) * cell.w, dy = (r - r0) * cell.h;
        out.push({ x: W / 2 + dx, y: H / 2 + dy + cell.h * 0.08, d: Math.hypot(dx * 0.9, dy * 1.15), a: Math.atan2(dy, dx) });
      }
    }
    out.sort((p, q) => p.d - q.d || p.a - q.a);
    return out.slice(0, n);
  }

  let key = '';
  function paint() {
    if (!active) return;
    const names = everyone();
    for (const [u, b] of bodies) if (!names.includes(u)) { b.el.remove(); bodies.delete(u); }
    for (const u of names) {
      let b = bodies.get(u);
      if (!b) {
        const el = document.createElement('div');
        el.className = 'pz-b';
        el.dataset.u = u;
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', u);
        el.innerHTML = '<div class="pz-float"></div>';
        stage.appendChild(el);
        b = { u, el, float: el.firstChild, x: W / 2, y: H / 2, hx: W / 2, hy: H / 2, vx: 0, vy: 0, html: '', fresh: true };
        bodies.set(u, b);
      }
      b.score = score(u);
      const s = state(u);
      b.el.classList.toggle('on', s.on && !s.away);
      b.el.classList.toggle('away', s.away);
      b.el.classList.toggle('off', !s.on);
      b.el.classList.toggle('me', s.me);
      b.el.classList.toggle('playing', !!s.song);
      if (s.color) b.el.style.setProperty('--glow', s.color.join(','));
      else b.el.style.removeProperty('--glow');
      if (s.plat) b.el.setAttribute('aria-label', u + ', ' + s.plat[1] + (s.song ? ', listening to ' + s.song : ''));
      const html = inner(u, s);
      if (html !== b.html) { b.html = html; b.float.innerHTML = html; }
    }
    const k2 = names.join(',') + '|' + [...stats.values()].map(s => s.posts + ':' + s.listened).join(',') + '|' + W + 'x' + H;
    measure();
    if (k2 !== key) { key = k2; arrange(); }
  }

  // Everyone to a cell, the most active nearest the middle (you among
  // them by your own activity). Sizes: within a cell, by the square root
  // of activity, so the busiest don't dwarf everyone.
  function arrange() {
    const list = [...bodies.values()].sort((a, b) => b.score - a.score || a.u.localeCompare(b.u));
    const spots = cells(list.length);
    const max = Math.max(1, ...list.map(b => b.score));
    list.forEach((b, i) => {
      const t = Math.sqrt(b.score / max);
      const r = Math.round((27 + 19 * t) * cell.k);
      b.el.style.setProperty('--r', r + 'px');
      const p = spots[i] || { x: W / 2, y: H / 2 };
      // Off the grid a little, the same way each time for each person, so
      // it reads as a crowd rather than a diamond (the owner: "boring").
      const h = hash(b.u);
      b.hx = p.x + ((h % 1000) / 1000 - 0.5) * cell.w * 0.34;
      b.hy = p.y + (((h >> 10) % 1000) / 1000 - 0.5) * cell.h * 0.22;
      // Room for the note over the top row and the name under the bottom one.
      b.hy = Math.max(r + 58 * cell.k, Math.min(H - r - 44 * cell.k, b.hy));
      b.hx = Math.max(r + 70 * cell.k, Math.min(W - r - 70 * cell.k, b.hx));
      if (!b.drift) {
        // And each floats on its own slow path (css pzDrift).
        b.drift = true;
        const r = n => (((h >> n) % 1000) / 1000);
        const a = (6 + 6 * r(3)) * cell.k;
        b.el.style.setProperty('--dx1', ((r(5) - 0.5) * 2 * a).toFixed(1) + 'px');
        b.el.style.setProperty('--dy1', ((r(7) - 0.5) * 2 * a).toFixed(1) + 'px');
        b.el.style.setProperty('--dx2', ((r(9) - 0.5) * 2 * a).toFixed(1) + 'px');
        b.el.style.setProperty('--dy2', ((r(11) - 0.5) * 2 * a).toFixed(1) + 'px');
        b.el.style.setProperty('--drift', (8 + 6 * r(13)).toFixed(2) + 's');
        b.el.style.setProperty('--drift-at', (-12 * r(15)).toFixed(2) + 's');
      }
      if (b.fresh || still()) { b.x = b.hx; b.y = b.hy; b.vx = b.vy = 0; b.fresh = false; }
    });
    draw();
    wake();
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ── Easing aside for the pointer ──
  let mouse = null, hover = null, raf = 0, calm = 0, last = 0;
  function step(dt) {
    let moving = 0;
    for (const b of bodies.values()) {
      let tx = b.hx, ty = b.hy;
      if (mouse && b !== hover) {
        const dx = b.hx - mouse.x, dy = b.hy - mouse.y, d = Math.hypot(dx, dy) || 1, R = 170 * cell.k;
        if (d < R) { const f = Math.pow(1 - d / R, 2) * 9 * cell.k; tx += dx / d * f; ty += dy / d * f; }
      }
      // Eased there, no momentum (a spring overshot: "crazy", the owner).
      const e = 1 - Math.pow(0.9, dt);
      b.x += (tx - b.x) * e; b.y += (ty - b.y) * e;
      moving = Math.max(moving, Math.abs(tx - b.x) + Math.abs(ty - b.y));
    }
    return moving;
  }
  function draw() {
    for (const b of bodies.values()) b.el.style.transform = `translate3d(${b.x.toFixed(2)}px, ${b.y.toFixed(2)}px, 0)`;
  }
  function frame(now) {
    raf = 0;
    if (!active) return;
    const dt = Math.min(3, (now - (last || now)) / 16.67) || 1;
    last = now;
    const moving = step(dt);
    draw();
    calm = moving < 0.1 ? calm + 1 : 0;
    if (calm < 10) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!active || raf) return;
    if (still()) { for (const b of bodies.values()) { b.x = b.hx; b.y = b.hy; } draw(); return; }
    calm = 0; last = 0;
    raf = requestAnimationFrame(frame);
  }

  // ── The pointer ──
  const local = e => {
    const r = stage.getBoundingClientRect(), z = zf();
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  };
  let hoverSoundAt = 0;
  stage.addEventListener('pointermove', e => {
    if (still() || e.pointerType !== 'mouse') return;
    mouse = local(e);
    const over = e.target.closest?.('.pz-face')?.closest('.pz-b');
    const b = over ? bodies.get(over.dataset.u) : null;
    if (b !== hover) {
      hover?.el.classList.remove('hover');
      hover = b;
      if (b) {
        b.el.classList.add('hover');
        if (performance.now() - hoverSoundAt > 140) { hoverSoundAt = performance.now(); SFX?.play?.('hover'); }
      }
    }
    wake();
  });
  stage.addEventListener('pointerleave', () => {
    mouse = null;
    hover?.el.classList.remove('hover');
    hover = null;
    wake();
  });
  function press(el) {
    const u = el.dataset.u;
    el.classList.remove('poke'); void el.offsetWidth; el.classList.add('poke');
    if (u === window.KLAB_USER?.username) window.klabEditNote?.();
    else if (typeof openProfileView === 'function') openProfileView(u);
  }
  stage.addEventListener('click', e => { const el = e.target.closest('.pz-b'); if (el) press(el); });
  stage.addEventListener('keydown', e => {
    const el = e.target.closest('.pz-b');
    if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    press(el);
  });

  function relayout() {
    if (!active) return;
    const w = W, h = H;
    measure();
    if (w !== W || h !== H) { key = ''; paint(); }
  }
  new ResizeObserver(relayout).observe(page.parentElement || page);
  addEventListener('resize', relayout);
  wide.addEventListener('change', relayout);

  // ── Hooks ──
  const presenceChanged = window.klabHomePresenceChanged;
  window.klabHomePresenceChanged = () => { presenceChanged?.(); if (active) paint(); };
  const tabChanged = window.klabHomeTabChanged;
  window.klabHomeTabChanged = show => {
    tabChanged?.(show);
    if (show === active) return;
    active = show;
    if (active) { measure(); paint(); loadStats(); }
    else { cancelAnimationFrame(raf); raf = 0; mouse = null; fitPage(); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && active) loadStats(); });
  if (document.body.classList.contains('tab-home-active')) window.klabHomeTabChanged(true);
})();
