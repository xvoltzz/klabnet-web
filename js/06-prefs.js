// ══════════════════════════════════════════
//  SERVER PREFS — identity + persistent preferences
// ══════════════════════════════════════════
window.KLAB_USER = { username: 'anonymous', groups: [], is_admin: false };
let _prefsSaveTimer = null;

// All keys we sync between localStorage and server
const PREF_KEYS = {
  login_song:    'klabnet_login_song',
  favorites:     'klabnet_favorites',
  play_history:  'klabnet_play_history',
  theme:         'klabnet_theme',
  playlists:     'klabnet_playlists',
  bg_dark:       'klabnet_bg_dark',
  bg_light:      'klabnet_bg_light',
};

async function fetchMe() {
  try {
    const res  = await fetchTimeout('/api/me', {}, 8000);
    if (!res.ok) return;
    const data = await res.json();
    window.KLAB_USER = data;
    const badge = document.getElementById('userBadge');
    if (badge && data.username && data.username !== 'anonymous') {
      badge.textContent = data.username;
      badge.style.opacity = '1';
      if (data.is_admin) badge.title = data.username + ' (admin)';
    }
  } catch(e) {

  }
}

// ── Session watch ──────────────────────────────────────────
// A killed or swapped Authentik session should end this tab's access
// right away, not just on the next manual reload. Re-check /api/me
// periodically and whenever the tab regains focus; reload if our identity
// no longer matches or the endpoint starts rejecting us outright.
//
// This is the frontend half only. It can't make revocation instant on its
// own — that requires whatever sits in front of /api/* (the auth proxy /
// Authentik forward-auth) to actually re-validate the session on every
// request instead of trusting a long-lived cookie. Without that, a killed
// Authentik session may still satisfy our own cookie until it expires;
// this watch just makes sure the SPA notices and reacts as fast as
// possible once the backend does reflect the change, and catches the
// "signed in as someone else in another tab" case immediately either way.
const SESSION_CHECK_MS = 90000;
let _sessionCheckBusy = false;
async function checkSession() {
  if (_sessionCheckBusy || document.hidden) return;
  _sessionCheckBusy = true;
  try {
    const res = await fetchTimeout('/api/me', {}, 8000);
    if (res.status === 401 || res.status === 403) { location.reload(); return; }
    if (!res.ok) return; // transient failure — don't punish a bad connection
    const data = await res.json();
    if (window.KLAB_USER && data.username !== window.KLAB_USER.username) {
      location.reload();
    }
  } catch(e) {
    // network error/timeout — ignore, retry next interval
  } finally {
    _sessionCheckBusy = false;
  }
}
setInterval(checkSession, SESSION_CHECK_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
window.addEventListener('focus', checkSession);

// Per-group tile visibility (applyGroupVisibility) was removed along with
// the custom-app-builder feature — see the git history for this file if
// reviving it. The shape it used: a static tile opts in via
// data-group="group-a,group-b" in the HTML, or (for a per-user override) a
// { tileId: [groups] } map; window.KLAB_USER.groups (from /api/me) is the
// signed-in user's Authentik groups, and window.KLAB_USER.is_admin always
// bypasses the check.

async function loadServerPrefs() {
  try {
    const res = await fetchTimeout('/api/prefs', {}, 8000);
    if (!res.ok) return;
    const prefs = await res.json();
    if (!prefs || !Object.keys(prefs).length) return; // no prefs saved yet

    // Write server values into localStorage
    // (all existing code reads from localStorage — no changes needed elsewhere)
    //
    // Deliberately writes an empty array/object too, not just non-empty
    // ones — this used to skip '[]'/'{}', which meant deleting your only
    // playlist (or clearing favorites, etc.) on one device never synced to
    // any other device: the empty array was treated as "nothing to sync"
    // instead of "synced to nothing", so every other device kept its stale
    // copy forever, and the next time THAT device auto-saved anything, it
    // pushed the stale (un-deleted) list straight back to the server,
    // silently reviving what you'd deleted. The outer `prefs` guard above
    // already covers the real "nothing saved yet" case — once we know a
    // real prefs blob exists, an individual field being empty is a
    // meaningful value (you cleared it), not a missing one.
    const setIfPresent = (lsKey, val) => {
      if (val === undefined || val === null) return;
      // A present-but-empty string ('' — e.g. bg_dark/bg_light reset back to
      // "theme default") is a meaningful, real value once we know a real
      // prefs blob exists (same reasoning as the empty-array/object case
      // below) — only genuinely absent (undefined/null, checked above)
      // means "nothing to sync".
      if (typeof val === 'string') {
        localStorage.setItem(lsKey, val);
      } else {
        localStorage.setItem(lsKey, JSON.stringify(val));
      }
    };

    setIfPresent(PREF_KEYS.login_song,    prefs.login_song);
    setIfPresent(PREF_KEYS.favorites,     prefs.favorites);
    setIfPresent(PREF_KEYS.play_history,  prefs.play_history);
    setIfPresent(PREF_KEYS.theme,         prefs.theme);
    setIfPresent(PREF_KEYS.playlists,     prefs.playlists);
    setIfPresent(PREF_KEYS.bg_dark,       prefs.bg_dark);
    setIfPresent(PREF_KEYS.bg_light,      prefs.bg_light);
    // These writes go straight to localStorage, behind the memoized
    // getFavorites()/getLoginSong() readers' backs.
    if (typeof invalidateFavCache === 'function') invalidateFavCache();
    if (typeof invalidateLoginSongCache === 'function') invalidateLoginSongCache();
    if (typeof applyCustomBg === 'function') applyCustomBg(); // server prefs may have just changed the active theme's color

  } catch(e) {

  }
}

async function saveServerPrefs() {
  if (window.KLAB_USER.username === 'anonymous') return; // don't save for anon
  const parse = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch(e) { return fallback; }
  };
  const prefs = {
    login_song:    parse(PREF_KEYS.login_song,    null),
    favorites:     parse(PREF_KEYS.favorites,     []),
    play_history:  parse(PREF_KEYS.play_history,  []),
    theme:         localStorage.getItem(PREF_KEYS.theme) || 'dark',
    playlists:     parse(PREF_KEYS.playlists,     []),
    bg_dark:       localStorage.getItem(PREF_KEYS.bg_dark)  || '',
    bg_light:      localStorage.getItem(PREF_KEYS.bg_light) || '',
  };
  try {
    await fetchTimeout('/api/prefs', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(prefs),
    }, 8000);
  } catch(e) {
    // Server not reachable — localStorage already saved, no data loss
  }
}

// Debounced save — fires 1.5s after last change
function scheduleSave() {
  clearTimeout(_prefsSaveTimer);
  _prefsSaveTimer = setTimeout(saveServerPrefs, 1500);
}

// Hook theme, login song, favorites changes
const _origApplyTheme = applyTheme;
applyTheme = function(t) { _origApplyTheme(t); scheduleSave(); };

const _origSetLoginSong2 = typeof setLoginSong !== 'undefined' ? setLoginSong : null;
if (_origSetLoginSong2) {
  setLoginSong = function(s) { _origSetLoginSong2(s); scheduleSave(); };
}

const _origAddFav = typeof addFavorite !== 'undefined' ? addFavorite : null;
if (_origAddFav) {
  addFavorite = function(s) { _origAddFav(s); scheduleSave(); };
}

const _origRemFav = typeof removeFavorite !== 'undefined' ? removeFavorite : null;
if (_origRemFav) {
  removeFavorite = function(id) { _origRemFav(id); scheduleSave(); };
}

// Save on page hide (tab close, navigate away)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveServerPrefs();
});

// ── Boot sequence ──
// Order matters: fetch identity → load server prefs → re-apply layout
(async function boot() {
  await fetchMe();           // who am I? (also applies admin state)
  await loadServerPrefs();   // pull their prefs from server into localStorage

  // Re-apply theme with server values
  const savedTheme = localStorage.getItem(PREF_KEYS.theme);
  if (savedTheme) applyTheme(savedTheme);
})();

// ══════════════════════════════════════════
//  APP MANAGEMENT
// ══════════════════════════════════════════
// The custom-app builder (add/edit/delete tile via /api/apps, icon
// picker, group-restriction picker) was removed — app tiles are now
// hardcoded in #appGrid's HTML only. window.KLAB_USER.is_admin is kept
// around since it's generic identity info, not part of that feature
// specifically — every real is_admin check (feed/reply delete, music
// request approve/delete) reads it straight off window.KLAB_USER, not
// off a CSS class. A body.admin-user toggle + a fetchMe() monkey-patch
// used to exist solely to set that class, but nothing ever selected on
// it — removed as dead weight along with this comment's own "still
// toggles body.admin-user below" claim, which was no longer true of
// anything downstream of it.

// The old "TILE EDIT SYSTEM" (admin, edit mode) lived here: a shared
// modal for both creating/editing custom app tiles (POST/PUT /api/apps)
// and restricting a static tile to specific groups (persisted as
// tile_groups in prefs, applied via applyGroupVisibility — see the note
// near "Per-group tile visibility" above). Removed with the rest of the
// custom-app-builder feature; tiles are hardcoded in #appGrid now.

// ══════════════════════════════════════════
//  VERSION + LIVE UPDATE CHECK
//  The changelog UI that used to live here was dropped again — the
//  Gitea repo link in the header covers the same "what changed" need
//  without a second, hand-maintained UI to keep in sync. KLABNET_VERSION
//  itself stays: the live update-check banner below needs a version
//  string embedded in the page to compare against.
//
//  The constant now lives inline in index.html rather than here, because
//  checkForUpdate() below re-fetches *index.html* and greps it out. Once
//  the code moved into these separate files, a version bump in a .js file
//  would never have changed index.html and the banner could never fire.
// ══════════════════════════════════════════

// ── Live update check ────────────────────
// This is a long-lived SPA with no build step or version endpoint to poll
// — so "is there a new deploy" is answered by just re-fetching this same
// HTML file (no-store, so an intermediate cache can't serve a stale copy)
// and reading the KLABNET_VERSION string back out of it. Shows a
// persistent banner rather than auto-reloading, so nobody mid-message
// loses what they were typing.
// Was every 90s with no visibility guard — re-downloading the whole ~600KB
// page that often, including in a backgrounded tab nobody's looking at,
// was the single largest unconditional network cost in the app. 5 minutes
// plus skipping entirely while hidden cuts that by >95%; the existing
// visibilitychange listener below still re-checks immediately the moment
// a hidden tab becomes visible again, so detection latency in practice
// barely changes.
const UPDATE_CHECK_MS = 5 * 60 * 1000;
async function checkForUpdate() {
  if (document.hidden) return;
  try {
    const res = await fetchTimeout(location.pathname || '/', { cache: 'no-store' }, 8000);
    const html = await res.text();
    const match = /KLABNET_VERSION\s*=\s*'([^']+)'/.exec(html);
    if (match && match[1] !== KLABNET_VERSION) showUpdateBanner();
  } catch (e) {}
}
function showUpdateBanner() {
  if (document.getElementById('updateBanner')) return;
  const el = document.createElement('div');
  el.id = 'updateBanner';
  el.className = 'update-banner';
  el.innerHTML = '<i class="ti ti-sparkles"></i><span>A new version is available.</span><button id="updateBannerReload">Reload</button>';
  document.body.appendChild(el);
  document.getElementById('updateBannerReload').addEventListener('click', () => location.reload());
}
setInterval(checkForUpdate, UPDATE_CHECK_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

// ── PWA service worker ───────────────────
// Registered only for the installable/static-asset benefit — sw.js never
// caches the HTML document, precisely so the update check above keeps
// seeing the real deployed KLABNET_VERSION. See sw.js's header comment.
// Secure-context only (service workers are unavailable over plain http,
// which is how this is served on the LAN by IP), and skipped entirely in
// the SSO popup, which closes itself before the app ever renders.
if ('serviceWorker' in navigator && window.isSecureContext && !location.search.includes('matrixSsoCallback')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ══════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════
const SETTINGS_KEY = 'klabnet_settings';
let _settings = {
  sfxEnabled:    true,
  sfxVolume:     0.7,
  notifSound:    true,
  loginSong:     true,
  experimentalEnabled: false,
  showKlabcraft: true,
  showLeaderboard: true,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    _settings = { ..._settings, ...saved };
  } catch(e) {}
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings));
}

function applySettings() {
  // SFX volume — patch the SFX compressor
  if (typeof SFX !== 'undefined') SFX.setVolume(_settings.sfxEnabled ? (_settings.sfxVolume ?? 0.7) : 0);

  // Experimental features — master gate + per-feature sections
  const experimentalOptions = document.getElementById('experimentalOptions');
  if (experimentalOptions) experimentalOptions.hidden = !_settings.experimentalEnabled;

  const showSec = (selector, visible) => {
    const sec = document.querySelector(selector);
    if (!sec) return;
    sec.hidden = !visible;
    if (visible) sec.classList.add('in-view');
  };
  const klabcraftVisible = _settings.experimentalEnabled && _settings.showKlabcraft;
  showSec('.sec[data-sec="klabcraft"]', klabcraftVisible);
  // Leaderboard isn't a tab — just a header icon button that opens it as a
  // modal (see openLeaderboardModal()) — so it only needs its own hidden
  // state toggled, no .sec/tab-panel visibility to manage.
  const leaderboardBtn = document.getElementById('leaderboardBtn');
  if (leaderboardBtn) leaderboardBtn.hidden = !(_settings.experimentalEnabled && _settings.showLeaderboard);

  // Tab nav follows the same gate — a disabled section's tab disappears too.
  const setTabBtnVisible = (key, visible) => {
    const btn = document.querySelector(`.tab-nav-btn[data-tab-target="${key}"]`);
    if (btn) btn.hidden = !visible;
  };
  setTabBtnVisible('klabcraft', klabcraftVisible);
  if (typeof refreshActiveTabAvailability === 'function') refreshActiveTabAvailability();

  // Social is a permanent feature now (no longer gated behind Experimental
  // Features) — its section/tab are unconditionally visible in the markup,
  // so this just needs to kick off the actual chat connection. Safe to
  // call on every applySettings() run: ensureChatLoaded() no-ops itself
  // after the first call.
  if (typeof ensureChatLoaded === 'function') ensureChatLoaded();
}

