// node tests/browser.mjs [--url=http://localhost:8791/] [--w=1600] [--h=1000]
// Requires Chrome; use Windows Node on WSL. Never touches a signed-in profile.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import steps from './browser-regressions.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const width = +(args.w || 1600), height = +(args.h || 1000);
const port = 10000 + Math.floor(Math.random() * 40000);
const output = args.output || mkdtempSync(join(tmpdir(), 'klabnet-review-'));
mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'), [
  '--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'klabnet-profile-'))}`,
  `--window-size=${width},${height}`, '--no-first-run', '--hide-scrollbars', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });
let launchError;
chrome.on('error', error => { launchError = error; });
let ws;
const exceptions = [];
try {
  let target;
  for (let n = 0; n < 40 && !target; n++) {
    await sleep(250);
    if (launchError) throw launchError;
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = message => {
    const data = JSON.parse(message.data);
    if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id); }
    else if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, data => { clearTimeout(timer); data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.open = () => null;
    localStorage.removeItem('klabnet_matrix_session'); localStorage.removeItem('klabnet_login_song');
    localStorage.setItem('klabnet_settings', JSON.stringify({loginSong:false,sfxEnabled:false}));` });
  const variant = args.variant || 'dark';
  if (['win', 'gnome', 'kde', 'mac'].includes(variant)) {
    const platform = variant === 'win' ? 'win32' : variant === 'mac' ? 'darwin' : 'linux';
    const chromeStyle = { titlebar: variant === 'win' ? 40 : variant === 'gnome' ? 46 : variant === 'mac' ? 52 : 0,
      material: variant === 'win' ? 'acrylic' : variant === 'mac' ? 'vibrancy' : 'none',
      canMaterial: variant === 'win', desktop: variant === 'win' ? 'windows' : variant === 'mac' ? '' : variant,
      accent: '#3584e4', headerbar: variant === 'gnome', buttons: { left: [], right: ['minimize', 'maximize', 'close'] } };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.klabnetDesktop = {
      version:'1.3.0', platform:${JSON.stringify(platform)}, chrome:()=>(${JSON.stringify(chromeStyle)}),
      getSettings:async()=>({version:'1.3.0',platform:${JSON.stringify(platform)},update:{state:'idle'}}),
      setSetting:async()=>{},checkForUpdates:async()=>({}),onUpdateStatus(){},focus(){},trimMemory(){},
      idle:async()=>({idle:1,locked:false}),matrixSsoLogin:()=>new Promise(()=>{}),
      windowControls:{minimize(){},toggleMaximize(){},close(){},state:async()=>({maximized:false,fullscreen:false,focused:true}),onState(){}} };` });
  }
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const page = {
    send, sleep, exceptions, output, variant, smoke: args.smoke === 'true',
    async goto(url = args.url || 'http://localhost:8791/') { await send('Page.navigate', { url }); await sleep(4500); },
    async ev(expression) {
      const data = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (data.result.exceptionDetails) throw new Error(data.result.exceptionDetails.exception?.description || data.result.exceptionDetails.text);
      return data.result.result.value;
    },
    async shot(name) {
      const data = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(output, name + '.png'), Buffer.from(data.result.data, 'base64'));
    },
    async key(key, code = key) {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code,
        windowsVirtualKeyCode: ({ Enter: 13, Tab: 9, ' ': 32, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key] || 0) });
    },
  };
  await steps(page);
  if (exceptions.length) throw new Error(exceptions.join('\n'));
  console.log('PASS browser regressions; screenshots:', output);
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  ws?.close();
  if (chrome.pid) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    else chrome.kill();
  }
}
