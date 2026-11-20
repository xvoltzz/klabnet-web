// ══════════════════════════════════════════
//  THE PROMPT, AND GO ANYWHERE
//  Click "klabnet>" in the title bar, press d, : or Ctrl+K (⌘K), or the
//  title bar's "Go anywhere" box, and the prompt takes typing. Two things
//  at once (the refresh, 2026-11-19):
//    · A shell, as before: `cd music`, `cd music/albums`, `cd ..`, `ls`,
//      `pwd`, `help`, `exit`, `sharks` (js/37-ocean.js). Like fish, it
//      suggests the rest of what you're typing in grey; Tab or → takes it.
//    · A palette under the prompt, in the menu's look: whatever you type,
//      matched loosely (letters in order, word starts first) against the
//      pages and their sections, playlists, people (Enter: their profile;
//      Alt+Enter: a message), conversations, things to do (theme, scene,
//      status, play/pause…) and every row in Settings (opens it there,
//      the row lit for a moment). ↑/↓ choose, Enter runs, Escape leaves.
//      With nothing typed, ↑ goes back through what you've run.
//  Directories are the pages, Music's sections under music/ and Videos'
//  under videos/ (read off their sidebars, so they're always the ones
//  they have).
// ══════════════════════════════════════════
(function () {
  const prompt = document.querySelector('.header-left .terminal-prompt');
  const textEl = document.getElementById('promptText');
  const outEl = document.getElementById('promptMotd');
  const cursor = document.getElementById('promptCursor');
  if (!prompt || !textEl || !cursor) return;
  const root = document.documentElement;

  const ALL_PAGES = ['social', 'feed', 'chat', 'photos', 'videos', 'music'];
  // Only the ones that are on.
  let PAGES = ALL_PAGES;
  const pages = () => (PAGES = ALL_PAGES.filter(p => typeof isTabEnabled !== 'function' || isTabEnabled(p)));
  const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // A page's sections: name -> its sidebar row.
  function rowsOf(sel, skip) {
    const m = new Map();
    document.querySelectorAll(sel).forEach(b => {
      const name = slug(b.querySelector('span')?.textContent || b.textContent);
      if (name && name !== skip) m.set(name, b);
    });
    return m;
  }
  // (Each page's Browse row is the page itself: "cd music" goes there.)
  const musicDirs = () => rowsOf('.music-nav .picker-tab[data-tab]:not([data-tab="random"])');
  const videoDirs = () => rowsOf('#vidNav .picker-tab[data-vid]:not([data-vid="home"])');
  const dirsOf = p => p === 'music' ? musicDirs() : p === 'videos' ? videoDirs() : new Map();
  const page = () => document.querySelector('.tab-panel.active')?.dataset.tabPanel || 'home';
  const cwd = () => (page() === 'home' ? '~' : page());
  const pathOf = p => (p === '~' ? 'klabnet' : 'klabnet/' + p);

  // What a path means: { page, section? } or null.
  function resolve(arg) {
    let a = (arg || '~').trim().replace(/^klabnet\/?/, '').replace(/\/+$/, '');
    if (a === '' || a === '~' || a === '/' || a === 'home') return { page: 'home' };
    if (a === '..') return { page: 'home' };
    if (a.startsWith('~/') || a.startsWith('/')) a = a.replace(/^~?\//, '');
    const parts = a.split('/').filter(Boolean);
    pages();
    if (parts.length === 1) {
      if (PAGES.includes(parts[0])) return { page: parts[0] };
      // A section from inside its page.
      if (dirsOf(page()).has(parts[0])) return { page: page(), section: parts[0] };
      return null;
    }
    if (parts.length === 2 && dirsOf(parts[0]).has(parts[1])) return { page: parts[0], section: parts[1] };
    return null;
  }

  // Everything you could cd to, for suggestions and ls.
  function allDirs() {
    pages();
    const subs = ['music', 'videos'].flatMap(p => [...dirsOf(p).keys()].map(d => p + '/' + d));
    return ['~', ...PAGES, ...subs, ...dirsOf(page()).keys()];
  }
  function children(of) {
    if (of === 'home' || of === '~') return pages();
    return [...dirsOf(of).keys()];
  }

  const COMMANDS = ['cd', 'ls', 'pwd', 'help', '?', 'exit', 'clear', 'q', 'sudo', 'sharks', 'ocean', 'aquarium'];
  const isCommand = v => { const w = v.trim().split(/\s+/)[0]; return COMMANDS.includes(w) && (v.trim() === w || /\s/.test(v)); };

  const history = [];
  let hIdx = -1, input = null, ghost = null, outT = 0;

  function say(text) {
    if (!outEl) return;
    clearTimeout(outT);
    outEl.textContent = text ? '  ' + text : '';
    root.classList.toggle('term-said', !!text);
    if (text) outT = setTimeout(() => { outEl.textContent = ''; root.classList.remove('term-said'); }, 4200);
  }

  function suggest(v) {
    if (!v) return '';
    const fromHistory = [...history].reverse().find(h => h.startsWith(v) && h !== v);
    if (fromHistory) return fromHistory.slice(v.length);
    const m = /^(cd\s+|ls\s+)(\S*)$/.exec(v);
    if (m) {
      const hit = allDirs().find(d => d.startsWith(m[2]) && d !== m[2]);
      return hit ? hit.slice(m[2].length) : '';
    }
    if (!v.includes(' ')) {
      const cmd = ['cd ', 'ls', 'pwd', 'help', 'exit', 'clear', 'sharks'].find(c => c.startsWith(v) && c !== v);
      if (cmd) return cmd.slice(v.length);
    }
    return '';
  }

  // ══ The palette ══
  const fold = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // How well q matches t: 0 for not at all. Whole-word and word-start
  // matches first, then letters in order (the fewer gaps the better).
  // Also says which letters matched, to show them.
  function match(q, t) {
    const T = fold(t);
    if (!q) return { s: 1, pos: [] };
    const i = T.indexOf(q);
    if (i >= 0) {
      const start = i === 0 || /[\s\-/·(:]/.test(T[i - 1]);
      return { s: (i === 0 ? 100 : start ? 85 : 60) - i * 0.4 - T.length * 0.05, pos: [...Array(q.length)].map((_, k) => i + k) };
    }
    let from = 0, last = -1, gaps = 0, starts = 0;
    const pos = [];
    for (const c of q) {
      if (c === ' ') continue;
      const j = T.indexOf(c, from);
      if (j < 0) return null;
      if (last >= 0) gaps += j - last - 1;
      if (j === 0 || /[\s\-/·(:]/.test(T[j - 1])) starts++;
      pos.push(j); last = j; from = j + 1;
    }
    const s = 45 - gaps * 1.5 + starts * 5 - T.length * 0.05;
    // Scattered letters ("ali" in "Playlists") aren't a match.
    return s > 4 && gaps <= q.length * 2 ? { s, pos } : null;
  }
  function marked(text, pos) {
    if (!pos?.length) return esc(text);
    const set = new Set(pos);
    let out = '', open = false;
    [...text].forEach((ch, i) => {
      if (set.has(i) && !open) { out += '<b>'; open = true; }
      if (!set.has(i) && open) { out += '</b>'; open = false; }
      out += esc(ch);
    });
    return out + (open ? '</b>' : '');
  }

  // What there is to find, fresh each time it opens (or what's typed changes).
  const PAGE_INFO = {
    home: ['Home', 'ti-home'], social: ['Social', 'ti-users'], feed: ['Feed', 'ti-news'], chat: ['Chat', 'ti-message'],
    music: ['Music', 'ti-music'], photos: ['Photos', 'ti-photo'], videos: ['Videos', 'ti-movie'],
  };
  const press = id => () => document.getElementById(id)?.click();
  const iconOf = row => [...(row.querySelector('i.ti')?.classList || [])].find(c => c.startsWith('ti-')) || 'ti-point';
  function sources() {
    const out = [];
    const add = (o, bonus = 0) => out.push({ bonus, ...o });
    // Pages, and their sections.
    pages();
    ['home', ...PAGES].forEach(p => add({ id: 'p:' + p, label: PAGE_INFO[p][0], icon: PAGE_INFO[p][1], kind: 'Page', run: () => go({ page: p }) }, 14));
    for (const p of ['music', 'videos']) {
      if (!PAGES.includes(p)) continue;
      for (const [name, row] of dirsOf(p)) {
        const label = (row.querySelector('span')?.textContent || name).trim();
        add({ id: 's:' + p + '/' + name, label, icon: iconOf(row), kind: PAGE_INFO[p][0], keywords: p, run: () => go({ page: p, section: name }) }, 10);
      }
    }
    // Playlists (js/09b-playlists.js).
    if (typeof _pls !== 'undefined' && Array.isArray(_pls)) _pls.forEach(p => p?.name && add({
      id: 'pl:' + p.id, label: p.name, icon: 'ti-playlist', kind: 'Playlist', sub: p.owner && p.owner !== window.KLAB_USER?.username ? p.owner : '',
      run: () => { setActiveTab('music'); setTimeout(() => window.openPlaylistPage?.(p.id, p.name), 60); },
    }, 4));
    // Clips of a game (js/42-clips.js): "Clips · Elden Ring".
    (window.klabClips?.entries?.() || []).forEach(o => add(o, 3));
    // People: the profile; Alt+Enter, a message.
    const me = window.KLAB_USER?.username;
    const roster = [...new Set([...(window.klabRoster?.() || []), ...(window.klabPeople?.() || [])])].filter(u => u && u !== 'anonymous' && !u.endsWith('-bot'));
    const seen = new Set();
    roster.forEach(u => {
      if (seen.has(u.toLowerCase())) return; seen.add(u.toLowerCase());
      const mine = u === me, on = window.KLAB_ONLINE_USERNAMES?.has(u);
      add({ id: 'u:' + u, label: u, icon: 'ti-user', kind: 'Person', sub: mine ? 'you' : on ? 'online' : '',
        keywords: 'profile person', run: () => window.openProfileView?.(u),
        alt: mine ? null : () => window.messageUser?.(u), altHint: 'Message' }, on ? 3 : 1);
    });
    // Conversations (Chat's list, once chat's connected).
    document.querySelectorAll('.chat-conv[data-room-id]').forEach(row => {
      const name = row.querySelector('.chat-channel-name')?.textContent?.trim();
      if (!name) return;
      const dm = !!row.closest('#chatDmList');
      add({ id: 'c:' + row.dataset.roomId, label: dm ? name : '#' + name.replace(/^#/, ''), icon: dm ? 'ti-message' : 'ti-hash', kind: 'Chat',
        keywords: 'conversation message', run: () => window.openChatRoom?.(row.dataset.roomId) }, 2);
    });
    // Things to do.
    const dark = root.dataset.theme !== 'light';
    const scene = ['sky', 'wood', 'ocean'].includes(currentTheme) ? currentTheme : '';
    const st = typeof klabStatus === 'function' ? klabStatus() : '';
    const ps = typeof playerState !== 'undefined' ? playerState : null;
    const audio = ps?.audio, song = ps?.currentSong;
    const playing = !!song && audio && !audio.paused;
    const fxOn = !!window.KLAB_FX?.on?.(), oled = root.classList.contains('oled');
    const act = (label, icon, run, keywords, hint) => add({ id: 'a:' + label, label, icon, kind: 'Action', run, keywords, hint }, 8);
    act(dark ? 'Light theme' : 'Dark theme', dark ? 'ti-sun' : 'ti-moon', () => { applyTheme(dark ? 'light' : 'dark'); window.syncThemeRow?.(); }, 'appearance mode colour color');
    ['sky', 'wood', 'ocean'].filter(x => x !== scene).forEach(x => act('Scene: ' + x[0].toUpperCase() + x.slice(1), 'ti-palette', () => { applyTheme(x); window.syncThemeRow?.(); }, 'theme appearance'));
    if (scene) act('Scene off', 'ti-palette', () => { applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark'); window.syncThemeRow?.(); }, 'theme appearance none');
    if (typeof setKlabStatus === 'function') {
      if (st !== 'dnd') {
        act('Do not disturb for 1 hour', 'ti-bell-off', () => setKlabStatus('dnd', Date.now() + 36e5), 'dnd status quiet');
        const morning = new Date(); morning.setDate(morning.getDate() + 1); morning.setHours(8, 0, 0, 0);
        act('Do not disturb until tomorrow', 'ti-bell-off', () => setKlabStatus('dnd', +morning), 'dnd status quiet');
        act('Do not disturb', 'ti-bell-off', () => setKlabStatus('dnd'), 'dnd status quiet until I turn it off');
      } else act('Turn off do not disturb', 'ti-bell', () => setKlabStatus(''), 'dnd status');
      Object.entries(KLAB_STATUSES).filter(([k]) => k !== 'dnd' && k !== st).forEach(([k, v]) =>
        act('Status: ' + v.label, k === 'invisible' ? 'ti-eye-off' : k === 'away' ? 'ti-moon' : 'ti-point', () => setKlabStatus(k), 'status presence'));
    }
    act(fxOn ? 'Performance mode off' : 'Performance mode on', 'ti-flame', press('lowFxToggle'), 'effects blur fast');
    act(oled ? 'OLED black off' : 'OLED black on', 'ti-moon', press('oledToggle'), 'amoled pure dark');
    if (song) {
      act(playing ? 'Pause' : 'Play', playing ? 'ti-player-pause' : 'ti-player-play', press('btnPlay'), 'music song resume', 'Space');
      act('Next song', 'ti-player-skip-forward', press('btnNext'), 'skip track', 'n');
      act('Previous song', 'ti-player-skip-back', press('btnPrev'), 'back track', 'p');
      if (typeof openFS === 'function') act('Full player', 'ti-arrows-maximize', () => openFS(), 'now playing lyrics');
    }
    // The queue is the dock's popover (js/03-picker-tabs.js), not a section.
    if (song || (typeof queue !== 'undefined' && queue.length)) act('Queue', 'ti-playlist', () => window.klabQueuePop?.open({ detail: 0 }), 'up next songs queued reorder');
    act('Settings', 'ti-settings', () => openSettings(), 'preferences options');
    act('Keyboard shortcuts', 'ti-keyboard', press('keyHintsBtn'), 'keys hotkeys help', '?');
    act('Feedback', 'ti-message-dots', () => window.openFeedbackModal?.(), 'bug idea report');
    if (me && me !== 'anonymous') act('Your profile', 'ti-user-circle', () => window.openProfileView?.(me), 'me account note');
    act('Recap', 'ti-bell', press('recapBtn'), 'notifications new');
    act('Sharks', 'ti-terminal-2', () => window.klabOcean?.open(), 'ocean aquarium fish');
    // Every row in Settings that's there to see.
    document.querySelectorAll('#settingsBody .settings-section').forEach(sec => {
      if (sec.hidden || sec.classList.contains('set-account')) return;
      sec.querySelectorAll('.settings-row').forEach(row => {
        if (row.hidden) return;
        const lab = row.querySelector('.settings-row-label');
        const label = lab ? [...lab.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : '';
        if (!label) return;
        add({ id: 'set:' + label, label, icon: 'ti-settings', kind: 'Setting', sub: sec.dataset.title || '',
          keywords: [row.querySelector('.settings-row-sub')?.textContent, row.dataset.keywords, 'settings'].join(' '),
          run: () => window.klabShowSetting?.(row) }, 0);
      });
    });
    return out;
  }

  // No "Recent" group (owner: with so few places it's worthless); an empty
  // palette lists the pages. The old key is cleared once.
  try { localStorage.removeItem('klabnet_palette_recent'); } catch (e) {}

  let pal = null, list = [], sel = 0;
  function rank(v) {
    const q = fold(v).trim();
    const all = sources();
    if (!q) {
      return all.filter(o => o.kind === 'Page').map(o => ({ ...o, group: 'Pages' }));
    }
    const words = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const o of all) {
      let m = match(q, o.label);
      if (!m && words.length > 1) {
        // Every word somewhere in the label or what it's about.
        const hay = o.label + ' ' + (o.kind || '') + ' ' + (o.sub || '') + ' ' + (o.keywords || '');
        const ms = words.map(w => match(w, hay));
        if (ms.every(Boolean)) m = { s: ms.reduce((a, b) => a + b.s, 0) / ms.length * 0.6, pos: [] };
      }
      if (!m && o.keywords) { const k = match(q, o.keywords); if (k && k.s > 50) m = { s: k.s * 0.5, pos: [] }; }
      if (!m) continue;
      scored.push({ ...o, score: m.s + o.bonus, pos: m.pos });
    }
    scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    return scored.slice(0, 40);
  }

  function ensurePal() {
    if (pal) return pal;
    pal = document.createElement('div');
    pal.className = 'k-pal';
    pal.id = 'klabPalette';
    pal.setAttribute('role', 'listbox');
    pal.setAttribute('aria-label', 'Go anywhere');
    document.body.appendChild(pal);
    // Pressing a row runs it, without taking the focus off the prompt
    // (that would close it before the click).
    pal.addEventListener('mousedown', e => e.preventDefault());
    pal.addEventListener('click', e => {
      const r = e.target.closest('.k-pal-row');
      if (r) runItem(list[+r.dataset.i], e.altKey);
    });
    pal.addEventListener('pointermove', e => {
      const r = e.target.closest('.k-pal-row');
      if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; paintSel(false); }
    });
    return pal;
  }
  function placePal() {
    const r = prompt.getBoundingClientRect(), hdr = document.querySelector('.header')?.getBoundingClientRect();
    const z = typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1;
    const w = Math.min(560, innerWidth / z - 24);
    pal.style.width = w + 'px';
    pal.style.left = Math.max(12, Math.min(r.left / z - 10, innerWidth / z - w - 12)) + 'px';
    pal.style.top = ((hdr ? hdr.bottom : r.bottom) / z + 4) + 'px';
  }
  function render() {
    if (!input) return;
    const v = input.value;
    ensurePal();
    // A command being typed: the shell's line, the palette waits.
    const cmd = isCommand(v);
    list = cmd ? [{ id: 'cmd', label: v.trim(), icon: 'ti-terminal-2', kind: 'Command', run: () => run(v.trim()), cmd: true }] : rank(v);
    sel = Math.min(sel, Math.max(0, list.length - 1));
    if (!list.length) {
      pal.innerHTML = '<div class="k-pal-none">Nothing called “' + esc(v.trim()) + '”. <span>Try a page, a person or a setting.</span></div>';
    } else {
      let g = null, html = '';
      list.forEach((o, i) => {
        if (o.group && o.group !== g) { g = o.group; html += '<div class="k-pal-label k-label">' + esc(g) + '</div>'; }
        html += '<div class="k-pal-row" role="option" id="kpal-' + i + '" data-i="' + i + '">' +
          '<i class="ti ' + esc(o.icon || 'ti-point') + '"></i>' +
          '<span class="k-pal-text">' + marked(o.label, o.pos) + (o.sub ? '<span class="k-pal-sub">' + esc(o.sub) + '</span>' : '') + '</span>' +
          (o.alt ? '<span class="k-pal-alt">' + (KLAB_MAC ? '⌥' : 'Alt') + ' ↵ ' + esc(o.altHint) + '</span>' : '') +
          (o.hint ? '<kbd class="k-pal-key">' + esc(o.hint) + '</kbd>' : '') +
          '<span class="k-pal-kind">' + esc(o.kind) + '</span></div>';
      });
      pal.innerHTML = html;
    }
    if (!pal.classList.contains('open')) { placePal(); pal.classList.add('open'); }
    paintSel(true);
  }
  function paintSel(scroll) {
    if (!pal) return;
    pal.querySelectorAll('.k-pal-row').forEach(r => r.classList.toggle('sel', +r.dataset.i === sel));
    const row = pal.querySelector('.k-pal-row.sel');
    input?.setAttribute('aria-activedescendant', row ? row.id : '');
    if (row && scroll) row.scrollIntoView({ block: 'nearest' });
    if (input) ghost.textContent = ghostFor(input.value);
  }
  // The grey rest of what you're typing: the shell's suggestion, or the
  // chosen row's name when it starts with what's typed.
  function ghostFor(v) {
    if (!input || input.selectionStart !== v.length || !v) return '';
    const s = suggest(v);
    if (s || isCommand(v)) return s;
    const o = list[sel];
    if (o && !o.cmd && fold(o.label).startsWith(fold(v)) && o.label.length > v.length) return o.label.slice(v.length).toLowerCase();
    return '';
  }

  function runItem(o, alt) {
    if (!o) return;
    const line = input?.value.trim() || '';
    if (o.cmd) { if (line && history[history.length - 1] !== line) history.push(line); close(); o.run(); return; }
    close();
    SFX?.play?.('nav');
    try { (alt && o.alt ? o.alt : o.run)(); } catch (e) { console.error('[palette]', e); }
  }

  // The _ stays exactly where it is until something's typed (no second
  // cursor, no jump): the input is as wide as its text, and a space
  // separates it from the prompt only once there is text.
  function size() {
    input.style.width = Math.max(1, input.value.length) + 'ch';
    input.classList.toggle('has-text', input.value.length > 0);
    ghost.textContent = ghostFor(input.value);
  }

  let popLayer = null; // on the layer stack while it's open (js/00-util.js)
  function open() {
    if (input) { input.focus(); return; }
    say('');
    // Whatever cd animation was running lands now.
    // (Its timer stopped too, or the rest of it typed over the open prompt.)
    if (typeof _retypeTimer !== 'undefined') clearTimeout(_retypeTimer);
    window.retypePrompt && (textEl.textContent = klabPromptFor(page()));
    input = document.createElement('input');
    input.className = 'term-input';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'klabPalette');
    input.setAttribute('aria-label', 'Go anywhere, or type a command (try: cd music, help)');
    ghost = document.createElement('span');
    ghost.className = 'term-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const fs = getComputedStyle(textEl).fontSize;
    input.style.fontSize = ghost.style.fontSize = fs;
    textEl.after(input, ghost);
    root.classList.add('term-on');
    popLayer = klabLayers.push(input, { kind: 'terminal', close: () => close() });
    hIdx = history.length;
    sel = 0;
    size();
    input.focus();
    render();
    input.addEventListener('input', () => { sel = 0; hIdx = history.length; render(); size(); SFX?.play?.('tick'); });
    input.addEventListener('keydown', key);
    input.addEventListener('blur', () => setTimeout(close, 0));
  }
  function close() {
    if (!input) return;
    input.remove(); ghost.remove();
    input = ghost = null;
    root.classList.remove('term-on');
    if (pal) pal.classList.remove('open');
    popLayer?.(); popLayer = null;
  }

  function key(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if ((e.key === 'Tab' || (e.key === 'ArrowRight' && input.selectionStart === input.value.length)) && ghost.textContent) {
      e.preventDefault();
      input.value += ghost.textContent;
      render(); size();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // Nothing to complete: Tab walks the list, as ↓ does.
      if (list.length) { sel = (sel + (e.shiftKey ? list.length - 1 : 1)) % list.length; paintSel(true); }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      // An empty line (or one brought back from history): what you've run.
      const fromHistory = history.length && (!input.value || input.value === history[hIdx]);
      if (fromHistory && (up || hIdx < history.length)) {
        hIdx = Math.max(0, Math.min(history.length, hIdx + (up ? -1 : 1)));
        input.value = history[hIdx] || '';
        sel = 0; render(); size();
        return;
      }
      if (list.length) { sel = (sel + (up ? list.length - 1 : 1)) % list.length; paintSel(true); }
      return;
    }
    if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
      if (!list.length || ((e.key === 'Home' || e.key === 'End') && input.value)) { requestAnimationFrame(() => input && size()); return; }
      e.preventDefault();
      sel = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, sel + (e.key === 'PageUp' ? -8 : 8)));
      paintSel(true);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = input.value.trim();
      // A command, or a path (cd's shorthand), runs as the shell; anything
      // else is the chosen row.
      if (isCommand(line) || (line && !list.length) || (line.includes('/') && resolve(line))) {
        if (line && history[history.length - 1] !== line) history.push(line);
        close();
        run(line);
        return;
      }
      if (!line && !list.length) { close(); return; }
      runItem(list[sel], e.altKey);
      return;
    }
    // Keep the ghost in step with the caret.
    requestAnimationFrame(() => input && size());
  }

  function go(to) {
    // You typed the cd: no need to watch it typed again.
    window._klabTermJump = true;
    if (to.page !== page()) setActiveTab(to.page);
    window._klabTermJump = false;
    if (to.section) {
      const row = dirsOf(to.page).get(to.section);
      setTimeout(() => row?.click(), to.page === page() ? 0 : 60);
    }
  }

  function run(line) {
    if (!line) return;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'cd': {
        const to = resolve(arg || '~');
        if (!to) { say(`cd: no such directory: ${arg}`); SFX?.play?.('error'); return; }
        go(to); SFX?.play?.('nav');
        return;
      }
      case 'ls': {
        const of = arg ? (resolve(arg)?.page) : page();
        const list = of ? children(of) : null;
        if (!list) { say(`ls: no such directory: ${arg}`); return; }
        say(list.length ? list.join('  ') : '(empty)');
        return;
      }
      case 'pwd': say(pathOf(cwd())); return;
      case 'help': case '?': say(`type to go anywhere · cd <page>  ls  pwd  sharks  exit · ${KLAB_MOD}+K / : / d opens this`); return;
      case 'sharks': case 'ocean': case 'aquarium': say(''); window.klabOcean?.open(); return;
      case 'exit': case 'clear': case 'q': say(''); return;
      case 'sudo': say('nice try'); return;
      default: {
        // A bare directory works like cd.
        const to = resolve(line);
        if (to) { go(to); SFX?.play?.('nav'); return; }
        say(`klabnet: command not found: ${cmd}`); SFX?.play?.('error');
      }
    }
  }

  addEventListener('resize', () => { if (pal?.classList.contains('open')) placePal(); });
  prompt.classList.add('term-btn');
  prompt.addEventListener('mousedown', e => { if (e.target !== input) { e.preventDefault(); open(); } });
  window.klabTerminal = { open, close, run };
})();
