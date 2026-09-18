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
function zoomFactor(){ return parseFloat(getComputedStyle(document.documentElement).zoom) || 1; }
