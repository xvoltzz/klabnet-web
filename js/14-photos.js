// ══════════════════════════════════════════
//  PHOTOS — the page becomes a photo viewer with a Touch Bar-style filmstrip.
//  Everyone's photo posts on one timeline, ordered by when they were shot
//  (falling back to when they were posted), oldest on the left and newest
//  on the right, opening on the newest. Dragging the strip (or a sideways
//  trackpad swipe anywhere on the tab) scrubs; the big view follows live,
//  and a post's song clip only starts once you stop on it.
//
//  While the tab is showing, the page background becomes a blur of the
//  current photo (#phBackdrop), the dock tucks away (CSS) and whatever
//  music was playing pauses, resuming when you leave.
//
//  Backend: klabnet-api /api/posts/photos (a photo post is a feed post with
//  kind='photo', so reactions and replies use the feed's endpoints as-is).
//  Files are served from /api/posts/photos/files/<id>/<thumb|display|original>.
// ══════════════════════════════════════════
(function() {
  const API = '/api/posts/photos';
  const LIKE = '❤️';           // the one reaction on this tab (the feed's reactions API, this emoji)
  const PAGE = 40;
  const POLL_MS = 45000;
  const SONG_DWELL_MS = 550;   // how long you have to stay on a post before its song starts
  const CLIP_LEN_S = 90;       // clips loop over this window from the chosen start
  const SOUND_KEY = 'klabnet_photos_sound';

  // ?v= matches the API's DERIV_VERSION: files are served as immutable, so a
  // new version of the smaller copies needs a new URL to reach browsers
  // that cached the old ones. The original never changes.
  const COPY_VERSION = 2;
  const fileUrl = (id, size) => `${API}/files/${id}/${size}` + (size === 'original' ? '' : `?v=${COPY_VERSION}`);
  const $ = id => document.getElementById(id);

  const panel   = document.querySelector('.tab-panel[data-tab-panel="photos"]');
  if (!panel) return;
  const shell   = $('phShell');
  const stage   = $('phStage');
  const frame   = $('phFrame');
  const mainImg = $('phImg');
  const wrap    = $('phStripWrap');
  const strip   = $('phStrip');

  let posts = [];          // timeline order, newest first, as the API returns them
  let items = [];          // flat photo list, oldest first — strip order
  let thumbEls = [];       // items[i]'s thumbnail element
  let centers = [];        // x centre of each thumb in strip coordinates
  let pos = 0, target = 0; // strip x currently under the playhead / where it's gliding to
  let sel = -1;
  let hasOlder = true, loadingOlder = false, loadedOnce = false;
  // Where the next older page starts: the oldest post a server page has
  // returned. Not simply the last of `posts`, which can be a post you just
  // dated into the past, far beyond what's loaded; paging from there would
  // skip everything in between.
  let cursor = null;
  // Bumped when the order changes, so a page asked for under the old order
  // is dropped when it lands.
  let gen = 0;
  // 'shot' is the timeline (when photos were taken, the default); 'posted'
  // is "What's New" (by upload). Not remembered: the tab always opens on
  // the timeline.
  let order = 'shot';
  // How many photos there are in all, from the API's first page (null
  // from an API that doesn't say: then it's what's loaded, and a "+").
  let total = null;

  const isActive = () => panel.classList.contains('active');
  const me = () => (window.KLAB_USER?.username || '').toLowerCase();
  // Timeline order: sort_at ("YYYY-MM-DD HH:MM:SS") then id, both descending.
  const before = (a, b) => a.sort_at < b.sort_at || (a.sort_at === b.sort_at && a.id < b.id);

  // shot_at is local wall time with no zone, so it's parsed as local.
  const shotDate = shotAt => new Date(shotAt.slice(0, 10) + 'T12:00:00');
  const fmtShot = shotAt => shotDate(shotAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  // ── Data ──
  function rebuildItems() {
    items = [];
    for (let pi = posts.length - 1; pi >= 0; pi--) {
      const post = posts[pi];
      post.photos.forEach((ph, k) => items.push({ post, k, ph }));
    }
    renderViewHead();
  }
  // The big title over the photo, the way Music titles its views.
  function renderViewHead() {
    $('phViewTitle').textContent = order === 'posted' ? "What's new" : 'Timeline';
    const n = total ?? items.length;
    $('phViewSub').textContent = n ? `${n.toLocaleString()}${total == null && hasOlder ? '+' : ''} photo${n === 1 ? '' : 's'}` : '';
  }
  // The first photo of the newest post: where the tab opens, and what G/End
  // go back to. (The newest post's later photos sit to its right.)
  const newestPostStart = () => items.findIndex(it => it.post === posts[0]);
  const selectedPhotoId = () => (sel >= 0 && items[sel]) ? items[sel].ph.id : null;
  const structureKey = list => list.map(p => p.id + ':' + p.photos.map(ph => ph.id).join(',')).join('|');

  let lastFetch = 0;
  async function fetchLatest() {
    if (document.hidden) return;
    lastFetch = Date.now();
    const asked = order, g = gen;
    try {
      const r = await fetchTimeout(`${API}?limit=${PAGE}&order=${asked}`, {}, 10000);
      if (!r.ok) throw new Error('status ' + r.status);
      const data = await r.json();
      const fresh = data.posts || [];
      if (typeof data.total === 'number' && g === gen) total = data.total;
      // Switched between Timeline and What's New while this was in flight.
      if (g !== gen) return;
      // Merge: the newest page replaces whatever overlaps it; older pages
      // already loaded by scrubbing left stay put.
      const last = fresh[fresh.length - 1];
      const merged = fresh.concat(last ? posts.filter(p => before(p, last)) : []);
      if (!loadedOnce) hasOlder = fresh.length === PAGE;
      if (last && (!cursor || before(last, cursor))) cursor = { sort_at: last.sort_at, id: last.id };
      loadedOnce = true;
      applyPosts(merged, { keepSelection: true });
      renderViewHead();
      // One try: a photo that isn't in the newest page shouldn't grab the
      // selection minutes later when older pages happen to load.
      if (pendingFocus) { focusPhoto(pendingFocus.postId, pendingFocus.photoId); pendingFocus = null; }
    } catch (e) {
      // A request from before a switch to What's New failing says nothing
      // about the new order's own, which may still be on its way.
      if (g !== gen) return;
      pendingFocus = null;
      if (!loadedOnce) showEmpty('Couldn’t load photos. Retrying…');
    }
  }

  async function fetchOlder() {
    if (loadingOlder || !hasOlder || !cursor) return;
    loadingOlder = true;
    const g = gen;
    try {
      const r = await fetchTimeout(`${API}?limit=${PAGE}&order=${order}&before_sort=${encodeURIComponent(cursor.sort_at)}&before_id=${cursor.id}`, {}, 10000);
      if (!r.ok) throw new Error('status ' + r.status);
      const older = (await r.json()).posts || [];
      if (g !== gen) return;
      hasOlder = older.length === PAGE;
      if (older.length) {
        const last = older[older.length - 1];
        cursor = { sort_at: last.sort_at, id: last.id };
        // Sorted in rather than appended: a post re-dated into the past
        // may already be sitting at the end, and may be in this page too.
        const ids = new Set(older.map(p => p.id));
        const next = posts.filter(p => !ids.has(p.id)).concat(older)
          .sort((a, b) => before(a, b) ? 1 : before(b, a) ? -1 : 0);
        applyPosts(next, { keepSelection: true });
      }
    } catch (e) { /* the next scrub to the left edge retries */ }
    finally { if (g === gen) loadingOlder = false; }
  }

  // Swap in a new post list. The strip only rebuilds when the set of
  // photos changed; a poll that only brought new reactions or reply counts
  // just refreshes the details, so nothing moves under your cursor.
  function applyPosts(next, { keepSelection, focusPostId } = {}) {
    const prevKey = structureKey(posts);
    const keepId = keepSelection ? selectedPhotoId() : null;
    const keepX = keepId ? centers[sel] : 0;
    const wasAtNewest = sel >= 0 && items[sel]?.post === posts[0] && items[sel].k === 0;
    posts = next;
    if (!focusPostId && structureKey(posts) === prevKey && items.length) {
      rebuildItems();
      renderPost('refresh');
      return;
    }
    rebuildItems();
    layoutStrip();
    if (!items.length) { sel = -1; showEmpty(); return; }
    hideEmpty();
    // Stay on the photo you were looking at (it may have shifted right as
    // older pages loaded in), unless you were sitting on the newest one —
    // then a new post arriving is what you'd want to see.
    let idx = -1;
    if (focusPostId) idx = items.findIndex(it => it.post.id === focusPostId);
    else if (keepId && !wasAtNewest) idx = items.findIndex(it => it.ph.id === keepId);
    if (idx < 0) idx = newestPostStart();
    if (keepId && items[idx].ph.id === keepId) {
      // Still on the same photo (usually older pages loading in on its left
      // mid-scrub): everything in flight moves with it, so a glide, a jump
      // or a drag carries on instead of landing on whatever now sits at the
      // old strip position or index.
      const dx = centers[idx] - keepX;
      pos += dx; target += dx;
      if (drag) drag.start += dx;
      if (jump >= 0) jump = idx;
    } else {
      cancelAnimationFrame(raf); raf = 0; jump = -1;
      pos = target = centers[idx];
    }
    sel = -1;
    select(idx);
    renderStrip();
    setBackdrop();
  }

  // ── Opening one photo from elsewhere (Home) ──
  // If it isn't in what's loaded (the timeline orders by shooting date, so a
  // fresh upload of old photos sits far back), What's New has it up front.
  let pendingFocus = null;
  function focusPhoto(postId, photoId) {
    const idx = items.findIndex(it => it.post.id === postId && (photoId == null || it.ph.id === photoId));
    if (idx < 0) return false;
    goTo(idx);
    return true;
  }
  window.klabOpenPhoto = function(postId, photoId) {
    setActiveTab('photos');
    if (focusPhoto(postId, photoId)) return;
    pendingFocus = { postId, photoId };
    if (order !== 'posted') setOrder('posted'); else fetchLatest();
  };

  // ── Timeline / What's New ──
  function setOrder(next) {
    if (next === order) return;
    order = next;
    document.querySelectorAll('#phOrder button').forEach(b => b.setAttribute('aria-pressed', b.dataset.order === order));
    renderViewHead();
    posts = []; items = []; sel = -1; hasOlder = true; loadedOnce = false;
    cursor = null; gen++; loadingOlder = false;
    strip.textContent = ''; thumbEls = []; centers = [];
    SFX && SFX.play('click');
    fetchLatest();
  }
  document.getElementById('phOrder')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-order]');
    if (b) setOrder(b.dataset.order);
  });

  // ── Empty / error state ──
  function showEmpty(msg) {
    $('phEmpty').hidden = false;
    $('phEmptyText').textContent = msg || 'No photos yet. Post the first one.';
    shell.classList.add('is-empty');
    stopClip();
  }
  function hideEmpty() { $('phEmpty').hidden = true; shell.classList.remove('is-empty'); }

  // ── Filmstrip ──
  const GAP = 6, POST_GAP = 20;
  // Read once per layout: getComputedStyle every scrub frame forced a style recalc each time.
  let thumbPx = 46;
  const readThumbSize = () => { thumbPx = parseFloat(getComputedStyle(shell).getPropertyValue('--ph-thumb')) || 46; };
  const monthOf = post => (post.sort_at || post.created).slice(0, 7);

  function layoutStrip() {
    readThumbSize();
    const t = thumbPx;
    strip.textContent = '';
    thumbEls = [];
    centers = [];
    let x = 0, month = '';
    items.forEach((it, i) => {
      if (i > 0) x += it.k === 0 ? POST_GAP : GAP;
      // A month label wherever the timeline crosses into a new month.
      const m = monthOf(it.post);
      if (m !== month) {
        month = m;
        const lab = document.createElement('span');
        lab.className = 'ph-month';
        lab.textContent = new Date(m + '-15T12:00:00').toLocaleDateString([], { month: 'short', year: 'numeric' });
        lab.style.left = x + 'px';
        strip.appendChild(lab);
      }
      const d = document.createElement('div');
      d.className = 'ph-thumb' + (it.k === 0 && i > 0 ? ' newpost' : '');
      d.style.left = x + 'px';
      const img = document.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.draggable = false;
      img.onload = () => img.classList.add('loaded');
      img.src = fileUrl(it.ph.id, 'thumb');
      d.appendChild(img);
      strip.appendChild(d);
      thumbEls.push(d);
      centers.push(x + t / 2);
      x += t;
    });
    strip.style.width = x + 'px';
  }
  // --ph-thumb is smaller on a phone-width window, and the strip was laid
  // out for the old size: lay it out again and put the playhead back.
  function relayoutIfThumbChanged() {
    const was = thumbPx;
    readThumbSize();
    if (thumbPx === was || sel < 0 || !items[sel]) return;
    layoutStrip();
    cancelAnimationFrame(raf); raf = 0; jump = -1;
    pos = target = centers[sel];
    thumbEls[sel].classList.add('sel');
  }

  function nearest(x) {
    // centers is sorted, so binary search
    let lo = 0, hi = centers.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (centers[mid] < x) lo = mid; else hi = mid; }
    return Math.abs(centers[lo] - x) <= Math.abs(centers[hi] - x) ? lo : hi;
  }
  const clampX = x => Math.max(centers[0], Math.min(centers[centers.length - 1], x));

  // Dock-style magnification: thumbs swell as they near the playhead.
  function renderStrip() {
    if (!centers.length) return;
    const mid = (wrapW || wrap.clientWidth) / 2;
    strip.style.transform = `translate3d(${mid - pos}px,0,0)`;
    const t = thumbPx;
    const lo = pos - mid - 80, hi = pos + mid + 80;
    for (let i = 0; i < thumbEls.length; i++) {
      const c = centers[i];
      const el = thumbEls[i];
      // Off-screen thumbs leave the render tree, so painting and compositing
      // cost what's visible, not how many photos have ever been posted.
      const vis = c >= lo - 200 && c <= hi + 200;
      if (vis !== el._vis) { el.style.display = vis ? '' : 'none'; el._vis = vis; }
      if (!vis) continue;
      let s = 1;
      if (c >= lo && c <= hi) {
        const d = Math.abs(c - pos) / (t * 2.2);
        s = 1 + 0.55 * Math.max(0, 1 - d * d);
      }
      if (Math.abs((el._s || 1) - s) > 0.003) {
        el.style.transform = s === 1 ? '' : `scale(${s.toFixed(3)})`;
        el._s = s;
      }
    }
  }

  // ── Backdrop ──
  // Two layers crossfading. Only updated when you settle on a photo, not
  // on every frame of a scrub: repainting a full-viewport blur that often
  // is the one expensive thing on this tab.
  const bdLayers = document.querySelectorAll('#phBackdrop .ph-bd-layer');
  let bdOn = 0, bdUrl = '';
  function setBackdrop() {
    if (sel < 0 || !items[sel] || scrubbing) return;  // a scrub updates it once it stops
    const url = fileUrl(items[sel].ph.id, 'thumb');
    if (url === bdUrl) return;
    bdUrl = url;
    const next = bdLayers[1 - bdOn];
    next.style.backgroundImage = `url("${url}")`;
    window.klabSoften?.(next);
    next.classList.add('on');
    bdLayers[bdOn].classList.remove('on');
    bdOn = 1 - bdOn;
  }

  // ── Stage ──
  const preloaded = new Map();
  function preload(i) {
    if (i < 0 || i >= items.length) return;
    const u = fileUrl(items[i].ph.id, sizeFor(items[i].ph));
    if (preloaded.has(u)) return;
    const im = new Image(); im.decoding = 'async'; im.src = u;
    // Decoded ahead of time too, not just downloaded: decoding a 2560px JPEG
    // takes ~35ms, and left until first paint it lands inside a frame.
    // One that fails isn't kept, so the next visit tries again.
    im._ready = im.decode().then(() => { im._decoded = true; }, () => { if (preloaded.get(u) === im) preloaded.delete(u); });
    preloaded.set(u, im);
    if (preloaded.size > 24) preloaded.delete(preloaded.keys().next().value);
  }

  // Size the <img> box from the photo's known aspect ratio, so the 320px
  // placeholder fills exactly the frame the full image will. On a wide
  // screen the photo also leaves room for a rail on each side, and the
  // rails read its drawn size back (--ph-img-w/-h) to hug its edges; on a
  // narrow one the rails stack underneath and the photo takes what's left.
  const railL = frame.querySelector('.ph-rail-l');
  const railR = frame.querySelector('.ph-rail-r');
  // Narrow means a phone or a small tablet: a desktop window of any width
  // keeps the sidebar layout (no phone UI on a desktop).
  // The exact opposite of the CSS's desktop layout, (min-width: 901px), (pointer: fine).
  const narrowMq = matchMedia('(max-width: 900px) and (not (pointer: fine))');
  // Where the chrome lives: in Music's sidebar on a wide window; beside
  // and under the photo when it's narrow. Moved, not copied, so every
  // listener and id stays as it is.
  const actions = shell.querySelector('.ph-actions');
  function placeChrome() {
    const b = id => $(id);
    if (narrowMq.matches) {
      if (railL.parentElement === frame) return;
      actions.append(b('phOrder'), b('phInfoBtn'), b('phSoundBtn'), b('phPostBtn'));
      railR.insertBefore(b('phSong'), b('phReacts'));
      frame.insertBefore(railL, mainImg);
      frame.insertBefore(railR, mainImg.nextSibling);
    } else {
      if (railL.parentElement === $('phSideInfo')) return;
      $('phSideViews').append(b('phOrder'), b('phPostBtn'));
      $('phSideToggles').append(b('phInfoBtn'));
      $('phNow').append(b('phSong'), b('phSoundBtn'));
      $('phSideInfo').append(railL, railR);
    }
  }
  placeChrome();
  narrowMq.addEventListener('change', () => { placeChrome(); fitImg(); });
  // Which copy is sharp enough for how big the photo is drawn on this
  // screen: the 1440px one (a phone, a small window, a 1x monitor) or the
  // 2560px one. Measured against the whole frame, so it errs toward sharp.
  // Until the tab has been laid out, estimate from the window, so the photo
  // that loads in the background on page load is already the right copy.
  let frameBox = { w: window.innerWidth * 0.9, h: window.innerHeight * 0.62 };
  let railsH = 0;  // on a phone, the height the rails under the photo take
  function sizeFor(ph) {
    const r = ph.w / ph.h;
    const h = narrowMq.matches ? Math.max(frameBox.h * 0.45, frameBox.h - railsH) : frameBox.h;
    const w = Math.min(frameBox.w, h * r);
    const longest = Math.max(w, w / r) * (window.devicePixelRatio || 1);
    // The 1440px copy up to ~1700 device pixels: a slight upscale there is
    // invisible, and it's a fraction of the 2560px one's size.
    return longest <= 1700 ? 'medium' : 'display';
  }
  // The frame's and the strip's sizes, kept by a ResizeObserver: fitImg()
  // and renderStrip() run on every scrub frame right after the rails' text
  // was rewritten, and reading them from layout there forced a synchronous
  // layout each time. Border box, so a scrollbar coming and going in the
  // phone layout doesn't feed back into a refit.
  let frameW = 0, frameH = 0, wrapW = 0;
  const sizeObs = new ResizeObserver(() => {
    frameW = frame.clientWidth; frameH = frame.clientHeight; wrapW = wrap.clientWidth;
    if (!isActive() || !frameW) return;
    fitImg(); renderStrip();
  });
  sizeObs.observe(frame, { box: 'border-box' });
  sizeObs.observe(wrap);

  function fitImg() {
    if (sel < 0 || !items[sel]) return;
    const ph = items[sel].ph;
    const r = ph.w / ph.h;
    // The phone layout reads the rails' heights below anyway, and a
    // scrollbar there can take some of the width, so it measures fresh; so
    // does arriving on the tab, before the observer has reported.
    const fresh = narrowMq.matches || !frameW;
    const fw = fresh ? frame.clientWidth : frameW, fh = fresh ? frame.clientHeight : frameH;
    // Not laid out (the tab is hidden): leave the photo the size it was.
    if (!fw || !fh) return;
    frameBox = { w: fw, h: fh };
    let w;
    if (shell.classList.contains('bare') || !narrowMq.matches) {
      // Info hidden, or it's in the sidebar: the photo gets the whole frame.
      railsH = 0;
      w = Math.min(fw, fh * r);
    } else {
      railsH = railL.offsetHeight + railR.offsetHeight + 34;
      w = Math.min(fw, Math.max(fh * 0.45, fh - railsH) * r);
    }
    w = Math.max(0, w);
    mainImg.style.width = Math.round(w) + 'px';
    mainImg.style.height = Math.round(w / r) + 'px';
    frame.style.setProperty('--ph-img-w', Math.round(w) + 'px');
    frame.style.setProperty('--ph-img-h', Math.round(w / r) + 'px');
  }

  // A flip or jump crossfades: the outgoing photo is copied over the new
  // one, exactly where it sits, and faded out. Not while scrubbing, where
  // the photo should just follow the playhead.
  function crossfadeOut() {
    if (scrubbing || !mainImg.getAttribute('src') || !(window.klabMotionOk && window.klabMotionOk())) return;
    const z = zoomFactor(); // rects are in zoomed px on the big-screen zoom tiers
    const fr = frame.getBoundingClientRect(), r = mainImg.getBoundingClientRect();
    if (!r.width) return;
    const g = mainImg.cloneNode();
    g.removeAttribute('id');
    g.classList.add('ph-ghost');
    Object.assign(g.style, { position: 'absolute', left: (r.left - fr.left) / z + 'px', top: (r.top - fr.top) / z + 'px',
      width: r.width / z + 'px', height: r.height / z + 'px', transform: 'none', margin: '0' });
    frame.appendChild(g);
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => g.remove();
  }

  function select(i) {
    if (i === sel || !items[i]) return;
    if (sel >= 0 && thumbEls[sel]) thumbEls[sel].classList.remove('sel');
    const prevPost = sel >= 0 && items[sel] ? items[sel].post : null;
    if (sel >= 0) crossfadeOut();
    sel = i;
    thumbEls[i]?.classList.add('sel');
    const it = items[i];

    // While the strip is moving (a scrub, or gliding to a key press) only the
    // 320px thumb is shown, already in cache from the strip. The ~1MB full
    // image is fetched once it comes to rest (settle()), so a scrub past 30
    // photos doesn't queue 30MB in front of the one you stop on.
    const big = fileUrl(it.ph.id, sizeFor(it.ph));
    const cached = preloaded.get(big);
    if (cached && cached.complete && cached.naturalWidth && cached._decoded) {
      mainImg.src = big; mainImg.classList.remove('lowres');
    } else {
      mainImg.src = fileUrl(it.ph.id, 'thumb'); mainImg.classList.add('lowres');
      if (!moving()) settle();
    }
    mainImg.alt = it.post.text || `Photo by ${it.post.username}`;

    renderPost(prevPost !== it.post ? 'post' : 'photo');
    // A new post's details ease in beside it (skipped mid-scrub).
    if (prevPost && prevPost !== it.post && !scrubbing && window.klabFadeUp) {
      window.klabFadeUp(railL, { dy: 4, duration: 260 });
      window.klabFadeUp(railR, { dy: 4, duration: 260, delay: 30 });
    }
    setBackdrop();
    if (prevPost !== it.post) scheduleClip();
    if (i < 8) fetchOlder();
  }

  const avatarUrl = username => (window.klabResolveUserAvatar ? window.klabResolveUserAvatar(username) : null);
  function avatarHTML(username) {
    const url = avatarUrl(username);
    if (url) return `<img class="ph-avatar" src="${esc(url)}" alt="" width="26" height="26" />`;
    return `<span class="ph-avatar ph-avatar-letter" style="background:${profileColor(username)}">${esc(username[0] || '?').toUpperCase()}</span>`;
  }
  const nameHTML = u => `<button type="button" class="ph-name" data-username="${esc(u)}" style="color:${profileColor(u)}">${esc(u)}</button>`;

  // The camera line and the settings under it. Always on screen, and it
  // follows the scrub live like everything else.
  const SPEC_LABELS = [['aperture', 'Aperture'], ['shutter', 'Shutter'], ['iso', 'ISO'], ['focal', 'Focal'], ['film', 'Film']];
  function specsHTML(ex) {
    const gear = [ex.camera && `<b>${esc(ex.camera)}</b>`, ex.lens && `<span>${esc(ex.lens)}</span>`].filter(Boolean).join('');
    const specs = SPEC_LABELS.filter(([key]) => ex[key]).map(([key, label]) =>
      `<div class="ph-spec"><span class="k">${label}</span><span class="v">${esc(ex[key])}</span></div>`).join('');
    return { gear: gear || (specs ? '' : '<span>No camera details</span>'), specs };
  }

  // The rails + comments panel for the selected photo. `mode`:
  //   'post'    moved onto a different post: everything, and reset comments
  //   'photo'   another photo in the same post: just the per-photo parts
  //   'refresh' same photo, fresh data (likes, reply counts): no comment reset
  // Scrubbing calls this for every photo it passes, so 'photo' does as
  // little as it can.
  function renderPost(mode) {
    if (sel < 0 || !items[sel]) return;
    const { post, k, ph } = items[sel];
    // Not when the open comments are already this post's: applyPosts()
    // re-selects the same photo after every poll or older page that
    // changes the strip, and reloading then blanked the list mid-read.
    const postChanged = mode === 'post' &&
      !(shell.classList.contains('side-open') && $('phReplies').dataset.postId === String(post.id));
    $('phDots').innerHTML = post.photos.length > 1
      ? post.photos.map((_, j) => `<span class="${j === k ? 'on' : ''}"></span>`).join('') : '';
    const s = specsHTML(ph.exif || {});
    // Compared with what was written, not innerHTML (the browser's own
    // re-serialisation of it can differ, which rewrote it every scrub frame).
    if ($('phGear')._html !== s.gear) { $('phGear').innerHTML = s.gear; $('phGear')._html = s.gear; }
    if ($('phSpecRow')._html !== s.specs) { $('phSpecRow').innerHTML = s.specs; $('phSpecRow')._html = s.specs; }
    $('phOriginal').href = fileUrl(ph.id, 'original');
    $('phOriginalSize').textContent = `${ph.w} × ${ph.h}`;
    if (mode === 'photo') { fitImg(); return; }

    // Rebuilt only when something in it changed. Rewriting it on every
    // frame of a scrub reloaded the avatar each time, so it flickered.
    const whoKey = `${post.id}|${avatarUrl(post.username) || ''}`;
    if ($('phWho').dataset.key !== whoKey) {
      $('phWho').dataset.key = whoKey;
      $('phWho').innerHTML = avatarHTML(post.username) + nameHTML(post.username);
    }
    // This tab is about when the photos were taken, not when they were
    // posted. Only a post with no shooting date falls back to its post date.
    const shotEl = $('phShot');
    shotEl.classList.toggle('fallback', !post.shot_at);
    shotEl.innerHTML = post.shot_at
      ? `<i class="ti ti-camera"></i> Shot on ${esc(fmtShot(post.shot_at))}`
      : `Posted ${esc(new Date(post.created.replace(' ', 'T') + 'Z').toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }))}`;
    $('phCaption').textContent = post.text || '';
    $('phTags').innerHTML = post.tags?.length ? '<span>with</span> ' + post.tags.map(nameHTML).join('<span>,</span> ') : '';

    // The slot stays even without a song, so every post has the same shape.
    const song = post.song;
    const songEl = $('phSong');
    songEl.classList.toggle('none', !song);
    songEl.disabled = !song;
    $('phSongTitle').textContent = song ? song.title || '' : 'No song';
    $('phSongArtist').textContent = song ? song.artist || '' : '';
    $('phSongArt').style.backgroundImage = song?.coverArt
      ? `url("${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=80&${subsonicParams()}")` : '';
    songEl.classList.toggle('playing', !!song && clipPostId === post.id && !clip.paused);

    renderLikes(post);

    $('phOwn').hidden = !(post.username === me() || window.KLAB_USER?.is_admin);
    if (postChanged) {
      $('phReplies').dataset.postId = '';
      if (shell.classList.contains('side-open')) loadReplies(post);
    }
    fitImg();
  }

  function renderLikes(post, pop) {
    const liked = !!post.reactions?.[LIKE]?.mine;
    const n = post.reactions?.[LIKE]?.count || 0;
    $('phReacts').innerHTML =
      `<button type="button" class="ph-like${liked ? ' mine' : ''}${pop ? ' pop' : ''}" data-like="1" title="${liked ? 'Unlike' : 'Like'}" aria-pressed="${liked}">` +
        `<i class="ti ${liked ? 'ti-heart-filled' : 'ti-heart'}"></i>${n ? `<span>${n}</span>` : ''}</button>` +
      `<button type="button" class="ph-cmt" data-comments="1" title="Comments (c)" aria-pressed="${shell.classList.contains('side-open')}">` +
        `<i class="ti ti-message-circle"></i>${post.reply_count ? `<span>${post.reply_count}</span>` : ''}</button>`;
    const who = post.likers || [];
    const shown = who.slice(0, 3).map(nameHTML);
    const rest = who.length - shown.length;
    $('phLikers').innerHTML = !who.length ? '' : 'Liked by ' +
      (rest > 0 ? shown.join(', ') + ` <span title="${esc(who.slice(3).join(', '))}">and ${rest} other${rest > 1 ? 's' : ''}</span>`
        : shown.length > 1 ? shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1] : shown[0]);
  }

  // ── Scrubbing ──
  let raf = 0, scrubbing = false, idleTimer = 0;
  const moving = () => scrubbing || pos !== target;
  // At rest: show the selected photo sharp and warm up its neighbours.
  let warmed = false;
  function warmSoon() {
    if (warmed) return;
    warmed = true;
    const idle = window.requestIdleCallback || (f => setTimeout(f, 200));
    setTimeout(() => idle(() => { if (!isActive() && sel >= 0) preload(sel); }), 5000);
  }
  function settle() {
    // Nothing big loads while the tab is hidden (it used to warm up ~1MB of
    // photos at startup behind Home); arriving on the tab settles again.
    // Just the first photo is warmed, once the page has gone quiet.
    if (sel < 0 || !items[sel]) return;
    if (!isActive()) { warmSoon(); return; }
    const i = sel, id = items[i].ph.id;
    const big = fileUrl(id, sizeFor(items[i].ph));
    preload(i);
    // Checked by photo, not index: an older page loading in shifts every index.
    const im = preloaded.get(big);
    const show = () => {
      if (!im._decoded || selectedPhotoId() !== id || mainImg.getAttribute('src') === big) return;
      mainImg.src = big; mainImg.classList.remove('lowres');
    };
    im._ready.then(show);
    for (const d of [1, -1, 2]) preload(i + d);
    // Whatever earlier stops were still fetching isn't wanted any more.
    const want = new Set([i, i + 1, i - 1, i + 2].filter(j => items[j]).map(j => fileUrl(items[j].ph.id, sizeFor(items[j].ph))));
    for (const [u, p] of preloaded) if (!p.complete && !want.has(u)) { preloaded.delete(u); p.src = ''; }
  }
  // Key repeat and wheel clicks call goTo() many times a second; only the
  // photo you stop on should queue a full-size download and decode.
  let settleTimer = 0;
  const settleSoon = () => { clearTimeout(settleTimer); settleTimer = setTimeout(settle, 120); };
  // A jump (arrow key, tapping a thumb) knows where it's going, so the
  // photo switches and sharpens right away while the strip glides after
  // it, instead of staying blurred for the whole glide and flashing every
  // photo it passes on the way. Scrubbing clears it: the playhead leads again.
  let jump = -1;
  function tick() {
    const d = target - pos;
    pos = Math.abs(d) < 0.3 ? target : pos + d * 0.22;
    select(jump >= 0 ? jump : nearest(pos));
    renderStrip();
    raf = pos !== target ? requestAnimationFrame(tick) : 0;
    if (!raf) { jump = -1; if (!scrubbing) settle(); }
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  function setScrubbing(on) {
    scrubbing = on;
    shell.classList.toggle('scrubbing', on);
    if (on) { clearTimeout(clipTimer); return; }
    // Switched order (or the last post went) mid-scrub: nothing to land on,
    // and centers[-1] would leave the glide chasing NaN every frame.
    if (!centers.length) return;
    target = centers[nearest(target)];
    kick();
    if (pos === target) settle();
    setBackdrop();
    scheduleClip();
  }
  function scrubActivity() {
    jump = -1;
    if (!scrubbing) setScrubbing(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setScrubbing(false), 160);
  }

  function goTo(i) {
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    target = centers[i];
    jump = i;
    select(i);
    settleSoon();
    setBackdrop();
    kick();
  }
  function goPost(dir) {
    if (sel < 0) return;
    const pi = posts.indexOf(items[sel].post) - dir; // posts is newest-first
    if (pi < 0 || pi >= posts.length) return;
    goTo(items.findIndex(it => it.post === posts[pi]));
  }

  // Drag the strip. Moving your finger right reveals older photos.
  let drag = null;
  wrap.addEventListener('pointerdown', e => {
    if (!items.length || e.button !== 0) return; // a right-click opens the menu, it doesn't jump
    drag = { x: e.clientX, start: target, moved: false, z: zoomFactor() };
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.z; // pointer px are zoomed on big screens; the strip isn't
    if (Math.abs(dx) > 3) drag.moved = true;
    if (!drag.moved) return;
    pos = target = clampX(drag.start - dx); // direct manipulation: no easing lag under the finger
    scrubActivity();
    select(nearest(pos));
    renderStrip();
  });
  const endDrag = e => {
    if (!drag) return;
    wrap.classList.remove('dragging');
    if (!drag.moved) {
      // a tap on a thumb jumps to it
      const r = wrap.getBoundingClientRect();
      goTo(nearest(pos + (e.clientX - r.left - r.width / 2) / zoomFactor()));
    }
    drag = null;
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  // Trackpad/wheel anywhere on the tab: a sideways swipe scrubs, and
  // scrolling down goes back in time. The comments panel keeps its own scroll.
  //
  // A mouse wheel is stepped instead: one click moves exactly one photo.
  // A click arrives as a single ~100px jump (or as lines, in Firefox),
  // and fed into the continuous scrub that's nearly two thumbs' worth.
  // A trackpad sends a stream of small deltas, which keep scrubbing freely.
  shell.addEventListener('wheel', e => {
    if (!items.length || e.target.closest('.ph-side')) return;
    // Narrow window: the camera details, song and reactions stack under
    // the photo in a scrolling column. A vertical wheel over that column
    // scrolls it, or there'd be no way down to them with a mouse.
    if (narrowMq.matches && frame.contains(e.target) && Math.abs(e.deltaY) > Math.abs(e.deltaX) &&
        frame.scrollHeight > frame.clientHeight + 1) return;
    // Same for the sidebar on a short window: a long caption pushes the
    // song off its bottom, and it scrolls (overflow-y: auto) only if the
    // wheel is let through.
    const side = e.target.closest('.ph-sidebar');
    if (side && Math.abs(e.deltaY) > Math.abs(e.deltaX) && side.scrollHeight > side.clientHeight + 1) return;
    e.preventDefault();
    const notch = e.deltaMode === 1 || (Math.abs(e.deltaX) < 1 && Math.abs(e.deltaY) >= 50);
    if (notch) {
      goTo(sel + (e.deltaY > 0 ? -1 : 1));
      return;
    }
    target = clampX(target + (e.deltaX - e.deltaY) * 0.9);
    scrubActivity();
    kick();
  }, { passive: false });

  // Swipe on the photo flips one photo; double-tap hearts it.
  let swipe = null, lastTap = 0;
  // Only the photo itself: taps and selections in the rails beside it aren't swipes.
  frame.addEventListener('pointerdown', e => { swipe = e.target.closest('.ph-rail') ? null : { x: e.clientX, y: e.clientY }; });
  frame.addEventListener('pointerup', e => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { goTo(sel + (dx < 0 ? 1 : -1)); return; }
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return;
    const now = Date.now();
    if (now - lastTap < 320) { lastTap = 0; heartBurst(e); }
    else lastTap = now;
  });

  function heartBurst(e) {
    if (sel < 0) return;
    const post = items[sel].post;
    if (!post.reactions?.[LIKE]?.mine) toggleReaction(post, LIKE);
    const r = stage.getBoundingClientRect();
    const h = document.createElement('i');
    h.className = 'ph-heart ti ti-heart-filled';
    const z = zoomFactor();
    h.style.left = (e.clientX - r.left) / z + 'px';
    h.style.top = (e.clientY - r.top) / z + 'px';
    stage.appendChild(h);
    setTimeout(() => h.remove(), 900);
  }

  // ── Reactions / replies (the feed's endpoints) ──
  async function toggleReaction(post, emoji) {
    try {
      const r = await fetchTimeout(`/api/posts/${post.id}/reactions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
      }, 8000);
      if (!r.ok) throw new Error();
      post.reactions = (await r.json()).reactions || {};
      if (emoji === LIKE) {
        const mine = !!post.reactions[LIKE]?.mine;
        post.likers = (post.likers || []).filter(u => u !== me());
        if (mine) post.likers.push(me());
      }
      if (sel >= 0 && items[sel].post === post) renderLikes(post, emoji === LIKE && !!post.reactions[LIKE]?.mine);
    } catch (e) { showToast('couldn’t react — try again', 'ti-alert-triangle'); }
  }

  $('phReacts').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || sel < 0) return;
    SFX && SFX.play('click');
    if (b.dataset.comments) { setSide(!shell.classList.contains('side-open')); return; }
    toggleReaction(items[sel].post, LIKE);
  });

  async function loadReplies(post) {
    const list = $('phReplies');
    if (list.dataset.postId === String(post.id)) return;
    list.dataset.postId = String(post.id);
    list.innerHTML = '<div class="ph-replies-empty">loading…</div>';
    try {
      const r = await fetchTimeout(`/api/posts/${post.id}/replies`, {}, 8000);
      if (!r.ok) throw new Error();
      const replies = (await r.json()).replies || [];
      if (list.dataset.postId !== String(post.id)) return;
      renderReplies(post, replies);
    } catch (e) {
      // Only if it's still this post's list: another post's may be loading.
      if (list.dataset.postId === String(post.id)) {
        list.innerHTML = '<div class="ph-replies-empty">couldn’t load comments</div>';
        list.dataset.postId = '';
      }
    }
  }
  // After a reply is posted or deleted, the list may have moved on to
  // another post while the request was out.
  const showingReplies = post => $('phReplies').dataset.postId === String(post.id);
  const shownReplies = post => ($('phReplies')._repliesFor === post.id && $('phReplies')._replies) || [];
  function renderReplies(post, replies) {
    const list = $('phReplies');
    list._repliesFor = post.id;
    list.innerHTML = replies.length ? replies.map(rep =>
      `<div class="ph-reply">${nameHTML(rep.username)} <span class="ph-reply-text">${esc(rep.text)}</span>` +
        ((rep.username === me() || window.KLAB_USER?.is_admin)
          ? `<button type="button" class="ph-reply-del" data-reply-id="${rep.id}" title="Delete"><i class="ti ti-x"></i></button>` : '') +
      `</div>`).join('') : '<div class="ph-replies-empty">No comments yet.</div>';
    list._replies = replies;
  }

  $('phReplyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('phReplyInput');
    const text = input.value.trim();
    if (!text || sel < 0) return;
    const post = items[sel].post;
    input.disabled = true;
    try {
      const r = await fetchTimeout(`/api/posts/${post.id}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      }, 8000);
      if (!r.ok) throw new Error();
      const reply = await r.json();
      input.value = '';
      post.reply_count = (post.reply_count || 0) + 1;
      if (showingReplies(post)) renderReplies(post, shownReplies(post).concat(reply));
      renderPost('refresh');
    } catch (err) { showToast('couldn’t post that comment', 'ti-alert-triangle'); }
    finally { input.disabled = false; input.focus(); }
  });

  $('phReplies').addEventListener('click', async e => {
    const del = e.target.closest('.ph-reply-del');
    if (!del || sel < 0) return;
    const post = items[sel].post;
    try {
      const r = await fetchTimeout(`/api/posts/${post.id}/replies/${del.dataset.replyId}`, { method: 'DELETE' }, 8000);
      if (!r.ok) throw new Error();
      post.reply_count = Math.max(0, (post.reply_count || 1) - 1);
      if (showingReplies(post)) renderReplies(post, shownReplies(post).filter(x => String(x.id) !== del.dataset.replyId));
      renderPost('refresh');
    } catch (err) { showToast('couldn’t delete that comment', 'ti-alert-triangle'); }
  });

  // Names open the profile popover, same as the feed and chat.
  shell.addEventListener('click', e => {
    const n = e.target.closest('.ph-name');
    if (n && typeof openProfileView === 'function') openProfileView(n.dataset.username);
  });

  $('phDelete').addEventListener('click', async () => {
    if (sel < 0) return;
    const post = items[sel].post;
    if (!(await showConfirmDialog('// delete photo post', 'Delete this post and its photos? This can’t be undone.', 'Delete'))) return;
    try {
      const r = await fetchTimeout(`/api/posts/${post.id}`, { method: 'DELETE' }, 10000);
      if (!r.ok) throw new Error();
      if (clipPostId === post.id) stopClip();
      // By id: a poll during the confirm or the request swaps in new objects.
      applyPosts(posts.filter(p => p.id !== post.id), { keepSelection: false });
      showToast('post deleted', 'ti-trash');
    } catch (e) { showToast('couldn’t delete that post', 'ti-alert-triangle'); }
  });

  // ── Edit your own post ──
  // Mostly for getting shooting dates right after the fact, so the timeline
  // reads in the order things happened.
  const editBackdrop = $('phEditBackdrop');
  let editing = null;
  // The date field only holds the day. Sent back untouched it would reset
  // the time of day to noon, so it's only sent when you changed it.
  let editDate0 = '';
  const editTags = makeTagPicker('phEdit', () => editing?.username);
  $('phEditBtn').addEventListener('click', () => {
    if (sel < 0) return;
    editing = items[sel].post;
    loadRoster();
    $('phEditDate').value = editDate0 = (editing.shot_at || '').slice(0, 10);
    $('phEditDate').max = new Date().toISOString().slice(0, 10);
    $('phEditCaption').value = editing.text || '';
    editTags.set(editing.tags || []);
    $('phEditError').hidden = true;
    editBackdrop.classList.add('open');
    SFX && SFX.play('open');
    $('phEditDate').focus();
  });
  const closeEdit = () => { editBackdrop.classList.remove('open'); editing = null; };
  $('phEditClose').addEventListener('click', closeEdit);
  editBackdrop.addEventListener('click', e => { if (e.target === editBackdrop) closeEdit(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && editBackdrop.classList.contains('open')) closeEdit(); });
  trapFocusWithin(editBackdrop.querySelector('.add-app-modal'), () => editBackdrop.classList.contains('open'));
  $('phEditSave').addEventListener('click', async () => {
    if (!editing) return;
    const btn = $('phEditSave');
    btn.disabled = true;
    try {
      const body = { caption: $('phEditCaption').value.trim(), tags: editTags.get() };
      if ($('phEditDate').value !== editDate0) body.shot_at = $('phEditDate').value;
      const r = await fetchTimeout(`${API}/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, 10000);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'couldn’t save');
      // A new date can move the post along the timeline: re-slot it and follow it there.
      if (order === 'posted') data.sort_at = data.created;
      const next = posts.filter(p => p.id !== data.id);
      let at = next.findIndex(p => before(p, data));
      if (at < 0) at = next.length;
      next.splice(at, 0, data);
      closeEdit();
      applyPosts(next, { focusPostId: data.id });
      showToast('post updated', 'ti-check');
    } catch (e) {
      $('phEditError').textContent = e.message || 'couldn’t save';
      $('phEditError').hidden = false;
    } finally { btn.disabled = false; }
  });

  // ── Comments panel ──
  function setSide(on) {
    shell.classList.toggle('side-open', on);
    $('phReacts').querySelector('.ph-cmt')?.setAttribute('aria-pressed', on);
    if (on && sel >= 0) loadReplies(items[sel].post);
    // the frame animates its right edge; refit once it settles
    setTimeout(fitImg, 300);
  }
  $('phSideClose').addEventListener('click', () => setSide(false));

  // ── Right-click: the photo on stage, or any thumb in the strip ──
  function photoMenu(e, i) {
    const it = items[i];
    if (!it) return;
    const { post, ph } = it;
    const liked = !!post.reactions?.[LIKE]?.mine;
    const own = post.username === me() || window.KLAB_USER?.is_admin;
    const original = fileUrl(ph.id, 'original');
    // Actions on "the post" work on the one on stage, so show it first.
    const onStage = fn => () => { goTo(i); fn(); };
    klabMenu(e, [
      { header: post.username },
      { label: 'Show', icon: 'ti-eye', hidden: i === sel, action: () => goTo(i) },
      { label: liked ? 'Unlike' : 'Like', icon: liked ? 'ti-heart-off' : 'ti-heart', action: () => toggleReaction(post, LIKE) },
      { label: 'Comments', icon: 'ti-message-circle', action: onStage(() => setSide(true)) },
      { label: infoOn ? 'Hide details' : 'Show details', icon: 'ti-info-circle', hidden: i !== sel, action: () => setInfo(!infoOn) },
      '-',
      { label: 'Open original', icon: 'ti-external-link', action: () => window.open(original, '_blank', 'noopener') },
      { label: 'Copy image', icon: 'ti-copy', action: () => klabCopyImage(fileUrl(ph.id, sizeFor(ph))) },
      { label: 'Copy image link', icon: 'ti-link', action: () => klabCopy(new URL(original, location.href).href, 'Link') },
      '-',
      { label: 'Play song', icon: 'ti-player-play', hidden: !klabCleanSong(post.song), action: () => playSong(klabCleanSong(post.song)) },
      '-',
      { label: 'View profile', icon: 'ti-user-circle', action: () => openProfileView(post.username) },
      { label: 'Message', icon: 'ti-message-2-plus', hidden: post.username === me(), action: () => messageUser(post.username) },
      '-',
      { label: 'Edit post', icon: 'ti-pencil', hidden: !own, action: onStage(() => $('phEditBtn').click()) },
      { label: 'Delete post', icon: 'ti-trash', warn: true, hidden: !own, action: onStage(() => $('phDelete').click()) },
    ]);
  }
  stage.addEventListener('contextmenu', e => { if (sel >= 0 && !e.target.closest('button, a')) photoMenu(e, sel); });
  strip.addEventListener('contextmenu', e => {
    const t = e.target.closest('.ph-thumb');
    const i = t ? thumbEls.indexOf(t) : -1;
    if (i >= 0) photoMenu(e, i);
  });

  // ══ Song clips ══
  // A separate <audio> from the main player. The main player is paused
  // while you're on this tab (see klabPhotosTabChanged), so clips play on
  // their own rather than over your music.
  const clip = new Audio();
  clip.preload = 'none';
  let clipPostId = null, clipStart = 0, clipTimer = 0, clipSuppressed = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) {}

  function fade(audio, to, ms, done) {
    const from = audio.volume, t0 = performance.now();
    cancelAnimationFrame(audio._fadeRaf);
    const step = now => {
      const p = Math.min(1, (now - t0) / ms);
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * p));
      if (p < 1) audio._fadeRaf = requestAnimationFrame(step);
      else if (done) done();
    };
    audio._fadeRaf = requestAnimationFrame(step);
  }

  function playClip(song, postId) {
    if (!song?.songId) return;
    if (clipPostId === postId && !clip.paused) return;
    clipPostId = postId;
    clipStart = song.start || 0;
    clip.src = `${ND_URL}/rest/stream?id=${encodeURIComponent(song.songId)}&${subsonicParams()}`;
    clip.volume = 0;
    clip.addEventListener('loadedmetadata', () => {
      if (clipPostId !== postId) return; // stopped (or moved on) while it loaded
      try { clip.currentTime = clipStart; } catch (e) {}
      clip.play().then(() => {
        if (clipPostId !== postId) return;
        fade(clip, playerState.volume, 600);
        markSongPlaying();
      }).catch(() => {
        // Autoplay blocked or stream failed: stay silent, and forget it, or
        // the first press on the song would "stop" a clip that isn't playing.
        if (clipPostId === postId) clipPostId = null;
      });
    }, { once: true });
    clip.load();
  }
  function stopClip() {
    clearTimeout(clipTimer);
    if (clipPostId === null && clip.paused) return;
    clipPostId = null;
    const halt = () => { if (clipPostId === null) { clip.pause(); clip.removeAttribute('src'); clip.load(); } };
    // A hidden page runs no animation frames, so the fade would never
    // finish and the clip would keep playing out of sight: stop it outright.
    if (document.hidden) { cancelAnimationFrame(clip._fadeRaf); halt(); }
    else fade(clip, 0, 350, halt);
    markSongPlaying();
  }
  function markSongPlaying() {
    const post = sel >= 0 && items[sel] ? items[sel].post : null;
    $('phSong').classList.toggle('playing', !!post && clipPostId === post.id);
  }
  // Loop the clip window rather than running off into the rest of the track.
  clip.addEventListener('timeupdate', () => {
    if (clip.currentTime > clipStart + CLIP_LEN_S) clip.currentTime = clipStart;
  });

  function scheduleClip() {
    clearTimeout(clipTimer);
    if (!isActive() || sel < 0 || scrubbing) return;
    const post = items[sel].post;
    if (clipPostId !== null && clipPostId !== post.id) stopClip();
    if (!soundOn || !post.song || clipSuppressed === post.id || document.hidden) return;
    // The composer's song preview is playing: a poll re-selecting, or
    // coming back to the window, mustn't start a clip over it.
    if (previewWanted) return;
    if (!playerState.audio.paused) return; // your own music is on (a listening party, a media key): it wins
    clipTimer = setTimeout(() => {
      if (sel >= 0 && items[sel].post === post && !scrubbing && isActive()) playClip(post.song, post.id);
    }, SONG_DWELL_MS);
  }

  // Your music starting while you're here (media keys, a listening party
  // resyncing) means you want it: the clip steps aside, and leaving the
  // tab won't try to "resume" something that's already playing.
  playerState.audio.addEventListener('play', () => {
    pausedByPhotos = false;
    if (clipPostId !== null) { clipSuppressed = clipPostId; stopClip(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopClip(); else scheduleClip(); });

  // Photo info (the rails: who, caption, camera, song, reactions) can be
  // hidden for just the pictures. Remembered per device.
  const INFO_KEY = 'klabnet_ph_info';
  let infoOn = true;
  try { infoOn = localStorage.getItem(INFO_KEY) !== 'off'; } catch (e) {}
  // Icon, label and Settings' switch (shown in the sidebar; beside the
  // photo on a phone it's the icon alone). Built once and then updated,
  // so the switch slides rather than being redrawn.
  function setToggleBtn(b, icon, label, on) {
    if (!b.querySelector('.s-toggle')) b.innerHTML = `<i class="ti"></i><span>${label}</span><b class="s-toggle" aria-hidden="true"></b>`;
    b.querySelector('i').className = 'ti ' + icon;
    b.querySelector('.s-toggle').classList.toggle('on', on);
  }
  function setInfo(on) {
    infoOn = on;
    try { localStorage.setItem(INFO_KEY, on ? 'on' : 'off'); } catch (e) {}
    renderInfoBtn();
    fitImg();
  }
  function renderInfoBtn() {
    shell.classList.toggle('bare', !infoOn);
    const b = $('phInfoBtn');
    setToggleBtn(b, infoOn ? 'ti-info-circle' : 'ti-photo', 'Photo info', infoOn);
    b.title = infoOn ? 'Hide photo info (i)' : 'Show photo info (i)';
    b.setAttribute('aria-pressed', infoOn);
  }
  renderInfoBtn();
  $('phInfoBtn').addEventListener('click', () => { SFX && SFX.play('click'); setInfo(!infoOn); });

  function renderSoundBtn() {
    const b = $('phSoundBtn');
    setToggleBtn(b, soundOn ? 'ti-volume' : 'ti-volume-off', 'Song clips', soundOn);
    b.title = soundOn ? 'Song clips on' : 'Song clips off';
    b.setAttribute('aria-pressed', soundOn);
  }
  $('phSoundBtn').addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (e) {}
    renderSoundBtn();
    SFX && SFX.play('click');
    if (soundOn) { clipSuppressed = null; scheduleClip(); } else stopClip();
  });
  $('phSong').addEventListener('click', () => {
    if (sel < 0 || !items[sel].post.song) return;
    const post = items[sel].post;
    if (clipPostId === post.id) { clipSuppressed = post.id; stopClip(); }
    else { clipSuppressed = null; if (!soundOn) { soundOn = true; renderSoundBtn(); } playClip(post.song, post.id); }
  });

  // Called by setActiveTab() on every tab change. Arriving pauses your
  // music (unless you're in a listening party, which it would break);
  // leaving resumes it, but only if this tab was what paused it.
  let pausedByPhotos = false, shown = false;
  window.klabPhotosTabChanged = function(active) {
    // setActiveTab() calls this on every switch, Photos to Photos too (the
    // nav button again): only really arriving pauses your music, or music
    // started here (the photo's "Play song") stopped on that second click.
    const arriving = active && !shown;
    shown = active;
    if (!active) {
      stopClip();
      stopPreview();
      if (pausedByPhotos) { pausedByPhotos = false; playerState.audio.play().catch(() => {}); }
      return;
    }
    if (arriving && !playerState.audio.paused && !(window.klabInListeningParty && window.klabInListeningParty())) {
      playerState.audio.pause();
      pausedByPhotos = true;
    }
    requestAnimationFrame(() => { relayoutIfThumbChanged(); fitImg(); renderStrip(); setBackdrop(); settle(); scheduleClip(); });
    // The poll only runs while you're here, so catch up on arrival.
    if (Date.now() - lastFetch > 10000) fetchLatest();
  };

  // ── Keyboard ──
  // Capture phase on window, so while this tab is showing its keys win over
  // the global ones (←/→ are prev/next track elsewhere, j/k scroll).
  function anyModalOpen() {
    // A right-click menu too: this handler runs before the menu's own (window
    // capture beats document capture), so ↑/↓ moved the photo instead of the
    // menu's highlight, under a menu still about the old one.
    return !!document.querySelector('.add-app-backdrop.open, .settings-backdrop.open, .img-crop-backdrop.open, .klab-menu.visible, .fs-player.open');
  }
  window.addEventListener('keydown', e => {
    if (!isActive() || e.metaKey || e.ctrlKey || e.altKey || anyModalOpen()) return;
    if (window.klabAwaitingG?.()) return; // "g h", "g c": going to a tab, not a photo
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'l') goTo(sel + 1);
    else if (k === 'ArrowLeft' || k === 'h') goTo(sel - 1);
    else if (k === 'ArrowUp' || k === 'k') goPost(1);
    else if (k === 'ArrowDown' || k === 'j') goPost(-1);
    else if (k === 'c') setSide(!shell.classList.contains('side-open'));
    else if (k === 'i') { SFX && SFX.play('click'); setInfo(!infoOn); }
    else if (k === 'End' || k === 'G') goTo(newestPostStart());
    else if (k === 'Home') goTo(0);
    else if (k === 'Escape' && shell.classList.contains('side-open')) setSide(false);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  window.addEventListener('resize', () => { if (isActive()) { relayoutIfThumbChanged(); renderStrip(); fitImg(); } });
  frame.addEventListener('transitionend', fitImg);

  // ══ Composer ══
  const backdrop = $('phComposeBackdrop');
  const grid = $('phComposeGrid');
  const fileInput = $('phComposeFile');
  let drafts = [];        // { key, file, preview, status: 'queued'|'uploading'|'done'|'error', progress, id, w, h, exif, edited, xhr }
  let activeDraft = null; // the tile whose details are being edited
  let pickedSong = null;  // subsonic song object
  let draftKey = 0;
  let shotEdited = false; // the shooting date was set by hand, so stop auto-filling it
  const EDIT_FIELDS = ['camera', 'lens', 'film', 'aperture', 'shutter', 'iso', 'focal'];

  function openComposer(files) {
    backdrop.classList.add('open');
    SFX && SFX.play('open');
    loadRoster();
    $('phShotDate').max = new Date().toISOString().slice(0, 10);
    if (files && files.length) addFiles(files);
    else if (!drafts.length) fileInput.click();
  }
  function closeComposer() {
    backdrop.classList.remove('open');
    stopPreview();
    SFX && SFX.play('close');
  }
  function resetComposer() {
    drafts.forEach(d => { d.xhr?.abort(); if (d.preview) URL.revokeObjectURL(d.preview); });
    drafts = []; activeDraft = null; pickedSong = null; shotEdited = false;
    composerTags.set([]);
    $('phComposeCaption').value = '';
    $('phShotDate').value = '';
    $('phComposeError').hidden = true;
    renderDrafts(); renderSongPick();
  }

  $('phPostBtn').addEventListener('click', () => openComposer());
  $('phEmptyPost').addEventListener('click', () => openComposer());
  $('phComposeClose').addEventListener('click', closeComposer);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeComposer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && backdrop.classList.contains('open')) closeComposer(); });
  trapFocusWithin(backdrop.querySelector('.add-app-modal'), () => backdrop.classList.contains('open'));
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

  // Dropping files anywhere on the tab (or on the open composer) starts a post.
  [shell, backdrop].forEach(el => {
    el.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); el.classList.add('drop-hover'); } });
    // Leaving for somewhere outside it, not just moving between its children.
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover'); });
    el.addEventListener('drop', e => {
      el.classList.remove('drop-hover');
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      if (backdrop.classList.contains('open')) addFiles(e.dataTransfer.files);
      else openComposer(e.dataTransfer.files);
    });
  });

  const MAX_PHOTOS = 10;
  function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    const room = MAX_PHOTOS - drafts.length;
    if (files.length > room) showComposeError(`Up to ${MAX_PHOTOS} photos per post.`);
    files.slice(0, Math.max(0, room)).forEach(file => {
      // Browsers other than Safari can't preview HEIC; the tile shows the
      // server's thumbnail once the upload finishes instead.
      const previewable = !/\.(heic|heif)$/i.test(file.name) && !/hei[cf]/.test(file.type);
      const d = { key: ++draftKey, file, preview: previewable ? URL.createObjectURL(file) : null, status: 'queued', progress: 0 };
      drafts.push(d);
      if (!activeDraft) activeDraft = d;
    });
    renderDrafts();
    pumpUploads();
  }

  // Two at a time: enough to keep the pipe full without one huge batch
  // starving the server's image processing.
  function pumpUploads() {
    const running = drafts.filter(d => d.status === 'uploading').length;
    drafts.filter(d => d.status === 'queued').slice(0, Math.max(0, 2 - running)).forEach(upload);
  }
  function upload(d) {
    d.status = 'uploading';
    const xhr = new XMLHttpRequest();
    d.xhr = xhr;
    xhr.open('POST', `${API}/uploads`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) { d.progress = e.loaded / e.total; renderDraftTile(d); } };
    xhr.onload = () => {
      d.xhr = null;
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 200 && body.id) {
        Object.assign(d, { status: 'done', id: body.id, w: body.w, h: body.h, exif: body.exif || {} });
        d.edited = Object.assign({}, d.exif);
        finishTile(d);
      } else {
        d.status = 'error';
        d.error = body.error || (xhr.status === 413 ? 'too large' : 'upload failed');
        renderDraftTile(d);
      }
      draftChanged(d);
      autoShotDate();
      pumpUploads();
    };
    xhr.onerror = () => { d.xhr = null; d.status = 'error'; d.error = 'upload failed'; renderDraftTile(d); draftChanged(d); pumpUploads(); };
    const fd = new FormData();
    fd.append('file', d.file, d.file.name);
    xhr.send(fd);
    renderDraftTile(d);
  }

  function tileHTML(d) {
    const src = d.preview || (d.id ? fileUrl(d.id, 'thumb') : '');
    const state = d.status === 'done' ? ''
      : d.status === 'error' ? `<div class="ph-tile-state error" title="${esc(d.error || '')}"><i class="ti ti-alert-triangle"></i><span>${esc(d.error || 'failed')}</span></div>`
      : `<div class="ph-tile-state"><div class="ph-tile-bar" style="width:${Math.round((d.progress || 0) * 100)}%"></div></div>`;
    return (src ? `<img src="${esc(src)}" alt="" draggable="false" />` : '<i class="ti ti-photo ph-tile-ph"></i>') + state +
      `<button type="button" class="ph-tile-x" data-remove="${d.key}" title="Remove"><i class="ti ti-x"></i></button>`;
  }
  function renderDraftTile(d) {
    const el = grid.querySelector(`.ph-tile[data-key="${d.key}"]`);
    if (!el) return;
    const bar = el.querySelector('.ph-tile-bar');
    if (bar && d.status === 'uploading') bar.style.width = Math.round((d.progress || 0) * 100) + '%';
    else el.innerHTML = tileHTML(d);
  }
  // One upload finishing touches only its own tile, and the details editor
  // only when it's that photo's: rebuilding everything took the cursor out
  // of a camera field you were typing in and re-decoded every full-size
  // preview.
  function draftChanged(d) {
    if (d === activeDraft) renderExifEditor();
    updateSubmit();
  }
  // A finished upload drops its progress bar, then trades the full-size
  // local preview for the server's small thumbnail once that has loaded.
  function finishTile(d) {
    grid.querySelector(`.ph-tile[data-key="${d.key}"] .ph-tile-state`)?.remove();
    const t = new Image();
    t.onload = () => {
      if (d.preview) { URL.revokeObjectURL(d.preview); d.preview = null; }
      renderDraftTile(d);
    };
    t.src = fileUrl(d.id, 'thumb');
  }
  function renderDrafts() {
    grid.innerHTML = drafts.map(d =>
      `<div class="ph-tile${d === activeDraft ? ' active' : ''}" data-key="${d.key}">${tileHTML(d)}</div>`).join('') +
      (drafts.length < MAX_PHOTOS ? `<button type="button" class="ph-tile ph-tile-add" id="phComposeAdd" title="Add photos"><i class="ti ti-plus"></i></button>` : '');
    renderExifEditor();
    updateSubmit();
  }

  grid.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      e.stopPropagation();
      const d = drafts.find(x => x.key === Number(rm.dataset.remove));
      if (!d) return;
      d.xhr?.abort();
      if (d.preview) URL.revokeObjectURL(d.preview);
      drafts = drafts.filter(x => x !== d);
      if (activeDraft === d) activeDraft = drafts[0] || null;
      if (d.id) fetchTimeout(`${API}/uploads/${d.id}`, { method: 'DELETE' }, 8000).catch(() => {});
      renderDrafts();
      autoShotDate();
      pumpUploads();
      return;
    }
    if (e.target.closest('#phComposeAdd')) { fileInput.click(); return; }
    const tile = e.target.closest('.ph-tile');
    if (tile) {
      activeDraft = drafts.find(x => x.key === Number(tile.dataset.key)) || activeDraft;
      grid.querySelectorAll('.ph-tile[data-key]').forEach(el => el.classList.toggle('active', el.dataset.key === String(activeDraft?.key)));
      renderExifEditor();
    }
  });

  function renderExifEditor() {
    const box = $('phComposeExif');
    const d = activeDraft;
    if (!d || d.status !== 'done') {
      box.innerHTML = d ? '<div class="ph-compose-hint">Reading camera details…</div>' : '';
      return;
    }
    const idx = drafts.indexOf(d) + 1;
    const label = f => f === 'film' ? 'Film' : f === 'iso' ? 'ISO' : f[0].toUpperCase() + f.slice(1);
    box.innerHTML =
      `<div class="ph-compose-hint">${drafts.length > 1 ? `Photo ${idx} of ${drafts.length} · ` : ''}camera details (read from the file, edit freely)</div>` +
      `<div class="ph-exif-grid">` + EDIT_FIELDS.map(f =>
        `<label class="ph-field${f === 'camera' || f === 'lens' || f === 'film' ? ' wide' : ''}"><span>${label(f)}</span>` +
        `<input type="text" data-field="${f}" value="${esc(d.edited[f] || '')}" placeholder="${f === 'film' ? 'e.g. Portra 400' : ''}" maxlength="120" /></label>`
      ).join('') + `</div>`;
  }
  $('phComposeExif').addEventListener('input', e => {
    const f = e.target.dataset.field;
    if (f && activeDraft?.edited) activeDraft.edited[f] = e.target.value;
  });

  // ── Composer: shooting date ──
  // Pre-filled with the earliest capture date among the photos, until you
  // set one by hand. Empty means "unknown": the post sorts by when it was posted.
  function autoShotDate() {
    const hint = $('phShotHint');
    if (shotEdited) { hint.textContent = ''; return; }
    const taken = drafts.filter(d => d.status === 'done' && d.exif?.taken).map(d => d.exif.taken).sort()[0];
    $('phShotDate').value = taken ? taken.slice(0, 10) : '';
    hint.textContent = taken ? 'from the photos' : drafts.some(d => d.status === 'done') ? 'not in the files — set it for old photos' : '';
  }
  $('phShotDate').addEventListener('input', () => { shotEdited = true; $('phShotHint').textContent = ''; });

  // ── Composer: tags ──
  let roster = null;
  async function loadRoster() {
    if (roster) return;
    try {
      const r = await fetchTimeout('/api/presence', {}, 8000);
      roster = ((await r.json()).roster || []).map(p => p.username).filter(Boolean);
    } catch (e) { roster = null; }
  }
  // A tag picker: chips for who's tagged, a type-ahead from the roster.
  // Used by the composer and the edit dialog. `exclude()` names who can't be
  // tagged (the post's author).
  function makeTagPicker(prefix, exclude) {
    const box = $(prefix + 'TagsBox'), input = $(prefix + 'TagInput'), list = $(prefix + 'TagSuggest');
    let tags = [];
    function render() {
      box.querySelectorAll('.ph-tag-chip').forEach(c => c.remove());
      tags.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'ph-tag-chip';
        chip.innerHTML = `${esc(t)}<button type="button" data-untag="${esc(t)}" title="Remove"><i class="ti ti-x"></i></button>`;
        box.insertBefore(chip, input);
      });
    }
    function suggestions() {
      const q = input.value.trim().toLowerCase();
      if (!q || !roster) { list.innerHTML = ''; return []; }
      const matches = roster.filter(u => u !== exclude() && !tags.includes(u) && u.includes(q))
        .sort((a, b) => (b.startsWith(q) - a.startsWith(q)) || a.localeCompare(b)).slice(0, 6);
      list.innerHTML = matches.map((u, i) =>
        `<button type="button" data-tag="${esc(u)}" class="${i === 0 ? 'hi' : ''}">${avatarHTML(u)}<span>${esc(u)}</span></button>`).join('');
      return matches;
    }
    function add(u) {
      if (!u || tags.includes(u) || u === exclude()) return;
      tags.push(u);
      input.value = '';
      list.innerHTML = '';
      render();
    }
    input.addEventListener('input', suggestions);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const first = suggestions()[0];
        if (first) add(first);
      } else if (e.key === 'Backspace' && !input.value && tags.length) {
        tags.pop(); render();
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { list.innerHTML = ''; }, 150));
    list.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input
    list.addEventListener('click', e => { const b = e.target.closest('[data-tag]'); if (b) add(b.dataset.tag); });
    box.addEventListener('click', e => {
      const x = e.target.closest('[data-untag]');
      if (x) { tags = tags.filter(t => t !== x.dataset.untag); render(); return; }
      input.focus();
    });
    return { get: () => tags.slice(), set: t => { tags = t.slice(); input.value = ''; list.innerHTML = ''; render(); } };
  }
  const composerTags = makeTagPicker('ph', () => me());

  function showComposeError(msg) {
    const el = $('phComposeError');
    el.textContent = msg; el.hidden = !msg;
  }
  function updateSubmit() {
    const btn = $('phComposeSubmit');
    const busy = drafts.some(d => d.status === 'uploading' || d.status === 'queued');
    const ready = drafts.filter(d => d.status === 'done');
    btn.disabled = busy || !ready.length || btn.dataset.posting === '1';
    btn.textContent = busy ? 'Uploading…' : 'Post';
  }

  $('phComposeSubmit').addEventListener('click', async () => {
    const btn = $('phComposeSubmit');
    const ready = drafts.filter(d => d.status === 'done');
    if (!ready.length) return;
    btn.dataset.posting = '1';
    updateSubmit();
    showComposeError('');
    const body = {
      caption: $('phComposeCaption').value.trim(),
      photos: ready.map(d => ({ id: d.id, exif: d.edited })),
      // The field only holds the day. Left as filled in from the photos,
      // nothing is sent and the server uses their full capture time; emptied
      // by hand, it's sent as cleared, or the server would fill it back in.
      shot_at: shotEdited ? $('phShotDate').value : '',
      tags: composerTags.get(),
    };
    if (shotEdited && !body.shot_at) body.shot_at_cleared = true;
    if (pickedSong) {
      body.song = {
        songId: pickedSong.id, title: pickedSong.title, artist: pickedSong.artist || '',
        album: pickedSong.album || '', coverArt: pickedSong.coverArt || '',
        start: Number($('phSongStart').value) || 0,
      };
    }
    try {
      const r = await fetchTimeout(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, 15000);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'couldn’t post');
      // resetComposer() drops the local previews (the posted uploads stay),
      // and stops any photo added while this was posting, which isn't in it.
      resetComposer();
      closeComposer();
      if (!isActive()) setActiveTab('photos');
      // Slot it in where it belongs on the timeline (an old shoot lands in
      // the past, not at the end) and go there.
      if (order === 'posted') data.sort_at = data.created;
      const next = posts.filter(p => p.id !== data.id);
      let at = next.findIndex(p => before(p, data));
      if (at < 0) at = next.length;
      next.splice(at, 0, data);
      applyPosts(next, { focusPostId: data.id });
      SFX && SFX.play('success');
    } catch (e) {
      showComposeError(e.message || 'couldn’t post');
    } finally {
      btn.dataset.posting = '';
      updateSubmit();
    }
  });

  // ── Composer: song picker ──
  let songSearchTimer = 0, songSearchToken = 0;
  const previewAudio = new Audio();
  previewAudio.preload = 'none';

  function fmtSecs(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function artUrl(coverArt, size) { return `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(coverArt)}&size=${size}&${subsonicParams()}`; }

  $('phSongSearch').addEventListener('input', e => {
    clearTimeout(songSearchTimer);
    const q = e.target.value.trim();
    // Cleared: a search still out for what was there mustn't fill it back in.
    if (!q) { ++songSearchToken; $('phSongResults').innerHTML = ''; return; }
    songSearchTimer = setTimeout(async () => {
      const token = ++songSearchToken;
      try {
        const r = await fetchTimeout(`${ND_URL}/rest/search3?query=${encodeURIComponent(q)}&songCount=8&artistCount=0&albumCount=0&${subsonicParams()}`, {}, 8000);
        const songs = (await r.json())['subsonic-response']?.searchResult3?.song || [];
        if (token !== songSearchToken) return;
        $('phSongResults')._songs = songs;
        $('phSongResults').innerHTML = songs.length ? songs.map((s, i) =>
          `<button type="button" class="ph-song-result" data-i="${i}">` +
            (s.coverArt ? `<img src="${esc(artUrl(s.coverArt, 80))}" alt="" />` : '<span class="ph-song-noart"><i class="ti ti-music"></i></span>') +
            `<span class="ph-song-meta"><span class="t">${esc(s.title)}</span><span class="a">${esc(s.artist || '')}</span></span>` +
          `</button>`).join('') : '<div class="ph-compose-hint">No matches in the library.</div>';
      } catch (err) {
        if (token === songSearchToken) $('phSongResults').innerHTML = '<div class="ph-compose-hint">Search failed.</div>';
      }
    }, 250);
  });
  $('phSongResults').addEventListener('click', e => {
    const b = e.target.closest('.ph-song-result');
    if (!b) return;
    pickedSong = $('phSongResults')._songs[Number(b.dataset.i)];
    // Nor one still out when a song is picked (it would be waiting under
    // the box when the song is removed again).
    clearTimeout(songSearchTimer); ++songSearchToken;
    $('phSongSearch').value = '';
    $('phSongResults').innerHTML = '';
    const start = $('phSongStart');
    start.max = Math.max(0, (pickedSong.duration || 30) - 5);
    // Most songs take a while to get going; a third of the way in is a
    // better default than the intro.
    start.value = Math.round((pickedSong.duration || 0) / 3);
    renderSongPick();
    SFX && SFX.play('click');
  });
  function renderSongPick() {
    const has = !!pickedSong;
    $('phSongPicked').hidden = !has;
    $('phSongSearchWrap').hidden = has;
    if (!has) { stopPreview(); return; }
    $('phSongPickedArt').src = pickedSong.coverArt ? artUrl(pickedSong.coverArt, 80) : '';
    $('phSongPickedTitle').textContent = pickedSong.title;
    $('phSongPickedArtist').textContent = pickedSong.artist || '';
    $('phSongStartLabel').textContent = 'starts at ' + fmtSecs($('phSongStart').value);
  }
  $('phSongStart').addEventListener('input', () => {
    $('phSongStartLabel').textContent = 'starts at ' + fmtSecs($('phSongStart').value);
    if (!previewAudio.paused) { try { previewAudio.currentTime = Number($('phSongStart').value); } catch (e) {} }
  });
  $('phSongRemove').addEventListener('click', () => { pickedSong = null; renderSongPick(); });
  // Set from pressing preview until it's stopped. The audio is still paused
  // while it loads, so without this a stop in that moment (or closing the
  // composer) did nothing and it started playing anyway once it had loaded.
  let previewWanted = false;
  $('phSongPreview').addEventListener('click', () => {
    if (previewWanted) { stopPreview(); return; }
    stopClip();
    previewWanted = true;
    previewAudio.src = `${ND_URL}/rest/stream?id=${encodeURIComponent(pickedSong.id)}&${subsonicParams()}`;
    previewAudio.volume = playerState.volume;
    previewAudio.addEventListener('loadedmetadata', () => {
      if (!previewWanted) return;
      try { previewAudio.currentTime = Number($('phSongStart').value); } catch (e) {}
      previewAudio.play().catch(() => {});
    }, { once: true });
    previewAudio.load();
    $('phSongPreview').innerHTML = '<i class="ti ti-player-stop"></i>';
  });
  function stopPreview() {
    previewWanted = false;
    previewAudio.pause();
    $('phSongPreview').innerHTML = '<i class="ti ti-player-play"></i>';
  }
  previewAudio.addEventListener('timeupdate', () => {
    if (previewAudio.currentTime > Number($('phSongStart').value) + CLIP_LEN_S) previewAudio.currentTime = Number($('phSongStart').value);
  });

  // ── Start ──
  renderSoundBtn();
  renderDrafts();
  renderSongPick();
  fetchLatest();
  setInterval(() => { if (isActive()) fetchLatest(); }, POLL_MS);
})();
