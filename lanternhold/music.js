/* lh-build 202611232219 */
/* Lanternhold music player. Original score, streamed one track at a time (nothing downloads until it plays).
   Settings live in localStorage "lh_music": {on, vol, idx, shuffle, muted}. window.LHMusic is the small API ui.js uses. */
(function () {
  'use strict';
  const TRACKS = [
    { id: 'banners', title: 'Banners at Dawn', mood: 'Main theme', len: 168 },
    { id: 'hearthfire', title: 'Hearthfire Waltz', mood: 'Camp', len: 167 },
    { id: 'road', title: 'Road to the Shattered Reach', mood: 'Adventure', len: 156 },
    { id: 'market', title: 'Market of Many Lanterns', mood: 'Market', len: 127 },
    { id: 'deep', title: 'Beneath the Lantern Deep', mood: 'Dungeon', len: 163 },
    { id: 'tavern', title: 'The Lost Lantern Tavern', mood: 'Tavern jig', len: 109 },
    { id: 'ember', title: 'Ember Ring', mood: 'Battle', len: 136 },
    { id: 'starlit', title: 'Starlit Watch', mood: 'Night', len: 190 },
  ];
  const KEY = 'lh_music';
  const st = Object.assign({ on: true, vol: 0.45, idx: 0, shuffle: false, muted: false }, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
  if (!(st.idx >= 0 && st.idx < TRACKS.length)) st.idx = 0;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };

  const au = new Audio();
  au.preload = 'none';
  let ctx = null, gain = null, started = false, fadeT = 0, panel = null, history = [];

  // iOS ignores audio.volume, so volume runs through a Web Audio gain node where we can make one.
  function graph() {
    if (ctx || !(window.AudioContext || window.webkitAudioContext)) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gain = ctx.createGain();
      ctx.createMediaElementSource(au).connect(gain).connect(ctx.destination);
    } catch (e) { ctx = null; gain = null; }
  }
  function level(v, secs) {
    v = Math.max(0, Math.min(1, v));
    const target = v * v; // perceptual curve
    if (gain && ctx) {
      const t = ctx.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(target, t + (secs || 0.05)); au.volume = 1;
    } else {
      clearInterval(fadeT); const from = au.volume, steps = Math.max(1, Math.round((secs || 0.05) * 20)); let k = 0;
      fadeT = setInterval(() => { k++; au.volume = from + (target - from) * k / steps; if (k >= steps) clearInterval(fadeT); }, 50);
    }
  }
  function load(i, play) {
    st.idx = (i + TRACKS.length) % TRACKS.length; persist();
    const t = TRACKS[st.idx];
    au.src = 'music/' + t.id + '.mp3';
    if (play) start();
    media(); render();
  }
  function start() {
    if (!st.on) return;
    graph();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (!au.src) { load(st.idx, false); }
    if (gain) gain.gain.value = 0; else au.volume = 0;
    const p = au.play(); started = true;
    if (p && p.catch) p.catch(() => { started = false; });
    level(st.muted ? 0 : st.vol, 1.5);
    render();
  }
  function pause() { au.pause(); render(); }
  function pick() {
    if (!st.shuffle) return st.idx + 1;
    let j; do { j = Math.floor(Math.random() * TRACKS.length); } while (TRACKS.length > 1 && j === st.idx);
    return j;
  }
  function next() { history.push(st.idx); if (history.length > 20) history.shift(); load(pick(), st.on); }
  function prev() {
    if (au.currentTime > 4) { au.currentTime = 0; return; }
    load(history.length ? history.pop() : st.idx - 1, st.on);
  }
  au.addEventListener('ended', next);
  au.addEventListener('error', () => { if (started && st.on) setTimeout(next, 1500); });
  au.addEventListener('play', render); au.addEventListener('pause', render);
  au.addEventListener('timeupdate', () => { if (panel && !panel.hidden) bar(); });

  function setOn(on) {
    st.on = !!on; persist();
    if (st.on) start(); else pause();
    render();
  }
  function setVol(v) { st.vol = Math.max(0, Math.min(1, v)); st.muted = false; persist(); level(st.vol, 0.08); if (st.vol > 0 && !st.on) setOn(true); render(); }
  function setMuted(m) { st.muted = !!m; persist(); level(st.muted ? 0 : st.vol, 0.15); if (!st.muted && !st.on) setOn(true); render(); }

  // first tap or key anywhere starts the music (browsers block sound before that)
  function kick() {
    ['pointerdown', 'keydown', 'touchend'].forEach(e => window.removeEventListener(e, kick, true));
    if (st.on && au.paused) { if (!au.src) load(st.idx, false); start(); }
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(e => window.addEventListener(e, kick, true));

  // phone lock screen and headset buttons
  function media() {
    if (!('mediaSession' in navigator)) return;
    const t = TRACKS[st.idx];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: 'Lanternhold', album: 'Lanternhold Original Score', artwork: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }] });
      navigator.mediaSession.setActionHandler('nexttrack', next);
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('play', () => setOn(true));
      navigator.mediaSession.setActionHandler('pause', () => setOn(false));
    } catch (e) {}
  }

  // ---------- panel ----------
  const ICON = {
    play: '<path fill="currentColor" d="M8 5v14l11-7z"/>',
    pause: '<path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z"/>',
    next: '<path fill="currentColor" d="M6 6l8.5 6L6 18zm10 0h2v12h-2z"/>',
    prev: '<path fill="currentColor" d="M18 6l-8.5 6L18 18zM6 6h2v12H6z"/>',
    shuffle: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6C14.3 16 15.5 17 17.5 17H21m0 0-2.5-2.5M21 17l-2.5 2.5M3 17h3.5c1.3 0 2.2-.4 3-1.2M21 7h-3.5c-1.3 0-2.2.4-3 1.2M21 7l-2.5-2.5M21 7l-2.5 2.5"/>',
    vol: '<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>',
    mute: '<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/>',
  };
  const svg = k => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';
  const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function build() {
    panel = document.createElement('div');
    panel.className = 'mus-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Music');
    panel.innerHTML =
      '<div class="mus-head"><div><small>Now playing</small><b id="mus-title"></b><span id="mus-mood"></span></div>' +
      '<button class="mus-x" id="mus-close" aria-label="Close">&times;</button></div>' +
      '<div class="mus-bar"><i id="mus-prog"></i></div><div class="mus-times"><span id="mus-cur">0:00</span><span id="mus-len"></span></div>' +
      '<div class="mus-ctl">' +
      '<button id="mus-shuffle" aria-label="Shuffle" data-tip="Shuffle">' + svg('shuffle') + '</button>' +
      '<button id="mus-prev" aria-label="Previous track">' + svg('prev') + '</button>' +
      '<button id="mus-play" class="mus-main" aria-label="Play"></button>' +
      '<button id="mus-next" aria-label="Next track">' + svg('next') + '</button>' +
      '<button id="mus-mute" aria-label="Mute music"></button></div>' +
      '<label class="mus-vol"><span>Volume</span><input type="range" id="mus-vol" min="0" max="100" step="1"></label>' +
      '<ol class="mus-list" id="mus-list">' + TRACKS.map((t, i) =>
        '<li><button data-i="' + i + '"><em>' + (i + 1) + '</em><span><b>' + esc(t.title) + '</b><small>' + esc(t.mood) + '</small></span><time>' + mmss(t.len) + '</time></button></li>').join('') + '</ol>' +
      '<p class="mus-note">Original Lanternhold score. Your choices are saved on this device.</p>';
    document.body.appendChild(panel);
    const q = id => panel.querySelector('#' + id);
    q('mus-close').onclick = close;
    q('mus-play').onclick = () => { if (!st.on) { setOn(true); } else if (au.paused) start(); else { st.on = false; persist(); pause(); } };
    q('mus-next').onclick = () => { if (!st.on) st.on = true; next(); };
    q('mus-prev').onclick = () => { if (!st.on) st.on = true; prev(); };
    q('mus-shuffle').onclick = () => { st.shuffle = !st.shuffle; persist(); render(); };
    q('mus-mute').onclick = () => setMuted(!st.muted);
    q('mus-vol').oninput = e => setVol(e.target.value / 100);
    q('mus-list').onclick = e => { const b = e.target.closest('button[data-i]'); if (!b) return; st.on = true; history.push(st.idx); load(+b.dataset.i, true); };
    panel.querySelector('.mus-bar').onclick = e => {
      const r = e.currentTarget.getBoundingClientRect(), d = au.duration || TRACKS[st.idx].len;
      if (au.src && isFinite(d)) au.currentTime = Math.max(0, Math.min(d - 1, (e.clientX - r.left) / r.width * d));
    };
    document.addEventListener('pointerdown', e => { if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#btn-music')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
  }
  function bar() {
    const d = au.duration && isFinite(au.duration) ? au.duration : TRACKS[st.idx].len;
    panel.querySelector('#mus-prog').style.width = (100 * (au.currentTime || 0) / d).toFixed(2) + '%';
    panel.querySelector('#mus-cur').textContent = mmss(au.currentTime || 0);
    panel.querySelector('#mus-len').textContent = mmss(d);
  }
  function render() {
    const btn = document.getElementById('btn-music');
    const playing = st.on && !au.paused;
    if (btn) { btn.classList.toggle('on', playing && !st.muted); btn.classList.toggle('off', !st.on || st.muted); }
    if (!panel) return;
    const t = TRACKS[st.idx], q = id => panel.querySelector('#' + id);
    q('mus-title').textContent = t.title; q('mus-mood').textContent = t.mood;
    q('mus-play').innerHTML = svg(playing ? 'pause' : 'play'); q('mus-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    q('mus-mute').innerHTML = svg(st.muted ? 'mute' : 'vol'); q('mus-mute').classList.toggle('act', st.muted);
    q('mus-mute').setAttribute('aria-label', st.muted ? 'Unmute music' : 'Mute music');
    q('mus-shuffle').classList.toggle('act', st.shuffle);
    q('mus-vol').value = Math.round(st.vol * 100);
    panel.querySelectorAll('#mus-list button').forEach(b => b.classList.toggle('cur', +b.dataset.i === st.idx));
    bar();
  }
  function open() {
    if (!panel) build();
    panel.hidden = false; render();
    const b = document.getElementById('btn-music');
    if (b) b.setAttribute('aria-expanded', 'true');
  }
  function close() { if (panel) panel.hidden = true; const b = document.getElementById('btn-music'); if (b) b.setAttribute('aria-expanded', 'false'); }

  function wire() {
    const b = document.getElementById('btn-music');
    if (b) b.addEventListener('click', () => (panel && !panel.hidden ? close() : open()));
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.LHMusic = { open, close, next, prev, on: () => st.on, setOn, tracks: TRACKS };
})();
