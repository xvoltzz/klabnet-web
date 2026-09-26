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
  if (key === 'chat' && typeof _chatActiveRoomId !== 'undefined' && _chatActiveRoomId && typeof markRoomRead === 'function') {
    markRoomRead(_chatActiveRoomId);
  }
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
    afterSwitchPaints(renderTimeline);
  }
  if (location.hash.slice(1) !== key) location.hash = key;
  // Landing on Music directly (deep link, reload, or a nav-bar click — not
  // just via openPicker()) still needs its content fetched the first time.
  if (key === 'music' && typeof ensureMusicTabLoaded === 'function') afterSwitchPaints(ensureMusicTabLoaded);
}


function initTabs() {
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tabTarget));
  });
  window.addEventListener('hashchange', () => setActiveTab(location.hash.slice(1) || 'home'));
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
  const touchPhone = matchMedia('(max-width: 760px) and (pointer: coarse)');
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
  const phone = matchMedia('(max-width: 760px)');
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
  const desk = matchMedia('(min-width: 761px)');
  const nav = document.getElementById('tabNav');
  if (!nav) return;
  const IDLE_MS = 4000;
  let timer = 0, lastCheck = 0;
  function arm() {
    clearTimeout(timer);
    if (!desk.matches) return;
    timer = setTimeout(() => {
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
    if (e.key === 'Tab' || /^[1-9]$/.test(e.key)) open();
  }, true);
  nav.addEventListener('focusin', open);
  window.addEventListener('hashchange', open);
  desk.addEventListener('change', () => { document.body.classList.remove('nav-mini'); arm(); });
  arm();
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
    root.style.setProperty('--tb-h', (tb / z).toFixed(2) + 'px');
    root.style.setProperty('--wco-right', (controls / z).toFixed(2) + 'px');
  }
  syncTitlebar();
  window.addEventListener('resize', syncTitlebar);
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
    const loginLabel = $('appLoginLabel');
    if (loginLabel) loginLabel.textContent = settings.platform === 'win32' || !settings.platform ? 'Start with Windows' : 'Start when you log in';
    const frameRow = $('appFrameRow');
    if (frameRow) frameRow.hidden = settings.platform !== 'linux';
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

  $('appMaterial')?.addEventListener('click', async e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    SFX && SFX.play('click');
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
