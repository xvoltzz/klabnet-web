// ══════════════════════════════════════════
//  RADIO: stations like GTA's (Music → Radio, or Q for the wheel):
//  each is one long mix on a loop, and everyone tuned in hears the same
//  moment of it. Nothing streams: a station has a start time, so where
//  it's at is (now − start) mod its length on klabnet-api's clock
//  (routers/radio.py), and this plays the file from there and keeps
//  itself on that line, nudging its speed for small drift and jumping
//  for big.
//
//  Music → Radio is a tuner: an FM dial you scroll sideways, static
//  between stations and a station coming in as the needle nears its
//  frequency. Hold Q (or the dock's radio button) for the wheel, a quick
//  jump: point at a station and let go, or click it. Playing music turns
//  the radio off, and tuning in pauses the music.
// ══════════════════════════════════════════
(function() {
  const API = '/api/music-requests/radio';
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = true;
  let stations = [], loadedAt = 0, offset = 0, offsetAt = 0, tuned = null, drift = 0, settleUntil = 0;
  // power: the radio's on (a station, or static between them on the dial).
  // level: how much of the station's signal is coming in (the dial, near
  // its frequency); the rest is static.
  let power = false, level = 1;
  const FREQ_MIN = 87.5, FREQ_MAX = 108.0;
  const FREQ_KEY = 'klabnet_radio_freq';
  let dialFreq = (() => { try { const f = +localStorage.getItem(FREQ_KEY); return f >= FREQ_MIN && f <= FREQ_MAX ? f : 98.7; } catch (e) { return 98.7; } })();

  const byId = id => stations.find(s => s.id === id);

  // ── The shared clock ──
  // The server's time now, in ms: a few asks, the quickest one counted
  // (half its round trip is how far behind its answer is).
  async function syncClock() {
    let best = null;
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      try {
        const r = await fetchTimeout(API + '/time', { cache: 'no-store' }, 4000);
        const d = await r.json();
        const t1 = performance.now(), rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt, off: d.now * 1000 + rtt / 2 - Date.now() };
      } catch (e) {}
    }
    if (best) { offset = best.off; offsetAt = Date.now(); }
    return !!best;
  }
  const now = () => (Date.now() + offset) / 1000;
  const posOf = s => (((now() - s.epoch) % s.duration) + s.duration) % s.duration;
  // What's on right now, from the station's tracklist.
  function trackAt(s, pos) {
    const t = s.tracklist || [];
    let cur = null, next = null;
    for (const item of t) { if (item[0] <= pos) cur = item; else { next = item; break; } }
    return { cur: cur?.[1] || '', next: next?.[1] || '', nextIn: next ? next[0] - pos : null };
  }

  async function load(force) {
    if (!force && Date.now() - loadedAt < 15000 && stations.length) return stations;
    try {
      const r = await fetchTimeout(API, {}, 8000);
      if (r.status === 404 || r.status === 405 || !/json/.test(r.headers.get('content-type') || '')) { stations = []; loadedAt = 0; return null; }
      const d = await r.json();
      stations = d.stations || [];
      loadedAt = Date.now();
      // The list's own clock is good enough until the proper one's in.
      if (!offsetAt) offset = d.now * 1000 - Date.now();
    } catch (e) { return null; }
    return stations;
  }

  // ── Tuning in ──
  const mainVolume = () => playerState.audio.muted ? 0 : Math.max(0, Math.min(1, playerState.volume ?? 0.8));
  function volume() {
    audio.volume = Math.max(0, Math.min(1, mainVolume() * level));
    audio.muted = !!playerState.audio.muted;
    setStatic(staticWanted);
  }
  playerState.audio.addEventListener('volumechange', () => { if (power) volume(); });
  // Music playing takes over from the radio.
  playerState.audio.addEventListener('play', () => { if (power && !playerState.audio.muted && playerState.audio.volume > 0) off(); });

  // opts.fromDial: the dial's doing it (no burst of static; it has its
  // own, and it says how strong the signal is).
  async function tune(id, opts = {}) {
    // From someone else's card, before this page has asked for the stations.
    if (!byId(id)) await load(true);
    const s = byId(id);
    if (!s) return;
    power = true;
    if (!opts.fromDial) { level = 1; staticWanted = 0; setDialFreq(s.frequency, true); }
    if (tuned === id && !audio.paused) { volume(); paintNow(); return; }
    if (!playerState.audio.paused) playerState.audio.pause();
    if (!opts.fromDial) staticBurst();
    if (Date.now() - offsetAt > 10 * 60e3) await syncClock();
    tuned = id;
    volume();
    if (!audio.src.endsWith(s.audio)) {
      audio.src = s.audio;
      await new Promise(res => { audio.addEventListener('loadedmetadata', res, { once: true }); audio.addEventListener('error', res, { once: true }); });
    }
    if (tuned !== id) return;
    // A little ahead: it takes a moment to start from a seek.
    audio.currentTime = (posOf(s) + 0.25) % s.duration;
    audio.playbackRate = 1;
    settleUntil = performance.now() + 2500;
    try { await audio.play(); } catch (e) { showToast?.('Couldn’t start the radio: ' + (e.message || 'blocked'), 'ti-radio'); off(); return; }
    clearInterval(drift);
    drift = setInterval(keepInSync, 1000);
    paintNow();
    window.klabPostPresence?.();
  }
  // The station goes quiet; the radio may stay on (static, on the dial).
  function dropStation() {
    if (!tuned) return;
    tuned = null;
    clearInterval(drift);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    paintNow();
    window.klabPostPresence?.();
  }
  function off() {
    power = false;
    staticWanted = 0;
    setStatic(0);
    dropStation();
    paintNow();
    dial.paint();
  }
  // On the line: within 60ms is fine, under 0.8s it eases back by playing
  // up to 3% faster or slower, and past that it jumps.
  function keepInSync() {
    const s = byId(tuned);
    if (!s || audio.paused || audio.seeking || audio.readyState < 3) return;
    const target = posOf(s);
    let d = audio.currentTime - target;
    if (d > s.duration / 2) d -= s.duration; else if (d < -s.duration / 2) d += s.duration;
    if (performance.now() < settleUntil) return;
    if (Math.abs(d) > 0.8) {
      audio.playbackRate = 1;
      audio.currentTime = (target + 0.2) % s.duration;
      settleUntil = performance.now() + 2500;
    } else if (Math.abs(d) > 0.06) {
      audio.playbackRate = Math.max(0.97, Math.min(1.03, 1 - d * 0.3));
    } else audio.playbackRate = 1;
    paintNowText();
  }
  audio.addEventListener('playing', () => { settleUntil = performance.now() + 1500; });
  // Away and back: the clock may have drifted, and the line moved on.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && tuned) syncClock(); });

  // A short burst of static between stations, when sounds are on.
  let noiseCtx = null;
  function staticBurst() {
    if (!_settings.sfxEnabled) return;
    try {
      noiseCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = noiseCtx, len = Math.floor(ctx.sampleRate * 0.45);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
      g.gain.value = 0.18 * (_settings.sfxVolume ?? 0.7);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start();
    } catch (e) {}
  }

  // Static between stations, for as long as the dial is between them: a
  // loop of noise, band-passed like an FM receiver's hiss.
  let staticWanted = 0, staticSrc = null, staticGain = null;
  function setStatic(amount) {
    staticWanted = amount;
    const g = amount * mainVolume() * 0.22;
    if (g <= 0.0005) {
      if (staticGain) staticGain.gain.setTargetAtTime(0, noiseCtx.currentTime, 0.05);
      return;
    }
    try {
      noiseCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (noiseCtx.state === 'suspended') noiseCtx.resume();
      if (!staticSrc) {
        const ctx = noiseCtx, len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        staticSrc = ctx.createBufferSource(); staticSrc.buffer = buf; staticSrc.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 0.5;
        staticGain = ctx.createGain(); staticGain.gain.value = 0;
        staticSrc.connect(bp).connect(staticGain).connect(ctx.destination);
        staticSrc.start();
      }
      staticGain.gain.setTargetAtTime(g, noiseCtx.currentTime, 0.04);
    } catch (e) {}
  }

  // ── What's on: a pill over the dock while tuned in ──
  const pill = document.createElement('div');
  pill.className = 'radio-now';
  pill.hidden = true;
  pill.innerHTML = '<button type="button" class="radio-now-main" title="Change station (Q)"><span class="radio-now-art"></span>' +
    '<span class="radio-now-text"><span class="radio-now-name"></span><span class="radio-now-track"></span></span></button>' +
    '<span class="radio-live"><span class="radio-live-dot"></span>Live</span>' +
    '<button type="button" class="radio-now-off" title="Radio off" aria-label="Radio off"><i class="ti ti-x"></i></button>';
  document.body.appendChild(pill);
  pill.querySelector('.radio-now-main').addEventListener('click', () => openWheel());
  pill.querySelector('.radio-now-off').addEventListener('click', () => { SFX && SFX.play('click'); off(); });
  const art = (s, cls) => '<span class="' + cls + '" style="--st:' + esc(s.color || 'var(--glass-fill-h)') + '">' +
    (s.cover ? '<img src="/api/music-requests/playlists/covers/' + encodeURIComponent(s.cover) + '/s" alt="" />' : '<b>' + esc(initials(s.name)) + '</b>') + '</span>';
  const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  function placePill() {
    const dock = document.getElementById('playerDock')?.getBoundingClientRect();
    pill.style.bottom = (dock && dock.height ? innerHeight - dock.top + 10 : 20) + 'px';
  }
  function paintNow() {
    const s = byId(tuned);
    // The Radio page says it all already.
    pill.hidden = !s || page.showing() || dock.on();
    document.getElementById('dockRadio')?.classList.toggle('on', !!s);
    document.body.classList.toggle('radio-on', !!s);
    if (!s) return;
    pill.querySelector('.radio-now-art').outerHTML = art(s, 'radio-now-art');
    pill.querySelector('.radio-now-name').textContent = s.frequency.toFixed(1) + ' · ' + s.name;
    placePill();
    paintNowText();
  }
  function paintNowText() {
    const s = byId(tuned);
    if (!s) return;
    const t = trackAt(s, posOf(s));
    pill.querySelector('.radio-now-track').textContent = t.cur || s.description || 'by ' + s.owner;
  }
  addEventListener('resize', () => { if (tuned) placePill(); });

  // ── The wheel ──
  const wheel = document.createElement('div');
  wheel.className = 'radio-wheel';
  wheel.hidden = true;
  wheel.setAttribute('role', 'dialog');
  wheel.setAttribute('aria-label', 'Radio');
  wheel.innerHTML = '<div class="radio-ring"><div class="radio-slots"></div>' +
    '<div class="radio-hub"><svg class="radio-loop" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47"/><circle class="radio-loop-fill" cx="50" cy="50" r="47" pathLength="100"/></svg>' +
    '<div class="radio-hub-in"></div></div></div>' +
    '<div class="radio-foot"><span class="radio-hint">Point and let go of Q · click · ← → and Enter</span>' +
    '<button type="button" class="radio-manage-btn"><i class="ti ti-upload"></i>Your stations</button></div>';
  document.body.appendChild(wheel);
  const slotsEl = wheel.querySelector('.radio-slots'), hub = wheel.querySelector('.radio-hub-in'), ring = wheel.querySelector('.radio-ring');
  let sel = 0, hubTimer = 0;
  const choices = () => [null, ...stations]; // the first is "off"

  async function openWheel() {
    if (!wheel.hidden) return;
    wheel.hidden = false;
    requestAnimationFrame(() => wheel.classList.add('open'));
    SFX && SFX.play('open');
    renderWheel(true);
    const got = await load();
    if (got === null && !stations.length) hub.innerHTML = '<div class="radio-hub-name">Radio needs the latest klabnet-api</div>';
    else renderWheel(true);
    if (Date.now() - offsetAt > 10 * 60e3) syncClock();
    clearInterval(hubTimer);
    hubTimer = setInterval(paintHub, 500);
  }
  function closeWheel(silent) {
    if (wheel.hidden) return;
    wheel.classList.remove('open');
    clearInterval(hubTimer);
    if (!silent) SFX && SFX.play('close');
    setTimeout(() => { if (!wheel.classList.contains('open')) wheel.hidden = true; }, 220);
  }
  function renderWheel(reselect) {
    const list = choices();
    if (reselect) sel = Math.max(0, list.findIndex(s => (s?.id || null) === tuned));
    const n = list.length;
    slotsEl.innerHTML = list.map((s, i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return '<button type="button" class="radio-slot' + (i === sel ? ' sel' : '') + ((s?.id || null) === tuned ? ' tuned' : '') + '" data-i="' + i + '" ' +
        'style="--x:' + Math.cos(a).toFixed(4) + ';--y:' + Math.sin(a).toFixed(4) + '" aria-label="' + esc(s ? s.name : 'Radio off') + '">' +
        (s ? art(s, 'radio-slot-art') + (s.listeners?.length ? '<span class="radio-slot-n">' + s.listeners.length + '</span>' : '')
           : '<span class="radio-slot-art radio-off-art"><i class="ti ti-x"></i></span>') + '</button>';
    }).join('');
    if (!stations.length) hub.innerHTML = '<div class="radio-hub-name">No stations yet</div><div class="radio-hub-sub">Make one: Your stations, below</div>';
    paintHub();
  }
  function select(i) {
    const n = choices().length;
    i = ((i % n) + n) % n;
    if (i === sel) return;
    sel = i;
    slotsEl.querySelectorAll('.radio-slot').forEach(b => b.classList.toggle('sel', +b.dataset.i === sel));
    SFX && SFX.play('tick');
    paintHub();
  }
  function paintHub() {
    if (wheel.hidden || !stations.length) return;
    const s = choices()[sel];
    const loopFill = wheel.querySelector('.radio-loop-fill');
    if (!s) {
      hub.innerHTML = '<div class="radio-hub-name">Radio off</div><div class="radio-hub-sub">' + (tuned ? 'Let go to turn it off' : 'Pick a station') + '</div>';
      loopFill.style.strokeDashoffset = 100;
      return;
    }
    const pos = posOf(s), t = trackAt(s, pos);
    const key = s.id + '|' + t.cur + '|' + (s.listeners || []).join();
    if (hub.dataset.key !== key) {
      hub.dataset.key = key;
      hub.innerHTML = art(s, 'radio-hub-art') +
        '<div class="radio-hub-name">' + esc(s.name) + '</div>' +
        '<div class="radio-hub-sub">' + (t.cur ? '<span class="radio-live-dot"></span>' + esc(t.cur) : esc(s.description || '')) + '</div>' +
        (s.listeners?.length ? '<div class="radio-hub-who">' + s.listeners.slice(0, 5).map(u => '<span style="color:' + (typeof profileColor === 'function' ? profileColor(u) : 'inherit') + '">' + esc(u) + '</span>').join(', ') + (s.listeners.length > 5 ? ' +' + (s.listeners.length - 5) : '') + ' tuned in</div>' : '') +
        '<div class="radio-hub-meta">' + s.frequency.toFixed(1) + ' FM · by ' + esc(s.author || s.owner) + '</div>';
    }
    loopFill.style.strokeDashoffset = (100 - pos / s.duration * 100).toFixed(2);
  }
  const fmtLen = s => s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.round(s % 3600 / 60) + 'm' : Math.round(s / 60) + ' min';
  function choose() {
    const s = choices()[sel];
    closeWheel(true);
    if (s) tune(s.id); else { off(); SFX && SFX.play('close'); }
  }
  // Pointing picks: whichever slot is nearest the pointer's direction.
  wheel.addEventListener('pointermove', e => {
    const r = ring.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.2) return;
    const n = choices().length;
    const a = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    select(Math.round(a / (2 * Math.PI / n)) % n);
  });
  wheel.addEventListener('wheel', e => { e.preventDefault(); select(sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
  wheel.addEventListener('click', e => {
    if (e.target.closest('.radio-manage-btn')) { closeWheel(true); openManage(); return; }
    const slot = e.target.closest('.radio-slot');
    if (slot) { sel = +slot.dataset.i; choose(); return; }
    if (e.target.closest('.radio-hub')) { choose(); return; }
    if (e.target === wheel) closeWheel();
  });

  // ── Keys: hold Q for the wheel ──
  const typing = () => { const el = document.activeElement; return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };
  const blocked = () => !!document.querySelector('.add-app-backdrop.open, .settings-backdrop.open, .img-view-backdrop.open, .klab-menu.visible, .ss.open') && wheel.hidden;
  let qDown = 0;
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!wheel.hidden) {
      const k = e.key;
      if (k === 'Escape') closeWheel();
      else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'd' || k === 's') select(sel + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'a' || k === 'w') select(sel - 1);
      else if (k === 'Enter' || k === ' ') choose();
      else if (k === 'q' || k === 'Q') { if (!e.repeat && !qDown) closeWheel(); }
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    if ((e.key === 'q' || e.key === 'Q') && !e.repeat && !typing() && !blocked()) {
      e.preventDefault(); e.stopImmediatePropagation();
      qDown = performance.now();
      openWheel();
    }
  }, true);
  document.addEventListener('keyup', e => {
    if (e.key !== 'q' && e.key !== 'Q') return;
    const held = qDown && performance.now() - qDown > 300;
    qDown = 0;
    // Held and let go: that's the pick. Tapped: the wheel stays to be used.
    if (held && !wheel.hidden) choose();
  }, true);

  // ── Your stations ──
  const manage = document.createElement('div');
  manage.className = 'add-app-backdrop radio-manage';
  manage.innerHTML = '<div class="add-app-modal" role="dialog" aria-label="Your stations" style="width:min(620px, calc(100vw - 2rem));">' +
    '<div class="add-app-title"><span>Your stations</span><button class="add-app-close" type="button" title="Close" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
    '<div class="radio-manage-body"></div></div>';
  document.body.appendChild(manage);
  const mBody = manage.querySelector('.radio-manage-body');
  const closeManage = () => { manage.classList.remove('open'); SFX && SFX.play('close'); };
  manage.querySelector('.add-app-close').addEventListener('click', closeManage);
  manage.addEventListener('click', e => { if (e.target === manage) closeManage(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && manage.classList.contains('open')) { e.stopPropagation(); closeManage(); } }, true);
  const tracklistText = s => (s.tracklist || []).map(([t, name]) => clockOf(t) + ' ' + name).join('\n');
  const clockOf = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = String(t % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec; };

  function form(s) {
    const id = s ? s.id : 'new';
    return '<form class="radio-form" data-id="' + esc(id) + '">' +
      '<div class="radio-form-row"><label>Name<input name="name" maxlength="60" required value="' + esc(s?.name || '') + '" placeholder="Non Stop Pop" /></label>' +
        '<label class="radio-color">Colour<input name="color" type="color" value="' + esc(s?.color || '#d94f70') + '" /></label></div>' +
      '<div class="radio-form-row radio-form-row-2"><label>Frequency <span class="radio-form-note">87.5–108 FM</span><input name="frequency" type="number" inputmode="decimal" min="87.5" max="108" step="0.1" required value="' + (s ? s.frequency.toFixed(1) : freeFrequency().toFixed(1)) + '" /></label>' +
        '<label>By <span class="radio-form-note">if it’s someone else’s; their username lets them edit it</span><input name="author" maxlength="60" list="radioPeople" value="' + esc(s && s.author !== s.owner ? s.author : '') + '" placeholder="' + esc(s?.owner || window.KLAB_USER?.username || '') + '" /></label></div>' +
      '<label>About it<input name="description" maxlength="300" value="' + esc(s?.description || '') + '" placeholder="What it plays" /></label>' +
      '<label>' + (s ? 'Replace the mix' : 'The mix') + ' <span class="radio-form-note">one audio file, played on a loop</span>' +
        '<input name="file" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav,.webm"' + (s ? '' : ' required') + ' /></label>' +
      '<label>Cover <span class="radio-form-note">optional, square works best</span><input name="cover" type="file" accept="image/*" /></label>' +
      '<label>Tracklist <span class="radio-form-note">optional, a line each: 0:00 Artist – Title</span>' +
        '<textarea name="tracklist" rows="5" placeholder="0:00 Intro&#10;3:12 Artist – Title">' + esc(s ? tracklistText(s) : '') + '</textarea></label>' +
      '<div class="radio-progress" hidden><span></span></div>' +
      '<div class="radio-form-actions">' + (s ? '<button type="button" class="radio-del">Delete station</button>' : '') +
        '<button type="submit" class="radio-save">' + (s ? 'Save' : 'Make station') + '</button></div>' +
    '</form>';
  }
  // A frequency nobody's near, for a new station.
  function freeFrequency() {
    for (let x = 881; x <= 1079; x += 20) if (stations.every(s => Math.abs(s.frequency - x / 10) >= 0.5)) return x / 10;
    for (let x = 875; x <= 1080; x++) if (stations.every(s => Math.abs(s.frequency - x / 10) >= 0.5)) return x / 10;
    return 98.7;
  }
  async function openManage(openId) {
    manage.classList.add('open');
    SFX && SFX.play('open');
    mBody.innerHTML = '<p class="radio-note">Loading…</p>';
    await load(true);
    paintManage(openId);
  }
  function paintManage(openId) {
    const mine = stations.filter(s => s.canEdit);
    mBody.innerHTML = '<p class="radio-note">A station is one long audio file that plays on a loop. Everyone tuned in hears the same moment of it, like a real station. Make the mix however you like, then upload it here.</p>' +
      '<datalist id="radioPeople">' + (window.klabPeople?.() || []).map(u => '<option value="' + esc(u) + '"></option>').join('') + '</datalist>' +
      mine.map(s => '<details class="radio-item"' + (openId === s.id ? ' open' : '') + '><summary>' + art(s, 'radio-item-art') +
        '<span class="radio-item-text"><b>' + esc(s.name) + '</b><span>' + esc(fmtLen(s.duration)) + ' loop · ' + s.frequency.toFixed(1) + ' FM' + (s.author !== window.KLAB_USER?.username ? ' · by ' + esc(s.author) : '') + '</span></span><i class="ti ti-chevron-down"></i></summary>' + form(s) + '</details>').join('') +
      '<details class="radio-item radio-new"' + (mine.length && openId !== 'new' ? '' : ' open') + '><summary><span class="radio-item-art radio-new-art"><i class="ti ti-plus"></i></span><span class="radio-item-text"><b>New station</b></span><i class="ti ti-chevron-down"></i></summary>' + form(null) + '</details>';
  }
  // Uploads go with XHR, for a progress bar: a mix can be hundreds of MB.
  function send(method, url, body, bar) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method, url);
      x.responseType = 'json';
      if (bar) x.upload.onprogress = e => { if (e.lengthComputable) { bar.hidden = false; bar.firstChild.style.width = (e.loaded / e.total * 100).toFixed(1) + '%'; } };
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(x.response) : reject(new Error(x.response?.error || 'failed (' + x.status + ')')));
      x.onerror = () => reject(new Error('the upload didn’t get through'));
      x.send(body);
    });
  }
  mBody.addEventListener('submit', async e => {
    const f = e.target.closest('.radio-form');
    if (!f) return;
    e.preventDefault();
    const id = f.dataset.id, btn = f.querySelector('.radio-save'), bar = f.querySelector('.radio-progress');
    const v = n => f.elements[n].value;
    const file = f.elements.file.files[0], cover = f.elements.cover.files[0];
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = file ? 'Uploading…' : 'Saving…';
    try {
      let s;
      if (id === 'new') {
        const fd = new FormData();
        fd.append('file', file); fd.append('name', v('name')); fd.append('description', v('description'));
        fd.append('color', v('color')); fd.append('tracklist', v('tracklist'));
        fd.append('frequency', v('frequency')); fd.append('author', v('author'));
        s = await send('POST', API, fd, bar);
      } else {
        s = await send('PATCH', API + '/' + encodeURIComponent(id), JSON.stringify({ name: v('name'), frequency: v('frequency'), author: v('author'), description: v('description'), color: v('color'), tracklist: v('tracklist') }));
        if (file) { const fd = new FormData(); fd.append('file', file); s = await send('PUT', API + '/' + encodeURIComponent(id) + '/audio', fd, bar); }
      }
      if (cover) { const fd = new FormData(); fd.append('file', cover); s = await send('POST', API + '/' + encodeURIComponent(s.id) + '/cover', fd); }
      await load(true);
      paintManage(s.id);
      if (tuned === s.id && file) { const t = tuned; tuned = null; tune(t, { fromDial: dialShowing() }); }
      dial.render();
      showToast?.(id === 'new' ? 'Station made: it’s on ' + s.frequency.toFixed(1) : 'Saved', 'ti-radio');
    } catch (err) {
      showToast?.('Couldn’t save the station: ' + err.message, 'ti-alert-triangle');
      btn.disabled = false; btn.textContent = was; bar.hidden = true;
    }
  });
  mBody.addEventListener('click', async e => {
    const del = e.target.closest('.radio-del');
    if (!del) return;
    const id = del.closest('.radio-form').dataset.id, s = byId(id);
    if (!s || !confirm('Delete “' + s.name + '”? Its mix goes too.')) return;
    try {
      await send('DELETE', API + '/' + encodeURIComponent(id));
      if (tuned === id) off();
      await load(true);
      paintManage();
      dial.render();
    } catch (err) { showToast?.('Couldn’t delete it: ' + err.message, 'ti-alert-triangle'); }
  });

  // ── The tuner ──
  // An FM band you scroll sideways under a fixed needle. A station comes
  // in over the last 0.25 MHz to its frequency (static fading out as it
  // does) and snaps on when you let go near it. Where the dial was is kept.
  // Two of them share the one needle: Music → Radio's big one, and the
  // dock's when it's switched to the radio. Static only plays while one of
  // them is showing.
  const strength = d => d <= 0.05 ? 1 : d >= 0.25 ? 0 : (t => t * t * (3 - 2 * t))(1 - (d - 0.05) / 0.2);
  const nearest = f => stations.reduce((best, s) => !best || Math.abs(s.frequency - f) < Math.abs(best.frequency - f) ? s : best, null);
  const saveFreq = () => { try { localStorage.setItem(FREQ_KEY, dialFreq.toFixed(2)); } catch (e) {} };
  const clampFreq = f => Math.max(FREQ_MIN, Math.min(FREQ_MAX, f));
  const views = [];
  const dialShowing = () => views.some(v => v.visible());
  let snapT = 0, tuneT = 0, dropT = 0, fine = false;

  // The needle's at f (moved by view `from`, or by code): every readout,
  // the signal, and what's heard.
  function needleAt(f, from, quiet) {
    dialFreq = clampFreq(f);
    const s = nearest(dialFreq), lvl = s ? strength(Math.abs(s.frequency - dialFreq)) : 0;
    views.forEach(v => { if (!v.visible()) return; if (v !== from) v.follow(dialFreq); v.paint(s, lvl); });
    if (!power) return;
    level = lvl;
    staticWanted = dialShowing() ? 1 - lvl : 0;
    volume();
    clearTimeout(tuneT); clearTimeout(dropT);
    if (lvl > 0 && s) {
      if (tuned !== s.id) tuneT = setTimeout(() => tune(s.id, { fromDial: true }), quiet ? 0 : 180);
    } else if (tuned) dropT = setTimeout(() => { if (level === 0) dropStation(); }, 1200);
  }
  // Let go near a station: onto it. Anywhere else: onto the nearest 0.1.
  // Fine-tuning with the arrows goes where it's sent, station or not.
  function snap(v) {
    const f = v.freq(), s = nearest(f);
    const to = !fine && s && Math.abs(s.frequency - f) <= 0.3 ? s.frequency : Math.round(f * 10) / 10;
    saveFreq();
    if (Math.abs(to - f) > 0.005) v.scrollTo(to, true);
  }
  // Sends the needle to f: the showing dial scrolls there (the others follow it).
  function goTo(f, smooth = true) {
    fine = false;
    f = clampFreq(Math.round(f * 10) / 10);
    const v = views.find(x => x.visible());
    dialFreq = f; saveFreq();
    if (v) v.scrollTo(f, smooth); else needleAt(f, null, true);
  }
  function stepStation(dir) {
    if (!stations.length) return;
    const f = dialFreq;
    const s = dir > 0 ? stations.find(x => x.frequency > f + 0.05) || stations[0] : [...stations].reverse().find(x => x.frequency < f - 0.05) || stations[stations.length - 1];
    if (!power) powerOn();
    goTo(s.frequency);
  }
  function powerOn() {
    power = true;
    if (!playerState.audio.paused) playerState.audio.pause();
    needleAt(dialFreq, null, true);
  }
  function togglePower() {
    SFX && SFX.play('click');
    if (power) off(); else powerOn();
  }
  // The last dial's gone: a station that's coming in plays on, clear; static stops.
  function dialGone() {
    if (dialShowing()) return;
    clearTimeout(snapT); clearTimeout(tuneT); clearTimeout(dropT);
    if (!power) return;
    if (tuned && level >= 0.5) { level = 1; staticWanted = 0; volume(); const s = byId(tuned); if (s) { dialFreq = s.frequency; saveFreq(); } }
    else off();
  }

  // One dial: a scale `px` wide per MHz in `box`, with its needle.
  function makeDial(box, { px, compact, visible, paint }) {
    const scroller = document.createElement('div');
    scroller.className = 'rd-scroll' + (compact ? ' rd-compact' : '');
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'slider');
    scroller.setAttribute('aria-label', 'Frequency');
    scroller.setAttribute('aria-valuemin', FREQ_MIN);
    scroller.setAttribute('aria-valuemax', FREQ_MAX);
    const needle = document.createElement('span');
    needle.className = 'rd-needle';
    needle.setAttribute('aria-hidden', 'true');
    box.append(scroller, needle);
    let expect = null, drag = null, key = '';

    function scale() {
      const w = (FREQ_MAX - FREQ_MIN) * px, label = compact ? 2 : 1;
      let ticks = '';
      for (let i = 0; i <= (FREQ_MAX - FREQ_MIN) * 10; i++) {
        const f = FREQ_MIN + i / 10, x = i * px / 10, whole = Math.abs(f - Math.round(f)) < 0.01, half = !whole && Math.abs(f * 2 - Math.round(f * 2)) < 0.01;
        if (compact && !whole && !half && i % 2) continue;
        ticks += '<line x1="' + x + '" x2="' + x + '" y1="0" y2="' + (compact ? (whole ? 10 : half ? 7 : 4) : (whole ? 22 : half ? 15 : 8)) + '"' + (whole ? ' class="rd-major"' : '') + '/>';
        if (whole && Math.round(f) % label === 0) ticks += '<text x="' + x + '" y="' + (compact ? 21 : 40) + '">' + Math.round(f) + '</text>';
      }
      const marks = stations.map(s => '<button type="button" class="rd-mark" tabindex="-1" data-f="' + s.frequency + '" style="left:' + ((s.frequency - FREQ_MIN) * px) + 'px;--st:' + esc(s.color || 'var(--text-dim)') + '" title="' + esc(s.frequency.toFixed(1) + ' · ' + s.name) + '">' +
        (compact ? '' : '<span class="rd-mark-name">' + esc(s.name) + '</span>') + '<span class="rd-mark-pin"></span></button>').join('');
      const h = compact ? 24 : 46;
      return '<div class="rd-scale" style="width:' + w + 'px">' + marks +
        '<svg class="rd-ticks" width="' + w + '" height="' + h + '" viewBox="-1 0 ' + (w + 2) + ' ' + h + '" aria-hidden="true">' + ticks + '</svg></div>';
    }
    const freq = () => clampFreq(FREQ_MIN + scroller.scrollLeft / px);
    const v = {
      visible, paint: (s, lvl) => { scroller.setAttribute('aria-valuenow', dialFreq.toFixed(1)); paint(s, lvl); }, freq,
      // The stations as they are now (a no-op if they haven't changed).
      build() {
        const k = stations.map(s => s.id + s.frequency + s.name + s.color).join();
        if (k !== key || !scroller.firstChild) { key = k; scroller.innerHTML = scale(); }
      },
      follow(f) { expect = Math.round((f - FREQ_MIN) * px); scroller.scrollLeft = expect; },
      scrollTo(f, smooth) { scroller.scrollTo({ left: (f - FREQ_MIN) * px, behavior: smooth ? 'smooth' : 'instant' }); },
      // Showing again: onto where the needle is, without a sound.
      sync() { v.build(); v.follow(dialFreq); },
      scroller,
    };
    scroller.addEventListener('scroll', () => {
      // Where follow() put it: another dial's doing the moving.
      if (expect !== null && Math.abs(scroller.scrollLeft - expect) < 1.5) { expect = null; return; }
      expect = null;
      needleAt(freq(), v);
      clearTimeout(snapT);
      snapT = setTimeout(() => { if (!drag) snap(v); }, 160);
    }, { passive: true });
    // An up-and-down wheel turns the dial too.
    scroller.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      fine = false;
      scroller.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 20 : 1) * 0.6 * px / 140;
    }, { passive: false });
    // Dragged with a mouse (touch scrolls it natively).
    scroller.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: scroller.scrollLeft, moved: false };
      fine = false;
      scroller.setPointerCapture(e.pointerId);
    });
    scroller.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      scroller.scrollLeft = drag.left - dx;
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) { scroller.dataset.dragged = '1'; setTimeout(() => delete scroller.dataset.dragged, 0); }
      snap(v);
    };
    scroller.addEventListener('pointerup', endDrag);
    scroller.addEventListener('pointercancel', endDrag);
    scroller.addEventListener('click', e => {
      const mark = e.target.closest('.rd-mark');
      if (!mark || scroller.dataset.dragged) return;
      if (!power) powerOn();
      goTo(+mark.dataset.f);
    });
    views.push(v);
    return v;
  }

  // ── Music → Radio ──
  const page = (() => {
    let showing = false, el = null, dialV = null, infoT = 0;

    function paintList() {
      if (!el) return;
      const box = el.querySelector('.rd-list');
      if (!stations.length) { box.innerHTML = '<div class="picker-empty">No stations yet. Make one: Your stations, above.</div>'; return; }
      box.innerHTML = stations.map(s => {
        const t = trackAt(s, posOf(s));
        return '<button type="button" class="rd-row' + (s.id === tuned ? ' on' : '') + '" data-f="' + s.frequency + '">' +
          '<span class="rd-row-f">' + s.frequency.toFixed(1) + '</span>' + art(s, 'rd-row-art') +
          '<span class="rd-row-text"><b>' + esc(s.name) + '</b><span>' + esc(t.cur || s.description || '') + '</span></span>' +
          '<span class="rd-row-by">' + (s.listeners?.length ? '<span class="rd-row-n"><i class="ti ti-headphones"></i>' + s.listeners.length + '</span>' : '') + 'by ' + esc(s.author || s.owner) + '</span></button>';
      }).join('');
    }

    function paint(s, lvl) {
      if (!el) return;
      el.querySelector('.rd-digits').textContent = dialFreq.toFixed(1);
      const info = el.querySelector('.rd-info');
      el.querySelector('.rd-set').classList.toggle('powered', power);
      el.querySelector('.rd-power').classList.toggle('on', power);
      el.querySelectorAll('.rd-signal i').forEach((b, i) => b.classList.toggle('lit', power && lvl * 5 > i + 0.01));
      const edit = el.querySelector('[data-act="edit"]');
      edit.hidden = !(s && lvl > 0.5 && s.canEdit);
      if (s && lvl > 0.5) edit.dataset.id = s.id;
      let key;
      if (!s || lvl <= 0.5) key = power ? 'static' : 'none';
      else key = s.id + '|' + trackAt(s, posOf(s)).cur + '|' + (s.listeners || []).join() + '|' + power + '|' + tuned;
      if (info.dataset.key === key) return;
      info.dataset.key = key;
      if (!s || lvl <= 0.5) {
        info.innerHTML = '<div class="rd-name rd-dim">' + (!stations.length ? 'No stations yet' : power ? 'Static' : 'Off') + '</div>' +
          '<div class="rd-sub">' + (!stations.length ? 'Make one with Your stations' : power ? 'Nothing on this frequency' : 'Press power, or pick a station') + '</div>';
        return;
      }
      const t = trackAt(s, posOf(s));
      info.innerHTML = art(s, 'rd-art') + '<div class="rd-info-text">' +
        '<div class="rd-name">' + esc(s.name) + (power && tuned === s.id ? '<span class="radio-live"><span class="radio-live-dot"></span>Live</span>' : '') + '</div>' +
        '<div class="rd-sub">' + esc(t.cur || s.description || '') + '</div>' +
        '<div class="rd-meta">by ' + esc(s.author || s.owner) +
          (s.listeners?.length ? ' · ' + s.listeners.slice(0, 4).map(u => '<span style="color:' + (typeof profileColor === 'function' ? profileColor(u) : 'inherit') + '">' + esc(u) + '</span>').join(', ') + (s.listeners.length > 4 ? ' +' + (s.listeners.length - 4) : '') + ' tuned in' : '') + '</div></div>';
    }

    function render() {
      if (!showing) return;
      if (!el || !pickerList.contains(el)) {
        pickerList.innerHTML = '<div class="rd-page">' +
          '<div class="rd-set">' +
            '<div class="rd-display">' +
              '<div class="rd-readout"><span class="rd-digits" aria-live="off"></span><span class="rd-fm">FM</span></div>' +
              '<div class="rd-info"></div>' +
              '<div class="rd-signal" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>' +
            '</div>' +
            '<div class="rd-tuner"></div>' +
            '<div class="rd-controls">' +
              '<button type="button" class="rd-btn" data-act="prev" title="Previous station (Page Up)"><i class="ti ti-player-skip-back"></i></button>' +
              '<button type="button" class="rd-btn rd-power" data-act="power" title="Power (Space)"><i class="ti ti-power"></i></button>' +
              '<button type="button" class="rd-btn" data-act="next" title="Next station (Page Down)"><i class="ti ti-player-skip-forward"></i></button>' +
              '<span class="rd-gap"></span>' +
              '<button type="button" class="rd-pill" data-act="edit" hidden><i class="ti ti-pencil"></i>Edit station</button>' +
              '<button type="button" class="rd-pill" data-act="manage"><i class="ti ti-upload"></i>Your stations</button>' +
            '</div>' +
          '</div>' +
          '<div class="rd-hint">Scroll or drag the dial · ← → to fine-tune · Page Up / Down for the next station · hold Q for the wheel</div>' +
          '<div class="picker-section-label">Stations</div><div class="rd-list"></div>' +
        '</div>';
        el = pickerList.querySelector('.rd-page');
        if (dialV) views.splice(views.indexOf(dialV), 1);
        dialV = makeDial(el.querySelector('.rd-tuner'), { px: 140, visible: () => showing && !!el, paint });
        el.addEventListener('click', onClick);
      }
      dialV.build();
      paintList();
      requestAnimationFrame(() => { if (!el) return; dialV.follow(dialFreq); needleAt(dialFreq, dialV, true); });
    }
    function onClick(e) {
      const row = e.target.closest('.rd-row');
      if (row) {
        if (!power) powerOn();
        goTo(+row.dataset.f, false);
        el.querySelector('.rd-set').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'power') togglePower();
      else if (act === 'prev') stepStation(-1);
      else if (act === 'next') stepStation(1);
      else if (act === 'edit') openManage(b.dataset.id);
      else if (act === 'manage') openManage();
    }

    // Keys while it's showing. Ahead of the player's own (←/→ and Space are
    // its previous, next and play).
    document.addEventListener('keydown', e => {
      if (!showing || !el || e.metaKey || e.ctrlKey || e.altKey || typing() || !wheel.hidden) return;
      if (document.querySelector('.add-app-backdrop.open, .settings-backdrop.open, .img-view-backdrop.open, .klab-menu.visible, .fs-player.open')) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        goTo(dialFreq + (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1), e.shiftKey);
        fine = true;
      } else if (k === 'PageUp') stepStation(-1);
      else if (k === 'PageDown') stepStation(1);
      else if (k === ' ' && !document.activeElement?.closest?.('button, a[href], summary')) togglePower();
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);

    async function start() {
      showing = true;
      el = null;
      paintNow();
      render();
      await load(true);
      if (!showing) return;
      if (power && tuned) { const s = byId(tuned); if (s && Math.abs(s.frequency - dialFreq) > 0.25) dialFreq = s.frequency; }
      render();
      dock.refresh();
      clearInterval(infoT);
      infoT = setInterval(() => {
        if (!showing || document.hidden) return;
        if (pickerTab !== 'radio') { leave(); return; }
        if (!el || !pickerList.contains(el)) return;
        el.querySelector('.rd-info').dataset.key = '';
        needleAt(dialFreq, dialV, true);
        if (Date.now() - loadedAt > 15000) load(true).then(() => { if (showing && el) { dialV.build(); paintList(); dock.refresh(); } });
        else paintList();
      }, 1000);
      document.getElementById('musicViewSub').textContent = stations.length ? klabCount(stations.length, 'station', 'stations') : '';
    }
    function leave() {
      if (!showing) return;
      showing = false;
      clearInterval(infoT);
      el = null;
      dialGone();
      paintNow();
    }
    return { showing: () => showing, start, leave, render: () => { if (showing) render(); } };
  })();

  // ── The dock, switched to the radio ──
  // The radio button flips the dock between the player and a small tuner:
  // the station, prev / power / next, and its own dial. Switching to it
  // turns the radio on; switching back, or playing music, turns it off.
  const dock = (() => {
    const dockEl = document.getElementById('playerDock');
    if (!dockEl) return { on: () => false, refresh() {}, set() {} };
    const MODE_KEY = 'klabnet_dock_radio';
    const pane = document.createElement('div');
    pane.className = 'dock-radio-pane';
    pane.hidden = true;
    pane.innerHTML = '<button type="button" class="drp-art" title="Open Radio"></button>' +
      '<div class="drp-main">' +
        '<div class="drp-top">' +
          '<span class="drp-readout"><span class="drp-freq"></span><span class="drp-fm">FM</span></span>' +
          '<span class="drp-info"><span class="drp-name"></span><span class="drp-track"></span></span>' +
          '<span class="drp-controls">' +
            '<button type="button" class="ctrl-btn" data-act="prev" title="Previous station"><i class="ti ti-player-skip-back"></i></button>' +
            '<button type="button" class="ctrl-btn play-btn drp-power" data-act="power" title="Power"><i class="ti ti-power"></i></button>' +
            '<button type="button" class="ctrl-btn" data-act="next" title="Next station"><i class="ti ti-player-skip-forward"></i></button>' +
          '</span>' +
        '</div>' +
        '<div class="rd-tuner drp-tuner"></div>' +
      '</div>';
    dockEl.insertBefore(pane, dockEl.querySelector('.player-secondary'));
    let mode = false;
    const visible = () => mode && !document.hidden && dockEl.getClientRects().length > 0;
    const dialV = makeDial(pane.querySelector('.drp-tuner'), { px: 60, compact: true, visible, paint });
    function paint(s, lvl) {
      pane.querySelector('.drp-freq').textContent = dialFreq.toFixed(1);
      pane.classList.toggle('powered', power);
      pane.querySelector('.drp-power').classList.toggle('on', power);
      const on = s && lvl > 0.5;
      const key = on ? s.id + '|' + trackAt(s, posOf(s)).cur + '|' + power : (power ? 'static' : 'off') + stations.length + dialFreq.toFixed(1);
      if (pane.dataset.key === key) return;
      pane.dataset.key = key;
      pane.querySelector('.drp-art').innerHTML = on ? art(s, 'drp-art-in') : '<span class="drp-art-in drp-art-none"><i class="ti ti-radio"></i></span>';
      pane.querySelector('.drp-name').innerHTML = '<span class="drp-freq-inline">' + dialFreq.toFixed(1) + ' · </span>' + esc(on ? s.name : !stations.length ? 'No stations yet' : power ? 'Static' : 'Radio off');
      pane.querySelector('.drp-track').textContent = on && !power ? 'Off · press power' : on ? (trackAt(s, posOf(s)).cur || 'by ' + (s.author || s.owner)) : !stations.length ? 'Make one in Music → Radio' : power ? 'Scroll the dial to a station' : 'Press power';
    }
    pane.addEventListener('click', e => {
      if (e.target.closest('.drp-art')) { setActiveTab('music'); document.querySelector('.picker-tab[data-tab="radio"]')?.click(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'power') togglePower();
      else stepStation(b.dataset.act === 'next' ? 1 : -1);
    });
    let tick = 0;
    async function set(yes, quiet) {
      mode = !!yes;
      try { localStorage.setItem(MODE_KEY, mode ? '1' : ''); } catch (e) {}
      dockEl.classList.toggle('radio-mode', mode);
      pane.hidden = !mode;
      const btn = document.getElementById('dockRadio');
      btn?.classList.toggle('active', mode);
      btn?.setAttribute('aria-pressed', String(mode));
      clearInterval(tick);
      if (!mode) { if (power && !quiet) off(); dialGone(); paintNow(); return; }
      await load();
      dialV.build();
      requestAnimationFrame(() => { dialV.follow(dialFreq); if (!quiet) powerOn(); else needleAt(dialFreq, dialV, true); });
      tick = setInterval(() => { if (visible()) { pane.dataset.key = ''; needleAt(dialFreq, dialV, true); } }, 1000);
      paintNow();
    }
    return {
      on: () => mode, set,
      refresh() { if (mode) { dialV.build(); pane.dataset.key = ''; if (visible()) needleAt(dialFreq, dialV, true); } },
      restore() { let m = ''; try { m = localStorage.getItem(MODE_KEY); } catch (e) {} if (m) set(true, true); },
    };
  })();
  // Music playing takes the dock back.
  playerState.audio.addEventListener('play', () => { if (dock.on() && !playerState.audio.muted) dock.set(false, true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { staticWanted = 0; setStatic(0); } else if (power && dialShowing()) needleAt(dialFreq, null, true); });

  // The old name the rest of this file uses for "the dials".
  const dial = {
    showing: () => page.showing(),
    paint: () => { if (dialShowing()) needleAt(dialFreq, null, true); },
    render: () => { page.render(); dock.refresh(); },
    // A station picked elsewhere (the wheel): the dials go there.
    set(f) { dialFreq = f; saveFreq(); views.forEach(v => v.visible() && v.follow(f)); if (dialShowing()) needleAt(f, null, true); },
  };
  function setDialFreq(f) { dial.set(f); }

  const musicTabChanged = window.klabMusicTabChanged;
  window.klabMusicTabChanged = isOn => {
    musicTabChanged?.(isOn);
    if (!isOn) page.leave();
    else if (pickerTab === 'radio' && !page.showing()) page.start();
  };
  const _prevLoadPickerTab = loadPickerTab;
  loadPickerTab = async function(tab) {
    if (tab !== 'radio') { page.leave(); return _prevLoadPickerTab(tab); }
    // What the layers underneath do on the way to any view they don't own.
    window.klabActivity?.stop();
    window.klabBrowse?.leave();
    if (typeof _songsObserver !== 'undefined' && _songsObserver) { _songsObserver.disconnect(); _songsObserver = null; }
    hideSortBtn();
    _pickerLoadToken++; clearTimeout(pickerDebounce);
    pickerTab = tab;
    pickerList.classList.remove('mh-home', 'picker-list-grid', 'is-stale');
    setMusicViewTitle(tab);
    page.start();
  };

  // ── The dock's button: the player or the radio ──
  const dockBtn = document.getElementById('dockRadio');
  dockBtn?.addEventListener('click', () => { SFX && SFX.play('click'); closeWheel(true); dock.set(!dock.on()); });
  syncClock();
  dock.restore();

  window.klabRadio = {
    open: openWheel, tune, off, dial: () => dialFreq, openManage, dock: yes => dock.set(yes),
    // What's on, for presence's beat (js/11-presence.js).
    station: () => { const s = byId(tuned); return s && power && level >= 0.5 ? { id: s.id, name: s.name, frequency: s.frequency, track: trackAt(s, posOf(s)).cur } : null; },
    now: () => tuned, offset: () => offset, position: id => { const s = byId(id); return s ? posOf(s) : null; }, audio };
})();
