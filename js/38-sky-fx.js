// ══════════════════════════════════════════
//  SKY'S WEATHER (2026-11-02)
//  On a holiday the Sky theme (js/01-shell.js klabSky) may bring weather
//  to the frame: snow through the holiday season (heavier at Christmas),
//  falling leaves at Halloween and Thanksgiving, hearts on Valentine's,
//  fireworks after dark on the 4th, New Year's Eve and Lunar New Year.
//  One canvas over the window, clipped to the frame (the title bar and the
//  sidebar), so it's never over the page and never under the sheet's blur
//  (a moving thing under a blur redraws the blur every frame).
//  Like every loop here: ~30fps, stopped with the window unfocused or
//  hidden, still in Performance mode or with reduced motion (and no
//  fireworks then), not on a phone or under the apps' native material.
// ══════════════════════════════════════════
(function () {
  const root = document.documentElement;
  const FRAME_MS = 33;
  let cv = null, ctx = null, kind = null, hol = null, night = false, parts = [], raf = 0, last = 0, drawn = 0, nextBurst = 0, W = 0, H = 0, dpr = 1;

  const still = () => !(window.klabMotionOk?.() ?? true);
  const ok = () => !root.classList.contains('app-material') && !matchMedia('(max-width: 760px) and (pointer: coarse)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const COLORS = {
    leaves: ['#e0712c', '#c9452b', '#e9a23b', '#a8572a', '#d9822b'],
    hearts: ['#ff7aa8', '#ff9bbd', '#f25d8e', '#ffc2d6'],
    july4: ['#ff4b4b', '#ffffff', '#5b8cff'],
    newyear: ['#ffd36b', '#ffffff', '#ffe9a8', '#f2b84b'],
    lunar: ['#ff4b3e', '#ffd36b', '#ff8a3d'],
  };

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed() {
    parts = [];
    const area = W * H;
    if (kind === 'snow') for (let i = 0, n = Math.round(area / (hol?.heavy ? 4500 : 9000)); i < n; i++) parts.push(flake(true));
    if (kind === 'leaves') for (let i = 0, n = Math.round(area / 45000); i < n; i++) parts.push(leaf(true));
    if (kind === 'hearts') for (let i = 0, n = Math.round(area / 50000); i < n; i++) parts.push(heart(true));
  }
  const flake = any => ({ x: rand(0, W), y: any ? rand(0, H) : -4, r: rand(0.7, 2.3), vy: rand(14, 38), sw: rand(0, 6.28), a: rand(0.45, 0.95) });
  const leaf = any => ({ x: rand(0, W), y: any ? rand(0, H) : -10, vy: rand(22, 46), sw: rand(0, 6.28), rot: rand(0, 6.28), spin: rand(-2, 2), c: pick(COLORS.leaves), s: rand(4, 7) });
  const heart = any => ({ x: rand(0, W), y: any ? rand(0, H) : H + 10, vy: -rand(10, 24), sw: rand(0, 6.28), c: pick(COLORS.hearts), s: rand(5, 9), a: rand(0.5, 0.9) });
  function burst() {
    const cols = COLORS[hol?.key] || COLORS.newyear, c = pick(cols);
    // Somewhere the frame shows: the sidebar's column or the title bar's band.
    const nav = parseFloat(getComputedStyle(root).getPropertyValue('--nav-w')) || 0;
    const tb = parseFloat(getComputedStyle(root).getPropertyValue('--tb-h')) || 48;
    const inSide = nav > 60 && Math.random() < 0.7;
    const x = inSide ? rand(20, nav - 20) : rand(nav + 40, W - 40), y = inSide ? rand(80, H * 0.6) : rand(8, tb - 8);
    for (let i = 0, n = 34; i < n; i++) {
      const a = (i / n) * 6.283 + rand(-0.1, 0.1), v = rand(40, 95);
      parts.push({ fw: true, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rand(1.1, 1.6), c: Math.random() < 0.2 ? '#fff' : c });
    }
  }

  function step(dt, t) {
    if (kind === 'fireworks') {
      if (night && t > nextBurst) { burst(); nextBurst = t + rand(900, 2600); }
      parts = parts.filter(p => (p.life += dt) < p.max);
      for (const p of parts) { p.vy += 38 * dt; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; }
      return;
    }
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.sw += dt * 1.3;
      p.y += p.vy * dt;
      p.x += Math.sin(p.sw) * (kind === 'leaves' ? 26 : 10) * dt;
      if (p.rot != null) p.rot += p.spin * dt;
      if (p.y > H + 12 || p.y < -14) parts[i] = kind === 'snow' ? flake(false) : kind === 'leaves' ? leaf(false) : heart(false);
    }
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (kind === 'snow') {
      ctx.fillStyle = '#fff';
      for (const p of parts) { ctx.globalAlpha = p.a; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
    } else if (kind === 'leaves') {
      for (const p of parts) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = 0.85; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.48, 0, 0, 6.283); ctx.fill(); ctx.restore();
      }
    } else if (kind === 'hearts') {
      for (const p of parts) {
        const s = p.s; ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.beginPath();
        ctx.moveTo(p.x, p.y + s * 0.35);
        ctx.bezierCurveTo(p.x - s, p.y - s * 0.4, p.x - s * 0.45, p.y - s, p.x, p.y - s * 0.45);
        ctx.bezierCurveTo(p.x + s * 0.45, p.y - s, p.x + s, p.y - s * 0.4, p.x, p.y + s * 0.35);
        ctx.fill();
      }
    } else if (kind === 'fireworks') {
      for (const p of parts) { ctx.globalAlpha = Math.max(0, 1 - p.life / p.max); ctx.fillStyle = p.c; ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4); }
    }
    ctx.globalAlpha = 1;
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - drawn < FRAME_MS) return;
    const dt = Math.min(0.1, (t - (last || t)) / 1000);
    last = t; drawn = t;
    step(dt, t);
    draw();
  }
  function sync() {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    if (!cv) return;
    if (still()) { if (kind === 'fireworks') parts = []; draw(); return; }
    if (root.classList.contains('win-idle') || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  let mo = null;
  function set(h, isNight) {
    const want = ok() && root.classList.contains('sky') && h?.fx ? h.fx : null;
    hol = h; night = !!isNight;
    if (want === kind && cv) return;
    kind = want;
    if (!kind) {
      cancelAnimationFrame(raf); raf = 0;
      cv?.remove(); cv = ctx = null; parts = [];
      mo?.disconnect(); mo = null;
      document.removeEventListener('visibilitychange', sync);
      removeEventListener('resize', onResize);
      return;
    }
    if (!cv) {
      cv = Object.assign(document.createElement('canvas'), { className: 'sky-fx' });
      cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv);
      ctx = cv.getContext('2d');
      mo = new MutationObserver(sync);
      mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-fx'] });
      document.addEventListener('visibilitychange', sync);
      addEventListener('resize', onResize);
    }
    size(); seed(); sync();
  }
  let rz = 0;
  function onResize() { clearTimeout(rz); rz = setTimeout(() => { if (cv) { size(); seed(); sync(); } }, 200); }

  window.klabSkyFx = { set, state: () => ({ kind, holiday: hol?.key || null, night, count: parts.length }) };
  // Sky painted before this loaded: catch up.
  if (root.classList.contains('sky') && typeof klabSky !== 'undefined') klabSky.paint();
})();
