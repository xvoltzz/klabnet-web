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
  const FEED_MAX_LOADED = 300; // caps how many posts loadOlderPosts() keeps resident — see its own comment
  const MENTIONS_SEEN_KEY = 'klabnet_feed_mentions_seen_v1'; // { username: highest post id already seen mentioning them }
  const FEED_QUICK_REACTIONS = ['👍','❤️','😂','🔥'];

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
  let _feedLoadedOnce = false; // fetchFeed() has completed at least once, success or not
  let _pendingFile   = null;
  let _pendingSong   = null; // { songId, title, artist, album, coverArt, lyric } — see setPendingSong()/window.klabShareSongToFeed
  let _mentionsOnly  = false; // toggled by the @ button — filters the list to posts mentioning me
  const _repliesCache       = new Map(); // postId -> array of replies, fetched lazily as each post renders
  const _repliesPending     = new Set(); // postIds with a replies fetch already in flight
  const _openReactionPickers = new Set(); // postIds with the quick-reaction row open
  const _openReplyBoxes = new Set();      // postIds whose reply box was opened with the Reply button

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
      const phrase = FEED_PLACEHOLDER_PHRASES[phraseIdx];
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

  // @mentions — plain "@name" tokens, not validated against a real user
  // directory (matching Twitter's own composer: it highlights syntactically
  // as you type, same idea here). Shared between the composer's live
  // highlight overlay and rendered post text so both stay in sync.
  function mentionHTML(rawText, me) {
    const escaped = esc(rawText);
    return escaped.replace(/(^|[^\w@])@([a-zA-Z0-9_][\w.-]*)/g, (m, pre, name) => {
      const isMe = !!me && name.toLowerCase() === me.toLowerCase();
      return pre + '<span class="feed-post-mention' + (isMe ? ' is-me' : '') + '" data-username="' + esc(name.toLowerCase()) + '" style="color:' + profileColor(name.toLowerCase()) + '">@' + name + '</span>';
    });
  }

  // Post/reply bodies get both passes: linkifyHTML carves out the URLs and
  // hands every remaining run of text to mentionHTML, so an @name inside a
  // URL stays part of the URL instead of turning into a mention.
  function richText(rawText, me) {
    return linkifyHTML(rawText, seg => mentionHTML(seg, me));
  }

  function textMentions(text, username) {
    if (!text || !username) return false;
    return new RegExp('(^|[^\\w@])@' + username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.-])', 'i').test(text);
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
  function updateMentionsDot() {
    const rawMe = window.KLAB_USER?.username;
    const me = mentionsSeenKeyFor(rawMe);
    if (!me || me === 'anonymous' || !mentionsDotEl) return;
    const seen = loadMentionsSeen();
    // No watermark at all means a brand-new browser, a private window, a
    // cleared/evicted localStorage, or the installed PWA (separate storage
    // from the tab) — not "you have never read anything". Defaulting to 0
    // relit the dot for months-old mentions on every such session, which is
    // the "randomly decides I have not read this" report. Seed it to what's
    // on screen instead and start tracking from there.
    if (seen[me] === undefined) {
      markMentionsSeen(_feedPosts.reduce((max, p) => Math.max(max, p.id), 0));
      mentionsDotEl.hidden = true;
      return;
    }
    const lastSeen = seen[me] || 0;
    const mentioning = _feedPosts.filter(p =>
      p.id > lastSeen && mentionsSeenKeyFor(p.username) !== me && textMentions(p.text, me));
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
    }
  }

  function ensureFeedAvatar(username) {
    if (!username || _feedAvatarCache.has(username) || _feedAvatarPending.has(username)) return;
    const client = MatrixChat.client;
    if (!client) return;
    _feedAvatarPending.add(username);
    (async () => {
      try {
        const serverName = client.getUserId().split(':')[1];
        const info = await client.getProfileInfo(`@${username}:${serverName}`);
        _feedAvatarCache.set(username, info?.avatar_url ? await MatrixChat.mxcToBlobUrl(info.avatar_url) : null);
      } catch (e) {
        if (!_feedAvatarCache.has(username)) _feedAvatarCache.set(username, null);
      } finally {
        _feedAvatarPending.delete(username);
        scheduleFeedRender();
      }
    })();
  }

  function ensureFeedImage(mxc) {
    if (!mxc || _feedImageCache.has(mxc) || _feedImagePending.has(mxc)) return;
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
      } catch (e) {
        _feedImageCache.set(mxc, null);
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
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString();
  }

  function feedReplyHTML(post, reply) {
    const me = window.KLAB_USER?.username;
    const canDelete = reply.username === me || window.KLAB_USER?.is_admin;
    ensureFeedAvatar(reply.username);
    const avatarUrl = _feedAvatarCache.get(reply.username);
    const avatarInner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : (reply.username || '?')[0].toUpperCase();
    return '<div class="feed-post-reply">' +
      '<div class="feed-post-reply-avatar" data-username="' + esc(reply.username) + '">' + avatarInner + '</div>' +
      '<div class="feed-post-reply-body">' +
        '<div class="feed-post-reply-head">' +
          '<span class="feed-post-reply-name" data-username="' + esc(reply.username) + '" style="color:' + profileColor(reply.username) + '">' + esc(reply.username) + '</span>' +
          '<span class="feed-post-reply-time">' + fmtFeedTime(reply.created) + '</span>' +
          (canDelete ? '<button type="button" class="feed-post-reply-delete" data-post-id="' + post.id + '" data-reply-id="' + reply.id + '" title="Delete reply" aria-label="Delete reply"><i class="ti ti-trash"></i></button>' : '') +
        '</div>' +
        '<div class="feed-post-reply-text">' + richText(reply.text, me) + '</div>' +
      '</div>' +
    '</div>';
  }

  // Always shown now (no more expand/collapse click) — ensureFeedRepliesResolved()
  // below fetches into _repliesCache as each post with replies renders.
  function feedRepliesSectionHTML(post) {
    const replies = _repliesCache.get(post.id) || [];
    // The reply box only shows once a post has replies or you hit Reply,
    // instead of an empty input under every post.
    return '<div class="feed-post-replies' + (replies.length ? ' has-replies' : '') + (_openReplyBoxes.has(post.id) ? ' replying' : '') + '" data-post-id="' + post.id + '">' +
      replies.map(r => feedReplyHTML(post, r)).join('') +
      '<div class="feed-post-reply-composer">' +
        '<input type="text" class="feed-post-reply-input" data-post-id="' + post.id + '" placeholder="Reply…" maxlength="500" />' +
        '<button type="button" class="feed-post-reply-send" data-post-id="' + post.id + '" title="Send reply"><i class="ti ti-send-2"></i></button>' +
      '</div>' +
    '</div>';
  }

  function postHTML(post) {
    const me = window.KLAB_USER?.username;
    const canDelete = post.username === me || window.KLAB_USER?.is_admin;
    ensureFeedAvatar(post.username);
    const avatarUrl = _feedAvatarCache.get(post.username);
    const avatarInner = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" />' : (post.username || '?')[0].toUpperCase();
    let imageHTML = '';
    if (post.image_mxc) {
      ensureFeedImage(post.image_mxc);
      const url = _feedImageCache.get(post.image_mxc);
      if (url) imageHTML = '<img class="feed-post-image" src="' + esc(url) + '" data-mxc="' + esc(post.image_mxc) + '" alt="" loading="lazy" />';
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
      songHTML = '<div class="feed-post-song" data-play-song="' + playPayload + '">' +
        (artUrl
          ? '<img class="feed-post-song-art" src="' + esc(artUrl) + '" alt="" loading="lazy" onerror="klabArtFallback(this,\'feed-post-song-art-ph\',\'ti-music\')" />'
          : '<div class="feed-post-song-art-ph"><i class="ti ti-music"></i></div>') +
        '<div class="feed-post-song-info">' +
          '<div class="feed-post-song-title">' + esc(s.title || 'Unknown') + '</div>' +
          '<div class="feed-post-song-artist">' + esc(s.artist || '') + (s.album ? ' · ' + esc(s.album) : '') + '</div>' +
          (s.lyric ? '<div class="feed-post-song-lyric">' + esc(s.lyric) + '</div>' : '') +
        '</div>' +
        '<button type="button" class="feed-post-song-play" title="Play"><i class="ti ti-player-play"></i></button>' +
      '</div>';
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
    const pillsHTML = Object.entries(reactions).map(([emoji, entry]) =>
      '<button type="button" class="feed-post-reaction-pill' + (entry.mine ? ' mine' : '') + '" data-post-id="' + post.id + '" data-emoji="' + esc(emoji) + '">' +
        esc(emoji) + ' <span class="feed-post-reaction-count">' + entry.count + '</span>' +
      '</button>'
    ).join('');
    const quickPickerOpen = _openReactionPickers.has(post.id);
    return '<div class="feed-post" data-post-id="' + post.id + '" style="--name-color:' + profileColor(post.username) + '">' +
      '<div class="feed-post-avatar" data-username="' + esc(post.username) + '">' + avatarInner + '</div>' +
      '<div class="feed-post-body">' +
        '<div class="feed-post-head">' +
          '<span class="feed-post-name" data-username="' + esc(post.username) + '">' + esc(post.username) + '</span>' +
          '<span class="feed-post-time">' + fmtFeedTime(post.created) + '</span>' +
          (canDelete ? '<button type="button" class="feed-post-delete" data-post-id="' + post.id + '" title="Delete post" aria-label="Delete post"><i class="ti ti-trash"></i></button>' : '') +
        '</div>' +
        (post.text ? '<div class="feed-post-text">' + richText(post.text, me) + '</div>' : '') +
        imageHTML +
        embedHTML +
        songHTML +
        '<div class="feed-post-footer">' +
          pillsHTML +
          '<button type="button" class="feed-post-add-reaction" data-post-id="' + post.id + '" title="Add reaction"><i class="ti ti-mood-plus"></i></button>' +
          '<button type="button" class="feed-post-reply-open" data-post-id="' + post.id + '" title="Reply"><i class="ti ti-message-circle"></i>' + (post.reply_count ? '<span>' + post.reply_count + '</span>' : '') + '</button>' +
          '<span class="feed-post-quick-reactions' + (quickPickerOpen ? ' open' : '') + '" data-post-id="' + post.id + '">' +
            FEED_QUICK_REACTIONS.map(e => '<button type="button" data-post-id="' + post.id + '" data-emoji="' + e + '">' + e + '</button>').join('') +
          '</span>' +
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
  // Per-post so the renderer can tell WHICH posts changed, not just that
  // something did. Everything postHTML() reads about one post goes in here.
  function postRenderKey(p, me) {
    {
        const replies = _repliesCache.get(p.id);
        return p.id +
          // fmtFeedTime is relative ("just now" / "5m" / "2h"), so the
          // rendered string is part of the state — without it the key
          // would go stable and every timestamp on screen would freeze at
          // whatever it said when the feed last changed. Keying on the
          // formatted value (not the clock) means a rebuild happens only
          // when a timestamp actually ticks over, not on a timer.
          ':' + fmtFeedTime(p.created) +
          ':' + (p.reply_count || 0) +
          ':' + JSON.stringify(p.reactions || {}) +
          ':' + profileColor(p.username) +
          ':' + (_feedAvatarCache.get(p.username) || '') +
          ':' + (p.image_mxc ? (_feedImageCache.get(p.image_mxc) || '') : '') +
          ':' + (_openReactionPickers.has(p.id) ? '1' : '0') + (_openReplyBoxes.has(p.id) ? 'r' : '') +
          ':' + (replies
            ? replies.map(r => r.id + '@' + fmtFeedTime(r.created) + '@' + (_feedAvatarCache.get(r.username) || '')).join('+')
            : '-');
    }
  }
  function feedRenderKey(posts, me) {
    return (me || '') + '|' + (_mentionsOnly ? '1' : '0') + '|' + (_feedHasMore ? '1' : '0') + '|' +
      posts.map(p => postRenderKey(p, me)).join(',');
  }

  function buildPostEl(post, key) {
    const wrap = document.createElement('div');
    wrap.innerHTML = postHTML(post);
    const el = wrap.firstElementChild;
    el.dataset.postKey = key;
    return el;
  }

  // Reconciles post by post instead of replacing the whole list. A single
  // reaction, one avatar resolving, or a timestamp ticking over used to
  // re-create every <img> and <iframe> on screen — that's the flicker, and
  // spam-clicking a reaction made it continuous. Now only the posts whose
  // own key changed get rebuilt; everything else is left alone entirely.
  function renderFeed() {
    const me = window.KLAB_USER?.username;
    const posts = _mentionsOnly ? _feedPosts.filter(p => textMentions(p.text, me)) : _feedPosts;
    const key = feedRenderKey(posts, me);
    if (key === _lastFeedRenderKey) return;
    // NOT cached yet — see the deferred check at the end. Caching here
    // while the typing guard below has deliberately left a post stale is
    // what made new replies invisible until a reload: the post was skipped,
    // but the key was stored as though it had been drawn, so every later
    // render matched it and returned right here.
    let deferred = false;

    if (!posts.length) {
      listEl.innerHTML = '<div class="feed-empty">' + (_mentionsOnly ? 'No mentions yet.' : 'No posts yet — be the first!') + '</div>';
    } else {
      // Typing in a reply box must survive a re-render happening around it
      // (a 30s poll, someone else's reaction, a minute ticking over). The
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

      const desired = posts.map(p => {
        const id = String(p.id);
        const k  = postRenderKey(p, me);
        const el = existing.get(id);
        existing.delete(id);
        if (el && el.dataset.postKey === k) return el;          // unchanged
        // Don't yank a post out from under someone mid-sentence. Leaving
        // the key stale means it rebuilds on the next render once focus
        // has moved on.
        if (el && typingIn && el.contains(typingIn)) { deferred = true; return el; }
        return buildPostEl(p, k);
      });

      // Drop everything that isn't staying BEFORE positioning: a replaced
      // node left in place shifts every index after it, so the position
      // pass would then "fix" each one by moving it — which is a remove +
      // insert per post, i.e. the whole-list rebuild this is meant to
      // avoid. `existing` still holds posts that vanished; the rest is
      // stale nodes (a replaced post, the empty-state div).
      existing.forEach(el => el.remove());
      const keep = new Set(desired);
      [...listEl.children].forEach(el => { if (!keep.has(el)) el.remove(); });

      desired.forEach((el, i) => {
        if (listEl.children[i] !== el) listEl.insertBefore(el, listEl.children[i] || null);
      });

      if (typingIn && document.activeElement !== typingIn && typingIn.isConnected) {
        typingIn.focus();
        if (caret) { try { typingIn.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
      }
    }
    // Only remember the key if what's on screen actually matches it. If the
    // typing guard held a post back, leave it null so the next render has to
    // do the work again rather than short-circuiting forever.
    _lastFeedRenderKey = deferred ? null : key;
    loadMoreEl.hidden = !_feedHasMore || _mentionsOnly;
    if (mentionsBtnEl) mentionsBtnEl.classList.toggle('is-active', _mentionsOnly);
    updateMentionsDot();
  }

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

  async function fetchFeed() {
    if (_feedPending) return;
    // Was polled every 30s unconditionally, including in a backgrounded
    // tab — matches the visibility-guard pattern already used for
    // presence/notes/profiles polling elsewhere in the app.
    if (document.hidden) return;
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
      listEl.innerHTML = '<div class="feed-empty">loading feed…</div>';
      _lastFeedRenderKey = null; // we just clobbered the DOM out from under the key
    }
    try {
      const r = await fetchTimeout(`/api/posts?limit=${FEED_PAGE_SIZE}`, {}, 8000);
      if (!r.ok) throw new Error('bad status');
      const data = await r.json();
      const fresh = data.posts || [];
      // Merge the newest page into whatever's already loaded instead of
      // replacing wholesale — this runs on a 30s poll and after every post
      // submit, and a plain replace was silently discarding any older pages
      // the user had already paged in via "Load older", snapping the list
      // back to just the newest 50 out from under them.
      const byId = new Map(_feedPosts.map(p => [p.id, p]));
      fresh.forEach(p => byId.set(p.id, p));
      _feedPosts = [...byId.values()].sort((a, b) => b.id - a.id);
      // _feedHasMore is otherwise owned by loadOlderPosts() once pagination
      // has started — only the very first load should derive it from this
      // top-page fetch.
      if (isFirstLoad) _feedHasMore = fresh.length === FEED_PAGE_SIZE;
      const signature = _feedPosts.map(p => `${p.id}:${p.reply_count || 0}:${JSON.stringify(p.reactions || {})}`).join('|');
      // Most 30s polls come back with nothing actually new — skip the full
      // list rebuild when this fetch changed nothing. Every other trigger
      // (posting, reacting, replying, deleting, avatar/image resolving)
      // still calls renderFeed() directly and unconditionally elsewhere;
      // this only short-circuits the specific "just refetched, nothing
      // changed" case, regardless of which caller triggered the fetch.
      if (signature !== _lastFeedPostsSignature) {
        _lastFeedPostsSignature = signature;
        renderFeed();
      }
    } catch (e) {
      // Only the first load needs a visible error — a background 30s poll
      // failing after posts are already showing just leaves the last-known
      // feed on screen (same pattern presence's own poll failure uses),
      // rather than yanking already-read content out from under someone.
      if (isFirstLoad) {
        listEl.innerHTML = '<div class="feed-empty">Couldn\'t load the feed.<button type="button" id="feedRetryBtn" class="feed-load-more">Retry</button></div>';
        document.getElementById('feedRetryBtn')?.addEventListener('click', fetchFeed);
        _lastFeedRenderKey = null;
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
      const r = await fetchTimeout(`/api/posts?limit=${FEED_PAGE_SIZE}&before_id=${oldestId}`, {}, 8000);
      if (!r.ok) return;
      const data = await r.json();
      const older = data.posts || [];
      _feedPosts = _feedPosts.concat(older);
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
        _feedPosts.slice(FEED_MAX_LOADED).forEach(p => { _repliesCache.delete(p.id); _repliesPending.delete(p.id); });
        _feedPosts.length = FEED_MAX_LOADED;
      }
      _feedHasMore = older.length === FEED_PAGE_SIZE;
      renderFeed();
    } catch (e) {
    } finally {
      _feedPending = false;
    }
  }

  function autoGrowComposer() {
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
      highlightEl.innerHTML = mentionHTML(textEl.value, null);
      highlightEl.scrollTop = textEl.scrollTop;
    }
  }

  // Shows/clears the "share to feed" song attachment preview. Called both
  // locally (clearComposer, the X button) and from window.klabShareSongToFeed
  // — the player module (a separate IIFE elsewhere in the file) has no
  // other way to reach into this closure's composer state.
  function setPendingSong(song) {
    _pendingSong = song || null;
    if (!song) { songPreviewEl.hidden = true; return; }
    songArtEl.src = song.coverArt
      ? `${ND_URL}/rest/getCoverArt?id=${encodeURIComponent(song.coverArt)}&size=100&${subsonicParams()}`
      : '';
    songTitleEl.textContent = song.title || 'Unknown';
    songArtistEl.textContent = song.artist || '';
    if (song.lyric) {
      songLyricEl.textContent = `"${song.lyric}"`;
      songLyricEl.hidden = false;
    } else {
      songLyricEl.hidden = true;
      songLyricEl.textContent = '';
    }
    songPreviewEl.hidden = false;
  }
  songRemoveEl.addEventListener('click', () => setPendingSong(null));
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
    _pendingFile = null;
    fileEl.value = '';
    previewWrapEl.hidden = true;
    imageBtnEl.classList.remove('has-image');
    setPendingSong(null);
    errEl.hidden = true;
    autoGrowComposer();
  }

  async function submitPost() {
    const text = textEl.value.trim();
    if (!text && !_pendingFile && !_pendingSong) return;
    errEl.hidden = true;
    postBtnEl.disabled = true;
    postBtnEl.innerHTML = '<i class="ti ti-loader-2 loading-spinner"></i>';
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
        body: JSON.stringify({ text, image_mxc, song: _pendingSong || null }),
      }, 15000);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to post');
      }
      clearComposer();
      SFX && SFX.play('star');
      await fetchFeed();
    } catch (e) {
      errEl.textContent = e.message || 'Failed to post';
      errEl.hidden = false;
    } finally {
      postBtnEl.disabled = false;
      postBtnEl.innerHTML = '<i class="ti ti-send-2"></i>';
    }
  }

  async function deletePost(id) {
    if (!(await showConfirmDialog('// delete post', 'Delete this post?', 'Delete'))) return;
    try {
      const r = await fetchTimeout('/api/posts/' + id, { method: 'DELETE' }, 8000);
      if (r.ok) {
        _feedPosts = _feedPosts.filter(p => p.id !== id);
        renderFeed();
        SFX && SFX.play('click');
      }
    } catch (e) {}
  }

  // Shared by the file-picker button and Ctrl/Cmd+V paste below — picking
  // a file was the ONLY way in before; pasting a screenshot straight from
  // the clipboard is the much more natural flow for "share this image" and
  // wasn't wired up at all.
  function attachFeedImage(file) {
    if (!file) return;
    errEl.hidden = true;
    if (file.size > FEED_MAX_IMAGE_BYTES) {
      errEl.textContent = 'Image too large (max 8MB)';
      errEl.hidden = false;
      return;
    }
    _pendingFile = file;
    imageBtnEl.classList.add('has-image');
    const reader = new FileReader();
    reader.onload = () => {
      previewEl.src = reader.result;
      previewWrapEl.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  imageBtnEl.addEventListener('click', () => fileEl.click());
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
  async function toggleFeedReaction(postId, emoji) {
    try {
      const r = await fetchTimeout(`/api/posts/${postId}/reactions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
      }, 8000);
      if (!r.ok) return;
      const data = await r.json();
      const post = _feedPosts.find(p => p.id === postId);
      if (post) post.reactions = data.reactions || {};
      renderFeed();
    } catch (e) {}
  }

  async function fetchFeedReplies(postId) {
    try {
      const r = await fetchTimeout(`/api/posts/${postId}/replies`, {}, 8000);
      if (!r.ok) return;
      const data = await r.json();
      _repliesCache.set(postId, data.replies || []);
      scheduleFeedRender();
    } catch (e) {
    } finally {
      _repliesPending.delete(postId);
    }
  }

  // Replies are always shown now — same resolve-then-rerender idiom as
  // ensureFeedAvatar()/ensureFeedImage() above, called from postHTML() on
  // every render. Skips posts with no replies at all (the common case)
  // rather than firing a fetch for every single post in the feed.
  function ensureFeedRepliesResolved(post) {
    if (!post.reply_count || _repliesCache.has(post.id) || _repliesPending.has(post.id)) return;
    _repliesPending.add(post.id);
    fetchFeedReplies(post.id);
  }

  async function submitFeedReply(postId, input) {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const r = await fetchTimeout(`/api/posts/${postId}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      }, 8000);
      if (!r.ok) { input.value = text; return; }
      const reply = await r.json();
      const list = _repliesCache.get(postId) || [];
      list.push(reply);
      _repliesCache.set(postId, list);
      const post = _feedPosts.find(p => p.id === postId);
      if (post) post.reply_count = (post.reply_count || 0) + 1;
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
        const fresh = listEl.querySelector(`.feed-post-reply-input[data-post-id="${postId}"]`);
        if (fresh) fresh.focus();
      }
    } catch (e) { input.value = text; }
  }

  async function deleteFeedReply(postId, replyId) {
    // Fired immediately with zero confirmation before — deletePost() just
    // above already confirms; a reply is the same class of destructive,
    // hard-to-undo action.
    if (!(await showConfirmDialog('// delete reply', 'Delete this reply?', 'Delete'))) return;
    try {
      const r = await fetchTimeout(`/api/posts/${postId}/replies/${replyId}`, { method: 'DELETE' }, 8000);
      if (!r.ok) return;
      const list = (_repliesCache.get(postId) || []).filter(rp => rp.id !== replyId);
      _repliesCache.set(postId, list);
      const post = _feedPosts.find(p => p.id === postId);
      if (post) post.reply_count = Math.max(0, (post.reply_count || 0) - 1);
      renderFeed();
    } catch (e) {}
  }

  loadMoreEl.addEventListener('click', loadOlderPosts);
  listEl.addEventListener('click', (e) => {
    const nameClick = e.target.closest('.feed-post-name, .feed-post-reply-name, .feed-post-mention, .feed-post-avatar, .feed-post-reply-avatar');
    if (nameClick?.dataset.username) { openProfileView(nameClick.dataset.username); return; }
    const del = e.target.closest('.feed-post-delete');
    if (del) { deletePost(Number(del.dataset.postId)); return; }
    const pill = e.target.closest('.feed-post-reaction-pill');
    if (pill) { toggleFeedReaction(Number(pill.dataset.postId), pill.dataset.emoji); return; }
    const replyOpen = e.target.closest('.feed-post-reply-open');
    if (replyOpen) {
      const postId = Number(replyOpen.dataset.postId);
      _openReplyBoxes.add(postId);
      const box = listEl.querySelector('.feed-post-replies[data-post-id="' + postId + '"]');
      box?.classList.add('replying');
      box?.querySelector('.feed-post-reply-input')?.focus();
      return;
    }
    const addReact = e.target.closest('.feed-post-add-reaction');
    if (addReact) {
      const postId = Number(addReact.dataset.postId);
      _openReactionPickers.has(postId) ? _openReactionPickers.delete(postId) : _openReactionPickers.add(postId);
      renderFeed();
      return;
    }
    const quickEmoji = e.target.closest('.feed-post-quick-reactions button');
    if (quickEmoji) {
      const postId = Number(quickEmoji.dataset.postId);
      _openReactionPickers.delete(postId);
      toggleFeedReaction(postId, quickEmoji.dataset.emoji);
      return;
    }
    const replySend = e.target.closest('.feed-post-reply-send');
    if (replySend) {
      const postId = Number(replySend.dataset.postId);
      const input = listEl.querySelector(`.feed-post-reply-input[data-post-id="${postId}"]`);
      if (input) submitFeedReply(postId, input);
      return;
    }
    const replyDelete = e.target.closest('.feed-post-reply-delete');
    if (replyDelete) { deleteFeedReply(Number(replyDelete.dataset.postId), Number(replyDelete.dataset.replyId)); return; }
    const photo = e.target.closest('.feed-post-image');
    if (photo) {
      openImageViewer({ thumbSrc: photo.src, mxc: photo.dataset.mxc, alt: photo.alt });
      return;
    }
    const songCard = e.target.closest('.feed-post-song');
    if (songCard) {
      try {
        const song = JSON.parse(decodeURIComponent(songCard.dataset.playSong));
        if (typeof playSong === 'function') playSong(song);
      } catch (e) {}
      return;
    }
  });
  listEl.addEventListener('keydown', (e) => {
    const input = e.target.closest('.feed-post-reply-input');
    if (input && e.key === 'Enter') submitFeedReply(Number(input.dataset.postId), input);
  });

  const FEED_POLL_MS = 30000; // same cadence as notes/offline-roster — a feed doesn't need second-by-second freshness
  fetchFeed();
  setInterval(fetchFeed, FEED_POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchFeed(); });

  // The very first fetchFeed() above almost always lands before Matrix has
  // finished (re)connecting — ensureFeedAvatar()/ensureFeedImage() correctly
  // skip resolving rather than caching a permanent failure (see their
  // client-readiness guards), but without this, nothing ever retried them
  // until the next 30s poll — in practice, "images don't load until you
  // click Load older" (whatever else happens to call renderFeed() first).
  // PREPARED is the same "client is actually usable now" signal the chat
  // module's own sync handler treats as settled.
  MatrixChat.on('sync', state => { if (state === 'PREPARED') renderFeed(); });
})();

// ── Volume icon mute toggle ──────────────
(function() {
  let _preMuteVol = 1;

  function updateVolIcons() {
    const muted = playerState.audio.muted || playerState.audio.volume === 0;
    ['fsVolIcon','volIcon'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = muted ? 'ti ti-volume-off' : 'ti ti-volume';
    });
  }

  ['fsVolIcon','volIcon'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      const a = playerState.audio;
      if (a.muted || a.volume === 0) {
        a.muted  = false;
        a.volume = _preMuteVol || 0.8;
      } else {
        _preMuteVol = a.volume;
        a.muted     = true;
      }
      updateVolIcons();
      SFX && SFX.play('click');
    });
  });

  playerState.audio.addEventListener('volumechange', updateVolIcons);
})();

// ── SFX on remaining interactive elements ────
[
  ['playerArtWrap',      'click'],
  ['dockFav',            'click'],
  ['dockShuffle',        'click'],
  ['fsClose',            'click'],
  ['fsFav',              'click'],
  ['fsShuffle',          'click'],
  ['fsRepeat',           'click'],
  ['fsLyrics',           'click'],
  ['fsQueue',            'click'],
  ['fsPlay',             'click'],
  ['fsPrev',             'click'],
  ['fsNext',             'click'],
  ['btnFS',              'click'],
  ['themeToggle',        'click'],
].forEach(([id, ev]) => {
  const el = document.getElementById(id);
  if (el && !el._sfxWired) {
    el._sfxWired = true;
    el.addEventListener(ev, () => SFX && SFX.play('click'));
  }
});
