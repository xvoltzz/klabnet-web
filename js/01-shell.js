
// ══════════════════════════════════════════
//  TERMINAL TYPING ANIMATION
// ══════════════════════════════════════════
// The blinking _ after it is the cursor (#promptCursor), the only one.
const FULL_TEXT = 'klabnet>';
// The prompt on each page: Home is just klabnet>, each page is a
// directory under it (klabnet/feed>), Chat included.
function klabPromptFor(key) {
  return !key || key === 'home' ? FULL_TEXT : `klabnet/${key}>`;
}
// Shown instead, while on the Chat tab — klab.chat is a domain the user
// has picked up with an eye toward possibly spinning Chat out as its own
// site later; this previews that branding without actually splitting
// anything yet. Applied by setActiveTab() (see its own comment) once the
// intro typing animation below has finished, or by this animation itself
// if it's still mid-typing at that point (e.g. a page load landing
// directly on the #chat hash).
const CHAT_PROMPT_TEXT = 'klabnet/chat>'; // was klab.chat>_; every page is a directory now
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
    const t = (/\btab-(\w+)-active\b/.exec(document.body.className) || [])[1];
    if (t) promptEl.textContent = klabPromptFor(t);
  }
}
setTimeout(typeNext, 400);
// The _ cursor is the prompt's own size, whatever size that is here.
const syncCursorFont = () => { if (cursorEl && promptEl) cursorEl.style.fontSize = getComputedStyle(promptEl).fontSize; };
syncCursorFont();
window.addEventListener('resize', syncCursorFont);

// Going to a page, it's a shell: "cd feed" is typed after the prompt and
// entered, and the prompt is in that directory ("klabnet/feed>"); Home is
// "cd ~". Works from whatever is on screen, so switching pages mid-command
// just types the new one.
let _retypeTimer = 0;
function retypePrompt(target) {
  clearTimeout(_retypeTimer);
  // Still on the intro? It lands on the right text by itself.
  if (typed < FULL_TEXT.length) return;
  const base = promptEl.textContent.replace(/ .*$/, '');
  // Typed into the prompt itself (js/32-terminal.js): already cd'd.
  if (base === target || window._klabTermJump || !(window.klabMotionOk?.() ?? true)) { promptEl.textContent = target; return; }
  const cmd = ' cd ' + (target === FULL_TEXT ? '~' : target.slice(target.indexOf('/') + 1, -1));
  let i = 0;
  const step = () => {
    if (i < cmd.length) {
      promptEl.textContent = base + cmd.slice(0, ++i);
      _retypeTimer = setTimeout(step, i === 1 ? 70 : 30 + Math.random() * 28);
    } else {
      // Enter.
      _retypeTimer = setTimeout(() => { promptEl.textContent = target; }, 150);
    }
  };
  step();
}

// The MOTD is an easter egg now: press klabnet's mark or its prompt and
// the prompt types one after the cursor ("klabnet>_ go touch grass"),
// leaves it a few seconds and backspaces it away; press again for another.
// It types like someone at a keyboard:
// now and then a finger lands on the next key over, gets a letter or two
// further, stops, backspaces and fixes it (sometimes fumbling it again),
// and once in a while the period key gets held down at the end.
const promptMotdEl = document.getElementById('promptMotd');
let _promptMotdTimer = 0;
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function nearKey(ch) {
  const lower = ch.toLowerCase();
  for (let r = 0; r < KEY_ROWS.length; r++) {
    const i = KEY_ROWS[r].indexOf(lower);
    if (i < 0) continue;
    const near = [KEY_ROWS[r][i - 1], KEY_ROWS[r][i + 1], KEY_ROWS[r - 1]?.[i], KEY_ROWS[r + 1]?.[i]].filter(Boolean);
    const k = near[Math.floor(Math.random() * near.length)];
    return ch === lower ? k : k.toUpperCase();
  }
  return null; // not a letter: nothing next to it worth hitting
}
// The keystrokes from what's shown to `target`: a character to type, or
// null for backspace, each with how long before the next one.
function motdKeystrokes(cur, target) {
  const keys = [];
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  let keep = cur;
  while (!target.startsWith(keep)) keep = keep.slice(0, -1);
  for (let n = cur.length - keep.length; n > 0; n--) keys.push({ key: null, wait: rand(18, 32) });
  if (keys.length) keys[keys.length - 1].wait = 260;
  for (let i = keep.length; i < target.length; i++) {
    const ch = target[i];
    for (let slips = 0; slips < 3 && Math.random() < (slips ? 0.3 : 0.03); slips++) {
      const wrong = nearKey(ch);
      if (!wrong) break;
      const run = [wrong, ...target.slice(i + 1, i + 1 + Math.floor(Math.random() * 3))];
      run.forEach(c => keys.push({ key: c, wait: rand(38, 80) }));
      keys[keys.length - 1].wait = rand(260, 560); // ...wait, that's wrong
      run.forEach(() => keys.push({ key: null, wait: rand(40, 70) }));
    }
    keys.push({ key: ch, wait: rand(38, 80) });
  }
  if (target && Math.random() < 0.12) {
    keys.push({ key: '.', wait: rand(300, 500) }); // a beat, then the key's held down
    for (let n = Math.floor(rand(3, 10)); n > 0; n--) keys.push({ key: '.', wait: 33 });
  }
  return keys;
}
function typePromptMotd(text, done) {
  if (!promptMotdEl) return;
  clearTimeout(_promptMotdTimer);
  const target = text ? ' ' + text : '';
  if (!(window.klabMotionOk?.() ?? true)) { promptMotdEl.textContent = target; done?.(); return; }
  const keys = motdKeystrokes(promptMotdEl.textContent, target);
  let i = 0;
  const step = () => {
    const k = keys[i++];
    if (!k) { done?.(); return; }
    promptMotdEl.textContent = k.key === null ? promptMotdEl.textContent.slice(0, -1) : promptMotdEl.textContent + k.key;
    _promptMotdTimer = setTimeout(step, k.wait);
  };
  step();
}

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
let _motdCurrent = null;

function pickMotd() {
  if (MOTD_PHRASES.length < 2) return MOTD_PHRASES[0];
  let next;
  do { next = MOTD_PHRASES[Math.floor(Math.random() * MOTD_PHRASES.length)]; }
  while (next === _motdCurrent);
  return next;
}

// The easter egg: a new one each press, typed, held for a read (longer
// for a longer one) and backspaced away. While it's up the prompt may
// run past the sidebar's column (html.motd-egg).
let _motdEggTimer = 0;
function motdEgg() {
  const root = document.documentElement;
  _motdCurrent = pickMotd();
  clearTimeout(_motdEggTimer);
  root.classList.add('motd-egg');
  typePromptMotd(_motdCurrent, () => {
    _motdEggTimer = setTimeout(() => typePromptMotd('', () => root.classList.remove('motd-egg')), 3500 + _motdCurrent.length * 70);
  });
}
// Off for now (the owner, 2026-10-31: the title bar is for the page; the
// phrases stay). Set to true to bring the easter egg back.
const MOTD_EGG = false;
if (MOTD_EGG) document.querySelectorAll('.header-left .logo, .header-left .terminal-prompt').forEach(el => {
  el.addEventListener('click', motdEgg);
  el.classList.add('motd-egg-btn');
});


// ══════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════
const THEME_KEY = 'klabnet_theme';
let currentTheme = 'dark';
try { currentTheme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {} // storage blocked (private mode, extension) — fall back to the default rather than aborting this whole script

function applyTheme(t) {
  currentTheme = t;
  const sky = t === 'sky', wood = t === 'wood', ocean = t === 'ocean';
  document.documentElement.classList.toggle('sky', sky);
  // Wood is the light theme in a walnut frame (css "WOOD"); Ocean the dark
  // one with the ASCII sea round the page (js/37-ocean.js, css "OCEAN").
  document.documentElement.classList.toggle('wood', wood);
  document.documentElement.classList.toggle('ocean', ocean);
  if (sky) paintSky(); else { klabSky.clear(); document.documentElement.setAttribute('data-theme', wood ? 'light' : ocean ? 'dark' : t); }
  window.klabOcean?.backdrop(ocean);
  document.getElementById('themeIcon').className = document.documentElement.dataset.theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {} // storage blocked: same as the read above
  applyCustomBg(); // re-check the OTHER theme's stored color now that data-theme changed
}

// ── Sky: the time of day, the season, the holidays ──
// The theme that follows the clock (the owner, 2026-11-02: the site long
// ago changed its colours with the time of day, "which was SWEET"). The
// window is a sky, a three-stop gradient blended between the moments
// below, minute by minute; the frame is clear glass over it and the page
// a sheet. Dark or light ink is picked from how bright the sky is, so a
// sunset doesn't get light text on orange.
// The owner, same day: "warmer in day, much cooler in night… take inspo
// from the seasons and location, use toledo ohio… it gets dark early
// now, its starting to get cold, up the coolness in the winter… maybe
// some snow in the holiday season… holiday themes on all major holidays".
// So the moments hang off the real sunrise and sunset in Toledo (they
// move through the year: dark by 5:15 in December, light past 9 in
// June); days are warm and nights cold blue; the season is mixed in
// (`cold`: greyer and icier toward late January, warmer toward late
// July); and a holiday tints the horizon and may bring weather to the
// frame (js/38-sky-fx.js: snow, leaves, fireworks, hearts).
// Each moment: [anchor, offset in hours, stops].
const SKY = [
  ['rise', -1.7, ['#040919', '#0a1531', '#122544']], // night
  ['rise', -0.9, ['#0d1640', '#2b2c5e', '#5a4170']], // before dawn
  ['rise', -0.3, ['#5a78bd', '#d79aa9', '#ffb27d']], // dawn
  ['rise',  0.5, ['#86b5e6', '#e5dccd', '#ffd49c']], // sunrise
  ['rise',  2.3, ['#6daeea', '#cfe2ee', '#fff0d4']], // morning
  ['noon',  0,   ['#58a6ea', '#b4d8f2', '#fff3dc']], // noon
  ['set',  -2.2, ['#6faae0', '#dcd8c8', '#ffd9a0']], // afternoon
  ['set',  -0.8, ['#e2a265', '#f08a6a', '#b75f86']], // golden hour
  ['set',   0.1, ['#363372', '#b4517a', '#f08c55']], // sunset
  ['set',   0.7, ['#111c4c', '#2c2c69', '#5d3f78']], // dusk
  ['set',   1.5, ['#060c22', '#0c1936', '#15294a']], // night
];
// Toledo, Ohio.
const SKY_LAT = 41.6528, SKY_LON = -83.5379;
const klabSky = (() => {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const lum = c => { const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const rad = Math.PI / 180;
  const dayOfYear = d => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);

  // Sunrise, solar noon and sunset in local clock hours (NOAA's simple
  // equations: within a couple of minutes, which is plenty for a sky).
  function sun(d) {
    const n = dayOfYear(d), g = 2 * Math.PI / 365 * (n - 1);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(SKY_LAT * rad) * Math.cos(decl)) - Math.tan(SKY_LAT * rad) * Math.tan(decl)) / rad;
    const noonUtc = 720 - 4 * SKY_LON - eqt; // minutes after UTC midnight
    const tz = -new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTimezoneOffset();
    const local = m => (m + tz) / 60;
    return { rise: local(noonUtc - 4 * ha), noon: local(noonUtc), set: local(noonUtc + 4 * ha) };
  }
  // 1 in late January, 0 in late July.
  const coldness = d => (1 + Math.cos(2 * Math.PI * (dayOfYear(d) - 20) / 365)) / 2;

  // ── Holidays ── (US, and a few that move: Easter, Thanksgiving,
  // Hanukkah and Lunar New Year). tint: the horizon's colour for the
  // day; fx: the weather in the frame (js/38-sky-fx.js).
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
  }
  const HANUKKAH = { 2026: [12, 4, 12, 12], 2027: [12, 24, 1, 1], 2028: [12, 12, 12, 20], 2029: [12, 1, 12, 9], 2030: [12, 20, 12, 28] };
  const LUNAR_NY = { 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3] };
  function holiday(d = new Date()) {
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate(), md = m * 100 + day;
    const thanks = 22 + (11 - new Date(y, 10, 1).getDay() + 7) % 7; // the fourth Thursday of November
    const [em, ed] = easter(y);
    const hk = HANUKKAH[y] || HANUKKAH[y - 1];
    const inHk = hk && (() => { const s = new Date(hk === HANUKKAH[y] ? y : y - 1, hk[0] - 1, hk[1]), e = new Date(hk[2] < hk[0] ? (hk === HANUKKAH[y] ? y + 1 : y) : (hk === HANUKKAH[y] ? y : y - 1), hk[2] - 1, hk[3], 23, 59); return d >= s && d <= e; })();
    const ln = LUNAR_NY[y];
    const season = md >= 1201 || md <= 106; // the holiday season: light snow
    if (md === 1231 || md === 101) return { key: 'newyear', name: "New Year's", tint: '#f2c25c', amount: .35, fx: 'fireworks' };
    if (md === 1224 || md === 1225) return { key: 'christmas', name: 'Christmas', tint: '#e0525a', amount: .3, fx: 'snow', heavy: true };
    if (inHk) return { key: 'hanukkah', name: 'Hanukkah', tint: '#6f9cf0', amount: .35, fx: 'snow' };
    if (season) return { key: 'season', name: 'The holidays', tint: '#9fc3ff', amount: .12, fx: 'snow' };
    if (ln && m === ln[0] && day === ln[1]) return { key: 'lunar', name: 'Lunar New Year', tint: '#e5383b', amount: .35, fx: 'fireworks' };
    if (md === 214) return { key: 'valentine', name: "Valentine's Day", tint: '#ff6f9e', amount: .4, fx: 'hearts' };
    if (md === 317) return { key: 'stpatrick', name: "St. Patrick's Day", tint: '#3fbf6a', amount: .35, fx: null };
    if (m === em && day === ed) return { key: 'easter', name: 'Easter', tint: '#c7a8f5', amount: .35, fx: null };
    if (md === 704) return { key: 'july4', name: 'Independence Day', tint: '#e2524f', amount: .25, fx: 'fireworks' };
    if (md === 1031) return { key: 'halloween', name: 'Halloween', tint: '#ff7a1a', amount: .45, fx: 'leaves', night: '#3b1653' };
    if (m === 11 && day >= thanks - 1 && day <= thanks + 1) return { key: 'thanksgiving', name: 'Thanksgiving', tint: '#e08a3a', amount: .35, fx: 'leaves' };
    return null;
  }

  function stopsAt(d) {
    const t = sun(d), h = d.getHours() + d.getMinutes() / 60;
    const moments = SKY.map(([anchor, off, stops]) => [t[anchor] + off, stops.map(rgb)]);
    // Wrapped round midnight: yesterday's night before, tomorrow's after.
    const list = [[moments[moments.length - 1][0] - 24, moments[moments.length - 1][1]], ...moments, [moments[0][0] + 24, moments[0][1]]];
    let i = 0;
    while (i < list.length - 2 && list[i + 1][0] <= h) i++;
    const [h0, a] = list[i], [h1, b] = list[i + 1];
    // Eased, so a moment holds a while and then moves on.
    let k = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
    k = k * k * (3 - 2 * k);
    return a.map((c, j) => mix(c, b[j], k));
  }
  function at(d = new Date()) {
    let stops = stopsAt(d);
    const cold = coldness(d), hol = holiday(d);
    stops = stops.map((c, j) => {
      const L = lum(c), grey = [L, L, L].map(v => 255 * Math.pow(v, 1 / 2.2));
      if (L < 0.06) {
        // Night: colder and clearer the deeper into winter.
        c = mix(c, [6, 16, 44], 0.35 * cold);
      } else {
        // Day: winter's flat, pale overcast; summer's warmth.
        c = mix(c, grey, 0.3 * cold);
        c = mix(c, [168, 190, 214], 0.16 * cold);
        c = mix(c, [255, 206, 150], 0.14 * (1 - cold) * (j === 2 ? 1 : 0.5));
      }
      return c;
    });
    if (hol) {
      // The day's colour on the horizon, a little in the middle; at night
      // a holiday may have a sky of its own (Halloween's purple).
      const tint = rgb(hol.tint), dark = lum(stops[1]) < 0.06;
      stops[2] = mix(stops[2], tint, hol.amount * (dark ? 0.7 : 1));
      stops[1] = mix(stops[1], tint, hol.amount * 0.3);
      if (dark && hol.night) stops[0] = mix(stops[0], rgb(hol.night), 0.6);
    }
    return stops;
  }
  const PROPS = ['--sky-1', '--sky-2', '--sky-3', '--bg'];
  return {
    at, sun, holiday, coldness,
    paint() {
      const now = new Date(), stops = at(now), root = document.documentElement;
      const bright = (lum(stops[0]) + 2 * lum(stops[1]) + lum(stops[2])) / 4;
      const mode = bright > 0.32 ? 'light' : 'dark';
      if (root.dataset.theme !== mode) root.setAttribute('data-theme', mode);
      stops.forEach((c, i) => root.style.setProperty('--sky-' + (i + 1), hex(c)));
      // Things drawn "on the background" (rings, letter tiles) take the sky's middle.
      root.style.setProperty('--bg', hex(mix(stops[1], mode === 'dark' ? [0, 0, 0] : [255, 255, 255], mode === 'dark' ? 0.72 : 0.78)));
      // The weather in the frame, and whether it's night for it (fireworks).
      window.klabSkyFx?.set(holiday(now), mode === 'dark');
      return mode;
    },
    clear() { PROPS.forEach(p => document.documentElement.style.removeProperty(p)); window.klabSkyFx?.set(null); },
  };
})();
let _skyTimer = 0;
function paintSky() {
  const was = document.documentElement.dataset.theme;
  const mode = klabSky.paint();
  if (mode !== was) { const ic = document.getElementById('themeIcon'); if (ic) ic.className = mode === 'dark' ? 'ti ti-sun' : 'ti ti-moon'; }
  clearInterval(_skyTimer);
  _skyTimer = setInterval(() => { if (currentTheme === 'sky') klabSky.paint(); else clearInterval(_skyTimer); }, 60e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentTheme === 'sky') klabSky.paint(); });

applyTheme(currentTheme);
document.getElementById('themeToggle').addEventListener('click', () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); SFX.play('click'); });

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
// Tinted enough to tell apart at a glance (the first set sat within a few
// shades of black / white and people couldn't see the difference), while
// staying dark / light enough for the text on top to read comfortably.
const BG_PALETTE_DARK = [
  { hex: '', label: 'Default (true black)' },
  { hex: '#16161a', label: 'OLED charcoal' },
  { hex: '#161c2a', label: 'Slate' },
  { hex: '#26180f', label: 'Espresso' },
  { hex: '#0b1433', label: 'Midnight' },
  { hex: '#1f1033', label: 'Deep purple' },
  { hex: '#0c2517', label: 'Forest' },
  { hex: '#2e0d19', label: 'Wine' },
  { hex: '#05232e', label: 'Ocean' },
  { hex: '#1f1f1f', label: 'Graphite' },
];
const BG_PALETTE_LIGHT = [
  { hex: '', label: 'Default (warm white)' },
  { hex: '#ffffff', label: 'Pure white' },
  { hex: '#dedcd6', label: 'Soft gray' },
  { hex: '#fbe9c6', label: 'Cream' },
  { hex: '#d6e5f8', label: 'Pale sky' },
  { hex: '#f7d6d8', label: 'Blush' },
  { hex: '#d3f0dd', label: 'Mint' },
  { hex: '#e3d8f8', label: 'Lavender' },
  { hex: '#f0dcb4', label: 'Sand' },
  { hex: '#d4ecf2', label: 'Ice' },
];
// People who picked from the first set move to the same shade's new version.
const BG_RENAMED = {
  '#0a0a0c': '#16161a', '#0d0f14': '#161c2a', '#14100c': '#26180f', '#05060d': '#0b1433', '#0f0a14': '#1f1033',
  '#0a120e': '#0c2517', '#140a0d': '#2e0d19', '#061014': '#05232e', '#111111': '#1f1f1f',
  '#eceae5': '#dedcd6', '#faf3e6': '#fbe9c6', '#eef2f7': '#d6e5f8', '#f8ecec': '#f7d6d8', '#eaf5ee': '#d3f0dd',
  '#f1eef8': '#e3d8f8', '#f6efe0': '#f0dcb4', '#edf3f5': '#d4ecf2',
};

function getCustomBg(theme) {
  try {
    const hex = localStorage.getItem(theme === 'dark' ? BG_KEY_DARK : BG_KEY_LIGHT) || '';
    return BG_RENAMED[hex.toLowerCase()] || hex;
  } catch (e) { return ''; }
}
function setCustomBg(theme, hex) {
  try { localStorage.setItem(theme === 'dark' ? BG_KEY_DARK : BG_KEY_LIGHT, hex || ''); } catch (e) {}
  if (theme === currentTheme) applyCustomBg();
  scheduleSave && scheduleSave(); // sync to /api/prefs alongside the other appearance prefs
}
function applyCustomBg() {
  // Sky sets --bg from the sky itself.
  if (currentTheme === 'sky') { klabSky.paint(); return; }
  // Wood and Ocean keep their own page; a custom background would undo it.
  const hex = currentTheme === 'wood' || currentTheme === 'ocean' ? '' : getCustomBg(currentTheme);
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
  const GO_TO_TAB = { h: 'home', s: 'social', f: 'feed', c: 'chat', m: 'music', p: 'photos' };
  let awaitingG = false;
  let awaitingGTimer = null;

  function isEditableTarget() {
    let el = document.activeElement;
    // Inside a shadow root, the document only sees its host.
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
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
    // Feed and Social's home scroll beside Social's sidebar.
    const panel = document.querySelector('.tab-panel.active');
    if (panel && ['feed', 'social'].includes(panel.dataset.tabPanel)) return panel;
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

  // Tab / Shift+Tab flips straight through the pages, and 1–5 jumps to
  // one. Tab keeps its usual job only in an open dialog (those trap focus
  // with it) and where something uses it itself (the markdown editor's
  // list indenting, which claims it first).
  // The app's pages: Home, Social and Music. Feed, Chat and Photos are
  // inside Social (its sidebar, or g f / g c / g p).
  const pages = () => TABS.filter(t => topTab(t) === t && isTabEnabled(t));
  function currentPage() { return topTab(document.querySelector('.tab-panel.active')?.dataset.tabPanel); }
  // Real dialogs only. This used to match any "*backdrop*" and the album /
  // artist page, which is a view, not a dialog: with one open, Tab went
  // back to hopping between buttons.
  function dialogOpen() {
    return !!document.querySelector('.add-app-backdrop.open, .settings-backdrop.open, .img-view-backdrop.open, .img-crop-backdrop.open, .klab-menu.visible')
      || document.body.classList.contains('feed-composer-open');
  }
  // Something that fills the window is over the page: keys that move
  // around the page would do it unseen (Tab behind the full-screen player
  // switched to Photos, which paused the music).
  const slideshowOpen = () => !!document.querySelector('.ss.open');
  const covered = () => slideshowOpen() || !!document.querySelector('.fs-player.open');
  function flipPage(dir) {
    const P = pages(), i = P.indexOf(currentPage());
    const to = P[(i + dir + P.length) % P.length];
    setActiveTab(to);
    // A button left focused by a click would take the next Tab itself.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
  // The page's own sidebar, one row at a time (W/S, ↑/↓): Tab goes
  // between pages, these between what's in one. Music's rows as they
  // show (all of them while its sidebar is hidden); Social's Home, Feed,
  // Photos and Chat, which on a wide window has no row of its own.
  function subTabs() {
    const page = currentPage();
    if (page === 'music') {
      const all = [...document.querySelectorAll('.music-nav .picker-tab[data-tab]')];
      const shown = all.filter(b => b.offsetParent);
      return { rows: (shown.length ? shown : all).map(b => b.dataset.tab), at: document.querySelector('.music-nav .picker-tab[data-tab].active')?.dataset.tab,
        go: key => document.querySelector(`.music-nav .picker-tab[data-tab="${CSS.escape(key)}"]`)?.click() };
    }
    if (page === 'social') {
      const rows = ['social', 'feed', 'photos', 'chat'].filter(isTabEnabled);
      return { rows, at: document.querySelector('.tab-panel.active')?.dataset.tabPanel,
        go: key => { SFX && SFX.play('click'); setActiveTab(key); } };
    }
    return null;
  }
  function stepSubTab(dir) {
    const t = subTabs();
    if (!t || !t.rows.length) return false;
    const i = t.rows.indexOf(t.at);
    t.go(t.rows[i < 0 ? (dir > 0 ? 0 : t.rows.length - 1) : (i + dir + t.rows.length) % t.rows.length]);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return true;
  }
  // ↑/↓ only when nothing that takes arrows has focus (a slider, a menu,
  // the A–Z rail, a row of cards): there they're that thing's.
  const arrowsFree = () => { const el = document.activeElement; return !el || el === document.body || !!el.closest('.picker-tab, .tab-nav-btn'); };

  // Not even a field with text in it keeps Tab: the search box keeps what
  // you searched for, drafts stay in the composers, and either one having
  // focus turned Tab into hopping between buttons ("Tab sometimes selects
  // something else"). What you typed stays where it is.
  document.addEventListener('keydown', e => {
    // defaultPrevented: someone already used this Tab (list indenting in the markdown editor).
    if (e.key !== 'Tab' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || dialogOpen() || covered()) return;
    e.preventDefault();
    // Forward's click, or back's (Shift+Tab), like the title bar's.
    SFX && SFX.play(e.shiftKey ? 'nav_back' : 'nav');
    flipPage(e.shiftKey ? -1 : 1);
  });

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // never fight a browser/OS shortcut
    if (e.key === 'Escape') {
      if (document.getElementById('keyHintsBackdrop')?.classList.contains('open')) toggleKeyHints();
      return; // never swallow Escape — other open panels have their own handlers for it
    }
    if (isEditableTarget()) return;
    // Not behind a dialog: a number switched tabs and "n" skipped the song
    // under an open "Delete this?". "?" still closes the shortcuts panel.
    if (dialogOpen() && !(e.key === '?' && document.getElementById('keyHintsBackdrop')?.classList.contains('open'))) return;
    // The slideshow has its own keys; under the full-screen player only
    // the ones that aren't about the page still make sense.
    if (slideshowOpen() || (covered() && !['n', 'p', '?'].includes(e.key))) return;

    if (awaitingG) {
      clearTimeout(awaitingGTimer);
      awaitingG = false;
      // Stopped here: the second key is part of this chord, not also a
      // shortcut of its own ("g m" went to Music and muted it).
      if (e.key === 'g') { e.preventDefault(); e.stopImmediatePropagation(); scrollPaneToEdge(true); return; } // gg -> top
      if (GO_TO_TAB[e.key]) { e.preventDefault(); e.stopImmediatePropagation(); setActiveTab(GO_TO_TAB[e.key]); return; }
      return; // unrecognized second key — drop the pending g silently, vim does the same
    }

    if (/^[1-9]$/.test(e.key)) {
      const P = pages(), target = P[+e.key - 1];
      if (target) { e.preventDefault(); setActiveTab(target); }
      return;
    }

    switch (e.key) {
      case 'g':
        awaitingG = true;
        window.klabAwaitingG = () => awaitingG; // Photos' own keys stand aside for the second key
        awaitingGTimer = setTimeout(() => { awaitingG = false; }, 700);
        break;
      // The prompt takes typing (js/32-terminal.js): cd music, ls, help.
      case 'd': e.preventDefault(); window.klabTerminal?.open(); break;
      case 'j': e.preventDefault(); scrollPane(90); break;
      case 'k': e.preventDefault(); scrollPane(-90); break;
      case 'G': e.preventDefault(); scrollPaneToEdge(false); break;
      case '/': {
        const search = document.getElementById('pickerSearch');
        const onMusic = document.querySelector('.tab-panel[data-tab-panel="music"]')?.classList.contains('active');
        // The search box is in Music's sidebar: bring that back if it's hidden.
        // / is search, everywhere (vim's): the title bar's /search on Music
        // and Social; on a page with nothing to search, Music's.
        e.preventDefault();
        if (window.klabOpenHeaderFind?.()) break;
        if (!onMusic) {
          setActiveTab('music');
          setTimeout(() => { if (!window.klabOpenHeaderFind?.()) { window.klabPane?.show('music'); search?.focus(); } }, 80);
          break;
        }
        if (search) { window.klabPane?.show('music'); search.focus(); }
        break;
      }
      case 'w': case 's': if (stepSubTab(e.key === 's' ? 1 : -1)) e.preventDefault(); break;
      // ←/→: along the page's sections in the sidebar (Music's, Social's),
      // stopping at the ends. Pages change only with Tab.
      // Photos keeps its own ←/→ (photo to photo).
      case 'ArrowLeft': case 'ArrowRight': {
        if (e.defaultPrevented || e.altKey || e.shiftKey || !arrowsFree()) break;
        if (document.body.classList.contains('tab-photos-active')) break;
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        // Only rows you can see and that are a section: "Connect chat" is a
        // .picker-tab too (→ on Chat re-ran the connect, or opened sign-in).
        const row = [...document.querySelectorAll('html.nav-tree #sideNav .nav-sub.open .picker-tab')]
          .filter(b => b.offsetParent && b.matches('[data-tab], [data-soc], [data-mc]'));
        if (!row.length) break;
        e.preventDefault();
        const at = row.findIndex(b => b.classList.contains('active'));
        const to = at < 0 ? (dir > 0 ? 0 : row.length - 1) : at + dir;
        if (to < 0 || to >= row.length) break;
        row[to].click();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        break;
      }
      case 'ArrowUp': case 'ArrowDown':
        if (!e.defaultPrevented && !e.shiftKey && arrowsFree() && stepSubTab(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
        break;
      // b: the page's own sidebar where there is one, otherwise (the one
      // sidebar: html.nav-tree) the main sidebar, folded and back.
      case 'b': {
        if (window.klabPane?.toggle()) { e.preventDefault(); break; }
        const burger = document.getElementById('navBurger');
        if (burger?.offsetParent) { e.preventDefault(); burger.click(); }
        break;
      }
      case 'n': e.preventDefault(); document.getElementById('btnNext')?.click(); break;
      case 'p': e.preventDefault(); document.getElementById('btnPrev')?.click(); break;
      case '?': e.preventDefault(); toggleKeyHints(); break;
    }
  });
})();
