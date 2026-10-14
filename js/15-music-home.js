// ══════════════════════════════════════════
//  MUSIC HOME — the Music tab's Home view, as a front page for the library
//  rather than a list of random songs:
//    Jump back in     a mix of tiles: what you had on lately, artists you
//                     play a lot, albums you haven't touched in a while,
//                     a playlist of yours
//    Recently added   a Cover Flow of the newest albums
//    Listen history   albums from your own play history, newest first
//    Featured playlists  the ones people have featured (09b-playlists.js)
//    Most played      the library's most-played albums (every visitor plays
//                     through the one shared Navidrome account, so this is
//                     site-wide)
//    Shuffle picks    the random songs Home used to be, as a wheel you spin,
//                     with a reshuffle
//  loadPickerTab('random') hands its songs to klabRenderMusicHome().
// ══════════════════════════════════════════
(function() {
  const REFRESH_MS = 10 * 60 * 1000;
  const art = (id, size) => `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}`;
  // Cover Flow draws covers up to 600px across: ask for enough pixels for
  // this screen (in steps of 300, so Navidrome's resize cache stays small).
  const flowArt = id => art(id, Math.min(1200, Math.ceil(600 * (window.devicePixelRatio || 1) / 300) * 300));

  async function albumList(type, size) {
    const r = await fetchTimeout(`${ND_URL}/rest/getAlbumList2?type=${type}&size=${size}&${subsonicParams()}`, {}, 8000);
    return (await r.json())['subsonic-response']?.albumList2?.album || [];
  }

  async function playAlbum(albumId) {
    const mark = klabPickMark();
    try {
      const r = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${encodeURIComponent(albumId)}&${subsonicParams()}`, {}, 8000);
      const songs = (await r.json())['subsonic-response']?.album?.song || [];
      if (!songs.length || klabPickMark() !== mark) return;
      playerState.playlist = songs; playerState.playlistIndex = 0;
      playSong(songs[0]);
      SFX && SFX.play('click');
    } catch (e) { showToast('Couldn’t play that album', 'ti-alert-triangle'); }
  }
  const openAlbum = a => window.openAlbumPage && window.openAlbumPage(a.id, a.name || a.title);

  function fmtAdded(iso) {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 1) return 'added today';
    if (days < 2) return 'added yesterday';
    if (days < 30) return `added ${days} days ago`;
    return 'added ' + new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ══ Cover Flow ══
  // One component, two places: Home's recently added albums, and Now
  // Playing (what you heard, what's on, what's next). The caller gives it
  // items and says how each one looks and what its buttons do:
  //   cover(item)          image URL
  //   caption(item, i)     { k, t, a }: a small label, title, detail line
  //   actions(item, i)     [{ label, icon, primary, run }] under the caption
  //   open(item, i)        a click (or Enter) on the middle cover
  //   decorate(coverEl, item)  e.g. for its right-click menu
  //   scrollbar            an iTunes-style scrollbar under it
  //   hires(item)          Promise of a sharper image URL for the cover,
  //                        swapped in once it's decoded (display only)
  // caption may also return eq: true (a playing glyph before the label) and
  // node: an element of its own to show under the detail line.
  // It keeps one element, so it keeps its place and covers between visits.
  function makeCoverFlow({ label, cover, caption, actions, open, decorate, coverSize, scrollbar, hires }) {
    const el = document.createElement('section');
    el.className = 'mh-flow';
    el.tabIndex = 0;
    el.setAttribute('aria-label', label);
    el.innerHTML =
      '<div class="mh-flow-bg"></div><div class="mh-flow-bg"></div>' +
      '<div class="mh-flow-stage"></div>' +
      '<button type="button" class="mh-flow-nav prev" title="Previous"><i class="ti ti-chevron-left"></i></button>' +
      '<button type="button" class="mh-flow-nav next" title="Next"><i class="ti ti-chevron-right"></i></button>' +
      '<div class="mh-flow-caption"><div class="k"></div><div class="t"></div><div class="a"></div><div class="x"></div><div class="mh-flow-actions"></div></div>' +
      (scrollbar ? '<div class="mh-flow-scroll" aria-hidden="true"><div class="mh-flow-thumb"></div></div>' : '');
    const stage = el.querySelector('.mh-flow-stage');
    const bgs = el.querySelectorAll('.mh-flow-bg');
    const capK = el.querySelector('.mh-flow-caption .k'), capT = el.querySelector('.mh-flow-caption .t');
    const capA = el.querySelector('.mh-flow-caption .a'), capActs = el.querySelector('.mh-flow-actions');
    const capX = el.querySelector('.mh-flow-caption .x');
    const track = el.querySelector('.mh-flow-scroll'), thumb = el.querySelector('.mh-flow-thumb');
    let items = [], covers = [], keys = '';
    let pos = 0, target = 0, raf = 0, idle = 0, center = -1, bgOn = 0;

    // Worked out when the size of things changes, not every frame: reading
    // the element's size mid-animation forced a layout of the whole page on
    // each frame, and rewriting the size variables restyled every cover.
    let S = 0;
    const measure = () => { S = coverSize ? coverSize(el) : (matchMedia(KLAB_PHONE_MQ).matches ? 150 : 230); };
    const size = () => S || (measure(), S);
    let appliedS = 0;
    function applySize() {
      if (appliedS === S) return;
      appliedS = S;
      stage.style.setProperty('--mh-size', S + 'px');
      el.style.setProperty('--mh-h', S + 'px');
      el.style.setProperty('--mh-size', S + 'px');
    }
    new ResizeObserver(() => { if (!el.isConnected) return; const was = S; measure(); sizeThumb(); if (S !== was) render(); else placeThumb(); }).observe(el);
    const clamp = x => Math.max(0, Math.min(items.length - 1, x));

    function build() {
      stage.textContent = '';
      covers = items.map((it, i) => {
        const c = document.createElement('div');
        c.className = 'mh-cover';
        c.dataset.i = i;
        decorate?.(c, it);
        const img = new Image();
        img.alt = ''; img.draggable = false; img.decoding = 'async';
        img.onload = () => img.classList.add('loaded');
        // The picture is only asked for once the cover first comes into view
        // (render()): a flow holds ~50 covers and shows about 11.
        c._src = cover(it);
        c.appendChild(img);
        // Its reflection: a flipped, faded copy inside the cover's own
        // layer, drawn once and carried along. (-webkit-box-reflect redrew
        // a mirror image on every frame of every glide.)
        const refl = new Image();
        refl.className = 'mh-refl';
        refl.alt = ''; refl.draggable = false; refl.decoding = 'async';
        refl.onload = () => refl.classList.add('loaded');
        c.appendChild(refl);
        c._img = img; c._refl = refl; c._item = it;
        stage.appendChild(c);
        return c;
      });
      center = -1;
      render();
    }

    function showCaption() {
      const it = items[center];
      if (!it) return;
      const cap = caption(it, center);
      capK.replaceChildren(...(cap.eq ? [eqGlyph()] : []), cap.k || ''); capK.hidden = !cap.k;
      capX.replaceChildren(...(cap.node ? [cap.node] : [])); capX.hidden = !cap.node;
      capT.textContent = cap.t || '';
      capA.textContent = cap.a || '';
      capActs.replaceChildren(...(actions?.(it, center) || []).map(a => {
        const b = document.createElement('button');
        b.type = 'button';
        if (a.primary) b.className = 'mh-flow-play';
        b.innerHTML = (a.icon ? '<i class="ti ' + a.icon + '"></i> ' : '');
        b.append(a.label);
        b.addEventListener('click', () => a.run(it, center));
        return b;
      }));
    }

    // Each cover's place is a function of its distance from the centre, d:
    // the middle one faces you, the rest fold back at an angle and stack.
    function render() {
      size();
      applySize();
      for (let i = 0; i < covers.length; i++) {
        const c = covers[i];
        const d = i - pos, ad = Math.abs(d), sg = Math.sign(d);
        // Five either side: the ones further out are slivers anyway, and
        // every one is a big layer for the GPU to move each frame.
        if (ad > 5.5) { if (c._on !== false) { c.style.display = 'none'; c._on = false; } continue; }
        if (c._on !== true) {
          c.style.display = ''; c._on = true;
          if (c._src) { c._img.src = c._src; c._refl.src = c._src; c._src = ''; }
          if (hires && !c._hi) sharpen(c);
        }
        let x, rot, z;
        if (ad < 1) { x = d * S * 0.66; rot = -d * 62; z = -ad * S * 0.55; }
        else { x = sg * (S * 0.66 + (ad - 1) * S * 0.24); rot = -sg * 62; z = -S * 0.55; }
        c.style.transform = `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${rot.toFixed(1)}deg)`;
        const zi = 100 - Math.round(ad * 10);
        if (c._z !== zi) { c.style.zIndex = String(zi); c._z = zi; }   // restacking repaints; only when it changes
        const op = ad > 4.5 ? String(Math.max(0, 5.5 - ad)) : '';
        if (c._op !== op) { c.style.opacity = op; c._op = op; }
      }
      placeThumb();
      const ci = Math.round(pos);
      if (ci !== center && items[ci]) {
        center = ci;
        covers.forEach((c, i) => c.classList.toggle('center', i === ci));
        showCaption();
      }
    }

    // The first time a cover comes into view, ask for its art at high
    // resolution; it replaces the cover (and its reflection) once decoded,
    // so there's never a flash or a half-drawn image.
    function sharpen(c) {
      c._hi = true;
      Promise.resolve(hires(c._item)).then(u => {
        if (!u || !c.isConnected) return;
        const pre = new Image();
        pre.decoding = 'async';
        pre.src = u;
        return pre.decode().then(() => {
          if (!c.isConnected) return;
          c._img.src = u; c._refl.src = u;
          c._img.classList.add('loaded'); c._refl.classList.add('loaded');
        });
      }).catch(() => {});
    }

    // ── The scrollbar ──
    // The thumb is as wide as the part of the list in view and slides with
    // the flow (a transform, so it costs nothing per frame). Drag it to
    // fly through; click the track to glide to that spot.
    let trackW = 0, thumbW = 0;
    function sizeThumb() {
      if (!track) return;
      trackW = track.clientWidth;
      thumbW = Math.max(44, Math.min(trackW * 0.5, trackW * 11 / Math.max(items.length, 1)));
      thumb.style.width = thumbW + 'px';
      track.hidden = items.length < 2;
    }
    function placeThumb() {
      if (!track || !trackW) return;
      const f = items.length > 1 ? pos / (items.length - 1) : 0;
      thumb.style.transform = `translateX(${(f * (trackW - thumbW)).toFixed(1)}px)`;
    }
    if (track) {
      const at = e => {
        const r = track.getBoundingClientRect(), z = zoomFactor();
        return Math.max(0, Math.min(1, ((e.clientX - r.left) / z - thumbW / 2) / Math.max(1, trackW - thumbW)));
      };
      let dragging = false;
      thumb.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        dragging = true; thumb.setPointerCapture(e.pointerId); track.classList.add('dragging');
      });
      thumb.addEventListener('pointermove', e => {
        if (!dragging) return;
        target = at(e) * (items.length - 1);
        kick();
      });
      const release = () => { if (!dragging) return; dragging = false; track.classList.remove('dragging'); go(target); };
      thumb.addEventListener('pointerup', release);
      thumb.addEventListener('pointercancel', release);
      track.addEventListener('pointerdown', e => {
        if (e.target === thumb || e.button !== 0) return;
        go(at(e) * (items.length - 1));
      });
    }

    // The blurred cover behind the flow, crossfaded once it comes to rest
    // (a full-width blur repainted every frame is the expensive thing here).
    function setBg() {
      const it = items[center];
      const src = it && cover(it);
      if (!src) return;
      const next = bgs[1 - bgOn];
      next.style.backgroundImage = `url("${src.replace(/size=\d+/, 'size=200')}")`;
      window.klabSoften?.(next);
      next.classList.add('on');
      bgs[bgOn].classList.remove('on');
      bgOn = 1 - bgOn;
    }

    function tick() {
      const d = target - pos;
      pos = Math.abs(d) < 0.002 ? target : pos + d * 0.2;
      render();
      raf = pos !== target ? requestAnimationFrame(tick) : 0;
      if (!raf) setBg();
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    function go(i) { target = clamp(Math.round(i)); kick(); }

    el.querySelector('.prev').addEventListener('click', () => go(target - 1));
    el.querySelector('.next').addEventListener('click', () => go(target + 1));

    // Sideways trackpad swipes glide through it. A vertical wheel is left
    // alone, so a mouse still scrolls the page past it.
    el.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      target = clamp(target + e.deltaX / (size() * 0.45));
      kick();
      clearTimeout(idle);
      idle = setTimeout(() => go(target), 140);
    }, { passive: false });

    // Drag it; a tap on a side cover brings it to the middle, a tap on the
    // middle one opens it.
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, start: target, moved: false, id: e.pointerId, z: zoomFactor() };
    });
    // Released outside the stage without having dragged: forget the press.
    window.addEventListener('pointerup', () => { if (drag && !drag.moved) drag = null; });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / drag.z; // pointer px are zoomed on big screens
      if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; stage.setPointerCapture(drag.id); el.classList.add('dragging'); }
      if (!drag.moved) return;
      target = clamp(drag.start - dx / (size() * 0.45));
      kick();
    });
    const end = e => {
      if (!drag) return;
      el.classList.remove('dragging');
      if (drag.moved) go(target);
      else {
        const c = e.target.closest('.mh-cover');
        if (c) {
          const i = Number(c.dataset.i);
          if (i === center) open?.(items[i], i); else go(i);
        }
      }
      drag = null;
    };
    stage.addEventListener('pointerup', end);
    // A cancelled press (the page took the touch to scroll) is never a tap.
    stage.addEventListener('pointercancel', () => {
      if (!drag) return;
      el.classList.remove('dragging');
      if (drag.moved) go(target);
      drag = null;
    });

    // Arrow keys while it has focus. Stopped here so they don't also skip
    // tracks, which is what ←/→ do everywhere else.
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') go(target - 1);
      else if (e.key === 'ArrowRight') go(target + 1);
      else if (e.key === 'Enter' && items[center]) open?.(items[center], center);
      else return;
      e.preventDefault(); e.stopPropagation();
    });

    window.addEventListener('resize', () => { if (el.isConnected) { measure(); sizeThumb(); render(); } });

    // New items. The covers are only rebuilt when the list really changed
    // (keyOf), and it lands on `at`: gliding from `from` when given (Now
    // Playing sliding on to the next song), otherwise straight there.
    function set(next, at = 0, { keyOf = (it, i) => i, from } = {}) {
      const k = next.map(keyOf).join('|');
      items = next;
      el.hidden = !items.length;
      if (!items.length) { stage.textContent = ''; covers = []; keys = ''; return; }
      const fresh = k !== keys;
      keys = k;
      if (fresh) {
        cancelAnimationFrame(raf); raf = 0;
        pos = clamp(from ?? at); target = clamp(at);
        sizeThumb();
        build();
        if (pos !== target) kick(); else setBg();
      } else {
        target = clamp(at);
        showCaption();   // the same items, but what the buttons say may differ (play/pause)
        kick();
      }
    }
    return { el, set, go, render, refreshCaption: showCaption };
  }
  window.klabCoverFlow = makeCoverFlow;

  // Little equalizer bars: "this one, playing now".
  function eqGlyph() {
    const s = document.createElement('span');
    s.className = 'mh-eq';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<i></i><i></i><i></i><i></i>';
    return s;
  }

  // Home's: recently added albums.
  const flow = (() => {
    let loadedAt = 0, albums = [];
    const f = makeCoverFlow({
      label: 'Recently added albums',
      cover: a => flowArt(a.coverArt || a.id),
      caption: a => ({ t: a.name || a.title || '', a: [a.artist, a.year, fmtAdded(a.created)].filter(Boolean).join(' · ') }),
      actions: a => [
        { label: 'Play', icon: 'ti-player-play-filled', primary: true, run: () => playAlbum(a.id) },
        { label: 'Open album', run: () => openAlbum(a) },
      ],
      open: a => openAlbum(a),
      decorate: (c, a) => { c._album = a; },
      hires: a => window.klabHiResArt?.({ albumId: a.id, artist: a.artist || '', album: a.name || a.title || '', mbid: a.musicBrainzId || '' }).then(r => r && r.large),
    });
    async function load() {
      if (albums.length && Date.now() - loadedAt < REFRESH_MS) { f.render(); return; }
      try {
        const fresh = await albumList('newest', 30);
        loadedAt = Date.now();
        // The same albums: leave it where you'd flicked it to.
        if (albums.length && fresh.map(a => a.id).join() === albums.map(a => a.id).join()) { f.render(); return; }
        albums = fresh;
        f.set(albums, 0, { keyOf: a => a.id });
      } catch (e) { if (!albums.length) f.el.hidden = true; }
    }
    return { el: f.el, load };
  })();

  // Home is rebuilt on every visit and a reshuffle swaps the wheel. What the
  // old pieces were observing is let go here; an observer on the document
  // otherwise kept each old wheel, canvas and covers alive for good.
  const cleanups = new Set();
  const onCleanup = fn => { const f = () => { cleanups.delete(f); fn(); }; cleanups.add(f); return f; };

  // ══ Rows of cards ══
  function cardRow(title, cards, note) {
    const sec = document.createElement('section');
    sec.className = 'mh-section';
    sec.innerHTML = `<div class="picker-section-label">${esc(title)}${note ? ` <span class="mh-note">${esc(note)}</span>` : ''}</div>` +
      '<div class="mh-row-wrap"><div class="mh-row"></div>' +
      '<button type="button" class="mh-row-nav prev" title="Back"><i class="ti ti-chevron-left"></i></button>' +
      '<button type="button" class="mh-row-nav next" title="More"><i class="ti ti-chevron-right"></i></button></div>';
    const row = sec.querySelector('.mh-row');
    const wrap = sec.querySelector('.mh-row-wrap');
    // Which edges have more to scroll to: drives the arrows and the fades.
    const edges = () => {
      wrap.classList.toggle('more-l', row.scrollLeft > 4);
      wrap.classList.toggle('more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    };
    row.addEventListener('scroll', edges, { passive: true });
    const ro = new ResizeObserver(edges);
    ro.observe(row);
    onCleanup(() => ro.disconnect());
    const page = dir => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
    sec.querySelector('.mh-row-nav.prev').addEventListener('click', () => page(-1));
    sec.querySelector('.mh-row-nav.next').addEventListener('click', () => page(1));
    row.append(...cards);
    return sec;
  }
  function albumCard(a) {
    const card = document.createElement('div');
    card.className = 'mh-card';
    card._album = a; // right-click menu (09-music-extras.js)
    card.innerHTML =
      `<div class="mh-card-art"><img src="${esc(art(a.coverArt || a.id, 300))}" alt="" loading="lazy" decoding="async" draggable="false" onload="this.classList.add('loaded')" />` +
      `<button type="button" class="mh-card-play" title="Play"><i class="ti ti-player-play-filled"></i></button></div>` +
      `<div class="mh-card-t">${esc(a.name || a.title || '')}</div><div class="mh-card-a">${esc(a.artist || '')}</div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.mh-card-play')) { playAlbum(a.id); return; }
      openAlbum(a);
    });
    return card;
  }
  const albumRow = (title, albums, note) => cardRow(title, albums.map(albumCard), note);

  // Albums from your own play history, most recent first.
  function listenHistory() {
    const seen = new Set(), out = [];
    for (const s of getPlayHistory()) {
      if (!s.albumId || seen.has(s.albumId)) continue;
      seen.add(s.albumId);
      out.push({ id: s.albumId, name: s.album, artist: s.artist, coverArt: s.coverArt || s.albumId });
      if (out.length >= 16) break;
    }
    return out;
  }

  // ══ Jump back in ══
  // Play history is the last 50 songs and no more, so on its own it can
  // only say what you had on lately. This keeps a longer memory beside it:
  // per album, how often and when you last played it. That's what lets
  // Jump back in bring up something you used to play and haven't in a
  // while. Kept in this browser (it's too big to send with prefs after
  // every song); favourites fill in until it has something to say.
  const TALLY_KEY = 'klabnet_listen_tally', TALLY_MAX = 400;
  const DAY = 86400000;
  function getTally() {
    try { const t = JSON.parse(localStorage.getItem(TALLY_KEY) || '{}'); return t && typeof t === 'object' ? t : {}; } catch (e) { return {}; }
  }
  const _jumpAddHistory = addToPlayHistory;
  addToPlayHistory = function(song) {
    _jumpAddHistory(song);
    if (!song?.albumId) return;
    try {
      const t = getTally();
      const e = t[song.albumId] || { n: 0 };
      t[song.albumId] = { n: e.n + 1, t: Date.now(), name: song.album || '', artist: song.artist || '', artistId: song.artistId || '', coverArt: song.coverArt || song.albumId };
      const ids = Object.keys(t);
      if (ids.length > TALLY_MAX) ids.sort((a, b) => t[a].t - t[b].t).slice(0, ids.length - TALLY_MAX).forEach(id => delete t[id]);
      localStorage.setItem(TALLY_KEY, JSON.stringify(t));
    } catch (e) {}
  };

  // The mix is the same every time you come back to Home, and a new one
  // each day and each time klabnet is opened.
  const jumpSeed = Math.floor(Math.random() * 1e9);
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // A few of `items`, the better-scored ones more likely.
  function pickSome(items, n, rnd) {
    const pool = items.slice(), out = [];
    while (pool.length && out.length < n) {
      const total = pool.reduce((sum, x) => sum + x.w, 0);
      let r = rnd() * total, i = 0;
      while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }
  function fmtAgo(ts) {
    const days = Math.floor((Date.now() - ts) / DAY);
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return 'over a year ago';
  }

  const JUMP_MAX = 8;
  // Which kind goes where, so the tiles read as a mix and not three groups.
  const JUMP_ORDER = ['recent', 'artist', 'old', 'recent', 'playlist', 'old', 'artist', 'recent'];
  function jumpItems() {
    const rnd = seeded(jumpSeed + Math.floor(Date.now() / DAY));
    const hist = getPlayHistory().filter(Boolean), favs = getFavorites().filter(Boolean), tally = getTally();
    const now = Date.now();

    const recentAlbums = listenHistory();
    const recentIds = new Set(recentAlbums.map(a => a.id));
    const recent = recentAlbums.map(a => ({ kind: 'album', album: a, sub: a.artist || 'Album' }));

    // Not played lately: albums you used to play (the more, and the longer
    // ago, the likelier) and albums your favourites are from.
    const olds = new Map();
    for (const [id, e] of Object.entries(tally)) {
      if (recentIds.has(id) || now - e.t < 7 * DAY) continue;
      olds.set(id, { kind: 'album', album: { id, name: e.name, artist: e.artist, coverArt: e.coverArt },
        sub: `Last played ${fmtAgo(e.t)}`, w: Math.min(e.n, 12) * Math.min((now - e.t) / (30 * DAY), 3) + 1 });
    }
    for (const s of favs) {
      if (!s.albumId || recentIds.has(s.albumId) || (tally[s.albumId] && now - tally[s.albumId].t < 7 * DAY)) continue;
      const o = olds.get(s.albumId);
      if (o) o.w += 1;
      else olds.set(s.albumId, { kind: 'album', album: { id: s.albumId, name: s.album, artist: s.artist, coverArt: s.coverArt || s.albumId }, sub: 'From your favorites', w: 1, fav: 1 });
    }
    // An album with a few favourites on it over one with a single song.
    for (const o of olds.values()) if (o.fav) o.w = Math.min(o.w, 6);

    // Artists: the ones your history, favourites and tally keep coming back to.
    const artists = new Map();
    const credit = (id, name, coverArt, w) => {
      if (!id || !name || /^various artists$/i.test(name)) return;
      const a = artists.get(id) || { kind: 'artist', artist: { id, name }, coverArt, sub: 'Artist', w: 0 };
      a.w += w; a.coverArt = a.coverArt || coverArt;
      artists.set(id, a);
    };
    hist.forEach(s => credit(s.artistId, s.artist, s.coverArt, 3));
    favs.forEach(s => credit(s.artistId, s.artist, s.coverArt, 1));
    Object.values(tally).forEach(e => credit(e.artistId, e.artist, e.coverArt, Math.min(e.n, 10)));
    const topArtists = [...artists.values()].sort((a, b) => b.w - a.w).slice(0, 10);

    const playlists = (window.klabPlaylists?.mine?.() || []).filter(p => p.count)
      .map(p => ({ kind: 'playlist', playlist: p, sub: `Playlist · ${klabCount(p.count, 'song')}`, w: 1 }));

    const from = {
      recent: recent.slice(0, 3),
      artist: pickSome(topArtists, 2, rnd),
      old: pickSome([...olds.values()], 2, rnd),
      playlist: pickSome(playlists, 1, rnd),
    };
    // What fills a place its kind can't: more of anything, the older stuff first.
    const spare = [...pickSome([...olds.values()].filter(o => !from.old.includes(o)), JUMP_MAX, rnd), ...recent.slice(3),
      ...topArtists.filter(a => !from.artist.includes(a)), ...playlists.filter(p => !from.playlist.includes(p))];
    const out = [];
    for (const kind of JUMP_ORDER) { const it = from[kind].shift() || spare.shift(); if (it) out.push(it); }
    return out;
  }

  // An artist's picture, asked for once. Until it's here (and when they
  // have none) the tile shows one of their covers.
  const artistPics = new Map();
  function artistPic(id) {
    if (!artistPics.has(id)) artistPics.set(id, fetchTimeout(`${ND_URL}/rest/getArtistInfo2?id=${encodeURIComponent(id)}&count=1&${subsonicParams()}`, {}, 8000)
      .then(r => r.json()).then(j => {
        const info = j['subsonic-response']?.artistInfo2;
        const url = info?.mediumImageUrl || info?.largeImageUrl || '';
        return url.includes('2a96cbd8b46e442fc41c2b86b821562f') ? '' : url; // Last.fm's blank star
      }).catch(() => ''));
    return artistPics.get(id);
  }

  function jumpTile(it) {
    const tile = document.createElement('div');
    tile.className = 'mh-jump-tile ' + it.kind;
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    const name = it.kind === 'album' ? it.album.name : it.kind === 'artist' ? it.artist.name : it.playlist.name;
    const coverArt = it.kind === 'album' ? it.album.coverArt || it.album.id : it.coverArt;
    tile.innerHTML =
      '<div class="mh-jump-art">' + (it.kind !== 'playlist' && coverArt
        ? `<img src="${esc(art(coverArt, 150))}" alt="" loading="lazy" decoding="async" draggable="false" onload="this.classList.add('loaded')" />` : '') + '</div>' +
      `<div class="mh-jump-tx"><div class="t">${esc(name || 'Unknown')}</div><div class="a">${esc(it.sub)}</div></div>` +
      (it.kind === 'artist' ? '' : '<button type="button" class="mh-card-play" title="Play"><i class="ti ti-player-play-filled"></i></button>');
    const artEl = tile.querySelector('.mh-jump-art');
    if (it.kind === 'album') tile._album = it.album; // right-click menus (09-music-extras.js)
    else if (it.kind === 'playlist') { tile._playlist = it.playlist; artEl.appendChild(window.klabPlaylists.art(it.playlist, '', 64)); }
    else {
      tile._artist = it.artist;
      if (!coverArt) artEl.innerHTML = artistPlaceholderHTML(it.artist.name);
      artistPic(it.artist.id).then(url => {
        if (!url || !tile.isConnected) return;
        const img = new Image();
        img.alt = ''; img.decoding = 'async'; img.draggable = false; img.className = 'loaded';
        img.onload = () => { if (tile.isConnected) artEl.replaceChildren(img); };
        img.src = url;
      });
    }
    const open = () => {
      SFX && SFX.play('nav');
      if (it.kind === 'album') openAlbum(it.album);
      else if (it.kind === 'artist') window.openArtistPage?.(it.artist.id, it.artist.name);
      else window.openPlaylistPage?.(it.playlist.id, it.playlist.name);
    };
    tile.addEventListener('click', e => {
      if (!e.target.closest('.mh-card-play')) { open(); return; }
      if (it.kind === 'album') playAlbum(it.album.id); else window.klabPlaylists.play(it.playlist);
    });
    tile.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === tile) open(); });
    return tile;
  }
  function jumpSection() {
    const items = jumpItems();
    // One tile alone isn't a section.
    if (items.length < 2) return null;
    const sec = document.createElement('section');
    sec.className = 'mh-section mh-jump';
    sec.innerHTML = '<div class="picker-section-label">Jump back in</div><div class="mh-jump-grid"></div>';
    sec.querySelector('.mh-jump-grid').append(...items.map(jumpTile));
    return sec;
  }

  // ══ Shuffle wheel ══
  // Shuffle picks as a prize wheel: a slice of album art per song, a
  // pointer at the top that flaps and ticks as slices go by. Spin it (the
  // hub, a tap, or a flick) and whatever it lands on plays, with the rest
  // of the picks queued after it.
  const WHEEL_MAX = 12;
  const TAU = Math.PI * 2;
  const mod = (x, m) => ((x % m) + m) % m;

  function shuffleWheel(allSongs) {
    // Distinct covers first, so neighbouring slices don't look identical.
    const seen = new Set(), songs = [];
    for (const s of allSongs) if (songs.length < WHEEL_MAX && !seen.has(s.coverArt)) { seen.add(s.coverArt); songs.push(s); }
    for (const s of allSongs) if (songs.length < WHEEL_MAX && !songs.includes(s)) songs.push(s);
    const n = songs.length, slice = TAU / n;

    const el = document.createElement('section');
    el.className = 'mh-wheel';
    el.innerHTML =
      '<div class="mh-wheel-stage">' +
        '<canvas class="mh-wheel-canvas" role="img"></canvas>' +
        '<div class="mh-wheel-pointer" aria-hidden="true"></div>' +
        '<button type="button" class="mh-wheel-spin">SPIN</button>' +
      '</div>' +
      '<div class="mh-wheel-result" aria-live="polite">' +
        '<div class="k">Spin the wheel</div>' +
        '<div class="mh-wheel-pick"><img class="mh-wheel-art" alt="" hidden />' +
          '<div class="mh-wheel-tx"><div class="t"></div><div class="a"></div></div></div>' +
        '<div class="mh-flow-actions" hidden><button type="button" class="mh-flow-play"><i class="ti ti-player-play-filled"></i> Play</button>' +
          '<button type="button" class="mh-wheel-open">Open album</button></div>' +
      '</div>';
    const stage = el.querySelector('.mh-wheel-stage');
    const canvas = el.querySelector('canvas');
    const pointer = el.querySelector('.mh-wheel-pointer');
    const spinBtn = el.querySelector('.mh-wheel-spin');
    const kEl = el.querySelector('.k'), tEl = el.querySelector('.t'), aEl = el.querySelector('.a');
    const artEl = el.querySelector('.mh-wheel-art'), actions = el.querySelector('.mh-flow-actions');
    const g = canvas.getContext('2d');
    canvas.setAttribute('aria-label', `Shuffle wheel with ${n} songs`);
    tEl.textContent = `${n} shuffle picks`;
    aEl.textContent = 'Hit spin, or give it a flick';

    let angle = Math.random() * TAU; // canvas radians; slice i starts at angle + i*slice
    let winner = -1, spinning = false, raf = 0, lastSeg = null, flap = null;
    let colors = null, px = 0;

    const imgs = songs.map(s => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (!spinning) draw(); };
      img.src = art(s.coverArt, 300);
      return img;
    });

    // The slice sitting under the pointer (straight up).
    const under = a => Math.floor(mod(-Math.PI / 2 - a, TAU) / slice) % n;

    function readColors() {
      const cs = getComputedStyle(el);
      const rgb = cs.getPropertyValue('--accent-rgb').trim() || '200,195,188';
      colors = { rgb, text: cs.getPropertyValue('--text').trim() || '#e8e6e1', bg: cs.getPropertyValue('--bg').trim() || '#000' };
    }

    function size() {
      const css = stage.clientWidth;
      if (!css) return false;
      // On the big-screen zoom tiers the page is CSS-zoomed, which
      // devicePixelRatio doesn't include: sized without it, the backing
      // store was stretched up and blurry.
      const want = Math.round(css * zoomFactor() * (window.devicePixelRatio || 1));
      if (want !== px) { px = want; canvas.width = canvas.height = px; }
      return true;
    }

    function draw() {
      if (!size()) return;
      if (!colors) readColors();
      const c = px / 2, rim = px * 0.035, r = c - rim;
      g.clearRect(0, 0, px, px);

      for (let i = 0; i < n; i++) {
        const a0 = angle + i * slice, a1 = a0 + slice;
        g.save();
        g.beginPath(); g.moveTo(c, c); g.arc(c, c, r, a0, a1); g.closePath(); g.clip();
        g.fillStyle = `rgba(${colors.rgb},${i % 2 ? 0.16 : 0.07})`;
        g.fillRect(0, 0, px, px);
        const img = imgs[i];
        if (img.complete && img.naturalWidth) {
          // A square of art covering the wedge, its top pointing outward.
          const L = Math.max(r, 2 * r * Math.sin(Math.min(slice, Math.PI) / 2)) * 1.04;
          g.translate(c, c); g.rotate(a0 + slice / 2 + Math.PI / 2);
          g.drawImage(img, -L / 2, -r / 2 - L / 2, L, L);
        }
        g.restore();
        if (winner >= 0 && i !== winner) {
          g.save();
          g.beginPath(); g.moveTo(c, c); g.arc(c, c, r, a0, a1); g.closePath();
          g.fillStyle = 'rgba(0,0,0,.55)'; g.fill();
          g.restore();
        }
      }

      // Spokes between slices.
      g.save();
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = Math.max(1, px * 0.004);
      for (let i = 0; i < n; i++) {
        const a = angle + i * slice;
        g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke();
      }
      g.restore();

      // Soft shine across the top, like the rest of klabnet's glass.
      const shine = g.createLinearGradient(0, 0, 0, px);
      shine.addColorStop(0, 'rgba(255,255,255,.16)'); shine.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.beginPath(); g.arc(c, c, r, 0, TAU); g.fillStyle = shine; g.fill();

      // Rim, with a peg at every slice boundary.
      g.beginPath(); g.arc(c, c, r + rim / 2, 0, TAU);
      g.lineWidth = rim; g.strokeStyle = colors.text; g.stroke();
      g.beginPath(); g.arc(c, c, r, 0, TAU);
      g.lineWidth = Math.max(1, px * 0.004); g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
      g.fillStyle = colors.bg;
      for (let i = 0; i < n; i++) {
        const a = angle + i * slice;
        g.beginPath(); g.arc(c + Math.cos(a) * (r + rim / 2), c + Math.sin(a) * (r + rim / 2), rim * 0.28, 0, TAU); g.fill();
      }

      if (winner >= 0) {
        const a0 = angle + winner * slice;
        g.save();
        g.beginPath(); g.moveTo(c, c); g.arc(c, c, r, a0, a0 + slice); g.closePath();
        g.lineWidth = Math.max(2, px * 0.012); g.strokeStyle = `rgba(${colors.rgb},.95)`;
        g.shadowColor = `rgba(${colors.rgb},.8)`; g.shadowBlur = px * 0.03;
        g.stroke();
        g.restore();
      }
    }

    function showSong(s, label) {
      kEl.textContent = label;
      tEl.textContent = s.title || 'Unknown';
      aEl.textContent = [s.artist, s.album].filter(Boolean).join(' · ');
    }

    // Tick + flap each time a peg passes the pointer.
    function tickCheck() {
      const seg = under(angle);
      if (seg === lastSeg) return;
      lastSeg = seg;
      if (!spinning) return;
      SFX && SFX.play('tick');
      showSong(songs[seg], 'Spinning…');
      flap?.cancel();
      flap = pointer.animate?.([{ transform: 'rotate(-24deg)' }, { transform: 'rotate(0deg)' }], { duration: 140, easing: 'ease-out' });
    }

    // Ease-out quint: starts at 5×delta/duration rad/ms and settles slowly.
    function spinBy(delta, duration) {
      cancelAnimationFrame(raf);
      spinning = true; winner = -1; spinBtn.disabled = true;
      actions.hidden = true; artEl.hidden = true;
      const from = angle, t0 = performance.now();
      const step = now => {
        if (!el.isConnected) { spinning = false; return; }
        const t = Math.min(1, (now - t0) / duration);
        angle = from + delta * (1 - Math.pow(1 - t, 5));
        tickCheck();
        draw();
        if (t < 1) raf = requestAnimationFrame(step);
        else land();
      };
      raf = requestAnimationFrame(step);
    }

    function land() {
      spinning = false; spinBtn.disabled = false;
      angle = mod(angle, TAU);
      winner = under(angle);
      draw();
      const s = songs[winner];
      showSong(s, 'Now playing');
      artEl.src = art(s.coverArt, 160); artEl.hidden = false;
      actions.hidden = false;
      SFX && SFX.play('success');
      play(s);
    }

    function play(s) {
      playerState.playlist = allSongs;
      playerState.playlistIndex = allSongs.indexOf(s);
      playSong(s);
    }

    // A proper spin from the hub (or a tap): pick the slice first, then
    // wind the wheel so it stops somewhere inside it, not dead centre.
    function spin() {
      if (spinning) return;
      const k = Math.floor(Math.random() * n);
      const f = 0.15 + Math.random() * 0.7;
      const target = -Math.PI / 2 - (k + f) * slice;
      // Only an OS reduced-motion preference cuts the spin short. Performance
      // mode leaves it: it's brief, you asked for it, and it's plain 2D canvas.
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const turns = still ? 0 : 5 + Math.floor(Math.random() * 2);
      const delta = mod(target - angle, TAU) + turns * TAU;
      spinBy(delta, still ? 450 : 4200 + Math.random() * 900);
    }
    spinBtn.addEventListener('click', e => { e.stopPropagation(); spin(); });

    actions.querySelector('.mh-flow-play').addEventListener('click', () => { if (winner >= 0) { SFX && SFX.play('click'); play(songs[winner]); } });
    actions.querySelector('.mh-wheel-open').addEventListener('click', () => {
      const s = songs[winner];
      if (s?.albumId && window.openAlbumPage) { SFX && SFX.play('nav'); window.openAlbumPage(s.albumId, s.album); }
    });

    // ── Drag and flick ──
    const center = () => { const b = canvas.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    const pointerAngle = e => { const [cx, cy] = center(); return Math.atan2(e.clientY - cy, e.clientX - cx); };
    let drag = null;

    canvas.addEventListener('pointerdown', e => {
      if (spinning || e.button !== 0) return;
      const a = pointerAngle(e);
      drag = { id: e.pointerId, start: angle, a0: a, last: a, moved: 0, samples: [[performance.now(), angle]] };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) {
        // Hover: name the slice under the cursor.
        if (!spinning) {
          const [cx, cy] = center();
          const i = Math.floor(mod(Math.atan2(e.clientY - cy, e.clientX - cx) - angle, TAU) / slice) % n;
          canvas.title = [songs[i].title, songs[i].artist].filter(Boolean).join(' · ');
        }
        return;
      }
      const a = pointerAngle(e);
      let d = a - drag.last;
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      drag.last = a; drag.moved += Math.abs(d);
      angle += d;
      if (drag.moved > 0.05) el.classList.add('dragging');
      const now = performance.now();
      drag.samples.push([now, angle]);
      while (drag.samples.length > 2 && now - drag.samples[0][0] > 90) drag.samples.shift();
      lastSeg = under(angle);
      draw();
    });
    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      el.classList.remove('dragging');
      if (d.moved < 0.05) { spin(); return; } // a tap spins it
      const [t0, a0] = d.samples[0], [t1, a1] = d.samples[d.samples.length - 1];
      const v = t1 > t0 ? (a1 - a0) / (t1 - t0) : 0; // rad/ms
      if (Math.abs(v) < 0.004) return; // let go without a flick: it just stays there
      const speed = Math.min(Math.abs(v), 0.06);
      const duration = 1600 + 3400 * (speed / 0.06);
      spinBy(Math.sign(v) * speed * duration / 5, duration); // matches the ease's starting speed
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; el.classList.remove('dragging'); } });

    canvas.addEventListener('contextmenu', e => {
      if (typeof showSongCtx !== 'function') return;
      e.preventDefault();
      const [cx, cy] = center();
      const i = Math.floor(mod(Math.atan2(e.clientY - cy, e.clientX - cx) - angle, TAU) / slice) % n;
      showSongCtx(e.clientX, e.clientY, songs[i], allSongs);
    });

    // Redraw on resize and theme change, until Home re-renders or reshuffles.
    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (!spinning) draw(); });
    ro.observe(stage);
    const mo = new MutationObserver(() => { if (!el.isConnected) { mo.disconnect(); return; } readColors(); if (!spinning) draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    el._cleanup = onCleanup(() => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); });

    lastSeg = under(angle);
    return el;
  }

  let frequent = [], frequentAt = 0;

  // Renders Home into `list`. Called with the shuffle picks already fetched.
  window.klabRenderMusicHome = function(list, songs, reshuffle) {
    [...cleanups].forEach(f => f());
    list.innerHTML = '';
    list.classList.remove('picker-list-grid');
    list.classList.add('mh-home');

    const jump = jumpSection();
    if (jump) list.appendChild(jump);

    const flowLabel = document.createElement('div');
    flowLabel.className = 'picker-section-label';
    flowLabel.textContent = 'Recently added';
    list.appendChild(flowLabel);
    list.appendChild(flow.el);
    flow.load();

    const recent = listenHistory();
    if (recent.length) list.appendChild(albumRow('Listen history', recent));

    // Playlists people have featured (js/09b-playlists.js), most recently
    // changed first, and kept current while Home is showing.
    const plSlot = document.createElement('div');
    plSlot.className = 'mh-slot';
    list.appendChild(plSlot);
    let plShown = null;
    const showPlaylists = () => {
      if (!plSlot.isConnected) return;
      const pls = (window.klabPlaylists?.featured() || []).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 24);
      const key = JSON.stringify(pls);
      if (key === plShown) return;
      plShown = key;
      plSlot.replaceChildren(...(pls.length ? [cardRow('Featured playlists', pls.map(window.klabPlaylists.card), 'made on klabnet')] : []));
    };
    showPlaylists();
    window.addEventListener('klab:playlists', showPlaylists);
    onCleanup(() => window.removeEventListener('klab:playlists', showPlaylists));

    const freqSlot = document.createElement('div');
    list.appendChild(freqSlot);
    const showFrequent = () => { if (frequent.length) freqSlot.replaceWith(albumRow('Most played', frequent, 'across klabnet')); };
    if (frequent.length && Date.now() - frequentAt < REFRESH_MS) showFrequent();
    else albumList('frequent', 16).then(a => { frequent = a; frequentAt = Date.now(); if (freqSlot.isConnected) showFrequent(); }).catch(() => {});

    const shuffleLabel = document.createElement('div');
    shuffleLabel.className = 'picker-section-label mh-shuffle-label';
    shuffleLabel.innerHTML = 'Shuffle picks <button type="button" class="mh-reshuffle" title="Reshuffle"><i class="ti ti-refresh"></i></button>';
    list.appendChild(shuffleLabel);
    // songs can still be on its way (a promise): the rest of Home doesn't
    // wait for it, and the wheel fills its slot when they come.
    let wheel = null;
    const wheelSlot = document.createElement('div');
    wheelSlot.className = 'mh-slot';
    list.appendChild(wheelSlot);
    const fillWheel = songs => {
      if (!wheelSlot.isConnected) return;
      pickerSongs = songs;
      if (songs.length >= 3) wheelSlot.replaceWith(wheel = shuffleWheel(songs));
      else if (songs.length) { const box = document.createElement('div'); renderSongItems(songs, box); wheelSlot.replaceWith(...box.childNodes); }
      else wheelSlot.innerHTML = '<div class="picker-empty">No tracks found</div>';
    };
    if (Array.isArray(songs)) fillWheel(songs);
    else {
      wheelSlot.innerHTML = '<div class="picker-empty">Loading…</div>';
      songs.then(fillWheel, () => { if (wheelSlot.isConnected) wheelSlot.innerHTML = '<div class="picker-empty">Couldn’t load shuffle picks</div>'; });
    }
    // Reshuffle swaps just the wheel for a fresh one; the rest of Home
    // (Cover Flow, the album rows) stays exactly where it was.
    const btn = shuffleLabel.querySelector('button');
    btn.addEventListener('click', async () => {
      SFX && SFX.play('click');
      if (!wheel || !wheel.isConnected) { reshuffle(); return; }
      if (btn.classList.contains('busy')) return;
      btn.classList.add('busy');
      try {
        const r = await fetchTimeout(`${ND_URL}/rest/getRandomSongs?size=20&${subsonicParams()}`, {}, 8000);
        const fresh = (await r.json())['subsonic-response']?.randomSongs?.song || [];
        if (fresh.length >= 3 && wheel.isConnected) {
          const next = shuffleWheel(fresh);
          wheel._cleanup();
          wheel.replaceWith(next);
          wheel = next;
          pickerSongs = fresh;
          next.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
        }
      } catch (e) {
        showToast('Couldn’t reshuffle', 'ti-alert-triangle');
      } finally {
        btn.classList.remove('busy');
      }
    });
  };

  // ══ What's next ══
  // What you heard, what's on and what's next: the last songs you played,
  // the one playing, then your queue and the rest of what's playing (in
  // the order they'll actually come; with shuffle on only the queue is
  // known). The full player's Up next lists it. (There was a Cover Flow
  // view of it in Music too, taken out on 2026-10-14.)
  const NP_BEFORE = 20, NP_AFTER = 30;
  function npJump(it) {
    if (it.kind === 'queue') {
      // Straight to that one: what was queued before it is skipped.
      queue.splice(0, it.k);
      const song = queue.shift();
      updateQueueBadge();
      // The full player's Up next can sit over the Queue view.
      if (pickerTab === 'queue') renderQueueList();
      playSong(song);
    } else if (it.kind === 'next') {
      playerState.playlistIndex = it.i;
      playSong(playerState.playlist[it.i]);
    } else {
      const i = playerState.playlist.findIndex(x => x.id === it.song.id);
      if (i >= 0) playerState.playlistIndex = i;
      playSong(it.song);
    }
    SFX && SFX.play('click');
  }

  function npItems() {
    const cur = playerState.currentSong;
    const before = _heard.slice(-NP_BEFORE).map(song => ({ song, kind: 'played' }));
    const after = queue.map((song, k) => ({ song, kind: 'queue', k }));
    if (!_shuffleOn) {
      const pl = playerState.playlist || [];
      for (let i = playerState.playlistIndex + 1; i < pl.length && after.length < NP_AFTER; i++) after.push({ song: pl[i], kind: 'next', i });
    }
    const items = [...before, ...(cur ? [{ song: cur, kind: 'now' }] : []), ...after.slice(0, NP_AFTER)];
    return { items, center: cur ? before.length : 0, queued: queue.length, later: after.length - queue.length };
  }
  // ── Kept live ──
  playerState.audio.addEventListener('loadstart', () => fsUpRender());
  // The queue and shuffle change what's next.
  const _npQueueBadge = updateQueueBadge;
  updateQueueBadge = function() { _npQueueBadge(); fsUpRender(); };
  const _npShuffle = syncShuffleBtns;
  syncShuffleBtns = function() { _npShuffle(); fsUpRender(); };

  // ── The full player's "Up next" ──
  // What's coming after the one playing, as a list the way Music lists
  // songs. Drawn only while the player is open.
  const fsEl = document.getElementById('fsPlayer');
  const fsUp = document.getElementById('fsUpNext');
  const fsUpList = document.getElementById('fsUpNextList');
  const fsUpNote = document.getElementById('fsUpNextNote');
  function fsUpRender() {
    if (!fsUp || !fsEl.classList.contains('open')) return;
    const { items, center, queued } = npItems();
    const next = items.slice(center + (playerState.currentSong ? 1 : 0)).slice(0, 8);
    fsUp.hidden = !next.length;
    fsUpNote.textContent = [queued ? `${queued} queued` : '', _shuffleOn ? 'shuffle is on' : ''].filter(Boolean).join(' · ');
    fsUpList.textContent = '';
    for (const it of next) {
      const s = it.song;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'fs-upnext-row';
      row.innerHTML =
        (s.coverArt ? `<img src="${esc(art(s.coverArt, 96))}" alt="" decoding="async" draggable="false">` : '<span class="ph"><i class="ti ti-music"></i></span>') +
        `<span class="m"><span class="t">${esc(s.title || 'Unknown')}</span><span class="a">${esc(s.artist || '')}</span></span>` +
        (it.kind === 'queue' ? '<span class="q">Queued</span>' : '') +
        `<span class="d">${s.duration ? formatTime(s.duration) : ''}</span>`;
      row.addEventListener('click', () => npJump(it));
      row.addEventListener('contextmenu', e => { e.preventDefault(); showSongCtx(e.clientX, e.clientY, s); });
      fsUpList.appendChild(row);
    }
  }
  const _npOpenFS = openFS;
  openFS = function() { _npOpenFS(); fsUpRender(); };
})();
