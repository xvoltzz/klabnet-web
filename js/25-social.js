// ══════════════════════════════════════════
//  SOCIAL — Feed, Chat and Photos as one page, laid out like Music.
//    · The sidebar (#socSidebar in index.html) holds Social's own home,
//      Feed, Photos' views and Chat's people and conversations. Pressing
//      something in it that belongs to another of the four pages goes there.
//    · Social's home is Music Home's kind of page, kept quiet: the newest
//      photos in a Cover Flow and the latest posts in a row. It only
//      fetches while it's showing.
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
  // Timeline or What's new from elsewhere: Photos, in that order.
  $('phSideViews')?.addEventListener('click', e => {
    if (!on('photos') && e.target.closest('#phOrder button')) setActiveTab('photos');
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

  // New photos: the newest uploads, a photo per cover.
  const photos = (() => {
    let loadedAt = 0, keys = '';
    const f = window.klabCoverFlow?.({
      label: 'New photos',
      cover: it => photoFile(it.ph.id, 'thumb'),
      hires: it => photoFile(it.ph.id, 'medium'),
      caption: it => ({
        t: it.post.text || (it.post.photos.length > 1 ? it.post.photos.length + ' photos' : 'A photo'),
        a: [it.post.username, it.post.shot_at ? shotFmt.format(new Date(apiTime(it.post.shot_at))) : ''].filter(Boolean).join(' · '),
      }),
      actions: it => [
        { label: 'Open', icon: 'ti-photo', primary: true, run: () => window.klabOpenPhoto?.(it.post.id, it.ph.id) },
        { label: 'Slideshow', run: () => { setActiveTab('photos'); window.klabSlideshow?.open(); } },
      ],
      open: it => window.klabOpenPhoto?.(it.post.id, it.ph.id),
    });
    if (!f) return null;
    f.el.classList.add('soc-flow');
    async function load() {
      if (Date.now() - loadedAt < REFRESH_MS) { f.render(); return; }
      try {
        const r = await fetchTimeout('/api/posts/photos?order=posted&limit=12', {}, 8000);
        if (!r.ok) throw new Error('status ' + r.status);
        const items = [];
        ((await r.json()).posts || []).forEach(post => (post.photos || []).forEach(ph => { if (items.length < 24) items.push({ post, ph }); }));
        loadedAt = Date.now();
        const k = items.map(it => it.ph.id).join();
        // The same photos: leave it where you'd flicked it to.
        if (k === keys) { f.render(); return; }
        keys = k;
        f.set(items, 0, { keyOf: it => it.ph.id });
        empty.hidden = !!items.length;
      } catch (e) { if (!keys) { f.el.hidden = true; empty.hidden = false; } }
    }
    const empty = document.createElement('div');
    empty.className = 'soc-home-empty';
    empty.textContent = 'No photos yet.';
    empty.hidden = true;
    return { el: f.el, empty, load };
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
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  // Loaded straight onto #social: the tab was set before this file was.
  if (on('social')) window.klabSocialTabChanged(true);
})();
