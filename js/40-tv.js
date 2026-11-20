// ══════════════════════════════════════════
//  TV CHANNELS (2026-11-20) — "a TV Channels option! just like how the
//  music has radios"
//  A channel is a lineup of videos on a loop that everyone watching sees at
//  the same moment: where it's at is (now − epoch) mod the lineup's length,
//  on klabnet-api's clock (app/routers/tv.py, /api/posts/tv). Made either
//  way, or both: string together videos already in Videos, or upload one
//  long file straight into it (Videos' pipeline, but unlisted).
//    · It's a view of Videos' page (#vidPage): the "Channels" row in its
//      sidebar (data-vid="channels") is the guide, and a channel plays in
//      the same page. js/39-videos.js stops what it was doing through
//      window.klabVideosLeave; anything it draws over the page stops us
//      (a MutationObserver on the page).
//    · Live, not on demand: no scrubbing. Two <video> decks: the one on
//      air, and the next item loading behind it, swapped at the boundary.
//      Keeping on the line is the radio's (js/28-radio.js): within 60ms
//      leave it, under 0.8s play up to 3% faster or slower, past that seek.
//    · Keys while watching: Page Up/Down change channel, digits then Enter
//      (or a pause) go to a number, m mute, f full screen, k/Space pause
//      (playing again goes back to live).
//    · Tuning in pauses the music (not a remote's) and turns the radio off.
//  window.klabTv: channels(), open(id), now() (for presence's beat).
//  Deep links: #videos/tv (the guide), #videos/tv/<number>.
// ══════════════════════════════════════════
(function () {
  const $ = id => document.getElementById(id);
  const page = $('vidPage'), nav = $('vidNav');
  if (!page || !nav) return;
  const API = '/api/posts/tv';
  const VIDEOS = '/api/posts/videos';
  const HLS_LIB = 'js/vendor/hls.light.min.js?v=1.5.20';
  const me = () => window.KLAB_USER?.username || '';
  const showing = () => document.body.classList.contains('tab-videos-active');
  const panel = () => page.closest('.tab-panel');

  // ── Little things ──
  function dur(s) {
    s = Math.max(0, Math.floor(+s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  function long(s) {
    s = Math.round(+s || 0);
    if (s < 60) return s + 's';
    const h = Math.floor(s / 3600), m = Math.round(s / 60) % 60;
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : Math.round(s / 60) + 'm';
  }
  function face(u) {
    const url = window.klabResolveUserAvatar?.(u);
    const color = typeof profileColor === 'function' ? profileColor(u) : '';
    return '<span class="vid-face tv-face" data-face="' + esc(u) + '" title="' + esc(u) + '" style="--c:' + color + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  const coverUrl = c => c.cover ? '/api/music-requests/playlists/covers/' + encodeURIComponent(c.cover) + '/s' : '';
  const linkTo = c => location.origin + location.pathname + '#videos/tv/' + c.number;
  async function getJSON(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 15000);
    try {
      const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      if (url === API && (r.status === 404 || r.status === 405)) server = false;
      if (!r.ok) { const e = new Error(j.error || 'failed (' + r.status + ')'); e.status = r.status; throw e; }
      if (url.startsWith(API)) server = true;
      return j;
    } finally { clearTimeout(t); }
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let server = null; // false: an API without TV

  // ── The shared clock (the radio's way: the quickest of four asks) ──
  let offset = 0, offsetAt = 0;
  async function syncClock() {
    let best = null;
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      try {
        const d = await getJSON(API + '/time', { cache: 'no-store' }, 4000);
        const rtt = performance.now() - t0;
        if (!best || rtt < best.rtt) best = { rtt, off: d.now * 1000 + rtt / 2 - Date.now() };
      } catch (e) {}
    }
    if (best) { offset = best.off; offsetAt = Date.now(); }
    return !!best;
  }
  const now = () => (Date.now() + offset) / 1000;

  // ── Channels ──
  let channels = [], loadedAt = 0, loading = null;
  const byId = id => channels.find(c => c.id === id);
  const byNumber = n => channels.find(c => c.number === n);
  function load(force) {
    if (!force && channels.length && Date.now() - loadedAt < 20000) return Promise.resolve(channels);
    return loading ||= getJSON(API, null, 10000).then(d => {
      channels = d.channels || [];
      loadedAt = Date.now();
      if (!offsetAt) offset = d.now * 1000 - Date.now();
      return channels;
    }).catch(() => channels).finally(() => { loading = null; });
  }
  // Where a channel is at `t` (server seconds): the item on, how far in,
  // and what's next. `key` names this airing (which loop, which slot), so
  // a one-video channel still rolls over at its end.
  function airing(c, t) {
    const items = c?.items || [];
    const total = items.reduce((a, i) => a + (i.duration || 0), 0);
    if (!items.length || total <= 0) return null;
    const run = t - c.epoch;
    const loop = Math.floor(run / total);
    const pos = run - loop * total;
    let start = 0;
    for (let i = 0; i < items.length; i++) {
      const d = items[i].duration || 0;
      if (pos < start + d || i === items.length - 1) {
        const ni = (i + 1) % items.length;
        return { i, item: items[i], off: pos - start, left: start + d - pos, key: loop + ':' + i,
          next: items[ni], nextKey: (ni === 0 ? loop + 1 : loop) + ':' + ni, total };
      }
      start += d;
    }
    return null;
  }

  // ── State ──
  let view = null; // null, { kind: 'guide' } or { kind: 'watch', id }
  let root = null;
  let restoring = false;
  function setRow(on) {
    nav.querySelectorAll('.picker-tab[data-vid]').forEach(b => b.classList.toggle('active', on && b.dataset.vid === 'channels'));
  }
  function take() {
    // Videos lets go of the page (its player, its lists loading).
    window.klabVideosLeave?.();
    stopPlayer();
  }
  function record(desc) {
    if (restoring) return;
    window.klabNav?.push({ tab: 'videos', kind: 'tv', ...desc });
  }

  // ── The guide ──
  const LOADING = '<div class="k-empty vid-empty"><i class="ti ti-loader loading-spinner"></i><div>Loading…</div></div>';
  async function showGuide(opts) {
    const o = opts || {};
    if (!showing()) setActiveTab('videos');
    take();
    view = { kind: 'guide' };
    setRow(true);
    if (!o.quiet) record({ view: 'guide' });
    page.innerHTML = '<div class="tv-root tv-guide">' +
      '<div class="k-page-head"><h2 class="k-page-title">Channels</h2><span class="k-page-count" id="tvCount"></span>' +
        '<div class="k-page-actions"><button type="button" class="k-btn" data-tv-act="new"><i class="ti ti-plus"></i><span>New channel</span></button></div></div>' +
      '<div class="tv-list" id="tvList">' + LOADING + '</div></div>';
    root = page.firstElementChild;
    if (panel()) panel().scrollTop = 0;
    klabEnter(page);
    await load(true);
    if (view?.kind !== 'guide' || !root?.isConnected) return;
    paintGuide();
    startTicks();
  }
  function rowHTML(c) {
    const a = airing(c, now());
    const art = coverUrl(c) || a?.item.posterSmall || '';
    return '<button type="button" class="tv-row" data-tv-id="' + esc(c.id) + '" style="--tv-c:' + esc(c.color || 'var(--text-dimmer)') + '" data-silent>' +
      '<span class="tv-num">' + c.number + '</span>' +
      '<span class="tv-art">' + (art ? '<img src="' + esc(art) + '" alt="" loading="lazy" draggable="false" />' : '<i class="ti ti-device-tv"></i>') + '</span>' +
      '<span class="tv-row-tx">' +
        '<span class="tv-name">' + esc(c.name) + '</span>' +
        (a ? '<span class="tv-now"><span class="tv-now-t">' + esc(a.item.title || 'Untitled') + '</span><span class="tv-left" data-left>' + dur(a.left) + ' left</span></span>' +
             '<span class="tv-bar"><b data-bar style="transform:scaleX(' + (a.off / a.item.duration).toFixed(4) + ')"></b></span>' +
             (c.items.length > 1 ? '<span class="tv-next">Next · ' + esc(a.next.title || 'Untitled') + '</span>' : '<span class="tv-next">On a loop</span>')
          : '<span class="tv-now tv-dim">' + (c.count ? 'Getting ready. Its videos are still processing.' : 'Nothing in the lineup yet.') + '</span>') +
      '</span>' +
      '<span class="tv-faces">' + (c.watchers || []).slice(0, 4).map(face).join('') + '</span>' +
    '</button>';
  }
  function paintGuide() {
    const el = $('tvList');
    if (!el) return;
    const count = $('tvCount');
    if (count) count.textContent = channels.length ? klabCount(channels.length, 'channel') : '';
    if (server === false) { el.innerHTML = '<div class="k-empty vid-empty"><i class="ti ti-device-tv"></i><div>Channels need the latest klabnet-api.</div></div>'; return; }
    if (!channels.length) {
      el.innerHTML = '<div class="k-empty vid-empty"><i class="ti ti-device-tv"></i><div>No channels yet.</div>' +
        '<button type="button" class="k-btn" data-tv-act="new"><i class="ti ti-plus"></i><span>New channel</span></button></div>';
      return;
    }
    el.innerHTML = channels.map(rowHTML).join('');
    el._keys = channels.map(c => airing(c, now())?.key || '').join('|');
  }
  // Once a second: the bars and the time left move; a row whose item has
  // rolled over is drawn again. The list is asked for again every 20s
  // (who's watching, lineups).
  let tickT = 0, fetchedAt = 0;
  function startTicks() {
    clearInterval(tickT);
    tickT = setInterval(tick, 1000);
  }
  function tick() {
    if (!root?.isConnected || !view) { clearInterval(tickT); return; }
    if (document.hidden || !showing()) return;
    if (Date.now() - fetchedAt > 20000) {
      fetchedAt = Date.now();
      load(true).then(() => { if (view?.kind === 'guide') paintGuide(); else if (view?.kind === 'watch') paintSide(); });
    }
    const t = now();
    if (view.kind === 'guide') {
      const el = $('tvList');
      if (!el) return;
      const keys = channels.map(c => airing(c, t)?.key || '').join('|');
      if (keys !== el._keys) { paintGuide(); return; }
      el.querySelectorAll('.tv-row').forEach(row => {
        const a = airing(byId(row.dataset.tvId), t);
        if (!a) return;
        const b = row.querySelector('[data-bar]'), l = row.querySelector('[data-left]');
        if (b) b.style.transform = 'scaleX(' + (a.off / a.item.duration).toFixed(4) + ')';
        if (l) l.textContent = dur(a.left) + ' left';
      });
    } else if (view.kind === 'watch') paintInfo();
  }

  // ── Watching ──
  async function openChannel(id, opts) {
    const o = opts || {};
    if (!showing()) setActiveTab('videos');
    await load();
    let c = byId(id) || (typeof id === 'number' ? byNumber(id) : null);
    if (!c) { await load(true); c = byId(id) || byNumber(+id); }
    if (!c) { showToast('That channel’s gone', 'ti-device-tv'); if (view?.kind !== 'guide') showGuide({ quiet: true }); return; }
    if (view?.kind === 'watch' && root?.isConnected) { tune(c); return; }
    take();
    view = { kind: 'watch', id: c.id };
    setRow(true);
    if (!o.quiet) record({ view: 'watch', id: c.id });
    page.innerHTML = '<div class="tv-root tv-watch">' +
      '<div class="tv-watch-main">' +
        '<button type="button" class="k-btn sm vid-back" data-tv-act="guide"><i class="ti ti-arrow-left"></i><span>Channels</span></button>' +
        '<div class="vp tv-vp paused fresh" id="tvPlayer" tabindex="0">' +
          '<video class="tv-deck" playsinline preload="auto"></video><video class="tv-deck" playsinline preload="auto"></video>' +
          '<div class="tv-blank" hidden><span></span></div>' +
          '<div class="tv-osd" aria-live="polite"><b class="tv-osd-num"></b><span class="tv-osd-tx"><span class="tv-osd-name"></span><span class="tv-osd-now"></span></span></div>' +
          '<button type="button" class="vp-big" data-tvp="play" aria-label="Tune in" data-silent><i class="ti ti-player-play-filled"></i></button>' +
          '<div class="vp-spin" hidden><span class="vid-spin"></span></div>' +
          '<div class="vp-ctrl"><div class="vp-row">' +
            '<span class="tv-live" title="Live"><i></i>Live</span>' +
            '<button type="button" class="vp-btn" data-tvp="down" title="Channel down (Page Down)" aria-label="Channel down" data-silent><i class="ti ti-chevron-down"></i></button>' +
            '<button type="button" class="vp-btn" data-tvp="up" title="Channel up (Page Up)" aria-label="Channel up" data-silent><i class="ti ti-chevron-up"></i></button>' +
            '<div class="vp-vol"><button type="button" class="vp-btn" data-tvp="mute" title="Mute (m)" data-silent><i class="ti ti-volume"></i></button>' +
              '<input type="range" class="vp-vol-range" min="0" max="1" step="0.02" aria-label="Volume" /></div>' +
            '<span class="vp-time tv-ctrl-now"></span>' +
            '<span class="vp-gap"></span>' +
            (document.pictureInPictureEnabled ? '<button type="button" class="vp-btn" data-tvp="pip" title="Picture in picture" data-silent><i class="ti ti-picture-in-picture"></i></button>' : '') +
            '<button type="button" class="vp-btn" data-tvp="full" title="Full screen (f)" data-silent><i class="ti ti-arrows-maximize"></i></button>' +
          '</div></div>' +
        '</div>' +
        '<div class="tv-info" id="tvInfo"></div>' +
      '</div>' +
      '<aside class="vid-watch-side tv-side"><div class="k-label vid-label">Channels</div><div class="tv-mini" id="tvSide"></div></aside>' +
    '</div>';
    root = page.firstElementChild;
    if (panel()) panel().scrollTop = 0;
    klabEnter(page);
    mountPlayer();
    tune(c, { first: true });
    startTicks();
  }

  function infoHTML(c) {
    const a = airing(c, now());
    const by = c.author && c.author !== me() ? c.author : '';
    return '<div class="tv-info-head">' +
        '<span class="tv-chip" style="--tv-c:' + esc(c.color || 'var(--text-dimmer)') + '">' + c.number + '</span>' +
        '<div class="tv-info-tx"><h1 class="vid-title tv-title">' + esc(c.name) + '</h1>' +
          '<span class="tv-sub">' + (c.total ? long(c.total) + ' loop · ' + klabCount(c.items.length, 'video') : 'Nothing on yet') + (by ? ' · by ' + esc(by) : '') + '</span></div>' +
        '<div class="vid-acts">' +
          '<button type="button" class="k-btn" data-tv-act="copy"><i class="ti ti-link"></i><span>Copy link</span></button>' +
          (c.canEdit ? '<button type="button" class="k-icon" data-tv-act="edit" title="Edit channel" aria-label="Edit channel"><i class="ti ti-pencil"></i></button>' +
            '<button type="button" class="k-icon vid-del" data-tv-act="delete" title="Delete channel" aria-label="Delete channel"><i class="ti ti-trash"></i></button>' : '') +
        '</div>' +
      '</div>' +
      (a ? '<div class="tv-onnow">' +
          '<div class="tv-onnow-row"><span class="k-label">On now</span><span class="tv-onnow-t">' + esc(a.item.title || 'Untitled') + '</span>' +
            '<span class="tv-onnow-time" data-left>' + dur(a.off) + ' / ' + dur(a.item.duration) + '</span></div>' +
          '<span class="tv-bar"><b data-bar style="transform:scaleX(' + (a.off / a.item.duration).toFixed(4) + ')"></b></span>' +
          (c.items.length > 1 ? '<div class="tv-onnow-row tv-dim"><span class="k-label">Next</span><span class="tv-onnow-t">' + esc(a.next.title || 'Untitled') + '</span><span class="tv-onnow-time" data-in>in ' + dur(a.left) + '</span></div>' : '') +
        '</div>' : '') +
      (c.description ? '<div class="vid-desc tv-desc"><div class="vid-desc-tx">' + esc(c.description) + '</div></div>' : '') +
      ((c.watchers || []).length ? '<div class="tv-watching"><span class="tv-faces">' + c.watchers.slice(0, 8).map(face).join('') + '</span><span>' + esc(watchingWords(c.watchers)) + '</span></div>' : '');
  }
  function watchingWords(list) {
    if (list.length === 1) return list[0] === me() ? 'You’re watching' : list[0] + ' is watching';
    if (list.length === 2) return list.join(' and ') + ' are watching';
    return klabCount(list.length, 'person', 'people') + ' watching';
  }
  let infoKey = '';
  function paintInfo(force) {
    const el = $('tvInfo'), c = byId(view?.id);
    if (!el || !c) return;
    const a = airing(c, now());
    const key = c.id + '|' + (a?.key || '') + '|' + (c.watchers || []).join(',') + '|' + c.name + '|' + c.description + '|' + c.total;
    if (force || key !== infoKey) { infoKey = key; el.innerHTML = infoHTML(c); paintCtrl(); return; }
    if (!a) return;
    const b = el.querySelector('[data-bar]'), l = el.querySelector('[data-left]'), n = el.querySelector('[data-in]');
    if (b) b.style.transform = 'scaleX(' + (a.off / a.item.duration).toFixed(4) + ')';
    if (l) l.textContent = dur(a.off) + ' / ' + dur(a.item.duration);
    if (n) n.textContent = 'in ' + dur(a.left);
  }
  function paintSide() {
    const el = $('tvSide');
    if (!el) return;
    el.innerHTML = channels.map(c => {
      const a = airing(c, now());
      return '<button type="button" class="tv-mini-row' + (c.id === view?.id ? ' on' : '') + '" data-tv-id="' + esc(c.id) + '" style="--tv-c:' + esc(c.color || 'var(--text-dimmer)') + '" data-silent>' +
        '<span class="tv-num">' + c.number + '</span>' +
        '<span class="tv-row-tx"><span class="tv-name">' + esc(c.name) + '</span><span class="tv-next">' + esc(a ? a.item.title || 'Untitled' : 'Nothing on') + '</span></span>' +
        '<span class="tv-faces">' + (c.watchers || []).slice(0, 3).map(face).join('') + '</span></button>';
    }).join('');
    paintInfo();
  }
  function paintCtrl() {
    const c = byId(view?.id);
    const el = player?.querySelector('.tv-ctrl-now');
    if (el && c) el.textContent = c.number + ' · ' + c.name;
  }

  // ── The player: two decks, one on air ──
  let player = null, decks = [], onAir = null, tuned = null;
  let loopT = 0, settleUntil = 0, misses = 0, calmUntil = 0, held = false, blocked = false;
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('klabnet_video') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('klabnet_video', JSON.stringify(prefs)); } catch {} };
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
  const nativeHls = el => !window.MediaSource && el.canPlayType('application/vnd.apple.mpegurl');

  function mountPlayer() {
    player = $('tvPlayer');
    decks = [...player.querySelectorAll('video.tv-deck')].map(el => ({ el, hls: null, key: '', item: null, ready: false }));
    for (const d of decks) {
      const el = d.el;
      el.muted = true;
      el.addEventListener('playing', () => { if (d === onAir) { player.querySelector('.vp-spin').hidden = true; show(d); player.classList.add('started'); player.classList.remove('paused', 'fresh'); } });
      el.addEventListener('waiting', () => { if (d === onAir) { player.querySelector('.vp-spin').hidden = false; settleUntil = performance.now() + 3000; } });
      el.addEventListener('canplay', () => { d.ready = true; if (d === onAir) player.querySelector('.vp-spin').hidden = true; });
      el.addEventListener('play', () => { if (d === onAir) { quietMusic(); paintBtns(); } });
      el.addEventListener('pause', () => { if (d === onAir) paintBtns(); });
      el.addEventListener('volumechange', () => { if (d === onAir) paintBtns(); });
      el.addEventListener('click', () => wake());
      el.addEventListener('dblclick', () => toggleFull());
    }
    const vol = player.querySelector('.vp-vol-range');
    vol.value = prefs.muted ? 0 : prefs.volume ?? 1;
    vol.addEventListener('input', () => {
      prefs.volume = +vol.value; prefs.muted = +vol.value === 0; savePrefs();
      if (onAir) { onAir.el.volume = prefs.volume; onAir.el.muted = prefs.muted; }
    });
    player.addEventListener('pointermove', wake);
    player.addEventListener('pointerleave', () => { clearTimeout(idleT); idleT = setTimeout(() => player?.classList.add('idle'), 600); });
  }
  let idleT = 0;
  function wake() {
    if (!player) return;
    player.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (player && onAir && !onAir.el.paused) player.classList.add('idle'); }, 2600);
  }
  function show(d) {
    for (const x of decks) x.el.classList.toggle('on', x === d);
    player?.querySelector('.tv-blank')?.setAttribute('hidden', '');
  }
  function unload(d) {
    if (!d) return;
    try { d.el.pause(); } catch {}
    if (d.hls) { try { d.hls.destroy(); } catch {} d.hls = null; }
    d.el.removeAttribute('src');
    try { d.el.load(); } catch {}
    d.key = ''; d.item = null; d.ready = false; d.told = false;
    d.el.classList.remove('on');
  }
  // A deck loads an airing: the item from `at` seconds in.
  function cue(d, item, key, at) {
    unload(d);
    d.key = key; d.item = item;
    const start = Math.max(0, at || 0);
    if (nativeHls(d.el)) {
      d.el.src = item.hls;
      d.el.addEventListener('loadedmetadata', () => { if (d.key === key && start > 0.2) { try { d.el.currentTime = start; } catch {} } }, { once: true });
      return Promise.resolve();
    }
    return loadHls().then(Hls => {
      if (d.key !== key) return;
      if (!Hls.isSupported()) { d.el.src = item.hls; return; }
      const h = new Hls({ capLevelToPlayerSize: true, startPosition: start, maxBufferLength: 20 });
      d.hls = h;
      h.on(Hls.Events.ERROR, (_, e) => {
        if (!e.fatal) return;
        if (e.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
        else if (e.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
      });
      h.loadSource(item.hls);
      h.attachMedia(d.el);
    }).catch(e => showToast('Couldn’t start the player: ' + e.message, 'ti-alert-triangle'));
  }
  function goLive(d) {
    if (!d) return;
    d.el.volume = prefs.volume ?? 1;
    d.el.muted = !!prefs.muted;
    d.el.playbackRate = 1;
    const p = d.el.play();
    if (p) p.then(() => { blocked = false; player?.classList.remove('paused'); if (!d.told) { d.told = true; window.klabPostPresence?.(); } }).catch(() => {
      if (d !== onAir) return;
      // A browser that wants a press first: the big button tunes in.
      blocked = true;
      player?.classList.add('paused');
      player?.classList.remove('fresh');
    });
  }

  // Tuning: the channel's airing, from where it's at now.
  function tune(c, opts) {
    const o = opts || {};
    const was = tuned;
    tuned = c.id;
    view = { kind: 'watch', id: c.id };
    held = false;
    for (const d of decks) unload(d);
    onAir = null;
    misses = 0; calmUntil = 0;
    if (was && was !== c.id) {
      // Between channels: a moment of black, calm.
      const b = player?.querySelector('.tv-blank');
      if (b) b.hidden = false;
      SFX && SFX.play('click');
    }
    if (Date.now() - offsetAt > 10 * 60e3) syncClock();
    paintInfo(true);
    paintSide();
    osd(c);
    clearInterval(loopT);
    loopT = setInterval(step, 250);
    step();
    window.klabPostPresence?.();
  }
  function step() {
    if (!player?.isConnected || view?.kind !== 'watch') { clearInterval(loopT); return; }
    const c = byId(tuned);
    const a = c && airing(c, now());
    if (!a) {
      for (const d of decks) unload(d);
      onAir = null;
      const b = player.querySelector('.tv-blank');
      b.hidden = false;
      b.firstElementChild.textContent = c && c.count ? 'This channel’s videos are still processing.' : 'Nothing on this channel yet.';
      player.classList.remove('fresh', 'paused');
      return;
    }
    const blank = player.querySelector('.tv-blank');
    if (blank.firstElementChild.textContent) blank.firstElementChild.textContent = '';
    if (held) return;
    if (!onAir || onAir.key !== a.key) {
      const old = onAir;
      const spare = decks.find(d => d.key === a.key) || decks.find(d => d !== old) || decks[0];
      onAir = spare;
      settleUntil = performance.now() + 2500;
      if (old && old !== spare) unload(old);
      if (spare.key !== a.key) {
        // Played once it has its source: hls.js attaching one restarts
        // the element's loading, which would cut off a play() before it.
        const key = a.key;
        cue(spare, a.item, key, a.off + 0.3).then(() => { if (onAir === spare && spare.key === key) goLive(spare); });
      } else {
        if (a.off > 0.25) { try { spare.el.currentTime = a.off + 0.15; } catch {} }
        // A preloaded deck is ready to show now; a fresh one shows on 'playing'.
        if (spare.ready) show(spare);
        goLive(spare);
      }
      paintInfo(true);
      paintSide();
      return;
    }
    // The next airing, loading behind this one.
    const spare = decks.find(d => d !== onAir);
    if (spare && a.left < 10 && spare.key !== a.nextKey && a.next.hls) { cue(spare, a.next, a.nextKey, 0); }
    keepInSync(a);
  }
  // On the line (js/28-radio.js keepInSync): within 60ms leave it, under
  // 0.8s ease back by up to 3%, past that jump. Three jumps that don't land
  // and it plays on for a minute rather than keep jumping.
  function keepInSync(a) {
    const el = onAir?.el;
    if (!el || el.paused || el.seeking || el.readyState < 3) return;
    if (performance.now() < settleUntil) return;
    const d = el.currentTime - a.off;
    if (Math.abs(d) > 0.8) {
      el.playbackRate = 1;
      if (performance.now() < calmUntil) return;
      if (++misses > 3) { misses = 0; calmUntil = performance.now() + 60e3; return; }
      // Past the end of what the file has (its real length is a little
      // shorter than the API's): wait for the next airing.
      if (isFinite(el.duration) && a.off > el.duration - 0.3) return;
      try { el.currentTime = a.off + 0.2; } catch {}
      settleUntil = performance.now() + 3000;
    } else {
      misses = 0;
      el.playbackRate = Math.abs(d) > 0.06 ? Math.max(0.97, Math.min(1.03, 1 - d * 0.3)) : 1;
    }
  }
  function stopPlayer() {
    clearInterval(loopT);
    if (document.fullscreenElement && document.fullscreenElement === player) document.exitFullscreen?.();
    const had = decks.length;
    for (const d of decks) unload(d);
    decks = []; onAir = null; player = null;
    clearTimeout(idleT); clearTimeout(osdT);
    if (tuned) { tuned = null; window.klabPostPresence?.(); }
    if (had) window.klabnetDesktop?.trimMemory?.();
  }
  // Leaving Channels (or Videos) altogether.
  function leave() {
    stopPlayer();
    clearInterval(tickT);
    view = null; root = null;
    setRow(false);
  }

  // The music steps aside, as for Videos (not a remote's: pausing the
  // stand-in would pause it on the device that's playing).
  function quietMusic() {
    try {
      if (window.klabRadio?.station?.()) window.klabRadio.off?.();
      const au = typeof playerState !== 'undefined' && playerState.audio;
      if (au && !au.paused && !window.klabSession?.mirror) au.pause();
    } catch (e) {}
  }
  function paintBtns() {
    if (!player || !onAir) return;
    const el = onAir.el;
    player.querySelector('[data-tvp="mute"] i').className = 'ti ' + (el.muted || el.volume === 0 ? 'ti-volume-off' : 'ti-volume');
    player.classList.toggle('held', held);
  }
  function toggleHold() {
    if (!onAir) { if (blocked) step(); return; }
    if (blocked) { blocked = false; goLive(onAir); return; }
    held = !held;
    if (held) onAir.el.pause();
    else { settleUntil = 0; misses = 0; calmUntil = 0; step(); goLive(onAir); }
    paintBtns();
  }
  function toggleMute() {
    if (!onAir) return;
    const el = onAir.el;
    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) el.volume = 0.5;
    prefs.muted = el.muted; prefs.volume = el.volume; savePrefs();
    const r = player.querySelector('.vp-vol-range');
    if (r) r.value = el.muted ? 0 : el.volume;
    paintBtns();
  }
  function toggleFull() {
    if (!player) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (player.requestFullscreen || player.webkitRequestFullscreen)?.call(player);
  }
  document.addEventListener('fullscreenchange', () => {
    const on = !!player && document.fullscreenElement === player;
    player?.classList.toggle('full', on);
    const i = player?.querySelector('[data-tvp="full"] i');
    if (i) i.className = 'ti ' + (on ? 'ti-arrows-minimize' : 'ti-arrows-maximize');
  });
  // Up and down the dial, round at the ends.
  function zap(dir) {
    if (!channels.length) return;
    const list = [...channels].sort((a, b) => a.number - b.number);
    const i = list.findIndex(c => c.id === tuned);
    const next = list[((i < 0 ? 0 : i + dir) + list.length) % list.length];
    if (next && next.id !== tuned) tune(next);
  }

  // ── The overlay: number, name and what's on, for a moment ──
  let osdT = 0;
  function osd(c, typed) {
    const el = player?.querySelector('.tv-osd');
    if (!el) return;
    const a = c && airing(c, now());
    el.querySelector('.tv-osd-num').textContent = typed != null ? typed + (typed.length < 2 ? '–' : '') : c.number;
    el.querySelector('.tv-osd-name').textContent = typed != null ? (c ? c.name : '') : c.name;
    el.querySelector('.tv-osd-now').textContent = typed != null ? '' : a ? a.item.title || '' : '';
    el.style.setProperty('--tv-c', c?.color || 'rgba(255,255,255,.5)');
    el.classList.add('on');
    clearTimeout(osdT);
    osdT = setTimeout(() => el.classList.remove('on'), 3000);
  }
  // Digits typed go to that number, on Enter or after a pause.
  let typed = '', typedT = 0;
  function typeDigit(k) {
    typed = (typed + k).slice(-2);
    clearTimeout(typedT);
    osd(byNumber(+typed), typed);
    if (typed.length >= 2) typedT = setTimeout(commitTyped, 900);
    else typedT = setTimeout(commitTyped, 1600);
  }
  function commitTyped() {
    clearTimeout(typedT);
    const n = +typed;
    typed = '';
    if (!n) return;
    const c = byNumber(n);
    if (c) { if (c.id !== tuned) tune(c); else osd(c); }
    else { const el = player?.querySelector('.tv-osd'); if (el) { el.querySelector('.tv-osd-name').textContent = 'No channel ' + n; el.querySelector('.tv-osd-now').textContent = ''; } }
  }

  // ── Keys while a channel's on (ahead of the app's: digits go to pages) ──
  window.addEventListener('keydown', e => {
    if (view?.kind !== 'watch' || !player || !showing() || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (window.klabLayers?.modal?.() || document.querySelector('.chat-modal-backdrop.open')) return;
    const k = e.key, focused = player.contains(el);
    if (k === ' ' && !focused && el && el !== document.body && el.matches?.('button, a[href], [role="button"], [role="tab"], summary')) return;
    let done = true;
    if (k === 'PageUp' || (focused && k === 'ArrowUp')) zap(1);
    else if (k === 'PageDown' || (focused && k === 'ArrowDown')) zap(-1);
    else if (/^[0-9]$/.test(k)) typeDigit(k);
    else if (k === 'Enter' && typed) commitTyped();
    else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === ' ' || k === 'k' || k === 'K') toggleHold();
    else if (k === 'i' || k === 'I') osd(byId(tuned));
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); wake(); }
  }, true);

  // ── Presses ──
  page.addEventListener('click', e => {
    if (!root || !root.contains(e.target)) return;
    const p = e.target.closest('[data-tvp]');
    if (p && player?.contains(p)) {
      const k = p.dataset.tvp;
      if (k === 'play') { blocked = false; held = false; if (onAir) { settleUntil = 0; goLive(onAir); } else step(); }
      else if (k === 'mute') toggleMute();
      else if (k === 'up') zap(1);
      else if (k === 'down') zap(-1);
      else if (k === 'full') toggleFull();
      else if (k === 'pip' && onAir) (document.pictureInPictureElement ? document.exitPictureInPicture() : onAir.el.requestPictureInPicture()).catch(() => {});
      SFX && SFX.play('click');
      return;
    }
    const row = e.target.closest('[data-tv-id]');
    if (row) {
      const c = byId(row.dataset.tvId);
      if (!c) return;
      SFX && SFX.play('nav');
      if (view?.kind === 'watch') { if (c.id !== tuned) tune(c); }
      else openChannel(c.id);
      return;
    }
    const b = e.target.closest('[data-tv-act]');
    if (!b) return;
    const act = b.dataset.tvAct, c = byId(view?.id);
    if (act === 'new') editDialog(null);
    else if (act === 'guide') { if (!window.klabNav?.back()) showGuide(); }
    else if (act === 'copy' && c) klabCopy(linkTo(c), 'Link');
    else if (act === 'edit' && c) editDialog(c);
    else if (act === 'delete' && c) deleteChannel(c);
  });
  page.addEventListener('contextmenu', e => {
    if (!root || !root.contains(e.target)) return;
    const row = e.target.closest('[data-tv-id]');
    const c = row ? byId(row.dataset.tvId) : (e.target.closest('.tv-vp, .tv-info') ? byId(tuned) : null);
    if (!c) return;
    klabMenu(e, [
      { header: c.number + ' · ' + c.name },
      { label: 'Watch', icon: 'ti-player-play', hidden: c.id === tuned, action: () => (view?.kind === 'watch' ? tune(c) : openChannel(c.id)) },
      { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(linkTo(c), 'Link') },
      '-',
      { label: 'Edit channel', icon: 'ti-pencil', hidden: !c.canEdit, action: () => editDialog(c) },
      { label: 'Delete channel', icon: 'ti-trash', danger: true, hidden: !c.canEdit, action: () => deleteChannel(c) },
    ]);
  });

  // The sidebar's row (ahead of 39-videos.js's own, which doesn't know it).
  nav.addEventListener('click', e => {
    const b = e.target.closest('.picker-tab[data-vid="channels"]');
    if (!b) return;
    e.stopPropagation();
    SFX && SFX.play('click');
    showGuide();
    if (document.activeElement === b) b.blur();
  }, true);

  // Anything else drawn over the page (another row, a video) stops us.
  new MutationObserver(() => { if (view && root && !page.contains(root)) leave(); }).observe(page, { childList: true });

  // ── Making and editing a channel ──
  const COLORS = ['#4f8cff', '#7c5cff', '#e5484d', '#ff7a45', '#f5a524', '#3ecf8e', '#12a594', '#e93d82'];
  function freeNumber() {
    const taken = new Set(channels.map(c => c.number));
    for (let n = 1; n <= 99; n++) if (!taken.has(n)) return n;
    return '';
  }
  function editDialog(c) {
    if (server === false) { showToast('Channels need the latest klabnet-api', 'ti-device-tv'); return; }
    const fresh = !c;
    const color = c?.color || COLORS[channels.length % COLORS.length];
    let lineup = (c?.lineup || c?.items || []).map(x => ({ ...x }));
    let mode = 'pick', file = null, cover = null;
    openChatModal(fresh ? 'New channel' : 'Edit channel', `
      <form class="tv-form" id="tvForm" autocomplete="off">
        <div class="tv-form-grid">
          <label class="k-form-label" for="tvName">Name</label>
          <input class="k-field" id="tvName" maxlength="60" required value="${esc(c?.name || '')}" placeholder="Saturday mornings" />
          <label class="k-form-label" for="tvNumber">Number</label>
          <input class="k-field tv-num-in" id="tvNumber" type="number" min="1" max="99" required value="${c ? c.number : freeNumber()}" />
        </div>
        <label class="k-form-label">Color</label>
        <div class="tv-colors" id="tvColors">${COLORS.map(x => '<button type="button" class="tv-color' + (x === color ? ' on' : '') + '" data-color="' + x + '" style="--tv-c:' + x + '" aria-label="' + x + '"></button>').join('')}
          <label class="tv-color tv-color-own${COLORS.includes(color) ? '' : ' on'}" title="Your own" style="--tv-c:${esc(color)}"><input type="color" id="tvColorOwn" value="${esc(color)}" /></label></div>
        <label class="k-form-label" for="tvDesc">Description</label>
        <textarea class="k-field" id="tvDesc" rows="2" maxlength="300" placeholder="Optional">${esc(c?.description || '')}</textarea>
        <label class="k-form-label">Cover <span class="tv-note">optional, square works best</span></label>
        <div class="tv-cover-pick"><span class="tv-art" id="tvCoverArt">${c && coverUrl(c) ? '<img src="' + esc(coverUrl(c)) + '" alt="" />' : '<i class="ti ti-device-tv"></i>'}</span>
          <button type="button" class="k-btn sm" id="tvCoverBtn"><i class="ti ti-photo"></i><span>Choose a picture</span></button>
          <input type="file" id="tvCoverFile" accept="image/*" hidden /></div>
        <div class="tv-lineup-head">
          <span class="k-form-label">Lineup</span>
          ${fresh ? '<div class="k-seg" id="tvMode"><button type="button" data-mode="pick" aria-pressed="true">Pick videos</button><button type="button" data-mode="file" aria-pressed="false">Upload one long file</button></div>' : ''}
        </div>
        <div id="tvPick">
          <div class="tv-lineup-sum" id="tvSum"></div>
          <div class="tv-lineup" id="tvLineup"></div>
          <div class="tv-find">
            <label class="k-field-box tv-find-box"><i class="ti ti-search"></i><input type="text" id="tvFind" placeholder="Search videos to add" aria-label="Search videos to add" /></label>
            <div class="k-seg" id="tvWhose"><button type="button" data-whose="all" aria-pressed="true">All</button><button type="button" data-whose="mine" aria-pressed="false">Yours</button></div>
          </div>
          <div class="tv-results" id="tvResults"></div>
          ${fresh ? '' : '<button type="button" class="k-btn sm tv-add-file" id="tvAddFile"><i class="ti ti-upload"></i><span>Upload a file into it</span></button>'}
        </div>
        <div id="tvFile" hidden>
          <button type="button" class="vid-drop" id="tvDrop"><i class="ti ti-upload"></i><b>Choose a video</b><span>or drop one here · it plays on this channel only, not in Videos</span></button>
        </div>
        <input type="file" id="tvFileIn" accept="video/*,.mkv,.mov,.m4v,.avi,.webm" hidden />
        <div class="tv-progress" id="tvProg" hidden><b></b><span></span></div>
        <p class="emo-err" id="tvErr" hidden></p>
        <div class="dlg-actions">
          <button type="button" class="k-btn" data-dlg-cancel id="tvCancel">Cancel</button>
          <button type="submit" class="k-btn primary" id="tvSave">${fresh ? 'Make channel' : 'Save'}</button>
        </div>
      </form>`, () => { if (xhr && xhr.readyState !== 4) { /* it carries on; a toast says when it's done */ } });
    const form = $('tvForm');
    let xhr = null;
    const err = m => { $('tvErr').hidden = !m; $('tvErr').textContent = m || ''; };
    let pickedColor = color;
    $('tvColors').addEventListener('click', e => {
      const b = e.target.closest('button.tv-color');
      if (!b) return;
      pickedColor = b.dataset.color;
      $('tvColors').querySelectorAll('.tv-color').forEach(x => x.classList.toggle('on', x === b));
    });
    $('tvColorOwn').addEventListener('input', e => {
      pickedColor = e.target.value;
      const own = e.target.closest('.tv-color');
      own.style.setProperty('--tv-c', pickedColor);
      $('tvColors').querySelectorAll('.tv-color').forEach(x => x.classList.toggle('on', x === own));
    });
    $('tvCoverBtn').addEventListener('click', () => $('tvCoverFile').click());
    $('tvCoverFile').addEventListener('change', () => {
      cover = $('tvCoverFile').files[0] || null;
      if (!cover) return;
      const url = URL.createObjectURL(cover);
      $('tvCoverArt').innerHTML = '<img src="' + url + '" alt="" />';
      $('tvCoverArt').querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    });

    // The lineup: drag to reorder, ✕ to take out.
    function paintLineup() {
      const total = lineup.reduce((a, x) => a + (x.status === 'ready' ? x.duration || 0 : 0), 0);
      const waiting = lineup.filter(x => x.status !== 'ready').length;
      $('tvSum').textContent = lineup.length
        ? klabCount(lineup.length, 'video') + ' · ' + dur(total) + ' loop' + (waiting ? ' · ' + waiting + ' not ready yet, skipped until they are' : '')
        : 'Nothing in it yet. Add videos below.';
      $('tvLineup').innerHTML = lineup.map((x, i) =>
        '<div class="tv-li" draggable="true" data-i="' + i + '">' +
          '<i class="ti ti-grip-vertical tv-grip" aria-hidden="true"></i>' +
          '<span class="tv-li-n">' + (i + 1) + '</span>' +
          '<span class="tv-li-thumb">' + (x.posterSmall ? '<img src="' + esc(x.posterSmall) + '" alt="" draggable="false" />' : '<i class="ti ti-movie"></i>') + '</span>' +
          '<span class="tv-li-tx"><span class="tv-li-t">' + esc(x.title || 'Untitled') + '</span><span class="tv-li-s">' +
            (x.status === 'ready' ? dur(x.duration) : x.status === 'failed' ? 'Couldn’t process it' : 'Processing ' + Math.round((x.progress || 0) * 100) + '%') +
            (x.unlisted ? ' · only on this channel' : x.username ? ' · ' + esc(x.username) : '') + '</span></span>' +
          '<button type="button" class="k-icon sm" data-rm="' + i + '" title="Take out" aria-label="Take out"><i class="ti ti-x"></i></button>' +
        '</div>').join('');
    }
    let dragFrom = -1;
    const li = $('tvLineup');
    li.addEventListener('dragstart', e => { const r = e.target.closest('.tv-li'); if (!r) return; dragFrom = +r.dataset.i; r.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch {} });
    li.addEventListener('dragend', () => { dragFrom = -1; li.querySelectorAll('.tv-li').forEach(r => r.classList.remove('drag', 'over-top', 'over-bottom')); });
    li.addEventListener('dragover', e => {
      const r = e.target.closest('.tv-li');
      if (dragFrom < 0 || !r) return;
      e.preventDefault();
      const box = r.getBoundingClientRect(), below = e.clientY > box.top + box.height / 2;
      li.querySelectorAll('.tv-li').forEach(x => x.classList.remove('over-top', 'over-bottom'));
      r.classList.add(below ? 'over-bottom' : 'over-top');
    });
    li.addEventListener('drop', e => {
      const r = e.target.closest('.tv-li');
      if (dragFrom < 0 || !r) return;
      e.preventDefault();
      const box = r.getBoundingClientRect();
      let to = +r.dataset.i + (e.clientY > box.top + box.height / 2 ? 1 : 0);
      const [x] = lineup.splice(dragFrom, 1);
      if (to > dragFrom) to--;
      lineup.splice(to, 0, x);
      dragFrom = -1;
      paintLineup();
    });
    li.addEventListener('click', e => {
      const b = e.target.closest('[data-rm]');
      if (!b) return;
      lineup.splice(+b.dataset.rm, 1);
      paintLineup();
    });
    // Finding videos to add (Videos' own search).
    let whose = 'all', findT = 0, findSeq = 0;
    async function find() {
      const q = $('tvFind').value.trim(), seq = ++findSeq;
      const el = $('tvResults');
      try {
        const j = await getJSON(VIDEOS + '?limit=20&sort=new' + (q ? '&q=' + encodeURIComponent(q) : '') + (whose === 'mine' ? '&user=' + encodeURIComponent(me()) : ''), null, 8000);
        if (seq !== findSeq || !el.isConnected) return;
        const vs = j.videos || [];
        el._vs = vs;
        el.innerHTML = vs.length ? vs.map((v, i) =>
          '<button type="button" class="tv-res" data-add="' + i + '"' + (v.status === 'failed' ? ' disabled' : '') + '>' +
            '<span class="tv-li-thumb">' + (v.posterSmall ? '<img src="' + esc(v.posterSmall) + '" alt="" draggable="false" loading="lazy" />' : '<i class="ti ti-movie"></i>') + '</span>' +
            '<span class="tv-li-tx"><span class="tv-li-t">' + esc(v.title || 'Untitled') + '</span><span class="tv-li-s">' + (v.status === 'ready' ? dur(v.duration) : v.status === 'failed' ? 'Couldn’t process it' : 'Processing') + ' · ' + esc(v.username) + '</span></span>' +
            '<i class="ti ti-plus tv-res-add"></i></button>').join('')
          : '<div class="k-empty tv-res-empty">' + (q ? 'Nothing matches that.' : 'No videos yet.') + '</div>';
      } catch (e) { if (seq === findSeq) el.innerHTML = '<div class="k-empty tv-res-empty">Couldn’t load videos.</div>'; }
    }
    $('tvFind').addEventListener('input', () => { clearTimeout(findT); findT = setTimeout(find, 250); });
    $('tvFind').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(findT); find(); } });
    $('tvWhose').addEventListener('click', e => {
      const b = e.target.closest('[data-whose]');
      if (!b) return;
      whose = b.dataset.whose;
      $('tvWhose').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      find();
    });
    $('tvResults').addEventListener('click', e => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      const v = $('tvResults')._vs?.[+b.dataset.add];
      if (!v) return;
      lineup.push({ id: v.id, title: v.title, duration: v.duration, status: v.status, progress: v.progress, posterSmall: v.posterSmall, username: v.username });
      paintLineup();
      const rows = $('tvLineup');
      rows.lastElementChild?.scrollIntoView({ block: 'nearest' });
      SFX && SFX.play('tick');
    });
    // One long file.
    const pickFile = f => {
      if (!f) return;
      if (!/^video\//.test(f.type) && !/\.(mkv|mov|m4v|avi|webm|mp4)$/i.test(f.name)) { err('That isn’t a video.'); return; }
      file = f;
      const d = $('tvDrop');
      d.classList.add('has');
      d.querySelector('b').textContent = f.name;
      d.querySelector('span').textContent = (f.size / 1048576).toFixed(f.size > 1048576 * 100 ? 0 : 1) + ' MB · choose another';
      err('');
      if (!fresh) send(c);
    };
    $('tvDrop').addEventListener('click', () => $('tvFileIn').click());
    $('tvFileIn').addEventListener('change', () => pickFile($('tvFileIn').files[0]));
    const drop = $('tvDrop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); pickFile(e.dataTransfer.files[0]); });
    $('tvAddFile')?.addEventListener('click', () => $('tvFileIn').click());
    $('tvMode')?.addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      mode = b.dataset.mode;
      $('tvMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $('tvPick').hidden = mode !== 'pick';
      $('tvFile').hidden = mode !== 'file';
    });
    paintLineup();
    find();
    $('tvName').focus();

    // The file, with a bar (XHR: a long file can be big).
    function upload(id, f) {
      return new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('title', f.name.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ').trim().slice(0, 100));
        xhr = new XMLHttpRequest();
        const bar = $('tvProg');
        xhr.open('POST', API + '/' + encodeURIComponent(id) + '/upload');
        xhr.responseType = 'json';
        xhr.upload.onprogress = e => {
          if (!e.lengthComputable || !bar.isConnected) return;
          bar.hidden = false;
          bar.querySelector('b').style.transform = 'scaleX(' + (e.loaded / e.total).toFixed(3) + ')';
          bar.querySelector('span').textContent = e.loaded < e.total ? 'Uploading ' + Math.round(e.loaded / e.total * 100) + '%' : 'Saving…';
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new Error(xhr.response?.error || 'failed (' + xhr.status + ')')));
        xhr.onerror = () => reject(new Error('the upload didn’t get through'));
        xhr.onabort = () => reject(new Error('stopped'));
        xhr.send(fd);
      });
    }
    async function send(existing) {
      const name = $('tvName').value.trim();
      if (!name) { err('It needs a name.'); $('tvName').focus(); return; }
      const number = +$('tvNumber').value;
      if (!(number >= 1 && number <= 99)) { err('Pick a number from 1 to 99.'); $('tvNumber').focus(); return; }
      if (fresh && mode === 'file' && !file) { err('Choose a video to upload.'); return; }
      const save = $('tvSave');
      save.disabled = true; save.textContent = file ? 'Uploading…' : 'Saving…';
      err('');
      const body = { name, number, color: pickedColor, description: $('tvDesc').value.trim(), videos: lineup.map(x => x.id) };
      try {
        let out = existing
          ? await getJSON(API + '/' + encodeURIComponent(existing.id), json('PATCH', body))
          : await getJSON(API, json('POST', fresh && mode === 'file' ? { ...body, videos: [] } : body));
        if (cover) { const fd = new FormData(); fd.append('file', cover); out = await getJSON(API + '/' + encodeURIComponent(out.id) + '/cover', { method: 'POST', body: fd }, 60000); }
        if (file) {
          const f = file;
          file = null;
          out = await upload(out.id, f);
        }
        await load(true);
        if (!existing) {
          closeChatModal();
          showToast(out.count && !out.items.length ? 'Channel ' + out.number + ' made. It goes on air once its video is processed' : 'Channel ' + out.number + ' is on air', 'ti-device-tv');
          openChannel(out.id);
        } else if (mode === 'file' || $('tvFileIn').files.length) {
          // A file into an existing channel: the dialog stays, with it in the lineup.
          lineup = (out.lineup || []).map(x => ({ ...x }));
          paintLineup();
          $('tvProg').hidden = true;
          save.disabled = false; save.textContent = 'Save';
          $('tvFileIn').value = '';
          showToast('Added to the lineup. It plays once it’s processed', 'ti-upload');
          refresh();
        } else {
          closeChatModal();
          showToast('Saved', 'ti-check');
          refresh();
        }
      } catch (e) {
        err(klabCap(e.message));
        save.disabled = false; save.textContent = fresh ? 'Make channel' : 'Save';
        $('tvProg').hidden = true;
      }
    }
    form.addEventListener('submit', e => { e.preventDefault(); send(fresh ? null : c); });
  }
  // Whatever's showing, again, after a change.
  function refresh() {
    if (view?.kind === 'guide') paintGuide();
    else if (view?.kind === 'watch') { const c = byId(view.id); if (c) { paintInfo(true); paintSide(); } else showGuide({ quiet: true }); }
  }
  async function deleteChannel(c) {
    const own = (c.lineup || []).some(x => x.unlisted);
    if (!(await showConfirmDialog('Delete this channel?', '“' + c.name + '” goes for everyone. ' + (own ? 'The file uploaded into it goes too; videos from Videos stay there.' : 'Its videos stay in Videos.'), 'Delete'))) return;
    try {
      await getJSON(API + '/' + encodeURIComponent(c.id), { method: 'DELETE' }, 15000);
      channels = channels.filter(x => x.id !== c.id);
      showToast('Channel deleted', 'ti-trash');
      if (tuned === c.id || view?.kind === 'watch') showGuide({ quiet: true });
      else paintGuide();
      load(true);
    } catch (e) { showToast('Couldn’t delete it: ' + e.message, 'ti-alert-triangle'); }
  }

  // ── Coming and going ──
  const prevChanged = window.klabVideosTabChanged;
  window.klabVideosTabChanged = on => {
    const link = on ? window.klabTvLink : null;
    if (link) window.klabTvLink = null;
    prevChanged?.(on);
    if (!on) {
      // The video stops when you leave the page (picture in picture aside).
      if (view?.kind === 'watch' && !(document.pictureInPictureElement && onAir && document.pictureInPictureElement === onAir.el)) stopPlayer();
      return;
    }
    if (link) { if (link.number) openChannel(link.number); else showGuide(); return; }
    // Back on Videos with a channel still drawn: on air again.
    if (view?.kind === 'watch' && root?.isConnected && !player) {
      const c = byId(view.id);
      if (c) { player = null; const id = c.id; view = null; openChannel(id, { quiet: true }); }
    }
  };
  // Back and Forward (js/17-history.js).
  const prevRestore = window.klabVideosRestore;
  window.klabVideosRestore = d => {
    if (d.kind !== 'tv') { prevRestore?.(d); return; }
    // Videos' own first, so it counts as entered (and doesn't draw over us).
    if (!page.firstElementChild) prevRestore?.({ kind: 'list', view: { kind: 'home' } });
    restoring = true;
    try {
      if (d.view === 'watch' && d.id) { view = null; openChannel(d.id, { quiet: true }); }
      else showGuide({ quiet: true });
    } finally { setTimeout(() => { restoring = false; }, 0); }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || view?.kind !== 'watch' || !tuned) return;
    misses = 0; calmUntil = 0;
    syncClock().then(() => { settleUntil = 0; step(); });
  });

  // For Videos' Browse shelf, presence's beat, and links.
  window.klabTv = {
    channels: () => load().then(list => list.map(c => {
      const a = airing(c, now());
      return { id: c.id, name: c.name, number: c.number, color: c.color, cover: coverUrl(c), poster: a?.item.poster || '', posterSmall: a?.item.posterSmall || '', title: a?.item.title || '' };
    })),
    open: id => openChannel(id),
    guide: () => showGuide(),
    // The channel on air here, for presence (null when nothing's playing).
    now: () => (tuned && onAir && !onAir.el.paused ? tuned : null),
    state: () => ({ view, tuned, key: onAir?.key || '', at: onAir ? onAir.el.currentTime : null, target: (() => { const a = airing(byId(tuned), now()); return a ? a.off : null; })(), offset }),
  };
  syncClock();
  // A link straight to a channel, on a page that opened on Videos.
  if (showing() && window.klabTvLink) { const l = window.klabTvLink; window.klabTvLink = null; if (l.number) openChannel(l.number); else showGuide(); }
})();
