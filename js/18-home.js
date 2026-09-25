// ══════════════════════════════════════════
//  HOME — the newest of everything on one screen, meant to be left open.
//    · A spotlight cycles through the latest highlights (feed posts, the
//      newest photo post, the newest album), newest first. Something new
//      arriving takes it over straight away.
//    · Around it: latest posts, who's listening, new albums in a small
//      Cover Flow, the newest photos, and the latest chat in channels (never
//      DMs; this screen is meant to sit on a second monitor).
//    · One line up top says what just happened.
//  No labels on purpose: the content is the explanation.
//  It only polls while Home is showing and the page is visible. "Today" is
//  Eastern time, where everyone is.
// ══════════════════════════════════════════
(function() {
  const panel = document.querySelector('.tab-panel[data-tab-panel="home"]');
  if (!panel) return;
  const TZ = 'America/New_York';
  const $ = id => document.getElementById(id);
  const dateEl = $('hmDate'), clockEl = $('hmClock'), liveEl = $('hmLive'), liveEvEl = $('hmLiveEv');
  const spotEl = $('hmSpot'), slidesEl = $('hmSlides'), barsEl = $('hmBars'), arriveEl = $('hmArrive');
  const postsEl = $('hmPosts'), listenEl = $('hmListen'), flowEl = $('hmFlow'), photosEl = $('hmPhotos'), chatEl = $('hmChat');
  const bdLayers = $('hmBackdrop').children;

  const SLIDE_MS = 9000;
  const POLL = { posts: 30e3, photos: 60e3, presence: 10e3, albums: 5 * 60e3 };
  const S = { posts: null, photoPosts: null, listeners: null, albums: null, chat: null };
  let active = false;
  const me = () => window.KLAB_USER?.username;
  const motion = () => (window.klabMotionOk ? window.klabMotionOk() : true);

  // ── helpers ──
  // The API's timestamps are SQLite UTC ("YYYY-MM-DD HH:MM:SS", no zone).
  const apiTime = s => {
    if (!s) return 0;
    const str = String(s);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime() || 0;
  };
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return new Date(t).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  }
  const timeHTML = t => '<span class="hm-t" data-t="' + t + '">' + ago(t) + '</span>';
  const cover = (id, size) => id ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}` : '';
  const photoFile = (id, size) => `/api/posts/photos/files/${id}/${size}?v=2`;
  const localpart = mxid => String(mxid || '').replace(/^@/, '').split(':')[0];
  const color = u => (typeof profileColor === 'function' ? profileColor(u) : 'inherit');
  function avatarHTML(u) {
    const url = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(u) : null;
    const online = window.KLAB_ONLINE_USERNAMES?.has?.(u);
    return '<span class="hm-av' + (online ? ' on' : '') + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  const nameHTML = u => '<span class="hm-name" style="color:' + color(u) + '">' + esc(u) + '</span>';
  // Markdown posts shown as plain text in previews.
  const plainCache = new Map();
  function plain(md) {
    if (!md) return '';
    let v = plainCache.get(md);
    if (v !== undefined) return v;
    if (window.klabMarkdown) {
      const d = document.createElement('div');
      d.innerHTML = klabMarkdown(md, me());
      d.querySelectorAll('.md-spoiler').forEach(s => { s.textContent = '▒▒▒▒'; });
      d.querySelectorAll('br').forEach(b => b.replaceWith(' '));
      d.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, pre, tr').forEach(b => b.append(' '));
      v = d.textContent;
    } else v = md;
    v = v.replace(/\s+/g, ' ').trim();
    if (plainCache.size > 200) plainCache.delete(plainCache.keys().next().value);
    plainCache.set(md, v);
    return v;
  }
  async function getJSON(url) {
    const r = await fetchTimeout(url, {}, 8000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ── backdrop, like the Photos tab's ──
  let bdI = 0, bdKey = '';
  function setBackdrop(img, tint) {
    const key = img || tint || '';
    if (!key || key === bdKey) return;
    bdKey = key;
    bdI ^= 1;
    const layer = bdLayers[bdI];
    layer.style.backgroundImage = img ? 'url("' + img + '")' : 'radial-gradient(circle at 40% 45%, ' + tint + ', transparent 62%)';
    layer.classList.add('on');
    bdLayers[bdI ^ 1].classList.remove('on');
  }

  // ── clock (Eastern) ──
  let lastMinute = '';
  function tickClock() {
    const d = new Date();
    const clock = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    if (clock === lastMinute) return;
    lastMinute = clock;
    clockEl.textContent = clock;
    dateEl.textContent = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
    // Relative times move on with the clock.
    panel.querySelectorAll('.hm-t[data-t]').forEach(el => { el.textContent = ago(+el.dataset.t); });
  }

  // ── what just happened ──
  let liveT = 0;
  function live(t, html) {
    if (t < liveT) return;
    liveT = t;
    liveEl.hidden = false;
    liveEvEl.classList.remove('swap');
    void liveEvEl.offsetWidth;
    liveEvEl.innerHTML = html;
    liveEvEl.classList.add('swap');
  }

  // ── spotlight ──
  let slides = [], cur = 0, slideTimer = 0, slideSig = '', newestKey = null;
  function postSlide(p) {
    const t = apiTime(p.created), u = p.username;
    const who = '<div class="hm-who">' + avatarHTML(u) + nameHTML(u) + timeHTML(t) + '</div>';
    const go = () => setActiveTab('feed');
    const text = plain(p.text);
    if (p.song) {
      const art = cover(p.song.coverArt, 600);
      return { key: 'p' + p.id, t, img: cover(p.song.coverArt, 300), go, dark: true,
        html: '<div class="hm-blur" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' +
          '<div class="hm-content">' + who + '<div class="hm-album">' +
            (art ? '<div class="hm-cv" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' : '') +
            '<div>' + (text ? '<div class="hm-say">' + esc(text) + '</div>' : '') + '<b>' + esc(p.song.title || '') + '</b><span>' + esc(p.song.artist || '') + '</span></div>' +
          '</div></div>' };
    }
    const img = p.image_mxc && window.klabResolveFeedImage ? window.klabResolveFeedImage(p.image_mxc) : null;
    if (img) {
      return { key: 'p' + p.id + 'i', t, img, go, dark: true,
        html: '<div class="hm-img" style="background-image:url(&quot;' + esc(img) + '&quot;)"></div>' +
          '<div class="hm-content">' + who + (text ? '<div class="hm-cap">' + esc(text) + '</div>' : '') + '</div>' };
    }
    if (!text) return null;
    return { key: 'p' + p.id, t, tint: color(u), go,
      html: '<div class="hm-tint" style="background:radial-gradient(circle at 18% 95%, ' + color(u) + ', transparent 62%)"></div>' +
        '<div class="hm-content">' + who + '<div class="hm-big' + (text.length > 140 ? ' long' : '') + '">' + esc(text) + '</div></div>' };
  }
  function photoSlide(pp) {
    const ph = pp.photos && pp.photos[0];
    if (!ph) return null;
    const t = apiTime(pp.created), u = pp.username, ex = ph.exif || {};
    const chips = [ex.camera, ex.focal, ex.aperture, ex.shutter, ex.iso && ('ISO ' + String(ex.iso).replace(/^ISO\s*/i, '')), ex.film].filter(Boolean);
    return { key: 'ph' + pp.id, t, img: photoFile(ph.id, 'thumb'), go: () => setActiveTab('photos'), dark: true,
      html: '<div class="hm-img" style="background-image:url(&quot;' + photoFile(ph.id, 'display') + '&quot;)"></div>' +
        '<div class="hm-content"><div class="hm-who">' + avatarHTML(u) + nameHTML(u) + timeHTML(t) +
          (pp.photos.length > 1 ? '<span class="hm-count"><i class="ti ti-photo"></i>' + pp.photos.length + '</span>' : '') + '</div>' +
          (pp.text ? '<div class="hm-cap">' + esc(plain(pp.text)) + '</div>' : '') +
          (chips.length ? '<div class="hm-exif">' + chips.map(c => '<span>' + esc(c) + '</span>').join('') + '</div>' : '') +
        '</div>' };
  }
  function albumSlide(a) {
    const t = a.created ? new Date(a.created).getTime() : 0;
    const art = cover(a.coverArt || a.id, 600);
    return { key: 'al' + a.id, t, img: cover(a.coverArt || a.id, 300), go: () => openAlbum(a), dark: true,
      html: '<div class="hm-blur" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' +
        '<div class="hm-content"><div class="hm-album"><div class="hm-cv" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' +
          '<div><b>' + esc(a.name || a.title || '') + '</b><span>' + esc(a.artist || '') + (a.year ? ' · ' + a.year : '') + '</span></div></div></div>' };
  }
  function buildSlides() {
    const L = [];
    (S.posts || []).slice(0, 3).forEach(p => L.push(postSlide(p)));
    if (S.photoPosts && S.photoPosts[0]) L.push(photoSlide(S.photoPosts[0]));
    if (S.albums && S.albums[0]) L.push(albumSlide(S.albums[0]));
    return L.filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 5);
  }
  function renderSpot() {
    const next = buildSlides();
    const sig = next.map(s => s.key + ':' + s.html.length).join('|');
    if (sig === slideSig) return;
    const firstPaint = !slideSig;
    slideSig = sig;
    const prevKey = slides[cur]?.key;
    slides = next;
    if (!slides.length) { slidesEl.innerHTML = ''; barsEl.innerHTML = ''; return; }
    // Something new at the top takes over; otherwise stay on what was showing.
    const arrived = !firstPaint && newestKey !== null && slides[0].key !== newestKey && slides[0].t > (Date.now() - 15 * 60e3);
    newestKey = slides[0].key;
    const keep = slides.findIndex(s => s.key === prevKey);
    cur = arrived || keep < 0 ? 0 : keep;
    slidesEl.innerHTML = slides.map((s, i) => '<div class="hm-slide' + (s.dark ? ' dark' : '') + (i === cur ? ' on' : '') + '">' + s.html + '</div>').join('');
    barsEl.innerHTML = slides.length > 1 ? slides.map(() => '<b><i></i></b>').join('') : '';
    if (arrived && motion()) { arriveEl.classList.remove('go'); void arriveEl.offsetWidth; arriveEl.classList.add('go'); }
    showSlide(cur);
  }
  function showSlide(i) {
    cur = i;
    [...slidesEl.children].forEach((el, j) => el.classList.toggle('on', j === i));
    [...barsEl.children].forEach((b, j) => {
      b.className = j < i ? 'done' : '';
      if (j === i) { void b.offsetWidth; b.className = 'run'; }
    });
    const s = slides[i];
    if (s && active) setBackdrop(s.img, s.tint);
    clearTimeout(slideTimer);
    if (active && slides.length > 1) slideTimer = setTimeout(() => showSlide((cur + 1) % slides.length), SLIDE_MS);
  }
  spotEl.style.setProperty('--hm-slide', SLIDE_MS + 'ms');
  spotEl.addEventListener('click', e => {
    const bar = e.target.closest('.hm-bars b');
    if (bar) { showSlide([...barsEl.children].indexOf(bar)); return; }
    slides[cur]?.go();
  });

  // ── tiles ──
  let postsSig = '', topPostId = null;
  function renderPosts() {
    const list = (S.posts || []).slice(0, 4);
    const html = list.map(p => {
      const t = apiTime(p.created);
      const img = p.song ? cover(p.song.coverArt, 100) : (p.image_mxc && window.klabResolveFeedImage ? window.klabResolveFeedImage(p.image_mxc) : null);
      const text = plain(p.text);
      return '<div class="hm-pi">' + avatarHTML(p.username) +
        '<div class="hm-pi-tx"><div class="hm-pi-hd">' + nameHTML(p.username) + timeHTML(t) + '</div>' +
          '<p>' + (p.song ? '<i class="ti ti-music"></i> ' + esc(p.song.title || '') + (text ? ' · ' : '') : '') + esc(text) + '</p></div>' +
        (img ? '<div class="hm-th" style="background-image:url(&quot;' + esc(img) + '&quot;)"></div>' : '') +
      '</div>';
    }).join('');
    if (html === postsSig) return;
    postsSig = html;
    postsEl.innerHTML = '<div class="hm-plist">' + html + '</div>';
    // A post that wasn't here a moment ago slides in at the top.
    const topId = list[0]?.id ?? null;
    if (topPostId !== null && topId !== topPostId && motion()) postsEl.querySelector('.hm-pi')?.classList.add('hm-enter');
    topPostId = topId;
  }
  postsEl.addEventListener('click', () => setActiveTab('feed'));

  let listenSig = '';
  function renderListen() {
    const L = (S.listeners || []).slice(0, 4);
    const html = L.length
      ? '<div class="hm-lgrid">' + L.map(l =>
          '<div class="hm-pcard" data-username="' + esc(l.username) + '">' +
            '<div class="hm-art"' + (l.songId ? ' style="background-image:url(&quot;' + esc(cover(l.songId, 100)) + '&quot;)"' : '') + '>' + avatarHTML(l.username) + '</div>' +
            '<div class="hm-pc-tx"><small style="color:' + color(l.username) + '">' + esc(l.username) + (l.playing ? '' : ' · paused') + '</small><b>' + esc(l.song) + '</b><span>' + esc(l.artist || '') + '</span></div>' +
            (l.playing ? '<span class="hm-eq"><i></i><i></i><i></i></span>' : '') +
          '</div>').join('') + '</div>'
      : '<div class="hm-quiet"><i class="ti ti-headphones-off"></i></div>';
    if (html === listenSig) return;
    listenSig = html;
    listenEl.innerHTML = html;
  }
  listenEl.addEventListener('click', e => {
    const card = e.target.closest('.hm-pcard');
    if (card && typeof openProfileView === 'function') openProfileView(card.dataset.username);
  });

  let flowI = 0, flowTimer = 0, flowSig = '';
  function renderFlow() {
    const A = (S.albums || []).slice(0, 9);
    const sig = A.map(a => a.id).join(',');
    if (sig !== flowSig) {
      flowSig = sig;
      flowEl.innerHTML = A.map((a, i) => '<button type="button" class="hm-fc" data-i="' + i + '" title="' + esc((a.name || '') + ' · ' + (a.artist || '')) + '" style="background-image:url(&quot;' + esc(cover(a.coverArt || a.id, 300)) + '&quot;)"></button>').join('');
      flowI = 0;
    }
    layoutFlow();
  }
  function layoutFlow() {
    [...flowEl.children].forEach((c, i) => {
      const d = i - flowI, ad = Math.abs(d);
      c.style.transform = d === 0 ? 'translateZ(24px)' : `translateX(${d * 38 + Math.sign(d) * 40}%) rotateY(${-Math.sign(d) * 58}deg) scale(0.84)`;
      c.style.zIndex = 20 - ad;
      c.style.opacity = ad > 2 ? 0 : 1;
      c.classList.toggle('dim', d !== 0);
    });
  }
  flowEl.addEventListener('click', e => {
    const c = e.target.closest('.hm-fc');
    if (!c) return;
    const i = +c.dataset.i;
    if (i === flowI) openAlbum(S.albums[i]);
    else { flowI = i; layoutFlow(); restartFlow(); }
  });
  function restartFlow() {
    clearInterval(flowTimer);
    if (active && (S.albums || []).length > 1) flowTimer = setInterval(() => { flowI = (flowI + 1) % Math.min(9, S.albums.length); layoutFlow(); }, 4000);
  }
  function openAlbum(a) {
    if (!a) return;
    setActiveTab('music');
    if (window.openAlbumPage) setTimeout(() => window.openAlbumPage(a.id, a.name || a.title), 0);
  }

  let photosSig = '';
  function renderPhotos() {
    const tiles = [];
    (S.photoPosts || []).forEach(pp => (pp.photos || []).forEach(ph => { if (tiles.length < 5) tiles.push(ph.id); }));
    const html = tiles.map((id, i) => '<b style="background-image:url(&quot;' + photoFile(id, i ? 'thumb' : 'display') + '&quot;)"></b>').join('');
    if (html === photosSig) return;
    photosSig = html;
    photosEl.innerHTML = '<div class="hm-pgrid n' + tiles.length + '">' + html + '</div>';
  }
  photosEl.addEventListener('click', () => setActiveTab('photos'));

  let chatSig = '';
  function renderChat() {
    const M = (S.chat || []).slice(-4);
    const html = M.map(m =>
      '<div class="hm-cm" data-room="' + esc(m.roomId) + '">' + avatarHTML(m.u) +
        '<div>' + nameHTML(m.u) + '<span class="hm-cm-body">' + esc(m.body) + '</span></div></div>').join('');
    if (html === chatSig && chatSig) return;
    chatSig = html;
    chatEl.innerHTML = html ? '<div class="hm-clist">' + html + '</div>' : '<div class="hm-quiet"><i class="ti ti-message-circle"></i></div>';
  }
  chatEl.addEventListener('click', e => {
    const m = e.target.closest('.hm-cm');
    if (m && typeof openChatRoom === 'function') openChatRoom(m.dataset.room);
    else setActiveTab('chat');
  });

  // ── data ──
  async function loadPosts() {
    try {
      const d = await getJSON('/api/posts?limit=8');
      S.posts = d.posts || [];
      const p = S.posts[0];
      if (p) live(apiTime(p.created), '<b>' + esc(p.username) + '</b> posted' + (p.song ? ' a song' : ''));
      renderPosts(); renderSpot();
    } catch (e) {}
  }
  async function loadPhotos() {
    try {
      const d = await getJSON('/api/posts/photos?order=posted&limit=6');
      S.photoPosts = d.posts || [];
      const p = S.photoPosts[0];
      if (p) live(apiTime(p.created), '<b>' + esc(p.username) + '</b> posted ' + (p.photos.length > 1 ? p.photos.length + ' photos' : 'a photo'));
      renderPhotos(); renderSpot();
    } catch (e) {}
  }
  let lastSongs = null;
  async function loadPresence() {
    try {
      const d = await getJSON('/api/presence');
      const L = (d.listeners || []).filter(l => l.username !== me() && l.song);
      // Someone pressing play on something new is worth a line.
      const now = new Map(L.filter(l => l.playing).map(l => [l.username, l.songId || l.song]));
      if (lastSongs) now.forEach((song, u) => {
        if (lastSongs.get(u) !== song) {
          const l = L.find(x => x.username === u);
          live(Date.now(), '<b>' + esc(u) + '</b> is listening to ' + esc(l.song));
        }
      });
      lastSongs = now;
      S.listeners = L;
      renderListen();
    } catch (e) {}
  }
  async function loadAlbums() {
    try {
      const r = await fetchTimeout(`${ND_URL}/rest/getAlbumList2?type=newest&size=9&${subsonicParams()}`, {}, 8000);
      const d = await r.json();
      S.albums = d['subsonic-response']?.albumList2?.album || [];
      const a = S.albums[0];
      if (a && a.created) live(new Date(a.created).getTime(), '<b>' + esc(a.name || '') + '</b> by ' + esc(a.artist || '') + ' was added');
      renderFlow(); renderSpot(); restartFlow();
    } catch (e) {}
  }
  // Channels only. A DM has no business on a screen left up for the room.
  function loadChat() {
    const client = window.MatrixChat?.client;
    if (!client) return;
    const dms = typeof getDmRoomIds === 'function' ? getDmRoomIds() : new Set();
    const out = [];
    client.getRooms().forEach(room => {
      if ((room.isSpaceRoom && room.isSpaceRoom()) || room.getMyMembership?.() !== 'join' || dms.has(room.roomId)) return;
      room.getLiveTimeline().getEvents().forEach(ev => {
        if (ev.getType() !== 'm.room.message' || ev.getRelation()?.rel_type === 'm.replace' || ev.isRedacted?.()) return;
        const c = ev.getContent() || {};
        if (!c.body) return;
        out.push({ t: ev.getTs(), roomId: room.roomId, room: room.name, u: localpart(ev.getSender()),
          body: c.msgtype === 'm.image' ? '📷' : c.body.replace(/^> .*\n\n?/gm, '') });
      });
    });
    out.sort((a, b) => a.t - b.t);
    S.chat = out.slice(-6);
    const m = S.chat[S.chat.length - 1];
    if (m) live(m.t, '<b>' + esc(m.u) + '</b> in ' + esc(m.room || 'chat') + ': ' + esc(m.body.slice(0, 80)));
    renderChat();
  }
  if (window.MatrixChat?.on) {
    let q = false;
    const soon = () => { if (!q) { q = true; setTimeout(() => { q = false; loadChat(); }, 300); } };
    MatrixChat.on('sync', state => { if (state === 'PREPARED') soon(); });
    MatrixChat.on('timeline', soon);
  }

  // ── running only while visible ──
  const timers = [];
  function startPolling() {
    stopPolling();
    const every = (fn, ms) => timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
    every(loadPosts, POLL.posts);
    every(loadPhotos, POLL.photos);
    every(loadPresence, POLL.presence);
    every(loadAlbums, POLL.albums);
    every(tickClock, 5000);
    // Avatars and post images resolve in the background; pick them up.
    every(() => { postsSig = listenSig = chatSig = ''; renderPosts(); renderListen(); renderChat(); renderSpot(); }, 20e3);
  }
  function stopPolling() { timers.splice(0).forEach(clearInterval); }
  function refreshAll() { loadPosts(); loadPhotos(); loadPresence(); loadAlbums(); loadChat(); tickClock(); }

  window.klabHomeTabChanged = function(on) {
    if (on === active) return;
    active = on;
    clearTimeout(slideTimer); clearInterval(flowTimer);
    if (on) {
      bdKey = '';
      refreshAll();
      startPolling();
      if (slides.length) showSlide(cur);
      restartFlow();
    } else {
      stopPolling();
    }
  };
  document.addEventListener('visibilitychange', () => { if (active && !document.hidden) refreshAll(); });
  tickClock();
  if (panel.classList.contains('active')) window.klabHomeTabChanged(true);
})();
