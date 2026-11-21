// ══════════════════════════════════════════
//  VIDEO STUDIO (2026-11-20)
//  The owner: "a light video editor feature would be SWEET. and an
//  annotations feature like youtube has...well, had. as well as the cards
//  and things like that".
//  Two halves:
//    · The viewer's side: a video's annotations, cards (polls among them)
//      and end screen, drawn over the player in a layer fitted to the
//      picture (so they scale in full screen; not in the mini player or a
//      pop-out). Annotations can be turned off in the player's ⋯ menu
//      (per device, klabnet_video_ann).
//    · The Studio (#videos/<id>/studio), for a video's owner or an admin,
//      in Videos' page: tabs Edit · Annotations · Cards · End screen ·
//      Details over one preview and one timeline.
//  The editor is non-destructive: an edit list (what to keep, muted
//  ranges, gain, crop, rotate) in the time of the kept upload, rendered by
//  klabnet-api (routers/studio.py) from that upload into the same ladder;
//  the old version plays until it's done. The preview plays the whole
//  upload (its unedited ladder) and skips what's cut, so nothing is
//  re-encoded to preview.
//  Everything in the Studio is timed in the upload's time while you work
//  (so cutting doesn't move anything), and changed into the edited
//  video's time when saved: what falls in a removed part goes, and the
//  save says so first.
//  window.klabOpenStudio(id), klabStudioView, klabPlayerMore().
// ══════════════════════════════════════════
(function () {
  const $ = id => document.getElementById(id);
  const page = $('vidPage');
  if (!page) return;
  const API = '/api/posts/videos';
  const HLS_LIB = 'js/vendor/hls.light.min.js?v=1.5.20';
  const me = () => window.KLAB_USER?.username || '';

  // ── Little things ──
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function dur(s) {
    s = Math.max(0, Math.floor(+s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  // 1:02.4 (tenths), for the editor.
  function fine(s) {
    s = Math.max(0, +s || 0);
    const whole = Math.floor(s), t = Math.floor((s - whole) * 10);
    return dur(whole) + '.' + t;
  }
  function parseTime(str) {
    const m = String(str || '').trim().match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const parts = [m[1], m[2], m[3]].filter(x => x != null).map(Number);
    return parts.reduce((a, b) => a * 60 + b, 0);
  }
  async function getJSON(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 15000);
    try {
      const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
      // Not JSON (a sign-in page, a proxy's error page): no answer, not an empty one.
      const j = await r.json().catch(() => null);
      if (!r.ok) { const e = new Error(j?.error || 'failed (' + r.status + ')'); e.status = r.status; throw e; }
      if (!j || typeof j !== 'object') { const e = new Error('no answer (' + r.status + ')'); e.status = 0; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const clone = x => JSON.parse(JSON.stringify(x));
  const motion = () => (typeof klabMotionOk === 'function' ? klabMotionOk() : true);
  const domain = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ══ The edit list: keeps, and moving times between the upload and the edit ══
  function normRanges(list, D) {
    const r3 = x => Math.round(x * 1000) / 1000;
    const out = (list || []).map(([a, b]) => [r3(clamp(+a, 0, D)), r3(clamp(+b, 0, D))]).filter(([a, b]) => b - a >= 0.05).sort((x, y) => x[0] - y[0]);
    const m = [];
    for (const [a, b] of out) { if (m.length && a <= m[m.length - 1][1] + 0.01) m[m.length - 1][1] = Math.max(m[m.length - 1][1], b); else m.push([a, b]); }
    return m;
  }
  function makeMap(edit, D) {
    const keeps = edit && edit.keep && edit.keep.length ? normRanges(edit.keep, D) : [[0, D]];
    const len = keeps.reduce((n, [a, b]) => n + b - a, 0);
    return {
      keeps, len,
      // Upload time → edited time; in a cut: null (or, clamped, where the cut is).
      s2e(t, clampIt) {
        let acc = 0;
        for (const [a, b] of keeps) {
          if (t < a) return clampIt ? acc : null;
          if (t <= b) return acc + (t - a);
          acc += b - a;
        }
        return clampIt ? acc : null;
      },
      e2s(T) {
        let acc = 0;
        for (const [a, b] of keeps) {
          if (T <= acc + (b - a) + 1e-6) return a + (T - acc);
          acc += b - a;
        }
        return keeps.length ? keeps[keeps.length - 1][1] : T;
      },
      cut(t) { return !keeps.some(([a, b]) => t >= a - 1e-3 && t < b); },
      // Where the next kept part starts, from a time in a cut (or null).
      nextKeep(t) { const k = keeps.find(([a]) => a > t - 1e-3); return k ? k[0] : null; },
    };
  }
  function subtract(keeps, a, b) {
    const out = [];
    for (const [x, y] of keeps) {
      if (y <= a || x >= b) { out.push([x, y]); continue; }
      if (x < a) out.push([x, a]);
      if (y > b) out.push([b, y]);
    }
    return out.filter(([x, y]) => y - x >= 0.05);
  }
  const union = (keeps, a, b, D) => normRanges(keeps.concat([[a, b]]), D);
  const intersect = (keeps, a, b) => keeps.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y - x >= 0.05);

  // ══ The viewer's side: annotations, cards and the end screen over the player ══
  const ANN_KEY = 'klabnet_video_ann';
  const annOn = () => { try { return localStorage.getItem(ANN_KEY) !== 'off'; } catch { return true; } };
  const PALETTE = [
    { name: 'Dark', bg: '#141416', fg: '#ffffff' }, { name: 'Light', bg: '#f5f5f7', fg: '#141416' },
    { name: 'Yellow', bg: '#ffd60a', fg: '#141416' }, { name: 'Red', bg: '#ff453a', fg: '#ffffff' },
    { name: 'Green', bg: '#30d158', fg: '#0b2412' }, { name: 'Blue', bg: '#0a84ff', fg: '#ffffff' },
    { name: 'Purple', bg: '#bf5af2', fg: '#ffffff' },
  ];
  function inkFor(hex) {
    const h = String(hex || '').replace('#', '');
    const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    if (!/^[0-9a-f]{6}$/i.test(f)) return '#fff';
    const [r, g, b] = [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#141416' : '#ffffff';
  }
  const LINK_WORDS = { time: 'Jump to', video: 'Video', playlist: 'Playlist', channel: 'Channel', tv: 'TV channel', url: 'Website' };

  // An annotation, drawn: positions in % of the picture, type in cqw.
  function annHTML(a, opts) {
    const o = opts || {};
    const st = a.style || {};
    const bg = st.bg || (a.type === 'title' ? '' : a.type === 'spotlight' ? '' : '#141416');
    const fg = st.fg || (bg ? inkFor(bg) : '#ffffff');
    const linked = !!(a.link && !o.edit);
    const tag = linked ? 'button type="button"' : 'div';
    const end = linked ? 'button' : 'div';
    const url = a.link?.kind === 'url' ? domain(a.link.url) : '';
    let tail = '';
    if (a.type === 'bubble') {
      const tx = st.tx ?? 20, ty = st.ty ?? 140;
      let b1, b2;
      if (ty > 100) { const x = clamp(tx, 12, 88); b1 = (x - 9) + ',99'; b2 = (x + 9) + ',99'; }
      else if (ty < 0) { const x = clamp(tx, 12, 88); b1 = (x - 9) + ',1'; b2 = (x + 9) + ',1'; }
      else if (tx < 0) { const y = clamp(ty, 15, 85); b1 = '1,' + (y - 12); b2 = '1,' + (y + 12); }
      else { const y = clamp(ty, 15, 85); b1 = '99,' + (y - 12); b2 = '99,' + (y + 12); }
      tail = '<svg class="ann-tail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="' + b1 + ' ' + tx + ',' + ty + ' ' + b2 + '" fill="' + esc(bg) + '"/></svg>';
    }
    return '<' + tag + ' class="ann ann-' + a.type + ' sz-' + (st.size || 'md') + (linked ? ' linked' : '') + (o.cls ? ' ' + o.cls : '') + '" data-ann="' + esc(a.id) + '"' +
      ' style="left:' + a.x + '%;top:' + a.y + '%;width:' + a.w + '%;height:' + a.h + '%;--ann-bg:' + (bg || 'transparent') + ';--ann-fg:' + fg + '"' +
      (linked ? ' title="' + esc(url ? url : LINK_WORDS[a.link.kind] || '') + '" data-silent' : '') + '>' +
      tail + '<span class="ann-tx">' + esc(a.text || '') + '</span>' +
      (url ? '<span class="ann-dom"><i class="ti ti-external-link"></i>' + esc(url) + '</span>' : '') +
    '</' + end + '>';
  }

  // Following a link (annotations, cards, the end screen).
  function follow(link, video) {
    if (!link) return;
    if (link.kind === 'time') { if (video) { video.currentTime = link.t; video.play().catch(() => {}); } return; }
    // (The API keeps only http(s) addresses; checked here too, never javascript:.)
    if (link.kind === 'url') { if (/^https?:\/\//i.test(link.url || '')) window.open(link.url, '_blank', 'noopener,noreferrer'); return; }
    SFX && SFX.play('nav');
    if (link.kind === 'video') window.klabOpenVideo?.(link.id, link.t || 0);
    else if (link.kind === 'channel') window.klabOpenChannel?.(link.user);
    else if (link.kind === 'tv') window.klabTv?.open?.(link.id);
    else if (link.kind === 'playlist') {
      window.klabVideoLink = { playlist: link.id };
      if (document.body.classList.contains('tab-videos-active')) window.klabVideosTabChanged?.(true); else setActiveTab('videos');
    }
  }

  let ov = null, ovSeq = 0;
  function unmountOv() {
    if (!ov) return;
    ov.ro?.disconnect();
    ov.layer?.remove();
    ov.box?.classList.remove('has-es');
    for (const [ev, fn] of ov.listen || []) ov.video.removeEventListener(ev, fn);
    ov = null;
  }
  document.addEventListener('klab:watch', e => {
    ovSeq++;
    unmountOv();
    if (e.detail && e.detail.v && e.detail.video) mountOv(e.detail.v, e.detail.video, ovSeq);
  });

  async function mountOv(v, video, my) {
    let data;
    try { data = await getJSON(API + '/' + v.id + '/overlays', null, 10000); } catch { return; }
    if (my !== ovSeq) return;
    const box = video.closest('.vp');
    if (!box) return;
    const anns = data.annotations || [], cards = data.cards || [], es = data.endscreen;
    ov = { v, video, box, data, listen: [], shownCards: new Set(), lastT: 0 };
    if (!anns.length && !cards.length && !es) return;
    const layer = document.createElement('div');
    layer.className = 'vp-ov';
    layer.innerHTML = '<div class="vp-ov-frame">' +
        '<div class="vp-ov-anns">' + anns.map(a => annHTML(a)).join('') + '</div>' +
        (es ? '<div class="vp-es" hidden>' + es.elements.map(el => esHTML(el, data.refs, v)).join('') + '</div>' : '') +
        (cards.length ? '<div class="vp-cards"><button type="button" class="vp-card-i" title="Cards" aria-label="Cards" data-silent><i class="ti ti-info-circle"></i></button>' +
          '<div class="vp-teaser" hidden></div><div class="vp-card-panel" hidden></div></div>' : '') +
      '</div>';
    box.insertBefore(layer, box.querySelector('.vp-big') || box.querySelector('.vp-ctrl'));
    ov.layer = layer;
    ov.frame = layer.firstElementChild;
    const fit = () => fitFrame(ov.frame, box, video, v);
    ov.ro = new ResizeObserver(fit);
    ov.ro.observe(box);
    const tick = () => ovTick();
    for (const ev of ['timeupdate', 'seeked', 'loadedmetadata', 'ended', 'play']) { video.addEventListener(ev, ev === 'loadedmetadata' ? fit : tick); ov.listen.push([ev, ev === 'loadedmetadata' ? fit : tick]); }
    fit();
    paintAnnState();
    layer.addEventListener('click', ovClick);
    refreshFacesIn(layer);
    ovTick();
  }
  // The layer sits on the picture itself (inside any black bars), so a
  // position in % is the same spot at every size.
  function fitFrame(frame, box, video, v) {
    if (!frame) return;
    const W = box.clientWidth, H = box.clientHeight;
    const vw = video.videoWidth || v.width || 16, vh = video.videoHeight || v.height || 9;
    const a = vw / vh;
    let w = W, h = W / a;
    if (h > H) { h = H; w = H * a; }
    frame.style.width = w + 'px'; frame.style.height = h + 'px';
    frame.style.left = (W - w) / 2 + 'px'; frame.style.top = (H - h) / 2 + 'px';
  }
  function paintAnnState() { if (ov?.layer) ov.layer.classList.toggle('anns-off', !annOn()); }
  function ovTick() {
    if (!ov || !ov.layer) return;
    const t = ov.video.currentTime || 0, d = ov.video.duration || ov.v.duration || 0;
    const on = annOn();
    for (const el of ov.layer.querySelectorAll('.vp-ov-anns .ann')) {
      const a = ov.data.annotations.find(x => x.id === el.dataset.ann);
      el.classList.toggle('on', on && !!a && t >= a.start && t < a.end);
    }
    // Cards: each teases once as its time comes up in normal playing.
    const jumped = Math.abs(t - ov.lastT) > 1.5;
    if (!jumped && !ov.video.paused) {
      for (const c of ov.data.cards) if (!ov.shownCards.has(c.id) && c.at > ov.lastT - 0.01 && c.at <= t) { ov.shownCards.add(c.id); tease(c); break; }
    }
    ov.lastT = t;
    const es = ov.data.endscreen, esEl = ov.layer.querySelector('.vp-es');
    if (es && esEl && d) {
      const show = t >= d - es.start - 0.05 || ov.video.ended;
      if (show && esEl.hidden) { refreshBest(esEl); esEl.hidden = false; requestAnimationFrame(() => esEl.classList.add('on')); }
      else if (!show && !esEl.hidden) { esEl.classList.remove('on'); esEl.hidden = true; }
      ov.box.classList.toggle('has-es', show);
    }
  }
  // "Best for viewer": what plays next here (the playlist's next, Up next), else their latest.
  function refreshBest(esEl) {
    const nx = window.klabWatch?.next?.();
    esEl.querySelectorAll('[data-es-kind="best"]').forEach(el => {
      const x = nx || ov.data.refs?.latest;
      if (!x) return;
      el.dataset.vidOpen = x.id;
      const img = el.querySelector('img');
      if (img && x.posterSmall) img.src = x.posterSmall;
      const tt = el.querySelector('.es-title');
      if (tt) tt.textContent = x.title || 'Untitled';
    });
  }
  function esTarget(el, refs, v) {
    const t = el.target;
    if (el.kind === 'latest' || el.kind === 'best') return { video: refs?.latest || null };
    if (!t) return {};
    if (t.kind === 'video') return { video: refs?.videos?.[t.id] || null };
    if (t.kind === 'playlist') return { playlist: refs?.playlists?.[t.id] || null };
    if (t.kind === 'tv') return { tv: refs?.tv?.[t.id] || null };
    return {};
  }
  function faceHTML(u) {
    const url = window.klabResolveUserAvatar?.(u);
    const color = typeof profileColor === 'function' ? profileColor(u) : '';
    return '<span class="es-face" data-face="' + esc(u) + '" style="--c:' + color + '">' + (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  function refreshFacesIn(root) {
    root.querySelectorAll('.es-face[data-face]:not(:has(img))').forEach(el => {
      const url = window.klabResolveUserAvatar?.(el.dataset.face);
      if (url) el.innerHTML = '<img src="' + esc(url) + '" alt="" />';
    });
  }
  // An end screen element: a tile of what it points at.
  function esHTML(el, refs, v, edit) {
    const r = esTarget(el, refs, v);
    const pos = 'left:' + el.x + '%;top:' + el.y + '%;width:' + el.w + '%;height:' + el.h + '%';
    const tag = edit ? 'div' : 'button type="button"', close = edit ? 'div' : 'button';
    const base = 'class="es es-' + el.kind + '" data-es="' + esc(el.id) + '" data-es-kind="' + el.kind + '" style="' + pos + '"' + (edit ? '' : ' data-silent');
    if (el.kind === 'channel') {
      const u = el.target?.user || v.username;
      return '<' + tag + ' ' + base + ' title="More from ' + esc(u) + '">' + faceHTML(u) + '<span class="es-cap">More from ' + esc(u) + '</span></' + close + '>';
    }
    if (el.kind === 'tv') {
      const c = r.tv;
      return '<' + tag + ' ' + base + ' style="' + pos + ';--tv-c:' + esc(c?.color || '#888') + '"><span class="es-tv"><b>' + esc(c ? c.number : '–') + '</b><span>' + esc(c ? c.name : 'TV channel') + '</span></span><span class="es-cap">Watch channel</span></' + close + '>';
    }
    if (el.kind === 'link') {
      const u = el.target?.url || '';
      return '<' + tag + ' ' + base + ' title="' + esc(domain(u)) + '"><span class="es-link"><i class="ti ti-external-link"></i><b>' + esc(el.target?.title || domain(u) || 'Link') + '</b><span>' + esc(domain(u)) + '</span></span></' + close + '>';
    }
    if (el.kind === 'playlist') {
      const p = r.playlist;
      return '<' + tag + ' ' + base + '><span class="es-pic">' + (p?.cover ? '<img src="' + esc(p.cover) + '" alt="" />' : '') + '<span class="es-badge"><i class="ti ti-playlist"></i>' + (p ? p.count : '') + '</span></span>' +
        '<span class="es-title">' + esc(p ? p.name : 'Playlist') + '</span></' + close + '>';
    }
    const x = r.video;
    const words = el.kind === 'latest' ? 'Latest from ' + esc(v.username) : el.kind === 'best' ? 'Up next' : '';
    return '<' + tag + ' ' + base + (x ? ' data-vid-open="' + x.id + '"' : '') + '><span class="es-pic">' + (x?.posterSmall ? '<img src="' + esc(x.posterSmall) + '" alt="" />' : '') +
      (x?.duration ? '<span class="vid-dur">' + dur(x.duration) + '</span>' : '') + '</span>' +
      '<span class="es-title">' + (words ? '<small>' + words + '</small>' : '') + esc(x ? x.title || 'Untitled' : 'Video') + '</span></' + close + '>';
  }
  function tease(c) {
    const box = ov.layer.querySelector('.vp-cards');
    const t = ov.layer.querySelector('.vp-teaser');
    if (!t || box.classList.contains('open')) return;
    t.innerHTML = '<span>' + esc(c.teaser || cardWords(c)) + '</span>';
    t.dataset.card = c.id;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('on'));
    clearTimeout(ov.teaseT);
    ov.teaseT = setTimeout(() => {
      t.classList.remove('on');
      setTimeout(() => { t.hidden = true; }, 220);
      const i = ov?.layer?.querySelector('.vp-card-i');
      if (i) { i.classList.remove('pulse'); void i.offsetWidth; i.classList.add('pulse'); }
    }, 5000);
  }
  function cardWords(c) {
    const r = ov?.data?.refs || {};
    const t = c.target || {};
    if (c.kind === 'poll') return c.poll?.question || 'Poll';
    if (c.kind === 'video') return r.videos?.[t.id]?.title || 'A video';
    if (c.kind === 'playlist') return r.playlists?.[t.id]?.name || 'A playlist';
    if (c.kind === 'channel') return 'More from ' + (t.user || '');
    if (c.kind === 'tv') { const x = r.tv?.[t.id]; return x ? 'Channel ' + x.number + ' · ' + x.name : 'A TV channel'; }
    return t.title || domain(t.url) || 'A link';
  }
  function cardHTML(c) {
    const r = ov.data.refs || {}, t = c.target || {};
    if (c.kind === 'poll') {
      const p = c.poll;
      const voted = p.mine != null && p.counts;
      const total = voted ? p.counts.reduce((a, b) => a + b, 0) : 0;
      return '<div class="vc vc-poll" data-card="' + esc(c.id) + '"><div class="vc-kind">Poll</div><b class="vc-q">' + esc(p.question) + '</b>' +
        '<div class="vc-opts">' + p.options.map((o, i) => {
          const pct = voted && total ? Math.round(p.counts[i] / total * 100) : 0;
          return '<button type="button" class="vc-opt' + (p.mine === i ? ' mine' : '') + (voted ? ' shown' : '') + '" data-vote="' + i + '">' +
            (voted ? '<span class="vc-bar" style="transform:scaleX(' + (pct / 100).toFixed(3) + ')"></span>' : '') +
            '<span class="vc-o">' + esc(o) + '</span>' + (voted ? '<span class="vc-pct">' + pct + '%</span>' : '') + '</button>';
        }).join('') + '</div>' +
        (voted ? '<div class="vc-sub">' + klabCount(total, 'vote') + '</div>' : '') + '</div>';
    }
    let pic = '', title = '', sub = '', kind = '';
    if (c.kind === 'video') { const x = r.videos?.[t.id]; kind = 'Video'; pic = x?.posterSmall ? '<img src="' + esc(x.posterSmall) + '" alt="" />' : ''; title = x?.title || 'Video'; sub = x ? x.username + ' · ' + dur(x.duration) : ''; }
    else if (c.kind === 'playlist') { const x = r.playlists?.[t.id]; kind = 'Playlist'; pic = x?.cover ? '<img src="' + esc(x.cover) + '" alt="" />' : '<i class="ti ti-playlist"></i>'; title = x?.name || 'Playlist'; sub = x ? klabCount(x.count, 'video') : ''; }
    else if (c.kind === 'channel') { kind = 'Channel'; pic = faceHTML(t.user); title = t.user; sub = 'More from ' + t.user; }
    else if (c.kind === 'tv') { const x = r.tv?.[t.id]; kind = 'TV channel'; pic = '<span class="es-tv" style="--tv-c:' + esc(x?.color || '#888') + '"><b>' + esc(x ? x.number : '–') + '</b></span>'; title = x?.name || 'TV channel'; sub = 'Watch it live'; }
    else { kind = 'Link'; pic = '<i class="ti ti-external-link"></i>'; title = t.title || domain(t.url); sub = domain(t.url); }
    return '<button type="button" class="vc vc-' + c.kind + '" data-card="' + esc(c.id) + '" data-silent><span class="vc-pic">' + pic + '</span>' +
      '<span class="vc-tx"><span class="vc-kind">' + kind + '</span><b>' + esc(c.teaser || title) + '</b><span>' + esc(c.teaser ? title : sub) + '</span></span></button>';
  }
  function openCards() {
    const box = ov?.layer?.querySelector('.vp-cards');
    if (!box) return;
    const p = box.querySelector('.vp-card-panel');
    const open = !box.classList.contains('open');
    box.classList.toggle('open', open);
    if (open) {
      p.innerHTML = '<div class="vc-head"><span>Cards</span><button type="button" class="k-icon sm on-media" data-cards-close title="Close" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
        '<div class="vc-list">' + ov.data.cards.map(cardHTML).join('') + '</div>';
      refreshFacesIn(p);
      p.hidden = false;
      const t = box.querySelector('.vp-teaser');
      t.classList.remove('on'); t.hidden = true;
    } else p.hidden = true;
  }
  async function vote(c, i) {
    const v = ov.v;
    try {
      const j = await getJSON(API + '/' + v.id + '/cards/' + encodeURIComponent(c.id) + '/vote', json('POST', { option: i }), 8000);
      Object.assign(c, j);
      const el = ov?.layer?.querySelector('.vc[data-card="' + c.id + '"]');
      if (el) { el.outerHTML = cardHTML(c); }
      SFX && SFX.play('click');
    } catch (e) { showToast('Couldn’t vote: ' + klabCap(e.message), 'ti-alert-triangle'); }
  }
  function ovClick(e) {
    if (!ov) return;
    const ann = e.target.closest('.ann.linked');
    if (ann) {
      e.stopPropagation();
      const a = ov.data.annotations.find(x => x.id === ann.dataset.ann);
      if (a?.link) { if (a.link.kind !== 'time' && a.link.kind !== 'url') ov.video.pause(); follow(a.link, ov.video); }
      return;
    }
    if (e.target.closest('.vp-card-i')) { e.stopPropagation(); openCards(); return; }
    if (e.target.closest('[data-cards-close]')) { e.stopPropagation(); openCards(); return; }
    const tz = e.target.closest('.vp-teaser');
    if (tz) { e.stopPropagation(); openCards(); return; }
    const vb = e.target.closest('[data-vote]');
    if (vb) { e.stopPropagation(); const c = ov.data.cards.find(x => x.id === vb.closest('[data-card]').dataset.card); if (c) vote(c, +vb.dataset.vote); return; }
    const card = e.target.closest('.vc[data-card]');
    if (card && !card.classList.contains('vc-poll')) {
      e.stopPropagation();
      const c = ov.data.cards.find(x => x.id === card.dataset.card);
      if (!c) return;
      const link = c.kind === 'link' ? c.target : c.target;
      if (link.kind !== 'url') ov.video.pause();
      follow(link, ov.video);
      return;
    }
    const es = e.target.closest('.es[data-es]');
    if (es) {
      e.stopPropagation();
      const el = ov.data.endscreen.elements.find(x => x.id === es.dataset.es);
      if (!el) return;
      if (es.dataset.vidOpen) follow({ kind: 'video', id: +es.dataset.vidOpen }, ov.video);
      else if (el.kind === 'channel') follow({ kind: 'channel', user: el.target?.user || ov.v.username });
      else follow(el.target, ov.video);
      return;
    }
    if (e.target.closest('.vp-card-panel')) e.stopPropagation();
  }
  // The player's ⋯ menu (js/39-videos.js asks).
  window.klabPlayerMore = () => {
    if (!ov || !ov.data || !(ov.data.annotations || []).length) return [];
    return [{ label: 'Annotations', on: annOn(), go: () => { try { localStorage.setItem(ANN_KEY, annOn() ? 'off' : 'on'); } catch {} paintAnnState(); ovTick(); showToast(annOn() ? 'Annotations on' : 'Annotations off', 'ti-message'); } }];
  };

  // ══ The Studio ══
  const TABS = [['edit', 'Edit'], ['annotations', 'Annotations'], ['cards', 'Cards'], ['end', 'End screen'], ['details', 'Details']];
  let S = null; // the studio's state
  let restoring = false, openSeq = 0;

  function record(desc) { if (!restoring) window.klabNav?.push({ tab: 'videos', kind: 'studio', ...desc }); }

  async function openStudio(id, opts) {
    const o = opts || {};
    id = +id;
    if (!id) return;
    if (!document.body.classList.contains('tab-videos-active')) setActiveTab('videos');
    // Videos lets go of the page; what's playing goes on in the mini
    // player, except this video (the studio's preview is the one now).
    if (window.klabMini?.active?.() && window.klabWatch?.current?.()?.id === id) window.klabMini.close();
    window.klabVideosLeave?.('studio');
    leaveStudio();
    if (!o.quiet) record({ id, view: o.tab || 'edit' });
    const my = ++openSeq; // two opened quickly: the last one asked for wins
    page.innerHTML = '<div class="st st-loading"><div class="k-empty vid-empty"><i class="ti ti-loader loading-spinner"></i><div>Loading the studio…</div></div></div>';
    const panel = page.closest('.tab-panel');
    if (panel) panel.scrollTop = 0;
    let j;
    try { j = await getJSON(API + '/' + id + '/studio'); }
    catch (e) {
      if (my !== openSeq || !page.querySelector('.st-loading')) return;
      page.innerHTML = '<div class="k-empty vid-empty"><i class="ti ti-movie-off"></i><div>' + (e.status === 403 ? 'Only the video’s owner can open its studio.' : e.status === 409 ? 'This video is still being made. Its studio opens once it’s ready.' : e.status === 404 ? (e.message === 'not found' ? 'That video’s gone.' : 'The studio needs the latest klabnet-api.') : 'Couldn’t open the studio.') + '</div>' +
        '<button type="button" class="k-btn" data-st="back"><i class="ti ti-arrow-left"></i><span>Back</span></button></div>';
      page.querySelector('[data-st="back"]')?.addEventListener('click', () => { if (!window.klabNav?.back()) window.klabOpenVideo?.(id); });
      return;
    }
    if (my !== openSeq || !page.querySelector('.st-loading')) return;
    start(j, o.tab || 'edit');
  }
  window.klabOpenStudio = (id, tab) => openStudio(id, { tab });

  // Loads what the API said into working copies (all in the upload's time).
  function start(j, tab) {
    const D = j.source.duration || j.duration || 0;
    const ref = makeMap(j.edit, D); // what saved times are measured against
    const work = {
      edit: j.edit ? clone(j.edit) : { keep: [[0, D]], mute: [], muteAll: false, gain: 0, crop: null, rotate: 0 },
      anns: (j.annotations || []).map(a => ({ ...a, start: ref.e2s(a.start), end: ref.e2s(a.end) })),
      cards: (j.cards || []).map(c => ({ ...c, at: ref.e2s(c.at) })),
      end: j.endscreen ? clone(j.endscreen) : null,
    };
    S = {
      j, id: j.id, D, tab, work, saved: clone(work), splits: [], hist: [], fut: [],
      sel: null, selAnn: null, selCard: null, selEs: null, tool: null,
      zoom: 1, previewCuts: true, video: null, hls: null, raf: 0, pollT: 0, refs: j.refs || {},
      title: j.title,
    };
    S.work.edit.keep = normRanges(S.work.edit.keep, D);
    S.saved = clone(S.work);
    render();
    if (j.render?.state === 'queued' || j.render?.state === 'rendering') pollRender();
  }
  window.klabStudioView = { leave: () => leaveStudio(), state: () => S && { id: S.id, tab: S.tab, work: S.work, dirty: dirty(), render: S.j.render, t: S.video?.currentTime } };

  function leaveStudio() {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    clearTimeout(S.pollT);
    S.ro?.disconnect();
    if (S.hls) { try { S.hls.destroy(); } catch {} }
    if (S.video) { try { S.video.pause(); S.video.removeAttribute('src'); S.video.load(); } catch {} }
    try { S.actx?.close(); } catch {}
    S = null;
  }
  // Anything else drawn over the page: the studio's gone.
  new MutationObserver(() => { if (S && !page.querySelector('.st[data-st-id]')) leaveStudio(); }).observe(page, { childList: true });

  const map = () => makeMap(S.work.edit, S.D);
  const editLen = () => map().len;
  function dirty() {
    if (!S) return false;
    const w = S.work, s = S.saved;
    return JSON.stringify([normEdit(w.edit), w.anns, w.cards, w.end]) !== JSON.stringify([normEdit(s.edit), s.anns, s.cards, s.end]);
  }
  function normEdit(e) { return { ...e, keep: normRanges(e.keep, S.D), mute: normRanges(e.mute, S.D) }; }
  const editDirty = () => JSON.stringify(normEdit(S.work.edit)) !== JSON.stringify(normEdit(S.saved.edit));
  function isIdentity(e) {
    const k = normRanges(e.keep, S.D);
    return k.length === 1 && k[0][0] <= 0.05 && k[0][1] >= S.D - 0.05 && !normRanges(e.mute, S.D).length && !e.muteAll && !e.gain && !e.crop && !e.rotate;
  }
  // A change: history first, then the change, then the drawing.
  function change(fn, opts) {
    if (!(opts && opts.noHist)) { S.hist.push(clone(S.work)); if (S.hist.length > 100) S.hist.shift(); S.fut = []; }
    fn(S.work);
    paint();
  }
  // A selection points into the ranges by index: after undo/redo it may
  // name a different one, so it goes.
  function undo() { if (!S.hist.length) return; S.fut.push(clone(S.work)); S.work = S.hist.pop(); S.sel = null; paint(); }
  function redo() { if (!S.fut.length) return; S.hist.push(clone(S.work)); S.work = S.fut.pop(); S.sel = null; paint(); }

  // ── The page ──
  function render() {
    const j = S.j;
    page.innerHTML =
      '<div class="st" data-st-id="' + S.id + '">' +
        '<div class="st-head">' +
          '<button type="button" class="k-btn sm vid-back" data-st="back"><i class="ti ti-arrow-left"></i><span>Back</span></button>' +
          '<div class="st-name"><span class="k-label">Studio</span><h2 class="st-title">' + esc(j.title || 'Untitled') + '</h2></div>' +
          '<span class="st-status" id="stStatus" aria-live="polite"></span>' +
          '<div class="st-acts">' +
            '<button type="button" class="k-icon" data-st="undo" title="Undo (Ctrl+Z)" aria-label="Undo"><i class="ti ti-arrow-back-up"></i></button>' +
            '<button type="button" class="k-icon" data-st="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><i class="ti ti-arrow-forward-up"></i></button>' +
            '<button type="button" class="k-btn" data-st="watch"><i class="ti ti-player-play"></i><span>Watch</span></button>' +
            '<button type="button" class="k-btn primary" data-st="save" id="stSave" disabled>Save</button>' +
          '</div>' +
        '</div>' +
        '<div class="k-seg st-tabs" role="tablist" aria-label="Studio">' + TABS.map(([k, l]) => '<button type="button" role="tab" data-st-tab="' + k + '" aria-pressed="' + (S.tab === k) + '" aria-selected="' + (S.tab === k) + '">' + l + '</button>').join('') + '</div>' +
        '<div class="st-body">' +
          '<div class="st-stage">' +
            '<div class="st-screen" id="stScreen" tabindex="0">' +
              '<video playsinline preload="auto" crossorigin="use-credentials"></video>' +
              '<div class="st-frame" id="stFrame"><div class="st-crop" id="stCrop" hidden></div><div class="st-ovl" id="stOvl"></div></div>' +
              '<div class="st-cutnote" id="stCutNote" hidden>Cut</div>' +
            '</div>' +
            '<div class="st-transport">' +
              '<button type="button" class="k-icon" data-st="play" title="Play (Space)" aria-label="Play"><i class="ti ti-player-play-filled"></i></button>' +
              '<button type="button" class="k-icon sm" data-st="frame-" title="Back a frame (,)" aria-label="Back a frame"><i class="ti ti-chevron-left"></i></button>' +
              '<button type="button" class="k-icon sm" data-st="frame+" title="Forward a frame (.)" aria-label="Forward a frame"><i class="ti ti-chevron-right"></i></button>' +
              '<span class="st-time" id="stTime">0:00.0</span>' +
              '<span class="st-gap"></span>' +
              '<span class="st-tbar" id="stTbar"></span>' +
              '<button type="button" class="k-icon sm" data-st="zoom-" title="Zoom out (-)" aria-label="Zoom out"><i class="ti ti-zoom-out"></i></button>' +
              '<button type="button" class="k-icon sm" data-st="zoom+" title="Zoom in (=)" aria-label="Zoom in"><i class="ti ti-zoom-in"></i></button>' +
            '</div>' +
          '</div>' +
          '<aside class="st-side" id="stSide"></aside>' +
        '</div>' +
        '<div class="st-tl" id="stTl" tabindex="0" aria-label="Timeline"><div class="st-tl-in" id="stTlIn"></div></div>' +
      '</div>';
    klabEnter(page);
    S.root = page.firstElementChild;
    mountPreview();
    wireTimeline();
    wireScreen();
    paint();
  }

  // ── The preview: the whole upload, cuts skipped, mutes and gain heard ──
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HLS_LIB;
      s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('no Hls')));
      s.onerror = () => reject(new Error('couldn’t load the player'));
      document.head.appendChild(s);
    });
  }
  function mountPreview(at) {
    const v = S.root.querySelector('.st-screen video');
    S.video = v;
    const src = S.j.source.hls;
    // From where the edit starts (or where it was, after a render).
    if (at == null) { const k0 = map().keeps[0][0]; if (k0 > 0.05) at = k0; }
    const begin = () => { if (at > 0) { try { v.currentTime = at; } catch {} } paintPlayhead(); };
    if (!window.MediaSource && v.canPlayType('application/vnd.apple.mpegurl')) { v.src = src; v.addEventListener('loadedmetadata', begin, { once: true }); }
    else loadHls().then(Hls => {
      if (!S || S.video !== v) return;
      if (!Hls.isSupported()) { v.src = src; v.addEventListener('loadedmetadata', begin, { once: true }); return; }
      const h = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20, startPosition: at > 0 ? at : -1 });
      S.hls = h;
      h.loadSource(src);
      h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, begin);
    }).catch(e => showToast('Couldn’t start the preview: ' + e.message, 'ti-alert-triangle'));
    v.addEventListener('play', () => { quiet(); paintPlay(); loop(); });
    v.addEventListener('pause', () => { paintPlay(); paintPlayhead(); });
    v.addEventListener('seeked', () => { paintPlayhead(); paintScreen(); });
    v.addEventListener('loadedmetadata', () => fitStage());
    v.addEventListener('click', () => { if (!S.tool && S.tab !== 'annotations' && S.tab !== 'end') togglePlay(); });
    S.ro = new ResizeObserver(() => { if (!S) return; S.tlW = $('stTl')?.clientWidth || 0; fitStage(); paintTimeline(); });
    S.ro.observe(S.root.querySelector('.st-screen'));
    S.ro.observe(S.root.querySelector('.st-tl'));
  }
  function quiet() {
    try {
      if (window.klabRadio?.station?.()) window.klabRadio.off?.();
      const a = typeof playerState !== 'undefined' && playerState.audio;
      if (a && !a.paused && !window.klabSession?.mirror) a.pause();
      if (window.klabMini?.active?.()) window.klabMini.close();
    } catch {}
  }
  // Gain and mutes, heard: through Web Audio once playing starts.
  function audioGraph() {
    if (S.gainNode || !S.video) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      S.actx = new AC();
      const src = S.actx.createMediaElementSource(S.video);
      S.gainNode = S.actx.createGain();
      src.connect(S.gainNode).connect(S.actx.destination);
    } catch (e) { S.gainNode = null; }
  }
  function applyAudio(t) {
    const e = S.work.edit;
    const muted = e.muteAll || normRanges(e.mute, S.D).some(([a, b]) => t >= a && t < b);
    const g = muted ? 0 : Math.pow(10, (e.gain || 0) / 20);
    if (S.gainNode) { S.gainNode.gain.value = g; if (S.video.muted) S.video.muted = false; }
    else S.video.muted = muted;
  }
  function togglePlay() {
    const v = S.video;
    if (!v) return;
    if (v.paused) {
      audioGraph();
      S.actx?.resume?.();
      const m = map();
      // At the end (or in a cut), from the next kept part / the start.
      if (S.previewCuts && m.cut(v.currentTime)) { const n = m.nextKeep(v.currentTime); v.currentTime = n != null ? n : m.keeps[0][0]; }
      v.play().catch(() => {});
    } else v.pause();
  }
  function loop() {
    cancelAnimationFrame(S.raf);
    const step = () => {
      if (!S || !S.video) return;
      const v = S.video, t = v.currentTime;
      if (S.previewCuts && !v.paused && !v.seeking) {
        const m = map();
        if (m.cut(t)) {
          const n = m.nextKeep(t);
          if (n == null) { v.pause(); v.currentTime = m.keeps[m.keeps.length - 1][1] - 0.05; }
          else v.currentTime = n;
        }
      }
      applyAudio(t);
      paintPlayhead();
      paintScreen();
      if (!v.paused) S.raf = requestAnimationFrame(step);
    };
    S.raf = requestAnimationFrame(step);
  }
  const fps = () => S.j.source.fps || 30;
  function seek(t) {
    if (!S?.video) return;
    S.video.currentTime = clamp(t, 0, Math.max(0, S.D - 0.04));
    paintPlayhead();
    applyAudio(S.video.currentTime);
    paintScreen();
  }
  const now = () => S?.video?.currentTime || 0;

  // The picture's spot in the screen (inside any bars): the editing layer sits there.
  function fitStage() {
    if (!S?.root) return;
    const scr = S.root.querySelector('.st-screen'), fr = $('stFrame');
    const v = S.video;
    const W = scr.clientWidth, H = scr.clientHeight;
    const vw = v.videoWidth || S.j.source.width || 16, vh = v.videoHeight || S.j.source.height || 9;
    const a = vw / vh;
    let w = W, h = W / a;
    if (h > H) { h = H; w = H * a; }
    Object.assign(fr.style, { width: w + 'px', height: h + 'px', left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px' });
    paintCrop();
  }
  // Crop: the part that's kept, the rest shaded (the preview isn't cropped).
  function paintCrop() {
    const el = $('stCrop');
    if (!el) return;
    const e = S.work.edit;
    const rot = e.rotate || 0;
    const fr = $('stFrame');
    fr.style.setProperty('--st-rot', rot + 'deg');
    S.root.querySelector('.st-screen video').style.transform = rot ? 'rotate(' + rot + 'deg)' + (rot % 180 ? ' scale(' + rotScale() + ')' : '') : '';
    if (!e.crop) { el.hidden = true; return; }
    let w = S.j.source.width || 16, h = S.j.source.height || 9;
    if (rot % 180) [w, h] = [h, w];
    const [cw, ch] = e.crop.split(':').map(Number), r = cw / ch;
    let pw = 100, ph = 100;
    if (w / h > r) pw = (h * r) / w * 100; else ph = (w / r) / h * 100;
    el.hidden = false;
    Object.assign(el.style, { width: pw + '%', height: ph + '%', left: (100 - pw) / 2 + '%', top: (100 - ph) / 2 + '%' });
  }
  function rotScale() {
    const w = S.j.source.width || 16, h = S.j.source.height || 9;
    return Math.min(w / h, h / w).toFixed(4);
  }

  // ── Drawing everything (cheap; called after each change) ──
  function paint() {
    if (!S?.root) return;
    S.root.querySelectorAll('[data-st-tab]').forEach(b => { const on = b.dataset.stTab === S.tab; b.setAttribute('aria-pressed', on); b.setAttribute('aria-selected', on); });
    S.root.dataset.tab = S.tab;
    paintStatus();
    paintSide();
    paintTimeline();
    paintCrop();
    paintScreen();
    paintPlayhead();
    S.root.querySelector('[data-st="undo"]').disabled = !S.hist.length;
    S.root.querySelector('[data-st="redo"]').disabled = !S.fut.length;
  }
  function paintStatus() {
    const el = $('stStatus'), r = S.j.render || {};
    const save = $('stSave');
    const d = dirty();
    // A render that failed can be tried again as it is (Save sends it again).
    save.disabled = !d && r.state !== 'failed';
    save.title = !d && r.state === 'failed' ? 'Try rendering the edit again' : '';
    let html = '';
    if (r.state === 'rendering') html = '<span class="vid-spin"></span>Rendering your edit · ' + Math.round((r.progress || 0) * 100) + '%';
    else if (r.state === 'queued') html = '<span class="vid-spin"></span>Waiting to render';
    else if (r.state === 'failed') html = '<i class="ti ti-alert-triangle"></i>The edit didn’t render: ' + esc(r.error || 'unknown error');
    if (d) html = (html ? html + '<span class="st-dot">·</span>' : '') + 'Unsaved changes';
    el.innerHTML = html;
    el.classList.toggle('bad', r.state === 'failed');
  }
  function paintPlay() {
    const b = S?.root?.querySelector('[data-st="play"]');
    if (!b) return;
    const p = S.video.paused;
    b.innerHTML = '<i class="ti ' + (p ? 'ti-player-play-filled' : 'ti-player-pause-filled') + '"></i>';
    b.setAttribute('aria-label', p ? 'Play' : 'Pause');
  }
  function paintPlayhead() {
    if (!S?.root) return;
    const t = now();
    const ph = $('stPlayhead');
    if (ph) ph.style.transform = 'translateX(' + (t * pps()).toFixed(1) + 'px)';
    const m = map();
    const e = m.s2e(t);
    const tm = $('stTime');
    if (tm) tm.innerHTML = (e == null ? '<span class="st-cut-t">In a cut</span>' : fine(e)) + '<span class="st-of"> / ' + fine(m.len) + '</span>' + (S.tab === 'edit' && !isIdentity(S.work.edit) ? '<span class="st-src">upload ' + fine(t) + '</span>' : '');
    const note = $('stCutNote');
    if (note) note.hidden = !(m.cut(t) && (!S.previewCuts || S.video.paused));
  }

  // ── The timeline ──
  const PAD = 12;
  function pps() {
    if (!S.tlW) S.tlW = $('stTl')?.clientWidth || 0;
    const w = (S.tlW || 800) - PAD * 2;
    return Math.max(1, w / Math.max(1, S.D)) * S.zoom;
  }
  const x2t = (tl, clientX) => clamp((clientX - tl.getBoundingClientRect().left + tl.scrollLeft - PAD) / pps(), 0, S.D);
  function ticks() {
    const p = pps();
    const steps = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const step = steps.find(s => s * p >= 80) || 3600;
    let h = '';
    for (let t = 0; t <= S.D + 1e-6; t += step) h += '<span class="st-tick" style="left:' + (PAD + t * p).toFixed(1) + 'px">' + (step < 1 ? fine(t) : dur(t)) + '</span>';
    return h;
  }
  function film() {
    const sb = S.j.source.storyboard;
    if (!sb) return '';
    const p = pps(), H = 44, w = H * sb.w / sb.h;
    const scale = H / sb.h;
    const total = S.D * p;
    const n = Math.max(1, Math.ceil(total / w));
    let h = '';
    for (let k = 0; k < n; k++) {
      const t = (k * w + w / 2) / p;
      const i = Math.min(sb.count - 1, Math.floor(t / sb.interval));
      h += '<span class="st-film-f" style="left:' + (PAD + k * w).toFixed(1) + 'px;width:' + Math.min(w, total - k * w).toFixed(1) + 'px;background-image:url(&quot;' + esc(sb.url) + '&quot;);background-size:' + (sb.cols * sb.w * scale).toFixed(1) + 'px ' + (sb.rows * sb.h * scale).toFixed(1) + 'px;background-position:' + (-(i % sb.cols) * sb.w * scale).toFixed(1) + 'px ' + (-Math.floor(i / sb.cols) * sb.h * scale).toFixed(1) + 'px"></span>';
    }
    return h;
  }
  const L = (a, b) => 'left:' + (PAD + a * pps()).toFixed(1) + 'px;width:' + Math.max(2, (b - a) * pps()).toFixed(1) + 'px';
  function paintTimeline() {
    const inn = $('stTlIn');
    if (!inn || !S) return;
    const p = pps(), m = map(), e = S.work.edit;
    const cuts = [];
    let last = 0;
    for (const [a, b] of m.keeps) { if (a > last + 0.01) cuts.push([last, a]); last = b; }
    if (last < S.D - 0.01) cuts.push([last, S.D]);
    // The ruler and the filmstrip depend only on the scale: kept as they are
    // between redraws (thousands of nodes when zoomed in on a long video).
    const key = p.toFixed(4) + '|' + S.D + '|' + (S.j.source.storyboard?.url || '');
    const oldRuler = inn.querySelector(':scope > .st-ruler'), oldFilm = inn.querySelector('.st-film');
    const same = S.tlKey === key && oldRuler && oldFilm;
    let h = '<div class="st-ruler">' + (same ? '' : ticks()) + '</div>' +
      '<div class="st-track">' +
        '<div class="st-film">' + (same ? '' : film()) + '</div>' +
        '<div class="st-wave' + (S.j.source.wave ? '' : ' none') + '"' + (S.j.source.wave ? ' style="left:' + PAD + 'px;width:' + (S.D * p).toFixed(1) + 'px;background-image:url(&quot;' + esc(S.j.source.wave) + '&quot;)"' : '') + '>' +
          (S.j.source.wave ? '' : '<span>' + (S.j.source.audio === false ? 'No sound' : 'Waveform coming…') + '</span>') + '</div>' +
        (e.muteAll ? '<span class="st-mute all" style="' + L(0, S.D) + '"></span>' : '') +
        normRanges(e.mute, S.D).map(([a, b], i) => '<span class="st-mute' + (S.sel?.kind === 'mute' && S.sel.i === i ? ' on' : '') + '" data-mute="' + i + '" style="' + L(a, b) + '" title="Muted ' + fine(a) + '–' + fine(b) + '"><i class="ti ti-volume-off"></i></span>').join('') +
        cuts.map(([a, b], i) => '<span class="st-cutr' + (S.sel?.kind === 'cut' && Math.abs(S.sel.a - a) < 0.01 ? ' on' : '') + '" data-cut="' + i + '" data-a="' + a + '" data-b="' + b + '" style="' + L(a, b) + '" title="Cut ' + fine(a) + '–' + fine(b) + '"></span>').join('') +
        S.splits.filter(t => !m.cut(t)).map(t => '<span class="st-split" style="left:' + (PAD + t * p).toFixed(1) + 'px"></span>').join('') +
        (S.tab === 'edit' ? '<span class="st-trim l" data-trim="l" style="left:' + (PAD + m.keeps[0][0] * p).toFixed(1) + 'px" title="Trim the start"></span>' +
          '<span class="st-trim r" data-trim="r" style="left:' + (PAD + m.keeps[m.keeps.length - 1][1] * p).toFixed(1) + 'px" title="Trim the end"></span>' : '') +
        (S.sel && (S.sel.kind === 'range' || S.sel.kind === 'seg') ? '<span class="st-sel" style="' + L(S.sel.a, S.sel.b) + '"></span>' : '') +
      '</div>';
    if (S.tab === 'annotations') {
      h += '<div class="st-lanes">' + (S.work.anns.length ? S.work.anns.map(a => {
        const gone = m.s2e(a.start) == null && m.s2e(a.end - 0.01) == null && cuts.some(([x, y]) => a.start >= x - 0.01 && a.end <= y + 0.01);
        return '<div class="st-lane"><span class="st-bar ann-bar t-' + a.type + (S.selAnn === a.id ? ' on' : '') + (gone ? ' gone' : '') + '" data-bar-ann="' + esc(a.id) + '" style="' + L(a.start, a.end) + '">' +
          '<i class="st-bh l" data-bh="l"></i><span>' + esc(a.text || TYPE_WORDS[a.type]) + '</span><i class="st-bh r" data-bh="r"></i></span></div>';
      }).join('') : '<div class="st-lane-empty">No annotations yet. Add one from the panel.</div>') + '</div>';
    } else if (S.tab === 'cards') {
      h += '<div class="st-lanes"><div class="st-lane cards">' + S.work.cards.map(c => '<span class="st-pin' + (S.selCard === c.id ? ' on' : '') + (m.cut(c.at) ? ' gone' : '') + '" data-pin="' + esc(c.id) + '" style="left:' + (PAD + c.at * p).toFixed(1) + 'px" title="' + esc(CARD_WORDS[c.kind]) + ' at ' + fine(m.s2e(c.at, true)) + '"><i class="ti ' + CARD_ICON[c.kind] + '"></i></span>').join('') + '</div></div>';
    } else if (S.tab === 'end') {
      const es = S.work.end;
      if (es) { const a = m.e2s(Math.max(0, m.len - es.start)), b = m.keeps[m.keeps.length - 1][1]; h += '<div class="st-lanes"><div class="st-lane"><span class="st-bar es-bar" style="' + L(a, b) + '"><span>End screen · last ' + es.start + 's</span></span></div></div>'; }
    }
    h += '<span class="st-playhead" id="stPlayhead"><i></i></span>';
    inn.innerHTML = h;
    if (same) { inn.querySelector(':scope > .st-ruler').replaceWith(oldRuler); inn.querySelector('.st-film').replaceWith(oldFilm); }
    S.tlKey = key;
    inn.style.width = (S.D * p + PAD * 2).toFixed(1) + 'px';
    paintPlayhead();
  }

  function wireTimeline() {
    const tl = $('stTl');
    let drag = null;
    tl.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const t = x2t(tl, e.clientX);
      const trim = e.target.closest('[data-trim]');
      const bar = e.target.closest('[data-bar-ann]');
      const pin = e.target.closest('[data-pin]');
      try { tl.setPointerCapture(e.pointerId); } catch {}
      tl.focus({ preventScroll: true });
      if (trim) { S.hist.push(clone(S.work)); S.fut = []; drag = { kind: 'trim', side: trim.dataset.trim }; return; }
      if (bar) {
        const a = S.work.anns.find(x => x.id === bar.dataset.barAnn);
        if (!a) return;
        S.selAnn = a.id;
        S.hist.push(clone(S.work)); S.fut = [];
        drag = { kind: 'ann', a, part: e.target.closest('[data-bh]')?.dataset.bh || 'm', t0: t, s0: a.start, e0: a.end };
        paint();
        return;
      }
      if (pin) {
        const c = S.work.cards.find(x => x.id === pin.dataset.pin);
        if (!c) return;
        S.selCard = c.id;
        S.hist.push(clone(S.work)); S.fut = [];
        drag = { kind: 'card', c, t0: t, a0: c.at };
        paint();
        return;
      }
      const mute = e.target.closest('[data-mute]');
      if (mute) { S.sel = { kind: 'mute', i: +mute.dataset.mute }; paint(); return; }
      const cut = e.target.closest('[data-cut]');
      if (cut) { S.sel = { kind: 'cut', a: +cut.dataset.a, b: +cut.dataset.b }; seek(+cut.dataset.a); paint(); return; }
      drag = { kind: 'sel', t0: t, moved: false, shift: e.shiftKey };
      if (e.shiftKey && S.sel && (S.sel.kind === 'range' || S.sel.kind === 'seg')) { drag.t0 = Math.abs(t - S.sel.a) < Math.abs(t - S.sel.b) ? S.sel.b : S.sel.a; }
      seek(t);
    });
    // Pointer events come faster than frames (and coalesce badly): the
    // latest position is applied once per frame, and flushed on release.
    let moveX = null, moveRaf = 0;
    const flushMove = () => { cancelAnimationFrame(moveRaf); moveRaf = 0; if (moveX != null && drag && S) { const x = moveX; moveX = null; dragTo(x); } moveX = null; };
    tl.addEventListener('pointermove', e => {
      if (!drag) return;
      moveX = e.clientX;
      if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
    });
    function dragTo(clientX) {
      const t = x2t(tl, clientX);
      if (drag.kind === 'trim') {
        const m = map();
        const k = m.keeps;
        if (drag.side === 'l') { const nt = clamp(t, 0, k[k.length - 1][1] - 0.5); S.work.edit.keep = intersect(normRanges(S.work.edit.keep.concat(nt < k[0][0] ? [[nt, k[0][0]]] : []), S.D), nt, S.D); }
        else { const nt = clamp(t, k[0][0] + 0.5, S.D); S.work.edit.keep = intersect(normRanges(S.work.edit.keep.concat(nt > k[k.length - 1][1] ? [[k[k.length - 1][1], nt]] : []), S.D), 0, nt); }
        seek(t);
        paintTimeline(); paintStatus(); paintSide();
        return;
      }
      if (drag.kind === 'ann') {
        const a = drag.a, dt = t - drag.t0;
        if (drag.part === 'l') a.start = clamp(drag.s0 + dt, 0, a.end - 0.2);
        else if (drag.part === 'r') a.end = clamp(drag.e0 + dt, a.start + 0.2, S.D);
        else { const len = drag.e0 - drag.s0; a.start = clamp(drag.s0 + dt, 0, S.D - len); a.end = a.start + len; }
        seek(drag.part === 'r' ? a.end - 0.01 : a.start);
        paintTimeline(); paintStatus(); paintSide();
        return;
      }
      if (drag.kind === 'card') {
        drag.c.at = clamp(drag.a0 + t - drag.t0, 0, S.D - 0.5);
        seek(drag.c.at);
        paintTimeline(); paintStatus(); paintSide();
        return;
      }
      if (drag.kind === 'sel') {
        if (!drag.moved && Math.abs(t - drag.t0) * pps() < 4) return;
        drag.moved = true;
        S.sel = { kind: 'range', a: Math.min(drag.t0, t), b: Math.max(drag.t0, t) };
        seek(t);
        paintTimeline(); paintSide();
      }
    }
    const end = () => {
      flushMove();
      if (!drag || !S) { drag = null; return; }
      const d = drag;
      drag = null;
      if (d.kind === 'sel' && !d.moved && !d.shift) { if (S.sel && (S.sel.kind === 'range' || S.sel.kind === 'seg')) { S.sel = null; } }
      if (d.kind === 'trim' || d.kind === 'ann' || d.kind === 'card') {
        // A press that didn't change anything leaves no history behind.
        if (JSON.stringify(S.hist[S.hist.length - 1]) === JSON.stringify(S.work)) S.hist.pop();
      }
      paint();
    };
    tl.addEventListener('pointerup', end);
    tl.addEventListener('pointercancel', end);
    // A segment between cuts and splits, by double-click.
    tl.addEventListener('dblclick', e => {
      if (e.target.closest('[data-bar-ann], [data-pin], [data-mute], [data-cut]')) return;
      const t = x2t(tl, e.clientX);
      const seg = segmentAt(t);
      if (seg) { S.sel = { kind: 'seg', a: seg[0], b: seg[1] }; paint(); }
    });
    tl.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) {
        if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && tl.scrollWidth > tl.clientWidth && !e.target.closest('.st-lanes')) { tl.scrollLeft += e.deltaY; e.preventDefault(); }
        return;
      }
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
    }, { passive: false });
    tl.addEventListener('contextmenu', e => {
      const t = x2t(tl, e.clientX);
      const bar = e.target.closest('[data-bar-ann]'), pin = e.target.closest('[data-pin]');
      if (bar) { S.selAnn = bar.dataset.barAnn; paint(); klabMenu(e, annMenu()); return; }
      if (pin) { S.selCard = pin.dataset.pin; paint(); klabMenu(e, cardMenu()); return; }
      const cut = e.target.closest('[data-cut]'), mute = e.target.closest('[data-mute]');
      if (cut) S.sel = { kind: 'cut', a: +cut.dataset.a, b: +cut.dataset.b };
      else if (mute) S.sel = { kind: 'mute', i: +mute.dataset.mute };
      else if (!(S.sel && S.sel.a <= t && S.sel.b >= t)) { seek(t); }
      paint();
      klabMenu(e, editMenu());
    });
  }
  function segmentAt(t) {
    const m = map();
    const k = m.keeps.find(([a, b]) => t >= a && t < b);
    if (!k) return null;
    const pts = S.splits.filter(x => x > k[0] && x < k[1]).sort((a, b) => a - b);
    let a = k[0];
    for (const p of pts) { if (t < p) return [a, p]; a = p; }
    return [a, k[1]];
  }
  function zoomBy(f, clientX) {
    const tl = $('stTl');
    const anchor = clientX != null ? x2t(tl, clientX) : now();
    const ax = clientX != null ? clientX - tl.getBoundingClientRect().left : (anchor * pps() + PAD - tl.scrollLeft);
    S.zoom = clamp(S.zoom * f, 1, 200);
    paintTimeline();
    tl.scrollLeft = Math.max(0, anchor * pps() + PAD - ax);
  }

  // ── Edit operations ──
  function selRange() {
    const s = S.sel;
    if (!s) return null;
    if (s.kind === 'range' || s.kind === 'seg' || s.kind === 'cut') return [s.a, s.b];
    if (s.kind === 'mute') { const r = normRanges(S.work.edit.mute, S.D)[s.i]; return r || null; }
    return null;
  }
  function cutOut() {
    const r = selRange();
    if (!r || S.sel.kind === 'cut' || S.sel.kind === 'mute') return;
    const [a, b] = r;
    const left = subtract(normRanges(S.work.edit.keep, S.D), a, b);
    if (!left.length || left.reduce((n, [x, y]) => n + y - x, 0) < 1) { showToast('That would cut out the whole video', 'ti-scissors'); return; }
    change(w => { w.edit.keep = left; });
    S.sel = { kind: 'cut', a, b };
    seek(a);
    SFX && SFX.play('click');
    paint();
  }
  function restore() {
    if (S.sel?.kind !== 'cut') return;
    const { a, b } = S.sel;
    change(w => { w.edit.keep = union(normRanges(w.edit.keep, S.D), a, b, S.D); });
    S.sel = { kind: 'range', a, b };
    paint();
  }
  function keepOnly() {
    const r = selRange();
    if (!r) return;
    change(w => { w.edit.keep = intersect(normRanges(w.edit.keep, S.D), r[0], r[1]); });
    S.sel = null; seek(r[0]); paint();
  }
  function muteSel() {
    const r = selRange();
    if (!r) return;
    if (S.sel.kind === 'mute') { const i = S.sel.i; change(w => { const m = normRanges(w.edit.mute, S.D); m.splice(i, 1); w.edit.mute = m; }); S.sel = null; paint(); return; }
    change(w => { w.edit.mute = normRanges(w.edit.mute.concat([r]), S.D); });
    paint();
  }
  function trimAt(side) {
    const t = now();
    const k = normRanges(S.work.edit.keep, S.D);
    if (side === 'l') { if (t >= k[k.length - 1][1] - 0.5) return; change(w => { w.edit.keep = intersect(normRanges(w.edit.keep, S.D), t, S.D); }); }
    else { if (t <= k[0][0] + 0.5) return; change(w => { w.edit.keep = intersect(normRanges(w.edit.keep, S.D), 0, t); }); }
  }
  function split() {
    const t = now();
    if (map().cut(t)) return;
    if (S.splits.some(x => Math.abs(x - t) < 0.05)) return;
    S.splits.push(t);
    const seg = segmentAt(t + 0.01);
    if (seg) S.sel = { kind: 'seg', a: seg[0], b: seg[1] };
    paint();
  }
  function setIn(side) {
    const t = now();
    const s = S.sel && (S.sel.kind === 'range' || S.sel.kind === 'seg') ? S.sel : { a: t, b: Math.min(S.D, t + 5) };
    if (side === 'in') S.sel = { kind: 'range', a: Math.min(t, s.b - 0.1), b: s.b };
    else S.sel = { kind: 'range', a: Math.min(s.a, S.D - 0.1), b: Math.min(S.D, Math.max(t, s.a + 0.1)) };
    paint();
  }
  async function saveClip() {
    const r = selRange();
    if (!r) return;
    if (!window.klabClips?.fromRange) { showToast('Clips need the latest klabnet', 'ti-scissors'); return; }
    try {
      // The Studio works in the upload's time: say so, and send the edit as
      // it is in the editor (saved or not), so the clip is what's on screen.
      await window.klabClips.fromRange(S.id, r[0], r[1], { title: S.title, timeline: 'upload', edit: forServer().edit });
      showToast('Making a clip of ' + fine(r[0]) + '–' + fine(r[1]) + '. It shows in Clips when it’s ready', 'ti-scissors', 6000, null, null,
        { action: { label: 'Clips', run: () => window.klabClips?.show?.({ user: me() }) } });
    } catch (e) { showToast('Couldn’t make a clip: ' + klabCap(e.message), 'ti-alert-triangle'); }
  }
  async function frameThumb() {
    const v = S.video;
    if (!v || !v.videoWidth) return;
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('no picture');
      const fd = new FormData();
      fd.append('file', blob, 'frame.jpg');
      const nv = await getJSON(API + '/' + S.id + '/poster', { method: 'PUT', body: fd }, 60000);
      window.klabVideoCached?.(nv.id, nv);
      S.j.poster = nv.posterSmall;
      showToast('Thumbnail set from ' + fine(map().s2e(now(), true)), 'ti-photo');
      if (S.tab === 'details') paintSide();
    } catch (e) { showToast('Couldn’t set the thumbnail: ' + klabCap(e.message), 'ti-alert-triangle'); }
  }
  function editMenu() {
    const r = selRange(), s = S.sel;
    return [
      { header: r ? fine(r[0]) + '–' + fine(r[1]) : 'At ' + fine(now()) },
      { label: 'Cut out', icon: 'ti-scissors', hint: 'Delete', hidden: !r || s.kind === 'cut' || s.kind === 'mute', action: cutOut },
      { label: 'Keep only this', icon: 'ti-arrows-horizontal', hidden: !r || s.kind === 'cut' || s.kind === 'mute', action: keepOnly },
      { label: 'Restore this part', icon: 'ti-restore', hidden: s?.kind !== 'cut', action: restore },
      { label: s?.kind === 'mute' ? 'Unmute' : 'Mute', icon: s?.kind === 'mute' ? 'ti-volume' : 'ti-volume-off', hint: 'M', hidden: !r || s.kind === 'cut', action: muteSel },
      { label: 'Save as clip…', icon: 'ti-scissors', hidden: !r || s.kind === 'cut' || !window.klabClips?.fromRange, action: saveClip },
      '-',
      { label: 'Split at playhead', icon: 'ti-separator-vertical', hint: 'S', action: split },
      { label: 'Trim start to here', icon: 'ti-chevron-left-pipe', hint: '[', action: () => trimAt('l') },
      { label: 'Trim end to here', icon: 'ti-chevron-right-pipe', hint: ']', action: () => trimAt('r') },
      { label: 'Use this frame as the thumbnail', icon: 'ti-photo', action: frameThumb },
    ];
  }

  // ── The side panel, per tab ──
  const TYPE_WORDS = { note: 'Note', bubble: 'Speech bubble', title: 'Title', spotlight: 'Spotlight', label: 'Label' };
  const TYPE_ICON = { note: 'ti-note', bubble: 'ti-message-2', title: 'ti-letter-t', spotlight: 'ti-focus-2', label: 'ti-tag' };
  const CARD_WORDS = { video: 'Video', playlist: 'Playlist', channel: 'Channel', tv: 'TV channel', link: 'Link', poll: 'Poll' };
  const CARD_ICON = { video: 'ti-movie', playlist: 'ti-playlist', channel: 'ti-user', tv: 'ti-device-tv', link: 'ti-link', poll: 'ti-chart-bar' };
  const ES_WORDS = { video: 'A video', latest: 'Latest from you', best: 'Best for viewer', playlist: 'Playlist', channel: 'Your channel', tv: 'TV channel', link: 'Link' };
  function paintSide() {
    const el = $('stSide');
    if (!el) return;
    const keep = el.querySelector(':focus');
    const keepId = keep?.id;
    const fn = { edit: sideEdit, annotations: sideAnns, cards: sideCards, end: sideEnd, details: sideDetails }[S.tab];
    el.innerHTML = fn();
    wireSide(el);
    if (keepId) { const f = $(keepId); if (f) { f.focus(); if (f.setSelectionRange && f.value != null && /text|search|url/.test(f.type || 'text')) { try { f.setSelectionRange(f.value.length, f.value.length); } catch {} } } }
  }
  const row = (label, inner) => '<div class="st-row"><span class="st-row-l">' + label + '</span><div class="st-row-v">' + inner + '</div></div>';
  function sideEdit() {
    const e = S.work.edit, m = map(), r = selRange(), s = S.sel;
    const live = S.j.live;
    const gone = S.D - m.len;
    return '<div class="k-label">Edit</div>' +
      '<p class="st-hint">Drag across the timeline to pick a part, then cut it out or mute it. Nothing is lost: your upload is kept, and the video is made again from it.</p>' +
      '<div class="st-stat"><b>' + fine(m.len) + '</b><span>' + (gone > 0.05 ? fine(gone) + ' cut from ' + fine(S.D) : 'The whole upload') + '</span></div>' +
      (r ? '<div class="st-selbox"><div class="st-selhead">' + (s.kind === 'cut' ? 'Cut part' : s.kind === 'mute' ? 'Muted part' : 'Selected') + ' · ' + fine(r[0]) + '–' + fine(r[1]) + '</div><div class="st-btns">' +
        (s.kind === 'cut' ? '<button type="button" class="k-btn sm" data-op="restore"><i class="ti ti-restore"></i><span>Restore</span></button>'
          : (s.kind === 'mute' ? '' : '<button type="button" class="k-btn sm" data-op="cut"><i class="ti ti-scissors"></i><span>Cut out</span></button><button type="button" class="k-btn sm" data-op="keep"><span>Keep only this</span></button>') +
            '<button type="button" class="k-btn sm" data-op="mute"><i class="ti ' + (s.kind === 'mute' ? 'ti-volume' : 'ti-volume-off') + '"></i><span>' + (s.kind === 'mute' ? 'Unmute' : 'Mute') + '</span></button>' +
            (s.kind !== 'mute' && window.klabClips?.fromRange ? '<button type="button" class="k-btn sm" data-op="clip"><i class="ti ti-scissors"></i><span>Save as clip</span></button>' : '')) +
        '</div></div>' : '') +
      '<div class="st-btns">' +
        '<button type="button" class="k-btn sm" data-op="trim-l" title="Trim the start to the playhead ([)"><i class="ti ti-chevron-left-pipe"></i><span>Start here</span></button>' +
        '<button type="button" class="k-btn sm" data-op="trim-r" title="Trim the end to the playhead (])"><i class="ti ti-chevron-right-pipe"></i><span>End here</span></button>' +
        '<button type="button" class="k-btn sm" data-op="split" title="Split at the playhead (S)"><i class="ti ti-separator-vertical"></i><span>Split</span></button>' +
      '</div>' +
      '<div class="k-label st-sub">Sound</div>' +
      row('Mute all', '<input type="checkbox" class="k-switch" id="stMuteAll" role="switch"' + (e.muteAll ? ' checked' : '') + (S.j.source.audio === false ? ' disabled' : '') + '>') +
      row('Volume', '<input type="range" class="st-range" id="stGain" min="-20" max="20" step="1" value="' + (e.gain || 0) + '" aria-label="Volume (dB)"><span class="st-val" id="stGainV">' + (e.gain > 0 ? '+' : '') + (e.gain || 0) + ' dB</span>') +
      '<div class="k-label st-sub">Picture</div>' +
      row('Crop', '<div class="k-seg st-seg" id="stCropSeg">' + [['', 'None'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']].map(([k, l]) => '<button type="button" data-crop="' + k + '" aria-pressed="' + ((e.crop || '') === k) + '">' + l + '</button>').join('') + '</div>') +
      row('Rotate', '<button type="button" class="k-btn sm" data-op="rotate"><i class="ti ti-rotate-clockwise"></i><span>' + (e.rotate ? e.rotate + '°' : 'Rotate 90°') + '</span></button>') +
      row('Thumbnail', '<button type="button" class="k-btn sm" data-op="thumb"><i class="ti ti-photo"></i><span>Use this frame</span></button>') +
      row('Preview', '<label class="st-check"><input type="checkbox" class="k-check" id="stPrevCuts"' + (S.previewCuts ? ' checked' : '') + '><span>Skip cut parts</span></label>') +
      (live || S.j.edit ? '<div class="st-revert"><button type="button" class="k-btn sm ghost" data-op="revert"><i class="ti ti-restore"></i><span>Revert to original</span></button></div>' : '') +
      '<div class="st-keys">S split · Delete cut · M mute · [ ] trim · I O select · Ctrl+Z undo</div>';
  }
  function sideAnns() {
    const a = S.work.anns.find(x => x.id === S.selAnn);
    const tools = '<div class="st-tools">' + Object.keys(TYPE_WORDS).map(t => '<button type="button" class="st-tool' + (S.tool === t ? ' on' : '') + '" data-tool="' + t + '" aria-pressed="' + (S.tool === t) + '" title="' + TYPE_WORDS[t] + ': press, or draw it on the picture"><i class="ti ' + TYPE_ICON[t] + '"></i><span>' + TYPE_WORDS[t] + '</span></button>').join('') + '</div>';
    if (!a) return '<div class="k-label">Add an annotation</div>' + tools +
      '<p class="st-hint">Pick a kind and draw a box on the picture, or press it again to put one at the playhead. Drag boxes to move them, their corners to size them, and their bars on the timeline to time them.</p>' +
      (S.work.anns.length ? '<div class="k-label st-sub">On this video</div><div class="st-list">' + S.work.anns.map(x => '<button type="button" class="st-li" data-pick-ann="' + esc(x.id) + '"><i class="ti ' + TYPE_ICON[x.type] + '"></i><span>' + esc(x.text || TYPE_WORDS[x.type]) + '</span><small>' + fine(map().s2e(x.start, true)) + '</small></button>').join('') + '</div>' : '');
    const st = a.style || {};
    const m = map();
    const inCut = m.s2e(a.start) == null && m.s2e(a.end - 0.01) == null;
    return '<div class="st-panel-head"><span class="k-label">' + TYPE_WORDS[a.type] + '</span><button type="button" class="k-icon sm" data-op="ann-done" title="Done" aria-label="Done"><i class="ti ti-x"></i></button></div>' +
      '<div class="k-seg st-seg st-types">' + Object.keys(TYPE_WORDS).map(t => '<button type="button" data-ann-type="' + t + '" aria-pressed="' + (a.type === t) + '" title="' + TYPE_WORDS[t] + '"><i class="ti ' + TYPE_ICON[t] + '"></i></button>').join('') + '</div>' +
      '<textarea class="k-field st-text" id="stAnnText" rows="3" maxlength="500" placeholder="' + (a.type === 'spotlight' ? 'Shown when someone points at it' : 'Text') + '">' + esc(a.text || '') + '</textarea>' +
      (a.type === 'title' || a.type === 'spotlight' ? '' : row('Colour', swatches(st.bg || '#141416', 'bg'))) +
      row('Size', '<div class="k-seg st-seg">' + [['sm', 'S'], ['md', 'M'], ['lg', 'L']].map(([k, l]) => '<button type="button" data-ann-size="' + k + '" aria-pressed="' + ((st.size || 'md') === k) + '">' + l + '</button>').join('') + '</div>') +
      row('Starts', '<input class="k-field st-tf" id="stAnnStart" value="' + fine(m.s2e(a.start, true)) + '" aria-label="Starts at"><button type="button" class="k-btn sm" data-op="ann-start">At playhead</button>') +
      row('Ends', '<input class="k-field st-tf" id="stAnnEnd" value="' + fine(m.s2e(a.end, true)) + '" aria-label="Ends at"><button type="button" class="k-btn sm" data-op="ann-end">At playhead</button>') +
      (inCut ? '<p class="st-warn"><i class="ti ti-alert-triangle"></i>This is in a part you cut. It goes when you save.</p>' : '') +
      '<div class="k-label st-sub">Link</div>' + linkEditor(a.link, { id: 'stAnnLink', kinds: ['', 'time', 'video', 'playlist', 'channel', 'tv', 'url'] }) +
      '<div class="st-btns st-foot"><button type="button" class="k-btn sm" data-op="ann-dup"><i class="ti ti-copy"></i><span>Duplicate</span></button><button type="button" class="k-btn sm danger" data-op="ann-del"><i class="ti ti-trash"></i><span>Delete</span></button></div>';
  }
  function swatches(cur, key) {
    return '<div class="st-sw">' + PALETTE.map(p => '<button type="button" class="st-swatch' + (cur.toLowerCase() === p.bg ? ' on' : '') + '" data-sw-' + key + '="' + p.bg + '" style="--sw:' + p.bg + '" title="' + p.name + '" aria-label="' + p.name + '"></button>').join('') +
      '<label class="st-swatch custom' + (PALETTE.some(p => p.bg === cur.toLowerCase()) ? '' : ' on') + '" title="Custom" style="--sw:' + esc(cur) + '"><input type="color" data-sw-custom="' + key + '" value="' + esc(/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#141416') + '" aria-label="Custom colour"></label></div>';
  }
  // ── The link picker (annotations, cards, the end screen) ──
  const LINK_KIND_WORDS = { '': 'None', time: 'A time in this video', video: 'A video', playlist: 'A playlist', channel: 'A channel', tv: 'A TV channel', url: 'A website' };
  function linkEditor(link, o) {
    const k = link ? link.kind : '';
    let v = '';
    if (k === 'time') v = '<input class="k-field st-tf" data-lk="t" value="' + fine(link.t || 0) + '" aria-label="Time"><button type="button" class="k-btn sm" data-lk-now>Playhead</button>';
    else if (k === 'video') {
      const x = S.refs.videos?.[link.id];
      v = '<button type="button" class="k-btn sm st-pickbtn" data-lk-pick="video"><i class="ti ti-movie"></i><span>' + esc(x ? x.title : link.id ? 'Video ' + link.id : 'Choose a video…') + '</span></button>' +
        '<input class="k-field st-tf" data-lk="vt" value="' + (link.t ? fine(link.t) : '') + '" placeholder="From 0:00" aria-label="Start at">';
    }
    else if (k === 'playlist') { const x = S.refs.playlists?.[link.id]; v = '<button type="button" class="k-btn sm st-pickbtn" data-lk-pick="playlist"><i class="ti ti-playlist"></i><span>' + esc(x ? x.name : link.id ? link.id : 'Choose a playlist…') + '</span></button>'; }
    else if (k === 'tv') { const x = S.refs.tv?.[link.id]; v = '<button type="button" class="k-btn sm st-pickbtn" data-lk-pick="tv"><i class="ti ti-device-tv"></i><span>' + esc(x ? x.number + ' · ' + x.name : link.id ? link.id : 'Choose a channel…') + '</span></button>'; }
    else if (k === 'channel') v = '<input class="k-field" data-lk="user" value="' + esc(link.user || '') + '" placeholder="Username" autocomplete="off" spellcheck="false" aria-label="Username">';
    else if (k === 'url') v = '<input class="k-field" data-lk="url" type="url" value="' + esc(link.url || '') + '" placeholder="https://" aria-label="Address">' +
      (o.title ? '<input class="k-field" data-lk="title" value="' + esc(link.title || '') + '" placeholder="Title (optional)" maxlength="80" aria-label="Title">' : '');
    return '<div class="st-link" data-link-for="' + o.id + '">' +
      (o.kinds.length > 1 ? '<button type="button" class="k-btn sm st-lkkind" data-lk-kind><span>' + LINK_KIND_WORDS[k] + '</span><i class="ti ti-chevron-down"></i></button>' : '') +
      '<div class="st-lkval">' + v + '</div></div>';
  }
  function wireLink(root, id, get, set, kinds, opts) {
    const box = root.querySelector('[data-link-for="' + id + '"]');
    if (!box) return;
    box.querySelector('[data-lk-kind]')?.addEventListener('click', ev => {
      klabMenu.at(ev.currentTarget, kinds.map(k => ({ label: LINK_KIND_WORDS[k], checked: (get()?.kind || '') === k, action: () => {
        const nk = k === '' ? null : k === 'time' ? { kind: 'time', t: Math.max(0, map().s2e(now(), true)) } : k === 'channel' ? { kind: 'channel', user: me() } : { kind: k };
        set(nk, true);
        if (k === 'video' || k === 'playlist' || k === 'tv') setTimeout(() => box.isConnected && root.querySelector('[data-link-for="' + id + '"] [data-lk-pick]')?.click(), 50);
      } })), { align: 'start' });
    });
    const val = (k, x) => {
      const l = clone(get() || {});
      if (k === 't') { const t = parseTime(x); if (t == null) return; l.t = t; }
      else if (k === 'vt') { const t = parseTime(x); if (x.trim() && t == null) return; if (t) l.t = t; else delete l.t; }
      else l[k] = x.trim();
      set(l, false);
    };
    box.querySelectorAll('[data-lk]').forEach(inp => inp.addEventListener('change', () => val(inp.dataset.lk, inp.value)));
    box.querySelector('[data-lk-now]')?.addEventListener('click', () => { const l = clone(get() || { kind: 'time' }); l.t = Math.max(0, map().s2e(now(), true)); set(l, true); });
    box.querySelector('[data-lk-pick]')?.addEventListener('click', ev => pickTarget(ev.currentTarget, ev.currentTarget.dataset.lkPick, picked => { const l = clone(get() || {}); Object.assign(l, picked); set(l, true); }));
  }
  // Choosing what a link points at: videos by search, playlists, TV channels.
  async function pickTarget(anchor, kind, done) {
    if (kind === 'video') { videoPicker(anchor, done); return; }
    if (kind === 'playlist') {
      let pls = [];
      try { pls = (await getJSON(API + '/playlists', null, 8000)).playlists || []; } catch {}
      klabMenu.at(anchor, pls.length ? [{ header: 'Playlists' }].concat(pls.map(p => ({ label: p.name, icon: 'ti-playlist', hint: p.featured ? '' : 'Private', action: () => { S.refs.playlists = { ...(S.refs.playlists || {}), [p.id]: { id: p.id, name: p.name, count: p.count, cover: p.coverSmall || (p.posters || [])[0] || null } }; done({ kind: 'playlist', id: p.id }); } })))
        : [{ header: 'No playlists yet' }], { align: 'start' });
      return;
    }
    if (kind === 'tv') {
      let chs = [];
      try { chs = (await window.klabTv?.channels?.()) || []; } catch {}
      klabMenu.at(anchor, chs.length ? [{ header: 'TV channels' }].concat(chs.map(c => ({ label: c.number + ' · ' + c.name, icon: 'ti-device-tv', action: () => { S.refs.tv = { ...(S.refs.tv || {}), [c.id]: { id: c.id, name: c.name, number: c.number, color: c.color } }; done({ kind: 'tv', id: c.id }); } })))
        : [{ header: 'No TV channels yet' }], { align: 'start' });
    }
  }
  function videoPicker(anchor, done) {
    openChatModal('Choose a video', '<div class="st-vpick"><label class="k-field-box"><i class="ti ti-search"></i><input type="text" id="stVq" placeholder="Search videos" autocomplete="off" spellcheck="false"></label><div class="st-vres" id="stVres"><div class="k-empty">Loading…</div></div></div>' +
      '<div class="dlg-actions"><button class="k-btn" data-dlg-cancel>Cancel</button></div>', null);
    document.querySelector('[data-dlg-cancel]')?.addEventListener('click', () => closeChatModal());
    let t = 0, seq = 0;
    const find = async () => {
      const q = $('stVq')?.value.trim() || '';
      const my = ++seq;
      let vids = [];
      try { vids = (await getJSON(API + '?limit=30&' + (q ? 'q=' + encodeURIComponent(q) : 'sort=new'), null, 8000)).videos || []; } catch {}
      if (my !== seq || !$('stVres')) return;
      vids = vids.filter(x => x.status === 'ready' && x.id !== S.id);
      $('stVres').innerHTML = vids.length ? vids.map(x => '<button type="button" class="st-vrow" data-pick="' + x.id + '">' + (x.posterSmall ? '<img src="' + esc(x.posterSmall) + '" alt="" />' : '<span></span>') + '<span><b>' + esc(x.title || 'Untitled') + '</b><small>' + esc(x.username) + ' · ' + dur(x.duration) + '</small></span></button>').join('') : '<div class="k-empty">Nothing matches that.</div>';
      $('stVres').onclick = e => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        const x = vids.find(v => v.id === +b.dataset.pick);
        S.refs.videos = { ...(S.refs.videos || {}), [x.id]: { id: x.id, title: x.title, posterSmall: x.posterSmall, duration: x.duration, username: x.username } };
        closeChatModal();
        done({ kind: 'video', id: x.id });
      };
    };
    $('stVq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(find, 220); });
    setTimeout(() => $('stVq')?.focus(), 40);
    find();
  }

  function sideCards() {
    const c = S.work.cards.find(x => x.id === S.selCard);
    const add = '<div class="st-tools">' + Object.keys(CARD_WORDS).map(k => '<button type="button" class="st-tool" data-add-card="' + k + '"><i class="ti ' + CARD_ICON[k] + '"></i><span>' + CARD_WORDS[k] + '</span></button>').join('') + '</div>';
    if (!c) return '<div class="k-label">Add a card at the playhead</div>' + add +
      '<p class="st-hint">A card teases in at the top right at its time, for a few seconds, then waits behind the ⓘ. Up to 20.</p>' +
      (S.work.cards.length ? '<div class="k-label st-sub">On this video</div><div class="st-list">' + S.work.cards.map(x => '<button type="button" class="st-li" data-pick-card="' + esc(x.id) + '"><i class="ti ' + CARD_ICON[x.kind] + '"></i><span>' + esc(x.teaser || (x.kind === 'poll' ? x.poll?.question : CARD_WORDS[x.kind]) || CARD_WORDS[x.kind]) + '</span><small>' + fine(map().s2e(x.at, true)) + '</small></button>').join('') + '</div>' : '');
    const m = map();
    const kinds = { video: ['video'], playlist: ['playlist'], channel: ['channel'], tv: ['tv'], link: ['url'] }[c.kind];
    return '<div class="st-panel-head"><span class="k-label">' + CARD_WORDS[c.kind] + ' card</span><button type="button" class="k-icon sm" data-op="card-done" title="Done" aria-label="Done"><i class="ti ti-x"></i></button></div>' +
      row('Shows at', '<input class="k-field st-tf" id="stCardAt" value="' + fine(m.s2e(c.at, true)) + '" aria-label="Shows at"><button type="button" class="k-btn sm" data-op="card-at">At playhead</button>') +
      (m.cut(c.at) ? '<p class="st-warn"><i class="ti ti-alert-triangle"></i>This is in a part you cut. It goes when you save.</p>' : '') +
      '<input class="k-field" id="stCardTeaser" maxlength="80" placeholder="Teaser (optional)" value="' + esc(c.teaser || '') + '" aria-label="Teaser">' +
      (c.kind === 'poll'
        ? '<div class="k-label st-sub">Poll</div><input class="k-field" id="stPollQ" maxlength="140" placeholder="Question" value="' + esc(c.poll?.question || '') + '" aria-label="Question">' +
          '<div class="st-opts">' + (c.poll?.options || []).map((o, i) => '<div class="st-opt"><input class="k-field" data-poll-opt="' + i + '" maxlength="60" placeholder="Answer ' + (i + 1) + '" value="' + esc(o) + '" aria-label="Answer ' + (i + 1) + '">' +
            ((c.poll.options.length > 2) ? '<button type="button" class="k-icon sm" data-poll-rm="' + i + '" title="Remove answer" aria-label="Remove answer"><i class="ti ti-x"></i></button>' : '') + '</div>').join('') + '</div>' +
          ((c.poll?.options || []).length < 4 ? '<button type="button" class="k-btn sm ghost" data-op="poll-add"><i class="ti ti-plus"></i><span>Add an answer</span></button>' : '') +
          (c.poll?.counts ? '<p class="st-hint">' + klabCount(c.poll.counts.reduce((a, b) => a + b, 0), 'vote') + ' so far.</p>' : '')
        : '<div class="k-label st-sub">Points at</div>' + linkEditor(c.target, { id: 'stCardLink', kinds, title: c.kind === 'link' })) +
      '<div class="st-btns st-foot"><button type="button" class="k-btn sm danger" data-op="card-del"><i class="ti ti-trash"></i><span>Delete</span></button></div>';
  }
  // End screen layouts (YouTube's): elements in % of the frame, inside a 5% safe margin.
  const TEMPLATES = [
    { name: 'One video', els: [['latest', 30, 25, 40, 40]] },
    { name: 'Two videos', els: [['latest', 8, 28, 38, 38], ['best', 54, 28, 38, 38]] },
    { name: 'Video and channel', els: [['latest', 10, 26, 44, 44], ['channel', 64, 30, 22, 39]] },
    { name: 'Two videos and channel', els: [['latest', 6, 12, 38, 38], ['best', 6, 56, 38, 38], ['channel', 60, 30, 22, 39]] },
    { name: 'Video, playlist, channel', els: [['latest', 6, 12, 38, 38], ['playlist', 6, 56, 38, 38], ['channel', 60, 30, 22, 39]] },
    { name: 'Four videos', els: [['latest', 8, 10, 38, 38], ['best', 54, 10, 38, 38], ['video', 8, 54, 38, 38], ['video', 54, 54, 38, 38]] },
  ];
  function sideEnd() {
    const es = S.work.end;
    const sel = es && es.elements.find(x => x.id === S.selEs);
    const tmpl = '<div class="st-tmpls">' + TEMPLATES.map((t, i) => '<button type="button" class="st-tmpl" data-tmpl="' + i + '" title="' + t.name + '"><span class="st-tmpl-f">' + t.els.map(([k, x, y, w, h]) => '<i class="' + (k === 'channel' ? 'ch' : '') + '" style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%"></i>').join('') + '</span><span>' + t.name + '</span></button>').join('') + '</div>';
    if (!es) return '<div class="k-label">End screen</div><p class="st-hint">Things to watch next over the last 5 to 20 seconds. Pick a layout to start.</p>' + tmpl +
      (map().len < 6 ? '<p class="st-warn"><i class="ti ti-alert-triangle"></i>The video’s too short for one.</p>' : '');
    return '<div class="k-label">End screen</div>' +
      row('Starts', '<input type="range" class="st-range" id="stEsStart" min="5" max="20" step="1" value="' + es.start + '" aria-label="Seconds before the end"><span class="st-val">last ' + es.start + 's</span>') +
      '<div class="st-list">' + es.elements.map(x => '<button type="button" class="st-li' + (x.id === S.selEs ? ' on' : '') + '" data-pick-es="' + esc(x.id) + '"><i class="ti ' + ({ video: 'ti-movie', latest: 'ti-movie', best: 'ti-sparkles', playlist: 'ti-playlist', channel: 'ti-user', tv: 'ti-device-tv', link: 'ti-link' })[x.kind] + '"></i><span>' + esc(ES_WORDS[x.kind]) + '</span></button>').join('') + '</div>' +
      (sel ? '<div class="st-selbox"><div class="st-selhead">Element</div>' +
        row('Shows', '<button type="button" class="k-btn sm st-lkkind" data-es-kind><span>' + ES_WORDS[sel.kind] + '</span><i class="ti ti-chevron-down"></i></button>') +
        (['video', 'playlist', 'tv', 'link'].includes(sel.kind) ? linkEditor(sel.target, { id: 'stEsLink', kinds: [{ video: 'video', playlist: 'playlist', tv: 'tv', link: 'url' }[sel.kind]], title: sel.kind === 'link' }) : '') +
        '<div class="st-btns"><button type="button" class="k-btn sm danger" data-op="es-del"><i class="ti ti-trash"></i><span>Remove</span></button></div></div>' : '') +
      '<div class="st-btns">' + (es.elements.length < 4 ? '<button type="button" class="k-btn sm" data-op="es-add"><i class="ti ti-plus"></i><span>Add an element</span></button>' : '') +
        '<button type="button" class="k-btn sm ghost" data-op="es-clear"><span>No end screen</span></button></div>' +
      '<div class="k-label st-sub">Layouts</div>' + tmpl +
      '<p class="st-hint">Drag them on the picture; the corner sizes them. They keep clear of the edges.</p>';
  }
  function sideDetails() {
    const j = S.j;
    const v = window.klabVideoCached?.(S.id);
    return '<div class="k-label">Details</div>' +
      '<div class="st-det"><img class="st-det-poster" src="' + esc(j.poster || '') + '" alt="" ' + (j.poster ? '' : 'hidden') + '/><div><b>' + esc(j.title || 'Untitled') + '</b><span>' + fine(map().len) + (S.j.live ? ' · edited' : '') + '</span></div></div>' +
      '<div class="st-btns st-col">' +
        '<button type="button" class="k-btn" data-op="details"><i class="ti ti-pencil"></i><span>Title, description and date…</span></button>' +
        '<button type="button" class="k-btn" data-op="thumb"><i class="ti ti-photo"></i><span>Use the frame at the playhead</span></button>' +
        '<button type="button" class="k-btn" data-op="thumb-file"><i class="ti ti-upload"></i><span>Choose a picture…</span></button>' +
        '<button type="button" class="k-btn" data-op="playlists"' + (v ? '' : ' disabled') + '><i class="ti ti-playlist-add"></i><span>Save to playlist…</span></button>' +
      '</div><input type="file" id="stThumbFile" accept="image/*" hidden>' +
      '<p class="st-hint">Annotations, cards and end screens made on YouTube can’t come across: YouTube took annotations down in 2019, and none of them are in its exports.</p>';
  }

  // ── Wiring the side panel ──
  function wireSide(el) {
    el.onclick = ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      const op = b.dataset.op;
      if (op === 'cut') cutOut();
      else if (op === 'keep') keepOnly();
      else if (op === 'restore') restore();
      else if (op === 'mute') muteSel();
      else if (op === 'clip') saveClip();
      else if (op === 'trim-l') trimAt('l');
      else if (op === 'trim-r') trimAt('r');
      else if (op === 'split') split();
      else if (op === 'rotate') change(w => { w.edit.rotate = ((w.edit.rotate || 0) + 90) % 360; });
      else if (op === 'thumb') frameThumb();
      else if (op === 'thumb-file') $('stThumbFile')?.click();
      else if (op === 'revert') revert();
      else if (op === 'details') { const v = window.klabVideoCached?.(S.id); if (v) window.klabVideoEdit?.(v); else getJSON(API + '/' + S.id).then(x => { window.klabVideoCached?.(x.id, x); window.klabVideoEdit?.(x); }); }
      else if (op === 'playlists') { const v = window.klabVideoCached?.(S.id); if (v) window.klabVideoSave?.(v, b); }
      else if (op === 'ann-done') { S.selAnn = null; paint(); }
      else if (op === 'ann-del') delAnn();
      else if (op === 'ann-dup') dupAnn();
      else if (op === 'ann-start') annTime('start', now());
      else if (op === 'ann-end') annTime('end', now());
      else if (op === 'card-done') { S.selCard = null; paint(); }
      else if (op === 'card-del') delCard();
      else if (op === 'card-at') change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.at = now(); });
      else if (op === 'poll-add') change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c && c.poll.options.length < 4) c.poll.options.push(''); });
      else if (op === 'es-add') addEs();
      else if (op === 'es-del') change(w => { w.end.elements = w.end.elements.filter(x => x.id !== S.selEs); if (!w.end.elements.length) w.end = null; S.selEs = null; });
      else if (op === 'es-clear') { change(w => { w.end = null; }); S.selEs = null; paint(); }
      const tool = b.dataset.tool;
      if (tool) {
        if (S.tool === tool) { S.tool = null; addAnn(tool); } else { S.tool = tool; paint(); }
        return;
      }
      if (b.dataset.pickAnn) { S.selAnn = b.dataset.pickAnn; const a = S.work.anns.find(x => x.id === S.selAnn); if (a) seek(a.start + 0.01); paint(); }
      if (b.dataset.pickCard) { S.selCard = b.dataset.pickCard; const c = S.work.cards.find(x => x.id === S.selCard); if (c) seek(c.at); paint(); }
      if (b.dataset.pickEs) { S.selEs = b.dataset.pickEs; paint(); }
      if (b.dataset.addCard) addCard(b.dataset.addCard);
      if (b.dataset.annType) change(w => { const a = w.anns.find(x => x.id === S.selAnn); if (a) a.type = b.dataset.annType; });
      if (b.dataset.annSize) change(w => { const a = w.anns.find(x => x.id === S.selAnn); if (a) a.style = { ...(a.style || {}), size: b.dataset.annSize }; });
      if (b.dataset.swBg) change(w => { const a = w.anns.find(x => x.id === S.selAnn); if (a) a.style = { ...(a.style || {}), bg: b.dataset.swBg, fg: '' }; });
      if (b.dataset.crop != null) change(w => { w.edit.crop = b.dataset.crop || null; });
      if (b.dataset.tmpl != null) useTemplate(+b.dataset.tmpl);
      if (b.dataset.pollRm != null) change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.poll.options.splice(+b.dataset.pollRm, 1); });
      if (b.hasAttribute('data-es-kind')) {
        klabMenu.at(b, Object.keys(ES_WORDS).map(k => ({ label: ES_WORDS[k], checked: k === S.work.end.elements.find(x => x.id === S.selEs)?.kind, action: () => change(w => {
          const x = w.end.elements.find(y => y.id === S.selEs);
          if (!x) return;
          x.kind = k;
          if (k === 'channel') { x.target = { kind: 'channel', user: me() }; x.h = Math.min(80, x.w * 16 / 9); }
          else if (k === 'latest' || k === 'best') delete x.target;
          else x.target = { kind: k === 'link' ? 'url' : k };
          if (k !== 'channel') x.h = x.w;
        }) })), { align: 'start' });
      }
    };
    el.querySelector('#stMuteAll')?.addEventListener('change', e => change(w => { w.edit.muteAll = e.target.checked; }));
    const gain = el.querySelector('#stGain');
    if (gain) {
      // One undo step per change, by pointer or by keyboard: the state
      // before the first input of it.
      let gainBefore = null;
      gain.addEventListener('input', () => { if (!gainBefore) gainBefore = clone(S.work); S.work.edit.gain = +gain.value; $('stGainV').textContent = (gain.value > 0 ? '+' : '') + gain.value + ' dB'; applyAudio(now()); paintStatus(); });
      gain.addEventListener('change', () => { if (gainBefore) { S.hist.push(gainBefore); S.fut = []; gainBefore = null; } paint(); });
    }
    el.querySelector('#stPrevCuts')?.addEventListener('change', e => { S.previewCuts = e.target.checked; paintPlayhead(); });
    el.querySelector('[data-sw-custom]')?.addEventListener('change', e => change(w => { const a = w.anns.find(x => x.id === S.selAnn); if (a) a.style = { ...(a.style || {}), bg: e.target.value, fg: '' }; }));
    const txt = el.querySelector('#stAnnText');
    if (txt) {
      // An undo step once something's typed, not on merely focusing.
      let txtBefore = null, txtPushed = false;
      txt.addEventListener('focus', () => { txtBefore = clone(S.work); });
      txt.addEventListener('input', () => { if (!txtPushed && txtBefore) { txtPushed = true; S.hist.push(txtBefore); S.fut = []; } const a = S.work.anns.find(x => x.id === S.selAnn); if (a) { a.text = txt.value; paintScreen(); paintStatus(); } });
      txt.addEventListener('change', () => paintTimeline());
    }
    const tf = (id, fn) => el.querySelector('#' + id)?.addEventListener('change', e => { const t = parseTime(e.target.value); if (t == null) { e.target.classList.add('bad'); return; } fn(t); });
    tf('stAnnStart', t => annTime('start', map().e2s(t)));
    tf('stAnnEnd', t => annTime('end', map().e2s(t)));
    tf('stCardAt', t => change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.at = clamp(map().e2s(t), 0, S.D - 0.5); }));
    el.querySelector('#stCardTeaser')?.addEventListener('change', e => change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.teaser = e.target.value.trim(); }));
    el.querySelector('#stPollQ')?.addEventListener('change', e => change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.poll.question = e.target.value.trim(); }));
    el.querySelectorAll('[data-poll-opt]').forEach(inp => inp.addEventListener('change', () => change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.poll.options[+inp.dataset.pollOpt] = inp.value.trim(); })));
    const es = el.querySelector('#stEsStart');
    if (es) {
      es.addEventListener('pointerdown', () => { S.hist.push(clone(S.work)); S.fut = []; });
      es.addEventListener('input', () => { S.work.end.start = +es.value; es.nextElementSibling.textContent = 'last ' + es.value + 's'; paintTimeline(); paintStatus(); seekEnd(); });
    }
    el.querySelector('#stThumbFile')?.addEventListener('change', async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      const fd = new FormData(); fd.append('file', f);
      try { const nv = await getJSON(API + '/' + S.id + '/poster', { method: 'PUT', body: fd }, 60000); window.klabVideoCached?.(nv.id, nv); S.j.poster = nv.posterSmall; showToast('Thumbnail set', 'ti-photo'); paintSide(); }
      catch (err) { showToast('Couldn’t set the thumbnail: ' + klabCap(err.message), 'ti-alert-triangle'); }
    });
    // Links.
    const curAnn = () => S.work.anns.find(x => x.id === S.selAnn);
    wireLink(el, 'stAnnLink', () => curAnn()?.link, (l, now_) => change(w => { const a = w.anns.find(x => x.id === S.selAnn); if (a) a.link = l; }), ['', 'time', 'video', 'playlist', 'channel', 'tv', 'url']);
    const curCard = () => S.work.cards.find(x => x.id === S.selCard);
    if (curCard() && curCard().kind !== 'poll') {
      const k = { video: 'video', playlist: 'playlist', channel: 'channel', tv: 'tv', link: 'url' }[curCard().kind];
      wireLink(el, 'stCardLink', () => curCard()?.target, l => change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.target = l ? { ...l, kind: k } : { kind: k }; }), [k]);
    }
    const curEs = () => S.work.end?.elements.find(x => x.id === S.selEs);
    if (curEs() && ['video', 'playlist', 'tv', 'link'].includes(curEs().kind)) {
      const k = { video: 'video', playlist: 'playlist', tv: 'tv', link: 'url' }[curEs().kind];
      wireLink(el, 'stEsLink', () => curEs()?.target, l => change(w => { const x = w.end.elements.find(y => y.id === S.selEs); if (x) x.target = l ? { ...l, kind: k } : { kind: k }; }), [k]);
    }
  }

  // ── Annotations ──
  function addAnn(type, box) {
    const t = now();
    const b = box || { x: 30, y: 30, w: type === 'title' ? 50 : type === 'label' ? 18 : 34, h: type === 'title' ? 14 : type === 'label' ? 7 : 16 };
    if (!box && type === 'spotlight') Object.assign(b, { x: 35, y: 30, w: 30, h: 30 });
    const a = { id: uid(), type, start: t, end: Math.min(S.D, t + 5), ...b, text: type === 'spotlight' ? '' : '', style: { bg: type === 'note' || type === 'bubble' ? '#141416' : type === 'label' ? '#ffd60a' : '', fg: '', size: 'md', ...(type === 'bubble' ? { tx: 20, ty: 150 } : {}) }, link: null };
    change(w => { w.anns.push(a); });
    S.selAnn = a.id;
    S.tool = null;
    paint();
    setTimeout(() => $('stAnnText')?.focus(), 30);
  }
  function delAnn() { const id = S.selAnn; change(w => { w.anns = w.anns.filter(x => x.id !== id); }); S.selAnn = null; paint(); }
  function dupAnn() {
    const a = S.work.anns.find(x => x.id === S.selAnn);
    if (!a) return;
    const n = { ...clone(a), id: uid(), x: clamp(a.x + 3, 0, 100 - a.w), y: clamp(a.y + 3, 0, 100 - a.h) };
    change(w => { w.anns.push(n); });
    S.selAnn = n.id; paint();
  }
  function annTime(which, t) {
    change(w => {
      const a = w.anns.find(x => x.id === S.selAnn);
      if (!a) return;
      if (which === 'start') { a.start = clamp(t, 0, S.D - 0.2); if (a.end <= a.start + 0.2) a.end = Math.min(S.D, a.start + 5); }
      else { a.end = clamp(t, 0.2, S.D); if (a.start >= a.end - 0.2) a.start = Math.max(0, a.end - 5); }
    });
  }
  function annMenu() {
    return [
      { header: TYPE_WORDS[S.work.anns.find(x => x.id === S.selAnn)?.type] || 'Annotation' },
      { label: 'Start at playhead', icon: 'ti-chevron-left-pipe', action: () => annTime('start', now()) },
      { label: 'End at playhead', icon: 'ti-chevron-right-pipe', action: () => annTime('end', now()) },
      { label: 'Duplicate', icon: 'ti-copy', action: dupAnn },
      '-',
      { label: 'Delete', icon: 'ti-trash', danger: true, hint: 'Delete', action: delAnn },
    ];
  }
  // ── Cards ──
  function addCard(kind) {
    const c = { id: uid(), kind, at: now(), teaser: '' };
    if (kind === 'poll') c.poll = { question: '', options: ['', ''] };
    else c.target = kind === 'channel' ? { kind: 'channel', user: me() } : { kind: kind === 'link' ? 'url' : kind };
    change(w => { w.cards.push(c); w.cards.sort((a, b) => a.at - b.at); });
    S.selCard = c.id;
    paint();
    if (kind === 'poll') setTimeout(() => $('stPollQ')?.focus(), 30);
    else if (kind !== 'channel' && kind !== 'link') setTimeout(() => $('stSide')?.querySelector('[data-lk-pick]')?.click(), 60);
  }
  function delCard() { const id = S.selCard; change(w => { w.cards = w.cards.filter(x => x.id !== id); }); S.selCard = null; paint(); }
  function cardMenu() {
    return [
      { header: CARD_WORDS[S.work.cards.find(x => x.id === S.selCard)?.kind] || 'Card' },
      { label: 'Move to playhead', icon: 'ti-clock', action: () => change(w => { const c = w.cards.find(x => x.id === S.selCard); if (c) c.at = now(); }) },
      '-',
      { label: 'Delete', icon: 'ti-trash', danger: true, action: delCard },
    ];
  }
  // ── The end screen ──
  function seekEnd() {
    const es = S.work.end, m = map();
    if (!es) return;
    seek(m.e2s(Math.max(0, m.len - es.start + 0.5)));
  }
  function useTemplate(i) {
    const t = TEMPLATES[i];
    const old = S.work.end;
    change(w => {
      w.end = { start: old ? old.start : 10, elements: t.els.map(([k, x, y, ww, h], n) => {
        const prev = old?.elements[n];
        const el = { id: uid(), kind: k, x, y, w: ww, h };
        if (prev && prev.kind === k && prev.target) el.target = clone(prev.target);
        else if (k === 'channel') el.target = { kind: 'channel', user: me() };
        else if (k === 'video' || k === 'playlist') el.target = { kind: k };
        return el;
      }) };
    });
    S.selEs = null;
    seekEnd();
    paint();
  }
  function addEs() {
    change(w => {
      const n = w.end.elements.length;
      w.end.elements.push({ id: uid(), kind: 'video', target: { kind: 'video' }, x: 6 + n * 4, y: 10 + n * 6, w: 30, h: 30 });
      S.selEs = w.end.elements[w.end.elements.length - 1].id;
    });
  }

  // ── The screen: annotations and the end screen, edited in place ──
  function paintScreen() {
    const lay = $('stOvl');
    if (!lay || !S) return;
    const t = now();
    let h = '';
    if (S.tab === 'annotations') {
      h = S.work.anns.filter(a => (t >= a.start && t < a.end) || a.id === S.selAnn).map(a =>
        annHTML(a, { edit: true, cls: (a.id === S.selAnn ? 'sel' : '') + ((t >= a.start && t < a.end) ? ' on' : ' off') }).replace(/<\/(div|button)>$/, (a.id === S.selAnn ? handles(a) : '') + '</$1>')).join('');
    } else if (S.tab === 'end' && S.work.end) {
      const m = map();
      const showing = m.s2e(t, true) >= m.len - S.work.end.start - 0.05;
      h = '<div class="es-safe"></div>' + S.work.end.elements.map(el => esHTML(el, S.refs, { username: me() }, true).replace(/^<div class="es /, '<div class="es ' + (el.id === S.selEs ? 'sel ' : '') + (showing ? 'on ' : 'off ')).replace(/<\/div>$/, (el.id === S.selEs ? '<i class="st-h br" data-h="br"></i>' : '') + '</div>')).join('');
    } else if (S.tab === 'cards') {
      const m = map();
      const c = S.work.cards.filter(x => x.at <= t && t < x.at + 5).pop();
      if (c) h = '<div class="vp-cards st-cardprev"><div class="vp-teaser on"><span>' + esc(c.teaser || cardWordsFor(c)) + '</span></div></div>';
      void m;
    }
    // (Compared with what was written last: the DOM serialises <img />,
    // <polygon/> and escapes differently, so comparing with innerHTML
    // rewrote the layer on every frame while playing.)
    if (lay._h !== h) { lay._h = h; lay.innerHTML = h; refreshFacesIn(lay); }
    lay.classList.toggle('drawing', !!S.tool);
  }
  function cardWordsFor(c) {
    const t = c.target || {};
    if (c.kind === 'poll') return c.poll?.question || 'Poll';
    if (c.kind === 'video') return S.refs.videos?.[t.id]?.title || 'A video';
    if (c.kind === 'playlist') return S.refs.playlists?.[t.id]?.name || 'A playlist';
    if (c.kind === 'channel') return 'More from ' + (t.user || '');
    if (c.kind === 'tv') { const x = S.refs.tv?.[t.id]; return x ? 'Channel ' + x.number + ' · ' + x.name : 'A TV channel'; }
    return t.title || domain(t.url) || 'A link';
  }
  const handles = a => ['tl', 'tr', 'bl', 'br'].map(k => '<i class="st-h ' + k + '" data-h="' + k + '"></i>').join('') + (a.type === 'bubble' ? '<i class="st-tailh" data-h="tail" style="left:' + (a.style?.tx ?? 20) + '%;top:' + (a.style?.ty ?? 150) + '%"></i>' : '');

  function wireScreen() {
    const fr = $('stFrame');
    let d = null;
    const pct = e => { const r = fr.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100, r }; };
    fr.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = pct(e);
      if (S.tab === 'annotations') {
        const h = e.target.closest('[data-h]'), box = e.target.closest('.ann');
        if (S.tool && !box) {
          try { fr.setPointerCapture(e.pointerId); } catch {}
          d = { kind: 'draw', x0: p.x, y0: p.y, type: S.tool };
          return;
        }
        if (!box) { if (S.selAnn) { S.selAnn = null; paint(); } return; }
        const a = S.work.anns.find(x => x.id === box.dataset.ann);
        if (!a) return;
        if (S.selAnn !== a.id) { S.selAnn = a.id; paint(); }
        try { fr.setPointerCapture(e.pointerId); } catch {}
        S.hist.push(clone(S.work)); S.fut = [];
        d = { kind: h ? h.dataset.h : 'move', a, p0: p, o: { x: a.x, y: a.y, w: a.w, h: a.h, tx: a.style?.tx, ty: a.style?.ty } };
        e.preventDefault();
        return;
      }
      if (S.tab === 'end' && S.work.end) {
        const h = e.target.closest('[data-h]'), box = e.target.closest('.es');
        if (!box) { if (S.selEs) { S.selEs = null; paint(); } return; }
        const el = S.work.end.elements.find(x => x.id === box.dataset.es);
        if (!el) return;
        if (S.selEs !== el.id) { S.selEs = el.id; paint(); }
        try { fr.setPointerCapture(e.pointerId); } catch {}
        S.hist.push(clone(S.work)); S.fut = [];
        d = { kind: h ? 'es-size' : 'es-move', el, p0: p, o: { x: el.x, y: el.y, w: el.w, h: el.h } };
        e.preventDefault();
        return;
      }
      if (S.tab === 'edit' || S.tab === 'cards' || S.tab === 'details') togglePlay();
    });
    fr.addEventListener('pointermove', e => {
      if (!d) return;
      const p = pct(e);
      if (d.kind === 'draw') {
        const lay = $('stOvl');
        let g = lay.querySelector('.st-ghost');
        if (!g) { g = document.createElement('div'); g.className = 'st-ghost'; lay.appendChild(g); }
        const x = Math.min(d.x0, p.x), y = Math.min(d.y0, p.y);
        Object.assign(g.style, { left: clamp(x, 0, 100) + '%', top: clamp(y, 0, 100) + '%', width: Math.abs(p.x - d.x0) + '%', height: Math.abs(p.y - d.y0) + '%' });
        return;
      }
      const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
      if (d.kind === 'es-move' || d.kind === 'es-size') {
        const el = d.el, M = 5;
        // Snapped to a 1% grid, inside the safe margin.
        if (d.kind === 'es-move') { el.x = Math.round(clamp(d.o.x + dx, M, 100 - M - el.w)); el.y = Math.round(clamp(d.o.y + dy, M, 100 - M - el.h)); }
        else {
          const ratio = d.o.h / d.o.w;
          el.w = Math.round(clamp(d.o.w + dx, 10, Math.min(60, 100 - M - el.x)));
          el.h = Math.round(clamp(el.w * ratio, 8, 100 - M - el.y));
        }
        paintScreen(); paintStatus();
        return;
      }
      const a = d.a, o = d.o;
      if (d.kind === 'move') { a.x = clamp(o.x + dx, 0, 100 - a.w); a.y = clamp(o.y + dy, 0, 100 - a.h); }
      else if (d.kind === 'tail') {
        const r = p.r;
        const bx = r.width * a.w / 100, by = r.height * a.h / 100;
        const px = (p.x - a.x) / a.w * 100, py = (p.y - a.y) / a.h * 100;
        void bx; void by;
        a.style = { ...(a.style || {}), tx: Math.round(clamp(px, -50, 150)), ty: Math.round(clamp(py, -50, 150)) };
      } else {
        let { x, y, w, h } = o;
        if (d.kind.includes('l')) { const nx = clamp(x + dx, 0, x + w - 3); w = w + (x - nx); x = nx; }
        if (d.kind.includes('r')) w = clamp(w + dx, 3, 100 - x);
        if (d.kind.includes('t')) { const ny = clamp(y + dy, 0, y + h - 3); h = h + (y - ny); y = ny; }
        if (d.kind.includes('b')) h = clamp(h + dy, 3, 100 - y);
        Object.assign(a, { x, y, w, h });
      }
      paintScreen(); paintStatus();
    });
    const end = e => {
      if (!d) return;
      const dd = d;
      d = null;
      if (dd.kind === 'draw') {
        $('stOvl').querySelector('.st-ghost')?.remove();
        const p = pct(e);
        const w = Math.abs(p.x - dd.x0), h = Math.abs(p.y - dd.y0);
        if (w < 3 || h < 3) { addAnn(dd.type); return; }
        addAnn(dd.type, { x: clamp(Math.min(dd.x0, p.x), 0, 97), y: clamp(Math.min(dd.y0, p.y), 0, 97), w: Math.min(w, 100), h: Math.min(h, 100) });
        return;
      }
      if (JSON.stringify(S.hist[S.hist.length - 1]) === JSON.stringify(S.work)) S.hist.pop();
      for (const a of S.work.anns) { a.x = +a.x.toFixed(2); a.y = +a.y.toFixed(2); a.w = +a.w.toFixed(2); a.h = +a.h.toFixed(2); }
      paint();
    };
    fr.addEventListener('pointerup', end);
    fr.addEventListener('pointercancel', end);
    fr.addEventListener('dblclick', e => { if (e.target.closest('.ann')) $('stAnnText')?.focus(); });
    fr.addEventListener('contextmenu', e => {
      const box = e.target.closest('.ann');
      if (S.tab === 'annotations' && box) { S.selAnn = box.dataset.ann; paint(); klabMenu(e, annMenu()); }
      else if (S.tab === 'annotations') klabMenu(e, [{ header: 'Add at ' + fine(map().s2e(now(), true)) }].concat(Object.keys(TYPE_WORDS).map(t => ({ label: TYPE_WORDS[t], icon: TYPE_ICON[t], action: () => addAnn(t) }))));
      else if (S.tab === 'edit') klabMenu(e, editMenu());
    });
  }

  // ── Saving ──
  function forServer() {
    const m = map();
    const toE = t => m.s2e(t, true);
    let dropped = { anns: 0, cards: 0 };
    const anns = [];
    for (const a of S.work.anns) {
      const s = toE(a.start), e = toE(a.end);
      if (e - s < 0.2) { dropped.anns++; continue; }
      anns.push({ ...a, start: +s.toFixed(2), end: +e.toFixed(2) });
    }
    const cards = [];
    for (const c of S.work.cards) {
      if (m.cut(c.at)) { dropped.cards++; continue; }
      cards.push({ ...c, at: +toE(c.at).toFixed(2) });
    }
    const edit = isIdentity(S.work.edit) ? null : { ...S.work.edit, keep: normRanges(S.work.edit.keep, S.D), mute: normRanges(S.work.edit.mute, S.D) };
    return { edit, anns, cards, end: S.work.end, dropped, len: m.len };
  }
  function problems(out) {
    for (const c of out.cards) {
      if (c.kind === 'poll' && (!c.poll.question || c.poll.options.filter(Boolean).length < 2)) return 'A poll needs a question and two answers.';
      if (c.kind !== 'poll' && c.kind !== 'channel' && !(c.target && (c.target.id || c.target.url))) return 'A ' + CARD_WORDS[c.kind].toLowerCase() + ' card needs something to point at.';
    }
    if (out.end) {
      if (out.len < out.end.start + 1) return 'The video’s too short for a ' + out.end.start + 's end screen.';
      for (const e of out.end.elements) if (['video', 'playlist', 'tv', 'link'].includes(e.kind) && !(e.target && (e.target.id || e.target.url))) return 'Each end screen element needs something to point at.';
    }
    for (const a of out.anns) if (a.link && ((a.link.kind === 'video' || a.link.kind === 'playlist' || a.link.kind === 'tv') && !a.link.id || a.link.kind === 'url' && !/^https?:\/\//.test(a.link.url || ''))) return 'An annotation’s link isn’t finished.';
    return '';
  }
  async function save(o) {
    const retry = !!S && !dirty() && S.j.render?.state === 'failed';
    if (!S || S.saving || (!dirty() && !retry)) return;
    const st = S; // (the studio this save is for: another may open meanwhile)
    const out = forServer();
    const bad = problems(out);
    if (bad) { showToast(bad, 'ti-alert-triangle'); return; }
    const eDirty = editDirty() || retry;
    if (!(o && o.sure) && (eDirty || out.dropped.anns || out.dropped.cards)) {
      const lose = [out.dropped.anns ? klabCount(out.dropped.anns, 'annotation') : '', out.dropped.cards ? klabCount(out.dropped.cards, 'card') : ''].filter(Boolean);
      const body = (eDirty ? (out.edit ? 'The video is made again from your upload with this edit (' + fine(out.len) + '). The current version plays until it’s done.' : 'The video is made again from your upload as it came. The current version plays until it’s done.') : '') +
        (lose.length ? ' ' + lose.join(' and ') + (lose.length > 1 || out.dropped.anns + out.dropped.cards > 1 ? ' fall' : ' falls') + ' in removed parts and will go.' : '');
      if (!(await showConfirmDialog(eDirty ? 'Save this edit?' : 'Save changes?', body.trim(), 'Save', { danger: false }))) return;
    }
    if (S !== st || st.saving) return;
    // What's being sent: changes made while it's on its way stay unsaved.
    const sent = clone(S.work);
    const outNow = forServer();
    if (JSON.stringify(outNow) !== JSON.stringify(out)) { showToast('Something changed: press Save again', 'ti-alert-triangle'); return; }
    st.saving = true;
    const btn = $('stSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (eDirty) {
        const j = await getJSON(API + '/' + st.id + '/studio/edit', json('PUT', { edit: out.edit }), 20000);
        st.j.render = j.render; st.j.edit = j.edit;
      }
      const tasks = [];
      const sv = st.saved;
      const sm = makeMap(sv.edit, st.D);
      const savedOut = { anns: sv.anns.map(a => ({ ...a, start: +sm.s2e(a.start, true).toFixed(2), end: +sm.s2e(a.end, true).toFixed(2) })), cards: sv.cards.map(c => ({ ...c, at: +sm.s2e(c.at, true).toFixed(2) })) };
      const strip = list => list.map(({ counts, ...x }) => x);
      if (eDirty || JSON.stringify(out.anns) !== JSON.stringify(savedOut.anns)) tasks.push(getJSON(API + '/' + st.id + '/annotations', json('PUT', { annotations: out.anns }), 15000));
      if (eDirty || JSON.stringify(out.cards) !== JSON.stringify(savedOut.cards)) tasks.push(getJSON(API + '/' + st.id + '/cards', json('PUT', { cards: strip(out.cards.map(c => c.poll ? { ...c, poll: { question: c.poll.question, options: c.poll.options.filter(Boolean) } } : c)) }), 15000));
      if (JSON.stringify(out.end) !== JSON.stringify(sv.end)) tasks.push(getJSON(API + '/' + st.id + '/endscreen', json('PUT', { endscreen: out.end }), 15000));
      await Promise.all(tasks);
      if (S !== st) return; // (left the studio meanwhile: it's saved all the same)
      // What was dropped is gone from what's saved (and the working copy, if
      // nothing changed while saving).
      const m = makeMap(sent.edit, st.D);
      const tidy = w => {
        w.anns = w.anns.filter(a => m.s2e(a.end, true) - m.s2e(a.start, true) >= 0.2);
        w.cards = w.cards.filter(c => !m.cut(c.at));
        w.edit.keep = normRanges(w.edit.keep, st.D);
        w.edit.mute = normRanges(w.edit.mute, st.D);
        return w;
      };
      const untouched = JSON.stringify(st.work) === JSON.stringify(sent);
      st.saved = tidy(clone(sent));
      if (untouched) st.work = clone(st.saved);
      SFX && SFX.play('star');
      showToast(eDirty ? 'Saved. Rendering your edit now; it plays as it was until then' : 'Saved', 'ti-check');
      if (eDirty) pollRender();
    } catch (e) {
      showToast('Couldn’t save: ' + klabCap(e.message), 'ti-alert-triangle');
    } finally {
      st.saving = false;
      if (S === st && $('stSave')) { $('stSave').textContent = 'Save'; paint(); }
    }
  }
  async function revert() {
    if (!(await showConfirmDialog('Revert to the original?', 'The edit goes and the video is made again from your upload as it came. Annotations and cards keep their places in the upload.', 'Revert', { danger: false }))) return;
    change(w => { w.edit = { keep: [[0, S.D]], mute: [], muteAll: false, gain: 0, crop: null, rotate: 0 }; });
    S.splits = []; S.sel = null;
    save({ sure: true });
  }
  // The render, until it's done (only while the studio's showing).
  function pollRender() {
    if (!S) return; // (left while a poll was in flight)
    clearTimeout(S.pollT);
    const id = S.id;
    S.pollT = setTimeout(async () => {
      if (!S || S.id !== id) return;
      let j;
      try { j = await getJSON(API + '/' + id + '/studio', null, 10000); } catch { pollRender(); return; }
      if (!S || S.id !== id) return;
      const was = S.j.render?.state;
      S.j.render = j.render;
      paintStatus();
      if (j.render.state === 'queued' || j.render.state === 'rendering') { pollRender(); return; }
      if (j.render.state === 'failed') { showToast('The edit didn’t render: ' + (j.render.error || 'unknown error'), 'ti-alert-triangle'); return; }
      if (was) {
        // Done: the upload's preview may have moved (its own folder now).
        const t = now();
        const srcChanged = j.source.hls !== S.j.source.hls;
        S.j = { ...j, refs: S.refs };
        S.j.live = j.live;
        if (srcChanged) {
          if (S.hls) { try { S.hls.destroy(); } catch {} S.hls = null; }
          const old = S.video;
          const v = document.createElement('video');
          v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'use-credentials';
          old.replaceWith(v);
          // mountPreview makes its own observer: the old one goes.
          S.ro?.disconnect();
          try { old.removeAttribute('src'); old.load(); } catch {}
          S.gainNode = null; try { S.actx?.close(); } catch {} S.actx = null;
          mountPreview(t);
        }
        window.klabVideoCached?.(id, null);
        showToast('Your edit is live', 'ti-check', 5000, null, null, { action: { label: 'Watch', run: () => window.klabOpenVideo?.(id) } });
        paint();
      }
    }, 2000);
  }

  // ── Presses and keys ──
  page.addEventListener('click', e => {
    if (!S || !S.root?.contains(e.target)) return;
    const tab = e.target.closest('[data-st-tab]');
    if (tab) { setTab(tab.dataset.stTab); return; }
    const b = e.target.closest('[data-st]');
    if (!b) return;
    const k = b.dataset.st;
    if (k === 'back') goBack();
    else if (k === 'save') save({});
    else if (k === 'undo') undo();
    else if (k === 'redo') redo();
    else if (k === 'play') togglePlay();
    else if (k === 'frame-') { S.video.pause(); seek(now() - 1 / fps()); }
    else if (k === 'frame+') { S.video.pause(); seek(now() + 1 / fps()); }
    else if (k === 'zoom-') zoomBy(1 / 1.5);
    else if (k === 'zoom+') zoomBy(1.5);
    else if (k === 'watch') { const id = S.id; window.klabOpenVideo?.(id); }
  });
  function setTab(k) {
    if (!S || S.tab === k) return;
    S.tab = k;
    S.tool = null;
    if (k === 'end') { if (S.work.end) seekEnd(); }
    SFX && SFX.play('click');
    record({ id: S.id, view: k });
    paint();
  }
  async function goBack() {
    if (dirty() && !(await showConfirmDialog('Leave without saving?', 'Your changes in the studio go.', 'Leave'))) return;
    const id = S?.id;
    if (!window.klabNav?.back()) window.klabOpenVideo?.(id);
  }
  window.addEventListener('keydown', e => {
    if (!S || !S.root?.isConnected || !document.body.classList.contains('tab-videos-active')) return;
    if (window.klabLayers?.modal?.() || document.querySelector('.chat-modal-backdrop.open')) return;
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' && !/range|checkbox|color/.test(el.type) || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); save(); return; }
    if (typing) { if (k === 'Escape') { el.blur(); e.preventDefault(); } return; }
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (k === ' ' && el && el !== document.body && el.matches?.('button, [role="tab"]') && !S.root.querySelector('.st-screen')?.contains(el)) return;
    let done = true;
    const selAnn = S.tab === 'annotations' && S.work.anns.find(x => x.id === S.selAnn);
    if (k === ' ' || k === 'k' || k === 'K') togglePlay();
    else if (k === ',' ) { S.video.pause(); seek(now() - 1 / fps()); }
    else if (k === '.') { S.video.pause(); seek(now() + 1 / fps()); }
    else if (k === 'j' || k === 'J') seek(now() - 5);
    else if (k === 'l' || k === 'L') seek(now() + 5);
    else if (k === 'Home') seek(map().keeps[0][0]);
    else if (k === 'End') seek(map().keeps[map().keeps.length - 1][1] - 0.05);
    else if (k === '-' || k === '_') zoomBy(1 / 1.5);
    else if (k === '=' || k === '+') zoomBy(1.5);
    else if (selAnn && k.startsWith('Arrow')) {
      const s = e.shiftKey ? 5 : 0.5;
      if (!e.repeat) { S.hist.push(clone(S.work)); S.fut = []; }
      if (k === 'ArrowLeft') selAnn.x = clamp(selAnn.x - s, 0, 100 - selAnn.w);
      if (k === 'ArrowRight') selAnn.x = clamp(selAnn.x + s, 0, 100 - selAnn.w);
      if (k === 'ArrowUp') selAnn.y = clamp(selAnn.y - s, 0, 100 - selAnn.h);
      if (k === 'ArrowDown') selAnn.y = clamp(selAnn.y + s, 0, 100 - selAnn.h);
      paintScreen(); paintStatus();
    }
    else if (k === 'ArrowLeft') seek(now() - (e.shiftKey ? 1 : 1 / fps()));
    else if (k === 'ArrowRight') seek(now() + (e.shiftKey ? 1 : 1 / fps()));
    else if ((k === 'Delete' || k === 'Backspace') && selAnn) delAnn();
    else if ((k === 'Delete' || k === 'Backspace') && S.tab === 'cards' && S.selCard) delCard();
    else if ((k === 'Delete' || k === 'Backspace') && S.tab === 'end' && S.selEs) change(w => { w.end.elements = w.end.elements.filter(x => x.id !== S.selEs); if (!w.end.elements.length) w.end = null; S.selEs = null; });
    else if ((k === 'Delete' || k === 'Backspace') && S.tab === 'edit') { if (S.sel?.kind === 'mute') muteSel(); else cutOut(); }
    else if ((k === 's' || k === 'S') && S.tab === 'edit') split();
    else if ((k === 'm' || k === 'M') && S.tab === 'edit') muteSel();
    else if ((k === 'i' || k === 'I') && S.tab === 'edit') setIn('in');
    else if ((k === 'o' || k === 'O') && S.tab === 'edit') setIn('out');
    else if (k === '[' && selAnn) annTime('start', now());
    else if (k === ']' && selAnn) annTime('end', now());
    else if (k === '[' && S.tab === 'edit') trimAt('l');
    else if (k === ']' && S.tab === 'edit') trimAt('r');
    else if (k === 'Escape' && (S.sel || S.selAnn || S.selCard || S.selEs || S.tool)) { S.sel = null; S.selAnn = null; S.selCard = null; S.selEs = null; S.tool = null; paint(); }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  addEventListener('beforeunload', e => { if (S && dirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ── Coming and going: links, Back and Forward ──
  const prevChanged = window.klabVideosTabChanged;
  window.klabVideosTabChanged = on => {
    const link = on ? window.klabStudioLink : null;
    if (link) window.klabStudioLink = null;
    prevChanged?.(on);
    if (!on && S?.video && !S.video.paused) S.video.pause();
    if (link) openStudio(link.id, { tab: link.tab });
  };
  const prevRestore = window.klabVideosRestore;
  window.klabVideosRestore = d => {
    if (d.kind !== 'studio') { prevRestore?.(d); return; }
    if (!page.firstElementChild) prevRestore?.({ kind: 'list', view: { kind: 'home' } });
    if (S && S.id === d.id) { restoring = true; try { setTab(d.view || 'edit'); } finally { restoring = false; } return; }
    restoring = true;
    try { openStudio(d.id, { quiet: true, tab: d.view || 'edit' }); } finally { setTimeout(() => { restoring = false; }, 0); }
  };
  // A link straight to a studio (#videos/<id>/studio), on a page that opened on Videos.
  if (document.body.classList.contains('tab-videos-active') && window.klabStudioLink) {
    const l = window.klabStudioLink; window.klabStudioLink = null;
    openStudio(l.id, { tab: l.tab });
  }
})();
