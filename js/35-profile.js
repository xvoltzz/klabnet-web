// ══════════════════════════════════════════
//  PROFILES: a page per person
//  Everywhere a name or a face opens someone (openProfileView, js/08-chat.js
//  had the small card) opens this instead: their banner, face, name, note
//  and bio, what they're doing now, a row of numbers, then Posts, Photos,
//  Gold (their posts with KLAB_GOLD_AT stars or more) and Listening, from
//  klabnet-api's GET /api/posts/people/<name> (routers/people.py). A large
//  panel over the page, Music's look; Esc or Back closes it. An API without
//  the route shows the card part and says so.
// ══════════════════════════════════════════
(function () {
  const API = '/api/posts/people/';
  let el, seq = 0, blobUrls = [], who = '', data = null, pane = 'posts';
  // Their videos (js/39-videos.js), fetched when the tab is opened.
  let vids = null;
  async function loadVideos() {
    if (vids && vids.who === who) return;
    const mine = seq, u = who, box = { who: u, list: null };
    vids = box;
    try {
      const r = await fetchTimeout('/api/posts/videos?limit=24&user=' + encodeURIComponent(u), {}, 10000);
      const j = r.ok ? await r.json() : null;
      if (mine !== seq || vids !== box) { forget(); return; }
      vids.list = j ? (j.videos || []).filter(v => v.status === 'ready') : [];
      vids.total = j?.total || 0;
    } catch { if (mine === seq && vids === box) vids.list = []; else forget(); }
    if (mine === seq && pane === 'videos') paint();
    // Closed (or someone else opened) while it loaded: a list left at null
    // read as "still loading" and was never asked for again, so reopening
    // them sat on "Loading…" for the rest of the session.
    function forget() { if (vids === box && box.list == null) vids = null; }
  }
  // Their clips (js/42-clips.js), the same way.
  let clips = null;
  async function loadClips() {
    if (clips && clips.who === who) return;
    const mine = seq, u = who, box = { who: u, list: null };
    clips = box;
    try {
      const j = await window.klabClips?.forUser(u);
      if (mine !== seq || clips !== box) { forget(); return; }
      clips.list = (j?.clips || []).filter(c => c.status === 'ready');
      clips.total = j?.total || 0;
    } catch { if (mine === seq && clips === box) clips.list = []; else forget(); }
    if (mine === seq && pane === 'clips') paint();
    function forget() { if (clips === box && box.list == null) clips = null; }
  }

  const when = s => s ? new Date(String(s).replace(' ', 'T') + (/[Z+]/.test(s) ? '' : 'Z')) : null;
  const ago = s => { const d = when(s); return d && !isNaN(d) ? shortAgo(d.getTime()) : ''; };
  const hours = sec => sec >= 3600 ? Math.round(sec / 3600).toLocaleString() + ' h' : Math.round(sec / 60) + ' min';
  const cover = (id, size) => id ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}` : '';
  const photoFile = (id, size) => `/api/posts/photos/files/${encodeURIComponent(id)}/${size}?v=2`;
  const songJSON = s => encodeURIComponent(JSON.stringify({ id: s.songId, title: s.song || s.title, artist: s.artist, album: s.album, coverArt: s.coverArt }));

  function build() {
    el = document.createElement('div');
    el.className = 'pf-backdrop';
    el.innerHTML = '<div class="pf" tabindex="-1" role="dialog" aria-modal="true" aria-label="Profile"><div class="pf-scroll"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-pf-close]')) return close();
      const tab = e.target.closest('[data-pf-pane]');
      if (tab) { pane = tab.dataset.pfPane; paint(); if (pane === 'videos') loadVideos(); if (pane === 'clips') loadClips(); return; }
      const clip = e.target.closest('.clip-card[data-clip-id]');
      if (clip) { close(); window.klabClips?.open(+clip.dataset.clipId, { user: who }); return; }
      if (e.target.closest('[data-pf-clips]')) { close(); window.klabClips?.show({ user: who }); return; }
      const vid = e.target.closest('.vid-card[data-vid-id]');
      if (vid) { close(); window.klabOpenVideo?.(+vid.dataset.vidId); return; }
      if (e.target.closest('[data-pf-channel]')) { close(); window.klabOpenChannel?.(who); return; }
      if (e.target.closest('[data-pf-live]')) { close(); window.klabLive?.open(who); return; }
      const party = e.target.closest('[data-pf-room]');
      if (party) { close(); window.klabRooms?.join(party.dataset.pfRoom); return; }
      const song = e.target.closest('[data-pf-song]');
      if (song) {
        try { const s = klabCleanSong(JSON.parse(decodeURIComponent(song.dataset.pfSong))); if (s) klabPlayFrom(s, +song.dataset.at || 0); } catch {}
        return;
      }
      const ph = e.target.closest('[data-pf-photo]');
      if (ph) { close(); window.klabOpenPhoto?.(+ph.dataset.post, ph.dataset.pfPhoto); return; }
      // A post opens in the Feed (not from its links or pictures).
      const post = !e.target.closest('a, button, img, .md-spoiler') && e.target.closest('[data-pf-post]');
      if (post) { close(); window.klabFeedFocus?.(+post.dataset.pfPost); return; }
      const act = e.target.closest('[data-pf-act]')?.dataset.pfAct;
      if (act === 'message') { close(); window.klabCalls ? window.klabCalls.message(who) : messageUser(who); }
      else if (act === 'call') { close(); window.klabCalls?.dial(who); }
      else if (act === 'edit') { close(); openProfileModal(); }
      else if (act === 'note') { close(); window.klabEditNote?.(); }
      else if (act === 'admin') adminMenu(e.target.closest('[data-pf-act]'));
    });
    el.addEventListener('keydown', e => {
      const post = e.key === 'Enter' && e.target.matches?.('[data-pf-post]') && e.target;
      if (post) { close(); window.klabFeedFocus?.(+post.dataset.pfPost); }
    });
    // Right-click: a post, a photo.
    el.addEventListener('contextmenu', e => {
      const post = e.target.closest('[data-pf-post]'), ph = e.target.closest('[data-pf-photo]');
      if (post) {
        const p = [...(data?.posts || []), ...(data?.gold || [])].find(x => x.id === +post.dataset.pfPost);
        klabMenu(e, [
          { label: 'Open in Feed', icon: 'ti-news', action: () => { close(); window.klabFeedFocus?.(+post.dataset.pfPost); } },
          { label: 'Copy text', icon: 'ti-copy', hidden: !p?.text, action: () => klabCopy(p.text, 'Post') },
        ]);
      } else if (ph) {
        klabMenu(e, [
          { label: 'Open in Photos', icon: 'ti-photo', action: () => { close(); window.klabOpenPhoto?.(+ph.dataset.post, ph.dataset.pfPhoto); } },
          { label: 'Copy image', icon: 'ti-copy', action: () => klabCopyImage(photoFile(ph.dataset.pfPhoto, 'medium')) },
        ]);
      }
    });
    // Escape and mouse Back close it when it's the top layer (js/00-util.js).
    klabLayers.watch(el, { kind: 'sheet', dim: true, close: () => close() });
  }

  // An admin's ⋯ on someone else's profile: take down what they've put up
  // (klabnet-api: DELETE /api/notes?user=, PUT /api/profiles/<user>).
  function adminMenu(anchor) {
    const u = who, p = window.klabPresenceOf?.(u) || {}, prof = _profiles.get(u) || {};
    const fix = async (title, body, label, run) => {
      if (!(await showConfirmDialog(title, body, label))) return;
      try {
        const r = await run();
        const j = await r.json().catch(() => null);
        // An API from before this answers a note's DELETE ?user= with a bare ok
        // and does nothing; the new one says what's left ("text").
        if (!r.ok || !j || !('text' in j || 'bio' in j)) throw new Error(r.ok || r.status === 404 || r.status === 405 ? 'That needs the latest klabnet-api' : klabCap(j?.error) || 'Couldn’t change that');
        await Promise.all([typeof fetchProfiles === 'function' ? fetchProfiles() : null, window.klabRefreshNotes?.()]);
        if (u === who && el?.classList.contains('open')) paint();
        SFX && SFX.play('click');
      } catch (err) { showToast(err.message || 'Couldn’t change that', 'ti-alert-triangle'); }
    };
    const put = body => fetchTimeout('/api/profiles/' + encodeURIComponent(u), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 8000);
    klabMenu.at(anchor, [
      { header: 'Admin' },
      { label: 'Clear note', icon: 'ti-message-x', disabled: !p.note, action: () => fix('Clear ' + u + '’s note?', 'It comes off their card for everyone.', 'Clear',
        () => fetchTimeout('/api/notes?user=' + encodeURIComponent(u), { method: 'DELETE' }, 8000)) },
      { label: 'Clear bio', icon: 'ti-x', disabled: !prof.bio, action: () => fix('Clear ' + u + '’s bio?', 'Their profile shows no bio until they write one.', 'Clear', () => put({ bio: '' })) },
      { label: 'Remove banner', icon: 'ti-photo-off', disabled: !prof.banner_mxc, action: () => fix('Remove ' + u + '’s banner?', 'Their profile goes back to a plain banner.', 'Remove', () => put({ banner_mxc: '' })) },
      { label: 'Reset name colour', icon: 'ti-palette', disabled: !prof.chat_color, action: () => fix('Reset ' + u + '’s name colour?', 'Their name goes back to its default colour.', 'Reset', () => put({ chat_color: '' })) },
    ], { align: 'end' });
  }

  let returnFocus = null;
  function close() {
    if (!el?.classList.contains('open')) return;
    el.classList.remove('open');
    SFX && SFX.play('sheet_close');
    const back = returnFocus; returnFocus = null;
    if (back?.isConnected && (!document.activeElement || document.activeElement === document.body || el.contains(document.activeElement))) back.focus?.({ preventScroll: true });
    seq++;
    blobUrls.forEach(u => URL.revokeObjectURL(u));
    blobUrls = [];
  }

  async function open(username) {
    if (!username) return;
    if (!el) build();
    const mine = ++seq;
    who = username;
    data = null;
    pane = 'posts';
    blobUrls.forEach(u => URL.revokeObjectURL(u));
    blobUrls = [];
    if (!el.classList.contains('open')) { returnFocus = document.activeElement; SFX && SFX.play('sheet'); }
    el.classList.add('open');
    el.querySelector('.pf-scroll').innerHTML = ''; // not the last person's pictures
    paint();
    el.querySelector('.pf-scroll').scrollTop = 0;
    el.querySelector('.pf').focus?.();
    // The pictures: the banner and the full-size face, from Matrix.
    const client = MatrixChat?.client, profile = _profiles.get(username) || {};
    const blob = async (mxc, sel, how) => {
      try {
        const url = await MatrixChat.mxcToBlobUrl(mxc, { full: true });
        if (!url) return;
        if (mine !== seq) { URL.revokeObjectURL(url); return; }
        blobUrls.push(url);
        const t = el.querySelector(sel);
        if (t) how(t, url);
      } catch {}
    };
    if (client && profile.banner_mxc) blob(profile.banner_mxc, '.pf-banner', (t, u) => { t.style.backgroundImage = `url("${u}")`; t.classList.add('has'); });
    if (client) {
      client.getProfileInfo(`@${username}:${client.getUserId().split(':')[1]}`).then(info => {
        if (mine !== seq) return;
        if (info?.displayname && info.displayname !== username) {
          const n = el.querySelector('.pf-name'); if (n) n.textContent = info.displayname;
        }
        if (info?.avatar_url) blob(info.avatar_url, '.pf-face', (t, u) => { t.innerHTML = `<img src="${esc(u)}" alt="">`; });
      }).catch(() => {});
    }
    try {
      const r = await fetchTimeout(API + encodeURIComponent(username), {}, 10000);
      const j = r.ok ? await r.json() : { error: r.status === 404 || r.status === 405 ? (r.status === 404 ? 'none' : 'old') : 'fail' };
      if (mine !== seq) return;
      data = j;
      // Nothing posted: open on what they do have (videos first: someone
      // with only videos opened onto an empty Posts).
      if (!j.error && !j.posts?.length) {
        pane = j.counts?.videos ? 'videos' : j.photos?.length ? 'photos' : j.listening?.recent?.length || j.listening?.songs?.length ? 'listening' : 'posts';
        if (pane === 'videos') loadVideos();
      }
    } catch { if (mine === seq) data = { error: 'fail' }; }
    if (mine === seq) paint();
  }

  // ── Drawing ──
  function head() {
    const p = window.klabPresenceOf?.(who) || {};
    const prof = _profiles.get(who) || {};
    const me = who === window.KLAB_USER?.username;
    const face = el.querySelector('.pf-face img')?.getAttribute('src') || window.klabResolveUserAvatar?.(who) || p.avatar;
    const name = el.querySelector('.pf-name')?.textContent || who;
    const banner = el.querySelector('.pf-banner');
    const state = p.online ? (p.away ? 'Away' : 'Online') : data?.lastSeen ? 'Last here ' + ago(data.lastSeen) : 'Offline';
    const live = window.klabLive?.of?.(who) || p.live;
    const now = live
      ? `<button type="button" class="pf-now pf-live" data-pf-live title="Watch the stream"><i class="ti ti-broadcast"></i><span>Live · <b>${esc(live.title || 'Streaming now')}</b>${live.game ? ' · ' + esc(live.game) : ''}</span></button>`
      : p.song
      ? `<button type="button" class="pf-now"${p.songId ? ` data-pf-song="${songJSON({ songId: p.songId, song: p.song, artist: p.artist })}"` : ''}>` +
        `<span class="pz-eq"><i></i><i></i><i></i></span><span><b>${esc(p.song)}</b>${p.artist ? ' · ' + esc(p.artist) : ''}</span></button>`
      : p.room ? `<button type="button" class="pf-now" data-pf-room="${esc(p.room.id)}" title="Join the watch party"><i class="ti ti-users"></i><span>Watching together · <b>${esc(p.room.title)}</b></span></button>` : '';
    return `<div class="pf-banner${banner?.classList.contains('has') ? ' has' : ''}" style="${banner?.style.backgroundImage ? `background-image:${esc(banner.style.backgroundImage)}` : ''}; --c:${profileColor(who)}"></div>
      <button type="button" class="pf-close" data-pf-close title="Close"><i class="ti ti-x"></i></button>
      <div class="pf-head">
        <div class="pf-face" style="--c:${profileColor(who)}">${face ? `<img src="${esc(face)}" alt="">` : esc((who[0] || '?').toUpperCase())}</div>
        <div class="pf-names">
          <h1 class="pf-name">${esc(name)}</h1>
          <div class="pf-sub">@${esc(who)}${window.klabExt?.(who) ? ' · ext ' + window.klabExt(who) : ''} · <span class="pf-state${p.online ? (p.away ? ' away' : ' on') : ''}">${esc(state)}</span>${p.platformInfo?.[1] ? ' · ' + esc(p.platformInfo[1]) : ''}</div>
        </div>
        <div class="pf-actions">${me
          ? '<button type="button" class="k-btn" data-pf-act="note"><i class="ti ti-message-circle"></i>Set a note</button><button type="button" class="k-btn primary" data-pf-act="edit"><i class="ti ti-pencil"></i>Edit profile</button>'
          : (window.klabCalls?.enabled?.() ? '<button type="button" class="k-btn" data-pf-act="call"><i class="ti ti-phone"></i>Call</button>' : '') +
            '<button type="button" class="k-btn primary" data-pf-act="message"><i class="ti ti-message-2-plus"></i>Message</button>' +
            (window.KLAB_USER?.is_admin ? '<button type="button" class="k-btn icon" data-pf-act="admin" title="Admin" aria-label="Admin"><i class="ti ti-dots"></i></button>' : '')}</div>
      </div>
      ${p.note ? `<div class="pf-note">${esc(p.note)}</div>` : ''}
      ${prof.bio ? `<p class="pf-bio">${esc(prof.bio)}</p>` : ''}
      ${now}`;
  }

  function stats(c) {
    const since = data.firstSeen ? when(data.firstSeen) : null;
    const items = [
      [c.posts, c.posts === 1 ? 'post' : 'posts'],
      [c.photos, c.photos === 1 ? 'photo' : 'photos'],
      ...(c.videos ? [[c.videos, c.videos === 1 ? 'video' : 'videos']] : []),
      [c.stars, c.stars === 1 ? 'star' : 'stars'],
      // Nothing listened to: no "0 h".
      ...(c.listened >= 60 ? [[hours(c.listened), 'listened']] : []),
    ];
    if (since && !isNaN(since)) items.push([since.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), 'here since']);
    return '<div class="pf-stats">' + items.map(([v, k]) => `<div><b>${typeof v === 'number' ? v.toLocaleString() : esc(v)}</b><span>${k}</span></div>`).join('') + '</div>';
  }

  function postHTML(p, gold) {
    const text = p.text ? (window.klabMarkdown ? klabMarkdown(p.text, window.KLAB_USER?.username, { inline: p.text.length < 280 }) : esc(p.text)) : '';
    const img = p.image_mxc ? window.klabFeedImage?.(p.image_mxc) : null;
    const s = p.song;
    const song = s && s.songId ? `<button type="button" class="pf-song" data-pf-song="${songJSON(s)}"${s.start > 0 ? ` data-at="${s.start}"` : ''}>
        ${s.coverArt ? `<img src="${esc(cover(s.coverArt, 100))}" alt="" loading="lazy">` : '<span class="pf-song-ph"><i class="ti ti-music"></i></span>'}
        <span class="pf-song-tx"><b>${esc(s.title || 'Unknown')}</b><span>${esc(s.artist || '')}</span>${s.lyric ? `<i>${esc(s.lyric)}</i>` : ''}</span>
        ${s.start > 0 ? `<span class="song-at"><i class="ti ti-clock"></i>${formatTime(s.start)}</span>` : ''}<i class="ti ti-player-play pf-song-play"></i></button>` : '';
    const reacts = Object.entries(p.reactions || {}).map(([k, v]) => `<span class="pf-react${v.mine ? ' mine' : ''}">${klabReactHTML(k)} ${v.count}</span>`).join('');
    const meta = [ago(p.created), p.reply_count ? klabCount(p.reply_count, 'reply', 'replies') : '', gold && p.kind === 'photo' ? 'Photo' : ''].filter(Boolean).join(' · ');
    return `<article class="pf-post${gold ? ' gold' : ''}"${p.kind === 'photo' ? '' : ` data-pf-post="${p.id}" tabindex="0" role="link"`}>
      ${text ? `<div class="pf-post-text md">${text}</div>` : ''}
      ${img ? `<img class="pf-post-img" src="${esc(img)}" alt="" loading="lazy">` : ''}
      ${song}
      <div class="pf-post-foot"><span>${esc(meta)}</span>${reacts ? `<span class="pf-reacts">${reacts}</span>` : ''}</div>
    </article>`;
  }

  function body() {
    if (!data) return '<p class="pf-empty">Loading…</p>';
    if (data.error) return `<p class="pf-empty">${data.error === 'old' ? 'Profiles need the latest klabnet-api' : data.error === 'none' ? 'Nothing from them here yet' : "Couldn't load their page"}</p>`;
    const d = data, L = d.listening || {};
    const tabs = [['posts', 'Posts', d.posts.length], ['photos', 'Photos', d.photos.length], ['videos', 'Videos', d.counts?.videos || 0], ...(window.klabClips ? [['clips', 'Clips', d.counts?.clips || 0]] : []), ['gold', 'Gold', d.gold.length], ['listening', 'Listening', (L.recent || []).length]];
    let html = stats(d.counts) + '<div class="pf-tabs" role="tablist">' + tabs.map(([k, label, n]) =>
      `<button type="button" role="tab" data-pf-pane="${k}" aria-selected="${pane === k}"${!n ? ' class="dim"' : ''}>${label}</button>`).join('') + '</div>';
    if (pane === 'posts') {
      html += d.posts.length ? '<div class="pf-posts">' + d.posts.map(p => postHTML(p)).join('') + '</div>' : '<p class="pf-empty">No posts yet</p>';
    } else if (pane === 'photos') {
      const all = d.photos.flatMap(post => post.photos.map(ph => ({ post, ph })));
      html += all.length ? '<div class="pf-photos">' + all.map(({ post, ph }) =>
        `<button type="button" class="pf-photo" data-pf-photo="${esc(ph.id)}" data-post="${post.id}" style="aspect-ratio:${ph.w && ph.h ? ph.w + '/' + ph.h : '1'}"><img src="${photoFile(ph.id, 'thumb')}" alt="" loading="lazy"></button>`).join('') + '</div>'
        : '<p class="pf-empty">No photos yet</p>';
    } else if (pane === 'videos') {
      const list = vids && vids.who === who ? vids.list : null;
      html += !list ? '<p class="pf-empty">Loading…</p>'
        : list.length ? '<div class="pf-videos">' + list.map(v => window.klabVideoCardHTML?.(v, { noFace: true, noUser: true }) || '').join('') + '</div>' +
            (vids.total > list.length ? '<button type="button" class="k-btn pf-more" data-pf-channel>All ' + vids.total + ' videos</button>' : '')
          : '<p class="pf-empty">No videos yet</p>';
    } else if (pane === 'clips') {
      const list = clips && clips.who === who ? clips.list : null;
      html += !list ? '<p class="pf-empty">Loading…</p>'
        : list.length ? '<div class="pf-videos pf-clips">' + list.map(c => window.klabClips.cardHTML(c, { noUser: true })).join('') + '</div>' +
            (clips.total > list.length ? '<button type="button" class="k-btn pf-more" data-pf-clips>All ' + clips.total + ' clips</button>' : '')
          : '<p class="pf-empty">No clips yet</p>';
    } else if (pane === 'gold') {
      html += d.gold.length ? '<div class="pf-posts">' + d.gold.map(p => postHTML(p, true)).join('') + '</div>'
        : `<p class="pf-empty">Nothing gold yet. A post with ${KLAB_GOLD_AT} stars turns gold</p>`;
    } else {
      const max = Math.max(1, ...(L.artists || []).map(a => a.seconds));
      const row = (s, extra) => `<button type="button" class="pf-track" data-pf-song="${songJSON(s)}">
          ${s.coverArt ? `<img src="${esc(cover(s.coverArt, 100))}" alt="" loading="lazy">` : '<span class="pf-song-ph"><i class="ti ti-music"></i></span>'}
          <span class="pf-song-tx"><b>${esc(s.song || 'Unknown')}</b><span>${esc(s.artist || '')}</span></span><span class="pf-track-x">${esc(extra)}</span></button>`;
      html += (L.artists || []).length || (L.songs || []).length ? `<div class="pf-listen">
          <section><h4>Top artists</h4>${(L.artists || []).map(a => `<div class="pf-artist"><span>${esc(a.name)}</span><span class="pf-bar"><i style="width:${Math.max(4, a.seconds / max * 100)}%"></i></span><span class="pf-track-x">${hours(a.seconds)}</span></div>`).join('') || '<p class="pf-empty pf-left">Nothing yet</p>'}</section>
          ${(L.songs || []).some(s => s.plays > 1) ? `<section><h4>On repeat</h4>${L.songs.filter(s => s.plays > 1).map(s => row(s, klabCount(s.plays, 'play'))).join('')}</section>` : ''}
          <section class="pf-wide"><h4>Recently</h4>${(L.recent || []).map(s => row(s, ago(s.at))).join('')}</section>
        </div>` : '<p class="pf-empty">Nothing listened to yet</p>';
    }
    return html;
  }

  function paint() {
    if (!el) return;
    el.querySelector('.pf-scroll').innerHTML = head() + '<div class="pf-body">' + body() + '</div>';
  }

  // Every caller of the old card (names, faces, the sidebar's "you") gets this.
  openProfileView = open;
  window.klabProfileClose = close;
})();
