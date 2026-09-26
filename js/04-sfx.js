// ══════════════════════════════════════════
//  SOUND — klabnet's own little instrument
//
//  Everything is one voice, synthesized live: a soft FM electric-piano
//  mallet (a warm body plus a short glassy "tine" on the attack), played
//  in D major pentatonic so any two sounds that overlap still agree, and
//  sent into a small generated room so nothing sounds like a bare beep.
//  Notes are humanized (a few cents of drift, a little velocity wobble),
//  so a run of clicks never sounds like a machine repeating itself.
//
//  People have sounds too: every username hashes to its own three-note
//  motif, so a message from someone sounds like *them*. DMs play it low
//  and warm with a soft chord under it; channel messages play just the
//  first two notes, lighter; a mention adds a sparkle on top.
// ══════════════════════════════════════════
const SFX = (() => {
  let ctx = null, master = null, verb = null, dry = null;
  let _sfxVol = 0.7;

  // D major pentatonic, D3..D7, as frequencies.
  const PENTA = [];
  [50, 52, 54, 57, 59].forEach(m => { for (let o = 0; o < 5; o++) PENTA.push(m + 12 * o); });
  PENTA.sort((a, b) => a - b);
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const N = { D4: 62, E4: 64, Fs4: 66, A4: 69, B4: 71, D5: 74, E5: 76, Fs5: 78, A5: 81, B5: 83, D6: 86, E6: 88, Fs6: 90, A6: 93 };

  function impulse(c, secs, decay) {
    const len = Math.floor(c.sampleRate * secs);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        // Darkened noise (one-pole lowpass) so the tail is a room, not hiss.
        lp += 0.28 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = _sfxVol;
      // Takes the edge off anything bright before it reaches ears.
      const tame = ctx.createBiquadFilter();
      tame.type = 'lowpass'; tame.frequency.value = 7000; tame.Q.value = 0.3;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 3;
      comp.attack.value = 0.003; comp.release.value = 0.12;
      master.connect(tame); tame.connect(comp); comp.connect(ctx.destination);
      dry = ctx.createGain(); dry.gain.value = 1; dry.connect(master);
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.5, 3.2);
      verb = ctx.createGain(); verb.gain.value = 0.24;
      verb.connect(conv); conv.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Browsers only start audio inside a user gesture.
  let _unlocked = false;
  function unlock() {
    if (_unlocked) return;
    _unlocked = true;
    const c = getCtx();
    if (c.state !== 'running') c.resume();
  }
  ['click', 'keydown', 'mousedown', 'pointerdown'].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
  function _resumeOnMove() {
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume(); return; }
    if (ctx.state === 'running') document.removeEventListener('mousemove', _resumeOnMove);
  }
  document.addEventListener('mousemove', _resumeOnMove, { passive: true });

  const wob = (x, amt) => x * (1 + (Math.random() * 2 - 1) * amt);

  // One mallet note. vel 0..1, decay in seconds, wet = reverb send.
  function note(midi, vel, decay, at, o) {
    o = o || {};
    const c = getCtx();
    const t = c.currentTime + (at || 0) + 0.005;
    const f = hz(midi) * Math.pow(2, (Math.random() * 2 - 1) * 4 / 1200);   // ±4 cents
    const v = wob(vel, 0.08);
    const out = c.createGain();
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    // Higher notes sit a little right, lower a little left, like a keyboard.
    let tail = out;
    if (pan) { pan.pan.value = Math.max(-0.5, Math.min(0.5, (midi - 74) / 40)); out.connect(pan); tail = pan; }
    tail.connect(dry);
    if (!o.dry) tail.connect(verb);

    // Body: sine carrier, modulator at 1:1 whose depth falls away, so the
    // note opens bright and settles into a round tone.
    const car = c.createOscillator(), mod = c.createOscillator(), modG = c.createGain(), amp = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * (o.ratio || 1);
    const idx = (o.bright ?? 1.1) * f;
    modG.gain.setValueAtTime(idx, t);
    modG.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.04), t + Math.min(0.35, decay * 0.6));
    mod.connect(modG); modG.connect(car.frequency); car.connect(amp); amp.connect(out);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(v * 0.5, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    car.start(t); mod.start(t); car.stop(t + decay + 0.05); mod.stop(t + decay + 0.05);

    // Tine: a quick inharmonic ping on the attack, the "glass" in it.
    if (o.tine !== 0) {
      const tn = c.createOscillator(), tg = c.createGain();
      tn.type = 'sine'; tn.frequency.value = f * 4.2;
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.linearRampToValueAtTime(v * 0.09 * (o.tine ?? 1), t + 0.002);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      tn.connect(tg); tg.connect(out); tn.start(t); tn.stop(t + 0.08);
    }
  }

  let _noise = null;
  function noiseBuf(c) {
    if (!_noise) {
      _noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = _noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return _noise;
  }
  // Soft airy swell (filtered noise), for panels opening and closing.
  function air(from, to, vel, dur, at) {
    const c = getCtx();
    const t = c.currentTime + (at || 0) + 0.005;
    const src = c.createBufferSource(); src.buffer = noiseBuf(c);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(verb); g.connect(dry);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // A record under your hand: seeking scratches it. dir is which way the
  // needle went (1 forward, -1 back), amt how far/fast (0..1). Three
  // layers: the hiss of the groove sweeping past (band-passed noise), the
  // music itself sped up or slowed down (a filtered saw sliding in pitch),
  // and a few crackles of dust.
  function scratch(o) {
    o = o || {};
    const c = getCtx();
    const t = c.currentTime + 0.004;
    const dir = o.dir < 0 ? -1 : 1;
    const amt = Math.max(0.15, Math.min(1, o.amt ?? 0.5));
    const dur = 0.07 + amt * 0.13;
    const out = c.createGain();
    out.gain.value = 0.9;
    out.connect(dry);
    const send = c.createGain(); send.gain.value = 0.25; out.connect(send); send.connect(verb);

    const src = c.createBufferSource(); src.buffer = noiseBuf(c);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.4;
    const f0 = dir > 0 ? 520 : 2800, f1 = dir > 0 ? 2400 + amt * 1600 : 380;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.42 + amt * 0.3, t + dur * 0.22);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(ng); ng.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);

    const saw = c.createOscillator(); saw.type = 'sawtooth';
    const p0 = dir > 0 ? 95 : 280, p1 = dir > 0 ? 260 + amt * 220 : 70;
    saw.frequency.setValueAtTime(p0, t);
    saw.frequency.exponentialRampToValueAtTime(p1, t + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 3;
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.11 + amt * 0.06, t + dur * 0.3);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    saw.connect(lp); lp.connect(sg); sg.connect(out);
    saw.start(t); saw.stop(t + dur + 0.02);

    const pops = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pops; i++) {
      const at = t + Math.random() * dur;
      const k = c.createBufferSource(); k.buffer = noiseBuf(c);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
      const kg = c.createGain();
      kg.gain.setValueAtTime(0.18 + Math.random() * 0.15, at);
      kg.gain.exponentialRampToValueAtTime(0.0001, at + 0.006);
      k.connect(hp); hp.connect(kg); kg.connect(out);
      k.start(at, Math.random() * 0.8); k.stop(at + 0.01);
    }
  }

  // A pad chord that breathes in under a DM.
  function pad(midis, vel, dur, at) {
    const c = getCtx();
    const t = c.currentTime + (at || 0) + 0.005;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g); g.connect(verb); g.connect(dry);
    midis.forEach((m, i) => [-5, 5].forEach(cents => {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.value = hz(m) * Math.pow(2, cents / 1200);
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }));
  }

  // ── People: a motif per username ──
  function hash(s) { let h = 2166136261; for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const RHYTHMS = [[0, 0.09, 0.18], [0, 0.12, 0.2], [0, 0.07, 0.21], [0, 0.1, 0.15], [0, 0.14, 0.24]];
  function motif(user) {
    const h = hash(String(user || '').toLowerCase());
    // Three steps through the scale, starting somewhere in D5..A5, never
    // jumping more than a few scale degrees, so every motif is singable.
    const start = PENTA.indexOf(74) + (h % 4);
    const steps = [0, ((h >>> 3) % 7) - 3, ((h >>> 7) % 7) - 3];
    let i = start;
    const notes = steps.map((s, k) => (i = Math.max(0, Math.min(PENTA.length - 1, i + (k ? s || 2 : 0))), PENTA[i]));
    return { notes, rhythm: RHYTHMS[(h >>> 11) % RHYTHMS.length] };
  }
  function person(user, kind) {
    const { notes, rhythm } = motif(user);
    if (kind === 'dm') {
      // Low and close: the motif an octave down, with a chord breathing under it.
      pad([50, 57, 66], 0.03, 1.3);
      notes.forEach((m, k) => note(m - 12, 0.4, 0.9, 0.04 + rhythm[k] * 1.25, { bright: 0.8 }));
    } else if (kind === 'mention') {
      notes.forEach((m, k) => note(m, 0.5, 0.6, rhythm[k]));
      note(notes[2] + 12, 0.22, 0.5, rhythm[2] + 0.1, { tine: 1.6 });
    } else {
      // A channel message: just the first two notes, light.
      note(notes[0], 0.34, 0.45, 0);
      note(notes[1], 0.28, 0.5, rhythm[1]);
    }
  }

  const SOUNDS = {
    click:    () => { note(N.A5, 0.62, 0.16, 0, { bright: 0.7 }); },
    glass:    () => SOUNDS.click(),
    browse:   () => { note(N.D6, 0.14, 0.06, 0, { dry: 1, tine: 0.6 }); },
    // The shuffle wheel's pointer clacking over a peg: short, dry, woody.
    tick:     () => { note(N.A6, 0.18, 0.03, 0, { dry: 1, bright: 0.5, tine: 0.2 }); },
    hover:    () => { note(N.D6, 0.3, 0.05, 0, { dry: 1, bright: 0.4, tine: 0.5 }); },
    nav:      () => { note(N.D5, 0.26, 0.16); note(N.A5, 0.2, 0.2, 0.05); },
    nav_back: () => { note(N.A5, 0.24, 0.16); note(N.D5, 0.2, 0.2, 0.05); },
    open:     () => { air(500, 1800, 0.05, 0.28); note(N.D4, 0.3, 0.4); note(N.A4, 0.26, 0.4, 0.05); note(N.D5, 0.22, 0.5, 0.1); },
    close:    () => { air(1600, 450, 0.045, 0.26); note(N.D5, 0.24, 0.3); note(N.A4, 0.2, 0.4, 0.06); },
    play:     () => { note(N.D4, 0.34, 0.6); note(N.A4, 0.26, 0.6, 0.012); note(N.Fs5, 0.24, 0.7, 0.07); },
    pause:    () => { note(N.A4, 0.26, 0.4); note(N.D4, 0.28, 0.5, 0.06, { bright: 0.6 }); },
    skip:     () => { note(N.E5, 0.24, 0.14); note(N.A5, 0.22, 0.2, 0.06); },
    picker:   () => { [N.D5, N.Fs5, N.A5, N.D6].forEach((m, i) => note(m, 0.26 - i * 0.03, 0.45, i * 0.06)); },
    queue:    () => { note(N.A5, 0.26, 0.2); note(N.D6, 0.22, 0.3, 0.05); },
    star:     () => { [N.A5, N.B5, N.D6, N.Fs6, N.A6].forEach((m, i) => note(m, 0.24 - i * 0.03, 0.4, i * 0.045, { tine: 1.4 })); },
    success:  () => { [N.D5, N.Fs5, N.A5, N.D6].forEach((m, i) => note(m, 0.28, 0.5, i * 0.05)); },
    // A dull, soft "bonk" a half step off the scale: clearly wrong, never harsh.
    error:    () => { note(65, 0.36, 0.3, 0, { bright: 0.5, tine: 0 }); note(62, 0.34, 0.45, 0.1, { bright: 0.4, tine: 0 }); },
    notify:   () => { note(N.Fs5, 0.36, 0.5); note(N.A5, 0.3, 0.6, 0.09); },
    // Chat, while you're in the conversation. Sending is low and flicks
    // out; a message landing is high, on the sender's own first note.
    send:     () => { air(600, 2200, 0.03, 0.14); note(N.D4, 0.42, 0.14, 0, { bright: 0.8 }); note(N.A4, 0.46, 0.24, 0.035, { tine: 1.3 }); },
    receive:  from => { const m = motif(from).notes[0]; note(m + 12, 0.6, 0.45, 0, { bright: 0.8, tine: 1.2 }); note(m, 0.4, 0.35, 0.02, { bright: 0.5, tine: 0 }); },
    scratch:  o => scratch(o),
    dm:       from => person(from, 'dm'),
    message:  from => person(from, 'message'),
    mention:  from => person(from, 'mention'),
  };
  const NOTIF = new Set(['notify', 'dm', 'message', 'mention']);

  function play(type, from) {
    try { (SOUNDS[type] || (() => {}))(from); } catch (e) { /* audio not available */ }
  }
  function setVolume(v) {
    _sfxVol = Math.max(0, Math.min(1, v));
    if (master && ctx) master.gain.setTargetAtTime(_sfxVol, ctx.currentTime, 0.02);
  }
  let _lastType = '', _lastAt = 0, _lastNotifAt = -Infinity, _lastRecvAt = -Infinity;
  function playGated(type, from) {
    if (typeof _settings !== 'undefined') {
      if (!_settings.sfxEnabled) return;
      if (!_settings.notifSound && NOTIF.has(type)) return;
      _sfxVol = _settings.sfxVolume ?? 0.7;
    }
    const now = performance.now();
    if (_lastType === type && now - _lastAt < 42) return;
    // A burst of messages is one sound, not a pileup.
    if (NOTIF.has(type)) { if (now - _lastNotifAt < 900) return; _lastNotifAt = now; }
    if (type === 'receive') { if (now - _lastRecvAt < 600) return; _lastRecvAt = now; }
    _lastType = type; _lastAt = now;
    play(type, from);
    setVolume(_sfxVol);
  }
  return { play: playGated, setVolume, motif, _getCtx: () => ctx };
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
// A toast can name its own sound (opts.sound, opts.from): chat messages
// play the sender's motif instead of the generic chime.
showToast = function(...args) {
  const o = args[5] || {};
  SFX.play(o.sound || 'notify', o.from);
  return _origShowToast(...args);
};

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

