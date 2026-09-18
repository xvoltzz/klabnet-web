// ══════════════════════════════════════════
//  PRESENCE SYSTEM — inline "// users" section, always
//  visible (not a hidden sidebar). Polls from page load
//  rather than waiting on a toggle click.
// ══════════════════════════════════════════
(function() {
  const API     = '/api/presence';
  const POLL_MS = 8000;
  let _timer    = null;

  const list = document.getElementById('presenceList');
  if (!list) return;

  // ── Matrix avatars ───────────────────────
  // Opportunistic, 100% client-side: if (and only if) this viewer's own
  // MatrixChat session is connected, resolve each listed username's own
  // Matrix avatar directly from the homeserver (assumes klabnet usernames
  // match Matrix localparts on the same server_name as the logged-in
  // user — true by construction, since Matrix login here delegates to the
  // same Authentik identity). No backend involved, no change to
  // /api/presence's schema — this is purely a rendering enhancement on
  // top of the existing username string already in each presence entry.
  // A viewer who hasn't connected chat just keeps seeing initials, same
  // as before.
  const _avatarCache   = new Map(); // username -> https URL, or null (no avatar / lookup failed)
  const _avatarPending = new Set();
  let _lastOthers = [];

  // Persisted avatar cache (data: URIs, survive page reloads) — separate
  // from _avatarCache above, which is realtime-fresh but (a) can only
  // start resolving once THIS viewer's own Matrix client has connected,
  // which for a first-time visitor waits on a user gesture before it even
  // starts, and (b) holds blob: URLs, which don't survive a reload anyway.
  // Reading this synchronously below means a returning visitor's
  // already-seen faces show up with zero network round trip — "instant,"
  // rather than waiting on Matrix to connect and a profile lookup to
  // finish — with the live Matrix lookup only needed to catch avatar
  // changes or resolve someone genuinely new to this browser.
  const AVATAR_CACHE_KEY = 'klabnet_avatar_cache_v1';
  function loadPersistedAvatars() {
    try { return JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function persistAvatar(username, dataUri) {
    try {
      const cache = loadPersistedAvatars();
      cache[username] = dataUri;
      localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {} // storage full/unavailable — the live blob: URL this session still works fine either way
  }
  function clearPersistedAvatar(username) {
    try {
      const cache = loadPersistedAvatars();
      delete cache[username];
      localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }
  // fetch() on a blob: URL just re-reads the already-in-memory blob (no
  // network) — cheaper than plumbing the raw Blob back out of
  // MatrixChat.mxcToBlobUrl(), which other consumers (chat timeline) use
  // as-is and shouldn't need to change shape for this.
  function persistAvatarFromBlobUrl(username, blobUrl) {
    fetch(blobUrl).then(r => r.blob()).then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    })).then(dataUri => persistAvatar(username, dataUri)).catch(() => {});
  }
  const _persistedAvatars = loadPersistedAvatars();

  function ensureAvatarResolved(username) {
    if (!username || _avatarCache.has(username) || _avatarPending.has(username)) return;
    if (_persistedAvatars[username]) _avatarCache.set(username, _persistedAvatars[username]);
    const client = MatrixChat.client;
    if (!client) return;
    _avatarPending.add(username);
    (async () => {
      try {
        const serverName = client.getUserId().split(':')[1];
        const info = await client.getProfileInfo(`@${username}:${serverName}`);
        if (info?.avatar_url) {
          const blobUrl = await MatrixChat.mxcToBlobUrl(info.avatar_url);
          _avatarCache.set(username, blobUrl);
          if (blobUrl) persistAvatarFromBlobUrl(username, blobUrl);
        } else {
          // Profile fetch succeeded and definitively has no avatar set —
          // safe to clear a stale cached one.
          _avatarCache.set(username, null);
          clearPersistedAvatar(username);
        }
      } catch (e) {
        // The lookup itself failed (network, no Matrix account, timeout,
        // etc.) — keep whatever we already had (persisted cache or
        // nothing) rather than overwriting a perfectly good cached
        // avatar with a miss just because this one attempt didn't finish.
        if (!_avatarCache.has(username)) _avatarCache.set(username, null);
      } finally {
        _avatarPending.delete(username);
        // Rebuild with whatever we last fetched — the resolved avatar changes
        // the HTML this time, so the diff check below won't skip it.
        renderList(_lastOthers);
      }
    })();
  }

  // Exposed so openProfileModal() (KLAB SOCIAL section, defined earlier in
  // this script but hoisted) can invalidate *your own* cached avatar after
  // an upload — _avatarCache is private to this IIFE, so there's no other
  // way in from outside.
  window.KLAB_REFRESH_MY_AVATAR = function() {
    const me = window.KLAB_USER?.username;
    if (me) {
      // Also drop the cached banner. Someone with no banner is cached as a
      // negative, so without this the one they just uploaded wouldn't show
      // until a reload. Revoke first — same leak the avatar path had.
      const oldBanner = _bannerCache.get(me);
      if (oldBanner) URL.revokeObjectURL(oldBanner);
      _bannerCache.delete(me);
      // Same "revoke before dropping the cache entry" fix as
      // invalidateMsgAvatar() — this used to leak the old blob URL here too.
      const oldUrl = _avatarCache.get(me);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      _avatarCache.delete(me); clearPersistedAvatar(me);
    }
    renderList(_lastOthers);
  };

  // Per-song accent color for *other* listeners' cards — same sampling
  // core the local player uses for its own --accent-rgb (see COLOR
  // SAMPLING CORE), but resolved independently per songId and applied
  // only to that one card via --card-accent, never touching the global
  // accent. Needs a real cover-art image, which presence doesn't carry —
  // one extra getSong lookup to find it, same endpoint playFromCard()
  // already uses for the sync-up feature.
  const _songColorCache   = new Map(); // songId -> [r,g,b] or null
  const _songColorPending = new Set();
  function ensureSongColorResolved(songId) {
    if (!songId || _songColorCache.has(songId) || _songColorPending.has(songId)) return;
    _songColorPending.add(songId);
    (async () => {
      try {
        const r = await fetchTimeout(`${ND_URL}/rest/getSong?id=${songId}&${subsonicParams()}`, {}, 6000);
        const data = await r.json();
        const coverArt = data['subsonic-response']?.song?.coverArt;
        _songColorCache.set(songId, coverArt
          ? await sampleImageColor(`${ND_URL}/rest/getCoverArt?id=${coverArt}&size=64&${subsonicParams()}`)
          : null);
      } catch (e) {
        _songColorCache.set(songId, null);
      } finally {
        _songColorPending.delete(songId);
        renderList(_lastOthers); // same resolve-then-rerender idiom as ensureAvatarResolved()
      }
    })();
  }

  // ── Profile banners as card backgrounds ──
  // People already upload a banner in their profile; it only ever showed
  // up inside the profile modal. Using it behind their presence card is
  // free colour and makes the rail look like the people in it.
  // A scaled thumbnail, not `full: true` like the profile views use — this
  // renders at ~240x88, so the original is wildly oversized. Kept in
  // memory only (avatars persist to localStorage as data URIs; banners are
  // far bigger and not worth the quota).
  const _bannerCache   = new Map(); // username -> blob URL, or null
  const _bannerPending = new Set();
  function ensureBannerResolved(username) {
    if (!username || _bannerCache.has(username) || _bannerPending.has(username)) return;
    // Not "no banner" — _profiles is filled by fetchProfiles() on the
    // presence poll, so on the first render or two it's simply empty.
    // Caching null here (which is what this used to do) marked everyone as
    // bannerless permanently, because _bannerCache.has() then short-
    // circuits every later attempt. Bail without caching and retry on the
    // next render instead; only a profile that exists AND has no banner is
    // a real negative worth remembering.
    const profile = _profiles.get(username);
    if (!profile) return;
    if (!profile.banner_mxc) { _bannerCache.set(username, null); return; }
    const mxc = profile.banner_mxc;
    if (!MatrixChat.client) return; // retry on a later render once chat connects
    _bannerPending.add(username);
    (async () => {
      try {
        _bannerCache.set(username, await MatrixChat.mxcToBlobUrl(mxc, { width: 480, height: 200, method: 'scale' }));
      } catch (e) {
        _bannerCache.set(username, null);
      } finally {
        _bannerPending.delete(username);
        renderList(_lastOthers); // same resolve-then-rerender idiom as avatars
      }
    })();
  }

  // ── Render helpers ───────────────────────
  function cardHTML(username, song, artist, isMe, playing, songId, partyHost) {
    ensureAvatarResolved(username);
    const avatarUrl = _avatarCache.get(username);
    const avatarInner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : (username||'?')[0].toUpperCase();
    const playable = !isMe && playing && (songId || song);
    // data-username is always present (the context menu's Message action
    // needs it regardless of playable state) — the sync-specific attrs
    // stay conditional on playable.
    const attrs = ' data-username="' + esc(username||'') + '"' +
      (playable ? ' data-song-id="' + esc(songId||'') + '" data-song-title="' + esc(song||'') + '" data-song-artist="' + esc(artist||'') + '" title="Sync up with ' + esc(username) + '"' : '');
    // Every non-me card gets a stable per-person name color (same hash as
    // the chat timeline's nametags, gitea#3) so a busy roster is easier to
    // scan at a glance; a playing card's accent (song-art-derived) still
    // wins visually since its CSS rule is more specific.
    let cardVars = '';
    if (!isMe) {
      cardVars += '--name-color:' + profileColor(username) + ';';
      if (playing && songId) {
        ensureSongColorResolved(songId);
        const rgb = _songColorCache.get(songId);
        if (rgb) cardVars += '--card-accent:' + rgb.join(',') + ';';
      }
    }
    // Everyone gets their banner, including your own card.
    ensureBannerResolved(username);
    const bannerUrl = _bannerCache.get(username);
    if (bannerUrl) cardVars += "--card-bg:url('" + bannerUrl + "');";
    const cardStyle = cardVars ? ' style="' + cardVars + '"' : '';
    // Anyone cardHTML() renders at all is, by construction, currently
    // online on klabnet — so the dot means "online" now, not "playing".
    // It used to be gated on `playing`, which was fine back when presence
    // only ever showed people who were playing something; now that it
    // shows anyone just on the site, that gate hid the dot for most cards.
    // A paused/stopped listener still posts their last-loaded song (so
    // resuming doesn't need to wait a poll cycle) — but that's stale once
    // they're not actually playing it, so the card only shows it while
    // `playing` is true. The online dot above isn't gated on this at all,
    // so someone who stops listening just drops back to "Online" rather
    // than looking like they left.
    const showTrack = playing && song;
    // Only knowable because both sides of a party report it through their
    // own regular presence post (see postPresence()) — there's no other
    // channel a third viewer could learn this from, since the actual sync
    // is peer-to-peer over Matrix to-device messages. Clickable to leave
    // only on your own card; informational-only on everyone else's.
    const partyLine = partyHost
      ? '<div class="presence-card-party' + (isMe ? ' presence-card-party-leave' : '') + '"' +
          (isMe ? ' title="Leave listening party"' : ' title="Listening together"') + '>' +
          '<i class="ti ti-headphones"></i> with ' + esc(partyHost) +
          (isMe ? ' <i class="ti ti-x"></i>' : '') +
        '</div>'
      : '';
    // Instagram-Notes-style ephemeral status text (klabnet-api /api/notes,
    // 24h TTL) — your own card always shows *something* here (a faint
    // "Add a note…" invite when you don't have one), so it reads as an
    // always-available thing to do rather than a hidden feature; other
    // people's cards only show the line when they actually have a note.
    const note = _notesCache.get(username);
    const noteLine = isMe
      ? '<div class="presence-card-note presence-card-note-edit' + (note ? '' : ' presence-card-note-empty') + '" title="' + (note ? 'Edit your note' : 'Add a note') + '">' +
          (note ? esc(note) : 'Add a note…') +
        '</div>'
      : (note ? '<div class="presence-card-note" title="' + esc(note) + '">' + esc(note) + '</div>' : '');
    return '<div class="presence-card' + (isMe ? ' is-me' : '') + (bannerUrl ? ' has-banner' : '') + (playable ? ' is-playable' : '') + (playing ? ' is-playing' : '') + '"' + attrs + cardStyle + '>' +
      '<div class="presence-card-avatar">' + avatarInner +
        '<span class="presence-card-online" title="Online" aria-label="Online"></span>' +
      '</div>' +
      '<div class="presence-card-info">' +
        '<div class="presence-card-name">' + esc(username) + (isMe ? ' <span style="font-size:8px;opacity:0.4;font-weight:400;">(you)</span>' : '') + '</div>' +
        '<div class="presence-card-track">' + (showTrack ? esc(song) : 'Online') + '</div>' +
        (showTrack && artist ? '<div class="presence-card-artist">' + esc(artist) + '</div>' : '') +
        partyLine +
        noteLine +
      '</div>' +
    '</div>';
  }

  let _lastRenderedHTML = null;
  // ── Offline roster (Matrix presence) ─────
  // klabnet's own presence (above) only ever shows people currently
  // active on the site. This supplements it with everyone else from your
  // joined rooms' membership, via Matrix's own — separate — presence
  // protocol: entirely client-side, no klabnet-api change. Only appears
  // for viewers who've connected chat (needs MatrixChat.client), and
  // needs the homeserver's use_presence setting on to show real
  // last-seen data — with it off, entries just read "offline" plainly
  // rather than erroring visibly.
  const _offlineStatusCache = new Map(); // matrix userId -> status text
  let _offlineTimer = null;
  let _notesTimer = null;
  let _profilesTimer = null;

  function fmtAgo(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  // Capped two ways: a room with a huge membership (e.g. a big public
  // channel) is skipped entirely rather than flooding the roster with
  // people you don't really know, and the total is capped regardless —
  // otherwise refreshOfflineRoster() would fire one getPresence() REST
  // call per member, unbounded, every 30s.
  const OFFLINE_ROSTER_ROOM_MEMBER_CAP = 50;
  const OFFLINE_ROSTER_MAX = 40;
  function offlineRoster(onlineUsernames) {
    const client = MatrixChat.client;
    if (!client) return [];
    const myId = client.getUserId();
    const seen = new Set();
    const roster = [];
    for (const room of client.getRooms()) {
      if (roster.length >= OFFLINE_ROSTER_MAX) break;
      if (room.isSpaceRoom && room.isSpaceRoom()) continue;
      const members = room.getJoinedMembers();
      if (members.length > OFFLINE_ROSTER_ROOM_MEMBER_CAP) continue;
      for (const member of members) {
        if (roster.length >= OFFLINE_ROSTER_MAX) break;
        if (member.userId === myId || seen.has(member.userId)) continue;
        seen.add(member.userId);
        const username = member.userId.replace(/^@/, '').split(':')[0];
        if (onlineUsernames.has(username)) continue; // already shown as online above
        if (username.endsWith('-bot')) continue; // service accounts (klabnet-bot, any future one) aren't "listeners"
        roster.push({ userId: member.userId, username });
      }
    }
    return roster;
  }

  // Matrix's own presence is a different signal from "on klabnet" — a
  // phone with Element (or any Matrix client) running in the background
  // keeps a persistent connection, so the homeserver reports someone
  // "online" more or less permanently whether or not they're anywhere
  // near this site. A flat "online elsewhere" label reads as a stuck/
  // broken status when it's actually just... always true for them. A
  // rotating silly line (same idea as the MOTD splash text) owns that
  // instead of pretending it's a precise status.
  const MATRIX_ELSEWHERE_PHRASES = [
    'lurking off-site', 'ghosting klabnet', 'somewhere else, probably',
    'on the matrix, not on klabnet', 'phoning it in', 'off the grid (kinda)',
    'in another tab', 'living their own life', 'not here, spiritually',
  ];
  async function refreshOfflineRoster(onlineUsernames) {
    const client = MatrixChat.client;
    if (!client) return;
    await Promise.all(offlineRoster(onlineUsernames).map(async person => {
      try {
        const status = await client.getPresence(person.userId);
        const text = status.presence === 'offline'
          ? (status.last_active_ago != null ? `last seen ${fmtAgo(status.last_active_ago)}` : 'offline')
          : MATRIX_ELSEWHERE_PHRASES[Math.floor(Math.random() * MATRIX_ELSEWHERE_PHRASES.length)];
        _offlineStatusCache.set(person.userId, text);
      } catch (e) {
        _offlineStatusCache.set(person.userId, 'offline');
      }
    }));
    renderList(_lastOthers);
  }

  // Persisted so it doesn't snap shut on every poll-driven re-render, or
  // every page load for someone who likes it open.
  const OFFLINE_OPEN_KEY = 'klabnet_presence_offline_open';
  function offlineExpanded() {
    try { return localStorage.getItem(OFFLINE_OPEN_KEY) === '1'; } catch (e) { return false; }
  }
  function setOfflineExpanded(v) {
    try { localStorage.setItem(OFFLINE_OPEN_KEY, v ? '1' : '0'); } catch (e) {}
  }

  // One-line variant of offlineCardHTML for the collapsed list. Same
  // data-username, so clicking one still opens a DM.
  function offlineRowHTML(person) {
    ensureAvatarResolved(person.username);
    const avatarUrl = _avatarCache.get(person.username);
    const avatarInner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : (person.username || '?')[0].toUpperCase();
    return '<div class="presence-row" data-username="' + esc(person.username) + '"' +
      ' style="--name-color:' + profileColor(person.username) + ';" title="' + esc(person.username) + '">' +
      '<div class="presence-row-avatar">' + avatarInner + '</div>' +
      '<span class="presence-row-name">' + esc(person.username) + '</span>' +
    '</div>';
  }

  function renderList(others) {
    _lastOthers = others;
    const me = window.KLAB_USER?.username;
    const mySong = playerState.currentSong;
    let html = '';
    // "you" always first
    if (me && me !== 'anonymous') {
      html += cardHTML(me, mySong?.title || '', mySong?.artist || '', true, playerState.playing, undefined, _partyHostLabel);
    }
    others.forEach(l => {
      html += cardHTML(l.username, l.song, l.artist, false, l.playing, l.songId, l.partyHost);
    });
    const onlineUsernames = new Set([me, ...others.map(l => l.username)]);
    window.KLAB_ONLINE_USERNAMES = onlineUsernames; // read by the chat module for DM online dots
    // Nudge the chat sidebar too — it has its own cheap skip-if-unchanged
    // check, so this is safe to call every poll; without it, a DM's online
    // dot would only ever update when something chat-specific also
    // happened to trigger a re-render.
    if (typeof renderChannelList === 'function') renderChannelList();
    // Offline people are the bulk of the roster and none of the value —
    // no song, no note most of the time — but a full card each was
    // burying the handful of people actually around under a wall of
    // greyed-out ones. Collapsed behind a count by default, and rendered
    // as one-line rows rather than cards when opened. Online stays cards.
    const roster = offlineRoster(onlineUsernames);
    if (roster.length) {
      const open = offlineExpanded();
      html += '<button type="button" class="presence-offline-toggle' + (open ? ' is-open' : '') + '" id="presenceOfflineToggle">' +
        '<i class="ti ti-chevron-right"></i>' +
        '<span>' + roster.length + ' offline</span>' +
        '</button>';
      html += '<div class="presence-offline-list"' + (open ? '' : ' hidden') + '>';
      roster.forEach(person => { html += offlineRowHTML(person); });
      html += '</div>';
    }
    // Most 8s polls come back with nothing changed — skip the DOM
    // teardown/rebuild entirely when the output is identical to last time.
    if (html === _lastRenderedHTML) return;
    _lastRenderedHTML = html;
    list.innerHTML = html;
    applyUnreadDmDots();
  }

  // The rail is the DM list now, so an unread DM has to be visible here or
  // it's invisible entirely. Patched directly onto the existing cards
  // rather than folded into cardHTML(), for the same reason the chat
  // sidebar patches its own dots: unread state changes far more often than
  // the roster does, and a full re-render would fight the poll's
  // skip-if-unchanged check above.
  function applyUnreadDmDots() {
    const unread = window.KLAB_UNREAD_DM_USERS;
    let hiddenUnread = 0;
    list.querySelectorAll('.presence-card[data-username], .presence-row[data-username]').forEach(el => {
      const has = !!unread && unread.has(el.dataset.username);
      el.classList.toggle('has-unread', has);
      const existing = el.querySelector('.presence-card-unread-dot');
      if (has && !existing) {
        const dot = document.createElement('span');
        dot.className = 'presence-card-unread-dot';
        dot.title = 'Unread message';
        el.appendChild(dot);
      } else if (!has && existing) {
        existing.remove();
      }
      // An unread DM from someone offline would otherwise be invisible
      // while the offline list is collapsed.
      if (has && el.classList.contains('presence-row') && !offlineExpanded()) hiddenUnread++;
    });
    const toggle = document.getElementById('presenceOfflineToggle');
    if (toggle) {
      toggle.classList.toggle('has-unread', hiddenUnread > 0);
      toggle.title = hiddenUnread ? `${hiddenUnread} unread message${hiddenUnread === 1 ? '' : 's'} in here` : '';
    }
  }
  // Called by the chat module whenever its unread set changes.
  window.KLAB_REFRESH_PRESENCE_UNREAD = applyUnreadDmDots;

  // ── Rail tabs: Users / Channels ──────────
  // Only meaningful on Chat (off it there are no channels and the tab row
  // is hidden), but the class is harmless everywhere so there's no need to
  // special-case the tab here. Remembered so it doesn't reset every visit.
  const RAIL_TAB_KEY = 'klabnet_rail_tab';
  function setRailTab(which) {
    const rail = document.getElementById('presenceRail');
    if (!rail) return;
    const showChannels = which === 'channels';
    rail.classList.toggle('show-channels', showChannels);
    document.querySelectorAll('#railTabs .rail-tab').forEach(b =>
      b.classList.toggle('active', (b.dataset.railTab === 'channels') === showChannels));
    try { localStorage.setItem(RAIL_TAB_KEY, showChannels ? 'channels' : 'users'); } catch (e) {}
  }
  document.getElementById('railTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.rail-tab');
    if (!btn) return;
    setRailTab(btn.dataset.railTab);
    SFX && SFX.play('click');
  });
  try { setRailTab(localStorage.getItem(RAIL_TAB_KEY) || 'users'); } catch (e) { setRailTab('users'); }
  // Jumping to a room should show it selected, so surface the channels pane.
  window.KLAB_SHOW_RAIL_CHANNELS = () => setRailTab('channels');

  // ── Click a listener's card to sync up and play what they're playing ──
  async function playFromCard(card) {
    const username = card.dataset.username || 'them';
    const songId   = card.dataset.songId;
    const title    = card.dataset.songTitle;
    const artist   = card.dataset.songArtist;
    try {
      let song = null;
      if (songId) {
        const r = await fetchTimeout(`${ND_URL}/rest/getSong?id=${songId}&${subsonicParams()}`, {}, 6000);
        const data = await r.json();
        song = data['subsonic-response']?.song || null;
      }
      if (!song && title) {
        const q = encodeURIComponent(artist ? `${title} ${artist}` : title);
        const r = await fetchTimeout(`${ND_URL}/rest/search3?query=${q}&songCount=5&artistCount=0&albumCount=0&${subsonicParams()}`, {}, 6000);
        const data = await r.json();
        const results = data['subsonic-response']?.searchResult3?.song || [];
        song = results.find(s => s.title === title && (!artist || s.artist === artist)) || results[0] || null;
      }
      if (!song) { showToast(`Couldn't sync with ${username}`); SFX && SFX.play('error'); return; }
      await playSong(song);
      showToast(`Sync'd with ${username}! 🎶`);
      SFX && SFX.play('play');
      // gitea#2: this was previously a one-shot "copy their track, play it
      // from 0, never sync again" — startParty() below layers continuous
      // drift-corrected sync on top via Matrix to-device messages, and the
      // host replies with an immediate tick, correcting position within a
      // beat rather than staying stuck at 0.
      startParty(username);
    } catch(e) {
      showToast(`Couldn't sync with ${username}`);
      SFX && SFX.play('error');
    }
  }

  // ── Listening Party: continuous sync via Matrix to-device messages ──
  // Navidrome can't tell klabnet users apart to give us this for free —
  // every user streams through one shared ND_USER service account, so
  // there's no per-user "now playing position" to read from Subsonic.
  // Matrix to-device messages are a real per-user channel already wired
  // up for chat, so they're reused here as pure signaling (never touching
  // any room/timeline) rather than adding any new backend.
  //
  // Not implemented — flagged back on the issue rather than attempted
  // here: sacrificing playback controls to the host, and any actual
  // shared/cross-device audio output (Spotify Jam-style). Both need real
  // new infrastructure (exclusive control locking across the whole
  // player UI; WebRTC-grade audio streaming), not just a signaling
  // channel like this.
  const PARTY_DRIFT_S    = 2.5;    // re-seek once local playback drifts this far from the host's
  const PARTY_SUB_TTL_MS = 90000;  // drop a subscriber who hasn't renewed in this long (self-heals a closed tab with no explicit "leave")

  let _partyHostId       = null;   // matrix userId we're currently following, or null
  let _partyHostLabel    = '';     // their klabnet username, for the banner
  let _applyingPartyTick = false;  // true only while our own tick handler is driving playSong — distinguishes that from the user picking a new track themselves
  const _partySubscribers = new Map(); // matrix userId -> expiry ms, people currently following ME

  function matrixIdFor(username) {
    const client = MatrixChat.client;
    return client ? `@${username}:${client.getUserId().split(':')[1]}` : null;
  }

  function sendToDeviceEvent(userId, type, content) {
    const client = MatrixChat.client;
    if (!client) return Promise.resolve();
    return client.sendToDevice(type, new Map([[userId, new Map([['*', content]])]]));
  }

  // "Listening party with X" used to be a floating banner pinned just
  // above the player dock — close enough to it that on some viewport
  // sizes it visually clipped against the dock. Showing it as a line on
  // your own presence card instead (see cardHTML()'s partyLine) needs no
  // separate positioned element at all, and as a bonus means the *other*
  // person's card can show the exact same line — the only way anyone
  // watching sees a listening party from the outside at all, since the
  // actual sync is peer-to-peer over Matrix and invisible to a third
  // party otherwise. renderList(_lastOthers) repaints the card
  // immediately; postPresence() pushes it to the server right away too,
  // rather than leaving other viewers to wait out the next ~8s poll.
  function renderPartyState() {
    renderList(_lastOthers);
    postPresence();
  }

  // Continuous sync needs the OTHER person's Matrix client to actually be
  // running (chat is a separate, opt-in "experimental feature" connection —
  // see ensureChatLoaded() — from just being "online" in presence, which
  // is a plain klabnet-api heartbeat that doesn't touch Matrix at all). If
  // they aren't connected right now, sendToDevice() still succeeds (the
  // homeserver just queues the to-device message for whenever they next
  // sync) but no tick ever comes back — previously that meant the card
  // said "with X" forever and nothing ever actually synced, with zero
  // indication anything was wrong. _partyAckTimer turns "no response
  // within a few seconds" into an explicit failure instead.
  const PARTY_ACK_TIMEOUT_MS = 6000;
  let _partyAckTimer = null;

  function startParty(username) {
    const client = MatrixChat.client;
    if (!client) {
      showToast('Connect chat in the Chat tab to use listening party');
      return;
    }
    const hostId = matrixIdFor(username);
    if (!hostId) return;
    _partyHostId = hostId;
    _partyHostLabel = username;
    renderPartyState();
    clearTimeout(_partyAckTimer);
    _partyAckTimer = setTimeout(() => {
      if (_partyHostId !== hostId) return; // already left/switched, not a failure
      showToast(`${username} isn't available for a listening party right now`);
      leaveParty(false);
    }, PARTY_ACK_TIMEOUT_MS);
    sendToDeviceEvent(hostId, 'klab.sync_request', {}).catch(() => {});
  }

  function leaveParty(notify = true) {
    if (!_partyHostId) return;
    clearTimeout(_partyAckTimer);
    if (notify) sendToDeviceEvent(_partyHostId, 'klab.sync_stop', {}).catch(() => {});
    _partyHostId = null;
    _partyHostLabel = '';
    renderPartyState();
  }

  // Called whenever OUR OWN playback changes (track/play/pause) — pushes
  // a fresh tick to everyone currently following us. A no-op loop over
  // an empty map when nobody is.
  function broadcastPartyTick() {
    const now = Date.now();
    for (const [userId, expiry] of _partySubscribers) if (expiry < now) _partySubscribers.delete(userId);
    if (!_partySubscribers.size) return;
    const song = playerState.currentSong;
    const content = {
      songId: song?.id ?? '', title: song?.title || '', artist: song?.artist || '',
      position: playerState.audio.currentTime || 0, playing: !!song && playerState.playing,
    };
    for (const userId of _partySubscribers.keys()) sendToDeviceEvent(userId, 'klab.sync_tick', content).catch(() => {});
  }
  setInterval(broadcastPartyTick, 5000);
  // Renew our own subscription with the host we're following every 60s —
  // PARTY_SUB_TTL_MS on their end is longer than this on purpose, so a
  // slow tick or two doesn't spuriously drop us.
  setInterval(() => { if (_partyHostId) sendToDeviceEvent(_partyHostId, 'klab.sync_request', {}).catch(() => {}); }, 60000);

  async function applyPartyTick(content) {
    if (!_partyHostId) return;
    const song = playerState.currentSong;
    _applyingPartyTick = true;
    try {
      if (content.songId && content.songId !== song?.id) {
        const r = await fetchTimeout(`${ND_URL}/rest/getSong?id=${content.songId}&${subsonicParams()}`, {}, 6000);
        const data = await r.json();
        const newSong = data['subsonic-response']?.song || null;
        if (newSong) {
          await playSong(newSong);
          playerState.audio.currentTime = content.position || 0;
        }
      } else if (song) {
        if (Math.abs(playerState.audio.currentTime - (content.position || 0)) > PARTY_DRIFT_S) {
          playerState.audio.currentTime = content.position || 0;
        }
        if (content.playing && playerState.audio.paused) playerState.audio.play().catch(() => {});
        if (!content.playing && !playerState.audio.paused) playerState.audio.pause();
      }
    } catch (e) {
    } finally {
      _applyingPartyTick = false;
    }
  }

  MatrixChat.on('toDevice', event => {
    const type   = event.getType();
    const sender = event.getSender();
    if (type === 'klab.sync_request') {
      _partySubscribers.set(sender, Date.now() + PARTY_SUB_TTL_MS);
      broadcastPartyTick(); // catch this subscriber up immediately, don't make them wait for the next 5s tick
    } else if (type === 'klab.sync_tick' && sender === _partyHostId) {
      clearTimeout(_partyAckTimer); // the host responded — no longer a "did this even work" case
      applyPartyTick(event.getContent());
    } else if (type === 'klab.sync_stop') {
      _partySubscribers.delete(sender);
    }
  });

  // Any track change that isn't us applying a party tick means the user
  // picked something themselves (search, queue, another card, etc.) —
  // that implicitly leaves the party rather than silently fighting the
  // host's next tick over what should be playing. Onion-wraps playSong
  // once more, same pattern the lyrics engine and the media-session/
  // history/accent-color patch above it already use.
  const _origPlaySongParty = playSong;
  playSong = async function(song) {
    await _origPlaySongParty(song);
    if (_partyHostId && !_applyingPartyTick) leaveParty();
    broadcastPartyTick();
  };
  playerState.audio.addEventListener('play',  broadcastPartyTick);
  playerState.audio.addEventListener('pause', broadcastPartyTick);

  list.addEventListener('click', e => {
    if (e.target.closest('.presence-card-note-edit')) { editMyNote(); return; }
    if (e.target.closest('.presence-card-party-leave')) { leaveParty(); SFX && SFX.play('click'); return; }
    const meCard = e.target.closest('.presence-card.is-me');
    if (meCard) { openProfileModal(); return; }
    const offToggle = e.target.closest('#presenceOfflineToggle');
    if (offToggle) {
      const open = !offToggle.classList.contains('is-open');
      setOfflineExpanded(open);
      offToggle.classList.toggle('is-open', open);
      const listEl = offToggle.nextElementSibling;
      if (listEl) listEl.hidden = !open;
      SFX && SFX.play('click');
      return;
    }
    // Left-click opens a DM. It used to start a listening party, which is a
    // surprising thing to do by accident to someone else's audio — that
    // moved to the right-click menu alongside View Profile, where it reads
    // as the deliberate action it is. messageUser() reuses an existing DM
    // if there is one, so this is "talk to this person" either way.
    // .presence-row is the compact offline variant — same behaviour.
    const card = e.target.closest('.presence-card[data-username], .presence-row[data-username]');
    if (card && !card.classList.contains('is-me')) {
      SFX && SFX.play('nav');
      messageUser(card.dataset.username);
    }
  });

  // ── Right-click context menu: Listen Party / Message ─────
  const presenceCtxMenu = document.getElementById('presenceCtxMenu');
  function hidePresenceCtx() { presenceCtxMenu.classList.remove('visible'); }
  function showPresenceCtx(x, y, card) {
    const username = card.dataset.username;
    document.getElementById('presenceCtxLabel').textContent = username;
    const listenItem = document.getElementById('presenceCtxListen');
    listenItem.style.display = card.classList.contains('is-playable') ? 'flex' : 'none';
    listenItem.onclick = () => { hidePresenceCtx(); playFromCard(card); };
    document.getElementById('presenceCtxProfile').onclick = () => { hidePresenceCtx(); openProfileView(username); };
    document.getElementById('presenceCtxMessage').onclick = () => { hidePresenceCtx(); messageUser(username); };
    // See zoomFactor()'s comment above showCtx() — same zoomed-viewport
    // fix-up, needed here too.
    const z = zoomFactor();
    presenceCtxMenu.style.left = Math.min(x / z, window.innerWidth / z - 210) + 'px';
    presenceCtxMenu.style.top  = Math.min(y / z, window.innerHeight / z - 140) + 'px';
    presenceCtxMenu.classList.add('visible');
  }
  list.addEventListener('contextmenu', e => {
    const card = e.target.closest('.presence-card, .presence-row');
    // Not yourself — listen-partying or DMing your own card makes no sense.
    if (!card || card.classList.contains('is-me') || !card.dataset.username) return;
    e.preventDefault();
    showPresenceCtx(e.clientX, e.clientY, card);
  });
  document.addEventListener('click', e => { if (!presenceCtxMenu.contains(e.target)) hidePresenceCtx(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePresenceCtx(); });

  // ── API calls ────────────────────────────
  // Presence used to be entirely gated on having a song loaded — someone
  // just browsing/chatting with nothing playing never posted at all, and
  // was filtered out of everyone else's list even if they had. Now it
  // posts (and shows) "on the site" as its own state, with song/artist
  // attached only when actually applicable.
  async function postPresence() {
    if (!window.KLAB_USER?.username || window.KLAB_USER.username === 'anonymous') return;
    const song = playerState.currentSong;
    try {
      await fetchTimeout(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: window.KLAB_USER.username,
          song:     song?.title  || '',
          artist:   song?.artist || '',
          songId:   song?.id     ?? '', // nullish, not ||  — a falsy-but-real id like 0 must survive
          playing:  !!song && playerState.playing,
          partyHost: _partyHostLabel || '',
        })
      }, 6000);
    } catch(e) {}
  }

  async function fetchPresence() {
    try {
      const r = await fetchTimeout(API, {}, 6000);
      if (!r.ok) return;
      const data = await r.json();
      const me   = window.KLAB_USER?.username;
      const others = (data.listeners || []).filter(l => l.username !== me);
      renderList(others);
    } catch(e) {
      // A single timed-out/failed poll shouldn't blank out everyone who was
      // online a moment ago — keep showing the last-known roster and let
      // the next successful poll (8s away) correct it.
      renderList(_lastOthers);
    } finally {
      window.KLAB_BOOT?.mark('presence');
    }
  }

  // Offline roster refreshes far less often than the 8s music-presence
  // poll — last-seen data doesn't need second-by-second freshness, and
  // it's one getPresence() REST call per roster member.
  const OFFLINE_POLL_MS = 30000;
  function refreshOfflineRosterNow() {
    const me = window.KLAB_USER?.username;
    refreshOfflineRoster(new Set([me, ...(_lastOthers || []).map(l => l.username)]));
  }

  // ── Notes — Instagram-Notes-style ephemeral status text, one per user.
  // One bulk GET decorates every card (online AND offline) rather than a
  // request per person; doesn't need 8s freshness, same cadence as the
  // offline roster above.
  const _notesCache = new Map(); // username -> note text
  async function fetchNotes() {
    try {
      const r = await fetchTimeout('/api/notes', {}, 6000);
      if (!r.ok) return;
      const data = await r.json();
      _notesCache.clear();
      (data.notes || []).forEach(n => _notesCache.set(n.username, n.text));
      renderList(_lastOthers);
    } catch (e) {}
  }
  async function editMyNote() {
    const me = window.KLAB_USER?.username;
    if (!me) return;
    const text = await showInputDialog('// share a note', 'Visible to everyone for 24h (max 60 characters).', 'Note text', _notesCache.get(me) || '');
    if (text === null) return; // cancelled
    try {
      const r = await fetchTimeout('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      }, 6000);
      if (!r.ok) return;
      const data = await r.json();
      if (data.text) _notesCache.set(me, data.text); else _notesCache.delete(me);
      renderList(_lastOthers);
      SFX && SFX.play(data.text ? 'star' : 'click');
    } catch (e) {}
  }

  // ── Poll — runs from page load, pauses when the tab is hidden ──
  // Chat colors/bios/banners loaded here are also read by the chat
  // timeline and the feed — but unlike this presence rail (which already
  // fully repaints on every poll tick regardless) and the feed (same,
  // every 30s), the timeline deliberately does NOT rebuild on a timer:
  // renderTimeline()'s renderKey guard exists specifically so it only
  // repaints when the room's actual messages/reactions change, because a
  // full rebuild while you're scrolled up reading history isn't fully
  // position-preserving. Forcing it here via _lastTimelineRenderKey=null
  // on every ~15s profile poll was exactly that: it made the chat panel
  // constantly re-scroll out from under anyone reading back through a
  // conversation. A colleague's new chat color just waits for the next
  // *real* re-render (a new message, reaction, etc.) to show up instead.
  function refreshAfterProfiles() {
    renderList(_lastOthers);
    window.KLAB_REFRESH_FEED && window.KLAB_REFRESH_FEED();
  }
  function startPoll() {
    if (_timer) return;
    fetchPresence(); refreshOfflineRosterNow(); fetchNotes(); fetchProfiles().then(refreshAfterProfiles);
    _timer = setInterval(fetchPresence, POLL_MS);
    _offlineTimer = setInterval(refreshOfflineRosterNow, OFFLINE_POLL_MS);
    _notesTimer = setInterval(fetchNotes, OFFLINE_POLL_MS);
    _profilesTimer = setInterval(() => fetchProfiles().then(refreshAfterProfiles), OFFLINE_POLL_MS);
  }
  function stopPoll() {
    clearInterval(_timer); _timer = null;
    clearInterval(_offlineTimer); _offlineTimer = null;
    clearInterval(_notesTimer); _notesTimer = null;
    clearInterval(_profilesTimer); _profilesTimer = null;
  }

  // postPresence() (the heartbeat that keeps YOU marked online, distinct
  // from fetchPresence() above which just pulls the roster for your own
  // view) used to live inside the pausable timer above — pausing on
  // visibilitychange meant merely switching to another browser tab for a
  // few seconds let PRESENCE_TTL (30s server-side) lapse and dropped you
  // off everyone else's roster, then picked you back up next time you
  // looked at klabnet again: the reported "keep seeing them go on and
  // offline" flicker. Having klabnet open at all — focused or not — should
  // keep you online, so this heartbeat now runs on its own timer that
  // visibilitychange never touches. It only actually stops when the page
  // itself goes away (tab closed, navigated off) and the JS context dies
  // with it, which is the correct point for the TTL to eventually expire.
  // Self-rescheduling rather than a fixed interval, so a backgrounded tab
  // can back off without ever stopping: PRESENCE_TTL is 30s, so 12s still
  // leaves a 2.5x margin while cutting a hidden tab from 450 to 300 POSTs
  // an hour. Coming back to the tab fires an immediate beat below, so the
  // longer gap is never visible to anyone.
  let _heartbeatTimer = null;
  function beat() {
    postPresence();
    _heartbeatTimer = setTimeout(beat, document.hidden ? POLL_MS * 1.5 : POLL_MS);
  }
  function startHeartbeat() {
    if (_heartbeatTimer) return;
    beat();
  }

  startPoll();
  startHeartbeat();
  document.addEventListener('visibilitychange', () => {
    document.hidden ? stopPoll() : startPoll();
    // Re-beat immediately on return so the backed-off gap can't leave a
    // stale presence record visible to anyone else.
    if (!document.hidden) {
      clearTimeout(_heartbeatTimer);
      _heartbeatTimer = null;
      startHeartbeat();
    }
  });
  playerState.audio.addEventListener('play',  postPresence);
  playerState.audio.addEventListener('pause', postPresence);
})();

