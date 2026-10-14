// ══════════════════════════════════════════
//  VOICE — drop-in channels, like Mumble's or Discord's
//  A headset button in the header opens the channels and who's in them;
//  click one and you're in. The audio goes straight between browsers and
//  a LiveKit server on the homelab (WebRTC); klabnet-api only keeps the
//  channel names, says who's where, and signs the token that lets you
//  into a room (routers/voice.py).
//
//  The whole feature stays hidden until GET /api/voice says it's set up,
//  and LiveKit's client (600KB) is only fetched the first time you join.
//  You stay in the channel across tabs; reloading the page leaves it.
//
//  Per device, in localStorage (klabnet_voice): microphone, speakers, open
//  mic or push to talk and its key, the processing switches, and how loud
//  you've made each person. Settings → Voice edits them.
// ══════════════════════════════════════════
(function() {
  const btn = document.getElementById('voiceBtn');
  const micBtn = document.getElementById('voiceMicBtn');
  const panel = document.getElementById('voicePanel');
  if (!btn || !micBtn || !panel) return;
  const $ = id => document.getElementById(id);
  const listEl = $('vcChannels'), footEl = $('vcFoot');
  const LIB = 'js/vendor/livekit-client.umd.js?v=2.22.3';

  // ── What this device remembers ──
  const STORE_KEY = 'klabnet_voice';
  const S = { input: '', output: '', mode: 'open', pttCode: '', pttLabel: '', noise: true, echo: true, gain: true, vols: {} };
  try { Object.assign(S, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) {}
  if (!S.vols || typeof S.vols !== 'object') S.vols = {};
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} };

  // ── State ──
  const OFF = { enabled: false, online: false, canManage: false, channels: [] };
  let info = OFF;
  let LK = null, room = null;
  let joined = null;        // { id, name }: the channel you're in, or joining
  let phase = 'idle';       // idle | joining | live | reconnecting
  let joinSeq = 0;          // a join that was overtaken (you left, or picked another) gives up
  let muted = false, deafened = false, pttHeld = false;
  let micProblem = '';      // '' | 'blocked' | 'missing': in the channel, listening only
  let needsClick = false;   // the browser won't play sound until you've clicked the page
  let speaking = new Set();
  let volOpen = '';         // whose volume slider is showing
  let lastList = null, lastAttrs = '';

  const me = () => room?.localParticipant?.identity || window.KLAB_USER?.username || '';
  const sfx = name => { try { SFX && SFX.play(name); } catch (e) {} };
  const vol = u => { const v = Number(S.vols[u]); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100; };
  const wantLive = () => !muted && !deafened && !micProblem && (S.mode === 'open' || pttHeld);
  const showMuted = () => muted || deafened || !!micProblem;
  const micPub = () => room && LK ? room.localParticipant.getTrackPublication(LK.Track.Source.Microphone) : null;
  const captureOpts = () => ({
    deviceId: S.input || undefined, echoCancellation: !!S.echo, noiseSuppression: !!S.noise, autoGainControl: !!S.gain,
  });

  // Remote microphones play through <audio> elements kept here.
  const sink = document.createElement('div');
  sink.id = 'voiceSink';
  sink.hidden = true;
  document.body.appendChild(sink);

  let libPromise = null;
  function loadLib() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    return libPromise ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => (window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error('voice failed to load')));
      s.onerror = () => { libPromise = null; s.remove(); reject(new Error('voice failed to load')); };
      document.head.appendChild(s);
    });
  }

  // ── Who's where: asked of the API every few seconds ──
  let pollTimer = 0, polling = false;
  async function refresh() {
    if (polling) return;
    polling = true;
    try {
      const r = await fetchTimeout('/api/voice', { cache: 'no-store' }, 6000);
      // No such route: an API from before voice. Anything else that isn't
      // an answer (a blip, a sign-in bounce) keeps what was last known.
      if (r.status === 404) info = OFF;
      else if (r.ok) {
        const d = await r.json();
        if (d && Array.isArray(d.channels)) info = d;
      }
    } catch (e) {}
    polling = false;
    render();
    schedule();
  }
  function schedule() {
    clearTimeout(pollTimer);
    if (document.hidden) return; // nobody's looking; visibilitychange asks again
    pollTimer = setTimeout(refresh, !info.enabled ? 120000 : panelOpen() ? 4000 : 12000);
  }
  const refreshSoon = () => { clearTimeout(pollTimer); pollTimer = setTimeout(refresh, 600); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // ── Members ──
  // In your own channel the room itself says who's there, as it happens;
  // every other channel is what the API last said.
  const flag = (p, k) => (p.attributes || {})[k] === '1';
  function liveMembers() {
    const out = [{ username: me(), muted: showMuted(), deafened, me: true }];
    room.remoteParticipants.forEach(p => out.push({
      username: p.identity,
      muted: flag(p, 'mute') || !p.getTrackPublication(LK.Track.Source.Microphone),
      deafened: flag(p, 'deaf'),
      live: true,
    }));
    return out;
  }
  function membersOf(c) {
    const inRoom = room && phase !== 'joining';
    if (inRoom && joined?.id === c.id) return liveMembers();
    // Connected here means you're not in any other channel, whatever a
    // two-second-old answer says.
    return (c.members || []).filter(m => !(inRoom && m.username === me()));
  }

  // ── Drawing ──
  const panelOpen = () => panel.classList.contains('visible');

  function memberHTML(m) {
    const u = m.username;
    const url = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(u) : null;
    const color = typeof profileColor === 'function' ? profileColor(u) : 'inherit';
    const quiet = m.live && vol(u) === 0;
    // Who's speaking isn't in here: paintSpeaking() keeps it up in place,
    // and having it in the markup made every poll rebuild the list (and
    // drop a volume slider mid-drag) whenever someone started or stopped.
    let html = '<div class="vc-member' + (m.live ? ' adjustable' : '') + '" data-u="' + esc(u) + '">' +
      '<span class="vc-av">' + (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>' +
      '<span class="vc-name" style="color:' + color + '">' + esc(u) + '</span>' +
      (quiet ? '<i class="ti ti-volume-off" title="Muted for you"></i>' : '') +
      (m.muted ? '<i class="ti ti-microphone-off" title="Muted"></i>' : '') +
      (m.deafened ? '<i class="ti ti-headphones-off" title="Deafened"></i>' : '') +
      '</div>';
    if (m.live && volOpen === u) {
      html += '<div class="vc-volrow"><i class="ti ti-volume"></i>' +
        '<input type="range" class="vc-vol" min="0" max="100" step="1" data-u="' + esc(u) + '" aria-label="Volume for ' + esc(u) + '" />' +
        '<span class="vc-vol-n"></span></div>';
    }
    return html;
  }

  function channelHTML(c) {
    const mine = joined?.id === c.id;
    const people = membersOf(c);
    const state = !mine ? '<span class="vc-row-join">Join</span>'
      : '<span class="vc-row-state">' + (phase === 'joining' ? 'Joining…' : phase === 'reconnecting' ? 'Reconnecting…' : 'Connected') + '</span>';
    return '<div class="vc-channel' + (mine ? ' joined' : '') + '" data-id="' + c.id + '">' +
      '<button type="button" class="vc-row"' + (mine ? '' : ' title="Join ' + esc(c.name) + '"') + '>' +
      '<i class="ti ti-volume"></i><span class="vc-row-name">' + esc(c.name) + '</span>' + state + '</button>' +
      (people.length ? '<div class="vc-members">' + people.map(memberHTML).join('') + '</div>' : '') +
      '</div>';
  }

  function paintSpeaking() {
    listEl.querySelectorAll('.vc-member').forEach(el => el.classList.toggle('speaking', speaking.has(el.dataset.u)));
    micBtn.classList.toggle('speaking', !!room && speaking.has(me()));
  }

  function render() {
    const on = !!info.enabled;
    btn.hidden = !on && !room;
    $('voiceSettings').hidden = !on;
    if (btn.hidden) { closePanel(); micBtn.hidden = true; return; }

    // The header: lit while you're in a channel, with a mute button
    // beside it; otherwise a count of who's in voice, if anyone is.
    const inRoom = !!room && phase !== 'joining';
    const total = info.channels.reduce((n, c) => n + membersOf(c).length, 0);
    const badge = $('voiceBadge');
    badge.hidden = inRoom || !total;
    badge.textContent = total > 9 ? '9+' : String(total);
    btn.classList.toggle('active', !!joined);
    btn.title = joined ? 'Voice: ' + joined.name : total ? klabCount(total, 'person', 'people') + ' in voice' : 'Voice';
    btn.querySelector('i').className = deafened && inRoom ? 'ti ti-headphones-off' : 'ti ti-headset';
    micBtn.hidden = !inRoom;
    micBtn.classList.toggle('muted', showMuted());
    micBtn.setAttribute('aria-pressed', String(showMuted()));
    micBtn.title = micProblem ? 'Microphone unavailable: click to try again' : showMuted() ? 'Unmute' : 'Mute';
    micBtn.querySelector('i').className = showMuted() ? 'ti ti-microphone-off' : 'ti ti-microphone';

    // The list is rebuilt only when it would read differently, so a hover
    // or a volume slider mid-drag isn't pulled out from under you.
    let html = info.channels.map(channelHTML).join('');
    if (!info.online && !room) html += '<div class="vc-note">Voice is offline right now.</div>';
    if (html !== lastList) {
      lastList = html;
      listEl.innerHTML = html;
      listEl.querySelectorAll('.vc-vol').forEach(el => {
        el.value = vol(el.dataset.u);
        el.nextElementSibling.textContent = vol(el.dataset.u) + '%';
      });
    }
    $('vcAddBtn').hidden = !info.canManage;

    // The strip at the bottom: where you are and the three buttons.
    footEl.hidden = !joined;
    if (joined) {
      const [head, sub, warn] =
        phase === 'joining' ? ['Joining…', joined.name, false]
        : phase === 'reconnecting' ? ['Reconnecting…', joined.name, true]
        : needsClick ? ['Click to hear everyone', joined.name, true]
        : micProblem === 'blocked' ? ['Listening only', 'Your microphone is blocked', true]
        : micProblem === 'missing' ? ['Listening only', 'No microphone found', true]
        : ['Connected', joined.name + (S.mode === 'ptt' ? ' · push to talk' : ''), false];
      $('vcStatus').classList.toggle('warn', warn);
      $('vcStatusHead').textContent = head;
      $('vcStatusSub').textContent = sub;
      const mute = $('vcMute'), deaf = $('vcDeafen');
      mute.setAttribute('aria-pressed', String(showMuted()));
      mute.title = (showMuted() ? 'Unmute' : 'Mute') + ' (Ctrl+Shift+M)';
      mute.querySelector('i').className = showMuted() ? 'ti ti-microphone-off' : 'ti ti-microphone';
      deaf.setAttribute('aria-pressed', String(deafened));
      deaf.title = (deafened ? 'Undeafen' : 'Deafen') + ' (Ctrl+Shift+D)';
      deaf.querySelector('i').className = deafened ? 'ti ti-headphones-off' : 'ti ti-headphones';
      mute.disabled = deaf.disabled = phase === 'joining';
    }
    paintSpeaking();
  }

  // ── The microphone ──
  // Changes are applied one after another: push to talk can ask for
  // "on, off, on" faster than a mute round trip takes. Going quiet cuts
  // the microphone at the source first, there and then, so nothing that
  // goes wrong afterwards (a mute that fails, a slow connection) can leave
  // it open; a change that fails is tried again.
  let micChain = Promise.resolve(), micRetries = 0;
  const rawMic = () => micPub()?.track?.mediaStreamTrack || null;
  async function syncMic() {
    const pub = micPub();
    if (!pub) return;
    const live = wantLive();
    if (live && pub.isMuted) await pub.unmute();
    else if (!live && !pub.isMuted) await pub.mute();
    const raw = rawMic();
    if (raw) raw.enabled = wantLive() && !pub.isMuted;
  }
  function applyMic() {
    if (!wantLive()) { const raw = rawMic(); if (raw) raw.enabled = false; }
    micChain = micChain.then(syncMic).then(
      () => { micRetries = 0; },
      () => { if (room && micRetries++ < 3) setTimeout(applyMic, 400); });
    return micChain;
  }

  async function publishMic() {
    const r = room;
    if (!r || micPub()) return;
    try {
      const track = await LK.createLocalAudioTrack(captureOpts());
      if (room !== r) { track.stop(); return; }
      // Published already muted when it should be (push to talk, or you
      // muted before joining), so not even a syllable goes out first.
      if (!wantLive()) await track.mute();
      await r.localParticipant.publishTrack(track, { source: LK.Track.Source.Microphone });
      micProblem = '';
    } catch (e) {
      if (room !== r) return;
      micProblem = /NotFound|Overconstrained|DevicesNotFound/i.test(e?.name || '') ? 'missing' : 'blocked';
      showToast(micProblem === 'missing'
        ? 'No microphone found. You can still listen'
        : 'Your microphone is blocked. You can still listen; allow it for klabnet to talk', 'ti-microphone-off', 6000);
    }
    pushAttrs();
    render();
  }

  // Muted and deafened, as everyone else sees them. The API reads these
  // for people outside the channel too.
  function pushAttrs() {
    if (!room || phase === 'joining') return;
    const attrs = { mute: showMuted() ? '1' : '', deaf: deafened ? '1' : '' };
    const key = attrs.mute + attrs.deaf;
    if (key === lastAttrs) return;
    lastAttrs = key;
    room.localParticipant.setAttributes(attrs).catch(() => { lastAttrs = ''; });
  }

  function applyVolumes() {
    if (!room) return;
    room.remoteParticipants.forEach(p => { try { p.setVolume(deafened ? 0 : vol(p.identity) / 100); } catch (e) {} });
  }

  function toggleMute() {
    if (!room || phase === 'joining') return;
    if (micProblem) { muted = false; micProblem = ''; publishMic(); return; } // maybe it's allowed now
    // Unmuting while deafened brings your ears back too.
    if (deafened) { deafened = false; muted = false; applyVolumes(); }
    else muted = !muted;
    sfx(showMuted() ? 'tick' : 'click');
    applyMic(); pushAttrs(); render();
  }
  function toggleDeafen() {
    if (!room || phase === 'joining') return;
    deafened = !deafened;
    sfx(deafened ? 'tick' : 'click');
    applyVolumes(); applyMic(); pushAttrs(); render();
  }

  // ── Joining and leaving ──
  function reset() {
    room = null; joined = null; phase = 'idle';
    pttHeld = false; deafened = false; micProblem = ''; needsClick = false;
    speaking = new Set(); volOpen = ''; lastAttrs = '';
    sink.replaceChildren();
  }

  function wire(r) {
    const E = LK.RoomEvent;
    const mine = fn => (...a) => { if (room === r) fn(...a); };
    r.on(E.TrackSubscribed, mine((track, pub, p) => {
      if (track.kind !== 'audio') return;
      sink.appendChild(track.attach());
      try { p.setVolume(deafened ? 0 : vol(p.identity) / 100); } catch (e) {}
    }));
    r.on(E.TrackUnsubscribed, track => { try { track.detach().forEach(el => el.remove()); } catch (e) {} });
    r.on(E.ParticipantConnected, mine(() => { sfx('queue'); render(); }));
    r.on(E.ParticipantDisconnected, mine(p => {
      speaking.delete(p.identity);
      if (volOpen === p.identity) volOpen = '';
      sfx('pause'); render();
    }));
    [E.TrackPublished, E.TrackUnpublished, E.TrackUnmuted, E.LocalTrackPublished, E.ParticipantAttributesChanged]
      .forEach(ev => r.on(ev, mine(render)));
    // A muted microphone isn't speaking, whatever the last speaker update said.
    r.on(E.TrackMuted, mine((pub, p) => { speaking.delete(p.identity); render(); }));
    r.on(E.ActiveSpeakersChanged, mine(list => { speaking = new Set(list.map(p => p.identity)); paintSpeaking(); }));
    r.on(E.Reconnecting, mine(() => { phase = 'reconnecting'; render(); }));
    r.on(E.Reconnected, mine(() => { phase = 'live'; lastAttrs = ''; pushAttrs(); render(); }));
    r.on(E.AudioPlaybackStatusChanged, mine(() => { needsClick = !r.canPlaybackAudio; render(); }));
    r.on(E.MediaDevicesChanged, mine(() => { if (settingsOpen()) fillDevices(); }));
    // Only ever reached when it wasn't you who left: leave() lets go of
    // the room first. A connection that never got going is join()'s to report.
    r.on(E.Disconnected, mine(reason => {
      if (phase === 'joining') return;
      const R = LK.DisconnectReason || {};
      reset();
      sfx('close');
      showToast(
        reason === R.DUPLICATE_IDENTITY ? 'Voice moved to your other device'
        : reason === R.ROOM_DELETED ? 'That channel was deleted'
        : reason === R.PARTICIPANT_REMOVED ? 'You were removed from the channel'
        : 'Voice disconnected', 'ti-headset');
      render(); refreshSoon();
    }));
  }

  async function join(id) {
    const ch = info.channels.find(c => c.id === id);
    if (!ch || phase === 'joining' || (room && joined?.id === id)) return;
    if (room) await leave({ quiet: true });
    const seq = ++joinSeq;
    joined = { id: ch.id, name: ch.name };
    phase = 'joining';
    render();
    let r = null;
    try {
      const [lib, res] = await Promise.all([
        loadLib(),
        fetchTimeout('/api/voice/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: id }),
        }, 8000),
      ]);
      const t = await res.json().catch(() => ({}));
      if (!res.ok || !t.token) throw new Error(t.error || 'the server said no');
      if (seq !== joinSeq) return;
      LK = lib;
      r = new LK.Room({
        adaptiveStream: false, dynacast: false,
        audioCaptureDefaults: captureOpts(),
        audioOutput: S.output ? { deviceId: S.output } : undefined,
      });
      room = r;
      wire(r);
      await r.connect(t.url, t.token);
      if (seq !== joinSeq || room !== r) { r.disconnect(); return; }
      phase = 'live';
      r.startAudio().catch(() => {});
      needsClick = !r.canPlaybackAudio;
      applyVolumes();
      sfx('success');
      render();
      await publishMic();
      pushAttrs();
      refreshSoon();
    } catch (e) {
      if (seq !== joinSeq) return;
      if (r) { try { r.disconnect(); } catch (err) {} }
      reset();
      render();
      // LiveKit's own words for an unreachable server aren't worth reading.
      const why = String(e?.message || '');
      showToast("Couldn't join " + ch.name + ': ' + (!why || /signal|fetch|websocket|timed? ?out|abort/i.test(why)
        ? "the voice server isn't answering" : why), 'ti-headset', 6000);
    }
  }

  async function leave(opts) {
    joinSeq++;
    const r = room;
    if (!r && !joined) return;
    reset();
    if (!opts?.quiet) sfx('close');
    render();
    if (r) { try { await r.disconnect(); } catch (e) {} }
    refreshSoon();
  }

  // Some browsers hold remote audio until the page has been clicked.
  document.addEventListener('click', () => { if (room && needsClick) room.startAudio().catch(() => {}); }, true);

  // ── The panel ──
  function openPanel() {
    if (panelOpen() || btn.hidden) return;
    document.querySelectorAll('.hdr-more-menu.visible').forEach(m => m.classList.remove('visible'));
    anchorPanelUnder(panel, btn, 10);
    panel.classList.add('visible');
    btn.setAttribute('aria-expanded', 'true');
    refresh();
  }
  function closePanel() {
    if (!panelOpen()) return;
    panel.classList.remove('visible');
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    sfx('click');
    if (panelOpen()) closePanel(); else openPanel();
  });
  micBtn.addEventListener('click', toggleMute);
  window.addEventListener('resize', () => { if (panelOpen()) anchorPanelUnder(panel, btn, 10); });
  // Open until you click elsewhere. Its own right-click menus and dialogs
  // are part of it.
  document.addEventListener('pointerdown', e => {
    if (panelOpen() && !panel.contains(e.target) && !btn.contains(e.target) && !e.target.closest?.('.klab-menu, .add-app-backdrop')) closePanel();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panelOpen() && !document.querySelector('.add-app-backdrop.open, .klab-menu.visible')) closePanel();
  });

  const idOf = el => Number(el.closest('.vc-channel')?.dataset.id);
  listEl.addEventListener('click', e => {
    const row = e.target.closest('.vc-row');
    if (row) { join(idOf(row)); return; }
    const m = e.target.closest('.vc-member');
    if (!m) return;
    const u = m.dataset.u;
    // Someone in your channel: their volume. Anyone else: who they are.
    if (m.classList.contains('adjustable')) { volOpen = volOpen === u ? '' : u; sfx('browse'); render(); }
    else if (typeof openProfileView === 'function') openProfileView(u);
  });
  listEl.addEventListener('input', e => {
    const el = e.target.closest('.vc-vol');
    if (!el) return;
    S.vols[el.dataset.u] = Number(el.value);
    el.nextElementSibling.textContent = el.value + '%';
    applyVolumes();
  });
  listEl.addEventListener('change', e => { if (e.target.closest('.vc-vol')) { save(); render(); } });

  const api = (method, path, body) => fetchTimeout(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }, 8000).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'that didn’t work');
    return d;
  });
  const manage = async (work, done) => {
    try { await work(); if (done) showToast(done, 'ti-headset'); }
    catch (e) { sfx('error'); showToast(klabCap(String(e?.message || 'That didn’t work')), 'ti-alert-triangle'); }
    refresh();
  };

  listEl.addEventListener('contextmenu', e => {
    const m = e.target.closest('.vc-member');
    if (m) {
      const u = m.dataset.u, mine = u === me(), adjustable = m.classList.contains('adjustable');
      klabMenu(e, [
        { header: u },
        { label: 'View profile', icon: 'ti-user-circle', action: () => openProfileView(u), hidden: typeof openProfileView !== 'function' },
        { label: 'Message', icon: 'ti-message-2-plus', action: () => { closePanel(); messageUser(u); }, hidden: mine || typeof messageUser !== 'function' },
        '-',
        { label: vol(u) === 0 ? 'Unmute for me' : 'Mute for me', icon: vol(u) === 0 ? 'ti-volume' : 'ti-volume-off', hidden: !adjustable,
          action: () => { S.vols[u] = vol(u) === 0 ? 100 : 0; save(); applyVolumes(); render(); } },
      ]);
      return;
    }
    const row = e.target.closest('.vc-row');
    if (!row || !info.canManage) return;
    const c = info.channels.find(x => x.id === idOf(row));
    if (!c) return;
    klabMenu(e, [
      { header: c.name },
      { label: 'Rename', icon: 'ti-pencil', action: async () => {
        const name = await showInputDialog('// rename channel', '', 'Channel name', c.name, { maxLength: 32 });
        if (name && name !== c.name) manage(() => api('PATCH', '/api/voice/channels/' + c.id, { name }));
      } },
      { label: 'Delete', icon: 'ti-trash', warn: true, action: async () => {
        const n = membersOf(c).length;
        const ok = await showConfirmDialog('// delete channel', 'Delete "' + c.name + '"?' + (n ? ' ' + klabCount(n, 'person', 'people') + ' in it will be disconnected.' : ''), 'Delete');
        if (ok) manage(() => api('DELETE', '/api/voice/channels/' + c.id));
      } },
    ]);
  });

  $('vcAddBtn').addEventListener('click', async () => {
    sfx('click');
    const name = await showInputDialog('// new voice channel', 'Name the channel.', 'Channel name', '', { maxLength: 32 });
    if (name) manage(() => api('POST', '/api/voice/channels', { name }));
  });
  $('vcMute').addEventListener('click', toggleMute);
  $('vcDeafen').addEventListener('click', toggleDeafen);
  $('vcLeave').addEventListener('click', () => leave());
  $('vcSettingsBtn').addEventListener('click', () => {
    closePanel();
    openSettings();
    $('voiceSettings').scrollIntoView({ block: 'start' });
  });

  // ── Keys ──
  // Ctrl+Shift+M mutes and Ctrl+Shift+D deafens (Cmd on a Mac), anywhere
  // on the page, while you're in a channel.
  const typing = e => e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  window.addEventListener('keydown', e => {
    if (!room || !(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
    if (e.code !== 'KeyM' && e.code !== 'KeyD') return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    if (e.code === 'KeyM') toggleMute(); else toggleDeafen();
  }, true);

  // Push to talk: the microphone is live while the key is down, and for
  // a moment after so the end of a word isn't clipped. A page only sees
  // keys while it's the window you're in. A key that types a character
  // doesn't count while you're typing.
  let pttTimer = 0;
  const pttKey = e => S.mode === 'ptt' && S.pttCode && e.code === S.pttCode && !binding;
  window.addEventListener('keydown', e => {
    if (!room || !pttKey(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e) && e.key.length === 1) return;
    e.preventDefault(); e.stopPropagation();
    clearTimeout(pttTimer);
    if (!pttHeld) { pttHeld = true; applyMic(); }
  }, true);
  const pttUp = now => {
    if (!pttHeld) return;
    clearTimeout(pttTimer);
    const off = () => { pttHeld = false; applyMic(); };
    // A hidden page's timers run late (a second or more): never leave the
    // microphone waiting on one.
    if (now || document.hidden) off(); else pttTimer = setTimeout(off, 150);
  };
  window.addEventListener('keyup', e => { if (S.pttCode && e.code === S.pttCode) pttUp(); }, true);
  window.addEventListener('blur', () => pttUp(true));

  // ── Settings → Voice ──
  const settingsOpen = () => $('settingsBackdrop')?.classList.contains('open');
  let binding = false;

  async function fillDevices() {
    let devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
    // A browser only names devices once the microphone has been allowed.
    // "default" and "communications" are Windows' aliases for real ones.
    const real = kind => devs.filter(d => d.kind === kind && d.label && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const fill = (sel, list, current) => {
      sel.replaceChildren(new Option('System default', ''), ...list.map(d => new Option(d.label, d.deviceId)));
      sel.value = list.some(d => d.deviceId === current) ? current : '';
    };
    const ins = real('audioinput'), outs = real('audiooutput');
    fill($('vcInput'), ins, S.input);
    fill($('vcOutput'), outs, S.output);
    $('vcOutputRow').hidden = !outs.length || !('setSinkId' in HTMLMediaElement.prototype);
    $('vcInputSub').textContent = ins.length ? 'What you talk into' : 'Join a channel once and your microphones are listed here';
  }

  function syncSettings() {
    document.querySelectorAll('#vcMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.mode)));
    $('vcModeSub').textContent = S.mode === 'ptt'
      ? 'Your microphone is only on while you hold a key'
      : "Your microphone is on while you're in a channel";
    $('vcPttRow').hidden = S.mode !== 'ptt';
    $('vcPttKey').textContent = binding ? 'Press a key…' : S.pttCode ? S.pttLabel || S.pttCode : 'Set a key';
    $('vcNoiseToggle').classList.toggle('on', !!S.noise);
    $('vcEchoToggle').classList.toggle('on', !!S.echo);
    $('vcGainToggle').classList.toggle('on', !!S.gain);
  }

  // Settings opens through openSettings(), whoever calls it.
  const _openSettings = openSettings;
  openSettings = function() {
    _openSettings();
    if (!info.enabled) return;
    binding = false;
    syncSettings();
    fillDevices();
  };

  $('vcInput').addEventListener('change', e => {
    S.input = e.target.value; save();
    if (room) room.switchActiveDevice('audioinput', S.input || 'default').catch(() => showToast("Couldn't switch microphone", 'ti-microphone-off'));
  });
  $('vcOutput').addEventListener('change', e => {
    S.output = e.target.value; save();
    if (room) room.switchActiveDevice('audiooutput', S.output || 'default').catch(() => showToast("Couldn't switch speakers", 'ti-volume-off'));
  });
  $('vcMode').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    sfx('click');
    S.mode = b.dataset.v; save();
    pttHeld = false;
    applyMic(); syncSettings(); render();
  });

  // The next key pressed becomes the push-to-talk key; Escape backs out.
  $('vcPttKey').addEventListener('click', () => { sfx('click'); binding = !binding; syncSettings(); });
  window.addEventListener('keydown', e => {
    if (!binding) return;
    // Settings closed while it was waiting: stop waiting, and let this key
    // through (it was swallowed and became the push-to-talk key).
    if (!document.querySelector('.settings-backdrop.open')) { binding = false; syncSettings(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key !== 'Escape') {
      if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code) && e.repeat) return;
      S.pttCode = e.code;
      S.pttLabel = e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : e.code.replace(/^Key|^Digit/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
      save();
    }
    binding = false;
    syncSettings(); render();
  }, true);

  // The processing switches restart the microphone with the new setting.
  // Ahead of the generic .s-toggle handler, like the app's own switches.
  [['vcNoiseToggle', 'noise'], ['vcEchoToggle', 'echo'], ['vcGainToggle', 'gain']].forEach(([id, key]) => {
    $(id).addEventListener('click', e => {
      e.stopImmediatePropagation();
      sfx('click');
      S[key] = !S[key]; save();
      syncSettings();
      const track = micPub()?.audioTrack;
      if (track) track.restartTrack(captureOpts()).then(applyMic).catch(() => {});
    }, true);
  });

  window.addEventListener('klab:people', () => { lastList = null; render(); });

  // For the desktop apps (a tray item, a global mute key) and the console.
  window.klabVoice = {
    join, leave, toggleMute, toggleDeafen, refresh,
    state: () => ({
      enabled: !!info.enabled, phase, channel: joined && { ...joined }, muted: showMuted(), deafened, micProblem,
      micLive: !!micPub() && !micPub().isMuted, // what's going out right now (push to talk: only while held)
      speaking: [...speaking], members: room && phase !== 'joining' ? liveMembers() : [],
    }),
  };

  refresh();
})();
