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
    { sel: '.hm-tile', at: 'top', x: 0.7, any: true },
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
    if (spot.at === 'top') { x = r.left + (r.width - w) * spot.x; y = r.top - h - 1; }
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
  // Between visits, one timer: the first a couple of minutes into
  // listening, then every several minutes, and never while paused.
  let first = true;
  function plan() {
    clearTimeout(next);
    if (!playing()) return;
    next = setTimeout(() => {
      if (playing() && !document.hidden && !visit()) { plan(); return; }
      first = false;
    }, first ? rand(90e3, 240e3) : rand(240e3, 600e3));
  }
  ['play', 'pause', 'ended', 'emptied'].forEach(e => audio.addEventListener(e, () => { if (!spot) plan(); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  el.addEventListener('click', () => { SFX && SFX.play('star'); leave(true); });
  window.addEventListener('resize', () => { if (spot) place(); });
  window.addEventListener('scroll', () => { if (spot && !place()) leave(); }, { passive: true, capture: true });
  // For testing, and for anyone who reads the source: klabDancer.summon().
  window.klabDancer = { summon: i => visit(i), leave: () => leave() };
})();

(function() {
  const audio = playerState?.audio;
  if (!audio) return;

  // ── You ──
  const foot = document.querySelector('#sideNav .side-nav-foot');
  if (!foot) return;
  const me = document.createElement('button');
  me.type = 'button';
  me.className = 'side-me';
  me.title = 'Your profile';
  me.innerHTML = '<span class="side-me-av"></span><span class="side-me-text"><span class="side-me-name"></span><span class="side-me-sub"></span></span>';
  foot.appendChild(me);
  const av = me.querySelector('.side-me-av'), nameEl = me.querySelector('.side-me-name'), sub = me.querySelector('.side-me-sub');
  me.addEventListener('click', () => {
    SFX && SFX.play('click');
    const user = window.KLAB_USER?.username;
    if (user && typeof openProfileView === 'function') openProfileView(user);
  });

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
    const song = playerState.currentSong;
    sub.classList.toggle('playing', !!song && !audio.paused);
    sub.textContent = song && !audio.paused ? song.title || '' : (window.klabMyNote?.() || (song ? 'Paused' : 'Online'));
  }
  ['play', 'pause', 'ended', 'emptied', 'loadstart'].forEach(e => audio.addEventListener(e, paint));
  // Your picture and note arrive on their own time.
  let tries = 0;
  (function again() { paint(); if (++tries < 8) setTimeout(again, tries * 1000); })();
  setInterval(() => { if (!document.hidden) paint(); }, 30000);
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
