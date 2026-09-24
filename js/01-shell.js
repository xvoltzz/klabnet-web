
// ══════════════════════════════════════════
//  TERMINAL TYPING ANIMATION
// ══════════════════════════════════════════
const FULL_TEXT = 'klabnet>_';
// Shown instead, while on the Chat tab — klab.chat is a domain the user
// has picked up with an eye toward possibly spinning Chat out as its own
// site later; this previews that branding without actually splitting
// anything yet. Applied by setActiveTab() (see its own comment) once the
// intro typing animation below has finished, or by this animation itself
// if it's still mid-typing at that point (e.g. a page load landing
// directly on the #chat hash).
const CHAT_PROMPT_TEXT = 'klab.chat>_';
let typed = 0;
const promptEl  = document.getElementById('promptText');
const cursorEl  = document.getElementById('promptCursor');

function typeNext() {
  if (typed < FULL_TEXT.length) {
    promptEl.textContent = FULL_TEXT.slice(0, ++typed);
    const delay = typed === FULL_TEXT.length ? 0 : 60 + Math.random()*40;
    setTimeout(typeNext, delay);
  } else {
    cursorEl.classList.add('visible');
    if (document.body.classList.contains('tab-chat-active')) promptEl.textContent = CHAT_PROMPT_TEXT;
  }
}
setTimeout(typeNext, 400);

// ══════════════════════════════════════════
//  MOTD — a silly Minecraft-style splash text
// ══════════════════════════════════════════
const MOTD_PHRASES = [
  "i'm gonna kill scott", 'i love fat wes', 'can i borrow your elytra?',
  'METAL COOLER', 'jjk aye aye', 'nick w(umbo)', 'built by xvoltzz!',
  'not legal at all...', 'thank you claude code', 'open source!!',
  'try out KLABGIT', 'invite only!!', 'pre alpha alpha', 'whats 9 + 10?',
  'like teams but awesome', 'call me braxton',
  // Nick's Quotes
  'The fatter the cracker, the fatter the crack',
  'You look like you were made with pre-cum',
  'Horseshit boob',
  'Mike I think your farts would kill a Victorian child',
  'Door Jiggle',
  'Do you like climbin that mountain',
  'I can smell the girth on you Mike',
  "I'm looking for a place to drop seed like Genghis Khan",
  "You're a toucher, I'm a talker",
  'God those blacks are awful',
  "You're thinking about Lady dick",
  'Grant can I 6-7 your boobs',
  "It's black Wes, you should fix it",
  'They call me the Tasmanian Shredder',
  "No, I don't know what Jit means",
  "I'm gonna milk this MF until my lunch",
  'Go ahead and piss out a rock, Faggot',
  'Jit to Jeet',
  'Gay marriage should be between a man and a women',
  "If I was in jail I'd hope I get some birthday dick",
  "Facks if I'm in jail on my birthday I'd want to get raped"
];
const motdEl = document.getElementById('motd');
const motdRefreshBtn = document.getElementById('motdRefresh');
let _motdCurrent = null;

// Minecraft shrinks long splash text to keep it inside a fixed box; we do
// the same by measuring the rendered width and scaling the font down until
// it fits, instead of letting long quotes run off the edge of the screen.
function fitMotdText(text) {
  if (!motdEl) return;
  const baseRem = 0.62;
  motdEl.style.fontSize = baseRem + 'rem';
  motdEl.textContent = text;
  const maxWidth = Math.min(window.innerWidth * 0.5, 460);
  const width = motdEl.scrollWidth;
  if (width > maxWidth) {
    const scale = Math.max(maxWidth / width, 0.32);
    motdEl.style.fontSize = (baseRem * scale) + 'rem';
  }
}

function pickMotd() {
  if (MOTD_PHRASES.length < 2) return MOTD_PHRASES[0];
  let next;
  do { next = MOTD_PHRASES[Math.floor(Math.random() * MOTD_PHRASES.length)]; }
  while (next === _motdCurrent);
  return next;
}

function rerollMotd(auto) {
  if (!motdEl) return;
  _motdCurrent = pickMotd();
  if (!auto) SFX && SFX.play('star');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    fitMotdText(_motdCurrent);
    return;
  }
  // Swap the text at the flip's midpoint, when it's edge-on and invisible.
  motdEl.classList.remove('rerolling');
  void motdEl.offsetWidth; // restart the animation even if it's mid-flight
  setTimeout(() => { fitMotdText(_motdCurrent); }, 300);
  motdEl.classList.add('rerolling');
  motdEl.addEventListener('animationend', () => motdEl.classList.remove('rerolling'), { once: true });
  if (!auto && motdRefreshBtn) {
    motdRefreshBtn.classList.remove('spinning');
    void motdRefreshBtn.offsetWidth;
    motdRefreshBtn.classList.add('spinning');
    motdRefreshBtn.addEventListener('animationend', () => motdRefreshBtn.classList.remove('spinning'), { once: true });
  }
}

if (motdEl) {
  _motdCurrent = MOTD_PHRASES[Math.floor(Math.random() * MOTD_PHRASES.length)];
  fitMotdText(_motdCurrent);
}

if (motdRefreshBtn) {
  motdRefreshBtn.addEventListener('click', () => rerollMotd(false));
}

// Cycle to a new splash every so often so a long session gets to see more
// than one — timing is deliberately a little irregular, not a metronome.
function scheduleMotdCycle() {
  const delay = 45000 + Math.random() * 30000; // 45–75s
  setTimeout(() => {
    rerollMotd(true);
    scheduleMotdCycle();
  }, delay);
}
scheduleMotdCycle();

// ══════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════
const THEME_KEY = 'klabnet_theme';
let currentTheme = 'dark';
try { currentTheme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {} // storage blocked (private mode, extension) — fall back to the default rather than aborting this whole script

function applyTheme(t) {
  currentTheme = t;
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('themeIcon').className = t === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
  localStorage.setItem(THEME_KEY, t);
  applyCustomBg(); // re-check the OTHER theme's stored color now that data-theme changed
}

applyTheme(currentTheme);
document.getElementById('themeToggle').addEventListener('click', () => { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); SFX.play('click'); });

// ══════════════════════════════════════════
//  CUSTOM BACKGROUND COLOR — curated palette per theme, not a full color
//  picker: --bg sits behind every readability-tuned text/border token in
//  the file, so letting someone pick an arbitrary hex risked breaking
//  contrast everywhere at once. Same "curated swatches, not free hex" call
//  already made for the profile chat-color picker (CHAT_NAME_COLORS).
// ══════════════════════════════════════════
const BG_KEY_DARK  = 'klabnet_bg_dark';
const BG_KEY_LIGHT = 'klabnet_bg_light';
// First entry of each list ('' hex) is "use the theme's own default" —
// clearing back to whatever [data-theme="..."] already defines for --bg,
// rather than a swatch of its own that'd drift if that default ever changes.
const BG_PALETTE_DARK = [
  { hex: '', label: 'Default (true black)' },
  { hex: '#0a0a0c', label: 'OLED Charcoal' },
  { hex: '#0d0f14', label: 'Slate' },
  { hex: '#14100c', label: 'Espresso' },
  { hex: '#05060d', label: 'Midnight' },
  { hex: '#0f0a14', label: 'Deep Purple' },
  { hex: '#0a120e', label: 'Forest' },
  { hex: '#140a0d', label: 'Wine' },
  { hex: '#061014', label: 'Ocean' },
  { hex: '#111111', label: 'Graphite' },
];
const BG_PALETTE_LIGHT = [
  { hex: '', label: 'Default (warm white)' },
  { hex: '#ffffff', label: 'Pure White' },
  { hex: '#eceae5', label: 'Soft Gray' },
  { hex: '#faf3e6', label: 'Cream' },
  { hex: '#eef2f7', label: 'Pale Sky' },
  { hex: '#f8ecec', label: 'Blush' },
  { hex: '#eaf5ee', label: 'Mint' },
  { hex: '#f1eef8', label: 'Lavender' },
  { hex: '#f6efe0', label: 'Sand' },
  { hex: '#edf3f5', label: 'Ice' },
];

function getCustomBg(theme) {
  try { return localStorage.getItem(theme === 'dark' ? BG_KEY_DARK : BG_KEY_LIGHT) || ''; }
  catch (e) { return ''; }
}
function setCustomBg(theme, hex) {
  try { localStorage.setItem(theme === 'dark' ? BG_KEY_DARK : BG_KEY_LIGHT, hex || ''); } catch (e) {}
  if (theme === currentTheme) applyCustomBg();
  scheduleSave && scheduleSave(); // sync to /api/prefs alongside the other appearance prefs
}
function applyCustomBg() {
  const hex = getCustomBg(currentTheme);
  if (hex) document.documentElement.style.setProperty('--bg', hex);
  else document.documentElement.style.removeProperty('--bg'); // falls back to the theme's own default
  const btn = document.getElementById('bgColorBtn');
  if (btn) btn.style.background = hex || getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
applyCustomBg();

function openBgColorModal() {
  const paletteRowHTML = (palette, theme) => palette.map(p => {
    const selected = getCustomBg(theme) === p.hex;
    const swatchBg = p.hex || (theme === 'dark' ? '#000000' : '#f5f4f0');
    return `<div class="bg-palette-swatch${selected ? ' selected' : ''}" data-bg-theme="${theme}" data-bg-hex="${esc(p.hex)}" style="background:${swatchBg}" title="${esc(p.label)}"></div>`;
  }).join('');
  openChatModal('// background color', `
    <div class="bg-palette-group">
      <div class="settings-row-label">Dark mode</div>
      <div class="bg-palette-row" data-bg-group="dark">${paletteRowHTML(BG_PALETTE_DARK, 'dark')}</div>
    </div>
    <div class="bg-palette-group">
      <div class="settings-row-label">Light mode</div>
      <div class="bg-palette-row" data-bg-group="light">${paletteRowHTML(BG_PALETTE_LIGHT, 'light')}</div>
    </div>
  `);
  // Bound to each freshly-rendered swatch (recreated by chatModalBody's
  // innerHTML replace above every time this opens) rather than delegated
  // on the persistent #chatModalBody shell itself — that shell never gets
  // torn down between opens, so a delegated listener there would stack a
  // new copy on every single open of this modal.
  document.querySelectorAll('.bg-palette-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const theme = swatch.dataset.bgTheme;
      setCustomBg(theme, swatch.dataset.bgHex);
      swatch.closest('.bg-palette-row').querySelectorAll('.bg-palette-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      SFX && SFX.play('click');
    });
  });
}
document.getElementById('bgColorBtn')?.addEventListener('click', openBgColorModal);

// ══════════════════════════════════════════
//  KEYBOARD SHORTCUTS — vim-flavored global bindings + a discoverable "?"
//  hints panel (#keyHintsBackdrop). Every binding is ignored while focus is
//  in an editable field (input/textarea/contenteditable), and while any
//  modifier key is held, so normal typing and OS/browser shortcuts are
//  never hijacked.
// ══════════════════════════════════════════
(function() {
  const GO_TO_TAB = { f: 'feed', c: 'chat', m: 'music', p: 'photos' };
  let awaitingG = false;
  let awaitingGTimer = null;

  function isEditableTarget() {
    const el = document.activeElement;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  // Whichever scrollable pane the active tab actually owns right now —
  // there's no single "the" scroll container, it depends on which tab
  // (and, in Music, whether the album/artist detail view is open).
  function activeScrollPane() {
    if (document.querySelector('.tab-panel[data-tab-panel="chat"]')?.classList.contains('active')) {
      return document.getElementById('chatTimeline');
    }
    if (document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active')) {
      if (document.getElementById('apPanel')?.classList.contains('open')) return document.getElementById('apScroll');
      return document.getElementById('pickerList');
    }
    return document.scrollingElement || document.documentElement;
  }
  function scrollPane(delta) {
    activeScrollPane()?.scrollBy({ top: delta, behavior: 'smooth' });
  }
  function scrollPaneToEdge(toTop) {
    const pane = activeScrollPane();
    if (!pane) return;
    pane.scrollTo({ top: toTop ? 0 : pane.scrollHeight, behavior: 'smooth' });
  }

  function toggleKeyHints() {
    document.getElementById('keyHintsBackdrop')?.classList.toggle('open');
    SFX && SFX.play('click');
  }
  document.getElementById('keyHintsBtn')?.addEventListener('click', toggleKeyHints);
  document.getElementById('feedbackBtn')?.addEventListener('click', () => {
    document.getElementById('headerMoreMenu')?.classList.remove('visible');
    openFeedbackModal();
  });
  document.getElementById('keyHintsClose')?.addEventListener('click', toggleKeyHints);
  trapFocusWithin(
    document.querySelector('#keyHintsBackdrop .add-app-modal'),
    () => !!document.getElementById('keyHintsBackdrop')?.classList.contains('open')
  );
  document.getElementById('keyHintsBackdrop')?.addEventListener('click', e => {
    if (e.target.id === 'keyHintsBackdrop') toggleKeyHints();
  });

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // never fight a browser/OS shortcut
    if (e.key === 'Escape') {
      if (document.getElementById('keyHintsBackdrop')?.classList.contains('open')) toggleKeyHints();
      return; // never swallow Escape — other open panels have their own handlers for it
    }
    if (isEditableTarget()) return;

    if (awaitingG) {
      clearTimeout(awaitingGTimer);
      awaitingG = false;
      if (e.key === 'g') { e.preventDefault(); scrollPaneToEdge(true); return; } // gg -> top
      if (GO_TO_TAB[e.key]) { e.preventDefault(); setActiveTab(GO_TO_TAB[e.key]); return; }
      return; // unrecognized second key — drop the pending g silently, vim does the same
    }

    switch (e.key) {
      case 'g':
        awaitingG = true;
        awaitingGTimer = setTimeout(() => { awaitingG = false; }, 700);
        break;
      case 'j': e.preventDefault(); scrollPane(90); break;
      case 'k': e.preventDefault(); scrollPane(-90); break;
      case 'G': e.preventDefault(); scrollPaneToEdge(false); break;
      case '/': {
        const search = document.getElementById('pickerSearch');
        const onMusic = document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active');
        if (onMusic && search) { e.preventDefault(); search.focus(); }
        break;
      }
      case 'n': e.preventDefault(); document.getElementById('btnNext')?.click(); break;
      case 'p': e.preventDefault(); document.getElementById('btnPrev')?.click(); break;
      case '?': e.preventDefault(); toggleKeyHints(); break;
    }
  });
})();
