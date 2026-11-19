// ══════════════════════════════════════════
//  SHARED UTILITIES
//  Loaded before everything else. These are plain function declarations
//  used from several of the files that follow — they lived in the player
//  file only because that's where they happened to be written when this
//  was one script and hoisting made position irrelevant. It isn't any
//  more: each file is its own script now, so a helper has to be declared
//  in an earlier file than the code that calls it at load time.
// ══════════════════════════════════════════

// This page, among everywhere its person has klabnet open: a new id each
// time it loads. Presence beats and the shared player (js/23-session.js)
// both carry it.
const KLAB_DEVICE = (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')).replace(/[^A-Za-z0-9_-]/g, '');

// Fetch with a hard timeout. On LAN a hung request is basically impossible,
// but off-site a slow/dropped connection can leave a boot-critical or
// polling fetch pending forever with no visible failure — abort it instead
// so identity/prefs/presence checks fail fast and the app keeps moving.
// The phone layout is for phones: a narrow window on a computer (a mouse
// or trackpad) keeps the desktop one. css/app.css uses the same queries.
const KLAB_PHONE_MQ = '(max-width: 760px) and (pointer: coarse)';
const KLAB_DESK_MQ  = '(min-width: 761px), (pointer: fine)';

function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 10000);
  // Keep the caller's cancellation as well as the timeout. Replacing its
  // signal made closing a viewer leave the original download running.
  // AbortSignal.any is Safari 17.4+: older ones forward the abort by hand.
  let signal = ctrl.signal;
  if (opts?.signal) {
    if (AbortSignal.any) signal = AbortSignal.any([ctrl.signal, opts.signal]);
    else if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return fetch(url, { ...(opts || {}), signal }).finally(() => clearTimeout(t));
}

// Shared by Feed and Home so the same post has the same age on both.
// Takes milliseconds; API timestamp parsing stays with the caller.
function klabRelativeTime(time) {
  if (!Number.isFinite(time) || time <= 0) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd';
  return new Date(time).toLocaleDateString();
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
// `zoom` tiers for short windows in the stylesheet). `clientX`/`clientY`
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
  try { ok = !!document.createElement('canvas').getContext('2d'); } catch (e) {}
  const LONG = 96;                 // canvas px on the long side; the blur hides the rest
  const baked = new Map();         // key -> Promise<blob url | null>
  const images = new Map();        // src -> Promise<HTMLImageElement | null>
  const ours = new Set();          // blob urls this made (feed images are blob urls too)

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

  // The filter is applied by hand, not with the canvas's own ctx.filter:
  // browsers disagree on that (and it's what looked wrong in Firefox), and
  // at this size plain pixel math is instant and identical everywhere.
  function parseFilter(filter) {
    const ops = [];
    const re = /(blur|saturate|brightness|contrast)\(([\d.]+)(px|%)?\)/g;
    let m, rest = filter;
    while ((m = re.exec(filter))) { ops.push([m[1], +m[2] / (m[3] === '%' ? 100 : 1)]); rest = rest.replace(m[0], ''); }
    return rest.trim() ? null : ops;               // anything else: leave it live
  }
  // Three box blurs in a row approximate a Gaussian; edges clamp.
  function boxBlur(px, w, h, r) {
    if (r < 1) return;
    const tmp = new Float32Array(px.length);
    const pass = (src, dst, horiz) => {
      const len = horiz ? w : h, lines = horiz ? h : w, win = 2 * r + 1;
      for (let l = 0; l < lines; l++) for (let c = 0; c < 4; c++) {
        const at = i => ((horiz ? l * w + Math.min(len - 1, Math.max(0, i)) : Math.min(len - 1, Math.max(0, i)) * w + l) * 4 + c);
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += src[at(i)];
        for (let i = 0; i < len; i++) { dst[at(i)] = sum / win; sum += src[at(i + r + 1)] - src[at(i - r)]; }
      }
    };
    for (let k = 0; k < 3; k++) { pass(px, tmp, true); pass(tmp, px, false); }
  }

  async function bake(src, filter, w, h) {
    const ops = parseFilter(filter);
    if (!ops) return null;
    const img = await load(src);
    // Only needed while baking: kept, one per song and backdrop, for as
    // long as the tab stays open.
    images.delete(src);
    if (!img || !img.naturalWidth) return null;
    const k = LONG / Math.max(w, h);   // canvas px per element px
    const cw = Math.max(8, Math.round(w * k)), ch = Math.max(8, Math.round(h * k));
    const sigma = (ops.find(o => o[0] === 'blur')?.[1] || 0) * k;
    // Three box passes of radius r give a Gaussian of sigma ~ r.
    const r = Math.max(1, Math.round(sigma));
    // Cover-fit, drawn past the edges so the blur has real pixels to pull in.
    const m = Math.ceil(r * 3);
    const W = cw + 2 * m, H = ch + 2 * m;
    const work = document.createElement('canvas');
    work.width = W; work.height = H;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    try {
      wctx.imageSmoothingQuality = 'high';
      wctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const data = wctx.getImageData(0, 0, W, H);
      const px = new Float32Array(data.data);
      boxBlur(px, W, H, r);
      // The rest of the filter, in the order CSS applies it.
      for (const [fn, v] of ops) {
        if (fn === 'blur') continue;
        for (let i = 0; i < px.length; i += 4) {
          let R = px[i], G = px[i + 1], B = px[i + 2];
          if (fn === 'brightness') { R *= v; G *= v; B *= v; }
          else if (fn === 'contrast') { R = (R - 128) * v + 128; G = (G - 128) * v + 128; B = (B - 128) * v + 128; }
          else if (fn === 'saturate') {   // the CSS Filter Effects matrix
            const r2 = (0.213 + 0.787 * v) * R + (0.715 - 0.715 * v) * G + (0.072 - 0.072 * v) * B;
            const g2 = (0.213 - 0.213 * v) * R + (0.715 + 0.285 * v) * G + (0.072 - 0.072 * v) * B;
            const b2 = (0.213 - 0.213 * v) * R + (0.715 - 0.715 * v) * G + (0.072 + 0.928 * v) * B;
            R = r2; G = g2; B = b2;
          }
          px[i] = R; px[i + 1] = G; px[i + 2] = B;
        }
      }
      for (let i = 0; i < px.length; i++) data.data[i] = px[i];   // clamps to 0..255
      wctx.putImageData(data, 0, 0);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(work, m, m, cw, ch, 0, 0, cw, ch);
      const blob = await new Promise(res => c.toBlob(res));
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      ours.add(url);
      return url;
    } catch (e) { return null; }  // tainted (no CORS): keep the live filter
  }

  // A backdrop is baked down to LONG px, so a cover art source bigger than
  // a few hundred px is only memory: a 3200px one is ~40MB once decoded.
  function smaller(u) {
    if (!/\/rest\/getCoverArt\?/.test(u)) return u;
    return /[?&]size=\d+/.test(u) ? u.replace(/([?&])size=\d+/, '$1size=300') : u + '&size=300';
  }

  function soften(el) {
    if (!el) return;
    const u0 = (el.style.backgroundImage || '').match(/url\(["']?(.+?)["']?\)/)?.[1];
    // Swapped before the big one is ever fetched (styles apply later).
    if (u0 && smaller(u0) !== u0) el.style.backgroundImage = `url("${smaller(u0)}")`;
    const bg = el.style.backgroundImage || '';
    el.classList.remove('soft', 'soft-grad');
    const m0 = bg.match(/url\(["']?(.+?)["']?\)/);
    if (m0 && ours.has(m0[1])) { el.classList.add('soft'); return; }   // already baked
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
        if (baked.size > 240) {
          const oldKey = baked.keys().next().value, old = baked.get(oldKey);
          baked.delete(oldKey);
          // Freed, unless something on screen is still showing it.
          old.then(u => {
            if (!u || [...document.querySelectorAll('.soft')].some(e => e.style.backgroundImage.includes(u))) return;
            URL.revokeObjectURL(u); ours.delete(u);
          });
        }
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

// ── The layer stack ──
// Everything that opens over the page says so here, so "what's on top"
// has one answer and Escape / mouse Back close only that:
//   klabLayers.push(el, { kind, close, dim }) → pop()   when it opens (call pop() when it closes)
//   klabLayers.watch(el, { kind, close, dim, open })   or let it follow el by itself: it's open
//       while open(el) says so (default: .open or .visible, and not [hidden])
//   klabLayers.top(kinds?)     the top layer { el, kind, close, dim }, or null
//   klabLayers.any(kinds?)     is anything open (kinds: a kind or a list of them)
//   klabLayers.modal()         a menu, popover, dialog, sheet or viewer is open (keys stand aside)
//   klabLayers.covered()       the full player or the slideshow fills the window
//   klabLayers.closeTop()      closes the top one (not the album page); true if there was one
//   klabLayers.isTop(el)
// Kinds: 'menu', 'popover' (the pickers, the recap), 'dialog', 'sheet'
// (Settings, a profile), 'viewer' (the picture viewer, the cropper),
// 'player' (the full player), 'slideshow', 'terminal', and 'page' (the
// album page: a view with a Back, which kinds left unsaid leave out).
// One capture listener, ahead of every other, gives Escape to the top
// layer only (a dialog over the full player used to close both). A
// dimming layer over another leaves its own scrim clear (.k-scrim-off):
// one dim, however many are stacked. Opening anything over a menu closes
// the menu. Fires 'klab:layers' on document when the stack changes.
const klabLayers = (() => {
  const stack = [];
  const MODAL = ['menu', 'popover', 'dialog', 'sheet', 'viewer'];
  const match = kinds => kinds == null ? (l => l.kind !== 'page')
    : typeof kinds === 'string' ? (l => l.kind === kinds) : (l => kinds.includes(l.kind));
  function prune() {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].el && !stack[i].el.isConnected) stack.splice(i, 1);
  }
  function restack() {
    let dimmed = false;
    for (const l of stack) {
      if (!l.dim) continue;
      l.el?.classList.toggle('k-scrim-off', dimmed);
      dimmed = true;
    }
  }
  function changed() {
    restack();
    document.dispatchEvent(new CustomEvent('klab:layers'));
  }
  function remove(entry) {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    entry.el?.classList.remove('k-scrim-off');
    changed();
  }
  function push(el, opts = {}) {
    const old = el && stack.find(l => l.el === el);
    if (old) remove(old); // opened again: back on top
    const entry = { el, kind: opts.kind || 'dialog', close: opts.close, dim: !!opts.dim, onEscape: opts.onEscape };
    // Something opening over a menu means the menu's moment has passed.
    if (entry.kind !== 'menu') stack.filter(l => l.kind === 'menu').forEach(l => l.close?.());
    stack.push(entry);
    changed();
    return () => remove(entry);
  }
  function watch(el, opts = {}) {
    if (!el || el._klabLayerSync) return;
    const isOpen = opts.open || (x => !x.hidden && (x.classList.contains('open') || x.classList.contains('visible')));
    let pop = null;
    const sync = () => {
      const o = el.isConnected && isOpen(el);
      if (o && !pop) pop = push(el, opts);
      else if (!o && pop) { pop(); pop = null; }
    };
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class', 'hidden'] });
    el._klabLayerSync = sync;
    sync();
  }
  function top(kinds) {
    // A watched layer that has just closed is dropped now, not when its
    // MutationObserver gets round to it (two closeTop()s in a row each
    // close one layer).
    for (const l of stack.slice()) l.el?._klabLayerSync?.();
    prune();
    const ok = match(kinds);
    for (let i = stack.length - 1; i >= 0; i--) if (ok(stack[i])) return stack[i];
    return null;
  }
  const any = kinds => !!top(kinds);
  function closeTop() {
    const t = top();
    if (!t || !t.close) return false;
    t.close('back');
    return true;
  }
  // An autocomplete open in a field (@mentions, :emoji:) takes Escape first.
  const suggesting = () => [...document.querySelectorAll('.mention-suggest:not([hidden]), .emo-suggest:not([hidden])')]
    .some(el => el.checkVisibility ? el.checkVisibility() : el.offsetParent);
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    const t = top();
    if (!t || !t.close || suggesting()) return;
    if (t.onEscape && t.onEscape(e) === false) return; // it handled the key itself
    e.preventDefault(); e.stopImmediatePropagation();
    t.close('escape');
  }, true);
  return {
    push, watch, top, any, closeTop,
    modal: () => any(MODAL),
    covered: () => any(['player', 'slideshow']),
    isTop: el => top()?.el === el,
    list: () => (top(), stack.map(l => ({ kind: l.kind, el: l.el }))),
  };
})();
window.klabLayers = klabLayers;

// ── Menus ──
// One menu element, built fresh from a list each time it opens:
//   { label, icon, action }          an item. Also: danger (red; `warn` is the old name),
//                                    disabled, hint ('12', dim on the right), hidden,
//                                    checked: true/false (a radio item with a check column)
//   '-'                              a divider (doubled or stray ones drop out)
//   { header: 'Song title' }         what the menu is about: sentence case, dim, one line
//   { section: 'Sort by' }           a section label (Music's tracked caps)
//   { reacts: ['👍', …], action: emoji => … } a row of emoji to react with
// klabMenu(e, items) opens it at the pointer from a contextmenu event. It
// leaves the browser's own menu alone for text fields, selected text, and
// Shift+right-click, so copy, paste and spellcheck still work.
// klabMenu.at(anchorEl, items, { align: 'start'|'end', gap, focus }) opens
// it under the element (over it when there's no room below), lined up
// with its left edge (or its right, for one on the right half). Pressing
// the same element again closes it.
// klabMenu.close() closes it. It closes by itself on a press outside, a
// scroll, a resize, the window losing focus, changing page, and anything
// opening over it (the full player, the album page, a dialog).
const klabMenu = (() => {
  let menu = null, anchorEl = null, popLayer = null, hideTimer = 0;
  const isOpen = () => !!menu && menu.classList.contains('visible');
  function close() {
    if (!isOpen()) return;
    menu.classList.remove('visible');
    anchorEl?.setAttribute?.('aria-expanded', 'false');
    anchorEl = null;
    const p = popLayer; popLayer = null; p?.();
  }

  function setup() {
    menu = document.createElement('div');
    menu.className = 'ctx-menu klab-menu';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    document.addEventListener('pointerdown', e => {
      if (isOpen() && !menu.contains(e.target) && !(anchorEl && anchorEl.contains(e.target))) close();
    }, true);
    // Capture, so another right-click closes this one before whatever
    // handler it hits opens the next menu.
    document.addEventListener('contextmenu', e => { if (!menu.contains(e.target)) close(); }, true);
    addEventListener('scroll', e => { if (e.target !== menu) close(); }, true);
    addEventListener('resize', close);
    addEventListener('blur', close);
    addEventListener('hashchange', close);
    addEventListener('popstate', close);
    document.addEventListener('keydown', e => {
      if (!isOpen()) return;
      const rows = [...menu.querySelectorAll('.ctx-item:not(.disabled), .ctx-reacts button')];
      const i = rows.indexOf(document.activeElement);
      // (Escape is the layer stack's.)
      if (e.key === 'ArrowDown') rows[(i + 1) % rows.length]?.focus();
      else if (e.key === 'ArrowUp') rows[i <= 0 ? rows.length - 1 : i - 1]?.focus();
      else if (e.key === 'Home') rows[0]?.focus();
      else if (e.key === 'End') rows[rows.length - 1]?.focus();
      else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) rows[i].click();
      else { if (e.key === 'Tab') close(); return; }
      // The menu has the keyboard while it's open: arrows shouldn't also
      // move the photo or the sidebar underneath it.
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
  }

  function native(e) {
    if (e.shiftKey) return true;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
    const sel = getSelection();
    return !!sel && !sel.isCollapsed && !!String(sel).trim() && sel.containsNode(e.target, true);
  }

  function tidy(items) {
    const out = [];
    for (const it of items) {
      if (!it || it.hidden) continue;
      const last = out[out.length - 1];
      if (it === '-' && (!last || last === '-' || last.header || last.section)) continue;
      out.push(it);
    }
    while (out[out.length - 1] === '-') out.pop();
    return out;
  }

  function run(fn, arg) {
    close();
    try { const r = fn?.(arg); if (r?.catch) r.catch(err => console.error('[menu]', err)); }
    catch (err) { console.error('[menu]', err); }
  }

  function build(list) {
    menu.replaceChildren(...list.map(it => {
      if (it === '-') return Object.assign(document.createElement('div'), { className: 'ctx-divider', role: 'separator' });
      if (it.header) return Object.assign(document.createElement('div'), { className: 'ctx-title', textContent: it.header, title: it.header });
      if (it.section) return Object.assign(document.createElement('div'), { className: 'ctx-label k-label', textContent: it.section });
      if (it.reacts) {
        const row = document.createElement('div');
        row.className = 'ctx-reacts';
        it.reacts.forEach(emoji => {
          const b = Object.assign(document.createElement('button'), { type: 'button', innerHTML: klabReactHTML(emoji), tabIndex: -1, title: emoji });
          b.addEventListener('click', () => run(it.action, emoji));
          row.appendChild(b);
        });
        return row;
      }
      const radio = typeof it.checked === 'boolean';
      const row = document.createElement('div');
      row.className = 'ctx-item' + (it.danger || it.warn ? ' danger' : '') + (it.disabled ? ' disabled' : '') + (radio ? ' radio' : '');
      row.tabIndex = -1;
      row.setAttribute('role', radio ? 'menuitemradio' : 'menuitem');
      if (radio) row.setAttribute('aria-checked', String(it.checked));
      if (it.disabled) row.setAttribute('aria-disabled', 'true');
      const icon = radio ? (it.checked ? 'ti-check' : '') : (it.icon || 'ti-point');
      row.innerHTML = '<i class="ti ' + icon + '"></i>';
      const text = document.createElement('span');
      text.className = 'ctx-text';
      text.textContent = it.label;
      row.append(text);
      if (it.hint != null && it.hint !== '') row.append(Object.assign(document.createElement('small'), { className: 'ctx-hint', textContent: String(it.hint) }));
      if (!it.disabled) row.addEventListener('click', () => run(it.action));
      if (it.ref) it.ref(row, text); // for a label that changes after it opens (a star's count)
      return row;
    }));
  }

  // Shown fresh (a right-click while one is open, or closing, starts a new
  // one rather than the old one sliding to the new spot), measurable only
  // once it's shown.
  function show(list) {
    if (!menu) setup();
    document.querySelectorAll('.ctx-menu.visible').forEach(m => { if (m !== menu) m.classList.remove('visible'); });
    close();
    build(list);
    menu.style.transition = 'none';
    menu.classList.remove('visible');
    void menu.offsetWidth;
    menu.style.transition = '';
    menu.style.left = menu.style.top = '0px';
    menu.style.right = 'auto';
    menu.classList.add('visible');
    popLayer = klabLayers.push(menu, { kind: 'menu', close });
    return { w: menu.offsetWidth, h: menu.offsetHeight, z: zoomFactor() };
  }

  function open(e, items) {
    if (e.defaultPrevented || native(e)) return false;
    // A link inside whatever was clicked gets the usual link actions too.
    const a = e.target.closest?.('a[href]');
    if (a && /^https?:/.test(a.href)) {
      const at = items.findIndex(it => !it?.header && !it?.section);
      items = [...items];
      items.splice(at < 0 ? items.length : at, 0,
        { label: 'Open link', icon: 'ti-external-link', action: () => window.open(a.href, '_blank', 'noopener') },
        { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(a.href, 'Link') },
        '-');
    }
    const list = tidy(items);
    if (!list.some(it => it.action)) return false;
    e.preventDefault();

    // The menu key and Shift+F10 fire with no pointer position.
    let x = e.clientX, y = e.clientY;
    if (!x && !y && e.target.getBoundingClientRect) {
      const r = e.target.getBoundingClientRect();
      x = r.left + 16; y = r.top + Math.min(r.height, 28);
    }
    const { w, h, z } = show(list);
    const vw = innerWidth / z, vh = innerHeight / z;
    let left = x / z, top = y / z;
    // Like a native menu: flip to the other side of the pointer rather
    // than slide under it.
    if (left + w > vw - 8) left = Math.max(8, left - w);
    if (top + h > vh - 8) top = Math.max(8, top - h >= 8 ? top - h : vh - h - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.transformOrigin = (left < x / z ? 'right' : 'left') + ' ' + (top < y / z ? 'bottom' : 'top');
    if (!e.clientX && !e.clientY) menu.querySelector('.ctx-item:not(.disabled)')?.focus();
    return true;
  }

  function at(anchor, items, opts = {}) {
    if (!anchor) return false;
    if (isOpen() && anchorEl === anchor) { close(); return false; }
    const list = tidy(items);
    if (!list.some(it => it.action)) return false;
    const { w, h, z } = show(list);
    anchorEl = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect(), gap = opts.gap ?? 6;
    const vw = innerWidth / z, vh = innerHeight / z;
    const L = r.left / z, R = r.right / z, T = r.top / z, B = r.bottom / z;
    const end = opts.align ? opts.align === 'end' : (L + R) / 2 > vw / 2;
    let left = end ? R - w : L;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = B + gap + h <= vh - 8 || T - gap - h < 8;
    const top = below ? Math.min(B + gap, vh - h - 8) : T - gap - h;
    menu.style.left = left + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    menu.style.transformOrigin = (end ? 'right' : 'left') + ' ' + (below ? 'top' : 'bottom');
    if (opts.focus ?? (opts.event && opts.event.detail === 0)) menu.querySelector('.ctx-item:not(.disabled)')?.focus();
    return true;
  }

  return Object.assign(open, { close, at, isOpen });
})();

// More reactions than a toolbar has room for: Feed's and Chat's "add
// reaction" open the emoji picker (js/34-emoji.js); the right-click
// menu's own row of emoji stands in until that's loaded.
const KLAB_REACTS = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '💀', '👀', '🙏', '💯', '🫡'];
// The four on a message's or a post's hover toolbar (Chat and Feed).
const KLAB_QUICK_REACTS = ['👍', '❤️', '😂', '🔥'];
// Faces read as text faces wherever a reaction is shown (owner, 2026-11-02:
// "laughing turns to XD"). Only how it's drawn: the reaction itself stays
// the emoji, so Matrix's other clients and old posts mean the same thing.
// Things that aren't faces (🔥, 👍, 💀…) stay emoji.
const KLAB_TEXTMOJI = {
  '😂': 'XD', '🤣': 'XDD', '😆': 'xD', '😀': ':D', '😃': ':D', '😁': '=D', '😄': '^_^',
  '🙂': ':)', '😊': '^^', '😉': ';)', '😅': "^^'", '🥲': ":')", '😇': 'O:)', '😈': '>:)',
  '😛': ':P', '😜': ';P', '😝': 'xP', '😋': ':9', '😘': ':*', '😍': '♥_♥', '😎': 'B)',
  '😮': ':O', '😯': ':o', '😲': 'O_O', '😳': 'O.O', '😱': 'D:', '😦': 'D:', '😧': 'D:', '😩': 'D:', '😫': 'D:',
  '😢': ":'(", '😭': 'T_T', '🙁': ':(', '☹': ':(', '😞': ':(', '😔': ':(', '😕': ':/', '🫤': ':/',
  '😐': ':|', '😑': '-_-', '😒': '¬_¬', '🙄': '¬_¬', '😏': '¬‿¬', '🤨': 'o_O',
  '😠': '>:(', '😡': '>:(', '😖': '>_<', '😣': '>_<', '😬': ':S', '😵': 'x_x', '😴': '-_-zz',
  '🤐': ':X', '🥺': '(._.)', '🫡': 'o7', '🤷': '¯\\_(ツ)_/¯', '❤': '<3',
};
function klabTextmoji(key) {
  return KLAB_TEXTMOJI[String(key || '').replace(/[\uFE0F\u{1F3FB}-\u{1F3FF}\u200D\u2640\u2642]/gu, '')];
}
// A reaction's key as markup: a text face, a custom :emoji:, or the emoji.
function klabReactHTML(key) {
  const t = klabTextmoji(key);
  if (t) return '<span class="tmoji">' + esc(t) + '</span>';
  return (window.klabEmojiKey || esc)(key);
}
function klabReactMenu(anchor, onPick) {
  // The emoji picker (js/34-emoji.js), with klab's own emoji in it.
  if (window.klabEmojiPicker) return window.klabEmojiPicker(anchor, onPick);
  const r = anchor.getBoundingClientRect();
  klabMenu({
    target: anchor, clientX: r.left, clientY: r.bottom + 4, shiftKey: false,
    defaultPrevented: false, preventDefault() {},
  }, [{ reacts: KLAB_REACTS, action: onPick }]);
}

async function klabCopy(text, what) {
  try {
    await navigator.clipboard.writeText(String(text));
    showToast((what || 'Text') + ' copied', 'ti-copy');
  } catch { showToast("Couldn't copy that", 'ti-copy-off'); }
}

// The clipboard only takes PNGs, so anything else goes through a canvas.
async function klabCopyImage(src) {
  try {
    const png = (async () => {
      const blob = await (await fetch(src)).blob();
      if (blob.type === 'image/png') return blob;
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      try { c.getContext('2d').drawImage(bmp, 0, 0); }
      finally { bmp.close(); }
      return await new Promise(r => c.toBlob(r, 'image/png'));
    })();
    // Passing the promise keeps Safari's user-gesture window open.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    showToast('Image copied', 'ti-photo');
  } catch { showToast("Couldn't copy that image", 'ti-photo-off'); }
}

// Songs other people hand us (feed posts, chat, photos, listening
// parties) are only as trustworthy as the library ids in them look like
// library ids: those end up in URLs and markup all over the player. Returns
// a cleaned copy, or null when it doesn't name a real track.
const _ND_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function klabCleanSong(s) {
  if (!s || typeof s !== 'object' || !_ND_ID_RE.test(String(s.id ?? ''))) return null;
  const out = { ...s, id: String(s.id) };
  for (const k of ['coverArt', 'albumId', 'artistId']) if (out[k] != null && !_ND_ID_RE.test(String(out[k]))) delete out[k];
  for (const k of ['title', 'artist', 'album']) if (out[k] != null) out[k] = String(out[k]).slice(0, 300);
  return out;
}
// A song from a point in it (a shared moment: "from 1:32"). The seek waits
// for the new file's length; on a remote it's sent once the active device
// has had a moment to load it.
function klabPlayFrom(song, at) {
  const started = playSong(song);
  if (!(at > 0)) return started;
  const a = playerState.audio;
  const go = () => { if (playerState.currentSong?.id === song.id) try { a.currentTime = at; } catch (e) {} };
  if (window.klabSession?.mirror) setTimeout(go, 1500);
  else a.addEventListener('loadedmetadata', go, { once: true });
  return started;
}
// Where the playing song is, worth sharing as a moment: not the first or
// last few seconds (that's just the song).
function klabMomentNow() {
  const a = playerState.audio, t = a.currentTime || 0, d = a.duration || 0;
  return t >= 5 && (!d || t < d - 5) ? Math.round(t * 10) / 10 : 0;
}
// A message from the API ("too large") as a sentence ("Too large").
function klabCap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
// "1 track", "12 tracks".
function klabCount(n, word, plural) {
  return `${Number(n || 0).toLocaleString()} ${n === 1 ? word : (plural || word + 's')}`;
}
// The song on a post or a photo, as one the player takes: the API stores
// its id as `songId`.
function klabPostSong(s) {
  return s && typeof s === 'object' ? klabCleanSong({ ...s, id: s.id ?? s.songId }) : null;
}

// Stars (js/21-stars.js): anything can be starred, and five people starring
// it turns it gold. Chat, feed posts and photos store a star as this
// reaction; songs and albums keep theirs in the API's stars table.
// Cover art for a box this wide (CSS px): enough pixels for the screen's
// density (and the app's zoom, which is in it), in the few sizes asked
// for, so Navidrome's resize cache keeps working. A fixed 300 was soft
// on a high-DPI screen once a tile was past 150px.
function klabArtSize(cssPx) {
  const need = cssPx * (window.devicePixelRatio || 1);
  return need <= 300 ? 300 : need <= 600 ? 600 : 1000;
}

const KLAB_STAR = '⭐';
const KLAB_GOLD_AT = 5;
// Off since 2026-10-24 (the owner's call; maybe back later): no star
// buttons, no gold, and ⭐ is an ordinary reaction again. What's stored
// (the stars table, ⭐ reactions) and the API are left as they are, so
// turning this back on brings it all back.
const KLAB_STARS = false;
if (!KLAB_STARS) document.documentElement?.classList?.add('no-stars');

// Where the last press started. A dialog closes on a click outside it only
// if the press started outside it too: drag-selecting text in a field and
// letting go past the card's edge clicks the backdrop (the common ancestor
// of the two), and closed the dialog with whatever was typed.
let _pressedOn = null;
document.addEventListener('pointerdown', e => { _pressedOn = e.target; }, true);
window.klabPressedOn = el => _pressedOn === el;

// ── Undo, instead of "Are you sure?" ──
// klabUndo(label, { apply, undo, commit, ms = 5000, icon, failed })
// does apply() now (hide the row, take it out of the list), shows
// "<label> · Undo" for ms, and then runs commit() (the DELETE). Undo puts
// it back with undo(), and commit never runs. Leaving the page (pagehide,
// or the tab going hidden) runs every pending commit at once, so give
// commit a request that survives that: fetch(url, { method: 'DELETE',
// keepalive: true }). If commit throws or its promise rejects, undo()
// runs and a toast says `failed` ("Couldn't do that"). Returns
// { undo(), flush() }. For what the server can take back within seconds
// (your own post or reply, a song off a playlist or the queue, a
// favourite); Matrix redactions and deleting a playlist, station, video
// or channel keep their confirm.
//   klabUndo('Post deleted', {
//     apply: () => { row.hidden = true; },
//     undo: () => { row.hidden = false; },
//     commit: async () => { const r = await fetch(url, { method: 'DELETE', keepalive: true }); if (!r.ok) throw r; },
//   });
const _klabUndoPending = new Set();
function klabUndo(label, { apply, undo, commit, ms = 5000, icon = 'ti-trash', failed } = {}) {
  let done = false, toast = null;
  const job = {
    flush() {
      if (done) return; done = true;
      _klabUndoPending.delete(job);
      if (toast) dismissToast(toast);
      const fail = err => {
        console.error('[undo]', err);
        try { undo?.(); } catch (e) { console.error('[undo]', e); }
        showToast(failed || 'Couldn’t do that', 'ti-alert-triangle');
      };
      try { const r = commit?.(); if (r?.catch) r.catch(fail); } catch (err) { fail(err); }
    },
    undo() {
      if (done) return; done = true;
      _klabUndoPending.delete(job);
      if (toast) dismissToast(toast);
      try { undo?.(); } catch (err) { console.error('[undo]', err); }
    },
  };
  try { apply?.(); } catch (err) { console.error('[undo]', err); return job; }
  _klabUndoPending.add(job);
  // Committed when its toast goes (its time up, or pushed out by newer
  // ones), so a pointer resting on the toast holds it, Undo and all.
  toast = showToast(label, icon, ms, null, null, { action: { label: 'Undo', run: () => job.undo() }, onGone: () => job.flush() });
  if (!toast) setTimeout(() => job.flush(), ms);
  return job;
}
addEventListener('pagehide', () => [..._klabUndoPending].forEach(j => j.flush()));
document.addEventListener('visibilitychange', () => { if (document.hidden) [..._klabUndoPending].forEach(j => j.flush()); });

// ── A view arriving ──
// klabEnter(el) eases a view in once (opacity, and up from 6px, 200ms:
// .k-enter in css/app.css), when motion is on. For a view swap (a Music
// list, the album page's body, a Videos or Photos view), never on a poll
// or a re-render of what's already there.
function klabEnter(el) {
  if (!el || !(window.klabMotionOk?.() ?? true)) return el;
  el.classList.remove('k-enter');
  void el.offsetWidth;
  el.classList.add('k-enter');
  el.addEventListener('animationend', function done(e) {
    if (e.target !== el) return;
    el.classList.remove('k-enter'); el.removeEventListener('animationend', done);
  });
  return el;
}
