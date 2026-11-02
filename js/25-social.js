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

    const GAP = 4;
    let items = [], order = [], keys = '', loadedAt = 0, step = 0, drawn = false;
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
        t.style.setProperty('--d', Math.round((p.x / W) * 160 + (p.y / H) * 80) + 'ms');
        if (coming) requestAnimationFrame(() => t.classList.remove('off'));
        t.style.transform = `translate(${p.x}px, ${p.y}px)`;
        t.style.width = p.w + 'px'; t.style.height = p.h + 'px';
        // Big enough to need it: the sharper file.
        if (p.w * (devicePixelRatio || 1) > 520 && !t._big) { t._big = true; const pre = new Image(); pre.onload = () => { t.firstChild.src = pre.src; }; pre.src = photoFile(p.it.ph.id, 'medium'); }
      });
      tiles.forEach(t => { if (!on.has(t)) t.classList.add('off'); });
      drawn = true;
    }

    // It stays still (the owner): no shuffling with ←/→, no drifting on
    // its own. schedule() and stop() stay as the page's hooks.
    const schedule = () => {};
    new ResizeObserver(() => { if (drawn) layout(); }).observe(el);

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
    return { el, empty, load, stop: () => {}, schedule };
  })();

  // Latest posts: Feed's own, as it has them (no fetch of its own).
  const posts = (() => {
    const sec = document.createElement('section');
    sec.className = 'mh-section soc-posts';
    sec.innerHTML = '<div class="mh-row-wrap"><div class="mh-row"></div>' +
      '<button type="button" class="mh-row-nav prev" title="Back"><i class="ti ti-chevron-left"></i></button>' +
      '<button type="button" class="mh-row-nav next" title="More"><i class="ti ti-chevron-right"></i></button></div>';
    const row = sec.querySelector('.mh-row'), wrap = sec.querySelector('.mh-row-wrap');
    const edges = () => {
      wrap.classList.toggle('more-l', row.scrollLeft > 4);
      wrap.classList.toggle('more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    };
    row.addEventListener('scroll', edges, { passive: true });
    // On a big screen the row takes what height is left under the photos:
    // as many rows of cards as fit (up to three, and no more than the
    // posts need), each card showing as many lines as it has room for.
    const roomy = matchMedia('(min-width: 761px), (pointer: fine)');
    const GAP = 14, CARD_W = 260, ROW_H = 210;
    function fit() {
      if (!roomy.matches) { row.style.removeProperty('--rows'); row.style.removeProperty('--lines'); row.classList.remove('tall'); return; }
      const cs = getComputedStyle(row);
      const h = row.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const n = row.querySelectorAll('.soc-post').length || 1;
      const cols = Math.max(1, Math.floor((row.clientWidth + GAP) / (CARD_W + GAP)));
      const rows = Math.max(1, Math.min(3, Math.floor((h + GAP) / (ROW_H + GAP)), Math.ceil(n / cols)));
      const cell = (h - GAP * (rows - 1)) / rows;
      row.style.setProperty('--rows', rows);
      row.style.setProperty('--lines', Math.max(4, Math.floor((cell - 86) / 19)));
      row.classList.toggle('tall', cell >= 220);
    }
    new ResizeObserver(() => { fit(); edges(); }).observe(row);

    // On a desktop (the owner: the row of same-size cards looked goofy at
    // 4K, "we shouldn't be wasting space"): a wall. Each card as tall as
    // what it holds, pictures in their own shape, every post into the
    // shortest column, so the columns stay level; as many columns as fit
    // at least COL_W, and the page scrolls down. Phones keep the row.
    const wall = document.createElement('div');
    wall.className = 'soc-wall';
    sec.appendChild(wall);
    const COL_W = 300, WALL_MAX = 50;
    // Placed a few rows at a time as you scroll down (their pictures load
    // as they're placed); a card once placed stays in its column. All of
    // them are placed again only when the number of columns changes, or
    // as pictures arrive just after a render (to level the columns by
    // their real heights).
    let cards = [], shown = 0, placeQueued = false, settleUntil = 0;
    const scroller = () => sec.closest('.tab-panel');
    function cols() { return [...wall.children]; }
    // Cards into the shortest columns. Measured all at once (one layout),
    // then moved: measuring each as it went forced a layout per card,
    // dozens a frame while the page filled in ("choppy", the owner).
    function addCards(upTo) {
      const cs = cols();
      if (!cs.length) return;
      const batch = cards.slice(shown, Math.min(upTo, cards.length));
      if (!batch.length) return;
      const h = cs.map(c => c.offsetHeight);
      batch.forEach(c => cs[0].appendChild(c));
      const hs = batch.map(c => c.offsetHeight);
      batch.forEach((c, i) => {
        const at = h.indexOf(Math.min(...h));
        if (c.parentElement !== cs[at]) cs[at].appendChild(c);
        h[at] += hs[i] + GAP;
      });
      shown += batch.length;
    }
    function place() {
      placeQueued = false;
      const desk = roomy.matches;
      sec.classList.toggle('as-wall', desk);
      if (!desk) {
        if (cards.some(c => c.parentElement !== row)) { cards.forEach(c => row.appendChild(c)); wall.textContent = ''; fit(); edges(); }
        return;
      }
      const W = wall.clientWidth;
      if (!W) return; // not showing: the ResizeObserver brings it back
      const n = Math.max(1, Math.floor((W + GAP) / (COL_W + GAP)));
      const keep = Math.max(shown, n * 3);
      wall.textContent = '';
      for (let i = 0; i < n; i++) wall.appendChild(Object.assign(document.createElement('div'), { className: 'soc-wall-col' }));
      shown = 0;
      addCards(keep);
      more();
    }
    // Near the bottom: the next rows.
    function more() {
      const sc = scroller();
      if (!sec.classList.contains('as-wall') || shown >= cards.length || !sc) return;
      const bottom = Math.min(...cols().map(c => c.getBoundingClientRect().bottom));
      if (bottom < sc.getBoundingClientRect().bottom + 600) { addCards(shown + cols().length * 2); requestAnimationFrame(more); }
    }
    const queuePlace = () => { if (!placeQueued) { placeQueued = true; requestAnimationFrame(place); } };
    let lastW = 0;
    new ResizeObserver(() => { if (wall.clientWidth !== lastW) { lastW = wall.clientWidth; queuePlace(); } }).observe(wall);
    roomy.addEventListener('change', queuePlace);
    requestAnimationFrame(() => scroller()?.addEventListener('scroll', more, { passive: true }));
    wall.addEventListener('load', () => { if (performance.now() < settleUntil) queuePlace(); }, true);
    const page = dir => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
    sec.querySelector('.mh-row-nav.prev').addEventListener('click', () => page(-1));
    sec.querySelector('.mh-row-nav.next').addEventListener('click', () => page(1));
    sec.addEventListener('click', e => {
      const card = e.target.closest('.soc-post');
      if (card) window.klabFeedFocus?.(+card.dataset.post);
    });
    // Markdown, links and mentions read as their text here: a card is a glimpse.
    const plain = t => String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_~`>#|=]+/g, '').trim();
    function avatar(u) {
      const url = window.klabResolveUserAvatar?.(u);
      return '<span class="soc-post-av">' + (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
    }
    // A post's picture, or the cover of the song it shares: shown when the
    // cards are tall enough to hold one (.tall, from fit()).
    function pic(p) {
      if (p.image_mxc) return window.klabFeedImage?.(p.image_mxc) || null;
      const c = p.song?.coverArt;
      return c && typeof ND_URL !== 'undefined' ? ND_URL + '/rest/getCoverArt?id=' + encodeURIComponent(c) + '&size=' + klabArtSize(300) + '&' + subsonicParams() : null;
    }
    // One card per post, kept while it's the same: every avatar or picture
    // that arrived used to rebuild all fifty and put the wall back to its
    // first rows, so the page shrank under you and lost your place.
    const built = new Map(); // post id -> { key, el }
    let lastKey = '';
    function cardHTML(p) {
      const reacts = Object.values(p.reactions || {}).reduce((n, r) => n + (r.count || 0), 0);
      const text = plain(p.text) || (p.image_mxc ? 'Posted a picture' : p.song ? 'Shared ' + (p.song.title || 'a song') : '');
      // A few words on their own read big, as in the Feed.
      const short = !pic(p) && text.length <= 80;
      return '<div class="soc-post' + (short ? ' short' : '') + '" role="link" tabindex="0" data-post="' + p.id + '">' +
        '<div class="soc-post-who">' + avatar(p.username) +
          '<span class="soc-post-name" style="color:' + (typeof profileColor === 'function' ? profileColor(p.username) : 'inherit') + '">' + esc(p.username) + '</span>' +
          '<span class="soc-post-when" data-t="' + apiTime(p.created) + '">' + klabRelativeTime(apiTime(p.created)) + '</span></div>' +
        '<div class="soc-post-text">' + esc(text) + '</div>' +
        (pic(p) ? '<div class="soc-post-pic"><img src="' + esc(pic(p)) + '" alt="" loading="lazy" /></div>' : '') +
        '<div class="soc-post-meta">' +
          (p.reply_count ? '<span><i class="ti ti-message-circle"></i>' + p.reply_count + '</span>' : '') +
          (reacts ? '<span><i class="ti ti-mood-smile"></i>' + reacts + '</span>' : '') + '</div>' +
      '</div>';
    }
    function render(list) {
      if (!list) return;
      if (!roomy.matches) list = list.slice(0, 12);
      const keyOf = p => p.id + ':' + p.text + ':' + (p.reply_count || 0) + ':' + JSON.stringify(p.reactions || {}) + ':' + !!window.klabResolveUserAvatar?.(p.username) + ':' + (pic(p) || '');
      const keys = list.map(keyOf);
      const key = keys.join('|');
      if (key === lastKey) { refreshTimes(); return; }
      lastKey = key;
      if (!list.length) {
        built.clear();
        row.innerHTML = '<div class="soc-home-empty">No posts yet.</div>';
        cards = []; shown = 0; wall.textContent = '';
        return;
      }
      const tmp = document.createElement('div');
      const seen = new Set();
      cards = list.map((p, i) => {
        seen.add(p.id);
        let b = built.get(p.id);
        if (!b || b.key !== keys[i]) {
          tmp.innerHTML = cardHTML(p);
          const el = tmp.firstElementChild;
          b?.el.replaceWith(el); // in place, wherever the wall has it
          built.set(p.id, b = { key: keys[i], el });
        }
        return b.el;
      });
      for (const [id, b] of built) if (!seen.has(id)) { b.el.remove(); built.delete(id); }
      row.querySelector('.soc-home-empty')?.remove();
      // In the flick row (phones) the order is the list's; on the wall,
      // place() deals them into columns again, as many as were showing.
      if (!roomy.matches) cards.forEach(c => row.appendChild(c));
      settleUntil = performance.now() + 1500;
      fit();
      edges();
      place();
    }
    function refreshTimes() {
      row.querySelectorAll('.soc-post-when[data-t]').forEach(el => { el.textContent = klabRelativeTime(+el.dataset.t); });
    }
    // Keyboard: the cards are links.
    sec.addEventListener('keydown', e => {
      const card = e.target.closest('.soc-post');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
    });
    return { el: sec, render, max: WALL_MAX, load: () => window.klabLoadFeed?.().then(() => render(window.klabFeedPosts?.(WALL_MAX))) };
  })();
  // Feed tells Home when its posts change; Social's home listens in too.
  const homeFeedChanged = window.klabHomeFeedChanged;
  window.klabHomeFeedChanged = list => {
    homeFeedChanged?.(list);
    if (active) posts.render(window.klabFeedPosts?.(posts.max) || list);
  };

  // Unread messages, first thing on Social's home: the conversations
  // with something new, each one a press away. Before this, Social's
  // badge was the only sign, and nothing on the page said where to go.
  const unread = (() => {
    const head = label('Unread messages');
    const el = document.createElement('div');
    el.className = 'soc-unread';
    el.setAttribute('role', 'list');
    head.hidden = el.hidden = true;
    el.addEventListener('click', e => {
      const row = e.target.closest('[data-room]');
      if (!row) return;
      SFX?.play('nav');
      openChatRoom(row.dataset.room);
    });
    let lastKey = '';
    function render() {
      const list = (window.klabChatUnread?.() || []).slice(0, 6);
      const key = list.map(c => c.roomId + ':' + c.ts + ':' + c.text).join('|');
      if (key === lastKey) { el.querySelectorAll('[data-t]').forEach(t => { t.textContent = klabRelativeTime(+t.dataset.t); }); return; }
      lastKey = key;
      head.hidden = el.hidden = !list.length;
      el.innerHTML = list.map(c => {
        const face = c.isDm && window.klabResolveUserAvatar?.(c.user);
        const color = c.isDm && typeof profileColor === 'function' ? profileColor(c.user || c.name) : '';
        const lead = c.isDm
          ? '<span class="soc-unread-face" style="--c:' + color + '">' + (face ? '<img src="' + esc(face) + '" alt="" />' : esc((c.user || c.name || '?')[0].toUpperCase())) + '</span>'
          : '<span class="soc-unread-face hash">#</span>';
        return '<button type="button" class="soc-unread-row" role="listitem" data-room="' + esc(c.roomId) + '" data-silent>' + lead +
          '<span class="soc-unread-tx"><span class="soc-unread-top"><span class="soc-unread-name"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(c.isDm ? (c.user || c.name) : c.name) + '</span>' +
          (c.ts ? '<span class="soc-unread-when" data-t="' + c.ts + '">' + klabRelativeTime(c.ts) + '</span>' : '') + '</span>' +
          '<span class="soc-unread-last">' + esc(c.text) + '</span></span></button>';
      }).join('');
    }
    return { head, el, render };
  })();
  window.klabChatUnreadChanged = () => { if (active) unread.render(); };

  body.append(unread.head, unread.el);
  if (photos) body.append(label('New photos'), photos.el, photos.empty);
  body.append(label('Latest posts'), posts.el);

  function paintSub() {
    const n = window.KLAB_ONLINE_USERNAMES?.size || 0;
    sub.textContent = n ? n + ' online' : '';
  }
  let timer = 0;
  function refresh() {
    if (!active || document.hidden) return;
    unread.render();
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
