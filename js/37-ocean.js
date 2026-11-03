// ══════════════════════════════════════════
//  THE OCEAN (an easter egg, 2026-11-02)
//  `sharks` (or `ocean`) at the prompt fills the window with an ASCII
//  ocean: sharks and schools of fish drawn in characters, from
//  ascii-sharks (js/vendor/ascii-sharks.js, MIT, fetched the first time).
//  The fish shy away from the pointer and a click splashes. Esc, or the
//  ×, closes it. Like every loop here it stops with the window unfocused
//  (html.win-idle) or hidden, and holds still in Performance mode or with
//  reduced motion. The Ocean scene keeps the same sea behind the page.
// ══════════════════════════════════════════
(function () {
  const LIB = 'js/vendor/ascii-sharks.js?v=0.1.0';
  const root = document.documentElement;
  let libP = null, el = null, engine = null, mo = null;

  function load() {
    return libP ||= new Promise((ok, no) => {
      const s = Object.assign(document.createElement('script'), { src: LIB, onload: ok, onerror: () => { libP = null; no(); } });
      document.head.appendChild(s);
    });
  }

  const still = () => !(window.klabMotionOk?.() ?? true);
  // The engine pauses itself off screen and for reduced motion; this adds
  // the window's own idle and hidden states, and Performance mode.
  function sync() {
    if (!engine) return;
    const run = !root.classList.contains('win-idle') && !document.hidden && !still();
    engine.visible = run;
    engine.schedule();
    if (!run && still()) engine.drawStill();
  }

  async function open() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'klab-ocean';
    el.innerHTML = '<canvas aria-hidden="true"></canvas>' +
      '<button type="button" class="klab-ocean-x" title="Close (Esc)" aria-label="Close"><i class="ti ti-x"></i></button>';
    document.body.appendChild(el);
    el.querySelector('.klab-ocean-x').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    try { await load(); } catch { close(); window.klabTerminal?.say?.('sharks: couldn’t load the ocean'); return; }
    if (!el) return;
    engine = new window.KlabOcean(el.querySelector('canvas'));
    requestAnimationFrame(() => el?.classList.add('in'));
    mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-fx'] });
    document.addEventListener('visibilitychange', sync);
    sync();
  }

  function close() {
    if (!el) return;
    engine?.destroy();
    mo?.disconnect();
    document.removeEventListener('visibilitychange', sync);
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    el = engine = mo = null;
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }

  // ── Ocean, the scene (Settings → Appearance → Scene) ──
  // The same sea always behind the page: a canvas under the sheet, seen
  // round it through the clear title bar and sidebar (css "OCEAN"). It
  // never stops on its own, so it's held to ~15 frames a second (ASCII
  // doesn't need more), stops with the window unfocused or hidden, and is
  // one still frame in Performance mode or with reduced motion. Not on a
  // phone. In the apps too, over the window's material.
  const FRAME_MS = 66;
  let bg = null, bgEngine = null, bgMo = null, bgWant = false;
  const bgOk = () => !matchMedia('(max-width: 760px) and (pointer: coarse)').matches;
  function bgSync() {
    if (!bgEngine) return;
    const run = !root.classList.contains('win-idle') && !document.hidden && !still();
    bgEngine.visible = run;
    bgEngine.schedule();
    if (!run && still()) bgEngine.drawStill();
  }
  async function backdrop(on) {
    bgWant = on = !!on && bgOk();
    if (!on) {
      bgEngine?.destroy(); bgMo?.disconnect(); bg?.remove();
      document.removeEventListener('visibilitychange', bgSync);
      bg = bgEngine = bgMo = null;
      return;
    }
    if (bg) return;
    try { await load(); } catch { return; }
    if (!bgWant || bg) return;
    bg = Object.assign(document.createElement('canvas'), { className: 'ocean-bg' });
    bg.setAttribute('aria-hidden', 'true');
    document.body.prepend(bg);
    const e = bgEngine = new window.KlabOcean(bg);
    // Splashes are for the open ocean; here a click is meant for the page.
    window.removeEventListener('pointerdown', e.onPointerDown);
    const frame = e.frame;
    let drawn = 0;
    e.frame = now => {
      if (now - drawn < FRAME_MS) { e.raf = requestAnimationFrame(e.frame); return; }
      drawn = now;
      frame(now);
    };
    bgMo = new MutationObserver(bgSync);
    bgMo.observe(root, { attributes: true, attributeFilter: ['class', 'data-fx'] });
    document.addEventListener('visibilitychange', bgSync);
    bgSync();
  }

  window.klabOcean = { open, close, backdrop };
  if (typeof currentTheme !== 'undefined' && currentTheme === 'ocean') backdrop(true);
})();
