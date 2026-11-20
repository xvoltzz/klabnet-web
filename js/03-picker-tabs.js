// ══════════════════════════════════════════
//  PICKER — EXTENDED TABS
// ══════════════════════════════════════════
// Replace the existing loadPickerTab to handle new tabs
const _origLoadPickerTab = loadPickerTab;
loadPickerTab = async function(tab) {
  // Whatever was loading for the view you're leaving (Home's random picks,
  // a search, a pending search keystroke) must not draw over this one.
  _pickerLoadToken++;
  if (tab !== 'search') clearTimeout(pickerDebounce);
  // Cover Flow was a view here until 2026-10-14; a saved or linked one opens Home.
  if (tab === 'coverflow') tab = 'random';
  if (tab === 'albums') { pickerTab = tab; await loadAlbums(); return; }
  if (tab === 'artists') { pickerTab = tab; await loadArtists(); return; }
  if (tab === 'queue') { pickerTab = tab; renderQueueList(); return; }
  return _origLoadPickerTab(tab);
};

// Kept for ten minutes, like Genres: kept for the whole session, an album
// added since never showed up here in an app left running for days.
const LIBRARY_TTL_MS = 10 * 60 * 1000;
let _albumsCache = null, _albumsAt = 0, _albumsLoading = null;
// The whole library's albums, crawled once however many views ask for it
// at a time (leaving and coming back mid-crawl used to start another).
function albumsLibrary() {
  if (_albumsCache && Date.now() - _albumsAt <= LIBRARY_TTL_MS) return Promise.resolve(_albumsCache);
  return _albumsLoading ||= (async () => {
    const allAlbums = [];
    let offset = 0;
    const pageSize = 500;
    // Capped so a misbehaving server (always returns a full page) can't
    // hang this in an infinite fetch loop — 50 pages is 25,000 albums,
    // well beyond any real library.
    for (let page_i = 0; page_i < 50; page_i++) {
      const res = await fetchTimeout(`${ND_URL}/rest/getAlbumList?type=alphabeticalByName&size=${pageSize}&offset=${offset}&${subsonicParams()}`, {}, 8000);
      const data = await res.json();
      const page = data['subsonic-response']?.albumList?.album || [];
      allAlbums.push(...page);
      if (page.length < pageSize) break; // no more pages
      offset += pageSize;
      if (page_i === 49) showToast('The album list may be incomplete: it hit the page limit', 'ti-list-details');
    }
    _albumsCache = allAlbums;
    _albumsAt = Date.now();
    return allAlbums;
  })().finally(() => { _albumsLoading = null; });
}
async function loadAlbums() {
  pickerList.innerHTML = '<div class="picker-empty">Loading albums…</div>';
  const t = _pickerLoadToken;
  try {
    const albums = await albumsLibrary();
    // Moved on to another view while this loaded: it isn't ours to draw on.
    if (pickerTab !== 'albums' || t !== _pickerLoadToken) return;
    klabBrowse.render('albums'); // filtered, sorted, with the A–Z rail (js/26-browse.js)
  } catch(e) { if (pickerTab === 'albums' && t === _pickerLoadToken) pickerList.innerHTML = '<div class="picker-empty">Couldn’t load this</div>'; }
}

// Artists keep for as long as albums do; every visit fetched them again.
let _artistsCache = null, _artistsAt = 0;
async function loadArtists() {
  pickerList.innerHTML = '<div class="picker-empty">Loading…</div>';
  const t = _pickerLoadToken;
  try {
    if (!_artistsCache || Date.now() - _artistsAt > LIBRARY_TTL_MS) {
      const res = await fetchTimeout(`${ND_URL}/rest/getArtists?${subsonicParams()}`, {}, 8000);
      const data = await res.json();
      _artistsCache = data['subsonic-response']?.artists?.index || [];
      _artistsAt = Date.now();
    }
    if (pickerTab !== 'artists' || t !== _pickerLoadToken) return;
    klabBrowse.render('artists'); // find box, sort, favorites and the A–Z rail (js/26-browse.js)
  } catch(e) { if (pickerTab === 'artists' && t === _pickerLoadToken) pickerList.innerHTML = '<div class="picker-empty">Couldn’t load this</div>'; }
}

const _albumArtIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(e => {
  if (!e.isIntersecting) return;
  _albumArtIO.unobserve(e.target);
  e.target._loadArt?.();
}), { rootMargin: '400px 0px' }) : null;

function renderAlbumList(albums, appendMode) {
  if (!albums.length) { if (!appendMode) pickerList.innerHTML = '<div class="picker-empty">No albums</div>'; return; }
  if (!appendMode) {
    pickerList.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'picker-section-label';
    hdr.textContent = 'Albums (' + albums.length + ')'; // hidden: the count goes beside the title
    pickerList.appendChild(hdr);
  }

  albums.forEach(album => {
    const item = document.createElement('div');
    item.className = 'picker-item';
    item._album = album; // right-click menu (09-music-extras.js)
    item.dataset.star = 'album:' + album.id;

    // Always show placeholder immediately — swap with art when loaded
    const ph = document.createElement('div');
    ph.className = 'picker-item-art-ph';
    ph.innerHTML = '<i class="ti ti-vinyl"></i>';

    // Sized when it's fetched, from how wide its box really is: a grid tile
    // (130-250px) or a search row's small art.
    const artUrl = () => ND_URL + '/rest/getCoverArt?id=' + encodeURIComponent(album.coverArt || album.id) +
      '&size=' + klabArtSize(Math.max(ph.offsetWidth, ph.getBoundingClientRect().width) || 200) + '&' + subsonicParams();
    const artImg = new Image();
    artImg.className = 'picker-item-art';
    artImg.decoding = 'async';
    artImg.alt = '';
    artImg.onload = () => { artImg.classList.add('loaded'); ph.replaceWith(artImg); };
    // Fetched as it nears the screen: the whole library at once was ~500
    // cover requests in one burst, queued ahead of the music itself.
    item._loadArt = () => { artImg.src = artUrl(); };
    if (_albumArtIO) _albumArtIO.observe(item); else item._loadArt();

    const info = document.createElement('div');
    info.className = 'picker-item-info';
    info.innerHTML =
      '<div class="picker-item-title">' + (esc(album.name) || 'Unknown') + '</div>' +
      '<div class="picker-item-artist">' + esc(album.artist || '') +
        (album.year ? ' · ' + esc(album.year) : '') +
        ' · ' + klabCount(album.songCount || 0, 'track') + '</div>';

    // The card recipe (css "REFRESH: MUSIC"): ♥ top right, queue and ▶
    // bottom right over the cover; a row's end in a search's list.
    const actsTpl = document.createElement('template');
    actsTpl.innerHTML = window.klabMusicCards.acts('album', album.id);
    item.append(ph, info, actsTpl.content);

    const fetchTracks = () => albumSongs(album.id);
    const playBtn = item.querySelector('[data-card-play]'), queueBtn = item.querySelector('[data-card-queue]');

    playBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const mark = klabPickMark();
      let t;
      try { t = await fetchTracks(); } catch (err) { showToast('Couldn’t play "' + album.name + '"', 'ti-alert-triangle'); return; }
      if (!t.length || klabPickMark() !== mark) return;
      // The album becomes what's playing; songs you queued stay queued.
      playSongList(t);
      SFX && SFX.play('click');
    });

    queueBtn.addEventListener('click', async e => {
      e.stopPropagation();
      let t;
      try { t = await fetchTracks(); } catch (err) { showToast('Couldn’t queue "' + album.name + '"', 'ti-alert-triangle'); return; }
      queueSongs(t, { label: `"${album.name}"`, art: toastArt(album.coverArt || album.id) });
    });

    item.addEventListener('click', e => {
      if (e.target.closest('.card-acts button')) return;
      loadAlbumView(album.id, album.name, () => loadPickerTab('albums'));
    });

    pickerList.appendChild(item);
  });
}

function renderArtistSearchResults(artists) {
  artists.forEach(artist => {
    const artistId = artist.id || artist.artistId || '';
    const artistName = artist.name || artist.artist || 'Unknown artist';
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.innerHTML = `
      ${artistPlaceholderHTML(artist.name)}
      <div class="picker-item-info">
        <div class="picker-item-title">${esc(artistName)}</div>
        <div class="picker-item-artist">${klabCount(artist.albumCount || 0, 'album')}</div>
      </div>
      <div class="picker-item-actions">
        <span class="type-badge artist">artist</span>
        <button class="picker-action" title="Browse artist"><i class="ti ti-chevron-right"></i></button>
      </div>`;
    item.querySelector('[title="Browse artist"]').addEventListener('click', e => {
      e.stopPropagation();
      SFX && SFX.play('nav');
      loadArtistView({ id: artistId, name: artistName });
    });
    item.addEventListener('click', () => { SFX && SFX.play('nav'); loadArtistView({ id: artistId, name: artistName }); });
    pickerList.appendChild(item);
    queueArtistThumbHydration(item, artistId);
  });
}

// Defers hydrateArtistThumb() (2 Subsonic requests per artist) until its
// row actually scrolls near the viewport, instead of firing it for every
// row the instant the list renders — opening the Artists tab on a
// library of a couple hundred artists was firing several hundred
// concurrent requests in one burst. rootMargin pre-loads just below the
// fold so thumbnails are usually already there by the time you scroll to
// them. One shared observer, not one per render — rows removed from the
// DOM (tab switch, re-render) must be explicitly unobserved: an observer
// keeps its targets, including each row's images and event handlers.
const _artistThumbObserver = window.IntersectionObserver ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    _artistThumbObserver.unobserve(entry.target);
    hydrateArtistThumb(entry.target, entry.target.dataset.artistId);
  });
}, { rootMargin: '200px 0px' }) : null;
new MutationObserver(mutations => {
  for (const mutation of mutations) for (const node of mutation.removedNodes) {
    if (node.nodeType !== 1 || node.parentElement === pickerList) continue;
    _albumArtIO?.unobserve(node);
    _artistThumbObserver?.unobserve(node);
  }
}).observe(pickerList, { childList: true });
function queueArtistThumbHydration(item, artistId) {
  if (!artistId) return;
  if (!_artistThumbObserver) { hydrateArtistThumb(item, artistId); return; } // no IO support — fall back to eager
  item.dataset.artistId = artistId;
  _artistThumbObserver.observe(item);
}

// An artist's picture, looked up once a session: every visit and search
// asked again, two requests a row. The album cover is only asked for when
// there's no photo.
const _artistThumbs = new Map();
function artistThumbUrl(artistId) {
  if (_artistThumbs.has(artistId)) return _artistThumbs.get(artistId);
  const p = (async () => {
    const info = await fetchTimeout(`${ND_URL}/rest/getArtistInfo2?id=${encodeURIComponent(artistId)}&count=1&${subsonicParams()}`, {}, 8000)
      .then(r => r.json()).then(d => d['subsonic-response']?.artistInfo2, () => null);
    let url = info?.mediumImageUrl || info?.largeImageUrl || '';
    // Last.fm's "no picture" star.
    if (url && url.includes('2a96cbd8b46e442fc41c2b86b821562f')) url = '';
    if (url) return url;
    const artist = await fetchTimeout(`${ND_URL}/rest/getArtist?id=${encodeURIComponent(artistId)}&${subsonicParams()}`, {}, 8000)
      .then(r => r.json()).then(d => d['subsonic-response']?.artist, () => null);
    const cover = artist?.album?.[0]?.coverArt;
    if (!cover && !info && !artist) throw new Error('offline'); // not remembered: try again next time
    return cover ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(cover)}&size=${klabArtSize(200)}&${subsonicParams()}` : '';
  })();
  _artistThumbs.set(artistId, p);
  p.catch(() => _artistThumbs.delete(artistId));
  return p;
}
async function hydrateArtistThumb(item, artistId) {
  const ph = item?.querySelector('.picker-item-art-ph');
  if (!ph || !artistId) return;
  try {
    const url = await artistThumbUrl(artistId);
    if (!url || !ph.isConnected) return;
    const img = new Image();
    img.className = 'picker-item-art artist';
    img.alt = '';
    img.loading = 'lazy';
    img.onload = () => { if (ph.isConnected) ph.replaceWith(img); };
    img.src = url;
  } catch(e) {}
}

// An artist with no photo gets their initials on a colour derived from the
// name (stable across renders), instead of an identical grey circle.
function artistPlaceholderHTML(name) {
  const n = String(name || '?');
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const initials = n.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || n[0];
  return `<div class="picker-item-art-ph artist artist-initials" style="--h:${h % 360}">${esc(initials)}</div>`;
}

// All the artists, flat (getArtists hands them out by letter).
function artistsFlat() {
  return (_artistsCache || []).flatMap(idx => idx.artist || []);
}
// Artists: a grid of faces, in the order the bar sorts them, with the
// A–Z rail (js/26-browse.js). Each picture is Navidrome's own "ar-<id>"
// cover (one request, not the two a lookup took), initials if it has none.
function renderArtistList(artists) {
  pickerList.innerHTML = '';
  if (!artists.length) { pickerList.innerHTML = '<div class="picker-empty">No artists found.</div>'; return; }
  const hdr = document.createElement('div');
  hdr.className = 'picker-section-label';
  hdr.textContent = 'Artists (' + artists.length + ')'; // hidden: the count goes beside the title
  const frag = document.createDocumentFragment();
  frag.appendChild(hdr);
  artists.forEach(artist => {
    const item = document.createElement('div');
    item.className = 'picker-item artist-card';
    item._artist = artist;
    item.innerHTML = `
      ${artistPlaceholderHTML(artist.name)}
      <div class="picker-item-info">
        <div class="picker-item-title">${esc(artist.name) || 'Unknown'}</div>
        <div class="picker-item-artist">${klabCount(artist.albumCount || 0, 'album')}</div>
      </div>
      ${window.klabMusicCards.acts('artist', artist.id, { queue: false })}`;
    const ph = item.querySelector('.picker-item-art-ph');
    item._loadArt = () => {
      const img = new Image();
      img.className = 'picker-item-art artist';
      img.alt = '';
      img.decoding = 'async';
      img.onload = () => { if (!ph.isConnected || img.naturalWidth < 2) return; img.classList.add('loaded'); ph.replaceWith(img); };
      img.src = `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(artist.coverArt || 'ar-' + artist.id)}&size=${klabArtSize(Math.max(ph.offsetWidth, 160))}&${subsonicParams()}`;
    };
    if (_albumArtIO) _albumArtIO.observe(item); else item._loadArt();
    item.querySelector('[data-card-play]').addEventListener('click', e => {
      e.stopPropagation();
      window.klabPlayArtist?.(artist);
      SFX && SFX.play('click');
    });
    item.addEventListener('click', e => { if (!e.target.closest('.card-acts button')) loadArtistView(artist); });
    frag.appendChild(item);
  });
  pickerList.appendChild(frag);
}

async function loadArtistView(artist) {
  goToMusicDetail(() => window.openArtistPage(artist.id, artist.name));
}

// ══════════════════════════════════════════
//  QUEUE — what's playing, what you queued (drag to reorder, ✕ to take
//  one out) and what comes next from the album or list.
// ══════════════════════════════════════════
const QUEUE_SHOWN = 200;
function _queueChanged() { updateQueueBadge(); if (pickerTab === 'queue') renderQueueList(true); }
// Taken out at once, with Undo.
function klabClearQueue() {
  if (!queue.length) return;
  let saved = [];
  klabUndo('Queue cleared', {
    icon: 'ti-playlist',
    apply: () => { saved = queue.slice(); queue = []; _queueChanged(); },
    undo: () => { queue = saved.concat(queue); _queueChanged(); },
  });
  SFX && SFX.play('click');
}
function klabUnqueue(song) {
  const at = queue.indexOf(song);
  if (at < 0) return;
  klabUndo(`"${song.title || 'Song'}" taken out of the queue`, {
    icon: 'ti-playlist',
    apply: () => { queue.splice(at, 1); _queueChanged(); },
    undo: () => { queue.splice(Math.min(at, queue.length), 0, song); _queueChanged(); },
  });
}
function _fmtTotal(sec) {
  sec = Math.round(sec);
  return sec >= 3600 ? `${Math.floor(sec / 3600)} hr ${Math.floor(sec % 3600 / 60)} min` : `${Math.max(1, Math.round(sec / 60))} min`;
}
function renderQueueList(keepScroll) {
  if (queue.some(s => !s)) queue = queue.filter(Boolean);
  updateQueueBadge();
  const top = pickerList.scrollTop;
  const cur = playerState.currentSong;
  const upcoming = klabUpcoming(50);
  const pl = playerState.playlist || [];
  if (!queue.length && !cur) {
    pickerList.innerHTML = '<div class="k-empty"><i class="ti ti-playlist"></i><div>Nothing’s queued. Use Add to queue on a song or album.</div></div>';
    document.getElementById('musicViewSub').textContent = '';
    return;
  }
  pickerList.innerHTML = '';
  const label = (text, count, extra) => {
    const l = document.createElement('div');
    l.className = 'picker-section-label q-label';
    l.innerHTML = `<span>${esc(text)}${count ? ` <span class="k-count">${esc(count)}</span>` : ''}</span>${extra || ''}`;
    pickerList.appendChild(l);
    return l;
  };
  const row = (song, list) => {
    const box = document.createDocumentFragment();
    renderSongItem(song, box);
    const el = box.firstElementChild;
    if (list) el._list = list;
    pickerList.appendChild(el);
    return el;
  };
  if (cur) {
    label('Now playing');
    const el = row(cur, null);
    el.classList.add('q-now');
    el._playNow = true;
  }
  if (queue.length) {
    const total = queue.reduce((n, s) => n + (s.duration || 0), 0);
    const l = label('Queued', `${queue.length.toLocaleString()}${total ? ' · ' + _fmtTotal(total) : ''}`,
      '<button type="button" class="k-btn sm ghost q-clear"><i class="ti ti-trash"></i>Clear</button>');
    l.querySelector('.q-clear').addEventListener('click', klabClearQueue);
    queue.slice(0, QUEUE_SHOWN).forEach((song, k) => {
      const box = document.createDocumentFragment();
      renderSongItem(song, box);
      const el = box.firstElementChild;
      el.classList.add('q-item');
      el.draggable = true;
      el._queueAt = k;
      el._remove = () => klabUnqueue(song);
      el.querySelector('.song-acts').outerHTML = klabSongActsHTML(song, { remove: true });
      pickerList.appendChild(el);
    });
    if (queue.length > QUEUE_SHOWN) {
      const more = document.createElement('div');
      more.className = 'picker-empty';
      more.textContent = 'and ' + (queue.length - QUEUE_SHOWN).toLocaleString() + ' more';
      pickerList.appendChild(more);
    }
  }
  if (upcoming.length) {
    const from = window.klabNpSource?.();
    label(from ? `Next from ${from}` : 'Next', _shuffleOn ? 'shuffled' : '');
    upcoming.forEach(i => { const el = row(pl[i], pl); el._plIndex = i; el.classList.add('q-next'); });
  }
  const total = queue.reduce((n, s) => n + (s.duration || 0), 0) + upcoming.reduce((n, i) => n + (pl[i]?.duration || 0), 0);
  document.getElementById('musicViewSub').textContent = queue.length || upcoming.length ? `${klabCount(queue.length + upcoming.length, 'song')}${total ? ' · ' + _fmtTotal(total) : ''}` : '';
  refreshApNowHighlight();
  if (keepScroll) pickerList.scrollTop = top;
}
// Pressing a row: a queued song plays now (those before it stay queued),
// one from the list plays from there, the one playing pauses or plays.
// (Before #pickerList's own song-row handler, which plays from pickerSongs.)
pickerList.addEventListener('click', e => {
  if (pickerTab !== 'queue') return;
  const row = e.target.closest('.picker-item');
  if (!row || !row._song || e.target.closest('.song-acts, .picker-link')) return;
  e.stopImmediatePropagation();
  if (row._playNow) { togglePlay(); return; }
  if (row.classList.contains('q-item')) {
    const at = queue.indexOf(row._song);
    if (at >= 0) queue.splice(at, 1);
    updateQueueBadge();
    playSong(row._song).then(() => { if (pickerTab === 'queue') renderQueueList(true); });
    return;
  }
  if (row._plIndex != null) {
    playerState.playlistIndex = row._plIndex;
    playSong(row._song).then(() => { if (pickerTab === 'queue') renderQueueList(true); });
  }
}, true);
// Dragging a queued song up or down the queue.
(function() {
  let from = null;
  const clearMarks = () => pickerList.querySelectorAll('.q-drop-before, .q-drop-after').forEach(r => r.classList.remove('q-drop-before', 'q-drop-after'));
  pickerList.addEventListener('dragstart', e => {
    const row = e.target.closest?.('.q-item');
    if (!row || pickerTab !== 'queue') return;
    from = row._queueAt;
    row.classList.add('q-dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', row._song.title || ''); } catch (err) {}
  });
  pickerList.addEventListener('dragover', e => {
    if (from == null) return;
    const row = e.target.closest?.('.q-item');
    if (!row) return;
    e.preventDefault();
    const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    clearMarks();
    row.classList.add(after ? 'q-drop-after' : 'q-drop-before');
  });
  pickerList.addEventListener('drop', e => {
    if (from == null) return;
    const row = e.target.closest?.('.q-item');
    e.preventDefault();
    if (row) {
      const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      let to = row._queueAt + (after ? 1 : 0);
      const [song] = queue.splice(from, 1);
      if (to > from) to--;
      queue.splice(to, 0, song);
      _queueChanged();
      SFX && SFX.play('click');
    }
    from = null; clearMarks();
  });
  pickerList.addEventListener('dragend', () => { from = null; clearMarks(); pickerList.querySelector('.q-dragging')?.classList.remove('q-dragging'); });
})();
// The queue view follows the song changing.
playerState.audio.addEventListener('loadstart', () => { if (pickerTab === 'queue') renderQueueList(true); });
