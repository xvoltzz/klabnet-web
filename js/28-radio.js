// ══════════════════════════════════════════
//  RADIO (experimental; Settings → Experimental). Stations like GTA's:
//  each is one long mix on a loop, and everyone tuned in hears the same
//  moment of it. Nothing streams: a station has a start time, so where
//  it's at is (now − start) mod its length on klabnet-api's clock
//  (routers/radio.py), and this plays the file from there and keeps
//  itself on that line, nudging its speed for small drift and jumping
//  for big.
//
//  Hold Q (or the dock's radio button) for the wheel: point at a station
//  and let go, or click it. Q tapped leaves the wheel open; arrows, the
//  scroll wheel and Enter work in it. Playing music turns the radio off,
//  and tuning in pauses the music.
// ══════════════════════════════════════════
(function() {
  const API = '/api/music-requests/radio';
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = true;
  let stations = [], loadedAt = 0, offset = 0, offsetAt = 0, tuned = null, drift = 0, settleUntil = 0;

  const on = () => !!_settings.radio;
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
  function volume() {
    audio.volume = Math.max(0, Math.min(1, playerState.volume ?? 0.8));
    audio.muted = !!playerState.audio.muted;
  }
  playerState.audio.addEventListener('volumechange', () => { if (tuned) volume(); });
  // Music playing takes over from the radio.
  playerState.audio.addEventListener('play', () => { if (tuned && !playerState.audio.muted && playerState.audio.volume > 0) off(); });

  async function tune(id) {
    const s = byId(id);
    if (!s) return;
    if (tuned === id && !audio.paused) return;
    if (!playerState.audio.paused) playerState.audio.pause();
    staticBurst();
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
  function off() {
    if (!tuned) return;
    tuned = null;
    clearInterval(drift);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    paintNow();
    window.klabPostPresence?.();
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
    pill.hidden = !s;
    document.getElementById('dockRadio')?.classList.toggle('on', !!s);
    document.body.classList.toggle('radio-on', !!s);
    if (!s) return;
    pill.querySelector('.radio-now-art').outerHTML = art(s, 'radio-now-art');
    pill.querySelector('.radio-now-name').textContent = s.name;
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
    if (!on()) return;
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
        '<div class="radio-hub-meta">' + esc(fmtLen(s.duration)) + ' loop · by ' + esc(s.owner) + '</div>';
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
    if (!on() || e.metaKey || e.ctrlKey || e.altKey) return;
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
  async function openManage() {
    if (!on()) return;
    manage.classList.add('open');
    SFX && SFX.play('open');
    mBody.innerHTML = '<p class="radio-note">Loading…</p>';
    await load(true);
    paintManage();
  }
  function paintManage(openId) {
    const mine = stations.filter(s => s.canEdit);
    mBody.innerHTML = '<p class="radio-note">A station is one long audio file that plays on a loop. Everyone tuned in hears the same moment of it, like a real station. Make the mix however you like, then upload it here.</p>' +
      mine.map(s => '<details class="radio-item"' + (openId === s.id ? ' open' : '') + '><summary>' + art(s, 'radio-item-art') +
        '<span class="radio-item-text"><b>' + esc(s.name) + '</b><span>' + esc(fmtLen(s.duration)) + ' loop' + (s.owner !== window.KLAB_USER?.username ? ' · by ' + esc(s.owner) : '') + '</span></span><i class="ti ti-chevron-down"></i></summary>' + form(s) + '</details>').join('') +
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
        s = await send('POST', API, fd, bar);
      } else {
        s = await send('PATCH', API + '/' + encodeURIComponent(id), JSON.stringify({ name: v('name'), description: v('description'), color: v('color'), tracklist: v('tracklist') }));
        if (file) { const fd = new FormData(); fd.append('file', file); s = await send('PUT', API + '/' + encodeURIComponent(id) + '/audio', fd, bar); }
      }
      if (cover) { const fd = new FormData(); fd.append('file', cover); s = await send('POST', API + '/' + encodeURIComponent(s.id) + '/cover', fd); }
      await load(true);
      paintManage(s.id);
      if (tuned === s.id) { const t = tuned; tuned = null; tune(t); }
      showToast?.(id === 'new' ? 'Station made: it’s on the wheel' : 'Saved', 'ti-radio');
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
    } catch (err) { showToast?.('Couldn’t delete it: ' + err.message, 'ti-alert-triangle'); }
  });

  // ── The switch, and the dock's button ──
  const dockBtn = document.getElementById('dockRadio');
  dockBtn?.addEventListener('click', () => { SFX && SFX.play('click'); wheel.hidden ? openWheel() : closeWheel(); });
  const toggle = document.getElementById('radioToggle');
  function apply() {
    const yes = on();
    toggle?.classList.toggle('on', yes);
    toggle?.setAttribute('aria-checked', String(yes));
    if (dockBtn) dockBtn.hidden = !yes;
    if (!yes) { off(); closeWheel(true); }
    else if (!offsetAt) syncClock();
  }
  // The shared toggle handler (js/07-tabnav.js) has already flipped it.
  toggle?.addEventListener('click', () => { _settings.radio = toggle.classList.contains('on'); saveSettings(); apply(); });
  apply();

  window.klabRadio = { open: openWheel, tune, off, now: () => tuned, offset: () => offset, position: id => { const s = byId(id); return s ? posOf(s) : null; }, audio };
})();
