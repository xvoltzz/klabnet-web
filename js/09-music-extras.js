// ══════════════════════════════════════════
//  GENRES BROWSER
// ══════════════════════════════════════════
let _genresCache = null;
async function loadGenres() {
  pickerList.innerHTML = '<div class="picker-empty">loading genres...</div>';
  try {
    if (!_genresCache) {
      const res  = await fetchTimeout(`${ND_URL}/rest/getGenres?${subsonicParams()}`, {}, 8000);
      const data = await res.json();
      _genresCache = (data['subsonic-response']?.genres?.genre || []).filter(g => g.songCount > 0);
    }
    const genres = applySort(_genresCache, 'genres');

    if (!genres.length) { pickerList.innerHTML = '<div class="picker-empty">no genres found</div>'; return; }

    pickerList.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'picker-section-label';
    hdr.textContent = `Genres (${genres.length})`;
    pickerList.appendChild(hdr);
    showSortBtn('genres');

    genres.forEach(genre => {
      const item = document.createElement('div');
      item.className = 'picker-item';
      item.innerHTML = `
        <div class="picker-item-art-ph" style="font-size:20px;"><i class="ti ti-music-search"></i></div>
        <div class="picker-item-info" style="min-width:0;flex:1;">
          <div class="picker-item-title">${esc(genre.value)}</div>
          <div class="picker-item-artist">${genre.songCount} songs · ${genre.albumCount || 0} albums</div>
        </div>
        <div class="picker-item-actions" style="flex-shrink:0;">
          <button class="picker-action" title="Play genre"><i class="ti ti-player-play"></i></button>
        </div>`;

      const play = async () => {
        hideSortBtn();
        pickerList.innerHTML = '<div class="picker-empty">loading...</div>';
        try {
          const r = await fetchTimeout(`${ND_URL}/rest/getSongsByGenre?genre=${encodeURIComponent(genre.value)}&count=50&${subsonicParams()}`, {}, 8000);
          const d = await r.json();
          const songs = d['subsonic-response']?.songsByGenre?.song || [];
          if (!songs.length) { pickerList.innerHTML = '<div class="picker-empty">no songs found</div>'; return; }

          pickerList.innerHTML = '';
          // Back button
          const back = document.createElement('button');
          back.className = 'picker-back';
          back.innerHTML = '<i class="ti ti-arrow-left"></i> Genres';
          back.addEventListener('click', () => {
            document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="genres"]').classList.add('active');
            loadGenres();
          });
          pickerList.appendChild(back);

          const lbl = document.createElement('div');
          lbl.className = 'picker-section-label';
          lbl.textContent = `${genre.value} · ${songs.length} songs`;
          pickerList.appendChild(lbl);

          pickerSongs = songs;
          renderSongItems(songs, pickerList);
          showToast(`${genre.value} — ${songs.length} songs`);
        } catch(e) { pickerList.innerHTML = '<div class="picker-empty">failed to load</div>'; }
      };

      item.querySelector('[title="Play genre"]').addEventListener('click', e => { e.stopPropagation(); play(); SFX && SFX.play('click'); });
      item.addEventListener('click', play);
      pickerList.appendChild(item);
    });
  } catch(e) { pickerList.innerHTML = '<div class="picker-empty">failed to load genres</div>'; }
}

// ══════════════════════════════════════════
//  PLAYLISTS
// ══════════════════════════════════════════
const PLAYLISTS_KEY = 'klabnet_playlists';

function getPlaylists() {
  try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]'); } catch(e) { return []; }
}
function savePlaylists(pls) {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(pls));
  scheduleSave();
  // Single touch point for every mutation (create/delete/add-song all
  // funnel through here) — the sidebar just stays in sync automatically
  // rather than each call site needing to remember to refresh it.
  if (typeof renderPlaylistNav === 'function') renderPlaylistNav();
}

// Sidebar playlist rows (see .music-playlist-nav in the Music tab-panel
// markup) — replaces the old generic "Playlists" tab; each playlist is now
// its own direct link, same as a real Spotify sidebar. Reuses
// loadPlaylistView() unchanged for the actual track-list rendering.
function renderPlaylistNav() {
  const nav = document.getElementById('musicPlaylistNav');
  const newBtn = document.getElementById('musicNewPlaylistBtn');
  if (!nav || !newBtn) return;
  nav.querySelectorAll('.music-playlist-row').forEach(row => row.remove());
  getPlaylists().forEach(pl => {
    const row = document.createElement('div');
    row.className = 'music-playlist-row';
    row.dataset.plId = pl.id;
    const artSong = pl.songs.find(s => s.coverArt);
    const artHTML = artSong
      ? `<img class="music-playlist-row-art" src="${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(artSong.coverArt)}&size=60&${subsonicParams()}" alt="" loading="lazy" />`
      : `<div class="music-playlist-row-art"><i class="ti ti-playlist"></i></div>`;
    row.innerHTML = `
      ${artHTML}
      <div class="music-playlist-row-info">
        <div class="music-playlist-row-name">${esc(pl.name)}</div>
        <div class="music-playlist-row-meta">${pl.songs.length} song${pl.songs.length === 1 ? '' : 's'}</div>
      </div>
      <button class="music-playlist-row-del" title="Delete playlist" type="button"><i class="ti ti-trash"></i></button>
    `;
    row.querySelector('.music-playlist-row-del').addEventListener('click', async e => {
      e.stopPropagation();
      const ok = await showConfirmDialog('// delete playlist', `Delete "${pl.name}"? This can't be undone.`, 'Delete');
      if (!ok) return;
      savePlaylists(getPlaylists().filter(p => p.id !== pl.id));
      SFX && SFX.play('click');
    });
    row.addEventListener('click', () => {
      window.closeApPanel?.();
      document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.music-playlist-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      pickerTab = 'playlist';
      loadPlaylistView(pl);
    });
    nav.insertBefore(row, newBtn);
  });
}
document.getElementById('musicNewPlaylistBtn')?.addEventListener('click', async () => {
  const name = await showInputDialog('// new playlist', 'Name your new playlist.', 'Playlist name');
  if (!name) return;
  createPlaylist(name);
  SFX && SFX.play('star');
  showToast(`"${name}" created`);
});

function createPlaylist(name) {
  const pls = getPlaylists();
  const pl = { id: Date.now().toString(), name, songs: [], created: new Date().toISOString() };
  pls.push(pl);
  savePlaylists(pls);
  return pl;
}

function addSongToPlaylist(plId, song) {
  const pls = getPlaylists();
  const pl  = pls.find(p => p.id === plId);
  if (!pl) return;
  if (!pl.songs.find(s => s.id === song.id)) { pl.songs.push(song); }
  savePlaylists(pls);
  showToast(`Added to "${pl.name}"`);
}

// renderPlaylistList() (the old generic "Playlists" browse tab) removed —
// unreachable dead code. renderPlaylistNav() replaced it: each playlist is
// now its own direct link in the sidebar, and no UI path sets
// pickerTab === 'playlists' any more (confirmed: no such tab button
// exists, only random/recent/songs/albums/artists/genres/favorites/
// queue/requests do).

function loadPlaylistView(pl) {
  hideSortBtn();
  pickerList.classList.remove('picker-list-grid'); // a track list, not a grid — in case Albums/Artists left it on
  pickerList.innerHTML = '';
  // Playlists are always one click away in the sidebar now (no more
  // generic "Playlists" tab to go back to) — this just clears the active
  // state and returns to Home, same as clicking any other sidebar item.
  const back = document.createElement('button');
  back.className = 'picker-back';
  back.innerHTML = '<i class="ti ti-arrow-left"></i> Back';
  back.addEventListener('click', () => {
    document.querySelectorAll('.music-playlist-row').forEach(r => r.classList.remove('active'));
    document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="random"]').classList.add('active');
    loadPickerTab('random');
  });
  pickerList.appendChild(back);

  const lbl = document.createElement('div');
  lbl.className = 'picker-section-label';
  lbl.textContent = `${pl.name} · ${pl.songs.length} songs`;
  pickerList.appendChild(lbl);

  if (!pl.songs.length) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = 'no songs — add some using the playlist button on songs';
    pickerList.appendChild(empty);
    return;
  }
  pickerSongs = pl.songs;
  pl.songs.forEach((song, idx) => {
    renderSongItem(song, pickerList);
    // Append a remove-from-playlist button to this item's actions
    const item = pickerList.lastElementChild;
    if (!item) return;
    const actions = item.querySelector('.picker-item-actions');
    if (!actions) return;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'picker-action';
    removeBtn.title = 'Remove from playlist';
    removeBtn.innerHTML = '<i class="ti ti-x" style="color:var(--danger-color);"></i>';
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      // Get fresh playlist from storage (index may have shifted)
      const pls = getPlaylists();
      const target = pls.find(p => p.id === pl.id);
      if (!target) return;
      // Find by song id to be safe
      const songIdx = target.songs.findIndex(s => s.id === song.id);
      if (songIdx === -1) return;
      target.songs.splice(songIdx, 1);
      pl.songs = target.songs; // keep local ref in sync
      savePlaylists(pls);
      item.remove();
      lbl.textContent = `${pl.name} · ${target.songs.length} songs`;
      SFX && SFX.play('click');
    });
    actions.appendChild(removeBtn);
  });
}

// Add to playlist — shared by the picker row button (delegated, below)
// and the song right-click context menu (SONG CONTEXT MENU, further down).
async function addSongToPlaylistFlow(song) {
  const pls = getPlaylists();
  if (!pls.length) {
    const name = await showInputDialog('// new playlist', 'No playlists yet — name one to add this song to.', 'Playlist name');
    if (!name) return;
    const pl = createPlaylist(name);
    addSongToPlaylist(pl.id, song);
  } else {
    const idx = await showChoiceDialog(
      `// add "${song.title}" to...`,
      pls.map(p => ({ label: p.name, sub: `${p.songs.length} song${p.songs.length === 1 ? '' : 's'}` }))
    );
    if (idx === null || idx === undefined || !pls[idx]) return;
    addSongToPlaylist(pls[idx].id, song);
  }
  SFX && SFX.play('queue');
}

// Wired directly inside renderSongItem's template via event delegation on
// the pickerList container.
let _plDelegated = false;
function ensurePlDelegate() {
  if (_plDelegated) return;
  _plDelegated = true;
  document.getElementById('pickerList').addEventListener('click', e => {
    const btn = e.target.closest('[data-add-pl]');
    if (!btn) return;
    e.stopPropagation();
    addSongToPlaylistFlow(JSON.parse(decodeURIComponent(btn.dataset.addPl)));
  });
}

// ══════════════════════════════════════════
//  MUSIC DOWNLOADS — pull a track or a whole album out of the library
//
//  Two different mechanisms, because Navidrome treats the two endpoints
//  differently:
//
//    /rest/download  returns the file on disk (or a ZIP, for an album id)
//                    with `Content-Disposition: attachment` and the real
//                    filename already set, so pointing an <a> at it is
//                    enough — the browser downloads rather than navigates,
//                    and nothing has to buffer in memory. This is the path
//                    a whole album must take: an album ZIP is happily
//                    hundreds of MB and has no business in a Blob.
//
//    /rest/stream    with format=mp3 transcodes on the fly, but serves it
//                    `audio/mpeg` INLINE with no Content-Disposition. A
//                    plain navigation would just start playing it in a new
//                    tab, and the <a download> attribute can't override
//                    that because music.klab.gg is a different origin from
//                    this page — cross-origin `download` is ignored. So
//                    the transcoded path has to fetch the bytes and hand
//                    the browser a same-origin blob: URL instead, which is
//                    also the only way we get to name the file ourselves.
// ══════════════════════════════════════════
const DL_MP3_BITRATE = 320;

function _dlAnchor(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Tag values come straight from file metadata, so they can contain path
// separators and the characters Windows rejects outright ("AC/DC", "Where
// Is My Mind?"). Only used for the transcoded path — /download's own
// filename never passes through here.
function _dlFilename(song, ext) {
  const base = [song.artist, song.title].filter(Boolean).join(' - ') || 'track';
  return base.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 150) + '.' + ext;
}

function downloadSongOriginal(song) {
  if (!song || !song.id) return;
  _dlAnchor(`${ND_URL}/rest/download?id=${encodeURIComponent(song.id)}&${subsonicParams()}`);
  showToast(`Downloading "${song.title}"`);
}

let _dlMp3Busy = false;
async function downloadSongMp3(song) {
  if (!song || !song.id) return;
  // The whole file lands in memory before the browser sees any of it, so
  // don't let someone stack up five of these by spamming the menu.
  if (_dlMp3Busy) { showToast('Already preparing a download'); return; }
  _dlMp3Busy = true;
  let objUrl = '';
  try {
    showToast(`Converting "${song.title}" to MP3…`);
    const url = `${ND_URL}/rest/stream?id=${encodeURIComponent(song.id)}`
              + `&format=mp3&maxBitRate=${DL_MP3_BITRATE}&${subsonicParams()}`;
    // fetchTimeout's abort timer is cleared when the fetch promise settles
    // — that's at the response HEADERS, not the end of the body — so this
    // 30s cap covers "did Navidrome answer at all" without also capping
    // how long a long track is allowed to spend transcoding.
    const res = await fetchTimeout(url, {}, 30000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!blob.size) throw new Error('empty response');
    objUrl = URL.createObjectURL(blob);
    _dlAnchor(objUrl, _dlFilename(song, 'mp3'));
    showToast(`Downloaded "${song.title}" (MP3)`);
  } catch (err) {
    console.warn('[download] mp3 failed', err);
    showToast('MP3 download failed — try the original');
  } finally {
    _dlMp3Busy = false;
    // Revoking immediately can cancel the download in some browsers; the
    // click has only queued it at this point.
    if (objUrl) setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  }
}

// Albums are original-quality only: Subsonic has no transcoded-archive
// endpoint, and doing it client-side would mean fetching and re-zipping
// the entire album in a tab.
function downloadAlbumZip(albumId, albumName) {
  if (!albumId) return;
  _dlAnchor(`${ND_URL}/rest/download?id=${encodeURIComponent(albumId)}&${subsonicParams()}`);
  showToast(`Downloading "${albumName || 'album'}" (ZIP)`);
}

// ══════════════════════════════════════════
//  SONG CONTEXT MENU — right-click a song (picker rows, player dock)
//  for the same actions each row's buttons already offer, without
//  needing that whole action row (the player dock has no room for one).
// ══════════════════════════════════════════
const songCtxMenu = document.getElementById('songCtxMenu');
function hideSongCtx() { songCtxMenu.classList.remove('visible'); }
// contextSongs (optional): the list `song` actually belongs to, for
// setting up the right queue/playlist context on "Play" — defaults to the
// picker's own pickerSongs since most callers open this from the main
// song list. The album/artist detail view's own track rows pass their
// local `songs` array instead, since those tracks were never in
// pickerSongs to begin with.
function showSongCtx(x, y, song, contextSongs) {
  if (!song) return;
  document.getElementById('songCtxLabel').textContent = song.title || 'Song';

  document.getElementById('songCtxPlay').onclick = async () => {
    hideSongCtx();
    const list = contextSongs || pickerSongs;
    if (Array.isArray(list) && list.includes(song)) {
      playerState.playlist = list; playerState.playlistIndex = list.indexOf(song);
    }
    await playSong(song);
  };
  document.getElementById('songCtxQueue').onclick = () => { hideSongCtx(); addToQueue(song); };
  document.getElementById('songCtxAddPl').onclick = () => { hideSongCtx(); addSongToPlaylistFlow(song); };

  const artistItem = document.getElementById('songCtxArtist');
  artistItem.style.display = song.artistId ? 'flex' : 'none';
  artistItem.onclick = () => { hideSongCtx(); loadArtistView({ id: song.artistId, name: song.artist }); };

  const albumItem = document.getElementById('songCtxAlbum');
  albumItem.style.display = song.albumId ? 'flex' : 'none';
  albumItem.onclick = () => { hideSongCtx(); loadAlbumView(song.albumId, song.album); };

  const favItem = document.getElementById('songCtxFav');
  const isFav = isFavorite(song.id);
  favItem.innerHTML = `<i class="ti ${isFav ? 'ti-heart-filled' : 'ti-heart'}"></i> ${isFav ? 'Remove from Favorites' : 'Add to Favorites'}`;
  favItem.onclick = () => {
    hideSongCtx();
    if (isFavorite(song.id)) removeFavorite(song.id); else addFavorite(song);
    updateFavBadge();
    SFX.play('star');
  };

  const loginItem = document.getElementById('songCtxLogin');
  const existingLogin = getLoginSong();
  const isLogin = existingLogin && existingLogin.id === song.id;
  loginItem.innerHTML = `<i class="ti ${isLogin ? 'ti-star-filled' : 'ti-star'}"></i> ${isLogin ? 'Clear Login Song' : 'Set as Login Song'}`;
  loginItem.onclick = () => {
    hideSongCtx();
    if (isLogin) { clearLoginSong(); showToast('Login song cleared'); }
    else { setLoginSong(song); showToast(`"${song.title}" set as login song ★`); }
  };

  // Label the original with what it actually is ("Download FLAC"), since
  // that's the whole reason someone would pick it over the MP3. The MP3
  // row hides when the file already is one — transcoding mp3 to mp3 just
  // costs quality.
  const suffix = (song.suffix || '').toLowerCase();
  const dlItem = document.getElementById('songCtxDownload');
  dlItem.innerHTML = `<i class="ti ti-download"></i> Download${suffix ? ' ' + suffix.toUpperCase() : ''}`;
  dlItem.onclick = () => { hideSongCtx(); downloadSongOriginal(song); };

  const dlMp3Item = document.getElementById('songCtxDownloadMp3');
  dlMp3Item.style.display = suffix === 'mp3' ? 'none' : 'flex';
  dlMp3Item.onclick = () => { hideSongCtx(); downloadSongMp3(song); };

  const z = zoomFactor();
  songCtxMenu.style.left = Math.min(x / z, window.innerWidth / z - 200) + 'px';
  // Show it first: the menu is display:none until .visible lands, and a
  // display:none element measures 0, so the clamp below has to come after.
  // The height isn't a constant any more anyway — the MP3 row drops out
  // for files that already are MP3s.
  songCtxMenu.classList.add('visible');
  songCtxMenu.style.top = Math.max(8,
    Math.min(y / z, window.innerHeight / z - songCtxMenu.offsetHeight - 12)) + 'px';
}
document.addEventListener('click', e => { if (!songCtxMenu.contains(e.target)) hideSongCtx(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideSongCtx(); });

// Player dock — right-click anywhere on it for the full menu on whatever's
// currently playing, instead of just the one login-song shortcut this
// used to be.
document.getElementById('playerDock').addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!playerState.currentSong) return;
  showSongCtx(e.clientX, e.clientY, playerState.currentSong);
});

// ══════════════════════════════════════════
//  WIRE NEW TABS TO PICKER
// ══════════════════════════════════════════
const _origLoadPickerTabNew = loadPickerTab;

// ── Songs browser ──
// Default ("library order") stays the original fast path: fetch one page,
// render it, fetch more as the user scrolls near the bottom — a library of
// thousands of songs never has to load in full just to open the tab.
// Picking an actual sort order is an explicit, opt-in trade: it fetches the
// whole library once (caching it) so the sort is global, then renders the
// sorted result in the same chunk-by-chunk way so a low-power device still
// only ever has a page's worth of DOM nodes at a time.
const _SONGS_PER_PAGE = 100;
let _songsOffset = 0;
let _songsObserver = null;
let _songsCache = null;

async function _fetchSongsPage(offset) {
  const res  = await fetchTimeout(`${ND_URL}/rest/search3?query=%20&songCount=${_SONGS_PER_PAGE}&songOffset=${offset}&albumCount=0&artistCount=0&${subsonicParams()}`, {}, 8000);
  const data = await res.json();
  return data['subsonic-response']?.searchResult3?.song || [];
}

async function loadAllSongs() {
  if (_songsObserver) { _songsObserver.disconnect(); _songsObserver = null; }
  pickerList.innerHTML = '<div class="picker-empty">loading songs...</div>';
  showSortBtn('songs');
  try {
    if (getSort('songs') === 'default') {
      await loadSongsIncremental();
    } else {
      if (!_songsCache) {
        const all = [];
        let offset = 0;
        // Capped for the same reason as loadAlbums() above — 200 pages is
        // 20,000 songs, well beyond any real library.
        for (let page_i = 0; page_i < 200; page_i++) {
          const page = await _fetchSongsPage(offset);
          all.push(...page);
          if (page.length < _SONGS_PER_PAGE) break;
          offset += _SONGS_PER_PAGE;
          if (page_i === 199) showToast('song list may be incomplete — hit the page limit');
        }
        _songsCache = all;
      }
      renderSongsTabSorted();
    }
  } catch(e) { pickerList.innerHTML = '<div class="picker-empty">failed to load songs</div>'; }
}

// Fast path — one page at a time, straight from the network, in server order.
async function loadSongsIncremental() {
  _songsOffset = 0;
  pickerList.innerHTML = '';
  const lbl = document.createElement('div');
  lbl.className = 'picker-section-label';
  lbl.id = '_songsLbl';
  lbl.textContent = 'All Songs';
  pickerList.appendChild(lbl);

  const first = await _fetchSongsPage(0);
  pickerSongs = [...first];
  renderSongItems(first, pickerList);
  _songsOffset = first.length;

  if (first.length < _SONGS_PER_PAGE) { lbl.textContent = `All Songs (${_songsOffset})`; return; }

  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'height:1px;';
  pickerList.appendChild(sentinel);

  _songsObserver = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting) return;
    _songsObserver.unobserve(sentinel);
    const more = await _fetchSongsPage(_songsOffset);
    if (!more.length) { sentinel.remove(); lbl.textContent = `All Songs (${_songsOffset})`; return; }
    pickerSongs = [...pickerSongs, ...more];
    sentinel.remove();
    renderSongItems(more, pickerList);
    _songsOffset += more.length;
    if (more.length === _SONGS_PER_PAGE) { pickerList.appendChild(sentinel); _songsObserver.observe(sentinel); }
    else lbl.textContent = `All Songs (${_songsOffset})`;
  }, { root: pickerList, rootMargin: '80px' });

  _songsObserver.observe(sentinel);
}

// Sorted path — the whole (cached) library, rendered in chunks as the user scrolls.
function renderSongsTabSorted() {
  if (_songsObserver) { _songsObserver.disconnect(); _songsObserver = null; }
  const sorted = applySort(_songsCache || [], 'songs');
  pickerSongs = sorted;
  pickerList.innerHTML = '';

  const lbl = document.createElement('div');
  lbl.className = 'picker-section-label';
  lbl.id = '_songsLbl';
  lbl.textContent = `All Songs (${sorted.length})`;
  pickerList.appendChild(lbl);

  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'height:1px;';
  let rendered = 0;

  const renderChunk = () => {
    const next = sorted.slice(rendered, rendered + _SONGS_PER_PAGE);
    renderSongItems(next, pickerList);
    rendered += next.length;
    if (rendered >= sorted.length) { if (sentinel.isConnected) sentinel.remove(); return; }
    pickerList.appendChild(sentinel);
    _songsObserver.observe(sentinel);
  };

  _songsObserver = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    _songsObserver.unobserve(sentinel);
    sentinel.remove();
    renderChunk();
  }, { root: pickerList, rootMargin: '80px' });

  renderChunk();
}

loadPickerTab = async function(tab) {
  if (tab === 'songs')     { pickerTab = tab; await loadAllSongs(); return; }
  if (tab === 'genres')    { pickerTab = tab; await loadGenres(); return; }
  return _origLoadPickerTabNew(tab);
};

// Hide the sort control by default on every tab switch — whichever branch
// above actually renders a sortable list turns it back on for itself.
const _origLoadPickerTabSort = loadPickerTab;
loadPickerTab = async function(tab) {
  hideSortBtn();
  // Outermost wrapper — every tab switch funnels through here regardless
  // of which inner layer above actually ends up rendering it, so this is
  // the one place that reliably turns grid mode on/off no matter which
  // tab you're coming from. Reuses the existing .picker-item DOM
  // (renderAlbumList()/renderArtistList()/renderArtistSearchResults(),
  // none of which needed to change) — this just reflows it via CSS.
  pickerList.classList.toggle('picker-list-grid', tab === 'albums' || tab === 'artists');
  return _origLoadPickerTabSort(tab);
};

// ══════════════════════════════════════════
//  MUSIC REQUESTS — "please add this album/song", with MusicBrainz search
//  for real metadata/cover art instead of a blind text box. Requester shown
//  via window.klabResolveUserAvatar (see the FEED module's own avatar
//  cache, exposed there for exactly this kind of outside reuse).
// ══════════════════════════════════════════
let _musicRequests = [];

const _origLoadPickerTabRequests = loadPickerTab;
loadPickerTab = async function(tab) {
  if (tab === 'requests') {
    // This patch is the outermost wrapper now (defined after the grid-
    // toggle/hideSortBtn patch below it in the file), so a request tab
    // switch never reaches that patch's own bookkeeping — replicated here
    // rather than delegating, since Requests has no sortable content and
    // is never a grid view.
    hideSortBtn();
    pickerList.classList.remove('picker-list-grid');
    pickerTab = tab;
    await loadMusicRequestsTab();
    return;
  }
  return _origLoadPickerTabRequests(tab);
};

async function fetchMusicRequests() {
  try {
    const res = await fetchTimeout('/api/music-requests', {}, 8000);
    const data = await res.json();
    _musicRequests = data.requests || [];
  } catch (e) { /* leave whatever was last fetched in place */ }
  updateRequestsBadge();
}

async function loadMusicRequestsTab() {
  pickerList.innerHTML = '<div class="picker-empty">loading...</div>';
  await fetchMusicRequests();
  renderMusicRequestsList();
}

function updateRequestsBadge() {
  const el = document.getElementById('requestsCount');
  if (!el) return;
  const pending = _musicRequests.filter(r => r.status === 'pending').length;
  el.textContent = pending ? `(${pending})` : '';
}

function musicRequestRowHTML(req, avatarUrl) {
  const isAdmin = !!window.KLAB_USER?.is_admin;
  const me = window.KLAB_USER?.username;
  const canDelete = req.username === me || isAdmin;
  const typeIcon = req.req_type === 'song' ? 'ti-music' : 'ti-disc';
  const artHTML = req.cover_art_url
    ? `<img class="picker-item-art" src="${esc(req.cover_art_url)}" alt="" loading="lazy" onerror="klabArtFallback(this,'picker-item-art-ph','${typeIcon}')" />`
    : `<div class="picker-item-art-ph"><i class="ti ${typeIcon}"></i></div>`;
  const avatarInner = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="" />` : esc((req.username || '?')[0].toUpperCase());
  let statusHTML = '';
  if (req.status === 'fulfilled') statusHTML = '<span class="type-badge fulfilled">fulfilled</span>';
  else if (req.status === 'dismissed') statusHTML = '<span class="type-badge dismissed">dismissed</span>';
  let actionsHTML = '';
  if (req.status === 'pending' && isAdmin) {
    actionsHTML += `<button class="picker-action" title="Mark fulfilled" data-req-status="fulfilled" data-req-id="${req.id}"><i class="ti ti-check"></i></button>`;
    actionsHTML += `<button class="picker-action" title="Dismiss" data-req-status="dismissed" data-req-id="${req.id}"><i class="ti ti-x"></i></button>`;
  }
  if (canDelete) {
    actionsHTML += `<button class="picker-action" title="Delete request" data-req-delete="${req.id}"><i class="ti ti-trash"></i></button>`;
  }
  return `<div class="picker-item" style="cursor:default;">
    ${artHTML}
    <div class="picker-item-info">
      <div class="picker-item-title">${esc(req.title)} <span class="type-badge ${req.req_type}">${req.req_type}</span> ${statusHTML}</div>
      <div class="picker-item-artist">${esc(req.artist || 'Unknown artist')}</div>
    </div>
    <div class="picker-item-requester" data-username="${esc(req.username)}" title="Requested by ${esc(req.username)}">${avatarInner}</div>
    <div class="picker-item-actions">${actionsHTML}</div>
  </div>`;
}

function renderMusicRequestsList() {
  updateRequestsBadge();
  if (pickerTab !== 'requests') return;
  const newBtnHTML = `<button class="music-new-playlist-btn" id="musicNewRequestBtn" type="button" style="margin-bottom:10px;"><i class="ti ti-plus"></i> New Request</button>`;
  let anyUnresolvedAvatar = false;
  const rowsHTML = _musicRequests.map(req => {
    const avatarUrl = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(req.username) : null;
    if (!avatarUrl) anyUnresolvedAvatar = true;
    return musicRequestRowHTML(req, avatarUrl);
  }).join('');
  pickerList.innerHTML = newBtnHTML + (_musicRequests.length ? rowsHTML : '<div class="picker-empty">no requests yet</div>');
  document.getElementById('musicNewRequestBtn')?.addEventListener('click', openMusicRequestModal);
  pickerList.querySelectorAll('[data-req-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const res = await fetchTimeout(`/api/music-requests/${btn.dataset.reqId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: btn.dataset.reqStatus }),
        }, 8000);
        if (!res.ok) throw new Error('failed');
        SFX && SFX.play('click');
        await loadMusicRequestsTab();
      } catch (e) { showToast('Failed to update request'); }
    });
  });
  pickerList.querySelectorAll('[data-req-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirmDialog('// delete request', 'Remove this request?', 'Delete');
      if (!ok) return;
      try {
        const res = await fetchTimeout(`/api/music-requests/${btn.dataset.reqDelete}`, { method: 'DELETE' }, 8000);
        if (!res.ok) throw new Error('failed');
        await loadMusicRequestsTab();
      } catch (e) { showToast('Failed to delete request'); }
    });
  });
  // window.klabResolveUserAvatar only re-renders the FEED module on a cache
  // miss resolving (see its own comment) — this tab needs its own nudge to
  // pick up a newly-resolved requester avatar instead of showing the
  // fallback initial forever.
  if (anyUnresolvedAvatar) setTimeout(() => { if (pickerTab === 'requests') renderMusicRequestsList(); }, 900);
}

function openMusicRequestModal() {
  let reqType = 'album';
  openChatModal('// request music', `
    <div class="music-req-type-toggle">
      <button type="button" class="music-req-type-btn active" data-req-type="album">Album</button>
      <button type="button" class="music-req-type-btn" data-req-type="song">Song</button>
    </div>
    <div class="chat-modal-search"><i class="ti ti-search"></i><input type="text" id="musicReqSearch" placeholder="search musicbrainz..." autocomplete="off" /></div>
    <div class="chat-modal-list" id="musicReqResults"></div>
  `);
  const searchEl = document.getElementById('musicReqSearch');
  const listEl   = document.getElementById('musicReqResults');
  let debounceTimer = null;
  let searchToken   = 0;

  document.querySelectorAll('.music-req-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.music-req-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reqType = btn.dataset.reqType;
      if (searchEl.value.trim()) doSearch(searchEl.value.trim());
    });
  });

  async function doSearch(q) {
    const myToken = ++searchToken;
    listEl.innerHTML = '<div class="picker-empty">searching...</div>';
    try {
      const res = await fetchTimeout(`/api/music-requests/search?q=${encodeURIComponent(q)}&type=${reqType}`, {}, 8000);
      const data = await res.json();
      if (myToken !== searchToken) return; // superseded by a newer keystroke/type toggle
      // res.ok was never checked here — a backend error (502 from a
      // rate-limited MusicBrainz call, timeout, etc.) still has a JSON
      // body, just without a `results` key, so `data.results || []`
      // silently rendered as an empty "no results" state instead of the
      // "search failed" error message below. This is what a real (but
      // transient) MusicBrainz 503 looked like from the outside: no error
      // shown, just nothing found.
      if (!res.ok) throw new Error(data.error || 'search failed');
      renderResults(data.results || []);
    } catch (e) {
      if (myToken !== searchToken) return;
      listEl.innerHTML = '<div class="picker-empty">search failed — try again in a moment</div>';
    }
  }

  function renderResults(results) {
    if (!results.length) { listEl.innerHTML = '<div class="picker-empty">no results</div>'; return; }
    listEl.innerHTML = '';
    const typeIcon = reqType === 'song' ? 'ti-music' : 'ti-disc';
    results.forEach(r => {
      const row = document.createElement('div');
      row.className = 'chat-modal-row';
      row.innerHTML =
        (r.cover_art_url
          ? `<img class="chat-modal-row-art" src="${esc(r.cover_art_url)}" alt="" loading="lazy" onerror="klabArtFallback(this,'chat-modal-row-art-ph','${typeIcon}')" />`
          : `<div class="chat-modal-row-art-ph"><i class="ti ${typeIcon}"></i></div>`) +
        '<div class="chat-modal-row-info">' +
          `<div class="chat-modal-row-name">${esc(r.title)}</div>` +
          `<div class="chat-modal-row-sub">${esc(r.artist)}${r.year ? ' · ' + esc(r.year) : ''}</div>` +
        '</div>' +
        '<button class="chat-modal-row-btn" type="button">Request</button>';
      row.querySelector('button').addEventListener('click', async () => {
        const btn = row.querySelector('button');
        btn.disabled = true;
        try {
          const res = await fetchTimeout('/api/music-requests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ req_type: reqType, title: r.title, artist: r.artist, mbid: r.mbid, cover_art_url: r.cover_art_url }),
          }, 8000);
          if (!res.ok) throw new Error('failed');
          closeChatModal();
          showToast(`Requested "${r.title}"`);
          SFX && SFX.play('star');
          await loadMusicRequestsTab();
        } catch (e) {
          showToast('Failed to submit request');
          btn.disabled = false;
        }
      });
      listEl.appendChild(row);
    });
  }

  searchEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchEl.value.trim();
    if (!q) { listEl.innerHTML = ''; return; }
    debounceTimer = setTimeout(() => doSearch(q), 400);
  });
  searchEl.focus();
}

// ══════════════════════════════════════════
//  PICKER SORTING
// ══════════════════════════════════════════
const SORT_KEY = 'klabnet_picker_sort';
const SORT_OPTIONS = {
  songs:     [['default','Library Order'], ['title-asc','Title (A–Z)'], ['title-desc','Title (Z–A)'], ['artist-asc','Artist (A–Z)'], ['album-asc','Album (A–Z)']],
  favorites: [['added-desc','Recently Added'], ['title-asc','Title (A–Z)'], ['title-desc','Title (Z–A)'], ['artist-asc','Artist (A–Z)']],
  albums:    [['name-asc','Name (A–Z)'], ['name-desc','Name (Z–A)'], ['artist-asc','Artist (A–Z)'], ['year-desc','Year (Newest)'], ['year-asc','Year (Oldest)']],
  playlists: [['name-asc','Name (A–Z)'], ['name-desc','Name (Z–A)'], ['created-desc','Recently Created']],
  genres:    [['name-asc','Name (A–Z)'], ['count-desc','Most Songs']],
};

let _pickerSortState = {};
try { _pickerSortState = JSON.parse(localStorage.getItem(SORT_KEY) || '{}'); } catch(e) { _pickerSortState = {}; }

function getSort(tab) {
  const opts = SORT_OPTIONS[tab];
  if (!opts) return null;
  return _pickerSortState[tab] || opts[0][0];
}
function setSort(tab, val) {
  _pickerSortState[tab] = val;
  localStorage.setItem(SORT_KEY, JSON.stringify(_pickerSortState));
}

function applySort(items, tab) {
  const key = getSort(tab);
  const arr = items.slice();
  const cmp = (a, b) => String(a).localeCompare(String(b));
  // Genres store their label in `value`, not `name`.
  const nameOf = x => tab === 'genres' ? x.value : x.name;
  switch (key) {
    case 'title-desc':   return arr.sort((a, b) => cmp(b.title, a.title));
    case 'artist-asc':   return arr.sort((a, b) => cmp(a.artist, b.artist));
    case 'album-asc':    return arr.sort((a, b) => cmp(a.album, b.album));
    case 'added-desc':   return arr; // songs/favorites are already stored newest-first
    case 'name-desc':    return arr.sort((a, b) => cmp(nameOf(b), nameOf(a)));
    case 'year-desc':    return arr.sort((a, b) => (b.year||0) - (a.year||0));
    case 'year-asc':     return arr.sort((a, b) => (a.year||0) - (b.year||0));
    case 'created-desc': return arr.sort((a, b) => new Date(b.created||0) - new Date(a.created||0));
    case 'count-desc':   return arr.sort((a, b) => (b.songCount||0) - (a.songCount||0));
    case 'title-asc':    return arr.sort((a, b) => cmp(a.title, b.title));
    case 'name-asc':     return arr.sort((a, b) => cmp(nameOf(a), nameOf(b)));
    default:
      return arr;
  }
}

function showSortBtn(tab) {
  const btn = document.getElementById('pickerSortBtn');
  if (btn) btn.classList.toggle('shown', !!SORT_OPTIONS[tab]);
}
function hideSortBtn() {
  const btn = document.getElementById('pickerSortBtn');
  if (btn) btn.classList.remove('shown');
  document.getElementById('sortMenu')?.classList.remove('visible');
}

function rerenderSortedTab() {
  if (pickerTab === 'songs')          loadAllSongs();
  else if (pickerTab === 'albums')    renderAlbumList(applySort(_albumsCache || [], 'albums'));
  else if (pickerTab === 'favorites') loadPickerTab('favorites');
  else if (pickerTab === 'genres')    loadGenres();
}

document.getElementById('pickerSortBtn').addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('sortMenu');
  const opts = SORT_OPTIONS[pickerTab];
  if (!opts) return;
  if (menu.classList.contains('visible')) { menu.classList.remove('visible'); return; }
  const current = getSort(pickerTab);
  menu.innerHTML = '<div class="ctx-label">Sort by</div>' + opts.map(([key, label]) =>
    `<div class="ctx-item" data-sort-key="${key}"><i class="ti ${key === current ? 'ti-check' : ''}" style="width:15px;"></i> ${label}</div>`
  ).join('');
  menu.querySelectorAll('[data-sort-key]').forEach(el => {
    el.addEventListener('click', () => {
      setSort(pickerTab, el.dataset.sortKey);
      menu.classList.remove('visible');
      SFX && SFX.play('click');
      rerenderSortedTab();
      showSortBtn(pickerTab);
    });
  });
  const r = e.currentTarget.getBoundingClientRect();
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.right = (window.innerWidth - r.right) + 'px';
  menu.style.left = 'auto';
  menu.classList.add('visible');
});
document.addEventListener('click', e => {
  const menu = document.getElementById('sortMenu');
  if (menu && menu.classList.contains('visible') && !menu.contains(e.target) && e.target.id !== 'pickerSortBtn') {
    menu.classList.remove('visible');
  }
});

// ══════════════════════════════════════════
//  BOOT — load settings
// ══════════════════════════════════════════
loadSettings();
applySettings();
initTabs();
// ── Album view ──────────────────────────────────────────
// backFn is accepted for call-site compatibility but unused — the panel
// (window.openAlbumPage, defined in the ARTIST/ALBUM PAGE PANEL section
// below) is always available by the time this can actually be called (its
// only guard is a static #apPanel element that's unconditionally in the
// markup), so the manual fetch-and-render fallback this used to have
// before that panel existed was dead code — traced every call site to
// confirm none of them depend on the fallback path.
async function loadAlbumView(albumId, albumName, backFn) {
  goToMusicDetail(() => window.openAlbumPage(albumId, albumName));
}

// Artist / album link delegation now lives in ensureSongRowDelegation()'s
// single #pickerList handler — .picker-link is only ever emitted by
// renderSongItem(), and having two listeners on the same element meant the
// nav ran twice once the per-row capture handler was removed.

