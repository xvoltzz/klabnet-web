// ══════════════════════════════════════════
//  SHARED UTILITIES
//  Loaded before everything else. These are plain function declarations
//  used from several of the files that follow — they lived in the player
//  file only because that's where they happened to be written when this
//  was one script and hoisting made position irrelevant. It isn't any
//  more: each file is its own script now, so a helper has to be declared
//  in an earlier file than the code that calls it at load time.
// ══════════════════════════════════════════

// Fetch with a hard timeout. On LAN a hung request is basically impossible,
// but off-site a slow/dropped connection can leave a boot-critical or
// polling fetch pending forever with no visible failure — abort it instead
// so identity/prefs/presence checks fail fast and the app keeps moving.
function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 10000);
  return fetch(url, { ...(opts || {}), signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// Escape a string for safe interpolation into an innerHTML template —
// used anywhere a song/artist/album/playlist name (Navidrome metadata or
// direct user input, e.g. a typed playlist name) gets built into markup.
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Turns bare URLs in user-typed text into real anchors. URLs are matched on
// the RAW string (before escaping) so the href is built from the actual
// characters, then href and label are escaped independently.
//
// Only "http://", "https://" and a bare "www." host can match, so a
// "javascript:" or "data:" URL can never reach an href — that scheme
// restriction is the whole XSS story here and must stay.
//
// escapeSegment lets a caller keep its own markup pass over the non-URL
// text (the feed passes mentionHTML so @names still highlight); it must do
// its own escaping. Everything not matched as a URL goes through it, so the
// default of esc() is what keeps this safe for plain callers like chat.
function linkifyHTML(rawText, escapeSegment) {
  const escSeg = escapeSegment || esc;
  const src = String(rawText || '');
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    let url = m[0];
    // Trailing sentence punctuation isn't part of the URL, and a closing
    // paren only belongs to it if the URL opened one — otherwise
    // "(see https://x.com/a)" would swallow the paren.
    url = url.replace(/[.,!?;:'"]+$/, '');
    while (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
      url = url.slice(0, -1);
    }
    // Re-check after trimming: anything that no longer looks like a link is
    // left alone, and `last` stays put so the text still gets emitted below.
    if (!/^(?:https?:\/\/|www\.)\S/i.test(url)) continue;
    out += escSeg(src.slice(last, m.index));
    const href = /^www\./i.test(url) ? 'https://' + url : url;
    out += '<a class="rich-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>';
    last = m.index + url.length;
  }
  return out + escSeg(src.slice(last));
}

// First YouTube video id in the text, or '' if there isn't one. The id is
// held to exactly the 11 chars YouTube uses, which is also what makes it
// safe to drop straight into an iframe src.
function youtubeIdFrom(rawText) {
  const m = String(rawText || '').match(
    /(?:youtube\.com\/(?:watch\?(?:\S*?&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
  );
  return m ? m[1] : '';
}

// Keeps Tab/Shift+Tab cycling within an open modal instead of leaking
// focus out to the page behind it — none of the modals had this before.
// Call once per modal at setup time with its content container and an
// isOpenFn (reusing whatever `.classList.contains('open')` check the
// modal already has). isOpenFn is re-checked on every Tab press, so
// there's nothing to "release" on close paths (X button, Escape,
// click-outside, Cancel/Use-Photo, ...) — it just stops acting the
// moment the modal's own open-state says it's closed. Doesn't touch
// initial focus placement; several modals already .focus() a specific
// field on open and this leaves that alone.
function trapFocusWithin(container, isOpenFn) {
  if (!container) return;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !isOpenFn()) return;
    const focusables = Array.from(container.querySelectorAll(
      'input, textarea, button, [href], select, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length || !container.contains(document.activeElement)) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

// Keeps a mxc/username -> blob-URL Map from growing for the life of the
// tab — a busy chat/feed session can show hundreds of distinct images
// over many hours, and every one was permanently pinning a blob URL (and
// its decoded bitmap) in memory with nothing ever evicted. FIFO eviction
// (Maps preserve insertion order) rather than true LRU — good enough for
// "don't leak forever" without tracking access times on every read.
function capBlobCache(cache, maxSize) {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    const oldestUrl = cache.get(oldestKey);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    cache.delete(oldestKey);
  }
}

// Swaps a failed cover-art <img> for its placeholder div. Every call site
// used to inline onerror="this.outerHTML='<div class=\'foo\'>...'" — inside
// a template literal, \' just collapses to a literal ', so the onerror
// attribute's actual value ends up with unescaped single quotes breaking
// its own JS (a SyntaxError the browser swallows silently: the image just
// stays a broken-image icon forever instead of falling back). A tiny named
// global sidesteps the quoting entirely instead of re-escaping it correctly
// inline every time.
function klabArtFallback(img, placeholderClass, iconClass) {
  const ph = document.createElement('div');
  ph.className = placeholderClass;
  ph.innerHTML = `<i class="ti ${iconClass}"></i>`;
  img.replaceWith(ph);
}

// Both remaining context menus (presence cards, song rows) are
// fixed-position elements living inside the zoomed `html` subtree (see the
// `zoom` tiers on large displays in the stylesheet). `clientX`/`clientY`
// are reported in real, unzoomed viewport pixels, but a fixed-position
// descendant's `left`/`top` are lengths *inside* the zoomed context —
// assigning the raw client coords shoots the menu off to the right/bottom
// by the zoom factor (confirmed: at zoom 1.3, a menu placed at
// clientX=3407 on a 3440px-wide screen rendered ~760px off-screen).
// Dividing both the coordinates and the viewport bounds by the current
// zoom factor converts everything back into the menu's own coordinate
// space before positioning.
// Measured rather than read from the CSS: how getBoundingClientRect() and
// pointer coordinates relate to layout px under `html { zoom }` differs
// between engines (Chrome reports zoomed px; Firefox has differed), so the
// ratio of an element's on-screen width to its layout width is the one
// number that's right everywhere. Falls back to the CSS value.
function zoomFactor() {
  const b = document.body;
  if (b && b.offsetWidth) {
    const r = b.getBoundingClientRect().width / b.offsetWidth;
    if (r > 0.25 && r < 4) return r;
  }
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

// Anchors a position:fixed panel under a right-aligned element, matching its
// right edge. Exists because #headerMoreMenu and #toastFlyout had to move out
// of .header to be direct <body> children: anything nested inside .header
// never blurs its backdrop, so backdrop-filter composited against nothing and
// those panels rendered plainly see-through. They lost `top:100%`/`right:0`
// with their old parent, so the anchoring is done here instead.
//
// Divided by zoomFactor() for the same reason showSongCtx() does it: on the
// wide-viewport `html { zoom }` tiers a rect reads back in zoomed pixels,
// while a px value set on a fixed child gets scaled by that zoom again.
function anchorPanelUnder(panel, anchorEl, gap) {
  if (!panel || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  if (!r.width && !r.height) return;   // anchor hidden (mobile hides some header buttons)
  const z = zoomFactor();
  panel.style.top   = (r.bottom / z + (gap || 10)) + 'px';
  panel.style.right = Math.max(8, (window.innerWidth - r.right) / z) + 'px';
  panel.style.left  = 'auto';
}

// The toast stack is always parked under the header's icon tray. It has no
// open/close moment of its own, so it re-syncs on the things that can move
// the header: viewport resize, and the orientation/zoom changes that come
// with it.
// Notifications sit just below the header's right-hand buttons, hugging
// the screen's right edge rather than the buttons' edge: on wide screens
// the header is inset, and right-aligning to it pushed the stack toward
// the middle of the page.
function syncToastFlyout() {
  const host = document.getElementById('toastFlyout');
  const tray = document.querySelector('.header-right');
  if (!host || !tray) return;
  const r = tray.getBoundingClientRect();
  if (!r.width && !r.height) return;
  host.style.top = (r.bottom / zoomFactor() + 10) + 'px';
  host.style.right = '16px';
  host.style.left = 'auto';
}
window.addEventListener('resize', syncToastFlyout);
window.addEventListener('orientationchange', syncToastFlyout);
document.addEventListener('DOMContentLoaded', syncToastFlyout);

// ── Pre-blurred backdrops ──
// Firefox's renderer redraws a CSS `filter: blur()` every frame it
// composites, where Chrome rasterizes it once and reuses the result. A
// full-screen blur(80px) behind a page with a blinking clock was being
// recomputed ~60 times a second at 4K. So each blurred background is baked
// once instead: the element's own computed filter (blur, saturate,
// brightness) is drawn into a tiny canvas, scaled down with the image, and
// the element gets that image with its live filter switched off (.soft).
// Call it right after setting an element's backgroundImage.
window.klabSoften = (function() {
  let ok = false;
  try { ok = 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) {}
  const LONG = 96;                 // canvas px on the long side; the blur hides the rest
  const baked = new Map();         // key -> Promise<blob url | null>
  const images = new Map();        // src -> Promise<HTMLImageElement | null>

  function load(src) {
    if (!images.has(src)) images.set(src, new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    }));
    return images.get(src);
  }

  async function bake(src, filter, w, h) {
    const img = await load(src);
    if (!img || !img.naturalWidth) return null;
    const k = LONG / Math.max(w, h);   // canvas px per element px
    const cw = Math.max(8, Math.round(w * k)), ch = Math.max(8, Math.round(h * k));
    let blur = 0;
    const f = filter.replace(/blur\(([\d.]+)px\)/, (_, px) => { blur = Math.max(1, +px * k); return 'blur(' + blur.toFixed(2) + 'px)'; });
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.filter = f;
    // Cover-fit, drawn past the edges so the blur has real pixels to pull
    // in instead of fading the border to transparent.
    const m = blur * 2.5;
    const s = Math.max((cw + 2 * m) / img.naturalWidth, (ch + 2 * m) / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    try {
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      const blob = await new Promise(r => c.toBlob(r));
      return blob ? URL.createObjectURL(blob) : null;
    } catch (e) { return null; }  // tainted (no CORS): keep the live filter
  }

  function soften(el) {
    if (!el) return;
    const bg = el.style.backgroundImage || '';
    if (bg.includes('blob:')) return;              // already baked
    el.classList.remove('soft', 'soft-grad');
    // A color tint is already soft; it only needs the filter taken off
    // (the CSS dims it by opacity instead of brightness).
    if (/^radial-gradient/.test(bg)) { el.classList.add('soft-grad'); return; }
    const m = bg.match(/url\(["']?(.+?)["']?\)/);
    if (!ok || !m) return;
    // Wait a tick so a freshly built element is attached and styled.
    setTimeout(async () => {
      if (el.style.backgroundImage !== bg || !el.isConnected) return;
      const filter = getComputedStyle(el).filter;
      if (!filter || filter === 'none' || !/blur\(/.test(filter)) return;
      const r = el.getBoundingClientRect();
      const w = r.width || 1000, h = r.height || 625;
      // Sizes are bucketed so similar boxes share one bake.
      const bw = Math.max(100, Math.round(w / 100) * 100), bh = Math.max(100, Math.round(h / 100) * 100);
      const key = m[1] + '|' + filter + '|' + bw + 'x' + bh;
      if (!baked.has(key)) {
        if (baked.size > 240) baked.delete(baked.keys().next().value);
        baked.set(key, bake(m[1], filter, bw, bh));
      }
      const url = await baked.get(key);
      if (!url || el.style.backgroundImage !== bg) return;
      el.dataset.softSrc = bg;
      el.style.backgroundImage = 'url("' + url + '")';
      el.classList.add('soft');
    }, 0);
  }

  // Light and dark use different filters, so a theme flip re-bakes.
  new MutationObserver(() => {
    document.querySelectorAll('.soft[data-soft-src]').forEach(el => {
      el.style.backgroundImage = el.dataset.softSrc;
      soften(el);
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return soften;
})();
