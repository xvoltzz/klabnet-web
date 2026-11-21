// ══════════════════════════════════════════
//  CONTACTS — Social's front
//  The owner (2026-11-20): "maybe instead of a browse on social it starts
//  off in Contacts! and it shows everyone on the site and lets u message,
//  call, or share something with".
//    · Everyone on klabnet, Music's list look: speed dial first, then who's
//      online (what they're doing, from presence), then everyone else by
//      when they were last here. Each row: face, name, extension, what
//      they're doing, and Message / Call / Share / ⋯ (the same as its
//      right-click menu).
//    · "Find someone or dial a number": letters filter by name, digits by
//      extension (Enter calls the number).
//    · Calls: the call log (js/46-calls.js), missed ones marked.
//    · Keys: ↑/↓ between rows, Enter messages, c calls, s shares, the
//      menu key or Shift+F10 opens the menu; / finds.
//  The tab key is still 'social' (#social), so every old link lands here.
// ══════════════════════════════════════════
(function () {
  const page = document.getElementById('ctPage');
  if (!page) return;
  const me = () => window.KLAB_USER?.username || '';
  const sfx = n => { try { SFX && SFX.play(n); } catch (e) {} };
  const color = u => (typeof profileColor === 'function' ? profileColor(u) : 'var(--text)');
  const calls = () => window.klabCalls;
  const when = s => s ? new Date(String(s).replace(' ', 'T') + (/[Z+]/.test(s) ? '' : 'Z')).getTime() : 0;

  page.innerHTML =
    '<div class="k-page-head ct-head"><h2 class="k-page-title">Contacts</h2><span class="k-page-count" id="ctCount"></span>' +
      '<div class="k-page-actions">' +
        '<div class="k-seg ct-views" role="tablist" aria-label="Contacts">' +
          '<button type="button" role="tab" data-ctv="people" aria-selected="true">People</button>' +
          '<button type="button" role="tab" data-ctv="calls" aria-selected="false">Calls<span class="ct-missed" hidden></span></button></div>' +
        '<button type="button" class="k-btn" id="ctDialBtn" hidden><i class="ti ti-dialpad"></i><span>Dialer</span></button>' +
      '</div></div>' +
    '<label class="k-field-box ct-find"><i class="ti ti-search"></i><input type="text" id="ctFind" placeholder="Find someone or dial a number" aria-label="Find someone or dial a number" autocomplete="off" spellcheck="false" /></label>' +
    '<div class="ct-list" id="ctList" role="list"></div>';
  const listEl = page.querySelector('#ctList'), findEl = page.querySelector('#ctFind'), countEl = page.querySelector('#ctCount');
  const dialBtn = page.querySelector('#ctDialBtn');
  let view = 'people', active = false, stats = new Map(), statsAt = 0, lastHTML = '';

  async function loadStats(force) {
    if (!force && Date.now() - statsAt < 60e3) return;
    statsAt = Date.now();
    try {
      const r = await fetchTimeout('/api/posts/people', {}, 8000);
      if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return;
      stats = new Map(((await r.json()).people || []).map(p => [p.username, p]));
      paint();
    } catch (e) {}
  }

  function everyone() {
    const set = new Set([...stats.keys(), ...(window.klabRoster?.() || []), ...(window.KLAB_ONLINE_USERNAMES || [])]);
    return [...set].filter(u => u && u !== me() && u !== 'anonymous' && !u.endsWith('-bot'));
  }
  // What they're doing, as Home's rows say it (js/33-plaza.js).
  const WHERE = { home: 'Home', social: 'In contacts', together: 'Social', feed: 'On the feed', chat: 'In chat', photos: 'Looking at photos', videos: 'Watching videos', music: 'In music', radio: 'On the radio', tv: 'Watching TV' };
  function stateOf(u) {
    const p = window.klabPresenceOf?.(u) || {};
    const on = !!p.online;
    const live = window.klabLive?.of?.(u) || (on ? p.live : null) || null;
    const voice = on ? window.klabVoice?.where?.(u) || null : null;
    let doing = '', tone = on ? 'on' : 'off';
    if (live) doing = 'Live' + (live.title ? ' · ' + live.title : '');
    else if (on && p.call) doing = 'On a call';
    else if (on && p.song) doing = p.song + (p.artist ? ' · ' + p.artist : '');
    else if (on) doing = voice?.sharing ? 'Sharing in ' + voice.channel : p.room ? 'Watching together · ' + p.room.title
      : voice ? 'In voice · ' + voice.channel : p.paused ? 'Paused · ' + p.paused.song : ['Not listening', WHERE[p.where]].filter(Boolean).join(' · ');
    else { const t = when(stats.get(u)?.lastSeen); doing = t && typeof shortAgo === 'function' ? 'Last here ' + shortAgo(t) : ''; }
    if (on && p.status === 'dnd') { doing = 'Do not disturb · ' + doing; tone = 'dnd'; }
    else if (on && p.away) { doing = 'Away'; tone = 'away'; }
    return { on, doing, tone, playing: on && !!p.song, live: !!live, seen: when(stats.get(u)?.lastSeen), p, voice, stream: live };
  }

  function faceHTML(u, tone) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="ct-face" style="--c:' + color(u) + '">' + (url ? '<img src="' + esc(url) + '" alt="" draggable="false" />' : '<b>' + esc(u[0].toUpperCase()) + '</b>') +
      '<i class="ct-dot ' + tone + '"></i></span>';
  }
  // What pressing someone on Home does: join what they're in, else message.
  function joinOf(u, s) {
    if (!s.on) return null;
    if (s.stream) return { label: 'Watch', icon: 'ti-broadcast', run: () => window.klabLive?.open(u) };
    if (s.p.room?.id && window.klabRooms) return { label: 'Join', icon: 'ti-movie', run: () => window.klabRooms.join(s.p.room.id) };
    if (s.voice && window.klabVoice) return { label: 'Join', icon: 'ti-microphone', run: () => window.klabVoice.join(+s.voice.id, { watch: !!s.voice.sharing }) };
    if (s.playing && !s.p.radio) return { label: 'Listen along', icon: 'ti-headphones', run: () => window.klabListenAlong?.(u) };
    return null;
  }
  function rowHTML(u, s, opts) {
    const ext = calls()?.ext(u);
    const j = opts?.join ? joinOf(u, s) : null;
    const canCall = !!calls()?.enabled();
    return '<div class="ct-row' + (s.on ? '' : ' off') + '" role="listitem" tabindex="-1" data-u="' + esc(u) + '">' +
      faceHTML(u, s.tone) +
      '<span class="ct-tx"><span class="ct-name"><b style="color:' + color(u) + '">' + esc(u) + '</b>' + (ext ? '<span class="ct-ext">ext ' + ext + '</span>' : '') + '</span>' +
      (s.doing ? '<span class="ct-sub">' + (s.playing ? '<span class="pz-eq"><i></i><i></i><i></i></span>' : s.live ? '<i class="ti ti-broadcast"></i>' : '') + esc(s.doing) + '</span>' : '') + '</span>' +
      (j ? '<button type="button" class="k-btn sm ct-join" data-ct="join"><i class="ti ' + j.icon + '"></i><span>' + esc(j.label) + '</span></button>' : '') +
      '<span class="ct-acts">' +
        '<button type="button" class="k-icon sm" data-ct="message" title="Message (Enter)" aria-label="Message ' + esc(u) + '"><i class="ti ti-message-circle"></i></button>' +
        (canCall ? '<button type="button" class="k-icon sm" data-ct="call" title="Call (c)" aria-label="Call ' + esc(u) + '"><i class="ti ti-phone"></i></button>' : '') +
        '<button type="button" class="k-icon sm" data-ct="share" title="Share something (s)" aria-label="Share something with ' + esc(u) + '" aria-haspopup="menu"><i class="ti ti-share-2"></i></button>' +
        '<button type="button" class="k-icon sm" data-ct="more" title="More" aria-label="More" aria-haspopup="menu"><i class="ti ti-dots"></i></button>' +
      '</span></div>';
  }

  function paint() {
    if (!active) return;
    const c = calls();
    dialBtn.hidden = !c?.enabled();
    const missed = c?.missed?.() || 0;
    const mb = page.querySelector('.ct-missed');
    mb.hidden = !missed; mb.textContent = String(missed);
    page.querySelectorAll('[data-ctv]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ctv === view)));
    page.querySelector('[data-ctv="calls"]').hidden = !c?.enabled();
    const mine = c?.ext(me());
    let html = '';
    if (view === 'calls') {
      const log = c?.log() || [];
      countEl.textContent = log.length ? klabCount(log.length, 'call') : '';
      html = log.length ? log.map(r => c.logRowHTML(r)).join('') : '<div class="k-empty"><i class="ti ti-phone"></i><div>No calls yet.</div></div>';
    } else {
      const q = findEl.value.trim().toLowerCase().replace(/^@/, '');
      const digits = /^\d+$/.test(q);
      const people = everyone().map(u => ({ u, s: stateOf(u) }));
      countEl.textContent = (people.length ? klabCount(people.length, 'person', 'people') : '') + (mine ? ' · you’re ext ' + mine : '');
      const hit = x => !q || (digits ? String(c?.ext(x.u) || '').startsWith(q) : x.u.toLowerCase().includes(q));
      const shown = people.filter(hit);
      const favs = (c?.favorites() || []).filter(u => shown.some(x => x.u === u));
      const byName = (a, b) => a.u.localeCompare(b.u);
      const online = shown.filter(x => x.s.on && !favs.includes(x.u)).sort((a, b) => (b.s.playing - a.s.playing) || (a.s.tone === 'away') - (b.s.tone === 'away') || byName(a, b));
      const offline = shown.filter(x => !x.s.on && !favs.includes(x.u)).sort((a, b) => (b.s.seen - a.s.seen) || byName(a, b));
      const sec = (label, list) => list.length ? '<div class="k-label ct-label">' + label + '</div>' + list.map(x => rowHTML(x.u, x.s)).join('') : '';
      // Three digits that are someone's: one press to call them.
      const who = digits && q.length === 3 ? c?.whoIs(q) : null;
      if (digits && c?.enabled()) {
        html += '<button type="button" class="ct-dial-row" data-dial="' + esc(q) + '"' + (q.length === 3 && !who ? ' disabled' : '') + '><i class="ti ti-phone"></i><span>' +
          (who ? 'Call ' + esc(q) + ' · <b>' + esc(who) + '</b>' : q.length === 3 ? 'Nobody has ' + esc(q) : 'Call ' + esc(q) + '…') + '</span><kbd>Enter</kbd></button>';
      }
      html += sec('Speed dial', favs.map(u => shown.find(x => x.u === u))) + sec('Online', online) + sec(q ? 'Everyone else' : 'Everyone else', offline);
      if (!shown.length) html += '<div class="k-empty"><i class="ti ti-search"></i><div>' + (q ? 'Nobody called “' + esc(q) + '”.' : 'Nobody else is here yet.') + '</div></div>';
    }
    if (html === lastHTML) return;
    // Keep the keyboard where it was across a repaint (presence moves often).
    const focused = document.activeElement?.closest?.('.ct-row')?.dataset.u;
    lastHTML = html;
    listEl.innerHTML = html;
    if (focused) listEl.querySelector('.ct-row[data-u="' + CSS.escape(focused) + '"]')?.focus({ preventScroll: true });
  }

  // ── Sharing something with someone (as a chat message) ──
  async function sendTo(u, content, what) {
    const client = window.MatrixChat?.client;
    if (!client) { calls()?.message(u); return; } // says "Chat isn't connected yet", with Connect
    const ok = await startDm('@' + u + ':' + client.getUserId().split(':')[1]);
    if (!ok || typeof _chatActiveRoomId === 'undefined' || !_chatActiveRoomId) return;
    try {
      await client.sendMessage(_chatActiveRoomId, content);
      sfx('star');
      showToast('Sent ' + what + ' to ' + u, 'ti-send-2', { action: { label: 'Open', run: () => { setActiveTab('chat'); setChatMobileView?.('convo'); } } });
    } catch (e) { sfx('error'); showToast('Couldn’t send it', 'ti-alert-triangle'); }
  }
  const link = hash => location.origin + location.pathname + '#' + hash;
  const sendText = (u, body, what) => sendTo(u, { msgtype: 'm.text', body }, what);
  function sendSong(u, s, at) {
    const song = { id: s.id, title: s.title || '', artist: s.artist || '', album: s.album || '', coverArt: s.coverArt || '', ...(at ? { at } : {}) };
    return sendTo(u, { msgtype: 'm.text', body: '🎵 ' + song.title + (song.artist ? ' — ' + song.artist : ''), 'klab.song': song }, 'a song');
  }
  function sendVideo(u, v, at) {
    const s = { id: v.id, title: v.title, poster: v.posterSmall || v.poster || '', duration: v.duration || 0, username: v.username, ...(at ? { start: at } : {}) };
    return sendTo(u, { msgtype: 'm.text', body: '🎬 ' + s.title + ' · ' + link('videos/' + s.id), 'klab.video': s }, 'a video');
  }
  async function shareMenu(u, anchor, e) {
    const ps = typeof playerState !== 'undefined' ? playerState : null;
    const song = ps?.currentSong;
    const watching = window.klabWatch?.watching?.() ? window.klabWatch.current() : null;
    const vt = watching ? Math.floor(window.klabWatch.video()?.currentTime || 0) : 0;
    const items = [
      { header: 'Send ' + u },
      song ? { label: song.title || 'What’s playing', icon: 'ti-music', hint: 'Playing', action: () => sendSong(u, song, window.klabMomentNow?.() || 0) } : null,
      watching ? { label: watching.title || 'This video', icon: 'ti-movie', hint: 'Watching', action: () => sendVideo(u, watching, vt > 5 ? vt : 0) } : null,
      { label: 'A video…', icon: 'ti-movie', action: () => pickVideo(u) },
      (window._pls || (typeof _pls !== 'undefined' ? _pls : null))?.length ? { label: 'A playlist…', icon: 'ti-playlist', action: () => pickPlaylist(u) } : null,
      window.klabTv ? { label: 'A TV channel…', icon: 'ti-device-tv', action: () => pickTv(u) } : null,
      '-',
      { label: 'A link to this page', icon: 'ti-link', action: () => sendText(u, location.href, 'a link') },
    ].filter(Boolean);
    if (e) klabMenu(e, items); else klabMenu.at(anchor, items, { align: 'end' });
  }
  async function pickVideo(u) {
    let vids = [];
    try { const r = await fetchTimeout('/api/posts/videos?limit=20&sort=new', {}, 8000); if (r.ok) vids = ((await r.json()).videos || []).filter(v => v.status === 'ready'); } catch (e) {}
    const i = await showChoiceDialog('Send ' + u + ' a video', vids.map(v => ({ label: v.title || 'Untitled', sub: v.username })), 'No videos yet');
    if (i != null) sendVideo(u, vids[i], 0);
  }
  async function pickPlaylist(u) {
    const list = (typeof _pls !== 'undefined' ? _pls : []).filter(p => p && p.name);
    const i = await showChoiceDialog('Send ' + u + ' a playlist', list.map(p => ({ label: p.name, sub: p.count ? klabCount(p.count, 'song') : '' })), 'No playlists yet');
    if (i != null) sendText(u, '🎧 ' + list[i].name + ' · a playlist on klabnet (Music → Playlists)', 'a playlist');
  }
  async function pickTv(u) {
    let chs = [];
    try { chs = (await window.klabTv.channels()) || []; } catch (e) {}
    const i = await showChoiceDialog('Send ' + u + ' a TV channel', chs.map(c => ({ label: c.number + ' · ' + c.name, sub: c.title || '' })), 'No TV channels yet');
    if (i != null) sendText(u, '📺 ' + chs[i].name + ' (channel ' + chs[i].number + ') · ' + link('videos/tv/' + chs[i].number), 'a TV channel');
  }

  // ── A row's actions ──
  function menuItems(u) {
    const c = calls(), ext = c?.ext(u), fav = c?.isFav(u);
    const admin = !!window.KLAB_USER?.is_admin;
    return [
      { header: u },
      { label: 'Message', icon: 'ti-message-circle', hint: 'Enter', action: () => c ? c.message(u) : messageUser(u) },
      { label: 'Call', icon: 'ti-phone', hint: 'c', hidden: !c?.enabled(), action: () => c.dial(u) },
      { label: 'Share something…', icon: 'ti-share-2', hint: 's', action: () => setTimeout(() => shareMenu(u, rowOf(u)?.querySelector('[data-ct="share"]') || rowOf(u)), 0) },
      '-',
      { label: 'Profile', icon: 'ti-user-circle', action: () => openProfileView?.(u) },
      { label: fav ? 'Remove from speed dial' : 'Add to speed dial', icon: fav ? 'ti-star-filled' : 'ti-star', hidden: !c?.enabled(), action: () => c.setFav(u, !fav) },
      { label: ext ? 'Copy extension · ' + ext : 'Copy extension', icon: 'ti-copy', hidden: !ext, action: () => klabCopy(String(ext), 'Extension') },
      { label: 'Change extension…', icon: 'ti-pencil', hidden: !admin || !c?.enabled(), action: () => c.changeExt(u) },
    ];
  }
  const rowOf = u => listEl.querySelector('.ct-row[data-u="' + CSS.escape(u) + '"]');
  function act(a, u, el, e) {
    const c = calls();
    if (a === 'message') c ? c.message(u) : messageUser(u);
    else if (a === 'call') c?.dial(u);
    else if (a === 'share') shareMenu(u, el, e);
    else if (a === 'more') klabMenu.at(el, menuItems(u), { align: 'end' });
    else if (a === 'join') { sfx('click'); joinOf(u, stateOf(u))?.run(); }
  }
  listEl.addEventListener('click', e => {
    const b = e.target.closest('[data-ct]');
    const row = e.target.closest('.ct-row');
    if (b && row) { act(b.dataset.ct, row.dataset.u, b); return; }
    const d = e.target.closest('[data-dial]');
    if (d) { calls()?.dial(d.dataset.dial); return; }
    const lr = e.target.closest('.cl-log-row[data-call]');
    if (lr) { calls()?.dial(lr.dataset.call); return; }
    // The row itself: the profile (the buttons are what they say).
    if (row && !e.target.closest('button')) { row.focus({ preventScroll: true }); openProfileView?.(row.dataset.u); }
  });
  listEl.addEventListener('contextmenu', e => {
    const row = e.target.closest('.ct-row, .cl-log-row[data-call]');
    if (!row) return;
    const u = row.dataset.u || row.dataset.call;
    klabMenu(e, row.classList.contains('cl-log-row')
      ? [{ header: u }, { label: 'Call back', icon: 'ti-phone', action: () => calls()?.dial(u) }, ...menuItems(u).slice(1).filter(i => i === '-' || !/^Call$/.test(i.label || ''))]
      : menuItems(u));
  });

  // ── Keys ──
  const rows = () => [...listEl.querySelectorAll('.ct-row, .cl-log-row, .ct-dial-row:not([disabled])')];
  function move(dir) {
    const all = rows();
    if (!all.length) return;
    const i = all.indexOf(document.activeElement?.closest?.('.ct-row, .cl-log-row, .ct-dial-row'));
    const next = all[i < 0 ? (dir > 0 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, i + dir))];
    next.focus(); next.scrollIntoView({ block: 'nearest' });
  }
  page.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const row = e.target.closest?.('.ct-row');
    const inFind = e.target === findEl;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (inFind) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const q = findEl.value.trim();
        if (/^\d+$/.test(q) && calls()?.enabled()) calls().dial(q);
        else move(1);
      } else if (e.key === 'Escape' && findEl.value) { e.preventDefault(); e.stopPropagation(); findEl.value = ''; paint(); }
      return;
    }
    if (!row) return;
    const u = row.dataset.u;
    if (['Enter', 'c', 's', '/', 'ContextMenu', 'F10'].includes(e.key)) e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); act('message', u, row); }
    else if (e.key === 'c') { e.preventDefault(); act('call', u, row); }
    else if (e.key === 's') { e.preventDefault(); shareMenu(u, row.querySelector('[data-ct="share"]')); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); klabMenu.at(row.querySelector('[data-ct="more"]'), menuItems(u), { align: 'end' }); }
    else if (e.key === '/') { e.preventDefault(); findEl.focus(); }
  }, true);
  findEl.addEventListener('input', () => { if (view !== 'people') { view = 'people'; } paint(); });
  page.querySelector('.ct-views').addEventListener('click', e => {
    const b = e.target.closest('[data-ctv]');
    if (!b || b.dataset.ctv === view) return;
    sfx('click');
    view = b.dataset.ctv;
    lastHTML = '';
    paint();
    klabEnter?.(listEl);
    if (view === 'calls') calls()?.loadLog();
  });
  dialBtn.addEventListener('click', () => calls()?.openDialer(/^\d+$/.test(findEl.value.trim()) ? findEl.value.trim() : ''));

  // ── Coming and going ──
  let presenceT = 0;
  window.klabContactsTabChanged = on => {
    if (on === active) return;
    active = on;
    clearInterval(presenceT);
    if (!on) return;
    lastHTML = '';
    paint();
    loadStats();
    calls()?.loadLog();
    // What people are doing moves with presence; a light repaint every 10s
    // (only when it would read differently) catches last-seen times too.
    presenceT = setInterval(() => { if (!document.hidden) paint(); }, 10e3);
  };
  window.klabContacts = {
    show: v => { view = v === 'calls' ? 'calls' : 'people'; lastHTML = ''; setActiveTab('social'); paint(); },
    share: (u, anchor) => shareMenu(u, anchor),
    // For Home's Online list (js/33-plaza.js): the same rows and actions.
    // opts.join adds the button for what they're in (Listen along, Join…).
    stateOf, rowHTML, act, joinOf,
    menu: u => { const s = stateOf(u), j = joinOf(u, s); const items = menuItems(u);
      return j ? [items[0], { label: j.label, icon: j.icon, action: j.run }, ...items.slice(1)] : items; },
    loadStats,
  };
  window.addEventListener('klab:calls', () => paint());
  window.addEventListener('klab:people', () => { lastHTML = ''; paint(); });
  // Presence changing (Home's hook is chained by every page that cares).
  const presenceChanged = window.klabHomePresenceChanged;
  window.klabHomePresenceChanged = () => { presenceChanged?.(); paint(); };
  if (document.body.classList.contains('tab-social-active')) window.klabContactsTabChanged(true);
})();
