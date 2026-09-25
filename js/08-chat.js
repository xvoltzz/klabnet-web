// ══════════════════════════════════════════
//  MATRIX CHAT — sync engine
//  Plan: ~/.claude/plans/enumerated-honking-moon.md
//
//  Login flow + SDK boot, exposed on window.MatrixChat. Defined ahead of
//  the KLAB SOCIAL section below (which wires it into the Chat tab's
//  DOM) and ahead of the top-level applySettings() call further down —
//  MatrixChat is a `const`, so anything that touches it before this
//  point in the script would hit the temporal-dead-zone, not just an
//  undefined value.
// ══════════════════════════════════════════
const MATRIX_URL          = 'https://matrix.klab.gg';
// jsdelivr's generic `+esm` conversion 404s on matrix-js-sdk's sdp-transform
// dependency (pulled in eagerly for WebRTC calling support we don't even
// use — see plan non-goals). esm.sh's *default* (non-bundle) mode avoids
// that 404 but has its own bug: its shallow per-file CJS export detection
// misses `UnstableValue` in matrix-events-sdk's re-export chain, breaking
// polls.ts's import of it. `?bundle` fixes both at once — esbuild's real
// bundler correctly resolves the export AND tree-shakes out the unused
// sdp-transform/WebRTC path entirely. Verified against the actual bundle
// bytes (no sdp-transform reference, UnstableValue properly defined,
// createClient/ClientEvent both exported, only one Node polyfill —
// node:events, which esm.sh serves natively) before pinning this.
const MATRIX_SDK_URL      = 'https://esm.sh/matrix-js-sdk@42.3.0?bundle';
const MATRIX_SESSION_KEY  = 'klabnet_matrix_session';
const MATRIX_PENDING_KEY  = 'klabnet_matrix_pending_token';

const MatrixChat = (function () {
  let matrixcs = null; // populated by a dynamic import on first login/boot —
                        // users who never open chat never fetch the SDK at all
  let client   = null;
  const listeners = {};

  function on(event, cb) { (listeners[event] = listeners[event] || []).push(cb); }
  function emit(event, ...args) {
    (listeners[event] || []).forEach(cb => { try { cb(...args); } catch (e) { console.error(e); } });
  }

  // The Matrix session is one localStorage key with no record of which
  // klabnet account it belongs to, so signing in as someone else in
  // Authentik left the previous user's Matrix session in place — you'd be
  // posting to the feed as B while chatting as A. Stamping the session
  // with its owner lets a mismatch be caught and thrown away on load.
  function currentKlabUser() {
    const u = window.KLAB_USER?.username;
    return (u && u !== 'anonymous') ? u : null;
  }
  function loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem(MATRIX_SESSION_KEY));
      if (!s) return null;
      const me = currentKlabUser();
      // Identity hasn't landed yet (boot() awaits fetchMe() well before
      // chat starts, so this is the rare race, not the normal path) —
      // nothing to compare against, so leave it alone.
      if (!me) return s;
      // Written before this field existed: no way to know retroactively
      // whose it was, so adopt it rather than signing everyone out once.
      if (!s.klabUser) { s.klabUser = me; saveSession(s); return s; }
      if (s.klabUser !== me) { clearSession(); return null; }
      return s;
    } catch (e) { return null; }
  }
  function saveSession(s) {
    localStorage.setItem(MATRIX_SESSION_KEY, JSON.stringify({ ...s, klabUser: s.klabUser || currentKlabUser() }));
  }
  function clearSession() { localStorage.removeItem(MATRIX_SESSION_KEY); }

  async function loadSdk() {
    if (!matrixcs) matrixcs = await import(MATRIX_SDK_URL);
    return matrixcs;
  }

  // ── SSO popup login ──────────────────────
  // Opens Synapse/MAS's SSO redirect in a popup. Authentik already has a
  // live session for this user (they're on this page at all because they
  // passed Caddy forward-auth), so it should resolve without any visible
  // interaction. The popup is this same index.html, short-circuited by the
  // <head> script for `?matrixSsoCallback=1` — it relays the resulting
  // loginToken back via localStorage + postMessage and closes itself.
  function ssoPopupLogin() {
    return new Promise((resolve, reject) => {
      const redirectUrl = `${location.origin}${location.pathname}?matrixSsoCallback=1`;
      const popup = window.open(
        `${MATRIX_URL}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(redirectUrl)}`,
        'matrix-sso-login',
        'width=480,height=640'
      );
      if (!popup) { reject(new Error('Popup blocked — allow popups for this site to use chat')); return; }

      let settled = false;
      function finish(token) {
        if (settled) return;
        settled = true;
        clearInterval(pollTimer);
        window.removeEventListener('message', onMessage);
        window.removeEventListener('storage', onStorage);
        localStorage.removeItem(MATRIX_PENDING_KEY);
        resolve(token);
      }
      function onMessage(e) {
        if (e.origin !== location.origin) return;
        if (e.data && e.data.type === 'matrix-sso-token') finish(e.data.loginToken);
      }
      function onStorage(e) {
        if (e.key !== MATRIX_PENDING_KEY || !e.newValue) return;
        try { finish(JSON.parse(e.newValue).loginToken); } catch (err) {}
      }
      window.addEventListener('message', onMessage);
      window.addEventListener('storage', onStorage);

      // Belt-and-suspenders poll: the 'storage' event doesn't reliably fire
      // in every browser/timing combo for a popup that closes itself
      // immediately after writing, so also poll the pending-token key
      // directly, and detect the user closing the popup without completing
      // (reject rather than hang the login forever).
      const pollTimer = setInterval(() => {
        if (settled) return;
        try {
          const raw = localStorage.getItem(MATRIX_PENDING_KEY);
          if (raw) { finish(JSON.parse(raw).loginToken); return; }
        } catch (e) {}
        if (popup.closed) {
          settled = true;
          clearInterval(pollTimer);
          window.removeEventListener('message', onMessage);
          window.removeEventListener('storage', onStorage);
          reject(new Error('Login window closed before completing'));
        }
      }, 400);
    });
  }

  async function exchangeLoginToken(loginToken) {
    const res = await fetchTimeout(`${MATRIX_URL}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.token', token: loginToken }),
    }, 8000);
    if (!res.ok) throw new Error(`Matrix login failed: HTTP ${res.status}`);
    return res.json();
  }

  async function bootClient(session) {
    const sdk = await loadSdk();
    client = sdk.createClient({
      baseUrl: MATRIX_URL,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
    });
    client.on(sdk.ClientEvent.Sync, state => {
      emit('sync', state);
      if (state === 'PREPARED') console.info('[MatrixChat] synced. rooms:', client.getRooms());
    });
    // Raw event-name strings rather than the SDK's enum constants (e.g.
    // sdk.RoomEvent.Timeline) — these wire-level names are spec-stable, and
    // pulling another named export off the CDN bundle isn't worth the risk
    // after the UnstableValue detour it took to get this SDK loading at all.
    client.on('Room.timeline', (event, room, toStartOfTimeline) => {
      if (toStartOfTimeline) return; // ignore backfill, only live events
      emit('timeline', event, room);
    });
    client.on('RoomMember.typing', (event, member) => emit('typing', member));
    client.on('Room.receipt', (event, room) => emit('receipt', event, room));
    // A member's m.room.member state event changes whenever THEIR OWN
    // avatar/display name changes (Synapse re-propagates it to every room
    // they're in) — used to bust the per-sender avatar cache below so a
    // participant who changes their avatar mid-session doesn't keep showing
    // their old photo for the rest of the page's life (this used to only
    // self-heal for your *own* avatar via openProfileModal()'s explicit
    // cache-clear; everyone else's stayed stale with no invalidation path
    // at all).
    client.on('RoomState.events', event => {
      if (event.getType() === 'm.room.member') emit('memberProfileChanged', event.getStateKey());
    });
    // gitea#2 listening-party sync — plain to-device messages, no room/
    // timeline involved at all, so nothing here ever shows up as a chat
    // message or notification.
    client.on('toDeviceEvent', event => emit('toDevice', event));
    // gitea#3: 20 felt thin ("does only like 20 messages"). This is just
    // the first page though — scrolling to the top of a room's timeline
    // pages in more/older history via scrollback(), see maybeLoadOlderMessages().
    // lazyLoadMembers: without it, /sync pulls the FULL membership list for
    // every joined room up front — for anyone in a large public channel
    // (see chatBrowseBtn) that's what was making the client take forever
    // to reach PREPARED. With it, only members with visible timeline
    // events sync eagerly; the rest load on demand (opening a room,
    // needing a read receipt's sender, etc).
    await client.startClient({ initialSyncLimit: 50, lazyLoadMembers: true });
    return client;
  }

  // Idempotent/concurrency-safe: the UI can call this from two places that
  // race (an automatic silent reconnect on tab load, and a manual "Connect"
  // click) — without this, both would call bootClient() independently,
  // spinning up two separate MatrixClient instances double-registering
  // every 'sync' listener. Concurrent callers share one in-flight attempt;
  // a failure clears it so a later retry can start fresh, a success stays
  // cached so later calls just resolve to the same already-live client.
  let _loginPromise = null;
  function login() {
    if (_loginPromise) return _loginPromise;
    _loginPromise = (async () => {
      let session = loadSession();
      if (session && session.expiresAt && session.expiresAt < Date.now()) {
        // No refresh support yet (milestone 8) — a lapsed token just forces
        // a fresh SSO round-trip rather than limping along with a dead one.
        clearSession();
        session = null;
      }
      if (!session) {
        const loginToken = await ssoPopupLogin();
        const data = await exchangeLoginToken(loginToken);
        session = {
          accessToken:  data.access_token,
          userId:       data.user_id,
          deviceId:     data.device_id,
          refreshToken: data.refresh_token || null,
          expiresAt:    data.expires_in_ms ? Date.now() + data.expires_in_ms : null,
        };
        saveSession(session);
      }
      return bootClient(session);
    })().catch(e => { _loginPromise = null; throw e; });
    return _loginPromise;
  }

  function logout() {
    try { client && client.stopClient(); } catch (e) {}
    client = null;
    _loginPromise = null; // otherwise a future login() would just hand back the stopped client
    clearSession();
  }

  // Synapse's newer authenticated-media requirement (MSC3916) means a plain
  // <img src="...media/v3/download..."> 401s silently — <img> tags can't
  // attach an Authorization header, so the browser just shows a broken
  // image with no visible error. Fetching the thumbnail ourselves with the
  // access token and handing the caller a blob: URL works regardless of
  // whether the homeserver actually enforces auth on media or not. Shared
  // by every avatar consumer (presence rail, chat timeline) rather than
  // each maintaining its own copy.
  function mxcParts(mxcUrl) {
    const m = /^mxc:\/\/([^/]+)\/([^/?]+)/.exec(mxcUrl || '');
    return m ? { server: m[1], mediaId: m[2] } : null;
  }
  async function mxcToBlobUrl(mxcUrl, opts) {
    const parts = mxcParts(mxcUrl);
    if (!parts || !client) return null;
    const { width = 64, height = 64, method = 'crop', full = false } = opts || {};
    // Synapse's default install only pre-generates a fixed handful of
    // thumbnail sizes (dynamic_thumbnails is off) and always re-encodes
    // whatever it serves at its own (fairly aggressive) JPEG quality —
    // fine for a small avatar crop nobody scrutinizes, but visibly
    // degrades a profile banner or crop-editor preview: the profile
    // system's own uploads are already cropped/sized exactly right client
    // -side (see openImageCropper()), so `full: true` fetches the original
    // bytes we uploaded instead of paying for a second, lossier re-encode.
    const url = full
      ? `${MATRIX_URL}/_matrix/client/v1/media/download/${parts.server}/${parts.mediaId}`
      : `${MATRIX_URL}/_matrix/client/v1/media/thumbnail/${parts.server}/${parts.mediaId}?width=${width}&height=${height}&method=${method}`;
    const res = await fetchTimeout(url, { headers: { Authorization: `Bearer ${client.getAccessToken()}` } }, 8000);
    if (!res.ok) throw new Error(`avatar fetch failed: HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }

  return { login, logout, on, hasSession: () => !!loadSession(), mxcToBlobUrl, get client() { return client; } };
})();

window.MatrixChat = MatrixChat; // console-testable; see the KLAB SOCIAL section below for the UI wiring

// ══════════════════════════════════════════
//  KLAB SOCIAL — Matrix chat UI wiring
//  DOM glue for the Chat tab: a connect prompt when there's no session,
//  otherwise a Discord-like channel list + timeline + composer for one
//  space's worth of rooms. Multi-space nav, DMs, typing/presence, and
//  media are later milestones (see the plan doc referenced above) — this
//  one is plain-text messages in a flat room list only.
// ══════════════════════════════════════════
let _chatUiLoaded = false;
let _chatActiveRoomId = null;

// Consistent per-sender nametag color — same idea as Discord/Slack role
// colors: hash the (stable) Matrix user ID to one fixed entry in a curated
// palette, so a given person's name is always the same color, which makes
// a busy timeline easier to scan by sender at a glance. Picked for
// readability against both the dark (near-black) and light (warm cream)
// theme backgrounds, and clear of --danger-color/--success-color so a
// nametag is never mistaken for an error or online-status hue.
// Expanded from the original 8 so the profile color picker below has real
// choice, still all readability-tested against both theme backgrounds and
// clear of --danger-color/--success-color.
const CHAT_NAME_COLORS = ['#5b9dd9', '#a78bfa', '#f472b6', '#fb923c', '#2dd4bf', '#eab308', '#38bdf8', '#c084fc',
  '#4ade80', '#f87171', '#facc15', '#818cf8', '#fb7185', '#22d3ee', '#e879f9', '#a3e635',
  '#f59e0b', '#6ee7b7', '#93c5fd', '#fda4af'];
function chatNameColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CHAT_NAME_COLORS[hash % CHAT_NAME_COLORS.length];
}

// Mirrors klabnet-api's BIO_MAX_CHARS default — just a UI hint (the server
// is authoritative and truncates regardless), same soft-duplication as the
// feed reply input's maxlength="500" mirroring POST_MAX_CHARS.
const PROFILE_BIO_MAX_CHARS = 160;
const _HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

// Same @user:server -> username convention used everywhere else (see
// dmOtherUsername/messageUser) — named here since profileColor() and the
// profile-view popover both need it from call sites that only have a
// Matrix ID (e.g. a chat message's senderId), not a plain klabnet username.
function mxIdToUsername(userId) {
  return userId ? userId.replace(/^@/, '').split(':')[0] : '';
}

// Bulk per-user profile data (chat color override, bio, banner) — mirrors
// _notesCache's "one bulk fetch, no per-card request" shape (see
// fetchNotes() further down). Keyed by klabnet username, populated by
// fetchProfiles() (hooked into the presence poll's startPoll()/stopPoll()).
const _profiles = new Map(); // username -> {chat_color, bio, banner_mxc}
async function fetchProfiles() {
  try {
    const r = await fetchTimeout('/api/profiles', {}, 6000);
    if (!r.ok) return;
    const data = await r.json();
    _profiles.clear();
    Object.entries(data.profiles || {}).forEach(([username, p]) => _profiles.set(username, p));
  } catch (e) {}
}

// Drop-in replacement for chatNameColor() at every render call site: uses
// the user's own chosen color if they've set one — re-validated here too,
// not just trusted from the server, since this is about to be interpolated
// straight into a `style="--name-color:...;"` attribute — else falls back
// to the same hash default chatNameColor() always used. Accepts either a
// plain username or a full Matrix ID (chat call sites only have the
// latter), and always hashes the *username* for the fallback so the same
// person gets the same auto-color in chat as in the feed/presence rail.
function profileColor(usernameOrMxId) {
  const username = usernameOrMxId.startsWith('@') ? mxIdToUsername(usernameOrMxId) : usernameOrMxId;
  const color = _profiles.get(username)?.chat_color;
  return (color && _HEX_COLOR_RE.test(color)) ? color : chatNameColor(username);
}

// Message-avatar cache, keyed by Matrix user ID (unlike the presence
// rail's cache, which is keyed by klabnet username). This used to trust
// the mxc URL already attached to each message's RoomMember snapshot to
// skip a profile lookup — but that snapshot is only as fresh as the last
// m.room.member state event Synapse happened to propagate to that room,
// which can lag well behind a just-changed global profile avatar (this is
// what caused feed/presence to show a freshly-changed avatar immediately
// while chat kept showing the old one — those two already did a live
// getProfileInfo() lookup instead). Doing the same lookup here trades one
// extra one-time request per sender for actually being correct.
const _msgAvatarCache   = new Map(); // userId -> blob URL, or null
const _msgAvatarPending = new Set();

function ensureMsgAvatarResolved(userId) {
  if (!userId || _msgAvatarCache.has(userId) || _msgAvatarPending.has(userId)) return;
  const client = MatrixChat.client;
  if (!client) return;
  _msgAvatarPending.add(userId);
  (async () => {
    try {
      const info = await client.getProfileInfo(userId);
      _msgAvatarCache.set(userId, info?.avatar_url ? await MatrixChat.mxcToBlobUrl(info.avatar_url) : null);
    } catch (e) {
      if (!_msgAvatarCache.has(userId)) _msgAvatarCache.set(userId, null);
    }
    _msgAvatarPending.delete(userId);
    // Paint the now-resolved avatar directly into any already-rendered
    // rows for this sender instead of forcing a full renderTimeline()
    // rebuild — this used to reset _lastTimelineRenderKey and re-render
    // the whole message list (avatars resolve async, per sender, so a
    // chatty room could trigger several of these in a row), which is one
    // of the causes behind chat messages visibly flickering. Nothing else
    // about a message's rendering ever depends on avatar-cache state, so
    // a direct DOM patch is equivalent and doesn't touch the rest of the
    // timeline.
    const url = _msgAvatarCache.get(userId);
    if (!url) return;
    document.querySelectorAll(
      `.chat-msg-avatar[data-msg-avatar-for="${CSS.escape(userId)}"], .chat-msg-seen-avatar[data-seen-avatar-for="${CSS.escape(userId)}"]`
    ).forEach(avatar => {
      if (avatar.querySelector('img')) return;
      avatar.textContent = '';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      avatar.appendChild(img);
    });
  })();
}

// Busts a stale cached avatar for one sender (see the 'memberProfileChanged'
// wiring in showChatApp()) and re-resolves it — otherwise a participant who
// changes their avatar mid-session keeps showing their old photo in every
// already-rendered row for the rest of the page's life.
function invalidateMsgAvatar(userId) {
  if (!userId || !_msgAvatarCache.has(userId)) return;
  // The old blob URL used to just get dropped here with no revoke — every
  // avatar change (not exactly rare over a long session) permanently
  // leaked its previous photo. Safe to revoke immediately: the <img>s
  // using it are removed in this same synchronous block, right below.
  const oldUrl = _msgAvatarCache.get(userId);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  _msgAvatarCache.delete(userId);
  document.querySelectorAll(
    `.chat-msg-avatar[data-msg-avatar-for="${CSS.escape(userId)}"], .chat-msg-seen-avatar[data-seen-avatar-for="${CSS.escape(userId)}"]`
  ).forEach(avatar => avatar.querySelectorAll('img').forEach(img => img.remove()));
  ensureMsgAvatarResolved(userId);
}

// Rooms recorded in the 'm.direct' account-data map are DMs; everything
// else joined (minus spaces) is a "channel". Matrix has no room-level flag
// for this — m.direct is the SDK-standard convention every client uses.
function getDmRoomIds() {
  const content = MatrixChat.client?.getAccountData('m.direct')?.getContent() || {};
  return new Set(Object.values(content).flat());
}

// startDm() only writes m.direct for whoever *initiates* the DM — the
// person they invited never gets their own m.direct entry, so on their
// side the room has no record of being a DM at all and falls into
// Channels by default. Self-heals it using the is_direct flag Matrix
// itself puts on the invite (RoomMember.getDMInviter(), returns the other
// party's user ID if we were invited as a direct chat) — fire-and-forget,
// re-renders once if anything actually changed. Each room is only ever
// checked once per page load; a room's DM-ness never changes afterward.
const _dmBookkeepingChecked = new Set();
// Guards against two overlapping calls (renderChannelList() runs on
// every 'timeline'/'sync' event, so this can be re-entered while an
// earlier write is still in flight) racing: both would read the same
// stale m.direct snapshot, and whichever setAccountData() resolves last
// would silently clobber the other's addition. Rooms discovered while a
// write is already in flight just aren't marked checked, so they're
// picked up cleanly on the next call once it clears — no data lost.
let _dmBookkeepingInFlight = false;
function ensureDmBookkeeping() {
  if (_dmBookkeepingInFlight) return;
  const client = MatrixChat.client;
  if (!client) return;
  const myId = client.getUserId();
  const directContent = client.getAccountData('m.direct')?.getContent() || {};
  const known = new Set(Object.values(directContent).flat());
  const additions = {}; // inviter -> roomIds discovered this pass
  client.getRooms().forEach(room => {
    if (_dmBookkeepingChecked.has(room.roomId) || known.has(room.roomId)) return;
    _dmBookkeepingChecked.add(room.roomId);
    const inviter = room.getMember(myId)?.getDMInviter?.();
    if (!inviter) return;
    (additions[inviter] = additions[inviter] || []).push(room.roomId);
  });
  if (!Object.keys(additions).length) return;
  _dmBookkeepingInFlight = true;
  const updated = { ...directContent };
  Object.entries(additions).forEach(([inviter, roomIds]) => {
    updated[inviter] = [...(updated[inviter] || []), ...roomIds];
  });
  client.setAccountData('m.direct', updated)
    .then(renderChannelList)
    .catch(() => {})
    .finally(() => { _dmBookkeepingInFlight = false; });
}

// The other party's username in a (2-member) DM room — same @user:server
// -> username convention used everywhere else this session (avatar
// lookups, DM bookkeeping). Returns null for group DMs/anything odd.
// The newest real message in a room (not an edit, reaction or state event).
function roomLastMessage(room) {
  const evs = room.getLiveTimeline?.().getEvents?.() || [];
  for (let i = evs.length - 1; i >= 0; i--) {
    const ev = evs[i];
    if (ev.getType() === 'm.room.message' && ev.getRelation?.()?.rel_type !== 'm.replace') return ev;
  }
  return null;
}
function roomLastTs(room) { const ev = roomLastMessage(room); return ev ? ev.getTs() : 0; }
function shortAgo(ts) {
  const m = (Date.now() - ts) / 60000;
  if (m < 1) return 'now';
  if (m < 60) return Math.round(m) + 'm';
  if (m < 1440) return Math.round(m / 60) + 'h';
  if (m < 7 * 1440) return new Date(ts).toLocaleDateString([], { weekday: 'short' });
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function roomPreview(room, ev, isDm) {
  if (!ev) return isDm ? 'Say hi' : 'No messages yet';
  const me = MatrixChat.client?.getUserId();
  const who = ev.getSender() === me ? 'You: ' : (isDm ? '' : mxIdToUsername(ev.getSender()) + ': ');
  if (ev.isRedacted?.()) return who + 'message deleted';
  const c = ev.getContent() || {};
  if (c['klab.song']) return who + '🎵 ' + (c['klab.song'].title || 'a song');
  if (c.msgtype === 'm.image') return who + '📷 Photo';
  // Replies carry the quoted text as "> …" lines first; skip those.
  const body = typeof c.body === 'string' ? c.body.replace(/^>.*\n?/gm, '').trim() : '';
  return who + body;
}

// Sidebar search: filters conversations, and finds anyone on the site to
// message (the people you haven't talked to yet aren't listed otherwise).
function applyChatSearch() {
  const input = document.getElementById('chatSearch');
  const q = (input?.value || '').trim().toLowerCase();
  document.querySelectorAll('#chatSide .chat-conv').forEach(el => { el.hidden = !!q && !el.dataset.search?.includes(q); });
  const people = document.getElementById('chatPeopleResults');
  const online = document.getElementById('presenceList');
  if (online) online.closest('.chat-side-scroll')?.classList.toggle('searching', !!q);
  // A section with nothing matching loses its label while searching.
  for (const [lblSel, listId] of [['#chatChannelsList', 'chatChannelsList'], ['#chatDmLbl', 'chatDmList']]) {
    const listEl = document.getElementById(listId);
    const lbl = lblSel === '#chatChannelsList' ? listEl?.previousElementSibling : document.querySelector(lblSel);
    if (lbl) lbl.classList.toggle('search-empty', !!q && !listEl?.querySelector('.chat-conv:not([hidden])'));
  }
  if (!people) return;
  if (!q) { people.hidden = true; people.innerHTML = ''; return; }
  const me = window.KLAB_USER?.username;
  const dmWith = new Set([...document.querySelectorAll('#chatDmList .chat-conv')].map(el => el.dataset.search));
  const found = (window.klabRoster ? window.klabRoster() : []).filter(u => u && u !== me && u.toLowerCase().includes(q) && ![...dmWith].some(d => d.split(' ').includes(u.toLowerCase()))).slice(0, 8);
  people.hidden = !found.length;
  people.innerHTML = found.length ? '<div class="chat-lbl">People</div>' + found.map(u =>
    `<button type="button" class="chat-conv chat-person" data-person="${esc(u)}"><span class="chat-conv-face" style="--c:${profileColor(u)}">${esc(u[0].toUpperCase())}${window.KLAB_ONLINE_USERNAMES?.has(u) ? '<span class="chat-channel-online-dot"></span>' : ''}</span>` +
    `<span class="chat-conv-tx"><span class="chat-conv-top"><span class="chat-channel-name" style="color:${profileColor(u)}">${esc(u)}</span></span><span class="chat-conv-last">Message ${esc(u)}</span></span></button>`).join('') : '';
}
document.getElementById('chatSearch')?.addEventListener('input', applyChatSearch);
document.getElementById('chatSearch')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; applyChatSearch(); }
  if (e.key === 'Enter') document.querySelector('#chatSide .chat-conv:not([hidden])')?.click();
});
document.getElementById('chatPeopleResults')?.addEventListener('click', e => {
  const b = e.target.closest('[data-person]');
  if (!b) return;
  const input = document.getElementById('chatSearch'); if (input) input.value = '';
  applyChatSearch();
  messageUser(b.dataset.person);
});

function dmOtherUsername(room) {
  const myId = MatrixChat.client?.getUserId();
  const other = room.getJoinedMembers?.().find(m => m.userId !== myId);
  return other ? other.userId.replace(/^@/, '').split(':')[0] : null;
}

function buildChannelItem(room, icon) {
  // createRoom({invite:[...]}) only invites — the recipient hasn't actually
  // joined yet, and sending a message would fail if we treated this like
  // any other room. Clicking an invited room joins it first (Discord-style
  // no-friction accept, not a separate accept/decline step).
  const invited = room.getMyMembership && room.getMyMembership() === 'invite';
  const isDm = icon === 'ti-user';
  // klabnet's own online roster, kept up to date by the presence module
  // (window.KLAB_ONLINE_USERNAMES) — reused here rather than a second
  // presence source, so a DM shows the same "online" you'd see in the rail.
  const dmOnline = !invited && isDm && window.KLAB_ONLINE_USERNAMES?.has(dmOtherUsername(room));
  // The Chat tab's own badge (updateSocialUnreadBadge()) only ever said
  // *how many* rooms had something unread, never *which* ones — you had
  // to click through every channel/DM to find it. Same source of truth
  // (_chatUnreadRooms), just rendered per-row here too.
  const hasUnread = _chatUnreadRooms.has(room.roomId);
  const item = document.createElement('div');
  item.dataset.roomId = room.roomId; // updateChannelUnreadDots() targets rows by this instead of a full re-render
  item.className = 'chat-channel-item chat-conv' + (room.roomId === _chatActiveRoomId ? ' active' : '') + (hasUnread ? ' has-unread' : '');
  const other = isDm && !invited ? dmOtherUsername(room) : null;
  item.dataset.search = ((room.name || '') + ' ' + (other || '')).toLowerCase();
  let lead;
  if (invited) lead = '<span class="chat-conv-lead"><i class="ti ti-mail"></i></span>';
  else if (isDm) {
    const face = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(other) : null;
    lead = `<span class="chat-conv-face" style="--c:${profileColor(other || room.name || '')}">${face ? `<img src="${esc(face)}" alt="" />` : esc(((other || room.name || '?')[0] || '?').toUpperCase())}${dmOnline ? '<span class="chat-channel-online-dot"></span>' : ''}</span>`;
  } else lead = '<span class="chat-conv-lead">#</span>';
  const last = roomLastMessage(room);
  item.innerHTML = lead +
    `<span class="chat-conv-tx"><span class="chat-conv-top"><span class="chat-channel-name"${isDm && other ? ` style="color:${profileColor(other)}"` : ''}>${esc(room.name || 'Unnamed room')}</span>` +
      (hasUnread ? '<span class="chat-channel-unread-dot" title="Unread messages"></span>' : '') +
      `<span class="chat-conv-when">${last ? shortAgo(last.getTs()) : ''}</span></span>` +
      `<span class="chat-conv-last">${invited ? 'invited you' : esc(roomPreview(room, last, isDm))}</span></span>` +
    (isDm ? '<button class="chat-channel-close" title="Close conversation"><i class="ti ti-x"></i></button>' : '');
  item.addEventListener('click', async () => {
    if (invited) {
      try { await MatrixChat.client.joinRoom(room.roomId); } catch (e) { showToast(`Couldn't join: ${e.message || 'error'}`, 'ti-door-off'); return; }
    } else if (room.roomId === _chatActiveRoomId) {
      // Already the active room, so there's nothing to re-render — but on
      // mobile this row is still the only way into that conversation.
      setChatMobileView('convo');
      return;
    }
    _chatActiveRoomId = room.roomId;
    renderChannelList();
    setChatMobileView('convo');
  });
  item.querySelector('.chat-channel-close')?.addEventListener('click', async e => {
    e.stopPropagation(); // don't also select the room we're about to leave
    // Fired immediately with zero confirmation before — per the comment
    // above this actually leaves the room outright, not a client-side
    // hide, so it deserves the same confirm() every other permanent-delete
    // action in the app already gets.
    if (!(await showConfirmDialog('// close DM', 'Close this conversation? You can start a new one, but this closes it for good.', 'Close'))) return;
    try {
      await MatrixChat.client.leave(room.roomId);
      if (_chatActiveRoomId === room.roomId) _chatActiveRoomId = null;
      renderChannelList();
    } catch (err) {
      showToast(`Couldn't close DM: ${err.message || 'error'}`, 'ti-message-x');
    }
  });
  return item;
}

// Always re-renders the timeline pane too at the end — every call site
// wants both kept in sync (a new/renamed room, a room becoming the active
// one, etc.), so there's a single place responsible for that pairing
// instead of every caller having to remember to call both.
// Same "skip if nothing relevant changed" idea as renderTimeline() — this
// used to fully teardown/rebuild the sidebar on every single timeline
// event across every joined room and every sync tick, not just when a
// room was actually added/removed/renamed.
let _lastChannelListKey = null;

function renderChannelList() {
  const list = document.getElementById('chatChannelsList');
  if (!list || !MatrixChat.client) return;
  ensureDmBookkeeping();
  // Spaces get their own nav in a later milestone — hide them from this
  // flat list for now so they don't show up as bogus empty "channels".
  // client.getRooms() keeps returning rooms after you've left them (the
  // close-DM button calls client.leave()) — without filtering membership,
  // a closed DM stayed in the list, and since you can no longer resolve
  // the other member's state once you've left, it rendered as a
  // nameless "Empty room" instead of actually disappearing.
  const dmIds = getDmRoomIds();
  const allRooms = MatrixChat.client.getRooms().filter(r => {
    if (r.isSpaceRoom && r.isSpaceRoom()) return false;
    const membership = r.getMyMembership?.();
    return membership === 'join' || membership === 'invite';
  });
  // Newest activity first, like any messaging app: a conversation that
  // just got a message moves to the top of its section.
  const byRecent = (a, b) => roomLastTs(b) - roomLastTs(a) || (a.name || '').localeCompare(b.name || '');
  const dmRooms      = allRooms.filter(r => dmIds.has(r.roomId)).sort(byRecent);
  const channelRooms = allRooms.filter(r => !dmIds.has(r.roomId)).sort(byRecent);
  const rooms = [...channelRooms, ...dmRooms];

  if (!rooms.length) {
    if (_lastChannelListKey !== '') {
      _lastChannelListKey = '';
      list.innerHTML = '<div class="chat-channel-empty">No channels yet — use the buttons above to browse or create one.</div>';
    }
    _chatActiveRoomId = null;
    renderTimeline();
    return;
  }
  if (!_chatActiveRoomId || !rooms.some(r => r.roomId === _chatActiveRoomId)) {
    _chatActiveRoomId = [...rooms].sort(byRecent)[0].roomId; // land where the conversation is
  }

  const listKey = rooms.map(r => {
    const online = dmIds.has(r.roomId) && window.KLAB_ONLINE_USERNAMES?.has(dmOtherUsername(r)) ? '1' : '0';
    const unread = _chatUnreadRooms.has(r.roomId) ? '1' : '0';
    const last = roomLastMessage(r);
    const face = dmIds.has(r.roomId) && window.klabResolveUserAvatar?.(dmOtherUsername(r)) ? 'a' : '';
    return `${r.roomId}:${r.name || ''}:${r.getMyMembership?.() || ''}:${online}:${unread}:${last ? last.getId() : ''}${face}:${last ? shortAgo(last.getTs()) : ''}`;
  }).join(',') + '|' + _chatActiveRoomId;
  if (listKey !== _lastChannelListKey) {
    _lastChannelListKey = listKey;
    list.innerHTML = '';
    list.append(...channelRooms.map(room => buildChannelItem(room, 'ti-hash')));
    const dmList = document.getElementById('chatDmList');
    if (dmList) {
      dmList.innerHTML = '';
      dmList.append(...dmRooms.map(room => buildChannelItem(room, 'ti-user')));
      const lbl = document.getElementById('chatDmLbl');
      if (lbl) lbl.hidden = !dmRooms.length;
    }
    applyChatSearch();
  }
  syncChatHead();
  // The active room can change without anyone tapping a row (the
  // auto-select above, or leaving the room you were in), so the mobile
  // bar's title is refreshed here rather than only in setChatMobileView().
  syncChatMobileTitle();
  renderTimeline();
}

// Typing state is only ever tracked for the active room — cleared here
// (rather than at every _chatActiveRoomId assignment site, of which there
// are several) whenever renderTimeline() notices the room actually changed.
const _typingUsers = new Map(); // userId -> display name, active room only
let _typingRenderedRoomId = null;

function renderTypingLine() {
  const el = document.getElementById('chatTyping');
  if (!el) return;
  const names = [..._typingUsers.values()];
  if (!names.length) el.textContent = '';
  else if (names.length === 1) el.textContent = `${names[0]} is typing…`;
  else if (names.length === 2) el.textContent = `${names[0]} and ${names[1]} are typing…`;
  else el.textContent = 'Several people are typing…';
}

// renderChannelList() always cascades into this (see its own comment) —
// which used to mean *any* timeline event in *any* room, or even a
// routine sync tick, fully rebuilt the active room's DOM and yanked the
// scroll position to the bottom, even while the user was scrolled up
// reading history and nothing in this room had actually changed. The key
// below (room + per-event id/redacted/edited state) lets a no-op call
// bail before touching the DOM at all; when a rebuild is genuinely
// needed, scroll only snaps to bottom if the user was already there (or
// this is a fresh room switch) rather than always.
let _lastTimelineRenderKey = null;
const _lastSentReadEventId = new Map(); // roomId -> event id we've already sent a read receipt for
// Set right before forcing a render on Chat-tab arrival (see setActiveTab)
// — roomChanged alone doesn't catch "same room, just left it scrolled up
// and came back", which renderTimeline()'s own wasNearBottom check would
// otherwise leave scrolled up too, contradicting the whole point of that
// forced-render-on-arrival behavior (see its comment). Consumed once by
// renderTimeline() and reset, so it never affects any OTHER render.
let _forceScrollBottomOnNextRender = false;

// Reactions (m.reaction) are ordinary room events the SDK already delivers
// through the same timeline as everything else — they're just filtered out
// of renderTimeline()'s own `events` list (see the m.room.message check
// there) so they never render as message rows of their own. This scans the
// room's full unfiltered timeline and folds them into one map per render
// instead of tracking incremental add/remove state, which is simple to
// reason about at this app's message volume and self-corrects from
// whatever the SDK's local timeline currently holds.
function computeReactions(room) {
  const map = new Map(); // targetEventId -> Map(emoji -> {senders:Set, mine:eventId|null})
  const me = MatrixChat.client.getUserId();
  room.getLiveTimeline().getEvents().forEach(ev => {
    if (ev.getType() !== 'm.reaction' || ev.isRedacted()) return;
    const rel = ev.getContent()['m.relates_to'];
    if (!rel || rel.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) return;
    let byEmoji = map.get(rel.event_id);
    if (!byEmoji) { byEmoji = new Map(); map.set(rel.event_id, byEmoji); }
    let entry = byEmoji.get(rel.key);
    if (!entry) { entry = { senders: new Set(), mine: null }; byEmoji.set(rel.key, entry); }
    entry.senders.add(ev.getSender());
    if (ev.getSender() === me) entry.mine = ev.getId();
  });
  return map;
}

async function toggleReaction(targetEventId, emoji) {
  const room = _chatActiveRoomId && MatrixChat.client?.getRoom(_chatActiveRoomId);
  if (!room || !targetEventId) return;
  const mine = computeReactions(room).get(targetEventId)?.get(emoji)?.mine;
  try {
    if (mine) {
      await MatrixChat.client.redactEvent(room.roomId, mine);
    } else {
      await MatrixChat.client.sendEvent(room.roomId, 'm.reaction', {
        'm.relates_to': { rel_type: 'm.annotation', event_id: targetEventId, key: emoji },
      });
    }
  } catch (e) { console.error('[chat] reaction failed', e); }
}

let _replyingToEventId = null;
function startReply(eventId) {
  const room = _chatActiveRoomId && MatrixChat.client?.getRoom(_chatActiveRoomId);
  const ev = room?.findEventById(eventId);
  const preview = document.getElementById('chatReplyPreview');
  if (!ev || !preview) return;
  _replyingToEventId = eventId;
  const senderName = ev.sender?.name || ev.getSender();
  preview.innerHTML = `<div class="chat-reply-preview-body"><span class="chat-reply-preview-name">${esc(senderName)}</span> ${esc((ev.getContent().body || '').slice(0, 80))}</div><i class="ti ti-x chat-reply-preview-close"></i>`;
  preview.hidden = false;
  document.getElementById('chatComposerInput')?.focus();
}
function clearReply() {
  _replyingToEventId = null;
  const preview = document.getElementById('chatReplyPreview');
  if (preview) { preview.hidden = true; preview.innerHTML = ''; }
}

// Chat image messages (m.image) — same lazy-resolve-then-DOM-patch idiom as
// ensureMsgAvatarResolved() above (never forces a renderTimeline() rebuild
// on resolve, which is what used to cause the chat flicker bug). Unlike the
// feed's equivalent cache, there's no need to guard on MatrixChat.client
// existing here — renderTimeline() itself can't run at all without an
// already-connected client (it needs one to look up the active room).
const _chatImageCache   = new Map(); // mxc:// -> blob URL or null
const _chatImagePending = new Set();
const CHAT_IMAGE_CACHE_MAX = 120; // see capBlobCache()'s own comment
function ensureChatImageResolved(mxc) {
  if (!mxc || _chatImageCache.has(mxc) || _chatImagePending.has(mxc)) return;
  _chatImagePending.add(mxc);
  MatrixChat.mxcToBlobUrl(mxc, { width: 400, height: 400, method: 'scale' }).then(url => {
    _chatImageCache.set(mxc, url);
  }).catch(() => {
    _chatImageCache.set(mxc, null);
  }).finally(() => {
    _chatImagePending.delete(mxc);
    capBlobCache(_chatImageCache, CHAT_IMAGE_CACHE_MAX);
    const url = _chatImageCache.get(mxc);
    if (!url) return;
    document.querySelectorAll(`.chat-msg-image[data-mxc="${CSS.escape(mxc)}"]`).forEach(img => {
      if (!img.src || !img.src.startsWith('blob:')) {
        img.src = url;
        // This image has no reserved height, so it pops in well after
        // renderTimeline() already pinned scrollTop to the bottom (that
        // measurement ran before this async fetch even started) — growing
        // the content below the fold without anything re-pinning it. If
        // you're still (or again) near the bottom by the time it actually
        // loads, follow it back down; if you've since scrolled away to
        // read history, leave you alone.
        img.addEventListener('load', () => {
          const el = document.getElementById('chatTimeline');
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
        }, { once: true });
      }
    });
  });
}

// Google Fonts loads with display:swap (see the <link> in <head>) — chat's
// initial render can happen with fallback-font metrics still in effect (the
// real webfont hasn't finished downloading yet), then every line reflows
// the moment it swaps in, moving the bottom of the timeline out from under
// wherever renderTimeline() just pinned it — with nothing to re-pin it
// afterward. This is the "have to scroll down, jumps around SOMETIMES" part
// of the reported bug specifically: it only shows up when the font hasn't
// already loaded/cached by the time chat first renders, so it's timing-
// dependent rather than every single time. Same "re-pin if still near the
// bottom, leave alone if you've since scrolled away" idea as the chat-image
// load fix below. document.fonts.ready resolves immediately (not just
// once-ever) if fonts were already loaded by the time this runs, so this
// is safe to fire unconditionally at script load regardless of whether
// Chat has even been opened yet.
document.fonts?.ready?.then(() => {
  const el = document.getElementById('chatTimeline');
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
});

// "Today" / "Yesterday" / "Month D" (add a year only once it's not the
// current one) — the day-divider label between chat messages, same idea as
// Discord/iMessage's date rules so history is legible without hovering
// every timestamp to figure out what day it's from.
function chatDateLabel(date) {
  const now = new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const opts = date.getFullYear() === now.getFullYear()
    ? { month: 'long', day: 'numeric' }
    : { month: 'long', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString(undefined, opts);
}

function renderTimeline() {
  const el    = document.getElementById('chatTimeline');
  const input = document.getElementById('chatComposerInput');
  if (!el) return;
  const roomChanged = _chatActiveRoomId !== _typingRenderedRoomId;
  if (roomChanged) {
    _typingRenderedRoomId = _chatActiveRoomId;
    _typingUsers.clear();
    renderTypingLine();
  }
  const room = _chatActiveRoomId && MatrixChat.client?.getRoom(_chatActiveRoomId);
  if (!room) {
    el.innerHTML = '<div class="chat-timeline-empty">Select a channel to start chatting.</div>';
    if (input) input.disabled = true;
    _lastTimelineRenderKey = null;
    return;
  }
  if (input) input.disabled = false;
  const isDmRoom = getDmRoomIds().has(room.roomId);
  el.classList.toggle('is-dm', isDmRoom);

  const events = room.getLiveTimeline().getEvents().filter(ev => {
    if (ev.getType() !== 'm.room.message') return false;
    // An edit shows up as its own timeline entry, but the SDK already
    // folds it into the original event's content — rendering it again
    // here would show a second, redundant bubble with no body.
    return ev.getRelation()?.rel_type !== 'm.replace';
  });

  const reactions = computeReactions(room);

  // Actually being shown (Chat tab open, this room selected) counts as
  // read — same condition notifyNewMessage() uses to decide the reverse.
  // Sending our own read receipt too (gitea#3) so the "Seen" line below
  // shows up for the other party, and so other Matrix clients we're
  // logged into elsewhere agree on what's read.
  //
  // Guarded by _lastSentReadEventId: without it this fired on EVERY
  // renderTimeline() call, including the ones the receipt listener itself
  // triggers below — receiving a receipt caused us to send one right back,
  // which the other client's own copy of this same code echoed right back
  // again, forever, with each bounce forcing a full timeline rebuild on
  // both ends (this is what was seen as messages "flickering in and out"
  // between two people actively in the same room). Only sending when the
  // event we'd acknowledge has actually changed breaks the loop at the
  // source; the receipt listener no longer force-rebuilding at all (see
  // updateSeenLine()) closes it from the other side too.
  if (!document.hidden && document.querySelector('.tab-panel[data-tab-panel="chat"]')?.classList.contains('active')) {
    markRoomRead(room.roomId);
    const lastEvent = events[events.length - 1];
    if (lastEvent && _lastSentReadEventId.get(room.roomId) !== lastEvent.getId()) {
      _lastSentReadEventId.set(room.roomId, lastEvent.getId());
      MatrixChat.client.sendReadReceipt(lastEvent).catch(() => {});
    }
  }

  // Reactions land as their own timeline events (type m.reaction, filtered
  // out of `events` above so they never render as message rows of their
  // own) — folding a digest of them into renderKey is what makes a new/
  // removed reaction actually trigger a rebuild, the same way an edit or
  // redaction already does above.
  let reactionsDigest = [];
  reactions.forEach((byEmoji, targetId) => {
    byEmoji.forEach((entry, emoji) => {
      reactionsDigest.push(`${targetId}:${emoji}:${entry.senders.size}:${entry.mine ? 1 : 0}`);
    });
  });
  reactionsDigest.sort();

  const renderKey = room.roomId + '|' + events.map(ev =>
    `${ev.getId()}:${ev.isRedacted() ? 1 : 0}:${ev.replacingEvent?.()?.getId() || ''}`
  ).join(',') + '|' + reactionsDigest.join(',');
  if (!roomChanged && renderKey === _lastTimelineRenderKey) return;
  const wasNearBottom = roomChanged || _forceScrollBottomOnNextRender || (el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  _forceScrollBottomOnNextRender = false;
  // Only meaningful in the "reading history" branch below (wasNearBottom
  // already covers the other case) — el.innerHTML='' unconditionally
  // zeroes scrollTop, so without saving+restoring this, ANY rebuild that
  // happens while you're scrolled up (a reaction/edit/redaction elsewhere
  // in the room, not just your own scrolling) silently dumps you back to
  // the top of the conversation.
  const oldScrollTop    = el.scrollTop;
  const oldScrollHeight = el.scrollHeight;
  _lastTimelineRenderKey = renderKey;

  el.innerHTML = '';
  if (!events.length) {
    // An empty conversation says who it's with and gives you a way in.
    const other = isDmRoom ? (dmOtherUsername(room) || room.name || '') : '';
    el.innerHTML = `<div class="chat-hello">${isDmRoom
      ? `<span class="chat-head-face chat-hello-face" style="--c:${profileColor(other)}">${esc((other[0] || '?').toUpperCase())}</span><h3>You and <span style="color:${profileColor(other)}">${esc(other)}</span></h3><p>This is the start of your conversation.</p>`
      : `<span class="chat-head-hash chat-hello-face">#</span><h3>${esc(room.name || 'channel')}</h3><p>Nothing here yet. Say something.</p>`}
      <div class="chat-hello-chips"><button type="button" class="chat-hello-chip" data-say="yo 👋">👋 Say yo</button>` +
      (playerState.currentSong ? `<button type="button" class="chat-hello-chip" data-share-np>🎵 Share what you're playing</button>` : '') +
      (isDmRoom ? `<button type="button" class="chat-hello-chip" data-say="what are you listening to">🎧 Ask what they're playing</button>` : '') + '</div></div>';
    return;
  }
  let lastSender = null;
  let lastDayKey = null;
  events.forEach(ev => {
    const evDate = new Date(ev.getTs());
    const dayKey = evDate.toDateString();
    if (dayKey !== lastDayKey) {
      lastDayKey = dayKey;
      lastSender = null; // a new day always gets its own sender header, even mid-streak
      const sep = document.createElement('div');
      sep.className = 'chat-date-sep';
      sep.innerHTML = `<span class="chat-date-sep-line"></span><span class="chat-date-sep-label">${esc(chatDateLabel(evDate))}</span><span class="chat-date-sep-line"></span>`;
      el.appendChild(sep);
    }

    const senderId   = ev.getSender();
    const senderName = ev.sender?.name || senderId;
    const grouped    = senderId === lastSender;
    lastSender = senderId;

    const row = document.createElement('div');
    const mine = senderId === MatrixChat.client.getUserId();
    row.className = 'chat-msg' + (grouped ? ' grouped' : '') + (mine ? ' mine' : '');
    row.dataset.eventId = ev.getId();

    if (!ev.isRedacted()) {
      const actions = document.createElement('div');
      actions.className = 'chat-msg-actions';
      actions.innerHTML = QUICK_REACTIONS.map(e =>
        `<button type="button" class="chat-msg-action-btn" data-action="react" data-emoji="${e}">${e}</button>`
      ).join('') + `<button type="button" class="chat-msg-action-btn" data-action="reply" title="Reply"><i class="ti ti-arrow-back-up"></i></button>`;
      row.appendChild(actions);
    }

    const avatar = document.createElement('div');
    avatar.className = 'chat-msg-avatar' + (grouped ? ' grouped' : '');
    avatar.dataset.msgAvatarFor = senderId;
    ensureMsgAvatarResolved(senderId);
    const cachedAvatarUrl = _msgAvatarCache.get(senderId);
    if (cachedAvatarUrl) {
      const img = document.createElement('img');
      img.src = cachedAvatarUrl;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = (senderName || '?').trim().charAt(0).toUpperCase();
    }

    const body = document.createElement('div');
    body.className = 'chat-msg-body';
    if (!grouped) {
      const head = document.createElement('div');
      head.className = 'chat-msg-head';
      head.innerHTML = `<span class="chat-msg-sender" data-username="${esc(mxIdToUsername(senderId))}" style="color:${profileColor(senderId)}">${esc(senderName)}</span><span class="chat-msg-time">${new Date(ev.getTs()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
      body.appendChild(head);
    }

    const content = ev.getContent();
    const replyToId = !ev.isRedacted() ? content['m.relates_to']?.['m.in_reply_to']?.event_id : null;
    if (replyToId) {
      const quote = document.createElement('div');
      quote.className = 'chat-msg-reply-quote';
      quote.dataset.parentId = replyToId;
      const parentEv = room.findEventById(replyToId);
      if (parentEv) {
        const parentName = parentEv.sender?.name || parentEv.getSender();
        quote.innerHTML = `<span class="chat-msg-reply-quote-name" data-username="${esc(mxIdToUsername(parentEv.getSender()))}" style="color:${profileColor(parentEv.getSender())}">${esc(parentName)}</span> ${esc((parentEv.getContent().body || '').slice(0, 60))}`;
      } else {
        quote.textContent = 'Replying to a message';
      }
      body.appendChild(quote);
    }

    const song = !ev.isRedacted() && content['klab.song'];
    if (song && song.id) {
      // A song shared from the player: a card you can play.
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'chat-msg-song';
      card.dataset.song = encodeURIComponent(JSON.stringify({ id: song.id, title: song.title, artist: song.artist, album: song.album, coverArt: song.coverArt }));
      card.innerHTML = (song.coverArt ? `<span class="chat-msg-song-art" style="background-image:url(&quot;${esc(coverUrl(song.coverArt, 100))}&quot;)"></span>` : '<span class="chat-msg-song-art"><i class="ti ti-music"></i></span>') +
        `<span class="chat-msg-song-tx"><b>${esc(song.title || 'Unknown')}</b><span>${esc(song.artist || '')}</span></span><span class="chat-msg-song-play"><i class="ti ti-player-play"></i></span>`;
      body.appendChild(card);
    } else if (!ev.isRedacted() && content.msgtype === 'm.image' && content.url) {
      ensureChatImageResolved(content.url);
      const img = document.createElement('img');
      img.className = 'chat-msg-image';
      img.dataset.mxc = content.url;
      img.alt = content.body || '';
      const cachedUrl = _chatImageCache.get(content.url);
      if (cachedUrl) img.src = cachedUrl;
      body.appendChild(img);
    } else {
      const text = document.createElement('div');
      if (ev.isRedacted()) {
        text.className = 'chat-msg-text deleted';
        text.textContent = 'message deleted';
      } else {
        text.className = 'chat-msg-text';
        text.innerHTML = linkifyHTML(content.body || '');
        if (ev.replacingEvent && ev.replacingEvent()) {
          const edited = document.createElement('span');
          edited.className = 'chat-msg-edited';
          edited.textContent = ' (edited)';
          text.appendChild(edited);
        }
      }
      body.appendChild(text);
    }

    const msgReactions = reactions.get(ev.getId());
    if (msgReactions && msgReactions.size) {
      const pills = document.createElement('div');
      pills.className = 'chat-msg-reactions';
      msgReactions.forEach((entry, emoji) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'chat-msg-reaction-pill' + (entry.mine ? ' mine' : '');
        pill.dataset.targetId = ev.getId();
        pill.dataset.emoji = emoji;
        // The key is whatever a remote client sent; it's text, never markup.
        pill.innerHTML = `${esc(emoji)} <span class="chat-msg-reaction-count">${entry.senders.size}</span>`;
        pills.appendChild(pill);
      });
      body.appendChild(pills);
    }

    row.append(avatar, body);
    el.appendChild(row);
  });

  updateSeenLine(room, events);

  // Compensates for any height change (a newly-arrived message added below
  // your view, grouping shifting slightly, etc.) instead of just
  // reassigning the old absolute scrollTop, which would drift if the
  // content above your viewport changed size at all.
  if (wasNearBottom) {
    el.scrollTop = el.scrollHeight;
    // Catches layout that settles a frame late — a font swap, an image or
    // avatar with no reserved size finishing its load, anything not fully
    // sized yet at the instant the line above ran. This file already
    // special-cased two specific culprits (document.fonts.ready and each
    // chat image's own load event) after they were reported one at a time;
    // re-asserting the same "you should be at the bottom" intent once more
    // after a real paint has happened, generically, is more robust than
    // finding every future culprit the same reactive way.
    requestAnimationFrame(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 4) el.scrollTop = el.scrollHeight;
    });
  } else {
    el.scrollTop = oldScrollTop + (el.scrollHeight - oldScrollHeight);
  }
}

// gitea#3 read receipts, upgraded from a DM-only "Seen" text line to
// readers' avatars, shown for group rooms too — a member cap keeps a large
// public-style room from turning this into per-member work (see
// SEEN_LINE_MEMBER_CAP), same spirit as OFFLINE_ROSTER_ROOM_MEMBER_CAP
// elsewhere in the app.
//
// Split out of renderTimeline() so a receipt arriving (which changes only
// this line, never the messages themselves) can update just this without
// wiping and rebuilding the whole message list — see the 'receipt'
// listener below and the comment on _lastSentReadEventId above for why
// that full rebuild was the actual cause of the chat flicker bug.
const SEEN_LINE_MEMBER_CAP = 30;
const SEEN_LINE_AVATAR_MAX = 5;
function updateSeenLine(room, events) {
  const el = document.getElementById('chatTimeline');
  if (!el || _chatActiveRoomId !== room.roomId) return;
  const existing = el.querySelector('.chat-msg-seen');
  const lastEvent = events[events.length - 1];
  let readers = [];
  if (lastEvent && lastEvent.getSender() === MatrixChat.client.getUserId()) {
    const members = room.getJoinedMembers().filter(m => m.userId !== MatrixChat.client.getUserId());
    if (members.length <= SEEN_LINE_MEMBER_CAP) {
      readers = members.filter(m => room.hasUserReadEvent(m.userId, lastEvent.getId()));
    }
  }
  if (!readers.length) {
    if (existing) existing.remove();
    return;
  }
  const seen = document.createElement('div');
  seen.className = 'chat-msg-seen';
  readers.slice(0, SEEN_LINE_AVATAR_MAX).forEach(member => {
    ensureMsgAvatarResolved(member.userId);
    const url = _msgAvatarCache.get(member.userId);
    const avatar = document.createElement('div');
    avatar.className = 'chat-msg-seen-avatar';
    avatar.dataset.seenAvatarFor = member.userId;
    avatar.title = member.name || member.userId;
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = (member.name || '?').trim().charAt(0).toUpperCase();
    }
    seen.appendChild(avatar);
  });
  if (readers.length > SEEN_LINE_AVATAR_MAX) {
    const more = document.createElement('span');
    more.className = 'chat-msg-seen-more';
    more.textContent = '+' + (readers.length - SEEN_LINE_AVATAR_MAX);
    seen.appendChild(more);
  }
  if (existing) existing.replaceWith(seen);
  else el.appendChild(seen);
}

// gitea#3: page in older history as the user scrolls up, rather than
// stopping dead at whatever initialSyncLimit loaded. One in-flight
// request per room (scrollback() itself also dedupes concurrent calls,
// but this skips even issuing a second one while scrolling generates a
// burst of scroll events). room.oldState.paginationToken === null is the
// SDK's own signal that there's no more history to page in.
let _paginatingRoomId = null;
async function maybeLoadOlderMessages() {
  const el = document.getElementById('chatTimeline');
  const room = _chatActiveRoomId && MatrixChat.client?.getRoom(_chatActiveRoomId);
  if (!el || !room || el.scrollTop > 60) return;
  if (_paginatingRoomId === room.roomId) return;
  if (room.oldState.paginationToken === null) return;
  _paginatingRoomId = room.roomId;
  const prevHeight = el.scrollHeight;
  try {
    await MatrixChat.client.scrollback(room, 30);
    _lastTimelineRenderKey = null; // force a rebuild — scrollback's events don't fire the 'timeline' emit (backfill is filtered out there)
    // renderTimeline() keeps the same messages on screen itself (scrolled
    // up, it restores oldScrollTop + the added height). Adding that height
    // here too threw you a page past where you were.
    renderTimeline();
  } catch (e) {
  } finally {
    _paginatingRoomId = null;
  }
}

// gitea#3 emoji request, scoped down to plain Unicode (no custom-emoji
// upload — that needs real storage/moderation and isn't a v1 fit). A
// curated common-emoji grid, not a full picker library.
const CHAT_EMOJIS = [
  '😀','😃','😄','😁','😆','😂','🤣','😅','😊','🙂','😉','😍','🥰','😘','😗','😎',
  '🤩','🤔','🤨','😐','😏','🙄','😬','😴','🤤','😪','😢','😭','😤','😠','😡','🤬',
  '😱','😨','😰','🥵','🥶','🤯','🥳','🤠','🤡','🤗','🫡','🫠','🤫','🤐','🥱','😷',
  '👍','👎','👏','🙏','🙌','💪','🤝','🫶','👀','👋','🤙','✌️','🤞','👌','🖕','👊',
  '🔥','✨','🎉','🎊','💯','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💀','☠️',
  '👻','🤖','🎃','⭐','🌟','💫','⚡','🌈','☕','🍕','🍔','🍺','🎵','🎮','🏆','💎',
];
const QUICK_REACTIONS = ['👍','❤️','😂','🔥'];
function initChatEmojiPicker() {
  const btn    = document.getElementById('chatEmojiBtn');
  const picker = document.getElementById('chatEmojiPicker');
  const input  = document.getElementById('chatComposerInput');
  if (!btn || !picker || !input || picker._bound) return;
  picker._bound = true;
  picker.innerHTML = CHAT_EMOJIS.map(e => `<button type="button">${e}</button>`).join('');
  picker.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    input.value += b.textContent;
    input.focus();
    notifyTyping();
    autoGrowChatComposer(); // setting .value directly doesn't fire 'input'
  });
  btn.addEventListener('click', e => {
    e.stopPropagation();
    picker.hidden = !picker.hidden;
  });
  document.addEventListener('click', e => {
    if (!picker.hidden && !picker.contains(e.target) && e.target !== btn) picker.hidden = true;
  });
}

// Keyed by roomId, not a single shared flag/timer — the deferred "stop
// typing" callback used to read the *live* _chatActiveRoomId instead of
// the room typing actually started in, so switching rooms mid-cycle could
// send a stray "stopped typing" into the new room, or (since the single
// shared _isTypingNow was already true from the old room) silently
// suppress the "started typing" signal there entirely.
const _typingStopTimers  = new Map(); // roomId -> timeout handle
const _typingActiveRooms = new Set(); // roomIds currently reporting "typing" to the server

// Called on every composer keystroke, but only actually sends on the
// false->true transition — the 4s refresh timer (re-armed each keystroke)
// is what keeps the room knowing we're still typing, not a fresh PUT per
// character.
function notifyTyping() {
  if (!_chatActiveRoomId || !MatrixChat.client) return;
  const roomId = _chatActiveRoomId;
  clearTimeout(_typingStopTimers.get(roomId));
  if (!_typingActiveRooms.has(roomId)) {
    _typingActiveRooms.add(roomId);
    MatrixChat.client.sendTyping(roomId, true, 4000).catch(() => {});
  }
  _typingStopTimers.set(roomId, setTimeout(() => {
    _typingActiveRooms.delete(roomId);
    MatrixChat.client?.sendTyping(roomId, false, 4000).catch(() => {});
  }, 4000));
}

let _pendingChatImage = null;
function clearChatImage() {
  _pendingChatImage = null;
  const wrap = document.getElementById('chatImagePreviewWrap');
  if (wrap) wrap.hidden = true;
  const input = document.getElementById('chatImageInput');
  if (input) input.value = '';
}

// Grows the composer with its content up to the CSS max-height, then lets
// it scroll. Shrink-to-zero first so deleting text un-grows it too; the
// single scrollHeight read after that is one forced reflow, not two.
function autoGrowChatComposer() {
  const el = document.getElementById('chatComposerInput');
  if (!el) return;
  el.style.height = 'auto';
  const sh = el.scrollHeight;
  el.style.height = Math.min(sh, 160) + 'px';
  el.style.overflowY = sh > 160 ? 'auto' : 'hidden';
}

async function sendChatMessage() {
  const input = document.getElementById('chatComposerInput');
  const text = input.value.trim();
  if ((!text && !_pendingChatImage) || !_chatActiveRoomId) return;
  const roomId = _chatActiveRoomId;
  const client = MatrixChat.client;
  input.value = '';
  autoGrowChatComposer(); // back to one line, or it keeps the sent message's height
  clearTimeout(_typingStopTimers.get(roomId));
  _typingActiveRooms.delete(roomId);
  client.sendTyping(roomId, false, 4000).catch(() => {});
  const replyRelation = _replyingToEventId ? { 'm.relates_to': { 'm.in_reply_to': { event_id: _replyingToEventId } } } : null;
  clearReply();

  const image = _pendingChatImage;
  clearChatImage();
  if (image) {
    try {
      const upload = await client.uploadContent(image);
      // The reply relation (if any) always rides on the image message —
      // it's sent first, and a caption (if any) goes out as its own
      // follow-up below. Previously this only attached when there was no
      // caption text, so replying with an image *and* a typed caption
      // silently dropped the reply context entirely (neither message got
      // the m.relates_to relation).
      await client.sendMessage(roomId, {
        msgtype: 'm.image', body: image.name, url: upload.content_uri,
        info: { mimetype: image.type, size: image.size },
        ...(replyRelation || {}),
      });
    } catch (e) {
      console.error('[chat] image send failed', e);
      showToast('Failed to send image', 'ti-photo-x');
    }
  }
  if (text) {
    const content = { msgtype: 'm.text', body: text };
    // Matrix messages have no separate "caption" field — an image with
    // typed text alongside it goes out as its own follow-up message
    // (same approach Element and other clients use for this).
    if (!image && replyRelation) Object.assign(content, replyRelation);
    client.sendMessage(roomId, content).catch(e => {
      console.error('[chat] send failed', e);
      // Hand the text back without clobbering anything typed since.
      input.value = input.value.trim() ? text + '\n' + input.value : text;
      showToast("Couldn't send that message; it's back in the box", 'ti-message-x');
    });
  }
}

const CHAT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
function initChatImageSend() {
  const btn        = document.getElementById('chatImageBtn');
  const input      = document.getElementById('chatImageInput');
  const wrap       = document.getElementById('chatImagePreviewWrap');
  const previewImg = document.getElementById('chatImagePreview');
  const removeBtn  = document.getElementById('chatImagePreviewRemove');
  const composer   = document.getElementById('chatComposerInput');
  if (!btn || !input || btn._bound) return;
  btn._bound = true;
  // Shared by the file-picker button and Ctrl/Cmd+V paste below — picking
  // a file was the ONLY way in before; pasting a screenshot straight from
  // the clipboard is the much more natural flow for "share this image" and
  // wasn't wired up at all.
  function attachChatImage(file) {
    if (!file) return;
    if (file.size > CHAT_MAX_IMAGE_BYTES) { showToast('Image too large (max 8MB)', 'ti-photo-off'); return; }
    _pendingChatImage = file;
    const reader = new FileReader();
    reader.onload = () => {
      previewImg.src = reader.result;
      wrap.hidden = false;
    };
    reader.readAsDataURL(file);
    composer?.focus();
  }
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    attachChatImage(file);
    input.value = '';
  });
  removeBtn?.addEventListener('click', clearChatImage);
  // Clipboard image paste — only intercepted when the clipboard actually
  // contains image data, so normal text paste into the composer (a link,
  // pasted message text, etc.) is completely unaffected.
  composer?.addEventListener('paste', e => {
    const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    attachChatImage(item.getAsFile());
  });
}

// ── Browse / Create / DM modal ───────────
// One shared backdrop+shell (see #chatModalBackdrop in the markup); each
// action rebuilds #chatModalBody for itself rather than three separate
// modal shells sitting mostly-duplicated in the DOM.
// ── Bug reports / feature requests ─────────────────────
// Files straight into Gitea via /api/feedback so nobody has to go find
// git.klab.gg to say a button is broken. The server owns the Gitea token
// and stamps the reporter's klabnet username onto the issue — the browser
// never sees a credential. The existing-issues list below is the "vice
// versa" half: it's the same tracker, so you can see your report land and
// check something isn't already filed before writing it up.
const FEEDBACK_TITLE_MAX = 120;
const FEEDBACK_BODY_MAX  = 4000;

function feedbackModalHTML() {
  return `
    <div class="chat-modal-row-sub" style="margin-bottom:10px;">
      Goes straight to the issue tracker, tagged with your username.
    </div>
    <div class="fb-type" id="fbType">
      <button type="button" class="fb-type-btn active" data-fb-type="bug"><i class="ti ti-bug"></i> Bug</button>
      <button type="button" class="fb-type-btn" data-fb-type="feature"><i class="ti ti-bulb"></i> Idea</button>
    </div>
    <input type="text" class="chat-modal-input" id="fbTitle" placeholder="Short summary" maxlength="${FEEDBACK_TITLE_MAX}" autocomplete="off" />
    <textarea class="chat-modal-input" id="fbBody" rows="5" placeholder="What happened, and what did you expect instead? Steps to reproduce help a lot." maxlength="${FEEDBACK_BODY_MAX}" style="resize:vertical;margin-top:6px;"></textarea>
    <button class="chat-connect-btn" id="fbSubmit" style="margin-top:10px;width:100%;justify-content:center;">Send</button>
    <div class="chat-modal-error" id="fbError" hidden></div>
    <div class="chat-modal-row-sub" style="margin-top:14px;">Already reported</div>
    <div class="chat-modal-list" id="fbList"><div class="picker-empty">loading…</div></div>
  `;
}

function openFeedbackModal() {
  openChatModal('// report a bug or idea', feedbackModalHTML());

  const typeWrap = document.getElementById('fbType');
  const titleEl  = document.getElementById('fbTitle');
  const bodyEl   = document.getElementById('fbBody');
  const submitEl = document.getElementById('fbSubmit');
  const errEl    = document.getElementById('fbError');
  const listEl   = document.getElementById('fbList');
  let kind = 'bug';

  typeWrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-fb-type]');
    if (!btn) return;
    kind = btn.dataset.fbType;
    typeWrap.querySelectorAll('.fb-type-btn').forEach(b => b.classList.toggle('active', b === btn));
  });

  async function loadIssues() {
    try {
      const r = await fetchTimeout('/api/feedback', {}, 8000);
      if (!r.ok) throw new Error('bad status');
      const data = await r.json();
      const issues = data.issues || [];
      if (!issues.length) { listEl.innerHTML = '<div class="picker-empty">Nothing reported yet.</div>'; return; }
      listEl.innerHTML = issues.map(i =>
        '<a class="chat-modal-row fb-row" href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="fb-state fb-state-' + (i.state === 'closed' ? 'closed' : 'open') + '">' +
            (i.state === 'closed' ? 'done' : 'open') + '</span>' +
          '<div class="chat-modal-row-info">' +
            '<div class="chat-modal-row-name">' + esc(i.title) + '</div>' +
            '<div class="chat-modal-row-sub">#' + i.number + (i.labels.length ? ' · ' + esc(i.labels.join(', ')) : '') + '</div>' +
          '</div>' +
        '</a>').join('');
    } catch (e) {
      listEl.innerHTML = '<div class="picker-empty">Couldn\'t load existing reports.</div>';
    }
  }
  loadIssues();

  submitEl.addEventListener('click', async () => {
    const title = titleEl.value.trim();
    if (!title) { errEl.textContent = 'Give it a short summary first.'; errEl.hidden = false; titleEl.focus(); return; }
    errEl.hidden = true;
    submitEl.disabled = true;
    submitEl.textContent = 'Sending…';
    try {
      const r = await fetchTimeout('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, title, body: bodyEl.value.trim(), page: location.hash || '#feed' }),
      }, 12000);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'failed');
      closeChatModal();
      showToast(data.number ? `Filed as #${data.number} — thanks!` : 'Report sent — thanks!', 'ti-bug');
    } catch (e) {
      errEl.textContent = e.message === 'issue tracker not configured'
        ? "The issue tracker isn't hooked up yet — tell an admin."
        : "Couldn't send that. Try again in a moment.";
      errEl.hidden = false;
      submitEl.disabled = false;
      submitEl.textContent = 'Send';
    }
  });

  titleEl.focus();
}

// onDismiss: called when the modal closes any way other than the caller's
// own buttons (X, Escape, the backdrop), so an awaited dialog always answers.
let _chatModalOnDismiss = null;
function openChatModal(title, bodyHTML, onDismiss) {
  const prev = _chatModalOnDismiss;
  _chatModalOnDismiss = onDismiss || null;
  if (prev) prev(); // a dialog replaced by another still gets its answer
  document.getElementById('chatModalTitle').textContent = title;
  document.getElementById('chatModalBody').innerHTML = bodyHTML;
  document.getElementById('chatModalBackdrop').classList.add('open');
}
function closeChatModal() {
  document.getElementById('chatModalBackdrop').classList.remove('open');
  const f = _chatModalOnDismiss;
  _chatModalOnDismiss = null;
  if (f) f();
}
trapFocusWithin(
  document.querySelector('#chatModalBackdrop .add-app-modal'),
  () => document.getElementById('chatModalBackdrop').classList.contains('open')
);
// Coming back to a tab left open on a room: now it's been read.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !document.querySelector('.tab-panel[data-tab-panel="chat"]')?.classList.contains('active')) return;
  if (typeof renderTimeline === 'function') renderTimeline();
});
// Bound at load, not when chat connects: the playlist and delete dialogs
// use this modal too, and before chat was connected their X (and a click
// outside) did nothing.
document.getElementById('chatModalClose')?.addEventListener('click', closeChatModal);
document.getElementById('chatModalBackdrop')?.addEventListener('click', e => {
  if (e.target.id === 'chatModalBackdrop') closeChatModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('chatModalBackdrop')?.classList.contains('open')) closeChatModal();
});

// ── In-site replacements for prompt()/confirm() — same shared modal shell
// as everything else above, so a text-entry or yes/no dialog looks like
// part of the app instead of a jarring native browser popup. Each returns
// a Promise so a call site just does `const name = await showInputDialog(...)`
// where it used to do `const name = prompt(...)`.
// Resolves with the raw (possibly empty) string on OK, or null on Cancel —
// deliberately NOT collapsing an empty OK to null, since some call sites
// (clearing a note) treat "OK with nothing typed" as a real, different
// action from "Cancel, leave it as it was". Callers that should reject a
// blank value (e.g. a playlist needs a name) check that themselves.
function showInputDialog(title, message, placeholder, defaultValue) {
  return new Promise(resolve => {
    openChatModal(title, `
      <div class="chat-modal-row-sub" style="margin-bottom:8px;">${esc(message || '')}</div>
      <input type="text" class="chat-modal-input" id="inputDialogField" placeholder="${esc(placeholder || '')}" autocomplete="off" />
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="ap-btn-queue" id="inputDialogCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="chat-connect-btn" id="inputDialogOk" style="flex:1;justify-content:center;margin-top:0;">OK</button>
      </div>
    `, () => resolve(null));
    const field = document.getElementById('inputDialogField');
    if (defaultValue) field.value = defaultValue;
    field.focus();
    field.select();
    const cleanup = result => { resolve(result); closeChatModal(); };
    document.getElementById('inputDialogCancel').addEventListener('click', () => cleanup(null));
    document.getElementById('inputDialogOk').addEventListener('click', () => cleanup(field.value.trim()));
    field.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('inputDialogOk').click(); });
  });
}
function showConfirmDialog(title, message, confirmLabel) {
  return new Promise(resolve => {
    openChatModal(title, `
      <div class="chat-modal-row-sub" style="margin-bottom:14px;">${esc(message || '')}</div>
      <div style="display:flex;gap:8px;">
        <button class="ap-btn-queue" id="confirmDialogCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="chat-connect-btn" id="confirmDialogOk" style="flex:1;justify-content:center;margin-top:0;color:var(--danger-color);border-color:var(--danger-color);">${esc(confirmLabel || 'Confirm')}</button>
      </div>
    `, () => resolve(false));
    const cleanup = result => { resolve(result); closeChatModal(); };
    document.getElementById('confirmDialogCancel').addEventListener('click', () => cleanup(false));
    document.getElementById('confirmDialogOk').addEventListener('click', () => cleanup(true));
  });
}
// Pick-one-from-a-list dialog (e.g. "add this song to which playlist?") —
// same .chat-modal-row pattern the channel-browse/DM modals already use.
function showChoiceDialog(title, items, emptyMessage) {
  return new Promise(resolve => {
    openChatModal(title, `<div class="chat-modal-list" id="choiceDialogList"></div>`, () => resolve(null));
    const listEl = document.getElementById('choiceDialogList');
    if (!items.length) {
      listEl.innerHTML = `<div class="picker-empty">${esc(emptyMessage || 'nothing to choose from')}</div>`;
    }
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'chat-modal-row';
      row.style.cursor = 'pointer';
      row.innerHTML =
        '<div class="chat-modal-row-info">' +
          `<div class="chat-modal-row-name">${esc(item.label)}</div>` +
          (item.sub ? `<div class="chat-modal-row-sub">${esc(item.sub)}</div>` : '') +
        '</div>';
      row.addEventListener('click', () => { resolve(i); closeChatModal(); });
      listEl.appendChild(row);
    });
  });
}

function openBrowseModal() {
  openChatModal('// browse channels', `
    <div class="chat-modal-search"><i class="ti ti-hash"></i><input type="text" id="chatJoinById" placeholder="or paste a room ID / #alias:server" autocomplete="off" /><button class="chat-modal-row-btn" id="chatJoinByIdBtn">Join</button></div>
    <div class="chat-modal-search" style="margin-top:6px;"><i class="ti ti-search"></i><input type="text" id="chatBrowseSearch" placeholder="search channels..." autocomplete="off" /></div>
    <div class="chat-modal-list" id="chatBrowseList"><div class="picker-empty">loading...</div></div>
  `);
  const listEl   = document.getElementById('chatBrowseList');
  const searchEl = document.getElementById('chatBrowseSearch');

  // A room can be self-joinable without being *published to the public
  // directory* — those are two separate settings — so a room might never
  // show up in the results below no matter how it's searched. This is the
  // escape hatch: join directly by room ID or #alias:server if you know it.
  const joinByIdInput = document.getElementById('chatJoinById');
  const joinByIdBtn   = document.getElementById('chatJoinByIdBtn');
  async function joinById() {
    const idOrAlias = joinByIdInput.value.trim();
    if (!idOrAlias) return;
    joinByIdBtn.disabled = true; joinByIdBtn.textContent = 'Joining…';
    try {
      await MatrixChat.client.joinRoom(idOrAlias);
      closeChatModal();
      renderChannelList();
      showToast(`Joined ${idOrAlias}`, 'ti-door-enter');
    } catch (e) {
      showToast(`Couldn't join: ${e.message || 'error'}`, 'ti-door-off');
    } finally {
      joinByIdBtn.disabled = false; joinByIdBtn.textContent = 'Join';
    }
  }
  joinByIdBtn.addEventListener('click', joinById);
  joinByIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinById(); });

  function renderResults(rooms) {
    const joined = new Set(MatrixChat.client.getRooms().map(r => r.roomId));
    listEl.innerHTML = '';
    if (!rooms.length) { listEl.innerHTML = '<div class="picker-empty">no channels found</div>'; return; }
    rooms.forEach(r => {
      const alreadyIn = joined.has(r.room_id);
      const row = document.createElement('div');
      row.className = 'chat-modal-row';
      const memberCount = r.num_joined_members || 0;
      row.innerHTML =
        '<div class="chat-modal-row-info">' +
          `<div class="chat-modal-row-name">${esc(r.name || r.canonical_alias || 'Unnamed room')}</div>` +
          `<div class="chat-modal-row-sub">${esc(r.topic ? r.topic + ' · ' : '')}${memberCount} member${memberCount === 1 ? '' : 's'}</div>` +
        '</div>' +
        `<button class="chat-modal-row-btn" ${alreadyIn ? 'disabled' : ''}>${alreadyIn ? 'Joined' : 'Join'}</button>`;
      if (!alreadyIn) {
        const btn = row.querySelector('button');
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.textContent = 'Joining…';
          try {
            await MatrixChat.client.joinRoom(r.room_id);
            btn.textContent = 'Joined';
            renderChannelList();
          } catch (e) {
            btn.disabled = false; btn.textContent = 'Join';
            showToast(`Couldn't join: ${e.message || 'error'}`, 'ti-door-off');
          }
        });
      }
      listEl.appendChild(row);
    });
  }

  async function load(term) {
    listEl.innerHTML = '<div class="picker-empty">loading...</div>';
    try {
      const res = await MatrixChat.client.publicRooms(term ? { limit: 50, filter: { generic_search_term: term } } : { limit: 50 });
      renderResults(res.chunk || []);
    } catch (e) {
      listEl.innerHTML = '<div class="picker-empty">failed to load channels</div>';
    }
  }

  let debounce;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => load(searchEl.value.trim()), 350);
  });
  load('');
}

function openCreateModal() {
  openChatModal('// create channel', `
    <input type="text" class="chat-modal-input" id="chatCreateName" placeholder="Channel name" autocomplete="off" />
    <input type="text" class="chat-modal-input" id="chatCreateTopic" placeholder="Topic (optional)" autocomplete="off" style="margin-top:8px;" />
    <button class="chat-connect-btn" id="chatCreateSubmit" style="margin-top:12px;width:100%;justify-content:center;">Create</button>
    <div class="chat-modal-error" id="chatCreateError" hidden></div>
  `);
  const nameEl  = document.getElementById('chatCreateName');
  const topicEl = document.getElementById('chatCreateTopic');
  const btn     = document.getElementById('chatCreateSubmit');
  const err     = document.getElementById('chatCreateError');
  nameEl.focus();

  btn.addEventListener('click', async () => {
    const name = nameEl.value.trim();
    if (!name) { err.textContent = 'Give it a name.'; err.hidden = false; return; }
    err.hidden = true;
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const { room_id } = await MatrixChat.client.createRoom({
        name,
        topic: topicEl.value.trim() || undefined,
        visibility: 'public',
        preset: 'public_chat',
      });
      closeChatModal();
      _chatActiveRoomId = room_id;
      renderChannelList();
      setChatMobileView('convo');
      showToast(`Created #${name}`, 'ti-hash');
    } catch (e) {
      err.textContent = e.message || 'Failed to create channel.';
      err.hidden = false;
      btn.disabled = false; btn.textContent = 'Create';
    }
  });
}

async function startDm(userId) {
  const client = MatrixChat.client;
  // client is assigned in bootClient() before the first sync actually
  // finishes — calling this in that narrow window would read an empty
  // m.direct/room list and wrongly conclude no DM with this person exists
  // yet, creating a duplicate room even if one's already there.
  if (!_chatSyncSettled) {
    showToast('Still connecting — try again in a moment', 'ti-loader-2');
    return;
  }
  try {
    // Reuse an existing DM with this person if one's already recorded in
    // m.direct, rather than spinning up a duplicate room every time.
    const directContent = client.getAccountData('m.direct')?.getContent() || {};
    // Only a room you're still in (or invited to) and they haven't left.
    // getRoom() keeps returning rooms after a leave, so a closed DM used to
    // be "reused" and then filtered straight back out of the list.
    const live = id => {
      const room = client.getRoom(id);
      if (!room) return false;
      const mine = room.getMyMembership?.();
      const theirs = room.getMember?.(userId)?.membership;
      return (mine === 'join' || mine === 'invite') && theirs !== 'leave' && theirs !== 'ban';
    };
    let roomId = (directContent[userId] || []).find(live);
    // An invite you haven't accepted yet: accept it by opening it.
    if (roomId && client.getRoom(roomId)?.getMyMembership?.() === 'invite') await client.joinRoom(roomId);
    if (!roomId) {
      const res = await client.createRoom({ is_direct: true, invite: [userId], preset: 'trusted_private_chat' });
      roomId = res.room_id;
      await client.setAccountData('m.direct', { ...directContent, [userId]: [...(directContent[userId] || []), roomId] });
    }
    closeChatModal();
    _chatActiveRoomId = roomId;
    renderChannelList();
    setChatMobileView('convo');
  } catch (e) {
    showToast(`Couldn't start DM: ${e.message || 'error'}`, 'ti-message-x');
  }
}

// Entry point for the presence-card context menu's "Message" action —
// resolves a klabnet username to its Matrix user ID (same localpart/
// server_name convention as the presence-avatar lookup) and jumps to the
// Chat tab to start or resume a DM with them.
function messageUser(username) {
  if (!MatrixChat.client) {
    showToast('Connect chat in the Chat tab first', 'ti-plug-connected-x');
    return;
  }
  const serverName = MatrixChat.client.getUserId().split(':')[1];
  // startDm() resolves/creates the room and sets _chatActiveRoomId itself
  // (async — may need to createRoom() first). setActiveTab('chat') must run
  // AFTER that, not before: it marks whatever room is currently active as
  // read, so calling it first here was marking the room the user was
  // previously on as read instead of the DM they're jumping to.
  // setChatMobileView AFTER setActiveTab — entering the Chat tab resets the
  // mobile pane to the list, and this jump wants the conversation.
  startDm(`@${username}:${serverName}`).then(() => {
    setActiveTab('chat');
    setChatMobileView('convo');
  });
}

// Pan/zoom cropper for the profile avatar (circle) and banner (wide strip)
// uploads below — without it, an arbitrary source photo just got blindly
// center-cropped into whatever shape the CSS forced it into, "botching"
// anything not already framed for that exact aspect ratio. Its own
// standalone overlay rather than the shared #chatModalBody shell (see
// openChatModal()'s own comment on why there's only one of those) since
// this needs to stack on top of the profile-edit modal that opened it.
// Resolves with a cropped JPEG Blob at the requested output size, or null
// if the user cancels.
function openImageCropper(file, { shape = 'rect', outputWidth = 480, outputHeight = 480 } = {}) {
  return new Promise(resolve => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'img-crop-backdrop';
      backdrop.innerHTML = `
        <div class="img-crop-dialog">
          <div class="img-crop-title">// crop image</div>
          <div class="img-crop-stage ${shape === 'circle' ? 'is-circle' : 'is-rect'}">
            <img class="img-crop-img" src="${objectUrl}" alt="" draggable="false" />
          </div>
          <input type="range" class="img-crop-zoom" min="0" max="100" value="0" />
          <div class="img-crop-actions">
            <button type="button" class="ap-btn-queue" id="imgCropCancel">Cancel</button>
            <button type="button" class="chat-connect-btn" id="imgCropUse">Use Photo</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const stage     = backdrop.querySelector('.img-crop-stage');
      const stageImg  = backdrop.querySelector('.img-crop-img');
      const zoomEl    = backdrop.querySelector('.img-crop-zoom');
      // Measured once on open — the stage's own size never changes after
      // that (only the image's pan/zoom does), so there's no need to
      // re-measure on every drag/zoom step.
      const stageRect = stage.getBoundingClientRect();
      const stageW = stageRect.width, stageH = stageRect.height;
      // The smallest scale where the image still fully covers the stage
      // in both dimensions — never let it shrink past that, or the crop
      // would include empty space beyond the photo's edges.
      const minScale = Math.max(stageW / img.naturalWidth, stageH / img.naturalHeight);
      const maxScale = minScale * 4;
      let scale = minScale;
      let tx = (stageW - img.naturalWidth * scale) / 2;
      let ty = (stageH - img.naturalHeight * scale) / 2;

      function clamp() {
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        tx = Math.min(0, Math.max(stageW - w, tx));
        ty = Math.min(0, Math.max(stageH - h, ty));
      }
      function apply() {
        clamp();
        stageImg.style.transformOrigin = '0 0';
        stageImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      }
      apply();

      zoomEl.addEventListener('input', () => {
        const oldScale = scale;
        scale = minScale + (Number(zoomEl.value) / 100) * (maxScale - minScale);
        // Anchor the zoom on the stage's visual center rather than the
        // image's top-left corner, so zooming in doesn't feel like it's
        // dragging the photo off to one side.
        const cx = stageW / 2, cy = stageH / 2;
        tx = cx - (cx - tx) * (scale / oldScale);
        ty = cy - (cy - ty) * (scale / oldScale);
        apply();
      });

      let dragging = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
      stage.addEventListener('pointerdown', e => {
        dragging = true; startX = e.clientX; startY = e.clientY; startTx = tx; startTy = ty;
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', e => {
        if (!dragging) return;
        tx = startTx + (e.clientX - startX);
        ty = startTy + (e.clientY - startY);
        apply();
      });
      stage.addEventListener('pointerup', () => { dragging = false; });
      stage.addEventListener('pointercancel', () => { dragging = false; });

      function cleanup(result) {
        backdrop.remove();
        document.removeEventListener('keydown', onEscape);
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      }
      function onEscape(e) { if (e.key === 'Escape') cleanup(null); }
      document.addEventListener('keydown', onEscape);
      backdrop.querySelector('#imgCropCancel').addEventListener('click', () => cleanup(null));
      backdrop.addEventListener('click', e => { if (e.target === backdrop) cleanup(null); });
      backdrop.querySelector('#imgCropUse').addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        // Maps the visible stage viewport back to natural image pixels:
        // at the current pan/zoom, stage-space (0,0)-(stageW,stageH)
        // corresponds to this source rect (a plain rectangle either way —
        // the circle shape only ever affects the CSS clipping, not this
        // underlying math).
        const sx = -tx / scale, sy = -ty / scale;
        const sw = stageW / scale, sh = stageH / scale;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
        canvas.toBlob(blob => cleanup(blob), 'image/jpeg', 0.92);
      });
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
    img.src = objectUrl;
  });
}

// ── Image viewer ─────────────────────────────────────────────────────
// Zoom/pan lightbox for feed and chat photos. Both surfaces only ever
// render a downscaled thumbnail (800px in the feed, 400px in chat), so
// `mxc` is taken separately and the original bytes are fetched in the
// background via mxcToBlobUrl's `full: true`; the thumbnail shows
// instantly and the full-res image swaps in underneath the current
// pan/zoom without moving anything the viewer is looking at.
//
// Pan/zoom follows openImageCropper()'s transform model (origin at 0 0,
// translate-then-scale, zoom anchored on a point so it doesn't drag the
// image sideways) — the difference is the anchor is the cursor/pinch
// midpoint rather than a fixed centre, and the image is allowed to be
// smaller than the stage (it centres instead of clamping to an edge).
let _imgViewerOpen = false;
function openImageViewer({ thumbSrc, mxc, alt = '' } = {}) {
  if (_imgViewerOpen || !thumbSrc) return;
  _imgViewerOpen = true;

  const backdrop = document.createElement('div');
  backdrop.className = 'img-view-backdrop';
  backdrop.innerHTML =
    '<div class="img-view-stage">' +
      '<img class="img-view-img" alt="' + esc(alt) + '" draggable="false" />' +
    '</div>' +
    '<div class="img-view-bar">' +
      '<button type="button" class="img-view-btn" data-act="zoomout" title="Zoom out" aria-label="Zoom out"><i class="ti ti-minus"></i></button>' +
      '<button type="button" class="img-view-btn" data-act="zoomin" title="Zoom in" aria-label="Zoom in"><i class="ti ti-plus"></i></button>' +
      '<button type="button" class="img-view-btn" data-act="open" title="Open original in a new tab" aria-label="Open original in a new tab"><i class="ti ti-external-link"></i></button>' +
      '<button type="button" class="img-view-btn" data-act="close" title="Close (Esc)" aria-label="Close"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div class="img-view-hint">scroll to zoom · drag to pan · double-click to reset</div>';
  document.body.appendChild(backdrop);

  const stage = backdrop.querySelector('.img-view-stage');
  const imgEl = backdrop.querySelector('.img-view-img');

  let vw = 0, vh = 0;          // stage viewport size
  let natW = 0, natH = 0;      // natural size of whatever is currently loaded
  let fitScale = 1, scale = 1; // fitScale = "whole image visible"
  let tx = 0, ty = 0;
  // Only URLs this viewer created get revoked on close — the thumbnail
  // belongs to _feedImageCache/_chatImageCache and is still in use by the
  // timeline behind us.
  let ownedUrl = null;
  const willFetchFull = !!(mxc && window.MatrixChat?.client);
  let haveFull = false;

  const maxScale = () => Math.max(fitScale * 8, 1);
  const clampScale = s => Math.min(maxScale(), Math.max(fitScale, s));

  function clamp() {
    const w = natW * scale, h = natH * scale;
    tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, tx));
    ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, ty));
  }
  function apply() {
    clamp();
    imgEl.style.transformOrigin = '0 0';
    imgEl.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
    stage.classList.toggle('is-zoomed', scale > fitScale * 1.001);
  }
  // Zoom about a point in stage coordinates, keeping whatever pixel is
  // under it pinned there.
  function zoomAt(nextScale, cx, cy) {
    const prev = scale;
    scale = clampScale(nextScale);
    if (scale === prev) return;
    tx = cx - (cx - tx) * (scale / prev);
    ty = cy - (cy - ty) * (scale / prev);
    apply();
  }
  // Image-space point (normalised 0..1) currently at the stage centre —
  // used to hold position across a relayout.
  function centreNorm() {
    if (!natW || !natH) return { x: 0.5, y: 0.5 };
    return { x: (vw / 2 - tx) / (natW * scale), y: (vh / 2 - ty) / (natH * scale) };
  }
  function relayout(preserve) {
    const rel = preserve && fitScale ? scale / fitScale : 1;
    const centre = preserve ? centreNorm() : { x: 0.5, y: 0.5 };
    const r = stage.getBoundingClientRect();
    vw = r.width; vh = r.height;
    natW = imgEl.naturalWidth || vw;
    natH = imgEl.naturalHeight || vh;
    fitScale = Math.min(vw / natW, vh / natH);
    // Never blow a small image up past 1:1 — but only once we're showing
    // the real thing. While the 400/800px thumbnail stands in for it, it
    // has to be laid out at full fit size (upscaled and soft) so the
    // swap to full-res doesn't visibly resize the photo under the cursor.
    if (haveFull || !willFetchFull) fitScale = Math.min(fitScale, 1);
    scale = clampScale(fitScale * rel);
    tx = vw / 2 - centre.x * natW * scale;
    ty = vh / 2 - centre.y * natH * scale;
    apply();
  }

  imgEl.addEventListener('load', () => relayout(natW > 0));
  imgEl.src = thumbSrc;

  // Swap in the original bytes once they arrive. Guarded on the viewer
  // still being open so a slow fetch can't resurrect a closed overlay or
  // leak the blob it just made.
  let closed = false;
  if (willFetchFull) {
    MatrixChat.mxcToBlobUrl(mxc, { full: true }).then(url => {
      if (!url) return;
      if (closed) { URL.revokeObjectURL(url); return; }
      ownedUrl = url;
      haveFull = true;
      imgEl.src = url;
    }).catch(() => {});
  }

  const onResize = () => relayout(true);
  window.addEventListener('resize', onResize);

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(scale * Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  stage.addEventListener('dblclick', e => {
    const r = stage.getBoundingClientRect();
    if (scale > fitScale * 1.001) relayout(false);
    else zoomAt(fitScale * 3, e.clientX - r.left, e.clientY - r.top);
  });

  // One pointer pans, two pinch-zoom. Tracking them in a Map keeps the
  // two gestures from fighting when a second finger lands mid-drag.
  const pts = new Map();
  let startTx = 0, startTy = 0, startX = 0, startY = 0;
  let pinchDist = 0, pinchScale = 1;
  let downOnImage = false;

  function pinchMid() {
    const [a, b] = [...pts.values()];
    const r = stage.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  }
  function pinchSpan() {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  stage.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Read the real target BEFORE capturing: once stage has pointer
    // capture the browser retargets the follow-up click to stage itself,
    // so the click handler can't tell the photo from the backdrop.
    if (pts.size === 1) downOnImage = e.target === imgEl;
    stage.setPointerCapture(e.pointerId);
    if (pts.size === 1) {
      startX = e.clientX; startY = e.clientY; startTx = tx; startTy = ty;
    } else if (pts.size === 2) {
      pinchDist = pinchSpan(); pinchScale = scale;
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {
      const span = pinchSpan();
      if (pinchDist > 0) {
        const mid = pinchMid();
        zoomAt(pinchScale * (span / pinchDist), mid.x, mid.y);
      }
      return;
    }
    tx = startTx + (e.clientX - startX);
    ty = startTy + (e.clientY - startY);
    apply();
  });
  function endPointer(e) {
    pts.delete(e.pointerId);
    if (pts.size === 1) {
      // Dropping from pinch back to one finger: re-seat the pan origin on
      // the finger that's left, or the image jumps by the old delta.
      const [p] = [...pts.values()];
      startX = p.x; startY = p.y; startTx = tx; startTy = ty;
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  function close() {
    if (closed) return;
    closed = true;
    _imgViewerOpen = false;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === '+' || e.key === '=') zoomAt(scale * 1.3, vw / 2, vh / 2);
    if (e.key === '-' || e.key === '_') zoomAt(scale / 1.3, vw / 2, vh / 2);
    if (e.key === '0') relayout(false);
  }
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') { close(); return; }
    if (act === 'zoomin')  { zoomAt(scale * 1.3, vw / 2, vh / 2); return; }
    if (act === 'zoomout') { zoomAt(scale / 1.3, vw / 2, vh / 2); return; }
    if (act === 'open') { window.open(ownedUrl || thumbSrc, '_blank', 'noopener'); return; }
    // A click that lands on the backdrop itself (not the image) closes —
    // but only if it wasn't the tail end of a drag.
    if (e.target === backdrop) close();
  });
  // Clicking the empty area around the photo closes; clicking the photo
  // itself never does. e.target is useless here (pointer capture retargets
  // the click to stage), so this goes on where the pointer actually went
  // down, and a click that travelled more than a few px was a drag.
  stage.addEventListener('click', e => {
    if (downOnImage) return;
    if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) close();
  });

  requestAnimationFrame(() => {
    backdrop.classList.add('open', 'show-hint');
    setTimeout(() => backdrop.classList.remove('show-hint'), 2600);
  });
}

// ── Edit your own profile (avatar + display name) from inside klabnet,
// instead of needing Element or another Matrix client — opened by
// clicking your own presence card. Uploads go straight to the
// homeserver via uploadContent()/setAvatarUrl(); both avatar caches
// (the presence rail's, keyed by username, and the chat timeline's,
// keyed by Matrix user ID) are invalidated afterward via
// window.KLAB_REFRESH_MY_AVATAR so the new photo shows up immediately
// everywhere without a reload.
// Blob URLs created by the banner/avatar previews below (both the stored-
// photo preview and the crop-picker preview) used to just leak — a fresh
// blob on every single modal open or photo pick, forever. Revoking
// whatever the *previous* open created, right before this one creates its
// own, caps it at one generation outstanding instead of one per click.
let _profileModalBlobUrls = [];
async function openProfileModal() {
  _profileModalBlobUrls.forEach(u => URL.revokeObjectURL(u));
  _profileModalBlobUrls = [];
  const client = MatrixChat.client;
  if (!client) { showToast('Connect chat in the Chat tab first', 'ti-plug-connected-x'); return; }
  const myId = client.getUserId();
  const myUsername = mxIdToUsername(myId);
  const myProfile = _profiles.get(myUsername) || { chat_color: '', bio: '', banner_mxc: '' };
  openChatModal('// edit profile', `
    <div class="profile-modal-banner-row">
      <div class="profile-modal-banner" id="profileBannerPreview">
        <div class="profile-modal-banner-overlay"><i class="ti ti-camera"></i> Banner</div>
      </div>
      <input type="file" accept="image/*" id="profileBannerFile" hidden />
    </div>
    <div class="profile-modal-avatar-row">
      <div class="profile-modal-avatar" id="profileAvatarPreview">
        <span id="profileAvatarInitial">${esc((myId.replace(/^@/, '')[0] || '?').toUpperCase())}</span>
        <div class="profile-modal-avatar-overlay"><i class="ti ti-camera"></i></div>
      </div>
      <input type="file" accept="image/*" id="profileAvatarFile" hidden />
    </div>
    <span class="profile-modal-label">Display name</span>
    <input type="text" class="chat-modal-input" id="profileNameInput" placeholder="Display name" autocomplete="off" />
    <span class="profile-modal-label" style="margin-top:10px;">Bio</span>
    <textarea class="chat-modal-input" id="profileBioInput" placeholder="A short bio…" maxlength="${PROFILE_BIO_MAX_CHARS}" rows="2" style="resize:vertical;"></textarea>
    <div class="profile-modal-bio-counter" id="profileBioCounter"></div>
    <span class="profile-modal-label" style="margin-top:10px;">Chat color</span>
    <div class="profile-modal-color-row" id="profileColorRow">
      <div class="profile-modal-color-swatch auto" data-color="" title="Auto"></div>
      ${CHAT_NAME_COLORS.map(c => `<div class="profile-modal-color-swatch" data-color="${c}" style="background:${c}" title="${c}"></div>`).join('')}
    </div>
    <button class="chat-connect-btn" id="profileSaveBtn" style="margin-top:12px;width:100%;justify-content:center;">Save</button>
    <div class="chat-modal-error" id="profileError" hidden></div>
  `);

  const bannerEl      = document.getElementById('profileBannerPreview');
  const bannerFileEl  = document.getElementById('profileBannerFile');
  const avatarEl      = document.getElementById('profileAvatarPreview');
  const initialEl     = document.getElementById('profileAvatarInitial');
  const fileEl        = document.getElementById('profileAvatarFile');
  const nameEl        = document.getElementById('profileNameInput');
  const bioEl         = document.getElementById('profileBioInput');
  const bioCounterEl  = document.getElementById('profileBioCounter');
  const colorRowEl    = document.getElementById('profileColorRow');
  const saveBtn       = document.getElementById('profileSaveBtn');
  const errEl         = document.getElementById('profileError');
  let pendingFile       = null;
  let pendingBannerFile = null;
  let selectedColor     = myProfile.chat_color || '';

  bioEl.value = myProfile.bio || '';
  const updateBioCounter = () => { bioCounterEl.textContent = `${bioEl.value.length}/${PROFILE_BIO_MAX_CHARS}`; };
  updateBioCounter();
  bioEl.addEventListener('input', updateBioCounter);

  const highlightColorSwatch = () => {
    colorRowEl.querySelectorAll('.profile-modal-color-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === selectedColor);
    });
  };
  highlightColorSwatch();
  colorRowEl.addEventListener('click', e => {
    const swatch = e.target.closest('.profile-modal-color-swatch');
    if (!swatch) return;
    selectedColor = swatch.dataset.color;
    highlightColorSwatch();
  });

  if (myProfile.banner_mxc) {
    MatrixChat.mxcToBlobUrl(myProfile.banner_mxc, { full: true })
      .then(url => { if (url) { _profileModalBlobUrls.push(url); bannerEl.style.backgroundImage = `url(${url})`; } })
      .catch(() => {});
  }
  bannerEl.addEventListener('click', () => bannerFileEl.click());
  bannerFileEl.addEventListener('change', async () => {
    const file = bannerFileEl.files?.[0];
    bannerFileEl.value = ''; // lets the same file be re-picked after a cancelled crop
    if (!file) return;
    const cropped = await openImageCropper(file, { shape: 'rect', outputWidth: 960, outputHeight: 270 });
    if (!cropped) return;
    pendingBannerFile = new File([cropped], 'banner.jpg', { type: 'image/jpeg' });
    const previewUrl = URL.createObjectURL(cropped);
    _profileModalBlobUrls.push(previewUrl);
    bannerEl.style.backgroundImage = `url(${previewUrl})`;
  });

  try {
    const info = await client.getProfileInfo(myId);
    nameEl.value = info?.displayname || '';
    if (info?.avatar_url) {
      const url = await MatrixChat.mxcToBlobUrl(info.avatar_url, { full: true });
      // Hide the fallback initial letter once a real photo loads — it's a
      // flex sibling of the <img>, not something the image covers, so
      // without this it stays visible right alongside the photo.
      if (url) { _profileModalBlobUrls.push(url); initialEl.style.display = 'none'; avatarEl.insertAdjacentHTML('afterbegin', `<img src="${esc(url)}" alt="" />`); }
    }
  } catch (e) { /* fall back to the initial-letter placeholder */ }

  avatarEl.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const file = fileEl.files?.[0];
    fileEl.value = ''; // lets the same file be re-picked after a cancelled crop
    if (!file) return;
    const cropped = await openImageCropper(file, { shape: 'circle', outputWidth: 480, outputHeight: 480 });
    if (!cropped) return;
    pendingFile = new File([cropped], 'avatar.jpg', { type: 'image/jpeg' });
    avatarEl.querySelectorAll('img').forEach(img => img.remove());
    initialEl.style.display = 'none';
    const previewUrl = URL.createObjectURL(cropped);
    _profileModalBlobUrls.push(previewUrl);
    avatarEl.insertAdjacentHTML('afterbegin', `<img src="${esc(previewUrl)}" alt="" />`);
  });

  saveBtn.addEventListener('click', async () => {
    errEl.hidden = true;
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      if (pendingFile) {
        const upload = await client.uploadContent(pendingFile);
        await client.setAvatarUrl(upload.content_uri);
      }
      const newName = nameEl.value.trim();
      if (newName) await client.setDisplayName(newName);

      let bannerMxc = myProfile.banner_mxc || '';
      if (pendingBannerFile) {
        const bannerUpload = await client.uploadContent(pendingBannerFile);
        bannerMxc = bannerUpload.content_uri;
      }
      const pr = await fetchTimeout('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_color: selectedColor, bio: bioEl.value.trim(), banner_mxc: bannerMxc }),
      }, 8000);
      if (!pr.ok) {
        const err = await pr.json().catch(() => null);
        // Falls into the same catch block below as an avatar/display-name
        // failure, rather than silently keeping the stale _profiles entry
        // while still telling the user "Profile updated".
        throw new Error(err?.error || 'Failed to save profile');
      }
      const saved = await pr.json();
      _profiles.set(myUsername, { chat_color: saved.chat_color, bio: saved.bio, banner_mxc: saved.banner_mxc });

      closeChatModal();
      showToast('Profile updated', 'ti-user-check');
      // Presence rail's cache is keyed by username, private to that
      // module's own IIFE — invalidated via the exposed hook. The chat
      // timeline's cache (keyed by Matrix user ID) is in this same
      // global scope, so it's cleared directly.
      window.KLAB_REFRESH_MY_AVATAR && window.KLAB_REFRESH_MY_AVATAR();
      if (pendingFile) _msgAvatarCache.delete(myId);
      // Chat color/bio/banner can change even when the avatar doesn't, so
      // these three surfaces (timeline, feed, presence-rail-via-the-hook
      // above) always get refreshed, not just on an avatar change.
      _lastTimelineRenderKey = null;
      renderTimeline();
      window.KLAB_REFRESH_FEED && window.KLAB_REFRESH_FEED();
    } catch (e) {
      errEl.textContent = e.message || 'Failed to update profile.';
      errEl.hidden = false;
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
    }
  });
}

// Read-only counterpart to openProfileModal() — a quick look at someone
// else's profile (banner, bio, chosen color, avatar) via the same shared
// modal shell, opened from a name/avatar click in chat/feed or the
// presence-card context menu's "View Profile" entry. Has its own
// avatar/displayname lookup rather than reusing any of the three
// per-module avatar caches (_msgAvatarCache/_feedAvatarCache/_avatarCache)
// — same one-off approach openProfileModal() already takes for "me".
// Same leak-capping pattern as _profileModalBlobUrls above — this popover
// had no cache at all, so clicking around profiles leaked a fresh blob URL
// on every single click, not just once per distinct person.
let _profileViewBlobUrls = [];
async function openProfileView(username) {
  _profileViewBlobUrls.forEach(u => URL.revokeObjectURL(u));
  _profileViewBlobUrls = [];
  if (!username) return;
  const client = MatrixChat.client;
  const profile = _profiles.get(username) || {};
  openChatModal(`// @${username}`, `
    <div class="profile-view-banner" id="profileViewBanner"></div>
    <div class="profile-view-avatar-row">
      <div class="profile-view-avatar" id="profileViewAvatar">${esc((username[0] || '?').toUpperCase())}</div>
      <div class="profile-view-names">
        <div class="profile-view-displayname" id="profileViewDisplayname">${esc(username)}</div>
        <div class="profile-view-username">@${esc(username)}</div>
      </div>
    </div>
    ${profile.bio ? `<div class="profile-view-bio">${esc(profile.bio)}</div>` : ''}
    <button class="chat-connect-btn" id="profileViewMessageBtn" style="margin-top:14px;width:100%;justify-content:center;"><i class="ti ti-message-2-plus"></i> Message</button>
  `);
  document.getElementById('profileViewMessageBtn')?.addEventListener('click', () => {
    closeChatModal();
    messageUser(username);
  });
  if (!client) return;
  if (profile.banner_mxc) {
    MatrixChat.mxcToBlobUrl(profile.banner_mxc, { full: true })
      .then(url => {
        const el = document.getElementById('profileViewBanner');
        if (url && el) { _profileViewBlobUrls.push(url); el.style.backgroundImage = `url(${url})`; }
      })
      .catch(() => {});
  }
  try {
    const serverName = client.getUserId().split(':')[1];
    const info = await client.getProfileInfo(`@${username}:${serverName}`);
    const nameEl = document.getElementById('profileViewDisplayname');
    if (nameEl && info?.displayname) nameEl.textContent = info.displayname;
    if (info?.avatar_url) {
      const url = await MatrixChat.mxcToBlobUrl(info.avatar_url, { full: true });
      const avatarEl = document.getElementById('profileViewAvatar');
      if (url && avatarEl) { _profileViewBlobUrls.push(url); avatarEl.innerHTML = `<img src="${esc(url)}" alt="" />`; }
    }
  } catch (e) { /* fall back to the initial-letter placeholder / klabnet username */ }
}

// Set once the first sync reaches PREPARED — see the guard below.
let _chatSyncSettled = false;

// ── Unread badge on the Social nav tab ───
// A room counts unread the same way notifyNewMessage() decides whether to
// toast for it: you weren't already looking at it (Chat tab active AND
// it's the selected room). Cleared the same way — renderTimeline() marks
// the active room read whenever it's actually being shown.
const _chatUnreadRooms = new Set();
// Base document.title, captured once before anything ever prefixes an
// unread count onto it — reused below rather than hardcoding the string
// a second time, so a future title change here doesn't need editing twice.
const _baseTitle = document.title;
// Patches the per-row unread dot/bold-name directly (buildChannelItem()
// tags each row with data-room-id for exactly this) instead of going
// through renderChannelList(). That used to be a full renderChannelList()
// call — which itself calls renderTimeline() — and since this function is
// called FROM markRoomRead(), which is itself called FROM renderTimeline(),
// that was a real reentrant cycle: outer renderTimeline() calls
// markRoomRead() before it's finished computing its own render-key/scroll
// bookkeeping, the nested renderChannelList()->renderTimeline() call could
// end up measuring/restoring scroll position against a DOM that was still
// mid-transition from a different room, and unwound back through multiple
// redundant full timeline rebuilds. A direct, targeted DOM patch here has
// no way to feed back into renderTimeline() at all, which removes the
// cycle rather than just hoping it converges cleanly.
function updateChannelUnreadDots() {
  document.querySelectorAll('#chatChannelsList .chat-channel-item[data-room-id], #chatDmList .chat-channel-item[data-room-id]').forEach(item => {
    const hasUnread = _chatUnreadRooms.has(item.dataset.roomId);
    item.classList.toggle('has-unread', hasUnread);
    const existingDot = item.querySelector('.chat-channel-unread-dot');
    if (hasUnread && !existingDot) {
      const dot = document.createElement('span');
      dot.className = 'chat-channel-unread-dot';
      dot.title = 'Unread messages';
      item.querySelector('.chat-channel-name')?.after(dot);
    } else if (!hasUnread && existingDot) {
      existingDot.remove();
    }
  });
}
// Usernames with an unread DM, for the presence rail's own dot. Rebuilt
// whenever the unread set changes rather than derived on demand, so the
// rail can stay a dumb renderer.
window.KLAB_UNREAD_DM_USERS = new Set();
function refreshUnreadDmUsers() {
  const set = new Set();
  const client = MatrixChat.client;
  if (client) {
    const dmIds = getDmRoomIds();
    for (const roomId of _chatUnreadRooms) {
      if (!dmIds.has(roomId)) continue;
      const room = client.getRoom(roomId);
      const who = room && dmOtherUsername(room);
      if (who) set.add(who);
    }
  }
  window.KLAB_UNREAD_DM_USERS = set;
  window.KLAB_REFRESH_PRESENCE_UNREAD?.();
}

function updateSocialUnreadBadge() {
  const badge = document.getElementById('socialUnreadBadge');
  if (badge) badge.textContent = _chatUnreadRooms.size ? `(${_chatUnreadRooms.size})` : '';
  // gitea#3: "visual blip to the browser tab" for an unread message —
  // a title prefix works everywhere (pinned tabs, alt-tab switchers)
  // unlike a favicon overlay, which a lot of browsers just clip/hide.
  document.title = _chatUnreadRooms.size ? `(${_chatUnreadRooms.size}) ${_baseTitle}` : _baseTitle;
  updateChannelUnreadDots();
  refreshUnreadDmUsers();
}
function markRoomRead(roomId) {
  if (_chatUnreadRooms.delete(roomId)) updateSocialUnreadBadge();
}

// Toast for an incoming message the user isn't already looking at —
// showToast() already plays the sitewide, user-customizable "notify" SFX
// (see SFX.play('notify') inside its own wrapper), so this gets sound
// support for free rather than needing its own notification primitive.
function mentionsMe(body) {
  const me = window.KLAB_USER?.username;
  return !!me && new RegExp('(^|[^\\w])@' + me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i').test(body || '');
}
function notifyNewMessage(event, room) {
  // The initial sync (up to 50 messages/room, per initialSyncLimit) replays
  // as live 'Room.timeline' events, same as anything genuinely new — without
  // this, every page reload re-notifies for everything you already read
  // last time. Only notify for events arriving after that first catch-up
  // has already settled into PREPARED.
  if (!_chatSyncSettled) return;
  if (event.getType() !== 'm.room.message') return;
  if (event.getRelation()?.rel_type === 'm.replace') return; // an edit, not a new message
  if (event.getSender() === MatrixChat.client.getUserId()) return; // our own message
  const onThisRoomAlready = document.querySelector('.tab-panel[data-tab-panel="chat"]')?.classList.contains('active')
    && room.roomId === _chatActiveRoomId;
  // Open on this room but in a background browser tab: you're not reading it.
  if (onThisRoomAlready && !document.hidden) return;
  _chatUnreadRooms.add(room.roomId);
  updateSocialUnreadBadge();
  const senderName = event.sender?.name || event.getSender();
  const body = event.getContent().body || '';
  const isDm = getDmRoomIds().has(room.roomId);
  // Same avatar cache/resolver the chat timeline uses (see
  // ensureMsgAvatarResolved above) — if this sender's avatar hasn't been
  // resolved yet (their first message this session), this toast falls
  // back to the plain icon and kicks off the resolve for next time,
  // rather than blocking the notification on a network round trip.
  const senderId = event.getSender();
  ensureMsgAvatarResolved(senderId);
  const avatarUrl = _msgAvatarCache.get(senderId);
  // Longer than TOAST_DEFAULT_MS — a chat notification carries more to
  // actually read (a name plus a message body) than the usual one-line
  // status toasts, and is more likely to arrive while you're looking
  // elsewhere on the page.
  const where = isDm ? '' : ` in ${room.name || 'a channel'}`;
  showToast({ title: `${senderName}${where}`, body: body.length > 90 ? body.slice(0, 90) + '…' : body },
    toastPerson(mxIdToUsername(senderId)), TOAST_DEFAULT_MS * 2, avatarUrl,
    () => openChatRoom(room.roomId),
    // Quick reply straight from the notification, threaded to the message.
    // The sound is the sender's own motif: low and warm for a DM, with a
    // sparkle when a channel message mentions you.
    { sound: isDm ? 'dm' : (mentionsMe(body) ? 'mention' : 'message'), from: mxIdToUsername(senderId),
      onReply: text => MatrixChat.client.sendMessage(room.roomId, {
        msgtype: 'm.text', body: text,
        'm.relates_to': { 'm.in_reply_to': { event_id: event.getId() } },
      }) });
}

// Jumps to the Chat tab with a specific room selected — the notification
// toast's click target, and equivalent to clicking that room in the
// channel sidebar (see the identical _chatActiveRoomId/renderChannelList()
// pairing in the channel-item click handler).
// ── Mobile chat: which of the two panes is on screen ──
// Only has an effect under the mobile breakpoint (the class it toggles is
// unused above it), so callers don't need to check the width themselves.
// The room name goes in the mobile bar because, once the sidebar is a
// separate screen, nothing else on the conversation names the room.
function setChatMobileView(view) {
  // A body class, not one on #chatApp: the "rooms" pane is the presence
  // rail (people + channels), which lives outside the chat app entirely
  // now, so the switch has to be visible to a selector that can reach both.
  // Only has an effect under the mobile breakpoint.
  document.body.classList.toggle('chat-rooms-view', view === 'rooms');
  if (view !== 'rooms') syncChatMobileTitle();
}
// ── The bar over the conversation: who or what you're in ──
function coverUrl(id, size) { return id ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}` : ''; }
let _chatBdI = 0, _chatBdKey = '';
function setChatBackdrop(img, tint) {
  const layers = document.getElementById('chatBackdrop')?.children;
  const key = img || tint || '';
  if (!layers || key === _chatBdKey) return;
  _chatBdKey = key;
  _chatBdI ^= 1;
  layers[_chatBdI].style.backgroundImage = img ? `url("${img}")` : (tint ? `radial-gradient(circle at 55% 40%, ${tint}, transparent 62%)` : 'none');
  window.klabSoften?.(layers[_chatBdI]);
  layers[_chatBdI].classList.add('on');
  layers[_chatBdI ^ 1].classList.remove('on');
}
let _chatHeadHTML = '';
function syncChatHead() {
  const head = document.getElementById('chatHead');
  const client = MatrixChat.client;
  if (!head || !client) return;
  const room = _chatActiveRoomId && client.getRoom(_chatActiveRoomId);
  const back = '<button type="button" class="chat-icon-btn chat-head-back" data-chat-back title="Back"><i class="ti ti-chevron-left"></i></button>';
  let html = '', img = null, tint = null;
  if (!room) html = '';
  else if (getDmRoomIds().has(room.roomId)) {
    const other = dmOtherUsername(room) || room.name || '';
    const p = window.klabPresenceOf ? window.klabPresenceOf(other) : {};
    const face = p.avatar || window.klabResolveUserAvatar?.(other);
    const color = profileColor(other);
    let sub;
    if (p.song) {
      sub = '<span class="chat-head-eq"><i></i><i></i><i></i></span>' +
        (p.songId ? `<span class="chat-head-art" style="background-image:url(&quot;${esc(coverUrl(p.songId, 60))}&quot;)"></span>` : '') +
        `<span>${esc(p.song)}${p.artist ? ' · ' + esc(p.artist) : ''}</span>`;
      img = p.songId ? coverUrl(p.songId, 400) : null;
    } else {
      sub = `<span>${p.online ? 'online' : 'offline'}</span>` + (p.note ? `<span class="chat-head-note">“${esc(p.note)}”</span>` : '');
    }
    if (p.song && p.note) sub += `<span class="chat-head-note">“${esc(p.note)}”</span>`;
    tint = color;
    html = back +
      `<span class="chat-head-face" style="--c:${color}">${face ? `<img src="${esc(face)}" alt="" />` : esc((other[0] || '?').toUpperCase())}${p.online ? '<span class="chat-channel-online-dot"></span>' : ''}</span>` +
      `<div class="chat-head-who"><h2 style="color:${color}">${esc(room.name || other)}</h2><div class="chat-head-sub">${sub}</div></div>` +
      (p.song ? `<button type="button" class="chat-head-btn" data-listen="${esc(other)}"><i class="ti ti-headphones"></i>Listen along</button>` : '') +
      `<button type="button" class="chat-icon-btn" data-profile="${esc(other)}" title="Profile"><i class="ti ti-user-circle"></i></button>`;
  } else {
    let topic = '';
    try { topic = room.currentState?.getStateEvents('m.room.topic', '')?.getContent()?.topic || ''; } catch (e) {}
    const members = (room.getJoinedMembers?.() || []).map(m => mxIdToUsername(m.userId));
    const here = members.filter(u => window.KLAB_ONLINE_USERNAMES?.has(u)).length;
    const faces = members.slice(0, 5).map(u => `<span class="chat-head-mini" style="--c:${profileColor(u)}" title="${esc(u)}">${esc((u[0] || '?').toUpperCase())}</span>`).join('');
    html = back + '<span class="chat-head-hash">#</span>' +
      `<div class="chat-head-who"><h2>${esc(room.name || 'channel')}</h2><div class="chat-head-sub"><span>${esc(topic || members.length + ' members')}</span></div></div>` +
      `<div class="chat-head-stack">${faces}<span>${here} here</span></div>`;
    // The channel takes on the last song someone shared in it.
    const evs = room.getLiveTimeline().getEvents();
    for (let i = evs.length - 1; i >= 0; i--) {
      const song = evs[i].getContent?.()?.['klab.song'];
      if (song && song.coverArt) { img = coverUrl(song.coverArt, 400); break; }
    }
    if (!img) tint = 'rgba(var(--accent-rgb),0.9)';
  }
  if (html !== _chatHeadHTML) { _chatHeadHTML = html; head.innerHTML = html; }
  setChatBackdrop(img, tint);
  const input = document.getElementById('chatComposerInput');
  if (input && room) {
    const isDm = getDmRoomIds().has(room.roomId);
    input.placeholder = 'Message ' + (isDm ? '' : '#') + (room.name || '');
  }
}
document.getElementById('chatHead')?.addEventListener('click', e => {
  if (e.target.closest('[data-chat-back]')) { setChatMobileView('rooms'); return; }
  const listen = e.target.closest('[data-listen]');
  if (listen) { window.klabListenAlong?.(listen.dataset.listen); return; }
  const prof = e.target.closest('[data-profile]');
  if (prof && typeof openProfileView === 'function') openProfileView(prof.dataset.profile);
});
// Presence moves (someone starts a song, goes offline, writes a note).
window.klabChatPresenceChanged = () => { if (MatrixChat.client) syncChatHead(); };

function syncChatMobileTitle() {
  const el = document.getElementById('chatMobileTitle');
  if (!el) return;
  const room = _chatActiveRoomId && MatrixChat.client?.getRoom(_chatActiveRoomId);
  el.textContent = room?.name || 'Chat';
}

function openChatRoom(roomId) {
  // _chatActiveRoomId must be updated BEFORE setActiveTab('chat') runs —
  // that call marks whatever room is currently active as read (see its own
  // comment), so calling it first here was marking the room the user was
  // previously on as read instead of the one they're jumping to.
  _chatActiveRoomId = roomId;
  setActiveTab('chat');
  renderChannelList();
  // Jumping to a specific room (a mention, "message user", a notification)
  // means the conversation, not the list you'd normally land on.
  setChatMobileView('convo');
}


let _chatBound = false;

// Onboarding fix: brand-new users had no channels at all until they found
// and used the "Browse public channels" flow themselves — most never did,
// so their first impression of Chat was an empty room list. #klabnet is
// public (join_rule: public, confirmed against the actual room state) and
// meant to be the one channel everyone's in by default, so auto-join it
// once per session right when the client's actually ready. joinRoom on an
// alias you're already a member of is a harmless no-op (200, same as a
// fresh join) — no need to pre-check membership first.
const KLABNET_ROOM_ALIAS = '#klabnet:klab.gg';
let _klabnetJoinAttempted = false;
async function ensureJoinedToKlabnet() {
  if (_klabnetJoinAttempted || !MatrixChat.client) return;
  _klabnetJoinAttempted = true;
  try {
    await MatrixChat.client.joinRoom(KLABNET_ROOM_ALIAS);
    renderChannelList();
  } catch (e) {
    _klabnetJoinAttempted = false; // let a later PREPARED retry (e.g. after a reconnect) try again
    console.warn('[chat] auto-join #klabnet failed', e);
  }
}

function showChatApp() {
  document.getElementById('chatConnect').hidden = true;
  document.getElementById('chatApp').hidden = false;
  const dot  = document.getElementById('chatStatusDot');
  const text = document.getElementById('chatStatusText');
  // showChatApp() can run more than once (MatrixChat.login() is idempotent,
  // but a "Connect" click after already connecting still calls this again)
  // — only bind listeners once or they'd stack and fire N times each.
  if (!_chatBound) {
    _chatBound = true;
    MatrixChat.on('sync', state => {
      const live = state === 'PREPARED' || state === 'SYNCING';
      dot.classList.toggle('live', live);
      text.textContent = live ? 'connected' : state.toLowerCase();
      // "Connected" isn't worth a permanent bar — only surface this while
      // something's actually worth knowing about (connecting/reconnecting/
      // error), same as the status dot's own live/not-live distinction.
      document.getElementById('chatAppHeader')?.classList.toggle('visible', !live);
      // The initial sync's own Room.timeline events (the catch-up replay
      // notifyNewMessage() guards against) always arrive before this fires,
      // so it's safe to flip the gate open right here.
      if (state === 'PREPARED') { _chatSyncSettled = true; ensureJoinedToKlabnet(); }
      renderChannelList();
    });
    MatrixChat.on('memberProfileChanged', userId => invalidateMsgAvatar(userId));
    MatrixChat.on('timeline', (event, room) => {
      renderChannelList(); // cascades to renderTimeline() too
      notifyNewMessage(event, room);
    });
    MatrixChat.on('typing', member => {
      if (member.roomId !== _chatActiveRoomId || member.userId === MatrixChat.client.getUserId()) return;
      if (member.typing) _typingUsers.set(member.userId, member.name);
      else _typingUsers.delete(member.userId);
      renderTypingLine();
    });
    // gitea#3 read receipts — a receipt update doesn't change the events
    // renderTimeline()'s renderKey hashes (it's the same messages, just a
    // new "read up to" marker), so it needs its own repaint path. That
    // used to be "force a full renderTimeline() rebuild", but a receipt
    // updating the Seen line would make renderTimeline() send ITS OWN read
    // receipt too (unconditionally, back then) — which the other client's
    // identical code echoed straight back, forever, each bounce clearing
    // and rebuilding the entire message list on both ends. That's what
    // was seen as chat messages flickering in and out. updateSeenLine()
    // only ever touches the one "Seen" div, never the messages or the
    // read-receipt-sending path, so there's nothing left to bounce.
    MatrixChat.on('receipt', (event, room) => {
      if (room.roomId !== _chatActiveRoomId) return;
      const events = room.getLiveTimeline().getEvents().filter(ev =>
        ev.getType() === 'm.room.message' && ev.getRelation()?.rel_type !== 'm.replace');
      // updateSeenLine() inserts/replaces a real, height-bearing element
      // (the readers' avatar row) at the very bottom of the timeline —
      // unlike the renderTimeline() call site below it (which re-pins
      // scroll right after, accounting for whatever height that add just
      // introduced), this standalone path never did. Someone reading your
      // last message a moment after you'd scrolled to the bottom yourself
      // would silently push the true bottom down by that row's height,
      // leaving you looking not-quite-scrolled-down with no visible cause —
      // part of the reported "have to keep scrolling down" bug. Same
      // "re-pin only if you were already there" guard as the image-load fix.
      const el = document.getElementById('chatTimeline');
      const wasNearBottom = el && (el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      updateSeenLine(room, events);
      if (wasNearBottom) el.scrollTop = el.scrollHeight;
    });
    document.getElementById('chatComposerInput')?.addEventListener('keydown', e => {
      // Shift+Enter (and IME composition, which fires Enter to accept a
      // candidate) must not send.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    document.getElementById('chatComposerInput')?.addEventListener('input', () => {
      notifyTyping();
      autoGrowChatComposer();
    });
    document.getElementById('chatTimeline')?.addEventListener('scroll', maybeLoadOlderMessages);
    initChatEmojiPicker();
    initChatImageSend();
    document.getElementById('chatReplyPreview')?.addEventListener('click', e => {
      if (e.target.closest('.chat-reply-preview-close')) clearReply();
    });
    document.getElementById('chatTimeline')?.addEventListener('click', e => {
      const reactBtn = e.target.closest('.chat-msg-action-btn[data-action="react"]');
      if (reactBtn) {
        toggleReaction(reactBtn.closest('.chat-msg')?.dataset.eventId, reactBtn.dataset.emoji);
        return;
      }
      const replyBtn = e.target.closest('.chat-msg-action-btn[data-action="reply"]');
      if (replyBtn) {
        startReply(replyBtn.closest('.chat-msg')?.dataset.eventId);
        return;
      }
      const pill = e.target.closest('.chat-msg-reaction-pill');
      if (pill) {
        toggleReaction(pill.dataset.targetId, pill.dataset.emoji);
        return;
      }
      // Checked before the reply-quote block below (it'd otherwise catch
      // this click too, since the sender name sits inside that quote for a
      // reply's parent) — a name click should open their profile, not
      // scroll to the quoted message.
      const senderName = e.target.closest('.chat-msg-sender, .chat-msg-reply-quote-name');
      if (senderName?.dataset.username) { openProfileView(senderName.dataset.username); return; }
      const avatar = e.target.closest('.chat-msg-avatar[data-msg-avatar-for]');
      if (avatar) { openProfileView(mxIdToUsername(avatar.dataset.msgAvatarFor)); return; }
      const quote = e.target.closest('.chat-msg-reply-quote');
      if (quote?.dataset.parentId) {
        document.querySelector(`.chat-msg[data-event-id="${CSS.escape(quote.dataset.parentId)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const img = e.target.closest('.chat-msg-image');
      if (img && img.src?.startsWith('blob:')) {
        openImageViewer({ thumbSrc: img.src, mxc: img.dataset.mxc, alt: img.alt });
        return;
      }
      // Touch has no hover, so the react/reply toolbar (.chat-msg-actions,
      // hover-revealed on desktop) is unreachable without this: tapping a
      // message reveals its own toolbar and hides any other. Gated on the
      // device actually being hover-less so a mouse keeps the hover
      // behaviour and doesn't leave toolbars stuck open behind the cursor.
      if (window.matchMedia?.('(hover: none)').matches) {
        const row = e.target.closest('.chat-msg');
        if (row && !e.target.closest('.chat-msg-actions')) {
          const wasOpen = row.classList.contains('show-actions');
          document.querySelectorAll('.chat-msg.show-actions').forEach(m => m.classList.remove('show-actions'));
          if (!wasOpen) row.classList.add('show-actions');
        }
      }
    });
    document.getElementById('chatMobileBack')?.addEventListener('click', () => setChatMobileView('rooms'));
    document.getElementById('chatBrowseBtn')?.addEventListener('click', openBrowseModal);
    document.getElementById('chatCreateBtn')?.addEventListener('click', openCreateModal);
  }
  renderChannelList();
}

async function connectChat() {
  const btn = document.getElementById('chatConnectBtn');
  const err = document.getElementById('chatConnectError');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    await MatrixChat.login();
    showChatApp();
  } catch (e) {
    console.error('[chat] connect failed', e);
    err.textContent = e.message || 'Connection failed — try again.';
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

function ensureChatLoaded() {
  if (_chatUiLoaded) return;
  _chatUiLoaded = true;
  document.getElementById('chatConnectBtn')?.addEventListener('click', connectChat);
  if (MatrixChat.client) { showChatApp(); window.KLAB_BOOT?.mark('matrix'); return; }
  if (MatrixChat.hasSession()) {
    // Returning session — boot silently in the background, no popup and
    // no button click required, so a returning user just sees chat ready.
    // The boot overlay waits on this specifically because it's the same
    // reconnect race that used to make feed images/avatars silently never
    // show up until something else happened to trigger a re-render.
    MatrixChat.login().then(showChatApp).catch(e => console.warn('[chat] silent reconnect failed', e)).finally(() => window.KLAB_BOOT?.mark('matrix'));
    return;
  }
  // First time ever connecting — login() needs a real SSO popup (see
  // ssoPopupLogin() above), and every browser blocks window.open() unless
  // it happens synchronously inside a genuine user gesture. Rather than
  // require everyone to find the Chat tab and click Connect by hand,
  // piggyback on the page's very first click/keypress: Authentik already
  // has a live session for anyone on this page at all, so — same as the
  // manual Connect button — the popup should resolve with no visible
  // interaction. Only wired once; if it fails (popup genuinely blocked,
  // SSO error) the manual Connect button bound above is still there as a
  // fallback, same as before this existed.
  const autoConnectOnFirstGesture = () => {
    document.removeEventListener('pointerdown', autoConnectOnFirstGesture, true);
    document.removeEventListener('keydown', autoConnectOnFirstGesture, true);
    if (MatrixChat.client) return;
    MatrixChat.login().then(showChatApp).catch(e => console.warn('[chat] auto-connect failed', e));
  };
  document.addEventListener('pointerdown', autoConnectOnFirstGesture, true);
  document.addEventListener('keydown', autoConnectOnFirstGesture, true);
  // No existing session means Matrix won't even attempt to connect until
  // that first gesture (window.open() needs one) — nothing for the boot
  // overlay to wait on here, or it'd sit stuck until someone clicks.
  window.KLAB_BOOT?.mark('matrix');
}



// ── Composer extras: a send button, and one tap to share what's playing ──
async function shareNowPlaying() {
  const s = playerState.currentSong, client = MatrixChat.client;
  if (!s || !client || !_chatActiveRoomId) return;
  const song = { id: s.id, title: s.title || '', artist: s.artist || '', album: s.album || '', coverArt: s.coverArt || '' };
  try {
    await client.sendMessage(_chatActiveRoomId, { msgtype: 'm.text', body: `🎵 ${song.title}${song.artist ? ' — ' + song.artist : ''}`, 'klab.song': song });
    SFX && SFX.play('star');
  } catch (e) { showToast("Couldn't share that song", 'ti-music-x'); }
}
function syncShareChip() {
  const btn = document.getElementById('chatShareNp');
  const s = playerState.currentSong;
  if (!btn) return;
  btn.hidden = !s;
  if (!s) return;
  document.getElementById('chatShareNpTitle').textContent = s.title || '';
  document.getElementById('chatShareNpArt').style.backgroundImage = s.coverArt ? `url("${coverUrl(s.coverArt, 60)}")` : '';
}
document.getElementById('chatSendBtn')?.addEventListener('click', () => sendChatMessage());
document.getElementById('chatShareNp')?.addEventListener('click', shareNowPlaying);
['play', 'loadedmetadata'].forEach(ev => playerState.audio.addEventListener(ev, syncShareChip));
syncShareChip();
document.getElementById('chatTimeline')?.addEventListener('click', e => {
  const say = e.target.closest('[data-say]');
  if (say) {
    const input = document.getElementById('chatComposerInput');
    input.value = say.dataset.say; sendChatMessage(); return;
  }
  if (e.target.closest('[data-share-np]')) { shareNowPlaying(); return; }
  const card = e.target.closest('.chat-msg-song');
  if (card) { try { playSong(JSON.parse(decodeURIComponent(card.dataset.song))); } catch (err) {} }
});
