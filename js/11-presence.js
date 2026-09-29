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

  // Looked up live this session (as opposed to shown from the saved copy).
  // The saved copy used to count as resolved, so once chat connected
  // nobody's changed avatar ever showed up.
  const _avatarLive = new Set();
  function ensureAvatarResolved(username) {
    if (!username || _avatarLive.has(username) || _avatarPending.has(username)) return;
    if (!_avatarCache.has(username) && _persistedAvatars[username]) _avatarCache.set(username, _persistedAvatars[username]);
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
        _avatarLive.add(username);
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
      _avatarCache.delete(me); _avatarLive.delete(me); clearPersistedAvatar(me);
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
        const r = await fetchTimeout(`${ND_URL}/rest/getSong?id=${encodeURIComponent(songId)}&${subsonicParams()}`, {}, 6000);
        const data = await r.json();
        const coverArt = data['subsonic-response']?.song?.coverArt;
        _songColorCache.set(songId, coverArt
          ? await sampleImageColor(`${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(coverArt)}&size=64&${subsonicParams()}`)
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
  // What someone's on, for the icon beside their name: the desktop app
  // shows its OS, a browser its browser. Sent with every presence beat as
  // "app:windows", "pwa:ios", "web:macos:firefox"...
  const PLATFORM = (() => {
    const ua = navigator.userAgent;
    const os = /Windows/.test(ua) ? 'windows'
      : /iPhone|iPod/.test(ua) ? 'ios'
      : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ipados'
      : /Mac OS X|Macintosh/.test(ua) ? 'macos'
      : /Android/.test(ua) ? 'android'
      : /CrOS/.test(ua) ? 'chromeos'
      : /Linux/.test(ua) ? 'linux' : '';
    const d = window.klabnetDesktop;
    if (d) return 'app:' + ({ win32: 'windows', darwin: 'macos', linux: 'linux' }[d.platform] || os);
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'pwa:' + os;
    const br = /Edg(e|A|iOS)?\//.test(ua) ? 'edge'
      : /OPR\/|Opera/.test(ua) ? 'opera'
      : /Vivaldi/.test(ua) ? 'vivaldi'
      : /SamsungBrowser/.test(ua) ? 'samsung'
      : /Firefox\/|FxiOS/.test(ua) ? 'firefox'
      : /CriOS|Chrome\//.test(ua) ? (navigator.brave ? 'brave' : 'chrome')
      : /Safari\//.test(ua) ? 'safari' : '';
    return 'web:' + os + (br ? ':' + br : '');
  })();
  const OS_INFO = {
    windows: ['ti-brand-windows', 'Windows'], macos: ['ti-brand-apple', 'macOS'], linux: ['ti-terminal-2', 'Linux'],
    ios: ['ti-brand-apple', 'iPhone'], ipados: ['ti-brand-apple', 'iPad'], android: ['ti-brand-android', 'Android'],
    chromeos: ['ti-brand-chrome', 'ChromeOS'],
  };
  const BROWSER_INFO = {
    chrome: ['ti-brand-chrome', 'Chrome'], firefox: ['ti-brand-firefox', 'Firefox'], safari: ['ti-brand-safari', 'Safari'],
    edge: ['ti-brand-edge', 'Edge'], opera: ['ti-brand-opera', 'Opera'], vivaldi: ['ti-brand-vivaldi', 'Vivaldi'],
    brave: ['ti-world', 'Brave'], samsung: ['ti-world', 'Samsung Internet'],
  };
  function platformIcon(code) {
    const [kind, os, br] = String(code || '').split(':');
    if (!kind) return '';
    const o = OS_INFO[os];
    let icon, label;
    if (kind === 'app') { icon = o ? o[0] : 'ti-device-desktop'; label = 'klabnet for ' + (o ? o[1] : 'desktop'); }
    else if (kind === 'pwa') { icon = o ? o[0] : 'ti-device-mobile'; label = 'klabnet app' + (o ? ' on ' + o[1] : ''); }
    else { const b = BROWSER_INFO[br]; icon = b ? b[0] : 'ti-world'; label = (b ? b[1] : 'A browser') + (o ? ' on ' + o[1] : ''); }
    return '<i class="ti ' + icon + ' presence-plat" title="' + esc(label) + '" aria-label="' + esc(label) + '"></i>';
  }
  window.klabPlatformIcon = platformIcon;

  // ── Away ──
  // Someone with klabnet open who hasn't used their computer in 5 minutes,
  // or whose screen is locked. Each beat says how long since this device
  // was last used and whether it can see the whole computer (the desktop
  // app asks the OS; Chrome can, once allowed) or only input inside
  // klabnet; the API (klabnet-api routers/presence.py) takes it from there
  // across all of their devices and sends back away + awaySince.
  const _away = new Map();   // username -> when they were last active (ms)
  function awayLabel(username) {
    const since = _away.get(username);
    if (since == null) return '';
    const m = Math.max(0, Math.floor((Date.now() - since) / 60000));
    return 'Away ' + (m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd');
  }
  window.KLAB_AWAY = _away;   // read by chat and Home for their dots

  let _lastInput = Date.now();
  const pageAgo = () => Math.round((Date.now() - _lastInput) / 1000);
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(t => addEventListener(t, () => {
    const was = Date.now() - _lastInput;
    _lastInput = Date.now();
    if (was > 60000) postPresence();   // back: everyone sees it now, not at the next beat
  }, { capture: true, passive: true }));

  // Chrome's Idle Detection (the whole computer, once the site's allowed
  // it: Settings -> Away status asks). Noticed a minute in, its minimum.
  let _sysIdle = null;       // { idleSince, lockedSince } in ms, 0 when not
  async function startIdleDetector() {
    if (_sysIdle || window.klabnetDesktop || !('IdleDetector' in window) || _settings.awayStatus === false) return;
    try {
      if ((await navigator.permissions.query({ name: 'idle-detection' })).state !== 'granted') return;
      const det = new IdleDetector(), s = { idleSince: 0, lockedSince: 0 };
      det.addEventListener('change', () => {
        const now = Date.now();
        s.idleSince = det.userState === 'idle' ? (s.idleSince || now - 60000) : 0;
        s.lockedSince = det.screenState === 'locked' ? (s.lockedSince || now) : 0;
        postPresence();
      });
      await det.start({ threshold: 60000 });
      _sysIdle = s;
    } catch (e) {}
  }
  window.klabStartIdleDetector = startIdleDetector;
  startIdleDetector();

  async function awayFields() {
    if (_settings.awayStatus === false) return {};
    const d = window.klabnetDesktop;
    if (d && d.idle) {
      try {
        const r = await d.idle();
        if (r && typeof r.seconds === 'number') {
          return Object.assign({ activeAgo: Math.min(Math.round(r.seconds), pageAgo()), idleKnown: true },
            r.lockedFor != null ? { lockedFor: r.lockedFor } : {});
        }
      } catch (e) {}
    }
    if (_sysIdle) {
      const now = Date.now();
      return Object.assign({ activeAgo: _sysIdle.idleSince ? Math.round((now - _sysIdle.idleSince) / 1000) : 0, idleKnown: true },
        _sysIdle.lockedSince ? { lockedFor: Math.round((now - _sysIdle.lockedSince) / 1000) } : {});
    }
    // Only klabnet's own input: enough to say they're here, never that they've gone.
    return { activeAgo: pageAgo(), idleKnown: false };
  }

  function cardHTML(username, song, artist, isMe, playing, songId, partyHost, platform) {
    ensureAvatarResolved(username);
    const avatarUrl = _avatarCache.get(username);
    const avatarInner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : esc((username||'?')[0].toUpperCase());
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
    const away = isMe ? '' : awayLabel(username);
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
    return '<div class="presence-card' + (isMe ? ' is-me' : '') + (bannerUrl ? ' has-banner' : '') + (playable ? ' is-playable' : '') + (playing ? ' is-playing' : '') + (away ? ' is-away' : '') + '"' + attrs + cardStyle + '>' +
      '<div class="presence-card-avatar">' + avatarInner +
        '<span class="presence-card-online" title="' + (away || 'Online') + '" aria-label="' + (away || 'Online') + '"></span>' +
      '</div>' +
      '<div class="presence-card-info">' +
        '<div class="presence-card-name">' + esc(username) + (isMe ? ' <span class="presence-card-you">(you)</span>' : '') + platformIcon(isMe ? PLATFORM : platform) + '</div>' +
        '<div class="presence-card-track">' + (showTrack ? esc(song) : away || 'Online') + '</div>' +
        (showTrack && artist ? '<div class="presence-card-artist">' + esc(artist) + '</div>' : '') +
        partyLine +
        noteLine +
      '</div>' +
    '</div>';
  }

  // Chat's "Online now" row: a face per person with their note in a small
  // bubble above it, Instagram-Notes-style (what notes were modeled on).
  // Keeps the presence-card class and data-* attributes so the click
  // (DM, or your own: profile), right-click (listen along / profile) and
  // unread-dot handling below all work unchanged.
  function faceHTML(username, song, artist, isMe, playing, songId, partyHost, platform) {
    ensureAvatarResolved(username);
    const avatarUrl = _avatarCache.get(username);
    const inner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : esc((username || '?')[0].toUpperCase());
    const playable = !isMe && playing && (songId || song);
    const attrs = ' data-username="' + esc(username || '') + '"' +
      (playable ? ' data-song-id="' + esc(songId || '') + '" data-song-title="' + esc(song || '') + '" data-song-artist="' + esc(artist || '') + '"' : '');
    const note = _notesCache.get(username);
    // No note bubbles over the faces: squeezed that small nobody could read
    // them. Notes live in the tooltip here, in a DM's header, and on Home's
    // presence cards (where yours is set). Leaving a listening party is a
    // control, not a note, so that one stays.
    const bubble = isMe && partyHost ? '<span class="chat-face-note presence-card-party-leave" title="Leave listening party"><i class="ti ti-headphones"></i> ' + esc(partyHost) + '</span>' : '';
    const away = isMe ? '' : awayLabel(username);
    const tip = (isMe ? 'You' : (playing && song ? esc(username) + ' · listening to ' + esc(song) : esc(username))) + (away ? ' · ' + away.toLowerCase() : '') + (note ? ' · “' + esc(note) + '”' : '');
    return '<div class="presence-card chat-face' + (isMe ? ' is-me' : '') + (away ? ' is-away' : '') + (playable ? ' is-playable' : '') + (playing && song ? ' is-playing' : '') + '"' + attrs +
      ' style="--name-color:' + profileColor(username) + '" title="' + tip + '">' + bubble +
      '<span class="chat-face-av">' + inner + '<span class="presence-card-online"></span>' +
        (playing && song ? '<span class="chat-face-eq"><i></i><i></i><i></i></span>' : '') + '</span>' +
      '<span class="chat-face-name">' + (isMe ? 'you' : esc(username)) + platformIcon(isMe ? PLATFORM : platform) + '</span></div>';
  }

  let _lastRenderedHTML = null;
  // ── Offline roster ─────
  // klabnet's own presence (above) only shows people currently on the
  // site. The roster adds everyone else it has ever seen (from
  // /api/presence) and, once chat is connected, members of your joined
  // rooms, as plain name rows. (It used to also ask the chat server for
  // each one's last-seen time every 30s, which was never displayed.)
  let _notesTimer = null;
  let _profilesTimer = null;

  // Capped two ways: a room with a huge membership (e.g. a big public
  // channel) is skipped entirely rather than flooding the roster with
  // people you don't really know, and the total is capped regardless.
  const OFFLINE_ROSTER_ROOM_MEMBER_CAP = 50;
  const OFFLINE_ROSTER_MAX = 40;
  // Filled by the presence poll (GET /api/presence -> roster). Server-side
  // list of every known user, so the offline half of the rail no longer
  // waits on Matrix.
  let _serverRoster = null;

  // ── People, for @mentions ──
  // Only a real person's name turns into a mention (coloured, and offered
  // by the @ suggestions in js/20-mentions.js); any other @word stays
  // text. Everyone the API has seen, plus whoever's online.
  let _people = new Set(), _peopleKey = '';
  function people() {
    const key = (_serverRoster ? _serverRoster.length : 0) + ':' + (window.KLAB_ONLINE_USERNAMES ? window.KLAB_ONLINE_USERNAMES.size : 0);
    if (key !== _peopleKey) {
      _peopleKey = key;
      _people = new Set([...(_serverRoster || []).map(p => p.username), ...(window.KLAB_ONLINE_USERNAMES || [])]
        .filter(u => u && u !== 'anonymous').map(u => u.toLowerCase()));
    }
    return _people;
  }
  // The real username an "@name" means, or null. "@bob." is bob.
  window.klabUserFor = function(name) {
    const set = people();
    let n = String(name || '').toLowerCase();
    while (n) {
      if (set.has(n)) return n;
      if (!/[.-]$/.test(n)) return null;
      n = n.slice(0, -1);
    }
    return null;
  };
  window.klabPeople = () => [...people()];
  // Plain text with its real mentions coloured (photo captions, comments).
  window.klabMentionsHTML = function(text) {
    return esc(text || '').replace(/(^|[^\w@])@([a-zA-Z0-9_][\w.-]*)/g, (m, pre, name) => {
      const u = window.klabUserFor(name);
      if (!u) return m;
      return pre + '<span class="feed-post-mention" data-username="' + esc(u) + '" style="color:' + profileColor(u) + '">@' + name.slice(0, u.length) + '</span>' + name.slice(u.length);
    });
  };

  function _matrixIdFor(username) {
    const myId = MatrixChat.client?.getUserId();
    const server = myId ? myId.split(':')[1] : 'klab.gg';
    return '@' + username + ':' + server;
  }

  function offlineRoster(onlineUsernames) {
    const me = window.KLAB_USER?.username;
    if (_serverRoster) {
      const out = [];
      for (const person of _serverRoster) {
        if (out.length >= OFFLINE_ROSTER_MAX) break;
        const username = person.username;
        if (!username || username === me) continue;
        if (onlineUsernames.has(username)) continue;   // already a card above
        if (username.endsWith('-bot')) continue;
        // userId is only needed for the "online elsewhere" Matrix-presence
        // label, which is itself Matrix-gated — synthesising it from the
        // username is safe because klabnet usernames ARE Matrix localparts
        // on this homeserver (see ensureAvatarResolved's own note).
        out.push({ userId: _matrixIdFor(username), username });
      }
      return out;
    }
    // Pre-roster fallback: derive it from Matrix room membership the way
    // this always used to. Only reachable if the API is unreachable or
    // hasn't answered yet.
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
    const avatarInner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : esc((person.username || '?')[0].toUpperCase());
    return '<div class="presence-row" data-username="' + esc(person.username) + '"' +
      ' style="--name-color:' + profileColor(person.username) + ';" title="' + esc(person.username) + '">' +
      '<div class="presence-row-avatar">' + avatarInner + '</div>' +
      '<span class="presence-row-name">' + esc(person.username) + '</span>' +
    '</div>';
  }

  let _lastRoster = [];
  // For chat: who's around and what they're doing, by username.
  window.klabPresenceOf = function(username) {
    const l = (_lastOthers || []).find(x => x && x.username === username);
    return {
      online: !!(window.KLAB_ONLINE_USERNAMES && window.KLAB_ONLINE_USERNAMES.has(username)),
      away: awayLabel(username),
      song: l && l.playing ? l.song : '', artist: l && l.playing ? l.artist : '', songId: l && l.playing ? l.songId : '',
      note: _notesCache.get(username) || '', avatar: _avatarCache.get(username) || null,
    };
  };
  // Home's "Who's online": the full presence cards (banner, song, note),
  // you first, then whoever's listening, then everyone else online.
  window.klabPresenceCardsHTML = function() {
    const me = window.KLAB_USER?.username;
    const mySong = playerState.currentSong;
    const others = (_lastOthers || []).filter(l => l && l.username !== me).sort(byActivity);
    let html = '';
    if (me && me !== 'anonymous') html += cardHTML(me, mySong?.title || '', mySong?.artist || '', true, playerState.playing, undefined, _partyHostLabel);
    others.forEach(l => { html += cardHTML(l.username, l.song, l.artist, false, l.playing, l.songId, l.partyHost, l.platform); });
    return { html, others: others.length };
  };
  // Everyone the site knows, online first, for chat's search.
  window.klabRoster = function() {
    const on = [...(window.KLAB_ONLINE_USERNAMES || [])].filter(Boolean);
    return [...new Set([...on, ...(_lastRoster || []).map(p => p.username)])];
  };
  // Listen along from chat's header: the same path as the right-click menu.
  window.klabListenAlong = function(username) {
    const card = document.querySelector('#presenceList .presence-card.is-playable[data-username="' + CSS.escape(username) + '"]');
    if (card) playFromCard(card);
  };
  // Listening first, then everyone else here, then whoever's away.
  const byActivity = (a, b) => ((b.playing && b.song ? 1 : 0) - (a.playing && a.song ? 1 : 0)) || ((a.away ? 1 : 0) - (b.away ? 1 : 0));
  function renderList(rawOthers) {
    _lastOthers = rawOthers;
    const me = window.KLAB_USER?.username;
    const mySong = playerState.currentSong;
    // Filtered HERE, not where the poll parses the response. If a presence
    // poll lands before /api/me does, `me` is still 'anonymous', so the
    // caller can't exclude you — and your own entry gets cached in
    // _lastOthers. Every later replay of that array (an avatar resolving, a
    // banner, a song colour — eleven call sites) then runs with identity
    // known, drawing the "you" card AND your stale entry: two of yourself,
    // until the next poll 8s later rebuilt the array correctly.
    const others = (rawOthers || []).filter(l => l && l.username !== me);
    _away.clear();
    others.forEach(l => { if (l.away) _away.set(l.username, l.awaySince ? Date.parse(l.awaySince.replace(' ', 'T') + 'Z') : Date.now()); });
    let html = '';
    // "you" always first
    if (me && me !== 'anonymous') {
      html += faceHTML(me, mySong?.title || '', mySong?.artist || '', true, playerState.playing, undefined, _partyHostLabel);
    }
    // Listening first, then everyone else online.
    [...others].sort(byActivity).forEach(l => {
      html += faceHTML(l.username, l.song, l.artist, false, l.playing, l.songId, l.partyHost, l.platform);
    });
    const onlineUsernames = new Set([me, ...others.map(l => l.username)]);
    window.KLAB_ONLINE_USERNAMES = onlineUsernames; // read by the chat module for DM online dots
    // Nudge the chat sidebar too — it has its own cheap skip-if-unchanged
    // check, so this is safe to call every poll; without it, a DM's online
    // dot would only ever update when something chat-specific also
    // happened to trigger a re-render.
    if (typeof scheduleChatRender === 'function') scheduleChatRender();
    // Offline people are the bulk of the roster and none of the value —
    // no song, no note most of the time — but a full card each was
    // burying the handful of people actually around under a wall of
    // greyed-out ones. Collapsed behind a count by default, and rendered
    // as one-line rows rather than cards when opened. Online stays cards.
    window.klabHomePresenceChanged && window.klabHomePresenceChanged();
    // Everyone else is found with the sidebar's search (window.klabRoster).
    _lastRoster = offlineRoster(onlineUsernames);
    window.klabChatPresenceChanged && window.klabChatPresenceChanged();
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

  // ── Click a listener's card to sync up and play what they're playing ──
  async function playFromCard(card) {
    const username = card.dataset.username || 'them';
    const songId   = card.dataset.songId;
    const title    = card.dataset.songTitle;
    const artist   = card.dataset.songArtist;
    try {
      let song = null;
      if (songId) {
        const r = await fetchTimeout(`${ND_URL}/rest/getSong?id=${encodeURIComponent(songId)}&${subsonicParams()}`, {}, 6000);
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
      if (!song) { showToast(`Couldn't sync with ${username}`, toastPerson(username)); SFX && SFX.play('error'); return; }
      await playSong(song);
      showToast(`Sync'd with ${username}! 🎶`, toastPerson(username));
      SFX && SFX.play('play');
      // gitea#2: this was previously a one-shot "copy their track, play it
      // from 0, never sync again" — startParty() below layers continuous
      // drift-corrected sync on top via Matrix to-device messages, and the
      // host replies with an immediate tick, correcting position within a
      // beat rather than staying stuck at 0.
      startParty(username);
    } catch(e) {
      showToast(`Couldn't sync with ${username}`, toastPerson(username));
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
  let _applyingPartyTick = 0;      // >0 only while our own tick handler is driving playSong — distinguishes that from the user picking a new track themselves
  const _partySubscribers = new Map(); // matrix userId -> expiry ms, people currently following ME
  // For the Photos tab, which pauses your music on arrival but must not
  // break a listening party you're hosting or following.
  window.klabInListeningParty = () => !!_partyHostId || _partySubscribers.size > 0;

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
      showToast('Connect chat in the Chat tab to use listening party', 'ti-plug-connected-x');
      return;
    }
    const hostId = matrixIdFor(username);
    if (!hostId) return;
    // Following someone else now: the last host stops sending to us.
    if (_partyHostId && _partyHostId !== hostId) leaveParty(true);
    _partyHostId = hostId;
    _partyHostLabel = username;
    renderPartyState();
    clearTimeout(_partyAckTimer);
    _partyAckTimer = setTimeout(() => {
      if (_partyHostId !== hostId) return; // already left/switched, not a failure
      showToast(`${username} isn't available for a listening party right now`, toastPerson(username));
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

  // A counter, not a flag: the host's track change sends two ticks (one
  // from playSong, one from the audio 'play' event), and with a flag the
  // first to finish cleared it while the second was still loading, so
  // the wrapper below took that load for your own pick and left the party.
  let _partyLoadingId = null;
  async function applyPartyTick(content) {
    if (!_partyHostId) return;
    const song = playerState.currentSong;
    if (content.songId && content.songId === _partyLoadingId) return; // already on its way
    _applyingPartyTick++;
    try {
      if (content.songId && content.songId !== song?.id) {
        _partyLoadingId = content.songId;
        const r = await fetchTimeout(`${ND_URL}/rest/getSong?id=${encodeURIComponent(content.songId)}&${subsonicParams()}`, {}, 6000);
        const data = await r.json();
        const newSong = data['subsonic-response']?.song || null;
        if (newSong && _partyHostId) {
          // Marked for the playSong wrapper below, synchronously: it has to
          // tell this apart from you picking a song while this one loads.
          _partyPlay++;
          const p = playSong(newSong);
          _partyPlay--;
          await p;
          if (_partyHostId) playerState.audio.currentTime = content.position || 0;
        }
      } else if (song && content.songId) {
        // Not for an empty songId: that's a host with nothing loaded (just
        // reloaded, answering our renewal), and "syncing" to it seeked
        // your own song back to 0 and paused it.
        if (Math.abs(playerState.audio.currentTime - (content.position || 0)) > PARTY_DRIFT_S) {
          playerState.audio.currentTime = content.position || 0;
        }
        if (content.playing && playerState.audio.paused) playerState.audio.play().catch(() => {});
        if (!content.playing && !playerState.audio.paused) playerState.audio.pause();
      }
    } catch (e) {
    } finally {
      _applyingPartyTick--;
      if (_partyLoadingId === content.songId) _partyLoadingId = null;
    }
  }
  // Ticks come every 5s while the host is there. Silence for 20s means
  // they closed the tab or went offline: stop showing "with X" forever.
  // A paused host in a background tab ticks far less often (browsers slow
  // a silent hidden page's timers to once a minute), so that's not "gone".
  const PARTY_GONE_MS = 20000, PARTY_PAUSED_GONE_MS = 150000;
  function armPartyWatchdog(content) {
    clearTimeout(_partyAckTimer);
    const wait = content && content.playing === false ? PARTY_PAUSED_GONE_MS : PARTY_GONE_MS;
    const host = _partyHostId, label = _partyHostLabel;
    _partyAckTimer = setTimeout(() => {
      if (_partyHostId !== host) return;
      showToast(`${label} stopped the listening party`, toastPerson(label));
      leaveParty(false);
    }, wait);
  }

  MatrixChat.on('toDevice', event => {
    const type   = event.getType();
    const sender = event.getSender();
    if (type === 'klab.sync_request') {
      _partySubscribers.set(sender, Date.now() + PARTY_SUB_TTL_MS);
      broadcastPartyTick(); // catch this subscriber up immediately, don't make them wait for the next 5s tick
    } else if (type === 'klab.sync_tick' && sender === _partyHostId) {
      armPartyWatchdog(event.getContent()); // the host is there; expect the next tick soon
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
  let _partyPlay = 0;
  const _origPlaySongParty = playSong;
  playSong = async function(song) {
    // Your own pick leaves the party straight away, before it loads: a host
    // tick arriving meanwhile used to pull you back to their song.
    if (_partyHostId && _partyPlay === 0) leaveParty();
    await _origPlaySongParty(song);
    broadcastPartyTick();
  };
  playerState.audio.addEventListener('play',  broadcastPartyTick);
  playerState.audio.addEventListener('pause', broadcastPartyTick);

  // Shared by chat's faces and Home's cards.
  const onCardClick = e => {
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
  };

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
  const onCardContext = e => {
    const card = e.target.closest('.presence-card, .presence-row');
    // Not yourself — listen-partying or DMing your own card makes no sense.
    if (!card || card.classList.contains('is-me') || !card.dataset.username) return;
    e.preventDefault();
    showPresenceCtx(e.clientX, e.clientY, card);
  };
  list.addEventListener('click', onCardClick);
  list.addEventListener('contextmenu', onCardContext);
  window.klabPresenceCardClick = onCardClick;
  window.klabPresenceCardContext = onCardContext;
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
    const away = await awayFields();
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
          platform:  PLATFORM,
          ...away,
        })
      }, 6000);
    } catch(e) {}
  }

  async function fetchPresence() {
    try {
      const r = await fetchTimeout(API, {}, 6000);
      if (!r.ok) return;
      const data = await r.json();
      // Arrives with the very first poll, unlike the Matrix-derived roster
      // it replaces — that one couldn't produce anything until the SDK had
      // downloaded, logged in and finished an initial sync.
      if (Array.isArray(data.roster)) _serverRoster = data.roster;
      // Passed through unfiltered on purpose — renderList() drops the
      // current user itself, so a poll that beats /api/me can't poison the
      // cached array (see its own comment).
      renderList(data.listeners || []);
      // Someone new to mention (or the first poll): mentions redraw.
      const before = _peopleKey;
      people();
      if (_peopleKey !== before && _people.size) window.dispatchEvent(new Event('klab:people'));
    } catch(e) {
      // A single timed-out/failed poll shouldn't blank out everyone who was
      // online a moment ago — keep showing the last-known roster and let
      // the next successful poll (8s away) correct it.
      renderList(_lastOthers);
    } finally {
      window.KLAB_BOOT?.mark('presence');
    }
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
  // Notes and profiles change rarely; half a minute is plenty.
  const NOTES_POLL_MS = 30000;
  function startPoll() {
    if (_timer) return;
    fetchPresence(); fetchNotes(); fetchProfiles().then(refreshAfterProfiles);
    _timer = setInterval(fetchPresence, POLL_MS);
    _notesTimer = setInterval(fetchNotes, NOTES_POLL_MS);
    _profilesTimer = setInterval(() => fetchProfiles().then(refreshAfterProfiles), NOTES_POLL_MS);
  }
  function stopPoll() {
    clearInterval(_timer); _timer = null;
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
  //
  // The timer itself lives in a worker. After five minutes in the
  // background Chrome (and the desktop app, sitting in the tray) runs a
  // page's own timers at most once a minute, so a page-side 12s beat
  // became one a minute against the 30s TTL: everyone with klabnet open
  // but out of sight flickered offline for half of every minute. A
  // worker's timers aren't throttled that way; each tick just asks the
  // page to beat, and messages to the page aren't throttled either.
  let _heartbeatTimer = null;
  let _beatWorker = null;
  function beat() {
    postPresence();
    _heartbeatTimer = setTimeout(beat, document.hidden ? POLL_MS * 1.5 : POLL_MS);
  }
  function startHeartbeat() {
    if (_heartbeatTimer || _beatWorker) return;
    try {
      const src = 'let t;onmessage=e=>{clearInterval(t);t=setInterval(()=>postMessage(0),e.data)}';
      _beatWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      // Party ticks ride along: a host in a background tab keeps its
      // followers in step instead of dropping to one tick a minute.
      _beatWorker.onmessage = () => { postPresence(); broadcastPartyTick(); };
      _beatWorker.postMessage(document.hidden ? POLL_MS * 1.5 : POLL_MS);
      postPresence();
    } catch (e) {
      _beatWorker = null;
      beat(); // no workers: the page timer, throttled or not
    }
  }

  startPoll();
  startHeartbeat();
  document.addEventListener('visibilitychange', () => {
    document.hidden ? stopPoll() : startPoll();
    // Re-beat immediately on return so the backed-off gap can't leave a
    // stale presence record visible to anyone else.
    if (_beatWorker) {
      _beatWorker.postMessage(document.hidden ? POLL_MS * 1.5 : POLL_MS);
      if (!document.hidden) postPresence();
    } else if (!document.hidden) {
      clearTimeout(_heartbeatTimer);
      _heartbeatTimer = null;
      startHeartbeat();
    }
  });
  playerState.audio.addEventListener('play',  postPresence);
  playerState.audio.addEventListener('pause', postPresence);
})();

