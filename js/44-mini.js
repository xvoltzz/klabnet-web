// ══════════════════════════════════════════
//  THE MINI PLAYER AND POP OUT (2026-11-20)
//  The owner: "a pip feature would be cool too, so u can pop it out if u
//  want to. keep watching wherever".
//    · Leaving a video (or a TV channel) while it plays doesn't stop it:
//      its player (the same element: the same <video>, the same hls.js, so
//      nothing rebuffers) flies into a small window at a corner of this
//      one, over every page. 39-videos.js and 40-tv.js own their players
//      and hand them here with take(); expand gives the player back to its
//      page (give()), ✕ asks the owner to stop.
//    · Drag it to any corner (kept, klabnet_mini), resize it by its inner
//      corner. Hover shows the few controls it needs. It isn't a layer
//      (nothing modal); Escape with it focused closes it.
//    · Pop out: Chrome's Document Picture-in-Picture, an always-on-top
//      window of its own with klabnet's controls inside (popOut()): the
//      player moves there with the page's styles copied in, and comes back
//      when that window closes. Elsewhere, the browser's own picture in
//      picture of the <video>.
//    · Not on a phone's small layout: there the system's picture in
//      picture is the way (canTake() says no).
//  window.klabMini: take(o), give(slot), close(), active(), paint(),
//  canTake(), yield(kind), popOut(o), popped().
// ══════════════════════════════════════════
(function () {
  const KEY = 'klabnet_mini';
  const MIN_W = 240, MAX_W = 560;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
  let corner = /^(tl|tr|bl|br)$/.test(saved.corner) ? saved.corner : 'br';
  let width = Math.min(MAX_W, Math.max(MIN_W, +saved.w || 320));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ corner, w: Math.round(width) })); } catch {} };
  const motion = () => (typeof klabMotionOk === 'function' ? klabMotionOk() : true);
  const phone = () => matchMedia(KLAB_PHONE_MQ).matches;
  // Settings → General: "Keep playing in a mini player when I leave a video".
  const enabled = () => (typeof _settings === 'undefined' || _settings.videoMini !== false);

  let host = null, slot = null, cur = null;

  function build() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'vmini';
    host.hidden = true;
    host.tabIndex = -1;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Mini player');
    host.innerHTML =
      '<div class="vmini-slot"></div>' +
      '<div class="vmini-ui">' +
        '<div class="vmini-top">' +
          '<button type="button" class="k-icon sm on-media" data-mini="expand" title="Back to the video" aria-label="Back to the video" data-silent><i class="ti ti-arrows-diagonal"></i></button>' +
          '<span class="vmini-tx"><b class="vmini-title"></b><span class="vmini-sub"></span></span>' +
          '<button type="button" class="k-icon sm on-media" data-mini="pop" title="Pop out" aria-label="Pop out" data-silent><i class="ti ti-picture-in-picture-top"></i></button>' +
          '<button type="button" class="k-icon sm on-media" data-mini="close" title="Close (Esc)" aria-label="Close" data-silent><i class="ti ti-x"></i></button>' +
        '</div>' +
        '<div class="vmini-mid">' +
          '<button type="button" class="k-icon on-media vmini-side" data-mini="prev" data-silent></button>' +
          '<button type="button" class="k-icon lg on-media vmini-play" data-mini="play" aria-label="Play" data-silent><i class="ti ti-player-play-filled"></i></button>' +
          '<button type="button" class="k-icon on-media vmini-side" data-mini="next" data-silent></button>' +
        '</div>' +
        '<div class="vmini-bar"><b></b></div>' +
      '</div>' +
      '<span class="vmini-grip" aria-hidden="true"></span>';
    slot = host.querySelector('.vmini-slot');
    document.body.appendChild(host);
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-mini]');
      if (!b || !cur) return;
      e.stopPropagation();
      const k = b.dataset.mini, c = cur.ctl || {};
      if (k === 'play') c.toggle?.();
      else if (k === 'prev') (cur.kind === 'tv' ? c.down : c.back)?.();
      else if (k === 'next') (cur.kind === 'tv' ? c.up : c.fwd)?.();
      else if (k === 'expand') { SFX && SFX.play('nav'); cur.expand?.(); }
      else if (k === 'pop') cur.popout?.();
      else if (k === 'close') { SFX && SFX.play('nav_back'); close(); }
      paint();
    });
    // A press on the picture itself plays or pauses (not after a drag).
    host.addEventListener('keydown', e => {
      if (!cur) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
      const c = cur.ctl || {};
      let done = true;
      if (e.key === ' ' || e.key === 'k') c.toggle?.();
      else if (e.key === 'ArrowLeft' || e.key === 'j') (cur.kind === 'tv' ? null : c.back)?.();
      else if (e.key === 'ArrowRight' || e.key === 'l') (cur.kind === 'tv' ? null : c.fwd)?.();
      else if (e.key === 'PageUp' || e.key === 'ArrowUp') (cur.kind === 'tv' ? c.up : null)?.();
      else if (e.key === 'PageDown' || e.key === 'ArrowDown') (cur.kind === 'tv' ? c.down : null)?.();
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); paint(); }
    }, true);
    drag();
    resize();
    addEventListener('resize', () => { if (cur) place(); });
    // The dock coming and going (Music shows it, other pages tuck it away):
    // the corner moves clear of it.
    let replaceT = 0;
    const mo = new MutationObserver(() => {
      if (!cur || host.classList.contains('dragging')) return;
      clearTimeout(replaceT);
      requestAnimationFrame(() => { if (cur) place(); });
      replaceT = setTimeout(() => { if (cur) place(); setTimeout(() => { if (cur && !host.classList.contains('dragging')) place(); }, 600); }, 360);
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const dockEl = document.getElementById('playerDock');
    if (dockEl) {
      mo.observe(dockEl, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      dockEl.addEventListener('transitionend', e => { if (cur && e.target === dockEl && !host.classList.contains('dragging')) place(); });
    }
  }

  // ── Where it sits: a corner, clear of the title bar and the dock ──
  function box() {
    const h = width * 9 / 16;
    const top = (document.querySelector('header.header')?.getBoundingClientRect().bottom || 56) + 12;
    // Above the dock where it shows (Music, or brought up over a page).
    let bottom = 16;
    const dock = document.getElementById('playerDock');
    if (dock) {
      const r = dock.getBoundingClientRect();
      if (r.height && r.top < innerHeight - 4 && r.bottom > 0 && getComputedStyle(dock).visibility !== 'hidden') bottom = Math.max(16, innerHeight - r.top + 12);
    }
    const side = 16;
    const nav = document.getElementById('sideNav')?.getBoundingClientRect();
    const x = corner[1] === 'l' ? side + (nav && nav.right > 0 && nav.width ? nav.right : 0) : innerWidth - width - side;
    const y = corner[0] === 't' ? top : innerHeight - h - bottom;
    return { x: Math.max(8, x), y: Math.max(8, y), w: width, h };
  }
  function place() {
    const b = box();
    host.style.left = b.x + 'px'; host.style.top = b.y + 'px';
    host.style.width = b.w + 'px'; host.style.height = b.h + 'px';
    host.dataset.corner = corner;
  }

  // FLIP: drawn where it ends up, transformed back to where it was, then let go.
  function flipFrom(r, after) {
    if (!r || !r.width || !motion()) { after?.(); return; }
    const to = host.getBoundingClientRect();
    host.style.transition = 'none';
    host.style.transformOrigin = '0 0';
    host.style.transform = `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${r.width / to.width}, ${r.height / to.height})`;
    host.getBoundingClientRect();
    host.style.transition = 'transform 220ms var(--m-ease, cubic-bezier(.2,.8,.2,1))';
    host.style.transform = '';
    let done = false;
    const end = () => { if (done) return; done = true; host.style.transition = ''; host.style.transformOrigin = ''; after?.(); };
    host.addEventListener('transitionend', end, { once: true });
    setTimeout(end, 300);
  }
  function flipTo(r, after) {
    if (!r || !r.width || !motion()) { after(); return; }
    const from = host.getBoundingClientRect();
    host.style.transformOrigin = '0 0';
    host.style.transition = 'transform 220ms var(--m-ease, cubic-bezier(.2,.8,.2,1))';
    host.style.transform = `translate(${r.left - from.left}px, ${r.top - from.top}px) scale(${r.width / from.width}, ${r.height / from.height})`;
    let done = false;
    const end = () => { if (done) return; done = true; host.style.transition = 'none'; host.style.transform = ''; host.style.transformOrigin = ''; after(); requestAnimationFrame(() => { if (host) host.style.transition = ''; }); };
    host.addEventListener('transitionend', end, { once: true });
    setTimeout(end, 300);
  }

  // ── Taking a player, and giving it back ──
  function canTake() { return enabled() && !phone(); }
  // o: { el, kind: 'video'|'tv', from (DOMRect), title, sub, ctl: { paused(),
  //   toggle(), back(), fwd(), up(), down(), progress() }, expand(), close(), popout() }
  function take(o) {
    if (!canTake() || !o || !o.el) return false;
    build();
    if (cur && cur.el !== o.el) close();
    cur = o;
    host.dataset.kind = o.kind;
    o.el.classList.add('in-mini');
    slot.appendChild(o.el);
    host.hidden = false;
    place();
    paint();
    flipFrom(o.from);
    return true;
  }
  // The player back onto its page, in place of `to` (a placeholder there).
  function give(to) {
    if (!cur || !to) return false;
    const c = cur;
    cur = null;
    const r = to.getBoundingClientRect();
    flipTo(r, () => {
      // Taken into the corner again during the flip: it stays there.
      if (cur && cur.el === c.el) return;
      c.el.classList.remove('in-mini');
      if (to.isConnected) to.replaceWith(c.el);
      else {
        // The page it was going back to went meanwhile: it stops, as ✕ does,
        // rather than playing on detached.
        try { c.close?.(); } catch (e) { console.warn('mini:', e); }
        if (c.el.parentNode === slot) c.el.remove();
      }
      if (!cur) host.hidden = true;
    });
    return true;
  }
  // ✕: the owner stops it (and lets go of it).
  function close() {
    if (!cur) return;
    const c = cur;
    cur = null;
    host.hidden = true;
    c.el.classList.remove('in-mini');
    try { c.close?.(); } catch (e) { console.warn('mini:', e); }
    if (c.el.parentNode === slot) c.el.remove();
  }
  // The owner taking it back itself (a new video, a hard stop).
  function drop(el) {
    if (!cur || (el && cur.el !== el)) return;
    const c = cur;
    cur = null;
    host.hidden = true;
    c.el.classList.remove('in-mini');
    if (c.el.parentNode === slot) c.el.remove();
  }

  function paint() {
    if (!cur || !host) return;
    const c = cur.ctl || {};
    const paused = c.paused ? c.paused() : false;
    const play = host.querySelector('[data-mini="play"]');
    play.innerHTML = '<i class="ti ' + (paused ? 'ti-player-play-filled' : 'ti-player-pause-filled') + '"></i>';
    play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    host.classList.toggle('paused', !!paused);
    host.querySelector('.vmini-title').textContent = cur.title?.() ?? '';
    host.querySelector('.vmini-sub').textContent = cur.sub?.() ?? '';
    const tv = cur.kind === 'tv';
    const prev = host.querySelector('[data-mini="prev"]'), next = host.querySelector('[data-mini="next"]');
    prev.innerHTML = '<i class="ti ' + (tv ? 'ti-chevron-down' : 'ti-rotate-2') + '"></i>';
    next.innerHTML = '<i class="ti ' + (tv ? 'ti-chevron-up' : 'ti-rotate-clockwise-2') + '"></i>';
    prev.title = tv ? 'Channel down' : 'Back 10s'; next.title = tv ? 'Channel up' : 'Forward 10s';
    prev.setAttribute('aria-label', prev.title); next.setAttribute('aria-label', next.title);
    const f = c.progress ? c.progress() : null;
    const bar = host.querySelector('.vmini-bar');
    bar.hidden = f == null;
    if (f != null) bar.firstElementChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, f)).toFixed(4) + ')';
    host.querySelector('[data-mini="pop"]').hidden = !cur.popout;
  }

  // ── Dragging to a corner ──
  function drag() {
    let start = null;
    host.addEventListener('pointerdown', e => {
      if (!cur || e.button !== 0 || e.target.closest('button, .vmini-grip, input')) return;
      const r = host.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false, id: e.pointerId };
    });
    host.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 5) return;
      if (!start.moved) { start.moved = true; host.setPointerCapture(e.pointerId); host.classList.add('dragging'); }
      host.style.left = Math.min(innerWidth - 40, Math.max(-host.offsetWidth + 40, start.l + dx)) + 'px';
      host.style.top = Math.min(innerHeight - 40, Math.max(0, start.t + dy)) + 'px';
    });
    const end = e => {
      if (!start) return;
      const s = start;
      start = null;
      if (!s.moved) {
        // A press on the picture: play or pause.
        if (e.type === 'pointerup' && !e.target.closest('button')) { cur?.ctl?.toggle?.(); paint(); }
        return;
      }
      host.classList.remove('dragging');
      const r = host.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      corner = (cy < innerHeight / 2 ? 't' : 'b') + (cx < innerWidth / 2 ? 'l' : 'r');
      save();
      const from = host.getBoundingClientRect();
      place();
      flipFrom(from);
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  }
  // ── Resizing by the inner corner (16:9 kept) ──
  function resize() {
    const grip = host.querySelector('.vmini-grip');
    let s = null;
    grip.addEventListener('pointerdown', e => {
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      s = { x: e.clientX, w: width };
      host.classList.add('sizing');
    });
    grip.addEventListener('pointermove', e => {
      if (!s) return;
      const dx = e.clientX - s.x;
      width = Math.min(MAX_W, Math.max(MIN_W, s.w + (corner[1] === 'r' ? -dx : dx)));
      place();
    });
    const end = () => { if (!s) return; s = null; host.classList.remove('sizing'); save(); };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => { width = 320; place(); save(); });
  }

  // ── Pop out: an always-on-top window (Document Picture-in-Picture) ──
  let pip = null; // { win, el, back }
  const docPip = () => 'documentPictureInPicture' in window;
  function copyStyles(doc) {
    for (const sheet of [...document.styleSheets]) {
      try {
        const css = [...sheet.cssRules].map(r => r.cssText).join('\n');
        const st = doc.createElement('style');
        st.textContent = css;
        doc.head.appendChild(st);
      } catch {
        if (sheet.href) {
          const l = doc.createElement('link');
          l.rel = 'stylesheet'; l.href = sheet.href;
          doc.head.appendChild(l);
        }
      }
    }
    const root = document.documentElement, pr = doc.documentElement;
    for (const a of root.attributes) if (a.name !== 'id') pr.setAttribute(a.name, a.value);
    pr.style.cssText = root.style.cssText;
    doc.body.className = 'vpip-body';
  }
  // o: { el, video (for the fallback), width, height, title, keys(e), back(el) }
  // Resolves 'window' (Document PiP), 'video' (the browser's own) or ''.
  async function popOut(o) {
    if (pip && pip.el === o.el) { try { pip.win.focus(); } catch {} return 'window'; }
    // Another player in the window (TV popped out, then a video): that
    // one's window closes (its pagehide hands it back to its owner) and
    // this one opens. It used to say 'window' without moving anything, so
    // the caller left its player on the page marked as popped out.
    if (pip) { try { pip.win.close(); } catch {} }
    if (docPip()) {
      let win;
      try {
        const vw = o.video?.videoWidth || 16, vh = o.video?.videoHeight || 9;
        const w = Math.min(640, Math.max(320, o.width || 480));
        win = await window.documentPictureInPicture.requestWindow({ width: Math.round(w), height: Math.round(w * vh / vw) });
      } catch (e) {
        console.warn('pop out:', e);
        win = null;
      }
      if (win) {
        copyStyles(win.document);
        win.document.title = o.title || 'klabnet';
        const el = o.el;
        // Moving a media element to another document pauses it: it plays on there.
        const was = o.video && !o.video.paused;
        el.classList.remove('in-mini');
        el.classList.add('in-pip');
        win.document.body.appendChild(el);
        if (was) o.video.play().catch(() => {});
        el.focus?.({ preventScroll: true });
        win.document.addEventListener('keydown', e => o.keys?.(e));
        const mine = pip = { win, el, back: o.back, video: o.video };
        win.addEventListener('pagehide', () => {
          // This window's own entry: an older window closing late must not
          // take the newer one's player back out of it.
          const p = mine;
          if (pip === mine) pip = null;
          if (p.done) return;
          p.done = true;
          p.el.classList.remove('in-pip');
          // Back on this page (adopted here, so it keeps playing).
          const was = p.video && !p.video.paused && !p.video.ended;
          document.adoptNode?.(p.el);
          if (was) p.video.play().catch(() => {});
          try { p.back?.(p.el); } catch (e) { console.warn('pop in:', e); }
        }, { once: true });
        return 'window';
      }
    }
    const v = o.video;
    if (v && document.pictureInPictureEnabled) {
      try { await v.requestPictureInPicture(); return 'video'; } catch (e) { console.warn('pip:', e); }
    }
    showToast('This browser can’t pop a video out', 'ti-picture-in-picture');
    return '';
  }
  // Closing the window from here (its pagehide still brings the player back).
  function popIn() { if (pip) { try { pip.win.close(); } catch {} } }

  window.klabMini = {
    take, give, close, drop, paint, canTake, popOut, popIn,
    active: () => cur,
    popped: () => (pip ? pip.el : null),
    docPip,
    // A player of another kind starting (a video while TV's in the corner): that one goes.
    yield: kind => { if (cur && cur.kind !== kind) close(); },
  };

  // ── Settings → General ──
  const toggle = document.getElementById('videoMiniToggle');
  if (toggle) {
    const sync = () => { const on = enabled(); toggle.classList.toggle('on', on); toggle.setAttribute('aria-checked', String(on)); };
    sync();
    document.getElementById('settingsBtn')?.addEventListener('click', () => setTimeout(sync, 0));
    toggle.addEventListener('click', () => {
      // The house switch handler (07-tabnav.js) has flipped .on already.
      _settings.videoMini = toggle.classList.contains('on');
      toggle.setAttribute('aria-checked', String(_settings.videoMini));
      saveSettings();
      if (!_settings.videoMini && cur) close();
    });
  }
})();
