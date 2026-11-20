// ══════════════════════════════════════════
//  CLIPS (2026-11-20) — the owner: "in videos id like a "Clips" section,
//  with scissors as the icon. that can be for gameplay clips!!"
//  A clip is a short video (klabnet-api routers/clips.py: videos.kind
//  'clip', up to CLIP_MAX_SECONDS, an optional game): Videos' pipeline, so
//  the ladder keeps 60fps and the Original is there, with comments and
//  reactions, but a place and a feel of its own.
//    · The page is a view of Videos' #vidPage, as TV's is (js/40-tv.js):
//      the Clips row (data-vid="clips") takes it over through
//      window.klabVideosLeave, and anything Videos draws there lets it go
//      (a MutationObserver). Game chips and a Sort (New / Top this week /
//      month / all time) over a dense grid; resting the pointer on a card
//      plays it there, muted, from a 720p-or-lower rung (one at a time; not
//      with reduced motion or Performance mode).
//    · A clip opens in the viewer: a large sheet over the page (klabLayers
//      'viewer'), the clip looping (r to turn that off: then it goes on to
//      the next), ←/→ or ↑/↓ through the clips in the current filter,
//      reactions and comments (the comment kit) beside it, ⋯ for Share,
//      Copy link, Save to playlist and Download. Sound on, unless you muted
//      clips on this device (klabnet_clips).
//    · Upload clips: several files at once, each queued through Videos'
//      background uploads (window.klabVideoUpload), a title each and one
//      game for the lot.
//    · Make a clip from a video: the watch view's Clip button (or its
//      right-click) marks a range on the scrub bar; klabnet-api cuts it
//      from the upload and makes it like any other ("Clipped from …").
//  window.klabClips: show({game, sort, user}), open(id), fromRange(videoId,
//  start, end, {title, game, timeline, edit}) (the Studio's editor sends
//  timeline 'upload' and its edit), makeFrom(video, at),
//  cardHTML(clip), forUser(name), entries() (Go anywhere), state().
//  Deep links: #videos/clips, #videos/clips?game=<name>, #videos/clip/<id>.
// ══════════════════════════════════════════
(function () {
  const $ = id => document.getElementById(id);
  const page = $('vidPage'), nav = $('vidNav');
  if (!page || !nav) return;
  const API = '/api/posts/videos';
  const CL = API + '/clips';
  const HLS_LIB = 'js/vendor/hls.light.min.js?v=1.5.20';
  const me = () => window.KLAB_USER?.username || '';
  const admin = () => !!window.KLAB_USER?.is_admin;
  const showing = () => document.body.classList.contains('tab-videos-active');
  const panel = () => page.closest('.tab-panel');
  const motionOk = () => window.klabMotionOk?.() ?? true;
  let MAX = 180; // CLIP_MAX_SECONDS, as the API last said

  // ── Little things ──
  const apiTime = s => {
    if (!s) return 0;
    const str = String(s);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime() || 0;
  };
  function when(c) {
    const t = apiTime(c.published || c.created);
    if (!t) return '';
    if (Date.now() - t < 7 * 864e5) return klabRelativeTime(t);
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function dur(s) {
    s = Math.max(0, Math.floor(+s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  // 12:34.5, for the clip maker's range (tenths matter at 60fps).
  const durT = s => dur(s) + '.' + Math.floor(((+s || 0) % 1) * 10);
  function face(u, cls) {
    const url = window.klabResolveUserAvatar?.(u);
    const color = typeof profileColor === 'function' ? profileColor(u) : '';
    return '<span class="vid-face ' + (cls || '') + '" data-face="' + esc(u) + '" style="--c:' + color + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  function refreshFaces(root) {
    (root || document).querySelectorAll('.vid-face[data-face]:not(:has(img))').forEach(el => {
      const url = window.klabResolveUserAvatar?.(el.dataset.face);
      if (url) el.innerHTML = '<img src="' + esc(url) + '" alt="" />';
    });
  }
  async function getJSON(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 15000);
    try {
      const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.error || 'failed (' + r.status + ')'); e.status = r.status; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const reactCount = c => Object.values(c.reactions || {}).reduce((a, x) => a + (x.count || 0), 0);
  const linkTo = c => location.origin + location.pathname + '#videos/clip/' + c.id;
  const cleanTitle = name => name.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('klabnet_clips') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('klabnet_clips', JSON.stringify(prefs)); } catch {} };

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

  // ── Games ──
  // The games clips are of (klabnet-api merges them by case), cached for
  // the chips, the upload form's suggestions and Go anywhere.
  let games = null, gamesAt = 0, gamesLoading = null;
  function loadGames(force) {
    if (games && !force && Date.now() - gamesAt < 60000) return Promise.resolve(games);
    return gamesLoading ||= getJSON(CL + '/games', null, 10000).then(j => {
      games = j.games || []; gamesAt = Date.now(); if (j.max) MAX = j.max; return games;
    }).catch(() => (games = games || [])).finally(() => { gamesLoading = null; });
  }
  const gameList = () => '<datalist id="clipGameList">' + (games || []).map(g => '<option value="' + esc(g.name) + '"></option>').join('') + '</datalist>';

  // ── Cards ──
  function cardHTML(c, opts) {
    const o = opts || {};
    const proc = c.status !== 'ready';
    const n = reactCount(c);
    return '<button type="button" class="clip-card' + (proc ? ' processing' : '') + '" data-clip-id="' + c.id + '" data-silent>' +
      '<span class="clip-thumb">' +
        (c.posterSmall ? '<img src="' + esc(c.posterSmall) + '" alt="" loading="lazy" draggable="false" />' : '<span class="vid-thumb-ph"><i class="ti ti-scissors"></i></span>') +
        (proc
          ? '<span class="vid-proc">' + (c.status === 'failed' ? '<i class="ti ti-alert-triangle"></i>Couldn’t process it' : '<span class="vid-spin"></span>Processing ' + Math.round((c.progress || 0) * 100) + '%') + '</span>'
          : (c.duration ? '<span class="vid-dur">' + dur(c.duration) + '</span>' : '')) +
        (c.game && !o.noGame ? '<span class="clip-game">' + esc(c.game) + '</span>' : '') +
      '</span>' +
      '<span class="clip-card-title">' + esc(c.title || 'Untitled') + '</span>' +
      '<span class="clip-card-sub">' +
        (o.noUser ? '' : face(c.username, 'clip-card-face') + '<span class="clip-card-who">' + esc(c.username) + '</span><span class="clip-dot">·</span>') +
        '<span>' + klabCount(c.views || 0, 'view') + (n ? ' · ' + klabCount(n, 'reaction') : '') + '</span>' +
      '</span>' +
    '</button>';
  }

  // ── The page ──
  const SORTS = [
    { key: 'new', label: 'New', q: 'sort=new' },
    { key: 'week', label: 'Top this week', q: 'sort=top&window=week' },
    { key: 'month', label: 'Top this month', q: 'sort=top&window=month' },
    { key: 'all', label: 'Top all time', q: 'sort=top&window=all' },
  ];
  const sortOf = k => SORTS.find(s => s.key === k) || SORTS[0];
  let view = null;   // null, or { game, sort, user, q }
  let root = null;
  let list = [], total = 0, more = false, loading = false, token = 0;
  let restoring = false;
  const PAGE = 30;
  const byId = id => list.find(c => c.id === +id);

  function setRow(on) {
    nav.querySelectorAll('.picker-tab[data-vid]').forEach(b => b.classList.toggle('active', on && b.dataset.vid === 'clips'));
  }
  function record(v) {
    if (restoring) return;
    window.klabNav?.push({ tab: 'videos', kind: 'clips', view: { game: v.game || '', sort: v.sort, user: v.user || '' } });
  }
  const LOADING = '<div class="k-empty vid-empty"><i class="ti ti-loader loading-spinner"></i><div>Loading…</div></div>';
  function emptyHTML(text, upload) {
    return '<div class="k-empty vid-empty"><i class="ti ti-scissors"></i><div>' + esc(text) + '</div>' +
      (upload ? '<button type="button" class="k-btn" data-cl="upload"><i class="ti ti-upload"></i><span>Upload clips</span></button>' : '') + '</div>';
  }

  function headHTML(v) {
    const upload = '<button type="button" class="k-btn" data-cl="upload"><i class="ti ti-upload"></i><span>Upload clips</span></button>';
    if (v.user) {
      return '<div class="vid-channel">' + face(v.user, 'big') + '<div class="vid-channel-tx"><h2>' + esc(v.user) + '</h2><span id="clipCount"></span></div>' +
        '<div class="vid-channel-acts"><div class="k-seg vid-kind" role="group" aria-label="Show">' +
          '<button type="button" data-cl="channel" aria-pressed="false">Videos</button><button type="button" aria-pressed="true">Clips</button></div>' +
          (v.user === me() ? upload : '') +
          '<button type="button" class="k-btn" data-cl="profile"><i class="ti ti-user"></i><span>Profile</span></button></div></div>';
    }
    return '<div class="k-page-head vid-head"><h2 class="k-page-title">Clips</h2><span class="k-page-count" id="clipCount"></span>' +
      '<div class="k-page-actions">' + upload + '</div></div>';
  }
  function chipsHTML(v) {
    const gs = (games || []).slice();
    if (v.game && !gs.some(g => g.name.toLowerCase() === v.game.toLowerCase())) gs.unshift({ name: v.game, count: 0 });
    const on = g => !!v.game && g.name.toLowerCase() === v.game.toLowerCase();
    return '<button type="button" class="k-chip' + (!v.game ? ' on' : '') + '" data-game="" aria-pressed="' + !v.game + '">All games</button>' +
      gs.map(g => '<button type="button" class="k-chip' + (on(g) ? ' on' : '') + '" data-game="' + esc(g.name) + '" aria-pressed="' + on(g) + '">' + esc(g.name) +
        (g.count ? '<span class="clips-n">' + g.count + '</span>' : '') + '</button>').join('');
  }

  function take() {
    window.klabVideosLeave?.();
    hoverStop();
  }
  // opts: quiet (no Back step), inPlace (a filter or the sort changed: the
  // page stays, the chips and the grid change, no entering again),
  // keepScroll.
  async function show(o, opts) {
    const op = opts || {};
    const v = { game: '', sort: prefs.sort || 'new', user: '', q: '', ...(o || {}) };
    if (!SORTS.some(s => s.key === v.sort)) v.sort = 'new';
    if (!showing()) setActiveTab('videos');
    const inPlace = !!op.inPlace && !!view && !!root && page.contains(root) && (view.user || '') === (v.user || '');
    if (!inPlace) take();
    view = v;
    setRow(!v.user || v.user === me());
    if (!op.quiet) record(v);
    const my = ++token;
    list = []; total = 0; more = false; loading = false;
    if (inPlace) {
      $('clipGames').innerHTML = chipsHTML(v);
      root.querySelector('.clips-sort span').textContent = sortOf(v.sort).label;
      const ql = root.querySelector('.clips-q');
      ql.hidden = !v.q; ql.textContent = v.q ? 'Clips matching “' + v.q + '”' : '';
      $('clipGrid').classList.add('busy');
      const top = root.querySelector('.clips-bar');
      if (panel() && top && panel().scrollTop > top.offsetTop) panel().scrollTop = Math.max(0, top.offsetTop - 8);
    } else {
      page.innerHTML = '<div class="clips-root">' + headHTML(v) +
        '<div class="clips-bar"><div class="clips-games" id="clipGames" role="group" aria-label="Game">' + chipsHTML(v) + '</div>' +
          '<button type="button" class="k-btn sm clips-sort" data-cl="sort" aria-haspopup="menu" title="Sort"><i class="ti ti-arrows-sort"></i><span>' + esc(sortOf(v.sort).label) + '</span><i class="ti ti-chevron-down"></i></button></div>' +
        '<div class="clips-q"' + (v.q ? '' : ' hidden') + '>' + (v.q ? 'Clips matching “' + esc(v.q) + '”' : '') + '</div>' +
        '<div class="clips-grid" id="clipGrid">' + LOADING + '</div></div>';
      root = page.firstElementChild;
      if (panel() && !op.keepScroll) panel().scrollTop = 0;
      klabEnter(root);
    }
    loadGames().then(() => { if (my === token && $('clipGames')) { if (v.user) gamesFor(v.user, my); else $('clipGames').innerHTML = chipsHTML(v); } });
    await loadMore(my, true);
  }
  // A person's clips: only their games as chips.
  async function gamesFor(user, my) {
    try {
      const j = await getJSON(CL + '/games?user=' + encodeURIComponent(user), null, 10000);
      if (my !== token || !$('clipGames')) return;
      const keep = games; games = j.games || [];
      $('clipGames').innerHTML = chipsHTML(view);
      games = keep;
    } catch (e) {}
  }
  function query(v, offset) {
    return CL + '?limit=' + PAGE + '&offset=' + offset + '&' + sortOf(v.sort).q +
      (v.game ? '&game=' + encodeURIComponent(v.game) : '') + (v.user ? '&user=' + encodeURIComponent(v.user) : '') +
      (v.q ? '&q=' + encodeURIComponent(v.q) : '');
  }
  async function loadMore(my, first) {
    if (loading && !first) return;
    loading = true;
    const v = view;
    try {
      const j = await getJSON(query(v, list.length));
      if (my !== token) return;
      if (j.max) MAX = j.max;
      const got = (j.clips || []).filter(c => !byId(c.id));
      list = list.concat(got);
      total = j.total ?? list.length;
      more = got.length >= PAGE && list.length < total;
      const grid = $('clipGrid');
      if (!grid) return;
      if (first) { grid.innerHTML = ''; grid.classList.remove('busy'); }
      if (!list.length) {
        grid.innerHTML = v.q ? emptyHTML('No clips match that.')
          : v.user ? emptyHTML(v.user === me() ? 'You haven’t uploaded any clips yet.' : v.user + ' hasn’t uploaded any clips yet.', v.user === me())
          : v.game ? emptyHTML('No clips of ' + v.game + ' yet.', true)
          : emptyHTML('No clips yet. Got a good one?', true);
      } else if (got.length) {
        grid.insertAdjacentHTML('beforeend', got.map(c => cardHTML(c, { noUser: !!v.user, noGame: !!v.game })).join(''));
      }
      const n = $('clipCount');
      if (n) n.textContent = total ? klabCount(total, 'clip') : '';
      if (vw) paintPos();
      watchProcessing();
      setTimeout(() => refreshFaces(page), 1500);
    } catch (e) {
      if (my !== token) return;
      const grid = $('clipGrid');
      if (grid && !list.length) grid.innerHTML = emptyHTML(e.status === 404 || e.status === 422 ? 'Clips need the latest klabnet-api.' : 'Couldn’t load clips just now.');
    } finally { if (my === token) loading = false; }
  }
  document.addEventListener('scroll', e => {
    const p = panel();
    if (!view || !root || e.target !== p || !more || loading) return;
    if (p.scrollTop + p.clientHeight > p.scrollHeight - 600) loadMore(token);
  }, true);
  // Leaving the page (Videos drew something else over it).
  function leave() {
    hoverStop();
    view = null; root = null; token++;
    clearTimeout(procT);
    setSearchHint(false);
  }
  // (And the viewer, if something put another view under it: a link, Back.)
  new MutationObserver(() => { if (view && root && !page.contains(root)) leave(); if (vw) closeViewer(); }).observe(page, { childList: true });

  // Cards still being made tick along until they're done.
  let procT = 0;
  function watchProcessing() {
    clearTimeout(procT);
    const ids = list.filter(c => c.status === 'processing').map(c => c.id);
    if (!ids.length || !showing() || !view) return;
    procT = setTimeout(async () => {
      for (const id of ids) {
        try {
          const c = await getJSON(API + '/' + id, null, 8000);
          const i = list.findIndex(x => x.id === id);
          if (i < 0) continue;
          list[i] = c;
          page.querySelectorAll('.clip-card[data-clip-id="' + id + '"]').forEach(el => { el.outerHTML = cardHTML(c, { noUser: !!view?.user, noGame: !!view?.game }); });
          if (vw && vw.c.id === id && c.status !== 'processing') { vw.list[vw.i] = c; mountClip(); }
        } catch (e) {}
      }
      watchProcessing();
    }, 4000);
  }

  // ── Resting on a card plays it, muted ──
  // One at a time, from a rung no bigger than 720p (the card is small),
  // after a moment's rest so a pointer passing over doesn't start things.
  // Never with reduced motion or in Performance mode (klabMotionOk), nor
  // on a touch screen.
  let hov = null; // { card, el, hls, t }
  const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
  function hoverStart(card) {
    if (hov && hov.card === card) return;
    hoverStop();
    if (!canHover() || !motionOk() || card.classList.contains('processing')) return;
    const c = byId(card.dataset.clipId);
    if (!c || !c.hls) return;
    hov = { card, el: null, hls: null, t: setTimeout(() => hoverPlay(c), 260) };
  }
  function hoverPlay(c) {
    const h = hov;
    if (!h || !h.card.isConnected) return;
    const thumb = h.card.querySelector('.clip-thumb');
    const el = document.createElement('video');
    el.className = 'clip-hov';
    el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
    el.setAttribute('aria-hidden', 'true');
    thumb.insertBefore(el, thumb.querySelector('.vid-dur, .clip-game'));
    h.el = el;
    el.addEventListener('playing', () => thumb.classList.add('hov-on'), { once: true });
    const native = !window.MediaSource && el.canPlayType('application/vnd.apple.mpegurl');
    if (native) { el.src = c.hls; el.play().catch(() => {}); return; }
    loadHls().then(Hls => {
      if (hov !== h) return;
      if (!Hls.isSupported()) { el.src = c.hls; el.play().catch(() => {}); return; }
      const hl = new Hls({ autoStartLoad: false, capLevelToPlayerSize: true, maxBufferLength: 8, maxMaxBufferLength: 12 });
      h.hls = hl;
      hl.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hov !== h) return;
        // The best rung at 720p or under (short side), 60fps where there is.
        let pick = 0, best = -1;
        hl.levels.forEach((l, i) => { const s = Math.min(l.height || 0, l.width || l.height || 0); if (s <= 720 && s * 1000 + (l.frameRate || 0) > best) { best = s * 1000 + (l.frameRate || 0); pick = i; } });
        hl.autoLevelCapping = pick;
        hl.startLevel = pick;
        hl.startLoad();
        el.play().catch(() => {});
      });
      hl.loadSource(c.hls);
      hl.attachMedia(el);
    }).catch(() => {});
  }
  function hoverStop() {
    const h = hov;
    hov = null;
    if (!h) return;
    clearTimeout(h.t);
    if (h.hls) { try { h.hls.destroy(); } catch {} }
    if (h.el) { h.el.pause(); h.el.removeAttribute('src'); try { h.el.load(); } catch {} h.el.remove(); }
    h.card.querySelector('.clip-thumb')?.classList.remove('hov-on');
  }
  page.addEventListener('pointerover', e => {
    if (!view || e.pointerType !== 'mouse') return;
    const card = e.target.closest?.('.clip-card');
    if (card) hoverStart(card);
  });
  page.addEventListener('pointerout', e => {
    if (!hov) return;
    if (!hov.card.contains(e.relatedTarget)) hoverStop();
  });
  addEventListener('blur', () => hoverStop());

  // ── What you press on the page ──
  page.addEventListener('click', e => {
    if (!view || !root || !root.contains(e.target)) return;
    const card = e.target.closest('.clip-card');
    if (card) { hoverStop(); SFX && SFX.play('nav'); openViewer(list, list.findIndex(c => c.id === +card.dataset.clipId)); return; }
    const chip = e.target.closest('[data-game]');
    if (chip) { if ((view.game || '') !== chip.dataset.game) show({ ...view, game: chip.dataset.game }, { inPlace: true }); return; }
    const b = e.target.closest('[data-cl]');
    if (!b) return;
    const act = b.dataset.cl;
    if (act === 'upload') uploadDialog();
    else if (act === 'sort') {
      klabMenu.at(b, SORTS.map(s => ({ label: s.label, checked: s.key === view.sort, action: () => { prefs.sort = s.key; savePrefs(); show({ ...view, sort: s.key }, { quiet: true, inPlace: true }); } })), { align: 'end' });
    }
    else if (act === 'channel') window.klabOpenChannel?.(view.user);
    else if (act === 'profile') window.openProfileView?.(view.user);
  });
  page.addEventListener('contextmenu', e => {
    if (!view || !root) return;
    const card = e.target.closest('.clip-card');
    const c = card && byId(card.dataset.clipId);
    if (c) klabMenu(e, clipMenu(c, list));
  });
  page.addEventListener('keydown', e => {
    // ←/→ along the chips (they're one control).
    const chip = e.target.closest?.('.clips-games .k-chip');
    if (!chip || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const all = [...chip.parentNode.children];
    const next = all[all.indexOf(chip) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) { e.preventDefault(); e.stopPropagation(); next.focus(); }
  });

  // From Videos' own views: a channel's Clips tab, a search's clips, the
  // watch view's Clip button. (Capture: ahead of 39-videos.js's handlers.)
  page.addEventListener('click', e => {
    const tab = e.target.closest('[data-chkind="clips"]');
    if (tab) { e.stopPropagation(); SFX && SFX.play('click'); show({ user: tab.dataset.user }); return; }
    const sc = !view && e.target.closest('.vid-card[data-kind="clip"]');
    if (sc) {
      e.stopPropagation(); SFX && SFX.play('nav');
      openFromSearch(+sc.dataset.vidId);
      return;
    }
    const mk = e.target.closest('[data-act="clip"]');
    if (mk && window.klabWatch?.current()) {
      e.stopPropagation();
      const v = window.klabWatch.current(), el = window.klabWatch.video();
      makeFrom(v, el ? el.currentTime : 0);
    }
  }, true);
  // A search's clip results: the viewer goes through what the search found.
  async function openFromSearch(id) {
    const q = $('vidSearch')?.value.trim() || '';
    let clips = [];
    try { clips = (await getJSON(CL + '?limit=60&sort=new' + (q ? '&q=' + encodeURIComponent(q) : ''))).clips || []; } catch (e) {}
    if (!clips.some(c => c.id === id)) { try { clips.unshift(await getJSON(API + '/' + id)); } catch (e) { showToast('Couldn’t open that clip', 'ti-alert-triangle'); return; } }
    openViewer(clips, clips.findIndex(c => c.id === id), { standalone: true });
  }

  // The sidebar's row (ahead of 39-videos.js's own, which doesn't know it).
  nav.addEventListener('click', e => {
    const b = e.target.closest('.picker-tab[data-vid="clips"]');
    if (!b) return;
    e.stopPropagation();
    SFX && SFX.play('click');
    show({});
    if (document.activeElement === b) b.blur();
  }, true);

  // Title bar search: on Clips it looks through clips.
  const search = $('vidSearch');
  let searchT = 0, searchHint = '';
  function setSearchHint(on) {
    if (!search) return;
    if (on && !searchHint) { searchHint = search.placeholder; search.placeholder = 'Search clips'; }
    else if (!on && searchHint) { search.placeholder = searchHint; searchHint = ''; }
  }
  search?.addEventListener('input', e => {
    if (!view) return;
    e.stopImmediatePropagation();
    clearTimeout(searchT);
    searchT = setTimeout(() => { if (view) show({ ...view, q: search.value.trim() }, { quiet: true, inPlace: true }); }, 250);
  }, true);

  // Clips dropped on the page while it shows: Upload clips, with them.
  $('videosShell')?.addEventListener('drop', e => {
    if (!view || !root || $('clipDrop')) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation();
    uploadDialog(files);
  }, true);

  // ── A clip's menu (a card's right-click, the viewer's ⋯) ──
  function canEdit(c) { return c.canEdit ?? (c.username === me() || admin()); }
  function clipMenu(c, inList) {
    return [
      { header: c.title || 'Untitled' },
      { label: 'Open', icon: 'ti-player-play', hidden: !!vw, disabled: c.status !== 'ready', action: () => openViewer(inList || [c], Math.max(0, (inList || [c]).indexOf(c))) },
      { label: 'Share…', icon: 'ti-share-2', disabled: c.status !== 'ready', action: () => window.klabVideoShare?.(c) },
      { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(linkTo(c), 'Link') },
      { label: 'Save to playlist…', icon: 'ti-playlist-add', disabled: c.status !== 'ready', action: () => setTimeout(() => window.klabVideoSave?.(c, vw?.el.querySelector('[data-cv="more"]') || null, lastMenuEvent), 0) },
      { label: 'Download', icon: 'ti-download', hint: c.original ? 'Original' : '', hidden: !c.original, action: () => download(c) },
      '-',
      { label: 'Open as a video', icon: 'ti-movie', disabled: c.status !== 'ready', action: () => { closeViewer(); window.klabOpenVideo?.(c.id); } },
      { label: 'Clipped from “' + (c.clipOf?.title || '') + '”', icon: 'ti-scissors', hidden: !c.clipOf?.title, action: () => { closeViewer(); window.klabOpenVideo?.(c.clipOf.id, c.clipOf.start); } },
      { label: c.username === me() ? 'Your clips' : c.username + '’s clips', icon: 'ti-user', hidden: view?.user === c.username && !vw, action: () => { closeViewer(); show({ user: c.username }); } },
      '-',
      { label: 'Edit clip…', icon: 'ti-pencil', hidden: !canEdit(c), action: () => editDialog(c) },
      { label: 'Delete clip', icon: 'ti-trash', danger: true, hidden: !canEdit(c), action: () => deleteClip(c) },
    ];
  }
  let lastMenuEvent = null;
  document.addEventListener('contextmenu', e => { lastMenuEvent = e; }, true);
  function download(c) {
    if (!c.original?.url) return;
    const a = document.createElement('a');
    a.href = c.original.url;
    a.download = (c.title || 'clip').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.mp4';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── The viewer ──
  // A large sheet over the page: the clip on the left (a screen, dark in
  // any theme; portrait clips letterboxed), the rest on the right. It goes
  // through `list` (the page's, so ←/→ follow the filter) from index i.
  let vw = null;
  const CODEC_TEST = { h264: 'avc1.640033', hevc: 'hvc1.1.6.L153.B0', av1: 'av01.0.12M.08', vp9: 'vp09.00.51.08' };
  function canOriginal(c) {
    const o = c && c.original;
    if (!o || !o.url || !CODEC_TEST[o.codec]) return false;
    try { return !!document.createElement('video').canPlayType('video/mp4; codecs="' + CODEC_TEST[o.codec] + '"'); } catch { return false; }
  }
  const rungName = (h, w, fps) => Math.min(h || 0, w || h || 0) + 'p' + (fps > 30.5 ? Math.round(fps) : '');
  const mbps = b => (b / 1e6).toFixed(b >= 1e7 ? 0 : 1) + ' Mbps';

  function openViewer(clips, i, o) {
    if (!clips || !clips.length || i < 0) return;
    if (!vw) {
      const el = document.createElement('div');
      el.className = 'clipv-backdrop';
      el.innerHTML = '<div class="clipv" role="dialog" aria-modal="true" aria-label="Clip" tabindex="-1">' +
        '<div class="clipv-stage"><div class="vp clipv-vp" id="clipVp" tabindex="0"></div>' +
          '<button type="button" class="k-icon on-media clipv-nav prev" data-cv="prev" title="Previous clip (←)" aria-label="Previous clip"><i class="ti ti-chevron-left"></i></button>' +
          '<button type="button" class="k-icon on-media clipv-nav next" data-cv="next" title="Next clip (→)" aria-label="Next clip"><i class="ti ti-chevron-right"></i></button></div>' +
        '<aside class="clipv-side">' +
          '<div class="clipv-top"><span class="clipv-pos" id="clipPos"></span>' +
            '<button type="button" class="k-icon" data-cv="more" title="More" aria-label="More" aria-haspopup="menu"><i class="ti ti-dots"></i></button>' +
            '<button type="button" class="k-icon" data-cv="close" title="Close (Esc)" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
          '<div class="clipv-scroll" id="clipSide"></div>' +
        '</aside></div>';
      document.body.appendChild(el);
      vw = { el, list: clips, i, c: clips[i], fromPage: clips === list, standalone: !!(o && o.standalone), hls: null, video: null, src: 'hls', played: 0, lastTick: 0, viewSent: false };
      vw.pop = klabLayers.push(el, { kind: 'viewer', dim: true, close: () => closeViewer() });
      el.addEventListener('click', viewerClick);
      el.addEventListener('submit', commentSubmit);
      el.addEventListener('contextmenu', e => {
        if (e.target.closest('.k-com, .k-com-form, input, textarea, a')) return;
        if (!vw) return;
        klabMenu(e, clipMenu(vw.c, vw.list));
      });
      requestAnimationFrame(() => el.classList.add('open'));
      SFX && SFX.play('sheet');
      vw.returnFocus = document.activeElement;
    } else { vw.list = clips; vw.i = i; vw.c = clips[i]; vw.fromPage = clips === list; vw.standalone = !!(o && o.standalone); }
    mountClip();
  }
  function closeViewer() {
    if (!vw) return;
    const v = vw;
    vw = null;
    stopPlayer(v);
    v.pop?.();
    v.el.classList.remove('open');
    SFX && SFX.play('sheet_close');
    setTimeout(() => v.el.remove(), 160);
    try { v.returnFocus?.focus?.({ preventScroll: true }); } catch {}
    window.klabnetDesktop?.trimMemory?.();
  }
  function stopPlayer(v) {
    v = v || vw;
    if (!v) return;
    if (document.fullscreenElement && v.el.contains(document.fullscreenElement)) document.exitFullscreen?.();
    if (v.hls) { try { v.hls.destroy(); } catch {} v.hls = null; }
    if (v.video) { v.video.pause(); v.video.removeAttribute('src'); try { v.video.load(); } catch {} }
    v.video = null;
    clearTimeout(v.waitT);
  }
  function paintPos() {
    if (!vw) return;
    const p = vw.el.querySelector('#clipPos');
    const n = vw.fromPage ? Math.max(vw.list.length, total || 0) : vw.list.length;
    if (p) p.textContent = n > 1 ? (vw.i + 1) + ' of ' + n : '';
    vw.el.querySelector('[data-cv="prev"]').disabled = vw.i <= 0;
    vw.el.querySelector('[data-cv="next"]').disabled = vw.i >= vw.list.length - 1 && !(more && vw.fromPage);
  }
  async function step(d) {
    if (!vw) return;
    let i = vw.i + d;
    if (i >= vw.list.length && more && vw.fromPage) {
      await loadMore(token);
      if (!vw) return;
      vw.list = list;
    }
    if (i < 0 || i >= vw.list.length) return;
    vw.i = i; vw.c = vw.list[i];
    SFX && SFX.play('tick');
    mountClip();
  }

  function sideHTML(c) {
    const from = c.clipOf;
    return '<h2 class="clipv-title">' + esc(c.title || 'Untitled') + '</h2>' +
      '<button type="button" class="vid-by-who clipv-by" data-cv="user" data-silent>' + face(c.username) +
        '<span><b>' + esc(c.username) + '</b><span>' + klabCount(c.views || 0, 'view') + ' · ' + esc(when(c)) + '</span></span></button>' +
      ((c.game || from) ? '<div class="clipv-tags">' +
        (c.game ? '<button type="button" class="k-chip clipv-game" data-cv="game" title="All ' + esc(c.game) + ' clips"><i class="ti ti-scissors"></i>' + esc(c.game) + '</button>' : '') +
        (from ? '<span class="clipv-from">Clipped from ' + (from.title ? '<button type="button" data-cv="from">' + esc(from.title) + '</button>' : 'a video that’s gone') + ' at ' + dur(from.start) + '</span>' : '') +
      '</div>' : '') +
      (c.description ? '<p class="clipv-desc">' + esc(c.description) + '</p>' : '') +
      '<div class="vid-reacts clipv-reacts" id="clipReacts">' + reactsHTML(c) + '</div>' +
      '<div class="clipv-comments">' +
        '<div class="k-label vid-label" id="clipComCount">Comments</div>' +
        klabComments.formHTML({ formId: 'clipComForm', id: 'clipComInput' }) +
        '<div class="k-com-list" id="clipComList"><div class="k-empty k-com-empty">Loading…</div></div>' +
      '</div>';
  }
  function reactsHTML(c) {
    const r = c.reactions || {};
    const star = r[KLAB_STAR] || { count: 0, mine: false };
    return '<button type="button" class="vid-pill vid-star' + (star.mine ? ' mine' : '') + '" data-emoji="' + KLAB_STAR + '" aria-pressed="' + !!star.mine + '" title="' + (star.mine ? 'Unstar' : 'Star') + '">' +
        '<i class="ti ' + (star.mine ? 'ti-star-filled' : 'ti-star') + '"></i>' + (star.count ? '<span>' + star.count + '</span>' : '') + '</button>' +
      Object.entries(r).filter(([e]) => e !== KLAB_STAR).map(([e, x]) =>
        '<button type="button" class="vid-pill' + (x.mine ? ' mine' : '') + '" data-emoji="' + esc(e) + '">' + klabReactHTML(e) + '<span>' + x.count + '</span></button>').join('') +
      '<button type="button" class="vid-pill vid-react-add" title="React" aria-label="React"><i class="ti ti-mood-plus"></i></button>';
  }

  function mountClip() {
    if (!vw) return;
    stopPlayer();
    const c = vw.c;
    vw.played = 0; vw.lastTick = 0; vw.viewSent = false;
    paintPos();
    $('clipSide').innerHTML = sideHTML(c);
    $('clipSide').scrollTop = 0;
    setTimeout(() => { refreshFaces(vw?.el); klabComments.refreshFaces(vw?.el); }, 1500);
    loadComments(c);
    const box = $('clipVp');
    box.className = 'vp clipv-vp paused fresh';
    if (c.status !== 'ready') {
      box.innerHTML = '<div class="vp-wait">' + (c.poster ? '<img src="' + esc(c.poster) + '" alt="" />' : '') +
        '<div class="vp-wait-tx">' + (c.status === 'failed'
          ? '<i class="ti ti-alert-triangle"></i><b>Couldn’t make this clip</b><span>' + esc(c.error || 'The file may be damaged or in a format ffmpeg can’t read.') + '</span>'
          : '<span class="vid-spin"></span><b>Processing</b><span>' + Math.round((c.progress || 0) * 100) + '% · it plays here once it’s done</span>') + '</div></div>';
      if (c.status === 'processing') vw.waitT = setTimeout(async () => {
        const id = c.id;
        try { const n = await getJSON(API + '/' + id, null, 8000); if (vw && vw.c.id === id) { vw.list[vw.i] = n; vw.c = n; mountClip(); } } catch (e) { if (vw && vw.c.id === id) mountClip(); }
      }, 4000);
      return;
    }
    box.innerHTML =
      '<video playsinline preload="auto"></video>' +
      (c.poster ? '<img class="vp-poster" src="' + esc(c.poster) + '" alt="" draggable="false" />' : '') +
      '<button type="button" class="vp-big" data-vc="play" aria-label="Play" data-silent><i class="ti ti-player-play-filled"></i></button>' +
      '<div class="vp-spin" hidden><span class="vid-spin"></span></div>' +
      '<div class="vp-ctrl">' +
        '<div class="vp-scrub" data-vc="scrub"><div class="vp-rail"><b class="vp-buf clip-bar"></b><b class="vp-fill clip-bar"></b><i class="vp-knob"></i></div>' +
          '<div class="vp-peek" hidden><span class="vp-peek-img"></span><span class="vp-peek-t"></span></div></div>' +
        '<div class="vp-row">' +
          '<button type="button" class="vp-btn" data-vc="play" title="Play (k)" data-silent><i class="ti ti-player-play-filled"></i></button>' +
          '<div class="vp-vol"><button type="button" class="vp-btn" data-vc="mute" title="Mute (m)" data-silent><i class="ti ti-volume"></i></button>' +
            '<input type="range" class="vp-vol-range" min="0" max="1" step="0.02" aria-label="Volume" /></div>' +
          '<span class="vp-time"><span class="vp-now">0:00</span> / <span class="vp-len">' + dur(c.duration) + '</span></span>' +
          '<span class="vp-gap"></span>' +
          '<button type="button" class="vp-btn clipv-loop" data-vc="loop" data-silent></button>' +
          '<button type="button" class="vp-btn vp-text" data-vc="quality" title="Quality">Auto</button>' +
          '<button type="button" class="vp-btn" data-vc="full" title="Full screen (f)" data-silent><i class="ti ti-arrows-maximize"></i></button>' +
        '</div>' +
        '<div class="vp-menu" hidden></div>' +
      '</div>';
    const el = box.querySelector('video');
    vw.video = el;
    el.volume = prefs.volume ?? 1;
    el.muted = !!prefs.muted;
    el.loop = prefs.loop !== false;
    paintLoop();
    const mine = vw;
    if (prefs.original && canOriginal(c)) startOriginal(c, 0); else startHls(c, 0);
    for (const ev of ['play', 'pause', 'timeupdate', 'progress', 'volumechange', 'durationchange']) el.addEventListener(ev, paint);
    el.addEventListener('play', () => { box.classList.remove('paused', 'fresh'); quietMusic(); wake(); });
    el.addEventListener('playing', () => box.classList.add('started'), { once: true });
    el.addEventListener('pause', () => { box.classList.add('paused'); wake(); });
    el.addEventListener('volumechange', () => { if (!el.paused) quietMusic(); });
    el.addEventListener('waiting', () => { box.querySelector('.vp-spin').hidden = false; });
    for (const ev of ['playing', 'canplay', 'seeked']) el.addEventListener(ev, () => { box.querySelector('.vp-spin').hidden = true; });
    el.addEventListener('timeupdate', () => {
      if (vw !== mine || vw.video !== el) return;
      const now = performance.now();
      if (vw.lastTick && !el.paused) vw.played += Math.min(1, (now - vw.lastTick) / 1000);
      vw.lastTick = now;
      if (!vw.viewSent && vw.played >= Math.min(10, (c.duration || 20) * 0.5)) sendView(c);
    });
    // Loop off: on to the next one (that's what turning it off is for).
    el.addEventListener('ended', () => {
      sendView(c);
      if (vw === mine && vw.video === el && vw.i < vw.list.length - 1) step(1);
      else box.classList.add('paused');
    });
    el.addEventListener('click', () => togglePlay());
    el.addEventListener('dblclick', () => toggleFull());
    box.addEventListener('pointermove', wake);
    box.addEventListener('pointerleave', () => { clearTimeout(vw?.idleT); if (vw) vw.idleT = setTimeout(() => idle(), 600); });
    const vol = box.querySelector('.vp-vol-range');
    vol.value = el.muted ? 0 : el.volume;
    vol.addEventListener('input', () => { el.volume = +vol.value; el.muted = +vol.value === 0; prefs.volume = el.volume; prefs.muted = el.muted; savePrefs(); });
    scrubber(box.querySelector('.vp-scrub'), c);
    setTimeout(() => { if (vw === mine) box.focus({ preventScroll: true }); }, 30);
  }
  // Sound on when it opens (you pressed something); if the browser won't
  // have it, muted, and the mute button says so.
  function autoplay(el) {
    el.play().catch(() => { if (!vw || vw.video !== el) return; el.muted = true; paint(); el.play().catch(() => vw?.el.querySelector('.clipv-vp')?.classList.add('paused')); });
  }
  function startHls(c, start, level) {
    const el = vw.video, mine = vw;
    vw.src = 'hls';
    const native = !window.MediaSource && el.canPlayType('application/vnd.apple.mpegurl');
    paintQuality();
    if (native) {
      el.src = c.hls;
      el.addEventListener('loadedmetadata', () => { if (start > 0) el.currentTime = start; autoplay(el); }, { once: true });
      return;
    }
    loadHls().then(Hls => {
      if (vw !== mine || vw.video !== el || vw.src !== 'hls') return;
      if (!Hls.isSupported()) { el.src = c.hls; el.addEventListener('loadedmetadata', () => autoplay(el), { once: true }); return; }
      let bw = 0;
      try { bw = JSON.parse(localStorage.getItem('klabnet_video') || '{}').bw || 0; } catch {}
      const hl = new Hls({ capLevelToPlayerSize: false, startPosition: start > 0 ? start : -1, maxBufferLength: 30,
        abrEwmaDefaultEstimate: bw > 0 ? bw : 8e6, ...(level >= 0 ? { startLevel: level } : {}) });
      vw.hls = hl;
      hl.on(Hls.Events.MANIFEST_PARSED, () => { if (level >= 0) hl.currentLevel = level; paintQuality(); autoplay(el); });
      hl.on(Hls.Events.LEVEL_SWITCHED, paintQuality);
      hl.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hl.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hl.recoverMediaError();
        else showToast('This clip won’t play', 'ti-alert-triangle');
      });
      hl.loadSource(c.hls);
      hl.attachMedia(el);
    }).catch(e => showToast('Couldn’t start the player: ' + e.message, 'ti-alert-triangle'));
  }
  function startOriginal(c, start) {
    const el = vw.video, mine = vw;
    vw.src = 'original';
    if (vw.hls) { try { vw.hls.destroy(); } catch {} vw.hls = null; }
    el.src = c.original.url;
    el.addEventListener('loadedmetadata', () => { if (start > 0) el.currentTime = start; autoplay(el); }, { once: true });
    el.addEventListener('error', () => {
      if (vw !== mine || vw.video !== el || vw.src !== 'original') return;
      showToast('The original won’t play here. Back to the stream', 'ti-alert-triangle');
      prefs.original = false; savePrefs();
      el.removeAttribute('src'); try { el.load(); } catch {}
      startHls(c, start);
    }, { once: true });
    paintQuality();
  }
  function switchTo(kind, level) {
    if (!vw?.video) return;
    const el = vw.video, t = el.currentTime || 0;
    if (kind === 'original') { el.removeAttribute('src'); try { el.load(); } catch {} startOriginal(vw.c, t); }
    else if (vw.src === 'original') { el.removeAttribute('src'); try { el.load(); } catch {} startHls(vw.c, t, level); }
    else if (vw.hls) { vw.hls.currentLevel = level; paintQuality(); }
  }
  function paintQuality() {
    const b = vw?.el.querySelector('[data-vc="quality"]');
    if (!b) return;
    if (vw.src === 'original') { b.innerHTML = '<span class="vp-tag">Original</span>'; return; }
    const h = vw.hls;
    if (!h || !h.levels?.length) { b.textContent = 'Auto'; return; }
    const l = h.levels[h.currentLevel];
    const name = l ? rungName(l.height, l.width, l.frameRate) : '';
    b.textContent = h.autoLevelEnabled ? 'Auto' + (name ? ' · ' + name : '') : name || 'Auto';
  }
  function paintLoop() {
    const b = vw?.el.querySelector('[data-vc="loop"]');
    if (!b || !vw.video) return;
    const on = vw.video.loop;
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('on', on);
    b.title = on ? 'Looping (r). Off, it goes on to the next clip' : 'Loop (r)';
    b.innerHTML = '<i class="ti ti-repeat"></i>';
  }
  function paint() {
    const el = vw?.video, box = vw && $('clipVp');
    if (!el || !box) return;
    const d = el.duration || vw.c.duration || 0, t = el.currentTime || 0;
    const f = d ? Math.min(1, t / d) : 0;
    box.querySelector('.vp-fill').style.transform = 'scaleX(' + f.toFixed(4) + ')';
    box.querySelector('.vp-knob').style.left = (f * 100) + '%';
    let buf = 0;
    for (let i = 0; i < el.buffered.length; i++) if (el.buffered.start(i) <= t + 0.5) buf = Math.max(buf, el.buffered.end(i));
    box.querySelector('.vp-buf').style.transform = 'scaleX(' + (d ? Math.min(1, buf / d) : 0).toFixed(4) + ')';
    box.querySelector('.vp-now').textContent = dur(t);
    if (d) box.querySelector('.vp-len').textContent = dur(d);
    const ico = el.paused ? 'ti-player-play-filled' : 'ti-player-pause-filled';
    box.querySelectorAll('[data-vc="play"] i').forEach(i => { i.className = 'ti ' + ico; });
    box.querySelector('.vp-btn[data-vc="play"]').title = (el.paused ? 'Play' : 'Pause') + ' (k)';
    box.querySelector('[data-vc="mute"] i').className = 'ti ' + (el.muted || el.volume === 0 ? 'ti-volume-off' : 'ti-volume');
    const vol = box.querySelector('.vp-vol-range');
    if (vol && document.activeElement !== vol) vol.value = el.muted ? 0 : el.volume;
  }
  function wake() {
    const box = vw && $('clipVp');
    if (!box) return;
    box.classList.remove('idle');
    clearTimeout(vw.idleT);
    vw.idleT = setTimeout(idle, 2400);
  }
  function idle() {
    const box = vw && $('clipVp');
    if (box && vw.video && !vw.video.paused && box.querySelector('.vp-menu').hidden) box.classList.add('idle');
  }
  function scrubber(el, c) {
    const peek = el.querySelector('.vp-peek'), img = peek.querySelector('.vp-peek-img'), tl = peek.querySelector('.vp-peek-t');
    const sb = c.storyboard;
    if (sb) {
      img.style.backgroundImage = 'url("' + sb.url + '")';
      img.style.backgroundSize = (sb.cols * sb.w) + 'px ' + (sb.rows * sb.h) + 'px';
      img.style.width = sb.w + 'px'; img.style.height = sb.h + 'px';
    } else img.hidden = true;
    const at = e => {
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      return { t: f * (vw?.video?.duration || c.duration || 0), x: e.clientX - r.left, w: r.width };
    };
    const showPeek = e => {
      const p = at(e);
      peek.hidden = false;
      tl.textContent = dur(p.t);
      if (sb) { const i = Math.min(sb.count - 1, Math.floor(p.t / sb.interval)); img.style.backgroundPosition = -(i % sb.cols) * sb.w + 'px ' + -Math.floor(i / sb.cols) * sb.h + 'px'; }
      const half = (sb ? sb.w : 60) / 2;
      peek.style.left = Math.min(p.w - half, Math.max(half, p.x)) + 'px';
    };
    let drag = false;
    el.addEventListener('pointermove', e => { showPeek(e); if (drag) seek(at(e).t); });
    el.addEventListener('pointerleave', () => { if (!drag) peek.hidden = true; });
    el.addEventListener('pointerdown', e => { drag = true; el.setPointerCapture(e.pointerId); el.classList.add('drag'); seek(at(e).t); });
    const end = e => { if (!drag) return; drag = false; el.classList.remove('drag'); peek.hidden = true; seek(at(e).t); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function seek(t) {
    const el = vw?.video;
    if (!el) return;
    const d = el.duration || vw.c.duration || 0;
    el.currentTime = Math.max(0, Math.min(d ? d - 0.05 : t, t));
    paint();
  }
  function togglePlay() {
    const el = vw?.video;
    if (!el) return;
    if (el.paused || el.ended) el.play().catch(() => {}); else el.pause();
  }
  function toggleMute() {
    const el = vw?.video;
    if (!el) return;
    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) el.volume = 0.5;
    prefs.muted = el.muted; savePrefs();
    paint();
  }
  function toggleLoop() {
    const el = vw?.video;
    if (!el) return;
    el.loop = !el.loop;
    prefs.loop = el.loop; savePrefs();
    paintLoop();
  }
  function toggleFull() {
    const stage = vw?.el.querySelector('.clipv-stage');
    if (!stage) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (stage.requestFullscreen || stage.webkitRequestFullscreen)?.call(stage);
  }
  document.addEventListener('fullscreenchange', () => {
    const i = vw?.el.querySelector('[data-vc="full"] i');
    if (i) i.className = 'ti ' + (document.fullscreenElement ? 'ti-arrows-minimize' : 'ti-arrows-maximize');
  });
  function qualityMenu() {
    const box = $('clipVp'), m = box?.querySelector('.vp-menu');
    if (!m) return;
    if (!m.hidden) { m.hidden = true; return; }
    const h = vw.hls, c = vw.c, o = c.original, ok = canOriginal(c), onHls = vw.src === 'hls';
    const lv = (h?.levels || []).map((l, i) => ({ i, h: Math.min(l.height, l.width || l.height), name: rungName(l.height, l.width, l.frameRate), fps: l.frameRate || 0 }))
      .sort((a, b) => b.h - a.h || b.fps - a.fps);
    const items = (o ? [{ label: 'Original · ' + rungName(o.height, o.width, o.fps) + (o.bitrate ? ' · ' + mbps(o.bitrate) : '') + (ok ? '' : ' · not supported here'),
      on: vw.src === 'original', disabled: !ok, go: () => { prefs.original = true; savePrefs(); if (vw.src !== 'original') switchTo('original'); } }] : [])
      .concat([{ label: 'Auto', on: onHls && (!h || h.autoLevelEnabled), go: () => { prefs.original = false; savePrefs(); switchTo('hls', -1); } }])
      .concat(lv.map(l => ({ label: l.name, on: onHls && !!h && !h.autoLevelEnabled && h.currentLevel === l.i, go: () => { prefs.original = false; savePrefs(); switchTo('hls', l.i); } })));
    m.innerHTML = items.map((it, i) => '<button type="button" class="vp-menu-row' + (it.on ? ' on' : '') + '" data-qi="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' + esc(it.label) + (it.on ? '<i class="ti ti-check"></i>' : '') + '</button>').join('');
    m._items = items;
    m.style.right = '8px';
    m.hidden = false;
  }
  function quietMusic() {
    const el = vw?.video;
    if (!el || el.muted || el.volume === 0) return;
    try {
      if (window.klabRadio?.station?.()) window.klabRadio.off?.();
      const a = typeof playerState !== 'undefined' && playerState.audio;
      if (a && !a.paused && !window.klabSession?.mirror) a.pause();
    } catch (e) {}
  }
  function sendView(c) {
    if (!vw || vw.viewSent || vw.c !== c) return;
    vw.viewSent = true;
    getJSON(API + '/' + c.id + '/view', { method: 'POST' }, 8000).then(j => { if (j.views != null) c.views = j.views; }).catch(() => {});
  }

  function viewerClick(e) {
    if (!vw) return;
    if (e.target === vw.el) { closeViewer(); return; }
    const q = e.target.closest('[data-qi]');
    if (q) { const m = q.closest('.vp-menu'); m._items[+q.dataset.qi].go(); m.hidden = true; paint(); return; }
    const vc = e.target.closest('[data-vc]');
    if (vc) {
      const k = vc.dataset.vc;
      if (k === 'play') togglePlay();
      else if (k === 'mute') toggleMute();
      else if (k === 'loop') toggleLoop();
      else if (k === 'full') toggleFull();
      else if (k === 'quality') { qualityMenu(); return; }
      const m = $('clipVp')?.querySelector('.vp-menu'); if (m) m.hidden = true;
      return;
    }
    const pill = e.target.closest('.vid-pill');
    if (pill) {
      if (pill.classList.contains('vid-react-add')) klabReactMenu(pill, emoji => react(vw.c, emoji));
      else react(vw.c, pill.dataset.emoji);
      return;
    }
    const del = e.target.closest('.k-com-del');
    if (del) { deleteComment(vw.c, del.dataset.replyId); return; }
    const who = e.target.closest('.k-com-name, .k-com-face[data-username]');
    if (who && !who.closest('.k-com-form')) { window.openProfileView?.(who.dataset.username); return; }
    const b = e.target.closest('[data-cv]');
    if (!b) return;
    const c = vw.c, act = b.dataset.cv;
    if (act === 'close') closeViewer();
    else if (act === 'prev') step(-1);
    else if (act === 'next') step(1);
    else if (act === 'more') klabMenu.at(b, clipMenu(c, vw.list), { align: 'end' });
    else if (act === 'game') { closeViewer(); show({ game: c.game }); }
    else if (act === 'user') { closeViewer(); show({ user: c.username }); }
    else if (act === 'from' && c.clipOf) { closeViewer(); window.klabOpenVideo?.(c.clipOf.id, c.clipOf.start); }
  }
  let reactSeq = 0;
  async function react(c, emoji) {
    const seq = ++reactSeq;
    try {
      const j = await getJSON('/api/posts/' + c.id + '/reactions', json('PUT', { emoji }), 8000);
      c.reactions = j.reactions || {};
      if (seq !== reactSeq || !vw || vw.c !== c) return;
      $('clipReacts').innerHTML = reactsHTML(c);
      page.querySelectorAll('.clip-card[data-clip-id="' + c.id + '"]').forEach(el => { el.outerHTML = cardHTML(c, { noUser: !!view?.user, noGame: !!view?.game }); });
    } catch (e) { showToast('Couldn’t react. Try again', 'ti-alert-triangle'); }
  }
  // Keys while the viewer is the top layer.
  addEventListener('keydown', e => {
    if (!vw || !klabLayers.isTop(vw.el) || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const k = e.key;
    let done = true;
    if (k === 'ArrowLeft' || k === 'ArrowUp') step(-1);
    else if (k === 'ArrowRight' || k === 'ArrowDown') step(1);
    else if (k === ' ' && el && el !== document.body && !vw.el.querySelector('.clipv-vp')?.contains(el) && el.matches?.('button, a[href], [role="button"]')) done = false;
    else if (k === ' ' || k === 'k' || k === 'K') togglePlay();
    else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'r' || k === 'R') toggleLoop();
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'j' || k === 'J') seek((vw.video?.currentTime || 0) - 5);
    else if (k === 'l' || k === 'L') seek((vw.video?.currentTime || 0) + 5);
    else if ((k === ',' || k === '.') && vw.video?.paused) seek(vw.video.currentTime + (k === '.' ? 1 : -1) / 60);
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); wake(); }
  }, true);

  // Comments: the Feed's replies, the shared kit.
  async function loadComments(c) {
    try {
      const j = await getJSON('/api/posts/' + c.id + '/replies', null, 8000);
      if (vw?.c !== c) return;
      renderComments(c, j.replies || []);
    } catch (e) { const el = $('clipComList'); if (vw?.c === c && el) el.innerHTML = '<div class="k-com-empty">Couldn’t load comments.</div>'; }
  }
  function renderComments(c, replies) {
    c._replies = replies;
    const el = $('clipComList');
    if (!el || vw?.c !== c) return;
    $('clipComCount').textContent = replies.length ? klabCount(replies.length, 'comment') : 'Comments';
    el.innerHTML = klabComments.listHTML(replies, { postId: c.id }, 'No comments yet. Say something.');
    setTimeout(() => klabComments.refreshFaces(vw?.el), 1500);
  }
  function deleteComment(c, replyId) {
    const reply = (c._replies || []).find(r => String(r.id) === String(replyId));
    if (!reply) return;
    const row = $('clipComList')?.querySelector('.k-com[data-reply-id="' + reply.id + '"]');
    klabComments.del({
      postId: c.id, reply, row,
      apply: () => renderComments(c, (c._replies || []).filter(r => r !== reply)),
      undo: () => renderComments(c, (c._replies || []).filter(r => r !== reply).concat(reply).sort((a, b) => a.id - b.id)),
    });
  }
  async function commentSubmit(e) {
    if (e.target.id !== 'clipComForm' || !vw) return;
    e.preventDefault();
    const input = $('clipComInput'), c = vw.c, text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      const reply = await getJSON('/api/posts/' + c.id + '/replies', json('POST', { text }), 8000);
      input.value = '';
      klabComments.fresh(reply.id);
      renderComments(c, (c._replies || []).concat(reply));
      SFX && SFX.play('star');
    } catch (err) { showToast('Couldn’t post that comment', 'ti-alert-triangle'); }
    finally { input.disabled = false; input.focus(); }
  }

  // ── Editing and deleting ──
  function editDialog(c) {
    loadGames();
    openChatModal('Edit clip', `
      <div class="vid-up">
        <label class="vid-field-label" for="clipTitleIn">Title</label>
        <input class="k-field" id="clipTitleIn" maxlength="100" autocomplete="off" />
        <label class="vid-field-label" for="clipGameIn">Game</label>
        <input class="k-field" id="clipGameIn" maxlength="60" autocomplete="off" list="clipGameList" placeholder="Optional" />
        ${gameList()}
        <label class="vid-field-label" for="clipDescIn">Description</label>
        <textarea class="chat-modal-input vid-desc-in" id="clipDescIn" rows="3" maxlength="5000" placeholder="Optional"></textarea>
        <p class="emo-err" id="clipErr" hidden></p>
      </div>
      <div class="dlg-actions">
        <button class="k-btn" data-dlg-cancel>Cancel</button>
        <button class="k-btn primary" id="clipSave">Save</button>
      </div>`, null);
    $('clipTitleIn').value = c.title || '';
    $('clipGameIn').value = c.game || '';
    $('clipDescIn').value = c.description || '';
    $('clipSave').addEventListener('click', async () => {
      const title = $('clipTitleIn').value.trim();
      const err = m => { $('clipErr').hidden = !m; $('clipErr').textContent = m || ''; };
      if (!title) { err('It needs a title.'); return; }
      $('clipSave').disabled = true;
      try {
        const n = await getJSON(API + '/' + c.id, json('PATCH', { title, game: $('clipGameIn').value.trim(), description: $('clipDescIn').value.trim() }));
        Object.assign(c, n);
        closeChatModal();
        showToast('Saved', 'ti-check');
        loadGames(true);
        if (vw && vw.c === c) { $('clipSide').innerHTML = sideHTML(c); renderComments(c, c._replies || []); }
        page.querySelectorAll('.clip-card[data-clip-id="' + c.id + '"]').forEach(el => { el.outerHTML = cardHTML(c, { noUser: !!view?.user, noGame: !!view?.game }); });
      } catch (e) { err(klabCap(e.message)); $('clipSave').disabled = false; }
    });
  }
  async function deleteClip(c) {
    if (!(await showConfirmDialog('Delete this clip?', '“' + (c.title || 'Untitled') + '” and its comments are gone for everyone.', 'Delete'))) return;
    try {
      await getJSON(API + '/' + c.id, { method: 'DELETE' }, 15000);
      showToast('Clip deleted', 'ti-trash');
      list = list.filter(x => x.id !== c.id);
      total = Math.max(0, total - 1);
      page.querySelectorAll('.clip-card[data-clip-id="' + c.id + '"]').forEach(el => el.remove());
      if (vw) {
        const i = vw.list.indexOf(c);
        if (i >= 0) vw.list.splice(i, 1);
        if (!vw.list.length) closeViewer();
        else { vw.i = Math.min(i < 0 ? vw.i : i, vw.list.length - 1); vw.c = vw.list[vw.i]; mountClip(); }
      }
      const n = $('clipCount'); if (n) n.textContent = total ? klabCount(total, 'clip') : '';
      loadGames(true);
    } catch (e) { showToast('Couldn’t delete it: ' + e.message, 'ti-alert-triangle'); }
  }

  // ── Uploading clips ──
  // Several at once: each gets a title (from its file name), one game for
  // the lot (each can have its own), and they go one after another
  // through Videos' background uploads. Too long for a clip (the browser
  // reads each file's length first): offered as a video instead.
  const ACCEPT = 'video/*,.mkv,.mov,.m4v,.avi,.webm';
  const isVideo = f => /^video\//.test(f.type) || /\.(mkv|mov|m4v|avi|webm|mp4)$/i.test(f.name);
  function lengthOf(f) {
    return new Promise(res => {
      const el = document.createElement('video');
      const url = URL.createObjectURL(f);
      const done = d => { URL.revokeObjectURL(url); el.removeAttribute('src'); res(d); };
      el.preload = 'metadata';
      el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => done(0);
      setTimeout(() => done(0), 8000);
      el.src = url;
    });
  }
  function uploadDialog(initial) {
    if (!window.klabVideoUpload) { showToast('Uploading needs the latest Videos', 'ti-alert-triangle'); return; }
    loadGames().then(() => { const dl = $('clipGameList'); if (dl) dl.outerHTML = gameList(); });
    openChatModal('Upload clips', `
      <div class="vid-up clip-up">
        <button type="button" class="vid-drop" id="clipDrop"><i class="ti ti-upload"></i><b>Choose clips</b><span>or drop them here · up to ${dur(MAX)} each · MP4, MOV, MKV, WebM</span></button>
        <input type="file" id="clipFiles" accept="${ACCEPT}" multiple hidden>
        <label class="vid-field-label" for="clipGameAll">Game</label>
        <input class="k-field" id="clipGameAll" maxlength="60" autocomplete="off" list="clipGameList" placeholder="Optional, for all of them" value="${esc(view?.game || '')}" />
        ${gameList()}
        <div class="clip-up-list" id="clipUpList"></div>
        <label class="vid-check clip-up-dates" id="clipDatesRow" hidden><input type="checkbox" class="k-check" id="clipDates"><span id="clipDatesTx">Use each file’s date as when it came out</span></label>
        <p class="emo-err" id="clipErr" hidden></p>
      </div>
      <div class="dlg-actions">
        <button class="k-btn" data-dlg-cancel>Cancel</button>
        <button class="k-btn primary" id="clipSend" disabled>Upload</button>
      </div>`, null);
    const files = []; // { key, file, title, game, length, tooLong }
    const err = m => { $('clipErr').hidden = !m; $('clipErr').textContent = m || ''; };
    const paint = () => {
      const el = $('clipUpList');
      if (!el) return;
      el.innerHTML = files.map(x => '<div class="clip-up-row' + (x.tooLong ? ' long' : '') + '" data-key="' + x.key + '">' +
        '<span class="clip-up-file"><i class="ti ti-movie"></i><span class="clip-up-name" title="' + esc(x.file.name) + '">' + esc(x.file.name) + '</span>' +
          '<span class="clip-up-meta">' + (x.length ? dur(x.length) + ' · ' : '') + (x.file.size / 1048576).toFixed(x.file.size > 1048576 * 100 ? 0 : 1) + ' MB</span>' +
          '<button type="button" class="k-icon sm" data-up-rm title="Remove" aria-label="Remove"><i class="ti ti-x"></i></button></span>' +
        (x.tooLong
          ? '<span class="clip-up-long">Longer than ' + dur(MAX) + ', too long for a clip. <button type="button" class="k-btn sm" data-up-video>Upload as a video instead</button></span>'
          : '<span class="clip-up-fields"><input class="k-field" data-f="title" maxlength="100" autocomplete="off" aria-label="Title" placeholder="Title" value="' + esc(x.title) + '" />' +
            '<input class="k-field" data-f="game" maxlength="60" autocomplete="off" list="clipGameList" aria-label="Game" placeholder="' + esc($('clipGameAll').value.trim() || 'Game') + '" value="' + esc(x.game) + '" /></span>') +
      '</div>').join('');
      const ok = files.filter(x => !x.tooLong).length;
      $('clipSend').disabled = !ok;
      $('clipSend').textContent = ok > 1 ? 'Upload ' + ok + ' clips' : 'Upload';
      const dated = files.filter(x => x.file.lastModified);
      $('clipDatesRow').hidden = !dated.length;
      if (dated.length === 1) $('clipDatesTx').textContent = 'Use the file’s date (' + new Date(dated[0].file.lastModified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ') as when it came out';
      else $('clipDatesTx').textContent = 'Use each file’s date as when it came out';
    };
    const add = list => {
      const got = [...(list || [])];
      const bad = got.filter(f => !isVideo(f));
      if (bad.length) err(bad.length === 1 ? '“' + bad[0].name + '” isn’t a video.' : bad.length + ' of those aren’t videos.'); else err('');
      got.filter(isVideo).forEach(f => {
        const x = { key: Math.random().toString(36).slice(2), file: f, title: cleanTitle(f.name) || 'Clip', game: '', length: 0, tooLong: false };
        files.push(x);
        lengthOf(f).then(d => { x.length = d; x.tooLong = d > MAX + 0.5; if ($('clipUpList')) paint(); });
      });
      paint();
    };
    $('clipDrop').addEventListener('click', () => $('clipFiles').click());
    $('clipFiles').addEventListener('change', () => { add($('clipFiles').files); $('clipFiles').value = ''; });
    const drop = $('clipDrop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); add(e.dataTransfer.files); });
    $('clipGameAll').addEventListener('input', () => {
      document.querySelectorAll('#clipUpList [data-f="game"]').forEach(i => { i.placeholder = $('clipGameAll').value.trim() || 'Game'; });
    });
    $('clipUpList').addEventListener('input', e => {
      const row = e.target.closest('.clip-up-row'), x = row && files.find(f => f.key === row.dataset.key);
      if (x && e.target.dataset.f) x[e.target.dataset.f] = e.target.value;
    });
    $('clipUpList').addEventListener('click', e => {
      const row = e.target.closest('.clip-up-row'), x = row && files.find(f => f.key === row.dataset.key);
      if (!x) return;
      if (e.target.closest('[data-up-rm]')) { files.splice(files.indexOf(x), 1); paint(); }
      else if (e.target.closest('[data-up-video]')) {
        files.splice(files.indexOf(x), 1); paint();
        window.klabVideoUpload(x.file, { title: x.title });
      }
    });
    $('clipSend').addEventListener('click', () => {
      const go = files.filter(x => !x.tooLong);
      if (!go.length) return;
      if (go.some(x => !x.title.trim())) { err('Each clip needs a title.'); return; }
      const all = $('clipGameAll').value.trim(), dates = $('clipDates').checked;
      closeChatModal();
      queueUploads(go.map(x => ({ file: x.file, title: x.title.trim(), game: x.game.trim() || all,
        published: dates && x.file.lastModified && x.file.lastModified < Date.now() ? new Date(x.file.lastModified).toISOString() : '' })));
    });
    if (initial) add(Array.isArray(initial) ? initial : [initial]);
  }
  // One after another (the server takes one upload at a time anyway).
  let upQueue = Promise.resolve();
  function queueUploads(items) {
    showToast(items.length > 1 ? 'Uploading ' + items.length + ' clips. You can keep browsing' : 'Uploading “' + items[0].title + '”. You can keep browsing', 'ti-upload');
    let ok = 0, left = items.length;
    for (const it of items) {
      upQueue = upQueue.then(async () => {
        const r = await window.klabVideoUpload(it.file, { title: it.title, published: it.published, quiet: true, fields: { kind: 'clip', game: it.game } });
        left--;
        if (r.ok) { ok++; if (view && showing() && !vw) show(view, { quiet: true, inPlace: true }); }
        else if (!r.aborted) showToast('Couldn’t upload “' + it.title + '”: ' + r.error, 'ti-alert-triangle');
        if (!left && ok) {
          SFX && SFX.play('star');
          loadGames(true);
          showToast((ok > 1 ? ok + ' clips are up.' : '“' + it.title + '” is up.') + ' Ready to watch in a minute', 'ti-scissors', 6000, null, null,
            { action: { label: 'Your clips', run: () => show({ user: me() }) } });
        }
      });
    }
  }

  // ── Make a clip from a video ──
  // fromRange: the API call (the Studio's editor uses it too). makeFrom: the
  // watch view's way: a range on the scrub bar, from where you are to 30s
  // on (dragged by its ends, or [ and ] at the playhead), a title and a
  // game, then klabnet-api makes it from the upload.
  async function fromRange(videoId, start, end, o) {
    const opts = o || {};
    const body = { start: +start, end: +end };
    if (opts.title != null) body.title = opts.title;
    if (opts.game != null) body.game = opts.game;
    if (opts.description != null) body.description = opts.description;
    // The times are the video as it plays (an edited one's edited time),
    // unless the Studio says they're the upload's (timeline 'upload', with
    // the editor's edit to apply).
    if (opts.timeline) body.timeline = opts.timeline;
    if (opts.edit !== undefined) body.edit = opts.edit;
    const c = await getJSON(API + '/' + (+videoId) + '/clip', json('POST', body), 20000);
    loadGames(true);
    return c;
  }
  let mk = null; // { v, el (the panel), sel, a, b, video, player }
  function makeFrom(v, at) {
    if (!v || v.status !== 'ready') return;
    const player = $('vidPlayer'), el = window.klabWatch?.video();
    if (!player || !el || window.klabWatch?.current()?.id !== v.id) { showToast('Open the video first', 'ti-scissors'); return; }
    if (mk) { mk.panel.querySelector('[data-mk="title"]')?.focus(); return; }
    loadGames();
    const d = v.duration || el.duration || 0;
    let a = Math.max(0, Math.min(at || el.currentTime || 0, Math.max(0, d - 1)));
    let b = Math.min(d, a + Math.min(30, MAX));
    if (b - a < 1) { a = Math.max(0, b - Math.min(30, MAX)); }
    const scrub = player.querySelector('.vp-scrub');
    const sel = document.createElement('div');
    sel.className = 'clip-sel';
    sel.innerHTML = '<b class="clip-sel-band"></b><i class="clip-h" data-h="a" title="Start"></i><i class="clip-h" data-h="b" title="End"></i>';
    scrub.appendChild(sel);
    player.classList.add('clip-making');
    const panelEl = document.createElement('div');
    panelEl.className = 'clip-make';
    panelEl.innerHTML =
      '<div class="clip-make-top"><span class="clip-make-label"><i class="ti ti-scissors"></i>Make a clip</span>' +
        '<span class="clip-make-range" id="clipMkRange"></span>' +
        '<span class="clip-make-acts">' +
          '<button type="button" class="k-btn sm" data-mk="a" title="Start at the playhead ([)">Start here</button>' +
          '<button type="button" class="k-btn sm" data-mk="b" title="End at the playhead (])">End here</button>' +
          '<button type="button" class="k-btn sm" data-mk="preview"><i class="ti ti-player-play"></i><span>Preview</span></button></span></div>' +
      '<div class="clip-make-fields">' +
        '<input class="k-field" data-mk="title" maxlength="100" autocomplete="off" aria-label="Title" placeholder="Title" />' +
        '<input class="k-field" data-mk="game" maxlength="60" autocomplete="off" aria-label="Game" placeholder="Game (optional)" list="clipGameList" />' + gameList() +
      '</div>' +
      '<p class="emo-err" data-mk="err" hidden></p>' +
      '<div class="dlg-actions"><button type="button" class="k-btn" data-mk="cancel">Cancel</button><button type="button" class="k-btn primary" data-mk="make"><i class="ti ti-scissors"></i><span>Make clip</span></button></div>';
    player.insertAdjacentElement('afterend', panelEl);
    panelEl.querySelector('[data-mk="title"]').value = v.title || '';
    panelEl.querySelector('[data-mk="game"]').value = v.game || '';
    mk = { v, panel: panelEl, sel, player, video: el, a, b, d, preview: false };
    const paintSel = () => {
      const D = mk.d || 1;
      sel.style.setProperty('--a', (mk.a / D * 100) + '%');
      sel.style.setProperty('--b', (mk.b / D * 100) + '%');
      $('clipMkRange').innerHTML = '<b>' + durT(mk.a) + ' – ' + durT(mk.b) + '</b><span>' + (mk.b - mk.a).toFixed(1) + 's · up to ' + dur(MAX) + '</span>';
    };
    mk.paint = paintSel;
    paintSel();
    el.pause();
    try { el.currentTime = a; } catch {}
    // Dragging an end (it doesn't seek the bar under it: that's the scrub's).
    sel.addEventListener('pointerdown', e => {
      const h = e.target.closest('.clip-h');
      if (!h) return;
      e.stopPropagation(); e.preventDefault();
      h.setPointerCapture(e.pointerId);
      h.classList.add('drag');
      const r = scrub.getBoundingClientRect();
      const move = ev => {
        const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * mk.d;
        setEnd(h.dataset.h, t);
        try { mk.video.currentTime = h.dataset.h === 'a' ? mk.a : mk.b; } catch {}
      };
      const up = () => { h.classList.remove('drag'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
    panelEl.addEventListener('click', e => {
      const b2 = e.target.closest('[data-mk]');
      if (!b2 || !mk) return;
      const k = b2.dataset.mk;
      if (k === 'a' || k === 'b') setEnd(k, mk.video.currentTime || 0);
      else if (k === 'preview') preview();
      else if (k === 'cancel') endMake();
      else if (k === 'make') submitMake();
    });
    // The player has the keyboard: [ and ] work at once.
    player.focus({ preventScroll: true });
    panelEl.scrollIntoView({ block: 'nearest', behavior: motionOk() ? 'smooth' : 'auto' });
  }
  // Moves one end; the other follows when the range would pass the most a
  // clip can be, or less than a second.
  function setEnd(which, t) {
    if (!mk) return;
    const D = mk.d, len = Math.min(MAX, D);
    t = Math.max(0, Math.min(D, t));
    if (which === 'a') {
      mk.a = Math.min(t, D - 1);
      if (mk.b - mk.a > len) mk.b = mk.a + len;
      if (mk.b - mk.a < 1) mk.b = Math.min(D, mk.a + 1);
    } else {
      mk.b = Math.max(t, 1);
      if (mk.b - mk.a > len) mk.a = mk.b - len;
      if (mk.b - mk.a < 1) mk.a = Math.max(0, mk.b - 1);
    }
    mk.paint();
  }
  function preview() {
    if (!mk) return;
    const el = mk.video;
    mk.preview = true;
    try { el.currentTime = mk.a; } catch {}
    el.play().catch(() => {});
  }
  // While previewing, it stops at the end of the range.
  document.addEventListener('timeupdate', e => {
    if (!mk || e.target !== mk.video || !mk.preview) return;
    if (mk.video.currentTime >= mk.b) { mk.video.pause(); mk.preview = false; try { mk.video.currentTime = mk.a; } catch {} }
  }, true);
  document.addEventListener('pause', e => { if (mk && e.target === mk.video && mk.video.currentTime < mk.b - 0.1) mk.preview = false; }, true);
  async function submitMake() {
    if (!mk) return;
    const m = mk, btn = m.panel.querySelector('[data-mk="make"]'), errEl = m.panel.querySelector('[data-mk="err"]');
    const title = m.panel.querySelector('[data-mk="title"]').value.trim();
    if (!title) { errEl.hidden = false; errEl.textContent = 'It needs a title.'; return; }
    btn.disabled = true;
    try {
      const c = await fromRange(m.v.id, m.a, m.b, { title, game: m.panel.querySelector('[data-mk="game"]').value.trim() });
      endMake();
      SFX && SFX.play('star');
      showToast('Making “' + c.title + '”. It’ll be in Clips in a minute', 'ti-scissors', 6000, null, null,
        { action: { label: 'Your clips', run: () => show({ user: me() }) } });
    } catch (e) {
      errEl.hidden = false; errEl.textContent = klabCap(e.message);
      btn.disabled = false;
    }
  }
  function endMake() {
    if (!mk) return;
    mk.sel.remove();
    mk.panel.remove();
    mk.player.classList.remove('clip-making');
    mk = null;
  }
  // [ and ] set the ends at the playhead; Esc puts it away.
  addEventListener('keydown', e => {
    if (!mk || e.metaKey || e.ctrlKey || e.altKey || klabLayers.modal()) return;
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopPropagation(); endMake(); return; }
    if (typing) return;
    if (e.key === '[' || e.key === ']') { e.preventDefault(); e.stopPropagation(); setEnd(e.key === '[' ? 'a' : 'b', mk.video.currentTime || 0); }
  }, true);
  // The watch view going (another video, another view): so does the maker.
  document.addEventListener('klab:watch', e => { if (mk && (!e.detail || e.detail.video !== mk.video)) endMake(); });

  // ── Coming and going ──
  const prevChanged = window.klabVideosTabChanged;
  window.klabVideosTabChanged = on => {
    const link = on ? window.klabClipsLink : null;
    if (link) window.klabClipsLink = null;
    prevChanged?.(on);
    if (!on) {
      hoverStop();
      if (vw) closeViewer();
      clearTimeout(procT);
      return;
    }
    if (view) setSearchHint(true);
    if (link) openLink(link);
    else if (view) watchProcessing();
    if (!games) loadGames();
  };
  async function openLink(link) {
    if (!link.id) { show({ game: link.game || '' }); return; }
    await show({});
    if (!view) return;
    let c = byId(link.id);
    if (!c) { try { c = await getJSON(API + '/' + link.id); } catch (e) { showToast(e.status === 404 ? 'That clip’s gone' : 'Couldn’t open that clip', 'ti-alert-triangle'); return; } }
    if (c.kind !== 'clip') { window.klabOpenVideo?.(c.id); return; }
    const i = list.findIndex(x => x.id === c.id);
    if (i >= 0) openViewer(list, i); else openViewer([c], 0, { standalone: true });
  }
  const prevRestore = window.klabVideosRestore;
  window.klabVideosRestore = d => {
    if (d.kind !== 'clips') { prevRestore?.(d); return; }
    if (!page.firstElementChild) prevRestore?.({ kind: 'list', view: { kind: 'home' } });
    restoring = true;
    try { show(d.view || {}, { quiet: true }); }
    finally { setTimeout(() => { restoring = false; }, 0); }
  };
  // The page shows: the search box speaks of clips.
  const showObs = new MutationObserver(() => setSearchHint(!!view && !!root && page.contains(root)));
  showObs.observe(page, { childList: true });

  // ── For other files ──
  window.klabClips = {
    show: o => show(o || {}),
    open: async (id, o) => {
      const opts = o || {};
      if (opts.user != null || opts.game != null) await show({ user: opts.user || '', game: opts.game || '' });
      else if (!view) await show({});
      const i = list.findIndex(c => c.id === +id);
      if (i >= 0) { openViewer(list, i); return; }
      try { const c = await getJSON(API + '/' + id); openViewer([c], 0, { standalone: true }); } catch (e) { showToast('Couldn’t open that clip', 'ti-alert-triangle'); }
    },
    fromRange, makeFrom,
    cardHTML: (c, o) => cardHTML(c, o),
    forUser: u => getJSON(CL + '?limit=24&sort=new&user=' + encodeURIComponent(u), null, 10000),
    games: () => loadGames(),
    // Go anywhere (js/32-terminal.js): a game's clips.
    entries: () => {
      if (!games) { loadGames(); return []; }
      return games.map(g => ({ id: 'clips:' + g.name.toLowerCase(), label: 'Clips · ' + g.name, icon: 'ti-scissors', kind: 'Videos', sub: klabCount(g.count, 'clip'),
        keywords: 'clips game ' + g.name, run: () => show({ game: g.name }) }));
    },
    state: () => ({ view, count: list.length, total, viewer: vw ? { id: vw.c.id, i: vw.i, of: vw.list.length, loop: !!vw.video?.loop, src: vw.src, muted: !!vw.video?.muted } : null, making: mk ? { a: mk.a, b: mk.b, video: mk.v.id } : null, hover: hov ? hov.card.dataset.clipId : null }),
  };
  if (showing() && window.klabClipsLink) { const l = window.klabClipsLink; window.klabClipsLink = null; openLink(l); }
  // Go anywhere's games, ready before it's opened.
  setTimeout(() => { if (!games) loadGames(); }, 5000);
})();
