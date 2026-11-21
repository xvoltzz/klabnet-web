// ══════════════════════════════════════════
//  CHAT ADMIN (2026-11-21, the owner: "matrix room management needs some
//  HELP cuz i cant manage who sees what for shit and i cant see what
//  people create and thats a problem")
//  A sheet for klabnet's admins: every Matrix room on the server, newest
//  first, with who made it and when (the ones made since you last looked
//  are marked New), and beside the one picked: who can see it in plain
//  words, who can join, listed in Browse channels or not, what history a
//  newcomer reads, its people with their roles (invite, make a mod or an
//  admin, kick, ban), make yourself an admin there, delete it.
//  klabnet-api routers/chat_admin.py does the Matrix side with a Synapse
//  server admin's token; it answers enabled: false to everyone else, and
//  then none of this shows. Ways in: Chat's Channels heading (the shield),
//  Settings → Admin, the recap's "carol made #hideout" rows (admins only).
//  window.klabChatAdmin: open(roomId?), enabled().
// ══════════════════════════════════════════
(function () {
  const API = '/api/posts/chat-admin';
  const SEEN_KEY = 'klabnet_chatadmin_seen';
  let on = false, rooms = [], sel = null, detail = null, filter = 'channel', q = '', sheet = null, pop = null, busy = false;
  let seen = 0;
  try { seen = +localStorage.getItem(SEEN_KEY) || 0; } catch (e) {}

  const enc = id => encodeURIComponent(id);
  async function api(path, opts) {
    const r = await fetchTimeout(API + path, opts ? { method: opts.method, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined } : {}, 30000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(klabCap(d.error) || 'Matrix said no (' + r.status + ')');
    return d;
  }
  const when = s => s ? new Date(s * 1000).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown';
  const ago = s => s ? (typeof klabRelativeTime === 'function' ? klabRelativeTime(s * 1000) : when(s)) : '';
  const roomName = r => r.name || r.alias || (r.kind === 'dm' ? 'Direct message' : 'Unnamed room');
  const JOIN = { public: 'Anyone on klab', invite: 'Invite only', knock: 'Ask to join' };

  // Who can see it, said plainly.
  function seesLine(r) {
    const who = r.joinRule === 'public' ? (r.listed ? 'Anyone on klab can find it in Browse channels and join' : 'Anyone on klab with the link can join (it isn’t listed)')
      : r.joinRule === 'knock' ? 'People can ask to join; someone inside lets them in'
      : 'Only people who are invited';
    const hist = r.history === 'joined' ? 'Newcomers only see messages from when they joined.'
      : r.history === 'invited' ? 'Newcomers see messages from when they were invited.'
      : 'Newcomers can read everything from before they joined.';
    return who + '. ' + hist;
  }

  // ── The sheet ──
  function build() {
    sheet = document.createElement('div');
    sheet.className = 'add-app-backdrop ca-back';
    sheet.innerHTML = '<div class="add-app-modal ca-sheet" role="dialog" aria-modal="true" aria-label="Chat rooms" tabindex="-1">' +
      '<div class="ca-head"><h2 class="ca-title">Chat rooms</h2><span class="ca-count" id="caCount"></span>' +
        '<button type="button" class="k-icon sm ca-refresh" title="Refresh" aria-label="Refresh"><i class="ti ti-refresh"></i></button>' +
        '<button type="button" class="k-icon sm ca-close" title="Close" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
      '<div class="ca-cols"><div class="ca-side">' +
        '<div class="k-field-box ca-find"><i class="ti ti-search"></i><input type="text" placeholder="Find a room or a person" aria-label="Find" autocomplete="off" spellcheck="false" /></div>' +
        '<div class="k-seg ca-seg" role="group" aria-label="Show">' +
          '<button type="button" data-f="channel" aria-pressed="true">Channels</button><button type="button" data-f="dm" aria-pressed="false">DMs</button>' +
          '<button type="button" data-f="space" aria-pressed="false">Spaces</button><button type="button" data-f="all" aria-pressed="false">All</button></div>' +
        '<div class="ca-list" role="listbox" aria-label="Rooms"></div></div>' +
      '<div class="ca-main"></div></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', onClick);
    sheet.addEventListener('contextmenu', onMenu);
    sheet.querySelector('.ca-find input').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); paintList(); });
    sheet.addEventListener('keydown', e => {
      if (!e.target.closest('.ca-list') || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const rows = [...sheet.querySelectorAll('.ca-row')];
      const i = rows.findIndex(r => r.dataset.id === sel);
      const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) { pick(n.dataset.id); n.focus(); }
    });
  }
  function open(roomId) {
    if (!on) return;
    if (!sheet) build();
    if (!sheet.classList.contains('open')) {
      sheet.classList.add('open');
      SFX?.play('sheet');
      pop = klabLayers.push(sheet, { kind: 'sheet', dim: true, close });
    }
    if (roomId) { const r = rooms.find(x => x.id === roomId); filter = r?.kind || 'all'; sel = roomId; }
    load(!!roomId).then(() => { if (sel) pick(sel, true); });
    paintList();
    paintMain();
  }
  function close() {
    if (!sheet?.classList.contains('open')) return;
    sheet.classList.remove('open');
    SFX?.play('sheet_close');
    pop?.(); pop = null;
    // What was here is seen now.
    seen = Math.floor(Date.now() / 1000);
    try { localStorage.setItem(SEEN_KEY, String(seen)); } catch (e) {}
    paintBadge();
  }

  async function load(fresh) {
    try {
      rooms = (await api('/rooms' + (fresh ? '?fresh=1' : ''))).rooms || [];
    } catch (e) {
      if (sheet) sheet.querySelector('.ca-list').innerHTML = '<p class="k-empty ca-empty">' + esc(e.message) + '</p>';
      return;
    }
    paintBadge();
    paintList();
  }

  function matches(r) {
    if (filter !== 'all' && r.kind !== filter) return false;
    if (!q) return true;
    return (roomName(r) + ' ' + r.alias + ' ' + r.creator).toLowerCase().includes(q);
  }
  function rowHTML(r) {
    const isNew = r.created > seen && r.kind !== 'dm';
    const lock = r.joinRule === 'public' ? 'ti-world' : r.joinRule === 'knock' ? 'ti-door-enter' : 'ti-lock';
    return '<button type="button" class="ca-row' + (r.id === sel ? ' on' : '') + '" role="option" aria-selected="' + (r.id === sel) + '" data-id="' + esc(r.id) + '">' +
      '<span class="ca-row-ico"><i class="ti ' + (r.kind === 'dm' ? 'ti-message-circle' : r.kind === 'space' ? 'ti-folders' : 'ti-hash') + '"></i></span>' +
      '<span class="ca-row-tx"><span class="ca-row-name">' + esc(roomName(r)) + (isNew ? '<span class="ca-new">New</span>' : '') + '</span>' +
      '<span class="ca-row-sub">' + (r.creator ? 'by ' + esc(r.creator) + ' · ' : '') + esc(ago(r.created)) + '</span></span>' +
      '<span class="ca-row-end"><i class="ti ' + lock + '" title="' + esc(JOIN[r.joinRule] || r.joinRule) + '"></i>' + (r.listed ? '<i class="ti ti-list-search" title="Listed in Browse channels"></i>' : '') +
      '<span title="People in it">' + r.members + '</span></span></button>';
  }
  function paintList() {
    if (!sheet) return;
    sheet.querySelectorAll('.ca-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
    const list = rooms.filter(matches);
    const fresh = rooms.filter(r => r.created > seen && r.kind !== 'dm').length;
    sheet.querySelector('#caCount').textContent = rooms.length ? rooms.length + ' rooms' + (fresh ? ' · ' + fresh + ' new' : '') : '';
    sheet.querySelector('.ca-list').innerHTML = list.length ? list.map(rowHTML).join('')
      : '<p class="k-empty ca-empty">' + (rooms.length ? 'Nothing matches' : 'Loading…') + '</p>';
  }

  async function pick(id, quiet) {
    sel = id;
    sheet?.querySelectorAll('.ca-row').forEach(r => { r.classList.toggle('on', r.dataset.id === id); r.setAttribute('aria-selected', String(r.dataset.id === id)); });
    if (!quiet) SFX?.play('click');
    detail = null;
    paintMain();
    try { detail = await api('/rooms/' + enc(id)); } catch (e) { detail = { error: e.message }; }
    if (sel === id) paintMain();
  }

  function personHTML(p) {
    const face = window.klabResolveUserAvatar?.(p.user);
    const col = typeof profileColor === 'function' ? profileColor(p.user) : 'var(--text)';
    const state = p.membership === 'invite' ? 'Invited' : p.membership === 'ban' ? 'Banned' : p.membership === 'knock' ? 'Asking to join' : '';
    const role = { owner: 'Owner', admin: 'Admin', mod: 'Mod', member: '' }[p.role];
    const acts = p.role === 'owner' || p.isAdminBot ? '' : p.membership === 'ban'
      ? '<button type="button" class="k-btn sm ghost" data-m="unban">Unban</button>'
      : (p.membership === 'knock' ? '<button type="button" class="k-btn sm" data-m="invite">Let in</button>' : '') +
        (p.membership === 'join' ? '<button type="button" class="k-btn sm ghost" data-m="role" title="Change their role">' + (role || 'Member') + '<i class="ti ti-chevron-down"></i></button>' : '') +
        '<button type="button" class="k-icon sm" data-m="kick" title="' + (p.membership === 'invite' ? 'Take back the invite' : 'Remove from the room') + '"><i class="ti ti-user-minus"></i></button>' +
        '<button type="button" class="k-icon sm ca-danger" data-m="ban" title="Ban from the room"><i class="ti ti-ban"></i></button>';
    return '<div class="ca-person" data-u="' + esc(p.id) + '" data-user="' + esc(p.user) + '">' +
      '<span class="ca-face" style="--c:' + col + '">' + (face ? '<img src="' + esc(face) + '" alt="" />' : esc((p.user || '?')[0].toUpperCase())) + '</span>' +
      '<span class="ca-person-tx"><span class="ca-person-name">' + esc(p.name || p.user) + (role && (p.role === 'owner' || p.membership !== 'join') ? '<span class="ca-role">' + role + '</span>' : '') + (p.isAdminBot ? '<span class="ca-role">You (admin account)</span>' : '') + '</span>' +
      '<span class="ca-person-sub">' + esc(p.user) + (state ? ' · ' + state : '') + '</span></span>' +
      '<span class="ca-person-acts">' + acts + '</span></div>';
  }
  function seg(name, opts, val) {
    return '<div class="k-seg ca-opt" role="group" data-set="' + name + '">' +
      Object.entries(opts).map(([k, l]) => '<button type="button" data-v="' + k + '" aria-pressed="' + (k === val) + '">' + l + '</button>').join('') + '</div>';
  }
  function paintMain() {
    if (!sheet) return;
    const main = sheet.querySelector('.ca-main');
    if (!sel) { main.innerHTML = '<p class="k-empty ca-empty">Pick a room to see who can see it and who’s in it.</p>'; return; }
    const base = rooms.find(r => r.id === sel) || {};
    const r = detail && !detail.error ? detail : base;
    if (detail?.error) { main.innerHTML = '<p class="k-empty ca-empty">' + esc(detail.error) + '</p>'; return; }
    const people = (detail?.people || []);
    const inside = people.filter(p => p.membership === 'join' && !p.isAdminBot);
    const waiting = people.filter(p => p.membership !== 'join');
    const meIn = people.some(p => p.isAdminBot && p.membership === 'join');
    main.innerHTML =
      '<div class="ca-room-head"><h3>' + esc(roomName(r)) + '</h3>' +
        '<div class="ca-room-meta">' + (r.alias ? esc(r.alias) + ' · ' : '') + 'Made by ' + esc(r.creator || 'someone') + ' on ' + esc(when(r.created)) +
          (r.encrypted ? ' · <i class="ti ti-lock"></i> Encrypted' : '') + (r.version ? ' · Room v' + esc(r.version) : '') + '</div>' +
        (detail ? '<div class="ca-room-topic">' + (r.topic ? esc(r.topic) : '<span>No topic</span>') + '</div>' : '') +
        '<div class="ca-room-btns"><button type="button" class="k-btn sm" data-a="edit"><i class="ti ti-pencil"></i>Name and topic</button>' +
          (meIn ? '' : '<button type="button" class="k-btn sm" data-a="claim" title="Join it as ' + esc(r.admin || 'the admin account') + ', as a room admin"><i class="ti ti-shield"></i>Make me an admin here</button>') +
          '<button type="button" class="k-btn sm danger" data-a="delete"><i class="ti ti-trash"></i>Delete</button></div></div>' +
      '<div class="k-label ca-label">Who can see it</div>' +
      '<p class="ca-sees">' + esc(seesLine(r)) + '</p>' +
      '<div class="ca-set"><span>Who can join</span>' + seg('join_rule', JOIN, r.joinRule) + '</div>' +
      '<div class="ca-set"><span>Listed in Browse channels</span><button type="button" class="k-switch s-toggle' + (r.listed ? ' on' : '') + '" role="switch" aria-checked="' + !!r.listed + '" data-a="listed"></button></div>' +
      '<div class="ca-set"><span>Newcomers can read</span>' + seg('history', { shared: 'Everything', invited: 'Since their invite', joined: 'Since they joined' }, r.history === 'world_readable' ? 'shared' : r.history) + '</div>' +
      '<div class="k-label ca-label">People<span class="ca-n">' + (detail ? inside.length : r.members || '') + '</span></div>' +
      '<form class="ca-invite"><div class="k-field-box"><i class="ti ti-user-plus"></i><input type="text" list="caPeople" placeholder="Invite someone by name" aria-label="Invite someone" autocomplete="off" spellcheck="false" /></div>' +
        '<button type="submit" class="k-btn sm">Invite</button><datalist id="caPeople">' + (window.klabPeople?.() || []).map(u => '<option value="' + esc(u) + '"></option>').join('') + '</datalist></form>' +
      (detail ? '<div class="ca-people">' + (inside.map(personHTML).join('') || '<p class="ca-quiet">Nobody’s in it.</p>') + '</div>' +
        (waiting.length ? '<div class="k-label ca-label">Invited, asking or banned</div><div class="ca-people">' + waiting.map(personHTML).join('') + '</div>' : '')
        : '<p class="ca-quiet" data-wait>Loading…</p>');
    main.classList.toggle('busy', busy);
  }

  async function change(body, okMsg) {
    if (busy) return;
    busy = true; paintMain();
    // The room it's for: another row can be picked while this is out.
    const id = sel;
    try {
      const d = await api('/rooms/' + enc(id), { method: 'PATCH', body });
      if (sel === id) detail = d;
      const r = rooms.find(x => x.id === id);
      if (r) Object.assign(r, { joinRule: d.joinRule, listed: d.listed, history: d.history, name: d.name, members: d.members });
      if (okMsg) showToast(okMsg, 'ti-check', { silent: true });
      paintList();
    } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
    finally { busy = false; paintMain(); }
  }
  async function member(user, action, extra = {}) {
    if (busy) return;
    busy = true; paintMain();
    const id = sel;
    try {
      const d = await api('/rooms/' + enc(id) + '/members', { method: 'POST', body: { user, action, ...extra } });
      if (sel === id) detail = d;
      const r = rooms.find(x => x.id === id); if (r) r.members = d.members;
      paintList();
    } catch (e) { showToast(e.message, 'ti-alert-triangle'); }
    finally { busy = false; paintMain(); }
  }

  async function onClick(e) {
    const t = e.target;
    if (t === sheet || t.closest('.ca-close')) { close(); return; }
    if (t.closest('.ca-refresh')) { await load(true); if (sel) pick(sel, true); return; }
    const f = t.closest('.ca-seg [data-f]');
    if (f) { filter = f.dataset.f; SFX?.play('click'); paintList(); return; }
    const row = t.closest('.ca-row');
    if (row) { pick(row.dataset.id); return; }
    if (!sel || busy) return;
    const opt = t.closest('.ca-opt [data-v]');
    if (opt) {
      const key = opt.closest('[data-set]').dataset.set, v = opt.dataset.v;
      if (key === 'join_rule' && v === 'public' && detail?.joinRule !== 'public' &&
          !(await showConfirmDialog('Let anyone on klab join?', 'Anyone signed in to klab can join ' + roomName(detail || {}) + (detail?.history === 'joined' ? '.' : ' and read its history.'), 'Open it up', { danger: false }))) return;
      change({ [key]: v });
      return;
    }
    const a = t.closest('[data-a]');
    if (a) {
      const act = a.dataset.a;
      if (act === 'listed') change({ listed: !detail?.listed });
      else if (act === 'edit') editDialog();
      else if (act === 'claim') {
        busy = true; paintMain();
        const id = sel;
        try { const d = await api('/rooms/' + enc(id) + '/claim', { method: 'POST' }); if (sel === id) detail = d; showToast('You’re an admin in ' + roomName(d), 'ti-shield', { silent: true }); }
        catch (err) { showToast(err.message, 'ti-alert-triangle'); }
        finally { busy = false; paintMain(); }
      } else if (act === 'delete') {
        const r = detail || rooms.find(x => x.id === sel) || {};
        if (!(await showConfirmDialog('Delete ' + roomName(r) + '?', 'Everyone is removed, its history is wiped from the server, and it can’t be brought back.', 'Delete'))) return;
        busy = true; paintMain();
        const id = sel;
        try {
          await api('/rooms/' + enc(id), { method: 'DELETE', body: { purge: true } });
          rooms = rooms.filter(x => x.id !== id);
          if (sel === id) { sel = null; detail = null; }
          showToast('Deleted ' + roomName(r), 'ti-trash', { silent: true });
          paintList();
        } catch (err) { showToast(err.message, 'ti-alert-triangle'); }
        finally { busy = false; paintMain(); }
      }
      return;
    }
    const m = t.closest('.ca-person [data-m]');
    if (m) {
      const p = m.closest('.ca-person'), user = p.dataset.u, name = p.dataset.user, act = m.dataset.m;
      if (act === 'role') {
        const cur = (detail?.people || []).find(x => x.id === user)?.role;
        klabMenu.at(m, [{ section: 'Role in ' + roomName(detail || {}) },
          ...[['admin', 'Admin', 'Everything, including roles'], ['mod', 'Mod', 'Kick, ban, delete messages'], ['member', 'Member', 'Talk']].map(([k, l, h]) =>
            ({ label: l, hint: h, checked: cur === k, action: () => member(user, 'role', { role: k }) }))], { align: 'end' });
        return;
      }
      if (act === 'ban' && !(await showConfirmDialog('Ban ' + name + ' from ' + roomName(detail || {}) + '?', 'They’re removed and can’t join again until they’re unbanned.', 'Ban'))) return;
      if (act === 'kick' && !(await showConfirmDialog((detail?.people || []).find(x => x.id === user)?.membership === 'invite' ? 'Take back ' + name + '’s invite?' : 'Remove ' + name + ' from ' + roomName(detail || {}) + '?', 'They can be invited again.', 'Remove', { danger: false }))) return;
      member(user, act);
      return;
    }
  }
  function onMenu(e) {
    const row = e.target.closest('.ca-row');
    if (!row) return;
    const r = rooms.find(x => x.id === row.dataset.id);
    if (!r) return;
    klabMenu(e, [
      { header: roomName(r) },
      { label: 'Manage', icon: 'ti-settings', action: () => pick(r.id) },
      { label: 'Open in Chat', icon: 'ti-message', hidden: !MatrixChat?.client?.getRoom?.(r.id), action: () => { close(); setActiveTab('chat'); openChatRoom?.(r.id); } },
      { label: 'Copy room ID', icon: 'ti-copy', action: () => klabCopy(r.id, 'Room ID') },
      { label: 'Profile of ' + r.creator, icon: 'ti-user-circle', hidden: !r.creator, action: () => openProfileView(r.creator) },
    ]);
  }
  function editDialog() {
    const r = detail || {};
    openChatModal('Name and topic', `
      <label class="k-form-label" for="caName">Name</label><input class="chat-modal-input" id="caName" maxlength="100" value="${esc(r.name || '')}" />
      <label class="k-form-label" for="caTopic" style="margin-top:12px">Topic</label><textarea class="chat-modal-input chat-modal-textarea" id="caTopic" maxlength="1000">${esc(r.topic || '')}</textarea>
      <div class="dlg-actions"><button type="button" class="k-btn" id="caEditCancel">Cancel</button><button type="button" class="k-btn primary" id="caEditSave">Save</button></div>`);
    document.getElementById('caEditCancel').onclick = () => closeChatModal?.();
    document.getElementById('caEditSave').onclick = () => {
      const name = document.getElementById('caName').value.trim(), topic = document.getElementById('caTopic').value.trim();
      closeChatModal?.();
      const body = {};
      if (name !== (r.name || '')) body.name = name;
      if (topic !== (r.topic || '')) body.topic = topic;
      if (Object.keys(body).length) change(body, 'Saved');
    };
  }
  // Invite: the form's submit (Enter or the button).
  document.addEventListener('submit', e => {
    if (!e.target.closest?.('.ca-invite')) return;
    e.preventDefault();
    const input = e.target.querySelector('input');
    const who = input.value.trim().replace(/^@/, '');
    if (!who) { input.focus(); return; }
    input.value = '';
    member(who, 'invite');
  }, true);

  // ── Ways in, shown only to admins with it set up ──
  function paintBadge() {
    const fresh = rooms.filter(r => r.created > seen && r.kind !== 'dm').length;
    const b = document.getElementById('chatAdminBtn');
    if (b) { b.hidden = !on; b.classList.toggle('has-new', !!fresh); b.title = fresh ? 'Chat rooms · ' + fresh + ' new' : 'Chat rooms'; }
    const row = document.getElementById('chatAdminRow');
    if (row) row.hidden = !on;
    const sub = document.getElementById('chatAdminSub');
    if (sub && rooms.length) sub.textContent = rooms.length + ' rooms' + (fresh ? ', ' + fresh + ' new since you last looked' : '') + '. Who can see what, and who’s in them';
  }
  document.getElementById('chatAdminBtn')?.addEventListener('click', e => { e.stopPropagation(); open(); });
  document.getElementById('chatAdminOpen')?.addEventListener('click', () => { document.getElementById('settingsBackdrop')?.classList.contains('open') && window.closeSettings?.(); open(); });

  let tries = 0;
  async function check() {
    let r = null;
    try {
      r = await fetchTimeout(API, {}, 8000);
      on = r.ok && !!(await r.json()).enabled;
    } catch (e) { on = false; }
    // No answer (offline at load) or a 5xx (the API restarting) isn't "not
    // an admin": asked again a few times, a minute apart.
    if ((!r || r.status >= 500) && ++tries < 10) setTimeout(check, 60000);
    paintBadge();
    if (on) load();
  }
  setTimeout(check, 3000);
  window.klabChatAdmin = { open, enabled: () => on, refresh: () => load(true) };
})();
