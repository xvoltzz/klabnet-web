// ══════════════════════════════════════════
//  ALBUM COLOR EXTRACTION
//  Samples cover art → sets --accent-rgb on :root
//  so all accent-based UI adapts to the playing song
// ══════════════════════════════════════════

// Smoothly tween --accent-rgb between colors instead of snapping —
// used on song change and play/pause so every accent-tinted surface
// (borders, dock, seek bar, text) eases into the new hue together.
let _accentTweenId = null;
let _lastAccentStr = null; // last value actually written to --accent-rgb (see step())
function _currentAccentRgb() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
  const parts = raw.split(',').map(n => parseFloat(n));
  return (parts.length === 3 && parts.every(n => !isNaN(n))) ? parts : [200,195,188];
}
function tweenAccentRgb(target, duration, onDone) {
  duration = duration || 600;
  // Every frame of this rewrites --accent-rgb, restyling the whole page;
  // performance mode takes the new colour in one step instead.
  if (window.KLAB_FX?.on()) duration = 1;
  cancelAnimationFrame(_accentTweenId);
  const start = _currentAccentRgb();
  const t0 = performance.now();
  function step(now) {
    const p = Math.min(1, (now - t0) / duration);
    const e = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2; // easeInOutQuad
    const r = Math.round(start[0] + (target[0]-start[0]) * e);
    const g = Math.round(start[1] + (target[1]-start[1]) * e);
    const b = Math.round(start[2] + (target[2]-start[2]) * e);
    // --accent-rgb is read by ~154 rules, so every write invalidates style
    // for the whole document. The channels are rounded to integers, so most
    // frames of a tween compute the same triple as the frame before —
    // writing only on an actual change skips a large share of those
    // document-wide recalcs for free.
    const next = `${r},${g},${b}`;
    if (next !== _lastAccentStr) {
      _lastAccentStr = next;
      document.documentElement.style.setProperty('--accent-rgb', next);
    }
    if (p < 1) {
      _accentTweenId = requestAnimationFrame(step);
    } else if (onDone) {
      onDone();
    }
  }
  _accentTweenId = requestAnimationFrame(step);
}
function _defaultAccentRgb() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? [192,150,96] : [200,195,188];
}

function _resetAccent() {
  // Ease back to the theme default instead of snapping, then hand
  // control back to the CSS cascade so theme toggles still work while idle.
  tweenAccentRgb(_defaultAccentRgb(), 550, () => {
    document.documentElement.style.removeProperty('--accent-rgb');
  });
}

function extractAlbumColor(imgUrl) {
  if (window._klabSampleAccent) window._klabSampleAccent(imgUrl);
}

// Hook into playSong — extract color from cover art on every track change

// ── playSong — single consolidated patch ──
const _origPlaySong = playSong;
playSong = async function(song) {
  // The full player, hearts and colour follow the new song as soon as it's
  // picked, like the dock does, rather than once it has buffered enough to
  // start: off the LAN that was seconds of the full player showing the last
  // song. (The play icon is setPlayIcon's; forcing "pause" here was wrong
  // whenever play was refused, e.g. a login song before any tap.)
  const started = _origPlaySong(song);
  updateFSUI(song);
  updateDockFavBtn();
  updateFSFavBtn();
  if (song?.coverArt) {
    // size=64 — matches sampleImageColor()'s own sampling size elsewhere;
    // averaging pixel color for an accent tint doesn't benefit from a
    // higher-res source, so the previous 300 was pure waste on every song
    // change.
    const url = `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=64&${subsonicParams()}`;
    extractAlbumColor(url);
  } else {
    _resetAccent();
  }
  await started;
  // Skipped before it ever started: it wasn't played.
  if (song && playerState.currentSong !== song) return;
  addToPlayHistory(song);
};

// ── Keyboard shortcuts ──────────────────────────
// Whether what has the focus got it from a click or a tap, rather than Tab.
let _focusByPointer = false, _pointerAt = 0;
document.addEventListener('pointerdown', () => { _pointerAt = performance.now(); }, true);
document.addEventListener('focusin', () => { _focusByPointer = performance.now() - _pointerAt < 600; }, true);
document.addEventListener('keydown', e => {
  // Don't fire when typing in an input
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
  // Alt+← is the browser's Back, Cmd+M minimizes: not ours.
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  // Not under a dialog or an open menu (a number of them used to skip the
  // song behind "Delete this?"), and Space on a focused button presses
  // that button rather than playing or pausing the music.
  if (e.code !== 'Escape' && (document.body.classList.contains('feed-composer-open') ||
      document.querySelector('.add-app-backdrop.open, .settings-backdrop.open, .img-view-backdrop.open, .img-crop-backdrop.open, .ctx-menu.visible, .ss.open'))) return;
  // Only one reached from the keyboard, though: Chromium and Firefox leave
  // focus on a button you clicked, and Space then pressed Next (or the
  // heart) again instead of pausing. (:focus-visible can't tell: Chrome
  // turns it on for the key press itself.)
  if (e.code === 'Space' && document.activeElement?.closest?.('button, a[href], [role="button"], [role="menuitem"], summary') && !_focusByPointer) return;

  if (e.code === 'Space') {
    e.preventDefault();
    // A clicked button keeps the focus, and Space's key-up would still
    // press it (Next, a heart) after this has paused: let go of it.
    if (document.activeElement?.closest?.('button, a[href], [role="button"], [role="menuitem"], summary')) document.activeElement.blur();
    document.getElementById('btnPlay')?.click();
  // (←/→ used to skip tracks here, on top of moving around the site. The
  // owner: the keyboard's media keys are for that; ←/→ are the site's.)
  } else if (e.code === 'KeyM') {
    document.getElementById('volIcon')?.closest('button')?.click();
  } else if (e.code === 'KeyF' && document.getElementById('fsPlayer')?.classList.contains('open')) {
    closeFS();
  } else if (e.code === 'Escape') {
    // Picker no longer has an open/closed state to escape out of — it's
    // just the Music tab's content. Album/artist detail view still does
    // (handled by the ap-panel IIFE's own Escape listener), so only the
    // fullscreen player needs handling here.
    const fs = document.getElementById('fsPlayer');
    if (fs?.classList.contains('open')) { closeFS(); return; }
  }
});

// ── Scroll wheel volume control ──────────────────
// Scroll wheel volume — only fires when hovering over the vol slider area
(function() {
  const volArea = document.getElementById('volSlider');
  if (!volArea) return;
  // Expand hit area to include the vol icon and fill
  const volWrap = volArea.closest('.vol-wrap') || volArea.parentElement;
  const target  = volWrap || volArea;
  target.addEventListener('wheel', e => {
    e.preventDefault();
    e.stopPropagation();
    // The slider has its own wheel handler; this one is for the icon beside it.
    if (volArea.contains(e.target)) return;
    const step = e.deltaY < 0 ? 0.05 : -0.05;
    const pct  = Math.max(0, Math.min(1, playerState.audio.volume + step));
    // Mirror the volSlider/fsVolSlider drag callbacks so a wheel-adjusted
    // volume persists across track changes (playSong re-applies
    // playerState.volume) and stays in sync with the fullscreen slider.
    clearInterval(_loginFadeInterval);
    playerState.volume = pct;
    playerState.audio.volume = pct;
    if (pct > 0) playerState.audio.muted = false;
    try { localStorage.setItem(VOLUME_KEY, pct.toFixed(3)); } catch (err) {}
    volSlider.setPct(pct);
    fsVolSlider.setPct(pct);
    SFX && SFX.play('hover');
  }, { passive: false });
})();

// ── Dock time display ───────────────────────────
let _showRemaining = false;
const _timeEl = document.getElementById('playerTimeEl');
if (_timeEl) {
  _timeEl.addEventListener('click', () => {
    _showRemaining = !_showRemaining;
    refreshTimeDisplay();
    SFX && SFX.play('hover');
  });
}
function refreshTimeDisplay() {
  if (!_timeEl) return;
  const cur = playerState.audio.currentTime;
  const dur = playerState.audio.duration;
  const t = _showRemaining && isFinite(dur) ? '-' + _fmtTime(dur - cur) : _fmtTime(cur);
  if (_timeEl.textContent !== t) _timeEl.textContent = t;
}
function _fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}
// Hook into timeupdate (playerState.audio already exists)
playerState.audio.addEventListener('timeupdate', refreshTimeDisplay);

// ══════════════════════════════════════════
//  LYRICS ENGINE
// ══════════════════════════════════════════
(function() {
  let _lyricsOpen   = false;
  let _syncedLines  = [];   // [{time, text}]
  let _plainLines   = [];   // [string]
  let _isSynced     = false;
  let _activeIdx    = -1;
  let _rafId        = null;
  let _currentSongId = null;
  let _lyricsToken  = 0;    // guards against a slow-loading fetch for a since-skipped track winning a race

  const scroll     = document.getElementById('lyricsScroll');
  const lyricsBtn  = document.getElementById('fsLyrics');

  if (!scroll || !lyricsBtn) return;

  // ── Parse LRC format ─────────────────────
  function parseLRC(lrc) {
    const lines = [];
    const re = /\[(\d+):(\d+)\.(\d+)\](.*)/;
    lrc.split('\n').forEach(raw => {
      const m = raw.match(re);
      if (!m) return;
      const time = parseInt(m[1])*60 + parseFloat(m[2] + '.' + m[3]);
      const text = m[4].trim();
      if (text) lines.push({ time, text });
    });
    return lines.sort((a,b) => a.time - b.time);
  }

  // ── Fetch ────────────────────────────────
  // The lyrics, null if there are none, or { failed: true } when they
  // couldn't be had just now (said so, and tried again next time, rather
  // than "No lyrics found" sticking for that song). Asked in order:
  //   1. Navidrome's own (lyrics in the file or beside it; OpenSubsonic's
  //      getLyricsBySongId), as the phone apps do.
  //   2. klabnet-api's /api/music-requests/lyrics: LRCLIB, asked once for
  //      everyone and kept. LRCLIB rate-limits by IP and the whole house is
  //      one, so browsers asking it themselves ran into 429s ("busted for
  //      a brick", the owner).
  //   3. LRCLIB itself, only from an API without that route.
  const _lyricsSeen = new Map(); // song id -> answer, this session
  async function fromNavidrome(song) {
    if (!song.id || typeof subsonicParams !== 'function' || typeof ND_URL === 'undefined') return null;
    try {
      const r = await fetchTimeout(`${ND_URL}/rest/getLyricsBySongId?id=${encodeURIComponent(song.id)}&${subsonicParams()}`, {}, 5000);
      if (!r.ok) return null;
      const list = (await r.json())?.['subsonic-response']?.lyricsList?.structuredLyrics || [];
      const pick = list.find(l => l.synced && l.line?.length) || list.find(l => l.line?.length);
      if (!pick) return null;
      if (pick.synced) {
        const lrc = pick.line.map(l => {
          const t = Math.max(0, (l.start || 0) + (pick.offset || 0)) / 1000;
          return `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]${l.value || ''}`;
        }).join('\n');
        return { syncedLyrics: lrc };
      }
      return { plainLyrics: pick.line.map(l => l.value || '').join('\n') };
    } catch (e) { return null; }
  }
  async function fromLrclib(song) {
    const params = new URLSearchParams({
      track_name:  song.title  || '',
      artist_name: song.artist || '',
      album_name:  song.album  || '',
    });
    if (song.duration) params.set('duration', String(Math.round(song.duration)));
    const res  = await fetchTimeout(`https://lrclib.net/api/get?${params}`, {}, 8000);
    if (res.ok) return await res.json();
    if (res.status !== 404) return { failed: true };
    const q = new URLSearchParams({ track_name: song.title || '', artist_name: song.artist || '' });
    const sr = await fetchTimeout(`https://lrclib.net/api/search?${q}`, {}, 8000);
    if (!sr.ok) return { failed: true };
    const hits = (await sr.json() || []).filter(h => h.syncedLyrics || h.plainLyrics);
    if (!hits.length) return null;
    const off = h => song.duration && h.duration ? Math.abs(h.duration - song.duration) : 0;
    const near = hits.filter(h => off(h) <= 8);
    near.sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || off(a) - off(b));
    return near[0] || null;
  }
  let _noApiLyrics = false;
  async function fetchLyrics(song) {
    if (!song) return null;
    if (song.id && _lyricsSeen.has(song.id)) return _lyricsSeen.get(song.id);
    try {
      let data = await fromNavidrome(song);
      if (!data && !_noApiLyrics) {
        const q = new URLSearchParams({ title: song.title || '', artist: song.artist || '', album: song.album || '' });
        if (song.duration) q.set('duration', String(Math.round(song.duration)));
        // Longer than LRCLIB's own: the API waits out its rate limit.
        const r = await fetchTimeout('/api/music-requests/lyrics?' + q, {}, 20000);
        if (r.status === 404 || r.status === 405 || !/json/.test(r.headers.get('content-type') || '')) _noApiLyrics = true;
        else if (!r.ok) return { failed: true };
        else data = (await r.json()).lyrics || null;
        if (!_noApiLyrics) { if (song.id) _lyricsSeen.set(song.id, data); return data; }
      }
      if (!data) data = await fromLrclib(song);
      if (song.id && !data?.failed) _lyricsSeen.set(song.id, data);
      return data;
    } catch(e) { return { failed: true }; }
  }

  // ── Render lines into DOM ────────────────
  function renderLines(lines, synced) {
    scroll.innerHTML = '';
    if (!lines.length) {
      const s = document.createElement('div');
      s.className = 'lyrics-status';
      s.textContent = 'No lyrics found';
      scroll.appendChild(s);
      return;
    }
    lines.forEach((line, i) => {
      const el = document.createElement('div');
      el.className = 'lyric-line' + (synced ? '' : ' plain');
      el.textContent = typeof line === 'string' ? line : line.text;
      el.dataset.idx = i;
      if (!synced) {
        el.style.cssText = 'cursor:default;';
      } else {
        // Click to seek
        el.addEventListener('click', () => {
          const t = _syncedLines[i].time;
          // Jumping to a line scratches there, like the seek bar.
          if (typeof scratchSeek === 'function') scratchSeek(t);
          playerState.audio.currentTime = t;
        });
      }
      scroll.appendChild(el);
    });
  }

  // ── Highlight active line ────────────────
  function setActiveLine(idx) {
    if (idx === _activeIdx) return;
    const els = scroll.querySelectorAll('.lyric-line');
    els.forEach((el, i) => {
      el.classList.remove('active','near','far');
      const dist = Math.abs(i - idx);
      if      (i === idx)  el.classList.add('active');
      else if (dist <= 2)  el.classList.add('near');
      else                 el.classList.add('far');
    });
    _activeIdx = idx;

    // The line glides up to a little above the middle, on its own curve:
    // the browser's smooth scroll started over, from a standstill, on
    // every line, and jumped if one came while it was still going.
    // Leaves it alone for a few seconds after you scroll it yourself.
    const activeEl = els[idx];
    if (activeEl && Date.now() - _userScrolledAt > 3500) glideTo(activeEl.offsetTop - scroll.clientHeight * 0.38 + activeEl.offsetHeight / 2);
  }

  let _glide = 0, _userScrolledAt = 0;
  function glideTo(top) {
    cancelAnimationFrame(_glide);
    top = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, top));
    const from = scroll.scrollTop, d = top - from;
    if (Math.abs(d) < 1) return;
    if (!(window.klabMotionOk?.() ?? true)) { scroll.scrollTop = top; return; }
    const dur = Math.min(900, 520 + Math.abs(d) * 0.4), t0 = performance.now();
    // Ease out, without the start: a line arrives as the singer gets there.
    const ease = t => 1 - Math.pow(1 - t, 3.2);
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      scroll.scrollTop = from + d * ease(t);
      if (t < 1) _glide = requestAnimationFrame(step);
    };
    _glide = requestAnimationFrame(step);
  }
  // Your own scrolling (wheel, touch, keys), not the glide's.
  ['wheel', 'touchmove', 'keydown'].forEach(t => scroll.addEventListener(t, () => {
    _userScrolledAt = Date.now();
    cancelAnimationFrame(_glide);
  }, { passive: true }));

  // ── Animation loop for synced lyrics ────
  // Only while the lyrics are actually on screen: with the full player
  // closed this used to run every frame for the rest of the session.
  const lyricsVisible = () => _lyricsOpen && !!fsPlayer2?.classList.contains('open') && !document.hidden;
  function syncLoop() {
    if (!lyricsVisible() || !_isSynced || !_syncedLines.length) { _rafId = null; return; }
    _rafId = requestAnimationFrame(syncLoop);

    const cur = playerState.audio.currentTime;
    let idx = 0;
    for (let i = 0; i < _syncedLines.length; i++) {
      if (_syncedLines[i].time <= cur) idx = i;
      else break;
    }
    setActiveLine(idx);
  }

  // ── Load lyrics for a song ───────────────
  async function loadLyrics(song) {
    if (!song || song.id === _currentSongId) return;
    _currentSongId = song.id;
    _activeIdx = -1;
    _syncedLines = [];
    _plainLines  = [];

    // Show loading state
    scroll.innerHTML = '';
    const st = document.createElement('div');
    st.className = 'lyrics-status';
    st.textContent = 'Searching…';
    scroll.appendChild(st);

    const myLyricsToken = ++_lyricsToken;
    const data = await fetchLyrics(song);
    if (myLyricsToken !== _lyricsToken) return; // a newer track change superseded this load

    if (data && data.syncedLyrics) {
      _syncedLines = parseLRC(data.syncedLyrics);
      _isSynced    = true;
      renderLines(_syncedLines, true);
      if (lyricsVisible()) startSync();
      syncOnce();
    } else if (data && data.plainLyrics) {
      _plainLines = data.plainLyrics.split('\n').filter(l => l.trim());
      _isSynced   = false;
      renderLines(_plainLines, false);
    } else if (data?.failed) {
      _isSynced = false;
      _currentSongId = null; // try again when they're next shown
      scroll.innerHTML = '<div class="lyrics-status">Couldn’t reach the lyrics. Try again in a bit.</div>';
    } else {
      _isSynced = false;
      scroll.innerHTML = '<div class="lyrics-status">No lyrics found</div>';
    }
  }

  // Only while it plays: a paused song's line doesn't move, so there is
  // nothing to redraw sixty times a second.
  function startSync() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = playerState.audio.paused ? null : requestAnimationFrame(syncLoop);
  }
  // The line for where the song is now, or -1 before the first one.
  function lineAt(t) {
    let idx = -1;
    for (let i = 0; i < _syncedLines.length; i++) {
      if (_syncedLines[i].time <= t) idx = i; else break;
    }
    return idx;
  }
  // One pass, for when the song is paused (opening the lyrics, a seek).
  function syncOnce() {
    if (lyricsVisible() && _isSynced && _syncedLines.length) setActiveLine(Math.max(0, lineAt(playerState.audio.currentTime)));
  }
  function stopSync() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  const fsPlayer2 = document.getElementById('fsPlayer');
  // Opening the full player catches the lyrics up (a track may have
  // changed while it was closed) and restarts the sync; closing stops it.
  if (fsPlayer2) new MutationObserver(() => {
    if (!lyricsVisible()) { stopSync(); return; }
    const song = playerState.currentSong;
    if (song && song.id !== _currentSongId) loadLyrics(song);
    else if (_isSynced) { startSync(); syncOnce(); }
  }).observe(fsPlayer2, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (lyricsVisible() && _isSynced && !playerState.audio.paused) startSync(); });

  // ── Toggle lyrics panel ──────────────────
  function toggleLyrics() {
    _lyricsOpen = !_lyricsOpen;
    lyricsBtn.classList.toggle('lyrics-active', _lyricsOpen);
    lyricsBtn.setAttribute('aria-pressed', _lyricsOpen);
    // The cover and the title move between the two layouts rather than
    // jumping (the layouts can't be transitioned: a grid becomes a column
    // and the cover's size limit goes from none to 180px). Measured,
    // switched, then each slides from where it was.
    const moving = fsPlayer2 && fsPlayer2.classList.contains('open') && (window.klabMotionOk?.() ?? true)
      ? [...fsPlayer2.querySelectorAll('.fs-art-tilt-wrap, .fs-meta')].map(el => [el, el.getBoundingClientRect()]) : [];
    if (fsPlayer2) fsPlayer2.classList.toggle('lyrics-open', _lyricsOpen);
    for (const [el, a] of moving) {
      const b = el.getBoundingClientRect();
      if (!b.width || !a.width) continue;
      const art = el.classList.contains('fs-art-tilt-wrap');
      const from = `translate(${a.left - b.left}px, ${a.top - b.top}px)` + (art ? ` scale(${a.width / b.width})` : '');
      el.animate([{ transformOrigin: '0 0', transform: from }, { transformOrigin: '0 0', transform: 'none' }],
        { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }

    if (_lyricsOpen) {
      const song = playerState.currentSong;
      if (song && song.id !== _currentSongId) loadLyrics(song);
      else if (_isSynced) { startSync(); syncOnce(); }
      SFX && SFX.play('open');
    } else {
      stopSync();
      SFX && SFX.play('close');
    }
  }

  lyricsBtn.addEventListener('click', toggleLyrics);
  // The side panel's tabs: Up next or Lyrics.
  const tabs = [...document.querySelectorAll('#fsSide [data-fs-pane]')];
  tabs.forEach(t => t.addEventListener('click', () => {
    if ((t.dataset.fsPane === 'lyrics') !== _lyricsOpen) toggleLyrics();
  }));
  // The underline slides under whichever is chosen.
  const ink = document.querySelector('#fsSide .fs-side-ink');
  function syncTabs() {
    tabs.forEach(t => t.setAttribute('aria-selected', String((t.dataset.fsPane === 'lyrics') === _lyricsOpen)));
    const on = tabs.find(t => t.getAttribute('aria-selected') === 'true');
    if (ink && on?.offsetWidth) { ink.style.setProperty('--ink-x', on.offsetLeft + 'px'); ink.style.setProperty('--ink-w', on.offsetWidth + 'px'); }
  }
  lyricsBtn.addEventListener('click', syncTabs);
  tabs.forEach(t => t.addEventListener('click', syncTabs));
  // Measured once it's on screen (nothing has a width while it's closed).
  if (fsPlayer2) new MutationObserver(() => { if (fsPlayer2.classList.contains('open')) requestAnimationFrame(syncTabs); })
    .observe(fsPlayer2, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', syncTabs);

  // Auto-load when song changes if panel is open
  const _origPlaySongLyrics = playSong;
  playSong = async function(song) {
    await _origPlaySongLyrics(song);
    // Skipped past before it started: the newer song's call does this.
    // Carrying on fetched the skipped song's lyrics and showed them until
    // the new one had buffered.
    if (song && playerState.currentSong !== song) return;
    _currentSongId = null; // invalidate cache for new song
    // Fetched when they'll be seen; opening the full player loads them.
    // Not awaited: everything after playSong (the party's tick, Next) waited
    // on LRCLIB, up to two 8s lookups.
    if (lyricsVisible()) loadLyrics(song).then(() => { if (_isSynced && playerState.currentSong === song) startSync(); }, () => {});
  };

  // Stop/start sync loop with playback state
  playerState.audio.addEventListener('play',  () => { if (lyricsVisible() && _isSynced) startSync(); });
  playerState.audio.addEventListener('pause', () => stopSync());
  playerState.audio.addEventListener('seeked', () => { if (playerState.audio.paused) syncOnce(); });

  // Expose for external use — getActiveLine() lets the "share to feed"
  // flow (defined much later in the script) offer whatever lyric line is
  // actually on screen right now as a quotable excerpt, without duplicating
  // this module's own sync-tracking state.
  window._klabLyrics = {
    toggle: toggleLyrics,
    load: loadLyrics,
    // Worked out when asked: with the lyrics closed nothing keeps
    // _activeIdx moving, and the lines may still be the previous song's.
    getActiveLine: () => {
      if (!_isSynced || !_currentSongId || _currentSongId !== playerState.currentSong?.id) return null;
      return _syncedLines[lineAt(playerState.audio.currentTime)]?.text || null;
    },
  };
})();
