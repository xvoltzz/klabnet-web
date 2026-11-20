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
//    · The guide (programs): anyone schedules a block of videos on a
//      channel at a set start; while it's on the channel plays it from its
//      start, and outside programs the loop runs on its epoch as if they
//      weren't there. Channels' page is a List or a Guide (a time grid);
//      a program has a sheet, Remind me (klabnet_tv_remind) and a menu.
//  window.klabTv: channels(), open(id), now() (for presence's beat),
//  programs(), schedule(o), reminders().
//  Deep links: #videos/tv (Channels), #videos/tv/<number>, #videos/tv/guide,
//  #videos/tv/p/<program id>.
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

  // ── Remind me (per device: klabnet_tv_remind, { programId: { start,
  // title, channel, number } }). One timer for the soonest; when it comes,
  // a toast with Watch, and a desktop notification (klabDesktopNotify
  // minds Do not disturb and the setting). Only while a page is open.
  const REMIND = 'klabnet_tv_remind';
  let reminds = (() => { try { return JSON.parse(localStorage.getItem(REMIND) || '{}') || {}; } catch { return {}; } })();
  const saveReminds = () => { try { localStorage.setItem(REMIND, JSON.stringify(reminds)); } catch {} };
  const reminded = id => !!reminds[id];
  let remindT = 0;
  function armReminders() {
    clearTimeout(remindT);
    const t = now();
    let soonest = Infinity, changed = false;
    for (const [id, r] of Object.entries(reminds)) {
      if (!(r.start > t - 600)) { delete reminds[id]; changed = true; } else soonest = Math.min(soonest, r.start);
    }
    if (changed) saveReminds();
    if (soonest < Infinity) remindT = setTimeout(fireReminders, Math.min(2147483000, Math.max(0, (soonest - t) * 1000 + 400)));
  }
  function fireReminders() {
    const t = now();
    for (const [id, r] of Object.entries(reminds)) {
      if (r.start > t + 1) continue;
      delete reminds[id];
      if (r.start < t - 600) continue;
      const watch = () => openChannel(r.channel);
      showToast('“' + r.title + '” is on now, channel ' + r.number, 'ti-device-tv', { action: { label: 'Watch', run: watch }, ms: 15000 });
      window.klabDesktopNotify?.({ title: 'On now on channel ' + r.number, body: r.title, tag: 'tv-' + id, onClick: watch });
    }
    saveReminds();
    armReminders();
    refreshMarks();
  }
  function toggleRemind(p) {
    if (reminds[p.id]) { delete reminds[p.id]; showToast('Reminder off', 'ti-bell-off'); }
    else {
      reminds[p.id] = { start: p.start, title: p.title, channel: p.channelId, number: p.channelNumber ?? byId(p.channelId)?.number ?? '' };
      showToast('You’ll get a reminder when “' + p.title + '” starts', 'ti-bell');
    }
    saveReminds();
    armReminders();
    refreshMarks();
  }
  // Programs that moved (or went) since a reminder was set: `list` is
  // everything that starts in [from, to).
  function checkReminders(list, from, to) {
    let changed = false;
    const t = now();
    for (const [id, r] of Object.entries(reminds)) {
      const p = list.find(x => x.id === id);
      if (p) { if (p.start !== r.start || p.title !== r.title) { r.start = p.start; r.title = p.title; changed = true; } }
      else if (from != null && r.start >= from && r.start < to && r.start > t + 5) { delete reminds[id]; changed = true; }
    }
    if (changed) { saveReminds(); armReminders(); }
  }

  // ── Channels ──
  let channels = [], loadedAt = 0, loadedSrv = 0, loading = null;
  const byId = id => channels.find(c => c.id === id);
  const byNumber = n => channels.find(c => c.number === n);
  function load(force) {
    if (!force && channels.length && Date.now() - loadedAt < 20000) return Promise.resolve(channels);
    return loading ||= getJSON(API, null, 10000).then(d => {
      channels = d.channels || [];
      loadedAt = Date.now();
      loadedSrv = d.now || 0;
      checkReminders(channels.flatMap(c => c.programs || []), d.now, d.now + 36 * 3600);
      if (!offsetAt) offset = d.now * 1000 - Date.now();
      return channels;
    }).catch(() => channels).finally(() => { loading = null; });
  }
  // The loop alone at `t` (server seconds): the item on, how far in, and
  // what's next. `key` names this airing (which loop, which slot), so a
  // one-video channel still rolls over at its end.
  function loopAiring(c, t) {
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
          next: items[ni], nextKey: (ni === 0 ? loop + 1 : loop) + ':' + ni, nextAt: 0, total };
      }
      start += d;
    }
    return null;
  }
  // Programs (the guide): a block scheduled at a set start, played from
  // there for everyone. What one plays is the API's call (`plays`: once it
  // has started, what was ready at its start).
  const plays = p => (p?.items || []).filter(i => i.plays && i.hls && (i.duration || 0) > 0.5);
  const playEnd = p => p.start + plays(p).reduce((a, i) => a + (i.duration || 0), 0);
  const programAt = (c, t) => (c?.programs || []).find(p => p.start <= t && t < playEnd(p)) || null;
  const programAfter = (c, t) => (c?.programs || []).filter(p => p.start > t && plays(p).length).sort((a, b) => a.start - b.start)[0] || null;
  // Where a channel is at `t`: a program that's on, from its start; else
  // the loop, cut short by a program coming and picked up after it where
  // it would have been (it doesn't restart). `program` is the one on,
  // `nextProgram` the one the next airing belongs to, `upcoming` the next
  // program at all. `nextAt` is how far into the next airing it starts.
  function airing(c, t) {
    if (!c) return null;
    const p = programAt(c, t);
    if (p) {
      const list = plays(p);
      let start = p.start;
      for (let i = 0; i < list.length; i++) {
        const it = list[i], d = it.duration || 0;
        if (t < start + d || i === list.length - 1) {
          const end = start + d;
          let next = null, nextKey = '', nextAt = 0, nextProgram = p;
          if (i + 1 < list.length) { next = list[i + 1]; nextKey = 'p' + p.id + ':' + next.pos; }
          else {
            const after = airing(c, end + 0.01);
            if (after) { next = after.item; nextKey = after.key; nextAt = after.off; nextProgram = after.program; }
          }
          return { i, item: it, off: t - start, left: end - t, key: 'p' + p.id + ':' + it.pos, next, nextKey, nextAt,
            program: p, nextProgram: next ? nextProgram : null, upcoming: programAfter(c, t), part: i + 1, parts: list.length };
        }
        start += d;
      }
    }
    const a = loopAiring(c, t);
    if (!a) return null;
    a.program = null;
    a.upcoming = programAfter(c, t);
    a.nextProgram = null;
    const np = a.upcoming;
    if (np && np.start - t < a.left) {
      const first = plays(np)[0];
      a.left = np.start - t;
      a.next = first; a.nextKey = 'p' + np.id + ':' + first.pos; a.nextAt = 0; a.nextProgram = np;
    }
    return a;
  }
  // How far along the thing on is: the program as a whole, or the item.
  function span(a, t) {
    if (a.program) { const len = playEnd(a.program) - a.program.start; return { off: t - a.program.start, len, left: playEnd(a.program) - t }; }
    return { off: a.off, len: a.item.duration || 1, left: a.left };
  }
  const onTitle = a => (a.program ? a.program.title : a.item.title) || 'Untitled';
  // Times on this computer's clock (server seconds in).
  const clock = t => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function dayName(t) {
    const d = new Date(t * 1000), today = new Date();
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const when = p => dayName(p.start) + ', ' + clock(p.start) + '–' + clock(p.end);
  const by = u => (u === me() ? 'you' : u);

  // ── State ──
  let view = null; // null, { kind: 'guide' } or { kind: 'watch', id }
  let root = null;
  let restoring = false;
  function setRow(on) {
    nav.querySelectorAll('.picker-tab[data-vid]').forEach(b => b.classList.toggle('active', on && b.dataset.vid === 'channels'));
  }
  function take() {
    // Videos lets go of the page (its player, its lists loading). A channel
    // that's on goes to the mini player (klabTvSoftLeave, from Videos).
    window.klabVideosLeave?.();
    if (where === 'page') stopPlayer();
  }
  function record(desc) {
    if (restoring) return;
    window.klabNav?.push({ tab: 'videos', kind: 'tv', ...desc });
  }

  // ── The guide ──
  const LOADING = '<div class="k-empty vid-empty"><i class="ti ti-loader loading-spinner"></i><div>Loading…</div></div>';
  async function showGuide(opts) {
    const o = opts || {};
    if (o.mode) { mode = o.mode; try { localStorage.setItem('klabnet_tv_view', mode); } catch {} }
    if (!showing()) setActiveTab('videos');
    take();
    view = { kind: 'guide' };
    setRow(true);
    if (!o.quiet) record({ view: 'guide' });
    page.innerHTML = '<div class="tv-root tv-guide">' +
      '<div class="k-page-head"><h2 class="k-page-title">Channels</h2><span class="k-page-count" id="tvCount"></span>' +
        '<div class="k-page-actions">' +
          '<div class="k-seg tv-view-seg" id="tvViewSeg" role="group" aria-label="Show channels as">' +
            '<button type="button" data-tv-mode="list" aria-pressed="' + (mode === 'list') + '">List</button>' +
            '<button type="button" data-tv-mode="grid" aria-pressed="' + (mode === 'grid') + '">Guide</button></div>' +
          '<button type="button" class="k-btn" data-tv-act="schedule" title="Schedule a program"><i class="ti ti-clock"></i><span>Schedule</span></button>' +
          '<button type="button" class="k-btn" data-tv-act="new" title="New channel"><i class="ti ti-plus"></i><span>New channel</span></button></div></div>' +
      '<div class="tv-list" id="tvList">' + LOADING + '</div></div>';
    root = page.firstElementChild;
    if (panel()) panel().scrollTop = 0;
    klabEnter(page);
    await Promise.all([load(true), mode === 'grid' ? loadPrograms() : null]);
    if (view?.kind !== 'guide' || !root?.isConnected) return;
    paintGuide();
    startTicks();
    if (o.program) openProgram(o.program);
  }
  // List or Guide (the grid), remembered on this device.
  let mode = (() => { try { return localStorage.getItem('klabnet_tv_view') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } })();
  async function setMode(m) {
    if (m === mode) return;
    mode = m;
    try { localStorage.setItem('klabnet_tv_view', m); } catch {}
    $('tvViewSeg')?.querySelectorAll('[data-tv-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tvMode === m)));
    const el = $('tvList');
    if (!el) return;
    gSig = '';
    if (m === 'grid' && !programsAt) { el.innerHTML = LOADING; await loadPrograms(); }
    if (view?.kind !== 'guide' || mode !== m) return;
    paintGuide();
    klabEnter(el);
  }
  function rowHTML(c) {
    const t = now(), a = airing(c, t), sp = a && span(a, t);
    const art = coverUrl(c) || a?.item.posterSmall || '';
    return '<button type="button" class="tv-row" data-tv-id="' + esc(c.id) + '" style="--tv-c:' + esc(c.color || 'var(--text-dimmer)') + '" data-silent>' +
      '<span class="tv-num">' + c.number + '</span>' +
      '<span class="tv-art">' + (art ? '<img src="' + esc(art) + '" alt="" loading="lazy" draggable="false" />' : '<i class="ti ti-device-tv"></i>') + '</span>' +
      '<span class="tv-row-tx">' +
        '<span class="tv-name">' + esc(c.name) + '</span>' +
        (a ? '<span class="tv-now">' + (a.program ? '<i class="ti ti-clock tv-prog-mark" title="Scheduled"></i>' : '') + '<span class="tv-now-t">' + esc(onTitle(a)) + '</span><span class="tv-left" data-left>' + dur(sp.left) + ' left</span></span>' +
             '<span class="tv-bar"><b data-bar style="transform:scaleX(' + (sp.off / sp.len).toFixed(4) + ')"></b></span>' +
             '<span class="tv-next">' + esc(nextWords(c, a)) + '</span>'

          : '<span class="tv-now tv-dim">' + (c.count ? 'Getting ready. Its videos are still processing.' : 'Nothing in the lineup yet.') + '</span>') +
      '</span>' +
      '<span class="tv-faces">' + (c.watchers || []).slice(0, 4).map(face).join('') + '</span>' +
    '</button>';
  }
  // The row's foot: what's after this, a program's maker, or the loop.
  function nextWords(c, a) {
    if (a.program) return 'Scheduled by ' + by(a.program.createdBy) + (a.parts > 1 ? ' · ' + a.part + ' of ' + a.parts + ': ' + (a.item.title || 'Untitled') : '');
    if (a.nextProgram) return 'Next · ' + a.nextProgram.title + ' at ' + clock(a.nextProgram.start);
    if (a.upcoming && a.upcoming.start - now() < 6 * 3600) return (c.items.length > 1 ? 'Next · ' + (a.next?.title || 'Untitled') + ' · ' : '') + a.upcoming.title + ' at ' + clock(a.upcoming.start);
    return c.items.length > 1 ? 'Next · ' + (a.next?.title || 'Untitled') : 'On a loop';
  }
  function paintGuide() {
    const el = $('tvList');
    if (!el) return;
    el.classList.toggle('is-grid', mode === 'grid');
    const count = $('tvCount');
    if (count) count.textContent = channels.length ? klabCount(channels.length, 'channel') : '';
    if (server === false) { el.innerHTML = '<div class="k-empty vid-empty"><i class="ti ti-device-tv"></i><div>Channels need the latest klabnet-api.</div></div>'; return; }
    if (!channels.length) {
      el.innerHTML = '<div class="k-empty vid-empty"><i class="ti ti-device-tv"></i><div>No channels yet.</div>' +
        '<button type="button" class="k-btn" data-tv-act="new"><i class="ti ti-plus"></i><span>New channel</span></button></div>';
      return;
    }
    if (mode === 'grid') { paintGrid(el); return; }
    gSig = '';
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
      Promise.all([load(true), view.kind === 'guide' && mode === 'grid' ? loadPrograms() : null])
        .then(() => { if (view?.kind === 'guide') paintGuide(); else if (view?.kind === 'watch') paintSide(); });
    }
    const t = now();
    if (view.kind === 'guide' && mode === 'grid') { gridTick(t); return; }
    if (view.kind === 'guide') {
      const el = $('tvList');
      if (!el) return;
      const keys = channels.map(c => airing(c, t)?.key || '').join('|');
      if (keys !== el._keys) { paintGuide(); return; }
      el.querySelectorAll('.tv-row').forEach(row => {
        const a = airing(byId(row.dataset.tvId), t);
        if (!a) return;
        const sp = span(a, t);
        const b = row.querySelector('[data-bar]'), l = row.querySelector('[data-left]');
        if (b) b.style.transform = 'scaleX(' + (sp.off / sp.len).toFixed(4) + ')';
        if (l) l.textContent = dur(sp.left) + ' left';
      });
    } else if (view.kind === 'watch') paintInfo();
  }

  // ── The guide as a grid: channels down, time across ──
  // From the last half hour before now−30min to a day ahead, 6px a minute.
  // The loop is a quiet band (its videos as faint blocks where they're
  // wide enough to name); programs are solid blocks in the channel's
  // colour. Drawn again only when something in it changed, or every half
  // hour as the window moves; the now line moves every 30s, no animation.
  const PX_MIN = 6, AHEAD = 24 * 3600;
  let gFrom = 0, gTo = 0, gSig = '', gNowAt = 0;
  let programs = [], programsAt = 0;
  const gx = t => (t - gFrom) / 60 * PX_MIN;
  function loadPrograms() {
    const t = now();
    return getJSON(API + '/programs?from=' + Math.floor(t - 3600) + '&to=' + Math.ceil(t + AHEAD + 3600), null, 10000)
      .then(d => { programs = d.programs || []; programsAt = Date.now(); checkReminders(programs, d.from, d.to); return programs; })
      .catch(() => programs);
  }
  const progById = id => programs.find(p => p.id === id) || channels.flatMap(c => c.programs || []).find(p => p.id === id) || null;
  // The loop's airings over [from, to), less the time programs hold.
  function loopSegs(c, from, to, busy) {
    const out = [], items = c.items || [];
    const total = items.reduce((a, i) => a + (i.duration || 0), 0);
    if (!total) return out;
    const a = loopAiring(c, from);
    let i = a.i, s = from - a.off, n = 0;
    while (s < to && n++ < 6000) {
      const it = items[i], e = s + (it.duration || 0);
      let pieces = [[Math.max(s, from), Math.min(e, to)]];
      for (const b of busy) pieces = pieces.flatMap(([x, y]) => (b.start >= y || b.end <= x) ? [[x, y]] : [[x, Math.min(y, b.start)], [Math.max(x, b.end), y]].filter(([u, v]) => v - u > 1));
      for (const [x, y] of pieces) if (gx(y) - gx(x) >= 26) out.push({ s: x, e: y, item: it });
      s = e; i = (i + 1) % items.length;
    }
    return out;
  }
  // Dark ink on a light channel colour, white on the rest.
  function ink(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16), lin = v => { v /= 255; return v <= 0.04 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.36 ? '#121212' : '#fff';
  }
  function progBlock(p, t) {
    const x = gx(Math.max(p.start, gFrom)), w = Math.max(8, gx(p.end) - x);
    const cls = p.end <= t ? ' past' : p.start <= t ? ' on' : '';
    // The part already shown is shaded inside the block, under its title
    // (the grid's own shade stays under programs, so a title is never dimmed).
    const past = Math.min(w, Math.max(0, gx(t) - x));
    return '<button type="button" class="tv-g-prog' + cls + '" data-tv-prog="' + esc(p.id) + '" data-s="' + p.start + '" tabindex="-1"' +
      ' style="left:' + x.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;--past:' + past.toFixed(1) + 'px" aria-label=""' + esc(p.title + ', ' + when(p) + ', scheduled by ' + by(p.createdBy)) + '" data-silent>' +
      '<b>' + (reminded(p.id) ? '<i class="ti ti-bell" aria-hidden="true"></i>' : '') + esc(p.title) + '</b>' +
      (w >= 110 ? '<span>' + esc(clock(p.start)) + ' · ' + esc(by(p.createdBy)) + '</span>' : '') + '</button>';
  }
  function paintGrid(el, force) {
    const t = now();
    const from = Math.floor((t - 1800) / 1800) * 1800;
    const sig = from + '|' + channels.map(c => c.id + c.number + c.name + c.color + c.epoch + c.total).join(',') + '|' +
      programs.map(p => p.id + p.start + p.end + p.title + p.channelId + reminded(p.id)).join(',');
    if (!force && sig === gSig && el.querySelector('.tv-g')) { moveNow(); return; }
    // Drawn again: the same time stays at the left edge, the same thing keeps the keyboard.
    const old = el.querySelector('.tv-g-scroll');
    const keepT = old ? gFrom + old.scrollLeft / PX_MIN * 60 : null;
    const keepY = old ? old.scrollTop : 0;
    const ae = document.activeElement;
    const focusId = ae?.closest?.('.tv-g-prog')?.dataset.tvProg || '';
    const focusHead = ae?.closest?.('.tv-g-head')?.dataset.tvId || '';
    gSig = sig;
    gFrom = from; gTo = from + AHEAD + 3600;
    const W = Math.ceil(gx(gTo));
    let ticks = '';
    for (let x = from; x < gTo; x += 1800) {
      const d = new Date(x * 1000), day = d.getHours() === 0 && d.getMinutes() === 0;
      // Each tick spans its half hour; its label sticks inside the grid's
      // left edge (past the channel column) until the next one.
      ticks += '<span class="tv-g-tick' + (d.getMinutes() === 0 ? ' hour' : '') + (day ? ' day' : '') + '" style="left:' + gx(x) + 'px;width:' + (gx(x + 1800) - gx(x)) + 'px">' +
        '<em>' + (day ? '<b>' + esc(dayName(x)) + '</b> ' : '') + esc(clock(x)) + '</em></span>';
    }
    const rows = channels.map(c => {
      const ps = programs.filter(p => p.channelId === c.id);
      const loops = loopSegs(c, from, gTo, ps);
      return '<div class="tv-g-row" data-row="' + esc(c.id) + '" style="--tv-c:' + esc(c.color || 'var(--text-dimmer)') + ';--tv-ink:' + ink(c.color) + '">' +
        '<button type="button" class="tv-g-head" data-tv-id="' + esc(c.id) + '" title="Watch ' + esc(c.name) + '" data-silent>' +
          '<span class="tv-num">' + c.number + '</span><span class="tv-g-name">' + esc(c.name) + '</span></button>' +
        '<div class="tv-g-lane" data-lane="' + esc(c.id) + '" title="">' +
          (c.total ? '<div class="tv-g-band"></div>' : '') +
          loops.map(l => {
            const w = gx(l.e) - gx(l.s);
            return '<div class="tv-g-loop" data-loop="' + l.item.id + '" data-s="' + l.s + '" data-e="' + l.e + '" style="left:' + gx(l.s).toFixed(1) + 'px;width:' + w.toFixed(1) + 'px">' +
              (w >= 70 ? '<span>' + esc(l.item.title || 'Untitled') + '</span>' : '') + '</div>';
          }).join('') +
          ps.map(p => progBlock(p, t)).join('') +
        '</div></div>';
    }).join('');
    el.innerHTML = '<div class="tv-g" style="--g-w:' + W + 'px">' +
      '<div class="tv-g-bar"><button type="button" class="k-btn sm" data-tv-act="now"><i class="ti ti-clock"></i><span>Now</span></button>' +
        '<span class="tv-g-hint">Press free time on a channel to schedule something there.</span></div>' +
      '<div class="tv-g-scroll" tabindex="-1">' +
        '<div class="tv-g-inner">' +
          '<div class="tv-g-times"><span class="tv-g-corner"></span><div class="tv-g-scale">' + ticks + '<span class="tv-g-nowtag"></span></div></div>' +
          rows +
          '<div class="tv-g-past"></div><div class="tv-g-now"></div>' +
        '</div></div>' +
      '<div class="tv-g-tip" hidden></div></div>';
    const sc = el.querySelector('.tv-g-scroll');
    moveNow();
    sc.scrollLeft = keepT != null ? Math.max(0, gx(keepT)) : Math.max(0, gx(t - 1800));
    sc.scrollTop = keepY;
    // The first program from now on each row is the one Tab-less arrows start from.
    el.querySelectorAll('.tv-g-row').forEach(r => {
      const first = [...r.querySelectorAll('.tv-g-prog')].find(b => !b.classList.contains('past'));
      (first || r.querySelector('.tv-g-head')).tabIndex = 0;
    });
    const back = (focusId && el.querySelector('[data-tv-prog="' + CSS.escape(focusId) + '"]')) || (focusHead && el.querySelector('.tv-g-head[data-tv-id="' + CSS.escape(focusHead) + '"]'));
    if (back) back.focus({ preventScroll: true });
    wireGrid(el.querySelector('.tv-g'));
  }
  function moveNow() {
    const g = $('tvList')?.querySelector('.tv-g');
    if (!g) return;
    const t = now(), x = gx(t);
    g.querySelector('.tv-g-now').style.transform = 'translateX(' + x.toFixed(1) + 'px)';
    const tag = g.querySelector('.tv-g-nowtag');
    tag.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
    tag.textContent = clock(t);
    g.querySelector('.tv-g-past').style.width = Math.max(0, x).toFixed(1) + 'px';
    g.querySelectorAll('.tv-g-prog').forEach(b => {
      const p = progById(b.dataset.tvProg);
      if (!p) return;
      b.classList.toggle('past', p.end <= t);
      b.classList.toggle('on', p.start <= t && t < p.end);
      const left = parseFloat(b.style.left) || 0, w = parseFloat(b.style.width) || 0;
      b.style.setProperty('--past', Math.min(w, Math.max(0, x - left)).toFixed(1) + 'px');
    });
    gNowAt = Date.now();
  }
  function gridTick(t) {
    if (Math.floor((t - 1800) / 1800) * 1800 !== gFrom) { const el = $('tvList'); if (el) paintGrid(el); return; }
    if (Date.now() - gNowAt >= 30000) moveNow();
  }
  // Hover and focus: a little card of what it is. The arrows, Enter.
  function wireGrid(g) {
    const sc = g.querySelector('.tv-g-scroll'), tip = g.querySelector('.tv-g-tip');
    const hide = () => { tip.hidden = true; };
    // A time label sticks at the left edge until its half hour runs out;
    // the last few pixels of that it's hidden rather than shown half cut.
    const ticks = [...g.querySelectorAll('.tv-g-tick')].map(el => ({ em: el.firstElementChild, l: parseFloat(el.style.left) || 0, w: parseFloat(el.style.width) || 0 }));
    const clampTicks = () => {
      const sl = sc.scrollLeft;
      for (const k of ticks) {
        if (!k.em) continue;
        const cut = k.l < sl && k.l + k.w - sl < (k.ew ||= k.em.offsetWidth) + 14;
        if (k.cut !== cut) { k.cut = cut; k.em.style.visibility = cut ? 'hidden' : ''; }
      }
    };
    sc.addEventListener('scroll', clampTicks, { passive: true });
    clampTicks();
    function show(el) {
      let html = '';
      if (el.matches('.tv-g-prog')) {
        const p = progById(el.dataset.tvProg), c = p && byId(p.channelId);
        if (!p) return hide();
        const n = (p.items || []).length;
        html = '<b>' + esc(p.title) + '</b><span>' + esc(when(p)) + ' · ' + long(p.end - p.start) + '</span>' +
          '<span>' + (c ? c.number + ' · ' + esc(c.name) + ' · ' : '') + klabCount(n, 'video') + '</span>' +
          '<span>Scheduled by ' + esc(by(p.createdBy)) + '</span>' + (p.note ? '<span class="tv-g-tip-note">' + esc(p.note) + '</span>' : '');
      } else {
        const c = byId(el.closest('[data-lane]')?.dataset.lane), it = c && (c.items || []).find(x => String(x.id) === el.dataset.loop);
        if (!it) return hide();
        html = '<b>' + esc(it.title || 'Untitled') + '</b><span>' + esc(clock(+el.dataset.s)) + '–' + esc(clock(+el.dataset.e)) + ' · on the loop</span>';
      }
      tip.innerHTML = html;
      tip.hidden = false;
      const gb = g.getBoundingClientRect(), r = el.getBoundingClientRect(), sb = sc.getBoundingClientRect();
      const left = Math.max(sb.left, Math.min(r.left, sb.right - tip.offsetWidth));
      const below = r.bottom + 6 + tip.offsetHeight < window.innerHeight;
      tip.style.left = (left - gb.left) + 'px';
      tip.style.top = (below ? r.bottom - gb.top + 6 : r.top - gb.top - tip.offsetHeight - 6) + 'px';
    }
    sc.addEventListener('pointerover', e => {
      const el = e.target.closest('.tv-g-prog, .tv-g-loop');
      if (el && e.pointerType !== 'touch') show(el); else hide();
    });
    sc.addEventListener('pointerleave', hide);
    sc.addEventListener('click', hide);
    sc.addEventListener('scroll', hide, { passive: true });
    sc.addEventListener('focusin', e => { const el = e.target.closest('.tv-g-prog'); if (el) show(el); else hide(); });
    sc.addEventListener('focusout', hide);
    // A plain wheel goes across when there's nothing to scroll down.
    sc.addEventListener('wheel', e => {
      if (e.shiftKey || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || sc.scrollHeight > sc.clientHeight + 1) return;
      e.preventDefault();
      sc.scrollLeft += e.deltaY;
    }, { passive: false });
    sc.addEventListener('keydown', e => {
      const cur = e.target.closest('.tv-g-prog, .tv-g-head');
      if (!cur || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
      const row = cur.closest('.tv-g-row');
      const stops = r => [r.querySelector('.tv-g-head'), ...[...r.querySelectorAll('.tv-g-prog')].sort((a, b) => a.dataset.s - b.dataset.s)];
      let to = null;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
        const list = stops(row), i = list.indexOf(cur);
        to = k === 'Home' ? list[0] : k === 'End' ? list[list.length - 1] : list[i + (k === 'ArrowRight' ? 1 : -1)];
      } else {
        const rows = [...sc.querySelectorAll('.tv-g-row')], r = rows[rows.indexOf(row) + (k === 'ArrowDown' ? 1 : -1)];
        if (r) {
          if (cur.matches('.tv-g-head')) to = r.querySelector('.tv-g-head');
          else {
            // The program on that row nearest in time, else its name.
            const at = +cur.dataset.s, ps = [...r.querySelectorAll('.tv-g-prog')];
            to = ps.sort((a, b) => Math.abs(a.dataset.s - at) - Math.abs(b.dataset.s - at))[0] || r.querySelector('.tv-g-head');
          }
        }
      }
      e.preventDefault();
      e.stopPropagation();
      if (!to) return;
      sc.querySelectorAll('[tabindex="0"]').forEach(x => { if (x !== to) x.tabIndex = -1; });
      to.tabIndex = 0;
      to.focus({ preventScroll: true });
      // Into view, clear of the sticky names on the left.
      const sb = sc.getBoundingClientRect(), r = to.getBoundingClientRect();
      const head = sc.querySelector('.tv-g-head')?.offsetWidth || 0;
      if (!to.matches('.tv-g-head')) {
        if (r.left < sb.left + head) sc.scrollLeft -= sb.left + head - r.left + 16;
        else if (r.left > sb.right - 120) sc.scrollLeft += r.left - (sb.right - 120) + Math.min(r.width, 200);
      }
      if (r.top < sb.top + 30) sc.scrollTop -= sb.top + 30 - r.top;
      else if (r.bottom > sb.bottom) sc.scrollTop += r.bottom - sb.bottom;
    });
  }
  // Pressing free time on a row: schedule there, to the nearest 5 minutes.
  function laneTime(lane, clientX) {
    let t = gFrom + (clientX - lane.getBoundingClientRect().left) / PX_MIN * 60;
    t = Math.round(t / 300) * 300;
    const n = now();
    return t < n ? Math.ceil(n / 300) * 300 : t;
  }
  // Something changed (a program made, edited, gone, a reminder): the
  // lists again, then whatever's showing.
  async function reloadPrograms() {
    await Promise.all([load(true), loadPrograms()]);
    refresh();
  }
  function refreshMarks() {
    if (view?.kind === 'guide' && mode === 'grid') { const el = $('tvList'); if (el) paintGrid(el); }
  }

  // ── A program: its sheet ──
  async function openProgram(id) {
    let p = progById(id);
    if (!p) {
      try { p = await getJSON(API + '/programs/' + encodeURIComponent(id), null, 10000); }
      catch (e) { showToast(e.status === 404 ? 'That program’s gone' : 'Couldn’t load it: ' + e.message, 'ti-device-tv'); return; }
    }
    programSheet(p);
  }
  function programSheet(p) {
    const c = byId(p.channelId), t = now();
    const on = p.start <= t && t < p.end, past = p.end <= t;
    const status = i => i.plays ? dur(i.duration) : p.start <= t ? 'Skipped: it wasn’t ready' : i.status === 'failed' ? 'Couldn’t process it' : 'Processing · plays if it’s ready by the start';
    const canEdit = p.canEdit && !past;
    openChatModal(p.title, '<div class="tv-sheet" id="tvSheet">' +
      '<div class="tv-sheet-when"><span class="tv-chip" style="--tv-c:' + esc(c?.color || 'var(--text-dimmer)') + '">' + (c ? c.number : '?') + '</span>' +
        '<div class="tv-info-tx"><b>' + esc(when(p)) + '</b><span class="tv-sub">' + (c ? esc(c.name) + ' · ' : '') + long(p.end - p.start) + '</span></div></div>' +
      '<div class="tv-sheet-state' + (on ? ' on' : '') + '">' +
        (on ? '<i></i>On now · ' + long(p.end - t) + ' left' : past ? 'Ended' : 'Starts in ' + long(p.start - t)) + '</div>' +
      (p.note ? '<p class="tv-sheet-note">' + esc(p.note) + '</p>' : '') +
      '<div class="k-label">Videos</div>' +
      '<div class="tv-lineup tv-sheet-list">' + (p.items || []).map((x, i) =>
        '<div class="tv-li tv-li-ro' + (x.plays ? '' : ' skip') + '"><span class="tv-li-n">' + (i + 1) + '</span>' +
          '<span class="tv-li-thumb">' + (x.posterSmall ? '<img src="' + esc(x.posterSmall) + '" alt="" draggable="false" />' : '<i class="ti ti-movie"></i>') + '</span>' +
          '<span class="tv-li-tx"><span class="tv-li-t">' + esc(x.title || 'Untitled') + '</span><span class="tv-li-s">' + esc(status(x)) + '</span></span></div>').join('') + '</div>' +
      '<div class="tv-sheet-by">' + face(p.createdBy) + '<span>Scheduled by <b>' + esc(by(p.createdBy)) + '</b></span></div>' +
      '<div class="dlg-actions">' +
        (canEdit || p.canEdit ? '<div class="tv-sheet-own">' +
          (canEdit ? '<button type="button" class="k-btn" data-ps="edit"><i class="ti ti-pencil"></i><span>Edit</span></button>' : '') +
          '<button type="button" class="k-btn danger" data-ps="delete"><i class="ti ti-trash"></i><span>Delete</span></button></div>' : '') +
        (!past && !on ? '<button type="button" class="k-btn" data-ps="remind" aria-pressed="' + reminded(p.id) + '"><i class="ti ' + (reminded(p.id) ? 'ti-bell-off' : 'ti-bell') + '"></i><span>' + (reminded(p.id) ? 'Don’t remind me' : 'Remind me') + '</span></button>' : '') +
        (on ? '<button type="button" class="k-btn primary" data-ps="watch"><i class="ti ti-player-play-filled"></i><span>Watch now</span></button>'
            : '<button type="button" class="k-btn primary" data-dlg-cancel>Done</button>') +
      '</div></div>');
    const sheet = $('tvSheet');
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-ps]');
      if (!b) return;
      const k = b.dataset.ps;
      if (k === 'watch') { closeChatModal(); openChannel(p.channelId); }
      else if (k === 'remind') { toggleRemind(p); programSheet(progById(p.id) || p); }
      else if (k === 'edit') scheduleDialog({ program: p });
      else if (k === 'delete') deleteProgram(p);
    });
  }
  function programMenu(p) {
    const t = now(), on = p.start <= t && t < p.end, past = p.end <= t;
    const c = byId(p.channelId);
    return [
      { header: p.title },
      { label: on ? 'Watch' : 'Watch channel ' + (c?.number ?? ''), icon: 'ti-player-play', hidden: !c, action: () => openChannel(p.channelId) },
      { label: 'Details', icon: 'ti-list-details', action: () => programSheet(p) },
      { label: reminded(p.id) ? 'Don’t remind me' : 'Remind me', icon: reminded(p.id) ? 'ti-bell-off' : 'ti-bell', hidden: on || past, action: () => toggleRemind(p) },
      { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(location.origin + location.pathname + '#videos/tv/p/' + p.id, 'Link') },
      '-',
      { label: 'Edit program', icon: 'ti-pencil', hidden: !p.canEdit || past, action: () => scheduleDialog({ program: p }) },
      { label: 'Delete program', icon: 'ti-trash', danger: true, hidden: !p.canEdit, action: () => deleteProgram(p) },
    ];
  }
  async function deleteProgram(p) {
    const on = p.start <= now() && now() < p.end;
    if (!(await showConfirmDialog('Delete this program?', '“' + p.title + '” comes off the guide for everyone.' + (on ? ' The channel goes back to its loop.' : ''), 'Delete'))) return;
    try {
      await getJSON(API + '/programs/' + encodeURIComponent(p.id), { method: 'DELETE' }, 15000);
      if (reminds[p.id]) { delete reminds[p.id]; saveReminds(); armReminders(); }
      programs = programs.filter(x => x.id !== p.id);
      showToast('Program deleted', 'ti-trash');
      reloadPrograms();
    } catch (e) { showToast('Couldn’t delete it: ' + e.message, 'ti-alert-triangle'); }
  }

  // ── Schedule a program (and edit one) ──
  function scheduleDialog(o) {
    if (server === false) { showToast('Channels need the latest klabnet-api', 'ti-device-tv'); return; }
    if (!channels.length) { showToast('Make a channel first', 'ti-device-tv'); return; }
    const p = o?.program || null;
    const t0 = now();
    const live = !!p && p.start <= t0;
    let c = (p && byId(p.channelId)) || o?.channel || byId(view?.kind === 'watch' ? view.id : '') || channels[0];
    const start0 = p ? p.start : o?.start || Math.ceil((t0 + 600) / 300) * 300;
    // Days: today and the next 29, as local midnights.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return d; });
    const d0 = new Date(start0 * 1000);
    const dayIdx = Math.max(0, days.findIndex(d => d.getFullYear() === d0.getFullYear() && d.getMonth() === d0.getMonth() && d.getDate() === d0.getDate()));
    const hhmm = String(d0.getHours()).padStart(2, '0') + ':' + String(d0.getMinutes()).padStart(2, '0');
    const sorted = [...channels].sort((a, b) => a.number - b.number);
    const lock = live ? ' disabled' : '';
    openChatModal(p ? 'Edit program' : 'Schedule a program', `
      <form class="tv-form" id="tvPForm" autocomplete="off">
        <div class="tv-when-grid">
          <label class="k-form-label" for="tvPChan">Channel</label>
          <label class="k-form-label" for="tvPDay">Day</label>
          <label class="k-form-label" for="tvPTime">Time</label>
          <select class="k-field" id="tvPChan"${lock}>${sorted.map(x => '<option value="' + esc(x.id) + '"' + (x.id === c.id ? ' selected' : '') + '>' + x.number + ' · ' + esc(x.name) + '</option>').join('')}</select>
          <select class="k-field" id="tvPDay"${lock}>${days.map((d, i) => '<option value="' + i + '"' + (i === dayIdx ? ' selected' : '') + '>' + esc(i < 2 ? dayName(d / 1000) : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + '</option>').join('')}</select>
          <input class="k-field" id="tvPTime" type="time" step="300" required value="${hhmm}"${lock} />
        </div>
        <p class="tv-p-sum" id="tvPSum"></p>
        <p class="tv-warn" id="tvPWarn" hidden></p>
        ${live ? '<p class="tv-sheet-state on tv-p-live"><i></i>It’s on now: only its title and note can change.</p>' : ''}
        <label class="k-form-label" for="tvPTitle">Title</label>
        <input class="k-field" id="tvPTitle" maxlength="80" value="${esc(p?.title || '')}" placeholder="The first video’s title" />
        <label class="k-form-label" for="tvPNote">Note <span class="tv-note">optional</span></label>
        <textarea class="k-field" id="tvPNote" rows="2" maxlength="300" placeholder="Anything people should know">${esc(p?.note || '')}</textarea>
        <div class="tv-lineup-head"><span class="k-form-label">Videos</span></div>
        <div id="tvPPick"${live ? ' hidden' : ''}>${lineupMarkup({ channel: true })}</div>
        <p class="emo-err" id="tvErr" hidden></p>
        <div class="dlg-actions">
          <button type="button" class="k-btn" data-dlg-cancel>Cancel</button>
          <button type="submit" class="k-btn primary" id="tvPSave">${p ? 'Save' : 'Schedule'}</button>
        </div>
      </form>`);
    const err = m => { $('tvErr').hidden = !m; $('tvErr').textContent = m || ''; };
    const startAt = () => {
      const [h, m] = ($('tvPTime').value || '00:00').split(':').map(Number);
      const d = new Date(days[+$('tvPDay').value]); d.setHours(h || 0, m || 0, 0, 0);
      return d.getTime() / 1000;
    };
    const kit = mountLineup((p?.items || []).map(x => ({ ...x })), {
      sum: list => list.length ? '' : 'Nothing in it yet. Add videos below.',
      change: () => check(),
      channel: () => c,
    });
    let seq = 0, checkT = 0;
    // Its length and end, and whether it clashes with something already there.
    function check() {
      const list = kit.get();
      const len = list.reduce((a, x) => a + (x.duration || 0), 0);
      const s0 = live ? p.start : startAt(), e0 = s0 + len;
      const waiting = list.filter(x => x.status !== 'ready').length;
      $('tvPTitle').placeholder = list[0]?.title || 'The first video’s title';
      $('tvPSum').textContent = list.length
        ? klabCount(list.length, 'video') + ' · ' + long(len) + ' · ' + clock(s0) + '–' + clock(e0) + (dayName(e0) !== dayName(s0) ? ' ' + dayName(e0).toLowerCase() : '') +
          (waiting ? ' · ' + klabCount(waiting, 'video') + ' still processing: it plays if it’s ready by the start, or is skipped' : '')
        : '';
      const warn = $('tvPWarn');
      if (live) { warn.hidden = true; return; }
      if (s0 < now() - 60) { warn.hidden = false; warn.textContent = 'That time has gone. Pick a later one.'; return; }
      clearTimeout(checkT);
      const my = ++seq;
      checkT = setTimeout(async () => {
        let list2 = programs;
        if (!(s0 >= now() - 3600 && e0 <= now() + AHEAD)) {
          try { list2 = (await getJSON(API + '/programs?from=' + Math.floor(s0 - 3600) + '&to=' + Math.ceil(e0 + 1), null, 8000)).programs || []; } catch { list2 = []; }
        } else if (!programsAt) await loadPrograms().then(l => { list2 = l; });
        if (my !== seq || !warn.isConnected) return;
        const hit = len && list2.find(x => x.channelId === c.id && x.id !== p?.id && x.start < e0 && s0 < x.end);
        warn.hidden = !hit;
        if (hit) warn.textContent = 'Clashes with “' + hit.title + '” (' + clock(hit.start) + '–' + clock(hit.end) + ', scheduled by ' + by(hit.createdBy) + '). Pick another time or channel.';
      }, 200);
    }
    $('tvPChan').addEventListener('change', () => { c = byId($('tvPChan').value) || c; kit.refind(); check(); });
    $('tvPDay').addEventListener('change', check);
    $('tvPTime').addEventListener('input', check);
    check();
    $('tvPTitle').focus();
    $('tvPForm').addEventListener('submit', async e => {
      e.preventDefault();
      const list = kit.get();
      if (!live && !list.length) { err('Add at least one video.'); $('tvFind')?.focus(); return; }
      const body = { title: $('tvPTitle').value.trim(), note: $('tvPNote').value.trim() };
      if (!live) Object.assign(body, { channel: c.id, start: Math.round(startAt()), videos: list.map(x => x.id) });
      if (p && !body.title) body.title = p.title;
      const save = $('tvPSave');
      save.disabled = true; save.textContent = 'Saving…';
      err('');
      try {
        const out = p ? await getJSON(API + '/programs/' + encodeURIComponent(p.id), json('PATCH', body))
                      : await getJSON(API + '/programs', json('POST', body));
        closeChatModal();
        const ch = byId(out.channelId);
        showToast(p ? 'Saved' : '“' + out.title + '” is on ' + (ch ? 'channel ' + ch.number + ', ' : '') + dayName(out.start).toLowerCase() + ' at ' + clock(out.start), 'ti-clock');
        if (reminds[out.id]) { reminds[out.id].start = out.start; reminds[out.id].title = out.title; saveReminds(); armReminders(); }
        programs = programs.filter(x => x.id !== out.id).concat(out);
        reloadPrograms();
      } catch (ex) {
        err(klabCap(ex.message) + '.');
        save.disabled = false; save.textContent = p ? 'Save' : 'Schedule';
      }
    });
  }

  // ── Watching ──
  async function openChannel(id, opts) {
    const o = opts || {};
    if (!showing()) setActiveTab('videos');
    await load();
    let c = byId(id) || (typeof id === 'number' ? byNumber(id) : null);
    if (!c) { await load(true); c = byId(id) || byNumber(+id); }
    if (!c) { showToast('That channel’s gone', 'ti-device-tv'); if (view?.kind !== 'guide') showGuide({ quiet: true }); return; }
    if (view?.kind === 'watch' && root?.isConnected && where === 'page') { tune(c); return; }
    window.klabMini?.yield?.('tv');
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
            (window.documentPictureInPicture || document.pictureInPictureEnabled ? '<button type="button" class="vp-btn" data-tvp="pip" title="Pop out" aria-label="Pop out" data-silent><i class="ti ti-picture-in-picture-top"></i></button>' : '') +
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
    if (where !== 'page' && player) {
      // The one in the mini player (or popped out) comes back here, playing.
      const slot = root.querySelector('#tvPlayer');
      if (where === 'mini') { window.klabMini.give(slot); where = 'page'; }
      else slot.replaceWith(away('pip'));
      if (tuned !== c.id) tune(c);
      else { paintInfo(true); paintSide(); }
    } else {
      mountPlayer();
      tune(c, { first: true });
    }
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
          '<button type="button" class="k-btn" data-tv-act="schedule"><i class="ti ti-clock"></i><span>Schedule</span></button>' +
          '<button type="button" class="k-btn" data-tv-act="copy"><i class="ti ti-link"></i><span>Copy link</span></button>' +
          (c.canEdit ? '<button type="button" class="k-icon" data-tv-act="edit" title="Edit channel" aria-label="Edit channel"><i class="ti ti-pencil"></i></button>' +
            '<button type="button" class="k-icon vid-del" data-tv-act="delete" title="Delete channel" aria-label="Delete channel"><i class="ti ti-trash"></i></button>' : '') +
        '</div>' +
      '</div>' +
      (a ? onNowHTML(c, a) : '') +
      (c.description ? '<div class="vid-desc tv-desc"><div class="vid-desc-tx">' + esc(c.description) + '</div></div>' : '') +
      ((c.watchers || []).length ? '<div class="tv-watching"><span class="tv-faces">' + c.watchers.slice(0, 8).map(face).join('') + '</span><span>' + esc(watchingWords(c.watchers)) + '</span></div>' : '');
  }
  // On now and Next: a program shows its title and who scheduled it.
  function onNowHTML(c, a) {
    const t = now(), sp = span(a, t), p = a.program;
    const nextP = a.nextProgram && a.nextProgram !== p ? a.nextProgram : null;
    const later = a.upcoming && a.upcoming !== nextP && a.upcoming !== p ? a.upcoming : null;
    const showNext = a.next && (nextP || p || c.items.length > 1);
    return '<div class="tv-onnow' + (p ? ' is-prog' : '') + '" style="--tv-c:' + esc(c.color || 'var(--text-dimmer)') + '">' +
      '<div class="tv-onnow-row"><span class="k-label">On now</span><span class="tv-onnow-t">' + esc(onTitle(a)) + '</span>' +
        '<span class="tv-onnow-time" data-left>' + dur(sp.off) + ' / ' + dur(sp.len) + '</span></div>' +
      (p ? '<div class="tv-onnow-sub" data-tv-prog="' + esc(p.id) + '">Scheduled by ' + esc(by(p.createdBy)) +
          (a.parts > 1 ? ' · ' + a.part + ' of ' + a.parts + ': ' + esc(a.item.title || 'Untitled') : '') +
          ' · until ' + clock(playEnd(p)) + (p.note ? '<span class="tv-onnow-note">' + esc(p.note) + '</span>' : '') + '</div>' : '') +
      '<span class="tv-bar"><b data-bar style="transform:scaleX(' + (sp.off / sp.len).toFixed(4) + ')"></b></span>' +
      (showNext ? '<div class="tv-onnow-row tv-dim"><span class="k-label">Next</span><span class="tv-onnow-t">' +
          esc(nextP ? nextP.title : a.next.title || 'Untitled') + (nextP ? '<span class="tv-onnow-by"> · scheduled by ' + esc(by(nextP.createdBy)) + '</span>' : '') +
          '</span><span class="tv-onnow-time" data-in>in ' + dur(a.left) + '</span></div>' : '') +
      (later ? '<div class="tv-onnow-row tv-dim"><span class="k-label">Later</span><span class="tv-onnow-t">' + esc(later.title) +
          '<span class="tv-onnow-by"> · scheduled by ' + esc(by(later.createdBy)) + '</span></span><span class="tv-onnow-time">' +
          (dayName(later.start) === 'Today' ? '' : dayName(later.start) + ' ') + clock(later.start) + '</span></div>' : '') +
    '</div>';
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
    const key = c.id + '|' + (a?.key || '') + '|' + (a?.nextKey || '') + '|' + (a?.upcoming?.id || '') + '|' + (c.programs || []).map(p => p.id + p.start + p.title + p.note).join(',') +
      '|' + (c.watchers || []).join(',') + '|' + c.name + '|' + c.description + '|' + c.total;
    if (force || key !== infoKey) { infoKey = key; el.innerHTML = infoHTML(c); paintCtrl(); return; }
    if (!a) return;
    const sp = span(a, now());
    const b = el.querySelector('[data-bar]'), l = el.querySelector('[data-left]'), n = el.querySelector('[data-in]');
    if (b) b.style.transform = 'scaleX(' + (sp.off / sp.len).toFixed(4) + ')';
    if (l) l.textContent = dur(sp.off) + ' / ' + dur(sp.len);
    if (n) n.textContent = 'in ' + dur(a.left);
  }
  function paintSide() {
    const el = $('tvSide');
    if (!el) return;
    el.innerHTML = channels.map(c => {
      const a = airing(c, now());
      return '<button type="button" class="tv-mini-row' + (c.id === view?.id ? ' on' : '') + '" data-tv-id="' + esc(c.id) + '" style="--tv-c:' + esc(c.color || 'var(--text-dimmer)') + '" data-silent>' +
        '<span class="tv-num">' + c.number + '</span>' +
        '<span class="tv-row-tx"><span class="tv-name">' + esc(c.name) + '</span><span class="tv-next">' + (a?.program ? '<i class="ti ti-clock tv-prog-mark"></i>' : '') + esc(a ? onTitle(a) : 'Nothing on') + '</span></span>' +
        '<span class="tv-faces">' + (c.watchers || []).slice(0, 3).map(face).join('') + '</span></button>';
    }).join('');
    paintInfo();
  }
  function paintCtrl() {
    const c = byId(tuned);
    const el = player?.querySelector('.tv-ctrl-now');
    if (el && c) el.textContent = c.number + ' · ' + c.name;
  }

  // ── The player: two decks, one on air ──
  let player = null, decks = [], onAir = null, tuned = null;
  let where = 'page'; // the player: on the page, in the mini player, or popped out (js/44-mini.js)
  const asked = new Set();
  let osdProg = '';
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
    where = 'page';
    player.addEventListener('click', playerClick);
    decks = [...player.querySelectorAll('video.tv-deck')].map(el => ({ el, hls: null, key: '', item: null, ready: false }));
    for (const d of decks) {
      const el = d.el;
      el.muted = true;
      el.addEventListener('playing', () => { if (d === onAir) { player.querySelector('.vp-spin').hidden = true; show(d); player.classList.add('started'); player.classList.remove('paused', 'fresh'); } });
      el.addEventListener('waiting', () => { if (d === onAir) { player.querySelector('.vp-spin').hidden = false; settleUntil = performance.now() + 3000; } });
      el.addEventListener('canplay', () => { d.ready = true; if (d === onAir) player.querySelector('.vp-spin').hidden = true; });
      el.addEventListener('play', () => { if (d === onAir) { quietMusic(); paintBtns(); if (where === 'mini') window.klabMini?.paint(); } });
      el.addEventListener('pause', () => { if (d === onAir) { paintBtns(); if (where === 'mini') window.klabMini?.paint(); } });
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
    if (where === 'page') view = { kind: 'watch', id: c.id };
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
    if (!player?.isConnected || (where === 'page' && view?.kind !== 'watch')) { clearInterval(loopT); return; }
    const c = byId(tuned);
    const a = c && airing(c, now());
    if (!a) {
      for (const d of decks) unload(d);
      onAir = null;
      const b = player.querySelector('.tv-blank');
      b.hidden = false;
      const up = programAfter(c, now());
      b.firstElementChild.textContent = up ? 'Nothing on until ' + up.title + ', ' + dayName(up.start).toLowerCase() + ' at ' + clock(up.start) + '.'
        : c && c.count ? 'This channel’s videos are still processing.' : 'Nothing on this channel yet.';
      player.classList.remove('fresh', 'paused');
      return;
    }
    const blank = player.querySelector('.tv-blank');
    if (blank.firstElementChild.textContent) blank.firstElementChild.textContent = '';
    // A program that started after the list was fetched: the API settles
    // then which of its videos play (one not ready is skipped), so ask again.
    if (a.program && loadedSrv && loadedSrv < a.program.start + 1 && !asked.has(a.program.id)) {
      asked.add(a.program.id);
      setTimeout(() => load(true).then(() => { if (view?.kind === 'watch') paintSide(); }), 1200 + Math.random() * 1500);
    }
    if (held) return;
    if (!onAir || onAir.key !== a.key) {
      const old = onAir;
      const spare = decks.find(d => d.key === a.key) || decks.find(d => d !== old) || decks[0];
      onAir = spare;
      settleUntil = performance.now() + 2500;
      if (old && old !== spare) unload(old);
      // Into a program, or back to the loop after one: the overlay says so.
      if ((a.program?.id || '') !== osdProg) { if (old) osd(c); osdProg = a.program?.id || ''; }
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
    if (spare && a.left < 10 && a.next?.hls && spare.key !== a.nextKey) { cue(spare, a.next, a.nextKey, a.nextAt || 0); }
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
    if (where === 'mini') window.klabMini?.drop(player);
    if (where === 'pip') window.klabMini?.popIn();
    where = 'page';
    if (document.fullscreenElement && document.fullscreenElement === player) document.exitFullscreen?.();
    const had = decks.length;
    for (const d of decks) unload(d);
    decks = []; onAir = null; player = null;
    clearTimeout(idleT); clearTimeout(osdT);
    if (tuned) { tuned = null; window.klabPostPresence?.(); }
    if (had) window.klabnetDesktop?.trimMemory?.();
  }
  // ── The mini player and pop out (js/44-mini.js) ──
  // Leaving a channel that's on (another view, another page) moves the
  // player, still on air, to a corner; ✕ there stops it.
  const tvPlaying = () => !!onAir && !onAir.el.paused && !held;
  function away(kind) {
    const ph = document.createElement('div');
    ph.className = 'vp vp-away';
    ph.dataset.away = kind;
    ph.innerHTML = '<div class="vp-away-tx"><i class="ti ti-picture-in-picture-top"></i><span>' + (kind === 'pip' ? 'Playing in a pop-out window' : 'Playing in the mini player') +
      '</span><button type="button" class="k-btn sm on-media" data-tv-act="pop-in">Bring it back</button></div>';
    return ph;
  }
  function chName() { const c = byId(tuned); return c ? c.number + ' · ' + c.name : 'TV'; }
  function toMini() {
    if (!player || !window.klabMini) return false;
    if (document.fullscreenElement && document.fullscreenElement === player) document.exitFullscreen?.();
    const parent = player.parentNode, next = player.nextSibling;
    const from = player.isConnected ? player.getBoundingClientRect() : null;
    const ok = window.klabMini.take({
      el: player, kind: 'tv', from,
      title: chName,
      sub: () => { const c = byId(tuned); const a = c && airing(c, now()); return a ? onTitle(a) : ''; },
      ctl: { paused: () => !onAir || onAir.el.paused, toggle: () => toggleHold(), up: () => zap(1), down: () => zap(-1) },
      expand: () => openChannel(tuned),
      close: () => { where = 'page'; stopPlayer(); },
      popout: () => popOut(),
    });
    if (!ok) return false;
    where = 'mini';
    if (parent && page.contains(parent)) parent.insertBefore(away('mini'), next);
    return true;
  }
  window.klabTvSoftLeave = () => {
    if (where === 'page' && view?.kind === 'watch' && root?.isConnected && player && tvPlaying()) toMini();
  };
  async function popOut() {
    if (!player || !window.klabMini) return;
    if (where === 'pip') { window.klabMini.popIn(); return; }
    const wasMini = where === 'mini';
    const parent = player.parentNode, next = player.nextSibling;
    const how = await window.klabMini.popOut({
      el: player, video: onAir?.el, width: 480, title: chName(),
      keys: e => {
        const k = e.key;
        let done = true;
        if (k === 'PageUp' || k === 'ArrowUp') zap(1);
        else if (k === 'PageDown' || k === 'ArrowDown') zap(-1);
        else if (k === 'm' || k === 'M') toggleMute();
        else if (k === ' ' || k === 'k' || k === 'K') toggleHold();
        else done = false;
        if (done) e.preventDefault();
      },
      back: el => {
        if (el !== player) return;
        where = 'page';
        const ph = root?.isConnected ? root.querySelector('.vp-away[data-away="pip"]') : null;
        if (ph && view?.kind === 'watch' && document.body.classList.contains('tab-videos-active')) ph.replaceWith(el);
        else if (tvPlaying() && toMini()) { if (ph) ph.replaceWith(away('mini')); }
        else stopPlayer();
      },
    });
    if (how !== 'window') return;
    if (wasMini) window.klabMini.drop(player);
    else if (parent && page.contains(parent)) parent.insertBefore(away('pip'), next);
    where = 'pip';
  }
  function playerClick(e) {
    if (e.currentTarget !== player) return;
    const p = e.target.closest('[data-tvp]');
    if (!p) return;
    const k = p.dataset.tvp;
    if (k === 'play') { blocked = false; held = false; if (onAir) { settleUntil = 0; goLive(onAir); } else step(); }
    else if (k === 'mute') toggleMute();
    else if (k === 'up') zap(1);
    else if (k === 'down') zap(-1);
    else if (k === 'full') toggleFull();
    else if (k === 'pip') popOut();
    SFX && SFX.play('click');
  }

  // Leaving Channels (or Videos) altogether.
  function leave() {
    if (where === 'page') stopPlayer();
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
    el.querySelector('.tv-osd-now').textContent = typed != null ? '' : a ? onTitle(a) + (a.program ? ' · scheduled by ' + by(a.program.createdBy) : '') : '';
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
    if (p && player?.contains(p)) return; // the player's own (playerClick)
    const m = e.target.closest('[data-tv-mode]');
    if (m) { setMode(m.dataset.tvMode); return; }
    const pr = e.target.closest('[data-tv-prog]');
    if (pr) { SFX && SFX.play('click'); openProgram(pr.dataset.tvProg); return; }
    const lane = e.target.closest('[data-lane]');
    if (lane) { scheduleDialog({ channel: byId(lane.dataset.lane), start: laneTime(lane, e.clientX) }); return; }
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
    else if (act === 'schedule') scheduleDialog(view?.kind === 'watch' && c ? { channel: c } : {});
    else if (act === 'now') { const sc = $('tvList')?.querySelector('.tv-g-scroll'); if (sc) sc.scrollTo({ left: Math.max(0, gx(now() - 1800)), behavior: window.klabMotionOk?.() ? 'smooth' : 'auto' }); }
    else if (act === 'guide') { if (!window.klabNav?.back()) showGuide(); }
    else if (act === 'copy' && c) klabCopy(linkTo(c), 'Link');
    else if (act === 'edit' && c) editDialog(c);
    else if (act === 'delete' && c) deleteChannel(c);
    else if (act === 'pop-in') { if (where === 'pip') window.klabMini?.popIn(); else if (where === 'mini') openChannel(tuned); }
  });
  page.addEventListener('contextmenu', e => {
    if (!root || !root.contains(e.target)) return;
    const pr = e.target.closest('[data-tv-prog]');
    const pp = pr && progById(pr.dataset.tvProg);
    if (pp) { klabMenu(e, programMenu(pp)); return; }
    const lane = e.target.closest('[data-lane]');
    if (lane) {
      const lc = byId(lane.dataset.lane), at = laneTime(lane, e.clientX);
      if (lc) {
        klabMenu(e, [
          { header: lc.number + ' · ' + lc.name },
          { label: 'Schedule at ' + clock(at), icon: 'ti-clock', action: () => scheduleDialog({ channel: lc, start: at }) },
          { label: 'Watch', icon: 'ti-player-play', action: () => openChannel(lc.id) },
        ]);
        return;
      }
    }
    const row = e.target.closest('[data-tv-id]');
    const c = row ? byId(row.dataset.tvId) : (e.target.closest('.tv-vp, .tv-info') ? byId(tuned) : null);
    if (!c) return;
    klabMenu(e, [
      { header: c.number + ' · ' + c.name },
      { label: 'Watch', icon: 'ti-player-play', hidden: c.id === tuned, action: () => (view?.kind === 'watch' ? tune(c) : openChannel(c.id)) },
      { label: 'Schedule a program', icon: 'ti-clock', action: () => scheduleDialog({ channel: c }) },
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

  // The lineup editor, a channel's or a program's: the list (drag to
  // reorder, ✕ to take out) and Videos' search to add from. o.sum(list) is
  // the line over it, o.change() hears every change, and o.channel() (a
  // program's) adds "This channel": that channel's lineup, uploads and all.
  function lineupMarkup(o) {
    return '<div class="tv-lineup-sum" id="tvSum"></div><div class="tv-lineup" id="tvLineup"></div>' +
      '<div class="tv-find"><label class="k-field-box tv-find-box"><i class="ti ti-search"></i><input type="text" id="tvFind" placeholder="Search videos to add" aria-label="Search videos to add" /></label>' +
        '<div class="k-seg" id="tvWhose"><button type="button" data-whose="all" aria-pressed="true">All</button><button type="button" data-whose="mine" aria-pressed="false">Yours</button>' +
        (o?.channel ? '<button type="button" data-whose="channel" aria-pressed="false">This channel</button>' : '') + '</div></div>' +
      '<div class="tv-results" id="tvResults"></div>';
  }
  const resHTML = (v, i) =>
    '<button type="button" class="tv-res" data-add="' + i + '"' + (v.status === 'failed' ? ' disabled' : '') + '>' +
      '<span class="tv-li-thumb">' + (v.posterSmall ? '<img src="' + esc(v.posterSmall) + '" alt="" draggable="false" loading="lazy" />' : '<i class="ti ti-movie"></i>') + '</span>' +
      '<span class="tv-li-tx"><span class="tv-li-t">' + esc(v.title || 'Untitled') + '</span><span class="tv-li-s">' + (v.status === 'ready' ? dur(v.duration) : v.status === 'failed' ? 'Couldn’t process it' : 'Processing') +
        (v.unlisted ? ' · only on this channel' : v.username ? ' · ' + esc(v.username) : '') + '</span></span>' +
      '<i class="ti ti-plus tv-res-add"></i></button>';
  function mountLineup(start, o) {
    let lineup = start;
    // The lineup: drag to reorder, ✕ to take out.
    function paintLineup() {
      $('tvSum').textContent = o.sum(lineup);
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
      o.change?.();
    });
    li.addEventListener('click', e => {
      const b = e.target.closest('[data-rm]');
      if (!b) return;
      lineup.splice(+b.dataset.rm, 1);
      paintLineup();
      o.change?.();
    });
    // Finding videos to add (Videos' own search).
    let whose = 'all', findT = 0, findSeq = 0;
    async function find() {
      const q = $('tvFind').value.trim(), seq = ++findSeq;
      const el = $('tvResults');
      if (whose === 'channel') {
        // A channel's own lineup (its uploads among it), found here.
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        const ch = o.channel?.();
        const seen = new Set();
        const vs = (ch?.lineup || ch?.items || []).filter(v => !seen.has(v.id) && seen.add(v.id) && words.every(w => (v.title || '').toLowerCase().includes(w)));
        el._vs = vs;
        el.innerHTML = vs.length ? vs.map(resHTML).join('') : '<div class="k-empty tv-res-empty">' + (q ? 'Nothing matches that.' : 'Nothing in this channel’s lineup.') + '</div>';
        return;
      }
      try {
        const j = await getJSON(VIDEOS + '?limit=20&sort=new' + (q ? '&q=' + encodeURIComponent(q) : '') + (whose === 'mine' ? '&user=' + encodeURIComponent(me()) : ''), null, 8000);
        if (seq !== findSeq || !el.isConnected) return;
        const vs = j.videos || [];
        el._vs = vs;
        el.innerHTML = vs.length ? vs.map(resHTML).join('')
          : '<div class="k-empty tv-res-empty">' + (q ? 'Nothing matches that.' : 'No videos yet.') + '</div>';
      } catch (e) { if (seq === findSeq) el.innerHTML = '<div class="k-empty tv-res-empty">Couldn’t load videos.</div>'; }
    }
    $('tvFind').addEventListener('input', () => { clearTimeout(findT); findT = setTimeout(find, 250); });
    $('tvFind').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(findT); find(); } });
    $('tvFind').addEventListener('keydown', e => { if (e.key === 'Escape' && $('tvFind').value) { e.preventDefault(); e.stopPropagation(); $('tvFind').value = ''; find(); } });
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
      lineup.push({ id: v.id, title: v.title, duration: v.duration, status: v.status, progress: v.progress, posterSmall: v.posterSmall, username: v.username, unlisted: v.unlisted });
      paintLineup();
      o.change?.();
      const rows = $('tvLineup');
      rows.lastElementChild?.scrollIntoView({ block: 'nearest' });
      SFX && SFX.play('tick');
    });
    paintLineup();
    find();
    return { get: () => lineup, set: list => { lineup = list; paintLineup(); }, refind: find };
  }

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
    const lineup = (c?.lineup || c?.items || []).map(x => ({ ...x }));
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
          ${lineupMarkup()}
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

    const kit = mountLineup(lineup, {
      sum: list => {
        const total = list.reduce((a, x) => a + (x.status === 'ready' ? x.duration || 0 : 0), 0);
        const waiting = list.filter(x => x.status !== 'ready').length;
        return list.length
          ? klabCount(list.length, 'video') + ' · ' + dur(total) + ' loop' + (waiting ? ' · ' + waiting + ' not ready yet, skipped until they are' : '')
          : 'Nothing in it yet. Add videos below.';
      },
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
      const body = { name, number, color: pickedColor, description: $('tvDesc').value.trim(), videos: kit.get().map(x => x.id) };
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
          kit.set((out.lineup || []).map(x => ({ ...x })));
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
      if (view?.kind === 'watch' && where === 'page' && !(tvPlaying() && toMini()) && !(document.pictureInPictureElement && onAir && document.pictureInPictureElement === onAir.el)) stopPlayer();
      return;
    }
    if (link) { if (link.program) showGuide({ program: link.program }); else if (link.number) openChannel(link.number); else showGuide(link.guide ? { mode: 'grid' } : null); return; }
    // Back on Videos with the channel in the mini player still drawn: it comes home.
    if (where === 'mini' && view?.kind === 'watch' && root?.isConnected) {
      const ph = root.querySelector('.vp-away');
      if (ph) { window.klabMini.give(ph); where = 'page'; paintInfo(true); paintSide(); }
    }
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
    programs: () => loadPrograms(),
    schedule: o => scheduleDialog(o || {}),
    reminders: () => ({ ...reminds }),
    // The channel on air here, for presence (null when nothing's playing).
    now: () => (tuned && onAir && !onAir.el.paused ? tuned : null),
    state: () => ({ view, tuned, key: onAir?.key || '', at: onAir ? onAir.el.currentTime : null, target: (() => { const a = airing(byId(tuned), now()); return a ? a.off : null; })(), offset }),
  };
  syncClock();
  // A link straight to a channel, on a page that opened on Videos.
  if (showing() && window.klabTvLink) {
    const l = window.klabTvLink; window.klabTvLink = null;
    if (l.program) showGuide({ program: l.program }); else if (l.number) openChannel(l.number); else showGuide(l.guide ? { mode: 'grid' } : null);
  }
  armReminders();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) armReminders(); });
})();
