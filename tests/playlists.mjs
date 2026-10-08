// node tests/playlists.mjs [--url=http://localhost:8791/] [--out=dir]
// Playlists, end to end, in headless Chrome against the local API (the rig
// in AGENTS.md, with the `x-dev-user` header and `?u=` from tests/README.md
// "Voice"): making one, its cover and details, adding, reordering and
// removing songs, featuring, another person saving it and adding to it,
// Back/Forward, playlists brought over from prefs, and an API from before
// playlists. Reads the real Navidrome library; never plays anything.
// It deletes the playlists of the users it runs as (tester, alice).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const BASE = args.url || 'http://localhost:8791/';
const out = args.out || mkdtempSync(join(tmpdir(), 'klabnet-playlists-'));
mkdirSync(out, { recursive: true });
const port = 10000 + Math.floor(Math.random() * 40000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'), [
  '--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'klabnet-playlists-profile-'))}`,
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
  const init = extra => send('Page.addScriptToEvaluateOnNewDocument', { source: `window.open = () => null;
    localStorage.removeItem('klabnet_matrix_session'); localStorage.removeItem('klabnet_login_song');
    localStorage.setItem('klabnet_settings', JSON.stringify({loginSong:false,sfxEnabled:false}));` + (extra || '') });
  await init();
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const ev = async expression => {
    const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || d.result.exceptionDetails.text);
    return d.result.result.value;
  };
  const shot = async name => { const d = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, name + '.png'), Buffer.from(d.result.data, 'base64')); };
  const until = async (expression, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await ev(expression); if (v) return v; await sleep(120); } return v; };
  const goto = async (user = 'tester') => {
    await send('Page.navigate', { url: `${BASE}?u=${user}` });
    await sleep(3500);
    await ev(`setActiveTab('music'); ensureMusicTabLoaded()`);
    await until(`_plServer !== null`);
  };
  // Page helpers: the API as someone else, typing into a field, a drag.
  const HELP = `
    window.T = {
      api: (user, path, opts = {}) => fetch('/api/music-requests/playlists' + path, { ...opts, headers: { 'x-dev-user': user, ...(typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}) } }).then(r => r.json()),
      async wipe(...users) { for (const u of users) for (const p of (await T.api(u, '')).playlists) if (p.mine) await T.api(u, '/' + p.id, { method: 'DELETE' }); },
      find: async q => (await (await fetch(ND_URL + '/rest/search3?query=' + encodeURIComponent(q) + '&songCount=10&albumCount=0&artistCount=0&' + subsonicParams())).json())['subsonic-response'].searchResult3.song || [],
      type(el, text) { el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); },
      rows: () => [...document.querySelectorAll('#apScroll .pl-tracks .ap-track')],
      titles: () => T.rows().map(r => r.querySelector('.ap-track-title').textContent),
      drag(from, to, after) {
        const rows = T.rows(), a = rows[from], b = rows[to], dt = new DataTransfer(), r = b.getBoundingClientRect();
        const y = after ? r.bottom - 2 : r.top + 2;
        a.querySelector('.pl-grip').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      },
      sidebar: () => [...document.querySelectorAll('.music-playlist-row')].map(r => r.querySelector('.music-playlist-row-name').textContent + ' | ' + r.querySelector('.music-playlist-row-meta').textContent.trim()),
      modal: () => document.getElementById('chatModalBackdrop').classList.contains('open'),
      hero: () => ({ kicker: document.querySelector('#apScroll .ap-hero-kicker')?.textContent, name: document.querySelector('#apScroll .ap-hero-name')?.textContent, sub: document.querySelector('#apScroll .ap-hero-sub')?.textContent }),
      btn: label => [...document.querySelectorAll('#apScroll .ap-actions button')].find(b => b.textContent.trim() === label),
    };`;
  const help = () => ev(HELP);

  // ── Making one ──
  await goto(); await help();
  await ev(`T.wipe('tester', 'alice')`);
  await ev(`plRefresh()`);
  check('starts with no playlists, on the API', await ev(`_plServer === true && T.sidebar().length === 0`));
  await ev(`document.getElementById('musicNewPlaylistBtn').click()`);
  await until(`T.modal()`);
  await ev(`document.getElementById('plEditSave').click()`);
  check('a playlist needs a name', await ev(`!document.getElementById('plEditError').hidden && T.modal()`));
  await ev(`T.type(document.getElementById('plEditName'), 'Road trip')`);
  await ev(`document.getElementById('plEditSave').click()`);
  await until(`!T.modal() && document.querySelector('#apScroll .ap-hero-name')`);
  check('created, and its page opens', await ev(`T.hero().name === 'Road trip' && T.hero().kicker === 'Private playlist'`), await ev(`T.hero()`));
  check('it is in the sidebar, lit', await ev(`T.sidebar()[0] === 'Road trip | 0 songs' && document.querySelector('.music-playlist-row.active .music-playlist-row-name')?.textContent === 'Road trip' && !document.querySelector('.picker-tab.active')`), await ev(`T.sidebar()`));
  const id = await ev(`_pls[0].id`);

  // ── Songs: find, add, reorder, remove ──
  await ev(`T.type(document.querySelector('.pl-find input'), 'love')`);
  await until(`document.querySelectorAll('.pl-find-row').length >= 4`);
  for (let i = 0; i < 4; i++) { await ev(`document.querySelectorAll('.pl-find-row')[${i}].click()`); await until(`T.rows().length === ${i + 1}`); }
  check('four songs added from the search', await ev(`T.rows().length === 4 && T.hero().sub.startsWith('4 songs')`), await ev(`T.hero()`));
  check('its cover is made from what\'s in it', await ev(`document.querySelectorAll('#apScroll .ap-hero-img img').length >= 1`));
  check('added ones say so and can\'t be added twice', await ev(`document.querySelectorAll('.pl-find-row')[0].querySelector('.pl-find-add').disabled`));
  const before = await ev(`T.titles()`);
  await ev(`T.drag(0, 2, true)`);
  await sleep(600);
  const moved = await ev(`T.titles()`);
  check('dragging a song moves it', JSON.stringify(moved) === JSON.stringify([before[1], before[2], before[0], before[3]]), { before, moved });
  check('the new order is saved', JSON.stringify(await ev(`T.api('tester', '/${id}').then(p => p.songs.map(s => s.title))`)) === JSON.stringify(moved));
  await ev(`T.rows()[1].querySelector('.pl-track-x').click()`);
  await sleep(600);
  check('a song can be taken out', await ev(`T.rows().length === 3`) && (await ev(`T.api('tester', '/${id}').then(p => p.count)`)) === 3);
  await until(`T.sidebar()[0] === 'Road trip | 3 songs'`, 4000);
  check('the sidebar follows', await ev(`T.sidebar()[0]`) === 'Road trip | 3 songs', await ev(`T.sidebar()`));

  // ── Details: description, colour, a made cover, featuring ──
  await ev(`T.btn('Edit').click()`);
  await until(`T.modal()`);
  await ev(`T.type(document.getElementById('plEditName'), 'Road trip 🚗'); T.type(document.getElementById('plEditDesc'), 'Snacks in the back.\\nhttps://klab.gg')`);
  await ev(`document.querySelector('#plEditColors [data-color="#f76b15"]').click()`);
  await ev(`document.getElementById('plEditMake').click(); T.type(document.getElementById('plEditMakeText'), '🚗')`);
  check('the made cover previews', await ev(`!!document.querySelector('#plEditCover canvas') && !document.getElementById('plEditNoCover').hidden`));
  check('others can only be let in once it\'s featured', await ev(`document.getElementById('plEditCollab').disabled`));
  await ev(`document.getElementById('plEditFeatured').click(); document.getElementById('plEditCollab').click()`);
  await sleep(400); await shot('editor');
  await ev(`document.getElementById('plEditSave').click()`);
  await until(`!T.modal()`);
  await until(`document.querySelector('#apScroll .ap-hero-img img')`);
  const saved = await ev(`T.api('tester', '/${id}')`);
  check('details saved', saved.name === 'Road trip 🚗' && saved.color === '#f76b15' && saved.featured && saved.collab && saved.cover.length === 16 && saved.description.includes('Snacks'), saved);
  check('the page shows them', await ev(`T.hero().kicker === 'Featured playlist · open to additions' && !!document.querySelector('#apScroll .pl-desc a') && document.querySelector('#apScroll .pl-page').classList.contains('tinted') && !!T.btn('Featured')`), await ev(`T.hero()`));
  check('the cover is served', await ev(`fetch('/api/music-requests/playlists/covers/${saved.cover}/s').then(r => r.ok && r.headers.get('content-type') === 'image/jpeg')`));
  await sleep(500); await shot('page-mine');

  // ── A picture for a cover, through the cropper ──
  await ev(`T.btn('Edit').click()`);
  await until(`T.modal()`);
  await ev(`(async () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
    const g = c.getContext('2d'); g.fillStyle = '#123'; g.fillRect(0, 0, 1600, 900); g.fillStyle = '#e44'; g.fillRect(600, 250, 400, 400);
    const file = new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'pic.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('plEditFile'); input.files = dt.files; input.dispatchEvent(new Event('change'));
  })()`);
  await until(`document.getElementById('imgCropUse')`);
  check('the cropper is square', await ev(`(() => { const r = document.querySelector('.img-crop-stage').getBoundingClientRect(); return Math.abs(r.width - r.height) < 1 && r.width > 100; })()`));
  await sleep(300); await shot('cropper');
  await ev(`document.getElementById('imgCropUse').click()`);
  await until(`document.querySelector('#plEditCover img')`);
  await ev(`document.getElementById('plEditSave').click()`);
  await until(`!T.modal()`);
  const pic = await ev(`T.api('tester', '/${id}')`);
  check('an uploaded picture replaces the made cover', pic.cover.length === 16 && pic.cover !== saved.cover && (await ev(`fetch('/api/music-requests/playlists/covers/${saved.cover}/s', { cache: 'no-store' }).then(r => r.status)`)) === 404, pic.cover);
  check('and is cropped from the middle, not squashed', await ev(`(async () => {
    const img = new Image(); img.src = '/api/music-requests/playlists/covers/${pic.cover}/s'; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 300; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = (x, y) => g.getImageData(x, y, 1, 1).data;
    // the red square was 400 of 900 tall: 133 of 300 here, centred
    return img.naturalWidth === 300 && px(150, 150)[0] > 180 && px(150, 70)[0] < 80 && px(70, 150)[0] < 80 && px(150, 95)[0] > 180 && px(95, 150)[0] > 180;
  })()`));

  // ── Someone else: sees it, saves it, adds to it ──
  const theirs = await ev(`T.find('night').then(s => s.slice(0, 2))`);
  const added = await ev(`T.api('alice', '/${id}/songs', { method: 'POST', body: JSON.stringify({ songs: ${JSON.stringify(theirs)} }) })`);
  check('alice can add to an open playlist', added.added === 2, added);
  await ev(`plRefresh()`);
  await until(`T.rows().length === 5`);
  check('her songs show up on the open page, marked', await ev(`T.rows().length === 5 && document.querySelectorAll('#apScroll .pl-added-by').length === 2`));
  const al = await ev(`T.api('alice', '', { method: 'POST', body: JSON.stringify({ name: 'Alice mix', featured: true, songs: ${JSON.stringify(theirs)} }) })`);
  await ev(`plRefresh()`);
  await ev(`document.querySelector('[data-tab="random"]').click()`);
  await until(`document.querySelectorAll('#pickerList .mh-slot .mh-card').length === 2`);
  check('Home has a shelf of featured playlists', await ev(`document.querySelector('#pickerList .mh-slot .picker-section-label').textContent.startsWith('Featured playlists')`));
  await ev(`document.querySelector('[data-tab="playlists"]').click()`);
  await until(`document.querySelectorAll('#pickerList .pl-tile').length === 2`);
  check('Browse lists featured and yours', await ev(`[...document.querySelectorAll('#pickerList .picker-section-label')].map(l => l.textContent).join() === 'Featured,Yours' && document.getElementById('musicViewTitle').textContent === 'Playlists'`));
  await shot('browse');
  await ev(`document.querySelector('#pickerList .pl-tile').click()`);
  await until(`T.hero().name === 'Alice mix'`);
  // The rig in AGENTS.md makes everyone an admin, and an admin can edit anyone's.
  if (await ev(`!!window.KLAB_USER.is_admin`)) check('someone else\'s page, as an admin: Save, and the owner\'s controls', await ev(`!!T.btn('Edit') && !!T.btn('Save')`));
  else check('someone else\'s page: no editing', await ev(`!T.btn('Edit') && !document.querySelector('#apScroll .pl-grip') && !document.querySelector('#apScroll .pl-track-x') && document.querySelector('#apScroll .pl-find').hidden && !!T.btn('Save')`));
  await ev(`T.btn('Save').click()`);
  await until(`T.sidebar().length === 2`);
  check('saving puts it in the sidebar', await ev(`T.sidebar()[1] === 'Alice mix | alice · 2 songs' && !!T.btn('Saved')`), await ev(`T.sidebar()`));
  await shot('page-theirs');

  // ── Add to playlist, from a song ──
  await ev(`document.querySelector('[data-tab="songs"]').click()`);
  await until(`document.querySelector('#pickerList .picker-item [data-add-pl]')`);
  await ev(`document.querySelector('#pickerList .picker-item [data-add-pl]').click()`);
  await until(`document.querySelectorAll('#choiceDialogList .chat-modal-row').length >= 2`);
  check('the chooser offers a new one and yours, not alice\'s closed one', await ev(`[...document.querySelectorAll('#choiceDialogList .chat-modal-row-name')].map(n => n.textContent).join() === 'New playlist…,Road trip 🚗'`), await ev(`[...document.querySelectorAll('#choiceDialogList .chat-modal-row-name')].map(n => n.textContent)`));
  await ev(`document.querySelectorAll('#choiceDialogList .chat-modal-row')[1].click()`);
  await sleep(800);
  check('the song went in', (await ev(`T.api('tester', '/${id}').then(p => p.count)`)) === 6);

  // ── Back and Forward ──
  await ev(`document.querySelector('[data-tab="albums"]').click()`); await sleep(1200);
  await ev(`document.querySelector('.music-playlist-row').click()`);
  await until(`T.hero().name === 'Road trip 🚗'`);
  await ev(`history.back()`); await sleep(900);
  check('Back closes the page onto Albums', await ev(`!document.getElementById('apPanel').classList.contains('open') && document.querySelector('.picker-tab.active')?.dataset.tab === 'albums' && !document.querySelector('.music-playlist-row.active')`));
  await ev(`history.forward()`);
  await until(`document.getElementById('apPanel').classList.contains('open') && T.hero().name === 'Road trip 🚗'`);
  check('Forward opens it again', await ev(`document.querySelector('.music-playlist-row.active .music-playlist-row-name')?.textContent === 'Road trip 🚗'`));

  // ── Unfeaturing and deleting ──
  await ev(`T.btn('Featured').click()`);
  await until(`T.hero().kicker === 'Private playlist'`);
  check('unfeatured: alice can\'t see it', (await ev(`T.api('alice', '/${id}')`)).error === 'not found');
  await ev(`document.querySelector('.music-playlist-row .music-playlist-row-del').click()`);
  await until(`document.getElementById('confirmDialogOk')`);
  await ev(`document.getElementById('confirmDialogOk').click()`);
  await until(`T.sidebar().length === 1`);
  check('deleted: gone from the sidebar, and its page says so', await ev(`T.sidebar()[0].startsWith('Alice mix') && !!document.querySelector('#apScroll .ap-error')`), await ev(`T.sidebar()`));
  await ev(`T.api('alice', '/${al.id}', { method: 'DELETE' })`);
  await ev(`plRefresh()`);
  check('a saved playlist its owner deleted leaves the sidebar', await ev(`T.sidebar().length === 0`));

  // ── Playlists from prefs are brought over, once ──
  const songs = await ev(`T.find('sun').then(s => s.slice(0, 3))`);
  const legacy = JSON.stringify([{ id: String(Date.now()), name: 'From before', songs, created: new Date().toISOString() }]);
  await ev(`localStorage.setItem('klabnet_playlists', ${JSON.stringify(legacy)})`);
  await goto(); await help();
  await until(`T.sidebar().length === 1`);
  check('brought over from prefs', await ev(`T.sidebar()[0] === 'From before | 3 songs' && localStorage.getItem('klabnet_playlists') === '[]'`), await ev(`T.sidebar()`));
  await ev(`localStorage.setItem('klabnet_playlists', ${JSON.stringify(legacy)})`); // another device still holding the old list
  await goto(); await help();
  await sleep(800);
  check('not brought over twice', await ev(`T.sidebar().length === 1 && localStorage.getItem('klabnet_playlists') === '[]'`), await ev(`T.sidebar()`));
  await ev(`T.wipe('tester')`);
  await ev(`localStorage.setItem('klabnet_playlists', ${JSON.stringify(legacy)})`);
  await goto(); await help();
  await sleep(800);
  check('one deleted since doesn\'t come back', await ev(`T.sidebar().length === 0`), await ev(`T.sidebar()`));

  // ── An API from before playlists: they stay in the browser, as before ──
  await init(`{ const f = window.fetch; window.fetch = (u, o) => String(u).startsWith('/api/music-requests/playlists')
      ? Promise.resolve(new Response('{"detail":"Method Not Allowed"}', { status: 405 })) : f(u, o);
    localStorage.removeItem('klabnet_pl_cache'); }`);
  await ev(`localStorage.setItem('klabnet_playlists', ${JSON.stringify(legacy)})`);
  await goto(); await help();
  check('old API: the prefs list is the list', await ev(`_plServer === false && T.sidebar()[0] === 'From before | 3 songs'`), await ev(`T.sidebar()`));
  await ev(`document.querySelector('.music-playlist-row').click()`);
  await until(`T.rows().length === 3`);
  check('old API: its page works, without the new parts', await ev(`T.hero().kicker === 'Playlist' && !T.btn('Feature') && !!T.btn('Edit') && !!document.querySelector('#apScroll .pl-grip')`), await ev(`T.hero()`));
  await ev(`T.rows()[0].querySelector('.pl-track-x').click()`); await sleep(400);
  await ev(`T.btn('Edit').click()`); await until(`T.modal()`);
  check('old API: the editor is just the name', await ev(`!document.getElementById('plEditDesc') && !document.getElementById('plEditCover')`));
  await ev(`T.type(document.getElementById('plEditName'), 'Renamed'); document.getElementById('plEditSave').click()`);
  await until(`!T.modal()`);
  check('old API: changes are kept in prefs', await ev(`(() => { const p = JSON.parse(localStorage.getItem('klabnet_playlists'))[0]; return p.name === 'Renamed' && p.songs.length === 2 && T.sidebar()[0] === 'Renamed | 2 songs'; })()`), await ev(`localStorage.getItem('klabnet_playlists').slice(0, 200)`));
  await ev(`localStorage.setItem('klabnet_playlists', '[]')`);

  check('no script errors', !exceptions.length, exceptions);
  console.log(fails.length ? `FAILED ${fails.length}: ${fails.join('; ')}` : 'PASS playlists; screenshots: ' + out);
  if (fails.length) process.exitCode = 1;
} catch (error) { console.error(error); if (exceptions.length) console.error(exceptions.join('\n')); process.exitCode = 1; }
finally {
  ws?.close();
  if (chrome.pid) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    else chrome.kill();
  }
}
