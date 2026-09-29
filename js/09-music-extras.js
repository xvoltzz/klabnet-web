// ══════════════════════════════════════════
//  GENRES BROWSER
// ══════════════════════════════════════════
// Built from the albums themselves, not Navidrome's genre list. That list
// keeps genres from files that have since been retagged or removed, with
// their old song counts (22 of its 33 were attached to nothing), and in
// this library genres are tagged on albums, so asking for a genre's songs
// (getSongsByGenre) came back empty even for ones that exist. Genres that
// cover exactly the same albums are one entry ("Hip-Hop · Rap").
let _genresCache = null, _genresAt = 0;
const GENRE_TTL_MS = 10 * 60 * 1000;

async function buildGenres() {
  const albums = [];
  for (let offset = 0; ; offset += 500) {
    const r = await fetchTimeout(`${ND_URL}/rest/getAlbumList2?type=alphabeticalByName&size=500&offset=${offset}&${subsonicParams()}`, {}, 12000);
    const page = (await r.json())['subsonic-response']?.albumList2?.album || [];
    albums.push(...page);
    if (page.length < 500) break;
  }
  const byGenre = new Map(); // genre -> albums
  for (const a of albums) {
    const names = (a.genres || []).map(g => g.name).filter(Boolean);
    if (!names.length && a.genre) names.push(a.genre);
    for (const n of new Set(names.map(x => x.trim()).filter(Boolean))) {
      if (!byGenre.has(n)) byGenre.set(n, []);
      byGenre.get(n).push(a);
    }
  }
  const merged = new Map(); // album-id set -> entry
  for (const [name, list] of byGenre) {
    const key = list.map(a => a.id).sort().join(',');
    if (merged.has(key)) merged.get(key).names.push(name);
    else merged.set(key, { names: [name], albums: list });
  }
  return [...merged.values()].map(e => ({
    value: e.names.sort((x, y) => x.localeCompare(y)).join(' · '),
    albums: e.albums,
    albumCount: e.albums.length,
    songCount: e.albums.reduce((n, a) => n + (a.songCount || 0), 0),
  }));
}

// Six albums at a time: all at once (hundreds, for a big genre) queued
// behind the browser's per-host limit until their timeouts fired, and
// those albums silently dropped out of the shuffle.
async function genreSongs(genre) {
  const albums = genre.albums, lists = new Array(albums.length);
  let next = 0;
  const worker = async () => {
    while (next < albums.length) {
      const i = next++;
      lists[i] = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${encodeURIComponent(albums[i].id)}&${subsonicParams()}`, {}, 8000)
        .then(r => r.json()).then(d => d['subsonic-response']?.album?.song || []).catch(() => []);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, albums.length) }, worker));
  return lists.flat();
}

function openGenreView(genre) {
  _pickerLoadToken++; clearTimeout(pickerDebounce); // see loadPickerTab
  // It's part of Genres, also when Back/Forward reopens it from another
  // section: "← Genres" (loadGenres) draws nothing unless this says so.
  pickerTab = 'genres';
  document.querySelectorAll('.picker-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'genres'));
  document.querySelectorAll('.music-playlist-row').forEach(r => r.classList.remove('active'));
  window.klabNav?.push({ tab: 'music', kind: 'genre', value: genre.value });
  hideSortBtn();
  pickerList.innerHTML = '';
  pickerList.classList.add('picker-list-grid');
  const back = document.createElement('button');
  back.className = 'picker-back';
  back.innerHTML = '<i class="ti ti-arrow-left"></i> Genres';
  back.addEventListener('click', () => {
    if (window.klabNav?.back()) return; // same as the browser's Back
    document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="genres"]').classList.add('active');
    pickerList.classList.remove('picker-list-grid');
    setMusicViewTitle('genres');
    loadGenres();
  });
  pickerList.appendChild(back);
  setMusicViewTitle('genres', genre.value);
  document.getElementById('musicViewSub').textContent = `${genre.albumCount} album${genre.albumCount === 1 ? '' : 's'} · ${genre.songCount} songs`;
  renderAlbumList(applySort(genre.albums, 'albums'), true);
}

// Reopen a genre by name (browser back/forward, see js/17-history.js).
window.klabOpenGenre = async value => {
  const t = ++_pickerLoadToken;
  try {
    if (!_genresCache) { _genresCache = await buildGenres(); _genresAt = Date.now(); }
  } catch (e) {} // offline: Genres below says it failed
  if (t !== _pickerLoadToken) return; // moved on while the library was read
  const g = _genresCache?.find(x => x.value === value);
  if (g) openGenreView(g); else loadPickerTab('genres');
};

async function loadGenres() {
  pickerList.innerHTML = '<div class="picker-empty">loading genres...</div>';
  try {
    if (!_genresCache || Date.now() - _genresAt > GENRE_TTL_MS) {
      _genresCache = await buildGenres();
      _genresAt = Date.now();
    }
    if (pickerTab !== 'genres') return; // moved on while the library was read
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
      item.className = 'picker-item genre-tile';
      let hue = 0;
      for (const ch of genre.value) hue = (hue * 31 + ch.charCodeAt(0)) >>> 0;
      item.style.setProperty('--h', hue % 360);
      item.innerHTML = `
        <div class="picker-item-art-ph" style="font-size:20px;"><i class="ti ti-music-search"></i></div>
        <div class="picker-item-info" style="min-width:0;flex:1;">
          <div class="picker-item-title">${esc(genre.value)}</div>
          <div class="picker-item-artist">${genre.albumCount} album${genre.albumCount === 1 ? '' : 's'} · ${genre.songCount} songs</div>
        </div>
        <div class="picker-item-actions" style="flex-shrink:0;">
          <button class="picker-action" title="Play genre"><i class="ti ti-player-play"></i></button>
        </div>`;

      // The tile opens the genre's albums; its play button shuffles them all.
      const open = () => openGenreView(genre);
      let busy = false;
      const play = async () => {
        if (busy) return;
        busy = true;
        let songs;
        try { songs = await genreSongs(genre); } finally { busy = false; }
        if (!songs.length) { showToast('nothing to play in ' + genre.value, 'ti-alert-triangle'); return; }
        for (let i = songs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [songs[i], songs[j]] = [songs[j], songs[i]]; }
        playerState.playlist = songs; playerState.playlistIndex = 0;
        playSong(songs[0]);
        showToast(`${genre.value} — shuffling ${songs.length} songs`, 'ti-arrows-shuffle');
      };

      item.querySelector('[title="Play genre"]').addEventListener('click', e => { e.stopPropagation(); play(); SFX && SFX.play('click'); });
      item.addEventListener('click', open);
      pickerList.appendChild(item);
    });
  } catch(e) { if (pickerTab === 'genres') pickerList.innerHTML = '<div class="picker-empty">failed to load genres</div>'; }
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
    row._playlist = pl;
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
      setMusicViewTitle('playlist', pl.name);
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
  showToast(`"${name}" created`, 'ti-playlist-add');
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
  showToast(`Added to "${pl.name}"`, toastArt(song.coverArt));
}

// renderPlaylistList() (the old generic "Playlists" browse tab) removed —
// unreachable dead code. renderPlaylistNav() replaced it: each playlist is
// now its own direct link in the sidebar, and no UI path sets
// pickerTab === 'playlists' any more (confirmed: no such tab button
// exists, only random/recent/songs/albums/artists/genres/favorites/
// queue/requests do).

function loadPlaylistView(pl) {
  _pickerLoadToken++; clearTimeout(pickerDebounce); // see loadPickerTab
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
    // The row's own song object when there is one: the attribute's copy
    // leaves out album/artist links, length and quality.
    const row = btn.closest('.picker-item');
    addSongToPlaylistFlow((row && row._song) || JSON.parse(decodeURIComponent(btn.dataset.addPl)));
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
  showToast(`Downloading "${song.title}"`, toastArt(song.coverArt));
}

let _dlMp3Busy = false;
async function downloadSongMp3(song) {
  if (!song || !song.id) return;
  // The whole file lands in memory before the browser sees any of it, so
  // don't let someone stack up five of these by spamming the menu.
  if (_dlMp3Busy) { showToast('Already preparing a download', 'ti-hourglass'); return; }
  _dlMp3Busy = true;
  let objUrl = '';
  try {
    showToast(`Converting "${song.title}" to MP3…`, 'ti-transform');
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
    showToast(`Downloaded "${song.title}" (MP3)`, toastArt(song.coverArt));
  } catch (err) {
    console.warn('[download] mp3 failed', err);
    showToast('MP3 download failed — try the original', 'ti-file-alert');
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
  showToast(`Downloading "${albumName || 'album'}" (ZIP)`, toastArt(albumId));
}

// ══════════════════════════════════════════
//  ALBUM / ARTIST / PLAYLIST MENUS — any element carrying _album,
//  _artist or _playlist gets a right-click menu, wherever it's drawn
//  (album grids, Music Home rows, an artist's discography, the sidebar).
// ══════════════════════════════════════════
async function albumSongs(albumId) {
  const r = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${encodeURIComponent(albumId)}&${subsonicParams()}`, {}, 8000);
  return (await r.json())['subsonic-response']?.album?.song || [];
}

function playSongList(songs, { shuffle = false } = {}) {
  if (!songs.length) return;
  playerState.playlist = songs;
  if (shuffle) { _shuffleOn = true; syncShuffleBtns(); }
  const i = shuffle ? Math.floor(Math.random() * songs.length) : 0;
  playerState.playlistIndex = i;
  playSong(songs[i]);
}

function klabAlbumMenu(e, album) {
  const name = album.name || album.title || 'Album';
  const withSongs = fn => async () => {
    try { fn(await albumSongs(album.id)); }
    catch { showToast('Couldn’t load that album', 'ti-alert-triangle'); }
  };
  klabMenu(e, [
    { header: name },
    { label: 'Play', icon: 'ti-player-play', action: withSongs(s => playSongList(s)) },
    { label: 'Shuffle', icon: 'ti-arrows-shuffle', action: withSongs(s => playSongList(s, { shuffle: true })) },
    { label: 'Add to queue', icon: 'ti-playlist-add', action: withSongs(s => {
      queue.push(...s); updateQueueBadge(); SFX && SFX.play('queue');
      if (pickerTab === 'queue') renderQueueList(); // this menu can open over the Queue view
      showToast('Queued ' + s.length + ' tracks', toastArt(album.coverArt || album.id));
    }) },
    '-',
    { label: 'Open album', icon: 'ti-disc', action: () => loadAlbumView(album.id, name) },
    { label: 'Go to artist', icon: 'ti-microphone-2', hidden: !album.artistId, action: () => loadArtistView({ id: album.artistId, name: album.artist }) },
    { label: 'View cover', icon: 'ti-photo', hidden: !(album.coverArt || album.id), action: () => viewCover(album.coverArt || album.id, name, null, { albumId: album.id, artist: album.artist || '', album: name }) },
    '-',
    { label: 'Download (ZIP)', icon: 'ti-download', action: () => downloadAlbumZip(album.id, name) },
  ]);
}

// ── High-resolution album art, for display ──
// klabnet-api finds the same cover at high resolution in an outside
// catalogue (see its /api/music-requests/artwork). Only ever shown on top:
// Navidrome's own art, files and "last added" are left exactly as they are.
// Remembered per album on this device, misses too for a week; an API
// that doesn't have the endpoint yet just means Navidrome's art.
// v2: the art is kept on our own server now; v1 held the catalogues' links.
const HIRES_KEY = 'klabnet_hires_art2';
try { localStorage.removeItem('klabnet_hires_art'); } catch (e) {}
let _hiresStore = null, _hiresOff = false, _hiresSaveT = 0;
const _hiresPending = new Map();
function hiresStore() {
  if (!_hiresStore) { try { _hiresStore = JSON.parse(localStorage.getItem(HIRES_KEY)) || {}; } catch { _hiresStore = {}; } }
  return _hiresStore;
}
function hiresSave() {
  clearTimeout(_hiresSaveT);
  _hiresSaveT = setTimeout(() => {
    const st = hiresStore(), keys = Object.keys(st);
    if (keys.length > 800) keys.sort((a, b) => st[a].t - st[b].t).slice(0, keys.length - 800).forEach(k => delete st[k]);
    try { localStorage.setItem(HIRES_KEY, JSON.stringify(st)); } catch (e) {}
  }, 1500);
}
// The artist to match on: the album's, not a track's featured guests.
const albumArtistOf = s => s.albumArtist || s.displayAlbumArtist || (Array.isArray(s.albumArtists) && s.albumArtists[0]?.name) || s.artist || '';
function klabHiResArtCached(o) {
  const hit = o && hiresStore()[o.albumId || (o.artist + '|' + o.album)];
  return hit && hit.l ? { large: hit.l, full: hit.f } : null;
}
function klabHiResArt(o) {
  if (_hiresOff || !o || !o.album || !o.artist) return Promise.resolve(null);
  const key = o.albumId || (o.artist + '|' + o.album);
  const st = hiresStore(), hit = st[key];
  if (hit && (hit.l || Date.now() - hit.t < 7 * 864e5)) return Promise.resolve(hit.l ? { large: hit.l, full: hit.f } : null);
  if (_hiresPending.has(key)) return _hiresPending.get(key);
  const qs = new URLSearchParams({ artist: o.artist, album: o.album, mbid: o.mbid || '' });
  const p = fetchTimeout('/api/music-requests/artwork?' + qs, {}, 15000)
    .then(r => {
      if (r.status === 404 || r.status === 405 || r.status === 422) { _hiresOff = true; return null; }
      return r.ok ? r.json() : null;
    })
    .then(d => {
      if (!d) return null;
      // Only our own copies are remembered: a catalogue's link (handed out
      // while the media share is offline) is asked about again next time.
      if ((d.large && d.large.startsWith('/')) || d.source === 'none') { st[key] = { l: d.large || '', f: d.full || '', t: Date.now() }; hiresSave(); }
      return d.large ? { large: d.large, full: d.full } : null;
    })
    .catch(() => null)
    .finally(() => _hiresPending.delete(key));
  _hiresPending.set(key, p);
  return p;
}
window.klabHiResArt = klabHiResArt;
window.klabAlbumArtistOf = albumArtistOf;

// A cover, nearly full screen: the viewer opens on the copy already on
// screen and sharpens to the original when it arrives.
// meta ({ albumId, artist, album }), when known, looks for it at high
// resolution first (briefly: a slow lookup opens Navidrome's original).
async function viewCover(coverId, alt, shownSrc, meta) {
  if (!coverId) return;
  const url = size => `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(coverId)}${size ? '&size=' + size : ''}&${subsonicParams()}`;
  SFX && SFX.play('open');
  let hi = meta ? klabHiResArtCached(meta) : null;
  if (meta && !hi) hi = await Promise.race([klabHiResArt(meta), new Promise(r => setTimeout(() => r(null), 700))]);
  openImageViewer({ thumbSrc: shownSrc || url(600), fullSrc: hi?.full || url(0), alt: alt || '', framed: true });
}
document.addEventListener('click', e => {
  const img = e.target.closest?.('img[data-cover], img[data-view-full]');
  if (!img || img.naturalWidth === 0) return;
  e.stopPropagation();
  const meta = img.dataset.album ? { albumId: img.dataset.albumId || '', artist: img.dataset.artist || '', album: img.dataset.album } : null;
  if (img.dataset.cover) viewCover(img.dataset.cover, img.alt, img.currentSrc || img.src, meta);
  else { SFX && SFX.play('open'); openImageViewer({ thumbSrc: img.currentSrc || img.src, alt: img.alt || '', framed: true }); }
}, true);

function klabArtistMenu(e, artist) {
  klabMenu(e, [
    { header: artist.name || 'Artist' },
    { label: 'Open artist', icon: 'ti-microphone-2', action: () => loadArtistView(artist) },
    { label: 'Copy name', icon: 'ti-copy', action: () => klabCopy(artist.name, 'Artist name') },
  ]);
}

function klabPlaylistMenu(e, pl, row) {
  const n = pl.songs.length;
  klabMenu(e, [
    { header: pl.name },
    { label: 'Play', icon: 'ti-player-play', hidden: !n, action: () => playSongList([...pl.songs]) },
    { label: 'Shuffle', icon: 'ti-arrows-shuffle', hidden: !n, action: () => playSongList([...pl.songs], { shuffle: true }) },
    { label: 'Add to queue', icon: 'ti-playlist-add', hidden: !n, action: () => {
      queue.push(...pl.songs); updateQueueBadge(); SFX && SFX.play('queue');
      if (pickerTab === 'queue') renderQueueList(); // the sidebar is beside the Queue view
      showToast('Queued ' + n + ' tracks', 'ti-playlist-add');
    } },
    '-',
    { label: 'Open', icon: 'ti-playlist', action: () => row.click() },
    { label: 'Rename', icon: 'ti-pencil', action: async () => {
      const name = await showInputDialog('// rename playlist', '', 'Playlist name', pl.name);
      if (!name || name === pl.name) return;
      const wasActive = row.classList.contains('active');
      const pls = getPlaylists();
      const p = pls.find(x => x.id === pl.id);
      if (!p) return;
      p.name = name;
      savePlaylists(pls); // redraws the sidebar
      if (wasActive) {
        document.querySelector(`.music-playlist-row[data-pl-id="${CSS.escape(pl.id)}"]`)?.classList.add('active');
        setMusicViewTitle('playlist', name);
      }
    } },
    '-',
    { label: 'Delete playlist', icon: 'ti-trash', warn: true, action: () => row.querySelector('.music-playlist-row-del')?.click() },
  ]);
}

document.addEventListener('contextmenu', e => {
  for (let n = e.target; n && n !== document.body; n = n.parentElement) {
    if (n._album) { klabAlbumMenu(e, n._album); return; }
    if (n._artist) { klabArtistMenu(e, n._artist); return; }
    if (n._playlist) { klabPlaylistMenu(e, n._playlist, n); return; }
  }
});

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

  const starItem = document.getElementById('songCtxStar');
  const starred = klabStars.get('song:' + song.id).mine;
  starItem.innerHTML = `<i class="ti ${starred ? 'ti-star-filled' : 'ti-star'}"></i> ${starred ? 'Unstar' : 'Star'}`;
  starItem.onclick = () => { hideSongCtx(); klabStars.toggle('song:' + song.id); };

  const loginItem = document.getElementById('songCtxLogin');
  const existingLogin = getLoginSong();
  const isLogin = existingLogin && existingLogin.id === song.id;
  loginItem.innerHTML = `<i class="ti ${isLogin ? 'ti-door-exit' : 'ti-door-enter'}"></i> ${isLogin ? 'Clear Login Song' : 'Set as Login Song'}`;
  loginItem.onclick = () => {
    hideSongCtx();
    if (isLogin) { clearLoginSong(); showToast('Login song cleared', 'ti-door-exit'); }
    else { setLoginSong(song); showToast(`"${song.title}" set as login song`, toastArt(song.coverArt)); }
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
          if (page_i === 199) showToast('song list may be incomplete — hit the page limit', 'ti-list-details');
        }
        _songsCache = all;
      }
      if (pickerTab !== 'songs') return;
      renderSongsTabSorted();
    }
  } catch(e) { if (pickerTab === 'songs') pickerList.innerHTML = '<div class="picker-empty">failed to load songs</div>'; }
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
  if (pickerTab !== 'songs' || !lbl.isConnected) return;
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
    let more;
    // One failed page used to end the list for good; it tries again when
    // the bottom comes back into view.
    try { more = await _fetchSongsPage(_songsOffset); }
    catch (e) { if (sentinel.isConnected) setTimeout(() => sentinel.isConnected && _songsObserver.observe(sentinel), 3000); return; }
    if (pickerTab !== 'songs' || !sentinel.isConnected) return; // another view by now
    if (!more.length) { sentinel.remove(); lbl.textContent = `All Songs (${_songsOffset})`; return; }
    // In place: a song playing from this list keeps the same array as its
    // playlist, so it plays on into the pages loaded after it.
    pickerSongs.push(...more);
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
  // These never reach 03's wrapper, which is what stops a view still
  // loading (Home's picks, a search, a keystroke waiting to search) from
  // drawing over this one once it arrives: done here for them.
  if (tab === 'songs' || tab === 'genres') { _pickerLoadToken++; clearTimeout(pickerDebounce); }
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
  pickerList.classList.toggle('mh-home', tab === 'random');
  setMusicViewTitle(tab);
  return _origLoadPickerTabSort(tab);
};

// ══════════════════════════════════════════
//  MUSIC REQUESTS — "please add this album/song", with MusicBrainz search
//  for real metadata/cover art instead of a blind text box. Requester shown
//  via window.klabResolveUserAvatar (see the FEED module's own avatar
//  cache, exposed there for exactly this kind of outside reuse).
// ══════════════════════════════════════════
let _musicRequests = [];
let _reqAvatarTries = 0;

const _origLoadPickerTabRequests = loadPickerTab;
loadPickerTab = async function(tab) {
  if (tab === 'requests') {
    // This patch is the outermost wrapper now (defined after the grid-
    // toggle/hideSortBtn patch below it in the file), so a request tab
    // switch never reaches that patch's own bookkeeping — replicated here
    // rather than delegating, since Requests has no sortable content and
    // is never a grid view.
    hideSortBtn();
    pickerList.classList.remove('picker-list-grid', 'mh-home'); // Home's layout stayed on when you came from Home
    _pickerLoadToken++; clearTimeout(pickerDebounce); // see the songs/genres wrapper
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
  _reqAvatarTries = 0;
  pickerList.innerHTML = '<div class="picker-empty">loading...</div>';
  await fetchMusicRequests();
  if (pickerTab !== 'requests') return;
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
      <div class="picker-item-title">${esc(req.title)} <span class="type-badge ${req.req_type === 'song' ? 'song' : 'album'}">${req.req_type === 'song' ? 'song' : 'album'}</span> ${statusHTML}</div>
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
      } catch (e) { showToast('Failed to update request', 'ti-alert-triangle'); }
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
      } catch (e) { showToast('Failed to delete request', 'ti-trash-x'); }
    });
  });
  // window.klabResolveUserAvatar only re-renders the FEED module on a cache
  // miss resolving (see its own comment) — this tab needs its own nudge to
  // pick up a newly-resolved requester avatar instead of showing the
  // fallback initial forever.
  // A few tries, not forever: a user with no avatar stays unresolved, and
  // this used to rebuild the list every 900ms for as long as it was open.
  if (anyUnresolvedAvatar && _reqAvatarTries++ < 5) setTimeout(() => { if (pickerTab === 'requests') renderMusicRequestsList(); }, 900);
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
          showToast(`Requested "${r.title}"`, r.cover_art_url ? { art: r.cover_art_url } : 'ti-music-plus');
          SFX && SFX.play('star');
          await loadMusicRequestsTab();
        } catch (e) {
          showToast('Failed to submit request', 'ti-music-x');
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
  anchorPanelUnder(menu, e.currentTarget, 6); // zoom-aware (see 00-util.js)
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
syncMotdToggle();
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



// ══════════════════════════════════════════
//  MUSIC VIEW TITLE — the big heading above whatever the sidebar opened.
//  Each view still renders its own small section label first ("Albums
//  (505)", "All Songs"); when that label just repeats the title it's hidden
//  and its count moves up beside the title. Artist letter groups ("#", "A")
//  and Home's own sections are left alone.
// ══════════════════════════════════════════
const MUSIC_VIEW_TITLES = {
  recent: 'Recently played', songs: 'Songs', albums: 'Albums', artists: 'Artists', genres: 'Genres',
  favorites: 'Favorites', queue: 'Queue', requests: 'Requests', search: 'Search', coverflow: 'Cover Flow',
};
function musicGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const who = window.KLAB_USER?.username;
  return who && who !== 'anonymous' ? `${part}, ${who}` : part;
}
function setMusicViewTitle(tab, title) {
  const t = document.getElementById('musicViewTitle');
  if (!t) return;
  t.textContent = title || (tab === 'random' ? musicGreeting() : MUSIC_VIEW_TITLES[tab] || '');
  document.getElementById('musicViewSub').textContent = '';
}
window.setMusicViewTitle = setMusicViewTitle;
// Straight from the sidebar too: some views (Requests) load through their
// own wrapper around loadPickerTab and never reach the one above.
document.querySelectorAll('.picker-tab').forEach(t => t.addEventListener('click', () => setMusicViewTitle(t.dataset.tab)));
(function() {
  const list = document.getElementById('pickerList');
  const sub = document.getElementById('musicViewSub');
  if (!list || !sub) return;
  let queued = false;
  const sync = () => {
    queued = false;
    const first = list.firstElementChild;
    // Views that set their own subtitle (a genre's album count) keep it.
    if (!first || !first.classList.contains('picker-section-label') || list.classList.contains('mh-home')) return;
    const text = first.textContent.trim();
    const m = text.match(/^(.*?)\s*\((\d+)\)$/);
    const title = document.getElementById('musicViewTitle').textContent.trim().toLowerCase();
    const label = (m ? m[1] : text).toLowerCase();
    // Only a label that restates the title, e.g. "Albums (505)" or "All Songs"
    if (label === title || label === 'all ' + title || (pickerTab === 'recent' && label.startsWith('recently'))) {
      first.classList.add('music-dup-label');
      sub.textContent = m ? `${Number(m[2]).toLocaleString()} ${title === 'songs' ? 'songs' : title}` : '';
    }
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sync); } }).observe(list, { childList: true });
})();
