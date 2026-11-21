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
  // The Queue was a view here until 2026-11-20; it's the dock's popover now.
  if (tab === 'queue') tab = 'random';
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
//  QUEUE — a popover from the dock's queue button (owner, 2026-11-20: "a
//  button in the player that just pops out and lets u drag around and
//  reorder", not a section of its own). What's playing, what you queued
//  (drag by the grip or the row, Alt+↑/↓, ✕ with Undo) and what comes
//  next from the album or list, in the order it'll play. A bottom sheet
//  on a phone. The full player's Up next is the big view of the same.
// ══════════════════════════════════════════
const QUEUE_SHOWN = 200;
function _queueChanged() { updateQueueBadge(); }
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

window.klabQueuePop = (() => {
  const btn = document.getElementById('dockQueue');
  const phone = matchMedia('(max-width: 760px) and (pointer: coarse)');
  let el = null, body = null, scrim = null, popLayer = null, drag = null, stale = false, closeTimer = 0;
  const isOpen = () => !!el && el.classList.contains('open');

  function setup() {
    el = document.createElement('div');
    el.className = 'q-pop';
    el.id = 'queuePop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Queue');
    el.innerHTML = '<div class="q-head"><span class="q-title">Queue</span><span class="q-count"></span>' +
      '<button type="button" class="k-btn sm ghost q-clear"><i class="ti ti-trash"></i>Clear</button></div>' +
      '<div class="q-body"></div>' +
      '<div class="q-foot"><button type="button" class="q-fs">Open full player</button></div>';
    body = el.querySelector('.q-body');
    scrim = Object.assign(document.createElement('div'), { className: 'q-scrim' });
    document.body.append(scrim, el);
    el.querySelector('.q-clear').addEventListener('click', klabClearQueue);
    el.querySelector('.q-fs').addEventListener('click', () => { close(); window.klabOpenUpNext?.(); });
    scrim.addEventListener('click', () => close());
    body.addEventListener('click', onClick);
    body.addEventListener('keydown', onKey);
    body.addEventListener('pointerdown', onDown);
    body.addEventListener('contextmenu', e => {
      const row = e.target.closest('.q-row');
      if (!row?._song || typeof showSongCtx !== 'function') return;
      e.preventDefault();
      showSongCtx(e.clientX, e.clientY, row._song);
    });
    // Outside it: closes. The dock (play, skip) and what opens from in
    // here (a song's menu, the Undo toast) don't count.
    document.addEventListener('pointerdown', e => {
      if (isOpen() && !e.target.closest?.('#queuePop, #playerDock, .ctx-menu, #toastFlyout, .q-scrim')) close();
    }, true);
    addEventListener('hashchange', () => close());
    addEventListener('popstate', () => close());
    addEventListener('resize', () => { if (isOpen()) place(); });
  }

  // Above the button, its right edge on the button's; a sheet on a phone.
  function place() {
    const sheet = phone.matches;
    el.classList.toggle('q-sheet', sheet);
    scrim.classList.toggle('on', sheet && isOpen());
    if (sheet) { el.style.left = el.style.top = el.style.bottom = el.style.maxHeight = ''; return; }
    const r = (btn && btn.offsetParent ? btn : document.getElementById('playerDock'))?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(380, innerWidth - 16);
    const right = r.left + r.width / 2 > innerWidth / 2;
    const left = Math.max(8, Math.min(right ? r.right + 6 - w : r.left - 6, innerWidth - w - 8));
    el.style.left = left + 'px';
    el.style.bottom = (innerHeight - r.top + 8) + 'px';
    el.style.maxHeight = Math.max(200, Math.min(innerHeight * .6, r.top - 16)) + 'px';
    el.style.transformOrigin = (right ? 'right' : 'left') + ' bottom';
  }

  function open(e) {
    if (!el) setup();
    clearTimeout(closeTimer);
    el.hidden = false;
    render();
    place();
    void el.offsetWidth;
    el.classList.add('open');
    scrim.classList.toggle('on', phone.matches);
    btn?.setAttribute('aria-expanded', 'true');
    btn?.classList.add('on');
    popLayer?.();
    popLayer = klabLayers.push(el, { kind: 'popover', close: () => close(), dim: phone.matches });
    SFX && SFX.play('open');
    // Opened from the keyboard: the first row takes focus.
    if (e && e.detail === 0) body.querySelector('.q-row')?.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen()) return;
    if (drag) endDrag(false);
    el.classList.remove('open');
    scrim.classList.remove('on');
    btn?.setAttribute('aria-expanded', 'false');
    btn?.classList.remove('on');
    popLayer?.(); popLayer = null;
    if (el.contains(document.activeElement)) btn?.focus({ preventScroll: true });
    closeTimer = setTimeout(() => { if (!isOpen()) el.hidden = true; }, 320);
  }
  const toggle = e => isOpen() ? close() : open(e);
  // Whatever changed what's next (the queue, the song, shuffle, repeat):
  // drawn again where it stands, not while a row is being dragged.
  function refresh() {
    if (!isOpen()) return;
    if (drag) { stale = true; return; }
    render(true);
  }

  const artUrl = s => s.coverArt ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(s.coverArt)}&size=80&${subsonicParams()}` : '';
  function row(song, kind, k) {
    const r = document.createElement('div');
    r.className = 'q-row q-' + kind;
    r.tabIndex = 0;
    r._song = song; r._kind = kind; r._k = k;
    const u = artUrl(song);
    r.innerHTML =
      (kind === 'queued' ? '<span class="q-grip" title="Drag to reorder" aria-hidden="true"><i class="ti ti-grip-vertical"></i></span>' : '') +
      (u ? `<img class="q-art" src="${esc(u)}" alt="" draggable="false" decoding="async" onload="this.classList.add('loaded')">` : '<span class="q-art q-art-ph"><i class="ti ti-music"></i></span>') +
      `<span class="q-meta"><span class="q-t">${esc(song.title || 'Unknown')}</span><span class="q-a">${esc(song.artist || 'Unknown artist')}</span></span>` +
      (kind === 'now' ? '<span class="np-eq" aria-hidden="true"><i></i><i></i><i></i></span>' : '') +
      `<span class="q-d">${song.duration ? formatTime(song.duration) : ''}</span>` +
      (kind === 'queued' ? '<span class="q-acts">' +
        '<button type="button" class="k-icon sm q-up" title="Move up" aria-label="Move up"><i class="ti ti-chevron-up"></i></button>' +
        '<button type="button" class="k-icon sm q-down" title="Move down" aria-label="Move down"><i class="ti ti-chevron-down"></i></button>' +
        '<button type="button" class="k-icon sm q-x" title="Remove from queue" aria-label="Remove from queue"><i class="ti ti-x"></i></button></span>' : '');
    return r;
  }
  function label(text, sub) {
    const l = document.createElement('div');
    l.className = 'q-label k-label';
    l.innerHTML = `<span>${esc(text)}</span>${sub ? `<span class="q-label-sub">${esc(sub)}</span>` : ''}`;
    return l;
  }

  function render(keep) {
    if (queue.some(s => !s)) queue = queue.filter(Boolean);
    const top = body.scrollTop, focusKey = document.activeElement?.closest?.('.q-row') && el.contains(document.activeElement)
      ? [document.activeElement._kind, document.activeElement._k] : null;
    const cur = playerState.currentSong, pl = playerState.playlist || [];
    const upcoming = klabUpcoming(30);
    const frag = document.createDocumentFragment();
    if (cur) {
      frag.append(label('Now playing'));
      frag.append(row(cur, 'now', 0));
    }
    if (queue.length) {
      frag.append(label('Queued'));
      const box = document.createElement('div');
      box.className = 'q-list';
      queue.slice(0, QUEUE_SHOWN).forEach((s, k) => box.append(row(s, 'queued', k)));
      frag.append(box);
      if (queue.length > QUEUE_SHOWN) frag.append(Object.assign(document.createElement('div'), { className: 'q-more', textContent: `and ${(queue.length - QUEUE_SHOWN).toLocaleString()} more` }));
    }
    if (upcoming.length) {
      const from = window.klabNpSource?.();
      frag.append(label(from ? `Next from ${from}` : 'Next', _shuffleOn ? 'Shuffled' : ''));
      upcoming.forEach(i => pl[i] && frag.append(row(pl[i], 'next', i)));
    }
    if (!cur && !queue.length) {
      frag.append(Object.assign(document.createElement('div'), { className: 'k-empty q-empty',
        innerHTML: '<i class="ti ti-playlist"></i><div>Nothing’s queued. Use Add to queue on a song or album.</div>' }));
    }
    body.replaceChildren(frag);
    const total = queue.reduce((n, s) => n + (s.duration || 0), 0) + upcoming.reduce((n, i) => n + (pl[i]?.duration || 0), 0);
    const n = queue.length + upcoming.length;
    el.querySelector('.q-count').textContent = n ? `${n.toLocaleString()}${total ? ' · ' + _fmtTotal(total) : ''}` : '';
    el.querySelector('.q-clear').hidden = !queue.length;
    if (keep) body.scrollTop = top;
    if (focusKey) [...body.querySelectorAll('.q-row')].find(r => r._kind === focusKey[0] && r._k === focusKey[1])?.focus({ preventScroll: true });
  }

  // Pressing a row: the one playing pauses or plays, a queued song plays
  // now (those before it stay queued), one from the list plays from there.
  function play(r) {
    if (r._kind === 'now') { togglePlay(); return; }
    if (r._kind === 'queued') {
      const at = queue.indexOf(r._song);
      if (at >= 0) queue.splice(at, 1);
      updateQueueBadge();
    } else playerState.playlistIndex = r._k;
    playSong(r._song);
  }
  function move(from, to, focus) {
    to = Math.max(0, Math.min(queue.length - 1, to));
    if (to === from) return;
    const [s] = queue.splice(from, 1);
    queue.splice(to, 0, s);
    _queueChanged();
    SFX && SFX.play('click');
    if (focus) body.querySelector(`.q-queued:nth-child(${to + 1})`)?.focus({ preventScroll: false });
  }
  function onClick(e) {
    const r = e.target.closest('.q-row');
    if (!r || r._dragged) { if (r) r._dragged = false; return; }
    if (e.target.closest('.q-x')) { klabUnqueue(r._song); return; }
    if (e.target.closest('.q-up')) { move(r._k, r._k - 1, true); return; }
    if (e.target.closest('.q-down')) { move(r._k, r._k + 1, true); return; }
    if (e.target.closest('.q-grip')) return;
    play(r);
  }
  function onKey(e) {
    const r = e.target.closest?.('.q-row');
    if (!r || e.target !== r) return;
    const rows = [...body.querySelectorAll('.q-row')], i = rows.indexOf(r);
    if (e.altKey && r._kind === 'queued' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); e.stopPropagation();
      move(r._k, r._k + (e.key === 'ArrowUp' ? -1 : 1), true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); e.stopPropagation(); play(r);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && r._kind === 'queued') {
      e.preventDefault(); e.stopPropagation();
      const next = rows[i + 1]?._kind === 'queued' ? i : i - 1;
      klabUnqueue(r._song);
      [...body.querySelectorAll('.q-row')][Math.max(0, next)]?.focus();
    }
  }

  // ── Dragging a queued song ──
  // Pointer events, so a mouse, a pen and a finger (by the grip) all work.
  // The row follows the pointer; the others make room for it by sliding
  // (transform only), and it's written to the queue on letting go.
  function onDown(e) {
    const r = e.target.closest('.q-queued');
    if (!r || e.button > 0 || e.target.closest('.q-acts')) return;
    const grip = !!e.target.closest('.q-grip');
    if (e.pointerType !== 'mouse' && !grip) return; // a finger scrolls; the grip drags
    const rows = [...r.parentElement.children];
    drag = { r, rows, from: rows.indexOf(r), to: rows.indexOf(r), y0: e.clientY, s0: body.scrollTop, y: e.clientY, live: grip, id: e.pointerId, h: r.offsetHeight };
    if (grip) { e.preventDefault(); begin(); }
    addEventListener('pointermove', onMove, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('pointercancel', onCancel, true);
  }
  function begin() {
    drag.live = true;
    el.classList.add('q-dragging');
    drag.r.classList.add('lifted');
    drag.rows.forEach(x => { if (x !== drag.r) x.classList.add('q-shift'); });
    try { body.setPointerCapture?.(drag.id); } catch {}
    tick();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.y = e.clientY;
    if (!drag.live) {
      if (Math.abs(e.clientY - drag.y0) < 4) return;
      begin();
    }
    e.preventDefault();
    layout();
  }
  function layout() {
    const d = drag;
    const dy = d.y - d.y0 + (body.scrollTop - d.s0);
    d.to = Math.max(0, Math.min(d.rows.length - 1, d.from + Math.round(dy / d.h)));
    d.r.style.transform = `translateY(${dy}px)`;
    d.rows.forEach((x, i) => {
      if (x === d.r) return;
      const shift = d.from < d.to && i > d.from && i <= d.to ? -d.h : d.to < d.from && i >= d.to && i < d.from ? d.h : 0;
      x.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }
  // Near the top or the foot of the list, it scrolls.
  function tick() {
    if (!drag?.live) return;
    const b = body.getBoundingClientRect(), edge = 36;
    const v = drag.y < b.top + edge ? -(b.top + edge - drag.y) : drag.y > b.bottom - edge ? drag.y - (b.bottom - edge) : 0;
    if (v) { body.scrollTop += Math.max(-14, Math.min(14, v / 3)); layout(); }
    drag.raf = requestAnimationFrame(tick);
  }
  function onUp(e) { if (drag && e.pointerId === drag.id) endDrag(true); }
  function onCancel(e) { if (drag && e.pointerId === drag.id) endDrag(false); }
  function endDrag(commit) {
    const d = drag;
    removeEventListener('pointermove', onMove, true);
    removeEventListener('pointerup', onUp, true);
    removeEventListener('pointercancel', onCancel, true);
    if (!d) return;
    cancelAnimationFrame(d.raf);
    drag = null;
    if (!d.live) return; // a plain click
    d.r._dragged = true; // the click that follows isn't a play
    setTimeout(() => { d.r._dragged = false; }, 0);
    const done = () => {
      el.classList.remove('q-dragging');
      d.rows.forEach(x => { x.style.transform = ''; x.classList.remove('q-shift', 'lifted', 'settling'); });
      // By song, not by the rows' indexes: the queue can have changed under
      // the drag (a queued song came on and was shifted off the front, a
      // remote's echo), and the old slots then moved the wrong song.
      const s = d.r._song, at = queue.indexOf(s);
      const moved = commit && d.to !== d.from && at >= 0;
      if (moved) {
        const anchor = d.rows[d.to]?._song;
        queue.splice(at, 1);
        let to = anchor ? queue.indexOf(anchor) : -1;
        to = to < 0 ? Math.min(d.to, queue.length) : to + (d.to > d.from ? 1 : 0);
        queue.splice(to, 0, s);
        stale = false;
        _queueChanged(); // draws it again, in the new order
        SFX && SFX.play('click');
      } else if (stale) { stale = false; render(true); }
    };
    if (!commit || !(window.klabMotionOk?.() ?? true)) { done(); return; }
    // It settles into its slot, then the list is written.
    d.r.classList.add('settling');
    d.r.style.transform = `translateY(${(d.to - d.from) * d.h}px)`;
    setTimeout(done, 140);
  }

  btn?.setAttribute('aria-haspopup', 'dialog');
  btn?.setAttribute('aria-expanded', 'false');
  return { open, close, toggle, refresh, isOpen };
})();
