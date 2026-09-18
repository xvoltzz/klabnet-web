
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
  const GO_TO_TAB = { f: 'feed', c: 'chat', m: 'music', a: 'apps', k: 'klabcraft' };
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

// ══════════════════════════════════════════
//  LEADERBOARD (experimental) — minutes listened, posts, reactions given,
//  music requests. Gated behind Settings > Experimental Features, off by
//  default for anyone who hasn't opted in. Opened as a modal from the
//  header's own trophy button (#leaderboardBtn, kept directly visible
//  rather than tucked in the overflow menu — the whole point of a
//  leaderboard is encouraging people to actually go look at it), not its
//  own tab. Server-
//  computed (klabnet-api's /api/leaderboard aggregates posts/post_reactions/
//  music_requests, plus a listening_stats table it accumulates from the
//  existing presence heartbeat) — nothing tracked client-side here beyond
//  displaying it.
// ══════════════════════════════════════════
let _leaderboardData   = [];
let _leaderboardMetric = 'seconds_listened';

function fmtLeaderboardValue(metric, value) {
  if (metric !== 'seconds_listened') return String(value);
  const mins = Math.round(value / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

async function fetchLeaderboard() {
  const listEl = document.getElementById('leaderboardList');
  if (!listEl) return;
  try {
    const res = await fetchTimeout('/api/leaderboard', {}, 8000);
    const data = await res.json();
    _leaderboardData = data.leaderboard || [];
  } catch (e) {
    listEl.innerHTML = '<div class="picker-empty">failed to load</div>';
    return;
  }
  renderLeaderboardList();
}

function renderLeaderboardList() {
  const listEl = document.getElementById('leaderboardList');
  if (!listEl) return;
  const ranked = _leaderboardData
    .filter(u => (u[_leaderboardMetric] || 0) > 0)
    .sort((a, b) => (b[_leaderboardMetric] || 0) - (a[_leaderboardMetric] || 0));
  if (!ranked.length) {
    listEl.innerHTML = '<div class="picker-empty">nobody yet</div>';
    return;
  }
  let anyUnresolvedAvatar = false;
  listEl.innerHTML = ranked.map((u, i) => {
    const rank = i + 1;
    const avatarUrl = window.klabResolveUserAvatar ? window.klabResolveUserAvatar(u.username) : null;
    if (!avatarUrl) anyUnresolvedAvatar = true;
    const avatarInner = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="" />` : esc((u.username || '?')[0].toUpperCase());
    // Icon-font trophy instead of an emoji medal — everywhere else in the
    // app's chrome (including the header button that opens this panel)
    // uses ti-* icons; the emoji reaction picker is the one deliberate
    // exception (see its own comment), not this. Colored to match each
    // rank's existing row-tint (.lb-rank-1/2/3 below).
    const rankInner = rank <= 3
      ? `<i class="ti ti-trophy" style="color:${rank === 1 ? '#eab308' : rank === 2 ? '#94a3b8' : '#b4783c'}"></i>`
      : String(rank);
    return `<div class="lb-row${rank <= 3 ? ' lb-rank-' + rank : ''}">
      <div class="lb-rank">${rankInner}</div>
      <div class="lb-avatar" title="${esc(u.username)}">${avatarInner}</div>
      <div class="lb-name" style="color:${profileColor(u.username)}">${esc(u.username)}</div>
      <div class="lb-value">${fmtLeaderboardValue(_leaderboardMetric, u[_leaderboardMetric] || 0)}</div>
    </div>`;
  }).join('');
  // Same "nudge a re-render once resolved" idea as the music-requests list —
  // window.klabResolveUserAvatar only re-renders the FEED module itself on
  // a cache-miss resolving. Guarded on the modal still actually being the
  // one open (it could've been closed, or replaced by an unrelated
  // openChatModal() call, by the time this fires).
  if (anyUnresolvedAvatar) setTimeout(() => {
    if (document.getElementById('chatModalBackdrop')?.classList.contains('open') && document.getElementById('leaderboardList')) {
      renderLeaderboardList();
    }
  }, 900);
}

// Opened from the header's own trophy button (#leaderboardBtn), same shared
// modal shell as the music-request search/DM list/etc — chatModalBody gets
// torn down and rebuilt on every open, so the metric-button listeners are
// (re)bound fresh each time rather than once, same reason the bg-color
// picker's swatches are (see its own comment on that).
function openLeaderboardModal() {
  openChatModal('// leaderboard', `
    <div class="lb-metric-row">
      <button class="lb-metric-btn${_leaderboardMetric === 'seconds_listened' ? ' active' : ''}" data-metric="seconds_listened" type="button"><i class="ti ti-headphones"></i> Minutes Listened</button>
      <button class="lb-metric-btn${_leaderboardMetric === 'posts_count' ? ' active' : ''}" data-metric="posts_count" type="button"><i class="ti ti-news"></i> Posts</button>
      <button class="lb-metric-btn${_leaderboardMetric === 'reactions_given_count' ? ' active' : ''}" data-metric="reactions_given_count" type="button"><i class="ti ti-mood-plus"></i> Reactions Given</button>
      <button class="lb-metric-btn${_leaderboardMetric === 'requests_count' ? ' active' : ''}" data-metric="requests_count" type="button"><i class="ti ti-disc-plus"></i> Requests</button>
    </div>
    <div class="lb-list" id="leaderboardList"><div class="picker-empty">loading...</div></div>
  `);
  document.querySelectorAll('.lb-metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lb-metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _leaderboardMetric = btn.dataset.metric;
      renderLeaderboardList();
      SFX && SFX.play('click');
    });
  });
  fetchLeaderboard();
}
document.getElementById('leaderboardBtn')?.addEventListener('click', openLeaderboardModal);

// ══════════════════════════════════════════
//  MAINTENANCE
// ══════════════════════════════════════════
const MAINT_KEY='klabnet_maintenance';
let maintenance={};
try { maintenance = JSON.parse(localStorage.getItem(MAINT_KEY)||'{}'); } catch (e) {} // corrupted/blocked storage — don't let this throw abort every script statement after it
const saveMaint=()=>localStorage.setItem(MAINT_KEY,JSON.stringify(maintenance));
const isMaint=id=>!!maintenance[id];

// ══════════════════════════════════════════
//  STATUS
// ══════════════════════════════════════════
const TILE_DOTS={3:'dot-3',4:'dot-4',5:'dot-5',6:'dot-6',12:'dot-12'};

function applyDot(id,status){
  const el=document.getElementById(TILE_DOTS[id]);
  if(!el)return;
  el.className='tile-dot '+(isMaint(id)?'maintenance':status===1?'up':'down');
}
// The header used to show an aggregate ONLINE/DEGRADED/STATUS UNAVAILABLE
// badge (updateHeader(), fed by the allUp flag below) right next to the
// icon row — removed per feedback, nobody needed a second status readout
// up there. Individual app tiles' up/down dots (applyDot()/TILE_DOTS,
// still very much used in the Apps grid) are untouched.
let lastBeats={};
async function fetchStatus(){
  if (document.hidden) return;
  try{
    const res=await fetchTimeout('/api/status-page/heartbeat/main', {}, 8000);
    if(!res.ok)throw new Error(res.status);
    const data=await res.json();
    lastBeats=data.heartbeatList;
    for(const[id,list]of Object.entries(lastBeats)){
      if(!list||!list.length)continue;
      const latest=list[list.length-1],numId=parseInt(id);
      applyDot(numId,latest.status);
    }
  }catch(e){}
  // Gitea: ping with Image() — works cross-origin, no CORS needed
  checkGitea();
}

function checkGitea() {
  const dot = document.getElementById('dot-gitea');
  if (!dot) return;
  // Use a favicon/manifest ping — resolves if server is up
  const img = new Image();
  const t = Date.now();
  img.onload = () => { dot.className = 'tile-dot up'; };
  img.onerror = () => {
    // onerror fires for both "server down" AND "server up but no image"
    // Check timing: fast error = server responded (just no favicon), slow = actually down
    const elapsed = Date.now() - t;
    dot.className = elapsed < 4000 ? 'tile-dot up' : 'tile-dot down';
  };
  // Set a timeout for truly unreachable hosts
  setTimeout(() => {
    if (!dot.className.includes('up')) dot.className = 'tile-dot down';
  }, 5000);
  img.src = 'https://git.klab.gg/favicon.ico?_=' + t;
}
fetchStatus();
setInterval(fetchStatus,60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchStatus(); });
Object.keys(maintenance).forEach(id=>applyDot(parseInt(id),0));

// ══════════════════════════════════════════
//  CONTEXT MENU
// ══════════════════════════════════════════
// Both context menus (app tiles here, presence cards further down) are
// fixed-position elements living inside the zoomed `html` subtree (see the
// `zoom` tiers on large displays, up in the base stylesheet). `clientX`/
// `clientY` are reported in real, unzoomed viewport pixels, but a
// fixed-position descendant's `left`/`top` are lengths *inside* the zoomed
// context — assigning the raw client coords shoots the menu off to the
// right/bottom by the zoom factor (confirmed: at zoom 1.3, a menu placed
// at clientX=3407 on a 3440px-wide screen rendered ~760px off-screen).
// Dividing both the coordinates and the viewport bounds by the current
// zoom factor converts everything back into the zoomed element's own
// coordinate space before positioning.
function zoomFactor(){ return parseFloat(getComputedStyle(document.documentElement).zoom) || 1; }
const ctxMenu=document.getElementById('ctxMenu');
function showCtx(x,y,tile){
  const id=parseInt(tile.dataset.id);
  document.getElementById('ctxTitle').textContent=tile.dataset.name;
  document.getElementById('ctxOpen').onclick=()=>{window.open(tile.dataset.url,'_blank');hideCtx();};
  const inMaint=isMaint(id);
  const cm=document.getElementById('ctxMaintenance');
  cm.innerHTML=''; const ic=document.createElement('i'); ic.className='ti ti-tool'; cm.appendChild(ic);
  cm.appendChild(document.createTextNode(' '+(inMaint?'Clear Maintenance':'Set Maintenance')));
  cm.className='ctx-item warn'+(inMaint?' active-warn':'');
  cm.onclick=()=>{
    if(inMaint){delete maintenance[id];}else{maintenance[id]=true;}
    saveMaint();
    const list=lastBeats[id];
    applyDot(id,list&&list.length?list[list.length-1].status:1);
    hideCtx();
  };
  const z=zoomFactor();
  ctxMenu.style.left=Math.min(x/z,window.innerWidth/z-210)+'px';
  ctxMenu.style.top=Math.min(y/z,window.innerHeight/z-140)+'px';
  ctxMenu.classList.add('visible');
}
function hideCtx(){ctxMenu.classList.remove('visible');}

document.getElementById('appGrid').addEventListener('contextmenu',e=>{
  const tile=e.target.closest('.tile'); if(!tile)return;
  e.preventDefault(); showCtx(e.clientX,e.clientY,tile);
});
document.addEventListener('click',e=>{if(!ctxMenu.contains(e.target))hideCtx();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideCtx();});
document.addEventListener('contextmenu',e=>{if(!e.target.closest('.tile'))e.preventDefault();});

