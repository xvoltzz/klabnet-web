// ══════════════════════════════════════════
//  MUSIC HOME — the Music tab's Home view, as a front page for the library
//  rather than a list of random songs:
//    Recently added   a Cover Flow of the newest albums
//    Jump back in     albums from your own play history
//    Most played      the library's most-played albums (every visitor plays
//                     through the one shared Navidrome account, so this is
//                     site-wide)
//    Shuffle picks    the random songs Home used to be, as a wheel you spin,
//                     with a reshuffle
//  loadPickerTab('random') hands its songs to klabRenderMusicHome().
// ══════════════════════════════════════════
(function() {
  const REFRESH_MS = 10 * 60 * 1000;
  const art = (id, size) => `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}`;

  async function albumList(type, size) {
    const r = await fetchTimeout(`${ND_URL}/rest/getAlbumList2?type=${type}&size=${size}&${subsonicParams()}`, {}, 8000);
    return (await r.json())['subsonic-response']?.albumList2?.album || [];
  }

  async function playAlbum(albumId) {
    try {
      const r = await fetchTimeout(`${ND_URL}/rest/getAlbum?id=${encodeURIComponent(albumId)}&${subsonicParams()}`, {}, 8000);
      const songs = (await r.json())['subsonic-response']?.album?.song || [];
      if (!songs.length) return;
      playerState.playlist = songs; playerState.playlistIndex = 0;
      playSong(songs[0]);
      SFX && SFX.play('click');
    } catch (e) { showToast('couldn’t play that album', 'ti-alert-triangle'); }
  }
  const openAlbum = a => window.openAlbumPage && window.openAlbumPage(a.id, a.name || a.title);

  function fmtAdded(iso) {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 1) return 'added today';
    if (days < 2) return 'added yesterday';
    if (days < 30) return `added ${days} days ago`;
    return 'added ' + new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ══ Cover Flow ══
  // One element for the life of the page: re-inserted each time Home
  // renders, so it keeps its place and its covers instead of reloading.
  const flow = (() => {
    const el = document.createElement('section');
    el.className = 'mh-flow';
    el.tabIndex = 0;
    el.setAttribute('aria-label', 'Recently added albums');
    el.innerHTML =
      '<div class="mh-flow-bg"></div><div class="mh-flow-bg"></div>' +
      '<div class="mh-flow-stage"></div>' +
      '<button type="button" class="mh-flow-nav prev" title="Previous"><i class="ti ti-chevron-left"></i></button>' +
      '<button type="button" class="mh-flow-nav next" title="Next"><i class="ti ti-chevron-right"></i></button>' +
      '<div class="mh-flow-caption"><div class="t"></div><div class="a"></div>' +
        '<div class="mh-flow-actions"><button type="button" class="mh-flow-play"><i class="ti ti-player-play-filled"></i> Play</button>' +
        '<button type="button" class="mh-flow-open">Open album</button></div></div>';
    const stage = el.querySelector('.mh-flow-stage');
    const bgs = el.querySelectorAll('.mh-flow-bg');
    let albums = [], covers = [], loadedAt = 0;
    let pos = 0, target = 0, raf = 0, idle = 0, center = -1, bgOn = 0;

    const size = () => (matchMedia('(max-width: 760px)').matches ? 150 : 230);
    const clamp = x => Math.max(0, Math.min(albums.length - 1, x));

    function build() {
      stage.textContent = '';
      covers = albums.map((a, i) => {
        const c = document.createElement('div');
        c.className = 'mh-cover';
        c.dataset.i = i;
        const img = new Image();
        img.alt = ''; img.draggable = false; img.decoding = 'async';
        img.onload = () => img.classList.add('loaded');
        img.src = art(a.coverArt || a.id, 500);
        c.appendChild(img);
        stage.appendChild(c);
        return c;
      });
      center = -1;
      render();
    }

    // Each cover's place is a function of its distance from the centre, d:
    // the middle one faces you, the rest fold back at an angle and stack.
    function render() {
      const S = size();
      stage.style.setProperty('--mh-size', S + 'px');
      el.style.setProperty('--mh-h', S + 'px');
      el.style.setProperty('--mh-size', S + 'px');
      for (let i = 0; i < covers.length; i++) {
        const c = covers[i];
        const d = i - pos, ad = Math.abs(d), sg = Math.sign(d);
        if (ad > 7) { if (c._on !== false) { c.style.display = 'none'; c._on = false; } continue; }
        if (c._on !== true) { c.style.display = ''; c._on = true; }
        let x, rot, z;
        if (ad < 1) { x = d * S * 0.66; rot = -d * 62; z = -ad * S * 0.55; }
        else { x = sg * (S * 0.66 + (ad - 1) * S * 0.24); rot = -sg * 62; z = -S * 0.55; }
        c.style.transform = `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${rot.toFixed(1)}deg)`;
        c.style.zIndex = String(100 - Math.round(ad * 10));
        c.style.opacity = ad > 6 ? String(Math.max(0, 7 - ad)) : '';
      }
      const ci = Math.round(pos);
      if (ci !== center && albums[ci]) {
        center = ci;
        covers.forEach((c, i) => c.classList.toggle('center', i === ci));
        const a = albums[ci];
        el.querySelector('.mh-flow-caption .t').textContent = a.name || a.title || '';
        el.querySelector('.mh-flow-caption .a').textContent = [a.artist, a.year, fmtAdded(a.created)].filter(Boolean).join(' · ');
      }
    }

    // The blurred cover behind the flow, crossfaded once it comes to rest
    // (a full-width blur repainted every frame is the expensive thing here).
    function setBg() {
      const a = albums[center];
      if (!a) return;
      const next = bgs[1 - bgOn];
      next.style.backgroundImage = `url("${art(a.coverArt || a.id, 200)}")`;
      window.klabSoften?.(next);
      next.classList.add('on');
      bgs[bgOn].classList.remove('on');
      bgOn = 1 - bgOn;
    }

    function tick() {
      const d = target - pos;
      pos = Math.abs(d) < 0.002 ? target : pos + d * 0.2;
      render();
      raf = pos !== target ? requestAnimationFrame(tick) : 0;
      if (!raf) setBg();
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    function go(i) { target = clamp(Math.round(i)); kick(); }

    el.querySelector('.prev').addEventListener('click', () => go(target - 1));
    el.querySelector('.next').addEventListener('click', () => go(target + 1));
    el.querySelector('.mh-flow-play').addEventListener('click', () => albums[center] && playAlbum(albums[center].id));
    el.querySelector('.mh-flow-open').addEventListener('click', () => albums[center] && openAlbum(albums[center]));

    // Sideways trackpad swipes glide through it. A vertical wheel is left
    // alone, so a mouse still scrolls the page past it.
    el.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      target = clamp(target + e.deltaX / (size() * 0.45));
      kick();
      clearTimeout(idle);
      idle = setTimeout(() => go(target), 140);
    }, { passive: false });

    // Drag it; a tap on a side cover brings it to the middle, a tap on the
    // middle one opens it.
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, start: target, moved: false, id: e.pointerId, z: zoomFactor() };
    });
    // Released outside the stage without having dragged: forget the press.
    window.addEventListener('pointerup', () => { if (drag && !drag.moved) drag = null; });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / drag.z; // pointer px are zoomed on big screens
      if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; stage.setPointerCapture(drag.id); el.classList.add('dragging'); }
      if (!drag.moved) return;
      target = clamp(drag.start - dx / (size() * 0.45));
      kick();
    });
    const end = e => {
      if (!drag) return;
      el.classList.remove('dragging');
      if (drag.moved) go(target);
      else {
        const c = e.target.closest('.mh-cover');
        if (c) {
          const i = Number(c.dataset.i);
          if (i === center) openAlbum(albums[i]); else go(i);
        }
      }
      drag = null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    // Arrow keys while it has focus. Stopped here so they don't also skip
    // tracks, which is what ←/→ do everywhere else.
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') go(target - 1);
      else if (e.key === 'ArrowRight') go(target + 1);
      else if (e.key === 'Enter' && albums[center]) openAlbum(albums[center]);
      else return;
      e.preventDefault(); e.stopPropagation();
    });

    window.addEventListener('resize', () => { if (el.isConnected) render(); });

    async function load() {
      if (albums.length && Date.now() - loadedAt < REFRESH_MS) { render(); return; }
      try {
        const fresh = await albumList('newest', 30);
        loadedAt = Date.now();
        const same = fresh.map(a => a.id).join() === albums.map(a => a.id).join();
        albums = fresh;
        el.hidden = !albums.length;
        if (!same) { pos = target = 0; build(); setBg(); }
      } catch (e) { if (!albums.length) el.hidden = true; }
    }
    return { el, load };
  })();

  // ══ Album rows ══
  function albumRow(title, albums, note) {
    const sec = document.createElement('section');
    sec.className = 'mh-section';
    sec.innerHTML = `<div class="picker-section-label">${esc(title)}${note ? ` <span class="mh-note">${esc(note)}</span>` : ''}</div>` +
      '<div class="mh-row-wrap"><div class="mh-row"></div>' +
      '<button type="button" class="mh-row-nav prev" title="Back"><i class="ti ti-chevron-left"></i></button>' +
      '<button type="button" class="mh-row-nav next" title="More"><i class="ti ti-chevron-right"></i></button></div>';
    const row = sec.querySelector('.mh-row');
    const wrap = sec.querySelector('.mh-row-wrap');
    // Which edges have more to scroll to: drives the arrows and the fades.
    const edges = () => {
      wrap.classList.toggle('more-l', row.scrollLeft > 4);
      wrap.classList.toggle('more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    };
    row.addEventListener('scroll', edges, { passive: true });
    new ResizeObserver(edges).observe(row);
    const page = dir => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
    sec.querySelector('.mh-row-nav.prev').addEventListener('click', () => page(-1));
    sec.querySelector('.mh-row-nav.next').addEventListener('click', () => page(1));
    albums.forEach(a => {
      const card = document.createElement('div');
      card.className = 'mh-card';
      card.innerHTML =
        `<div class="mh-card-art"><img src="${esc(art(a.coverArt || a.id, 300))}" alt="" loading="lazy" decoding="async" draggable="false" onload="this.classList.add('loaded')" />` +
        `<button type="button" class="mh-card-play" title="Play"><i class="ti ti-player-play-filled"></i></button></div>` +
        `<div class="mh-card-t">${esc(a.name || a.title || '')}</div><div class="mh-card-a">${esc(a.artist || '')}</div>`;
      card.addEventListener('click', e => {
        if (e.target.closest('.mh-card-play')) { playAlbum(a.id); return; }
        openAlbum(a);
      });
      row.appendChild(card);
    });
    return sec;
  }

  // Albums from this browser's own play history, most recent first.
  function jumpBackIn() {
    const seen = new Set(), out = [];
    for (const s of getPlayHistory()) {
      if (!s.albumId || seen.has(s.albumId)) continue;
      seen.add(s.albumId);
      out.push({ id: s.albumId, name: s.album, artist: s.artist, coverArt: s.coverArt || s.albumId });
      if (out.length >= 16) break;
    }
    return out;
  }

  // ══ Shuffle wheel ══
  // Shuffle picks as a prize wheel: a slice of album art per song, a
  // pointer at the top that flaps and ticks as slices go by. Spin it (the
  // hub, a tap, or a flick) and whatever it lands on plays, with the rest
  // of the picks queued after it.
  const WHEEL_MAX = 12;
  const TAU = Math.PI * 2;
  const mod = (x, m) => ((x % m) + m) % m;

  function shuffleWheel(allSongs) {
    // Distinct covers first, so neighbouring slices don't look identical.
    const seen = new Set(), songs = [];
    for (const s of allSongs) if (songs.length < WHEEL_MAX && !seen.has(s.coverArt)) { seen.add(s.coverArt); songs.push(s); }
    for (const s of allSongs) if (songs.length < WHEEL_MAX && !songs.includes(s)) songs.push(s);
    const n = songs.length, slice = TAU / n;

    const el = document.createElement('section');
    el.className = 'mh-wheel';
    el.innerHTML =
      '<div class="mh-wheel-stage">' +
        '<canvas class="mh-wheel-canvas" role="img"></canvas>' +
        '<div class="mh-wheel-pointer" aria-hidden="true"></div>' +
        '<button type="button" class="mh-wheel-spin">SPIN</button>' +
      '</div>' +
      '<div class="mh-wheel-result" aria-live="polite">' +
        '<div class="k">Spin the wheel</div>' +
        '<div class="mh-wheel-pick"><img class="mh-wheel-art" alt="" hidden />' +
          '<div class="mh-wheel-tx"><div class="t"></div><div class="a"></div></div></div>' +
        '<div class="mh-flow-actions" hidden><button type="button" class="mh-flow-play"><i class="ti ti-player-play-filled"></i> Play</button>' +
          '<button type="button" class="mh-wheel-open">Open album</button></div>' +
      '</div>';
    const stage = el.querySelector('.mh-wheel-stage');
    const canvas = el.querySelector('canvas');
    const pointer = el.querySelector('.mh-wheel-pointer');
    const spinBtn = el.querySelector('.mh-wheel-spin');
    const kEl = el.querySelector('.k'), tEl = el.querySelector('.t'), aEl = el.querySelector('.a');
    const artEl = el.querySelector('.mh-wheel-art'), actions = el.querySelector('.mh-flow-actions');
    const g = canvas.getContext('2d');
    canvas.setAttribute('aria-label', `Shuffle wheel with ${n} songs`);
    tEl.textContent = `${n} shuffle picks`;
    aEl.textContent = 'Hit spin, or give it a flick';

    let angle = Math.random() * TAU; // canvas radians; slice i starts at angle + i*slice
    let winner = -1, spinning = false, raf = 0, lastSeg = null, flap = null;
    let colors = null, px = 0;

    const imgs = songs.map(s => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (!spinning) draw(); };
      img.src = art(s.coverArt, 300);
      return img;
    });

    // The slice sitting under the pointer (straight up).
    const under = a => Math.floor(mod(-Math.PI / 2 - a, TAU) / slice) % n;

    function readColors() {
      const cs = getComputedStyle(el);
      const rgb = cs.getPropertyValue('--accent-rgb').trim() || '200,195,188';
      colors = { rgb, text: cs.getPropertyValue('--text').trim() || '#e8e6e1', bg: cs.getPropertyValue('--bg').trim() || '#000' };
    }

    function size() {
      const css = stage.clientWidth;
      if (!css) return false;
      const want = Math.round(css * (window.devicePixelRatio || 1));
      if (want !== px) { px = want; canvas.width = canvas.height = px; }
      return true;
    }

    function draw() {
      if (!size()) return;
      if (!colors) readColors();
      const c = px / 2, rim = px * 0.035, r = c - rim;
      g.clearRect(0, 0, px, px);

      for (let i = 0; i < n; i++) {
        const a0 = angle + i * slice, a1 = a0 + slice;
        g.save();
        g.beginPath(); g.moveTo(c, c); g.arc(c, c, r, a0, a1); g.closePath(); g.clip();
        g.fillStyle = `rgba(${colors.rgb},${i % 2 ? 0.16 : 0.07})`;
        g.fillRect(0, 0, px, px);
        const img = imgs[i];
        if (img.complete && img.naturalWidth) {
          // A square of art covering the wedge, its top pointing outward.
          const L = Math.max(r, 2 * r * Math.sin(Math.min(slice, Math.PI) / 2)) * 1.04;
          g.translate(c, c); g.rotate(a0 + slice / 2 + Math.PI / 2);
          g.drawImage(img, -L / 2, -r / 2 - L / 2, L, L);
        }
        g.restore();
        if (winner >= 0 && i !== winner) {
          g.save();
          g.beginPath(); g.moveTo(c, c); g.arc(c, c, r, a0, a1); g.closePath();
          g.fillStyle = 'rgba(0,0,0,.55)'; g.fill();
          g.restore();
        }
      }

      // Spokes between slices.
      g.save();
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = Math.max(1, px * 0.004);
      for (let i = 0; i < n; i++) {
        const a = angle + i * slice;
        g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke();
      }
      g.restore();

      // Soft shine across the top, like the rest of klabnet's glass.
      const shine = g.createLinearGradient(0, 0, 0, px);
      shine.addColorStop(0, 'rgba(255,255,255,.16)'); shine.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.beginPath(); g.arc(c, c, r, 0, TAU); g.fillStyle = shine; g.fill();

      // Rim, with a peg at every slice boundary.
      g.beginPath(); g.arc(c, c, r + rim / 2, 0, TAU);
      g.lineWidth = rim; g.strokeStyle = colors.text; g.stroke();
      g.beginPath(); g.arc(c, c, r, 0, TAU);
      g.lineWidth = Math.max(1, px * 0.004); g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
      g.fillStyle = colors.bg;
      for (let i = 0; i < n; i++) {
        const a = angle + i * slice;
        g.beginPath(); g.arc(c + Math.cos(a) * (r + rim / 2), c + Math.sin(a) * (r + rim / 2), rim * 0.28, 0, TAU); g.fill();
      }

      if (winner >= 0) {
        const a0 = angle + winner * slice;
        g.save();
        g.beginPath(); g.moveTo(c, c); g.arc(c, c, r, a0, a0 + slice); g.closePath();
        g.lineWidth = Math.max(2, px * 0.012); g.strokeStyle = `rgba(${colors.rgb},.95)`;
        g.shadowColor = `rgba(${colors.rgb},.8)`; g.shadowBlur = px * 0.03;
        g.stroke();
        g.restore();
      }
    }

    function showSong(s, label) {
      kEl.textContent = label;
      tEl.textContent = s.title || 'Unknown';
      aEl.textContent = [s.artist, s.album].filter(Boolean).join(' · ');
    }

    // Tick + flap each time a peg passes the pointer.
    function tickCheck() {
      const seg = under(angle);
      if (seg === lastSeg) return;
      lastSeg = seg;
      if (!spinning) return;
      SFX && SFX.play('tick');
      showSong(songs[seg], 'Spinning…');
      flap?.cancel();
      flap = pointer.animate?.([{ transform: 'rotate(-24deg)' }, { transform: 'rotate(0deg)' }], { duration: 140, easing: 'ease-out' });
    }

    // Ease-out quint: starts at 5×delta/duration rad/ms and settles slowly.
    function spinBy(delta, duration) {
      cancelAnimationFrame(raf);
      spinning = true; winner = -1; spinBtn.disabled = true;
      actions.hidden = true; artEl.hidden = true;
      const from = angle, t0 = performance.now();
      const step = now => {
        if (!el.isConnected) { spinning = false; return; }
        const t = Math.min(1, (now - t0) / duration);
        angle = from + delta * (1 - Math.pow(1 - t, 5));
        tickCheck();
        draw();
        if (t < 1) raf = requestAnimationFrame(step);
        else land();
      };
      raf = requestAnimationFrame(step);
    }

    function land() {
      spinning = false; spinBtn.disabled = false;
      angle = mod(angle, TAU);
      winner = under(angle);
      draw();
      const s = songs[winner];
      showSong(s, 'Now playing');
      artEl.src = art(s.coverArt, 160); artEl.hidden = false;
      actions.hidden = false;
      SFX && SFX.play('success');
      play(s);
    }

    function play(s) {
      playerState.playlist = allSongs;
      playerState.playlistIndex = allSongs.indexOf(s);
      playSong(s);
    }

    // A proper spin from the hub (or a tap): pick the slice first, then
    // wind the wheel so it stops somewhere inside it, not dead centre.
    function spin() {
      if (spinning) return;
      const k = Math.floor(Math.random() * n);
      const f = 0.15 + Math.random() * 0.7;
      const target = -Math.PI / 2 - (k + f) * slice;
      // Only an OS reduced-motion preference cuts the spin short. Performance
      // mode leaves it: it's brief, you asked for it, and it's plain 2D canvas.
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const turns = still ? 0 : 5 + Math.floor(Math.random() * 2);
      const delta = mod(target - angle, TAU) + turns * TAU;
      spinBy(delta, still ? 450 : 4200 + Math.random() * 900);
    }
    spinBtn.addEventListener('click', e => { e.stopPropagation(); spin(); });

    actions.querySelector('.mh-flow-play').addEventListener('click', () => { if (winner >= 0) { SFX && SFX.play('click'); play(songs[winner]); } });
    actions.querySelector('.mh-wheel-open').addEventListener('click', () => {
      const s = songs[winner];
      if (s?.albumId && window.openAlbumPage) { SFX && SFX.play('nav'); window.openAlbumPage(s.albumId, s.album); }
    });

    // ── Drag and flick ──
    const center = () => { const b = canvas.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    const pointerAngle = e => { const [cx, cy] = center(); return Math.atan2(e.clientY - cy, e.clientX - cx); };
    let drag = null;

    canvas.addEventListener('pointerdown', e => {
      if (spinning || e.button !== 0) return;
      const a = pointerAngle(e);
      drag = { id: e.pointerId, start: angle, a0: a, last: a, moved: 0, samples: [[performance.now(), angle]] };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) {
        // Hover: name the slice under the cursor.
        if (!spinning) {
          const [cx, cy] = center();
          const i = Math.floor(mod(Math.atan2(e.clientY - cy, e.clientX - cx) - angle, TAU) / slice) % n;
          canvas.title = [songs[i].title, songs[i].artist].filter(Boolean).join(' · ');
        }
        return;
      }
      const a = pointerAngle(e);
      let d = a - drag.last;
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      drag.last = a; drag.moved += Math.abs(d);
      angle += d;
      if (drag.moved > 0.05) el.classList.add('dragging');
      const now = performance.now();
      drag.samples.push([now, angle]);
      while (drag.samples.length > 2 && now - drag.samples[0][0] > 90) drag.samples.shift();
      lastSeg = under(angle);
      draw();
    });
    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      el.classList.remove('dragging');
      if (d.moved < 0.05) { spin(); return; } // a tap spins it
      const [t0, a0] = d.samples[0], [t1, a1] = d.samples[d.samples.length - 1];
      const v = t1 > t0 ? (a1 - a0) / (t1 - t0) : 0; // rad/ms
      if (Math.abs(v) < 0.004) return; // let go without a flick: it just stays there
      const speed = Math.min(Math.abs(v), 0.06);
      const duration = 1600 + 3400 * (speed / 0.06);
      spinBy(Math.sign(v) * speed * duration / 5, duration); // matches the ease's starting speed
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; el.classList.remove('dragging'); } });

    canvas.addEventListener('contextmenu', e => {
      if (typeof showSongCtx !== 'function') return;
      e.preventDefault();
      const [cx, cy] = center();
      const i = Math.floor(mod(Math.atan2(e.clientY - cy, e.clientX - cx) - angle, TAU) / slice) % n;
      showSongCtx(e.clientX, e.clientY, songs[i], allSongs);
    });

    // Redraw on resize and theme change; both stop once Home re-renders.
    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (!spinning) draw(); });
    ro.observe(stage);
    const mo = new MutationObserver(() => { if (!el.isConnected) { mo.disconnect(); return; } readColors(); if (!spinning) draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    lastSeg = under(angle);
    return el;
  }

  let frequent = [], frequentAt = 0;

  // Renders Home into `list`. Called with the shuffle picks already fetched.
  window.klabRenderMusicHome = function(list, songs, reshuffle) {
    list.innerHTML = '';
    list.classList.remove('picker-list-grid');
    list.classList.add('mh-home');

    const flowLabel = document.createElement('div');
    flowLabel.className = 'picker-section-label';
    flowLabel.textContent = 'Recently added';
    list.appendChild(flowLabel);
    list.appendChild(flow.el);
    flow.load();

    const recent = jumpBackIn();
    if (recent.length) list.appendChild(albumRow('Jump back in', recent));

    const freqSlot = document.createElement('div');
    list.appendChild(freqSlot);
    const showFrequent = () => { if (frequent.length) freqSlot.replaceWith(albumRow('Most played', frequent, 'across klabnet')); };
    if (frequent.length && Date.now() - frequentAt < REFRESH_MS) showFrequent();
    else albumList('frequent', 16).then(a => { frequent = a; frequentAt = Date.now(); if (freqSlot.isConnected) showFrequent(); }).catch(() => {});

    const shuffleLabel = document.createElement('div');
    shuffleLabel.className = 'picker-section-label mh-shuffle-label';
    shuffleLabel.innerHTML = 'Shuffle picks <button type="button" class="mh-reshuffle" title="Reshuffle"><i class="ti ti-refresh"></i></button>';
    list.appendChild(shuffleLabel);
    let wheel = null;
    if (songs.length >= 3) list.appendChild(wheel = shuffleWheel(songs));
    else if (songs.length) renderSongItems(songs, list);
    else list.insertAdjacentHTML('beforeend', '<div class="picker-empty">no tracks found</div>');
    // Reshuffle swaps just the wheel for a fresh one; the rest of Home
    // (Cover Flow, the album rows) stays exactly where it was.
    const btn = shuffleLabel.querySelector('button');
    btn.addEventListener('click', async () => {
      SFX && SFX.play('click');
      if (!wheel || !wheel.isConnected) { reshuffle(); return; }
      if (btn.classList.contains('busy')) return;
      btn.classList.add('busy');
      try {
        const r = await fetchTimeout(`${ND_URL}/rest/getRandomSongs?size=20&${subsonicParams()}`, {}, 8000);
        const fresh = (await r.json())['subsonic-response']?.randomSongs?.song || [];
        if (fresh.length >= 3 && wheel.isConnected) {
          const next = shuffleWheel(fresh);
          wheel.replaceWith(next);
          wheel = next;
          pickerSongs = fresh;
          next.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
        }
      } catch (e) {
        showToast('couldn’t reshuffle', 'ti-alert-triangle');
      } finally {
        btn.classList.remove('busy');
      }
    });
  };
})();
