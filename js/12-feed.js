// ══════════════════════════════════════════
//  ONE COMMENT KIT (refresh 2026-11-19). Feed replies, a photo's comments
//  and a video's comments are the same thing (a post's /replies), so they
//  look and work the same everywhere: a face, the name, the time, the
//  text, and a trash on hover for your own (or any, for an admin). The box
//  under them is a face and a field: Enter posts, Esc clears (then
//  leaves), @names and :emoji: suggest as you type (js/20-mentions.js,
//  js/34-emoji.js match .k-com-input). A comment you add grows in; one you
//  delete folds away at once with "Comment deleted · Undo", and the
//  DELETE goes when the toast does (klabUndo). Rows are a one-row grid so
//  folding animates grid-template-rows, never height.
//  window.klabComments: rowHTML, listHTML, formHTML, fresh(id), gone(id),
//  isGone(id), remove(row) and del({...}).
// ══════════════════════════════════════════
(function () {
  const me = () => window.KLAB_USER?.username || '';
  const admin = () => !!window.KLAB_USER?.is_admin;
  const freshIds = new Set();   // just posted here: they grow in once
  const goneIds = new Set();    // deleted, waiting out their Undo
  const when = s => {
    if (!s) return 0;
    const str = String(s);
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime() || 0;
  };
  function faceHTML(u, cls) {
    const url = window.klabResolveUserAvatar?.(u);
    return '<span class="k-com-face' + (cls ? ' ' + cls : '') + '" data-username="' + esc(u || '') + '" style="--c:' + (typeof profileColor === 'function' ? profileColor(u) : '') + '">' +
      (url ? '<img src="' + esc(url) + '" alt="" />' : esc((u || '?')[0].toUpperCase())) + '</span>';
  }
  const plain = t => {
    const seg = x => (window.klabMentionsHTML ? klabMentionsHTML(x) : esc(x));
    return (typeof linkifyHTML === 'function' ? linkifyHTML(t || '', seg) : seg(t || '')).replace(/\n/g, '<br>');
  };
  function rowHTML(r, o) {
    o = o || {};
    const t = when(r.created);
    const del = o.canDelete ? o.canDelete(r) : (r.username === me() || admin());
    const isFresh = freshIds.delete(String(r.id));
    return '<div class="k-com' + (isFresh ? ' fresh' : '') + '" data-reply-id="' + r.id + '"' + (o.postId != null ? ' data-post-id="' + o.postId + '"' : '') + '><div class="k-com-in">' +
      faceHTML(r.username) +
      '<div class="k-com-tx">' +
        '<div class="k-com-head">' +
          '<button type="button" class="k-com-name" data-username="' + esc(r.username) + '" style="color:' + profileColor(r.username) + '" data-silent>' + esc(r.username) + '</button>' +
          '<span class="k-com-time" data-created="' + esc(r.created || '') + '"' + (t ? ' title="' + esc(new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) + '"' : '') + '>' + (t ? klabRelativeTime(t) : '') + '</span>' +
          (del ? '<button type="button" class="k-icon sm k-com-del" data-reply-id="' + r.id + '"' + (o.postId != null ? ' data-post-id="' + o.postId + '"' : '') + ' title="Delete comment" aria-label="Delete comment"><i class="ti ti-trash"></i></button>' : '') +
        '</div>' +
        '<div class="k-com-body">' + (o.text ? o.text(r) : plain(r.text)) + '</div>' +
      '</div></div></div>';
  }
  function listHTML(replies, o, empty) {
    const shown = (replies || []).filter(r => !goneIds.has(String(r.id)));
    return shown.length ? shown.map(r => rowHTML(r, o)).join('')
      : (empty == null ? '' : '<div class="k-com-empty">' + esc(empty) + '</div>');
  }
  // o: { id, postId, placeholder, value, cls, extra (HTML inside the box, after the field) }
  function formHTML(o) {
    o = o || {};
    return '<form class="k-com-form' + (o.cls ? ' ' + o.cls : '') + '"' + (o.formId ? ' id="' + o.formId + '"' : '') + (o.postId != null ? ' data-post-id="' + o.postId + '"' : '') + ' autocomplete="off">' +
      faceHTML(me(), 'me') +
      '<label class="k-field-box k-com-box">' +
        '<input type="text" class="k-com-input' + (o.inputCls ? ' ' + o.inputCls : '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + (o.postId != null ? ' data-post-id="' + o.postId + '"' : '') +
          ' placeholder="' + esc(o.placeholder || 'Add a comment…') + '" aria-label="' + esc(o.placeholder || 'Add a comment').replace(/…$/, '') + '" maxlength="500" enterkeyhint="send"' + (o.value ? ' value="' + esc(o.value) + '"' : '') + ' />' +
        (o.extra || '') +
      '</label></form>';
  }
  // Folds a row away (opacity and its grid row to 0fr); resolves once it's gone.
  function remove(row) {
    return new Promise(res => {
      if (!row || !row.isConnected) return res();
      if (!(window.klabMotionOk?.() ?? true)) { row.remove(); return res(); }
      row.classList.add('gone');
      let done = false;
      const end = () => { if (done) return; done = true; row.remove(); res(); };
      row.addEventListener('transitionend', e => { if (e.target === row && e.propertyName === 'grid-template-rows') end(); });
      setTimeout(end, 320);
    });
  }
  // A delete with Undo. o: { postId, reply, row, apply(), undo(), label }
  // apply/undo update the owner's own list and counts. Someone else's
  // comment (an admin's power) is asked about first, as posts are.
  async function del(o) {
    if (o.reply.username !== me() &&
        !(await showConfirmDialog('Delete ' + o.reply.username + '’s comment?', 'It’s gone for everyone.', 'Delete'))) return;
    const id = String(o.reply.id);
    goneIds.add(id);
    let applied = false;
    return klabUndo(o.label || 'Comment deleted', {
      apply: () => { remove(o.row).then(() => { if (goneIds.has(id)) { applied = true; o.apply?.(); } }); },
      undo: () => {
        goneIds.delete(id);
        if (o.row && o.row.isConnected) o.row.classList.remove('gone');
        if (applied) o.undo?.();
      },
      commit: async () => {
        const r = await fetch('/api/posts/' + o.postId + '/replies/' + o.reply.id, { method: 'DELETE', keepalive: true });
        goneIds.delete(id);
        if (!r.ok && r.status !== 404) { throw new Error('status ' + r.status); }
        o.done?.();
      },
      failed: 'Couldn’t delete that comment',
    });
  }
  // Esc clears the box first, then leaves it.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !e.target.matches?.('.k-com-input') || e.defaultPrevented) return;
    // A suggestion list open over it closes first (its own Esc).
    if (document.querySelector('.mention-suggest:not([hidden]), .emo-suggest:not([hidden])')) return;
    e.preventDefault(); e.stopPropagation();
    if (e.target.value) { e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); }
    else e.target.blur();
  }, true);
  // Faces whose picture arrived after they were drawn.
  function refreshFaces(root) {
    (root || document).querySelectorAll('.k-com-face[data-username]:not(:has(img))').forEach(el => {
      const url = window.klabResolveUserAvatar?.(el.dataset.username);
      if (url) el.innerHTML = '<img src="' + esc(url) + '" alt="" />';
    });
  }
  window.klabComments = {
    rowHTML, listHTML, formHTML, faceHTML, remove, del, refreshFaces,
    fresh: id => freshIds.add(String(id)),
    isGone: id => goneIds.has(String(id)),
  };
})();

// ══════════════════════════════════════════
//  FEED — Home tab. Text/image posts, klabnet-api /api/posts. Images never
//  touch klabnet-api: the browser uploads straight to Matrix's content repo
//  via uploadContent() (same flow the profile-avatar picker already uses,
//  see openProfileModal()) and only the resulting mxc:// URI gets posted —
//  so posting text works even without a Matrix session; only attaching an
//  image needs one.
// ══════════════════════════════════════════
(function() {
  const listEl        = document.getElementById('feedList');
  const textEl        = document.getElementById('feedComposerText');
  const highlightEl   = document.getElementById('feedComposerHighlight');
  const fileEl        = document.getElementById('feedComposerImage');
  const imageBtnEl    = document.getElementById('feedComposerImageBtn');
  const previewWrapEl = document.getElementById('feedComposerPreviewWrap');
  const previewEl     = document.getElementById('feedComposerPreview');
  const previewRmEl   = document.getElementById('feedComposerPreviewRemove');
  const songPreviewEl = document.getElementById('feedComposerSongPreview');
  const songArtEl     = document.getElementById('feedComposerSongArt');
  const songTitleEl   = document.getElementById('feedComposerSongTitle');
  const songArtistEl  = document.getElementById('feedComposerSongArtist');
  const songLyricEl   = document.getElementById('feedComposerSongLyric');
  const songRemoveEl  = document.getElementById('feedComposerSongRemove');
  const errEl         = document.getElementById('feedComposerError');
  const postBtnEl     = document.getElementById('feedComposerPostBtn');
  const loadMoreEl    = document.getElementById('feedLoadMore');
  const mentionsBtnEl = document.getElementById('feedMentionsBtn');
  const mentionsDotEl = document.getElementById('feedMentionsDot');
  if (!listEl) return; // feed markup not present (shouldn't happen, guards a bad merge)

  const FEED_MAX_IMAGE_BYTES = 8 * 1024 * 1024; // client-side sanity cap — Matrix's own content-repo limit is the real backstop
  const FEED_PAGE_SIZE = 50;
  // Caps how many posts loadOlderPosts() keeps resident — see its own
  // comment. Was 300, and past it the trim cut off the very page just
  // loaded, so "Load older" stopped doing anything. Rendering only rebuilds
  // posts that changed, so a long scrollback is cheap to keep.
  const FEED_MAX_LOADED = 1500;
  const MENTIONS_SEEN_KEY = 'klabnet_feed_mentions_seen_v1'; // { username: highest post id already seen mentioning them }
  const FEED_MAX_CHARS = 10000; // matches FEED_POST_MAX_CHARS in klabnet-api; replies stay short
  const DRAFT_KEY = 'klabnet_feed_draft_v1';

  let _feedPosts     = [];   // newest-first
  // Fingerprint of the last _feedPosts merge that actually triggered a
  // render — lets fetchFeed()'s own poll skip renderFeed() when a 30s
  // tick comes back with nothing new, without touching any of the other
  // ~13 call sites (reactions/replies/deletes/avatar-resolve/etc.), all
  // of which still call renderFeed() unconditionally as before. Built
  // from id+reply_count+reactions only — text/image/song never change
  // after a post is created, so they don't need to be in it for this to
  // stay correct; a new/deleted post or reaction/reply changes the ids,
  // counts, or reactions blob, which this does capture.
  let _lastFeedPostsSignature = null;
  let _feedHasMore   = false;
  let _feedPending   = false; // a fetch is in flight — guards overlapping polls/loads
  let _feedRefreshPromise = null;
  let _feedFetchedAt = 0;
  let _feedLoadedOnce = false; // fetchFeed() has completed at least once, success or not
  // Separate from the above: until one fetch has actually worked, there's
  // no feed to draw, no has-more to know, and no mention watermark to seed.
  let _feedLoadedOk  = false;
  // A first load that failed used to wait for the next 30s poll, so one
  // dropped request at startup left "Couldn't load the feed" up for half a
  // minute. Until one works, it tries again sooner: 2s, 4s, 8s, 16s.
  let _feedRetryMs = 0, _feedRetryTimer = null;
  let _pendingFile   = null;
  let _pendingVideo  = null; // { id, title, poster, duration, username, start } — window.klabShareVideoToFeed (js/39-videos.js)
  let _pendingSong   = null; // { songId, title, artist, album, coverArt, lyric, start } — see setPendingSong()/window.klabShareSongToFeed
  let _mentionsOnly  = false; // toggled by the @ button — filters the list to posts mentioning me
  const _repliesCache       = new Map(); // postId -> array of replies, fetched lazily as each post renders
  const _repliesPending     = new Set(); // postIds with a replies fetch already in flight
  const _repliesAt          = new Map(); // postId -> when its replies were last fetched
  const _repliesStale       = new Set(); // postIds whose cached replies are out of date; still shown until the refetch lands
  const _openReplyBoxes = new Set();      // postIds whose reply box was opened with the Reply button
  const _expandedPosts = new Set();       // long posts someone hit "Show more" on
  // Half-typed replies, so rebuilding a post (a new reaction, a poll)
  // doesn't wipe a box you'd clicked away from mid-sentence.
  const _replyDrafts = new Map();         // postId -> text
  // A poll that was already in flight when you reacted, replied or deleted
  // carries the state from before, and merging it would undo what you did.
  const _locallyDeleted = new Set();      // postIds you deleted this session
  const _localEditAt = new Map();         // postId -> performance.now() of your last change to it
  // Your own posts open for editing (postId -> the text in the editor), so
  // a rebuild of the post (a poll, a reaction) keeps the editor and what's
  // in it.
  const _editing = new Map();

  // Its own list, separate from the header's MOTD_PHRASES — same crude/
  // unhinged energy on purpose, just original lines rather than reusing
  // that list's specific existing inside-jokes verbatim. Edit freely.
  const FEED_PLACEHOLDER_PHRASES = [
    "confess your sins",
    "what did you almost get arrested for",
    "say something you'll regret",
    "what's the group chat drama today",
    "what smells, and why is it you",
    "narrate your worst decision this week",
    "who's lying right now",
    "what did you break, physically or emotionally",
    "say the unhinged thing you're thinking",
    "confess something weird",
    "what's the crime today",
    "spill something filthy",
    "what did you do to deserve this",
    "what's the horniest thing that happened today",
    "who owes who money, and why",
    "what did you lie about today",
    "describe your last fart in detail",
    "what's the dumbest thing you believed today",
  ];

  // Composer placeholder types itself out char-by-char and cycles through
  // the phrases above, same feel as the header's klabnet>_ prompt, instead
  // of a single static "what's going on?" that never changes. Placeholders
  // don't render over real content anyway, so this just keeps ticking in
  // the background rather than needing its own pause-while-focused/has-
  // text logic.
  (function typewriterPlaceholder() {
    if (!textEl || !FEED_PLACEHOLDER_PHRASES.length) return;
    let phraseIdx = Math.floor(Math.random() * FEED_PLACEHOLDER_PHRASES.length);
    let charIdx = 0;
    function tick() {
      // Only while someone can see it: not on another tab, not hidden, not
      // under text. Otherwise it's a dozen wakeups a second for nothing, all
      // day, in every open klabnet. Checks back once a second instead.
      if (document.hidden || !textEl.offsetParent || textEl.value) { setTimeout(tick, 1000); return; }
      const phrase = FEED_PLACEHOLDER_PHRASES[phraseIdx];
      // Reduced motion, Performance mode or a window in the background: the
      // phrase, still, with no cursor (the typing is a loop like any other).
      const still = (typeof klabMotionOk === 'function' && !klabMotionOk()) || document.documentElement.classList.contains('win-idle');
      if (still) { textEl.placeholder = phrase; charIdx = phrase.length + 1; setTimeout(tick, 2000); return; }
      if (charIdx <= phrase.length) {
        textEl.placeholder = phrase.slice(0, charIdx) + (charIdx < phrase.length ? '_' : '');
        charIdx++;
        setTimeout(tick, 55 + Math.random() * 45);
      } else {
        setTimeout(() => {
          phraseIdx = (phraseIdx + 1) % FEED_PLACEHOLDER_PHRASES.length;
          charIdx = 0;
          tick();
        }, 2600);
      }
    }
    tick();
  })();

  // @mentions: only a real person's name (window.klabUserFor), in the
  // composer's live highlight and in posts alike. Anything else stays text.
  function mentionHTML(rawText, me) {
    const escaped = esc(rawText);
    return escaped.replace(/(^|[^\w@])@([a-zA-Z0-9_][\w.-]*)/g, (m, pre, name) => {
      const u = window.klabUserFor?.(name);
      if (!u) return m;
      const isMe = !!me && u === me.toLowerCase();
      return pre + '<span class="feed-post-mention' + (isMe ? ' is-me' : '') + '" data-username="' + esc(u) + '" style="color:' + profileColor(u) + '">@' + name.slice(0, u.length) + '</span>' + name.slice(u.length);
    });
  }

  // Post/reply bodies get both passes: linkifyHTML carves out the URLs and
  // hands every remaining run of text to mentionHTML, so an @name inside a
  // URL stays part of the URL instead of turning into a mention.
  function richText(rawText, me) {
    return linkifyHTML(rawText, seg => mentionHTML(seg, me));
  }

  // Posts are markdown. Before this, a post was plain text; old posts
  // read the same either way, since plain text is valid markdown and
  // line breaks are kept (breaks: true in 11b-markdown.js).
  function postTextHTML(post, me) {
    if (!window.klabMarkdown) return '<div class="feed-post-text">' + richText(post.text, me) + '</div>';
    const folded = klabMdIsLong(post.text) && !_expandedPosts.has(post.id);
    return '<div class="feed-post-text md' + (folded ? ' md-folded' : '') + '">' + klabMarkdown(post.text, me) + '</div>' +
      (folded ? '<button type="button" class="feed-post-more" data-post-id="' + post.id + '">Show more<i class="ti ti-chevron-down"></i></button>' : '');
  }
  function replyTextHTML(text, me) {
    return window.klabMarkdown ? klabMarkdown(text, me, { inline: true }) : richText(text, me);
  }

  // Compiled once per name rather than once per post per render.
  let _mentionRe = null, _mentionReFor = null;
  // Code and links aren't rendered as mentions (see finish() in
  // 11b-markdown.js), so an @name inside one shouldn't count as one here.
  const MENTION_SKIP_RE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\bhttps?:\/\/\S+|\bwww\.\S+/g;
  function textMentions(text, username) {
    if (!text || !username) return false;
    const lc = username.toLowerCase();
    if (!text.toLowerCase().includes('@' + lc)) return false; // the usual case, no regex at all
    if (_mentionReFor !== lc) {
      _mentionReFor = lc;
      _mentionRe = new RegExp('(^|[^\\w@])@' + lc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![.-]*\\w)', 'i');
    }
    return _mentionRe.test(text.replace(MENTION_SKIP_RE, ' '));
  }

  function loadMentionsSeen() {
    try { return JSON.parse(localStorage.getItem(MENTIONS_SEEN_KEY) || '{}'); } catch (e) { return {}; }
  }
  // Keyed lowercase: textMentions() matches names case-insensitively, so a
  // username whose casing differs between sessions would otherwise write the
  // watermark under one key and read it back under another.
  function mentionsSeenKeyFor(me) { return String(me || '').toLowerCase(); }
  function markMentionsSeen(uptoId) {
    const me = mentionsSeenKeyFor(window.KLAB_USER?.username);
    if (!me) return;
    try {
      const seen = loadMentionsSeen();
      seen[me] = Math.max(seen[me] || 0, uptoId);
      localStorage.setItem(MENTIONS_SEEN_KEY, JSON.stringify(seen));
    } catch (e) {}
  }
  // A new post mentioning you gets a desktop notification, once. Only
  // posts newer than what was loaded at startup: opening klabnet never
  // replays old mentions.
  let _mentionFloor = null;
  const _mentionNotified = new Set();
  function notifyNewMentions(mentioning) {
    const newest = _feedPosts.reduce((max, p) => Math.max(max, p.id), 0);
    if (_mentionFloor === null) { _mentionFloor = newest; return; }
    mentioning.forEach(p => {
      if (p.id <= _mentionFloor || _mentionNotified.has(p.id)) return;
      _mentionNotified.add(p.id);
      const text = String(p.text || '').replace(/[#>*_~`|=\[\]()!-]+/g, ' ').replace(/\s+/g, ' ').trim();
      window.klabDesktopNotify?.({
        title: `${p.username} mentioned you`,
        body: text.length > 160 ? text.slice(0, 160) + '…' : text,
        icon: window.klabResolveUserAvatar?.(p.username),
        tag: 'feed-' + p.id,
        onClick: () => window.klabFeedFocus?.(p.id),
      });
    });
  }
  function updateMentionsDot() {
    const rawMe = window.KLAB_USER?.username;
    const me = mentionsSeenKeyFor(rawMe);
    if (!me || me === 'anonymous' || !mentionsDotEl) return;
    // Before the first fetch lands _feedPosts is empty, which would seed
    // the watermark (and the notification floor) at 0 and then light up
    // every old mention as new.
    if (!_feedLoadedOk) return;
    const seen = loadMentionsSeen();
    // No watermark at all means a brand-new browser, a private window, a
    // cleared/evicted localStorage, or the installed PWA (separate storage
    // from the tab) — not "you have never read anything". Defaulting to 0
    // relit the dot for months-old mentions on every such session, which is
    // the "randomly decides I have not read this" report. Seed it to what's
    // on screen instead and start tracking from there.
    if (seen[me] === undefined) {
      markMentionsSeen(_feedPosts.reduce((max, p) => Math.max(max, p.id), 0));
      // The notification floor too, or the first mention after this became
      // the floor and never notified.
      if (_mentionFloor === null) _mentionFloor = _feedPosts.reduce((max, p) => Math.max(max, p.id), 0);
      mentionsDotEl.hidden = true;
      return;
    }
    const lastSeen = seen[me] || 0;
    const mentioning = _feedPosts.filter(p =>
      p.id > lastSeen && mentionsSeenKeyFor(p.username) !== me && textMentions(p.text, me));
    notifyNewMentions(mentioning);
    mentionsDotEl.hidden = !mentioning.length;
    // Reading a mention in the normal feed used to record nothing —
    // markMentionsSeen() was only ever called by the @ button's own click
    // handler, so the dot stayed lit until you clicked it and found
    // "nothing new". If the mention is actually on screen and the tab is in
    // front, count it as read after a short dwell.
    if (mentioning.length) scheduleMentionsSeen(mentioning.reduce((max, p) => Math.max(max, p.id), 0));
  }

  // Dwell timer for the above — cleared if you navigate away or hide the
  // tab before it fires, so a mention that merely flashed past doesn't get
  // marked read.
  let _mentionsSeenTimer = null;
  function scheduleMentionsSeen(uptoId) {
    if (_mentionsSeenTimer) return;
    _mentionsSeenTimer = setTimeout(() => {
      _mentionsSeenTimer = null;
      const onFeed = document.querySelector('.tab-panel[data-tab-panel="feed"]')?.classList.contains('active');
      if (!onFeed || document.hidden) return;
      markMentionsSeen(uptoId);
      if (mentionsDotEl) mentionsDotEl.hidden = true;
    }, 2500);
  }

  const _feedAvatarCache   = new Map(); // username -> blob URL or null
  const _feedAvatarPending = new Set();
  const _feedImageCache    = new Map(); // mxc:// -> blob URL or null
  const _feedImagePending  = new Set();
  // A lookup that failed (as opposed to "has no avatar") is cached as null
  // too, but only for a while: a blip in Matrix shouldn't leave a blank
  // face or photo for the rest of the session.
  const FEED_MEDIA_RETRY_MS = 60000;
  const _feedAvatarFailedAt = new Map(); // username -> Date.now() of the failure
  const _feedImageFailedAt  = new Map(); // mxc:// -> Date.now() of the failure
  const retryDue = (failedAt, key) => failedAt.has(key) && Date.now() - failedAt.get(key) > FEED_MEDIA_RETRY_MS;
  const FEED_IMAGE_CACHE_MAX = 60; // see capBlobCache()'s own comment — smaller than chat's cap since these are 800x800 (4x the pixel area of chat's 400x400 crop)

  // capBlobCache() is blind FIFO, which is fine for chat but was actively
  // harmful here: FEED_MAX_LOADED is 300 and this cap is 60, so past ~60
  // image posts it revoked blob URLs that were still the src of a visible
  // <img>. The picture went blank, the next render re-fetched it, which
  // evicted someone else's, and the feed never stopped rebuilding. Only
  // evict images no longer attached to a resident post.
  function capFeedImageCache() {
    if (_feedImageCache.size <= FEED_IMAGE_CACHE_MAX) return;
    const live = new Set(_feedPosts.map(p => p.image_mxc).filter(Boolean));
    for (const [mxc, url] of _feedImageCache) {
      if (_feedImageCache.size <= FEED_IMAGE_CACHE_MAX) break;
      if (live.has(mxc)) continue;
      if (url) URL.revokeObjectURL(url);
      _feedImageCache.delete(mxc);
      _feedImageFailedAt.delete(mxc);
    }
  }

  function ensureFeedAvatar(username) {
    if (!username || _feedAvatarPending.has(username)) return;
    if (_feedAvatarCache.has(username) && !retryDue(_feedAvatarFailedAt, username)) return;
    const client = MatrixChat.client;
    if (!client) return;
    _feedAvatarPending.add(username);
    (async () => {
      try {
        const serverName = client.getUserId().split(':')[1];
        const info = await client.getProfileInfo(`@${username}:${serverName}`);
        _feedAvatarCache.set(username, info?.avatar_url ? await MatrixChat.mxcToBlobUrl(info.avatar_url) : null);
        _feedAvatarFailedAt.delete(username);
      } catch (e) {
        if (!_feedAvatarCache.get(username)) {
          _feedAvatarCache.set(username, null);
          _feedAvatarFailedAt.set(username, Date.now());
        }
      } finally {
        _feedAvatarPending.delete(username);
        scheduleFeedRender();
      }
    })();
  }

  // Each picture's shape (width / height), kept from when it loaded so it
  // can be given its room before it arrives next time. The API doesn't
  // store image sizes for feed posts.
  const FEED_RATIO_KEY = 'klabnet_feed_img_ratio';
  let _feedRatios = null;
  function feedImageRatio(mxc) {
    if (!_feedRatios) { try { _feedRatios = JSON.parse(localStorage.getItem(FEED_RATIO_KEY)) || {}; } catch (e) { _feedRatios = {}; } }
    return _feedRatios[mxc] || 0;
  }
  listEl.addEventListener('load', e => {
    const img = e.target;
    if (!img.matches?.('img.feed-post-image[data-mxc]') || !img.naturalWidth || !img.naturalHeight) return;
    const r = +(img.naturalWidth / img.naturalHeight).toFixed(4);
    if (img.style.aspectRatio) img.style.aspectRatio = String(r);
    if (feedImageRatio(img.dataset.mxc) === r) return;
    _feedRatios[img.dataset.mxc] = r;
    const keys = Object.keys(_feedRatios);
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete _feedRatios[k]);
    try { localStorage.setItem(FEED_RATIO_KEY, JSON.stringify(_feedRatios)); } catch (err) {}
  }, true);
  function ensureFeedImage(mxc) {
    if (!mxc || _feedImagePending.has(mxc)) return;
    if (_feedImageCache.has(mxc) && !retryDue(_feedImageFailedAt, mxc)) return;
    // Same guard ensureFeedAvatar()/presence's ensureAvatarResolved() use:
    // bail WITHOUT touching the cache when there's no client yet, so a
    // page load that renders before Matrix finishes reconnecting retries
    // on the next render instead of permanently caching a null result.
    const client = MatrixChat.client;
    if (!client) return;
    _feedImagePending.add(mxc);
    (async () => {
      try {
        // 800px scaled thumbnail, not the 64x64 avatar crop other
        // mxcToBlobUrl() callers use — a feed photo needs to actually be
        // visible, not cropped to a square.
        _feedImageCache.set(mxc, await MatrixChat.mxcToBlobUrl(mxc, { width: 800, height: 800, method: 'scale' }));
        _feedImageFailedAt.delete(mxc);
      } catch (e) {
        _feedImageCache.set(mxc, null);
        _feedImageFailedAt.set(mxc, Date.now());
      } finally {
        _feedImagePending.delete(mxc);
        capFeedImageCache();
        scheduleFeedRender();
      }
    })();
  }

  function fmtFeedTime(apiTime) {
    // Backend timestamps are "YYYY-MM-DD HH:MM:SS" in UTC with no zone
    // marker — appending Z is what makes Date parse it as UTC instead of
    // (incorrectly) local time.
    const d = new Date(apiTime.replace(' ', 'T') + 'Z');
    return klabRelativeTime(d.getTime());
  }

  // A time in full, for tooltips: "Nov 19, 2026, 3:42 PM".
  function fullTime(apiTime) {
    const d = new Date(String(apiTime || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(apiTime || '') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }
  // Your post, open for editing in place: the same text, the same markdown
  // when it's saved. Esc cancels, Ctrl/⌘+Enter saves.
  function editorHTML(post) {
    return '<div class="feed-post-editor" data-post-id="' + post.id + '">' +
      '<textarea class="k-field feed-edit-text" data-post-id="' + post.id + '" maxlength="' + FEED_MAX_CHARS + '" aria-label="Edit post" spellcheck="true">' + esc(_editing.get(post.id) ?? post.text ?? '') + '</textarea>' +
      '<div class="feed-edit-foot"><span class="feed-edit-hint">Esc to cancel · ' + (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl') + '+Enter to save</span>' +
        '<button type="button" class="k-btn sm" data-edit-cancel="' + post.id + '">Cancel</button>' +
        '<button type="button" class="k-btn sm primary" data-edit-save="' + post.id + '">Save</button></div>' +
    '</div>';
  }

  // One comment, the kit's way (klabComments, above).
  function feedReplyHTML(post, reply) {
    const me = window.KLAB_USER?.username;
    ensureFeedAvatar(reply.username);
    return klabComments.rowHTML(reply, { postId: post.id, text: r => replyTextHTML(r.text, me) });
  }

  // Always shown now (no more expand/collapse click) — ensureFeedRepliesResolved()
  // below fetches into _repliesCache as each post with replies renders.
  function feedRepliesSectionHTML(post) {
    const replies = _repliesCache.get(post.id) || [];
    const draft = _replyDrafts.get(post.id) || '';
    // The reply box only shows once a post has replies or you hit Reply,
    // instead of an empty input under every post.
    return '<div class="feed-post-replies' + (replies.length ? ' has-replies' : '') + (_openReplyBoxes.has(post.id) || draft ? ' replying' : '') + '" data-post-id="' + post.id + '">' +
      replies.filter(r => !klabComments.isGone(r.id)).map(r => feedReplyHTML(post, r)).join('') +
      klabComments.formHTML({ postId: post.id, placeholder: 'Reply…', value: draft, cls: 'feed-post-reply-composer', inputCls: 'feed-post-reply-input',
        extra: '<button type="button" class="k-icon sm feed-post-reply-gif" data-post-id="' + post.id + '" title="GIF" aria-label="GIF"><span class="gif-glyph">GIF</span></button>' }) +
    '</div>';
  }

  // A short, plain line reads as a statement: big type, no chrome.
  function isShout(text) {
    const t = String(text || '').trim();
    return !!t && t.length <= 48 && !/\n/.test(t) && !/^[#>\-*+|`]|\d+\.\s|https?:\/\/|www\.|```|\*\*|__|~~|\|\||==/.test(t);
  }

  function postHTML(post) {
    const me = window.KLAB_USER?.username;
    const canDelete = post.username === me || window.KLAB_USER?.is_admin;
    ensureFeedAvatar(post.username);
    const avatarUrl = _feedAvatarCache.get(post.username);
    const avatarInner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : esc((post.username || '?')[0].toUpperCase());
    let imageHTML = '';
    if (post.image_mxc) {
      ensureFeedImage(post.image_mxc);
      const url = _feedImageCache.get(post.image_mxc);
      // Sized before it arrives, so the posts around it don't jump: the
      // shape it had when it last loaded here, or a photo's usual 4:3.
      const ratio = feedImageRatio(post.image_mxc);
      // (A photo post's picture loads lazily, so even with its file in hand
      // it has no height until it nears the screen.)
      const shape = ratio || !post.song ? ' style="aspect-ratio:' + (ratio || '4 / 3') + '"' : '';
      if (url) imageHTML = '<img class="feed-post-image" src="' + esc(url) + '" data-mxc="' + esc(post.image_mxc) + '" alt="" loading="lazy"' + shape + ' />';
      else if (!post.song && url !== null && MatrixChat.client) imageHTML = '<div class="feed-post-image-ph" style="aspect-ratio:' + (ratio || '4 / 3') + '" aria-hidden="true"></div>';
    }
    let songHTML = '';
    if (post.song) {
      const s = post.song;
      const artUrl = s.coverArt ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(s.coverArt)}&size=100&${subsonicParams()}` : '';
      // encodeURIComponent, not esc() — a title/artist with an apostrophe
      // would break out of this HTML attribute if just HTML-escaped (esc()
      // only handles &"<>, not '), same reason renderSongItem's own
      // data-add-pl attribute uses it for the same kind of JSON payload.
      const playPayload = encodeURIComponent(JSON.stringify({ id: s.songId, title: s.title, artist: s.artist, album: s.album, coverArt: s.coverArt }));
      // A moment of it (a start time): the card says where, and plays from there.
      const at = s.start > 0 ? s.start : 0;
      // A record in its sleeve: the vinyl slides out and spins while this
      // song is the one playing (see syncFeedRecords).
      songHTML = '<div class="feed-post-song" data-play-song="' + playPayload + '"' + (at ? ' data-at="' + at + '"' : '') + '>' +
        '<span class="feed-rec"><span class="feed-rec-disc"' + (artUrl ? ' style="--art:url(&quot;' + esc(artUrl) + '&quot;)"' : '') + '></span>' +
        (artUrl
          ? '<img class="feed-post-song-art" src="' + esc(artUrl) + '" alt="" loading="lazy" onerror="klabArtFallback(this,\'feed-post-song-art-ph\',\'ti-music\')" />'
          : '<div class="feed-post-song-art-ph"><i class="ti ti-music"></i></div>') + '</span>' +
        '<div class="feed-post-song-info">' +
          '<div class="feed-post-song-title">' + esc(s.title || 'Unknown') + '</div>' +
          '<div class="feed-post-song-artist">' + esc(s.artist || '') + (s.album ? ' · ' + esc(s.album) : '') + '</div>' +
          (s.lyric ? '<div class="feed-post-song-lyric">' + esc(s.lyric) + '</div>' : '') +
        '</div>' +
        (at ? '<span class="song-at" title="Plays from ' + formatTime(at) + '"><i class="ti ti-clock"></i>' + formatTime(at) + '</span>' : '') +
        '<button type="button" class="feed-post-song-play" title="' + (at ? 'Play from ' + formatTime(at) : 'Play') + '"><i class="ti ti-player-play"></i></button>' +
      '</div>';
    }
    // A klabnet video: its poster, which opens it on Videos (from its moment).
    let videoHTML = '';
    if (post.video) {
      const v = post.video, at = v.start > 0 ? v.start : 0;
      videoHTML = '<button type="button" class="feed-post-video" data-video-id="' + v.id + '"' + (at ? ' data-at="' + at + '"' : '') + ' data-silent>' +
        '<span class="feed-post-video-thumb">' + (v.poster ? '<img src="' + esc(v.poster) + '" alt="" loading="lazy" />' : '<i class="ti ti-movie"></i>') +
          '<span class="feed-post-video-play"><i class="ti ti-player-play-filled"></i></span>' +
          (v.duration ? '<span class="feed-post-video-dur">' + (at ? formatTime(at) + ' / ' : '') + formatTime(v.duration) + '</span>' : '') + '</span>' +
        '<span class="feed-post-video-tx"><b>' + esc(v.title || 'Video') + '</b><span>' + esc(v.username || '') + (v.status && v.status !== 'ready' ? ' · processing' : '') + '</span></span>' +
      '</button>';
    }
    // Only the first YouTube link in a post gets a player — a post with a
    // list of links shouldn't turn into a stack of iframes. The link itself
    // stays in the text either way.
    const ytId = youtubeIdFrom(post.text);
    const embedHTML = ytId
      ? '<div class="feed-post-embed"><iframe src="https://www.youtube-nocookie.com/embed/' + ytId + '"' +
          ' title="YouTube video" loading="lazy" allowfullscreen' +
          ' referrerpolicy="strict-origin-when-cross-origin"' +
          ' allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"></iframe></div>'
      : '';
    ensureFeedRepliesResolved(post);
    const reactions = post.reactions || {};
    // The star has its own button, so it's left out of the pills.
    const star = reactions[KLAB_STAR] || { count: 0, mine: false };
    const starHTML = '<button type="button" class="feed-post-star' + (star.mine ? ' mine' : '') + '" data-post-id="' + post.id + '" data-emoji="' + KLAB_STAR + '" title="' + (star.mine ? 'Unstar' : 'Star') + '" aria-pressed="' + !!star.mine + '">' +
      '<i class="ti ' + (star.mine ? 'ti-star-filled' : 'ti-star') + '"></i>' + (star.count ? '<span>' + star.count + '</span>' : '') + '</button>';
    const pillsHTML = Object.entries(reactions).filter(([emoji]) => !KLAB_STARS || emoji !== KLAB_STAR).map(([emoji, entry]) =>
      '<button type="button" class="feed-post-reaction-pill' + (entry.mine ? ' mine' : '') + '" data-post-id="' + post.id + '" data-emoji="' + esc(emoji) + '">' +
        klabReactHTML(emoji) + ' <span class="feed-post-reaction-count">' + entry.count + '</span>' +
      '</button>'
    ).join('');
    const imgUrl = post.image_mxc ? _feedImageCache.get(post.image_mxc) : null;
    const songArt = post.song && post.song.coverArt ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(post.song.coverArt)}&size=300&${subsonicParams()}` : '';
    const kind = post.song ? ' is-song' : post.image_mxc ? ' is-photo' : (isShout(post.text) && !ytId ? ' is-shout' : '');
    return '<div class="feed-post' + kind + (KLAB_STARS && star.count >= KLAB_GOLD_AT ? ' gold' : '') + '" data-post-id="' + post.id + '"' +
      (post.song ? ' data-song-id="' + esc(post.song.songId || '') + '"' : '') +
      ' style="--name-color:' + profileColor(post.username) + '">' +
      '<div class="feed-post-avatar" data-username="' + esc(post.username) + '">' + avatarInner + '</div>' +
      '<div class="feed-post-body">' +
        '<div class="feed-post-head">' +
          '<span class="feed-post-name" data-username="' + esc(post.username) + '">' + esc(post.username) + '</span>' +
          '<span class="feed-post-time" data-created="' + esc(post.created) + '" title="' + esc(fullTime(post.created)) + '">' + fmtFeedTime(post.created) + '</span>' +
          (post.edited ? '<span class="feed-post-edited" title="Edited ' + esc(fullTime(post.edited)) + '">edited</span>' : '') +
        '</div>' +
        // Its actions, over its top right while you point at it, as on a
        // chat message (Slack's way): the quick reactions, reply, delete.
        // They used to sit under every post all the time, with the quick
        // reactions spilling out of a button in a row of bare emoji.
        '<div class="feed-post-actions k-toolbar" role="toolbar" aria-label="Post actions">' +
          KLAB_QUICK_REACTS.map(e => '<button type="button" class="k-icon feed-post-act" data-post-id="' + post.id + '" data-emoji="' + e + '" title="React ' + e + '">' + klabReactHTML(e) + '</button>').join('') +
          '<button type="button" class="k-icon feed-post-act feed-post-add-reaction" data-post-id="' + post.id + '" title="More reactions" aria-label="More reactions"><i class="ti ti-mood-plus"></i></button>' +
          '<button type="button" class="k-icon feed-post-act feed-post-reply-open" data-post-id="' + post.id + '" title="Reply" aria-label="Reply"><i class="ti ti-arrow-back-up"></i></button>' +
          ((post.username === me || window.KLAB_USER?.is_admin) ? '<button type="button" class="k-icon feed-post-act feed-post-edit" data-post-id="' + post.id + '" title="Edit post" aria-label="Edit post"><i class="ti ti-pencil"></i></button>' : '') +
          (canDelete ? '<button type="button" class="k-icon feed-post-act feed-post-delete" data-post-id="' + post.id + '" title="Delete post" aria-label="Delete post"><i class="ti ti-trash"></i></button>' : '') +
        '</div>' +
        (_editing.has(post.id) ? editorHTML(post) : post.text ? postTextHTML(post, me) : '') +
        imageHTML +
        embedHTML +
        songHTML +
        videoHTML +
        '<div class="feed-post-footer">' +
          starHTML +
          pillsHTML +
          (post.reply_count ? '<button type="button" class="feed-post-reply-open feed-post-reply-count" data-post-id="' + post.id + '" title="Reply"><i class="ti ti-message-circle"></i><span>' + klabCount(post.reply_count, 'reply', 'replies') + '</span></button>' : '') +
        '</div>' +
        feedRepliesSectionHTML(post) +
      '</div>' +
    '</div>';
  }

  // Everything postHTML() actually reads, so an unchanged feed can skip the
  // innerHTML swap entirely. Same idea as renderChannelList()'s
  // _lastChannelListKey and renderTimeline()'s _lastTimelineRenderKey — the
  // feed was the one list without it.
  let _lastFeedRenderKey = null;
  let _peopleVer = 0; // bumped when the roster changes: mentions are drawn from it
  // Per-post so the renderer can tell WHICH posts changed, not just that
  // something did. Everything postHTML() reads about one post goes in here.
  function postRenderKey(p, me) {
    {
        const replies = _repliesCache.get(p.id);
        // No timestamps in here: they're relative ("5m", "2h") and used to
        // rebuild a post every time one ticked over, which stopped a playing
        // video and re-hid spoilers. refreshFeedTimes() updates them in place.
        return p.id +
          // Who's looking decides the delete buttons and which mentions
          // are "you"; /api/me can land after the first render.
          ':' + (me || '') + (window.KLAB_USER?.is_admin ? 'A' : '') +
          ':' + (p.reply_count || 0) +
          ':' + JSON.stringify(p.reactions || {}) +
          ':' + profileColor(p.username) +
          ':' + (_feedAvatarCache.get(p.username) || '') +
          ':' + (p.image_mxc ? (_feedImageCache.get(p.image_mxc) || '') : '') +
          ':' + (p.video ? p.video.id + '.' + (p.video.status || '') + '.' + (p.video.poster || '') : '') +
          ':' + (_openReplyBoxes.has(p.id) ? 'r' : '') + (_expandedPosts.has(p.id) ? 'x' : '') + (_editing.has(p.id) ? 'e' : '') + ':' + (p.edited || '') +
          ':' + (replies
            ? replies.map(r => r.id + '@' + (_feedAvatarCache.get(r.username) || '')).join('+')
            : '-') +
          // Only posts that could hold a mention follow the roster.
          ((p.text || '').includes('@') || replies?.some(r => (r.text || '').includes('@')) ? ':' + _peopleVer : '');
    }
  }
  // The part of a post above its footer: when only reactions, replies or
  // the reply box changed, the post keeps its body (a playing video, an
  // opened spoiler) and just its footer and replies are swapped.
  function postBodyKey(p, me) {
    return p.id + ':' + (me || '') + (window.KLAB_USER?.is_admin ? 'A' : '') +
      ':' + profileColor(p.username) + ':' + (_feedAvatarCache.get(p.username) || '') +
      ':' + (p.image_mxc ? (_feedImageCache.get(p.image_mxc) || '') : '') + ':' + (_expandedPosts.has(p.id) ? 'x' : '') +
      ':' + (_editing.has(p.id) ? 'e' : '') + (p.edited || '') +
      ((p.text || '').includes('@') ? ':' + _peopleVer : '');
  }
  // Takes the per-post keys already worked out, so each render builds them once.
  function feedRenderKey(keys, me) {
    // The date too: "Today" and "Yesterday" are in the day headers.
    return (me || '') + '|' + (_mentionsOnly ? '1' : '0') + '|' + (_feedHasMore ? '1' : '0') + '|' + _dayFmt.format(new Date()) + '|' + keys.join(',');
  }

  // Relative times are text in place, not part of any key: updated here on
  // a timer and whenever the feed comes back into view.
  function refreshFeedTimes() {
    if (document.hidden || !listEl.offsetParent) return;
    listEl.querySelectorAll('.feed-post-time[data-created], .k-com-time[data-created]').forEach(el => {
      const t = fmtFeedTime(el.dataset.created);
      if (el.textContent !== t) el.textContent = t;
    });
  }

  const FEED_TZ = 'America/New_York';
  // toLocaleDateString with a timeZone builds a new formatter every call,
  // and this runs twice per post per render.
  const _dayFmt     = new Intl.DateTimeFormat('en-US', { timeZone: FEED_TZ });
  const _weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: FEED_TZ, weekday: 'long' });
  const _monthDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: FEED_TZ, month: 'long', day: 'numeric' });
  const feedDate = created => new Date(String(created).replace(' ', 'T') + 'Z');
  const _dayKeys = new WeakMap(); // post -> [created, day key]
  function feedDayKey(p) {
    const hit = _dayKeys.get(p);
    if (hit && hit[0] === p.created) return hit[1];
    const dk = _dayFmt.format(feedDate(p.created));
    _dayKeys.set(p, [p.created, dk]);
    return dk;
  }
  const _dayHeaders = new Map();
  function dayHeaderEl(dk, created, n) {
    let el = _dayHeaders.get(dk);
    if (!el) { el = document.createElement('div'); el.className = 'feed-day'; _dayHeaders.set(dk, el); }
    const today = _dayFmt.format(new Date());
    const yest = _dayFmt.format(new Date(Date.now() - 864e5));
    const d = feedDate(created);
    const name = dk === today ? 'Today' : dk === yest ? 'Yesterday' : _weekdayFmt.format(d);
    const html = '<div class="feed-day-in"><h3>' + name + '</h3><span>' + _monthDayFmt.format(d) +
      ' · ' + n + (n === 1 ? ' post' : ' posts') + '</span></div>';
    if (el.innerHTML !== html) el.innerHTML = html;
    return el;
  }

  // Posts ease in the first time they scroll into view.
  const _seenPosts = new Set();
  const _entryIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('seen');
    _seenPosts.add(e.target.dataset.postId);
    _entryIO.unobserve(e.target);
  }), { rootMargin: '0px 0px -8% 0px' }) : null;
  // The observer alone wasn't enough: in the Linux app a first load could
  // leave every post at opacity 0 (Feed's colours moving as you scrolled,
  // nothing to see) until a hard reload. So the page also looks for
  // itself, on scroll, resize, arriving on Feed and each render: any post
  // not yet shown whose top is above the window's foot is shown. Posts are
  // in order down the page, so it stops at the first one still below.
  let _revealRaf = 0;
  function revealInView() {
    _revealRaf = 0;
    const list = document.getElementById('feedList');
    if (!list?.offsetParent) return;
    for (const el of list.querySelectorAll(':scope > .feed-post:not(.seen), :scope > * > .feed-post:not(.seen)')) {
      if (el.getBoundingClientRect().top >= innerHeight) break;
      el.classList.add('seen');
      _seenPosts.add(el.dataset.postId);
      _entryIO?.unobserve(el);
    }
  }
  const revealSoon = () => { if (!_revealRaf) _revealRaf = requestAnimationFrame(revealInView); };
  document.addEventListener('scroll', revealSoon, { capture: true, passive: true });
  window.addEventListener('resize', revealSoon, { passive: true });
  document.addEventListener('visibilitychange', revealSoon);

  // Which posts are on screen, kept by the browser so scrolling never has
  // to measure the whole list (it can be well over a thousand posts).
  const _onScreen = new Set();
  const _visIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting && e.target.isConnected) {
      _onScreen.add(e.target);
      // Replies to an older post (past the newest page the poll asks for)
      // were never asked about again: someone's reply to a two-day-old
      // post didn't show until a reload. Coming on screen a while after
      // they were last fetched, they're asked for afresh.
      const id = +e.target.dataset.postId, at = _repliesAt.get(id);
      if (at && performance.now() - at > 90e3 && !_repliesPending.has(id)) {
        const post = _feedPosts.find(p => p.id === id);
        if (post) { _repliesStale.add(id); ensureFeedRepliesResolved(post); }
      }
      const art = e.target.querySelector(':scope > .feed-post-backart:not(.soft)');
      if (art) window.klabSoften?.(art);
    }
    else { _onScreen.delete(e.target); if (!e.target.isConnected) _visIO.unobserve(e.target); }
  })) : null;

  // A YouTube player is a whole page of its own (tens of MB each), and a
  // long scroll back kept every one it passed. Three screens away it's
  // unloaded, and loaded again on the way back. Its root is Feed's own
  // panel, which is what scrolls now: against the window, the panel's clip
  // cut the 300% margin off and a video unloaded (sound and all) the
  // moment it scrolled a little out of sight.
  const _embedIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(e => {
    const f = e.target;
    if (e.isIntersecting) { if (f.dataset.src) { f.src = f.dataset.src; delete f.dataset.src; } }
    // Not when Feed itself is hidden (no box at all): a video playing on
    // goes on playing while you're on another tab.
    else if (e.boundingClientRect.width && !f.dataset.src && f.getAttribute('src') !== 'about:blank') { f.dataset.src = f.src; f.src = 'about:blank'; }
  }), { root: document.querySelector('.tab-panel[data-tab-panel="feed"]'), rootMargin: '300% 0px' }) : null;

  // A shared song that's the one playing right now shows its record out and spinning.
  function syncFeedRecords() {
    const id = playerState.currentSong?.id, on = !!playerState.playing;
    listEl.querySelectorAll(':scope > .feed-post.is-song').forEach(el => el.classList.toggle('playing', on && !!id && el.dataset.songId === String(id)));
  }
  ['play', 'pause', 'ended', 'loadedmetadata'].forEach(ev => playerState.audio.addEventListener(ev, syncFeedRecords));

  function buildPostEl(post, key) {
    const wrap = document.createElement('div');
    wrap.innerHTML = postHTML(post);
    const el = wrap.firstElementChild;
    el.dataset.postKey = key;
    el.dataset.postBody = postBodyKey(post, window.KLAB_USER?.username);
    if (_seenPosts.has(String(post.id)) || !_entryIO || !(window.klabMotionOk?.() ?? true)) el.classList.add('seen');
    else { _entryIO.observe(el); revealSoon(); }
    _visIO?.observe(el);
    el.querySelectorAll('.feed-post-embed iframe').forEach(f => _embedIO?.observe(f));
    return el;
  }
  // Only the footer and replies changed: swap those into the post that's
  // there, and its gold edge if the stars crossed the line.
  function patchPostEl(el, post, key) {
    const wrap = document.createElement('div');
    wrap.innerHTML = postHTML(post);
    const fresh = wrap.firstElementChild;
    for (const sel of [':scope > .feed-post-body > .feed-post-footer', ':scope > .feed-post-body > .feed-post-replies']) {
      const a = el.querySelector(sel), b = fresh.querySelector(sel);
      if (a && b) a.replaceWith(b);
    }
    el.classList.toggle('gold', fresh.classList.contains('gold'));
    el.dataset.postKey = key;
  }
  function dropPostEl(el) {
    _entryIO?.unobserve(el);
    _visIO?.unobserve(el);
    _onScreen.delete(el);
    el.querySelectorAll('.feed-post-embed iframe').forEach(f => _embedIO?.unobserve(f));
    el.remove();
  }

  // Reconciles post by post instead of replacing the whole list. A single
  // reaction, one avatar resolving, or a timestamp ticking over used to
  // re-create every <img> and <iframe> on screen — that's the flicker, and
  // spam-clicking a reaction made it continuous. Now only the posts whose
  // own key changed get rebuilt; everything else is left alone entirely.
  function renderFeed() {
    // Nothing to draw until a fetch has worked. This is also called from
    // outside (presence's profile refresh), and drawing the empty list
    // replaced the loading or Retry message with "No posts yet".
    if (!_feedLoadedOk) return;
    window.klabHomeFeedChanged?.(_feedPosts.slice(0, 12));
    const me = window.KLAB_USER?.username;
    const posts = _mentionsOnly ? _feedPosts.filter(p => textMentions(p.text, me)) : _feedPosts;
    const keys = posts.map(p => postRenderKey(p, me));
    const key = feedRenderKey(keys, me);
    if (key === _lastFeedRenderKey) return;
    // NOT cached yet — see the deferred check at the end. Caching here
    // while the typing guard below has deliberately left a post stale is
    // what made new replies invisible until a reload: the post was skipped,
    // but the key was stored as though it had been drawn, so every later
    // render matched it and returned right here.
    let deferred = false;

    if (!posts.length) {
      listEl.querySelectorAll(':scope > .feed-post').forEach(dropPostEl);
      listEl.innerHTML = '<div class="feed-empty">' + (_mentionsOnly ? 'No mentions yet' : 'No posts yet') + '</div>';
    } else {
      // Typing in a reply box must survive a re-render happening around it
      // (a 30s poll, someone else's reaction, an avatar resolving). The
      // post being typed in is skipped below, but a prepended new post
      // still shifts everything, and moving a node blurs whatever's inside
      // it — so the caret is saved and put back.
      // Only a TEXT FIELD counts as "someone is mid-sentence here". This
      // used to be any focused element at all, and a real mouse click
      // focuses the button it hit — so clicking a reaction pill or the
      // add-reaction button focused it, and this guard then refused to
      // rebuild the one post that had just changed. The reaction appeared
      // to do nothing whatsoever. It survived testing because a synthetic
      // .click() moves no focus, so only real users ever hit it.
      const active = document.activeElement;
      const typingIn = active && listEl.contains(active)
        && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
        ? active : null;
      const caret = typingIn && typingIn.selectionStart != null
        ? [typingIn.selectionStart, typingIn.selectionEnd] : null;

      const existing = new Map();
      listEl.querySelectorAll(':scope > .feed-post[data-post-id]').forEach(el => existing.set(el.dataset.postId, el));
      let refocusReply = null;

      // Day chapters (Eastern, where everyone is): a sticky header before the
      // first post of each day. Headers are reused by day so they don't
      // count as changes; they're in `keep` below like the posts.
      const counts = new Map();
      posts.forEach(p => { const k = feedDayKey(p); counts.set(k, (counts.get(k) || 0) + 1); });
      let lastDay = null;
      const desired = [];
      posts.forEach((p, i) => {
        const dk = feedDayKey(p);
        if (dk !== lastDay) { lastDay = dk; desired.push(dayHeaderEl(dk, p.created, counts.get(dk))); }
        desired.push(postEl(p, keys[i]));
      });
      function postEl(p, k) {
        const id = String(p.id);
        const el = existing.get(id);
        existing.delete(id);
        if (el && el.dataset.postKey === k) return el;          // unchanged
        // Don't yank a post out from under someone mid-sentence. Leaving
        // the key stale means it rebuilds on the next render once focus
        // has moved on.
        // An empty reply box has nothing to lose, though, and sending a
        // reply leaves you in one: holding the post back there meant new
        // replies to it never showed while you stayed in the box. It's
        // rebuilt and the new box gets the focus back (below).
        if (el && typingIn && el.contains(typingIn)) {
          if (typingIn.value || !typingIn.classList.contains('feed-post-reply-input')) { deferred = true; return el; }
          refocusReply = id;
        }
        if (el && el.dataset.postBody === postBodyKey(p, me)) { patchPostEl(el, p, k); return el; }
        return buildPostEl(p, k);
      }

      // Drop everything that isn't staying BEFORE positioning: a replaced
      // node left in place shifts every index after it, so the position
      // pass would then "fix" each one by moving it — which is a remove +
      // insert per post, i.e. the whole-list rebuild this is meant to
      // avoid. `existing` still holds posts that vanished; the rest is
      // stale nodes (a replaced post, the empty-state div).
      existing.forEach(dropPostEl);
      const keep = new Set(desired);
      [...listEl.children].forEach(el => { if (!keep.has(el)) dropPostEl(el); });

      desired.forEach((el, i) => {
        if (listEl.children[i] !== el) listEl.insertBefore(el, listEl.children[i] || null);
      });

      if (typingIn && document.activeElement !== typingIn && typingIn.isConnected) {
        typingIn.focus();
        if (caret) { try { typingIn.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
      } else if (refocusReply && !typingIn.isConnected) {
        listEl.querySelector('.feed-post-reply-input[data-post-id="' + refocusReply + '"]')?.focus({ preventScroll: true });
      }
    }
    // Only remember the key if what's on screen actually matches it. If the
    // typing guard held a post back, leave it null so the next render has to
    // do the work again rather than short-circuiting forever.
    _lastFeedRenderKey = deferred ? null : key;
    unfoldShortPosts();
    syncFeedRecords();
    loadMoreEl.hidden = !_feedHasMore || _mentionsOnly;
    if (mentionsBtnEl) mentionsBtnEl.classList.toggle('is-active', _mentionsOnly);
    updateMentionsDot();
  }

  // "Is it long" is guessed from the text; once it's on screen, a folded
  // post that actually fits gets its button taken away. Skipped while the
  // feed is hidden (everything measures 0 there) and re-checked on return.
  function unfoldShortPosts() {
    listEl.querySelectorAll('.feed-post-text.md-folded').forEach(el => {
      if (!el.clientHeight || el.scrollHeight > el.clientHeight + 8) return;
      el.classList.remove('md-folded');
      const btn = el.nextElementSibling;
      if (btn && btn.classList.contains('feed-post-more')) btn.remove();
    });
  }
  // Also re-checks the mentions dot: its dwell timer gives up if you're not
  // on the feed when it fires, and a poll with nothing new doesn't render,
  // so a mention seen on the way back in stayed "unread" indefinitely. And
  // a draft restored while another tab was showing was sized against a
  // hidden textarea, clipped to its first two lines.
  window.klabFeedShown = () => { if (!_feedLoadedOk) fetchFeed(); revealSoon(); unfoldShortPosts(); refreshFeedTimes(); updateMentionsDot(); if (textEl.value) autoGrowComposer(); };

  // Avatar/image/reply resolutions land one at a time; a cold load of 50
  // posts fired ~35 separate full rebuilds, each re-creating every <img> on
  // screen. Coalescing them into one frame is most of the "flickering".
  let _feedRenderQueued = false;
  function scheduleFeedRender() {
    if (_feedRenderQueued) return;
    _feedRenderQueued = true;
    requestAnimationFrame(() => { _feedRenderQueued = false; renderFeed(); });
  }

  // Exposed so openProfileModal() (defined earlier in this script, KLAB
  // SOCIAL section) can repaint the feed with a freshly-saved chat
  // color/bio/banner — renderFeed/listEl are private to this IIFE, same
  // reason presence exposes window.KLAB_REFRESH_MY_AVATAR.
  window.KLAB_REFRESH_FEED = renderFeed;
  window.klabFeedPosts = (n = 12) => _feedLoadedOk ? _feedPosts.slice(0, n) : null;
  // A post's picture for Social's home: the URL once it's loaded (null
  // till then; the load re-renders the feed, which tells Social's home).
  window.klabFeedImage = mxc => { ensureFeedImage(mxc); return _feedImageCache.get(mxc) || null; };
  window.klabLoadFeed = () => _feedLoadedOk && Date.now() - _feedFetchedAt < 30000 ? Promise.resolve() : fetchFeed();
  // A new profile picture: this cache still had the old one, so feed
  // posts, Home, the mention list and the request list kept the old face
  // until a reload. The old blob goes once nothing is showing it.
  window.klabFeedForgetAvatar = username => {
    const old = _feedAvatarCache.get(username);
    _feedAvatarCache.delete(username);
    _feedAvatarFailedAt.delete(username);
    ensureFeedAvatar(username);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 5000);
    // The sidebar's "you" (js/24-flair.js) shows the new one once it's in.
    if (username === window.KLAB_USER?.username) [1500, 4000].forEach(t => setTimeout(() => window.dispatchEvent(new Event('klab:me')), t));
  };
  // The people list arrived or grew: mentions that are real now get coloured.
  window.addEventListener('klab:people', () => { _peopleVer++; renderFeed(); if (textEl.value) autoGrowComposer(); });

  // Exposed so anything outside this IIFE showing a plain klabnet username
  // (not a full Matrix ID) can resolve its avatar without duplicating the
  // Matrix-profile-lookup + blob-URL-cache dance — the Music tab's request
  // list is the first outside consumer. Kicks off the async lookup if
  // needed (fire-and-forget, re-renders happen via the caller's own
  // refresh) and returns whatever's cached right now (null if unresolved
  // or still pending).
  window.klabResolveUserAvatar = function(username) {
    ensureFeedAvatar(username);
    return _feedAvatarCache.get(username) || null;
  };
  // Home's links to a post land on it.
  window.klabFeedFocus = function(postId) {
    setActiveTab('feed');
    const find = () => listEl.querySelector('.feed-post[data-post-id="' + Number(postId) + '"]');
    requestAnimationFrame(async () => {
      // Home polls on its own clock, so it can know about a post the feed
      // hasn't fetched yet.
      if (!find()) { await fetchFeed(); renderFeed(); }
      // An older post (a recap row, a profile): page back for it, a few
      // pages at most, while the post is older than what's loaded.
      for (let i = 0; i < 6 && !find() && _feedHasMore && _feedPosts.length &&
           Number(postId) < _feedPosts[_feedPosts.length - 1].id; i++) {
        while (_feedPending) await new Promise(r => setTimeout(r, 120));
        const before = _feedPosts.length;
        await loadOlderPosts();
        if (_feedPosts.length === before) break;
      }
      const el = find();
      if (!el) { showToast('That post is too far back, or gone', 'ti-news'); return; }
      el.scrollIntoView({ block: 'center', behavior: window.klabMotionOk?.() ? 'smooth' : 'auto' });
      el.classList.remove('feed-post-flash'); void el.offsetWidth; el.classList.add('feed-post-flash');
    });
  };

  function fetchFeed() {
    if (_feedRefreshPromise) return _feedRefreshPromise;
    _feedRefreshPromise = fetchFeedPage().finally(() => { _feedRefreshPromise = null; });
    return _feedRefreshPromise;
  }

  // fetchTimeout's clock stops when the headers arrive, and the body had
  // none: a response that stalled halfway (a network blip, sleep and wake)
  // left r.json() waiting forever with _feedPending set, so every poll,
  // visibilitychange and visit to Feed returned at once and Feed sat on
  // "Loading feed…" (or never updated) until a reload. This deadline
  // covers the body too: aborting makes r.json() throw, and the caller's
  // retry takes over.
  async function getPostsJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetchTimeout(url, { signal: ctrl.signal }, 8000);
      if (!r.ok) throw new Error('bad status');
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function fetchFeedPage() {
    if (_feedPending) return;
    // Was polled every 30s unconditionally, including in a backgrounded
    // tab — matches the visibility-guard pattern already used for
    // presence/notes/profiles polling elsewhere in the app.
    // Except for someone who asked to be told about mentions while klabnet
    // is in the background: the poll is the only thing that finds them.
    // Never the first load, though: the desktop app builds its window
    // hidden and shows it when the page is ready, so its first fetch was
    // always skipped, and Feed sat blank after a launch or an update until
    // a visibilitychange that Wayland doesn't always send (or the next poll).
    if (_feedLoadedOk && document.hidden && !(_settings.desktopNotif && 'Notification' in window && Notification.permission === 'granted')) return;
    _feedPending = true;
    // Derived from _feedPosts.length before, which isn't "first load" — it's
    // "empty right now". An empty feed, or one whose first load failed,
    // therefore repainted "loading feed…" over itself on every 30s poll and
    // then repainted it back: a blank flash on a loop, for exactly the
    // people already having trouble loading.
    const isFirstLoad = !_feedLoadedOnce;
    // Nothing rendered yet on the very first load — a blank panel with no
    // indication anything is happening. Every other panel in the app
    // (picker, requests) already shows a "loading…" state;
    // the feed just never got one.
    if (isFirstLoad) {
      listEl.innerHTML = '<div class="feed-empty">Loading feed…</div>';
      _lastFeedRenderKey = null; // we just clobbered the DOM out from under the key
    }
    const startedAt = performance.now();
    try {
      const data = await getPostsJSON(`/api/posts?limit=${FEED_PAGE_SIZE}`);
      _feedFetchedAt = Date.now();
      const page = data.posts || [];
      const fresh = page.filter(p => !_locallyDeleted.has(p.id));
      // Merge the newest page into whatever's already loaded instead of
      // replacing wholesale — this runs on a 30s poll and after every post
      // submit, and a plain replace was silently discarding any older pages
      // the user had already paged in via "Load older", snapping the list
      // back to just the newest 50 out from under them.
      const byId = new Map(_feedPosts.map(p => [p.id, p]));
      const newestBefore = _feedPosts.length ? _feedPosts[0].id : null;
      // Someone else's deleted post: anything inside the range this page
      // covers that the server no longer returns is gone (all of it, when
      // the page is the whole feed).
      const freshIds = new Set(fresh.map(p => p.id));
      const pageFull = page.length === FEED_PAGE_SIZE;
      const oldestFresh = pageFull ? page[page.length - 1].id : -Infinity;
      // A full page that doesn't reach back to anything already loaded
      // (more than a page of posts while this tab was hidden) would leave
      // a hole between it and the old posts. Start over from this page
      // and let "Load older" walk back down instead.
      const newestResident = _feedPosts.length ? _feedPosts[0].id : null;
      const gap = _feedLoadedOk && pageFull && newestResident !== null && oldestFresh > newestResident;
      if (gap) {
        byId.forEach((p, id) => { _repliesCache.delete(id); _repliesStale.delete(id); });
        byId.clear();
      }
      byId.forEach((p, id) => { if (id >= oldestFresh && !freshIds.has(id)) byId.delete(id); });
      fresh.forEach(p => {
        // Changed here after this poll went out: what we have is newer.
        if (byId.has(p.id) && (_localEditAt.get(p.id) || 0) > startedAt) return;
        // New replies from other people: the count moved, so refetch them.
        // The old ones stay up meanwhile rather than blinking out.
        const cached = _repliesCache.get(p.id);
        if (cached && cached.length !== (p.reply_count || 0)) {
          if (p.reply_count) _repliesStale.add(p.id);
          else { _repliesCache.set(p.id, []); _repliesStale.delete(p.id); }
        }
        byId.set(p.id, p);
      });
      _feedPosts = [...byId.values()].sort((a, b) => b.id - a.id);
      // Other people's new posts while you're down the Feed reading: a
      // "New posts" chip up top, rather than the list moving under you.
      if (newestBefore != null) {
        const me = window.KLAB_USER?.username;
        const fresh = _feedPosts.filter(p => p.id > newestBefore && p.username !== me).length;
        if (fresh) newPostsChip(fresh);
      }
      // _feedHasMore is otherwise owned by loadOlderPosts() once pagination
      // has started — only the first good load (or a restart after a gap)
      // should derive it from this top-page fetch.
      if (!_feedLoadedOk || gap) _feedHasMore = pageFull;
      _feedLoadedOk = true;
      _feedRetryMs = 0;
      clearTimeout(_feedRetryTimer);
      const signature = _feedPosts.map(p => `${p.id}:${p.reply_count || 0}:${p.edited || ''}:${JSON.stringify(p.reactions || {})}`).join('|');
      // Most 30s polls come back with nothing actually new — skip the full
      // list rebuild when this fetch changed nothing. Every other trigger
      // (posting, reacting, replying, deleting, avatar/image resolving)
      // still calls renderFeed() directly and unconditionally elsewhere;
      // this only short-circuits the specific "just refetched, nothing
      // changed" case, regardless of which caller triggered the fetch.
      // Also when the last render was held back by the typing guard (key
      // left null): nothing else re-renders once focus leaves that reply
      // box, so a new reply on that post stayed hidden until some unrelated
      // change came along.
      if (signature !== _lastFeedPostsSignature || _lastFeedRenderKey === null) {
        _lastFeedPostsSignature = signature;
        renderFeed();
      }
    } catch (e) {
      // Only a feed that never loaded needs a visible error — a background 30s poll
      // failing after posts are already showing just leaves the last-known
      // feed on screen (same pattern presence's own poll failure uses),
      // rather than yanking already-read content out from under someone.
      if (!_feedLoadedOk) {
        listEl.innerHTML = '<div class="feed-empty">Couldn’t load the feed<button type="button" id="feedRetryBtn" class="feed-load-more">Retry</button></div>';
        // Shows it's trying again; otherwise a retry that failed redrew the
        // identical error and looked like the button did nothing.
        document.getElementById('feedRetryBtn')?.addEventListener('click', () => {
          listEl.innerHTML = '<div class="feed-empty">Loading feed…</div>';
          fetchFeed();
        });
        _lastFeedRenderKey = null;
        _feedRetryMs = Math.min(_feedRetryMs ? _feedRetryMs * 2 : 2000, 16000);
        clearTimeout(_feedRetryTimer);
        _feedRetryTimer = setTimeout(fetchFeed, _feedRetryMs);
      }
    } finally {
      _feedPending = false;
      // Set even on failure: the retry button is the route back, and
      // re-flashing "loading feed…" over that error every 30s is the bug
      // this flag exists to stop.
      _feedLoadedOnce = true;
      window.KLAB_BOOT?.mark('feed');
    }
  }

  async function loadOlderPosts() {
    if (_feedPending || !_feedPosts.length) return;
    _feedPending = true;
    const oldestId = _feedPosts[_feedPosts.length - 1].id;
    try {
      const data = await getPostsJSON(`/api/posts?limit=${FEED_PAGE_SIZE}&before_id=${oldestId}`);
      const older = data.posts || [];
      _feedPosts = _feedPosts.concat(older.filter(p => !_locallyDeleted.has(p.id)));
      // Was unbounded — "Load older" had no cap, so a long session that
      // scrolled back far enough kept every post (and its cached replies/
      // avatar/image blobs, see _repliesCache/_feedImageCache) resident
      // forever, each one re-serialized into renderFeed()'s full rebuild
      // every time. Trimming the oldest tail beyond FEED_MAX_LOADED can
      // leave a small gap in *very* old scrollback if someone loads past
      // this cap and then loads older still in the same sitting — a
      // reasonable trade for not growing without limit; a fresh page load
      // re-paginates cleanly from the top regardless.
      if (_feedPosts.length > FEED_MAX_LOADED) {
        // Also drop the trimmed posts' cached replies — otherwise
        // _repliesCache keeps growing by post id forever even though
        // _feedPosts itself is now capped.
        _feedPosts.slice(FEED_MAX_LOADED).forEach(p => { _repliesCache.delete(p.id); _repliesAt.delete(p.id); _repliesPending.delete(p.id); _repliesStale.delete(p.id); _replyDrafts.delete(p.id); });
        _feedPosts.length = FEED_MAX_LOADED;
        // The trim just cut the page that was loaded, so another press
        // would fetch the same page and cut it again, forever. The cap is
        // the end of the line for this sitting.
        _feedHasMore = false;
      } else {
        _feedHasMore = older.length === FEED_PAGE_SIZE;
      }
      renderFeed();
    } catch (e) {
    } finally {
      _feedPending = false;
    }
  }

  // ── Composer extras: live preview, the big editor, count, draft ──
  const composerEl   = document.getElementById('feedComposer');
  const toolbarEl    = document.getElementById('feedMdToolbar');
  const liveEl       = document.getElementById('feedComposerLive');
  const liveBodyEl   = document.getElementById('feedComposerLiveBody');
  const helpEl       = document.getElementById('feedMdHelp');
  const helpBtnEl    = document.getElementById('feedMdHelpBtn');
  const previewBtnEl = document.getElementById('feedMdPreviewBtn');
  const expandBtnEl  = document.getElementById('feedMdExpandBtn');
  const countEl      = document.getElementById('feedComposerCount');
  const composerScrimEl = document.createElement('div');
  composerScrimEl.className = 'feed-composer-scrim';
  const composerHome = document.createComment('feed composer');
  let _previewOn = false, _previewQueued = false;

  function renderPreview() {
    _previewQueued = false;
    if (liveEl.hidden || !window.klabMarkdown) return;
    const v = textEl.value;
    liveBodyEl.innerHTML = v.trim()
      ? klabMarkdown(v, window.KLAB_USER?.username, { nocache: true })
      : '<span class="feed-composer-live-empty">Nothing to preview yet</span>';
  }
  function updateComposerExtras() {
    if (!_previewQueued && !liveEl.hidden) { _previewQueued = true; requestAnimationFrame(renderPreview); }
    const n = textEl.value.length;
    countEl.hidden = n < FEED_MAX_CHARS * 0.8;
    if (!countEl.hidden) {
      countEl.textContent = n.toLocaleString() + ' / ' + FEED_MAX_CHARS.toLocaleString();
      countEl.classList.toggle('over', n > FEED_MAX_CHARS);
    }
    composerEl.classList.toggle('has-text', n > 0);
  }
  function setPreview(on) {
    _previewOn = on;
    // The big editor always shows it, side by side.
    liveEl.hidden = !(on || composerEl.classList.contains('expanded'));
    previewBtnEl.classList.toggle('on', on);
    previewBtnEl.setAttribute('aria-pressed', String(on));
    renderPreview();
  }
  function setExpanded(on) {
    const run = () => {
      // Lifted out to <body> while big: inside the feed column, an
      // ancestor's stacking context put it under its own scrim and pinned
      // "fixed" to the column. A marker keeps its place for the way back.
      if (on && !composerHome.isConnected) {
        composerEl.before(composerHome);
        document.body.appendChild(composerScrimEl);
        document.body.appendChild(composerEl);
      } else if (!on && composerHome.isConnected) {
        composerHome.replaceWith(composerEl);
        composerScrimEl.remove();
      }
      composerEl.classList.toggle('expanded', on);
      document.body.classList.toggle('feed-composer-open', on);
      expandBtnEl.classList.toggle('on', on);
      expandBtnEl.setAttribute('aria-pressed', String(on));
      expandBtnEl.title = on ? 'Back to normal size (Esc)' : 'Big editor';
      expandBtnEl.innerHTML = '<i class="ti ti-arrows-' + (on ? 'minimize' : 'maximize') + '"></i>';
      setPreview(_previewOn);
      autoGrowComposer();
    };
    // Morph between the two sizes where the browser can.
    if (document.startViewTransition && window.klabMotionOk?.()) {
      composerEl.style.viewTransitionName = 'feed-composer';
      const t = document.startViewTransition(run);
      t.finished.finally(() => { composerEl.style.viewTransitionName = ''; textEl.focus(); });
    } else { run(); textEl.focus(); }
  }
  let _draftTimer = 0;
  function saveDraftNow() {
    clearTimeout(_draftTimer);
    try { textEl.value ? localStorage.setItem(DRAFT_KEY, textEl.value) : localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }
  function saveDraftSoon() { clearTimeout(_draftTimer); _draftTimer = setTimeout(saveDraftNow, 400); }

  function autoGrowComposer() {
    updateComposerExtras();
    if (composerEl.classList.contains('expanded')) {
      // The big editor is a fixed-height pane that scrolls; no growing.
      textEl.style.height = ''; textEl.style.overflowY = 'auto';
      if (highlightEl) { highlightEl.innerHTML = window.klabMdSyntax ? klabMdSyntax(textEl.value) : mentionHTML(textEl.value, null); highlightEl.scrollTop = textEl.scrollTop; }
      return;
    }
    textEl.style.height = '44px'; // shrink first so deleting text un-grows it, not just growing one-way
    // Read scrollHeight once — it forces a synchronous reflow either way
    // (the write just above is still pending), but reading it a second
    // time for the overflow check forced a second one on every single
    // keystroke for no reason, since the value can't have changed between
    // the two reads.
    const sh = textEl.scrollHeight;
    textEl.style.height = Math.min(sh, 220) + 'px';
    textEl.style.overflowY = sh > 220 ? 'auto' : 'hidden';
    if (highlightEl) {
      highlightEl.innerHTML = window.klabMdSyntax ? klabMdSyntax(textEl.value) : mentionHTML(textEl.value, null);
      highlightEl.scrollTop = textEl.scrollTop;
    }
  }

  // Shows/clears the "share to feed" song attachment preview. Called both
  // locally (clearComposer, the X button) and from window.klabShareSongToFeed
  // — the player module (a separate IIFE elsewhere in the file) has no
  // other way to reach into this closure's composer state.
  function setPendingSong(song) {
    _pendingSong = song || null;
    _pendingVideo = null;
    songPreviewEl.classList.remove('is-video');
    if (!song) { songPreviewEl.hidden = true; return; }
    songArtEl.src = song.coverArt
      ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=100&${subsonicParams()}`
      : '';
    songTitleEl.textContent = song.title || 'Unknown';
    songArtistEl.textContent = song.artist || '';
    // Shared from a point in it: from there, or press to share it whole.
    const at = document.getElementById('feedComposerSongAt');
    at.hidden = !(song.start > 0);
    if (song.start > 0) {
      at.innerHTML = '<i class="ti ti-clock"></i>From ' + formatTime(song.start) + '<i class="ti ti-x"></i>';
      at.title = 'Share it from the start instead';
    }
    if (song.lyric) {
      songLyricEl.textContent = `"${song.lyric}"`;
      songLyricEl.hidden = false;
    } else {
      songLyricEl.hidden = true;
      songLyricEl.textContent = '';
    }
    songPreviewEl.hidden = false;
  }
  // A video, in the same box: its poster, title and who it's by.
  function setPendingVideo(v) {
    setPendingSong(null);
    _pendingVideo = v || null;
    if (!v) return;
    songPreviewEl.classList.add('is-video');
    songArtEl.src = v.poster || '';
    songTitleEl.textContent = v.title || 'Video';
    songArtistEl.textContent = 'Video · ' + (v.username || '');
    songLyricEl.hidden = true;
    const at = document.getElementById('feedComposerSongAt');
    at.hidden = !(v.start > 0);
    if (v.start > 0) {
      at.innerHTML = '<i class="ti ti-clock"></i>From ' + formatTime(v.start) + '<i class="ti ti-x"></i>';
      at.title = 'Share it from the start instead';
    }
    songPreviewEl.hidden = false;
  }
  window.klabShareVideoToFeed = function(v) {
    setPendingVideo(v);
    textEl.focus();
  };
  songRemoveEl.addEventListener('click', () => setPendingSong(null));
  document.getElementById('feedComposerSongAt')?.addEventListener('click', () => {
    if (_pendingVideo) { const { start, ...whole } = _pendingVideo; setPendingVideo(whole); return; }
    if (!_pendingSong) return;
    const { start, ...whole } = _pendingSong;
    setPendingSong(whole);
  });
  // Entry point for the player dock / fullscreen player's "share to feed"
  // buttons — they already call setActiveTab('feed') themselves before
  // this, so focusing the composer here lands the user ready to type a
  // remark immediately.
  window.klabShareSongToFeed = function(song) {
    setPendingSong(song);
    textEl.focus();
  };

  function clearComposer() {
    textEl.value = '';
    saveDraftNow();
    if (composerEl.classList.contains('expanded')) setExpanded(false);
    _pendingFile = null;
    fileEl.value = '';
    previewWrapEl.hidden = true;
    imageBtnEl.classList.remove('has-image');
    setPendingSong(null);
    errEl.hidden = true;
    autoGrowComposer();
  }

  async function submitPost() {
    if (postBtnEl.disabled) return; // already sending: ⌘↵ held down or pressed twice
    const text = textEl.value.trim();
    if (!text && !_pendingFile && !_pendingSong && !_pendingVideo) return;
    if (text.length > FEED_MAX_CHARS) {
      errEl.textContent = 'Too long by ' + (text.length - FEED_MAX_CHARS).toLocaleString() + ' characters';
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    postBtnEl.disabled = true;
    postBtnEl.innerHTML = '<i class="ti ti-loader loading-spinner"></i>';
    try {
      let image_mxc = '';
      if (_pendingFile) {
        const client = MatrixChat.client;
        if (!client) throw new Error('Connect chat in the Chat tab first to post images');
        const upload = await client.uploadContent(_pendingFile);
        image_mxc = upload.content_uri;
      }
      const r = await fetchTimeout('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, image_mxc, song: _pendingSong || null, ...(_pendingVideo ? { video: { id: _pendingVideo.id, ...(_pendingVideo.start ? { start: _pendingVideo.start } : {}) } } : {}) }),
      }, 15000);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(klabCap(d.error) || 'Couldn’t post that');
      }
      // Anything typed while it was sending stays; only what was sent goes.
      // This used to leave the sent text in the box along with the new
      // typing, so the next send posted it a second time.
      const nowText = textEl.value;
      if (nowText.trim() === text) clearComposer();
      else {
        const at = text ? nowText.indexOf(text) : -1;
        if (at !== -1) {
          textEl.value = (nowText.slice(0, at) + nowText.slice(at + text.length)).replace(/^\s+/, '');
          saveDraftNow();
          autoGrowComposer();
        }
        _pendingFile = null; fileEl.value = ''; previewWrapEl.hidden = true;
        imageBtnEl.classList.remove('has-image'); setPendingSong(null);
      }
      SFX && SFX.play('star');
      // A 30s poll already in flight would make fetchFeed() return at once,
      // leaving your own post missing until the next one.
      for (let i = 0; i < 40 && _feedPending; i++) await new Promise(r => setTimeout(r, 100));
      await fetchFeed();
    } catch (e) {
      errEl.textContent = e.message || 'Couldn’t post that';
      errEl.hidden = false;
    } finally {
      postBtnEl.disabled = false;
      postBtnEl.innerHTML = '<i class="ti ti-send-2"></i>';
    }
  }

  // Your own post goes at once, folding out of the list, with Undo; the
  // DELETE goes when the toast does. An admin deleting someone else's is
  // asked first (no Undo for other people's words).
  async function deletePost(id) {
    const post = _feedPosts.find(p => p.id === id);
    if (!post) return;
    const mine = post.username === window.KLAB_USER?.username;
    if (!mine && !(await showConfirmDialog('Delete ' + post.username + '’s post?', 'It’s gone for everyone, with its replies.', 'Delete'))) return;
    const el = listEl.querySelector(':scope > .feed-post[data-post-id="' + id + '"]');
    let applied = false;
    const take = () => {
      _locallyDeleted.add(id);
      _feedPosts = _feedPosts.filter(p => p.id !== id);
      applied = true;
      renderFeed();
    };
    klabUndo('Post deleted', {
      apply: () => {
        _locallyDeleted.add(id);
        if (el && el.isConnected && (window.klabMotionOk?.() ?? true)) foldAway(el, () => { if (_locallyDeleted.has(id)) take(); });
        else take();
        SFX && SFX.play('click');
      },
      undo: () => {
        _locallyDeleted.delete(id);
        el?.classList.remove('feed-post-going');
        if (applied) {
          _feedPosts = _feedPosts.filter(p => p.id !== id).concat(post).sort((a, b) => b.id - a.id);
          _localEditAt.set(id, performance.now());
          renderFeed();
        }
      },
      commit: async () => {
        const r = await fetch('/api/posts/' + id, { method: 'DELETE', keepalive: true });
        if (!r.ok && r.status !== 404) throw new Error('status ' + r.status);
      },
      failed: 'Couldn’t delete that post',
    });
  }

  // ── "New posts" (refresh 2026-11-19) ──
  let _newAbove = 0, _chipWrap = null;
  const feedPane = () => listEl.closest('.tab-panel');
  function newPostsChip(n) {
    const pane = feedPane();
    if (!pane || pane.scrollTop < 400 || !document.body.classList.contains('tab-feed-active')) return;
    _newAbove += n;
    if (!_chipWrap) {
      _chipWrap = document.createElement('div');
      _chipWrap.className = 'feed-new-chip-wrap';
      _chipWrap.innerHTML = '<button type="button" class="feed-new-chip" data-silent><i class="ti ti-arrow-up"></i><span></span></button>';
      _chipWrap.firstChild.addEventListener('click', () => {
        feedPane()?.scrollTo({ top: 0, behavior: window.klabMotionOk?.() ? 'smooth' : 'auto' });
        dropChip();
      });
      pane.addEventListener('scroll', () => { if (_newAbove && pane.scrollTop < 120) dropChip(); }, { passive: true });
    }
    _chipWrap.querySelector('span').textContent = klabCount(_newAbove, 'new post');
    if (!_chipWrap.isConnected) listEl.before(_chipWrap);
  }
  function dropChip() { _newAbove = 0; _chipWrap?.remove(); }

  // A post leaving: it fades (160ms), then goes, and the posts under it
  // glide up into its place (FLIP: transforms only, nothing re-laid out
  // frame by frame).
  function foldAway(el, done) {
    el.classList.add('feed-post-going');
    setTimeout(() => {
      const after = [];
      for (let n = el.nextElementSibling; n && after.length < 16; n = n.nextElementSibling) after.push(n);
      const before = after.map(x => x.getBoundingClientRect().top);
      done();
      const moved = [];
      after.forEach((x, i) => {
        if (!x.isConnected) return;
        const d = before[i] - x.getBoundingClientRect().top;
        if (Math.abs(d) < 1) return;
        x.style.transition = 'none';
        x.style.transform = 'translateY(' + d + 'px)';
        moved.push(x);
      });
      if (!moved.length) return;
      void listEl.offsetHeight;
      moved.forEach(x => {
        x.style.transition = 'transform 280ms cubic-bezier(.2,.8,.2,1)';
        x.style.transform = '';
        setTimeout(() => { x.style.transition = ''; }, 300);
      });
    }, 160);
  }

  // ── Editing your own post (PATCH /api/posts/{id} {text}) ──
  function editPost(id) {
    const post = _feedPosts.find(p => p.id === id);
    if (!post || (post.username !== window.KLAB_USER?.username && !window.KLAB_USER?.is_admin)) return;
    _editing.set(id, post.text || '');
    renderFeed();
    const ta = listEl.querySelector('.feed-edit-text[data-post-id="' + id + '"]');
    if (ta) { growEditor(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  function growEditor(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 480) + 'px'; }
  function cancelEdit(id) {
    _editing.delete(id);
    // The typing guard won't rebuild a post with focus in its editor.
    if (document.activeElement?.closest?.('.feed-post-editor')) document.activeElement.blur();
    renderFeed();
  }
  async function saveEdit(id) {
    const post = _feedPosts.find(p => p.id === id);
    const ta = listEl.querySelector('.feed-edit-text[data-post-id="' + id + '"]');
    if (!post || !ta) return;
    const text = ta.value.trim();
    if (text === (post.text || '').trim()) return cancelEdit(id);
    if (!text && !post.image_mxc && !post.song && !post.video) { showToast('A post needs something in it', 'ti-alert-triangle'); return; }
    if (text.length > FEED_MAX_CHARS) { showToast('Too long by ' + (text.length - FEED_MAX_CHARS).toLocaleString() + ' characters', 'ti-alert-triangle'); return; }
    const btn = listEl.querySelector('[data-edit-save="' + id + '"]');
    if (btn) btn.disabled = true;
    try {
      const r = await fetchTimeout('/api/posts/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }, 10000);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(klabCap(j.error) || (r.status === 404 || r.status === 405 ? 'Editing needs the latest klabnet-api' : 'Couldn’t save that'));
      const cur = _feedPosts.find(p => p.id === id);
      if (cur) Object.assign(cur, j && j.id ? j : { text, edited: new Date().toISOString() });
      _localEditAt.set(id, performance.now());
      _editing.delete(id);
      _expandedPosts.add(id);
      ta.blur();
      renderFeed();
      SFX && SFX.play('click');
    } catch (e) {
      if (btn) btn.disabled = false;
      showToast(e.message || 'Couldn’t save that', 'ti-alert-triangle');
    }
  }

  // Shared by the file-picker button and Ctrl/Cmd+V paste below — picking
  // a file was the ONLY way in before; pasting a screenshot straight from
  // the clipboard is the much more natural flow for "share this image" and
  // wasn't wired up at all.
  function attachFeedImage(file) {
    if (!file) return;
    errEl.hidden = true;
    // "All files" in the picker, or a drop: not everything is a picture.
    if (!/^image\//.test(file.type)) {
      errEl.textContent = 'That isn’t an image';
      errEl.hidden = false;
      return;
    }
    if (file.size > FEED_MAX_IMAGE_BYTES) {
      errEl.textContent = 'Image too large (max 8MB)';
      errEl.hidden = false;
      return;
    }
    _pendingFile = file;
    imageBtnEl.classList.add('has-image');
    const reader = new FileReader();
    reader.onload = () => {
      // Removed, or replaced by another pick/paste, while this was reading:
      // showing it now would preview an image that won't be sent.
      if (_pendingFile !== file) return;
      previewEl.src = reader.result;
      previewWrapEl.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  imageBtnEl.addEventListener('click', () => fileEl.click());
  document.getElementById('feedGifBtn')?.addEventListener('click', e => {
    window.klabGifPicker?.open(e.currentTarget, g => klabInsertGif(textEl, g));
  });
  fileEl.addEventListener('change', () => {
    const file = fileEl.files?.[0];
    if (!file) return;
    attachFeedImage(file);
    if (file.size > FEED_MAX_IMAGE_BYTES) fileEl.value = ''; // let the same file be reselected after fixing the error
  });
  // Clipboard image paste (e.g. a screenshot copied straight from the OS,
  // or an image copied from another page) — only intercepted when the
  // clipboard actually contains image data, so normal text paste into the
  // composer is completely unaffected.
  textEl.addEventListener('paste', e => {
    const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    attachFeedImage(item.getAsFile());
  });
  previewRmEl.addEventListener('click', () => {
    _pendingFile = null;
    fileEl.value = '';
    previewWrapEl.hidden = true;
    imageBtnEl.classList.remove('has-image');
  });
  postBtnEl.addEventListener('click', submitPost);
  textEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitPost();
  });
  textEl.addEventListener('input', autoGrowComposer);
  textEl.addEventListener('input', saveDraftSoon);
  if (window.klabMdEditor) {
    klabMdEditor(textEl, { onTogglePreview: () => setPreview(!_previewOn) });
    toolbarEl.addEventListener('mousedown', e => e.preventDefault()); // keep the textarea's selection
    toolbarEl.addEventListener('click', e => {
      const b = e.target.closest('button[data-md]');
      if (b) klabMdActions[b.dataset.md](textEl);
    });
  } else {
    toolbarEl.hidden = true;
  }
  helpBtnEl.addEventListener('click', () => {
    helpEl.hidden = !helpEl.hidden;
    helpBtnEl.setAttribute('aria-expanded', String(!helpEl.hidden));
    helpBtnEl.classList.toggle('on', !helpEl.hidden);
  });
  previewBtnEl.addEventListener('click', () => setPreview(!_previewOn));
  expandBtnEl.addEventListener('click', () => setExpanded(!composerEl.classList.contains('expanded')));
  document.addEventListener('keydown', e => {
    // Only when nothing is open over it (a menu, a dialog): that layer's
    // Escape is its own, and one press closes one thing.
    if (e.key === 'Escape' && composerEl.classList.contains('expanded') && !e.defaultPrevented && !window.klabLayers?.top()) { e.preventDefault(); setExpanded(false); textEl.focus(); }
  });
  composerScrimEl.addEventListener('click', () => setExpanded(false));
  // A draft survives a reload or a closed tab.
  try {
    const d = localStorage.getItem(DRAFT_KEY);
    if (d && !textEl.value) { textEl.value = d; autoGrowComposer(); }
  } catch (e) {}
  if (highlightEl) textEl.addEventListener('scroll', () => { highlightEl.scrollTop = textEl.scrollTop; });
  if (mentionsBtnEl) {
    mentionsBtnEl.addEventListener('click', () => {
      _mentionsOnly = !_mentionsOnly;
      if (_mentionsOnly) {
        const maxId = _feedPosts.reduce((max, p) => Math.max(max, p.id), 0);
        if (maxId) markMentionsSeen(maxId);
      }
      renderFeed();
    });
  }
  // Only the last of quick taps lands, not whichever answer is slowest.
  const _reactSeq = new Map();
  async function toggleFeedReaction(postId, emoji) {
    const seq = (_reactSeq.get(postId) || 0) + 1;
    _reactSeq.set(postId, seq);
    try {
      const r = await fetchTimeout(`/api/posts/${postId}/reactions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
      }, 8000);
      if (!r.ok) throw new Error('status ' + r.status);
      const data = await r.json();
      if (_reactSeq.get(postId) !== seq) return;
      const post = _feedPosts.find(p => p.id === postId);
      if (post) post.reactions = data.reactions || {};
      _localEditAt.set(postId, performance.now());
      renderFeed();
    } catch (e) { showToast('Couldn’t react. Try again', 'ti-alert-triangle'); }
  }

  async function fetchFeedReplies(postId) {
    let ok = false, refetch = false;
    const startedAt = performance.now();
    // A deadline that covers the body too (fetchTimeout's stops at the
    // headers): a reply list that stalled halfway kept this post in
    // _repliesPending for good, and its replies never updated again
    // until a reload ("feed replies are broken until refresh").
    const ctrl = new AbortController();
    const deadline = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetchTimeout(`/api/posts/${postId}/replies`, { signal: ctrl.signal }, 8000);
      if (!r.ok) return;
      const data = await r.json();
      // You replied while this was on its way: it may not have yours in
      // it, and putting it in the cache made your reply vanish. Ask again.
      if ((_localEditAt.get(postId) || 0) > startedAt) { ok = refetch = true; return; }
      _repliesCache.set(postId, data.replies || []);
      _repliesAt.set(postId, performance.now());
      _repliesStale.delete(postId);
      ok = true;
      scheduleFeedRender();
    } catch (e) {
    } finally {
      clearTimeout(deadline);
      _repliesPending.delete(postId);
      if (refetch) { _repliesPending.add(postId); fetchFeedReplies(postId); }
      // Only a rebuild of the post asks again, and nothing rebuilds it if
      // the fetch failed, so its replies would stay missing all session.
      // Not while the tab is hidden, though: then it waits to be looked at.
      if (!ok) {
        const retry = () => {
          if (document.hidden) { document.addEventListener('visibilitychange', retry, { once: true }); return; }
          const post = _feedPosts.find(p => p.id === postId);
          if (post) ensureFeedRepliesResolved(post);
        };
        setTimeout(retry, 15000);
      }
    }
  }

  // Replies are always shown now — same resolve-then-rerender idiom as
  // ensureFeedAvatar()/ensureFeedImage() above, called from postHTML() on
  // every render. Skips posts with no replies at all (the common case)
  // rather than firing a fetch for every single post in the feed.
  function ensureFeedRepliesResolved(post) {
    if (!post.reply_count || _repliesPending.has(post.id)) return;
    if (_repliesCache.has(post.id) && !_repliesStale.has(post.id)) return;
    _repliesPending.add(post.id);
    fetchFeedReplies(post.id);
  }

  // The post can be rebuilt while a reply is sending or a GIF is being
  // picked, so look its box up fresh rather than trusting an old node.
  const replyInputFor = postId => listEl.querySelector(`.feed-post-reply-input[data-post-id="${postId}"]`);

  async function submitFeedReply(postId, input) {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    _replyDrafts.delete(postId);
    // Put it back in whichever box is on screen now (and in the draft, in
    // case the post is filtered out or about to be rebuilt).
    const restore = () => {
      const cur = replyInputFor(postId);
      if (cur && !cur.value) cur.value = text;
      _replyDrafts.set(postId, cur?.value || text);
    };
    try {
      const r = await fetchTimeout(`/api/posts/${postId}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      }, 8000);
      if (!r.ok) { restore(); return; }
      const reply = await r.json();
      const list = _repliesCache.get(postId) || [];
      const post = _feedPosts.find(p => p.id === postId);
      // Someone else replied while you were typing (a poll saw the count
      // move, but the post was held back for your typing): the list here
      // doesn't have theirs, and adding yours made it look complete, so
      // theirs stayed hidden until the next poll. Fetch the whole list.
      const behind = !!post && list.length !== (post.reply_count || 0);
      list.push(reply);
      klabComments.fresh(reply.id);
      _repliesCache.set(postId, list);
      if (post) post.reply_count = (post.reply_count || 0) + 1;
      if (behind) _repliesStale.add(postId);
      _localEditAt.set(postId, performance.now());
      // Blur first. The reconciler refuses to rebuild the post containing
      // the focused element so it can't yank a half-typed reply away — but
      // right here that post is the one that changed, and focus is sitting
      // in its reply box, so it would defer the render that is the whole
      // point of this call. The box was just cleared, so there's nothing
      // left to protect; drop focus, rebuild, then hand focus back to the
      // fresh input so you can fire off another reply.
      const refocus = document.activeElement === input;
      input.blur();
      renderFeed();
      if (refocus) {
        const fresh = replyInputFor(postId);
        if (fresh) fresh.focus();
      }
    } catch (e) { restore(); }
  }

  // At once, with Undo: the DELETE goes when the toast does (klabUndo).
  function deleteFeedReply(postId, replyId) {
    const list = _repliesCache.get(postId) || [];
    const reply = list.find(rp => rp.id === replyId);
    if (!reply) return;
    const row = listEl.querySelector('.feed-post-replies[data-post-id="' + postId + '"] .k-com[data-reply-id="' + replyId + '"]');
    const adjust = d => {
      const post = _feedPosts.find(p => p.id === postId);
      if (post) post.reply_count = Math.max(0, (post.reply_count || 0) + d);
      _localEditAt.set(postId, performance.now());
    };
    klabComments.del({
      postId, reply, row, label: 'Reply deleted',
      apply: () => { _repliesCache.set(postId, (_repliesCache.get(postId) || []).filter(rp => rp.id !== replyId)); adjust(-1); renderFeed(); },
      undo: () => {
        const cur = (_repliesCache.get(postId) || []).filter(rp => rp.id !== replyId).concat(reply).sort((a, b) => a.id - b.id);
        _repliesCache.set(postId, cur); adjust(1); renderFeed();
      },
    });
  }

  // A reaction you add floats up off the button.
  function floatEmoji(from, emoji) {
    if (!(window.klabMotionOk?.() ?? true)) return;
    const r = from.getBoundingClientRect(), z = typeof zoomFactor === 'function' ? zoomFactor() : 1;
    for (let k = 0; k < 3; k++) {
      const f = document.createElement('span');
      f.className = 'feed-floaty';
      f.innerHTML = klabReactHTML(emoji);
      f.style.left = (r.left / z + 6 + k * 9) + 'px';
      f.style.top = (r.top / z - 4) + 'px';
      f.style.setProperty('--r', ((k - 1) * 16) + 'deg');
      f.style.animationDelay = (k * 70) + 'ms';
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 1300);
    }
  }

  loadMoreEl.addEventListener('click', loadOlderPosts);
  listEl.addEventListener('click', (e) => {
    const nameClick = e.target.closest('.feed-post-name, .k-com-name, .feed-post-mention, .feed-post-avatar, .k-com-face');
    if (nameClick?.dataset.username) { openProfileView(nameClick.dataset.username); return; }
    const del = e.target.closest('.feed-post-delete');
    if (del) { deletePost(Number(del.dataset.postId)); return; }
    const edit = e.target.closest('.feed-post-edit');
    if (edit) { editPost(Number(edit.dataset.postId)); return; }
    const eCancel = e.target.closest('[data-edit-cancel]');
    if (eCancel) { cancelEdit(Number(eCancel.dataset.editCancel)); return; }
    const eSave = e.target.closest('[data-edit-save]');
    if (eSave) { saveEdit(Number(eSave.dataset.editSave)); return; }
    const pill = e.target.closest('.feed-post-reaction-pill, .feed-post-star');
    if (pill) { if (!pill.classList.contains('mine')) floatEmoji(pill, pill.dataset.emoji); toggleFeedReaction(Number(pill.dataset.postId), pill.dataset.emoji); return; }
    const replyOpen = e.target.closest('.feed-post-reply-open');
    if (replyOpen) {
      const postId = Number(replyOpen.dataset.postId);
      _openReplyBoxes.add(postId);
      const box = listEl.querySelector('.feed-post-replies[data-post-id="' + postId + '"]');
      box?.classList.add('replying');
      box?.querySelector('.feed-post-reply-input')?.focus();
      return;
    }
    // More reactions: the same row as the right-click menu, under the button.
    const addReact = e.target.closest('.feed-post-add-reaction');
    if (addReact) {
      const postId = Number(addReact.dataset.postId);
      klabReactMenu(addReact, emoji => { floatEmoji(addReact, emoji); toggleFeedReaction(postId, emoji); });
      return;
    }
    const quickEmoji = e.target.closest('.feed-post-actions [data-emoji]');
    if (quickEmoji) {
      const postId = Number(quickEmoji.dataset.postId);
      floatEmoji(quickEmoji, quickEmoji.dataset.emoji);
      toggleFeedReaction(postId, quickEmoji.dataset.emoji);
      return;
    }
    const replyGif = e.target.closest('.feed-post-reply-gif');
    if (replyGif) {
      const postId = Number(replyGif.dataset.postId);
      const input = replyInputFor(postId);
      if (input) window.klabGifPicker?.open(replyGif, g => {
        const cur = replyInputFor(postId);
        if (!cur) return;
        // A rebuilt box has no caret of its own yet: add to the end.
        if (cur !== input) cur.setSelectionRange(cur.value.length, cur.value.length);
        klabInsertGif(cur, g, { short: true });
      });
      return;
    }
    const replyDelete = e.target.closest('.k-com-del');
    if (replyDelete) { deleteFeedReply(Number(replyDelete.dataset.postId), Number(replyDelete.dataset.replyId)); return; }
    const more = e.target.closest('.feed-post-more');
    if (more) {
      // Unfold in place instead of rebuilding the post (that would reload
      // its image or video), then record the new state as already drawn.
      const postId = Number(more.dataset.postId);
      _expandedPosts.add(postId);
      const postEl = more.closest('.feed-post');
      postEl.querySelector('.feed-post-text')?.classList.remove('md-folded');
      more.remove();
      const post = _feedPosts.find(p => p.id === postId);
      if (post) postEl.dataset.postKey = postRenderKey(post, window.KLAB_USER?.username);
      return;
    }
    const mdImg = e.target.closest('.feed-post-text .md-img');
    if (mdImg) { openImageViewer({ thumbSrc: mdImg.src, alt: mdImg.alt }); return; }
    const photo = e.target.closest('.feed-post-image');
    if (photo) {
      openImageViewer({ thumbSrc: photo.src, mxc: photo.dataset.mxc, alt: photo.alt });
      return;
    }
    const videoCard = e.target.closest('.feed-post-video[data-video-id]');
    if (videoCard) { window.klabOpenVideo?.(+videoCard.dataset.videoId, +videoCard.dataset.at || 0); return; }
    const songCard = e.target.closest('.feed-post-song');
    if (songCard) {
      try {
        const song = klabCleanSong(JSON.parse(decodeURIComponent(songCard.dataset.playSong)));
        if (song && typeof playSong === 'function') klabPlayFrom(song, +songCard.dataset.at || 0);
      } catch (e) {}
      return;
    }
  });
  function openReplyBox(postId, mention) {
    _openReplyBoxes.add(postId);
    const box = listEl.querySelector('.feed-post-replies[data-post-id="' + postId + '"]');
    box?.classList.add('replying');
    const input = box?.querySelector('.feed-post-reply-input');
    if (!input) return;
    if (mention && !input.value.includes('@' + mention)) {
      input.value = '@' + mention + ' ' + input.value;
      _replyDrafts.set(postId, input.value);
    }
    input.focus();
  }
  function mentionInComposer(username) {
    const ta = document.getElementById('feedComposerText');
    if (!ta) return;
    ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + '@' + username + ' ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // A post the typing guard held back (a reply arrived while you were in
  // its box) is redrawn when you leave the box, not on the next poll.
  listEl.addEventListener('focusout', e => {
    if (_lastFeedRenderKey === null && e.target.closest?.('.feed-post-reply-input')) scheduleFeedRender();
  });
  listEl.addEventListener('contextmenu', (e) => {
    const postEl = e.target.closest('.feed-post[data-post-id]');
    const post = postEl && _feedPosts.find(p => p.id === Number(postEl.dataset.postId));
    if (!post) return;
    const me = window.KLAB_USER?.username;
    const replyEl = e.target.closest('.k-com');
    if (replyEl) {
      const who = replyEl.querySelector('.k-com-name')?.dataset.username;
      const del = replyEl.querySelector('.k-com-del');
      const text = replyEl.querySelector('.k-com-body')?.innerText.trim();
      klabMenu(e, [
        { header: who || 'Reply' },
        { label: 'Reply', icon: 'ti-arrow-back-up', action: () => openReplyBox(post.id, who !== me ? who : null) },
        { label: 'Copy text', icon: 'ti-copy', hidden: !text, action: () => klabCopy(text, 'Reply') },
        '-',
        { label: 'View profile', icon: 'ti-user-circle', hidden: !who, action: () => openProfileView(who) },
        { label: 'Message', icon: 'ti-message-2-plus', hidden: !who || who === me, action: () => messageUser(who) },
        '-',
        { label: 'Delete reply', icon: 'ti-trash', danger: true, hidden: !del, action: () => deleteFeedReply(post.id, Number(del.dataset.replyId)) },
      ]);
      return;
    }
    const img = e.target.closest('.feed-post-image, .feed-post-text .md-img');
    let song = null;
    try { const c = postEl.querySelector('.feed-post-song[data-play-song]'); if (c) song = klabCleanSong(JSON.parse(decodeURIComponent(c.dataset.playSong))); } catch {}
    const mine = post.username === me;
    klabMenu(e, [
      { header: post.username },
      { reacts: [...(KLAB_STARS ? [KLAB_STAR] : []), ...KLAB_QUICK_REACTS, '😮', '😢'], action: emoji => {
        const btn = postEl.querySelector('.feed-post-add-reaction');
        if (btn) floatEmoji(btn, emoji);
        toggleFeedReaction(post.id, emoji);
      } },
      { label: 'Reply', icon: 'ti-arrow-back-up', action: () => openReplyBox(post.id) },
      { label: 'Edit post', icon: 'ti-pencil', hidden: !mine && !window.KLAB_USER?.is_admin, action: () => editPost(post.id) },
      { label: 'Copy text', icon: 'ti-copy', hidden: !post.text, action: () => klabCopy(post.text, 'Post') },
      '-',
      { label: 'Open image', icon: 'ti-photo', hidden: !img, action: () => openImageViewer({ thumbSrc: img.src, mxc: img.dataset.mxc, alt: img.alt }) },
      { label: 'Copy image', icon: 'ti-copy', hidden: !img, action: () => klabCopyImage(img.src) },
      { label: 'Play song', icon: 'ti-player-play', hidden: !song, action: () => playSong(song) },
      { label: 'Add to queue', icon: 'ti-playlist-add', hidden: !song, action: () => addToQueue(song) },
      '-',
      { label: 'Mention', icon: 'ti-at', hidden: mine, action: () => mentionInComposer(post.username) },
      { label: 'View profile', icon: 'ti-user-circle', action: () => openProfileView(post.username) },
      { label: 'Message', icon: 'ti-message-2-plus', hidden: mine, action: () => messageUser(post.username) },
      '-',
      { label: 'Delete post', icon: 'ti-trash', danger: true, hidden: !postEl.querySelector('.feed-post-delete'), action: () => deletePost(post.id) },
    ]);
  });
  // The post editor: Esc cancels, Ctrl/⌘+Enter saves; it grows as you type.
  listEl.addEventListener('keydown', (e) => {
    const ta = e.target.closest?.('.feed-edit-text');
    if (!ta || e.isComposing) return;
    const id = Number(ta.dataset.postId);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(id); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(id); }
  });
  listEl.addEventListener('input', (e) => {
    const ta = e.target.closest?.('.feed-edit-text');
    if (!ta) return;
    _editing.set(Number(ta.dataset.postId), ta.value);
    growEditor(ta);
  });
  // Enter in a reply box submits its form (an IME's Enter doesn't).
  listEl.addEventListener('submit', (e) => {
    const form = e.target.closest('.feed-post-reply-composer');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('.feed-post-reply-input');
    if (input) submitFeedReply(Number(input.dataset.postId), input);
  });
  listEl.addEventListener('input', (e) => {
    const input = e.target.closest('.feed-post-reply-input');
    if (!input) return;
    const postId = Number(input.dataset.postId);
    if (input.value) _replyDrafts.set(postId, input.value);
    else _replyDrafts.delete(postId);
  });

  const FEED_POLL_MS = 30000; // same cadence as notes/offline-roster — a feed doesn't need second-by-second freshness
  fetchFeed();
  setInterval(fetchFeed, FEED_POLL_MS);
  // The mentions dot too: its dwell timer gives up while the tab is hidden.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshFeedTimes(); updateMentionsDot(); fetchFeed(); } });
  // Relative times tick over in place, and media lookups that failed get
  // another go once they're due (see FEED_MEDIA_RETRY_MS).
  let _feedDayShown = _dayFmt.format(new Date());
  setInterval(() => {
    if (document.hidden) return;
    refreshFeedTimes();
    // Past midnight: "Today" and "Yesterday" move along (the day is in the render key).
    const day = _dayFmt.format(new Date());
    if (day !== _feedDayShown) { _feedDayShown = day; renderFeed(); }
    _feedAvatarFailedAt.forEach((t, username) => { if (retryDue(_feedAvatarFailedAt, username)) ensureFeedAvatar(username); });
    const live = new Set(_feedPosts.map(p => p.image_mxc).filter(Boolean));
    _feedImageFailedAt.forEach((t, mxc) => { if (live.has(mxc) && retryDue(_feedImageFailedAt, mxc)) ensureFeedImage(mxc); });
  }, 60000);

  // The very first fetchFeed() above almost always lands before Matrix has
  // finished (re)connecting — ensureFeedAvatar()/ensureFeedImage() correctly
  // skip resolving rather than caching a permanent failure (see their
  // client-readiness guards), but without this, nothing ever retried them
  // until the next 30s poll — in practice, "images don't load until you
  // click Load older" (whatever else happens to call renderFeed() first).
  // PREPARED is the same "client is actually usable now" signal the chat
  // module's own sync handler treats as settled.
  // A plain renderFeed() wouldn't do: nothing in the render keys has
  // changed yet (the caches are still empty), so it skips every post and
  // their ensureFeed*() lookups never run. Rebuilding every post instead
  // restarted videos and GIFs for nothing, so kick the lookups off
  // directly; each one that lands rebuilds only the posts it changes.
  MatrixChat.on('sync', state => {
    if (state !== 'PREPARED') return;
    _feedPosts.forEach(p => {
      ensureFeedAvatar(p.username);
      if (p.image_mxc) ensureFeedImage(p.image_mxc);
      (_repliesCache.get(p.id) || []).forEach(r => ensureFeedAvatar(r.username));
    });
  });
})();

// ── Volume icon mute toggle ──────────────
(function() {
  function updateVolIcons() {
    const muted = playerState.audio.muted || playerState.audio.volume === 0;
    ['fsVolIcon','volIcon'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = muted ? 'ti ti-volume-off' : 'ti ti-volume';
      const button = el.closest('button');
      if (button) {
        button.title = muted ? 'Unmute' : 'Mute';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(muted));
      }
    });
  }

  ['fsVolIcon','volIcon'].forEach(id => {
    const el = document.getElementById(id)?.closest('button');
    if (!el) return;
    el.addEventListener('click', () => {
      const a = playerState.audio;
      if (a.muted || a.volume === 0) {
        // Unmuting gives back the volume the sliders show. Only a slider
        // dragged to nothing needs one picked for it, and then the sliders
        // and the saved volume follow (the next track used to go silent again).
        a.muted = false;
        if (a.volume === 0) {
          clearInterval(_loginFadeInterval);
          playerState.volume = a.volume = 0.8;
          volSlider.setPct(0.8); fsVolSlider.setPct(0.8);
          try { localStorage.setItem(VOLUME_KEY, '0.800'); } catch (err) {}
        }
      } else {
        a.muted = true;
      }
      updateVolIcons();
      SFX && SFX.play('click');
    });
  });

  playerState.audio.addEventListener('volumechange', updateVolIcons);
  updateVolIcons();
})();

// ── SFX on remaining interactive elements ────
// Only buttons with no sound of their own: the player's play, skip, heart,
// shuffle, repeat, open and close each have one (js/04-sfx.js,
// js/05-favorites.js), and a click on top made every press two sounds.
[
  ['fsLyrics',           'click'],
  ['fsQueue',            'click'],
].forEach(([id, ev]) => {
  const el = document.getElementById(id);
  if (el && !el._sfxWired) {
    el._sfxWired = true;
    el.addEventListener(ev, () => SFX && SFX.play('click'));
  }
});
