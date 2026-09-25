// ══════════════════════════════════════════
//  GIF PICKER — klabnet's own GIF stash, for chat, feed posts and replies.
//
//  No GIF service: people add GIFs by pasting a link (a giphy.com or
//  tenor.com page, or any .gif) or uploading one, and the server keeps its
//  own copy. Search is by name, most-used first, so the stash turns into
//  the group's reaction library. Adding one from the picker sends it too.
//  klabGifPicker.open(anchor, pick) floats the panel by whatever opened
//  it; pick({ url, title, w, h }) gets the GIF to post.
// ══════════════════════════════════════════
window.klabGifPicker = (function() {
  let panel, input, grid, status, sentinel, io, addForm, linkEl, nameEl, fileEl, addBtn, addMsg;
  let anchorEl = null, onPick = null, q = '', next = 0, loading = false, reqId = 0, typeTimer = 0, colH = [0, 0];
  const looksLikeLink = s => /^https?:\/\/\S+$/i.test(s.trim());

  function build() {
    panel = document.createElement('div');
    panel.className = 'gif-picker';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'GIFs');
    panel.innerHTML =
      '<div class="gif-top">' +
        '<div class="gif-search"><i class="ti ti-search"></i><input type="text" placeholder="Search the stash, or paste a GIF link" aria-label="Search GIFs" /></div>' +
        '<button type="button" class="gif-add-toggle" title="Add a GIF"><i class="ti ti-plus"></i></button>' +
      '</div>' +
      '<form class="gif-add" hidden>' +
        '<input type="url" class="gif-add-link" placeholder="giphy.com or tenor.com link, or any .gif" />' +
        '<input type="text" class="gif-add-name" placeholder="Name it (what people search for)" maxlength="80" />' +
        '<div class="gif-add-row">' +
          '<label class="gif-add-file"><input type="file" accept="image/gif" hidden /><i class="ti ti-download"></i>Upload a .gif</label>' +
          '<button type="submit" class="gif-add-go">Add</button>' +
        '</div>' +
        '<div class="gif-add-msg"></div>' +
      '</form>' +
      '<div class="gif-grid"></div>' +
      '<div class="gif-status"></div>';
    document.body.appendChild(panel);
    input = panel.querySelector('.gif-search input');
    grid = panel.querySelector('.gif-grid');
    status = panel.querySelector('.gif-status');
    addForm = panel.querySelector('.gif-add');
    linkEl = panel.querySelector('.gif-add-link');
    nameEl = panel.querySelector('.gif-add-name');
    fileEl = panel.querySelector('.gif-add-file input');
    addBtn = panel.querySelector('.gif-add-go');
    addMsg = panel.querySelector('.gif-add-msg');
    sentinel = document.createElement('div');
    sentinel.className = 'gif-more';

    input.addEventListener('input', () => {
      clearTimeout(typeTimer);
      // A pasted link is an add, not a search.
      if (looksLikeLink(input.value)) { showAdd(true, input.value.trim()); input.value = ''; return; }
      typeTimer = setTimeout(() => { q = input.value.trim(); load(true); }, 250);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Enter') { e.preventDefault(); grid.querySelector('.gif-item')?.click(); }
    });
    panel.querySelector('.gif-add-toggle').addEventListener('click', () => showAdd(addForm.hidden));
    addForm.addEventListener('submit', e => { e.preventDefault(); addLink(); });
    fileEl.addEventListener('change', () => { if (fileEl.files[0]) addFile(fileEl.files[0]); fileEl.value = ''; });
    // Drop a .gif anywhere on the panel.
    panel.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); panel.classList.add('drop'); } });
    panel.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('drop'); });
    panel.addEventListener('drop', e => {
      panel.classList.remove('drop');
      const f = e.dataTransfer?.files?.[0];
      if (f) { e.preventDefault(); addFile(f); }
    });

    grid.addEventListener('click', async e => {
      const del = e.target.closest('.gif-del');
      if (del) {
        e.stopPropagation();
        const b = del.closest('.gif-item');
        const ok = typeof showConfirmDialog === 'function'
          ? await showConfirmDialog('Remove this GIF?', 'It leaves the stash. Anywhere it was already posted keeps it.', 'Remove')
          : confirm('Remove this GIF from the stash?');
        if (!ok) return;
        const res = await fetch('/api/gifs/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' }).catch(() => null);
        if (res?.ok) b.remove();
        else showToast("Couldn't remove that GIF", 'ti-alert-triangle');
        return;
      }
      const b = e.target.closest('.gif-item');
      if (b) pick({ id: b.dataset.id, url: b.dataset.url, name: b.dataset.name, w: +b.dataset.w, h: +b.dataset.h });
    });
    io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) load(false); }, { root: grid, rootMargin: '200px' });

    document.addEventListener('pointerdown', e => {
      if (panel.hidden || panel.contains(e.target) || anchorEl?.contains(e.target) || e.target.closest?.('.modal-backdrop, .klab-modal, [role="dialog"]')) return;
      close();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden && !document.querySelector('.modal-backdrop.open')) close(); });
    window.addEventListener('resize', () => { if (!panel.hidden) place(); });
  }

  function place() {
    const z = typeof zoomFactor === 'function' ? zoomFactor() : 1;
    const r = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth / z, vh = window.innerHeight / z;
    const w = Math.min(360, vw - 24), h = Math.min(460, vh - 24);
    panel.style.width = w + 'px';
    panel.style.height = h + 'px';
    const ar = { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z };
    // Above the button if it fits, else below. Starts at the button's left
    // edge, or ends at its right edge when that would run off the screen.
    const top = ar.top - h - 8 >= 12 ? ar.top - h - 8 : Math.min(vh - h - 12, ar.bottom + 8);
    const left = ar.left + w <= vw - 12 ? ar.left : ar.right - w;
    panel.style.top = top + 'px';
    panel.style.left = Math.max(12, Math.min(vw - w - 12, left)) + 'px';
  }

  function tile(g) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gif-item';
    b.title = g.name || 'GIF';
    b.dataset.id = g.id; b.dataset.url = g.url; b.dataset.name = g.name || ''; b.dataset.w = g.w; b.dataset.h = g.h;
    b.style.aspectRatio = (g.w || 1) + ' / ' + (g.h || 1);
    const img = document.createElement('img');
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = g.name || ''; img.src = g.url;
    b.appendChild(img);
    if (g.name) { const n = document.createElement('span'); n.className = 'gif-name'; n.textContent = g.name; b.appendChild(n); }
    const me = window.KLAB_USER?.username;
    if (g.by === me || window.KLAB_USER?.is_admin) {
      const x = document.createElement('span');
      x.className = 'gif-del'; x.title = 'Remove from the stash'; x.innerHTML = '<i class="ti ti-x"></i>';
      b.appendChild(x);
    }
    return b;
  }

  async function load(reset) {
    if (reset) {
      next = 0; loading = false;
      // Two real columns, filled shortest-first: CSS columns in a box of
      // fixed height overflow sideways, which hid everything past the fold.
      grid.innerHTML = '<div class="gif-col"></div><div class="gif-col"></div>';
      colH = [0, 0];
      grid.scrollTop = 0;
    }
    if (loading || next === null) return;
    loading = true;
    const my = ++reqId;
    status.textContent = next ? '' : '…';
    try {
      const res = await fetch('/api/gifs?q=' + encodeURIComponent(q) + '&offset=' + next);
      if (my !== reqId) return;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (my !== reqId) return;
      const cols = grid.querySelectorAll('.gif-col');
      (data.items || []).forEach(g => {
        const i = colH[0] <= colH[1] ? 0 : 1;
        cols[i].appendChild(tile(g));
        colH[i] += (g.h || 1) / (g.w || 1) + 0.04;   // + the gap, in widths
      });
      next = data.next ?? null;
      status.textContent = grid.querySelector('.gif-item') ? '' : q
        ? 'nothing called “' + q + '” yet. Paste a link to add it'
        : 'The stash is empty. Paste a GIF link from giphy.com or tenor.com to add the first one';
      if (next !== null) grid.appendChild(sentinel);
    } catch (e) {
      if (my === reqId) status.textContent = "couldn't load the stash";
    } finally {
      if (my === reqId) {
        loading = false;
        // Re-observing reports the sentinel's state afresh: if it's already
        // in reach, the next page loads without waiting for a scroll that
        // may never cross the line again.
        io.unobserve(sentinel);
        if (next !== null && sentinel.isConnected) io.observe(sentinel);
      }
    }
  }

  function showAdd(on, link) {
    addForm.hidden = !on;
    panel.classList.toggle('adding', on);
    addMsg.textContent = '';
    if (on) {
      if (link) linkEl.value = link;
      if (!nameEl.value && q) nameEl.value = q;
      (link ? nameEl : linkEl).focus();
    } else input.focus();
  }

  async function add(req) {
    addBtn.disabled = true;
    addMsg.textContent = 'grabbing it…';
    try {
      const res = await fetch(req.url, req.init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addMsg.textContent = data.error || "couldn't add that one"; return; }
      linkEl.value = ''; nameEl.value = '';
      showAdd(false);
      pick(data);
    } catch (e) {
      addMsg.textContent = "couldn't add that one";
    } finally {
      addBtn.disabled = false;
    }
  }
  function addLink() {
    const url = linkEl.value.trim();
    if (!url) { addMsg.textContent = 'paste a link first'; return; }
    add({ url: '/api/gifs/link', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name: nameEl.value.trim() }) } });
  }
  function addFile(f) {
    if (!/gif$/i.test(f.type) && !/\.gif$/i.test(f.name)) { showAdd(true); addMsg.textContent = 'that isn’t a .gif'; return; }
    if (addForm.hidden) showAdd(true);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('name', nameEl.value.trim());
    add({ url: '/api/gifs/upload', init: { method: 'POST', body: fd } });
  }

  function pick(g) {
    const cb = onPick;
    close();
    if (!g?.url) return;
    fetch('/api/gifs/' + encodeURIComponent(g.id) + '/used', { method: 'POST' }).catch(() => {});
    // Absolute, so a GIF in a post's markdown works wherever it's rendered.
    cb?.({ url: new URL(g.url, location.origin).href, title: g.name || 'gif', w: g.w, h: g.h });
  }

  function open(anchor, cb) {
    if (!panel) build();
    if (!panel.hidden && anchorEl === anchor) { close(); return; }
    anchorEl = anchor; onPick = cb;
    panel.hidden = false;
    showAdd(false);
    place();
    SFX && SFX.play('open');
    // Always fresh: someone may have added a GIF since.
    q = input.value.trim();
    load(true);
    input.focus({ preventScroll: true });
    input.select();
  }
  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    onPick = null;
    anchorEl = null;
  }
  return { open, close, isOpen: () => !!panel && !panel.hidden };
})();

// Drops `![title](url)` into a text field at the cursor, on its own line
// where there's room; used by the feed composer and reply boxes.
function klabInsertGif(field, g, opts) {
  const alt = (opts?.short ? 'gif' : (g.title || 'gif')).replace(/[\[\]]/g, '').slice(0, 60);
  const md = '![' + alt + '](' + g.url + ')';
  const v = field.value, s = field.selectionStart ?? v.length, e = field.selectionEnd ?? v.length;
  const nl = field.tagName === 'TEXTAREA';
  const before = nl && s > 0 && v[s - 1] !== '\n' ? '\n' : (s > 0 && !/\s$/.test(v.slice(0, s)) ? ' ' : '');
  const after = nl && e < v.length && v[e] !== '\n' ? '\n' : '';
  const ins = before + md + after;
  if (field.maxLength > 0 && v.length - (e - s) + ins.length > field.maxLength) {
    showToast("That GIF won't fit: the reply is too long", 'ti-alert-triangle');
    return;
  }
  field.focus();
  field.setRangeText(ins, s, e, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
