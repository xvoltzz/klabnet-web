// ══════════════════════════════════════════
//  STARS ON SONGS AND ALBUMS — any element with data-star="song:<id>" or
//  data-star="album:<id>" is kept up to date: a .klab-star button shows the
//  count and whether you've starred it, anything else turns .gold once
//  KLAB_GOLD_AT people have. Renderers only add the attribute; new ones are
//  picked up by an observer, counts are fetched in batches and clicking a
//  .klab-star toggles it. (Chat, feed and photos star with a ⭐ reaction
//  and paint themselves.)
// ══════════════════════════════════════════
window.klabStars = (function() {
  const KINDS = ['song', 'album'];
  const FRESH_MS = 60000;
  const cache = new Map();                          // 'song:id' -> { count, mine, at }
  const wanted = new Set();
  let timer = 0;

  function paintEl(el, s) {
    const gold = s.count >= KLAB_GOLD_AT;
    if (el.classList.contains('klab-star')) {
      el.classList.toggle('on', s.mine);
      el.classList.toggle('has', s.count > 0);
      el.classList.toggle('gold', gold);
      el.setAttribute('aria-pressed', s.mine);
      el.title = (s.mine ? 'Unstar' : 'Star') + (s.count ? ` · ${s.count} star${s.count === 1 ? '' : 's'}` : '');
      const i = el.querySelector('i'); if (i) i.className = 'ti ' + (s.mine ? 'ti-star-filled' : 'ti-star');
      const n = el.querySelector('.klab-star-n'); if (n) n.textContent = s.count || '';
    } else {
      el.classList.toggle('gold', gold);
    }
  }

  function paint(root = document) {
    const els = root.matches?.('[data-star]') ? [root] : [];
    els.push(...(root.querySelectorAll?.('[data-star]') || []));
    const now = Date.now();
    for (const el of els) {
      const key = el.dataset.star;
      if (!key || !KINDS.includes(key.split(':')[0])) continue;
      const s = cache.get(key);
      if (s) paintEl(el, s);
      if (!s || now - s.at > FRESH_MS) wanted.add(key);
    }
    if (wanted.size && !timer) timer = setTimeout(load, 30);
  }

  async function load() {
    timer = 0;
    const keys = [...wanted]; wanted.clear();
    for (const kind of KINDS) {
      const ids = keys.filter(k => k.startsWith(kind + ':')).map(k => k.slice(kind.length + 1));
      for (let i = 0; i < ids.length; i += 300) {
        const chunk = ids.slice(i, i + 300);
        try {
          const r = await fetchTimeout(`/api/posts/stars?kind=${kind}&ids=${chunk.map(encodeURIComponent).join(',')}`, {}, 8000);
          if (!r.ok) continue;
          const got = (await r.json()).stars || {};
          const at = Date.now();
          for (const id of chunk) cache.set(kind + ':' + id, { count: 0, mine: false, ...got[id], at });
        } catch {}
      }
    }
    repaint(keys);
  }

  function repaint(keys) {
    const set = new Set(keys);
    document.querySelectorAll('[data-star]').forEach(el => {
      const s = set.has(el.dataset.star) && cache.get(el.dataset.star);
      if (s) paintEl(el, s);
    });
  }

  function get(key) { return cache.get(key) || { count: 0, mine: false }; }

  // Shows the change at once, then settles on what the server says.
  async function toggle(key) {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    if (!KINDS.includes(kind) || !id) return;
    const before = get(key);
    cache.set(key, { count: Math.max(0, before.count + (before.mine ? -1 : 1)), mine: !before.mine, at: Date.now() });
    repaint([key]);
    SFX && SFX.play('star');
    try {
      const r = await fetchTimeout('/api/posts/stars', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }),
      }, 8000);
      if (!r.ok) throw new Error();
      cache.set(key, { ...(await r.json()), at: Date.now() });
    } catch {
      cache.set(key, before);
      showToast('couldn’t star that — try again', 'ti-alert-triangle');
    }
    repaint([key]);
  }

  // Capture phase, so a star inside a row never also plays the song.
  document.addEventListener('click', e => {
    const b = e.target.closest('.klab-star[data-star]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    toggle(b.dataset.star);
  }, true);

  // Rows are built in a dozen places; this catches them all.
  let queued = [], raf = 0;
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) queued.push(n);
    if (queued.length && !raf) raf = requestAnimationFrame(() => {
      raf = 0;
      const nodes = queued; queued = [];
      for (const n of nodes) if (n.isConnected) paint(n);
    });
  }).observe(document.body, { childList: true, subtree: true });

  // Markup for a star button. `cls` adds the host's own button classes.
  function button(kind, id, cls = '', label = '') {
    return `<button type="button" class="klab-star ${cls}" data-star="${kind}:${esc(String(id))}" title="Star" aria-pressed="false">` +
      `<i class="ti ti-star"></i>${label ? `<span class="klab-star-label">${label}</span>` : ''}<span class="klab-star-n"></span></button>`;
  }

  return { paint, toggle, get, button };
})();
