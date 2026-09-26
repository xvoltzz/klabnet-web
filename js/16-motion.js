// ══════════════════════════════════════════
//  MOTION — the transitions that make moving around feel continuous.
//    · Sliding pill: one highlight that glides to whichever item is active
//      (header tabs, the Music sidebar) instead of the old one jumping.
//    · Music views fade in as a whole once their content lands, instead of
//      popping (or staggering in card by card, which stuttered at 500 albums).
//    · Album/artist pages ease in, and the browse view eases back.
//  Timing and easing match the --m-* tokens in app.css. Everything here
//  watches classes/DOM the existing code already changes, so none of that
//  code needed touching. Honors prefers-reduced-motion.
// ══════════════════════════════════════════
(function() {
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // Performance mode (see KLAB_FX in index.html) counts as reduced motion.
  const moving = () => !reduce.matches && !window.KLAB_FX?.on();
  window.klabMotionOk = moving;

  function fadeUp(el, { dy = 8, duration = 240, delay = 0 } = {}) {
    if (!el || !moving() || !el.animate) return;
    el.animate([{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }],
      { duration, delay, easing: EASE, fill: 'backwards' });
  }
  window.klabFadeUp = fadeUp;

  // ── Sliding pill ──
  // `container` gets one absolutely-positioned pill behind its items; it
  // follows the element matching `activeSel`. The container must be the
  // items' offset parent (position: relative in CSS).
  function slidingPill(container, activeSel, className, itemSel) {
    if (!container) return;
    const pill = document.createElement('span');
    pill.className = 'motion-pill ' + className;
    pill.setAttribute('aria-hidden', 'true');
    container.prepend(pill);
    container.classList.add('has-pill');
    // A fixed, invisible marker (100px wide, 1px tall) at the pill's own origin. Its
    // on-screen box gives the exact origin and the exact layout→screen
    // scale in whatever engine this is, so positioning needs nothing but
    // on-screen rects (the one measurement every browser must get right).
    // Offsets and zoom conventions differ between engines under
    // html { zoom }: Firefox at 4K put the pill off by its own logic.
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    // 1px tall: the tab bar scrolls sideways on a phone, which makes it a
    // scroll container both ways, and a 100px-tall probe overflowed it —
    // the whole bar could be scrolled up and down under the wheel.
    probe.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:1px;visibility:hidden;pointer-events:none;z-index:-1';
    container.prepend(probe);
    let queued = false, placed = false, baseW = 0, baseH = 0, lastT = '', cur = null;
    // What the nudge below found an engine was off by. Kept and added to
    // every placement after, rather than applied once: the next place()
    // would otherwise recompute the uncorrected spot and slide back.
    const corr = { x: 0, y: 0, w: 0, h: 0 };
    let pressed = null; // an item being pressed: the pill heads there before the click lands
    function apply(x, y, w, h) {
      const t = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(w / baseW).toFixed(4)}, ${(h / baseH).toFixed(4)})`;
      if (t !== lastT) { pill.style.transform = t; lastT = t; }
    }
    // Once a slide ends, check where the pill actually is on screen against
    // its item and nudge it onto the item if an engine placed it off. Only
    // on-screen rects are compared, so this holds under any zoom handling.
    pill.addEventListener('transitionend', e => {
      if (e.propertyName !== 'transform' || !cur || !cur.el.isConnected) return;
      const pr = pill.getBoundingClientRect(), r = cur.el.getBoundingClientRect();
      const dx = (r.left - pr.left) / cur.sx, dy = (r.top - pr.top) / cur.sy;
      const dw = (r.width - pr.width) / cur.sx, dh = (r.height - pr.height) / cur.sy;
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)) < 0.75) return;
      corr.x += dx; corr.y += dy; corr.w += dw; corr.h += dh;
      cur.x += dx; cur.y += dy; cur.w += dw; cur.h += dh;
      apply(cur.x, cur.y, cur.w, cur.h);
    });
    function place() {
      queued = false;
      const el = (pressed && pressed.isConnected ? pressed : null) || container.querySelector(activeSel);
      if (!el || !el.offsetParent || el.offsetWidth === 0) { pill.style.opacity = '0'; return; }
      const o = probe.getBoundingClientRect(), r = el.getBoundingClientRect();
      const sx = o.width / 100, sy = o.height;
      if (!sx || !sy) return;
      const x = (r.left - o.left) / sx + corr.x, y = (r.top - o.top) / sy + corr.y;
      const w = r.width / sx + corr.w, h = r.height / sy + corr.h;
      cur = { el, x, y, w, h, sx, sy };
      // Size by scale from a fixed base, never by width/height: those only
      // animate on the main thread, so the pill froze whenever a tab was
      // busy loading. transform runs on the GPU regardless. The base is the
      // first item's size, so the scale stays near 1 and the corners don't
      // visibly stretch.
      if (!baseW) { baseW = w; baseH = h; pill.style.width = baseW + 'px'; pill.style.height = baseH + 'px'; }
      // apply() skips a value that hasn't changed, so a re-place doesn't
      // restart a slide mid-way.
      apply(x, y, w, h);
      pill.style.opacity = '1';
      if (!placed) { placed = true; requestAnimationFrame(() => pill.classList.add('ready')); }
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    // A click only fires when the button comes back up, ~100ms after the
    // press, and waiting for it read as the pill hesitating. So it starts
    // moving on the press; if the press ends without a click (dragged
    // off), it goes back to the active item.
    if (itemSel) {
      container.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const item = e.target.closest(itemSel);
        if (!item || !container.contains(item)) return;
        pressed = item;
        queued = false;
        place();
      });
      const release = () => setTimeout(() => { pressed = null; schedule(); }, 0);
      window.addEventListener('pointerup', release, true);
      window.addEventListener('pointercancel', release, true);
    }
    new MutationObserver(schedule).observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    new ResizeObserver(schedule).observe(container);
    window.addEventListener('resize', () => { corr.x = corr.y = corr.w = corr.h = 0; schedule(); });
    document.fonts?.ready.then(schedule);
    schedule();
  }
  slidingPill(document.getElementById('tabNav'), '.tab-nav-btn.active', 'motion-pill-tabs', '.tab-nav-btn');
  slidingPill(document.querySelector('#musicShell .music-nav'), '.picker-tab.active, .music-playlist-row.active', 'motion-pill-music', '.picker-tab, .music-playlist-row');

  // ── Music views ──
  // Fade the whole list in when its content is replaced (a new view), not
  // when rows are appended to it (infinite scroll) and not for the
  // "loading…" placeholder.
  const list = document.getElementById('pickerList');
  if (list) {
    let firstSeen = null, queued = false;
    const check = () => {
      queued = false;
      const first = list.firstElementChild;
      if (!first || first === firstSeen) return;
      const replaced = !firstSeen || !firstSeen.isConnected;
      firstSeen = first;
      if (replaced && !first.classList.contains('picker-empty')) fadeUp(list, { dy: 6, duration: 260 });
    };
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(check); } }).observe(list, { childList: true });
  }

  // ── Album / artist pages ──
  const ap = document.getElementById('apPanel');
  const backdrop = document.getElementById('pickerBackdrop');
  if (ap) {
    let wasOpen = ap.classList.contains('open');
    new MutationObserver(() => {
      const open = ap.classList.contains('open');
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) fadeUp(ap.querySelector('.ap-card'), { dy: 12, duration: 300 });
      else fadeUp(backdrop, { dy: -4, duration: 240 });
    }).observe(ap, { attributes: true, attributeFilter: ['class'] });
  }
})();
