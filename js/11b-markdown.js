// ══════════════════════════════════════════
//  MARKDOWN — how feed posts are written and shown.
//    · klabMarkdown(raw, me, {inline}) → safe HTML. GitHub-flavored
//      markdown (tables, task lists, fenced code, strikethrough) plus
//      ||spoilers||, ==highlights==, > [!NOTE] callouts and @mentions.
//    · klabMdSyntax(raw) → the composer's live-colored overlay: the same
//      text, character for character, with the syntax tinted as you type.
//    · klabMdEditor(textarea, opts) → the keyboard side: Cmd+B/I/K/E and
//      friends, wrap-the-selection, lists that continue themselves, paste
//      a link over a word to link it.
//
//  Safety: raw HTML in a post is shown as text, never parsed, and the
//  output still goes through DOMPurify with links held to http(s)/mailto —
//  the same scheme rule linkifyHTML has always relied on.
//  Parsing is vendored (js/vendor/marked, purify); syntax highlighting for
//  code blocks loads on first use (js/vendor/highlight.min.js, ~125KB).
// ══════════════════════════════════════════
(function() {
  if (!window.marked || !window.DOMPurify) {
    // A failed vendor load mustn't take the feed down with it: posts fall
    // back to the old plain text + links + mentions.
    window.klabMarkdown = null;
    return;
  }

  // ── Syntax highlighting, loaded the first time a post has a code block
  // that names its language. Until it arrives, code shows plain. ──
  let hljsState = window.hljs ? 'ready' : 'idle';
  const hlWaiters = [];
  function wantHighlighter() {
    if (hljsState !== 'idle') return;
    hljsState = 'loading';
    const s = document.createElement('script');
    s.src = 'js/vendor/highlight.min.js?v=' + (window.KLABNET_VERSION || '');
    s.onload = () => {
      hljsState = window.hljs ? 'ready' : 'failed';
      cache.clear();
      // Posts already on screen: color them in place.
      document.querySelectorAll('pre.md-code code[data-lang]:not(.hljs)').forEach(highlightEl);
      hlWaiters.splice(0).forEach(f => f());
    };
    s.onerror = () => { hljsState = 'failed'; };
    document.head.appendChild(s);
  }
  function highlightEl(code) {
    const lang = code.dataset.lang;
    if (!window.hljs || !lang || !hljs.getLanguage(lang)) return;
    try { hljs.highlightElement(code); } catch (e) {}
  }
  window.klabMdWhenHighlighted = fn => hljsState === 'ready' ? fn() : hlWaiters.push(fn);

  const md = new marked.Marked({ gfm: true, breaks: true });
  md.use({
    extensions: [
      {
        name: 'spoiler', level: 'inline',
        start: src => { const i = src.indexOf('||'); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^\|\|(?=\S)([^\n]*?\S)\|\|/.exec(src);
          if (m) return { type: 'spoiler', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(t) { return '<span class="md-spoiler" tabindex="0" role="button" aria-label="Spoiler, click to reveal">' + this.parser.parseInline(t.tokens) + '</span>'; },
      },
      {
        name: 'mark', level: 'inline',
        start: src => { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
          if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(t) { return '<mark>' + this.parser.parseInline(t.tokens) + '</mark>'; },
      },
    ],
    renderer: {
      // Typed HTML is text. Nobody's post gets to ship markup.
      html(t) { return esc(t.text); },
      checkbox({ checked }) { return '<span class="md-check' + (checked ? ' on' : '') + '" aria-label="' + (checked ? 'done' : 'not done') + '"></span>'; },
      code({ text, lang }) {
        const l = String(lang || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^\w+#-]/g, '');
        let body = esc(text), cls = '';
        if (l) {
          if (hljsState === 'ready' && hljs.getLanguage(l)) {
            try { body = hljs.highlight(text, { language: l, ignoreIllegals: true }).value; cls = ' hljs'; } catch (e) {}
          } else wantHighlighter();
        }
        return '<pre class="md-code">' +
          '<code' + (l ? ' data-lang="' + esc(l) + '" class="language-' + esc(l) + cls + '"' : '') + '>' + body + '</code></pre>';
      },
      image({ href, title, text }) {
        return '<img class="md-img" src="' + esc(href) + '" alt="' + esc(text) + '"' + (title ? ' title="' + esc(title) + '"' : '') + ' loading="lazy" />';
      },
    },
  });

  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
      node.classList.add('rich-link');
    }
    // Someone else's image host shouldn't learn which page you were on.
    if (node.tagName === 'IMG') node.setAttribute('referrerpolicy', 'no-referrer');
  });
  const PURIFY = {
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'button', 'iframe', 'video', 'audio', 'svg', 'math'],
    ADD_TAGS: ['mark'],
    ADD_ATTR: ['target', 'referrerpolicy', 'data-lang'],
    RETURN_DOM: true,
  };

  const CALLOUTS = { NOTE: 'ti-info-circle', TIP: 'ti-bulb', IMPORTANT: 'ti-message-2-exclamation', WARNING: 'ti-alert-triangle', CAUTION: 'ti-alert-octagon' };
  const MENTION_RE = /(^|[^\w@])@([a-zA-Z0-9_][\w.-]*)/g;

  // Things done on the parsed tree that are awkward inside the parser:
  // mentions (never inside code or a link), callouts, and the copy buttons
  // the sanitizer is right to strip from user input.
  function finish(root, me) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('code, pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const hits = [];
    for (let n; (n = walker.nextNode());) if (n.nodeValue.includes('@')) hits.push(n);
    for (const n of hits) {
      const text = n.nodeValue, frag = document.createDocumentFragment();
      let last = 0, m;
      MENTION_RE.lastIndex = 0;
      while ((m = MENTION_RE.exec(text))) {
        const at = m.index + m[1].length, name = m[2];
        frag.append(text.slice(last, at));
        const span = document.createElement('span');
        span.className = 'feed-post-mention' + (me && name.toLowerCase() === me.toLowerCase() ? ' is-me' : '');
        span.dataset.username = name.toLowerCase();
        if (typeof profileColor === 'function') span.style.color = profileColor(name.toLowerCase());
        span.textContent = '@' + name;
        frag.append(span);
        last = at + 1 + name.length;
      }
      if (!last) continue;
      frag.append(text.slice(last));
      n.replaceWith(frag);
    }
    root.querySelectorAll('blockquote').forEach(bq => {
      const p = bq.firstElementChild;
      const m = p && p.tagName === 'P' && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(p.textContent);
      if (!m) return;
      const kind = m[1].toUpperCase();
      // Strip the marker from the first text node (it may be followed by a
      // <br> and the callout's first line).
      const first = p.firstChild;
      if (first && first.nodeType === 3) first.nodeValue = first.nodeValue.replace(/^\s*\[![A-Za-z]+\]\s*/, '');
      while (p.firstChild && (p.firstChild.nodeType === 3 ? !p.firstChild.nodeValue.trim() : p.firstChild.tagName === 'BR')) p.firstChild.remove();
      if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
      bq.classList.add('md-callout', 'md-callout-' + kind.toLowerCase());
      const head = document.createElement('div');
      head.className = 'md-callout-title';
      head.innerHTML = '<i class="ti ' + CALLOUTS[kind] + '"></i>';
      head.append(kind[0] + kind.slice(1).toLowerCase());
      bq.prepend(head);
    });
    root.querySelectorAll('pre').forEach(pre => {
      pre.classList.add('md-code');
      if (!pre.querySelector('.md-code-copy')) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'md-code-copy'; b.title = 'Copy';
        b.innerHTML = '<i class="ti ti-copy"></i>';
        pre.prepend(b);
      }
    });
    root.querySelectorAll('table').forEach(t => {
      if (t.parentElement.classList.contains('md-table')) return;
      const wrap = document.createElement('div');
      wrap.className = 'md-table';
      t.replaceWith(wrap);
      wrap.append(t);
    });
  }

  // Same text renders the same way every time, and the feed re-renders a
  // post whenever its reactions or replies change — so keep the results.
  const cache = new Map();
  window.klabMarkdown = function(raw, me, opts) {
    const inline = !!(opts && opts.inline);
    const key = (inline ? 'i' : 'b') + (me || '') + '\u0000' + raw;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let html;
    try {
      const src = String(raw || '');
      const dirty = inline ? md.parseInline(src) : md.parse(src);
      const root = DOMPurify.sanitize(dirty, PURIFY);
      finish(root, me);
      html = root.innerHTML;
    } catch (e) {
      html = linkifyHTML(raw);
    }
    if (opts && opts.nocache) return html;
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    cache.set(key, html);
    return html;
  };

  // Rough "is this post long" check, so long ones can start folded.
  window.klabMdIsLong = raw => {
    const s = String(raw || '');
    return s.length > 900 || (s.match(/\n/g) || []).length > 14 || /```[\s\S]{400,}/.test(s);
  };

  // Delegated behaviour for rendered markdown anywhere on the page:
  // spoilers reveal on click/Enter, code blocks copy.
  function toggleSpoiler(el) { el.classList.add('revealed'); el.removeAttribute('role'); el.removeAttribute('tabindex'); }
  document.addEventListener('click', e => {
    const sp = e.target.closest('.md-spoiler:not(.revealed)');
    if (sp) { e.preventDefault(); e.stopPropagation(); toggleSpoiler(sp); return; }
    const copy = e.target.closest('.md-code-copy');
    if (copy) {
      e.stopPropagation();
      const code = copy.closest('pre')?.querySelector('code');
      if (!code) return;
      navigator.clipboard?.writeText(code.textContent).then(() => {
        copy.classList.add('done');
        copy.innerHTML = '<i class="ti ti-check"></i>';
        setTimeout(() => { copy.classList.remove('done'); copy.innerHTML = '<i class="ti ti-copy"></i>'; }, 1400);
      }).catch(() => {});
    }
  }, true);
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('md-spoiler') && !e.target.classList.contains('revealed')) {
      e.preventDefault(); toggleSpoiler(e.target);
    }
  });

  // ── Live syntax coloring for the composer ──
  // Must emit exactly the input characters (only wrapped in spans) and never
  // change a glyph's width — the textarea's caret sits on top of it. So:
  // colors, backgrounds and line-through only; no bold, no italics.
  function mdInline(s) {
    // Tokenize the raw line; each piece is escaped on its own.
    const re = /(`+)([^`]|[^`][\s\S]*?[^`])\1|\*\*(?=\S)[^\n]*?\S\*\*|__(?=\S)[^\n]*?\S__|~~(?=\S)[^\n]*?\S~~|\|\|(?=\S)[^\n]*?\S\|\||==(?=\S)[^\n]*?\S==|(?<![\w*])\*(?=[^\s*])[^\n*]*?[^\s*]\*(?!\*)|(?<![\w_])_(?=[^\s_])[^\n_]*?[^\s_]_(?![\w_])|!?\[[^\]\n]*\]\([^)\s]*\)|\bhttps?:\/\/[^\s<>]+|(?<![\w@])@[a-zA-Z0-9_][\w.-]*/g;
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      const t = m[0];
      out += esc(s.slice(last, m.index));
      let h;
      if (t[0] === '`') {
        const n = m[1].length;
        h = '<span class="mdx-mark">' + esc(t.slice(0, n)) + '</span><span class="mdx-code">' + esc(t.slice(n, -n)) + '</span><span class="mdx-mark">' + esc(t.slice(-n)) + '</span>';
      } else if (t.startsWith('**') || t.startsWith('__')) h = wrapM(t, 2, 'mdx-strong');
      else if (t.startsWith('~~')) h = wrapM(t, 2, 'mdx-strike');
      else if (t.startsWith('||')) h = wrapM(t, 2, 'mdx-spoiler');
      else if (t.startsWith('==')) h = wrapM(t, 2, 'mdx-hl');
      else if (t[0] === '*' || t[0] === '_') h = wrapM(t, 1, 'mdx-em');
      else if (t[0] === '[' || t[0] === '!') {
        const mid = t.indexOf('](');
        h = '<span class="mdx-mark">' + esc(t.slice(0, t[0] === '!' ? 2 : 1)) + '</span><span class="mdx-link">' + esc(t.slice(t[0] === '!' ? 2 : 1, mid)) +
          '</span><span class="mdx-mark">' + esc(t.slice(mid)) + '</span>';
      } else if (t[0] === '@') {
        const name = t.slice(1).toLowerCase();
        h = '<span class="feed-post-mention" style="color:' + (typeof profileColor === 'function' ? profileColor(name) : 'inherit') + '">' + esc(t) + '</span>';
      } else h = '<span class="mdx-link">' + esc(t) + '</span>';
      out += h;
      last = m.index + t.length;
    }
    return out + esc(s.slice(last));
  }
  function wrapM(t, n, cls) {
    return '<span class="' + cls + '"><span class="mdx-mark">' + esc(t.slice(0, n)) + '</span>' + mdInline(t.slice(n, -n)) + '<span class="mdx-mark">' + esc(t.slice(-n)) + '</span></span>';
  }
  window.klabMdSyntax = function(raw) {
    const lines = String(raw || '').split('\n');
    let fence = null;
    const out = lines.map(line => {
      const f = /^(\s*)(```+|~~~+)(.*)$/.exec(line);
      if (fence) {
        if (f && f[2][0] === fence[0] && f[2].length >= fence.length) { fence = null; return '<span class="mdx-mark">' + esc(line) + '</span>'; }
        return '<span class="mdx-codeblock">' + esc(line) + '</span>';
      }
      if (f) { fence = f[2]; return '<span class="mdx-mark">' + esc(f[1] + f[2]) + '</span><span class="mdx-lang">' + esc(f[3]) + '</span>'; }
      let m;
      if ((m = /^(#{1,6} )(.*)$/.exec(line))) return '<span class="mdx-mark">' + esc(m[1]) + '</span><span class="mdx-h">' + mdInline(m[2]) + '</span>';
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return '<span class="mdx-mark">' + esc(line) + '</span>';
      if ((m = /^(\s*(?:>\s?)+)(\[![A-Za-z]+\])?(.*)$/.exec(line))) return '<span class="mdx-mark">' + esc(m[1]) + '</span>' + (m[2] ? '<span class="mdx-callout">' + esc(m[2]) + '</span>' : '') + '<span class="mdx-quote">' + mdInline(m[3]) + '</span>';
      if ((m = /^(\s*(?:[-*+]|\d+[.)]) )(\[[ xX]\] )?(.*)$/.exec(line))) return '<span class="mdx-list">' + esc(m[1]) + '</span>' + (m[2] ? '<span class="mdx-list">' + esc(m[2]) + '</span>' : '') + mdInline(m[3]);
      if (/^\s*\|.*\|\s*$/.test(line)) return esc(line).replace(/\|/g, '<span class="mdx-mark">|</span>');
      return mdInline(line);
    });
    // A trailing newline in a textarea still gets a line; a div needs
    // something in it to take the height.
    return out.join('\n') + (raw.endsWith('\n') ? ' ' : '');
  };

  // ── The editor ──
  // Every change goes through execCommand('insertText') so Cmd+Z undoes a
  // bold or a list continuation like any typed character. setRangeText is
  // the fallback where that's unavailable.
  function replaceRange(ta, start, end, text, selStart, selEnd) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) {}
    if (!ok) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selStart != null) ta.setSelectionRange(selStart, selEnd == null ? selStart : selEnd);
  }

  // Wrap the selection in before/after, or unwrap it if it's already wrapped.
  function wrap(ta, before, after, placeholder) {
    after = after == null ? before : after;
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e);
    if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replaceRange(ta, s - before.length, e + after.length, sel, s - before.length, e - before.length);
      return;
    }
    if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      const inner = sel.slice(before.length, sel.length - after.length);
      replaceRange(ta, s, e, inner, s, s + inner.length);
      return;
    }
    const inner = sel || placeholder || '';
    replaceRange(ta, s, e, before + inner + after, s + before.length, s + before.length + inner.length);
  }

  function lineBounds(v, s, e) {
    const a = v.lastIndexOf('\n', s - 1) + 1;
    let b = v.indexOf('\n', Math.max(e - (e > s && v[e - 1] === '\n' ? 1 : 0), s));
    if (b < 0) b = v.length;
    return [a, b];
  }

  // Toggle a prefix on every selected line ("> ", "- ", "1. ", "# "...).
  function prefixLines(ta, prefix, re) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const [a, b] = lineBounds(v, s, e);
    const lines = v.slice(a, b).split('\n');
    const all = lines.every(l => re.test(l) || !l.trim());
    let n = 0;
    const next = lines.map(l => {
      if (all) return l.replace(re, '');
      if (!l.trim() && lines.length > 1) return l;
      n++;
      const bare = l.replace(/^(\s*)(?:#{1,6} |> ?|[-*+] (?:\[[ xX]\] )?|\d+[.)] )/, '$1');
      return (typeof prefix === 'function' ? prefix(n) : prefix) + bare;
    }).join('\n');
    replaceRange(ta, a, b, next, a, a + next.length);
    if (lines.length === 1) ta.setSelectionRange(a + next.length, a + next.length);
  }

  function insertBlock(ta, text, caretOffset) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const pre = s > 0 && v[s - 1] !== '\n' ? '\n\n' : (s > 1 && v[s - 2] !== '\n' ? '\n' : '');
    const post = v[e] && v[e] !== '\n' ? '\n\n' : '';
    const at = s + pre.length + (caretOffset == null ? text.length : caretOffset);
    replaceRange(ta, s, e, pre + text + post, at);
  }

  function link(ta) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e);
    if (/^https?:\/\/\S+$/.test(sel)) {
      replaceRange(ta, s, e, '[](' + sel + ')', s + 1);
    } else {
      const text = sel || 'text';
      replaceRange(ta, s, e, '[' + text + '](https://)', s + text.length + 3, s + text.length + 11);
    }
  }

  const ACTIONS = {
    bold:    ta => wrap(ta, '**', '**', 'bold'),
    italic:  ta => wrap(ta, '*', '*', 'italic'),
    strike:  ta => wrap(ta, '~~', '~~', 'struck'),
    spoiler: ta => wrap(ta, '||', '||', 'spoiler'),
    mark:    ta => wrap(ta, '==', '==', 'highlight'),
    code:    ta => {
      const { selectionStart: s, selectionEnd: e, value: v } = ta;
      if (v.slice(s, e).includes('\n')) wrap(ta, '```\n', '\n```');
      else wrap(ta, '`', '`', 'code');
    },
    codeblock: ta => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      insertBlock(ta, '```js\n' + sel + '\n```', 6 + sel.length);
    },
    link,
    heading: ta => {
      // Cycles # → ## → ### → plain.
      const { selectionStart: s, value: v } = ta;
      const [a, b] = lineBounds(v, s, s);
      const line = v.slice(a, b), m = /^(#{1,6}) /.exec(line);
      const lvl = m ? m[1].length : 0;
      const bare = line.replace(/^#{1,6} /, '');
      const next = (lvl >= 3 ? '' : '#'.repeat(lvl + 1) + ' ') + bare;
      replaceRange(ta, a, b, next, a + next.length);
    },
    quote:   ta => prefixLines(ta, '> ', /^> ?/),
    ul:      ta => prefixLines(ta, '- ', /^\s*[-*+] (?!\[[ xX]\] )/),
    ol:      ta => prefixLines(ta, n => n + '. ', /^\s*\d+[.)] /),
    task:    ta => prefixLines(ta, '- [ ] ', /^\s*[-*+] \[[ xX]\] /),
    callout: ta => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      const body = (sel || 'something worth noticing').split('\n').map(l => '> ' + l).join('\n');
      insertBlock(ta, '> [!NOTE]\n' + body);
    },
    table:   ta => insertBlock(ta, '| thing | rating |\n| --- | --- |\n| this | 10/10 |', 2),
    hr:      ta => insertBlock(ta, '---'),
  };
  window.klabMdActions = ACTIONS;

  // Keyed by physical key, so Shift+7 is "7" on any layout and Option
  // combos on a Mac aren't turned into symbols first.
  const KEYS = {
    'b': 'bold', 'i': 'italic', 'k': 'link', 'e': 'code',
    'shift+x': 'strike', 'shift+s': 'spoiler', 'shift+h': 'mark',
    'shift+.': 'quote', 'shift+8': 'ul', 'shift+7': 'ol', 'shift+9': 'task',
    'alt+h': 'heading', 'alt+c': 'codeblock',
  };
  function keyName(e) {
    const c = e.code || '';
    const base = c.startsWith('Key') ? c.slice(3).toLowerCase() : c.startsWith('Digit') ? c.slice(5) : c === 'Period' ? '.' : (e.key || '').toLowerCase();
    return (e.shiftKey ? 'shift+' : '') + (e.altKey ? 'alt+' : '') + base;
  }
  const PAIRS = { '*': '*', '_': '_', '~': '~', '`': '`', '=': '=', '|': '|', '(': ')', '[': ']', '"': '"' };

  window.klabMdEditor = function(ta, opts = {}) {
    ta.addEventListener('keydown', e => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        const k = keyName(e);
        const name = KEYS[k];
        if (name) { e.preventDefault(); ACTIONS[name](ta); opts.onAction?.(name); return; }
        if (k === 'alt+p' && opts.onTogglePreview) { e.preventDefault(); opts.onTogglePreview(); return; }
        return;
      }
      const { selectionStart: s, selectionEnd: e2, value: v } = ta;
      // Typing a marker with text selected wraps it instead of replacing it.
      if (s !== e2 && PAIRS[e.key] && !e.altKey) {
        e.preventDefault();
        wrap(ta, e.key, PAIRS[e.key]);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && s === e2) {
        const a = v.lastIndexOf('\n', s - 1) + 1;
        const line = v.slice(a, s);
        const m = /^(\s*)((?:[-*+]|(\d+)([.)])) (?:\[[ xX]\] )?|> ?)(.*)$/.exec(line);
        if (!m) return;
        // Inside a fenced code block Enter is just Enter.
        if (((v.slice(0, a).match(/^\s*```/gm) || []).length % 2) === 1) return;
        e.preventDefault();
        if (!m[5].trim() && v.slice(s, v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s)).trim() === '') {
          // Enter on an empty item ends the list, with a blank line so
          // what comes next isn't read as part of the last item.
          replaceRange(ta, a, s, '\n', a + 1);
          return;
        }
        let marker = m[2];
        if (m[3]) marker = (parseInt(m[3], 10) + 1) + m[4] + ' ';
        marker = marker.replace(/\[[xX]\]/, '[ ]');
        replaceRange(ta, s, s, '\n' + m[1] + marker);
        return;
      }
      if (e.key === 'Tab' && !e.altKey) {
        const [a, b] = lineBounds(v, s, e2);
        const block = v.slice(a, b);
        // Only inside lists: elsewhere Tab keeps moving focus.
        if (!/^\s*(?:[-*+]|\d+[.)]) /m.test(block)) return;
        e.preventDefault();
        const next = block.split('\n').map(l => e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l).join('\n');
        const d = next.length - block.length;
        replaceRange(ta, a, b, next, Math.max(a, s + (e.shiftKey ? Math.min(0, d) : 2)), e2 + d);
      }
    });
    // Pasting a URL over selected text links it.
    ta.addEventListener('paste', e => {
      const text = e.clipboardData?.getData('text/plain') || '';
      const { selectionStart: s, selectionEnd: e2, value: v } = ta;
      if (s === e2 || !/^https?:\/\/\S+$/.test(text.trim()) || /\n/.test(v.slice(s, e2))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      replaceRange(ta, s, e2, '[' + v.slice(s, e2) + '](' + text.trim() + ')');
    });
  };
})();
