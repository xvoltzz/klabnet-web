// ══════════════════════════════════════════
//  HOME — a plain landing page: "hi :)".
//    · The greeting, today's date and how many are online.
//    · What's new: the newest commits to klabnet (klabnet-api's
//      /api/changes asks Gitea for them), a day at a time, each one opening
//      to its whole message.
//    · The version and a link to the source at the foot.
//  It only fetches while Home is showing. Dates are Eastern, where
//  everyone is.
// ══════════════════════════════════════════
(function() {
  const page = document.getElementById('homePage');
  if (!page) return;
  const $ = id => document.getElementById(id);
  const TZ = 'America/New_York';
  const REFRESH_MS = 5 * 60e3;
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
  const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  let active = false, timer = 0, loadedAt = 0, commits = null, failed = false;

  // ── Who's here ──
  function paintPeople() {
    const n = Math.max(1, window.KLAB_ONLINE_USERNAMES?.size || 1);
    $('hpSub').textContent = dayFmt.format(new Date()) + ' · ' + n + ' online';
  }
  const presenceChanged = window.klabHomePresenceChanged;
  window.klabHomePresenceChanged = () => { presenceChanged?.(); if (active) paintPeople(); };

  // ── What's new ──
  const when = s => new Date(s).getTime() || 0;
  // An icon for what a commit touches, read off its title: tests first,
  // then the part of klabnet, then the kind of change. Only icons the
  // font has.
  const GLYPHS = [
    [/\btests?\b|smoke|audit|\bchecks?\b/, 'ti-list-check'],
    [/\bvoice|livekit|\bvc\b/, 'ti-headset'],
    [/music|song|album|playlist|player|\bdock|artist|genre|navidrome|lyric/, 'ti-music'],
    [/photo|slideshow|timeline|filmstrip/, 'ti-photo'],
    [/chat|\bdms?\b|message|channel|matrix/, 'ti-message-circle'],
    [/feed|\bposts?\b|repl(y|ies)|mention/, 'ti-news'],
    [/presence|online|profile|avatar|social|people/, 'ti-users'],
    [/\bhome\b/, 'ti-home'],
    [/setting|pref/, 'ti-settings'],
    [/phone|mobile|touch/, 'ti-device-mobile'],
    [/keyboard|\bkeys?\b/, 'ti-keyboard'],
    [/\bfix|bug|broke|crash|stale|regress/, 'ti-bug'],
    [/\bdrop|remov|clean|dead|unused/, 'ti-trash'],
    [/style|\bcss\b|look|theme|colou?r|design|font|icon|animat/, 'ti-palette'],
  ];
  const glyph = c => {
    const t = (c.title || '').toLowerCase();
    const hit = GLYPHS.find(([re]) => re.test(t));
    return hit ? hit[1] : c.repo === 'klabnet-api' ? 'ti-source-code' : 'ti-git-branch';
  };
  function paintChanges() {
    const el = $('hpChanges');
    if (!commits) {
      el.innerHTML = '<p class="hp-note">' + (failed ? 'Couldn’t reach the git server just now.' : 'Loading…') + '</p>';
      return;
    }
    if (!commits.length) { el.innerHTML = '<p class="hp-note">Nothing yet.</p>'; return; }
    const open = new Set([...el.querySelectorAll('details[open]')].map(d => d.dataset.sha));
    let html = '', day = '';
    commits.forEach(c => {
      const t = when(c.date), k = dayKey.format(t);
      if (k !== day) {
        if (day) html += '</ul>';
        day = k;
        html += '<h3 class="hp-day">' + esc(dayFmt.format(t)) + '</h3><ul class="hp-commits">';
      }
      const meta = '<span class="hp-meta"><span class="hp-repo">' + esc(c.repo.replace(/^klabnet-/, '')) + '</span>' +
        '<a class="hp-sha" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.sha) + '</a>' +
        '<span class="hp-time">' + esc(timeFmt.format(t)) + '</span></span>';
      const what = '<span class="hp-glyph"><i class="ti ' + glyph(c) + '"></i></span><span class="hp-what">' + esc(c.title) + '</span>';
      html += '<li>' + (c.body
        ? '<details data-sha="' + esc(c.sha) + '"' + (open.has(c.sha) ? ' open' : '') + '><summary>' + what + meta + '</summary>' +
          '<p class="hp-body">' + esc(c.body) + '</p></details>'
        : '<div class="hp-line">' + what + meta + '</div>') + '</li>';
    });
    el.innerHTML = html + '</ul>';
  }
  async function loadChanges() {
    if (Date.now() - loadedAt < REFRESH_MS && commits) return;
    try {
      const r = await fetchTimeout('/api/changes', {}, 12000);
      if (!r.ok) throw new Error('status ' + r.status);
      commits = (await r.json()).commits || [];
      failed = false;
      loadedAt = Date.now();
    } catch (e) { failed = true; }
    paintChanges();
    paintFoot();
  }

  function paintFoot() {
    const newest = commits?.[0];
    $('hpFoot').innerHTML = 'klabnet ' + esc(KLABNET_VERSION) +
      (newest ? ' &middot; last updated ' + esc(klabRelativeTime(when(newest.date))) : '') +
      ' &middot; <a href="https://git.klab.gg/xvoltzz/klabnet-web" target="_blank" rel="noopener">source</a>';
  }

  function refresh() {
    if (!active || document.hidden) return;
    paintPeople();
    loadChanges();
  }
  window.klabHomeTabChanged = show => {
    if (show === active) return;
    active = show;
    clearInterval(timer);
    if (active) { refresh(); timer = setInterval(refresh, 60e3); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  paintPeople();
  paintFoot();
  if (document.body.classList.contains('tab-home-active')) window.klabHomeTabChanged(true);
})();
