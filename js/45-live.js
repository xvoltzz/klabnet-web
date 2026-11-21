// ══════════════════════════════════════════
//  LIVE STREAMING (2026-11-20) — "how about a streaming feature? like if i
//  wanted to stream from OBS"
//  Someone streams from OBS to LiveKit Ingress (WHIP, passed through as OBS
//  encodes it; or RTMP, re-encoded), which puts it in a LiveKit room of its
//  own; everyone else watches here, subscribe only. klabnet-api's
//  app/routers/live.py has the keys, who's live, the token and each
//  stream's chat (/api/posts/live).
//    · Videos → Live (data-vid="live", after Channels): who's live as big
//      cards, the streams before under them. A stream plays in Videos'
//      page (#vidPage) like a TV channel: 39-videos.js lets go of it
//      through window.klabVideosLeave, and anything else drawn there stops
//      us (a MutationObserver).
//    · The player is klabnet's controls over a <video> that both of the
//      stream's tracks are attached to: pause (playing again is live
//      again, WebRTC keeps nothing), volume, picture in picture, full
//      screen, a Live badge, and a dim line of what's arriving
//      (resolution · fps · bitrate · how much the player holds back).
//    · Chat beside it, the radio's way: polled every 2s while it shows,
//      a new stream starts with an empty one.
//    · The row hides until the API says streaming is set up, and wears a
//      dot and a count while anyone's live. Going live makes no toast
//      (calm): the dot, the recap, Together, Home's rows, and a desktop
//      notification only for people who turned that on (Settings →
//      Streaming, off by default).
//    · Settings → Streaming: the keys (OBS's WHIP server and bearer token,
//      RTMP's server and key), title and game, Check, New keys.
//  window.klabLive: open(user), list(), of(user), state().
//  Deep links: #videos/live, #videos/live/<username>.
// ══════════════════════════════════════════
(function () {
  const $ = id => document.getElementById(id);
  const page = $('vidPage'), nav = $('vidNav');
  if (!page || !nav) return;
  const API = '/api/posts/live';
  const LIB = 'js/vendor/livekit-client.umd.js?v=2.22.3';
  const row = nav.querySelector('.picker-tab[data-vid="live"]');
  const me = () => window.KLAB_USER?.username || '';
  const showing = () => document.body.classList.contains('tab-videos-active');
  const panel = () => page.closest('.tab-panel');
  const sfx = n => { try { SFX && SFX.play(n); } catch (e) {} };

  // ── Little things ──
  function long(s) {
    s = Math.max(0, Math.round(+s || 0));
    if (s < 60) return 'just now';
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
  }
  function length(s) {
    s = Math.max(0, Math.round(+s || 0));
    if (s < 60) return s + 's';
    const h = Math.floor(s / 3600), m = Math.round(s / 60) % 60;
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : Math.round(s / 60) + 'm';
  }
  function clock(t) { return new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function day(t) {
    const d = new Date(t * 1000), n = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, n)) return 'Today';
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (same(d, y)) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
  }
  const color = u => (typeof profileColor === 'function' ? profileColor(u) : 'var(--text)');
  function face(u, cls) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="vid-face lv-face' + (cls ? ' ' + cls : '') + '" data-face="' + esc(u) + '" title="' + esc(u) + '" style="--c:' + color(u) + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" draggable="false" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  const linkTo = u => location.origin + location.pathname + '#videos/live/' + encodeURIComponent(u);
  async function getJSON(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 10000);
    try {
      const r = await fetch(url, { cache: 'no-store', ...(opts || {}), signal: ctrl.signal });
      // Not JSON (a sign-in page, a proxy's error page): no answer, not an empty one.
      const j = await r.json().catch(() => null);
      if (!r.ok) { const e = new Error(j?.error || 'failed (' + r.status + ')'); e.status = r.status; throw e; }
      if (!j || typeof j !== 'object') { const e = new Error('no answer (' + r.status + ')'); e.status = 0; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const ago = t => (Date.now() / 1000 + skew) - t;
  let skew = 0; // the API's clock minus ours, from the last answer

  // ── Who's live: polled (20s, 5s while Live shows) ──
  let info = { enabled: false, live: [], recent: [] };
  let known = null;      // usernames live at the last poll (null until the first)
  let pollT = 0, polling = null;
  const NOTIFY = 'klabnet_live_notify';
  const notifyOn = () => { try { return localStorage.getItem(NOTIFY) === '1'; } catch { return false; } };
  async function poll() {
    if (polling) return polling;
    polling = (async () => {
      try {
        const j = await getJSON(API);
        if (j.now) skew = j.now - Date.now() / 1000;
        info = { enabled: !!j.enabled, online: !!j.online, live: j.live || [], recent: j.recent || [] };
      } catch (e) {
        if (e.status === 404 || e.status === 405) info = { enabled: false, live: [], recent: [] };
      } finally { polling = null; }
      const now = new Set(info.live.map(s => s.username));
      if (known && notifyOn()) {
        for (const s of info.live) {
          if (known.has(s.username) || s.username === me()) continue;
          window.klabDesktopNotify?.({ title: s.username + ' is live', body: [s.title, s.game].filter(Boolean).join(' · '),
            icon: window.klabResolveUserAvatar?.(s.username), tag: 'live-' + s.username, onClick: () => open(s.username) });
        }
      }
      known = now;
      paintRow();
      paintSettingsVisible();
      if (view?.kind === 'list' && root?.isConnected) paintList();
      if (view?.kind === 'watch' && root?.isConnected) { paintInfo(); maybeConnect(); }
      document.dispatchEvent(new CustomEvent('klab:live'));
    })();
    return polling;
  }
  function schedule() {
    clearTimeout(pollT);
    // (A hidden tab asks every 20s only for "Tell me when someone goes
    // live", which is for when klabnet isn't in front; otherwise not at
    // all, even on the Live page, where the 5s poll used to run on in the
    // background. Coming back asks at once.)
    const fast = showing() && view && root?.isConnected && !document.hidden;
    pollT = setTimeout(() => { if (!document.hidden || notifyOn()) poll().finally(schedule); else schedule(); }, fast ? 5000 : 20000);
  }
  function paintRow() {
    if (!row) return;
    row.hidden = !info.enabled;
    const n = info.live.length, el = $('vidLiveN');
    row.classList.toggle('has-live', n > 0);
    if (el) { el.hidden = !n; el.textContent = n ? String(n) : ''; }
    row.title = n ? klabCount(n, 'person', 'people') + ' live' : 'Live';
  }
  const byUser = u => info.live.find(s => s.username === u) || null;

  // ── Views ──
  let view = null;   // null, { kind: 'list' } or { kind: 'watch', user }
  let root = null, restoring = false;
  function setRow(on) {
    nav.querySelectorAll('.picker-tab[data-vid]').forEach(b => b.classList.toggle('active', on && b.dataset.vid === 'live'));
  }
  function take() {
    window.klabVideosLeave?.();
    disconnect();
  }
  function record(desc) {
    if (restoring) return;
    window.klabNav?.push({ tab: 'videos', kind: 'live', ...desc });
  }
  function leave() {
    disconnect();
    clearInterval(tickT);
    view = null; root = null;
    setRow(false);
  }

  // ── The list ──
  const LOADING = '<div class="k-empty vid-empty" data-wait><i class="ti ti-loader loading-spinner"></i><div>Loading…</div></div>';
  function showList(opts) {
    const o = opts || {};
    if (!showing()) setActiveTab('videos');
    take();
    view = { kind: 'list' };
    setRow(true);
    if (!o.quiet) record({ view: 'list' });
    page.innerHTML = '<div class="lv-root lv-list">' +
      '<div class="k-page-head"><h2 class="k-page-title">Live</h2><span class="k-page-count" id="lvCount"></span>' +
        '<div class="k-page-actions"><button type="button" class="k-btn" data-lv-act="golive"><i class="ti ti-broadcast"></i><span>Go live</span></button></div></div>' +
      '<div id="lvNow">' + LOADING + '</div><div id="lvEarlier"></div></div>';
    root = page.firstElementChild;
    if (panel()) panel().scrollTop = 0;
    klabEnter(page);
    listKey = '';
    paintList();
    poll();
    schedule();
    startTicks();
  }
  function since(s) { return 'Live · ' + long(ago(s.started)); }
  function cardHTML(s) {
    const art = window.klabResolveUserAvatar?.(s.username);
    return '<button type="button" class="lv-card" data-lv-user="' + esc(s.username) + '" data-silent>' +
      '<span class="lv-card-art" style="--c:' + color(s.username) + '">' +
        (art ? '<img class="lv-card-bg" src="' + esc(art) + '" alt="" draggable="false" />' : '') +
        '<span class="lv-card-face">' + face(s.username, 'big') + '</span>' +
        '<span class="lv-badge"><i></i>Live</span>' +
        '<span class="lv-card-viewers"><i class="ti ti-users"></i>' + (s.viewers || 0) + '</span>' +
      '</span>' +
      '<span class="lv-card-tx">' +
        '<span class="lv-card-title">' + esc(s.title || s.username + ' is live') + '</span>' +
        '<span class="lv-card-sub"><b style="color:' + color(s.username) + '">' + esc(s.username) + '</b>' +
          (s.game ? ' · ' + esc(s.game) : '') + ' · <span data-lv-since="' + s.started + '">' + esc(since(s)) + '</span></span>' +
      '</span></button>';
  }
  function earlierHTML(r) {
    return '<button type="button" class="lv-past k-row" data-lv-user="' + esc(r.username) + '" data-silent>' +
      face(r.username, 'sm') +
      '<span class="lv-past-tx"><span class="lv-past-title">' + esc(r.title || 'Untitled stream') + '</span>' +
        '<span class="lv-past-sub">' + esc(r.username) + (r.game ? ' · ' + esc(r.game) : '') + '</span></span>' +
      '<span class="lv-past-when">' + esc(day(r.started) + ', ' + clock(r.started)) + '<span>' + esc(length(r.length)) +
        (r.peak ? ' · ' + klabCount(r.peak, 'viewer') : '') + '</span></span></button>';
  }
  let listKey = '';
  function paintList() {
    const now = $('lvNow'), earlier = $('lvEarlier'), count = $('lvCount');
    if (!now) return;
    const key = JSON.stringify([info.enabled, info.live.map(s => [s.username, s.title, s.game, s.viewers]), info.recent.map(r => r.id)]);
    if (key === listKey) return;
    listKey = key;
    if (count) count.textContent = info.live.length ? klabCount(info.live.length, 'stream') + ' on' : '';
    if (!info.enabled) {
      now.innerHTML = '<div class="k-empty vid-empty"><i class="ti ti-broadcast"></i><div>Streaming isn’t set up on this klabnet yet.</div></div>';
      earlier.innerHTML = '';
      return;
    }
    now.innerHTML = info.live.length
      ? '<div class="lv-grid">' + info.live.map(cardHTML).join('') + '</div>'
      : '<div class="k-empty lv-empty"><i class="ti ti-broadcast"></i><div>Nobody’s live right now.</div>' +
        '<button type="button" class="k-btn" data-lv-act="golive"><i class="ti ti-settings"></i><span>Set up OBS</span></button></div>';
    earlier.innerHTML = info.recent.length
      ? '<div class="k-label vid-label lv-label">Earlier</div><div class="lv-pasts">' + info.recent.map(earlierHTML).join('') + '</div>' : '';
  }

  // ── Watching ──
  function openStream(user, opts) {
    const o = opts || {};
    if (!user) { showList(o); return; }
    if (!showing()) setActiveTab('videos');
    if (view?.kind === 'watch' && view.user === user && root?.isConnected) return;
    take();
    view = { kind: 'watch', user };
    setRow(true);
    if (!o.quiet) record({ view: 'watch', user });
    page.innerHTML = '<div class="lv-root lv-watch">' +
      '<div class="lv-watch-main">' +
        '<button type="button" class="k-btn sm vid-back" data-lv-act="back"><i class="ti ti-arrow-left"></i><span>Live</span></button>' +
        '<div class="vp lv-vp paused fresh" id="lvPlayer" tabindex="0">' +
          '<video class="lv-video" playsinline></video>' +
          '<div class="lv-off" hidden><div class="lv-off-tx"></div></div>' +
          '<button type="button" class="vp-big" data-lvp="play" aria-label="Watch" data-silent><i class="ti ti-player-play-filled"></i></button>' +
          '<div class="vp-spin" hidden><span class="vid-spin"></span></div>' +
          '<button type="button" class="lv-unmute" data-lvp="unmute" hidden data-silent><i class="ti ti-volume-off"></i>Click for sound</button>' +
          '<div class="vp-ctrl"><div class="vp-row">' +
            '<button type="button" class="vp-btn" data-lvp="play" title="Pause (k)" aria-label="Pause" data-silent><i class="ti ti-player-pause-filled"></i></button>' +
            '<button type="button" class="lv-live-btn" data-lvp="live" title="Live" data-silent><i></i>Live</button>' +
            '<div class="vp-vol"><button type="button" class="vp-btn" data-lvp="mute" title="Mute (m)" data-silent><i class="ti ti-volume"></i></button>' +
              '<input type="range" class="vp-vol-range" min="0" max="1" step="0.02" aria-label="Volume" /></div>' +
            '<span class="vp-time lv-ctrl-since"></span>' +
            '<span class="vp-gap"></span>' +
            '<span class="lv-q" id="lvQ"></span>' +
            (document.pictureInPictureEnabled ? '<button type="button" class="vp-btn" data-lvp="pip" title="Picture in picture" data-silent><i class="ti ti-picture-in-picture"></i></button>' : '') +
            '<button type="button" class="vp-btn" data-lvp="full" title="Full screen (f)" data-silent><i class="ti ti-arrows-maximize"></i></button>' +
          '</div></div>' +
        '</div>' +
        '<div class="lv-info" id="lvInfo"></div>' +
      '</div>' +
      '<aside class="lv-side">' +
        '<div class="lv-chat-head"><span class="k-label">Chat</span><span class="lv-chat-n" id="lvChatN"></span></div>' +
        '<div class="lv-chat-box"><div class="lv-chat-log" id="lvChatLog" aria-live="polite"></div>' +
          '<form class="lv-chat-form" id="lvChatForm" autocomplete="off"><label class="k-field-box lv-chat-field"><input class="lv-chat-input" id="lvChatIn" maxlength="500" enterkeyhint="send" placeholder="Say something" aria-label="Chat message" /></label>' +
            '<button type="submit" class="k-btn primary icon" title="Send" aria-label="Send"><i class="ti ti-send-2"></i></button></form></div>' +
      '</aside>' +
    '</div>';
    root = page.firstElementChild;
    if (panel()) panel().scrollTop = 0;
    klabEnter(page);
    mountPlayer();
    infoKey = '';
    chat = { user, stream: null, msgs: [], last: 0, busy: false, off: false };
    paintInfo();
    loadLast(user);
    paintChat(true);
    loadChat();
    poll().then(() => maybeConnect());
    schedule();
    startTicks();
  }

  // The stream before, for a page opened while they're not live.
  const lastOf = {};
  function loadLast(u) {
    getJSON(API + '/' + encodeURIComponent(u)).then(j => { if (j.last) { lastOf[u] = j.last; paintInfo(); } }).catch(() => {});
  }
  let infoKey = '';
  function paintInfo() {
    const el = $('lvInfo'), u = view?.user;
    if (!el || !u) return;
    const s = byUser(u), last = !s && lastOf[u] || null;
    const key = JSON.stringify([u, s && [s.title, s.game, s.description, s.people, s.viewers, s.started], last && last.id]);
    if (key !== infoKey) {
      infoKey = key;
      const people = s?.people || [];
      el.innerHTML =
        '<h1 class="vid-title lv-title">' + esc(s?.title || (s ? u + ' is live' : last?.title || u)) + '</h1>' +
        '<div class="vid-by">' +
          '<button type="button" class="vid-by-who" data-lv-act="profile">' + face(u) +
            '<span><b>' + esc(u) + '</b><span>' + (s ? [s.game && esc(s.game), '<span data-lv-since="' + s.started + '">' + esc(since(s)) + '</span>'].filter(Boolean).join(' · ')
              : last ? 'Last live ' + esc(day(last.started).toLowerCase() === 'today' ? 'today, ' + clock(last.started) : day(last.started)) + ' · ' + esc(length(last.length)) : 'Not live') + '</span></span></button>' +
          (s ? '<span class="lv-watching">' + (people.length ? '<span class="lv-faces">' + people.slice(0, 6).map(p => face(p, 'xs')).join('') + '</span>' : '') +
            esc(s.viewers ? klabCount(s.viewers, 'person', 'people') + ' watching' : 'Nobody else is watching yet') + '</span>' : '') +
          '<div class="vid-acts">' +
            '<button type="button" class="k-btn" data-lv-act="copy"><i class="ti ti-link"></i><span>Copy link</span></button>' +
            '<button type="button" class="k-btn" data-lv-act="channel"><i class="ti ti-user"></i><span>Channel</span></button>' +
            (u === me() ? '<button type="button" class="k-icon" data-lv-act="golive" title="Stream settings" aria-label="Stream settings"><i class="ti ti-settings"></i></button>' : '') +
          '</div>' +
        '</div>' +
        (s?.description ? '<div class="vid-desc lv-desc"><div class="vid-desc-tx">' + esc(s.description) + '</div></div>' : '');
      const n = $('lvChatN');
      if (n) n.textContent = s ? klabCount(s.viewers || 0, 'viewer') : '';
    }
    paintOff();
    paintCtrlSince();
  }
  function paintCtrlSince() {
    const s = byUser(view?.user), el = player?.querySelector('.lv-ctrl-since');
    if (el) el.textContent = s ? long(ago(s.started)) : '';
  }
  // The player when there's nothing to show: not live, or it dropped.
  function paintOff() {
    if (!player) return;
    const u = view?.user, s = byUser(u), off = player.querySelector('.lv-off');
    let tx = '';
    if (!info.enabled) tx = '<b>Streaming isn’t set up</b>';
    else if (!s) tx = '<i class="ti ti-broadcast"></i><b>' + esc(u) + ' isn’t live right now</b><span>This starts by itself when they go live.</span>';
    else if (!track && phase === 'live') tx = '<span class="vid-spin"></span><b>Waiting for the stream</b><span>' + esc(u) + '’s stream is coming in.</span>';
    else if (phase === 'error') tx = '<i class="ti ti-alert-triangle"></i><b>Couldn’t connect</b><span>' + esc(lastError || 'Trying again…') + '</span>';
    off.hidden = !tx;
    if (tx) off.querySelector('.lv-off-tx').innerHTML = tx;
    player.classList.toggle('is-off', !!tx);
  }

  // ── The player ──
  let player = null, videoEl = null, LK = null, libP = null;
  let room = null, track = null, audioTrack = null, phase = 'idle', joinSeq = 0, lastError = '', retryT = 0;
  let held = false, blocked = false;
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('klabnet_video') || '{}'); } catch { return {}; } })();
  // klabnet_video is Videos' too (speed, Original, bandwidth): only the
  // volume is ours, merged in, so a stale copy here can't undo those.
  const savePrefs = () => { try { const all = JSON.parse(localStorage.getItem('klabnet_video') || '{}') || {}; all.volume = prefs.volume; all.muted = prefs.muted; localStorage.setItem('klabnet_video', JSON.stringify(all)); } catch {} };
  function loadLib() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    return libP ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => (window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error('the player didn’t load')));
      s.onerror = () => { libP = null; s.remove(); reject(new Error('the player didn’t load')); };
      document.head.appendChild(s);
    });
  }
  function mountPlayer() {
    player = $('lvPlayer');
    videoEl = player.querySelector('video');
    videoEl.volume = prefs.volume ?? 1;
    videoEl.muted = !!prefs.muted;
    const vol = player.querySelector('.vp-vol-range');
    vol.value = prefs.muted ? 0 : prefs.volume ?? 1;
    vol.addEventListener('input', () => {
      videoEl.volume = +vol.value; videoEl.muted = +vol.value === 0;
      prefs.volume = videoEl.volume; prefs.muted = videoEl.muted; savePrefs(); paintBtns();
    });
    videoEl.addEventListener('playing', () => { player.querySelector('.vp-spin').hidden = true; player.classList.remove('paused', 'fresh'); player.classList.add('started'); paintBtns(); });
    videoEl.addEventListener('waiting', () => { if (track) player.querySelector('.vp-spin').hidden = false; });
    videoEl.addEventListener('pause', () => paintBtns());
    videoEl.addEventListener('play', () => { quietMusic(); paintBtns(); });
    videoEl.addEventListener('volumechange', () => paintBtns());
    videoEl.addEventListener('click', () => wake());
    videoEl.addEventListener('dblclick', () => toggleFull());
    player.addEventListener('pointermove', wake);
    player.addEventListener('pointerleave', () => { clearTimeout(idleT); idleT = setTimeout(() => player?.classList.add('idle'), 900); });
    document.addEventListener('fullscreenchange', onFull);
    paintBtns();
  }
  let idleT = 0;
  function wake() {
    if (!player) return;
    player.classList.remove('idle', 'fresh');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (player && !videoEl.paused) player.classList.add('idle'); }, 2600);
  }
  function onFull() { player?.classList.toggle('full', document.fullscreenElement === player); }
  function paintBtns() {
    if (!player) return;
    const p = player.querySelector('.vp-ctrl [data-lvp="play"]');
    const playing = !videoEl.paused && !held;
    if (p) { p.querySelector('i').className = 'ti ' + (playing ? 'ti-player-pause-filled' : 'ti-player-play-filled'); p.title = playing ? 'Pause (k)' : 'Play (k)'; }
    player.querySelector('[data-lvp="mute"] i').className = 'ti ' + (videoEl.muted || videoEl.volume === 0 ? 'ti-volume-off' : 'ti-volume');
    player.classList.toggle('held', held);
    player.classList.toggle('paused', (held || blocked || videoEl.paused) && !!track);
    player.querySelector('.lv-unmute').hidden = !(track && audioTrack && videoEl.muted && !prefs.muted && !held);
  }
  function quietMusic() {
    try {
      if (window.klabRadio?.station?.()) window.klabRadio.off?.();
      const au = typeof playerState !== 'undefined' && playerState.audio;
      if (au && !au.paused && !window.klabSession?.mirror) au.pause();
    } catch (e) {}
  }
  function play() {
    if (!videoEl || !track) return;
    const p = videoEl.play();
    if (p) p.then(() => { blocked = false; paintBtns(); }).catch(() => {
      // No sound without a click first: play muted, and say so.
      if (!videoEl.muted) { videoEl.muted = true; videoEl.play().then(() => { blocked = false; paintBtns(); }).catch(() => { blocked = true; paintBtns(); }); }
      else { blocked = true; paintBtns(); }
    });
  }
  function toggleHold() {
    if (!track) return;
    if (blocked) { blocked = false; play(); return; }
    held = !held;
    if (held) videoEl.pause();
    else play(); // WebRTC holds nothing back: playing again is live again.
    paintBtns();
  }
  function toggleMute() {
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    if (!videoEl.muted && videoEl.volume === 0) videoEl.volume = 0.5;
    prefs.muted = videoEl.muted; prefs.volume = videoEl.volume; savePrefs();
    const r = player?.querySelector('.vp-vol-range');
    if (r) r.value = videoEl.muted ? 0 : videoEl.volume;
    paintBtns();
  }
  function toggleFull() {
    if (!player) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (player.requestFullscreen || player.webkitRequestFullscreen)?.call(player);
  }

  // ── Into the stream's room ──
  function maybeConnect() {
    const u = view?.kind === 'watch' ? view.user : null;
    if (!u || !player) return;
    if (byUser(u) && !room && phase !== 'joining') connect(u);
  }
  async function connect(u) {
    const my = ++joinSeq;
    phase = 'joining'; lastError = '';
    clearTimeout(retryT);
    player.querySelector('.vp-spin').hidden = false;
    paintOff();
    try {
      const [lk, t] = await Promise.all([loadLib(), getJSON(API + '/' + encodeURIComponent(u) + '/token', { method: 'POST' })]);
      if (my !== joinSeq) return;
      LK = lk;
      const r = new LK.Room({ adaptiveStream: false, dynacast: false });
      room = r;
      const E = LK.RoomEvent;
      r.on(E.TrackSubscribed, (tr, pub, p) => {
        if (r !== room || p.identity !== t.identity) return;
        if (tr.kind === 'video') {
          track = tr;
          // Simulcast (RTMP's ladder): the top rung; WHIP has only the one.
          try { pub.setVideoQuality?.(LK.VideoQuality.HIGH); } catch (e) {}
        } else if (tr.kind === 'audio') audioTrack = tr;
        tr.attach(videoEl);
        player.querySelector('.vp-spin').hidden = !!track;
        if (!held) play();
        paintOff(); paintBtns(); paintQuality();
      });
      r.on(E.TrackUnsubscribed, (tr) => {
        if (r !== room) return;
        try { tr.detach(videoEl); } catch (e) {}
        if (tr === track) track = null;
        if (tr === audioTrack) audioTrack = null;
        paintOff(); paintBtns();
      });
      r.on(E.ParticipantDisconnected, p => { if (r === room && p.identity === t.identity) { track = audioTrack = null; paintOff(); poll(); } });
      r.on(E.Disconnected, () => {
        if (r !== room) return;
        room = null; track = audioTrack = null; phase = 'idle';
        paintOff(); paintBtns();
        if (view?.kind === 'watch' && view.user === u) retryT = setTimeout(() => poll(), 2000);
      });
      await r.connect(t.url, t.token, { autoSubscribe: true });
      if (my !== joinSeq || r !== room) { r.disconnect(); return; }
      phase = 'live';
      for (const p of r.remoteParticipants.values()) {
        if (p.identity !== t.identity) continue;
        for (const pub of p.trackPublications.values()) if (pub.track && pub.isSubscribed) r.emit(E.TrackSubscribed, pub.track, pub, p);
      }
      window.klabPostPresence?.();
    } catch (e) {
      if (my !== joinSeq) return;
      try { room?.disconnect(); } catch (x) {}
      room = null; phase = 'error'; lastError = e.message || '';
      player && (player.querySelector('.vp-spin').hidden = true);
      paintOff();
      retryT = setTimeout(() => { if (view?.kind === 'watch' && view.user === u) { phase = 'idle'; maybeConnect(); } }, 5000);
    }
  }
  function disconnect() {
    joinSeq++;
    clearTimeout(retryT); clearTimeout(qT);
    const r = room;
    room = null; track = null; audioTrack = null; phase = 'idle'; held = false; blocked = false;
    if (r) { try { r.disconnect(); } catch (e) {} }
    if (videoEl) { try { videoEl.pause(); videoEl.srcObject = null; } catch (e) {} }
    if (document.pictureInPictureElement && document.pictureInPictureElement === videoEl) document.exitPictureInPicture().catch(() => {});
    document.removeEventListener('fullscreenchange', onFull);
    player = null; videoEl = null;
    chatStop();
  }

  // What's arriving, and how far behind: the playout buffer plus half the
  // round trip. Every 2s while it shows; dim, in the controls.
  let qT = 0;
  const lastBytes = new WeakMap();
  async function stats(tr) {
    let rep = null;
    try { rep = await tr?.getRTCStatsReport?.(); } catch (e) {}
    if (!rep) return null;
    let r = null, rtt = 0;
    rep.forEach(x => {
      if (x.type === 'inbound-rtp' && x.kind === 'video' && (!r || x.bytesReceived > r.bytesReceived)) r = x;
      if (x.type === 'candidate-pair' && x.nominated && x.currentRoundTripTime) rtt = x.currentRoundTripTime;
    });
    if (!r) return null;
    const now = performance.now(), prev = lastBytes.get(tr);
    lastBytes.set(tr, { bytes: r.bytesReceived, at: now });
    const bps = prev && now > prev.at ? (r.bytesReceived - prev.bytes) * 8000 / (now - prev.at) : 0;
    const jb = r.jitterBufferEmittedCount ? r.jitterBufferDelay / r.jitterBufferEmittedCount : 0;
    return { width: r.frameWidth || 0, height: r.frameHeight || 0, fps: Math.round(r.framesPerSecond || 0), bps: Math.max(0, bps), behind: jb + rtt / 2 };
  }
  let qSeq = 0;
  async function paintQuality() {
    clearTimeout(qT);
    // Each track subscribing calls this; only the newest call keeps the
    // 2s loop going (two awaiting at once used to leave two loops).
    const my = ++qSeq;
    const el = $('lvQ');
    if (!el || !track) { if (el) el.textContent = ''; return; }
    const q = document.hidden ? null : await stats(track);
    if (my !== qSeq) return;
    if (q && q.width && $('lvQ')) {
      el.textContent = q.width + '×' + q.height + ' · ' + q.fps + ' fps' +
        (q.bps ? ' · ' + (q.bps >= 1e6 ? (q.bps / 1e6).toFixed(1) + ' Mbps' : Math.round(q.bps / 1e3) + ' kbps') : '') +
        (q.behind ? ' · ' + (q.behind < 1 ? Math.round(q.behind * 1000) + ' ms' : q.behind.toFixed(1) + ' s') + ' buffered' : '');
      el.title = 'What’s arriving here: resolution, frame rate, bitrate, and how much this player holds back (the encoder and, for RTMP, the server add their own)';
    }
    qT = setTimeout(paintQuality, 2000);
  }

  // The "Live · 12m" lines, every 30s (no redraw).
  let tickT = 0;
  function startTicks() {
    clearInterval(tickT);
    tickT = setInterval(() => {
      if (!root?.isConnected || document.hidden) return;
      root.querySelectorAll('[data-lv-since]').forEach(el => { el.textContent = 'Live · ' + long(ago(+el.dataset.lvSince)); });
      paintCtrlSince();
    }, 30000);
  }

  // ── Chat ──
  let chat = { user: '', stream: null, msgs: [], last: 0, busy: false, off: false };
  let chatT = 0;
  function chatStop() { clearTimeout(chatT); }
  async function loadChat() {
    clearTimeout(chatT);
    const u = chat.user;
    // (Not while parked off Videos: coming back to the tab used to start
    // the 2s chat poll again for a stream nobody's watching.)
    if (!u || view?.kind !== 'watch' || view.user !== u || view.parked) return;
    if (!document.hidden && !chat.busy) {
      chat.busy = true;
      try {
        // A new stream (its id isn't the chat's): its chat, from the start.
        const sid = byUser(u)?.streamId, same = chat.stream && (!sid || sid === chat.stream);
        const j = await getJSON(API + '/' + encodeURIComponent(u) + '/chat' + (chat.last && same ? '?after=' + chat.last + '&stream=' + chat.stream : ''));
        if (chat.user !== u) return;
        if (j.stream !== chat.stream) { chat.stream = j.stream; chat.msgs = []; chat.last = 0; }
        add(j.messages || []);
        chat.off = false;
      } catch (e) {
        if (e.status === 404 || e.status === 405) chat.off = true;
      } finally { chat.busy = false; }
      paintChat();
    }
    chatT = setTimeout(loadChat, 2000);
  }
  function add(list) {
    const fresh = list.filter(m => !chat.msgs.some(x => x.id === m.id));
    if (!fresh.length) return;
    chat.msgs = chat.msgs.concat(fresh).sort((a, b) => a.id - b.id).slice(-200);
    chat.last = chat.msgs[chat.msgs.length - 1].id;
    chatKey = '';
  }
  let chatKey = '';
  function paintChat(reset) {
    const log = $('lvChatLog'), input = $('lvChatIn');
    if (!log) return;
    const s = byUser(chat.user);
    const open = !!s && !chat.off;
    input.disabled = !open;
    const sendBtn = $('lvChatForm')?.querySelector('button[type="submit"]');
    if (sendBtn) sendBtn.disabled = !open;
    input.placeholder = chat.off ? 'Chat needs the latest klabnet-api' : open ? 'Say something' : 'Chat opens when ' + chat.user + ' goes live';
    const key = JSON.stringify([open, chat.stream, chat.msgs.length, chat.last]);
    if (!reset && key === chatKey) return;
    chatKey = key;
    if (!chat.msgs.length) {
      log.innerHTML = '<div class="lv-chat-empty">' + (reset ? 'Loading…' : open ? 'Nothing said yet. Start it off.' : 'Nothing here. A stream’s chat starts when it does.') + '</div>';
      return;
    }
    const stick = reset || log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    let prev = null;
    log.innerHTML = chat.msgs.map(m => {
      const same = prev && prev.username === m.username && m.ts - prev.ts < 300;
      prev = m;
      return '<div class="lv-msg' + (same ? ' cont' : '') + (m.username === chat.user ? ' host' : '') + '" data-id="' + m.id + '" data-u="' + esc(m.username) + '">' +
        (same ? '<span class="lv-av-gap"></span>' : face(m.username, 'sm')) +
        '<div class="lv-msg-in">' + (same ? '' : '<div class="lv-msg-head"><b style="color:' + color(m.username) + '">' + esc(m.username) + '</b>' +
          (m.username === chat.user ? '<span class="lv-host">Streamer</span>' : '') + '<time>' + esc(clock(m.ts)) + '</time></div>') +
        '<div class="lv-msg-body">' + mention(esc(m.body)) + '</div></div></div>';
    }).join('');
    try { window.klabEmojify?.(log); } catch (e) {}
    if (stick) log.scrollTop = log.scrollHeight;
  }
  // @you lit, like the Feed's.
  function mention(html) {
    const u = me();
    if (!u) return html;
    return html.replace(new RegExp('(^|[^\\w@])@(' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w])', 'gi'), '$1<b class="lv-me">@$2</b>');
  }
  async function send(e) {
    e.preventDefault();
    const input = $('lvChatIn'), body = input.value.trim(), u = chat.user;
    if (!body || !u) return;
    input.value = '';
    try {
      const m = await getJSON(API + '/' + encodeURIComponent(u) + '/chat', json('POST', { body }));
      if (chat.user === u) { add([m]); paintChat(); const log = $('lvChatLog'); if (log) log.scrollTop = log.scrollHeight; }
      sfx('send');
    } catch (err) {
      input.value = body;
      showToast(err.status === 409 ? 'The stream’s over' : 'Couldn’t send that', 'ti-alert-triangle');
    }
  }
  async function deleteMsg(id) {
    const msg = chat.msgs.find(m => m.id === id);
    if (msg && msg.username !== me() &&
        !(await showConfirmDialog('Delete ' + msg.username + '’s message?', 'It’s gone from the stream’s chat.', 'Delete'))) return;
    const i = chat.msgs.findIndex(m => m.id === id);
    if (i < 0) return;
    const [m] = chat.msgs.splice(i, 1);
    chatKey = ''; paintChat();
    try { await getJSON(API + '/chat/' + id, { method: 'DELETE' }); }
    catch (e) { chat.msgs.splice(i, 0, m); chatKey = ''; paintChat(); showToast('Couldn’t delete that', 'ti-alert-triangle'); }
  }

  // ── Presses ──
  page.addEventListener('click', e => {
    if (!root || !root.contains(e.target)) return;
    const p = e.target.closest('[data-lvp]');
    if (p && player?.contains(p)) {
      const k = p.dataset.lvp;
      if (k === 'play') { if (blocked) { blocked = false; play(); } else if (held || videoEl.paused) { held = false; play(); paintBtns(); } else toggleHold(); }
      else if (k === 'live') { held = false; play(); paintBtns(); }
      else if (k === 'unmute') { videoEl.muted = false; prefs.muted = false; savePrefs(); paintBtns(); }
      else if (k === 'mute') toggleMute();
      else if (k === 'full') toggleFull();
      else if (k === 'pip' && videoEl) (document.pictureInPictureElement ? document.exitPictureInPicture() : videoEl.requestPictureInPicture()).catch(() => {});
      sfx('click');
      return;
    }
    const f = e.target.closest('.lv-face[data-face]');
    if (f && !e.target.closest('[data-lv-user], [data-lv-act]')) { window.openProfileView?.(f.dataset.face); return; }
    const c = e.target.closest('[data-lv-user]');
    if (c) { sfx('nav'); openStream(c.dataset.lvUser); return; }
    const b = e.target.closest('[data-lv-act]');
    if (!b) return;
    const act = b.dataset.lvAct, u = view?.user;
    sfx('click');
    if (act === 'back') { if (!window.klabNav?.back()) showList(); }
    else if (act === 'golive') openSettingsAt();
    else if (act === 'copy' && u) klabCopy(linkTo(u), 'Link');
    else if (act === 'channel' && u) window.klabOpenChannel?.(u);
    else if (act === 'profile' && u) window.openProfileView?.(u);
  });
  page.addEventListener('submit', e => { if (e.target.id === 'lvChatForm') send(e); });
  page.addEventListener('contextmenu', e => {
    if (!root || !root.contains(e.target)) return;
    const m = e.target.closest('.lv-msg');
    if (m) {
      const id = +m.dataset.id, msg = chat.msgs.find(x => x.id === id);
      if (!msg) return;
      const mine = msg.username === me() || chat.user === me();
      klabMenu(e, [
        { header: msg.username },
        { label: 'Copy text', icon: 'ti-copy', action: () => klabCopy(msg.body, 'Message') },
        { label: 'Profile', icon: 'ti-user', action: () => window.openProfileView?.(msg.username) },
        { label: 'Reply', icon: 'ti-arrow-back-up', hidden: !byUser(chat.user), action: () => { const i = $('lvChatIn'); if (i) { i.value = '@' + msg.username + ' ' + i.value; i.focus(); } } },
        '-',
        { label: 'Delete', icon: 'ti-trash', danger: true, hidden: !mine && !window.KLAB_USER?.is_admin, action: () => deleteMsg(id) },
      ]);
      return;
    }
    const c = e.target.closest('[data-lv-user]') || (e.target.closest('.lv-vp, .lv-info') && view?.user ? { dataset: { lvUser: view.user } } : null);
    if (!c) return;
    const u = c.dataset.lvUser;
    klabMenu(e, [
      { header: u },
      { label: 'Watch', icon: 'ti-player-play', hidden: view?.kind === 'watch' && view.user === u, action: () => openStream(u) },
      { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(linkTo(u), 'Link') },
      { label: 'Channel', icon: 'ti-user', action: () => window.klabOpenChannel?.(u) },
      { label: 'Profile', icon: 'ti-user-circle', action: () => window.openProfileView?.(u) },
      ...(window.KLAB_USER?.is_admin && u !== me() ? ['-', { label: 'Edit stream title…', icon: 'ti-pencil', action: () => adminRetitle(u) }] : []),
    ]);
  });
  // An admin fixing someone's title (klabnet-api PATCH /live/<user>): it
  // applies to the stream on now and the next.
  async function adminRetitle(u) {
    const cur = byUser(u)?.title || '';
    const title = await showInputDialog('Edit ' + u + '’s stream title', 'It changes for everyone watching, and for their next stream.', 'Title', cur, { maxLength: 120 });
    if (title === null) return;
    try { await getJSON(API + '/' + encodeURIComponent(u), json('PATCH', { title: title.trim() }), 8000); poll(); }
    catch (e) { showToast(e.status === 405 ? 'That needs the latest klabnet-api' : e.status === 404 || e.status === 403 ? klabCap(e.message) : 'Couldn’t change that', 'ti-alert-triangle'); }
  }

  // Keys while a stream's showing (ahead of the app's).
  window.addEventListener('keydown', e => {
    if (view?.kind !== 'watch' || !player || !showing() || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (window.klabLayers?.modal?.() || document.querySelector('.chat-modal-backdrop.open')) return;
    const k = e.key;
    if (k === ' ' && !player.contains(el) && el && el !== document.body && el.matches?.('button, a[href], [role="button"], [role="tab"], summary')) return;
    let done = true;
    if (k === ' ' || k === 'k' || k === 'K') toggleHold();
    else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'f' || k === 'F') toggleFull();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); wake(); }
  }, true);

  // The sidebar's row (ahead of 39-videos.js's own, which doesn't know it).
  nav.addEventListener('click', e => {
    const b = e.target.closest('.picker-tab[data-vid="live"]');
    if (!b) return;
    e.stopPropagation();
    sfx('click');
    showList();
    if (document.activeElement === b) b.blur();
  }, true);

  // Anything else drawn over the page stops us.
  new MutationObserver(() => { if (view && root && !page.contains(root)) leave(); }).observe(page, { childList: true });

  // ── Videos' comings and goings ──
  const prevChanged = window.klabVideosTabChanged;
  window.klabVideosTabChanged = on => {
    const link = on ? window.klabLiveLink : null;
    if (link) window.klabLiveLink = null;
    prevChanged?.(on);
    if (!on) {
      // Leaving Videos lets go of the stream (picture in picture aside).
      if (view?.kind === 'watch' && !(document.pictureInPictureElement && document.pictureInPictureElement === videoEl)) {
        const u = view.user; disconnect(); view = { kind: 'watch', user: u, parked: true };
      }
      schedule();
      return;
    }
    if (link) { openStream(link.user); return; }
    if (view?.kind === 'watch' && view.parked && root?.isConnected) { const u = view.user; view = null; openStream(u, { quiet: true }); }
    schedule();
  };
  const prevRestore = window.klabVideosRestore;
  window.klabVideosRestore = d => {
    if (d.kind !== 'live') { prevRestore?.(d); return; }
    if (!page.firstElementChild) prevRestore?.({ kind: 'list', view: { kind: 'home' } });
    restoring = true;
    try {
      if (d.view === 'watch' && d.user) { view = null; openStream(d.user, { quiet: true }); }
      else showList({ quiet: true });
    } finally { setTimeout(() => { restoring = false; }, 0); }
  };
  // From another page: as a deep link would, so Videos' own first arrival
  // (its Browse) is drawn before us, not over us.
  function open(user) {
    if (showing()) { openStream(user || ''); return; }
    window.klabLiveLink = { user: user || '' };
    setActiveTab('videos');
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); if (view?.kind === 'watch') loadChat(); } });

  // ── Settings → Streaming ──
  const sec = $('liveSettings');
  let setup = null, reveal = false, setupBusy = false;
  function paintSettingsVisible() {
    if (!sec) return;
    const was = sec.hidden;
    sec.hidden = !info.enabled;
    if (was !== sec.hidden && document.getElementById('settingsBackdrop')?.classList.contains('open')) window.buildSettingsChips?.();
  }
  const mask = k => k ? '•'.repeat(Math.min(24, k.length)) : '…';
  function paintSetup() {
    if (!sec || !setup) return;
    $('lvWhipUrl').textContent = setup.whip?.url || '—';
    $('lvRtmpUrl').textContent = setup.rtmp?.url || '—';
    $('lvWhipKey').textContent = reveal ? setup.whip?.key || '—' : mask(setup.whip?.key);
    $('lvRtmpKey').textContent = reveal ? setup.rtmp?.key || '—' : mask(setup.rtmp?.key);
    $('lvWhipKey').classList.toggle('secret', !reveal); $('lvRtmpKey').classList.toggle('secret', !reveal);
    const rv = $('lvReveal');
    rv.setAttribute('aria-pressed', String(reveal));
    rv.innerHTML = '<i class="ti ' + (reveal ? 'ti-eye-off' : 'ti-eye') + '"></i>' + (reveal ? 'Hide' : 'Show');
    const t = $('lvTitle'), g = $('lvGame');
    if (document.activeElement !== t) t.value = setup.title || '';
    if (document.activeElement !== g) g.value = setup.game || '';
    const st = $('lvStatus');
    if (!setup.online) st.textContent = 'klabnet can’t reach LiveKit right now';
    else if (setup.live) {
      const v = setup.video;
      st.innerHTML = '<span class="lv-on"><i></i>Live</span> · ' + esc(setup.via === 'whip' ? 'WHIP' : 'RTMP') +
        (v?.width ? ' · ' + v.width + '×' + v.height + (v.fps ? ' · ' + v.fps + ' fps' : '') + (v.bitrate ? ' · ' + (v.bitrate / 1e6).toFixed(1) + ' Mbps' : '') : '') +
        ' · ' + klabCount(setup.viewers || 0, 'viewer');
    } else st.textContent = setup.error ? 'Not live. Last try: ' + setup.error : 'Not live. Start streaming in OBS and press Check.';
    $('lvNotifyToggle')?.classList.toggle('on', notifyOn());
    $('lvNotifyToggle')?.setAttribute('aria-checked', String(notifyOn()));
  }
  async function loadSetup(say) {
    if (!sec || !info.enabled || setupBusy) return;
    setupBusy = true;
    const st = $('lvStatus');
    if (say && st) st.textContent = 'Checking…';
    try {
      setup = await getJSON(API + '/me', null, 15000);
      if (setup.enabled === false) { sec.hidden = true; return; }
      paintSetup();
    } catch (e) {
      if (st) st.textContent = e.status === 503 ? 'The stream server isn’t answering. Ask whoever runs klabnet.' : 'Couldn’t load your stream settings just now.';
    } finally { setupBusy = false; }
  }
  if (sec) {
    // Opening Settings fills it in.
    if (typeof openSettings === 'function') {
      const base = openSettings;
      openSettings = function () { const r = base.apply(this, arguments); if (info.enabled) loadSetup(); return r; };
    }
    $('lvCheck')?.addEventListener('click', () => { sfx('click'); poll(); loadSetup(true); });
    $('lvReveal')?.addEventListener('click', () => { sfx('click'); reveal = !reveal; paintSetup(); });
    sec.addEventListener('click', e => {
      const b = e.target.closest('[data-lv-copy]');
      if (!b || !setup) return;
      const k = b.dataset.lvCopy;
      const v = { whipUrl: setup.whip?.url, whipKey: setup.whip?.key, rtmpUrl: setup.rtmp?.url, rtmpKey: setup.rtmp?.key }[k];
      const what = { whipUrl: 'Server', whipKey: 'Bearer token', rtmpUrl: 'Server', rtmpKey: 'Stream key' }[k];
      if (v) klabCopy(v, what);
    });
    $('lvRotate')?.addEventListener('click', async () => {
      sfx('click');
      const ok = await showConfirmDialog('Make new stream keys?', 'The old ones stop working at once: a stream on them ends, and OBS needs the new ones.', 'New keys', { danger: false });
      if (!ok) return;
      try { setup = await getJSON(API + '/me/rotate', json('POST', { which: 'both' }), 15000); paintSetup(); showToast('New keys made', 'ti-refresh'); }
      catch (e) { showToast('Couldn’t make new keys', 'ti-alert-triangle'); }
    });
    let saveT = 0;
    const save = () => {
      clearTimeout(saveT);
      saveT = setTimeout(async () => {
        try {
          const r = await getJSON(API + '/me', json('PATCH', { title: $('lvTitle').value, game: $('lvGame').value }));
          if (setup) { setup.title = r.title; setup.game = r.game; }
          poll();
        } catch (e) { showToast('Couldn’t save that', 'ti-alert-triangle'); }
      }, 700);
    };
    ['lvTitle', 'lvGame'].forEach(id => {
      $(id)?.addEventListener('input', save);
      $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    });
    $('lvNotifyToggle')?.addEventListener('click', () => {
      sfx('click');
      const on = !notifyOn();
      try { localStorage.setItem(NOTIFY, on ? '1' : '0'); } catch {}
      if (on && typeof _settings !== 'undefined' && !_settings.desktopNotif) showToast('Turn on Desktop notifications too, under Notifications', 'ti-bell');
      paintSetup();
    });
  }
  function openSettingsAt() {
    const r = $('lvStatusRow');
    if (r && !sec.hidden && window.klabShowSetting) { window.klabShowSetting(r); loadSetup(true); }
    else if (typeof openSettings === 'function') openSettings();
  }

  // ── For everyone else ──
  window.klabLive = {
    open,
    list: () => info.live.slice(),
    of: u => { const s = byUser(u); return s ? { title: s.title, game: s.game, started: s.started } : null; },
    state: () => ({ enabled: info.enabled, view, phase, live: info.live.map(s => s.username), stream: view?.user || null,
      track: !!track, audio: !!audioTrack, held, blocked, muted: !!videoEl?.muted, chat: chat.msgs.length, chatStream: chat.stream }),
    stats: () => (track ? stats(track) : Promise.resolve(null)),
  };

  poll().then(() => {
    if (showing() && window.klabLiveLink) { const l = window.klabLiveLink; window.klabLiveLink = null; openStream(l.user); }
  });
  schedule();
})();
