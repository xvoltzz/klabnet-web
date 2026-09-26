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
  await _origPlaySong(song);
  // Media session + history + album color
  updateFSUI(song);
  updateDockFavBtn();
  updateFSFavBtn();
  document.getElementById('fsPlayIcon').className = 'ti ti-player-pause';
  addToPlayHistory(song);
  if (song?.coverArt) {
    // size=64 — matches sampleImageColor()'s own sampling size elsewhere;
    // averaging pixel color for an accent tint doesn't benefit from a
    // higher-res source, so the previous 300 was pure waste on every song
    // change.
    const url = `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=64&${subsonicParams()}`;
    extractAlbumColor(url);
  } else {
    _resetAccent();
  }
};

// ── Keyboard shortcuts ──────────────────────────
document.addEventListener('keydown', e => {
  // Don't fire when typing in an input
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.code === 'Space') {
    e.preventDefault();
    document.getElementById('btnPlay')?.click();
  } else if (e.code === 'ArrowRight' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('btnNext')?.click();
  } else if (e.code === 'ArrowLeft' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('btnPrev')?.click();
  } else if (e.code === 'KeyM') {
    const a = playerState.audio;
    a.muted = !a.muted;
    SFX && SFX.play('click');
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
    const step = e.deltaY < 0 ? 0.05 : -0.05;
    const pct  = Math.max(0, Math.min(1, playerState.audio.volume + step));
    // Mirror the volSlider/fsVolSlider drag callbacks so a wheel-adjusted
    // volume persists across track changes (playSong re-applies
    // playerState.volume) and stays in sync with the fullscreen slider.
    clearInterval(_loginFadeInterval);
    playerState.volume = pct;
    playerState.audio.volume = pct;
    localStorage.setItem(VOLUME_KEY, pct.toFixed(3));
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
  if (_showRemaining && isFinite(dur)) {
    _timeEl.textContent = '-' + _fmtTime(dur - cur);
  } else {
    _timeEl.textContent = _fmtTime(cur);
  }
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

  // ── Fetch from LRCLIB ────────────────────
  async function fetchLyrics(song) {
    if (!song) return null;
    try {
      const params = new URLSearchParams({
        track_name:  song.title  || '',
        artist_name: song.artist || '',
        album_name:  song.album  || '',
      });
      const res  = await fetchTimeout(`https://lrclib.net/api/get?${params}`, {}, 8000);
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch(e) { return null; }
  }

  // ── Render lines into DOM ────────────────
  function renderLines(lines, synced) {
    scroll.innerHTML = '';
    if (!lines.length) {
      const s = document.createElement('div');
      s.className = 'lyrics-status';
      s.textContent = 'no lyrics found';
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

    // Smooth scroll active line to center
    const activeEl = els[idx];
    if (activeEl) {
      const scrollTop  = activeEl.offsetTop
        - scroll.clientHeight / 2
        + activeEl.offsetHeight / 2;
      scroll.scrollTo({ top: scrollTop, behavior: 'smooth' });
    }
  }

  // ── Animation loop for synced lyrics ────
  function syncLoop() {
    if (!_lyricsOpen || !_isSynced || !_syncedLines.length) return;
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
    st.textContent = 'searching...';
    scroll.appendChild(st);

    const myLyricsToken = ++_lyricsToken;
    const data = await fetchLyrics(song);
    if (myLyricsToken !== _lyricsToken) return; // a newer track change superseded this load

    if (data && data.syncedLyrics) {
      _syncedLines = parseLRC(data.syncedLyrics);
      _isSynced    = true;
      renderLines(_syncedLines, true);
      if (_lyricsOpen) startSync();
    } else if (data && data.plainLyrics) {
      _plainLines = data.plainLyrics.split('\n').filter(l => l.trim());
      _isSynced   = false;
      renderLines(_plainLines, false);
    } else {
      _isSynced = false;
      scroll.innerHTML = '<div class="lyrics-status">no lyrics found</div>';
    }
  }

  function startSync() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(syncLoop);
  }
  function stopSync() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  const fsPlayer2 = document.getElementById('fsPlayer');

  // ── Toggle lyrics panel ──────────────────
  function toggleLyrics() {
    _lyricsOpen = !_lyricsOpen;
    lyricsBtn.classList.toggle('lyrics-active', _lyricsOpen);
    if (fsPlayer2) fsPlayer2.classList.toggle('lyrics-open', _lyricsOpen);

    if (_lyricsOpen) {
      const song = playerState.currentSong;
      if (song && song.id !== _currentSongId) loadLyrics(song);
      if (_isSynced) startSync();
      SFX && SFX.play('open');
    } else {
      stopSync();
      SFX && SFX.play('close');
    }
  }

  lyricsBtn.addEventListener('click', toggleLyrics);

  // Auto-load when song changes if panel is open
  const _origPlaySongLyrics = playSong;
  playSong = async function(song) {
    await _origPlaySongLyrics(song);
    _currentSongId = null; // invalidate cache for new song
    if (_lyricsOpen) {
      await loadLyrics(song);
      if (_isSynced) startSync();
    }
  };

  // Stop/start sync loop with playback state
  playerState.audio.addEventListener('play',  () => { if (_lyricsOpen && _isSynced) startSync(); });
  playerState.audio.addEventListener('pause', () => stopSync());

  // Expose for external use — getActiveLine() lets the "share to feed"
  // flow (defined much later in the script) offer whatever lyric line is
  // actually on screen right now as a quotable excerpt, without duplicating
  // this module's own sync-tracking state.
  window._klabLyrics = {
    toggle: toggleLyrics,
    load: loadLyrics,
    getActiveLine: () => (_isSynced && _activeIdx >= 0 && _syncedLines[_activeIdx]) ? _syncedLines[_activeIdx].text : null,
  };
})();

