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

  const when = s => s ? new Date(String(s).replace(' ', 'T') + (/[Z+]/.test(s) ? '' : 'Z')) : null;
  const ago = s => { const d = when(s); return d && !isNaN(d) ? shortAgo(d.getTime()) : ''; };
  const hours = sec => sec >= 3600 ? Math.round(sec / 3600).toLocaleString() + ' h' : Math.round(sec / 60) + ' min';
  const cover = (id, size) => id ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}` : '';
  const photoFile = (id, size) => `/api/posts/photos/files/${encodeURIComponent(id)}/${size}?v=2`;
  const songJSON = s => encodeURIComponent(JSON.stringify({ id: s.songId, title: s.song || s.title, artist: s.artist, album: s.album, coverArt: s.coverArt }));

  function build() {
    el = document.createElement('div');
    el.className = 'pf-backdrop';
    el.innerHTML = '<div class="pf" role="dialog" aria-modal="true" aria-label="Profile"><div class="pf-scroll"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-pf-close]')) return close();
      const tab = e.target.closest('[data-pf-pane]');
      if (tab) { pane = tab.dataset.pfPane; paint(); return; }
      const song = e.target.closest('[data-pf-song]');
      if (song) {
        try { const s = klabCleanSong(JSON.parse(decodeURIComponent(song.dataset.pfSong))); if (s) klabPlayFrom(s, +song.dataset.at || 0); } catch {}
        return;
      }
      const ph = e.target.closest('[data-pf-photo]');
      if (ph) { close(); window.klabOpenPhoto?.(+ph.dataset.post, ph.dataset.pfPhoto); return; }
      const act = e.target.closest('[data-pf-act]')?.dataset.pfAct;
      if (act === 'message') { close(); messageUser(who); }
      else if (act === 'edit') { close(); openProfileModal(); }
      else if (act === 'note') { close(); window.klabEditNote?.(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.classList.contains('open') && !document.getElementById('chatModalBackdrop')?.classList.contains('open')) {
        e.preventDefault(); e.stopPropagation(); close();
      }
    }, true);
  }

  function close() {
    if (!el?.classList.contains('open')) return;
    el.classList.remove('open');
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
      if (!j.error && !j.posts?.length && (j.listening?.songs?.length || j.photos?.length)) pane = j.photos?.length ? 'photos' : 'listening';
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
    const now = p.song
      ? `<button type="button" class="pf-now"${p.songId ? ` data-pf-song="${songJSON({ songId: p.songId, song: p.song, artist: p.artist })}"` : ''}>` +
        `<span class="pz-eq"><i></i><i></i><i></i></span><span><b>${esc(p.song)}</b>${p.artist ? ' · ' + esc(p.artist) : ''}</span></button>` : '';
    return `<div class="pf-banner${banner?.classList.contains('has') ? ' has' : ''}" style="${banner?.style.backgroundImage ? `background-image:${esc(banner.style.backgroundImage)}` : ''}; --c:${profileColor(who)}"></div>
      <button type="button" class="pf-close" data-pf-close title="Close"><i class="ti ti-x"></i></button>
      <div class="pf-head">
        <div class="pf-face" style="--c:${profileColor(who)}">${face ? `<img src="${esc(face)}" alt="">` : esc((who[0] || '?').toUpperCase())}</div>
        <div class="pf-names">
          <h1 class="pf-name">${esc(name)}</h1>
          <div class="pf-sub">@${esc(who)} · <span class="pf-state${p.online ? (p.away ? ' away' : ' on') : ''}">${esc(state)}</span>${p.platformInfo?.[1] ? ' · ' + esc(p.platformInfo[1]) : ''}</div>
        </div>
        <div class="pf-actions">${me
          ? '<button type="button" class="ap-btn-queue" data-pf-act="note"><i class="ti ti-message-circle"></i>Set a note</button><button type="button" class="chat-connect-btn" data-pf-act="edit"><i class="ti ti-pencil"></i>Edit profile</button>'
          : '<button type="button" class="chat-connect-btn" data-pf-act="message"><i class="ti ti-message-2-plus"></i>Message</button>'}</div>
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
      [c.stars, c.stars === 1 ? 'star' : 'stars'],
      [c.listened ? hours(c.listened) : '0 h', 'listened'],
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
    const reacts = Object.entries(p.reactions || {}).map(([k, v]) => `<span class="pf-react${v.mine ? ' mine' : ''}">${(window.klabEmojiKey || esc)(k)} ${v.count}</span>`).join('');
    const meta = [ago(p.created), p.reply_count ? klabCount(p.reply_count, 'reply', 'replies') : '', gold && p.kind === 'photo' ? 'Photo' : ''].filter(Boolean).join(' · ');
    return `<article class="pf-post${gold ? ' gold' : ''}">
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
    const tabs = [['posts', 'Posts', d.posts.length], ['photos', 'Photos', d.photos.length], ['gold', 'Gold', d.gold.length], ['listening', 'Listening', (L.recent || []).length]];
    let html = stats(d.counts) + '<div class="pf-tabs" role="tablist">' + tabs.map(([k, label, n]) =>
      `<button type="button" role="tab" data-pf-pane="${k}" aria-selected="${pane === k}"${!n ? ' class="dim"' : ''}>${label}</button>`).join('') + '</div>';
    if (pane === 'posts') {
      html += d.posts.length ? '<div class="pf-posts">' + d.posts.map(p => postHTML(p)).join('') + '</div>' : '<p class="pf-empty">No posts yet</p>';
    } else if (pane === 'photos') {
      const all = d.photos.flatMap(post => post.photos.map(ph => ({ post, ph })));
      html += all.length ? '<div class="pf-photos">' + all.map(({ post, ph }) =>
        `<button type="button" class="pf-photo" data-pf-photo="${esc(ph.id)}" data-post="${post.id}" style="aspect-ratio:${ph.w && ph.h ? ph.w + '/' + ph.h : '1'}"><img src="${photoFile(ph.id, 'thumb')}" alt="" loading="lazy"></button>`).join('') + '</div>'
        : '<p class="pf-empty">No photos yet</p>';
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
