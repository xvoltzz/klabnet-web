// ══════════════════════════════════════════
//  GAMES → MINECRAFT — the klabcraft dashboard, the part anyone may see
//
//  The overview, who's on and everyone who's played (with their profile
//  and skin), and the live map, from the klabcraft-dashboard repo (its
//  web/js) nearly as written there, so the two are easy to keep in step.
//  Left out: everything that runs the server (power, console, chat,
//  files, settings, backups, the whitelist and bans). The dashboard
//  answers klabnet as a viewer whoever you are (its KLABNET_PROXY_SECRET),
//  so none of that would work here anyway; admins have mc.klab.gg.
//
//  Every request goes to /api/mc/..., which klabnet's Caddy hands to the
//  dashboard as /api/... with the shared secret added.
//
//  It draws into a shadow root (#gamesMc) so its ids and its stylesheet
//  (css/games-mc.css) never meet klabnet's; klabnet's colours still reach
//  it, as custom properties do. The drawer, dialogs, the game's toasts
//  and the chart tooltip float above the page, in a second one on <body>.
//  The modules keep their names (Live, Overview, Players, MapView...)
//  inside this one function, so none of them is a global.
// ══════════════════════════════════════════
(function() {
  'use strict';
  const mcHost = document.getElementById('gamesMc');
  if (!mcHost) return;
  const SHEETS = `<link rel="stylesheet" href="css/icons.css?v=${KLABNET_VERSION}" /><link rel="stylesheet" href="css/games-mc.css?v=${KLABNET_VERSION}" />`;
  const root = mcHost.attachShadow({ mode: 'open' });
  root.innerHTML = SHEETS + `
    <div class="mc-root" id="mcRoot">
      <div class="gate" id="gate"><div class="muted"><i class="ti ti-loader-2 spin"></i> Connecting</div></div>
      <div class="banner" id="banner" hidden></div>
      <section class="view" data-view="overview" id="viewOverview"></section>
      <section class="view" data-view="players" id="viewPlayers"></section>
      <section class="view view-fill" data-view="map" id="viewMap"></section>
    </div>`;
  const layerHost = document.createElement('div');
  layerHost.className = 'games-mc-layer';
  document.body.appendChild(layerHost);
  const layer = layerHost.attachShadow({ mode: 'open' });
  layer.innerHTML = SHEETS + `
    <div class="mc-root mc-layer" id="layer">
      <div class="drawer-backdrop" id="drawerBackdrop"></div>
      <aside class="drawer" id="drawer" aria-hidden="true"></aside>
      <div class="toast-flyout" id="toasts" aria-live="polite"></div>
      <div class="modal-backdrop" id="modal">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <div class="modal-title"><span id="modalTitle"></span><button class="icon-btn" id="modalClose" title="Close" aria-label="Close"><i class="ti ti-x"></i></button></div>
          <div id="modalBody"></div>
        </div>
      </div>
      <div class="chart-tip" id="chartTip" hidden></div>
    </div>`;
  // The dashboard's $ and $$, looking in both.
  const $ = (sel, r) => r ? r.querySelector(sel) : root.querySelector(sel) || layer.querySelector(sel);
  const $$ = (sel, r) => r ? Array.from(r.querySelectorAll(sel)) : [...root.querySelectorAll(sel), ...layer.querySelectorAll(sel)];
  const $navCount = () => document.getElementById('gamesPlayersCount');

  // ══ Helpers ══
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  // Every request that changes something carries X-Klabcraft, which the server
  // insists on: a form on another site can't add a header.
  async function api(path, { method = 'GET', body, form, raw } = {}) {
    const init = { method, headers: { 'X-Klabcraft': '1' }, credentials: 'same-origin' };
    if (form) init.body = form;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    let res;
    try { res = await fetch(path, init); }
    catch (e) { throw new ApiError("Can't reach the server.", 0); }
    if (!res.ok) {
      let detail = '';
      try { const data = await res.json(); detail = typeof data.detail === 'string' ? data.detail : (data.detail?.[0]?.msg || ''); } catch (e) {}
      throw new ApiError(detail || `Something went wrong (${res.status}).`, res.status);
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }

  // ── Formatting ──
  function fmtBytes(n, digits = 1) {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const v = n / 1024 ** i;
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(digits)} ${units[i]}`;
  }
  function fmtDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${s}s`;
  }
  function fmtAgo(ts) {
    if (!ts) return 'never';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtClock(ts) { return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function fmtDate(ts) { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function fmtNum(n) { return Math.round(n || 0).toLocaleString(); }
  function fmtDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km` : `${Math.round(m)} m`; }
  function plural(n, one, many) { return `${fmtNum(n)} ${n === 1 ? one : (many || one + 's')}`; }
  function titleCase(id) { return String(id || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }

  const DIM_NAMES = { 'minecraft:overworld': 'Overworld', 'minecraft:the_nether': 'The Nether', 'minecraft:the_end': 'The End' };
  function dimLabel(dim) { return DIM_NAMES[dim] || titleCase(String(dim || '').split(':').pop()) || 'Overworld'; }
  const GAMEMODES = ['Survival', 'Creative', 'Adventure', 'Spectator'];

  // ── Minecraft's § formatting, for the MOTD ──
  const MC_COLORS = { 0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff' };
  function motdHtml(text) {
    let out = '', open = 0, style = {};
    const flush = () => { out += '</span>'.repeat(open); open = 0; };
    const start = () => {
      const css = [];
      if (style.color) css.push(`color:${style.color}`);
      if (style.l) css.push('font-weight:800');
      if (style.o) css.push('font-style:italic');
      if (style.n || style.m) css.push(`text-decoration:${[style.n && 'underline', style.m && 'line-through'].filter(Boolean).join(' ')}`);
      if (css.length) { out += `<span style="${css.join(';')}">`; open++; }
    };
    const parts = String(text || '').split(/(§.)/);
    for (const part of parts) {
      if (/^§.$/.test(part)) {
        const code = part[1].toLowerCase();
        flush();
        if (MC_COLORS[code]) style = { color: MC_COLORS[code] };
        else if (code === 'r') style = {};
        else if ('lonm'.includes(code)) style[code] = true;
        start();
      } else out += esc(part);
    }
    flush();
    return out;
  }

  // ── Faces ──
  function faceUrl(player, size = 64) {
    const id = player.uuid || player.name;
    return `/api/mc/head/${encodeURIComponent(id)}?s=${size}&name=${encodeURIComponent(player.name || '')}`;
  }
  function faceImg(player, px = 36, cls = '') {
    return `<img class="face ${cls}" src="${faceUrl(player, px > 32 ? 128 : 64)}" width="${px}" height="${px}" alt="" loading="lazy" />`;
  }

  async function copyText(text, what = 'Copied') {
    try { await navigator.clipboard.writeText(text); toast(what, { icon: 'ti-copy' }); }
    catch (e) { toast("Couldn't copy that.", { bad: true }); }
  }

  // ── Toasts: klabnet's own ──
  function toast(msg, { icon = 'ti-bell', bad = false, face = null, ms = 4200, onClick = null } = {}) {
    if (typeof showToast === 'function') showToast(msg, bad ? 'ti-alert-triangle' : icon, bad ? Math.max(ms, 6500) : ms, face ? faceUrl(face) : null, onClick);
  }
  function toastError(err) { if (err?.status !== 401) toast(err?.message || String(err), { bad: true }); }

  // ── Dialogs ──
  let _modalClose = null;
  function openModal(title, html, onClose) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    _modalClose = onClose || null;
    $('#modal').classList.add('open');
    const first = $('#modalBody input, #modalBody textarea, #modalBody select') || $('#modalBody .btn-primary, #modalBody .btn-danger');
    setTimeout(() => first?.focus(), 30);
  }
  function closeModal(silent) {
    if (!$('#modal').classList.contains('open')) return;
    $('#modal').classList.remove('open');
    const fn = _modalClose; _modalClose = null;
    if (!silent) fn?.();
  }
  function inputDialog({ title, message = '', placeholder = '', value = '', confirm = 'OK', multiline = false, mono = false }) {
    return new Promise(resolve => {
      const field = multiline
        ? `<textarea class="field" id="dlgField" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input class="field ${mono ? 'mono' : ''}" id="dlgField" type="text" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" spellcheck="false" />`;
      openModal(title, `
        ${message ? `<div class="modal-msg">${message}</div>` : ''}
        ${field}
        <div class="modal-actions">
          <button class="btn" id="dlgCancel">Cancel</button>
          <button class="btn btn-primary" id="dlgOk">${esc(confirm)}</button>
        </div>`, () => resolve(null));
      const input = $('#dlgField');
      const done = () => { const v = input.value.trim(); closeModal(true); resolve(v); };
      $('#dlgCancel').onclick = () => closeModal();
      $('#dlgOk').onclick = done;
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); } });
      setTimeout(() => input.select?.(), 40);
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('#modalClose').onclick = () => closeModal();
    $('#modal').addEventListener('pointerdown', e => { if (e.target === e.currentTarget) closeModal(); });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !Games.on) return;
    if ($('#modal').classList.contains('open')) closeModal();
    else if ($('#drawer').classList.contains('open')) closeDrawer();
  });

  // ══ Live ══
  const Live = {
    me: null,
    status: null,
    players: [],
    history: [],
    events: [],
    lines: [],
    connected: false,
    _subs: {},
    _socket: null,
    _retry: 0,

    on(kind, fn) { (this._subs[kind] ||= []).push(fn); },
    emit(kind, data) { for (const fn of this._subs[kind] || []) { try { fn(data); } catch (e) { console.error(e); } } },

    // Never an admin through klabnet: the dashboard answers it as a viewer.
    get admin() { return false; },
    get phase() { return this.status?.phase || 'unknown'; },
    get online() { return this.phase === 'online'; },
    player(name) { return this.players.find(p => p.name === name); },

    connect() {
      if (this._socket) return;
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/mc/live`;
      const socket = this._socket = new WebSocket(url);
      let alive = null;
      socket.onopen = () => {
        this._retry = 0;
        alive = setInterval(() => { if (socket.readyState === 1) socket.send('ping'); }, 25000);
      };
      socket.onmessage = e => this._take(JSON.parse(e.data));
      socket.onclose = e => {
        clearInterval(alive);
        this._socket = null;
        if (this.connected) { this.connected = false; this.emit('link', false); }
        if (e.code === 4401 || e.code === 4403) { Games.gate(e.code === 4401 ? 401 : 403); return; }
        this._retry = Math.min(this._retry + 1, 6);
        // Never got as far as hello: say so, and keep trying underneath.
        if (!this.status && this._retry >= 4) Games.gate('live');
        setTimeout(() => { if (Games.wanted) this.connect(); }, 400 * 2 ** this._retry);
      };
    },

    disconnect() { const s = this._socket; this._socket = null; if (s) { s.onclose = null; s.close(); } this.connected = false; },

    _take(msg) {
      switch (msg.type) {
        case 'hello':
          this.status = msg.status; this.players = msg.players; this.history = msg.history;
          this.events = msg.events; this.lines = msg.lines;
          this.connected = true;
          this.emit('link', true); this.emit('reset'); this.emit('status', this.status); this.emit('players', this.players);
          break;
        case 'status': this.status = msg.status; this.emit('status', this.status); break;
        case 'players': this.players = msg.players; this.emit('players', this.players); break;
        case 'stats':
          this.history.push(msg.point);
          if (this.history.length > 1800) this.history.splice(0, this.history.length - 1800);
          this.emit('stats', msg.point);
          break;
        case 'event':
          this.events.push(msg.event);
          if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
          this.emit('event', msg.event);
          break;
        case 'log':
          this.lines.push(...msg.lines);
          if (this.lines.length > 3000) this.lines.splice(0, this.lines.length - 3000);
          this.emit('log', msg.lines);
          break;
      }
    },
  };

  // ══ Fun ══
  // ══ Splash text, the way the title screen does it ══
  // Add your own: one per line, short is funnier. A click on the splash
  // picks another, and it changes by itself every minute or so.
  const SPLASHES = [
    // the server
    'Also try Terraria!', '100% plugin free!', 'Now with a map!', 'Creeper? Aw man', 'Punch a tree!',
    'Chunks, freshly baked', 'Never dig straight down', 'Who left the door open?', 'The cake is a lie',
    'Sleep is for the weak', 'One more block...', 'Diamonds at Y -59!', 'Totally not a virus',
    'Keep inventory? Never', 'Feed the dogs!', 'Half a heart club', 'Elytra go brrr', 'Mind the lava',
    'Villagers are people too', 'Hrmmm.', 'Sssssss...', 'Kiss the cook', 'Bed? Exploded.',
    'The Nether is nice this time of year', '20 TPS or bust', 'Backed up, probably', 'Have you tried restarting?',
    'It works on my chunk', 'Tick tock', 'Made with redstone and spite', 'Uptime is a lifestyle',
    'Certified block game', 'Lag is a state of mind', 'Phantoms hate this one trick',
    // the homelab
    'built by xvoltzz!', 'thank you claude code', 'can i borrow your elytra?', 'invite only!!', 'pre alpha alpha',
    'whats 9 + 10?', 'open source!!', 'METAL COOLER', 'call me braxton', 'try out KLABGIT',
    'like realms but awesome', 'powered by klabnet!', 'self-hosted and proud', 'no ads, no algorithm, just blocks',
    'every chunk hand-carried over ssh',
  ];

  const Splash = {
    el: null, current: null, _timer: 0,

    mount(el) {
      this.el = el;
      el.addEventListener('click', () => this.reroll(false));
      this.set(this.pick());
      this.cycle();
    },

    pick() {
      let next;
      do { next = SPLASHES[Math.floor(Math.random() * SPLASHES.length)]; } while (next === this.current && SPLASHES.length > 1);
      return next;
    },

    // Long ones shrink and tilt less so they stay on the page, as in the game.
    set(text) {
      this.current = text;
      if (!this.el) return;
      this.el.textContent = text;
      const long = Math.max(0, text.length - 16);
      this.el.style.fontSize = `${Math.max(10, 18 - long * 0.42)}px`;
      this.el.style.setProperty('--splash-tilt', `${-Math.max(6, 13 - long * 0.3)}deg`);
    },

    reroll(auto) {
      if (!this.el) return;
      const next = this.pick();
      if (!auto) Sfx.play('star');
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || this.el.offsetParent === null;
      if (still) { this.set(next); return; }
      // A full silly cartwheel, the text swapped while it's edge-on.
      this.el.classList.remove('rerolling');
      void this.el.offsetWidth;
      this.el.classList.add('rerolling');
      setTimeout(() => this.set(next), 300);
      this.el.addEventListener('animationend', () => this.el.classList.remove('rerolling'), { once: true });
    },

    cycle() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        if (!document.hidden) this.reroll(true);
        this.cycle();
      }, 45000 + Math.random() * 30000);
    },
  };

  // ══ Greetings and loading lines ══
  function greeting(name) {
    const hour = new Date().getHours();
    const hello = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const who = name && !['admin', 'anonymous'].includes(name) ? `, ${name}` : '';
    return `${hello}${who}${hour < 5 ? '?' : ''}`;
  }
  const EMPTY_FACES = { nobody: '( ._.)', off: '(-_-) zzZ', nothing: '¯\\_(ツ)_/¯', quiet: '(・_・)' };

  // ══ Pixel art, drawn here rather than borrowed from the game ══
  // Hearts and drumsticks are 9x9 tiles used as repeating backgrounds: an
  // empty row with a full row clipped over it, so 7 health is three and a half.
  const PIXELS = {
    heart: ['.BBB.BBB.', 'BRRRBRRRB', 'BRWRRRRRB', 'BRRRRRRRB', 'BRRRRRRRB', '.BRRRRRB.', '..BRRRB..', '...BRB...', '....B....'],
    food: ['....BBB..', '...BMMMB.', '..BMMLMMB', '..BMMMMMB', '..BMMMMB.', '.BBMMMB..', 'BNNBBB...', 'BNB......', '.B.......'],
  };
  function pixelTile(rows, colours) {
    let rects = '';
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (colours[c]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colours[c]}"/>`; }));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="9" viewBox="0 0 10 9" shape-rendering="crispEdges">${rects}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  function grassBlock() {
    // A block of grass, 16x16: a ragged green top over speckled dirt.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d');
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const greens = ['#5d9c3a', '#6aad42', '#559135', '#73b84a'], dirts = ['#866043', '#79553a', '#93694a', '#6e4c33', '#9b7353'];
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (rand() < 0.3 ? 1 : 0) + (rand() < 0.12 ? 1 : 0);
      for (let y = 0; y < 16; y++) {
        const set = y < depth ? greens : dirts;
        ctx.fillStyle = set[Math.floor(rand() * set.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return canvas.toDataURL();
  }
  let GRASS_ICON = '';
  document.addEventListener('DOMContentLoaded', () => {
    const root = mcHost.style;
    root.setProperty('--heart-full', pixelTile(PIXELS.heart, { B: '#1b0606', R: '#ff1a1a', W: '#ffc9c9' }));
    root.setProperty('--heart-empty', pixelTile(PIXELS.heart, { B: '#1b1b1b', R: '#3a3a3a', W: '#3a3a3a' }));
    root.setProperty('--food-full', pixelTile(PIXELS.food, { B: '#2b1505', M: '#b9692b', L: '#e39a52', N: '#f1ead8' }));
    root.setProperty('--food-empty', pixelTile(PIXELS.food, { B: '#1b1b1b', M: '#3a3a3a', L: '#3a3a3a', N: '#3a3a3a' }));
    GRASS_ICON = grassBlock();
  });
  // value is out of 20, as the game counts it: two to a heart.
  function pips(kind, value) {
    const v = Math.max(0, Math.min(20, value ?? 20));
    return `<span class="pips ${kind}" title="${kind.startsWith('hp') ? 'Health' : 'Food'} ${v / 2} of 10"><i style="width:${v * 5}%"></i></span>`;
  }

  // ══ Toasts in the game's own voice ══
  // lines: [{ text, colour }]. Shown the way chat and the "Advancement Made!"
  // box look in the game, on its dark panel whatever the theme.
  function mcToast(lines, { face = null, ms = 4200, icon = '' } = {}) {
    const host = $('#toasts');
    while (host.children.length >= 4) host.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast-item mc';
    const pic = face ? `<img class="toast-pic" src="${faceUrl(face)}" alt="" />` : icon ? `<span class="toast-pic"><i class="ti ${icon}"></i></span>` : '';
    el.innerHTML = `${pic}<span class="toast-msg">${lines.map(l => `<span style="color:${l.colour || '#fff'}">${esc(l.text)}</span>`).join('')}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    const leave = () => { if (!el.classList.contains('leaving')) { el.classList.add('leaving'); setTimeout(() => el.remove(), 700); } };
    el.addEventListener('click', leave);
    setTimeout(leave, ms);
  }

  // ══ Sound: a few soft notes, synthesized, never a file ══
  // klabnet's idea in miniature: one mallet voice in D major pentatonic, so
  // whatever overlaps still agrees. Off with the speaker button; it only ever
  // plays after you've clicked something (browsers insist).
  const Sfx = (() => {
    let ctx = null, out = null;
    const on = () => typeof _settings === 'undefined' || !!_settings.sfxEnabled;
    const volume = () => typeof _settings === 'undefined' ? 0.7 : _settings.sfxVolume ?? 0.7;
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const D = { D4: 62, Fs4: 66, A4: 69, B4: 71, D5: 74, E5: 76, Fs5: 78, A5: 81, B5: 83, D6: 86 };

    function context() {
      if (!ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        ctx = new Ctx();
        out = ctx.createGain(); out.gain.value = 0.22;
        const tame = ctx.createBiquadFilter(); tame.type = 'lowpass'; tame.frequency.value = 3800;
        out.connect(tame); tame.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx.state === 'running' ? ctx : null;
    }
    function note(midi, at = 0, long = 0.5, level = 1) {
      const c = context(); if (!c) return;
      const t = c.currentTime + at, f = hz(midi) * (1 + (Math.random() - 0.5) * 0.004);
      const osc = c.createOscillator(), mod = c.createOscillator(), depth = c.createGain(), amp = c.createGain();
      osc.frequency.value = f; mod.frequency.value = f * 2;
      depth.gain.setValueAtTime(f * 0.9, t); depth.gain.exponentialRampToValueAtTime(1, t + 0.12);
      mod.connect(depth); depth.connect(osc.frequency);
      amp.gain.setValueAtTime(0.0001, t); amp.gain.exponentialRampToValueAtTime(level, t + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + long);
      osc.connect(amp); amp.connect(out);
      osc.start(t); mod.start(t); osc.stop(t + long + 0.05); mod.stop(t + long + 0.05);
    }
    function noise(at, long, from, to, level) {
      const c = context(); if (!c) return;
      const t = c.currentTime + at, len = Math.floor(c.sampleRate * long);
      const buffer = c.createBuffer(1, len, c.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(), band = c.createBiquadFilter(), amp = c.createGain();
      src.buffer = buffer; band.type = 'bandpass';
      band.frequency.setValueAtTime(from, t); band.frequency.exponentialRampToValueAtTime(to, t + long);
      amp.gain.setValueAtTime(level, t); amp.gain.exponentialRampToValueAtTime(0.0001, t + long);
      src.connect(band); band.connect(amp); amp.connect(out);
      src.start(t);
    }
    const SOUNDS = {
      nav: () => note(D.A4, 0, 0.12, 0.35),
      star: () => { note(D.Fs5, 0, 0.3, 0.6); note(D.B5, 0.07, 0.4, 0.5); },
      join: () => { note(D.D5, 0, 0.5, 0.7); note(D.A5, 0.11, 0.7, 0.6); },
      leave: () => { note(D.A4, 0, 0.4, 0.5); note(D.D4, 0.12, 0.6, 0.45); },
      adv: () => [D.D5, D.Fs5, D.A5, D.D6].forEach((m, i) => note(m, i * 0.09, 0.8, 0.55)),
      online: () => { [D.D4, D.A4, D.Fs5].forEach((m, i) => note(m, i * 0.05, 1.1, 0.5)); },
      offline: () => { note(D.Fs4, 0, 0.5, 0.45); note(D.D4, 0.14, 0.9, 0.45); },
      oof: () => { note(D.D4 - 12, 0, 0.25, 0.7); },
      hiss: () => noise(0, 1.3, 5000, 7000, 0.25),
      boom: () => { noise(0, 0.9, 400, 60, 1.2); note(D.D4 - 24, 0, 0.6, 0.9); },
    };
    return {
      play(name) { if (on() && Games.on && !document.hidden) { try { SOUNDS[name]?.(); if (out) out.gain.value = 0.22 * volume() / 0.7; } catch (e) {} } },
    };
  })();

  // ══ Up, up, down, down, left, right, left, right, b, a ══
  const Creeper = {
    busy: false,
    FACE: ['........', '.##..##.', '.##..##.', '...##...', '..####..', '..####..', '..#..#..', '........'],

    go() {
      if (this.busy) return;
      this.busy = true;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const canvas = document.createElement('canvas');
      canvas.className = 'creeper';
      $('#layer').appendChild(canvas);
      const dpr = Math.min(devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const cell = Math.min(34, Math.floor(Math.min(w, h) / 16)), size = cell * 8, left = (w - size) / 2, top = (h - size) / 2 - 20;
      const greens = ['#5fc44a', '#4fae3d', '#6ad455', '#449936', '#58ba45'];
      const tint = (x, y) => greens[(x * 7 + y * 13 + (x ^ y)) % greens.length];
      const started = performance.now(), FUSE = 1500;
      let bits = null;
      Sfx.play('hiss');

      const frame = now => {
        const t = now - started;
        ctx.clearRect(0, 0, w, h);
        if (t < FUSE) {
          const k = t / FUSE, swell = 1 + k * 0.12, flash = Math.floor(t / 180) % 2 === 1 && k > 0.35;
          ctx.save();
          ctx.globalAlpha = Math.min(1, t / 200);
          ctx.translate(w / 2 + (still ? 0 : (Math.random() - 0.5) * k * 10), top + size / 2);
          ctx.scale(swell, swell);
          ctx.translate(-size / 2, -size / 2);
          this.FACE.forEach((row, y) => [...row].forEach((c, x) => {
            ctx.fillStyle = c === '#' ? '#0c0f0b' : flash ? '#ffffff' : tint(x, y);
            ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
          }));
          ctx.restore();
          ctx.font = '27px Monocraft, monospace';
          ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          ctx.shadowColor = '#000'; ctx.shadowOffsetX = ctx.shadowOffsetY = 2;
          ctx.fillText('Sss' + 's'.repeat(Math.floor(t / 110)) + '...', w / 2, top + size * 1.16 + 30);
          ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
        } else {
          if (!bits) {
            bits = [];
            Sfx.play('boom');
            if (!still) { mcHost.classList.add('mc-shake'); setTimeout(() => mcHost.classList.remove('mc-shake'), 500); }
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let n = 0; n < 4; n++) {
              const angle = Math.random() * Math.PI * 2, speed = 3 + Math.random() * 13;
              bits.push({
                x: left + (x + Math.random()) * cell, y: top + (y + Math.random()) * cell,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 5, s: cell * (0.25 + Math.random() * 0.45),
                c: n === 0 ? '#f4f4f4' : n === 1 ? '#8a8a8a' : this.FACE[y][x] === '#' ? '#0c0f0b' : tint(x, y),
              });
            }
          }
          const age = (t - FUSE) / 1500;
          ctx.globalAlpha = Math.max(0, 1 - age);
          for (const b of bits) {
            b.x += b.vx; b.y += b.vy; b.vy += 0.55; b.vx *= 0.985;
            ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.s, b.s);
          }
          ctx.globalAlpha = 1;
          if (age >= 1 || still) {
            canvas.remove(); this.busy = false;
            mcToast([{ text: "That's a very nice website", colour: '#fff' }, { text: 'you have there...', colour: '#55ff55' }], { ms: 5200 });
            return;
          }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
  };
  (() => {
    const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let at = 0;
    document.addEventListener('keydown', e => {
      if (!Games.on || e.target.closest?.('input, textarea, select')) { at = 0; return; }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      at = key === CODE[at] ? at + 1 : key === CODE[0] ? 1 : 0;
      if (at === CODE.length) { at = 0; Creeper.go(); }
    }, true);
  })();

  // ══ Sparklines ══
  const SPARK_WINDOW = 10 * 60 * 1000;

  class Spark {
    // opts: { value(point) -> number|null, max(points) -> number, format(v) -> string, label }
    constructor(host, opts) {
      this.host = host;
      this.opts = opts;
      this.points = [];
      host.innerHTML = `
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line class="guide" x1="0" x2="100" y1="50" y2="50"></line>
          <path class="area"></path><path class="line"></path>
          <line class="cross" y1="0" y2="100" hidden></line>
        </svg><span class="marker" hidden></span>`;
      this.area = $('.area', host); this.line = $('.line', host);
      this.cross = $('.cross', host); this.marker = $('.marker', host);
      host.addEventListener('pointermove', e => this.hover(e));
      host.addEventListener('pointerleave', () => this.leave());
    }

    update(history) {
      const now = Date.now(), from = now - SPARK_WINDOW;
      const raw = [];
      for (const p of history) {
        if (p.t < from) continue;
        const v = this.opts.value(p);
        if (v !== null && v !== undefined && !Number.isNaN(v)) raw.push({ t: p.t, v });
      }
      // About one point per two pixels is all a line this size can show.
      const want = Math.max(40, Math.floor(this.host.clientWidth / 2));
      const step = Math.max(1, Math.ceil(raw.length / want));
      const pts = [];
      for (let i = 0; i < raw.length; i += step) {
        const slice = raw.slice(i, i + step);
        pts.push({ t: slice[slice.length - 1].t, v: slice.reduce((a, b) => a + b.v, 0) / slice.length });
      }
      this.points = pts; this.from = from; this.now = now;
      if (pts.length < 2) { this.line.setAttribute('d', ''); this.area.setAttribute('d', ''); return; }
      this.max = Math.max(this.opts.max(pts), 1e-9);
      const x = p => (p.t - from) / SPARK_WINDOW * 100;
      const y = p => 96 - Math.min(p.v / this.max, 1) * 90;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join('');
      this.line.setAttribute('d', d);
      this.area.setAttribute('d', `${d}L${x(pts[pts.length - 1]).toFixed(2)},100L${x(pts[0]).toFixed(2)},100Z`);
      this._x = x; this._y = y;
    }

    hover(e) {
      if (this.points.length < 2) return;
      const box = this.host.getBoundingClientRect();
      const t = this.from + (e.clientX - box.left) / box.width * SPARK_WINDOW;
      let best = this.points[0];
      for (const p of this.points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      const px = this._x(best), py = this._y(best);
      this.cross.setAttribute('x1', px); this.cross.setAttribute('x2', px);
      this.cross.hidden = false;
      this.marker.hidden = false;
      this.marker.style.left = `${px}%`; this.marker.style.top = `${py}%`;
      const tip = $('#chartTip');
      tip.innerHTML = `<b>${esc(this.opts.format(best.v))}</b>${esc(this.opts.label)} at ${new Date(best.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(innerWidth - tw - 8, Math.max(8, box.left + box.width * px / 100 - tw / 2))}px`;
      tip.style.top = `${box.top - tip.offsetHeight - 8}px`;
    }

    leave() { this.cross.hidden = true; this.marker.hidden = true; $('#chartTip').hidden = true; }
  }

  // ══ Skins ══
  const SKIN_UV = {
    // part: [width, height, depth, u, v] where (u, v) is the top-left of the
    // part's unfolded box in the skin; `over` is the same box for its outer layer.
    head: { size: [8, 8, 8], at: [0, 0], over: [32, 0], pos: [0, -12, 0] },
    body: { size: [8, 12, 4], at: [16, 16], over: [16, 32], pos: [0, -2, 0] },
    armR: { size: [4, 12, 4], at: [40, 16], over: [40, 32], pos: [-6, -2, 0] },
    armL: { size: [4, 12, 4], at: [32, 48], over: [48, 48], pos: [6, -2, 0] },
    legR: { size: [4, 12, 4], at: [0, 16], over: [0, 32], pos: [-2, 10, 0] },
    legL: { size: [4, 12, 4], at: [16, 48], over: [0, 48], pos: [2, 10, 0] },
  };

  function skinBox(url, [w, h, d], [u, v], scale, grow) {
    const part = document.createElement('div');
    part.className = 'part';
    // Where each face sits in the unfolded box, and how it's turned into place.
    const faces = [
      [w, h, u + d, v + d, `translateZ(${d / 2 * scale}px)`],                              // front
      [w, h, u + d + w + d, v + d, `rotateY(180deg) translateZ(${d / 2 * scale}px)`],      // back
      [d, h, u, v + d, `rotateY(-90deg) translateZ(${w / 2 * scale}px)`],                  // the player's right
      [d, h, u + d + w, v + d, `rotateY(90deg) translateZ(${w / 2 * scale}px)`],           // the player's left
      [w, d, u + d, v, `rotateX(90deg) translateZ(${h / 2 * scale}px)`],                   // top
      [w, d, u + d + w, v, `rotateX(-90deg) translateZ(${h / 2 * scale}px)`],              // bottom
    ];
    for (const [fw, fh, fu, fv, turn] of faces) {
      const face = document.createElement('div');
      face.className = 'f';
      face.style.cssText = `width:${fw * scale}px;height:${fh * scale}px;left:${-fw * scale / 2}px;top:${-fh * scale / 2}px;` +
        `background-image:url("${url}");background-size:${64 * scale}px ${64 * scale}px;` +
        `background-position:${-fu * scale}px ${-fv * scale}px;transform:${turn};`;
      part.appendChild(face);
    }
    if (grow) part.style.transform = `scale3d(${grow},${grow},${grow})`;
    return part;
  }

  function renderSkin(stage, url, slim) {
    const scale = 7;
    stage.innerHTML = '<div class="skin-hop"><div class="skin3d"></div></div>';
    const hop = stage.firstElementChild, model = hop.firstElementChild;
    const pose = { armR: 'rotateX(-14deg)', armL: 'rotateX(12deg)', legR: 'rotateX(10deg)', legL: 'rotateX(-10deg)', head: 'rotateY(-6deg)' };
    for (const [name, part] of Object.entries(SKIN_UV)) {
      let size = part.size, pos = part.pos;
      if (slim && name.startsWith('arm')) {
        size = [3, 12, 4];
        pos = [name === 'armR' ? -5.5 : 5.5, -2, 0];
      }
      const holder = document.createElement('div');
      holder.className = 'part';
      // Limbs swing from their top edge.
      const swing = pose[name] || '';
      holder.style.transformOrigin = `0 ${-size[1] / 2 * scale}px 0`;
      holder.style.transform = `translate3d(${pos[0] * scale}px,${pos[1] * scale}px,0) ${swing}`;
      holder.appendChild(skinBox(url, size, part.at, scale, 0));
      holder.appendChild(skinBox(url, size, part.over, scale, name === 'head' ? 1.12 : 1.08));
      model.appendChild(holder);
    }
    let yaw = -28, pitch = -8, drag = null;
    const apply = () => { model.style.transform = `rotateX(${pitch}deg) rotateY(${yaw}deg)`; };
    apply();
    stage.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; stage.setPointerCapture(e.pointerId); };
    stage.onpointermove = e => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      yaw = drag.yaw + (e.clientX - drag.x) * 0.6;
      pitch = Math.max(-40, Math.min(40, drag.pitch - (e.clientY - drag.y) * 0.4));
      apply();
    };
    stage.onpointercancel = () => { drag = null; };
    stage.onpointerup = () => {
      // Not a drag: a punch. They hop and flash red, as you'd expect.
      if (drag && !drag.moved) {
        hop.classList.remove('hit');
        void hop.offsetWidth;
        hop.classList.add('hit');
        Sfx.play('oof');
        setTimeout(() => hop.classList.remove('hit'), 420);
      }
      drag = null;
    };
  }

  async function loadSkin(stage, player) {
    const id = player.uuid || player.name;
    const url = `/api/mc/skin/${encodeURIComponent(id)}?name=${encodeURIComponent(player.name || '')}`;
    let slim = false;
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      slim = res.headers.get('X-Skin-Model') === 'slim';
    } catch (e) {}
    renderSkin(stage, url, slim);
  }

  // ══ The map ══
  const WM_SCALES = [64, 128, 256, 512];

  class WorldMap {
    constructor(host, { interactive = true, onHover = null, onPick = null, onMove = null } = {}) {
      this.host = host;
      this.interactive = interactive;
      this.onHover = onHover; this.onPick = onPick; this.onMove = onMove;
      this.index = null;
      this.dim = 'minecraft:overworld';
      this.cx = 0; this.cz = 0; this.zoom = 1;
      this.tiles = new Map();       // "dim/rx/rz" -> { img, v, r, s, want }
      this.loading = 0; this.queue = [];
      this.people = new Map();      // name -> { player, from, to, t0, face }
      this.away = [];
      this.show = { players: true, away: false, trails: true, spawn: true };
      this.trails = new Map();
      this.follow = null;
      this.hovered = null;
      this._raf = 0; this._placed = false;

      host.classList.add('wm');
      host.innerHTML = '<canvas></canvas>';
      this.canvas = host.firstElementChild;
      this.ctx = this.canvas.getContext('2d');
      new ResizeObserver(() => this.resize()).observe(host);
      this.resize();
      if (interactive) this._bind();
    }

    // ── data in ──

    setIndex(index) {
      this.index = index;
      if (!this.dimInfo() && index.dims.length) this.dim = index.dims[0].id;
      if (!this._placed && index.dims.length) { this.home(); this._placed = true; }
      this.redraw();
    }

    dimInfo() { return this.index?.dims.find(d => d.id === this.dim) || null; }

    setDim(dim) {
      if (dim === this.dim) return;
      this.dim = dim;
      this.home();
      this.redraw();
    }

    // Centre on spawn (or the middle of what exists) at a comfortable zoom.
    home() {
      const info = this.dimInfo(), spawn = this.index?.level?.spawn;
      if (spawn && spawn.dim === this.dim) { this.cx = spawn.x; this.cz = spawn.z; }
      else if (info?.regions.length) {
        const xs = info.regions.map(r => r[0]), zs = info.regions.map(r => r[1]);
        this.cx = (Math.min(...xs) + Math.max(...xs) + 1) * 256;
        this.cz = (Math.min(...zs) + Math.max(...zs) + 1) * 256;
      } else { this.cx = this.cz = 0; }
      if (info?.regions.length) {
        const xs = info.regions.map(r => r[0]), zs = info.regions.map(r => r[1]);
        const span = Math.max(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1) * 512;
        const fit = Math.min(this.w, this.h) / span;
        this.zoom = Math.max(0.12, Math.min(this.interactive ? 1.5 : 0.75, fit * (this.interactive ? 1.6 : 1.15)));
      }
      this.onMove?.();
    }

    setPlayers(players) {
      const now = performance.now(), seen = new Set();
      for (const p of players) {
        seen.add(p.name);
        if (p.x === undefined) continue;
        let entry = this.people.get(p.name);
        if (!entry) {
          const face = new Image();
          face.onload = () => this.redraw();
          face.src = faceUrl(p, 64);
          entry = { face, from: { x: p.x, z: p.z, yaw: p.yaw || 0 }, to: { x: p.x, z: p.z, yaw: p.yaw || 0 }, t0: now };
          this.people.set(p.name, entry);
        } else {
          const at = this._at(entry, now);
          // A jump (teleport, portal) shouldn't be drawn as a sprint across the map.
          const far = Math.hypot(p.x - at.x, p.z - at.z) > 64 || entry.player.dim !== p.dim;
          entry.from = far ? { x: p.x, z: p.z, yaw: p.yaw || 0 } : at;
          entry.to = { x: p.x, z: p.z, yaw: p.yaw ?? at.yaw };
          entry.t0 = now;
          if (far) this.trails.delete(p.name);
        }
        entry.player = p;
        const trail = this.trails.get(p.name) || [];
        const last = trail[trail.length - 1];
        if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1.5) trail.push({ x: p.x, z: p.z, dim: p.dim });
        if (trail.length > 90) trail.shift();
        this.trails.set(p.name, trail);
      }
      for (const name of [...this.people.keys()]) if (!seen.has(name)) { this.people.delete(name); this.trails.delete(name); }
      this.redraw();
    }

    setAway(list) { this.away = list.map(p => ({ ...p, face: null })); this.redraw(); }

    _at(entry, now) {
      const k = Math.min(1, (now - entry.t0) / 1100);
      let turn = ((entry.to.yaw - entry.from.yaw + 540) % 360) - 180;
      return {
        x: entry.from.x + (entry.to.x - entry.from.x) * k,
        z: entry.from.z + (entry.to.z - entry.from.z) * k,
        yaw: entry.from.yaw + turn * k,
        moving: k < 1,
      };
    }

    // ── view ──

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = this.host.clientWidth; this.h = this.host.clientHeight; this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(this.w * dpr));
      this.canvas.height = Math.max(1, Math.round(this.h * dpr));
      if (this.index && !this._placed && this.w) { this.home(); this._placed = true; }
      this.redraw();
    }

    toScreen(x, z) { return [(x - this.cx) * this.zoom + this.w / 2, (z - this.cz) * this.zoom + this.h / 2]; }
    toWorld(sx, sy) { return [(sx - this.w / 2) / this.zoom + this.cx, (sy - this.h / 2) / this.zoom + this.cz]; }

    zoomBy(factor, sx = this.w / 2, sy = this.h / 2) {
      const [wx, wz] = this.toWorld(sx, sy);
      this.zoom = Math.max(0.04, Math.min(16, this.zoom * factor));
      this.cx = wx - (sx - this.w / 2) / this.zoom;
      this.cz = wz - (sy - this.h / 2) / this.zoom;
      this.onMove?.();
      this.redraw();
    }

    goTo(x, z, zoom) {
      this.cx = x; this.cz = z;
      if (zoom) this.zoom = zoom;
      this.onMove?.();
      this.redraw();
    }

    redraw() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); }); }

    // ── tiles ──

    _wantTile(rx, rz, v) {
      const key = `${this.dim}/${rx}/${rz}`;
      const need = 512 * this.zoom * this.dpr;
      const s = WM_SCALES.find(n => n >= need) || 512;
      let tile = this.tiles.get(key);
      // The drawing's own version: it moves when the server is updated to
      // draw differently, and every picture is asked for again.
      const r = this.index?.rv || 0;
      if (!tile) { tile = { img: null, v: 0, r: 0, s: 0, want: null, failed: 0 }; this.tiles.set(key, tile); }
      const stale = tile.v !== v || tile.r !== r || tile.s < s;
      // One request per region at a time. If the version moves while one is
      // out, the next is asked for when it lands, and what lands is shown
      // either way: where people are playing the version never sits still,
      // and waiting for "the latest" meant never showing anything.
      if (stale && !tile.want && Date.now() - tile.failed > 20000) {
        tile.want = { v, r, s, dim: this.dim, rx, rz, tile };
        this.queue.push(tile.want);
        this._pump();
      }
      return tile;
    }

    _pump() {
      while (this.loading < 6 && this.queue.length) {
        // Nearest the middle of the view first.
        let best = 0, bestD = Infinity;
        this.queue.forEach((job, i) => {
          const d = Math.hypot((job.rx + 0.5) * 512 - this.cx, (job.rz + 0.5) * 512 - this.cz);
          if (d < bestD) { bestD = d; best = i; }
        });
        const job = this.queue.splice(best, 1)[0];
        this.loading++;
        const img = new Image();
        const done = ok => {
          this.loading--;
          job.tile.want = null;
          if (ok) { job.tile.img = img; job.tile.v = job.v; job.tile.r = job.r; job.tile.s = job.s; job.tile.failed = 0; }
          else job.tile.failed = Date.now();
          this._pump();
          this.redraw();
        };
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = `/api/mc/map/tile/${encodeURIComponent(job.dim)}/${job.rx}/${job.rz}?s=${job.s}&v=${job.v}&r=${job.r}`;
      }
    }

    // ── drawing ──

    draw() {
      const { ctx, w, h, dpr } = this;
      if (!w || !h || !this.host.isConnected) return;
      const now = performance.now();
      const light = document.documentElement.dataset.theme === 'light';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = light ? '#d9dce0' : '#0c0d10';
      ctx.fillRect(0, 0, w, h);

      let animating = false;
      if (this.follow) {
        const entry = this.people.get(this.follow);
        if (entry && entry.player.dim === this.dim) {
          const at = this._at(entry, now);
          this.cx = at.x; this.cz = at.z;
        }
      }

      const info = this.dimInfo();
      let waiting = 0;
      if (info) {
        const [x0, z0] = this.toWorld(0, 0), [x1, z1] = this.toWorld(w, h);
        ctx.imageSmoothingEnabled = this.zoom < 1;
        ctx.imageSmoothingQuality = 'high';
        for (const [rx, rz, v] of info.regions) {
          if ((rx + 1) * 512 < x0 || rx * 512 > x1 || (rz + 1) * 512 < z0 || rz * 512 > z1) continue;
          const tile = this._wantTile(rx, rz, v);
          const [sx, sy] = this.toScreen(rx * 512, rz * 512);
          const size = 512 * this.zoom;
          // Snap to whole pixels so neighbouring regions meet without a seam.
          const px = Math.round(sx * dpr) / dpr, py = Math.round(sy * dpr) / dpr;
          const pw = Math.round((sx + size) * dpr) / dpr - px, ph = Math.round((sy + size) * dpr) / dpr - py;
          if (tile.img) ctx.drawImage(tile.img, px, py, pw, ph);
          else {
            waiting++;
            ctx.fillStyle = light ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.025)';
            ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
          }
        }
      }
      this.waiting = waiting;

      const spawn = this.index?.level?.spawn;
      if (this.show.spawn && spawn && spawn.dim === this.dim) this._drawSpawn(spawn);

      if (this.show.away) {
        for (const p of this.away) {
          if (p.dim !== this.dim) continue;
          if (!p.face) { p.face = new Image(); p.face.onload = () => this.redraw(); p.face.src = faceUrl(p, 64); }
          const [sx, sy] = this.toScreen(p.x, p.z);
          if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) continue;
          this._drawFace(p.face, sx, sy, 18, 0.5, null, this.hovered === p ? p.name : null, light);
        }
      }

      if (this.show.players) {
        if (this.show.trails && this.interactive) this._drawTrails(light);
        for (const [name, entry] of this.people) {
          if (entry.player.dim !== this.dim) continue;
          const at = this._at(entry, now);
          if (at.moving) animating = true;
          entry.screen = this.toScreen(at.x, at.z);
          const [sx, sy] = entry.screen;
          if (sx < -40 || sy < -40 || sx > w + 40 || sy > h + 40) continue;
          this._drawFace(entry.face, sx, sy, this.interactive ? 26 : 20, 1, at.yaw, this.interactive || this.people.size <= 6 ? name : null, light,
            this.hovered === entry || this.follow === name);
        }
      }
      if (animating || (this.follow && animating)) this.redraw();
    }

    _drawSpawn(spawn) {
      const { ctx } = this;
      const [sx, sy] = this.toScreen(spawn.x + 0.5, spawn.z + 0.5);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#ede9e0';
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0c0d10';
      ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    _drawTrails(light) {
      const { ctx } = this;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2;
      for (const [name, trail] of this.trails) {
        const pts = trail.filter(p => p.dim === this.dim);
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = this.toScreen(pts[i - 1].x, pts[i - 1].z), [bx, by] = this.toScreen(pts[i].x, pts[i].z);
          ctx.strokeStyle = `rgba(255,252,246,${(i / pts.length) * 0.75})`;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        }
      }
    }

    _drawFace(img, sx, sy, size, alpha, yaw, label, light, lit) {
      const { ctx } = this, half = size / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(sx), Math.round(sy));
      if (yaw !== null && yaw !== undefined) {
        // Minecraft yaw: 0 looks south (down the screen), 90 west.
        ctx.save();
        ctx.rotate(yaw * Math.PI / 180);
        ctx.fillStyle = '#fffcf6';
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.moveTo(0, half + 9); ctx.lineTo(-5.5, half + 1); ctx.lineTo(5.5, half + 1); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.shadowColor = lit ? 'rgba(255,248,236,0.55)' : 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = lit ? 16 : 8;
      ctx.fillStyle = '#fffcf6';
      ctx.beginPath(); ctx.roundRect(-half - 2, -half - 2, size + 4, size + 4, 5); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.imageSmoothingEnabled = false;
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        ctx.beginPath(); ctx.roundRect(-half, -half, size, size, 3); ctx.clip();
        ctx.drawImage(img, -half, -half, size, size);
        ctx.restore();
      } else { ctx.fillStyle = '#777'; ctx.fillRect(-half, -half, size, size); }
      if (label) {
        ctx.font = '600 11px Inter, sans-serif';
        const tw = ctx.measureText(label).width, top = half + (yaw !== null && yaw !== undefined ? 13 : 7);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';   // a name tag, as over a player's head
        ctx.fillRect(Math.round(-tw / 2) - 5, top, Math.round(tw) + 10, 18);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, top + 9.5);
      }
      ctx.restore();
    }

    // ── pointer ──

    _nearest(sx, sy) {
      let best = null, bestD = 18;
      if (this.show.players) for (const entry of this.people.values()) {
        if (entry.player.dim !== this.dim || !entry.screen) continue;
        const d = Math.hypot(entry.screen[0] - sx, entry.screen[1] - sy);
        if (d < bestD) { bestD = d; best = entry; }
      }
      if (!best && this.show.away) for (const p of this.away) {
        if (p.dim !== this.dim) continue;
        const [px, py] = this.toScreen(p.x, p.z);
        const d = Math.hypot(px - sx, py - sy);
        if (d < Math.min(bestD, 13)) { bestD = d; best = p; }
      }
      return best;
    }

    _bind() {
      const host = this.host, pointers = new Map();
      let drag = null, pinch = null, moved = false;
      host.tabIndex = 0;
      const local = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

      host.addEventListener('pointerdown', e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        host.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, local(e));
        moved = false;
        if (pointers.size === 1) drag = { at: local(e), cx: this.cx, cz: this.cz };
        else if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: this.zoom }; drag = null;
        }
      });
      host.addEventListener('pointermove', e => {
        const at = local(e);
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, at);
        if (pinch && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          this.zoomBy(pinch.zoom * d / pinch.d / this.zoom, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          return;
        }
        if (drag) {
          const dx = at[0] - drag.at[0], dy = at[1] - drag.at[1];
          if (!moved && Math.hypot(dx, dy) < 4) return;
          moved = true; this.follow = null;
          host.classList.add('dragging');
          this.cx = drag.cx - dx / this.zoom; this.cz = drag.cz - dy / this.zoom;
          this.onMove?.();
          this.redraw();
          return;
        }
        const near = this._nearest(at[0], at[1]);
        if (near !== this.hovered) { this.hovered = near; host.style.cursor = near ? 'pointer' : ''; this.redraw(); }
        const [wx, wz] = this.toWorld(at[0], at[1]);
        this.onHover?.({ x: Math.floor(wx), z: Math.floor(wz), near });
      });
      const up = e => {
        pointers.delete(e.pointerId);
        host.classList.remove('dragging');
        if (pointers.size < 2) pinch = null;
        if (drag && !moved && e.type === 'pointerup') {
          const at = local(e), near = this._nearest(at[0], at[1]);
          if (near) this.onPick?.(near.player || near);
        }
        if (!pointers.size) drag = null;
      };
      host.addEventListener('pointerup', up);
      host.addEventListener('pointercancel', up);
      host.addEventListener('pointerleave', () => { if (this.hovered) { this.hovered = null; this.redraw(); } this.onHover?.(null); });
      host.addEventListener('wheel', e => {
        e.preventDefault();
        const at = local(e);
        this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0016)), at[0], at[1]);
      }, { passive: false });
      host.addEventListener('dblclick', e => { const at = local(e); this.zoomBy(2, at[0], at[1]); });
      host.addEventListener('keydown', e => {
        const step = 80 / this.zoom;
        if (e.key === '+' || e.key === '=') this.zoomBy(1.4);
        else if (e.key === '-') this.zoomBy(1 / 1.4);
        else if (e.key === 'ArrowLeft') this.goTo(this.cx - step, this.cz);
        else if (e.key === 'ArrowRight') this.goTo(this.cx + step, this.cz);
        else if (e.key === 'ArrowUp') this.goTo(this.cx, this.cz - step);
        else if (e.key === 'ArrowDown') this.goTo(this.cx, this.cz + step);
        else return;
        this.follow = null;
        e.preventDefault();
      });
    }
  }

  // One copy of the map's index for everything that draws it, refreshed while
  // any map is on screen. When the server saves, region times move and the
  // maps fetch those tiles again.
  const MapData = {
    index: null, away: [], maps: new Set(), _timer: null, _awayAt: 0,
    attach(map) {
      this.maps.add(map);
      if (this.index) map.setIndex(this.index);
      map.setPlayers(Live.players);
      map.setAway(this.away);
      if (!this._timer) { this.refresh(); this._timer = setInterval(() => this.refresh(), 12000); }
    },
    async refresh() {
      if (document.hidden || ![...this.maps].some(m => m.host.offsetParent !== null)) return;
      try {
        this.index = await api('/api/mc/map/index');
        for (const map of this.maps) map.setIndex(this.index);
        if (Date.now() - this._awayAt > 60000) {
          this._awayAt = Date.now();
          this.away = await api('/api/mc/map/away');
          for (const map of this.maps) map.setAway(this.away);
        }
      } catch (e) { /* the next tick tries again */ }
      window.dispatchEvent(new Event('klab:mcmapindex'));
    },
  };
  Live.on('players', players => { for (const map of MapData.maps) map.setPlayers(players); });

  // ══ Overview ══
  const PHASE_TEXT = {
    online: 'Online', starting: 'Starting', stopping: 'Stopping', offline: 'Offline',
    missing: 'No container', error: "Can't reach Docker", unknown: 'Connecting',
  };
  const PHASE_DOT = { online: 'online', starting: 'busy', stopping: 'busy', error: 'error', missing: 'error' };

  const Overview = {
    built: false, sparks: {}, miniMap: null,

    build() {
      const root = $('#viewOverview');
      root.innerHTML = `
        <div class="view-head">
          <div class="title-wrap">
            <div class="kicker" id="ovHello"></div>
            <div class="title-line">
              <h2 class="mc-title"><span class="title-name"><span id="ovName">Minecraft</span><span class="splash" id="ovSplash" title="Another!"></span></span></h2>
              <span class="sub" id="ovSub"></span>
            </div>
          </div>
          <span class="grow"></span>
        </div>
        <div class="panel hero">
          <div class="hero-icon" id="ovIcon"></div>
          <div class="hero-main">
            <div class="hero-line">
              <span class="status-pill" id="ovPill"><span class="dot"></span><span>Connecting</span></span>
              <span id="ovChips" class="hero-line"></span>
            </div>
            <div class="motd" id="ovMotd"></div>
            <div class="hero-meta" id="ovMeta"></div>
          </div>
          <div class="hero-side">
            <div id="ovClock"></div>
            <div class="hero-meta" id="ovJob"></div>
          </div>
        </div>
        <div class="tiles">
          <div class="tile" id="tilePlayers"><div class="label">Players</div><div class="tile-value num" id="tvPlayers">0</div><div class="tile-sub" id="tsPlayers"></div><div class="tile-faces" id="tfPlayers"></div></div>
          <div class="tile"><div class="label">Tick rate</div><div class="tile-value" id="tvTps">–</div><div class="tile-sub" id="tsTps"></div><div class="spark" id="spTps"></div></div>
          <div class="tile"><div class="label">Processor</div><div class="tile-value" id="tvCpu">–</div><div class="tile-sub" id="tsCpu"></div><div class="spark" id="spCpu"></div></div>
          <div class="tile"><div class="label">Memory</div><div class="tile-value" id="tvMem">–</div><div class="tile-sub" id="tsMem"></div><div class="spark" id="spMem"></div></div>
        </div>
        <div class="over-grid">
          <div class="panel">
            <div class="panel-head"><span class="label">Online now</span><button class="btn btn-sm" data-go="players">All players</button></div>
            <div class="panel-body"><div class="rows" id="ovPlayers"></div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><span class="label">Live map<span id="ovMapNote"></span></span><button class="btn btn-sm" data-go="map"><i class="ti ti-arrows-maximize"></i>Open</button></div>
            <div class="mini-map" id="ovMap" data-go="map"></div>
          </div>
          <div class="panel">
            <div class="panel-head"><span class="label">Activity</span></div>
            <div class="panel-body" id="ovFeed"></div>
          </div>
        </div>`;

      this.sparks.tps = new Spark($('#spTps'), { value: p => p.tps, max: () => 20, format: v => `${v.toFixed(1)} TPS`, label: 'Tick rate' });
      this.sparks.cpu = new Spark($('#spCpu'), {
        value: p => p.cpu / (p.cores || 1), max: pts => Math.max(25, ...pts.map(p => p.v)) * 1.1,
        format: v => `${v.toFixed(0)}%`, label: 'Processor',
      });
      this.sparks.mem = new Spark($('#spMem'), {
        value: p => p.mem, max: pts => Math.max(...pts.map(p => p.v)) * 1.25,
        format: v => fmtBytes(v), label: 'Memory',
      });

      root.addEventListener('click', e => {
        const go = e.target.closest('[data-go]');
        if (go) { Shell.go(go.dataset.go); return; }
        const row = e.target.closest('[data-player]');
        if (row) Players.openProfile(Live.player(row.dataset.player) || { name: row.dataset.player });
      });
      this.miniMap = new WorldMap($('#ovMap'), { interactive: false });
      Splash.mount($('#ovSplash'));
      this.built = true;
    },

    show() {
      if (!this.built) this.build();
      MapData.attach(this.miniMap);
      this.renderStatus(); this.renderPlayers(); this.renderFeed(); this.renderStats();
    },

    renderStatus() {
      if (!this.built || !Live.status) return;
      const s = Live.status, srv = s.server, phase = s.phase;
      $('#ovName').textContent = srv.name;
      $('#ovHello').textContent = greeting(Live.me?.name);
      $('#ovSub').textContent = [srv.type, srv.version].filter(Boolean).join(' ');
      const pill = $('#ovPill');
      pill.className = `status-pill ${phase === 'online' ? 'online' : ''}`;
      pill.innerHTML = `<span class="dot ${PHASE_DOT[phase] || ''}"></span><span>${PHASE_TEXT[phase] || phase}</span>`;

      const chips = [];
      if (srv.gamemode) chips.push(`<span class="chip">${esc(titleCase(srv.gamemode))}</span>`);
      if (srv.difficulty) chips.push(`<span class="chip">${esc(titleCase(srv.difficulty))}</span>`);
      if (srv.whitelist) chips.push('<span class="chip"><i class="ti ti-shield-check"></i>Whitelist</span>');
      if (s.container.health === 'unhealthy') {
        chips.push(s.container.healthNote
          ? '<button class="chip warn" id="ovHealth" title="What does this mean?"><i class="ti ti-info-circle"></i>Health check failing</button>'
          : '<span class="chip bad">Unhealthy</span>');
      }
      if (s.container.oomKilled) chips.push('<span class="chip bad">Ran out of memory</span>');
      if (s.demo) chips.push('<span class="chip warn">Demo</span>');
      $('#ovChips').innerHTML = chips.join('');

      const health = $('#ovHealth');
      if (health) health.onclick = () => {
        openModal('Health check', `<div class="modal-msg selectable">${esc(s.container.healthNote)}</div><div class="modal-actions"><button class="btn btn-primary" id="dlgOk">OK</button></div>`);
        $('#dlgOk').onclick = () => closeModal();
      };
      $('#ovMotd').innerHTML = motdHtml(srv.motd || 'A Minecraft Server');
      const icon = $('#ovIcon');
      // No icon of its own? A block of grass, then.
      icon.innerHTML = `<img src="${srv.icon ? `/api/mc/server/icon?v=${srv.icon}` : GRASS_ICON}" alt="" />`;

      const address = srv.address || '';
      const meta = [];
      if (address) meta.push(`<span class="copy" data-copy="${esc(address)}" title="Copy the address">Address <b class="selectable">${esc(address)}</b><i class="ti ti-copy"></i></span>`);
      if (s.container.name) meta.push(`<span>Container <b>${esc(s.container.name)}</b></span>`);
      if (s.world.size) meta.push(`<span>World <b>${fmtBytes(s.world.size)}</b></span>`);
      if (srv.latency != null && phase === 'online') meta.push(`<span>Ping <b>${srv.latency} ms</b></span>`);
      if (s.container.restartCount) meta.push(`<span>Restarts <b>${s.container.restartCount}</b></span>`);
      meta.push('<span id="ovUptime"></span>');
      $('#ovMeta').innerHTML = meta.join('');
      $('#ovMeta').onclick = e => { const c = e.target.closest('[data-copy]'); if (c) copyText(c.dataset.copy, 'Address copied'); };
      this.tickUptime();


      this.renderClock();
      const job = s.job;
      $('#ovJob').innerHTML = job ? `<span><i class="ti ti-loader-2 spin"></i> <b>${esc(job.label)}</b>${job.progress != null ? ` ${Math.round(job.progress * 100)}%` : ''}</span>` : '';
      this.renderPlayers();
    },

    tickUptime() {
      const el = $('#ovUptime'), s = Live.status;
      if (!el || !s) return;
      const box = s.container;
      if (box.state === 'running' && box.startedAt) el.innerHTML = `Up <b>${fmtDuration(Date.now() - box.startedAt)}</b>`;
      else if (box.finishedAt) el.innerHTML = `Stopped <b>${fmtAgo(box.finishedAt)}</b>`;
      else el.innerHTML = '';
    },

    // The in-game clock. A Minecraft day starts at 06:00 (tick 0).
    renderClock() {
      const clock = Live.status?.clock || {}, host = $('#ovClock');
      if (!host) return;
      if (clock.daytime == null || Live.phase !== 'online') { host.innerHTML = ''; return; }
      const minutes = Math.floor(((clock.daytime + 6000) % 24000) / 1000 * 60);
      const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0'), mm = String(minutes % 60).padStart(2, '0');
      const night = clock.daytime >= 13000 && clock.daytime < 23000;
      host.innerHTML = `
        <div class="clock" title="Time in the world">
          <i class="ti ${night ? 'ti-moon' : 'ti-sun'} clock-sky"></i>
          <span class="lcd"><span class="lcd-ghost">88:88</span><span class="lcd-now">${hh}:${mm}</span></span>
        </div>
        ${clock.day != null ? `<div class="clock-day">Day ${fmtNum(clock.day)}</div>` : ''}`;
    },

    renderPlayers() {
      if (!this.built || !Live.status) return;
      const players = Live.players, srv = Live.status.server, online = Live.online;
      $('#tvPlayers').innerHTML = `${online ? srv.online : 0}<small>of ${srv.max}</small>`;
      $('#tsPlayers').textContent = !online ? 'Server is off' : players.length ? '' : 'Just the chickens';
      $('#tfPlayers').innerHTML = players.slice(0, 14).map(p => faceImg(p, 30)).join('') + (players.length > 14 ? `<span class="more">+${players.length - 14}</span>` : '');
      const list = $('#ovPlayers');
      if (!players.length) {
        list.innerHTML = `<div class="empty"><div class="mc" style="color:var(--text-dimmer)">${online ? EMPTY_FACES.nobody : EMPTY_FACES.off}</div><div>${online ? 'Nobody on right now' : 'The server is asleep'}</div><div class="empty-sub">${online ? 'The world is ticking along without anyone in it.' : "They'll be back when it's on."}</div></div>`;
        return;
      }
      list.innerHTML = players.map(p => `
        <div class="row click" data-player="${esc(p.name)}">
          ${faceImg(p, 36)}
          <div class="row-info">
            <div class="row-title">${esc(p.name)}</div>
            <div class="row-sub num">${p.x != null ? `${esc(dimLabel(p.dim))} · ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}` : `On for ${fmtDuration(Date.now() - p.since)}`}</div>
          </div>
          ${p.health != null ? `<div class="vitals">${pips('hp', p.health)}${pips('food', p.food)}</div>` : ''}
        </div>`).join('');
    },

    feedItem(e) {
      const who = e.player ? { name: e.player, uuid: Live.player(e.player)?.uuid } : null;
      const face = who && !e.server && e.kind !== 'admin' ? faceImg(who, 28) : null;
      const name = `<b>${esc(e.player)}</b>`;
      let pic = face, text = '';
      switch (e.kind) {
        case 'chat': text = `${name} <q>${esc(e.message)}</q>`; if (e.server) pic = '<span class="feed-ico"><i class="ti ti-speakerphone"></i></span>'; break;
        case 'join': text = `${name} joined`; break;
        case 'leave': text = `${name} left`; break;
        case 'death': text = `${name} ${esc(e.message)}`; pic = '<span class="feed-ico death"><i class="ti ti-skull"></i></span>'; break;
        case 'advancement': text = `${name} earned <b>${esc(e.message)}</b>`; pic = '<span class="feed-ico adv"><i class="ti ti-trophy"></i></span>'; break;
        case 'lag': text = `The server fell <b>${esc(e.message)}</b>`; pic = '<span class="feed-ico lag"><i class="ti ti-alert-triangle"></i></span>'; break;
        case 'ready': text = `Server started in <b>${esc(e.message)}s</b>`; pic = '<span class="feed-ico"><i class="ti ti-circle-check"></i></span>'; break;
        case 'admin': text = `${name} ${esc(e.message)}${e.detail ? ` <span class="selectable">(${esc(e.detail)})</span>` : ''}`; pic = '<span class="feed-ico"><i class="ti ti-user-shield"></i></span>'; break;
        default: return '';
      }
      return `<div class="feed-item">${pic || '<span class="feed-ico"><i class="ti ti-point"></i></span>'}<div class="feed-text">${text}</div><span class="feed-time" title="${esc(new Date(e.t).toLocaleString())}">${fmtClock(e.t)}</span></div>`;
    },

    renderFeed() {
      if (!this.built) return;
      const host = $('#ovFeed');
      const items = Live.events.slice(-80).reverse().map(e => this.feedItem(e)).join('');
      host.innerHTML = items || `<div class="empty"><div class="mc" style="color:var(--text-dimmer)">${EMPTY_FACES.quiet}</div><div>Quiet so far</div><div class="empty-sub">Joins, chat, deaths and advancements show up here as they happen.</div></div>`;
    },

    renderStats() {
      if (!this.built) return;
      const history = Live.history, last = history[history.length - 1], on = Live.status?.container?.state === 'running';
      for (const spark of Object.values(this.sparks)) spark.update(on ? history : []);
      const perf = Live.status?.perf || {};
      if (Live.online && perf.tps != null) {
        $('#tvTps').innerHTML = `${perf.tps.toFixed(1)}<small>TPS</small>`;
        const slow = perf.mspt > 50, tight = perf.mspt > 40;
        $('#tsTps').innerHTML = `<span class="${slow ? 'bad' : tight ? 'warn' : ''}">${slow ? '<i class="ti ti-alert-triangle"></i> ' : ''}${perf.mspt.toFixed(1)} ms per tick</span>`;
      } else {
        $('#tvTps').textContent = '–';
        $('#tsTps').textContent = Live.online ? 'Needs RCON to measure' : '';
      }
      if (on && last) {
        const share = last.cpu / (last.cores || 1);
        $('#tvCpu').innerHTML = `${share.toFixed(0)}<small>%</small>`;
        $('#tsCpu').textContent = `${(last.cpu / 100).toFixed(1)} of ${last.cores} cores`;
        const gb = last.mem / 1024 ** 3;
        $('#tvMem').innerHTML = `${gb.toFixed(1)}<small>GB</small>`;
        const heap = Live.status.server.heap;
        $('#tsMem').textContent = heap ? `Java heap up to ${heap}` : `of ${fmtBytes(last.memLimit, 0)}`;
      } else {
        $('#tvCpu').textContent = '–'; $('#tsCpu').textContent = '';
        $('#tvMem').textContent = '–'; $('#tsMem').textContent = '';
      }
    },
  };

  Live.on('status', () => { Overview.renderStatus(); Overview.renderStats(); });
  Live.on('players', () => Overview.renderPlayers());
  Live.on('reset', () => { Overview.renderFeed(); Overview.renderStats(); });
  Live.on('event', e => {
    if (!Overview.built) return;
    const host = $('#ovFeed');
    if ($('.empty', host)) host.innerHTML = '';
    host.insertAdjacentHTML('afterbegin', Overview.feedItem(e));
    while (host.children.length > 80) host.lastElementChild.remove();
  });
  Live.on('stats', () => { if (Shell.view === 'overview' && !document.hidden) Overview.renderStats(); });
  setInterval(() => { if (Games.on) Overview.tickUptime(); }, 15000);

  // ══ Players ══
  const Players = {
    built: false, tab: 'online', data: null, query: '',

    build() {
      $('#viewPlayers').innerHTML = `
        <div class="view-head">
          <h2>Players</h2><span class="sub" id="plSub"></span>
          <span class="grow"></span>
          <div class="head-actions">
            <div class="seg" id="plTabs" role="group">
              <button data-v="online" aria-pressed="true"><i class="ti ti-broadcast"></i>Online</button>
              <button data-v="everyone"><i class="ti ti-users"></i>Everyone</button>
            </div>
          </div>
        </div>
        <div id="plBody"></div>`;
      $('#plTabs').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        this.tab = b.dataset.v;
        $$('#plTabs button').forEach(x => x.setAttribute('aria-pressed', x === b));
        this.render();
      };
      $('#plBody').addEventListener('click', e => this.click(e));
      $('#plBody').addEventListener('input', e => {
        if (e.target.id === 'plSearch') { this.query = e.target.value.trim().toLowerCase(); this.renderEveryone(true); }
      });
      this.built = true;
    },

    show() {
      if (!this.built) this.build();
      this.render();
      this.load();
    },

    async load() {
      try { this.data = await api('/api/mc/players'); if (Shell.view === 'players') this.render(); }
      catch (err) { toastError(err); }
    },

    render() {
      if (!this.built) return;
      const n = Live.players.length;
      $('#plSub').textContent = Live.online ? `${n} online` : 'Server is off';
      $navCount().textContent = n || '';
      if (this.tab === 'online') this.renderOnline();
      else this.renderEveryone();
    },

    renderOnline() {
      const players = Live.players, body = $('#plBody');
      if (!players.length) {
        body.innerHTML = `<div class="panel"><div class="empty"><div class="mc" style="color:var(--text-dimmer)">${Live.online ? EMPTY_FACES.nobody : EMPTY_FACES.off}</div><div>${Live.online ? 'Nobody on right now' : 'The server is asleep'}</div><div class="empty-sub">${Live.online ? 'When someone joins they appear here, with where they are and how they are doing.' : "It's off for now."}</div></div></div>`;
        return;
      }

      body.innerHTML = `<div class="cards">${players.map(p => `
        <div class="panel pcard" data-player="${esc(p.name)}">
          <div class="pcard-top">
            <span class="face-wrap">${faceImg(p, 56)}<span class="dot online"></span></span>
            <div class="row-info">
              <div class="pcard-name">${esc(p.name)}${this.isOp(p.name) ? '<span class="chip"><i class="ti ti-crown"></i>Op</span>' : ''}${p.gamemode ? `<span class="chip">${GAMEMODES[p.gamemode]}</span>` : ''}</div>
              <div class="pcard-where">${p.x != null ? `${esc(dimLabel(p.dim))} · ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}` : `On for ${fmtDuration(Date.now() - p.since)}`}</div>
            </div>
          </div>
          ${p.health != null ? `<div class="pcard-vitals">
            <div class="vitals">${pips('hp lg', p.health)}${pips('food lg', p.food)}</div>
            <div class="xp" title="Level ${p.level ?? 0}, ${GAMEMODES[p.gamemode ?? 0]}"><span class="xp-num">${p.level ?? 0}</span><span class="label">Level</span></div>
          </div>` : ''}
          ${p.x != null ? '<div class="pcard-actions"><button class="btn btn-sm" data-act="map"><i class="ti ti-map-pin"></i>On map</button></div>' : ''}
        </div>`).join('')}</div>`;
    },

    isOp(name) { return !!this.data?.ops?.some(o => o.name === name); },
    isBanned(name) { return !!this.data?.banned?.some(o => o.name === name); },

    renderEveryone(keepFocus) {
      const body = $('#plBody');
      if (!this.data) { body.innerHTML = '<div class="muted"><i class="ti ti-loader-2 spin"></i> Loading</div>'; return; }
      const online = new Set(Live.players.map(p => p.name));
      const known = this.data.known.filter(p => !this.query || (p.name || p.uuid).toLowerCase().includes(this.query));
      const rows = known.map(p => {
        const on = online.has(p.name), name = p.name || p.uuid.slice(0, 8);
        return `<div class="row click" data-player="${esc(p.name)}" data-uuid="${esc(p.uuid)}">
          <span class="face-wrap">${faceImg(p, 40)}${on ? '<span class="dot online"></span>' : ''}</span>
          <div class="row-info">
            <div class="row-title">${esc(name)}${this.isOp(p.name) ? '<span class="chip"><i class="ti ti-crown"></i>Op</span>' : ''}${this.isBanned(p.name) ? '<span class="chip bad">Banned</span>' : ''}</div>
            <div class="row-sub">${on ? 'Online now' : p.lastSeen ? `Last on ${fmtAgo(p.lastSeen)}` : 'Never joined'}</div>
          </div>
          <span class="row-meta">${p.playTime ? `${fmtDuration(p.playTime * 50)} played` : ''}</span>
        </div>`;
      }).join('');
      const list = rows || `<div class="empty"><i class="ti ti-user-search"></i><div>${this.query ? 'Nobody by that name' : 'Nobody has joined yet'}</div></div>`;
      if (keepFocus && $('#plList')) { $('#plList').innerHTML = list; return; }
      body.innerHTML = `
        <div class="toolbar"><label class="search"><i class="ti ti-search"></i><input id="plSearch" placeholder="Find a player" autocomplete="off" spellcheck="false" value="${esc(this.query)}" /></label><span class="grow"></span><span class="row-meta">${plural(this.data.known.length, 'player')} ever</span></div>
        <div class="panel"><div class="panel-body" style="padding-top:6px"><div class="rows" id="plList">${list}</div></div></div>`;
    },

    click(e) {
      const act = e.target.closest('[data-act]'), holder = e.target.closest('[data-player]');
      const name = holder?.dataset.player;
      if (act) {
        e.stopPropagation();
        const kind = act.dataset.act;
        if (kind === 'map') Shell.go('map', { follow: name });
        return;
      }
      if (e.target.closest('form, input')) return;
      if (holder) this.openProfile(Live.player(name) || { name, uuid: holder.dataset.uuid });
    },

    // ── profile drawer ──

    async openProfile(player) {
      const drawer = $('#drawer');
      const known = this.data?.known.find(k => k.name === player.name);
      const uuid = player.uuid || known?.uuid || '';
      const live = Live.player(player.name);
      drawer.innerHTML = `
        <div class="profile-head">
          <div class="row-info"><h3>${esc(player.name || uuid.slice(0, 8))}</h3><div class="sub">${live ? 'Online now' : known?.lastSeen ? `Last on ${fmtAgo(known.lastSeen)}` : ''}</div></div>
          <button class="icon-btn" id="pfClose" title="Close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="skin-stage" id="pfSkin" title="Drag to turn"></div>
        <div id="pfBody"><div class="muted"><i class="ti ti-loader-2 spin"></i> Loading</div></div>`;
      drawer.classList.add('open'); $('#drawerBackdrop').classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      $('#pfClose').onclick = () => closeDrawer();
      loadSkin($('#pfSkin'), { name: player.name, uuid });
      if (!uuid) { $('#pfBody').innerHTML = '<div class="muted">No saved data for this player yet.</div>'; return; }
      try {
        const profile = await api(`/api/mc/players/${encodeURIComponent(uuid)}`);
        if (drawer.classList.contains('open')) $('#pfBody').innerHTML = this.profileHtml(profile, live, uuid);
        const go = $('#pfMap');
        if (go) go.onclick = () => { closeDrawer(); Shell.go('map', live ? { follow: player.name } : { at: profile.data }); };
        $('#pfUuid')?.addEventListener('click', () => copyText(uuid, 'UUID copied'));
      } catch (err) { $('#pfBody').innerHTML = `<div class="muted">${esc(err.message)}</div>`; }
    },

    profileHtml(profile, live, uuid) {
      const s = profile.stats, where = live?.x != null ? live : profile.data, adv = profile.advancements;
      const bars = (items, unit) => {
        const top = Math.max(1, ...items.map(i => i.n));
        return items.map(i => `<div class="hbar" title="${esc(titleCase(i.id))}: ${fmtNum(i.n)}${unit}"><span>${esc(titleCase(i.id))}</span><div class="track"><i style="width:${Math.max(2, i.n / top * 100)}%"></i></div><b>${fmtNum(i.n)}</b></div>`).join('');
      };
      let html = '';
      if (s) {
        html += `<div class="stat-grid">
          <div class="stat-box"><div class="label">Time played</div><div class="stat-val">${fmtDuration(s.playTime * 50)}</div></div>
          <div class="stat-box"><div class="label">Travelled</div><div class="stat-val">${fmtDistance(s.distanceTotal)}</div></div>
          <div class="stat-box"><div class="label">Deaths</div><div class="stat-val">${fmtNum(s.deaths)}</div></div>
          <div class="stat-box"><div class="label">Mobs killed</div><div class="stat-val">${fmtNum(s.mobKills)}</div></div>
        </div>`;
      }
      if (where) {
        html += `<div><div class="label" style="margin-bottom:8px">${live ? 'Right now' : 'Last seen at'}</div>
          <div class="kv"><span>Place</span><b>${esc(dimLabel(where.dim))} · ${Math.round(where.x)}, ${Math.round(where.y)}, ${Math.round(where.z)}</b></div>
          ${where.health != null ? `<div class="kv"><span>Health and food</span><b>${where.health / 2} / 10 · ${(where.food ?? 20) / 2} / 10</b></div>` : ''}
          ${where.level != null ? `<div class="kv"><span>Level</span><b>${where.level} · ${GAMEMODES[where.gamemode ?? 0]}</b></div>` : ''}
          <div style="margin-top:10px"><button class="btn btn-sm" id="pfMap"><i class="ti ti-map-pin"></i>Show on map</button></div></div>`;
      }
      if (s?.mined.length) html += `<div><div class="label" style="margin-bottom:6px">Most mined<span>${fmtNum(s.minedTotal)} blocks in all</span></div>${bars(s.mined, ' mined')}</div>`;
      if (s?.killed.length) html += `<div><div class="label" style="margin-bottom:6px">Most killed</div>${bars(s.killed, ' killed')}</div>`;
      if (s) {
        const far = Object.entries(s.distance).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const how = { walk: 'On foot', sprint: 'Sprinting', fly: 'Flying', aviate: 'By elytra', boat: 'By boat', swim: 'Swimming', horse: 'On horseback', minecart: 'By minecart', climb: 'Climbing', fall: 'Falling', crouch: 'Sneaking' };
        html += `<div><div class="label" style="margin-bottom:8px">More</div>
          ${far.map(([k, v]) => `<div class="kv"><span>${how[k] || titleCase(k)}</span><b>${fmtDistance(v)}</b></div>`).join('')}
          <div class="kv"><span>Jumps</span><b>${fmtNum(s.jumps)}</b></div>
          <div class="kv"><span>Players killed</span><b>${fmtNum(s.playerKills)}</b></div>
          ${s.killedBy.length ? `<div class="kv"><span>Killed most by</span><b>${esc(titleCase(s.killedBy[0].id))} (${s.killedBy[0].n})</b></div>` : ''}
          <div class="kv"><span>Nights slept</span><b>${fmtNum(s.sleeps)}</b></div></div>`;
      }
      if (adv?.count) html += `<div><div class="label" style="margin-bottom:8px">Advancements<span>${adv.count} earned</span></div>${adv.recent.map(a => `<div class="kv"><span>${esc(titleCase(a.id.split('/').pop()))}</span><b>${esc((a.at || '').slice(0, 10))}</b></div>`).join('')}</div>`;
      html += `<div class="kv" style="border:none"><span>UUID</span><button class="link selectable" id="pfUuid" style="font:500 11px var(--font-mono)">${esc(uuid)}</button></div>`;
      return html || '<div class="muted">No saved data for this player yet.</div>';
    },
  };

  function closeDrawer() {
    $('#drawer').classList.remove('open'); $('#drawerBackdrop').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }
  document.addEventListener('DOMContentLoaded', () => { $('#drawerBackdrop').onclick = () => closeDrawer(); });

  Live.on('players', () => {
    $navCount().textContent = Live.players.length || '';
    if (Shell.view === 'players') {
      if (!Players.built) return;
      $('#plSub').textContent = Live.online ? `${Live.players.length} online` : 'Server is off';
      if (Players.tab === 'online') Players.renderOnline(); else Players.renderEveryone(true);
    }
  });
  Live.on('status', () => { if (Shell.view === 'players') Players.render(); });

  // ══ Map ══
  const MapView = {
    built: false, map: null, peopleOpen: true,

    build() {
      try { this.peopleOpen = localStorage.getItem('klabcraft_map_people') !== '0'; } catch (e) {}
      $('#viewMap').innerHTML = `
        <div class="view-head">
          <h2>Map</h2><span class="sub" id="mapSub"></span>
          <span class="grow"></span>
          <div class="head-actions">
            <a class="btn" id="mapExternal" target="_blank" rel="noopener" hidden><i class="ti ti-external-link"></i><span></span></a>
          </div>
        </div>
        <div class="panel map-panel">
          <div id="mapCanvas"></div>
          <div class="map-msg" id="mapMsg" hidden></div>
          <div class="map-float tl"><div class="seg" id="mapDims" role="group" aria-label="Dimension"></div></div>
          <div class="map-float tr">
            <div class="seg" id="mapLayers" role="group" aria-label="Show">
              <button data-layer="players" aria-pressed="true" title="Players who are on"><i class="ti ti-users"></i>Players</button>
              <button data-layer="trails" aria-pressed="true" title="Where they have just been"><i class="ti ti-route"></i>Trails</button>
              <button data-layer="away" aria-pressed="false" title="Where everyone else was last standing"><i class="ti ti-ghost-2"></i>Away</button>
            </div>
            <button class="icon-btn glass-box" id="mapPeopleBtn" title="Player list" aria-label="Player list"><i class="ti ti-layout-sidebar-right"></i></button>
          </div>
          <div class="map-float tr glass-box map-people" id="mapPeople"></div>
          <div class="map-float bl glass-box map-coords" id="mapCoords"></div>
          <div class="map-float br">
            <div class="glass-box map-zoom">
              <button class="icon-btn" id="mapIn" title="Zoom in" aria-label="Zoom in"><i class="ti ti-plus"></i></button>
              <button class="icon-btn" id="mapOut" title="Zoom out" aria-label="Zoom out"><i class="ti ti-minus"></i></button>
              <button class="icon-btn" id="mapHome" title="Back to spawn" aria-label="Back to spawn"><i class="ti ti-home"></i></button>
              <button class="icon-btn" id="mapGoto" title="Go to coordinates" aria-label="Go to coordinates"><i class="ti ti-current-location"></i></button>
            </div>
          </div>
        </div>`;
      this.map = new WorldMap($('#mapCanvas'), {
        onHover: at => this.hover(at),
        onPick: p => Players.openProfile(p),
        onMove: () => this.coords(),
      });
      $('#mapIn').onclick = () => this.map.zoomBy(1.6);
      $('#mapOut').onclick = () => this.map.zoomBy(1 / 1.6);
      $('#mapHome').onclick = () => { this.map.follow = null; this.map.home(); this.map.redraw(); this.people(); };
      $('#mapGoto').onclick = () => this.goto();
      $('#mapDims').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        this.map.follow = null;
        this.map.setDim(b.dataset.dim); this.sync();
      };
      $('#mapLayers').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', on);
        this.map.show[b.dataset.layer] = on;
        this.map.redraw(); this.people();
      };
      $('#mapPeopleBtn').onclick = () => {
        this.peopleOpen = !this.peopleOpen;
        try { localStorage.setItem('klabcraft_map_people', this.peopleOpen ? '1' : '0'); } catch (e) {}
        this.people();
      };
      $('#mapPeople').onclick = e => {
        const row = e.target.closest('[data-follow]'); if (!row) return;
        const name = row.dataset.follow, p = Live.player(name);
        if (!p) {
          const away = MapData.away.find(a => a.name === name);
          if (away) { this.map.follow = null; if (away.dim !== this.map.dim) this.map.setDim(away.dim); this.map.goTo(away.x, away.z, Math.max(this.map.zoom, 2)); this.sync(); }
          return;
        }
        this.follow(this.map.follow === name ? null : name);
      };
      window.addEventListener('klab:mcmapindex', () => { if (Shell.view === 'map') this.sync(); });
      this.built = true;
    },

    show(opts = {}) {
      if (!this.built) this.build();
      MapData.attach(this.map);
      this.map.resize();
      if (opts.follow) this.follow(opts.follow);
      else if (opts.at) {
        if (opts.at.dim && opts.at.dim !== this.map.dim) this.map.setDim(opts.at.dim);
        this.map.show.away = true; $('[data-layer="away"]').setAttribute('aria-pressed', 'true');
        this.map.goTo(opts.at.x, opts.at.z, Math.max(this.map.zoom, 2));
      }
      this.sync();
      MapData.refresh();
    },

    follow(name) {
      const p = name && Live.player(name);
      this.map.follow = p ? name : null;
      if (p) {
        if (p.dim && p.dim !== this.map.dim) this.map.setDim(p.dim);
        this.map.follow = name;
        this.map.goTo(p.x, p.z, Math.max(this.map.zoom, 2));
      }
      this.sync();
    },

    sync() {
      if (!this.built) return;
      const index = MapData.index, msg = $('#mapMsg');
      const ext = Live.me?.externalMap, link = $('#mapExternal');
      link.hidden = !ext;
      if (ext) { link.href = ext.url; $('span', link).textContent = ext.name; }
      if (index && !index.dims.length) {
        msg.hidden = false;
        msg.innerHTML = `<div class="empty"><i class="ti ti-map-off"></i><div>No world to draw yet</div><div class="empty-sub">${Live.status?.can.files ? 'The map appears once the server has generated and saved some of the world.' : "The map isn't set up on this server yet."}</div></div>`;
      } else msg.hidden = true;
      const dims = index?.dims || [];
      $('#mapDims').innerHTML = dims.map(d => `<button data-dim="${esc(d.id)}" aria-pressed="${d.id === this.map.dim}">${esc(d.label)}</button>`).join('');
      $('#mapDims').hidden = dims.length < 2;
      const info = this.map.dimInfo();
      const blocks = info ? info.regions.length * 512 * 512 : 0;
      $('#mapSub').textContent = info ? `${fmtNum(info.regions.length)} region${info.regions.length === 1 ? '' : 's'} · ${(blocks / 1e6).toFixed(1)} km² explored` : '';
      this.people(); this.coords();
    },

    people() {
      if (!this.built) return;
      const host = $('#mapPeople');
      host.hidden = !this.peopleOpen;
      $('#mapPeopleBtn').classList.toggle('on', this.peopleOpen);
      if (!this.peopleOpen) return;
      const dim = this.map.dim;
      const row = (p, sub, away) => `
        <div class="row click ${this.map.follow === p.name ? 'sel' : ''}" data-follow="${esc(p.name)}" title="${away ? 'Go to where they were' : this.map.follow === p.name ? 'Stop following' : 'Follow'}" style="${away ? 'opacity:.7' : ''}">
          ${faceImg(p, 26)}
          <div class="row-info"><div class="row-title">${esc(p.name)}</div><div class="row-sub num">${sub}</div></div>
          ${this.map.follow === p.name ? '<i class="ti ti-focus-2" style="color:var(--text)"></i>' : ''}
        </div>`;
      const online = Live.players.map(p => row(p, p.x != null ? `${p.dim === dim ? '' : esc(dimLabel(p.dim)) + ' · '}${Math.round(p.x)}, ${Math.round(p.z)}` : 'Position unknown')).join('');
      let html = `<div class="label">Online<span>${Live.players.length}</span></div>` + (online || '<div class="muted" style="padding:14px">Nobody on</div>');
      if (this.map.show.away && MapData.away.length) {
        html += `<div class="label" style="margin-top:6px">Away</div>` + MapData.away.slice(0, 40).map(p => row(p, fmtAgo(p.lastSeen), true)).join('');
      }
      // Rebuilding the list every second would fight the pointer: only when it differs.
      if (host._html !== html) { host.innerHTML = html; host._html = html; }
    },

    hover(at) { this._hover = at; this.coords(); },

    coords() {
      if (!this.built) return;
      const at = this._hover, map = this.map, host = $('#mapCoords');
      if (at?.near) {
        const p = at.near.player || at.near;
        host.innerHTML = `<b>${esc(p.name)}</b> ${Math.round(p.x)}, ${p.y != null ? Math.round(p.y) + ', ' : ''}${Math.round(p.z)}`;
      } else if (at) host.innerHTML = `<b>${at.x}</b>, <b>${at.z}</b> &nbsp;chunk ${at.x >> 4}, ${at.z >> 4}`;
      else host.innerHTML = `Centre <b>${Math.round(map.cx)}</b>, <b>${Math.round(map.cz)}</b>`;
    },

    async goto() {
      const text = await inputDialog({ title: 'Go to coordinates', message: 'The x and z of a place, like <b>-240 1180</b>.', placeholder: 'x z', confirm: 'Go', mono: true });
      if (!text) return;
      const nums = text.match(/-?\d+(\.\d+)?/g);
      if (!nums || nums.length < 2) { toast("That doesn't look like two numbers.", { bad: true }); return; }
      this.map.follow = null;
      // Three numbers are x y z; two are x z.
      this.map.goTo(+nums[0], +nums[nums.length === 2 ? 1 : 2], Math.max(this.map.zoom, 2));
      this.people();
    },
  };

  Live.on('players', () => { if (Shell.view === 'map') MapView.people(); });
  Live.on('status', () => { if (Shell.view === 'map') MapView.sync(); });

  // ══ Comings and goings ══
  let _lastPhase = null;
  Live.on('status', s => {
    Games.status(s);
    if (_lastPhase && _lastPhase !== s.phase && Games.on) {
      if (s.phase === 'online') { toast(`${s.server.name} is online`, { icon: 'ti-circle-check' }); Sfx.play('online'); }
      else if (s.phase === 'offline' && _lastPhase !== 'unknown') { toast(`${s.server.name} stopped`, { icon: 'ti-player-stop' }); Sfx.play('offline'); }
    }
    _lastPhase = s.phase;
  });
  // What happens in the game is announced the way the game announces it:
  // yellow for comings and goings, the "Advancement Made!" box, white for a death.
  Live.on('event', e => {
    if (!Games.on || Date.now() - e.t > 8000) return;
    const face = { name: e.player, uuid: Live.player(e.player)?.uuid };
    if (e.kind === 'join') { mcToast([{ text: `${e.player} joined the game`, colour: '#ffff55' }], { face, ms: 3600 }); Sfx.play('join'); }
    else if (e.kind === 'leave') { mcToast([{ text: `${e.player} left the game`, colour: '#ffff55' }], { face, ms: 3600 }); Sfx.play('leave'); }
    else if (e.kind === 'advancement') { mcToast([{ text: 'Advancement Made!', colour: '#ffff55' }, { text: e.message }], { face, ms: 5200 }); Sfx.play('adv'); }
    else if (e.kind === 'death') { mcToast([{ text: `${e.player} ${e.message}` }], { face, ms: 4600 }); Sfx.play('oof'); }
  });

  // ══ The page: klabnet's sidebar beside it ══
  // In place of the dashboard's shell (its 12-shell.js): no sign-in, no
  // nav of its own. The rows are in klabnet's sidebar (#gamesNav).
  const VIEWS = { overview: Overview, players: Players, map: MapView };
  const FILL_VIEWS = new Set(['map']);
  const VIEW_KEY = 'klabnet_games_mc_view';
  const nav = document.getElementById('gamesNav');

  const Shell = {
    view: '',
    go(name, opts) {
      if (!VIEWS[name]) name = 'overview';
      if (name === this.view && !opts) return;
      this.view = name;
      try { localStorage.setItem(VIEW_KEY, name); } catch (e) {}
      nav?.querySelectorAll('[data-mc]').forEach(b => b.classList.toggle('active', b.dataset.mc === name));
      // Until the server answers, only the row moves; the view follows.
      if (!Live.connected) return;
      $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
      $('#mcRoot').classList.toggle('fill', FILL_VIEWS.has(name));
      VIEWS[name].show(opts || {});
      if (!FILL_VIEWS.has(name)) $('#mcRoot').scrollTop = 0;
    },
  };

  // Why there's nothing to show, in words a viewer can pass on. null: there is.
  const GATES = {
    0:   ['ti-plug-connected-x', "Can't reach the server", "The Minecraft dashboard isn't answering. It may be restarting; this tries again by itself."],
    // A wrong or missing secret reads as "sign in first" (401) to it.
    401: ['ti-lock', "The server didn't let klabnet in", "The Minecraft dashboard answers klabnet only with its shared secret, from a proxy it trusts, and with your klabnet sign-in passed along (KLABNET_PROXY_SECRET and TRUSTED_PROXIES there)."],
    403: ['ti-lock', "The server didn't take klabnet's page as its own", "Its live connection checks that the page comes from the site that asked (Origin against Host). The route has to pass the Host along unchanged, as Caddy does by default."],
    live: ['ti-plug-connected-x', "Can't open the live connection", "The server answered, but its live connection (a WebSocket, /api/mc/live) didn't open through klabnet's route. This keeps trying."],
    404: ['ti-route-off', 'Not set up yet', "Games needs klabnet's route to the Minecraft dashboard (/api/mc/ in Caddy)."],
  };

  const Games = {
    on: false,       // the tab is up
    wanted: false,   // keep the socket open (until a minute after you leave)
    _leave: 0, _entering: false, _retry: 0,

    shown(on) {
      this.on = on;
      clearTimeout(this._leave);
      if (on) {
        this.wanted = true;
        if (!Live.me) this.enter(); else Live.connect();
      } else {
        this._leave = setTimeout(() => { this.wanted = false; Live.disconnect(); }, 60000);
        closeDrawer(); closeModal(true);
      }
    },

    async enter() {
      if (this._entering) return;
      this._entering = true;
      let res = null;
      try { res = await fetch('/api/mc/me', { credentials: 'same-origin' }); } catch (e) {}
      this._entering = false;
      // Without the route, the page's own index.html comes back instead.
      const json = !!res && (res.headers.get('content-type') || '').includes('json');
      if (!res || !res.ok || !json) {
        const code = !res ? 0 : res.ok || res.status === 404 ? 404 : res.status === 401 || res.status === 403 ? 401 : 0;
        this.gate(code);
        if (code === 0) { clearTimeout(this._retry); this._retry = setTimeout(() => { if (this.on) this.enter(); }, 8000); }
        return;
      }
      Live.me = await res.json();
      if (this.wanted) Live.connect();
    },

    gate(code) {
      const el = $('#gate');
      el.hidden = code === null;
      if (code !== null) {
        const [icon, title, sub] = GATES[code] || GATES[0];
        el.innerHTML = `<div class="panel"><div class="empty"><i class="ti ${icon}"></i><div>${esc(title)}</div><div class="empty-sub">${esc(sub)}</div></div></div>`;
        $$('.view').forEach(v => v.classList.remove('active'));
        $('#banner').hidden = true;
      }
    },

    // The sidebar's foot (the server, its state) and a banner when it's down.
    status(s) {
      const phase = s.phase;
      const name = document.getElementById('gamesServerName'), state = document.getElementById('gamesServerState');
      if (name) name.textContent = s.server.name;
      if (state) state.textContent = phase === 'online' ? `${s.server.online} of ${s.server.max} online` : PHASE_TEXT[phase] || phase;
      const dot = document.getElementById('gamesServerDot');
      if (dot) dot.className = `games-dot ${PHASE_DOT[phase] || ''}`;
      const slot = document.getElementById('gamesServerIcon');
      const icon = s.server.icon ? `/api/mc/server/icon?v=${s.server.icon}` : GRASS_ICON;
      if (slot && icon && slot.dataset.src !== icon) { slot.dataset.src = icon; slot.innerHTML = `<img src="${icon}" alt="" />`; }
      const banner = $('#banner');
      if (phase === 'error' || phase === 'missing') {
        banner.hidden = false; banner.className = 'banner is-error';
        banner.innerHTML = "<i class=\"ti ti-plug-connected-x\"></i><span>The server can't be reached right now.</span>";
      } else if (!Live.connected) {
        banner.hidden = false; banner.className = 'banner';
        banner.innerHTML = '<i class="ti ti-wifi-off"></i><span>Lost the connection to the server. Trying again.</span>';
      } else banner.hidden = true;
    },
  };

  Live.on('link', up => {
    if (up) { Games.gate(null); Shell.go(Shell.view, {}); }
    else if (Live.status) Games.status(Live.status);
  });

  // klabnet's theme, mirrored inside (the dashboard's CSS asks [data-theme]).
  const theme = () => {
    const t = document.documentElement.getAttribute('data-theme') || 'dark';
    $$('.mc-root').forEach(el => { el.dataset.theme = t; });
    for (const map of MapData.maps) map.redraw();
  };
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  theme();

  nav?.addEventListener('click', e => {
    const row = e.target.closest('[data-mc]');
    if (!row) return;
    SFX.play('nav');
    Shell.go(row.dataset.mc);
  });
  document.getElementById('gamesServer')?.addEventListener('click', () => Shell.go('overview'));
  let saved = 'overview';
  try { saved = localStorage.getItem(VIEW_KEY) || saved; } catch (e) {}
  Shell.go(saved);

  window.klabGamesTabChanged = on => Games.shown(on);
  if (document.body.classList.contains('tab-games-active')) Games.shown(true);
})();
