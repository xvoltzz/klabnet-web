// ══════════════════════════════════════════
//  TAB NAV — Home / Social / Music router
//  Hash-based so tabs are bookmarkable and back/forward works. The floating
//  player dock lives outside every .tab-panel, so it's unaffected by any of
//  this and keeps playing/visible across tab switches.
// ══════════════════════════════════════════
const TABS = ['home', 'social', 'feed', 'chat', 'music', 'photos'];
// Social is one page with a sidebar, like Music, holding its own home, Feed,
// Chat and Photos. Each of those is still a tab of its own here (its own
// panel, hash, body class and Back entry), so everything that sends you to
// one keeps working; the app's nav has one Social button for the four, and
// it lands on Social's home.
const TAB_GROUP = { social: 'social', feed: 'social', chat: 'social', photos: 'social' };
// The pages the app's nav (and Tab, and 1–3) go between.
const topTab = key => TAB_GROUP[key] || key;

// Native switches handle Space/Enter. Mirror the existing class-based
// settings updates in their accessible state, including desktop callbacks.
document.querySelectorAll('#settingsBackdrop button.s-toggle').forEach(button => {
  const label = button.closest('.settings-row')?.querySelector('.settings-row-label');
  if (label) { label.id ||= button.id + 'Label'; button.setAttribute('aria-labelledby', label.id); }
  const sync = () => button.setAttribute('aria-checked', String(button.classList.contains('on')));
  sync();
  new MutationObserver(sync).observe(button, { attributes: true, attributeFilter: ['class'] });
});

// Heavy per-tab setup waits until the switch itself has reached the screen,
// so the tab highlight and the panel's fade start moving straight away
// instead of after that work. The panel fades in from transparent, so a
// frame of not-yet-updated content is never visible.
function afterSwitchPaints(fn) { requestAnimationFrame(() => setTimeout(fn, 0)); }

// A page whose nav button is hidden is off: Tab, the number keys, hashes
// and `cd` all leave it out.
function isTabEnabled(key) {
  const btn = document.querySelector(`.tab-nav-btn[data-tab-target="${topTab(key)}"]`);
  return !!btn && !btn.hidden;
}

// Where each tab was scrolled to. Home scrolls the window, which the other
// tabs share (and Chat pins to 0), so coming back used to land at the top:
// 40 posts down, a quick reply in Chat, and the place was lost. Social's
// home and Feed scroll inside the page, beside its sidebar, and a panel
// that's been hidden comes back scrolled to the top, so those are kept too.
const _tabScroll = {};
const PANEL_SCROLLS = new Set(['social', 'feed']);
const tabPanel = key => document.querySelector(`.tab-panel[data-tab-panel="${key}"]`);
function setActiveTab(key) {
  if (!TABS.includes(key) || !isTabEnabled(key)) key = 'home';
  const leaving = document.querySelector('.tab-panel.active')?.dataset.tabPanel;
  if (leaving && leaving !== key) _tabScroll[leaving] = PANEL_SCROLLS.has(leaving) ? tabPanel(leaving).scrollTop : window.scrollY;
  // Captured before the tab-panel/body-class toggles below — used further
  // down to detect "just arrived on Chat" vs. "already there".
  const enteringChat = key === 'chat' && !document.body.classList.contains('tab-chat-active');
  document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tabTarget === topTab(key)));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === key));
  // Social's sidebar: the row for the page you're on.
  document.querySelectorAll('#socNav [data-soc], .hdr-pagenav [data-soc]').forEach(b => b.classList.toggle('active', b.dataset.soc === key));
  document.body.classList.toggle('tab-social-group', topTab(key) === 'social');
  document.body.classList.toggle('tab-social-active', key === 'social');
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
  // Before the paint, so it never shows at the wrong spot first. Something
  // that jumps to a particular post (klabFeedFocus) scrolls after this.
  if (leaving !== key) {
    if (PANEL_SCROLLS.has(key)) { window.scrollTo(0, 0); tabPanel(key).scrollTop = _tabScroll[key] || 0; }
    else window.scrollTo(0, _tabScroll[key] || 0);
  }
  if (typeof window.klabSocialTabChanged === 'function') { const on = key === 'social'; afterSwitchPaints(() => window.klabSocialTabChanged(on)); }
  if (typeof window.klabHomeTabChanged === 'function') { const on = key === 'home'; afterSwitchPaints(() => window.klabHomeTabChanged(on)); }
  // Photos starts/stops its song clips and refits its stage (which had no
  // size while hidden). Nothing is fetched here: the tab loads in the background.
  if (key === 'feed' && typeof window.klabFeedShown === 'function') afterSwitchPaints(window.klabFeedShown);
  // Voice's channels show on Chat: who's in them, fresh, not up to 30s old.
  if (key === 'chat' && enteringChat) afterSwitchPaints(() => window.klabVoice?.refresh());
  if (typeof window.klabPhotosTabChanged === 'function') { const on = key === 'photos'; afterSwitchPaints(() => window.klabPhotosTabChanged(on)); }
  if (typeof window.klabMusicTabChanged === 'function') { const on = key === 'music'; afterSwitchPaints(() => window.klabMusicTabChanged(on)); }
  // The header prompt cds into this page ("cd feed", then klabnet/feed>;
  // see retypePrompt()), so the page needn't spend a row on its own title
  // (the owner: use the top bar, save space).
  if (typeof retypePrompt === 'function') retypePrompt(klabPromptFor(key));
  window.klabHeaderSearch?.(key);
  // Feed's mentions button sits in the title bar while Feed is up.
  const mBtn = document.getElementById('feedMentionsBtn'), hdrR = document.querySelector('.header-right');
  if (mBtn && hdrR) {
    if (key === 'feed' && mBtn.parentElement !== hdrR) { hdrR.prepend(mBtn); mBtn.classList.add('hdr-btn'); }
    else if (key !== 'feed' && mBtn.parentElement === hdrR) { document.querySelector('.sec[data-sec="feed"] > .sec-head')?.appendChild(mBtn); mBtn.classList.remove('hdr-btn'); }
  }
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
  if (window.klabNav?.tab) window.klabNav.tab(key);
  else if (was !== key) {
    if (TABS.includes(was)) location.hash = key;
    else history.replaceState(history.state, '', '#' + key);
  }
  // Record the tab before its phone list/conversation descriptor. Doing
  // this before the hash switch stamped Chat onto the previous tab.
  if (enteringChat && typeof setChatMobileView === 'function') setChatMobileView('rooms');
  // Landing on Music directly (deep link, reload, or a nav-bar click — not
  // just via openPicker()) still needs its content fetched the first time.
  if (key === 'music' && typeof ensureMusicTabLoaded === 'function') afterSwitchPaints(ensureMusicTabLoaded);
}


function initTabs() {
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.tabTarget;
      // A page's row always goes to its front page (the owner, 2026-11-02),
      // not back to where you were in it.
      setActiveTab(key);
    });
  });
  // On each row, not delegated: in a wide window they live in the main sidebar.
  document.querySelectorAll('#socNav [data-soc]').forEach(b => b.addEventListener('click', e => {
    SFX && SFX.play('click'); setActiveTab(b.dataset.soc);
  }));
  // A click already switched; the hash it set shouldn't do it all again.
  window.addEventListener('hashchange', () => {
    const key = location.hash.slice(1) || 'home';
    if (document.querySelector(`.tab-panel[data-tab-panel="${CSS.escape(key)}"]`)?.classList.contains('active')) return;
    setActiveTab(key);
  });
  setActiveTab(location.hash.slice(1) || 'home');
}
// initTabs() runs from js/09-music-extras.js: if anything before it threw
// while starting up, no page was ever shown, and klabnet sat empty until a
// tab was pressed. Once everything has loaded, make sure one is.
window.addEventListener('load', () => {
  if (document.querySelector('.tab-panel.active')) return;
  console.warn('klabnet: no page was shown at start; showing one now');
  try { setActiveTab(location.hash.slice(1) || 'home'); } catch (e) { console.error(e); }
}, { once: true });

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
  syncOledRow();
  syncGifsRow();
  syncGlassRow();
  syncThemeRow();
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


// Away status: the desktop app knows when the computer's in use; Chrome
// can too, once the site's allowed to (Idle Detection). Other browsers
// only see klabnet's own window, which can't tell away from busy elsewhere.
async function syncAwayRow() {
  const row = document.getElementById('awayRow');
  if (!row) return;
  const app = !!window.klabnetDesktop?.idle, chrome = !window.klabnetDesktop && 'IdleDetector' in window;
  row.hidden = !app && !chrome;
  if (row.hidden) return;
  // The app can't tell on Wayland (it says null): no switch that can't work.
  if (app) { try { if ((await window.klabnetDesktop.idle()) == null) { row.hidden = true; return; } } catch (e) {} }
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

// OLED black: html.oled (applied at load by the <head> script). It's a
// dark-theme look, so turning it on switches to the dark theme.
function syncOledRow() {
  const t = document.getElementById('oledToggle');
  if (!t) return;
  const on = document.documentElement.classList.contains('oled');
  t.classList.toggle('on', on);
  t.setAttribute('aria-checked', String(on));
}
document.getElementById('oledToggle')?.addEventListener('click', e => {
  e.stopImmediatePropagation();
  SFX && SFX.play('click');
  _settings.oled = !document.documentElement.classList.contains('oled');
  saveSettings();
  document.documentElement.classList.toggle('oled', _settings.oled);
  if (_settings.oled && currentTheme !== 'dark') applyTheme('dark');
  syncOledRow();
}, true);

// GIFs: the buttons only (html.gifs-on, applied at load by the <head>
// script); GIFs already in posts and messages show either way.
function syncGifsRow() {
  const on = !!_settings.gifs, t = document.getElementById('gifsToggle');
  document.documentElement.classList.toggle('gifs-on', on);
  if (t) { t.classList.toggle('on', on); t.setAttribute('aria-checked', String(on)); }
}
document.getElementById('gifsToggle')?.addEventListener('click', e => {
  e.stopImmediatePropagation();
  SFX && SFX.play('click');
  _settings.gifs = !_settings.gifs;
  saveSettings();
  if (!_settings.gifs) window.klabGifPicker?.close();
  syncGifsRow();
}, true);

// Window glass: html.glass-aero (applied at load by the <head> script).
// Only where the window itself is glass: the Linux app, for now.
function syncGlassRow() {
  const row = document.getElementById('glassRow');
  if (!row) return;
  const r = document.documentElement;
  row.hidden = !(r.classList.contains('app-material') && r.dataset.desktop === 'linux');
  const v = r.classList.contains('glass-aero') ? 'aero' : 'frost';
  row.querySelectorAll('button[data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
}
document.getElementById('glassStyle')?.addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  SFX && SFX.play('click');
  _settings.glass = b.dataset.v;
  saveSettings();
  document.documentElement.classList.toggle('glass-aero', b.dataset.v === 'aero');
  syncGlassRow();
});

// Theme, here since it left the title bar.
function syncThemeRow() {
  document.querySelectorAll('#themeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === currentTheme)));
  const get = document.getElementById('getAppBtn'), row = document.getElementById('settingsGetApp');
  if (row) row.hidden = !get || get.hidden;
}
document.getElementById('themeSeg')?.addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b || b.dataset.v === currentTheme) return;
  SFX && SFX.play('click');
  applyTheme(b.dataset.v);
  syncThemeRow();
});
// What the ⋯ menu held: each row presses the menu's own item.
document.querySelectorAll('.settings-link[data-press]').forEach(row => row.addEventListener('click', () => {
  const t = document.getElementById(row.dataset.press);
  if (!t) return;
  if (row.dataset.press === 'keyHintsBtn' || row.dataset.press === 'feedbackBtn') closeSettings?.();
  t.click();
}));

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
  // And the Navigation choice made in this same panel, and what the sync
  // thought the server had.
  localStorage.removeItem('klabnet_nav');
  localStorage.removeItem('klabnet_nav_w');
  document.documentElement.style.removeProperty('--nav-side-w');
  localStorage.removeItem('klabnet_prefs_base');
  localStorage.removeItem('klabnet_voice'); // microphone, push to talk (js/22-voice.js)
  // Clear server prefs
  try {
    await fetchTimeout('/api/prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }, 8000);
  } catch(e) {}
  showToast('Preferences reset. Reloading…', 'ti-restore');
  setTimeout(() => location.reload(), 1500);
});

// Header overflow ("more") menu — toggled by its own button, closed by an
// outside click, Escape, or clicking any item inside it (
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
  document.getElementById('menuPlayer')?.addEventListener('click', () => window.klabTogglePlayer?.());
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
  if (e.target === document.getElementById('settingsBackdrop') && klabPressedOn(e.target)) closeSettings();
});
// Had click-outside but no Escape — every other backdrop-modal in the app
// already closes on Escape, this one just got missed.
document.addEventListener('keydown', e => {
  // Not under a dialog opened from here (the background colours, "Reset?"):
  // Escape closed that and Settings with it.
  if (e.key === 'Escape' && document.getElementById('settingsBackdrop').classList.contains('open')
      && !document.querySelector('.add-app-backdrop.open, .img-view-backdrop.open, .klab-menu.visible')) closeSettings();
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
  const brand = header.querySelector('.header-left');

  const side = document.createElement('aside');
  side.className = 'side-nav';
  side.id = 'sideNav';
  side.setAttribute('aria-label', 'Navigation');
  const foot = document.createElement('div');
  foot.className = 'side-nav-foot';
  // "Get the app" for a computer's browser (not inside the app, not a phone):
  // the /desktop/ page, which works out which download is yours.
  const browserOnComputer = !window.klabnetDesktop && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  foot.innerHTML = (browserOnComputer ? '<button type="button" class="side-nav-item" id="sideNavGetApp" title="klabnet for Windows, macOS and Linux"><i class="ti ti-download"></i><span>Get the app</span></button>' : '') +
    '<button type="button" class="side-nav-item" id="sideNavFeedback" title="Report a bug or suggest an idea"><i class="ti ti-message-dots"></i><span>Feedback</span></button>' +
    '<button type="button" class="side-nav-item" id="sideNavSettings" title="Settings"><i class="ti ti-settings"></i><span>Settings</span></button>';
  side.appendChild(foot);
  document.body.appendChild(side);
  foot.querySelector('#sideNavSettings').addEventListener('click', () => { close(); document.getElementById('settingsBtn')?.click(); });
  foot.querySelector('#sideNavFeedback').addEventListener('click', () => { close(); window.openFeedbackModal?.(); });
  foot.querySelector('#sideNavGetApp')?.addEventListener('click', () => { location.href = 'desktop/'; });

  const burger = document.createElement('button');
  burger.type = 'button';
  burger.className = 'hdr-btn nav-burger';
  burger.id = 'navBurger';
  burger.title = 'Navigation';
  burger.setAttribute('aria-label', 'Navigation');
  burger.innerHTML = '<i class="ti ti-menu-2"></i>';

  // Two states (the owner, 2026-10-31: an icons-only sidebar was
  // awkward): open with names ("side"), or hidden ("menu"), the page then
  // taking the whole window. Hidden, it slides out over the page from the
  // window's left edge or ☰. html[data-nav] is what's shown; `want` is
  // what you chose. A small window always hides it.
  const mode = () => root.getAttribute('data-nav') || 'side';
  let want = mode() === 'menu' ? 'menu' : 'side';
  try { if (localStorage.getItem('klabnet_nav') === 'menu') want = 'menu'; } catch (e) {}
  const on = () => desk.matches && mode() !== 'top';
  // Showing names inline, or only icons (or nothing) with the full
  // sidebar a click away over the page.
  const inlineFull = () => mode() === 'side' && roomy.matches;

  function place() {
    const sideOn = on();
    if (sideOn && nav.parentElement !== side) side.insertBefore(nav, foot);
    if (!sideOn && nav.parentElement !== header) header.insertBefore(nav, headerSlot);
    // In a browser the header becomes a bar across the top, like the apps'
    // title bar: ☰, the mark and the prompt typing the MOTD on the left,
    // the buttons on the right, and the sidebar under it.
    const bar = sideOn && !root.classList.contains('klabnet-app');
    root.classList.toggle('web-bar', bar);
    // The ☰ goes where the window's own controls are: the title bar in
    // the app, otherwise the top of the sidebar, or the header when the
    // sidebar is hidden.
    // The tucked-away player, and voice while you're in a channel: the
    // foot of the sidebar (voice on top), or the header.
    ['dockPeek', 'voiceMicBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (sideOn && el.parentElement !== foot) foot.prepend(el);
      if (!sideOn && el.parentElement !== headerSlot) headerSlot.insertBefore(el, document.getElementById('themeToggle'));
      el.classList.toggle('side-nav-item', sideOn);
      el.classList.toggle('hdr-btn', !sideOn);
    });
    if (!sideOn) burger.remove();
    else if (root.classList.contains('app-titlebar') || bar || mode() === 'menu') {
      brand.insertBefore(burger, brand.querySelector('.logo'));
    } else side.prepend(burger);
    // The header's ☰ was "More"; next to a real ☰ it becomes ⋯.
    const more = document.querySelector('#headerMoreBtn i');
    if (more) more.className = 'ti ' + (sideOn ? 'ti-dots' : 'ti-menu-2');
    root.classList.toggle('nav-side-on', sideOn);
    burger.setAttribute('aria-expanded', String(inlineFull() || root.classList.contains('nav-flyout')));
    burger.title = (mode() === 'menu' ? 'Show sidebar' : 'Hide sidebar') + ' (b)';
    // The sliding highlight measures on resize.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function close() {
    clearTimeout(peekT);
    peeking = false;
    if (!root.classList.contains('nav-flyout')) return;
    root.classList.remove('nav-flyout');
    burger.setAttribute('aria-expanded', 'false');
  }
  let peekT = 0, peeking = false;
  burger.addEventListener('click', () => {
    SFX && SFX.play('click');
    // With room: hide it, or bring it back for good. In a small window:
    // open it over the page, and close it again.
    if (roomy.matches) set(want === 'side' ? 'menu' : 'side');
    else {
      root.classList.toggle('nav-flyout');
      burger.setAttribute('aria-expanded', String(root.classList.contains('nav-flyout')));
    }
  });
  // An opened-over-the-page sidebar closes once you've picked something,
  // clicked elsewhere, or pressed Escape.
  // A section, playlist or conversation counts too (they're rows inside
  // #tabNav): picking one left the sidebar over the page.
  nav.addEventListener('click', e => { if (e.target.closest('.tab-nav-btn, .nav-sub :is(.picker-tab, .chat-conv, .music-playlist-row)')) close(); });
  document.addEventListener('pointerdown', e => {
    if (root.classList.contains('nav-flyout') && !side.contains(e.target) && !burger.contains(e.target)) close();
  }, true);
  // Escape that a dialog or menu already used isn't for the sidebar; Tab
  // and the number keys change page, which the sidebar was for.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented) close();
    else if (/^[1-9]$|^Tab$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.composedPath()[0]?.closest?.('input, textarea, select, [contenteditable]')) close();
  });

  // The sidebar opening or folding: its width animates (the CSS), and the
  // page beside it takes its new place at once, then slides there from
  // where it was, on the same curve. A slide is drawn on the GPU; easing
  // the page's padding re-flowed every grid on it, frame by frame.
  function slidePage(change) {
    const els = [document.querySelector('.dash-body'), document.getElementById('playerDock')]
      .filter(el => el && el.getClientRects().length);
    const before = els.map(el => el.getBoundingClientRect().left);
    change();
    if (!(window.klabMotionOk?.() ?? true)) return;
    const z = typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1;
    els.forEach((el, i) => {
      const dx = (before[i] - el.getBoundingClientRect().left) / z;
      if (Math.abs(dx) < 1) return;
      el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }
  function set(v, { save = true } = {}) {
    close();
    if (save && v !== mode()) { slidePage(() => apply(v, save)); return; }
    apply(v, save);
  }
  function apply(v, save) {
    want = v === 'menu' ? 'menu' : 'side'; // (no tabs in the header, no icons-only rail)
    if (save) { try { localStorage.setItem('klabnet_nav', want); } catch (e) {} }
    v = roomy.matches ? want : 'menu';
    root.setAttribute('data-nav', v);
    place();
  }

  // The bar gets a backing once the page scrolls under it, only while the
  // sidebar is hidden (the owner: with it open, the bar and the sidebar are
  // one frame and stay so). The app's title bar does the same.
  const scrolled = () => {
    if (!root.classList.contains('web-bar') && !root.classList.contains('app-titlebar')) return;
    const on = window.scrollY > 2 && root.dataset.nav !== 'side';
    if (root.classList.contains('app-scrolled') !== on) root.classList.toggle('app-scrolled', on);
  };
  window.addEventListener('scroll', scrolled, { passive: true });
  new MutationObserver(scrolled).observe(root, { attributes: true, attributeFilter: ['data-nav'] });

  desk.addEventListener('change', () => { close(); place(); });
  roomy.addEventListener('change', () => { close(); apply(want, false); });
  set(want, { save: false });

  // ── Peeking ──
  // Hidden, the sidebar slides out over the page while the pointer rests
  // on the window's left edge, and goes again when it leaves the sidebar.
  // A click inside (a page, a section) takes you there and it goes.
  const edge = document.createElement('div');
  edge.className = 'side-nav-edge';
  edge.setAttribute('aria-hidden', 'true');
  document.body.appendChild(edge);
  edge.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse' || mode() !== 'menu' || !on()) return;
    clearTimeout(peekT);
    peekT = setTimeout(() => {
      if (root.classList.contains('nav-flyout')) return;
      peeking = true;
      root.classList.add('nav-flyout');
      burger.setAttribute('aria-expanded', 'true');
    }, 110);
  });
  edge.addEventListener('pointerleave', () => { if (!peeking) clearTimeout(peekT); });
  side.addEventListener('pointerenter', () => { if (peeking) clearTimeout(peekT); });
  side.addEventListener('pointerleave', e => {
    if (!peeking || side.contains(e.relatedTarget) || edge === e.relatedTarget) return;
    clearTimeout(peekT);
    // Kept only while you're typing in it (its search box); a row you
    // clicked keeps focus and held it open until a click elsewhere.
    peekT = setTimeout(() => { if (peeking && !side.matches(':hover') && !side.querySelector('input:focus')) close(); }, 320);
  });

  // ── Dragging its edge ──
  // Wider or narrower (180–420px, kept); dragged well past its narrowest,
  // it hides, like Finder's. Only where it sits beside the page.
  const grip = document.createElement('div');
  grip.className = 'side-nav-grip';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', 'Sidebar width');
  grip.title = 'Drag to resize · double-click to reset';
  document.body.appendChild(grip);
  const W_MIN = 180, W_MAX = 420, W_HIDE = 110;
  const zf = () => (typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1);
  let drag = null, raf = 0;
  const setW = w => root.style.setProperty('--nav-side-w', Math.round(w) + 'px');
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !roomy.matches) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const w0 = side.getBoundingClientRect().width / zf();
    drag = { x: e.clientX, w0, w: w0 };
    root.classList.add('nav-resizing');
  });
  grip.addEventListener('pointermove', e => {
    if (!drag) return;
    const w = drag.w0 + (e.clientX - drag.x) / zf();
    drag.w = w;
    if (w < W_HIDE) { endDrag(); set('menu'); SFX && SFX.play('click'); return; }
    setW(Math.max(W_MIN, Math.min(W_MAX, w)));
    // The sliding highlights and anything else that measures.
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.dispatchEvent(new Event('resize')); });
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    root.classList.remove('nav-resizing');
    const w = parseInt(getComputedStyle(root).getPropertyValue('--nav-side-w'), 10);
    if (w) { try { localStorage.setItem('klabnet_nav_w', String(w)); } catch (e) {} }
    window.dispatchEvent(new Event('resize'));
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('dblclick', () => {
    root.style.removeProperty('--nav-side-w');
    try { localStorage.removeItem('klabnet_nav_w'); } catch (e) {}
    window.dispatchEvent(new Event('resize'));
  });

  // (It used to fold to its icons by itself on a page with a sidebar of
  // its own, and open again when that one closed. The owner: each sidebar
  // stays as you leave it.)
  return { on, set, mode, want: () => want };
})();

// ══════════════════════════════════════════
//  HIDING A PAGE'S SIDEBAR
//  Music and Social each have a sidebar of their own beside the
//  page. A button at the sidebar's foot (and "b") folds it down to its
//  icons, like the main sidebar's rail, with the button in the same place,
//  and opens it again, so a small window can be all music, or all
//  conversation, and still get around. (It was in the header and hid the
//  sidebar outright; the owner wanted it in the sidebar, 2026-10-31.) Kept per page
//  and per device: html.pane-off-<page>, set in <head> from localStorage
//  and laid out by the CSS. Phones have no sidebars to hide.
// ══════════════════════════════════════════
window.klabPane = (function() {
  const root = document.documentElement;
  const btn = document.getElementById('paneToggle');
  if (!btn) return null;
  const KEY = 'klabnet_pane_off';
  // Each page's sidebar, where that page lays it out as one, and the body
  // class that says you're on it (Social's is all four of its pages).
  const PANES = {
    music:  { el: 'musicSidebar', search: '.picker-search', mq: matchMedia(KLAB_DESK_MQ), on: 'tab-music-active' },
    social: { el: 'socSidebar',   search: '.soc-search',    mq: matchMedia(KLAB_DESK_MQ), on: 'tab-social-group' },
  };
  // (With everything in the main sidebar, no page has one of its own.)
  const page = () => Object.keys(PANES).find(t => document.body.classList.contains(PANES[t].on) && PANES[t].mq.matches
    && !root.classList.contains('nav-tree')) || null;
  const hidden = t => root.classList.contains('pane-off-' + t);
  // Each sidebar's foot, which the one button moves between.
  for (const [t, p] of Object.entries(PANES)) {
    const side = document.getElementById(p.el);
    if (!side) continue;
    p.foot = document.createElement('div');
    p.foot.className = 'pane-foot';
    side.append(p.foot);
    // Folded, a row is only its icon: it says what it is on hover. Asked
    // as the pointer arrives, since chat's rows are rebuilt all the time.
    side.addEventListener('pointerover', e => {
      if (!hidden(t)) return;
      const row = e.target.closest('.picker-tab, .chat-conv, .music-playlist-row');
      if (!row || row.title) return;
      const name = row.querySelector('.chat-channel-name, .music-playlist-row-name, span:not(.soc-dot):not(.soc-count):not(:empty)');
      if (name) row.title = name.textContent.trim();
    });
    // Folded, the search is its icon. Its box is still there, unseen, so
    // a click on the icon (or anything that focuses the search) lands in
    // it, and it pops out over the page until you're done with it.
    const search = p.search && side.querySelector(':scope > ' + p.search);
    if (!search) continue;
    p.searchEl = search;
    search.addEventListener('click', () => { if (hidden(t)) search.querySelector('input')?.focus(); });
    search.addEventListener('focusin', () => { if (hidden(t)) search.classList.add('pop'); });
    search.addEventListener('focusout', e => { if (!search.contains(e.relatedTarget)) search.classList.remove('pop'); });
    search.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !search.classList.contains('pop')) return;
      e.stopPropagation();
      document.activeElement?.blur();
    });
  }
  btn.classList.replace('hdr-btn', 'pane-btn');

  function sync() {
    const t = page();
    btn.hidden = !t;
    if (!t) return;
    if (PANES[t].foot && btn.parentElement !== PANES[t].foot) PANES[t].foot.append(btn);
    const off = hidden(t);
    btn.setAttribute('aria-pressed', String(!off));
    btn.title = (off ? 'Show sidebar' : 'Hide sidebar') + ' (b)';
    btn.firstElementChild.className = 'ti ' + (off ? 'ti-layout-sidebar-left-expand' : 'ti-layout-sidebar-left-collapse');
  }

  // Hiding: the sidebar's contents fade and slide out, then what's beside
  // it glides over into the room. Showing: it glides aside as they slide
  // in. The button stays put throughout.
  // The content takes its new place at once and slides there from where
  // it was (a transform), so nothing re-flows frame by frame.
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  let busy = false;
  function glide(el, change) {
    const beside = el ? [...el.parentElement.children].filter(c => c !== el && c.getClientRects().length) : [];
    const before = beside.map(c => c.getBoundingClientRect().left);
    change();
    const z = typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1;
    beside.forEach((c, i) => {
      const dx = (before[i] - c.getBoundingClientRect().left) / z;
      if (Math.abs(dx) > 1) c.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 280, easing: EASE });
    });
  }
  function apply(t, off) {
    root.classList.toggle('pane-off-' + t, off);
    PANES[t].searchEl?.classList.remove('pop');
    try { localStorage.setItem(KEY, JSON.stringify(Object.keys(PANES).filter(hidden))); } catch (e) {}
    sync();
    // The sliding highlights and the photo measure on resize.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  function set(t, off) {
    if (!PANES[t] || hidden(t) === off || busy) return;
    const el = document.getElementById(PANES[t].el);
    // (A hidden sidebar has no box yet: its page being up is what counts.)
    const motion = !!el && page() === t && (window.klabMotionOk?.() ?? true);
    if (!motion) { apply(t, off); return; }
    const parts = () => [...el.children].filter(c => c !== PANES[t].foot && c.getClientRects().length);
    if (off) {
      busy = true;
      const out = parts();
      Promise.all(out.map(c => c.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '-12px 0' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).finished))
        .catch(() => {}).then(() => {
          glide(el, () => apply(t, true));
          out.forEach(c => c.getAnimations().forEach(a => a.cancel()));
          // The icons it folds down to come in after.
          parts().forEach(c => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }));
          busy = false;
        });
    } else {
      glide(el, () => apply(t, false));
      parts().forEach(c => c.animate([{ opacity: 0, translate: '-12px 0' }, { opacity: 1, translate: '0 0' }], { duration: 280, easing: EASE }));
    }
  }
  // True when there was a sidebar to toggle.
  function toggle() {
    const t = page();
    if (t) set(t, !hidden(t));
    return !!t;
  }

  btn.addEventListener('click', () => { SFX && SFX.play('click'); toggle(); });
  // The page changed (setActiveTab's body classes), or the layout did.
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
  Object.values(PANES).forEach(p => p.mq.addEventListener('change', sync));
  sync();
  return { toggle, show: t => set(t, false), hide: t => set(t, true), hidden };
})();

// ══════════════════════════════════════════
//  KLABNET FOR WINDOWS — what only the desktop app needs
//  (window.klabnetDesktop comes from klabnet-desktop's preload; in a
//  browser none of this does anything except offer the download.)
// ══════════════════════════════════════════
(function() {
  const app = window.klabnetDesktop;
  const root = document.documentElement;

  // A computer's browser gets "Get the desktop app" (the /desktop/ page)
  // in the ☰ menu and Settings; phones and the apps themselves don't.
  const getApp = document.getElementById('getAppBtn');
  if (getApp && !app && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))) getApp.hidden = false;
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

  // ── Linux header bar: the window buttons, drawn here ──
  // Placed the way the desktop's button layout says (the app reads it).
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

  // Scrolled down with the sidebar hidden, the title bar gets a backing
  // (the sidebar's scroll handler, above, does it for the app too).

  // ── Settings → App ──
  const section = document.getElementById('appSettings');
  if (section) section.hidden = false;
  const $ = id => document.getElementById(id);
  let settings = null;

  function renderUpdate(u) {
    const sub = $('appVersionSub'), btn = $('appUpdateBtn');
    if (!sub || !btn || !settings) return;
    u = u || {};
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
    // klabnet-kde (the native Linux app, on any desktop) says shell: 'kde'.
    const kde = settings.shell === 'kde';
    text('appNameLabel', mac ? 'klabnet for Mac' : win ? 'klabnet for Windows' : 'klabnet for Linux');
    text('appLoginLabel', win ? 'Start with Windows' : mac ? 'Open at login' : 'Start when you log in');
    text('appLoginSub', mac ? 'Opens in the Dock, without a window, when you log in' : 'Opens quietly in the tray when you sign in');
    // A Mac app always keeps running when its window closes (Cmd+Q quits).
    const trayRow = $('appTrayRow');
    if (trayRow) trayRow.hidden = mac;
    // Materials: the Mac has one (the sidebar's vibrancy) or none.
    const mat = $('appMaterial');
    // The native app switches live. klabnet-desktop on KDE with the Better
    // Blur effect: a see-through window, or none; switching restarts.
    if (mat && settings.platform === 'linux' && !mat.dataset.kde) {
      mat.dataset.kde = '1';
      mat.innerHTML = '<button type="button" data-v="blur">Blur</button><button type="button" data-v="none">Solid</button>';
      text('appMaterialSub', kde
        ? (settings.desktop === 'kde' ? 'KWin blurs what’s behind klabnet' : 'A see-through window: your compositor blurs what’s behind klabnet')
        : 'Experimental: a see-through window for the Better Blur effect (add “klabnet” to its window classes). Switching restarts klabnet; if it crashes, it goes back to Solid');
    }
    // The native app with blur: the glass tint, like a terminal's background opacity.
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

// ══════════════════════════════════════════
//  ONE PLACE TO GET AROUND (2026-10-31)
//  The owner found the title bar's row of section words beside the
//  sidebar awkward, and asked for navigation that feels obvious. So each
//  kind of thing has one home, the same on every page:
//    · Where you can go is the sidebar. The page you're on unfolds its
//      sections under its own row (Social: Home, Feed, Photos, Chat;
//      Music: Home… Requests and your playlists), the
//      way Finder's and Music's sidebars do. Only one row in the whole
//      sidebar is highlighted: the section you're on.
//    · Where you are is the prompt in the title bar (klabnet/feed>).
//    · Finding something is the search box in the middle of the title
//      bar, on pages that have one.
//    · A page's own lists (Chat's conversations, a photo's details) stay
//      in that page's sidebar, which only shows where it has some.
//  Chat's conversations and Photos' details come along too, under
//  Social's sections while you're on Chat or Photos (like Slack's
//  sidebar), so there's never a second sidebar beside this one.
//  The rows move with their handlers, and go back to their page's own
//  sidebar only with Navigation: Menu and on a phone.
// ══════════════════════════════════════════
(function () {
  const header = document.querySelector('.header');
  const tabNav = document.getElementById('tabNav');
  if (!header || !tabNav) return;
  const root = document.documentElement;
  const desk = matchMedia(KLAB_DESK_MQ);
  const roomy = matchMedia('(min-width: 1100px)');
  const PAGES = [
    { tab: 'social', pages: ['social', 'feed', 'chat', 'photos'], parts: ['socNav', 'phSidebar', 'phNow', 'socVoice', 'chatSide'].map(id => document.getElementById(id)), search: document.querySelector('#socSidebar .soc-search'), searchOn: ['chat'] },
    { tab: 'music', pages: ['music'], parts: [document.querySelector('#musicSidebar .music-nav')], search: document.querySelector('#musicSidebar .picker-search') },
  ];
  PAGES.forEach(p => {
    p.parts = p.parts.filter(Boolean);
    // Where each part goes back to.
    [...p.parts, p.search].filter(Boolean).forEach(el => { el._home = document.createComment('nav'); el.before(el._home); });
    p.sub = document.createElement('div');
    p.sub.className = 'nav-sub';
    p.sub.dataset.for = p.tab;
    p.sub.innerHTML = '<div class="nav-sub-in"><div class="nav-sub-pad"></div></div>';
    p.in = p.sub.querySelector('.nav-sub-pad');
    tabNav.querySelector(`.tab-nav-btn[data-tab-target="${p.tab}"]`)?.after(p.sub);
  });

  // The title bar's search: the page's own box, moved up.
  const bar = document.createElement('div');
  bar.className = 'hdr-pagenav';
  bar.hidden = true;
  const find = document.createElement('div');
  find.className = 'hdr-find';
  bar.appendChild(find);
  header.appendChild(bar);
  find.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const inp = find.querySelector('input');
    if (inp && inp.value) return;
    e.stopPropagation();
    inp?.blur();
  });

  const mode = () => root.getAttribute('data-nav') || 'side';
  const treeOn = () => desk.matches && tabNav.closest('#sideNav');
  let last = document.querySelector('.tab-panel.active')?.dataset.tabPanel || '';
  let was = null;
  function place(key) {
    if (key) last = key;
    const tree = !!treeOn();
    const cur = PAGES.find(p => p.pages.includes(last));
    PAGES.forEach(p => {
      p.parts.forEach(el => {
        if (tree && el.parentElement !== p.in) p.in.appendChild(el);
        if (!tree && el.parentElement === p.in) el._home.after(el);
      });
      p.sub.classList.toggle('open', tree && p === cur);
      if (p.search) {
        // (Social's finds conversations: only on Chat, where they are.)
        const up = tree && p === cur && (!p.searchOn || p.searchOn.includes(last));
        if (up && p.search.parentElement !== find) { p.search.classList.remove('pop'); find.appendChild(p.search); }
        else if (!up && p.search.parentElement === find) p.search._home.after(p.search);
      }
    });
    bar.hidden = !find.firstElementChild;
    root.classList.toggle('nav-tree', tree);
    // (The CSS that hides what's left of the page sidebars keys on this.)
    root.classList.toggle('hdr-pagenav-on', tree);
    // The sliding highlights measure again where their rows are now: only
    // when something moved (another page's rows unfolded, the search box
    // came or went), not on every step between one page's sections, which
    // woke every resize listener in the app per press.
    const shape = tree + '|' + (cur ? cur.pages[0] : '') + '|' + (find.firstElementChild?.className || '');
    if (shape !== was) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    was = shape;
  }
  // A page's own row goes to its front page, from anywhere (the owner:
  // "always take me back to the home page of that tab"): Music's Home,
  // with any album or playlist page closed.
  PAGES.forEach(p => {
    const btn = tabNav.querySelector(`.tab-nav-btn[data-tab-target="${p.tab}"]`);
    const front = p.in.querySelector('.picker-tab[data-tab="random"], .picker-tab[data-soc="social"]') || p.parts[0]?.querySelector('.picker-tab[data-tab="random"], .picker-tab[data-soc="social"]');
    if (!btn || !front) return;
    btn.addEventListener('click', () => setTimeout(() => {
      if (p.tab === 'music' && document.getElementById('apPanel')?.classList.contains('open')) window.closeApPanel?.();
      if (!front.classList.contains('active')) front.click();
    }));
  });
  window.klabHeaderSearch = place;
  window.klabOpenHeaderFind = () => {
    const inp = !bar.hidden && find.querySelector('input');
    if (!inp) return false;
    inp.focus(); inp.select?.();
    return true;
  };
  desk.addEventListener('change', () => place());
  roomy.addEventListener('change', () => place());
  // Settings → Navigation, and ☰ folding the sidebar to its icons.
  new MutationObserver(() => place()).observe(root, { attributes: true, attributeFilter: ['data-nav'] });
  // The folded sidebar opened over the page (☰ in a narrow window) has room for names.
  let flyout = root.classList.contains('nav-flyout');
  new MutationObserver(() => {
    if (root.classList.contains('nav-flyout') === flyout) return;
    flyout = !flyout;
    place();
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  place();
})();

// The title bar's right-hand tray with nothing showing in it (every page
// but the Feed, on a computer, once the theme and the menu went to
// Settings) drew as an empty, squished button on the Mac. Marked empty, it
// draws nothing; its buttons coming and going (the Feed's @, voice's mic)
// are watched.
(function () {
  const tray = document.querySelector('.header .header-right');
  if (!tray) return;
  const sync = () => {
    const empty = ![...tray.children].some(c => c.offsetWidth > 0 && getComputedStyle(c).visibility !== 'hidden');
    if (tray.classList.contains('is-empty') !== empty) tray.classList.toggle('is-empty', empty);
  };
  new MutationObserver(() => requestAnimationFrame(sync)).observe(tray, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  new MutationObserver(() => requestAnimationFrame(sync)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', sync);
  sync();
})();
