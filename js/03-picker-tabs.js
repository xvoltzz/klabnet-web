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
    renderArtistList(_artistsCache);
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
    hdr.textContent = 'Albums (' + albums.length + ')';
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
    artImg.onload = () => ph.replaceWith(artImg);
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

    const acts = document.createElement('div');
    acts.className = 'picker-item-actions';

    const badge = document.createElement('span');
    badge.className = 'type-badge album'; badge.textContent = 'album';

    const playBtn = document.createElement('button');
    playBtn.className = 'picker-action'; playBtn.title = 'Play';
    playBtn.innerHTML = '<i class="ti ti-player-play"></i>';

    const queueBtn = document.createElement('button');
    queueBtn.className = 'picker-action'; queueBtn.title = 'Queue';
    queueBtn.innerHTML = '<i class="ti ti-playlist-add"></i>';

    const starTpl = document.createElement('template');
    starTpl.innerHTML = klabStars.button('album', album.id, 'picker-action');
    acts.append(badge, starTpl.content, playBtn, queueBtn);
    item.append(ph, info, acts);

    const fetchTracks = async () => {
      const r = await fetchTimeout(ND_URL + '/rest/getAlbum?id=' + encodeURIComponent(album.id) + '&' + subsonicParams(), {}, 8000);
      const d = await r.json();
      return d['subsonic-response']?.album?.song || [];
    };

    playBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const mark = klabPickMark();
      let t;
      try { t = await fetchTracks(); } catch (err) { showToast('Couldn’t play "' + album.name + '"', 'ti-alert-triangle'); return; }
      if (!t.length || klabPickMark() !== mark) return;
      // The album becomes what's playing; songs you queued stay queued.
      playerState.playlist = t; playerState.playlistIndex = 0;
      await playSong(t[0]);
      showToast('Playing "' + album.name + '"', toastArt(album.coverArt || album.id));
    });

    queueBtn.addEventListener('click', async e => {
      e.stopPropagation();
      let t;
      try { t = await fetchTracks(); } catch (err) { showToast('Couldn’t queue "' + album.name + '"', 'ti-alert-triangle'); return; }
      queue.push(...t); updateQueueBadge();
      showToast('Queued ' + klabCount(t.length, 'track'), toastArt(album.coverArt || album.id));
    });

    item.addEventListener('click', e => {
      if (e.target.closest('.picker-action')) return;
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

function renderArtistList(indexes) {
  pickerList.innerHTML = '';
  if (!indexes.length) { pickerList.innerHTML = '<div class="picker-empty">No artists found</div>'; return; }
  indexes.forEach(idx => {
    if (!idx.artist?.length) return;
    const label = document.createElement('div');
    label.className = 'picker-section-label';
    label.textContent = idx.name;
    pickerList.appendChild(label);
    idx.artist.forEach(artist => {
      const item = document.createElement('div');
      item.className = 'picker-item';
      item._artist = artist;
      item.innerHTML = `
        ${artistPlaceholderHTML(artist.name)}
        <div class="picker-item-info">
          <div class="picker-item-title">${esc(artist.name)||'Unknown'}</div>
          <div class="picker-item-artist">${klabCount(artist.albumCount || 0, 'album')}</div>
        </div>
        <div class="picker-item-actions">
          <button class="picker-action" title="Browse"><i class="ti ti-chevron-right"></i></button>
        </div>`;
      const browse = () => loadArtistView(artist);
      item.querySelector('[title="Browse"]').addEventListener('click', e => { e.stopPropagation(); browse(); });
      item.addEventListener('click', browse);
      pickerList.appendChild(item);
      queueArtistThumbHydration(item, artist.id);
    });
  });
}

async function loadArtistView(artist) {
  goToMusicDetail(() => window.openArtistPage(artist.id, artist.name));
}

const QUEUE_SHOWN = 200;
function renderQueueList() {
  updateQueueBadge();
  if (!queue.length) { pickerList.innerHTML = '<div class="picker-empty">The queue is empty. Add albums or songs</div>'; return; }
  pickerList.innerHTML = '';
  const clearRow = document.createElement('div');
  clearRow.style.cssText = 'display:flex;justify-content:flex-end;padding:0 2px 6px;';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'app-btn'; // a secondary button like any other (it was a tiny red all-caps pill)
  clearBtn.innerHTML = '<i class="ti ti-trash"></i> Clear queue';
  clearBtn.addEventListener('click', () => { queue = []; updateQueueBadge(); renderQueueList(); SFX.play('click'); });
  clearRow.appendChild(clearBtn);
  pickerList.appendChild(clearRow);
  // The first 200: "Queue all" on a long playlist made thousands of rows,
  // all rebuilt on every track change while this was open.
  queue.slice(0, QUEUE_SHOWN).forEach(song => {
    // size=80 — same list-mode-row sizing fix as renderSongItem() above.
    const artUrl = `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=80&${subsonicParams()}`;
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.innerHTML = `
      <img class="picker-item-art" src="${artUrl}" alt="" loading="lazy" onerror="klabArtFallback(this,'picker-item-art-ph','ti-music')" />
      <div class="picker-item-info" style="min-width:0;flex:1;">
        <div class="picker-item-title">${esc(song.title)||'Unknown'}</div>
        <div class="picker-item-artist">${esc(song.artist||'')} · ${esc(song.album||'')}</div>
      </div>
      <div class="picker-item-actions" style="flex-shrink:0;display:flex;align-items:center;gap:2px;">
        <span class="type-badge song" style="flex-shrink:0;">song</span>
        <button class="picker-action" title="Remove" style="flex-shrink:0;"><i class="ti ti-x"></i></button>
      </div>`;
    item.querySelector('[title="Remove"]').addEventListener('click', e => {
      e.stopPropagation();
      const at = queue.indexOf(song); if (at >= 0) queue.splice(at, 1);
      updateQueueBadge(); renderQueueList();
    });
    item.addEventListener('click', async () => {
      const at = queue.indexOf(song); if (at < 0) { renderQueueList(); return; }
      const s = queue.splice(at, 1)[0];
      // Redrawn, or the song just taken off the queue stayed listed in it.
      updateQueueBadge(); renderQueueList(); await playSong(s);
    });
    pickerList.appendChild(item);
  });
  if (queue.length > QUEUE_SHOWN) {
    const more = document.createElement('div');
    more.className = 'picker-empty';
    more.textContent = 'and ' + (queue.length - QUEUE_SHOWN).toLocaleString() + ' more';
    pickerList.appendChild(more);
  }
}
