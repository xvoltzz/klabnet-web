// ══════════════════════════════════════════
//  HOME: THE PLAZA
//  Everyone klabnet knows, as bubbles on Home (the owner's brief: the 3DS
//  and Wii U's plazas, silly and interactive). Each bubble is someone's
//  face and name, their note over it in a speech bubble (online or not:
//  notes are back), and what they're playing under it. Its size is how
//  much they've been around: posts, replies and hours listened
//  (klabnet-api /api/posts/people). Online people bob, with a green dot;
//  away, a yellow one; offline people sit still and grey.
//
//  The bubbles are soft bodies: they keep out of each other's way, lean
//  away from the pointer, and can be picked up and flung. Pressing one
//  opens that person's profile; your own edits your note. It animates
//  only while something moves and stops when it settles. Still in
//  Performance mode and with reduced motion.
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
  const bodies = new Map(); // username -> body
  let W = 0, H = 0;

  // ── Who, and how big ──
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
    set.delete(undefined);
    return [...set].filter(u => u && !u.endsWith('-bot'));
  }
  const score = u => {
    const s = stats.get(u);
    return s ? s.posts + s.replies * 0.4 + (s.listened / 3600) * 0.8 : 0;
  };

  // ── Drawing ──
  function state(u) {
    const p = window.klabPresenceOf?.(u) || {};
    const me = u === window.KLAB_USER?.username;
    const on = me || p.online;
    return {
      me, on, away: on && !me && !!p.away,
      note: p.note || '',
      song: p.song || '',
      avatar: window.klabResolveUserAvatar?.(u) || null,
    };
  }
  function inner(u, s) {
    const color = typeof profileColor === 'function' ? profileColor(u) : 'var(--text)';
    const note = s.note
      ? '<div class="pz-note">' + esc(s.note) + '</div>'
      : s.me ? '<div class="pz-note pz-note-add">add a note</div>' : '';
    const face = s.avatar
      ? '<img src="' + esc(s.avatar) + '" alt="" draggable="false" />'
      : '<span style="background:' + color + '">' + esc(u[0].toUpperCase()) + '</span>';
    return note +
      '<div class="pz-face">' + face + '<i class="pz-dot"></i></div>' +
      '<div class="pz-name" style="color:' + color + '">' + esc(s.me ? 'you' : u) + '</div>' +
      (s.song ? '<div class="pz-song"><i class="ti ti-music"></i>' + esc(s.song) + '</div>' : '');
  }

  // A wide window: the bubbles fill the left, the changelog is a column
  // on the right and the only thing that scrolls (the owner's idea). Home
  // is then exactly the window's height.
  const wide = matchMedia('(min-width: 1100px) and (pointer: fine)');
  function fitPage() {
    const on = wide.matches && active;
    page.classList.toggle('hp-split', on);
    if (!on) { page.style.removeProperty('height'); return; }
    const z = zf();
    const top = page.getBoundingClientRect().top + scrollY;
    const room = parseFloat(getComputedStyle(document.body).getPropertyValue('--dock-room')) || 0;
    let h = (innerHeight - top) / z - (document.body.classList.contains('player-hidden') ? 12 : room * 16 + 12);
    page.style.height = Math.max(420, h) + 'px';
    // Whatever's under it (the page's own padding) still made it scroll.
    const over = document.documentElement.scrollHeight - innerHeight;
    if (over > 0) page.style.height = Math.max(420, h - over / z) + 'px';
  }
  function measure() {
    fitPage();
    if (page.classList.contains('hp-split')) { W = host.clientWidth; H = host.clientHeight; host.style.removeProperty('height'); return; }
    const panel = page.parentElement;
    const avail = (panel?.clientWidth || page.clientWidth) - 48;
    const w = Math.max(320, Math.min(1500, avail));
    host.style.setProperty('--pw', w + 'px');
    // Tall enough for everyone at their size: the bubbles cover about two
    // fifths of it.
    // Tall enough that everyone's room covers about a third of it.
    let room = 0;
    for (const b of bodies.values()) room += 2 * hw(b) * (up(b) + down(b));
    const h = Math.max(440, Math.min(room * 3 / w, 860));
    host.style.height = h + 'px';
    W = w; H = h;
  }

  // Sizes: from the smallest to the biggest, by the square root of how
  // much they've been around (so the most active doesn't dwarf everyone),
  // all scaled to cover about two fifths of the stage.
  function size() {
    const list = [...bodies.values()];
    const max = Math.max(1, ...list.map(b => b.score));
    list.forEach(b => { b.t = Math.sqrt(b.score / max); });
    const raw = list.reduce((a, b) => a + Math.PI * (26 + 40 * b.t) ** 2, 0);
    const k = Math.max(0.6, Math.min(1.25, Math.sqrt((W * H * 0.4) / Math.max(1, raw))));
    list.forEach(b => {
      b.r = Math.round((26 + 40 * b.t) * k);
      b.el.style.setProperty('--r', b.r + 'px');
    });
  }
  // The room each one keeps: a box around its note, face and name (so a
  // note never sits on a neighbour), with a margin.
  const GAP = 14;
  const hw = b => Math.max(b.r, b.noteW / 2, b.nameW / 2) + GAP;
  const up = b => b.r + (b.noteH ? b.noteH + 16 : 4) + GAP / 2;
  const down = b => b.r + (b.song ? 44 : 28) + GAP / 2;
  function measureBody(b) {
    const n = b.float.querySelector('.pz-note'), m = b.float.querySelector('.pz-name');
    b.noteW = n ? n.offsetWidth : 0;
    b.noteH = n ? n.offsetHeight : 0;
    b.nameW = m ? m.offsetWidth : 0;
  }

  let key = '';
  function paint() {
    if (!active) return;
    const names = everyone();
    const k2 = names.join(',') + '|' + [...stats.values()].map(s => s.posts + ':' + s.listened).join(',');
    let added = false;
    // Gone: removed. New: added near the middle.
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
        el.style.setProperty('--bob', (3.2 + Math.random() * 2.4).toFixed(2) + 's');
        el.style.setProperty('--bob-at', (-Math.random() * 5).toFixed(2) + 's');
        el.innerHTML = '<div class="pz-float"></div>';
        stage.appendChild(el);
        b = { u, el, float: el.firstChild, x: 0, y: 0, vx: 0, vy: 0, r: 30, html: '', placed: false, noteW: 0, noteH: 0, nameW: 0, song: false };
        bodies.set(u, b);
        added = true;
      }
      b.score = score(u);
      const s = state(u);
      b.hasNote = !!(s.note || s.me);
      b.el.classList.toggle('on', s.on && !s.away);
      b.el.classList.toggle('away', s.away);
      b.el.classList.toggle('off', !s.on);
      b.el.classList.toggle('me', s.me);
      b.el.classList.toggle('playing', !!s.song);
      b.song = !!s.song;
      const html = inner(u, s);
      if (html !== b.html) { b.html = html; b.float.innerHTML = html; measureBody(b); }
    }
    measure();
    if (added || k2 !== key) {
      key = k2;
      size();
      layout();
    }
    wake();
  }

  // ── First places: the biggest in the middle, the rest spiralling out
  // (a sunflower's, stretched to the stage), then settled before it shows.
  function layout() {
    const list = [...bodies.values()].sort((a, b) => b.score - a.score);
    const fresh = list.filter(b => !b.placed);
    if (!fresh.length) { settle(60); return; }
    const all = list.every(b => !b.placed);
    list.forEach((b, i) => {
      if (b.placed) return;
      if (all) {
        const a = i * 2.39996, d = Math.sqrt(i + 0.5) / Math.sqrt(list.length);
        b.x = W / 2 + Math.cos(a) * d * W * 0.45;
        b.y = H / 2 + Math.sin(a) * d * H * 0.42;
      } else {
        b.x = W / 2 + (Math.random() - 0.5) * 40;
        b.y = H / 2 + (Math.random() - 0.5) * 40;
      }
      b.placed = true;
    });
    settle(all ? 400 : 80);
  }
  function settle(n) { for (let i = 0; i < n; i++) step(1, true); draw(); }

  // ── The physics ──
  let mouse = null, hover = null, drag = null, raf = 0, calm = 0, last = 0;
  function step(dt, quiet) {
    const list = [...bodies.values()];
    const cx = W / 2, cy = H / 2;
    for (const b of list) {
      if (b === drag?.b) continue;
      // A gentle pull to the middle, gentler sideways (the stage is wide).
      b.vx += (cx - b.x) * 0.0001 * dt;
      b.vy += (cy - b.y) * 0.0006 * dt;
      // Away from the pointer: the ones near it lean out of its way.
      if (mouse && !quiet && b !== hover && !drag) {
        const dx = b.x - mouse.x, dy = b.y - mouse.y, d = Math.hypot(dx, dy) || 1, R = b.r + 110;
        if (d < R) { const f = (R - d) / R * 1.1 * dt; b.vx += dx / d * f; b.vy += dy / d * f; }
      }
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const ma = a.r * a.r, mb = b.r * b.r, sum = ma + mb;
        const fa = a === drag?.b ? 0 : b === drag?.b ? 1 : mb / sum, fb = b === drag?.b ? 0 : a === drag?.b ? 1 : ma / sum;
        let dx = b.x - a.x, dy = b.y - a.y;
        if (!dx && !dy) dx = Math.random() - 0.5;
        // Elbow room: everyone drifts apart a little, so they spread over
        // the stage rather than bunching in the middle.
        const d = Math.hypot(dx, dy), far = 480;
        if (d < far) {
          const f = (far - d) / far * 0.05 * dt;
          a.vx -= dx / d * f * fa * 2; a.vy -= dy / d * f * fa * 2;
          b.vx += dx / d * f * fb * 2; b.vy += dy / d * f * fb * 2;
        }
        // Boxes overlapping: apart along the shallower side.
        const ox = Math.min(a.x + hw(a), b.x + hw(b)) - Math.max(a.x - hw(a), b.x - hw(b));
        const oy = Math.min(a.y + down(a), b.y + down(b)) - Math.max(a.y - up(a), b.y - up(b));
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) {
          const p = ox * 0.3 * Math.sign(dx);
          a.x -= p * fa; b.x += p * fb;
        } else {
          const p = oy * 0.3 * Math.sign(dy || 1);
          a.y -= p * fa; b.y += p * fb;
        }
      }
    }
    let moving = 0;
    for (const b of list) {
      if (b === drag?.b) continue;
      const damp = Math.pow(0.84, dt);
      b.vx *= damp; b.vy *= damp;
      b.x += b.vx * dt; b.y += b.vy * dt;
      // Inside the stage, bouncing softly off its edges.
      const L = hw(b) - GAP, T = up(b), B = H - down(b);
      if (b.x < L) { b.x = L; b.vx = Math.abs(b.vx) * 0.5; }
      if (b.x > W - L) { b.x = W - L; b.vx = -Math.abs(b.vx) * 0.5; }
      if (b.y < T) { b.y = T; b.vy = Math.abs(b.vy) * 0.5; }
      if (b.y > B) { b.y = B; b.vy = -Math.abs(b.vy) * 0.5; }
      moving = Math.max(moving, Math.abs(b.vx) + Math.abs(b.vy));
    }
    return moving;
  }
  function draw() {
    for (const b of bodies.values()) b.el.style.transform = `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0)`;
  }
  function frame(now) {
    raf = 0;
    if (!active) return;
    const dt = Math.min(3, (now - (last || now)) / 16.67) || 1;
    last = now;
    const moving = step(dt, false);
    draw();
    calm = moving < 0.03 && !drag && !mouse ? calm + 1 : 0;
    if (calm < 20) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!active || still() || raf) return;
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
    if (still()) return;
    mouse = local(e);
    if (drag) {
      const now = performance.now(), b = drag.b;
      const nx = mouse.x - drag.dx, ny = mouse.y - drag.dy;
      const dt = Math.max(1, now - drag.at) / 16.67;
      b.vx = (nx - b.x) / dt; b.vy = (ny - b.y) / dt;
      b.x = nx; b.y = ny; drag.at = now;
      if (Math.hypot(mouse.x - drag.sx, mouse.y - drag.sy) > 5) drag.moved = true;
    }
    const over = e.target.closest?.('.pz-face')?.closest('.pz-b');
    const b = over ? bodies.get(over.dataset.u) : null;
    if (b !== hover) {
      hover?.el.classList.remove('hover');
      hover = b;
      if (b) {
        b.el.classList.add('hover');
        if (!drag && performance.now() - hoverSoundAt > 140) { hoverSoundAt = performance.now(); SFX?.play?.('hover'); }
      }
    }
    wake();
  });
  stage.addEventListener('pointerleave', () => {
    if (drag) return;
    mouse = null;
    hover?.el.classList.remove('hover');
    hover = null;
    wake();
  });
  stage.addEventListener('pointerdown', e => {
    const el = e.target.closest('.pz-b');
    if (!el || e.button > 0) return;
    const b = bodies.get(el.dataset.u);
    if (!b) return;
    e.preventDefault();
    const p = local(e);
    if (!still()) stage.setPointerCapture(e.pointerId);
    drag = { b, dx: p.x - b.x, dy: p.y - b.y, sx: p.x, sy: p.y, at: performance.now(), moved: false, id: e.pointerId };
    b.el.classList.add('held');
    wake();
  });
  const release = e => {
    if (!drag) return;
    const { b, moved } = drag;
    drag = null;
    b.el.classList.remove('held');
    if (e.type === 'pointercancel') return;
    if (!moved) {
      // A press: theirs, or your note.
      b.el.classList.remove('poke'); void b.el.offsetWidth; b.el.classList.add('poke');
      if (b.u === window.KLAB_USER?.username) window.klabEditNote?.();
      else if (typeof openProfileView === 'function') { SFX?.play?.('click'); openProfileView(b.u); }
    } else {
      // A fling: off it goes (a little faster than you threw it).
      b.vx *= 1.4; b.vy *= 1.4;
      SFX?.play?.('nav');
    }
    wake();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  // Keyboard: each bubble is a button.
  stage.addEventListener('keydown', e => {
    const el = e.target.closest('.pz-b');
    if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const u = el.dataset.u;
    if (u === window.KLAB_USER?.username) window.klabEditNote?.();
    else if (typeof openProfileView === 'function') openProfileView(u);
  });

  new ResizeObserver(() => {
    if (!active) return;
    const w = W, h = H;
    measure();
    if (w && (w !== W || h !== H)) {
      // Keep everyone where they were, relative to the stage.
      for (const b of bodies.values()) { b.x *= W / w; b.y *= H / h; }
      size();
      settle(40);
      wake();
    }
  }).observe(page.parentElement || page);
  addEventListener('resize', () => { if (active) { measure(); wake(); } });
  wide.addEventListener('change', () => { if (active) { measure(); size(); settle(60); wake(); } });

  // ── Hooks ──
  const presenceChanged = window.klabHomePresenceChanged;
  window.klabHomePresenceChanged = () => { presenceChanged?.(); if (active) paint(); };
  const tabChanged = window.klabHomeTabChanged;
  window.klabHomeTabChanged = show => {
    tabChanged?.(show);
    if (show === active) return;
    active = show;
    if (active) { paint(); loadStats(); }
    else { cancelAnimationFrame(raf); raf = 0; mouse = null; fitPage(); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && active) loadStats(); });
  if (document.body.classList.contains('tab-home-active')) window.klabHomeTabChanged(true);
})();
