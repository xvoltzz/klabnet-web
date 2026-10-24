// node tests/feed.mjs [--url=http://localhost:8791/] [--out=dir]
// Feed loading and replies, in headless Chrome against the local API (the
// rig in AGENTS.md, with the `x-dev-user` header): a first load that fails
// comes back on its own within seconds, typing survives a poll, and replies
// other people send while you're in a reply box show up. It writes posts
// and replies as tester, alice, bob and carol, so use a throwaway database.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const BASE = args.url || 'http://localhost:8791/';
const out = args.out || mkdtempSync(join(tmpdir(), 'klabnet-feed-'));
mkdirSync(out, { recursive: true });
const port = 10000 + Math.floor(Math.random() * 40000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'), [
  '--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'klabnet-feed-profile-'))}`,
  '--window-size=1600,1000', '--no-first-run', '--hide-scrollbars', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

const fails = [];
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  ' + JSON.stringify(detail) : '')); if (!ok) fails.push(name); };
const exceptions = [];
// As someone else, straight to the API.
const api = (user, path, body) => fetch(new URL(path, BASE), {
  method: body ? 'POST' : 'GET', headers: { 'x-dev-user': user, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
}).then(r => r.json());
let ws;
try {
  let target;
  for (let n = 0; n < 40 && !target; n++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 0; const pending = new Map(); const listeners = new Set();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    listeners.forEach(fn => fn(d.method, d.params));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, d => { clearTimeout(timer); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.open = () => null;
    localStorage.removeItem('klabnet_matrix_session'); localStorage.removeItem('klabnet_login_song');
    localStorage.setItem('klabnet_settings', JSON.stringify({loginSong:false,sfxEnabled:false}));` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const ev = async expression => {
    const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || d.result.exceptionDetails.text);
    return d.result.result.value;
  };
  const shot = async name => { const d = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, name + '.png'), Buffer.from(d.result.data, 'base64')); };
  const until = async (expression, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await ev(expression); if (v) return v; await sleep(120); } return v; };
  const type = async text => send('Input.insertText', { text });
  const enter = async () => { for (const t of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
  // The 30s poll, now: coming back to the page fetches.
  const poll = () => ev(`document.dispatchEvent(new Event('visibilitychange'))`);
  const replies = id => ev(`[...document.querySelectorAll('.feed-post[data-post-id="${id}"] .feed-post-reply-text')].map(e => e.textContent.trim())`);

  for (const [u, t] of [['alice', 'feed test: one'], ['bob', 'feed test: two'], ['carol', 'feed test: three']]) await api(u, '/api/posts', { text: t });

  // ── A failed first load comes back on its own ──
  let failed = 0;
  listeners.add((method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    if (!failed++) send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
    else send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/posts?limit=*', requestStage: 'Request' }] });
  await send('Page.navigate', { url: BASE + '#feed' });
  check('a failed first load says so', await until(`document.querySelector('#feedList .feed-empty')?.textContent.startsWith('Couldn')`, 6000));
  check('...and loads by itself within seconds', await until(`document.querySelectorAll('#feedList .feed-post').length > 0`, 6000));
  await send('Fetch.disable');
  await sleep(800);

  // ── Typing survives a poll ──
  const top = await ev(`+document.querySelector('#feedList .feed-post').dataset.postId`);
  await ev(`document.querySelector('.feed-post[data-post-id="${top}"] .feed-post-reply-open').click()`);
  await sleep(200);
  await ev(`document.querySelector('.feed-post-reply-input[data-post-id="${top}"]').focus()`);
  await type('half a sente');
  await api('bob', '/api/posts', { text: 'feed test: bob posts while you type' });
  await api('carol', `/api/posts/${top}/replies`, { text: 'carol replied meanwhile' });
  await poll(); await sleep(1500);
  check('a reply being typed survives a poll', await ev(`document.activeElement?.classList.contains('feed-post-reply-input') && document.activeElement.value === 'half a sente'`),
    await ev(`({ cls: document.activeElement?.className, value: document.activeElement?.value })`));
  check('...and the new post came in above it', await ev(`document.querySelector('#feedList .feed-post .feed-post-text')?.textContent.includes('bob posts while you type')`));

  // ── Replies that came in while you typed show once you send ──
  await type('nce'); await enter();
  check('sending shows yours and the one sent meanwhile', await until(`(() => { const r = [...document.querySelectorAll('.feed-post[data-post-id="${top}"] .feed-post-reply-text')].map(e => e.textContent.trim()); return r.includes('carol replied meanwhile') && r.includes('half a sentence'); })()`, 5000), await replies(top));
  check('...and you stay in the reply box', await ev(`document.activeElement?.classList.contains('feed-post-reply-input')`));

  // ── Sitting in an empty reply box doesn't hold replies back ──
  await api('bob', `/api/posts/${top}/replies`, { text: 'bob replied to your open box' });
  await poll();
  check('a new reply shows while your empty box has focus', await until(`[...document.querySelectorAll('.feed-post[data-post-id="${top}"] .feed-post-reply-text')].some(e => e.textContent.includes('bob replied to your open box'))`, 5000), await replies(top));
  check('...and the box keeps the focus', await ev(`document.activeElement?.classList.contains('feed-post-reply-input') && document.activeElement.dataset.postId === '${top}'`));
  await shot('replies');

  // ── The composer survives a poll ──
  await ev(`document.activeElement.blur(); document.getElementById('feedComposerText').focus()`);
  await type('drafting a post');
  await api('alice', '/api/posts', { text: 'feed test: alice posts during your draft' });
  await poll(); await sleep(1500);
  check('the composer keeps its draft and focus', await ev(`document.activeElement?.id === 'feedComposerText' && document.activeElement.value === 'drafting a post'`));
  await ev(`document.getElementById('feedComposerText').value = ''; document.getElementById('feedComposerText').dispatchEvent(new Event('input'))`);

  check('no script errors', !exceptions.length, exceptions);
  console.log(fails.length ? `FAILED ${fails.length}: ${fails.join('; ')}` : 'PASS feed; screenshots: ' + out);
  if (fails.length) process.exitCode = 1;
} catch (error) { console.error(error); if (exceptions.length) console.error(exceptions.join('\n')); process.exitCode = 1; }
finally {
  ws?.close();
  if (chrome.pid) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    else chrome.kill();
  }
}
