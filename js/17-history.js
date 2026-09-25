// ══════════════════════════════════════════
//  HISTORY — the browser's Back and Forward (mouse buttons, trackpad swipe,
//  Alt+←) step through screens, not just top-level tabs.
//
//  Tabs were the only thing that touched history (via location.hash), so
//  opening an album, a genre, a playlist, another Music section or another
//  chat room left no trail: Back skipped all of it and jumped to the
//  previous tab, or off the site. Now each of those pushes an entry
//  carrying a small description of the screen ({ tab, kind, ... }), and
//  popstate puts that screen back. Pushes are suppressed while restoring,
//  so going back never creates new entries.
// ══════════════════════════════════════════
(function() {
  let restoring = false;
  let depth = 0;           // entries we've pushed that Back can return through
  const current = {};      // tab -> descriptor of what that tab shows now

  const same = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  const activeTab = () => document.querySelector('.tab-panel.active')?.dataset.tabPanel || 'home';

  function push(desc) {
    if (restoring || !desc) return;
    const tab = desc.tab;
    if (same(current[tab], desc)) return;
    // A tab's first screen is where it starts, not a step to go back through.
    if (!current[tab]) {
      current[tab] = desc;
      history.replaceState({ ...(history.state || {}), klab: desc }, '', location.href);
      return;
    }
    // The entry we're leaving learns what it was showing, so Back can
    // return to it (tab entries made by location.hash start out blank).
    if (current[tab] && !history.state?.klab) {
      history.replaceState({ ...(history.state || {}), klab: current[tab] }, '', location.href);
    }
    current[tab] = desc;
    history.pushState({ klab: desc }, '', '#' + tab);
    depth++;
  }

  // In-page back buttons (the album page's arrow, "← Genres") go through
  // history too when there's somewhere of ours to go back to, so the two
  // kinds of Back never disagree.
  function back() {
    if (depth > 0 && history.state?.klab) { history.back(); return true; }
    return false;
  }
  window.klabNav = { push, back };

  function restore(desc) {
    restoring = true;
    try {
      current[desc.tab] = desc;
      if (desc.tab === 'music') restoreMusic(desc);
      else if (desc.tab === 'chat') restoreChat(desc);
    } finally {
      // Click handlers and async openers may push a tick later.
      setTimeout(() => { restoring = false; }, 0);
    }
  }

  function restoreMusic(d) {
    if (d.kind === 'section') {
      window.closeApPanel?.();
      document.querySelector(`.picker-tab[data-tab="${d.section}"]`)?.click();
    } else if (d.kind === 'playlist') {
      window.closeApPanel?.();
      document.querySelector(`.music-playlist-row[data-pl-id="${CSS.escape(d.id)}"]`)?.click();
    } else if (d.kind === 'album') {
      window.openAlbumPage?.(d.id, d.name);
    } else if (d.kind === 'artist') {
      window.openArtistPage?.(d.id, d.name);
    } else if (d.kind === 'genre') {
      window.closeApPanel?.();
      window.klabOpenGenre?.(d.value);
    }
  }

  function restoreChat(d) {
    if (typeof renderChannelList !== 'function') return;
    if (d.room && d.room !== _chatActiveRoomId) { _chatActiveRoomId = d.room; renderChannelList(); }
    if (d.view && typeof setChatMobileView === 'function') setChatMobileView(d.view);
  }

  window.addEventListener('popstate', e => {
    const d = e.state?.klab;
    depth = Math.max(0, depth - 1);
    if (d) restore(d);
  });

  // ── Where screens change ──
  // Music sections: after the sidebar's own click handler has run.
  document.addEventListener('click', e => {
    const tab = e.target.closest?.('.picker-tab');
    if (tab) setTimeout(() => push({ tab: 'music', kind: 'section', section: tab.dataset.tab }), 0);
    const pl = e.target.closest?.('.music-playlist-row');
    if (pl && !e.target.closest('.music-playlist-row-del')) setTimeout(() => push({ tab: 'music', kind: 'playlist', id: pl.dataset.plId }), 0);
  }, true);

  // Album and artist pages.
  for (const [fn, kind] of [['openAlbumPage', 'album'], ['openArtistPage', 'artist']]) {
    const orig = window[fn];
    if (typeof orig !== 'function') continue;
    window[fn] = function(id, name) {
      push({ tab: 'music', kind, id, name });
      return orig.apply(this, arguments);
    };
  }
  // The album page's own back arrow.
  document.getElementById('apBack')?.addEventListener('click', e => {
    if (back()) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);

  // Chat: switching rooms, and on a phone the list/conversation switch.
  if (typeof setChatMobileView === 'function') {
    const orig = setChatMobileView;
    setChatMobileView = function(view) {
      orig(view);
      if (activeTab() === 'chat') push({ tab: 'chat', kind: 'room', room: _chatActiveRoomId, view });
    };
  }

  // What each tab shows before anything is clicked.
  current.music = { tab: 'music', kind: 'section', section: 'random' };
})();
