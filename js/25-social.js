// ══════════════════════════════════════════
//  SOCIAL — Feed and Chat as one page, laid out like Music (Photos was
//  one of its pages until 2026-11-19; it's its own now).
//    · The sidebar (#socSidebar in index.html) holds Social's own home,
//      Feed and Chat's people and conversations. Pressing something in
//      it that belongs to another of its pages goes there.
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

  // A shelf's head, Music Home's way: the label, and "See all" at its end.
  function shelfHead(text, go) {
    const el = document.createElement('div');
    el.className = 'soc-shelf-head';
    el.innerHTML = '<span class="k-label"></span><button type="button" class="soc-see-all">See all<i class="ti ti-chevron-right"></i></button>';
    el.firstChild.textContent = text;
    el.lastChild.addEventListener('click', () => { SFX?.play('nav'); go(); });
    return el;
  }

  // From Photos: one row of the newest uploads at their own shapes, as
  // many as fit the width, the row a fixed height (it was a collage that
  // stretched a few photos to fill half the window). Still; a photo opens
  // in Photos.
  const photos = (() => {
    const el = document.createElement('div');
    el.className = 'soc-strip';
    el.setAttribute('role', 'list');
    el.setAttribute('aria-label', 'New photos');
    el.hidden = true;
    const empty = document.createElement('div');
    empty.className = 'k-com-empty soc-home-empty';
    empty.textContent = 'No photos yet.';
    empty.hidden = true;
    let items = [], keys = '', loadedAt = 0;
    const aspect = it => Math.max(0.6, Math.min(2, it.ph.w && it.ph.h ? it.ph.w / it.ph.h : 1.5));
    function fill() {
      const W = el.clientWidth, H = parseFloat(getComputedStyle(el).height) || 180;
      if (!W) return;
      // As many as fill the row (the last may be cropped a little).
      let sum = 0, n = 0;
      for (const it of items) { if (n && (sum + aspect(it)) * H > W * 1.08) break; sum += aspect(it); n++; }
      const want = items.slice(0, Math.max(1, n));
      const k = want.map(it => it.ph.id).join();
      if (el._k === k) return;
      el._k = k;
      el.innerHTML = want.map(it => {
        const who = [it.post.username, it.post.shot_at ? shotFmt.format(new Date(apiTime(it.post.shot_at))) : ''].filter(Boolean).join(' · ');
        return '<button type="button" class="soc-tile" role="listitem" data-post="' + it.post.id + '" data-photo="' + esc(it.ph.id) + '" data-user="' + esc(it.post.username) + '"' +
          ' style="flex:' + aspect(it).toFixed(3) + ' 1 0" aria-label="' + esc((it.post.text || 'Photo') + (who ? ', ' + who : '')) + '" data-silent>' +
          '<img alt="" decoding="async" loading="lazy" draggable="false" src="' + esc(photoFile(it.ph.id, 'thumb')) + '" onload="this.parentNode.classList.add(\'loaded\')">' +
          '<span class="soc-tile-cap">' + esc(who) + '</span></button>';
      }).join('');
    }
    new ResizeObserver(() => { if (items.length) fill(); }).observe(el);
    el.addEventListener('click', e => {
      const t = e.target.closest('.soc-tile');
      if (t) { SFX?.play('nav'); window.klabOpenPhoto?.(+t.dataset.post, t.dataset.photo); }
    });
    el.addEventListener('contextmenu', e => {
      const t = e.target.closest('.soc-tile');
      if (!t) return;
      klabMenu(e, [
        { header: t.dataset.user },
        { label: 'Open in Photos', icon: 'ti-photo', action: () => window.klabOpenPhoto?.(+t.dataset.post, t.dataset.photo) },
        { label: 'Copy image', icon: 'ti-copy', action: () => klabCopyImage(photoFile(t.dataset.photo, 'medium')) },
        '-',
        { label: 'View profile', icon: 'ti-user-circle', action: () => openProfileView(t.dataset.user) },
      ]);
    });
    async function load() {
      if (Date.now() - loadedAt < REFRESH_MS) { fill(); return; }
      try {
        const r = await fetchTimeout('/api/posts/photos?order=posted&limit=12', {}, 8000);
        if (!r.ok) throw new Error('status ' + r.status);
        const got = [];
        ((await r.json()).posts || []).forEach(post => (post.photos || []).forEach(ph => { if (got.length < 20) got.push({ post, ph }); }));
        loadedAt = Date.now();
        empty.hidden = !!got.length;
        el.hidden = !got.length;
        if (!got.length) { keys = ''; empty.textContent = 'No photos yet.'; return; }
        const k = got.map(it => it.ph.id).join();
        if (k !== keys) { keys = k; items = got; el._k = ''; }
        requestAnimationFrame(fill);
      } catch (e) { if (!keys) { el.hidden = true; empty.textContent = 'Couldn’t load photos just now.'; empty.hidden = false; } }
    }
    return { el, empty, load, stop: () => {} };
  })();

  // New videos: one row of Videos' own cards.
  const videos = (() => {
    const el = document.createElement('div');
    el.className = 'vid-shelf soc-videos';
    el.hidden = true;
    const empty = document.createElement('div');
    empty.className = 'k-com-empty soc-home-empty';
    empty.hidden = true;
    let loadedAt = 0, key = '', vids = [];
    el.addEventListener('click', e => {
      const c = e.target.closest('.vid-card[data-vid-id]');
      if (c) { SFX?.play('nav'); window.klabOpenVideo?.(+c.dataset.vidId); }
    });
    el.addEventListener('contextmenu', e => {
      const c = e.target.closest('.vid-card[data-vid-id]');
      const v = c && vids.find(x => x.id === +c.dataset.vidId);
      if (!v) return;
      klabMenu(e, [
        { header: v.title || 'Untitled' },
        { label: 'Open', icon: 'ti-player-play', disabled: v.status !== 'ready', action: () => window.klabOpenVideo?.(v.id) },
        { label: 'Copy link', icon: 'ti-link', action: () => klabCopy(location.origin + location.pathname + '#videos/' + v.id, 'Link') },
        '-',
        { label: 'Go to channel', icon: 'ti-user', action: () => window.klabOpenChannel?.(v.username) },
        { label: 'View profile', icon: 'ti-user-circle', action: () => openProfileView(v.username) },
      ]);
    });
    async function load() {
      if (Date.now() - loadedAt < REFRESH_MS) return;
      try {
        const r = await fetchTimeout('/api/posts/videos?limit=8&sort=new', {}, 8000);
        if (r.status === 404 || r.status === 405) { el.hidden = empty.hidden = true; head.hidden = true; return; }
        if (!r.ok) throw new Error('status ' + r.status);
        vids = ((await r.json()).videos || []);
        loadedAt = Date.now();
        head.hidden = false;
        const k = vids.map(v => v.id + ':' + v.status + ':' + v.views).join();
        if (k === key) return;
        key = k;
        el.hidden = !vids.length;
        empty.hidden = !!vids.length;
        empty.textContent = 'No videos yet.';
        el.innerHTML = vids.map(v => window.klabVideoCardHTML ? klabVideoCardHTML(v) : '').join('');
      } catch (e) { if (!key) { el.hidden = true; empty.textContent = 'Couldn’t load videos just now.'; empty.hidden = false; } }
    }
    const head = shelfHead('New videos', () => setActiveTab('videos'));
    head.hidden = true;
    return { el, empty, head, load };
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
    // A glimpse, not the Feed: the newest dozen, then "See all".
    const COL_W = 300, WALL_MAX = 12;
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
    sec.addEventListener('contextmenu', e => {
      const card = e.target.closest('.soc-post');
      const p = card && (window.klabFeedPosts?.(WALL_MAX) || []).find(x => x.id === +card.dataset.post);
      if (!p) return;
      const me = window.KLAB_USER?.username;
      klabMenu(e, [
        { header: p.username },
        { label: 'Open in Feed', icon: 'ti-news', action: () => window.klabFeedFocus?.(p.id) },
        { label: 'Copy text', icon: 'ti-copy', hidden: !p.text, action: () => klabCopy(p.text, 'Post') },
        '-',
        { label: 'View profile', icon: 'ti-user-circle', action: () => openProfileView(p.username) },
        { label: 'Message', icon: 'ti-message-2-plus', hidden: p.username === me, action: () => messageUser(p.username) },
      ]);
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
        row.innerHTML = '<div class="soc-home-empty">No posts yet</div>';
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

  // Unread messages, then the latest posts, then a strip of photos and a
  // row of videos, each with "See all" (it was a collage of photos first).
  body.append(unread.head, unread.el);
  body.append(shelfHead('Latest posts', () => setActiveTab('feed')), posts.el);
  body.append(shelfHead('From Photos', () => setActiveTab('photos')), photos.el, photos.empty);
  body.append(videos.head, videos.el, videos.empty);

  function paintSub() {
    const n = window.KLAB_ONLINE_USERNAMES?.size || 0;
    sub.textContent = n ? n + ' online' : '';
  }
  let timer = 0;
  function refresh() {
    if (!active || document.hidden) return;
    unread.render();
    photos?.load();
    videos.load();
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
