// ══════════════════════════════════════════
//  FAVORITES SYSTEM
// ══════════════════════════════════════════
const FAV_KEY = 'klabnet_favorites';
// Cached parse + an id Set. renderSongItem() calls isFavorite() once per
// row, and that used to mean a localStorage read, a JSON.parse of up to 200
// favourites and a linear scan — per row, for every row of a 100-song page.
// invalidateFavCache() must be called by anything that writes FAV_KEY,
// which is this file's add/remove plus loadServerPrefs()'s bulk restore.
let _favCache = null;
let _favIdSet = null;
function invalidateFavCache() { _favCache = null; _favIdSet = null; }
function getFavorites() {
  if (_favCache) return _favCache;
  try { _favCache = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch(e) { _favCache = []; }
  if (!Array.isArray(_favCache)) _favCache = [];
  _favIdSet = new Set(_favCache.map(s => s && s.id));
  return _favCache;
}
function isFavorite(id) { getFavorites(); return _favIdSet.has(id); }
function addFavorite(song) {
  const favs = getFavorites();
  if (!isFavorite(song.id)) { favs.unshift(song); localStorage.setItem(FAV_KEY, JSON.stringify(favs.slice(0,200))); }
  invalidateFavCache();
  updateFavBadge();
}
function removeFavorite(id) {
  const favs = getFavorites().filter(s => s.id !== id);
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  invalidateFavCache();
  updateFavBadge();
}
function updateFavBadge() {
  const el = document.getElementById('favCount');
  const n = getFavorites().length;
  if (el) el.textContent = n ? '(' + n + ')' : '';
}
updateFavBadge();

// ══════════════════════════════════════════
//  PLAY HISTORY
// ══════════════════════════════════════════
const HISTORY_KEY = 'klabnet_play_history';
function getPlayHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch(e) { return []; }
}
function addToPlayHistory(song) {
  if (!song) return;
  let hist = getPlayHistory().filter(s => s.id !== song.id); // dedupe
  hist.unshift(song);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 50)));
}

// ══════════════════════════════════════════
//  FAVORITES TAB RENDER
// ══════════════════════════════════════════
const _origLoadPickerTab2 = loadPickerTab;
loadPickerTab = async function(tab) {
  if (tab === 'favorites') {
    pickerTab = tab;
    // Bump the shared race-guard token used by every other tab (random/
    // recent/search) — without this, a still-in-flight fetch from whatever
    // tab was active before switching to Favorites would pass its own
    // stale-token check once it resolves and overwrite this list.
    _pickerLoadToken++;
    const favs = getFavorites();
    if (!favs.length) {
      pickerList.innerHTML = '<div class="picker-empty">no favorites yet — hit the heart on any song</div>';
      return;
    }
    const sorted = applySort(favs, 'favorites');
    pickerList.innerHTML = '';
    const lbl = document.createElement('div');
    lbl.className = 'picker-section-label';
    lbl.textContent = 'Favorites (' + sorted.length + ')';
    pickerList.appendChild(lbl);
    pickerSongs = sorted;
    renderSongItems(sorted, pickerList);
    showSortBtn('favorites');
    return;
  }
  return _origLoadPickerTab2(tab);
};

// ══════════════════════════════════════════
//  FULLSCREEN FAVORITE BUTTON
// ══════════════════════════════════════════
let _shuffleOn = false;
let _repeatOn  = false;

function updateFSFavBtn() {
  const song = playerState.currentSong;
  const icon = document.getElementById('fsFavIcon');
  const btn  = document.getElementById('fsFav');
  if (!icon || !btn || !song) return;
  const fav = isFavorite(song.id);
  icon.className = fav ? 'ti ti-heart-filled' : 'ti ti-heart';
  btn.style.color = fav ? 'var(--danger-color)' : '';
  btn.style.opacity = fav ? '0.9' : '0.6';
}

document.getElementById('fsFav').addEventListener('click', () => {
  const song = playerState.currentSong;
  if (!song) return;
  if (isFavorite(song.id)) removeFavorite(song.id);
  else addFavorite(song);
  updateFSFavBtn();
  SFX.play('star');
});

// Shared so the dock and FS shuffle buttons never fall out of sync with
// each other — previously the FS button's own click handler only updated
// itself, so toggling shuffle there left the dock icon stale.
function syncShuffleBtns() {
  const dockBtn = document.getElementById('dockShuffle');
  const fsBtn   = document.getElementById('fsShuffle');
  if (dockBtn) {
    dockBtn.style.opacity = _shuffleOn ? '1' : '0.45';
    dockBtn.style.color   = _shuffleOn ? 'rgba(var(--accent-rgb),1)' : '';
  }
  if (fsBtn) {
    fsBtn.style.opacity = _shuffleOn ? '1' : '0.5';
    fsBtn.style.color   = _shuffleOn ? 'rgba(var(--accent-rgb),1)' : '';
  }
}

document.getElementById('fsShuffle').addEventListener('click', () => {
  _shuffleOn = !_shuffleOn;
  syncShuffleBtns();
  SFX.play('click');
});

document.getElementById('fsRepeat').addEventListener('click', () => {
  _repeatOn = !_repeatOn;
  const btn = document.getElementById('fsRepeat');
  btn.style.opacity = _repeatOn ? '1' : '0.5';
  btn.style.color = _repeatOn ? 'rgba(var(--accent-rgb),1)' : '';
  SFX.play('click');
  if (_repeatOn) playerState.audio.loop = true;
  else playerState.audio.loop = false;
});

// Update FS fav button when track changes
const _origUpdateFSUI2 = updateFSUI;
updateFSUI = function(song) {
  _origUpdateFSUI2(song);
  setTimeout(updateFSFavBtn, 50);
};

// Shuffle integration — if shuffle on, pick random from playlist on next
const _origNextSong2 = nextSong;
nextSong = async function() {
  if (_shuffleOn && playerState.playlist.length > 1) {
    let idx;
    do { idx = Math.floor(Math.random() * playerState.playlist.length); }
    while (idx === playerState.playlistIndex);
    playerState.playlistIndex = idx;
    await playSong(playerState.playlist[idx]);
    return;
  }
  return _origNextSong2();
};

// ══════════════════════════════════════════
//  DOCK SHUFFLE + FAV BUTTONS
// ══════════════════════════════════════════
function updateDockFavBtn() {
  const song = playerState.currentSong;
  const icon = document.getElementById('dockFavIcon');
  const btn  = document.getElementById('dockFav');
  if (!icon || !btn) return;
  if (!song) { icon.className = 'ti ti-heart'; btn.style.opacity = '0.45'; btn.style.color = ''; return; }
  const fav = isFavorite(song.id);
  icon.className = fav ? 'ti ti-heart-filled' : 'ti ti-heart';
  btn.style.color  = fav ? 'var(--danger-color)' : '';
  btn.style.opacity = fav ? '0.9' : '0.45';
}

document.getElementById('dockFav').addEventListener('click', () => {
  const song = playerState.currentSong;
  if (!song) return;
  if (isFavorite(song.id)) removeFavorite(song.id);
  else addFavorite(song);
  updateDockFavBtn();
  updateFSFavBtn();
  SFX.play('star');
});

document.getElementById('dockShuffle').addEventListener('click', () => {
  _shuffleOn = !_shuffleOn;
  syncShuffleBtns();
  SFX.play('click');
});

// ══════════════════════════════════════════
//  SHARE TO FEED — post the currently-playing song, optionally with
//  whatever lyric line is on screen right now (see window._klabLyrics'
//  getActiveLine(), exposed by the LYRICS ENGINE module above).
// ══════════════════════════════════════════
function shareCurrentSongToFeed() {
  const song = playerState.currentSong;
  if (!song) { showToast('Nothing playing to share'); return; }
  const lyric = window._klabLyrics?.getActiveLine?.() || null;
  setActiveTab('feed');
  // window.klabShareSongToFeed is exposed by the FEED module (a separate
  // IIFE later in the script) — guarded since that module could in theory
  // fail to init (missing #feedList markup, see its own early return).
  window.klabShareSongToFeed?.({
    songId: song.id, title: song.title, artist: song.artist, album: song.album,
    coverArt: song.coverArt, lyric,
  });
  SFX.play('click');
}
document.getElementById('dockShare')?.addEventListener('click', shareCurrentSongToFeed);
document.getElementById('fsShare')?.addEventListener('click', shareCurrentSongToFeed);

// Update dock fav when track changes
const _prevUpdatePlayerUI = updatePlayerUI;
updatePlayerUI = function(song) {
  _prevUpdatePlayerUI(song);
  updateDockFavBtn();
};

// The "EDIT MODE" tile/section drag-to-reorder system (editMode,
// loadLayoutState/saveTileOrder/saveSectionOrder, the tile drag-ghost +
// section HTML5-drag implementations, the edit banner/header toggle)
// lived here — removed entirely, along with tile_order/section_order from
// the prefs-sync payload below. Tiles/sections are effectively fixed
// content now (the custom-app builder that would've made reordering them
// meaningful was already removed earlier — see APP MANAGEMENT below).

