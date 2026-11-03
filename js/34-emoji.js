// ══════════════════════════════════════════
//  EMOJI: one picker, and klab's own emoji
//  Every emoji button opens this (Chat's and the Feed's composers, "More
//  reactions" in both, through klabReactMenu in js/00-util.js), next to
//  the button that asked. Laid out like Discord's: a search box, the
//  sections down a rail (recent, klab's own, then Unicode's groups), a
//  grid with the section names stuck to the top, and the one under the
//  pointer named at the foot.
//
//  Custom emoji are pictures with a name, written :name: (klabnet-api
//  /api/posts/emoji, routers/emoji.py). Anyone adds one; whoever added
//  it, or an admin, deletes it. klabEmojify(root) turns :name: in shown
//  text into the picture (Chat's messages, the Feed's markdown), and
//  klabEmojiKey(key) does a reaction's. The list is kept in localStorage
//  (klabnet_emoji) so they show at once, and refreshed at start and
//  whenever the picker opens.
//
//  Unicode's emoji, names and search words are js/vendor/emoji.json
//  (unicode-emoji-json + emojilib, both MIT; up to Emoji 15.0, which
//  every current system draws), fetched the first time a picker opens.
// ══════════════════════════════════════════
(function () {
  const DATA_URL = 'js/vendor/emoji.json?v=0.8.0';
  const API = '/api/posts/emoji';
  const CACHE = 'klabnet_emoji', RECENT = 'klabnet_emoji_recent';
  const NAME_RE = /^[a-z0-9_]{2,30}$/;
  const TOKEN_RE = /:([a-z0-9_]{2,30}):/g;
  const RECENT_MAX = 27;
  // The rail's marks for Unicode's groups (drawn grey until pointed at).
  const GROUP_MARK = ['😀', '🧑', '🐻', '🍔', '✈️', '⚽', '💡', '❤️', '🏁'];

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ── Custom emoji ──
  let custom = new Map(read(CACHE, []).map(e => [e.name, e]));
  let server = null; // the API's limits once it's answered; false without the route
  let refreshing = null;
  function refresh() {
    return refreshing ||= (async () => {
      try {
        const r = await fetchTimeout(API, {}, 8000);
        if (r.status === 404 || r.status === 405) { server = false; return; }
        if (!r.ok) return;
        const j = await r.json();
        server = j.limits || {};
        const was = JSON.stringify([...custom.values()]);
        custom = new Map((j.emoji || []).map(e => [e.name, e]));
        write(CACHE, j.emoji || []);
        if (JSON.stringify(j.emoji || []) !== was) changed();
      } catch {} finally { refreshing = null; }
    })();
  }
  // Someone else's new emoji: a :name: we don't know asks the list again
  // (at most every 15s), and changed() then draws it everywhere on screen,
  // so nobody has to reload to see it. Coming back to the tab asks too.
  let missAt = 0, missLater = 0;
  function miss() {
    if (server === false || missLater) return;
    const wait = missAt + 15000 - Date.now();
    // Inside the 15s, it's asked once at the end of it rather than dropped.
    if (wait > 0) { missLater = setTimeout(() => { missLater = 0; missAt = Date.now(); refresh(); }, wait); return; }
    missAt = Date.now();
    refresh();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - missAt > 60000) { missAt = Date.now(); refresh(); } });
  // New ones show in what's already on screen; the picker redraws.
  function changed() {
    document.querySelectorAll('.chat-msg-text, .feed-post-text, .feed-post-reply-text').forEach(emojify);
    document.querySelectorAll('.feed-post-reaction-pill, .chat-msg-reaction-pill').forEach(p => {
      const key = p.dataset.emoji, c = p.firstChild;
      if (custom.has(key.slice(1, -1)) && c?.nodeType === 3 && c.nodeValue.trim() === key) {
        c.replaceWith(img(custom.get(key.slice(1, -1))), ' ');
      }
    });
    if (panel) { built = ''; if (isOpen()) render(); }
  }

  function img(e) {
    const el = document.createElement('img');
    el.className = 'cemoji';
    el.src = e.url;
    el.alt = el.title = ':' + e.name + ':';
    el.draggable = false;
    el.decoding = 'async';
    return el;
  }
  const imgHTML = e => '<img class="cemoji" src="' + esc(e.url) + '" alt=":' + esc(e.name) + ':" title=":' + esc(e.name) + ':" draggable="false" decoding="async">';

  // :name: in the text under root as the picture, except in code and
  // links. A message that's nothing but emoji shows them big (Discord's
  // jumbo emoji), Chat only.
  function emojify(root) {
    if (!root) return root;
    if (custom.size || root.textContent?.includes(':')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => n.parentElement.closest('code, pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      const hits = [];
      for (let n; (n = walker.nextNode());) if (n.nodeValue.includes(':')) hits.push(n);
      for (const n of hits) {
        const t = n.nodeValue;
        let frag = null, last = 0, m;
        TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(t))) {
          const e = custom.get(m[1]);
          // ":not:one:" — try again from the second colon.
          if (!e) { miss(); TOKEN_RE.lastIndex = m.index + m[0].length - 1; continue; }
          frag ||= document.createDocumentFragment();
          frag.append(t.slice(last, m.index), img(e));
          last = m.index + m[0].length;
        }
        if (frag) { frag.append(t.slice(last)); n.replaceWith(frag); }
      }
    }
    if (root.classList?.contains('chat-msg-text')) {
      const text = root.textContent.replace(/[\s‍️]/g, '');
      const pics = root.querySelectorAll('img.cemoji').length;
      const uni = text ? (/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u{E0020}-\u{E007F}⃣#*0-9])+$/u.test(text) ? [...text.matchAll(/\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/gu)].length : -1) : 0;
      root.classList.toggle('emoji-only', uni >= 0 && pics + uni > 0 && pics + uni <= 27);
    }
    return root;
  }
  // A reaction's key as markup: a custom one's picture, else the text.
  function emojiKey(key) {
    const m = /^:([a-z0-9_]{2,30}):$/.exec(key || '');
    const e = m && custom.get(m[1]);
    if (m && !e) miss();
    return e ? imgHTML(e) : esc(key);
  }

  // ── Unicode's emoji ──
  let groups = null, dataP = null;
  function loadData() {
    return dataP ||= fetch(DATA_URL).then(r => r.json()).then(d => {
      groups = d.groups.map(([name, items], i) => ({
        id: 'g' + i, name, mark: GROUP_MARK[i] || items[0]?.[0],
        items: items.map(([e, slug, kw]) => ({ e, name: slug, kw: slug.replace(/_/g, ' ') + ' ' + kw })),
      }));
    }).catch(() => { dataP = null; });
  }

  // ── The picker ──
  let panel, railEl, scrollEl, searchEl, footEl, built = '';
  let onPick = null, anchorEl = null, sel = -1, shown = [];
  const isOpen = () => panel?.classList.contains('open');

  function build() {
    panel = document.createElement('div');
    panel.className = 'emo-picker';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Emoji');
    panel.innerHTML =
      '<div class="emo-top"><label class="emo-search"><i class="ti ti-search"></i>' +
        '<input type="text" placeholder="Search emoji" spellcheck="false" autocomplete="off" aria-label="Search emoji"></label>' +
        '<button type="button" class="emo-add" title="Add an emoji"><i class="ti ti-mood-plus"></i></button></div>' +
      '<div class="emo-body"><nav class="emo-rail" aria-label="Sections"></nav><div class="emo-scroll"></div></div>' +
      '<div class="emo-foot"><span class="emo-big"></span><span class="emo-what"><b></b><small></small></span>' +
        '<button type="button" class="emo-del" title="Delete this emoji" hidden><i class="ti ti-trash"></i></button></div>';
    document.body.appendChild(panel);
    railEl = panel.querySelector('.emo-rail');
    scrollEl = panel.querySelector('.emo-scroll');
    searchEl = panel.querySelector('.emo-search input');
    footEl = panel.querySelector('.emo-foot');

    searchEl.addEventListener('input', () => { render(); scrollEl.scrollTop = 0; });
    searchEl.addEventListener('keydown', keys);
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } });
    scrollEl.addEventListener('click', e => {
      if (e.target.closest('.emo-empty-add')) { addDialog(); return; }
      const b = e.target.closest('.emo-cell');
      if (b) pick(b, e.shiftKey);
    });
    scrollEl.addEventListener('pointerover', e => {
      const b = e.target.closest('.emo-cell');
      if (b) select(shown.indexOf(b), false);
    });
    railEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      const sec = b && scrollEl.querySelector('[data-sec="' + b.dataset.sec + '"]');
      if (sec) scrollEl.scrollTo({ top: sec.offsetTop, behavior: window.klabMotionOk?.() ? 'smooth' : 'auto' });
    });
    scrollEl.addEventListener('scroll', railLight, { passive: true });
    panel.querySelector('.emo-add').addEventListener('click', addDialog);
    footEl.querySelector('.emo-del').addEventListener('click', delCurrent);
    document.addEventListener('pointerdown', e => {
      if (isOpen() && !panel.contains(e.target) && !anchorEl?.contains(e.target)) close();
    }, true);
    addEventListener('resize', () => { if (isOpen()) close(); });
  }

  const cell = (it, sec) => it.custom
    ? '<button type="button" class="emo-cell" data-sec="' + sec + '" data-c="' + esc(it.name) + '" aria-label=":' + esc(it.name) + ':">' + imgHTML(it) + '</button>'
    : '<button type="button" class="emo-cell" data-sec="' + sec + '" data-e="' + it.e + '" data-n="' + esc(it.name) + '" aria-label="' + esc(it.name.replace(/_/g, ' ')) + '">' + it.e + '</button>';
  const secHTML = (id, label, inner, extra = '') =>
    '<section class="emo-sec" data-sec="' + id + '"><h4>' + esc(label) + extra + '</h4><div class="emo-grid">' + inner + '</div></section>';

  function customItems() { return [...custom.values()].map(e => ({ ...e, custom: true })); }
  function unicodeFor(ch) {
    for (const g of groups || []) { const it = g.items.find(x => x.e === ch); if (it) return it; }
    return { e: ch, name: '' };
  }

  function render() {
    const q = searchEl.value.trim().toLowerCase().replace(/^:|:$/g, '');
    const recent = read(RECENT, []);
    const key = q + '|' + recent.join() + '|' + custom.size + '|' + !!groups;
    if (key === built) return;
    built = key;
    let html = '';
    const rail = [];
    if (q) {
      const words = q.split(/[\s_]+/).filter(Boolean);
      const hit = s => words.every(w => s.includes(w));
      const found = customItems().filter(e => hit(e.name.replace(/_/g, ' ') + ' ' + e.name));
      for (const g of groups || []) for (const it of g.items) if (hit(it.kw)) { found.push(it); if (found.length >= 240) break; }
      html = found.length ? secHTML('found', 'Results', found.map(it => cell(it, 'found')).join(''))
        : '<p class="emo-none">No emoji match "' + esc(q) + '"</p>';
    } else {
      if (recent.length) {
        rail.push(['recent', '<i class="ti ti-history"></i>', 'Recent']);
        html += secHTML('recent', 'Recent', recent.map(k => {
          const m = /^:([a-z0-9_]+):$/.exec(k);
          if (m) { const e = custom.get(m[1]); return e ? cell({ ...e, custom: true }, 'recent') : ''; }
          return cell(unicodeFor(k), 'recent');
        }).join(''));
      }
      rail.push(['klab', '<i class="ti ti-sparkles"></i>', 'klab']);
      const mine = customItems();
      html += secHTML('klab', 'klab', mine.length ? mine.map(it => cell(it, 'klab')).join('') : '',
        '<span class="emo-count">' + (mine.length || '') + '</span>');
      if (!mine.length) html = html.replace(/<div class="emo-grid"><\/div><\/section>$/, server === false
        ? '<p class="emo-none emo-left">Custom emoji need the latest klabnet-api</p></section>'
        : '<button type="button" class="emo-empty-add"><i class="ti ti-mood-plus"></i>Add klab\'s first emoji</button></section>');
      if (groups) for (const g of groups) {
        rail.push([g.id, '<span class="emo-mark">' + g.mark + '</span>', g.name]);
        html += secHTML(g.id, g.name, g.items.map(it => cell(it, g.id)).join(''));
      } else html += '<p class="emo-none">Loading…</p>';
    }
    scrollEl.innerHTML = html;
    railEl.innerHTML = rail.map(([id, icon, label]) => '<button type="button" data-sec="' + id + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + icon + '</button>').join('');
    railEl.hidden = !!q;
    shown = [...scrollEl.querySelectorAll('.emo-cell')];
    select(q && shown.length ? 0 : -1, false);
    railLight();
  }

  // The rail lights the section at the top of the grid (the grid is the
  // sections' offsetParent).
  function railLight() {
    const top = scrollEl.scrollTop + 8;
    let cur = null;
    for (const s of scrollEl.querySelectorAll('.emo-sec')) { if (s.offsetTop <= top) cur = s.dataset.sec; else break; }
    railEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sec === (cur || railEl.firstChild?.dataset.sec)));
  }

  function select(i, reveal) {
    shown[sel]?.classList.remove('sel');
    sel = i;
    const b = shown[sel];
    const big = footEl.querySelector('.emo-big'), name = footEl.querySelector('b'), by = footEl.querySelector('small');
    const del = footEl.querySelector('.emo-del');
    del.hidden = true;
    if (!b) { big.textContent = ''; name.textContent = ''; by.textContent = custom.size || groups ? 'Pick one, or shift-click for several' : ''; return; }
    b.classList.add('sel');
    if (reveal) b.scrollIntoView({ block: 'nearest' });
    if (b.dataset.c) {
      const e = custom.get(b.dataset.c);
      big.innerHTML = e ? imgHTML(e) : '';
      name.textContent = ':' + b.dataset.c + ':';
      by.textContent = e ? 'Added by ' + e.by : '';
      del.hidden = !e?.can_delete;
    } else {
      big.textContent = b.dataset.e;
      name.textContent = ':' + b.dataset.n + ':';
      by.textContent = '';
    }
  }

  // The grid's columns, for ↑/↓.
  function cols() {
    const g = shown[sel]?.parentElement || scrollEl.querySelector('.emo-grid');
    return g ? Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').length) : 9;
  }
  function keys(e) {
    const n = shown.length;
    if (!n) return;
    let i = sel;
    if (e.key === 'ArrowRight') i = sel < 0 ? 0 : Math.min(n - 1, sel + 1);
    else if (e.key === 'ArrowLeft') i = Math.max(0, sel - 1);
    else if (e.key === 'ArrowDown') i = sel < 0 ? 0 : Math.min(n - 1, sel + cols());
    else if (e.key === 'ArrowUp') i = Math.max(0, sel - cols());
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) pick(shown[sel], e.shiftKey); return; }
    else return;
    e.preventDefault();
    select(i, true);
  }

  function pick(b, keep) {
    const text = b.dataset.c ? ':' + b.dataset.c + ':' : b.dataset.e;
    const recent = read(RECENT, []).filter(k => k !== text);
    recent.unshift(text);
    write(RECENT, recent.slice(0, RECENT_MAX));
    const cb = onPick;
    if (!keep) close(true);
    cb?.(text);
  }

  // Next to the button that asked: under it, or over it when there's more
  // room above (a composer at the window's foot); its right edge on the
  // button's when the button is on the right half.
  function place() {
    const z = zoomFactor();
    const r = anchorEl.getBoundingClientRect();
    const vw = innerWidth / z, vh = innerHeight / z;
    const a = { l: r.left / z, r: r.right / z, t: r.top / z, b: r.bottom / z };
    const w = panel.offsetWidth, h = panel.offsetHeight;
    let left = (a.l + a.r) / 2 > vw / 2 ? a.r - w : a.l;
    left = Math.max(8, Math.min(vw - w - 8, left));
    const below = vh - a.b, above = a.t;
    let top = below >= h + 12 || below >= above ? a.b + 6 : a.t - h - 6;
    top = Math.max(8, Math.min(vh - h - 8, top));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.transformOrigin = (left + w / 2 < (a.l + a.r) / 2 ? 'right' : 'left') + ' ' + (top < a.t ? 'bottom' : 'top');
  }

  let returnFocus = null;
  function open(anchor, cb) {
    if (!panel) build();
    if (isOpen() && anchorEl === anchor) { close(true); return; }
    anchorEl = anchor;
    onPick = cb;
    returnFocus = document.activeElement;
    searchEl.value = '';
    built = '';
    render();
    panel.classList.add('open');
    scrollEl.scrollTop = 0;
    place();
    anchor.setAttribute?.('aria-expanded', 'true');
    if (matchMedia('(pointer: fine)').matches) searchEl.focus({ preventScroll: true });
    if (!groups) loadData().then(() => { if (isOpen()) { built = ''; render(); place(); } });
    refresh();
  }
  function close(refocus) {
    if (!panel || !isOpen()) return;
    panel.classList.remove('open');
    anchorEl?.setAttribute?.('aria-expanded', 'false');
    if (refocus && returnFocus?.isConnected && panel.contains(document.activeElement)) returnFocus.focus({ preventScroll: true });
    onPick = null;
  }

  // ── Adding and deleting ──
  function addDialog() {
    if (server === false) { showToast('Custom emoji need the latest klabnet-api', 'ti-mood-plus'); return; }
    const back = isOpen() && anchorEl?.isConnected ? [anchorEl, onPick] : null;
    close();
    openChatModal('Add an emoji', `
      <div class="emo-form">
        <button type="button" class="emo-drop" id="emoDrop"><i class="ti ti-upload"></i><img alt="" hidden><span>Choose a picture</span></button>
        <input type="file" id="emoFile" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
        <div class="emo-form-side">
          <label class="emo-label" for="emoName">Name</label>
          <div class="emo-name"><span>:</span><input class="chat-modal-input" id="emoName" maxlength="30" placeholder="name" spellcheck="false" autocomplete="off"><span>:</span></div>
          <p class="emo-hint">Letters, numbers and _. A picture is shrunk to 128px; an animated GIF or WebP can be up to 512KB.</p>
        </div>
      </div>
      <p class="emo-err" id="emoErr" hidden></p>
      <div class="dlg-actions">
        <button class="ap-btn-queue" id="emoCancel">Cancel</button>
        <button class="chat-connect-btn" id="emoSave" disabled>Add</button>
      </div>`, null);
    const $ = id => document.getElementById(id);
    let file = null, previewUrl = null;
    const ok = () => { $('emoSave').disabled = !(file && NAME_RE.test($('emoName').value)); };
    const err = msg => { $('emoErr').hidden = !msg; $('emoErr').textContent = msg || ''; };
    $('emoDrop').addEventListener('click', () => $('emoFile').click());
    $('emoFile').addEventListener('change', () => {
      file = $('emoFile').files[0] || null;
      if (!file) return ok();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      const im = $('emoDrop').querySelector('img');
      im.src = previewUrl; im.hidden = false;
      $('emoDrop').classList.add('has');
      if (!$('emoName').value) {
        $('emoName').value = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_').slice(0, 30);
      }
      err(''); ok();
      $('emoName').focus();
    });
    $('emoName').addEventListener('input', () => {
      const v = $('emoName').value, clean = v.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (clean !== v) $('emoName').value = clean;
      err(clean && custom.has(clean) ? ':' + clean + ': is taken' : ''); ok();
    });
    $('emoName').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('emoSave').disabled) $('emoSave').click(); });
    $('emoCancel').addEventListener('click', () => closeChatModal());
    $('emoSave').addEventListener('click', async () => {
      const name = $('emoName').value;
      $('emoSave').disabled = true;
      $('emoSave').textContent = 'Adding…';
      try {
        const form = new FormData();
        form.append('name', name);
        form.append('file', file);
        const r = await fetchTimeout(API, { method: 'POST', body: form }, 60000);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Couldn\'t add it (' + r.status + ')');
        custom.set(j.name, j);
        write(CACHE, [...custom.values()]);
        changed();
        closeChatModal();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        showToast(':' + j.name + ': added', 'ti-mood-plus');
        if (back && back[0].isConnected) { open(back[0], back[1]); scrollEl.querySelector('[data-sec="klab"]')?.scrollIntoView({ block: 'start' }); }
      } catch (e) {
        err(klabCap(e.message));
        $('emoSave').textContent = 'Add';
        ok();
      }
    });
  }

  async function delCurrent() {
    const name = shown[sel]?.dataset.c;
    if (!name) return;
    const back = [anchorEl, onPick];
    close();
    if (!await showConfirmDialog('Delete :' + name + ':?', 'It goes for everyone. Messages and reactions that used it show its name instead.', 'Delete')) {
      if (back[0]?.isConnected) open(back[0], back[1]);
      return;
    }
    try {
      const r = await fetchTimeout(API + '/' + encodeURIComponent(name), { method: 'DELETE' }, 10000);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      custom.delete(name);
      write(CACHE, [...custom.values()]);
      write(RECENT, read(RECENT, []).filter(k => k !== ':' + name + ':'));
      built = '';
      showToast(':' + name + ': deleted', 'ti-trash');
    } catch (e) { showToast('Couldn\'t delete it: ' + e.message, 'ti-trash-x'); }
  }

  // ── The composers ──
  // Into a text field where its cursor is, as if typed.
  function insertInto(field, text) {
    const s = field.selectionStart ?? field.value.length, e = field.selectionEnd ?? s;
    const before = field.value.slice(0, s);
    const pad = text.startsWith(':') && before && !/\s$/.test(before) ? ' ' : '';
    field.setRangeText(pad + text + (text.startsWith(':') ? ' ' : ''), s, e, 'end');
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const feedBtn = document.getElementById('feedEmojiBtn'), feedText = document.getElementById('feedComposerText');
  feedBtn?.addEventListener('click', e => { e.stopPropagation(); open(feedBtn, t => insertInto(feedText, t)); });

  // ── :name as you type (Discord's) ──
  // Two letters after a colon list what matches over the field: ↑/↓ to
  // choose, Enter or Tab to put it in, Esc to leave it.
  let sug, sugField = null, sugItems = [], sugSel = 0, sugAt = 0;
  function suggestions(q) {
    const out = [];
    for (const e of custom.values()) if (e.name.includes(q)) out.push({ ...e, custom: true });
    out.sort((a, b) => a.name.indexOf(q) - b.name.indexOf(q) || a.name.length - b.name.length);
    const starts = [], has = [];
    for (const g of groups || []) for (const it of g.items) {
      if (it.name.startsWith(q)) starts.push(it);
      else if (it.kw.includes(q)) has.push(it);
    }
    // The nearest names first: "fi" is fire before firefighter.
    starts.sort((a, b) => a.name.length - b.name.length);
    return out.concat(starts, has).slice(0, 8);
  }
  function hideSug() { if (sug) sug.hidden = true; sugField = null; }
  function showSug(field) {
    const upto = field.value.slice(0, field.selectionStart);
    const m = field.selectionStart === field.selectionEnd && /(?:^|[\s(])(:([a-z0-9_+-]{2,30}))$/i.exec(upto);
    if (!m) return hideSug();
    if (m[2].length === 2) miss(); // starting a :name: — have the newest list
    if (!groups) { loadData().then(() => { if (document.activeElement === field) showSug(field); }); }
    sugItems = suggestions(m[2].toLowerCase());
    if (!sugItems.length) return hideSug();
    sugAt = upto.length - m[1].length;
    sugField = field;
    sugSel = 0;
    if (!sug) {
      sug = document.createElement('div');
      sug.className = 'emo-suggest';
      sug.setAttribute('role', 'listbox');
      document.body.appendChild(sug);
      sug.addEventListener('pointerdown', e => {
        const b = e.target.closest('[data-i]');
        if (b) { e.preventDefault(); sugPick(+b.dataset.i); }
      });
    }
    sug.innerHTML = '<div class="emo-suggest-h">Emoji matching <b>' + esc(m[1]) + '</b></div>' + sugItems.map((it, i) =>
      '<div class="emo-suggest-row' + (i ? '' : ' sel') + '" data-i="' + i + '" role="option"><span class="emo-suggest-e">' + (it.custom ? imgHTML(it) : it.e) + '</span>:' + esc(it.name) + ':</div>').join('');
    sug.hidden = false;
    const z = zoomFactor(), r = field.getBoundingClientRect();
    sug.style.left = r.left / z + 'px';
    sug.style.width = Math.min(360, r.width / z) + 'px';
    // Over the field, or under it when that would run off the top.
    const h = sug.offsetHeight, up = r.top / z - h - 6;
    sug.style.top = (up >= 8 ? up : Math.min(innerHeight / z - h - 8, r.bottom / z + 6)) + 'px';
  }
  function sugPick(i) {
    const it = sugItems[i], field = sugField;
    if (!it || !field) return;
    const text = it.custom ? ':' + it.name + ': ' : it.e;
    field.setRangeText(text, sugAt, field.selectionStart, 'end');
    const recent = read(RECENT, []).filter(k => k !== text.trim());
    recent.unshift(text.trim());
    write(RECENT, recent.slice(0, RECENT_MAX));
    hideSug();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function watch(field) {
    if (!field) return;
    field.addEventListener('input', () => showSug(field));
    field.addEventListener('blur', () => setTimeout(() => { if (sugField === field) hideSug(); }, 100));
    // Ahead of the field's own Enter (send/post): capture, on the field.
    field.addEventListener('keydown', e => {
      if (sugField !== field || sug?.hidden) return;
      const n = sugItems.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') sugSel = (sugSel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); sugPick(sugSel); return; }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); hideSug(); return; }
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      sug.querySelectorAll('[data-i]').forEach((r, i) => r.classList.toggle('sel', i === sugSel));
    }, true);
  }
  watch(feedText);
  watch(document.getElementById('chatComposerInput'));

  window.klabEmojiPicker = open;
  window.klabEmojiInsert = insertInto;
  window.klabEmojify = emojify;
  window.klabEmojiKey = emojiKey;
  window.klabEmojiClose = close;
  refresh();
})();
