// ══════════════════════════════════════════
//  HOME
//  The owner (2026-11-20): "i like the minimal honestly. i just want it
//  to serve a purpose". Three things, nothing else:
//    · A greeting, one line.
//    · Who's online: Contacts' rows (js/47-contacts.js): face, name, what
//      they're doing. Pressing one joins what they're in (Listen along, a
//      watch party, their voice channel, their stream) or, if nothing,
//      messages them; Call and the rest are on the row and its right-click.
//    · Together: the rooms happening now (js/25-social.js), each one press
//      to join, and Start something when there are none.
//  The notes sky, the offline list, the changelog (Settings → About →
//  What's new, js/18-home.js) and the split layout are gone. Nothing
//  moves but Together's progress lines.
// ══════════════════════════════════════════
(function () {
  const page = document.getElementById('homePage');
  if (!page) return;
  const me = () => window.KLAB_USER?.username || '';
  page.innerHTML =
    '<h1 class="k-page-title hp-hello" id="hpHello"></h1>' +
    '<section class="hp-online" aria-labelledby="hpOnTitle">' +
      '<div class="wk-head"><span class="k-label" id="hpOnTitle">Online</span><span class="wk-range" id="hpOnN"></span></div>' +
      '<div class="ct-list hp-on" id="hpOn" role="list"></div>' +
    '</section>' +
    '<section class="hp-together" id="hpTogether" aria-label="Together"></section>';
  const hello = page.querySelector('#hpHello'), listEl = page.querySelector('#hpOn'), countEl = page.querySelector('#hpOnN');
  let active = false, lastHTML = '';

  function greet() {
    const h = new Date().getHours();
    const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const u = me();
    hello.textContent = part + (u && u !== 'anonymous' ? ', ' + u : '');
  }

  function paint() {
    if (!active) return;
    greet();
    const C = window.klabContacts;
    if (!C) return;
    const online = [...(window.KLAB_ONLINE_USERNAMES || [])].filter(u => u && u !== me() && !u.endsWith('-bot'))
      .map(u => ({ u, s: C.stateOf(u) })).filter(x => x.s.on)
      // Doing something first (joinable), then listening, then the rest; away last.
      .sort((a, b) => (!!C.joinOf(b.u, b.s) - !!C.joinOf(a.u, a.s)) || ((a.s.tone === 'away') - (b.s.tone === 'away')) || a.u.localeCompare(b.u));
    countEl.textContent = online.length ? String(online.length) : '';
    const html = online.length ? online.map(x => C.rowHTML(x.u, x.s, { join: true })).join('')
      : '<div class="k-empty hp-empty"><div>Nobody else is online right now.</div></div>';
    if (html === lastHTML) return;
    const focused = document.activeElement?.closest?.('.ct-row')?.dataset.u;
    lastHTML = html;
    listEl.innerHTML = html;
    if (focused) listEl.querySelector('.ct-row[data-u="' + CSS.escape(focused) + '"]')?.focus({ preventScroll: true });
  }

  listEl.addEventListener('click', e => {
    const row = e.target.closest('.ct-row');
    if (!row) return;
    const C = window.klabContacts, u = row.dataset.u;
    const b = e.target.closest('[data-ct]');
    if (b) { C.act(b.dataset.ct, u, b); return; }
    // The row: what they're in, else a message.
    const j = C.joinOf(u, C.stateOf(u));
    if (j) { SFX?.play('click'); j.run(); } else C.act('message', u, row);
  });
  listEl.addEventListener('contextmenu', e => {
    const row = e.target.closest('.ct-row');
    if (row) klabMenu(e, window.klabContacts.menu(row.dataset.u));
  });
  listEl.addEventListener('keydown', e => {
    const row = e.target.closest?.('.ct-row');
    if (!row || e.ctrlKey || e.metaKey || e.altKey) return;
    const rows = [...listEl.querySelectorAll('.ct-row')], i = rows.indexOf(row);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); row.click(); }
    else if (e.key === 'c') { e.preventDefault(); e.stopPropagation(); window.klabContacts.act('call', row.dataset.u, row); }
  }, true);
  // Rows are reachable from the keyboard here (Tab into the list).
  new MutationObserver(() => { const f = listEl.querySelector('.ct-row'); if (f && !listEl.querySelector('.ct-row[tabindex="0"]')) f.tabIndex = 0; })
    .observe(listEl, { childList: true });

  // Together: js/25-social.js's rooms, shown here.
  function mountTogether() {
    const t = window.klabTogether;
    const host = page.querySelector('#hpTogether');
    if (t && t.el.parentElement !== host) host.appendChild(t.el);
  }

  // ── Hooks ──
  const presenceChanged = window.klabHomePresenceChanged;
  window.klabHomePresenceChanged = () => { presenceChanged?.(); if (active) paint(); };
  window.addEventListener('klab:status', () => { if (active) paint(); });
  window.addEventListener('klab:people', () => { lastHTML = ''; if (active) paint(); });
  let tick = 0;
  const tabChanged = window.klabHomeTabChanged;
  window.klabHomeTabChanged = show => {
    tabChanged?.(show);
    if (show === active) return;
    active = show;
    clearInterval(tick);
    mountTogether();
    window.klabTogether?.shown(show);
    if (active) {
      lastHTML = ''; paint();
      // Voice and rooms move without a presence poll: a light look every 10s.
      tick = setInterval(() => { if (!document.hidden) paint(); }, 10e3);
    }
  };
  if (document.body.classList.contains('tab-home-active')) window.klabHomeTabChanged(true);
  // Contacts' rows (js/47-contacts.js) load after this file.
  window.addEventListener('load', () => { lastHTML = ''; mountTogether(); paint(); });
})();
