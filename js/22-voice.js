// ══════════════════════════════════════════
//  VOICE — drop-in channels, like Mumble's or Discord's
//  The channels and who's in them are a group in Social's sidebar
//  (#socVoice); click one and you're in. While you're in one, the voice
//  panel (#voiceNow) is at the sidebar's foot on every page: where you
//  are, and mute, deafen, share screen and disconnect (in the header,
//  compact, with the sidebar hidden). The audio goes straight between browsers and
//  a LiveKit server on the homelab (WebRTC); klabnet-api only keeps the
//  channel names, says who's where, and signs the token that lets you
//  into a room (routers/voice.py).
//
//  The whole feature stays hidden until GET /api/voice says it's set up,
//  and LiveKit's client (600KB) is only fetched the first time you join.
//  You stay in the channel across tabs; reloading the page leaves it.
//
//  Screen sharing: "Share screen" beside mute and deafen; whoever's in
//  the channel watches on the stage (a viewer over the window). Screens
//  are only subscribed while someone here is watching.
//
//  Per device, in localStorage (klabnet_voice): microphone, speakers, open
//  mic or push to talk and its key, the processing switches, and how loud
//  you've made each person. Settings → Voice edits them.
// ══════════════════════════════════════════
(function() {
  const group = document.getElementById('socVoice');
  const micBtn = document.getElementById('voiceMicBtn');
  const panel = document.getElementById('voiceNow');
  if (!group || !micBtn || !panel) return;
  const $ = id => document.getElementById(id);
  const listEl = $('vcChannels');
  // The shortcuts, as this computer writes them.
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const keyHint = k => MAC ? '⌘⇧' + k : 'Ctrl+Shift+' + k;
  let quality = '';         // LiveKit's word for your connection: excellent | good | poor | lost
  const LIB = 'js/vendor/livekit-client.umd.js?v=2.22.3';

  // ── What this device remembers ──
  const STORE_KEY = 'klabnet_voice';
  // shareMode/shareAudio/shareVol: how you last shared your screen, and
  // how loud shared screens play here (apart from people's voices).
  const S = { input: '', output: '', mode: 'open', pttCode: '', pttLabel: '', noise: true, echo: true, gain: true, vols: {},
    shareMode: 'smooth', shareAudio: true, shareVol: 100, shareSurface: 'monitor', sharePreview: false };
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
  const typing = e => e.composedPath()[0]?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
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

  // fetchTimeout's clock stops when the headers arrive: a body that stalls
  // mid-way would leave r.json() waiting forever (and with it `polling`,
  // so the list never refreshed again, or a join stuck on Joining…).
  const jsonBy = (r, ms) => Promise.race([r.json(), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms || 8000))]);

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
        const d = await jsonBy(r, 6000);
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
    pollTimer = setTimeout(refresh, !info.enabled ? 120000 : panelOpen() ? 4000 : room ? 12000 : 30000);
  }
  const refreshSoon = () => { clearTimeout(pollTimer); pollTimer = setTimeout(refresh, 600); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // ── Members ──
  // In your own channel the room itself says who's there, as it happens;
  // every other channel is what the API last said.
  const flag = (p, k) => (p.attributes || {})[k] === '1';
  function liveMembers() {
    const out = [{ username: me(), muted: showMuted(), deafened, sharing: sharingNow(), me: true }];
    room.remoteParticipants.forEach(p => out.push({
      username: p.identity,
      muted: flag(p, 'mute') || !p.getTrackPublication(LK.Track.Source.Microphone),
      deafened: flag(p, 'deaf'),
      sharing: !!p.getTrackPublication(LK.Track.Source.ScreenShare),
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
  // Polled faster while you can see it.
  // Actually on screen: the channels show on Chat only now, and Social's
  // other pages polled every 4s for a list nobody could see.
  const panelOpen = () => !group.hidden && !!group.offsetParent;

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
      // Sharing: someone in your channel is one press from watching;
      // anyone else's channel you'd have to join first.
      (!m.sharing ? '' : m.live
        ? '<button type="button" class="vc-watch" data-u="' + esc(u) + '" title="Watch ' + esc(u) + '’s screen" aria-label="Watch ' + esc(u) + '’s screen"><i class="ti ti-screen-share"></i></button>'
        : '<i class="ti ti-screen-share vc-sharing" title="' + (m.me ? 'You’re sharing your screen' : 'Sharing their screen · join to watch') + '"></i>') +
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
    panel.classList.toggle('speaking', !!room && speaking.has(me()) && !showMuted());
  }

  function render() {
    const on = !!info.enabled;
    group.hidden = !on && !room;
    $('voiceSettings').hidden = !on;
    if (group.hidden) { panel.classList.add('tucked'); return; }

    // The group's label counts who's in voice; while you're in a channel
    // the header has a mute button, wherever you are.
    const inRoom = !!room && phase !== 'joining';
    const total = info.channels.reduce((n, c) => n + membersOf(c).length, 0);
    const count = $('socVoiceCount');
    count.hidden = !total;
    count.textContent = String(total);
    // The panel grows in and out (the CSS) rather than appearing; what it
    // says stays while it shrinks away.
    panel.classList.toggle('tucked', !joined);
    paintPanel();

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

    const others = inRoom ? sharers().filter(x => !x.me) : [];
    $('vcWatchBtn').hidden = !others.length;
    if (others.length) {
      $('vcWatchLabel').textContent = others.length === 1 ? others[0].username + ' is sharing' : others.length + ' screens shared';
      $('vcWatchBtn').title = 'Watch (' + (others.length === 1 ? others[0].username + '’s screen' : 'all of them') + ')';
    }
    paintSpeaking();
    if (stage.open || stage.away) paintStage();
    paintPill();
  }

  // ── The voice panel: where you are, and the controls ──
  // At the sidebar's foot on every page while you're in a channel (or
  // joining one): "Voice connected" (coloured by how good the connection
  // is) over the channel's name, which takes you to it in Social, then
  // mute, deafen, share screen and disconnect. In the header (sidebar
  // hidden, or the tabs on top) it's the mic, disconnect and a menu.
  const QUALITY = { excellent: 'Excellent', good: 'Good', poor: 'Weak', lost: 'Lost' };
  function paintPanel() {
    if (!joined) return;
    const [head, sub, tone] =
      phase === 'joining' ? ['Joining…', joined.name, 'wait']
      : phase === 'reconnecting' ? ['Reconnecting…', joined.name, 'warn']
      : needsClick ? ['Click to hear everyone', joined.name, 'warn']
      : micProblem === 'blocked' ? ['Listening only', 'Your microphone is blocked', 'warn']
      : micProblem === 'missing' ? ['Listening only', 'No microphone found', 'warn']
      : quality === 'lost' ? ['Connection lost', joined.name, 'bad']
      : quality === 'poor' ? ['Weak connection', joined.name, 'warn']
      : joined.call ? ['In a call', 'with ' + joined.with + (S.mode === 'ptt' ? ' · push to talk' : ''), 'ok']
      : ['Voice connected', joined.name + (S.mode === 'ptt' ? ' · push to talk' : ''), 'ok'];
    panel.dataset.tone = tone;
    $('vcStatusHead').textContent = head;
    $('voiceNowLabel').textContent = sub;
    const info = $('vcNowInfo');
    info.title = (joined.call ? 'The call with ' : 'Open ') + joined.name + (QUALITY[quality] && phase === 'live' ? ' · connection ' + QUALITY[quality].toLowerCase() : '');
    info.setAttribute('aria-label', head + ', ' + sub + '. Open the channel');
    const m = showMuted();
    micBtn.classList.toggle('muted', m);
    micBtn.setAttribute('aria-pressed', String(m));
    micBtn.title = (micProblem ? 'Microphone unavailable: try again' : m ? 'Unmute' : 'Mute') + ' (' + keyHint('M') + ')';
    micBtn.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
    micBtn.querySelector('i').className = m ? 'ti ti-microphone-off' : 'ti ti-microphone';
    const deaf = $('vcDeafen');
    deaf.classList.toggle('muted', deafened);
    deaf.setAttribute('aria-pressed', String(deafened));
    deaf.title = (deafened ? 'Undeafen' : 'Deafen') + ' (' + keyHint('D') + ')';
    deaf.setAttribute('aria-label', deafened ? 'Undeafen' : 'Deafen');
    deaf.querySelector('i').className = deafened ? 'ti ti-headphones-off' : 'ti ti-headphones';
    micBtn.disabled = deaf.disabled = phase === 'joining';
    const leaveBtn = $('vcLeave');
    leaveBtn.title = joined.call ? 'Hang up' : 'Disconnect';
    leaveBtn.setAttribute('aria-label', leaveBtn.title);
    // Sharing: lit while you are (it's live: the accent, not mute's red).
    const shareBtn = $('vcShare'), on = sharingNow();
    shareBtn.hidden = !canShare();
    shareBtn.setAttribute('aria-pressed', String(on));
    shareBtn.title = on ? 'Stop sharing' : shareBusy ? 'Starting…' : 'Share your screen';
    shareBtn.setAttribute('aria-label', shareBtn.title);
    shareBtn.querySelector('i').className = on ? 'ti ti-screen-share-off' : 'ti ti-screen-share';
    shareBtn.disabled = phase !== 'live' || shareBusy;
    panel.classList.toggle('sharing', on);
  }

  // Your channel in Social's sidebar (Chat shows the voice group).
  function showChannel() {
    if (!joined) return;
    if (joined.call) { window.klabCalls?.show?.(); return; }
    sfx('nav');
    if (typeof setActiveTab === 'function') setActiveTab('chat');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = listEl.querySelector('.vc-channel.joined') || group;
      row.scrollIntoView({ block: 'nearest', behavior: window.klabMotionOk?.() ? 'smooth' : 'auto' });
      row.querySelector('.vc-row')?.focus({ preventScroll: true });
    }));
  }

  // Everything the panel does, as a menu: right-click on it anywhere, and
  // the header's ⌄ (where deafen and share don't fit).
  function panelItems(anchor) {
    const live = phase === 'live', m = showMuted();
    const others = live ? sharers().filter(x => !x.me) : [];
    return [
      { header: joined ? joined.name : 'Voice' },
      { label: m ? 'Unmute' : 'Mute', icon: m ? 'ti-microphone' : 'ti-microphone-off', hint: keyHint('M'), disabled: !live, action: toggleMute },
      { label: deafened ? 'Undeafen' : 'Deafen', icon: deafened ? 'ti-headphones' : 'ti-headphones-off', hint: keyHint('D'), disabled: !live, action: toggleDeafen },
      { label: sharingNow() ? 'Stop sharing' : 'Share your screen…', icon: sharingNow() ? 'ti-screen-share-off' : 'ti-screen-share',
        hidden: !canShare(), disabled: !live || shareBusy,
        action: () => sharingNow() ? stopShare() : setTimeout(() => shareMenu(!$('vcShare').offsetParent ? anchor : $('vcShare')), 0) },
      { label: others.length === 1 ? 'Watch ' + others[0].username + '’s screen' : 'Watch shared screens', icon: 'ti-eye', hidden: !others.length,
        action: () => openStage(others.length === 1 ? others[0].username : '') },
      '-',
      { label: joined?.call ? 'Show the call' : 'Open channel', icon: joined?.call ? 'ti-phone' : 'ti-volume', action: showChannel },
      { label: 'Dialer', icon: 'ti-dialpad', hidden: !window.klabCalls?.enabled?.(), action: () => window.klabCalls.openDialer() },
      { label: 'Voice settings', icon: 'ti-settings', action: openVoiceSettings },
      '-',
      { label: joined?.call ? 'Hang up' : 'Disconnect', icon: 'ti-phone-off', danger: true, action: () => leave() },
    ];
  }
  panel.addEventListener('contextmenu', e => {
    if (!joined) return;
    klabMenu(e, panelItems(e.target.closest('button') || panel));
  });
  $('vcMore').addEventListener('click', e => { sfx('click'); klabMenu.at(e.currentTarget, panelItems(e.currentTarget), { align: 'end' }); });
  $('vcNowInfo').addEventListener('click', showChannel);

  // ── The microphone ──
  // Changes are applied one after another: push to talk can ask for
  // "on, off, on" faster than a mute round trip takes. Going quiet cuts
  // the microphone at the source first, there and then, so nothing that
  // goes wrong afterwards (a mute that fails, a slow connection) can leave
  // it open; a change that fails is tried again.
  let micChain = Promise.resolve(), micRetries = 0;
  // The track while it's being published: LiveKit has no publication for
  // it until the round trip's done, and a mute (or a push-to-talk key let
  // go) in that moment found nothing to cut and left it live.
  let pendingMic = null;
  const rawMic = () => micPub()?.track?.mediaStreamTrack || pendingMic?.mediaStreamTrack || null;
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
      const track = pendingMic = await LK.createLocalAudioTrack(captureOpts());
      if (room !== r) { track.stop(); return; }
      // Published already muted when it should be (push to talk, or you
      // muted before joining), so not even a syllable goes out first.
      if (!wantLive()) await track.mute();
      await r.localParticipant.publishTrack(track, { source: LK.Track.Source.Microphone });
      // Left while it was publishing: let go of the microphone itself.
      if (room !== r) { track.stop(); return; }
      micProblem = '';
      // Whatever was pressed meanwhile, now that there's a publication to apply it to.
      applyMic();
    } catch (e) {
      // The microphone was opened but never went out: close it again.
      pendingMic?.stop();
      if (room !== r) return;
      micProblem = /NotFound|Overconstrained|DevicesNotFound/i.test(e?.name || '') ? 'missing' : 'blocked';
      showToast(micProblem === 'missing'
        ? 'No microphone found. You can still listen'
        : 'Your microphone is blocked. You can still listen; allow it for klabnet to talk', 'ti-microphone-off', 6000);
    }
    finally { pendingMic = null; }
    pushAttrs();
    render();
  }

  // Muted and deafened, as everyone else sees them. The API reads these
  // for people outside the channel too.
  function pushAttrs() {
    if (!room || phase === 'joining') return;
    // watch: whose screens you're watching right now (comma separated), so
    // a sharer sees who's watching.
    const attrs = { mute: showMuted() ? '1' : '', deaf: deafened ? '1' : '', share: sharingNow() ? '1' : '', watch: watchedNow().join(',') };
    const key = [attrs.mute, attrs.deaf, attrs.share, attrs.watch].join('|');
    if (key === lastAttrs) return;
    lastAttrs = key;
    room.localParticipant.setAttributes(attrs).catch(() => { lastAttrs = ''; });
  }

  function applyVolumes() {
    if (!room) return;
    room.remoteParticipants.forEach(p => {
      try { p.setVolume(deafened ? 0 : vol(p.identity) / 100); } catch (e) {}
      try { p.setVolume(deafened ? 0 : shareVol() / 100, LK.Track.Source.ScreenShareAudio); } catch (e) {}
    });
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

  // ── Sharing your screen ──
  // Beside mute and deafen while you're in a channel. Two ways to send it,
  // picked from the button's menu (and remembered):
  //   Smooth (60fps): 1080p at 60, 10 Mbps, the encoder keeps the frame
  //     rate when the link tightens (games, video).
  //   Sharp (text): up to 1440p at 30, 8 Mbps, it keeps the resolution
  //     (code, documents).
  // One layer, no simulcast: a screen is watched full size or not at all.
  // Smooth goes out as VP9 where the browser has it (LiveKit sends a VP8
  // copy for anyone who can't decode it), else H.264. Sharp is H.264:
  // LiveKit turns a VP9 screen's content hint back to "motion".
  // The desktop apps: Electron only answers getDisplayMedia when the app
  // has set a display-media handler. klabnetDesktop.pickScreen(), where
  // there is one, shows the app's own picker and arms that handler for
  // the next request (null: cancelled). See CLAUDE.md, Voice.
  let shareBusy = false;
  let shareWho = new Set();   // who's sharing, so starting is announced once
  const shareVol = () => { const v = Number(S.shareVol); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100; };
  const myShare = () => room && LK ? room.localParticipant.getTrackPublication(LK.Track.Source.ScreenShare) : null;
  const sharingNow = () => !!myShare()?.track;
  const canShare = () => !!(window.klabnetDesktop?.pickScreen || navigator.mediaDevices?.getDisplayMedia);
  const MODES = {
    smooth: { res: { width: 1920, height: 1080, frameRate: 60 }, hint: 'motion', bitrate: 10_000_000, fps: 60, keep: 'maintain-framerate' },
    sharp: { res: { width: 2560, height: 1440, frameRate: 30 }, hint: 'detail', bitrate: 8_000_000, fps: 30, keep: 'maintain-resolution' },
    auto: { res: { width: 1920, height: 1080, frameRate: 30 }, hint: '', bitrate: 6_000_000, fps: 30, keep: 'balanced' },
  };
  const MODE_NAMES = { smooth: 'Smooth (60fps)', sharp: 'Sharp (text)', auto: 'Auto' };
  const SURFACES = { monitor: 'A whole screen', window: 'A window', browser: 'A browser tab' };

  async function startShare(mode) {
    if (!room || phase !== 'live' || shareBusy || sharingNow()) return;
    const r = room;
    S.shareMode = MODES[mode] ? mode : S.shareMode in MODES ? S.shareMode : 'smooth'; save();
    const m2 = MODES[S.shareMode];
    shareBusy = true; render();
    try {
      const desk = window.klabnetDesktop;
      if (desk?.pickScreen) {
        const pick = await desk.pickScreen({ audio: !!S.shareAudio });
        if (!pick || room !== r) return;
      }
      const m = m2;
      const vp9 = S.shareMode !== 'sharp' && (LK.supportsVP9 ? LK.supportsVP9() : false);
      await r.localParticipant.setScreenShareEnabled(true, {
        audio: !!S.shareAudio, systemAudio: S.shareAudio ? 'include' : 'exclude',
        // What the browser's picker opens on (it still offers the others).
        video: { displaySurface: S.shareSurface in SURFACES ? S.shareSurface : 'monitor' },
        selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
        resolution: m.res, contentHint: m.hint || undefined,
      }, {
        videoCodec: vp9 ? 'vp9' : 'h264',
        screenShareEncoding: { maxBitrate: m.bitrate, maxFramerate: m.fps, priority: 'high' },
        simulcast: false,
        degradationPreference: m.keep,
        // The screen's own sound is music and games, not speech.
        audioPreset: LK.AudioPresets?.musicHighQualityStereo, dtx: false, red: false, forceStereo: true,
      });
      if (room !== r) {
        // Left (or switched) while the picker was open: the capture it just
        // started must not keep running with nowhere to go.
        [LK.Track.Source.ScreenShare, LK.Track.Source.ScreenShareAudio].forEach(src => {
          try { r.localParticipant.getTrackPublication(src)?.track?.stop(); } catch (e) {}
        });
        return;
      }
      sfx('success');
      showToast('Sharing your screen · ' + MODE_NAMES[S.shareMode].toLowerCase(), 'ti-screen-share');
    } catch (e) {
      if (room !== r) return;
      const n = e?.name || '';
      // Cancelled in the picker: nothing to say.
      if (/NotAllowed|Abort/i.test(n) && !/system|permission denied by system/i.test(e?.message || '')) return;
      sfx('error');
      showToast(window.klabnetDesktop && !window.klabnetDesktop.pickScreen && /NotSupported|NotFound/i.test(n)
        ? 'Screen sharing needs a newer klabnet app'
        : /NotAllowed/i.test(n) ? 'Screen sharing is blocked. Allow it for klabnet in your system settings'
        : "Couldn't share your screen", 'ti-screen-share-off', 6000);
    } finally {
      shareBusy = false;
      pushAttrs(); render();
    }
  }
  async function stopShare() {
    if (!room || !myShare()) return;
    try { await room.localParticipant.setScreenShareEnabled(false); } catch (e) {}
    pushAttrs(); render();
  }
  // The share button's menu: Start sharing up top (with what it'll be),
  // then the choices, which keep the menu open (it opens again).
  function shareMenu(anchor) {
    if (sharingNow()) { stopShare(); return; }
    sfx('click');
    const again = fn => () => { fn(); save(); setTimeout(() => shareMenu(anchor), 0); };
    const mode = S.shareMode in MODES ? S.shareMode : 'smooth';
    const surface = S.shareSurface in SURFACES ? S.shareSurface : 'monitor';
    klabMenu.at(anchor, [
      { label: 'Start sharing', icon: 'ti-screen-share', hint: MODE_NAMES[mode].replace(/ \(.*\)/, '') + (S.shareAudio ? ' · sound' : ''), action: () => startShare(mode) },
      '-',
      { section: 'Quality' },
      { label: 'Smooth (60fps)', icon: 'ti-player-play', hint: 'Games, video', checked: mode === 'smooth', action: again(() => { S.shareMode = 'smooth'; }) },
      { label: 'Sharp (text)', icon: 'ti-code', hint: 'Code, documents', checked: mode === 'sharp', action: again(() => { S.shareMode = 'sharp'; }) },
      { label: 'Auto', icon: 'ti-sparkles', hint: '30fps, lighter', checked: mode === 'auto', action: again(() => { S.shareMode = 'auto'; }) },
      { section: 'Pick from' },
      ...Object.entries(SURFACES).map(([k, label]) => ({ label, icon: k === 'monitor' ? 'ti-device-desktop' : k === 'window' ? 'ti-app-window' : 'ti-world',
        checked: surface === k, action: again(() => { S.shareSurface = k; }) })),
      '-',
      { label: 'Share its sound', icon: S.shareAudio ? 'ti-volume' : 'ti-volume-off', hint: S.shareAudio ? 'On' : 'Off',
        action: again(() => { S.shareAudio = !S.shareAudio; }) },
    ], { align: 'end' });
  }
  $('vcShare').addEventListener('click', e => shareMenu(e.currentTarget));

  // Someone in your channel started sharing: said once, with a way in.
  function announceShare(p, pub) {
    if (pub.source !== LK.Track.Source.ScreenShare || shareWho.has(p.identity)) return;
    shareWho.add(p.identity);
    if (stage.open) { paintStage(); return; }
    // Do not disturb: no sound (the toast still says so: you're in the call).
    if ((typeof klabStatus === 'function' ? klabStatus() : '') !== 'dnd') sfx('notify');
    showToast(p.identity + ' is sharing their screen', 'ti-screen-share', { action: { label: 'Watch', run: () => openStage(p.identity) } });
  }

  // ── Watching: the stage ──
  // Everyone in the channel can watch every shared screen. The stage is a
  // viewer over the window: the screen large with the sharer's name, more
  // than one as tiles (press one to put it up large; the rest pause), full
  // screen, pop out (the browser's picture in picture) and the screens'
  // own volume. Screens are subscribed only while it's open, or while one
  // is popped out, and let go of when it closes.
  const stage = { open: false, away: false, focus: '', el: null, pop: null, tiles: new Map() };
  stage.el = document.createElement('div');
  stage.el.className = 'vs-stage';
  stage.el.id = 'voiceStage';
  stage.el.hidden = true;
  stage.el.setAttribute('role', 'dialog');
  stage.el.setAttribute('aria-label', 'Shared screens');
  stage.el.innerHTML =
    '<div class="vs-bar">' +
      '<div class="vs-title"><i class="ti ti-screen-share"></i><b class="vs-who"></b><span class="vs-sub"></span><span class="vs-q" title="What’s arriving here"></span></div>' +
      '<div class="vs-tools">' +
        '<label class="vs-vol" title="The screens’ sound (not voices)"><i class="ti ti-volume"></i><input type="range" min="0" max="100" step="1" aria-label="Screen sound volume" /></label>' +
        '<button type="button" class="k-icon on-media" data-vs="all" title="All screens"><i class="ti ti-layout-grid"></i></button>' +
        '<button type="button" class="k-icon on-media" data-vs="pip" title="Pop out (p)"><i class="ti ti-picture-in-picture"></i></button>' +
        '<button type="button" class="k-icon on-media" data-vs="full" title="Full screen (f)"><i class="ti ti-arrows-maximize"></i></button>' +
        '<button type="button" class="k-btn sm danger" data-vs="stop"><i class="ti ti-screen-share-off"></i><span>Stop sharing</span></button>' +
        '<button type="button" class="k-icon on-media" data-vs="close" title="Close (Esc)" aria-label="Close"><i class="ti ti-x"></i></button>' +
      '</div>' +
    '</div>' +
    '<div class="vs-tiles"></div>' +
    '<div class="vs-empty" hidden><i class="ti ti-screen-share-off"></i><div>Nobody’s sharing right now.</div></div>';
  document.body.appendChild(stage.el);
  const tilesEl = stage.el.querySelector('.vs-tiles'), volIn = stage.el.querySelector('.vs-vol input');
  const watching = () => stage.open || stage.away;

  // Everyone sharing in your channel, you first.
  function sharers() {
    if (!room || !LK || phase === 'joining') return [];
    const out = [];
    const mine = myShare();
    if (mine?.track) out.push({ username: me(), me: true, pub: mine, audio: null });
    room.remoteParticipants.forEach(p => {
      const pub = p.getTrackPublication(LK.Track.Source.ScreenShare);
      if (pub) out.push({ username: p.identity, me: false, pub, audio: p.getTrackPublication(LK.Track.Source.ScreenShareAudio) || null, p });
    });
    return out;
  }

  // What's subscribed: every microphone; screens and their sound only while
  // watching, and of those only the one up large plays when one is.
  function syncSubs() {
    if (!room || !LK) return;
    const Src = LK.Track.Source;
    const shown = new Set(sharers().map(x => x.username));
    room.remoteParticipants.forEach(p => p.trackPublications.forEach(pub => {
      const screen = pub.source === Src.ScreenShare || pub.source === Src.ScreenShareAudio;
      const want = pub.source === Src.Microphone || (screen && watching());
      if (pub.isDesired !== want) { try { pub.setSubscribed(want); } catch (e) {} }
      if (want && pub.source === Src.ScreenShare && pub.isSubscribed) {
        try { pub.setEnabled(playing(p.identity, shown)); } catch (e) {}
      }
    }));
    pushAttrs();
    paintStage();
  }
  // Up large, or one of an even grid: playing. In the strip: paused.
  const playing = (u, shown) => !stage.focus || stage.focus === u || !shown.has(stage.focus);
  function watchedNow() {
    if (!watching() || !room) return [];
    const list = sharers().filter(x => !x.me), shown = new Set(sharers().map(x => x.username));
    return list.filter(x => playing(x.username, shown)).map(x => x.username);
  }
  // Who's watching someone's screen (from everyone's `watch` attribute).
  function viewersOf(u) {
    if (!room) return [];
    const out = [];
    room.remoteParticipants.forEach(p => {
      if (p.identity !== u && String((p.attributes || {}).watch || '').split(',').includes(u)) out.push(p.identity);
    });
    if (u !== me() && watchedNow().includes(u)) out.unshift(me());
    return out;
  }
  const facesHTML = (list, max) => list.slice(0, max || 4).map(u => {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="vs-face" title="' + esc(u) + '">' + (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }).join('');

  function tileFor(x) {
    let t = stage.tiles.get(x.username);
    if (!t) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'vs-tile';
      el.dataset.u = x.username;
      el.innerHTML = '<video playsinline autoplay muted></video><span class="vs-tile-wait">Loading…</span>' +
        '<span class="vs-name"><span class="vs-name-t"></span><i class="ti ti-volume" hidden></i></span>' +
        '<span class="vs-viewers" hidden></span>';
      t = { el, video: el.querySelector('video'), track: null };
      el.querySelector('.vs-name-t').textContent = x.me ? 'Your screen' : x.username;
      el.querySelector('.vs-name-t').style.color = x.me ? '' : (typeof profileColor === 'function' ? profileColor(x.username) : '');
      stage.tiles.set(x.username, t);
      tilesEl.appendChild(el);
    }
    return t;
  }

  function paintStage() {
    if (!stage.open && !stage.away) return;
    const list = sharers();
    const names = new Set(list.map(x => x.username));
    // Gone: let go of the picture.
    for (const [u, t] of stage.tiles) {
      if (names.has(u)) continue;
      try { t.track?.detach(t.video); } catch (e) {}
      if (document.pictureInPictureElement === t.video) document.exitPictureInPicture().catch(() => {});
      t.el.remove();
      stage.tiles.delete(u);
    }
    if (stage.focus && !names.has(stage.focus)) stage.focus = '';
    const solo = list.length === 1;
    for (const x of list) {
      const t = tileFor(x);
      const track = x.pub.track || null;
      if (track !== t.track) {
        try { t.track?.detach(t.video); } catch (e) {}
        t.track = track;
        if (track) track.attach(t.video);
      }
      const big = solo || stage.focus === x.username;
      // Your own screen costs nothing to show, so it never pauses.
      const paused = !solo && !!stage.focus && !big && !x.me;
      t.el.classList.toggle('big', big);
      t.el.classList.toggle('paused', paused);
      t.el.classList.toggle('ready', !!track);
      t.el.title = big ? '' : paused ? 'Watch ' + (x.me ? 'your screen' : x.username + '’s screen') : 'Put up large';
      t.el.querySelector('.vs-tile-wait').textContent = paused ? 'Paused' : 'Loading…';
      t.el.querySelector('.vs-name i').hidden = !x.audio;
      // Who's watching it, under the sharer's name (their faces).
      const vw = viewersOf(x.username), vEl = t.el.querySelector('.vs-viewers');
      const vKey = vw.join(',');
      if (vEl.dataset.k !== vKey) {
        vEl.dataset.k = vKey;
        vEl.hidden = !vw.length;
        vEl.innerHTML = vw.length ? '<span class="vs-viewers-t">Watching</span>' + facesHTML(vw) + (vw.length > 4 ? '<span class="vs-viewers-n">+' + (vw.length - 4) + '</span>' : '') : '';
        vEl.title = vw.length ? 'Watching: ' + vw.join(', ') : '';
      }
      t.el.setAttribute('aria-pressed', String(big && !solo));
    }
    // Large one first, then the rest along the bottom.
    const order = [...list].sort((a, b) => (b.username === stage.focus) - (a.username === stage.focus));
    order.forEach((x, i) => { stage.tiles.get(x.username).el.style.order = String(i); });
    const n = list.length, cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    tilesEl.dataset.mode = solo ? 'solo' : stage.focus ? 'focus' : 'grid';
    tilesEl.style.setProperty('--cols', String(cols));
    tilesEl.style.setProperty('--rows', String(Math.max(1, Math.ceil(n / cols))));
    tilesEl.hidden = !n;
    stage.el.querySelector('.vs-empty').hidden = !!n;

    const lead = list.find(x => x.username === stage.focus) || (solo ? list[0] : null);
    stage.el.querySelector('.vs-who').textContent = lead ? (lead.me ? 'Your screen' : lead.username + '’s screen') : n ? n + ' screens' : 'Screen share';
    stage.el.querySelector('.vs-sub').textContent = joined ? joined.name : '';
    // The volume is for screens' own sound: shown when any has some.
    const vol = stage.el.querySelector('.vs-vol');
    vol.hidden = !list.some(x => x.audio);
    if (document.activeElement !== volIn) volIn.value = String(shareVol());
    vol.querySelector('i').className = 'ti ' + (shareVol() === 0 || deafened ? 'ti-volume-off' : 'ti-volume');
    stage.el.querySelector('[data-vs="all"]').hidden = !stage.focus || n < 2;
    stage.el.querySelector('[data-vs="pip"]').hidden = !document.pictureInPictureEnabled || !(lead || solo);
    stage.el.querySelector('[data-vs="stop"]').hidden = !sharingNow();
    const full = document.fullscreenElement === stage.el;
    const fb = stage.el.querySelector('[data-vs="full"]');
    fb.querySelector('i').className = 'ti ' + (full ? 'ti-arrows-minimize' : 'ti-arrows-maximize');
    fb.title = (full ? 'Exit full screen' : 'Full screen') + ' (f)';
  }

  function openStage(focus) {
    if (!room || phase === 'joining') return;
    if (typeof focus === 'string' && focus) stage.focus = focus;
    if (stage.away) { stage.away = false; stage.el.classList.remove('away'); }
    if (!stage.open) {
      stage.open = true;
      stage.el.hidden = false;
      sfx('open');
      stage.pop = window.klabLayers?.push(stage.el, { kind: 'viewer', dim: true, close: () => closeStage() }) || null;
      requestAnimationFrame(() => stage.el.classList.add('open'));
    }
    syncSubs();
    paintPill();
    paintQuality();
    stage.el.querySelector('[data-vs="close"]').focus({ preventScroll: true });
  }

  // Closing with a screen popped out keeps that one going (and subscribed)
  // until the pop-out closes too. `hard`: you left the channel.
  function closeStage(hard) {
    if (!stage.open && !stage.away) return;
    if (document.fullscreenElement === stage.el) document.exitFullscreen().catch(() => {});
    const pip = document.pictureInPictureElement;
    const popped = !hard && pip && stage.el.contains(pip);
    if (stage.open) {
      stage.open = false;
      stage.pop?.(); stage.pop = null;
      stage.el.classList.remove('open');
      if (!hard) sfx('close');
    }
    if (popped) { stage.away = true; stage.el.classList.add('away'); paintPill(); return; }
    if (pip && stage.el.contains(pip)) document.exitPictureInPicture().catch(() => {});
    stage.away = false;
    stage.el.classList.remove('away');
    stage.el.hidden = true;
    stage.focus = '';
    for (const t of stage.tiles.values()) { try { t.track?.detach(t.video); } catch (e) {} t.el.remove(); }
    stage.tiles.clear();
    syncSubs();
    paintPill();
  }

  // The one to act on: the one up large, or the only one.
  const leadTile = () => {
    const list = sharers();
    const u = stage.focus || (list.length === 1 ? list[0].username : '');
    return u ? stage.tiles.get(u) : null;
  };
  function popOut() {
    const t = leadTile() || [...stage.tiles.values()][0];
    if (!t || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement === t.video) { document.exitPictureInPicture().catch(() => {}); return; }
    t.video.requestPictureInPicture().then(() => {
      sfx('click');
      // Out of the window: the page is free again.
      if (stage.open) closeStage();
    }).catch(() => showToast("Couldn't pop it out", 'ti-picture-in-picture'));
  }
  function toggleFull() {
    if (document.fullscreenElement === stage.el) document.exitFullscreen().catch(() => {});
    else stage.el.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => { if (stage.open) paintStage(); });
  // The pop-out closed: back onto the stage if the stage was put away for
  // it (the browser's "back to tab"), or let go.
  document.addEventListener('leavepictureinpicture', e => {
    if (!stage.away || !stage.el.contains(e.target)) return;
    setTimeout(() => { if (stage.away && !document.pictureInPictureElement) closeStage(); }, 0);
  }, true);

  stage.el.addEventListener('click', e => {
    const b = e.target.closest('[data-vs]');
    if (b) {
      const a = b.dataset.vs;
      if (a === 'close') closeStage();
      else if (a === 'full') toggleFull();
      else if (a === 'pip') popOut();
      else if (a === 'stop') stopShare();
      else if (a === 'all') { sfx('click'); stage.focus = ''; syncSubs(); }
      return;
    }
    const tile = e.target.closest('.vs-tile');
    if (tile && sharers().length > 1 && stage.focus !== tile.dataset.u) { sfx('click'); stage.focus = tile.dataset.u; syncSubs(); }
  });
  stage.el.addEventListener('dblclick', e => { if (e.target.closest('.vs-tile.big')) toggleFull(); });
  volIn.addEventListener('input', () => { S.shareVol = Number(volIn.value); applyVolumes(); paintStage(); });
  volIn.addEventListener('change', save);
  // Keys while the stage is on top: f, p, ←/→ between screens, 0 for all.
  window.addEventListener('keydown', e => {
    if (!stage.open || !window.klabLayers?.isTop(stage.el) || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    const list = sharers();
    let done = true;
    if (e.key === 'f') toggleFull();
    else if (e.key === 'p') popOut();
    else if (e.key === '0' && stage.focus) { stage.focus = ''; syncSubs(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && list.length > 1) {
      const i = list.findIndex(x => x.username === stage.focus);
      const j = i < 0 ? (e.key === 'ArrowRight' ? 0 : list.length - 1) : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      stage.focus = list[j].username; sfx('tick'); syncSubs();
    } else done = false;
    if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  $('vcWatchBtn').addEventListener('click', () => {
    const others = sharers().filter(x => !x.me);
    openStage(others.length === 1 ? others[0].username : '');
  });

  // ── What's arriving: resolution · fps · bitrate ──
  // A small dim line in the stage's bar for the screen up large (or the
  // only one), every 2s while the stage shows. qualityOf() works on any
  // LiveKit video track (sent or received), so another viewer can use it.
  const lastBytes = new WeakMap();
  async function qualityOf(track) {
    let rep = null;
    try { rep = await track?.getRTCStatsReport?.(); } catch (e) {}
    if (!rep) return null;
    let r = null;
    rep.forEach(x => { if ((x.type === 'inbound-rtp' || x.type === 'outbound-rtp') && x.kind === 'video' && (!r || (x.bytesReceived ?? x.bytesSent) > (r.bytesReceived ?? r.bytesSent))) r = x; });
    if (!r) return null;
    const bytes = r.bytesReceived ?? r.bytesSent ?? 0, now = performance.now();
    const prev = lastBytes.get(track);
    lastBytes.set(track, { bytes, at: now });
    const bps = prev && now > prev.at ? (bytes - prev.bytes) * 8000 / (now - prev.at) : 0;
    return { width: r.frameWidth || 0, height: r.frameHeight || 0, fps: Math.round(r.framesPerSecond || 0), bps: Math.max(0, bps) };
  }
  const qualityText = q => !q || !q.width ? '' : q.width + '×' + q.height + ' · ' + q.fps + ' fps' +
    (q.bps ? ' · ' + (q.bps >= 1e6 ? (q.bps / 1e6).toFixed(1) + ' Mbps' : Math.round(q.bps / 1e3) + ' kbps') : '');
  let qTimer = 0, qSeq = 0;
  async function paintQuality() {
    clearTimeout(qTimer);
    if (!stage.open) return;
    // openStage() on a stage that's already open calls this again while an
    // earlier one is still awaiting its stats: only the newest carries on,
    // or each such call left one more 2s getStats loop running.
    const seq = ++qSeq;
    const t = leadTile();
    const q = t?.track && !document.hidden ? await qualityOf(t.track) : null;
    if (seq !== qSeq) return;
    const el = stage.el.querySelector('.vs-q');
    if (stage.open) el.textContent = qualityText(q);
    qTimer = setTimeout(paintQuality, 2000);
  }

  // A shared screen in any element: a <video> for it, and a way to let go.
  // For the stage, and anything else that shows a LiveKit video track.
  function attachStage(el, track) {
    const v = document.createElement('video');
    v.playsInline = true; v.autoplay = true; v.muted = true;
    v.className = 'vs-video';
    el.appendChild(v);
    track?.attach(v);
    return { video: v, detach: () => { try { track?.detach(v); } catch (e) {} v.remove(); } };
  }

  // ── While you share: a pill under the title bar, on every page ──
  // "You're sharing", how many are watching (their faces), your own
  // screen as a small preview if you want it (off by default: a screen
  // showing itself is a hall of mirrors), and Stop.
  const pill = document.createElement('div');
  pill.className = 'vs-pill';
  pill.hidden = true;
  pill.setAttribute('role', 'status');
  pill.innerHTML = '<div class="vs-pill-row"><i class="vs-pill-dot"></i><span class="vs-pill-t">You’re sharing</span>' +
    '<span class="vs-pill-n"></span><span class="vs-pill-faces"></span>' +
    '<button type="button" class="k-icon sm" data-pill="preview" aria-pressed="false" title="Show your screen"><i class="ti ti-eye"></i></button>' +
    '<button type="button" class="k-btn sm danger" data-pill="stop"><i class="ti ti-screen-share-off"></i><span>Stop</span></button></div>' +
    '<div class="vs-pill-prev" hidden></div>';
  document.body.appendChild(pill);
  let pillPrev = null;
  function paintPill() {
    const on = sharingNow() && !stage.open;
    pill.hidden = !on;
    if (!on) { pillPrev?.detach(); pillPrev = null; return; }
    const vw = viewersOf(me());
    pill.querySelector('.vs-pill-n').textContent = vw.length ? '· ' + vw.length + ' watching' : '· nobody watching yet';
    const faces = pill.querySelector('.vs-pill-faces');
    if (faces.dataset.k !== vw.join(',')) { faces.dataset.k = vw.join(','); faces.innerHTML = facesHTML(vw, 5); faces.title = vw.join(', '); }
    const b = pill.querySelector('[data-pill="preview"]');
    b.setAttribute('aria-pressed', String(!!S.sharePreview));
    b.title = S.sharePreview ? 'Hide your screen' : 'Show your screen';
    b.querySelector('i').className = 'ti ' + (S.sharePreview ? 'ti-eye-off' : 'ti-eye');
    const box = pill.querySelector('.vs-pill-prev');
    const track = myShare()?.track || null;
    box.hidden = !S.sharePreview;
    if (S.sharePreview && track && (!pillPrev || pillPrev.track !== track)) {
      pillPrev?.detach();
      pillPrev = { ...attachStage(box, track), track };
    } else if (!S.sharePreview && pillPrev) { pillPrev.detach(); pillPrev = null; }
  }
  pill.addEventListener('click', e => {
    const b = e.target.closest('[data-pill]');
    if (!b) return;
    if (b.dataset.pill === 'stop') stopShare();
    else { sfx('click'); S.sharePreview = !S.sharePreview; save(); paintPill(); }
  });
  pill.querySelector('.vs-pill-prev').addEventListener('click', () => openStage(me()));

  // Who's in voice where, for other pages (Home's rows): { channel, sharing }.
  function whereIs(u) {
    if (!u) return null;
    for (const c of info.channels || []) {
      const m = membersOf(c).find(x => x.username === u);
      if (m) return { channel: c.name, id: c.id, sharing: !!m.sharing };
    }
    return null;
  }

  // ── Joining and leaving ──
  function reset() {
    // Out of a call's room, for whatever reason: js/46-calls.js hangs up.
    if (joined?.call) { const id = joined.callId; setTimeout(() => window.dispatchEvent(new CustomEvent('klab:call-left', { detail: { id } })), 0); }
    // A microphone still being published (publishMic is awaiting LiveKit)
    // is let go of now, not whenever that round trip settles: it may never
    // settle on a room that's gone, and the mic would stay open.
    try { pendingMic?.stop(); } catch (e) {}
    room = null; joined = null; phase = 'idle';
    pttHeld = false; deafened = false; micProblem = ''; needsClick = false;
    speaking = new Set(); volOpen = ''; lastAttrs = '';
    shareBusy = false; shareWho = new Set(); quality = '';
    sink.replaceChildren();
    closeStage(true);
  }

  function wire(r) {
    const E = LK.RoomEvent;
    const mine = fn => (...a) => { if (room === r) fn(...a); };
    // Nothing is subscribed by itself (connect's autoSubscribe: false):
    // microphones always, shared screens only while you're watching.
    r.on(E.TrackSubscribed, mine((track, pub, p) => {
      if (track.kind === 'video') { syncSubs(); return; }
      sink.appendChild(track.attach());
      applyVolumes();
    }));
    r.on(E.TrackUnsubscribed, (track, pub) => {
      // A screen's <video> is the stage's own and stays; LiveKit's <audio> go.
      try { track.detach().forEach(el => { if (el.tagName === 'AUDIO') el.remove(); }); } catch (e) {}
      if (room === r && track.kind === 'video') paintStage();
    });
    r.on(E.TrackPublished, mine((pub, p) => { syncSubs(); announceShare(p, pub); }));
    r.on(E.TrackUnpublished, mine((pub, p) => {
      if (pub.source !== LK.Track.Source.ScreenShare) return;
      shareWho.delete(p.identity);
      syncSubs();
    }));
    r.on(E.LocalTrackPublished, mine(pub => { if (pub.source === LK.Track.Source.ScreenShare) { pushAttrs(); render(); } }));
    // Stopped here, or from the browser's own "Stop sharing" bar (LiveKit
    // unpublishes a track that ends).
    r.on(E.LocalTrackUnpublished, mine(pub => {
      if (pub.source !== LK.Track.Source.ScreenShare) return;
      sfx('tick'); pushAttrs(); render();
    }));
    r.on(E.ParticipantConnected, mine(() => { sfx('queue'); syncSubs(); render(); }));
    r.on(E.ParticipantDisconnected, mine(p => {
      speaking.delete(p.identity);
      shareWho.delete(p.identity);
      if (volOpen === p.identity) volOpen = '';
      sfx('pause'); render();
    }));
    [E.TrackPublished, E.TrackUnpublished, E.TrackUnmuted, E.LocalTrackPublished, E.ParticipantAttributesChanged]
      .forEach(ev => r.on(ev, mine(render)));
    r.on(E.TrackSubscriptionFailed, mine(() => paintStage()));
    // A muted microphone isn't speaking, whatever the last speaker update said.
    r.on(E.TrackMuted, mine((pub, p) => { speaking.delete(p.identity); render(); }));
    r.on(E.ActiveSpeakersChanged, mine(list => { speaking = new Set(list.map(p => p.identity)); paintSpeaking(); }));
    r.on(E.Reconnecting, mine(() => { phase = 'reconnecting'; render(); }));
    // How good your own connection is, for the panel's line.
    r.on(E.ConnectionQualityChanged, mine((q, p) => { if (p === r.localParticipant && q !== quality) { quality = q; paintPanel(); } }));
    r.on(E.Reconnected, mine(() => { phase = 'live'; lastAttrs = ''; pushAttrs(); syncSubs(); render(); }));
    r.on(E.AudioPlaybackStatusChanged, mine(() => { needsClick = !r.canPlaybackAudio; render(); }));
    r.on(E.MediaDevicesChanged, mine(() => { if (settingsOpen()) fillDevices(); }));
    // Only ever reached when it wasn't you who left: leave() lets go of
    // the room first. A connection that never got going is join()'s to report.
    r.on(E.Disconnected, mine(reason => {
      if (phase === 'joining') return;
      const R = LK.DisconnectReason || {};
      const wasCall = !!joined?.call;
      reset();
      sfx('close');
      // A call's end is js/46-calls.js's to tell.
      if (wasCall) { render(); return; }
      showToast(
        reason === R.DUPLICATE_IDENTITY ? 'Voice moved to your other device'
        : reason === R.ROOM_DELETED ? 'That channel was deleted'
        : reason === R.PARTICIPANT_REMOVED ? 'You were removed from the channel'
        : 'Voice disconnected', 'ti-headset');
      render(); refreshSoon();
    }));
  }

  // A call (js/46-calls.js) goes through here too: opts.call is
  // { id, with, token() → { url, token } }, and its room is the call's own.
  // Everything else (the panel, mute, deafen, sharing, the stage, the
  // microphone rule) is the same.
  async function join(id, opts) {
    const call = opts?.call || null;
    const ch = call ? { id: 'call:' + call.id, name: call.with, call: true, callId: call.id, with: call.with }
      : info.channels.find(c => c.id === id);
    if (ch && opts?.watch && room && joined?.id === id && phase !== 'joining') { openStage(); return; }
    if (!ch || (joined?.id === ch.id && (room || phase === 'joining'))) return;
    // A channel still joining waits its turn; an answered call doesn't (it
    // was silently dropped, and the call sat on "Connecting…" with no sound).
    if (phase === 'joining' && !call) return;
    // One at a time: leaving a call for a channel asks first.
    if (!call && room && joined?.call && !opts?.force) {
      if (!(await window.klabCalls?.confirmSwitch?.('channel', ch.name))) return;
    }
    if (room || joined) await leave({ quiet: true });
    const seq = ++joinSeq;
    joined = call ? { ...ch } : { id: ch.id, name: ch.name };
    phase = 'joining';
    render();
    let r = null;
    try {
      const [lib, t] = await Promise.all([
        loadLib(),
        call ? call.token() : fetchTimeout('/api/voice/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: id }),
        }, 8000).then(async res => {
          const d = await jsonBy(res).catch(e => (/timed out/.test(e.message) ? Promise.reject(e) : {}));
          if (!res.ok || !d.token) throw new Error(d.error || 'the server said no');
          return d;
        }),
      ]);
      if (!t?.token) throw new Error('the server said no');
      if (seq !== joinSeq) return;
      LK = lib;
      r = new LK.Room({
        adaptiveStream: false, dynacast: false,
        audioCaptureDefaults: captureOpts(),
        audioOutput: S.output ? { deviceId: S.output } : undefined,
      });
      room = r;
      wire(r);
      // Subscriptions are ours to make (syncSubs): a shared screen is
      // megabits a second, so it only comes down while someone's watching.
      await r.connect(t.url, t.token, { autoSubscribe: false });
      if (seq !== joinSeq || room !== r) { r.disconnect(); return; }
      phase = 'live';
      r.remoteParticipants.forEach(p => { if (p.getTrackPublication(LK.Track.Source.ScreenShare)) shareWho.add(p.identity); });
      syncSubs();
      // "Join to watch": straight onto the stage once you're in.
      if (opts?.watch && sharers().some(x => !x.me)) openStage();
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
      showToast((call ? "Couldn't connect the call with " : "Couldn't join ") + ch.name + ': ' + (!why || /signal|fetch|websocket|timed? ?out|abort/i.test(why)
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

  micBtn.addEventListener('click', toggleMute);

  const idOf = el => Number(el.closest('.vc-channel')?.dataset.id);
  listEl.addEventListener('click', e => {
    const row = e.target.closest('.vc-row');
    if (row) { join(idOf(row)); return; }
    const w = e.target.closest('.vc-watch');
    if (w) { openStage(w.dataset.u); return; }
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
    const d = await jsonBy(r).catch(() => ({}));
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
        { label: 'Message', icon: 'ti-message-2-plus', action: () => messageUser(u), hidden: mine || typeof messageUser !== 'function' },
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
        const name = await showInputDialog('Rename channel', '', 'Channel name', c.name, { maxLength: 32 });
        if (name && name !== c.name) manage(() => api('PATCH', '/api/voice/channels/' + c.id, { name }));
      } },
      { label: 'Delete', icon: 'ti-trash', warn: true, action: async () => {
        const n = membersOf(c).length;
        const ok = await showConfirmDialog('Delete “' + c.name + '”?', (n ? klabCount(n, 'person', 'people') + ' in it will be disconnected, and it' : 'It') + ' goes for everyone.', 'Delete');
        if (ok) manage(() => api('DELETE', '/api/voice/channels/' + c.id));
      } },
    ]);
  });

  $('vcAddBtn').addEventListener('click', async () => {
    sfx('click');
    const name = await showInputDialog('New voice channel', 'Name the channel.', 'Channel name', '', { maxLength: 32 });
    if (name) manage(() => api('POST', '/api/voice/channels', { name }));
  });
  $('vcDeafen').addEventListener('click', toggleDeafen);
  $('vcLeave').addEventListener('click', () => leave());
  function openVoiceSettings() {
    openSettings();
    $('voiceSettings').scrollIntoView({ block: 'start' });
  }
  $('vcSettingsBtn').addEventListener('click', openVoiceSettings);

  // ── Keys ──
  // Ctrl+Shift+M mutes and Ctrl+Shift+D deafens (Cmd on a Mac), anywhere
  // on the page, while you're in a channel.
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
    // A call's room (js/46-calls.js): { id, with, token() }.
    joinCall: call => join(null, { call }),
    // Screens: share(mode 'smooth'|'sharp'), stopShare(), watch(username?) opens the stage.
    share: startShare, stopShare, watch: u => openStage(u || ''), closeStage: () => closeStage(),
    // Where someone is in voice ({ channel, id, sharing } or null), and two
    // pieces of the stage for other viewers (OBS live, js/45-live.js):
    // attachStage(el, track) → { video, detach }, qualityOf(track) → { width, height, fps, bps }.
    where: whereIs, attachStage, qualityOf, qualityText,
    // The channels (id, name), for Social's "Open voice".
    channels: () => info.channels.map(c => ({ id: c.id, name: c.name })),
    state: () => ({
      enabled: !!info.enabled, phase, channel: joined && { ...joined }, muted: showMuted(), deafened, micProblem,
      micLive: !!micPub() && !micPub().isMuted, // what's going out right now (push to talk: only while held)
      speaking: [...speaking], members: room && phase !== 'joining' ? liveMembers() : [],
      sharing: sharingNow(), shareMode: S.shareMode, sharers: sharers().map(x => x.username),
      watchingMe: room ? viewersOf(me()) : [], watched: watchedNow(),
      stage: stage.open ? 'open' : stage.away ? 'popped out' : 'closed', focus: stage.focus,
      // What's coming down for screens right now (only while watching).
      screenSubs: room ? [...room.remoteParticipants.values()].flatMap(p => [...p.trackPublications.values()]
        .filter(t => t.source === LK.Track.Source.ScreenShare && t.isSubscribed).map(() => p.identity)) : [],
    }),
  };

  refresh();
})();
