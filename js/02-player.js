// ══════════════════════════════════════════
//  MUSIC PLAYER — Navidrome Subsonic API
// ══════════════════════════════════════════
const ND_URL  = 'https://music.klab.gg';
const ND_USER = 'klabservice';
const ND_SALT = 'klabnet2024';

function md5(str) {
  // Simple MD5 for Subsonic token auth
  function safeAdd(x,y){let lsw=(x&0xFFFF)+(y&0xFFFF);let msw=(x>>16)+(y>>16)+(lsw>>16);return(msw<<16)|(lsw&0xFFFF);}
  function bitRotateLeft(num,cnt){return(num<<cnt)|(num>>>(32-cnt));}
  function md5cmn(q,a,b,x,s,t){return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b);}
  function md5ff(a,b,c,d,x,s,t){return md5cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function md5gg(a,b,c,d,x,s,t){return md5cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function md5hh(a,b,c,d,x,s,t){return md5cmn(b^c^d,a,b,x,s,t);}
  function md5ii(a,b,c,d,x,s,t){return md5cmn(c^(b|(~d)),a,b,x,s,t);}
  function binlMD5(x,len){
    x[len>>5]|=0x80<<(len%32);x[(((len+64)>>>9)<<4)+14]=len;
    let i,olda,oldb,oldc,oldd,a=1732584193,b=-271733879,c=-1732584194,d=271733878;
    for(i=0;i<x.length;i+=16){
      olda=a;oldb=b;oldc=c;oldd=d;
      a=md5ff(a,b,c,d,x[i],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330);
      a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983);
      a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162);
      a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329);
      a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i],20,-373897302);
      a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848);
      a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501);
      a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734);
      a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556);
      a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640);
      a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189);
      a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651);
      a=md5ii(a,b,c,d,x[i],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055);
      a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799);
      a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649);
      a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551);
      a=safeAdd(a,olda);b=safeAdd(b,oldb);c=safeAdd(c,oldc);d=safeAdd(d,oldd);
    }
    return[a,b,c,d];
  }
  function binl2hex(binarray){let hex='';const hexTab='0123456789abcdef';for(let i=0;i<binarray.length*4;i++){hex+=hexTab.charAt((binarray[i>>2]>>((i%4)*8+4))&0xF)+hexTab.charAt((binarray[i>>2]>>((i%4)*8))&0xF);}return hex;}
  function str2binl(str){const bin=[];const mask=(1<<8)-1;for(let i=0;i<str.length*8;i+=8)bin[i>>5]|=(str.charCodeAt(i/8)&mask)<<(i%32);return bin;}
  function rawMD5(s){return binlMD5(str2binl(s),s.length*8);}
  return binl2hex(rawMD5(str));
}

function subsonicParams(extraParams='') {
  const token = md5('KLABNET' + ND_SALT);
  return `u=${ND_USER}&t=${token}&s=${ND_SALT}&v=1.16.1&c=klabnet&f=json${extraParams}`;
}

const VOLUME_KEY = 'klabnet_volume';
let playerState = {
  playing: false,
  currentSong: null,
  playlist: [],
  playlistIndex: 0,
  audio: new Audio(),
  volume: parseFloat(localStorage.getItem(VOLUME_KEY) || '0.8')
};
playerState.audio.volume = playerState.volume;
playerState.audio.addEventListener('play', () => {
  playerState.playing = true;
  setPlayIcon(true);
});
playerState.audio.addEventListener('pause', () => {
  playerState.playing = false;
  setPlayIcon(false);
});

// Keeps the "now playing" highlight in any open album/artist track list
// in sync with playback — needed because tracks also advance without a
// click (auto-advance, prev/next, media session, presence sync).
function refreshApNowHighlight() {
  const nowId = playerState?.currentSong?.id;
  document.querySelectorAll('.ap-track').forEach(row => {
    row.classList.toggle('ap-now', nowId != null && row.dataset.songId === String(nowId));
  });
}

function updatePlayerUI(song) {
  refreshApNowHighlight();
  const titleEl  = document.getElementById('playerTitle');
  const artistEl = document.getElementById('playerArtist');
  const idleEl   = document.getElementById('playerIdle');
  const artWrap  = document.getElementById('playerArtWrap');
  const progress = document.getElementById('playerProgress');

  if (!song) {
    titleEl.style.display='none'; artistEl.style.display='none';
    idleEl.style.display='block'; progress.style.display='none';
    artWrap.innerHTML='<i class="ti ti-music"></i>';
    return;
  }

  idleEl.style.display='none';
  titleEl.style.display='block';
  artistEl.style.display='block';
  progress.style.display='block';

  // Add fade animation
  titleEl.classList.add('song-fading');
  artistEl.classList.add('song-fading');
  setTimeout(() => {
    titleEl.classList.remove('song-fading');
    artistEl.classList.remove('song-fading');
  }, 350);

  // Title — click opens album view
  titleEl.innerHTML = '';
  if (song.albumId) {
    const tLink = document.createElement('span');
    tLink.className = 'player-link';
    tLink.textContent = song.title || 'Unknown';
    tLink.title = 'View album';
    tLink.addEventListener('click', () => goToMusicDetail(() => loadAlbumView(song.albumId, song.album, () => loadPickerTab('albums'))));
    titleEl.appendChild(tLink);
  } else {
    titleEl.textContent = song.title || 'Unknown';
  }

  // Artist — click opens artist view
  artistEl.innerHTML = '';
  if (song.artistId) {
    const aLink = document.createElement('span');
    aLink.className = 'player-link';
    aLink.textContent = song.artist || 'Unknown Artist';
    aLink.title = 'View artist';
    aLink.addEventListener('click', () => goToMusicDetail(() => loadArtistView({ id: song.artistId, name: song.artist })));
    artistEl.appendChild(aLink);
  } else {
    artistEl.textContent = song.artist || 'Unknown Artist';
  }
  if (song.album) {
    const sep = document.createElement('span');
    sep.className = 'player-album-sep';
    sep.textContent = '//';
    const albumEl = document.createElement('span');
    albumEl.className = 'player-album';
    albumEl.textContent = song.album;
    artistEl.appendChild(sep);
    artistEl.appendChild(albumEl);
  }

  // Album art — DOM construction avoids innerHTML escaping bugs
  // size=100 (~2x the 46px dock art box, 36px on mobile) — was 300,
  // fetching/decoding ~6x more pixels than this ever displays.
  const artUrl = `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=100&${subsonicParams()}`;
  const ph = document.createElement('div');
  ph.className = 'picker-item-art-ph';
  ph.innerHTML = '<i class="ti ti-music"></i>';
  artWrap.innerHTML = '';
  artWrap.appendChild(ph);
  const img = new Image();
  img.className = 'player-art';
  img.alt = 'art';
  img.onload = () => ph.replaceWith(img);
  img.src = artUrl;
}

function setPlayIcon(playing) {
  const playBtn = document.getElementById('playIcon');
  playBtn.className = playing ? 'ti ti-player-pause' : 'ti ti-player-play';
  const btn = playBtn.closest('.ctrl-btn.play-btn');
  if (btn) {
    btn.classList.toggle('playing', playing);
  }
  const fsi = document.getElementById('fsPlayIcon');
  if (fsi) fsi.className = playing ? 'ti ti-player-pause' : 'ti ti-player-play';
}

async function loadRandomSongs() {
  try {
    const res  = await fetchTimeout(`${ND_URL}/rest/getRandomSongs?size=20&${subsonicParams()}`, {}, 8000);
    const data = await res.json();
    const songs = data['subsonic-response']?.randomSongs?.song || [];
    playerState.playlist = songs;
    playerState.playlistIndex = 0;
    return songs;
  } catch(e) { console.warn('Failed to load songs', e); return []; }
}

async function playSong(song) {
  if (!song) return;
  playerState.currentSong = song;
  updatePlayerUI(song);
  const streamUrl = `${ND_URL}/rest/stream?id=${song.id}&${subsonicParams()}`;
  playerState.audio.src = streamUrl;
  playerState.audio.volume = playerState.volume;
  try {
    await playerState.audio.play();
    playerState.playing = true;
    setPlayIcon(true);
    updateMediaSession(song);
  } catch(e) { console.warn('Playback failed', e); }
}

async function togglePlay() {
  if (playerState.playing) {
    playerState.audio.pause();
    playerState.playing = false;
    setPlayIcon(false);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  } else {
    if (!playerState.currentSong) {
      const songs = await loadRandomSongs();
      if (songs.length) await playSong(songs[0]);
    } else {
      try {
        await playerState.audio.play();
        playerState.playing = true;
        setPlayIcon(true);
      } catch(e) {}
    }
  }
}

async function nextSong() {
  // Check external queue first
  if (typeof queue !== "undefined" && queue.length) {
    const next = queue.shift();
    updateQueueBadge();
    await playSong(next);
    return;
  }
  // Advance playlist index
  const nextIndex = playerState.playlistIndex + 1;
  if (!playerState.playlist.length || nextIndex >= playerState.playlist.length) {
    // End of playlist — load a fresh batch seamlessly
    const fresh = await loadRandomSongs();
    if (fresh.length) {
      playerState.playlist = fresh;
      playerState.playlistIndex = 0;
      await playSong(fresh[0]);
    }
    return;
  }
  playerState.playlistIndex = nextIndex;
  await playSong(playerState.playlist[nextIndex]);
}

async function prevSong() {
  if (!playerState.playlist.length) return;
  // If we're past 3 seconds, restart the current song
  if (playerState.audio.currentTime > 3) {
    playerState.audio.currentTime = 0;
    return;
  }
  // Otherwise, go to the previous song
  playerState.playlistIndex = (playerState.playlistIndex-1+playerState.playlist.length) % playerState.playlist.length;
  await playSong(playerState.playlist[playerState.playlistIndex]);
}

// Progress tracking — dock only. The fullscreen player's own timeupdate
// listener (further below, where _syncFSProgress is defined) handles all
// of its own DOM, gated behind whether FS is actually open; this one used
// to also duplicate that same work unconditionally on every tick
// regardless of FS being visible at all.
playerState.audio.addEventListener('timeupdate', () => {
  if (!playerState.audio.duration) return;
  const pct = playerState.audio.currentTime / playerState.audio.duration;
  if (typeof progSlider !== 'undefined') progSlider.setPct(pct);
});

playerState.audio.addEventListener('ended', nextSong);

// ── SLIDER UTILITY ──
function makeSlider(trackEl, fillEl, dotEl, onChange) {
  let dragging = false;
  // Measured once at drag-start instead of on every mousemove — the track
  // doesn't move or resize mid-drag, so re-measuring on every single
  // pointer event (native mousemove frequency, can easily be 60+/sec) was
  // forcing a synchronous layout read that often for no reason.
  let dragRect = null;
  function getPct(e) {
    const r = (dragging && dragRect) ? dragRect : trackEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  function update(e) {
    const pct = getPct(e);
    fillEl.style.width = (pct*100) + '%';
    dotEl.style.left = (pct*100) + '%';
    onChange(pct);
  }
  function start(e) {
    dragging = true;
    dragRect = trackEl.getBoundingClientRect();
    trackEl.classList.add('dragging');
    update(e);
    e.preventDefault();
    // Only listen on the window while an actual drag is happening — this
    // used to be a permanent listener per slider (5 sliders = 5 handlers
    // firing on every mousemove anywhere on the page, for the whole
    // session) instead of scoped to the drag itself.
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup',   end);
  }
  function move(e) { if (dragging) { update(e); e.preventDefault(); } }
  function end() {
    dragging = false;
    dragRect = null;
    trackEl.classList.remove('dragging');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup',   end);
  }
  trackEl.addEventListener('mousedown', start);
  trackEl.addEventListener('wheel', e => {
    e.preventDefault();
    // No getBoundingClientRect here: the value was never read, but the call
    // still forced a synchronous layout on every wheel tick inside a
    // non-passive handler — i.e. on the scroll-blocking path, over four
    // sliders. Same forced-reflow fix the drag path already got above.
    const cur = parseFloat(fillEl.style.width || '0') / 100;
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const pct = Math.max(0, Math.min(1, cur + delta));
    fillEl.style.width = (pct*100) + '%';
    dotEl.style.left = (pct*100) + '%';
    onChange(pct);
  }, { passive: false });
  return { setPct(pct) {
    fillEl.style.width = (pct*100) + '%';
    dotEl.style.left = (pct*100) + '%';
  }};
}

// Progress slider
const progSlider = makeSlider(
  document.getElementById('playerProgress'),
  document.getElementById('playerProgressFill'),
  document.getElementById('playerProgressDot'),
  pct => { if (playerState.audio.duration) playerState.audio.currentTime = pct * playerState.audio.duration; }
);

// Volume slider
const volSlider = makeSlider(
  document.getElementById('volSlider'),
  document.getElementById('volFill'),
  document.getElementById('volDot'),
  pct => {
    clearInterval(_loginFadeInterval);
    playerState.volume = pct;
    playerState.audio.volume = pct;
    localStorage.setItem(VOLUME_KEY, pct.toFixed(3));
    // fsVolSlider isn't defined yet at setup time (declared further down),
    // but is by the time a user can actually drag this and trigger the
    // callback — same forward-reference pattern as fsProgSlider/progSlider
    // above. Using its own setPct() here instead of hand-duplicating the
    // fill/dot writes matches how fsVolSlider's own onChange keeps this
    // slider in sync in the other direction, below.
    if (typeof fsVolSlider !== 'undefined') fsVolSlider.setPct(pct);
  }
);
volSlider.setPct(playerState.volume);

// FS progress
// Not bound to a name: _syncFSProgress writes the fill/dot directly now,
// but this call still installs #fsProg's own mousedown/wheel handlers.
makeSlider(
  document.getElementById('fsProg'),
  document.getElementById('fsProgFill'),
  document.getElementById('fsProgDot'),
  pct => { if (playerState.audio.duration) playerState.audio.currentTime = pct * playerState.audio.duration; }
);

// FS volume
const fsVolSlider = makeSlider(
  document.getElementById('fsVolBar'),
  document.getElementById('fsVolFill'),
  document.getElementById('fsVolDot'),
  pct => {
    clearInterval(_loginFadeInterval);
    playerState.volume = pct;
    playerState.audio.volume = pct;
    volSlider.setPct(pct);
  }
);
fsVolSlider.setPct(playerState.volume);

document.getElementById('btnPlay').addEventListener('click', togglePlay);
document.getElementById('btnNext').addEventListener('click', nextSong);
document.getElementById('btnPrev').addEventListener('click', prevSong);

// ══════════════════════════════════════════
//  LOGIN SONG
// ══════════════════════════════════════════
const LOGIN_SONG_KEY = 'klabnet_login_song';

// Memoized for the same reason as getFavorites(): renderSongItem() calls
// this once per row, so a 100-song page meant 100 localStorage reads and
// JSON.parses of the same value. `_loginSongCache === undefined` means
// "not read yet"; null is a real, cacheable answer.
let _loginSongCache;
function invalidateLoginSongCache() { _loginSongCache = undefined; }
function getLoginSong() {
  if (_loginSongCache !== undefined) return _loginSongCache;
  try { _loginSongCache = JSON.parse(localStorage.getItem(LOGIN_SONG_KEY)); } catch(e) { _loginSongCache = null; }
  return _loginSongCache;
}

function setLoginSong(song) {
  localStorage.setItem(LOGIN_SONG_KEY, JSON.stringify(song));
  invalidateLoginSongCache();
}

function clearLoginSong() {
  localStorage.removeItem(LOGIN_SONG_KEY);
  invalidateLoginSongCache();
}

// Play login song on load with fade-in
// Tracked at module scope so a manual volume-slider drag during the fade
// (see the volSlider/fsVolSlider callbacks below) can cancel it instead of
// having the fade's next 40ms tick immediately stomp the user's change.
let _loginFadeInterval = null;

async function tryPlayLoginSong() {
  // Was ignored entirely — a login song played unconditionally regardless
  // of this toggle's state, the one settings row that didn't do anything.
  if (!_settings.loginSong) return;
  const song = getLoginSong();
  if (!song) return;
  playerState.audio.volume = 0;
  await playSong(song);
  // Fade in over 2s
  let vol = 0;
  clearInterval(_loginFadeInterval);
  _loginFadeInterval = setInterval(() => {
    vol = Math.min(playerState.volume, vol + 0.02);
    playerState.audio.volume = vol;
    if (vol >= playerState.volume) clearInterval(_loginFadeInterval);
  }, 40);
}

// Attempt login song after a short delay (let page settle)
setTimeout(tryPlayLoginSong, 800);

// ══════════════════════════════════════════
//  SONG PICKER
// ══════════════════════════════════════════
let pickerSongs = [];
let pickerTab   = 'random';
let pickerQuery = '';
let pickerDebounce = null;
// Guards loadPickerTab against out-of-order fetches: switching tabs, or
// typing a new search query, before an earlier request resolves must not
// let that earlier response overwrite the picker with stale results.
let _pickerLoadToken = 0;

const pickerBackdrop = document.getElementById('pickerBackdrop');
const pickerList     = document.getElementById('pickerList');
const pickerSearchEl = document.getElementById('pickerSearch');

// Once the picker has loaded something, reopening it (without switching tabs)
// just shows the same content again — same tab, same scroll position — rather
// than refetching and snapping back to the top.
let _pickerLoaded = false;

// The picker now lives inline in the Music tab-panel instead of behind a
// modal open/close toggle — "loaded" just means "has content ever been
// fetched", triggered either by navigating there via openPicker() or by
// landing on #music directly (see setActiveTab's music-tab hook).
function ensureMusicTabLoaded() {
  ensurePlDelegate();
  // Refreshed every time you land on Music (not gated behind _pickerLoaded
  // below) so the sidebar badge count stays reasonably current across
  // visits without a dedicated poll — cheap since it's one small GET.
  if (typeof fetchMusicRequests === 'function') fetchMusicRequests();
  if (_pickerLoaded) return;
  if (pickerTab !== 'search') { pickerSearchEl.value = ''; pickerQuery = ''; }
  else pickerSearchEl.value = pickerQuery;
  loadPickerTab(pickerTab);
  if (typeof renderPlaylistNav === 'function') renderPlaylistNav();
  _pickerLoaded = true;
}
function openPicker() {
  const onMusic = document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active');
  if (onMusic) {
    // Already here — pressing the button again should feel like "go back"
    // rather than doing nothing. If viewing an album/artist, step back to
    // the browse list; otherwise there's genuinely nowhere else to go.
    const apPanel = document.getElementById('apPanel');
    if (apPanel?.classList.contains('open')) document.getElementById('apBack')?.click();
    return;
  }
  setActiveTab('music');
  ensureMusicTabLoaded();
}
function closePicker() {
  document.getElementById('sortMenu')?.classList.remove('visible');
}

// The artist/album detail view now lives inline in the Music tab-panel too,
// as a sibling of the picker content — no separate overlay to suspend, so
// this just needs to make sure you're on the Music tab before opening it.
function goToMusicDetail(openFn) {
  setActiveTab('music');
  openFn();
}

async function loadPickerTab(tab) {
  pickerTab = tab;
  pickerList.innerHTML = '<div class="picker-empty">loading...</div>';
  const myLoadToken = ++_pickerLoadToken;

  let songs = [];
  try {
    if (tab === 'random') {
      const res  = await fetchTimeout(`${ND_URL}/rest/getRandomSongs?size=30&${subsonicParams()}`, {}, 8000);
      const data = await res.json();
      songs = data['subsonic-response']?.randomSongs?.song || [];
    } else if (tab === 'recent') {
      // Use localStorage play history — most accurate, reflects THIS user's actual plays
      songs = getPlayHistory();
      if (songs.length === 0) {
        // Fallback to Navidrome recently played API
        try {
          const res  = await fetchTimeout(`${ND_URL}/rest/getAlbumList2?type=recent&size=10&${subsonicParams()}`, {}, 8000);
          const data = await res.json();
          const albums = data['subsonic-response']?.albumList2?.album || [];
          for (const album of albums.slice(0, 6)) {
            const r2 = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${album.id}&${subsonicParams()}`, {}, 8000);
            const d2 = await r2.json();
            const tracks = d2['subsonic-response']?.album?.song || [];
            songs.push(...tracks.slice(0, 4));
            if (songs.length >= 25) break;
          }
        } catch(e) {}
      }
    } else if (tab === 'search' && pickerQuery.trim()) {
      const q = encodeURIComponent(pickerQuery.trim());
      const res  = await fetchTimeout(`${ND_URL}/rest/search3?query=${q}&songCount=25&artistCount=15&albumCount=15&${subsonicParams()}`, {}, 8000);
      const data = await res.json();
      const result = data['subsonic-response']?.searchResult3 || {};
      const foundArtists = result.artist || [];
      const foundAlbums  = result.album  || [];
      const foundSongs   = result.song   || [];
      if (myLoadToken !== _pickerLoadToken) return; // superseded by a newer tab switch / search
      pickerList.innerHTML = '';
      if (foundArtists.length) {
        const artLbl = document.createElement('div');
        artLbl.className = 'picker-section-label';
        artLbl.textContent = `Artists (${foundArtists.length})`;
        pickerList.appendChild(artLbl);
        renderArtistSearchResults(foundArtists);
      }
      if (foundAlbums.length) {
        const albLbl = document.createElement('div');
        albLbl.className = 'picker-section-label';
        albLbl.textContent = `Albums (${foundAlbums.length})`;
        pickerList.appendChild(albLbl);
        renderAlbumList(foundAlbums, true); // true = append mode
      }
      if (foundSongs.length) {
        const sngLbl = document.createElement('div');
        sngLbl.className = 'picker-section-label';
        sngLbl.textContent = `Songs (${foundSongs.length})`;
        pickerList.appendChild(sngLbl);
        pickerSongs = foundSongs;
        renderSongItems(foundSongs, pickerList);
      }
      if (!foundArtists.length && !foundAlbums.length && !foundSongs.length) {
        pickerList.innerHTML = '<div class="picker-empty">no results</div>';
      }
      return;
    } else if (tab === 'search') {
      pickerList.innerHTML = '<div class="picker-empty">type to search</div>';
      return;
    }
  } catch(e) {
    if (myLoadToken !== _pickerLoadToken) return;
    pickerList.innerHTML = '<div class="picker-empty">failed to load</div>';
    return;
  }

  if (myLoadToken !== _pickerLoadToken) return; // superseded by a newer tab switch / search
  pickerSongs = songs;
  const tabLabels = {random:'Songs',recent:'Recently Played',search:'Search Results'};
  renderPickerList(songs, tabLabels[pickerTab] || 'Songs');
}

function renderSongItem(song, container) {
  ensureSongRowDelegation();
  const loginSong = getLoginSong();
  const isLogin = loginSong && loginSong.id === song.id;
  const isFav = isFavorite(song.id);
  // size=80 (~2x the 36px list-mode row art) — was 150, oversized for the
  // song picker's always-list-mode rows (songs never render in grid mode).
  const artUrl  = `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=80&${subsonicParams()}`;
  const item = document.createElement('div');
  item.className = 'picker-item' + (isLogin ? ' is-login-song' : '');
  item.innerHTML = `
    <img class="picker-item-art" src="${artUrl}" alt="" loading="lazy" style="opacity:0;transition:opacity 0.3s" onload="this.style.opacity=1" onerror="klabArtFallback(this,'picker-item-art-ph','ti-music')" />
    <div class="picker-item-info">
      <div class="picker-item-title">${esc(song.title) || 'Unknown'}</div>
      <div class="picker-item-artist"><span class="picker-link" data-go-artist="${esc(song.artistId||'')}" data-artist-name="${esc(song.artist||'')}">${esc(song.artist) || 'Unknown Artist'}</span>${song.album ? ' · <span class="picker-link" data-go-album="'+esc(song.albumId)+'" data-album-name="'+esc(song.album)+'">'+esc(song.album)+'</span>' : ''}</div>
    </div>
    <div class="picker-item-actions">
      <span class="type-badge song">song</span>
      <button class="picker-action ${isFav ? 'fav-active' : ''}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}" data-fav>
        <i class="ti ${isFav ? 'ti-heart-filled' : 'ti-heart'}"></i>
      </button>
      <button class="picker-action ${isLogin ? 'login-active' : ''}" title="${isLogin ? 'Clear login song' : 'Set as login song'}" data-login>
        <i class="ti ${isLogin ? 'ti-star-filled' : 'ti-star'}"></i>
      </button>
      <button class="picker-action" title="Add to queue" data-queue>
        <i class="ti ti-playlist-add"></i>
      </button>
      <button class="picker-action" title="Add to playlist" data-add-pl="${encodeURIComponent(JSON.stringify({id:song.id,title:song.title,artist:song.artist,album:song.album,coverArt:song.coverArt}))}">
        <i class="ti ti-playlist"></i>
      </button>
      <button class="picker-action" title="Play now" data-play>
        <i class="ti ti-player-play"></i>
      </button>
    </div>
  `;
  // The song itself, not a serialized copy — the delegated handlers below
  // read it back off the row. This is also what distinguishes a song row
  // from an album/artist row, which share the .picker-item class but keep
  // their own wiring.
  item._song = song;
  container.appendChild(item);
}

// ── Song row event delegation ──────────────────────────
// Every row used to carry seven of its own listeners (link nav, favourite,
// login-song, queue, play, row-click-to-play, context menu). Songs page in
// 100 at a time and pages accumulate, so scrolling the Songs tab through a
// few thousand tracks left tens of thousands of live listeners. These two
// handlers on #pickerList replace all of them, and cost nothing per row.
let _songRowsDelegated = false;
function ensureSongRowDelegation() {
  if (_songRowsDelegated) return;
  const list = document.getElementById('pickerList');
  if (!list) return;
  _songRowsDelegated = true;

  list.addEventListener('click', async e => {
    const row  = e.target.closest('.picker-item');
    const song = row && row._song;
    if (!song) return; // album/artist rows: not ours

    // Artist/album links first — this is what the old per-row handler used
    // capture phase + stopImmediatePropagation for: to beat the row's own
    // click-to-play. In one handler, returning early does the same job.
    const link = e.target.closest('.picker-link');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      SFX && SFX.play('nav');
      if (link.dataset.goArtist && link.dataset.artistName) {
        loadArtistView({ id: link.dataset.goArtist, name: link.dataset.artistName });
      } else if (link.dataset.goAlbum && link.dataset.albumName) {
        const curTab = pickerTab || 'random';
        loadAlbumView(link.dataset.goAlbum, link.dataset.albumName, () => {
          document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
          const tab = document.querySelector('[data-tab="' + curTab + '"]');
          if (tab) tab.classList.add('active');
          loadPickerTab(curTab);
        });
      }
      return;
    }

    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      if (isFavorite(song.id)) removeFavorite(song.id); else addFavorite(song);
      // Repaint just this heart rather than the whole list.
      const nowFav = isFavorite(song.id);
      fav.querySelector('i').className = 'ti ' + (nowFav ? 'ti-heart-filled' : 'ti-heart');
      fav.className = 'picker-action' + (nowFav ? ' fav-active' : '');
      fav.title = nowFav ? 'Remove from favorites' : 'Add to favorites';
      updateFavBadge();
      SFX.play('star');
      return;
    }

    const login = e.target.closest('[data-login]');
    if (login) {
      e.stopPropagation();
      // Read current state rather than a flag captured at render time, so
      // this is still right after another row changed the login song.
      const cur = getLoginSong();
      if (cur && cur.id === song.id) clearLoginSong(); else setLoginSong(song);
      renderPickerList(pickerSongs);
      return;
    }

    const queue = e.target.closest('[data-queue]');
    if (queue) { e.stopPropagation(); addToQueue(song); return; }

    // [data-add-pl] has its own delegated listener (ensurePlDelegate) — bail
    // WITHOUT stopping propagation so the click still reaches it.
    if (e.target.closest('[data-add-pl]')) return;

    const play = e.target.closest('[data-play]');
    if (play) e.stopPropagation();
    else if (e.target.closest('.picker-action')) return; // some other action button

    playerState.playlist = pickerSongs;
    playerState.playlistIndex = pickerSongs.indexOf(song);
    await playSong(song);
  });

  list.addEventListener('contextmenu', e => {
    const row  = e.target.closest('.picker-item');
    const song = row && row._song;
    if (!song) return;
    e.preventDefault();
    showSongCtx(e.clientX, e.clientY, song);
  });
}

// Batch helper: renderSongItem() appends straight into whatever container
// it's given, so a page of 100 songs meant 100 separate insertions into the
// live #pickerList. Building into a fragment and inserting once is the same
// rows for one DOM mutation.
function renderSongItems(songs, container) {
  const frag = document.createDocumentFragment();
  songs.forEach(song => renderSongItem(song, frag));
  container.appendChild(frag);
}

function renderPickerList(songs, label) {
  if (!songs.length) {
    pickerList.innerHTML = '<div class="picker-empty">no tracks found</div>';
    return;
  }
  pickerList.innerHTML = '';
  if (label) {
    const lbl = document.createElement('div');
    lbl.className = 'picker-section-label';
    lbl.textContent = label;
    pickerList.appendChild(lbl);
  }
  renderSongItems(songs, pickerList);
}

// Tab switching
document.querySelectorAll('.picker-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    window.closeApPanel?.(); // else the still-open album/artist page just kept covering the browse view
    document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadPickerTab(tab.dataset.tab);
  });
});

// Search debounce
// Switch to search when the box gets content — no dedicated "Search" nav
// row to mark active any more (the search box itself is the only entry
// point now, so a second "Search" button right below it read as two search
// bars); just clear whichever other row was selected, and drop out of the
// album/artist viewer, which otherwise covers the results.
function enterPickerSearchMode() {
  if (pickerTab === 'search') return;
  window.closeApPanel?.();
  document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.music-playlist-row').forEach(r => r.classList.remove('active'));
  pickerTab = 'search';
}

pickerSearchEl.addEventListener('input', () => {
  // Driven by 'input', not 'keydown': a right-click paste, a dictation
  // insert or an autofill never fires a key event, so typing-by-mouse left
  // pickerTab on whatever section you were in and the debounce below never
  // ran — "using the search bar does nothing" from anywhere but Home.
  if (pickerSearchEl.value) enterPickerSearchMode();
  pickerQuery = pickerSearchEl.value;
  if (pickerTab === 'search') {
    clearTimeout(pickerDebounce);
    pickerDebounce = setTimeout(() => loadPickerTab('search'), 400);
  }
});

pickerSearchEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePicker();
});

pickerBackdrop.addEventListener('click', e => { if (e.target === pickerBackdrop) closePicker(); });


// ── Toast notification flyout — stacked cards hanging off the header
//    buttons' bottom-right corner instead of a lone bottom-center pill ──
const TOAST_DEFAULT_MS = 3200;
function showToast(msg, icon, durationMs, avatarUrl, onClick) {
  const host = document.getElementById('toastFlyout');
  if (!host) return;

  // Cap the stack so a burst of calls doesn't grow the column forever —
  // dismissed through the normal animated path (not a bare .remove())
  // so evicting the oldest toast mid-burst collapses smoothly instead of
  // just popping the rest of the stack up a slot.
  while (host.children.length >= 4) dismissToast(host.firstElementChild);

  const item = document.createElement('div');
  item.className = 'toast-item' + (onClick ? ' clickable' : '');
  // Chat notifications pass the sender's already-resolved avatar (see
  // notifyNewMessage) so the toast shows who's messaging you rather than
  // a generic icon; everything else still gets the plain Tabler icon.
  item.innerHTML = avatarUrl
    ? `<img class="toast-item-avatar" src="${esc(avatarUrl)}" alt="" /><span class="toast-item-msg"></span>`
    : `<i class="ti ${icon || 'ti-bell'} toast-item-icon"></i><span class="toast-item-msg"></span>`;
  item.querySelector('.toast-item-msg').textContent = msg;
  host.appendChild(item);
  // Double rAF so the enter transition reliably fires on the frame after insertion.
  requestAnimationFrame(() => requestAnimationFrame(() => item.classList.add('visible')));

  // A message notification's onClick (jump to that chat) fires alongside
  // the normal dismiss, rather than replacing it — clicking any toast
  // should always at least get it out of the way.
  item.addEventListener('click', () => { dismissToast(item); onClick?.(); });
  item._hide = setTimeout(() => dismissToast(item), durationMs ?? TOAST_DEFAULT_MS);
}
function dismissToast(item) {
  if (item._dismissed) return;
  item._dismissed = true;
  clearTimeout(item._hide);
  item.classList.remove('visible');
  item.classList.add('leaving');
  item.addEventListener('transitionend', () => item.remove(), { once: true });
  setTimeout(() => item.remove(), 700); // fallback if transitionend never fires (fade + delayed collapse together run under this)
}

// ══════════════════════════════════════════
//  PLAYER TOGGLE
// ══════════════════════════════════════════
const PLAYER_VIS_KEY = 'klabnet_player_visible';
let playerVisible = localStorage.getItem(PLAYER_VIS_KEY) !== 'false';
function setPlayerVisible(v) {
  playerVisible = v;
  const dock = document.getElementById('playerDock');
  dock.classList.toggle('hidden', !v);
  document.getElementById('playerToggleIcon').className = v ? 'ti ti-music' : 'ti ti-music-off';
  document.getElementById('playerToggle').classList.toggle('active', !v);
  localStorage.setItem(PLAYER_VIS_KEY, String(v));
  // The dock is position:fixed — hiding it just translates it off-screen
  // (see .player-dock.hidden), so the Chat tab's padding-bottom clearance
  // for it (see body.tab-chat-active .dash) is pure wasted space once
  // it's actually hidden, not something that needs preserving for layout
  // reasons the way it does while the dock is visible and floating on top.
  document.body.classList.toggle('player-hidden', !v);
}
setPlayerVisible(playerVisible);
document.getElementById('playerToggle').addEventListener('click', () => { setPlayerVisible(!playerVisible); SFX.play('click'); });

// ══════════════════════════════════════════
//  FULLSCREEN PLAYER
// ══════════════════════════════════════════
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return m + ':' + (sec<10?'0':'') + sec;
}

function openFS() {
  document.getElementById('fsPlayer').classList.add('open');
  // Pick up the artwork updateFSUI() skipped while this was closed. The
  // class goes on first, so the call below sees an open panel and proceeds.
  if (_fsArtPending) updateFSUI(_fsArtPending);
}
function closeFS() { document.getElementById('fsPlayer').classList.remove('open'); }

document.getElementById('fsClose').addEventListener('click', closeFS);
document.getElementById('btnFS').addEventListener('click', openFS);
document.getElementById('playerArtWrap').addEventListener('click', openFS);
document.getElementById('fsPlayer').addEventListener('click', e => { if (e.target === document.getElementById('fsPlayer')) closeFS(); });

let _fsBgActive = 'A'; // crossfade layer tracker
let _fsBgToken = 0;    // guards against a stale, slow-loading image winning a race
let _fsArtPending = null; // song whose artwork updateFSUI() deferred while FS was closed

function updateFSUI(song) {
  if (!song) {
    document.getElementById('fsTitle').textContent = 'Nothing playing';
    document.getElementById('fsArtist').textContent = '';
    document.getElementById('fsAlbum').textContent = '';
    document.getElementById('fsBgA').style.opacity = '0';
    document.getElementById('fsBgB').style.opacity = '0';
    document.getElementById('fsArt').innerHTML = '<i class="ti ti-music"></i>';
    return;
  }
  document.getElementById('fsTitle').textContent = song.title || 'Unknown';

  // Artist — clickable
  const fsArtistEl = document.getElementById('fsArtist');
  fsArtistEl.innerHTML = '';
  if (song.artistId) {
    const al = document.createElement('span');
    al.className = 'player-link fs-link';
    al.textContent = song.artist || 'Unknown Artist';
    al.addEventListener('click', () => { closeFS(); goToMusicDetail(() => loadArtistView({ id: song.artistId, name: song.artist })); });
    fsArtistEl.appendChild(al);
  } else { fsArtistEl.textContent = song.artist || 'Unknown Artist'; }

  // Album — clickable
  const fsAlbumEl = document.getElementById('fsAlbum');
  fsAlbumEl.innerHTML = '';
  if (song.albumId) {
    const bl = document.createElement('span');
    bl.className = 'player-link fs-link';
    bl.textContent = song.album || '';
    bl.addEventListener('click', () => { closeFS(); goToMusicDetail(() => loadAlbumView(song.albumId, song.album, () => loadPickerTab('albums'))); });
    fsAlbumEl.appendChild(bl);
  } else { fsAlbumEl.textContent = song.album || ''; }

  // Everything above is cheap text/DOM so the panel is correct the instant
  // it opens. Everything below downloads artwork — a viewport-sized
  // background (up to 3200px) plus an 800px cover — and .fs-player is
  // display:none until .open, so on every single track change this was
  // fetching two large images nobody could see. Defer them to openFS().
  if (!document.getElementById('fsPlayer').classList.contains('open')) {
    _fsArtPending = song;
    return;
  }
  _fsArtPending = null;

  const artUrl = `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=800&${subsonicParams()}`;
  // Background is stretched across the whole viewport, so it needs a source
  // sized to the actual screen — a fixed size (this used to be a flat 1600)
  // is fine on a 1080p laptop but visibly blocky once stretched across a
  // 4K/5K/8K display. Scale the request with the real viewport and DPR,
  // capped so a stray 8K + browser zoom combo doesn't request something wild.
  const bgSize = Math.min(3200, Math.round(Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1)));
  const bgUrl  = `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=${bgSize}&${subsonicParams()}`;

  // Crossfade FS background — preload before swap.
  // Skipping tracks faster than the art can download (real risk off-LAN)
  // used to leave multiple loads racing against the same layer, with
  // whichever request happened to finish last winning regardless of
  // whether it matched the song actually playing. A token guard makes
  // only the most recent call's load allowed to apply.
  const myFsBgToken = ++_fsBgToken;
  const next = _fsBgActive === 'A' ? 'B' : 'A';
  const cur  = _fsBgActive;
  const nextEl = document.getElementById('fsBg' + next);
  const curEl  = document.getElementById('fsBg' + cur);
  nextEl.style.opacity = '0';
  nextEl.style.backgroundImage = `url(${bgUrl})`;
  const _fsBgImg = new Image();
  _fsBgImg.onload = () => {
    if (myFsBgToken !== _fsBgToken) return; // a newer track change superseded this load
    nextEl.style.opacity = '0.9';
    curEl.style.opacity  = '0';
    _fsBgActive = next;
  };
  _fsBgImg.src = bgUrl;

  // Crossfade album art
  const fsArt = document.getElementById('fsArt');
  fsArt.style.opacity = '0';
  fsArt.style.transition = 'opacity 0.4s ease';
  setTimeout(() => {
    fsArt.innerHTML = '';
    const img = document.createElement('img');
    img.src = artUrl;
    img.onerror = () => { fsArt.innerHTML = '<i class="ti ti-music"></i>'; };
    fsArt.appendChild(img);
    fsArt.style.opacity = '1';
  }, 200);
}

// FS controls mirror main player
document.getElementById('fsPlay').addEventListener('click', togglePlay);
document.getElementById('fsPrev').addEventListener('click', prevSong);
document.getElementById('fsNext').addEventListener('click', nextSong);

// FS sliders handled by makeSlider

// Sync FS progress bar with audio timeupdate
if (playerState.audio) {
  const _fsPlayerEl   = document.getElementById('fsPlayer');
  const _fsProgFillEl = document.getElementById('fsProgFill');
  const _fsProgDotEl  = document.getElementById('fsProgDot');
  const _fsCurEl       = document.getElementById('fsCur');
  const _fsDurEl       = document.getElementById('fsDur');
  const _fsPlayIconEl  = document.getElementById('fsPlayIcon');
  window._syncFSProgress = function() {
    if (!playerState.audio.duration) return;
    const pct = (playerState.audio.currentTime / playerState.audio.duration) * 100;
    _fsProgFillEl.style.width = pct + '%';
    // fsProgSlider (makeSlider()'s wrapper around this same fill+dot pair)
    // used to be what kept the dot in sync, called from the OTHER
    // timeupdate listener above — that one ran unconditionally on every
    // tick regardless of whether FS was even open, duplicating this
    // gated listener's work. Setting the dot here directly (this listener
    // already skips all its work while FS is closed) replaces that
    // without reintroducing the always-on duplicate.
    _fsProgDotEl.style.left = pct + '%';
    _fsCurEl.textContent = formatTime(playerState.audio.currentTime);
    _fsDurEl.textContent = formatTime(playerState.audio.duration);
    _fsPlayIconEl.className = playerState.playing ? 'ti ti-player-pause' : 'ti ti-player-play';
  };
  playerState.audio.addEventListener('timeupdate', () => {
    // This fires continuously during all playback — skip the work
    // entirely when the fullscreen view isn't even visible. openFS()
    // calls _syncFSProgress() once directly so the view isn't stale
    // for the ~1 tick it'd otherwise take to catch up after opening.
    if (!_fsPlayerEl.classList.contains('open')) return;
    window._syncFSProgress();
  });
}

// ══════════════════════════════════════════
//  QUEUE STATE
// ══════════════════════════════════════════
let queue = [];
function updateQueueBadge() {
  const el = document.getElementById('queueCount');
  if (el) el.textContent = queue.length ? `(${queue.length})` : '';
}
function addToQueue(song) {
  queue.push(song);
  updateQueueBadge();
  showToast(`"${song.title}" added to queue`);
}

