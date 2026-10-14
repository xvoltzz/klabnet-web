// ══════════════════════════════════════════
//  ONE PLAYER ON EVERY DEVICE
//  Like Spotify: of everywhere you have klabnet open, one device makes the
//  sound (the "active" one) and the rest show the same song, position and
//  queue, and work as its remote. "Play here" moves the sound.
//
//  klabnet-api keeps the session (app/routers/session.py). Every page
//  holds a stream open to it; the active one reports what it's playing,
//  the others send their button presses through it.
//
//  The rest of the site reads and drives playerState.audio directly, in a
//  couple of hundred places. Rather than teach each one about remotes,
//  this file makes that one element stand in for the other device's while
//  this one is a remote ("mirror"): its position, duration, paused and
//  volume are the active device's, play/pause/seeking become commands to
//  it, and the events the page listens for (play, pause, timeupdate…) are
//  fired here as the news arrives. Nothing is loaded or heard.
//
//  role:   'off'     no API with sessions (or not reached yet): as before
//          'idle'    nobody is playing
//          'active'  this device is
//          'remote'  another one is
//  mirror: the audio element is a stand-in. Always when remote; also when
//          idle and showing what was last played somewhere else ("parked":
//          pressing Play carries on from it, here).
// ══════════════════════════════════════════
(function() {
  const BASE = '/api/music-requests/session';
  const ME = KLAB_DEVICE;
  const A = playerState.audio;
  const MAX_SONGS = 2000;   // the API's cap on a queue or a playlist

  let role = 'off', mirror = false;
  let sess = { now: null, queue: [], playlist: [], active: '', devices: [] };
  let connected = false;    // the stream is open
  let applying = 0;         // >0 while showing what the other device did (not this one's own doing)
  let own = null;           // this device's own volume, kept while it shows the active one's

  // ── Names ──
  // "Windows app", "iPhone", "Firefox on Mac": from the same string
  // presence sends for the icon on your card.
  const PLATFORM = window.KLAB_PLATFORM || '';
  function describe(platform) {
    const [kind, os, br] = String(platform || '').split(':');
    const OS = { windows: 'Windows', macos: 'Mac', linux: 'Linux', ios: 'iPhone', ipados: 'iPad', android: 'Android', chromeos: 'Chromebook' }[os] || '';
    const BR = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', opera: 'Opera', vivaldi: 'Vivaldi', brave: 'Brave', samsung: 'Samsung Internet' }[br] || '';
    if (kind === 'app') return OS ? OS + ' app' : 'Desktop app';
    if (kind === 'tui') return OS ? 'Terminal on ' + OS : 'Terminal';
    if (kind === 'pwa') return OS || 'Phone';
    return BR && OS ? `${BR} on ${OS}` : BR || OS || 'Browser';
  }
  const isPhone = platform => /:(ios|ipados|android)\b/.test(String(platform || ''));
  const NAME = describe(PLATFORM);
  const deviceOf = id => sess.devices.find(d => d.id === id);
  const nameOf = id => deviceOf(id)?.name || 'another device';
  const others = () => sess.devices.some(d => d.id !== ME);

  // ── The two clocks ──
  // Positions are "this many seconds in, as of this moment on the API's
  // clock". Every message carries that clock; the least-delayed one seen
  // gives the offset from this device's.
  let skew = 0, skewKnown = false;
  const serverNow = () => Date.now() + skew;
  function noteClock(t) {
    if (!t) return;
    const d = t - Date.now();
    if (!skewKnown || d > skew) { skew = d; skewKnown = true; }
  }

  // ── The stand-in ──
  const proto = HTMLMediaElement.prototype;
  const real = {};
  for (const k of ['currentTime', 'duration', 'paused', 'ended', 'volume', 'muted', 'loop']) real[k] = Object.getOwnPropertyDescriptor(proto, k);
  const realPlay = proto.play, realPause = proto.pause;
  const fire = type => A.dispatchEvent(new Event(type));
  const streamUrl = song => `${ND_URL}/rest/stream?id=${encodeURIComponent(song.id)}&${subsonicParams()}`;

  const dur = () => sess.now ? (sess.now.dur || sess.now.song.duration || 0) : 0;
  function posOf(now) {
    if (!now) return 0;
    let p = now.pos;
    if (now.playing && !now.stalled) p += (serverNow() - now.at) / 1000;
    const d = now.dur || now.song.duration || 0;
    return Math.max(0, d ? Math.min(p, d) : p);
  }
  const pos = () => posOf(sess.now);

  function stand(k, get, set, when) {
    Object.defineProperty(A, k, {
      configurable: true, enumerable: true,
      get() { return (when ? when() : mirror) ? get() : real[k].get.call(A); },
      set(v) { if (when ? when() : mirror) set?.(v); else real[k].set?.call(A, v); },
    });
  }
  const remote = () => role === 'remote';
  stand('currentTime', pos, seek);
  stand('duration', () => dur() || NaN);
  stand('paused', () => !sess.now?.playing);
  stand('ended', () => false);
  // Volume, mute and repeat are the active device's only while there is
  // one: parked, they're this device's own.
  stand('volume', () => sess.now?.volume ?? 1, v => { ask({ volume: Math.max(0, Math.min(1, +v || 0)) }); keepOwnVolume(); }, remote);
  stand('muted', () => !!sess.now?.muted, v => ask({ muted: !!v }), remote);
  stand('loop', () => !!sess.now?.repeat, v => ask({ repeat: !!v }), remote);
  A.play = function() {
    if (!mirror) {
      // Shown but never loaded here (it was another device's, and that
      // device and the session are both gone): Play loads it.
      if (!A.getAttribute('src') && playerState.currentSong) { A.src = streamUrl(playerState.currentSong); A.volume = playerState.volume; }
      return realPlay.call(A);
    }
    if (!remote()) return playHere();
    expect({ playing: true }); send({ t: 'resume' }); paint();
    return Promise.resolve();
  };
  A.pause = function() {
    if (!mirror) return realPause.call(A);
    if (!remote()) return;
    expect({ playing: false }); send({ t: 'pause' }); paint();
  };
  if ('fastSeek' in proto) {
    const realFastSeek = proto.fastSeek;
    A.fastSeek = function(t) { if (mirror) seek(t); else realFastSeek.call(A, t); };
  }

  function seek(t) {
    if (!sess.now) return;
    t = Math.max(0, Math.min(+t || 0, dur() || Infinity));
    if (remote()) { expect({ pos: t }); send({ t: 'seek', pos: t }); }
    else sess.now = { ...sess.now, pos: t, at: serverNow() };
    fire('seeked'); fire('timeupdate');
  }

  // The sliders save the volume they set as this device's own. While
  // they're setting the other device's, the saved one is put back.
  function keepOwnVolume() {
    if (!own) return;
    const v = own.volume;
    queueMicrotask(() => { try { localStorage.setItem(VOLUME_KEY, v.toFixed(3)); } catch (e) {} });
  }
  function showVolume(v) {
    playerState.volume = v;
    volSlider.setPct(v);
    fsVolSlider.setPct(v);
  }

  // While another device plays, the bar moves on the clock.
  let ticker = null;
  function tick() {
    const want = mirror && !!sess.now?.playing && !document.hidden;
    if (want && !ticker) ticker = setInterval(() => fire('timeupdate'), 250);
    else if (!want && ticker) { clearInterval(ticker); ticker = null; }
  }
  document.addEventListener('visibilitychange', () => { tick(); if (mirror && !document.hidden) fire('timeupdate'); });

  // ── Showing what the active device is doing ──
  const queueSig = () => queue.length + ':' + queue.map(s => s.id).join(',');
  // What this device last took from (or gave to) the session, to tell
  // your own changes from the news.
  const mirrored = { playlist: null, queueSig: '' };
  const shown = { dur: 0, muted: false };

  function showContext(d) {
    let redraw = false;
    if ('playlist' in d) {
      playerState.playlist = mirrored.playlist = d.playlist;
      redraw = true;
    }
    // A queue change of your own that's still on its way out wins: its
    // echo is what arrives next.
    if ('queue' in d && !queueTimer) {
      queue = d.queue.slice();
      mirrored.queueSig = queueSig();
      redraw = true;
    }
    if (!redraw) return;
    if (sess.now && playerState.playlist[sess.now.index]) playerState.playlistIndex = sess.now.index;
    applying++;
    try { updateQueueBadge(); } finally { applying--; }
    if (pickerTab === 'queue') renderQueueList();
  }

  function songFor(now) {
    const s = playerState.playlist[now.index];
    return s && s.id === now.song.id ? s : now.song;
  }

  // The page catches up with sess.now. `jumped`: the position moved by
  // more than the clock accounts for.
  function paint(jumped) {
    const now = sess.now;
    if (!mirror || !now) return;
    const cur = playerState.currentSong;
    if (!cur || cur.id !== now.song.id) {
      applying++;
      try { playSong(songFor(now)); } finally { applying--; }
      shown.dur = -1;
      fire('loadstart');
    }
    if (playerState.playlist[now.index]) playerState.playlistIndex = now.index;
    if (_shuffleOn !== now.shuffle) { _shuffleOn = now.shuffle; syncShuffleBtns(); }
    if (_repeatOn !== now.repeat) {
      _repeatOn = now.repeat;
      document.getElementById('fsRepeat')?.setAttribute('aria-pressed', _repeatOn);
    }
    if (remote()) {
      let changed = shown.muted !== now.muted;
      shown.muted = now.muted;
      if (Math.abs(playerState.volume - now.volume) > 0.004) { showVolume(now.volume); changed = true; }
      if (changed) fire('volumechange');
    }
    if (shown.dur !== dur()) { shown.dur = dur(); fire('durationchange'); fire('loadedmetadata'); }
    if (playerState.playing !== now.playing) fire(now.playing ? 'play' : 'pause');
    if (jumped) fire('seeked');
    fire('timeupdate');
    tick();
  }

  // What this device just asked for shows at once, without waiting to
  // hear it back. Until it is heard back (or a moment passes), news that
  // doesn't match is older than the asking and is held.
  let hold = null;
  function expect(patch) {
    if (!sess.now) return;
    sess.now = { ...sess.now, pos: pos(), at: serverNow(), ...patch };
    clearTimeout(hold?.timer);
    hold = { late: hold?.late };
    hold.timer = setTimeout(() => {
      const late = hold.late;
      hold = null;
      if (late !== undefined && mirror) take(late);
    }, 1500);
  }
  function matches(now) {
    const w = sess.now;
    return !!now && !!w && now.song.id === w.song.id && now.playing === w.playing && Math.abs(posOf(now) - posOf(w)) < 2.5
      && Math.abs(now.volume - w.volume) < 0.02 && now.muted === w.muted && now.shuffle === w.shuffle && now.repeat === w.repeat;
  }
  function take(now) {
    if (hold) {
      if (!matches(now)) { hold.late = now; return; }
      clearTimeout(hold.timer);
      hold = null;
    }
    const jumped = !!now && !!sess.now && now.song.id === sess.now.song.id && Math.abs(posOf(now) - pos()) > 1.5;
    sess.now = now;
    paint(jumped);
  }

  // ── Changing who plays ──
  function become(r, m) {
    const wasRemote = remote(), wasPlaying = !mirror && !real.paused.get.call(A);
    if (m && !mirror) {
      // Letting go of this device's own audio, stream and all.
      realPause.call(A);
      A.removeAttribute('src');
      A.load();
    }
    role = r; mirror = m;
    if (remote() && !wasRemote) own = { volume: playerState.volume };
    if (!remote() && wasRemote && own) {
      const v = own.volume;
      own = null;
      showVolume(v);
      real.volume.set.call(A, v);
      fire('volumechange');
    }
    if (m && wasPlaying) {
      // The element's own 'pause' is still on its way and will say
      // "paused" to everything; what's true is whatever the session says.
      const resync = () => { if (mirror && sess.now && playerState.playing !== sess.now.playing) fire(sess.now.playing ? 'play' : 'pause'); };
      A.addEventListener('pause', resync, { once: true });
      setTimeout(resync, 200);
    }
    tick();
    render();
  }

  // Bring the sound here: load what the session has, where it's got to.
  // `asked`: another device asked for it, so there may be no click behind
  // this to let it play. Then the session is only claimed once it does.
  function playHere(opts) {
    const play = opts?.play !== false, asked = !!opts?.asked;
    if (role === 'off' || role === 'active') return Promise.resolve();
    if (!mirror) {
      // Idle with its own song loaded: just play it ('play' claims).
      return play && playerState.currentSong ? A.play() : Promise.resolve();
    }
    const now = sess.now, at = pos();
    if (!now) return Promise.resolve();
    const from = remote() ? sess.active : '';
    become('idle', false);
    const song = playerState.currentSong;
    A.src = streamUrl(now.song);
    // Where to start is given before it has loaded, and again once it has
    // if that didn't take.
    try { A.currentTime = at; } catch (e) {}
    A.addEventListener('loadedmetadata', () => {
      if (mirror || playerState.currentSong !== song) return;
      const t = real.currentTime.get.call(A);
      if (Math.abs(t - at) > 1.5 && t < 1.5) A.currentTime = at;
    }, { once: true });
    A.volume = playerState.volume;
    A.loop = _repeatOn;
    if (!play && playerState.playing) fire('pause');
    if (!asked) claim();
    if (!play) return Promise.resolve();
    const started = realPlay.call(A);
    if (!asked) return started.catch(err => { if (err?.name !== 'AbortError' && !mirror && playerState.playing) fire('pause'); });
    // Asked to by another device. A page may not be allowed to start by
    // itself (nothing clicked in it yet), and a browser tab that's in the
    // background and hasn't played anything doesn't even load: then it
    // goes back to how it was, and the device that asked is told.
    taking = true;
    return new Promise(done => {
      let over = false;
      const fail = () => {
        if (over) return;
        over = true;
        taking = false;
        if (!mirror && role !== 'active') {
          become(sess.active && sess.active !== ME ? 'remote' : 'idle', true);
          paint();
        }
        if (from) send({ t: 'no' }, from);
        done();
      };
      const timer = setTimeout(fail, 8000);
      started.then(() => { clearTimeout(timer); if (!over) { over = true; claim(); taking = false; done(); } },
        err => { clearTimeout(timer); if (err?.name !== 'AbortError') fail(); else done(); });
    });
  }

  // ── Reporting (the active device) ──
  const sent = { playlist: null, queueSig: null, offset: 0 };
  // claiming: this device has said (or is about to say) it's the active
  // one, and hasn't heard back. taking: it's starting up to, at another
  // device's asking. Either way, news that someone else is active is from
  // before that and doesn't send it back to being a remote.
  let claiming = false, taking = false, stalled = false;
  let pubTimer = null, pubBusy = false, pubAgain = false;

  // A list too long for the API keeps the stretch around where it's at.
  function cut(list, index) {
    if (list.length <= MAX_SONGS) return { list, start: 0 };
    const start = Math.max(0, Math.min(index - 100, list.length - MAX_SONGS));
    return { list: list.slice(start, start + MAX_SONGS), start };
  }

  function claim() {
    claiming = true;
    sent.playlist = sent.queueSig = null;
    publish();
  }
  function publish() {
    if (role === 'off' || mirror) return;
    if (pubBusy) { pubAgain = true; return; }
    if (!pubTimer) pubTimer = setTimeout(flush, 60);
  }
  async function flush() {
    pubTimer = null;
    const song = playerState.currentSong;
    if (mirror || !connected || !song || !(role === 'active' || claiming)) return;
    const body = { device: ME };
    if (claiming) body.claim = true;
    const sig = queueSig(), list = playerState.playlist;
    if (sig !== sent.queueSig) body.queue = queue.map(slimSong);
    let offset = sent.offset;
    // What's up next is only any use to another device.
    if (list !== sent.playlist && (others() || claiming)) {
      const c = cut(list, playerState.playlistIndex);
      body.playlist = c.list.map(slimSong);
      offset = c.start;
    }
    const d = real.duration.get.call(A);
    body.now = {
      song: slimSong(song), playing: !real.paused.get.call(A) && !real.ended.get.call(A), stalled,
      pos: real.currentTime.get.call(A) || 0, dur: Number.isFinite(d) ? d : song.duration || 0,
      index: Math.max(0, playerState.playlistIndex - offset),
      shuffle: _shuffleOn, repeat: _repeatOn, volume: playerState.volume, muted: real.muted.get.call(A),
    };
    pubBusy = true;
    let r = null;
    try { r = await api('PUT', '/state', body); } catch (e) {}
    pubBusy = false;
    if (r?.ok) {
      noteClock(r.data?.t);
      sent.queueSig = sig;
      if (body.playlist) { sent.playlist = list; sent.offset = offset; }
      claiming = false;
      sess.now = { ...body.now, at: serverNow() };
      if (r.data?.active === ME && role !== 'active' && !mirror) { sess.active = ME; become('active', false); }
    } else if (r?.status === 409) {
      // Another device is playing (the stream says so too, and this one
      // follows it), or the stream isn't open yet (said again when it is).
      if (r.data?.error !== 'not connected') claiming = false;
    } else if (r && r.status >= 400 && r.status < 500) {
      claiming = false;   // something about it the API won't take: saying it again won't help
    } else {
      setTimeout(publish, 3000);
    }
    if (pubAgain) { pubAgain = false; publish(); }
  }

  // Real things happening to this device's own audio.
  A.addEventListener('play', () => {
    if (mirror || role === 'off') return;
    // Playing where nobody was: this is where it's playing now.
    if (role === 'idle') claim(); else publish();
  });
  for (const t of ['pause', 'seeked', 'loadedmetadata', 'volumechange']) A.addEventListener(t, () => { if (!mirror) publish(); });
  A.addEventListener('waiting', () => { if (!mirror) { stalled = true; publish(); } });
  A.addEventListener('playing', () => { if (!mirror) { stalled = false; publish(); } });
  // Every so often while it plays, so the others' clocks don't wander.
  setInterval(() => { if (role === 'active' && !real.paused.get.call(A)) publish(); }, 10000);

  // ── Commands ──
  let line = Promise.resolve();
  async function api(method, path, body) {
    const r = await fetchTimeout(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 10000);
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data };
  }
  // In the order they were pressed.
  function send(cmd, to) {
    line = line.then(() => api('POST', '/cmd', { device: ME, cmd, ...(to ? { to } : {}) })).catch(() => null);
    return line;
  }
  // Volume, mute, shuffle, repeat: a drag is many of these, sent as few.
  let asking = null, askTimer = null;
  function ask(patch) {
    expect(patch);
    asking = { ...asking, ...patch };
    if (!askTimer) askTimer = setTimeout(() => {
      askTimer = null;
      const p = asking;
      asking = null;
      send({ t: 'set', ...p });
    }, 80);
    paint();
  }

  // playSong() calls this once the song is the one shown (js/02-player.js).
  // true: another device has it, and nothing is played here.
  function mirrorPlay(song) {
    if (!mirror) return false;
    if (applying) return true;
    if (!remote()) {
      // Nobody's playing: it plays here, and 'play' claims the session.
      become('idle', false);
      return false;
    }
    const list = playerState.playlist;
    const cmd = { t: 'play', song: slimSong(song), index: playerState.playlistIndex, shuffle: _shuffleOn };
    if (list !== mirrored.playlist) {
      const c = cut(list, cmd.index);
      cmd.playlist = c.list.map(slimSong);
      cmd.index -= c.start;
      mirrored.playlist = list;
    }
    const sig = queueSig();
    if (sig !== mirrored.queueSig) { cmd.queue = queue.map(slimSong); mirrored.queueSig = sig; }
    send(cmd);
    expect({ song: cmd.song, playing: true, stalled: false, pos: 0, dur: song.duration || 0, index: cmd.index, shuffle: _shuffleOn });
    shown.dur = -1;
    fire('loadstart');
    paint();
    return true;
  }

  function setQueue(list) {
    queue = list.slice();
    updateQueueBadge();
    if (pickerTab === 'queue') renderQueueList();
  }

  function onCommand(msg) {
    const c = msg.cmd || {};
    if (c.t === 'take') { playHere({ asked: true }); return; }
    if (c.t === 'no') { showToast(`${nameOf(msg.from)} can't start by itself. Press Play there.`, 'ti-devices'); return; }
    if (role !== 'active' || mirror) return;
    switch (c.t) {
      case 'resume': A.play().catch(() => {}); break;
      case 'pause': A.pause(); break;
      case 'seek': A.currentTime = c.pos; break;
      case 'next': nextSong(); break;
      case 'prev': prevSong(); break;
      case 'queue': setQueue(c.queue || []); break;
      // What's lined up, rearranged from another device (the phone apps
      // keep it as one list): the song that's on carries on.
      case 'list':
        if (c.playlist?.length) {
          playerState.playlist = c.playlist;
          playerState.playlistIndex = Math.min(c.index || 0, c.playlist.length - 1);
        }
        setQueue(c.queue || queue);
        break;
      case 'play': {
        if (!c.song) break;
        if (c.playlist) { playerState.playlist = c.playlist; playerState.playlistIndex = c.index || 0; }
        else if (Number.isInteger(c.index)) playerState.playlistIndex = c.index + (sent.playlist === playerState.playlist ? sent.offset : 0);
        if (c.queue) setQueue(c.queue);
        if ('shuffle' in c && c.shuffle !== _shuffleOn) { _shuffleOn = c.shuffle; syncShuffleBtns(); }
        const at = playerState.playlist[playerState.playlistIndex];
        playSong(at && at.id === c.song.id ? at : c.song);
        break;
      }
      case 'set':
        if ('volume' in c) {
          clearInterval(_loginFadeInterval);
          showVolume(c.volume);
          A.volume = c.volume;
          if (c.volume > 0 && !('muted' in c)) A.muted = false;
          try { localStorage.setItem(VOLUME_KEY, c.volume.toFixed(3)); } catch (e) {}
        }
        if ('muted' in c) A.muted = c.muted;
        if ('shuffle' in c && c.shuffle !== _shuffleOn) { _shuffleOn = c.shuffle; syncShuffleBtns(); }
        if ('repeat' in c) {
          _repeatOn = c.repeat;
          A.loop = c.repeat;
          document.getElementById('fsRepeat')?.setAttribute('aria-pressed', _repeatOn);
        }
        break;
    }
    publish();
  }

  // ── The buttons that don't go through the audio element ──
  const _next = nextSong;
  nextSong = async function() {
    if (remote()) { send({ t: 'next' }); return; }
    if (mirror) become('idle', false);   // parked: it carries on here
    return _next.apply(this, arguments);
  };
  const _prev = prevSong;
  prevSong = async function() {
    if (remote()) { send({ t: 'prev' }); return; }
    if (mirror) become('idle', false);
    return _prev.apply(this, arguments);
  };
  const _playSong = playSong;
  playSong = function(song) {
    const p = _playSong.apply(this, arguments);
    // The song changed: said now, not once it has loaded. Until it has
    // ('playing'), the others don't start counting.
    if (!mirror && song) { stalled = true; publish(); }
    return p;
  };

  // The queue is changed in a dozen places; all of them redraw its count.
  let queueTimer = null;
  const _badge = updateQueueBadge;
  updateQueueBadge = function() {
    _badge.apply(this, arguments);
    if (applying) return;
    if (remote()) {
      clearTimeout(queueTimer);
      queueTimer = setTimeout(() => {
        queueTimer = null;
        const sig = queueSig();
        if (!remote() || sig === mirrored.queueSig) return;
        mirrored.queueSig = sig;
        send({ t: 'queue', queue: queue.map(slimSong) });
      }, 40);
    } else publish();
  };
  // Shuffle and repeat are plain variables their buttons flip. These run
  // after those handlers (this file loads last).
  for (const id of ['fsShuffle', 'dockShuffle', 'fsRepeat']) {
    document.getElementById(id)?.addEventListener('click', () => {
      if (remote()) ask({ shuffle: _shuffleOn, repeat: _repeatOn });
      else publish();
    });
  }

  // ── The stream ──
  let es = null, retryIn = 3000, lostTimer = null;
  let settle;
  const ready = new Promise(res => { settle = res; });
  setTimeout(settle, 3000);   // nobody waits on a slow API

  function onHello(d) {
    const wasActive = role === 'active';
    connected = true;
    retryIn = 3000;
    clearTimeout(lostTimer);
    skewKnown = false;
    sent.playlist = sent.queueSig = null;
    onSync(d, true);
    // Still playing, and the API says it isn't (it restarted, or gave up
    // on a connection that was only slow): say so again.
    if (wasActive && !mirror && sess.active !== ME && playerState.currentSong && (!real.paused.get.call(A) || !d.now)) claim();
    else if (role === 'active' || claiming) publish();
    settle();
  }

  function onSync(d, hello) {
    noteClock(d.t);
    const had = sess.devices.length;
    sess.devices = d.devices || [];
    sess.active = d.active || '';
    if ('queue' in d) sess.queue = d.queue || [];
    if ('playlist' in d) sess.playlist = d.playlist || [];
    const other = sess.active && sess.active !== ME;

    if (other && (claiming || taking)) {
      // On its way to being the active one itself.
    } else if (other) {
      if (!remote()) {
        const was = role, playing = !mirror && !real.paused.get.call(A);
        if (window.klabParty?.leaveIfFollowing?.()) showToast('Left the listening party: your music moved to another device', 'ti-headphones');
        become('remote', true);
        // Everything, not just what this message brought.
        showContext({ queue: sess.queue, playlist: sess.playlist });
        if (was === 'active' || playing) showToast(`Now playing on ${nameOf(sess.active)}`, 'ti-devices');
        if (!('now' in d)) paint();
      } else showContext(d);
    } else if (sess.active === ME) {
      if (role !== 'active') become('active', false);
    } else if (remote()) {
      become('idle', true);   // whoever was playing has gone: parked on what it was playing
      showContext(d);
    } else if (role === 'active') {
      become('idle', false);  // paused long enough to be let go; the song stays loaded
    } else if (role === 'off' || hello) {
      // Nobody's playing. With nothing of this device's own loaded, it
      // shows what was last playing, ready to carry on.
      const park = !!d.now && (mirror || !playerState.currentSong);
      become('idle', park);
      if (park) showContext({ queue: sess.queue, playlist: sess.playlist });
    } else if (mirror) showContext(d);

    if ('now' in d) {
      if (mirror) take(d.now);
      else if (role !== 'active') sess.now = d.now;
    }
    // Nothing to stand in for (the API restarted with nobody playing).
    if (mirror && !sess.now) become('idle', false);
    // Someone new to tell what's up next.
    if (role === 'active' && sess.devices.length > had) publish();
    render();
  }

  let connecting = false, never = false, retryTimer = null;
  async function connect() {
    if (es || connecting || never) return;
    connecting = true;
    clearTimeout(retryTimer);
    let r = null, d = null;
    try {
      r = await fetchTimeout(BASE, {}, 8000);
      d = await r.json();
    } catch (e) {}
    connecting = false;
    // An API from before this (the site is deployed separately): one
    // player per device, as it always was.
    if (r && (r.status === 404 || r.status === 405)) { never = true; settle(); return; }
    if (!r?.ok || !d?.session) { settle(); retry(); return; }
    es = new EventSource(`${BASE}/stream?device=${ME}&name=${encodeURIComponent(NAME)}&platform=${encodeURIComponent(PLATFORM)}`);
    es.addEventListener('hello', e => onHello(JSON.parse(e.data)));
    es.addEventListener('sync', e => onSync(JSON.parse(e.data)));
    es.addEventListener('cmd', e => onCommand(JSON.parse(e.data)));
    es.onerror = () => {
      connected = false;
      // Out of touch for a while, a remote is no use as one: it goes
      // back to being its own player until the stream returns.
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (connected || !remote()) return;
        sess.active = '';
        if (sess.now) sess.now = { ...sess.now, pos: pos(), at: serverNow(), playing: false };
        become('idle', true);
        paint();
      }, 20000);
      // CLOSED: the browser has given up (signed out, a proxy's error
      // page). Otherwise it's already reconnecting by itself.
      if (es && es.readyState === EventSource.CLOSED) { es = null; retry(); }
    };
  }
  function retry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, retryIn);
    retryIn = Math.min(retryIn * 2, 60000);
  }
  connect();
  // Back in front (a phone's browser drops the stream while it's away):
  // don't wait out the retry.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !es) { retryIn = 3000; connect(); } });
  addEventListener('pageshow', e => { if (e.persisted && !es) connect(); });

  addEventListener('pagehide', e => {
    if (e.persisted) return;
    // Don't make the others wait out the grace period.
    if (role === 'active') { try { navigator.sendBeacon(BASE + '/release', JSON.stringify({ device: ME })); } catch (err) {} }
    es?.close();
    es = null;
    connected = false;
  });

  // ── Devices ──
  const dockBtn = document.getElementById('dockDevices');
  const fsBtn = document.getElementById('fsDevices');
  // What it is, by its system's or browser's mark (js/11-presence.js).
  const iconOf = platform => window.klabPlatformIconClass?.(platform) || (isPhone(platform) ? 'ti-device-mobile' : 'ti-device-desktop');
  function render() {
    const show = role !== 'off' && (others() || remote());
    const elsewhere = remote() ? nameOf(sess.active) : '';
    for (const b of [dockBtn, fsBtn]) {
      if (!b) continue;
      b.hidden = !show;
      b.classList.toggle('on', !!elsewhere);
      b.title = elsewhere ? `Playing on ${elsewhere}` : 'Devices';
      b.setAttribute('aria-label', b.title);
    }
    const name = document.getElementById('dockDevicesName');
    if (name) name.textContent = elsewhere;
    // Playing elsewhere, the button wears that device's mark.
    const icon = elsewhere ? iconOf(deviceOf(sess.active)?.platform) : 'ti-devices';
    for (const b of [dockBtn, fsBtn]) { const i = b?.querySelector('i'); if (i) i.className = 'ti ' + icon; }
    const note = document.getElementById('fsDeviceNote');
    if (note) note.textContent = elsewhere ? 'on ' + elsewhere : '';
  }
  function openDevices(e) {
    const rows = [...sess.devices].sort((a, b) => (b.id === ME) - (a.id === ME)).map(d => {
      const me = d.id === ME, playing = d.id === sess.active;
      return {
        label: (me ? 'This device' : d.name) + (playing ? ' · playing' : ''),
        icon: iconOf(d.platform),
        action: () => {
          if (playing) return;
          SFX && SFX.play('click');
          if (me) playHere(); else send({ t: 'take' }, d.id);
        },
      };
    });
    klabMenu(e, [{ header: 'Play on' }, ...rows]);
  }
  for (const b of [dockBtn, fsBtn]) b?.addEventListener('click', openDevices);

  window.klabSession = {
    get role() { return role; },
    get remote() { return remote(); },
    get mirror() { return mirror; },
    ready,
    mirrorPlay,
    playHere,
    // Whatever is played next plays on this device.
    here() { if (mirror) become('idle', false); },
    moveTo: id => send({ t: 'take' }, id),
    state: () => ({ role, mirror, connected, device: ME, active: sess.active, devices: sess.devices, now: sess.now, position: mirror ? pos() : real.currentTime.get.call(A) }),
  };
})();
