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

// The salt is fixed, so the token is too: hashed once, not per URL.
let _ndToken = null;
function subsonicParams(extraParams='') {
  const token = _ndToken || (_ndToken = md5('KLABNET' + ND_SALT));
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

// Tell Navidrome a song was played, so its play counts (and with them the
// Music Home's "Most played" row) mean something. It only counts a play when
// the player reports one, and this player never did. Standard rule: once
// half the song, or 4 minutes, has actually been heard. Once per play.
let _scrobbledFor = null;
playerState.audio.addEventListener('timeupdate', () => {
  const song = playerState.currentSong, a = playerState.audio;
  // Another device is the one playing it (js/23-session.js): it counts it.
  if (window.klabSession?.mirror) return;
  if (!song || _scrobbledFor === song || !a.duration) return;
  if (a.currentTime < Math.min(a.duration / 2, 240)) return;
  _scrobbledFor = song;
  fetchTimeout(`${ND_URL}/rest/scrobble?id=${encodeURIComponent(song.id)}&submission=true&${subsonicParams()}`, {}, 8000).catch(() => {});
});
playerState.audio.addEventListener('play', () => {
  // replaying the same song from the start counts again
  if (playerState.audio.currentTime < 1) _scrobbledFor = null;
});
// Repeat (audio.loop) starts the song over with a seek, not a new 'play',
// so each time round only counted once without this.
playerState.audio.addEventListener('seeked', () => {
  if (playerState.audio.currentTime < 1) _scrobbledFor = null;
});

// Keeps the "now playing" highlight in any open album/artist track list
// in sync with playback — needed because tracks also advance without a
// click (auto-advance, prev/next, media session, presence sync).
function refreshApNowHighlight() {
  const nowId = playerState?.currentSong?.id;
  document.querySelectorAll('.ap-track').forEach(row => {
    row.classList.toggle('ap-now', nowId != null && row.dataset.songId === String(nowId));
  });
  // And in Music's lists: the song playing is marked wherever it's listed.
  document.querySelectorAll('#pickerList .picker-item').forEach(row => {
    if (row._song) row.classList.toggle('is-now', nowId != null && row._song.id === nowId);
  });
}

// ── TRACK QUALITY ──
// Subsonic hands back the source file's own properties, and Navidrome
// serves /rest/stream to this client untouched (verified: a FLAC request
// comes back `content-type: audio/flac` at the file's full size, no
// transcode), so this describes what you are actually hearing rather than
// what happens to be sitting on the disk. If per-client transcoding is
// ever switched on server-side, this badge stops being true and needs to
// read from the response instead.
const LOSSLESS_SUFFIXES = new Set(['flac','alac','wav','aiff','aif','ape','wv','dsf','dff']);

function songQuality(song) {
  const suffix = (song && song.suffix || '').toLowerCase();
  if (!suffix) return null;
  const lossless = LOSSLESS_SUFFIXES.has(suffix);
  const fmt = suffix.toUpperCase();

  let khz = '';
  if (song.samplingRate) {
    const k = song.samplingRate / 1000;
    // 44.1/88.2 need the decimal, 48/96/192 look wrong carrying ".0".
    khz = (Number.isInteger(k) ? k : k.toFixed(1)) + ' kHz';
  }

  const parts = [];
  // Bit depth is only meaningful for lossless — a "16-bit MP3" isn't a
  // thing, and Navidrome reports one anyway.
  if (lossless && song.bitDepth) parts.push(song.bitDepth + '-bit');
  if (khz) parts.push(khz);
  if (song.bitRate) parts.push(song.bitRate + ' kbps');
  if (song.channelCount === 1) parts.push('Mono');

  // Dock version is the audiophile shorthand ("FLAC 24/44.1"); the full
  // string is the tooltip there and the visible line in fullscreen.
  const short = (lossless && song.bitDepth && song.samplingRate)
    ? `${fmt} ${song.bitDepth}/${(song.samplingRate / 1000).toFixed(1).replace(/\.0$/, '')}`
    : fmt;

  return { lossless, fmt, short, full: [fmt, ...parts].join(' · ') };
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
    ++_dockArtToken; // a cover still loading mustn't land on the idle bar
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
    aLink.textContent = song.artist || 'Unknown artist';
    aLink.title = 'View artist';
    aLink.addEventListener('click', () => goToMusicDetail(() => loadArtistView({ id: song.artistId, name: song.artist })));
    artistEl.appendChild(aLink);
  } else {
    artistEl.textContent = song.artist || 'Unknown artist';
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

  // Quality pill, on the end of the artist/album line. Lossless gets the
  // accent tint; lossy stays neutral, so the distinction is readable at a
  // glance without either one looking like a warning.
  const q = songQuality(song);
  if (q) {
    const pill = document.createElement('span');
    pill.className = 'player-quality' + (q.lossless ? ' lossless' : '');
    pill.textContent = q.short;
    pill.title = q.full;
    artistEl.appendChild(pill);
  }

  // Album art — DOM construction avoids innerHTML escaping bugs
  // size=100 (~2x the 46px dock art box, 36px on mobile) — was 300,
  // fetching/decoding ~6x more pixels than this ever displays.
  const artUrl = `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=100&${subsonicParams()}`;
  // The next song off the same album keeps its cover, and a new cover
  // replaces the old one once it's loaded: the music-note placeholder
  // used to blink in between on every track.
  const old = artWrap.querySelector('img.player-art');
  // Still a new token: a skipped song's cover, still loading, would land here.
  if (old && song.coverArt && old.dataset.cover === song.coverArt) { ++_dockArtToken; return; }
  const myArt = ++_dockArtToken;
  const ph = document.createElement('div');
  ph.className = 'picker-item-art-ph';
  ph.innerHTML = '<i class="ti ti-music"></i>';
  if (!old) { artWrap.innerHTML = ''; artWrap.appendChild(ph); }
  const img = new Image();
  img.className = 'player-art';
  img.alt = 'art';
  img.dataset.cover = song.coverArt || '';
  img.onload = () => { if (myArt === _dockArtToken) artWrap.replaceChildren(img); };
  img.onerror = () => { if (myArt === _dockArtToken) artWrap.replaceChildren(ph); };
  img.src = artUrl;
}
let _dockArtToken = 0;

function setPlayIcon(playing) {
  const playBtn = document.getElementById('playIcon');
  playBtn.className = playing ? 'ti ti-player-pause' : 'ti ti-player-play';
  const btn = playBtn.closest('.ctrl-btn.play-btn');
  if (btn) {
    btn.classList.toggle('playing', playing);
  }
  const fsi = document.getElementById('fsPlayIcon');
  if (fsi) fsi.className = playing ? 'ti ti-player-pause-filled' : 'ti ti-player-play-filled';
  // The buttons say what pressing them does now.
  for (const b of [btn, fsi?.closest('button')]) if (b) { b.title = playing ? 'Pause' : 'Play'; b.setAttribute('aria-label', b.title); }
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

// Set while the login song starts, so it starts at 0 and fades in rather
// than blasting for a moment (playSong's wrappers don't pass options on).
let _playSilently = false;
// What you actually heard, newest last, so Previous goes back to it
// (under shuffle, or after queued songs, the playlist order isn't that).
const _heard = [];
let _goingBack = false;
// Every song started by someone's choice (not the next one coming on by
// itself). A Play that has to fetch first (an album, a genre, a playlist)
// notes this before it waits and gives up if it changed: a song picked in
// the meantime used to be replaced a few seconds later.
let _picks = 0, _autoNext = false;
window.klabPickMark = () => _picks;
async function playSong(song) {
  if (!song) return;
  if (!_autoNext) _picks++;
  const prev = playerState.currentSong;
  if (!_goingBack && prev && prev.id !== song.id) {
    _heard.push(prev);
    if (_heard.length > 100) _heard.shift();
  }
  playerState.currentSong = song;
  updatePlayerUI(song);
  // Another of your devices is the one playing (js/23-session.js): it's
  // sent the song, and this one only shows it.
  if (window.klabSession?.mirrorPlay(song)) return;
  const streamUrl = `${ND_URL}/rest/stream?id=${encodeURIComponent(song.id)}&${subsonicParams()}`;
  playerState.audio.src = streamUrl;
  // Picking another song mid fade-in: the fade would otherwise keep
  // pulling this one's volume back down to where it had got to.
  if (!_playSilently) clearInterval(_loginFadeInterval);
  playerState.audio.volume = _playSilently ? 0 : playerState.volume;
  try {
    await playerState.audio.play();
    playerState.playing = true;
    setPlayIcon(true);
    updateMediaSession(song);
  } catch(e) {
    // A newer playSong() replacing this one isn't a failure.
    if (e && e.name === 'AbortError') return;
    console.warn('Playback failed', e);
    playerState.playing = false;
    setPlayIcon(false);
    // Blocked autoplay (no tap yet) waits for Play; anything else is this
    // track, and the 'error' handler below moves on.
  }
}

// A track that won't play (gone from the server, the network dropped, a
// format the browser can't decode) used to leave the player saying
// "playing" forever with nothing coming out and nothing advancing. Now it
// stops saying so and moves to the next one, giving up after a few in a
// row so a dropped connection doesn't spin through the whole library.
let _failedInARow = 0;
playerState.audio.addEventListener('error', () => {
  if (!playerState.audio.getAttribute('src')) return;
  playerState.playing = false;
  setPlayIcon(false);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  const title = playerState.currentSong?.title;
  if (++_failedInARow > 3) {
    showToast("Couldn't play music right now. Check your connection.", 'ti-wifi-off');
    return;
  }
  showToast(title ? `Couldn't play "${title}", skipping` : "Couldn't play that track, skipping", 'ti-player-skip-forward');
  // Only if it's still the broken one: a song picked in the meantime
  // used to be skipped straight away too.
  const failed = playerState.currentSong;
  setTimeout(() => { if (playerState.currentSong === failed) nextSong(); }, 600);
});
playerState.audio.addEventListener('playing', () => { _failedInARow = 0; });
// Whatever started it (Play after a blocked autoplay, the lock screen, a
// resume), the system's now-playing shows this track.
playerState.audio.addEventListener('play', () => {
  const song = playerState.currentSong;
  if (song && 'mediaSession' in navigator && navigator.mediaSession.metadata?.title !== (song.title || '')) updateMediaSession(song);
});

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
    } else if (!playerState.audio.getAttribute('src') && !window.klabSession?.mirror) {
      // Brought back from last time (klabRestorePlayer): shown, not loaded.
      await playSong(playerState.currentSong);
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
    // Repeat all: round the list again.
    if (_repeatAll && playerState.playlist.length) {
      playerState.playlistIndex = 0;
      await playSong(playerState.playlist[0]);
      return;
    }
    return klabEndOfList();
  }
  playerState.playlistIndex = nextIndex;
  await playSong(playerState.playlist[nextIndex]);
}
// The end of what was playing, repeat off: a fresh batch of random songs,
// so the music doesn't just stop.
async function klabEndOfList() {
  const fresh = await loadRandomSongs();
  if (fresh.length) {
    playerState.playlist = fresh;
    playerState.playlistIndex = 0;
    await playSong(fresh[0]);
  }
}

async function prevSong() {
  // Past 3 seconds in, Previous restarts the song, like every player.
  if (playerState.audio.currentTime > 3) {
    playerState.audio.currentTime = 0;
    return;
  }
  // Otherwise back to what you heard before this, keeping the playlist's
  // place in step when it came from there.
  // _goingBack is only up while playSong starts (it reads it straight
  // away): held across the whole load, a song you picked while this one
  // buffered was left out of the history too.
  const back = _heard.pop();
  if (back) {
    const i = playerState.playlist.findIndex(x => x.id === back.id);
    if (i >= 0) playerState.playlistIndex = i;
    let p;
    _goingBack = true;
    try { p = playSong(back); } finally { _goingBack = false; }
    await p;
    return;
  }
  if (!playerState.playlist.length) { playerState.audio.currentTime = 0; return; }
  playerState.playlistIndex = (playerState.playlistIndex-1+playerState.playlist.length) % playerState.playlist.length;
  let p;
  _goingBack = true;
  try { p = playSong(playerState.playlist[playerState.playlistIndex]); } finally { _goingBack = false; }
  await p;
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

// Arrow functions, not the function itself: shuffle (05-favorites.js)
// replaces the global nextSong later, and a captured reference skipped it.
playerState.audio.addEventListener('ended', () => { _autoNext = true; try { nextSong(); } finally { _autoNext = false; } });

// ── SLIDER UTILITY ──
// Pointer events, so a finger drags it on a phone the same as a mouse
// does (mouse events alone only ever gave touch a tap). onChange gets
// (pct, dragging): true while the drag is still going, false when it's
// let go, clicked or wheeled.
function makeSlider(trackEl, fillEl, dotEl, onChange) {
  let dragging = false;
  let value = parseFloat(fillEl.style.width || '0') / 100;
  // Measured once at drag-start instead of on every move: the track
  // doesn't move or resize mid-drag.
  let dragRect = null;
  function getPct(e) {
    const r = (dragging && dragRect) ? dragRect : trackEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
  }
  function show(pct) {
    value = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
    fillEl.style.transform = `translateY(-50%) scaleX(${value})`;
    trackEl.setAttribute('aria-valuenow', Math.round(value * 100));
    // The dot is placed by this in CSS with a transform, so no layout per tick.
    dotEl.style.setProperty('--pct', value);
  }
  fillEl.style.width = '100%';
  trackEl.tabIndex = 0;
  trackEl.setAttribute('role', 'slider');
  trackEl.setAttribute('aria-valuemin', '0');
  trackEl.setAttribute('aria-valuemax', '100');
  show(value);
  function update(e, live) {
    const pct = getPct(e);
    show(pct);
    onChange(pct, live);
  }
  function start(e) {
    if (e.button !== 0) return;
    dragging = true;
    dragRect = trackEl.getBoundingClientRect();
    trackEl.classList.add('dragging');
    try { trackEl.setPointerCapture(e.pointerId); } catch (err) {}
    update(e, true);
    e.preventDefault();
  }
  function move(e) { if (dragging) { update(e, true); e.preventDefault(); } }
  function end(e) {
    if (!dragging) return;
    dragging = false;
    if (e && e.type === 'pointerup') update(e, false);
    dragRect = null;
    trackEl.classList.remove('dragging');
  }
  trackEl.addEventListener('pointerdown', start);
  trackEl.addEventListener('pointermove', move);
  trackEl.addEventListener('pointerup', end);
  trackEl.addEventListener('pointercancel', end);
  trackEl.addEventListener('lostpointercapture', end);
  trackEl.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || dragging) return;
    const step = e.shiftKey ? 0.1 : 0.05;
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else return;
    e.preventDefault(); e.stopPropagation();
    show(next); onChange(value, false);
  });
  trackEl.addEventListener('wheel', e => {
    if (!e.deltaY || dragging) return;
    e.preventDefault();
    // No getBoundingClientRect here: the wheel path is scroll-blocking.
    const cur = value;
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const pct = Math.max(0, Math.min(1, cur + delta));
    show(pct);
    onChange(pct, false);
  }, { passive: false });
  return {
    // The playing position doesn't pull the bar out from under a drag.
    setPct(pct) { if (!dragging) show(pct); },
    get dragging() { return dragging; },
  };
}

// Seeking while dragging: at most four real seeks a second (each one can
// be a new range request on a lossless stream), and always one where the
// drag ends. The scratch sound follows the hand the whole way.
let _lastDragSeek = 0;
function seekTo(pct, live) {
  const a = playerState.audio;
  if (!a.duration) return;
  const t = pct * a.duration;
  scratchSeek(t);
  const now = performance.now();
  if (live && now - _lastDragSeek < 250) return;
  _lastDragSeek = now;
  a.currentTime = t;
}

// Seeking scratches the record: the direction and how hard follow your
// hand on the bar (a click is one quick zip toward where you clicked).
let _scratchAt = 0;
function scratchSeek(newTime) {
  const a = playerState.audio;
  if (typeof SFX === 'undefined' || !a.duration || !playerState.currentSong) return;
  const d = newTime - a.currentTime;
  const now = performance.now();
  if (Math.abs(d) < 0.25 || now - _scratchAt < 55) return;
  _scratchAt = now;
  SFX.play('scratch', { dir: Math.sign(d), amt: Math.min(1, Math.abs(d) / Math.max(10, a.duration * 0.3)) });
}

// Progress slider
const progSlider = makeSlider(
  document.getElementById('playerProgress'),
  document.getElementById('playerProgressFill'),
  document.getElementById('playerProgressDot'),
  seekTo
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
    if (pct > 0) playerState.audio.muted = false; // turning it up is asking to hear it
    try { localStorage.setItem(VOLUME_KEY, pct.toFixed(3)); } catch (e) {}
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

// FS progress (_syncFSProgress writes its fill/dot; this is the dragging).
const fsProgSlider = makeSlider(
  document.getElementById('fsProg'),
  document.getElementById('fsProgFill'),
  document.getElementById('fsProgDot'),
  seekTo
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
    if (pct > 0) playerState.audio.muted = false;
    volSlider.setPct(pct);
    try { localStorage.setItem(VOLUME_KEY, pct.toFixed(3)); } catch (e) {}
  }
);
fsVolSlider.setPct(playerState.volume);

document.getElementById('btnPlay').addEventListener('click', togglePlay);
document.getElementById('btnNext').addEventListener('click', () => nextSong());
document.getElementById('btnPrev').addEventListener('click', () => prevSong());

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
  try { localStorage.setItem(LOGIN_SONG_KEY, JSON.stringify(song)); } catch (e) {}
  invalidateLoginSongCache();
}
// Just the rows' door buttons, however the login song was changed (a row's
// own button or the song menu). Re-rendering the list threw away whatever
// else the view had (search sections, a playlist's controls, infinite scroll).
function syncLoginSongRows() {
  const nowId = getLoginSong()?.id;
  document.querySelectorAll('.picker-item').forEach(r => {
    if (!r._song) return;
    const on = r._song.id === nowId;
    r.classList.toggle('is-login-song', on);
    const b = r.querySelector('[data-login]');
    if (!b) return;
    b.classList.toggle('login-active', on);
    b.title = on ? 'Clear login song' : 'Set as login song';
  });
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
  // Music already playing on another of your devices isn't interrupted
  // (there, or by this) for a login song.
  await window.klabSession?.ready;
  if (window.klabSession?.remote) return;
  _playSilently = true;
  let p;
  try { p = playSong(song); } finally { _playSilently = false; }
  await p;
  // Something else picked while it loaded: that one plays at your volume,
  // not faded up from silence.
  if (playerState.currentSong !== song) return;
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
  // Playlists too: other people feature and change theirs.
  window.klabPlaylists?.refreshIfStale();
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
  if (document.getElementById('pickerSortBtn')?.getAttribute('aria-expanded') === 'true') klabMenu.close();
}

// The artist/album detail view now lives inline in the Music tab-panel too,
// as a sibling of the picker content — no separate overlay to suspend, so
// this just needs to make sure you're on the Music tab before opening it.
function goToMusicDetail(openFn) {
  setActiveTab('music');
  openFn();
}

// Random songs for Home's shuffle picks. Asked again once if they come
// back empty or not at all: an empty answer left "No tracks found" on
// Music until Home was pressed.
async function fetchRandomSongs() {
  const once = async () => {
    const r = await fetchTimeout(`${ND_URL}/rest/getRandomSongs?size=30&${subsonicParams()}`, {}, 8000);
    const d = await r.json();
    const songs = d['subsonic-response']?.randomSongs?.song || [];
    if (!songs.length) console.warn('[music] no random songs', r.status, d['subsonic-response']?.status, d['subsonic-response']?.error);
    return songs;
  };
  try { const s = await once(); if (s.length) return s; } catch (e) { console.warn('[music] random songs failed', e); }
  await new Promise(r => setTimeout(r, 1500));
  return once();
}

// Sections something can ask for; anything else (an old link, a stale
// saved state) opens Home, not an empty list.
const PICKER_TABS = new Set(['random', 'recent', 'search', 'songs', 'albums', 'artists', 'genres', 'favorites', 'playlists', 'requests', 'activity', 'radio']);

async function loadPickerTab(tab) {
  if (!PICKER_TABS.has(tab)) { console.warn('[music] unknown section', tab); tab = 'random'; }
  pickerTab = tab;
  const myLoadToken = ++_pickerLoadToken;
  // Home is a front page for the library (js/15-music-home.js), drawn at
  // once: only its "Shuffle picks" wait for these random songs.
  if (tab === 'random' && window.klabRenderMusicHome) {
    const songs = fetchRandomSongs();
    songs.catch(() => {});
    window.klabRenderMusicHome(pickerList, songs, () => loadPickerTab('random'));
    return;
  }
  // A new search keeps the last results up, dimmed, until its own arrive:
  // blanking them at every pause in typing jumped the page back to the top.
  if (tab === 'search' && pickerQuery.trim() && pickerList.querySelector('.picker-item')) pickerList.classList.add('is-stale');
  else pickerList.innerHTML = '<div class="picker-empty" data-wait>Loading…</div>';

  let songs = [];
  try {
    if (tab === 'random') {
      songs = await fetchRandomSongs();
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
            const r2 = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${encodeURIComponent(album.id)}&${subsonicParams()}`, {}, 8000);
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
      pickerList.classList.remove('is-stale');
      if (foundArtists.length) {
        const artLbl = document.createElement('div');
        artLbl.className = 'picker-section-label';
        artLbl.innerHTML = `Artists <span class="k-count">${foundArtists.length}</span>`;
        pickerList.appendChild(artLbl);
        renderArtistSearchResults(foundArtists);
      }
      if (foundAlbums.length) {
        const albLbl = document.createElement('div');
        albLbl.className = 'picker-section-label';
        albLbl.innerHTML = `Albums <span class="k-count">${foundAlbums.length}</span>`;
        pickerList.appendChild(albLbl);
        renderAlbumList(foundAlbums, true); // true = append mode
      }
      if (foundSongs.length) {
        const sngLbl = document.createElement('div');
        sngLbl.className = 'picker-section-label';
        sngLbl.innerHTML = `Songs <span class="k-count">${foundSongs.length}</span>`;
        pickerList.appendChild(sngLbl);
        pickerSongs = foundSongs;
        renderSongItems(foundSongs, pickerList);
      }
      if (!foundArtists.length && !foundAlbums.length && !foundSongs.length) {
        pickerList.innerHTML = '<div class="picker-empty">No results</div>';
      }
      return;
    } else if (tab === 'search') {
      pickerList.innerHTML = '<div class="picker-empty">Type to search</div>';
      return;
    }
  } catch(e) {
    if (myLoadToken !== _pickerLoadToken) return;
    pickerList.classList.remove('is-stale');
    pickerList.innerHTML = '<div class="picker-empty">Couldn’t load this</div>';
    return;
  }

  if (myLoadToken !== _pickerLoadToken) return; // superseded by a newer tab switch / search
  pickerSongs = songs;
  const tabLabels = {random:'Songs',recent:'Recently played',search:'Search results'};
  renderPickerList(songs, tabLabels[pickerTab] || 'Songs');
}

function renderSongItem(song, container) {
  ensureSongRowDelegation();
  const loginSong = getLoginSong();
  const isLogin = loginSong && loginSong.id === song.id;
  const isNow = playerState.currentSong?.id === song.id;
  // size=80 (~2x the 36px list-mode row art) — was 150, oversized for the
  // song picker's always-list-mode rows (songs never render in grid mode).
  const artUrl  = `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=80&${subsonicParams()}`;
  const item = document.createElement('div');
  item.className = 'picker-item' + (isLogin ? ' is-login-song' : '') + (isNow ? ' is-now' : '');
  item.innerHTML = `
    <img class="picker-item-art" src="${artUrl}" alt="" loading="lazy" onload="this.classList.add('loaded')" onerror="klabArtFallback(this,'picker-item-art-ph','ti-music')" />
    <div class="picker-item-info">
      <div class="picker-item-title">${esc(song.title) || 'Unknown'}</div>
      <div class="picker-item-artist"><span class="picker-link" data-go-artist="${esc(song.artistId||'')}" data-artist-name="${esc(song.artist||'')}">${esc(song.artist) || 'Unknown artist'}</span>${song.album ? ' · <span class="picker-link" data-go-album="'+esc(song.albumId)+'" data-album-name="'+esc(song.album)+'">'+esc(song.album)+'</span>' : ''}</div>
    </div>
    <span class="np-eq" aria-hidden="true"><i></i><i></i><i></i></span>
    ${song.duration ? `<span class="picker-item-dur">${Math.floor(song.duration / 60)}:${String(song.duration % 60).padStart(2, '0')}</span>` : ''}
    <div class="picker-item-actions">${klabSongActsHTML(song)}</div>
  `;
  // The song itself, not a serialized copy — the delegated handlers below
  // read it back off the row. This is also what distinguishes a song row
  // from an album/artist row, which share the .picker-item class but keep
  // their own wiring.
  item._song = song;
  item.dataset.star = 'song:' + song.id;
  container.appendChild(item);
}

// ── One set of actions on every song row ──
// ♥, Add to queue and ⋯ (the song's menu: Play next, Add to playlist, the
// login song, downloads…), shown on hover (the heart stays when it's on).
// Pressing the row plays it. Used by Music's lists, the album and artist
// pages (js/13-tail.js); the row
// carries ._song (and ._list, the list it plays from, where that isn't
// Music's own pickerSongs).
function klabSongActsHTML(song) {
  return `<div class="song-acts">${klabHeartHTML('song', song.id, 'k-icon sm')}` +
    `<button type="button" class="k-icon sm" data-act="queue" title="Add to queue" aria-label="Add to queue"><i class="ti ti-playlist-add"></i></button>` +
    `<button type="button" class="k-icon sm" data-act="more" title="More" aria-label="More" aria-haspopup="menu"><i class="ti ti-dots"></i></button></div>`;
}
function _songHost(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n._song) return n;
  return null;
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('.song-acts [data-act]');
  if (!b) return;
  // Before the row hears it (the row plays).
  e.stopPropagation();
  const host = _songHost(b);
  const song = host?._song;
  if (!song) return;
  const act = b.dataset.act;
  if (act === 'queue') addToQueue(song);
  else if (act === 'more') {
    const list = host._list || (host.closest('#pickerList') ? pickerSongs : null);
    klabSongMenuAt(b, song, list);
  }
}, true);

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
          document.querySelectorAll('.picker-tab[data-tab]').forEach(t => t.classList.remove('active'));
          const tab = document.querySelector('[data-tab="' + curTab + '"]');
          if (tab) tab.classList.add('active');
          loadPickerTab(curTab);
        });
      }
      return;
    }

    // The row's own buttons (js: klabSongActsHTML) are handled before this.
    if (e.target.closest('.song-acts')) return;

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
    console.warn('[music] empty list', pickerTab, label);
    pickerList.innerHTML = '<div class="picker-empty">No tracks found</div>';
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
document.querySelectorAll('.picker-tab[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    window.closeApPanel?.(); // else the still-open album/artist page just kept covering the browse view
    // Leaving a search for a section: the box empties (it kept the words
    // over a view they had nothing to do with).
    if (pickerSearchEl.value) { pickerSearchEl.value = ''; pickerQuery = ''; clearTimeout(pickerDebounce); }
    document.querySelectorAll('.picker-tab[data-tab]').forEach(t => t.classList.remove('active'));
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
// The section you were in before searching, to go back to when the box
// is emptied (it used to stay on a blank "Type to search").
let _preSearchTab = null;
function enterPickerSearchMode() {
  if (pickerTab === 'search') return;
  _preSearchTab = document.querySelector('.picker-tab[data-tab].active')?.dataset.tab || 'random';
  window.closeApPanel?.();
  document.querySelectorAll('.picker-tab[data-tab]').forEach(t => t.classList.remove('active'));
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
  if (!pickerQuery && pickerTab === 'search') {
    clearTimeout(pickerDebounce);
    document.querySelector(`.picker-tab[data-tab="${_preSearchTab || 'random'}"]`)?.click();
    return;
  }
  if (pickerTab === 'search') {
    clearTimeout(pickerDebounce);
    pickerDebounce = setTimeout(() => loadPickerTab('search'), 400);
  }
});

pickerSearchEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePicker();
});

pickerBackdrop.addEventListener('click', e => { if (e.target === pickerBackdrop) closePicker(); });


// ══════════════════════════════════════════
//  TOASTS (redone 2026-11-21, the owner: "redo the notification system to
//  make them cleaner, more interactable, more manageable", "mostly talking
//  about the toasts")
//  Two looks from one call:
//    · a quick one: a slim line with a small glyph ("Saved", Undo), and
//    · a notification: a card for something that happened (msg is
//      { title, body }, or it's about a person): face, title, time, two
//      lines, and its buttons on it (Reply, Mark read, Call back, Watch).
//  They stack under the title bar's right, newest on top with up to two
//  peeking behind; pointing at the stack fans it out and holds every
//  timer (a hairline under each shows its time). Each has × (and swipe it
//  right), Clear all shows with two or more, right-click has the rest.
//  `group` folds a burst into one card with a count (a conversation's
//  messages); window.klabToasts.dismissGroup(g) takes one away (opening
//  that conversation does).
//
//  showToast(msg, icon, durationMs, avatarUrl, onClick, opts), or
//  showToast(msg, icon, opts). msg: text, or { title, body }. icon: a
//  Tabler class, toastArt(coverArt), toastPerson(username). opts:
//    action { label, run } / actions [{ label, icon, run, keep }]: buttons
//      (keep: the toast stays after);
//    onReply(text): a Reply button and a field (resolve = sent, throw =
//      keep the field);
//    group: a key that folds into an existing toast; menu: () => klabMenu
//      items for right-click; sticky: stays until closed; onClose(): the
//      person closed it; onGone(): it left, however (klabUndo commits).
//  Returns the toast's element.
// ══════════════════════════════════════════
const TOAST_DEFAULT_MS = 3200;
const TOAST_NOTE_MS = 7000;
const TOAST_MAX = 6;
function toastArt(coverArt) {
  return coverArt ? { art: `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(coverArt)}&size=120&${subsonicParams()}` } : 'ti-music';
}
function toastPerson(username) { return { person: String(username || '').replace(/^@/, '').split(':')[0] }; }
function toastIconHTML(icon, avatarUrl) {
  if (avatarUrl) return `<img class="tst-pic face" src="${esc(avatarUrl)}" alt="" />`;
  if (icon && icon.art) return `<img class="tst-pic" src="${esc(icon.art)}" alt="" />`;
  if (icon && icon.person) {
    const u = icon.person;
    const url = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(u) : null;
    if (url) return `<img class="tst-pic face" src="${esc(url)}" alt="" />`;
    const color = typeof profileColor === 'function' ? profileColor(u) : 'var(--text-dim)';
    return `<span class="tst-pic face tst-initial" style="--c:${color}">${esc((u[0] || '?').toUpperCase())}</span>`;
  }
  return `<span class="tst-pic tst-glyph"><i class="ti ${typeof icon === 'string' && icon ? icon : 'ti-bell'}"></i></span>`;
}

const _toast = { host: null, open: false, closeT: 0, clear: null, tickT: 0 };
const toastLive = () => _toast.host ? [..._toast.host.querySelectorAll(':scope > .toast-item:not(.leaving)')] : [];
const toastAgo = t => { const s = (Date.now() - t) / 1000; return s < 45 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'; };

function toastHost() {
  if (_toast.host) return _toast.host;
  const host = document.getElementById('toastFlyout');
  if (!host) return null;
  _toast.host = host;
  // Clear all: shown while the stack is fanned out with two or more.
  const clear = document.createElement('button');
  clear.type = 'button'; clear.className = 'tst-clear'; clear.hidden = true;
  clear.innerHTML = '<i class="ti ti-x"></i>Clear all';
  clear.addEventListener('click', () => { toastLive().forEach(t => dismissToast(t, { closed: true })); });
  host.appendChild(clear);
  _toast.clear = clear;
  // Pointing at the stack fans it out and holds the timers; leaving it
  // folds it back after a moment (so the gaps between cards don't).
  host.addEventListener('pointerover', () => { clearTimeout(_toast.closeT); if (!_toast.open) toastFan(true); });
  host.addEventListener('pointerout', e => {
    if (host.contains(e.relatedTarget)) return;
    clearTimeout(_toast.closeT);
    _toast.closeT = setTimeout(() => { if (!host.matches(':focus-within') && !host.querySelector('.replying')) toastFan(false); }, 260);
  });
  host.addEventListener('focusin', () => { clearTimeout(_toast.closeT); if (!_toast.open) toastFan(true); });
  host.addEventListener('focusout', e => { if (!host.contains(e.relatedTarget) && !host.matches(':hover')) toastFan(false); });
  return host;
}
function toastFan(on) {
  // Folding away from a Reply that was never typed in: it goes back to
  // being a card that times out (left replying, it was held for good,
  // behind whatever came next).
  if (!on) toastLive().forEach(t => { if (t.classList.contains('replying') && !t.querySelector('.tst-reply input')?.value.trim()) t.classList.remove('replying'); });
  _toast.open = on;
  _toast.host?.classList.toggle('open', on);
  toastLive().forEach(t => on ? toastHold(t) : toastResume(t));
  toastLayout();
}

// Where each card sits. Folded: the newest in front, two behind it at the
// front's height, a little lower and smaller. Fanned: one under another.
function toastLayout() {
  const host = _toast.host;
  if (!host) return;
  const items = toastLive();
  const open = _toast.open || items.length <= 1;
  const frontH = items[0]?._card.offsetHeight || 0;
  let y = 0;
  items.forEach((t, i) => {
    const h = t._card.offsetHeight;
    if (open) {
      t.style.height = h + 'px';
      t.style.transform = `translate3d(0, ${y}px, 0)`;
      t.style.opacity = '';
      t.classList.remove('behind');
      y += h + 8;
    } else {
      t.style.height = (i ? frontH : h) + 'px';
      t.style.transform = `translate3d(0, ${Math.min(i, 2) * 9}px, 0) scale(${1 - Math.min(i, 3) * 0.05})`;
      t.style.opacity = i > 2 ? '0' : '';
      t.classList.toggle('behind', i > 0);
    }
    t.style.zIndex = String(50 - i);
  });
  if (!open) y = frontH + Math.min(items.length - 1, 2) * 9 + 8;
  host.style.height = Math.max(0, y) + 'px';
  const c = _toast.clear;
  if (c) {
    c.hidden = !(open && items.length >= 2);
    c.style.transform = `translate3d(0, ${y}px, 0)`;
  }
  // The times ("now", "2m") while anything with one is up.
  clearInterval(_toast.tickT); _toast.tickT = 0;
  if (items.some(t => t._at && t.classList.contains('note'))) {
    _toast.tickT = setInterval(() => toastLive().forEach(t => { const e = t.querySelector('.tst-time'); if (e) e.textContent = toastAgo(t._at); }), 30000);
  }
}

// The time left, held while the stack is fanned out or something's typed.
function toastArm(t, ms) {
  clearTimeout(t._hide); t._hide = 0;
  // setTimeout(f, Infinity) runs at once (it's clamped to 0): an endless
  // time is sticky.
  if (!Number.isFinite(ms)) t._sticky = true;
  t.classList.toggle('sticky', !!t._sticky);
  if (t._sticky) { t.style.removeProperty('--tst-ms'); return; }
  t._left = ms; t._since = performance.now();
  t.style.setProperty('--tst-ms', ms + 'ms');
  // Restart the hairline.
  t.classList.remove('timing'); void t.offsetWidth; t.classList.add('timing');
  if (_toast.open || t.classList.contains('replying')) { toastHold(t); return; }
  t._hide = setTimeout(() => dismissToast(t), ms);
}
function toastHold(t) {
  if (!t._hide) return;
  clearTimeout(t._hide); t._hide = 0;
  t._left = Math.max(1500, t._left - (performance.now() - t._since));
  t.classList.add('held');
}
function toastResume(t) {
  if (t._hide || t._sticky || t._dismissed || t.classList.contains('replying')) return;
  t.classList.remove('held');
  t._since = performance.now();
  t._hide = setTimeout(() => dismissToast(t), t._left ?? TOAST_DEFAULT_MS);
}

function toastRender(t) {
  const s = t._spec;
  const note = t.classList.contains('note');
  const title = s.msg && typeof s.msg === 'object' ? s.msg.title || '' : '';
  const body = s.msg && typeof s.msg === 'object' ? s.msg.body || '' : String(s.msg ?? '');
  const acts = (s.actions || []).map((a, i) =>
    `<button type="button" class="k-btn sm${note ? ' ghost' : ''} tst-act" data-i="${i}">${a.icon ? `<i class="ti ${esc(a.icon)}"></i>` : ''}${esc(a.label || 'Undo')}</button>`).join('');
  const reply = s.onReply ? `<button type="button" class="k-btn sm ghost tst-act tst-reply-btn"><i class="ti ti-arrow-back-up"></i>Reply</button>` : '';
  if (note) {
    t._card.innerHTML =
      toastIconHTML(s.icon, s.avatarUrl) +
      `<div class="tst-main">` +
        `<div class="tst-top"><span class="tst-title"></span>${t._count > 1 ? `<span class="tst-count">${t._count}</span>` : ''}<span class="tst-time">${toastAgo(t._at)}</span></div>` +
        (body ? `<div class="tst-body"></div>` : '') +
        (acts || reply ? `<div class="tst-acts">${reply}${acts}</div>` : '') +
        (s.onReply ? `<form class="tst-reply"><input type="text" maxlength="4000" placeholder="Reply…" autocomplete="off" aria-label="Reply" /><button type="submit" class="k-icon" title="Send" aria-label="Send"><i class="ti ti-send-2"></i></button></form>` : '') +
      `</div>` +
      `<button type="button" class="tst-x" title="Close" aria-label="Close"><i class="ti ti-x"></i></button>`;
    t._card.querySelector('.tst-title').textContent = title || body;
    const b = t._card.querySelector('.tst-body');
    if (b) b.textContent = title ? body : '';
    if (b && !title) b.remove();
  } else {
    t._card.innerHTML = toastIconHTML(s.icon, s.avatarUrl) + `<span class="tst-text"></span>${acts}` +
      `<button type="button" class="tst-x" title="Close" aria-label="Close"><i class="ti ti-x"></i></button>`;
    t._card.querySelector('.tst-text').textContent = title ? title + (body ? ' · ' + body : '') : body;
  }
  t.classList.toggle('clickable', !!s.onClick);
}

function showToast(msg, icon, durationMs, avatarUrl, onClick, opts) {
  // showToast(msg, icon, { action, onGone, ms }) works too.
  if (durationMs && typeof durationMs === 'object') { opts = durationMs; durationMs = opts.ms; }
  opts = opts || {};
  onClick = onClick || opts.onClick;
  const host = toastHost();
  if (!host) return null;
  const actions = opts.actions ? [...opts.actions] : opts.action ? [opts.action] : [];
  const spec = { msg, icon, avatarUrl, onClick, actions, onReply: opts.onReply, menu: opts.menu, onClose: opts.onClose };
  const note = !!((msg && typeof msg === 'object' && msg.title) || avatarUrl || icon?.person || opts.note || opts.onReply);
  const ms = opts.sticky ? Infinity : durationMs ?? (note ? TOAST_NOTE_MS : TOAST_DEFAULT_MS);

  // The same group: that card again, its count up, back on top.
  let t = opts.group ? toastLive().find(x => x._group === opts.group) : null;
  if (t) {
    t._count++;
    t._at = Date.now();
    t._spec = spec;
    t._sticky = !!opts.sticky;
    if (opts.onGone) t._onGone = opts.onGone;
    if (t.classList.contains('replying')) {
      // Don't lose what's being typed: just the words and the count.
      const top = t.querySelector('.tst-title'), b = t.querySelector('.tst-body');
      if (top && msg?.title) top.textContent = msg.title;
      if (b && msg?.body) b.textContent = msg.body;
      let c = t.querySelector('.tst-count');
      if (!c) { c = document.createElement('span'); c.className = 'tst-count'; top?.after(c); }
      c.textContent = t._count;
    } else toastRender(t);
    if (t !== toastLive()[0]) {
      // Moving it blurs a reply being typed in it: put the caret back.
      const f = t.contains(document.activeElement) ? document.activeElement : null;
      const sel = f && 'selectionStart' in f ? [f.selectionStart, f.selectionEnd] : null;
      host.prepend(t);
      if (f) { try { f.focus({ preventScroll: true }); if (sel) f.setSelectionRange(sel[0], sel[1]); } catch {} }
    }
    t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump');
    toastArm(t, ms);
    requestAnimationFrame(toastLayout);
    return t;
  }

  t = document.createElement('div');
  t.className = 'toast-item' + (note ? ' note' : ' quick');
  t.setAttribute('role', note ? 'alert' : 'status');
  t._card = document.createElement('div');
  t._card.className = 'tst-card';
  t.appendChild(t._card);
  t._spec = spec; t._group = opts.group || null; t._count = 1; t._at = Date.now();
  t._sticky = !!opts.sticky;
  if (opts.onGone) t._onGone = opts.onGone;
  toastRender(t);
  host.prepend(t);
  // Too many: the oldest quick ones go first, then the oldest of any.
  let live = toastLive();
  while (live.length > TOAST_MAX) {
    // (Never the one just shown: a "Saved" over six notes went at once.)
    const old = [...live].reverse().find(x => x !== t && !x.classList.contains('note') && !x._sticky) || live[live.length - 1];
    dismissToast(old);
    live = toastLive();
  }
  toastWire(t);
  // Enter: the card drops in (css .toast-item:not(.visible) .tst-card);
  // the box itself is where toastLayout puts it from the start.
  toastLayout();
  requestAnimationFrame(() => requestAnimationFrame(() => { t.classList.add('visible'); toastLayout(); }));
  toastArm(t, ms);
  if (!t._ro && 'ResizeObserver' in window) { t._ro = new ResizeObserver(() => toastLayout()); t._ro.observe(t._card); }
  return t;
}

function toastWire(t) {
  t.addEventListener('click', e => {
    if (t._dragged) { t._dragged = false; return; }
    const s = t._spec;
    if (e.target.closest('.tst-x')) { e.stopPropagation(); dismissToast(t, { closed: true }); return; }
    const a = e.target.closest('.tst-act');
    if (a) {
      e.stopPropagation();
      if (a.classList.contains('tst-reply-btn')) { toastReply(t); return; }
      const act = s.actions[+a.dataset.i];
      try { act?.run?.(); } catch (err) { console.error('[toast]', err); }
      if (!act?.keep) dismissToast(t);
      return;
    }
    if (e.target.closest('.tst-reply')) return;
    if (!s.onClick) return;
    dismissToast(t);
    try { s.onClick(); } catch (err) { console.error('[toast]', err); }
  });
  t.addEventListener('submit', async e => {
    e.preventDefault();
    const input = t.querySelector('.tst-reply input');
    const text = input?.value.trim();
    if (!text || !t._spec.onReply) return;
    input.disabled = true;
    try {
      await t._spec.onReply(text);
      t.classList.remove('replying');
      t.classList.add('replied');
      const b = t.querySelector('.tst-body');
      if (b) b.textContent = 'You: ' + text;
      t._sticky = false;
      toastArm(t, 1600);
      if (!_toast.open) toastResume(t);
    } catch (err) { input.disabled = false; input.focus(); }
  });
  t.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (t.classList.contains('replying')) { t.classList.remove('replying'); t.querySelector('.tst-reply-btn')?.focus(); toastLayout(); }
    else dismissToast(t, { closed: true });
  });
  t.addEventListener('contextmenu', e => {
    e.preventDefault();
    const s = t._spec;
    const extra = typeof s.menu === 'function' ? s.menu() || [] : [];
    klabMenu(e, [
      ...(s.onClick ? [{ label: 'Open', icon: 'ti-chevron-right', action: () => { dismissToast(t); s.onClick(); } }] : []),
      ...(s.onReply ? [{ label: 'Reply', icon: 'ti-arrow-back-up', action: () => toastReply(t) }] : []),
      ...extra,
      '-',
      { label: 'Close', icon: 'ti-x', action: () => dismissToast(t, { closed: true }) },
      ...(toastLive().length > 1 ? [{ label: 'Clear all', icon: 'ti-clear-all', action: () => toastLive().forEach(x => dismissToast(x, { closed: true })) }] : []),
      { label: 'Notification settings', icon: 'ti-settings', action: () => { const r = document.getElementById('setNotif'); if (window.klabShowSetting && r) window.klabShowSetting(r); else openSettings?.(); } },
    ]);
  });
  // Swipe it right (a mouse drag too) to close it.
  t.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button, input, form, a')) return;
    const x0 = e.clientX, y0 = e.clientY, t0 = performance.now();
    let dx = 0, going = false;
    const move = ev => {
      dx = ev.clientX - x0;
      if (!going && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(ev.clientY - y0)) { going = true; t.classList.add('dragging'); try { t.setPointerCapture(e.pointerId); } catch {} }
      if (going) { t.style.translate = Math.max(-12, dx) + 'px 0'; t.style.setProperty('--drag', Math.min(1, Math.max(0, dx) / 160)); }
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (!going) return;
      t._dragged = true;
      setTimeout(() => { t._dragged = false; }, 0);
      t.classList.remove('dragging');
      const v = dx / Math.max(1, performance.now() - t0);
      if (dx > 90 || v > 0.6) { t.classList.add('swiped'); dismissToast(t, { closed: true }); }
      else { t.style.translate = ''; t.style.removeProperty('--drag'); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
}
function toastReply(t) {
  t.classList.add('replying');
  toastHold(t);
  const input = t.querySelector('.tst-reply input');
  input?.focus();
  toastLayout();
}

// It slides off to the right and fades, and the rest close up (they're
// laid out by transform, so they glide). opts.closed: the person closed it.
function dismissToast(item, opts) {
  if (!item || item._dismissed) return;
  item._dismissed = true;
  clearTimeout(item._hide);
  item._ro?.disconnect();
  item.classList.remove('visible');
  item.classList.add('leaving');
  if (opts?.closed) { try { item._spec?.onClose?.(); } catch (err) { console.error('[toast]', err); } }
  toastLayout();
  let done = false;
  const gone = () => {
    if (done) return; done = true;
    item.remove();
    const f = item._onGone; item._onGone = null;
    try { f?.(); } catch (err) { console.error('[toast]', err); }
    if (!toastLive().length && _toast.open) toastFan(false);
  };
  item.addEventListener('transitionend', e => { if (e.target === item && e.propertyName === 'opacity') gone(); });
  setTimeout(gone, 320); // if transitionend never comes (reduced motion, a hidden tab)
}
window.klabToasts = {
  dismissGroup: g => toastLive().filter(t => t._group === g).forEach(t => dismissToast(t)),
  clear: () => toastLive().forEach(t => dismissToast(t)),
  list: () => toastLive().map(t => ({ group: t._group, count: t._count, note: t.classList.contains('note'), text: t._card.textContent })),
};

// ══════════════════════════════════════════
//  THE DOCK: on Music, tucked away elsewhere
//  On a computer the dock shows on Music. On every other page it tucks
//  into #dockPeek, a little visualiser at the foot of the sidebar (in the
//  header when the tabs are on top; js/07-tabnav.js places it). Pressing
//  that brings the dock up out of it over the page, until you press it
//  again or change pages. A phone keeps its mini player, which "Hide
//  player" in the menu still hides (klabnet_player_visible).
// ══════════════════════════════════════════
const PLAYER_VIS_KEY = 'klabnet_player_visible';
let playerVisible = localStorage.getItem(PLAYER_VIS_KEY) !== 'false';
let dockPeekOpen = false;
const dockDeskMq = matchMedia(KLAB_DESK_MQ);
function dockWanted() {
  if (!dockDeskMq.matches) return playerVisible;
  return document.body.classList.contains('tab-music-active') || dockPeekOpen;
}
// The dock flying into the visualiser and back out of it. It's measured
// on screen and moved with `translate`/`scale`, which add to the dock's
// own transform (and to the !important ones that hide it on Photos).
let dockFlight = null;
function flyDock(open, pr) {
  const dock = document.getElementById('playerDock'), peek = document.getElementById('dockPeek');
  const ok = (window.klabMotionOk?.() ?? true) && dock.animate;
  const icon = peek.querySelector('.eq-ico') || peek;
  const dr = dock.getBoundingClientRect();
  if (!ok || !pr || !pr.width || !dr.width) return null;
  const z = typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1;
  const m = new DOMMatrix(getComputedStyle(dock).transform === 'none' ? undefined : getComputedStyle(dock).transform);
  const sx = Math.max(pr.width / dr.width, 0.01), sy = Math.max(pr.height / dr.height, 0.01);
  const dx = (pr.left + pr.width / 2 - (dr.left + dr.width / 2)) / z + m.e * (1 - sx);
  const dy = (pr.top + pr.height / 2 - (dr.top + dr.height / 2)) / z + m.f * (1 - sy);
  const tucked = { translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}`, opacity: 0 };
  const shown = { translate: '0px 0px', scale: '1 1', opacity: 1 };
  const frames = open
    ? [tucked, { opacity: 1, offset: 0.45 }, shown]
    : [shown, { opacity: 1, offset: 0.5 }, tucked];
  const a = dock.animate(frames, { duration: open ? 420 : 380, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
  // Done: the dock's own slide transition comes back only once the
  // hidden state has settled, or it would play a second, smaller move.
  const land = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => { if (dockFlight !== a || !open) dock.classList.remove('dock-flying'); }));
  };
  a.finished.then(() => { land(); if (open && dockFlight === a) { a.cancel(); dockFlight = null; dock.classList.remove('dock-flying'); } }, land);
  // The visualiser gives a little bump as the dock lands in it.
  if (!open && !peek.classList.contains('peek-hidden')) setTimeout(() => icon.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
    { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }), 300);
  return a;
}
// The visualiser shrinks away on Music (where the dock is) and grows back
// everywhere else, never just vanishing. Returns where its icon is, or
// will be once it has grown in, for the dock's flight.
function setPeekHidden(hide, animate) {
  const peek = document.getElementById('dockPeek');
  if (!peek) return null;
  const icon = peek.querySelector('.eq-ico') || peek;
  const was = peek.classList.contains('peek-hidden');
  if (was === hide) return icon.getBoundingClientRect();
  if (!animate) peek.style.transition = 'none';
  let rect;
  if (hide) { rect = icon.getBoundingClientRect(); peek.classList.add('peek-hidden'); }
  else {
    peek.style.transition = 'none';
    peek.classList.remove('peek-hidden');
    rect = icon.getBoundingClientRect();
    if (animate) { peek.classList.add('peek-hidden'); void peek.offsetWidth; peek.style.transition = ''; peek.classList.remove('peek-hidden'); }
  }
  if (!animate) { void peek.offsetWidth; peek.style.transition = ''; }
  return rect;
}
// The room pages leave the dock at their foot (body.player-hidden turns
// it off). On a computer only Music keeps it: brought up anywhere else,
// the dock floats over the page, so nothing on it moves or pops in.
function dockLayout() {
  document.body.classList.toggle('player-hidden', dockDeskMq.matches
    ? !document.body.classList.contains('tab-music-active')
    : document.getElementById('playerDock').classList.contains('hidden'));
}
function applyDock(animate) {
  const dock = document.getElementById('playerDock'), peek = document.getElementById('dockPeek');
  const v = dockWanted();
  peek?.setAttribute('aria-pressed', String(dockPeekOpen));
  peek && (peek.title = dockPeekOpen ? 'Tuck the player away' : 'Player');
  document.body.classList.toggle('dock-peek-open', dockPeekOpen);
  // With the page, not at the end of the flight.
  if (dockDeskMq.matches) dockLayout();
  const was = !dock.classList.contains('hidden');
  const peekHide = dockDeskMq.matches && document.body.classList.contains('tab-music-active');
  if (v === was) { setPeekHidden(peekHide, animate); dockLayout(); return; }
  dockFlight?.cancel();
  dockFlight = null;
  const flying = animate && peek && dockDeskMq.matches && (window.klabMotionOk?.() ?? true);
  // Where the dock flies from or to: the visualiser where it will be once
  // it has grown back in (leaving Music), or where it is as it shrinks away.
  const iconRect = setPeekHidden(peekHide, animate);
  // No slide transition under the flight (it ran as a second animation).
  dock.classList.toggle('dock-flying', !!flying);
  void dock.offsetWidth;
  if (v) {
    dock.classList.remove('hidden');
    dockLayout();
    if (flying) dockFlight = flyDock(true, iconRect);
    if (!dockFlight) dock.classList.remove('dock-flying');
  } else {
    const done = () => {
      if (dockWanted()) return;
      dock.classList.add('hidden');
      dockLayout();
      dockFlight?.cancel();
      dockFlight = null;
    };
    const a = flying ? flyDock(false, iconRect) : null;
    if (a) { dockFlight = a; a.finished.then(done, () => {}); } else { done(); dock.classList.remove('dock-flying'); }
  }
}
// The phone's "Hide player".
function setPlayerVisible(v) {
  playerVisible = v;
  localStorage.setItem(PLAYER_VIS_KEY, String(v));
  applyDock(false);
}
window.klabTogglePlayer = () => {
  SFX.play('click');
  if (!dockDeskMq.matches) { setPlayerVisible(!playerVisible); return; }
  if (document.body.classList.contains('tab-music-active')) return;
  dockPeekOpen = !dockPeekOpen;
  applyDock(true);
};
document.getElementById('dockPeek')?.addEventListener('click', window.klabTogglePlayer);
// Changing pages tucks it away again (and Music brings it out).
let dockTab = null;
const tabNow = () => (document.body.className.match(/\btab-([a-z]+)-active\b/) || [])[1] || null;
new MutationObserver(() => {
  const t = tabNow();
  if (t === dockTab) return;
  const first = dockTab === null;
  dockTab = t;
  dockPeekOpen = false;
  applyDock(!first);
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
dockDeskMq.addEventListener('change', () => { dockPeekOpen = false; applyDock(false); });
dockTab = tabNow();
applyDock(false);
// The song's name beside the visualiser.
(function() {
  const title = document.getElementById('playerTitle'), label = document.getElementById('dockPeekLabel');
  if (!title || !label) return;
  // Not while the radio's on: it puts the station there (js/28-radio.js).
  const sync = () => { if (document.body.classList.contains('radio-on')) return; label.textContent = (title.style.display !== 'none' && title.textContent.trim()) || 'Player'; };
  new MutationObserver(sync).observe(title, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  sync();
})();

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
  // Its bar and clock were only kept while it was open: a paused song
  // showed where it was when the player last closed (or 0:00).
  window._syncFSProgress?.();
}
function closeFS() { document.getElementById('fsPlayer').classList.remove('open'); }

document.getElementById('fsClose').addEventListener('click', () => closeFS());
document.getElementById('fsGrabber')?.addEventListener('click', () => closeFS());

// Swipe the full player down to close it, like Apple Music's now-playing
// sheet. Touch and pen only: a mouse drag is for the sliders. Drags that
// start on a slider or in the lyrics (which scroll) are left alone.
(function() {
  const fs = document.getElementById('fsPlayer');
  if (!fs) return;
  let drag = null;
  const reset = () => { fs.style.transform = ''; fs.style.borderRadius = ''; };
  fs.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || e.target.closest('.slider-wrap, .fs-lyrics-col, input, textarea')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dy: 0, on: false };
  });
  fs.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (dy > 10 && dy > Math.abs(dx) * 1.2) {
        drag.on = true;
        fs.setPointerCapture(e.pointerId);
        fs.style.transition = 'none';
      } else if (Math.abs(dx) > 10 || dy < -10) { drag = null; }
      return;
    }
    drag.dy = Math.max(0, dy);
    fs.style.transform = `translateY(${drag.dy}px)`;
    fs.style.borderRadius = Math.min(28, drag.dy / 4) + 'px';
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.on) return;
    const speed = d.dy / Math.max(1, performance.now() - d.t); // px per ms
    fs.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1), border-radius .28s ease';
    if (d.dy > window.innerHeight * 0.2 || speed > 0.6) {
      fs.style.transform = `translateY(${window.innerHeight}px)`;
      // Already off the bottom: close without the usual exit replaying.
      setTimeout(() => {
        fs.style.transition = 'none'; closeFS(); reset();
        requestAnimationFrame(() => requestAnimationFrame(() => { fs.style.transition = ''; }));
      }, 270);
    } else {
      reset();
      setTimeout(() => { fs.style.transition = ''; }, 300);
    }
  };
  fs.addEventListener('pointerup', end);
  fs.addEventListener('pointercancel', end);
})();
document.getElementById('btnFS').addEventListener('click', () => openFS());
// The cover goes to its album (the full player is the button beside the
// volume); on a phone, where the dock is a mini player, it opens that.
document.getElementById('playerArtWrap').addEventListener('click', () => {
  const song = playerState.currentSong;
  if (matchMedia(KLAB_PHONE_MQ).matches || !song?.albumId) { openFS(); return; }
  goToMusicDetail(() => loadAlbumView(song.albumId, song.album, () => loadPickerTab('albums')));
});
// Phone layout: the dock is a mini player, and tapping its title opens the
// full player too, the way a music app's mini player does.
document.querySelector('#playerDock .player-info')?.addEventListener('click', () => {
  if (matchMedia(KLAB_PHONE_MQ).matches) openFS();
});
document.getElementById('fsPlayer').addEventListener('click', e => { if (e.target === document.getElementById('fsPlayer')) closeFS(); });

let _fsBgActive = 'A'; // crossfade layer tracker
let _fsBgToken = 0;    // guards against a stale, slow-loading image winning a race
let _fsArtPending = null; // song whose artwork updateFSUI() deferred while FS was closed

let _fsArtToken = 0;
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
    al.textContent = song.artist || 'Unknown artist';
    al.addEventListener('click', () => { closeFS(); goToMusicDetail(() => loadArtistView({ id: song.artistId, name: song.artist })); });
    fsArtistEl.appendChild(al);
  } else { fsArtistEl.textContent = song.artist || 'Unknown artist'; }

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

  // Fullscreen has the room for the whole string, so no shorthand here.
  const fsQualEl = document.getElementById('fsQuality');
  const fsQ = songQuality(song);
  fsQualEl.textContent = fsQ ? fsQ.full : '';
  fsQualEl.className = 'fs-quality' + (fsQ && fsQ.lossless ? ' lossless' : '');

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
  // The next song off the same album: the same cover and background stay
  // (they faded out and back in on every track). Anything still on its
  // way for a song before this one is called off.
  const myFsArt = ++_fsArtToken;
  const shownArt = document.querySelector('#fsArt img');
  if (song.coverArt && shownArt && shownArt.dataset.cover === song.coverArt) { _fsBgToken++; document.getElementById('fsArt').style.opacity = '1'; return; }

  // The cover is drawn up to 640px across: enough pixels for this screen.
  const artSize = Math.min(1200, Math.ceil(640 * (window.devicePixelRatio || 1) / 300) * 300);
  const artUrl = `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=${artSize}&${subsonicParams()}`;
  // Not screen-sized any more: it's blurred by 60px (and baked down to a
  // 96px image by klabSoften), so 300px looks identical, where a 3200px
  // source cost ~40MB of memory decoded for a blur.
  const bgSize = 300;
  const bgUrl  = `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=${bgSize}&${subsonicParams()}`;

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
  window.klabSoften?.(nextEl);
  const _fsBgImg = new Image();
  _fsBgImg.onload = () => {
    if (myFsBgToken !== _fsBgToken) return; // a newer track change superseded this load
    nextEl.style.opacity = '0.9';
    curEl.style.opacity  = '0';
    _fsBgActive = next;
  };
  _fsBgImg.src = bgUrl;

  // The new cover is loaded and decoded first, then laid over the old one
  // and faded in; the old one goes once it's covered. (It used to fade the
  // old one out, empty the box, and drop the new one in while it was
  // still loading: a blank square, then a pop.)
  const fsArt = document.getElementById('fsArt');
  fsArt.style.opacity = '1';
  {
    const img = document.createElement('img');
    img.src = artUrl;
    if (song.coverArt) {
      img.dataset.cover = song.coverArt; img.alt = song.album || song.title || '';
      if (song.album) { img.dataset.album = song.album; img.dataset.albumId = song.albumId || ''; img.dataset.artist = window.klabAlbumArtistOf?.(song) || song.artist || ''; }
    }
    const show = () => {
      if (myFsArt !== _fsArtToken) return; // a newer song's cover is coming
      const old = [...fsArt.children];
      img.classList.add('fs-art-in');
      fsArt.appendChild(img);
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.remove('fs-art-in')));
      setTimeout(() => old.forEach(o => o !== img && o.remove()), 520);
    };
    img.decode().then(show, () => { if (myFsArt === _fsArtToken) fsArt.innerHTML = '<i class="ti ti-music"></i>'; });
    // Then the same cover at high resolution, once it's ready.
    if (song.album && window.klabHiResArt) {
      window.klabHiResArt({ albumId: song.albumId || '', artist: window.klabAlbumArtistOf(song), album: song.album }).then(r => {
        if (!r || !r.large || !img.isConnected) return;
        const pre = new Image();
        pre.src = r.large;
        return pre.decode().then(() => { if (img.isConnected) img.src = r.large; });
      }).catch(() => {});
    }
  }
}

// FS controls mirror main player
document.getElementById('fsPlay').addEventListener('click', togglePlay);
document.getElementById('fsPrev').addEventListener('click', () => prevSong());
document.getElementById('fsNext').addEventListener('click', () => nextSong());

// FS sliders handled by makeSlider

// Sync FS progress bar with audio timeupdate
if (playerState.audio) {
  const _fsPlayerEl   = document.getElementById('fsPlayer');
  const _fsCurEl       = document.getElementById('fsCur');
  const _fsDurEl       = document.getElementById('fsDur');
  window._syncFSProgress = function() {
    if (!playerState.audio.duration) return;
    const pct = (playerState.audio.currentTime / playerState.audio.duration) * 100;
    // Not under a drag: the bar follows the finger until it lets go.
    if (!fsProgSlider.dragging) {
    fsProgSlider.setPct(pct / 100);
    }
    // Only when the second changes: same-text writes still re-laid out the
    // labels four times a second. (The play icon is setPlayIcon()'s.)
    const cur = formatTime(playerState.audio.currentTime), dur = formatTime(playerState.audio.duration);
    if (_fsCurEl.textContent !== cur) _fsCurEl.textContent = cur;
    if (_fsDurEl.textContent !== dur) _fsDurEl.textContent = dur;
  };
  playerState.audio.addEventListener('timeupdate', () => {
    // This fires continuously during all playback — skip the work
    // entirely when the fullscreen view isn't even visible. openFS()
    // calls _syncFSProgress() once directly so the view isn't stale
    // for the ~1 tick it'd otherwise take to catch up after opening.
    if (!_fsPlayerEl.classList.contains('open')) return;
    window._syncFSProgress();
  });
  // A new song starts at the start: until its length is known the bars
  // sat where the last one was, beside a clock already saying 0:00.
  playerState.audio.addEventListener('loadstart', () => {
    if (typeof progSlider !== 'undefined' && !progSlider.dragging) progSlider.setPct(0);
    if (!fsProgSlider.dragging) fsProgSlider.setPct(0);
    _fsCurEl.textContent = '0:00';
    const d = playerState.currentSong?.duration;
    _fsDurEl.textContent = d ? formatTime(d) : '0:00';
  });
}

// ══════════════════════════════════════════
//  QUEUE STATE
// ══════════════════════════════════════════
let queue = [];
function updateQueueBadge() {
  const n = queue.length ? queue.length.toLocaleString() : '';
  const d = document.getElementById('dockQueueN');
  if (d) d.textContent = n;
  klabSavePlayerSoon();
}
// Something just went into the queue: its count gives a little bump.
function klabQueueBump() {
  if (!(window.klabMotionOk?.() ?? true)) return;
  const el = document.getElementById('dockQueue');
  if (el) { el.classList.remove('k-bump'); void el.offsetWidth; el.classList.add('k-bump'); }
}
// Every "Add to queue" and "Play next" goes through these two: the count,
// the queue popover, the sound and one toast for however many songs.
function queueSongs(songs, { next = false, label, art } = {}) {
  songs = (songs || []).filter(Boolean);
  if (!songs.length) return;
  if (next) queue.unshift(...songs); else queue.push(...songs);
  updateQueueBadge();
  SFX && SFX.play('queue');
  klabQueueBump();
  const what = label || (songs.length === 1 ? `"${songs[0].title}"` : klabCount(songs.length, 'song'));
  showToast(next ? `${what} plays next` : `${what} added to the queue`, art || (songs.length === 1 && songs[0].coverArt ? toastArt(songs[0].coverArt) : 'ti-playlist-add'));
}
function addToQueue(song) { queueSongs([song]); }
function playNext(songs, opts) { queueSongs(Array.isArray(songs) ? songs : [songs], { ...opts, next: true }); }

// ══════════════════════════════════════════
//  WHAT WAS PLAYING, KEPT — the song, where it was, the list it played
//  from and the queue, saved as they change (localStorage klabnet_player)
//  and brought back paused at the next start, unless something else is
//  playing by then (a login song, or another of your devices: then
//  js/23-session.js shows that instead).
// ══════════════════════════════════════════
const PLAYER_SAVE_KEY = 'klabnet_player';
let _playerSaveT = 0, _playerRestored = false, _resumeAt = null;
function klabSavePlayer() {
  clearTimeout(_playerSaveT); _playerSaveT = 0;
  // A remote stands in for another device's player: not this one's to keep.
  if (!_playerRestored || window.klabSession?.mirror) return;
  const song = playerState.currentSong;
  if (!song) return;
  const slim = x => (typeof slimSong === 'function' ? slimSong(x) : x);
  const pl = playerState.playlist || [];
  // Up to 500 either side of where it's at.
  const from = Math.max(0, playerState.playlistIndex - 250);
  const data = {
    song: slim(song),
    pos: Math.floor(playerState.audio.currentTime || 0),
    queue: queue.slice(0, 500).map(slim),
    playlist: pl.slice(from, from + 500).map(slim),
    index: Math.max(0, playerState.playlistIndex - from),
    shuffle: !!_shuffleOn, repeatAll: !!_repeatAll, repeatOne: !!_repeatOn,
    at: Date.now(),
  };
  try { localStorage.setItem(PLAYER_SAVE_KEY, JSON.stringify(data)); } catch (e) {}
}
function klabSavePlayerSoon() {
  if (!_playerSaveT) _playerSaveT = setTimeout(klabSavePlayer, 1000);
}
for (const t of ['loadstart', 'pause', 'seeked']) playerState.audio.addEventListener(t, klabSavePlayerSoon);
{ let last = 0; playerState.audio.addEventListener('timeupdate', () => { const n = Date.now(); if (n - last > 10000) { last = n; klabSavePlayerSoon(); } }); }
addEventListener('pagehide', klabSavePlayer);
document.addEventListener('visibilitychange', () => { if (document.hidden) klabSavePlayer(); });
// Where it was, once the song is loaded again (Play after a restart).
playerState.audio.addEventListener('loadedmetadata', () => {
  const r = _resumeAt;
  if (!r) return;
  _resumeAt = null;
  if (playerState.currentSong?.id !== r.id || window.klabSession?.mirror) return;
  const a = playerState.audio;
  if (a.currentTime < 1 && r.pos > 1 && r.pos < (a.duration || Infinity) - 2) a.currentTime = r.pos;
});
async function klabRestorePlayer() {
  try { await window.klabSession?.ready; } catch (e) {}
  // Whatever's showing by now (a login song, another device's music, a
  // song already picked) wins.
  const go = !playerState.currentSong && !window.klabSession?.mirror;
  let d = null;
  if (go) { try { d = JSON.parse(localStorage.getItem(PLAYER_SAVE_KEY)); } catch (e) {} }
  if (d?.song?.id) {
    playerState.playlist = Array.isArray(d.playlist) && d.playlist.length ? d.playlist : [d.song];
    // Its saved place first: a list with the song in it twice (a playlist,
    // repeat-all rounds) came back at the first one, and Next replayed
    // what had already played.
    const i = playerState.playlist[d.index]?.id === d.song.id ? d.index : playerState.playlist.findIndex(x => x.id === d.song.id);
    playerState.playlistIndex = i >= 0 ? i : Math.min(d.index || 0, playerState.playlist.length - 1);
    if (Array.isArray(d.queue) && !queue.length) queue = d.queue;
    if (d.shuffle && !_shuffleOn) { _shuffleOn = true; syncShuffleBtns(); }
    _repeatAll = !!d.repeatAll; _repeatOn = !!d.repeatOne; playerState.audio.loop = _repeatOn;
    syncRepeatBtns();
    playerState.currentSong = d.song;
    if (d.pos > 1) _resumeAt = { id: d.song.id, pos: d.pos };
    updatePlayerUI(d.song);
    updateFSUI?.(d.song);
    updateDockFavBtn?.();
    // The dock's bar shows where it stopped.
    if (d.pos && d.song.duration && typeof progSlider !== 'undefined') progSlider.setPct(Math.min(1, d.pos / d.song.duration));
    updateQueueBadge();
  }
  _playerRestored = true;
}
document.addEventListener('DOMContentLoaded', () => { klabRestorePlayer(); });
