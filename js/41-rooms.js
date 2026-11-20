// ══════════════════════════════════════════
//  WATCH PARTIES — a video watched in step with other people (2026-11-20).
//  klabnet-api routers/rooms.py keeps each room in memory: the video, who's
//  in it, and "playing or not, at this position, as of this server time".
//  Anyone in the room can play, pause, seek or put on another video and
//  everyone follows (a couch: the last press wins). While you're in one
//  this page asks the room about once a second and lines its player up;
//  your own presses are sent as they happen.
//    · Videos' watch view (js/39-videos.js) has "Watch together" beside
//      Share and a bar over the player while you're in a room: faces,
//      "You're hosting" / "Following …", what someone last did, Leave.
//    · It works through window.klabWatch (39-videos.js) and its
//      'klab:watch' event, fired as a player mounts and goes.
//    · Leaving the watch view (another video aside), or Videos, leaves the
//      room: a room you're not watching would keep pulling you back.
//  window.klabRooms: together(v), start(id), join(id), leave(), mine(),
//  state(). Social's Together (js/25-social.js) lists the rooms.
// ══════════════════════════════════════════
(function () {
  const API = '/api/posts/rooms';
  const POLL_MS = 1000;
  const me = () => window.KLAB_USER?.username || '';
  let room = null;          // the room as last heard
  let offset = 0;           // server clock minus ours (ms)
  let applied = 0;          // the seq lined up with here
  let quietUntil = 0;       // events from our own lining-up aren't presses
  let ready = false;        // the player's mounted and lined up once
  let opening = 0;          // a video being opened because the room put it on
  let timer = 0, polling = false, seekT = 0, lastNote = '', sending = 0;
  let localUntil = 0;       // a press here, not sent yet: the room's older word waits
  const bar = () => document.getElementById('vidRoomBar');
  const video = () => window.klabWatch?.video?.() || null;
  const serverNow = () => (Date.now() + offset) / 1000;
  const sfx = n => { try { SFX && SFX.play(n); } catch (e) {} };

  function clock(t, recvAt, sentAt) {
    // Half the round trip is the lag; good enough for a couch.
    if (t) offset = t * 1000 - (sentAt + recvAt) / 2;
  }
  async function call(method, path, body) {
    const sent = Date.now();
    const r = await fetchTimeout(API + path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    }, 6000);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'status ' + r.status); e.status = r.status; throw e; }
    clock(j.now, Date.now(), sent);
    return j;
  }
  const target = r => {
    const p = r.position + (r.playing ? Math.max(0, serverNow() - r.at) : 0);
    const d = r.video?.duration || 0;
    return d ? Math.min(p, d) : p;
  };
  const quiet = ms => { quietUntil = Math.max(quietUntil, performance.now() + (ms || 700)); };

  // ── Lining up with the room ──
  function apply(r, hard) {
    const el = video(), cur = window.klabWatch?.current?.();
    if (!el || !cur) return;
    if (cur.id !== r.video.id) { follow(r); return; }
    const want = target(r);
    const off = (el.currentTime || 0) - want;
    if (hard || Math.abs(off) > (r.playing ? 1.5 : 0.4)) {
      quiet();
      try { el.currentTime = want; } catch (e) {}
    }
    if (r.playing && el.paused) { quiet(); el.play().catch(() => {}); }
    else if (!r.playing && !el.paused) { quiet(); el.pause(); }
    applied = r.seq;
  }
  // The room put on another video: open it, there.
  function follow(r) {
    if (opening === r.video.id) return;
    opening = r.video.id;
    ready = false;
    quiet(4000);
    // From another page, Videos opens it as it arrives (its first arrival
    // would otherwise draw Browse over a video opened ahead of it).
    if (!document.body.classList.contains('tab-videos-active')) {
      window.klabVideoLink = { id: r.video.id, at: target(r) };
      setActiveTab('videos');
      return;
    }
    window.klabWatch?.open(r.video.id, target(r), { autoplay: r.playing, quiet: true });
  }

  // ── Asking the room ──
  function schedule() {
    clearTimeout(timer);
    if (room) timer = setTimeout(poll, document.hidden ? POLL_MS * 3 : POLL_MS);
  }
  async function poll() {
    if (!room || polling) return schedule();
    polling = true;
    const id = room.id;
    try {
      const r = await call('GET', '/' + encodeURIComponent(id));
      // A press of ours on its way (or already answered): this answer is
      // from before it.
      if (!room || room.id !== id || sending || r.seq < room.seq) return;
      if (!r.member) { gone('You left the watch party'); return; }
      const fresh = r.seq !== applied;
      room = r;
      if (ready && performance.now() > localUntil) apply(r, fresh);
      if (fresh && r.by !== me()) note(r);
      paintBar();
    } catch (e) {
      if (e.status === 404 && room && room.id === id) gone('The watch party ended');
    } finally { polling = false; schedule(); }
  }
  // What someone else just did, under the faces: "bob paused · 0:42".
  function note(r) {
    const verb = r.video.id !== (window.klabWatch?.current?.()?.id) ? 'put on ' + r.video.title
      : r.playing ? 'played' : 'paused';
    lastNote = r.by + ' ' + verb + (r.video.id === window.klabWatch?.current?.()?.id ? ' · ' + mmss(r.position) : '');
  }
  const mmss = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ── Your presses ──
  function send(extra) {
    const el = video();
    if (!room || !el) return;
    const body = Object.assign({ playing: !el.paused, position: el.currentTime || 0 }, extra || {});
    const id = room.id;
    sending++;
    call('POST', '/' + encodeURIComponent(id) + '/state', body).then(r => {
      if (room && room.id === id) { room = r; applied = r.seq; lastNote = ''; paintBar(); }
    }).catch(e => { if (e.status === 404) gone('The watch party ended'); }).finally(() => { sending--; });
  }
  const pressed = () => room && ready && performance.now() > quietUntil;
  function hook(el) {
    if (el._klabRoom) return;
    el._klabRoom = true;
    const mark = () => { if (pressed()) localUntil = performance.now() + 1500; };
    el.addEventListener('seeking', mark);
    el.addEventListener('play', () => { if (pressed()) send(); });
    el.addEventListener('pause', () => { if (pressed() && !el.ended) send(); });
    el.addEventListener('ended', () => { if (pressed()) send({ playing: false }); });
    el.addEventListener('seeked', () => {
      if (!pressed()) return;
      clearTimeout(seekT);
      seekT = setTimeout(() => { if (pressed()) send(); }, 250);
    });
  }

  document.addEventListener('klab:watch', e => {
    const d = e.detail;
    if (!d) {
      // Gone from the watch view (and not just on to the next video).
      setTimeout(() => { if (room && !window.klabWatch?.watching?.()) leave(true); }, 400);
      return;
    }
    if (!room) return;
    hook(d.video);
    const followed = opening === d.v.id;
    opening = 0;
    if (!followed && d.v.id !== room.video.id) {
      // You put on another video: the room watches it with you.
      ready = true;
      quiet(1200);
      send({ video: d.v.id, position: 0, playing: true });
      paintBar();
      return;
    }
    // Lined up once it can be (the metadata's needed to seek).
    const go = () => { if (!room) return; quiet(); apply(room, true); setTimeout(() => { ready = true; }, 600); };
    if (d.video.readyState >= 1) go(); else d.video.addEventListener('loadedmetadata', go, { once: true });
    paintBar();
  });

  // ── The bar over the player ──
  function face(u) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="room-face" title="' + esc(u) + '" style="--c:' + (typeof profileColor === 'function' ? profileColor(u) : '') + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  function paintBar() {
    const b = bar();
    const tg = document.getElementById('vidTogether');
    if (tg) {
      const inThis = !!room && room.video.id === window.klabWatch?.current?.()?.id;
      tg.hidden = inThis;
    }
    if (!b) return;
    if (!room) { b.hidden = true; b.innerHTML = ''; return; }
    const others = room.people.filter(u => u !== me());
    const who = room.host === me() ? 'You’re hosting' : 'Following ' + esc(room.host);
    const sub = lastNote ? esc(lastNote) : others.length ? 'With ' + esc(klabList(others)) : 'Waiting for people to join';
    const html = '<div class="room-faces">' + room.people.slice(0, 6).map(face).join('') + '</div>' +
      '<div class="room-tx"><b>' + who + '</b><span>' + sub + '</span></div>' +
      '<button type="button" class="k-btn sm" data-room="copy" title="Copy a link to this watch party"><i class="ti ti-link"></i><span>Copy link</span></button>' +
      '<button type="button" class="k-btn sm" data-room="leave"><i class="ti ti-door-exit"></i><span>Leave</span></button>';
    if (b._html !== html) { b._html = html; b.innerHTML = html; }
    if (b.hidden) { b.hidden = false; klabEnter?.(b); }
  }
  const klabList = names => names.length <= 2 ? names.join(' and ') : names.slice(0, 2).join(', ') + ' and ' + klabCount(names.length - 2, 'other', 'others');
  document.addEventListener('click', e => {
    const b = e.target.closest('#vidRoomBar [data-room]');
    if (!b) return;
    if (b.dataset.room === 'leave') { leave(); sfx('nav_back'); }
    else if (b.dataset.room === 'copy' && room) klabCopy(location.origin + location.pathname + '#videos/' + room.video.id + '?room=' + encodeURIComponent(room.id), 'Link');
  });
  document.addEventListener('contextmenu', e => {
    const b = e.target.closest('#vidRoomBar');
    if (!b || !room) return;
    klabMenu(e, [
      { header: 'Watch party' },
      ...room.people.filter(u => u !== me()).map(u => ({ label: u, icon: 'ti-user-circle', action: () => openProfileView(u) })),
      '-',
      { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(location.origin + location.pathname + '#videos/' + room.video.id + '?room=' + encodeURIComponent(room.id), 'Link') },
      { label: 'Leave', icon: 'ti-door-exit', action: () => leave() },
    ]);
  });

  // ── Starting, joining, leaving ──
  function enter(r) {
    room = r; applied = r.seq; lastNote = '';
    window.klabPresenceBeat?.();
    window.dispatchEvent(new Event('klab:rooms'));
    schedule();
  }
  async function start(v) {
    const el = video(), cur = window.klabWatch?.current?.();
    const here = cur && cur.id === v.id && el;
    try {
      const r = await call('POST', '', { video: v.id, position: here ? el.currentTime || 0 : 0, playing: here ? !el.paused : true });
      enter(r);
      ready = !!here;
      if (here) { hook(el); paintBar(); }
      else follow(r);
      showToast('Watch party started. People can join from Social.', 'ti-users');
      sfx('click');
      return true;
    } catch (e) { showToast('Couldn’t start a watch party' + (e.status === 404 || e.status === 405 ? ': it needs the latest klabnet-api' : ''), 'ti-alert-triangle'); return false; }
  }
  async function join(id) {
    if (room && room.id === id) { follow(room); return true; }
    try {
      const r = await call('POST', '/' + encodeURIComponent(id) + '/join');
      enter(r);
      ready = false;
      opening = 0;
      follow(r);
      showToast(r.host === me() ? 'Back in your watch party' : 'Watching with ' + r.host, 'ti-users');
      sfx('click');
      return true;
    } catch (e) { showToast(e.status === 404 ? 'That watch party has ended' : 'Couldn’t join that watch party', 'ti-alert-triangle'); return false; }
  }
  function gone(msg) {
    if (!room) return;
    room = null; ready = false; lastNote = '';
    clearTimeout(timer);
    paintBar();
    window.klabPresenceBeat?.();
    window.dispatchEvent(new Event('klab:rooms'));
    if (msg) showToast(msg, 'ti-users');
  }
  function leave(quietly) {
    if (!room) return;
    const id = room.id;
    gone(quietly ? 'You left the watch party' : '');
    try { fetch(API + '/' + encodeURIComponent(id) + '/leave', { method: 'POST', keepalive: true }).catch(() => {}); } catch (e) {}
  }
  // "Watch together" in the watch view: start one on this video (or leave
  // the one you're in for it).
  function together(v) {
    if (room && room.video.id === v.id) return;
    start(v);
  }
  // Leaving Videos pauses its player (js/39-videos.js); that pause mustn't
  // pause everyone, so the room goes first.
  const tabChanged = window.klabVideosTabChanged;
  window.klabVideosTabChanged = on => {
    if (!on && room) leave(true);
    tabChanged?.(on);
  };
  window.addEventListener('pagehide', () => { if (room) leave(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && room) poll(); });

  // A link to a room: #videos/<id>?room=<rid> (js/01-shell.js keeps the
  // query on klabVideoLink; read here too, straight off the address).
  function fromLink() {
    const m = /^#videos\/\d+\?(?:.*&)?room=([\w-]+)/.exec(location.hash);
    if (m && (!room || room.id !== m[1])) join(m[1]);
  }
  window.addEventListener('hashchange', fromLink);
  setTimeout(fromLink, 1500);

  window.klabRooms = {
    together, start, join, leave: () => leave(),
    mine: () => (room ? room.id : null),
    state: () => (room ? { id: room.id, host: room.host, people: room.people.slice(), seq: room.seq, applied, video: room.video.id, playing: room.playing, target: target(room), at: video()?.currentTime ?? null, paused: video()?.paused ?? null, ready } : null),
  };
})();
