// ══════════════════════════════════════════
//  FRUTIGER AERO SOUND EFFECTS
// ══════════════════════════════════════════
const SFX = (() => {
  let ctx = null;
  let compressor = null;
  let masterGain = null;
  let _sfxVol = 0.7;
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Master gain — actual volume control
      masterGain = ctx.createGain();
      masterGain.gain.value = _sfxVol;
      // Compressor after gain — prevents clipping
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-6, ctx.currentTime);
      compressor.knee.setValueAtTime(3, ctx.currentTime);
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.001, ctx.currentTime);
      compressor.release.setValueAtTime(0.1, ctx.currentTime);
      masterGain.connect(compressor);
      compressor.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function dest() { getCtx(); return masterGain; }

  // Unlock AudioContext — browsers require resume() inside a user gesture
  let _unlocked = false;
  function unlock() {
    if (_unlocked) return;
    _unlocked = true;
    const c = getCtx();
    if (c.state !== 'running') c.resume();
  }
  // Resume on any gesture — mousemove counts in most browsers
  ['click','keydown','mousedown','pointerdown'].forEach(ev =>
    document.addEventListener(ev, unlock, { passive: true })
  );
  // Also pre-create context on first mousemove so hover works immediately after click.
  // Self-removes once the context is confirmed running — no need to keep
  // checking on every mousemove for the rest of the session after that.
  function _resumeOnMove() {
    if (!ctx) return; // don't create until after first click
    if (ctx.state === 'suspended') { ctx.resume(); return; }
    if (ctx.state === 'running') document.removeEventListener('mousemove', _resumeOnMove);
  }
  document.addEventListener('mousemove', _resumeOnMove, { passive: true });

  // Helpers ─────────────────────────────────────────────
  // tone: soft rounded sine through a gentle lowpass — PS3 XMB-style chime
  function tone(freq, gain, attack, decay, offset, type) {
    const c = getCtx(); const t = c.currentTime + (offset||0);
    const o = c.createOscillator(); const og = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.5;
    o.connect(lp); lp.connect(og); og.connect(dest());
    o.type = type||'sine';
    o.frequency.setValueAtTime(freq, t);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(gain, t + attack);
    og.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.start(t); o.stop(t + attack + decay + 0.02);
  }
  // swell: soft filtered-noise breath — used for the airy open/close whoosh
  function thud(freq, gain, decay, offset) {
    const c = getCtx(); const t = c.currentTime + (offset||0);
    const bufSize = Math.max(1, Math.floor(c.sampleRate * decay));
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i=0; i<bufSize; i++) data[i] = (Math.random()*2-1);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1;
    const ng = c.createGain();
    src.connect(bp); bp.connect(ng); ng.connect(dest());
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(gain, t + decay * 0.3);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.start(t); src.stop(t + decay + 0.02);
  }

  function play(type) {
    try {
      const c = getCtx();
      const t = c.currentTime;

      if (type === 'glass' || type === 'click') {
        // Soft two-tone confirm blip — rounded, no percussive edge
        tone(660, 0.26, 0.008, 0.10);
        tone(880, 0.18, 0.008, 0.14, 0.03);
      }
      else if (type === 'browse') {
        // Barely-there whisper tick
        tone(1600, 0.05, 0.004, 0.05);
      }
      else if (type === 'nav') {
        // Forward navigation — soft ascending step
        tone(587, 0.14, 0.006, 0.09);
        tone(784, 0.10, 0.006, 0.10, 0.05);
      }
      else if (type === 'nav_back') {
        // Back navigation — soft descending step
        tone(784, 0.12, 0.006, 0.09);
        tone(587, 0.09, 0.006, 0.10, 0.05);
      }
      else if (type === 'hover') {
        // Soft mallet tap — quiet, quick, rounded, bypasses compressor
        const hg = c.createGain();
        hg.connect(c.destination);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2200;
        const o = c.createOscillator(); const og = c.createGain();
        o.connect(lp); lp.connect(og); og.connect(hg);
        o.type = 'sine'; o.frequency.setValueAtTime(1046, t);
        og.gain.setValueAtTime(0.0001, t);
        og.gain.linearRampToValueAtTime(0.09, t + 0.006);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.start(t); o.stop(t + 0.07);
        return;
      }
      else if (type === 'open') {
        // Gentle rising breath + soft confirm
        thud(700, 0.14, 0.16);
        tone(392, 0.22, 0.01, 0.20);
        tone(587, 0.16, 0.01, 0.22, 0.09);
      }
      else if (type === 'close') {
        // Gentle falling breath
        tone(587, 0.16, 0.01, 0.16);
        thud(480, 0.12, 0.16, 0.05);
        tone(392, 0.18, 0.01, 0.18, 0.08);
      }
      else if (type === 'play') {
        // Warm ascending two-tone — the classic soft "confirm"
        tone(392, 0.30, 0.008, 0.16);
        tone(587, 0.24, 0.008, 0.20, 0.07);
      }
      else if (type === 'pause') {
        // Soft descending settle — reversed play feel
        tone(587, 0.24, 0.008, 0.14);
        tone(392, 0.22, 0.008, 0.18, 0.06);
      }
      else if (type === 'skip') {
        // Two soft rounded taps, gentle pitch lift
        tone(660, 0.20, 0.006, 0.08);
        tone(784, 0.18, 0.006, 0.09, 0.09);
      }
      else if (type === 'picker') {
        // Gentle, spaced arpeggio — mellow chime, C major
        [[523, 0.18, 0.16, 0.000],
         [659, 0.16, 0.18, 0.085],
         [784, 0.14, 0.20, 0.170],
         [1046,0.11, 0.22, 0.255]].forEach(([f,g,decay,o]) => {
          tone(f, g, 0.008, decay, o);
        });
      }
      else if (type === 'queue') {
        // Soft short confirm
        tone(523, 0.22, 0.006, 0.14);
        tone(659, 0.16, 0.006, 0.14, 0.05);
      }
      else if (type === 'star') {
        // Twinkly, soft ascending run
        [[784, 0.20, 0.16, 0.000],
         [988, 0.17, 0.16, 0.06],
         [1175,0.14, 0.16, 0.12],
         [1568,0.11, 0.18, 0.18]].forEach(([f,g,decay,o]) => {
          tone(f, g, 0.006, decay, o);
        });
      }
      else if (type === 'error') {
        // Soft low descending tone — rounded, not harsh
        tone(220, 0.28, 0.01, 0.20);
        tone(175, 0.24, 0.01, 0.24, 0.10);
      }
      else if (type === 'notify') {
        // Two warm gentle tones
        tone(528, 0.30, 0.01, 0.24);
        tone(660, 0.22, 0.01, 0.24, 0.09);
      }
    } catch(e) { /* audio not available */ }
  }
  function setVolume(v) {
    _sfxVol = Math.max(0, Math.min(1, v));
    if (masterGain && ctx) {
      masterGain.gain.setTargetAtTime(_sfxVol, ctx.currentTime, 0.02);
    }
  }
  function playGated(type) {
    if (typeof _settings !== 'undefined') {
      if (!_settings.sfxEnabled) return;
      if (!_settings.notifSound && type === 'notify') return;
      _sfxVol = _settings.sfxVolume ?? 0.7;
    }
    const now = performance.now();
    if (playGated._lastType === type && now - playGated._lastAt < 42) return;
    playGated._lastType = type;
    playGated._lastAt = now;
    play(type);
    // Apply volume every play so slider changes take effect
    setVolume(_sfxVol);
  }
  return { play: playGated, setVolume, _getCtx: () => ctx };
})();

// Wire SFX to UI elements
// Header buttons
['themeToggle','playerToggle'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => SFX.play('click'));
});

// Picker open/close
const _origOpenPicker = openPicker;
openPicker = function() { SFX.play('picker'); _origOpenPicker(); };
const _origClosePicker = closePicker;
closePicker = function() { SFX.play('close'); _origClosePicker(); };

// FS open/close
const _origOpenFS = openFS;
openFS = function() {
  SFX.play('open');
  _origOpenFS();
  // The timeupdate handler skips its work while FS is closed (perf — see
  // where _syncFSProgress is defined), so give it one immediate sync here
  // instead of leaving the view stale until the next tick.
  if (window._syncFSProgress) window._syncFSProgress();
};
const _origCloseFS = closeFS;
closeFS = function() { SFX.play('close'); _origCloseFS(); };

// Play/pause
document.getElementById('btnPlay').addEventListener('click', () => {
  SFX.play(playerState.playing ? 'pause' : 'play');
}, true); // capture phase so it fires before toggle

// Skip
document.getElementById('btnNext').addEventListener('click', () => SFX.play('skip'), true);
document.getElementById('btnPrev').addEventListener('click', () => SFX.play('skip'), true);

// FS controls
document.getElementById('fsPlay').addEventListener('click', () => {
  SFX.play(playerState.playing ? 'pause' : 'play');
}, true);
document.getElementById('fsNext').addEventListener('click', () => SFX.play('skip'), true);
document.getElementById('fsPrev').addEventListener('click', () => SFX.play('skip'), true);

// Picker tabs
document.querySelectorAll('.picker-tab').forEach(tab => {
  tab.addEventListener('click', () => SFX.play('nav'));
});

// Patch showToast to play notify sound
const _origShowToast = showToast;
// Passes every argument through: it used to forward only the first four,
// which silently dropped the click action (jump to the chat) and the
// quick-reply option from every chat notification.
showToast = function(...args) { SFX.play('notify'); return _origShowToast(...args); };

// Patch addToQueue to play queue sound
const _origAddToQueue = addToQueue;
addToQueue = function(song) { SFX.play('queue'); _origAddToQueue(song); };

// Patch setLoginSong to play star sound
const _origSetLoginSong = setLoginSong;
setLoginSong = function(song) { SFX.play('star'); _origSetLoginSong(song); };

// Interaction polish: is-playing class + hover sound
(function() {
  function setPlayingClass() {
    document.body.classList.toggle('is-playing', !!playerState.playing);
  }

  if (playerState && playerState.audio) {
    playerState.audio.addEventListener('play', setPlayingClass);
    playerState.audio.addEventListener('pause', setPlayingClass);
    playerState.audio.addEventListener('ended', setPlayingClass);
    playerState.audio.addEventListener('error', setPlayingClass);
  }
  setPlayingClass();

  let lastPremiumHover = 0;
  const hoverSelector = '.hdr-btn, .ctrl-btn, .fs-btn, .picker-action, .picker-tab, .tab-nav-btn';
  document.addEventListener('pointerover', e => {
    const el = e.target.closest(hoverSelector);
    if (!el || el._premiumHovered) return;
    el._premiumHovered = true;
    const now = Date.now();
    if (now - lastPremiumHover > 110) {
      lastPremiumHover = now;
      SFX && SFX.play('hover');
    }
  }, { passive: true });

  document.addEventListener('pointerout', e => {
    const el = e.target.closest(hoverSelector);
    if (!el) return;
    const to = e.relatedTarget;
    if (to && el.contains(to)) return;
    el._premiumHovered = false;
  }, { passive: true });
})();

// ══════════════════════════════════════════
//  MEDIA SESSION API — OS integration
//  Shows track info on lock screen, headphone controls,
//  notification tray, Mac Touch Bar, etc.
// ══════════════════════════════════════════
function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  if (!song) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    return;
  }

  const artUrl = `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=512&${subsonicParams()}`;

  navigator.mediaSession.metadata = new MediaMetadata({
    title:  song.title  || 'Unknown',
    artist: song.artist || 'Unknown Artist',
    album:  song.album  || '',
    artwork: [
      { src: artUrl, sizes: '512x512', type: 'image/jpeg' }
    ]
  });

  // Wire hardware/OS media keys
  navigator.mediaSession.setActionHandler('play',  () => { playerState.audio.play(); playerState.playing = true; setPlayIcon(true); navigator.mediaSession.playbackState = 'playing'; });
  navigator.mediaSession.setActionHandler('pause', () => { playerState.audio.pause(); playerState.playing = false; setPlayIcon(false); navigator.mediaSession.playbackState = 'paused'; });
  navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
  navigator.mediaSession.setActionHandler('nexttrack',     () => nextSong());
  navigator.mediaSession.setActionHandler('seekto',       e => { if (playerState.audio.duration) playerState.audio.currentTime = e.seekTime; });
  navigator.mediaSession.setActionHandler('seekbackward', e => { playerState.audio.currentTime = Math.max(0, playerState.audio.currentTime - (e.seekOffset || 10)); });
  navigator.mediaSession.setActionHandler('seekforward',  e => { playerState.audio.currentTime = Math.min(playerState.audio.duration || 0, playerState.audio.currentTime + (e.seekOffset || 10)); });

  navigator.mediaSession.playbackState = 'playing';
}

// Keep position state in sync (for scrubbers in OS media overlays)
playerState.audio.addEventListener('timeupdate', () => {
  if (!('mediaSession' in navigator)) return;
  if (!playerState.audio.duration) return;
  try {
    navigator.mediaSession.setPositionState({
      duration:     playerState.audio.duration,
      playbackRate: playerState.audio.playbackRate,
      position:     playerState.audio.currentTime
    });
  } catch(e) {}
});

