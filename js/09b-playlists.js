// ══════════════════════════════════════════
//  PLAYLISTS
//
//  A playlist has a name, a description, a cover, a colour and its songs,
//  and lives on klabnet-api (/api/music-requests/playlists) so it can be
//  shown to other people:
//    private     only you see it (how every playlist starts)
//    featured    listed for everyone: Home's "Featured playlists" shelf and
//                Browse -> Playlists. Anyone can play it, or save it to
//                their own sidebar.
//    open        a featured playlist other people can add songs to.
//  The list of playlists holds summaries (no songs); a playlist's songs
//  are fetched when it's opened or played.
//
//  Playlists used to be a name and some songs in each person's prefs. Those
//  are brought over the first time this runs against an API that has
//  playlists (plImportLegacy). Against one that doesn't yet, everything
//  here works on that old list instead (_plServer === false): no covers,
//  descriptions or featuring, but nothing is lost.
// ══════════════════════════════════════════
const PLAYLISTS_KEY = 'klabnet_playlists';  // the prefs-era list
const PL_CACHE_KEY  = 'klabnet_pl_cache';   // the last list the API gave, so the sidebar is there at once
const PL_API        = '/api/music-requests/playlists';
const PL_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#a18072', '#8b8d98'];

let _pls = [];          // summaries: yours, then other people's featured ones
let _plServer = null;   // true: on the API. false: an API without playlists. null: not known yet
let _plLimits = { name: 80, description: 600, songs: 2000, covers: false };

// ── The prefs-era list ──
function localPlaylists() {
  try { const v = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]'); return Array.isArray(v) ? v.filter(p => p && p.id) : []; }
  catch (e) { return []; }
}
function saveLocalPlaylists(pls) {
  // Slim records, like favourites (a playlist of whole Navidrome records
  // is ~1KB a song, and it all goes to prefs).
  for (const pl of pls) pl.songs = (Array.isArray(pl.songs) ? pl.songs : []).filter(Boolean).map(slimSong);
  try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(pls)); }
  catch (e) { showToast?.('Couldn’t save that playlist: storage is full', 'ti-alert-triangle'); }
  scheduleSave();
}
function plLocalSummary(pl) {
  const songs = Array.isArray(pl.songs) ? pl.songs.filter(Boolean) : [];
  return {
    id: String(pl.id), owner: window.KLAB_USER?.username || '', mine: true, local: true,
    name: pl.name || 'Playlist', description: '', color: '', cover: '', featured: false, collab: false,
    count: songs.length, duration: songs.reduce((n, s) => n + (s.duration || 0), 0),
    art: [...new Set(songs.map(s => s.coverArt).filter(Boolean))].slice(0, 4),
    saves: 0, saved: false,
  };
}
function plLocalEdit(fn) {
  const pls = localPlaylists();
  const out = fn(pls);
  saveLocalPlaylists(pls);
  plSet(pls.map(plLocalSummary));
  return out;
}
const plLocalFind = (pls, id) => {
  const pl = pls.find(p => String(p.id) === String(id));
  if (!pl) throw Object.assign(new Error('That playlist is gone'), { status: 404 });
  if (!Array.isArray(pl.songs)) pl.songs = [];
  return pl;
};

// ── The API ──
// Answers with the parsed body, or throws an Error whose message can be
// shown as it is (the server's own, e.g. "a playlist needs a name").
async function plFetch(path, opts = {}, ms = 10000) {
  const o = { ...opts };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers = { 'Content-Type': 'application/json' }; delete o.json; }
  let res;
  try { res = await fetchTimeout(PL_API + path, o, ms); }
  catch (e) { throw new Error('Couldn’t reach klabnet'); }
  // A lapsed session lands on the sign-in page, which answers 200.
  if (res.redirected) throw Object.assign(new Error('Your session ended. Reload to sign in again.'), { status: 401 });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw Object.assign(new Error(klabCap(data?.error) || 'Something went wrong'), { status: res.status });
  return data;
}

let _plSig = '';
function plSet(list) {
  _pls = Array.isArray(list) ? list : [];
  // Most refreshes find nothing new: no redraw (the Browse grid would
  // start over under whoever's looking at it).
  const sig = JSON.stringify(_pls);
  if (sig === _plSig) return;
  _plSig = sig;
  if (_plServer) { try { localStorage.setItem(PL_CACHE_KEY, sig); } catch (e) {} }
  renderPlaylistNav();
  window.dispatchEvent(new CustomEvent('klab:playlists'));
}
// One summary changed (or is new): yours stay ahead of other people's.
function plPut(p) {
  if (!p || !p.id) return p;
  const i = _pls.findIndex(x => x.id === p.id);
  if (i >= 0) _pls[i] = p;
  else { const at = _pls.findIndex(x => !x.mine); _pls.splice(at < 0 ? _pls.length : at, 0, p); }
  plSet(_pls);
  return p;
}
const plById = id => _pls.find(p => p.id === id);

// Playlists from prefs, handed to the API once. The API remembers every id
// it has taken, so the same list on a second device isn't brought over
// again, and one deleted since doesn't come back.
let _plImporting = false;
async function plImportLegacy() {
  const legacy = localPlaylists();
  if (!legacy.length || _plImporting) return false;
  _plImporting = true;
  try {
    const sent = JSON.stringify(legacy);
    const r = await plFetch('/import', { method: 'POST', json: { playlists: legacy } }, 20000);
    // Unless one was edited here while that was on its way.
    if (JSON.stringify(localPlaylists()) === sent) { localStorage.setItem(PLAYLISTS_KEY, '[]'); scheduleSave(); }
    if (r.imported) showToast?.(`Your ${r.imported === 1 ? 'playlist' : r.imported + ' playlists'} can have a cover and a description now, and be featured`, 'ti-playlist');
    return true;
  } catch (e) { return false; }
  finally { _plImporting = false; }
}

let _plRefreshing = null, _plAt = 0;
function plRefresh() {
  if (_plRefreshing) return _plRefreshing;
  _plRefreshing = (async () => {
    try {
      let d = await plFetch('', { cache: 'no-store' });
      _plServer = true;
      Object.assign(_plLimits, d.limits || {});
      if (await plImportLegacy()) d = await plFetch('', { cache: 'no-store' });
      plSet(d.playlists);
    } catch (e) {
      // An API from before playlists lived on it: they stay where they
      // were. Anything else (offline, signed out): keep what's showing.
      if (e.status === 404 || e.status === 405) { _plServer = false; plSet(localPlaylists().map(plLocalSummary)); }
    } finally {
      _plAt = Date.now();
      _plRefreshing = null;
    }
  })();
  return _plRefreshing;
}
// Other people feature and change theirs while this is open.
function plRefreshIfStale(ms = 30000) { if (Date.now() - _plAt > ms) plRefresh(); }
let _plSoon = 0;
function plRefreshSoon() { clearTimeout(_plSoon); _plSoon = setTimeout(plRefresh, 600); }
// Before the first answer, a change would go to the wrong place.
async function plReady() {
  if (_plServer === null) await plRefresh();
  if (_plServer === null) throw new Error('Couldn’t reach klabnet');
}

async function plGet(id) {
  await plReady();
  if (_plServer) return plFetch('/' + encodeURIComponent(id), { cache: 'no-store' });
  const pl = plLocalFind(localPlaylists(), id);
  return { ...plLocalSummary(pl), songs: pl.songs.filter(Boolean), can_edit: true };
}
async function plCreate(fields, songs = []) {
  await plReady();
  songs = songs.filter(Boolean).map(slimSong);
  if (_plServer) return plPut(await plFetch('', { method: 'POST', json: { ...fields, songs } }, 20000));
  const name = String(fields.name || '').trim();
  if (!name) throw new Error('A playlist needs a name');
  const pl = { id: Date.now().toString(), name, songs, created: new Date().toISOString() };
  plLocalEdit(pls => { pls.push(pl); });
  return plById(pl.id);
}
async function plEdit(id, fields) {
  await plReady();
  if (_plServer) return plPut(await plFetch('/' + encodeURIComponent(id), { method: 'PATCH', json: fields }));
  plLocalEdit(pls => { const pl = plLocalFind(pls, id); if (fields.name) pl.name = String(fields.name).trim() || pl.name; });
  return plById(id);
}
async function plDelete(id) {
  await plReady();
  if (_plServer) { await plFetch('/' + encodeURIComponent(id), { method: 'DELETE' }); plSet(_pls.filter(p => p.id !== id)); return; }
  plLocalEdit(pls => { const i = pls.findIndex(p => String(p.id) === String(id)); if (i >= 0) pls.splice(i, 1); });
}
// -> { added, skipped, count, full }
async function plAddSongs(id, songs) {
  await plReady();
  songs = songs.filter(s => s && s.id).map(slimSong);
  if (_plServer) {
    const r = await plFetch(`/${encodeURIComponent(id)}/songs`, { method: 'POST', json: { songs } }, 20000);
    plRefreshSoon(); // its count, length and covers
    return r;
  }
  return plLocalEdit(pls => {
    const pl = plLocalFind(pls, id), have = new Set(pl.songs.map(s => s.id));
    const fresh = songs.filter(s => !have.has(s.id) && have.add(s.id));
    pl.songs.push(...fresh);
    return { added: fresh.length, skipped: songs.length - fresh.length, count: pl.songs.length, full: false };
  });
}
async function plRemoveSong(id, songId) {
  await plReady();
  if (_plServer) { await plFetch(`/${encodeURIComponent(id)}/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' }); plRefreshSoon(); return; }
  plLocalEdit(pls => { const pl = plLocalFind(pls, id); pl.songs = pl.songs.filter(s => s && s.id !== songId); });
}
async function plReorder(id, ids) {
  await plReady();
  if (_plServer) { await plFetch(`/${encodeURIComponent(id)}/order`, { method: 'PUT', json: { ids } }); plRefreshSoon(); return; }
  plLocalEdit(pls => {
    const pl = plLocalFind(pls, id), at = new Map(ids.map((x, i) => [x, i]));
    pl.songs.sort((a, b) => (at.get(a.id) ?? 1e9) - (at.get(b.id) ?? 1e9));
  });
}
async function plSave(id, saved) {
  return plPut(await plFetch(`/${encodeURIComponent(id)}/save`, { method: 'PUT', json: { saved } }));
}
async function plSetCover(id, blob) {
  if (!blob) return plPut(await plFetch(`/${encodeURIComponent(id)}/cover`, { method: 'DELETE' }));
  const form = new FormData();
  form.append('file', blob, 'cover.jpg');
  return plPut(await plFetch(`/${encodeURIComponent(id)}/cover`, { method: 'POST', body: form }, 60000));
}

// ── Covers ──
// Its own cover; without one, the first four album covers in it as a
// 2x2 (one, where that would be too small to read); with no songs
// either, a tile in its colour.
function plArt(p, cls, px) {
  const el = document.createElement('div');
  el.className = 'pl-art' + (cls ? ' ' + cls : '');
  if (p.color) el.style.setProperty('--pl-c', p.color);
  const art = Array.isArray(p.art) ? p.art : [];
  const nd = size => id => `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}`;
  let srcs = null;
  // The 300px copy wherever it's enough for this screen: a decoded
  // 1000px cover is 4MB, and a page of them adds up.
  if (p.cover) srcs = [`${PL_API}/covers/${encodeURIComponent(p.cover)}/${px * (window.devicePixelRatio || 1) > 320 ? 'l' : 's'}`];
  else if (art.length >= 4 && px >= 100) srcs = art.slice(0, 4).map(nd(px > 150 ? 300 : 150));
  else if (art.length) srcs = [nd(px > 150 ? 300 : px > 60 ? 150 : 80)(art[0])];
  if (!srcs) {
    el.classList.add('ph');
    el.innerHTML = '<i class="ti ti-playlist"></i>';
    return el;
  }
  if (srcs.length > 1) el.classList.add('mosaic');
  for (const src of srcs) {
    const img = new Image();
    img.alt = ''; img.decoding = 'async'; img.draggable = false;
    if (px <= 150) img.loading = 'lazy';
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => { img.style.visibility = 'hidden'; };
    img.src = src;
    el.appendChild(img);
  }
  return el;
}
const plOwner = p => p.mine ? 'You' : p.owner;
function plLength(secs) {
  if (!secs) return '';
  return secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m` : `${Math.max(1, Math.round(secs / 60))} min`;
}

// ── The sidebar: yours, then the ones you saved ──
function renderPlaylistNav() {
  const nav = document.getElementById('musicPlaylistNav');
  const newBtn = document.getElementById('musicNewPlaylistBtn');
  if (!nav || !newBtn) return;
  nav.querySelectorAll('.music-playlist-row').forEach(row => row.remove());
  for (const p of _pls) {
    if (!p.mine && !p.saved) continue;
    const row = document.createElement('div');
    row.className = 'music-playlist-row';
    row.dataset.plId = p.id;
    row._playlist = p; // right-click menu
    const marks = (p.mine && p.featured ? `<i class="ti ${p.collab ? 'ti-users' : 'ti-world'}" title="${p.collab ? 'Featured, and open to additions' : 'Featured'}"></i>` : '');
    row.innerHTML = `
      <div class="music-playlist-row-info">
        <div class="music-playlist-row-name">${esc(p.name)}</div>
        <div class="music-playlist-row-meta">${p.mine ? '' : esc(p.owner) + ' · '}${klabCount(p.count, 'song')}${marks}</div>
      </div>
      ${p.mine ? '<button class="music-playlist-row-del" title="Delete playlist" type="button"><i class="ti ti-trash"></i></button>' : ''}`;
    row.prepend(plArt(p, 'music-playlist-row-art', 30));
    row.querySelector('.music-playlist-row-del')?.addEventListener('click', e => { e.stopPropagation(); plConfirmDelete(p); });
    row.addEventListener('click', () => window.openPlaylistPage(p.id, p.name));
    nav.insertBefore(row, newBtn);
  }
  window.klabApPage?.syncNavRow(); // the open playlist's row was just rebuilt
}
document.getElementById('musicNewPlaylistBtn')?.addEventListener('click', async () => {
  const p = await openPlaylistEditor(null);
  if (p) window.openPlaylistPage(p.id, p.name);
});

async function plConfirmDelete(p) {
  const ok = await showConfirmDialog('// delete playlist',
    `Delete "${p.name}"? ${p.featured ? 'It goes for everyone who saved it too. ' : ''}This can't be undone.`, 'Delete');
  if (!ok) return;
  try {
    await plDelete(p.id);
    SFX && SFX.play('click');
    showToast(`Deleted "${p.name}"`, 'ti-trash');
  } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
}

// ══════════════════════════════════════════
//  A PLAYLIST'S PAGE — in the album page's panel (js/13-tail.js), and
//  laid out like one: cover, name, who made it, Play, the songs. Yours
//  also has Edit and Feature, songs you can drag into order and take out,
//  and a search at the bottom to add more.
// ══════════════════════════════════════════
window.openPlaylistPage = function(id, name) {
  if (!window.klabApPage) return;
  const onMusic = document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active');
  if (!onMusic) { setActiveTab('music'); ensureMusicTabLoaded(); }
  return window.klabApPage.open({ title: name || plById(id)?.name || 'Playlist', navRow: id, render: ctx => plRenderPage(ctx, id) });
};

async function plRenderPage(ctx, id) {
  let pl;
  try { pl = await plGet(id); }
  catch (e) {
    if (!ctx.alive()) return;
    const gone = e.status === 404;
    ctx.clearBg();
    ctx.scroll.innerHTML = `<div class="ap-error"><i class="ti ti-alert-triangle"></i> ${gone ? 'That playlist isn’t here any more. Its owner may have stopped featuring it.' : esc(e.message)}</div>`;
    if (gone && plById(id)) plRefresh();
    return;
  }
  if (!ctx.alive()) return;
  const songs = pl.songs;
  const canAdd = () => pl.can_edit || (pl.featured && pl.collab);
  // After a song goes in, out or elsewhere: what the cover is made from.
  const recount = () => { pl.count = songs.length; pl.art = [...new Set(songs.map(s => s.coverArt).filter(Boolean))].slice(0, 4); };

  const root = document.createElement('div');
  root.className = 'pl-page';
  root.innerHTML = '<div class="pl-wash"></div><div class="pl-head"></div><div class="ap-body"><div class="pl-tracks"></div><div class="pl-find"></div></div>';
  const head = root.querySelector('.pl-head'), tracks = root.querySelector('.pl-tracks'), find = root.querySelector('.pl-find');

  // ── Cover, name and buttons ──
  function drawHead() {
    ctx.setTitle(pl.name);
    root.style.setProperty('--pl-c', pl.color || 'transparent');
    root.classList.toggle('tinted', !!pl.color);
    const bg = pl.cover ? `${PL_API}/covers/${encodeURIComponent(pl.cover)}/s`
      : pl.art?.[0] ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(pl.art[0])}&size=300&${subsonicParams()}` : '';
    if (bg) ctx.setBg(bg); else ctx.clearBg();

    const kicker = !pl.featured ? (pl.local ? 'Playlist' : 'Private playlist') : pl.collab ? 'Featured playlist · open to additions' : 'Featured playlist';
    const sub = [klabCount(songs.length, 'song'), plLength(songs.reduce((n, s) => n + (s.duration || 0), 0)),
      pl.saves ? `saved by ${pl.saves}` : ''].filter(Boolean).join(' · ');
    const hero = document.createElement('div');
    hero.className = 'ap-hero';
    hero.innerHTML = `
      <div class="ap-hero-meta">
        <span class="ap-hero-kicker">${esc(kicker)}</span>
        <div class="ap-hero-name">${esc(pl.name)}</div>
        <div class="ap-hero-artist-link pl-by" data-user="${esc(pl.owner)}">${esc(pl.owner)}</div>
        <div class="ap-hero-sub">${esc(sub)}</div>
      </div>`;
    const art = plArt(pl, 'ap-hero-img square', 200);
    if (pl.can_edit && !pl.local) {
      art.classList.add('pl-art-edit');
      art.title = 'Change the cover';
      art.insertAdjacentHTML('beforeend', '<span class="pl-art-over"><i class="ti ti-camera"></i></span>');
      art.addEventListener('click', edit);
    } else if (pl.cover) {
      art.classList.add('pl-art-view');
      art.addEventListener('click', () => { SFX && SFX.play('open'); openImageViewer({ thumbSrc: `${PL_API}/covers/${encodeURIComponent(pl.cover)}/l`, alt: pl.name, framed: true }); });
    }
    hero.prepend(art);
    hero.querySelector('.pl-by').addEventListener('click', () => { if (typeof openProfileView === 'function' && pl.owner) openProfileView(pl.owner); });

    const actions = document.createElement('div');
    actions.className = 'ap-actions';
    const btn = (cls, html, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.innerHTML = html;
      if (title) b.title = title;
      b.addEventListener('click', e => { SFX && SFX.play('click'); fn(e, b); });
      actions.appendChild(b);
      return b;
    };
    // While this playlist is what's playing, the button is Pause.
    const fromHere = () => playerState.playlist === songs && !!playerState.currentSong && songs.includes(playerState.currentSong);
    const playBtn = btn('ap-btn-play', '', '', () => {
      if (!songs.length) return;
      if (fromHere()) { playerState.audio.paused ? playerState.audio.play().catch(() => {}) : playerState.audio.pause(); return; }
      playSongList(songs);
    });
    const syncPlay = () => { playBtn.innerHTML = fromHere() && !playerState.audio.paused ? '<i class="ti ti-player-pause"></i> Pause' : '<i class="ti ti-player-play"></i> Play'; };
    const onAudio = () => { if (!playBtn.isConnected) { for (const t of ['play', 'pause', 'loadstart']) playerState.audio.removeEventListener(t, onAudio); return; } syncPlay(); };
    for (const t of ['play', 'pause', 'loadstart']) playerState.audio.addEventListener(t, onAudio);
    syncPlay();
    btn('ap-btn-queue', '<i class="ti ti-arrows-shuffle"></i> Shuffle', '', () => playSongList(songs, { shuffle: true }));
    btn('ap-btn-queue', '<i class="ti ti-playlist-add"></i> Queue all', '', () => plQueue(songs));
    if (pl.can_edit) {
      btn('ap-btn-queue', '<i class="ti ti-pencil"></i> Edit', pl.local ? 'Rename' : 'Name, cover, description, color', edit);
      if (!pl.local) btn('ap-btn-queue' + (pl.featured ? ' pl-on' : ''), `<i class="ti ti-world"></i> ${pl.featured ? 'Featured' : 'Feature'}`,
        pl.featured ? 'Everyone can see this. Click to make it private again.' : 'Show it to everyone, on Home and in Browse',
        () => plSetFeatured(pl, !pl.featured));
    }
    if (!pl.mine) { // an admin can edit anyone's, and save it like anyone else
      btn('ap-btn-queue' + (pl.saved ? ' pl-on' : ''), pl.saved ? '<i class="ti ti-check"></i> Saved' : '<i class="ti ti-plus"></i> Save',
        pl.saved ? 'In your sidebar. Click to take it out.' : 'Keep it in your sidebar', () => plSetSaved(pl, !pl.saved));
    }
    btn('ap-btn-queue pl-more', '<i class="ti ti-dots"></i>', 'More', (e, b) => {
      const r = b.getBoundingClientRect();
      klabPlaylistMenu({ clientX: r.left, clientY: r.bottom + 6, target: b, preventDefault() {} }, pl);
    });

    const parts = [hero, actions];
    if (pl.description) {
      const d = document.createElement('div');
      d.className = 'pl-desc';
      d.innerHTML = linkifyHTML(pl.description);
      parts.push(d);
    }
    head.replaceChildren(...parts);
  }

  async function edit() {
    const saved = await openPlaylistEditor(pl);
    if (saved) { Object.assign(pl, saved); if (root.isConnected) { drawHead(); drawTracks(); drawFind(); } }
  }

  // ── The songs ──
  let dragFrom = -1;
  function drawTracks() {
    tracks.textContent = '';
    const label = document.createElement('div');
    label.className = 'ap-sec-label';
    label.textContent = 'Songs';
    tracks.appendChild(label);
    if (!songs.length) {
      const empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = canAdd() ? 'Nothing in it yet. Search below, or use Add to playlist on any song or album.' : 'Nothing in it yet.';
      tracks.appendChild(empty);
      return;
    }
    const me = window.KLAB_USER?.username;
    songs.forEach((song, i) => {
      const row = ctx.buildTrack(song, i, songs, true);
      if (pl.collab && song.addedBy && song.addedBy !== pl.owner) {
        const subEl = row.querySelector('.ap-track-sub');
        if (subEl) subEl.insertAdjacentHTML('beforeend', ` <span class="pl-added-by">· added by ${esc(song.addedBy)}</span>`);
      }
      if (pl.can_edit || (pl.collab && song.addedBy === me)) {
        const x = document.createElement('button');
        x.type = 'button'; x.className = 'ap-track-play pl-track-x'; x.title = 'Remove from this playlist';
        x.innerHTML = '<i class="ti ti-x"></i>';
        x.addEventListener('click', e => { e.stopPropagation(); remove(song); });
        row.appendChild(x);
      }
      if (pl.can_edit && songs.length > 1) wireDrag(row, i);
      tracks.appendChild(row);
    });
  }

  async function remove(song) {
    const i = songs.indexOf(song);
    if (i < 0) return;
    songs.splice(i, 1);
    // Playing from this list: Next goes on from the same song, not one
    // further along (as move() does).
    if (playerState.playlist === songs) {
      const at = playerState.currentSong ? songs.indexOf(playerState.currentSong) : -1;
      if (at >= 0) playerState.playlistIndex = at;
      else if (i <= playerState.playlistIndex) playerState.playlistIndex = Math.max(-1, playerState.playlistIndex - 1);
    }
    SFX && SFX.play('click');
    recount(); drawHead(); drawTracks();
    try { await plRemoveSong(pl.id, song.id); }
    catch (e) {
      showToast(e.message, 'ti-alert-triangle');
      if (!songs.includes(song)) songs.splice(Math.min(i, songs.length), 0, song);
      recount();
      if (root.isConnected) { drawHead(); drawTracks(); }
    }
  }

  // Drag a row by its number to move it. The line shows where it lands.
  function wireDrag(row, i) {
    const grip = row.querySelector('.ap-track-num');
    grip.classList.add('pl-grip');
    grip.title = 'Drag to reorder';
    // Only from the grip: the rest of the row stays a plain click.
    grip.addEventListener('pointerdown', () => { row.draggable = true; });
    grip.addEventListener('pointerup', () => { row.draggable = false; });
    row.addEventListener('dragstart', e => {
      dragFrom = i;
      row.classList.add('pl-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', songs[i]?.title || '');
    });
    row.addEventListener('dragend', () => { row.draggable = false; dragFrom = -1; clearMarks(); });
    row.addEventListener('dragover', e => {
      if (dragFrom < 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearMarks();
      row.classList.add(after ? 'pl-drop-after' : 'pl-drop-before');
    });
    row.addEventListener('drop', e => {
      if (dragFrom < 0) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      let to = i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
      const from = dragFrom;
      dragFrom = -1;
      if (to > from) to--;
      if (to !== from) move(from, to);
      else clearMarks();
    });
  }
  function clearMarks() { tracks.querySelectorAll('.pl-drop-before, .pl-drop-after, .pl-dragging').forEach(r => r.classList.remove('pl-drop-before', 'pl-drop-after', 'pl-dragging')); }

  async function move(from, to) {
    const before = [...songs];
    const now = playerState.currentSong;
    songs.splice(to, 0, songs.splice(from, 1)[0]);
    // What's playing keeps its place in the queue it's playing from.
    if (playerState.playlist === songs && now) { const at = songs.indexOf(now); if (at >= 0) playerState.playlistIndex = at; }
    SFX && SFX.play('click');
    recount(); drawHead(); drawTracks();
    try { await plReorder(pl.id, songs.map(s => s.id)); }
    catch (e) {
      showToast(e.message, 'ti-alert-triangle');
      songs.splice(0, songs.length, ...before);
      recount();
      if (root.isConnected) { drawHead(); drawTracks(); }
    }
  }

  // ── Find songs to add ──
  let findBuilt = false, findSeq = 0, findTimer = 0;
  function drawFind() {
    find.hidden = !canAdd();
    if (find.hidden || findBuilt) return;
    findBuilt = true;
    find.innerHTML = `
      <div class="ap-sec-label">Add songs</div>
      <div class="picker-search pl-find-box"><i class="ti ti-search"></i><input type="text" placeholder="Search for a song, artist or album…" autocomplete="off" /></div>
      <div class="pl-find-results"></div>`;
    const input = find.querySelector('input'), results = find.querySelector('.pl-find-results');
    const search = async () => {
      const q = input.value.trim(), seq = ++findSeq;
      if (!q) { results.textContent = ''; return; }
      let found = [];
      try {
        const r = await fetchTimeout(`${ND_URL}/rest/search3?query=${encodeURIComponent(q)}&songCount=12&albumCount=0&artistCount=0&${subsonicParams()}`, {}, 8000);
        found = (await r.json())['subsonic-response']?.searchResult3?.song || [];
      } catch (e) {
        if (seq === findSeq) results.innerHTML = '<div class="picker-empty">Couldn’t search the library</div>';
        return;
      }
      if (seq !== findSeq) return; // a later keystroke already answered
      results.textContent = '';
      if (!found.length) { results.innerHTML = '<div class="picker-empty">No songs found</div>'; return; }
      for (const song of found) {
        const has = () => songs.some(s => s.id === song.id);
        const row = document.createElement('div');
        row.className = 'ap-track pl-find-row';
        row.innerHTML = `
          ${song.coverArt ? `<img class="ap-track-art" src="${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=80&${subsonicParams()}" loading="lazy" alt="" onerror="this.style.display='none'" />` : ''}
          <div class="ap-track-info">
            <div class="ap-track-title">${esc(song.title)}</div>
            <div class="ap-track-sub">${esc([song.artist, song.album].filter(Boolean).join(' · '))}</div>
          </div>
          <button type="button" class="ap-btn-queue pl-find-add"></button>`;
        const add = row.querySelector('.pl-find-add');
        const paint = () => { add.innerHTML = has() ? '<i class="ti ti-check"></i> Added' : '<i class="ti ti-plus"></i> Add'; add.disabled = has(); };
        paint();
        row.addEventListener('contextmenu', e => { e.preventDefault(); showSongCtx(e.clientX, e.clientY, song, found); });
        row.addEventListener('click', async () => {
          if (has() || add.dataset.busy) return;
          add.dataset.busy = '1';
          try {
            const r = await plAddSongs(pl.id, [song]);
            if (r.added) {
              songs.push({ ...slimSong(song), addedBy: window.KLAB_USER?.username || '' });
              SFX && SFX.play('queue');
              recount();
              if (root.isConnected) { drawHead(); drawTracks(); }
            } else if (r.full) showToast(`"${pl.name}" is full (${_plLimits.songs.toLocaleString()} songs)`, 'ti-playlist');
          } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
          delete add.dataset.busy;
          paint();
        });
        results.appendChild(row);
      }
    };
    input.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(search, 300); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(findTimer); search(); } e.stopPropagation(); });
  }

  drawHead(); drawTracks(); drawFind();
  ctx.scroll.replaceChildren(root);
  ctx.scroll.scrollTop = 0;

  // Changed from somewhere else while it's open: its menu, the sidebar,
  // another device, a song added from the library.
  const onList = async () => {
    if (!root.isConnected) { window.removeEventListener('klab:playlists', onList); return; }
    const p = plById(pl.id);
    if (!p) {
      // Deleted, or its owner stopped featuring it.
      window.removeEventListener('klab:playlists', onList);
      ctx.clearBg();
      ctx.scroll.innerHTML = '<div class="ap-error"><i class="ti ti-playlist"></i> This playlist isn’t here any more.</div>';
      return;
    }
    const sameSongs = p.count === songs.length;
    const same = ['name', 'description', 'color', 'cover', 'featured', 'collab', 'saved', 'saves'].every(k => p[k] === pl[k]);
    if (same && sameSongs) return;
    Object.assign(pl, p);
    if (!sameSongs) {
      try { const fresh = await plGet(pl.id); if (root.isConnected) songs.splice(0, songs.length, ...fresh.songs); } catch (e) {}
      if (!root.isConnected) return;
      drawTracks();
    }
    recount(); drawHead(); drawFind();
  };
  window.addEventListener('klab:playlists', onList);
}

function plQueue(songs) {
  if (!songs.length) return;
  queue.push(...songs); updateQueueBadge(); SFX && SFX.play('queue');
  if (pickerTab === 'queue') renderQueueList();
  showToast('Queued ' + klabCount(songs.length, 'track'), 'ti-playlist-add');
}
async function plSetFeatured(p, on) {
  try {
    const r = await plEdit(p.id, { featured: on });
    showToast(on ? `"${r.name}" is featured: everyone can find it in Music now` : `"${r.name}" is private again`, on ? 'ti-world' : 'ti-eye-off');
  } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
}
async function plSetSaved(p, on) {
  try {
    const r = await plSave(p.id, on);
    showToast(on ? `Saved "${r.name}" to your sidebar` : `Took "${r.name}" out of your sidebar`, on ? 'ti-check' : 'ti-playlist');
  } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
}

// ══════════════════════════════════════════
//  THE EDITOR — a new playlist, or an existing one's details. Resolves
//  with the saved summary, or null if it was closed.
//  `songs` go into a new playlist as it's made (Add to playlist -> New).
// ══════════════════════════════════════════
// A cover without a picture: a few letters or an emoji on the colour.
function plDrawCover(canvas, text, color) {
  const S = canvas.width, c = canvas.getContext('2d');
  const g = c.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, color);
  g.addColorStop(1, '#000');
  c.fillStyle = color; c.fillRect(0, 0, S, S);
  c.globalAlpha = 0.55; c.fillStyle = g; c.fillRect(0, 0, S, S); c.globalAlpha = 1;
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  let px = S * 0.56;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  do { c.font = `800 ${px}px ${font}`; px *= 0.92; } while (c.measureText(text).width > S * 0.82 && px > S * 0.08);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillText(text, S / 2 + S * 0.008, S / 2 + S * 0.03);
  c.fillStyle = '#fff'; c.fillText(text, S / 2, S / 2 + S * 0.02);
}

function openPlaylistEditor(pl, { songs = [] } = {}) {
  return new Promise(resolve => {
    const rich = _plServer !== false; // an API without playlists keeps just the name
    let done = false;
    const finish = result => { if (done) return; done = true; if (preview) URL.revokeObjectURL(preview); resolve(result); };
    let color = pl?.color || '', featured = !!pl?.featured, collab = !!pl?.collab;
    let coverBlob = null, coverGone = false, preview = '', made = '';
    let coverToSend = () => Promise.resolve(null);

    openChatModal(pl ? '// playlist details' : '// new playlist', `
      <div class="pl-edit">
        <div class="pl-edit-top">
          ${rich ? `<div class="pl-edit-coverbox">
            <button type="button" class="pl-edit-cover" id="plEditCover" title="Choose a picture"></button>
            <div class="pl-edit-cover-btns">
              <button type="button" class="ap-btn-queue" id="plEditMake" title="A cover from an emoji or a few letters">Make one</button>
              <button type="button" class="ap-btn-queue" id="plEditNoCover" hidden>Remove</button>
            </div>
            <input type="file" accept="image/*" id="plEditFile" hidden />
          </div>` : ''}
          <div class="pl-edit-fields">
            <span class="profile-modal-label">Name</span>
            <input type="text" class="chat-modal-input" id="plEditName" placeholder="Playlist name" maxlength="${_plLimits.name}" autocomplete="off" />
            ${rich ? `<span class="profile-modal-label" style="margin-top:10px;">Description</span>
            <textarea class="chat-modal-input" id="plEditDesc" placeholder="What it's for, who it's for, when to play it…" maxlength="${_plLimits.description}" rows="3"></textarea>` : ''}
          </div>
        </div>
        ${rich ? `<div class="pl-edit-make" id="plEditMakeRow" hidden>
          <span class="profile-modal-label">On the cover</span>
          <input type="text" class="chat-modal-input" id="plEditMakeText" placeholder="An emoji or a few letters" maxlength="14" autocomplete="off" />
        </div>
        <span class="profile-modal-label" style="margin-top:12px;">Color</span>
        <div class="profile-modal-color-row" id="plEditColors">
          <div class="profile-modal-color-swatch auto" data-color="" title="None"></div>
          ${PL_COLORS.map(c => `<div class="profile-modal-color-swatch" data-color="${c}" style="background:${c}" title="${c}"></div>`).join('')}
          <label class="profile-modal-color-swatch pl-edit-custom" title="Any color"><i class="ti ti-palette"></i><input type="color" id="plEditCustom" value="${esc(color || '#6e56cf')}" /></label>
        </div>
        <div class="pl-edit-switch">
          <div><div class="t">Feature in Music</div><div class="d">Everyone on klabnet can find it, play it and save it.</div></div>
          <button type="button" class="s-toggle" id="plEditFeatured" role="switch" aria-label="Feature in Music"></button>
        </div>
        <div class="pl-edit-switch" id="plEditCollabRow">
          <div><div class="t">Let others add songs</div><div class="d">Only you can reorder it or take songs out.</div></div>
          <button type="button" class="s-toggle" id="plEditCollab" role="switch" aria-label="Let others add songs"></button>
        </div>` : ''}
        <div class="chat-modal-error" id="plEditError" hidden></div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="ap-btn-queue" id="plEditCancel" style="flex:1;justify-content:center;">Cancel</button>
          <button class="chat-connect-btn" id="plEditSave" style="flex:1;justify-content:center;margin-top:0;">${pl ? 'Save' : 'Create'}</button>
        </div>
      </div>`, () => finish(null));

    const $ = id => document.getElementById(id);
    const nameEl = $('plEditName'), descEl = $('plEditDesc'), errEl = $('plEditError'), saveBtn = $('plEditSave');
    nameEl.value = pl?.name || '';
    if (descEl) descEl.value = pl?.description || '';
    nameEl.focus(); nameEl.select();
    const fail = msg => { errEl.textContent = msg; errEl.hidden = false; };

    if (rich) {
      const coverEl = $('plEditCover'), fileEl = $('plEditFile'), noCover = $('plEditNoCover');
      const makeRow = $('plEditMakeRow'), makeText = $('plEditMakeText'), colors = $('plEditColors'), custom = $('plEditCustom');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1000;
      const drawCover = () => {
        const shown = { ...(pl || { art: [...new Set(songs.map(s => s.coverArt).filter(Boolean))].slice(0, 4) }), color, cover: coverGone ? '' : pl?.cover || '' };
        let art;
        if (preview) { art = document.createElement('div'); art.className = 'pl-art'; art.innerHTML = `<img class="loaded" src="${esc(preview)}" alt="" />`; }
        else if (made) { plDrawCover(canvas, made, color || PL_COLORS[6]); art = document.createElement('div'); art.className = 'pl-art'; canvas.className = 'loaded'; art.appendChild(canvas); }
        else art = plArt(shown, '', 200);
        art.insertAdjacentHTML('beforeend', '<span class="pl-art-over"><i class="ti ti-camera"></i><span>Choose a picture</span></span>');
        coverEl.replaceChildren(art);
        noCover.hidden = !(preview || made || shown.cover);
        if (!_plLimits.covers) { coverEl.disabled = true; coverEl.title = 'Cover storage is offline right now'; $('plEditMake').disabled = true; }
      };
      const paintColors = () => {
        colors.querySelectorAll('.profile-modal-color-swatch').forEach(sw => sw.classList.toggle('selected',
          sw.classList.contains('pl-edit-custom') ? !!color && !PL_COLORS.includes(color) : sw.dataset.color === color));
        colors.querySelector('.pl-edit-custom').style.background = color && !PL_COLORS.includes(color) ? color : '';
      };
      const paintSwitches = () => {
        for (const [el, on] of [[$('plEditFeatured'), featured], [$('plEditCollab'), featured && collab]]) {
          el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on));
        }
        $('plEditCollabRow').classList.toggle('off', !featured);
        $('plEditCollab').disabled = !featured;
      };
      drawCover(); paintColors(); paintSwitches();

      coverEl.addEventListener('click', () => fileEl.click());
      fileEl.addEventListener('change', async () => {
        const file = fileEl.files?.[0];
        fileEl.value = ''; // lets the same file be picked again after a cancelled crop
        if (!file) return;
        const cropped = await openImageCropper(file, { shape: 'square', outputWidth: 1000, outputHeight: 1000 });
        if (!cropped) return;
        if (preview) URL.revokeObjectURL(preview);
        coverBlob = cropped; preview = URL.createObjectURL(cropped); made = ''; coverGone = false;
        makeRow.hidden = true;
        drawCover();
      });
      $('plEditMake').addEventListener('click', () => {
        makeRow.hidden = false;
        if (!makeText.value) makeText.value = [...(nameEl.value.trim().split(/\s+/)[0] || 'mix')].slice(0, 8).join('');
        makeText.dispatchEvent(new Event('input'));
        makeText.focus(); makeText.select();
      });
      makeText.addEventListener('input', () => {
        made = makeText.value.trim();
        if (made) { if (preview) URL.revokeObjectURL(preview); preview = ''; coverBlob = null; coverGone = false; }
        drawCover();
      });
      noCover.addEventListener('click', () => {
        if (preview) URL.revokeObjectURL(preview);
        preview = ''; coverBlob = null; made = ''; makeText.value = ''; makeRow.hidden = true; coverGone = true;
        drawCover();
      });
      colors.addEventListener('click', e => {
        const sw = e.target.closest('.profile-modal-color-swatch');
        if (!sw || sw.classList.contains('pl-edit-custom')) return;
        color = sw.dataset.color;
        paintColors(); drawCover();
      });
      custom.addEventListener('input', () => { color = custom.value.toLowerCase(); paintColors(); drawCover(); });
      $('plEditFeatured').addEventListener('click', () => { featured = !featured; SFX && SFX.play('click'); paintSwitches(); });
      $('plEditCollab').addEventListener('click', () => { collab = !collab; SFX && SFX.play('click'); paintSwitches(); });

      // The made cover is uploaded as a picture, like any other.
      coverToSend = () => made ? new Promise(res => { plDrawCover(canvas, made, color || PL_COLORS[6]); canvas.toBlob(res, 'image/jpeg', 0.92); }) : Promise.resolve(coverBlob);
    }

    $('plEditCancel').addEventListener('click', () => { closeChatModal(); });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveBtn.click(); } });
    saveBtn.addEventListener('click', async () => {
      const name = nameEl.value.trim();
      if (!name) { fail('Give it a name first.'); nameEl.focus(); return; }
      errEl.hidden = true;
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      let saved = null;
      try {
        const fields = rich ? { name, description: descEl.value.trim(), color, featured, collab: featured && collab } : { name };
        saved = pl ? await plEdit(pl.id, fields) : await plCreate(fields, songs);
      } catch (e) {
        if (done) return;
        fail(e.message);
        saveBtn.disabled = false; saveBtn.textContent = pl ? 'Save' : 'Create';
        return;
      }
      // The details are saved by now: a cover that fails says so, without
      // sending you back to a form that would make a second playlist.
      if (rich) {
        try {
          const blob = await coverToSend();
          if (blob) saved = await plSetCover(saved.id, blob);
          else if (coverGone && pl?.cover) saved = await plSetCover(saved.id, null);
        } catch (e) { showToast(`Saved, but the cover didn’t upload: ${e.message}`, 'ti-photo-x'); }
      }
      if (!pl) { SFX && SFX.play('star'); showToast(`"${saved.name}" created${songs.length ? ' with ' + klabCount(saved.count, 'song') : ''}`, 'ti-playlist-add'); }
      const result = saved;
      finish(result);
      closeChatModal();
    });
  });
}

// ══════════════════════════════════════════
//  ADD TO PLAYLIST — from a song's button or menu, or a whole album.
//  Yours, and other people's that are open to additions.
// ══════════════════════════════════════════
async function addSongsToPlaylistFlow(songs, what) {
  songs = (songs || []).filter(s => s && s.id);
  if (!songs.length) return;
  try { await plReady(); } catch (e) { showToast(e.message, 'ti-alert-triangle'); return; }
  const open = _pls.filter(p => p.mine || (p.featured && p.collab)).sort((a, b) => (b.mine - a.mine) || (b.saved - a.saved));
  let target = null;
  if (open.length) {
    const idx = await showChoiceDialog(`// add ${what || `"${songs[0].title}"`} to...`, [
      { label: 'New playlist…', sub: 'Start one with ' + (songs.length === 1 ? 'this song' : 'these ' + songs.length) },
      ...open.map(p => ({ label: p.name, sub: `${p.mine ? '' : p.owner + ' · '}${klabCount(p.count, 'song')}` })),
    ]);
    if (idx === null || idx === undefined) return;
    target = idx > 0 ? open[idx - 1] : null;
  }
  if (!target) { await openPlaylistEditor(null, { songs }); return; }
  try {
    const r = await plAddSongs(target.id, songs);
    SFX && SFX.play('queue');
    const art = toastArt(songs[0].coverArt);
    if (!r.added) showToast(r.full ? `"${target.name}" is full (${_plLimits.songs.toLocaleString()} songs)` : `Already in "${target.name}"`, art);
    else if (songs.length === 1) showToast(`Added to "${target.name}"`, art);
    else showToast(`Added ${klabCount(r.added, 'song')} to "${target.name}"${r.skipped ? ` (${r.skipped} already there)` : ''}`, art);
  } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
}
const addSongToPlaylistFlow = song => addSongsToPlaylistFlow([song]);

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

// ── Right-click (the sidebar, a card, a tile) and the page's ⋯ ──
function klabPlaylistMenu(e, p) {
  p = plById(p.id) || p; // the row may be older than the last change
  const withSongs = fn => async () => {
    try { fn((await plGet(p.id)).songs); }
    catch (err) { showToast(err.message, 'ti-alert-triangle'); }
  };
  const n = p.count, canEdit = p.mine || (p.can_edit && !p.local);
  klabMenu(e, [
    { header: p.name },
    { label: 'Play', icon: 'ti-player-play', hidden: !n, action: withSongs(s => playSongList(s)) },
    { label: 'Shuffle', icon: 'ti-arrows-shuffle', hidden: !n, action: withSongs(s => playSongList(s, { shuffle: true })) },
    { label: 'Add to queue', icon: 'ti-playlist-add', hidden: !n, action: withSongs(plQueue) },
    '-',
    { label: 'Open', icon: 'ti-playlist', action: () => window.openPlaylistPage(p.id, p.name) },
    { label: p.local ? 'Rename' : 'Edit details', icon: 'ti-pencil', hidden: !canEdit, action: () => openPlaylistEditor(p) },
    { label: p.featured ? 'Stop featuring' : 'Feature in Music', icon: p.featured ? 'ti-eye-off' : 'ti-world', hidden: !canEdit || p.local, action: () => plSetFeatured(p, !p.featured) },
    { label: p.saved ? 'Take out of your sidebar' : 'Save to your sidebar', icon: p.saved ? 'ti-x' : 'ti-plus', hidden: p.mine, action: () => plSetSaved(p, !p.saved) },
    { label: 'Make a copy', icon: 'ti-copy', hidden: !n || _plServer === false, action: withSongs(async s => {
      try { const c = await plCreate({ name: `${p.name} (copy)`.slice(0, _plLimits.name), description: p.description, color: p.color }, s); showToast(`Copied to "${c.name}"`, 'ti-copy'); }
      catch (err) { showToast(err.message, 'ti-alert-triangle'); }
    }) },
    '-',
    { label: 'Delete playlist', icon: 'ti-trash', warn: true, hidden: !canEdit, action: () => plConfirmDelete(p) },
  ]);
}

// ══════════════════════════════════════════
//  BROWSE -> PLAYLISTS, and Home's shelf
// ══════════════════════════════════════════
async function plPlay(p) {
  const mark = klabPickMark();
  try {
    const songs = (await plGet(p.id)).songs;
    if (klabPickMark() !== mark) return;
    if (!songs.length) { showToast(`"${p.name}" has nothing in it yet`, 'ti-playlist'); return; }
    playSongList(songs);
    SFX && SFX.play('click');
  } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
}

// Home's card (js/15-music-home.js puts these in a row).
function plCard(p) {
  const card = document.createElement('div');
  card.className = 'mh-card';
  card._playlist = p;
  card.innerHTML =
    '<div class="mh-card-art"><button type="button" class="mh-card-play" title="Play"><i class="ti ti-player-play-filled"></i></button></div>' +
    `<div class="mh-card-t">${esc(p.name)}</div><div class="mh-card-a">${esc(plOwner(p))} · ${klabCount(p.count, 'song')}</div>`;
  card.querySelector('.mh-card-art').prepend(plArt(p, '', 148));
  card.addEventListener('click', e => {
    if (e.target.closest('.mh-card-play')) { plPlay(p); return; }
    window.openPlaylistPage(p.id, p.name);
  });
  return card;
}

function plTile(p) {
  const item = document.createElement('div');
  item.className = 'picker-item pl-tile';
  item._playlist = p;
  item.innerHTML = `
    <div class="picker-item-info">
      <div class="picker-item-title">${esc(p.name)}</div>
      <div class="picker-item-artist">${esc(plOwner(p))} · ${klabCount(p.count, 'song')}</div>
    </div>
    <div class="picker-item-actions"><button class="picker-action" title="Play" type="button"><i class="ti ti-player-play"></i></button></div>`;
  item.prepend(plArt(p, 'picker-item-art', 160));
  item.addEventListener('click', e => {
    if (e.target.closest('.picker-action')) { e.stopPropagation(); plPlay(p); return; }
    window.openPlaylistPage(p.id, p.name);
  });
  return item;
}

function renderPlaylistsBrowse() {
  pickerList.classList.remove('mh-home');
  pickerList.classList.add('picker-list-grid');
  pickerList.innerHTML = '';
  const section = (title, list, emptyText) => {
    const lbl = document.createElement('div');
    lbl.className = 'picker-section-label';
    lbl.textContent = title;
    pickerList.appendChild(lbl);
    if (!list.length) { pickerList.insertAdjacentHTML('beforeend', `<div class="picker-empty">${esc(emptyText)}</div>`); return; }
    list.forEach(p => pickerList.appendChild(plTile(p)));
  };
  const others = _pls.filter(p => !p.mine);
  if (_plServer !== false) section('Featured', others, 'Nobody else has featured a playlist yet. Open one of yours and press Feature to show it here for everyone.');
  section('Yours', _pls.filter(p => p.mine), 'You haven’t made one yet: New playlist, in the sidebar.');
  document.getElementById('musicViewSub').textContent = _pls.length ? klabCount(_pls.length, 'playlist') : '';
}

const _origLoadPickerTabPlaylists = loadPickerTab;
loadPickerTab = async function(tab) {
  if (tab === 'playlists') {
    hideSortBtn();
    _pickerLoadToken++; clearTimeout(pickerDebounce); // see the songs/genres wrapper
    pickerTab = tab;
    setMusicViewTitle(tab);
    renderPlaylistsBrowse();
    plRefreshIfStale(5000);
    return;
  }
  return _origLoadPickerTabPlaylists(tab);
};
window.addEventListener('klab:playlists', () => {
  const onMusic = document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active');
  if (pickerTab === 'playlists' && onMusic) renderPlaylistsBrowse();
});

// What the rest of the site asks for.
window.klabPlaylists = {
  refresh: plRefresh,
  refreshIfStale: plRefreshIfStale,
  featured: () => _pls.filter(p => p.featured),
  // The ones in your sidebar: yours, and the ones you saved.
  mine: () => _pls.filter(p => p.mine || p.saved),
  card: plCard,
  art: plArt,
  play: plPlay,
  addSongs: addSongsToPlaylistFlow,
  // Prefs just arrived from the server (another device's edits).
  prefsChanged() {
    if (_plServer === false) plSet(localPlaylists().map(plLocalSummary));
    else if (_plServer && localPlaylists().length) plRefresh();
  },
};

// The last list straight away; the real one follows.
try { _pls = JSON.parse(localStorage.getItem(PL_CACHE_KEY)) || []; } catch (e) { _pls = []; }
if (!Array.isArray(_pls) || !_pls.length) _pls = localPlaylists().map(plLocalSummary);
_plSig = JSON.stringify(_pls);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active')) plRefreshIfStale(60000);
});
