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
  const moving = () => !reduce.matches;
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
  function slidingPill(container, activeSel, className) {
    if (!container) return;
    const pill = document.createElement('span');
    pill.className = 'motion-pill ' + className;
    pill.setAttribute('aria-hidden', 'true');
    container.prepend(pill);
    container.classList.add('has-pill');
    let queued = false, placed = false, baseW = 0, baseH = 0;
    function place() {
      queued = false;
      const el = container.querySelector(activeSel);
      if (!el || !el.offsetParent || el.offsetWidth === 0) { pill.style.opacity = '0'; return; }
      // Rects rather than offsetLeft/Top: items can sit inside wrappers
      // (the Music sidebar's groups) that aren't the offset parent's direct children.
      // Rects come back in zoomed pixels on the big-screen `html { zoom }`
      // tiers, while px set on the pill get zoomed again: divide them back.
      const z = zoomFactor();
      const c = container.getBoundingClientRect(), r = el.getBoundingClientRect();
      const x = (r.left - c.left) / z + container.scrollLeft, y = (r.top - c.top) / z + container.scrollTop;
      // Size by scale from a fixed base, never by width/height: those only
      // animate on the main thread, so the pill froze whenever a tab was
      // busy loading. transform runs on the GPU regardless. The base is the
      // first item's size, so the scale stays near 1 and the corners don't
      // visibly stretch.
      const w = r.width / z, h = r.height / z;
      if (!baseW) { baseW = w; baseH = h; pill.style.width = baseW + 'px'; pill.style.height = baseH + 'px'; }
      pill.style.transform = `translate(${x}px, ${y}px) scale(${(w / baseW).toFixed(4)}, ${(h / baseH).toFixed(4)})`;
      pill.style.opacity = '1';
      if (!placed) { placed = true; requestAnimationFrame(() => pill.classList.add('ready')); }
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    new MutationObserver(schedule).observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    new ResizeObserver(schedule).observe(container);
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    schedule();
  }
  slidingPill(document.getElementById('tabNav'), '.tab-nav-btn.active', 'motion-pill-tabs');
  slidingPill(document.querySelector('#musicShell .music-nav'), '.picker-tab.active, .music-playlist-row.active', 'motion-pill-music');

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
