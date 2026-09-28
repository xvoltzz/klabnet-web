// ══════════════════════════════════════════
//  PHOTOS SLIDESHOW — full screen, made to be left running on a second
//  monitor or a TV.
//
//  Each photo fills the screen uncropped over a blur of itself, drifts
//  slowly (Ken Burns) and crossfades into the next; who took it, when and
//  the caption fade in at the bottom, a clock sits in the corner. The
//  controls and the cursor appear when the mouse moves and hide again.
//  It works through the whole library (loading older pages as it goes),
//  shows photos posted meanwhile next, keeps the screen awake, and only
//  ever holds two photos (the one showing and the one coming).
//
//  "Mine" narrows it to your own photos.
//
//  Keys: Space pause · ←/→ previous/next · I details · Esc exit. S opens
//  it from Photos (js/14-photos.js, which provides window.klabPhotos).
// ══════════════════════════════════════════
(function() {
  const KEY = 'klabnet_slideshow';
  const SPEEDS = [5, 8, 15, 30];
  const FADE_MS = 1400;           // the crossfade (--ss-fade in the CSS)
  const TRIM_EVERY = 40;          // slides between handing decoded photos back (desktop app)
  const opts = { secs: 8, shuffle: true, info: true, songs: false, mine: false };
  try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  if (!SPEEDS.includes(opts.secs)) opts.secs = 8;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} };
  const P = () => window.klabPhotos;
  const motion = () => (window.klabMotionOk ? window.klabMotionOk() : !matchMedia('(prefers-reduced-motion: reduce)').matches);

  let root = null, slides = [], front = 0;
  let deck = [], at = -1;          // photo ids in showing order, and where we are in it
  let known = new Set();           // every id the deck has seen (new ones go next)
  let timer = 0, uiTimer = 0, clockTimer = 0, loading = 0, shownCount = 0;
  let paused = false, isOpen = false, wake = null, lastId = null, token = 0;

  // ── The deck ──
  const byId = id => P().items().find(it => it.ph.id === id);
  const me = () => (window.KLAB_USER?.username || '').toLowerCase();
  // The photos it shows: everyone's, or with "Mine" only your own.
  const pool = () => P().items().filter(it => !opts.mine || (it.post.username || '').toLowerCase() === me());
  const hasMine = () => P().items().some(it => (it.post.username || '').toLowerCase() === me());
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // Newest first in order, or shuffled; either way starting on the photo
  // Photos was showing.
  function buildDeck(startId) {
    const ids = pool().map(it => it.ph.id).reverse();
    known = new Set(ids);
    if (opts.shuffle) shuffle(ids);
    const i = ids.indexOf(startId);
    if (i > 0) ids.unshift(ids.splice(i, 1)[0]);
    deck = ids;
    at = -1;
  }
  // Photos that turned up since (a new post, an older page): new posts
  // straight after the current one, older pages mixed into what's to come.
  function mergeNew() {
    const fresh = pool().map(it => it.ph.id).filter(id => !known.has(id));
    if (!fresh.length) return;
    fresh.forEach(id => known.add(id));
    const newest = pool().slice(-1)[0]?.ph.id;
    for (const id of fresh.reverse()) {
      if (id === newest || !opts.shuffle) deck.splice(at + 1, 0, id);
      else deck.splice(at + 1 + Math.floor(Math.random() * (deck.length - at)), 0, id);
    }
  }
  // Keeps the rest of the library coming, a page at a time, in the background.
  async function loadRest() {
    const t = ++loading;
    while (isOpen && t === loading && P().hasOlder()) {
      await P().loadOlder();
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // ── Building it ──
  function build() {
    root = document.createElement('div');
    root.className = 'ss';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Slideshow');
    root.innerHTML =
      '<div class="ss-slide"><div class="ss-fill"></div><img class="ss-img" alt="" draggable="false"></div>' +
      '<div class="ss-slide"><div class="ss-fill"></div><img class="ss-img" alt="" draggable="false"></div>' +
      '<div class="ss-shade"></div>' +
      '<div class="ss-clock" aria-hidden="true"><div class="t"></div><div class="d"></div></div>' +
      '<div class="ss-info"><div class="ss-who"></div><div class="ss-cap"></div></div>' +
      '<div class="ss-bar" role="toolbar" aria-label="Slideshow controls">' +
        '<button type="button" data-act="prev" title="Previous (←)" aria-label="Previous"><i class="ti ti-player-skip-back-filled"></i></button>' +
        '<button type="button" data-act="play" class="ss-play" title="Pause (Space)" aria-label="Pause"><i class="ti ti-player-pause-filled"></i></button>' +
        '<button type="button" data-act="next" title="Next (→)" aria-label="Next"><i class="ti ti-player-skip-forward-filled"></i></button>' +
        '<span class="ss-sep"></span>' +
        '<div class="ss-speed" role="group" aria-label="Seconds per photo">' + SPEEDS.map(s => `<button type="button" data-secs="${s}">${s}s</button>`).join('') + '</div>' +
        '<span class="ss-sep"></span>' +
        '<div class="ss-speed ss-whose" role="group" aria-label="Whose photos">' +
          '<button type="button" data-mine="0" title="Everyone\u2019s photos">Everyone</button>' +
          '<button type="button" data-mine="1" title="Only your photos">Mine</button>' +
        '</div>' +
        '<span class="ss-sep"></span>' +
        '<button type="button" data-act="shuffle" title="Shuffle" aria-label="Shuffle"><i class="ti ti-arrows-shuffle"></i></button>' +
        '<button type="button" data-act="info" title="Details (I)" aria-label="Details"><i class="ti ti-info-circle"></i></button>' +
        '<button type="button" data-act="songs" title="Play the photos’ songs" aria-label="Play the photos’ songs"><i class="ti ti-music"></i></button>' +
        '<span class="ss-sep"></span>' +
        '<button type="button" data-act="close" title="Exit (Esc)" aria-label="Exit"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="ss-progress"><i></i></div>';
    slides = [...root.querySelectorAll('.ss-slide')];
    root.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) { poke(); return; }
      SFX && SFX.play('click');
      const act = b.dataset.act;
      if (b.dataset.mine) setMine(b.dataset.mine === '1');
      else if (b.dataset.secs) { opts.secs = Number(b.dataset.secs); save(); syncBar(); restartTimer(); }
      else if (act === 'prev') step(-1);
      else if (act === 'next') step(1);
      else if (act === 'play') setPaused(!paused);
      else if (act === 'shuffle') { opts.shuffle = !opts.shuffle; save(); const id = deck[at]; buildDeck(id); at = 0; syncBar(); }
      else if (act === 'info') { opts.info = !opts.info; save(); syncBar(); }
      else if (act === 'songs') { opts.songs = !opts.songs; save(); syncBar(); applySong(); }
      else if (act === 'close') close();
      poke();
    });
    root.addEventListener('mousemove', poke);
    root.addEventListener('wheel', e => { e.preventDefault(); poke(); }, { passive: false });
    document.body.appendChild(root);
  }

  function syncBar() {
    root.classList.toggle('no-info', !opts.info);
    root.classList.toggle('paused', paused);
    root.style.setProperty('--ss-secs', opts.secs + 's');
    root.querySelectorAll('.ss-whose button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.mine === '1') === opts.mine)));
    root.querySelectorAll('.ss-speed:not(.ss-whose) button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.secs) === opts.secs)));
    const set = (act, on) => root.querySelector(`[data-act="${act}"]`).setAttribute('aria-pressed', String(on));
    set('shuffle', opts.shuffle); set('info', opts.info); set('songs', opts.songs);
    const play = root.querySelector('[data-act="play"]');
    play.innerHTML = `<i class="ti ${paused ? 'ti-player-play-filled' : 'ti-player-pause-filled'}"></i>`;
    play.title = paused ? 'Play (Space)' : 'Pause (Space)';
    play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  // The controls and the cursor come back when the mouse moves.
  function poke() {
    if (!root) return;
    root.classList.add('ui');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => { if (!root.querySelector('.ss-bar:hover')) root.classList.remove('ui'); else poke(); }, 2600);
  }

  function tickClock() {
    if (!root) return;
    const now = new Date();
    root.querySelector('.ss-clock .t').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    root.querySelector('.ss-clock .d').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ── Showing a photo ──
  async function show(id) {
    const it = byId(id);
    if (!it) return false;
    const t = ++token;
    const url = P().url(it.ph, true);
    const pre = new Image();
    pre.decoding = 'async';
    pre.src = url;
    try { await pre.decode(); } catch (e) { return false; }
    if (t !== token || !isOpen) return true;

    const next = slides[1 - front], cur = slides[front];
    const img = next.querySelector('.ss-img');
    img.src = url;
    const fill = next.querySelector('.ss-fill');
    fill.style.backgroundImage = `url("${P().url(it.ph, false)}")`;
    window.klabSoften?.(fill);
    // A drift to somewhere different each time.
    const rnd = (a, b) => (a + Math.random() * (b - a)).toFixed(1);
    img.style.setProperty('--kb-o', `${rnd(25, 75)}% ${rnd(25, 75)}%`);
    img.style.setProperty('--kb-s', rnd(1.06, 1.12));
    img.classList.remove('kb');
    void img.offsetWidth;
    if (motion()) img.classList.add('kb');
    next.classList.add('on');
    cur.classList.remove('on');
    front = 1 - front;
    // The one that went: its picture let go once the fade's over.
    setTimeout(() => { if (t === token && !cur.classList.contains('on')) { cur.querySelector('.ss-img').removeAttribute('src'); cur.querySelector('.ss-fill').style.backgroundImage = ''; } }, FADE_MS + 100);

    lastId = id;
    renderInfo(it.post);
    applySong();
    const bar = root.querySelector('.ss-progress i');
    bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    if (++shownCount % TRIM_EVERY === 0) window.klabnetDesktop?.trimMemory?.();
    return true;
  }

  function renderInfo(post) {
    const P_ = P();
    const date = post.shot_at ? P_.fmtShot(post.shot_at)
      : new Date(post.created.replace(' ', 'T') + 'Z').toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    const info = root.querySelector('.ss-info');
    info.classList.remove('show');
    const t = token;
    setTimeout(() => {
      if (!root || t !== token) return;
      root.querySelector('.ss-who').innerHTML =
        P_.avatarHTML(post.username) + `<span class="n" style="color:${profileColor(post.username)}">${esc(post.username)}</span><span class="m">${esc(date)}</span>`;
      root.querySelector('.ss-cap').textContent = post.text || '';
      info.classList.add('show');
    }, 700);
  }

  function applySong() {
    const it = byId(lastId);
    if (opts.songs && it?.post.song) { P().holdMusic(); P().playSong(it.post); }
    else { P().stopSong(); if (!opts.songs) P().releaseMusic(); }
  }

  // ── Moving along ──
  async function step(dir) {
    clearTimeout(timer);
    mergeNew();
    if (!deck.length) { restartTimer(); return; }
    // Up to three tries: a photo that won't load (deleted since) is skipped.
    for (let tries = 0; tries < 3; tries++) {
      at += dir;
      if (at >= deck.length) { const id = deck[deck.length - 1]; buildDeck(null); if (deck.length > 1 && deck[0] === id) deck.push(deck.shift()); at = 0; }
      if (at < 0) at = 0;
      if (await show(deck[at])) break;
    }
    restartTimer();
    preloadNext();
  }
  function restartTimer() {
    clearTimeout(timer);
    const bar = root?.querySelector('.ss-progress i');
    if (bar) { bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run'); }
    if (!paused && isOpen) timer = setTimeout(() => step(1), opts.secs * 1000);
  }
  // The next one downloaded ahead (not held decoded: that's show()'s job).
  let ahead = null;
  function preloadNext() {
    const id = deck[at + 1];
    const it = id != null && byId(id);
    ahead = it ? Object.assign(new Image(), { src: P().url(it.ph, true) }) : null;
  }
  // Everyone's or only mine: the deck starts over from the photo showing
  // (if it's still in it) or moves straight on to the first that is.
  function setMine(on) {
    if (on === opts.mine) return;
    if (on && !hasMine() && !P().hasOlder()) { showToast('You haven\u2019t posted any photos yet', 'ti-photo'); return; }
    opts.mine = on; save(); syncBar();
    buildDeck(lastId);
    if (deck[0] === lastId) at = 0;
    else step(1);
  }
  function setPaused(on) {
    paused = on;
    syncBar();
    if (paused) clearTimeout(timer); else restartTimer();
  }

  // ── Keys ──
  window.addEventListener('keydown', e => {
    if (!isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k') setPaused(!paused);
    else if (k === 'ArrowRight' || k === 'l') step(1);
    else if (k === 'ArrowLeft' || k === 'h') step(-1);
    else if (k === 'i') { opts.info = !opts.info; save(); syncBar(); }
    else if (k === 'Escape' || k === 's') close();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    poke();
  }, true);

  // Leaving full screen (Esc, the browser's own way out) ends it too.
  document.addEventListener('fullscreenchange', () => { if (isOpen && !document.fullscreenElement && root?._wentFull) close(); });
  document.addEventListener('visibilitychange', () => { if (isOpen && !document.hidden) keepAwake(); });

  async function keepAwake() {
    try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { wake = null; }
  }

  // ── Open / close ──
  function open() {
    if (isOpen || !P() || !P().items().length) return;
    isOpen = true;
    paused = false;
    shownCount = 0;
    build();
    syncBar();
    tickClock();
    clockTimer = setInterval(tickClock, 15000);
    document.body.classList.add('ss-on');
    requestAnimationFrame(() => root.classList.add('open'));
    // "Mine" left on from last time, with nothing of yours to show.
    if (opts.mine && !hasMine() && !P().hasOlder()) { opts.mine = false; save(); syncBar(); }
    buildDeck(P().current());
    // Full screen where the browser allows it (it needs this click/key).
    root.requestFullscreen?.().then(() => { root._wentFull = true; }).catch(() => {});
    keepAwake();
    step(1);
    loadRest();
    poke();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    loading++;
    token++;
    clearTimeout(timer); clearTimeout(uiTimer); clearInterval(clockTimer);
    P().stopSong();
    try { wake?.release(); } catch (e) {}
    wake = null;
    ahead = null;
    if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
    document.body.classList.remove('ss-on');
    const el = root;
    root = null;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 400);
    if (lastId != null) P().show(lastId);
    // Every photo it showed was decoded at full screen size.
    window.klabnetDesktop?.trimMemory?.();
  }

  window.klabSlideshow = { open, close, isOpen: () => isOpen };
})();
