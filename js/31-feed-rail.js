// ══════════════════════════════════════════
//  FEED: THE DATE RAIL
//  Music's albums and songs have a letter rail down the right (js/26-browse.js);
//  the Feed gets one for its days. One mark per day loaded (the day of the
//  month), the current one held by the pill; press or drag along it to glide
//  there, with a bubble saying which day and how many posts. It wakes while
//  the feed scrolls and dims a moment after. Older days join it as the feed
//  loads them. Same look as the letter rail (the .abc-* styles).
// ══════════════════════════════════════════
(function () {
  const panel = document.querySelector('.tab-panel[data-tab-panel="feed"]');
  const list = document.getElementById('feedList');
  const host = document.getElementById('socMain');
  if (!panel || !list || !host) return;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.fx === 'low';
  const zf = () => (typeof zoomFactor === 'function' ? zoomFactor() || 1 : 1);

  const el = document.createElement('div');
  el.className = 'abc-rail feed-rail';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-orientation', 'vertical');
  el.setAttribute('aria-label', 'Jump to a day');
  el.hidden = true;
  el.innerHTML = '<div class="abc-track"><span class="abc-pill"></span></div>';
  const track = el.firstChild, pill = track.firstChild;
  const bubble = document.createElement('div');
  bubble.className = 'abc-bubble feed-rail-bubble';
  bubble.setAttribute('aria-hidden', 'true');
  bubble.innerHTML = '<b class="long"></b><small></small>';
  const bKey = bubble.querySelector('b'), bSub = bubble.querySelector('small');
  host.append(el, bubble);

  let days = [], rows = [], cur = -1, railTop = 0, railH = 0;
  const shown = () => document.body.classList.contains('tab-feed-active');

  // Each day: its heading, and its label bits ("Monday", "October 26 · 2 posts").
  function collect() {
    return [...list.querySelectorAll(':scope > .feed-day')].map(h => {
      const name = h.querySelector('h3')?.textContent || '';
      const sub = h.querySelector('span')?.textContent || '';
      const [date, count] = sub.split(' · ');
      return { h, name, date: date || '', count: count || '', num: (/\d+/.exec(date || '') || [''])[0] };
    });
  }
  // Where a day starts in the scroll area: its first post, less the heading's room.
  function topOf(d) {
    const first = d.h.nextElementSibling || d.h;
    const z = zf();
    return panel.scrollTop + (first.getBoundingClientRect().top - panel.getBoundingClientRect().top) / z - d.h.offsetHeight - 6;
  }

  function rebuild() {
    const next = collect();
    const same = next.length === days.length && next.every((d, i) => d.h === days[i].h && d.count === days[i].count);
    days = next;
    if (!same) {
      track.querySelectorAll('.abc-k').forEach(k => k.remove());
      rows = days.map((d, i) => {
        const k = document.createElement('span');
        k.className = 'abc-k';
        k.textContent = d.num || '•';
        k.dataset.i = i;
        track.appendChild(k);
        return k;
      });
      cur = -1;
    }
    layout();
    sync();
  }

  // Down the feed's right edge, as tall as the days need (centred), at
  // least 14px a mark; when they don't fit, some become dots.
  function layout() {
    if (!shown() || days.length < 2 || panel.scrollHeight < panel.clientHeight * 1.5) { el.hidden = true; bubble.classList.remove('shown'); return; }
    const z = zf(), hb = host.getBoundingClientRect(), pb = panel.getBoundingClientRect();
    const dock = document.body.classList.contains('player-hidden') ? 16 : (parseFloat(getComputedStyle(document.body).getPropertyValue('--dock-room')) || 90);
    const top = (pb.top - hb.top) / z + 16, avail = Math.max(120, pb.height / z - 16 - dock);
    railH = Math.min(avail, rows.length * 21);
    railTop = top + (avail - railH) / 2;
    el.hidden = false;
    el.style.top = railTop + 'px';
    el.style.height = railH + 'px';
    const step = Math.max(1, Math.ceil(14 / (railH / rows.length)));
    rows.forEach((k, i) => {
      k.style.top = ((i + 0.5) / rows.length * 100) + '%';
      k.classList.toggle('dot', i % step !== 0 && i !== rows.length - 1);
    });
    placePill(false);
  }

  function current() {
    const at = panel.scrollTop + 24;
    let best = 0;
    for (let i = 0; i < days.length; i++) { if (topOf(days[i]) <= at) best = i; else break; }
    return best;
  }
  function placePill(animate = true) {
    if (cur < 0 || !rows[cur]) { pill.style.opacity = '0'; return; }
    pill.style.transition = animate && !reduced() ? '' : 'none';
    pill.style.opacity = '';
    pill.style.transform = `translateY(${(cur + 0.5) / rows.length * railH}px) translateY(-50%)`;
    el.setAttribute('aria-valuenow', cur);
    el.setAttribute('aria-valuetext', days[cur] ? `${days[cur].name}, ${days[cur].date}` : '');
  }
  function setCur(i) {
    if (i === cur) return;
    rows[cur]?.classList.remove('cur');
    cur = i;
    rows[cur]?.classList.add('cur');
    placePill();
  }
  let syncQueued = false;
  function sync() { syncQueued = false; if (!el.hidden && !dragging) setCur(current()); }

  let sleepT = 0;
  function wake() {
    el.classList.add('awake');
    clearTimeout(sleepT);
    sleepT = setTimeout(() => { if (!dragging && !el.matches(':hover, :focus-visible')) el.classList.remove('awake'); }, 1400);
  }
  panel.addEventListener('scroll', () => {
    if (el.hidden) return;
    if (!following) wake();
    if (!syncQueued) { syncQueued = true; requestAnimationFrame(sync); }
  }, { passive: true });

  // ── Gliding there ──
  let target = 0, following = false, raf = 0, last = 0;
  function stopFollow() { cancelAnimationFrame(raf); raf = 0; following = false; }
  function follow(now) {
    const dt = Math.min(48, now - (last || now)); last = now;
    const pos = panel.scrollTop, diff = target - pos;
    if (Math.abs(diff) < 0.75) { panel.scrollTop = target; stopFollow(); return; }
    const k = 1 - Math.pow(1 - (dragging ? 0.3 : 0.16), dt / 16.7);
    panel.scrollTop = pos + diff * k;
    if (Math.abs(panel.scrollTop - pos) < 0.1 && Math.abs(diff) > 1 && dt > 0) target = panel.scrollTop;
    raf = requestAnimationFrame(follow);
  }
  function goTo(i) {
    const d = days[i];
    if (!d) return;
    setCur(i);
    target = Math.max(0, Math.min(panel.scrollHeight - panel.clientHeight, topOf(d)));
    if (reduced()) { panel.scrollTop = target; return; }
    if (!following) { following = true; last = 0; raf = requestAnimationFrame(follow); }
  }
  ['wheel', 'touchstart'].forEach(t => panel.addEventListener(t, () => { if (following && !dragging) stopFollow(); }, { passive: true }));

  // ── Pressing, dragging, hovering ──
  let dragging = false, pointerY = null, bubbleY = 0, bubbleV = 0, bubbleRaf = 0, bubbleI = -1;
  const indexAt = y => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.floor((y - r.top) / r.height * rows.length)));
  };
  function showBubble(i) {
    if (i !== bubbleI) {
      bubbleI = i;
      const d = days[i];
      bKey.textContent = d ? d.date.replace(/^(\w{3})\w*/, '$1') : '';
      bSub.textContent = d ? `${d.name} · ${d.count}` : '';
      bKey.classList.remove('pop'); void bKey.offsetWidth; bKey.classList.add('pop');
    }
    bubble.classList.add('shown');
  }
  function bubbleStep() {
    bubbleRaf = 0;
    if (pointerY == null) return;
    const want = (pointerY - host.getBoundingClientRect().top) / zf();
    if (reduced()) bubbleY = want;
    else { bubbleV = (bubbleV + (want - bubbleY) * 0.24) * 0.62; bubbleY += bubbleV; }
    bubble.style.transform = `translateY(${bubbleY}px) translateY(-50%)`;
    if (Math.abs(want - bubbleY) > 0.3 || Math.abs(bubbleV) > 0.3) bubbleRaf = requestAnimationFrame(bubbleStep);
  }
  function swell(y) {
    if (reduced()) return;
    const r = track.getBoundingClientRect();
    for (const k of rows) {
      const kr = k.getBoundingClientRect();
      const d = (kr.top + kr.height / 2 - y) / (r.height / rows.length);
      k.style.setProperty('--swell', Math.exp(-(d * d) / 3.2).toFixed(3));
    }
  }
  const unswell = () => rows.forEach(k => k.style.removeProperty('--swell'));

  el.addEventListener('pointerdown', e => {
    if (el.hidden || e.button > 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragging = true;
    el.classList.add('dragging');
    wake();
    pointerY = e.clientY;
    bubbleY = (e.clientY - host.getBoundingClientRect().top) / zf(); bubbleV = 0; bubbleI = -1;
    const i = indexAt(e.clientY);
    showBubble(i); bubbleStep(); swell(e.clientY);
    goTo(i);
    SFX && SFX.play('tick');
  });
  el.addEventListener('pointermove', e => {
    if (el.hidden) return;
    if (!dragging) { if (e.pointerType === 'mouse') { el.classList.add('hovering'); swell(e.clientY); } return; }
    pointerY = e.clientY;
    swell(e.clientY);
    const i = indexAt(e.clientY);
    if (i !== bubbleI) { showBubble(i); goTo(i); SFX && SFX.play('tick'); }
    if (!bubbleRaf) bubbleRaf = requestAnimationFrame(bubbleStep);
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    pointerY = null;
    setTimeout(() => { if (!dragging) bubble.classList.remove('shown'); }, 380);
    if (!el.matches(':hover')) { unswell(); el.classList.remove('hovering'); }
    wake();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', () => { if (!dragging) { unswell(); el.classList.remove('hovering'); } });
  el.addEventListener('keydown', e => {
    const to = { ArrowDown: cur + 1, ArrowUp: cur - 1, PageDown: cur + 5, PageUp: cur - 5, Home: 0, End: days.length - 1 }[e.key];
    if (to == null || el.hidden) return;
    e.preventDefault();
    wake();
    goTo(Math.max(0, Math.min(days.length - 1, to)));
  });

  // Days arrive (first load, older posts, new ones) and the feed changes size.
  let rebuildQueued = false;
  const queue = () => { if (!rebuildQueued) { rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuild(); }); } };
  new MutationObserver(queue).observe(list, { childList: true, subtree: true, characterData: true });
  new ResizeObserver(queue).observe(panel);
  new MutationObserver(queue).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  queue();
})();
