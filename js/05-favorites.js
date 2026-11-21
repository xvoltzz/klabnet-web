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
  // Favourites saved as whole song records (before slimSong): slimmed once.
  if (_favCache.some(f => f && (f.path || f.size || f.created))) {
    _favCache = _favCache.filter(Boolean).map(slimSong);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(_favCache)); } catch (e) {}
  }
  _favIdSet = new Set(_favCache.map(s => s && s.id));
  return _favCache;
}
function isFavorite(id) { getFavorites(); return _favIdSet.has(id); }
// What a favourite needs to play and show, not Navidrome's whole song
// record (~1KB each: paths, genres, replay gain...). That's what kept the
// list to 200, which quietly dropped the oldest when you hit it.
const FAV_FIELDS = ['id', 'title', 'artist', 'artistId', 'album', 'albumId', 'albumArtist', 'displayAlbumArtist',
  'coverArt', 'duration', 'track', 'year', 'suffix', 'bitRate', 'bitDepth', 'samplingRate', 'musicBrainzId'];
const FAV_MAX = 2000;
function slimSong(song) {
  const out = {};
  for (const k of FAV_FIELDS) if (song[k] != null && song[k] !== '') out[k] = song[k];
  return out;
}
function addFavorite(song) {
  const favs = getFavorites();
  if (!isFavorite(song.id)) {
    // Full: say so, rather than dropping the oldest behind your back.
    if (favs.length >= FAV_MAX) { showToast?.(`Favorites are full (${FAV_MAX.toLocaleString()} songs). Remove some to add more.`, 'ti-heart'); return; }
    favs.unshift(slimSong(song));
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (e) { showToast?.('Couldn’t save that favorite: storage is full', 'ti-alert-triangle'); }
  }
  invalidateFavCache();
  updateFavBadge();
}
function removeFavorite(id) {
  const favs = getFavorites().filter(s => s.id !== id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (e) {}
  invalidateFavCache();
  updateFavBadge();
}
function updateFavBadge() {
  // Every heart on screen follows, however it was toggled (a row, a card,
  // the album page, a menu, the dock, the full player, another device).
  updateDockFavBtn();
  updateFSFavBtn();
  klabPaintHearts();
  const el = document.getElementById('favCount');
  const n = getFavorites().length + (window.klabFavAlbums?.list().length || 0) + (window.klabFavArtists?.list().length || 0);
  if (el) el.textContent = n ? n.toLocaleString() : '';
  window._favViewSync?.();
}

// ══════════════════════════════════════════
//  FAVORITE ALBUMS AND ARTISTS — kept like songs: slim records in
//  localStorage, synced as prefs (fav_albums, fav_artists; js/06-prefs.js).
//  Not Navidrome's stars: everyone plays through one Navidrome account.
//  Every change fires 'klab:favs' ({ kind, local }).
// ══════════════════════════════════════════
function makeFavStore({ key, kind, slim, max = 2000, noun }) {
  let cache = null, ids = null;
  const read = () => {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { cache = []; }
    if (!Array.isArray(cache)) cache = [];
    cache = cache.filter(x => x && x.id);
    ids = new Set(cache.map(x => x.id));
    return cache;
  };
  const write = list => {
    try { localStorage.setItem(key, JSON.stringify(list)); return true; }
    catch (e) { showToast?.('Couldn’t save that favorite: storage is full', 'ti-alert-triangle'); return false; }
  };
  const changed = () => {
    cache = null; ids = null;
    window.dispatchEvent(new CustomEvent('klab:favs', { detail: { kind, local: true } }));
    updateFavBadge();
  };
  const store = {
    key, kind,
    list: () => read(),
    has: id => { read(); return ids.has(id); },
    add(obj) {
      if (!obj?.id || store.has(obj.id)) return;
      const list = read();
      if (list.length >= max) { showToast?.(`Favorites are full (${max.toLocaleString()} ${noun}s). Remove some to add more.`, 'ti-heart'); return; }
      if (write([{ ...slim(obj), added: Date.now() }, ...list])) changed();
    },
    remove(id) {
      if (!store.has(id)) return;
      if (write(read().filter(x => x.id !== id))) changed();
    },
    toggle(obj) { if (store.has(obj.id)) store.remove(obj.id); else store.add(obj); return store.has(obj.id); },
    invalidate() { cache = null; ids = null; },
  };
  return store;
}
const _pick = (o, keys) => { const out = {}; for (const k of keys) if (o[k] != null && o[k] !== '') out[k] = o[k]; return out; };
window.klabFavAlbums = makeFavStore({
  key: 'klabnet_fav_albums', kind: 'album', noun: 'album',
  slim: a => ({ ..._pick(a, ['id', 'artist', 'artistId', 'coverArt', 'year', 'songCount']), name: a.name || a.title || '' }),
});
window.klabFavArtists = makeFavStore({
  key: 'klabnet_fav_artists', kind: 'artist', noun: 'artist',
  slim: a => ({ ..._pick(a, ['id', 'coverArt', 'albumCount']), name: a.name || a.artist || '' }),
});

// ── One heart, everywhere ──
// Any button with data-heart="song:<id>" (album:, artist:) is a favourite
// toggle: painted here (aria-pressed, the filled heart, its title) and
// pressed through one handler. What it favourites comes from the element
// itself (._fav) or the row or card it sits in (._song, ._album, ._artist);
// the dock's and the full player's are the song playing.
const _favStoreFor = kind => kind === 'album' ? klabFavAlbums : kind === 'artist' ? klabFavArtists : null;
function klabIsFav(kind, id) { return kind === 'song' ? isFavorite(id) : !!_favStoreFor(kind)?.has(id); }
function klabToggleFav(kind, obj) {
  if (!obj?.id) return false;
  let on;
  if (kind === 'song') { if (isFavorite(obj.id)) removeFavorite(obj.id); else addFavorite(obj); on = isFavorite(obj.id); }
  else on = _favStoreFor(kind).toggle(obj);
  SFX && SFX.play('star');
  return on;
}
const _heartTitle = on => on ? 'Remove from favorites' : 'Add to favorites';
function klabHeartHTML(kind, id, cls = '') {
  const on = klabIsFav(kind, id);
  return `<button type="button" class="k-heart${cls ? ' ' + cls : ''}${on ? ' on' : ''}" data-heart="${kind}:${esc(String(id))}" aria-pressed="${on}" title="${_heartTitle(on)}" aria-label="${_heartTitle(on)}"><i class="ti ${on ? 'ti-heart-filled' : 'ti-heart'}"></i></button>`;
}
function _paintHeart(b, pop) {
  const v = b.dataset.heart || '', at = v.indexOf(':');
  const on = at > 0 && klabIsFav(v.slice(0, at), v.slice(at + 1));
  if (b.classList.contains('on') !== on || b.getAttribute('aria-pressed') !== String(on)) {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.title = _heartTitle(on);
    b.setAttribute('aria-label', b.title);
    const i = b.querySelector('i'); if (i) i.className = 'ti ' + (on ? 'ti-heart-filled' : 'ti-heart');
  }
  if (pop && on && (window.klabMotionOk?.() ?? true)) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
}
function klabPaintHearts(root = document) {
  root.querySelectorAll?.('[data-heart]').forEach(b => _paintHeart(b));
}
window.klabHeartHTML = klabHeartHTML;
window.klabPaintHearts = klabPaintHearts;
function _heartObject(b, kind) {
  if (b._fav) return b._fav;
  if (b.hasAttribute('data-heart-now')) return playerState.currentSong;
  const prop = { song: '_song', album: '_album', artist: '_artist' }[kind];
  for (let n = b; n && n !== document.body; n = n.parentElement) if (n[prop]) return n[prop];
  return null;
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-heart]');
  if (!b) return;
  // Before the row or card under it hears the click (that plays or opens).
  e.stopPropagation(); e.preventDefault();
  const v = b.dataset.heart, at = v.indexOf(':');
  if (at < 1) return;
  const kind = v.slice(0, at), id = v.slice(at + 1);
  const obj = _heartObject(b, kind) || { id };
  if (String(obj.id) !== id) return;
  klabToggleFav(kind, obj);
  updateFavBadge();
  _paintHeart(b, true);
}, true);
window.addEventListener('klab:favs', () => {
  if (pickerTab === 'favorites' && document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active')) _favRedrawSoon();
});

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
  // Slim records, like favourites: this list is saved to prefs after every
  // song, and 50 whole Navidrome records were ~50KB each time. A full
  // store mustn't throw either: this runs inside playSong.
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 50).filter(Boolean).map(slimSong))); } catch (e) {}
}

// ══════════════════════════════════════════
//  FAVORITES — Songs, Albums, Artists (and Saved playlists when there are
//  any) as a switch along the top (owner, 2026-11-20: wanted them
//  separated again), each with its count; the choice is kept per device
//  (klabnet_fav_view). Songs has Play, Shuffle and a find box.
// ══════════════════════════════════════════
let _favSig = '', _favRedrawT = 0;
const _favSigNow = () => [getFavorites().length, klabFavAlbums.list().length, klabFavArtists.list().length,
  (window.klabPlaylists?.mine() || []).filter(p => p.saved && !p.mine).length].join(',');
function _favRedrawSoon() {
  clearTimeout(_favRedrawT);
  _favRedrawT = setTimeout(() => {
    if (pickerTab !== 'favorites' || _favSigNow() === _favSig) return;
    const top = pickerList.scrollTop;
    // Unhearting a song while typing in the filter mustn't throw you out
    // of the box: the redraw puts the cursor back where it was.
    const a = document.activeElement, typing = a?.matches?.('.fav-find input') ? [a.selectionStart, a.selectionEnd] : null;
    renderFavoritesView(true);
    pickerList.scrollTop = top;
    if (typing) {
      const i = pickerList.querySelector('.fav-find input');
      if (i) { i.focus({ preventScroll: true }); try { i.setSelectionRange(typing[0], typing[1]); } catch (e) {} }
    }
  }, 250);
}
window._favViewSync = () => { if (typeof pickerTab !== 'undefined' && pickerTab === 'favorites') _favRedrawSoon(); };
window.addEventListener('klab:playlists', () => window._favViewSync());

let _favFind = '', _favVirtualOff = null, _favPicked = false;
function renderFavoritesView(redraw) {
  _favVirtualOff?.(); _favVirtualOff = null;
  _favSig = _favSigNow();
  const songs = getFavorites(), albums = klabFavAlbums.list(), artists = klabFavArtists.list();
  const pls = (window.klabPlaylists?.mine() || []).filter(p => p.saved && !p.mine);
  const cards = window.klabMusicCards;
  pickerList.innerHTML = '';
  pickerList.classList.add('fav-hub');
  const total = songs.length + albums.length + artists.length + pls.length;
  document.getElementById('musicViewSub').textContent = total ? total.toLocaleString() : '';
  if (!total) {
    pickerList.innerHTML = '<div class="k-empty fav-empty"><i class="ti ti-heart"></i><div>No favorites yet. Use the ♥ on a song, album or artist.</div></div>';
    hideSortBtn();
    return;
  }
  // The switch. A kind with nothing in it is still offered (except
  // playlists), with an empty line, so the three are always where you
  // left them.
  const kinds = [['songs', 'Songs', songs.length], ['albums', 'Albums', albums.length], ['artists', 'Artists', artists.length]];
  if (pls.length) kinds.push(['playlists', 'Playlists', pls.length]);
  let want = 'songs';
  try { want = localStorage.getItem('klabnet_fav_view') || 'songs'; } catch (e) {}
  if (!kinds.some(k => k[0] === want)) want = 'songs';
  // Coming in with nothing in the kept one: show what there is. Not after a
  // press, though: pressing an empty Albums jumped straight back to Songs,
  // so it couldn't be opened at all.
  if (!_favPicked && !kinds.find(k => k[0] === want)[2]) want = (kinds.find(k => k[2]) || kinds[0])[0];
  _favPicked = false;
  const seg = document.createElement('div');
  seg.className = 'k-seg fav-seg';
  seg.setAttribute('role', 'tablist');
  seg.innerHTML = kinds.map(([k, label, n]) =>
    `<button type="button" role="tab" data-fav-kind="${k}" aria-selected="${k === want}" aria-pressed="${k === want}">${label}<span class="k-count">${n ? n.toLocaleString() : ''}</span></button>`).join('');
  seg.addEventListener('click', e => {
    const b = e.target.closest('[data-fav-kind]');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    try { localStorage.setItem('klabnet_fav_view', b.dataset.favKind); } catch (e2) {}
    _favPicked = true;
    SFX && SFX.play('click');
    renderFavoritesView(true);
    pickerList.scrollTop = 0;
  });
  // One bar: the switch on the left, and for songs the filter, Play and
  // Shuffle on the right.
  const bar = document.createElement('div');
  bar.className = 'fav-bar';
  bar.appendChild(seg);
  pickerList.appendChild(bar);
  // An empty kind says how to fill it, with a way to go and find some.
  const emptyKind = (icon, what, where, tab) =>
    `<div class="k-empty fav-empty-kind"><i class="ti ${icon}"></i><div>No favorite ${what} yet</div>` +
    `<div class="fav-empty-sub">Press the ♥ on ${where} and it shows up here.</div>` +
    (tab ? `<button type="button" class="k-btn sm" data-fav-go="${tab}">Browse ${what}</button>` : '') + `</div>`;
  pickerList.onclick = e => {
    const go = e.target.closest('[data-fav-go]');
    if (go) document.querySelector(`.music-nav .picker-tab[data-tab="${go.dataset.favGo}"]`)?.click();
  };
  const grid = (items, empty) => {
    if (!items.length) { pickerList.insertAdjacentHTML('beforeend', empty); return; }
    const g = document.createElement('div');
    g.className = 'fav-grid';
    items.forEach(c => g.appendChild(c));
    pickerList.appendChild(g);
  };
  if (want !== 'songs') {
    hideSortBtn();
    if (want === 'albums') grid(cards ? albums.map(cards.album) : [], emptyKind('ti-disc', 'albums', 'an album’s page', 'albums'));
    else if (want === 'artists') grid(cards ? artists.map(cards.artist) : [], emptyKind('ti-microphone-2', 'artists', 'an artist’s page', 'artists'));
    else grid(pls.map(p => window.klabPlaylists.card(p)), '');
    return;
  }
  if (!songs.length) { pickerList.insertAdjacentHTML('beforeend', emptyKind('ti-music', 'songs', 'a song', 'songs')); hideSortBtn(); return; }

  // Songs: a label with Play, Shuffle and a find box beside it.
  const sorted = applySort(songs, 'favorites');
  const head = document.createElement('div');
  head.className = 'fav-bar-end';
  head.innerHTML = `<label class="k-field-box fav-find"><i class="ti ti-list-search"></i><input type="text" placeholder="Filter songs" aria-label="Filter favorite songs" autocomplete="off" spellcheck="false"><button type="button" class="fav-find-x" title="Clear" aria-label="Clear the filter" hidden><i class="ti ti-x"></i></button></label>
    <button type="button" class="k-btn sm" data-fav-shuffle title="Shuffle"><i class="ti ti-arrows-shuffle"></i>Shuffle</button>
    <button type="button" class="k-btn sm primary" data-fav-play><i class="ti ti-player-play-filled"></i>Play</button>`;
  const box = document.createElement('div');
  box.className = 'fav-songs';
  const input = head.querySelector('input');
  input.value = _favFind;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const shown = () => {
    const words = fold(_favFind).split(/\s+/).filter(Boolean);
    return words.length ? sorted.filter(s => { const h = fold(`${s.title} ${s.artist} ${s.album}`); return words.every(w => h.includes(w)); }) : sorted;
  };
  // Up to 2,000 songs: drawn as a virtual list (only the rows on screen
  // exist; js/26-browse.js), where all of them took ~40,000 elements.
  const draw = () => {
    const list = shown();
    pickerSongs = list;
    _favVirtualOff?.(); _favVirtualOff = null;
    box.textContent = '';
    if (!list.length) { box.innerHTML = '<div class="picker-empty">No favorite songs match.</div>'; return; }
    if (window.klabVirtualSongs && list.length > 60) {
      const vl = document.createElement('div');
      box.appendChild(vl);
      _favVirtualOff = window.klabVirtualSongs(vl, list).off;
    } else renderSongItems(list, box);
  };
  const clearX = head.querySelector('.fav-find-x');
  clearX.hidden = !_favFind;
  // Drawn a beat after typing stops (2,000 favourites is a lot of rows to
  // redraw on every key).
  let typingT = 0;
  const set = (v, now) => {
    _favFind = v; clearX.hidden = !v;
    clearTimeout(typingT);
    if (now) draw(); else typingT = setTimeout(draw, songs.length > 300 ? 140 : 0);
  };
  input.addEventListener('input', () => set(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; set('', true); } });
  clearX.addEventListener('click', e => { e.preventDefault(); input.value = ''; set('', true); input.focus(); });
  head.querySelector('[data-fav-play]').addEventListener('click', () => { const l = shown(); if (l.length) { playSongList(l); SFX && SFX.play('click'); } });
  head.querySelector('[data-fav-shuffle]').addEventListener('click', () => { const l = shown(); if (l.length) { playSongList(l, { shuffle: true }); SFX && SFX.play('click'); } });
  bar.appendChild(head);
  pickerList.appendChild(box);
  draw();
  showSortBtn('favorites');
}

const _origLoadPickerTab2 = loadPickerTab;
loadPickerTab = async function(tab) {
  if (tab !== 'favorites') { pickerList.classList.remove('fav-hub'); _favVirtualOff?.(); _favVirtualOff = null; }
  if (tab === 'favorites') {
    pickerTab = tab;
    // Bump the shared race-guard token used by every other tab (random/
    // recent/search) — without this, a still-in-flight fetch from whatever
    // tab was active before switching to Favorites would pass its own
    // stale-token check once it resolves and overwrite this list.
    _pickerLoadToken++;
    renderFavoritesView();
    return;
  }
  return _origLoadPickerTab2(tab);
};

// ══════════════════════════════════════════
//  SHUFFLE AND REPEAT
//  Shuffle is a real order: the list shuffled once (the song playing
//  first), walked in turn, so nothing comes round twice before the rest
//  has. Repeat is off, all (round the list again) or one (this song again:
//  _repeatOn, which is what js/23-session.js shares as "repeat").
// ══════════════════════════════════════════
let _shuffleOn = false;
let _repeatOn  = false;
let _repeatAll = false;

function klabShuffleOrder(rebuild) {
  const pl = playerState.playlist || [];
  let o = playerState.shuffleOrder;
  if (rebuild || !o || playerState._shuffleOf !== pl || o.length !== pl.length) {
    o = [...pl.keys()];
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    const at = o.indexOf(playerState.playlistIndex);
    if (at > 0) { o.splice(at, 1); o.unshift(playerState.playlistIndex); }
    playerState.shuffleOrder = o;
    playerState._shuffleOf = pl;
  } else {
    // A song picked from the same list while shuffling (not reached by the
    // order): it moves to right after where the order had got to, so what
    // was still to come stays to come. Before, everything between the old
    // place and the pick's place in the order was skipped.
    const cur = playerState.playlistIndex, last = playerState._shuffleCur;
    if (last != null && last !== cur && o.includes(last)) {
      const a = o.indexOf(cur);
      if (a >= 0) { o.splice(a, 1); o.splice(o.indexOf(last) + 1, 0, cur); }
    }
  }
  playerState._shuffleCur = playerState.playlistIndex;
  return o;
}
// What comes after the song playing, as indexes into the playlist, in the
// order they'll play (the queue comes before all of it).
function klabUpcoming(n = 30) {
  const pl = playerState.playlist || [], i = playerState.playlistIndex;
  if (!pl.length) return [];
  if (_shuffleOn) {
    const o = klabShuffleOrder(), at = o.indexOf(i);
    return o.slice(at + 1, at + 1 + n);
  }
  const out = [];
  for (let k = i + 1; k < pl.length && out.length < n; k++) out.push(k);
  if (_repeatAll) for (let k = 0; k <= i && k < pl.length && out.length < n; k++) out.push(k);
  return out;
}
window.klabUpcoming = klabUpcoming;

const _repeatTitles = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this song' };
const repeatMode = () => _repeatOn ? 'one' : _repeatAll ? 'all' : 'off';
function syncRepeatBtns() {
  const m = repeatMode();
  for (const id of ['fsRepeat', 'dockRepeat']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.setAttribute('aria-pressed', m !== 'off');
    b.dataset.mode = m;
    b.title = _repeatTitles[m];
    b.setAttribute('aria-label', b.title);
  }
  window.klabUpNextRender?.();
}
window.syncRepeatBtns = syncRepeatBtns;
function cycleRepeat() {
  const next = { off: 'all', all: 'one', one: 'off' }[repeatMode()];
  _repeatAll = next === 'all';
  _repeatOn = next === 'one';
  playerState.audio.loop = _repeatOn;
  syncRepeatBtns();
  klabSavePlayerSoon?.();
  SFX.play('click');
}
for (const id of ['fsRepeat', 'dockRepeat']) document.getElementById(id)?.addEventListener('click', cycleRepeat);

// Shared so the dock and FS shuffle buttons never fall out of sync.
function syncShuffleBtns() {
  for (const id of ['dockShuffle', 'fsShuffle']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.setAttribute('aria-pressed', _shuffleOn);
    b.title = _shuffleOn ? 'Shuffle: on' : 'Shuffle: off';
    b.setAttribute('aria-label', b.title);
  }
}
function toggleShuffle() {
  _shuffleOn = !_shuffleOn;
  if (_shuffleOn) klabShuffleOrder(true); // a fresh order, from the song playing
  syncShuffleBtns();
  klabSavePlayerSoon?.();
  SFX.play('click');
}
document.getElementById('fsShuffle').addEventListener('click', toggleShuffle);
document.getElementById('dockShuffle').addEventListener('click', toggleShuffle);

// Update FS fav button when track changes
const _origUpdateFSUI2 = updateFSUI;
updateFSUI = function(song) {
  _origUpdateFSUI2(song);
  setTimeout(updateFSFavBtn, 50);
};

// Shuffled: the next in the shuffled order. Songs you queued come first,
// shuffle or not; at the end, repeat all goes round again (a new order),
// and otherwise it's what the end of any list is (js/02-player.js).
const _origNextSong2 = nextSong;
nextSong = async function() {
  const queued = typeof queue !== 'undefined' && queue.length;
  const pl = playerState.playlist;
  if (_shuffleOn && !queued && pl.length > 1) {
    const o = klabShuffleOrder(), at = o.indexOf(playerState.playlistIndex);
    let idx;
    if (at >= 0 && at + 1 < o.length) idx = o[at + 1];
    else if (_repeatAll) idx = klabShuffleOrder(true)[1];
    else return klabEndOfList();
    playerState.playlistIndex = idx;
    await playSong(pl[idx]);
    return;
  }
  return _origNextSong2();
};

// ══════════════════════════════════════════
//  THE DOCK'S AND FULL PLAYER'S HEARTS — the song playing
// ══════════════════════════════════════════
// The dock's and full-screen player's stars follow the song that's playing.
function syncPlayingStar(id) {
  const song = playerState.currentSong;
  const b = document.getElementById(id);
  if (!b) return;
  if (song?.id) { b.dataset.star = 'song:' + song.id; window.klabStars?.paint(b); }
  else delete b.dataset.star;
}
function syncNowHeart(id) {
  const b = document.getElementById(id), song = playerState.currentSong;
  if (!b) return;
  b.setAttribute('data-heart-now', '');
  b.classList.add('k-heart');
  b.disabled = !song?.id;
  if (song?.id) { b.dataset.heart = 'song:' + song.id; _paintHeart(b); }
  else { delete b.dataset.heart; b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); const i = b.querySelector('i'); if (i) i.className = 'ti ti-heart'; }
}
function updateFSFavBtn() { syncPlayingStar('fsStar'); syncNowHeart('fsFav'); }
function updateDockFavBtn() { syncPlayingStar('dockStar'); syncNowHeart('dockFav'); }

// ══════════════════════════════════════════
//  SHARE TO FEED — post the currently-playing song, optionally with
//  whatever lyric line is on screen right now (see window._klabLyrics'
//  getActiveLine(), exposed by the LYRICS ENGINE module above).
// ══════════════════════════════════════════
function shareSongToFeed(song) {
  if (!song) { showToast('Nothing playing to share', 'ti-player-stop'); return; }
  // The song playing shares the moment it's at and the lyric on screen.
  const now = playerState.currentSong?.id === song.id;
  const lyric = now ? window._klabLyrics?.getActiveLine?.() || null : null;
  setActiveTab('feed');
  // window.klabShareSongToFeed is exposed by the FEED module (a separate
  // IIFE later in the script) — guarded since that module could in theory
  // fail to init (missing #feedList markup, see its own early return).
  window.klabShareSongToFeed?.({
    songId: song.id, title: song.title, artist: song.artist, album: song.album,
    coverArt: song.coverArt, lyric, start: (now && klabMomentNow()) || undefined,
  });
  SFX.play('click');
}
function shareCurrentSongToFeed() { shareSongToFeed(playerState.currentSong); }
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

syncShuffleBtns();
syncRepeatBtns();
updateFavBadge();

// The dock's queue button: the queue popover (js/03-picker-tabs.js). The
// full player's disc button: the album playing.
document.getElementById('dockQueue')?.addEventListener('click', e => window.klabQueuePop?.toggle(e));
document.getElementById('fsGoAlbum')?.addEventListener('click', () => {
  const song = playerState.currentSong;
  if (!song?.albumId) return;
  closeFS();
  goToMusicDetail(() => loadAlbumView(song.albumId, song.album));
});

// Recently played: Clear history (with Undo), beside its count.
const _origLoadPickerTabRecent = loadPickerTab;
loadPickerTab = async function(tab) {
  const r = await _origLoadPickerTabRecent.apply(this, arguments);
  if (tab === 'recent' && pickerTab === 'recent' && getPlayHistory().length) {
    const lbl = pickerList.querySelector(':scope > .picker-section-label');
    if (lbl && !pickerList.querySelector('.recent-clear')) {
      const row = document.createElement('div');
      row.className = 'mr-actions recent-actions';
      row.innerHTML = '<button type="button" class="k-btn sm recent-clear"><i class="ti ti-trash"></i>Clear history</button>';
      row.firstChild.addEventListener('click', () => {
        let saved = null;
        klabUndo('Listening history cleared', {
          apply: () => { saved = localStorage.getItem(HISTORY_KEY); localStorage.setItem(HISTORY_KEY, '[]'); scheduleSave?.(); if (pickerTab === 'recent') loadPickerTab('recent'); },
          undo: () => { if (saved) localStorage.setItem(HISTORY_KEY, saved); scheduleSave?.(); if (pickerTab === 'recent') loadPickerTab('recent'); },
        });
      });
      lbl.after(row);
    }
  }
  return r;
};
