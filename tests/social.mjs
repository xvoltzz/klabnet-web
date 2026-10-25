// node tests/social.mjs [--url=http://localhost:8791/] [--out=dir]
// Social: Feed, Chat and Photos as one page with one sidebar. Checks the
// app's nav (one Social button, lit on all four, back to where you were),
// the sidebar (its rows, Photos' order switch and Slideshow in its head,
// what lights up where, the same width on every page), Back and Forward
// between the four, the sidebar button, Tab and the number keys, Social's
// home (new photos, latest posts) and the phone's chips. Needs the rig in
// AGENTS.md with a few posts and photos; it only reads.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const BASE = args.url || 'http://localhost:8791/';
const out = args.out || mkdtempSync(join(tmpdir(), 'klabnet-social-'));
mkdirSync(out, { recursive: true });
const port = 10000 + Math.floor(Math.random() * 40000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'), [
  '--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'klabnet-social-profile-'))}`,
  '--window-size=1600,1000', '--no-first-run', '--hide-scrollbars', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

const fails = [];
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  ' + JSON.stringify(detail) : '')); if (!ok) fails.push(name); };
const exceptions = [];
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
  let nextId = 0; const pending = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
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
  const key = async k => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: k === 'Tab' ? 'Tab' : 'Digit' + k, windowsVirtualKeyCode: k === 'Tab' ? 9 : 48 + +k }); };
  const at = () => ev(`document.querySelector('.tab-panel.active')?.dataset.tabPanel`);
  const state = () => ev(`({
    tab: document.querySelector('.tab-panel.active')?.dataset.tabPanel,
    nav: [...document.querySelectorAll('.tab-nav-btn.active')].map(b => b.dataset.tabTarget),
    row: [...document.querySelectorAll('#socNav .picker-tab.active')].filter(b => b.offsetParent).map(b => b.dataset.soc),
    side: Math.round(document.getElementById('socSidebar').getBoundingClientRect().width),
    left: Math.round(document.getElementById('socMain').getBoundingClientRect().left),
  })`);

  await send('Page.navigate', { url: BASE + '#home' });
  await sleep(4000);

  // ── The app's nav ──
  check('the nav is Home, Social, Music, Games', JSON.stringify(await ev(`[...document.querySelectorAll('#tabNav .tab-nav-btn')].filter(b => !b.hidden).map(b => b.dataset.tabTarget)`)) === '["home","social","music","games"]');
  await ev(`localStorage.removeItem('klabnet_social_last'); document.querySelector('.tab-nav-btn[data-tab-target="social"]').click()`);
  await sleep(600);
  check('Social lands on its home', (await at()) === 'social', await state());
  const widths = new Set(), lefts = new Set();
  for (const t of ['social', 'feed', 'photos', 'chat']) {
    await ev(`setActiveTab('${t}')`); await sleep(500);
    const s = await state();
    widths.add(s.side); lefts.add(s.left);
    check(`${t}: the Social button is lit, and only it`, JSON.stringify(s.nav) === '["social"]', s);
    check(`${t}: its sidebar row is lit`, t === 'chat' ? s.row.length === 0 : JSON.stringify(s.row) === `["${t}"]`, s);
    check(`${t}: the hash says where`, (await ev('location.hash')) === '#' + t);
  }
  check('the sidebar is the same width on all four, and the page beside it starts at the same place', widths.size === 1 && lefts.size === 1, { widths: [...widths], lefts: [...lefts] });

  await ev(`setActiveTab('feed')`); await sleep(300);
  await ev(`document.querySelector('.tab-nav-btn[data-tab-target="music"]').click()`); await sleep(500);
  await ev(`document.querySelector('.tab-nav-btn[data-tab-target="social"]').click()`); await sleep(500);
  check('Social goes back to the page you were on', (await at()) === 'feed');
  await ev(`document.querySelector('.tab-nav-btn[data-tab-target="social"]').click()`); await sleep(500);
  check('...and pressed again, to its home', (await at()) === 'social');

  // ── The sidebar ──
  await ev(`document.querySelector('#socNav [data-soc="feed"]').click()`); await sleep(500);
  check('the Feed row goes to Feed', (await at()) === 'feed');
  check('the photo details are Photos only', await ev(`getComputedStyle(document.querySelector('#phSidebar .ph-side-this')).display === 'none' && getComputedStyle(document.getElementById('phNow')).display === 'none'`));
  await ev(`document.querySelector('#socNav [data-soc="photos"]').click()`); await sleep(800);
  check('the Photos row goes to Photos', (await at()) === 'photos');
  check('on Photos its details show', await ev(`getComputedStyle(document.querySelector('#phSidebar .ph-side-this')).display !== 'none'`));
  check('the timeline\'s filmstrip is there', await until(`document.querySelectorAll('#phStrip img, #phStrip .ph-thumb').length > 0`));
  check('Timeline / What\'s new, Slideshow and Post are in Photos\' head', await ev(`['phOrder', 'phSlideBtn', 'phPostBtn'].every(id => document.getElementById(id).parentElement.id === 'phViewTools' && !!document.getElementById(id).offsetParent)`));
  await ev(`document.querySelector('#phOrder button[data-order="posted"]').click()`); await sleep(900);
  check('the switch\'s pill slides to What\'s new', await ev(`(() => { const p = document.querySelector('#phOrder .motion-pill').getBoundingClientRect(), b = document.querySelector('#phOrder [data-order="posted"]').getBoundingClientRect(); return Math.abs(p.left - b.left) < 2 && Math.abs(p.width - b.width) < 2; })()`));
  await ev(`document.querySelector('#phOrder button[data-order="shot"]').click()`); await sleep(500);
  await ev(`document.getElementById('phSlideBtn').click()`); await sleep(800);
  check('Slideshow is a toggle: lit while it runs', await ev(`klabSlideshow.isOpen() && document.getElementById('phSlideBtn').getAttribute('aria-pressed') === 'true'`));
  await ev(`klabSlideshow.close()`); await sleep(600);
  check('...and not after', await ev(`!klabSlideshow.isOpen() && document.getElementById('phSlideBtn').getAttribute('aria-pressed') === 'false'`));
  check('on Photos, Chat and Online now step aside', await ev(`!document.getElementById('chatSide').offsetParent`));
  await ev(`document.querySelector('#socNav [data-soc="social"]').click()`); await sleep(600);
  check('chat not signed in: "Connect chat", no lists, no Online now', await ev(`!document.body.classList.contains('chat-on') && !!document.getElementById('socChatConnect').offsetParent && !document.getElementById('chatChannelsList').offsetParent && !document.getElementById('presenceList').offsetParent`));
  await ev(`document.getElementById('socChatConnect').click()`); await sleep(500);
  check('"Connect chat" goes to Chat', (await at()) === 'chat');
  await shot('chat');

  // ── Back and Forward between the four ──
  await ev(`setActiveTab('social')`); await sleep(300);
  await ev(`setActiveTab('feed')`); await sleep(300);
  await ev(`setActiveTab('photos')`); await sleep(300);
  await ev('history.back()'); await sleep(600);
  check('Back from Photos is Feed', (await at()) === 'feed', await at());
  await ev('history.back()'); await sleep(600);
  check('...then Social\'s home', (await at()) === 'social', await at());
  await ev('history.forward()'); await sleep(600);
  check('Forward is Feed again', (await at()) === 'feed', await at());

  // ── Scrolling and the sidebar button ──
  check('Feed scrolls in its page, not the window', await ev(`(() => { const p = document.querySelector('.tab-panel[data-tab-panel="feed"]'); return getComputedStyle(p).overflowY === 'auto' && document.documentElement.scrollHeight <= innerHeight + 1; })()`));
  await ev(`document.querySelector('.tab-panel[data-tab-panel="feed"]').scrollTop = 300`);
  await ev(`setActiveTab('photos')`); await sleep(300); await ev(`setActiveTab('feed')`); await sleep(300);
  check('...and keeps its place across pages', (await ev(`document.querySelector('.tab-panel[data-tab-panel="feed"]').scrollTop`)) === 300);
  check('the header\'s sidebar button is there on Social', await ev(`!document.getElementById('paneToggle').hidden`));
  await ev(`window.klabPane.hide('social')`); await sleep(700);
  check('it hides the sidebar', await ev(`document.documentElement.classList.contains('pane-off-social') && getComputedStyle(document.getElementById('socSidebar')).display === 'none'`));
  await ev(`window.klabPane.show('social')`); await sleep(700);
  check('...and brings it back', await ev(`getComputedStyle(document.getElementById('socSidebar')).display !== 'none'`));

  // ── Keys ──
  await ev(`setActiveTab('home'); document.activeElement?.blur()`); await sleep(300);
  await key('Tab'); await sleep(400);
  check('Tab from Home goes to Social, where you were', (await at()) === 'feed', await at());
  await key('Tab'); await sleep(400);
  check('...and Tab again to Music', (await at()) === 'music', await at());
  await key('2'); await sleep(400);
  check('2 is Social', (await at()) === 'feed', await at());
  // W/S and ↑/↓: the rows of the page's sidebar.
  const press = async (k, code, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && k.length === 1 ? { text: k } : {}) }); await sleep(450); };
  await press('s', 'KeyS', 83);
  check('s is the next row: Feed to Photos', (await at()) === 'photos', await at());
  await press('w', 'KeyW', 87);
  check('...w the one before', (await at()) === 'feed', await at());
  await press('ArrowUp', 'ArrowUp', 38);
  check('↑ as well: up to Social\'s home', (await at()) === 'social', await at());
  await press('ArrowDown', 'ArrowDown', 40);
  check('...and ↓ back to Feed', (await at()) === 'feed', await at());
  await ev(`setActiveTab('music'); document.activeElement?.blur()`); await sleep(500);
  const mRow = () => ev(`document.querySelector('#musicShell .picker-tab[data-tab].active')?.dataset.tab`);
  const m0 = await mRow();
  await press('s', 'KeyS', 83);
  const m1 = await mRow();
  check('in Music, s goes down its sidebar', m1 && m1 !== m0 && (await at()) === 'music', [m0, m1]);
  await press('w', 'KeyW', 87);
  check('...and w back up', (await mRow()) === m0, await mRow());
  await ev(`setActiveTab('feed')`); await sleep(400);

  // ── Social's home ──
  await ev(`setActiveTab('social')`);
  check('new photos in a collage', await until(`document.querySelectorAll('#socHomeBody .soc-collage .soc-tile:not(.off)').length > 0`, 8000));
  check('the latest posts in a row', await until(`document.querySelectorAll('#socHomeBody .soc-post').length > 0`, 8000));
  await sleep(800);
  await shot('home');
  const first = await ev(`+document.querySelector('#socHomeBody .soc-post').dataset.post`);
  await ev(`document.querySelector('#socHomeBody .soc-post').click()`); await sleep(1200);
  check('a post card opens it in Feed', (await at()) === 'feed' && await ev(`!!document.querySelector('#feedList .feed-post[data-post-id="${first}"]')`));
  await ev(`setActiveTab('social')`); await sleep(600);
  await ev(`document.querySelector('#socHomeBody .soc-tile:not(.off)').click()`); await sleep(1200);
  check('a photo\'s Open goes to it in Photos', (await at()) === 'photos');

  // ── A phone ──
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await ev(`setActiveTab('feed')`); await sleep(500);
  check('phone: the pages are chips along the top', await ev(`(() => { const r = [...document.querySelectorAll('#socNav .picker-tab')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().top); return r.length === 4 && new Set(r.map(Math.round)).size === 1; })()`));
  check('phone: no chat list on Feed', await ev(`!document.getElementById('chatSide').offsetParent`));
  await ev(`document.querySelector('#socNav [data-soc="chat"]').click()`); await sleep(600);
  check('phone: the Chat chip shows the list first', (await at()) === 'chat' && await ev(`document.body.classList.contains('chat-rooms-view') && !!document.getElementById('chatSide').offsetParent`));
  await shot('phone-chat');

  check('no script errors', !exceptions.length, exceptions);
  console.log(fails.length ? `FAILED ${fails.length}: ${fails.join('; ')}` : 'PASS social; screenshots: ' + out);
  if (fails.length) process.exitCode = 1;
} catch (error) { console.error(error); if (exceptions.length) console.error(exceptions.join('\n')); process.exitCode = 1; }
finally {
  ws?.close();
  if (chrome.pid) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    else chrome.kill();
  }
}
