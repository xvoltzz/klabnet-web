// ══════════════════════════════════════════
//  BROWSING ALBUMS AND SONGS — the filter bar under the title (find,
//  sort, decade, genre and a few toggles) and the A–Z rail down the right
//  edge: press or drag along it and the list glides to that letter (or
//  decade, sorted by year), with the letter in a bubble beside your
//  finger. Both lists are the whole library, cached (albumsLibrary() in
//  js/03-picker-tabs.js, the songs crawl in js/09-music-extras.js), so
//  filtering and jumping never wait on the network.
// ══════════════════════════════════════════
window.klabBrowse = (function() {
  const BROWSE_TABS = ['albums', 'songs'];
  const bar = document.getElementById('browseBar');
  const backdrop = document.getElementById('pickerBackdrop');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.fx === 'low';

  // ── Filters ──
  // Kept for the session, not saved: a filter left on from last week would
  // only look like missing music.
  const filters = {
    albums: { q: '', decade: null, genre: null, kind: null, unplayed: false },
    songs:  { q: '', decade: null, genre: null, fav: false, lossless: false, unplayed: false },
  };
  const LOSSLESS = /^(flac|alac|wav|aiff?|ape|wv|dsf|dff)$/i;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const genreOf = x => x.genre || x.genres?.[0]?.name || '';
  const decadeOf = x => x.year ? Math.floor(x.year / 10) * 10 : 0;
  const decadeLabel = d => d ? d + 's' : 'No year';
  const KINDS = [['full', 'Full-length', a => (a.songCount || 0) >= 7], ['short', 'EPs & singles', a => (a.songCount || 0) < 7]];
  const itemsOf = tab => (tab === 'albums' ? _albumsCache : _songsCache) || [];
  const noun = tab => tab === 'albums' ? 'album' : 'song';

  function active(tab) {
    const f = filters[tab];
    return !!(f.q.trim() || f.decade != null || f.genre != null || f.kind || f.unplayed || f.fav || f.lossless);
  }
  function filtered(tab) {
    const f = filters[tab];
    const words = fold(f.q).split(/\s+/).filter(Boolean);
    const kind = KINDS.find(k => k[0] === f.kind)?.[2];
    return itemsOf(tab).filter(x => {
      if (f.decade != null && decadeOf(x) !== f.decade) return false;
      if (f.genre != null && genreOf(x) !== f.genre) return false;
      if (kind && !kind(x)) return false;
      if (f.unplayed && x.playCount) return false;
      if (f.fav && !isFavorite(x.id)) return false;
      if (f.lossless && !LOSSLESS.test(x.suffix || '')) return false;
      if (words.length) {
        const hay = fold(tab === 'albums' ? `${x.name} ${x.artist}` : `${x.title} ${x.artist} ${x.album}`);
        if (!words.every(w => hay.includes(w))) return false;
      }
      return true;
    });
  }

  // ── The bar ──
  const SORT_SHORT = {
    'title-asc': 'Title A–Z', 'title-desc': 'Title Z–A', 'name-asc': 'Name A–Z', 'name-desc': 'Name Z–A',
    'artist-asc': 'Artist A–Z', 'album-asc': 'Album A–Z', 'year-desc': 'Newest', 'year-asc': 'Oldest',
    'created-desc': 'Recently added', 'plays-desc': 'Most played', 'played-desc': 'Recently played', 'duration-desc': 'Longest',
  };
  let barTab = null;
  function drawBar(tab) {
    const f = filters[tab];
    const chip = (key, label, on, icon) =>
      `<button type="button" class="browse-chip${on ? ' on' : ''}" data-menu="${key}" aria-haspopup="menu">${icon ? `<i class="ti ${icon}"></i>` : ''}<span>${esc(label)}</span><i class="ti ti-chevron-down"></i></button>`;
    const toggle = (key, label, on) =>
      `<button type="button" class="browse-chip toggle${on ? ' on' : ''}" data-toggle="${key}" aria-pressed="${on}">${on ? '<i class="ti ti-check"></i>' : ''}<span>${label}</span></button>`;
    const hasGenres = itemsOf(tab).some(genreOf);
    const kindLabel = KINDS.find(k => k[0] === f.kind)?.[1];
    if (barTab !== tab) {
      // The find box is kept across redraws, so typing never loses focus.
      bar.innerHTML = `<label class="browse-find"><i class="ti ti-list-search"></i><input type="text" autocomplete="off" spellcheck="false" aria-label="Filter ${tab}"><button type="button" class="browse-find-x" title="Clear" hidden><i class="ti ti-x"></i></button></label><div class="browse-chips"></div>`;
      barTab = tab;
    }
    const input = bar.querySelector('.browse-find input');
    input.placeholder = tab === 'albums' ? 'Filter albums' : 'Filter songs';
    if (input.value !== f.q) input.value = f.q;
    bar.querySelector('.browse-find-x').hidden = !f.q;
    bar.querySelector('.browse-chips').innerHTML =
      chip('sort', SORT_SHORT[getSort(tab)] || 'Sort', false, 'ti-arrows-sort') +
      chip('decade', f.decade != null ? decadeLabel(f.decade) : 'Decade', f.decade != null) +
      (hasGenres || f.genre != null ? chip('genre', f.genre ?? 'Genre', f.genre != null) : '') +
      (tab === 'albums' ? chip('kind', kindLabel || 'Type', !!f.kind) : '') +
      (tab === 'songs' ? toggle('fav', 'Favorites', f.fav) + toggle('lossless', 'Lossless', f.lossless) : '') +
      toggle('unplayed', 'Never played', f.unplayed) +
      (active(tab) ? '<button type="button" class="browse-clear">Clear</button>' : '');
    bar.hidden = false;
  }

  let typing = 0;
  bar.addEventListener('input', e => {
    if (!e.target.matches('.browse-find input') || !barTab) return;
    filters[barTab].q = e.target.value;
    bar.querySelector('.browse-find-x').hidden = !e.target.value;
    clearTimeout(typing);
    typing = setTimeout(() => render(barTab), 140);
  });
  bar.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.target.matches('.browse-find input') && e.target.value) {
      e.stopPropagation();
      e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  bar.addEventListener('click', e => {
    const tab = barTab;
    if (!tab) return;
    const f = filters[tab];
    if (e.target.closest('.browse-find-x')) {
      f.q = ''; render(tab); bar.querySelector('.browse-find input').focus(); return;
    }
    if (e.target.closest('.browse-clear')) {
      filters[tab] = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'boolean' ? false : k === 'q' ? '' : null]));
      SFX && SFX.play('click');
      render(tab); return;
    }
    const t = e.target.closest('[data-toggle]');
    if (t) { f[t.dataset.toggle] = !f[t.dataset.toggle]; SFX && SFX.play('click'); render(tab); return; }
    const m = e.target.closest('[data-menu]');
    if (m) openMenu(tab, m);
  });

  // ── The bar's menus ──
  const menu = document.createElement('div');
  menu.className = 'ctx-menu browse-menu';
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  let menuFor = null;
  function closeMenu() { menu.classList.remove('visible'); menuFor = null; }
  function openMenu(tab, anchor) {
    if (menuFor === anchor && menu.classList.contains('visible')) { closeMenu(); return; }
    const f = filters[tab];
    const which = anchor.dataset.menu;
    const counts = key => {
      const m = new Map();
      for (const x of itemsOf(tab)) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); }
      return m;
    };
    let label = '', rows = [];
    if (which === 'sort') {
      label = 'Sort by';
      const cur = getSort(tab);
      rows = SORT_OPTIONS[tab].map(([k, l]) => ({ label: l, on: k === cur, pick: () => setSort(tab, k) }));
    } else if (which === 'decade') {
      label = 'Decade';
      const c = counts(decadeOf);
      rows = [{ label: 'Any decade', on: f.decade == null, pick: () => { f.decade = null; } },
        ...[...c].sort((a, b) => (b[0] || -1) - (a[0] || -1)).map(([d, n]) => ({ label: decadeLabel(d), n, on: f.decade === d, pick: () => { f.decade = d; } }))];
    } else if (which === 'genre') {
      label = 'Genre';
      const c = counts(genreOf); c.delete('');
      rows = [{ label: 'Any genre', on: f.genre == null, pick: () => { f.genre = null; } },
        ...[...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g, n]) => ({ label: g, n, on: f.genre === g, pick: () => { f.genre = g; } }))];
    } else if (which === 'kind') {
      label = 'Type';
      rows = [{ label: 'Any length', on: !f.kind, pick: () => { f.kind = null; } },
        ...KINDS.map(([k, l, test]) => ({ label: l, n: itemsOf(tab).filter(test).length, on: f.kind === k, pick: () => { f.kind = k; } }))];
    }
    menu.innerHTML = `<div class="ctx-label">${label}</div>` + rows.map((r, i) =>
      `<div class="ctx-item" role="menuitemradio" aria-checked="${r.on}" tabindex="-1" data-i="${i}"><i class="ti ${r.on ? 'ti-check' : ''}"></i><span>${esc(r.label)}</span>${r.n != null ? `<small>${r.n.toLocaleString()}</small>` : ''}</div>`).join('');
    menu.onclick = e => {
      const it = e.target.closest('[data-i]');
      if (!it) return;
      rows[+it.dataset.i].pick();
      closeMenu();
      SFX && SFX.play('click');
      render(tab);
    };
    const r = anchor.getBoundingClientRect(), z = zoomFactor();
    menu.style.top = (r.bottom / z + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left / z, innerWidth / z - 240)) + 'px';
    menu.style.right = 'auto';
    menu.style.transformOrigin = 'top left';
    menu.classList.add('visible');
    menuFor = anchor;
  }
  document.addEventListener('pointerdown', e => {
    if (menuFor && !menu.contains(e.target) && !menuFor.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuFor) { closeMenu(); e.stopPropagation(); } }, true);

  // ── Rendering ──
  // Where each item of the list sits (scrollTop units) and its element,
  // for the rail: albums are all drawn; songs are a virtual list.
  let geom = null;
  let songsOff = null; // stops the songs list's scroll and resize watchers

  function render(tab) {
    if (pickerTab !== tab) return;
    closeMenu();
    drawBar(tab);
    const shown = applySort(filtered(tab), tab);
    rail.unmount();
    songsOff?.(); songsOff = null;
    geom = null;
    pickerList.scrollTop = 0;
    if (!shown.length) {
      const any = itemsOf(tab).length;
      pickerList.innerHTML = `<div class="picker-empty browse-none">${any ? `No ${tab} match` : `No ${tab}`}${any && active(tab) ? '<button type="button" class="browse-clear-inline">Clear filters</button>' : ''}</div>`;
      pickerList.querySelector('.browse-clear-inline')?.addEventListener('click', () => bar.querySelector('.browse-clear')?.click());
      if (tab === 'songs') pickerSongs = [];
      return;
    }
    if (tab === 'albums') {
      renderAlbumList(shown);
      const items = pickerList.querySelectorAll(':scope > .picker-item');
      geom = { top: i => items[i]?.offsetTop ?? 0, row: i => items[i] || null };
    } else renderSongs(shown);
    rail.mount(tab, shown);
  }

  // Songs: every row the same height, so only the ones on screen (and a
  // screen's worth either side) exist; the rest is empty space of the
  // right height. Thousands of rows drawn at once took a second to jump
  // through.
  function renderSongs(sorted) {
    pickerSongs = sorted;
    pickerList.innerHTML = '';
    const lbl = document.createElement('div');
    lbl.className = 'picker-section-label';
    lbl.id = '_songsLbl';
    lbl.textContent = `All Songs (${sorted.length})`;
    const vl = document.createElement('div');
    vl.className = 'vsongs';
    pickerList.append(lbl, vl);
    renderSongItem(sorted[0], vl);
    const GAP = 2; // .picker-list's gap
    const rowH = vl.firstElementChild.offsetHeight + GAP;
    vl.replaceChildren();
    vl.style.height = (sorted.length * rowH - GAP) + 'px';
    const live = new Map();
    const draw = () => {
      if (!vl.isConnected) return;
      const from = pickerList.scrollTop - vl.offsetTop, h = pickerList.clientHeight;
      const first = Math.max(0, Math.floor(from / rowH) - 12);
      const last = Math.min(sorted.length - 1, Math.ceil((from + h) / rowH) + 12);
      for (const [i, el] of live) if (i < first || i > last) { el.remove(); live.delete(i); }
      const frag = document.createDocumentFragment();
      for (let i = first; i <= last; i++) {
        if (live.has(i)) continue;
        renderSongItem(sorted[i], frag);
        const el = frag.lastElementChild;
        el.style.top = (i * rowH) + 'px';
        live.set(i, el);
      }
      if (frag.childNodes.length) vl.appendChild(frag);
    };
    let queued = false;
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
    pickerList.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(draw);
    ro.observe(pickerList);
    songsOff = () => { pickerList.removeEventListener('scroll', onScroll); ro.disconnect(); };
    draw();
    geom = { top: i => vl.offsetTop + i * rowH, row: i => { draw(); return live.get(i) || null; } };
  }

  // ── The rail ──
  // Which letter an item files under, by what the list is sorted on.
  const letter = s => {
    const c = fold(s).trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : /\p{L}/u.test(c) ? '…' : '#';
  };
  function keyer(tab) {
    const s = getSort(tab);
    if (/^(title|name)-/.test(s)) return x => letter(tab === 'albums' ? x.name : x.title);
    if (s === 'artist-asc') return x => letter(x.artist);
    if (s === 'album-asc') return x => letter(x.album);
    if (/^year-/.test(s)) return x => decadeOf(x);
    return null;
  }
  const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '…'];

  const rail = (function() {
    const el = document.createElement('div');
    el.className = 'abc-rail';
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-label', 'Jump to');
    el.hidden = true;
    el.innerHTML = '<div class="abc-track"><span class="abc-pill"></span></div>';
    const track = el.firstChild, pill = track.firstChild;
    const bubble = document.createElement('div');
    bubble.className = 'abc-bubble';
    bubble.setAttribute('aria-hidden', 'true');
    bubble.innerHTML = '<b></b><small></small>';
    const bubbleKey = bubble.querySelector('b'), bubbleSub = bubble.querySelector('small');
    backdrop.append(el, bubble);

    let tab = null, sections = [], rows = [], cur = -1;

    function mount(t, shown) {
      const key = keyer(t);
      if (!key) return;
      // Each section: where it starts in the list and how many it holds.
      const seen = new Map();
      shown.forEach((x, i) => {
        const k = key(x);
        const s = seen.get(k);
        if (s) s.count++; else seen.set(k, { key: k, index: i, count: 1 });
      });
      if (seen.size < 2) return;
      const sorted = getSort(t);
      if (/^year-/.test(sorted)) sections = [...seen.values()];
      else {
        // The whole alphabet, the missing letters dimmed, in the list's direction.
        const order = sorted.endsWith('-desc') ? [...LETTERS].reverse() : LETTERS;
        sections = order.filter(k => seen.has(k) || /[A-Z]/.test(k)).map(k => seen.get(k) || { key: k, index: -1, count: 0 });
      }
      tab = t;
      track.querySelectorAll('.abc-k').forEach(k => k.remove());
      rows = sections.map((s, i) => {
        const k = document.createElement('span');
        k.className = 'abc-k' + (s.index < 0 ? ' none' : '');
        k.textContent = typeof s.key === 'number' ? (s.key ? `’${String(s.key).slice(2)}` : '?') : s.key;
        k.dataset.i = i;
        track.appendChild(k);
        return k;
      });
      el.hidden = false;
      pickerList.classList.add('has-abc');
      cur = -1;
      layout();
      sync();
    }
    function unmount() {
      if (!tab) return;
      tab = null; sections = []; rows = [];
      el.hidden = true;
      el.classList.remove('awake', 'dragging', 'hovering');
      bubble.classList.remove('shown');
      pickerList.classList.remove('has-abc');
      stopFollow();
    }

    // Down the list's right edge, between its top and the player bar,
    // as tall as the letters need (centred), at least 14px a row; when
    // they don't fit, every other one (or more) becomes a dot.
    let railTop = 0, railH = 0;
    function layout() {
      if (!tab) return;
      const b = backdrop.getBoundingClientRect(), l = pickerList.getBoundingClientRect(), z = zoomFactor();
      const dock = parseFloat(getComputedStyle(pickerList).paddingBottom) || 0;
      const top = (l.top - b.top) / z, avail = Math.max(120, l.height / z - dock - 12);
      const want = rows.length * 21;
      railH = Math.min(avail, want);
      railTop = top + (avail - railH) / 2;
      // A list that hardly scrolls has nothing to jump through.
      el.hidden = pickerList.scrollHeight < pickerList.clientHeight * 1.5;
      el.style.top = railTop + 'px';
      el.style.height = railH + 'px';
      const step = Math.max(1, Math.ceil(14 / (railH / rows.length)));
      rows.forEach((k, i) => {
        k.style.top = ((i + 0.5) / rows.length * 100) + '%';
        k.classList.toggle('dot', i % step !== 0 && i !== rows.length - 1);
      });
      placePill(false);
    }
    new ResizeObserver(() => layout()).observe(pickerList);

    // The section showing at the top of the list.
    function current() {
      const at = pickerList.scrollTop + 24;
      let best = -1;
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (s.index < 0) continue;
        if (geom.top(s.index) <= at) best = i; else break;
      }
      return best < 0 ? sections.findIndex(s => s.index >= 0) : best;
    }
    function placePill(animate = true) {
      if (cur < 0 || !rows[cur]) { pill.style.opacity = '0'; return; }
      pill.style.transition = animate && !reduced() ? '' : 'none';
      pill.style.opacity = '';
      pill.style.transform = `translateY(${(cur + 0.5) / rows.length * railH}px) translateY(-50%)`;
      el.setAttribute('aria-valuenow', cur);
      el.setAttribute('aria-valuetext', bubbleText(cur));
    }
    function setCur(i) {
      if (i === cur) return;
      if (rows[cur]) rows[cur].classList.remove('cur');
      cur = i;
      if (rows[cur]) rows[cur].classList.add('cur');
      placePill();
    }
    let syncQueued = false;
    function sync() {
      syncQueued = false;
      if (!tab || dragging) return;
      setCur(current());
    }

    // Awake (bright, the pill showing) while the list moves or the rail is
    // touched; back to quiet a moment after.
    let sleepT = 0;
    function wake() {
      el.classList.add('awake');
      clearTimeout(sleepT);
      sleepT = setTimeout(() => { if (!dragging && !el.matches(':hover, :focus-visible')) el.classList.remove('awake'); }, 1400);
    }
    pickerList.addEventListener('scroll', () => {
      if (!tab) return;
      if (!following) wake();
      if (!syncQueued) { syncQueued = true; requestAnimationFrame(sync); }
    }, { passive: true });

    // ── Gliding the list ──
    // Eases toward the target every frame (fast at first, settling
    // softly), and keeps easing as the target moves under a drag.
    let target = 0, following = false, raf = 0, last = 0, landOn = null;
    function stopFollow() { cancelAnimationFrame(raf); raf = 0; following = false; }
    function follow(now) {
      const dt = Math.min(48, now - (last || now)); last = now;
      const pos = pickerList.scrollTop;
      const diff = target - pos;
      if (Math.abs(diff) < 0.75) {
        pickerList.scrollTop = target;
        stopFollow();
        if (landOn != null && !dragging) { land(landOn); landOn = null; }
        return;
      }
      const k = 1 - Math.pow(1 - (dragging ? 0.3 : 0.16), dt / 16.7);
      pickerList.scrollTop = pos + diff * k;
      // Scrolled as far as it goes: stop chasing a target past the end.
      if (Math.abs(pickerList.scrollTop - pos) < 0.1 && Math.abs(diff) > 1 && dt > 0) { target = pickerList.scrollTop; }
      raf = requestAnimationFrame(follow);
    }
    function goTo(i) {
      let s = sections[i];
      // A dimmed letter: the next one that's there (or the last).
      if (!s || s.index < 0) {
        const next = sections.findIndex((x, j) => j > i && x.index >= 0);
        const prev = sections.findLastIndex((x, j) => j < i && x.index >= 0);
        i = next >= 0 ? next : prev;
        s = sections[i];
        if (!s) return;
      }
      setCur(i);
      target = Math.max(0, Math.min(pickerList.scrollHeight - pickerList.clientHeight, geom.top(s.index) - 8));
      landOn = s.index;
      if (reduced()) { pickerList.scrollTop = target; if (!dragging) land(landOn); landOn = null; return; }
      if (!following) { following = true; last = 0; raf = requestAnimationFrame(follow); }
    }
    // Where it landed: a soft glow on the first of that letter.
    function land(index) {
      const row = geom?.row(index);
      if (!row) return;
      row.classList.remove('abc-land');
      void row.offsetWidth;
      row.classList.add('abc-land');
      setTimeout(() => row.classList.remove('abc-land'), 1000);
    }
    // Wheel or touch on the list takes over from a glide.
    ['wheel', 'touchstart'].forEach(t => pickerList.addEventListener(t, () => { if (following && !dragging) { stopFollow(); landOn = null; } }, { passive: true }));

    // ── Pressing, dragging, hovering ──
    let dragging = false, pointerY = null, bubbleY = 0, bubbleV = 0, bubbleRaf = 0, bubbleI = -1;
    const indexAt = clientY => {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(rows.length - 1, Math.floor((clientY - r.top) / r.height * rows.length)));
    };
    function bubbleText(i) {
      const s = sections[i];
      if (!s) return '';
      return typeof s.key === 'number' ? decadeLabel(s.key) : s.key;
    }
    function showBubble(i) {
      if (i !== bubbleI) {
        bubbleI = i;
        const s = sections[i];
        bubbleKey.textContent = bubbleText(i);
        bubbleKey.classList.toggle('long', bubbleKey.textContent.length > 2);
        bubbleSub.textContent = s?.count ? klabCount(s.count, noun(tab)) : 'none';
        bubble.classList.toggle('none', !s?.count);
        bubbleKey.classList.remove('pop'); void bubbleKey.offsetWidth; bubbleKey.classList.add('pop');
      }
      bubble.classList.add('shown');
    }
    // The bubble rides beside the pointer on a spring, a little behind it.
    function bubbleStep() {
      bubbleRaf = 0;
      if (pointerY == null) return;
      const b = backdrop.getBoundingClientRect(), z = zoomFactor();
      const want = (pointerY - b.top) / z;
      if (reduced()) bubbleY = want;
      else { bubbleV = (bubbleV + (want - bubbleY) * 0.24) * 0.62; bubbleY += bubbleV; }
      bubble.style.transform = `translateY(${bubbleY}px) translateY(-50%)`;
      if (Math.abs(want - bubbleY) > 0.3 || Math.abs(bubbleV) > 0.3) bubbleRaf = requestAnimationFrame(bubbleStep);
    }
    // The letters near the pointer swell and lean out, like a dock.
    function swell(clientY) {
      if (reduced()) return;
      const r = track.getBoundingClientRect();
      for (const k of rows) {
        const kr = k.getBoundingClientRect();
        const d = (kr.top + kr.height / 2 - clientY) / (r.height / rows.length);
        const s = Math.exp(-(d * d) / 3.2);
        k.style.setProperty('--swell', s.toFixed(3));
      }
    }
    function unswell() { for (const k of rows) k.style.removeProperty('--swell'); }

    el.addEventListener('pointerdown', e => {
      if (!tab || e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      dragging = true;
      el.classList.add('dragging');
      wake();
      pointerY = e.clientY;
      const b = backdrop.getBoundingClientRect();
      bubbleY = (e.clientY - b.top) / zoomFactor(); bubbleV = 0;
      bubbleI = -1;
      const i = indexAt(e.clientY);
      showBubble(i); bubbleStep(); swell(e.clientY);
      goTo(i);
      SFX && SFX.play('tick');
    });
    el.addEventListener('pointermove', e => {
      if (!tab) return;
      if (!dragging) { if (e.pointerType === 'mouse') { el.classList.add('hovering'); swell(e.clientY); } return; }
      pointerY = e.clientY;
      swell(e.clientY);
      const i = indexAt(e.clientY);
      if (i !== bubbleI) { showBubble(i); goTo(i); SFX && SFX.play('tick'); }
      if (!bubbleRaf) bubbleRaf = requestAnimationFrame(bubbleStep);
    });
    const release = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      pointerY = null;
      setTimeout(() => { if (!dragging) bubble.classList.remove('shown'); }, 380);
      if (!el.matches(':hover')) { unswell(); el.classList.remove('hovering'); }
      wake();
      // Settled already while the finger was down: land now.
      if (!following && landOn != null) { land(landOn); landOn = null; }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', () => { if (!dragging) { unswell(); el.classList.remove('hovering'); } });

    el.addEventListener('keydown', e => {
      if (!tab) return;
      const there = sections.map((s, i) => s.index >= 0 ? i : -1).filter(i => i >= 0);
      const at = Math.max(0, there.indexOf(cur));
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, PageDown: at + 5, PageUp: at - 5, Home: 0, End: there.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      wake();
      goTo(there[Math.max(0, Math.min(there.length - 1, to))]);
    });

    return { mount, unmount };
  })();

  // Leaving Albums or Songs for any other view takes the bar and the rail away.
  const _prevLoadPickerTab = loadPickerTab;
  loadPickerTab = async function(tab) {
    if (!BROWSE_TABS.includes(tab)) leave();
    return _prevLoadPickerTab(tab);
  };
  function leave() {
    rail.unmount();
    closeMenu();
    songsOff?.(); songsOff = null;
    geom = null;
    bar.hidden = true;
    barTab = null;
    bar.innerHTML = '';
  }

  return { render, leave, filtered };
})();
