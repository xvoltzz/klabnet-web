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
//
//  Each tab also keeps its own trail, like the tabs of a phone app. Every
//  entry remembers which earlier entry its tab was showing before it
//  (klabPrev), and klabNav.back(), which the album page's arrow and the
//  mouse's Back button use, jumps straight there. So Back from an album
//  goes to what Music showed before it, even after a detour through Feed;
//  the browser's own Back still walks the whole trail.
// ══════════════════════════════════════════
(function() {
  let restoring = false;
  const current = {};      // tab -> descriptor of what that tab shows now
  let underPanel = '';     // what Music was showing when an album/artist page opened over it
  const prevOf = {};       // tab -> klabPrev of the entry that last showed it
  const at = () => history.state?.klabAt || 0;

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
    // as Back, and was zero again after a reload. klabPrev: the entry this
    // screen was opened from, where its Back goes.
    prevOf[tab] = at();
    history.pushState({ klab: desc, klabFrom: from, klabAt: at() + 1, klabPrev: at() }, '', '#' + tab);
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
      // Coming back to a tab shows the screen it was on, so Back from here
      // goes where Back from that screen went.
      history.pushState({ klab: desc, klabFrom: from, klabAt: at() + 1, klabPrev: prevOf[key] }, '', '#' + key);
    } else history.replaceState({ ...(history.state || {}), klab: desc }, '', '#' + key);
  }

  // In-page back buttons (the album page's arrow, "← Genres") go through
  // history too when there's somewhere of ours to go back to, so the two
  // kinds of Back never disagree.
  function back() {
    const st = history.state, to = st?.klabPrev;
    if (!st?.klab || typeof to !== 'number' || to >= at()) return false;
    history.go(to - at());
    return true;
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
    if (document.getElementById('apPanel')?.classList.contains('open') && !['album', 'artist', 'playlist'].includes(d.kind) && JSON.stringify(d) === underPanel) {
      window.closeApPanel?.();
      return;
    }
    if (d.kind === 'section') {
      window.closeApPanel?.();
      document.querySelector(`.picker-tab[data-tab="${d.section}"]`)?.click();
    } else if (d.kind === 'playlist') {
      window.openPlaylistPage?.(d.id, d.name);
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
    if (d) { prevOf[d.tab] = e.state.klabPrev; restore(d); }
  });

  // ── Where screens change ──
  // Music sections: after the sidebar's own click handler has run.
  document.addEventListener('click', e => {
    const tab = e.target.closest?.('.picker-tab');
    if (tab) setTimeout(() => push({ tab: 'music', kind: 'section', section: tab.dataset.tab }), 0);
  }, true);

  // Album, artist and playlist pages.
  for (const [fn, kind] of [['openAlbumPage', 'album'], ['openArtistPage', 'artist'], ['openPlaylistPage', 'playlist']]) {
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
