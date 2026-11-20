// ══════════════════════════════════════════
//  FLAIR: the little things
//  - The dancer: klabnet-tui's, as an easter egg. Now and then, while a
//    song plays, he turns up somewhere on the page (on the player, in the
//    sidebar, beside a title, on a Home tile, on the post whose song is
//    playing), dances for a while and goes. Pause and he dozes off first.
//    Clicked, he cheers and goes. Nothing runs between visits but one timer.
//  - You, at the foot of the sidebar: your picture, your name in your
//    colour, and your note or what you're playing. Opens your profile.
// ══════════════════════════════════════════
(function() {
  const audio = playerState?.audio;
  if (!audio) return;

  // ── The dancer ──
  const DANCE = ['\\(^_^ )', '( ^_^)/', '<(^_^<)', '(>^_^)>', '^(^_^)^', 'v(^_^)v', '\\(^o^)/', '~(^_^)~'];
  // Where he can turn up. top: standing on its top edge (x along it);
  // end: inside its right end; after: just past its text.
  const SPOTS = [
    { sel: '#playerDock', at: 'top', x: 0.03 },
    { sel: '#playerDock', at: 'top', x: 0.86 },
    { sel: '#sideNav #tabNav .tab-nav-btn.active', at: 'end' },
    { sel: '#sideNav .side-me', at: 'end' },
    { sel: '#musicViewTitle', at: 'after' },
    { sel: '#phViewTitle', at: 'after' },
    { sel: '#feedList .feed-post.is-song.playing', at: 'top', x: 0.88 },
  ];
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'klab-dancer';
  el.tabIndex = -1;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);

  const calm = () => window.KLAB_FX?.on() || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playing = () => !!playerState.currentSong && !audio.paused;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  let spot = null, target = null, frame = 0, ticker = 0, endAt = 0, next = 0;

  // A spot's element, if it's on screen and not under something else.
  function find(s) {
    const all = [...document.querySelectorAll(s.sel)];
    const ok = all.filter(t => {
      const r = t.getBoundingClientRect();
      if (!r.width || !r.height || r.top < 40 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
      return !!hit && (t.contains(hit) || hit === el);
    });
    return s.any ? ok[Math.floor(Math.random() * ok.length)] || null : ok[0] || null;
  }
  function place() {
    if (!target || !target.isConnected || !target.matches(spot.sel)) return false;
    const r = target.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return false;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x, y;
    if (spot.at === 'top') {
      x = r.left + (r.width - w) * spot.x; y = r.top - h - 1;
      // The apps' player runs the window's width, under the sidebar: he
      // stands on the part of it beside the sidebar, not in it.
      const side = document.documentElement.classList.contains('nav-side-on') && document.getElementById('sideNav');
      const sr = side && side.getBoundingClientRect();
      if (sr && sr.width && sr.bottom > y) x = Math.max(x, sr.right + 14);
    }
    else if (spot.at === 'end') { x = r.right - w - 10; y = r.top + (r.height - h) / 2; }
    else {
      // Past the text, not the box: a heading's box can run the row's width.
      const range = document.createRange(); range.selectNodeContents(target);
      const tr = range.getBoundingClientRect();
      x = tr.right + 12; y = tr.bottom - h - 4;
    }
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    return true;
  }
  function tick() {
    if (!place() || Date.now() > endAt || document.hidden) return leave();
    if (playing()) {
      el.classList.remove('asleep');
      frame = (frame + 1) % DANCE.length;
      el.textContent = calm() ? '\\(^_^)/' : DANCE[frame];
    } else if (!el.classList.contains('asleep')) {
      // Music stopped: he nods off, then wanders off.
      el.classList.add('asleep');
      el.textContent = '(-_-) zzz';
      endAt = Math.min(endAt, Date.now() + 6000);
    }
  }
  function visit(which) {
    if (spot) return false;
    const order = which != null ? [SPOTS[which]] : [...SPOTS].sort(() => Math.random() - 0.5);
    for (const s of order) {
      const t = s && find(s);
      if (!t) continue;
      spot = s; target = t;
      el.textContent = DANCE[0];
      el.classList.remove('asleep', 'out');
      el.classList.add('on');
      place();
      endAt = Date.now() + rand(16000, 32000);
      ticker = setInterval(tick, 455);
      return true;
    }
    return false;
  }
  function leave(cheer) {
    if (!spot) return;
    clearInterval(ticker); ticker = 0;
    if (cheer) el.textContent = '\\(^o^)/';
    el.classList.add('out');
    setTimeout(() => { el.classList.remove('on', 'out', 'asleep'); }, cheer ? 700 : 400);
    spot = target = null;
    plan();
  }
  // Between visits, one timer: the first a minute or so into listening,
  // then every few minutes. It runs on through song changes and the gaps
  // between songs (restarting it on each play or stop meant that, with
  // songs shorter than the wait, he never came); if nothing is playing when
  // it's up, it waits again.
  let first = true;
  function plan() {
    if (next) return;
    next = setTimeout(() => {
      next = 0;
      if (playing() && !document.hidden && visit()) first = false;
      else plan();
    }, first ? rand(40e3, 100e3) : rand(180e3, 480e3));
  }
  audio.addEventListener('play', () => { if (!spot) plan(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  el.addEventListener('click', () => { SFX && SFX.play('star'); leave(true); });
  window.addEventListener('resize', () => { if (spot) place(); });
  window.addEventListener('scroll', () => { if (spot && !place()) leave(); }, { passive: true, capture: true });
  // For testing, and for anyone who reads the source: klabDancer.summon().
  window.klabDancer = { summon: i => visit(i), leave: () => leave() };
})();

// When a timed status ends: "4:05 PM", or "Tue 8:00 AM" past today.
function klabStatusTime(ms) {
  const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return today ? t : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
}
// Do not disturb, for how long: from the status menu, Settings and the palette.
function klabDndMenu(anchor) {
  const now = klabStatus() === 'dnd', until = klabStatusUntil();
  const morning = new Date(); morning.setDate(morning.getDate() + 1); morning.setHours(8, 0, 0, 0);
  const set = t => { setKlabStatus('dnd', t); showToast?.('Do not disturb' + (t ? ' until ' + klabStatusTime(t) : ' is on'), 'ti-bell-off'); };
  klabMenu.at(anchor, [
    { header: 'Do not disturb' },
    { label: 'For 1 hour', icon: 'ti-clock', hint: klabStatusTime(Date.now() + 36e5), action: () => set(Date.now() + 36e5) },
    { label: 'Until tomorrow', icon: 'ti-sun', hint: klabStatusTime(+morning), action: () => set(+morning) },
    { label: 'Until I turn it off', icon: 'ti-bell-off', action: () => set(0) },
    now ? '-' : null,
    now ? { label: 'Turn off' + (until ? ' now' : ''), icon: 'ti-bell', action: () => setKlabStatus('') } : null,
  ].filter(Boolean), { align: 'start' });
}

(function() {
  // ── You ──
  const foot = document.querySelector('#sideNav .side-nav-foot');
  if (!foot) return;
  const me = document.createElement('button');
  me.type = 'button';
  me.className = 'side-me';
  me.title = 'Your status and profile';
  me.innerHTML = '<span class="side-me-av"></span><span class="side-me-text"><span class="side-me-name"></span><span class="side-me-sub"></span></span>';
  foot.appendChild(me);
  const av = me.querySelector('.side-me-av'), nameEl = me.querySelector('.side-me-name'), sub = me.querySelector('.side-me-sub');
  // Your status (js/06-prefs.js klabStatus), then your profile. Each row
  // has its colour's dot, and the one you're on a check at the right. Do
  // not disturb asks for how long (a second menu in the same place).
  const DOT = { '': 'st-on', away: 'st-away', dnd: 'st-dnd', invisible: 'st-off' };
  const check = on => on ? (row => row.insertAdjacentHTML('beforeend', '<i class="ti ti-check ctx-check" aria-hidden="true"></i>')) : null;
  window.klabStatusMenu = function(anchor) {
    const user = window.KLAB_USER?.username, now = klabStatus(), until = klabStatusUntil();
    klabMenu.at(anchor, [
      { section: 'Status' },
      ...Object.entries(KLAB_STATUSES).map(([k, v]) => ({
        label: k === 'dnd' ? v.label + '…' : v.label, icon: 'k-st-dot ' + DOT[k],
        hint: k === now && until ? 'Until ' + klabStatusTime(until) : '',
        ref: check(k === now),
        action: () => k === 'dnd' ? setTimeout(() => klabDndMenu(anchor)) : (setKlabStatus(k), paint()),
      })),
      '-',
      { label: 'Your profile', icon: 'ti-user', action: () => user && typeof openProfileView === 'function' && openProfileView(user) },
    ], { align: 'start' });
  };
  me.addEventListener('click', () => { SFX && SFX.play('click'); window.klabStatusMenu(me); });
  window.addEventListener('klab:status', () => paint());

  let lastAv;
  function paint() {
    const user = window.KLAB_USER?.username;
    if (!user || user === 'anonymous') { me.hidden = true; return; }
    me.hidden = false;
    nameEl.textContent = user;
    try { me.style.setProperty('--me-color', profileColor(user)); } catch (e) {}
    const url = window.klabResolveUserAvatar?.(user) || null;
    if (url !== lastAv) {
      lastAv = url;
      av.innerHTML = url ? '<img src="' + esc(url) + '" alt="" />' : esc(user[0].toUpperCase());
    }
    // Your note, not the song: the player is right underneath.
    const st = klabStatus();
    me.dataset.status = st;
    const until = st && klabStatusUntil();
    sub.textContent = st ? KLAB_STATUSES[st].label + (until ? ' · until ' + klabStatusTime(until) : '') : window.klabMyNote?.() || 'Online';
  }
  // Your picture and note arrive on their own time.
  let tries = 0;
  (function again() { paint(); if (++tries < 8) setTimeout(again, tries * 1000); })();
  setInterval(() => { if (!document.hidden) paint(); }, 30000);
  window.addEventListener('klab:me', paint); // your note or picture changed
})();

// ── Album art you can almost pick up ──
// Covers lean toward the pointer, with a little light catching them. One
// listener for the page; only transform and a gradient's position change.
(function() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const SEL = '.mh-card-art, .picker-list-grid .picker-item-art:not(.artist)';
  const calm = () => window.KLAB_FX?.on() || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let el = null, raf = 0, last = null;
  function release() {
    if (!el) return;
    el.classList.remove('tilting');
    el.style.removeProperty('--tx'); el.style.removeProperty('--ty');
    el = null;
  }
  document.addEventListener('pointermove', e => {
    last = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const t = last.target.closest?.(SEL);
      if (t !== el) release();
      if (!t || calm()) return;
      el = t;
      const r = t.getBoundingClientRect();
      const x = (last.clientX - r.left) / r.width, y = (last.clientY - r.top) / r.height;
      t.classList.add('tilting', 'klab-tilt');
      t.style.setProperty('--tx', (x - 0.5).toFixed(3));
      t.style.setProperty('--ty', (y - 0.5).toFixed(3));
    });
  }, { passive: true });
  document.addEventListener('pointerleave', release);
  window.addEventListener('blur', release);
})();

// The feed's composer keeps its formatting buttons out while it's empty
// and you're elsewhere (the CSS); a draft keeps them.
(function() {
  const box = document.getElementById('feedComposer'), ta = document.getElementById('feedComposerText');
  if (!box || !ta) return;
  const sync = () => box.classList.toggle('has-text', !!ta.value.trim());
  ['input', 'change', 'focusout'].forEach(e => ta.addEventListener(e, sync));
  sync();
})();
