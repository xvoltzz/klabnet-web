// ══════════════════════════════════════════
//  PICKER NAVIGATION HISTORY + MOUSE BUTTONS
// ══════════════════════════════════════════
(function() {
  // Back button in picker — wire dynamically since picker-back is created per view
  const pickerList = document.getElementById('pickerList');
  if (pickerList) {
    pickerList.addEventListener('click', e => {
      const back = e.target.closest('.picker-back');
      if (back) SFX && SFX.play('nav_back');
    }, true); // capture so it fires before the back button's own handler
  }

  // Mouse back/forward buttons (button 3 = back, button 4 = forward)
  document.addEventListener('mousedown', e => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      // Forward has no in-app "forward stack" to mirror the back logic
      // below (this app's panels/tabs don't track a forward direction) —
      // the closest correct behavior is the browser's own history-forward,
      // not silently re-running the back logic (which is what button 4
      // used to fall through to here).
      if (e.button === 4) { history.forward(); return; }
      // If the artist/album detail view is open, step back to the browse list
      if (document.getElementById('apPanel')?.classList.contains('open')) {
        document.getElementById('apBack')?.click();
        return;
      }
      // If fullscreen is open, close it
      if (document.getElementById('fsPlayer')?.classList.contains('open')) {
        closeFS();
      }
      // Picker no longer has its own open/closed state (it's just the Music
      // tab's content) — with nothing else to back out of, head to Feed.
      else if (document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active')) {
        setActiveTab('feed');
        SFX && SFX.play('nav_back');
      }
      else {
        if (history.length > 1) history.back();
        else window.location.href = '/';
      }
    }
  });

  // Prevent browser from handling mouse 3/4 as history navigation
  document.addEventListener('mouseup', e => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
})();

// ══════════════════════════════════════════
//  SECTION SCROLL REVEAL
// ══════════════════════════════════════════
(function() {
  if (!window.IntersectionObserver) return;

  document.body.classList.add('sec-reveal');

  const secs = document.querySelectorAll('.sec');
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' });

  secs.forEach((sec, i) => {
    sec.style.transitionDelay = `${i * 0.03}s`;
    io.observe(sec);
  });
})();

// ── Picker item sounds ──────────────────────
(function() {
  const list = document.getElementById('pickerList');
  if (!list) return;
  let _lastBrowse = 0;

  // Subtle hover on picker items
  list.addEventListener('mouseover', e => {
    const item = e.target.closest('.picker-item, .picker-song, [class*="picker-"]');
    if (!item) return;
    const now = Date.now();
    if (now - _lastBrowse > 60) { // throttle — 60ms min between sounds
      _lastBrowse = now;
      SFX && SFX.play('browse');
    }
  });

  // Subtle click on picker items (album, artist, song rows — not play button)
  list.addEventListener('click', e => {
    const item = e.target.closest('.picker-item, .album-row, .artist-row');
    if (item && !e.target.closest('.picker-play, .picker-queue, .add-to-pl')) {
      SFX && SFX.play('nav');
    }
  });
})();

// ══════════════════════════════════════════
//  COLOR SAMPLING CORE
//  Extracted out of the live-player accent extractor below so presence
//  cards can compute a per-song accent for *other* people's now-playing
//  too (see ensureSongColorResolved()), without a second copy of the
//  bucket-voting algorithm and without pushing anyone else's song color
//  onto the site-wide --accent-rgb, which only the local player should
//  ever touch.
// ══════════════════════════════════════════
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = d / (1 - Math.abs(2*l - 1));
  let h = max===r ? (g-b)/d%6 : max===g ? (b-r)/d+2 : (r-g)/d+4;
  return [((h*60)+360)%360, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1-Math.abs(2*l-1))*s, x = c*(1-Math.abs((h/60)%2-1)), m = l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}
  else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}
  else if(h<300){r=x;b=c;}else{r=c;b=x;}
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}
// Pure — takes raw ImageData pixels, returns a dominant [r,g,b] or null
// (null meaning "nothing confident enough to vote a bucket", e.g. a
// monochrome cover — callers each decide their own fallback for that).
function dominantColorFromPixels(px) {
  // Vote by hue bucket instead of taking a single "best" pixel — a whole
  // bucket of consistently-colored pixels (the actual dominant color)
  // now outweighs one stray saturated outlier (a logo, lips, a flower)
  // that used to be able to win outright under a pure max-score pick.
  const BUCKETS = 24; // 15° each
  const weight = new Float32Array(BUCKETS);
  const sumR = new Float32Array(BUCKETS);
  const sumG = new Float32Array(BUCKETS);
  const sumB = new Float32Array(BUCKETS);
  const count = new Int32Array(BUCKETS);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i+3] < 200) continue;
    const r = px[i], g = px[i+1], b = px[i+2];
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.1 || l > 0.9 || s < 0.2) continue;
    // Skin/wood/sepia (hue ~10-45°) is extremely common in portrait album
    // art and would otherwise dominate — but only when it's actually
    // muted like real skin. A vivid, highly-saturated orange (Flower Boy's
    // cover, say) shouldn't get penalized just for sharing that hue range.
    const skinPenalty = (h > 10 && h < 45 && s < 0.55) ? 0.45 : 1;
    const score = s * (1 - Math.abs(l - 0.48) * 1.5) * skinPenalty;
    if (score <= 0) continue;
    const idx = Math.round(h / (360 / BUCKETS)) % BUCKETS;
    weight[idx] += score;
    sumR[idx] += r * score; sumG[idx] += g * score; sumB[idx] += b * score;
    count[idx]++;
  }
  let bestIdx = -1, bestWeight = 0;
  for (let i = 0; i < BUCKETS; i++) {
    // Require a few corroborating pixels so a single outlier can't win a bucket.
    if (count[i] >= 3 && weight[i] > bestWeight) { bestWeight = weight[i]; bestIdx = i; }
  }
  if (bestIdx < 0 || bestWeight <= 0.15) return null;
  const avgR = sumR[bestIdx] / weight[bestIdx];
  const avgG = sumG[bestIdx] / weight[bestIdx];
  const avgB = sumB[bestIdx] / weight[bestIdx];
  const [h, s, l] = rgbToHsl(avgR, avgG, avgB);
  return hslToRgb(h, Math.min(1, s * 1.22), Math.min(0.72, Math.max(0.46, l)));
}
// Generic: load an image, sample it on a throwaway canvas — its own
// canvas per call, so concurrent callers (several presence cards
// resolving at once) can't race each other drawing into a shared one —
// and resolve [r,g,b] or null. Never throws.
function sampleImageColor(imgUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const SIZE = 24;
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        resolve(dominantColorFromPixels(ctx.getImageData(0, 0, SIZE, SIZE).data));
      } catch (e) { resolve(null); } // CORS-blocked or similar
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}

// ══════════════════════════════════════════
//  ALBUM ART → ACCENT COLOR EXTRACTION
//  Samples dominant vibrant color from art,
//  pushes it as --accent-rgb on <html>.
//  Reverts to default accent when not playing.
// ══════════════════════════════════════════
(function() {
  const sc = document.createElement('canvas');
  const SAMPLE_SIZE = 24;
  sc.width = sc.height = SAMPLE_SIZE;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  let _last = '';
  let _sampleToken = 0; // guards against a slower, since-superseded sample() call winning a race

  function sample(src) {
    if (!src || src === _last) return;
    _last = src;
    const mySampleToken = ++_sampleToken;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (mySampleToken !== _sampleToken) return; // a newer track change superseded this sample
      try {
        sctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const px = sctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
        // Monochrome/colorless art (a plain black square like Donda, or
        // mostly-white art with black line-art/text like Circles) falls
        // back to the theme's own neutral accent — it's already tuned to
        // read clearly against this UI regardless of theme.
        const bestRgb = dominantColorFromPixels(px) || _defaultAccentRgb();
        tweenAccentRgb(bestRgb, 650);
        // The room "lights up" the instant we actually know the color —
        // not the instant playback starts, so the flash always lands in the right hue.
        document.body.classList.remove('ambient-flash');
        void document.body.offsetWidth;
        document.body.classList.add('ambient-flash');
      } catch(e) { /* CORS blocked — keep default accent */ }
    };
    img.src = src;
  }
  window._klabSampleAccent = sample;

  function watchNode(node) {
    if (!node) return;
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'attributes' && m.target.tagName === 'IMG') sample(m.target.src);
        for (const n of m.addedNodes) if (n.tagName === 'IMG' && n.src) sample(n.src);
      }
    }).observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    node.querySelectorAll('img').forEach(i => sample(i.src));
  }

  watchNode(document.getElementById('fsArt'));
  watchNode(document.getElementById('playerArtWrap'));
  const da = document.querySelector('.player-art');
  if (da) new MutationObserver(() => sample(da.src)).observe(da, { attributes: true, attributeFilter: ['src'] });

  // Revert to default accent when paused; re-sample on resume
  new MutationObserver(() => {
    if (!document.body.classList.contains('is-playing')) {
      tweenAccentRgb(_defaultAccentRgb(), 550, () => {
        document.documentElement.style.removeProperty('--accent-rgb');
      });
      _last = ''; // cleared so resume re-triggers extraction
    } else {
      // Resumed — _last was cleared on pause so sample() will re-run
      const img = document.querySelector('#playerArtWrap img')
               || document.querySelector('#fsArt img')
               || document.querySelector('.player-art');
      if (img && img.src) sample(img.src);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();

// ══════════════════════════════════════════
//  ARTIST / ALBUM PAGE PANEL
// ══════════════════════════════════════════
(function() {
  const panel    = document.getElementById('apPanel');
  const bg       = document.getElementById('apBg');
  const scroll   = document.getElementById('apScroll');
  const titleEl  = document.getElementById('apTopbarTitle');
  const backBtn  = document.getElementById('apBack');
  if (!panel) return;

  let _stack = [];
  // Guards openArtistPage/openAlbumPage against out-of-order network
  // responses: opening B before A's fetch resolves must not let A's
  // late response overwrite B's already-rendered panel.
  let _apLoadToken = 0;

  function fmtDur(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2,'0')}`;
  }
  function strip(html) {
    return (html || '').replace(/<[^>]+>/g,'')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<')
      .replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
  }
  function panelOpen() {
    // Inline in the Music tab now — no fixed-position modal to fade in over
    // content, so a plain class toggle is enough (see the scoped
    // .tab-panel[data-tab-panel="music"] .ap-panel/.ap-panel.open CSS rules).
    panel.classList.add('open');
    document.body.classList.add('ap-open');
    SFX && SFX.play('nav');
  }
  function panelClose() {
    // No separate picker overlay to suspend/restore any more — the browse
    // view is just the sibling content that's already sitting there,
    // revealed the instant this detail view hides.
    panel.classList.remove('open');
    document.body.classList.remove('ap-open');
    _stack = [];
    scroll.innerHTML = '';
    bg.style.backgroundImage = '';
  }
  // Exposed so the sidebar (.picker-tab rows, playlist rows, search box —
  // all defined earlier in the file, outside this IIFE) can close the
  // detail view when navigating away from it. Without this, clicking a
  // sidebar nav button while an album/artist page was open silently did
  // nothing visible: it still loaded new content into #pickerList behind
  // the scenes, but .picker-backdrop stays display:none while body.ap-open
  // is set (see the CSS), so you'd just keep looking at the stale open
  // album/artist page — reading as "the sidebar buttons are broken".
  window.closeApPanel = panelClose;
  function panelBack() {
    if (_stack.length > 1) {
      _stack.pop();
      _stack[_stack.length - 1]();
      SFX && SFX.play('nav_back');
    } else {
      panelClose();
    }
  }

  backBtn.addEventListener('click', panelBack);
  // Click outside the card (on the backdrop) to close
  panel.addEventListener('click', e => { if (e.target === panel) panelClose(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) panelClose();
  });
  trapFocusWithin(panel.querySelector('.ap-card'), () => panel.classList.contains('open'));
  scroll.addEventListener('scroll', () => {
    titleEl.classList.toggle('vis', scroll.scrollTop > 160);
  }, { passive: true });

  let _lastApHover = 0;
  // .ap-btn-play/.ap-btn-queue deliberately excluded — they're small
  // targets sitting right next to each other on every track row, so
  // hovering around to click one tended to re-trigger the sound rapidly
  // (every track row itself still gets a hover cue via .ap-track).
  const apSoundTargets = '.ap-track,.ap-disc-card,.ap-sim-chip,.ap-read-more,.ap-back,.ap-close,.ap-hero-artist-link';
  panel.addEventListener('pointerover', e => {
    const target = e.target.closest(apSoundTargets);
    if (!target || target._apHovered) return;
    target._apHovered = true;
    const now = Date.now();
    if (now - _lastApHover > 90) {
      _lastApHover = now;
      SFX && SFX.play('hover');
    }
  }, { passive: true });
  panel.addEventListener('pointerout', e => {
    const target = e.target.closest(apSoundTargets);
    if (!target) return;
    const to = e.relatedTarget;
    if (to && target.contains(to)) return;
    target._apHovered = false;
  }, { passive: true });
  panel.addEventListener('click', e => {
    if (e.target.closest(apSoundTargets)) SFX && SFX.play('click');
  }, true);

  function setBg(url) {
    if (!url) return;
    bg.style.backgroundImage = `url(${url})`;
  }

  function loading() {
    scroll.innerHTML = '<div class="ap-loading"><i class="ti ti-loader loading-spinner"></i> loading...</div>';
  }

  // ── Track row builder ────────────────────
  function buildTrack(song, idx, songs, showArt) {
    const isNow = playerState?.currentSong?.id === song.id;
    // size=80 — ~2.3x the 34px .ap-track-art box, was 150.
    const artUrl = showArt && song.coverArt
      ? `${ND_URL}/rest/getCoverArt?id=${song.coverArt}&size=80&${subsonicParams()}` : '';
    const row = document.createElement('div');
    row.className = 'ap-track' + (isNow ? ' ap-now' : '');
    row.dataset.songId = song.id;
    row.innerHTML = `
      <span class="ap-track-num">${idx + 1}</span>
      ${artUrl ? `<img class="ap-track-art" src="${artUrl}" loading="lazy" onerror="this.style.display='none'" />` : ''}
      <div class="ap-track-info">
        <div class="ap-track-title">${esc(song.title)}</div>
        ${song.artist ? `<div class="ap-track-sub">${esc(song.artist)}</div>` : ''}
      </div>
      ${song.duration ? `<span class="ap-track-dur">${fmtDur(song.duration)}</span>` : ''}
      <button class="ap-track-play"><i class="ti ti-player-play"></i></button>`;
    row.addEventListener('click', () => {
      playerState.playlist = songs;
      playerState.playlistIndex = idx;
      playSong(song);
      SFX && SFX.play('click');
    });
    // Every other song row in the app (the main library, favorites, queue,
    // playlists — anything built via renderSongItem()) has right-click for
    // play/queue/favorite/add-to-playlist/etc.; this track list was the one
    // place that didn't.
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      showSongCtx(e.clientX, e.clientY, song, songs);
    });
    return row;
  }

  // ── Bio expander ─────────────────────────
  function wirebio(bioEl, btnEl) {
    if (!bioEl || !btnEl) return;
    // give browser a tick to paint so scrollHeight is real
    requestAnimationFrame(() => {
      if (bioEl.scrollHeight > 80) {
        btnEl.style.display = 'block';
        btnEl.addEventListener('click', () => {
          const exp = bioEl.classList.toggle('exp');
          btnEl.textContent = exp ? 'Read less' : 'Read more';
        });
      }
    });
  }

  // ══════════════════════════════════════════
  //  OPEN ARTIST PAGE
  // ══════════════════════════════════════════
  window.openArtistPage = async function(artistId, artistName) {
    if (!panel.classList.contains('open')) panelOpen();
    titleEl.textContent = artistName || '';
    titleEl.classList.remove('vis');

    const renderFn = async () => {
      loading();
      const myLoadToken = ++_apLoadToken;
      try {
        const [artRes, infoRes, topRes] = await Promise.allSettled([
          fetchTimeout(`${ND_URL}/rest/getArtist?id=${artistId}&${subsonicParams()}`, {}, 8000).then(r=>r.json()),
          fetchTimeout(`${ND_URL}/rest/getArtistInfo2?id=${artistId}&count=10&${subsonicParams()}`, {}, 8000).then(r=>r.json()),
          fetchTimeout(`${ND_URL}/rest/getTopSongs?artist=${encodeURIComponent(artistName)}&count=5&${subsonicParams()}`, {}, 8000).then(r=>r.json()),
        ]);
        if (myLoadToken !== _apLoadToken) return; // superseded by a newer openArtistPage/openAlbumPage call

        const artist   = artRes.status  === 'fulfilled' ? artRes.value['subsonic-response']?.artist        : null;
        const info     = infoRes.status === 'fulfilled' ? infoRes.value['subsonic-response']?.artistInfo2  : null;
        const topSongs = topRes.status  === 'fulfilled' ? (topRes.value['subsonic-response']?.topSongs?.song || []) : [];

        // Hero image: prefer Last.fm, fall back to first album art
        let heroUrl = info?.largeImageUrl || info?.mediumImageUrl || '';
        if ((!heroUrl || heroUrl.includes('2a96cbd8b46e442fc41c2b86b821562f')) && artist?.album?.length) {
          // Last.fm placeholder detected — use album art instead
          heroUrl = `${ND_URL}/rest/getCoverArt?id=${artist.album[0].coverArt}&size=800&${subsonicParams()}`;
        }
        if (heroUrl) setBg(heroUrl);

        const frag = document.createDocumentFragment();

        // Compact hero card — picker aesthetic, not Spotify full-bleed
        const hero = document.createElement('div');
        hero.className = 'ap-hero';
        hero.innerHTML = `
          ${heroUrl
            ? `<img class="ap-hero-img" src="${heroUrl}" onerror="klabArtFallback(this,'ap-hero-img-ph','ti-user-circle')" />`
            : `<div class="ap-hero-img-ph"><i class="ti ti-user-circle"></i></div>`}
          <div class="ap-hero-meta">
            <span class="ap-hero-kicker">Artist</span>
            <div class="ap-hero-name">${esc(artistName)}</div>
            ${artist?.album ? `<div class="ap-hero-sub">${artist.album.length} album${artist.album.length!==1?'s':''} in library</div>` : ''}
          </div>`;
        frag.appendChild(hero);

        const body = document.createElement('div');
        body.className = 'ap-body';

        // Bio
        if (info?.biography) {
          const bio = strip(info.biography);
          const bioLabel = document.createElement('div');
          bioLabel.className = 'ap-sec-label'; bioLabel.textContent = 'About';
          const bioEl  = document.createElement('div'); bioEl.className = 'ap-bio'; bioEl.textContent = bio;
          const bioBtn = document.createElement('button'); bioBtn.className = 'ap-read-more'; bioBtn.textContent = 'Read more'; bioBtn.style.display='none';
          body.append(bioLabel, bioEl, bioBtn);
          wirebio(bioEl, bioBtn);
        }

        // Top songs
        if (topSongs.length) {
          const lbl = document.createElement('div'); lbl.className = 'ap-sec-label'; lbl.textContent = 'Popular';
          body.appendChild(lbl);
          topSongs.forEach((s,i) => body.appendChild(buildTrack(s, i, topSongs, true)));
        }

        // Discography
        if (artist?.album?.length) {
          const sorted = [...artist.album].sort((a,b) => (b.year||0)-(a.year||0));
          const lbl = document.createElement('div'); lbl.className = 'ap-sec-label'; lbl.textContent = 'Discography';
          const grid = document.createElement('div'); grid.className = 'ap-disc-grid';
          sorted.forEach(album => {
            const artUrl = `${ND_URL}/rest/getCoverArt?id=${album.coverArt}&size=300&${subsonicParams()}`;
            const card = document.createElement('div'); card.className = 'ap-disc-card';
            card.innerHTML = `<img src="${artUrl}" loading="lazy" alt="" /><div class="ap-disc-card-title">${esc(album.name||album.title)}</div><div class="ap-disc-card-year">${album.year||''}</div>`;
            card.addEventListener('click', () => window.openAlbumPage(album.id, album.name||album.title));
            grid.appendChild(card);
          });
          body.append(lbl, grid);
        }

        // Similar artists
        if (info?.similarArtist?.length) {
          const lbl = document.createElement('div'); lbl.className = 'ap-sec-label'; lbl.textContent = 'Similar Artists';
          const chips = document.createElement('div'); chips.className = 'ap-similar';
          info.similarArtist.slice(0,14).forEach(sim => {
            const chip = document.createElement('span'); chip.className = 'ap-sim-chip'; chip.textContent = sim.name;
            chip.addEventListener('click', async () => {
              // Search catalog for this artist
              try {
                const r = await fetchTimeout(`${ND_URL}/rest/search3?query=${encodeURIComponent(sim.name)}&artistCount=1&albumCount=0&songCount=0&${subsonicParams()}`, {}, 8000);
                const d = await r.json();
                const found = d['subsonic-response']?.searchResult3?.artist?.[0];
                if (found) window.openArtistPage(found.id, found.name);
                else window.openArtistPage(sim.id || '', sim.name); // try with Last.fm id as fallback
              } catch(e) {}
            });
            chips.appendChild(chip);
          });
          body.append(lbl, chips);
        }

        frag.appendChild(body);
        scroll.innerHTML = '';
        scroll.appendChild(frag);
        scroll.scrollTop = 0;

      } catch(e) {
        if (myLoadToken !== _apLoadToken) return;
        scroll.innerHTML = `<div class="ap-error"><i class="ti ti-alert-triangle"></i> Failed to load artist</div>`;
      }
    };

    _stack.push(renderFn);
    await renderFn();
  };

  // ══════════════════════════════════════════
  //  OPEN ALBUM PAGE
  // ══════════════════════════════════════════
  window.openAlbumPage = async function(albumId, albumName) {
    if (!panel.classList.contains('open')) panelOpen();
    titleEl.textContent = albumName || '';
    titleEl.classList.remove('vis');

    const renderFn = async () => {
      loading();
      const myLoadToken = ++_apLoadToken;
      try {
        const [albRes, infoRes] = await Promise.allSettled([
          fetchTimeout(`${ND_URL}/rest/getAlbum?id=${albumId}&${subsonicParams()}`, {}, 8000).then(r=>r.json()),
          fetchTimeout(`${ND_URL}/rest/getAlbumInfo2?id=${albumId}&${subsonicParams()}`, {}, 8000).then(r=>r.json()),
        ]);
        if (myLoadToken !== _apLoadToken) return; // superseded by a newer openArtistPage/openAlbumPage call

        const album = albRes.status  === 'fulfilled' ? albRes.value['subsonic-response']?.album    : null;
        const info  = infoRes.status === 'fulfilled' ? infoRes.value['subsonic-response']?.albumInfo : null;

        if (!album) { scroll.innerHTML = '<div class="ap-error"><i class="ti ti-alert-triangle"></i> Album not found</div>'; return; }

        const songs  = album.song || [];
        const artLg  = album.coverArt ? `${ND_URL}/rest/getCoverArt?id=${album.coverArt}&size=800&${subsonicParams()}` : '';
        const artSm  = album.coverArt ? `${ND_URL}/rest/getCoverArt?id=${album.coverArt}&size=300&${subsonicParams()}` : '';
        const totSec = songs.reduce((s,t) => s+(t.duration||0), 0);
        const durStr = totSec > 3600
          ? `${Math.floor(totSec/3600)}h ${Math.floor((totSec%3600)/60)}m`
          : `${Math.floor(totSec/60)} min`;

        if (artLg) setBg(artLg);

        const frag = document.createDocumentFragment();

        // Compact hero card — same picker aesthetic
        const hero = document.createElement('div');
        hero.className = 'ap-hero';
        hero.innerHTML = `
          ${artSm
            ? `<img class="ap-hero-img square" src="${artSm}" onerror="klabArtFallback(this,'ap-hero-img-ph square','ti-vinyl')" />`
            : `<div class="ap-hero-img-ph square"><i class="ti ti-vinyl"></i></div>`}
          <div class="ap-hero-meta">
            <span class="ap-hero-kicker">Album</span>
            <div class="ap-hero-name">${esc(album.name||album.title)}</div>
            <div class="ap-hero-artist-link" data-artist-id="${esc(album.artistId)}" data-artist-name="${esc(album.artist)}">${esc(album.artist)}</div>
            <div class="ap-hero-sub">${[album.year, `${songs.length} track${songs.length!==1?'s':''}`, durStr].filter(Boolean).join(' · ')}</div>
          </div>`;
        frag.appendChild(hero);

        const body = document.createElement('div');
        body.className = 'ap-body';

        // Actions
        const actions = document.createElement('div'); actions.className = 'ap-actions';
        const playBtn  = document.createElement('button'); playBtn.className = 'ap-btn-play';
        playBtn.innerHTML = '<i class="ti ti-player-play"></i> Play';
        // Reuses the same global shuffle the dock/fullscreen-player shuffle
        // buttons already use (_shuffleOn + syncShuffleBtns()), not a
        // separate one-off shuffle just for this button — stays in sync
        // with those icons and with how "next track" behaves afterward.
        const shuffleBtn = document.createElement('button'); shuffleBtn.className = 'ap-btn-queue';
        shuffleBtn.innerHTML = '<i class="ti ti-arrows-shuffle"></i> Shuffle';
        const queueBtn = document.createElement('button'); queueBtn.className = 'ap-btn-queue';
        queueBtn.innerHTML = '<i class="ti ti-playlist-add"></i> Queue all';
        // While a song from this album is what's playing, the button is
        // Pause (and Play resumes it) instead of restarting the album.
        const albumId = album.id;
        const fromThisAlbum = () => !!playerState.currentSong && playerState.currentSong.albumId === albumId;
        const syncPlayBtn = () => {
          const playing = fromThisAlbum() && !playerState.audio.paused;
          playBtn.innerHTML = playing ? '<i class="ti ti-player-pause"></i> Pause' : '<i class="ti ti-player-play"></i> Play';
        };
        playBtn.addEventListener('click', () => {
          if (!songs.length) return;
          SFX && SFX.play('click');
          if (fromThisAlbum()) { playerState.audio.paused ? playerState.audio.play().catch(() => {}) : playerState.audio.pause(); return; }
          playerState.playlist = songs; playerState.playlistIndex = 0;
          playSong(songs[0]);
        });
        // One listener set per open page; each removes itself once this
        // page's button has left the DOM.
        const onAudio = () => { if (!playBtn.isConnected) { for (const t of ['play', 'pause', 'loadstart']) playerState.audio.removeEventListener(t, onAudio); return; } syncPlayBtn(); };
        for (const t of ['play', 'pause', 'loadstart']) playerState.audio.addEventListener(t, onAudio);
        syncPlayBtn();
        shuffleBtn.addEventListener('click', () => {
          if (!songs.length) return;
          playerState.playlist = songs;
          _shuffleOn = true; syncShuffleBtns();
          const i = Math.floor(Math.random() * songs.length);
          playerState.playlistIndex = i;
          playSong(songs[i]); SFX && SFX.play('click');
        });
        queueBtn.addEventListener('click', () => {
          songs.forEach(s => addToQueue(s)); SFX && SFX.play('queue');
        });
        // Original quality only, as a ZIP straight from Navidrome — see
        // downloadAlbumZip. Per-track MP3 lives in the song context menu.
        const dlBtn = document.createElement('button'); dlBtn.className = 'ap-btn-queue';
        dlBtn.innerHTML = '<i class="ti ti-download"></i> Download';
        dlBtn.title = 'Download this album as a ZIP (original quality)';
        dlBtn.addEventListener('click', () => {
          downloadAlbumZip(albumId, album.name || album.title);
          SFX && SFX.play('click');
        });
        actions.append(playBtn, shuffleBtn, queueBtn, dlBtn);
        body.appendChild(actions);

        // Tracks
        const tracksLabel = document.createElement('div'); tracksLabel.className = 'ap-sec-label'; tracksLabel.textContent = 'Tracks';
        body.appendChild(tracksLabel);
        songs.forEach((s,i) => {
          // For albums, override track num with actual track number
          const row = buildTrack(s, i, songs, false);
          row.querySelector('.ap-track-num').textContent = s.track || i+1;
          // Show artist only if it differs from album artist (feat. etc.)
          if (s.artist !== album.artist && row.querySelector('.ap-track-sub')) {
            row.querySelector('.ap-track-sub').textContent = s.artist;
          } else if (row.querySelector('.ap-track-sub')) {
            row.querySelector('.ap-track-sub').remove();
          }
          body.appendChild(row);
        });

        // Album notes
        if (info?.notes) {
          const notes = strip(info.notes);
          const lbl  = document.createElement('div'); lbl.className = 'ap-sec-label'; lbl.textContent = 'About this album';
          const bioEl = document.createElement('div'); bioEl.className = 'ap-bio'; bioEl.textContent = notes;
          const btn   = document.createElement('button'); btn.className = 'ap-read-more'; btn.textContent = 'Read more'; btn.style.display='none';
          body.append(lbl, bioEl, btn);
          wirebio(bioEl, btn);
        }

        frag.appendChild(body);
        scroll.innerHTML = '';
        scroll.appendChild(frag);
        scroll.scrollTop = 0;

        // Wire artist link
        scroll.querySelector('.ap-hero-artist-link')?.addEventListener('click', e => {
          const {artistId, artistName} = e.currentTarget.dataset;
          if (artistId) window.openArtistPage(artistId, artistName);
        });

      } catch(e) {
        if (myLoadToken !== _apLoadToken) return;
        scroll.innerHTML = `<div class="ap-error"><i class="ti ti-alert-triangle"></i> Failed to load album</div>`;
      }
    };

    _stack.push(renderFn);
    await renderFn();
  };

})();

// ══════════════════════════════════════════
//  PRESENCE RAIL SCROLL BOUNDS
//  See the comment on .presence-rail's CSS max-height for why this needs
//  to be measured rather than left as a CSS calc(): enough listeners to
//  actually approach that cap made the rail's box extend past the
//  viewport at the page's initial (pre-scroll) layout, so the whole PAGE
//  became scrollable by the overshoot instead of just the rail scrolling
//  internally. Also drives the "more below" fade/chevron hint.
// ══════════════════════════════════════════
(function() {
  const rail = document.querySelector('.presence-rail');
  const more = document.getElementById('presenceRailMore');
  if (!rail) return;
  let pending = false;
  function updateMoreHint() {
    if (!more) return;
    const hasMore = rail.scrollHeight > rail.clientHeight + 2
      && (rail.scrollTop + rail.clientHeight) < rail.scrollHeight - 2;
    more.hidden = !hasMore;
  }
  function update() {
    pending = false;
    // The narrow-width breakpoint already sets max-height:none/
    // position:static via its own media query — don't fight it with an
    // inline style left over from a wider viewport.
    if (window.innerWidth <= 880) {
      rail.style.maxHeight = '';
    } else {
      const top = rail.getBoundingClientRect().top;
      const available = window.innerHeight - top - 24; // ~1.5rem breathing room at the bottom
      rail.style.maxHeight = Math.max(120, available) + 'px';
    }
    updateMoreHint();
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  // updateMoreHint reads scrollHeight/clientHeight/scrollTop and then writes
  // `hidden`, which invalidates layout — so the next scroll event's read
  // forces a fresh synchronous reflow, once per scroll event. Coalescing
  // into a frame is the same treatment update() above already gets.
  let hintPending = false;
  function scheduleMoreHint() {
    if (hintPending) return;
    hintPending = true;
    requestAnimationFrame(() => { hintPending = false; updateMoreHint(); });
  }
  rail.addEventListener('scroll', scheduleMoreHint, { passive: true });
  // New/removed listeners change rail.scrollHeight — recheck the hint
  // (not the max-height, which only depends on viewport geometry).
  new MutationObserver(scheduleMoreHint).observe(rail, { childList: true, subtree: true });
  schedule();
})();

// ══════════════════════════════════════════
//  MAIN PAGE SCROLL CLEARANCE
//  The floating player dock needs the page to leave room below the last
//  section so content doesn't end up hidden behind it — but that clearance
//  should only exist when the page is already tall enough to scroll.
//  Otherwise a dashboard with just a few tiles ends up scrollable into
//  empty space for no reason.
// ══════════════════════════════════════════
(function() {
  const dash = document.querySelector('.dash');
  if (!dash) return;
  let pending = false;
  function update() {
    pending = false;
    const root = document.documentElement;
    // Measure arithmetically instead of by mutating. The old version
    // removed the class to ask "would this scroll without the clearance",
    // which shrank the document by 7rem — the browser clamps the scroll
    // offset the instant that happens — and then put the class back and
    // tried to undo the damage with window.scrollTo(). That scrollTo was
    // the actual bug: it ran on every mutation inside .dash, and the
    // player dock's progress bar writes an inline style ~4x/second while
    // a track plays, so it fired ~4x/second, each time aborting the
    // browser's in-progress smooth scroll and pinning the offset to a
    // stale value sampled at the top of the frame. That is "scrolling
    // down does not work, the page snaps back up", and it explains why a
    // paused player never triggered it.
    //
    // Subtracting the padding we already know we applied gives the same
    // answer without ever changing the document height, so there is
    // nothing to restore and no scroll write at all.
    //
    // clientHeight, not window.innerHeight: both scrollHeight and
    // clientHeight are read off <html>, so they share its coordinate
    // space. innerHeight does not, and the html{zoom} tiers would make
    // the comparison wrong by exactly the zoom factor on the 1080p-at-
    // 125%-scaling displays where this was reported.
    const on  = dash.classList.contains('dash-clearance');
    const pad = on ? (parseFloat(getComputedStyle(dash).paddingBottom) || 0) : 0;
    dash.classList.toggle('dash-clearance', (root.scrollHeight - pad) > root.clientHeight);
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }
  // Any content change inside .dash (tiles added/removed, edit mode, etc.)
  // — ignore our own class toggle on .dash so this can't trigger itself,
  // and ignore the two descendants that are positioned out of flow and so
  // cannot change .dash's content height no matter what they do: the fixed
  // player dock (progress bar + clock, written several times a second) and
  // the absolutely-positioned MOTD (rerolls on a 45-75s timer). Those two
  // were generating essentially all of this observer's traffic.
  const dock = document.getElementById('playerDock');
  const motd = document.getElementById('motd');
  const outOfFlow = t => (dock && dock.contains(t)) || (motd && motd.contains(t));
  new MutationObserver(muts => {
    if (muts.some(m => !(m.target === dash && m.attributeName === 'class') && !outOfFlow(m.target))) schedule();
  }).observe(dash, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  // body class changes (edit-mode, etc.) can also affect .dash's height via CSS
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  schedule();
})();


