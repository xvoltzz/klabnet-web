// ══════════════════════════════════════════
//  THE RECAP (the bell in the title bar)
//  "Just lets u know things that got posted or shared or if someone texts
//  u. a quick little klabnet recap" (the owner, 2026-11-02).
//    · For you: unread messages (Matrix, window.klabChatUnread), replies
//      to your posts, @mentions, reactions to your posts, photos you were
//      tagged in (klabnet-api GET /api/posts/recap?since=).
//    · Around klabnet: new posts, photos, songs shared, playlists
//      featured, stations made, counted, each a row that goes there.
//  The bell's count is what's for you and new since you last opened it
//  (localStorage klabnet_recap_seen, a Unix time). Opening it shows the
//  last day at least, the new ones marked, and counts them as seen.
//  Polled every 2 minutes while the window's showing.
// ══════════════════════════════════════════
(function () {
  const btn = document.getElementById('recapBtn');
  const countEl = document.getElementById('recapCount');
  if (!btn || !countEl) return;
  const SEEN_KEY = 'klabnet_recap_seen';
  const POLL_MS = 120e3;
  const DAY = 86400;
  let seen = 0;
  try { seen = +localStorage.getItem(SEEN_KEY) || 0; } catch (e) {}
  if (!seen) { seen = Date.now() / 1000 - DAY; }
  let data = null, missing = false, panel = null, timer = 0, loading = null;

  const now = () => Date.now() / 1000;
  const t = iso => (Date.parse(iso) || 0) / 1000;
  const me = () => window.KLAB_USER?.username;
  const names = list => {
    const n = (list || []).filter(Boolean);
    if (n.length <= 2) return n.map(esc).join(' and ');
    return n.slice(0, 2).map(esc).join(', ') + ' and ' + (n.length - 2) + (n.length - 2 === 1 ? ' other' : ' others');
  };
  const who = u => '<b>' + esc(u) + '</b>';
  const ago = s => typeof shortAgo === 'function' ? shortAgo(s * 1000) : '';

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const since = Math.min(seen, now() - DAY);
        const r = await fetchTimeout('/api/posts/recap?since=' + Math.floor(since), {}, 10000);
        if (r.status === 404 || r.status === 405 || !/json/.test(r.headers.get('content-type') || '')) { missing = true; return; }
        if (!r.ok) return;
        data = await r.json();
        missing = false;
      } catch (e) {} finally { loading = null; }
    })();
    await loading;
    paintCount();
    if (panel) paint();
  }

  // ── The count on the bell ──
  function chats() { try { return window.klabChatUnread?.() || []; } catch (e) { return []; } }
  function newForYou() { return (data?.forYou || []).filter(i => t(i.at) > seen); }
  function paintCount() {
    const n = newForYou().length + chats().length;
    countEl.hidden = !n;
    countEl.textContent = n > 99 ? '99+' : String(n);
    btn.classList.toggle('has-new', n > 0);
    btn.setAttribute('aria-label', n ? 'Recap, ' + n + ' new' : 'Recap');
  }
  // Chat's unread changes: the count follows.
  if (typeof updateSocialUnreadBadge === 'function') {
    const base = updateSocialUnreadBadge;
    updateSocialUnreadBadge = function () { const r = base.apply(this, arguments); paintCount(); return r; };
  }

  // ── The panel ──
  function face(u) {
    const src = window.klabResolveUserAvatar?.(u);
    const c = typeof profileColor === 'function' ? profileColor(u) : 'var(--text)';
    return '<span class="rc-face">' + (src ? '<img src="' + esc(src) + '" alt="" />' : '<b style="--c:' + c + '">' + esc((u || '?')[0].toUpperCase()) + '</b>') + '</span>';
  }
  function row({ act, data: d = '', u, icon, html, sub, at, fresh }) {
    return '<button type="button" class="rc-row' + (fresh ? ' fresh' : '') + '" data-act="' + act + '" data-d="' + esc(String(d)) + '">' +
      (u ? face(u) : '<span class="rc-ico"><i class="ti ' + icon + '"></i></span>') +
      '<span class="rc-text"><span class="rc-line">' + html + '</span>' + (sub ? '<span class="rc-sub">' + sub + '</span>' : '') + '</span>' +
      (at ? '<span class="rc-time">' + esc(ago(at)) + '</span>' : '') + '</button>';
  }
  function forYouRows() {
    const out = [];
    for (const c of chats()) {
      out.push({ at: c.ts / 1000, html: row({
        act: 'chat', data: c.roomId, u: c.isDm ? c.user : null, icon: 'ti-message-circle', fresh: true,
        html: c.isDm ? who(c.user || c.name) + ' messaged you' : 'New in ' + who(c.name),
        sub: esc(c.text || ''), at: c.ts / 1000,
      }) });
    }
    for (const i of data?.forYou || []) {
      const at = t(i.at), fresh = at > seen;
      let html = '', sub = '';
      if (i.kind === 'reply') { html = who(i.who[0]) + ' replied to your post'; sub = esc(i.text); }
      else if (i.kind === 'mention') { html = who(i.who[0]) + ' mentioned you' + (i.reply ? ' in a reply' : ''); sub = esc(i.text); }
      else if (i.kind === 'react') { html = names(i.who) + ' reacted ' + i.emoji.slice(0, 4).map(e => window.klabEmojiKey ? window.klabEmojiKey(e) : esc(e)).join(''); sub = i.photo ? 'to your photos' : esc(i.on ? '“' + i.on + '”' : 'to your post'); }
      else if (i.kind === 'tag') { html = who(i.who[0]) + ' tagged you in photos'; sub = esc(i.text || ''); }
      else continue;
      out.push({ at, html: row({ act: i.kind === 'tag' || i.photo ? 'photos' : 'post', data: i.postId, u: i.who[0], html, sub, at, fresh }) });
    }
    return out.sort((a, b) => b.at - a.at).map(r => r.html).join('');
  }
  function aroundRows() {
    const a = data?.around;
    if (!a) return '';
    let h = '';
    if (a.posts) h += row({ act: 'feed', icon: 'ti-news', html: '<b>' + klabCount(a.posts, 'new post') + '</b> from ' + names(a.postPeople),
      sub: a.latest?.[0] ? esc(a.latest[0].who + ': ' + (a.latest[0].text || (a.latest[0].song ? 'shared a song' : ''))) : '' });
    if (a.photos) h += row({ act: 'photos', icon: 'ti-photo', html: '<b>' + klabCount(a.photos, 'new photo') + '</b> from ' + names(a.photoPeople) });
    if (a.songCount) h += row({ act: 'post', data: a.songs[0].postId, icon: 'ti-music', html: '<b>' + klabCount(a.songCount, 'song') + '</b> shared',
      sub: a.songs.slice(0, 3).map(s => esc(s.title) + (s.artist ? ' · ' + esc(s.artist) : '')).join(', ') });
    for (const p of a.playlists || []) h += row({ act: 'playlist', data: p.id, icon: 'ti-playlist', html: who(p.who) + ' featured a playlist', sub: esc(p.name) });
    for (const s of a.stations || []) h += row({ act: 'radio', data: s.id, icon: 'ti-radio', html: 'New station: <b>' + esc(s.name) + '</b>', sub: (s.frequency ? s.frequency.toFixed(1) + ' FM · ' : '') + 'by ' + esc(s.who) });
    return h;
  }
  function paint() {
    if (!panel) return;
    const body = panel.querySelector('.rc-body');
    if (missing && !chats().length) { body.innerHTML = '<p class="rc-empty">The recap needs the latest klabnet-api.</p>'; return; }
    if (!data && !chats().length) { body.innerHTML = '<p class="rc-empty">Loading…</p>'; return; }
    const mine = forYouRows(), around = aroundRows();
    const since = data ? Math.min(seen, now() - DAY) : 0;
    panel.querySelector('.rc-since').textContent = since ? 'Since ' + (now() - since < DAY + 60 ? 'yesterday' : ago(since) + ' ago') : '';
    body.innerHTML =
      '<div class="picker-section-label rc-label">For you</div>' + (mine || '<p class="rc-empty">Nothing for you. All caught up.</p>') +
      (around ? '<div class="picker-section-label rc-label">Around klabnet</div>' + around : '');
  }
  function go(act, d) {
    close();
    if (act === 'chat') { setActiveTab('chat'); openChatRoom?.(d); }
    else if (act === 'post') window.klabFeedFocus?.(d);
    else if (act === 'feed') setActiveTab('feed');
    else if (act === 'photos') setActiveTab('photos');
    else if (act === 'playlist') { setActiveTab('music'); setTimeout(() => window.openPlaylistPage?.(d), 60); }
    else if (act === 'radio') { setActiveTab('music'); setTimeout(() => { document.querySelector('.music-nav .picker-tab[data-tab="radio"]')?.click(); window.klabRadio?.tune?.(d); }, 60); }
  }
  function open() {
    if (panel) { close(); return; }
    panel = document.createElement('div');
    panel.className = 'rc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Recap');
    panel.innerHTML = '<div class="rc-head"><span class="rc-title">Recap</span><span class="rc-since"></span></div><div class="rc-body"></div>';
    document.body.appendChild(panel);
    place();
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('active');
    paint();
    panel.addEventListener('click', e => { const r = e.target.closest('.rc-row'); if (r) go(r.dataset.act, r.dataset.d); });
    load().then(() => {
      // Seen once it's been looked at; the marks stay until it closes.
      seen = now();
      try { localStorage.setItem(SEEN_KEY, String(Math.floor(seen))); } catch (e) {}
    });
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
    });
    requestAnimationFrame(() => panel?.classList.add('open'));
  }
  function place() {
    const r = btn.getBoundingClientRect();
    const z = typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1;
    panel.style.top = (r.bottom / z + 8) + 'px';
    panel.style.right = Math.max(8, (innerWidth - r.right) / z - 4) + 'px';
  }
  function close() {
    if (!panel) return;
    const p = panel;
    panel = null;
    p.classList.remove('open');
    setTimeout(() => p.remove(), 160);
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('active');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    paintCount();
  }
  function outside(e) { if (panel && !panel.contains(e.target) && !btn.contains(e.target)) close(); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  btn.addEventListener('click', open);
  addEventListener('resize', () => panel && place());
  const tick = () => { if (!document.hidden) load(); };
  document.addEventListener('visibilitychange', tick);
  timer = setInterval(tick, POLL_MS);
  // After sign-in has settled.
  setTimeout(load, 2500);
  window.klabRecap = { open, close, refresh: load };
})();
