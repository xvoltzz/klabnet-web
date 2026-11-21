// ══════════════════════════════════════════
//  FOLDING CHAT'S LISTS (2026-11-21, the owner: "social expands so long it
//  pushes things down. can we tuck some more things away to conserve nav
//  bar space in chat?")
//  Channels, Voice and People each fold from their heading (a chevron;
//  remembered per device in klabnet_side_fold). A folded group still shows
//  what matters right now: an unread conversation, the open one, a voice
//  channel with people in it or the one you're in. People shows your six
//  most recent conversations, the rest behind "N more". Searching shows
//  everything. The rows themselves are drawn by js/08-chat.js,
//  js/22-voice.js and js/47-contacts.js; this only marks their lists
//  (data-folded, .all) and CSS ("FOLDING CHAT'S LISTS") does the hiding.
// ══════════════════════════════════════════
(function () {
  const KEY = 'klabnet_side_fold';
  const DM_SHOWN = 6;
  let fold = {};
  try { fold = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(fold)); } catch (e) {} };
  const $ = id => document.getElementById(id);

  // Each group: its heading, and the lists that fold under it.
  const GROUPS = [
    { key: 'channels', head: () => document.querySelector('#chatSide .chat-lbl-row'), lists: ['chatChannelsList'], row: '.chat-conv' },
    { key: 'voice', head: () => document.querySelector('#socVoice .soc-label-row'), lists: ['vcChannels'], row: '.vc-channel' },
    { key: 'people', head: () => $('chatDmLbl'), lists: ['chatDmList', 'chatPeopleMore'], row: '.chat-conv' },
  ];

  function setup(g) {
    const head = g.head();
    if (!head || head.dataset.foldable) return !!head;
    head.dataset.foldable = g.key;
    head.classList.add('side-fold-head');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    // The chevron leads; the label and its own buttons stay where they were.
    const chev = document.createElement('i');
    chev.className = 'ti ti-chevron-down side-fold-chev';
    head.prepend(chev);
    const n = document.createElement('span');
    n.className = 'side-fold-n';
    n.hidden = true;
    // After the label's text (a span, or the bare text node).
    const label = head.querySelector(':scope > span:not(.side-fold-n):not(.soc-label-count)');
    (label || chev).after(n);
    const toggle = e => {
      if (e.target.closest('button, a, input')) return; // Browse, +, settings
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      fold[g.key] = !fold[g.key];
      save();
      SFX?.play?.(fold[g.key] ? 'nav_back' : 'nav');
      apply(g);
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', toggle);
    return true;
  }

  function apply(g) {
    const head = g.head();
    if (!head) return;
    const on = !!fold[g.key];
    head.classList.toggle('folded', on);
    head.setAttribute('aria-expanded', String(!on));
    head.title = on ? 'Show all' : 'Fold';
    let hidden = 0;
    for (const id of g.lists) {
      const list = $(id);
      if (!list) continue;
      list.toggleAttribute('data-folded', on);
      if (on) hidden += [...list.querySelectorAll(':scope > ' + g.row + ', :scope .ct-srow')].filter(r => !r.offsetParent).length;
    }
    // Folded: how many are tucked away, beside the heading.
    const n = head.querySelector('.side-fold-n');
    if (n) { n.hidden = !on || !hidden; n.textContent = hidden; }
    if (g.key === 'people') more();
  }

  // People: the six most recent conversations, then "N more".
  function more() {
    const list = $('chatDmList');
    if (!list) return;
    let btn = $('chatDmMore');
    const rows = [...list.querySelectorAll(':scope > .chat-conv')];
    const extra = rows.slice(DM_SHOWN).filter(r => !r.classList.contains('has-unread') && !r.classList.contains('active')).length;
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'chatDmMore'; btn.className = 'side-more';
      btn.addEventListener('click', () => { list.classList.toggle('all'); SFX?.play?.('click'); more(); });
      list.after(btn);
    }
    const all = list.classList.contains('all');
    btn.hidden = !!fold.people || extra === 0;
    btn.innerHTML = all ? '<i class="ti ti-chevron-up"></i>Fewer' : '<i class="ti ti-dots"></i>' + extra + ' more';
  }

  let queued = 0;
  const repaint = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => { queued = 0; GROUPS.forEach(g => { if (setup(g)) apply(g); }); });
  };
  // The lists are redrawn often (sync ticks, voice polls): follow them.
  const mo = new MutationObserver(repaint);
  const watch = () => {
    for (const g of GROUPS) for (const id of g.lists) { const l = $(id); if (l && !l._foldWatched) { l._foldWatched = true; mo.observe(l, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); } }
  };
  watch();
  repaint();
  document.addEventListener('klab:chat-rooms', () => { watch(); repaint(); });
  window.klabSideFold = { state: () => ({ ...fold }), set: (k, v) => { fold[k] = !!v; save(); repaint(); } };
})();
