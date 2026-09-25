// ══════════════════════════════════════════
//  HOME — the newest of everything on one screen, meant to be left open.
//    · A spotlight cycles through the latest highlights (feed posts, the
//      newest photo post, the newest album), newest first. Something new
//      arriving takes it over straight away.
//    · Around it: latest posts, who's listening, new albums in a small
//      Cover Flow, the newest photos, and the latest chat in channels (never
//      DMs; this screen is meant to sit on a second monitor).
//    · One line up top says what just happened.
//  Labels are kept to one quiet word per tile ("Featured", "Feed", …).
//  It only polls while Home is showing and the page is visible. "Today" is
//  Eastern time, where everyone is.
// ══════════════════════════════════════════
(function() {
  const panel = document.querySelector('.tab-panel[data-tab-panel="home"]');
  if (!panel) return;
  const TZ = 'America/New_York';
  const $ = id => document.getElementById(id);
  const dateEl = $('hmDate'), clockEl = $('hmClock'), liveEl = $('hmLive'), liveEvEl = $('hmLiveEv');
  const spotEl = $('hmSpot'), slidesEl = $('hmSlides'), barsEl = $('hmBars'), arriveEl = $('hmArrive');
  const musicEl = $('hmMusic');
  const postsEl = $('hmPosts'), listenEl = $('hmListen'), flowEl = $('hmFlow'), photosEl = $('hmPhotos'), chatEl = $('hmChat');
  const bdLayers = $('hmBackdrop').children;

  const SLIDE_MS = 9000;
  const POLL = { posts: 30e3, photos: 60e3, presence: 10e3, albums: 5 * 60e3 };
  const S = { posts: null, photoPosts: null, listeners: null, albums: null, chat: null };
  let active = false;
  const me = () => window.KLAB_USER?.username;
  const motion = () => (window.klabMotionOk ? window.klabMotionOk() : true);

  // ── helpers ──
  // The API's timestamps are SQLite UTC ("YYYY-MM-DD HH:MM:SS", no zone).
  const apiTime = s => {
    if (!s) return 0;
    const str = String(s);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime() || 0;
  };
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return new Date(t).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  }
  const timeHTML = t => '<span class="hm-t" data-t="' + t + '">' + ago(t) + '</span>';
  const cover = (id, size) => id ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(id)}&size=${size}&${subsonicParams()}` : '';
  const photoFile = (id, size) => `/api/posts/photos/files/${id}/${size}?v=2`;
  const localpart = mxid => String(mxid || '').replace(/^@/, '').split(':')[0];
  const color = u => (typeof profileColor === 'function' ? profileColor(u) : 'inherit');
  function avatarHTML(u) {
    const url = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(u) : null;
    const online = window.KLAB_ONLINE_USERNAMES?.has?.(u);
    return '<span class="hm-av' + (online ? ' on' : '') + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  const nameHTML = u => '<span class="hm-name" style="color:' + color(u) + '">' + esc(u) + '</span>';
  // Markdown posts shown as plain text in previews.
  const plainCache = new Map();
  function plain(md) {
    if (!md) return '';
    let v = plainCache.get(md);
    if (v !== undefined) return v;
    if (window.klabMarkdown) {
      const d = document.createElement('div');
      d.innerHTML = klabMarkdown(md, me());
      d.querySelectorAll('.md-spoiler').forEach(s => { s.textContent = '▒▒▒▒'; });
      d.querySelectorAll('br').forEach(b => b.replaceWith(' '));
      d.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, pre, tr').forEach(b => b.append(' '));
      v = d.textContent;
    } else v = md;
    v = v.replace(/\s+/g, ' ').trim();
    if (plainCache.size > 200) plainCache.delete(plainCache.keys().next().value);
    plainCache.set(md, v);
    return v;
  }
  // Posts render as markdown here too, just smaller.
  const mdHTML = text => window.klabMarkdown ? klabMarkdown(text, me()) : esc(plain(text));
  const lbl = t => '<div class="hm-lbl">' + t + '</div>';

  async function getJSON(url) {
    const r = await fetchTimeout(url, {}, 8000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ── backdrop, like the Photos tab's ──
  let bdI = 0, bdKey = '';
  function setBackdrop(img, tint) {
    const key = img || tint || '';
    if (!key || key === bdKey) return;
    bdKey = key;
    bdI ^= 1;
    const layer = bdLayers[bdI];
    layer.style.backgroundImage = img ? 'url("' + img + '")' : 'radial-gradient(circle at 40% 45%, ' + tint + ', transparent 62%)';
    layer.classList.add('on');
    bdLayers[bdI ^ 1].classList.remove('on');
  }

  // ── clock (Eastern) ──
  let lastMinute = '';
  function tickClock() {
    const d = new Date();
    const clock = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    if (clock === lastMinute) return;
    lastMinute = clock;
    // An old LCD clock: unlit "88:88" segments behind the lit digits.
    // "!" is DSEG's blank digit, so 9:05 sits right-aligned like 12:05.
    const m = /(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(clock);
    if (m) {
      const h = m[1].length === 1 ? '!' + m[1] : m[1];
      clockEl.innerHTML = '<span class="hm-lcd" aria-hidden="true"><span class="hm-lcd-ghost">88:88</span>' +
        '<span class="hm-lcd-now">' + h + '<span class="hm-lcd-colon">:</span>' + m[2] + '</span></span>' +
        (m[3] ? '<span class="hm-ampm">' + m[3].toUpperCase() + '</span>' : '');
      clockEl.setAttribute('aria-label', clock);
    } else clockEl.textContent = clock;
    dateEl.textContent = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
    // Relative times move on with the clock.
    panel.querySelectorAll('.hm-t[data-t]').forEach(el => { el.textContent = ago(+el.dataset.t); });
  }

  // ── what just happened ──
  // On first load it shows the newest thing across every source. After
  // that, anything Home hasn't seen before is shown the moment it arrives:
  // the sources poll at different rates, so comparing times across them
  // would quietly skip a post that landed between two presence polls.
  let liveT = 0, liveReady = false;
  const liveSeen = new Set();
  setTimeout(() => { liveReady = true; }, 8000);
  function live(key, t, html) {
    const fresh = !liveSeen.has(key);
    liveSeen.add(key);
    if (liveReady ? !fresh : t < liveT) return;
    liveT = Math.max(liveT, t);
    liveEl.hidden = false;
    liveEvEl.classList.remove('swap');
    void liveEvEl.offsetWidth;
    liveEvEl.innerHTML = html;
    liveEvEl.classList.add('swap');
  }

  // ── spotlight ──
  let slides = [], cur = 0, slideTimer = 0, slideSig = '', newestKey = null;
  const openPost = id => (window.klabFeedFocus ? window.klabFeedFocus(id) : setActiveTab('feed'));
  const openPhoto = (postId, photoId) => (window.klabOpenPhoto ? window.klabOpenPhoto(postId, photoId) : setActiveTab('photos'));
  function postSlide(p) {
    const t = apiTime(p.created), u = p.username;
    const who = '<div class="hm-who">' + avatarHTML(u) + nameHTML(u) + timeHTML(t) + '</div>';
    const go = () => openPost(p.id);
    const text = plain(p.text);
    if (p.song) {
      const art = cover(p.song.coverArt, 600);
      return { key: 'p' + p.id, t, img: cover(p.song.coverArt, 300), go, dark: true, kind: 'Song',
        html: '<div class="hm-blur" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' +
          '<div class="hm-content">' + who + '<div class="hm-album">' +
            (art ? '<div class="hm-cv" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' : '') +
            '<div>' + (text ? '<div class="hm-say">' + esc(text) + '</div>' : '') + '<b>' + esc(p.song.title || '') + '</b><span>' + esc(p.song.artist || '') + '</span></div>' +
          '</div></div>' };
    }
    const img = p.image_mxc && window.klabResolveFeedImage ? window.klabResolveFeedImage(p.image_mxc) : null;
    if (img) {
      return { key: 'p' + p.id + 'i', t, img, go, dark: true, kind: 'Post',
        html: '<div class="hm-img" style="background-image:url(&quot;' + esc(img) + '&quot;)"></div>' +
          '<div class="hm-content">' + who + (text ? '<div class="hm-cap">' + esc(text) + '</div>' : '') + '</div>' };
    }
    if (!text) return null;
    return { key: 'p' + p.id, t, tint: color(u), go, kind: 'Post',
      html: '<div class="hm-tint" style="background:radial-gradient(circle at 18% 95%, ' + color(u) + ', transparent 62%)"></div>' +
        '<div class="hm-content">' + who + '<div class="hm-big md' + (text.length > 140 ? ' long' : '') + '">' + mdHTML(p.text) + '</div></div>' };
  }
  function photoSlide(pp) {
    const ph = pp.photos && pp.photos[0];
    if (!ph) return null;
    const t = apiTime(pp.created), u = pp.username, ex = ph.exif || {};
    const chips = [ex.camera, ex.focal, ex.aperture, ex.shutter, ex.iso && ('ISO ' + String(ex.iso).replace(/^ISO\s*/i, '')), ex.film].filter(Boolean);
    return { key: 'ph' + pp.id, t, img: photoFile(ph.id, 'thumb'), go: () => openPhoto(pp.id, ph.id), dark: true, kind: 'Photos',
      // The 1440px copy: the spotlight is never wider than ~1,500 device px.
      html: '<div class="hm-img" style="background-image:url(&quot;' + photoFile(ph.id, 'medium') + '&quot;)"></div>' +
        '<div class="hm-content"><div class="hm-who">' + avatarHTML(u) + nameHTML(u) + timeHTML(t) +
          (pp.photos.length > 1 ? '<span class="hm-count"><i class="ti ti-photo"></i>' + pp.photos.length + '</span>' : '') + '</div>' +
          (pp.text ? '<div class="hm-cap">' + esc(plain(pp.text)) + '</div>' : '') +
          (chips.length ? '<div class="hm-exif">' + chips.map(c => '<span>' + esc(c) + '</span>').join('') + '</div>' : '') +
        '</div>' };
  }
  function albumSlide(a) {
    const t = a.created ? new Date(a.created).getTime() : 0;
    const art = cover(a.coverArt || a.id, 600);
    return { key: 'al' + a.id, t, img: cover(a.coverArt || a.id, 300), go: () => openAlbum(a), dark: true, kind: 'New album',
      html: '<div class="hm-blur" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' +
        '<div class="hm-content"><div class="hm-album"><div class="hm-cv" style="background-image:url(&quot;' + esc(art) + '&quot;)"></div>' +
          '<div><b>' + esc(a.name || a.title || '') + '</b><span>' + esc(a.artist || '') + (a.year ? ' · ' + a.year : '') + '</span></div></div></div>' };
  }
  function buildSlides() {
    const L = [];
    (S.posts || []).slice(0, 3).forEach(p => L.push(postSlide(p)));
    if (S.photoPosts && S.photoPosts[0]) L.push(photoSlide(S.photoPosts[0]));
    if (S.albums && S.albums[0]) L.push(albumSlide(S.albums[0]));
    return L.filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 5);
  }
  function renderSpot() {
    const next = buildSlides();
    const sig = next.map(s => s.key + ':' + s.html.replace(/<span class="hm-t"[^>]*>[^<]*<\/span>/g, '')).join('|');
    if (sig === slideSig) return;
    const firstPaint = !slideSig;
    slideSig = sig;
    const prevKey = slides[cur]?.key;
    slides = next;
    if (!slides.length) { slidesEl.innerHTML = ''; barsEl.innerHTML = ''; return; }
    // Something new at the top takes over; otherwise stay on what was showing.
    const arrived = !firstPaint && newestKey !== null && slides[0].key !== newestKey && slides[0].t > (Date.now() - 15 * 60e3);
    newestKey = slides[0].key;
    const keep = slides.findIndex(s => s.key === prevKey);
    cur = arrived || keep < 0 ? 0 : keep;
    slidesEl.innerHTML = slides.map((s, i) => '<div class="hm-slide' + (s.dark ? ' dark' : '') + (i === cur ? ' on' : '') + '">' + s.html + lbl('Featured<span>' + s.kind + '</span>') + '</div>').join('');
    // Only the showing slide and the next one load their big images now;
    // the rest wait for their turn (showSlide hydrates them). Moved aside
    // in the same task as the innerHTML, before any fetch can start.
    [...slidesEl.children].forEach((el, i) => {
      if (i === cur || i === (cur + 1) % slides.length) return;
      el.querySelectorAll('[style*="background-image"]').forEach(n => { n.dataset.bg = n.style.backgroundImage; n.style.backgroundImage = ''; });
    });
    barsEl.innerHTML = slides.length > 1 ? slides.map(() => '<b><i></i></b>').join('') : '';
    if (arrived && motion()) { arriveEl.classList.remove('go'); void arriveEl.offsetWidth; arriveEl.classList.add('go'); }
    showSlide(cur);
  }
  function hydrate(i) {
    slidesEl.children[i]?.querySelectorAll('[data-bg]').forEach(n => { n.style.backgroundImage = n.dataset.bg; n.removeAttribute('data-bg'); });
  }
  function showSlide(i) {
    cur = i;
    hydrate(i);
    if (slides.length > 1) hydrate((i + 1) % slides.length);
    [...slidesEl.children].forEach((el, j) => el.classList.toggle('on', j === i));
    [...barsEl.children].forEach((b, j) => {
      b.className = j < i ? 'done' : '';
      if (j === i) { void b.offsetWidth; b.className = 'run'; }
    });
    const s = slides[i];
    if (s && active) setBackdrop(s.img, s.tint);
    clearTimeout(slideTimer);
    if (active && slides.length > 1) slideTimer = setTimeout(() => showSlide((cur + 1) % slides.length), SLIDE_MS);
  }
  spotEl.style.setProperty('--hm-slide', SLIDE_MS + 'ms');
  // Flicking through: arrows, a two-finger swipe, or a drag / touch swipe.
  function flick(dir) {
    if (slides.length < 2) return;
    showSlide((cur + dir + slides.length) % slides.length);
    const el = slidesEl.children[cur];
    if (el && motion()) el.animate([{ transform: `translateX(${dir * 24}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  let dragFrom = null, dragged = false;
  spotEl.addEventListener('click', e => {
    if (dragged) { dragged = false; return; } // the end of a swipe isn't a click
    if (e.target.closest('a, .md-spoiler, .md-code-copy')) return;
    const f = e.target.closest('[data-flick]');
    if (f) { flick(+f.dataset.flick); return; }
    const bar = e.target.closest('.hm-bars b');
    if (bar) { showSlide([...barsEl.children].indexOf(bar)); return; }
    slides[cur]?.go();
  });
  // Trackpad: horizontal wheel movement, one slide per gesture. Taking it
  // also stops the browser reading the swipe as Back.
  let wheelSum = 0, wheelLock = 0, wheelIdle = 0;
  spotEl.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => { wheelSum = 0; }, 160);
    if (Date.now() < wheelLock) return;
    wheelSum += e.deltaX;
    if (Math.abs(wheelSum) > 50) { flick(wheelSum > 0 ? 1 : -1); wheelSum = 0; wheelLock = Date.now() + 550; }
  }, { passive: false });
  spotEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('[data-flick], .hm-bars, a')) return;
    dragFrom = { x: e.clientX, y: e.clientY, z: typeof zoomFactor === 'function' ? zoomFactor() : 1 };
    dragged = false;
  });
  spotEl.addEventListener('pointermove', e => {
    if (!dragFrom) return;
    const dx = (e.clientX - dragFrom.x) / dragFrom.z;
    if (!dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - dragFrom.y)) { dragged = true; spotEl.setPointerCapture?.(e.pointerId); }
    if (dragged) { const el = slidesEl.children[cur]; if (el) el.style.transform = `translateX(${dx * 0.35}px)`; }
  });
  const endDrag = e => {
    if (!dragFrom) return;
    const dx = (e.clientX - dragFrom.x) / dragFrom.z;
    const el = slidesEl.children[cur];
    if (el) el.style.transform = '';
    dragFrom = null;
    if (dragged && Math.abs(dx) > 50) flick(dx < 0 ? 1 : -1);
    else if (dragged) setTimeout(() => { dragged = false; }, 0);
  };
  spotEl.addEventListener('pointerup', endDrag);
  spotEl.addEventListener('pointercancel', endDrag);

  // ── tiles ──
  let postsSig = '', topPostId = null;
  function renderPosts() {
    const list = (S.posts || []).slice(0, 4);
    const html = list.map(p => {
      const t = apiTime(p.created);
      const img = p.song ? cover(p.song.coverArt, 100) : (p.image_mxc && window.klabResolveFeedImage ? window.klabResolveFeedImage(p.image_mxc) : null);
      return '<div class="hm-pi" data-post="' + p.id + '">' + avatarHTML(p.username) +
        '<div class="hm-pi-tx"><div class="hm-pi-hd">' + nameHTML(p.username) + timeHTML(t) + '</div>' +
          (p.song ? '<div class="hm-pi-song"><i class="ti ti-music"></i> ' + esc(p.song.title || '') + (p.song.artist ? ' · ' + esc(p.song.artist) : '') + '</div>' : '') +
          (p.text ? '<div class="hm-pi-md md">' + mdHTML(p.text) + '</div>' : '') + '</div>' +
        (img ? '<div class="hm-th" style="background-image:url(&quot;' + esc(img) + '&quot;)"></div>' : '') +
      '</div>';
    }).join('');
    if (html === postsSig) return;
    postsSig = html;
    postsEl.innerHTML = lbl('Feed') + '<div class="hm-plist">' + html + '</div>';
    // A post that wasn't here a moment ago slides in at the top.
    const topId = list[0]?.id ?? null;
    if (topPostId !== null && topId !== topPostId && motion()) postsEl.querySelector('.hm-pi')?.classList.add('hm-enter');
    topPostId = topId;
  }
  postsEl.addEventListener('click', e => {
    if (e.target.closest('a, .md-spoiler, .md-code-copy')) return;
    const row = e.target.closest('.hm-pi') || postsEl.querySelector('.hm-pi');
    if (row) openPost(+row.dataset.post); else setActiveTab('feed');
  });

  let listenSig = '';
  // "Who's online": the site's own presence cards (banner, what they're
  // playing, their note in quotes), you first. Drawn by the presence
  // module so they look and behave exactly as they always have: click to
  // message, right-click to listen along or see their profile.
  function renderListen() {
    const get = window.klabPresenceCardsHTML;
    if (!get) return;
    const { html, others } = get();
    const full = lbl("Who's online") + '<div class="hm-cards">' + html + '</div>' +
      (others ? '' : '<div class="hm-quiet hm-alone">Just you right now</div>');
    if (full === listenSig) return;
    listenSig = full;
    listenEl.innerHTML = full;
  }
  window.klabHomePresenceChanged = () => { if (active) renderListen(); };
  if (typeof playerState !== 'undefined' && playerState.audio) {
    ['play', 'pause', 'loadedmetadata'].forEach(ev => playerState.audio.addEventListener(ev, () => { if (active) renderListen(); }));
  }
  listenEl.addEventListener('click', e => window.klabPresenceCardClick && window.klabPresenceCardClick(e));
  listenEl.addEventListener('contextmenu', e => window.klabPresenceCardContext && window.klabPresenceCardContext(e));

  let flowI = 0, flowTimer = 0, flowSig = '';
  function renderFlow() {
    const A = (S.albums || []).slice(0, 9);
    const sig = A.map(a => a.id).join(',');
    if (sig !== flowSig) {
      flowSig = sig;
      if (!flowEl.previousElementSibling) flowEl.insertAdjacentHTML('beforebegin', lbl('New music'));
      flowEl.innerHTML = A.map((a, i) => '<button type="button" class="hm-fc" data-i="' + i + '" title="' + esc((a.name || '') + ' · ' + (a.artist || '')) + '" style="background-image:url(&quot;' + esc(cover(a.coverArt || a.id, 300)) + '&quot;)"></button>').join('');
      flowI = 0;
    }
    layoutFlow();
  }
  function layoutFlow() {
    [...flowEl.children].forEach((c, i) => {
      const d = i - flowI, ad = Math.abs(d);
      c.style.transform = d === 0 ? 'translateZ(24px)' : `translateX(${d * 38 + Math.sign(d) * 40}%) rotateY(${-Math.sign(d) * 58}deg) scale(0.84)`;
      c.style.zIndex = 20 - ad;
      c.style.opacity = ad > 2 ? 0 : 1;
      c.classList.toggle('dim', d !== 0);
    });
    const a = (S.albums || [])[flowI];
    let np = musicEl.querySelector('.hm-np');
    if (!np) { np = document.createElement('div'); np.className = 'hm-np'; musicEl.appendChild(np); }
    np.innerHTML = a ? '<b>' + esc(a.name || a.title || '') + '</b><span>' + esc(a.artist || '') + '</span>' : '';
  }
  flowEl.addEventListener('click', e => {
    const c = e.target.closest('.hm-fc');
    if (!c) return;
    const i = +c.dataset.i;
    if (i === flowI) openAlbum(S.albums[i]);
    else { flowI = i; layoutFlow(); restartFlow(); }
  });
  function restartFlow() {
    clearInterval(flowTimer);
    if (active && (S.albums || []).length > 1) flowTimer = setInterval(() => { flowI = (flowI + 1) % Math.min(9, S.albums.length); layoutFlow(); }, 4000);
  }
  function openAlbum(a) {
    if (!a) return;
    setActiveTab('music');
    if (window.openAlbumPage) setTimeout(() => window.openAlbumPage(a.id, a.name || a.title), 0);
  }

  let photosSig = '';
  function renderPhotos() {
    const tiles = [];
    (S.photoPosts || []).forEach(pp => (pp.photos || []).forEach(ph => { if (tiles.length < 5) tiles.push([pp.id, ph.id]); }));
    const html = tiles.map(([post, id], i) => '<b data-post="' + post + '" data-photo="' + id + '" style="background-image:url(&quot;' + photoFile(id, i ? 'thumb' : 'medium') + '&quot;)"></b>').join('');
    if (html === photosSig) return;
    photosSig = html;
    photosEl.innerHTML = lbl('Photos') + '<div class="hm-pgrid n' + tiles.length + '">' + html + '</div>';
  }
  photosEl.addEventListener('click', e => {
    const b = e.target.closest('.hm-pgrid b') || photosEl.querySelector('.hm-pgrid b');
    if (b) openPhoto(+b.dataset.post, b.dataset.photo); else setActiveTab('photos');
  });

  let chatSig = '';
  function renderChat() {
    const M = (S.chat || []).slice(-4);
    const html = M.map(m =>
      '<div class="hm-cm" data-room="' + esc(m.roomId) + '">' + avatarHTML(m.u) +
        '<div>' + nameHTML(m.u) + '<span class="hm-cm-body">' + esc(m.body) + '</span></div></div>').join('');
    if (html === chatSig && chatSig) return;
    chatSig = html;
    chatEl.innerHTML = lbl('Chat') + (html ? '<div class="hm-clist">' + html + '</div>' : '<div class="hm-quiet"><i class="ti ti-message-circle"></i></div>');
  }
  chatEl.addEventListener('click', e => {
    const m = e.target.closest('.hm-cm') || [...chatEl.querySelectorAll('.hm-cm')].pop();
    if (m && typeof openChatRoom === 'function') openChatRoom(m.dataset.room);
    else setActiveTab('chat');
  });

  // ── data ──
  async function loadPosts() {
    try {
      const d = await getJSON('/api/posts?limit=8');
      S.posts = d.posts || [];
      const p = S.posts[0];
      if (p) live('post' + p.id, apiTime(p.created), '<b>' + esc(p.username) + '</b> posted' + (p.song ? ' a song' : ''));
      renderPosts(); renderSpot();
    } catch (e) {}
  }
  async function loadPhotos() {
    try {
      const d = await getJSON('/api/posts/photos?order=posted&limit=6');
      S.photoPosts = d.posts || [];
      const p = S.photoPosts[0];
      if (p) live('photos' + p.id, apiTime(p.created), '<b>' + esc(p.username) + '</b> posted ' + (p.photos.length > 1 ? p.photos.length + ' photos' : 'a photo'));
      renderPhotos(); renderSpot();
    } catch (e) {}
  }
  let lastSongs = null;
  async function loadPresence() {
    try {
      const d = await getJSON('/api/presence');
      const L = (d.listeners || []).filter(l => l.username !== me() && l.song);
      // Someone pressing play on something new is worth a line.
      const now = new Map(L.filter(l => l.playing).map(l => [l.username, l.songId || l.song]));
      if (lastSongs) now.forEach((song, u) => {
        if (lastSongs.get(u) !== song) {
          const l = L.find(x => x.username === u);
          live('play' + u + ':' + song, Date.now(), '<b>' + esc(u) + '</b> is listening to ' + esc(l.song));
        }
      });
      lastSongs = now;
      S.listeners = L;
      renderListen();
    } catch (e) {}
  }
  async function loadAlbums() {
    try {
      const r = await fetchTimeout(`${ND_URL}/rest/getAlbumList2?type=newest&size=9&${subsonicParams()}`, {}, 8000);
      const d = await r.json();
      S.albums = d['subsonic-response']?.albumList2?.album || [];
      const a = S.albums[0];
      if (a && a.created) live('album' + a.id, new Date(a.created).getTime(), '<b>' + esc(a.name || '') + '</b> by ' + esc(a.artist || '') + ' was added');
      renderFlow(); renderSpot(); restartFlow();
    } catch (e) {}
  }
  // Channels only. A DM has no business on a screen left up for the room.
  // Whatever the chat SDK hands back, a problem here must never stop the
  // rest of Home from refreshing.
  function loadChat() {
    try { readChat(); } catch (e) { console.warn('[home] chat tile', e); }
  }
  function readChat() {
    const client = window.MatrixChat?.client;
    if (!client) return;
    const dms = typeof getDmRoomIds === 'function' ? getDmRoomIds() : new Set();
    const out = [];
    client.getRooms().forEach(room => {
      if ((room.isSpaceRoom && room.isSpaceRoom()) || room.getMyMembership?.() !== 'join' || dms.has(room.roomId)) return;
      room.getLiveTimeline().getEvents().forEach(ev => {
        if (ev.getType() !== 'm.room.message' || ev.getRelation()?.rel_type === 'm.replace' || ev.isRedacted?.()) return;
        const c = ev.getContent() || {};
        if (typeof c.body !== 'string' || !c.body) return; // content is arbitrary JSON
        out.push({ id: ev.getId(), t: ev.getTs(), roomId: room.roomId, room: room.name, u: localpart(ev.getSender()),
          body: c.msgtype === 'm.image' ? '📷' : c.body.replace(/^> .*\n\n?/gm, '') });
      });
    });
    out.sort((a, b) => a.t - b.t);
    S.chat = out.slice(-6);
    const m = S.chat[S.chat.length - 1];
    if (m) live('msg' + m.id, m.t, '<b>' + esc(m.u) + '</b> in ' + esc(m.room || 'chat') + ': ' + esc(m.body.slice(0, 80)));
    renderChat();
  }
  if (window.MatrixChat?.on) {
    let q = false;
    const soon = () => { if (!q) { q = true; setTimeout(() => { q = false; loadChat(); }, 300); } };
    MatrixChat.on('sync', state => { if (state === 'PREPARED') soon(); });
    MatrixChat.on('timeline', () => { if (active) soon(); }); // Home catches up on arrival anyway
  }

  // ── running only while visible ──
  const timers = [];
  function startPolling() {
    stopPolling();
    const every = (fn, ms) => timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
    every(loadPosts, POLL.posts);
    every(loadPhotos, POLL.photos);
    every(loadPresence, POLL.presence);
    every(loadAlbums, POLL.albums);
    every(tickClock, 5000);
    // Avatars and post images resolve in the background; pick them up.
    every(() => { postsSig = listenSig = chatSig = ''; renderPosts(); renderListen(); renderChat(); renderSpot(); }, 20e3);
  }
  function stopPolling() { timers.splice(0).forEach(clearInterval); }
  function refreshAll() { loadPosts(); loadPhotos(); loadPresence(); loadAlbums(); loadChat(); tickClock(); }

  window.klabHomeTabChanged = function(on) {
    if (on === active) return;
    active = on;
    clearTimeout(slideTimer); clearInterval(flowTimer);
    if (on) {
      bdKey = '';
      refreshAll();
      startPolling();
      if (slides.length) showSlide(cur);
      restartFlow();
    } else {
      stopPolling();
    }
  };
  document.addEventListener('visibilitychange', () => { if (active && !document.hidden) refreshAll(); });
  tickClock();
  if (panel.classList.contains('active')) window.klabHomeTabChanged(true);
})();
