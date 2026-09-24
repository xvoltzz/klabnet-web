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
  const QUICK_REACTIONS = ['❤️', '🔥', '😂', '👍'];
  const PAGE = 40;
  const POLL_MS = 45000;
  const SONG_DWELL_MS = 550;   // how long you have to stay on a post before its song starts
  const CLIP_LEN_S = 30;       // clips loop over this window from the chosen start
  const SOUND_KEY = 'klabnet_photos_sound';

  const fileUrl = (id, size) => `${API}/files/${id}/${size}`;
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

  const isActive = () => panel.classList.contains('active');
  const me = () => (window.KLAB_USER?.username || '').toLowerCase();
  // Timeline order: sort_at ("YYYY-MM-DD HH:MM:SS") then id, both descending.
  const before = (a, b) => a.sort_at < b.sort_at || (a.sort_at === b.sort_at && a.id < b.id);

  function fmtAgo(apiTime) {
    const d = new Date(apiTime.replace(' ', 'T') + 'Z');
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString();
  }
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
  }
  // The first photo of the newest post: where the tab opens, and what G/End
  // go back to. (The newest post's later photos sit to its right.)
  const newestPostStart = () => items.findIndex(it => it.post === posts[0]);
  const selectedPhotoId = () => (sel >= 0 && items[sel]) ? items[sel].ph.id : null;
  const structureKey = list => list.map(p => p.id + ':' + p.photos.map(ph => ph.id).join(',')).join('|');

  async function fetchLatest() {
    if (document.hidden) return;
    try {
      const r = await fetchTimeout(`${API}?limit=${PAGE}`, {}, 10000);
      if (!r.ok) throw new Error('status ' + r.status);
      const fresh = (await r.json()).posts || [];
      // Merge: the newest page replaces whatever overlaps it; older pages
      // already loaded by scrubbing left stay put.
      const last = fresh[fresh.length - 1];
      const merged = fresh.concat(last ? posts.filter(p => before(p, last)) : []);
      if (!loadedOnce) hasOlder = fresh.length === PAGE;
      loadedOnce = true;
      applyPosts(merged, { keepSelection: true });
    } catch (e) {
      if (!loadedOnce) showEmpty('Couldn’t load photos. Retrying…');
    }
  }

  async function fetchOlder() {
    if (loadingOlder || !hasOlder || !posts.length) return;
    loadingOlder = true;
    try {
      const last = posts[posts.length - 1];
      const r = await fetchTimeout(`${API}?limit=${PAGE}&before_sort=${encodeURIComponent(last.sort_at)}&before_id=${last.id}`, {}, 10000);
      if (!r.ok) throw new Error('status ' + r.status);
      const older = (await r.json()).posts || [];
      hasOlder = older.length === PAGE;
      if (older.length) applyPosts(posts.concat(older), { keepSelection: true });
    } catch (e) { /* the next scrub to the left edge retries */ }
    finally { loadingOlder = false; }
  }

  // Swap in a new post list. The strip only rebuilds when the set of
  // photos changed; a poll that only brought new reactions or reply counts
  // just refreshes the details, so nothing moves under your cursor.
  function applyPosts(next, { keepSelection, focusPostId } = {}) {
    const prevKey = structureKey(posts);
    const keepId = keepSelection ? selectedPhotoId() : null;
    const wasAtNewest = sel >= 0 && items[sel]?.post === posts[0] && items[sel].k === 0;
    posts = next;
    if (!focusPostId && structureKey(posts) === prevKey && items.length) {
      rebuildItems();
      renderPost(false);
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
    pos = target = centers[idx];
    sel = -1;
    select(idx);
    renderStrip();
    setBackdrop();
  }

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
  const thumbSize = () => parseFloat(getComputedStyle(shell).getPropertyValue('--ph-thumb')) || 46;
  const monthOf = post => (post.sort_at || post.created).slice(0, 7);

  function layoutStrip() {
    const t = thumbSize();
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
      img.src = fileUrl(it.ph.id, 'thumb');
      d.appendChild(img);
      strip.appendChild(d);
      thumbEls.push(d);
      centers.push(x + t / 2);
      x += t;
    });
    strip.style.width = x + 'px';
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
    const mid = wrap.clientWidth / 2;
    strip.style.transform = `translate3d(${mid - pos}px,0,0)`;
    const t = thumbSize();
    const lo = pos - mid - 80, hi = pos + mid + 80;
    for (let i = 0; i < thumbEls.length; i++) {
      const c = centers[i];
      let s = 1;
      if (c >= lo && c <= hi) {
        const d = Math.abs(c - pos) / (t * 2.2);
        s = 1 + 0.55 * Math.max(0, 1 - d * d);
      }
      const el = thumbEls[i];
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
    if (sel < 0 || !items[sel] || scrubbing) return;
    const url = fileUrl(items[sel].ph.id, 'thumb');
    if (url === bdUrl) return;
    bdUrl = url;
    const next = bdLayers[1 - bdOn];
    next.style.backgroundImage = `url("${url}")`;
    next.classList.add('on');
    bdLayers[bdOn].classList.remove('on');
    bdOn = 1 - bdOn;
  }

  // ── Stage ──
  const preloaded = new Map();
  function preload(i) {
    if (i < 0 || i >= items.length) return;
    const u = fileUrl(items[i].ph.id, 'display');
    if (preloaded.has(u)) return;
    const im = new Image(); im.decoding = 'async'; im.src = u;
    preloaded.set(u, im);
    if (preloaded.size > 24) preloaded.delete(preloaded.keys().next().value);
  }

  // Size the <img> box from the photo's known aspect ratio, so the 320px
  // placeholder fills exactly the frame the full image will.
  function fitImg() {
    if (sel < 0 || !items[sel]) return;
    const ph = items[sel].ph;
    const r = ph.w / ph.h;
    const w = Math.min(frame.clientWidth, frame.clientHeight * r);
    mainImg.style.width = Math.round(w) + 'px';
    mainImg.style.height = Math.round(w / r) + 'px';
  }

  function select(i) {
    if (i === sel || !items[i]) return;
    if (sel >= 0 && thumbEls[sel]) thumbEls[sel].classList.remove('sel');
    const prevPost = sel >= 0 && items[sel] ? items[sel].post : null;
    sel = i;
    thumbEls[i]?.classList.add('sel');
    const it = items[i];

    const big = fileUrl(it.ph.id, 'display');
    const cached = preloaded.get(big);
    if (cached && cached.complete && cached.naturalWidth) {
      mainImg.src = big; mainImg.classList.remove('lowres');
    } else {
      mainImg.src = fileUrl(it.ph.id, 'thumb'); mainImg.classList.add('lowres');
      preload(i);
      preloaded.get(big).addEventListener('load', () => {
        if (sel === i) { mainImg.src = big; mainImg.classList.remove('lowres'); }
      }, { once: true });
    }
    mainImg.alt = it.post.text || `Photo by ${it.post.username}`;
    fitImg();
    for (const d of [1, -1, 2, -2, 3]) preload(i + d);

    renderPost(prevPost !== it.post);
    setBackdrop();
    if (prevPost !== it.post) scheduleClip();
    if (i < 8) fetchOlder();
  }

  function avatarHTML(username) {
    const url = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(username) : null;
    if (url) return `<img class="ph-avatar" src="${esc(url)}" alt="" />`;
    return `<span class="ph-avatar ph-avatar-letter" style="background:${profileColor(username)}">${esc(username[0] || '?').toUpperCase()}</span>`;
  }
  const nameHTML = u => `<button type="button" class="ph-name" data-username="${esc(u)}" style="color:${profileColor(u)}">${esc(u)}</button>`;

  // The camera line and the settings under it. Always on screen, and it
  // follows the scrub live like everything else.
  function specsHTML(ex) {
    const gear = [ex.camera && `<b>${esc(ex.camera)}</b>`, ex.lens && esc(ex.lens)].filter(Boolean).join(' · ');
    const specs = [
      ex.aperture && `<span class="ph-spec"><i class="ti ti-aperture"></i>${esc(ex.aperture)}</span>`,
      ex.shutter && `<span class="ph-spec"><i class="ti ti-stopwatch"></i>${esc(ex.shutter)}</span>`,
      ex.iso && `<span class="ph-spec"><i class="ti ti-brightness-half"></i>ISO ${esc(ex.iso)}</span>`,
      ex.focal && `<span class="ph-spec"><i class="ti ti-ruler-2"></i>${esc(ex.focal)}</span>`,
      ex.film && `<span class="ph-spec film"><i class="ti ti-movie"></i>${esc(ex.film)}</span>`,
    ].filter(Boolean).join('');
    return {
      gear: gear || (specs ? '' : '<i class="ti ti-camera"></i> No camera details'),
      specs,
    };
  }

  // Details row + comments panel for the selected photo. `postChanged` is
  // false when only reactions/replies moved, so the reply list isn't refetched.
  function renderPost(postChanged) {
    if (sel < 0 || !items[sel]) return;
    const { post, k, ph } = items[sel];
    $('phWho').innerHTML = avatarHTML(post.username) + nameHTML(post.username) +
      `<span class="ph-when">· posted ${esc(fmtAgo(post.created))}</span>`;
    $('phShot').innerHTML = post.shot_at ? `<i class="ti ti-calendar"></i> Shot ${esc(fmtShot(post.shot_at))}` : '';
    $('phCaption').textContent = post.text || '';
    $('phTags').innerHTML = post.tags?.length ? '<span>with</span> ' + post.tags.map(nameHTML).join('<span>,</span> ') : '';
    $('phDots').innerHTML = post.photos.length > 1
      ? post.photos.map((_, j) => `<span class="${j === k ? 'on' : ''}"></span>`).join('') : '';

    const s = specsHTML(ph.exif || {});
    $('phGear').innerHTML = s.gear;
    $('phGear').hidden = !s.gear;
    $('phSpecRow').innerHTML = s.specs;

    const song = post.song;
    const songEl = $('phSong');
    songEl.hidden = !song;
    if (song) {
      $('phSongTitle').textContent = song.title || '';
      $('phSongArtist').textContent = song.artist || '';
      $('phSongArt').style.backgroundImage = song.coverArt
        ? `url("${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=80&${subsonicParams()}")` : '';
      songEl.classList.toggle('playing', clipPostId === post.id && !clip.paused);
    }

    const rx = post.reactions || {};
    const emojis = QUICK_REACTIONS.concat(Object.keys(rx).filter(e => !QUICK_REACTIONS.includes(e)));
    $('phReacts').innerHTML = emojis.map(e => {
      const r = rx[e];
      return `<button type="button" class="ph-react${r?.mine ? ' mine' : ''}${r ? '' : ' zero'}" data-emoji="${esc(e)}">${e}${r ? `<span>${r.count}</span>` : ''}</button>`;
    }).join('') +
      `<button type="button" class="ph-react ph-react-comments" data-comments="1" title="Comments (c)" aria-pressed="${shell.classList.contains('side-open')}"><i class="ti ti-message-circle"></i>${post.reply_count ? `<span>${post.reply_count}</span>` : ''}</button>`;

    $('phOriginal').href = fileUrl(ph.id, 'original');
    $('phOriginalSize').textContent = `${ph.w} × ${ph.h}`;
    $('phDelete').hidden = !(post.username === me() || window.KLAB_USER?.is_admin);
    if (postChanged) {
      $('phReplies').dataset.postId = '';
      if (shell.classList.contains('side-open')) loadReplies(post);
    }
  }

  // ── Scrubbing ──
  let raf = 0, scrubbing = false, idleTimer = 0;
  function tick() {
    const d = target - pos;
    pos = Math.abs(d) < 0.3 ? target : pos + d * 0.22;
    select(nearest(pos));
    renderStrip();
    raf = pos !== target ? requestAnimationFrame(tick) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  function setScrubbing(on) {
    scrubbing = on;
    shell.classList.toggle('scrubbing', on);
    if (on) { clearTimeout(clipTimer); return; }
    target = centers[nearest(target)];
    kick();
    setBackdrop();
    scheduleClip();
  }
  function scrubActivity() {
    if (!scrubbing) setScrubbing(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setScrubbing(false), 160);
  }

  function goTo(i) {
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    target = centers[i];
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
    if (!items.length) return;
    drag = { x: e.clientX, start: target, moved: false };
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
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
      goTo(nearest(pos + (e.clientX - r.left - r.width / 2)));
    }
    drag = null;
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  // Trackpad/wheel anywhere on the tab: a sideways swipe scrubs, and
  // scrolling down goes back in time. The comments panel keeps its own scroll.
  shell.addEventListener('wheel', e => {
    if (!items.length || e.target.closest('.ph-side')) return;
    e.preventDefault();
    target = clampX(target + (e.deltaX - e.deltaY) * 0.9);
    scrubActivity();
    kick();
  }, { passive: false });

  // Swipe on the photo flips one photo; double-tap hearts it.
  let swipe = null, lastTap = 0;
  frame.addEventListener('pointerdown', e => { swipe = { x: e.clientX, y: e.clientY }; });
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
    if (!post.reactions?.['❤️']?.mine) toggleReaction(post, '❤️');
    const r = stage.getBoundingClientRect();
    const h = document.createElement('div');
    h.className = 'ph-heart';
    h.textContent = '❤️';
    h.style.left = (e.clientX - r.left) + 'px';
    h.style.top = (e.clientY - r.top) + 'px';
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
      if (sel >= 0 && items[sel].post === post) renderPost(false);
    } catch (e) { showToast('couldn’t react — try again', 'ti-alert-triangle'); }
  }

  $('phReacts').addEventListener('click', e => {
    const b = e.target.closest('.ph-react');
    if (!b || sel < 0) return;
    SFX && SFX.play('click');
    if (b.dataset.comments) { setSide(!shell.classList.contains('side-open')); return; }
    toggleReaction(items[sel].post, b.dataset.emoji);
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
      if (list.dataset.postId === String(post.id)) list.innerHTML = '<div class="ph-replies-empty">couldn’t load comments</div>';
      list.dataset.postId = '';
    }
  }
  function renderReplies(post, replies) {
    const list = $('phReplies');
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
      renderReplies(post, ($('phReplies')._replies || []).concat(reply));
      renderPost(false);
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
      renderReplies(post, ($('phReplies')._replies || []).filter(x => String(x.id) !== del.dataset.replyId));
      renderPost(false);
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
      applyPosts(posts.filter(p => p !== post), { keepSelection: false });
      showToast('post deleted', 'ti-trash');
    } catch (e) { showToast('couldn’t delete that post', 'ti-alert-triangle'); }
  });

  // ── Comments panel ──
  function setSide(on) {
    shell.classList.toggle('side-open', on);
    $('phReacts').querySelector('.ph-react-comments')?.setAttribute('aria-pressed', on);
    if (on && sel >= 0) loadReplies(items[sel].post);
    // the frame animates its right edge; refit once it settles
    setTimeout(fitImg, 300);
  }
  $('phSideClose').addEventListener('click', () => setSide(false));

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
      try { clip.currentTime = clipStart; } catch (e) {}
      clip.play().then(() => {
        if (clipPostId !== postId) return;
        fade(clip, playerState.volume, 600);
        markSongPlaying();
      }).catch(() => { /* autoplay blocked or stream failed: stay silent */ });
    }, { once: true });
    clip.load();
  }
  function stopClip() {
    clearTimeout(clipTimer);
    if (clipPostId === null && clip.paused) return;
    clipPostId = null;
    fade(clip, 0, 350, () => { if (clipPostId === null) { clip.pause(); clip.removeAttribute('src'); clip.load(); } });
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

  function renderSoundBtn() {
    const b = $('phSoundBtn');
    b.innerHTML = `<i class="ti ${soundOn ? 'ti-volume' : 'ti-volume-off'}"></i>`;
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
    if (sel < 0) return;
    const post = items[sel].post;
    if (clipPostId === post.id) { clipSuppressed = post.id; stopClip(); }
    else { clipSuppressed = null; if (!soundOn) { soundOn = true; renderSoundBtn(); } playClip(post.song, post.id); }
  });

  // Called by setActiveTab() on every tab change. Arriving pauses your
  // music (unless you're in a listening party, which it would break);
  // leaving resumes it, but only if this tab was what paused it.
  let pausedByPhotos = false;
  window.klabPhotosTabChanged = function(active) {
    if (!active) {
      stopClip();
      stopPreview();
      if (pausedByPhotos) { pausedByPhotos = false; playerState.audio.play().catch(() => {}); }
      return;
    }
    if (!playerState.audio.paused && !(window.klabInListeningParty && window.klabInListeningParty())) {
      playerState.audio.pause();
      pausedByPhotos = true;
    }
    requestAnimationFrame(() => { fitImg(); renderStrip(); setBackdrop(); scheduleClip(); });
  };

  // ── Keyboard ──
  // Capture phase on window, so while this tab is showing its keys win over
  // the global ones (←/→ are prev/next track elsewhere, j/k scroll).
  function anyModalOpen() {
    return !!document.querySelector('.add-app-backdrop.open, .settings-backdrop.open, .img-crop-backdrop.open');
  }
  window.addEventListener('keydown', e => {
    if (!isActive() || e.metaKey || e.ctrlKey || e.altKey || anyModalOpen()) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'l') goTo(sel + 1);
    else if (k === 'ArrowLeft' || k === 'h') goTo(sel - 1);
    else if (k === 'ArrowUp' || k === 'k') goPost(1);
    else if (k === 'ArrowDown' || k === 'j') goPost(-1);
    else if (k === 'c' || k === 'i') setSide(!shell.classList.contains('side-open'));
    else if (k === 'End' || k === 'G') goTo(newestPostStart());
    else if (k === 'Home') goTo(0);
    else if (k === 'Escape' && shell.classList.contains('side-open')) setSide(false);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  window.addEventListener('resize', () => { if (isActive()) { renderStrip(); fitImg(); } });
  frame.addEventListener('transitionend', fitImg);

  // ══ Composer ══
  const backdrop = $('phComposeBackdrop');
  const grid = $('phComposeGrid');
  const fileInput = $('phComposeFile');
  let drafts = [];        // { key, file, preview, status: 'queued'|'uploading'|'done'|'error', progress, id, w, h, exif, edited, xhr }
  let activeDraft = null; // the tile whose details are being edited
  let pickedSong = null;  // subsonic song object
  let draftKey = 0;
  let tags = [];          // usernames tagged on this post
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
    drafts = []; activeDraft = null; pickedSong = null; tags = []; shotEdited = false;
    $('phComposeCaption').value = '';
    $('phShotDate').value = '';
    $('phComposeError').hidden = true;
    renderDrafts(); renderSongPick(); renderTags();
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
    el.addEventListener('dragleave', e => { if (e.target === el) el.classList.remove('drop-hover'); });
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
      } else {
        d.status = 'error';
        d.error = body.error || (xhr.status === 413 ? 'too large' : 'upload failed');
      }
      renderDrafts();
      autoShotDate();
      pumpUploads();
    };
    xhr.onerror = () => { d.xhr = null; d.status = 'error'; d.error = 'upload failed'; renderDrafts(); pumpUploads(); };
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
    if (tile) { activeDraft = drafts.find(x => x.key === Number(tile.dataset.key)) || activeDraft; renderDrafts(); }
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
  function renderTags() {
    const box = $('phTagsBox');
    box.querySelectorAll('.ph-tag-chip').forEach(c => c.remove());
    const input = $('phTagInput');
    tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'ph-tag-chip';
      chip.innerHTML = `${esc(t)}<button type="button" data-untag="${esc(t)}" title="Remove"><i class="ti ti-x"></i></button>`;
      box.insertBefore(chip, input);
    });
  }
  function tagSuggestions() {
    const q = $('phTagInput').value.trim().toLowerCase();
    const list = $('phTagSuggest');
    if (!q || !roster) { list.innerHTML = ''; return []; }
    const matches = roster.filter(u => u !== me() && !tags.includes(u) && u.includes(q))
      .sort((a, b) => (b.startsWith(q) - a.startsWith(q)) || a.localeCompare(b)).slice(0, 6);
    list.innerHTML = matches.map((u, i) =>
      `<button type="button" data-tag="${esc(u)}" class="${i === 0 ? 'hi' : ''}">${avatarHTML(u)}<span>${esc(u)}</span></button>`).join('');
    return matches;
  }
  function addTag(u) {
    if (!u || tags.includes(u) || u === me()) return;
    tags.push(u);
    $('phTagInput').value = '';
    $('phTagSuggest').innerHTML = '';
    renderTags();
  }
  $('phTagInput').addEventListener('input', tagSuggestions);
  $('phTagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const first = tagSuggestions()[0];
      if (first) addTag(first);
    } else if (e.key === 'Backspace' && !e.target.value && tags.length) {
      tags.pop(); renderTags();
    }
  });
  $('phTagInput').addEventListener('blur', () => setTimeout(() => { $('phTagSuggest').innerHTML = ''; }, 150));
  $('phTagSuggest').addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input
  $('phTagSuggest').addEventListener('click', e => { const b = e.target.closest('[data-tag]'); if (b) addTag(b.dataset.tag); });
  $('phTagsBox').addEventListener('click', e => {
    const x = e.target.closest('[data-untag]');
    if (x) { tags = tags.filter(t => t !== x.dataset.untag); renderTags(); return; }
    $('phTagInput').focus();
  });

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
      shot_at: $('phShotDate').value || '',
      tags,
    };
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
      // Drop the local previews without deleting the now-posted uploads.
      drafts.forEach(d => { if (d.preview) URL.revokeObjectURL(d.preview); });
      drafts = [];
      resetComposer();
      closeComposer();
      if (!isActive()) setActiveTab('photos');
      // Slot it in where it belongs on the timeline (an old shoot lands in
      // the past, not at the end) and go there.
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
    if (!q) { $('phSongResults').innerHTML = ''; return; }
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
  $('phSongPreview').addEventListener('click', () => {
    if (!previewAudio.paused) { stopPreview(); return; }
    stopClip();
    previewAudio.src = `${ND_URL}/rest/stream?id=${encodeURIComponent(pickedSong.id)}&${subsonicParams()}`;
    previewAudio.volume = playerState.volume;
    previewAudio.addEventListener('loadedmetadata', () => {
      try { previewAudio.currentTime = Number($('phSongStart').value); } catch (e) {}
      previewAudio.play().catch(() => {});
    }, { once: true });
    previewAudio.load();
    $('phSongPreview').innerHTML = '<i class="ti ti-player-stop"></i>';
  });
  function stopPreview() {
    if (!previewAudio.paused) previewAudio.pause();
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
  setInterval(fetchLatest, POLL_MS);
})();
