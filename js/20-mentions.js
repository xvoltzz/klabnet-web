// ══════════════════════════════════════════
//  @MENTION SUGGESTIONS — type @ in a post, a reply, a photo caption or a
//  comment and the people whose names match come up under the cursor:
//  ↑/↓ to choose, Enter or Tab to put it in, Esc to close. Only real
//  people are offered (window.klabPeople, js/11-presence.js), the same
//  list that decides which @names get coloured.
// ══════════════════════════════════════════
(function() {
  const FIELDS = '#feedComposerText, .feed-post-reply-input, #phComposeCaption, #phEditCaption, #phReplyInput';
  const MAX = 6;
  const box = document.createElement('div');
  box.className = 'mention-suggest';
  box.setAttribute('role', 'listbox');
  box.hidden = true;
  document.body.appendChild(box);

  let field = null, matches = [], hi = 0, start = -1;
  const me = () => (window.KLAB_USER?.username || '').toLowerCase();

  // The "@nam" being typed right before the cursor, if any.
  function query(el) {
    const at = el.selectionStart;
    if (at == null || at !== el.selectionEnd) return null;
    const m = /(^|[^\w@])@([\w.-]{0,30})$/.exec(el.value.slice(0, at));
    return m ? { q: m[2].toLowerCase(), start: at - m[2].length - 1 } : null;
  }

  function candidates(q) {
    const online = window.KLAB_ONLINE_USERNAMES || new Set();
    const away = window.KLAB_AWAY || new Map();
    const here = u => [...online].some(o => o && o.toLowerCase() === u) && !away.has(u);
    return (window.klabPeople?.() || [])
      .filter(u => u !== me() && u.includes(q))
      .sort((a, b) => (b.startsWith(q) - a.startsWith(q)) || (here(b) - here(a)) || a.localeCompare(b))
      .slice(0, MAX);
  }

  function face(u) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="mention-suggest-av" style="--c:' + profileColor(u) + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc(u[0].toUpperCase())) + '</span>';
  }

  // Where the cursor is in a textarea/input, in viewport px: a copy of the
  // field's text up to the cursor, laid out the same way, off screen.
  function caretXY(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const m = document.createElement('div');
    const copy = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textIndent', 'wordBreak', 'overflowWrap'];
    copy.forEach(p => { m.style[p] = cs[p]; });
    Object.assign(m.style, { position: 'fixed', left: '-9999px', top: '0', visibility: 'hidden',
      whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre' });
    m.textContent = el.value.slice(0, el.selectionStart);
    const mark = document.createElement('span');
    mark.textContent = '​';
    m.appendChild(mark);
    document.body.appendChild(m);
    const x = mark.offsetLeft - el.scrollLeft, y = mark.offsetTop - el.scrollTop;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    m.remove();
    return { x: r.left + Math.min(x, r.width - 16), y: r.top + y + lh };
  }

  function place() {
    const z = typeof zoomFactor === 'function' ? zoomFactor() : 1;
    const p = caretXY(field);
    const w = box.offsetWidth, h = box.offsetHeight;
    let left = p.x, top = p.y + 4;
    // Above the line when there's no room below (a reply box at the bottom).
    if (top + h > innerHeight - 8) top = p.y - (parseFloat(getComputedStyle(field).lineHeight) || 20) - h - 4;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    box.style.left = left / z + 'px';
    box.style.top = Math.max(8, top) / z + 'px';
  }

  function render() {
    box.innerHTML = matches.map((u, i) =>
      '<button type="button" role="option" data-u="' + esc(u) + '"' + (i === hi ? ' class="hi" aria-selected="true"' : '') + '>' +
        face(u) + '<span class="mention-suggest-name">' + esc(u) + '</span>' +
        (window.KLAB_ONLINE_USERNAMES?.has(u) ? '<span class="mention-suggest-dot' + (window.KLAB_AWAY?.has(u) ? ' away' : '') + '"></span>' : '') +
      '</button>').join('');
  }

  function update(el) {
    const q = query(el);
    matches = q ? candidates(q.q) : [];
    if (!matches.length) return close();
    field = el; start = q.start; hi = Math.min(hi, matches.length - 1);
    render();
    box.hidden = false;
    place();
  }

  function close() {
    box.hidden = true;
    matches = []; hi = 0; field = null; start = -1;
  }

  function pick(u) {
    const el = field;
    if (!el || start < 0) return;
    const at = el.selectionStart, ins = '@' + u + ' ';
    el.setRangeText(ins, start, at, 'end');
    close();
    el.focus();
    // The composer's highlight, drafts and counters all listen for input.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    SFX && SFX.play('click');
  }

  document.addEventListener('input', e => {
    if (!e.target.matches?.(FIELDS)) return;
    hi = field === e.target ? hi : 0;
    update(e.target);
  });
  // Moving the cursor away from the @name closes it.
  document.addEventListener('selectionchange', () => {
    if (field && document.activeElement === field && !query(field)) close();
  });
  document.addEventListener('focusout', e => { if (e.target === field) setTimeout(() => { if (document.activeElement !== field) close(); }, 120); });
  addEventListener('resize', () => field && place());
  document.addEventListener('scroll', () => field && place(), true);

  // Ahead of the fields' own keys (Enter posts a reply, ⌘↵ posts).
  document.addEventListener('keydown', e => {
    if (box.hidden || e.target !== field) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      hi = (hi + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      render();
    } else if ((e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
      pick(matches[hi]);
    } else if (e.key === 'Escape') {
      close();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  box.addEventListener('mousedown', e => e.preventDefault());   // keep the field focused
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-u]');
    if (b) pick(b.dataset.u);
  });
  box.addEventListener('mousemove', e => {
    const b = e.target.closest('button[data-u]');
    const i = b ? matches.indexOf(b.dataset.u) : -1;
    if (i >= 0 && i !== hi) { hi = i; render(); }
  });
})();
