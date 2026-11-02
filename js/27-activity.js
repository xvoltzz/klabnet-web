// ══════════════════════════════════════════
//  MUSIC ACTIVITY — what everyone's listening to (Music's sidebar,
//  "Activity"). Who's playing something right now and how far into it
//  (a bar that runs live), then each person: the last thing they played,
//  and how much they listened this week and to whom, mostly.
//
//  klabnet-api counts it from presence's beats (routers/listens.py,
//  GET /api/music-requests/activity); the beat carries where the song's
//  got to (js/11-presence.js postPresence). Polled every 10s while it's
//  showing; the bars tick on their own in between.
// ══════════════════════════════════════════
(function() {
  const POLL_MS = 10000;
  let data = null, failed = 0, gotAt = 0, poll = 0, tick = 0, showing = false;

  const cover = (s, px) => {
    const id = s?.coverArt || s?.songId;
    return id ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${klabArtSize(px)}&${subsonicParams()}` : '';
  };
  const art = (s, px, cls) => {
    const url = cover(s, px);
    return '<span class="' + cls + '">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async" />' : '<i class="ti ti-music"></i>') + '</span>';
  };
  function avatar(u) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="act-av">' + (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  const nameHTML = u => '<span class="act-name" style="color:' + (typeof profileColor === 'function' ? profileColor(u) : 'inherit') + '">' + esc(u) + '</span>';
  const me = () => window.KLAB_USER?.username;
  // 42m, 2h 21m, 34h.
  function short(s) {
    const m = Math.round((s || 0) / 60);
    if (m < 60) return (s && !m ? '<1' : m) + 'm';
    const h = Math.floor(m / 60), r = m % 60;
    return h >= 10 || !r ? h + 'h' : h + 'h ' + r + 'm';
  }
  const clock = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const apiDate = s => new Date(String(s).replace(' ', 'T') + 'Z').getTime();
  // Where a song playing now has got to, counting on from the last poll.
  const posNow = n => {
    if (n.position == null) return null;
    const p = n.playing ? n.position + (performance.now() - gotAt) / 1000 : n.position;
    return n.duration ? Math.min(p, n.duration) : p;
  };
  const songAttr = s => esc(encodeURIComponent(JSON.stringify({ id: s.songId, title: s.song, artist: s.artist, album: s.album, coverArt: s.coverArt })));

  // On the radio (presence's live() says which station): the station, what's
  // on it, and a way to tune in to the same moment.
  function radioCard(p) {
    const r = p.now.radio, mine = p.username === me();
    const initials = (r.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return '<div class="act-now is-playing is-radio" data-user="' + esc(p.username) + '">' +
      '<span class="act-now-art act-radio-art" style="--st:' + esc(r.color || 'var(--glass-fill-h)') + '">' +
        (r.cover ? '<img src="/api/music-requests/playlists/covers/' + encodeURIComponent(r.cover) + '/s" alt="" loading="lazy" />' : '<b>' + esc(initials) + '</b>') + '</span>' +
      '<div class="act-now-body">' +
        '<div class="act-who">' + avatar(p.username) + nameHTML(p.username) +
          '<span class="act-state"><span class="act-dot" aria-hidden="true"></span>On the radio</span></div>' +
        '<button type="button" class="act-song" data-radio="' + esc(r.id) + '" title="Tune in">' +
          '<span class="act-title">' + esc(r.track || r.name) + '</span><span class="act-artist">' + (r.track ? esc(r.name) + ' · ' : '') + Number(r.frequency).toFixed(1) + ' FM · by ' + esc(r.author || '') + '</span></button>' +
        (!mine && window.klabRadio?.now() !== r.id ? '<button type="button" class="act-along" data-radio="' + esc(r.id) + '"><i class="ti ti-radio"></i>Tune in</button>' : '') +
      '</div></div>';
  }

  function nowCard(p) {
    if (p.now.radio) return radioCard(p);
    const n = p.now, mine = p.username === me();
    const pos = posNow(n);
    const pct = pos != null && n.duration ? Math.min(100, pos / n.duration * 100) : 0;
    return '<div class="act-now' + (n.playing ? ' is-playing' : '') + '" data-user="' + esc(p.username) + '">' +
      art(n, 300, 'act-now-art') +
      '<div class="act-now-body">' +
        '<div class="act-who">' + avatar(p.username) + nameHTML(p.username) +
          '<span class="act-state">' + (n.playing ? '<span class="act-dot" aria-hidden="true"></span>Listening' : 'Paused') +
          (n.partyHost ? ' · with ' + esc(n.partyHost) : '') + '</span></div>' +
        '<button type="button" class="act-song" data-play="' + songAttr(n) + '" title="Play this">' +
          '<span class="act-title">' + esc(n.song) + '</span><span class="act-artist">' + esc(n.artist) + (n.album ? ' · ' + esc(n.album) : '') + '</span></button>' +
        (pos != null && n.duration ? '<div class="act-prog"><span class="act-t act-t-at">' + clock(pos) + '</span>' +
          '<span class="act-bar"><span class="act-fill" style="width:' + pct.toFixed(2) + '%"></span></span>' +
          '<span class="act-t">' + clock(n.duration) + '</span></div>' : '') +
        (!mine && n.playing ? '<button type="button" class="act-along" data-along="' + esc(p.username) + '"><i class="ti ti-headphones"></i>Listen along</button>' : '') +
      '</div></div>';
  }

  // Kept basic on purpose ("we're not the NSA"): who, what they last
  // played, and one line of how much and who. The API has more (plays,
  // today, all time, the song on repeat, the last seven days) if that's
  // wanted again.
  function personCard(p) {
    const s = p.stats, n = p.now;
    const status = n?.playing ? '<span class="act-live">Listening now</span>'
      : p.last ? 'Last played ' + esc(klabRelativeTime(apiDate(p.last.at))) : '';
    const last = n?.playing ? null : p.last;
    const line = s ? [s.week ? short(s.week) + ' this week' : '', s.topArtist ? 'mostly ' + esc(s.topArtist.name) : ''].filter(Boolean).join(' · ') : '';
    return '<div class="act-person">' +
      '<div class="act-who">' + avatar(p.username) + '<span class="act-who-text">' + nameHTML(p.username) + '<span class="act-state">' + status + '</span></span></div>' +
      (last ? '<button type="button" class="act-last" data-play="' + songAttr(last) + '" title="Play this">' + art(last, 56, 'act-last-art') +
        '<span class="act-last-text"><span class="act-title">' + esc(last.song) + '</span><span class="act-artist">' + esc(last.artist) + '</span></span></button>' : '') +
      (line ? '<div class="act-line">' + line + '</div>' : '') +
    '</div>';
  }

  let lastHTML = '';
  function render() {
    if (!showing) return;
    const list = pickerList;
    if (!data) {
      list.innerHTML = '<div class="picker-empty">' + (failed === 404 ? 'Activity needs the latest klabnet-api.' : failed ? 'Couldn’t load activity just now.' : 'Loading…') + '</div>';
      return;
    }
    const people = data.people || [];
    const now = people.filter(p => p.now && (p.now.songId || p.now.radio));
    const counted = people.filter(p => p.stats);
    let html = '<div class="act-page">';
    if (now.length) html += '<div class="picker-section-label">Listening now</div><div class="act-now-grid">' + now.map(nowCard).join('') + '</div>';
    if (counted.length) html += '<div class="picker-section-label">People</div><div class="act-people">' + counted.map(personCard).join('') + '</div>';
    if (!now.length && !counted.length) html += '<div class="picker-empty">Nothing played yet. Activity fills in as people listen.</div>';
    html += '</div>';
    // Every 10s the same page came back, and rebuilding it lost focus and
    // hover and made the covers blink. step() moves the bars between.
    // (Compared without the running times and bars, which always differ.)
    const same = html.replace(/act-t-at">[^<]*|width:[\d.]+%/g, '');
    if (same === lastHTML && list.querySelector('.act-page')) { step(); return; }
    lastHTML = same;
    list.innerHTML = html;
    document.getElementById('musicViewSub').textContent = now.length ? klabCount(now.filter(p => p.now.playing).length, 'person', 'people') + ' listening' : '';
  }

  // The bars and times of what's playing, every second, without a redraw.
  function step() {
    if (!showing || !data || document.hidden) return;
    (data.people || []).forEach(p => {
      if (!p.now?.playing || p.now.radio || p.now.position == null || !p.now.duration) return;
      const card = pickerList.querySelector('.act-now[data-user="' + CSS.escape(p.username) + '"]');
      if (!card) return;
      const pos = posNow(p.now);
      const fill = card.querySelector('.act-fill'), at = card.querySelector('.act-t-at');
      if (fill) fill.style.width = Math.min(100, pos / p.now.duration * 100).toFixed(2) + '%';
      if (at) at.textContent = clock(pos);
      // Past the end: the next song will be in the next poll; ask now,
      // once per song (a device that slept mid-song goes on saying it's
      // playing, and this asked every two seconds), and not again while
      // the API is failing.
      const ask = p.username + '|' + p.now.songId + '|' + p.now.position;
      if (pos >= p.now.duration && performance.now() - gotAt > 2000 && !askedEnd.has(ask) && !failed) { askedEnd.add(ask); load(); }
    });
  }

  const askedEnd = new Set();
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const r = await fetchTimeout('/api/music-requests/activity?tz=' + new Date().getTimezoneOffset(), {}, 8000);
        // An API from before this: no such path (404, or 405 from the paths beside it), or a proxy's HTML.
        if (r.status === 404 || r.status === 405 || !/json/.test(r.headers.get('content-type') || '')) { failed = 404; return; }
        if (!r.ok) { failed = r.status || 1; return; }
        data = await r.json();
        gotAt = performance.now();
        failed = 0;
      } catch (e) { failed = failed || 1; }
      finally { loading = null; }
    })().then(render);
    return loading;
  }

  function start() {
    showing = true;
    clearInterval(poll); clearInterval(tick);
    render();
    load();
    poll = setInterval(() => {
      if (!showing) return;
      if (pickerTab !== 'activity') { stop(); return; }
      if (!document.hidden) load();
    }, POLL_MS);
    tick = setInterval(step, 1000);
  }
  function stop() { showing = false; clearInterval(poll); clearInterval(tick); }

  pickerList.addEventListener('click', e => {
    if (!showing) return;
    const radio = e.target.closest('[data-radio]');
    if (radio) { SFX && SFX.play('click'); window.klabRadio?.tune(radio.dataset.radio).then(render); return; }
    const along = e.target.closest('[data-along]');
    if (along) { SFX && SFX.play('click'); window.klabListenAlong?.(along.dataset.along); return; }
    const play = e.target.closest('[data-play]');
    if (play) {
      let song = null;
      try { song = klabCleanSong(JSON.parse(decodeURIComponent(play.dataset.play))); } catch (err) {}
      if (song) playSong(song);
    }
  });
  window.addEventListener('klab:people', () => { if (showing) render(); });
  document.addEventListener('visibilitychange', () => { if (showing && !document.hidden && pickerTab === 'activity') load(); });
  // Off Music it stops; back on it with Activity still the view, it picks up again.
  const musicTabChanged = window.klabMusicTabChanged;
  window.klabMusicTabChanged = on => {
    musicTabChanged?.(on);
    if (!on) stop();
    else if (pickerTab === 'activity' && !showing) start();
  };

  const _prevLoadPickerTab = loadPickerTab;
  loadPickerTab = async function(tab) {
    if (tab !== 'activity') { stop(); return _prevLoadPickerTab(tab); }
    // What the layers underneath do on the way to any view they don't own.
    window.klabBrowse?.leave();
    if (typeof _songsObserver !== 'undefined' && _songsObserver) { _songsObserver.disconnect(); _songsObserver = null; }
    hideSortBtn();
    _pickerLoadToken++; clearTimeout(pickerDebounce);
    pickerTab = tab;
    pickerList.classList.remove('mh-home', 'picker-list-grid', 'is-stale');
    setMusicViewTitle(tab);
    start();
  };
  window.klabActivity = { load, stop };
})();
