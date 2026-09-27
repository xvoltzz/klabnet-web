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
    adoptIdentity(await res.json());
  } catch(e) {

  }
}
function adoptIdentity(data) {
    window.KLAB_USER = data;
    const badge = document.getElementById('userBadge');
    if (badge && data.username && data.username !== 'anonymous') {
      badge.textContent = data.username;
      badge.style.opacity = '1';
      if (data.is_admin) badge.title = data.username + ' (admin)';
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
let _sessionCheckBusy = false, _sessionCheckedAt = 0;
async function checkSession() {
  if (_sessionCheckBusy || document.hidden) return;
  // Focus and visibility both fire on return; once is plenty.
  if (Date.now() - _sessionCheckedAt < 5000) return;
  _sessionCheckedAt = Date.now();
  _sessionCheckBusy = true;
  try {
    const res = await fetchTimeout('/api/me', {}, 8000);
    if (res.status === 401 || res.status === 403) { location.reload(); return; }
    if (!res.ok) return; // transient failure — don't punish a bad connection
    const data = await res.json();
    // Started while /api/me was unreachable: this is who we are, not a
    // different person. Picked up in place (a reload would stop the music).
    if (window.KLAB_USER?.username === 'anonymous' && data.username && data.username !== 'anonymous') {
      adoptIdentity(data);
      loadServerPrefs();
      return;
    }
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

// ── Sync, field by field ──
// The server keeps one blob, but each field syncs on its own: this device
// remembers (in localStorage, so it survives a reload or a closed tab) the
// value of every field as of its last sync. A field that differs from that
// was changed here and hasn't reached the server yet, so a pull never
// overwrites it; an upload merges onto the server's current copy, so fields
// changed on another device in the meantime are left as they are there.
// (Uploading everything used to let an old tab put back yesterday's
// favorites, and every song played made it think it had changes.)
const PREF_BASE_KEY = 'klabnet_prefs_base';
const PREF_STRINGS  = new Set(['theme', 'bg_dark', 'bg_light']);
const PREF_DEFAULTS = { login_song: null, favorites: [], play_history: [], theme: 'dark', playlists: [], bg_dark: '', bg_light: '' };
const PREF_NAMES    = Object.keys(PREF_KEYS);

function localPref(name) {
  const raw = localStorage.getItem(PREF_KEYS[name]);
  if (PREF_STRINGS.has(name)) return raw || PREF_DEFAULTS[name];
  try { const v = JSON.parse(raw); return v == null ? PREF_DEFAULTS[name] : v; } catch (e) { return PREF_DEFAULTS[name]; }
}
function writeLocalPref(name, val) {
  if (val == null) { localStorage.removeItem(PREF_KEYS[name]); return; }
  localStorage.setItem(PREF_KEYS[name], PREF_STRINGS.has(name) ? String(val) : JSON.stringify(val));
}
function readPrefBase() { try { return JSON.parse(localStorage.getItem(PREF_BASE_KEY)) || {}; } catch (e) { return {}; } }
function savePrefBase(base) { try { localStorage.setItem(PREF_BASE_KEY, JSON.stringify(base)); } catch (e) {} }
const encPref = v => JSON.stringify(v ?? null);
// Changed here since the last sync. Never synced: only if it's been set.
function prefChangedHere(name, base) {
  const now = encPref(localPref(name));
  return base[name] === undefined ? now !== encPref(PREF_DEFAULTS[name]) : now !== base[name];
}
function afterPrefsWritten() {
  // These writes went straight to localStorage, behind the memoized
  // getFavorites()/getLoginSong() readers' backs.
  if (typeof invalidateFavCache === 'function') invalidateFavCache();
  if (typeof invalidateLoginSongCache === 'function') invalidateLoginSongCache();
  if (typeof updateFavBadge === 'function') updateFavBadge();
  if (typeof applyCustomBg === 'function') applyCustomBg();
}

async function fetchServerPrefs() {
  const res = await fetchTimeout('/api/prefs', { cache: 'no-store' }, 8000);
  if (!res.ok) throw new Error('prefs ' + res.status);
  const prefs = await res.json();
  return prefs && typeof prefs === 'object' ? prefs : {};
}

async function loadServerPrefs() {
  let prefs;
  try { prefs = await fetchServerPrefs(); } catch (e) { return; }
  const base = readPrefBase();
  let pending = false, wrote = false;
  for (const name of PREF_NAMES) {
    if (prefChangedHere(name, base)) {
      // Keep it: an edit made here that hasn't been uploaded yet.
      if (base[name] !== undefined || !(name in prefs)) { pending = true; continue; }
    }
    if (!(name in prefs)) continue; // the server has never had this one
    // Present-but-empty ([] / '' / null) is a real value, "you cleared it",
    // not "nothing to sync": skipping those used to resurrect deletions.
    if (encPref(localPref(name)) !== encPref(prefs[name] ?? PREF_DEFAULTS[name])) { writeLocalPref(name, prefs[name]); wrote = true; }
    base[name] = encPref(localPref(name));
  }
  savePrefBase(base);
  if (wrote) afterPrefsWritten();
  if (pending) scheduleSave();
}

let _prefsSaving = null;
async function saveServerPrefs() {
  if (window.KLAB_USER.username === 'anonymous') return; // kept; uploaded once we know who you are
  if (_prefsSaving) return _prefsSaving;
  _prefsSaving = (async () => {
    const base = readPrefBase();
    const mine = PREF_NAMES.filter(n => prefChangedHere(n, base));
    if (!mine.length) return;
    try {
      // Onto the server's copy as it is now, not as this tab last saw it.
      const server = await fetchServerPrefs();
      const merged = { ...server };
      const sent = {};
      for (const n of PREF_NAMES) {
        merged[n] = mine.includes(n) ? localPref(n) : (n in server ? server[n] : localPref(n));
        sent[n] = encPref(merged[n]);
      }
      const body = JSON.stringify(merged);
      // keepalive lets a save started as the tab closes finish, but browsers
      // refuse (throw) one over 64KB, so a big library saves without it.
      const res = await fetchTimeout('/api/prefs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000,
      }, 8000);
      if (!res.ok) return; // still marked changed; tried again next time
      // Other devices' changes that came along with the merge, unless this
      // field was edited again while the save was in flight.
      let wrote = false;
      for (const n of PREF_NAMES) {
        if (!mine.includes(n) && encPref(localPref(n)) === (base[n] ?? encPref(localPref(n))) && encPref(localPref(n)) !== sent[n]) {
          writeLocalPref(n, merged[n]); wrote = true;
        }
        base[n] = sent[n];
      }
      savePrefBase(base);
      if (wrote) afterPrefsWritten();
    } catch (e) {
      // Offline or the server's down: the changes stay marked and go up
      // with the next save, or at the next start.
    }
  })().finally(() => { _prefsSaving = null; });
  return _prefsSaving;
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
// Clearing it is a change too (it never used to reach other devices).
const _origClearLoginSong = typeof clearLoginSong !== 'undefined' ? clearLoginSong : null;
if (_origClearLoginSong) {
  clearLoginSong = function() { _origClearLoginSong(); scheduleSave(); };
}

const _origAddFav = typeof addFavorite !== 'undefined' ? addFavorite : null;
if (_origAddFav) {
  addFavorite = function(s) { _origAddFav(s); scheduleSave(); };
}

const _origRemFav = typeof removeFavorite !== 'undefined' ? removeFavorite : null;
if (_origRemFav) {
  removeFavorite = function(id) { _origRemFav(id); scheduleSave(); };
}

// Upload on hide (tab switched, app minimized, phone locked); pull what
// changed elsewhere on return, if we were away long enough for it to matter.
let _prefsHiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { _prefsHiddenAt = Date.now(); saveServerPrefs(); return; }
  if (Date.now() - _prefsHiddenAt > 30000) loadServerPrefs();
});
// Another klabnet tab on this device changed one: this tab's memoized
// copies are stale, and writing them back would undo that change.
window.addEventListener('storage', e => {
  if (!e.key || !Object.values(PREF_KEYS).includes(e.key)) return;
  afterPrefsWritten();
});

// ── Boot sequence ──
// Order matters: fetch identity → load server prefs → re-apply layout
(async function boot() {
  await fetchMe();           // who am I? (also applies admin state)
  // Not answered: try again shortly rather than spend minutes anonymous
  // (no saving, invisible to everyone).
  for (const wait of [3000, 10000]) {
    if (window.KLAB_USER.username !== 'anonymous') break;
    await new Promise(r => setTimeout(r, wait));
    await fetchMe();
  }
  await loadServerPrefs();   // pull their prefs from server into localStorage

  // Re-apply theme with server values
  const savedTheme = localStorage.getItem(PREF_KEYS.theme);
  if (savedTheme) applyTheme(savedTheme);
})();

// ══════════════════════════════════════════
//  ADMIN IDENTITY
// ══════════════════════════════════════════
// The Apps tab (hardcoded service tiles, their status dots and
// maintenance flags) and the custom-app builder before it are both gone.
// window.KLAB_USER.is_admin stays: it's generic identity info, and every
// real admin check (feed/reply delete, music request approve/delete)
// reads it straight off window.KLAB_USER.

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
    if (match && match[1] !== KLABNET_VERSION) showUpdateBanner(match[1]);
  } catch (e) {}
}

// Dismissal is remembered against the version it was dismissed FOR, not as
// a plain boolean — otherwise closing it once would suppress every future
// release too. The next deploy has a different version string, so the
// notice comes back exactly once per release.
const UPDATE_DISMISSED_KEY = 'klabnet_update_dismissed';
function updateDismissedFor(version) {
  try { return localStorage.getItem(UPDATE_DISMISSED_KEY) === version; } catch (e) { return false; }
}
function dismissUpdateFor(version) {
  try { localStorage.setItem(UPDATE_DISMISSED_KEY, version); } catch (e) {}
}

function showUpdateBanner(newVersion) {
  if (document.getElementById('updateBanner')) return;
  if (newVersion && updateDismissedFor(newVersion)) return;
  // Lives in the header's toast stack (top right) rather than pinned to
  // the bottom centre, where it sat directly over the player dock and got
  // in the way of anyone listening to music.
  const host = document.getElementById('toastFlyout') || document.body;
  const el = document.createElement('div');
  el.id = 'updateBanner';
  el.className = 'update-banner';
  el.innerHTML =
    '<i class="ti ti-sparkles"></i>' +
    '<span>A new version is available.</span>' +
    '<button type="button" id="updateBannerReload">Reload</button>' +
    '<button type="button" class="update-banner-close" id="updateBannerClose" title="Dismiss" aria-label="Dismiss"><i class="ti ti-x"></i></button>';
  host.appendChild(el);
  document.getElementById('updateBannerReload').addEventListener('click', () => location.reload());
  document.getElementById('updateBannerClose').addEventListener('click', () => {
    if (newVersion) dismissUpdateFor(newVersion);
    el.remove();
  });
}
setInterval(checkForUpdate, UPDATE_CHECK_MS);
// On return too, but not for every alt-tab: at most once a minute.
let _updateCheckedAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden || Date.now() - _updateCheckedAt < 60000) return;
  _updateCheckedAt = Date.now();
  checkForUpdate();
});

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
  desktopNotif:  false,   // per device; turning it on asks the browser
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

// ── Desktop notifications ──
// For when klabnet is open but you're not looking at it: another tab,
// another window, minimized. If you're looking, the in-page toast is
// enough. (With the site fully closed it would take Web Push and a push
// server; this covers the tab left open, which is how klabnet gets used.)
const _notifClicks = new Map();   // tag -> click handler, for the service-worker path
function klabDesktopNotify({ title, body, icon, tag, onClick }) {
  if (!_settings.desktopNotif || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  const opts = {
    body: body || '',
    // Blob avatars don't survive into the OS; klabnet's mark does.
    icon: /^https?:/.test(icon || '') ? icon : new URL('klab.png', location.href).href,
    tag, renotify: !!tag,
    // klabnet plays its own sound for these, so the OS one would double it.
    silent: !!(_settings.sfxEnabled && _settings.notifSound),
  };
  // window.focus() can't raise the desktop app's window from the tray.
  const click = () => { window.klabnetDesktop?.focus(); window.focus(); onClick?.(); };
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { n.close(); click(); };
  } catch (e) {
    // Android only allows notifications from the service worker.
    navigator.serviceWorker?.ready.then(reg => {
      if (tag) _notifClicks.set(tag, click);
      reg.showNotification(title, { ...opts, data: { tag } });
    }).catch(() => {});
  }
}
window.klabDesktopNotify = klabDesktopNotify;
navigator.serviceWorker?.addEventListener('message', e => {
  const tag = e.data?.klabNotifClick;
  if (tag && _notifClicks.has(tag)) { _notifClicks.get(tag)(); _notifClicks.delete(tag); }
});

function applySettings() {
  // SFX volume — patch the SFX compressor
  if (typeof SFX !== 'undefined') SFX.setVolume(_settings.sfxEnabled ? (_settings.sfxVolume ?? 0.7) : 0);

  // Social is a permanent feature now (no longer gated behind Experimental
  // Features) — its section/tab are unconditionally visible in the markup,
  // so this just needs to kick off the actual chat connection. Safe to
  // call on every applySettings() run: ensureChatLoaded() no-ops itself
  // after the first call.
  if (typeof ensureChatLoaded === 'function') ensureChatLoaded();
}

