// ══════════════════════════════════════════
//  SOCIAL — Browse, Feed and Chat as one page, laid out like Music (Photos
//  was one of its pages until 2026-11-19; it's its own now).
//    · The sidebar (#socSidebar in index.html) holds Browse (Social's
//      front, data-soc="social"), Feed and Chat's people and
//      conversations. Pressing something in it that belongs to another of
//      its pages goes there.
//    · Browse is Together (rooms happening now), This week on klabnet,
//      unread messages and a few posts. It only fetches while it's showing.
//  Routing (TAB_GROUP, the remembered page) is in js/07-tabnav.js; the
//  layout is "SOCIAL" in css/app.css.
// ══════════════════════════════════════════
(function() {
  const $ = id => document.getElementById(id);
  const side = $('socSidebar');
  if (!side) return;
  const on = key => document.body.classList.contains('tab-' + key + '-active');

  // ── The sidebar ──
  // Feed's mentions dot, on its row too.
  const mentions = $('feedMentionsDot'), feedDot = $('socFeedDot');
  if (mentions && feedDot) {
    const sync = () => { feedDot.hidden = mentions.hidden; };
    new MutationObserver(sync).observe(mentions, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }
  // A conversation or a person picked from Feed or Photos: their own click
  // handlers open it, then this brings Chat up to show it.
  $('chatSide')?.addEventListener('click', e => {
    if (on('chat')) return;
    if (e.target.closest('.chat-channel-close, .chat-icon-btn')) return;
    if (e.target.closest('.chat-conv, #chatPeopleResults [data-username]')) setActiveTab('chat');
  });
  $('socChatConnect')?.addEventListener('click', () => {
    setActiveTab('chat');
    $('chatConnectBtn')?.click();
  });

  // ── Social → Browse ──
  // The owner (2026-11-20): "the feed is so dead sometimes i dont want it
  // to be the first impression… a new type of social feature that
  // encourages people to use the platform". So Browse leads with what
  // people are already doing, which is never empty for long:
  //   · Together: every room happening now (watch parties, listening
  //     parties, TV channels and radio stations people are on, voice
  //     channels with people in them), each one press to join; under them
  //     the people listening on their own. klabnet-api GET /api/posts/rooms
  //     answers all of it at once (routers/rooms.py).
  //   · This week on klabnet: a page made from the week (most played,
  //     found first, on repeat, what's new, most reacted), any week back
  //     with ‹ ›, every line something to react to and reply under
  //     (GET /api/posts/week, routers/week.py).
  // (Social's Browse page is gone: Together is on Home, This week a sheet.)
  const me = () => window.KLAB_USER?.username || '';
  let active = false;
  const mmss = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ndArt = (id, px) => id && typeof ND_URL !== 'undefined' ? ND_URL + '/rest/getCoverArt?id=' + encodeURIComponent(id) + '&size=' + klabArtSize(px) + '&' + subsonicParams() : '';
  const photoFile = (id, size) => `/api/posts/photos/files/${encodeURIComponent(id)}/${size}?v=2`;
  const color = u => (typeof profileColor === 'function' ? profileColor(u) : 'var(--text)');
  function names(list, max) {
    const l = (list || []).filter(Boolean);
    max = max || 3;
    if (l.length <= max) return l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l.join('');
    return l.slice(0, max - 1).join(', ') + ' and ' + (l.length - max + 1) + ' others';
  }
  function faceHTML(u, cls) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="' + (cls || 'tg-face') + '" data-u="' + esc(u) + '" title="' + esc(u) + '" style="--c:' + color(u) + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  function hours(s) {
    const m = Math.round((s || 0) / 60);
    if (m < 60) return klabCount(m, 'minute');
    const h = Math.round(m / 6) / 10;
    return (h >= 10 ? Math.round(h) : h) + (h === 1 ? ' hour' : ' hours');
  }
  const songOf = x => klabCleanSong({ id: x.songId, title: x.song, artist: x.artist, album: x.album, coverArt: x.coverArt });


  // ══ Together ══
  const together = (() => {
    const wrap = document.createElement('section');
    wrap.className = 'tg';
    wrap.hidden = true; // until there's a room to show
    wrap.innerHTML = '<div class="wk-head tg-head"><span class="k-label">Together</span><span class="wk-range tg-count"></span></div>' +
      '<div class="tg-rooms" role="list" aria-label="Rooms"></div>';
    const roomsEl = wrap.querySelector('.tg-rooms'), countEl = wrap.querySelector('.tg-count');
    let data = null, gotAt = 0, failed = 0, lastKey = '', loading = null;
    const elapsed = () => (performance.now() - gotAt) / 1000;
    // Where a song (or a watch party) is now: as of the answer, running on.
    const posNow = n => {
      if (!n || n.position == null) return null;
      const p = n.playing ? n.position + elapsed() : n.position;
      return n.duration ? Math.min(p, n.duration) : p;
    };

    function progHTML(pos, dur) {
      if (pos == null || !dur) return '';
      return '<div class="tg-prog"><span class="tg-bar"><b style="transform:scaleX(' + Math.min(1, pos / dur).toFixed(4) + ')"></b></span>' +
        '<span class="tg-t"><span class="tg-at">' + mmss(pos) + '</span> / ' + mmss(dur) + '</span></div>';
    }
    function cardHTML(c) {
      const faces = c.people.slice(0, 5).map(u => faceHTML(u)).join('');
      // A stream is watched, not joined: Watch stays, even for the streamer.
      const inIt = c.people.includes(me());
      const art = c.art ? '<img src="' + esc(c.art) + '" alt="" loading="lazy" decoding="async" />'
        : '<b style="--st:' + esc(c.tint || 'var(--fill-hover)') + '">' + esc(c.mark || '') + '</b>';
      return '<div class="tg-card" role="listitem" data-kind="' + c.kind + '" data-id="' + esc(String(c.id)) + '">' +
        '<button type="button" class="tg-art' + (c.wide ? ' wide' : '') + '" data-join tabindex="-1" aria-hidden="true" data-silent>' + art + '</button>' +
        '<div class="tg-body">' +
          '<span class="tg-kind"><i class="ti ' + c.icon + '"></i>' + esc(c.kindLabel) + '</span>' +
          '<span class="tg-title">' + esc(c.title) + '</span>' +
          (c.sub ? '<span class="tg-sub">' + esc(c.sub) + '</span>' : '') +
          progHTML(c.pos, c.dur) +
          '<div class="tg-foot"><span class="tg-faces">' + faces + '</span><span class="tg-who">' + esc(c.who) + '</span>' +
            (inIt ? '<span class="tg-here">You’re here</span>' + (c.kind === 'watch' ? '<button type="button" class="k-btn sm" data-join>Open</button>'
                : c.watch ? '<button type="button" class="k-btn sm" data-watch><i class="ti ti-screen-share"></i><span>Watch</span></button>' : '')
              : '<button type="button" class="k-btn sm primary" data-join>' + esc(c.join) + '</button>') +
          '</div>' +
        '</div></div>';
    }
    // Every room as one shape of card.
    // Only what's really together (the owner, 2026-11-21: Home is "really
    // cluttered… i dont even know if i want the together stuff featured
    // unless people are in voice or multiple people are actually in a
    // watch/listen party"): voice channels with people in them, and watch
    // or listening parties of two or more. Live streams, TV and the radio
    // aren't shown here any more (Videos → Live, Channels, Music → Radio).
    const SHOWN = new Set(['voice', 'watch', 'listen']);
    const together2 = c => SHOWN.has(c.kind) && (c.kind === 'voice' ? c.people.length > 0 : c.people.length > 1);
    function cards() { return allCards().filter(together2); }
    function allCards() {
      const out = [];
      for (const w of data.watch || []) out.push({
        kind: 'watch', id: w.id, icon: 'ti-movie', kindLabel: 'Watch party', title: w.video.title, wide: true,
        art: w.video.posterSmall, sub: w.video.username ? 'from ' + w.video.username : '',
        pos: w.positionNow + (w.playing ? elapsed() : 0), dur: w.video.duration, playing: w.playing,
        people: w.people, who: names(w.people, 2) + (w.playing ? '' : ' · paused'), join: 'Join',
      });
      for (const l of data.listen || []) out.push({
        kind: 'listen', id: l.host, icon: 'ti-headphones', kindLabel: 'Listening party', title: l.now.song,
        art: ndArt(l.now.coverArt || l.now.songId, 120), sub: [l.now.artist, l.now.album].filter(Boolean).join(' · '),
        pos: posNow(l.now), dur: l.now.duration, people: l.people,
        who: names(l.people, 2), join: 'Listen along',
      });
      // Screen sharing: who's sharing, and Watch (Join to watch from outside:
      // only people in the channel can watch).
      for (const v of data.voice || []) {
        const sh = v.sharing || [];
        out.push({
          kind: 'voice', id: v.id, icon: sh.length ? 'ti-screen-share' : 'ti-microphone', kindLabel: 'Voice', title: v.name, mark: '#',
          sub: sh.length ? names(sh, 2) + (sh.length > 1 ? ' are sharing' : ' is sharing') + ' · ' + v.name : '',
          people: v.people, who: names(v.people, 2), join: sh.length ? 'Join to watch' : 'Join', watch: sh.length > 0,
        });
      }
      return out;
    }
    function render() {
      if (!active) return;
      if (!data) {
        roomsEl.innerHTML = '';
        wrap.hidden = true; // nothing to say until there's a room to join
        return;
      }
      const cs = cards();
      // Redrawn only when something other than the running clocks changed.
      // ("Listening now", people on their own, isn't together: Home's Online has it.)
      const key = JSON.stringify(cs.map(c => [c.kind, c.id, c.title, c.sub, c.art, c.people, c.who, c.playing]));
      if (key === lastKey) { step(); return; }
      lastKey = key;
      roomsEl.innerHTML = cs.map(cardHTML).join('');
      roomsEl.hidden = !cs.length;
      // Nothing together: nothing shown at all (no empty state, no "start
      // something" buttons: the owner didn't want them).
      wrap.hidden = !cs.length;
      const n = new Set(cs.flatMap(c => c.people)).size;
      countEl.textContent = cs.length ? klabCount(n, 'person', 'people') + ' in ' + klabCount(cs.length, 'room') : '';
    }
    // The running clocks, once a second while it shows (no redraw).
    function step() {
      if (!active || !data || document.hidden || document.documentElement.classList.contains('win-idle')) return;
      const set = (card, pos, dur) => {
        if (!card || pos == null || !dur) return;
        const b = card.querySelector('.tg-bar b'), t = card.querySelector('.tg-at');
        if (b) b.style.transform = 'scaleX(' + Math.min(1, pos / dur).toFixed(4) + ')';
        if (t) t.textContent = mmss(pos);
      };
      const card = (k, id) => roomsEl.querySelector('.tg-card[data-kind="' + k + '"][data-id="' + CSS.escape(String(id)) + '"]');
      for (const w of data.watch || []) if (w.playing) set(card('watch', w.id), Math.min(w.positionNow + elapsed(), w.video.duration || 1e9), w.video.duration);
      for (const l of data.listen || []) if (l.now.playing) set(card('listen', l.host), posNow(l.now), l.now.duration);
    }
    async function load() {
      if (loading) return loading;
      loading = (async () => {
        // The deadline covers the body too: fetchTimeout's stops at the
        // headers, and a body that stalled left `loading` set for good, so
        // Together never refreshed again until a reload.
        const ctrl = new AbortController();
        const dl = setTimeout(() => ctrl.abort(), 10000);
        try {
          const r = await fetchTimeout('/api/posts/rooms', { cache: 'no-store', signal: ctrl.signal }, 8000);
          if (r.status === 404 || r.status === 405 || !/json/.test(r.headers.get('content-type') || '')) { failed = 404; return; }
          if (!r.ok) { failed = r.status || 1; return; }
          data = await r.json();
          gotAt = performance.now();
          failed = 0;
        } catch (e) { failed = failed || 1; }
        finally { clearTimeout(dl); loading = null; }
      })().then(render);
      return loading;
    }

    // ── Pressing things ──
    const find = (kind, id) => {
      if (!data) return null;
      if (kind === 'watch') return (data.watch || []).find(x => x.id === id);
      if (kind === 'listen') return (data.listen || []).find(x => x.host === id);
      if (kind === 'voice') return (data.voice || []).find(x => String(x.id) === id);
      return null;
    };
    async function join(kind, id) {
      SFX?.play('click');
      if (kind === 'watch') window.klabRooms?.join(id);
      else if (kind === 'listen') window.klabListenAlong?.(id);
      else if (kind === 'voice') window.klabVoice?.join(+id, { watch: !!find('voice', id)?.sharing?.length });
      setTimeout(load, 1500);
    }
    wrap.addEventListener('click', e => {
      const face = e.target.closest('.tg-face[data-u]');
      if (face) { openProfileView(face.dataset.u); return; }
      const card = e.target.closest('.tg-card');
      if (card && e.target.closest('[data-join]')) { join(card.dataset.kind, card.dataset.id); return; }
      if (card && e.target.closest('[data-watch]')) { SFX?.play('click'); window.klabVoice?.watch?.(); }
    });
    wrap.addEventListener('contextmenu', e => {
      const card = e.target.closest('.tg-card');
      if (card) {
        const k = card.dataset.kind, x = find(k, card.dataset.id);
        if (!x) return;
        const people = (x.people || []).filter(u => u !== me());
        klabMenu(e, [
          { header: card.querySelector('.tg-title')?.textContent || '' },
          { label: card.querySelector('[data-join]:not(.tg-art)')?.textContent || 'Join', icon: 'ti-player-play', action: () => join(k, card.dataset.id) },
          { label: 'Play this song', icon: 'ti-music', hidden: k !== 'listen', action: () => { const s = songOf(x.now); if (s) playSong(s); } },
          { label: 'Copy link', icon: 'ti-link', hidden: k !== 'watch', action: () => klabCopy(location.origin + location.pathname + '#videos/' + x.video.id + '?room=' + encodeURIComponent(x.id), 'Link') },
          people.length ? '-' : null,
          ...people.slice(0, 8).map(u => ({ label: u, icon: 'ti-user-circle', action: () => openProfileView(u) })),
        ].filter(Boolean));
      }
    });

    // Your own room changing (joined, left) shows at once.
    window.addEventListener('klab:rooms', () => { if (active) setTimeout(load, 300); });
    return { el: wrap, load, render, step, count: () => (data ? cards().length : 0) };
  })();

  // ══ This week on klabnet ══
  const week = (() => {
    const sec = document.createElement('section');
    sec.className = 'wk';
    sec.innerHTML =
      '<div class="wk-head"><span class="k-label">This week on klabnet</span>' +
        '<span class="wk-range"></span>' +
        '<span class="wk-nav"><button type="button" class="k-icon sm" data-wk-go="prev" title="The week before" aria-label="The week before"><i class="ti ti-chevron-left"></i></button>' +
        '<button type="button" class="k-icon sm" data-wk-go="next" title="The week after" aria-label="The week after"><i class="ti ti-chevron-right"></i></button></span></div>' +
      '<div class="wk-totals"></div><div class="wk-lines" role="list"></div>';
    const linesEl = sec.querySelector('.wk-lines'), totalsEl = sec.querySelector('.wk-totals'), rangeEl = sec.querySelector('.wk-range');
    const tz = () => new Date().getTimezoneOffset();
    let want = '';          // '' is this week
    let data = null, failed = 0, loadedAt = 0, seq = 0;
    let albums = [];        // new in Navidrome that week (the API can't see it)
    const open = new Set(); // lines with their replies showing
    let focusLine = '';

    const rangeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    const day = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
    function rangeText(d) {
      if (d.current) return 'This week';
      const a = day(d.start), b = day(d.end);
      return rangeFmt.format(a) + ' – ' + (a.getMonth() === b.getMonth() ? b.getDate() : rangeFmt.format(b));
    }

    // Each line: what it's called, what it says, and what's under it.
    const CAPS = {
      song: 'Most played song', album: 'Most played album', artist: 'Most played artist', found: 'Found first',
      repeat: 'On repeat', reacted: 'Most reacted', videos: 'New videos', photos: 'New photos',
      playlists: 'New playlists', stations: 'New radio stations', channels: 'New TV channels', albums: 'New albums',
    };
    const plays = n => klabCount(n, 'play');
    const whoPlays = w => (w || []).slice(0, 3).map(x => x.username + ' ' + x.plays).join(', ');
    function art(l) {
      const img = src => '<span class="wk-art"><img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" /></span>';
      if (l.coverArt || l.songId) return img(ndArt(l.coverArt || l.songId, 96));
      const ICO = { videos: 'ti-movie', photos: 'ti-photo', albums: 'ti-disc', playlists: 'ti-playlist', stations: 'ti-radio', channels: 'ti-device-tv' };
      if (ICO[l.key]) return '<span class="wk-art ico"><i class="ti ' + ICO[l.key] + '"></i></span>';
      if (l.key === 'reacted') {
        if (l.photo) return img(photoFile(l.photo, 'thumb'));
        if (l.posterSmall) return '<span class="wk-art wide"><img src="' + esc(l.posterSmall) + '" alt="" loading="lazy" /></span>';
        return '<span class="wk-art">' + faceHTML(l.username, 'wk-art-face') + '</span>';
      }
      return '';
    }
    function strip(l) {
      const it = l.items || [];
      if (l.key === 'videos') return '<div class="wk-strip">' + it.map(v => '<button type="button" class="wk-thumb wide" data-video="' + v.id + '" title="' + esc(v.title) + '" data-silent>' +
        (v.posterSmall ? '<img src="' + esc(v.posterSmall) + '" alt="" loading="lazy" />' : '<i class="ti ti-movie"></i>') + '</button>').join('') + '</div>';
      if (l.key === 'photos') return '<div class="wk-strip">' + it.map(p => '<button type="button" class="wk-thumb" data-photo="' + esc(p.id) + '" data-post="' + p.postId + '" title="' + esc(p.username) + '" data-silent>' +
        '<img src="' + esc(photoFile(p.id, 'thumb')) + '" alt="" loading="lazy" /></button>').join('') + '</div>';
      if (l.key === 'albums') return '<div class="wk-strip">' + it.map(a => '<button type="button" class="wk-thumb" data-album="' + esc(a.id) + '" data-name="' + esc(a.name) + '" title="' + esc(a.name + ' · ' + a.artist) + '" data-silent>' +
        '<img src="' + esc(ndArt(a.coverArt || a.id, 96)) + '" alt="" loading="lazy" /></button>').join('') + '</div>';
      if (l.key === 'playlists' || l.key === 'stations' || l.key === 'channels') return '<div class="wk-chips">' + it.map(x =>
        '<button type="button" class="k-chip wk-chip" data-' + l.key.slice(0, -1) + '="' + esc(x.id) + '">' +
          (l.key === 'stations' ? '<span class="wk-chip-n">' + Number(x.frequency).toFixed(1) + '</span>' : l.key === 'channels' ? '<span class="wk-chip-n">' + x.number + '</span>' : '<i class="ti ti-playlist"></i>') +
          esc(x.name) + '</button>').join('') + '</div>';
      return '';
    }
    function text(l) {
      switch (l.key) {
        case 'song': return { main: '<b>' + esc(l.song) + '</b> · ' + esc(l.artist),
          sub: plays(l.plays) + ' · ' + esc(whoPlays(l.who)) + (l.albumToo && l.artistToo ? ' · the top album and artist too' : l.albumToo ? ' · the top album too' : l.artistToo ? ' · the top artist too' : '') };
        case 'album': return { main: '<b>' + esc(l.album) + '</b> · ' + esc(l.artist), sub: plays(l.plays) + ' · ' + esc(whoPlays(l.who)) };
        case 'artist': return { main: '<b>' + esc(l.artist) + '</b>', sub: hours(l.seconds) + ' · ' + esc(whoPlays(l.who)) };
        case 'found': return { main: '<b>' + esc(l.kind === 'song' ? l.song : l.artist) + '</b>' + (l.kind === 'song' ? ' · ' + esc(l.artist) : ''),
          sub: esc(l.by) + ' played ' + (l.kind === 'song' ? 'it' : 'them') + ' first; ' + esc(names(l.others)) + ' followed' };
        case 'repeat': return { main: '<b>' + esc(l.song) + '</b> · ' + esc(l.artist), sub: esc(l.username) + ', ' + plays(l.plays) };
        case 'reacted': return {
          main: l.kind === 'video' ? '<b>' + esc(l.title || 'A video') + '</b>' : l.text ? '<b>' + esc(l.text) + '</b>' : '<b>' + esc(l.username) + '’s ' + (l.kind === 'photo' ? 'photo' : l.kind === 'screenshot' ? 'screenshot' : 'post') + '</b>',
          sub: (l.kind === 'video' ? 'Video' : l.kind === 'photo' ? 'Photo' : l.kind === 'screenshot' ? 'Screenshot' : 'Post') + ' by ' + esc(l.username) + ' · ' + klabCount(l.reactions, 'reaction') + ' ' + (l.emoji || []).map(klabReactHTML).join(' ') };
        case 'videos': return { main: '<b>' + klabCount(l.count, 'video') + '</b>', sub: 'from ' + esc(names(l.people)) };
        case 'photos': return { main: '<b>' + klabCount(l.count, 'photo') + '</b>', sub: 'from ' + esc(names(l.people)) };
        case 'playlists': return { main: '<b>' + klabCount(l.count, 'playlist') + '</b> featured', sub: 'by ' + esc(names(l.people)) };
        case 'stations': return { main: '<b>' + klabCount(l.count, 'station') + '</b> on the radio', sub: 'by ' + esc(names(l.people)) };
        case 'channels': return { main: '<b>' + klabCount(l.count, 'channel') + '</b> on TV', sub: 'by ' + esc(names(l.people)) };
        case 'albums': return { main: '<b>' + klabCount(l.count, 'album') + '</b> added to the library', sub: esc(l.items.slice(0, 3).map(a => a.name).join(', ')) + (l.count > 3 ? ' and more' : '') };
      }
      return null;
    }
    const playable = l => ['song', 'repeat', 'album', 'artist', 'found'].includes(l.key);
    function reactsHTML(key) {
      const r = data?.reactions?.[key] || {};
      return Object.entries(r).map(([e, x]) => '<button type="button" class="wk-pill' + (x.mine ? ' mine' : '') + '" data-emoji="' + esc(e) + '" aria-pressed="' + !!x.mine + '">' + klabReactHTML(e) + '<span>' + x.count + '</span></button>').join('');
    }
    function threadHTML(key) {
      const replies = data?.replies?.[key] || [];
      return '<div class="k-com-list wk-com-list">' + klabComments.listHTML(replies, { canDelete: r => r.username === me() || !!window.KLAB_USER?.is_admin }, '') + '</div>' +
        klabComments.formHTML({ cls: 'wk-com-form', placeholder: 'Reply…', inputCls: 'wk-com-input' });
    }
    function lineHTML(l) {
      const t = text(l);
      if (!t) return '';
      const n = (data?.replies?.[l.key] || []).length;
      const isOpen = open.has(l.key);
      return '<div class="wk-line' + (isOpen ? ' open' : '') + '" role="listitem" data-line="' + l.key + '">' +
        '<div class="wk-row">' + art(l) +
          '<div class="wk-tx"><span class="wk-cap">' + CAPS[l.key] + '</span><span class="wk-main">' + t.main + '</span>' +
            (t.sub ? '<span class="wk-sub">' + t.sub + '</span>' : '') + strip(l) + '</div>' +
          '<div class="wk-acts">' +
            '<span class="wk-reacts">' + reactsHTML(l.key) + '</span>' +
            '<button type="button" class="k-icon sm" data-wk="react" title="React" aria-label="React"><i class="ti ti-mood-plus"></i></button>' +
            '<button type="button" class="k-btn sm ghost wk-reply-btn" data-wk="reply" aria-expanded="' + isOpen + '" title="Reply"><i class="ti ti-message-circle"></i>' + (n ? '<span>' + n + '</span>' : '<span>Reply</span>') + '</button>' +
            (playable(l) ? '<button type="button" class="k-icon sm" data-wk="play" title="Play" aria-label="Play"><i class="ti ti-player-play-filled"></i></button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="wk-thread"><div class="wk-thread-in">' + (isOpen ? threadHTML(l.key) : '') + '</div></div>' +
      '</div>';
    }
    function allLines() {
      const lines = (data?.lines || []).slice();
      if (albums.length) {
        // After the music lines, before what was posted.
        const at = lines.findIndex(l => !['song', 'album', 'artist', 'found', 'repeat'].includes(l.key));
        lines.splice(at < 0 ? lines.length : at, 0, { key: 'albums', count: albums.length, items: albums.slice(0, 8) });
      }
      return lines;
    }
    let lastKey = '';
    function render(force) {
      if (!active) return;
      const back = sec.querySelector('[data-wk-go="prev"]'), fwd = sec.querySelector('[data-wk-go="next"]');
      back.disabled = !data?.prev; fwd.disabled = !data?.next;
      if (!data) {
        rangeEl.textContent = '';
        totalsEl.textContent = '';
        linesEl.innerHTML = '<div class="k-empty wk-empty"><div>' + (failed === 404 ? 'This week needs the latest klabnet-api.' : failed ? 'Couldn’t load the week just now.' : 'Loading…') + '</div></div>';
        lastKey = '';
        return;
      }
      rangeEl.textContent = rangeText(data);
      const t = data.totals || {};
      totalsEl.textContent = [
        t.seconds >= 60 ? hours(t.seconds) + ' of music' + (t.listeners > 1 ? ' between ' + t.listeners + ' people' : '') : '',
        t.videosWatched ? klabCount(t.videosWatched, 'video') + ' watched' : '',
        t.posts ? klabCount(t.posts, 'post') : '',
      ].filter(Boolean).join(' · ');
      const lines = allLines();
      const key = JSON.stringify([data.start, lines, data.reactions, data.replies, [...open]]);
      if (key === lastKey && !force) return;
      // Typing a reply: don't redraw over it.
      const typing = linesEl.contains(document.activeElement) && document.activeElement.matches('input');
      if (typing && !force) return;
      lastKey = key;
      linesEl.innerHTML = lines.map(lineHTML).join('') ||
        '<div class="k-empty wk-empty"><div>' + (data.current ? 'Nothing yet this week. It fills in as people listen, watch and post.' : 'Nothing happened that week.') + '</div></div>';
      if (focusLine) {
        const el = linesEl.querySelector('.wk-line[data-line="' + focusLine + '"]');
        focusLine = '';
        if (el) { el.scrollIntoView({ block: 'center', behavior: window.klabMotionOk?.() ? 'smooth' : 'auto' }); el.classList.add('lit'); setTimeout(() => el.classList.remove('lit'), 1600); }
      }
    }
    async function loadAlbums(d) {
      // Navidrome's newest albums, those added in that week (its `created`).
      try {
        const a = day(d.start).getTime(), b = a + 7 * 864e5;
        const r = await fetchTimeout(`${ND_URL}/rest/getAlbumList2?type=newest&size=60&${subsonicParams()}`, {}, 8000);
        const list = (await r.json())['subsonic-response']?.albumList2?.album || [];
        return list.filter(x => { const t = Date.parse(x.created); return t >= a && t < b; })
          .map(x => ({ id: x.id, name: x.name || x.title, artist: x.artist, coverArt: x.coverArt }));
      } catch (e) { return []; }
    }
    async function load(force) {
      if (!force && data && Date.now() - loadedAt < 60e3) { render(); return; }
      const my = ++seq;
      try {
        const r = await fetchTimeout('/api/posts/week?tz=' + tz() + (want ? '&start=' + want : ''), { cache: 'no-store' }, 10000);
        if (my !== seq) return;
        if (r.status === 404 || r.status === 405 || !/json/.test(r.headers.get('content-type') || '')) { failed = 404; data = null; render(); return; }
        if (!r.ok) { failed = r.status || 1; render(); return; }
        const d = await r.json();
        if (my !== seq) return;
        const same = data && data.start === d.start;
        data = d; failed = 0; loadedAt = Date.now();
        if (!same) albums = [];
        render(!same);
        if (!same) {
          const got = await loadAlbums(d);
          if (my !== seq) return;
          albums = got;
          render(true);
        }
      } catch (e) { if (my === seq) { failed = failed || 1; render(); } }
    }
    function go(start) {
      want = start || '';
      open.clear();
      data = null;
      render();
      load(true).then(() => window.klabEnter?.(linesEl));
    }

    // ── Reacting and replying ──
    const lineOf = el => el.closest('.wk-line')?.dataset.line;
    async function react(line, emoji) {
      if (!data) return;
      const wk = data.start;
      try {
        const r = await fetchTimeout('/api/posts/week/' + wk + '/' + line + '/reactions', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji, tz: tz() }),
        }, 8000);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'status ' + r.status);
        if (data?.start !== wk) return;
        data.reactions = data.reactions || {};
        data.reactions[line] = j.reactions;
        const el = linesEl.querySelector('.wk-line[data-line="' + line + '"] .wk-reacts');
        if (el) el.innerHTML = reactsHTML(line);
      } catch (e) { showToast('Couldn’t react to that: ' + klabCap(e.message), 'ti-alert-triangle'); }
    }
    function toggleThread(line, focus) {
      const el = linesEl.querySelector('.wk-line[data-line="' + line + '"]');
      if (!el) return;
      const on = !open.has(line);
      if (on) open.add(line); else open.delete(line);
      el.classList.toggle('open', on);
      el.querySelector('[data-wk="reply"]')?.setAttribute('aria-expanded', on);
      const inner = el.querySelector('.wk-thread-in');
      if (on) {
        inner.innerHTML = threadHTML(line);
        setTimeout(() => klabComments.refreshFaces(inner), 1500);
        if (focus) requestAnimationFrame(() => inner.querySelector('input')?.focus());
      } else setTimeout(() => { if (!open.has(line)) inner.innerHTML = ''; }, 320);
    }
    function countReplies(line) {
      const b = linesEl.querySelector('.wk-line[data-line="' + line + '"] [data-wk="reply"] span');
      const n = (data?.replies?.[line] || []).length;
      if (b) b.textContent = n ? String(n) : 'Reply';
    }
    sec.addEventListener('submit', async e => {
      const form = e.target.closest('.wk-com-form');
      if (!form) return;
      e.preventDefault();
      const input = form.querySelector('input'), line = lineOf(form), txt = input.value.trim();
      if (!txt || !data || !line) return;
      const wk = data.start;
      input.disabled = true;
      try {
        const r = await fetchTimeout('/api/posts/week/' + wk + '/' + line + '/replies', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: txt, tz: tz() }),
        }, 8000);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'status ' + r.status);
        input.value = '';
        if (data?.start !== wk) return;
        (data.replies[line] = data.replies[line] || []).push(j);
        klabComments.fresh(j.id);
        const list = form.parentElement.querySelector('.wk-com-list');
        if (list) list.insertAdjacentHTML('beforeend', klabComments.rowHTML(j, { canDelete: () => true }));
        countReplies(line);
        SFX?.play('send');
      } catch (err) { showToast('Couldn’t reply: ' + klabCap(err.message), 'ti-alert-triangle'); }
      finally { input.disabled = false; input.focus(); }
    });
    async function deleteReply(row, line, id) {
      const list = data?.replies?.[line] || [];
      const found = list.find(r => String(r.id) === String(id));
      if (!found) return;
      // Someone else's (an admin's moderating): asked first, as anywhere.
      if (found.username !== window.KLAB_USER?.username && !(await showConfirmDialog('Delete ' + found.username + '’s reply?', 'It’s gone for everyone.', 'Delete'))) return;
      const i = list.indexOf(found);
      if (i < 0) return;
      const [gone] = list.splice(i, 1);
      klabUndo('Reply deleted', {
        apply: () => { klabComments.remove(row); countReplies(line); },
        undo: () => { list.splice(i, 0, gone); const t = linesEl.querySelector('.wk-line[data-line="' + line + '"] .wk-thread-in'); if (t && open.has(line)) t.innerHTML = threadHTML(line); countReplies(line); },
        commit: async () => { const r = await fetch('/api/posts/week/replies/' + id, { method: 'DELETE', keepalive: true }); if (!r.ok && r.status !== 404) throw new Error('status ' + r.status); },
        failed: 'Couldn’t delete that reply',
      });
    }
    async function playLine(l) {
      if (l.songId) { const s = songOf(l); if (s) { playSong(s); SFX?.play('click'); } return; }
      try {
        const q = encodeURIComponent(l.key === 'album' ? l.album + ' ' + l.artist : l.artist);
        const r = await fetchTimeout(`${ND_URL}/rest/search3?query=${q}&songCount=0&artistCount=${l.key === 'album' ? 0 : 3}&albumCount=${l.key === 'album' ? 5 : 0}&${subsonicParams()}`, {}, 8000);
        const res = (await r.json())['subsonic-response']?.searchResult3 || {};
        if (l.key === 'album') {
          const a = (res.album || []).find(x => x.name === l.album) || (res.album || [])[0];
          if (!a) throw 0;
          const g = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${encodeURIComponent(a.id)}&${subsonicParams()}`, {}, 8000);
          const songs = (await g.json())['subsonic-response']?.album?.song || [];
          if (!songs.length) throw 0;
          playerState.playlist = songs; playerState.playlistIndex = 0;
          playSong(songs[0]);
        } else {
          const a = (res.artist || []).find(x => x.name === l.artist) || (res.artist || [])[0];
          if (!a || !window.klabPlayArtist) throw 0;
          await window.klabPlayArtist(a);
        }
        SFX?.play('click');
      } catch (e) { showToast('Couldn’t find that in the library', 'ti-music-off'); }
    }
    const findLine = key => allLines().find(l => l.key === key);
    sec.addEventListener('click', e => {
      const goBtn = e.target.closest('[data-wk-go]');
      if (goBtn) { const to = goBtn.dataset.wkGo === 'prev' ? data?.prev : data?.next; if (to) { SFX?.play('nav'); go(to === nowWeek() ? '' : to); } return; }
      const del = e.target.closest('.k-com-del');
      if (del) { const row = del.closest('.k-com'); deleteReply(row, lineOf(del), del.dataset.replyId); return; }
      const who = e.target.closest('.k-com-name, .k-com-face[data-username], .wk-art-face[data-u]');
      if (who && !who.closest('.k-com-form')) { openProfileView(who.dataset.username || who.dataset.u); return; }
      const pill = e.target.closest('.wk-pill');
      if (pill) { react(lineOf(pill), pill.dataset.emoji); return; }
      const b = e.target.closest('[data-wk]');
      const line = lineOf(e.target);
      if (b && line) {
        if (b.dataset.wk === 'react') klabReactMenu(b, emoji => react(line, emoji));
        else if (b.dataset.wk === 'reply') toggleThread(line, true);
        else if (b.dataset.wk === 'play') { const l = findLine(line); if (l) playLine(l); }
        return;
      }
      const t = e.target.closest('[data-video], [data-photo], [data-album], [data-playlist], [data-station], [data-channel]');
      if (t) {
        SFX?.play('nav');
        if (t.dataset.video) window.klabOpenVideo?.(+t.dataset.video);
        else if (t.dataset.photo) window.klabOpenPhoto?.(+t.dataset.post, t.dataset.photo);
        else if (t.dataset.album) { setActiveTab('music'); setTimeout(() => window.openAlbumPage?.(t.dataset.album, t.dataset.name), 60); }
        else if (t.dataset.playlist) { setActiveTab('music'); setTimeout(() => window.openPlaylistPage?.(t.dataset.playlist), 60); }
        else if (t.dataset.station) { setActiveTab('music'); setTimeout(() => { document.querySelector('.music-nav .picker-tab[data-tab="radio"]')?.click(); window.klabRadio?.tune?.(t.dataset.station); }, 60); }
        else if (t.dataset.channel) { setActiveTab('videos'); setTimeout(() => window.klabTv?.open(t.dataset.channel), 60); }
        return;
      }
      // The reacted post itself.
      const row = e.target.closest('.wk-line[data-line="reacted"] .wk-tx');
      if (row) { const l = findLine('reacted'); if (!l) return; if (l.kind === 'video') window.klabOpenVideo?.(l.postId); else if (l.kind === 'photo' || l.kind === 'screenshot') window.klabOpenPhoto?.(l.postId, l.photo, l.kind); else window.klabFeedFocus?.(l.postId); }
    });
    sec.addEventListener('contextmenu', e => {
      const el = e.target.closest('.wk-line');
      if (!el || e.target.closest('input')) return;
      const l = findLine(el.dataset.line);
      if (!l) return;
      const people = (l.people || l.who?.map(w => w.username) || []).filter(u => u && u !== me());
      klabMenu(e, [
        { header: CAPS[l.key] },
        { label: 'Play', icon: 'ti-player-play', hidden: !playable(l), action: () => playLine(l) },
        { reacts: KLAB_REACTS, action: emoji => react(l.key, emoji) },
        { label: open.has(l.key) ? 'Hide replies' : 'Reply', icon: 'ti-message-circle', action: () => toggleThread(l.key, !open.has(l.key)) },
        people.length ? '-' : null,
        ...people.slice(0, 6).map(u => ({ label: u, icon: 'ti-user-circle', action: () => openProfileView(u) })),
      ].filter(Boolean));
    });
    // The current week's Monday, as the API names it.
    function nowWeek() {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // From the recap: that week, that line, its replies open.
    window.klabOpenWeek = (start, line) => {
      openWeekSheet();
      const w = start && start !== nowWeek() ? start : '';
      if (line) { open.add(line); focusLine = line; }
      if (w !== want || !data) { want = w; data = null; render(); load(true); }
      else render(true);
    };
    return { el: sec, load, render };
  })();

  // Rooms change by the moment (every 5s while Home shows them); the week
  // more slowly. The running clocks tick once a second (no redraw; paused
  // with the window idle or hidden).
  let poll = 0, tick = 0, slow = 0, homeOn = false, weekOn = false;
  function refresh() {
    if (!homeOn || document.hidden) return;
    together.load();
  }
  function sync() {
    active = homeOn || weekOn;
    clearInterval(poll); clearInterval(tick); clearInterval(slow);
    if (homeOn) {
      together.render(); refresh();
      poll = setInterval(refresh, 5000);
      tick = setInterval(together.step, 1000);
    }
    if (weekOn) {
      week.render(); week.load();
      slow = setInterval(() => { if (!document.hidden) week.load(); }, 60e3);
    }
  }
  window.klabTogether = { el: together.el, shown: on => { if (!!on !== homeOn) { homeOn = !!on; sync(); } }, count: together.count, load: together.load };

  // ── This week, as a sheet ──
  let weekSheet = null, popWeek = null;
  function openWeekSheet() {
    if (!weekSheet) {
      weekSheet = document.createElement('div');
      weekSheet.className = 'add-app-backdrop wk-sheet-back';
      weekSheet.innerHTML = '<div class="add-app-modal wk-sheet" role="dialog" aria-modal="true" aria-label="This week on klabnet" tabindex="-1">' +
        '<button type="button" class="k-icon sm wk-sheet-close" title="Close" aria-label="Close"><i class="ti ti-x"></i></button>' +
        '<div class="wk-sheet-body"></div></div>';
      document.body.appendChild(weekSheet);
      weekSheet.addEventListener('click', e => { if (e.target === weekSheet || e.target.closest('.wk-sheet-close')) closeWeekSheet(); });
    }
    weekSheet.querySelector('.wk-sheet-body').appendChild(week.el);
    if (!weekSheet.classList.contains('open')) {
      weekSheet.classList.add('open');
      SFX?.play('sheet');
      popWeek = window.klabLayers?.push(weekSheet, { kind: 'sheet', dim: true, close: closeWeekSheet });
      weekSheet.querySelector('.wk-sheet').focus({ preventScroll: true });
    }
    weekOn = true; sync();
  }
  function closeWeekSheet() {
    if (!weekSheet?.classList.contains('open')) return;
    weekSheet.classList.remove('open');
    SFX?.play('sheet_close');
    popWeek?.(); popWeek = null;
    weekOn = false; sync();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
