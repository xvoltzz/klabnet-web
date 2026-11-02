// ══════════════════════════════════════════
//  THE PROMPT, FOR REAL (an easter egg)
//  Click "klabnet>" in the title bar, or press d, and the prompt takes
//  typing: `cd music`, `cd music/albums`, `cd ..`, `cd ~`, `ls`, `pwd`,
//  `help`, `exit`. A bare page name works too. Like fish, it suggests the
//  rest of what you're typing in grey (from what you've run before, then
//  from the directories there are); Tab or → takes it. ↑/↓ go through what
//  you've run. Enter runs it, Escape or clicking away leaves.
//  Directories are the pages, and Music's sections under music/ (read off
//  Music's sidebar, so they're always the ones it has).
// ══════════════════════════════════════════
(function () {
  const prompt = document.querySelector('.header-left .terminal-prompt');
  const textEl = document.getElementById('promptText');
  const outEl = document.getElementById('promptMotd');
  const cursor = document.getElementById('promptCursor');
  if (!prompt || !textEl || !cursor) return;
  const root = document.documentElement;

  const ALL_PAGES = ['social', 'feed', 'chat', 'photos', 'music'];
  // Only the ones that are on.
  let PAGES = ALL_PAGES;
  const pages = () => (PAGES = ALL_PAGES.filter(p => typeof isTabEnabled !== 'function' || isTabEnabled(p)));
  const slug = s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Music's sections: name -> its sidebar row.
  function musicDirs() {
    const m = new Map();
    document.querySelectorAll('.music-nav .picker-tab[data-tab]').forEach(b => {
      const name = slug(b.textContent);
      if (name && name !== 'home') m.set(name, b);
    });
    return m;
  }
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
    const dirs = musicDirs();
    pages();
    if (parts.length === 1) {
      if (PAGES.includes(parts[0])) return { page: parts[0] };
      // A Music section from inside Music.
      if (page() === 'music' && dirs.has(parts[0])) return { page: 'music', section: parts[0] };
      return null;
    }
    if (parts.length === 2 && parts[0] === 'music' && dirs.has(parts[1])) return { page: 'music', section: parts[1] };
    return null;
  }

  // Everything you could cd to, for suggestions and ls.
  function allDirs() {
    const m = [...musicDirs().keys()];
    pages();
    return ['~', ...PAGES, ...m.map(d => 'music/' + d), ...(page() === 'music' ? m : [])];
  }
  function children(of) {
    if (of === 'home' || of === '~') return pages();
    if (of === 'music') return [...musicDirs().keys()];
    return [];
  }

  const history = [];
  let hIdx = -1, input = null, ghost = null, outT = 0;

  function say(text) {
    if (!outEl) return;
    clearTimeout(outT);
    outEl.textContent = text ? '  ' + text : '';
    root.classList.toggle('term-said', !!text);
    if (text) outT = setTimeout(() => { outEl.textContent = ''; root.classList.remove('term-said'); }, 3200);
  }

  function suggest(v) {
    if (!v) return '';
    const fromHistory = [...history].reverse().find(h => h.startsWith(v) && h !== v);
    if (fromHistory) return fromHistory.slice(v.length);
    const m = /^(cd\s+)(\S*)$/.exec(v);
    if (m) {
      const hit = allDirs().find(d => d.startsWith(m[2]) && d !== m[2]);
      return hit ? hit.slice(m[2].length) : '';
    }
    if (!v.includes(' ')) {
      const cmd = ['cd ', 'ls', 'pwd', 'help', 'exit', 'clear'].find(c => c.startsWith(v) && c !== v);
      if (cmd) return cmd.slice(v.length);
      const dir = pages().find(d => d.startsWith(v) && d !== v);
      if (dir) return dir.slice(v.length);
    }
    return '';
  }

  // The _ stays exactly where it is until something's typed (no second
  // cursor, no jump): the input is as wide as its text, and a space
  // separates it from the prompt only once there is text.
  function size() {
    input.style.width = input.value.length + 'ch';
    input.classList.toggle('has-text', input.value.length > 0);
    ghost.textContent = input.selectionStart === input.value.length ? suggest(input.value) : '';
  }

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
    input.setAttribute('aria-label', 'Type a command (try: cd music, ls, help)');
    ghost = document.createElement('span');
    ghost.className = 'term-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const fs = getComputedStyle(textEl).fontSize;
    input.style.fontSize = ghost.style.fontSize = fs;
    textEl.after(input, ghost);
    root.classList.add('term-on');
    hIdx = history.length;
    size();
    input.focus();
    input.addEventListener('input', () => { size(); SFX?.play?.('tick'); });
    input.addEventListener('keydown', key);
    input.addEventListener('blur', () => setTimeout(close, 0));
  }
  function close() {
    if (!input) return;
    input.remove(); ghost.remove();
    input = ghost = null;
    root.classList.remove('term-on');
  }

  function key(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if ((e.key === 'Tab' || (e.key === 'ArrowRight' && input.selectionStart === input.value.length)) && ghost.textContent) {
      e.preventDefault();
      input.value += ghost.textContent;
      size();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!history.length) return;
      hIdx = Math.max(0, Math.min(history.length, hIdx + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[hIdx] || '';
      size();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = input.value.trim();
      if (line && history[history.length - 1] !== line) history.push(line);
      close();
      run(line);
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
      const row = musicDirs().get(to.section);
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
      case 'help': case '?': say('cd <page>  ls  pwd  exit   (try: cd music/albums)'); return;
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

  prompt.classList.add('term-btn');
  prompt.addEventListener('mousedown', e => { if (e.target !== input) { e.preventDefault(); open(); } });
  window.klabTerminal = { open, run };
})();
