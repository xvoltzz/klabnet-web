// ══════════════════════════════════════════
//  SOCIAL — Feed, Chat and Photos as one page, laid out like Music.
//    · The sidebar (#socSidebar in index.html) holds Social's own home,
//      Feed, Photos and Chat's people and conversations. Pressing
//      something in it that belongs to another of the four pages goes there.
//    · Social's home is Music Home's kind of page: the newest photos in a
//      collage that reshuffles itself and the latest posts in a row. It
//      only fetches (and moves) while it's showing.
//  Routing (TAB_GROUP, the remembered page) is in js/07-tabnav.js; the
//  layout is "SOCIAL" in css/app.css.
// ══════════════════════════════════════════
(function() {
  const $ = id => document.getElementById(id);
  const side = $('socSidebar');
  if (!side) return;
  const on = key => document.body.classList.contains('tab-' + key + '-active');

  // ── The sidebar ──
  // Feed's mentions dot, on its row too.
  const mentions = $('feedMentionsDot'), feedDot = $('socFeedDot');
  if (mentions && feedDot) {
    const sync = () => { feedDot.hidden = mentions.hidden; };
    new MutationObserver(sync).observe(mentions, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }
  // A conversation or a person picked from Feed or Photos: their own click
  // handlers open it, then this brings Chat up to show it.
  $('chatSide')?.addEventListener('click', e => {
    if (on('chat')) return;
    if (e.target.closest('.chat-channel-close, .chat-icon-btn')) return;
    if (e.target.closest('.chat-conv, #chatPeopleResults [data-username]')) setActiveTab('chat');
  });
  $('socChatConnect')?.addEventListener('click', () => {
    setActiveTab('chat');
    $('chatConnectBtn')?.click();
  });

  // ── Social's home ──
  const body = $('socHomeBody'), sub = $('socHomeSub');
  if (!body) return;
  const REFRESH_MS = 60e3;
  let active = false;
  const apiTime = s => {
    if (!s) return 0;
    const str = String(s);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime() || 0;
  };
  const photoFile = (id, size) => `/api/posts/photos/files/${encodeURIComponent(id)}/${size}?v=2`;
  const shotFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const label = text => { const el = document.createElement('div'); el.className = 'picker-section-label'; el.textContent = text; return el; };

  // New photos: a collage, not Cover Flow (the owner: "more photography
  // oriented… it moves in weird and funky ways and all the photos are just
  // together"). The newest uploads packed edge to edge into one block, in
  // rows at their own shapes. Every few seconds the next photo takes the
  // big spot (left, then right) and everything reflows around it, a wave
  // across the block, with photos from further back coming in and out.
  // Hovering stops it; a photo opens on a click. Still with reduced motion.
  const photos = (() => {
    const el = document.createElement('div');
    el.className = 'soc-collage';
    el.setAttribute('role', 'list');
    el.setAttribute('aria-label', 'New photos');
    el.hidden = true;
    const empty = document.createElement('div');
    empty.className = 'soc-home-empty';
    empty.textContent = 'No photos yet.';
    empty.hidden = true;

    const GAP = 4, EVERY = 4600;
    const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    let items = [], order = [], keys = '', loadedAt = 0, step = 0, timer = 0, held = false, inView = true, drawn = false;
    const tiles = new Map(); // photo id -> its tile
    const aspect = it => Math.max(0.5, Math.min(2.2, it.ph.w && it.ph.h ? it.ph.w / it.ph.h : 1.5));

    function tileFor(it) {
      let t = tiles.get(it.ph.id);
      if (t) return t;
      t = document.createElement('button');
      t.type = 'button';
      t.className = 'soc-tile off';
      t.setAttribute('role', 'listitem');
      const who = [it.post.username, it.post.shot_at ? shotFmt.format(new Date(apiTime(it.post.shot_at))) : ''].filter(Boolean).join(' · ');
      t.setAttribute('aria-label', (it.post.text || 'Photo') + (who ? ', ' + who : ''));
      t.innerHTML = '<img alt="" decoding="async" draggable="false"><span class="soc-tile-cap"></span>';
      t.querySelector('.soc-tile-cap').textContent = who;
      const img = t.firstChild;
      img.onload = () => t.classList.add('loaded');
      img.src = photoFile(it.ph.id, 'thumb');
      t._it = it;
      t.addEventListener('click', () => window.klabOpenPhoto?.(it.post.id, it.ph.id));
      el.appendChild(t);
      tiles.set(it.ph.id, t);
      return t;
    }

    // Where each photo goes: maybe a big one down one side, then rows that
    // each fill the width exactly at the photos' own shapes, stretched or
    // squeezed a little so the rows fill the height too.
    function pack(W, H, list) {
      const out = [];
      let x0 = 0, width = W, rest = list;
      const hero = list.length > 5 && W > 520 && step % 3 !== 2;
      if (hero) {
        const hw = Math.round(Math.min(W * 0.5, Math.max(W * 0.3, H * Math.min(1.4, aspect(list[0])))));
        const left = step % 2 === 0;
        out.push({ it: list[0], x: left ? 0 : W - hw, y: 0, w: hw, h: H });
        x0 = left ? hw + GAP : 0; width = W - hw - GAP; rest = list.slice(1);
      }
      const nRows = H > 480 ? 3 : 2;
      const r = (H - GAP * (nRows - 1)) / nRows;
      const rows = [];
      let cur = [], sum = 0;
      for (const it of rest) {
        cur.push(it); sum += aspect(it);
        if (sum * r + GAP * (cur.length - 1) >= width) { rows.push(cur); cur = []; sum = 0; if (rows.length === nRows) break; }
      }
      if (!rows.length && cur.length) rows.push(cur);
      const natural = rows.map(row => (width - GAP * (row.length - 1)) / row.reduce((n, it) => n + aspect(it), 0));
      const k = (H - GAP * (rows.length - 1)) / natural.reduce((a, b) => a + b, 0);
      let y = 0;
      rows.forEach((row, i) => {
        const h = i === rows.length - 1 ? H - y : Math.round(natural[i] * k);
        let x = x0;
        row.forEach((it, j) => {
          const w = j === row.length - 1 ? x0 + width - x : Math.round(aspect(it) * natural[i]);
          out.push({ it, x, y, w, h });
          x += w + GAP;
        });
        y += h + GAP;
      });
      return out;
    }

    function layout() {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H || !order.length) return;
      const placed = pack(W, H, order);
      const on = new Set();
      placed.forEach((p, i) => {
        const t = tileFor(p.it);
        on.add(t);
        const coming = t.classList.contains('off');
        // A wave across the block: left to right, top to bottom.
        t.style.setProperty('--d', Math.round((p.x / W) * 260 + (p.y / H) * 120) + 'ms');
        if (coming) {
          // From nowhere: put where it goes first, then shown.
          t.style.transition = 'none';
          t.style.transform = `translate(${p.x}px, ${p.y}px) scale(.86)`;
          t.style.width = p.w + 'px'; t.style.height = p.h + 'px';
          void t.offsetWidth;
          t.style.transition = '';
          t.classList.remove('off');
        }
        t.style.transform = `translate(${p.x}px, ${p.y}px)`;
        t.style.width = p.w + 'px'; t.style.height = p.h + 'px';
        // Big enough to need it: the sharper file.
        if (p.w * (devicePixelRatio || 1) > 520 && !t._big) { t._big = true; const pre = new Image(); pre.onload = () => { t.firstChild.src = pre.src; }; pre.src = photoFile(p.it.ph.id, 'medium'); }
      });
      tiles.forEach(t => { if (!on.has(t) && !t.classList.contains('off')) { t.classList.add('off'); t.style.transform += ' scale(.86)'; } });
      drawn = true;
    }

    // Each move: the photo after this one up front (so each gets the big
    // spot in turn), and two others trade places.
    function shuffle(dir = 1) {
      step += 1;
      if (order.length < 3) return;
      if (dir > 0) order.push(order.shift()); else order.unshift(order.pop());
      const n = Math.min(order.length, 12);
      const i = 1 + Math.floor(Math.random() * (n - 1)), j = 1 + Math.floor(Math.random() * (n - 1));
      [order[i], order[j]] = [order[j], order[i]];
      layout();
    }
    function schedule() {
      clearTimeout(timer);
      if (!active || document.hidden || held || !inView || calm() || items.length < 3) return;
      timer = setTimeout(() => { shuffle(1); schedule(); }, EVERY);
    }
    el.addEventListener('pointerenter', () => { held = true; clearTimeout(timer); });
    el.addEventListener('pointerleave', () => { held = false; schedule(); });
    el.addEventListener('focusin', () => { held = true; clearTimeout(timer); });
    el.addEventListener('focusout', () => { held = false; schedule(); });
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; schedule(); }).observe(el);
    new ResizeObserver(() => { if (drawn) layout(); }).observe(el);
    document.addEventListener('visibilitychange', schedule);

    // ←/→ shuffle it along while Social's home is showing (they'd skip the
    // song anywhere else); capture on window so they win, as in Photos.
    window.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!active || el.hidden || !el.offsetParent || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (window.klabAwaitingG?.()) return;
      // Only when the focus is nowhere in particular (or on this page, or a
      // tab you just pressed): a slider, a text box and the like keep
      // their arrows.
      const a = document.activeElement;
      if (a && a !== document.body && !el.contains(a) && !a.closest?.('#socHome, #socNav, .tab-nav')) return;
      if (a?.closest?.('input, textarea, select, [contenteditable="true"], .slider-wrap')) return;
      if (document.body.classList.contains('feed-composer-open') ||
          document.querySelector('.add-app-backdrop.open, .settings-backdrop.open, .img-crop-backdrop.open, .img-view-backdrop.open, .klab-menu.visible, .ctx-menu.visible, .fs-player.open, .ss.open')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      shuffle(e.key === 'ArrowRight' ? 1 : -1);
      schedule();
    }, true);

    async function load() {
      if (Date.now() - loadedAt < REFRESH_MS) { layout(); schedule(); return; }
      try {
        const r = await fetchTimeout('/api/posts/photos?order=posted&limit=16', {}, 8000);
        if (!r.ok) throw new Error('status ' + r.status);
        const got = [];
        ((await r.json()).posts || []).forEach(post => (post.photos || []).forEach(ph => { if (got.length < 30) got.push({ post, ph }); }));
        loadedAt = Date.now();
        empty.hidden = !!got.length;
        el.hidden = !got.length;
        if (!got.length) { keys = ''; empty.textContent = 'No photos yet.'; return; }
        const k = got.map(it => it.ph.id).join();
        // The same photos: carry on from where it was.
        if (k !== keys) {
          keys = k;
          items = got;
          const ids = new Set(got.map(it => it.ph.id));
          tiles.forEach((t, id) => { if (!ids.has(id)) { t.remove(); tiles.delete(id); } });
          order = got.slice();
          step = 0;
        }
        requestAnimationFrame(() => { layout(); schedule(); });
      } catch (e) { if (!keys) { el.hidden = true; empty.textContent = 'Couldn’t load photos just now.'; empty.hidden = false; } }
    }
    return { el, empty, load, stop: () => clearTimeout(timer), schedule };
  })();

  // Latest posts: Feed's own, as it has them (no fetch of its own).
  const posts = (() => {
    const sec = document.createElement('section');
    sec.className = 'mh-section';
    sec.innerHTML = '<div class="mh-row-wrap"><div class="mh-row"></div>' +
      '<button type="button" class="mh-row-nav prev" title="Back"><i class="ti ti-chevron-left"></i></button>' +
      '<button type="button" class="mh-row-nav next" title="More"><i class="ti ti-chevron-right"></i></button></div>';
    const row = sec.querySelector('.mh-row'), wrap = sec.querySelector('.mh-row-wrap');
    const edges = () => {
      wrap.classList.toggle('more-l', row.scrollLeft > 4);
      wrap.classList.toggle('more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    };
    row.addEventListener('scroll', edges, { passive: true });
    new ResizeObserver(edges).observe(row);
    const page = dir => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
    sec.querySelector('.mh-row-nav.prev').addEventListener('click', () => page(-1));
    sec.querySelector('.mh-row-nav.next').addEventListener('click', () => page(1));
    row.addEventListener('click', e => {
      const card = e.target.closest('.soc-post');
      if (card) window.klabFeedFocus?.(+card.dataset.post);
    });
    // Markdown, links and mentions read as their text here: a card is a glimpse.
    const plain = t => String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_~`>#|=]+/g, '').trim();
    function avatar(u) {
      const url = window.klabResolveUserAvatar?.(u);
      return '<span class="soc-post-av">' + (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
    }
    let lastKey = '';
    function render(list) {
      if (!list) return;
      const key = list.map(p => p.id + ':' + (p.reply_count || 0) + ':' + !!window.klabResolveUserAvatar?.(p.username)).join('|');
      if (key === lastKey) { refreshTimes(); return; }
      lastKey = key;
      row.innerHTML = list.length ? list.map(p => {
        const reacts = Object.values(p.reactions || {}).reduce((n, r) => n + (r.count || 0), 0);
        const text = plain(p.text) || (p.image_mxc ? 'Posted a picture' : p.song ? 'Shared ' + (p.song.title || 'a song') : '');
        return '<div class="soc-post" role="link" tabindex="0" data-post="' + p.id + '">' +
          '<div class="soc-post-who">' + avatar(p.username) +
            '<span class="soc-post-name" style="color:' + (typeof profileColor === 'function' ? profileColor(p.username) : 'inherit') + '">' + esc(p.username) + '</span>' +
            '<span class="soc-post-when" data-t="' + apiTime(p.created) + '">' + klabRelativeTime(apiTime(p.created)) + '</span></div>' +
          '<div class="soc-post-text">' + esc(text) + '</div>' +
          '<div class="soc-post-meta">' +
            (p.reply_count ? '<span><i class="ti ti-message-circle"></i>' + p.reply_count + '</span>' : '') +
            (reacts ? '<span><i class="ti ti-mood-smile"></i>' + reacts + '</span>' : '') + '</div>' +
        '</div>';
      }).join('') : '<div class="soc-home-empty">No posts yet.</div>';
      edges();
    }
    function refreshTimes() {
      row.querySelectorAll('.soc-post-when[data-t]').forEach(el => { el.textContent = klabRelativeTime(+el.dataset.t); });
    }
    // Keyboard: the cards are links.
    row.addEventListener('keydown', e => {
      const card = e.target.closest('.soc-post');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
    });
    return { el: sec, render, load: () => window.klabLoadFeed?.().then(() => render(window.klabFeedPosts?.())) };
  })();
  // Feed tells Home when its posts change; Social's home listens in too.
  const homeFeedChanged = window.klabHomeFeedChanged;
  window.klabHomeFeedChanged = list => {
    homeFeedChanged?.(list);
    if (active) posts.render(list);
  };

  if (photos) body.append(label('New photos'), photos.el, photos.empty);
  body.append(label('Latest posts'), posts.el);

  function paintSub() {
    const n = window.KLAB_ONLINE_USERNAMES?.size || 0;
    sub.textContent = n ? n + ' online' : '';
  }
  let timer = 0;
  function refresh() {
    if (!active || document.hidden) return;
    photos?.load();
    posts.load();
    paintSub();
  }
  window.klabSocialTabChanged = show => {
    if (show === active) return;
    active = show;
    clearInterval(timer);
    if (active) { refresh(); timer = setInterval(refresh, REFRESH_MS); }
    else photos?.stop();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  // Loaded straight onto #social: the tab was set before this file was.
  if (on('social')) window.klabSocialTabChanged(true);
})();
