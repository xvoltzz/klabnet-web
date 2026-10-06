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
  const current = {};      // tab -> descriptor of what that tab shows now
  let underPanel = '';     // what Music was showing when an album/artist page opened over it

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
    const from = history.state?.klab;
    current[tab] = desc;
    // klabAt: how many of our entries lie behind this one. Kept in the
    // entry, not in a counter here: a counter went down on Forward as well
    // as Back, and was zero again after a reload.
    history.pushState({ klab: desc, klabFrom: from, klabAt: (history.state?.klabAt || 0) + 1 }, '', '#' + tab);
  }

  function tab(key) {
    if (restoring) return;
    const was = location.hash.slice(1);
    if (key === 'chat' && was !== key) current.chat = {
      tab: 'chat', kind: 'room', room: _chatActiveRoomId,
      ...(matchMedia(KLAB_PHONE_MQ).matches ? { view: 'rooms' } : {}),
    };
    const desc = current[key] || { tab: key, kind: 'tab' };
    if (was === key) {
      if (!history.state?.klab) history.replaceState({ ...(history.state || {}), klab: desc }, '', location.href);
      return;
    }
    if (TABS.includes(was)) {
      const from = current[was] || { tab: was, kind: 'tab' };
      history.replaceState({ ...(history.state || {}), klab: from }, '', location.href);
      history.pushState({ klab: desc, klabFrom: from, klabAt: (history.state?.klabAt || 0) + 1 }, '', '#' + key);
    } else history.replaceState({ ...(history.state || {}), klab: desc }, '', '#' + key);
  }

  // In-page back buttons (the album page's arrow, "← Genres") go through
  // history too when there's somewhere of ours to go back to, so the two
  // kinds of Back never disagree.
  function back() {
    if (history.state?.klabAt > 0 && history.state?.klab) { history.back(); return true; }
    return false;
  }
  window.klabNav = { push, back, tab };

  function restore(desc) {
    restoring = true;
    try {
      current[desc.tab] = desc;
      // pushState changes the URL without a hashchange. Restore the tab
      // and its screen together, before a room/list restoration can push.
      if (activeTab() !== desc.tab) setActiveTab(desc.tab);
      if (desc.tab === 'music') restoreMusic(desc);
      else if (desc.tab === 'chat') restoreChat(desc);
    } finally {
      // Click handlers and async openers may push a tick later.
      setTimeout(() => { restoring = false; }, 0);
    }
  }

  function restoreMusic(d) {
    // Back from an album or artist page to the list it was opened over:
    // that list is still there underneath, as you left it (scrolled, or
    // showing a search). Reloading it started Albums over from the top.
    if (document.getElementById('apPanel')?.classList.contains('open') && d.kind !== 'album' && d.kind !== 'artist' && JSON.stringify(d) === underPanel) {
      window.closeApPanel?.();
      return;
    }
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
    // A conversation closed or left since: getRoom() still has it, so it
    // would open again for a while, with a composer that can't send.
    const membership = d.room && window.MatrixChat?.client?.getRoom(d.room)?.getMyMembership?.();
    if (d.room && d.room !== _chatActiveRoomId && (membership === 'join' || membership === 'invite')) { if (typeof chooseChatRoom === 'function') chooseChatRoom(d.room); else _chatActiveRoomId = d.room; renderChannelList(); }
    if (d.view && typeof setChatMobileView === 'function') setChatMobileView(d.view);
  }

  window.addEventListener('popstate', e => {
    const d = e.state?.klab;
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
      if (!restoring && !document.getElementById('apPanel')?.classList.contains('open')) underPanel = JSON.stringify(current.music);
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
      // The list/conversation switch is only a screen on a phone; on a
      // desktop both are showing, and recording it made a Back press that
      // changed nothing (entering Chat says 'rooms', then a jump says 'convo').
      const phone = matchMedia(KLAB_PHONE_MQ).matches;
      if (!restoring && phone && view === 'rooms' && current.chat?.view === 'convo' && activeTab() === 'chat') {
        if (history.state?.klabFrom?.tab === 'chat' && history.state.klabFrom.view === 'rooms' && back()) return;
        // No list entry behind us (a direct link): replace the conversation
        // with its list rather than adding another forward step.
        orig(view);
        current.chat = { tab: 'chat', kind: 'room', room: _chatActiveRoomId, view };
        history.replaceState({ ...(history.state || {}), klab: current.chat }, '', location.href);
        return;
      }
      orig(view);
      if (activeTab() === 'chat') push({ tab: 'chat', kind: 'room', room: _chatActiveRoomId, ...(phone ? { view } : {}) });
    };
  }

  // What each tab shows before anything is clicked.
  current.music = { tab: 'music', kind: 'section', section: 'random' };
  // The first page is a real destination too, so Back from a different
  // tab can restore it without needing a hashchange side effect.
  tab(activeTab());
})();
