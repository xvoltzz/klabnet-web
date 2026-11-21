// ══════════════════════════════════════════
//  HOME
//  The owner, 2026-11-20 morning: "i like the minimal honestly. i just
//  want it to serve a purpose". The same evening: "home screen of site is
//  reaaaallly boring and needs a redesign", with "a bit more of a desktopy
//  feel" (no boxes behind everything, hairlines, underlines on hover).
//  So Home is a desk: everything on it is something you can press to get
//  somewhere, and it's all fed by what people already do, so it's never
//  empty for long.
//    · The head: the greeting, the date, and an old LCD clock (DSEG7, the
//      radio's face; ideas.md: "clock under home looks like old school
//      digital clock!"). It changes once a minute, nothing loops.
//    · The main column: Together (only voice with people in it, and watch
//      or listening parties of two or more; otherwise not there), then
//      what's new: albums
//      (Navidrome's newest), videos, photos. Each shelf only when it has
//      something, each with See all.
//    · The side column: Online (Contacts' rows), unread messages, the
//      newest posts, and This week's totals (opens the week).
//  It fetches when it's shown (each source at most every 2 minutes) and
//  not otherwise. The owner, 2026-11-21: "better but really cluttered. i
//  dont need the music bar there", so there's no Now playing (the dock has
//  it) and no "start a listening party / watch together / voice" buttons.
// ══════════════════════════════════════════
(function () {
  const page = document.getElementById('homePage');
  if (!page) return;
  const me = () => window.KLAB_USER?.username || '';
  const color = u => (typeof profileColor === 'function' ? profileColor(u) : 'var(--text)');
  const apiTime = s => {
    if (!s) return 0;
    const str = String(s);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime() || 0;
  };
  const ndArt = (id, px) => id && typeof ND_URL !== 'undefined'
    ? ND_URL + '/rest/getCoverArt?id=' + encodeURIComponent(id) + '&size=' + klabArtSize(px) + '&' + subsonicParams() : '';
  const shelf = (id, label, see) =>
    '<section class="hp-shelf" id="' + id + '" hidden>' +
      '<div class="hp-head"><span class="k-label">' + label + '</span><span class="hp-n"></span>' +
      (see ? '<button type="button" class="hp-see" data-see="' + see + '">See all<i class="ti ti-chevron-right"></i></button>' : '') + '</div>' +
      '<div class="hp-list"></div>' +
    '</section>';

  page.innerHTML =
    '<header class="hp-top">' +
      '<div class="hp-top-tx"><h1 class="k-page-title hp-hello" id="hpHello"></h1><div class="hp-date" id="hpDate"></div></div>' +
      '<div class="hp-clock" id="hpClock" aria-hidden="true"><span class="hp-clock-ghost">88:88</span><span class="hp-clock-now"></span><span class="hp-clock-ap"></span></div>' +
    '</header>' +
    '<div class="hp-cols">' +
      '<div class="hp-main">' +
        '<section class="hp-together" id="hpTogether" aria-label="Together"></section>' +
        shelf('hpAlbums', 'New music', 'music') +
        shelf('hpVideos', 'New videos', 'videos') +
        shelf('hpPhotos', 'New photos', 'photos') +
      '</div>' +
      '<aside class="hp-side">' +
        '<section class="hp-shelf hp-online" aria-labelledby="hpOnTitle">' +
          '<div class="hp-head"><span class="k-label" id="hpOnTitle">Online</span><span class="hp-n" id="hpOnN"></span>' +
            '<button type="button" class="hp-see" data-see="social">Chat<i class="ti ti-chevron-right"></i></button></div>' +
          '<div class="ct-list hp-on" id="hpOn" role="list"></div>' +
        '</section>' +
        shelf('hpUnread', 'Unread', 'chat') +
        shelf('hpFeed', 'From the feed', 'feed') +
        shelf('hpWeek', 'This week', '') +
      '</aside>' +
    '</div>';
  const $ = id => page.querySelector('#' + id);
  const hello = $('hpHello'), dateEl = $('hpDate'), clockEl = $('hpClock');
  const listEl = $('hpOn'), countEl = $('hpOnN');
  let active = false, lastHTML = '';

  // ── The head ──
  function greet() {
    const d = new Date(), h = d.getHours();
    const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const u = me();
    const g = part + (u && u !== 'anonymous' ? ', ' + u : '');
    if (hello.textContent !== g) hello.textContent = g;
    dateEl.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(d);
    const hh = parts.find(p => p.type === 'hour')?.value || '', mm = parts.find(p => p.type === 'minute')?.value || '';
    const ap = parts.find(p => p.type === 'dayPeriod')?.value || '';
    // DSEG7 draws "!" as a blank digit, so 9:41 lines up under 88:88.
    clockEl.querySelector('.hp-clock-now').textContent = hh.padStart(2, '!') + ':' + mm;
    clockEl.querySelector('.hp-clock-ap').textContent = ap.toUpperCase();
    clockEl.title = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  let minuteTimer = 0;
  function everyMinute() {
    clearTimeout(minuteTimer);
    if (!active) return;
    greet();
    minuteTimer = setTimeout(everyMinute, 60e3 - Date.now() % 60e3 + 50);
  }

  // ── Online ──
  function paintOnline() {
    const C = window.klabContacts;
    if (!C) return;
    const online = [...(window.KLAB_ONLINE_USERNAMES || [])].filter(u => u && u !== me() && !u.endsWith('-bot'))
      .map(u => ({ u, s: C.stateOf(u) })).filter(x => x.s.on)
      // Doing something first (joinable), then listening, then the rest; away last.
      .sort((a, b) => (!!C.joinOf(b.u, b.s) - !!C.joinOf(a.u, a.s)) || ((a.s.tone === 'away') - (b.s.tone === 'away')) || a.u.localeCompare(b.u));
    countEl.textContent = online.length ? String(online.length) : '';
    const html = online.length ? online.map(x => C.rowHTML(x.u, x.s, { join: true })).join('')
      : '<div class="hp-quiet">Nobody else is on right now.</div>';
    if (html === lastHTML) return;
    const focused = document.activeElement?.closest?.('.ct-row')?.dataset.u;
    lastHTML = html;
    listEl.innerHTML = html;
    // The join button is an icon here: its name goes to its tooltip.
    listEl.querySelectorAll('.ct-join').forEach(b => { b.title = b.textContent.trim(); b.setAttribute('aria-label', b.title); });
    const first = listEl.querySelector('.ct-row');
    if (first) first.tabIndex = 0;
    if (focused) listEl.querySelector('.ct-row[data-u="' + CSS.escape(focused) + '"]')?.focus({ preventScroll: true });
  }
  listEl.addEventListener('click', e => {
    const row = e.target.closest('.ct-row');
    if (!row) return;
    const C = window.klabContacts, u = row.dataset.u;
    const b = e.target.closest('[data-ct]');
    if (b) { C.act(b.dataset.ct, u, b); return; }
    // The row: what they're in, else a message.
    const j = C.joinOf(u, C.stateOf(u));
    if (j) { SFX?.play('click'); j.run(); } else C.act('message', u, row);
  });
  listEl.addEventListener('contextmenu', e => {
    const row = e.target.closest('.ct-row');
    if (row) klabMenu(e, window.klabContacts.menu(row.dataset.u));
  });
  listEl.addEventListener('keydown', e => {
    const row = e.target.closest?.('.ct-row');
    if (!row || e.ctrlKey || e.metaKey || e.altKey) return;
    const rows = [...listEl.querySelectorAll('.ct-row')], i = rows.indexOf(row);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); row.click(); }
    else if (e.key === 'c') { e.preventDefault(); e.stopPropagation(); window.klabContacts.act('call', row.dataset.u, row); }
  }, true);

  // ── Shelves ──
  // Each source is fetched when Home shows and it's older than STALE.
  const STALE = 120e3;
  const got = {};
  function due(k) { if (got[k] && Date.now() - got[k] < STALE) return false; got[k] = Date.now(); return true; }
  async function getJSON(url, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 10e3);
    try {
      // The deadline covers the body too: a reply that stalls halfway
      // mustn't leave the shelf waiting forever.
      const r = await fetch(url, { signal: ctl.signal, credentials: 'same-origin', redirect: 'manual' });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } finally { clearTimeout(t); }
  }
  function show(id, html, n) {
    const sec = $(id);
    sec.hidden = !html;
    if (!html) return;
    const body = sec.querySelector('.hp-list');
    if (body._html !== html) { body._html = html; body.innerHTML = html; }
    sec.querySelector('.hp-n').textContent = n || '';
  }

  // New music: Navidrome's newest albums.
  let albums = [];
  async function loadAlbums() {
    if (!due('albums') || typeof ND_URL === 'undefined') return;
    try {
      const j = await getJSON(ND_URL + '/rest/getAlbumList2?type=newest&size=24&' + subsonicParams(), 8000);
      albums = j['subsonic-response']?.albumList2?.album || [];
    } catch (e) { got.albums = 0; return; }
    paintAlbums();
  }
  function paintAlbums() {
    const added = iso => {
      const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
      return !iso ? '' : days < 1 ? 'Today' : days < 2 ? 'Yesterday' : days < 7 ? days + ' days ago' : new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    show('hpAlbums', albums.slice(0, 24).map(a =>
      '<button type="button" class="hp-album" data-album="' + esc(a.id) + '" data-name="' + esc(a.name || '') + '" data-silent>' +
        '<span class="hp-album-art"><img src="' + esc(ndArt(a.coverArt || a.id, 160)) + '" alt="" loading="lazy" decoding="async" draggable="false" onload="this.classList.add(\'loaded\')" />' +
          '<span class="k-card-play hp-album-play" data-play title="Play" aria-label="Play"><i class="ti ti-player-play-filled"></i></span></span>' +
        '<span class="hp-album-t">' + esc(a.name || '') + '</span>' +
        '<span class="hp-album-a">' + esc(a.artist || '') + '</span>' +
        '<span class="hp-album-w">' + esc(added(a.created)) + '</span>' +
      '</button>').join(''));
  }
  $('hpAlbums').addEventListener('click', async e => {
    const card = e.target.closest('.hp-album');
    if (!card) return;
    if (e.target.closest('[data-play]')) {
      SFX?.play('click');
      try {
        const r = await fetchTimeout(ND_URL + '/rest/getAlbum?id=' + encodeURIComponent(card.dataset.album) + '&' + subsonicParams(), {}, 8000);
        const songs = (await r.json())['subsonic-response']?.album?.song || [];
        if (!songs.length) return;
        playerState.playlist = songs; playerState.playlistIndex = 0;
        playSong(songs[0]);
      } catch (err) { showToast('Couldn’t play that album', 'ti-alert-triangle'); }
      return;
    }
    SFX?.play('nav');
    setActiveTab('music');
    window.openAlbumPage?.(card.dataset.album, card.dataset.name);
  });

  // New videos.
  let videos = [];
  async function loadVideos() {
    if (!due('videos')) return;
    try { videos = (await getJSON('/api/posts/videos?limit=8&sort=new')).videos || []; } catch (e) { got.videos = 0; return; }
    show('hpVideos', videos.length && window.klabVideoCardHTML ? videos.map(v => window.klabVideoCardHTML(v)).join('') : '');
  }
  $('hpVideos').addEventListener('click', e => {
    const card = e.target.closest('.vid-card[data-vid-id]');
    if (!card) return;
    SFX?.play('nav');
    window.klabVideoLink = { id: +card.dataset.vidId, at: 0 };
    setActiveTab('videos');
  });

  // New photos: newest uploaded (not by date taken), as many as two rows hold.
  async function loadPhotos() {
    if (!due('photos')) return;
    let posts;
    try { posts = (await getJSON('/api/posts/photos?limit=16&order=posted')).posts || []; } catch (e) { got.photos = 0; return; }
    const tiles = [];
    for (const p of posts) for (const ph of (p.photos || [])) { if (tiles.length < 24) tiles.push({ p, ph }); }
    show('hpPhotos', tiles.map(({ p, ph }) =>
      '<button type="button" class="hp-photo" data-post="' + p.id + '" data-photo="' + esc(ph.id) + '" title="' + esc(p.username + (p.caption || p.text ? ': ' + (p.caption || p.text) : '')) + '" data-silent>' +
        '<img src="/api/posts/photos/files/' + encodeURIComponent(ph.id) + '/thumb?v=2" alt="" loading="lazy" decoding="async" draggable="false" onload="this.classList.add(\'loaded\')" /></button>').join(''));
  }
  $('hpPhotos').addEventListener('click', e => {
    const t = e.target.closest('.hp-photo');
    if (!t) return;
    SFX?.play('nav');
    if (window.klabOpenPhoto) window.klabOpenPhoto(+t.dataset.post, t.dataset.photo); else setActiveTab('photos');
  });

  // Unread messages (Matrix; muted rooms are already left out).
  function paintUnread() {
    const list = (window.klabChatUnread?.() || []).slice(0, 5);
    show('hpUnread', list.map(c => {
      const face = c.isDm && window.klabResolveUserAvatar?.(c.user);
      const who = c.isDm ? (c.user || c.name) : c.name;
      const col = c.isDm ? color(who) : '';
      return '<button type="button" class="hp-row" data-room="' + esc(c.roomId) + '" data-silent>' +
        '<span class="hp-face' + (c.isDm ? '' : ' hash') + '" style="--c:' + (col || 'var(--text-dim)') + '">' +
          (c.isDm ? (face ? '<img src="' + esc(face) + '" alt="" />' : esc((who || '?')[0].toUpperCase())) : '#') + '</span>' +
        '<span class="hp-row-tx"><span class="hp-row-top"><span class="hp-row-name"' + (col ? ' style="color:' + col + '"' : '') + '>' + esc(who || '') + '</span>' +
          (c.ts ? '<span class="hp-when" data-t="' + c.ts + '">' + klabRelativeTime(c.ts) + '</span>' : '') + '</span>' +
          '<span class="hp-row-text">' + esc(c.text || '') + '</span></span></button>';
    }).join(''), list.length ? String(list.length) : '');
  }
  $('hpUnread').addEventListener('click', e => {
    const row = e.target.closest('[data-room]');
    if (row) { SFX?.play('nav'); openChatRoom(row.dataset.room); }
  });

  // From the feed: its newest few, as a reading list.
  const plain = t => String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_~`>#|=]+/g, '').replace(/\s+/g, ' ').trim();
  function paintFeed() {
    const list = (window.klabFeedPosts?.(5) || []).slice(0, 5);
    show('hpFeed', list.map(p => {
      const face = window.klabResolveUserAvatar?.(p.username);
      const text = plain(p.text) || (p.image_mxc ? 'Posted a picture' : p.song ? 'Shared ' + (p.song.title || 'a song') : p.video ? 'Shared a video' : '');
      const reacts = Object.values(p.reactions || {}).reduce((n, r) => n + (r.count || 0), 0);
      const t = apiTime(p.created);
      return '<button type="button" class="hp-row" data-post="' + p.id + '" data-silent>' +
        '<span class="hp-face" data-u="' + esc(p.username) + '" style="--c:' + color(p.username) + '">' + (face ? '<img src="' + esc(face) + '" alt="" />' : esc((p.username || '?')[0].toUpperCase())) + '</span>' +
        '<span class="hp-row-tx"><span class="hp-row-top"><span class="hp-row-name" style="color:' + color(p.username) + '">' + esc(p.username) + '</span>' +
          '<span class="hp-when" data-t="' + t + '">' + klabRelativeTime(t) + '</span></span>' +
          '<span class="hp-row-text two">' + esc(text) + '</span>' +
          (p.reply_count || reacts ? '<span class="hp-row-meta">' + (p.reply_count ? '<span><i class="ti ti-message-circle"></i>' + p.reply_count + '</span>' : '') +
            (reacts ? '<span><i class="ti ti-mood-smile"></i>' + reacts + '</span>' : '') + '</span>' : '') +
        '</span></button>';
    }).join(''));
  }
  $('hpFeed').addEventListener('click', e => {
    const face = e.target.closest('.hp-face[data-u]');
    if (face) { e.stopPropagation(); openProfileView(face.dataset.u); return; }
    const row = e.target.closest('[data-post]');
    if (row) { SFX?.play('nav'); window.klabFeedFocus?.(+row.dataset.post); }
  });
  function loadFeed() {
    if (!due('feed')) { paintFeed(); return; }
    paintFeed();
    window.klabLoadFeed?.().then(paintFeed, () => { got.feed = 0; });
  }

  // This week: the totals, one line, and the week opens in its sheet.
  async function loadWeek() {
    if (!due('week')) return;
    let w;
    try { w = await getJSON('/api/posts/week?tz=' + new Date().getTimezoneOffset()); } catch (e) { got.week = 0; return; }
    const t = w.totals || {}, bits = [];
    const hrs = (t.seconds || 0) / 3600;
    if (t.seconds >= 60) bits.push('<b>' + (hrs >= 10 ? Math.round(hrs) : (Math.round(hrs * 10) / 10 || '<1')) + '</b> ' + (hrs > 1 ? 'hours' : 'hour') + ' of music');
    if (t.videosWatched) bits.push('<b>' + t.videosWatched + '</b> ' + (t.videosWatched === 1 ? 'video' : 'videos') + ' watched');
    if (t.posts) bits.push('<b>' + t.posts + '</b> ' + (t.posts === 1 ? 'post' : 'posts'));
    const lines = (w.lines || []).length;
    show('hpWeek', bits.length || lines
      ? '<button type="button" class="hp-week" data-silent>' +
          (bits.length ? '<span class="hp-week-tx">' + bits.join('<span class="hp-dot">·</span>') + '</span>' : '') +
          '<span class="hp-link">' + (lines ? 'See the week' : 'Open the week') + '<i class="ti ti-chevron-right"></i></span></button>'
      : '');
  }
  $('hpWeek').addEventListener('click', e => { if (e.target.closest('.hp-week')) { SFX?.play('nav'); window.klabOpenWeek?.(); } });

  // See all: where each shelf lives.
  page.addEventListener('click', e => {
    const b = e.target.closest('.hp-see');
    if (!b) return;
    SFX?.play('nav');
    setActiveTab(b.dataset.see);
  });

  // Times on the rows, without redrawing them.
  function refreshTimes() {
    page.querySelectorAll('.hp-when[data-t]').forEach(t => { const s = klabRelativeTime(+t.dataset.t); if (t.textContent !== s) t.textContent = s; });
  }

  function paint() {
    if (!active) return;
    greet();
    paintOnline();
    paintUnread();
    refreshTimes();
  }
  function loadAll() {
    loadAlbums(); loadVideos(); loadPhotos(); loadFeed(); loadWeek();
  }

  // Together: js/25-social.js's rooms, shown here.
  function mountTogether() {
    const t = window.klabTogether;
    const host = $('hpTogether');
    if (t && t.el.parentElement !== host) host.appendChild(t.el);
  }

  // ── Hooks ──
  const presenceChanged = window.klabHomePresenceChanged;
  window.klabHomePresenceChanged = () => { presenceChanged?.(); if (active) paintOnline(); };
  window.addEventListener('klab:status', () => { if (active) paintOnline(); });
  window.addEventListener('klab:people', () => { lastHTML = ''; if (active) { paintOnline(); paintFeed(); } });
  const unreadChanged = window.klabChatUnreadChanged;
  window.klabChatUnreadChanged = () => { unreadChanged?.(); if (active) paintUnread(); };
  const feedChanged = window.klabHomeFeedChanged;
  window.klabHomeFeedChanged = list => { feedChanged?.(list); if (active) paintFeed(); };
  document.addEventListener('visibilitychange', () => { if (active && !document.hidden) { paint(); loadAll(); everyMinute(); } });

  let tick = 0;
  const tabChanged = window.klabHomeTabChanged;
  window.klabHomeTabChanged = show => {
    tabChanged?.(show);
    if (show === active) return;
    active = show;
    clearInterval(tick);
    mountTogether();
    window.klabTogether?.shown(show);
    if (active) {
      lastHTML = '';
      paint(); loadAll(); everyMinute();
      // Voice and rooms move without a presence poll: a light look every 10s.
      tick = setInterval(() => { if (!document.hidden) { paintOnline(); paintUnread(); refreshTimes(); } }, 10e3);
    } else clearTimeout(minuteTimer);
  };
  if (document.body.classList.contains('tab-home-active')) window.klabHomeTabChanged(true);
  // Contacts' rows (js/47-contacts.js) and the video cards load after this file.
  window.addEventListener('load', () => { lastHTML = ''; mountTogether(); if (active) { paint(); got.videos = 0; loadVideos(); } });
})();
