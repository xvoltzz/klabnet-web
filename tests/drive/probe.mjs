// node probe.mjs <outdir> [desktop|phone] [dark|light] [stepsFile.json]: prints each step's result; screenshots only steps named shot*
// Screenshots klabnet (the local rig, $RIG or :8791) through a list of steps.
// CHROME = the browser to run (default chromium; on Windows chrome.exe's path).
// A steps file is [[name, jsToEvalBeforeShot, waitMs], ...]; without one,
// the default tour of every page. Logs page errors at the end.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [OUT = './shots', MODE = 'desktop', THEME = 'dark', STEPS_FILE] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const phone = MODE === 'phone';
const DEFAULT = [
  ['home', `setActiveTab('home')`, 2500],
  ['social', `setActiveTab('social')`, 2500],
  ['feed', `setActiveTab('feed')`, 2500],
  ['chat', `setActiveTab('chat')`, 1500],
  ['music-home', `setActiveTab('music')`, 4000],
  ['music-albums', `document.querySelector('.picker-tab[data-tab="albums"]').click()`, 4000],
  ['music-artists', `document.querySelector('.picker-tab[data-tab="artists"]').click()`, 3500],
  ['music-songs', `document.querySelector('.picker-tab[data-tab="songs"]').click()`, 4000],
  ['music-favorites', `document.querySelector('.picker-tab[data-tab="favorites"]').click()`, 2000],
  ['music-genres', `document.querySelector('.picker-tab[data-tab="genres"]').click()`, 3000],
  ['music-playlists', `document.querySelector('.picker-tab[data-tab="playlists"]').click()`, 2500],
  ['music-radio', `document.querySelector('.picker-tab[data-tab="radio"]').click()`, 2500],
  ['music-activity', `document.querySelector('.picker-tab[data-tab="activity"]').click()`, 2500],
  ['album-page', `document.querySelector('.picker-tab[data-tab="albums"]').click(); setTimeout(() => document.querySelector('#pickerList .picker-item, #pickerList [data-album-id]')?.click(), 2500)`, 5000],
  ['photos', `closeApPanel?.(); setActiveTab('photos')`, 3500],
  ['videos', `setActiveTab('videos')`, 2500],
  ['settings', `openSettings()`, 1500],
  ['profile', `document.querySelector('#settingsBackdrop')?.classList.remove('open'); closeSettings?.(); openProfileView('alice')`, 2000],
];
const STEPS = STEPS_FILE ? JSON.parse(readFileSync(STEPS_FILE, 'utf8')) : DEFAULT;

const port = 10000 + Math.floor(Math.random() * 40000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = phone ? 390 : 1600, H = phone ? 844 : 1000;
const chrome = spawn(process.env.CHROME || 'chromium', ['--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ks-'))}`, `--window-size=${W},${H}`, '--no-first-run',
  '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0;
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result.value;
};
try {
  let target;
  for (let n = 0; n < 40 && !target; n++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n').slice(0, 3).join(' | ') || d.params.exceptionDetails.text);
  };
  await send('Runtime.enable'); await send('Page.enable');
  if (phone) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.open = () => null; try { localStorage.setItem('klabnet_theme', '${THEME}'); } catch {}` });
  await send('Page.navigate', { url: '' + (process.env.RIG || 'http://localhost:8791') + '/#home' });
  await sleep(5000);
  for (const [name, js, wait] of STEPS) {
    const r = await ev(js);
    console.log('['+name+']', JSON.stringify(r));
    await sleep(wait || 1500);
    if (!name.startsWith('shot')) continue; const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
  }
  const errs = [...new Set(errors)].filter(e => !/Failed to load resource|net::|esm\.sh/.test(e));
  console.log('done', STEPS.length, 'shots in', OUT, errs.length ? '\nERRORS:\n' + errs.join('\n') : '(no page errors)');
} catch (e) { console.error('DRIVER', e); }
finally { try { chrome.kill('SIGKILL'); } catch {} process.exit(0); }
