// ══════════════════════════════════════════
//  WHAT'S NEW: the changelog, in a sheet from Settings → About (it was on
//  Home until Home went minimal, 2026-11-20).
//    · The newest commits to klabnet (klabnet-api's /api/changes asks
//      Gitea for them), a day at a time, each one open to its whole
//      message (and closable).
//    · The version and a link to the source at the foot.
//  It only fetches while the sheet is open. Dates are Eastern, where
//  everyone is.
// ══════════════════════════════════════════
(function() {
  const row = document.getElementById('settingsWhatsNew');
  if (!row) return;
  const $ = id => document.getElementById(id);
  const TZ = 'America/New_York';
  const REFRESH_MS = 5 * 60e3;
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
  const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  let active = false, timer = 0, loadedAt = 0, commits = null, failed = false;

  // ── Changelog ──
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
    if (!el) return;
    if (!commits) {
      // Only a 502 from klabnet-api is Gitea itself not answering; the
      // rest is klabnet-api (or the way to it), so it says that instead.
      el.innerHTML = '<p class="hp-note">' + (failed === 404 ? 'The changelog needs the latest klabnet-api.'
        : failed === 502 ? 'Couldn’t reach the git server just now.'
        : failed ? 'Couldn’t load the changelog just now.' : 'Loading…') + '</p>';
      return;
    }
    // git wraps a message at ~72 columns; joined back up, it fills the
    // column it's in. Blank lines and list items keep their breaks.
    const unwrap = t => t.replace(/([^\n])\n(?!\n|\s*(?:[-*•]|\d+[.)])\s)(?=\S)/g, '$1 ');
    if (!commits.length) { el.innerHTML = '<p class="hp-note">Nothing yet.</p>'; return; }
    // Open by default (the explanations are the point); ones closed stay closed.
    const shut = new Set([...el.querySelectorAll('details:not([open])')].map(d => d.dataset.sha));
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
        ? '<details data-sha="' + esc(c.sha) + '"' + (shut.has(c.sha) ? '' : ' open') + '><summary>' + what + meta + '</summary>' +
          '<p class="hp-body">' + esc(unwrap(c.body)) + '</p></details>'
        : '<div class="hp-line">' + what + meta + '</div>') + '</li>';
    });
    el.innerHTML = html + '</ul>';
  }
  async function loadChanges() {
    if (Date.now() - loadedAt < REFRESH_MS && commits) return;
    try {
      // /api/posts/changes, since Caddy only forwards a fixed list of /api
      // prefixes and /api/changes isn't on it (its file server answered
      // with HTML). The plain path is asked too, where it does get through.
      const ask = path => fetchTimeout(path, {}, 12000);
      const missing = r => r.status === 404 || r.status === 405 || (r.ok && !/json/.test(r.headers.get('content-type') || ''));
      let r = await ask('/api/posts/changes');
      if (missing(r)) r = await ask('/api/changes');
      // An older klabnet-api has neither: a 404, or, past a proxy that
      // answers unknown paths with the page itself, HTML.
      const json = /json/.test(r.headers.get('content-type') || '');
      if (missing(r)) throw new Error('no endpoint');
      if (r.status === 502 && json && (await r.json().catch(() => ({}))).error === 'git unreachable') throw new Error('git');
      if (!r.ok) throw new Error('status ' + r.status);
      commits = (await r.json()).commits || [];
      failed = false;
      loadedAt = Date.now();
    } catch (e) { failed = e.message === 'no endpoint' ? 404 : e.message === 'git' ? 502 : true; }
    paintChanges();
    paintFoot();
  }

  function paintFoot() {
    if (!$('hpFoot')) return;
    const newest = commits?.[0];
    $('hpFoot').innerHTML = 'klabnet ' + esc(KLABNET_VERSION) +
      (newest ? ' &middot; last updated ' + esc(klabRelativeTime(when(newest.date))) : '') +
      ' &middot; <a href="https://git.klab.gg/xvoltzz/klabnet-web" target="_blank" rel="noopener">source</a>';
  }

  // ── The sheet ──
  let sheet = null, pop = null;
  function close() {
    if (!sheet?.classList.contains('open')) return;
    sheet.classList.remove('open');
    SFX?.play('sheet_close');
    pop?.(); pop = null;
    active = false;
    clearInterval(timer);
  }
  function open() {
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'add-app-backdrop hp-sheet-back';
      sheet.innerHTML = '<div class="add-app-modal hp-sheet" role="dialog" aria-modal="true" aria-labelledby="hpNewTitle" tabindex="-1">' +
        '<div class="add-app-title"><span id="hpNewTitle">What’s new</span><button type="button" class="k-icon sm add-app-close" title="Close" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
        '<div class="hp-log" id="hpChanges"><p class="hp-note">Loading&hellip;</p></div>' +
        '<footer class="hp-foot" id="hpFoot"></footer></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('.add-app-close')) close(); });
      if (commits) paintChanges();
      paintFoot();
    }
    // Already open (asked again): a second layer would be left behind.
    if (sheet.classList.contains('open')) return;
    sheet.classList.add('open');
    SFX?.play('sheet');
    pop = window.klabLayers?.push(sheet, { kind: 'dialog', dim: true, close });
    sheet.querySelector('.hp-sheet').focus({ preventScroll: true });
    active = true;
    loadChanges();
    clearInterval(timer);
    timer = setInterval(() => { if (active && !document.hidden) loadChanges(); }, 60e3);
  }
  row.addEventListener('click', open);
  window.klabWhatsNew = open;
})();
