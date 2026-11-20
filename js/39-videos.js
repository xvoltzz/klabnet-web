// ══════════════════════════════════════════
//  VIDEOS — klabnet's own YouTube (2026-11-19)
//  People upload a video; klabnet-api (app/routers/videos.py) keeps it on
//  the media share and makes an HLS ladder (1080/720/480/360), a poster and
//  a storyboard for the scrub bar. A video is a `posts` row of its own kind,
//  so its comments and reactions are the Feed's (/api/posts/{id}/replies,
//  /reactions).
//    · The page is a shell like Photos' (index.html #videosShell): its rows
//      (Browse, Continue watching, Your videos) unfold under Videos in the
//      sidebar tree, and its search box goes to the title bar. Browse
//      (view 'home') leads with the newest video big, then Continue
//      watching and the rest. (Popular went, 2026-11-20: the owner, "we
//      dont have neough users". The API's sort=popular stays.)
//    · Watching is a view of the same page (#vidPage), with Back.
//    · The player is klabnet's own controls over a <video>. HLS plays
//      through hls.js (js/vendor/hls.light.min.js, fetched on first play;
//      its ?v= is the library's version) or natively where there's no MSE
//      (iOS Safari).
//    · Where you stopped is kept (PUT …/progress) and offered back:
//      Continue watching, and the bar under a card.
//    · Sharing: to the Feed (a post's `video`), to a chat (`klab.video` in
//      the Matrix message), a link (#videos/<id>), optionally from a moment.
//  window.klabOpenVideo(id, at), klabOpenChannel(username), and
//  klabVideoCardHTML(video) for the Feed and profiles.
// ══════════════════════════════════════════
(function () {
  const $ = id => document.getElementById(id);
  const page = $('vidPage'), nav = $('vidNav');
  if (!page || !nav) return;
  const API = '/api/posts/videos';
  const HLS_LIB = 'js/vendor/hls.light.min.js?v=1.5.20';
  const me = () => window.KLAB_USER?.username || '';
  const admin = () => !!window.KLAB_USER?.is_admin;
  const panel = () => page.closest('.tab-panel');
  const showing = () => document.body.classList.contains('tab-videos-active');

  // ── Little things ──
  const apiTime = s => {
    if (!s) return 0;
    const str = String(s);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime() || 0;
  };
  const ago = s => klabRelativeTime(apiTime(s));
  // When a video came out (published, settable; created for an API from
  // before): "3 days ago" under a week, then "Mar 3, 2019".
  const pubOf = v => v.published || v.created;
  function when(v) {
    const t = apiTime(pubOf(v));
    if (!t) return '';
    if (Date.now() - t < 7 * 864e5) return klabRelativeTime(t);
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function dur(s) {
    s = Math.max(0, Math.floor(+s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  const views = n => klabCount(n || 0, 'view');
  function face(u, cls) {
    const url = window.klabResolveUserAvatar?.(u);
    const color = typeof profileColor === 'function' ? profileColor(u) : '';
    return '<span class="vid-face ' + (cls || '') + '" data-face="' + esc(u) + '" style="--c:' + color + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  // Faces whose picture arrived after they were drawn.
  function refreshFaces(root) {
    (root || page).querySelectorAll('.vid-face[data-face]:not(:has(img))').forEach(el => {
      const url = window.klabResolveUserAvatar?.(el.dataset.face);
      if (url) el.innerHTML = '<img src="' + esc(url) + '" alt="" />';
    });
  }
  async function getJSON(url, opts, ms) {
    // A deadline that covers the body (fetchTimeout's stops at the headers).
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 15000);
    try {
      const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && url.startsWith(API) && !url.slice(API.length).match(/^\/\d/)) server = false;
      if (!r.ok) { const e = new Error(j.error || 'failed (' + r.status + ')'); e.status = r.status; throw e; }
      if (url.startsWith(API)) server = true;
      return j;
    } finally { clearTimeout(t); }
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let server = null; // false: an API without videos

  // ── Cards ──
  function progressOf(v) {
    return v.watched && v.duration ? Math.min(100, v.watched / v.duration * 100) : 0;
  }
  function cardHTML(v, opts) {
    const o = opts || {};
    const p = progressOf(v);
    const proc = v.status !== 'ready';
    const thumb = v.posterSmall
      ? '<img src="' + esc(v.posterSmall) + '" alt="" loading="lazy" draggable="false" />'
      : '<span class="vid-thumb-ph"><i class="ti ti-movie"></i></span>';
    return '<button type="button" class="vid-card' + (o.row ? ' row' : '') + (proc ? ' processing' : '') + '" data-vid-id="' + v.id + '" data-silent>' +
      '<span class="vid-thumb">' + thumb +
        (proc
          ? '<span class="vid-proc">' + (v.status === 'failed' ? '<i class="ti ti-alert-triangle"></i>Couldn’t process it' : '<span class="vid-spin"></span>Processing ' + Math.round((v.progress || 0) * 100) + '%') + '</span>'
          : (v.duration ? '<span class="vid-dur">' + dur(v.duration) + '</span>' : '')) +
        (p ? '<span class="vid-prog"><b style="width:' + p.toFixed(1) + '%"></b></span>' : '') +
      '</span>' +
      '<span class="vid-card-tx">' +
        (o.row || o.noFace ? '' : face(v.username)) +
        '<span class="vid-card-meta">' +
          '<span class="vid-card-title">' + esc(v.title || 'Untitled') + '</span>' +
          (o.noUser ? '' : '<span class="vid-card-sub vid-card-user">' + esc(v.username) + '</span>') +
          '<span class="vid-card-sub">' + views(v.views) + ' · ' + when(v) + '</span>' +
        '</span>' +
      '</span>' +
    '</button>';
  }
  // For the Feed and profiles: a card that opens the video.
  window.klabVideoCardHTML = (v, opts) => cardHTML(v, opts);

  // ── State ──
  const cache = new Map(); // id -> video
  const remember = list => (list || []).forEach(v => cache.set(v.id, v));
  let view = { kind: 'home' };
  let list = [], total = 0, more = false, loading = false, token = 0;
  let restoring = false;

  function setRow(kind) {
    nav.querySelectorAll('.picker-tab[data-vid]').forEach(b => b.classList.toggle('active', b.dataset.vid === kind));
  }
  function record(desc) {
    if (restoring) return;
    window.klabNav?.push({ tab: 'videos', ...desc });
  }

  // ── List views ──
  const VIEWS = {
    home: { title: 'Videos', query: 'sort=new' },
    mine: { title: 'Your videos', query: v => 'user=' + encodeURIComponent(me()) + '&sort=' + (v.sort === 'old' ? 'old' : 'new') },
    channel: { title: v => v.user, query: v => 'user=' + encodeURIComponent(v.user) + '&sort=' + (v.sort === 'old' ? 'old' : 'new') },
    search: { title: v => '“' + v.q + '”', query: v => 'q=' + encodeURIComponent(v.q) },
    continue: { title: 'Continue watching' },
    playlists: { title: 'Playlists' },
    playlist: { title: 'Playlist' },
  };
  // A channel's videos (and yours) in order of when they came out, like
  // YouTube's channel page: Newest or Oldest first, with the years marked.
  const orderHTML = v => '<div class="k-seg vid-order" role="group" aria-label="Order">' +
    '<button type="button" data-order="new" aria-pressed="' + (v.sort !== 'old') + '">Newest</button>' +
    '<button type="button" data-order="old" aria-pressed="' + (v.sort === 'old') + '">Oldest</button></div>';
  let lastYear = 0;
  // The house page head (Photos' twin): the title, its dim count on the
  // baseline, and the page's one action.
  function headHTML(title, sub, extra, action) {
    return '<div class="k-page-head vid-head"><h2 class="k-page-title">' + esc(title) + '</h2><span class="k-page-count" id="vidSub">' + esc(sub || '') + '</span>' +
      '<div class="k-page-actions">' + (extra || '') +
      (action ?? '<button type="button" class="k-btn" data-act="upload"><i class="ti ti-upload"></i><span>Upload</span></button>') + '</div></div>';
  }
  function emptyHTML(text, upload) {
    return '<div class="k-empty vid-empty"><i class="ti ti-movie"></i><div>' + esc(text) + '</div>' +
      (upload ? '<button type="button" class="k-btn" data-act="upload"><i class="ti ti-upload"></i><span>Upload a video</span></button>' : '') + '</div>';
  }
  const LOADING = '<div class="k-empty vid-empty"><i class="ti ti-loader loading-spinner"></i><div>Loading…</div></div>';

  async function showList(v, opts) {
    leaveWatch();
    view = v;
    plRun = null;
    setRow(['home', 'continue', 'mine', 'playlists'].includes(v.kind) ? v.kind : v.kind === 'playlist' ? 'playlists' : '');
    if (!(opts && opts.quiet)) record({ kind: 'list', view: v });
    const my = ++token;
    if (v.kind === 'playlists' || v.kind === 'playlist') { (v.kind === 'playlists' ? showPlaylists : showPlaylist)(v, my); return; }
    const def = VIEWS[v.kind];
    const title = typeof def.title === 'function' ? def.title(v) : def.title;
    list = []; total = 0; more = false;
    const channelHead = v.kind === 'channel'
      ? '<div class="vid-channel">' + face(v.user, 'big') + '<div class="vid-channel-tx"><h2>' + esc(v.user) + '</h2><span id="vidSub"></span></div>' +
        '<div class="vid-channel-acts">' + orderHTML(v) + '<button type="button" class="k-btn" data-act="profile" data-user="' + esc(v.user) + '"><i class="ti ti-user"></i><span>Profile</span></button></div></div>'
      : '';
    page.innerHTML = (channelHead || headHTML(title, '', v.kind === 'mine' ? orderHTML(v) : '')) +
      (v.kind === 'home' ? '<div class="vid-hero-slot" id="vidHero"></div><div class="vid-shelf-wrap" id="vidShelf" hidden></div>' +
        // (Room for TV channels' shelf, js/40-tv.js: see channelsShelf below.)
        '<div class="vid-shelf-wrap" id="vidChannels" hidden></div><div class="vid-shelf-wrap" id="vidPlShelf" hidden></div>' +
        '<div class="k-label vid-label" id="vidLatest" hidden>Latest</div>' : '') +
      '<div class="vid-grid" id="vidGrid">' + LOADING + '</div>';
    if (panel()) panel().scrollTop = 0;
    klabEnter(page);
    if (server === false) { $('vidGrid').innerHTML = emptyHTML('Videos need the latest klabnet-api.'); return; }
    if (v.kind === 'home') { loadShelf(my); playlistsShelf(my); }
    await loadMore(my, true);
  }

  async function loadShelf(my) {
    try {
      const j = await getJSON(API + '/continue');
      if (my !== token) return;
      remember(j.videos);
      const el = $('vidShelf');
      if (!el || !j.videos?.length) return;
      el.hidden = false;
      el.innerHTML = '<div class="k-label vid-label">Continue watching</div><div class="vid-shelf">' + j.videos.map(x => cardHTML(x)).join('') + '</div>';
    } catch (e) { /* the grid says what's wrong */ }
  }

  // ── Browse's lead: the newest video, big ──
  // Its poster wide on the left (a screen, dark in either theme), what it
  // is beside it, Play (or Resume) and the channel.
  function heroHTML(v) {
    const p = progressOf(v);
    return '<section class="vid-hero" data-vid-id="' + v.id + '">' +
      '<button type="button" class="vid-hero-art" data-act="open" data-id="' + v.id + '" title="Play" data-silent>' +
        (v.poster || v.posterSmall ? '<img src="' + esc(v.poster || v.posterSmall) + '" alt="" draggable="false" onload="this.classList.add(\'loaded\')" />' : '<span class="vid-thumb-ph"><i class="ti ti-movie"></i></span>') +
        '<span class="vid-hero-play"><i class="ti ti-player-play-filled"></i></span>' +
        (v.duration ? '<span class="vid-dur">' + dur(v.duration) + '</span>' : '') +
        (p ? '<span class="vid-prog"><b style="width:' + p.toFixed(1) + '%"></b></span>' : '') +
      '</button>' +
      '<div class="vid-hero-tx">' +
        '<div class="k-label">Newest</div>' +
        '<h3 class="vid-hero-title">' + esc(v.title || 'Untitled') + '</h3>' +
        '<button type="button" class="vid-hero-by" data-act="channel" data-user="' + esc(v.username) + '">' + face(v.username) + '<span>' + esc(v.username) + '</span></button>' +
        '<div class="vid-hero-meta">' + views(v.views) + ' · ' + when(v) + '</div>' +
        (v.description ? '<p class="vid-hero-desc">' + esc(v.description) + '</p>' : '') +
        '<div class="vid-hero-acts">' +
          '<button type="button" class="k-btn primary" data-act="open" data-id="' + v.id + '"><i class="ti ti-player-play-filled"></i><span>' + (p ? 'Resume at ' + dur(v.watched) : 'Play') + '</span></button>' +
          '<button type="button" class="k-btn" data-act="channel" data-user="' + esc(v.username) + '"><i class="ti ti-user"></i><span>Channel</span></button>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  // TV channels (js/40-tv.js), as a shelf on Browse, if that file offers
  // a list: window.klabTv.channels() → [{ id, name, … }] and
  // window.klabTv.open(id). Nothing shows without it.
  function channelsShelf() {
    const el = $('vidChannels');
    const tv = window.klabTv;
    if (!el || !tv || typeof tv.channels !== 'function') return;
    Promise.resolve(tv.channels()).then(chs => {
      if (!el.isConnected || !Array.isArray(chs) || !chs.length) return;
      el.hidden = false;
      el.innerHTML = '<div class="k-label vid-label">Channels</div><div class="vid-shelf vid-tv-shelf">' +
        chs.slice(0, 12).map(c => '<button type="button" class="vid-tv-card" data-act="tv" data-id="' + esc(c.id) + '" data-silent>' +
          '<span class="vid-thumb">' + (c.poster || c.posterSmall || c.cover ? '<img src="' + esc(c.posterSmall || c.poster || c.cover) + '" alt="" loading="lazy" draggable="false" />' : '<span class="vid-thumb-ph"><i class="ti ti-movie"></i></span>') + '</span>' +
          '<span class="vid-card-title">' + esc(c.name || c.title || 'Channel') + '</span></button>').join('') + '</div>';
    }).catch(() => {});
  }

  async function loadMore(my, first) {
    if (loading && !first) return;
    loading = true;
    const v = view, def = VIEWS[v.kind];
    try {
      let url;
      if (v.kind === 'continue') url = API + '/continue';
      else {
        const q = typeof def.query === 'function' ? def.query(v) : def.query;
        const last = list[list.length - 1];
        url = API + '?limit=24&' + q + (last ? '&before_id=' + last.id : '');
      }
      const j = await getJSON(url);
      if (my !== token) return;
      let got = j.videos || [];
      remember(got);
      list = list.concat(got);
      // Browse's first page: the newest ready video leads, big, and the
      // grid under it is the rest.
      if (v.kind === 'home' && first) {
        const lead = got.find(x => x.status === 'ready');
        const slot = $('vidHero');
        if (lead && slot) { slot.innerHTML = heroHTML(lead); got = got.filter(x => x !== lead); }
        channelsShelf();
      }
      total = j.total ?? list.length;
      more = v.kind !== 'continue' && got.length >= 24 && list.length < total;
      const grid = $('vidGrid');
      if (!grid) return;
      if (first) { grid.innerHTML = ''; lastYear = 0; }
      if (!list.length) {
        const words = { home: 'No videos yet. Be the first.', continue: 'Nothing to pick up again. Videos you stop partway show here.',
          mine: 'You haven’t uploaded anything yet.', channel: v.user + ' hasn’t uploaded anything yet.', search: 'Nothing matches that.' };
        grid.innerHTML = emptyHTML(words[v.kind], ['home', 'mine'].includes(v.kind));
      } else if (got.length) {
        const own = v.kind === 'channel' || v.kind === 'mine';
        grid.insertAdjacentHTML('beforeend', got.map(x => {
          // The years, on a channel: a label across the grid where one starts.
          let year = '';
          if (own) {
            const y = new Date(apiTime(pubOf(x))).getFullYear();
            if (y && y !== lastYear) { lastYear = y; year = '<div class="k-label vid-year">' + y + '</div>'; }
          }
          return year + cardHTML(x, { noUser: own, noFace: own });
        }).join(''));
      }
      if (v.kind === 'home') { const l = $('vidLatest'); if (l) l.hidden = !grid.querySelector('.vid-card'); }
      const sub = $('vidSub');
      if (sub) sub.textContent = total ? klabCount(total, 'video') : '';
      watchProcessing();
      setTimeout(() => refreshFaces(), 1500);
    } catch (e) {
      if (my !== token) return;
      const grid = $('vidGrid');
      if (grid && !list.length) grid.innerHTML = emptyHTML(server === false ? 'Videos need the latest klabnet-api.' : 'Couldn’t load videos just now.');
    } finally { if (my === token) loading = false; }
  }
  // The next page as the list nears its end.
  document.addEventListener('scroll', e => {
    const p = panel();
    if (e.target !== p || !more || loading || view.kind === 'watch') return;
    if (p.scrollTop + p.clientHeight > p.scrollHeight - 600) loadMore(token);
  }, true);

  // Cards of videos still processing tick along until they're done.
  let procTimer = 0;
  function watchProcessing() {
    clearTimeout(procTimer);
    const ids = [...page.querySelectorAll('.vid-card.processing')].map(c => +c.dataset.vidId).filter(id => cache.get(id)?.status === 'processing');
    if (!ids.length || !showing()) return;
    procTimer = setTimeout(async () => {
      for (const id of ids) {
        try {
          const v = await getJSON(API + '/' + id, null, 8000);
          cache.set(v.id, v);
          page.querySelectorAll('.vid-card[data-vid-id="' + id + '"]').forEach(c => { c.outerHTML = cardHTML(v, { noUser: c.querySelector('.vid-card-user') == null, noFace: !c.querySelector('.vid-face'), row: c.classList.contains('row') }); });
          if (view.kind === 'watch' && view.id === id && v.status !== 'processing') openVideo(id, 0, { quiet: true, fresh: v, keep: true });
        } catch (e) {}
      }
      watchProcessing();
    }, 4000);
  }

  // ── Watching ──
  let cur = null;        // the video showing
  // Playing through a playlist: { pl (its summary), videos, i }. The watch
  // view's side shows it instead of Up next, and the end goes on to the
  // next one (after a 5s you can stop; only here, never for one video).
  let plRun = null;
  let hls = null, video = null, player = null;
  let srcKind = 'hls';   // what the <video> plays: the HLS ladder, or the Original mp4
  let viewSent = false, played = 0, lastTick = 0, lastSave = 0;

  async function openVideo(id, at, opts) {
    id = +id;
    if (!id) return;
    const o = opts || {};
    if (!showing()) setActiveTab('videos');
    leaveWatch();
    if ('list' in o) plRun = o.list; else if (!o.keep) plRun = null;
    view = { kind: 'watch', id };
    setRow(plRun ? 'playlists' : '');
    if (!o.quiet) record({ kind: 'watch', id, ...(plRun ? { pl: plRun.pl.id, i: plRun.i } : {}) });
    const my = ++token;
    let v = o.fresh || cache.get(id);
    page.innerHTML = '<div class="vid-watch"><div class="vid-watch-main"><button type="button" class="k-btn sm vid-back" data-act="back"><i class="ti ti-arrow-left"></i><span>Back</span></button>' +
      '<div class="vp vp-loading">' + LOADING + '</div></div></div>';
    if (panel()) panel().scrollTop = 0;
    try {
      if (!o.fresh) v = await getJSON(API + '/' + id);
    } catch (e) {
      if (my !== token) return;
      page.querySelector('.vp').innerHTML = '<div class="k-empty vid-empty"><i class="ti ti-movie-off"></i><div>' + (e.status === 404 ? 'That video’s gone.' : 'Couldn’t load that video.') + '</div></div>';
      return;
    }
    if (my !== token) return;
    cache.set(v.id, v);
    cur = v;
    renderWatch(v);
    if (v.status === 'ready') mountPlayer(v, at > 0 ? at : (v.watched && v.watched < v.duration * 0.95 ? v.watched : 0), !!(at > 0) || o.autoplay !== false);
    else watchProcessing();
    loadComments(v);
    if (plRun) paintRun(); else loadUpNext(v, my);
  }
  window.klabOpenVideo = (id, at) => openVideo(id, at || 0);
  // For watch parties (js/41-rooms.js): what's showing, and opening one
  // where the room is (opts.autoplay false: paused there).
  window.klabWatch = {
    video: () => video, current: () => cur, watching: () => showing() && view.kind === 'watch',
    open: (id, at, opts) => openVideo(id, at || 0, opts),
  };
  window.klabOpenChannel = user => { if (!showing()) setActiveTab('videos'); showList({ kind: 'channel', user }); };
  // TV channels (js/40-tv.js) take the page over: what's playing here
  // stops and any list still loading lets go.
  window.klabVideosLeave = () => { leaveWatch(); view = { kind: 'tv' }; token++; more = false; clearTimeout(procTimer); };

  function canEdit(v) { return v.canEdit ?? (v.username === me() || admin()); }

  function renderWatch(v) {
    const desc = v.description || '';
    page.innerHTML =
      '<div class="vid-watch">' +
        '<div class="vid-watch-main">' +
          '<button type="button" class="k-btn sm vid-back" data-act="back"><i class="ti ti-arrow-left"></i><span>Back</span></button>' +
          // A watch party's bar (js/41-rooms.js), while you're in one.
          '<div class="room-bar" id="vidRoomBar" hidden></div>' +
          '<div class="vp" id="vidPlayer" tabindex="0">' +
            (v.status === 'ready' ? '' :
              '<div class="vp-wait">' + (v.poster ? '<img src="' + esc(v.poster) + '" alt="" />' : '') +
              '<div class="vp-wait-tx">' + (v.status === 'failed'
                ? '<i class="ti ti-alert-triangle"></i><b>Couldn’t process this video</b><span>' + esc(v.error || 'The file may be damaged or in a format ffmpeg can’t read.') + '</span>'
                : '<span class="vid-spin"></span><b>Processing</b><span>' + Math.round((v.progress || 0) * 100) + '% · it plays here once it’s done</span>') + '</div></div>') +
          '</div>' +
          '<h1 class="vid-title">' + esc(v.title || 'Untitled') + '</h1>' +
          '<div class="vid-by">' +
            '<button type="button" class="vid-by-who" data-act="channel" data-user="' + esc(v.username) + '" data-silent>' + face(v.username) +
              '<span><b>' + esc(v.username) + '</b><span>' + views(v.views) + ' · <span title="' + esc(new Date(apiTime(pubOf(v))).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })) + '">' + when(v) + '</span></span></span></button>' +
            '<div class="vid-acts">' +
              '<div class="vid-reacts" id="vidReacts">' + reactsHTML(v) + '</div>' +
              (v.status === 'ready' && window.klabRooms ? '<button type="button" class="k-btn" data-act="together" id="vidTogether"><i class="ti ti-users"></i><span>Watch together</span></button>' : '') +
              '<button type="button" class="k-btn" data-act="share"><i class="ti ti-share-2"></i><span>Share</span></button>' +
              '<button type="button" class="k-btn" data-act="save" title="Save to playlist"><i class="ti ti-playlist-add"></i><span>Save</span></button>' +
              (canEdit(v) ? '<button type="button" class="k-icon" data-act="edit" title="Edit video" aria-label="Edit video"><i class="ti ti-pencil"></i></button>' +
                '<button type="button" class="k-icon vid-del" data-act="delete" title="Delete video" aria-label="Delete video"><i class="ti ti-trash"></i></button>' : '') +
            '</div>' +
          '</div>' +
          (desc ? '<div class="vid-desc" id="vidDesc"><div class="vid-desc-tx">' + descHTML(desc) + '</div><button type="button" class="vid-more" data-act="more" hidden>Show more</button></div>' : '') +
          '<div class="vid-comments">' +
            '<div class="k-label vid-label" id="vidComCount">Comments</div>' +
            klabComments.formHTML({ formId: 'vidComForm', id: 'vidComInput' }) +
            '<div class="k-com-list vid-com-list" id="vidComList"><div class="k-empty k-com-empty">Loading…</div></div>' +
          '</div>' +
        '</div>' +
        '<aside class="vid-watch-side"><div class="k-label vid-label">Up next</div><div class="vid-next" id="vidNext"></div></aside>' +
      '</div>';
    const d = $('vidDesc');
    if (d) requestAnimationFrame(() => { const tx = d.querySelector('.vid-desc-tx'); if (tx.scrollHeight > tx.clientHeight + 4) d.querySelector('.vid-more').hidden = false; });
    setTimeout(() => refreshFaces(), 1500);
  }
  function descHTML(text) {
    // Mentions and links, like a feed post; "1:32" jumps there.
    const seg = t => (window.klabMentionsHTML ? klabMentionsHTML(t) : esc(t));
    let h = typeof linkifyHTML === 'function' ? linkifyHTML(text, seg) : seg(text);
    h = h.replace(/(^|[\s(])((?:\d+:)?\d{1,2}:\d{2})(?=[\s).,]|$)/g, (m, pre, t) => {
      const secs = t.split(':').reduce((a, b) => a * 60 + +b, 0);
      return pre + '<button type="button" class="vid-stamp" data-at="' + secs + '" data-silent>' + t + '</button>';
    });
    return h.replace(/\n/g, '<br>');
  }
  function reactsHTML(v) {
    const r = v.reactions || {};
    const star = r[KLAB_STAR] || { count: 0, mine: false };
    return '<button type="button" class="vid-pill vid-star' + (star.mine ? ' mine' : '') + '" data-emoji="' + KLAB_STAR + '" aria-pressed="' + !!star.mine + '" title="' + (star.mine ? 'Unstar' : 'Star') + '">' +
        '<i class="ti ' + (star.mine ? 'ti-star-filled' : 'ti-star') + '"></i>' + (star.count ? '<span>' + star.count + '</span>' : '') + '</button>' +
      Object.entries(r).filter(([e]) => e !== KLAB_STAR).map(([e, x]) =>
        '<button type="button" class="vid-pill' + (x.mine ? ' mine' : '') + '" data-emoji="' + esc(e) + '">' + klabReactHTML(e) + '<span>' + x.count + '</span></button>').join('') +
      '<button type="button" class="vid-pill vid-react-add" title="React"><i class="ti ti-mood-plus"></i></button>';
  }
  let reactSeq = 0;
  async function toggleReaction(emoji) {
    const v = cur;
    if (!v) return;
    const seq = ++reactSeq;
    try {
      const j = await getJSON('/api/posts/' + v.id + '/reactions', json('PUT', { emoji }), 8000);
      if (seq !== reactSeq || cur !== v) return;
      v.reactions = j.reactions || {};
      $('vidReacts').innerHTML = reactsHTML(v);
    } catch (e) { showToast('Couldn’t react. Try again', 'ti-alert-triangle'); }
  }

  let upNext = [];
  async function loadUpNext(v, my) {
    let pool = list.filter(x => x.id !== v.id && x.status === 'ready');
    if (pool.length < 8) {
      try {
        const j = await getJSON(API + '?limit=24&sort=new');
        remember(j.videos);
        const seen = new Set(pool.map(x => x.id));
        pool = pool.concat((j.videos || []).filter(x => x.id !== v.id && x.status === 'ready' && !seen.has(x.id)));
      } catch (e) {}
    }
    if (my !== token) return;
    // Theirs first, then the rest, newest first.
    pool.sort((a, b) => (b.username === v.username) - (a.username === v.username) || apiTime(pubOf(b)) - apiTime(pubOf(a)) || b.id - a.id);
    const el = $('vidNext');
    if (!el) return;
    upNext = pool.slice(0, 12);
    el.innerHTML = pool.length ? upNext.map(x => cardHTML(x, { row: true })).join('') : '<div class="k-com-empty">Nothing else yet.</div>';
    klabEnter(el);
  }

  // ── Comments (the Feed's replies) ──
  async function loadComments(v) {
    const el = $('vidComList');
    try {
      const j = await getJSON('/api/posts/' + v.id + '/replies', null, 8000);
      if (cur !== v) return;
      renderComments(v, j.replies || []);
    } catch (e) { if (cur === v && el) el.innerHTML = '<div class="k-com-empty">Couldn’t load comments.</div>'; }
  }
  function renderComments(v, replies) {
    v._replies = replies;
    const el = $('vidComList');
    if (!el) return;
    $('vidComCount').textContent = replies.length ? klabCount(replies.length, 'comment') : 'Comments';
    el.innerHTML = klabComments.listHTML(replies, { postId: v.id, text: r => descHTML(r.text || '') }, 'No comments yet. Say something.');
    setTimeout(() => klabComments.refreshFaces(page), 1500);
  }
  // At once, with Undo (the kit's way).
  function deleteComment(v, replyId) {
    const reply = (v._replies || []).find(r => String(r.id) === String(replyId));
    if (!reply) return;
    const row = $('vidComList')?.querySelector('.k-com[data-reply-id="' + reply.id + '"]');
    klabComments.del({
      postId: v.id, reply, row,
      apply: () => { if (cur === v) renderComments(v, (v._replies || []).filter(r => r !== reply)); },
      undo: () => { if (cur === v) renderComments(v, (v._replies || []).filter(r => r !== reply).concat(reply).sort((a, b) => a.id - b.id)); },
    });
  }
  page.addEventListener('submit', async e => {
    if (e.target.id !== 'vidComForm') return;
    e.preventDefault();
    const input = $('vidComInput'), v = cur, text = input.value.trim();
    if (!text || !v) return;
    input.disabled = true;
    try {
      const reply = await getJSON('/api/posts/' + v.id + '/replies', json('POST', { text }), 8000);
      input.value = '';
      klabComments.fresh(reply.id);
      if (cur === v) renderComments(v, (v._replies || []).concat(reply));
      SFX && SFX.play('star');
    } catch (err) { showToast('Couldn’t post that comment', 'ti-alert-triangle'); }
    finally { input.disabled = false; input.focus(); }
  });

  // ── The player ──
  let hlsLoading = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return hlsLoading ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HLS_LIB;
      s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('no Hls')));
      s.onerror = () => { hlsLoading = null; reject(new Error('couldn’t load the player')); };
      document.head.appendChild(s);
    });
  }
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('klabnet_video') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('klabnet_video', JSON.stringify(prefs)); } catch {} };

  function mountPlayer(v, start, autoplay) {
    const box = $('vidPlayer');
    box.innerHTML =
      '<video playsinline preload="metadata"></video>' +
      // The poster over the video, faded out once the first frame is up
      // (a <video>'s own poster just snaps to it).
      (v.poster ? '<img class="vp-poster" src="' + esc(v.poster) + '" alt="" draggable="false" />' : '') +
      '<div class="vp-end" hidden></div>' +
      '<button type="button" class="vp-big" data-vp="play" aria-label="Play" data-silent><i class="ti ti-player-play-filled"></i></button>' +
      '<div class="vp-spin" hidden><span class="vid-spin"></span></div>' +
      '<div class="vp-ctrl">' +
        '<div class="vp-scrub" data-vp="scrub"><div class="vp-rail"><b class="vp-buf"></b><b class="vp-fill"></b><i class="vp-knob"></i></div>' +
          '<div class="vp-peek" hidden><span class="vp-peek-img"></span><span class="vp-peek-t"></span></div></div>' +
        '<div class="vp-row">' +
          '<button type="button" class="vp-btn" data-vp="play" title="Play (k)" data-silent><i class="ti ti-player-play-filled"></i></button>' +
          '<button type="button" class="vp-btn" data-vp="back10" title="Back 10s (j)" data-silent><i class="ti ti-rotate-2"></i></button>' +
          '<button type="button" class="vp-btn" data-vp="fwd10" title="Forward 10s (l)" data-silent><i class="ti ti-rotate-clockwise-2"></i></button>' +
          '<div class="vp-vol"><button type="button" class="vp-btn" data-vp="mute" title="Mute (m)" data-silent><i class="ti ti-volume"></i></button>' +
            '<input type="range" class="vp-vol-range" min="0" max="1" step="0.02" aria-label="Volume" /></div>' +
          '<span class="vp-time"><span class="vp-now">0:00</span> / <span class="vp-len">' + dur(v.duration) + '</span></span>' +
          '<span class="vp-gap"></span>' +
          '<button type="button" class="vp-btn vp-text" data-vp="speed" title="Speed">1×</button>' +
          '<button type="button" class="vp-btn vp-text" data-vp="quality" title="Quality">Auto</button>' +
          (document.pictureInPictureEnabled ? '<button type="button" class="vp-btn" data-vp="pip" title="Picture in picture" data-silent><i class="ti ti-picture-in-picture"></i></button>' : '') +
          '<button type="button" class="vp-btn" data-vp="full" title="Full screen (f)" data-silent><i class="ti ti-arrows-maximize"></i></button>' +
        '</div>' +
        '<div class="vp-menu" hidden></div>' +
      '</div>';
    video = box.querySelector('video');
    player = box;
    video.volume = prefs.volume ?? 1;
    video.muted = !!prefs.muted;
    // The speed you last picked, here (per device, klabnet_video).
    video.playbackRate = SPEEDS.includes(prefs.speed) ? prefs.speed : 1;
    video.defaultPlaybackRate = video.playbackRate;
    viewSent = false; played = 0; lastTick = 0; lastSave = 0;
    box.classList.add('paused', 'fresh');
    // Original (the upload itself) when it's been picked on this device
    // before and this browser plays it; otherwise the ladder.
    if (prefs.original && canOriginal(v)) startOriginal(v, start, autoplay);
    else startHls(v, start, autoplay);
    for (const ev of ['play', 'pause', 'timeupdate', 'progress', 'volumechange', 'ratechange', 'durationchange']) video.addEventListener(ev, paint);
    video.addEventListener('play', () => { box.classList.remove('paused', 'fresh', 'ended'); box.querySelector('.vp-end').hidden = true; quietMusic(); wake(); });
    video.addEventListener('playing', () => box.classList.add('started'), { once: true });
    video.addEventListener('pause', () => { box.classList.add('paused'); saveProgress(); wake(); });
    video.addEventListener('waiting', () => { box.querySelector('.vp-spin').hidden = false; });
    for (const ev of ['playing', 'canplay', 'seeked']) video.addEventListener(ev, () => { box.querySelector('.vp-spin').hidden = true; });
    video.addEventListener('timeupdate', tick);
    video.addEventListener('seeking', () => {
      if (box.classList.contains('ended') && video.currentTime < (video.duration || 0) - 0.5) { box.classList.remove('ended'); box.querySelector('.vp-end').hidden = true; }
    });
    video.addEventListener('ended', () => { saveProgress(true); sendView(); box.classList.add('paused'); endCard(); });
    video.addEventListener('click', () => togglePlay());
    video.addEventListener('dblclick', () => toggleFull());
    box.addEventListener('pointermove', wake);
    // The pointer leaving: the controls go a moment later (600ms), fading.
    box.addEventListener('pointerleave', () => {
      clearTimeout(idleT);
      idleT = setTimeout(() => { if (video && !video.paused && !player?.querySelector('.vp-menu:not([hidden])')) player.classList.add('idle'); }, 600);
    });
    const vol = box.querySelector('.vp-vol-range');
    vol.value = video.muted ? 0 : video.volume;
    vol.addEventListener('input', () => { video.volume = +vol.value; video.muted = +vol.value === 0; prefs.volume = video.volume; prefs.muted = video.muted; savePrefs(); });
    scrubber(box.querySelector('.vp-scrub'), v);
    // A watch party (js/41-rooms.js) follows this player.
    document.dispatchEvent(new CustomEvent('klab:watch', { detail: { v, video } }));
  }

  // ── What the player plays: the ladder (HLS) or the Original ──
  // The Original is the upload remuxed into an mp4 (klabnet-api's
  // original.mp4), played straight off the media share at its own
  // bitrate: on the LAN, the real thing. Picking it (or a rung) switches
  // the <video> at the same moment, and it's remembered per device.
  let knownLevels = [];
  const CODEC_TEST = { h264: 'avc1.640033', hevc: 'hvc1.1.6.L153.B0', av1: 'av01.0.12M.08', vp9: 'vp09.00.51.08' };
  function canOriginal(v) {
    const o = v && v.original;
    if (!o || !o.url || !CODEC_TEST[o.codec]) return false;
    try { return !!document.createElement('video').canPlayType('video/mp4; codecs="' + CODEC_TEST[o.codec] + '"'); } catch { return false; }
  }
  // "1080p60", "2160p": the short side, and the rate when it's over 30.
  const rungName = (h, w, fps) => Math.min(h || 0, w || h || 0) + 'p' + (fps > 30.5 ? Math.round(fps) : '');
  const levelName = l => rungName(l.height, l.width, l.frameRate || l.fps);
  const mbps = b => (b / 1e6).toFixed(b >= 1e7 ? 0 : 1) + ' Mbps';
  function saveBw() {
    const bw = hls && hls.bandwidthEstimate;
    if (bw > 0 && isFinite(bw)) { prefs.bw = Math.round(bw); savePrefs(); }
  }
  function startHls(v, start, autoplay, level) {
    const box = player, el = video;
    srcKind = 'hls';
    const src = v.hls;
    const native = !window.MediaSource && el.canPlayType('application/vnd.apple.mpegurl');
    const begin = () => {
      if (start > 0) { try { el.currentTime = start; } catch {} }
      paint();
      if (autoplay) el.play().catch(() => box.classList.add('paused'));
    };
    paintQuality();
    if (native) {
      el.src = src;
      el.addEventListener('loadedmetadata', begin, { once: true });
      return;
    }
    loadHls().then(Hls => {
      if (el !== video || srcKind !== 'hls') return;
      if (!Hls.isSupported()) { el.src = src; el.addEventListener('loadedmetadata', begin, { once: true }); return; }
      // Not capped to the player's size (people here care about the
      // bitrate), and starting from the last speed this device measured.
      hls = new Hls({ capLevelToPlayerSize: false, startPosition: start > 0 ? start : -1, maxBufferLength: 30,
        abrEwmaDefaultEstimate: prefs.bw > 0 ? prefs.bw : 8e6, ...(level >= 0 ? { startLevel: level } : {}) });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        knownLevels = hls.levels.map((l, i) => ({ i, height: l.height, width: l.width, frameRate: l.frameRate }));
        if (level >= 0) hls.currentLevel = level;
        paintQuality(); if (autoplay) el.play().catch(() => box.classList.add('paused')); paint();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, paintQuality);
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else { showToast('This video won’t play', 'ti-alert-triangle'); }
      });
      hls.loadSource(src);
      hls.attachMedia(el);
    }).catch(e => showToast('Couldn’t start the player: ' + e.message, 'ti-alert-triangle'));
  }
  function startOriginal(v, start, autoplay) {
    const el = video;
    srcKind = 'original';
    if (hls) { saveBw(); try { hls.destroy(); } catch {} hls = null; }
    el.src = v.original.url;
    el.addEventListener('loadedmetadata', () => {
      if (start > 0) { try { el.currentTime = start; } catch {} }
      paint();
      if (autoplay) el.play().catch(() => player?.classList.add('paused'));
    }, { once: true });
    // A file this browser turns out not to play: back to the ladder.
    el.addEventListener('error', () => {
      if (el !== video || srcKind !== 'original') return;
      showToast('The original won’t play here. Back to the stream', 'ti-alert-triangle');
      prefs.original = false; savePrefs();
      el.removeAttribute('src'); try { el.load(); } catch {}
      startHls(v, start, autoplay);
    }, { once: true });
    paintQuality();
  }
  function switchTo(kind, level) {
    if (!video || !cur) return;
    const t = video.currentTime || 0, was = !video.paused;
    if (kind === 'original') { video.removeAttribute('src'); try { video.load(); } catch {} startOriginal(cur, t, was); }
    else if (srcKind === 'original') { video.removeAttribute('src'); try { video.load(); } catch {} startHls(cur, t, was, level); }
    else if (hls) { hls.currentLevel = level; paintQuality(); }
  }
  function pickLevel(i) {
    prefs.original = false; savePrefs();
    if (srcKind === 'original') switchTo('hls', i);
    else if (hls) { hls.currentLevel = i; paintQuality(); }
  }

  let idleT = 0;
  function wake() {
    if (!player) return;
    player.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (video && !video.paused && !player.querySelector('.vp-menu:not([hidden])')) player.classList.add('idle'); }, 2600);
  }
  function paint() {
    if (!video || !player) return;
    const d = video.duration || cur?.duration || 0, t = video.currentTime || 0;
    player.querySelector('.vp-fill').style.width = (d ? t / d * 100 : 0) + '%';
    player.querySelector('.vp-knob').style.left = (d ? t / d * 100 : 0) + '%';
    let buf = 0;
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 0.5) buf = Math.max(buf, video.buffered.end(i));
    player.querySelector('.vp-buf').style.width = (d ? buf / d * 100 : 0) + '%';
    player.querySelector('.vp-now').textContent = dur(t);
    if (d) player.querySelector('.vp-len').textContent = dur(d);
    const playIco = video.paused ? 'ti-player-play-filled' : 'ti-player-pause-filled';
    player.querySelectorAll('[data-vp="play"] i').forEach(i => { i.className = 'ti ' + playIco; });
    player.querySelector('[data-vp="play"].vp-btn').title = (video.paused ? 'Play' : 'Pause') + ' (k)';
    const m = player.querySelector('[data-vp="mute"] i');
    m.className = 'ti ' + (video.muted || video.volume === 0 ? 'ti-volume-off' : 'ti-volume');
    player.querySelector('[data-vp="speed"]').textContent = video.playbackRate + '×';
  }
  function paintQuality() {
    const b = player?.querySelector('[data-vp="quality"]');
    if (!b) return;
    if (srcKind === 'original') { b.hidden = false; b.innerHTML = '<span class="vp-tag">Original</span>'; return; }
    if (!hls || !hls.levels?.length) { b.hidden = !cur?.original; b.textContent = 'Auto'; return; }
    b.hidden = false;
    const lvl = hls.levels[hls.currentLevel];
    b.textContent = hls.autoLevelEnabled ? 'Auto' + (lvl ? ' · ' + levelName(lvl) : '') : (lvl ? levelName(lvl) : 'Auto');
  }
  function scrubber(el, v) {
    const peek = el.querySelector('.vp-peek'), img = peek.querySelector('.vp-peek-img'), tl = peek.querySelector('.vp-peek-t');
    const sb = v.storyboard;
    if (sb) {
      img.style.backgroundImage = 'url("' + sb.url + '")';
      img.style.backgroundSize = (sb.cols * sb.w) + 'px ' + (sb.rows * sb.h) + 'px';
      img.style.width = sb.w + 'px'; img.style.height = sb.h + 'px';
    } else img.hidden = true;
    const at = e => {
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      return { f, t: f * (video.duration || v.duration || 0), x: e.clientX - r.left, w: r.width };
    };
    const show = e => {
      const p = at(e);
      peek.hidden = false;
      tl.textContent = dur(p.t);
      if (sb) {
        const i = Math.min(sb.count - 1, Math.floor(p.t / sb.interval));
        img.style.backgroundPosition = -(i % sb.cols) * sb.w + 'px ' + -Math.floor(i / sb.cols) * sb.h + 'px';
      }
      const half = (sb ? sb.w : 60) / 2;
      peek.style.left = Math.min(p.w - half, Math.max(half, p.x)) + 'px';
    };
    let drag = false;
    el.addEventListener('pointermove', e => { show(e); if (drag) seekTo(at(e).t, true); });
    el.addEventListener('pointerleave', () => { if (!drag) peek.hidden = true; });
    el.addEventListener('pointerdown', e => {
      drag = true; el.setPointerCapture(e.pointerId); el.classList.add('drag');
      seekTo(at(e).t, true);
    });
    const end = e => { if (!drag) return; drag = false; el.classList.remove('drag'); peek.hidden = true; seekTo(at(e).t); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function seekTo(t, live) {
    if (!video) return;
    const d = video.duration || cur?.duration || 0;
    t = Math.max(0, Math.min(d ? d - 0.1 : t, t));
    if (live && video.fastSeek) video.fastSeek(t); else video.currentTime = t;
    paint();
  }
  function togglePlay() {
    if (!video) return;
    if (video.paused || video.ended) video.play().catch(() => {}); else video.pause();
    SFX && SFX.play('click');
  }
  function toggleFull() {
    if (!player) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (player.requestFullscreen || player.webkitRequestFullscreen)?.call(player);
  }
  // The end: a calm card over the last frame. Replay, and the next video
  // if there is one; nothing plays by itself, except inside a playlist,
  // where the next one starts after 5s (Cancel stops it).
  let nextT = 0;
  const stopNext = () => { clearInterval(nextT); nextT = 0; };
  function endCard() {
    const box = player, el = box?.querySelector('.vp-end');
    if (!el) return;
    box.classList.add('ended');
    stopNext();
    const inRun = !!plRun;
    const ri = inRun ? plRun.videos.findIndex((x, k) => k > plRun.i && x.status === 'ready') : -1;
    const next = inRun ? plRun.videos[ri] : upNext.find(x => x.status === 'ready');
    el.innerHTML = '<div class="vp-end-in">' +
      '<button type="button" class="k-btn on-media" data-end="replay"><i class="ti ti-rotate-2"></i><span>Replay</span></button>' +
      (next ? '<button type="button" class="vp-end-next" data-end="next" data-vid-next="' + next.id + '"' + (inRun ? ' data-run-i="' + ri + '"' : '') + '>' +
        (next.posterSmall ? '<img src="' + esc(next.posterSmall) + '" alt="" />' : '<span class="vid-thumb-ph"><i class="ti ti-movie"></i></span>') +
        '<span class="vp-end-tx"><small' + (inRun ? ' id="vidNextIn"' : '') + '>' + (inRun ? 'Next in 5s' : 'Up next') + '</small><b>' + esc(next.title || 'Untitled') + '</b><span>' + esc(next.username) + '</span></span></button>' +
        (inRun ? '<button type="button" class="k-btn on-media sm" data-end="cancel">Cancel</button>' : '')
        : (inRun ? '<span class="vp-end-note">End of “' + esc(plRun.pl.name) + '”</span>' : '')) +
    '</div>';
    el.hidden = false;
    if (inRun && next) {
      let left = 5;
      nextT = setInterval(() => {
        left--;
        const t = $('vidNextIn');
        if (!t || !player?.classList.contains('ended')) { stopNext(); return; }
        if (left > 0) { t.textContent = 'Next in ' + left + 's'; return; }
        stopNext();
        runTo(ri);
      }, 1000);
    }
  }
  page.addEventListener('click', e => {
    const b = e.target.closest('[data-end]');
    if (!b || !video) return;
    e.stopPropagation();
    stopNext();
    if (b.dataset.end === 'replay') { seekTo(0); video.play().catch(() => {}); }
    else if (b.dataset.end === 'cancel') { const t = $('vidNextIn'); if (t) t.textContent = 'Next'; b.remove(); }
    else if (b.dataset.runI != null) runTo(+b.dataset.runI);
    else openVideo(+b.dataset.vidNext);
  }, true);
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement && document.fullscreenElement === player;
    player?.classList.toggle('full', on);
    const i = player?.querySelector('[data-vp="full"] i');
    if (i) i.className = 'ti ' + (on ? 'ti-arrows-minimize' : 'ti-arrows-maximize');
  });

  function menu(kind) {
    const m = player.querySelector('.vp-menu');
    if (!m.hidden && m.dataset.kind === kind) { m.hidden = true; return; }
    m.dataset.kind = kind;
    let items;
    if (kind === 'speed') items = SPEEDS.map(s => ({ label: s === 1 ? 'Normal' : s + '×', on: video.playbackRate === s, go: () => { video.playbackRate = s; video.defaultPlaybackRate = s; prefs.speed = s; savePrefs(); } }));
    else {
      const levels = hls?.levels?.length ? hls.levels.map((l, i) => ({ i, height: l.height, width: l.width, frameRate: l.frameRate })) : knownLevels;
      const lv = levels.map(l => ({ ...l, h: Math.min(l.height, l.width || l.height) })).sort((a, b) => b.h - a.h || (b.frameRate || 0) - (a.frameRate || 0));
      const o = cur?.original, ok = canOriginal(cur), onHls = srcKind === 'hls';
      items = (o ? [{ label: 'Original · ' + rungName(o.height, o.width, o.fps) + (o.bitrate ? ' · ' + mbps(o.bitrate) : '') + (ok ? '' : ' · not supported here'),
        on: srcKind === 'original', disabled: !ok,
        go: () => { prefs.original = true; savePrefs(); if (srcKind !== 'original') switchTo('original'); } }] : [])
        .concat([{ label: 'Auto', on: onHls && (!hls || hls.autoLevelEnabled), go: () => pickLevel(-1) }])
        .concat(lv.map(l => ({ label: levelName(l), on: onHls && !!hls && !hls.autoLevelEnabled && hls.currentLevel === l.i, go: () => pickLevel(l.i) })));
    }
    m.innerHTML = items.map((it, i) => '<button type="button" class="vp-menu-row' + (it.on ? ' on' : '') + '" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' + esc(it.label) + (it.on ? '<i class="ti ti-check"></i>' : '') + '</button>').join('');
    m._items = items;
    m.hidden = false;
    const btn = player.querySelector('[data-vp="' + kind + '"]');
    const br = btn.getBoundingClientRect(), pr = player.getBoundingClientRect();
    m.style.right = Math.max(8, pr.right - br.right) + 'px';
  }

  // The music steps aside while a video plays (as it does for Photos'
  // songs), unless it's playing on another device: a remote's pause
  // would stop it there.
  function quietMusic() {
    try {
      if (window.klabRadio?.station?.()) window.klabRadio.off?.();
      const a = typeof playerState !== 'undefined' && playerState.audio;
      if (a && !a.paused && !window.klabSession?.mirror) a.pause();
    } catch (e) {}
  }

  function tick(e) {
    // An element let go of (leaveWatch, a source switch) can still fire one.
    if (!video || (e && e.target !== video)) return;
    const now = performance.now();
    if (lastTick && !video.paused) played += Math.min(1, (now - lastTick) / 1000);
    lastTick = now;
    if (!viewSent && (played >= 10 || (cur?.duration && played >= cur.duration * 0.5))) sendView();
    if (now - lastSave > 10000 && !video.paused) saveProgress();
  }
  function sendView() {
    if (viewSent || !cur) return;
    viewSent = true;
    getJSON(API + '/' + cur.id + '/view', { method: 'POST' }, 8000).then(j => { if (cur && j.views != null) cur.views = j.views; }).catch(() => {});
  }
  function saveProgress(done) {
    if (!cur || !video) return;
    lastSave = performance.now();
    const position = done ? cur.duration || video.duration || 0 : video.currentTime || 0;
    if (!done && position < 5) return;
    cur.watched = done || position >= (cur.duration || 1e9) * 0.95 ? null : position;
    try {
      fetch(API + '/' + cur.id + '/progress', { ...json('PUT', { position }), keepalive: true }).catch(() => {});
    } catch (e) {}
  }

  function leaveWatch() {
    if (video) { saveProgress(); try { video.pause(); } catch {} }
    if (document.fullscreenElement && document.fullscreenElement === player) document.exitFullscreen?.();
    stopNext();
    if (hls) { saveBw(); try { hls.destroy(); } catch {} hls = null; }
    srcKind = 'hls';
    if (video) { video.removeAttribute('src'); try { video.load(); } catch {} }
    const had = !!video;
    video = null; player = null; cur = null;
    if (had) document.dispatchEvent(new CustomEvent('klab:watch', { detail: null }));
    clearTimeout(idleT);
    if (had) window.klabnetDesktop?.trimMemory?.();
  }

  {
    page.addEventListener('click', e => {
      const b = e.target.closest('[data-vp]');
      if (!b || !player || !player.contains(b)) return;
      const k = b.dataset.vp;
      if (k === 'play') togglePlay();
      else if (k === 'back10') seekTo(video.currentTime - 10);
      else if (k === 'fwd10') seekTo(video.currentTime + 10);
      else if (k === 'mute') { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; prefs.muted = video.muted; savePrefs(); player.querySelector('.vp-vol-range').value = video.muted ? 0 : video.volume; }
      else if (k === 'full') toggleFull();
      else if (k === 'pip') { (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {}); }
      else if (k === 'speed' || k === 'quality') { menu(k); return; }
      player.querySelector('.vp-menu').hidden = true;
    });
    page.addEventListener('click', e => {
      const row = e.target.closest('.vp-menu-row');
      if (!row) return;
      const m = row.closest('.vp-menu');
      m._items[+row.dataset.i].go();
      m.hidden = true;
      paint();
    });
  }

  // Keys on the watch page, ahead of the app's own (Space would play music,
  // j/k would scroll). ←/→ seek only with the player focused: elsewhere
  // they're the sidebar's.
  window.addEventListener('keydown', e => {
    if (!video || !showing() || view.kind !== 'watch' || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (document.querySelector('.chat-modal-backdrop.open, .chat-modal.open')) return;
    const focused = player && player.contains(el);
    const k = e.key;
    // Space on a focused button or link outside the player presses that.
    if (k === ' ' && !focused && el && el !== document.body && el.matches?.('button, a[href], [role="button"], [role="tab"], select, summary')) return;
    let done = true;
    if (k === ' ' || k === 'k' || k === 'K') togglePlay();
    // A frame at a time while paused (assumes ~30fps; the exact rate isn't known).
    else if ((k === ',' || k === '.') && video.paused) seekTo(video.currentTime + (k === '.' ? 1 : -1) / 30);
    else if (k === 'j' || k === 'J') seekTo(video.currentTime - 10);
    else if (k === 'l' || k === 'L') seekTo(video.currentTime + 10);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'm' || k === 'M') player.querySelector('[data-vp="mute"]').click();
    else if (focused && k === 'ArrowLeft') seekTo(video.currentTime - 5);
    else if (focused && k === 'ArrowRight') seekTo(video.currentTime + 5);
    else if (focused && /^[0-9]$/.test(k)) seekTo((video.duration || 0) * +k / 10);
    else if (k === 'Escape' && document.fullscreenElement === player) document.exitFullscreen?.();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); wake(); }
  }, true);

  // ── Everything else you press on the page ──
  page.addEventListener('click', async e => {
    const card = e.target.closest('.vid-card');
    if (card) { SFX && SFX.play('nav'); openVideo(+card.dataset.vidId); return; }
    const stamp = e.target.closest('.vid-stamp');
    if (stamp) { if (video) { seekTo(+stamp.dataset.at); video.play().catch(() => {}); } return; }
    const pill = e.target.closest('.vid-pill');
    if (pill) {
      if (pill.classList.contains('vid-react-add')) klabReactMenu(pill, emoji => toggleReaction(emoji));
      else toggleReaction(pill.dataset.emoji);
      return;
    }
    const del = e.target.closest('.k-com-del');
    if (del && cur) { deleteComment(cur, del.dataset.replyId); return; }
    const who = e.target.closest('.k-com-name, .k-com-face[data-username]');
    if (who && !who.closest('.k-com-form')) { window.openProfileView?.(who.dataset.username); return; }
    const ord = e.target.closest('[data-order]');
    if (ord && (view.kind === 'channel' || view.kind === 'mine')) { if ((view.sort || 'new') !== ord.dataset.order) showList({ ...view, sort: ord.dataset.order }, { quiet: true }); return; }
    const plc = e.target.closest('.vid-pl-card');
    if (plc) { SFX && SFX.play('nav'); showList({ kind: 'playlist', id: plc.dataset.plId }); return; }
    const rm = e.target.closest('[data-act="pl-rm"]');
    if (rm && plOpen) { removeFromPlaylist(plOpen, +rm.closest('.vid-pl-row').dataset.plI); return; }
    const plr = e.target.closest('.vid-pl-row');
    if (plr && plOpen) { if (!plr.classList.contains('processing')) playRun(plOpen, +plr.dataset.plI); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'pl-new') { playlistDialog(null); return; }
    if (act === 'pl-play' && plOpen) { playRun(plOpen, 0); return; }
    if (act === 'pl-shuffle' && plOpen) { playRun(plOpen, 0, true); return; }
    if (act === 'pl-more' && plOpen) { playlistMenu(plOpen, b); return; }
    if (act === 'pl-open') { showList({ kind: 'playlist', id: b.dataset.id }); return; }
    if (act === 'save' && cur) { saveMenu(cur, null, b); return; }
    if (act === 'upload') uploadDialog();
    else if (act === 'open') { SFX && SFX.play('nav'); openVideo(+b.dataset.id); }
    else if (act === 'tv') window.klabTv?.open?.(b.dataset.id);
    else if (act === 'back') { if (!window.klabNav?.back()) showList({ kind: 'home' }); }
    else if (act === 'channel') showList({ kind: 'channel', user: b.dataset.user });
    else if (act === 'profile') window.openProfileView?.(b.dataset.user);
    else if (act === 'share' && cur) shareDialog(cur);
    else if (act === 'together' && cur) window.klabRooms?.together(cur);
    else if (act === 'edit' && cur) editDialog(cur);
    else if (act === 'delete' && cur) deleteVideo(cur);
    else if (act === 'more') { const d = $('vidDesc'); d.classList.toggle('open'); b.textContent = d.classList.contains('open') ? 'Show less' : 'Show more'; }
  });

  // ── Right-click: a card, or the watch page ──
  const linkTo = (v, at) => location.origin + location.pathname + '#videos/' + v.id + (at ? '?t=' + Math.floor(at) : '');
  function cardMenu(e, v, inContinue) {
    klabMenu(e, [
      { header: v.title || 'Untitled' },
      { label: 'Open', icon: 'ti-player-play', disabled: v.status !== 'ready', action: () => openVideo(v.id) },
      { label: 'Share…', icon: 'ti-share-2', action: () => shareDialog(v) },
      { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(linkTo(v), 'Link') },
      { label: 'Save to playlist…', icon: 'ti-playlist-add', disabled: v.status !== 'ready', action: () => setTimeout(() => saveMenu(v, e), 0) },
      '-',
      { label: 'Go to channel', icon: 'ti-user', hidden: view.kind === 'channel' && view.user === v.username, action: () => showList({ kind: 'channel', user: v.username }) },
      { label: 'Remove from Continue watching', icon: 'ti-x', hidden: !inContinue && !v.watched, action: () => forget(v) },
      '-',
      { label: 'Edit video', icon: 'ti-pencil', hidden: !canEdit(v), action: () => editDialog(v) },
      { label: 'Delete video', icon: 'ti-trash', danger: true, hidden: !canEdit(v), action: () => deleteVideo(v) },
    ]);
  }
  // Out of Continue watching: where you stopped is set to the end, which
  // the API takes as watched.
  function forget(v) {
    const was = v.watched;
    v.watched = null;
    page.querySelectorAll('.vid-shelf .vid-card[data-vid-id="' + v.id + '"]').forEach(c => c.remove());
    page.querySelectorAll('[data-vid-id="' + v.id + '"] .vid-prog').forEach(b => b.remove());
    const shelf = $('vidShelf');
    if (shelf && !shelf.querySelector('.vid-card')) shelf.hidden = true;
    if (view.kind === 'continue') { list = list.filter(x => x.id !== v.id); page.querySelector('.vid-grid .vid-card[data-vid-id="' + v.id + '"]')?.remove(); }
    fetch(API + '/' + v.id + '/progress', { ...json('PUT', { position: v.duration || 1e6 }), keepalive: true })
      .then(r => { if (!r.ok) throw r; })
      .catch(() => { v.watched = was; showToast('Couldn’t take it out', 'ti-alert-triangle'); });
  }
  page.addEventListener('contextmenu', e => {
    const plc = e.target.closest('.vid-pl-card');
    if (plc) {
      const p = (pls || []).find(x => x.id === plc.dataset.plId);
      if (!p) return;
      klabMenu(e, [
        { header: p.name },
        { label: 'Open', icon: 'ti-playlist', action: () => showList({ kind: 'playlist', id: p.id }) },
        { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(plLink(p.id), 'Link') },
        '-',
        { label: 'Edit playlist…', icon: 'ti-pencil', hidden: !p.canEdit, action: () => playlistDialog(p) },
        { label: 'Delete playlist', icon: 'ti-trash', danger: true, hidden: !p.canEdit, action: () => deletePlaylist(p) },
      ]);
      return;
    }
    const plr = e.target.closest('.vid-pl-row');
    if (plr && plOpen) {
      const p = plOpen, i = +plr.dataset.plI, x = p.videos[i];
      if (!x) return;
      klabMenu(e, [
        { header: x.title || 'Untitled' },
        { label: 'Play from here', icon: 'ti-player-play', disabled: x.status !== 'ready', action: () => playRun(p, i) },
        { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(linkTo(x), 'Link') },
        { label: 'Go to channel', icon: 'ti-user', action: () => showList({ kind: 'channel', user: x.username }) },
        '-',
        { label: 'Remove from playlist', icon: 'ti-x', danger: true, hidden: !p.canEdit, action: () => removeFromPlaylist(p, i) },
      ]);
      return;
    }
    const card = e.target.closest('.vid-card[data-vid-id], .vid-hero[data-vid-id]');
    if (card && !e.target.closest('.vid-hero-by')) {
      const v = cache.get(+card.dataset.vidId);
      if (!v) return;
      cardMenu(e, v, !!card.closest('.vid-shelf') || view.kind === 'continue');
      return;
    }
    // The player and the video's own head: the video at hand.
    if (!cur || !e.target.closest('.vid-watch-main') || e.target.closest('.k-com, .k-com-form, a, input, textarea')) return;
    const v = cur, t = video ? video.currentTime || 0 : 0;
    const onPlayer = !!e.target.closest('.vp');
    klabMenu(e, [
      { header: v.title || 'Untitled' },
      { label: video && !video.paused ? 'Pause' : 'Play', icon: video && !video.paused ? 'ti-player-pause' : 'ti-player-play', hidden: !video || !onPlayer, action: () => togglePlay() },
      { label: 'Picture in picture', icon: 'ti-picture-in-picture', hidden: !video || !onPlayer || !document.pictureInPictureEnabled, action: () => video.requestPictureInPicture().catch(() => {}) },
      { label: 'Share…', icon: 'ti-share-2', action: () => shareDialog(v) },
      { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(linkTo(v), 'Link') },
      { label: 'Copy link at ' + dur(t), icon: 'ti-clock', hidden: t < 2, action: () => klabCopy(linkTo(v, t), 'Link') },
      { label: 'Save to playlist…', icon: 'ti-playlist-add', action: () => setTimeout(() => saveMenu(v, e), 0) },
      '-',
      { label: 'Go to channel', icon: 'ti-user', action: () => showList({ kind: 'channel', user: v.username }) },
      { label: 'View profile', icon: 'ti-user-circle', action: () => window.openProfileView?.(v.username) },
      '-',
      { label: 'Edit video', icon: 'ti-pencil', hidden: !canEdit(v), action: () => editDialog(v) },
      { label: 'Delete video', icon: 'ti-trash', danger: true, hidden: !canEdit(v), action: () => deleteVideo(v) },
    ]);
  });

  page.addEventListener('keydown', e => {
    const row = e.target.closest?.('.vid-pl-row');
    if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); row.click(); }
  });

  // The sidebar's rows.
  nav.addEventListener('click', e => {
    const b = e.target.closest('.picker-tab[data-vid]');
    if (!b) return;
    SFX && SFX.play('click');
    if (!showing()) setActiveTab('videos');
    showList({ kind: b.dataset.vid });
    if (document.activeElement === b) b.blur();
  });

  // The search box (it goes up to the title bar, js/07-tabnav.js PAGES).
  const search = $('vidSearch');
  let searchT = 0;
  search?.addEventListener('input', () => {
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      const q = search.value.trim();
      if (q) showList({ kind: 'search', q }, { quiet: view.kind === 'search' });
      else if (view.kind === 'search') showList({ kind: 'home' });
    }, 250);
  });
  search?.addEventListener('keydown', e => { if (e.key === 'Escape' && search.value) { search.value = ''; search.dispatchEvent(new Event('input')); e.stopPropagation(); } });

  // ── Published: when the video came out ──
  // A date and an optional time (local; blank time is noon), sent as UTC.
  // Left as it was, an upload is "now" (the API's own clock) and an edit
  // doesn't send it. A file's own date is offered, never taken silently.
  const pad2 = n => String(n).padStart(2, '0');
  const localDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const localTime = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const longDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  function pubFieldHTML() {
    return '<label class="vid-field-label" for="vidPubDate">Published</label>' +
      '<div class="vid-pub"><input type="date" class="k-field" id="vidPubDate" aria-label="Date" />' +
      '<input type="time" class="k-field" id="vidPubTime" aria-label="Time (optional)" />' +
      '<button type="button" class="vid-pub-file" id="vidPubFile" hidden></button></div>';
  }
  function pubField(initial) {
    const dEl = $('vidPubDate'), tEl = $('vidPubTime'), fileBtn = $('vidPubFile');
    const set = d => { dEl.value = localDate(d); tEl.value = localTime(d); };
    set(initial);
    dEl.max = localDate(new Date());
    const start = dEl.value + 'T' + tEl.value;
    let fileDate = null;
    fileBtn.addEventListener('click', () => { if (fileDate) { set(fileDate); fileBtn.hidden = true; } });
    const value = () => {
      if (!dEl.value) return '';
      const d = new Date(dEl.value + 'T' + (tEl.value || '12:00'));
      return isNaN(d) ? '' : d.toISOString();
    };
    return {
      changed: () => (dEl.value + 'T' + tEl.value) !== start,
      value,
      problem: () => {
        if (!dEl.value) return 'It needs a date.';
        const v = value();
        if (!v) return 'That isn’t a date.';
        if (new Date(v).getTime() > Date.now() + 60000) return 'That’s in the future.';
        return '';
      },
      // The file's own date (when the browser says), as a link to take.
      offerFile: f => {
        fileDate = f && f.lastModified ? new Date(f.lastModified) : null;
        fileBtn.hidden = !fileDate || localDate(fileDate) === dEl.value;
        if (fileDate) fileBtn.textContent = 'Use file’s date (' + longDate(fileDate) + ')';
      },
    };
  }

  // ── Uploading ──
  const ACCEPT = 'video/*,.mkv,.mov,.m4v,.avi,.webm';
  function uploadDialog(file) {
    if (server === false) { showToast('Videos need the latest klabnet-api', 'ti-movie'); return; }
    openChatModal('Upload a video', `
      <div class="vid-up">
        <button type="button" class="vid-drop" id="vidDrop"><i class="ti ti-upload"></i><b>Choose a video</b><span>or drop one here · MP4, MOV, MKV, WebM</span></button>
        <input type="file" id="vidFile" accept="${ACCEPT}" hidden>
        <label class="vid-field-label" for="vidTitle">Title</label>
        <input class="chat-modal-input" id="vidTitle" maxlength="100" autocomplete="off" />
        <label class="vid-field-label" for="vidDescIn">Description</label>
        <textarea class="chat-modal-input vid-desc-in" id="vidDescIn" rows="4" maxlength="5000" placeholder="Optional. Times like 1:32 become links."></textarea>
        ${pubFieldHTML()}
        <p class="emo-err" id="vidErr" hidden></p>
      </div>
      <div class="dlg-actions">
        <button class="k-btn" id="vidCancel">Cancel</button>
        <button class="k-btn primary" id="vidSend" disabled>Upload</button>
      </div>`, null);
    let picked = null;
    const err = m => { $('vidErr').hidden = !m; $('vidErr').textContent = m || ''; };
    const pub = pubField(new Date());
    const pick = f => {
      if (!f) return;
      if (!/^video\//.test(f.type) && !/\.(mkv|mov|m4v|avi|webm|mp4)$/i.test(f.name)) { err('That isn’t a video.'); return; }
      picked = f;
      const d = $('vidDrop');
      d.classList.add('has');
      d.querySelector('b').textContent = f.name;
      d.querySelector('span').textContent = (f.size / 1048576).toFixed(f.size > 1048576 * 100 ? 0 : 1) + ' MB · choose another';
      if (!$('vidTitle').value) $('vidTitle').value = f.name.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ').trim().slice(0, 100);
      pub.offerFile(f);
      $('vidSend').disabled = false;
      err('');
      $('vidTitle').focus();
    };
    $('vidDrop').addEventListener('click', () => $('vidFile').click());
    $('vidFile').addEventListener('change', () => pick($('vidFile').files[0]));
    const drop = $('vidDrop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
    $('vidCancel').addEventListener('click', () => closeChatModal());
    $('vidSend').addEventListener('click', () => {
      if (!picked) return;
      const title = $('vidTitle').value.trim();
      if (!title) { err('It needs a title.'); $('vidTitle').focus(); return; }
      const bad = pub.problem();
      if (bad) { err(bad); return; }
      // It goes on in the background: the dialog closes into a row under
      // Your videos, with its progress (and a toast saying so).
      startUpload(picked, title, $('vidDescIn').value.trim(), pub.changed() ? pub.value() : '');
      closeChatModal();
    });
    if (file) pick(file);
  }
  // ── Uploads in the background ──
  // Each is a row under the sidebar's rows (title, a bar, ✕), so you can
  // browse while it goes. Leaving the page mid-upload asks first.
  const uploads = [];
  let upsEl = null;
  function paintUploads() {
    if (!upsEl) {
      upsEl = document.createElement('div');
      upsEl.className = 'vid-ups';
      upsEl.setAttribute('aria-live', 'polite');
      nav.appendChild(upsEl);
      upsEl.addEventListener('click', async e => {
        const b = e.target.closest('[data-up-stop]');
        if (!b) return;
        const u = uploads.find(x => x.key === b.dataset.upStop);
        if (!u) return;
        if (!(await showConfirmDialog('Stop this upload?', '“' + u.title + '” won’t be uploaded.', 'Stop upload'))) return;
        u.xhr.abort();
      });
    }
    upsEl.hidden = !uploads.length;
    upsEl.innerHTML = uploads.map(u => {
      const pct = Math.round(u.f * 100);
      return '<div class="vid-up-row" title="' + esc(u.title) + '"><i class="ti ti-upload"></i>' +
        '<span class="vid-up-tx"><span class="vid-up-name">' + esc(u.title) + '</span>' +
        '<span class="vid-up-bar"><b style="transform:scaleX(' + u.f.toFixed(3) + ')"></b></span>' +
        '<span class="vid-up-pct">' + (u.f < 1 ? pct + '%' : 'Saving…') + '</span></span>' +
        '<button type="button" class="k-icon sm" data-up-stop="' + u.key + '" title="Stop upload" aria-label="Stop upload"><i class="ti ti-x"></i></button></div>';
    }).join('');
  }
  function startUpload(file, title, description, published) {
    const fd = new FormData();
    fd.append('file', file); fd.append('title', title); fd.append('description', description);
    if (published) fd.append('published', published);
    const xhr = new XMLHttpRequest();
    const u = { key: Math.random().toString(36).slice(2), title, f: 0, xhr };
    uploads.push(u);
    paintUploads();
    showToast('Uploading “' + title + '”. You can keep browsing', 'ti-upload');
    const done = () => { uploads.splice(uploads.indexOf(u), 1); paintUploads(); };
    let paintT = 0;
    xhr.open('POST', API);
    xhr.responseType = 'json';
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      u.f = e.loaded / e.total;
      if (!paintT) paintT = setTimeout(() => { paintT = 0; paintUploads(); }, 200);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        const v = xhr.response;
        cache.set(v.id, v);
        SFX && SFX.play('star');
        showToast('“' + title + '” is up. It’ll be ready to watch in a few minutes', 'ti-movie', 6000, null, null,
          { action: { label: 'Your videos', run: () => { if (!showing()) setActiveTab('videos'); showList({ kind: 'mine' }); } } });
        if (showing() && ['mine', 'home'].includes(view.kind)) showList(view, { quiet: true });
      } else {
        if (xhr.status === 404 || xhr.status === 405) server = false;
        showToast('Couldn’t upload “' + title + '”: ' + (klabCap(xhr.response?.error) || 'error ' + xhr.status), 'ti-alert-triangle');
      }
    };
    xhr.onerror = () => { done(); showToast('The upload of “' + title + '” didn’t get through', 'ti-alert-triangle'); };
    xhr.onabort = () => { done(); showToast('Upload stopped', 'ti-x'); };
    xhr.send(fd);
  }
  addEventListener('beforeunload', e => { if (uploads.length) { e.preventDefault(); e.returnValue = ''; } });

  // A video dropped anywhere on the page.
  const shell = $('videosShell');
  shell?.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) e.preventDefault(); });
  shell?.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (!f || document.getElementById('vidDrop')) return;
    e.preventDefault();
    uploadDialog(f);
  });

  // ── Editing ──
  function editDialog(v) {
    openChatModal('Edit video', `
      <div class="vid-up">
        <label class="vid-field-label" for="vidTitle">Title</label>
        <input class="chat-modal-input" id="vidTitle" maxlength="100" autocomplete="off" />
        <label class="vid-field-label" for="vidDescIn">Description</label>
        <textarea class="chat-modal-input vid-desc-in" id="vidDescIn" rows="5" maxlength="5000"></textarea>
        ${pubFieldHTML()}
        <label class="vid-field-label">Thumbnail</label>
        <div class="vid-thumb-pick"><img id="vidThumbImg" alt="" ${v.posterSmall ? 'src="' + esc(v.posterSmall) + '"' : 'hidden'} />
          <button type="button" class="k-btn" id="vidThumbBtn"><i class="ti ti-photo"></i> Choose a picture</button>
          <input type="file" id="vidThumbFile" accept="image/*" hidden></div>
        <p class="emo-err" id="vidErr" hidden></p>
      </div>
      <div class="dlg-actions">
        <button class="k-btn" id="vidCancel">Cancel</button>
        <button class="k-btn primary" id="vidSave">Save</button>
      </div>`, null);
    $('vidTitle').value = v.title || '';
    $('vidDescIn').value = v.description || '';
    const pub = pubField(new Date(apiTime(pubOf(v)) || Date.now()));
    let thumb = null;
    $('vidThumbBtn').addEventListener('click', () => $('vidThumbFile').click());
    $('vidThumbFile').addEventListener('change', () => {
      thumb = $('vidThumbFile').files[0] || null;
      if (thumb) {
        const im = $('vidThumbImg');
        if (im.src.startsWith('blob:')) URL.revokeObjectURL(im.src);
        im.src = URL.createObjectURL(thumb); im.hidden = false;
        // Let go of it once it's drawn (the dialog closing would leak it).
        im.addEventListener('load', () => { if (im.src.startsWith('blob:')) URL.revokeObjectURL(im.src); }, { once: true });
      }
    });
    $('vidCancel').addEventListener('click', () => closeChatModal());
    $('vidSave').addEventListener('click', async () => {
      const title = $('vidTitle').value.trim();
      if (!title) { $('vidErr').hidden = false; $('vidErr').textContent = 'It needs a title.'; return; }
      const bad = pub.problem();
      if (bad) { $('vidErr').hidden = false; $('vidErr').textContent = bad; return; }
      $('vidSave').disabled = true; $('vidSave').textContent = 'Saving…';
      try {
        let nv = await getJSON(API + '/' + v.id, json('PATCH', { title, description: $('vidDescIn').value.trim(), ...(pub.changed() ? { published: pub.value() } : {}) }));
        if (thumb) { const fd = new FormData(); fd.append('file', thumb); nv = await getJSON(API + '/' + v.id + '/poster', { method: 'PUT', body: fd }, 60000); }
        cache.set(nv.id, nv);
        closeChatModal();
        if (cur && cur.id === v.id) {
          const t = video ? video.currentTime : 0, playing = video && !video.paused;
          Object.assign(cur, nv);
          // Only the words and the poster changed: the player stays.
          page.querySelector('.vid-title').textContent = nv.title;
          const by = page.querySelector('.vid-by-who > span > span');
          if (by) by.innerHTML = views(nv.views) + ' · ' + when(nv);
          const d = $('vidDesc');
          if (d) d.querySelector('.vid-desc-tx').innerHTML = descHTML(nv.description || '');
          else if (nv.description) openVideo(v.id, t, { quiet: true, fresh: nv, autoplay: playing, keep: true });
          if (thumb && video) video.poster = nv.poster;
        }
        if (pub.changed() && view.kind !== 'watch') showList(view, { quiet: true });
        showToast('Saved', 'ti-check');
      } catch (e) {
        $('vidErr').hidden = false; $('vidErr').textContent = klabCap(e.message);
        $('vidSave').disabled = false; $('vidSave').textContent = 'Save';
      }
    });
  }
  async function deleteVideo(v) {
    if (!(await showConfirmDialog('Delete this video?', '“' + (v.title || 'Untitled') + '” and its comments are gone for everyone.', 'Delete'))) return;
    try {
      await getJSON(API + '/' + v.id, { method: 'DELETE' }, 15000);
      cache.delete(v.id);
      list = list.filter(x => x.id !== v.id);
      showToast('Video deleted', 'ti-trash');
      // Back where you came from (its channel, a list); Your videos if there's nowhere.
      if (cur?.id === v.id || view.kind === 'watch') { if (!window.klabNav?.back()) showList({ kind: 'mine' }); }
      else showList(view, { quiet: true });
    } catch (e) { showToast('Couldn’t delete it: ' + e.message, 'ti-alert-triangle'); }
  }

  // ── Playlists ──
  // Music's playlists for videos (klabnet-api routers/video_playlists.py):
  // a name, a description, a cover (or the first posters as a 2x2) and
  // videos in order. Private until featured; anyone can watch a featured
  // one. Its page is a list view (#videos/playlist/<id>); playing one runs
  // through it in the watch view (plRun).
  const PL = API + '/playlists';
  let pls = null, plsLoading = null;
  function loadPlaylists(force) {
    if (pls && !force) return Promise.resolve(pls);
    return plsLoading ||= getJSON(PL).then(j => { pls = j.playlists || []; return pls; })
      .catch(() => (pls = pls || [])).finally(() => { plsLoading = null; });
  }
  const myPls = () => (pls || []).filter(p => p.mine);
  const plLink = id => location.origin + location.pathname + '#videos/playlist/' + id;
  function plArt(p, cls) {
    const inner = p.coverSmall || p.cover
      ? '<img src="' + esc(cls === 'big' ? p.cover || p.coverSmall : p.coverSmall || p.cover) + '" alt="" loading="lazy" draggable="false" />'
      : (p.posters || []).length
        ? '<span class="vid-pl-grid n' + Math.min(4, p.posters.length) + '">' + p.posters.slice(0, 4).map(u => '<img src="' + esc(u) + '" alt="" loading="lazy" draggable="false" />').join('') + '</span>'
        : '<span class="vid-thumb-ph"><i class="ti ti-playlist"></i></span>';
    return '<span class="vid-pl-art ' + (cls || '') + '">' + inner + '</span>';
  }
  const plSub = p => klabCount(p.count || 0, 'video') + (p.mine ? (p.featured ? ' · Featured' : ' · Private') : ' · ' + esc(p.username));
  function plCardHTML(p) {
    return '<button type="button" class="vid-pl-card" data-pl-id="' + esc(p.id) + '" data-silent>' + plArt(p) +
      '<span class="vid-card-title">' + esc(p.name) + '</span><span class="vid-card-sub">' + plSub(p) + '</span></button>';
  }
  function hours(sec) {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600), m = Math.round(sec / 60) % 60;
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : Math.max(1, m) + ' min';
  }

  async function showPlaylists(v, my) {
    page.innerHTML = headHTML('Playlists', '', '', '<button type="button" class="k-btn" data-act="pl-new"><i class="ti ti-plus"></i><span>New playlist</span></button>') +
      '<div id="vidPls">' + LOADING + '</div>';
    if (panel()) panel().scrollTop = 0;
    klabEnter(page);
    await loadPlaylists(true);
    if (my !== token) return;
    const el = $('vidPls');
    if (!el) return;
    const mine = myPls(), others = pls.filter(p => !p.mine);
    $('vidSub').textContent = pls.length ? klabCount(pls.length, 'playlist') : '';
    el.innerHTML = !pls.length
      ? '<div class="k-empty vid-empty"><i class="ti ti-playlist"></i><div>No playlists yet. Make one, or save a video to one from its page.</div>' +
        '<button type="button" class="k-btn" data-act="pl-new"><i class="ti ti-plus"></i><span>New playlist</span></button></div>'
      : (mine.length ? '<div class="k-label vid-label">Yours</div><div class="vid-pl-cards">' + mine.map(plCardHTML).join('') + '</div>' : '') +
        (others.length ? '<div class="k-label vid-label">Featured</div><div class="vid-pl-cards">' + others.map(plCardHTML).join('') + '</div>' : '');
  }

  // Browse's shelf: the featured ones, if there are any.
  async function playlistsShelf(my) {
    await loadPlaylists(true);
    const el = $('vidPlShelf');
    const feat = (pls || []).filter(p => p.featured && p.count);
    if (my !== token || !el || !feat.length) return;
    el.hidden = false;
    el.innerHTML = '<div class="k-label vid-label">Playlists</div><div class="vid-shelf vid-pl-shelf">' + feat.slice(0, 12).map(plCardHTML).join('') + '</div>';
  }

  let plOpen = null; // the playlist page's playlist (with its videos)
  async function showPlaylist(v, my) {
    page.innerHTML = LOADING;
    if (panel()) panel().scrollTop = 0;
    let p;
    try { p = await getJSON(PL + '/' + encodeURIComponent(v.id)); }
    catch (e) {
      if (my !== token) return;
      page.innerHTML = emptyHTML(e.status === 404 ? 'That playlist’s gone, or it’s private.' : 'Couldn’t load that playlist.');
      return;
    }
    if (my !== token) return;
    plOpen = p;
    remember(p.videos);
    paintPlaylist(p);
    klabEnter(page);
  }
  function paintPlaylist(p) {
    const ready = p.videos.filter(x => x.status === 'ready');
    page.innerHTML = '<section class="vid-pl-head">' + plArt(p, 'big') +
      '<div class="vid-pl-tx"><div class="k-label">' + (p.featured ? 'Featured playlist' : 'Private playlist') + '</div>' +
        '<h2 class="vid-pl-title">' + esc(p.name) + '</h2>' +
        (p.description ? '<p class="vid-pl-desc">' + esc(p.description) + '</p>' : '') +
        '<div class="vid-pl-meta"><button type="button" class="vid-pl-by" data-act="channel" data-user="' + esc(p.username) + '">' + esc(p.username) + '</button>' +
          ' · ' + klabCount(p.videos.length, 'video') + (p.duration ? ' · ' + hours(p.duration) : '') + '</div>' +
        '<div class="vid-pl-acts">' +
          '<button type="button" class="k-btn primary" data-act="pl-play"' + (ready.length ? '' : ' disabled') + '><i class="ti ti-player-play-filled"></i><span>Play all</span></button>' +
          '<button type="button" class="k-btn" data-act="pl-shuffle"' + (ready.length > 1 ? '' : ' disabled') + '><i class="ti ti-arrows-shuffle"></i><span>Shuffle</span></button>' +
          '<button type="button" class="k-icon" data-act="pl-more" title="More" aria-label="More"><i class="ti ti-dots"></i></button>' +
        '</div></div></section>' +
      (p.videos.length
        ? '<div class="vid-pl-list' + (p.canEdit ? ' editable' : '') + '" id="vidPlList">' + p.videos.map((x, i) => plRowHTML(x, i, p.canEdit)).join('') + '</div>'
        : '<div class="k-empty vid-empty"><i class="ti ti-playlist"></i><div>Nothing in it yet. Save a video to it from the video’s page.</div></div>');
  }
  function plRowHTML(x, i, edit) {
    return '<div class="vid-pl-row' + (x.status !== 'ready' ? ' processing' : '') + '" data-pl-i="' + i + '" data-vid-id="' + x.id + '"' + (edit ? ' draggable="true"' : '') + ' role="button" tabindex="0">' +
      (edit ? '<i class="ti ti-grip-vertical vid-pl-grip" aria-hidden="true"></i>' : '') +
      '<span class="vid-pl-n">' + (i + 1) + '</span>' +
      '<span class="vid-thumb">' + (x.posterSmall ? '<img src="' + esc(x.posterSmall) + '" alt="" loading="lazy" draggable="false" />' : '<span class="vid-thumb-ph"><i class="ti ti-movie"></i></span>') +
        (x.duration ? '<span class="vid-dur">' + dur(x.duration) + '</span>' : '') + '</span>' +
      '<span class="vid-pl-row-tx"><span class="vid-card-title">' + esc(x.title || 'Untitled') + '</span>' +
        '<span class="vid-card-sub">' + esc(x.username) + ' · ' + (x.status === 'ready' ? when(x) : 'Processing') + '</span></span>' +
      (edit ? '<button type="button" class="k-icon sm vid-pl-rm" data-act="pl-rm" title="Remove from playlist" aria-label="Remove from playlist"><i class="ti ti-x"></i></button>' : '') +
    '</div>';
  }

  // Playing: from a place in it, or shuffled.
  function playRun(p, i, shuffle) {
    let vids = p.videos.filter(x => x.status === 'ready');
    if (!vids.length) return;
    let at = Math.max(0, vids.indexOf(p.videos[i]));
    if (shuffle) {
      vids = vids.slice();
      for (let k = vids.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [vids[k], vids[j]] = [vids[j], vids[k]]; }
      at = 0;
    }
    SFX && SFX.play('nav');
    openVideo(vids[at].id, 0, { list: { pl: p, videos: vids, i: at } });
  }
  function runTo(i) {
    if (!plRun || !plRun.videos[i]) return;
    openVideo(plRun.videos[i].id, 0, { list: { ...plRun, i } });
  }
  // The watch view's side while in one: the list, the one playing marked.
  function paintRun() {
    const side = page.querySelector('.vid-watch-side');
    if (!side || !plRun) return;
    const r = plRun;
    side.innerHTML = '<div class="vid-run">' +
      '<div class="vid-run-head"><button type="button" class="vid-run-name" data-act="pl-open" data-id="' + esc(r.pl.id) + '"><b>' + esc(r.pl.name) + '</b>' +
        '<span>' + esc(r.pl.username) + ' · ' + (r.i + 1) + ' / ' + r.videos.length + '</span></button></div>' +
      '<div class="vid-run-list">' + r.videos.map((x, i) =>
        '<button type="button" class="vid-run-row' + (i === r.i ? ' on' : '') + '" data-run-i="' + i + '"' + (i === r.i ? ' aria-current="true"' : '') + ' data-silent>' +
          '<span class="vid-pl-n">' + (i === r.i ? '<i class="ti ti-player-play-filled"></i>' : i + 1) + '</span>' +
          '<span class="vid-thumb">' + (x.posterSmall ? '<img src="' + esc(x.posterSmall) + '" alt="" loading="lazy" draggable="false" />' : '<span class="vid-thumb-ph"><i class="ti ti-movie"></i></span>') + '</span>' +
          '<span class="vid-pl-row-tx"><span class="vid-card-title">' + esc(x.title || 'Untitled') + '</span><span class="vid-card-sub">' + esc(x.username) + '</span></span>' +
        '</button>').join('') + '</div></div>';
    upNext = [];
    requestAnimationFrame(() => side.querySelector('.vid-run-row.on')?.scrollIntoView({ block: 'nearest' }));
  }
  page.addEventListener('click', e => {
    const row = e.target.closest('.vid-run-row');
    if (row) { e.stopPropagation(); SFX && SFX.play('nav'); runTo(+row.dataset.runI); }
  }, true);

  // Save to playlist: yours, and a new one.
  async function saveMenu(v, e, anchor) {
    if (!pls) await loadPlaylists();
    const items = [{ header: 'Save to playlist' }]
      .concat(myPls().map(p => ({ label: p.name, icon: 'ti-playlist', action: () => addTo(p, v) })))
      .concat(myPls().length ? ['-'] : [])
      .concat([{ label: 'New playlist…', icon: 'ti-plus', action: () => playlistDialog(null, [v.id]) }]);
    if (anchor) klabMenu.at(anchor, items, { align: 'end' }); else klabMenu(e, items);
  }
  async function addTo(p, v) {
    try {
      const j = await getJSON(PL + '/' + encodeURIComponent(p.id) + '/videos', json('POST', { videos: [v.id] }), 10000);
      Object.assign(p, j);
      showToast(j.added ? 'Saved to “' + p.name + '”' : 'It’s already in “' + p.name + '”', 'ti-playlist-add', 4000, null, null,
        { action: { label: 'Open', run: () => showList({ kind: 'playlist', id: p.id }) } });
    } catch (err) { showToast('Couldn’t save it: ' + klabCap(err.message), 'ti-alert-triangle'); }
  }

  // New or edit: name, description, featured, cover.
  function playlistDialog(p, videos) {
    openChatModal(p ? 'Edit playlist' : 'New playlist', `
      <div class="vid-up vid-pl-form">
        <div class="vid-pl-form-top">
          <button type="button" class="vid-pl-cover-pick" id="vidPlCover" title="Choose a cover">${p ? plArt(p, 'big') : '<span class="vid-pl-art big"><span class="vid-thumb-ph"><i class="ti ti-photo"></i></span></span>'}</button>
          <div class="vid-pl-form-fields">
            <label class="vid-field-label" for="vidPlName">Name</label>
            <input class="k-field" id="vidPlName" maxlength="80" autocomplete="off" />
            <div class="vid-pl-cover-acts"><button type="button" class="k-btn sm" id="vidPlCoverBtn"><i class="ti ti-photo"></i><span>Choose a cover</span></button>
              <button type="button" class="k-btn sm ghost" id="vidPlCoverRm" ${p && p.cover ? '' : 'hidden'}>Remove cover</button></div>
            <input type="file" id="vidPlCoverFile" accept="image/*" hidden>
          </div>
        </div>
        <label class="vid-field-label" for="vidPlDesc">Description</label>
        <textarea class="chat-modal-input vid-desc-in" id="vidPlDesc" rows="3" maxlength="600" placeholder="Optional"></textarea>
        <label class="vid-pl-feat"><span><b>Feature it</b><span>Everyone can find it in Videos and watch it. Off, it’s only yours.</span></span>
          <input type="checkbox" class="k-switch" id="vidPlFeat" role="switch"></label>
        <p class="emo-err" id="vidErr" hidden></p>
      </div>
      <div class="dlg-actions">
        <button class="k-btn" id="vidCancel">Cancel</button>
        <button class="k-btn primary" id="vidSave">${p ? 'Save' : 'Make playlist'}</button>
      </div>`, null);
    $('vidPlName').value = p ? p.name : '';
    $('vidPlDesc').value = p ? p.description || '' : '';
    $('vidPlFeat').checked = !!(p && p.featured);
    let blob = null, gone = false;
    const pick = () => $('vidPlCoverFile').click();
    $('vidPlCover').addEventListener('click', pick);
    $('vidPlCoverBtn').addEventListener('click', pick);
    $('vidPlCoverFile').addEventListener('change', async () => {
      const f = $('vidPlCoverFile').files?.[0];
      $('vidPlCoverFile').value = '';
      if (!f) return;
      const cropped = await openImageCropper(f, { shape: 'square', outputWidth: 1000, outputHeight: 1000 });
      if (!cropped) return;
      blob = cropped; gone = false;
      const url = URL.createObjectURL(cropped);
      $('vidPlCover').innerHTML = '<span class="vid-pl-art big"><img src="' + url + '" alt="" /></span>';
      $('vidPlCoverRm').hidden = false;
    });
    $('vidPlCoverRm').addEventListener('click', () => {
      blob = null; gone = true;
      $('vidPlCover').innerHTML = plArt({ ...(p || {}), cover: null, coverSmall: null }, 'big');
      $('vidPlCoverRm').hidden = true;
    });
    $('vidCancel').addEventListener('click', () => closeChatModal());
    setTimeout(() => $('vidPlName')?.focus(), 50);
    $('vidSave').addEventListener('click', async () => {
      const name = $('vidPlName').value.trim();
      const err = m => { $('vidErr').hidden = !m; $('vidErr').textContent = m || ''; };
      if (!name) { err('It needs a name.'); $('vidPlName').focus(); return; }
      $('vidSave').disabled = true;
      const body = { name, description: $('vidPlDesc').value.trim(), featured: $('vidPlFeat').checked };
      try {
        let np = p ? await getJSON(PL + '/' + encodeURIComponent(p.id), json('PATCH', body))
                   : await getJSON(PL, json('POST', { ...body, videos: videos || [] }));
        if (blob) { const fd = new FormData(); fd.append('file', blob, 'cover.jpg'); np = { ...np, ...(await getJSON(PL + '/' + np.id + '/cover', { method: 'POST', body: fd }, 60000)) }; }
        else if (gone && p && p.cover) np = { ...np, ...(await getJSON(PL + '/' + np.id + '/cover', { method: 'DELETE' })) };
        closeChatModal();
        await loadPlaylists(true);
        SFX && SFX.play('star');
        if (p) {
          showToast('Saved', 'ti-check');
          if (view.kind === 'playlist' && view.id === p.id) showList(view, { quiet: true });
          else if (view.kind === 'playlists') showList(view, { quiet: true });
        } else if (videos && videos.length) {
          showToast('Saved to “' + np.name + '”', 'ti-playlist-add', 4000, null, null, { action: { label: 'Open', run: () => showList({ kind: 'playlist', id: np.id }) } });
        } else showList({ kind: 'playlist', id: np.id });
      } catch (e) { err(klabCap(e.message)); $('vidSave').disabled = false; }
    });
  }

  function playlistMenu(p, anchor) {
    klabMenu.at(anchor, [
      { header: p.name },
      { label: 'Edit playlist…', icon: 'ti-pencil', hidden: !p.canEdit, action: () => playlistDialog(p) },
      { label: p.featured ? 'Make it private' : 'Feature it', icon: p.featured ? 'ti-eye-off' : 'ti-world', hidden: !p.canEdit, action: () => setFeatured(p, !p.featured) },
      { label: 'Copy link', icon: 'ti-link', hidden: !p.featured && !p.mine, action: () => klabCopy(plLink(p.id), 'Link') },
      '-',
      { label: 'Delete playlist', icon: 'ti-trash', danger: true, hidden: !p.canEdit, action: () => deletePlaylist(p) },
    ], { align: 'end' });
  }
  async function setFeatured(p, on) {
    try {
      await getJSON(PL + '/' + encodeURIComponent(p.id), json('PATCH', { featured: on }));
      showToast(on ? 'Featured: everyone can watch it' : 'It’s private now', on ? 'ti-world' : 'ti-eye-off');
      loadPlaylists(true);
      if (view.kind === 'playlist' && view.id === p.id) showList(view, { quiet: true });
    } catch (e) { showToast('Couldn’t change it: ' + klabCap(e.message), 'ti-alert-triangle'); }
  }
  async function deletePlaylist(p) {
    if (!(await showConfirmDialog('Delete this playlist?', '“' + p.name + '” is gone for everyone. The videos in it stay.', 'Delete'))) return;
    try {
      await getJSON(PL + '/' + encodeURIComponent(p.id), { method: 'DELETE' }, 15000);
      showToast('Playlist deleted', 'ti-trash');
      await loadPlaylists(true);
      if (!window.klabNav?.back()) showList({ kind: 'playlists' });
    } catch (e) { showToast('Couldn’t delete it: ' + klabCap(e.message), 'ti-alert-triangle'); }
  }
  // Out of the playlist at once, with Undo.
  function removeFromPlaylist(p, i) {
    const x = p.videos[i];
    if (!x) return;
    klabUndo('Removed from “' + p.name + '”', {
      icon: 'ti-playlist',
      apply: () => { p.videos.splice(p.videos.indexOf(x), 1); if (plOpen === p && view.kind === 'playlist') paintPlaylist(p); },
      undo: () => { p.videos.splice(Math.min(i, p.videos.length), 0, x); if (plOpen === p && view.kind === 'playlist') paintPlaylist(p); },
      commit: () => getJSON(PL + '/' + encodeURIComponent(p.id) + '/videos/' + x.id, { method: 'DELETE' }, 10000).then(() => loadPlaylists(true)),
    });
  }
  // Dragging rows to reorder (the owner's): the row moves as you go, and
  // the new order is saved when you let go.
  let dragRow = null;
  page.addEventListener('dragstart', e => {
    const row = e.target.closest?.('.vid-pl-list.editable .vid-pl-row');
    if (!row) return;
    dragRow = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', row.dataset.vidId); } catch {}
  });
  page.addEventListener('dragover', e => {
    if (!dragRow) return;
    const over = e.target.closest?.('.vid-pl-row');
    e.preventDefault();
    if (!over || over === dragRow || over.parentNode !== dragRow.parentNode) return;
    const r = over.getBoundingClientRect();
    over.parentNode.insertBefore(dragRow, e.clientY > r.top + r.height / 2 ? over.nextSibling : over);
  });
  page.addEventListener('dragend', async () => {
    const row = dragRow;
    dragRow = null;
    if (!row) return;
    row.classList.remove('dragging');
    const p = plOpen;
    if (!p) return;
    const ids = [...page.querySelectorAll('#vidPlList .vid-pl-row')].map(r => +r.dataset.vidId);
    if (ids.join() === p.videos.map(x => x.id).join()) return;
    const byId = new Map(p.videos.map(x => [x.id, x]));
    p.videos = ids.map(id => byId.get(id)).filter(Boolean);
    paintPlaylist(p);
    try { await getJSON(PL + '/' + encodeURIComponent(p.id), json('PATCH', { videos: ids }), 10000); loadPlaylists(true); }
    catch (e) { showToast('Couldn’t save the order', 'ti-alert-triangle'); showList(view, { quiet: true }); }
  });

  // ── Sharing ──
  const shareOf = (v, at) => ({ id: v.id, title: v.title, poster: v.posterSmall || v.poster || '', duration: v.duration || 0, username: v.username, ...(at ? { start: at } : {}) });
  function shareDialog(v) {
    const t = video ? Math.floor(video.currentTime || 0) : 0;
    const moment = t > 5 && t < (v.duration || 0) - 5 ? t : 0;
    openChatModal('Share video', `
      ${moment ? '<label class="vid-check"><input type="checkbox" class="k-check" id="vidShareAt" checked><span>Start at ' + dur(moment) + '</span></label>' : ''}
      <div class="chat-modal-list vid-share-list">
        <button type="button" class="chat-modal-row" data-share="feed"><i class="ti ti-news"></i><div class="chat-modal-row-info"><div class="chat-modal-row-name">Post to the Feed</div></div></button>
        <button type="button" class="chat-modal-row" data-share="chat"><i class="ti ti-message-circle"></i><div class="chat-modal-row-info"><div class="chat-modal-row-name">Send in a chat</div></div></button>
        <button type="button" class="chat-modal-row" data-share="link"><i class="ti ti-link"></i><div class="chat-modal-row-info"><div class="chat-modal-row-name">Copy link</div></div></button>
      </div>`, null);
    document.querySelector('.vid-share-list').addEventListener('click', async e => {
      const row = e.target.closest('[data-share]');
      if (!row) return;
      const at = moment && $('vidShareAt')?.checked ? moment : 0;
      const how = row.dataset.share;
      closeChatModal();
      if (how === 'feed') {
        if (video) video.pause();
        setActiveTab('feed');
        window.klabShareVideoToFeed?.(shareOf(v, at));
      } else if (how === 'chat') sendToChat(shareOf(v, at));
      else {
        const url = location.origin + location.pathname + '#videos/' + v.id + (at ? '?t=' + at : '');
        klabCopy(url, 'Link');
      }
    });
  }
  async function sendToChat(s) {
    const client = window.MatrixChat?.client;
    if (!client) { showToast('Connect chat first, in Social → Chat', 'ti-message-circle'); return; }
    const rooms = client.getRooms().filter(r => r.getMyMembership() === 'join')
      .sort((a, b) => (b.getLastActiveTimestamp?.() || 0) - (a.getLastActiveTimestamp?.() || 0)).slice(0, 40);
    const i = await showChoiceDialog('Send to…', rooms.map(r => ({ label: r.name || 'Conversation', sub: r.getJoinedMemberCount?.() > 2 ? r.getJoinedMemberCount() + ' people' : '' })), 'No conversations yet');
    if (i == null) return;
    try {
      await client.sendMessage(rooms[i].roomId, {
        msgtype: 'm.text',
        body: '🎬 ' + s.title + (s.start ? ' (from ' + dur(s.start) + ')' : '') + ' · ' + location.origin + location.pathname + '#videos/' + s.id,
        'klab.video': s,
      });
      SFX && SFX.play('star');
      showToast('Sent to ' + (rooms[i].name || 'the conversation'), 'ti-send-2');
    } catch (e) { showToast('Couldn’t send it', 'ti-alert-triangle'); }
  }

  // ── Coming and going ──
  let entered = false;
  window.klabVideosTabChanged = on => {
    if (on) {
      if (!entered) {
        entered = true;
        const link = window.klabVideoLink;
        window.klabVideoLink = null;
        if (link && link.playlist) showList({ kind: 'playlist', id: link.playlist });
        else if (link) openVideo(link.id, link.at, { quiet: false });
        else showList({ kind: 'home' }, { quiet: true });
      } else if (window.klabVideoLink) {
        const l = window.klabVideoLink; window.klabVideoLink = null;
        if (l.playlist) showList({ kind: 'playlist', id: l.playlist }); else openVideo(l.id, l.at);
      }
      loadPlaylists();
      watchProcessing();
    } else {
      if (video && !video.paused && !document.pictureInPictureElement) video.pause();
      saveProgress();
      clearTimeout(procTimer);
    }
  };
  // Back and Forward (js/17-history.js).
  window.klabVideosRestore = d => {
    restoring = true;
    try {
      if (d.kind === 'watch' && d.pl) {
        // Back into a playlist's video: the playlist again, then that video in it.
        getJSON(PL + '/' + encodeURIComponent(d.pl)).then(p => {
          const vids = p.videos.filter(x => x.status === 'ready');
          const i = vids.findIndex(x => x.id === d.id);
          openVideo(d.id, 0, { quiet: true, ...(i >= 0 ? { list: { pl: p, videos: vids, i } } : {}) });
        }).catch(() => openVideo(d.id, 0, { quiet: true }));
      } else if (d.kind === 'watch') openVideo(d.id, 0, { quiet: true });
      else if (d.kind === 'list' && d.view) showList(d.view, { quiet: true });
      else showList({ kind: 'home' }, { quiet: true });
      entered = true;
    } finally { setTimeout(() => { restoring = false; }, 0); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });
  addEventListener('pagehide', () => saveProgress());
  if (showing()) window.klabVideosTabChanged(true);
})();
