// ══════════════════════════════════════════
//  PICKER — EXTENDED TABS
// ══════════════════════════════════════════
// Replace the existing loadPickerTab to handle new tabs
const _origLoadPickerTab = loadPickerTab;
loadPickerTab = async function(tab) {
  if (tab === 'albums') { pickerTab = tab; await loadAlbums(); return; }
  if (tab === 'artists') { pickerTab = tab; await loadArtists(); return; }
  if (tab === 'queue') { pickerTab = tab; renderQueueList(); return; }
  return _origLoadPickerTab(tab);
};

let _albumsCache = null;
async function loadAlbums() {
  pickerList.innerHTML = '<div class="picker-empty">loading albums...</div>';
  try {
    if (!_albumsCache) {
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
        if (page_i === 49) showToast('album list may be incomplete — hit the page limit', 'ti-list-details');
      }
      _albumsCache = allAlbums;
    }
    renderAlbumList(applySort(_albumsCache, 'albums'));
    showSortBtn('albums');
  } catch(e) { pickerList.innerHTML = '<div class="picker-empty">failed to load</div>'; }
}

async function loadArtists() {
  pickerList.innerHTML = '<div class="picker-empty">loading...</div>';
  try {
    const res = await fetchTimeout(`${ND_URL}/rest/getArtists?${subsonicParams()}`, {}, 8000);
    const data = await res.json();
    renderArtistList(data['subsonic-response']?.artists?.index || []);
  } catch(e) { pickerList.innerHTML = '<div class="picker-empty">failed to load</div>'; }
}

function renderAlbumList(albums, appendMode) {
  if (!albums.length) { if (!appendMode) pickerList.innerHTML = '<div class="picker-empty">no albums</div>'; return; }
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

    // Always show placeholder immediately — swap with art when loaded
    const ph = document.createElement('div');
    ph.className = 'picker-item-art-ph';
    ph.innerHTML = '<i class="ti ti-vinyl"></i>';

    const artUrl = ND_URL + '/rest/getCoverArt?id=' + album.coverArt + '&size=150&' + subsonicParams();
    const artImg = new Image();
    artImg.className = 'picker-item-art';
    artImg.onload = () => ph.replaceWith(artImg);
    artImg.src = artUrl;

    const info = document.createElement('div');
    info.className = 'picker-item-info';
    info.innerHTML =
      '<div class="picker-item-title">' + (esc(album.name) || 'Unknown') + '</div>' +
      '<div class="picker-item-artist">' + esc(album.artist || '') +
        (album.year ? ' · ' + esc(album.year) : '') +
        ' · ' + (album.songCount || 0) + ' tracks</div>';

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

    acts.append(badge, playBtn, queueBtn);
    item.append(ph, info, acts);

    const fetchTracks = async () => {
      const r = await fetchTimeout(ND_URL + '/rest/getAlbum?id=' + album.id + '&' + subsonicParams(), {}, 8000);
      const d = await r.json();
      return d['subsonic-response']?.album?.song || [];
    };

    playBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const t = await fetchTracks(); if (!t.length) return;
      queue = t.slice(1); updateQueueBadge();
      await playSong(t[0]);
      showToast('Playing "' + album.name + '"', toastArt(album.coverArt || album.id));
    });

    queueBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const t = await fetchTracks();
      queue.push(...t); updateQueueBadge();
      showToast('Queued ' + t.length + ' tracks', toastArt(album.coverArt || album.id));
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
    const artistName = artist.name || artist.artist || 'Unknown Artist';
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.innerHTML = `
      ${artistPlaceholderHTML(artist.name)}
      <div class="picker-item-info">
        <div class="picker-item-title">${esc(artistName)}</div>
        <div class="picker-item-artist">${artist.albumCount || 0} albums</div>
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
// DOM (tab switch, re-render) stop being tracked automatically per spec,
// nothing to manually disconnect.
const _artistThumbObserver = window.IntersectionObserver ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    _artistThumbObserver.unobserve(entry.target);
    hydrateArtistThumb(entry.target, entry.target.dataset.artistId);
  });
}, { rootMargin: '200px 0px' }) : null;
function queueArtistThumbHydration(item, artistId) {
  if (!artistId) return;
  if (!_artistThumbObserver) { hydrateArtistThumb(item, artistId); return; } // no IO support — fall back to eager
  item.dataset.artistId = artistId;
  _artistThumbObserver.observe(item);
}

async function hydrateArtistThumb(item, artistId) {
  const ph = item?.querySelector('.picker-item-art-ph');
  if (!ph || !artistId) return;
  try {
    const [infoRes, artistRes] = await Promise.allSettled([
      fetchTimeout(`${ND_URL}/rest/getArtistInfo2?id=${artistId}&count=1&${subsonicParams()}`, {}, 8000).then(r => r.json()),
      fetchTimeout(`${ND_URL}/rest/getArtist?id=${artistId}&${subsonicParams()}`, {}, 8000).then(r => r.json()),
    ]);
    const info = infoRes.status === 'fulfilled'
      ? infoRes.value['subsonic-response']?.artistInfo2
      : null;
    const artist = artistRes.status === 'fulfilled'
      ? artistRes.value['subsonic-response']?.artist
      : null;
    let url = info?.mediumImageUrl || info?.largeImageUrl || '';
    if (url && url.includes('2a96cbd8b46e442fc41c2b86b821562f')) url = '';
    if (!url && artist?.album?.[0]?.coverArt) {
      url = `${ND_URL}/rest/getCoverArt?id=${artist.album[0].coverArt}&size=150&${subsonicParams()}`;
    }
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
  if (!indexes.length) { pickerList.innerHTML = '<div class="picker-empty">no artists found</div>'; return; }
  indexes.forEach(idx => {
    if (!idx.artist?.length) return;
    const label = document.createElement('div');
    label.className = 'picker-section-label';
    label.textContent = idx.name;
    pickerList.appendChild(label);
    idx.artist.forEach(artist => {
      const item = document.createElement('div');
      item.className = 'picker-item';
      item.innerHTML = `
        ${artistPlaceholderHTML(artist.name)}
        <div class="picker-item-info">
          <div class="picker-item-title">${esc(artist.name)||'Unknown'}</div>
          <div class="picker-item-artist">${artist.albumCount||0} albums</div>
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
  if (window.openArtistPage) { goToMusicDetail(() => window.openArtistPage(artist.id, artist.name)); return; }
  pickerList.innerHTML = '<div class="picker-empty">loading...</div>';
  try {
    const res = await fetchTimeout(`${ND_URL}/rest/getArtist?id=${artist.id}&${subsonicParams()}`, {}, 8000);
    const data = await res.json();
    const info = data['subsonic-response']?.artist;
    if (!info) { pickerList.innerHTML = '<div class="picker-empty">failed</div>'; return; }
    pickerList.innerHTML = '';
    // Back button
    const back = document.createElement('button');
    back.className = 'picker-back';
    back.innerHTML = '<i class="ti ti-arrow-left"></i> Artists';
    back.addEventListener('click', () => {
      document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="artists"]').classList.add('active');
      loadArtists();
    });
    pickerList.appendChild(back);
    // Artist header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:1rem;padding:0.5rem 0.8rem 0.8rem;border-bottom:1px solid var(--glass-border);margin-bottom:0.4rem;';
    hdr.innerHTML = `<div style="width:48px;height:48px;border-radius:50%;background:var(--glass-fill);border:2px solid var(--glass-border);display:flex;align-items:center;justify-content:center;color:var(--text-dimmer);font-size:22px;flex-shrink:0;"><i class="ti ti-user-circle"></i></div><div><div style="font-size:1rem;font-weight:700;color:var(--text);letter-spacing:0.04em;">${esc(info.name)||'Unknown'}</div><div style="font-size:9px;letter-spacing:0.15em;color:var(--text-dimmer);text-transform:uppercase;margin-top:2px;">${info.albumCount||0} albums</div></div>`;
    pickerList.appendChild(hdr);
    // Albums
    const albums = info.album || [];
    const lbl = document.createElement('div');
    lbl.className = 'picker-section-label'; lbl.textContent = 'Albums';
    pickerList.appendChild(lbl);
    albums.forEach(album => {
      // size=80 — same list-mode-row sizing fix as renderSongItem() above; this
      // is a fallback list view (openArtistPage unavailable), not the grid.
      const artUrl = `${ND_URL}/rest/getCoverArt?id=${album.coverArt}&size=80&${subsonicParams()}`;
      const item = document.createElement('div');
      item.className = 'picker-item';
      const img = document.createElement('img');
      img.className = 'picker-item-art';
      img.src = artUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.style.cssText = 'opacity:0;transition:opacity 0.3s';
      img.onload = () => { img.style.opacity = 1; };
      img.onerror = () => {
        const ph = document.createElement('div');
        ph.className = 'picker-item-art-ph';
        ph.innerHTML = '<i class="ti ti-vinyl"></i>';
        img.replaceWith(ph);
      };
      const info = document.createElement('div');
      info.className = 'picker-item-info';
      info.innerHTML = '<div class="picker-item-title">' + (esc(album.name)||'Unknown') + '</div>' +
                       '<div class="picker-item-artist">' + esc(album.year||'') + ' · ' + (album.songCount||0) + ' tracks</div>';
      const actions = document.createElement('div');
      actions.className = 'picker-item-actions';
      actions.innerHTML = '<span class="type-badge album">album</span>' +
        '<button class="picker-action" title="Play album"><i class="ti ti-player-play"></i></button>' +
        '<button class="picker-action" title="Queue album"><i class="ti ti-playlist-add"></i></button>';
      item.appendChild(img);
      item.appendChild(info);
      item.appendChild(actions);
      const getTracks = async () => {
        const r = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${album.id}&${subsonicParams()}`, {}, 8000);
        const d = await r.json();
        return d['subsonic-response']?.album?.song || [];
      };
      item.querySelector('[title="Play album"]').addEventListener('click', async e => {
        e.stopPropagation();
        const t = await getTracks(); if (!t.length) return;
        queue = t.slice(1); updateQueueBadge();
        await playSong(t[0]); showToast(`Playing "${album.name}"`, toastArt(album.coverArt || album.id));
      });
      item.querySelector('[title="Queue album"]').addEventListener('click', async e => {
        e.stopPropagation();
        const t = await getTracks();
        queue.push(...t); updateQueueBadge();
        showToast(`Queued ${t.length} tracks`, toastArt(album.coverArt || album.id));
      });
      item.addEventListener('click', () => {
        loadAlbumView(album.id, album.name, () => loadArtistView(artist));
      });
      pickerList.appendChild(item);
    });
  } catch(e) { pickerList.innerHTML = '<div class="picker-empty">failed to load artist</div>'; }
}

function renderQueueList() {
  updateQueueBadge();
  if (!queue.length) { pickerList.innerHTML = '<div class="picker-empty">queue is empty — add albums or songs</div>'; return; }
  pickerList.innerHTML = '';
  const clearRow = document.createElement('div');
  clearRow.style.cssText = 'display:flex;justify-content:flex-end;padding:0 2px 6px;';
  const clearBtn = document.createElement('button');
  clearBtn.style.cssText = "font-size:8.5px;letter-spacing:0.14em;text-transform:uppercase;padding:4px 12px;border-radius:100px;cursor:pointer;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.25);color:var(--danger-color);transition:background 0.15s;";
  clearBtn.textContent = 'clear all';
  clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = 'rgba(248,113,113,0.22)'; });
  clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = 'rgba(248,113,113,0.1)'; });
  clearBtn.addEventListener('click', () => { queue = []; updateQueueBadge(); renderQueueList(); SFX.play('click'); });
  clearRow.appendChild(clearBtn);
  pickerList.appendChild(clearRow);
  queue.forEach((song, idx) => {
    // size=80 — same list-mode-row sizing fix as renderSongItem() above.
    const artUrl = `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=80&${subsonicParams()}`;
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.innerHTML = `
      <img class="picker-item-art" src="${artUrl}" alt="" loading="lazy" style="opacity:0;transition:opacity 0.3s" onload="this.style.opacity=1" onerror="klabArtFallback(this,'picker-item-art-ph','ti-music')" />
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
      queue.splice(idx, 1); updateQueueBadge(); renderQueueList();
    });
    item.addEventListener('click', async () => {
      const s = queue.splice(idx, 1)[0];
      updateQueueBadge(); await playSong(s);
    });
    pickerList.appendChild(item);
  });
}

