// node tests/session.mjs [--url=http://localhost:8791/] [--out=dir]
// One player on every device (js/23-session.js), end to end: one person
// with klabnet open in several tabs of one headless Chrome, against the
// local API. The songs are made up and Navidrome is never asked to play
// anything: stream requests are answered here with a quiet WAV, and
// scrobbles are counted and dropped. See tests/README.md. Use Windows Node
// on WSL.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const BASE = args.url || 'http://localhost:8791/';
const out = args.out || mkdtempSync(join(tmpdir(), 'klabnet-session-'));
mkdirSync(out, { recursive: true });
const port = 10000 + Math.floor(Math.random() * 40000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const USER = 'sess';

// Four minutes of a very quiet tone, as every song's audio.
const SECONDS = 240;
const wav = (() => {
  const rate = 8000, n = rate * SECONDS, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(2 * Math.sin(2 * Math.PI * 220 * i / rate));
  return b;
})();
const song = n => ({ id: 'sess-test-' + n, title: 'Test song ' + n, artist: 'Nobody', album: 'Made up', duration: SECONDS, suffix: 'wav' });
const SONGS = JSON.stringify([1, 2, 3, 4, 5].map(song));

const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'), [
  '--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'klabnet-session-profile-'))}`,
  '--window-size=1400,900', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

const fails = [];
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); if (!ok) fails.push(name); };

async function attach(wsUrl, oldApi) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 0; const pending = new Map(); const exceptions = [];
  const seen = { streams: 0, scrobbles: 0 };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId;
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, d => { clearTimeout(t); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    else if (d.method === 'Fetch.requestPaused') {
      const { requestId, request } = d.params, url = request.url;
      const answer = (responseCode, type, body) => send('Fetch.fulfillRequest', { requestId, responseCode,
        responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }], body }).catch(() => {});
      if (url.includes('/rest/stream')) {
        // Like Navidrome: the part asked for, so seeking works.
        const m = /bytes=(\d+)-(\d*)/.exec(request.headers.Range || request.headers.range || '');
        const from = m ? +m[1] : 0, to = m && m[2] ? Math.min(+m[2], wav.length - 1) : wav.length - 1;
        if (from === 0) seen.streams++;
        send('Fetch.fulfillRequest', { requestId, responseCode: m ? 206 : 200, responseHeaders: [
          { name: 'Content-Type', value: 'audio/wav' }, { name: 'Accept-Ranges', value: 'bytes' },
          { name: 'Content-Length', value: String(to - from + 1) },
          ...(m ? [{ name: 'Content-Range', value: `bytes ${from}-${to}/${wav.length}` }] : []),
        ], body: wav.subarray(from, to + 1).toString('base64') }).catch(() => {});
      }
      else if (url.includes('/rest/scrobble')) { seen.scrobbles++; answer(200, 'application/json', Buffer.from('{}').toString('base64')); }
      else if (url.includes('/api/music-requests/session')) answer(405, 'application/json', Buffer.from('{"detail":"Method Not Allowed"}').toString('base64'));
      else answer(404, 'text/plain', '');
    }
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns: [
    { urlPattern: '*music.klab.gg/rest/stream*' }, { urlPattern: '*music.klab.gg/rest/scrobble*' },
    { urlPattern: '*music.klab.gg/rest/*sess-test-*' },
    // A tab against "an API from before this": its session routes aren't there.
    ...(oldApi ? [{ urlPattern: '*/api/music-requests/session*' }] : []),
  ] });
  const ev = async expression => {
    const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || d.result.exceptionDetails.text);
    return d.result.result.value;
  };
  const shot = async name => {
    const d = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, name + '.png'), Buffer.from(d.result.data, 'base64'));
  };
  return { ws, send, ev, shot, exceptions, seen };
}

// Each "device" is its own window: a tab behind another one doesn't load
// audio until it has been in front, which a second device never needs.
let browser = null;
async function open(user, opts = {}) {
  if (!browser) {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    browser = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { browser.onopen = res; browser.onerror = rej; });
    browser.calls = new Map(); browser.n = 0;
    browser.onmessage = m => { const d = JSON.parse(m.data); browser.calls.get(d.id)?.(d); browser.calls.delete(d.id); };
    browser.call = (method, params) => new Promise(res => { const id = ++browser.n; browser.calls.set(id, res); browser.send(JSON.stringify({ id, method, params })); });
  }
  const made = await browser.call('Target.createTarget', { url: 'about:blank', newWindow: true });
  const targetId = made.result.targetId;
  const p = await attach(`ws://127.0.0.1:${port}/devtools/page/${targetId}`, opts.oldApi);
  p.targetId = targetId;
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.open = () => null;
    localStorage.removeItem('klabnet_matrix_session');
    localStorage.setItem('klabnet_volume', '0.8');
    ${opts.loginSong ? `localStorage.setItem('klabnet_login_song', ${JSON.stringify(JSON.stringify(song(9)))});` : `localStorage.removeItem('klabnet_login_song');`}
    localStorage.setItem('klabnet_settings', JSON.stringify({loginSong:${!!opts.loginSong},sfxEnabled:false}));` });
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url: BASE + '?u=' + user });
  await sleep(4500);
  return p;
}
const until = async (p, expr, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await p.ev(expr)) return true; await sleep(200); }
  return false;
};
const st = p => p.ev(`(() => { const s = klabSession.state(), a = playerState.audio; return { role: s.role, mirror: s.mirror, devices: s.devices.length, song: playerState.currentSong?.id || null,
  playing: playerState.playing, paused: a.paused, t: Math.round(a.currentTime * 10) / 10, src: !!a.getAttribute('src'), index: playerState.playlistIndex, list: playerState.playlist.length, queue: queue.map(s => s.id) }; })()`);
// What the element is really doing, behind the stand-in.
const realAudio = p => p.ev(`(() => { const d = n => Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, n).get.call(playerState.audio); return { paused: d('paused'), t: Math.round(d('currentTime') * 10) / 10, volume: d('volume'), src: !!playerState.audio.getAttribute('src') }; })()`);
const card = async () => {
  const r = await fetch(BASE + 'api/presence', { headers: { 'x-dev-user': 'onlooker' } });
  return (await r.json()).listeners.find(l => l.username === USER) || null;
};

try {
  for (let n = 0; n < 40; n++) { await sleep(250); try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch {} }
  const a = await open(USER), b = await open(USER);
  const idA = await a.ev('KLAB_DEVICE'), idB = await b.ev('KLAB_DEVICE');

  // ── Two devices, nothing playing ──
  check('both connect and see each other', await until(a, `klabSession.state().devices.length === 2`) && await until(b, `klabSession.state().devices.length === 2`), await st(b));
  check('nobody is playing: both idle', (await st(a)).role === 'idle' && (await st(b)).role === 'idle');
  check('the Devices button shows on both', await a.ev(`!document.getElementById('dockDevices').hidden`) && await b.ev(`!document.getElementById('dockDevices').hidden`));
  check('each has its own id and a name', idA !== idB && await a.ev(`klabSession.state().devices.every(d => !!d.name)`), await a.ev(`klabSession.state().devices.map(d => d.name)`));

  // ── A plays: A is active, B follows ──
  await a.ev(`(() => { const s = ${SONGS}; playerState.playlist = s.slice(0, 3); playerState.playlistIndex = 0; playSong(playerState.playlist[0]); })()`);
  check('A becomes the active device', await until(a, `klabSession.state().role === 'active' && !playerState.audio.paused`), await st(a));
  check('B becomes its remote', await until(b, `klabSession.state().role === 'remote' && playerState.currentSong?.id === 'sess-test-1' && playerState.playing`), await st(b));
  check('B shows the song in its dock', await b.ev(`document.getElementById('playerTitle').textContent`) === 'Test song 1');
  check('B loads no audio of its own', b.seen.streams === 0 && !(await realAudio(b)).src, { streams: b.seen.streams, real: await realAudio(b) });
  check('B has what is up next', await until(b, `playerState.playlist.length === 3 && playerState.playlistIndex === 0`), await st(b));
  check('B says where it is playing', await until(b, `document.getElementById('dockDevices').classList.contains('on') && !!document.getElementById('dockDevicesName').textContent`), await b.ev(`document.getElementById('dockDevicesName').textContent`));
  await sleep(2500);
  {
    const [ta, tb] = [await a.ev(`playerState.audio.currentTime`), await b.ev(`playerState.audio.currentTime`)];
    check('positions agree within half a second', Math.abs(ta - tb) < 0.5 && ta > 1.5, { a: ta, b: tb });
    check('B knows how long the song is', Math.abs(await b.ev(`playerState.audio.duration`) - SECONDS) < 1);
  }
  await b.shot('1-remote-dock');

  // ── B's buttons work A ──
  await b.ev(`togglePlay()`);
  check('pause on B pauses A', await until(a, `playerState.audio.paused`) && (await realAudio(a)).paused);
  check('B shows paused', await b.ev(`!playerState.playing && playerState.audio.paused && document.getElementById('playIcon').className.includes('player-play')`));
  await sleep(800);
  {
    const t1 = await b.ev(`playerState.audio.currentTime`); await sleep(700);
    check('paused: B stops counting', Math.abs(await b.ev(`playerState.audio.currentTime`) - t1) < 0.05);
  }
  await b.ev(`togglePlay()`);
  check('play on B resumes A', await until(a, `!playerState.audio.paused`) && await until(b, `playerState.playing`));
  await b.ev(`playerState.audio.currentTime = 100`);
  check('seeking on B seeks A', await until(a, `Math.abs(playerState.audio.currentTime - 100) < 3`), (await realAudio(a)).t);
  await sleep(1200);
  check('B follows the seek', Math.abs(await b.ev(`playerState.audio.currentTime`) - await a.ev(`playerState.audio.currentTime`)) < 0.6, await st(b));
  await b.ev(`nextSong()`);
  check('next on B: A moves on', await until(a, `playerState.currentSong?.id === 'sess-test-2' && playerState.playlistIndex === 1`), await st(a));
  check('B shows the next song', await until(b, `playerState.currentSong?.id === 'sess-test-2' && playerState.playlistIndex === 1`), await st(b));
  await b.ev(`prevSong()`);
  check('previous on B: A goes back', await until(a, `playerState.currentSong?.id === 'sess-test-1'`) && await until(b, `playerState.currentSong?.id === 'sess-test-1'`));

  // Picking a song on B, from a list A doesn't have
  await b.ev(`(() => { const s = ${SONGS}; playerState.playlist = s.slice(2); playerState.playlistIndex = 1; playSong(playerState.playlist[1]); })()`);
  check('B shows its pick at once', await b.ev(`playerState.currentSong?.id === 'sess-test-4' && document.getElementById('playerTitle').textContent === 'Test song 4'`));
  check('a song picked on B plays on A, with its list', await until(a, `playerState.currentSong?.id === 'sess-test-4' && playerState.playlist.length === 3 && playerState.playlistIndex === 1 && !playerState.audio.paused`), await st(a));
  check('B still loads no audio', b.seen.streams === 0 && (await st(b)).role === 'remote');

  // The queue, both ways
  await b.ev(`addToQueue(${JSON.stringify(song(5))})`);
  check('queued on B: in A\'s queue', await until(a, `queue.length === 1 && queue[0].id === 'sess-test-5'`), (await st(a)).queue);
  await a.ev(`addToQueue(${JSON.stringify(song(1))})`);
  check('queued on A: in B\'s queue', await until(b, `queue.length === 2 && queue[1].id === 'sess-test-1'`), (await st(b)).queue);
  check('B\'s queue count shows it', await b.ev(`document.getElementById('queueCount').textContent`) === '(2)');
  await b.ev(`(() => { queue.splice(0, 1); updateQueueBadge(); })()`);
  check('removed on B: gone from A', await until(a, `queue.length === 1 && queue[0].id === 'sess-test-1'`), (await st(a)).queue);
  await b.ev(`nextSong()`);
  check('next takes the queued song, on both', await until(a, `playerState.currentSong?.id === 'sess-test-1' && queue.length === 0`) && await until(b, `playerState.currentSong?.id === 'sess-test-1' && queue.length === 0`), await st(b));

  // What's lined up rearranged from a remote, as the phone apps do it: one
  // command with the whole order, and the song that's on carries on.
  const arrange = (playlist, index, q) => b.ev(`fetch('/api/music-requests/session/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: KLAB_DEVICE, cmd: { t: 'list', playlist: ${JSON.stringify(playlist)}, index: ${index}, queue: ${JSON.stringify(q)} } }) }).then(r => r.status)`);
  const lined = `playerState.playlist.map(s => s.id.slice(-1)).join('') + '/' + playerState.playlistIndex + '/' + queue.map(s => s.id.slice(-1)).join('')`;
  const before = (await realAudio(a)).t;
  check('a rearrangement is taken', await arrange([song(2), song(1), song(3)], 1, [song(5)]) === 200);
  check('...by the device playing', await until(a, `${lined} === '213/1/5'`), await a.ev(lined));
  check('...and shown on the remote', await until(b, `${lined} === '213/1/5'`), await b.ev(lined));
  const after = await realAudio(a);
  check('...without restarting the song', !after.paused && after.t >= before && (await st(a)).song === 'sess-test-1', { before, after });
  await arrange([song(3), song(4), song(5)], 1, []);
  check('...and put back', await until(a, `${lined} === '345/1/'`) && await until(b, `${lined} === '345/1/'`), await b.ev(lined));

  // Volume, shuffle, repeat
  // (The tabs here share one browser's storage, so B's saved volume is read
  // back before A, told to change, saves its own.)
  const saved = await b.ev(`(async () => { playerState.volume = 0.3; playerState.audio.volume = 0.3; localStorage.setItem('klabnet_volume', '0.300'); await null; return localStorage.getItem('klabnet_volume'); })()`);
  check('volume on B is A\'s volume', await until(a, `Math.abs(playerState.volume - 0.3) < 0.01`) && Math.abs((await realAudio(a)).volume - 0.3) < 0.01, await realAudio(a));
  check('B keeps its own saved volume', saved === '0.800', saved);
  await a.ev(`(() => { playerState.volume = 0.6; playerState.audio.volume = 0.6; })()`);
  check('A\'s volume shows on B', await until(b, `Math.abs(playerState.audio.volume - 0.6) < 0.01 && Math.abs(playerState.volume - 0.6) < 0.01`));
  await b.ev(`document.getElementById('dockShuffle').click()`);
  check('shuffle on B turns it on for A', await until(a, `_shuffleOn === true`));
  await a.ev(`document.getElementById('dockShuffle').click()`);
  check('shuffle off on A shows on B', await until(b, `_shuffleOn === false`));
  await b.ev(`document.getElementById('fsRepeat').click()`);
  check('repeat on B repeats on A', await until(a, `_repeatOn === true && playerState.audio.loop === true`));
  await b.ev(`document.getElementById('fsRepeat').click()`);
  check('repeat off again', await until(a, `_repeatOn === false && playerState.audio.loop === false`));

  // ── Presence: the card shows the device that's playing, and stays put ──
  {
    await a.ev(`playerState.audio.currentTime = 10`);
    const seenCards = [];
    for (let i = 0; i < 9; i++) { await sleep(2000); const c = await card(); seenCards.push(c ? `${c.songId}:${c.playing}` : 'none'); }
    check('their card shows the playing song, on every look for 18s', seenCards.every(s => s === 'sess-test-1:true'), [...new Set(seenCards)]);
  }

  // Only the device that plays counts the play
  await b.ev(`playerState.audio.currentTime = ${SECONDS / 2 + 5}`);
  check('the active device counts the play', await (async () => { const end = Date.now() + 8000; while (Date.now() < end) { if (a.seen.scrobbles === 1) return true; await sleep(200); } return false; })(), a.seen);
  check('the remote does not', b.seen.scrobbles === 0);
  await b.ev(`playerState.audio.currentTime = 20`);
  await sleep(600);

  // ── Play here ──
  await b.ev(`document.getElementById('dockDevices').click()`);
  check('the Devices menu lists both', await until(b, `document.querySelectorAll('.klab-menu.visible .ctx-item').length === 2`), await b.ev(`[...document.querySelectorAll('.klab-menu.visible .ctx-item')].map(e => e.textContent)`));
  await sleep(500);
  await b.shot('2-devices-menu');
  await b.ev(`document.getElementById('btnFS').click()`);
  await sleep(900);
  check('the full player says where it is playing', await b.ev(`document.getElementById('fsDeviceNote').textContent`) === 'on Chrome on Windows' && await b.ev(`!document.getElementById('fsDevices').hidden`));
  await b.shot('2b-full-player');
  await b.ev(`closeFS()`);
  await sleep(500);
  await b.ev(`document.getElementById('dockDevices').click()`);
  await until(b, `document.querySelectorAll('.klab-menu.visible .ctx-item').length === 2`);
  const tBefore = await a.ev(`playerState.audio.currentTime`);
  await b.ev(`[...document.querySelectorAll('.klab-menu.visible .ctx-item')].find(e => e.textContent.startsWith('This device')).click()`);
  check('Play here: B is the active device and plays', await until(b, `klabSession.state().role === 'active' && !playerState.audio.paused && playerState.audio.currentTime > 0`), await st(b));
  check('B really plays now', b.seen.streams === 1 && !(await realAudio(b)).paused, { streams: b.seen.streams, real: await realAudio(b) });
  check('...from where A had got to', Math.abs((await realAudio(b)).t - tBefore) < 4, { was: tBefore, now: (await realAudio(b)).t });
  check('...at its own volume, not A\'s', Math.abs((await realAudio(b)).volume - 0.8) < 0.01 && Math.abs(await b.ev(`playerState.volume`) - 0.8) < 0.01, await realAudio(b));
  check('A goes quiet and becomes the remote', await until(a, `klabSession.state().role === 'remote'`) && (await realAudio(a)).paused && !(await realAudio(a)).src, await realAudio(a));
  check('A still shows it playing', await until(a, `playerState.playing && playerState.currentSong?.id === 'sess-test-1'`), await st(a));
  check('A is told where it went', await a.ev(`[...document.querySelectorAll('.toast-item')].some(t => t.textContent.includes('Now playing on'))`));
  check('B no longer says "playing on"', await b.ev(`!document.getElementById('dockDevices').classList.contains('on')`));
  await sleep(1500);
  check('positions agree after the move', Math.abs(await a.ev(`playerState.audio.currentTime`) - await b.ev(`playerState.audio.currentTime`)) < 0.6);

  // Sending it to the other device from here
  await b.ev(`klabSession.moveTo(${JSON.stringify(idA)})`);
  check('moved to A from B: A plays, B follows', await until(a, `klabSession.state().role === 'active' && !playerState.audio.paused`) && await until(b, `klabSession.state().role === 'remote'`), [await st(a), await st(b)]);
  check('B let go of its audio', (await realAudio(b)).paused && !(await realAudio(b)).src);

  // ── A third device arrives while music is on ──
  const c = await open(USER, { loginSong: true });
  check('a new device joins as a remote, showing the song', await until(c, `klabSession.state().role === 'remote' && playerState.currentSong?.id === 'sess-test-1' && playerState.playing`), await st(c));
  check('it gets the list and the place in it', await until(c, `playerState.playlist.length === 3`), await st(c));
  await sleep(1500);
  check('its login song does not take over', (await st(a)).role === 'active' && (await st(a)).song === 'sess-test-1' && c.seen.streams === 0, { a: await st(a), streams: c.seen.streams });
  await fetch(`http://127.0.0.1:${port}/json/close/${c.targetId}`);
  check('it leaving is noticed', await until(a, `klabSession.state().devices.length === 2`, 15000));

  // ── The active device goes away ──
  await a.ev(`playerState.audio.currentTime = 50`);
  await sleep(1200);
  await fetch(`http://127.0.0.1:${port}/json/close/${a.targetId}`);
  check('A closes: B is left with it, paused where it was', await until(b, `klabSession.state().role === 'idle' && klabSession.state().mirror && !playerState.playing`, 20000), await st(b));
  {
    const s = await st(b);
    check('...same song, same place', s.song === 'sess-test-1' && s.t > 49 && s.t < 56, s);
    const anyone = await card();
    check('their card says paused, not playing', !!anyone && anyone.playing === false, anyone);
  }
  await b.ev(`togglePlay()`);
  check('Play on B carries on there', await until(b, `klabSession.state().role === 'active' && !playerState.audio.paused`) && (await realAudio(b)).t > 49, await realAudio(b));

  // A fresh device with nothing playing: parked on what was last played
  await b.ev(`togglePlay()`);
  await until(b, `playerState.audio.paused`);
  await fetch(`http://127.0.0.1:${port}/json/close/${b.targetId}`);
  await sleep(1500);
  const d = await open(USER);
  check('a device opened later shows what was last playing, paused', await until(d, `klabSession.state().role === 'idle' && klabSession.state().mirror && playerState.currentSong?.id === 'sess-test-1' && !playerState.playing`), await st(d));
  check('with nobody else around, no Devices button', await d.ev(`document.getElementById('dockDevices').hidden`));
  await d.ev(`(() => { const s = ${SONGS}; playerState.playlist = s; playerState.playlistIndex = 4; playSong(s[4]); })()`);
  check('picking a song there plays it there', await until(d, `klabSession.state().role === 'active' && playerState.currentSong?.id === 'sess-test-5' && !playerState.audio.paused`) && !(await realAudio(d)).paused, await st(d));
  await d.shot('3-alone');

  // ── An API from before this ──
  const o = await open('oldapi', { oldApi: true });
  check('without the API\'s side: off, and no button', await o.ev(`klabSession.state().role === 'off' && document.getElementById('dockDevices').hidden`), await st(o));
  await o.ev(`(() => { const s = ${SONGS}; playerState.playlist = s; playerState.playlistIndex = 0; playSong(s[0]); })()`);
  check('...and it plays as it always did', await until(o, `!playerState.audio.paused && playerState.audio.currentTime > 0.3`) && o.seen.streams === 1, await st(o));
  await o.ev(`nextSong()`);
  check('...next and all', await until(o, `playerState.currentSong?.id === 'sess-test-2' && !playerState.audio.paused`));

  const errs = [...a.exceptions, ...b.exceptions, ...c.exceptions, ...d.exceptions, ...o.exceptions];
  check('no script errors', errs.length === 0, errs.slice(0, 5));
  console.log('screenshots: ' + out);
} catch (e) {
  console.log('FAIL (threw) ' + (e.stack || e));
  fails.push('threw');
} finally {
  try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { chrome.kill(); }
}
console.log(fails.length ? `\n${fails.length} failed: ${fails.join('; ')}` : '\nall passed');
process.exit(fails.length ? 1 : 0);
