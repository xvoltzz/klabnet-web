// ══════════════════════════════════════════
//  TAB NAV — Home / Feed / Chat / Music / Photos router
//  Hash-based so tabs are bookmarkable and back/forward works. The floating
//  player dock lives outside every .tab-panel, so it's unaffected by any of
//  this and keeps playing/visible across tab switches.
// ══════════════════════════════════════════
const TABS = ['home', 'feed', 'chat', 'music', 'photos'];

// Heavy per-tab setup waits until the switch itself has reached the screen,
// so the tab highlight and the panel's fade start moving straight away
// instead of after that work. The panel fades in from transparent, so a
// frame of not-yet-updated content is never visible.
function afterSwitchPaints(fn) { requestAnimationFrame(() => setTimeout(fn, 0)); }

function isTabEnabled(key) {
  const btn = document.querySelector(`.tab-nav-btn[data-tab-target="${key}"]`);
  return !!btn && !btn.hidden;
}

function setActiveTab(key) {
  if (!TABS.includes(key) || !isTabEnabled(key)) key = 'home';
  // Captured before the tab-panel/body-class toggles below — used further
  // down to detect "just arrived on Chat" vs. "already there".
  const enteringChat = key === 'chat' && !document.body.classList.contains('tab-chat-active');
  document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tabTarget === key));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === key));
  // Chat wants to feel like its own app screen, not another section on
  // the scrolling dashboard — the hero/MOTD header and the presence rail
  // (redundant there anyway, Chat already shows who's around) collapse
  // to give it real room instead of being squeezed into a small fixed box.
  document.body.classList.toggle('tab-chat-active', key === 'chat');
  // Same flex-fill idea as Chat, for the same reason — see body.tab-music-active's own CSS comment.
  document.body.classList.toggle('tab-music-active', key === 'music');
  document.body.classList.toggle('tab-photos-active', key === 'photos');
  document.body.classList.toggle('tab-home-active', key === 'home');
  document.body.classList.toggle('tab-feed-active', key === 'feed');
  if (typeof window.klabHomeTabChanged === 'function') { const on = key === 'home'; afterSwitchPaints(() => window.klabHomeTabChanged(on)); }
  // Photos starts/stops its song clips and refits its stage (which had no
  // size while hidden). Nothing is fetched here: the tab loads in the background.
  if (key === 'feed' && typeof window.klabFeedShown === 'function') afterSwitchPaints(window.klabFeedShown);
  if (typeof window.klabPhotosTabChanged === 'function') { const on = key === 'photos'; afterSwitchPaints(() => window.klabPhotosTabChanged(on)); }
  // The header prompt backspaces into klab.chat on this tab and back out
  // of it on the others (see retypePrompt()).
  if (typeof retypePrompt === 'function') retypePrompt(key === 'chat' ? CHAT_PROMPT_TEXT : FULL_TEXT);
  // Landing on Chat with a room already selected but nothing else
  // happening to trigger a re-render (e.g. clicking the nav tab itself)
  // still counts as reading whatever's currently open.
  if (key === 'chat' && typeof maybeReadActiveChatRoom === 'function') afterSwitchPaints(maybeReadActiveChatRoom);
  // renderTimeline()'s own roomChanged check only fires on an actual room
  // switch — arriving at the Chat tab itself (nav click, hash nav, a
  // deep link) was a complete no-op for it, since neither the room nor
  // the message list changed. That meant leaving Chat scrolled up to read
  // history and coming back later (a different tab in between, or just
  // reopening the app) landed you exactly where you'd left off instead of
  // at the most recent message, forever, with no way back to the bottom
  // short of scrolling there by hand. Forcing a rebuild specifically on
  // arrival (not on every render — see the timer-based version of this
  // that got reverted earlier this session for exactly that reason) is
  // the one moment a hard jump-to-bottom is actually the correct, expected
  // behavior rather than something yanking the view out from under you.
  // Arriving at Chat on a phone lands on the list of people/channels, not
  // straight into whatever conversation happened to be active. Anything
  // that jumps to a specific room (openChatRoom, messageUser) sets 'convo'
  // immediately AFTER its own setActiveTab call, so it wins over this.
  if (enteringChat && typeof setChatMobileView === 'function') setChatMobileView('rooms');
  if (enteringChat && typeof renderTimeline === 'function') {
    _lastTimelineRenderKey = null;
    // Clearing the render key above only forces renderTimeline() to
    // actually rebuild — it does NOT by itself force the jump-to-bottom
    // this comment describes. renderTimeline()'s own wasNearBottom check
    // only treats a genuine ROOM switch as an automatic bottom-jump
    // (roomChanged); returning to the SAME room you'd left scrolled up in
    // isn't a room change, so without this flag it rebuilt in place and
    // left you exactly where you'd left off — the very bug this whole
    // block exists to fix, still half-open. Part of the "have to keep
    // scrolling down" report.
    if (typeof _forceScrollBottomOnNextRender !== 'undefined') _forceScrollBottomOnNextRender = true;
    afterSwitchPaints(() => { if (!window.klabChatFlush?.()) renderTimeline(); });
  }
  // A hash that isn't a tab (none yet on a first visit, or an old bookmark
  // like #apps) is corrected in place. Setting it pushed a new entry, and
  // Back to the bad hash just pushed it again: Back could never leave.
  const was = location.hash.slice(1);
  if (was !== key) {
    if (TABS.includes(was)) location.hash = key;
    else history.replaceState(history.state, '', '#' + key);
  }
  // Landing on Music directly (deep link, reload, or a nav-bar click — not
  // just via openPicker()) still needs its content fetched the first time.
  if (key === 'music' && typeof ensureMusicTabLoaded === 'function') afterSwitchPaints(ensureMusicTabLoaded);
}


function initTabs() {
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tabTarget));
  });
  // A click already switched; the hash it set shouldn't do it all again.
  window.addEventListener('hashchange', () => {
    const key = location.hash.slice(1) || 'home';
    if (document.querySelector(`.tab-panel[data-tab-panel="${CSS.escape(key)}"]`)?.classList.contains('active')) return;
    setActiveTab(key);
  });
  setActiveTab(location.hash.slice(1) || 'home');
}

function openSettings() {
  // Sync UI to current settings
  const su = document.getElementById('settingsUser');
  if (su) su.textContent = window.KLAB_USER?.username || '—';

  const toggleMap = {
    sfxToggle:        'sfxEnabled',
    notifSoundToggle: 'notifSound',
    loginSongToggle:  'loginSong',
  };
  Object.entries(toggleMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!_settings[key]);
  });
  syncDesktopNotifRow();
  syncAwayRow();
  syncLowFxRow();
  window.syncAppSettings?.(); // inside klabnet for Windows only

  const volVal = document.getElementById('sfxVolumeVal');
  const pct    = _settings.sfxVolume ?? 0.7;
  sfxVolumeSlider.setPct(pct);
  if (volVal) volVal.textContent = Math.round(pct * 100) + '%';

  document.getElementById('settingsBackdrop').classList.add('open');
  SFX && SFX.play('open');
}

function closeSettings() {
  document.getElementById('settingsBackdrop').classList.remove('open');
  SFX && SFX.play('close');
}

// Desktop notifications: on only when the setting is on *and* the browser
// agrees. Blocked in the browser means the switch can't fix it, so say where.
function syncDesktopNotifRow() {
  const row = document.getElementById('desktopNotifRow');
  if (!row) return;
  if (!('Notification' in window)) { row.hidden = true; return; }
  const perm = Notification.permission;
  document.getElementById('desktopNotifToggle').classList.toggle('on', !!_settings.desktopNotif && perm === 'granted');
  document.getElementById('desktopNotifSub').textContent = perm === 'denied'
    ? 'Blocked by your browser. Allow notifications for this site, then flip this on'
    : "DMs, mentions and replies while klabnet's in the background";
}
document.getElementById('desktopNotifToggle')?.addEventListener('click', async e => {
  e.stopImmediatePropagation();
  SFX && SFX.play('click');
  if (_settings.desktopNotif) { _settings.desktopNotif = false; saveSettings(); syncDesktopNotifRow(); return; }
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (err) {} }
  _settings.desktopNotif = perm === 'granted';
  saveSettings();
  syncDesktopNotifRow();
  if (perm === 'granted') showToast("You'll get desktop notifications for DMs, mentions and replies", 'ti-bell');
}, true);

// The shell button: the desktop app's typed MOTD, on or off. Off, it
// backspaces itself away; on again, it types the current one back in.
function syncMotdToggle() {
  const b = document.getElementById('motdToggle');
  if (!b) return;
  const on = _settings.motdTyping !== false;
  b.classList.toggle('active', !on);
  b.setAttribute('aria-pressed', on);
  b.title = on ? 'Stop typing the MOTD' : 'Type the MOTD';
}
document.getElementById('motdToggle')?.addEventListener('click', () => {
  _settings.motdTyping = _settings.motdTyping === false;
  saveSettings();
  syncMotdToggle();
  typePromptMotd(_motdCurrent);
  SFX && SFX.play('click');
});

// Away status: the desktop app knows when the computer's in use; Chrome
// can too, once the site's allowed to (Idle Detection). Other browsers
// only see klabnet's own window, which can't tell away from busy elsewhere.
async function syncAwayRow() {
  const row = document.getElementById('awayRow');
  if (!row) return;
  const app = !!window.klabnetDesktop?.idle, chrome = !window.klabnetDesktop && 'IdleDetector' in window;
  row.hidden = !app && !chrome;
  if (row.hidden) return;
  let perm = 'granted';
  if (chrome) { try { perm = (await navigator.permissions.query({ name: 'idle-detection' })).state; } catch (e) { perm = 'prompt'; } }
  document.getElementById('awayToggle').classList.toggle('on', _settings.awayStatus !== false && perm === 'granted');
  document.getElementById('awaySub').textContent = perm === 'denied'
    ? 'Blocked by your browser. Allow idle detection for this site, then flip this on'
    : "Shows you as away after 5 minutes without using your computer, or when it's locked";
}
document.getElementById('awayToggle')?.addEventListener('click', async e => {
  e.stopImmediatePropagation();
  SFX && SFX.play('click');
  const on = document.getElementById('awayToggle').classList.contains('on');
  if (on) { _settings.awayStatus = false; saveSettings(); syncAwayRow(); return; }
  if (!window.klabnetDesktop && 'IdleDetector' in window) {
    let perm = 'denied';
    try { perm = await IdleDetector.requestPermission(); } catch (err) {}
    if (perm !== 'granted') { syncAwayRow(); return; }
  }
  _settings.awayStatus = true;
  saveSettings();
  window.klabStartIdleDetector?.();
  syncAwayRow();
}, true);

// Performance mode: the <head> script already applied it at load. Left
// on auto it follows that script's GPU probe; flipping it makes it explicit.
function syncLowFxRow() {
  const fx = window.KLAB_FX;
  const toggle = document.getElementById('lowFxToggle');
  if (!fx || !toggle) return;
  toggle.classList.toggle('on', fx.on());
  document.getElementById('lowFxSub').textContent = _settings.lowFx == null && fx.auto.low
    ? `On automatically: ${fx.auto.why}`
    : 'No blurred backgrounds, frosted glass or looping animations';
}
document.getElementById('lowFxToggle')?.addEventListener('click', e => {
  e.stopImmediatePropagation();
  SFX && SFX.play('click');
  _settings.lowFx = !window.KLAB_FX.on();
  saveSettings();
  window.KLAB_FX.apply(_settings.lowFx);
  syncLowFxRow();
}, true);

// Wire toggles
document.querySelectorAll('.s-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('on');
    SFX && SFX.play('click');
    // Map toggle id back to settings key
    const map = {
      sfxToggle: 'sfxEnabled', notifSoundToggle: 'notifSound',
      loginSongToggle: 'loginSong',
    };
    const key = map[toggle.id];
    if (key) { _settings[key] = toggle.classList.contains('on'); saveSettings(); applySettings(); }
  });
});

// SFX volume slider
const sfxVolumeSlider = makeSlider(
  document.getElementById('sfxVolumeSlider'),
  document.getElementById('sfxVolumeFill'),
  document.getElementById('sfxVolumeDot'),
  pct => {
    _settings.sfxVolume = pct;
    document.getElementById('sfxVolumeVal').textContent = Math.round(pct * 100) + '%';
    saveSettings();
    SFX.setVolume(pct);
    if (pct > 0) SFX.play('hover');
  }
);

// Reset prefs
document.getElementById('clearPrefsRow').addEventListener('click', async () => { SFX.play('error');
  if (!(await showConfirmDialog('// reset preferences', 'Reset all preferences? This cannot be undone.', 'Reset'))) return;
  // Clear localStorage
  Object.values(PREF_KEYS).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(SETTINGS_KEY);
  // Clear server prefs
  try {
    await fetchTimeout('/api/prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }, 8000);
  } catch(e) {}
  showToast('preferences reset — reloading...', 'ti-restore');
  setTimeout(() => location.reload(), 1500);
});

// Header overflow ("more") menu — toggled by its own button, closed by an
// outside click, Escape, or clicking any item inside it (motdRefresh/
// keyHintsBtn/feedbackBtn/repoBtn/accountBtn keep their own separately-
// wired click handlers elsewhere in the script; this only owns opening/
// closing the menu chrome around them).
(function() {
  const btn  = document.getElementById('headerMoreBtn');
  const menu = document.getElementById('headerMoreMenu');
  if (!btn || !menu) return;
  // The menu is a <body> child now (it stopped blurring its backdrop as a
  // descendant of .header), so it no longer inherits its position from
  // .header-right and has to be placed against the button each time it
  // opens — the button moves with viewport width and the zoom tiers.
  function positionHeaderMenu() { anchorPanelUnder(menu, btn, 10); }

  // Phone layout: Settings, the player switch and the theme switch live
  // in this menu instead of the header (.hdr-compact-only, CSS decides).
  // They just press the real buttons, so all their wiring stays in one place.
  const press = id => () => document.getElementById(id)?.click();
  document.getElementById('menuSettings')?.addEventListener('click', press('settingsBtn'));
  document.getElementById('menuPlayer')?.addEventListener('click', press('playerToggle'));
  document.getElementById('menuTheme')?.addEventListener('click', press('themeToggle'));
  function syncCompactItems() {
    const pl = document.querySelector('#menuPlayer span');
    if (pl) pl.textContent = document.body.classList.contains('player-hidden') ? 'Show player' : 'Hide player';
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    const th = document.getElementById('menuTheme');
    if (th) { th.querySelector('i').className = 'ti ' + (dark ? 'ti-sun' : 'ti-moon'); th.querySelector('span').textContent = dark ? 'Light theme' : 'Dark theme'; }
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = !menu.classList.contains('visible');
    if (opening) { syncCompactItems(); positionHeaderMenu(); }   // before .visible, so it never paints at a stale spot
    menu.classList.toggle('visible');
    SFX && SFX.play('click');
  });
  window.addEventListener('resize', () => {
    if (menu.classList.contains('visible')) positionHeaderMenu();
  });
  menu.addEventListener('click', e => { if (e.target.closest('.ctx-item')) menu.classList.remove('visible'); });
  document.addEventListener('click', e => {
    if (menu.classList.contains('visible') && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      menu.classList.remove('visible');
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.classList.remove('visible'); });
})();

document.getElementById('settingsBtn').addEventListener('click', () => { openSettings(); });
document.getElementById('settingsClose').addEventListener('click', () => { closeSettings(); });
document.getElementById('settingsBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('settingsBackdrop')) closeSettings();
});
// Had click-outside but no Escape — every other backdrop-modal in the app
// already closes on Escape, this one just got missed.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('settingsBackdrop').classList.contains('open')) closeSettings();
});
trapFocusWithin(
  document.querySelector('#settingsBackdrop .settings-modal'),
  () => document.getElementById('settingsBackdrop').classList.contains('open')
);

// Phone layout on a touch screen: the bottom tab bar and the mini player
// step aside while the on-screen keyboard is up, so what you're typing
// into isn't boxed in under them. (A narrow desktop window keeps them.)
(function() {
  const touchPhone = matchMedia(KLAB_PHONE_MQ);
  const isField = el => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search|url|email|password|tel|number)?$/i.test(el.type)));
  document.addEventListener('focusin', e => {
    if (touchPhone.matches && isField(e.target)) document.body.classList.add('kb-open');
  });
  // Focus hopping field to field passes through <body>; wait a beat.
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!isField(document.activeElement)) document.body.classList.remove('kb-open');
  }, 60));

  // The part of the screen the keyboard leaves visible. The pages that
  // don't scroll pin themselves to it while the keyboard is up (CSS), so
  // iOS doesn't slide the whole page, header and all, up out of view.
  const vv = window.visualViewport;
  if (vv) {
    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty('--vvh', vv.height + 'px');
      root.style.setProperty('--vvt', vv.offsetTop + 'px');
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
  }

  // No pinch zoom. iOS ignores user-scalable=no, but it does let a page
  // cancel its own pinch gestures. (klabnet's image viewer does its own
  // zooming with pointer events, which this doesn't touch.)
  ['gesturestart', 'gesturechange'].forEach(type =>
    document.addEventListener(type, e => e.preventDefault(), { passive: false }));
})();

// Phone layout: the dock collapses while you scroll down, the way Apple
// Music's tab bar does. It shrinks to a circle with the current tab's icon
// and the mini player slides over beside it (CSS: body.dock-mini).
// Scrolling back up, or tapping the circle, opens it again. Only scrolling
// you do counts: a chat jumping to a new message doesn't collapse it.
(function() {
  const phone = matchMedia(KLAB_PHONE_MQ);
  const nav = document.getElementById('tabNav');
  if (!nav) return;
  const buttons = () => [...nav.querySelectorAll('.tab-nav-btn:not([hidden])')];
  // Width is set explicitly (58px per icon, 2px gaps, 6px padding, 1px
  // border) so collapsing it can animate; max-content can't.
  const sizeDock = () => {
    const n = buttons().length;
    nav.style.setProperty('--dock-w', (n * 58 + (n - 1) * 2 + 12 + 2) + 'px');
  };
  sizeDock();
  let sticking = false;
  // fromScroll: you scrolled to cause this, so don't drag the chat back down.
  function setMini(on, fromScroll) {
    if (on === document.body.classList.contains('dock-mini')) { if (!on) armIdle(); return; }
    if (on) nav.style.setProperty('--ai', String(Math.max(0, buttons().findIndex(b => b.classList.contains('active')))));
    // The page's bottom space follows the dock, so Chat's timeline grows
    // and shrinks with it. Reading the newest messages, stay on them.
    const tl = document.getElementById('chatTimeline');
    const pinned = !fromScroll && tl && tl.offsetParent && tl.scrollHeight - tl.scrollTop - tl.clientHeight < 80;
    document.body.classList.toggle('dock-mini', on);
    if (pinned) {
      const until = performance.now() + 500;
      sticking = true;
      (function stick() {
        tl.scrollTop = tl.scrollHeight;
        if (performance.now() < until) requestAnimationFrame(stick);
        else sticking = false;
      })();
    }
    if (!on) armIdle();
  }

  // It also tucks itself away when you've left it alone for a few seconds,
  // so a page you're just reading or listening on gets the screen. Not
  // while you're typing, a menu or the full player is open, or the mouse
  // is resting on the dock.
  const IDLE_MS = 4000;
  let idleTimer = 0;
  function armIdle() {
    clearTimeout(idleTimer);
    if (!phone.matches) return;
    idleTimer = setTimeout(() => {
      const busy = document.body.classList.contains('kb-open') ||
        document.querySelector('.hdr-more-menu.visible, .fs-player.open') || nav.matches(':hover');
      if (busy) armIdle(); else setMini(true);
    }, IDLE_MS);
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(t =>
    window.addEventListener(t, armIdle, { passive: true, capture: true }));
  armIdle();

  let userAt = 0;
  const touched = () => { userAt = performance.now(); };
  ['touchmove', 'wheel', 'keydown'].forEach(t => window.addEventListener(t, touched, { passive: true, capture: true }));

  const last = new WeakMap();
  document.addEventListener('scroll', e => {
    if (!phone.matches || sticking || document.body.classList.contains('kb-open')) return;
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || el.nodeType !== 1 || el.closest('#tabNav, .fs-player, .hdr-more-menu')) return;
    const top = el.scrollTop, prev = last.has(el) ? last.get(el) : top;
    last.set(el, top);
    if (performance.now() - userAt > 600) return;
    const d = top - prev;
    if (d > 6 && top > 60) setMini(true, true);
    else if (d < -6) setMini(false, true);
  }, { capture: true, passive: true });

  // Tapping the collapsed dock opens it rather than switching tabs.
  nav.addEventListener('click', e => {
    if (!document.body.classList.contains('dock-mini')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setMini(false);
  }, true);
  window.addEventListener('hashchange', () => setMini(false));
  phone.addEventListener('change', () => { setMini(false); if (!phone.matches) clearTimeout(idleTimer); });
  window.addEventListener('resize', sizeDock);
})();

// Desktop: the tab bar in the header opens when the page loads, then after
// a few seconds without the mouse near it (or the Tab key) it shrinks to
// just the current tab's icon (CSS: body.nav-mini). Moving the mouse close
// to it, Tab, 1-9 or keyboard focus on it opens it again. Mouse movement
// elsewhere on the page doesn't count: it's about the bar being unused,
// not the page.
(function() {
  const desk = matchMedia(KLAB_DESK_MQ);
  const nav = document.getElementById('tabNav');
  if (!nav) return;
  const IDLE_MS = 4000;
  let timer = 0, lastCheck = 0;
  function arm() {
    clearTimeout(timer);
    if (!desk.matches || window.klabSideNav?.on()) return;
    timer = setTimeout(() => {
      if (window.klabSideNav?.on()) return;
      if (nav.matches(':hover, :focus-within')) arm();
      else document.body.classList.add('nav-mini');
    }, IDLE_MS);
  }
  function open() {
    if (document.body.classList.contains('nav-mini')) {
      document.body.classList.remove('nav-mini');
      // Let the sliding highlight find the active tab again once the bar
      // has finished opening (it re-measures on resize).
      setTimeout(() => window.dispatchEvent(new Event('resize')), 420);
    }
    arm();
  }
  // "Close to it": a margin around the bar, wider sideways because it
  // grows sideways when it opens.
  document.addEventListener('pointermove', e => {
    if (!desk.matches || e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - lastCheck < 60) return;
    lastCheck = now;
    const r = nav.getBoundingClientRect();
    if (e.clientX > r.left - 180 && e.clientX < r.right + 180 && e.clientY > r.top - 70 && e.clientY < r.bottom + 70) open();
  }, { passive: true });
  document.addEventListener('keydown', e => {
    // Not while typing: a "2" in a message isn't a tab shortcut.
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
    if (e.key === 'Tab' || /^[1-9]$/.test(e.key)) open();
  }, true);
  nav.addEventListener('focusin', open);
  window.addEventListener('hashchange', open);
  desk.addEventListener('change', () => { document.body.classList.remove('nav-mini'); arm(); });
  arm();
})();

// ══════════════════════════════════════════
//  SIDEBAR NAVIGATION (Settings → Appearance → Navigation)
//  html[data-nav] is set in <head> and the CSS lays the page out from it;
//  this moves the tab buttons into the sidebar (and back to the header
//  for Tabs, or on a phone, where they're the bottom dock), and runs the
//  ☰ button: in a wide window it folds the sidebar to icons and back, and
//  where the sidebar is icons-only for lack of room, or hidden (Menu), it
//  opens it over the page.
// ══════════════════════════════════════════
window.klabSideNav = (function() {
  const root = document.documentElement;
  const desk = matchMedia(KLAB_DESK_MQ);
  const roomy = matchMedia('(min-width: 1100px)');
  const nav = document.getElementById('tabNav');
  const header = document.querySelector('.header');
  if (!nav || !header) return null;
  const headerSlot = header.querySelector('.header-right');

  const side = document.createElement('aside');
  side.className = 'side-nav';
  side.id = 'sideNav';
  side.setAttribute('aria-label', 'Navigation');
  const foot = document.createElement('div');
  foot.className = 'side-nav-foot';
  foot.innerHTML = '<button type="button" class="side-nav-item" id="sideNavSettings" title="Settings"><i class="ti ti-settings"></i><span>Settings</span></button>';
  side.appendChild(foot);
  document.body.appendChild(side);
  foot.querySelector('#sideNavSettings').addEventListener('click', () => { close(); document.getElementById('settingsBtn')?.click(); });

  const burger = document.createElement('button');
  burger.type = 'button';
  burger.className = 'hdr-btn nav-burger';
  burger.id = 'navBurger';
  burger.title = 'Navigation';
  burger.setAttribute('aria-label', 'Navigation');
  burger.innerHTML = '<i class="ti ti-menu-2"></i>';

  const mode = () => root.getAttribute('data-nav') || 'top';
  const on = () => desk.matches && mode() !== 'top';
  // Showing names inline, or only icons (or nothing) with the full
  // sidebar a click away over the page.
  const inlineFull = () => mode() === 'side' && roomy.matches;

  function place() {
    const sideOn = on();
    if (sideOn && nav.parentElement !== side) side.insertBefore(nav, foot);
    if (!sideOn && nav.parentElement !== header) header.insertBefore(nav, headerSlot);
    // The ☰ goes where the window's own controls are: the title bar in
    // the app, otherwise the top of the sidebar, or the header when the
    // sidebar is hidden.
    if (!sideOn) burger.remove();
    else if (root.classList.contains('app-titlebar') || mode() === 'menu') {
      const left = header.querySelector('.header-left');
      left.insertBefore(burger, left.querySelector('.logo'));
    } else side.prepend(burger);
    // The header's ☰ was "More"; next to a real ☰ it becomes ⋯.
    const more = document.querySelector('#headerMoreBtn i');
    if (more) more.className = 'ti ' + (sideOn ? 'ti-dots' : 'ti-menu-2');
    root.classList.toggle('nav-side-on', sideOn);
    if (sideOn) document.body.classList.remove('nav-mini');
    burger.setAttribute('aria-expanded', String(inlineFull() || root.classList.contains('nav-flyout')));
    // The sliding highlight measures on resize.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function close() {
    if (!root.classList.contains('nav-flyout')) return;
    root.classList.remove('nav-flyout');
    burger.setAttribute('aria-expanded', 'false');
  }
  burger.addEventListener('click', () => {
    SFX && SFX.play('click');
    if (mode() === 'side' && roomy.matches) set('rail');
    else if (mode() === 'rail') set('side');
    else {
      root.classList.toggle('nav-flyout');
      burger.setAttribute('aria-expanded', String(root.classList.contains('nav-flyout')));
    }
  });
  // An opened-over-the-page sidebar closes once you've picked something,
  // clicked elsewhere, or pressed Escape.
  nav.addEventListener('click', e => { if (e.target.closest('.tab-nav-btn')) close(); });
  document.addEventListener('pointerdown', e => {
    if (root.classList.contains('nav-flyout') && !side.contains(e.target) && !burger.contains(e.target)) close();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  function set(v, { save = true } = {}) {
    close();
    root.setAttribute('data-nav', v);
    if (save) { try { localStorage.setItem('klabnet_nav', v); } catch (e) {} }
    place();
    document.querySelectorAll('#navStyle button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  }
  document.getElementById('navStyle')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    SFX && SFX.play('click');
    set(b.dataset.v);
  });

  desk.addEventListener('change', () => { close(); place(); });
  roomy.addEventListener('change', () => { close(); place(); });
  set(mode(), { save: false });
  return { on, set, mode };
})();

// ══════════════════════════════════════════
//  KLABNET FOR WINDOWS — what only the desktop app needs
//  (window.klabnetDesktop comes from klabnet-desktop's preload; in a
//  browser none of this does anything except offer the download.)
// ══════════════════════════════════════════
(function() {
  const app = window.klabnetDesktop;
  const root = document.documentElement;

  // A Windows browser gets "Get the Windows app" in the ☰ menu.
  const getApp = document.getElementById('getAppBtn');
  if (getApp && !app && /Windows/i.test(navigator.userAgent)) getApp.hidden = false;
  if (!app) return;

  // 1.0.x can't update itself (and has none of the bridge below), but it
  // does load this page: tell it there's a new version and hand over the
  // installer. Everything after this needs 1.1+.
  if (typeof app.getSettings !== 'function') { offerAppUpdate(app.version || '0'); return; }

  // ── The header is the title bar ──
  // Its height has to match the window buttons Windows draws (48 device
  // px), and its right end has to stop short of them. Both are in screen
  // pixels, while the page may be zoomed (html { zoom } tiers), so they're
  // converted here rather than written in CSS.
  function syncTitlebar() {
    if (!root.classList.contains('app-titlebar')) return;
    const z = zoomFactor() || 1;
    const tb = app.chrome().titlebar || 48;
    // Windows draws its buttons over the page; on Linux the header bar's
    // own buttons are part of the page, so there's nothing to leave room for.
    let controls = app.platform === 'win32' ? 144 : 0; // 3 x 46px + a little, if Windows can't say
    const wco = navigator.windowControlsOverlay;
    if (wco && wco.visible !== false) {
      const r = wco.getTitlebarAreaRect();
      if (r && r.width) controls = Math.max(0, window.innerWidth - (r.x + r.width));
    }
    // macOS: the traffic lights are on the left instead (20px in, three
    // 12px buttons 8px apart, then a gap), gone in full screen.
    const mac = app.platform === 'darwin';
    const left = mac && !root.classList.contains('app-fullscreen') ? 80 : 0;
    root.style.setProperty('--tb-h', (tb / z).toFixed(2) + 'px');
    root.style.setProperty('--wco-right', (mac ? 0 : controls / z).toFixed(2) + 'px');
    root.style.setProperty('--wco-left', (left / z).toFixed(2) + 'px');
  }
  syncTitlebar();
  window.addEventListener('resize', syncTitlebar);
  if (app.platform === 'darwin' && app.windowControls) {
    const fs = st => { root.classList.toggle('app-fullscreen', !!st?.fullscreen); syncTitlebar(); };
    app.windowControls.onState(fs);
    app.windowControls.state().then(fs).catch(() => {});
  }
  navigator.windowControlsOverlay?.addEventListener?.('geometrychange', syncTitlebar);
  document.addEventListener('DOMContentLoaded', syncTitlebar);

  // ── GNOME header bar: Adwaita's window buttons, drawn here ──
  // Placed the way GNOME's button-layout setting says (the app reads it):
  // stock GNOME is just close, on the right.
  const chrome = app.chrome();
  const wcApi = app.windowControls;
  if (chrome.headerbar && wcApi) {
    const ICONS = {
      minimize: '<svg viewBox="0 0 16 16"><rect x="4" y="10.5" width="8" height="1.5" rx=".75"/></svg>',
      maximize: '<svg viewBox="0 0 16 16"><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
      restore: '<svg viewBox="0 0 16 16"><rect x="3.75" y="6.25" width="6" height="6" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.25 4.25h4.5a1.5 1.5 0 0 1 1.5 1.5v4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      close: '<svg viewBox="0 0 16 16"><path d="M5 5l6 6m0-6l-6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    };
    const LABELS = { minimize: 'Minimize', maximize: 'Maximize', close: 'Close' };
    const ACT = { minimize: wcApi.minimize, maximize: wcApi.toggleMaximize, close: wcApi.close };
    const group = names => {
      const g = document.createElement('div');
      g.className = 'app-wc';
      for (const n of names) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'app-wc-btn';
        b.dataset.wc = n;
        b.title = LABELS[n];
        b.setAttribute('aria-label', LABELS[n]);
        b.innerHTML = ICONS[n];
        b.addEventListener('click', () => ACT[n]());
        g.appendChild(b);
      }
      return g;
    };
    if (chrome.buttons.left.length) document.querySelector('.header-left')?.prepend(group(chrome.buttons.left));
    if (chrome.buttons.right.length) document.querySelector('.header-right')?.append(group(chrome.buttons.right));
    const setMax = m => {
      root.classList.toggle('app-maximized', !!m);
      document.querySelectorAll('.app-wc-btn[data-wc="maximize"]').forEach(b => {
        b.innerHTML = m ? ICONS.restore : ICONS.maximize;
        b.title = m ? 'Restore' : 'Maximize';
        b.setAttribute('aria-label', b.title);
      });
    };
    wcApi.onState(st => setMax(st?.maximized));
    wcApi.state().then(st => setMax(st?.maximized)).catch(() => {});
  }

  // Scrolled down, the title bar gets a solid backing so the page doesn't
  // show through under it; at the top it's one surface with the page.
  const onScroll = () => root.classList.toggle('app-scrolled', window.scrollY > 2);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Settings → App ──
  const section = document.getElementById('appSettings');
  if (section) section.hidden = false;
  const $ = id => document.getElementById(id);
  let settings = null;

  function renderUpdate(u) {
    const sub = $('appVersionSub'), btn = $('appUpdateBtn');
    if (!sub || !btn || !settings) return;
    const v = `Version ${settings.version}`;
    const lines = {
      checking: [`${v} · checking for updates…`, 'Checking…', true],
      downloading: [`${v} · downloading ${u.version || 'an update'}${u.percent ? ` (${u.percent}%)` : ''}…`, 'Downloading…', true],
      ready: [`${v} · ${u.version} is ready to install`, 'Restart to update', false],
      current: [`${v} · up to date`, 'Check for updates', false],
      error: [`${v} · ${u.message || 'couldn’t check for updates'}`, 'Try again', false],
    }[u?.state] || [v, 'Check for updates', false];
    sub.textContent = lines[0];
    btn.textContent = lines[1];
    btn.disabled = lines[2];
    btn.dataset.ready = u?.state === 'ready' ? '1' : '';
  }

  function render() {
    if (!settings) return;
    $('appLoginToggle')?.classList.toggle('on', !!settings.openAtLogin);
    const mac = settings.platform === 'darwin', win = settings.platform === 'win32' || !settings.platform;
    const text = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    // klabnet-kde (the native KDE app) says shell: 'kde'.
    const kde = settings.shell === 'kde';
    text('appNameLabel', mac ? 'klabnet for Mac' : win ? 'klabnet for Windows' : kde ? 'klabnet for KDE' : 'klabnet for Linux');
    text('appLoginLabel', win ? 'Start with Windows' : mac ? 'Open at login' : 'Start when you log in');
    text('appLoginSub', mac ? 'Opens in the Dock, without a window, when you log in' : 'Opens quietly in the tray when you sign in');
    // A Mac app always keeps running when its window closes (Cmd+Q quits).
    const trayRow = $('appTrayRow');
    if (trayRow) trayRow.hidden = mac;
    // Materials: the Mac has one (the sidebar's vibrancy) or none.
    const mat = $('appMaterial');
    // KDE with the Better Blur effect: a see-through window, or none; switching restarts.
    if (mat && settings.platform === 'linux' && !mat.dataset.kde) {
      mat.dataset.kde = '1';
      mat.innerHTML = '<button type="button" data-v="blur">Blur</button><button type="button" data-v="none">Solid</button>';
      text('appMaterialSub', kde
        ? 'KWin blurs what’s behind klabnet'
        : 'Experimental: a see-through window for the Better Blur effect (add “klabnet” to its window classes). Switching restarts klabnet; if it crashes, it goes back to Solid');
    }
    // KDE with blur: the glass tint, like a terminal's background opacity.
    const tintRow = $('appTintRow');
    if (tintRow) tintRow.hidden = !(kde && settings.material === 'blur' && typeof settings.tint === 'number');
    if (typeof settings.tint === 'number' && $('appTint') && document.activeElement !== $('appTint')) {
      $('appTint').value = Math.round(settings.tint * 100);
      text('appTintVal', Math.round(settings.tint * 100) + '%');
    }
    if (mat && mac && !mat.dataset.mac) {
      mat.dataset.mac = '1';
      mat.innerHTML = '<button type="button" data-v="vibrancy">Vibrancy</button><button type="button" data-v="none">Solid</button>';
      text('appMaterialSub', 'Let the desktop show through the sidebar, like Finder');
    }
    const frameRow = $('appFrameRow');
    if (frameRow) frameRow.hidden = settings.platform !== 'linux' || kde;
    document.querySelectorAll('#appFrame button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === (settings.linuxFrame || 'auto'))));
    $('appTrayToggle')?.classList.toggle('on', !!settings.closeToTray);
    const row = $('appMaterialRow');
    if (row) row.hidden = !settings.canMaterial;
    document.querySelectorAll('#appMaterial button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === settings.material)));
    renderUpdate(settings.update);
  }

  window.syncAppSettings = async function() {
    try { settings = await app.getSettings(); } catch (e) { settings = null; }
    render();
  };

  app.onUpdateStatus(u => { if (settings) { settings.update = u; renderUpdate(u); } });

  // These toggles save through the app, not klabnet's own settings, so
  // they get their own handlers ahead of the generic .s-toggle one.
  const toggle = (id, key) => $(id)?.addEventListener('click', async e => {
    e.stopImmediatePropagation();
    SFX && SFX.play('click');
    settings = await app.setSetting(key, !settings?.[key]);
    render();
  }, true);
  toggle('appLoginToggle', 'openAtLogin');
  toggle('appTrayToggle', 'closeToTray');

  // Dragging shows it live; it's saved a moment after you stop.
  let tintTimer = 0;
  $('appTint')?.addEventListener('input', e => {
    const v = Number(e.target.value);
    document.documentElement.style.setProperty('--app-tint', v + '%');
    const out = $('appTintVal'); if (out) out.textContent = v + '%';
    clearTimeout(tintTimer);
    tintTimer = setTimeout(async () => { settings = await app.setSetting('tint', v / 100); }, 250);
  });

  $('appMaterial')?.addEventListener('click', async e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    SFX && SFX.play('click');
    // On Linux the app restarts to switch (the window can't change after
    // it's made): say so, the answer won't come.
    if (settings?.platform === 'linux' && settings.shell !== 'kde' && b.getAttribute('aria-pressed') !== 'true') $('appMaterialSub').textContent = 'Restarting klabnet…';
    settings = await app.setSetting('material', b.dataset.v);
    render();
  });

  // Linux window style: changing it restarts the app (a window's frame is
  // fixed when it's made).
  $('appFrame')?.addEventListener('click', async e => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    SFX && SFX.play('click');
    $('appFrameSub').textContent = 'Restarting klabnet…';
    await app.setSetting('linuxFrame', b.dataset.v);
  });

  $('appUpdateBtn')?.addEventListener('click', async () => {
    SFX && SFX.play('click');
    if ($('appUpdateBtn').dataset.ready) { app.installUpdate(); return; }
    renderUpdate({ state: 'checking' });
    const u = await app.checkForUpdates();
    if (settings && u && u.state !== 'idle') { settings.update = u; renderUpdate(u); }
  });
})();

// The newest klabnet for Windows, for apps too old to update themselves:
// a banner with the installer, read from the same feed 1.1+ updates from.
// "Later" puts it off for a day.
async function offerAppUpdate(current) {
  const SNOOZE_KEY = 'klabnet_app_update_snooze';
  try { if (Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0)) return; } catch (e) {}
  const newer = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  let latest = null;
  try {
    const r = await fetch('desktop/latest.yml', { cache: 'no-store' });
    if (r.ok) latest = (/^version:\s*(\S+)/m.exec(await r.text()) || [])[1] || null;
  } catch (e) {}
  if (!latest || !newer(latest, current)) return;

  const el = document.createElement('div');
  el.className = 'app-update-banner';
  el.setAttribute('role', 'status');
  el.innerHTML =
    '<i class="ti ti-download"></i>' +
    '<div class="aub-tx"><b></b><span>A proper Windows 11 app: the title bar, Mica, a jump list, and it updates itself from now on.</span></div>' +
    '<div class="aub-btns"><button type="button" class="aub-later">Later</button><button type="button" class="aub-get">Get it</button></div>';
  el.querySelector('b').textContent = `klabnet for Windows ${latest} is out`;
  el.querySelector('.aub-later').addEventListener('click', () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 3600 * 1000)); } catch (e) {}
    el.remove();
  });
  el.querySelector('.aub-get').addEventListener('click', () => {
    // 1.0 opens anything in a new window in the real browser, where the
    // download lands like any other.
    window.open(new URL('desktop/klabnet-setup.exe', location.href).href, '_blank');
    el.querySelector('span').textContent = 'It’s downloading in your browser. Run klabnet-setup.exe when it’s done: it replaces this version and opens the new one.';
    el.querySelector('.aub-get').remove();
    el.querySelector('.aub-later').textContent = 'Done';
  });
  document.body.appendChild(el);
}
