// node tests/voice.mjs [--url=http://localhost:8791/] [--variant=dark|light|mac|win|gnome] [--out=dir]
// Voice, end to end: two people (two tabs with fake microphones) in one
// headless Chrome, against the local API and a local LiveKit. Needs more
// than tests/browser.mjs does; see tests/README.md. Use Windows Node on WSL.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const BASE = args.url || 'http://localhost:8791/';
const out = args.out || mkdtempSync(join(tmpdir(), 'klabnet-voice-'));
mkdirSync(out, { recursive: true });
const variant = args.variant || 'dark';
const port = 10000 + Math.floor(Math.random() * 40000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// What the fake microphones "say". Chrome's own fake device only beeps,
// too briefly for LiveKit to call it speech, so the speaking rings need
// this: a 150Hz voice with harmonics, in syllables, as a WAV that loops.
const wav = join(mkdtempSync(join(tmpdir(), 'klabnet-voice-wav-')), 'speech.wav');
{
  const rate = 48000, n = rate * 6, pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(rate, 24); pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate, env = Math.sqrt(0.5 * (1 - Math.cos(2 * Math.PI * 4 * t)));
    let v = 0;
    for (let k = 1; k < 12; k++) v += Math.sin(2 * Math.PI * 150 * k * t) / k;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 0.25 * env)) * 30000), 44 + i * 2);
  }
  writeFileSync(wav, pcm);
}
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'), [
  '--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'klabnet-voice-profile-'))}`,
  '--window-size=1400,900', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  // Two tabs, one in front: without these the other's timers run once a
  // second, and its push-to-talk release lands late.
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--use-file-for-fake-audio-capture=' + wav,
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

const fails = [];
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); if (!ok) fails.push(name); };

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 0; const pending = new Map(); const exceptions = []; const logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId;
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, d => { clearTimeout(t); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async expression => {
    const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || d.result.exceptionDetails.text);
    return d.result.result.value;
  };
  const shot = async name => {
    const d = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, name + '.png'), Buffer.from(d.result.data, 'base64'));
  };
  const key = async (type, key, code, modifiers = 0, vk = 0) => send('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: vk });
  return { ws, send, ev, shot, key, exceptions, logs };
}

async function open(user) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const p = await attach(t.webSocketDebuggerUrl);
  let init = `window.open = () => null;
    localStorage.removeItem('klabnet_matrix_session'); localStorage.removeItem('klabnet_login_song');
    localStorage.setItem('klabnet_settings', JSON.stringify({loginSong:false,sfxEnabled:false}));`;
  if (variant === 'light') init += `localStorage.setItem('klabnet_theme', 'light');`;
  if (['win', 'mac', 'gnome'].includes(variant)) {
    const platform = variant === 'win' ? 'win32' : variant === 'mac' ? 'darwin' : 'linux';
    const cs = { titlebar: variant === 'win' ? 40 : variant === 'gnome' ? 46 : 52, material: 'none', canMaterial: false,
      desktop: variant === 'win' ? 'windows' : variant === 'mac' ? '' : variant, accent: '#3584e4', headerbar: variant === 'gnome',
      buttons: { left: [], right: ['minimize', 'maximize', 'close'] } };
    init += `window.klabnetDesktop = { version:'1.3.0', platform:${JSON.stringify(platform)}, chrome:()=>(${JSON.stringify(cs)}),
      getSettings:async()=>({version:'1.3.0',platform:${JSON.stringify(platform)},update:{state:'idle'}}),
      setSetting:async()=>{},checkForUpdates:async()=>({}),onUpdateStatus(){},focus(){},trimMemory(){},
      idle:async()=>({idle:1,locked:false}),matrixSsoLogin:()=>new Promise(()=>{}),
      windowControls:{minimize(){},toggleMaximize(){},close(){},state:async()=>({maximized:false,fullscreen:false,focused:true}),onState(){}} };`;
  }
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url: BASE + '?u=' + user });
  await sleep(5000);
  p.user = user;
  return p;
}
const until = async (p, expr, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await p.ev(expr)) return true; await sleep(250); }
  return false;
};
const st = p => p.ev('klabVoice.state()');
const names = async (p, ch) => p.ev(`[...document.querySelectorAll('.vc-channel[data-id="${ch}"] .vc-member')].map(e => e.dataset.u + (e.querySelector('.ti-microphone-off') ? ':muted' : '') + (e.querySelector('.ti-headphones-off') ? ':deaf' : ''))`);

try {
  for (let n = 0; n < 40; n++) { await sleep(250); try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch {} }
  const a = await open('alice'), b = await open('bob');

  check('button shows once the API says voice is on', await until(a, `!document.getElementById('voiceBtn').hidden`));
  check('mic button hidden before joining', await a.ev(`document.getElementById('voiceMicBtn').hidden`));
  check('settings section shows', await a.ev(`!document.getElementById('voiceSettings').hidden`));

  await a.ev(`document.getElementById('voiceBtn').click()`);
  check('panel opens with channels', await until(a, `document.querySelectorAll('#voicePanel.visible .vc-channel').length >= 1`), await a.ev(`[...document.querySelectorAll('.vc-row-name')].map(e => e.textContent)`));
  check('admin sees the add button', await a.ev(`!document.getElementById('vcAddBtn').hidden`));
  await a.shot('1-panel-empty');

  // alice joins channel 1
  await a.ev(`document.querySelector('.vc-channel[data-id="1"] .vc-row').click()`);
  check('alice goes live', await until(a, `klabVoice.state().phase === 'live'`, 20000), await st(a));
  check('alice has a microphone out', await until(a, `klabVoice.state().micProblem === '' && klabVoice.state().members[0] && !klabVoice.state().muted`), await st(a));
  check('mic button shows for alice', await a.ev(`!document.getElementById('voiceMicBtn').hidden`));
  await sleep(1500);
  await a.shot('2-alice-joined');

  // bob, not in the channel, sees alice there via the API
  await b.ev(`klabVoice.refresh()`);
  check('bob sees alice in the channel from outside', await until(b, `[...document.querySelectorAll('.vc-channel[data-id="1"] .vc-member')].some(e => e.dataset.u === 'alice')`), await names(b, 1));
  check('bob gets a count badge', await b.ev(`!document.getElementById('voiceBadge').hidden && document.getElementById('voiceBadge').textContent`) === '1');
  await b.ev(`document.getElementById('voiceBtn').click()`);
  await sleep(400);
  await b.shot('3-bob-sees-alice');

  // bob joins
  await b.ev(`document.querySelector('.vc-channel[data-id="1"] .vc-row').click()`);
  check('bob goes live', await until(b, `klabVoice.state().phase === 'live'`, 20000));
  check('alice sees bob arrive', await until(a, `klabVoice.state().members.some(m => m.username === 'bob')`), await names(a, 1));
  check('bob hears alice (an audio element with a live track)', await until(b, `[...document.querySelectorAll('#voiceSink audio')].some(el => el.srcObject && el.srcObject.getAudioTracks().some(t => t.readyState === 'live'))`));
  check('alice hears bob', await until(a, `[...document.querySelectorAll('#voiceSink audio')].some(el => el.srcObject && el.srcObject.getAudioTracks().some(t => t.readyState === 'live'))`));

  // Audio really flows: the loudest sample bob's speaker element gets over two seconds.
  const level = p => p.ev(`(async () => {
    const el = document.querySelector('#voiceSink audio'); if (!el || !el.srcObject) return -1;
    const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(el.srcObject); const an = ctx.createAnalyser(); src.connect(an);
    let peak = 0; const buf = new Float32Array(an.fftSize);
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 50)); an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
    ctx.close(); return peak; })()`);
  const peakB = await level(b);
  check('sound arrives at bob', peakB > 0.01, peakB);
  check('speaking shows up (server-detected)', await until(a, `klabVoice.state().speaking.length > 0`, 12000), await a.ev('klabVoice.state().speaking'));
  check('speaking ring is drawn', await until(a, `!!document.querySelector('.vc-member.speaking')`, 8000), await a.ev(`[...document.querySelectorAll('.vc-member.speaking')].map(e => e.dataset.u)`));
  check('own mic button rings while speaking', await until(a, `document.getElementById('voiceMicBtn').classList.contains('speaking')`, 8000));
  await a.shot('4-both-in');

  // mute via the header button; bob sees it
  await a.ev(`document.getElementById('voiceMicBtn').click()`);
  check('alice muted locally', (await st(a)).muted === true);
  check('bob sees alice muted', await until(b, `klabVoice.state().members.some(m => m.username === 'alice' && m.muted)`), await names(b, 1));
  await sleep(2500);
  const peakMuted = await level(b);
  check('muted means silence at bob', peakMuted < 0.005, peakMuted);
  // ctrl+shift+m unmutes
  await a.key('keyDown', 'M', 'KeyM', 2 | 8, 77); await a.key('keyUp', 'M', 'KeyM', 2 | 8, 77);
  check('Ctrl+Shift+M unmutes', await until(a, `klabVoice.state().muted === false`));
  check('bob sees alice unmuted', await until(b, `klabVoice.state().members.some(m => m.username === 'alice' && !m.muted)`));

  // deafen
  await b.ev(`document.getElementById('vcDeafen').click()`);
  check('bob deafened + muted', await b.ev(`klabVoice.state().deafened && klabVoice.state().muted`));
  check('bob deaf: alice at volume 0', await b.ev(`[...document.querySelectorAll('#voiceSink audio')].every(el => el.volume === 0)`));
  check('alice sees bob deafened', await until(a, `klabVoice.state().members.some(m => m.username === 'bob' && m.deafened && m.muted)`), await names(a, 1));
  await a.shot('5-bob-deafened');
  await b.ev(`document.getElementById('vcDeafen').click()`);
  check('bob undeafened, audio back', await until(b, `!klabVoice.state().deafened && [...document.querySelectorAll('#voiceSink audio')].every(el => el.volume === 1)`));

  // per-person volume
  await a.ev(`document.querySelector('.vc-member[data-u="bob"]').click()`);
  check('volume row opens for bob', await until(a, `!!document.querySelector('.vc-vol[data-u="bob"]')`));
  await a.ev(`(() => { const el = document.querySelector('.vc-vol[data-u="bob"]'); el.value = 40; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  check('bob at 40% for alice', await a.ev(`Math.abs(document.querySelector('#voiceSink audio').volume - 0.4) < 0.001`), await a.ev(`document.querySelector('#voiceSink audio').volume`));
  await a.shot('6-volume');

  // a third look from the API while both are in
  const apiView = await (await fetch(BASE + 'api/voice', { headers: { 'x-dev-user': 'carol' } })).json();
  check('API lists both', apiView.channels[0].members.map(m => m.username).sort().join() === 'alice,bob', apiView.channels[0].members);

  // push to talk
  await a.ev(`document.getElementById('vcSettingsBtn').click()`);
  await sleep(600);
  check('settings opened from the panel', await a.ev(`document.getElementById('settingsBackdrop').classList.contains('open')`));
  check('devices listed', await a.ev(`document.getElementById('vcInput').options.length`) >= 2, await a.ev(`[...document.getElementById('vcInput').options].map(o => o.text)`));
  await a.shot('7-settings');
  await a.ev(`document.querySelector('#vcMode button[data-v="ptt"]').click()`);
  await a.ev(`document.getElementById('vcPttKey').click()`);
  await a.key('keyDown', 'F8', 'F8', 0, 119); await a.key('keyUp', 'F8', 'F8', 0, 119);
  check('push-to-talk key bound', await a.ev(`document.getElementById('vcPttKey').textContent`) === 'F8', await a.ev(`document.getElementById('vcPttKey').textContent`));
  await a.ev(`document.getElementById('settingsClose').click()`);
  await sleep(600);
  const silentPtt = await level(b);
  check('push to talk: silent until held', silentPtt < 0.005, silentPtt);
  check('push to talk: not shown as muted', (await st(a)).muted === false);
  await a.key('rawKeyDown', 'F8', 'F8', 0, 119);
  await sleep(500);
  const heldPtt = await level(b);
  check('push to talk: heard while held', heldPtt > 0.01, heldPtt);
  await a.key('keyUp', 'F8', 'F8', 0, 119);
  await sleep(900);
  const afterPtt = await level(b);
  check('push to talk: the microphone is off at the source', (await st(a)).micLive === false);
  check('push to talk: silent again on release', afterPtt < 0.005, afterPtt);
  await a.ev(`document.getElementById('settingsBtn').click(); document.querySelector('#vcMode button[data-v="open"]').click(); document.getElementById('settingsClose').click()`);

  // admin: a second channel; bob switches into it
  const made = await (await fetch(BASE + 'api/voice/channels', { method: 'POST', headers: { 'x-dev-user': 'alice', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test ' + Date.now() % 10000 }) })).json();
  await b.ev(`klabVoice.refresh()`);
  await until(b, `!!document.querySelector('.vc-channel[data-id="${made.id}"]')`);
  await b.ev(`document.querySelector('.vc-channel[data-id="${made.id}"] .vc-row').click()`);
  check('bob switches channel', await until(b, `klabVoice.state().phase === 'live' && klabVoice.state().channel.id === ${made.id}`, 20000));
  check('alice sees bob leave', await until(a, `!klabVoice.state().members.some(m => m.username === 'bob')`));
  await a.ev(`klabVoice.refresh()`);
  check('alice sees bob in the other channel', await until(a, `[...document.querySelectorAll('.vc-channel[data-id="${made.id}"] .vc-member')].some(e => e.dataset.u === 'bob')`), await names(a, made.id));
  await a.shot('8-two-channels');

  // deleting the channel puts bob out
  await fetch(BASE + 'api/voice/channels/' + made.id, { method: 'DELETE', headers: { 'x-dev-user': 'alice' } });
  check('bob is put out when his channel is deleted', await until(b, `klabVoice.state().phase === 'idle'`, 15000), await st(b));

  // same person on a second device takes over
  const a2 = await open('alice');
  await a2.ev(`klabVoice.join(1)`);
  check('second device goes live', await until(a2, `klabVoice.state().phase === 'live'`, 20000));
  check('first device is dropped', await until(a, `klabVoice.state().phase === 'idle'`, 15000), await st(a));
  await a.shot('9-moved');

  // leave
  await a2.ev(`document.getElementById('voiceBtn').click()`);
  await a2.ev(`document.getElementById('vcLeave').click()`);
  check('leave returns to idle', await until(a2, `klabVoice.state().phase === 'idle' && document.getElementById('voiceMicBtn').hidden`));
  check('no leftover audio elements', await a2.ev(`document.querySelectorAll('#voiceSink audio').length`) === 0);
  await sleep(2500);
  const after = await (await fetch(BASE + 'api/voice', { headers: { 'x-dev-user': 'carol' } })).json();
  check('API shows the channel empty again', after.channels[0].members.length === 0, after.channels[0].members);

  for (const p of [a, b, a2]) {
    check('no page exceptions (' + p.user + ')', p.exceptions.length === 0, p.exceptions);
    if (p.logs.length) console.log('  console (' + p.user + '):', [...new Set(p.logs)].slice(0, 8));
  }
  console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'ALL PASS', '\nscreenshots:', out);
  if (fails.length) process.exitCode = 1;
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  if (chrome.pid) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    else chrome.kill();
  }
}
