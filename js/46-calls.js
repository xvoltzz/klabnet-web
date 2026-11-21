// ══════════════════════════════════════════
//  CALLS — ring someone, by name or by their extension
//  The owner (2026-11-20): "also can we add direct calls? maybe everyone
//  gets a klabnet extension!", then "a dialer would be cool too".
//    · Everyone has a three-digit extension (klabnet-api routers/calls.py:
//      first come, 100–799; yours can be moved in Settings → Voice).
//    · Every page holds a stream open to the API. A call rings every one of
//      the callee's pages (the incoming sheet, a ringtone, a desktop
//      notification); the first to answer takes it and the others stop.
//      Do not disturb, nobody there or already on a call: a missed call,
//      no ringing. 30 seconds unanswered: missed. Missed calls are in the
//      recap and the call log (Social → Contacts → Calls).
//    · The call itself is voice: js/22-voice.js joins the call's own
//      LiveKit room (klabVoice.joinCall), so the voice panel at the
//      sidebar's foot ("In a call · with alice"), mute, deafen, screen
//      sharing and the microphone rule are all voice's. A card in the
//      corner shows who and how long, with mute and hang up.
//    · One call or one voice channel at a time: switching asks first.
//    · The dialer: a keypad sheet (Contacts' head, Go anywhere, the voice
//      panel's menu): type or press an extension or a name, it says who
//      that is, Enter calls. Speed dial and recent calls under it.
//  window.klabCalls is the way in for Contacts (js/47-contacts.js), the
//  recap, profiles and the desktop apps.
// ══════════════════════════════════════════
(function () {
  const BASE = '/api/posts/calls';
  const $ = id => document.getElementById(id);
  const me = () => window.KLAB_USER?.username || '';
  const sfx = n => { try { SFX && SFX.play(n); } catch (e) {} };
  const color = u => (typeof profileColor === 'function' ? profileColor(u) : 'var(--text)');
  const mmss = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
  function face(u, cls) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="' + (cls || 'cl-face') + '" style="--c:' + color(u) + '">' + (url ? '<img src="' + esc(url) + '" alt="" draggable="false" />' : '<b>' + esc((u || '?')[0].toUpperCase()) + '</b>') + '</span>';
  }

  // ── What the API says ──
  let enabled = false;      // the API has calls, and voice is set up
  let exts = {};            // username → extension
  let favs = [];            // speed dial, in order
  let log = [];             // the call log, newest first
  let call = null;          // the call you're in or being rung for (not ended)
  let lastEnd = null;       // the last call that ended here, for the card's "Call ended"

  async function api(method, path, body) {
    const r = await fetchTimeout(BASE + path, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
    }, 8000);
    const json = /json/.test(r.headers.get('content-type') || '');
    // fetchTimeout's clock stops at the headers: a body that stalls would
    // leave this (and a ring, an answer, a hang-up) waiting forever.
    const d = json ? await Promise.race([r.json().catch(() => ({})), new Promise(res => setTimeout(() => res(null), 8000))]) : {};
    if (d === null) { const e = new Error('klabnet isn’t answering'); e.status = 0; throw e; }
    if (!r.ok) { const e = new Error(d.error || 'that didn’t work'); e.status = r.status; e.data = d; throw e; }
    // A 200 that isn't JSON is a sign-in page (an expired session followed
    // through Authentik's redirect), not an answer.
    if (!json) { const e = new Error('your sign-in expired. Reload klabnet'); e.status = 0; throw e; }
    return d;
  }

  async function loadLog() {
    try {
      const d = await api('GET', '');
      enabled = !!d.voice;
      log = Array.isArray(d.log) ? d.log : [];
      if (d.ext && me()) exts[me()] = d.ext;
      changed();
      return true;
    } catch (e) {
      // 404/405: an API from before calls. Anything else: keep what we had.
      if (e.status === 404 || e.status === 405) { enabled = false; changed(); }
      return false;
    }
  }
  let extsAt = 0;
  async function loadExts(force) {
    if (!force && Date.now() - extsAt < 5 * 60e3) return;
    extsAt = Date.now();
    try { const d = await api('GET', '/extensions'); exts = d.extensions || {}; changed(); } catch (e) {}
  }
  async function loadFavs() {
    try { const d = await api('GET', '/favorites'); favs = d.favorites || []; changed(); } catch (e) {}
  }
  const changed = () => window.dispatchEvent(new CustomEvent('klab:calls'));

  // ── The line in: a stream per page ──
  let es = null, retry = 0, retryT = 0, connected = false;
  // A line that died without telling (a laptop asleep, a dropped Wi-Fi):
  // the API sends a ping every 15s, so one silent for 50s is dead. Only
  // once a ping's been heard (an API from before pings sends none).
  let heardAt = 0, pings = false;
  const STALE = 50e3;
  const stale = () => !!es && pings && Date.now() - heardAt > STALE;
  setInterval(() => { if (enabled && stale()) connect(); }, 20e3);
  function connect() {
    clearTimeout(retryT);
    if (es) { try { es.close(); } catch (e) {} es = null; }
    if (!enabled) return;
    heardAt = Date.now();
    es = new EventSource(BASE + '/stream?device=' + encodeURIComponent(KLAB_DEVICE));
    es.addEventListener('ping', () => { pings = true; heardAt = Date.now(); });
    es.addEventListener('hello', e => { heardAt = Date.now(); connected = true; retry = 0; let d = {}; try { d = JSON.parse(e.data); } catch (x) {} apply(d.call, true); });
    es.addEventListener('call', e => { heardAt = Date.now(); let d = {}; try { d = JSON.parse(e.data); } catch (x) {} if (d.call) apply(d.call); });
    es.onerror = () => {
      connected = false;
      // A stream that can't come back by itself (a sign-in bounce, the API
      // restarting): try again, slower each time.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        retryT = setTimeout(connect, Math.min(300e3, 3000 * 2 ** retry++));
      }
    };
  }

  // ── A call changing ──
  const here = c => !!c && ((c.from === me() && c.callerDevice === KLAB_DEVICE) || (c.to === me() && c.device === KLAB_DEVICE));
  const other = c => (c.from === me() ? c.to : c.from);
  const inThisCallsRoom = c => { const s = window.klabVoice?.state?.(); return !!(s?.channel?.call && s.channel.callId === c.id); };
  let declinedDnd = new Set(), ignored = new Set(), rungHere = new Set();

  function apply(c, hello) {
    if (!c) {
      // hello with nothing going on: anything we thought was on is over.
      if (hello && call) { const was = call; call = null; stopSounds(); closeIncoming(); if (inThisCallsRoom(was)) window.klabVoice.leave({ quiet: true }); }
      paint(); return;
    }
    const prev = call && call.id === c.id ? call : null;
    if (c.state === 'ended') {
      if (call && call.id === c.id) call = null;
      ended(c, prev);
    } else {
      call = c;
      if (c.state === 'ringing') ringingNow(c);
      else if (c.state === 'live') liveNow(c, prev);
    }
    paint();
  }

  function ringingNow(c) {
    if (c.to === me()) {
      // Do not disturb here (the API may not have heard yet): missed, quietly.
      if (typeof klabStatus === 'function' && klabStatus() === 'dnd') {
        if (!declinedDnd.has(c.id)) { declinedDnd.add(c.id); api('POST', '/' + c.id + '/decline', { reason: 'dnd' }).catch(() => {}); }
        return;
      }
      // Heard again (the stream reconnecting says hello): already ringing.
      if (rungHere.has(c.id)) { if (!ignored.has(c.id)) { openIncoming(c); startRing(); } return; }
      rungHere.add(c.id);
      if (!ignored.has(c.id)) openIncoming(c);
      startRing();
      window.klabDesktopNotify?.({
        title: c.from + ' is calling', body: exts[c.from] ? 'ext ' + exts[c.from] + ' · klabnet' : 'klabnet', tag: 'call-' + c.id,
        icon: window.klabResolveUserAvatar?.(c.from) || '', onClick: () => { ignored.delete(c.id); if (call?.id === c.id) openIncoming(call); },
      });
    } else if (c.callerDevice === KLAB_DEVICE) startRingback();
  }

  function liveNow(c, prev) {
    stopSounds();
    if (here(c)) {
      closeIncoming();
      if (!inThisCallsRoom(c)) {
        window.klabVoice?.joinCall({
          id: c.id, with: other(c),
          token: () => api('POST', '/' + c.id + '/token', { device: KLAB_DEVICE }),
        });
      }
    } else if (incomingFor === c.id || rungHere.has(c.id)) {
      // Rung here, taken somewhere else.
      if (incomingFor === c.id) showToast('Answered on your other device', 'ti-phone');
      closeIncoming();
      // Not this device's call any more: its end isn't this device's to tell
      // ("alice hung up" on a page that was never in it).
      rungHere.delete(c.id);
    }
  }

  const ENDED = {
    missed: u => 'No answer from ' + u,
    declined: u => u + ' declined',
    busy: u => u + ' is on another call',
    dnd: u => u + ' has do not disturb on',
    unavailable: u => u + ' isn’t on klabnet right now',
  };
  const endedSeen = new Set();
  function ended(c, prev) {
    // Heard twice (the answer to a press, then the stream): once is enough.
    if (endedSeen.has(c.id)) return;
    endedSeen.add(c.id);
    const mineHere = here(c) || (c.from === me() && c.callerDevice === KLAB_DEVICE) || rungHere.has(c.id);
    stopSounds();
    closeIncoming();
    if (inThisCallsRoom(c)) window.klabVoice.leave({ quiet: true });
    if (!mineHere) { loadLog(); return; }
    const u = other(c);
    if (c.outcome === 'answered' && c.answered) {
      sfx('hangup');
      lastEnd = { c, at: Date.now() };
      showToast((c.endedBy && c.endedBy !== me() ? u + ' hung up' : 'Call ended') + ' · ' + mmss((c.ended - c.answered) / 1000), 'ti-phone-off');
    } else if (c.from === me()) {
      if (c.outcome !== 'cancelled') { sfx('hangup'); showToast((ENDED[c.outcome] || (x => 'The call to ' + x + ' ended'))(u), 'ti-phone-off', { action: { label: 'Message', run: () => message(u) } }); }
    } else if (c.outcome === 'cancelled' || c.outcome === 'missed') {
      showToast({ title: 'Missed call', body: 'From ' + c.from }, toastPerson(c.from), {
        group: 'call:' + c.from, onClick: () => dial(c.from),
        actions: [{ label: 'Call back', icon: 'ti-phone', run: () => dial(c.from) }, { label: 'Message', icon: 'ti-message-circle', run: () => message(c.from) }],
      });
    }
    rungHere.delete(c.id);
    setTimeout(loadLog, 400);
  }

  // A call's room went (hung up from the voice panel, the connection lost,
  // or a voice channel joined instead): the call's over.
  window.addEventListener('klab:call-left', e => {
    const id = e.detail?.id;
    if (call && call.id === id && call.state === 'live') api('POST', '/' + id + '/hangup', {}).then(d => d.call && apply(d.call)).catch(() => {});
  });

  // ── Sounds ──
  let ringT = 0, backT = 0;
  // The API ends an unanswered call at 30s. If its "ended" never arrives
  // (a stream that died without a ping to tell, an API from before pings),
  // the ringing stopped only with a reload: give up after a minute and ask
  // the stream again, whose hello says what's really going on.
  const RING_MAX = 60e3;
  const ringOver = t0 => {
    if (Date.now() - t0 < RING_MAX) return false;
    stopSounds();
    if (enabled) connect();
    return true;
  };
  function startRing() {
    if (ringT) return;
    sfx('ring');
    const t0 = Date.now();
    ringT = setInterval(() => { if (!call || call.state !== 'ringing') return stopSounds(); if (ringOver(t0)) return; sfx('ring'); }, 3200);
  }
  function startRingback() {
    if (backT) return;
    sfx('ringback');
    const t0 = Date.now();
    backT = setInterval(() => { if (!call || call.state !== 'ringing') return stopSounds(); if (ringOver(t0)) return; sfx('ringback'); }, 3000);
  }
  function stopSounds() { clearInterval(ringT); clearInterval(backT); ringT = backT = 0; }

  // ── Placing a call ──
  const voiceChannel = () => { const s = window.klabVoice?.state?.(); return s?.channel && !s.channel.call ? s.channel : null; };
  async function dial(to) {
    to = String(to || '').trim();
    if (!to) return false;
    if (!enabled) { showToast('Calls need voice set up on klabnet', 'ti-phone-off'); return false; }
    if (call) { showToast(call.state === 'ringing' && call.to === me() ? 'Someone’s calling you' : 'You’re already in a call', 'ti-phone'); show(); return false; }
    if (!connected) { showToast('Calls are reconnecting. Try again in a moment', 'ti-loader-2'); connect(); return false; }
    const who = /^\d+$/.test(to) ? whoIs(to) : to;
    if (who && who === me()) { showToast('That’s you', 'ti-phone'); return false; }
    const ch = voiceChannel();
    if (ch && !(await showConfirmDialog('Leave ' + ch.name + ' to call ' + (who || to) + '?', 'You’ll leave the voice channel when they answer.', 'Call', { danger: false }))) return false;
    sfx('click');
    try {
      const d = await api('POST', '', { to, device: KLAB_DEVICE });
      apply(d.call);
      return true;
    } catch (e) {
      sfx('error');
      showToast(klabCap(e.status === 503 ? 'Calls need voice set up on klabnet' : String(e.message || 'Couldn’t call')), 'ti-phone-off');
      return false;
    }
  }
  async function accept() {
    const c = call;
    if (!c || c.state !== 'ringing' || c.to !== me()) return;
    const ch = voiceChannel();
    if (ch && !(await showConfirmDialog('Leave ' + ch.name + ' to answer?', 'You’ll leave the voice channel.', 'Answer', { danger: false }))) return;
    stopSounds();
    try { const d = await api('POST', '/' + c.id + '/accept', { device: KLAB_DEVICE }); apply(d.call); }
    catch (e) {
      if (e.data?.call) apply(e.data.call);
      showToast(klabCap(String(e.message || 'Couldn’t answer')), 'ti-phone-off');
    }
  }
  async function decline() {
    const c = call;
    if (!c) return;
    ignored.add(c.id);
    closeIncoming(); stopSounds();
    try { const d = await api('POST', '/' + c.id + '/decline', {}); apply(d.call); } catch (e) {}
  }
  async function hangup() {
    const c = call;
    if (!c) return;
    // The microphone goes first, whatever the API says (the voice rule).
    if (inThisCallsRoom(c)) window.klabVoice.leave({ quiet: true });
    stopSounds();
    try { const d = await api('POST', '/' + c.id + '/hangup', {}); apply(d.call); } catch (e) { call = null; paint(); }
  }
  // Escape on the incoming sheet: quiet here, still ringing (the card answers).
  function ignore() {
    if (!call) return;
    ignored.add(call.id);
    closeIncoming(); stopSounds(); paint();
  }
  // One at a time: a voice channel joined during a call asks first
  // (js/22-voice.js calls this).
  async function confirmSwitch(kind, name) {
    if (!call) return true;
    const ok = await showConfirmDialog('Hang up and join ' + name + '?', 'Your call with ' + other(call) + ' ends.', 'Hang up and join', { danger: false });
    if (ok) { await hangup(); }
    return ok;
  }

  function message(u) {
    if (!window.MatrixChat?.client) {
      showToast('Chat isn’t connected yet', 'ti-message-circle', { action: { label: 'Connect', run: () => { setActiveTab('chat'); $('chatConnectBtn')?.click(); } } });
      return;
    }
    window.messageUser?.(u);
  }

  // ── The incoming call sheet ──
  let incoming = null, incomingFor = '', popIncoming = null;
  function openIncoming(c) {
    if (incomingFor === c.id && incoming?.classList.contains('open')) return;
    closeIncoming();
    incomingFor = c.id;
    incoming = document.createElement('div');
    incoming.className = 'add-app-backdrop cl-in-back';
    incoming.innerHTML = '<div class="add-app-modal cl-in" role="alertdialog" aria-modal="true" aria-labelledby="clInWho" tabindex="-1">' +
      face(c.from, 'cl-face cl-face-lg') +
      '<div class="cl-in-who" id="clInWho" style="color:' + color(c.from) + '">' + esc(c.from) + '</div>' +
      '<div class="cl-in-sub">' + (exts[c.from] ? 'ext ' + exts[c.from] + ' · ' : '') + 'is calling you</div>' +
      '<div class="cl-in-acts"><button type="button" class="k-btn lg danger" data-cl="decline"><i class="ti ti-phone-off"></i><span>Decline</span></button>' +
      '<button type="button" class="k-btn lg primary" data-cl="accept"><i class="ti ti-phone"></i><span>Answer</span></button></div>' +
      '<div class="cl-in-hint">Esc to silence</div></div>';
    document.body.appendChild(incoming);
    incoming.addEventListener('click', e => {
      const b = e.target.closest('[data-cl]');
      if (b?.dataset.cl === 'accept') accept();
      else if (b?.dataset.cl === 'decline') decline();
    });
    incoming.classList.add('open'); // (@starting-style animates it in; focus needs it shown)
    popIncoming = window.klabLayers?.push(incoming, { kind: 'dialog', dim: true, close: ignore });
    incoming.querySelector('[data-cl="accept"]').focus({ preventScroll: true });
  }
  function closeIncoming() {
    incomingFor = '';
    popIncoming?.(); popIncoming = null;
    const el = incoming; incoming = null;
    if (el) { el.classList.remove('open'); setTimeout(() => el.remove(), 200); }
  }

  // ── The card in the corner: who, how long, mute, hang up ──
  const card = document.createElement('div');
  card.className = 'cl-card';
  card.hidden = true;
  card.setAttribute('role', 'status');
  document.body.appendChild(card);
  let tickT = 0, cardKey = '';
  function paint() {
    const c = call;
    // On a call on another of your devices: nothing here (the voice panel's there).
    const show = !!c && (here(c) || (c.state === 'ringing' && (c.callerDevice === KLAB_DEVICE || (c.to === me() && ignored.has(c.id) && !declinedDnd.has(c.id)))));
    card.hidden = !show;
    clearInterval(tickT); tickT = 0;
    changed();
    if (!show) { cardKey = ''; return; }
    const u = other(c), live = c.state === 'live', incomingC = c.to === me() && !live;
    const v = window.klabVoice?.state?.();
    const muted = !!v?.muted;
    const key = [c.id, c.state, incomingC, muted].join('|');
    if (key !== cardKey) {
      cardKey = key;
      card.innerHTML = face(u, 'cl-face') +
        '<div class="cl-card-tx"><b style="color:' + color(u) + '">' + esc(u) + '</b><span class="cl-card-sub"></span></div>' +
        '<div class="cl-card-acts">' +
        (live ? '<button type="button" class="k-icon sm' + (muted ? ' on' : '') + '" data-cl="mute" aria-pressed="' + muted + '" title="' + (muted ? 'Unmute' : 'Mute') + '"><i class="ti ' + (muted ? 'ti-microphone-off' : 'ti-microphone') + '"></i></button>' : '') +
        (incomingC ? '<button type="button" class="k-btn sm primary" data-cl="accept"><i class="ti ti-phone"></i><span>Answer</span></button>' : '') +
        '<button type="button" class="k-btn sm danger" data-cl="' + (incomingC ? 'decline' : 'hangup') + '" title="' + (live ? 'Hang up' : incomingC ? 'Decline' : 'Cancel') + '">' +
        '<i class="ti ti-phone-off"></i><span>' + (live ? 'Hang up' : incomingC ? 'Decline' : 'Cancel') + '</span></button></div>';
    }
    const sub = card.querySelector('.cl-card-sub');
    const tick = () => {
      if (!call || call.id !== c.id) return;
      const vs = window.klabVoice?.state?.();
      sub.textContent = !live ? (incomingC ? 'Calling you' : 'Calling…' + (exts[u] ? ' · ext ' + exts[u] : ''))
        : vs?.phase === 'joining' || !inThisCallsRoom(c) ? 'Connecting…'
        : vs?.phase === 'reconnecting' ? 'Reconnecting…'
        : (vs?.members || []).length < 2 ? 'Waiting for ' + u + '… ' + mmss((Date.now() - c.answered) / 1000)
        : mmss((Date.now() - c.answered) / 1000);
    };
    tick();
    if (live) tickT = setInterval(() => { tick(); const m = !!window.klabVoice?.state?.().muted; if (m !== muted) paint(); }, 1000);
  }
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-cl]');
    if (!b) return;
    const a = b.dataset.cl;
    if (a === 'mute') { window.klabVoice?.toggleMute(); setTimeout(paint, 50); }
    else if (a === 'hangup') hangup();
    else if (a === 'accept') accept();
    else if (a === 'decline') decline();
  });
  card.addEventListener('contextmenu', e => {
    if (!call) return;
    const u = other(call);
    klabMenu(e, [
      { header: u },
      { label: 'Profile', icon: 'ti-user-circle', action: () => openProfileView?.(u) },
      { label: 'Message', icon: 'ti-message-2-plus', action: () => message(u) },
      '-',
      { label: call.state === 'live' ? 'Hang up' : 'Cancel', icon: 'ti-phone-off', danger: true, action: hangup },
    ]);
  });
  function show() { if (call && incomingFor !== call.id && call.to === me() && call.state === 'ringing') openIncoming(call); else card.animate?.([{ transform: 'scale(1.03)' }, { transform: 'none' }], { duration: 200 }); }

  // ── Extensions ──
  const extOf = u => exts[u] || null;
  const whoIs = n => { n = +n; return Object.keys(exts).find(u => exts[u] === n) || null; };

  // ── The dialer ──
  let dialer = null, popDialer = null;
  function openDialer(start) {
    if (dialer) { dialer.querySelector('input').focus(); return; }
    loadExts(); loadFavs();
    dialer = document.createElement('div');
    dialer.className = 'add-app-backdrop cl-dial-back';
    dialer.innerHTML = '<div class="add-app-modal cl-dial" role="dialog" aria-modal="true" aria-label="Dialer" tabindex="-1">' +
      '<div class="add-app-title"><span>Dialer</span><button type="button" class="k-icon sm add-app-close" data-dk="close" title="Close" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
      '<div class="cl-dial-body"><div class="cl-dial-pad">' +
        '<div class="cl-dial-show"><input class="cl-dial-in" type="text" inputmode="tel" autocomplete="off" spellcheck="false" placeholder="Extension or name" aria-label="Extension or name" maxlength="32" />' +
        '<button type="button" class="k-icon sm" data-dk="back" title="Delete (Backspace)" aria-label="Delete"><i class="ti ti-backspace"></i></button></div>' +
        '<div class="cl-dial-who" aria-live="polite"></div>' +
        '<div class="cl-keys">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(k =>
          '<button type="button" class="cl-key" data-key="' + k + '" data-silent>' + k + '</button>').join('') + '</div>' +
        '<button type="button" class="k-btn primary lg cl-dial-call" data-dk="call" disabled><i class="ti ti-phone"></i><span>Call</span></button>' +
      '</div><div class="cl-dial-side"></div></div></div>';
    document.body.appendChild(dialer);
    const input = dialer.querySelector('input'), whoEl = dialer.querySelector('.cl-dial-who'), callBtn = dialer.querySelector('[data-dk="call"]');
    const side = dialer.querySelector('.cl-dial-side');
    let target = null;
    const people = () => [...new Set([...Object.keys(exts), ...(window.klabRoster?.() || []), ...(window.klabPeople?.() || [])])]
      .filter(u => u && u !== me() && u !== 'anonymous' && !u.endsWith('-bot'));
    function update() {
      const v = input.value.trim();
      target = null;
      let html = '';
      if (/^\d+$/.test(v)) {
        const u = v.length === 3 ? whoIs(v) : null;
        if (u) { target = { to: v, u }; html = face(u, 'cl-face sm') + '<span><b style="color:' + color(u) + '">' + esc(u) + '</b> · ext ' + v + '</span>'; }
        else if (v.length >= 3) html = '<span class="dim">Nobody has ' + esc(v) + '</span>';
        else {
          const m = Object.keys(exts).filter(u => String(exts[u]).startsWith(v) && u !== me()).sort((a, b) => exts[a] - exts[b]);
          html = m.length ? '<span class="dim">' + m.slice(0, 3).map(u => exts[u] + ' ' + esc(u)).join(' · ') + (m.length > 3 ? ' …' : '') + '</span>' : '<span class="dim">No extension starts with ' + esc(v) + '</span>';
        }
      } else if (v) {
        const q = v.toLowerCase().replace(/^@/, '');
        const list = people().filter(u => u.toLowerCase().startsWith(q)).sort((a, b) => a.length - b.length || a.localeCompare(b));
        const any = list.length ? list : people().filter(u => u.toLowerCase().includes(q));
        if (any[0]) { target = { to: any[0], u: any[0] }; html = face(any[0], 'cl-face sm') + '<span><b style="color:' + color(any[0]) + '">' + esc(any[0]) + '</b>' + (exts[any[0]] ? ' · ext ' + exts[any[0]] : '') + (any.length > 1 ? '<span class="dim"> · ' + (any.length - 1) + ' more</span>' : '') + '</span>'; }
        else html = '<span class="dim">No one called ' + esc(v) + '</span>';
      }
      whoEl.innerHTML = html;
      callBtn.disabled = !target;
      callBtn.querySelector('span').textContent = target ? 'Call ' + target.u : 'Call';
    }
    function paintSide() {
      const sd = favs.filter(u => u !== me());
      const rec = log.slice(0, 6);
      side.innerHTML =
        '<div class="k-label">Speed dial</div>' + (sd.length ? '<div class="cl-sd">' + sd.slice(0, 8).map(u =>
          '<button type="button" class="cl-sd-item" data-call="' + esc(u) + '" title="Call ' + esc(u) + '">' + face(u, 'cl-face') + '<span>' + esc(u) + '</span></button>').join('') + '</div>'
          : '<div class="cl-dim-line">Add people from Chat’s People list (right-click → Add to speed dial).</div>') +
        '<div class="k-label">Recent</div>' + (rec.length ? rec.map(logRowHTML).join('') : '<div class="cl-dim-line">No calls yet.</div>');
    }
    const press = k => {
      try { SFX.play('dtmf', k); } catch (e) {}
      const b = dialer.querySelector('.cl-key[data-key="' + CSS.escape(k) + '"]');
      b?.classList.add('down'); setTimeout(() => b?.classList.remove('down'), 120);
    };
    const go = async () => { if (!target) return; const t = target.to; close(); await dial(t); };
    const close = () => { popDialer?.(); popDialer = null; const el = dialer; dialer = null; window.removeEventListener('klab:calls', onCalls); if (el) { el.classList.remove('open'); setTimeout(() => el.remove(), 200); } };
    const onCalls = () => { if (dialer) { paintSide(); update(); } };
    window.addEventListener('klab:calls', onCalls);
    dialer.addEventListener('click', e => {
      if (e.target === dialer) { close(); return; }
      const k = e.target.closest('.cl-key');
      if (k) {
        press(k.dataset.key);
        if (/\d/.test(k.dataset.key)) { if (!/^\d*$/.test(input.value)) input.value = ''; input.value += k.dataset.key; update(); }
        input.focus({ preventScroll: true });
        return;
      }
      const b = e.target.closest('[data-dk]');
      if (b?.dataset.dk === 'close') close();
      else if (b?.dataset.dk === 'back') { input.value = input.value.slice(0, -1); update(); input.focus(); }
      else if (b?.dataset.dk === 'call') go();
      const c = e.target.closest('[data-call]');
      if (c) { close(); dial(c.dataset.call); }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); }
      else if (e.key.length === 1 && /[0-9*#]/.test(e.key) && /^[\d*#]*$/.test(input.value)) press(e.key);
    });
    input.addEventListener('input', () => { input.value = input.value.replace(/[*#]/g, ''); update(); });
    if (start) input.value = String(start);
    update(); paintSide();
    dialer.classList.add('open');
    popDialer = window.klabLayers?.push(dialer, { kind: 'dialog', dim: true, close });
    sfx('sheet');
    input.focus({ preventScroll: true });
  }

  // A call log row (the dialer's Recent, Contacts' Calls).
  const OUTCOME = { answered: 'Answered', missed: 'Missed', declined: 'Declined', cancelled: 'Cancelled', busy: 'Busy', dnd: 'Do not disturb', unavailable: 'Not online' };
  function logText(r) {
    if (r.outcome === 'answered') return mmss(r.seconds || 0);
    if (r.missed) return r.outcome === 'dnd' ? 'Missed · do not disturb' : 'Missed';
    if (r.out) return r.outcome === 'missed' ? 'No answer' : r.outcome === 'cancelled' ? 'Cancelled' : OUTCOME[r.outcome] || r.outcome;
    return OUTCOME[r.outcome] || r.outcome;
  }
  function logRowHTML(r) {
    const t = Date.parse(r.ended) || 0;
    return '<button type="button" class="cl-log-row' + (r.missed ? ' missed' : '') + '" data-call="' + esc(r.with) + '" title="Call ' + esc(r.with) + ' back">' +
      face(r.with, 'cl-face sm') +
      '<span class="cl-log-tx"><b style="color:' + color(r.with) + '">' + esc(r.with) + '</b>' +
      '<span><i class="ti ' + (r.missed ? 'ti-phone-x' : r.out ? 'ti-phone-outgoing' : 'ti-phone-incoming') + '"></i>' + esc(logText(r)) + '</span></span>' +
      '<span class="cl-log-at">' + (t && typeof shortAgo === 'function' ? esc(shortAgo(t)) : '') + '</span></button>';
  }

  // ── Speed dial ──
  async function setFav(u, on) {
    const next = on ? [...favs.filter(x => x !== u), u] : favs.filter(x => x !== u);
    const prev = favs; favs = next; changed();
    try { const d = await api('PUT', '/favorites', { favorites: next }); favs = d.favorites || next; changed(); }
    catch (e) { favs = prev; changed(); showToast('Couldn’t save speed dial', 'ti-alert-triangle'); }
  }

  // ── Your extension: Settings → Voice ──
  async function changeExt(u) {
    u = u || me();
    const v = await showInputDialog(u === me() ? 'Your extension' : u + '’s extension', 'Three digits, 100 to 799.' + (u === me() ? '' : ' Whoever has it gets ' + u + '’s.'), 'Extension', String(exts[u] || ''), { maxLength: 3 });
    if (!v || +v === exts[u]) return;
    try {
      const d = await api('PUT', '/extensions/' + encodeURIComponent(u), { ext: +v });
      await loadExts(true);
      showToast((u === me() ? 'You’re' : u + ' is') + ' ext ' + d.ext + (d.swapped ? ' · ' + d.swapped + ' has ' + exts[d.swapped] + ' now' : ''), 'ti-phone');
    } catch (e) { sfx('error'); showToast(klabCap(String(e.message || 'Couldn’t change it')), 'ti-alert-triangle'); }
  }
  function settingsRow() {
    const sec = $('voiceSettings');
    if (!sec || $('clExtRow')) return;
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.id = 'clExtRow';
    row.dataset.keywords = 'extension number phone call dial';
    row.innerHTML = '<div><div class="settings-row-label">Your extension</div><div class="settings-row-sub" id="clExtSub">What people dial to call you</div></div>' +
      '<button type="button" class="k-btn sm" id="clExtBtn">Change</button>';
    sec.querySelector('.settings-section-label')?.after(row);
    $('clExtBtn').addEventListener('click', () => changeExt());
    const sync = () => { const n = exts[me()]; $('clExtSub').textContent = n ? 'People dial ' + n + ' to call you' : 'What people dial to call you'; row.hidden = !enabled; };
    window.addEventListener('klab:calls', sync);
    sync();
  }

  // ── Go anywhere (js/32-terminal.js) ──
  const entries = () => !enabled ? [] : [
    { id: 'a:Dialer', label: 'Dialer', icon: 'ti-dialpad', kind: 'Action', keywords: 'call phone keypad extension dial', run: () => openDialer() },
    { id: 'a:Calls', label: 'Recent calls', icon: 'ti-phone', kind: 'Action', keywords: 'call log missed phone', run: () => window.klabContacts?.show('calls') },
    ...(call ? [{ id: 'a:Hang up', label: call.state === 'live' ? 'Hang up' : 'Cancel the call', icon: 'ti-phone-off', kind: 'Action', keywords: 'call end', run: hangup }] : []),
  ];

  window.klabCalls = {
    dial, accept, decline, hangup, openDialer, confirmSwitch, show, message, setFav, changeExt,
    ext: extOf, whoIs, favorites: () => favs.slice(), isFav: u => favs.includes(u), log: () => log.slice(),
    logRowHTML, logText, entries, loadLog, enabled: () => enabled,
    missed: () => log.filter(r => r.missed).length,
    state: () => ({ enabled, connected, call: call && { ...call }, here: here(call), ringing: !!ringT, ringback: !!backT,
      incoming: !!incoming, card: !card.hidden, ignored: call ? ignored.has(call.id) : false }),
  };
  window.klabExt = extOf;

  // ── Starting up ──
  async function start() {
    if (!me() || me() === 'anonymous') { setTimeout(start, 1500); return; }
    if (!(await loadLog())) {
      // An older API (or a blip): look again in a while.
      setTimeout(start, 120e3); return;
    }
    settingsRow();
    loadExts(true); loadFavs();
    connect();
  }
  // Back from sleep: the stream may have died without telling.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && enabled && (!es || stale())) connect(); });
  window.addEventListener('klab:people', () => loadExts());
  setTimeout(start, 800);
})();
