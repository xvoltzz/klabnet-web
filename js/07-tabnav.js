// ══════════════════════════════════════════
//  TAB NAV — Feed / Apps / Chat / Music / KLABCRAFT router
//  Hash-based so tabs are bookmarkable and back/forward works. The floating
//  player dock lives outside every .tab-panel, so it's unaffected by any of
//  this and keeps playing/visible across tab switches.
// ══════════════════════════════════════════
const TABS = ['feed', 'chat', 'music', 'apps', 'klabcraft'];

function isTabEnabled(key) {
  const btn = document.querySelector(`.tab-nav-btn[data-tab-target="${key}"]`);
  return !!btn && !btn.hidden;
}

function setActiveTab(key) {
  if (!TABS.includes(key) || !isTabEnabled(key)) key = 'feed';
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
  // Swaps the header's terminal-prompt branding to klab.chat while on
  // this tab (see CHAT_PROMPT_TEXT's own comment) — guarded on the intro
  // typing animation already having finished; if it hasn't (a page load
  // landing directly on the #chat hash), typeNext()'s own completion
  // branch applies the right text once it's done instead, rather than
  // this fighting that in-flight animation.
  if (typeof promptEl !== 'undefined' && promptEl && typeof typed !== 'undefined' && typed >= FULL_TEXT.length) {
    promptEl.textContent = key === 'chat' ? CHAT_PROMPT_TEXT : FULL_TEXT;
  }
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
    renderTimeline();
  }
  if (location.hash.slice(1) !== key) location.hash = key;
  // Landing on Music directly (deep link, reload, or a nav-bar click — not
  // just via openPicker()) still needs its content fetched the first time.
  if (key === 'music' && typeof ensureMusicTabLoaded === 'function') ensureMusicTabLoaded();
}

// Called after settings change a tab's availability — bumps off a now-hidden
// active tab back to Feed instead of leaving the user on a blank panel.
function refreshActiveTabAvailability() {
  const current = document.querySelector('.tab-panel.active')?.dataset.tabPanel || 'feed';
  if (!isTabEnabled(current)) setActiveTab('feed');
}

function initTabs() {
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tabTarget));
  });
  window.addEventListener('hashchange', () => setActiveTab(location.hash.slice(1) || 'feed'));
  setActiveTab(location.hash.slice(1) || 'feed');
}

function openSettings() {
  // Sync UI to current settings
  const su = document.getElementById('settingsUser');
  if (su) su.textContent = window.KLAB_USER?.username || '—';

  const toggleMap = {
    sfxToggle:        'sfxEnabled',
    notifSoundToggle: 'notifSound',
    loginSongToggle:  'loginSong',
    experimentalToggle: 'experimentalEnabled',
    klabcraftToggle:  'showKlabcraft',
    leaderboardToggle: 'showLeaderboard',
  };
  Object.entries(toggleMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!_settings[key]);
  });

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

// Wire toggles
document.querySelectorAll('.s-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('on');
    SFX && SFX.play('click');
    // Map toggle id back to settings key
    const map = {
      sfxToggle: 'sfxEnabled', notifSoundToggle: 'notifSound',
      loginSongToggle: 'loginSong', experimentalToggle: 'experimentalEnabled',
      klabcraftToggle: 'showKlabcraft', leaderboardToggle: 'showLeaderboard',
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
  showToast('preferences reset — reloading...');
  setTimeout(() => location.reload(), 1500);
});

// Header overflow ("more") menu — toggled by its own button, closed by an
// outside click, Escape, or clicking any item inside it (motdRefresh/
// leaderboardBtn/keyHintsBtn/repoBtn/accountBtn keep their own separately-
// wired click handlers elsewhere in the script; this only owns opening/
// closing the menu chrome around them).
(function() {
  const btn  = document.getElementById('headerMoreBtn');
  const menu = document.getElementById('headerMoreMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.classList.toggle('visible');
    SFX && SFX.play('click');
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

// ══════════════════════════════════════════
//  KLABCRAFT — world backup browser (WIP)
//  Lists backups that live on the server (served through Caddy) once
//  the backup script exists. Point this at wherever that script ends
//  up publishing its file list.
// ══════════════════════════════════════════
const KLABCRAFT_BACKUPS_API = '/api/klabcraft/backups';

function grassIconSvg(size) {
  size = size || 16;
  return '<svg viewBox="0 0 8 8" width="' + size + '" height="' + size + '" shape-rendering="crispEdges" style="display:block" aria-hidden="true">'
    + '<rect x="0" y="0" width="8" height="8" fill="#8b5a2b"/>'
    + '<rect x="0" y="0" width="8" height="5" fill="#6cbb3c"/>'
    + '<rect x="1" y="4" width="1" height="1" fill="#8b5a2b"/>'
    + '<rect x="3" y="4" width="1" height="1" fill="#8b5a2b"/>'
    + '<rect x="6" y="4" width="1" height="1" fill="#8b5a2b"/>'
    + '</svg>';
}

function formatBackupSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

(function() {
  const iconSlot = document.getElementById('worldBackupIcon');
  if (iconSlot) iconSlot.innerHTML = grassIconSvg(17);

  const btn      = document.getElementById('worldBackupBtn');
  const backdrop = document.getElementById('klabcraftBackdrop');
  const list     = document.getElementById('klabcraftList');
  const closeBtn = document.getElementById('klabcraftClose');
  const refresh  = document.getElementById('klabcraftRefresh');
  if (!btn || !backdrop || !list) return;

  async function loadBackups() {
    list.innerHTML = '<div class="picker-empty">loading backups...</div>';
    try {
      const res = await fetchTimeout(KLABCRAFT_BACKUPS_API, {}, 8000);
      if (!res.ok) throw new Error('unavailable');
      const backups = await res.json();
      if (!Array.isArray(backups) || !backups.length) {
        list.innerHTML = '<div class="picker-empty">no backups found on the server yet</div>';
        return;
      }
      list.innerHTML = '';
      backups.forEach(b => {
        const row = document.createElement('div');
        row.className = 'picker-item';

        const art = document.createElement('div');
        art.className = 'picker-item-art-ph';
        art.innerHTML = grassIconSvg(20);

        const info = document.createElement('div');
        info.className = 'picker-item-info';
        const title = document.createElement('div');
        title.className = 'picker-item-title';
        title.textContent = b.name || 'backup.zip';
        const sub = document.createElement('div');
        sub.className = 'picker-item-artist';
        sub.textContent = [formatBackupSize(b.size), b.modified].filter(Boolean).join(' · ');
        info.append(title, sub);

        const actions = document.createElement('div');
        actions.className = 'picker-item-actions';
        const dl = document.createElement('button');
        dl.className = 'picker-action'; dl.title = 'Download';
        dl.innerHTML = '<i class="ti ti-download"></i>';
        dl.addEventListener('click', e => {
          e.stopPropagation();
          window.open(b.url || (KLABCRAFT_BACKUPS_API + '/' + encodeURIComponent(b.name)), '_blank');
        });
        actions.appendChild(dl);

        row.append(art, info, actions);
        list.appendChild(row);
      });
    } catch (e) {
      list.innerHTML = '<div class="picker-empty">backup server not connected yet<br>check back once the script is running</div>';
    }
  }

  function openKlabcraftBrowser() {
    SFX && SFX.play('open');
    backdrop.classList.add('open');
    loadBackups();
  }
  function closeKlabcraftBrowser() {
    SFX && SFX.play('close');
    backdrop.classList.remove('open');
  }
  trapFocusWithin(backdrop.querySelector('.add-app-modal'), () => backdrop.classList.contains('open'));

  btn.addEventListener('click', () => { SFX && SFX.play('click'); openKlabcraftBrowser(); });
  closeBtn && closeBtn.addEventListener('click', closeKlabcraftBrowser);
  refresh && refresh.addEventListener('click', () => { SFX && SFX.play('click'); loadBackups(); });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeKlabcraftBrowser(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeKlabcraftBrowser();
  });
})();

