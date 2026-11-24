/* lh-build 202611241535 */
/* Lanternhold — browser front end. */
(function () {
  'use strict';
  const L = window.LH, SP = window.LHSprites;
  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'lanternhold.save.v1';
  const OFFLINE_CAP = 12 * 3600;

  // ---------- state ----------
  let S = load() || L.newState();
  const events = [];

  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (raw) return L.migrate(JSON.parse(raw)); } catch (e) {}
    return null;
  }
  // ---------- one tab at a time ----------
  // Two open copies of the game each kept saving their own state over the other, so a claim, a setting or a tonic
  // made in one tab came undone on refresh (John, 2026-11-24). The newest tab plays; older tabs stop saving and say so.
  let dormant = false;
  const TAB_ID = Math.random().toString(36).slice(2);
  let tabChan = null;
  try { tabChan = new BroadcastChannel('lanternhold-tabs'); } catch (e) {}
  function goDormant() {
    if (dormant) return; save(); dormant = true;
    const d = document.createElement('div'); d.id = 'tablock';
    d.innerHTML = '<div><h2>Lanternhold is open in another tab</h2><p>Only one tab can play at a time, so your progress never gets mixed up. This tab has stopped and saved.</p><button class="btn" id="tablock-go">Play here instead</button></div>';
    document.body.appendChild(d);
    d.querySelector('#tablock-go').onclick = () => location.reload();
  }
  if (tabChan) {
    tabChan.onmessage = e => { if (e.data && e.data.t === 'hello' && e.data.id !== TAB_ID) goDormant(); };
    tabChan.postMessage({ t: 'hello', id: TAB_ID });
  }
  window.addEventListener('storage', e => { if (e.key === 'lh_tab' && e.newValue && e.newValue.split(':')[0] !== TAB_ID) goDormant(); });
  try { localStorage.setItem('lh_tab', TAB_ID + ':' + Date.now()); } catch (e) {}
  function save() {
    if (dormant) return;
    S.lastSeen = Date.now();
    const o = Object.assign({}, S); delete o.foe; delete o.enchAt; delete o.shopK;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch (e) {}
  }

  // ---------- formatting ----------
  // Plain numbers with commas. Past a million, short letters: 2.40M, 13.1B, 250T (John, 2026-11-23: never 1.00e6).
  const BIG = ['', '', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + fmt(-n);
    if (n < 1e6) return n < 10 && n % 1 > 0.05 ? n.toFixed(1) : Math.floor(n).toLocaleString('en-US');
    const e = Math.min(BIG.length - 1, Math.floor(Math.log10(n) / 3)), v = n / Math.pow(1000, e);
    return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v).toLocaleString('en-US')) + BIG[e];
  }
  function fmtTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    return s + 's';
  }
  const coin = '<svg viewBox="0 0 24 24"><use href="#i-coin"/></svg>';
  const icon = id => '<svg viewBox="0 0 24 24"><use href="#i-' + id + '"/></svg>';

  // ---------- sound ----------
  let AC = null;
  function audio() {
    if (!S.settings.sound) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, dur, type, vol, slide) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  let lastHitSound = 0, lastThud = 0;
  const sfx = {
    hit(crit) { const n = performance.now(); if (n - lastHitSound < 45) return; lastHitSound = n; tone(crit ? 220 : 150 + Math.random() * 40, 0.07, 'square', crit ? 0.05 : 0.03, 60); },
    coin() { tone(988, 0.06, 'square', 0.025); setTimeout(() => tone(1318, 0.09, 'square', 0.025), 55); },
    boss() { tone(110, 0.5, 'sawtooth', 0.05, 55); },
    relic() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.05), i * 90)); },
    fail() { tone(196, 0.3, 'triangle', 0.05, 98); },
    buy() { tone(660, 0.05, 'square', 0.02, 880); },
    thud() { const n = performance.now(); if (n - lastThud < 120) return; lastThud = n; tone(90, 0.08, 'triangle', 0.035, 50); },
  };


  // ---------- tooltips ----------
  // One styled tooltip for the whole game. Anything with data-tip (or an old-style title, which gets converted)
  // shows it on hover with a mouse, or on a tap of a small (i) badge on touch screens. It stays inside the window.
  const tipEl = document.getElementById('tip');
  let tipFor = null, tipHide = 0;
  function tipText(el) {
    if (el.hasAttribute('title')) { const t = el.getAttribute('title'); el.removeAttribute('title'); if (t) el.dataset.tip = t; }
    return el.dataset.tip || '';
  }
  function showTip(el) {
    const t = tipText(el); if (!t || !tipEl) return;
    tipFor = el; tipEl.textContent = t; tipEl.hidden = false; tipEl.classList.remove('up');
    const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = document.documentElement.clientWidth;
    let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(vw - w - 8, x));
    let y = r.bottom + 8; if (y + h > innerHeight - 8) { y = r.top - h - 8; tipEl.classList.add('up'); }
    tipEl.style.left = Math.round(x) + 'px'; tipEl.style.top = Math.round(y) + 'px';
    tipEl.style.setProperty('--ax', Math.round(r.left + r.width / 2 - x) + 'px');
  }
  function hideTip() { tipFor = null; if (tipEl) tipEl.hidden = true; }
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  document.addEventListener('pointerover', e => {
    if (!fine.matches) return;
    const el = e.target.closest('[data-tip],[title]');
    if (el === tipFor) return;
    if (!el || el.closest('#tip')) { hideTip(); return; }
    clearTimeout(tipHide); showTip(el);
  });
  document.addEventListener('pointerout', e => { if (tipFor && !tipFor.contains(e.relatedTarget)) { clearTimeout(tipHide); tipHide = setTimeout(hideTip, 60); } });
  document.addEventListener('click', e => {
    const i = e.target.closest('.tipi,.klant') || (!fine.matches && e.target.closest('.trait[data-tip],.cxp[data-tip],#foetag[data-tip]'));
    if (i) { e.preventDefault(); e.stopPropagation(); if (tipFor === i) hideTip(); else { showTip(i); clearTimeout(tipHide); tipHide = setTimeout(hideTip, 5000); } return; }
    if (!fine.matches) hideTip();
  }, true);
  addEventListener('scroll', hideTip, true);
  const tipI = t => '<i class="tipi" data-tip="' + esc(t) + '">i</i>';
  // ---------- arena rendering ----------
  const arena = $('arena'), cv = $('cv'), ctx = cv.getContext('2d');
  let W = 240, H = 150, bgCanvas = null, bgKey = '';
  const spriteCache = {};
  // When the illustrated sprites finish loading, drop the pixel fallbacks.
  window.addEventListener('lhsprites', () => { for (const k in spriteCache) delete spriteCache[k]; try { updatePanel(true); updateSeats && updateSeats(true); } catch (e) {} });
  const particles = [];
  const slashes = [];
  let foeAnim = { key: null, born: 0, flash: 0, shake: 0, dying: null };

  // The arena keeps a 240-wide logical space, drawn at the screen's real resolution (R) so the art stays sharp.
  let R = 3;
  function resize() {
    const r = arena.getBoundingClientRect();
    W = 240; H = Math.round(240 * r.height / Math.max(1, r.width));
    R = Math.max(2, Math.min(6, Math.round(r.width * (window.devicePixelRatio || 1) / 240 * 2) / 2));
    cv.width = Math.round(W * R); cv.height = Math.round(H * R); bgKey = ''; campKey = '';
  }
  function hiCanvas() { const c = document.createElement('canvas'); c.width = Math.round(W * R); c.height = Math.round(H * R); const x = c.getContext('2d'); x.scale(R, R); return [c, x]; }

  function rngFrom(seed) { let x = seed * 9301 + 49297; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }

  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',') + ')'; }

  function rrect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  function buildBackground(b, seed) {
    const [c, x] = hiCanvas(), r = rngFrom(seed);
    const floorY = Math.round(H * 0.7);
    const wallA = b.bg[0], wallB = b.bg[1];
    // wall: a deep gradient, then stone blocks with their own light and mortar shadow
    const wg = x.createLinearGradient(0, 0, 0, floorY);
    wg.addColorStop(0, mix(wallB, '#000000', 0.35)); wg.addColorStop(0.6, wallB); wg.addColorStop(1, mix(wallB, wallA, 0.25));
    x.fillStyle = wg; x.fillRect(0, 0, W, floorY);
    for (let row = 0; row * 9 < floorY; row++) {
      const off = row % 2 ? 9 : 0;
      for (let col = -1; col * 18 < W; col++) {
        const bx = col * 18 + off + (r() - 0.5) * 0.6, by = row * 9, t = 0.28 + r() * 0.3 - (by / floorY) * 0.12;
        const g = x.createLinearGradient(bx, by, bx + 4, by + 9);
        g.addColorStop(0, mix(wallB, wallA, t + 0.5)); g.addColorStop(1, mix(wallB, wallA, t + 0.15));
        x.fillStyle = 'rgba(0,0,0,0.55)'; rrect(x, bx + 0.9, by + 1.3, 16.6, 7.6, 1.6); x.fill();
        x.fillStyle = g; rrect(x, bx + 0.7, by + 0.7, 16.4, 7.4, 1.6); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(bx + 1.6, by + 1.1, 14.6, 0.6);
        if (r() < 0.18) { x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.4; x.beginPath(); const cx = bx + 3 + r() * 10; x.moveTo(cx, by + 1.5); x.lineTo(cx + 1.5, by + 4); x.lineTo(cx + 0.5, by + 7); x.stroke(); }
        if (r() < 0.1) { x.fillStyle = mix(b.accent, wallB, 0.35); x.globalAlpha = 0.55; x.beginPath(); x.ellipse(bx + 4 + r() * 9, by + 7, 2 + r() * 3, 1, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; }
      }
    }
    // hanging roots, drips and glints in the biome colour
    for (let i = 0; i < 14; i++) { const px = r() * W, len = 4 + r() * 14; x.strokeStyle = mix(b.accent, '#000000', 0.45); x.globalAlpha = 0.6; x.lineWidth = 0.6; x.beginPath(); x.moveTo(px, 0); x.quadraticCurveTo(px + (r() - 0.5) * 6, len / 2, px + (r() - 0.5) * 4, len); x.stroke(); x.globalAlpha = 1; }
    for (let i = 0; i < 40; i++) { x.fillStyle = mix(b.accent, '#ffffff', 0.3); x.globalAlpha = 0.15 + r() * 0.35; x.beginPath(); x.arc(r() * W, r() * floorY, 0.3 + r() * 0.5, 0, Math.PI * 2); x.fill(); }
    x.globalAlpha = 1;
    // doorway arch of fitted stones, opening onto the dark of the stair
    const ax = Math.round(W * FOE_X), aw = 56, ah = Math.round(floorY * 0.8), top = floorY - ah + aw / 2;
    const vg = x.createRadialGradient(ax, top + 10, 2, ax, top + 10, ah);
    vg.addColorStop(0, mix(b.accent, '#000000', 0.55)); vg.addColorStop(0.45, '#07080d'); vg.addColorStop(1, '#020305');
    x.fillStyle = vg; x.beginPath(); x.moveTo(ax - aw / 2, floorY); x.lineTo(ax - aw / 2, top); x.arc(ax, top, aw / 2, Math.PI, 0); x.lineTo(ax + aw / 2, floorY); x.fill();
    for (let i = 0; i < 6; i++) { const sw = aw - 12 - i * 6, sy = floorY - 4 - i * 6.5; x.fillStyle = mix('#05060a', wallA, 0.18 + i * 0.05); rrect(x, ax - sw / 2, sy, sw, 2.6, 0.8); x.fill(); x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(ax - sw / 2, sy, sw, 0.5); }
    const stones = 13;
    for (let i = 0; i <= stones; i++) {
      const a0 = Math.PI + (i / stones) * Math.PI, a1 = Math.PI + ((i + 1) / stones) * Math.PI; if (i === stones) break;
      const g = x.createLinearGradient(ax, top - aw / 2 - 6, ax, top + 8); g.addColorStop(0, mix(wallA, '#ffffff', 0.22)); g.addColorStop(1, mix(wallB, wallA, 0.45));
      x.fillStyle = g; x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 0.7;
      x.beginPath(); x.arc(ax, top, aw / 2 + 6, a0 + 0.01, a1 - 0.01); x.arc(ax, top, aw / 2, a1 - 0.01, a0 + 0.01, true); x.closePath(); x.fill(); x.stroke();
    }
    [-1, 1].forEach(sd => { for (let j = 0; j < Math.ceil((floorY - top) / 9); j++) { const yy = top + j * 9, g = x.createLinearGradient(0, yy, 0, yy + 9); g.addColorStop(0, mix(wallA, '#ffffff', 0.16)); g.addColorStop(1, mix(wallB, wallA, 0.4)); x.fillStyle = g; x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 0.7; const sx = sd < 0 ? ax - aw / 2 - 6 : ax + aw / 2; rrect(x, sx, yy + 0.4, 6, Math.min(8.6, floorY - yy - 0.4), 1); x.fill(); x.stroke(); } });
    // floor: flagstones in perspective, lighter where the light falls
    const fg = x.createLinearGradient(0, floorY, 0, H); fg.addColorStop(0, mix(wallB, wallA, 0.5)); fg.addColorStop(1, mix(wallB, '#000000', 0.55));
    x.fillStyle = fg; x.fillRect(0, floorY, W, H - floorY);
    for (let row = 0; floorY + row * 7 < H; row++) {
      const y = floorY + row * 7, w = 22 + row * 7, off = (row % 2) * w / 2;
      for (let col = -1; col * w < W + w; col++) {
        const t = 0.4 + r() * 0.22 - row * 0.03, X = col * w + off;
        x.fillStyle = 'rgba(0,0,0,0.5)'; rrect(x, X + 0.8, y + 1, w - 1.2, 6.2, 1.2); x.fill();
        const g = x.createLinearGradient(0, y, 0, y + 7); g.addColorStop(0, mix(wallB, wallA, t + 0.12)); g.addColorStop(1, mix(wallB, wallA, t - 0.08));
        x.fillStyle = g; rrect(x, X + 0.6, y + 0.6, w - 1.2, 5.8, 1.2); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(X + 1.4, y + 0.9, w - 2.8, 0.5);
      }
    }
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, floorY - 0.5, W, 1.5);
    // iron sconces
    [W * 0.17, W * 0.83].forEach(tx => {
      const ty = floorY * 0.42;
      x.fillStyle = '#1a1410'; rrect(x, tx - 3.5, ty - 1, 7, 3, 1); x.fill();
      const g = x.createLinearGradient(tx - 2, 0, tx + 2, 0); g.addColorStop(0, '#6a4a2a'); g.addColorStop(1, '#2a1a10');
      x.fillStyle = g; x.beginPath(); x.moveTo(tx - 1.6, ty + 1); x.lineTo(tx + 1.6, ty + 1); x.lineTo(tx + 1, ty + 12); x.lineTo(tx - 1, ty + 12); x.fill();
      x.fillStyle = '#8a8070'; x.beginPath(); x.moveTo(tx - 4, ty - 1); x.lineTo(tx + 4, ty - 1); x.lineTo(tx + 2.6, ty + 2); x.lineTo(tx - 2.6, ty + 2); x.fill();
      x.fillStyle = '#3a3026'; x.beginPath(); x.arc(tx, ty + 12, 1.6, 0, Math.PI * 2); x.fill();
    });
    // vignette
    const g = x.createRadialGradient(W / 2, H * 0.55, H * 0.2, W / 2, H * 0.55, W * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.8)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    return c;
  }
  // A torch flame drawn with soft gradients; fl is the flicker.
  function flame(x, fx, fy, h, fl) {
    const w = h * 0.42;
    const g = x.createLinearGradient(0, fy - h, 0, fy); g.addColorStop(0, 'rgba(255,90,30,0)'); g.addColorStop(0.35, '#ff6a1f'); g.addColorStop(1, '#ffb347');
    x.fillStyle = g; x.beginPath(); x.moveTo(fx, fy - h); x.bezierCurveTo(fx + w * (1.1 + fl * 0.1), fy - h * 0.5, fx + w, fy, fx, fy); x.bezierCurveTo(fx - w, fy, fx - w * (1.1 - fl * 0.1), fy - h * 0.5, fx, fy - h); x.fill();
    const g2 = x.createLinearGradient(0, fy - h * 0.6, 0, fy); g2.addColorStop(0, 'rgba(255,240,180,0)'); g2.addColorStop(1, '#fff3c0');
    x.fillStyle = g2; x.beginPath(); x.moveTo(fx, fy - h * 0.6); x.bezierCurveTo(fx + w * 0.55, fy - h * 0.3, fx + w * 0.5, fy, fx, fy); x.bezierCurveTo(fx - w * 0.5, fy, fx - w * 0.55, fy - h * 0.3, fx, fy - h * 0.6); x.fill();
  }

  function sprite(name, hue, flash) {
    const k = name + '|' + hue + '|' + (flash ? 1 : 0);
    if (!spriteCache[k]) {
      const Q = 8;
      let c = SP.render(name, Q, hue);
      const lw = c.width / Q, lh = c.height / Q;
      if (flash) { const f = document.createElement('canvas'); f.width = c.width; f.height = c.height; const fx = f.getContext('2d'); fx.drawImage(c, 0, 0); fx.globalCompositeOperation = 'source-atop'; fx.fillStyle = 'rgba(255,246,224,0.78)'; fx.fillRect(0, 0, f.width, f.height); c = f; }
      c.lw = lw; c.lh = lh;
      spriteCache[k] = c;
    }
    return spriteCache[k];
  }

  function burst(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * (speed || 40);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 25, life: 0.6 + Math.random() * 0.5, age: 0, c: colors[i % colors.length], s: Math.random() < 0.3 ? 2 : 1 });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  let tAnim = 0, lastFrame = performance.now(), slashTimer = 0;
  // ---------- party in the arena ----------
  const FOE_X = 0.72;
  const CLASS_ICON = { tank: 'shield', healer: 'cross', rogue: 'dagger', mage: 'flare', necro: 'skull' };
  const memberAnim = {}, minionSwing = [], leavers = [];
  // a companion sent back to camp walks off toward the stair and fades
  function leaveArena(id) { const a = memberAnim[id], m = L.memberById(id); if (a && m) leavers.push({ cls: m.cls, hue: lookHue(m), x: a.x - 12, y: a.y - 8, t: tAnim }); }
  const mAnim = id => (memberAnim[id] = memberAnim[id] || { hit: 0, lunge: 0, x: 0, y: 0 });
  const FRONT = { tank: 0, rogue: 1, mage: 2, necro: 3, healer: 4 };
  // who a marked-position special will land on (the same spot in the line the core picked)
  function spTarget() { const w = S.foe && S.foe.spWind; if (!w || w.pos < 0) return null; const live = S.party.filter(id => id && !S.down[id]); return live[Math.min(w.pos, live.length - 1)] || null; }
  // the wind-up warning across the top of the arena
  function spWarn(text, cls) {
    let el = $('spwarn'); if (!el) { el = document.createElement('div'); el.id = 'spwarn'; arena.appendChild(el); }
    el.className = 'spwarn ' + (cls || ''); el.innerHTML = text; el.hidden = false;
    clearTimeout(spWarn.t); spWarn.t = setTimeout(() => { el.hidden = true; }, (L.SPECIAL_WARN || 1.5) * 1000 + 700);
  }
  function partyLayout(fx, fyy) {
    const floorY = fyy || Math.round(H * 0.7);
    const seated = S.party.filter(Boolean);
    const order = seated; // marching order: first seat stands nearest the foe
    const front = (fx || Math.round(W * FOE_X)) - 58;
    return order.map((id, i) => ({ id, x: front - i * 21, y: floorY - 30 + (i % 2 ? -5 : 1) }));
  }

  function drawParty(now) {
    const lay = partyLayout();
    const floorY = Math.round(H * 0.7);
    // skeleton minions stand between the party and the foe
    // each skeleton winds back, lunges and rakes the foe with a ghostly claw
    S.minions.forEach((m, i) => {
      const spr = sprite('minion', 0, false), bx = Math.round(W * FOE_X) - 34 - i * 7, by = floorY - 16 + (i % 2) * 3;
      const rate = 1.1 + (i % 3) * 0.17, ph = (tAnim * rate + i * 0.29) % 1;
      const wind = ph > 0.78 ? (ph - 0.78) / 0.22 : 0, strike = ph < 0.16 ? 1 - ph / 0.16 : 0;
      const dx = Math.round(strike * 6 - wind * 2), dy = -Math.round(strike * 2);
      const w2 = spr.lw * 2, h2 = spr.lh * 2, cx = bx + dx + w2 / 2, cy = by + dy + h2;
      ctx.save(); ctx.globalAlpha = 0.92; ctx.translate(cx, cy); ctx.rotate(strike * 0.22 - wind * 0.12);
      ctx.drawImage(spr, -w2 / 2, -h2, w2, h2); ctx.restore();
      const key = Math.floor(tAnim * rate + i * 0.29);
      if (S.foe && foeAnim.cx && minionSwing[i] !== key && ph < 0.05) {
        minionSwing[i] = key;
        slashes.push({ x: foeAnim.cx - foeAnim.w * 0.25 + Math.random() * foeAnim.w * 0.2, y: foeAnim.cy + (Math.random() - 0.3) * foeAnim.h * 0.4, a: -0.6 + Math.random() * 0.4, t: tAnim, c: '#7affc8', big: false });
        burst(cx + 6, cy - h2 / 2, 2, ['#d8cfb8', '#7affc8'], 14);
      }
    });
    for (let i = leavers.length - 1; i >= 0; i--) {
      const o = leavers[i], k = (tAnim - o.t) / 1.4;
      if (k >= 1) { leavers.splice(i, 1); continue; }
      const spr = sprite(o.cls, o.hue, false);
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(Math.round(o.x - k * 90) + spr.lw * 2, Math.round(o.y + Math.abs(Math.sin(k * 18)) * -2)); ctx.scale(-1, 1);
      ctx.drawImage(spr, 0, 0, spr.lw * 2, spr.lh * 2); ctx.restore();
    }
    // the party's war banner, planted behind the rear of the march (Wardrobe)
    const mb = myBanner(), bi = mb && lay.length && banImg(mb);
    if (bi) { const r = lay[lay.length - 1], sw = Math.sin(tAnim * 1.3) * 0.6; ctx.fillStyle = '#4a3220'; ctx.fillRect(Math.round(r.x - 7), Math.round(r.y - 14), 1.6, 47); ctx.drawImage(bi, Math.round(r.x - 18 + sw), Math.round(r.y - 16), 20, 30); }
    for (const p of lay) {
      const m = L.memberById(p.id), a = mAnim(p.id), down = !!S.down[p.id];
      const flash = tAnim < a.hit;
      const spr = sprite(m.cls, lookHue(m), flash);
      const lunge = tAnim < a.lunge ? 3 : 0;
      const bob = down ? 0 : Math.sin(tAnim * 3 + p.x) * 0.7;
      const x = p.x + lunge, y = p.y + bob + (down ? 6 : 0);
      a.x = x + 12; a.y = y + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(p.x + 12, p.y + 32, 9, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = down ? 0.35 : 1;
      ctx.drawImage(spr, x, y, spr.lw * 2, spr.lh * 2);
      ctx.globalAlpha = 1;
      // shield wall
      if (m.cls === 'tank' && L.abilityActive(S, p.id, now)) { const a2 = 0.45 + 0.25 * Math.sin(tAnim * 8), bx = x + spr.lw, by = y + spr.lh * 0.95, bg = ctx.createRadialGradient(bx, by, 4, bx, by, 22); bg.addColorStop(0, 'rgba(159,214,236,0)'); bg.addColorStop(0.8, 'rgba(159,214,236,' + a2 * 0.25 + ')'); bg.addColorStop(1, 'rgba(200,240,255,' + a2 + ')'); ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(bx, by, 17, 21, 0, 0, Math.PI * 2); ctx.fill(); }
      // health bar
      const hp = Math.max(0, S.hp[p.id] || 0) / L.maxHpOf(S, p.id);
      ctx.fillStyle = 'rgba(4,7,13,0.85)'; rrect(ctx, p.x + 2, p.y + 34.6, 20, 2.8, 1.4); ctx.fill();
      ctx.fillStyle = down ? '#555' : hp > 0.5 ? '#8fcf6a' : hp > 0.25 ? '#e9c34a' : '#e8604a';
      if (hp > 0) { rrect(ctx, p.x + 2.5, p.y + 35.1, Math.max(1.8, 19 * hp), 1.8, 0.9); ctx.fill(); }
      // mana (blue) or stamina (gold) just under the health bar; an out-of-mana healer's bar blinks
      const rk = L.resKind(p.id);
      if (rk && !down) {
        const rv = L.resOf(S, p.id) / L.RES_MAX, dry = L.oom(S, p.id);
        ctx.fillStyle = 'rgba(4,7,13,0.85)'; rrect(ctx, p.x + 2, p.y + 37.8, 20, 2.2, 1.1); ctx.fill();
        ctx.fillStyle = rk === 'mana' ? (dry ? 'rgba(122,170,255,' + (0.35 + 0.35 * Math.sin(tAnim * 9)) + ')' : '#5aa8ff') : '#e9b84a';
        if (rv > 0) { rrect(ctx, p.x + 2.4, p.y + 38.2, Math.max(1.4, 19.2 * rv), 1.4, 0.7); ctx.fill(); }
      }
      if (p.id === 'you') { ctx.fillStyle = '#f5c242'; ctx.beginPath(); ctx.moveTo(p.x + 10, p.y - 5.5); ctx.lineTo(p.x + 14, p.y - 5.5); ctx.lineTo(p.x + 12, p.y - 3); ctx.fill(); }
      // a special attack winding up: a red ring under whoever it will land on
      const wd = S.foe && S.foe.spWind, spd = wd && L.SPECIALS[S.foe.sp];
      if (spd && !down && (spd.kind === 'all' || (spd.kind === 'pos' && spTarget() === p.id))) {
        const k = 0.5 + 0.5 * Math.sin(tAnim * 14);
        ctx.strokeStyle = 'rgba(255,70,60,' + (0.55 + 0.4 * k) + ')'; ctx.lineWidth = spd.kind === 'pos' ? 1.4 : 0.9;
        ctx.beginPath(); ctx.ellipse(p.x + 12, p.y + 32, 11 + k * 2, 3 + k * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
        if (spd.kind === 'pos') { ctx.fillStyle = 'rgba(255,80,70,' + (0.7 + 0.3 * k) + ')'; ctx.beginPath(); ctx.moveTo(p.x + 9, p.y - 17); ctx.lineTo(p.x + 15, p.y - 17); ctx.lineTo(p.x + 12, p.y - 13); ctx.fill(); }
      }
      // stunned: little stars circle the head; disarmed: a broken-blade badge
      const ccx = !down && L.ccOf(S, p.id);
      if (ccx) {
        const hx = p.x + 12, hy = p.y - (p.id === 'you' ? 12 : 8);
        if (ccx.k === 'stun') { for (let k = 0; k < 3; k++) { const an = tAnim * 5 + k * 2.1; ctx.fillStyle = k % 2 ? '#ffe27a' : '#fff6c9'; ctx.beginPath(); ctx.arc(hx + Math.cos(an) * 7, hy + Math.sin(an) * 2, 1.3, 0, Math.PI * 2); ctx.fill(); } }
        else { ctx.fillStyle = 'rgba(4,7,13,0.85)'; ctx.beginPath(); ctx.arc(hx - 8, hy, 3.8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#ff8a6a'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.beginPath(); ctx.moveTo(hx - 10, hy + 2); ctx.lineTo(hx - 6, hy - 2); ctx.moveTo(hx - 10, hy - 2); ctx.lineTo(hx - 6, hy + 2); ctx.stroke(); }
      }
      // burns and poisons: a small badge with the fights left
      const dt2 = S.dots && S.dots[p.id];
      if (dt2 && !down) {
        const bx = p.x + 12, by = p.y - (p.id === "you" ? 10 : 6), col = dt2.k === 'burn' ? '#ff7a3d' : '#8fd16a';
        ctx.fillStyle = 'rgba(4,7,13,0.85)'; ctx.beginPath(); ctx.arc(bx, by, 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 0.7; ctx.stroke();
        ctx.fillStyle = col; ctx.font = '700 5px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(dt2.n), bx, by + 0.3);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        if (Math.random() < 0.06) burst(p.x + 12, p.y + 12, 1, dt2.k === 'burn' ? ['#ff7a3d', '#ffd26a'] : ['#8fd16a', '#c9f0a0'], 10);
      }
    }
    // the party's lantern hangs beside the lead hero, in the style chosen in the Wardrobe
    if (lay.length) {
      const p0 = lay[0], ls = sprite('lantern', '0~' + lanternOf(), false), sway = Math.sin(tAnim * 1.7) * 1.2;
      ctx.drawImage(ls, Math.round(p0.x + 21 + sway), Math.round(p0.y - 3 + Math.sin(tAnim * 2.3) * 0.8), ls.lw * 2.4, ls.lh * 2.4);
    }
    return lay;
  }

  // ---------- camp: the party rests around a campfire at the top of the stair ----------
  let campBg = null, campKey = '';
  function buildCamp() {
    const [c, x] = hiCanvas(), r = rngFrom(7), floorY = Math.round(H * 0.7);
    const sky = x.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, '#04070d'); sky.addColorStop(0.55, '#0e1730'); sky.addColorStop(0.85, '#2a2140'); sky.addColorStop(1, '#3a2434');
    x.fillStyle = sky; x.fillRect(0, 0, W, floorY);
    // a faint band of stars, then scattered stars with a soft glow
    const band = x.createLinearGradient(0, 0, W, floorY * 0.6); band.addColorStop(0, 'rgba(120,140,220,0)'); band.addColorStop(0.5, 'rgba(150,160,230,0.12)'); band.addColorStop(1, 'rgba(120,140,220,0)');
    x.fillStyle = band; x.fillRect(0, 0, W, floorY * 0.7);
    for (let i = 0; i < 140; i++) { const sx = r() * W, sy = r() * floorY * 0.72, a = 0.25 + r() * 0.7, rad = r() < 0.08 ? 0.75 : 0.35; x.fillStyle = 'rgba(235,238,255,' + a + ')'; x.beginPath(); x.arc(sx, sy, rad, 0, Math.PI * 2); x.fill(); if (rad > 0.5) { x.fillStyle = 'rgba(200,210,255,0.15)'; x.beginPath(); x.arc(sx, sy, 2, 0, Math.PI * 2); x.fill(); } }
    // moon with halo and craters
    const mx = W * 0.82, my = H * 0.16, halo = x.createRadialGradient(mx, my, 6, mx, my, 34); halo.addColorStop(0, 'rgba(240,235,210,0.3)'); halo.addColorStop(1, 'rgba(240,235,210,0)');
    x.fillStyle = halo; x.fillRect(mx - 40, my - 40, 80, 80);
    const mg = x.createRadialGradient(mx - 3, my - 3, 1, mx, my, 9); mg.addColorStop(0, '#fffbea'); mg.addColorStop(1, '#cfc6aa');
    x.fillStyle = mg; x.beginPath(); x.arc(mx, my, 9, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(150,140,110,0.35)'; [[2, -2, 2], [-3, 2, 1.5], [3, 4, 1.1]].forEach(([dx, dy, rr]) => { x.beginPath(); x.arc(mx + dx, my + dy, rr, 0, Math.PI * 2); x.fill(); });
    // far mountains, then hills, each layer a little lighter with distance haze
    const ridge = (base, amp, f1, f2, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(0, floorY); for (let i = 0; i <= W; i += 2) x.lineTo(i, base - amp * (0.6 + 0.4 * Math.sin(i * f1)) - amp * 0.5 * Math.sin(i * f2 + 1)); x.lineTo(W, floorY); x.fill(); };
    ridge(floorY - 24, 18, 0.023, 0.061, '#1c1a2e'); ridge(floorY - 14, 10, 0.031, 0.09, '#15131f');
    // the ruined Hold on the ridge, a lit window
    const hx = W * 0.14, hy = floorY - 14;
    x.fillStyle = '#0d0c14'; x.fillRect(hx, hy - 52, 22, 52); x.fillRect(hx - 3, hy - 56, 28, 5);
    for (let i = 0; i < 4; i++) x.fillRect(hx - 3 + i * 8, hy - 60, 4, 4);
    x.beginPath(); x.moveTo(hx + 22, hy - 30); x.lineTo(hx + 58, hy - 22); x.lineTo(hx + 62, hy); x.lineTo(hx + 22, hy); x.fill();
    const wl = x.createRadialGradient(hx + 10.5, hy - 40, 0, hx + 10.5, hy - 40, 8); wl.addColorStop(0, 'rgba(255,190,90,0.7)'); wl.addColorStop(1, 'rgba(255,190,90,0)');
    x.fillStyle = wl; x.fillRect(hx, hy - 50, 22, 22); x.fillStyle = '#ffcf7a'; x.fillRect(hx + 9, hy - 43, 3, 5);
    // pines in two rows
    const pine = (px, base, ph, col) => { x.fillStyle = col; for (let t = 0; t < 4; t++) { const w = ph * (0.22 + t * 0.1), y0 = base - ph + t * ph * 0.22; x.beginPath(); x.moveTo(px, y0); x.lineTo(px + w, y0 + ph * 0.34); x.lineTo(px - w, y0 + ph * 0.34); x.fill(); } x.fillRect(px - 0.8, base - 3, 1.6, 4); };
    for (let i = 0; i < 9; i++) pine(W * (0.3 + i * 0.085) + r() * 12, floorY - 12, 22 + r() * 14, '#0f1416');
    for (let i = 0; i < 6; i++) pine(W * (0.04 + i * 0.19) + r() * 10, floorY - 6, 30 + r() * 12, '#090c0e');
    // ground with grass and stones
    const g = x.createLinearGradient(0, floorY - 12, 0, H); g.addColorStop(0, '#22201a'); g.addColorStop(1, '#0b0a08');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, floorY - 8); for (let i = 0; i <= W; i += 6) x.lineTo(i, floorY - 9 + Math.sin(i * 0.08) * 1.6); x.lineTo(W, H); x.lineTo(0, H); x.fill();
    for (let i = 0; i < 70; i++) { const gx = r() * W, gy = floorY - 8 + r() * (H - floorY + 6); x.strokeStyle = r() < 0.5 ? '#3a4a24' : '#2a3418'; x.lineWidth = 0.5; x.beginPath(); x.moveTo(gx, gy); x.quadraticCurveTo(gx - 0.5, gy - 2, gx - 1.5, gy - 3.2); x.moveTo(gx + 1, gy); x.quadraticCurveTo(gx + 1.4, gy - 2, gx + 2.4, gy - 3); x.stroke(); }
    for (let i = 0; i < 18; i++) { const sx = r() * W, sy = floorY - 2 + r() * (H - floorY), rr = 0.8 + r() * 1.6; const sg = x.createLinearGradient(sx, sy - rr, sx, sy + rr); sg.addColorStop(0, '#4a4640'); sg.addColorStop(1, '#1e1c18'); x.fillStyle = sg; x.beginPath(); x.ellipse(sx, sy, rr * 1.4, rr, 0, 0, Math.PI * 2); x.fill(); }
    // the stair back down, a dark mouth in the rock
    const sx = W * 0.9; x.fillStyle = '#26221c'; x.beginPath(); x.moveTo(sx - 22, floorY + 4); x.quadraticCurveTo(sx - 20, floorY - 32, sx, floorY - 34); x.quadraticCurveTo(sx + 20, floorY - 32, sx + 22, floorY + 4); x.fill();
    const mouth = x.createRadialGradient(sx, floorY - 6, 1, sx, floorY - 6, 18); mouth.addColorStop(0, '#000000'); mouth.addColorStop(1, '#0c0a08');
    x.fillStyle = mouth; x.beginPath(); x.moveTo(sx - 13, floorY + 4); x.quadraticCurveTo(sx - 12, floorY - 24, sx, floorY - 25); x.quadraticCurveTo(sx + 12, floorY - 24, sx + 13, floorY + 4); x.fill();
    x.fillStyle = '#3a342a'; for (let i = 0; i < 4; i++) { rrect(x, sx - 10 + i, floorY - 1 - i * 4, 20 - i * 2, 1.8, 0.6); x.fill(); }
    return c;
  }
  // seats around the fire: dx, dy from the fire, and whether the sitter faces left
  const CAMP_SEATS = [[-46, 4, 0], [46, 4, 1], [-30, -12, 0], [30, -12, 1], [-62, -6, 0], [62, -6, 1], [-12, -20, 0], [14, -20, 1]];
  function drawCamp(now) {
    if (campKey !== W + 'x' + H) { campBg = buildCamp(); campKey = W + 'x' + H; }
    ctx.imageSmoothingEnabled = true; ctx.drawImage(campBg, 0, 0, W, H);
    const floorY = Math.round(H * 0.7), fx = Math.round(W * 0.5), fy = floorY + 10;
    const fl = Math.sin(tAnim * 9) + Math.sin(tAnim * 13.7) * 0.6;
    const glow = ctx.createRadialGradient(fx, fy - 6, 2, fx, fy - 6, 120 + fl * 4);
    glow.addColorStop(0, 'rgba(255,160,70,0.42)'); glow.addColorStop(0.5, 'rgba(255,120,50,0.12)'); glow.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
    // who sits by the fire: the party first, then companions resting at camp
    const who = S.party.filter(Boolean).concat(S.unlocked.filter(id => !S.party.includes(id))).slice(0, CAMP_SEATS.length);
    const seats = who.map((id, i) => ({ id, x: fx + CAMP_SEATS[i][0], y: fy + CAMP_SEATS[i][1], flip: CAMP_SEATS[i][2] }));
    const sitter = p => {
      const m = L.memberById(p.id); if (!m) return;
      const spr = sprite(m.cls, lookHue(m), false), w2 = spr.lw * 2, h2 = spr.lh * 2;
      const breathe = Math.round(Math.sin(tAnim * 1.6 + p.x) * 0.5);
      const bx = p.x - w2 / 2, by = p.y - h2 + 6 + breathe;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 5, 11, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      // sitting: the lower legs are hidden behind a log seat
      ctx.save(); ctx.beginPath(); ctx.rect(bx - 2, by - 2, w2 + 4, h2 - 6); ctx.clip();
      if (p.flip) { ctx.translate(bx + w2, by); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0, w2, h2); } else ctx.drawImage(spr, bx, by, w2, h2);
      ctx.restore();
      { const lg = ctx.createLinearGradient(0, p.y - 2, 0, p.y + 3); lg.addColorStop(0, '#6a4424'); lg.addColorStop(1, '#2a1a0e'); ctx.fillStyle = lg; rrect(ctx, p.x - 12, p.y - 2, 24, 5, 2.4); ctx.fill(); ctx.fillStyle = '#8a6a4a'; ctx.beginPath(); ctx.ellipse(p.x + 11.5, p.y + 0.5, 1.4, 2.4, 0, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#2a1a0e'; ctx.fillRect(p.x - 11, p.y + 2, 22, 1);
      if (p.id === 'you') { ctx.fillStyle = '#f5c242'; ctx.beginPath(); ctx.moveTo(p.x - 2, by - 5.5); ctx.lineTo(p.x + 2, by - 5.5); ctx.lineTo(p.x, by - 3); ctx.fill(); }
    };
    seats.filter(p => p.y < fy).sort((a, b) => a.y - b.y).forEach(sitter);
    // the fire: a ring of stones, crossed logs and layered flames
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, sx = fx + Math.cos(a) * 13, sy = fy + Math.sin(a) * 4; const sg = ctx.createLinearGradient(sx, sy - 2, sx, sy + 2); sg.addColorStop(0, '#8a7a6a'); sg.addColorStop(1, '#3a322a'); ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(sx, sy, 2.8, 2, 0, 0, Math.PI * 2); ctx.fill(); }
    const log = (x1, y1, x2, y2) => { const lg = ctx.createLinearGradient(0, Math.min(y1, y2) - 2, 0, Math.max(y1, y2) + 2); lg.addColorStop(0, '#7a4a26'); lg.addColorStop(1, '#3a2010'); ctx.strokeStyle = lg; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.strokeStyle = '#ff7a2a'; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * 0.35, y1 + (y2 - y1) * 0.35); ctx.lineTo(x1 + (x2 - x1) * 0.65, y1 + (y2 - y1) * 0.65); ctx.stroke(); ctx.globalAlpha = 1; };
    log(fx - 10, fy - 1, fx + 8, fy - 5); log(fx + 10, fy - 1, fx - 8, fy - 5);
    for (let i = 0; i < 5; i++) { const ph = tAnim * (2.4 + i * 0.37) + i * 1.9, h = 10 + Math.sin(ph) * 3 + (2 - Math.abs(i - 2)) * 3; flame(ctx, fx + (i - 2) * 2.6 + Math.sin(ph * 1.3) * 0.6, fy - 3, h, Math.sin(ph)); }
    const core = ctx.createRadialGradient(fx, fy - 5, 0, fx, fy - 5, 6); core.addColorStop(0, 'rgba(255,250,210,0.9)'); core.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = core; ctx.beginPath(); ctx.arc(fx, fy - 5, 6, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    if (Math.random() < 0.35) particles.push({ x: fx + (Math.random() - 0.5) * 8, y: fy - 12, vx: (Math.random() - 0.5) * 8, vy: -22 - Math.random() * 18, life: 1 + Math.random(), age: 0, c: Math.random() < 0.5 ? '#ffb04a' : '#ff7a2a', s: 1, float: true });
    seats.filter(p => p.y >= fy).forEach(sitter);
    const dt = 1 / 60;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt; if (p.age > p.life) { particles.splice(i, 1); continue; }
      p.x += (p.vx + Math.sin(tAnim * 3 + i) * 4) * dt; p.y += p.vy * dt;
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 1.5); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // fireflies
    for (let i = 0; i < 8; i++) {
      const px = (i * 97 + Math.sin(tAnim * 0.4 + i) * 30 + W) % W, py = floorY - 30 + Math.sin(tAnim * 0.7 + i * 2) * 18;
      const fa = 0.3 + 0.3 * Math.sin(tAnim * 2 + i); const ff = ctx.createRadialGradient(px, py, 0, px, py, 2.4); ff.addColorStop(0, 'rgba(220,255,150,' + fa + ')'); ff.addColorStop(1, 'rgba(200,255,140,0)'); ctx.fillStyle = ff; ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- the Hold's shops: the Enchanter and the Armorer (John, 2026-11-24, v102) ----------
  // The shop is drawn in the battle frame at battle scale: the whole party stands where it stands in a fight and the
  // shopkeeper stands where a monster would, at monster size, behind a counter. A sign names the shop. All choices
  // live in the counter panel under the scene (one set of controls).
  let shopBg = null, shopKey = '', SG = { k: 1, vw: 240, vh: 100, ex: 176, fy: 88 };
  // v105 (John: "seems squished... autoscale those based on window size"): the shop is drawn in a virtual room scaled so
  // the party, the shopkeeper and the counter (a 198 x 74 focus box) fill the arena at any window shape. The room grows
  // sideways or upward around them, so nothing is squashed or left tiny in a corner. v106: in short, wide panels the sign
  // and lanterns tuck in under the ceiling instead of shrinking the party (a player still saw tiny sprites there).
  function shopGeo() {
    const k = Math.min(W / 198, H / 74), vw = W / k, vh = H / k;
    return (SG = { k, vw, vh, ex: Math.round(vw / 2 + 48), fy: Math.round(64 + (vh - 74) * 0.8) });
  }
  const shopKind = () => S.shopK === 'arm' || S.shopK === 'store' ? S.shopK : 'ench';
  function shopGlow(g, cx, cy, r, rgb, a) { const q = g.createRadialGradient(cx, cy, 0, cx, cy, r); q.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); q.addColorStop(1, 'rgba(' + rgb + ',0)'); g.globalCompositeOperation = 'lighter'; g.fillStyle = q; g.fillRect(cx - r, cy - r, r * 2, r * 2); g.globalCompositeOperation = 'source-over'; }
  function shopShelf(g, sx, y, w, seed) {
    let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let bx = sx + 2; bx < sx + w - 4; bx += 4.5 + r() * 3) {
      if (r() < 0.6) { const c = ['#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fbbf24'][Math.floor(r() * 5)], bh = 4 + r() * 3; g.fillStyle = c; g.beginPath(); g.ellipse(bx + 1.6, y - bh * 0.4, 1.8, bh * 0.45, 0, 0, Math.PI * 2); g.fill(); g.fillRect(bx + 1, y - bh, 1.2, bh * 0.5); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(bx + 0.9, y - bh * 0.6, 0.6, 1.2); }
      else { const bh = 5 + r() * 2.5; g.fillStyle = ['#7c2d12', '#1e3a8a', '#14532d', '#581c87'][Math.floor(r() * 4)]; g.fillRect(bx, y - bh, 3, bh); }
    }
    g.fillStyle = '#6a4426'; g.fillRect(sx, y, w, 2); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(sx, y + 2, w, 1.5);
  }
  function buildShop(kind) {
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d'); g.scale(R * SG.k, R * SG.k);
    const W = SG.vw, H = SG.vh, fy = SG.fy, ench = kind === 'ench', store = kind === 'store', warm = !!(ench || store), ex = SG.ex;
    let lg = g.createLinearGradient(0, 0, 0, fy);
    if (ench) { lg.addColorStop(0, '#1a1128'); lg.addColorStop(1, '#352350'); } else if (store) { lg.addColorStop(0, '#1d140c'); lg.addColorStop(1, '#43301d'); } else { lg.addColorStop(0, '#17130f'); lg.addColorStop(1, '#3a2a20'); }
    g.fillStyle = lg; g.fillRect(0, 0, W, fy);
    if (ench) { g.fillStyle = 'rgba(255,220,160,.05)'; for (let y = 8; y < fy - 14; y += 12) for (let x = (y / 12 % 2) * 8; x < W; x += 16) { g.beginPath(); g.moveTo(x, y - 2.5); g.lineTo(x + 2, y); g.lineTo(x, y + 2.5); g.lineTo(x - 2, y); g.fill(); } }
    else if (store) { g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 0.6; for (let x = 4; x < W; x += 9) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x, fy); g.stroke(); } g.fillStyle = 'rgba(255,220,160,.04)'; for (let x = 0; x < W; x += 18) g.fillRect(x, 6, 4, fy - 6); }
    else { g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.6; for (let y = 6, k = 0; y < fy; y += 9, k++) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); for (let x = (k % 2) * 10; x < W; x += 20) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 9); g.stroke(); } } }
    const wy = fy - 16; lg = g.createLinearGradient(0, wy, 0, fy); lg.addColorStop(0, warm ? '#4a2f1c' : '#2a2420'); lg.addColorStop(1, warm ? '#2a190e' : '#16120e'); g.fillStyle = lg; g.fillRect(0, wy, W, fy - wy);
    g.fillStyle = warm ? '#6a4426' : '#4a3e34'; g.fillRect(0, wy - 1.5, W, 2);
    for (let px = (ex - 53) % 110 - 110; px < W + 110; px += 110) { const pg = g.createLinearGradient(px - 3, 0, px + 3, 0); pg.addColorStop(0, '#2a1a0e'); pg.addColorStop(0.5, '#5a3a22'); pg.addColorStop(1, '#2a1a0e'); g.fillStyle = pg; g.fillRect(px - 3, 0, 6, fy); }
    g.fillStyle = '#3a2618'; g.fillRect(0, 0, W, 6);
    lg = g.createLinearGradient(0, fy, 0, H); lg.addColorStop(0, warm ? '#5a3a22' : '#3a322c'); lg.addColorStop(1, '#1a120a'); g.fillStyle = lg; g.fillRect(0, fy, W, H - fy);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.6; for (let y = fy + 4, k = 0; y < H; y += 4 + k * 1.6, k++) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    if (ench) {
      shopShelf(g, ex - 46, fy - 60, 30, 7); shopShelf(g, ex - 46, fy - 42, 30, 19); shopShelf(g, ex + 18, fy - 60, 30, 23); shopShelf(g, ex + 18, fy - 42, 30, 31);
    } else if (store) {
      // tonic shelves behind the Quartermaster, crates and a barrel of lantern oil beside her, herbs drying overhead
      shopShelf(g, ex - 48, fy - 58, 34, 11); shopShelf(g, ex - 48, fy - 40, 34, 29); shopShelf(g, ex + 16, fy - 58, 30, 41);
      const crate = (x, y, w) => { g.fillStyle = '#7a5530'; g.fillRect(x, y, w, w); g.strokeStyle = '#3a2614'; g.lineWidth = 0.8; g.strokeRect(x + 0.4, y + 0.4, w - 0.8, w - 0.8); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + w); g.moveTo(x + w, y); g.lineTo(x, y + w); g.stroke(); };
      crate(ex + 30, fy - 30, 14); crate(ex + 44, fy - 30, 14); crate(ex + 37, fy - 44, 14);
      g.fillStyle = '#6a4426'; g.beginPath(); g.ellipse(ex + 24, fy - 10, 7, 9, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#3a2614'; g.fillRect(ex + 17, fy - 14, 14, 1.2); g.fillRect(ex + 17, fy - 7, 14, 1.2);
      for (let i = 0; i < 7; i++) { const hx = ex - 110 + i * 14 + (i % 2) * 4; g.strokeStyle = '#2a1a0e'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(hx, 6); g.lineTo(hx, 12); g.stroke(); g.fillStyle = ['#4d7c3a', '#6b8f3a', '#8a6a2a'][i % 3]; g.beginPath(); g.moveTo(hx - 3, 12); g.lineTo(hx + 3, 12); g.lineTo(hx, 20); g.fill(); }
    } else {
      // forge hearth behind the smith, a weapon rack and a shield on the wall
      const hx = ex + 30; g.fillStyle = '#2a2420'; g.fillRect(hx - 6, 6, 12, fy - 56);
      g.beginPath(); g.moveTo(hx - 16, fy - 16); g.lineTo(hx - 16, fy - 40); g.quadraticCurveTo(hx, fy - 54, hx + 16, fy - 40); g.lineTo(hx + 16, fy - 16); g.fill();
      g.strokeStyle = '#5a4a3e'; g.lineWidth = 2; g.stroke();
      const rx = ex - 46; g.fillStyle = '#5a3a22'; g.fillRect(rx, fy - 62, 30, 2); g.fillRect(rx, fy - 38, 30, 2);
      [['#c0c8d4', 0], ['#a8b0bc', 8], ['#d4dbe6', 16], ['#9aa6b8', 24]].forEach(([col, d]) => { g.fillStyle = col; g.fillRect(rx + 3 + d, fy - 60, 1.6, 20); g.fillStyle = '#6a4426'; g.fillRect(rx + 2 + d, fy - 44, 3.6, 4); });
      g.fillStyle = '#7a8494'; g.beginPath(); g.arc(ex - 4, fy - 52, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = '#a8742e'; g.beginPath(); g.arc(ex - 4, fy - 52, 2.2, 0, Math.PI * 2); g.fill();
    }
    // the sign over the shop
    const text = ench ? 'THE ENCHANTER' : store ? 'THE STORE' : 'THE ARMORER'; g.font = '700 7px Inter, system-ui, sans-serif'; const sw = g.measureText(text).width + 12, sy = Math.max(3, fy - 80);
    g.strokeStyle = '#2a1a0e'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(ex - sw / 2 + 4, 6); g.lineTo(ex - sw / 2 + 4, sy); g.moveTo(ex + sw / 2 - 4, 6); g.lineTo(ex + sw / 2 - 4, sy); g.stroke();
    g.fillStyle = '#5a3a22'; g.fillRect(ex - sw / 2, sy, sw, 11); g.strokeStyle = '#a8742e'; g.strokeRect(ex - sw / 2 + 0.5, sy + 0.5, sw - 1, 10);
    g.fillStyle = ench ? '#e9d5ff' : store ? '#c8f7d4' : '#ffd9a8'; g.textAlign = 'center'; g.fillText(text, ex, sy + 8); g.textAlign = 'left';
    return c;
  }
  function drawShopCounter(ex, fy, kind) {
    const cw = 54, top = fy - 13, ench = kind !== 'arm';
    let lg = ctx.createLinearGradient(0, top, 0, fy); lg.addColorStop(0, ench ? '#6a4024' : '#3a3a42'); lg.addColorStop(1, ench ? '#2e1a0c' : '#1e1e24'); ctx.fillStyle = lg; ctx.fillRect(ex - cw / 2, top + 2, cw, fy - top);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.6; for (let i = 0; i < 3; i++) ctx.strokeRect(ex - cw / 2 + 3 + i * 16, top + 5, 15, fy - top - 7);
    ctx.fillStyle = ench ? '#b07a46' : '#6a6a76'; ctx.fillRect(ex - cw / 2 - 2, top - 1, cw + 4, 3.5);
    if (ench) {
      ctx.fillStyle = '#efe2bf'; ctx.fillRect(ex - 24, top - 5, 2, 4); flame(ctx, ex - 23, top - 5, 3.5 + Math.sin(tAnim * 8) * 0.5, Math.sin(tAnim * 5));
      if (kind === 'store') {
        // the Quartermaster's scales and a stack of coins
        ctx.fillStyle = '#a8742e'; ctx.fillRect(ex + 18, top - 9, 1.2, 8); ctx.fillRect(ex + 12, top - 9, 13, 1);
        ctx.beginPath(); ctx.ellipse(ex + 13, top - 6, 3, 1, 0, 0, Math.PI * 2); ctx.ellipse(ex + 24, top - 6.5 + Math.sin(tAnim * 1.3) * 0.4, 3, 1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f5c242'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(ex - 12, top - 1.5 - i * 1.3, 2.6, 0.9, 0, 0, Math.PI * 2); ctx.fill(); }
      } else { ctx.fillStyle = '#1e3a8a'; ctx.fillRect(ex + 14, top - 2.5, 9, 2); ctx.fillStyle = '#7c2d12'; ctx.fillRect(ex + 15, top - 4.5, 7, 2); }
    } else {
      ctx.fillStyle = '#4a505c'; ctx.beginPath(); ctx.moveTo(ex + 16, top - 1); ctx.lineTo(ex + 28, top - 1); ctx.lineTo(ex + 28, top - 4); ctx.lineTo(ex + 32, top - 6); ctx.lineTo(ex + 13, top - 6); ctx.lineTo(ex + 17, top - 4); ctx.fill();
      ctx.fillStyle = '#8a92a0'; ctx.fillRect(ex + 13, top - 6.5, 19, 1);
    }
    return top;
  }
  function drawEnchShop(now) {
    const kind = shopKind(), ench = kind === 'ench', key = W + 'x' + H + kind;
    if (shopKey !== key) { shopGeo(); shopBg = buildShop(kind); shopKey = key; }
    ctx.drawImage(shopBg, 0, 0, W, H);
    ctx.save(); ctx.scale(SG.k, SG.k);
    drawShopRoom(SG.vw, SG.fy, SG.ex, kind);
    ctx.restore();
  }
  function drawShopRoom(W, fy, ex, kind) {
    const ench = kind === 'ench';
    // hanging lanterns and the room light
    for (const lx of [ex - 120, ex - 72]) {
      const ly = Math.max(13, fy - 70), s = Math.sin(tAnim * 1.1 + lx) * 0.6;
      ctx.strokeStyle = '#2a1a0e'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(lx, 6); ctx.lineTo(lx + s, ly - 4); ctx.stroke();
      shopGlow(ctx, lx + s, ly, 26, '255,200,110', 0.3);
      ctx.fillStyle = '#3a2618'; ctx.fillRect(lx + s - 3, ly - 4.5, 6, 1.5); ctx.fillRect(lx + s - 3, ly + 3.5, 6, 1.5);
      ctx.fillStyle = 'rgba(255,214,140,.9)'; ctx.fillRect(lx + s - 2.4, ly - 3, 4.8, 6.5); flame(ctx, lx + s, ly + 2.5, 4 + Math.sin(tAnim * 7 + lx) * 0.5, Math.sin(tAnim * 4 + lx));
    }
    shopGlow(ctx, ex - 77, fy + 6, 108, '255,190,110', 0.16);
    if (ench) {
      // a rune circle turning slowly behind the Enchanter
      ctx.save(); ctx.translate(ex, fy - 44); ctx.globalAlpha = 0.55 + 0.15 * Math.sin(tAnim * 1.5); ctx.strokeStyle = 'rgba(196,181,253,.8)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
      ctx.rotate(tAnim * 0.15); ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2, b = a + Math.PI * 2 / 3; ctx.moveTo(Math.cos(a) * 17, Math.sin(a) * 17); ctx.lineTo(Math.cos(b) * 17, Math.sin(b) * 17); } ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1; shopGlow(ctx, ex, fy - 44, 30, '167,139,250', 0.28);
    } else if (kind === 'store') {
      // a warm glow on the tonic shelves
      shopGlow(ctx, ex - 31, fy - 50, 30, '134,239,172', 0.14 + 0.04 * Math.sin(tAnim * 2));
    } else {
      // the forge fire
      const hx = ex + 30, fg = ctx.createLinearGradient(0, fy - 40, 0, fy - 16); fg.addColorStop(0, '#3a1a08'); fg.addColorStop(1, '#ff7a1a'); ctx.fillStyle = fg; ctx.fillRect(hx - 11, fy - 36, 22, 20);
      for (let i = 0; i < 4; i++) flame(ctx, hx - 7 + i * 4.5, fy - 17, 8 + (i % 2) * 3 + Math.sin(tAnim * 6 + i) * 1.2, Math.sin(tAnim * 5 + i));
      shopGlow(ctx, hx, fy - 26, 40, '255,140,50', 0.32 + 0.05 * Math.sin(tAnim * 4));
      if (Math.random() < 0.15) particles.push({ x: hx + (Math.random() - 0.5) * 14, y: fy - 22, vx: (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 12, life: 1 + Math.random(), age: 0, c: Math.random() < 0.5 ? '#ffb347' : '#ff6a1f', s: 1 });
    }
    // the shopkeeper at monster size behind the counter, facing the party
    const k = sprite(ench ? 'enchanter' : kind === 'store' ? 'quartermaster' : 'armorer', 0, false), kw = k.lw * 3, kh = k.lh * 3, br = Math.sin(tAnim * 1.4) * 0.5;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, fy - 11); ctx.clip(); ctx.translate(ex, 0); ctx.scale(-1, 1); ctx.drawImage(k, -kw / 2, fy - 4 - kh + br, kw, kh); ctx.restore();
    const top = drawShopCounter(ex, fy, kind);
    // what you picked sits on the counter
    const picks = (ench ? [EW.dst, EW.src] : kind === 'arm' ? [AW.a, AW.b] : []).map(u => u && L.itemOf(S, u));
    picks.forEach((it, i) => {
      if (!it) return; const im = shopIcon(it), sz = 10, px = ex + (i ? 6 : -14), py = top - sz - 1 + Math.sin(tAnim * 2 + i) * 0.5;
      shopGlow(ctx, px + sz / 2, py + sz / 2, sz, '255,230,160', 0.25);
      if (im.complete && im.naturalWidth) ctx.drawImage(im, px, py, sz, sz);
    });
    // the party, exactly where it stands in a fight
    for (const p of partyLayout(ex, fy)) {
      const m = L.memberById(p.id); if (!m) continue;
      const spr = sprite(m.cls, lookHue(m), false), b = Math.sin(tAnim * 1.6 + p.x) * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(p.x + spr.lw, p.y + spr.lh * 2 - 1, 8, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(spr, p.x, p.y + b, spr.lw * 2, spr.lh * 2);
    }
    const dt = 1 / 60;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt; if (p.age > p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; if (p.g) p.vy += p.g * dt;
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 1.5); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s > 1 ? 1.1 : 0.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const shopIcons = {};
  function shopIcon(it) {
    const k = it.cls + '|' + it.slot + '|' + it.rar;
    if (!shopIcons[k]) { const im = new Image(); im.src = SP.itemIcon(it.cls, it.slot, it.rar); shopIcons[k] = im; }
    return shopIcons[k];
  }
  // A shower of sparks on the counter when something is made.
  function shopBurst() {
    const ex = SG.ex, y = SG.fy - 18, cols = shopKind() === 'ench' ? ['#f5c242', '#c4b5fd', '#f0abfc', '#ffffff'] : shopKind() === 'store' ? ['#f5c242', '#86efac', '#fff3c0', '#ffffff'] : ['#ffb347', '#ff6a1f', '#fff3c0', '#ffffff'];
    for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, v = 10 + Math.random() * 30; particles.push({ x: ex - 8, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 15, g: 30, life: 0.8 + Math.random() * 0.6, age: 0, c: cols[i % 4], s: 2 }); }
  }

  // ---------- the Nexus breach (click-rhythm brake, core.js NX_*) ----------
  // The back wall cracks as the meter fills, violet light leaks through, then the Nexus Guardian steps out.
  const NX_CRACKS = (() => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const out = [];
    for (let i = 0; i < 9; i++) {
      const a0 = (i / 9) * Math.PI * 2 + rnd() * 0.5, pts = [[0, 0]];
      let x = 0, y = 0, a = a0;
      for (let j = 0; j < 6; j++) { a += (rnd() - 0.5) * 0.9; const l = 0.035 + rnd() * 0.04; x += Math.cos(a) * l; y += Math.sin(a) * l * 0.8; pts.push([x, y]); }
      out.push(pts);
    }
    return out;
  })();
  const nxGuard = { born: -9 };
  function drawBreach(floorY) {
    const x = S.nx; if (!x || !(x.m > 0 || x.ph)) return 0;
    const k = x.ph === 1 ? 1 : Math.max(0, Math.min(1, x.m || 0));
    if (k <= 0) return 0;
    const cx = Math.round(W * FOE_X), cy = Math.round(floorY * 0.48), sc = Math.min(W, H * 1.6);
    ctx.fillStyle = 'rgba(10,4,24,' + (k * 0.5) + ')'; ctx.fillRect(0, 0, W, H);
    const pulse = 0.85 + 0.15 * Math.sin(tAnim * 6);
    const gr = ctx.createRadialGradient(cx, cy, 2, cx, cy, 20 + k * sc * 0.28);
    gr.addColorStop(0, 'rgba(190,120,255,' + (0.55 * k * pulse) + ')'); gr.addColorStop(0.5, 'rgba(120,60,230,' + (0.22 * k) + ')'); gr.addColorStop(1, 'rgba(80,30,180,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
    // cracks grow segment by segment
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pts of NX_CRACKS) {
      const reach = k * (pts.length - 1);
      ctx.beginPath(); ctx.moveTo(cx, cy);
      for (let j = 1; j <= Math.ceil(reach); j++) {
        const f = Math.min(1, reach - (j - 1)), [ax, ay] = pts[j - 1], [bx, by] = pts[j];
        ctx.lineTo(cx + (ax + (bx - ax) * f) * sc, cy + (ay + (by - ay) * f) * sc);
      }
      ctx.strokeStyle = 'rgba(30,10,60,0.9)'; ctx.lineWidth = 3.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(214,170,255,' + (0.5 + 0.5 * k * pulse) + ')'; ctx.lineWidth = 1.3; ctx.stroke();
    }
    // the hole opens once it is through
    const open = x.ph === 1 ? Math.min(1, (tAnim - nxGuard.born) / 0.6) : x.ph === 2 ? k : Math.max(0, (k - 0.75) / 0.25) * 0.35;
    if (open > 0) {
      const rx = sc * 0.11 * open, ry = sc * 0.14 * open;
      const hg = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
      hg.addColorStop(0, '#020008'); hg.addColorStop(0.7, '#12052a'); hg.addColorStop(1, 'rgba(150,90,255,0.9)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(220,180,255,' + (0.6 * pulse) + ')'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { const a = tAnim * (1.2 + i * 0.5) + i * 2; ctx.beginPath(); ctx.ellipse(cx, cy, rx * (0.55 + i * 0.18), ry * (0.55 + i * 0.18), 0, a, a + 1.6); ctx.stroke(); }
    }
    // stone dust and violet motes falling from the wall
    if (Math.random() < k * 0.5) particles.push({ x: cx + (Math.random() - 0.5) * sc * 0.4, y: cy + (Math.random() - 0.5) * sc * 0.2, vx: (Math.random() - 0.5) * 20, vy: 10, life: 0.9, age: 0, c: Math.random() < 0.5 ? '#6b6378' : '#c79bff', s: Math.random() < 0.3 ? 2 : 1 });
    return k;
  }
  function drawGuardian(floorY) {
    const x = S.nx, a = x.ph === 1 ? Math.min(1, (tAnim - nxGuard.born) / 0.8) : Math.max(0, x.m || 0);
    if (a <= 0) return;
    if (!nxGuard.spr) {
      // the Guardian: a sentinel of Nexus crystal, tinted violet with a pale core
      const base = sprite('sentinel', 0, false), c = document.createElement('canvas'); c.width = base.width; c.height = base.height;
      const g = c.getContext('2d'); g.drawImage(base, 0, 0); g.globalCompositeOperation = 'source-atop';
      const lg = g.createLinearGradient(0, 0, 0, c.height); lg.addColorStop(0, 'rgba(225,200,255,0.75)'); lg.addColorStop(0.5, 'rgba(130,70,250,0.72)'); lg.addColorStop(1, 'rgba(60,20,150,0.8)');
      g.fillStyle = lg; g.fillRect(0, 0, c.width, c.height); c.lw = base.lw; c.lh = base.lh; nxGuard.spr = c;
    }
    const spr = nxGuard.spr, sw = spr.lw * 4, sh = spr.lh * 4, fxC = Math.round(W * FOE_X);
    const bob = Math.sin(tAnim * 1.6) * 2.5, rise = (1 - a) * 18;
    const fx = Math.round(fxC - sw / 2), fy = Math.round(floorY + 4 - sh + bob + rise) - 6;
    const gg = ctx.createRadialGradient(fxC, fy + sh / 2, 4, fxC, fy + sh / 2, sw * 1.1);
    gg.addColorStop(0, 'rgba(170,100,255,' + (0.45 * a) + ')'); gg.addColorStop(1, 'rgba(120,60,255,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gg; ctx.fillRect(fxC - sw * 1.2, fy - 20, sw * 2.4, sh + 40); ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,' + (0.45 * a) + ')'; ctx.beginPath(); ctx.ellipse(fxC, floorY + 4, sw * 0.42, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = a * (0.88 + 0.12 * Math.sin(tAnim * 9));
    ctx.save(); ctx.translate(fx + sw, fy); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0, sw, sh);
    if (tAnim < foeAnim.flash) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * a; ctx.drawImage(spr, 0, 0, sw, sh); }
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (x.ph === 1) { foeAnim.cx = fxC; foeAnim.cy = fy + sh / 2; foeAnim.w = sw; foeAnim.h = sh; }
  }

  // ---------- Mercy Corps encounters (John, 2026-11-24) ----------
  // A wounded companion sits propped against a rock, a lantern-green glow rising as the healers mend them.
  function drawWounded(foe, fxC, floorY) {
    const spr = sprite('healer', 0, false), sw = spr.lw * 2, sh = spr.lh * 2, k = foe.hp / foe.max;
    ctx.fillStyle = '#3a3440'; ctx.beginPath(); ctx.ellipse(fxC + sw * 0.35, floorY + 1, sw * 0.32, sh * 0.2, 0, Math.PI, 0); ctx.fill();
    const gl = ctx.createRadialGradient(fxC, floorY - sh * 0.3, 2, fxC, floorY - sh * 0.3, sw * 0.9); gl.addColorStop(0, 'rgba(126,224,165,' + (0.15 + 0.35 * k) + ')'); gl.addColorStop(1, 'rgba(126,224,165,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl; ctx.fillRect(fxC - sw, floorY - sh * 1.2, sw * 2, sh * 1.4); ctx.globalCompositeOperation = 'source-over';
    // sitting: lean back and sink a little, facing the party
    ctx.save(); ctx.translate(fxC + sw * 0.2, floorY + 3); ctx.rotate(0.18 - 0.12 * k); ctx.scale(-1, 1); ctx.drawImage(spr, -sw * 0.5, -sh * (0.78 + 0.2 * k), sw, sh); ctx.restore();
    // a bandage that turns from red to white as they heal
    ctx.fillStyle = k < 0.5 ? '#e5484d' : '#f5f5f5'; ctx.fillRect(fxC - sw * 0.05, floorY - sh * (0.62 + 0.2 * k), sw * 0.22, 1.6);
    if (Math.random() < 0.15 + 0.3 * k) particles.push({ x: fxC + (Math.random() - 0.5) * sw * 0.6, y: floorY - sh * 0.4, vx: (Math.random() - 0.5) * 6, vy: -14 - Math.random() * 10, life: 0.9, age: 0, c: Math.random() < 0.5 ? '#7ee0a5' : '#d1fae5', s: 1, float: true });
  }
  // A Mercy Corps companion held captive behind the monster, hands bound.
  function drawCaptive(x, floorY) {
    const spr = sprite('healer', 0, false), sw = spr.lw * 1.4, sh = spr.lh * 1.4;
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(x, floorY + 3, sw * 0.35, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(spr, -sw / 2, floorY + 4 - sh + Math.sin(tAnim * 3) * 0.4, sw, sh); ctx.restore();
    ctx.strokeStyle = '#a8742e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - sw * 0.25, floorY - sh * 0.45); ctx.lineTo(x + sw * 0.25, floorY - sh * 0.4); ctx.moveTo(x - sw * 0.25, floorY - sh * 0.38); ctx.lineTo(x + sw * 0.25, floorY - sh * 0.33); ctx.stroke();
    if (Math.sin(tAnim * 2) > 0.6) { ctx.fillStyle = '#fff'; ctx.font = '600 7px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Help!', x, floorY - sh - 2); ctx.textAlign = 'left'; }
  }
  function render(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; tAnim += dt;
    ctx.setTransform(R, 0, 0, R, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const nowMs = Date.now();
    // a shop visit wins over the camp scene: the Hold's tents can be visited from the main camp too (v103)
    if (L.visiting(S)) { document.body.classList.remove('resting'); drawEnchShop(nowMs); requestAnimationFrame(render); return; }
    document.body.classList.toggle('resting', L.resting(S, nowMs));
    if (L.resting(S, nowMs)) { drawCamp(nowMs); requestAnimationFrame(render); return; }
    const b = L.biomeOf(S.floor);
    const key = b.name + W + 'x' + H;
    if (key !== bgKey) { bgCanvas = buildBackground(b, Math.floor((S.floor - 1) / 10) + 3); bgKey = key; }
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    const floorY = Math.round(H * 0.7);
    const breach = drawBreach(floorY), nxUp = !!(S.nx && S.nx.ph === 1);

    [W * 0.17, W * 0.83].forEach((tx, i) => {
      tx = Math.round(tx); const ty = Math.round(floorY * 0.42) - 3;
      const fl = Math.sin(tAnim * 13 + i * 2) + Math.sin(tAnim * 7.3 + i);
      const gr = ctx.createRadialGradient(tx, ty, 1, tx, ty, 34 + fl * 2);
      gr.addColorStop(0, 'rgba(255,170,70,0.32)'); gr.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(tx - 40, ty - 40, 80, 80); ctx.globalCompositeOperation = 'source-over';
      flame(ctx, tx, ty + 2.5, 8 + fl * 0.8, fl);
    });

    // the party's lantern light
    const lay0 = partyLayout();
    const lx = lay0.length ? lay0[0].x : W * 0.4;
    const pool = ctx.createRadialGradient(lx, floorY + 4, 4, lx, floorY + 4, W * 0.42);
    const lg = (SP.LANTERNS && SP.LANTERNS[lanternOf()] || { glow: [255, 190, 110] }).glow.join(',');
    pool.addColorStop(0, 'rgba(' + lg + ',0.24)'); pool.addColorStop(1, 'rgba(' + lg + ',0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pool; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';

    // foe
    const foe = S.foe, fxC = Math.round(W * FOE_X);
    if (foe && !nxUp) {
      const fk = foe.name + foe.max + S.floor + S.foeIdx;
      if (foeAnim.key !== fk) { foeAnim.key = fk; foeAnim.born = tAnim; }
      const spr = sprite(foe.sprite, foe.chest ? 0 : foe.hue, tAnim < foeAnim.flash);
      const sw = spr.lw * 3, sh = spr.lh * 3;
      const age = tAnim - foeAnim.born;
      const drop = age < 0.25 ? (1 - age / 0.25) * -12 : 0;
      const flier = foe.sprite === 'bat' || foe.sprite === 'ghost';
      const bob = Math.sin(tAnim * 2.4) * (flier ? 2.2 : 0.6);
      const shake = tAnim < foeAnim.shake ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const lungeF = tAnim < foeAnim.lunge ? -4 : 0;
      const fx = Math.round(fxC - sw / 2 + shake + lungeF), fy = Math.round(floorY + 4 - sh + bob + drop) - (flier ? 10 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(fxC, floorY + 4, sw * 0.42, 3, 0, 0, Math.PI * 2); ctx.fill();
      if (foe.boss || foe.world) {
        const gg = ctx.createRadialGradient(fxC, fy + sh / 2, 4, fxC, fy + sh / 2, sw), gc = foe.world ? '170,90,255,' : '255,80,40,';
        gg.addColorStop(0, 'rgba(' + gc + (foe.world ? '0.3)' : '0.18)')); gg.addColorStop(1, 'rgba(' + gc + '0)');
        ctx.fillStyle = gg; ctx.fillRect(fxC - sw, fy - 10, sw * 2, sh + 20);
      }
      ctx.globalAlpha = Math.min(1, age / 0.15);
      if (foe.wounded) drawWounded(foe, fxC, floorY);
      else {
        // foes face left, toward the party
        ctx.save(); ctx.translate(fx + sw, fy); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0, sw, sh); ctx.restore();
        if (foe.rescue) drawCaptive(fxC + sw * 0.55, floorY);
      }
      ctx.globalAlpha = 1;
      foeAnim.cx = fxC; foeAnim.cy = fy + sh / 2; foeAnim.w = sw; foeAnim.h = sh;
      // a shielded foe sits in a pale blue bubble that thins and cracks as it wears down
      const shv = S.foe && S.foe.shield > 0 ? S.foe.shield : 0;
      if (shv > 0) {
        const rx = sw * 0.62, ry = sh * 0.62, pul = 0.5 + 0.5 * Math.sin(tAnim * 4);
        ctx.save();
        const sg = ctx.createRadialGradient(fxC, fy + sh / 2, Math.min(rx, ry) * 0.6, fxC, fy + sh / 2, Math.max(rx, ry));
        sg.addColorStop(0, 'rgba(120,200,255,0)'); sg.addColorStop(1, 'rgba(120,200,255,' + (0.12 + 0.22 * shv) + ')');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(fxC, fy + sh / 2, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(170,225,255,' + (0.35 + 0.45 * shv + 0.15 * pul) + ')'; ctx.lineWidth = 1 + shv;
        ctx.setLineDash(shv < 0.4 ? [6, 4] : []); ctx.stroke(); ctx.setLineDash([]);
        if (shv < 0.6) { ctx.strokeStyle = 'rgba(220,245,255,0.7)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(fxC - rx * 0.5, fy + sh * 0.2); ctx.lineTo(fxC - rx * 0.2, fy + sh * 0.4); ctx.lineTo(fxC - rx * 0.35, fy + sh * 0.55); if (shv < 0.3) { ctx.moveTo(fxC + rx * 0.4, fy + sh * 0.7); ctx.lineTo(fxC + rx * 0.15, fy + sh * 0.5); ctx.lineTo(fxC + rx * 0.3, fy + sh * 0.35); } ctx.stroke(); }
        ctx.restore();
      }
    }
    if (foeAnim.dying) {
      const d = foeAnim.dying, a = 0.7 * (1 - (tAnim - d.t) / 0.25);
      if (a <= 0) foeAnim.dying = null;
      else { ctx.globalAlpha = a; ctx.drawImage(d.spr, d.x - (1 - a) * 4, d.y + (1 - a) * 6, d.w * (1 + (1 - a) * 0.15), d.h * (1 - (1 - a) * 0.3)); ctx.globalAlpha = 1; }
    }

    if (breach && S.nx.ph) drawGuardian(floorY);
    const lay = drawParty(nowMs);

    // party attacks: a member lunges and a slash in their colour lands on the foe
    if ((foe || nxUp) && lay.length) {
      slashTimer -= dt;
      if (slashTimer <= 0) {
        slashTimer = 0.3 + Math.random() * 0.3;
        const fighters = lay.filter(p => !S.down[p.id] && !(foe && foe.wounded && L.memberById(p.id).cls !== 'healer'));
        const p = fighters[Math.floor(Math.random() * fighters.length)];
        if (p) {
          const m = L.memberById(p.id);
          mAnim(p.id).lunge = tAnim + 0.12;
          if (foe && foe.wounded) bolts.push({ x: p.x + 22, y: p.y + 10, tx: foeAnim.cx, ty: foeAnim.cy, t: tAnim, c: '#7ee0a5' });
          else if (m.cls === 'mage' || m.cls === 'necro' || m.cls === 'healer') {
            bolts.push({ x: p.x + 22, y: p.y + 10, tx: foeAnim.cx, ty: foeAnim.cy, t: tAnim, c: L.CLASSES[m.cls].color });
          } else {
            slashes.push({ x: foeAnim.cx + (Math.random() - 0.5) * foeAnim.w * 0.5, y: foeAnim.cy + (Math.random() - 0.5) * foeAnim.h * 0.5, a: Math.random() * Math.PI, t: tAnim, c: L.CLASSES[m.cls].color });
          }
        }
      }
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const o = bolts[i], k = (tAnim - o.t) / 0.25;
      if (k >= 1) { bolts.splice(i, 1); burst(o.tx, o.ty, 4, [o.c], 25); continue; }
      const x = o.x + (o.tx - o.x) * k, y = o.y + (o.ty - o.y) * k - Math.sin(k * Math.PI) * 8;
      const og = ctx.createRadialGradient(x, y, 0, x, y, 4); og.addColorStop(0, '#ffffff'); og.addColorStop(0.35, o.c); og.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = og; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    }
    for (let i = slashes.length - 1; i >= 0; i--) {
      const s = slashes[i], k = (tAnim - s.t) / 0.18;
      if (k >= 1) { slashes.splice(i, 1); continue; }
      const len = 10 + k * 6, dx = Math.cos(s.a) * len, dy = Math.sin(s.a) * len;
      ctx.strokeStyle = s.c; ctx.globalAlpha = 1 - k; ctx.lineWidth = (s.big ? 2.2 : 1.3) * (1 - k * 0.5); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s.x - dx, s.y - dy); ctx.quadraticCurveTo(s.x - dy * 0.3, s.y + dx * 0.3, s.x + dx, s.y + dy); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth *= 0.4; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // ember storm
    const mage = S.party.find(id => id && L.memberById(id).cls === 'mage' && L.abilityActive(S, id, nowMs));
    if (mage && foe && Math.random() < 0.6) particles.push({ x: foeAnim.cx + (Math.random() - 0.5) * 40, y: 0, vx: -10, vy: 140, life: 0.6, age: 0, c: Math.random() < 0.5 ? '#ff8a3d' : '#ffd27a', s: 2 });
    // healing sparkles
    if (lay.some(p => L.memberById(p.id).cls === 'healer' && !S.down[p.id]) && Math.random() < 0.15) {
      const hurt = lay.filter(p => !S.down[p.id] && (S.hp[p.id] || 0) < L.maxHpOf(S, p.id) * 0.98);
      const p = hurt[Math.floor(Math.random() * hurt.length)];
      if (p) particles.push({ x: p.x + 6 + Math.random() * 12, y: p.y + 20, vx: 0, vy: -30, life: 0.7, age: 0, c: '#9be87a', s: 1, float: true });
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt;
      if (p.age > p.life) { particles.splice(i, 1); continue; }
      if (!p.float) p.vy += 120 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (!p.float && p.y > floorY + 6) { p.y = floorY + 6; p.vy *= -0.35; p.vx *= 0.6; }
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 3); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < 14; i++) {
      const px = (i * 53 + tAnim * (4 + i % 3)) % W, py = (i * 37 + Math.sin(tAnim * 0.5 + i) * 6 + 20) % (floorY);
      ctx.fillStyle = 'rgba(255,220,160,' + (0.12 + 0.1 * Math.sin(tAnim + i)) + ')'; ctx.beginPath(); ctx.arc(px, py, 0.45, 0, Math.PI * 2); ctx.fill();
    }
    if (foe && foe.boss) {
      const left = 1 - S.lantern / L.lanternTime(S);
      if (left < 0.5) { ctx.fillStyle = 'rgba(0,0,0,' + ((0.5 - left) * 0.9) + ')'; ctx.fillRect(0, 0, W, H); }
    }
    requestAnimationFrame(render);
  }
  const bolts = [];

  // floating numbers (DOM, crisp text)
  let floaters = 0;
  let recentFloats = [];
  function floatText(text, cls, xFrac, yFrac) {
    if (floaters > 26) return;
    const el = document.createElement('div');
    el.className = 'float ' + (cls || '');
    el.textContent = text;
    // keep text inside the arena and stack it when two pop up at the same spot
    const t = performance.now(); xFrac = Math.max(0.09, Math.min(0.91, xFrac));
    recentFloats = recentFloats.filter(f => t - f.t < 450);
    for (let k = 0; k < 4 && recentFloats.some(f => Math.abs(f.x - xFrac) < 0.08 && Math.abs(f.y - yFrac) < 0.06); k++) yFrac -= 0.07;
    yFrac = Math.max(0.06, yFrac); recentFloats.push({ t, x: xFrac, y: yFrac });
    el.style.left = (xFrac * 100) + '%'; el.style.top = (yFrac * 100) + '%';
    arena.appendChild(el); floaters++;
    setTimeout(() => { el.remove(); floaters--; }, 900);
  }
  const fl = document.createElement('style');
  fl.textContent = '.float{position:absolute;transform:translate(-50%,-50%);font-weight:800;font-size:18px;color:#fff3dc;text-shadow:0 2px 0 #000,0 0 6px rgba(0,0,0,.8);pointer-events:none;animation:fl .9s ease-out forwards;font-variant-numeric:tabular-nums;white-space:nowrap}.float.crit{color:#ffcf3a;font-size:24px}.float.gold{color:#f2c14e;font-size:16px}.float.auto{font-size:14px;color:#e7d6b8}.float.hurt{color:#ff8a78;font-size:14px}.float.heal{color:#9be87a;font-size:14px}.float.skill{color:#fff1c2;font-size:13px;letter-spacing:.06em;text-transform:uppercase}.float.dodge{color:#c9d6e0;font-size:13px}.float.nexus{color:#d7b4ff;font-size:16px;text-shadow:0 0 8px #7a3cff,0 2px 0 #000}@keyframes fl{0%{opacity:0;margin-top:6px}15%{opacity:1}100%{opacity:0;margin-top:-46px}}';
  document.head.appendChild(fl);

  // ---------- events ----------
  let pendingGold = 0, lastGoldFloat = 0, sealedToast = false, lockToast = 0;
  const RARITY_COLOR = { common: '#d8cfb8', fine: '#8fcf6a', rare: '#6cc4e8', epic: '#c78bff', set: '#f2c14e', legend: '#ff8a3d' };
  // ---------- fight log (John, 2026-11-23): a short record of what happened in recent fights ----------
  const FLOG = [], FLOG_MAX = 120, flogThrottle = {};
  let flogTaken = 0, flogDirty = false;
  const nm = id => { const m = id && L.memberById(id); return m ? esc(m.name) : 'Someone'; };
  function flog(kind, text, key, gap) {
    const now = Date.now();
    if (key) { if (flogThrottle[key] && now - flogThrottle[key] < gap) return; flogThrottle[key] = now; }
    FLOG.unshift({ t: now, kind, text }); if (FLOG.length > FLOG_MAX) FLOG.length = FLOG_MAX; flogDirty = true;
  }
  function logEv(e) {
    switch (e.type) {
      case 'hit': if (e.crit && !e.auto) flog('fight', '<b>Critical strike</b> for ' + fmt(e.dmg), 'crit', 1500); break;
      case 'foehit': flogTaken += e.dmg || 0; if (S.foe && S.foe.boss && e.target !== 'minion') flog('party', nm(e.target) + ' takes ' + fmt(e.dmg) + ' from ' + esc(S.foe.name), 'bh' + e.target, 4000); break;
      case 'kill': { const f = e.foe || {}; flog('fight', (f.boss ? '<b>Guardian down:</b> ' : f.chest ? 'Opened ' : 'Defeated ') + esc(f.name || 'a foe') + (f.pack ? ' (' + f.pack + ' foes)' : '') + ' <em>+' + fmt(e.gold || 0) + ' gold' + (e.xp ? ', +' + (e.xp < 10 ? (Math.round(e.xp * 10) / 10) : fmt(Math.round(e.xp))) + ' XP' : '') + (flogTaken ? ', party took ' + fmt(flogTaken) : '') + '</em>'); flogTaken = 0; break; }
      case 'ability': flog('party', nm(e.id) + ' uses <b>' + esc(e.name || (L.CLASSES[e.cls] && L.CLASSES[e.cls].ability.name) || 'an ability') + '</b>' + (e.dmg ? ' for ' + fmt(e.dmg) : ''), 'ab' + e.id, 2000); break;
      case 'fall': flog('party', '<b class="bad">' + nm(e.id) + ' falls</b>'); break;
      case 'revive': flog('party', '<b class="good">' + nm(e.id) + ' is back up</b>'); break;
      case 'dodge': flog('party', nm(e.target) + ' dodges', 'dg' + e.target, 5000); break;
      case 'block': flog('party', nm(e.target) + ' blocks a hit', 'bk' + e.target, 5000); break;
      case 'cc': flog('party', '<b class="bad">' + nm(e.id) + (e.k === 'stun' ? ' is stunned</b> and cannot act for ' : ' is disarmed</b> and fights barehanded for ') + Math.round(e.sec * 10) / 10 + 's'); break;
      case 'ccend': flog('party', nm(e.id) + (e.k === 'stun' ? ' shakes off the stun' : ' grabs its weapon back'), 'ce' + e.id, 3000); break;
      case 'oom': flog('party', '<b class="bad">' + nm(e.id) + ' is out of mana</b> and can only attack until it recovers'); break;
      case 'resback': flog('party', nm(e.id) + ' has mana again', 'rb' + e.id, 3000); break;
      case 'poison': flog('party', nm(e.id) + ' is poisoned', 'ps' + e.id, 6000); break;
      case 'special': { const sp = L.SPECIALS[e.sp] || {}, hit = e.hits.filter(h => !h.dodge); flog('fight', '<b class="bad">' + esc((S.foe && S.foe.name) || 'The foe') + ': ' + esc(sp.name || 'special') + '</b> hits ' + (e.kind === 'all' ? 'the whole party' : hit.map(h => nm(h.id)).join(', ') || 'nobody') + (hit.length ? ' for ' + fmt(hit.reduce((a, h) => a + h.dmg, 0)) : '') + (sp.dot ? ' and leaves them ' + (sp.dot === 'burn' ? 'burning' : 'poisoned') + ' for ' + L.DOT_FIGHTS + ' fights' : '')); break; }
      case 'ambush': if (e.first) flog('fight', e.guarded ? nm(e.target) + ' guards the rear from an ambush' : '<b class="bad">Ambush!</b> ' + nm(e.target) + ' is hit from behind'); break;
      case 'mercy': flog('fight', '<b class="good">Mercy Corps:</b> ' + esc(e.who) + (e.kind === 'wounded' ? ' is wounded on the path' : ' is held captive')); break;
      case 'rescued': flog('fight', '<b class="good">Rescued ' + esc(e.who) + '</b>: +' + L.RESCUE_FX.xp * 100 + '% hero XP for ' + L.MERCY_MIN + ' min'); break;
      case 'aided': flog('fight', '<b class="good">Healed ' + esc(e.who) + '</b>: +' + L.AID_FX.pdps * 100 + '% damage and healing for ' + L.MERCY_MIN + ' min'); break;
      case 'craftxp': flog('party', '+' + fmt(e.xp) + ' hero XP for ' + (e.why === 'merge' ? 'merging' : 'enchanting'), 'cx', 1500); break;
      case 'mercyleft': flog('fight', esc(e.who) + ' was carried to safety'); break;
      case 'pack': flog('fight', '<b class="bad">Ambush pack:</b> ' + e.n + ' monsters attack together'); break;
      case 'ward': flog('fight', 'The foe raises a ward', 'ward', 4000); break;
      case 'shieldup': flog('fight', '<b class="bad">' + (e.again ? 'The guardian raises its shield again' : 'The foe hides behind a shield') + '</b>: the party deals ' + Math.round(L.SHIELD_CUT * 100) + '% less damage until it breaks'); break;
      case 'shieldbreak': flog('fight', '<b class="good">Shield broken</b>' + (e.tap ? ' by your strikes' : ' (it wore away)') + ': full damage again'); break;
      case 'wipe': flog('party', '<b class="bad">The party is beaten</b>' + (e.name ? ' by ' + esc(e.name) : '')); break;
      case 'bossfail': flog('fight', '<b class="bad">The lantern ran out</b> before the guardian fell'); break;
      case 'newfloor': flog('fight', 'Reached a new depth: <b>floor ' + e.floor + '</b>'); break;
      case 'rset': flog('loot', 'Region set piece: <b class="r-set" style="color:var(--rc)">' + esc(L.gearName(e.item)) + '</b>'); break;
      case 'goblinsack': flog('loot', '<b class="r-goblin" style="color:var(--rc)">The Loot Goblin dropped his Sack!</b>'); break;
      case 'loot': flog('loot', 'Found <b class="r-' + e.item.rar + '" style="color:var(--rc)">' + esc(L.gearName(e.item)) + '</b>'); break;
      case 'autoscrap': flog('loot', 'Auto-scrapped <b class="r-' + e.item.rar + '" style="color:var(--rc)">' + esc(L.gearName(e.item)) + '</b> for ' + fmt(e.gold) + ' gold, ' + e.dust + ' Dust'); break;
      case 'autosell': flog('loot', 'Pack full: sold ' + esc(L.gearName(e.item))); break;
      case 'sigil': flog('loot', 'Found <b>' + e.n + ' Sigils</b>'); break;
      case 'relic': flog('loot', 'Relic: <b>' + esc(e.relic.name) + '</b>' + (e.level > 1 ? ' (level ' + e.level + ')' : '')); break;
      case 'goblinflee': flog('loot', '<b class="bad">The Loot Goblin escaped</b>' + (e.item ? ' with ' + esc(L.gearName(e.item)) : '')); break;
      case 'goblinkill': flog('loot', '<b class="good">Loot Goblin slain</b>' + (e.item ? ', ' + esc(L.gearName(e.item)) + ' recovered' : '')); break;
      case 'herolevel': flog('party', nm('you') + ' reaches <b>level ' + e.lv + '</b>'); break;
    }
  }
  let flogFilter = 'all';
  try { flogFilter = localStorage.getItem('lh_flogf') || 'all'; } catch (e) {}
  function paintFlog(force) {
    const box = $('flog'); if (!box || !box.parentElement.open || (!flogDirty && !force)) return; flogDirty = false;
    const now = Date.now(), ago = t => { const s = Math.round((now - t) / 1000); return s < 60 ? s + 's' : Math.round(s / 60) + 'm'; };
    const rows = FLOG.filter(x => flogFilter === 'all' || x.kind === flogFilter).slice(0, 60);
    box.querySelector('.flist').innerHTML = rows.length ? rows.map(x => '<li class="fk-' + x.kind + '"><span>' + x.text + '</span><time>' + ago(x.t) + '</time></li>').join('') : '<li class="none">Nothing yet. Fights show up here as they happen.</li>';
    box.querySelectorAll('[data-ff]').forEach(b => b.classList.toggle('on', b.dataset.ff === flogFilter));
  }
  setInterval(paintFlog, 700);
  document.addEventListener('click', e => { const b = e.target.closest('[data-ff]'); if (!b) return; flogFilter = b.dataset.ff; try { localStorage.setItem('lh_flogf', flogFilter); } catch (x) {} paintFlog(true); });
  document.addEventListener('toggle', e => { if (e.target.id === 'flogbox') { try { localStorage.setItem('lh_flog', e.target.open ? '1' : ''); } catch (x) {} paintFlog(true); } }, true);
  try { if (localStorage.getItem('lh_flog') && $('flogbox')) $('flogbox').open = true; } catch (e) {}
  function handleEvents() {
    let kills = 0, gold = 0;
    for (const e of events) {
      logEv(e);
      if (e.type === 'hit' && e.nexus) {
        floatText('0', 'nexus', FOE_X + (Math.random() - 0.5) * 0.16, 0.4 + (Math.random() - 0.5) * 0.2);
        foeAnim.flash = tAnim + 0.05;
      } else if (e.type === 'nexus') {
        nxGuard.born = tAnim; sfx.boss(); floatText('The Nexus breaks through!', 'nexus', FOE_X - 0.12, 0.3);
        toast('flare', 'The Nexus Guardian', S.stats.nexus > 1 ? 'Drawn by the drumming again. Your blows pass through it. Ease your strikes and it will withdraw.'
          : 'The Nexus hears a rhythm that never tires and comes to see what knocks. Nothing you throw can touch its Guardian. Ease your strikes, let the rhythm settle, and it will withdraw.', 'feat');
      } else if (e.type === 'nexusleave') {
        toast('lamp', 'The Guardian withdraws', 'The rhythm settled and the Nexus lost interest. The wall seals behind it and the fight goes on.', '');
      } else if (e.type === 'hit') {
        if (!e.auto || Math.random() < 0.4) floatText(fmt(e.dmg), e.crit ? 'crit' : e.auto ? 'auto' : '', FOE_X + (Math.random() - 0.5) * 0.2, 0.42 + (Math.random() - 0.5) * 0.2);
        foeAnim.flash = tAnim + 0.06; foeAnim.shake = tAnim + 0.08;
        sfx.hit(e.crit);
      } else if (e.type === 'foehit') {
        foeAnim.lunge = tAnim + 0.15;
        if (e.target !== 'minion') { const a = mAnim(e.target); a.hit = tAnim + 0.1; floatText('-' + fmt(e.dmg), 'hurt', a.x / W, (a.y - 4) / H); if (e.behind) slashes.push({ x: a.x - 6, y: a.y, a: Math.random() * Math.PI, t: tAnim, c: '#ff5a4a', big: false }); }
        sfx.thud();
      } else if (e.type === 'ambush') {
        const a = mAnim(e.target);
        if (e.first) {
          floatText(e.guarded ? 'Rear guarded' : 'Ambush!', e.guarded ? 'skill' : 'crit', a.x / W, (a.y - 16) / H);
          if (!S.stats.ambushes) toast('lock', 'Ambush from behind', e.guarded ? L.memberById(e.target).name + ' guarded the rear and took it on the shield.' : 'Some monsters strike the back of the line first. Put a sturdy member, or a second tank, at the rear.', 'warn');
          S.stats.ambushes = (S.stats.ambushes || 0) + 1;
        }
      } else if (e.type === 'block') {
        const a = mAnim(e.target); floatText('Block', 'dodge', a.x / W, (a.y - 6) / H);
      } else if (e.type === 'cc') {
        const a = mAnim(e.id); floatText(e.k === 'stun' ? 'Stunned!' : 'Disarmed!', 'crit', a.x / W, (a.y - 16) / H);
        if (!(S.stats.ccSeen || {})[e.k]) { S.stats.ccSeen = Object.assign({}, S.stats.ccSeen, { [e.k]: 1 }); toast(e.k === 'stun' ? 'flare' : 'sword', L.memberById(e.id).name + (e.k === 'stun' ? ' is stunned' : ' is disarmed'), e.k === 'stun' ? 'A stunned hero cannot attack, heal or use abilities for a few seconds. Tanks shake it off twice as fast, and Shield Wall makes them immune.' : 'A disarmed hero fights barehanded: 35% damage, half healing and no abilities until it grabs its weapon back a few seconds later. Tanks recover twice as fast.', ''); }
      } else if (e.type === 'ccend') {
        const a = mAnim(e.id); if (e.k === 'disarm') floatText('Weapon back', 'heal', a.x / W, (a.y - 16) / H);
      } else if (e.type === 'ccblock') {
        const a = mAnim(e.id); floatText(e.k === 'stun' ? 'Stunned' : 'Disarmed', 'dodge', a.x / W, (a.y - 14) / H);
      } else if (e.type === 'oom') {
        const a = mAnim(e.id); floatText('Out of mana', 'hurt', a.x / W, (a.y - 14) / H);
        if (!S.stats.oomSeen) { S.stats.oomSeen = 1; toast('cross', L.memberById(e.id).name + ' ran out of mana', 'A healer spends mana to heal. With none left it only attacks until its mana comes back to ' + L.RES_WAKE + '. Gear with Flow speeds up mana and stamina regen.', 'warn'); }
      } else if (e.type === 'nores') {
        const a = mAnim(e.id); floatText('Not enough ' + (e.k || 'mana'), 'dodge', a.x / W, (a.y - 14) / H);
      } else if (e.type === 'dodge') {
        const a = mAnim(e.target); floatText('Dodge', 'dodge', a.x / W, (a.y - 6) / H);
      } else if (e.type === 'fall') {
        const a = mAnim(e.id); floatText(L.memberById(e.id).name + ' falls', 'hurt', a.x / W, (a.y - 10) / H);
      } else if (e.type === 'windup') {
        const sp = L.SPECIALS[e.sp]; if (!sp) continue;
        const who = e.target ? L.memberById(e.target) : null;
        spWarn('<b>' + esc(sp.name) + '</b>' + (sp.kind === 'all' ? ' incoming: the whole party' : sp.kind === 'pos' && who ? ' marks ' + esc(who.name) + ' (spot ' + (e.pos + 1) + ')' : ' incoming'), sp.dot || '');
        tone(180, 0.25, 'sawtooth', 0.03, 120);
        if (!S.stats.spSeen) { S.stats.spSeen = 1; toast('skull', 'Special attacks', 'Guardians, and some monsters, wind up a big move every few seconds. A red ring shows who it will hit. Shields and a tank\u2019s guard soften it, and a healer\u2019s ability or Purify clears burns and poison.', 'warn'); }
      } else if (e.type === 'special') {
        const sp = L.SPECIALS[e.sp] || {}, col = sp.dot === 'burn' ? ['#ff7a3d', '#ffd26a', '#ff3d2a'] : sp.dot === 'poison' ? ['#8fd16a', '#c9f0a0', '#4a8a2a'] : ['#ff8a78', '#ffe0c0', '#c84a3a'];
        foeAnim.lunge = tAnim + 0.25; foeAnim.shake = tAnim + 0.2;
        for (const h of e.hits) { const a = mAnim(h.id); if (h.dodge) { floatText(h.block ? 'Block' : 'Dodge', 'dodge', a.x / W, (a.y - 6) / H); continue; } a.hit = tAnim + 0.18; floatText('-' + fmt(h.dmg), 'hurt', a.x / W, (a.y - 4) / H); burst(a.x, a.y, 10, col, 32); }
        floatText(sp.name || 'Special', 'crit', FOE_X - 0.1, 0.28);
        sfx.thud(); tone(90, 0.3, 'square', 0.04, 60);
      } else if (e.type === 'dot') {
        const a = mAnim(e.id), mu = L.dotMult(e.id, e.k); floatText((e.k === 'burn' ? 'Burning' : 'Poisoned') + (mu >= 2 ? ' x2' : mu < 0.5 ? ' (resists)' : ''), e.k === 'burn' ? 'crit' : 'heal', a.x / W, (a.y - 14) / H);
      } else if (e.type === 'poison') {
        const a = mAnim(e.id); if (Math.random() < 0.5) floatText('Poisoned', 'heal', a.x / W, (a.y - 12) / H);
      } else if (e.type === 'shieldup') {
        floatText(e.again ? 'Shield up again!' : 'Shielded! Tap to break it', 'skill', FOE_X, 0.22); tone(660, 0.18, 'sine', 0.04, 880);
        if (!S.stats.shieldSeen) { S.stats.shieldSeen = 1; toast('shield', 'A shielded foe', 'While its shield is up your party deals ' + Math.round(L.SHIELD_CUT * 100) + '% less damage. Tap the foe to knock the shield down (about ' + Math.round(1 / L.SHIELD_TAP) + ' taps). Left alone it wears away in about ' + L.SHIELD_DECAY.foe + ' seconds.', ''); }
      } else if (e.type === 'shieldbreak') {
        floatText('Shield broken!', 'crit', FOE_X, 0.24); burst(foeAnim.cx || W * FOE_X, foeAnim.cy || H * 0.5, 26, ['#bfe6ff', '#ffffff', '#7fb8e8'], 55);
        if (e.tap) sfx.relic(); else tone(330, 0.2, 'sine', 0.04, 220);
      } else if (e.type === 'ward') {
        floatText('Ward', 'skill', FOE_X, 0.3); burst(foeAnim.cx, foeAnim.cy, 18, ['#bfe6ff', '#ffffff', '#7fb8e8'], 35);
      } else if (e.type === 'regionlock') {
        { const t = L.trialOf(S, e.need - 1), key = e.floor + ':' + t.elites; if (lockToast !== key) { lockToast = key; toast('lock', 'Region trial: ' + trialName(e.need - 1), 'To go past floor ' + (e.floor - 1) + ', defeat ' + L.TRIAL_ELITES + ' alliance elites in this region (' + t.elites + '/' + L.TRIAL_ELITES + ' so far) and beat its guardian. Elites are the bannered warband foes.', 'feat'); } }
      } else if (e.type === 'trial') {
        if (e.elites >= L.TRIAL_ELITES) { sfx.relic(); toast('map', 'Region trial complete', e.guardian ? 'Beat ' + trialName(e.region) + '\u2019s guardian once more and the way down opens.' : 'Now beat ' + trialName(e.region) + '\u2019s guardian to open the way down.', 'feat'); }
        else floatText('Trial ' + e.elites + '/' + L.TRIAL_ELITES, 'skill', FOE_X, 0.22);
      } else if (e.type === 'mastery') {
        sfx.relic(); toast('star', 'Region mastery: ' + e.goal.name, (L.BIOMES[e.region] || { name: 'Region' }).name + ': +' + Math.round(L.MASTERY_PER * 100) + '% ' + e.goal.fx + ' and +' + Math.round(L.MASTERY_XP * 100) + '% hero XP for good.' + (L.masteryStars(S, e.region) === 3 ? ' Region fully mastered: +' + Math.round(L.MASTERY_FULL_XP * 100) + '% more hero XP.' : ''), 'feat');
      } else if (e.type === 'sealed') {
        if (!sealedToast) { sealedToast = true; toast('lock', 'The way is sealed', 'Act One ends here. The Rift Threshold opens again with Season 2 of the Grand War. Your party holds the landing and keeps earning.', 'feat'); }
      } else if (e.type === 'revive') {
        const a = mAnim(e.id); floatText('Back up', 'heal', a.x / W, (a.y - 10) / H);
      } else if (e.type === 'ability') {
        const a = mAnim(e.id), ab = L.CLASSES[e.cls].ability;
        floatText(e.name || ab.name, 'skill', a.x / W, (a.y - 14) / H);
        if (e.dmg) floatText(fmt(e.dmg), 'crit', FOE_X, 0.38);
        if (e.cls === 'healer') burst(a.x, a.y, 16, ['#9be87a', '#d6ffc2'], 30);
        tone(440, 0.12, 'triangle', 0.035, 880);
      } else if (e.type === 'kill') {
        kills++; gold += e.gold;
        const f = e.foe, spr = sprite(f.sprite, f.chest ? 0 : f.hue, true);
        foeAnim.dying = { spr, t: tAnim, x: foeAnim.cx - foeAnim.w / 2, y: foeAnim.cy - foeAnim.h / 2, w: foeAnim.w, h: foeAnim.h };
        burst(foeAnim.cx, foeAnim.cy, f.boss ? 50 : f.chest ? 40 : 14, f.chest || f.boss ? ['#f2c14e', '#fff0a0', '#c8952a'] : ['#f2c14e', '#fff0a0', '#9b8a70'], f.boss ? 70 : 45);
        if (f.boss) { sfx.boss(); if (e.first && !(S.maxFloor % 10 === 0 && L.regionNeed(S, S.maxFloor + 1))) toast('crown', f.name + ' defeated', 'The way down is open.', ''); }
      } else if (e.type === 'loot') {
        const it = e.item;
        if (it.rar !== 'common') { toast('gear-trinket', L.gearName(it), L.RARITY.find(r => r.id === it.rar).name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' for a ' + L.CLASSES[it.cls].name, 'loot ' + it.rar); sfx.relic(); }
        floatText(L.gearName(it), 'skill', FOE_X, 0.2);
      } else if (e.type === 'rset') {
        const it = e.item, rs = L.REGION_SETS[it.rset];
        sfx.relic(); floatText(L.gearName(it), 'skill', FOE_X, 0.2);
        toast('gear-trinket', L.gearName(it), 'A piece of ' + rs.name + ', the ' + L.BIOMES[it.rset].name + ' region set, for a ' + L.CLASSES[it.cls].name + '.', 'loot set');
      } else if (e.type === 'goblinsack') {
        sfx.boss(); floatText('Loot Goblin’s Sack!', 'crit', FOE_X, 0.15);
        toast('bag', 'The Loot Goblin’s Sack!', 'One of the rarest finds in the Deep: +' + Math.round(L.GOBLIN_SACK_GOLD * 100) + '% gold for your whole party while worn. It is in your pack.', 'loot goblin');
        bragSack(e.item);
      } else if (e.type === 'sigil') {
        sfx.relic(); floatText('+' + e.n + ' Sigils', 'skill', FOE_X, 0.15);
        toast('star', 'Sigils found!', (e.chest ? 'A chest' : 'The guardian') + ' held ' + e.n + (e.n === 1 ? ' Sigil' : ' Sigils') + '. ' + (signedIn() ? 'They go straight to your wallet.' : 'Sign in to keep them in your wallet.'), 'relic');
        claimFound();
      } else if (e.type === 'lore') {
        const lo = L.LORE.find(x => x.id === e.id); toast('book', 'New journal entry', lo.title, 'feat');
      } else if (e.type === 'wbend') {
        sendAssault(e.score, e.fell, e.ck, e.iv);
      } else if (e.type === 'goblinflee') {
        sfx.fail(); floatText(e.item ? 'Stolen!' : 'Escaped!', 'crit', 0.5, 0.3);
        if (e.item) toast('bag', e.again ? 'He got away again' : 'The Loot Goblin stole ' + L.gearName(e.item), (e.again ? 'He still has ' + L.gearName(e.item) + ' and' : 'He') + ' fled to floor ' + e.floor + '. Find him there and kill him to get it back.', 'warn');
      } else if (e.type === 'goblinkill') {
        sfx.relic(); floatText(e.item ? 'Got it back!' : 'Goblin slain!', 'skill', FOE_X, 0.2);
        toast('bag', e.item ? 'You got it back' : 'Loot Goblin slain', e.item ? L.gearName(e.item) + ' is back in your pack, and the goblin dropped a fat purse of gold.' : 'It dropped a fat purse of gold. Your pack is safe.', 'feat');
      } else if (e.type === 'mercy') {
        sfx.relic(); floatText(e.kind === 'wounded' ? 'A wounded medic!' : 'A captive medic!', 'skill', 0.5, 0.2);
        if (e.kind === 'wounded') toast('cross', 'A Mercy Corps companion is hurt', esc(e.who) + ' lies wounded on the path. Your healers will mend them; Lantern Hymn and your taps help too. Heal them to full within ' + L.AID_TIME + ' seconds for +' + L.AID_FX.pdps * 100 + '% damage and healing for ' + L.MERCY_MIN + ' minutes.', 'feat');
        else toast('cross', 'A Mercy Corps companion needs rescue', 'This monster is holding ' + esc(e.who) + ' captive. Defeat it to free them: +' + L.RESCUE_FX.xp * 100 + '% hero XP for ' + L.MERCY_MIN + ' minutes.', 'feat');
      } else if (e.type === 'rescued') {
        sfx.relic(); floatText('Rescued!', 'skill', FOE_X, 0.2);
        toast('cross', esc(e.who) + ' is free', 'The Mercy Corps thanks you: +' + L.RESCUE_FX.xp * 100 + '% hero XP for ' + L.MERCY_MIN + ' minutes.', 'feat');
      } else if (e.type === 'aided') {
        sfx.relic(); floatText('Healed!', 'skill', FOE_X, 0.2);
        toast('cross', esc(e.who) + ' is back on their feet', 'Mercy’s Thanks: +' + L.AID_FX.pdps * 100 + '% damage and +' + L.AID_FX.pheal * 100 + '% healing for ' + L.MERCY_MIN + ' minutes.', 'feat');
      } else if (e.type === 'mercyleft') {
        floatText('Carried to safety', 'auto', FOE_X, 0.2);
        toast('cross', 'Other medics carried ' + esc(e.who) + ' to safety', 'They will be fine. Next time, more healing (or a Lantern Hymn and some taps) gets them up in time.', '');
      } else if (e.type === 'bandage') {
        floatText('+' + fmt(e.amt), e.crit ? 'heal crit' : 'heal', FOE_X + (Math.random() - 0.5) * 0.08, 0.4);
      } else if (e.type === 'pack') {
        floatText('Ambush!', 'crit', 0.5, 0.3);
        if (!(S.stats.packs > 0)) toast('sword', 'Ambush!', e.n + ' monsters have teamed up to jump your party. They hit harder and strike the back first, but they pay ' + (e.n * L.PACK_GOLD) + ' times the gold, ' + (e.n * L.PACK_XP) + ' times the hero XP and often drop gear.', 'feat');
      } else if (e.type === 'beast') {
        const lo = L.LORE.find(x => x.id === e.key), nm2 = lo ? lo.title : 'this foe';
        toast('skull', 'Bestiary mastery: ' + nm2 + ' ' + e.tier + '/' + L.BEAST_MAX, '+' + e.tier + '% damage and hero XP against ' + nm2 + '. ' + (e.tier < L.BEAST_MAX ? 'Next step at ' + fmt((e.tier + 1) * L.BEAST_STEP) + ' kills.' : 'Fully mastered.'), 'feat');
      } else if (e.type === 'herolevel') {
        sfx.relic(); floatText('Hero level ' + e.lv + '!', 'crit', 0.5, 0.25);
        toast('star', L.memberById('you').name + ' reached hero level ' + e.lv, (e.pts === 1 ? 'A new stat point' : e.pts + ' new stat points') + ' to spend on the character sheet in the Skills tab.', 'feat');
        if (tab === 'rekindle') updateSkills(); else { const hp = L.heroPoints(S); if (!S.kindling && hp) $('kindcount').textContent = '+' + hp; }
        for (const u of L.newUnlocks(S, e.from || e.lv - 1, e.lv)) toast(u.icon, 'Unlocked: ' + u.name, u.desc, 'feat');
        if (L.ROSTER_LV.includes(e.lv)) toast('flame', 'A bigger campfire', 'Room for ' + L.fireCap(S) + ' at the fire now, plus your party.', 'feat');
        if (L.JOB_SLOT_LV.includes(e.lv) && e.lv > L.JOB_SLOT_LV[0]) toast('hammer', 'A new camp job slot', L.jobSlots(S) + ' camp jobs can be worked at once now.', 'feat');
        paintTabLocks(); if (TAB_FEATURE[tab]) switchTab(tab);
      } else if (e.type === 'relic') {
        sfx.relic();
        toast('relic', e.level > 1 ? e.relic.name + ' grows stronger' : 'Relic found: ' + e.relic.name, e.relic.desc + (e.level > 1 ? ' (level ' + e.level + ')' : ''), 'relic');
      } else if (e.type === 'retry') {
        toast('sword', 'Back to the stair', 'Your party has rested and heads back down.', 'feat');
      } else if (e.type === 'wipe') {
        sfx.fail();
        toast('lock', 'Your party fell', 'They retreated a floor to rest and train, and will try again in a little while. Train your companions or check their gear.', 'warn');
        $('auto').checked = false;
      } else if (e.type === 'bossfail') {
        sfx.fail();
        toast('lock', 'The lantern guttered out', e.name + ' held the stairs. Your party fell back a floor and will try again soon.', 'warn');
        $('auto').checked = false;
      }
    }
    if (kills) pendingGold += gold;
    const tnow = performance.now();
    if (pendingGold > 0 && tnow - lastGoldFloat > 450) {
      floatText('+' + fmt(pendingGold), 'gold', FOE_X, 0.24);
      sfx.coin(); pendingGold = 0; lastGoldFloat = tnow;
    }
    events.length = 0;
  }

  // ---------- toasts / modals ----------
  function toast(ic, title, sub, cls) {
    const t = document.createElement('div');
    t.className = 'toast ' + (cls || '');
    t.innerHTML = icon(ic) + '<div><b></b><small></small></div>';
    t.querySelector('b').textContent = title; t.querySelector('small').textContent = sub || '';
    const box = $('toasts'); box.appendChild(t);
    while (box.children.length > (innerWidth < 560 ? 2 : 3)) box.firstChild.remove();
    t.onclick = () => t.remove();
    // Stays up longer, and waits while the pointer rests on it. Every pop-up is kept in the bell too.
    let left = 7000, at = Date.now(), timer = 0;
    const go = () => { timer = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, left); at = Date.now(); };
    t.onmouseenter = () => { clearTimeout(timer); left = Math.max(1500, left - (Date.now() - at)); };
    t.onmouseleave = go; go();
    noteLog(ic, title, sub, cls);
  }
  // ---------- notifications: the last 50 pop-ups, kept on this device ----------
  var NOTE_KEY = 'lh_notes', notes = [];
  try { notes = JSON.parse(localStorage.getItem(NOTE_KEY) || '[]'); if (!Array.isArray(notes)) notes = []; } catch (e) {}
  function noteLog(ic, title, sub, cls) {
    if (!notes) notes = [];
    notes.push({ ic, title: String(title || ''), sub: String(sub || ''), cls: cls || '', t: Date.now(), n: 1 });
    if (notes.length > 120) notes = notes.slice(-120);
    try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); } catch (e) {}
    paintNoteDot();
  }
  function paintNoteDot() {
    const d = $('notedot'); if (!d) return;
    const n = notes.filter(x => x.n).length; d.hidden = !n; d.textContent = n > 9 ? '9+' : n || '';
    $('btn-notes').setAttribute('aria-label', n ? 'Notifications, ' + n + ' new' : 'Notifications');
  }
  const agoText = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
  // Bell categories (John, 2026-11-24): tabs so players can read just the log they want. Worked out from the
  // pop-up's icon, style and title, so notes saved before this change sort into tabs too.
  const NOTE_CATS = [['all', 'All'], ['loot', 'Loot'], ['fight', 'Fights'], ['prog', 'Progress'], ['players', 'Players'], ['other', 'Other']];
  function noteCat(x) {
    const ic = x.ic || '', c = x.cls || '', t = (x.title + ' ' + x.sub).toLowerCase();
    if (/loot|relic/.test(c) || /^(bag|gear-|relic)/.test(ic) || /sigils? found|loot goblin|sack/.test(t)) return 'loot';
    if (/^(user|users|chat|coin)$/.test(ic) || /whisper|guild|market|trade|sold|bought|listing|duel|ember ring|pvp|recruit|friend|player/.test(t)) return 'players';
    if (/^(sword|crown|skull|shield|cross|oil|lamp|flare)$/.test(ic) || /fell|fallen|ambush|guardian|defeated|special attack|lantern|wipe|retreat|nexus|back to the stair/.test(t)) return 'fight';
    if (/feat/.test(c) || /^(star|map|flame|hammer|book)$/.test(ic) || /level|unlocked|journal|trial|mastery|chapter|campfire|camp job/.test(t)) return 'prog';
    return 'other';
  }
  let noteTab = 'all';
  try { noteTab = localStorage.getItem('lh_notetab') || 'all'; } catch (e) {}
  function openBell() {
    const all = notes.slice().reverse().map(x => Object.assign({ cat: noteCat(x) }, x));
    const count = k => k === 'all' ? all.length : all.filter(x => x.cat === k).length;
    if (noteTab !== 'all' && !count(noteTab)) noteTab = 'all';
    const tabs = () => '<div class="notetabs" role="tablist">' + NOTE_CATS.filter(([k]) => k === 'all' || count(k)).map(([k, n]) => '<button role="tab" data-ntab="' + k + '" aria-selected="' + (k === noteTab) + '" class="' + (k === noteTab ? 'on' : '') + '">' + n + ' <i>' + count(k) + '</i>' + (all.some(x => x.n && (k === 'all' || x.cat === k)) ? '<em></em>' : '') + '</button>').join('') + '</div>';
    const rows = () => { const list = all.filter(x => noteTab === 'all' || x.cat === noteTab); return list.length ? '<ul class="notelist">' + list.map(x => '<li class="toast ' + esc(x.cls) + (x.n ? ' new' : '') + '">' + icon(x.ic) + '<div><b>' + esc(x.title) + '</b>' + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '<time>' + agoText(x.t) + '</time></div></li>').join('') + '</ul>' : '<p>Nothing yet. Pop-ups from the corner of the screen are kept here so you can read them again.</p>'; };
    modal('<h2>Notifications</h2>' + (all.length ? tabs() : '') + '<div id="nt-rows">' + rows() + '</div>' +
      '<div class="row">' + (all.length ? '<button class="btn ghost" id="nt-clear">Clear all</button>' : '') + '<button class="btn" id="nt-x">Close</button></div>', md => {
      md.querySelector('#nt-x').onclick = closeModal;
      const c = md.querySelector('#nt-clear'); if (c) c.onclick = () => { notes = []; try { localStorage.removeItem(NOTE_KEY); } catch (e) {} closeModal(); paintNoteDot(); };
      md.addEventListener('click', e => {
        const b = e.target.closest('[data-ntab]'); if (!b) return;
        noteTab = b.dataset.ntab; try { localStorage.setItem('lh_notetab', noteTab); } catch (x) {}
        md.querySelectorAll('[data-ntab]').forEach(t => { const on = t.dataset.ntab === noteTab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
        md.querySelector('#nt-rows').innerHTML = rows();
      });
    });
    notes.forEach(x => { x.n = 0; }); try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); } catch (e) {} paintNoteDot();
  }
  function modal(html, onMount) {
    $('modalbody').className = 'sheet'; $('modalbody').innerHTML = html; $('modal').hidden = false;
    onMount && onMount($('modalbody'));
  }
  function closeModal() {
    $('modal').hidden = true;
    // No hero yet (first visit): closing any other window returns to hero creation, unless a sign-in is
    // fetching the account's save, which then loads that hero or reopens creation itself.
    if (!S.hero) setTimeout(() => { if (!S.hero && $('modal').hidden && !(typeof signedIn === 'function' && signedIn())) setup(); }, 60);
  }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('modal').dataset.lock) closeModal(); });

  // ---------- panel: party ----------
  const seatLeft = {};
  function sendOff(i, id, title, text) { seatLeft[i] = L.memberById(id).name; try { leaveArena(id); } catch (e) {} toast('flame', title, text, ''); }
  // ---------- camp: party changes happen at the top of the stair ----------
  // camp(): any camp, where gear can change (main camp or a Draught). mainCamp(): floor 1, where everything can change.
  const camp = () => L.atCamp(S, Date.now());
  const mainCamp = () => L.atMainCamp(S);
  function campGate(full) { if (full ? mainCamp() : camp()) return true; campModal(full); return false; }
  // ---------- pacing v2: features open by hero level (John, 2026-11-23) ----------
  const TAB_FEATURE = { camp: 'camp', gear: 'gear', market: 'buy', guild: 'guild', ring: 'ring' };
  const heroName = () => (L.memberById('you') || { name: 'Your hero' }).name;
  function lockMsg(id) { const u = L.unlockOf(id); return u.name + ' opens at hero level ' + u.lv + '. ' + heroName() + ' is hero level ' + L.heroLv(S) + '.'; }
  function gateUse(id) { if (L.canUse(S, id)) return true; const u = L.unlockOf(id); toast('lock', u.name + ' is still locked', lockMsg(id) + ' Your hero earns XP from every fight.', 'warn'); return false; }
  function paintTabLocks() { document.querySelectorAll('.tabs [data-tab]').forEach(b => { const f = TAB_FEATURE[b.dataset.tab]; b.classList.toggle('locked', !!(f && S.hero && !L.canUse(S, f))); }); }
  // The road ahead: every level-gated feature, the next region and the campfire, in one card.
  function roadHtml(focus) {
    const hl = L.heroLevel(S), lv = hl.lv, pct = Math.floor(hl.xp / hl.need * 100);
    const curR = L.regionNo(S.maxFloorEver), tr = curR < L.REGIONS - 1 && L.regionNeed(S, (curR + 1) * 10 + 1) ? L.trialOf(S, curR) : null;
    const fu = focus && L.unlockOf(focus);
    let h = '<div class="road">' + (fu ? '<div class="roadlock">' + icon('lock') + '<div><b>' + esc(fu.name) + ' opens at hero level ' + fu.lv + '</b><small>' + esc(fu.desc) + ' Your hero earns XP from every fight, and more from deeper floors and guardians.</small></div></div>' : '') +
      '<div class="roadhead"><div><h3>The road ahead</h3><small>' + esc(heroName()) + ' is hero level <b>' + lv + '</b> &middot; ' + pct + '% to level ' + (lv + 1) + '</small></div></div>' +
      '<div class="bar roadxp"><i style="width:' + pct + '%"></i></div><ul class="roadlist">' +
      L.UNLOCKS.map(u => { const on = L.canUse(S, u.id); return '<li class="' + (on ? 'open' : '') + (u.id === focus ? ' focus' : '') + '"><span class="ric">' + icon(on ? u.icon : 'lock') + '</span><div><b>' + esc(u.name) + '</b><small>' + esc(u.desc) + '</small></div><em>' + (on ? 'Open' : 'Hero level ' + u.lv) + '</em></li>'; }).join('') +
      '</ul>' + (tr ? '<div class="roadlock">' + icon('map') + '<div><b>Region trial: ' + esc(trialName(curR)) + '</b><small>To reach floors ' + ((curR + 1) * 10 + 1) + ' and deeper: defeat ' + L.TRIAL_ELITES + ' alliance elites here (' + tr.elites + '/' + L.TRIAL_ELITES + ') and beat the guardian on floor ' + ((curR + 1) * 10) + (tr.guardian ? ' (done)' : '') + '.</small></div></div>' : '') +
      '<p class="note small">' +
      'Your campfire holds ' + L.fireCap(S) + ' companions now, not counting your party; it grows at hero levels ' + L.ROSTER_LV.join(', ') + '. Camp job slots open at levels ' + L.JOB_SLOT_LV.join(', ') + '.</p></div>';
    return h;
  }
  const trialName = r => (L.BIOMES[r] || { name: 'Region ' + (r + 1) }).name;
  // Region mastery: three goals in each region you have reached.
  function masteryHtml() {
    const top = Math.min(L.REGIONS, Math.max(1, Math.ceil(S.maxFloorEver / 10)));
    let h = '<div class="mastery"><h3 class="sub">Region mastery</h3><p class="note small">Each region has three goals. Every one you finish gives +' + Math.round(L.MASTERY_PER * 100) + '% to its stat for good: ' + L.MASTERY.map(g => g.name.toLowerCase() + ' to ' + g.fx).join(', ') + '. Every goal also adds +' + Math.round(L.MASTERY_XP * 100) + '% hero XP, and a region with all three adds +' + Math.round(L.MASTERY_FULL_XP * 100) + '% more.</p><div class="mlist">';
    for (let r = 0; r < top; r++) {
      const v = (S.mast || {})[r] || 0, el = Math.min(L.MASTERY_ELITES, (S.mastE || {})[r] || 0), b = L.BIOMES[r] || { name: 'Region ' + (r + 1) };
      h += '<div class="mrow"><div class="mname"><b>' + esc(b.name) + '</b><small>Floors ' + (r * 10 + 1) + '-' + (r * 10 + 10) + '</small></div><div class="mgoals">' +
        L.MASTERY.map(g => '<span class="mg' + (v & g.bit ? ' done' : '') + '" data-tip="' + esc(g.desc + ': +' + Math.round(L.MASTERY_PER * 100) + '% ' + g.fx) + '">' + icon(v & g.bit ? 'star' : 'lock') + esc(g.name) + (g.bit === 2 && !(v & 2) ? ' ' + el + '/' + L.MASTERY_ELITES : '') + '</span>').join('') + '</div><em>' + L.masteryStars(S, r) + '/3</em></div>';
    }
    return h + '</div><p class="note small">Totals: +' + Math.round(L.masteryVal(S, 'dps') * 100) + '% damage, +' + Math.round(L.masteryVal(S, 'hp') * 100) + '% health, +' + Math.round(L.masteryVal(S, 'gold') * 100) + '% gold, +' + Math.round(L.masteryXp(S) * 100) + '% hero XP.</p></div>';
  }
  // A story companion arrives at a full campfire: keep them by dismissing someone for good, add a spot with Sigils, or turn them away.
  let recruitOpen = false;
  function openRecruit(confirmId) {
    const id = S.pendingJoin; if (!id) return;
    const nm = L.memberById(id); recruitOpen = true; $('modal').dataset.lock = '1';
    const list = L.companions(S), ups = S.rosterUps || 0, canBuy = ups < L.ROSTER_BUY_MAX;
    const done = () => { delete $('modal').dataset.lock; recruitOpen = false; closeModal(); save(); try { pushCloud(true); } catch (e) {} updateSeats(true); updateAbilities(true); };
    if (confirmId) {
      const m = L.memberById(confirmId);
      modal('<div class="center"><h2>Dismiss ' + esc(m.name) + ' for good?</h2><p>' + esc(m.name) + ' leaves the Hold and never comes back. Their levels and job go with them; gear they wore returns to your pack. ' + esc(nm.name) + ' takes their place at the fire.</p>' +
        '<div class="row"><button class="btn ghost" id="rc-back">Go back</button><button class="btn danger" id="rc-yes">Dismiss ' + esc(m.name) + '</button></div></div>', md => {
          md.querySelector('#rc-back').onclick = () => openRecruit();
          md.querySelector('#rc-yes').onclick = () => { if (L.acceptRecruit(S, confirmId)) { sfx.relic(); toast(CLASS_ICON[nm.cls] || 'users', nm.name + ' joins you', m.name + ' has left the Hold for good.', 'feat'); } done(); };
        });
      return;
    }
    modal('<div class="maphead"><div><h2>' + esc(nm.name) + ' wants to join</h2><small>' + esc(nm.title) + ' &middot; ' + L.CLASSES[nm.cls].name + '. You have ' + list.length + ' of ' + L.rosterCap(S) + ' companions: ' + L.PARTY_SEATS + ' party seats plus ' + L.fireCap(S) + ' at the fire.</small></div></div>' +
      '<p>' + esc(nm.line || nm.bio || '') + '</p><p class="note">To keep ' + esc(nm.name) + ', dismiss someone for good, or add a spot at the fire. If you turn ' + esc(nm.name) + ' away, they will not ask again.</p>' +
      '<div class="choice">' + list.map(c => { const m = L.memberById(c); return '<button class="pick jpick rdis" data-rdis="' + c + '"><img src="' + SP.spriteURL(m.cls, 2, lookHue(m)) + '" alt=""><b>' + esc(m.name) + '</b><small>Power level ' + L.lvl(S, c) + ' ' + L.CLASSES[m.cls].name + (S.party.includes(c) ? ' &middot; in your party' : '') + '</small><em>Dismiss</em></button>'; }).join('') + '</div>' +
      '<div class="row">' + (canBuy ? '<button class="btn" id="rc-buy">' + sigil + ' Add a spot: ' + fmt(L.ROSTER_COST) + ' ' + TOKEN + '</button>' : '') + '<button class="btn ghost" id="rc-no">Turn ' + esc(nm.name) + ' away</button></div>', md => {
        md.className = 'sheet wide';
        md.querySelectorAll('[data-rdis]').forEach(b => b.onclick = () => openRecruit(b.dataset.rdis));
        md.querySelector('#rc-no').onclick = () => { L.declineRecruit(S); toast('flame', nm.name + ' goes their own way', 'Your campfire stays as it is.', ''); done(); };
        const by = md.querySelector('#rc-buy'); if (by) by.onclick = async () => { if (await buyRosterSpot()) { L.acceptRecruit(S); sfx.relic(); toast(CLASS_ICON[nm.cls] || 'users', nm.name + ' joins you', 'A new spot by the fire.', 'feat'); done(); } };
      });
  }
  // A campfire spot is a one-time Sigil purchase kept on your account (the wardrobe's owned items r.a, r.b, r.c).
  const rosterOwned = own => L.ROSTER_ITEMS.filter(k => (own || []).includes(k)).length;
  function syncRoster(own) { const n = rosterOwned(own); if (n !== (S.rosterUps || 0)) { S.rosterUps = n; save(); updateSeats(true); } }
  async function buyRosterSpot() {
    if (!CL || !signedIn()) { toast('lock', 'Sign in first', 'Campfire spots are bought with ' + TOKEN + ' on your account.', 'warn'); return false; }
    const k = L.ROSTER_ITEMS[S.rosterUps || 0]; if (!k) return false;
    try {
      const r = await papi('POST', '/wardrobe', { buy: k });
      if (prof) { prof.bal = r.bal; prof.own = r.own; } syncRoster(r.own); updatePanel(true); return true;
    } catch (e) { toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '. You need ' + fmt(L.ROSTER_COST) + '.' : e.code === 'owned' ? 'Try again in a moment.' : 'Try again in a moment.', 'warn'); return false; }
  }
  // Where Descend takes you: the top of the region you climbed up from.
  const backTo = () => Math.min(S.maxFloor, L.regionTop(S.campReturn || S.maxFloor));
  const downLabel = () => backTo() > 1 ? 'Descend to floor ' + backTo() : 'Start fighting';
  function goCamp() {
    S.campReturn = Math.max(S.campReturn || 0, S.floor);
    L.gotoFloor(S, L.CAMP_FLOOR); S.autoAdvance = false; $('auto').checked = false;
    closeModal(); save(); updateStage(); updatePanel(true); sfx.buy();
    toast('flame', 'Back at the main camp', 'Swap companions, recruit, train and gear up. Descend takes you to floor ' + backTo() + ', the top of the region you left.', 'feat');
  }
  function descend() {
    const f = backTo();
    L.gotoFloor(S, f); S.autoAdvance = true; $('auto').checked = true; S.campReturn = 0;
    save(); updateStage(); updatePanel(true);
    toast('map', 'Down to floor ' + f, L.biomeOf(f).name + '. The party fights its way back down from here.', '');
  }
  function drinkDraught() {
    if (!L.useDraught(S, Date.now())) { openStore(); return; }
    closeModal(); sfx.relic(); save(); updatePanel(true);
    toast('flame', 'You make a field camp', 'For ' + Math.round(L.campLeft(S, Date.now())) + ' seconds the party rests and you can change their gear right here, then carry on from floor ' + S.floor + '.', 'feat');
  }
  function campModal(full) {
    const n = (S.items && S.items.draught) || 0, back = Math.min(S.maxFloor, L.regionTop(Math.max(S.campReturn || 0, S.floor)));
    modal('<div class="center"><div class="campfire-ic">' + icon('flame') + '</div><h2>' + (full ? 'That needs the main camp' : 'That happens at camp') + '</h2><p>' + (full ? 'Swapping companions, recruiting players and training companions resting by the fire happen at the main camp on floor 1.' : 'Changing gear happens at camp. A Campfire Draught makes a field camp right here, so you keep your place.') + '</p></div>' +
      '<div class="choice"><button class="pick" id="c-go"><b>Return to the main camp</b><small>Do everything there. When you head back down you start at floor ' + back + ', the top of this region.</small></button>' +
      (full ? '' : '<button class="pick" id="c-drink"' + (n ? '' : ' disabled') + '><b>Drink a Campfire Draught (' + n + ' left)</b><small>Change your party\'s gear here for 60 seconds and carry on from floor ' + S.floor + '.</small></button>') +
      '<button class="pick" id="c-store"><b>Visit the store</b><small>Buy Campfire Draughts and Lantern Oil.</small></button></div>' +
      '<div class="row"><button class="btn ghost" id="c-x">Not now</button></div>', md => {
        md.querySelector('#c-go').onclick = goCamp; const dr = md.querySelector('#c-drink'); if (dr) dr.onclick = drinkDraught;
        md.querySelector('#c-store').onclick = openStore; md.querySelector('#c-x').onclick = closeModal;
      });
  }
  // The camp card (v102): what this place is, one main action, then a row with the Hold's tents.
  function campBarHtml() {
    const n = (S.items && S.items.draught) || 0, left = L.campLeft(S, Date.now());
    const tent = (k, img, label, tip, extra) => '<button data-camp="' + k + '" data-tip="' + tip + '"' + (extra || '') + '>' + (img ? '<img src="' + SP.spriteURL(img, 2, 0) + '" alt="">' : '') + '<span>' + label + '</span></button>';
    const row = draught => '<div class="cbseg">' + tent('ench', 'enchanter', 'Enchanter', 'Enchant and disenchant gear. You come back to this floor when you leave.') + tent('arm', 'armorer', 'Armorer', 'Upgrade, merge, or melt gear for gold. You come back to this floor when you leave.') +
      tent('store', '', icon('coin') + 'Store', 'Draughts, lantern oil and tonics.') + (draught ? tent('drink', '', icon('flame') + 'Draught · ' + n, n ? 'Change gear here for 60 seconds and keep your floor.' : 'No Draughts left. Buy more in the Store.', n ? '' : ' disabled') : '') + '</div>';
    if (S.floor <= L.CAMP_FLOOR) return '<div class="campbar on"><div class="cbtop"><span class="cb-ic">' + icon('flame') + '</span><div><b>Main camp</b><small>Everything can change here</small></div></div>' + (S.maxFloor > 1 || S.campReturn ? '<button class="btn cbmain" data-camp="down" data-tip="Head back down. You start at the top of the region you left.">' + downLabel() + '</button>' : '') + row(false) + '</div>';
    if (left > 0) return '<div class="campbar on"><div class="cbtop"><span class="cb-ic">' + icon('flame') + '</span><div><b>Field camp · ' + Math.ceil(left) + 's</b><small>Change gear, then carry on</small></div></div>' + row(false) + '</div>';
    const top = Math.min(S.maxFloor, L.regionTop(S.floor));
    return '<div class="campbar"><div class="cbtop"><span class="cb-ic">' + icon('lock') + '</span><div><b>In the Deep · floor ' + S.floor + '</b><small>Gear changes need a camp ' + tipI('A Campfire Draught makes a field camp right here and keeps your floor. The main camp lets you change everything, but you restart at floor ' + top + ', the top of this region.') + '</small></div></div>' +
      '<button class="btn cbmain" data-camp="go" data-tip="Change everything at the main camp. You restart at floor ' + top + '.">' + icon('flame') + 'Return to camp</button>' + row(true) + '</div>';
  }
  // Sub-views keep the Gear and Skills tabs short: one thing at a time.
  const subView = (tabId, key, def) => {
    let v = def; try { v = localStorage.getItem(key) || def; } catch (e) {}
    const box = $(tabId), seg = box && box.querySelector('.subseg'); if (!seg) return;
    const set = x => { v = x; box.dataset.view = x; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === x)); try { localStorage.setItem(key, x); } catch (e) {} };
    seg.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) set(b.dataset.v); });
    set(v);
  };
  subView('tab-gear', 'lh_gearv', 'kit'); subView('tab-rekindle', 'lh_skillv', 'stats');
  let campWas = null;
  function paintCamp() {
    paintEnchOv();
    const h = campBarHtml();
    for (const id of ['campbar', 'campbar2', 'gearcamp']) { const el = $(id); if (el && el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; } }
    const c = camp(), cw = c + '|' + mainCamp(); if (campWas !== null && cw !== campWas) { campWas = cw; updateSeats(true); paintBoard(); updateGear(true); } campWas = cw;
    document.body.classList.toggle('incamp', mainCamp()); document.body.classList.toggle('gearok', c);
    const rc = $('restcard');
    if (rc) {
      const left = L.campLeft(S, Date.now());
      const r = left > 0 && S.floor > L.CAMP_FLOOR ? '<div><b>Resting by the fire, ' + Math.ceil(left) + 's</b><small>The party heals up. The fight waits until the draught burns out.</small></div>'
        : '<div><b>Resting at camp</b><small>The party heals by the fire. Nobody fights while you rest.</small></div>' + (S.maxFloor > 1 || S.campReturn ? '<button class="btn small" data-camp="down">' + downLabel() + '</button>' : '');
      if (rc.dataset.h !== r) { rc.innerHTML = r; rc.dataset.h = r; }
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-camp]'); if (!b) return;
    const a = b.dataset.camp;
    // leaving for camp, heading down or drinking a draught ends a shop visit first (v104)
    if (L.visiting(S) && (a === 'go' || a === 'down' || a === 'drink')) { L.leaveEnchanter(S); particles.length = 0; ewReset('on'); awReset('up'); paintEnchOv(); updatePanel(true); }
    if (a === 'go') goCamp(); else if (a === 'ench') enchanterModal(); else if (a === 'arm') armorerModal(); else if (a === 'hold') openHold(); else if (a === 'down') descend(); else if (a === 'drink') drinkDraught(); else if (a === 'store') openStore(); else campModal();
  });
  setInterval(paintCamp, 500);

  // ---------- store: supplies and tonics, for gold or Sigils ----------
  let qmBusy = false;
  // v107 (John: "make the store the same setup as the armorer and enchanter"): the Store is a shop you visit. Old Thessaly
  // stands behind the counter and her wares are listed in the counter panel under tabs. The old window remains only for
  // a player without a hero yet.
  function openStore() { if (S.hero && visitEnch('store')) { paintEnchPanel(true); return; } openStoreModal(); }
  const refreshStore = () => { if (L.visiting(S) && shopKind() === 'store') paintEnchPanel(true); else if (!$('modal').hidden && $('modalbody').querySelector('#st-x')) openStoreModal(); };
  function storeRow(it, now) {
      const p = L.shopPrice(S, it.id), have = (S.items && S.items[it.id]) || 0, sg = L.ITEM_SIGILS[it.id], t = L.tonicById(it.id), left = t ? L.tonicLeft(S, it.id, now) : 0;
      const full = t && left + t.min * 60 > L.TONIC_CAP + 1;
      return '<div class="trow"><div class="tile r-' + (t ? 'fine' : it.id === 'draught' ? 'epic' : 'rare') + '">' + icon(it.icon) + '</div><div class="tinfo"><b>' + it.name + '</b><small>' + it.desc + '</small><small>You have ' + have + '.' + (left ? ' <span class="tleft">Active, ' + fmtTime(left) + ' left</span>' : '') + '</small></div>' +
        '<div class="tact">' + (t && have ? '<button class="btn small" data-drink="' + it.id + '"' + (full ? ' disabled title="Already at the 60 minute limit"' : '') + '>Drink</button>' : '') +
        '<button class="btn small ghost" data-buy="' + it.id + '"' + (p > S.gold ? ' disabled' : '') + '>' + icon('coin') + fmt(p) + '</button>' +
        (sg && CL && signedIn() ? '<button class="btn small ghost sigbuy" data-sbuy="' + it.id + '"' + (typeof prof !== 'undefined' && prof && prof.bal < sg ? ' disabled' : '') + '>' + sigil + sg + '</button>' : '') + '</div></div>';
  }
  function openStoreModal() {
    const now = Date.now(), row = it => storeRow(it, now);
    const sup = L.SHOP.filter(x => !L.tonicById(x.id)), ton = L.TONICS;
    const bal = typeof prof !== 'undefined' && prof ? '<span class="stbal">' + sigil + fmt(prof.bal) + ' ' + TOKEN + '</span>' : '';
    modal('<div class="maphead"><div><h2>The Quartermaster</h2><small>Old Thessaly keeps a stall by the campfire. Everything costs gold. Speed-ups can also be bought with ' + TOKEN + '.</small></div>' + bal + '<button class="iconbtn" id="st-x" aria-label="Close">&times;</button></div>' +
      '<h3 class="sub">Tonics</h3><div class="tlist store">' + ton.map(row).join('') + '</div>' +
      '<p class="note small">Each tonic is a small boost for a short time. Different tonics stack, and drinking the same one again adds time, up to 60 minutes.</p>' +
      '<h3 class="sub">Supplies</h3><div class="tlist store">' + sup.map(row).join('') + '</div>' +
      (wardOn() ? '<button class="wardad" id="st-ward"><span class="wafigs">' + ['ember', 'rift', 'sworn'].map((o, i) => '<img src="' + SP.spriteURL(['tank', 'mage', 'rogue'][i], 2, '0~' + o) + '" alt="">').join('') + '<img class="lamp" src="' + SP.spriteURL('lantern', 2, '0~soul') + '" alt=""></span><span class="watext"><b>The Wardrobe</b><small>Outfits for every hero and new lanterns for the party. Looks only, bought with ' + TOKEN + '.</small></span></button>' : '') +
      '<p class="note small">Gold prices follow how much gold you earn. Use a Campfire Draught from the camp bar in the Party or Gear tab. Lantern Oil appears under the lantern during guardian fights.</p>', md => {
        md.className = 'sheet wide';
        md.querySelector('#st-x').onclick = closeModal; const sw = md.querySelector('#st-ward'); if (sw) sw.onclick = () => openWardrobe('k');
        md.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { if (L.buyShop(S, b.dataset.buy, 1)) { sfx.coin(); save(); openStoreModal(); paintCamp(); paintTonics(); } });
        md.querySelectorAll('[data-drink]').forEach(b => b.onclick = () => drink(b.dataset.drink));
        md.querySelectorAll('[data-sbuy]').forEach(b => b.onclick = async () => {
          if (qmBusy) return; qmBusy = true; b.disabled = true;
          const id = b.dataset.sbuy;
          try { const r = await papi('POST', '/store/pass', { what: 'item', id, n: 1 }); prof.bal = r.bal; S.items[id] = (S.items[id] || 0) + 1; save(); try { pushCloud(true); } catch (e) {} sfx.buy(); openStoreModal(); paintCamp(); paintTonics(); }
          catch (e) { b.disabled = false; toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : 'Try again in a moment.', 'warn'); }
          qmBusy = false;
        });
      });
    if (CL && signedIn() && typeof prof !== 'undefined' && !prof) loadProfile().then(() => { if (!$('modal').hidden && $('modalbody').querySelector('#st-x')) openStoreModal(); });
  }
  function drink(id, fromStore) {
    const t = L.tonicById(id);
    if (!L.drinkTonic(S, id, Date.now())) { if ((S.items[id] || 0) > 0 && L.tonicLeft(S, id) > 0) toast(t.icon, t.name + ' is nearly full', 'A tonic can stack up to 60 minutes. Drink another when it runs lower.', 'warn'); return; }
    sfx.relic(); save(); toast(t.icon, t.name, t.desc.replace(/ for .*$/, '') + ' for ' + fmtTime(L.tonicLeft(S, id)) + '.', 'feat');
    refreshStore(); paintTonics();
  }
  // Active tonics show as small timers above the ability bar; tap one you carry to drink it again.
  let tonicKey = '';
  function paintTonics() {
    const now = Date.now(), box = $('tonicbar');
    const act = L.TONICS.filter(t => L.tonicLeft(S, t.id, now) > 0), carry = L.TONICS.filter(t => !L.tonicLeft(S, t.id, now) && (S.items[t.id] || 0) > 0);
    const mer = [L.mercyXpOn(S, now) && ['mx', 'Mercy rescue: +' + L.RESCUE_FX.xp * 100 + '% hero XP', S.mercyXp], L.mercyAidOn(S, now) && ['ma', 'Mercy’s Thanks: +' + L.AID_FX.pdps * 100 + '% damage and healing', S.mercyAid]].filter(Boolean);
    const key = act.map(t => t.id + (S.items[t.id] || 0)).join() + '|' + carry.map(t => t.id + S.items[t.id]).join() + '|' + mer.map(m => m[0]).join();
    box.hidden = !act.length && !carry.length && !mer.length;
    if (key !== tonicKey) {
      tonicKey = key;
      // An active tonic still shows how many more you carry, so a stack never seems to vanish when you drink one.
      box.innerHTML = act.map(t => '<button class="tonic on" data-tonic="' + t.id + '" title="' + esc(t.name + ': ' + t.desc) + ((S.items[t.id] || 0) > 0 ? ' Tap to drink another and add time (' + S.items[t.id] + ' left).' : '') + '">' + icon(t.icon) + '<span></span>' + ((S.items[t.id] || 0) > 0 ? '<i class="tcount">&times;' + S.items[t.id] + '</i>' : '') + '</button>').join('') +
        carry.map(t => '<button class="tonic" data-tonic="' + t.id + '" title="Drink ' + esc(t.name) + ': ' + esc(t.desc) + '">' + icon(t.icon) + '<span>&times;' + S.items[t.id] + '</span></button>').join('') +
        mer.map(m => '<span class="tonic mercy on" data-mer="' + m[0] + '" title="' + esc(m[1]) + '">' + icon('cross') + '<span></span></span>').join('');
    }
    box.querySelectorAll('.tonic.on').forEach(b => { const m = b.dataset.mer && mer.find(x => x[0] === b.dataset.mer); b.querySelector('span').textContent = fmtTime(m ? Math.max(0, (m[2] - now) / 1000) : L.tonicLeft(S, b.dataset.tonic, now)); });
  }
  $('tonicbar').addEventListener('click', e => { const b = e.target.closest('[data-tonic]'); if (b) drink(b.dataset.tonic); });
  setInterval(paintTonics, 1000);

  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const buyN = () => S.settings.buy === 'max' ? 'max' : +S.settings.buy;
  function classTag(cls) { return '<span class="ctag c-' + cls + '">' + L.CLASSES[cls].name + '</span>'; }
  function portrait(id) {
    const m = L.memberById(id);
    return '<div class="ic c-' + m.cls + (m.player ? ' player' : '') + '" data-prof="' + id + '" role="button" tabindex="0" title="About ' + esc(m.name) + '"><img src="' + SP.spriteURL(m.cls, 2, lookHue(m)) + '" alt=""></div>';
  }
  function memberStatsLine(id, now) {
    const m = L.memberById(id), L_ = L.lvl(S, id);
    const parts = ['Power level <b>' + L_ + '</b>'];
    if (m.cls === 'healer') parts.push(fmt(L.healPerSec(S, id)) + ' heal/s');
    parts.push(fmt(L.memberDps(S, id, now) || 0) + ' dmg/s');
    parts.push(fmt(L.maxHpOf(S, id)) + ' hp');
    return parts.join(' &middot; ');
  }

  let seatsHtml = '', seatsAt = 0;
  function paintHp() {
    document.querySelectorAll('#seats [data-hp]').forEach(i => { const id = i.dataset.hp; i.style.width = Math.max(0, (S.hp[id] || 0) / L.maxHpOf(S, id) * 100) + '%'; });
    document.querySelectorAll('#seats [data-res]').forEach(i => { const id = i.dataset.res; i.style.width = (L.resOf(S, id) / L.RES_MAX * 100) + '%'; i.parentNode.classList.toggle('dry', L.oom(S, id)); });
  }
  // Companion traits: position, kinship and camp. Working ones glow.
  function traitChips(id, compact) {
    const st = L.traitState(S, id); if (!st) return '';
    const t = st.t, chip = (kind, on) => { const x = L.traitText(kind, t[kind]), w = kind === 'pos' ? L.POS_NAME[t.pos.at].toLowerCase() + ' seat' : kind === 'kin' ? 'with a ' + L.CLASSES[t.kin.cls].name.toLowerCase() : 'at camp';
      const tip = x.name + ' (' + x.grade + '). ' + x.fx + ' ' + w + '.' + (on ? ' Working now.' : ' Not working right now.');
      // In the marching order only a working trait shows its effect; the others are just a name, with details on hover or tap.
      if (compact === 'seat') return '<span class="trait g' + t[kind].g + (on ? ' on' : ' off') + '" data-tip="' + esc(tip) + '" tabindex="0"><b>' + esc(x.name) + '</b>' + (on ? ' ' + esc(x.fx) : '') + '</span>';
      return '<span class="trait g' + t[kind].g + (on ? ' on' : '') + '" title="' + esc(x.name + ' (' + x.grade + '). ' + x.when + ': ' + x.fx + '.') + '">' + (compact ? '<b>' + esc(x.name) + '</b>' : '<b>' + esc(x.name) + '</b> ' + esc(x.fx) + ' <i>' + esc(w) + '</i>') + '</span>'; };
    const ks = ['pos', 'kin', 'camp'];
    if (compact === 'seat') {
      // working traits show their effect; the idle ones share one quiet chip, with details on hover or tap
      const on = ks.filter(k => st[k]), off = ks.filter(k => !st[k]), tx = k => L.traitText(k, t[k]);
      return '<div class="traits slim">' + on.map(k => chip(k, true)).join('') + (off.length ? '<span class="trait off" tabindex="0" data-tip="' + esc('Not working right now. ' + off.map(k => tx(k).name + ': ' + tx(k).fx + ' (' + tx(k).when.toLowerCase() + ')').join('. ') + '.') + '">' + off.map(k => esc(tx(k).name)).join(' · ') + '</span>' : '') + '</div>';
    }
    return '<div class="traits">' + ks.map(k => chip(k, st[k])).join('') + '</div>';
  }
  function updateSeats(force) {
    const now = Date.now();
    if (!force && now - seatsAt < 1000) { paintHp(); return; }
    seatsAt = now;
    const box = $('seats');
    let html = '';
    for (let i = 0; i < L.PARTY_SIZE; i++) {
      const id = S.party[i];
      if (id) delete seatLeft[i];
      if (!id) {
        const canFill = S.unlocked.some(x => !S.party.includes(x)) || (S.guests || []).some(g => !S.party.includes(g.id));
        html += '<div class="seat empty"><span class="pos">' + (i + 1) + '<small>' + L.POS_NAME[i] + '</small></span><div class="ic">' + icon('user') + '</div><div class="info"><div class="nm">' + (seatLeft[i] ? esc(seatLeft[i]) + ' returned to camp' : 'Empty seat') + '</div><div class="lv">' + (canFill ? 'Pick a companion below to fill it.' : 'Bring someone from the Campfire or recruit from the Players Guild below.') + '</div></div></div>';
        continue;
      }
      const m = L.memberById(id), down = S.down[id], hp = Math.max(0, S.hp[id] || 0), mx = L.maxHpOf(S, id);
      const guest = L.isGuest(S, id);
      let btn = '';
      if (!guest) {
        const n = buyN() === 'max' ? Math.max(1, L.maxAffordable(S, id)) : buyN();
        const cost = L.trainCost(S, id, n);
        btn = '<button class="buy anywhere" data-train="' + id + '"' + (cost > S.gold ? ' disabled' : '') + '><b>Train +' + n + '</b><span>' + coin + '<em>' + fmt(cost) + '</em></span></button>' + '<div class="minirow"><button class="autot' + ((S.autoTrain || {})[id] && L.passOn(S) ? ' on' : '') + (L.passOn(S) ? '' : ' locked') + '" data-autot="' + id + '" title="Auto-train: spend gold on this character automatically" aria-pressed="' + !!(S.autoTrain || {})[id] + '">' + icon('refresh') + 'Auto</button>' + (id !== 'you' ? '<button class="rest icon" data-unseat="' + i + '" title="Send ' + esc(m.name) + ' to the campfire to free this seat" aria-label="Send ' + esc(m.name) + ' to the campfire">' + icon('flame') + '</button>' : '') + '</div>';
      } else btn = '<button class="btn ghost small" data-dismiss="' + id + '">Dismiss</button>';
      const mv = '<div class="mv"><button class="mini up" data-move="' + i + ':-1"' + (i === 0 ? ' disabled' : '') + ' title="Move forward" aria-label="Move ' + esc(m.name) + ' forward">&#9650;</button><button class="mini dn" data-move="' + i + ':1"' + (i === L.PARTY_SIZE - 1 ? ' disabled' : '') + ' title="Move back" aria-label="Move ' + esc(m.name) + ' back">&#9660;</button></div>';
      html += '<div class="seat' + (down ? ' down' : '') + (m.player ? ' mine' : '') + '"><span class="pos">' + (i + 1) + '<small>' + L.POS_NAME[i] + '</small></span>' + mv + portrait(id) +
        '<div class="info"><div class="nm"><a class="pname" data-prof="' + id + '">' + esc(m.name) + '</a> ' + classTag(m.cls) + (id === 'you' ? '<span class="you">You</span>' : guest ? '<span class="you guest">Player</span>' : '') + '</div>' +
        '<div class="lv">' + (down ? 'Fallen. Back up in ' + Math.ceil((down - now) / 1000) + 's' : memberStatsLine(id, now)) + '</div>' +
        traitChips(id, 'seat') +
        '<div class="hpbar"><i data-hp="' + id + '"></i></div>' + (L.resKind(id) ? '<div class="resbar r-' + L.resKind(id) + '" title="' + (L.resKind(id) === 'mana' ? 'Mana' : 'Stamina') + '"><i data-res="' + id + '"></i></div>' : '') + '</div><div class="acts">' + btn + '</div></div>';
    }
    if (html !== seatsHtml) {
      box.innerHTML = html; seatsHtml = html;
      const fns = L.formationNotes(S), nw = fns.filter(n => n.warn).length;
      $('fsum').innerHTML = nw ? 'Formation tips: <b>' + nw + (nw === 1 ? ' warning' : ' warnings') + '</b>' : 'Formation tips: looking good';
      $('fnotes').innerHTML = fns.map(n => '<li class="' + (n.warn ? 'warn' : 'ok') + '">' + esc(n.text) + '</li>').join('') + '<li class="tip">Healers heal less the farther they stand from who they heal. Some monsters ambush from behind and hit the rear first; a tank at the back guards it.</li>';
    }
    paintHp();
    const bench = S.unlocked.filter(x => !S.party.includes(x));
    const nComp = L.companions(S).length, cap = L.rosterCap(S), slots = L.jobSlots(S), usedJobs = Object.keys(S.jobs || {}).filter(k => L.jobFree(S, S.jobs[k])).length;
    const nextSlot = L.JOB_SLOT_LV.find(x => x > L.heroLv(S));
    const rosterBar = '<div class="rosterbar"><span>' + icon('flame') + 'Companions <b>' + nComp + ' / ' + cap + '</b></span><small>' + L.PARTY_SEATS + ' party seats plus ' + L.fireCap(S) + ' at the fire. ' + (L.ROSTER_LV.find(x => x > L.heroLv(S)) ? 'One more spot at hero level ' + L.ROSTER_LV.find(x => x > L.heroLv(S)) + '.' : 'Every free spot earned.') + ' When it is full, a new companion means dismissing someone for good.</small>' +
      ((S.rosterUps || 0) < L.ROSTER_BUY_MAX && CL ? '<button class="btn small ghost" data-rosterbuy>' + sigil + ' +1 spot · ' + fmt(L.ROSTER_COST) + ' ' + TOKEN + '</button>' : '') + '</div>';
    const jobsHead = L.canUse(S, 'jobs') ? '<div class="jobhead"><b>Camp jobs</b><small>' + usedJobs + ' of ' + slots + ' slots in use' + (nextSlot ? ' &middot; next slot at hero level ' + nextSlot : '') + '</small></div>'
      : '<div class="lockrow">' + icon('lock') + '<div><b>Camp jobs open at hero level ' + L.unlockOf('jobs').lv + '</b><small>Resting companions will work jobs that help the whole party.</small></div></div>';
    const jobsHtml = rosterBar + jobsHead + (!L.canUse(S, 'jobs') ? '' : '<div class="jobs">' + L.JOBS.map(j => {
      const id = S.jobs && S.jobs[j.id], on = L.jobFree(S, id), m = on && L.memberById(id);
      return '<button class="job' + (on ? ' on' : '') + '" data-job="' + j.id + '" title="' + esc(j.desc) + '"><span class="jic">' + icon(j.icon) + '</span><b>' + j.name + '</b>' +
        (on ? '<small><img src="' + SP.spriteURL(m.cls, 2, lookHue(m)) + '" alt="">' + esc(m.name) + '</small><em>' + L.jobText(j, L.jobValue(S, j, id)) + '</em>' : '<small class="none">Nobody yet</small><em>' + j.fmt + '</em>') + '</button>';
    }).join('') + '</div>');
    let benchHtml = jobsHtml + bench.map(id => {
      const m = L.memberById(id), job = L.jobOf(S, id);
      const n = buyN() === 'max' ? Math.max(1, L.maxAffordable(S, id)) : buyN(), cost = L.trainCost(S, id, n);
      return '<div class="seat bench">' + portrait(id) + '<div class="info"><div class="nm"><a class="pname" data-prof="' + id + '">' + esc(m.name) + '</a> ' + classTag(m.cls) + '</div><div class="lv">Power level ' + L.lvl(S, id) + ' &middot; ' + esc(m.title) + '</div>' +
        '<div class="jobline' + (job ? ' on' : '') + '">' + (job ? icon(job.icon) + '<b>' + job.name + '</b> ' + L.jobText(job, L.jobValue(S, job, id)) : 'No camp job yet') + '</div>' + traitChips(id, true) + '</div>' +
        '<div class="acts"><button class="buy" data-train="' + id + '"' + (cost > S.gold ? ' disabled' : '') + '><b>Train +' + n + '</b><span>' + coin + '<em>' + fmt(cost) + '</em></span></button><div class="minis">' + '<button class="autot' + ((S.autoTrain || {})[id] && L.passOn(S) ? ' on' : '') + (L.passOn(S) ? '' : ' locked') + '" data-autot="' + id + '" title="Auto-train: spend gold on this character automatically" aria-pressed="' + !!(S.autoTrain || {})[id] + '">' + icon('refresh') + 'Auto</button>' +
        '<button class="rest" data-jobfor="' + id + '" data-tip="' + (job ? 'Change their camp job' : 'Give them a camp job that helps the party') + '">Job</button><button class="rest" data-seat="' + id + '" data-tip="Bring them into your party">Bring</button></div></div></div>';
    }).join('');
    if (!bench.length) benchHtml = jobsHtml + '<p class="note">No one is at the fire. Companions who rest here can take a job that helps the whole party.</p>';
    if ($('bench').dataset.h !== benchHtml) { $('bench').innerHTML = benchHtml; $('bench').dataset.h = benchHtml; }
  }
  const partyClick = e => {
    const pf = e.target.closest('[data-prof]'); if (pf) { profileModal(pf.dataset.prof); return; }
    const gp = e.target.closest('[data-gprof]'); if (gp) { const g = (boardList || []).find(x => x.id === gp.dataset.gprof); if (g) boardProfile(g); return; }
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.move) { const [i, d] = t.dataset.move.split(':').map(Number); if (L.moveMember(S, i, i + d)) { sfx.buy(); updateSeats(true); updateAbilities(true); } return; }
    if (t.dataset.autot && !L.passOn(S)) { openPass(); return; }
    if (t.dataset.autot) { const id = t.dataset.autot; S.autoTrain = S.autoTrain || {}; S.autoTrain[id] = !S.autoTrain[id]; if (!S.autoTrain[id]) delete S.autoTrain[id]; sfx.buy(); updateSeats(true); if (S.autoTrain[id]) toast('refresh', 'Auto-train on', L.memberById(id).name + ' will train whenever you have the gold' + (S.party.includes(id) ? '.' : ' and you are at camp.'), ''); return; }
    if (t.id === 'f-auto') { L.autoFormation(S); S.formationManual = false; sfx.buy(); updateSeats(true); updateAbilities(true); toast('shield', 'Party arranged', 'Tank in front, rogue behind it, healers in the middle where they reach everyone, casters at the back.', ''); return; }
    if (t.dataset.rosterbuy != null) { buyRosterSpot().then(ok => { if (ok) { sfx.relic(); toast('flame', 'A new spot by the fire', 'Your campfire holds ' + L.fireCap(S) + ' companions now, plus your party.', 'feat'); } }); return; }
    if ((t.dataset.unseat || t.dataset.seat) && !gateUse('camp')) return;
    if ((t.dataset.job || t.dataset.jobfor) && !gateUse('jobs')) return;
    if ((t.dataset.train && !S.party.includes(t.dataset.train)) || t.dataset.unseat || t.dataset.seat || t.dataset.dismiss || t.dataset.job || t.dataset.jobfor) { if (!campGate(true)) return; }
    if (t.dataset.job) { jobModal(t.dataset.job); return; }
    if (t.dataset.jobfor) { jobForModal(t.dataset.jobfor); return; }
    if (t.dataset.train) { if (L.train(S, t.dataset.train, buyN())) { sfx.buy(); updateSeats(true); } }
    else if (t.dataset.unseat) {
      const i = +t.dataset.unseat, id = S.party[i], m = id && L.memberById(id);
      L.unseat(S, i); if (m) sendOff(i, id, m.name + ' returned to camp', S.floor > L.CAMP_FLOOR ? 'Their damage, healing and abilities leave the fight with them. They rest at the campfire now.' : 'They rest at the campfire now.');
      updateSeats(true); updateAbilities(true); paintBoard();
    }
    else if (t.dataset.seat) pickSeat(t.dataset.seat);
    else if (t.dataset.dismiss) { const id = t.dataset.dismiss, i = S.party.indexOf(id), m = L.memberById(id); L.dismissGuest(S, id); if (m && i >= 0) sendOff(i, id, m.name + ' headed home', 'A player’s hero you recruited has left your party.'); updateSeats(true); updateAbilities(true); paintBoard(); }
    else if (t.dataset.recruit) recruitPlayer(t.dataset.recruit);
    else if (t.dataset.uninv) cancelInvite(t.dataset.uninv);
    else if (t.dataset.invyes) answerInvite(t.dataset.invyes, 'yes');
    else if (t.dataset.invno) answerInvite(t.dataset.invno, 'no');
    else if (t.id === 'b-find') findHeroes();
    else if (t.id === 'b-signin') openAccount();
    else if (t.id === 'f-recruit') switchTab('guild');
    else if (t.id === 'm-market') openTrade('market');
    else if (t.id === 'm-mail') openTrade('mail');
  };
  ['tab-party', 'tab-camp', 'tab-market', 'tab-guild'].forEach(id => $(id).addEventListener('click', partyClick));
  // camp jobs: pick who does a job, or which job someone does
  function jobsFull() { const n = L.JOB_SLOT_LV.find(x => x > L.heroLv(S)); toast('lock', 'Every job slot is taken', 'You can run ' + L.jobSlots(S) + (L.jobSlots(S) === 1 ? ' camp job' : ' camp jobs') + ' at once.' + (n ? ' Another slot opens at hero level ' + n + '.' : '') + ' Clear a job to move someone.', 'warn'); }
  function jobModal(jid) {
    const j = L.JOBS.find(x => x.id === jid), cur = S.jobs && S.jobs[jid];
    const free = S.unlocked.filter(id => L.jobFree(S, id)).sort((a, b) => L.jobValue(S, j, b) - L.jobValue(S, j, a));
    modal('<div class="maphead"><div><h2>' + j.name + '</h2><small>' + esc(j.desc) + ' Gives ' + j.fmt + '. Higher level companions do it better' + ', and a ' + L.CLASSES[j.aff].name.toLowerCase() + ' does it half again as well.</small></div><button class="iconbtn" id="j-x" aria-label="Close">&times;</button></div>' +
      (free.length ? '<div class="choice">' + free.map(id => { const m = L.memberById(id), o = L.jobOf(S, id); return '<button class="pick jpick' + (cur === id ? ' on' : '') + '" data-pick="' + id + '"><img src="' + SP.spriteURL(m.cls, 2, lookHue(m)) + '" alt=""><span><b>' + esc(m.name) + (m.cls === j.aff ? ' <i class="aff">&#9733; ' + L.CLASSES[m.cls].name + '</i>' : '') + '</b><small>Power level ' + L.lvl(S, id) + (o && o.id !== jid ? ' &middot; now ' + o.name : '') + '</small></span><em>' + L.jobText(j, L.jobValue(S, j, id)) + '</em></button>'; }).join('') + '</div>'
        : '<p class="note">Nobody is resting at the campfire. Send a companion back from your party to give them a job.</p>') +
      '<div class="row">' + (cur && L.jobFree(S, cur) ? '<button class="btn ghost" id="j-clear">Leave the job empty</button>' : '') + '<button class="btn ghost" id="j-close">Close</button></div>', md => {
        md.className = 'sheet wide';
        const done = () => { save(); closeModal(); updateSeats(true); updatePanel(true); };
        md.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { if (!L.assignJob(S, b.dataset.pick, jid)) return jobsFull(); sfx.buy(); toast(j.icon, L.memberById(b.dataset.pick).name + ' is the ' + j.name, L.jobText(j, L.jobValue(S, j, b.dataset.pick)) + ' while they rest at camp.', 'feat'); done(); });
        const c = md.querySelector('#j-clear'); if (c) c.onclick = () => { L.assignJob(S, cur, null); done(); };
        md.querySelector('#j-x').onclick = closeModal; md.querySelector('#j-close').onclick = closeModal;
      });
  }
  function jobForModal(id) {
    const m = L.memberById(id), cur = L.jobOf(S, id);
    modal('<div class="maphead"><div><h2>A job for ' + esc(m.name) + '</h2><small>Power level ' + L.lvl(S, id) + ' ' + L.CLASSES[m.cls].name.toLowerCase() + '. Train them to make their job count for more.</small></div><button class="iconbtn" id="j-x" aria-label="Close">&times;</button></div>' +
      '<div class="choice">' + L.JOBS.map(j => { const h = S.jobs && S.jobs[j.id], taken = h && h !== id && L.jobFree(S, h); return '<button class="pick jpick' + (cur && cur.id === j.id ? ' on' : '') + '" data-pj="' + j.id + '"><span class="jic">' + icon(j.icon) + '</span><span><b>' + j.name + (m.cls === j.aff ? ' <i class="aff">&#9733; suits them</i>' : '') + '</b><small>' + (taken ? 'Replaces ' + esc(L.memberById(h).name) : esc(j.desc)) + '</small></span><em>' + L.jobText(j, L.jobValue(S, j, id)) + '</em></button>'; }).join('') + '</div>' +
      '<div class="row">' + (cur ? '<button class="btn ghost" id="j-clear">No job</button>' : '') + '<button class="btn ghost" id="j-close">Close</button></div>', md => {
        md.className = 'sheet wide';
        const done = () => { save(); closeModal(); updateSeats(true); updatePanel(true); };
        md.querySelectorAll('[data-pj]').forEach(b => b.onclick = () => { const j = L.JOBS.find(x => x.id === b.dataset.pj); if (!L.assignJob(S, id, j.id)) return jobsFull(); sfx.buy(); toast(j.icon, m.name + ' is the ' + j.name, L.jobText(j, L.jobValue(S, j, id)) + ' while they rest at camp.', 'feat'); done(); });
        const c = md.querySelector('#j-clear'); if (c) c.onclick = () => { L.assignJob(S, id, null); done(); };
        md.querySelector('#j-x').onclick = closeModal; md.querySelector('#j-close').onclick = closeModal;
      });
  }
  function pickSeat(id) {
    const empty = S.party.indexOf(null);
    if (empty >= 0) { L.seat(S, id, empty); updateSeats(true); updateAbilities(true); return; }
    const m = L.memberById(id);
    modal('<h2>Who goes back to the campfire?</h2><p>' + esc(m.name) + ' takes their seat.</p><div class="choice">' +
      S.party.map((x, i) => x === 'you' || !x ? '' : '<button class="pick" data-slot="' + i + '"><b>' + esc(L.memberById(x).name) + '</b><small>' + L.CLASSES[L.memberById(x).cls].name + ', power level ' + L.lvl(S, x) + '</small></button>').join('') +
      '</div><div class="row"><button class="btn ghost" id="m-cancel">Cancel</button></div>', md => {
        md.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => { L.seat(S, id, +b.dataset.slot); closeModal(); updateSeats(true); updateAbilities(true); paintBoard(); });
        md.querySelector('#m-cancel').onclick = closeModal;
      });
  }

  // ---------- growing the party: story companions + recruiting players ----------
  let boardList = null, boardMsg = '';
  function nextCompanion() {
    for (const b of L.STORY) if (b.join && !S.unlocked.includes(b.join)) return L.memberById(b.join);
    return null;
  }
  function paintBoard() {
    const w = $('boardwrap');
    const open = S.party.filter(x => !x).length;
    const nc = nextCompanion();
    $('campnext').innerHTML = nc ? '<p class="next">Next to join the fire: <b>' + esc(nc.name) + '</b> ' + classTag(nc.cls) + '<br><small>They will find you as the story goes on. Your goal: ' + esc(L.currentGoal(S)) + '.</small></p>' : '<p class="next">Every story companion has found the fire.</p>';
    let h = '<h3 class="sub" id="grow">Players Guild</h3><div class="growcard">' +
      '<p>Heroes made by other players. They are stronger than story companions and fight at the level their owner trained them to. Your own hero is listed here too, and you earn gold whenever someone recruits it.</p>';
    if (!CL) {
      h += '<p>The Players Guild is not available right now. Try again later.</p>';
    } else if (!signedIn()) {
      h += '<ol class="steps"><li><b>Sign in</b> with a free account.</li><li>Press <b>Browse the guild</b> to see players’ heroes.</li><li>Press <b>Invite</b>. When the player accepts, their hero joins your party.</li></ol>' +
        '<button class="btn small" id="b-signin">Sign in to recruit</button>';
    } else {
      h += invCard();
      h += (open ? '<p class="note">' + open + (open === 1 ? ' seat is' : ' seats are') + ' open.</p>' : '<p class="note">Your party is full. When a player accepts your invite, you choose who steps out.</p>') +
        '<button class="btn small" id="b-find">' + (boardList ? 'Show other heroes' : 'Browse the guild') + '</button>';
      if (boardMsg) h += '<p class="note">' + esc(boardMsg) + '</p>';
      if (boardList) h += '<div class="board">' + boardList.map(g => { const pf = g.pf || {}; return '<div class="seat bench gboard' + (g.wd && g.wd.b && BANNERS[g.wd.b] ? ' hasgb">' + bannerSVG(g.wd.b, 'gban') : '">') + '<div class="pfava sm fr-' + cosOf('f', pf.f)[0] + '">' + (g.wd && g.wd.k && g.wd.k.you ? '<div class="ic c-' + g.cls + ' player dressed"><img src="' + SP.spriteURL(g.cls, 2, outfitHue(g.wd.k.you)) + '" alt=""></div>' : '<div class="ic c-' + g.cls + ' player">' + icon(CLASS_ICON[g.cls]) + '</div>') + '</div><div class="info"><div class="nm"><button class="linkname nc-' + cosOf('c', pf.c)[0] + '" data-gprof="' + g.id + '">' + esc(g.name) + '</button> ' + classTag(g.cls) + (pf.t ? ' <small class="pftitle">' + esc(cosOf('t', pf.t)[1]) + '</small>' : '') + (g.w ? ' ' + warBadge(g.w) : '') + '</div><div class="lv">' + (g.on ? '<span class="online">Online now</span> &middot; ' : '') + 'Power level ' + g.level + ' &middot; reached floor ' + g.floor + '</div></div>' +
        ((S.guests || []).some(x => x.id === 'p_' + g.id) ? '<span class="muted">In party</span>' : inv.sent[g.id] ? '<span class="invact"><span class="invwait">Invited</span><button class="btn ghost small" data-uninv="' + g.id + '">Cancel</button></span>' : '<button class="btn small" data-recruit="' + g.id + '">Invite</button>') + '</div>'; }).join('') + '</div>';
      if ((S.guests || []).length) h += '<p class="note">To let a player’s hero go, press Dismiss on their seat.</p>';
    }
    w.innerHTML = h + '</div>';
  }
  async function findHeroes() {
    boardMsg = 'Searching the guild…'; paintBoard();
    try { const r = await api('GET', null, '/heroes'); await loadWar(); boardList = (r && r.heroes) || []; boardMsg = boardList.length ? '' : 'The guild hall is quiet right now. Check back soon.'; }
    catch (e) { boardMsg = 'Could not reach the Players Guild. Try again in a moment.'; }
    paintBoard();
  }
  // ---------- party invites: a player's hero joins only after its owner accepts ----------
  const inv = { asks: [], sent: {}, seen: {}, busy: 0 };
  function invCard() {
    const a = inv.asks, q = S.joinQ || [];
    let h = '';
    if (a.length) h += '<div class="invites"><h4>Party invitations</h4>' + a.map(g => '<div class="seat bench gboard"><div class="ic c-' + g.cls + ' player">' + icon(CLASS_ICON[g.cls]) + '</div><div class="info"><div class="nm">' + esc(g.name) + ' ' + classTag(g.cls) + '</div><div class="lv">' + (g.on ? '<span class="online">Online now</span> &middot; ' : '') + 'Power level ' + g.level + ' &middot; wants your hero in their party</div></div><span class="invact"><button class="btn small" data-invyes="' + g.id + '">Accept</button><button class="btn ghost small" data-invno="' + g.id + '">Decline</button></span></div>').join('') +
      '<p class="note">Accepting lends a copy of your hero to their party, and you earn gold for it. Your own game and party do not change.</p></div>';
    if (q.length) h += '<p class="note">' + q.map(g => '<b>' + esc(g.name) + '</b>').join(', ') + (q.length === 1 ? ' accepted your invite and joins' : ' accepted your invites and join') + ' when you are at camp.</p>';
    return h;
  }
  async function recruitPlayer(gid) {
    const g = (boardList || []).find(x => x.id === gid); if (!g || inv.sent[gid]) return;
    inv.sent[gid] = g; paintBoard();
    try { await api('POST', { id: gid, act: 'ask' }, '/invite'); }
    catch (e) { delete inv.sent[gid]; paintBoard(); toast('lock', 'Invite not sent', 'That hero could not be reached. Try another.', 'warn'); return; }
    S.sentInv = S.sentInv || {}; S.sentInv[gid] = { name: g.name, cls: g.cls, at: Date.now() };
    sfx.buy(); toast('users', 'Invite sent to ' + g.name, g.on ? 'They are online now. Their hero joins your party once they accept.' : 'They will see it next time they play. Their hero joins your party once they accept.', '');
  }
  async function cancelInvite(gid) {
    delete inv.sent[gid]; if (S.sentInv) delete S.sentInv[gid]; paintBoard();
    try { await api('POST', { id: gid, act: 'cancel' }, '/invite'); } catch (e) {}
  }
  async function answerInvite(gid, act) {
    const g = inv.asks.find(x => x.id === gid); inv.asks = inv.asks.filter(x => x.id !== gid); paintBoard();
    try { await api('POST', { id: gid, act }, '/invite'); } catch (e) { toast('lock', 'That invite has expired', 'The player may have cancelled it.', 'warn'); return; }
    if (act === 'yes' && g) { sfx.buy(); toast('users', 'You joined ' + g.name + '’s party', 'A copy of ' + S.hero.name + ' now fights alongside them. You earn gold for it, and you can chat in Party chat.', 'feat'); try { pushCloud(true); } catch (e) {} }
  }
  // Seat a player's hero, asking who steps out when the party is full.
  function seatGuest(g) {
    const join = () => {
      L.addGuest(S, { id: 'p_' + g.id, name: g.name, cls: g.cls, side: g.side, level: g.level });
      const gg = (S.guests || []).find(x => x.id === 'p_' + g.id); if (gg) { gg.pf = g.pf || null; gg.w = g.w || ''; gg.wd = g.wd || null; }
      sfx.buy(); toast('users', g.name + ' joins your party', 'They accepted your invite. A ' + L.CLASSES[g.cls].name + ' at level ' + g.level + '.', 'feat');
      updateSeats(true); updateAbilities(true); paintBoard();
    };
    if (S.party.includes(null)) return join();
    modal('<h2>Make room for ' + esc(g.name) + '</h2><p>' + esc(g.name) + ' accepted your invite, and your party is full. Who should step out? Story companions go back to the campfire, and players’ heroes are dismissed.</p><div class="choice">' +
      S.party.map((x, i) => x === 'you' || !x ? '' : '<button class="pick" data-out="' + i + '"><b>' + esc(L.memberById(x).name) + '</b><small>' + L.CLASSES[L.memberById(x).cls].name + ', power level ' + L.lvl(S, x) + (L.isGuest(S, x) ? ' &middot; player' : '') + '</small></button>').join('') +
      '</div><div class="row"><button class="btn ghost" id="m-cancel">Not now</button></div>', md => {
        md.querySelectorAll('[data-out]').forEach(b => b.onclick = () => {
          const i = +b.dataset.out, x = S.party[i];
          if (L.isGuest(S, x)) L.dismissGuest(S, x); else L.unseat(S, i);
          closeModal(); join();
        });
        md.querySelector('#m-cancel').onclick = () => { closeModal(); toast('users', g.name + ' is waiting', 'Their hero stays ready. Make room at camp when you want them.', ''); };
      });
    return false;
  }
  // Accepted heroes wait in S.joinQ until the party is at camp.
  function drainJoins() {
    if (!(S.joinQ || []).length || !mainCamp() || !$('modal').hidden) return;
    const g = S.joinQ.shift();
    if (!(S.guests || []).some(x => x.id === 'p_' + g.id)) seatGuest(g);
    paintBoard();
  }
  async function pollInvites() {
    if (!CL || !signedIn() || S.mode !== 'multi' || inv.busy) return;
    inv.busy = 1;
    try {
      const r = await api('GET', null, '/invites');
      inv.asks = r.asks || [];
      for (const g of inv.asks) if (!inv.seen[g.id]) { inv.seen[g.id] = 1; toast('users', g.name + ' invited you', 'They want ' + S.hero.name + ' in their party. Answer in the Guild tab.', 'feat'); }
      S.sentInv = S.sentInv || {};
      for (const id of Object.keys(S.sentInv)) if (!(r.sent || []).includes(id)) delete S.sentInv[id];
      for (const id of r.sent || []) if (!inv.sent[id]) inv.sent[id] = S.sentInv[id] || { id };
      for (const id of Object.keys(inv.sent)) if (!(r.sent || []).includes(id)) delete inv.sent[id];
      for (const g of r.acc || []) { S.joinQ = (S.joinQ || []).filter(x => x.id !== g.id); S.joinQ.push(g); if (!mainCamp()) toast('users', g.name + ' accepted your invite', 'Their hero joins your party when you are back at the main camp.', 'feat'); }
      for (const g of r.dec || []) toast('user', g.name + ' declined your invite', 'Try another hero in the Players Guild.', '');
      paintBoard();
    } catch (e) {}
    inv.busy = 0;
    drainJoins();
  }

  // ---------- abilities bar ----------
  let abilKey = '';
  function updateAbilities(force) {
    const now = Date.now(), box = $('abilities');
    const specs = L.heroSpecs(S), key = S.party.join(',') + '|' + specs.map(a => a.id).join(',');
    if (force || key !== abilKey) {
      abilKey = key;
      box.classList.toggle('more', specs.length > 0);
      const hc = specs.length && L.memberById('you').cls;
      box.innerHTML = S.party.map((id, i) => {
        if (!id) return '<div class="skill locked"><svg viewBox="0 0 24 24"><use href="#i-user"/></svg><div><b>Empty seat</b><small>&nbsp;</small></div><kbd>' + (i + 1) + '</kbd></div>';
        const m = L.memberById(id), ab = L.CLASSES[m.cls].ability;
        return '<button class="skill c-' + m.cls + '" data-cast="' + id + '" title="' + esc(ab.desc) + '"><div class="cd"></div>' + icon(CLASS_ICON[m.cls]) + '<div><b>' + ab.name + '</b><small></small></div><kbd>' + (i + 1) + '</kbd></button>';
      }).join('') + specs.map((ab, i) => '<button class="skill spec c-' + hc + '" data-spec="' + ab.id + '" title="' + esc(ab.desc) + '"><div class="cd"></div>' + icon('star') + '<div><b>' + esc(ab.name) + '</b><small></small></div><kbd>' + (6 + i) + '</kbd></button>').join('');
    }
    box.querySelectorAll('[data-spec]').forEach(b => {
      const ab = specs.find(a => a.id === b.dataset.spec); if (!ab) return;
      const st = S.abil['you:' + ab.id], active = st && st.until > now && ab.dur > 0, cd = st && st.readyAt > now ? (st.readyAt - now) / 1000 : 0, down = !!S.down.you;
      const lack = !cd && !active && L.resOf(S, 'you') < L.SPEC_COST, rn = L.resKind('you') === 'mana' ? 'mana' : 'stamina', cc = !down && L.ccOf(S, 'you', now);
      b.classList.toggle('active', !!active); b.classList.toggle('ready', !cd && !down && !lack); b.classList.toggle('lack', lack); b.disabled = down;
      b.classList.toggle('stun', !!cc); if (cc) b.classList.remove('ready');
      b.querySelector('small').textContent = down ? 'Your hero has fallen' : cc ? (cc.k === 'stun' ? 'Stunned ' : 'Disarmed ') + fmtTime((cc.until - now) / 1000) : active ? 'Active ' + fmtTime((st.until - now) / 1000) : cd ? 'Ready in ' + fmtTime(cd) : lack ? 'Needs ' + L.SPEC_COST + ' ' + rn : 'Ready';
      b.querySelector('.cd').style.transform = 'scaleX(' + (cd && !active ? cd / ab.cd : 0) + ')';
    });
    box.querySelectorAll('[data-cast]').forEach(b => {
      const id = b.dataset.cast, m = L.memberById(id), ab = L.CLASSES[m.cls].ability, st = S.abil[id];
      const active = st && st.until > now && ab.dur > 0, cd = st && st.readyAt > now ? (st.readyAt - now) / 1000 : 0;
      const down = !!S.down[id];
      const lack = !cd && !active && (m.cls === 'healer' ? L.oom(S, id) || L.resOf(S, id) <= 0 : L.resOf(S, id) < L.AB_COST), rn = L.resKind(id) === 'mana' ? 'mana' : 'stamina', cc = !down && L.ccOf(S, id, now);
      b.classList.toggle('active', !!active); b.classList.toggle('ready', !cd && !down && !lack); b.classList.toggle('lack', lack); b.disabled = down;
      const sm = b.querySelector('small'), ov = b.querySelector('.cd');
      b.classList.toggle('stun', !!cc); if (cc) b.classList.remove('ready');
      sm.textContent = down ? m.name + ' has fallen' : cc ? (cc.k === 'stun' ? 'Stunned ' : 'Disarmed ') + fmtTime((cc.until - now) / 1000) : active ? 'Active ' + fmtTime((st.until - now) / 1000) : cd ? 'Ready in ' + fmtTime(cd) : lack ? (L.oom(S, id) ? 'Out of mana' : 'Needs ' + L.AB_COST + ' ' + rn) : m.name + ' · Ready';
      ov.style.transform = 'scaleX(' + (cd && !active ? cd / ab.cd : 0) + ')';
    });
  }
  $('abilities').addEventListener('click', e => { const sp = e.target.closest('[data-spec]'); if (sp) { if (L.castSpec(S, sp.dataset.spec, Date.now(), events)) { handleEvents(); updateAbilities(); } return; } const b = e.target.closest('[data-cast]'); if (b) { if (L.castAbility(S, b.dataset.cast, Date.now(), events)) { handleEvents(); updateAbilities(); } } });

  // ---------- gear ----------
  let gearWho = 'you', gearKey = '';
  const SLOT_ICON = { weapon: 'sword', armor: 'gear-armor', trinket: 'gear-trinket' };
  const jobName = jid => (L.JOBS.find(j => j.id === jid) || {}).name || '';
  const affText = it => '+' + Math.round(it.aff.v * (1 + 0.1 * it.up) * 100) + '% ' + jobName(it.aff.j) + ' job';
  // Region set bonus text, for the item card, the doll and the Guide.
  const pct100 = v => Math.round(v * 100) + '%';
  const RSET_KIND = { dps: 'damage', hp: 'health', heal: 'healing (health for non-healers)', gold: 'gold for the whole party' };
  const rsetTwoText = i => '+' + pct100(L.rsetTwo(i)) + ' ' + RSET_KIND[L.REGION_SETS[i].k];
  const rsetFourText = i => '+' + pct100(L.rsetFour(i)) + ' damage and health' + (L.REGION_SETS[i].k === 'heal' ? ' (and healing for healers)' : '');
  const regionName = i => L.BIOMES[i].name;
  // Where a set drops (John, 2026-11-24), with a button that takes the party there to farm it.
  function setWhere(kind, i) {
    const top = S.maxFloor, bossAt = f => Math.floor(f / L.BOSS_EVERY) * L.BOSS_EVERY;
    let txt, go = 0;
    if (kind === 'rset') {
      const a = i * 10 + 1, z = i * 10 + 10;
      txt = 'Drops in <b>' + esc(regionName(i)) + '</b> (floors ' + a + '\u2013' + z + '). Best from its guardian, ' + esc(L.BIOMES[i].boss) + ', on floor ' + z + '. Chests and soldiers there drop it too.';
      go = top >= z ? z : top >= a ? (bossAt(top) >= a ? bossAt(top) : top) : 0;
      if (!go) txt += ' <em>Reach floor ' + a + ' to farm it.</em>';
    } else {
      txt = 'Drops from <b>guardians</b> (every ' + L.BOSS_EVERY + 'th floor) from floor 15, for the classes in your party. Any guardian works; the deepest one you can beat is fastest.';
      go = top >= 15 ? bossAt(top) : 0;
      if (!go) txt += ' <em>Reach floor 15 to farm it.</em>';
    }
    return '<div class="setwhere">' + icon('map') + '<small>' + txt + '</small>' + (go ? '<button class="btn small" data-farm="' + go + '">' + (S.floor === go ? 'Farming here' : 'Farm floor ' + go) + '</button>' : '') + '</div>';
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-farm]'); if (!b) return;
    const f = +b.dataset.farm; if (!(f > 0) || f > S.maxFloor) return;
    L.gotoFloor(S, f); S.autoAdvance = false; S.campReturn = 0; $('auto').checked = false; updateStage();
    toast('map', 'Farming floor ' + f, 'Descend automatically is off, so the party stays on floor ' + f + ' and fights it again and again. Turn it back on to keep going down.', '');
    document.querySelectorAll('[data-farm]').forEach(x => { x.textContent = +x.dataset.farm === f ? 'Farming here' : 'Farm floor ' + x.dataset.farm; });
  });
  const bound = it => it.rset != null || it.rar === 'goblin' || it.wb != null;
  function itemEffect(it) {
    const st = L.itemStats(it);
    return st.map(([k, v], i) => '+' + Math.round(v * 100) + '% ' + k.toLowerCase()).join(', ') + (it.aff ? ', ' + affText(it) : '');
  }
  function itemChip(it, extra, cls) {
    const w = L.wearer(S, it.uid);
    return '<div class="item r-' + it.rar + (cls ? ' ' + cls : '') + '" data-item="' + it.uid + '" role="button" tabindex="0"><img class="iimg sm" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt=""><span><b>' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</b><small>' + L.SLOT_NAME[it.slot] + ' &middot; ' + itemEffect(it) + (w ? ' &middot; <i class="worn">worn by ' + esc(L.memberById(w).name) + '</i>' : '') + '</small></span>' + (extra || '') + '</div>';
  }
  // How an item compares to what this member wears in that slot, in gear percent.
  function compareTag(it, id) {
    if (L.wearer(S, it.uid) === id) return '<span class="cmp eq">Equipped</span>';
    const d = Math.round((L.itemScore(it) - L.replaces(S, id, it).reduce((a, x) => a + L.itemScore(x), 0)) * 100);
    return d > 0 ? '<span class="cmp up">&#9650; ' + d + '% better</span>' : d < 0 ? '<span class="cmp down">&#9660; ' + (-d) + '% worse</span>' : '<span class="cmp eq">Same</span>';
  }
  // Away from camp you only see the party you brought down; the campfire roster stays hidden.
  const gearOwners = () => { const inCamp = mainCamp(); return S.unlocked.filter(id => { const m = L.memberById(id); return m && !m.guest && (inCamp || S.party.includes(id)); }); };
  let whoRestOpen = false;
  function updateGear(force) {
    const who = gearOwners();
    if (!who.includes(gearWho)) gearWho = who[0];
    $('gearcount').textContent = L.packCount(S) || '';
    if (!gearWho) return;
    const key = gearWho + '|' + camp() + mainCamp() + '|' + S.party.join() + '|' + S.bag.length + '|' + JSON.stringify(S.gear) + '|' + S.bag.map(x => x.up + (x.lk ? 'L' : '')).join('') + '|' + S.unlocked.length + '|' + Math.floor(S.gold);
    if (!force && key === gearKey) return; gearKey = key;
    { const chip = id => {
        const m = L.memberById(id), n = Object.keys(L.betterFor(S, id)).length;
        return '<button class="whochip c-' + m.cls + (id === gearWho ? ' on' : '') + '" data-who="' + id + '"><img src="' + SP.spriteURL(m.cls, 2, lookHue(m)) + '" alt=""><span>' + esc(m.name) + '</span>' + (n ? '<em title="Better gear in your pack">' + n + '</em>' : '') + '</button>';
      };
      const inParty = S.party.filter(id => id && who.includes(id)), rest = who.filter(id => !inParty.includes(id));
      $('gearwho').innerHTML = '<div class="whogroup"><small>Your party</small><div>' + inParty.map(chip).join('') + '</div></div>' +
        (rest.length ? '<details class="whogroup rest"' + (rest.includes(gearWho) || whoRestOpen ? ' open' : '') + '><summary>At the campfire <em>' + rest.length + '</em></summary><div>' + rest.map(chip).join('') + '</div></details>' : '');
      const dt = $('gearwho').querySelector('details'); if (dt) dt.ontoggle = () => { whoRestOpen = dt.open; }; }
    const m = L.memberById(gearWho), g = S.gear[gearWho] || {}, cname = L.CLASSES[m.cls].name;
    const set = L.SETS.find(x => x.cls === m.cls), sc = L.setCount(S, gearWho, set.id);
    const better = L.betterFor(S, gearWho), nb = Object.keys(better).length;
    const openP = L.openPos(S, gearWho), robe = L.robeOn(S, gearWho);
    const slotTile = sl => {
      const type = L.posType(sl), name = L.SLOT_NAME[sl];
      if (!openP.includes(sl)) {
        const kind = sl === 'neck2' ? 'neck2' : 'ring', c = L.unlockCost(S, gearWho, kind);
        const next = kind === 'neck2' || sl === 'ring' + (2 + L.unlocksOf(S, gearWho).rings);
        return '<div class="dslot ds-' + sl + ' locked"><div class="tile ghost' + (next ? ' unl" data-unlock="' + kind + '" role="button" tabindex="0"' : '"') + ' title="' + (next ? 'Unlock with ' + c + ' Kindling' : 'Unlock the ring before it first') + '">' + icon('lock') + (next ? '<i class="kc">' + c + '</i>' : '') + '</div><span>' + name + '</span></div>';
      }
      if (sl === 'legs' && robe) return '<div class="dslot ds-legs covered" title="The robe covers the legs. Tap to choose leggings instead."><div class="tile ghost" data-pos="legs" role="button" tabindex="0"><img class="iimg" src="' + SP.itemIcon(m.cls, 'legs', 'common') + '" alt=""></div><span>Robe</span></div>';
      const it = g[sl] && L.itemOf(S, g[sl]);
      const up = better[sl] ? '<i class="upb" title="Better one in your pack">&#9650;</i>' : '';
      if (!it) return '<div class="dslot ds-' + sl + ' empty" title="Choose a ' + name.toLowerCase() + '"><div class="tile ghost" data-pos="' + sl + '" role="button" tabindex="0"><img class="iimg" src="' + SP.itemIcon(m.cls, type, 'common') + '" alt="">' + up + '</div><span>' + name + '</span></div>';
      return '<div class="dslot ds-' + sl + '"><div class="tile r-' + it.rar + (it.lk ? ' held' : '') + '" data-pos="' + sl + '" role="button" tabindex="0" title="' + esc(L.gearName(it)) + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + (it.lk ? '<i class="lkb" title="Locked in this slot">' + icon('lock') + '</i>' : up) + '</div><span>' + name + '</span></div>';
    };
    // totals from worn gear
    const dmg = L.gearPctOf(S, gearWho, 'dps'), hp = L.gearPctOf(S, gearWho, 'hp');
    const pc = v => '+' + Math.round(v * 100) + '%';
    const totals = [m.cls === 'healer' ? ['Healing', dmg] : ['Damage', dmg], ['Health', hp]].map(([k, v]) => '<div><small>' + k + '</small><b>' + pc(v) + '</b></div>').join('');
    let h = '<div class="doll">' +
      '<div class="dcol">' + ['head', 'neck', 'chest', 'legs'].map(slotTile).join('') + '</div>' +
      '<div class="dmid"><div class="dfig" data-prof="' + gearWho + '" role="button" tabindex="0" title="About ' + esc(m.name) + '"><img src="' + SP.spriteURL(m.cls, 5, lookHue(m)) + '" alt=""><b>' + esc(m.name) + '</b>' + classTag(m.cls) + '</div>' + (wardOn() && !String(gearWho).startsWith('p_') ? '<button class="wdbtn" id="g-ward" title="Outfits and lanterns">' + icon('star') + 'Wardrobe</button>' : '') +
      '<div class="dstats">' + totals + '</div></div>' +
      '<div class="dcol">' + ['main', 'off', 'neck2', 'feet'].map(slotTile).join('') + '</div>' +
      '<div class="drings">' + ['ring1', 'ring2', 'ring3', 'ring4', 'ring5'].map(slotTile).join('') + '</div></div>' +
      '<div class="setinfo' + (sc ? ' on' : '') + '"><b>' + set.name + '</b> <span class="pips">' + [0, 1, 2].map(i => '<i class="' + (i < sc ? 'on' : '') + '"></i>').join('') + '</span><small>2 pieces: ' + set.two + '. 3 pieces: ' + set.three + '.</small>' + setWhere('class') + '</div>' +
      Object.entries(L.rsetCounts(S, gearWho)).map(([i, n]) => '<div class="setinfo rset' + (n >= 2 ? ' on' : '') + '"><b>' + L.REGION_SETS[i].name + '</b> <span class="pips">' + [0, 1, 2, 3].map(k => '<i class="' + (k < n ? 'on' : '') + '"></i>').join('') + '</span><small>2 pieces: ' + rsetTwoText(+i) + '. 4 pieces: ' + rsetFourText(+i) + '.</small>' + setWhere('rset', +i) + '</div>').join('') +
      '<div class="dollbar"><small>' + cname + ' gear only. Tap a slot to change it. Worn gear stays on the character, not in the pack.' + (L.lockedSlots(S, gearWho) ? ' Locked slots keep their piece when you use Equip best.' : '') + '</small><button class="btn small" id="g-best"' + (nb ? '' : ' disabled') + '>' + (nb ? 'Equip best (' + nb + ')' : 'Best gear on') + '</button></div>';
    $('gearslots').innerHTML = h;
    { const pn = $('packn'); if (pn) pn.textContent = L.packCount(S); }
    paintPackCap();
    const tile = (it, dim) => {
      const w = L.wearer(S, it.uid), fit = it.cls === m.cls;
      const d = fit && !w ? Math.round((L.itemScore(it) - L.replaces(S, gearWho, it).reduce((a, x) => a + L.itemScore(x), 0)) * 100) : 0;
      return '<div class="tile r-' + it.rar + (dim ? ' dim' : '') + (w ? ' worn' : '') + '" data-item="' + it.uid + '" role="button" tabindex="0" title="' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + ' (' + itemEffect(it) + ')' + (w ? ', worn by ' + esc(L.memberById(w).name) : '') + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' +
        '<i class="lvb' + (fit && !L.canWear(S, gearWho, it) ? ' no' : '') + '" title="Needs power level ' + L.reqLevel(it) + '">Lv ' + L.reqLevel(it) + '</i>' + (it.aff || it.jset ? '<i class="affb" title="Helps a camp job"></i>' : '') + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + (d > 0 && L.canWear(S, gearWho, it) ? '<i class="upb">&#9650;</i>' : '') + (w ? '<i class="wb" title="Worn">' + esc(L.memberById(w).name.charAt(0)) + '</i>' : '') + (it.lk ? '<i class="lkb" title="Locked">' + icon('lock') + '</i>' : '') + '</div>';
    };
    const pack = S.bag.filter(it => !L.wearer(S, it.uid));
    const fits = pack.filter(it => it.cls === m.cls).sort((a, b) => L.gearPct(b) - L.gearPct(a));
    const others = pack.filter(it => it.cls !== m.cls);
    let bh = '<h4 class="packh">Fits ' + esc(m.name) + ' <em>' + fits.length + '</em></h4>';
    bh += fits.length ? '<div class="grid">' + fits.map(it => tile(it)).join('') + '</div>' : '<p class="note">No ' + cname.toLowerCase() + ' gear in your pack yet.</p>';
    if (others.length) {
      bh += '<details class="others"><summary>Other classes <em>' + others.length + '</em></summary>';
      for (const c of L.CLASS_ORDER) {
        const list = others.filter(it => it.cls === c); if (!list.length) continue;
        const owners = who.filter(id => L.memberById(id).cls === c).map(id => esc(L.memberById(id).name));
        bh += '<div class="ogroup"><span class="slab">' + L.CLASSES[c].name + (owners.length ? ' &middot; ' + owners.join(', ') : ' &middot; ' + (camp() ? 'nobody can wear this yet' : 'nobody in your party')) + '</span><div class="grid">' + list.sort((a, b) => L.gearPct(b) - L.gearPct(a)).map(it => tile(it, true)).join('') + '</div></div>';
      }
      bh += '</details>';
    }
    if (!pack.length) bh = '<p class="note">Your pack is empty. Gear your party wears shows on each character above. New gear drops from foes, chests and guardians.</p>';
    const open = $('bag').querySelector('details.others[open]');
    $('bag').innerHTML = bh;
    if (open) { const d = $('bag').querySelector('details.others'); if (d) d.open = true; }
  }
  $('tab-gear').addEventListener('click', e => {
    const w = e.target.closest('[data-who]'); if (w) { gearWho = w.dataset.who; updateGear(true); return; }
    if (e.target.closest('[data-equip],#g-best') && !campGate()) return;
    const eq = e.target.closest('[data-equip]'); if (eq) { if (L.equip(S, gearWho, eq.dataset.equip)) { sfx.buy(); updateGear(true); updateSeats(true); } return; }
    if (e.target.closest('#g-best')) { const n = L.equipBest(S, gearWho), k = L.lockedSlots(S, gearWho); if (n) { sfx.buy(); toast('gear-armor', 'Best gear on', n + (n === 1 ? ' piece' : ' pieces') + ' equipped on ' + L.memberById(gearWho).name + '.' + (k ? ' Skipped ' + k + ' locked ' + (k === 1 ? 'slot' : 'slots') + '.' : ''), ''); updateGear(true); updateSeats(true); } return; }
    const ul = e.target.closest('[data-unlock]'); if (ul) { unlockModal(gearWho, ul.dataset.unlock); return; }
    const ps = e.target.closest('[data-pos]'); if (ps) { slotPicker(gearWho, ps.dataset.pos); return; }
    if (e.target.closest('#g-ward')) { openWardrobe('k', gearWho); return; }
    if (e.target.closest('.dfig')) { profileModal(gearWho); return; }
    const it = e.target.closest('[data-item]'); if (it) { if ((e.ctrlKey || e.metaKey) && linkItem(L.itemOf(S, it.dataset.item))) return; itemModal(it.dataset.item); }
  });
  ['tab-gear', 'tab-party', 'tab-camp', 'tab-market', 'tab-guild'].forEach(t => $(t).addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-item],[data-prof],[data-pos],[data-unlock]')) { e.preventDefault(); e.target.click(); } }));
  const itemStats = it => L.itemStats(it);
  function itemModal(uid) {
    const it = L.itemOf(S, uid); if (!it) return;
    let m = L.memberById(gearWho), w = L.wearer(S, uid);
    if (m.cls !== it.cls) { const o = gearOwners().find(id => L.memberById(id).cls === it.cls); if (o) { gearWho = o; m = L.memberById(o); } }
    const set = it.set && L.SETS.find(x => x.id === it.set), rs = it.rset != null && L.REGION_SETS[it.rset];
    const fits = m.cls === it.cls, rar = L.RARITY.find(r => r.id === it.rar);
    const leg = it.wb != null && L.WB_SETS[it.wb], shHave = leg ? L.shardsOf(S)[it.wb] || 0 : 0;
    const cost = leg ? L.wbUpCost(it) : L.upgradeCost(it), maxed = it.up >= L.UP_MAX;
    const reps = fits && !w ? L.replaces(S, gearWho, it) : [], ci = reps[0];
    const curStats = {}; for (const r of reps) for (const [k, v] of itemStats(r)) curStats[k] = (curStats[k] || 0) + v;
    const nextStats = maxed ? null : Object.fromEntries(itemStats(Object.assign({}, it, { up: it.up + 1 })));
    const pc = v => '+' + Math.round(v * 100) + '%';
    const stats = itemStats(it).map(([k, v]) => {
      const d = fits && !w ? Math.round((v - (curStats[k] || 0)) * 100) : 0;
      return '<div class="ist"><span>' + k + '</span><b>' + pc(v) + '</b>' + (fits && !w ? '<em class="' + (d > 0 ? 'up' : d < 0 ? 'down' : 'eq') + '">' + (d > 0 ? '&#9650; ' + d + '%' : d < 0 ? '&#9660; ' + (-d) + '%' : 'same') + '</em>' : '') + '</div>';
    }).join('');
    const pips = '<div class="upips" title="Upgrade level ' + it.up + ' of ' + L.UP_MAX + '">' + Array.from({ length: L.UP_MAX }, (_, i) => '<i class="' + (i < it.up ? 'on' : '') + '"></i>').join('') + '</div>';
    const wearer = w ? L.memberById(w) : null;
    const tool = (id, ic, label, extra) => '<button class="itool' + (extra ? ' ' + extra : '') + '" id="' + id + '">' + icon(ic) + '<span>' + label + '</span></button>';
    modal('<div class="icard r-' + it.rar + '">' +
      '<button class="iconbtn icx" id="i-close" aria-label="Close">&times;</button>' +
      '<div class="ihero"><div class="tile big r-' + it.rar + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + '</div>' +
      '<div class="ititle"><span class="irar">' + rar.name + ' ' + L.CLASSES[it.cls].name + ' ' + L.SLOT_NAME[it.slot] + '</span><h2>' + esc(L.gearName(it)) + '</h2>' + pips + '<small>Requires power level <b class="' + (fits && !w && !L.canWear(S, gearWho, it) ? 'bad' : '') + '">' + L.reqLevel(it) + '</b> &middot; found on floor ' + it.ilvl + '</small></div></div>' +
      '<div class="istats">' + stats + '</div>' +
      (fits && !w ? '<p class="icmp">' + (ci ? 'Compared with ' + esc(m.name) + '’s ' + reps.map(r => esc(L.gearName(r)) + (r.up ? ' +' + r.up : '')).join(' and ') + '.' : esc(m.name) + ' has an open ' + L.SLOT_NAME[it.slot].toLowerCase() + ' slot.') + (it.slot === 'robe' ? ' A robe covers the chest and legs.' : '') + '</p>' : '') +
      enchBlock(it) +
      (it.aff ? '<div class="iaff">' + icon('flame') + '<span><b>' + affText(it) + '</b><small>Counts while the wearer works the ' + jobName(it.aff.j) + ' job at the campfire.</small></span></div>' : '') +
      (it.jset ? (() => { const js = L.JOB_SETS[it.jset], n = wearer ? L.jobSetCount(S, w, it.jset) : 0; return '<div class="iset"><b>' + js.name + (wearer ? ' <em>' + n + '/3 worn</em>' : '') + '</b><small>A job set for the ' + jobName(it.jset) + '. It helps whoever wears it while they work that job at camp.</small><small><em>2 pieces</em> +' + Math.round(L.JOB_SET_TWO * 100) + '% ' + jobName(it.jset) + ' output</small><small><em>3 pieces</em> +' + Math.round(L.JOB_SET_THREE * 100) + '% ' + jobName(it.jset) + ' output</small></div>'; })() : '') +
      (set ? '<div class="iset"><b>' + set.name + '</b><small><em>2 pieces</em> ' + set.two + '</small><small><em>3 pieces</em> ' + set.three + '</small><small class="lore">' + esc(set.lore) + '</small>' + setWhere('class') + '</div>' : '') +
      (rs ? (() => { const n = wearer ? (L.rsetCounts(S, w)[it.rset] || 0) : 0; return '<div class="iset rset"><b>' + rs.name + (wearer ? ' <em>' + n + '/4 worn</em>' : '') + '</b><small>A region set from ' + esc(regionName(it.rset)) + '. Head, chest, legs and feet, for any class. The bonuses multiply all of the wearer’s gear.</small><small><em>2 pieces</em> ' + rsetTwoText(it.rset) + '</small><small><em>4 pieces</em> ' + rsetFourText(it.rset) + '</small><small class="lore">' + esc(rs.lore) + '</small>' + setWhere('rset', it.rset) + '</div>'; })() : '') +
      (leg ? (() => { const n = wearer ? (L.wbCounts(S, w)[it.wb] || 0) : 0, k = { hp: 'health', dps: 'damage', heal: 'healing (health for non-healers)', gold: 'gold for the whole party' }[leg.k]; return '<div class="iset legset"><b>' + leg.name + (wearer ? ' <em>' + n + '/4 worn</em>' : '') + '</b><small>A world boss Legendary. Weapon, chest, ring and amulet. Bound to you. Upgrade it with ' + leg.word + ' shards, not gold.</small><small><em>2 pieces</em> +' + Math.round(L.WB_TWO[leg.k] * 100) + '% ' + k + '</small><small><em>4 pieces</em> +' + Math.round(L.WB_FOUR * 100) + '% damage and health (healing for healers)</small><small class="lore">' + esc(leg.lore) + '</small></div>'; })() : '') +
      (it.rar === 'goblin' ? '<div class="iset gobset"><b>The Loot Goblin’s Sack</b><small>+' + pct100(L.GOBLIN_SACK_GOLD) + ' gold for the whole party while worn. Roughly one Loot Goblin in ' + Math.round(1 / L.GOBLIN_SACK_CHANCE).toLocaleString('en-US') + ' drops it.</small><small class="lore">Still lumpy with whatever he stole last. Nobody has been brave enough to empty it.</small></div>' : '') +
      (wearer ? '<div class="iworn"><img src="' + SP.spriteURL(wearer.cls, 2, lookHue(wearer)) + '" alt="">Worn by <b>' + esc(wearer.name) + '</b></div>' : '') +
      '<div class="iacts">' +
      (w ? '<button class="btn ghost" id="i-off">Take off</button>' : fits ? (L.canWear(S, gearWho, it) ? '<button class="btn" id="i-on">Equip on ' + esc(m.name) + '</button>' : '<button class="btn" disabled>' + esc(m.name) + ' needs power level ' + L.reqLevel(it) + '</button>') : '<button class="btn" disabled>No ' + L.CLASSES[it.cls].name + ' in your roster yet</button>') +
      (maxed ? '<button class="btn ghost" disabled>Fully upgraded</button>' : '<button class="btn ghost iup" id="i-up"' + ((leg ? cost > shHave : cost > S.gold) ? ' disabled' : '') + '><span>Upgrade to +' + (it.up + 1) + '</span><small>' + (leg ? icon('relic') + cost + ' ' + leg.word + ' shard' + (cost === 1 ? '' : 's') + ' (you have ' + shHave + ')' : icon('coin') + fmt(cost)) + ' &middot; ' + Object.entries(nextStats).map(([k, v]) => k.toLowerCase() + ' ' + pc(v)).join(', ') + '</small></button>') +
      '</div><div class="itools">' +
      tool('i-lk', 'lock', it.lk ? 'Unlock' : 'Lock', it.lk ? 'on' : '') +
      (S.bag.some(x => L.mergeable(it, x)) ? tool('i-merge', 'relic', 'Merge', it.lk ? 'off' : '') : '') +
      (L.sockets(it) && S.bag.some(x => x !== it && L.enchList(x).length && !x.lk && !L.wearer(S, x.uid)) ? tool('i-ench', 'star', 'Enchant') : '') +
      (L.enchList(it).length ? tool('i-dis', 'flare', 'Disenchant', it.lk || w ? 'off' : '') : '') +
      (CL ? (bound(it) ? '' : tool('i-mkt', 'coin', 'Sell', it.lk ? 'off' : '') + tool('i-send', 'users', 'Send', it.lk ? 'off' : '')) + tool('i-link', 'chat', 'Link') : '') +
      tool('i-sell', 'flame', 'Salvage ' + fmt(L.salvageValue(it)), 'danger' + (it.lk ? ' off' : '')) + '</div>' +
      (bound(it) ? '<p class="note ibound">' + icon('lock') + 'Bound to your Hold. It cannot be sold on the market or sent by mail.</p>' : '') +
      (it.lk ? '<p class="note ilocked">' + icon('lock') + 'Locked. Mass scrap, a full pack and the Loot Goblin all leave it alone' + (w ? ', and Equip best keeps it in its slot' : '') + '. Unlock it to sell, send, salvage or swap it out.</p>' : '') + '</div>', md => {
        const locked = () => { toast('lock', 'This item is locked', 'Unlock it first to sell, send or salvage it.', 'warn'); };
        md.querySelector('#i-lk').onclick = () => { const on = L.toggleLock(S, uid); sfx.buy(); save(); updateGear(true); itemModal(uid); toast('lock', on ? 'Item locked' : 'Item unlocked', on ? L.gearName(it) + ' is safe from mass scrap, auto-sell and the Loot Goblin' + (w ? ', and Equip best leaves it in its slot.' : '.') : L.gearName(it) + ' can be scrapped and sold again.', ''); };
        const gate = f => () => { if (it.lk) return locked(); if (!gateUse('sell')) return; if (!signedIn()) { closeModal(); toast('lock', 'Sign in to trade', 'The market and mail need a free account.', 'warn'); authForm('in'); return; } f(uid); };
        const en = md.querySelector('#i-ench'); if (en) en.onclick = () => atEnchanter('on', uid);
        const ds = md.querySelector('#i-dis'); if (ds) ds.onclick = () => { if (it.lk) return toast('lock', 'This item is locked', 'Unlock it first to disenchant it.', 'warn'); if (w) return toast('flare', 'Take it off first', 'Worn gear cannot be disenchanted.', 'warn'); atEnchanter('dis', uid); };
        const mg = md.querySelector('#i-merge'); if (mg) mg.onclick = () => { if (it.lk) return toast('lock', 'This item is locked', 'Unlock it first to merge it.', 'warn'); mergePicker(uid); };
        const mk = md.querySelector('#i-mkt'); if (mk) mk.onclick = gate(sellItem);
        const sd = md.querySelector('#i-send'); if (sd) sd.onclick = gate(sendItem);
        const lk = md.querySelector('#i-link'); if (lk) lk.onclick = () => { closeModal(); linkItem(it); };
        const re = () => { updateGear(true); updateSeats(true); itemModal(uid); };
        const on = md.querySelector('#i-on'); if (on) on.onclick = () => { if (!campGate()) return; if (!L.equip(S, gearWho, uid)) return toast('lock', 'Slot is locked', 'Every slot this fits holds a locked piece, or this piece is locked on someone else. Unlock it first.', 'warn'); sfx.buy(); re(); };
        const off = md.querySelector('#i-off'); if (off) off.onclick = () => { if (!campGate()) return; L.unequip(S, w, L.wornPos(S, uid)); re(); };
        const up = md.querySelector('#i-up'); if (up) up.onclick = () => { if (!campGate()) return; if (L.upgrade(S, uid)) { sfx.relic(); re(); } };
        const sv = md.querySelector('#i-sell');
        sv.onclick = () => {
          if (it.lk) return locked();
          if (!sv.classList.contains('confirm') && (it.rar === 'epic' || it.rar === 'set' || it.up || w)) { sv.classList.add('confirm'); sv.querySelector('span').textContent = 'Tap again to salvage'; return; }
          const v = L.salvage(S, uid); sfx.coin(); closeModal(); updateGear(true); updateSeats(true); toast('coin', 'Salvaged', '+' + fmt(v) + ' gold, +' + L.dustValue(it) + ' Dust', '');
        };
        md.querySelector('#i-close').onclick = closeModal;
      });
  }




  // ---------- enchantments: sockets on each item, and moving an enchant from one item to another ----------
  const ROMAN9 = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
  const enchName = x => L.ENCH[x.id].name + ' ' + ROMAN9[x.t];
  function enchBlock(it) {
    const n = L.sockets(it), l = L.enchList(it); if (!n) return '';
    let h = '';
    for (let i = 0; i < n; i++) h += l[i] ? '<div class="esock on"><i></i><b>' + enchName(l[i]) + '</b><small>' + L.enchText(l[i]) + '</small></div>' : '<div class="esock"><i></i><small>Empty socket</small></div>';
    return '<div class="iench"><div class="ienh">Enchant sockets ' + tipI('Sockets come from rarity and item level (one more at floor 30 and at floor 80). Most enchants help the whole party while anyone in it wears the item. Flow, Leech, Bulwark and Plating help only the hero wearing it. Use Disenchant on another item to move one of its enchants here.') + '</div>' + h + '</div>';
  }
  // ---------- the Enchanter (John, 2026-11-24) ----------
  // Enchanting and disenchanting happen on a visit to the Enchanter, like stopping at the campfire: the dive pauses
  // while you are there, then you leave and carry on from the same floor. v99: everything is done in the counter panel
  // under the shop scene, one plain question at a time, with what you picked shown on the counter. No pop-ups.
  // EW: mode 'on' (pick the item, then the enchant for it), 'dis' (pick a spare item, then where its enchant goes) or 'scrap'.
  const EW = { mode: 'on', dst: null, src: null, idx: null, slot: null, done: null };
  function ewReset(mode, keep) { Object.assign(EW, { mode: mode || EW.mode, dst: null, src: null, idx: null, slot: null, done: keep ? EW.done : null }); }
  const enchSpare = x => !x.lk && !L.wearer(S, x.uid);
  function atEnchanter(t, uid) {
    const pre = () => { ewReset(t || 'on'); if (uid) { if (t === 'dis') EW.src = uid; else EW.dst = uid; } };
    if (L.visiting(S)) { pre(); closeModal(); paintEnchOv(); return; }
    modal('<div class="merchbox enchvisit"><div class="merchhead"><img src="' + SP.spriteURL('enchanter', 4, 0) + '" alt=""><div><h2>That is done at the Enchanter</h2><small>Enchanting and disenchanting happen in the Enchanter’s shop. Your party leaves the Deep while you are there and goes back to floor ' + S.floor + ' when you leave.</small></div></div>' +
      '<div class="row"><button class="btn ghost" id="ev-no">Not now</button><button class="btn" id="ev-go">Go to the Enchanter</button></div></div>', md => {
        md.querySelector('#ev-no').onclick = closeModal;
        md.querySelector('#ev-go').onclick = () => { pre(); visitEnch(); };
      });
  }
  function visitEnch(kind) {
    kind = kind === 'arm' || kind === 'store' ? kind : 'ench';
    if (L.visiting(S)) S.shopK = kind; else if (!L.visitEnchanter(S, Date.now(), kind)) return false;
    closeModal(); sfx.relic(); particles.length = 0; paintEnchOv(); updatePanel(true);
    const a = document.querySelector('.stagehead') || $('arena'); if (a && a.scrollIntoView && innerWidth < 900) a.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return true;
  }
  function leaveEnch() {
    if (!L.leaveEnchanter(S)) return;
    closeModal(); sfx.buy(); particles.length = 0; ewReset('on'); awReset('up'); paintEnchOv(); updatePanel(true); save();
    toast('star', 'Back to the dive', 'The party carries on from floor ' + S.floor + '.', '');
  }
  function enchanterModal(t) { if (!L.visiting(S)) ewReset(t || 'on'); visitEnch('ench'); }
  function armorerModal(t) { if (!L.visiting(S) || shopKind() !== 'arm') awReset(t || 'up'); visitEnch('arm'); }
  // The Armorer: upgrade an item with gold, merge two copies, or scrap spare gear for gold (more gold than the Enchanter
  // pays, but no Dust). AW: mode 'up' | 'merge' | 'smelt'; a = the item picked, b = the copy merged into it.
  const AW = { mode: 'up', a: null, b: null, done: null };
  function awReset(mode, keep) { Object.assign(AW, { mode: mode || AW.mode, a: null, b: null, done: keep ? AW.done : null }); }
  const riskTxt = v => Math.round(v * 1000) / 10 + '%';
  const upCostTag = x => { if (x.wb != null) { const c = L.wbUpCost(x), h = L.shardsOf(S)[x.wb] || 0; return '<span class="ewcost legc' + (h < c ? ' short' : '') + '">' + icon('relic') + c + ' shard' + (c === 1 ? '' : 's') + '</span>'; }
    const c = L.upgradeCost(x); return '<span class="ewcost gold' + (S.gold < c ? ' short' : '') + '">' + icon('coin') + fmt(c) + '</span>'; };
  const SW = { mode: 'ton' };
  let stBusy = false;
  function storePanelHtml() {
    const now = Date.now(), gold = '<span class="epdust">' + icon('coin') + '<b>' + fmt(S.gold) + '</b> gold</span>';
    const tabs = '<div class="ewtabs shop" role="tablist">' + [['ton', 'Tonics'], ['sup', 'Supplies']].map(([k, n]) => '<button role="tab" class="' + (SW.mode === k ? 'on' : '') + '" data-swmode="' + k + '">' + n + '</button>').join('') + '</div>';
    const bal = typeof prof !== 'undefined' && prof ? '<span class="stbal">' + sigil + fmt(prof.bal) + ' ' + TOKEN + '</span>' : '';
    const head = '<div class="ephead"><b>Old Thessaly’s counter</b>' + bal + gold + '</div>' + tabs;
    const list = SW.mode === 'sup' ? L.SHOP.filter(x => !L.tonicById(x.id)) : L.TONICS;
    const hint = SW.mode === 'sup' ? 'Supplies for the road. Use a Campfire Draught from the camp bar. Lantern Oil appears under the lantern during guardian fights.' : 'Each tonic is a small boost for a short time. Different tonics stack, and drinking the same one again adds time, up to 60 minutes.';
    return head + '<h3 class="ewq">' + (SW.mode === 'sup' ? 'What supplies do you need?' : 'Which tonic would you like?') + '</h3><p class="ewhint">' + hint + '</p>' +
      '<div class="tlist store">' + list.map(it => storeRow(it, now)).join('') + '</div>' +
      (wardOn() ? '<button class="btn ghost small stward" data-swward="1">' + icon('star') + 'Open the Wardrobe</button>' : '') +
      '<p class="note small">Gold prices follow how much gold you earn. Speed-ups can also be bought with ' + TOKEN + '.</p>';
  }
  $('enchpanel') && $('enchpanel').addEventListener('click', async e => {
    if (shopKind() !== 'store') return;
    const t = e.target.closest('[data-swmode],[data-buy],[data-drink],[data-sbuy],[data-swward]'); if (!t) return;
    const d = t.dataset;
    if (d.swmode) { SW.mode = d.swmode; return paintEnchPanel(true); }
    if (d.swward) return openWardrobe('k');
    if (d.buy) { if (L.buyShop(S, d.buy, 1)) { sfx.coin(); save(); shopBurst(); paintEnchPanel(true); paintCamp(); paintTonics(); } return; }
    if (d.drink) return drink(d.drink);
    if (d.sbuy) {
      if (stBusy) return; stBusy = true; t.disabled = true;
      try { const r = await papi('POST', '/store/pass', { what: 'item', id: d.sbuy, n: 1 }); prof.bal = r.bal; S.items[d.sbuy] = (S.items[d.sbuy] || 0) + 1; save(); try { pushCloud(true); } catch (x) {} sfx.buy(); shopBurst(); paintEnchPanel(true); paintCamp(); paintTonics(); }
      catch (x) { t.disabled = false; toast('lock', 'That did not go through', x.code === 'funds' ? 'Not enough ' + TOKEN + '.' : 'Try again in a moment.', 'warn'); }
      stBusy = false;
    }
  });
  function armPanelHtml() {
    const gold = '<span class="epdust">' + icon('coin') + '<b>' + fmt(S.gold) + '</b> gold</span>';
    const tabs = '<div class="ewtabs forge" role="tablist">' + [['up', 'Upgrade'], ['merge', 'Merge'], ['smelt', 'Scrap for gold']].map(([k, n]) => '<button role="tab" class="' + (AW.mode === k ? 'on' : '') + '" data-awmode="' + k + '">' + n + '</button>').join('') + '</div>';
    const head = '<div class="ephead"><b>The Armorer’s counter</b>' + gold + '</div>' + tabs + (AW.done ? '<div class="ewdone">' + icon('star') + '<span>' + AW.done + '</span></div>' : '');
    const A = AW.a && L.itemOf(S, AW.a), B = AW.b && L.itemOf(S, AW.b);
    if (AW.a && !A) AW.a = null; if (AW.b && !B) AW.b = null;
    const byWorn = (a, b) => (!!L.wearer(S, b.uid) - !!L.wearer(S, a.uid)) || (L.itemScore(b) - L.itemScore(a));
    if (AW.mode === 'smelt') {
      const list = scrapList(), g = list.reduce((a, it) => a + L.smeltValue(it), 0);
      return head + '<h3 class="ewq">Which gear should the Armorer melt down for gold?</h3><p class="ewhint">The forge pays ' + L.SMELT_MULT + '× the gold of a normal scrap, but gives no Dust. Worn and locked items are never melted.</p>' +
        '<div class="ewrar">' + L.RARITY.map(r => '<button class="ewchip r-' + r.id + (scrapOpts[r.id] ? ' sel' : '') + '" data-ewrar="' + r.id + '"><b style="color:var(--rc)">' + r.name + '</b><small>' + S.bag.filter(x => x.rar === r.id && enchSpare(x)).length + ' spare</small></button>').join('') + '</div>' +
        '<label class="chk"><input type="checkbox" data-ewopt="keepBest"' + (scrapOpts.keepBest ? ' checked' : '') + '><span><b>Keep the best spare of each kind</b></span></label>' +
        '<label class="chk"><input type="checkbox" data-ewopt="keepUp"' + (scrapOpts.keepUp ? ' checked' : '') + '><span><b>Keep upgraded pieces</b></span></label>' +
        '<div class="ewsum">' + (list.length ? '<p><b>' + list.length + '</b> ' + (list.length === 1 ? 'piece becomes' : 'pieces become') + ' <b>' + fmt(g) + ' gold</b>.</p>' : '<p>Nothing matches. Tick more rarities above.</p>') +
        '<button class="btn danger" data-awgo="smelt"' + (list.length ? '' : ' disabled') + '>Melt ' + list.length + '</button></div>';
    }
    let steps, cur = 0, body = '', picked = '';
    if (AW.mode === 'up') {
      steps = ['Item', 'Upgrade'];
      if (!A) {
        body = '<h3 class="ewq">Which item do you want to upgrade?</h3><p class="ewhint">Each upgrade raises an item one level for gold. Worn gear works too.</p>' +
          ewList(S.bag.filter(x => x.up < L.UP_MAX).sort(byWorn).slice(0, 60).map(x => ewItemRow(x, 'data-awa="' + x.uid + '"', 'Upgrade to +' + (x.up + 1) + ewWorn(x), upCostTag(x))), 'Nothing left to upgrade.');
      } else {
        cur = 1; picked = ewPicked('Upgrading', A, ewName(A), 'a');
        const lg = A.wb != null && L.WB_SETS[A.wb], c = lg ? L.wbUpCost(A) : L.upgradeCost(A), have = lg ? L.shardsOf(S)[A.wb] || 0 : S.gold, unit = lg ? lg.word + ' shard' + (c === 1 ? '' : 's') : 'gold', max = A.up >= L.UP_MAX;
        body = '<div class="ewsum">' + (max ? '<p><b>' + ewName(A) + '</b> is fully upgraded.</p>' : '<p><b>' + ewName(A) + '</b> becomes <b>+' + (A.up + 1) + '</b>.</p><p>Costs ' + icon(lg ? 'relic' : 'coin') + '<b>' + fmt(c) + ' ' + unit + '</b>' + (have < c ? '. You have ' + fmt(have) + '.' : '.') + '</p>') +
          '<button class="btn" data-awgo="up"' + (max || have < c ? ' disabled' : '') + '>' + (max ? 'Fully upgraded' : have < c ? 'Not enough ' + (lg ? 'shards' : 'gold') : 'Upgrade for ' + fmt(c) + ' ' + unit) + '</button></div>';
      }
    } else {
      steps = ['Item', 'Copy to merge in', 'Confirm'];
      if (A) picked += ewPicked('Merging', A, ewName(A), 'a');
      if (B) picked += ewPicked('With', B, ewName(B), 'b');
      if (!A) {
        body = '<h3 class="ewq">Which item do you want to merge?</h3><p class="ewhint">Two copies of the same item become one, a level higher. If it fails, both are lost.</p>' +
          ewList(S.bag.filter(x => !x.lk && x.up < L.UP_MAX && S.bag.some(y => y !== x && !y.lk && L.mergeable(x, y))).sort(byWorn).slice(0, 60).map(x => ewItemRow(x, 'data-awa="' + x.uid + '"', S.bag.filter(y => y !== x && !y.lk && L.mergeable(x, y)).length + ' matching ' + (S.bag.filter(y => y !== x && !y.lk && L.mergeable(x, y)).length === 1 ? 'copy' : 'copies') + ewWorn(x), '')), 'No item has a matching copy yet. Copies of the same item can be merged.');
      } else if (!B) {
        cur = 1;
        body = '<h3 class="ewq">Which copy should go into it?</h3><p class="ewhint">The copy is used up. The lower the result, the lower the risk.</p>' +
          ewList(S.bag.filter(y => y !== A && !y.lk && L.mergeable(A, y)).sort((p, q) => q.up - p.up).map(x => ewItemRow(x, 'data-awb="' + x.uid + '"', 'Result +' + L.mergeRisk(S, A, x).to + ewWorn(x), '<span class="ewcost">' + riskTxt(L.mergeRisk(S, A, x).risk) + ' risk</span>')), 'No matching copy left.');
      } else {
        cur = 2; const r = L.mergeRisk(S, A, B), worn = L.wearer(S, A.uid) || L.wearer(S, B.uid);
        body = '<div class="ewsum"><div class="mgodds"><div><small>Result</small><b>+' + r.to + '</b></div><div class="ok"><small>Success</small><b>' + riskTxt(1 - r.risk) + '</b></div><div class="bad"><small>Both destroyed</small><b>' + riskTxt(r.risk) + '</b></div></div>' +
          '<p class="ewhint">Base risk ' + riskTxt(r.base) + ', cut by ' + Math.round(r.cut * 100) + '% from Luck and Intelligence.</p>' + (worn ? '<p class="warn">A worn piece is part of this merge. If it fails, that slot ends up empty.</p>' : '') +
          '<button class="btn danger" data-awgo="merge">Merge to +' + r.to + '</button></div>';
      }
    }
    const stepper = '<ol class="ewsteps">' + steps.map((s, i) => '<li class="' + (i < cur ? 'done' : i === cur ? 'cur' : '') + '"><i>' + (i < cur ? '&#10003;' : i + 1) + '</i>' + s + '</li>').join('') + '</ol>';
    return head + stepper + (picked ? '<div class="ewpicked">' + picked + '</div>' : '') + body;
  }
  // pieces of the panel
  const ewTile = x => '<div class="tile r-' + x.rar + '"><img class="iimg" src="' + SP.itemIcon(x.cls, x.slot, x.rar) + '" alt="">' + (x.up ? '<i class="upn">+' + x.up + '</i>' : '') + '</div>';
  const ewName = x => esc(L.gearName(x)) + (x.up ? ' +' + x.up : '');
  const ewDots = x => { const n = L.sockets(x), l = L.enchList(x); let h = '<span class="ewdots" title="' + l.length + ' of ' + n + ' sockets used">'; for (let i = 0; i < n; i++) h += '<i' + (l[i] ? ' class="on"' : '') + '></i>'; return h + '</span>'; };
  const ewWorn = x => { const w = L.wearer(S, x.uid); return w ? ' &middot; <i class="worn">worn by ' + esc(L.memberById(w).name) + '</i>' : ''; };
  const ewCost = e => '<span class="ewcost' + ((S.dust || 0) < L.enchCost(e) ? ' short' : '') + '">' + icon('dust') + fmt(L.enchCost(e)) + '</span>';
  function ewTargets(excl) {
    return S.bag.filter(x => x.uid !== excl && L.sockets(x)).sort((a, b) => (!!L.wearer(S, b.uid) - !!L.wearer(S, a.uid)) || ((L.sockets(b) - L.enchList(b).length) - (L.sockets(a) - L.enchList(a).length)) || (L.itemScore(b) - L.itemScore(a)));
  }
  function ewSources(excl) {
    const out = []; for (const x of S.bag) if (x.uid !== excl && enchSpare(x)) L.enchList(x).forEach((e, i) => out.push({ x, e, i }));
    return out.sort((p, q) => q.e.t - p.e.t || L.enchCost(p.e) - L.enchCost(q.e));
  }
  function ewList(rows, empty) { return rows.length ? '<div class="ewlist">' + rows.join('') + '</div>' : '<p class="ewempty">' + empty + '</p>'; }
  function ewItemRow(x, attr, sub, right) {
    return '<button class="ewrow r-' + x.rar + '" ' + attr + '>' + ewTile(x) + '<span class="ewt"><b>' + ewName(x) + '</b><small>' + sub + '</small></span>' + (right || '') + '</button>';
  }
  // What you have picked so far, each with a way to change it.
  function ewPicked(label, x, what, undo) {
    return '<div class="ewpick">' + ewTile(x) + '<span class="ewt"><small>' + label + '</small><b>' + what + '</b></span><button class="btn ghost small" data-ewundo="' + undo + '">Change</button></div>';
  }
  function enchPanelHtml() {
    const dust = '<span class="epdust" data-tip="Dust pays for moving enchants. Scrap spare gear to get more.">' + icon('dust') + '<b>' + fmt(S.dust || 0) + '</b> Dust</span>';
    const tabs = '<div class="ewtabs" role="tablist">' + [['on', 'Enchant an item'], ['dis', 'Disenchant'], ['scrap', 'Scrap for Dust']].map(([k, n]) => '<button role="tab" class="' + (EW.mode === k ? 'on' : '') + '" data-ewmode="' + k + '">' + n + '</button>').join('') + '</div>';
    let body = '', steps = [], cur = 0;
    const done = EW.done ? '<div class="ewdone">' + icon('star') + '<span>' + EW.done + '</span></div>' : '';
    if (EW.mode === 'scrap') {
      const list = scrapList(), gold = list.reduce((a, it) => a + L.salvageValue(it), 0), dd = list.reduce((a, it) => a + L.dustValue(it), 0);
      body = '<h3 class="ewq">Which gear should the Enchanter break down for Dust?</h3><p class="ewhint">Worn and locked items are never scrapped. You also get gold.</p>' +
        '<div class="ewrar">' + L.RARITY.map(r => '<button class="ewchip r-' + r.id + (scrapOpts[r.id] ? ' sel' : '') + '" data-ewrar="' + r.id + '"><b style="color:var(--rc)">' + r.name + '</b><small>' + S.bag.filter(x => x.rar === r.id && enchSpare(x)).length + ' spare</small></button>').join('') + '</div>' +
        '<label class="chk"><input type="checkbox" data-ewopt="keepBest"' + (scrapOpts.keepBest ? ' checked' : '') + '><span><b>Keep the best spare of each kind</b></span></label>' +
        '<label class="chk"><input type="checkbox" data-ewopt="keepUp"' + (scrapOpts.keepUp ? ' checked' : '') + '><span><b>Keep upgraded pieces</b></span></label>' +
        '<div class="ewsum">' + (list.length ? '<p><b>' + list.length + '</b> ' + (list.length === 1 ? 'piece' : 'pieces') + ' become <b>' + fmt(dd) + ' Dust</b> and <b>' + fmt(gold) + ' gold</b>.</p>' : '<p>Nothing matches. Tick more rarities above.</p>') +
        '<button class="btn danger" data-ewgo="scrap"' + (list.length ? '' : ' disabled') + '>Scrap ' + list.length + '</button></div>';
      return '<div class="ephead"><b>The Enchanter’s counter</b>' + dust + '</div>' + tabs + done + body;
    }
    const A = EW.src && L.itemOf(S, EW.src), B = EW.dst && L.itemOf(S, EW.dst);
    if (EW.src && !A) EW.src = null; if (EW.dst && !B) EW.dst = null;
    const la = A ? L.enchList(A) : [];
    if (A && la.length === 1) EW.idx = 0; if (A && EW.idx != null && !la[EW.idx]) EW.idx = null;
    const mv = A && EW.idx != null ? la[EW.idx] : null;
    const lb = B ? L.enchList(B) : [], n = B ? L.sockets(B) : 0, full = B && lb.length >= n;
    if (B && !full) EW.slot = lb.length; else if (B && EW.slot != null && EW.slot >= n) EW.slot = null;
    let picked = '';
    if (EW.mode === 'on') {
      steps = ['Item', 'Enchant', 'Confirm'];
      if (B) picked += ewPicked('Enchanting', B, ewName(B) + ' ' + ewDots(B), 'dst');
      if (mv) picked += ewPicked('Adding', A, enchName(mv) + ' <small>' + L.enchText(mv) + '</small>', 'src');
      if (!B) {
        cur = 0;
        body = '<h3 class="ewq">Which item do you want to enchant?</h3><p class="ewhint">Gear your party is wearing works too. The dots show its sockets.</p>' +
          ewList(ewTargets().slice(0, 60).map(x => ewItemRow(x, 'data-ewdst="' + x.uid + '"', (L.enchList(x).map(enchName).join(', ') || 'No enchants yet') + ewWorn(x), ewDots(x))), 'None of your items has an enchant socket yet. Rarer gear and gear from deeper floors has more.');
      } else if (!mv) {
        cur = 1;
        const src = ewSources(B.uid);
        body = '<h3 class="ewq">Which enchant should go on it?</h3><p class="ewhint">These come from your spare gear. The spare item is used up.</p>' +
          ewList(src.slice(0, 80).map(r => ewItemRow(r.x, 'data-ewsrc="' + r.x.uid + '" data-ewi="' + r.i + '"', '<span class="ewen">' + enchName(r.e) + '</span> ' + L.enchText(r.e) + ' &middot; from ' + ewName(r.x), ewCost(r.e))), 'No spare enchants. Enchants come on found gear; keep a spare piece that has one and it will show up here.');
      }
    } else {
      steps = ['Spare item', 'Where it goes', 'Confirm'];
      if (A) picked += ewPicked('Taking from', A, mv ? enchName(mv) + ' <small>' + L.enchText(mv) + '</small>' : ewName(A), 'src');
      if (B) picked += ewPicked('Putting on', B, ewName(B) + ' ' + ewDots(B), 'dst');
      if (!A) {
        cur = 0;
        body = '<h3 class="ewq">Which spare item do you want to break down?</h3><p class="ewhint">You keep one of its enchants and move it to another item. The spare item is used up.</p>' +
          ewList(S.bag.filter(x => enchSpare(x) && L.enchList(x).length).slice(0, 60).map(x => ewItemRow(x, 'data-ewsrcitem="' + x.uid + '"', L.enchList(x).map(e => '<span class="ewen">' + enchName(e) + '</span>').join(', '), '')), 'Nothing to disenchant. Spare items with enchants show up here. Worn and locked items do not.');
      } else if (!mv) {
        cur = 0;
        body = '<h3 class="ewq">Which enchant do you want to keep?</h3><div class="ewchips">' + la.map((e, i) => '<button class="ewchip" data-ewidx="' + i + '"><b>' + enchName(e) + '</b><small>' + L.enchText(e) + '</small>' + ewCost(e) + '</button>').join('') + '</div>';
      } else if (!B) {
        cur = 1;
        body = '<h3 class="ewq">Which item should get ' + enchName(mv) + '?</h3><p class="ewhint">Gear your party is wearing works too. The dots show its sockets.</p>' +
          ewList(ewTargets(A.uid).slice(0, 60).map(x => ewItemRow(x, 'data-ewdst="' + x.uid + '"', (L.enchList(x).map(enchName).join(', ') || 'No enchants yet') + ewWorn(x), ewDots(x))), 'No other item has an enchant socket yet.');
      }
    }
    if (A && B && mv) {
      cur = 2;
      const cost = L.enchCost(mv), have = S.dust || 0, rep = EW.slot != null ? lb[EW.slot] : null;
      if (full) body += '<h3 class="ewq">' + ewName(B) + ' is full. Which enchant should ' + enchName(mv) + ' replace?</h3><div class="ewchips">' + lb.map((e, i) => '<button class="ewchip' + (EW.slot === i ? ' sel' : '') + '" data-ewslot="' + i + '"><b>' + enchName(e) + '</b><small>' + L.enchText(e) + '</small></button>').join('') + '</div>';
      const ready = EW.slot != null, ok = ready && have >= cost;
      body += '<div class="ewsum"><p><b>' + enchName(mv) + '</b> goes onto <b>' + ewName(B) + '</b>' + (rep ? ', replacing ' + enchName(rep) : '') + '.</p>' +
        '<p class="warn">' + ewName(A) + ' is used up' + (L.enchList(A).length > 1 ? ' with its other enchants' : '') + '.</p>' +
        '<p>Costs ' + icon('dust') + '<b>' + fmt(cost) + ' Dust</b>' + (have < cost ? '. You have ' + fmt(have) + '. Scrap spare gear for more.' : '.') + '</p>' +
        '<button class="btn" data-ewgo="move"' + (ok ? '' : ' disabled') + '>' + (!ready ? 'Pick the enchant to replace' : have < cost ? 'Not enough Dust' : (EW.mode === 'dis' ? 'Move it for ' : 'Enchant for ') + fmt(cost) + ' Dust') + '</button></div>';
    }
    const stepper = '<ol class="ewsteps">' + steps.map((s, i) => '<li class="' + (i < cur ? 'done' : i === cur ? 'cur' : '') + '"><i>' + (i < cur ? '&#10003;' : i + 1) + '</i>' + s + '</li>').join('') + '</ol>';
    return '<div class="ephead"><b>The Enchanter’s counter</b>' + dust + '</div>' + tabs + done + stepper + (picked ? '<div class="ewpicked">' + picked + '</div>' : '') + body;
  }
  function paintEnchPanel(force) {
    const el = $('enchpanel'); if (!el) return; const on = L.visiting(S);
    el.hidden = !on; if (!on) { el.dataset.h = ''; return; }
    const kind = shopKind(), arm = kind === 'arm', h = kind === 'store' ? storePanelHtml() : arm ? armPanelHtml() : enchPanelHtml(); if (!force && el.dataset.h === h) return;
    const step = kind === 'store' ? 's' + SW.mode : arm ? 'a' + AW.mode + !!AW.a + !!AW.b : EW.mode + !!EW.dst + !!EW.src + EW.idx;
    const sc = el.querySelector('.ewlist'), top = sc ? sc.scrollTop : 0, same = el.dataset.step === step;
    el.innerHTML = h; el.dataset.h = h; el.dataset.step = step;
    if (!same) el.scrollTop = 0;
    const sc2 = el.querySelector('.ewlist'); if (sc2 && same) sc2.scrollTop = top;
    const sum = el.querySelector('.ewsum'); if (sum && !same && sum.scrollIntoView) sum.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function ewSet(o) { Object.assign(EW, o, { done: null }); paintEnchPanel(true); paintEnchOv(); }
  $('enchpanel') && $('enchpanel').addEventListener('click', e => {
    const t = e.target.closest('[data-ewmode],[data-ewdst],[data-ewsrc],[data-ewsrcitem],[data-ewidx],[data-ewslot],[data-ewundo],[data-ewrar],[data-ewgo],[data-awmode],[data-awa],[data-awb],[data-awgo]'); if (!t) return;
    const d = t.dataset;
    if (d.awmode) { awReset(d.awmode); return paintEnchPanel(true); }
    if (d.awa) { Object.assign(AW, { a: d.awa, b: null, done: null }); return paintEnchPanel(true); }
    if (d.awb) { Object.assign(AW, { b: d.awb, done: null }); return paintEnchPanel(true); }
    if (d.ewundo && shopKind() === 'arm') { if (d.ewundo === 'a') Object.assign(AW, { a: null, b: null }); else AW.b = null; AW.done = null; return paintEnchPanel(true); }
    if (d.awgo === 'up') {
      const it = L.itemOf(S, AW.a); if (!it || !L.upgrade(S, it.uid)) return;
      save(); updateGear(true); updateSeats(true); sfx.relic(); shopBurst();
      AW.done = esc(L.gearName(it)) + ' is now +' + it.up + '.'; return paintEnchPanel(true);
    }
    if (d.awgo === 'merge') {
      const res = L.mergeItems(S, AW.a, AW.b, null, events); if (!res) return;
      save(); updateGear(true); updateSeats(true);
      if (res.ok) { sfx.relic(); shopBurst(); awReset('merge'); AW.done = esc(L.gearName(res.item)) + ' is now +' + res.item.up + '. +' + fmt(res.xp) + ' hero XP.'; }
      else { sfx.coin(); awReset('merge'); AW.done = 'The merge failed and both ' + esc(L.gearName(res.a)) + ' pieces were lost. +' + fmt(res.xp) + ' hero XP for trying.'; }
      return paintEnchPanel(true);
    }
    if (d.awgo === 'smelt') {
      const l = scrapList(); if (!l.length) return; let g = 0; for (const it of l) g += L.smelt(S, it.uid);
      sfx.coin(); updateGear(true); save(); shopBurst();
      AW.done = 'Melted ' + l.length + (l.length === 1 ? ' piece' : ' pieces') + ' for ' + fmt(g) + ' gold.'; return paintEnchPanel(true);
    }
    if (d.ewmode) { ewReset(d.ewmode); EW.done = null; paintEnchPanel(true); paintEnchOv(); return; }
    if (d.ewdst) return ewSet({ dst: d.ewdst, slot: null });
    if (d.ewsrc) return ewSet({ src: d.ewsrc, idx: +d.ewi });
    if (d.ewsrcitem) return ewSet({ src: d.ewsrcitem, idx: null });
    if (d.ewidx) return ewSet({ idx: +d.ewidx });
    if (d.ewslot) return ewSet({ slot: +d.ewslot });
    if (d.ewundo) {
      // changing an earlier pick clears everything picked after it
      const order = EW.mode === 'on' ? ['dst', 'src'] : ['src', 'dst'], k = order.indexOf(d.ewundo), clr = { slot: null };
      order.slice(k).forEach(f => { clr[f] = null; if (f === 'src') clr.idx = null; });
      return ewSet(clr);
    }
    if (d.ewrar) { scrapOpts[d.ewrar] = !scrapOpts[d.ewrar]; return paintEnchPanel(true); }
    if (d.ewgo === 'scrap') {
      const l = scrapList(); if (!l.length) return; let g = 0, dd = 0; for (const it of l) { dd += L.dustValue(it); g += L.salvage(S, it.uid); }
      sfx.coin(); updateGear(true); save(); shopBurst();
      EW.done = 'Scrapped ' + l.length + (l.length === 1 ? ' piece' : ' pieces') + ' for ' + fmt(dd) + ' Dust and ' + fmt(g) + ' gold.';
      return paintEnchPanel(true);
    }
    if (d.ewgo === 'move') {
      const r = L.disenchant(S, EW.src, EW.idx, EW.dst, EW.slot, events); if (!r) return;
      save(); updateGear(true); updateSeats(true); sfx.relic(); shopBurst();
      const msg = enchName(r.moved) + ' is now on ' + esc(L.gearName(r.item)) + '. ' + esc(L.gearName(r.lost)) + ' was used up. -' + fmt(r.cost) + ' Dust, +' + fmt(r.xp) + ' hero XP.';
      ewReset(EW.mode); EW.done = msg; paintEnchPanel(true); paintEnchOv();
    }
  });
  $('enchpanel') && $('enchpanel').addEventListener('change', e => { const c = e.target.closest('[data-ewopt]'); if (c) { scrapOpts[c.dataset.ewopt] = c.checked; paintEnchPanel(true); } });
  // In the shop the stage header names the shop and holds the way out. Everything else is in the counter panel.
  function paintEnchOv() {
    const on = L.visiting(S), kind = shopKind(), arm = on && kind === 'arm';
    const SHOPS = { ench: ['enchanter', 'The Enchanter', 'Enchanter'], arm: ['armorer', 'The Armorer', 'Armorer'], store: ['quartermaster', 'The Store', 'Store'] };
    document.body.classList.toggle('atench', on);
    let hd = $('shophead');
    if (!hd && on) {
      hd = document.createElement('div'); hd.id = 'shophead'; hd.className = 'shophead';
      hd.addEventListener('click', e => { if (e.target.closest('[data-ev="leave"]')) leaveEnch(); const sw = e.target.closest('[data-ev="swap"]'); if (sw) { if (sw.dataset.k === 'arm') awReset(); else if (sw.dataset.k === 'store') SW.mode = 'ton'; else ewReset(); visitEnch(sw.dataset.k); } });
      const sh = document.querySelector('.stagehead'); sh && sh.insertBefore(hd, sh.firstChild);
    }
    if (hd) {
      hd.hidden = !on;
      const me = SHOPS[kind] || SHOPS.ench;
      const h = '<img src="' + SP.spriteURL(me[0], 2, 0) + '" alt=""><div><b>' + me[1] + '</b><small>Your dive is paused on floor ' + S.floor + '</small></div><span class="shopbtns">' +
        Object.keys(SHOPS).filter(k => k !== kind).map(k => '<button class="btn ghost small" data-ev="swap" data-k="' + k + '">' + SHOPS[k][2] + '</button>').join('') + '<button class="btn small leave" data-ev="leave">Leave</button></span>';
      if (on && hd.dataset.h !== h) { hd.innerHTML = h; hd.dataset.h = h; }
    }
    const old = $('enchov'); if (old) old.remove();
    paintEnchPanel();
  }
  // ---------- merge: two copies of the same item become one at +1, or both are lost ----------
  function mergePicker(uid) {
    const it = L.itemOf(S, uid); if (!it) return;
    const all = S.bag.filter(x => L.mergeable(it, x)).sort((a, b) => b.up - a.up);
    if (!all.length) return itemModal(uid);
    let pick = (all.find(x => !x.lk) || all[0]).uid;
    const pct = v => Math.round(v * 1000) / 10 + '%';
    const draw = () => {
      const b = L.itemOf(S, pick), r = L.mergeRisk(S, it, b), wa = L.wearer(S, it.uid), wb = L.wearer(S, b.uid);
      const blocked = it.lk || b.lk;
      const row = x => { const wn = L.wearer(S, x.uid);
        return '<div class="pkrow r-' + x.rar + (x.uid === pick ? ' sel' : '') + '" data-mp="' + x.uid + '" role="button" tabindex="0"><div class="tile r-' + x.rar + '"><img class="iimg" src="' + SP.itemIcon(x.cls, x.slot, x.rar) + '" alt="">' + (x.up ? '<i class="upn">+' + x.up + '</i>' : '') + '</div>' +
          '<span class="pkt"><b>' + esc(L.gearName(x)) + (x.up ? ' +' + x.up : '') + '</b><small>Floor ' + x.ilvl + (x.aff ? ' &middot; ' + affText(x) : '') + (wn ? ' &middot; <i class="worn">worn by ' + esc(L.memberById(wn).name) + '</i>' : '') + '</small></span>' +
          (x.lk ? '<span class="cmp down">' + icon('lock') + 'Locked</span>' : '<span class="cmp eq">' + pct(L.mergeRisk(S, it, x).risk) + ' risk</span>') + '</div>'; };
      modal('<div class="mergebox picker"><h2>' + icon('relic') + 'Merge ' + esc(L.gearName(it)) + '</h2>' +
        '<p class="note">Pick the copy to merge in. The better job bonus is kept. ' + tipI('The higher the result, the bigger the risk. Every point of Luck and Intelligence lowers it, up to half. Nothing can buy the risk away.') + '</p>' +
        '<div class="mglist">' + all.map(row).join('') + '</div>' +
        '<div class="mgodds"><div><small>Result</small><b>+' + r.to + '</b></div><div class="ok"><small>Success</small><b>' + pct(1 - r.risk) + '</b></div><div class="bad"><small>Both destroyed</small><b>' + pct(r.risk) + '</b></div></div>' +
        '<p class="mgcut">Base risk ' + pct(r.base) + ', cut by ' + Math.round(r.cut * 100) + '% from Luck ' + ((S.attr || {}).lck || 0) + ' and Intelligence ' + ((S.attr || {}).int || 0) + '.</p>' +
        (wa || wb ? '<p class="note warn">A worn piece is part of this merge. If it fails, that slot ends up empty.</p>' : '') +
        '<div class="row"><button class="btn ghost" id="mg-back">Back</button><button class="btn danger" id="mg-go"' + (blocked ? ' disabled' : '') + '>' + (blocked ? 'Unlock first' : 'Merge to +' + r.to) + '</button></div></div>', md => {
          md.querySelectorAll('[data-mp]').forEach(e => e.onclick = () => { pick = e.dataset.mp; draw(); });
          md.querySelector('#mg-back').onclick = () => itemModal(uid);
          md.querySelector('#mg-go').onclick = () => {
            if (!campGate()) return;
            const res = L.mergeItems(S, uid, pick, null, events); if (!res) return;
            save(); updateGear(true); updateSeats(true);
            if (res.ok) { sfx.relic(); toast('relic', 'Merge succeeded', L.gearName(res.item) + ' is now +' + res.item.up + '. +' + fmt(res.xp) + ' hero XP.', ''); itemModal(res.item.uid); }
            else { sfx.coin(); closeModal(); toast('skull', 'The merge failed', 'Both ' + L.gearName(res.a) + ' pieces were destroyed. +' + fmt(res.xp) + ' hero XP for trying.', 'warn'); }
          };
        });
    };
    draw();
  }

  // ---------- slot picker: tap a gear slot to choose what goes there ----------
  function slotPicker(id, pos) {
    const m = L.memberById(id); if (!m) return;
    const g = S.gear[id] || {}, cur = g[pos] && L.itemOf(S, g[pos]);
    const type = L.posType(pos), name = L.SLOT_NAME[pos];
    const robeNow = pos === 'legs' && L.robeOn(S, id) ? L.itemOf(S, g.chest) : null;
    const curScore = cur ? L.itemScore(cur) : robeNow ? L.itemScore(robeNow) : 0;
    const list = S.bag.filter(it => it.cls === m.cls && L.fitsPos(it.slot, pos) && it.uid !== (cur && cur.uid))
      .map(it => ({ it, d: Math.round((L.itemScore(it) - (it.slot === 'robe' ? L.replaces(S, id, it).reduce((a, x) => a + L.itemScore(x), 0) : curScore)) * 100), ok: L.canWear(S, id, it), w: L.wearer(S, it.uid) }))
      .sort((a, b) => (b.ok - a.ok) || (b.d - a.d));
    const held = !!(cur && cur.lk) || (pos === 'legs' && robeNow && robeNow.lk);
    const row = x => {
      const it = x.it, wn = x.w ? L.memberById(x.w).name : '';
      if (x.ok && (held || (it.lk && x.w && x.w !== id) || (it.slot === 'robe' && L.slotLocked(S, id, 'legs')))) x.ok = false, x.lockd = true;
      const tag = x.lockd ? '<span class="cmp down">' + icon('lock') + 'Locked</span>' : !x.ok ? '<span class="cmp down">Needs power level ' + L.reqLevel(it) + '</span>' : x.d > 0 ? '<span class="cmp up">&#9650; ' + x.d + '%</span>' : x.d < 0 ? '<span class="cmp down">&#9660; ' + (-x.d) + '%</span>' : '<span class="cmp eq">Same</span>';
      return '<div class="pkrow r-' + it.rar + (x.ok ? '' : ' no') + '"><div class="tile r-' + it.rar + '" data-info="' + it.uid + '" role="button" tabindex="0" title="Details"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + '</div>' +
        '<span class="pkt"><b>' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</b><small>' + L.RARITY.find(r => r.id === it.rar).name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; ' + itemEffect(it) + (wn ? ' &middot; <i class="worn">worn by ' + esc(wn) + '</i>' : '') + '</small></span>' + tag +
        '<button class="btn small" data-pick="' + it.uid + '"' + (x.ok ? '' : ' disabled') + '>Equip</button></div>';
    };
    const head = cur ? '<div class="pkcur"><small>Wearing now</small><div class="pkrow r-' + cur.rar + '"><div class="tile r-' + cur.rar + '" data-info="' + cur.uid + '" role="button" tabindex="0"><img class="iimg" src="' + SP.itemIcon(cur.cls, cur.slot, cur.rar) + '" alt="">' + (cur.up ? '<i class="upn">+' + cur.up + '</i>' : '') + '</div><span class="pkt"><b>' + esc(L.gearName(cur)) + (cur.up ? ' +' + cur.up : '') + '</b><small>' + itemEffect(cur) + '</small></span><button class="btn small ghost' + (cur.lk ? ' on' : '') + '" id="pk-lk" title="' + (cur.lk ? 'Unlock this slot' : 'Lock it in this slot') + '">' + icon('lock') + (cur.lk ? 'Unlock' : 'Lock') + '</button><button class="btn small ghost" id="pk-info">Details</button><button class="btn small ghost" id="pk-off"' + (cur.lk ? ' disabled' : '') + '>Take off</button></div>' + (cur.lk ? '<p class="note ilocked">' + icon('lock') + 'Locked in this slot. Equip best leaves it alone, and it is safe from scrap and the Loot Goblin. Unlock it to swap it out.</p>' : '') + '</div>'
      : robeNow ? '<p class="note">' + esc(L.gearName(robeNow)) + ' covers the legs. Leggings here will take the robe off.</p>' : '';
    modal('<div class="picker"><div class="maphead"><div><h2>' + esc(m.name) + '’s ' + name.toLowerCase() + '</h2><small>' + (camp() ? 'Pick a piece to wear here.' : 'You can look now. Changing gear happens at camp.') + '</small></div><button class="iconbtn" id="pk-x" aria-label="Close">&times;</button></div>' + head +
      (list.length ? '<div class="pklist">' + list.map(row).join('') + '</div>' : '<p class="note">No ' + L.CLASSES[m.cls].name.toLowerCase() + ' ' + (type === 'chest' ? 'chest pieces or robes' : name.toLowerCase().replace(/ \d$/, '') + 's') + ' in your pack' + (cur ? ' to swap in' : '') + ' yet. They drop from monsters, chests and guardians, and you can buy them on the Market.</p>') + '</div>', md => {
      const re = () => { updateGear(true); updateSeats(true); };
      md.querySelector('#pk-x').onclick = closeModal;
      const off = md.querySelector('#pk-off'); if (off) off.onclick = () => { if (!campGate()) return; L.unequip(S, id, pos); sfx.buy(); re(); slotPicker(id, pos); };
      const inf = md.querySelector('#pk-info'); if (inf) inf.onclick = () => itemModal(cur.uid);
      const lk = md.querySelector('#pk-lk'); if (lk) lk.onclick = () => { const on = L.toggleLock(S, cur.uid); sfx.buy(); save(); re(); slotPicker(id, pos); toast('lock', on ? 'Slot locked' : 'Slot unlocked', on ? L.gearName(cur) + ' stays on ' + m.name + '. Equip best will skip this slot.' : 'Equip best can swap ' + L.gearName(cur) + ' out again.', ''); };
      md.querySelector('.picker').onclick = e => {
        const pk = e.target.closest('[data-pick]');
        if (pk) { if (!campGate() || pk.disabled) return; const w = L.wearer(S, pk.dataset.pick); if (w) L.unequip(S, w, L.wornPos(S, pk.dataset.pick)); if (L.equip(S, id, pk.dataset.pick, pos)) { sfx.buy(); re(); closeModal(); toast('gear-armor', 'Equipped', L.gearName(L.itemOf(S, pk.dataset.pick)) + ' on ' + m.name + '.', ''); } else re(); return; }
        const t = e.target.closest('[data-info]'); if (t) itemModal(t.dataset.info);
      };
    });
  }

  // ---------- Kindling: unlock extra gear slots ----------
  function unlockModal(id, kind) {
    const m = L.memberById(id), c = L.unlockCost(S, id, kind); if (!c) return;
    const what = kind === 'neck2' ? 'a second trinket slot' : 'ring slot ' + (2 + L.unlocksOf(S, id).rings);
    const can = (S.kindling || 0) >= c;
    modal('<div class="center"><div class="kbig">' + icon('flame') + '</div><h2>Unlock ' + what + '</h2><p>' + esc(m.name) + ' can wear one more ' + (kind === 'neck2' ? 'trinket' : 'ring') + '. This costs <b class="kind">' + c + ' Kindling</b> and stays unlocked forever, even after rekindling.</p><p class="muted">You have ' + (S.kindling || 0) + ' Kindling. You earn it by rekindling.</p>' +
      '<div class="row"><button class="btn ghost" id="u-no">Not now</button><button class="btn" id="u-yes"' + (can ? '' : ' disabled') + '>' + (can ? 'Unlock' : 'Not enough Kindling') + '</button></div></div>', md => {
        md.querySelector('#u-no').onclick = closeModal;
        md.querySelector('#u-yes').onclick = () => { if (L.unlockSlot(S, id, kind)) { sfx.relic(); save(); closeModal(); toast('flame', 'Slot unlocked', m.name + ' can now wear ' + (kind === 'neck2' ? 'two trinkets' : (1 + L.unlocksOf(S, id).rings) + ' rings') + '.', 'feat'); updateGear(true); } };
      });
  }

  // ---------- companion profile ----------
  const SIDE_OF_MEMBER = id => { const m = L.memberById(id); if (id === 'you') return L.sideOf(S); return m.side || null; };
  function profileModal(id) {
    const m = L.memberById(id); if (!m) return;
    const c = L.CLASSES[m.cls], now = Date.now(), side = SIDE_OF_MEMBER(id), sd = side && L.SIDES[side];
    const guest = L.isGuest(S, id), lv = L.lvl(S, id) || 1, inParty = S.party.includes(id), g0 = guest && (S.guests || []).find(x => x.id === id);
    const stats = [['Level', lv], ['Health', fmt(L.maxHpOf(S, id))], ['Damage', fmt(L.memberDps(S, id, now) || 0) + '/s']];
    if (m.cls === 'healer') stats.push(['Healing', fmt(L.healPerSec(S, id)) + '/s']);
    if (c.armor) stats.push(['Blocks', Math.round(c.armor * 100) + '% of hits']);
    if (c.dodge) stats.push(['Dodges', Math.round(c.dodge * 100) + '% of hits']);
    if (c.drain) stats.push(['Life drain', 'heals party as it hits']);
    const rk = L.resKind(id);
    if (rk) stats.push([rk === 'mana' ? 'Mana' : 'Stamina', Math.round(L.resOf(S, id)) + ' / ' + L.RES_MAX + ', regen ' + L.resRegen(S, id).toFixed(1) + '/s']);
    const wv = k => L.wearVal(S, id, k);
    if (wv('leech')) stats.push(['Life steal', (wv('leech') * 100).toFixed(1) + '% of damage']);
    if (wv('block')) stats.push(['Gear block', (wv('block') * 100).toFixed(1) + '% chance']);
    if (wv('def')) stats.push(['Defense', (wv('def') * 100).toFixed(1) + '% less damage']);
    stats.push(['Power', m.player ? 'Full (player hero)' : Math.round(L.NPC_POWER * 100) + '% (story companion)']);
    const gear = S.gear[id] || {};
    const gearList = L.openPos(S, id).filter(sl => !(sl === 'legs' && L.robeOn(S, id))).map(sl => { const it = gear[sl] && L.itemOf(S, gear[sl]); return '<li><span>' + L.SLOT_NAME[sl] + '</span>' + (it ? '<b class="r-' + it.rar + '">' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</b>' : '<i>Empty</i>') + '</li>'; }).join('');
    const bio = id === 'you' ? 'That is you. You took the lantern from Old Thessaly and carried it down the stair' + (sd ? ', under the banner of the ' + sd.name : '') + '.'
      : guest ? 'Another player’s hero, lent to your party. They fight at the level their owner trained them to. You cannot change their gear or train them.'
      : (m.bio || m.line);
    modal('<div class="prof"><div class="profhead"><div class="profspr c-' + m.cls + '"></div><div><h2>' + esc(m.name) + '</h2><small>' + esc(m.title) + '</small><div class="tags">' + classTag(m.cls) + (sd ? '<span class="sidetag" style="--side:' + sd.color + '">' + sd.name + '</span>' : '') + (guest ? '<span class="you guest">Player</span>' : '') + '</div></div></div>' +
      '<p class="bio">' + esc(bio) + '</p>' + (m.line && !guest && id !== 'you' ? '<p class="quote">“' + esc(m.line) + '”</p>' : '') +
      (id === 'you' && L.warAura(S) ? '<h3 class="sub">Grand War aura</h3><div id="p-aura">' + auraBox() + '</div>' : id === 'you' && CL ? '<div id="p-aura"></div>' : '') +
      (id === 'you' && CL ? '<h3 class="sub">Profile card</h3><p class="note">What other players see in the Players Guild.</p><div class="pfwrap" id="p-card">' + looksCard({ name: m.name, cls: m.cls, level: lv, floor: S.maxFloorEver, wd: S.wd, pf: prof && prof.pf, w: prof && prof.wv ? prof.wl : '' }) + '</div><div class="row left"><button class="btn small" id="p-looks">Customize profile</button>' + (wardOn() ? '<button class="btn small ghost" id="p-ward">Wardrobe</button>' : '') + '</div>' : '') +
      (guest && g0 && (g0.pf || g0.w) ? '<div class="pfwrap">' + looksCard(Object.assign({}, g0, { name: m.name, cls: m.cls })) + '</div>' : '') +
      '<h3 class="sub">' + c.name + '</h3><p class="note">' + esc(CLASS_BLURB[m.cls]) + '</p>' +
      '<div class="ability"><b>' + c.ability.name + '</b> <span>every ' + c.ability.cd + 's</span><small>' + esc(c.ability.desc) + '</small></div>' +
      '<div class="pstats">' + stats.map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('') + '</div>' +
      (sd ? '<p class="note">' + sd.name + ': “' + sd.motto + '” ' + esc(sd.desc) + '</p>' : '') +
      (guest ? '' : '<h3 class="sub">Gear</h3><ul class="pgear">' + gearList + '</ul>') +
      '<div class="row">' + (guest ? '' : '<button class="btn ghost" id="p-gear">Manage gear</button>') + (!inParty && !guest ? '<button class="btn" id="p-seat">Bring along</button>' : '') + '<button class="btn ghost" id="p-close">Close</button></div></div>', md => {
        const box = md.querySelector('.profspr'); try { const img = SP.render(m.cls, 5, lookHue(m)); if (img) box.appendChild(img); } catch (e) {}
        const g = md.querySelector('#p-gear'); if (g) g.onclick = () => { closeModal(); gearWho = id; switchTab('gear'); };
        const st = md.querySelector('#p-seat'); if (st) st.onclick = () => { closeModal(); if (campGate(true)) pickSeat(id); };
        md.querySelector('#p-close').onclick = closeModal;
        const lk = md.querySelector('#p-looks'); if (lk) lk.onclick = openProfileEditor; const pw = md.querySelector('#p-ward'); if (pw) pw.onclick = () => openWardrobe('k', id);
        if (id === 'you' && CL && signedIn() && !prof) Promise.all([loadProfile(), loadWar()]).then(() => { const c = md.querySelector('#p-card'); if (c && prof) c.innerHTML = looksCard({ name: m.name, cls: m.cls, level: lv, floor: S.maxFloorEver, wd: S.wd, pf: prof.pf, w: prof.wv ? prof.wl : '' }); const au = md.querySelector('#p-aura'); if (au && !au.innerHTML && L.warAura(S)) au.innerHTML = '<h3 class="sub">Grand War aura</h3>' + auraBox(); });
      });
  }

  // ---------- journal: story and lore ----------
  // Bestiary mastery: kills of each kind, the bonus they give and the next step (John, 24 Nov 2026).
  const beastTag = id => { const t = L.beastTier(S, id); return t ? '<span class="bmt">+' + t + '%</span>' : ''; };
  function beastBar(id) {
    const n = (S.bk && S.bk[id]) || 0, t = L.beastTier(S, id), max = t >= L.BEAST_MAX, nx = (t + 1) * L.BEAST_STEP;
    const pc = max ? 100 : Math.floor((n - t * L.BEAST_STEP) / L.BEAST_STEP * 100);
    return '<div class="bmast"><div class="bmrow"><b>Mastery ' + t + '/' + L.BEAST_MAX + '</b><span>' + fmt(n) + ' defeated' + (max ? ' · fully mastered' : ' · next +1% at ' + fmt(nx)) + '</span></div>' +
      '<div class="bmbar"><i style="width:' + pc + '%"></i></div><small>' + (t ? '+' + t + '% damage and hero XP against them.' : 'Every ' + fmt(L.BEAST_STEP) + ' defeated adds +1% damage and hero XP against them, up to +' + L.BEAST_MAX + '%.') + '</small></div>';
  }
  function updateJournal() {
    const seen = L.STORY.filter(b => S.story.seen[b.id]);
    let h = '<h3 class="sub">The story so far</h3><div class="scenes">' +
      seen.map(b => '<button class="scene" data-scene="' + b.id + '"><span>Chapter ' + b.ch + '</span><b>' + esc(b.title) + '</b></button>').join('') +
      (seen.length < L.STORY.length ? '<div class="scene locked"><span>Next</span><b>' + esc(L.currentGoal(S)) + '</b></div>' : '') + '</div>';
    const groups = {};
    for (const lo of L.LORE) (groups[lo.group] = groups[lo.group] || []).push(lo);
    for (const g in groups) {
      h += '<h3 class="sub">' + g + '</h3><div class="lore">' + groups[g].map(lo => S.lore[lo.id]
        ? '<details><summary>' + esc(lo.title) + (g === 'Bestiary' ? beastTag(lo.id) : '') + '</summary><p>' + esc(lo.text) + '</p>' + (g === 'Bestiary' ? beastBar(lo.id) : '') + '</details>'
        : '<div class="lorelock">' + icon('lock') + ' Not yet discovered</div>').join('') + '</div>';
    }
    $('journal').innerHTML = h;
    $('lorecount').textContent = Object.keys(S.lore).filter(k => L.LORE.find(l => l.id === k)).length + '/' + L.LORE.length;
  }
  $('journal').addEventListener('click', e => { const b = e.target.closest('[data-scene]'); if (b) playScene(L.STORY.find(x => x.id === b.dataset.scene), true); });

  document.querySelectorAll('#buyseg button').forEach(b => b.addEventListener('click', () => {
    S.settings.buy = b.dataset.n === 'max' ? 'max' : +b.dataset.n;
    syncBuySeg(); updateSeats(true);
  }));
  function syncBuySeg() { document.querySelectorAll('#buyseg button').forEach(x => x.classList.toggle('on', String(S.settings.buy) === x.dataset.n)); }


  // ---------- mass scrap ----------
  const scrapOpts = { common: true, fine: true, rare: false, epic: false, set: false, keepBest: true, keepUp: true };
  // Items a bulk action may take, by rarity ticks and keep rules. Worn and locked items are always left alone.
  function bulkList(o) {
    const best = new Set();
    if (o.keepBest) {
      const top = {};
      for (const it of S.bag) { const k = it.cls + it.slot; if (!top[k] || L.gearPct(it) > L.gearPct(top[k])) top[k] = it; }
      Object.values(top).forEach(it => best.add(it.uid));
    }
    return S.bag.filter(it => o[it.rar] && !it.lk && !L.wearer(S, it.uid) && !best.has(it.uid) && !(o.keepUp && it.up > 0));
  }
  const scrapList = () => bulkList(scrapOpts);
  function openScrap() {
    const draw = () => {
      const list = scrapList(), gold = list.reduce((a, it) => a + L.salvageValue(it), 0);
      const chk = (k, label, sub) => '<label class="chk"><input type="checkbox" data-opt="' + k + '"' + (scrapOpts[k] ? ' checked' : '') + '><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
      modal('<h2>Mass scrap</h2><p>Salvage many pieces at once for gold and Dust. Gear someone is wearing and items you have locked are never scrapped.' + (S.bag.some(x => x.lk) ? ' You have <b>' + S.bag.filter(x => x.lk).length + '</b> locked.' : '') + '</p>' +
        '<div class="scrapgrid">' + L.RARITY.map(r => chk(r.id, '<span class="r-' + r.id + '" style="color:var(--rc)">' + r.name + '</span>', S.bag.filter(x => x.rar === r.id && !L.wearer(S, x.uid)).length + ' unworn')).join('') + '</div>' +
        chk('keepBest', 'Keep the best of each kind', 'Saves your strongest spare piece for every class and slot.') +
        chk('keepUp', 'Keep upgraded pieces', 'Anything you have spent gold upgrading stays.') +
        '<p class="scrapsum">' + (list.length ? 'Scraps <b>' + list.length + '</b> ' + (list.length === 1 ? 'piece' : 'pieces') + ' for <b>' + fmt(gold) + ' gold</b> and <b>' + fmt(list.reduce((a, it) => a + L.dustValue(it), 0)) + ' Dust</b>.' : 'Nothing matches. Tick more rarities above.') + '</p>' +
        '<div class="row"><button class="btn danger" id="s-go"' + (list.length ? '' : ' disabled') + '>Scrap ' + list.length + '</button><button class="btn ghost" id="s-x">Cancel</button></div>', md => {
          md.querySelectorAll('[data-opt]').forEach(c => c.onchange = () => { scrapOpts[c.dataset.opt] = c.checked; draw(); });
          md.querySelector('#s-x').onclick = closeModal;
          md.querySelector('#s-go').onclick = () => {
            const l = scrapList(); let g = 0, d = 0; for (const it of l) { d += L.dustValue(it); g += L.salvage(S, it.uid); }
            closeModal(); sfx.coin(); updateGear(true); save();
            toast('coin', 'Scrapped ' + l.length + (l.length === 1 ? ' piece' : ' pieces'), '+' + fmt(g) + ' gold, +' + fmt(d) + ' Dust', 'feat');
          };
        });
    };
    draw();
  }
  // ---------- mass merge ----------
  let mmCap = 3;
  function openMassMerge() {
    const draw = () => {
      const plan = L.massMergePlan(S, mmCap), exp = plan.reduce((a, p) => a + p.risk, 0);
      const pct = v => Math.round(v * 1000) / 10 + '%';
      modal('<div class="mergebox"><h2>' + icon('relic') + 'Mass merge</h2><p class="note">Merges spare copies of the same item in pairs, best with next best. Worn and locked items are left alone. ' + tipI('Every merge rolls on its own. If it fails, both pieces in that pair are destroyed. Luck and Intelligence lower the risk.') + '</p>' +
        '<div class="mmcap">' + [1, 2, 3, 5, 10].map(n => '<button class="enchip' + (n === mmCap ? ' sel' : '') + '" data-cap="' + n + '"><b>Up to +' + n + '</b></button>').join('') + '</div>' +
        (plan.length ? '<div class="mmlist">' + plan.map(p => '<div class="mmrow r-' + p.a.rar + '"><b>' + esc(L.gearName(p.a)) + ' +' + p.a.up + ' &amp; +' + p.b.up + ' &rarr; +' + p.to + '</b><em>' + pct(p.risk) + ' risk</em></div>').join('') + '</div>' +
          '<div class="mgodds"><div><small>Merges</small><b>' + plan.length + '</b></div><div class="ok"><small>Expected wins</small><b>' + (Math.round((plan.length - exp) * 10) / 10) + '</b></div><div class="bad"><small>Expected losses</small><b>' + (Math.round(exp * 10) / 10) + '</b></div></div>' +
          '<p class="mgcut">A loss destroys both pieces in that pair, so about ' + Math.round(exp * 2) + ' items could be lost.</p>'
          : '<p class="scrapsum">No spare pairs to merge up to +' + mmCap + '. Worn and locked items are skipped.</p>') +
        '<div class="row"><button class="btn ghost" id="mm-x">Cancel</button><button class="btn danger" id="mm-go"' + (plan.length ? '' : ' disabled') + '>Merge ' + plan.length + '</button></div></div>', md => {
          md.querySelectorAll('[data-cap]').forEach(b => b.onclick = () => { mmCap = +b.dataset.cap; draw(); });
          md.querySelector('#mm-x').onclick = closeModal;
          md.querySelector('#mm-go').onclick = () => {
            let ok = 0, bad = 0, mxp = 0;
            for (const p of L.massMergePlan(S, mmCap)) { const r = L.mergeItems(S, p.a.uid, p.b.uid, null, events); if (!r) continue; mxp += r.xp || 0; if (r.ok) ok++; else bad++; }
            closeModal(); save(); updateGear(true); updateSeats(true); ok ? sfx.relic() : sfx.coin();
            toast('relic', 'Mass merge done', ok + ' merged' + (bad ? ', ' + bad + ' failed (' + bad * 2 + ' items lost)' : '') + '. +' + fmt(mxp) + ' hero XP.', bad ? 'warn' : 'feat');
          };
        });
    };
    draw();
  }
  // ---------- pack header: capacity meter, auto-scrap, bulk actions menu ----------
  function paintPackCap() {
    const n = L.packCount(S), cap = L.bagCap(S), full = !S.boh && n >= cap;
    $('bagcount').innerHTML = S.boh ? fmt(n) + ' <small>Bag of Holding</small>' : fmt(n) + ' <small>/ ' + fmt(cap) + '</small>';
    $('packfill').style.width = (S.boh ? 100 : Math.min(100, n / cap * 100)) + '%';
    $('packcap').classList.toggle('full', full); $('packcap').classList.toggle('boh', !!S.boh);
    $('packwarn').hidden = !full; $('packwarn').textContent = n > cap ? (n - cap) + ' over · new finds are sold' : 'Full · new finds are sold';
    $('g-boh').hidden = !!S.boh || !CL;
    const a = S.autoScrap || {}, on = a.on && a.r && a.r.length;
    $('g-auto').classList.toggle('on', !!on);
    $('g-autos').textContent = on ? (a.r.length === 1 ? L.RARITY.find(r => r.id === a.r[0]).name : a.r.length + ' rarities') : 'Off';
  }
  const bulkMenu = open => { $('g-bulkmenu').hidden = !open; $('g-bulk').setAttribute('aria-expanded', open ? 'true' : 'false'); };
  $('g-bulk').addEventListener('click', e => { e.stopPropagation(); bulkMenu($('g-bulkmenu').hidden); });
  document.addEventListener('click', e => { if (!$('g-bulkmenu').hidden && !e.target.closest('.bulk')) bulkMenu(false); });
  $('g-bulkmenu').addEventListener('click', e => { if (e.target.closest('button')) bulkMenu(false); });
  function openAutoScrap() {
    if (!S.autoScrap) S.autoScrap = { on: false, r: ['common'], up: false };
    const a = S.autoScrap;
    const draw = () => {
      const rows = L.RARITY.filter(r => r.id !== 'set' && r.id !== 'goblin').map(r => {
        const n = S.bag.filter(x => x.rar === r.id && !L.wearer(S, x.uid)).length;
        return '<label class="aschip r-' + r.id + '"><input type="checkbox" data-r="' + r.id + '"' + (a.r.includes(r.id) ? ' checked' : '') + '><span class="gem"></span><b>' + r.name + '</b><small>' + n + ' in pack</small></label>';
      }).join('');
      modal('<div class="asbox"><h2>Auto-scrap</h2><p class="note">Scrap new drops of the rarities you tick the moment they are found, for gold and Dust. They never take up pack space. Drops that someone in your party can wear right now and that beat their gear are kept.</p>' +
        '<label class="asmaster"><span class="sw' + (a.on ? ' on' : '') + '"><i></i></span><input type="checkbox" id="as-on"' + (a.on ? ' checked' : '') + '><b>Auto-scrap is ' + (a.on ? 'on' : 'off') + '</b></label>' +
        '<div class="asgrid' + (a.on ? '' : ' off') + '">' + rows + '</div>' +
        '<label class="chk"><input type="checkbox" id="as-up"' + (a.up ? ' checked' : '') + '><span><b>Scrap upgrades too</b><small>Off by default, so a drop that beats what a companion wears is always kept.</small></span></label>' +
        (() => { const l = a.on ? L.autoScrapPack(S) : [], g = l.reduce((t, it) => t + L.salvageValue(it), 0), d = l.reduce((t, it) => t + L.dustValue(it), 0);
          return '<div class="aspack' + (l.length ? ' on' : '') + '"><div><b>' + (l.length ? l.length + (l.length === 1 ? ' piece' : ' pieces') + ' already in your pack match' + (l.length === 1 ? 'es' : '') : 'Nothing in your pack matches') + '</b><small>' + (l.length ? 'Auto-scrap only catches new drops. Scrap these now for ' + fmt(g) + ' gold and ' + fmt(d) + ' Dust.' : a.on ? 'Your pack is already clear of these rarities.' : 'Turn auto-scrap on to clear matching pieces you already carry.') + '</small></div>' +
            (l.length ? '<button class="btn danger small" id="as-now">Scrap ' + l.length + ' now</button>' : '') + '</div>'; })() +
        '<p class="asnote">Set pieces, job set pieces, region sets, locked and worn gear are always kept, and so is the best spare piece for each party member’s slot.</p>' +
        '<div class="row"><button class="btn" id="as-x">Done</button></div></div>', md => {
          const now = md.querySelector('#as-now'); if (now) now.onclick = () => {
            const l = L.autoScrapPack(S); let g = 0, d = 0; for (const it of l) { d += L.dustValue(it); g += L.salvage(S, it.uid); }
            sfx.coin(); updateGear(true); save(); draw();
            toast('coin', 'Scrapped ' + l.length + (l.length === 1 ? ' piece' : ' pieces'), '+' + fmt(g) + ' gold, +' + fmt(d) + ' Dust', 'feat');
          };
          md.querySelector('#as-on').onchange = e => { a.on = e.target.checked; save(); paintPackCap(); draw(); };
          md.querySelector('#as-up').onchange = e => { a.up = e.target.checked; save(); };
          md.querySelectorAll('[data-r]').forEach(c => c.onchange = () => {
            a.r = L.RARITY.map(r => r.id).filter(id => id === c.dataset.r ? c.checked : a.r.includes(id));
            if (c.checked) a.on = true;
            save(); paintPackCap(); draw();
          });
          md.querySelector('#as-x').onclick = closeModal;
        });
    };
    draw();
  }
  $('g-auto').addEventListener('click', openAutoScrap);
  $('g-mmerge').addEventListener('click', openMassMerge);
  $('g-scrap').addEventListener('click', openScrap);
  $('g-boh').addEventListener('click', () => openBoh());
  $('b-oil').addEventListener('click', () => { if (L.useOil(S)) { sfx.relic(); save(); toast('oil', 'The lantern flares', '+15 seconds of oil for this guardian.', 'feat'); } });
  // ---------- panel: relics, feats, ledger, rekindle ----------
  function updateRelics() {
    const box = $('relics');
    box.innerHTML = L.RELICS.map(r => {
      const lv = S.relics[r.id] || 0;
      return lv ? '<div class="relic">' + icon('relic') + '<span class="lvl">Level ' + lv + '</span><b>' + r.name + '</b><small>' + r.desc + '</small></div>'
                : '<div class="relic unknown">' + icon('relic') + '<span class="lvl">Undiscovered</span><b>???</b><small>Found somewhere in the deep.</small></div>';
    }).join('');
    $('relcount').textContent = Object.keys(S.relics).length + '/' + L.RELICS.length;
  }
  function updateFeats() {
    $('feats').innerHTML = L.FEATS.map(f => '<div class="feat ' + (S.feats[f.id] ? 'got' : '') + '"><div class="medal">' + icon('star') + '</div><div><b>' + f.name + '</b><small>' + f.desc + '</small></div></div>').join('');
    $('featcount').textContent = L.featCount(S) + '/' + L.FEATS.length;
  }
  function updateLedger() {
    const st = S.stats, rows = [
      ['Deepest floor ever', S.maxFloorEver], ['Deepest floor this descent', S.maxFloor],
      ['Party damage', fmt(L.totalDps(S, Date.now())) + '/s'], ['Strike damage', fmt(L.clickDamage(S, Date.now()))],
      ['Critical chance', Math.round(L.critChance(S) * 100) + '%'], ['Lantern oil per guardian', Math.round(L.lanternTime(S)) + 's'],
      ['Foes defeated', fmt(st.kills)], ['Guardians defeated', fmt(st.bossKills)], ['Chests opened', fmt(st.chests)],
      ['Strikes', fmt(st.clicks)], ['Critical strikes', fmt(st.crits)], ['Gold earned', fmt(st.goldEarned)],
      ['Embers', fmt(S.embers) + ' (+' + fmt(S.embers * 4) + '%)'], ['Times rekindled', st.rekindles], ['Time played', fmtTime(st.playTime)],
    ];
    $('ledger').innerHTML = rows.map(r => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('');
  }
  function updateRekindle() {
    const e = L.embersFor(S);
    $('embergain').textContent = fmt(e);
    $('kindgain').textContent = L.skillPointsFor(S);
    updateSkills();
    const rk = L.canUse(S, 'rekindle');
    $('btn-rekindle').disabled = e <= 0 || !rk;
    $('rekindlenote').textContent = !rk ? 'Rekindling opens at hero level ' + L.unlockOf('rekindle').lv + ', from floor ' + L.REKINDLE_FLOOR + ' or deeper. ' + heroName() + ' is hero level ' + L.heroLv(S) + '.'
      : S.maxFloor < L.REKINDLE_FLOOR ? 'Reach floor ' + L.REKINDLE_FLOOR + ' on this descent to rekindle. You are on floor ' + S.maxFloor + '.'
      : 'Deeper floors give more Embers. Most delvers rekindle when progress slows down.';
  }
  $('btn-rekindle').addEventListener('click', () => {
    const e = L.embersFor(S); if (e <= 0 || !gateUse('rekindle')) return;
    modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Rekindle now?</h2><p>Gold, floors and training reset to the start. You keep your companions, gear, relics, story and feats, and gain <b style="color:var(--ember)">' + fmt(e) + ' Embers</b> for +' + fmt(e * 4) + '% damage and gold.</p><div class="row" style="justify-content:center"><button class="btn ghost" id="m-no">Not yet</button><button class="btn" id="m-yes">Rekindle</button></div></div>', m => {
      m.querySelector('#m-no').onclick = closeModal;
      m.querySelector('#m-yes').onclick = () => {
        const kind = L.skillPointsFor(S), got = L.rekindle(S); closeModal(); sfx.relic(); save();
        toast('flame', 'The lantern burns brighter', '+' + fmt(got) + ' Embers and +' + kind + ' Kindling. The descent begins again.', 'feat');
        $('auto').checked = true; switchTab('party'); updatePanel(true); updateAbilities(true);
      };
    });
  });

  // ---------- skill tree and Kindling ----------
  const SK_ICON = { hp: 'shield', guard: 'shield', power: 'star', dps: 'sword', pdps: 'sword', cd: 'refresh', php: 'users', lantern: 'lantern', dur: 'flare', heal: 'cross', pheal: 'leaf', revive: 'cross', gold: 'coin', dodge: 'eye', loot: 'bag', chest: 'key', crit: 'flare', minion: 'skull' };
  function updateSkills() {
    const box = $('skills'); if (!box) return;
    const cls = L.heroCls(S), k = S.kindling || 0;
    const hp = cls ? L.heroPoints(S) : 0;
    $('kindcount').textContent = k ? k : hp ? '+' + hp : '';
    paintSheet();
    if (!cls) { box.innerHTML = ''; return; }
    const tree = L.SKILL_TREES[cls], c = L.CLASSES[cls];
    const node = sk => {
      const r = (S.skills || {})[sk.id] || 0, st = L.canLearn(S, sk.id), cost = L.skillCost(sk);
      const pips = '<span class="kp">' + Array.from({ length: sk.r }, (_, i) => '<i class="' + (i < r ? 'on' : '') + '"></i>').join('') + '</span>';
      const btn = st === 'max' ? '<em class="kmax">Mastered</em>' : st === 'locked' ? '<em class="klock">' + icon('lock') + 'Learn the skill above</em>'
        : '<button class="btn small' + (st === 'ok' ? '' : ' ghost') + '" data-learn="' + sk.id + '"' + (st === 'ok' ? '' : ' disabled') + '>' + (r ? 'Rank up' : 'Learn') + ' <span class="kcost">' + icon('flame') + cost + '</span></button>';
      return '<div class="knode t' + sk.tier + (r ? ' got' : '') + (st === 'locked' ? ' lock' : '') + '"><div class="kic">' + icon(SK_ICON[sk.k] || 'star') + '</div><div class="ktx"><b>' + sk.n + '</b>' + pips + '<small>' + L.skillText(sk, r || 1) + (sk.r > 1 && r ? ' now' : '') + '</small>' + btn + '</div></div>';
    };
    const capNext = L.BAG_UPS_MAX - (S.bagUps || 0), bc = L.bagUpCost(S);
    box.innerHTML = '<div class="khead"><div><h3>' + esc(L.memberById('you').name) + '’s ' + c.name + ' skills</h3><small>Spend Kindling to learn skills ' + tipI('Your hero’s skills work while they are in the party. Kindling comes from rekindling.') + '</small></div>' +
      '<div class="kbal">' + icon('flame') + '<b>' + k + '</b><small>Kindling</small></div></div>' +
      '<div class="ktree">' + tree.map(br => '<div class="kbranch"><h4>' + br.b + '</h4>' + br.s.map(node).join('<i class="klink"></i>') + '</div>').join('') + '</div>' +
      '<div class="kfoot"><span>Spent ' + L.skillSpent(S) + ' of 48</span>' + (L.skillSpent(S) ? '<button class="btn ghost small" id="k-reset">Reset tree</button>' : '') + '</div>' +
      '<h3 class="sub">Spend Kindling</h3><div class="kshop">' +
      '<div class="kitem"><div class="kic">' + icon('bag') + '</div><div><b>Bigger pack</b><small>+' + L.BAG_STEP + ' bag slots. You have ' + (S.boh ? 'endless room with your Bag of Holding' : L.bagCap(S)) + '.</small></div>' +
      (capNext > 0 ? '<button class="btn small" id="k-bag"' + (k >= bc ? '' : ' disabled') + '>' + bc + ' Kindling</button>' : '<em class="kmax">Full size</em>') + '</div>' +
      '<div class="kitem"><div class="kic">' + icon('gear-trinket') + '</div><div><b>Rings and a second trinket</b><small>Every character can open rings 2 to 5 and a second trinket slot. Tap a locked slot on the Gear tab.</small></div><button class="btn ghost small" id="k-gear">Open Gear</button></div>' +
      L.KINDLE_UPS.map(u => { const r = (S.kup || {})[u.id] || 0, c = L.kupCost(S, u.id);
        return '<div class="kitem"><div class="kic">' + icon(u.icon) + '</div><div><b>' + u.name + ' <span class="kp">' + Array.from({ length: u.max }, (_, i) => '<i class="' + (i < r ? 'on' : '') + '"></i>').join('') + '</span></b><small>' + u.desc + '.' + (r ? ' Rank ' + r + ' of ' + u.max + '.' : '') + '</small></div>' +
          (c ? '<button class="btn small" data-kup="' + u.id + '"' + (k >= c ? '' : ' disabled') + '>' + c + ' Kindling</button>' : '<em class="kmax">Maxed</em>') + '</div>'; }).join('') +
      '</div><h3 class="sub">Change class</h3><div class="kshop"><div class="kitem respec"><div class="kic">' + icon('refresh') + '</div><div><b>Take up a new class</b><small>Your hero becomes another class. Every Kindling spent on the skill tree comes back, then the change costs ' + L.CLASS_CHANGE_COST + '. Pack size, gear slots and upgrades stay as they are. Done at camp.</small></div><button class="btn small ghost" id="k-respec"' + (k + L.skillSpent(S) >= L.CLASS_CHANGE_COST ? '' : ' disabled title="Needs ' + L.CLASS_CHANGE_COST + ' Kindling, counting what your tree would refund"') + '>' + L.CLASS_CHANGE_COST + ' Kindling</button></div></div>';
  }
  $('skills') && $('skills').addEventListener('click', e => {
    const b = e.target.closest('[data-learn]');
    if (b) { if (L.learnSkill(S, b.dataset.learn)) { sfx.buy(); save(); updateSkills(); updateAbilities(true); } return; }
    if (e.target.closest('#k-bag')) { if (L.buyBag(S)) { sfx.relic(); save(); toast('bag', 'Bigger pack', 'Your pack now holds ' + L.bagCap(S) + ' items.', ''); updateSkills(); } return; }
    if (e.target.closest('#k-gear')) { switchTab('gear'); return; }
    const ku = e.target.closest('[data-kup]'); if (ku) { if (L.buyKup(S, ku.dataset.kup)) { sfx.relic(); save(); updateSkills(); } return; }
    if (e.target.closest('#k-respec')) {
      if (!campGate(true)) return;
      const cur = L.heroCls(S), back = L.skillSpent(S), left = (S.kindling || 0) + back - L.CLASS_CHANGE_COST;
      modal('<div class="center"><h2>Change your class</h2><p>Pick a new class for ' + esc(L.memberById('you').name) + '. Your ' + back + ' tree Kindling comes back, the change costs ' + L.CLASS_CHANGE_COST + ', and you keep ' + left + ' to spend on the new tree. Gear your hero is wearing goes back to the pack. Pack size, gear slots and Kindling upgrades stay.</p>' +
        '<div class="respecs">' + L.CLASS_ORDER.filter(c => c !== cur).map(c => '<button class="btn ghost" data-newcls="' + c + '">' + icon(CLASS_ICON[c]) + '<span>' + L.CLASSES[c].name + '</span></button>').join('') + '</div><div class="row"><button class="btn ghost" id="r-no">Cancel</button></div></div>', md => {
        md.querySelector('#r-no').onclick = closeModal;
        md.querySelectorAll('[data-newcls]').forEach(btn => btn.onclick = () => {
          const c = btn.dataset.newcls;
          if (!btn.classList.contains('confirm')) { md.querySelectorAll('[data-newcls]').forEach(x => { x.classList.remove('confirm'); x.querySelector('span').textContent = L.CLASSES[x.dataset.newcls].name; }); btn.classList.add('confirm'); btn.querySelector('span').textContent = 'Tap again: become a ' + L.CLASSES[c].name; return; }
          if (L.changeClass(S, c)) { sfx.relic(); save(); closeModal(); toast('refresh', 'A new path', L.memberById('you').name + ' is now a ' + L.CLASSES[c].name + '. ' + S.kindling + ' Kindling is ready for the new tree.', 'feat'); updatePanel(true); updateAbilities(true); updateSkills(); try { if (typeof publishHero === 'function' && signedIn()) publishHero(); } catch (x) {} }
        });
      });
      return;
    }
    if (e.target.closest('#k-reset')) {
      if (!campGate(true)) return;
      modal('<div class="center"><h2>Reset your skill tree?</h2><p>All ' + L.skillSpent(S) + ' Kindling comes back to you so you can choose again. You can only do this at camp.</p><div class="row"><button class="btn ghost" id="r-no">Keep it</button><button class="btn" id="r-yes">Reset</button></div></div>', md => {
        md.querySelector('#r-no').onclick = closeModal;
        md.querySelector('#r-yes').onclick = () => { L.resetSkills(S); save(); closeModal(); updateSkills(); };
      });
    }
  });

  // ---------- tabs ----------
  let tab = 'party', cx = 'war';
  $('codexseg').addEventListener('click', e => {
    const b = e.target.closest('[data-cx]'); if (!b) return;
    cx = b.dataset.cx;
    document.querySelectorAll('#codexseg button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.cx').forEach(x => x.hidden = x.id !== 'cx-' + cx);
    updatePanel(true);
  });
  function switchTab(t) {
    tab = t;
    const f = TAB_FEATURE[t], shut = !!(f && S.hero && !L.canUse(S, f));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tabbody').forEach(b => b.hidden = b.id !== (shut ? 'tab-locked' : 'tab-' + t));
    if (shut) $('lockbox').innerHTML = roadHtml(f);
    updatePanel(true);
  }
  const phone = () => matchMedia('(max-width:720px)').matches;
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.go === 'arena') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    switchTab(b.dataset.tab);
    if (phone()) { const p = document.querySelector('.panel'); p && window.scrollTo({ top: p.getBoundingClientRect().top + window.scrollY - 8, behavior: 'smooth' }); }
  }));

  // ---------- header & stage ----------
  let lastRelicCount = -1, lastFeatCount = -1, slowTick = 0;
  function updatePanel(force) {
    const now = Date.now();
    if (force) paintTabLocks();
    $('gold').textContent = fmt(S.gold);
    { const sg = $('sigils'); if (sg) { let bal = typeof prof !== 'undefined' && prof ? prof.bal : null; if (!(bal >= 0)) { bal = null; try { const c = localStorage.getItem('lh_bal'); if (c != null && +c >= 0) bal = +c; } catch (e) {} } const on = bal != null && signedIn(); if (sg.hidden === on) sg.hidden = !on; if (on) { const t = bal.toLocaleString(); if ($('sigilct').textContent !== t) { $('sigilct').textContent = t; try { localStorage.setItem('lh_bal', String(bal)); } catch (e) {} } } } }
    $('dps').textContent = fmt(L.totalDps(S, now));
    { const tt = $('taptip'); if (tt) { const now = Date.now(), d = L.clickDamage(S, now), w = L.relicVal ? L.relicVal(S, 'whet') : 0, c = L.critChance(S);
      const t = 'Tap damage: ' + fmt(d) + ' per tap (' + fmt(d * 5) + ' on a critical hit). Each tap hits for 1 + 5% of your party damage per second' + (w ? ', plus ' + Math.round(w * 100) + '% from the Grim Whetstone' : '') + '. ' + Math.round(c * 1000) / 10 + '% of taps are critical hits for 5x damage.';
      if (tt.dataset.tip !== t) tt.dataset.tip = t; } }
    $('embers').textContent = fmt(S.embers); { const d = $('dust'); if (d) d.textContent = fmt(S.dust || 0); } { const hp = S.hero ? L.heroPoints(S) : 0; $('kindcount').textContent = S.kindling ? S.kindling : hp > 0 ? '+' + hp : ''; }
    if (tab === 'party' || tab === 'camp') updateSeats(force);
    if (tab === 'market' && force) showMarketView();
    if (tab === 'guild' && force) { if (!boardList && CL && signedIn() && !boardMsg) findHeroes(); else paintBoard(); }
    if (tab === 'gear') updateGear(force);
    if (tab === 'codex') {
      if (cx === 'journal' && force) updateJournal();
      if (cx === 'war' && force) paintWarRoom();
      if (cx === 'road' && force) $('roadbox').innerHTML = roadHtml() + masteryHtml();
      if (cx === 'relics' && (force || lastRelicCount !== Object.keys(S.relics).length)) updateRelics();
      if (cx === 'stats') { if (force || lastFeatCount !== L.featCount(S)) updateFeats(); updateLedger(); }
    }
    if (tab === 'rekindle') updateRekindle();
    lastRelicCount = Object.keys(S.relics).length; lastFeatCount = L.featCount(S);
    $('relcount').textContent = lastRelicCount + '/' + L.RELICS.length;
    $('featcount').textContent = lastFeatCount + '/' + L.FEATS.length;
    $('gearcount').textContent = L.packCount(S) || '';
    $('lorecount').textContent = Object.keys(S.lore).filter(k => L.LORE.find(l => l.id === k)).length + '/' + L.LORE.length;
    updateAbilities();
  }

  let lastPipKey = '', lastModKey = null;
  function updateStage() {
    const b = L.biomeOf(S.floor), cyc = L.depthCycle(S.floor);
    $('floor').textContent = S.floor;
    $('biome').textContent = b.name + (cyc ? ' ' + ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][Math.min(cyc, 7)] : '');
    document.documentElement.style.setProperty('--accent', b.accent);
    $('prev').disabled = S.floor <= 1;
    $('next').disabled = S.floor >= S.maxFloor;
    const boss = L.isBossFloor(S.floor);
    const pk = S.floor + ':' + S.foeIdx + ':' + boss;
    if (pk !== lastPipKey) {
      lastPipKey = pk;
      $('pips').innerHTML = boss ? '<i class="boss now"></i>' : Array.from({ length: L.FOES_PER_FLOOR }, (_, i) => '<i class="' + (i < S.foeIdx ? 'done' : i === S.foeIdx ? 'now' : '') + '"></i>').join('');
    }
    $('goalch').textContent = 'Chapter ' + L.chapterOf(S);
    { let g = L.currentGoal(S); if (S.maxFloorEver > L.ACT_ONE_END && !L.actTwoOpen()) { const d = Math.max(0, L.ACT_TWO_AT - Date.now()), dd = Math.floor(d / 864e5), hh = Math.floor(d / 36e5) % 24; g = 'Act Two opens with Season 2, in ' + (dd ? dd + 'd ' : '') + hh + 'h'; } if ($('goaltext').textContent !== g) $('goaltext').textContent = g; }
    paintGoblinHunt();
    const f = S.foe;
    if (f) {
      $('foename').textContent = f.pack ? f.name + ' and ' + (f.pack - 1) + ' more' : f.rescue ? f.name + ', holding ' + f.rescue : f.name;
      if (f.goblin && !f.seen) { f.seen = 1; goblinArrives(f); }
      const tag = $('foetag'); tag.textContent = f.wounded || f.rescue ? 'Mercy Corps' : f.world ? 'World boss' : f.goblin ? 'Thief' : f.pack ? 'Ambush ×' + f.pack + ' · XP ×' + f.pack * L.PACK_XP : f.boss ? 'Guardian' : f.chest ? 'Treasure' : f.elite ? L.SIDES[f.side].name : ''; if (f.pack) tag.dataset.tip = f.pack + ' foes at once: ' + f.pack * L.PACK_XP + '× hero XP and ' + f.pack * L.PACK_GOLD + '× gold.'; else if (f.wounded) tag.dataset.tip = 'A wounded Mercy Corps companion. Nobody fights: your healers mend them, Lantern Hymn helps a lot, and every tap is a bandage. Heal them to full for +' + L.AID_FX.pdps * 100 + '% damage and healing for ' + L.MERCY_MIN + ' minutes.'; else if (f.rescue) tag.dataset.tip = 'This monster holds ' + f.rescue + ' of the Mercy Corps captive. Defeat it to free them: +' + L.RESCUE_FX.xp * 100 + '% hero XP for ' + L.MERCY_MIN + ' minutes.'; else delete tag.dataset.tip; tag.className = 'tag' + (f.wounded || f.rescue ? ' mercy' : '') + (f.world ? ' world' : '') + (f.goblin ? ' thief' : '') + (f.chest ? ' chest' : '') + (f.pack ? ' ambush' : f.elite ? ' war w-' + f.side : '');
      { const sp = f.sp && L.SPECIALS[f.sp], mk = (f.mods || []).join(',') + '|' + (f.sp || ''); if (mk !== lastModKey) { lastModKey = mk; $('foemods').innerHTML = (sp ? '<span class="mod m-sp' + (sp.dot ? ' m-' + sp.dot : '') + '" title="' + esc(sp.desc + (sp.dot ? '. ' + (sp.dot === 'burn' ? 'Burns' : 'Poison') + ' last ' + L.DOT_FIGHTS + ' fights.' : '.')) + '">' + esc(sp.name) + '</span>' : '') + (f.mods || []).map(m => '<span class="mod m-' + m + '" title="' + esc(L.MODS[m].desc) + '">' + esc(L.MODS[m].name) + '</span>').join(''); } }
      if (f.world && S.wb) {
        const ph = L.wbPhase(wbState().total + S.wb.score), pct = ph.into / ph.need * 100;
        $('hpbar').style.width = Math.max(0, 100 - pct) + '%'; $('wardbar').style.width = '0%';
        $('hptext').textContent = 'Phase ' + (ph.broken + 1) + ' · ' + Math.floor(100 - pct) + '% left · your damage ' + (Math.floor(S.wb.score * 10) / 10);
      } else {
        $('hpbar').style.width = Math.max(0, f.hp / f.max * 100) + '%';
        $('wardbar').style.width = Math.min(100, (f.ward || 0) / f.max * 100) + '%';
        $('hptext').textContent = f.wounded ? 'Health ' + fmt(Math.max(0, f.hp)) + ' / ' + fmt(f.max) + ' · heal them to full' : fmt(Math.max(0, f.hp)) + ' / ' + fmt(f.max) + (f.ward > 0 ? ' + ' + fmt(f.ward) + ' ward' : '') + (f.shield > 0 ? ' · Shield ' + Math.ceil(f.shield * 100) + '%: tap to break' : '');
        $('hpbar').parentNode.classList.toggle('shielded', f.shield > 0); $('hpbar').parentNode.classList.toggle('aid', !!f.wounded);
      }
      $('lanternwrap').hidden = !f.boss && !f.goblin && !f.world && !f.wounded; $('lanternwrap').classList.toggle('aid', !!f.wounded); $('lanternwrap').classList.toggle('flee', !!f.goblin); $('lanternwrap').classList.toggle('wb', !!f.world); $('hpbar').parentNode.classList.toggle('wb', !!f.world);
      { const n = (S.items && S.items.oil) || 0; $('b-oil').hidden = !f.boss || !n || S.lantern <= 0; $('b-oil').textContent = 'Pour lantern oil (' + n + ')'; }
      if (f.world && S.wb) {
        const left = Math.max(0, (S.wb.until - Date.now()) / 1000);
        $('lanternbar').style.width = (left / L.WB_TIME * 100) + '%';
        $('lanterntext').textContent = 'Assault ends in ' + left.toFixed(0) + 's';
      } else if (f.wounded) {
        const left = Math.max(0, L.AID_TIME - f.aidT);
        $('lanternbar').style.width = (left / L.AID_TIME * 100) + '%';
        $('lanterntext').textContent = 'Carried to safety in ' + left.toFixed(0) + 's';
      } else if (f.goblin) {
        const left = Math.max(0, L.GOBLIN_TIME - f.flee);
        $('lanternbar').style.width = (left / L.GOBLIN_TIME * 100) + '%';
        $('lanterntext').textContent = 'Runs off in ' + left.toFixed(1) + 's';
      } else if (f.boss) {
        const lt = L.lanternTime(S), left = Math.max(0, lt - S.lantern);
        $('lanternbar').style.width = (left / lt * 100) + '%';
        $('lanterntext').textContent = 'Lantern oil ' + left.toFixed(1) + 's';
      }
    } else {
      // No foe up (between foes, or resting): clear the panel so it never shows a foe from another floor (John, 2026-11-24).
      $('foename').textContent = !L.alive(S).length ? 'Your party is resting' : L.isBossFloor(S.floor) ? 'The guardian steps up\u2026' : 'The next foe steps up\u2026';
      $('foetag').textContent = ''; $('foetag').className = 'tag';
      if (lastModKey !== '') { lastModKey = ''; $('foemods').innerHTML = ''; }
      $('hpbar').style.width = '0%'; $('wardbar').style.width = '0%'; $('hptext').textContent = '';
      $('lanternwrap').hidden = true; $('b-oil').hidden = true;
    }
    paintNexus();
    if ($('auto').checked !== S.autoAdvance) $('auto').checked = S.autoAdvance;
    if ($('autocast').checked !== S.autoCast) $('autocast').checked = S.autoCast;
  }
  // While the Nexus Guardian holds the stage, the foe panel shows it, and the timer bar fills as the rhythm calms.
  let nxWarned = false, nxShown = false;
  function paintNexus() {
    const x = S.nx, up = !!(x && x.ph === 1);
    if (x && !x.ph && x.m >= 0.5 && !nxWarned) { nxWarned = true; floatText('The wall trembles…', 'nexus', FOE_X - 0.05, 0.32); }
    if (!x || (!x.ph && !(x.m > 0))) nxWarned = false;
    $('lanternwrap').classList.toggle('nexus', up); $('hpbar').parentNode.classList.toggle('nexus', up);
    if (!up) { if (nxShown) { nxShown = false; lastModKey = null; } return; }
    nxShown = true;
    $('foename').textContent = 'The Nexus Guardian';
    const tag = $('foetag'); tag.textContent = 'Nexus'; tag.className = 'tag nexus';
    if (lastModKey !== 'nexus') { lastModKey = 'nexus'; $('foemods').innerHTML = ''; }
    $('hpbar').style.width = '100%'; $('wardbar').style.width = '0%';
    $('hptext').textContent = 'Untouchable · your blows pass through it';
    const calm = Math.max(0, Math.min(1, (Date.now() - x.last) / (L.NX_CALM * 1000)));
    $('lanternwrap').hidden = false; $('b-oil').hidden = true;
    $('lanternbar').style.width = (calm * 100) + '%';
    $('lanterntext').textContent = calm < 0.05 ? 'Ease your strikes and it will withdraw' : 'The Guardian loses interest…';
  }
  $('auto').addEventListener('change', e => { S.autoAdvance = e.target.checked; S.retryAt = 0; });
  $('autocast').addEventListener('change', e => { S.autoCast = e.target.checked; });
  $('prev').addEventListener('click', () => { L.gotoFloor(S, S.floor - 1); S.autoAdvance = false; updateStage(); });
  $('next').addEventListener('click', () => { L.gotoFloor(S, S.floor + 1); updateStage(); });

  let strikesThisSession = 0;
  function doStrike(ev) {
    if (!S.hero || !$('modal').hidden) return;
    L.strike(S, Date.now(), null, events);
    strikesThisSession++;
    if (strikesThisSession === 8) $('hint').style.opacity = 0;
    if (ev && ev.clientX != null && !(S.foe && S.foe.wounded)) {
      const r = arena.getBoundingClientRect();
      slashes.push({ x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H, a: Math.random() * Math.PI, t: tAnim, c: '#fff3dc', big: true });
    }
    handleEvents(); updateStage();
  }
  // ---------- Ghost Lantern (John, 2026-11-24) ----------
  // Shows up only while you are actively playing. It saps a little damage or healing (never more than 10%)
  // until you tap it. Tap to shatter it for a small reward; ignore it and it fades with nothing lost.
  let lastAct = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true }));
  const GHOST_SVG = '<svg viewBox="0 0 40 52" aria-hidden="true"><defs><radialGradient id="gg" cx="50%" cy="55%" r="55%"><stop offset="0" stop-color="#e9fbff"/><stop offset=".5" stop-color="#8fd8ff"/><stop offset="1" stop-color="#5a7dff" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="20" cy="30" r="19" fill="url(#gg)" opacity=".55"/><path d="M14 8h12M20 3v5" stroke="#b9c9e8" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
    '<path d="M11 13h18l3 5v18l-4 6H12l-4-6V18z" fill="#203450" stroke="#a9c3ec" stroke-width="2"/><path d="M13 19h14v16l-3 4h-8l-3-4z" fill="#bff0ff" opacity=".9"/>' +
    '<circle cx="17" cy="26" r="2" fill="#1b2a44"/><circle cx="23" cy="26" r="2" fill="#1b2a44"/><path d="M17.5 32q2.5 2 5 0" stroke="#1b2a44" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
  function paintGhost() {
    let el = $('ghostlamp'); const g = S.ghost, now = Date.now();
    if (!g || now >= g.until) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button'); el.id = 'ghostlamp'; el.className = 'ghostlamp'; el.type = 'button';
      el.innerHTML = GHOST_SVG + '<small></small>';
      ['pointerdown', 'mousedown', 'touchstart'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));
      el.addEventListener('click', e => { e.stopPropagation(); breakGhost(); });
      arena.appendChild(el);
    }
    el.style.left = (g.x * 100) + '%';
    const sap = Math.round(L.ghostSap(S, g.k, now) * 100), left = Math.ceil((g.until - now) / 1000);
    el.querySelector('small').textContent = '-' + sap + '% ' + L.GHOST_STATS[g.k] + ' · ' + left + 's';
    el.setAttribute('aria-label', 'Ghost Lantern: sapping ' + sap + '% party ' + L.GHOST_STATS[g.k] + '. Tap to shatter it.');
    el.classList.toggle('fading', left <= 5);
  }
  // ---------- Wandering merchant (John, 2026-11-24) ----------
  const MERCH_SVG = '<svg viewBox="0 0 40 52" aria-hidden="true"><path d="M20 4c-8 0-12 7-12 14v4h24v-4c0-7-4-14-12-14z" fill="#5a3b6e" stroke="#c9a6e8" stroke-width="1.6"/><ellipse cx="20" cy="19" rx="7" ry="6" fill="#1a1222"/><circle cx="17.5" cy="19" r="1.4" fill="#ffd27a"/><circle cx="22.5" cy="19" r="1.4" fill="#ffd27a"/>' +
    '<path d="M9 22h22l3 24H6z" fill="#4a2f5c" stroke="#c9a6e8" stroke-width="1.6"/><path d="M24 30h10v12H24z" fill="#a8743a" stroke="#ffd27a" stroke-width="1.4" rx="2"/><path d="M26 30v-3h6v3" stroke="#ffd27a" stroke-width="1.4" fill="none"/><circle cx="29" cy="36" r="1.6" fill="#ffd27a"/></svg>';
  let merchOpen = false;
  function paintMerchant() {
    let el = $('merchant'); const m = S.merchant, now = Date.now();
    if (!m || now >= m.until) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button'); el.id = 'merchant'; el.className = 'merchant'; el.type = 'button';
      el.innerHTML = MERCH_SVG + '<small></small>';
      ['pointerdown', 'mousedown', 'touchstart'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));
      el.addEventListener('click', e => { e.stopPropagation(); openMerchant(); });
      arena.appendChild(el);
    }
    const left = Math.ceil((m.until - now) / 1000);
    el.querySelector('small').textContent = 'Deal · ' + fmtTime(left);
    el.setAttribute('aria-label', 'Wandering merchant: one deal at half price, ' + left + ' seconds left');
    el.classList.toggle('fading', left <= 15);
  }
  function openMerchant() {
    const m = S.merchant; if (!m) return; const o = m.offer, can = S.gold >= o.price;
    merchOpen = true;
    modal('<div class="merchbox"><div class="merchhead">' + MERCH_SVG + '<div><h2>Wandering merchant</h2><small>“Just passing through. One deal, and I’m gone.”</small></div></div>' +
      '<div class="merchdeal"><b>' + esc(o.name) + '</b><small>' + esc(o.desc) + '</small><div class="merchprice"><s>' + fmt(o.was) + ' gold</s> <b>' + fmt(o.price) + ' gold</b> <span class="off">' + Math.round(L.MERCH_OFF * 100) + '% off</span></div></div>' +
      '<p class="note">Leaves in ' + fmtTime(Math.ceil((m.until - Date.now()) / 1000)) + '. ' + (o.k === 'dust' ? 'Dust goes straight to your purse.' : 'Tonics show up under the fight, Draughts next to Return to camp, and Oil in guardian fights.') + '</p>' +
      '<div class="row"><button class="btn ghost" id="mc-no">Not now</button><button class="btn" id="mc-buy"' + (can ? '' : ' disabled') + '>' + (can ? 'Buy for ' + fmt(o.price) + ' gold' : 'Need ' + fmt(o.price - S.gold) + ' more gold') + '</button></div></div>', md => {
        md.querySelector('#mc-no').onclick = () => { merchOpen = false; closeModal(); };
        md.querySelector('#mc-buy').onclick = () => {
          const r = L.merchantBuy(S, Date.now()); merchOpen = false; closeModal();
          if (!r) { toast('coin', 'The merchant shrugs', 'Not enough gold, or the merchant already left.', 'warn'); return; }
          sfx.buy(); save(); paintMerchant();
          toast('coin', 'Bought ' + r.name, 'Saved ' + fmt(r.was - r.price) + ' gold. The merchant tips a hood and slips away.', 'loot');
        };
      });
  }
  function breakGhost() {
    const r = L.ghostBreak(S, Date.now());
    const el = $('ghostlamp'); if (el) el.remove();
    if (!r) return;
    sfx.relic(); save();
    const what = r.kind === 'gold' ? '+' + fmt(r.n) + ' gold' : r.kind === 'dust' ? '+' + fmt(r.n) + ' Dust' : 'a free ' + r.name;
    floatText('Shattered! ' + (r.kind === 'tonic' ? r.name : what), 'skill', 0.5, 0.18);
    toast('lantern', 'Ghost Lantern shattered', 'It left behind ' + what + (r.kind === 'tonic' ? '. Drink it from the tonic bar under the fight.' : '.') + ' Your party is back to full strength.', 'loot');
  }
  const ambientQ = [];
  setInterval(() => {
    if (!S || !S.hero) return;
    const now = Date.now(), ev = ambientQ.splice(0);
    const act = !document.hidden && now - lastAct < 90000;
    if (act) S.actAt = now;
    try { L.ghostTick(S, now, act, Math.random, ev); L.merchantTick(S, now, act, Math.random, ev); } catch (e) { return; }
    for (const e of ev) {
      if (e.type === 'ghost') {
        sfx.boss && sfx.boss();
        if (!(S.stats.ghostSeen > 0)) { S.stats.ghostSeen = 1; toast('lantern', 'A Ghost Lantern drifts in', 'It slowly saps your party’s ' + L.GHOST_STATS[e.k] + ', up to 10%. Tap it in the fight to shatter it for a reward. Leave it and it fades on its own.', ''); }
        floatText('A Ghost Lantern drifts in!', 'nexus', 0.5, 0.12);
      } else if (e.type === 'ghostgone') floatText('The Ghost Lantern fades', 'auto', 0.5, 0.14);
      else if (e.type === 'merchant') {
        tone(523, 0.12, 'triangle', 0.04); setTimeout(() => tone(659, 0.12, 'triangle', 0.04), 120);
        toast('coin', 'A wandering merchant stops by', 'One deal at ' + Math.round(L.MERCH_OFF * 100) + '% off, for the next ' + Math.round(L.MERCH_LIFE / 60) + ' minutes. Tap the merchant beside the fight to see it.', '');
      } else if (e.type === 'merchgone') { floatText('The merchant moves on', 'auto', 0.18, 0.14); if (merchOpen) closeModal(); }
    }
    paintGhost(); paintMerchant();
  }, 500);
  arena.addEventListener('pointerdown', e => { e.preventDefault(); doStrike(e); });
  arena.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); doStrike(); } });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || !$('modal').hidden) return;
    const i = +e.key; if (i >= 1 && i <= 5 && S.party[i - 1]) { if (L.castAbility(S, S.party[i - 1], Date.now(), events)) handleEvents(); }
    else if (i >= 6 && i <= 8) { const ab = L.heroSpecs(S)[i - 6]; if (ab && L.castSpec(S, ab.id, Date.now(), events)) handleEvents(); }
  });

  // ---------- story scenes ----------
  const SPEAKER_ICON = { tank: 'shield', healer: 'cross', rogue: 'dagger', mage: 'flare', necro: 'skull', lamp: 'lamp', boss: 'crown' };
  let sceneOpen = false;
  function playScene(b, replay) {
    sceneOpen = true; let i = 0;
    $('modal').dataset.lock = '1';
    const show = () => {
      const [who, kind, text] = b.lines[i];
      const last = i === b.lines.length - 1;
      const joined = last && b.join && !replay && S.unlocked.includes(b.join) ? L.memberById(b.join) : null, waits = last && !replay && b.join && S.pendingJoin === b.join ? L.memberById(b.join) : null;
      modal('<div class="scene-head"><span>Chapter ' + b.ch + '</span><h2>' + esc(b.title) + '</h2></div>' +
        '<div class="line-box"><div class="spk k-' + kind + '">' + icon(SPEAKER_ICON[kind] || 'user') + '</div><div><b>' + esc(who) + '</b><p>' + esc(text) + '</p></div></div>' +
        (waits ? '<div class="joined">' + icon('flame') + '<span><b>' + esc(waits.name) + '</b> the ' + L.CLASSES[waits.cls].name + ' wants to join, but your campfire is full. You choose next.</span></div>' : '') +
        (joined ? '<div class="joined">' + icon(CLASS_ICON[joined.cls]) + '<span><b>' + esc(joined.name) + '</b> the ' + L.CLASSES[joined.cls].name + ' joins you.' + (S.party.includes(joined.id) ? '' : ' They wait at camp until you make room.') + '</span></div>' : '') +
        '<div class="row" style="justify-content:space-between;align-items:center"><small class="muted">' + (i + 1) + ' / ' + b.lines.length + '</small><button class="btn" id="s-next">' + (last ? (replay ? 'Close' : 'Onward') : 'Continue') + '</button></div>', md => {
          const go = () => { if (last) { delete $('modal').dataset.lock; closeModal(); sceneOpen = false; if (!replay) { save(); updateSeats(true); updateAbilities(true); updateJournal(); } } else { i++; show(); } };
          md.querySelector('#s-next').onclick = go; md.querySelector('#s-next').focus();
        });
    };
    show();
  }
  function checkStory() {
    if (sceneOpen || recruitOpen || !$('modal').hidden || !S.hero) return;
    if (S.pendingJoin) { openRecruit(); return; }
    const b = L.nextStory(S);
    if (b) playScene(b, false);
  }

  // ---------- new game setup ----------
  const CLASS_BLURB = {
    tank: 'Stands in front and takes the blows so nobody else has to.',
    healer: 'Keeps everyone standing. Without one, long fights go badly.',
    rogue: 'Hits hardest and dodges a quarter of all attacks.',
    mage: 'Calls down fire for huge bursts against guardians.',
    necro: 'Raises skeletons that fight and soak up hits.',
  };
  function setup(note) {
    let cls = 'rogue', side = 'covenant';
    $('modal').dataset.lock = '1';
    const draw = () => modal((CL && !signedIn() ? '<div class="haveacct"><span>Already have a hero?</span><button type="button" class="btn ghost small" id="h-signin">Sign in</button></div>' : '') + '<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Lanternhold</h2></div>' +
      (note ? '<p class="center">' + note + '</p>' : '<p class="center">The Grand War burns across the Shattered Reach. Beneath a forgotten Hold, a single lantern keeps a tear in the Nyx Rift shut, and every alliance wants what lies under it. Take the lantern down.</p>') +
      '<h3 class="sub">Choose your class</h3><div class="classes">' + L.CLASS_ORDER.map(c => '<button class="pick cls' + (cls === c ? ' on' : '') + '" data-cls="' + c + '"><span class="ic c-' + c + '">' + icon(CLASS_ICON[c]) + '</span><b>' + L.CLASSES[c].name + '</b><small>' + CLASS_BLURB[c] + '</small></button>').join('') + '</div>' +
      '<h3 class="sub">Pledge your banner</h3><div class="sides">' + L.SIDE_ORDER.map(k => { const d = L.SIDES[k]; return '<button class="pick side' + (side === k ? ' on' : '') + (WAR_ART[k] ? ' art' : '') + '" data-side="' + k + '" style="--side:' + d.color + (WAR_ART[k] ? ';--art:url(' + WAR_ART[k] + ')' : '') + '"><b>' + d.name + '</b><i>\u201c' + d.motto + '\u201d</i><small>' + d.desc + '</small><em>' + d.perk + '</em></button>'; }).join('') + '</div>' +
      '<h3 class="sub">Name your hero</h3><input id="h-name" maxlength="16" placeholder="2 to 16 letters" autocomplete="off"><div class="err" id="h-err"></div>' +
      '<div class="row" style="justify-content:center"><button class="btn big" id="h-go">Begin the descent</button></div>', md => {
        md.className = 'sheet wide setupsheet';
        const si = md.querySelector('#h-signin'); if (si) si.onclick = () => { delete $('modal').dataset.lock; authForm('in'); };
        const nm = md.querySelector('#h-name'); nm.value = setup.heroName || '';
        nm.oninput = () => { setup.heroName = nm.value; };
        md.querySelectorAll('[data-cls]').forEach(b => b.onclick = () => { cls = b.dataset.cls; draw(); });
        md.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { side = b.dataset.side; draw(); });
        md.querySelector('#h-go').onclick = () => {
          const name = nm.value.trim().replace(/\s+/g, ' ');
          if (!/^[A-Za-z][A-Za-z '\-]{1,15}$/.test(name)) { md.querySelector('#h-err').textContent = 'Use 2 to 16 letters. Spaces, hyphens and apostrophes are fine.'; return; }
          L.startGame(S, 'multi', cls, name, side);
          delete $('modal').dataset.lock; closeModal(); audio(); save();
          updateSeats(true); updateAbilities(true); updatePanel(true);
          setTimeout(checkStory, 400);
        };
      });
    draw();
  }


  // ---------- Loot Goblin ----------
  function goblinArrives(f) {
    sfx.boss(); floatText('Loot Goblin!', 'crit', 0.5, 0.3);
    if (f.goblin === 2) toast('bag', 'There he is!', 'The Loot Goblin has ' + L.gearName(S.goblin.item) + '. Bring him down in ' + L.GOBLIN_TIME + ' seconds to get it back.', 'feat');
    else toast('bag', 'A Loot Goblin!', 'Kill it within ' + L.GOBLIN_TIME + ' seconds or it steals an item from your pack. Strike fast and use your abilities. Worn gear is safe.', 'feat');
  }
  let gobKey = '';
  function paintGoblinHunt() {
    const g = S.goblin, el = $('gobhunt'), k = g ? g.floor + '|' + g.item.uid + '|' + (S.maxFloor >= g.floor) : '';
    if (k === gobKey) return; gobKey = k; el.hidden = !g; if (!g) return;
    el.innerHTML = icon('bag') + '<span>The Loot Goblin is hiding on <b>floor ' + g.floor + '</b> with your <b class="r-' + g.item.rar + '">' + esc(L.gearName(g.item)) + '</b></span>' + (S.maxFloor >= g.floor && S.floor !== g.floor ? '<em>Go there</em>' : '');
  }
  $('gobhunt').addEventListener('click', () => {
    const g = S.goblin; if (!g) return;
    if (S.maxFloor >= g.floor) { if (S.floor !== g.floor) { L.gotoFloor(S, g.floor); S.campReturn = 0; updateStage(); toast('map', 'Floor ' + g.floor, 'Find the Loot Goblin and bring him down.', ''); } }
    else toast('map', 'Keep descending', 'Reach floor ' + g.floor + ' and the goblin will show himself.', '');
  });
  // ---------- players online (heroes seen in the last 3 minutes) ----------
  async function loadOnline() {
    if (!CL || document.hidden) return;
    try { const r = await fetch(CL.api.replace(/\/$/, '') + '/leaderboard'); if (!r.ok) return; const j = await r.json(); if (j.keeper) { const was = L.keeperOn(S); S.keeper = { name: String(j.keeper).slice(0, 20), until: Date.now() + 150000 }; if (!was) { paintKeeper(); toast('lantern', 'The Lantern Keeper is here', S.keeper.name + ' is online: +25% damage, healing, gold, hero XP and gear finds for every hero while they stay.', 'feat'); } } else if (S.keeper) { S.keeper = null; paintKeeper(); } if (typeof j.online !== 'number') return; $('onlinect').textContent = Math.max(j.online, signedIn() && S.hero ? 1 : 0).toLocaleString('en-US'); $('online').hidden = false; } catch (e) {}
  }
  $('online').addEventListener('click', () => switchTab('guild'));
  function paintKeeper() {
    const el = $('keeperbar'); if (!el) return; const on = L.keeperOn(S);
    el.hidden = !on; if (on) { el.innerHTML = icon('lantern'); el.dataset.tip = 'The Lantern Keeper is here. ' + S.keeper.name + ' is online: +' + Math.round(L.KEEPER * 100) + '% damage, healing, gold, hero XP and gear finds for every hero.'; }
  }
  setInterval(paintKeeper, 15000);
  setTimeout(loadOnline, 2000); setInterval(loadOnline, 60000);
  { const tt = $('taptip'); if (tt) ['click', 'pointerdown', 'mousedown', 'touchstart'].forEach(ev => tt.addEventListener(ev, e => e.stopPropagation())); }
  // ---------- settings ----------
  $('btn-settings').addEventListener('click', openSettings);
  function openSettings() {
    modal('<h2>Settings</h2>' +
      '<label class="setrow"><span>Sound effects</span><input type="checkbox" id="s-sound"' + (S.settings.sound ? ' checked' : '') + '></label>' +
      (window.LHMusic ? '<label class="setrow"><span>Music</span><input type="checkbox" id="s-music"' + (LHMusic.on() ? ' checked' : '') + '></label>' +
        '<p class="setnote">Pick tracks, set the volume or mute from the <button class="linkbtn" id="s-musicpanel">music player</button> (the note button at the top).</p>' : '') +
      '<p style="margin-top:16px">Your progress saves automatically in this browser. Copy a backup to move it to another device.</p>' +
      '<div class="row"><button class="btn ghost" id="s-export">Copy backup</button><button class="btn ghost" id="s-import">Load backup</button><button class="btn danger" id="s-reset">Erase progress</button></div>' +
      '<div class="row"><button class="btn ghost" id="s-intro">Watch the intro</button>' + (fsOk() ? '<button class="btn ghost" id="s-full">' + (fsEl() ? 'Leave full screen' : 'Play full screen') + '</button>' : '') + '</div>' +
      '<div id="s-extra"></div>' +
      (window.LH_SUPPORT_URL ? '<p style="margin-top:16px">Lanternhold is free with no ads. If you enjoy it, you can <a style="color:var(--gold)" target="_blank" rel="noopener" href="' + window.LH_SUPPORT_URL + '">buy the developer a coffee</a>. Thank you.</p>' : '') +
      '<p class="credits">Lanternhold &middot; A Grand War game by Born 2 Game, LLC. &copy; 2026 Born 2 Game, LLC. Made with care, no ads, no tracking.</p>' +
      '<div class="row"><button class="btn" id="s-close">Done</button></div>', m => {
        m.querySelector('#s-sound').onchange = e => { S.settings.sound = e.target.checked; };
        if (window.LHMusic) {
          m.querySelector('#s-music').onchange = e => LHMusic.setOn(e.target.checked);
          m.querySelector('#s-musicpanel').onclick = () => { closeModal(); LHMusic.open(); };
        }
        m.querySelector('#s-close').onclick = () => { save(); closeModal(); };
        m.querySelector('#s-full') && (m.querySelector('#s-full').onclick = () => { save(); closeModal(); toggleFull(); });
        m.querySelector('#s-intro').onclick = () => { save(); closeModal(); if (window.LHIntro) LHIntro.play(); };
        m.querySelector('#s-export').onclick = () => {
          save(); const code = btoa(unescape(encodeURIComponent(localStorage.getItem(SAVE_KEY) || '')));
          m.querySelector('#s-extra').innerHTML = '<p>Your backup code:</p><textarea readonly></textarea>';
          const ta = m.querySelector('textarea'); ta.value = code; ta.select();
          try { navigator.clipboard.writeText(code).then(() => toast('star', 'Backup copied', 'Paste it somewhere safe.', 'feat')).catch(() => {}); } catch (e) {}
        };
        m.querySelector('#s-import').onclick = () => {
          m.querySelector('#s-extra').innerHTML = '<p>Paste a backup code:</p><textarea></textarea><div class="row"><button class="btn" id="s-doimport">Load it</button></div>';
          m.querySelector('#s-doimport').onclick = () => {
            try { const o = JSON.parse(decodeURIComponent(escape(atob(m.querySelector('textarea').value.trim())))); S = L.migrate(o); save(); closeModal(); location.reload(); }
            catch (e) { toast('lock', 'That code did not work', 'Check that you copied all of it.', 'warn'); }
          };
        };
        m.querySelector('#s-reset').onclick = () => {
          m.querySelector('#s-extra').innerHTML = '<p style="color:#ff9c88">This erases everything, including your hero, gear, Embers and relics' + (signedIn() ? ' and the save stored with your account' : '') + '. It cannot be undone.</p><div class="row"><button class="btn danger" id="s-doreset">Yes, erase it all</button></div>';
          m.querySelector('#s-doreset').onclick = async () => { await eraseCloud(); try { localStorage.removeItem(SAVE_KEY); } catch (e) {} S = L.newState(); location.reload(); };
        };
      });
  }

  // ---------- offline ----------
  function grantOffline(sec, fromLoad) {
    const away = sec, win = L.offlineWindow(S);
    sec = Math.min(win, sec);
    const g = L.offlineEarnPerSec(S) * sec;
    if (g > 0) { S.gold += g; S.stats.goldEarned += g; }
    if (fromLoad && sec >= 60 && g > 0) {
      modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Welcome back</h2><p>Your party kept delving for ' + fmtTime(sec) + ' while you were away and brought home</p><div class="big">' + fmt(g) + ' gold</div><p class="muted">Away from the game your party earns a quarter of its usual gold.' + (away > win ? ' They stopped after ' + fmtTime(win) + ' and waited for you at the stair.' + (win < L.OFFLINE_MAX ? ' Night Watch in the Skills tab keeps them going longer, up to 3 days.' : '') : '') + '</p><div class="row" style="justify-content:center"><button class="btn" id="m-ok">Collect</button></div></div>', m => { m.querySelector('#m-ok').onclick = () => { sfx.coin(); closeModal(); }; });
    }
  }

  // ---------- main loop ----------
  let lastLogic = Date.now(), lastSave = Date.now(), lastSlow = 0;
  function logic() {
    const now = Date.now();
    let dt = (now - lastLogic) / 1000; lastLogic = now;
    if (S.hero) {
      if (dt > 5) grantOffline(dt, false);
      else if (dt > 0) L.tick(S, dt, now, null, events);
    }
    handleEvents();
    updateStage();
    checkStory();
    if (now - lastSlow > 250) {
      lastSlow = now;
      if (S.hero && S.autoTrain && now - (logic.lastAuto || 0) > 1000) { logic.lastAuto = now; if (L.autoTrain(S, mainCamp())) updateSeats(true); }
      updatePanel(false);
      const got = L.checkFeats(S);
      got.forEach(f => toast('star', 'Feat earned: ' + f.name, f.desc + ' (+1% party damage)', 'feat'));
    }
    if (now - lastSave > 10000) { lastSave = now; save(); }
  }

  // ---------- optional accounts and cloud saves (AWS Cognito + API) ----------
  // Switched on by window.LH_CLOUD in index.html. Guests can always play without an account.
  const CL = window.LH_CLOUD && window.LH_CLOUD.clientId ? window.LH_CLOUD : null;
  const TOK_KEY = 'lanternhold.session.v1';
  let sess = null, lastCloud = 0;
  try { sess = JSON.parse(localStorage.getItem(TOK_KEY) || 'null'); } catch (e) {}
  const signedIn = () => !!(sess && sess.refresh);
  function storeSess() { try { sess ? localStorage.setItem(TOK_KEY, JSON.stringify(sess)) : localStorage.removeItem(TOK_KEY); } catch (e) {} }
  function saveObj() { S.lastSeen = Date.now(); const o = Object.assign({}, S); delete o.foe; delete o._frenzyAcc; delete o.enchAt; delete o.shopK; return o; }
  function summary(o) { return 'Floor ' + (o.maxFloorEver || 1) + ', ' + fmt(o.embers || 0) + ' Embers, ' + fmtTime((o.stats && o.stats.playTime) || 0) + ' played'; }
  function claims(jwt) { try { return JSON.parse(decodeURIComponent(escape(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return {}; } }

  async function cognito(action, body) {
    const r = await fetch('https://cognito-idp.' + CL.region + '.amazonaws.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.' + action },
      body: JSON.stringify(Object.assign({ ClientId: CL.clientId }, body)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.message || 'Something went wrong'); e.code = (j.__type || '').split('#').pop(); throw e; }
    return j;
  }
  function takeTokens(res, email) {
    const t = res.AuthenticationResult;
    sess = { id: t.IdToken, exp: Date.now() + (t.ExpiresIn - 60) * 1000, refresh: t.RefreshToken || (sess && sess.refresh), email: email || (sess && sess.email) || claims(t.IdToken).email };
    storeSess(); paintAccount();
  }
  async function idToken() {
    if (!signedIn()) return null;
    if (sess.id && sess.exp > Date.now()) return sess.id;
    try { takeTokens(await cognito('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: sess.refresh } })); return sess.id; }
    catch (e) { if (e.code === 'NotAuthorizedException') { sess = null; storeSess(); paintAccount(); } return null; }
  }
  async function api(method, body, path) {
    const tok = await idToken(); if (!tok) throw new Error('signed out');
    const r = await fetch(CL.api.replace(/\/$/, '') + (path || '/save'), { method, headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404) return null;
    if (r.status === 409 && !path) { const j = await r.json().catch(() => ({})); if (j.error === 'reset') playerReset(); }
    if (!r.ok) throw new Error('cloud ' + r.status);
    return r.json();
  }
  // An admin reset this account: drop this device's save and start a brand-new game.
  function playerReset() {
    try { localStorage.removeItem(SAVE_KEY); localStorage.setItem('lanternhold.wiped', 'me'); } catch (e) {}
    S = L.newState(); location.reload();
  }
  async function pushCloud(quiet) {
    if (!CL || !signedIn() || !S.hero || dormant) return;
    try {
      const o = saveObj();
      await api('PUT', { data: JSON.stringify(o), floor: o.maxFloorEver, created: o.created || 0 });
      lastCloud = Date.now();
      if (S.mode === 'multi' && S.hero) publishHero();
      if (!quiet) toast('star', 'Progress synced', 'Your save is stored with your account.', 'feat');
    } catch (e) { if (!quiet) toast('lock', 'Could not sync right now', 'Your progress is still saved on this device.', 'warn'); }
  }
  // Publish your hero to the board; owners earn gold whenever someone recruits them.
  async function publishHero() {
    try {
      let ref = ''; try { ref = localStorage.getItem('lh_ref') || ''; } catch (e) {}
      const r = await api('PUT', { name: S.hero.name, cls: S.hero.cls, side: S.hero.side, level: L.lvl(S, 'you'), floor: S.maxFloorEver, ref }, '/hero');
      if (!prof) loadProfile();
      const n = r && r.recruits;
      if (n > 0) {
        const g = Math.max(20, L.offlineGoldPerSec(S) * 600) * n;
        S.gold += g; S.stats.goldEarned += g;
        toast('user', 'Your hero was recruited', n + (n === 1 ? ' player' : ' players') + ' took ' + S.hero.name + ' into their party. +' + fmt(g) + ' gold.', 'feat');
      }
    } catch (e) {}
  }
  async function reconcile() {
    let rec; try { rec = await api('GET'); } catch (e) { if (!S.hero && $('modal').hidden) setup(); return; }
    const local = saveObj();
    if (!rec && !S.hero) { setup('You are signed in, but this account has no hero yet. Create one below and it will be saved to your account.'); return; }
    if (!rec) { await pushCloud(false); return; }
    if (rec.rst && (S.created || 0) < rec.rst) { playerReset(); return; }
    let cloud; try { cloud = JSON.parse(rec.data); } catch (e) { if (S.hero) await pushCloud(true); else setup(); return; }
    if (!S.hero) { useSave(cloud); return; }
    const ct = (cloud.stats && cloud.stats.playTime) || 0;
    if (Math.abs(ct - local.stats.playTime) < 5) { lastCloud = Date.now(); return; }
    if (!local.stats.kills && !local.embers) { useSave(cloud); return; }
    $('modal').dataset.lock = '1';
    modal('<h2>Choose a save</h2><p>Your account already has progress, and this device has different progress. Which one do you want to keep? The other is replaced.</p>' +
      '<div class="choice"><button class="pick" id="c-cloud"><b>Account save</b><small>' + summary(cloud) + '</small></button>' +
      '<button class="pick" id="c-local"><b>This device</b><small>' + summary(local) + '</small></button></div>', m => {
        m.querySelector('#c-cloud').onclick = () => { delete $('modal').dataset.lock; closeModal(); useSave(cloud); };
        m.querySelector('#c-local').onclick = () => { delete $('modal').dataset.lock; closeModal(); pushCloud(false); };
      });
  }
  function useSave(o) {
    S = L.migrate(o); S.lastSeen = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveObj())); } catch (e) {}
    location.reload();
  }
  function paintAccount() {
    try { if (chat.open) { paintChat(); pollChat(); } } catch (e) {}
    paintAdminTab();
    const b = $('btn-account'); if (!b) return;
    if (signedIn()) { b.innerHTML = '<span class="avatar">' + ((sess.email || '?')[0].toUpperCase()) + '</span>'; b.setAttribute('aria-label', 'Account'); b.title = 'Signed in. Progress syncs.'; }
    else { b.innerHTML = icon('user') + '<span>Sign in</span>'; b.setAttribute('aria-label', 'Sign in'); b.title = 'Sign in to sync your progress'; }
  }
  const friendly = e => ({
    NotAuthorizedException: 'That email and password don’t match.', UserNotFoundException: 'That email and password don’t match.',
    UsernameExistsException: 'There is already an account with that email. Try signing in.', CodeMismatchException: 'That code didn’t match. Only the code in your newest Lanternhold email works, so check for a later one (and your Spam or Junk folder).',
    ExpiredCodeException: 'That code has expired. Tap “Send a new code” below.', InvalidPasswordException: 'Please use a password of at least 8 characters.',
    LimitExceededException: 'Too many tries. Please wait a few minutes.', TooManyRequestsException: 'Too many tries. Please wait a few minutes.',
    InvalidParameterException: 'Please check the email address.',
  })[e.code] || 'Something went wrong. Please try again.';

  function authForm(mode, email, note) {
    const titles = { in: 'Sign in', up: 'Create an account', confirm: 'Check your email', forgot: 'Reset your password', reset: 'Choose a new password' };
    const f = {
      in: '<input id="f-email" type="email" autocomplete="email" placeholder="Email" required><input id="f-pass" type="password" autocomplete="current-password" placeholder="Password" required>',
      up: '<input id="f-email" type="email" autocomplete="email" placeholder="Email" required><input id="f-pass" type="password" autocomplete="new-password" placeholder="Password (8 or more characters)" minlength="8" required>',
      confirm: '<input id="f-code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required>',
      forgot: '<input id="f-email" type="email" autocomplete="email" placeholder="Email" required>',
      reset: '<input id="f-code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required><input id="f-pass" type="password" autocomplete="new-password" placeholder="New password (8 or more characters)" minlength="8" required>',
    }[mode];
    const lead = {
      in: 'Sign in to keep your progress safe and play on any device. It is optional, and the game works the same without it.',
      up: 'Your save is stored with your account so you can pick it up anywhere.',
      confirm: 'We sent a code to <b class="em"></b>. Enter it below. <span class="codeage"></span>',
      forgot: 'Enter your email and we will send you a code.',
      reset: 'We sent a code to <b class="em"></b>.',
    }[mode];
    const btn = { in: 'Sign in', up: 'Create account', confirm: 'Confirm', forgot: 'Send code', reset: 'Save password' }[mode];
    const links = {
      in: '<button type="button" class="link" data-go="up">Create an account</button><button type="button" class="link" data-go="forgot">Forgot password?</button>',
      up: '<button type="button" class="link" data-go="in">I already have an account</button>',
      confirm: '<button type="button" class="link" id="f-resend">Send a new code</button><button type="button" class="link" data-go="up">Use a different email</button>',
      forgot: '<button type="button" class="link" data-go="in">Back to sign in</button>', reset: '',
    }[mode];
    modal('<form class="auth" novalidate><h2>' + titles[mode] + '</h2><p>' + lead + '</p>' + (mode === 'in' || mode === 'up' ? '<button type="button" class="btn b2g" id="f-b2g">Continue with Born 2 Game</button><div class="or"><span>or use your email</span></div>' : '') + f +
      '<div class="err" id="f-err"></div><button class="btn" type="submit" id="f-go">' + btn + '</button><div class="links">' + links + '</div>' +
      '<button type="button" class="btn ghost skipacct" id="f-skip">' + (S.hero ? 'Play without an account' : 'Back to making a new hero') + '</button>' +
      '<p class="credits">An account is optional. It only keeps your save safe across devices. We only keep your email and game save. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p></form>', m => {
        m.querySelector('#f-skip').onclick = () => { const had = !!S.hero; closeModal(); if (had) toast('user', 'Playing without an account', 'Your progress saves on this device. You can sign in any time from the top bar.', 'feat'); };
        const ca = m.querySelector('.codeage'); if (ca) { const t = codeSent(email); ca.textContent = t ? 'The newest code was sent at ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '. Older codes stop working. It can take a few minutes, so check Spam or Junk too.' : 'It can take a few minutes, so check Spam or Junk too.'; }
        m.querySelectorAll('.em').forEach(x => x.textContent = email || '');
        const em = m.querySelector('#f-email'); if (em && email) em.value = email;
        const err = m.querySelector('#f-err'); if (note) { err.textContent = note; err.classList.add('ok'); }
        m.querySelectorAll('[data-go]').forEach(x => x.onclick = () => authForm(x.dataset.go, em ? em.value.trim() : email));
        const bg = m.querySelector('#f-b2g'); if (bg) bg.onclick = async () => { bg.disabled = true; try { await storeSignIn(); } catch (e) { bg.disabled = false; err.textContent = 'Could not reach the Born 2 Game store. Please try again.'; } };
        const rs = m.querySelector('#f-resend'); if (rs) {
          const tick = () => { const w = Math.ceil((codeSent(email) + 60000 - Date.now()) / 1000); rs.disabled = w > 0; rs.textContent = w > 0 ? 'Send a new code (' + w + 's)' : 'Send a new code'; if (w > 0 && m.isConnected) setTimeout(tick, 1000); };
          tick();
          rs.onclick = async () => {
            if (codeSent(email) + 60000 > Date.now()) return;
            try { await cognito('ResendConfirmationCode', { Username: email }); codeSent(email, Date.now()); authForm('confirm', email, 'New code sent. Use the code in this newest email; earlier codes no longer work.'); }
            catch (e) { err.textContent = friendly(e); }
          };
        }
        (m.querySelector('input') || {}).focus && m.querySelector('input').focus();
        m.querySelector('form').onsubmit = async ev => {
          ev.preventDefault(); err.textContent = ''; err.classList.remove('ok');
          const go = m.querySelector('#f-go'); go.disabled = true;
          const v = id => { const x = m.querySelector(id); return x ? x.value.trim() : ''; };
          const mail = v('#f-email') || email, pass = m.querySelector('#f-pass') ? m.querySelector('#f-pass').value : '';
          try {
            if ((mode === 'in' || mode === 'up' || mode === 'forgot') && !/^\S+@\S+\.\S+$/.test(mail)) throw { code: 'InvalidParameterException' };
            if ((mode === 'up' || mode === 'reset') && pass.length < 8) throw { code: 'InvalidPasswordException' };
            if (mode === 'in') {
              try { takeTokens(await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: mail, PASSWORD: pass } }), mail); }
              catch (e) { if (e.code === 'UserNotConfirmedException') { pendingPass = pass; if (codeSent(mail) + 15 * 60000 < Date.now()) { await cognito('ResendConfirmationCode', { Username: mail }).catch(() => {}); codeSent(mail, Date.now()); } return authForm('confirm', mail, 'Finish setting up your account with the code we emailed you.'); } throw e; }
              closeModal(); toast('user', 'Signed in', 'Your progress will sync to your account.', 'feat'); reconcile();
            } else if (mode === 'up') {
              await cognito('SignUp', { Username: mail, Password: pass, UserAttributes: [{ Name: 'email', Value: mail }] });
              pendingPass = pass; codeSent(mail, Date.now()); authForm('confirm', mail);
            } else if (mode === 'confirm') {
              await cognito('ConfirmSignUp', { Username: email, ConfirmationCode: v('#f-code').replace(/\D/g, '') });
              if (pendingPass) {
                takeTokens(await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: pendingPass } }), email);
                pendingPass = ''; closeModal(); toast('user', 'Account ready', 'Your progress now syncs to your account.', 'feat'); reconcile();
              } else authForm('in', email, 'Email confirmed. Sign in to continue.');
            } else if (mode === 'forgot') {
              await cognito('ForgotPassword', { Username: mail }); authForm('reset', mail);
            } else if (mode === 'reset') {
              await cognito('ConfirmForgotPassword', { Username: email, ConfirmationCode: v('#f-code').replace(/\D/g, ''), Password: pass });
              authForm('in', email, 'Password changed. Sign in with your new password.');
            }
          } catch (e) { err.textContent = friendly(e); }
          finally { go.disabled = false; }
        };
      });
  }
  let pendingPass = '';
  // When we last asked Cognito to email a sign-up code to this address. Cognito only honors the newest code,
  // so we never send a fresh one automatically while an earlier email may still be on its way.
  function codeSent(mail, t) {
    const k = 'lh_code_' + String(mail || '').toLowerCase();
    try { if (t) localStorage.setItem(k, String(t)); return +localStorage.getItem(k) || 0; } catch (e) { return t || 0; }
  }
  function openAccount() {
    if (!CL) return;
    if (!signedIn()) return authForm('in');
    modal('<h2>Your account</h2><p>Signed in as <b class="em" style="color:var(--text)"></b>. Your progress syncs every minute and whenever you leave the game.</p>' +
      '<div class="row"><button class="btn" id="a-sync">Sync now</button><button class="btn ghost" id="a-out">Sign out</button></div>' +
      '<p class="credits"><a href="privacy.html" target="_blank" rel="noopener">Privacy</a> &middot; Erase progress in Settings also deletes the save stored with your account.</p>' +
      '<div class="row"><button class="btn ghost" id="a-close">Done</button></div>', m => {
        m.querySelector('.em').textContent = sess.email || '';
        m.querySelector('#a-sync').onclick = () => pushCloud(false);
        m.querySelector('#a-out').onclick = async () => {
          await pushCloud(true);
          try { await cognito('RevokeToken', { Token: sess.refresh }); } catch (e) {}
          sess = null; storeSess(); try { localStorage.removeItem('lh_wix'); localStorage.removeItem('lh_bal'); } catch (e) {} paintAccount(); closeModal(); toast('user', 'Signed out', 'Your progress stays on this device too.', '');
        };
        m.querySelector('#a-close').onclick = closeModal;
      });
  }
  async function eraseCloud() { if (CL && signedIn()) { try { await api('DELETE'); } catch (e) {} } }
  if (CL) {
    $('btn-account').hidden = false; paintAccount();
    $('btn-account').addEventListener('click', openAccount);
    if (signedIn()) setTimeout(reconcile, 800);
    setInterval(() => { if (signedIn() && Date.now() - lastCloud > 60000) pushCloud(true); }, 15000);
    setTimeout(pollInvites, 3000); setInterval(() => { if (!document.hidden) pollInvites(); }, 30000); setInterval(drainJoins, 2000);
    document.addEventListener('visibilitychange', () => { if (document.hidden && signedIn()) pushCloud(true); });
  }

  // ---------- support link ----------
  if (window.LH_SUPPORT_URL) { const a = $('support'); a.href = window.LH_SUPPORT_URL; a.hidden = false; a.title = 'Buy the developer a coffee'; }

  // ---------- player profiles: looks bought with Sigils, and Grand War commander badges ----------
  // Prices live on the server too (infra/lambda/profile.js). Cosmetics only: nothing here changes power.
  const TOKEN = 'Sigils';
  const EMB = {
    lantern: 'M9 3h6M10 3v2M14 3v2M8 5h8l1 3v8l-1 3H8l-1-3V8zM12 10v4', shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z', sword: 'M14.5 3H20v5.5L10 18.5 5.5 14zM7 16l-3 3 1 1 3-3',
    skull: 'M12 3a7 7 0 0 0-7 7c0 3 1.5 4.5 3 5.5V19h8v-3.5c1.5-1 3-2.5 3-5.5a7 7 0 0 0-7-7zM8.5 11a1 1 0 1 0 2 0a1 1 0 1 0-2 0M13.5 11a1 1 0 1 0 2 0a1 1 0 1 0-2 0M10 19v2M14 19v2',
    flame: 'M12 3c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-3 1.5-4.5 3-6 0 2 1 3 2 3 0-3-1-5.5 0-8z', wave: 'M3 14c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 19c2-3 4-3 6 0s4 3 6 0 4-3 6 0M6 9c1-4 6-6 9-3',
    sun: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2', moon: 'M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z',
    star: 'M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6L12 16.3l-5.4 3 1.3-6-4.6-4.1 6.1-.6z', key: 'M3 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M11 12h10M18 12v3M15 12v2',
    anvil: 'M4 7h13c0 3-2 4-4 4v3h3v3H7v-3h3v-3C7 11 4 9 4 7zM17 7h3', crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    rose: 'M12 13c-3 0-5-2-5-5 2 0 3 1 3.5 2C11 7 12 5 12 5s1 2 1.5 5c.5-1 1.5-2 3.5-2 0 3-2 5-5 5zM12 13v8M12 17c-2 0-3-1-4-2M12 18c2 0 3-1 4-2',
    raven: 'M3 13c3-1 5-4 9-4 3 0 5 2 6 1l3-1-2 3c0 4-4 7-9 7l-2 3v-3c-2-1-4-3-5-6z', rift: 'M12 2c-2 4 3 6 0 10s3 6 0 10M8 7c-2 2-2 8 0 10M16 7c2 2 2 8 0 10',
  };
  const COSMETICS = {
    f: { label: 'Frame', items: [['plain', 'Plain Iron', 0], ['iron', 'Covenant Iron', 150], ['radiant', 'Radiant Gilt', 150], ['tide', 'Tide Maw', 150], ['mercy', 'Mercy Laurel', 150], ['ember', 'Ember Ring', 250], ['rift', 'Riftglass', 400], ['nexus', 'Nexus Crown', 600]] },
    t: { label: 'Title', items: [['delver', 'Delver', 0], ['lampbearer', 'Lampbearer', 80], ['ashborn', 'Ashborn', 120], ['nightwatch', 'of the Night Watch', 120], ['riftwalker', 'Rift-Walker', 200], ['warden', 'Warden of the Hold', 200], ['stormcaller', 'Stormcaller', 200], ['oathkeeper', 'Oathkeeper', 250], ['heir', 'Heir of the Lamp', 400]] },
    c: { label: 'Name color', items: [['none', 'Plain', 0], ['gold', 'War Gold', 100], ['violet', 'Nyx Violet', 100], ['ember', 'Ember', 100], ['frost', 'Frost', 100], ['verdant', 'Verdant', 100], ['rift', 'Riftlight', 300]] },
    g: { label: 'Banner', items: [['night', 'Night Watch', 0], ['forge', 'Cinder Forge', 150], ['crypt', 'Mosswater', 150], ['glass', 'Glass Wastes', 150], ['storm', 'Stormglass', 200], ['rift', 'The Rift', 350], ['nexus', 'The Nexus', 500]] },
    e: { label: 'Emblems', items: [['lantern', 'Lantern', 0], ['shield', 'Shield', 0], ['sword', 'Sword', 0], ['skull', 'Skull', 40], ['flame', 'Flame', 40], ['wave', 'Wave', 40], ['sun', 'Sun', 40], ['moon', 'Moon', 40], ['star', 'Star', 40], ['key', 'Key', 40], ['anvil', 'Anvil', 40], ['crown', 'Crown', 60], ['eye', 'Eye', 60], ['rose', 'Rose', 60], ['raven', 'Raven', 80], ['rift', 'Rift', 100]] },
  };
  const cosOf = (k, id) => (COSMETICS[k].items.find(x => x[0] === id) || COSMETICS[k].items[0]);
  const emblem = id => EMB[id] ? '<svg viewBox="0 0 24 24" class="emb"><path d="' + EMB[id] + '"/></svg>' : '';
  const sigil = '<svg viewBox="0 0 24 24" class="sigil"><path d="M12 2l3 5 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z"/></svg>';
  let prof = null, warList = null, warAt = 0;
  async function papi(method, path, body) {
    const tok = await idToken(); if (!tok) throw Object.assign(new Error('Sign in first.'), { code: 'auth' });
    const r = await fetch(CL.api.replace(/\/$/, '') + path, { method, headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || ('server ' + r.status)), { code: j.error || r.status });
    return j;
  }
  async function loadProfile() {
    if (!CL || !signedIn()) return null;
    try { prof = await papi('GET', '/profile'); } catch (e) { return prof; }
    try { localStorage.setItem('lh_bal', String(prof.bal)); } catch (e) {}
    if ((prof.pass || 0) !== (S.pass || 0) || (prof.sub || 0) !== (S.sub || 0)) { S.pass = prof.pass || 0; S.sub = prof.sub || 0; save(); updatePanel(true); updateSeats(true); }
    if (!!prof.boh !== !!S.boh) { S.boh = !!prof.boh; save(); updateGear(true); }
    if (prof.own) syncRoster(prof.own);
    // A verified commander link turns on the hero's Grand War aura.
    const had = JSON.stringify(S.war || null);
    if (prof.wv && prof.wl) { await loadWar(); const c = commander(prof.wl); if (c) S.war = { n: c.n, lv: c.lv | 0, h: c.h.slice(0, 12) }; }
    else delete S.war;
    if (JSON.stringify(S.war || null) !== had) { save(); updatePanel(true); }
    loadWardrobe();
    return prof;
  }
  // The aura block shown on your hero and in the profile editor.
  function auraBox() {
    const a = L.warAura(S);
    if (!a) return '';
    return '<div class="aura c-' + a.cls + '"><div class="aurah"><b>' + esc(a.name) + '</b><small>Grand War ' + esc(S.war.n) + ', rank ' + (a.lv + 1) + ' of 7</small></div><ul>' + a.lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul></div>';
  }
  async function loadWar() {
    if (!CL) return [];
    if (warList && Date.now() - warAt < 3e5) return warList;
    try { const r = await fetch(CL.api.replace(/\/$/, '') + '/war'); if (r.ok) { warList = (await r.json()).c || []; warAt = Date.now(); } } catch (e) {}
    return warList || [];
  }
  const commander = n => n && (warList || []).find(c => c.n.toLowerCase() === String(n).toLowerCase());
  // A Grand War badge: alliance, rank on the war ladder, and honors.
  function warBadge(n, big) {
    if (!n) return '';
    const c = commander(n), sd = c && L.SIDES[c.a];
    if (!c) return '<span class="warbadge"><b>Grand War</b> ' + esc(n) + '</span>';
    return '<span class="warbadge' + (big ? ' big' : '') + '" style="--side:' + (sd ? sd.color : '#f5c242') + '" title="' + esc('Grand War commander ' + c.n + (sd ? ', ' + sd.name : '') + ', ' + c.r) + '"><b>' + esc(c.r) + '</b>' + (big ? esc(sd ? sd.name : '') : esc(c.n)) + '</span>' +
      (big ? c.h.map(h => '<span class="warbadge honor"><b>Honor</b>' + esc(h) + '</span>').join('') : c.h.length ? '<span class="warbadge honor" title="' + esc(c.h.join(', ')) + '"><b>' + c.h.length + '</b>' + (c.h.length === 1 ? 'honor' : 'honors') + '</span>' : '');
  }
  // The profile card: banner, framed portrait, colored name, title, emblems, bio and war badges.
  function looksCard(o) {
    const pf = o.pf || {}, ok = o.wd && o.wd.k && o.wd.k.you, fr = cosOf('f', pf.f)[0], bn = cosOf('g', pf.g)[0], nc = cosOf('c', pf.c)[0], tt = pf.t ? cosOf('t', pf.t)[1] : '';
    const wb = o.wd && o.wd.b && BANNERS[o.wd.b] ? o.wd.b : '';
    return '<div class="pfcard bn-' + bn + (wb ? ' hasban' : '') + '">' + (wb ? '<div class="pfban">' + bannerSVG(wb) + '</div>' : '') + '<div class="pfava fr-' + fr + '"><div class="ic c-' + o.cls + ' player' + (ok ? ' dressed' : '') + '">' + (ok ? '<img src="' + SP.spriteURL(o.cls, 2, outfitHue(ok)) + '" alt="">' : icon(CLASS_ICON[o.cls])) + '</div></div>' +
      '<div class="pfmain"><b class="pfname nc-' + nc + '">' + esc(o.name) + '</b>' + (tt ? '<small class="pftitle">' + esc(tt) + '</small>' : '') +
      '<div class="pftags">' + classTag(o.cls) + (o.level ? '<span class="pflv">Power level ' + o.level + (o.floor ? ' · floor ' + o.floor : '') + '</span>' : '') + '</div>' +
      ((pf.e || []).length ? '<div class="pfemb">' + pf.e.map(emblem).join('') + '</div>' : '') + '</div></div>' +
      (pf.b ? '<p class="pfbio">' + esc(pf.b) + '</p>' : '') +
      (o.w ? '<div class="pfwar">' + warBadge(o.w, true) + '</div>' : '');
  }
  function boardProfile(g) {
    loadWar().then(() => {
      modal('<div class="pfwrap">' + looksCard(g) + '<div class="row"><button class="btn ghost" id="bp-x">Close</button></div></div>', md => { md.querySelector('#bp-x').onclick = closeModal; });
    });
  }
  // ---- the editor ----
  let edTab = 'f', draft = null;
  async function openProfileEditor() {
    if (!CL) return;
    if (!signedIn()) { modal('<div class="center"><h2>Your profile</h2><p>Sign in to set up a profile that other players can see. Your looks and Sigils stay with your account, even after a server reset.</p><div class="row"><button class="btn ghost" id="pe-x">Close</button></div></div>', md => md.querySelector('#pe-x').onclick = closeModal); return; }
    modal('<div class="center"><p class="note">Opening your profile…</p></div>');
    await Promise.all([loadProfile(), loadWar()]);
    if (!prof) { modal('<div class="center"><h2>Your profile</h2><p>The profile server could not be reached. Try again in a minute.</p><div class="row"><button class="btn ghost" id="pe-x">Close</button></div></div>', md => md.querySelector('#pe-x').onclick = closeModal); return; }
    const p = prof.pf || {};
    draft = { b: p.b || '', t: p.t || '', f: p.f || '', c: p.c || '', g: p.g || '', e: (p.e || []).slice() };
    paintEditor();
  }
  const owns = (k, id, price) => !price || prof.own.includes(k + '.' + id);
  function paintEditor() {
    const me = { name: S.hero ? S.hero.name : 'You', cls: S.hero ? S.hero.cls : 'tank', level: L.lvl(S, 'you'), floor: S.maxFloorEver, pf: draft, wd: S.wd, w: prof.wv ? prof.wl : '' };
    const tabs = Object.keys(COSMETICS).map(k => '<button class="' + (edTab === k ? 'on' : '') + '" data-et="' + k + '">' + COSMETICS[k].label + '</button>').join('') +
      '<button class="' + (edTab === 'b' ? 'on' : '') + '" data-et="b">Bio</button><button class="' + (edTab === 'w' ? 'on' : '') + '" data-et="w">Grand War</button>';
    let body = '';
    if (COSMETICS[edTab]) {
      const k = edTab, multi = k === 'e';
      body = (multi ? '<p class="note">Pick up to 6 emblems for your card. ' + draft.e.length + ' of 6 chosen.</p>' : '') + '<div class="cosgrid">' + COSMETICS[k].items.map(([id, name, price]) => {
        const have = owns(k, id, price), on = multi ? draft.e.includes(id) : (draft[k] || COSMETICS[k].items[0][0]) === id;
        const sw = k === 'f' ? '<span class="cs-f fr-' + id + '"><i></i></span>' : k === 'c' ? '<span class="cs-c nc-' + id + '">Aa</span>' : k === 'g' ? '<span class="cs-g bn-' + id + '"></span>' : k === 'e' ? emblem(id) : '<span class="cs-t">' + esc(name) + '</span>';
        return '<button class="cos' + (on ? ' on' : '') + (have ? '' : ' locked') + '" data-cos="' + id + '">' + sw + (k === 't' ? '' : '<b>' + esc(name) + '</b>') +
          '<small>' + (have ? (on ? (multi ? 'Shown' : 'Equipped') : 'Owned') : sigil + price) + '</small></button>';
      }).join('') + '</div>';
    } else if (edTab === 'b') {
      body = '<label class="note" for="pe-bio">A line or two about your hero. Other players see it on your card. No links.</label><textarea id="pe-bio" maxlength="140" rows="3" placeholder="Sworn to the lantern since the first floor.">' + esc(draft.b) + '</textarea><small class="note" id="pe-bc">' + draft.b.length + ' / 140</small>';
    } else {
      const c = commander(prof.wl);
      body = '<p class="note">Play in the Grand War? Link your commander and your war rank and honors appear on your card and in the Players Guild. The Born 2 Game team checks each link before it shows, so nobody can borrow your name.</p>' +
        (prof.wl ? '<div class="wlink"><div>' + (c ? warBadge(prof.wl, true) : '<b>' + esc(prof.wl) + '</b>') + '</div><small>' + (prof.wv ? 'Verified. Your badges are showing and your hero carries a Grand War aura.' : 'Waiting for the team to confirm it is you. Mention it in the Grand War Discord to speed it up.') + '</small><button class="btn small ghost" id="pe-unlink">Remove link</button></div>' :
          '<div class="wform"><input id="pe-cmd" list="pe-cmds" placeholder="Your commander name in the Grand War" autocomplete="off"><datalist id="pe-cmds">' + (warList || []).map(c => '<option value="' + esc(c.n) + '">').join('') + '</datalist><button class="btn small" id="pe-link">Request link</button></div>' +
          '<p class="note">Once the link is verified, your hero carries a Grand War aura for their class. It grows with your war rank, and honors such as Grand Marshal add to it.</p><p class="note">Commanders on the Grand War ladder right now: ' + (warList || []).length + '. Not listed yet? Play a game in the war first.</p>');
    }
    modal('<div class="maphead"><div><h2>Your profile</h2><small>Looks only. Nothing here changes your party’s power.</small></div><button class="iconbtn" id="pe-x" aria-label="Close">&times;</button></div>' +
      '<div class="pfwrap">' + looksCard(me) + '</div>' +
      '<div class="pfacct">' +
        '<button class="pft" id="pe-get"><small>' + TOKEN + '</small><b>' + sigil + fmt(prof.bal) + '</b><em>Shop</em></button>' +
        '<button class="pft" id="pe-pass"><small>Lanternholder</small><b>' + (subOn() ? 'Member' : passLeft() ? passLeft() + ' left' : 'Not active') + '</b><em>' + (subOn() ? 'Perks' : passLeft() ? 'Extend' : 'Get it') + '</em></button>' +
        (wardOn() ? '<button class="pft" id="pe-ward"><small>Wardrobe</small><b>Outfits</b><em>Open</em></button>' : '') +
        '<button class="pft" id="pe-boh"><small>Bag of Holding</small><b>' + (S.boh ? 'Owned' : 'Not owned') + '</b><em>' + (S.boh ? 'Details' : 'See it') + '</em></button>' +
      '</div><h3 class="pflook">Card looks</h3>' +
      '<div class="seg pfseg">' + tabs + '</div><div class="pfbody">' + body + '</div>' +
      '<div class="row"><button class="btn ghost" id="pe-cancel">Cancel</button><button class="btn" id="pe-save">Save profile</button></div>', md => {
        md.querySelector('#pe-x').onclick = closeModal; md.querySelector('#pe-cancel').onclick = closeModal;
        md.querySelector('#pe-get').onclick = () => getSigils(paintEditor); md.querySelector('#pe-pass').onclick = openPass; const pw = md.querySelector('#pe-ward'); if (pw) pw.onclick = () => openWardrobe('k'); const bo = md.querySelector('#pe-boh'); if (bo) bo.onclick = () => openBoh();
        md.querySelectorAll('[data-et]').forEach(b => b.onclick = () => { if (edTab === 'b') draft.b = (md.querySelector('#pe-bio') || {}).value || draft.b; edTab = b.dataset.et; paintEditor(); });
        const bio = md.querySelector('#pe-bio'); if (bio) bio.oninput = () => { draft.b = bio.value; md.querySelector('#pe-bc').textContent = bio.value.length + ' / 140'; };
        md.querySelectorAll('[data-cos]').forEach(b => b.onclick = () => pickCos(edTab, b.dataset.cos));
        const lk = md.querySelector('#pe-link'); if (lk) lk.onclick = () => linkCommander(md.querySelector('#pe-cmd').value);
        const ul = md.querySelector('#pe-unlink'); if (ul) ul.onclick = () => linkCommander('');
        md.querySelector('#pe-save').onclick = saveLooks;
      });
  }
  function pickCos(k, id) {
    const it = cosOf(k, id);
    if (!owns(k, id, it[2])) return buyCos(k, it);
    if (k === 'e') { const i = draft.e.indexOf(id); if (i >= 0) draft.e.splice(i, 1); else if (draft.e.length < 6) draft.e.push(id); else toast('star', 'Six emblems at most', 'Tap a shown emblem to take it off first.', 'warn'); }
    else draft[k] = id;
    paintEditor();
  }
  function buyCos(k, it) {
    const [id, name, price] = it, can = prof.bal >= price;
    modal('<div class="center"><div class="cosbuy">' + (k === 'e' ? emblem(id) : k === 'f' ? '<span class="cs-f fr-' + id + '"><i></i></span>' : k === 'g' ? '<span class="cs-g bn-' + id + '"></span>' : k === 'c' ? '<span class="cs-c nc-' + id + '">Aa</span>' : '') + '</div><h2>' + esc(name) + '</h2><p>' + COSMETICS[k].label + ' for your profile card. ' + sigil + '<b>' + price + '</b> ' + TOKEN + '. You have ' + prof.bal + '.</p>' +
      '<div class="row"><button class="btn ghost" id="cb-no">Back</button>' + (can ? '<button class="btn" id="cb-yes">Buy for ' + price + '</button>' : '<button class="btn" id="cb-get">Get Sigils</button>') + '</div></div>', md => {
        md.querySelector('#cb-no').onclick = paintEditor;
        const g = md.querySelector('#cb-get'); if (g) g.onclick = () => getSigils(paintEditor);
        const y = md.querySelector('#cb-yes'); if (y) y.onclick = async () => {
          y.disabled = true;
          try { const r = await papi('POST', '/shop', { id: k + '.' + id }); Object.assign(prof, r); sfx.buy(); if (k === 'e') { if (draft.e.length < 6) draft.e.push(id); } else draft[k] = id; toast('star', name + ' is yours', 'Press Save profile to show it.', 'feat'); }
          catch (e) { toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : e.code === 'owned' ? 'You already own it.' : 'Try again in a moment.', 'warn'); }
          paintEditor();
        };
      });
  }
  // ---------- Sigil packs from the Born 2 Game store ----------
  // The store runs on Wix. Players sign in there once (OAuth with PKCE, no secrets in the page); the game
  // keeps the member token and the server checks it with Wix before crediting paid packs.
  const WIX = 'https://www.wixapis.com', WIX_APP = 'd9d54315-ca58-47e4-9e15-b661ae7e141d', WIX_KEY = 'lh_wix';
  const PACKS = [['7c5854d4-49f8-4244-8ec3-6c27caaa6e59', 500, '$4.99', ''], ['57d4ee44-c741-4616-96ff-9350734b19da', 1100, '$9.99', '10% bonus'],
    ['c19c183a-a27a-4918-8d3c-f94e684fb2d8', 2400, '$19.99', '20% bonus'], ['27c5a9e9-b7fb-48d9-90c8-a450b85e083a', 6500, '$49.99', 'Best value']];
  // Lanternholder: the one recurring plan. $4.99 a month until the player cancels in their store account.
  const SUB_PLAN = '36118cbb-d4f6-48ce-be59-65a2b9b82a13', SUB_PRICE = '$4.99', SUB_MANAGE = 'https://www.born2gamellc.com/account/my-subscriptions';
  const subOn = () => S.sub > Date.now();
  const subDate = () => new Date(S.sub - 864e5).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const homeUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const wixGet = () => { try { return JSON.parse(localStorage.getItem(WIX_KEY) || 'null'); } catch (e) { return null; } };
  const wixPut = w => { try { w ? localStorage.setItem(WIX_KEY, JSON.stringify(w)) : localStorage.removeItem(WIX_KEY); } catch (e) {} };
  async function wixPost(path, body, tok) {
    const r = await fetch(WIX + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: tok } : {}), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error('store ' + r.status), { code: 'store' });
    return j;
  }
  const keepTokens = (j, old) => { const w = Object.assign({}, old || {}, { a: j.access_token, x: Date.now() + (j.expires_in || 3600) * 1000 }); if (j.refresh_token) w.r = j.refresh_token; wixPut(w); return w; };
  async function wixToken() {
    const w = wixGet(); if (!w) return null;
    if (w.a && w.x > Date.now() + 60000) return w.a;
    if (!w.r) return null;
    try { return keepTokens(await wixPost('/oauth2/token', { clientId: WIX_APP, grantType: 'refresh_token', refreshToken: w.r }), w).a; }
    catch (e) { wixPut(null); return null; }
  }
  const b64u = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
  async function wixGo(body, tok) {
    if (!tok) tok = (await wixPost('/oauth2/token', { clientId: WIX_APP, grantType: 'anonymous' })).access_token;
    const r = await wixPost('/redirect-session/v1/redirect-session', body, tok);
    save(); if (signedIn()) await Promise.race([pushCloud(true), new Promise(ok => setTimeout(ok, 3000))]);
    location.href = r.redirectSession.fullUrl;
  }
  async function storeSignIn() {
    const v = rnd(48), st = rnd(12), ch = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
    try { sessionStorage.setItem('lh_pkce', JSON.stringify({ v, st })); } catch (e) {}
    await wixGo({ auth: { authRequest: { redirectUri: homeUrl(), clientId: WIX_APP, codeChallenge: ch, codeChallengeMethod: 'S256', responseMode: 'fragment', responseType: 'code', scope: 'offline_access', state: st } } });
  }
  async function buyPack(id) {
    const tok = await wixToken();
    if (!tok) return storeSignIn();
    await wixGo({ paidPlansCheckout: { planId: id }, callbacks: { postFlowUrl: homeUrl() + '?store=back', thankYouPageUrl: homeUrl() + '?store=paid' } }, tok);
  }
  let storeBusy = false;
  async function storeSync(loud) {
    if (storeBusy || !CL || !signedIn()) return;
    const tok = await wixToken(); if (!tok) return;
    storeBusy = true;
    try {
      const r = await papi('POST', '/store/sync', { token: tok });
      const w = wixGet(); if (w) { w.n = r.name; wixPut(w); }
      if (prof) prof.bal = r.bal;
      if (r.sub !== undefined && (r.sub || 0) !== (S.sub || 0)) {
        const fresh = r.sub > Date.now() && !(S.sub > Date.now());
        S.sub = r.sub || 0; if (prof) prof.sub = S.sub; save(); updatePanel(true); updateSeats(true);
        if (fresh) { sfx.buy(); toast('star', 'Welcome, Lanternholder', 'Auto-train, 10 extra bag slots and 4 more hours away are on for as long as your membership is active. Thank you!', 'feat'); }
      }
      if (r.added) { sfx.buy(); toast('star', '+' + r.added.toLocaleString() + ' ' + TOKEN, 'Your store purchase is in your wallet, and it lit a Lantern Surge for every player. Thank you for supporting Lanternhold!', 'feat'); loadSurge(true); }
      else if (loud) toast('star', 'All caught up', 'No new store purchases on ' + r.name + '. A new purchase can take a minute to show.', '');
    } catch (e) {
      if (e.code === 'taken') { wixPut(null); toast('lock', 'Store account already linked', 'That Born 2 Game account is linked to another hero. Sign in to the game as that hero to use it.', 'warn'); }
      else if (e.code === 'wix') { wixPut(null); if (loud) toast('lock', 'Store sign-in expired', 'Sign in with your Born 2 Game account again.', 'warn'); }
      else if (loud) toast('lock', 'Could not reach the store', 'Try again in a moment.', 'warn');
    }
    storeBusy = false;
  }
  // Back from the store: finish the sign-in, or look for a new purchase.
  async function storeReturn() {
    const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
    const code = h.get('code'), err = h.get('error'), back = q.get('store');
    if (!code && !err && !back) return false;
    q.delete('store'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    if (code) {
      let p = null; try { p = JSON.parse(sessionStorage.getItem('lh_pkce') || 'null'); sessionStorage.removeItem('lh_pkce'); } catch (e) {}
      if (!p || p.st !== h.get('state')) return;
      try { keepTokens(await wixPost('/oauth2/token', { clientId: WIX_APP, grantType: 'authorization_code', redirectUri: homeUrl(), code, codeVerifier: p.v })); }
      catch (e) { toast('lock', 'Store sign-in did not finish', 'Try signing in again from Get Sigils.', 'warn'); return; }
      if (!signedIn()) {
        // Not signed in to the game: the store account becomes the game sign-in.
        try {
          const r = await fetch(CL.api.replace(/\/$/, '') + '/store/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await wixToken() }) });
          const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status);
          takeTokens(j, j.name); toast('user', 'Signed in with Born 2 Game', 'Welcome, ' + j.name + '. Your progress will sync to your account.', 'feat'); reconcile();
        } catch (e) { toast('lock', 'Could not sign in', 'The store sign-in worked, but the game could not open your account. Try again in a moment.', 'warn'); return; }
        await new Promise(ok => setTimeout(ok, 1500));
      }
      await storeSync(false);
      const w = wixGet(); if (w && w.n) toast('user', 'Store account linked', w.n + ' is linked to this hero. Packs you buy land in your wallet.', 'feat');
    } else if (back) {
      await storeSync(back === 'paid');
      if (back === 'paid') setTimeout(() => storeSync(false), 20000);
    }
    return true;
  }
  function getSigils(back) {
    back = typeof back === 'function' ? back : closeModal;
    const w = wixGet(), linked = !!(w && (w.a || w.r)), member = subOn(), bal = prof ? prof.bal : null, left = passLeft();
    const tiles = PACKS.map(p => '<button class="pack" data-pack="' + p[0] + '">' + sigil + '<b>' + p[1].toLocaleString() + '</b><small>' + TOKEN + '</small>' + (p[3] ? '<em>' + p[3] + '</em>' : '') + '<span>' + p[2] + '</span></button>').join('');
    const use = (id, ic, name, what, act) => '<button class="shopuse" id="' + id + '"><span class="su-ic">' + icon(ic) + '</span><span class="su-t"><b>' + name + '</b><small>' + what + '</small></span><em>' + act + '</em></button>';
    modal('<div class="maphead"><div><h2>' + TOKEN + ' shop</h2><small>Buy ' + TOKEN + ' once, then spend them on the things below or sell them to other players for gold.</small></div><button class="iconbtn" id="gs-x" aria-label="Close">&times;</button></div>' +
      (signedIn() && bal != null ? '<div class="shopbal">' + sigil + '<span>You have <b>' + fmt(bal) + '</b> ' + TOKEN + '</span></div>' : '') +
      // 1. what Sigils are for
      '<div class="shopsec"><h3>Spend ' + TOKEN + '</h3></div><div class="shopuses">' +
        use('gs-pass', 'star', 'Lanternholder', member ? 'Member, renews ' + subDate() : left ? left + ' left' : L.PASS_COST + ' ' + TOKEN + ' for 30 days', member ? 'Perks' : left ? 'Extend' : 'Get') +
        use('gs-boh', 'bag', 'Bag of Holding', S.boh ? 'Owned' : fmt(L.BOH_COST) + ' ' + TOKEN + ', once', S.boh ? 'Details' : 'See') +
        (wardOn() ? use('gs-ward', 'user', 'Wardrobe', 'Outfits and lantern styles', 'Open') : '') +
        use('gs-look', 'crown', 'Profile looks', 'Frames, titles, banners, emblems', 'Open') +
        (CL ? use('gs-mkt', 'coin', 'Sigil exchange', 'Sell ' + TOKEN + ' for gold, or buy them with gold', 'Open') : '') +
      '</div>' +
      // 2. Lanternholder: one set of perks, two ways to get it
      '<div class="shopsec subbox"><h3>Lanternholder <span class="tag">Premium</span></h3>' +
      '<p class="shopsub">Convenience, never power.</p>' +
      '<ul class="passfx tight"><li><b>Auto-train</b><span>Characters train themselves whenever you have the gold.</span></li>' +
      '<li><b>+' + L.PASS_BAG + ' bag slots</b><span>More room for loot.</span></li>' +
      '<li><b>+' + L.PASS_OFFLINE / 3600 + ' hours away</b><span>Your party earns offline for longer.</span></li></ul>' +
      (member ? '<p class="passstate">You are a Lanternholder member. It renews on <b>' + subDate() + '</b>.</p>' : left ? '<p class="passstate">Lanternholder is on for <b>' + left + '</b>.</p>' : '') +
      '<div class="lhways"><div class="lhway"><small>With ' + TOKEN + '</small><b>' + sigil + L.PASS_COST + '</b><span>30 days. Nothing renews. Buy again to add 30 more.</span><button class="btn" id="gs-pass2"' + (member ? ' disabled' : '') + '>' + (left && !member ? 'Add 30 days' : 'Use ' + L.PASS_COST + ' ' + TOKEN) + '</button></div>' +
        '<div class="lhway"><small>Monthly membership</small><b>' + SUB_PRICE + '<i>/month</i></b><span>Renews every month until you cancel in your Born 2 Game account.</span>' +
        (member ? '<a class="btn ghost" href="' + SUB_MANAGE + '" target="_blank" rel="noopener">Manage or cancel</a>' : '<button class="btn ghost" id="gs-sub">Subscribe</button>') + '</div></div></div>' +
      // 3. buying Sigils
      '<div class="shopsec"><h3>Buy ' + TOKEN + ' <span class="tag once">One-time</span></h3><p class="shopsub">Pay once. Nothing renews. Every pack also lights a <b>Lantern Surge</b> for everyone: +25% gold and XP, 30 minutes per 500 ' + TOKEN + '.</p></div>' +
      '<div class="packs">' + tiles + '</div>' +
      (!signedIn() ? '<p class="note">Sign in to the game first so we know which hero gets the ' + TOKEN + '.</p>' :
        linked ? '<div class="storelink"><span>Store account: <b>' + esc(w.n || 'linked') + '</b></span><button class="btn small ghost" id="gs-sync">Check for purchases</button><button class="btn small ghost" id="gs-out">Unlink</button></div>' :
        '<div class="storelink"><span>Packs and memberships are sold in the Born 2 Game store. Sign in there once and every purchase lands on this hero.</span><button class="btn small" id="gs-in">Sign in with Born 2 Game</button></div>') +
      '<p class="note small">Payment is handled by the Born 2 Game store at born2gamellc.com. Every account starts with 100 ' + TOKEN + ', and the team hands more out at Grand War events.</p>' +
      '<div class="row"><button class="btn ghost" id="gs-ok">Back</button></div>', md => {
        md.querySelector('#gs-x').onclick = closeModal; md.querySelector('#gs-ok').onclick = () => back();
        const go = async (b, f) => { b.disabled = true; try { await f(); } catch (e) { b.disabled = false; toast('lock', 'Could not reach the store', 'Check your connection and try again.', 'warn'); } };
        const need = () => { if (signedIn()) return true; toast('user', 'Sign in first', 'Make a free game account so your purchase has a home.', 'warn'); return false; };
        const reopen = () => getSigils(back);
        md.querySelectorAll('[data-pack]').forEach(b => b.onclick = () => { if (need()) go(b, () => buyPack(b.dataset.pack)); });
        const sb = md.querySelector('#gs-sub'); if (sb) sb.onclick = () => { if (need()) go(sb, () => buyPack(SUB_PLAN)); };
        md.querySelector('#gs-pass').onclick = () => openPass(reopen);
        const p2 = md.querySelector('#gs-pass2'); if (p2) p2.onclick = () => openPass(reopen);
        md.querySelector('#gs-boh').onclick = () => openBoh(reopen);
        const wd = md.querySelector('#gs-ward'); if (wd) wd.onclick = () => openWardrobe('k');
        md.querySelector('#gs-look').onclick = () => openProfileEditor();
        const mk = md.querySelector('#gs-mkt'); if (mk) mk.onclick = () => { closeModal(); openTrade('sigils'); };
        const i = md.querySelector('#gs-in'); if (i) i.onclick = () => go(i, storeSignIn);
        const sy = md.querySelector('#gs-sync'); if (sy) sy.onclick = async () => { sy.disabled = true; await storeSync(true); getSigils(back); };
        const o = md.querySelector('#gs-out'); if (o) o.onclick = () => { wixPut(null); toast('user', 'Store account unlinked', 'This device no longer checks it for purchases.', ''); getSigils(back); };
      });
    if (signedIn() && !prof && CL) loadProfile().then(() => { if (prof && document.querySelector('#gs-x')) getSigils(back); }).catch(() => {});
  }
  setTimeout(() => { storeReturn().then(done => { if (!done) storeSync(false); }); }, 1500);
  async function linkCommander(n) {
    n = String(n || '').trim();
    if (n && !commander(n)) { toast('lock', 'Commander not found', 'Pick your name from the Grand War list. It must match the war ladder exactly.', 'warn'); return; }
    try { await papi('POST', '/warlink', { name: n }); prof.wl = n; prof.wv = false; toast('star', n ? 'Link requested' : 'Link removed', n ? 'Your badges appear once the team confirms it is you.' : 'Your card no longer shows Grand War badges.', 'feat'); }
    catch (e) { toast('lock', 'That did not work', e.code === 'state' ? 'Play a little first so your hero is registered, then try again.' : 'Try again in a moment.', 'warn'); }
    paintEditor();
  }
  async function saveLooks() {
    const bio = $('pe-bio'); if (bio) draft.b = bio.value;
    try { const r = await papi('PUT', '/profile', draft); prof.pf = r.pf; closeModal(); sfx.buy(); toast('star', 'Profile saved', 'Other players see your new look in the Players Guild.', 'feat'); }
    catch (e) { toast('lock', 'Could not save', e.code === 'bio' ? 'Keep the bio friendly, without links, under 140 characters.' : e.code === 'state' ? 'Play a little first so your hero is registered, then try again.' : 'Try again in a moment.', 'warn'); }
  }
  $('sigils').addEventListener('click', () => openProfileEditor());
  // ---------- Mercy's Blessing: real donations to the Grand War's Mercy Corps buff every player ----------
  const mercyLeft = () => { const ms = (S.mercy || 0) - Date.now(); if (ms <= 0) return ''; const h = Math.floor(ms / 36e5); return h >= 48 ? Math.floor(h / 24) + 'd' : h >= 1 ? h + 'h' : Math.max(1, Math.ceil(ms / 6e4)) + 'm'; };
  function paintMercy() { const b = $('mercy'), t = mercyLeft(); if (b.hidden === !!t) b.hidden = !t; if (t) $('mercyct').textContent = t; }
  async function loadMercy() {
    if (!CL) return;
    try {
      const r = await fetch(CL.api.replace(/\/$/, '') + '/mercy'); if (!r.ok) return;
      const m = await r.json(), fresh = m.at && m.at !== S.mercyAt && m.until > Date.now();
      S.mercy = m.until; S.mercyAt = m.at;
      if (fresh) toast('cross', 'Mercy’s Blessing is lit', 'A donation to the Mercy Corps blesses every hero: +10% gold, +10% health and +20% healing for ' + mercyLeft() + '.', 'feat');
      paintMercy(); updatePanel(true);
    } catch (e) {}
  }
  $('mercy').addEventListener('click', () => {
    const fx = L.MERCY_FX;
    modal('<div class="maphead"><div><h2>Mercy’s Blessing</h2><small>Lit by real donations. Shared by every hero.</small></div><button class="iconbtn" id="mb-x" aria-label="Close">&times;</button></div>' +
      '<p>Every time someone gives to the Grand War’s Mercy Corps, the medics bless the whole Hold. The blessing has <b>' + (mercyLeft() || 'no time') + '</b> left.</p>' +
      '<ul class="mercyfx"><li>+' + fx.gold * 100 + '% gold</li><li>+' + fx.hp * 100 + '% party health</li><li>+' + fx.heal * 100 + '% healing</li></ul>' +
      '<p class="note">Each $10 given, 5 food items or toy donated to the Mercy Corps adds 2 hours for everyone, up to 7 days ahead. The Corps raises money for Extra Life, food for a local pantry and toys for a children’s hospital.</p>' +
      '<div class="row"><a class="btn" href="https://war.born2gamellc.com/" target="_blank" rel="noopener">Give to the Mercy Corps</a><button class="btn ghost" id="mb-ok">Close</button></div>', md => { md.querySelector('#mb-x').onclick = closeModal; md.querySelector('#mb-ok').onclick = closeModal; });
  });
  // ---------- Lantern Surge: every Sigil pack bought lights +25% gold and XP for all players ----------
  const surgeLeft = () => { const ms = (S.surge || 0) - Date.now(); if (ms <= 0) return ''; const h = Math.floor(ms / 36e5), m = Math.ceil((ms % 36e5) / 6e4); return h >= 1 ? h + 'h' + (m < 60 && m > 0 ? ' ' + m + 'm' : '') : Math.max(1, m) + 'm'; };
  function paintSurge() { const b = $('surge'); if (!b) return; const t = surgeLeft(); if (b.hidden === !!t) b.hidden = !t; if (t) $('surgect').textContent = t; }
  async function loadSurge(mine) {
    if (!CL) return;
    try {
      const r = await fetch(CL.api.replace(/\/$/, '') + '/surge', { cache: 'no-store' }); if (!r.ok) return;
      const m = await r.json(), fresh = m.at && m.at !== S.surgeAt && m.until > Date.now();
      S.surge = m.until; S.surgeAt = m.at; save();
      if (fresh && !mine) { sfx.relic(); toast('star', 'Lantern Surge!', 'A fellow lantern-bearer just bought Sigils, and every hero gets +25% gold and +25% XP for ' + surgeLeft() + '. Thank them in chat!', 'feat'); }
      paintSurge(); updatePanel(true);
    } catch (e) {}
  }
  if ($('surge')) $('surge').addEventListener('click', () => {
    const fx = L.SURGE_FX;
    modal('<div class="maphead"><div><h2>Lantern Surge</h2><small>Lit by players who support the game. Shared by every hero.</small></div><button class="iconbtn" id="su-x" aria-label="Close">&times;</button></div>' +
      '<p>Whenever someone buys a Sigil pack, the Hold’s great lantern flares and every hero shares the light. The surge has <b>' + (surgeLeft() || 'no time') + '</b> left.</p>' +
      '<ul class="mercyfx surgefx"><li>+' + fx.gold * 100 + '% gold</li><li>+' + fx.xp * 100 + '% hero XP</li></ul>' +
      '<p class="note">Each pack adds time for everyone: 30 minutes for 500 Sigils, about an hour for 1,100, over two hours for 2,400 and six and a half hours for 6,500, up to a day ahead. It never changes combat power.</p>' +
      '<div class="row"><button class="btn" id="su-get">Get ' + TOKEN + '</button><button class="btn ghost" id="su-ok">Close</button></div>', md => { md.querySelector('#su-x').onclick = closeModal; md.querySelector('#su-ok').onclick = closeModal; md.querySelector('#su-get').onclick = () => getSigils(); });
  });
  setTimeout(loadSurge, 3000); setInterval(loadSurge, 12e4); setInterval(paintSurge, 3e4);
  // Fetch the Sigil balance as soon as the game opens (the cached last value shows until it arrives).
  if (CL && signedIn()) loadProfile();
  setTimeout(loadMercy, 2500); setInterval(loadMercy, 3e5); setInterval(paintMercy, 3e4);
  // ---------- Lantern Pass: 30 days of convenience for 500 Sigils (auto-train, +10 bag slots, +4 h offline) ----------
  if (!S.passTrialGiven) { S.passTrialGiven = 1; S.passTrial = Date.now() + 3 * 864e5; save(); }
  const passLeft = () => { const ms = Math.max(S.pass || 0, S.passTrial || 0) - Date.now(); if (ms <= 0) return ''; const d = Math.floor(ms / 864e5); return d >= 1 ? d + (d === 1 ? ' day' : ' days') : Math.max(1, Math.ceil(ms / 36e5)) + ' h'; };
  async function openPass(back) {
    back = typeof back === 'function' ? back : null;
    if (CL && signedIn() && !prof) await loadProfile();
    const left = passLeft(), trial = left && !(S.pass > Date.now()), can = prof && prof.bal >= L.PASS_COST;
    modal('<div class="maphead"><div><h2>Lanternholder</h2><small>Premium convenience. Never power.</small></div><button class="iconbtn" id="lp-x" aria-label="Close">&times;</button></div>' +
      '<ul class="passfx"><li><b>Auto-train</b><span>The Auto button under each Train button: characters train themselves whenever you have the gold.</span></li>' +
      '<li><b>+' + L.PASS_BAG + ' bag slots</b><span>More room for loot between trips to the forge.</span></li>' +
      '<li><b>+' + L.PASS_OFFLINE / 3600 + ' hours away</b><span>Your party keeps earning offline for longer.</span></li></ul>' +
      (subOn() ? '<p class="passstate">You are a Lanternholder <b>member</b>: the perks are on while your membership is active (renews ' + subDate() + ').</p>' :
        '<p class="passstate">' + (left ? (trial ? 'Your free trial has <b>' + left + '</b> left.' : 'Lanternholder is on for <b>' + left + '</b>. Buying again adds 30 days.') : 'Lanternholder is not active right now.') + '</p>') +
      (!signedIn() ? '<p class="note">Sign in to the game to get Lanternholder with ' + TOKEN + '.</p>' : '') +
      (subOn() ? '' : '<p class="note">Two ways to get it: <b>' + L.PASS_COST + ' ' + TOKEN + ' for 30 days</b> (nothing renews), or the <b>' + SUB_PRICE + ' monthly membership</b> in the ' + TOKEN + ' shop (renews until you cancel).</p>') +
      '<div class="row"><button class="btn ghost" id="lp-no">' + (back ? 'Back' : 'Not now') + '</button>' + (signedIn() ? (subOn() ? '' : can ? '<button class="btn" id="lp-buy">' + sigil + ' ' + L.PASS_COST + ' ' + TOKEN + ' for 30 days</button>' : '<button class="btn" id="lp-get">Get ' + TOKEN + '</button>') : '') + '</div>', md => {
        md.querySelector('#lp-x').onclick = closeModal; md.querySelector('#lp-no').onclick = () => back ? back() : closeModal();
        const g = md.querySelector('#lp-get'); if (g) g.onclick = () => getSigils(openPass);
        const y = md.querySelector('#lp-buy'); if (y) y.onclick = async () => {
          y.disabled = true;
          try { const r = await papi('POST', '/store/pass'); S.pass = r.pass; prof.bal = r.bal; prof.pass = r.pass; save(); sfx.buy(); updatePanel(true); updateSeats(true); toast('star', 'Lanternholder active', 'Auto-train, extra bag slots and longer offline time for ' + passLeft() + '.', 'feat'); back ? back() : closeModal(); }
          catch (e) { y.disabled = false; toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : 'Try again in a moment.', 'warn'); }
        };
      });
  }
  // ---------- Bag of Holding: endless pack space, bought once for 6,500 Sigils ----------
  async function openBoh(back) {
    back = typeof back === 'function' ? back : null;
    if (CL && signedIn() && !prof) await loadProfile();
    const can = prof && prof.bal >= L.BOH_COST;
    modal('<div class="maphead"><div><h2>Bag of Holding</h2><small>Bought once, yours for good. Never power.</small></div><button class="iconbtn" id="bh-x" aria-label="Close">&times;</button></div>' +
      '<div class="bohart">' + icon('bag') + '</div>' +
      '<p>A satchel stitched from Rift-silk by the Hold’s quartermasters. Whatever goes in finds room, and nothing is ever sold off because your pack was full.</p>' +
      '<ul class="passfx"><li><b>Endless pack</b><span>No item limit. Keep every set piece and job item you find.</span></li>' +
      '<li><b>No more auto-selling</b><span>Loot is never sold off for lack of space, and market returns and mail always fit.</span></li></ul>' +
      (S.boh ? '<p class="passstate">You own the Bag of Holding.</p>' : '<p class="passstate">Costs <b>' + fmt(L.BOH_COST) + ' ' + TOKEN + '</b>, once. ' + (prof ? 'You have ' + fmt(prof.bal) + '.' : '') + '</p>') +
      (!signedIn() ? '<p class="note">Sign in to the game to buy it with ' + TOKEN + '.</p>' : '') +
      '<div class="row"><button class="btn ghost" id="bh-no">' + (back ? 'Back' : S.boh ? 'Close' : 'Not now') + '</button>' + (signedIn() && !S.boh ? (can ? '<button class="btn" id="bh-buy">' + sigil + ' Buy for ' + fmt(L.BOH_COST) + ' ' + TOKEN + '</button>' : '<button class="btn" id="bh-get">Get ' + TOKEN + '</button>') : '') + '</div>', md => {
        md.querySelector('#bh-x').onclick = closeModal; md.querySelector('#bh-no').onclick = () => back ? back() : closeModal();
        const g = md.querySelector('#bh-get'); if (g) g.onclick = () => getSigils(openBoh);
        const y = md.querySelector('#bh-buy'); if (y) y.onclick = async () => {
          y.disabled = true;
          try { const r = await papi('POST', '/store/pass', { what: 'boh' }); S.boh = true; prof.bal = r.bal; prof.boh = true; save(); try { pushCloud(true); } catch (e) {} sfx.relic(); updateGear(true); toast('bag', 'Bag of Holding', 'Your pack has endless room now.', 'feat'); closeModal(); }
          catch (e) { y.disabled = false; toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : e.code === 'state' ? 'You already own one.' : 'Try again in a moment.', 'warn'); }
        };
      });
  }
  // ---------- Sigils earned in play: rare finds and daily quests ----------
  let claiming = false;
  async function claimFound() {
    if (claiming || !(S.sigPend > 0) || !CL || !signedIn()) return;
    claiming = true;
    try {
      const n = S.sigPend, r = await papi('POST', '/sigils/earn', { kind: 'drop', n });
      S.sigPend = Math.max(0, (S.sigPend || 0) - n) + (n - r.add); if (prof) prof.bal = r.bal; save();
      if (r.add < n) toast('star', 'Daily find limit reached', 'You can bank up to ' + L.SIGIL_DROP_DAY + ' found Sigils a day. The rest are saved for tomorrow.', '');
    } catch (e) {}
    claiming = false;
  }
  const bountyReady = () => { try { return L.bountyState(S, Date.now()).list.filter(b => b.have >= b.n && !b.got).length; } catch (e) { return 0; } };
  const questsReady = () => { const q = L.questState(S); const got = S.daily.got; return q.filter(x => x.done && !x.got).length + (q.every(x => x.got) && !(got & 8) ? 1 : 0) + bountyReady(); };
  function paintQuests() {
    const q = L.questState(S), b = $('quests'); if (!b) return;
    const n = q.filter(x => x.got).length, rd = questsReady(), all = n === 3 && (S.daily.got & 8);
    $('questct').innerHTML = rd ? 'Claim ' + rd : '<small class="ql">Quests </small>' + (all ? 'done' : n + '/3');
    b.classList.toggle('ready', rd > 0); b.classList.toggle('done', !rd && !!all);
    b.title = rd ? 'Daily quests: ' + rd + (rd === 1 ? ' reward' : ' rewards') + ' ready to claim' : all ? 'Daily quests: all done for today' : 'Daily quests: ' + n + ' of 3 done';
  }
  function bountyHtml() {
    const st = L.bountyState(S, Date.now()), left = (st.w + 1) * L.BOUNTY_MS - Date.now();
    if (st.paid && st.paid.length) { const g = st.paid.reduce((a, x) => a + x.gold, 0), d = st.paid.reduce((a, x) => a + x.dust, 0); toast('star', 'Bounties paid out', 'Finished bounties from the last board: +' + fmt(g) + ' gold, +' + fmt(d) + ' Dust.', 'loot'); delete st.paid; save(); }
    const rows = st.list.map((b, i) => {
      const rw = L.bountyReward(S, b), done = b.have >= b.n, go = b.a && !b.got && !done ? Math.min(S.maxFloor, b.a === b.b ? b.a : Math.max(b.a, Math.min(b.b, S.floor >= b.a && S.floor <= b.b ? S.floor : b.a))) : 0;
      return '<li class="quest bounty' + (b.got ? ' got' : done ? ' done' : '') + '"><div><b>' + esc(L.bountyText(b)) + '</b><div class="qbar"><i style="width:' + Math.round(b.have / b.n * 100) + '%"></i></div><small>' + b.have + ' / ' + b.n + ' · ' + fmt(rw.gold) + ' gold + ' + rw.dust + ' Dust</small></div>' +
        (b.got ? '<span class="qok">Paid</span>' : done ? '<button class="btn small" data-bty="' + i + '">Claim</button>' : go ? '<button class="btn small ghost" data-farm="' + go + '">' + (S.floor === go ? 'Farming here' : 'Go to floor ' + go) + '</button>' : '') + '</li>';
    }).join('');
    if (st.locked) return '<h3 class="sub">Bounty board</h3><p class="note small">The bounty board opens when you reach floor ' + L.BOUNTY_FLOOR + '.</p>';
    return '<h3 class="sub">Bounty board</h3><p class="note small">New bounties in ' + Math.floor(left / 36e5) + 'h ' + Math.floor(left % 36e5 / 6e4) + 'm. Built from the floors you have reached. Finished ones you forget to claim are paid when the board changes. Rewards: gold, Dust and sometimes a tonic.</p><ul class="quests">' + rows + '</ul>';
  }
  function openQuests() {
    const q = L.questState(S), got = S.daily.got, allGot = q.every(x => x.got), msLeft = Date.parse(L.questDay() + 'T00:00:00Z') + 864e5 - Date.now();
    const pct = v => (Math.round(v * 10000) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
    const row = x => '<li class="quest' + (x.got ? ' got' : x.done ? ' done' : '') + '"><div><b>' + esc(x.text) + '</b><div class="qbar"><i style="width:' + Math.round(x.have / x.n * 100) + '%"></i></div><small>' + x.have.toLocaleString('en-US') + ' / ' + x.n.toLocaleString('en-US') + '</small></div>' +
      (x.got ? '<span class="qok">' + sigil + '+' + L.QUEST_REWARD + '</span>' : '<button class="btn small" data-q="' + x.i + '"' + (x.done ? '' : ' disabled') + '>' + sigil + ' Claim ' + L.QUEST_REWARD + '</button>') + '</li>';
    modal('<div class="maphead"><div><h2>Quests and bounties</h2><small>New quests in ' + Math.max(1, Math.floor(msLeft / 36e5)) + 'h ' + Math.floor(msLeft % 36e5 / 6e4) + 'm. Same quests for every hero.</small></div><button class="iconbtn" id="dq-x" aria-label="Close">&times;</button></div>' +
      bountyHtml() + '<h3 class="sub">Daily quests</h3>' +
      '<ul class="quests">' + q.map(row).join('') +
      '<li class="quest bonus' + (got & 8 ? ' got' : allGot ? ' done' : '') + '"><div><b>Finish all three</b><small>A bonus for clearing the day.</small></div>' + (got & 8 ? '<span class="qok">' + sigil + '+' + L.QUEST_BONUS + '</span>' : '<button class="btn small" data-q="3"' + (allGot ? '' : ' disabled') + '>' + sigil + ' Claim ' + L.QUEST_BONUS + '</button>') + '</li></ul>' +
      (signedIn() ? '' : '<p class="note">Sign in to claim quest rewards. Your progress still counts.</p>') +
      '<h3 class="sub">Finding Sigils</h3><p class="note">Now and then a treasure chest or a guardian holds 1 to 3 Sigils. Your odds: <b>' + pct(L.sigilChance(S, 'chest')) + '</b> per chest and <b>' + pct(L.sigilChance(S, 'boss')) + '</b> per guardian. Every 30 floors of your deepest descent adds 0.01%, up to 0.05%, and the Kindling upgrade Sigil Sense adds 0.01% per rank. You can bank up to ' + L.SIGIL_DROP_DAY + ' found Sigils a day.</p>' +
      '<div class="row"><button class="btn ghost" id="dq-ok">Close</button></div>', md => {
        md.querySelector('#dq-x').onclick = closeModal; md.querySelector('#dq-ok').onclick = closeModal;
        md.querySelectorAll('[data-bty]').forEach(btn => btn.onclick = () => {
          const r = L.claimBountyAt(S, +btn.dataset.bty, Date.now()); if (!r) return;
          sfx.relic(); save(); paintQuests();
          toast('star', 'Bounty paid', '+' + fmt(r.gold) + ' gold and +' + fmt(r.dust) + ' Dust' + (r.tonic ? ', plus a ' + r.tonic : '') + '.', 'loot');
          openQuests();
        });
        md.querySelectorAll('[data-farm]').forEach(btn => btn.addEventListener('click', () => setTimeout(closeModal, 50)));
        md.querySelectorAll('[data-q]').forEach(btn => btn.onclick = async () => {
          if (!signedIn()) { toast('user', 'Sign in first', 'Quest rewards go to your account wallet.', 'warn'); return; }
          const i = +btn.dataset.q; btn.disabled = true;
          try { const r = await papi('POST', '/sigils/earn', { kind: 'quest', i }); S.daily.got = r.mask; if (prof) prof.bal = r.bal; save(); sfx.buy(); toast('star', '+' + r.add + (r.add === 1 ? ' Sigil' : ' Sigils'), i === 3 ? 'All three quests done. See you tomorrow!' : 'Quest complete.', 'feat'); }
          catch (e) { if (e.code === 'claimed') { S.daily.got |= 1 << i; save(); } else toast('lock', 'Could not claim', 'Try again in a moment.', 'warn'); }
          paintQuests(); openQuests();
        });
      });
  }
  $('quests').addEventListener('click', openQuests);
  setInterval(() => { paintQuests(); claimFound(); }, 5000); setTimeout(paintQuests, 500);
  // ---------- Banner kin: party members under your banner amplify its perk ----------
  function paintKin() {
    const el = $('kinline'); if (!el || !S.hero) return;
    const d = L.SIDES[S.hero.side], n = L.bannerKin(S);
    if (!d || S.hero.side === 'unsworn' && !n) { el.hidden = true; return; }
    el.hidden = false; el.style.setProperty('--side', d.color);
    el.innerHTML = n ? '<b>Banner kin ×' + n + '</b><span>' + esc(d.perk) + ' is <b>' + Math.round(L.KIN_AMP * n * 100) + '% stronger</b></span>' + tipI(n + (n === 1 ? ' ally marches' : ' allies march') + ' under ' + d.name + '. Each one makes your banner perk 40% stronger.')
      : '<b>Banner kin</b><span>Recruit allies of ' + esc(d.name) + '</span>' + tipI('Companions or players who fly the banner of ' + d.name + ' each make your banner perk (' + d.perk + ') 40% stronger.');
  }
  setInterval(paintKin, 2000); setTimeout(paintKin, 600);
  // ---------- Victor's Banner: the alliance that won the last crowned Grand War season (John, 24 Nov 2026) ----------
  const WAR_SITE = 'https://war.born2gamellc.com';
  function paintWin() {
    const el = $('winline'); if (!el) return;
    const w = S.warWin, d = w && L.SIDES[w.side];
    if (!d || !S.hero) { el.hidden = true; return; }
    el.hidden = false; el.style.setProperty('--side', d.color);
    const fx = Math.round(L.WARWIN_FX.dps * 100);
    el.innerHTML = icon('crown').replace('<svg', '<svg class="vi"') + (L.warWinOn(S)
      ? '<b>Victor’s Banner</b><span>+' + fx + '% damage, health, healing and gold. Fallen allies rise in <b>' + L.WARWIN_REVIVE + 's</b></span>' + tipI(d.name + ' won Grand War Season ' + w.season + ' and holds the Nexus. Every hero under its banner gets this until the next season is crowned.')
      : '<b>' + esc(d.name) + ' holds the Nexus</b><span>Victor’s Banner for its heroes</span>' + tipI(d.name + ' won Grand War Season ' + w.season + '. Heroes under its banner get +' + fx + '% damage, health, healing and gold, and fallen allies rise in ' + L.WARWIN_REVIVE + ' seconds, until the next season is crowned. Your play here counts for your banner in the Grand War too.'));
  }
  async function loadWarWin() {
    try {
      const r = await fetch(WAR_SITE + '/api/nexus.json'); if (!r.ok) return;
      const m = await r.json(), side = m && L.WAR_KEY[m.nexus];
      const next = side ? { side, season: m.season } : null, was = S.warWin;
      S.warWin = next;
      if (next && (!was || was.season !== next.season) && L.warWinOn(S)) toast('crown', 'Victor’s Banner', L.SIDES[side].name + ' won Grand War Season ' + next.season + '. Your heroes get +' + Math.round(L.WARWIN_FX.dps * 100) + '% damage, health, healing and gold until the next season.', 'feat');
      paintWin(); updatePanel(true);
    } catch (e) {}
  }
  setTimeout(loadWarWin, 3000); setInterval(loadWarWin, 9e5); setInterval(paintWin, 5000);
  // ---------- Character sheet: hero level, XP and stats ----------
  const STAT_LBL = { pdps: 'party damage', crit: 'crit chance', dodge: 'dodge', php: 'party health', power: 'ability power', pheal: 'party healing', cd: 'faster abilities', gold: 'gold', loot: 'loot', chest: 'chest chance', sig: 'Sigil odds', spoils: 'ambush spoils' };
  const pctTxt = v => { const p = v * 100; return '+' + (p >= 1 ? Math.round(p * 10) / 10 : p >= 0.01 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000) + '%'; };
  const statMod = sc => { const m = Math.floor((sc - 10) / 2); return (m >= 0 ? '+' : '') + m; };
  // XP bar breakdown: every bonus to hero XP and the total rate (John, 2026-11-24).
  const xpRate = () => { const b = L.xpBonus(S); return (Math.round(b.total * 100) / 100).toFixed(2); };
  function xpTip() {
    const b = L.xpBonus(S), pc = v => '+' + (Math.round(v * 1000) / 10) + '%';
    const lines = ['XP bonuses'].concat(b.parts.length ? b.parts.map(x => x[0] + ': ' + pc(x[1])) : ['None yet. Region mastery stars, Scholar’s Ink and some skills, traits and enchants raise it.']);
    if (b.mult > 1) lines.push('Lantern Keeper online: ×' + b.mult);
    lines.push('Total: ×' + xpRate() + ' hero XP' + (b.parts.length > 1 || b.mult > 1 ? ' (' + pc(b.add) + (b.mult > 1 ? ', then ×' + b.mult : '') + ')' : ''));
    return lines.join('\n');
  }
  function paintSheet() {
    const box = $('charsheet'); if (!box) return;
    const cls = L.heroCls(S);
    if (!cls) { box.innerHTML = ''; return; }
    const h = L.heroLevel(S), pts = L.heroPoints(S), pri = L.STAT_CLASS[cls] || [], c = L.CLASSES[cls];
    const row = st => {
      const n = (S.attr || {})[st.id] || 0, sc = L.statScore(S, st.id), fav = pri.includes(st.id), mult = fav ? L.STAT_AFFINITY : 1;
      const fx = Object.keys(st.fx).map(k => pctTxt(st.fx[k] * Math.max(n, 0) * mult) + ' ' + STAT_LBL[k]).join(', ');
      return '<div class="cstat' + (fav ? ' fav' : '') + '"><div class="cscore"><b>' + sc + '</b><small>' + statMod(sc) + '</small></div>' +
        '<div class="ctx" data-tip="' + esc(st.name + ': raises ' + st.desc + '.' + (fav ? ' Favoured by your class, so it counts half again.' : '')) + '"><b>' + st.name + (fav ? ' <span class="cfav">Favoured</span>' : '') + '</b><small>' + (n ? fx : 'Raises ' + st.desc) + '</small></div>' +
        '<div class="cbtns"><button class="btn small" data-stat="' + st.id + '"' + (pts > 0 && sc < L.STAT_MAX ? '' : ' disabled') + ' aria-label="Add a point to ' + st.name + '">+1</button>' +
        (pts >= 5 ? '<button class="btn small ghost" data-stat5="' + st.id + '"' + (sc + 5 <= L.STAT_MAX ? '' : ' disabled') + '>+5</button>' : '') + '</div></div>';
    };
    box.innerHTML = '<div class="chead"><div><h3>' + esc(L.memberById('you').name) + ', hero level ' + h.lv + ' ' + c.name + '</h3><small>Earns XP from every fight ' + tipI('Your hero earns XP even when they sit out. Bigger foes give more. Each level gives a stat point.') + '</small></div>' +
      '<div class="kbal cpts' + (pts ? ' on' : '') + '">' + icon('star') + '<b>' + pts + '</b><small>' + (pts === 1 ? 'Point' : 'Points') + '</small></div></div>' +
      '<div class="cxp" data-tip="' + esc(xpTip()) + '"><i style="width:' + Math.min(100, h.xp / h.need * 100).toFixed(1) + '%"></i><span>' + fmt(Math.floor(h.xp)) + ' / ' + fmt(h.need) + ' XP to level ' + (h.lv + 1) + '<em class="cxr">XP &times;' + xpRate() + '</em></span></div>' +
      '<div class="cgrid">' + L.STATS.map(row).join('') + '</div>' +
      '<div class="kfoot"><span>About stats ' + tipI('Favoured stats count half again. Stats work while your hero is in the party. A reset costs ' + L.RESPEC_COST + ' ' + TOKEN + '.') + '</span>' + ((S.attr && Object.keys(S.attr).length) ? '<button class="btn ghost small" id="c-reset">Reset stats</button>' : '') + '</div>';
  }
  $('charsheet') && $('charsheet').addEventListener('click', e => {
    const b = e.target.closest('[data-stat],[data-stat5]');
    if (b) { if (L.addStat(S, b.dataset.stat || b.dataset.stat5, b.dataset.stat5 ? 5 : 1)) { sfx.buy(); save(); updateSkills(); } return; }
    if (e.target.closest('#c-reset')) {
      const cost = L.RESPEC_COST, on = signedIn(), bal = prof && prof.bal != null ? prof.bal : null;
      modal('<div class="center"><h2>Reset your stats?</h2><p>All ' + L.statSpent(S) + ' points come back so you can place them again. A reset costs ' + sigil + ' <b>' + cost + ' ' + TOKEN + '</b>.' + (bal != null ? ' You have ' + bal + '.' : '') + '</p>' +
        (on ? '' : '<p class="note">Sign in to the game to pay with ' + TOKEN + '.</p>') +
        '<div class="row"><button class="btn ghost" id="r-no">Keep them</button>' + (on ? (bal == null || bal >= cost ? '<button class="btn" id="r-yes">' + sigil + ' Reset for ' + cost + '</button>' : '<button class="btn" id="r-get">Get ' + TOKEN + '</button>') : '') + '</div></div>', md => {
        md.querySelector('#r-no').onclick = closeModal;
        const g = md.querySelector('#r-get'); if (g) g.onclick = () => getSigils();
        const y = md.querySelector('#r-yes'); if (y) y.onclick = async () => {
          y.disabled = true;
          try { const r = await papi('POST', '/store/pass', { what: 'respec' }); if (prof) prof.bal = r.bal; L.resetStats(S); save(); sfx.buy(); closeModal(); updateSkills(); toast('star', 'Stats reset', 'Your points are back. Place them however you like.', 'feat'); }
          catch (e) { y.disabled = false; toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : 'Try again in a moment.', 'warn'); }
        };
      });
    }
  });
  // ---------- server resets and the admin tab ----------
  // A server wipe bumps a public "epoch". Saves started before it reset to a new game.
  const EPOCH_KEY = 'lanternhold.epoch';
  async function checkEpoch() {
    if (!CL) return;
    try {
      const r = await fetch(CL.api.replace(/\/$/, '') + '/epoch'); if (!r.ok) return;
      const ep = Number((await r.json()).epoch) || 0;
      let seen = 0; try { seen = Number(localStorage.getItem(EPOCH_KEY)) || 0; } catch (e) {}
      if (!ep || ep <= seen || (S.created || 0) >= ep) return;
      try { localStorage.removeItem(SAVE_KEY); localStorage.setItem(EPOCH_KEY, String(ep)); localStorage.setItem('lanternhold.wiped', '1'); } catch (e) {}
      S = L.newState(); location.reload();
    } catch (e) {}
  }
  function wipedNotice() {
    let w = null; try { w = localStorage.getItem('lanternhold.wiped'); localStorage.removeItem('lanternhold.wiped'); } catch (e) {}
    if (w) setTimeout(() => toast('flame', 'A fresh start', w === 'me' ? 'An admin reset your account. Your delve starts again from the top of the stair.' : 'The Deep has been reset for everyone. Every delver starts again from the top of the stair.', 'feat'), 1500);
  }
  function isAdmin() { return !!(sess && sess.id && String(claims(sess.id)['cognito:groups'] || '').includes('admins')); }
  async function adminApi(method, path, body) {
    const tok = await idToken(); if (!tok) throw new Error('Sign in first.');
    const r = await fetch(CL.api.replace(/\/$/, '') + path, { method, headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 403 ? 'This account is not an admin.' : j.error === 'self' ? 'You cannot ban yourself.' : j.error === 'player' ? 'That player has not played since bans were added, so their account cannot be found yet.' : j.error === 'name' ? 'The name you typed does not match the hero.' : 'The server said no (' + r.status + ').');
    return j;
  }
  let adminList = null, adminQ = '', adminBusy = false, adminLinks = [], adminLog = [];
  function paintAdminTab() { const t = $('tabadmin'); if (t) t.hidden = !isAdmin(); }
  async function loadAdmin() {
    $('adminbox').innerHTML = '<p class="note">Loading players…</p>';
    try { adminList = await adminApi('GET', '/admin/players'); } catch (e) { $('adminbox').innerHTML = '<p class="note">' + esc(e.message) + '</p>'; return; }
    try { adminLinks = (await adminApi('GET', '/admin/links')).links || []; await loadWar(); } catch (e) { adminLinks = []; }
    try { adminLog = (await adminApi('GET', '/admin/audit')).log || []; } catch (e) { adminLog = []; }
    paintAdmin();
  }
  function paintAdmin() {
    if (!adminList) return;
    const ago = t => { if (!t) return 'never'; const m = Math.floor((Date.now() - t) / 6e4); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' d ago'; };
    const q = adminQ.toLowerCase(), list = adminList.players.filter(p => !q || p.name.toLowerCase().includes(q));
    const on = adminList.players.filter(p => p.on).length, banned = adminList.players.filter(p => p.banned).length;
    $('adminbox').innerHTML =
      '<div class="adm-stats"><div><small>Players</small><b>' + adminList.players.length + '</b></div><div><small>Online now</small><b>' + on + '</b></div><div><small>Banned</small><b>' + banned + '</b></div><div><small>Last wipe</small><b>' + (adminList.epoch ? new Date(adminList.epoch).toLocaleDateString() : 'never') + '</b></div></div>' +
      '<div class="adm-bar"><input id="adm-q" type="search" placeholder="Find a player by name" value="' + esc(adminQ) + '"><button class="btn small ghost" id="adm-re">Refresh</button></div>' +
      '<div class="adm-list">' + (list.length ? list.map(p => '<div class="adm-row' + (p.banned ? ' banned' : '') + '"><span class="adm-n"><b>' + esc(p.name || 'Unnamed') + '</b>' + (p.cls ? ' ' + classTag(p.cls) : '') + '<small>' + (p.banned ? 'Banned' : (p.on ? '<span class="online">Online now</span> &middot; ' : 'Seen ' + ago(p.seen) + ' &middot; ') + 'power level ' + p.level + ', floor ' + p.floor) + '</small></span>' +
        (p.canBan ? '<button class="btn small ghost" data-grant="' + p.id + '">Sigils</button><button class="btn small ghost" data-reset="' + p.id + '">Reset</button>' : '') + (p.banned ? '<button class="btn small ghost" data-unban="' + p.id + '">Unban</button>' : '<button class="btn small danger" data-ban="' + p.id + '"' + (p.canBan ? '' : ' disabled title="They need to play once more before they can be banned"') + '>Ban</button>') + '</div>').join('') : '<p class="note">No players match.</p>') + '</div>' +
      '<h3 class="sub">Grand War links</h3>' + (adminLinks.length ? '<p class="note">Players asking to show their Grand War commander badges. Approve only when you know the player is that commander, for example from Discord.</p><div class="adm-list">' + adminLinks.sort((a, c) => a.wv - c.wv).map(l => '<div class="adm-row"><span class="adm-n"><b>' + esc(l.name || 'Unnamed') + '</b> wants to be <b>' + esc(l.wl) + '</b><small>' + (commander(l.wl) ? warBadge(l.wl) : 'Not on the war ladder right now') + (l.wv ? ' &middot; <span class="online">Verified</span>' : ' &middot; Waiting') + '</small></span>' + (l.wv ? '' : '<button class="btn small" data-lok="' + l.id + '">Approve</button>') + '<button class="btn small ghost" data-lno="' + l.id + '">' + (l.wv ? 'Remove' : 'Reject') + '</button></div>').join('') + '</div>' : '<p class="note">No players have asked to link a Grand War commander yet.</p>') +
      '<h3 class="sub">Admin log</h3>' + (adminLog.length ? '<div class="adm-list">' + adminLog.map(l => '<div class="adm-row"><span class="adm-n"><b>' + (l.act === 'wipe' ? 'Server wiped' : 'Reset ' + esc(l.name || 'a player') + (l.self ? ' (their own account)' : '')) + '</b><small>' + esc(l.by) + ' &middot; ' + new Date(l.at).toLocaleString() + (l.act === 'reset' ? ' &middot; ' + (l.sigils ? 'Sigils and purchases wiped too' : 'Sigils and purchases kept') : '') + '</small></span></div>').join('') + '</div>' : '<p class="note">No player resets or server wipes yet.</p>') +
      '<div class="adm-danger"><h3 class="sub">Wipe the server</h3><p class="note">Deletes every cloud save, every hero on the guild board and every market listing and letter. Everyone, signed in or not, starts over from a new game the next time they open Lanternhold. Bans, Sigils, bought looks, Sigil market listings, store links and Grand War links stay in place. This cannot be undone.</p><button class="btn danger" id="adm-wipe">Wipe the server…</button></div>';
  }
  $('tab-admin').addEventListener('input', e => { if (e.target.id === 'adm-q') { adminQ = e.target.value; const pos = e.target.selectionStart; paintAdmin(); const q = $('adm-q'); q.focus(); q.setSelectionRange(pos, pos); } });
  $('tab-admin').addEventListener('click', async e => {
    if (adminBusy) return;
    if (e.target.closest('#adm-re')) { loadAdmin(); return; }
    const lok = e.target.closest('[data-lok]'), lno = e.target.closest('[data-lno]');
    if (lok || lno) {
      adminBusy = true;
      try { await adminApi('POST', '/admin/verify', { id: (lok || lno).dataset[lok ? 'lok' : 'lno'], ok: !!lok }); toast('star', lok ? 'Link approved' : 'Link removed', lok ? 'Their Grand War badges now show on their card.' : 'Their card no longer shows Grand War badges.', 'feat'); }
      catch (x) { toast('lock', 'That did not work', x.message, 'warn'); }
      adminBusy = false; loadAdmin(); return;
    }
    const gr = e.target.closest('[data-grant]');
    if (gr) {
      const p = adminList.players.find(x => x.id === gr.dataset.grant); if (!p) return;
      modal('<div class="center"><h2>Give ' + esc(p.name) + ' Sigils</h2><p>Sigils buy looks only. Use a minus number to take some back.</p><input id="a-n" class="adm-conf" type="number" value="100" step="10"><div class="row"><button class="btn ghost" id="a-no">Cancel</button><button class="btn" id="a-yes">Give Sigils</button></div></div>', md => {
        md.querySelector('#a-no').onclick = closeModal;
        md.querySelector('#a-yes').onclick = async () => {
          const n = Math.trunc(Number(md.querySelector('#a-n').value) || 0); if (!n) return;
          adminBusy = true;
          try { const r = await adminApi('POST', '/admin/grant', { id: p.id, n }); closeModal(); toast('star', 'Sigils sent', p.name + ' now has ' + r.bal + ' Sigils.', 'feat'); }
          catch (x) { closeModal(); toast('lock', 'That did not work', x.message, 'warn'); }
          adminBusy = false;
        };
      });
      return;
    }
    const rs = e.target.closest('[data-reset]');
    if (rs) {
      const p = adminList.players.find(x => x.id === rs.dataset.reset); if (!p) return;
      const mine = S.hero && p.name && S.hero.name.toLowerCase() === p.name.toLowerCase();
      modal('<div class="center"><h2>Reset ' + esc(p.name) + '?</h2><p>' + (mine ? 'This looks like your own hero. ' : '') + 'They start again from a brand-new game on every device: hero, party, gear, gold, floors, Kindling, market listings, letters, Ember Ring standing and world boss scores are deleted for good. Their account, any ban and their Grand War link stay.</p>' +
        '<label class="adm-chk"><input type="checkbox" id="a-sig"> Also wipe their Sigils, bought looks and passes. Leave this off for real players: it deletes what they paid for. Paid packs are not credited again.</label>' +
        '<p>Type the hero name <b>' + esc(p.name) + '</b> to confirm.</p><input id="a-conf" class="adm-conf wide" autocomplete="off" spellcheck="false"><div class="row"><button class="btn ghost" id="a-no">Cancel</button><button class="btn danger" id="a-yes" disabled>Reset player</button></div></div>', md => {
        const inp = md.querySelector('#a-conf'), yes = md.querySelector('#a-yes'), sig = md.querySelector('#a-sig');
        inp.oninput = () => { yes.disabled = inp.value.trim().toLowerCase() !== p.name.toLowerCase(); };
        sig.onchange = () => { yes.textContent = sig.checked ? 'Reset player and Sigils' : 'Reset player'; };
        md.querySelector('#a-no').onclick = closeModal;
        yes.onclick = async () => {
          adminBusy = true; yes.disabled = true; yes.textContent = 'Resetting…';
          try {
            const r = await adminApi('POST', '/admin/reset', { id: p.id, name: inp.value.trim(), sigils: sig.checked });
            closeModal(); toast('flame', p.name + ' is reset', (r.self ? 'Your own game starts over now.' : 'Their game starts over the next time it syncs, within a minute if they are playing.') + (r.sigils ? ' Their Sigils were wiped too.' : ' Their Sigils were kept.'), 'feat');
            if (r.self) setTimeout(playerReset, 2500);
          } catch (x) { closeModal(); toast('lock', 'The reset did not run', x.message, 'warn'); }
          adminBusy = false; loadAdmin();
        };
      });
      return;
    }
    const bn = e.target.closest('[data-ban]'), ub = e.target.closest('[data-unban]');
    if (bn || ub) {
      const p = adminList.players.find(x => x.id === (bn || ub).dataset[bn ? 'ban' : 'unban']); if (!p) return;
      modal('<div class="center"><h2>' + (bn ? 'Ban ' : 'Unban ') + esc(p.name) + '?</h2><p>' + (bn ? 'Their account is switched off and signed out everywhere within the hour. Their hero leaves the guild board and their market listings come down. You can unban them later.' : 'Their account works again and they can sign back in.') + '</p><div class="row"><button class="btn ghost" id="a-no">Cancel</button><button class="btn' + (bn ? ' danger' : '') + '" id="a-yes">' + (bn ? 'Ban player' : 'Unban player') + '</button></div></div>', md => {
        md.querySelector('#a-no').onclick = closeModal;
        md.querySelector('#a-yes').onclick = async () => {
          adminBusy = true; md.querySelector('#a-yes').disabled = true;
          try { const r = await adminApi('POST', bn ? '/admin/ban' : '/admin/unban', { id: p.id }); closeModal(); toast('lock', bn ? p.name + ' is banned' : p.name + ' is unbanned', bn ? (r.listings ? r.listings + ' market listings taken down.' : 'They had no market listings.') : 'They can sign in again.', 'feat'); }
          catch (x) { closeModal(); toast('lock', 'That did not work', x.message, 'warn'); }
          adminBusy = false; loadAdmin();
        };
      });
      return;
    }
    if (e.target.closest('#adm-wipe')) {
      modal('<div class="center"><h2>Wipe the server?</h2><p>Every player loses their progress and starts again from a new game. Cloud saves, guild heroes, market listings and letters are deleted for good.</p><p>Type <b>WIPE</b> to confirm.</p><input id="a-conf" class="adm-conf" autocomplete="off" spellcheck="false"><div class="row"><button class="btn ghost" id="a-no">Cancel</button><button class="btn danger" id="a-yes" disabled>Wipe everything</button></div></div>', md => {
        const inp = md.querySelector('#a-conf'), yes = md.querySelector('#a-yes');
        inp.oninput = () => { yes.disabled = inp.value.trim() !== 'WIPE'; };
        md.querySelector('#a-no').onclick = closeModal;
        yes.onclick = async () => {
          adminBusy = true; yes.disabled = true; yes.textContent = 'Wiping…';
          try {
            const r = await adminApi('POST', '/admin/wipe', { confirm: 'WIPE' });
            closeModal(); toast('flame', 'Server wiped', r.saves + ' saves, ' + r.heroes + ' heroes and ' + r.trade + ' market records deleted. Your own game resets now.', 'feat');
            setTimeout(() => { try { localStorage.removeItem(SAVE_KEY); localStorage.setItem('lanternhold.wiped', '1'); } catch (x) {} S = L.newState(); location.reload(); }, 2500);
          } catch (x) { closeModal(); toast('lock', 'The wipe did not run', x.message, 'warn'); }
          adminBusy = false;
        };
      });
    }
  });
  document.querySelector('.tabs [data-tab="admin"]').addEventListener('click', () => { paintSpawner(); loadAdmin(); });
  // Event spawner (John, 2026-11-24): force a random event into your own fight to test it. Only your own save changes.
  let spawnSp = 'slam';
  function paintSpawner() {
    const box = $('admspawn'); if (!box) return;
    if (!isAdmin()) { box.innerHTML = ''; return; }
    box.innerHTML = '<h3 class="sub">Test random events</h3><p class="note">Spawns the event into your own fight right now, skipping the usual floor rules and odds. Only your game changes; other players never see it.</p>' +
      '<div class="adm-spawn">' + L.SPAWN_EVENTS.filter(x => x[0] !== 'special').map(x => '<button class="btn small ghost" data-spawn="' + x[0] + '" title="' + esc(x[2]) + '"><b>' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></button>').join('') + '</div>' +
      '<div class="adm-bar adm-sp"><select id="adm-sp">' + Object.keys(L.SPECIALS).map(k => '<option value="' + k + '"' + (k === spawnSp ? ' selected' : '') + '>' + esc(L.SPECIALS[k].name) + (L.SPECIALS[k].cc ? ' (' + L.SPECIALS[k].cc + ')' : L.SPECIALS[k].dot ? ' (' + L.SPECIALS[k].dot + ')' : '') + '</option>').join('') + '</select><button class="btn small" data-spawn="special">Spawn special attack</button></div>';
  }
  $('tab-admin').addEventListener('change', e => { if (e.target.id === 'adm-sp') spawnSp = e.target.value; });
  $('tab-admin').addEventListener('click', e => {
    const b = e.target.closest('[data-spawn]'); if (!b || !isAdmin() || !S || !S.hero) return;
    const k = b.dataset.spawn, ev = [], err = L.spawnEvent(S, k, Date.now(), Math.random, ev, spawnSp);
    if (err) { toast('lock', 'Not right now', err, ''); return; }
    for (const x of ev) if (x.type === 'ghost' || x.type === 'merchant') ambientQ.push(x); else events.push(x);
    handleEvents(); save();
    if (innerWidth < 760 && arena.scrollIntoView) arena.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const name = (L.SPAWN_EVENTS.find(x => x[0] === k) || [])[1];
    toast('star', name + ' spawned', k === 'special' ? L.SPECIALS[spawnSp].name + ' winds up in about 3 seconds.' : 'It is in your fight now.', 'feat');
  });

  // ---------- leaderboard ----------
  let lbAt = 0;
  async function loadBoard(force) {
    const box = $('boardtop'); if (!box) return;
    if (!CL) { box.innerHTML = '<p class="note">The leaderboard needs the online server.</p>'; return; }
    if (!force && Date.now() - lbAt < 60000) return; lbAt = Date.now();
    if (!box.innerHTML) box.innerHTML = '<p class="note">Loading the deepest delvers…</p>';
    try {
      const r = await fetch(CL.api.replace(/\/$/, '') + '/leaderboard'); if (!r.ok) throw 0;
      const top = (await r.json()).top || [], me = S.hero && S.hero.name;
      box.innerHTML = '<p class="note">The deepest delvers across the Reach. Sign in to put your hero on the board. Updates every minute.</p>' +
        (top.length ? '<ol class="lboard">' + top.map((p, i) => '<li class="' + (i < 3 ? 'top' + (i + 1) : '') + (p.name === me ? ' me' : '') + '"><span class="lbr">' + (i + 1) + '</span><span class="lbn"><b>' + esc(p.name) + '</b> ' + classTag(p.cls) + (L.SIDES[p.side] ? '<small>' + esc(L.SIDES[p.side].name) + '</small>' : '') + '</span><span class="lbf"><b>Floor ' + p.floor + '</b><small>power level ' + p.level + '</small></span></li>').join('') + '</ol>' : '<p class="note">Nobody is on the board yet. Be the first.</p>');
    } catch (e) { box.innerHTML = '<p class="note">The leaderboard could not load right now. Try again in a minute.</p>'; lbAt = 0; }
  }
  $('codexseg').addEventListener('click', e => { if (e.target.closest('[data-cx="board"]')) loadBoard(); });
  // ---------- the Grand War: season strip and war room ----------
  const WAR_URL = 'https://war.born2gamellc.com/';
  const WAR_ART = { covenant: WAR_URL + 'static/alliance-covenant.jpg', radiant: WAR_URL + 'static/alliance-ascendancy.jpg', tide: WAR_URL + 'static/alliance-tide.jpg' };
  const SEASON = { n: 1, name: 'The First Incursion', start: Date.UTC(2026, 10, 1, 5), week1: Date.UTC(2026, 10, 8, 5), surge: Date.UTC(2027, 0, 24, 5), weeks: 12 };
  function paintWarStrip() {
    const now = Date.now(), wk = Math.max(1, Math.min(SEASON.weeks, Math.floor((now - SEASON.week1) / 6048e5) + 1));
    const left = SEASON.surge - now, d = Math.floor(left / 864e5);
    $('ws-season').textContent = 'Season ' + SEASON.n + ' · ' + SEASON.name + ' · week ' + wk + ' of ' + SEASON.weeks;
    $('ws-surge').textContent = left > 0 ? 'Rift surge in ' + (d > 0 ? d + ' days' : Math.max(1, Math.floor(left / 36e5)) + ' hours') : 'The Rift has surged. Season 2 is coming.';
  }
  paintWarStrip(); setInterval(paintWarStrip, 60000);

  function warCard(k, mine) {
    const d = L.SIDES[k], art = WAR_ART[k];
    return '<article class="wcard w-' + k + (mine ? ' mine' : '') + '" style="--side:' + d.color + '">' +
      (art ? '<div class="wart" style="background-image:url(' + art + ')"></div>' : '<div class="wart plain"></div>') +
      '<div class="wbody"><h4>' + d.name + (mine ? ' <em>Your banner</em>' : '') + '</h4><i>“' + d.motto + '”</i><p>' + WAR_TEXT[k] + '</p><small>On this front: ' + d.perk + '</small></div></article>';
  }
  const WAR_TEXT = {
    covenant: 'Soldiers, builders and defenders who believe civilization survives only behind walls they are willing to die on. They would seal the Nyx Rift and send every reality home. The Hold above the Lantern Deep is a Covenant fortress, and Old Thessaly is the oldest warden they have.',
    radiant: 'Ancient powers, chosen bloodlines and the fallen who traded everything for power, united by one belief: they were meant to rule. They would master the Rift and rule every reality through it. Their choirs and war-engines dig toward the lantern from every side.',
    tide: 'Swarms, warbands and hungers without end. Every loss only makes them stronger. They would tear the Rift wider and feed on everything that falls through. Most of what crawls in the Lantern Deep once answered to them.',
    mercy: 'Medics who cross every line of the war and fly no alliance’s banner. They patch up whoever is bleeding, Covenant, Radiant or Tide. Moss wears their green.',
    unsworn: 'Delvers who swear to no one. The Rift does not care whose side you are on, and neither do they.',
  };
  function paintWarRoom() {
    const box = $('warroom'); if (!box) return;
    const mine = L.sideOf(S);
    const left = SEASON.surge - Date.now(), d = Math.max(0, Math.floor(left / 864e5));
    box.innerHTML =
      '<section class="wroom-hero"><small>Born 2 Game · The Shattered Reach</small><h3>The Grand War</h3><p>Three alliances fight across thirteen sectors for the Nexus. Lanternhold is the war’s hidden front: the Lantern Deep, a tear of the Nyx Rift sealed under a Covenant hold.</p>' +
      '<div class="wstats"><div><b>Season ' + SEASON.n + '</b><small>' + SEASON.name + '</small></div><div><b>' + (left > 0 ? d + ' days' : 'Now') + '</b><small>until the Rift surges</small></div><div><b>Act One</b><small>ends with the season</small></div></div>' +
      '<a class="btn small" href="' + WAR_URL + '" target="_blank" rel="noopener">Open the war room ↗</a></section>' +
      '<h3 class="sub">The alliances</h3><div class="wcards">' + ['covenant', 'radiant', 'tide'].map(k => warCard(k, k === mine)).join('') + '</div>' +
      (mine === 'mercy' || mine === 'unsworn' ? '<div class="wcards one">' + warCard(mine, true) + '</div>' : '') +
      '<h3 class="sub">How the war began</h3><div class="wlore">' +
      '<p><b>The Rift.</b> It began as a wound in a dead-star sector: the Nyx Rift, a tear in the sky bleeding light that should not exist. Then it kept tearing. It cut sideways through the walls between realities and dragged whole worlds into one broken space, the Shattered Reach. Thirteen sectors that were never meant to share a sky now share one.</p>' +
      '<p><b>The Nexus.</b> At the centre of the Reach, where every swallowed reality is knotted to every other, burns the Nexus. When the Rift surges at the end of each season, the alliance holding the most sectors seizes it and decides the Rift’s fate: sealed, ruled, or torn wider.</p>' +
      '<p><b>The Lantern Deep.</b> One thin tear of the Rift runs under the Hold, and a lantern that has never gone out sits on top of it like a cork. Every alliance believes the Deep is a back door to the Nexus. Nobody up top believes in this front. The warbands down here know better.</p>' +
      '<p><b>The Mercy Corps.</b> In the middle of it all, medics who answer to no banner carry the wounded out of every battle. In the real world the Corps raises food, toys and funds for local charities, and every supply run reinforces an alliance.</p></div>' +
      '<h3 class="sub">Seasons and acts</h3><ol class="wtime">' +
      '<li class="now"><b>Season 1 · The First Incursion</b><small>Nov 1, 2026 to Jan 24, 2027. Lanternhold Act One: fifteen regions down to the Lampmother.</small></li>' +
      '<li><b>Season 2 · The Expansion</b><small>2027. Act Two opens below the Rift Threshold.</small></li>' +
      '<li><b>The Long War</b><small>Every season after. Each new season of the war opens a new act of the Deep.</small></li></ol>';
  }
  $('codexseg').addEventListener('click', e => { if (e.target.closest('[data-cx="war"]')) paintWarRoom(); });
  paintWarRoom();

  // ---------- chat: Global, Trade and Party ----------
  const CHAT_POLL_OPEN = 5000;
  const chat = { ch: 'global', leader: null, open: false, msgs: {}, since: {}, timer: 0, me: null, rooms: [], muted: new Set(), dmTo: null, seen: {}, bg: 0, polled: {} };
  // Unread tracking: the newest message id you have looked at, per channel. Whispers remember it across visits.
  try { chat.seen.dm = localStorage.getItem('lh_seen_dm') || ''; } catch (e) {}
  const CHAT_POLL_BG = 20000, WATCH = ['dm', 'global'];
  try { JSON.parse(localStorage.getItem('lanternhold.muted') || '[]').forEach(x => chat.muted.add(x)); } catch (e) {}
  const roomKey = () => chat.ch + (chat.ch === 'party' ? ':' + (chat.leader || 'mine') : '');
  async function chatCall(method, path, body) {
    const tok = await idToken(); if (!tok) throw Object.assign(new Error('signed out'), { status: 401 });
    const r = await fetch(CL.api.replace(/\/$/, '') + path, { method, headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'chat'), { status: r.status, code: j.error });
    return j;
  }
  function chatNote(t, warn) { const n = $('chatnote'); n.textContent = t || 'Be kind. No web links. Ctrl+click an item to link it. Tap a name to whisper, mute or report.'; n.classList.toggle('warn', !!warn); }
  // Item links: Ctrl/Cmd+click an item (or use Link in chat) to drop it into the message.
  const ITEM_TOKEN = /\[\[i:(tank|healer|rogue|mage|necro),(weapon|armor|trinket|main|off|head|neck|chest|robe|legs|feet|ring),(common|fine|rare|epic|set|goblin),([a-z]{0,8}),(\d{1,6}),(\d{1,2})\]\]/g;
  // Region set pieces ride in the set field as r plus a letter (ra = the first region).
  const tokenOf = it => '[[i:' + it.cls + ',' + it.slot + ',' + it.rar + ',' + (it.set || (it.rset != null ? 'r' + String.fromCharCode(97 + it.rset) : '')) + ',' + it.ilvl + ',' + (it.up || 0) + ']]';
  const itemLabel = it => L.gearName(it) + (it.up ? ' +' + it.up : '');
  function itemFromToken(m) {
    const rs = /^r[a-z]$/.test(m[4]) ? m[4].charCodeAt(1) - 97 : -1;
    if (rs >= 0 && (!L.REGION_SETS[rs] || m[3] !== 'set' || L.RSET_SLOTS.indexOf(m[2]) < 0)) return null;
    const it = L.normItem({ cls: m[1], slot: m[2], rar: m[3], set: rs < 0 && m[4] || undefined, rset: rs >= 0 ? rs : undefined, ilvl: +m[5], up: Math.min(+m[6], L.UP_MAX) });
    if (it.rar === 'goblin') { if (it.slot !== 'neck') return null; it.gob = 1; }
    if (it.set && !L.SETS.some(x => x.id === it.set && x.cls === it.cls)) return null;
    if (it.rar === 'set' && !it.set && it.rset == null) return null;
    try { L.gearName(it); return it; } catch (e) { return null; }
  }
  chat.links = [];
  // A Loot Goblin's Sack is rare enough to tell everyone: post it to Global chat with a link (signed-in players only).
  async function bragSack(it) {
    if (!CL || !signedIn() || !S.hero) return;
    try { await chatCall('POST', '/chat', { ch: 'global', text: 'just pulled the Loot Goblin’s Sack off a Loot Goblin! ' + tokenOf(it), name: S.hero.name, cls: S.hero.cls }); } catch (e) {}
  }
  function linkItem(it) {
    if (!it || !CL) return false;
    if (!signedIn()) { toast('lock', 'Sign in to chat', 'Item links go to chat, which needs a free account.', 'warn'); return true; }
    if (chat.links.length >= 3) { toast('lock', 'Three links at most', 'Send this message first, then link more.', 'warn'); return true; }
    const label = '[' + itemLabel(it) + ']';
    chat.links.push({ label, token: tokenOf(it) });
    if (!chat.open) openChat(true);
    const inp = $('chatin'), at = inp.selectionStart != null ? inp.selectionStart : inp.value.length;
    inp.value = inp.value.slice(0, at) + (at && inp.value[at - 1] !== ' ' ? ' ' : '') + label + ' ' + inp.value.slice(at);
    inp.focus(); return true;
  }
  function renderText(t) {
    let out = '', last = 0, m; ITEM_TOKEN.lastIndex = 0;
    while ((m = ITEM_TOKEN.exec(t))) {
      out += esc(t.slice(last, m.index)); last = ITEM_TOKEN.lastIndex;
      const it = itemFromToken(m);
      out += it ? '<button class="ilink r-' + it.rar + '" data-link="' + esc(m[0]) + '">[' + esc(itemLabel(it)) + ']</button>' : esc(m[0]);
    }
    return out + esc(t.slice(last));
  }
  function previewItem(tok) {
    ITEM_TOKEN.lastIndex = 0; const m = ITEM_TOKEN.exec(tok), it = m && itemFromToken(m); if (!it) return;
    const set = it.set && L.SETS.find(x => x.id === it.set), rar = L.RARITY.find(r => r.id === it.rar);
    modal('<div class="itemhead r-' + it.rar + '"><div class="tile r-' + it.rar + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt=""></div><div><h2>' + esc(itemLabel(it)) + '</h2><small>' + rar.name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; ' + L.CLASSES[it.cls].name + ' only &middot; found on floor ' + it.ilvl + '</small></div></div>' +
      '<p class="effect">' + itemEffect(it) + '</p>' +
      (set ? '<div class="setinfo on"><b>' + set.name + '</b><small>2 pieces: ' + set.two + '. 3 pieces: ' + set.three + '.</small><small class="lore">' + esc(set.lore) + '</small></div>' : '') +
      '<p class="note">A preview of an item linked in chat. Viewing it does not add it to your pack.</p><div class="row"><button class="btn ghost" id="lp-x">Close</button></div>', md => { md.querySelector('#lp-x').onclick = closeModal; });
  }
  // A sender's name in their Wardrobe name color, with their title, once their looks are known.
  function chatName(m) {
    const lk = looksCache[m.from], c = lk && lk.c && lk.c !== 'none' ? lk.c : '', t = lk && lk.t ? (COSMETICS.t.items.find(x => x[0] === lk.t) || [])[1] : '';
    const bn = lk && lk.b && BANNERS[lk.b] ? lk.b : '';
    return (bn ? bannerSVG(bn, 'chatban') : '') + (c ? '<span class="nc-' + esc(c) + '">' + esc(m.name) + '</span>' : esc(m.name)) + (t ? '<small class="ctitle">' + esc(t) + '</small>' : '');
  }
  function paintChat() {
    const log = $('chatlog'), k = roomKey(), list = (chat.msgs[k] || []).filter(m => !chat.muted.has(m.from));
    if (!signedIn()) { log.innerHTML = '<div class="chatempty"><p>Sign in to chat with other delvers.</p><button class="btn small" id="chat-in">Sign in</button></div>'; $('chatform').hidden = true; return; }
    if (!S.hero) { log.innerHTML = '<div class="chatempty"><p>Create your hero first.</p></div>'; $('chatform').hidden = true; return; }
    $('chatform').hidden = false;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const dm = chat.ch === 'dm';
    if (dm) return paintWhispers(log, list, atBottom);
    $('dmto').hidden = true;
    log.innerHTML = list.length ? list.map(m => m.from === 'sys' ? '<div class="msg sys ' + esc(m.cls) + '">' + icon('flame') + '<span>' + esc(m.text) + '</span></div>' : '<div class="msg' + (m.from === chat.me ? ' mine' : '') + '"><button class="who c-' + esc(m.cls) + '" data-from="' + esc(m.from) + '" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">' + chatName(m) + '</button><span>' + renderText(m.text) + '</span></div>').join('')
      : '<div class="chatempty"><p>' + (chat.ch === 'trade' ? 'Nobody is trading yet. Post what you have or what you need.' : chat.ch === 'banner' ? 'Banner chat. Only heroes who march under ' + ((L.SIDES[S.hero.side] || {}).name || 'your banner') + ' can read this.' : chat.ch === 'party' ? 'Your party chat. Players whose heroes you recruit, or who recruit yours, can talk here.' : chat.ch === 'dm' ? 'No whispers yet. Tap a player’s name in any channel and choose Whisper to message them privately.' : 'Quiet down here. Say hello.') + '</p></div>';
    if (atBottom || list.length < 25) log.scrollTop = log.scrollHeight;
  }
  function mergeMsgs(k, r) {
    chat.me = r.me;
    const cur = chat.msgs[k] || [], seen = new Set(cur.map(m => m.id)), add = r.msgs.filter(m => !seen.has(m.id));
    if (r.msgs.length) { chat.msgs[k] = cur.concat(add).slice(-120); chat.since[k] = chat.msgs[k][chat.msgs[k].length - 1].id; } else chat.msgs[k] = cur;
    return add;
  }
  const viewing = k => chat.open && roomKey() === k && !document.hidden;
  function markSeen(k) {
    const l = chat.msgs[k] || []; if (!l.length) return;
    chat.seen[k] = l[l.length - 1].id; if (k === 'dm') try { localStorage.setItem('lh_seen_dm', chat.seen.dm); } catch (e) {}
  }
  const unread = k => (chat.msgs[k] || []).filter(m => m.id > (chat.seen[k] || '') && m.from !== chat.me && m.from !== 'sys' && !chat.muted.has(m.from)).length;
  function paintUnread() {
    const n = WATCH.reduce((a, k) => a + unread(k), 0), d = $('chatdot');
    d.hidden = !n || chat.open; d.textContent = n > 9 ? '9+' : n || '';
    $('btn-chat').setAttribute('aria-label', n ? 'Open chat, ' + n + ' unread' : 'Open chat');
    document.querySelectorAll('#chatch [data-ch]').forEach(b => { const k = b.dataset.ch; b.classList.toggle('unread', WATCH.includes(k) && k !== roomKey() && unread(k) > 0); });
  }
  // While chat is closed (or on another channel), check Whispers and Global now and then for the unread bubble.
  async function bgPoll() {
    clearTimeout(chat.bg);
    if (CL && signedIn() && S.hero && !document.hidden) {
      for (const k of WATCH) {
        if (viewing(k)) continue;
        try {
          const first = !chat.polled[k], add = mergeMsgs(k, await chatCall('GET', '/chat?ch=' + k + '&since=' + encodeURIComponent(chat.since[k] || '0')));
          chat.polled[k] = 1; if (first && k !== 'dm') markSeen(k);
          if (k === 'dm' && !first) { const w = add.filter(m => m.from !== chat.me && !chat.muted.has(m.from)).pop(); if (w) toast('chat', 'Whisper from ' + w.name, w.text.replace(ITEM_TOKEN, '[item]').slice(0, 90), ''); }
        } catch (e) { if (k === 'dm' && e.status === 403) { const t = document.querySelector('#chatch [data-ch="dm"]'); if (t) t.hidden = true; } }
      }
      paintUnread();
    }
    chat.bg = setTimeout(bgPoll, CHAT_POLL_BG);
  }
  async function pollChat() {
    clearTimeout(chat.timer);
    if (!chat.open || !signedIn() || !S.hero || document.hidden) { if (chat.open) chat.timer = setTimeout(pollChat, CHAT_POLL_OPEN); return; }
    const k = roomKey();
    try {
      const q = '?ch=' + chat.ch + (chat.ch === 'party' && chat.leader ? '&leader=' + chat.leader : '') + '&since=' + encodeURIComponent(chat.since[k] || '0');
      mergeMsgs(k, await chatCall('GET', '/chat' + q)); chat.polled[k] = 1;
      if (k === roomKey()) { paintChat(); if (viewing(k)) markSeen(k); paintUnread(); }
      fetchLooks((chat.msgs[k] || []).map(m => m.from)).then(n => { if (n && k === roomKey()) paintChat(); });
    } catch (e) { if (e.status === 403) { chatNote('You are no longer in that party.', true); } }
    chat.timer = setTimeout(pollChat, CHAT_POLL_OPEN);
  }
  // Whispers read like a messenger: one conversation at a time, picked from the chips on top.
  // Their messages sit on the left, yours on the right.
  const dmOther = m => m.from === chat.me ? { pid: m.to, name: m.toName || 'them' } : { pid: m.from, name: m.name };
  chat.dmSeen = {};
  // Closed whisper tabs: hidden until that player sends something newer. Kept on this device.
  chat.dmHidden = {};
  try { chat.dmHidden = JSON.parse(localStorage.getItem('lh_dm_hidden') || '{}') || {}; } catch (e) {}
  function dmPartners(list) {
    const by = new Map();
    for (const m of list) { const o = dmOther(m); if (!o.pid) continue; const p = by.get(o.pid) || { pid: o.pid, name: o.name, last: '' }; if (m.from !== chat.me) p.name = m.name; p.last = m.id; by.set(o.pid, p); }
    const out = [...by.values()].sort((a, b) => a.last < b.last ? 1 : -1);
    if (chat.dmTo && !by.has(chat.dmTo.pid)) out.unshift({ pid: chat.dmTo.pid, name: chat.dmTo.name, last: '' });
    return out;
  }
  const dmUnread = (list, pid) => list.some(m => m.from === pid && m.id > (chat.dmSeen[pid] || chat.seen.dm || ''));
  function paintWhispers(log, list, atBottom) {
    const people = dmPartners(list).filter(p => !(chat.dmHidden[p.pid] && p.last <= chat.dmHidden[p.pid])), bar = $('dmto');
    if (!chat.dmTo && people.length) chat.dmTo = { pid: people[0].pid, name: people[0].name };
    $('chatin').placeholder = chat.dmTo ? 'Whisper to ' + chat.dmTo.name : 'Pick someone to whisper';
    bar.hidden = false;
    bar.innerHTML = people.length ? people.map(p => '<button type="button" class="dmchip' + (chat.dmTo && p.pid === chat.dmTo.pid ? ' on' : '') + (dmUnread(list, p.pid) && !(chat.dmTo && p.pid === chat.dmTo.pid) ? ' unread' : '') + '" data-dmpick="' + esc(p.pid) + '" data-dmname="' + esc(p.name) + '">' + esc(p.name) + '<span class="dmx" data-dmclose="' + esc(p.pid) + '" role="button" aria-label="Close chat with ' + esc(p.name) + '" title="Close">&times;</span></button>').join('') + '<button type="button" class="dmchip dmnew" id="dm-new" aria-label="New whisper" title="New whisper">+</button>'
      : '<span>No conversations yet.</span><button type="button" class="dmchip dmnew wide" id="dm-new">+ New whisper</button>';
    const conv = chat.dmTo ? list.filter(m => dmOther(m).pid === chat.dmTo.pid) : [];
    if (chat.dmTo && conv.length && viewing('dm')) chat.dmSeen[chat.dmTo.pid] = conv[conv.length - 1].id;
    let prev = null;
    log.innerHTML = conv.length ? conv.map(m => {
      const mine = m.from === chat.me, first = !prev || prev.from !== m.from; prev = m;
      return '<div class="bub' + (mine ? ' mine' : '') + (first ? ' first' : '') + '">' + (first && !mine ? '<small class="bubname">' + chatName(m) + '</small>' : '') + '<span>' + renderText(m.text) + '</span></div>';
    }).join('')
      : '<div class="chatempty"><p>' + (chat.dmTo ? 'Start your conversation with ' + esc(chat.dmTo.name) + '. Only the two of you can see it.' : 'No whispers yet. Tap a player’s name in any channel and choose Whisper to message them privately.') + '</p></div>';
    if (atBottom || conv.length < 25) log.scrollTop = log.scrollHeight;
  }
  function whisperTo(pid, name) {
    if (!pid || pid === chat.me) return;
    if (chat.dmHidden[pid]) { delete chat.dmHidden[pid]; try { localStorage.setItem('lh_dm_hidden', JSON.stringify(chat.dmHidden)); } catch (e) {} }
    chat.dmTo = { pid, name }; if (!chat.open) openChat(true);
    setChannel('dm'); setTimeout(() => $('chatin').focus(), 50);
  }
  async function loadRooms() {
    try { const r = await chatCall('GET', '/parties'); chat.me = r.me; chat.rooms = r.parties || []; } catch (e) { chat.rooms = []; }
    const sel = $('chatroom');
    sel.innerHTML = '<option value="">My party</option>' + chat.rooms.map(p => '<option value="' + esc(p.leader) + '">' + esc(p.name) + '’s party</option>').join('');
    sel.value = chat.leader || ''; sel.hidden = chat.ch !== 'party' || !chat.rooms.length;
  }
  function setChannel(ch) {
    chat.ch = ch; document.querySelectorAll('#chatch button').forEach(b => b.classList.toggle('on', b.dataset.ch === ch));
    $('chatin').placeholder = ch === 'dm' ? (chat.dmTo ? 'Whisper to ' + chat.dmTo.name : 'Pick someone to whisper') : ch === 'trade' ? 'Looking for, or offering...' : ch === 'banner' ? 'Talk to your banner' : ch === 'party' ? 'Talk to your party' : 'Say something';
    if (ch === 'party') loadRooms(); else $('chatroom').hidden = true;
    chatNote(); paintChat(); pollChat();
  }
  function openChat(open) {
    chat.open = open; $('chat').hidden = !open; $('btn-chat').hidden = open; paintUnread();
    try { localStorage.setItem('lh_chat', open ? '1' : '0'); } catch (e) {}
    if (open) { paintChat(); pollChat(); if (signedIn()) setTimeout(() => $('chatin').focus(), 50); } else clearTimeout(chat.timer);
  }
  if (CL) {
    $('btn-chat').hidden = false;
    $('btn-chat').addEventListener('click', () => openChat(true));
    $('chatmin').addEventListener('click', () => openChat(false));
    // The chat window stays as you left it: open or tucked away.
    try { if (localStorage.getItem('lh_chat') === '1' && matchMedia('(min-width:721px)').matches) setTimeout(() => openChat(true), 1500); } catch (e) {}
    $('chatch').addEventListener('click', e => { const b = e.target.closest('[data-ch]'); if (b) setChannel(b.dataset.ch); });
    $('chatroom').addEventListener('change', e => { chat.leader = e.target.value || null; paintChat(); pollChat(); });
    $('chatlog').addEventListener('click', e => {
      if (e.target.closest('#chat-in')) { authForm('in'); return; }
      const lk = e.target.closest('[data-link]'); if (lk) { previewItem(lk.dataset.link); return; }
      const dw = e.target.closest('[data-dm]'); if (dw) { whisperTo(dw.dataset.dm, dw.dataset.dmname); return; }
      const w = e.target.closest('[data-from]'); if (!w || w.dataset.from === chat.me) return;
      const from = w.dataset.from, id = w.dataset.id, name = w.dataset.name;
      modal('<h2>' + esc(name) + '</h2><p>Mute hides everything this player says, on this device. Report flags this message for review; messages with several reports are hidden for everyone.</p><div class="row"><button class="btn" id="c-dm">Whisper</button><button class="btn ghost" id="c-mute">Mute ' + esc(name) + '</button><button class="btn danger" id="c-rep">Report message</button><button class="btn ghost" id="c-x">Cancel</button></div>', md => {
        md.querySelector('#c-mute').onclick = () => { chat.muted.add(from); try { localStorage.setItem('lanternhold.muted', JSON.stringify([...chat.muted])); } catch (e) {} closeModal(); paintChat(); toast('lock', 'Muted', 'You won’t see messages from ' + name + '.', ''); };
        md.querySelector('#c-rep').onclick = async () => { closeModal(); try { await chatCall('POST', '/report', { ch: chat.ch, leader: chat.leader || undefined, id }); } catch (e) {} toast('lock', 'Reported', 'Thanks. We’ll keep an eye on it.', ''); };
        md.querySelector('#c-x').onclick = closeModal;
        md.querySelector('#c-dm').onclick = () => { closeModal(); whisperTo(from, name); };
      });
    });
    // New whisper: pick from players you've seen in chat, so nobody has to hunt for a name to tap.
    function newWhisper() {
      const seen = new Map();
      for (const k of Object.keys(chat.msgs)) for (const m of chat.msgs[k]) if (m.from && m.from !== 'sys' && m.from !== chat.me && !chat.muted.has(m.from) && k !== 'dm') seen.set(m.from, { pid: m.from, name: m.name, id: m.id });
      const people = [...seen.values()].sort((a, b) => a.id < b.id ? 1 : -1).slice(0, 24);
      modal('<h2>New whisper</h2>' + (people.length ? '<p>Players who have been chatting lately.</p><div class="dmpicklist">' + people.map(p => '<button class="btn ghost small" data-pick="' + esc(p.pid) + '" data-pname="' + esc(p.name) + '">' + esc(p.name) + '</button>').join('') + '</div>' : '<p>Nobody has chatted lately. Players show up here once they post in Global, Banner, Trade or Party.</p>') + '<div class="row"><button class="btn ghost" id="dp-x">Cancel</button></div>', md => {
        md.querySelector('#dp-x').onclick = closeModal;
        md.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { closeModal(); whisperTo(b.dataset.pick, b.dataset.pname); });
      });
    }
    $('dmto').addEventListener('click', e => {
      const x = e.target.closest('[data-dmclose]');
      if (x) {
        const pid = x.dataset.dmclose, l = (chat.msgs.dm || []).filter(m => dmOther(m).pid === pid);
        chat.dmHidden[pid] = l.length ? l[l.length - 1].id : '0'; try { localStorage.setItem('lh_dm_hidden', JSON.stringify(chat.dmHidden)); } catch (e2) {}
        if (chat.dmTo && chat.dmTo.pid === pid) chat.dmTo = null;
        paintChat(); return;
      }
      if (e.target.closest('#dm-new')) { newWhisper(); return; } const c = e.target.closest('[data-dmpick]'); if (c) { chat.dmTo = { pid: c.dataset.dmpick, name: c.dataset.dmname }; paintChat(); $('chatin').focus(); } });
    setTimeout(bgPoll, 4000);
    $('chatform').addEventListener('submit', async e => {
      e.preventDefault();
      const inp = $('chatin'); let text = inp.value.trim(); if (!text || !S.hero) return;
      for (const l of chat.links) text = text.replace(l.label, l.token);
      text = text.replace(/\[\[(?!i:)/g, '[');
      if (chat.ch === 'dm' && !chat.dmTo) { chatNote('Pick who to whisper first: tap a player’s name in Global, Banner, Trade or Party and choose Whisper.', true); return; }
      inp.disabled = true;
      try {
        await chatCall('POST', '/chat', { ch: chat.ch, leader: chat.leader || undefined, to: chat.ch === 'dm' ? chat.dmTo.pid : undefined, text, name: S.hero.name, cls: S.hero.cls });
        inp.value = ''; chat.links = []; chatNote(); pollChat();
      } catch (err) {
        chatNote({ slow: 'Easy there. One message every few seconds.', links: 'Links aren’t allowed in chat.', name: 'Your hero’s name can’t be used in chat. Start a new hero with a different name.', room: 'You can’t post in that party.', to: 'That player can’t get whispers right now.' }[err.code] || 'Message not sent. Try again in a moment.', true);
      }
      inp.disabled = false; inp.focus();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (chat.open) pollChat(); bgPoll(); });
  }
  // ---------- map of the Lantern Deep ----------
  // A one-screen world map of the fifteen regions, and a close-up of each region with its ten floors and a dossier.
  const MAP_W = 360, BAND = 168;
  function storyFloor(b) { const m = String(b.when).match(/maxFloorEver >= (\d+)/); return m ? +m[1] : 1; }
  const mrand = seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  // Background art for each region, drawn behind the trail. Everything is original line art.
  function scenery(r, y0, c) {
    const R = mrand(r * 977 + 13), Y = y0 + BAND, g = [];
    const spread = (n, fn) => { for (let k = 0; k < n; k++) g.push(fn(18 + (k + R() * 0.6) * (MAP_W - 30) / n, R())); };
    switch (r) {
      case 0: // barrels and hanging lamps
        spread(5, (x, q) => '<g transform="translate(' + x + ' ' + (Y - 30 - q * 8) + ')"><rect x="-11" y="0" width="22" height="26" rx="6" fill="#3a2716"/><path d="M-11 7h22M-11 19h22" stroke="#6b4a2a" stroke-width="2"/></g>');
        spread(4, (x, q) => '<path d="M' + x + ' ' + y0 + 'v' + (40 + q * 14) + '" stroke="#5b4630" stroke-width="1"/><circle cx="' + x + '" cy="' + (y0 + 44 + q * 14) + '" r="4" fill="' + c + '"/><circle cx="' + x + '" cy="' + (y0 + 44 + q * 14) + '" r="13" fill="' + c + '" opacity=".18" class="flick"/>');
        break;
      case 1: // gravestones and a crypt arch
        spread(7, (x, q) => '<path d="M' + (x - 8) + ' ' + Y + 'v-' + (18 + q * 10) + 'a8 8 0 0 1 16 0v' + (18 + q * 10) + 'z" fill="#1d3024"/><path d="M' + x + ' ' + (Y - 12 - q * 8) + 'v-7M' + (x - 3) + ' ' + (Y - 16 - q * 8) + 'h6" stroke="#2f4a37" stroke-width="1.5"/>');
        g.push('<path d="M250 ' + Y + 'v-62a36 36 0 0 1 72 0v62" fill="none" stroke="#24382b" stroke-width="6"/>');
        break;
      case 2: // glowing mushrooms and drifting spores
        spread(8, (x, q) => { const h = 14 + q * 26, w = 9 + q * 12; return '<path d="M' + x + ' ' + Y + 'v-' + h + '" stroke="#3a2b4c" stroke-width="' + (3 + q * 3) + '"/><path d="M' + (x - w) + ' ' + (Y - h) + 'q' + w + ' -' + (w * 1.2) + ' ' + (2 * w) + ' 0z" fill="' + c + '" opacity=".55"/><ellipse cx="' + x + '" cy="' + (Y - h) + '" rx="' + (w * 1.6) + '" ry="' + w + '" fill="' + c + '" opacity=".12" class="flick"/>'; });
        spread(10, (x, q) => '<circle cx="' + x + '" cy="' + (y0 + 40 + q * 90) + '" r="1.4" fill="' + c + '" class="drift"/>');
        break;
      case 3: // ribcages and salt crystals
        spread(3, (x, q) => '<g transform="translate(' + x + ' ' + (Y - 6) + ')" stroke="#cfd9dc" stroke-width="2" fill="none" opacity=".7"><path d="M-30 0h60"/>' + [-20, -10, 0, 10, 20].map(d => '<path d="M' + d + ' 0q' + (d / 3) + ' -' + (22 - Math.abs(d) / 2) + ' ' + (d / 2) + ' -' + (30 - Math.abs(d) / 2) + '"/>').join('') + '</g>');
        spread(6, (x, q) => '<path d="M' + x + ' ' + Y + 'l5 -' + (14 + q * 18) + 'l5 ' + (14 + q * 18) + 'z" fill="#b9d6de" opacity=".4"/>');
        break;
      case 4: // forge anvils and a lava river
        g.push('<path d="M0 ' + (Y - 10) + 'Q90 ' + (Y - 22) + ' 180 ' + (Y - 12) + 'T360 ' + (Y - 14) + 'V' + Y + 'H0z" fill="#ff5a1f" opacity=".55" class="flick"/><path d="M0 ' + (Y - 10) + 'Q90 ' + (Y - 22) + ' 180 ' + (Y - 12) + 'T360 ' + (Y - 14) + '" stroke="#ffb15a" stroke-width="1.5" fill="none"/>');
        spread(3, x => '<path d="M' + (x - 16) + ' ' + (Y - 18) + 'h32l-6 -8h10v-8h-40v8h10z" fill="#2a120a"/>');
        spread(12, (x, q) => '<circle cx="' + x + '" cy="' + (Y - 30 - q * 100) + '" r="1.3" fill="#ffb15a" class="rise"/>');
        break;
      case 5: // a drowned window and the waterline
        g.push('<path d="M262 ' + (y0 + 118) + 'v-58a26 26 0 0 1 52 0v58" fill="#0a1722" stroke="#2a4a5e" stroke-width="3"/><path d="M288 ' + (y0 + 40) + 'v78M262 ' + (y0 + 80) + 'h52" stroke="#2a4a5e" stroke-width="2"/><circle cx="288" cy="' + (y0 + 62) + '" r="8" fill="none" stroke="#6cc4e8" stroke-width="1.5" opacity=".7"/>');
        g.push('<rect x="0" y="' + (Y - 34) + '" width="' + MAP_W + '" height="34" fill="#1b4a66" opacity=".35"/>' + [0, 1, 2].map(k => '<path d="M0 ' + (Y - 34 + k * 9) + 'q15 -5 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" stroke="#6cc4e8" stroke-width="1" fill="none" opacity="' + (0.5 - k * 0.14) + '" class="wave"/>').join(''));
        break;
      case 6: // roots reaching down from the ceiling
        spread(6, (x, q) => '<path d="M' + x + ' ' + y0 + 'q' + (q * 30 - 15) + ' ' + (30 + q * 20) + ' ' + (q * 10 - 5) + ' ' + (60 + q * 40) + 'q-8 12 -2 ' + (20 + q * 10) + '" stroke="#5a4c22" stroke-width="' + (3 + q * 4) + '" fill="none" stroke-linecap="round"/>');
        spread(5, (x, q) => '<path d="M' + (x - 14) + ' ' + Y + 'q14 -' + (16 + q * 14) + ' 28 0" fill="#2c2812"/>');
        break;
      case 7: // a vault of dead stars
        spread(26, (x, q) => '<circle cx="' + x + '" cy="' + (y0 + 8 + q * (BAND - 16)) + '" r="' + (0.6 + R() * 1.4) + '" fill="#cfd4ff" opacity="' + (0.3 + R() * 0.6).toFixed(2) + '"' + (q > 0.6 ? ' class="twink"' : '') + '/>');
        g.push('<circle cx="300" cy="' + (y0 + 128) + '" r="22" fill="#05040b" stroke="#9aa6ff" stroke-width="1" opacity=".8"/><circle cx="300" cy="' + (y0 + 128) + '" r="32" fill="none" stroke="#9aa6ff" stroke-width=".5" stroke-dasharray="2 4" opacity=".6"/>');
        break;
      case 8: // shards of Rift-glass
        spread(9, (x, q) => '<path d="M' + x + ' ' + Y + 'l' + (4 + q * 6) + ' -' + (20 + q * 42) + 'l' + (6 + q * 4) + ' ' + (20 + q * 42) + 'z" fill="' + c + '" opacity="' + (0.18 + q * 0.3).toFixed(2) + '"/><path d="M' + (x + 4 + q * 6) + ' ' + (Y - 20 - q * 42) + 'l-2 ' + (12 + q * 20) + '" stroke="#e8fbff" stroke-width=".8" opacity=".6"/>');
        break;
      case 9: // the Bastion walls
        g.push('<path d="M0 ' + Y + 'V' + (Y - 40) + Array.from({ length: 36 }, (_, k) => 'h10v' + (k % 2 ? 8 : -8)).join('') + 'V' + Y + 'z" fill="#1f1d18" stroke="#3a362c"/>');
        g.push('<rect x="286" y="' + (Y - 84) + '" width="40" height="84" fill="#26231d" stroke="#3a362c"/><path d="M306 ' + (Y - 84) + 'v-22" stroke="#6b6658"/><path d="M306 ' + (Y - 106) + 'h18l-4 6 4 6h-18z" fill="#9fb4c8" class="flap"/>');
        break;
      case 10: // aqueduct arches and running water
        g.push('<path d="M0 ' + (Y - 70) + 'H360v10H0z" fill="#1c3236"/>' + Array.from({ length: 6 }, (_, k) => '<path d="M' + (k * 62 + 6) + ' ' + Y + 'v-40a25 25 0 0 1 50 0v40" fill="none" stroke="#1c3236" stroke-width="7"/>').join(''));
        spread(6, (x, q) => '<path d="M' + x + ' ' + (Y - 60) + 'v' + (30 + q * 30) + '" stroke="#5fd0c0" stroke-width="1" opacity=".5" stroke-dasharray="3 5" class="fall"/>');
        break;
      case 11: // pale trees of the Bone Orchard
        spread(5, (x, q) => { const h = 40 + q * 40, a = 10 + q * 8; return '<path d="M' + x + ' ' + Y + 'v-' + h + 'm0 ' + (h * 0.35) + 'l-' + a + ' -' + (16 + q * 8) + 'm' + a + ' ' + (h * 0.2 + 16 + q * 8) + 'l' + (12 + q * 8) + ' -' + (20 + q * 10) + '" stroke="#e8dcc0" stroke-width="' + (2 + q * 2) + '" fill="none" stroke-linecap="round" opacity=".55"/><circle cx="' + (x - a) + '" cy="' + (Y - h * 0.65 - 16 - q * 8) + '" r="2.4" fill="#c84a4a" opacity=".8"/>'; });
        break;
      case 12: // the Stormglass Spire with lightning
        g.push('<path d="M296 ' + Y + 'l10 -150l10 150z" fill="#1d2448" stroke="#3a4a8a"/><circle cx="306" cy="' + (y0 + 22) + '" r="5" fill="#cfe0ff" class="flick"/><path d="M306 ' + (y0 + 26) + 'l-14 24l10 -2l-12 26" stroke="#9ab8ff" stroke-width="1.6" fill="none" class="bolt"/><path d="M306 ' + (y0 + 26) + 'l18 20l-9 0l12 22" stroke="#9ab8ff" stroke-width="1.2" fill="none" class="bolt b2"/>');
        spread(4, (x, q) => '<path d="M' + (x - 9) + ' ' + Y + 'l9 -' + (16 + q * 14) + 'l9 ' + (16 + q * 14) + 'z" fill="#151a33" stroke="#2a3466"/>');
        break;
      case 13: // the Nexus Scar: three alliance banners over a burning crack
        g.push('<path d="M0 ' + (Y - 18) + 'l40 6l30 -10l40 12l36 -8l44 10l30 -6l40 8l40 -10l60 8" stroke="#ff6a8a" stroke-width="2" fill="none" opacity=".7" class="flick"/>');
        ['#9fb4c8', '#ffd36b', '#d06bff'].forEach((col, k) => { const x = 210 + k * 46; g.push('<path d="M' + x + ' ' + Y + 'v-' + (78 - k * 6) + '" stroke="#4a3a40" stroke-width="2"/><path d="M' + x + ' ' + (Y - 78 + k * 6) + 'h22l-6 9l6 9h-22z" fill="' + col + '" opacity=".75" class="flap"/>'); });
        break;
      case 14: // the Rift Threshold itself
        g.push('<path d="M300 ' + (y0 + 22) + 'q-18 40 6 70q-20 30 -4 66" stroke="#c9a6ff" stroke-width="7" fill="none" opacity=".25" class="flick"/><path d="M300 ' + (y0 + 22) + 'q-18 40 6 70q-20 30 -4 66" stroke="#efe2ff" stroke-width="1.6" fill="none"/>');
        spread(12, (x, q) => '<circle cx="' + x + '" cy="' + (y0 + 20 + q * 140) + '" r="1.2" fill="#c9a6ff" class="drift"/>');
        break;
    }
    // rocky ceiling between regions
    let rock = 'M0 ' + y0; for (let x = 0; x <= MAP_W; x += 15) rock += 'L' + x + ' ' + Math.round(y0 + 3 + R() * (x % 30 ? 6 : 13));
    return '<g class="mscene">' + g.join('') + '</g><path d="' + rock + 'L' + MAP_W + ' ' + y0 + 'z" fill="rgba(0,0,0,.55)"/>';
  }
  // Rival delvers from the public leaderboard, cached for a few minutes.
  let rivals = null, rivalsAt = 0;
  async function loadRivals() {
    if (!CL || Date.now() - rivalsAt < 180000) return rivals; rivalsAt = Date.now();
    try { const r = await fetch(CL.api.replace(/\/$/, '') + '/leaderboard'); if (r.ok) rivals = (await r.json()).top || []; } catch (e) {}
    return rivals;
  }
  const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  let mapRegion = -1;
  function regionInfo(r, base, reached) {
    const b = L.BIOMES[r], first = base + r * 10 + 1, last = first + 9;
    const known = first <= reached || (base === 0 && r === 0);
    const cleared = reached > last, floors = Math.max(0, Math.min(10, reached - first + 1));
    return { b, r, first, last, known, cleared, floors };
  }
  function dossier(r, base, reached) {
    const x = regionInfo(r, base, reached), b = x.b, sd = L.SIDES[b.war.side];
    if (!x.known) return '<div class="dos locked"><span class="dos-k">Region ' + (r + 1) + ' of ' + L.BIOMES.length + ' · Floors ' + x.first + '–' + x.last + '</span><h3>Unexplored</h3><p class="note">Nobody from the Hold has mapped this far. Reach floor ' + x.first + ' to chart it.</p></div>';
    const lore = L.LORE.find(l => l.id === 'biome' + r), gl = L.LORE.find(l => l.id === 'g' + r);
    const hasLore = lore && S.lore[lore.id], hasG = gl && S.lore[gl.id];
    const mod = b.mod && L.MODS[b.mod];
    const beats = base === 0 ? L.STORY.filter(s => S.story.seen[s.id] && s.id !== 'intro' && storyFloor(s) >= x.first && storyFloor(s) <= x.last) : [];
    const here = (rivals || []).filter(p => p.floor >= x.first && p.floor <= x.last);
    const to = Math.min(reached, x.last);
    return '<div class="dos" style="--acc:' + b.accent + '">' +
      '<span class="dos-k">Region ' + (r + 1) + ' of ' + L.BIOMES.length + ' · Floors ' + x.first + '–' + x.last + '</span>' +
      '<h3>' + esc(b.name) + '</h3>' +
      '<div class="dos-bar"><i style="width:' + x.floors * 10 + '%"></i></div><small class="dos-st">' + (x.cleared ? 'Conquered. The guardian is down.' : x.floors + ' of 10 floors charted') + '</small>' +
      '<p class="dos-lore">' + (hasLore ? esc(lore.text) : '<i>Push deeper into this region to uncover its history in the Journal.</i>') + '</p>' +
      '<dl class="dos-facts">' +
        '<dt>Held by</dt><dd><b style="color:' + sd.color + '">' + esc(sd.name) + '</b> warbands: ' + b.war.units.map(esc).join(', ') + '</dd>' +
        (b.foe ? '<dt>Native foe</dt><dd>' + esc(b.foe.name) + '</dd>' : '') +
        (mod ? '<dt>Monster trick</dt><dd><b>' + esc(mod.name) + '.</b> ' + esc(mod.desc) + '</dd>' : '') +
        '<dt>Guardian</dt><dd><b>' + esc(b.boss) + '</b>, floor ' + x.last + (x.cleared ? ' <span class="dos-ok">defeated</span>' : '') + (hasG ? '<br><small>' + esc(gl.text) + '</small>' : '') + '</dd>' +
        (beats.length ? '<dt>Story</dt><dd>' + beats.map(s => '<button class="linkbtn" data-scene="' + s.id + '">Chapter ' + s.ch + ': ' + esc(s.title) + '</button>').join('') + '</dd>' : '') +
        (here.length ? '<dt>Delvers here</dt><dd>' + here.slice(0, 6).map(p => esc(p.name) + ' <small>(floor ' + p.floor + ')</small>').join(', ') + '</dd>' : '') +
      '</dl>' +
      '<div class="dos-go"><button class="btn small" data-go="' + to + '">Travel to floor ' + to + '</button>' + (to > x.first ? '<button class="btn small ghost" data-go="' + x.first + '">Region entrance</button>' : '') + '</div>' + lootList(x.first) + '</div>';
  }
  // Possible loot (John, 2026-11-23): the region's drops with this player's real odds per kill, from L.regionLoot.
  const LOOT_COLOR = Object.assign({}, RARITY_COLOR, { relic: '#ff9f5a', sigil: '#9fd0ff', goblin: '#7dff6a', legend: '#ff8a3d' });
  function lootPct(p) {
    if (p >= 0.995) return '100%';
    if (p >= 0.1) return Math.round(p * 100) + '%';
    if (p >= 0.01) return (p * 100).toFixed(1) + '%';
    if (p >= 0.001) return (p * 100).toFixed(2) + '%';
    return '1 in ' + fmt(Math.round(1 / p));
  }
  let lootOpen = true;
  try { lootOpen = localStorage.getItem('lh_loot') !== '0'; } catch (e) {}
  document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('dos-loot')) { lootOpen = e.target.open; try { localStorage.setItem('lh_loot', lootOpen ? '1' : '0'); } catch (x) {} } }, true);
  function lootList(first) {
    const R = L.regionLoot(S, first), b = R.bonus, up = Math.round((b.total - 1) * 100);
    const why = (b.parts.length ? 'Your gear-drop bonus: ' + b.parts.map(x => x[0] + ' +' + (x[1] * 100).toFixed(1) + '%').join(', ') + '. ' : 'No gear-drop bonus yet. Keen Eye, Luck, the Forager camp job, Finder enchants and the Seeker’s Charm all raise it. ') +
      'Odds are per kill of that kind. In fights here: chests ' + (R.rates.chest * 100).toFixed(1) + '%, elites ' + Math.round(R.rates.elite * 100) + '%, ambushes ' + Math.round(R.rates.pack * 100) + '%. ' +
      'Lantern Surge and region mastery add gold and XP, not drops. Relic and Goblin Sack odds are fixed.';
    return '<details class="dos-loot"' + (lootOpen ? ' open' : '') + '><summary><span>Possible loot</span><small>' + (up ? '<b>+' + up + '%</b> drop bonus' : 'no drop bonus') + '</small></summary>' +
      R.rows.map(r => '<div class="lt"><div class="lt-h"><b style="color:' + (LOOT_COLOR[r.rar] || 'inherit') + '">' + esc(r.name) + '</b><small>' + esc(r.note) + '</small></div>' +
        '<div class="lt-s">' + r.src.map(x => '<span><small>' + esc(x[0]) + '</small> ' + lootPct(x[1]) + '</span>').join('') + '</div></div>').join('') +
      '<p class="lt-f">Per kill, for your party right now. Bosses guard floors ' + (first + 4) + ' and ' + (first + 9) + '. ' + tipI(why) + '</p></details>';
  }
  function overview(base, reached) {
    const regs = L.BIOMES.map((_, r) => regionInfo(r, base, reached));
    const known = regs.filter(x => x.known).length, done = regs.filter(x => x.cleared).length;
    const ch = L.STORY.filter(s => S.story.seen[s.id] && s.id !== 'intro').length, chT = L.STORY.filter(s => s.id !== 'intro').length;
    const sealed = !L.actTwoOpen(), days = Math.max(0, Math.ceil((L.ACT_TWO_AT - Date.now()) / 864e5));
    return '<div class="dos"><span class="dos-k">Act One · The Lantern Deep</span><h3>Expedition record</h3>' +
      '<div class="dos-grid"><div><small>Regions charted</small><b>' + known + '/' + regs.length + '</b></div><div><small>Guardians felled</small><b>' + done + '</b></div><div><small>Chapters</small><b>' + ch + '/' + chT + '</b></div><div><small>Deepest</small><b>' + reached + '</b></div></div>' +
      '<p class="dos-lore">The Hold sits on a tear in the Shattered Reach. Below it the stair runs through fifteen regions, each held by a warband of the Grand War, down to the Nyx Rift. Tap a region on the map to look closer and read its dossier.</p>' +
      (sealed ? '<p class="note">The way past floor ' + L.ACT_ONE_END + ' is sealed until Season 2 of the Grand War, ' + days + ' day' + (days === 1 ? '' : 's') + ' from now.</p>' : '') + '</div>';
  }
  // ---- world view: the whole Deep on one screen, one painted medallion per region ----
  const MED_W = 170, MED_H = Math.round(BAND * MED_W / MAP_W);
  function worldLayout(portrait) {
    const cols = portrait ? 3 : 5, cw = 200, rh = portrait ? 196 : 186, top = portrait ? 150 : 150;
    const W = cols * cw, n = L.BIOMES.length, rows = Math.ceil(n / cols), H = top + rows * rh + 70;
    const pos = L.BIOMES.map((_, r) => { const row = Math.floor(r / cols), i = r % cols, col = row % 2 ? cols - 1 - i : i; return { x: 100 + col * cw, y: top + row * rh + ((r * 37) % 3 - 1) * 10, row, col }; });
    return { W, H, pos, cols };
  }
  function worldSvg(lay, base, reached, cur) {
    const { W, H, pos } = lay, me = S.hero && S.hero.name, curR = Math.floor((cur - base - 1) / 10);
    const reachedR = Math.min(L.BIOMES.length - 1, Math.floor((reached - base - 1) / 10));
    let s = '<svg class="worldmap" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map of the Lantern Deep"><defs>' +
      L.BIOMES.map((b, r) => '<linearGradient id="mg' + r + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + b.bg[0] + '"/><stop offset="1" stop-color="' + b.bg[1] + '"/></linearGradient><clipPath id="mc' + r + '"><rect x="0" y="0" width="' + MAP_W + '" height="' + BAND + '" rx="46"/></clipPath>').join('') +
      '<radialGradient id="mglow"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".9"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="mrift"><stop offset="0" stop-color="#c9a6ff" stop-opacity=".8"/><stop offset="1" stop-color="#c9a6ff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="mcave" cx=".5" cy=".4" r=".75"><stop offset="0" stop-color="#1a1520"/><stop offset="1" stop-color="#050408"/></radialGradient>' +
      '<pattern id="mfog" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#0b0a10"/><path d="M0 12L12 0" stroke="#17141e" stroke-width="2"/></pattern></defs>';
    s += '<rect width="' + W + '" height="' + H + '" fill="url(#mcave)"/>';
    // faint strata lines in the rock
    const R = mrand(7); for (let k = 0; k < 9; k++) { const y = 110 + k * (H - 160) / 8; s += '<path d="M0 ' + y + 'Q' + W * 0.3 + ' ' + (y - 20 + R() * 40) + ' ' + W * 0.6 + ' ' + (y + R() * 20) + 'T' + W + ' ' + (y - 10) + '" stroke="#ffffff" stroke-opacity=".03" stroke-width="2" fill="none"/>'; }
    // the surface and the Hold
    s += '<path d="M0 0H' + W + 'V64Q' + W * 0.75 + ' 82 ' + W * 0.5 + ' 70T0 74z" fill="#0c1020"/>' + Array.from({ length: 18 }, (_, k) => '<circle cx="' + ((k * 97) % W) + '" cy="' + (8 + (k * 29) % 40) + '" r="' + (k % 3 ? 0.8 : 1.4) + '" fill="#e8e2ff" opacity=".55"/>').join('') +
      '<g transform="translate(40 18)" fill="#3b3226" stroke="#c9a46a"><rect x="0" y="24" width="56" height="30"/><rect x="4" y="10" width="12" height="16"/><rect x="40" y="10" width="12" height="16"/><rect x="22" y="0" width="12" height="26"/><rect x="24" y="38" width="8" height="16" fill="#1a130c"/></g><circle cx="68" cy="34" r="22" fill="url(#mglow)" class="flick"/>' +
      '<text x="108" y="38" class="wt">The Hold</text><text x="108" y="54" class="ws">Iron Covenant fortress · tap to visit</text><rect x="30" y="8" width="260" height="56" fill="transparent" data-camp="hold" class="holdhit"><title>Visit the Hold</title></rect>';
    // the road
    const road = [{ x: 68, y: 74 }].concat(pos), seg = (a, b) => {
      if (a.row === b.row || a.row === undefined) return 'C' + a.x + ' ' + ((a.y + b.y) / 2 + (a.row === undefined ? 20 : 0)) + ' ' + b.x + ' ' + ((a.y + b.y) / 2) + ' ' + b.x + ' ' + b.y;
      const d = b.col === 0 ? -1 : 1; return 'C' + (a.x + d * 95) + ' ' + a.y + ' ' + (b.x + d * 95) + ' ' + b.y + ' ' + b.x + ' ' + b.y;
    };
    const roadD = n => road.slice(0, n).reduce((acc, p, i) => i ? acc + seg(road[i - 1], p) : 'M' + p.x + ' ' + p.y, '');
    s += '<path d="' + roadD(road.length) + '" stroke="#000" stroke-opacity=".6" stroke-width="12" fill="none" stroke-linecap="round"/><path d="' + roadD(road.length) + '" stroke="#2e2620" stroke-width="5" fill="none" stroke-linecap="round"/>';
    s += '<path d="' + roadD(reachedR + 2) + '" stroke="#f5c242" stroke-width="2.6" stroke-dasharray="2 7" stroke-linecap="round" fill="none" class="march"/>';
    // the Rift at the end of the road
    const last = pos[pos.length - 1], sealed = !L.actTwoOpen(), rx = last.x, ry = H - 34;
    s += '<path d="M' + last.x + ' ' + (last.y + 40) + 'L' + rx + ' ' + (ry - 10) + '" stroke="#2e2620" stroke-width="5"/><ellipse cx="' + rx + '" cy="' + ry + '" rx="90" ry="26" fill="url(#mrift)" class="flick"/>' +
      (sealed ? '<g transform="translate(' + rx + ' ' + (ry - 4) + ')"><title>Sealed until Season 2</title><circle r="13" fill="#120d1e" stroke="#f5c242"/><rect x="-5" y="-2" width="10" height="8" rx="1.5" fill="#f5c242"/><path d="M-3.4 -2v-3a3.4 3.4 0 0 1 6.8 0v3" stroke="#f5c242" stroke-width="1.8" fill="none"/></g>' : '') +
      '<text x="' + (rx - 104) + '" y="' + (ry + 5) + '" class="ws" text-anchor="end">' + (sealed ? 'The Nyx Rift · sealed until Act Two' : 'The Nyx Rift') + '</text>';
    // medallions
    const riv = {}; for (const p of rivals || []) { if (p.name === me || p.floor <= base) continue; const r = Math.floor((p.floor - base - 1) / 10); if (r < L.BIOMES.length) (riv[r] = riv[r] || []).push(p); }
    L.BIOMES.forEach((b, r) => {
      const x = regionInfo(r, base, reached), p = pos[r], mx = p.x - MED_W / 2, my = p.y - MED_H / 2 - 8, k = MED_W / MAP_W;
      s += '<g class="wmed' + (x.known ? ' known' : ' fog') + (r === curR ? ' cur' : '') + '" data-region="' + r + '" tabindex="0" role="button" aria-label="' + esc((x.known ? b.name : 'Unexplored region') + ', floors ' + x.first + ' to ' + x.last) + '">';
      if (r === curR) s += '<ellipse cx="' + p.x + '" cy="' + (p.y - 8) + '" rx="' + (MED_W * 0.66) + '" ry="' + (MED_H * 0.95) + '" fill="url(#mglow)" opacity=".5" class="pulse"/>';
      s += '<g transform="translate(' + mx + ' ' + my + ') scale(' + k + ')"><g clip-path="url(#mc' + r + ')"><rect width="' + MAP_W + '" height="' + BAND + '" fill="url(#mg' + r + ')"/>' + (x.known ? scenery(r, 0, b.accent) : '<rect width="' + MAP_W + '" height="' + BAND + '" fill="url(#mfog)"/><text x="180" y="104" class="wq">?</text>') + '</g>' +
        '<rect class="wring" width="' + MAP_W + '" height="' + BAND + '" rx="46" fill="none" stroke="' + (x.known ? b.accent : '#3a3340') + '" stroke-width="' + (x.cleared ? 7 : 4) + '"/></g>';
      s += '<text x="' + p.x + '" y="' + (p.y + MED_H / 2 + 10) + '" class="wn" fill="' + (x.known ? b.accent : '#6b6375') + '">' + esc(x.known ? b.name : 'Unexplored') + '</text>';
      // ten floor pips, the last one is the guardian
      let pip = ''; for (let f = 0; f < 10; f++) { const on = f < x.floors, px = p.x - 45 + f * 10, py = p.y + MED_H / 2 + 22; pip += f === 9 ? '<path d="M' + px + ' ' + (py - 4.5) + 'l4.5 4.5l-4.5 4.5l-4.5 -4.5z" fill="' + (x.cleared ? b.accent : '#2b2530') + '" stroke="' + (x.known ? b.accent : '#3a3340') + '"/>' : '<circle cx="' + px + '" cy="' + py + '" r="2.6" fill="' + (on ? '#f5c242' : '#2b2530') + '"/>'; }
      s += pip;
      if (x.cleared) s += '<g transform="translate(' + (mx + MED_W - 6) + ' ' + (my + 6) + ')"><circle r="10" fill="#0b0a10" stroke="' + b.accent + '" stroke-width="1.5"/><path d="M-4.5 0l3 3.5l6 -7" stroke="' + b.accent + '" stroke-width="2" fill="none"/></g>';
      if (riv[r]) { const n = riv[r].length, col = (L.SIDES[riv[r][0].side] || L.SIDES.unsworn).color; s += '<g transform="translate(' + (mx + 4) + ' ' + (my + MED_H - 4) + ')"><title>' + esc(riv[r].map(q => q.name).join(', ')) + '</title><circle r="9" fill="#0b0a10" stroke="' + col + '" stroke-width="1.5"/><text y="3.5" class="wr">' + n + '</text></g>'; }
      if (r === curR) s += '<g class="youhere"><path d="M' + p.x + ' ' + (my - 4) + 'l-8 -13h16z" fill="#f5c242" stroke="#1a120b"/><text x="' + p.x + '" y="' + (my - 22) + '" class="wy">' + esc(me || 'You') + ' · floor ' + cur + '</text></g>';
      s += '</g>';
    });
    return s + '</svg>';
  }
  // ---- region view: one region up close, its ten floors along a trail ----
  function regionSvg(r, base, reached, cur, aspect) {
    const x = regionInfo(r, base, reached), b = x.b, me = S.hero && S.hero.name;
    const RV_H = Math.round(Math.max(190, Math.min(560, MAP_W * aspect))), mid = Math.round(RV_H * 0.52);
    const node = i => ({ x: Math.round(28 + i * 33.8), y: Math.round(mid + Math.sin(i * 1.25 + r) * 22 + (i % 2 ? 14 : 0) - 8) });
    let s = '<svg class="regionmap" viewBox="0 0 ' + MAP_W + ' ' + RV_H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(x.known ? b.name : 'Unexplored region') + '"><defs><linearGradient id="mg' + r + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + b.bg[0] + '"/><stop offset="1" stop-color="' + b.bg[1] + '"/></linearGradient>' +
      '<radialGradient id="mglow"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".9"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient><pattern id="mfog" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#0b0a10"/><path d="M0 12L12 0" stroke="#17141e" stroke-width="2"/></pattern></defs>';
    s += '<rect width="' + MAP_W + '" height="' + RV_H + '" fill="url(#mg' + r + ')"/>';
    if (x.known) {
      // hanging rock along the ceiling, then the region's scenery along the floor
      const R = mrand(r * 31 + 5); let cl = 'M0 0'; for (let cx = 0; cx <= MAP_W; cx += 12) cl += 'L' + cx + ' ' + Math.round(4 + R() * (cx % 36 ? 10 : 26 + R() * 30));
      s += '<path d="' + cl + 'L' + MAP_W + ' 0z" fill="rgba(0,0,0,.5)"/>';
      s += '<text x="' + MAP_W / 2 + '" y="' + Math.round(RV_H * 0.24) + '" class="rbig" fill="' + b.accent + '">' + esc(b.name) + '</text>';
      s += '<g transform="translate(0 ' + (RV_H - BAND) + ')">' + scenery(r, 0, b.accent).replace(/<path d="M0 0L[^"]*" fill="rgba\(0,0,0,.55\)"\/>$/, '') + '</g>';
    } else s += '<rect width="' + MAP_W + '" height="' + RV_H + '" fill="url(#mfog)"/>';
    const pts = Array.from({ length: 10 }, (_, i) => Object.assign({ f: x.first + i }, node(i)));
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join('');
    s += '<path d="' + d + '" stroke="#000" stroke-opacity=".6" stroke-width="7" fill="none" stroke-linejoin="round"/><path d="' + d + '" stroke="#3a3024" stroke-width="2.5" fill="none" stroke-linejoin="round"/>';
    const k = Math.min(9, reached - x.first); if (k >= 0) s += '<path d="' + pts.slice(0, k + 1).map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join('') + '" stroke="#f5c242" stroke-width="2.4" stroke-dasharray="1 4" stroke-linecap="round" fill="none" class="march"/>';
    if (base === 0) for (const bt of L.STORY.filter(q => S.story.seen[q.id] && q.id !== 'intro')) { const f = storyFloor(bt); if (f < x.first || f > x.last) continue; const p = pts[f - x.first]; s += '<g class="mbeat" data-scene="' + bt.id + '"><title>' + esc('Chapter ' + bt.ch + ': ' + bt.title) + '</title><path d="M' + (p.x + 8) + ' ' + (p.y - 6) + 'v-4" stroke="#f5c242"/><circle cx="' + (p.x + 8) + '" cy="' + (p.y - 16) + '" r="7" fill="#1b140d" stroke="#f5c242" stroke-width="1.4"/><text x="' + (p.x + 8) + '" y="' + (p.y - 13) + '" class="mb">' + bt.ch + '</text></g>'; }
    for (const p of pts) {
      const boss = L.isBossFloor(p.f), big = p.f === x.last, ok = p.f <= reached, here = p.f === cur, rr = big ? 10 : boss ? 6.5 : 4.4, dd = rr + 5;
      s += '<g class="mnode' + (ok ? ' ok' : '') + (here ? ' here' : '') + '" data-floor="' + p.f + '"><title>' + (big ? b.boss + ', floor ' + p.f : boss ? 'Guardian, floor ' + p.f : 'Floor ' + p.f) + (ok ? '. Tap to travel.' : ' (not reached)') + '</title>' +
        (here ? '<circle cx="' + p.x + '" cy="' + p.y + '" r="18" fill="url(#mglow)" class="pulse"/>' : '') + '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (rr + 7) + '" fill="transparent"/>' +
        (big ? '<path d="M' + p.x + ' ' + (p.y - dd) + 'l' + dd + ' ' + dd + 'l-' + dd + ' ' + dd + 'l-' + dd + ' -' + dd + 'z" fill="rgba(4,7,13,.8)" stroke="' + (ok ? b.accent : '#3a3340') + '" stroke-width="1.5"/>' : '') +
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + rr + '" fill="' + (ok ? (boss ? b.accent : '#e9c98a') : '#2b241c') + '" stroke="rgba(0,0,0,.7)" stroke-width="1.2"/>' +
        (big ? (ok && p.f < reached ? '<path d="M' + (p.x - 4) + ' ' + p.y + 'l3 4l6 -8" stroke="#1a120b" stroke-width="2.2" fill="none"/>' : '<path d="M' + (p.x - 4) + ' ' + (p.y - 4) + 'l8 8M' + (p.x + 4) + ' ' + (p.y - 4) + 'l-8 8" stroke="' + (ok ? '#1a120b' : '#6b6375') + '" stroke-width="2"/>') : '') +
        '<text x="' + p.x + '" y="' + (p.y + (big ? 28 : 16)) + '" class="rf">' + (big && x.known ? esc(b.boss) : p.f) + '</text></g>';
    }
    const seen = {};
    for (const q of rivals || []) {
      if (q.name === me || q.floor < x.first || q.floor > x.last) continue; const p = pts[q.floor - x.first], st = seen[q.floor] = (seen[q.floor] || 0) + 1; if (st > 2) continue;
      const col = (L.SIDES[q.side] || L.SIDES.unsworn).color; s += '<g><title>' + esc(q.name + ', power level ' + q.level + ', deepest floor ' + q.floor) + '</title><circle cx="' + (p.x - 9 - (st - 1) * 8) + '" cy="' + (p.y - 13) + '" r="4" fill="' + col + '" stroke="#04070d" stroke-width="1.3"/></g>';
    }
    if (cur >= x.first && cur <= x.last) { const p = pts[cur - x.first]; s += '<g class="youhere"><path d="M' + p.x + ' ' + (p.y - 13) + 'l-6 -11h12z" fill="#f5c242" stroke="#1a120b"/><text x="' + p.x + '" y="' + (p.y - 28) + '" class="mh">' + esc(me || 'You') + '</text></g>'; }
    return s + '</svg>';
  }
  // ---------- the Hold (v102): tap the Hold on the map to see its tents and travel to one ----------
  const HOLD_TENTS = [
    ['camp', 'Campfire', 'lantern', '#e0702a', 'Rest, heal and change gear'],
    ['ench', 'Enchanter', 'enchanter', '#7c4dea', 'Enchant and disenchant'],
    ['arm', 'Armorer', 'armorer', '#9aa3b2', 'Upgrade, merge, melt'],
    ['store', 'Store', 'healer', '#2f9e63', 'Tonics, oil, draughts'],
  ];
  function drawHold(cv) {
    const cw = cv.clientWidth || 600, ch = cv.clientHeight || 280, dpr = window.devicePixelRatio || 1, W2 = 360, H2 = Math.round(W2 * ch / cw), k = cw * dpr / W2;
    cv.width = Math.round(W2 * k); cv.height = Math.round(H2 * k); const x = cv.getContext('2d'); x.setTransform(k, 0, 0, k, 0, 0); x.imageSmoothingQuality = 'high';
    let g = x.createLinearGradient(0, 0, 0, H2); g.addColorStop(0, '#0b1230'); g.addColorStop(0.55, '#1a1a2e'); g.addColorStop(1, '#2a2218'); x.fillStyle = g; x.fillRect(0, 0, W2, H2);
    for (let i = 0; i < 60; i++) { x.fillStyle = 'rgba(255,255,255,' + (0.3 + (i % 5) / 10) + ')'; x.fillRect((i * 97) % W2, (i * 53) % 46, 0.8, 0.8); }
    const gy = H2 * 0.42;
    x.fillStyle = '#1e2030'; x.fillRect(0, gy - 36, W2, 40); for (let i = 0; i < W2; i += 14) x.fillRect(i, gy - 42, 8, 8);
    [[40, 24], [300, 22], [166, 28]].forEach(([tx, tw]) => { const ty = gy - 70; x.fillStyle = '#262a3e'; x.fillRect(tx, ty, tw, 72); for (let i = 0; i < tw; i += 8) x.fillRect(tx + i, ty - 6, 5, 6); x.fillStyle = 'rgba(255,200,110,.7)'; x.fillRect(tx + tw / 2 - 2, ty + 14, 4, 7); });
    g = x.createLinearGradient(0, gy, 0, H2); g.addColorStop(0, '#3a3024'); g.addColorStop(1, '#1a140e'); x.fillStyle = g; x.fillRect(0, gy, W2, H2 - gy);
    const ty = gy + (H2 - gy) * 0.42;
    x.fillStyle = '#5a4a36'; x.beginPath(); x.ellipse(W2 / 2, ty + 20, 160, 12, 0, 0, Math.PI * 2); x.fill();
    HOLD_TENTS.forEach(([id, n, who, col], i) => {
      const tx = 48 + i * 88;
      if (id === 'camp') { x.fillStyle = '#3a2618'; x.fillRect(tx - 10, ty - 2, 20, 3); for (let q = 0; q < 4; q++) flame(x, tx - 6 + q * 4, ty - 2, 10 + (q % 2) * 4, 0); const gg = x.createRadialGradient(tx, ty - 8, 0, tx, ty - 8, 40); gg.addColorStop(0, 'rgba(255,150,60,.4)'); gg.addColorStop(1, 'rgba(255,150,60,0)'); x.fillStyle = gg; x.fillRect(tx - 40, ty - 48, 80, 80); return; }
      x.fillStyle = col; x.globalAlpha = 0.92; x.beginPath(); x.moveTo(tx - 28, ty); x.lineTo(tx, ty - 44); x.lineTo(tx + 28, ty); x.fill(); x.globalAlpha = 1;
      x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.moveTo(tx, ty - 44); x.lineTo(tx + 28, ty); x.lineTo(tx + 6, ty); x.fill();
      x.fillStyle = '#1a120a'; x.beginPath(); x.moveTo(tx - 9, ty); x.lineTo(tx, ty - 20); x.lineTo(tx + 9, ty); x.fill();
      x.strokeStyle = '#2a1a0e'; x.lineWidth = 1; x.beginPath(); x.moveTo(tx, ty - 44); x.lineTo(tx, ty - 52); x.stroke(); x.fillStyle = col; x.fillRect(tx, ty - 52, 8, 4);
      const s = sprite(who, 0, false), sw = s.lw * 2, sh = s.lh * 2; x.save(); x.translate(tx + 24, 0); x.scale(-1, 1); x.drawImage(s, -sw / 2, ty + 3 - sh, sw, sh); x.restore();
    });
    const party = S.party.filter(Boolean);
    party.forEach((id, i) => { const m = L.memberById(id); if (!m) return; const s = sprite(m.cls, lookHue(m), false); x.drawImage(s, W2 / 2 - party.length * 9 + i * 18 - 3, ty + 4 - (i % 2) * 3, s.lw * 2, s.lh * 2); });
    return { ty: ty / H2, xs: HOLD_TENTS.map((_, i) => (48 + i * 88) / W2) };
  }
  function openHold() {
    modal('<div class="maphead"><div><h2>The Hold</h2><small>Iron Covenant fortress above the tear. Tap a tent to go there. Your dive on floor ' + S.floor + ' waits for you.</small></div><button class="iconbtn" id="hold-x" aria-label="Close">&times;</button></div>' +
      '<div class="holdview"><canvas id="holdcv"></canvas><div class="holdtents">' + HOLD_TENTS.map(([id, n, , , sub]) => '<button data-hold="' + id + '"><b>' + n + '</b><small>' + sub + '</small></button>').join('') + '</div></div>' +
      '<div class="row"><button class="btn ghost" id="hold-map">&larr; Map of the Deep</button></div>', md => {
        md.classList.add('holdsheet');
        const cv = $('holdcv'); requestAnimationFrame(() => drawHold(cv));
        md.querySelector('#hold-x').onclick = closeModal; md.querySelector('#hold-map').onclick = openMap;
        md.querySelectorAll('[data-hold]').forEach(b => b.onclick = () => {
          const k = b.dataset.hold; closeModal();
          if (k === 'camp') { if (S.floor > L.CAMP_FLOOR) campModal(); } else if (k === 'ench') enchanterModal(); else if (k === 'arm') armorerModal(); else openStore();
        });
      });
  }
  function openMap() {
    const cyc = L.depthCycle(S.floor), base = cyc * 10 * L.BIOMES.length;
    const reached = S.maxFloor, cur = S.floor, n = L.BIOMES.length;
    const depthName = cyc ? ' · Depth ' + ROMAN[Math.min(cyc, 7)] : '';
    let view = -1;
    modal('<div class="maphead"><div><h2 id="map-title">The Lantern Deep' + depthName + '</h2><small id="map-sub"></small></div><button class="iconbtn" id="map-x" aria-label="Close map">&times;</button></div>' +
      '<div class="mapstrip" id="mapstrip"></div><div class="mapbody" id="mapbody"><div class="mapstage" id="mapstage"></div><aside class="mapdos" id="mapdos"></aside></div>', md => {
        md.classList.add('mapsheet');
        const stage = $('mapstage'), dos = $('mapdos');
        const portrait = () => stage.clientWidth / Math.max(1, stage.clientHeight) < 1.05;
        const strip = () => {
          const regs = L.BIOMES.map((_, r) => regionInfo(r, base, reached)), sealed = !L.actTwoOpen(), days = Math.max(0, Math.ceil((L.ACT_TWO_AT - Date.now()) / 864e5));
          const ch = L.STORY.filter(q => S.story.seen[q.id] && q.id !== 'intro').length, chT = L.STORY.filter(q => q.id !== 'intro').length;
          return '<div><small>Regions charted</small><b>' + regs.filter(q => q.known).length + '/' + n + '</b></div><div><small>Guardians felled</small><b>' + regs.filter(q => q.cleared).length + '</b></div><div><small>Chapters</small><b>' + ch + '/' + chT + '</b></div><div><small>Deepest floor</small><b>' + reached + '</b></div>' +
            (sealed ? '<div class="seal"><small>Act Two opens</small><b>' + days + ' day' + (days === 1 ? '' : 's') + '</b></div>' : '');
        };
        const showWorld = () => {
          view = -1; $('mapbody').classList.add('wide'); $('mapstrip').hidden = false; $('mapstrip').innerHTML = strip();
          $('map-title').textContent = 'The Lantern Deep' + depthName;
          $('map-sub').innerHTML = 'Fifteen regions between the Hold and the Nyx Rift. Tap a region to look closer.';
          stage.innerHTML = '<div class="mapview world">' + worldSvg(worldLayout(portrait()), base, reached, cur) + '</div>';
          dos.innerHTML = overview(base, reached);
        };
        const showRegion = r => {
          view = r; mapRegion = r; $('mapbody').classList.remove('wide'); $('mapstrip').hidden = true;
          const x = regionInfo(r, base, reached);
          $('map-title').textContent = x.known ? x.b.name : 'Unexplored';
          $('map-sub').innerHTML = 'Region ' + (r + 1) + ' of ' + n + ' · floors ' + x.first + '–' + x.last + (x.known ? '. Tap a lit floor to travel there.' : '.');
          stage.innerHTML = '<div class="mapview region"><div class="rvnav"><button class="btn small ghost" data-world>&larr; World map</button><span><button class="iconbtn" data-step="-1" aria-label="Previous region"' + (r ? '' : ' disabled') + '>&lsaquo;</button><button class="iconbtn" data-step="1" aria-label="Next region"' + (r < n - 1 ? '' : ' disabled') + '>&rsaquo;</button></span></div><div class="rvart"></div></div>';
          const art = stage.querySelector('.rvart'); art.innerHTML = regionSvg(r, base, reached, cur, art.clientHeight / Math.max(1, art.clientWidth));
          dos.innerHTML = dossier(r, base, reached); dos.scrollTop = 0;
        };
        const travel = f => { if (f !== S.floor && !gateUse('map')) return; closeMap(); if (f !== S.floor) { L.gotoFloor(S, f); S.autoAdvance = f >= S.maxFloor; updateStage(); toast('map', 'Travelled to floor ' + f, L.biomeOf(f).name + (f < S.maxFloor ? '. Descend automatically is off so you stay here. Turn it back on to push deeper.' : '.'), ''); } };
        const scene = id => { const b = L.STORY.find(q => q.id === id); closeMap(); if (b) playScene(b, true); };
        md.querySelector('#map-x').onclick = closeMap;
        stage.onclick = e => {
          if (e.target.closest('[data-world]')) { showWorld(); return; }
          const st = e.target.closest('[data-step]'); if (st) { showRegion(Math.max(0, Math.min(n - 1, view + +st.dataset.step))); return; }
          const bt = e.target.closest('.mbeat'); if (bt) { scene(bt.dataset.scene); return; }
          const g = e.target.closest('.mnode.ok'); if (g) { travel(+g.dataset.floor); return; }
          const m = e.target.closest('.wmed'); if (m) showRegion(+m.dataset.region);
        };
        stage.onkeydown = e => { const m = e.target.closest && e.target.closest('.wmed'); if (m && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showRegion(+m.dataset.region); } };
        dos.onclick = e => {
          const go = e.target.closest('[data-go]'); if (go) { travel(+go.dataset.go); return; }
          const sb = e.target.closest('[data-scene]'); if (sb) scene(sb.dataset.scene);
        };
        md.onkeydown = e => { if (view < 0) return; if (e.key === 'ArrowLeft' && view > 0) showRegion(view - 1); else if (e.key === 'ArrowRight' && view < n - 1) showRegion(view + 1); else if (e.key === 'Backspace') showWorld(); };
        let rz; const onRz = () => { if ($('modal').hidden || !md.classList.contains('mapsheet')) { window.removeEventListener('resize', onRz); return; } clearTimeout(rz); rz = setTimeout(() => { view < 0 ? showWorld() : showRegion(view); }, 150); };
        window.addEventListener('resize', onRz);
        showWorld();
        // rival delvers arrive a moment later from the leaderboard
        if (CL && Date.now() - rivalsAt > 180000) loadRivals().then(() => { if ($('modal').hidden || !md.classList.contains('mapsheet') || !rivals || !rivals.length) return; view < 0 ? showWorld() : showRegion(view); });
      });
  }
  function closeMap() { $('modalbody').classList.remove('mapsheet'); closeModal(); }
  $('btn-map').addEventListener('click', openMap);

  // ---------- updates ----------
  // version.json is stamped on every release. The web host's cache ignores query strings and keeps each file for up
  // to 10 minutes, so a reload right after a release can hand back the old page. Instead the game waits until every
  // file it needs carries the new build's marker, then saves, counts down and reloads by itself. Players never have
  // to press anything, and an older or half-cached version.json never triggers a reload.
  let updating = false, checking = false, upTimer = 0;
  const newer = b => /^\d{12}$/.test(b || '') && /^\d{12}$/.test(window.LH_BUILD || '') && b > window.LH_BUILD;
  // Read just the start of a file and look for the build marker.
  async function hasMark(f, b) {
    const r = await fetch(f + (f.indexOf('?') < 0 ? '?' : '&') + 'fresh=' + Date.now().toString(36), { cache: 'no-store' });
    if (!r.ok) return false;
    let head = '';
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader(), dec = new TextDecoder();
      while (head.length < 400) { const c = await rd.read(); if (c.done) break; head += dec.decode(c.value, { stream: true }); }
      try { rd.cancel(); } catch (e) {}
    } else head = (await r.text()).slice(0, 400);
    return head.indexOf('lh-build ' + b) >= 0;
  }
  async function allFresh(b) {
    for (const f of ['./', 'ui.js', 'core.js', 'sprites.js', 'vector.js', 'music.js', 'intro.js', 'style.css']) if (!(await hasMark(f, b))) return false;
    return true;
  }
  async function loadBuild(b) {
    try { save(); } catch (e) {}
    try { if (typeof pushCloud === 'function' && signedIn()) await Promise.race([pushCloud(true), new Promise(r => setTimeout(r, 4000))]); } catch (e) {}
    // A new address keeps the browser from reusing its own cached copy of the page.
    location.replace(location.pathname + '?u=' + encodeURIComponent(b || '') + '&t=' + Date.now().toString(36) + location.hash);
  }
  function countdown(b) {
    updating = true;
    let n = 10;
    modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Updating Lanternhold</h2><p>A new version is out. Your progress is saved, and the game reloads in <b id="up-n">' + n + '</b> seconds.</p><div class="row" style="justify-content:center"><button class="btn" id="up-now">Update now</button></div></div>', md => {
      md.querySelector('#up-now').onclick = () => loadBuild(b);
    });
    const t = setInterval(() => { n--; const e = $('up-n'); if (e) e.textContent = Math.max(0, n); if (n <= 0) { clearInterval(t); loadBuild(b); } }, 1000);
  }
  async function checkUpdate() {
    if (!window.LH_BUILD || updating || checking) return;
    clearTimeout(upTimer); checking = true;
    let wait = 120000;
    try {
      const j = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json();
      if (newer(j.build)) {
        window.LH_NEXT = j.build; wait = 20000;
        const tried = new URLSearchParams(location.search).get('u') === j.build;
        let n = 0; if (tried) try { n = +sessionStorage.getItem('lh_upretry') || 0; } catch (e) {}
        if (n >= 3) { $('btn-update').hidden = false; wait = 120000; }
        else if (await allFresh(j.build) && !(S.wb && S.wb.until > Date.now())) {
          if (tried) try { sessionStorage.setItem('lh_upretry', String(n + 1)); } catch (e) {}
          checking = false; countdown(j.build); return;
        }
      }
    } catch (e) {}
    checking = false;
    upTimer = setTimeout(checkUpdate, wait);
  }
  $('btn-update').addEventListener('click', () => { try { sessionStorage.removeItem('lh_upretry'); } catch (e) {} loadBuild(window.LH_NEXT || ''); });
  try {
    if (new URLSearchParams(location.search).get('u') === window.LH_BUILD) {
      sessionStorage.removeItem('lh_upretry');
      // Tidy the address bar after an update so a bookmark or a shared link stays clean.
      history.replaceState(null, '', location.pathname + location.hash);
    }
  } catch (e) {}
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  upTimer = setTimeout(checkUpdate, 15000);

  // ---------- tutorial (coach marks) and the Guide ----------
  // Steps show one at a time, point at the real control, and wait for the player to do the thing.
  const sumLevels = () => Object.keys(S.levels).reduce((a, k) => a + (S.levels[k] || 0), 0);
  const TUT = [
    { id: 'strike', title: 'Strike!', text: 'Tap the monster to hit it yourself. Your party fights on its own too, but every tap helps. Try a few.', target: '#arena', tab: null, ready: () => true, done: c => S.stats.clicks >= c.clicks + 5, noNext: true },
    { id: 'gold', title: 'Gold', text: 'Every monster drops gold, even while you are away. Gold is how your party grows stronger.', target: '.stat.gold', ready: () => true },
    { id: 'train', title: 'Train your party', text: 'Spend gold to train. Higher levels mean more damage, health and healing. You can train anyone in your party anywhere, even deep in the dungeon.', target: '#seats .buy:not([disabled])', tab: 'party', ready: () => S.gold >= 10, done: c => sumLevels() > c.levels, noNext: true },
    { id: 'abil', title: 'Abilities', text: 'Each class has a special move. They fire by themselves, or press keys 1 to 5 (or tap them) to use one right when you need it.', target: '#abilities', ready: () => true },
    { id: 'order', title: 'Marching order', text: 'The top of this list stands at the front. Keep your tank up front, healers in the middle so they reach everyone, and watch the back for ambushes.', target: '.formhead', tab: 'party', ready: () => S.party.filter(Boolean).length >= 2 },
    { id: 'boss', title: 'Guardians', text: 'Every fifth floor has a guardian. Beat it before the lantern oil runs out, or your party falls back to train and try again.', target: '#lanternwrap', ready: () => S.foe && S.foe.boss },
    { id: 'gear', title: 'You found gear', text: 'Monsters drop weapons, armor, trinkets and rings. Open Gear to see them. You change gear at the main camp on floor 1, or anywhere with a Campfire Draught. A green arrow marks an upgrade.', target: '.tabs [data-tab="gear"]', ready: () => S.bag.length > 0, done: () => tab === 'gear', noNext: true },
    { id: 'camp', title: 'Camp', text: 'The main camp on floor 1 is where you swap companions and train them; going back restarts you at the top of the region. A Campfire Draught from the Store lets you change gear right where you are.', target: '#campbar', tab: 'party', ready: () => S.floor > 1 && S.maxFloorEver >= 4 },
    { id: 'traits', title: 'Companion traits', text: 'Each companion has three traits: one for a party seat, one for a class they like fighting beside, and one for resting at camp. Working traits glow gold, so try moving people around.', target: '#seats .traits', tab: 'party', ready: () => S.unlocked.length >= 3 && !!document.querySelector('#seats .traits') },
    { id: 'map', title: 'Map of the Deep', text: 'See how far you have come, which guardians you have beaten, and travel back to any floor you have reached.', target: '#btn-map', ready: () => S.maxFloorEver >= 8 },
    { id: 'stats', title: 'Your character', text: 'Your hero earns XP from every fight. Each level brings a stat point. Open Skills and spend it on Strength, Wisdom, Luck and the rest. Your class favours two of them.', target: '.tabs [data-tab="rekindle"]', ready: () => !!S.hero && L.heroPoints(S) > 0 },
    { id: 'end', title: 'You are ready', text: 'That is the basics. The story will introduce new companions as you descend. Open the Guide (the ? at the top) any time for the details.', target: '#btn-guide', ready: () => true },
  ];
  let coachCtx = null, coachEl = null;
  function tutState() { if (!S.tut) { S.tut = { i: 0, done: false }; S.seenNotes = NOTES_V; } return S.tut; }
  function coachHide() { $('coach').hidden = true; if (coachEl) coachEl.classList.remove('tut-hi'); coachEl = null; }
  function coachShow(step, i) {
    if (step.tab && tab !== step.tab) switchTab(step.tab);
    const el = document.querySelector(step.target);
    if (!el || !el.offsetParent) { coachHide(); return; }
    if (coachEl !== el) {
      if (coachEl) coachEl.classList.remove('tut-hi'); coachEl = el; el.classList.add('tut-hi');
      const r0 = el.getBoundingClientRect(), roomBottom = innerWidth <= 720 ? innerHeight - 190 : innerHeight - 20;
      if (r0.top < 60 || r0.bottom > roomBottom) el.scrollIntoView({ block: innerWidth <= 720 ? 'start' : 'center', behavior: 'smooth' });
    }
    $('coachstep').textContent = 'Tutorial ' + (i + 1) + ' of ' + TUT.length;
    $('coachtitle').textContent = step.title; $('coachtext').textContent = step.text;
    $('coachnext').hidden = !!step.noNext; $('coachnext').textContent = i === TUT.length - 1 ? 'Got it' : 'Next';
    const c = $('coach'); c.hidden = false;
    if (innerWidth <= 720) { c.style.left = '12px'; c.style.right = '12px'; c.style.top = 'auto'; c.style.bottom = '12px'; c.classList.remove('up'); return; }
    const r = el.getBoundingClientRect(), cw = c.offsetWidth, ch = c.offsetHeight;
    let top = r.bottom + 14, up = false;
    if (top + ch > innerHeight - 10) { top = r.top - ch - 14; up = true; }
    const left = Math.max(10, Math.min(innerWidth - cw - 10, r.left + r.width / 2 - cw / 2));
    c.style.left = left + 'px'; c.style.top = Math.max(10, top) + 'px'; c.style.right = 'auto'; c.style.bottom = 'auto';
    c.style.setProperty('--ax', Math.max(16, Math.min(cw - 16, r.left + r.width / 2 - left)) + 'px'); c.classList.toggle('up', up);
  }
  function coachTick() {
    const st = tutState();
    if (st.done || !S.hero || !$('modal').hidden || sceneOpen) { coachHide(); return; }
    const step = TUT[st.i]; if (!step) { st.done = true; coachHide(); return; }
    if (!coachCtx || coachCtx.i !== st.i) { if (!step.ready()) { coachHide(); return; } coachCtx = { i: st.i, clicks: S.stats.clicks, levels: sumLevels() }; }
    if (step.done && step.done(coachCtx)) { coachAdvance(); return; }
    coachShow(step, st.i);
  }
  function coachAdvance() { const st = tutState(); st.i++; coachCtx = null; coachHide(); if (st.i >= TUT.length) { st.done = true; save(); } setTimeout(coachTick, 400); }
  $('coachnext').addEventListener('click', coachAdvance);
  $('coachskip').addEventListener('click', () => { const st = tutState(); st.done = true; coachHide(); save(); toast('book', 'Tutorial skipped', 'Open the Guide (the ? at the top) whenever you want a refresher.', ''); });
  // Veterans who loaded an existing save skip straight past the tutorial.
  if (S.hero && !S.tut && S.maxFloorEver > 10) S.tut = { i: TUT.length, done: true };
  setInterval(coachTick, 600);
  window.addEventListener('resize', () => { if (!$('coach').hidden) coachTick(); });

  // ---------- the Guide: categories on the left, short topic cards with a picture on the right ----------
  // Topic: [title, picture, one-line summary, [points...]]. Picture: 's:<sprite>' (one or more, comma separated) or 'i:<icon>'.
  const GUIDE = [
    { id: 'start', name: 'Getting started', icon: 'lantern', topics: [
      ['The basics', 's:tank,healer,slime', 'Your party fights on its own. You tap to help, and spend gold to get stronger.', [
        'Tap the arena (or press <b>Space</b>) to strike.',
        'Each tap hits for <b>1 + 5% of your party damage per second</b>. The Grim Whetstone relic adds 25% per level, and a critical hit does 5x. Hover the <b>i</b> in the arena corner to see your tap damage.',
        'Each floor has <b>8 monsters</b>. Clear them to go deeper.',
        'Monsters drop <b>gold</b>. Spend it to <b>train</b> your party in the Party tab. Training raises a character\'s <b>power level</b>.',
        'Every <b>25 power levels</b> a character gets a big power jump.']],
      ['Power level and hero level', 'i:star', 'Two different levels. Power level is how strong each fighter is; hero level is how far your own hero has come.', [
        '<b>Power level</b>: every character in your party has one, your hero included. Raise it with gold (<b>Train</b> on the Party tab). It sets damage and health, and gear needs a power level to wear. Rekindling resets it.',
        '<b>Hero level</b>: your own hero\'s experience level, from fighting. It gives stat points and opens new parts of the game. It is never reset.',
        'So a hero can be hero level 11 and power level 142 at the same time. Your Party card shows power level; the Skills tab and Codex show hero level.']],
      ['Hero level and unlocks', 'i:star', 'New parts of the game open as your hero levels up. Codex, Progress shows the whole road.', [
        'Level <b>3</b>: Gear. <b>5</b>: the Campfire. <b>8</b>: map travel and buying on the Market. <b>10</b>: camp jobs.',
        '<b>12</b>: the Players Guild. <b>15</b>: the Ember Ring. <b>18</b>: selling and the Sigil exchange. <b>20</b>: rekindling. <b>25</b>: world boss and job sets.',
        'Hero XP grows with depth, and guardians give the most.']],
      ['Region trials', 'i:map', 'Each region has a trial that opens the way to the next one.', [
        'Defeat <b>' + L.TRIAL_ELITES + ' alliance elites</b> in the region (the bannered warband foes) and beat its <b>guardian</b>.',
        'Until then your party keeps working the region it is in. Codex, Progress shows how far along you are.']],
      ['Region mastery', 'i:map', 'Every region has three goals. Each one finished is +1% for good.', [
        '<b>Guardian</b>: beat the region\'s last guardian (+1% damage).',
        '<b>Warbands</b>: defeat 20 alliance elites in the region (+1% health).',
        '<b>Relic gear</b>: find a piece of the region\'s set (+1% gold).',
        'Every goal also gives <b>+1% hero XP</b>, and finishing all three in a region gives <b>+2% more</b> (+5% hero XP per fully mastered region).']],
      ['While you are away', 'i:refresh', 'The game keeps earning when you close it.', [
        'You earn <b>a quarter</b> of your usual gold for up to <b>8 hours</b>.',
        '<b>Night Watch</b> (Skills tab) stretches that up to 3 days.',
        '<b>Lanternholder</b> adds 4 more hours.']],
      ['The side panel', 'i:map', 'Eight tabs, each with one job. Locked tabs show the hero level that opens them.', [
        '<b>Party</b>: who fights, and in what order.',
        '<b>Camp</b>: resting companions, camp jobs and training.',
        '<b>Gear</b>: dress your characters.',
        '<b>Skills</b>: your character sheet, skill tree and rekindling.',
        '<b>Market</b>: buy and sell gear, mail and the Sigil exchange.',
        '<b>Guild</b>: invite other players’ heroes into your party.',
        '<b>PvP</b>: the Ember Ring, duels against other players’ heroes.',
        '<b>Codex</b>: journal, relics, records and your progress.']],
      ['Why we fight, music and settings', 'i:lantern', 'The story opening, the soundtrack and your options.', [
        'The <b>Why we fight</b> opening plays on your first visit. Replay it any time from <b>Settings</b>.',
        'Lanternhold is free. Once the game’s costs are covered, the proceeds go to the Mercy Corps giving: children’s hospitals, food pantries and local schools.',
        'The <b>music button</b> in the top bar opens the player: eight original tracks, skip, shuffle, volume and mute.',
        '<b>Settings</b> (the gear button) holds sound, the tutorial and your save.']],
      ['Controls', 'i:help', 'Everything works with taps; keys are shortcuts.', [
        '<b>Tap, Space or Enter</b>: strike',
        '<b>1 to 5</b>: party abilities. <b>6 to 8</b>: your hero’s specializations.',
        '<b>Ctrl+click an item</b>: link it in chat',
        '<b>Arrows by the floor number</b>: move between floors you have reached']],
    ] },
    { id: 'party', name: 'Your party', icon: 'users', topics: [
      ['The five classes', 's:tank,healer,rogue,mage,necro', 'Five seats, five roles. Every class has its own ability.', [
        '<b>Tank</b>: takes the hits. Shield Wall cuts damage by 70%.',
        '<b>Healer</b>: keeps everyone up. Lantern Hymn heals and lifts a fallen ally.',
        '<b>Rogue</b>: most damage, dodges a quarter of attacks. Backstab hits hard.',
        '<b>Mage</b>: Ember Storm quadruples damage for a few seconds.',
        '<b>Necromancer</b>: raises skeletons that fight and soak blows.']],
      ['Marching order', 's:tank,rogue,healer,mage,necro', 'The top of the Party list stands in front, nearest the monster.', [
        'A <b>tank</b> in the front two draws attacks.',
        'Heals get <b>15% weaker per step</b> of distance, so healers go in the middle.',
        'Ambushers hit the <b>rear</b> first. A tank at the back guards it.',
        'Use the arrows, or <b>Auto-arrange</b>. Notes under the list rate your order.']],
      ['Companion traits', 's:healer,necro', 'Every story companion has three traits, rolled when they join. Working ones glow gold.', [
        '<b>Position trait</b>: works while they stand in one seat (for example <i>Vanguard: front seat, +8% party damage</i>).',
        '<b>Kinship trait</b>: works while a given class is in the party (for example <i>Bone-kin: with a necromancer, +6% party health</i>).',
        '<b>Camp trait</b>: works while they rest at the campfire: a better camp job, cheaper training, more gold or faster healing.',
        'Traits come in <b>Common</b>, <b>Fine</b> (blue) and <b>Rare</b> (purple). Arrange your party to switch on as many as you can.']],
      ['Campfire companions', 'i:flame', 'Story companions join as you go deeper and rest by the fire.', [
        '<b>Bring along</b> seats one. <b>To campfire</b> sends one back.',
        'Seat changes happen at <b>camp</b>.',
        'Companions are a little weaker than other players’ heroes.']],
      ['Players Guild', 'i:users', 'Fill seats with other players’ heroes. They are stronger than companions.', [
        'Sign in, open the <b>Guild</b> tab, press <b>Invite</b>.',
        'They <b>accept or decline</b>. Accepted heroes join at camp.',
        'Invites to <i>you</i> show at the top with <b>Accept</b> and <b>Decline</b>. Accepting lends a copy of your hero and earns you gold.',
        '<b>Dismiss</b> on a seat lets a hero go.']],
      ['Your banner', 'i:flare', 'Your hero flies one of five banners, each with a perk.', [
        'Iron Covenant <b>+15% health</b>. Radiant Ascendancy <b>+12% damage</b>. Devouring Tide <b>+15% gold</b>. Mercy Corps <b>+15% healing</b>. Unsworn <b>+5%</b> to all three.',
        '<b>Banner kin</b>: each party member under your banner makes the perk 40% stronger.']],
    ] },
    { id: 'fight', name: 'Combat', icon: 'sword', topics: [
      ['Monsters', 's:slime,rat,skeleton', 'Monsters hit back. If the whole party falls, it retreats a floor and tries again.', [
        'Retreats last about a minute. Use it to train and check gear.',
        '<b>Grand War soldiers</b> (with a banner) are tougher and drop more.']],
      ['Mana and stamina', 'i:flare', 'Healers, mages and necromancers use mana. Rogues and tanks use stamina.', [
        'The blue bar under a hero is <b>mana</b>, the gold bar is <b>stamina</b>. Both hold ' + L.RES_MAX + ' and refill on their own: mana at ' + L.RES_REGEN.mana + ' a second, stamina at ' + L.RES_REGEN.stamina + ' a second.',
        'Abilities cost ' + L.AB_COST + ' and class specials cost ' + L.SPEC_COST + '. If a hero is short, the ability waits until the bar refills.',
        'Healing costs mana. A healer that runs <b>out of mana</b> stops healing and only swings basic attacks until its mana is back to ' + L.RES_WAKE + '. Its bar blinks while it is empty.',
        '<b>Lantern Hymn</b> can be sung with any mana left, and uses up to ' + L.AB_COST + ', but never while the healer is out of mana. Resting at camp fills every bar.',
        'Faster regen comes from <b>Flow</b> enchants on the hero’s own gear, and for your hero from cooldown skills.',
        'Other gear stats for the wearer: <b>Leech</b> heals the hero for part of its damage, <b>Bulwark</b> gives a chance to block a hit outright, <b>Plating</b> cuts damage taken. A hero’s profile shows its totals.']],
      ['Burns, poison, stuns and disarms', 'i:flare', 'Some special attacks leave more than a bruise.', [
        '<b>Burning</b> hurts heroes in cloth (healers, mages and necromancers) twice as much. Tanks in plate take a quarter less.',
        '<b>Poison</b> bites everyone a quarter harder, except necromancers, who live with rot and take only a quarter of it.',
        'Burns and poison last ' + L.DOT_FIGHTS + ' fights. A healer\u2019s ability, Purify or the campfire clears them.',
        '<b>Stunned</b> heroes cannot attack, heal or use abilities for ' + L.CC.stun.sec + ' seconds. Ground Slam, Tidal Crash and Belly Flop stun.',
        '<b>Disarmed</b> heroes fight barehanded for ' + L.CC.disarm.sec + ' seconds: ' + Math.round(L.CC.disarm.dmg * 100) + '% damage, half healing and no abilities, until they grab their weapon back. Shield Charge and Disarming Lash disarm.',
        'Tanks shake off stuns and disarms twice as fast, and nothing stuns or disarms a tank behind Shield Wall. Dodging or blocking the hit avoids it too.']],
      ['Shielded foes', 'i:shield', 'Some monsters fight behind a shield. Tap them to break it.', [
        'From floor ' + L.SHIELD_FLOOR + ', some monsters and many guardians raise a pale blue shield. While it is up your party deals ' + Math.round(L.SHIELD_CUT * 100) + '% less damage.',
        'Every tap on the fight knocks about ' + Math.round(L.SHIELD_TAP * 100) + '% off the shield, and a critical tap twice that. About ' + Math.round(1 / L.SHIELD_TAP) + ' taps break it.',
        'If you are not tapping, the shield wears away on its own in about ' + L.SHIELD_DECAY.foe + ' seconds (' + L.SHIELD_DECAY.boss + ' for a guardian). Guardians raise it once more at half health.',
        'The health bar shows how much shield is left, and the bubble around the foe cracks as it weakens.']],
      ['Wandering merchant', 'i:coin', 'Now and then a merchant stops beside the fight with one deal at half price.', [
        'Only while you are playing, from floor ' + L.MERCH_FLOOR + '. The merchant stays ' + Math.round(L.MERCH_LIFE / 60) + ' minutes.',
        'Tap the merchant to see the deal: two tonics, Campfire Draughts or Lantern Oil, or a pile of Dust, all at ' + Math.round(L.MERCH_OFF * 100) + '% off.',
        'Buy it or let it go. Missing the merchant costs nothing.']],
      ['Bounty board', 'i:star', 'Three bounties at a time, new every ' + L.BOUNTY_HOURS + ' hours. Open it from the Quests button.', [
        'Bounties are built for your hero from the floors you have reached: hunt a kind of monster on certain floors, beat a guardian a few times, open chests, defeat alliance elites or break monster shields.',
        'Some send you back up to older floors. Tap <b>Go to floor</b> on a bounty to farm there (Descend automatically turns off).',
        'Each pays gold and Dust, sometimes a tonic too. Finished bounties you forget to claim are paid when the board changes.']],
      ['The Lantern Keeper', 'i:lantern', 'When the store owner is online, every hero gets a boost.', [
        'While the Lantern Keeper is online, every hero gets <b>+' + Math.round(L.KEEPER * 100) + '%</b> damage, healing, gold, hero XP and gear finds.',
        'A gold banner over the fight shows when it is on. It ends a couple of minutes after the Keeper leaves.']],
      ['Ghost Lantern', 'i:lantern', 'Now and then a Ghost Lantern drifts into the fight. Tap it to shatter it for a reward.', [
        'It only appears while you are playing (from floor ' + L.GHOST_FLOOR + '), never while you are away.',
        'While it floats there it slowly saps your party’s damage or healing, up to ' + Math.round(L.GHOST_MAX * 100) + '% at most. The tag under it shows how much and how long it has left.',
        'Tap it to shatter it: you get a burst of gold, some Dust or a free tonic, and the stat comes straight back.',
        'Leave it and it fades after ' + L.GHOST_LIFE + ' seconds. Nothing is lost for good.']],
      ['Guardians', 's:golem,wyrm,lich', 'Every 5th floor has a guardian. Beat it before the lantern oil runs out.', [
        'Guardians drop better gear and, from floor 10, sometimes a relic.',
        '<b>Lantern Oil</b> from the Store buys 15 more seconds.',
        'Act One ends with the Lampmother on floor <b>150</b>. Act Two opens with Grand War Season 2.']],
      ['Monster tricks', 's:eye,thorn', 'Deeper foes have tricks, shown as tags under their name.', [
        '<b>Enraged</b>: hits harder when hurt. <b>Warded</b>: a shield soaks damage first.',
        '<b>Regenerating</b>: heals over time. <b>Venomous</b>: poisons its target.',
        '<b>Cleaving</b>: also hits whoever stands behind. <b>Swift</b>: attacks faster.']],
      ['Special attacks', 's:wyrm,lich', 'Guardians, and some monsters past floor 8, wind up a big move every 10 seconds or so.', [
        'A red banner names it and a <b>red ring</b> shows who it will hit: the whole party, a hero and the ones beside them, or one marked spot in your line.',
        'Marked spots ignore your tank, so keep the back of the line healthy. Shields and a tank\u2019s guard still soften every hit.',
        '<b>Burns</b> and <b>poison</b> keep ticking for ' + L.DOT_FIGHTS + ' fights. The badge over a hero counts them down. A healer\u2019s ability, Purify or the campfire clears them.']],
      ['Ambushes', 's:hound,bat,riftling', 'Sometimes 2 to 4 monsters team up and jump the party.', [
        'Shown as <b>Ambush ×2</b> to <b>×4</b>. More health, harder hits, rear first.',
        'Pays several times the gold, better gear odds and extra XP. Luck makes it bigger.']],
      ['Loot Goblin', 's:goblin', 'A rare thief that turns up from floor 8. Kill it within 20 seconds.', [
        'It fights back. Strike fast and fire your abilities: idle damage alone barely gets there.',
        'If it escapes it steals one item from your pack and hides a few floors deeper. <b>Gear you wear is never taken.</b>',
        'A green note under the chapter goal shows where it hides. Reach that floor and kill it to get the item back.',
        'Every goblin you kill drops six times the gold.']],
      ['The Nexus Guardian', 's:sentinel', 'Answers a rhythm that never tires. Ease your strikes and it leaves.', [
        'Strikes that come too fast for too long, or with machine-even spacing, crack the back wall. Fast human tapping does not.',
        'If the wall breaks, the Guardian takes the stage. <b>Nothing lands on it</b>, and the foe behind it waits.',
        'Slow down for about three seconds and it withdraws. You lose nothing but the time.']],
      ['World boss weekends', 's:colossus', 'One giant Rift boss every weekend that all signed-in players fight together.', [
        'Runs Friday to Sunday (UTC). A purple bar on the stage shows it; tap it to join a <b>two-minute assault</b>, once every 15 minutes.',
        'Your damage counts at the strength of your deepest floor, so new and veteran delvers matter just as much.',
        'Everyone fills one shared health bar. Each phase broken makes the next one twice as tough.',
        'After the weekend tap <b>Claim</b>: 3 Sigils for taking part, 1 more per phase broken (up to 5), 5 more for the top three, and a purse of gold.']],
      ['Abilities', 'i:star', 'Each party member has one ability; your hero can learn more.', [
        'They fire by themselves. Turn that off under the arena to time them.',
        'Keys <b>1 to 5</b> use them; <b>6 to 8</b> are specializations from the skill tree.']],
    ] },
    { id: 'gear', name: 'Gear and loot', icon: 'gear-armor', topics: [
      ['Locking items', 'i:lock', 'Tap an item in your pack and choose Lock to protect it.', [
        'Locked items show a small padlock and are skipped by <b>Mass scrap</b>, auto-selling when your pack is full, and the <b>Loot Goblin</b>.',
        'You can still equip and upgrade a locked item. Unlock it to sell, send or salvage it.',
        'Lock a piece someone is wearing to hold it in that slot. Tap the slot and choose Lock. <b>Equip best</b> then skips that slot, and the slot shows a padlock.']],
      ['Merging items', 'i:relic', 'Merge two copies of the same item into one at +1.', [
        'Open an item and choose <b>Merge</b> when you own another copy. The result is one upgrade above the higher of the two, up to +' + L.UP_MAX + '.',
        '<b>Mass merge</b> in the Gear tab pairs up spare copies (never worn or locked ones) up to the level you pick, and shows the expected losses first.',
        'If the merge fails, <b>both pieces are destroyed</b>. Risk starts at 8% for +1 and climbs about 6% per level.',
        'Each point of <b>Luck</b> and <b>Intelligence</b> cuts that risk, up to half. Locked items cannot be merged.']],
      ['Enchantments', 'i:star', 'Sockets hold enchants that help your party or the hero who wears them.', [
        'Fine items have 1 socket, rare 2, epic 3 and set pieces 2. Items from floor 30 and floor 80 on get one more each, up to 4. Common items get sockets from floor 30.',
        'Enchants: <b>Might</b> (damage), <b>Vigor</b> (health), <b>Keen</b> (crits), <b>Fortune</b> (gold), <b>Finder</b> (gear drops), <b>Mending</b> (healing), <b>Warding</b> (less damage taken) and <b>Wick</b> (lantern time) help the whole party. Tiers run I to IX, higher from deeper floors.',
        'Four enchants help <b>only the hero wearing the item</b>: <b>Flow</b> (mana or stamina regen, up to +100%), <b>Leech</b> (life steal, up to 8%), <b>Bulwark</b> (block chance, up to 25%) and <b>Plating</b> (defense, up to 30% less damage). Rings and trinkets roll Flow and Leech more often, armor and shields roll Bulwark and Plating more often, and weapons roll Leech.',
        'Enchanting happens in <b>the Enchanter’s shop</b>. Press <b>Enchanter</b> on the battle screen, or Enchant on an item, and your party leaves the Deep for the shop. Pick Enchant an item, Disenchant or Scrap for Dust in the Enchanter’s speech bubble, then answer one question at a time in the counter below the scene: the item, the enchant, then confirm. <b>Leave shop</b> at the top takes you back to the same floor.',
        '<b>Disenchant</b> destroys an item and moves one of its enchants into a socket on another item of any class. A full socket can be overwritten. At the Enchanter you can enchant worn gear too.',
        'Moving an enchant costs <b>Dust</b>: 5 for tier I, 20 for II, 45 for III and so on (5 &times; tier&sup2;).',
        'Merging two items keeps the best enchants of both, as many as the result has sockets.']],
      ['Dust', 'i:dust', 'Scrap gear to get Dust for enchanting.', [
        'Every item you salvage or mass scrap gives Dust as well as gold. Rarer, deeper and upgraded pieces give more.',
        'Your Dust shows in the top bar. Rekindling keeps it.']],
      ['Region sets', 's:chest', 'Every region of the Deep has its own four-piece armor set.', [
        'Each region from the Lamplit Cellars to the Rift Threshold drops its own set: a helm, chest, legs and boots, made for whichever classes are in your party.',
        'Pieces only drop on that region’s floors, and rarely. Guardians are your best chance, then chests and elites. Plan on a long hunt for a full set.',
        'Two pieces give a bonus to one stat. Four pieces add a big damage and health bonus. Set bonuses multiply all of the wearer’s gear, so they stay strong after you rekindle and dive deeper.',
        'Deeper regions have stronger sets. Merging two copies of the same piece upgrades it, like any other gear.',
        'Region pieces are bound to your Hold and cannot be sold or sent. Auto-scrap never takes them.']],
      ['The Loot Goblin’s Sack', 'i:bag', 'A very rare brag item from the Loot Goblin.', [
        'Every Loot Goblin you kill has a tiny chance, about 1 in 2,000, to drop the Loot Goblin’s Sack: a trinket with +15% gold for your whole party.',
        'When one drops, the game tells Global chat so everyone knows. It is bound to your Hold and cannot be traded.']],
      ['Auto-scrap', 'i:dust', 'Scrap low drops the moment they are found.', [
        'Open <b>Auto-scrap</b> in the Gear tab pack view and tick the rarities you never want to keep. New drops of those rarities turn straight into gold and Dust.',
        'Set pieces, job set pieces and anything that beats what a companion wears are always kept, unless you tick <b>Scrap upgrades too</b>.',
        'It only touches new drops, never what is already in your pack. The fight log lists every piece it scraps.']],
      ['Mass scrap and Mass sell', 'i:coin', 'Clear out your pack in one go from Bulk actions in the Gear tab.', [
        '<b>Mass scrap</b> turns the rarities you tick into gold right away.',
        '<b>Mass sell</b> lists them on the market at their current value, up to 25 listings at a time. You get mail with the gold as each one sells.',
        'Worn and locked items are never touched by either.']],
      ['Gear basics', 's:chest', 'Gear drops from monsters, chests and guardians. Each piece fits one class and slot.', [
        'Slots: main hand, offhand, helmet, trinket, chest, legs, feet, ring. Robes cover chest and legs.',
        'Change gear at <b>camp</b>. <b>Equip best</b> does it in one tap.',
        'A <b>green arrow</b> marks an upgrade. The corner number (Lv) is the power level needed.',
        'Upgrade with gold, or salvage what you do not need.']],
      ['Rarity and sets', 'i:crown', 'Rare and epic gear is a real find, and gets likelier deeper down.', [
        'From floor 15, guardians can drop <b>set pieces</b>. Two or three of a set add bonuses.',
        'A <b>Forager</b> at camp improves all drops.']],
      ['Job gear', 'i:hammer', 'Some pieces boost a camp job (orange dot).', [
        'Fine 2%, rare 6%, epic 15% chance to roll one.',
        'Each job has a 3-piece job set from floor 20 once your hero reaches level 25: <b>2 pieces +40%</b>, <b>3 pieces +100%</b>.']],
      ['Your pack', 'i:bag', 'The pack holds 40 items to start.', [
        'Kindling adds <b>+10 slots</b> up to six times. Lanternholder adds 10.',
        'When full, the weakest common item is sold automatically.',
        'The <b>Bag of Holding</b> (6,500 Sigils, once) makes it endless.']],
      ['Relics', 'i:relic', 'Permanent bonuses that guardians sometimes drop.', [
        'Duplicates level a relic up. They stay through rekindling.']],
    ] },
    { id: 'camp', name: 'Camp', icon: 'flame', topics: [
      ['Main camp or a Draught', 'i:flame', 'Two ways to make changes in the Deep.', [
        '<b>Main camp</b> (floor 1): swap companions, recruit, train camp companions and change gear. <b>Descend</b> restarts you at the top of the region you left, so floor 99 becomes 91.',
        '<b>Campfire Draught</b>: a field camp for 60 seconds. Change your party\'s gear and keep your floor. No companion swaps.',
        'The party rests and heals at either. Training party members works anywhere.']],
      ['The campfire roster', 'i:users', 'Your party’s 4 companion seats never count. On top of them, the campfire holds 4 resting companions, plus one more at hero levels 10, 20 and 30.', [
        'When a new companion arrives and the fire is full, dismiss someone for good to keep them, or turn them away.',
        'Up to 3 more spots can be added for ' + L.ROSTER_COST + ' Sigils each. They are yours for good.']],
      ['Camp jobs', 'i:hammer', 'Opens at hero level 10 with one job slot; one more slot at levels 15, 20, 25, 30 and 35.', [
        '<b>Forager</b>: gear drops. <b>Runesmith</b>: damage. <b>Herbalist</b>: healing.',
        '<b>Armorer</b>: health. <b>Prospector</b>: gold. <b>Lamplighter</b>: lantern oil.',
        'Grows with level; <b>+50%</b> when the job suits their class. A <i>Hard worker</i> trait adds more.']],
      ['The Store and tonics', 'i:cup', 'Tonics are small boosts for 10 or 15 minutes. Open <b>Store</b> on the camp bar.', [
        'Combat: <b>+15% damage</b>, <b>+15% health</b>, <b>+20% healing</b>, <b>+5% crit</b> (gold only).',
        'Speed-ups: <b>+15% gold</b>, <b>+15% gear drops</b>, <b>+25% hero XP</b> (gold or Sigils).',
        'Different tonics stack. The same one adds time, up to an hour. Tap one above your abilities to drink.',
        '<b>Campfire Draught</b>: change gear anywhere for 60 seconds and keep your floor. <b>Lantern Oil</b>: +15 seconds against a guardian.']],
    ] },
    { id: 'grow', name: 'Getting stronger', icon: 'star', topics: [
      ['Your character', 'i:user', 'Your hero earns XP from every fight and gets a stat point each level.', [
        '<b>STR</b> damage. <b>DEX</b> crits and dodge. <b>CON</b> health. <b>INT</b> ability power.',
        '<b>WIS</b> healing and faster abilities. <b>CHA</b> gold. <b>LCK</b> a little of everything.',
        'Your class <b>favours two stats</b>; points there count 50% more.',
        'Spend points at the top of the Skills tab. A reset costs 50 Sigils.']],
      ['Skill tree and Kindling', 'i:flare', 'Rekindling earns Kindling, spent on your hero’s class tree.', [
        'Three branches of four skills. The fourth teaches a new ability (keys 6 to 8).',
        'Kindling also buys pack space, extra rings and a second trinket slot.',
        'Reset the tree free at camp. Change class at camp for 15 Kindling.']],
      ['Rekindling', 'i:lantern', 'At hero level 20, from floor 75 or deeper, start again from floor 1 for permanent Embers.', [
        'Each <b>Ember</b> adds 4% damage and gold forever.',
        'Companions, gear, relics and your character stay; levels reset.',
        'Embers count from floor 60, so a deeper descent pays far more. Your hero keeps their level.',
        'Rekindle when progress slows down.']],
      ['Story, journal and map', 'i:book', 'The story unfolds as you descend.', [
        'Replay scenes in the <b>Journal</b>.',
        'The <b>Map of the Deep</b> shows every region and lets you travel to floors you have reached. Each region’s dossier lists its <b>possible loot</b> with your real odds per kill, after your drop bonuses.']],
    ] },
    { id: 'sigils', name: 'Sigils and perks', icon: 'star', topics: [
      ['Earning Sigils', 'i:star', 'You can earn Sigils without spending money.', [
        '<b>Daily quests</b> (top bar): 1 Sigil each, 2 more for all three.',
        'Chests and guardians sometimes hold 1 to 3.',
        'Trade gold for Sigils with other players on the exchange.']],
      ['What Sigils buy', 'i:crown', 'Looks, convenience and speed-ups. Never combat power.', [
        '<b>Lanternholder</b> (premium): Auto-train, +10 bag slots, +4 h away. Get it for 500 Sigils (30 days, nothing renews) or as a $4.99 monthly membership. New heroes get a free 3-day trial.',
        '<b>Bag of Holding</b> (6,500, once): an endless pack.',
        '<b>Speed-up tonics</b> and Campfire Draughts. <b>Wardrobe</b> outfits and lanterns. Profile frames, titles and colors.',
        'Buy packs with <b>Get Sigils</b> after signing in with your Born 2 Game store account. Packs are one-time purchases and never renew.',
        'Sigils can also be sold to other players for gold on the Sigil exchange in the Market, or bought there with gold.',
        'Every pack bought lights a <b>Lantern Surge</b> for all players: +25% gold and XP.']],
      ['Mercy’s Blessing', 'i:cross', 'Real donations to the Grand War’s Mercy Corps bless every player.', [
        '<b>+10% gold</b>, <b>+10% health</b>, <b>+20% healing</b> while it burns.',
        'Each $10, 5 food items or toy adds 2 hours, up to 7 days.']],
      ['Victor’s Banner', 'i:crown', 'The alliance that wins a Grand War season holds the Nexus, and its heroes here get stronger.', [
        '<b>+8% damage, health, healing and gold</b>, and fallen allies get back up in <b>10 seconds</b> instead of 15.',
        'Fly that alliance’s banner to get it. It lasts until the next season is crowned.']],
      ['Grand War aura', 'i:shield', 'Verified Grand War commanders carry a class aura.', [
        '2% to 10% by war rank. Honors add more.',
        'Set your commander name on your profile’s Grand War tab. Auras are earned, never bought.']],
    ] },
    { id: 'social', name: 'Playing together', icon: 'chat', topics: [
      ['Accounts', 'i:user', 'A free account saves your progress online, on any device.', [
        'Accounts are optional. <b>Play without an account</b> keeps your hero on this device only.',
        '<b>Continue with Born 2 Game</b> signs you in with your store account, or sign up with any email and the code we send you.',
        'Sign in to use the Players Guild, the Market, the Ember Ring, world boss weekends and Sigils.']],
      ['Discord', 'i:discord', 'Join us on the Grand War Discord.', [
        'Tap the Discord button at the top, or <a href="https://discord.gg/6G7E7rhGFu" target="_blank" rel="noopener">join here</a>.',
        '<b>#lanternhold-chat</b> for players, <b>#lanternhold-bugs</b> for bug reports and <b>#lanternhold-ideas</b> for suggestions.']],
      ['Chat', 'i:chat', 'Global, Trade, Party and Banner channels.', [
        'Press <b>Chat</b> at the bottom right to open the window, and the dash to tuck it away again. A bubble on the button counts unread messages.',
        '<b>Whispers</b> are private chats, one per player. Each conversation is a tab along the top of the Whispers channel: their messages on the left, yours on the right. Tap <b>+</b> to start a new one, or tap a name in any channel and choose Whisper.',
        'Banner chat reaches only players under your banner.',
        'Ctrl+click an item to link it. Tap a name to mute or report. No links, and be kind.',
        'Missed a pop-up? The <b>bell</b> at the top keeps your last 120 notifications, sorted into tabs (Loot, Fights, Progress, Players), to read again.']],
      ['Trading Post', 'i:bag', 'Buy and sell gear for gold, or mail it to a player.', [
        '<b>Sell</b>: tap an item in Gear, choose <b>Sell on market</b>. Listings last a week.',
        '<b>Mail</b>: send to someone you recruited or chatted with, as a gift or for a price.',
        'Gold and gear have no real-money value.']],
      ['The Ember Ring (PvP)', 'i:duel', 'Duel other players\u2019 heroes for Laurels and rating.', [
        'Open the <b>PvP</b> tab and press <b>Duel</b>. Only your own hero fights; companions, tonics and Sigils never count.',
        'Each class has the edge on two classes and is countered by two. Learn <b>Ring skills</b> with Laurels and pick 2 abilities and 2 passives for your loadout.',
        'Rematches against the same hero within a day pay less each time, so spread your duels around.',
        '10 challenges, one back every 30 minutes. Wins give rating and Laurels, losses a few Laurels; your hero also defends while you are away. A full kit is a long climb.',
        'Laurels buy the <b>Ringwarden kit</b>: PvP gear with <b>Edge</b> (more damage to heroes) and <b>Resolve</b> (less damage from heroes). It works only in the Ring.']],
      ['Your profile', 'i:user', 'The card other players see.', [
        'Tap your portrait, then <b>Customize profile</b>: frame, title, color, banner, emblems and a bio.']],
      ['The Wardrobe', 'i:star', 'Outfits, lanterns and war banners, looks only.', [
        'Open it from the <b>Wardrobe</b> button in the Gear tab, from your portrait, or from the Quartermaster.',
        'Outfits recolor a hero from helm to boots; the rarest add an aura. Buy one once and dress any hero in your company in it.',
        'Lantern styles change the lantern beside your lead hero and the light around your party.',
        'War banners fly on a pole behind your party and show on your hero in the Ember Ring, the standings, the Players Guild and next to your name in chat.',
        'Other players see your hero\u2019s outfit in the Players Guild, as a guest in their party and in the Ember Ring. Nothing here changes power.']],
    ] },
  ];
  const guidePic = p => p.startsWith('s:') ? '<div class="gpic sprites">' + p.slice(2).split(',').map(n => '<img src="' + SP.spriteURL(n, 2, 0) + '" alt="">').join('') + '</div>' : '<div class="gpic">' + icon(p.slice(2)) + '</div>';
  let guideCat = 'start';
  function openGuide(cat) {
    if (typeof cat === 'string') guideCat = cat;
    const c = GUIDE.find(x => x.id === guideCat) || GUIDE[0];
    modal('<div class="maphead"><div><h2>Delver’s Guide</h2><small>Pick a topic.</small></div><button class="iconbtn" id="g-x" aria-label="Close guide">&times;</button></div>' +
      '<div class="gwrap"><nav class="gnav">' + GUIDE.map(x => '<button class="' + (x.id === c.id ? 'on' : '') + '" data-gcat="' + x.id + '">' + icon(x.icon) + '<span>' + x.name + '</span></button>').join('') + '</nav>' +
      '<div class="gbody">' + c.topics.map(([t, pic, sum, pts]) => '<section class="gcard">' + guidePic(pic) + '<div class="gtext"><h3>' + t + '</h3><p class="gsum">' + sum + '</p><ul>' + pts.map(x => '<li>' + x + '</li>').join('') + '</ul></div></section>').join('') + '</div></div>' +
      '<div class="row"><a class="btn ghost" href="https://lanternhold.born2gamellc.com/wiki/" target="_blank" rel="noopener">Full wiki</a><button class="btn ghost" id="g-notes">What’s new</button><button class="btn ghost" id="g-tut">Replay the tutorial</button><button class="btn" id="g-ok">Close</button></div>', md => {
        md.className = 'sheet wide guidesheet';
        md.querySelectorAll('[data-gcat]').forEach(b => b.onclick = () => { openGuide(b.dataset.gcat); const gb = $('modalbody').querySelector('.gbody'); if (gb) gb.scrollTop = 0; });
        md.querySelector('#g-notes').onclick = openNotes;
        md.querySelector('#g-x').onclick = closeModal; md.querySelector('#g-ok').onclick = closeModal;
        md.querySelector('#g-tut').onclick = () => { S.tut = { i: 0, done: false }; coachCtx = null; closeModal(); switchTab('party'); save(); };
      });
  }
  $('btn-guide').addEventListener('click', () => openGuide());
  // Top bar fit: step up .fit1..fit4 until nothing overflows (works at any zoom, whatever chips are showing).
  function fitTop() {
    const top = document.querySelector('.top'); if (!top) return;
    if (innerWidth <= 900) { top.classList.remove('fit1', 'fit2', 'fit3', 'fit4', 'fit5'); return; }
    let n = 0; top.classList.remove('fit1', 'fit2', 'fit3', 'fit4', 'fit5');
    while (n < 5 && top.scrollWidth > top.clientWidth + 1) top.classList.add('fit' + (++n));
  }
  addEventListener('resize', fitTop); setInterval(fitTop, 1500); setTimeout(fitTop, 50);
  // ---------- Full screen (John, 24 Nov 2026): the whole game fills the screen, no browser bars. Esc leaves. ----------
  const FS_IN = 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', FS_OUT = 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5';
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsOk = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  function toggleFull() {
    const d = document.documentElement;
    try {
      if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const r = (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI: 'hide' }); r && r.catch && r.catch(() => toast('lock', 'Full screen is not available', 'Your browser blocked it. Try F11 on a computer.', 'warn')); }
    } catch (e) { toast('lock', 'Full screen is not available', 'Your browser blocked it. Try F11 on a computer.', 'warn'); }
  }
  function paintFull() {
    const b = $('btn-full'); if (!b) return; b.hidden = !fsOk();
    const on = !!fsEl(); b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
    b.dataset.tip = on ? 'Leave full screen (or press Esc)' : 'Full screen: hide the browser and fill your screen (Esc to leave)';
    $('fullpath').setAttribute('d', on ? FS_OUT : FS_IN); document.body.classList.toggle('isfull', on); fitTop();
  }
  $('btn-full') && $('btn-full').addEventListener('click', toggleFull);
  document.addEventListener('fullscreenchange', paintFull); document.addEventListener('webkitfullscreenchange', paintFull); paintFull();
  $('btn-notes').addEventListener('click', openBell); paintNoteDot();

  // ---------- patch notes ----------
  // Newest first. Bump `v` for each release; players see the notes once after updating.
  const PATCH_NOTES = [
    { v: 110, date: 'November 24, 2026', title: 'Full screen button stays put', items: [
      'The full screen button no longer hides when the top bar is crowded. The icons squeeze a little instead.'] },
    { v: 109, date: 'November 24, 2026', title: 'Bestiary mastery and full screen', items: [
      'Bestiary mastery: every 500 of one kind of creature you defeat gives +1% damage and +1% hero XP against that kind, up to +10% at 5,000. Open a creature’s page in the Codex Journal to see your count, a progress bar and the next step. Counting starts today.',
      'The XP bar breakdown shows your Bestiary bonus against the foe you are fighting.',
      'New full screen button at the top right (also in Settings). The game fills your whole screen with no browser bars, and spreads out wider so you can see more. Press Esc or the button again to leave.'] },
    { v: 108, date: 'November 24, 2026', title: 'Victor’s Banner', items: [
      'The alliance that wins a Grand War season now holds the Nexus in Lanternhold too. Every hero under its banner gets +8% damage, health, healing and gold, and fallen allies get back up in 10 seconds instead of 15.',
      'It lasts until the next season is crowned. Look for the crown line under your marching order once Season 1 ends.'] },
    { v: 107, date: 'November 24, 2026', title: 'Visit the Store', items: [
      'The Store is now a shop you walk into, like the Enchanter and the Armorer. Old Thessaly runs the counter, with shelves of glowing tonics behind her.',
      'Tonics and Supplies sit in tabs under the scene. Buy and drink without leaving the shop.',
      'Every shop header has buttons to hop straight to the other two shops.'] },
    { v: 106, date: 'November 24, 2026', title: 'Bigger shop scenes', items: [
      'The Enchanter and the Armorer no longer shrink the party and the shopkeeper in short, wide windows. The sign and lanterns tuck in under the ceiling instead.',
    ] },
    { v: 105, date: 'November 24, 2026', title: 'Legendary world boss loot', items: [
      'World bosses now drop Legendary loot. When an event ends, a draw picks who wins the boss’s Legendary (if one drops) and who gets each of its boss shards.',
      'Every whole point of boss score is one ticket, and anyone who hit the boss gets at least one. The more phases the server breaks, the better the odds of a Legendary and the more shards drop.',
      'Each world boss has its own four-piece Legendary set (weapon, chest, ring, amulet) with 2-piece and 4-piece bonuses. Legendaries are bound to the winner.',
      'Boss shards upgrade that boss’s Legendary pieces at the Armorer. Buy and sell shards on the new Boss shards market.',
      'The Enchanter and the Armorer now scale to your window, so the party and the shopkeeper fill the scene on wide, tall and phone screens.',
    ] },
    { v: 104, date: 'November 24, 2026', title: 'Leaving the shops', items: [
      'Fixed: pressing Return to camp, Descend or Draught while in the Enchanter or Armorer now leaves the shop.',
    ] },
    { v: 103, date: 'November 24, 2026', title: 'Shops at camp', items: [
      'Fixed: visiting the Enchanter or the Armorer from the main camp showed the campfire instead of the shop.',
    ] },
    { v: 102, date: 'November 24, 2026', title: 'The Hold’s tents', items: [
      'The Enchanter’s shop is rebuilt: your whole party stands where it does in a fight and the Enchanter stands behind his counter where a monster would. All the choices are in the counter panel below.',
      'New: the Armorer. Upgrade gear with gold, merge two copies into one, or melt spare gear for twice the gold of a normal scrap (no Dust).',
      'The camp card is cleaner: one big Return to camp button, then a row with the Enchanter, Armorer, Store and your Draughts.',
      'Tap The Hold at the top of the Map of the Deep to see its tents (Campfire, Enchanter, Armorer, Store) and travel to one.',
    ] },
    { v: 100, date: 'November 24, 2026', title: 'The Mercy Corps on the road', items: [
      'Rare Mercy Corps encounters, from floor 5, while you are playing. Now and then a monster holds a Mercy Corps companion captive: defeat it to free them and get +30% hero XP for 15 minutes.',
      'Sometimes you find a Mercy Corps companion lying wounded on the path instead. Nobody fights: your healers pour their healing into them, Lantern Hymn mends a big chunk, and every tap is a bandage. Heal them to full within 45 seconds for Mercy’s Thanks, +15% damage and healing for 15 minutes. If time runs out, other medics carry them to safety, and nothing is lost.',
      'Both buffs show in the tonic bar under the fight with their time left, and the rescue counts in the XP bar’s bonus list.',
      'Enchanting and merging gear now give hero XP: more for higher enchant tiers and higher merges, and half for a merge that fails.',
    ] },
    { v: 99, date: 'November 24, 2026', title: 'The Enchanter’s shop, rebuilt', items: [
      'The Enchanter has been redrawn: an old, hooded enchanter with half-moon spectacles and a glowing crystal, standing behind his counter in front of a turning rune circle. Your hero walks in at full size.',
      'The top of the screen now says you are in the Enchanter’s Shop, with a Leave shop button, instead of showing the dungeon floor.',
      'His question hangs in a speech bubble above him: Enchant an item, Disenchant or Scrap for Dust.',
      'Enchanting is now done one plain question at a time in the counter under the scene, with no pop-ups: pick the item, pick the enchant, then confirm. A short summary says exactly what moves, what is used up and what it costs, and the items you pick appear on the counter.',
      'Scrapping for Dust happens right at the counter too.',
    ] },
    { v: 98, date: 'November 24, 2026', title: 'The Enchanter’s shop', items: [
      'Visiting the Enchanter now takes your party out of the Deep and into the Enchanter’s shop. Your hero walks in through the door to the counter, and the Enchanter waits behind it among shelves of glowing bottles.',
      'The shop’s buttons hang above the Enchanter, where monsters usually stand: Enchant, Disenchant, Scrap for Dust and Leave shop. The counter below the scene lists your items; pick one to work on it.',
      'Leave shop takes the party straight back to the floor you left.',
    ] },
    { v: 97, date: 'November 24, 2026', title: 'A clearer Sigil shop', items: [
      'Lanternholder is now the one name for premium. Get it with 500 Sigils for 30 days (nothing renews), or as the $4.99 monthly membership. The old Lantern Pass is the same thing under its new name, and any days you had are kept.',
      'The Sigil shop is laid out in three parts: what Sigils are for (Lanternholder, Bag of Holding, Wardrobe, profile looks, the Sigil exchange), Lanternholder with both ways to get it side by side, and the Sigil packs.',
      'Your profile shows your Sigils, Lanternholder, Wardrobe and Bag of Holding as four tidy tiles, with your card looks below.',
    ] },
    { v: 96, date: 'November 24, 2026', title: 'The Enchanter', items: [
      'Enchanting and disenchanting now happen at the Enchanter. Press Enchanter on the battle screen (or Enchant on any item) to visit. Your party stops diving while you are there: nobody fights, nothing new turns up and you keep your floor.',
      'The Enchanter has three tabs: Enchant (pick any item with a socket, worn or not, and move an enchant onto it), Disenchant (break down a spare item to move one of its enchants) and Scrap for Dust.',
      'Press Leave when you are done and the party carries on from the same floor. Reloading the game also ends a visit.',
    ] },
    { v: 95, date: 'November 24, 2026', title: 'XP in the fight log', items: [
      'The fight log now shows the hero XP each kill gave you, with all your bonuses counted, next to the gold: "Defeated Gloop +120 gold, +6.4 XP". Ambushes also show how many foes were in the group.',
    ] },
    { v: 94, date: 'November 24, 2026', title: 'More ambushes', items: [
      'Ambushes (groups of 2 to 4 monsters) now come twice as often: 6% of fights from floor 3, up from 3%.',
      'The ambush tag now shows its XP bonus. Each monster in the group adds 2× hero XP, so an ambush of 3 gives XP ×6 (and 6× gold). Hover the tag (or tap it) for the details.',
    ] },
    { v: 93, date: 'November 24, 2026', title: 'A quieter Lantern Keeper', items: [
      'The Lantern Keeper banner above the fight is now a small glowing lantern in the corner of the battle scene. Hover it (or tap it on a phone) to see who is online and the +25% bonus.',
    ] },
    { v: 92, date: 'November 24, 2026', title: 'See your XP bonuses', items: [
      'The XP bar on your character sheet now shows your total hero XP rate, like XP ×1.18. Hover the bar (or tap it on a phone) to see every bonus that adds to it: class skills, war aura, Scholar’s Ink, Lantern Surge, companion traits, enchants and region mastery, plus the Lantern Keeper when he is online.',
    ] },
    { v: 91, date: 'November 24, 2026', title: 'Merchant, bounties and the Lantern Keeper', items: [
      'New: the wandering merchant. Now and then, while you play, a merchant stops beside the fight for 2 minutes with one deal at half price: tonics, Campfire Draughts, Lantern Oil or Dust. Tap the merchant to see it.',
      'New: the bounty board, in the Quests window. Three bounties at a time, new every 4 hours, built from the floors you have reached: hunt certain monsters on certain floors, beat a guardian a few times, open chests and more. Each pays gold and Dust, sometimes a tonic.',
      'Bounties that send you back up have a Go to floor button. Finished bounties you forget to claim are paid when the board changes.',
      'New: the Lantern Keeper. When the store owner is online, every hero gets +25% damage, healing, gold, hero XP and gear finds. A gold banner over the fight shows when it is on.'
    ] },
    { v: 90, date: 'November 24, 2026', title: 'Shielded foes', items: [
      'New: shielded monsters. From floor 12 some monsters, and many guardians, fight inside a pale blue shield. While it is up your party deals 65% less damage.',
      'Tap the fight to break it: each tap knocks about 10% off (a critical tap 20%), so about 10 taps does it, and your party is back to full strength.',
      'Not watching? The shield wears away on its own in about 14 seconds (16 for a guardian), so idle runs never get stuck. Guardians raise it once more at half health.'
    ] },
    { v: 89, date: 'November 24, 2026', title: 'Mastery hero XP', items: [
      'Region mastery now speeds up hero levels too. Every mastery goal adds +1% hero XP, and a region with all three goals done adds +2% more (+5% per fully mastered region).',
      'It counts the mastery you already have, so many heroes get a boost right away. Your total shows under Region mastery in the Codex.'
    ] },
    { v: 88, date: 'November 24, 2026', title: 'Burns, poison, stuns and disarms', items: [
      'Burning now hurts heroes in cloth (healers, mages, necromancers) twice as much. Tanks in plate take a quarter less.',
      'Poison now bites everyone a quarter harder, except necromancers, who take only a quarter of it.',
      'New: Stun. Ground Slam, Tidal Crash and Belly Flop can stun heroes, who cannot attack, heal or use abilities for 3 seconds. Stars circle a stunned hero\u2019s head.',
      'New: Disarm. Shield Charge and the new Disarming Lash (Thornlings) knock a hero\u2019s weapon away: 35% damage, half healing and no abilities for 8 seconds, until it grabs it back.',
      'Tanks shake off stuns and disarms twice as fast, and Shield Wall makes them immune. Dodging or blocking the hit avoids it.',
      'Ability buttons show when a hero is stunned or disarmed and for how long.'
    ] },
    { v: 87, date: 'November 24, 2026', title: 'Ghost Lantern, and a balance pass', items: [
      'New: the Ghost Lantern. Now and then, while you are playing, a ghost lantern drifts into the fight and slowly saps your party’s damage or healing (10% at most). Tap it to shatter it for gold, Dust or a free tonic. Ignore it and it fades after 30 seconds with nothing lost.',
      'Healers: Lantern Hymn can now be sung with whatever mana is left (it uses up to 30), but still never while out of mana. Healing costs a little less mana. Parties fall far less often than they did in v86.',
      'Resting at camp now fills every mana and stamina bar.',
      'Tank and healer heroes hit harder (3× and 5× their old damage) so every class reaches the deep floors at a similar pace. Companions are unchanged.',
      'Damage numbers and messages that pop up at the same spot now stack instead of landing on top of each other, and stay inside the fight window.',
      'Phones: the bottom tab bar no longer sticks out a couple of pixels and lets the page wiggle sideways.'
    ] },
    { v: 86, date: 'November 24, 2026', title: 'Mana, stamina and new gear stats', items: [
      'Healers, mages and necromancers now have a blue mana bar. Rogues and tanks have a gold stamina bar. Both refill over time.',
      'Abilities and class specials cost mana or stamina. If a hero is short, it waits for the bar to refill.',
      'Healing costs mana. A healer that runs out of mana stops healing and fights with basic attacks until its mana comes back.',
      'New enchants that help only the hero wearing the item: Flow (mana or stamina regen), Leech (life steal), Bulwark (block chance) and Plating (defense).',
      'Rings and trinkets roll Flow and Leech more often. Armor and shields roll Bulwark and Plating more often. Weapons roll Leech.',
      'Hero profiles show mana or stamina, regen, life steal, block and defense. Your existing gear and enchants are unchanged.'
    ] },
    { v: 85, date: 'November 24, 2026', title: 'Fight panel fix', items: [
      'Fixed: after changing floors, the fight panel could keep showing the last guardian (with its lantern timer) while your party was really fighting something else. Between foes it now says the next foe is on the way.'
    ] },
    { v: 84, date: 'November 24, 2026', title: 'Notification tabs', items: [
      'The bell now sorts notifications into tabs: Loot, Fights, Progress, Players and Other. Tap one to read just that log. Each tab shows how many it holds and a dot for new ones.',
      'The bell keeps the last 120 notifications instead of 50.'
    ] },
    { v: 83, date: 'November 24, 2026', title: 'Quieter guardian farming', items: [
      'The "guardian defeated, the way down is open" pop-up now shows only the first time you beat a guardian, not on every kill while you farm it.'
    ] },
    { v: 82, date: 'November 24, 2026', title: 'Farming guardians, and a cleaner top bar', items: [
      'With Descend automatically off, beating a guardian now keeps you on its floor so you can farm it again. Before, a guardian kill always pushed you down a floor.',
      'The top bar fits itself to your screen and zoom: it drops labels and then the title before anything can overlap. The online count no longer sits on the Lanternhold title.',
      'The floor dots in the battle header no longer touch the region name.'
    ] },
    { v: 81, date: 'November 24, 2026', title: 'Where sets drop, and your gold is back', items: [
      'Every set card in the Gear tab, and every set piece you open, now says where it drops, with a Farm floor button that takes your party there and keeps it on that floor.',
      'Region sets drop in their own region, best from its guardian. Class sets drop from any guardian from floor 15.',
      'Fixed: on some laptop-sized screens your gold was hidden under the online count in the top bar.'
    ] },
    { v: 80, date: 'November 24, 2026', title: 'Special attacks', items: [
      'Every guardian now has a special attack it winds up every 10 seconds or so. Each region guardian has its own signature move, like Furnace-Heart\u2019s Magma Wave or the Root Mother\u2019s Grasping Roots.',
      'Some monsters past floor 8 have one too: acid that splashes the heroes beside the target, bats that dive at the back of the line, spores that poison everyone.',
      'A red banner warns you, and a red ring shows who will be hit. Marked spots cannot be drawn away by a tank.',
      'Burns and poison now last ' + L.DOT_FIGHTS + ' fights, with a countdown badge over each hero. A healer\u2019s ability, Purify or a rest at the campfire clears them.',
      'No special can take more than about a third of a hero\u2019s health in one go, so they hurt without one-shotting anyone.'
    ] },
    { v: 79, date: 'November 24, 2026', title: 'A tidier battle header', items: [
      'Floor, Map of the Deep, your chapter goal and the world boss now sit in one framed panel on top of the battle, instead of floating above it.',
      'The header is shorter, so the battle scene gets more room (about 70 px more on a laptop).'
    ] },
    { v: 78, date: 'November 24, 2026', title: 'One tab at a time', items: [
      'If Lanternhold is open in two tabs, the older one now stops and says so. Before, both kept saving over each other, so quest claims, auto-scrap and tonics could come undone after a refresh.',
      'Tap Play here instead on a stopped tab to pick it back up.'] },
    { v: 77, date: 'November 24, 2026', title: 'Tonic stacks stay visible', items: [
      'An active tonic now shows how many more of it you carry next to its timer, so drinking one no longer makes the rest of your stack seem to disappear. Tap it to drink another and add time.',
      'If a tonic is already near its 60-minute cap, tapping it tells you so instead of doing nothing.'] },
    { v: 76, date: 'November 24, 2026', title: 'Room at the fire, and closing whispers', items: [
      'Companions in your party no longer count against the campfire. You can keep your 4 party companions plus 4 more resting at the fire, and the fire still grows at hero levels 10, 20 and 30.',
      'Whisper tabs have a small &times; to close a conversation. It comes back if that player whispers you again.'] },
    { v: 75, date: 'November 24, 2026', title: 'Whispers and the notification bell', items: [
      'Each whisper conversation now has its own tab along the top of the Whispers channel, and the latest one opens on its own.',
      'Their messages sit on the left and yours on the right, like a messenger app.',
      'Tap + to start a new whisper with someone who has been chatting lately. No more hunting for a name to tap.',
      'New: the bell at the top keeps your last 50 pop-ups, so you can reread any that went by too fast. Pop-ups also stay up longer, and wait while your pointer rests on one.'] },
    { v: 74, date: 'November 24, 2026', title: 'Region trials', items: [
      'The hero level gates between regions are gone. Instead each region has a trial: defeat ' + L.TRIAL_ELITES + ' alliance elites there (the bannered warband foes) and beat its guardian, and the way to the next region opens.',
      'Progress shows on screen as you fight, and in Codex, Progress. Hero level still opens new parts of the game, like camp jobs, the Ember Ring and rekindling.',
      'If you were held at a gate, you are through: the trial counts as done for the region you are in. Beat its guardian again and keep going.'] },
    { v: 73, date: 'November 23, 2026', title: 'Power level and hero level', items: [
      'The level shown on each Party card is now called power level. It is what training with gold raises, and what gear needs.',
      'Your hero level (from XP, which opens new parts of the game) is now always called hero level, so the two never get mixed up. A hero can be hero level 11 with a power level of 142.',
      'The Guide and the wiki explain both.'] },
    { v: 72, date: 'November 23, 2026', title: 'A tidier Hold', items: [
      'The hero setup screen is wider on computers, so class and banner names no longer spill out of their cards.',
      'On phones, all four currencies fit the top bar again (Embers and Dust were cut off once gold reached millions). Quests and blessings sit just under them.',
      'The PvP tab has its own crossed-swords icon, so it no longer looks like the Fight button.',
      'Tanks now carry the Covenant chevron on their shields and in their class icon.',
      'A few names were changed: region 6 is now the Drowned Archive, its guardian the Sunken Magister, and the healer Wayfarer branch has Lamplight Song and Quick Breath. Your skills and gear are unchanged.',
      'The Guide covers the newer parts of the game: the PvP tab, the Why we fight opening, the music player, whispers and the unread bubble in chat, and playing without an account.'] },
    { v: 71, date: 'November 23, 2026', title: 'A calmer marching order', items: [
      'The Party tab is easier to read. Each companion shows only the traits that are working right now, with their effect. The others share one quiet line, and you can hover or tap it to see what they would do.',
      'Send to campfire is now a small flame button next to Auto, and on phones the Train, Auto and campfire buttons sit in one row under each companion.'] },
    { v: 70, date: 'November 23, 2026', title: 'Raise your colors', items: [
      'The Wardrobe has a new Banners tab with 11 war banners, from the free Delver’s Pennant to the gold-fringed Last Lantern.',
      'Your banner flies behind your party and shows on your hero card in the Ember Ring, on challenger cards, in the standings, on your Players Guild card and next to your name in chat.',
      'Banners are looks only. They never change your party’s power.'] },
    { v: 69, date: 'November 23, 2026', title: 'Know what you are hunting', items: [
      'Every region on the Map of the Deep now shows its possible loot: the region set, class and job set pieces, each gear rarity, relics, Sigils and the Loot Goblin’s Sack.',
      'Each drop shows your own odds per kill from bosses, chests, elites, ambushes and ordinary foes, worked out from the same rules the game uses, after your Keen Eye, Luck, Forager, Finder enchants, companion traits and Seeker’s Charm.',
      'The header shows your total drop bonus. Tap the (i) for the breakdown. Lantern Surge and region mastery raise gold and XP, not drop chances, so they do not change these numbers.'] },
    { v: 68, date: 'November 23, 2026', title: 'Guild invites fixed', items: [
      'Fixed: the Invite buttons in the Guild tab did nothing. Pressing Invite now sends the invite right away, shows Invited with a Cancel button, and pops up a notice. The same fix covers accepting or declining party invitations and opening a hero’s profile from the Guild tab.'] },
    { v: 67, date: 'November 23, 2026', title: 'The Nexus Guardian', items: [
      'The Nexus has started listening to the Deep. A rhythm that never tires, strikes that land too fast for too long or with perfectly even spacing, sounds to it like a siege engine at the wall.',
      'When it hears one, the back wall starts to crack and glow. Keep it up and the Nexus Guardian breaks through and takes the stage. Nothing lands on it, not your strikes and not your party.',
      'Ease your strikes for a few seconds and it loses interest, withdraws, and the fight picks up right where it was. Normal tapping, even fast tapping, never calls it.',
      'World boss assaults listen too: strikes with that rhythm do not count toward your score.'] },
    { v: 66, date: 'November 23, 2026', title: 'Fresh starts on request', items: [
      'Admins can now reset a single account back to a brand-new game, for testing or when a player asks for a clean slate. You get a notice when it happens, and purchased Sigils are kept unless you ask for them to go too.',
      'A server-wide reset now also keeps Sigil exchange listings and store links in place.'] },
    { v: 65, date: 'November 23, 2026', title: 'Why we fight', items: [
      'A new opening for Lanternhold: the Shattered Reach, the Nyx Rift, the five who answer the call, and why we fight.',
      'It plays once on your first visit. Tap to move through it or skip it any time, and watch it again from Settings.'] },
    { v: 64, date: 'November 23, 2026', title: 'A slower, deeper descent', items: [
      'Lanternhold is now paced to be savored, not rushed. New parts of the game open as your hero levels up: Gear at 3, the Campfire at 5, map travel and market buying at 8, camp jobs at 10, the Players Guild at 12, the Ember Ring at 15, selling and the Sigil exchange at 18, rekindling at 20, and the world boss and job sets at 25.',
      'Each new region needs a hero level to enter. Until then your party keeps working the region it is in. Hero XP needs more per level, and deeper floors and guardians give the most.',
      'Region mastery: every region has three goals (beat its guardian, defeat 20 alliance elites, find a piece of its set). Each one finished is +1% damage, health or gold for good. See Codex, Progress.',
      'Your campfire now holds 4 companions, plus one at hero levels 10, 20 and 30. When a new companion arrives and it is full, dismiss someone for good or turn them away. Up to 3 more spots for 300 Sigils each.',
      'Camp jobs start with one slot and gain one at levels 15, 20, 25, 30 and 35.',
      'Rekindling now needs hero level 20 and floor 75, and Embers count from floor 60, so a deep descent pays far more than a quick one.',
      'Nothing you already have is taken away: your hero keeps their level, every floor you reached stays open, companions over the new limit stay, and features you already use stay unlocked.'] },
    { v: 63, date: 'November 23, 2026', title: 'Whispers and unread messages', items: [
      'New: whispers. Tap a player’s name in any chat channel and choose Whisper to message them privately. Your conversations live in the new Whispers tab, and tapping a name there whispers back.',
      'The chat button now shows a red bubble with how many new messages are waiting in Global and Whispers, and a new whisper pops up a notice even while chat is closed.'] },
    { v: 62, date: 'November 23, 2026', title: 'Music for the Deep', items: [
      'Lanternhold now has its own soundtrack: eight original pieces, from the Hearthfire Waltz at camp to the Ember Ring battle theme and a quiet piano nocturne for late watches.',
      'Tap the note button at the top to open the player. Skip forward or back, pick any track, shuffle, set the volume or mute. Your choices are remembered on this device.',
      'Music starts on your first tap and streams one track at a time, so it stays light on phones. You can turn it off in Settings too.'] },
    { v: 61, date: 'November 23, 2026', title: 'Auto-scrap fixed', items: [
      'Fixed: auto-scrap kept most drops. It treated anything a benched companion, or a hero not yet high enough level, might someday wear as an upgrade. Now only a piece someone in your party can wear right now, and that beats their gear, is kept.',
      'New: the Auto-scrap window shows how many pieces already in your pack match your settings, with a button to scrap them all at once. Locked and worn gear, sets and each party member’s best spare piece are kept.'] },
    { v: 60, date: 'November 23, 2026', title: 'Fair fights in the Ember Ring', items: [
      'Duelling the same hero again within a day now pays less each time: full rewards, then half, then a quarter, then nothing. This covers rating and Laurels for both heroes.',
      'Challenger cards show when a rematch pays less, and when it will pay in full again.'] },
    { v: 59, date: 'November 23, 2026', title: 'Lock gear in its slot', items: [
      'New: lock a piece someone is wearing to keep it in that slot. Tap the slot on the Gear tab and choose Lock, or lock it from its item card.',
      'Equip best now skips locked slots and tells you how many it skipped. Locked slots show a padlock, and a locked piece is still safe from scrap and the Loot Goblin.'] },
    { v: 58, date: 'November 23, 2026', title: 'The Ember Ring: abilities, counters and Ring skills', items: [
      'Heroes now fight with their class abilities in duels: Shield Bash stuns, Mend heals, Backstab and Fireball burst, Life Drain steals health, and more.',
      'Every class has the edge on two classes and is countered by two others. Challenger cards show who has the edge, and what each foe brings.',
      'New Skills view in the PvP tab: learn and rank up 6 Ring skills per class with Laurels, then pick 2 abilities (in the order you want them used) and 2 passives.',
      'Your loadout also defends while you are away, so build it with care. Every class starts with its first ability for free.',
      'Fixed: world boss assaults said the server could not record them. Every assault now counts toward the shared health bar.'] },
    { v: 57, date: 'November 23, 2026', title: 'The Wardrobe', items: [
      'New: the Wardrobe. Dress any hero in your company in one of nine outfits, from Emberforged and Hoarfrost to the Riftborn and Lanternsworn regalia with their own auras. Buy an outfit once and every hero can wear it.',
      'New lantern styles: Moonlit, Marsh Wisp, Rosefire, Riftglass, Sunforged, Soulflame and Starless. Your lantern hangs beside your lead hero and colours the light around your party.',
      'Other players see your hero’s outfit in the Players Guild, as a recruited guest and in the Ember Ring. Your name color and title now show in chat too.',
      'Looks only, bought with Sigils. Nothing in the Wardrobe changes your party’s power. Open it from the Gear tab, your portrait, or the Quartermaster.'] },
    { v: 55, date: 'November 23, 2026', title: 'Region sets and the Goblin’s Sack', items: [
      'New: region sets. All fifteen regions of the Deep now drop their own four-piece armor set for any class. Two pieces boost one stat, and four pieces add a big damage and health bonus that multiplies all of your gear, so a finished set stays strong through rekindles.',
      'Region pieces only drop in their own region and they are rare, with guardians your best chance. Collecting a full set is a real hunt.',
      'New: kill a Loot Goblin and there is a tiny chance he drops the Loot Goblin’s Sack, a +15% party gold trinket. Global chat hears about it when one drops.'] },
    { v: 54, date: 'November 23, 2026', title: 'The Lanternhold Wiki', items: [
      'New: the Lanternhold Wiki at lanternhold.born2gamellc.com/wiki. Every class and skill tree, companion, region, monster, set, enchant and relic, with search.',
      'It is built from the game itself, so it updates whenever the game does. Open it from Full wiki in the Guide (the ? at the top).'] },
    { v: 53, date: 'November 23, 2026', title: 'Easier sign-up', items: [
      'Fixed: confirming a new account could reject a correct-looking code after asking for several. The game no longer sends extra codes on its own, tells you when the newest one was sent, and ignores spaces in the code.',
      'Every sign-in screen now has Play without an account. Accounts are optional and only keep your save safe across devices.',
      'Returning players can tap Sign in on the very first screen to load their hero, with no need to make a new one first.'] },
    { v: 52, date: 'November 23, 2026', title: 'Auto-scrap and a cleaner pack', items: [
      'New: Auto-scrap. Tick the rarities you never want, and new drops of those turn straight into gold and Dust without taking pack space. Set pieces and upgrades for your party are always kept.',
      'The pack view has a tidy header: a space meter that turns red when the pack is full, and one Bulk actions menu for mass sell, merge and scrap.'] },
    { v: 51, date: 'November 23, 2026', title: 'Tidier tabs and a fight log', items: [
      'Gear now has two views, Equipped and Pack, so you are not scrolling past one to reach the other.',
      'Skills is split into Stats, Skill tree and Rekindle.',
      'Camp companions take up far less room. Traits show as names; hover one for details.',
      'New Fight log at the bottom of the Party tab: kills, critical strikes, abilities, falls, ambushes and loot, with filters.'] },
    { v: 50, date: 'November 23, 2026', title: 'Lantern Surge', items: [
      'New: Lantern Surge. Whenever any player buys a Sigil pack, every hero in the game gets +25% gold and +25% XP.',
      'Each pack adds time for everyone: 30 minutes for 500 Sigils, up to six and a half hours for 6,500, stacking up to a day ahead.',
      'A lightning chip in the top bar shows how long the surge has left. Tap it for details.'] },
    { v: 49, date: 'November 23, 2026', title: 'The Ember Ring: a longer climb', items: [
      'Ringwarden gear is now something to earn over time. A win pays 8 Laurels (up to 12 against a stronger hero), and a loss still pays 3.',
      'The first win each day adds 10 more, and your hero earns 2 for every challenger it beats while you are away.',
      'Kit ranks cost more: 60 Laurels for the first rank of a piece, rising by 30 with each rank. Laurels you already have are kept.'] },
    { v: 48, date: 'November 23, 2026', title: 'Dust and Mass merge', items: [
      'Scrapping gear now gives Dust as well as gold. Your Dust shows in the top bar.',
      'Enchanting and disenchanting cost Dust, more for higher tiers.',
      'New Mass merge button in the Gear tab. Pick how high to go, see the expected losses, then merge every spare pair at once. Worn and locked items are never touched.',
      'Fixed: after rekindling at the main camp there was no button to start fighting again.'] },
    { v: 47, date: 'November 23, 2026', title: 'Enchantments and Disenchant', items: [
      'Gear now has enchant sockets, more for rarer items and items from deeper floors. Every item you already own has had its enchants rolled.',
      'Enchants like Might, Vigor, Keen and Fortune help the whole party while anyone in it wears the item.',
      'Disenchant an item you can\u2019t use to move one of its enchants onto one you can. The disenchanted item is destroyed.',
      'New Discord button at the top: chat with players, report bugs and share ideas on the Grand War Discord.'] },
    { v: 46, date: 'November 23, 2026', title: 'Merge your gear', items: [
      'Have two of the same item? Open one and choose Merge. They become a single piece one upgrade higher, keeping the better job bonus.',
      'Every merge carries a risk: if it fails, both pieces are destroyed for good. The higher the result, the bigger the risk.',
      'Luck and Intelligence lower the risk, up to half. The exact odds show before you confirm, and locked items can never be merged.'] },
    { v: 45, date: 'November 23, 2026', title: 'A cleaner screen', items: [
      'The top bar is tidier. Gold, damage, Embers and Sigils now sit together in one strip.',
      'Hover over almost anything to see what it does. On a phone, tap the small i badges.',
      'The camp bar, marching order, campfire and banner sections are shorter, with the details in tooltips.'] },
    { v: 44, date: 'November 23, 2026', title: 'The Ember Ring: duels between players', items: [
      'Open the new PvP tab to duel other players\u2019 heroes one on one. Only your own hero fights: no companions, tonics or Sigils.',
      'Wins earn Laurels and rating. Climb from Ashen through Ironclad, Emberborn, Gilded and Lanternsworn to Riftbreaker on the Ring standings.',
      'Spend Laurels on the Ringwarden kit, a separate set of PvP gear with 15 ranks per piece. Its Edge and Resolve count only in the Ring.',
      'You get 10 challenges, and one returns every 30 minutes. Your hero also defends while you are away and earns Laurels for every challenger it beats.'] },
    { v: 43, date: 'November 23, 2026', title: 'Main camp and field camps', items: [
      'Return to camp now takes you to the main camp with no gold cost. Swap companions, recruit, train and change gear there.',
      'When you head back down you start at the top of the region you left. Floor 99 takes you back to floor 91.',
      'A Campfire Draught makes a field camp right where you are. Change your party\'s gear for 60 seconds and keep your floor. Companion swaps need the main camp.'] },
    { v: 42, date: 'November 23, 2026', title: 'Mass sell', items: [
      'New Mass sell button next to Mass scrap in your Gear tab. Pick rarities and list many pieces on the market at once, each at its current value.',
      'Worn and locked items are never listed. You can keep the best piece of each kind and anything you have upgraded.',
      'You can now have up to 25 items on the market at a time, up from 10.'] },
    { v: 41, date: 'November 23, 2026', title: 'Lock your favorite gear', items: [
      'Tap any item in your pack and choose Lock. A small padlock shows on its tile.',
      'Locked items are never touched by Mass scrap, auto-selling when your pack is full, or the Loot Goblin.',
      'You can still equip and upgrade them. Unlock an item when you want to sell, send or salvage it.'] },
    { v: 40, date: 'November 23, 2026', title: 'World boss weekends', items: [
      'A giant of void crystal, the Rift Colossus, has broken through beneath the Hold. Every signed-in player fights the same boss and fills one shared health bar.',
      'Tap the purple bar on the stage to join a two-minute assault. You can go again every 15 minutes. Strike and use your abilities for more damage.',
      'Damage counts at the strength of your deepest floor, so everyone helps. Each phase broken makes the next one tougher.',
      'When the event ends, claim Sigils: 3 for taking part, 1 per phase broken (up to 5) and 5 more for the top three, plus a purse of gold.',
      'From now on a new world boss attacks every weekend, Friday to Sunday (UTC). This first one runs until Friday as a preview.',
      'Updates now install by themselves. The game waits until the new version is fully out, saves, and reloads, so the Update button should no longer get stuck.'] },
    { v: 39, date: 'November 23, 2026', title: 'Players online', items: [
      'A green counter next to the Lanternhold name shows how many players are online right now. Tap it to see heroes in the Guild.'] },
    { v: 38, date: 'November 23, 2026', title: 'Clearer store and the Lanternholder membership', items: [
      'Sigil packs are plain one-time purchases. You pay once, nothing renews, and the checkout no longer shows a duration.',
      'New: Lanternholder, a $4.99 monthly membership. While it is active you get Auto-train, 10 extra bag slots and 4 more hours of offline earnings, with no Sigils to spend.',
      'The Get Sigils screen now shows one-time packs and the monthly membership separately, and says plainly that the membership renews until you cancel.',
      'Cancel any time under My Subscriptions in your Born 2 Game account. Perks stay on until the end of the month you paid for.'] },
    { v: 37, date: 'November 23, 2026', title: 'The Loot Goblin and a cleaner screen', items: [
      'Watch out for the Loot Goblin. From floor 8 a sneaky thief can jump your party. Kill it within 20 seconds or it runs off with an item from your pack. Gear you are wearing is never taken.',
      'If it gets away, a green note under your chapter goal shows the floor where it is hiding. Reach that floor and kill it to get your item back. Every goblin you kill drops six times the gold.',
      'On a computer the whole game now fits on one screen. Only the side panel scrolls.',
      'Ability buttons are bigger and easier to read: full names, a clear Ready glow and a cooldown bar.',
      'The Players Guild has its own Guild tab.',
      'Chat is now a floating window. Press Chat at the bottom right to open it, and the dash to tuck it away.',
      'Your Sigil balance shows as soon as the game opens.'] },
    { v: 36, date: 'November 23, 2026', title: 'Companion traits and a new Guide', items: [
      'Every story companion now has three traits, rolled when they join: a position trait for one party seat, a kinship trait that works beside a certain class, and a camp trait for resting at the fire.',
      'Working traits glow gold on the Party and Camp tabs. Rearrange your party to switch on as many as you can.',
      'Camp traits can boost a companion’s camp job, cut training costs, add gold or heal the party faster at camp.',
      'The Guide is rebuilt: topics sorted into categories, short points, and pictures.'] },
    { v: 35, date: 'November 23, 2026', title: 'Easier big numbers', items: [
      'Big numbers now read 2.40M, 13.1B and 250T (million, billion, trillion) instead of scientific notation.'] },
    { v: 34, date: 'November 23, 2026', title: 'Tonics at the Quartermaster', items: [
      'Seven new tonics: Draught of Fury (+15% damage), Ironbark Tonic (+15% health), Mender’s Brew (+20% healing), Keen-Eye Elixir (+5% crit), Prospector’s Luck (+15% gold), Seeker’s Charm (+15% gear drops) and Scholar’s Ink (+25% hero XP).',
      'Each lasts 10 or 15 minutes. Different tonics stack, and drinking the same one again adds time, up to an hour.',
      'Everything costs gold. The speed-ups (Prospector’s Luck, Seeker’s Charm, Scholar’s Ink and the Campfire Draught) can also be bought with Sigils. Open the Store on the camp bar.',
      'Tonics you carry show above your abilities. Tap one to drink it.'] },
    { v: 33, date: 'November 23, 2026', title: 'A new home', items: [
      'Lanternhold now lives at lanternhold.born2gamellc.com. The old address brings you here, along with the progress saved on your device.',
      'If you play with an account, sign in once more here. Your saved progress is waiting.'] },
    { v: 32, date: 'November 23, 2026', title: 'Bag of Holding', items: [
      'New in the store: the Bag of Holding. Buy it once for 6,500 Sigils and your pack never fills up again, so loot is never sold off for lack of space.',
      'Find it on the Gear tab next to your pack, under Market and Sigils, or in your profile.'] },
    { v: 31, date: 'November 23, 2026', title: 'Party invites', items: [
      'Recruiting a player now sends them an invite. Their hero joins your party only after they accept.',
      'Invites you receive show at the top of the Players Guild on the Party tab, with Accept and Decline. You also get a notice when one arrives.',
      'An accepted hero joins at camp. If your party is full, you choose who steps out.'] },
    { v: 30, date: 'November 23, 2026', title: 'A new look', items: [
      'Every hero, companion and monster has been redrawn as detailed illustrated art, with armor, cloth, lighting and glowing eyes.',
      'The dungeon, the doorway and the camp under the stars are redrawn too, with torchlight, flagstones and a crackling campfire.',
      'The arena now draws at your screen’s full sharpness.'] },
    { v: 29, date: 'November 23, 2026', title: 'Your character, and ambushes', items: [
      'Your hero now earns XP and levels up. Each level brings a stat point to spend on Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma or Luck. Find the character sheet at the top of the Skills tab.',
      'Each class favours two stats, and points there count half again. Luck touches everything: loot, chests, crits, gold, Sigil finds and ambush spoils.',
      'Ambushes: now and then two to four monsters team up and jump your party. They are tougher and strike the back of the line, but pay several times the gold and often drop gear.',
      'Resetting your stats costs 50 Sigils, so place points with care.',
      'Veteran heroes start with XP for their past fights, so you may have points waiting already.'] },
    { v: 28, date: 'November 23, 2026', title: 'Fly your banner', items: [
      'New Banner chat: talk only with heroes who fly the same banner as you. Find it next to Global in the chat.',
      'Banner kin: every party member who marches under your banner makes your banner perk 40% stronger. A full party of kin more than doubles it. Players you recruited before today need to be recruited again to count.'] },
    { v: 27, date: 'November 23, 2026', title: 'Daily quests and Sigils in the deep', items: [
      'New: daily quests. Three quests a day, the same for every hero. Each one pays 1 Sigil, and finishing all three pays 2 more. Tap the quest counter at the top of the screen.',
      'Treasure chests and guardians can now hold 1 to 3 Sigils. It is rare: about 0.05% per chest and 0.1% per guardian to start.',
      'Your odds grow as you go deeper (+0.01% for every 30 floors, up to +0.05%) and with the new Kindling upgrade Sigil Sense (+0.01% per rank, 5 ranks).',
      'Found Sigils go straight to your wallet when you are signed in. Up to 15 found Sigils can be banked each day.'] },
    { v: 26, date: 'November 23, 2026', title: 'The Lantern Pass and Born 2 Game sign-in', items: [
      'You can now sign in with your Born 2 Game store account. Press Continue with Born 2 Game on the sign-in screen. If you already linked your store account to a hero, it opens that hero.',
      'New: the Lantern Pass. For 500 Sigils you get 30 days of convenience: the Auto-train buttons, 10 extra bag slots and 4 more hours of offline earnings. It never adds power.',
      'Every hero gets a free 3-day trial, starting now. Open it from your profile or tap a locked Auto button.',
      'Sigils can be bought in the Born 2 Game store or bought from other players for gold on the Sigil exchange, so the pass is open to everyone.'] },
    { v: 25, date: 'November 23, 2026', title: 'Sigil packs and Mercy’s Blessing', items: [
      'New: Mercy’s Blessing. Whenever someone gives to the Grand War’s Mercy Corps, every hero gets +10% gold, +10% party health and +20% healing. Each $10, 5 food items or toy adds 2 hours, up to 7 days. Watch for the green heart at the top of the screen.',
      'Sigil packs are here: 500 for $4.99, 1,100 for $9.99, 2,400 for $19.99 and 6,500 for $49.99. Press Get Sigils on your profile or in the Sigil exchange.',
      'Sign in once with your Born 2 Game store account. Packs you buy in the store land in your hero’s wallet automatically, usually within a minute.',
      'Sigils still only buy looks, or gold from other players on the exchange. They never buy power.'] },
    { v: 24, date: 'November 23, 2026', title: 'Automatic updates', items: [
      'When a new version comes out, the game now saves your progress and reloads itself after a short countdown, so everyone always plays the latest version with the latest fixes.'] },
    { v: 23, date: 'November 23, 2026', title: 'Smaller numbers and the Sigil exchange', items: [
      'Gold, damage, health and prices have been rescaled. Numbers now stay small and plain, written out in full with commas instead of letters like K or M. The pace of the climb is about the same.',
      'Your gold was converted so it still buys the same amount of training. Your levels, floors, gear and Embers are unchanged.',
      'Embers now give +4% damage and gold each, and relics and gear percentages are smaller to match the new scale. Your party is just as strong for its depth as before.',
      'New in the Trading Post: the Sigil exchange. Sell Sigils to other players for gold, or buy theirs. Listings are sorted by the best price per Sigil.',
      'Global chat now welcomes every new hero, with the alliance they fight for.',
      'Gear listed on the market before this update is hidden from shoppers. If you had something listed, take it down from My listings and list it again at a new price.'] },
    { v: 22, date: 'November 23, 2026', title: 'Grand War auras', items: [
      'Verified Grand War commanders now carry an aura for their hero’s class. Tanks get the Bulwark Aura (party health, less damage taken), healers the Mending Aura (healing), rogues the Shadow Aura (gold, critical hits), mages the Ember Aura (party damage, critical hits) and necromancers the Grave Aura (party damage, gear drops).',
      'The aura grows with your rank on the Grand War ladder, from 2% at Recruit to 10% at the top rank. Past seasons as Grand Marshal or champion make it a quarter stronger each.',
      'War honors add their own bonus: Grand Marshal gives the Marshal’s Banner (+5% party damage), Alliance Champion the Champion’s Mantle (+5% party health) and Nexus Holder the Nexus Tithe (+10% gold).',
      'Your aura shows on your hero’s portrait. Auras are earned in the war and can never be bought.',
      'Your Sigils now show in the top bar when you are signed in. Tap them to open your profile.'] },
    { v: 21, date: 'November 22, 2026', title: 'Profiles, Sigils and Grand War badges', items: [
      'Your hero now has a profile card that other players see in the Players Guild: a frame, a title, a name color, a banner, up to six emblems and a short bio. Open it from your hero’s portrait and press Customize profile.',
      'Sigils buy looks for your card. Every account starts with 100. Looks never change your party’s power, and they stay with your account even through a server reset.',
      'Grand War commanders can link their commander name. Once the team confirms it, your war rank, alliance and honors show on your card and next to your name in the guild.',
      'Returning to camp now costs gold once you are past floor 10. The deeper you are, the more the climb costs, so a Campfire Draught is often the cheaper choice for a quick change.'] },
    { v: 20, date: 'November 22, 2026', title: 'One look, one war', items: [
      'The whole game now wears the Grand War colors: deep night-blue panels, war-gold highlights and the same lettering as the Grand War site, so the war pages and the rest of the game finally match.',
      'Tidier header on phones: everything fits on one line.'] },
    { v: 19, date: 'November 22, 2026', title: 'The world map', items: [
      'The map now fits on one screen. All fifteen regions sit along the road from the Hold to the Nyx Rift, each with its own painted window, ten floor pips and a check once its guardian falls.',
      'Tap a region to zoom in: its ten floors, story chapters and other delvers up close, with the region’s dossier beside it. Use the arrows to walk region to region, and World map to step back out.',
      'Your hero is marked on the map, and the badge on a region shows how many other delvers have reached it.'] },
    { v: 18, date: 'November 22, 2026', title: 'A map worth reading', items: [
      'The Map of the Deep is redrawn. Every region has its own painted scenery: lamp-lit cellars, glowing fungus, a lava river in the Cinder Forges, the drowned archive window, the Bastion walls, lightning on the Stormglass Spire and the Rift itself.',
      'Tap any region for its dossier: its history, which alliance’s warbands hold it, its native monster and trick, its guardian, the story chapters that happen there, and quick travel buttons.',
      'A strip of all fifteen regions across the top. Unexplored regions stay under the fog until you reach them.',
      'Other delvers from the leaderboard now appear on the map at their deepest floor.',
      'An expedition record shows regions charted, guardians felled and chapters seen, and the Act One seal waits at the bottom.'] },
    { v: 17, date: 'November 22, 2026', title: 'Auto-train and the night watch', items: [
      'New Auto toggle under each Train button. Switch it on and that character trains whenever you have the gold, cheapest level first. Companions at the campfire auto-train while you are at camp.',
      'While you are away your party earns a quarter of its usual gold, for up to 8 hours.',
      'Night Watch, a new Kindling upgrade, keeps your party earning 16 hours longer per rank, up to 3 days. After that, progress waits until you return.'] },
    { v: 16, date: 'November 22, 2026', title: 'The Grand War comes to the Deep', items: [
      'A Grand War strip across the top shows the current season, the week, and how long until the Rift surges. Tap it to open the war room.',
      'A new War page in the Codex: the three alliances with their banners, how the war began, the Nexus, the Mercy Corps, and how Lanternhold’s acts follow the war’s seasons.',
      'Alliance banner art when you pledge your hero.',
      'Lanternhold is a Grand War game by Born 2 Game, LLC.'] },
    { v: 15, date: 'November 22, 2026', title: 'Kindling upgrades and class changes', items: [
      'Four new ways to spend Kindling in the Skills tab: Lantern Edge (party damage), Ember Purse (gold), Deep Reservoir (lantern time) and Slow-burning Draught (longer Campfire Draughts). They are permanent.',
      'Change your hero’s class at camp for 15 Kindling. Every Kindling you spent on the skill tree comes back first. Pack space, gear slots and upgrades stay as they are.',
      'Gear your party wears no longer sits in the pack. It shows on each character, and the pack only counts what is free.'] },
    { v: 14, date: 'November 22, 2026', title: 'Specializations and a leaderboard', items: [
      'At camp the Gear tab shows your party first. Companions resting at the campfire are folded away underneath.',
      'Train anyone in your party anywhere, even deep in the dungeon. Companions resting at the campfire still train at camp.',
      'Specializations: each branch of your hero’s skill tree now ends in a new ability, 3 per class, for 15 in all. Learned abilities join the ability bar on keys 6 to 8.',
      'A Leaderboard in the Codex shows the deepest delvers across the Reach.',
      'Admins can now reset the server for a fresh season and remove players who break the rules.'] },
    { v: 13, date: 'November 22, 2026', title: 'Act One: below the Starless Vault', items: [
      'Seven new regions below the Starless Vault: the Glass Wastes, the Ironbound Bastion, the Weeping Aqueduct, the Bone Orchard, the Stormglass Spire, the Nexus Scar and the Rift Threshold.',
      'The story goes on through chapter 15, with seven new guardians and the truth about the Lampmother waiting on floor 150.',
      'Monsters now have tricks: Enraged, Warded, Regenerating, Venomous, Cleaving and Swift. Each region has its own favourite, and guardians get more of them the deeper you go.',
      'Act One ends on floor 150. Act Two opens with Season 2 of the Grand War, and the game counts down to it once you get there.',
      'Seven new monsters for the Bestiary, plus new journal pages for every region and guardian.',
      'Tap any gear slot on the Gear tab to see every piece that fits it, compared with what is worn now, and equip one straight from the list.'] },
    { v: 12, date: 'November 22, 2026', title: 'Skill trees, Kindling and a full set of gear slots', items: [
      'Every class now has a skill tree for your hero, with three branches of three skills each.',
      'Rekindling gives Kindling: 2 at floor 50, plus 1 for every 10 floors deeper. If you rekindled before today, you already have 2 for each time.',
      'Spend Kindling on skills, a bigger pack, extra rings (up to 5) and a second trinket slot for any character.',
      'Gear now has real slots: main hand, offhand, helmet, trinket, chest, legs, feet and rings. Robes cover the chest and legs together. Your old weapons, armor and trinkets moved into their new slots.',
      'At camp the party sits around a campfire. Nobody fights while you rest, and everyone heals up.',
      'The side panel is split into Party, Camp, Gear, Skills, Market and Codex, so there is far less scrolling.',
      'Rare gear can carry a camp-job bonus, marked with an orange dot. It boosts that job while the wearer works it at the campfire.',
      'Six new job sets, one for each camp job, drop very rarely from guardians and chests from floor 20. Two pieces give +40% to that job, three give +100%.',
      'A new Market tab: browse gear as a grid of cards, filter by slot and rarity, sort by price or power, and tap a card to compare it with what you wear before you buy. Mailbox and Players Guild sit right beside it.'] },
    { v: 11, date: 'November 22, 2026', title: 'Camp jobs and rarer loot', items: [
      'Companions at the campfire can take camp jobs: Forager, Runesmith, Herbalist, Armorer, Prospector and Lamplighter.',
      'Each job helps the whole party all the time. It grows with the companion’s level and is stronger when it suits their class, so it pays to train your whole roster.',
      'Train resting companions right at the campfire.',
      'Gear is rarer now, and high-tier gear starts very rare and gets more common the deeper you go. Thanks for the feedback, Chipplin.',
      'Guardians no longer always drop gear, and set pieces are rarer.',
      'Items have a level requirement, shown in the corner of each piece. Companions must reach it to wear the item.',
      'Monsters get tougher faster the deeper you go. The first floors are gentler than before.',
      'Rekindling now unlocks at floor 50 and gives fewer Embers, so each one is a bigger milestone.',
      'A new item window with a clear stat block, comparison, and upgrade preview.',
      'When a companion heads back to camp mid-run you see them walk off, their seat says they returned to camp, and their bonus leaves with them.',
      'In the dungeon the Gear tab only shows the party you brought. Your campfire roster appears again once you are back at camp.'] },
    { v: 10, date: 'November 22, 2026', title: 'Make camp', items: [
      'Party changes now happen at camp, at the top of the stair: swapping companions, recruiting, training companions and changing gear.',
      'Return to camp from the camp bar in the Party or Gear tab, then Descend straight back to where you were.',
      'New Campfire Draught: make camp anywhere for 60 seconds. You start with one.',
      'New Lantern Oil: 15 more seconds against a guardian.',
      'The Quartermaster’s store by the campfire sells both.',
      'Your own hero can still train anywhere, and you can rearrange the marching order at any time.'] },
    { v: 9, date: 'November 22, 2026', title: 'The Trading Post', items: [
      'A market: list gear for gold, browse what other players are selling, and buy it.',
      'Player mail: send gear to players you have recruited or chatted with, as a gift or with a price they can accept or decline.',
      'Sales and payments arrive in your mailbox. A badge on the bag button shows new mail.'] },
    { v: 8, date: 'November 22, 2026', title: 'A cleaner look', items: [
      'New gear screen: see each companion holding their gear, with weapon, armor and trinket slots and your pack laid out as an inventory grid.',
      'Hand-drawn pixel icons for every weapon, armor and trinket, framed in their rarity colour.',
      'Party portraits now show each companion’s pixel art.',
      'Easier to swap companions: every seat has a To campfire button, and recruiting with a full party asks who steps out.',
      'Tabs have icons, and on phones they sit in a bar along the bottom of the screen.',
      'Formation tips fold away until you want them.'] },
    { v: 7, date: 'November 22, 2026', title: 'Campfire and Players Guild', items: [
      'Every game is now multiplayer. Your progress is untouched.',
      'The Campfire: story companions rest here. Bring them along whenever you like, and see who joins next.',
      'The Players Guild: recruit heroes made by other players. Heroes whose owners are playing right now are marked Online now.',
      'A Players Guild button at the top of the Party tab takes you straight there.',
      'Raised skeletons now visibly lunge and claw at monsters (thanks for the suggestion, Chipplin).'] },
    { v: 6, date: 'November 22, 2026', title: 'Help for new delvers', items: [
      'A step-by-step tutorial for new players that points at the real buttons.',
      'The Delver’s Guide: open the ? at the top for a handbook on every system.',
      'Mass scrap in the Gear tab: salvage many pieces at once by rarity, keeping your best and upgraded gear.',
      'These patch notes. They open once after each update, and you can find them in the Guide.'] },
    { v: 5, date: 'November 22, 2026', title: 'Chat, map and item links', items: [
      'Chat with Global, Trade and Party channels (free account needed). Tap a name to mute or report.',
      'Ctrl+click an item, or use Link in chat, to show it off in chat.',
      'The Map of the Deep: see every region, the guardians you have beaten, and travel back to any floor.',
      'An Update ready button appears at the top when a new version is out.'] },
    { v: 4, date: 'November 22, 2026', title: 'Marching order', items: [
      'Rearrange your party. The front takes the hits, so keep your tank there.',
      'Healers heal less the farther they stand from who they heal.',
      'Some monsters ambush from behind and strike the rear first. A tank at the back guards it.'] },
    { v: 3, date: 'November 22, 2026', title: 'Gear made clear', items: [
      'The Gear tab shows what fits each companion, with Equip buttons, upgrade tags and Equip best.',
      'Tap any companion for their profile: bio, alliance, class, ability, stats and gear.',
      'Multiplayer: the hero board is live. Recruit other players’ heroes and earn gold when yours is recruited.'] },
    { v: 2, date: 'November 22, 2026', title: 'A front of the Grand War', items: [
      'Create your own hero and lead a party of five: Tank, Healer, Rogue, Mage and Necromancer.',
      'Monsters fight back. Healers and tanks matter.',
      'A 15-chapter story set beneath the Hold, on a hidden front of the Grand War. Pledge your banner when you start.',
      'Class gear with rarities, upgrades and five class sets. A lore journal that fills as you explore.',
      'Solo and Multiplayer modes. Optional accounts with cloud saves.'] },
  ];
  const NOTES_V = PATCH_NOTES[0].v;
  function openNotes() {
    S.seenNotes = NOTES_V; save();
    modal('<div class="maphead"><div><h2>What’s new</h2><small>Patch notes for Lanternhold.</small></div><button class="iconbtn" id="n-x" aria-label="Close">&times;</button></div><div class="notes">' +
      PATCH_NOTES.map((n, i) => '<section' + (i ? '' : ' class="latest"') + '><div class="nh"><b>' + esc(n.title) + '</b><span>' + esc(n.date) + (i ? '' : ' · Latest') + '</span></div><ul>' + n.items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></section>').join('') +
      '</div><div class="row"><button class="btn" id="n-ok">Back to the Deep</button></div>', md => { md.querySelector('#n-x').onclick = closeModal; md.querySelector('#n-ok').onclick = closeModal; });
  }
  // Show once after an update, when nothing else is on screen. Brand-new players get the tutorial instead.
  if (S.hero && !S.seenNotes && S.tut && !S.tut.done) S.seenNotes = NOTES_V;
  setInterval(() => { if (S.hero && (S.seenNotes || 0) < NOTES_V && $('modal').hidden && !sceneOpen && !(S.tut && !S.tut.done)) openNotes(); }, 3000);
  // ---------- trading post: market and player mail ----------
  // Items and gold live in each player's save, so the client moves them; the server keeps
  // listings, offers and letters so both sides see the same thing.
  const trade = { view: 'market', cls: null, mine: false, list: null, mail: null, msg: '', busy: false, slot: 'all', rar: 'all', sort: 'cheap' };
  const tradeItem = it => L.normItem({ cls: it.cls, slot: it.slot, rar: it.rar, set: it.set || undefined, jset: it.jset || undefined, aff: it.aff || undefined, en: typeof it.en === 'string' ? it.en : '', ilvl: it.ilvl, up: it.up || 0 });
  const fromServer = it => Object.assign(tradeItem(it), { uid: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
  // Letters and listings from before the gold rescale are shown and paid in today's gold.
  const nowGold = (g, at) => at && at < L.ECON_AT ? Math.max(1, Math.round(L.regold(g, L.lvl(S, 'you')))) : g;
  const bagFull = () => L.packCount(S) >= L.bagCap(S);
  const shTile = k => '<div class="tile shtile sh' + k + '">' + icon('relic') + '</div>';
  const shName = (k, n) => n + ' ' + (L.WB_SETS[k] ? L.WB_SETS[k].word : 'boss') + ' shard' + (n === 1 ? '' : 's');
  const tradeTile = it => it.shard != null ? shTile(it.shard) : it.sig ? '<div class="tile sigtile">' + sigil + '</div>' : (L.normItem(it), '<div class="tile r-' + it.rar + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + '</div>');
  const tradeName = it => it.shard != null ? shName(it.shard, it.n) : it.sig ? it.sig.toLocaleString() + ' ' + TOKEN : esc(L.gearName(it)) + (it.up ? ' +' + it.up : '');
  const tradeSub = it => (L.normItem(it), 0) || L.RARITY.find(r => r.id === it.rar).name + ' ' + L.CLASSES[it.cls].name.toLowerCase() + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; ' + itemEffect(it);
  const tradeErr = (e, what) => {
    const c = e && e.code;
    if (what === 'send' && e && e.status === 404) return 'That player could not be found. They may need to sign in again.';
    if (what === 'send' && e && e.status === 400) return 'That offer could not be sent. You may have 20 offers waiting already.';
    if (what === 'sig') return c === 'full' ? 'You have 5 Sigil listings already. Take one down first.' : c === 'state' ? 'You do not have that many Sigils.' : c === 'gone' || (e && e.status === 404) ? 'Someone else bought those Sigils first.' : e && e.status === 401 ? 'Sign in again to trade.' : 'The Sigil exchange could not be reached. Try again in a moment.';
    return c === 'full' ? (what === 'list' ? 'You have ' + MKT_CAP + ' items listed already. Take one down first.' : 'You have 20 offers waiting already. Recall one first.')
      : c === 'gone' || (e && e.status === 404) ? 'That is no longer available.'
      : c === 'nobody' ? 'That player has not published a hero yet.'
      : e && e.status === 401 ? 'Sign in again to trade.' : 'The Trading Post could not be reached. Try again in a moment.';
  };
  function takeFromBag(uid) {
    const it = L.itemOf(S, uid); if (!it) return null;
    const w = L.wearer(S, uid); if (w) L.unequip(S, w, L.wornPos(S, uid));
    S.bag = S.bag.filter(x => x.uid !== uid);
    return it;
  }
  function afterTrade() { save(); try { pushCloud(true); } catch (e) {} updateGear(true); updateSeats(true); }

  async function loadMarket() {
    trade.list = null; trade.msg = 'Opening the stalls…'; paintTrade();
    try { const r = await chatCall('GET', '/market?' + (trade.mine ? 'mine=1' : 'cls=' + trade.cls)); trade.list = (r.listings || []).filter(l => trade.mine || !(l.at < L.ECON_AT)).map(l => Object.assign(l, { price: nowGold(l.price, l.at) })); trade.me = r.me; trade.msg = ''; }
    catch (e) { trade.msg = tradeErr(e); }
    paintTrade();
  }
  async function loadSigils() {
    trade.sig = null; trade.msg = 'Opening the Sigil exchange…'; paintTrade();
    try { trade.sig = await chatCall('GET', '/sigils'); trade.msg = ''; if (!prof) await loadProfile(); } catch (e) { trade.msg = tradeErr(e, 'sig'); }
    paintTrade();
  }
  // The Sigil exchange: cheapest gold per Sigil first. Buying moves the Sigils to your account and the gold to the seller's mailbox.
  function sigilsView() {
    let h = '<div class="sigex"><div class="sigbal">' + sigil + '<span>You have <b>' + (prof ? prof.bal.toLocaleString() : '…') + '</b> ' + TOKEN + '</span><button class="btn small ghost" id="s-get">Get Sigils</button></div>';
    if (!S.boh) h += '<div class="sigbal boh">' + icon('bag') + '<span><b>Bag of Holding</b>: an endless pack, bought once for ' + fmt(L.BOH_COST) + ' ' + TOKEN + '.</span><button class="btn small ghost" id="s-boh">See it</button></div>';
    if (!L.canUse(S, 'sell')) return h + '<div class="lockrow">' + icon('lock') + '<div><b>The Sigil exchange opens at hero level ' + L.unlockOf('sell').lv + '</b><small>' + esc(lockMsg('sell')) + ' Sigils from the store work any time.</small></div></div></div>';
    if (trade.msg) h += '<p class="note">' + esc(trade.msg) + '</p>';
    const x = trade.sig;
    if (x) {
      const per = l => l.price / l.n, pf = v => v >= 100 ? fmt(Math.round(v)) : (Math.round(v * 10) / 10).toLocaleString();
      const others = x.listings.filter(l => l.seller !== x.me);
      h += '<h3 class="sub">For sale</h3>' + (others.length ? '<div class="tlist">' + others.map(l => '<div class="trow"><div class="tile sigtile">' + sigil + '</div><div class="tinfo"><b>' + l.n.toLocaleString() + ' ' + TOKEN + '</b><small>From ' + esc(l.name) + ' &middot; ' + pf(per(l)) + ' gold each</small></div><div class="tact"><span class="price">' + icon('coin') + fmt(l.price) + '</span><button class="btn small" data-sbuy="' + l.id + '"' + (l.price > S.gold ? ' disabled title="Not enough gold"' : '') + '>Buy</button></div></div>').join('') + '</div>'
        : '<div class="mkempty">' + sigil + '<b>No Sigils for sale right now</b><small>Check back later, or sell some of your own below.</small></div>');
      h += '<h3 class="sub">Sell Sigils</h3><div class="sigform"><label>Sigils<input id="s-n" type="number" min="1" step="1" value="100"></label><label>Total price in gold<input id="s-p" type="number" min="1" step="1" placeholder="' + (others[0] ? Math.round(per(others[0]) * 100) : 100) + '"></label><button class="btn small" id="s-list">List for sale</button></div>' +
        '<p class="note small">Your Sigils are held while they are listed. Take a listing down any time to get them back. When they sell, the gold arrives in your mailbox.' + (others[0] ? ' The cheapest listing right now is ' + pf(per(others[0])) + ' gold per Sigil.' : '') + '</p>';
      if (x.mine.length) h += '<h3 class="sub">Your listings</h3><div class="tlist">' + x.mine.map(l => '<div class="trow"><div class="tile sigtile">' + sigil + '</div><div class="tinfo"><b>' + l.n.toLocaleString() + ' ' + TOKEN + '</b><small>' + pf(per(l)) + ' gold each</small></div><div class="tact"><span class="price">' + icon('coin') + fmt(l.price) + '</span><button class="btn ghost small" data-scancel="' + l.id + '">Take down</button></div></div>').join('') + '</div>';
    }
    return h + '</div>';
  }
  // Boss shards (v105): each world boss drops a few shards of its own, drawn by lottery among everyone who fought.
  // They upgrade that boss's Legendary set and trade here for gold. Listed shards leave your stash until sold or taken down.
  async function loadShards() {
    trade.sh = null; trade.msg = 'Opening the shard stall…'; paintTrade();
    try { const [a, m] = await Promise.all([chatCall('GET', '/shards'), chatCall('GET', '/shards?mine=1')]); trade.sh = { me: a.me, l: a.l || [], mine: m.l || [] }; trade.msg = ''; }
    catch (e) { trade.msg = e && e.status === 404 ? 'The shard stall opens soon.' : tradeErr(e); }
    paintTrade();
  }
  function shardsView() {
    const have = L.shardsOf(S);
    let h = '<div class="sigex"><div class="shhave">' + L.WB_SETS.map((b, k) => '<span class="shchip sh' + k + '">' + icon('relic') + '<b>' + (have[k] || 0) + '</b> ' + b.word + '</span>').join('') + '</div>' +
      '<p class="note small">Boss shards drop from world bosses, drawn by lottery among everyone who fought. Each boss’s shards upgrade its own Legendary set.</p>';
    if (trade.msg) h += '<p class="note">' + esc(trade.msg) + '</p>';
    const x = trade.sh; if (!x) return h + '</div>';
    const others = x.l.filter(l => l.seller !== x.me).sort((a, b) => a.price / a.n - b.price / b.n);
    const row = (l, act) => '<div class="trow">' + shTile(l.k) + '<div class="tinfo"><b>' + shName(l.k, l.n) + '</b><small>' + (act === 'buy' ? 'From ' + esc(l.name) + ' &middot; ' : '') + fmt(Math.round(l.price / l.n)) + ' gold each</small></div><div class="tact"><span class="price">' + icon('coin') + fmt(l.price) + '</span>' +
      (act === 'buy' ? '<button class="btn small" data-hbuy="' + l.id + '"' + (l.price > S.gold ? ' disabled title="Not enough gold"' : '') + '>Buy</button>' : '<button class="btn ghost small" data-hcancel="' + l.id + '">Take down</button>') + '</div></div>';
    h += '<h3 class="sub">For sale</h3>' + (others.length ? '<div class="tlist">' + others.map(l => row(l, 'buy')).join('') + '</div>' : '<div class="mkempty">' + icon('relic') + '<b>No shards for sale right now</b><small>Check back after the next world boss.</small></div>');
    h += '<h3 class="sub">Sell shards</h3><div class="sigform"><label>Boss<select id="h-k">' + L.WB_SETS.map((b, k) => '<option value="' + k + '">' + b.word + ' (' + (have[k] || 0) + ')</option>').join('') + '</select></label><label>Shards<input id="h-n" type="number" min="1" max="99" step="1" value="1"></label><label>Total price in gold<input id="h-p" type="number" min="1" step="1"></label><button class="btn" id="h-list">List</button></div>' +
      '<p class="note small">Your shards are held while they are listed. When they sell, the gold arrives in your mailbox.</p>';
    if (x.mine.length) h += '<h3 class="sub">Your listings</h3><div class="tlist">' + x.mine.map(l => row(l, 'mine')).join('') + '</div>';
    return h + '</div>';
  }
  async function loadMail(quiet) {
    if (!quiet) { trade.msg = 'Checking your mail…'; paintTrade(); }
    try { trade.mail = await chatCall('GET', '/mail'); for (const l of trade.mail.inbox.concat(trade.mail.outbox)) if (l.type === 'offer') l.price = nowGold(l.price, l.at); trade.msg = ''; } catch (e) { if (!quiet) trade.msg = tradeErr(e); }
    const n = trade.mail ? trade.mail.inbox.length : 0;
    $('tradedot').hidden = !n; $('tradedot').textContent = n > 9 ? '9+' : n; if ($('mailn')) $('mailn').textContent = n ? n : '';
    if (!quiet) paintTrade();
  }

  // The trading post lives in the Market tab: Market, Mailbox and Players Guild.
  function openTrade(view) {
    if (view) trade.view = view;
    if (typeof tab === 'undefined' || tab !== 'market') { switchTab('market'); return; }
    showMarketView();
  }
  function showMarketView() {
    document.querySelectorAll('#mktseg button').forEach(b => b.classList.toggle('on', b.dataset.mv === trade.view));
    if (trade.view === 'guild') trade.view = 'market';
    if (!trade.cls) { const m = L.memberById('you'); trade.cls = m ? m.cls : 'tank'; }
    paintTrade();
    if (!CL || !signedIn()) return;
    if (trade.view === 'market') loadMarket(); else if (trade.view === 'sigils') loadSigils(); else if (trade.view === 'shards') loadShards(); else loadMail();
  }
  const SLOT_FILTER = [['all', 'All slots'], ['main', 'Main hand'], ['off', 'Offhand'], ['head', 'Helmet'], ['neck', 'Trinket'], ['chest', 'Chest'], ['robe', 'Robe'], ['legs', 'Legs'], ['feet', 'Feet'], ['ring', 'Ring']];
  const RAR_FILTER = [['all', 'Any rarity'], ['fine', 'Fine and up'], ['rare', 'Rare and up'], ['epic', 'Epic and set']];
  const rarRank = r => ['common', 'fine', 'rare', 'epic', 'set'].indexOf(r);
  function shownListings() {
    let list = (trade.list || []).filter(l => { L.normItem(l.item); return true; });
    if (trade.slot !== 'all') list = list.filter(l => l.item.slot === trade.slot);
    if (trade.rar !== 'all') list = list.filter(l => rarRank(l.item.rar) >= rarRank(trade.rar));
    const by = { cheap: (a, b) => a.price - b.price, new: (a, b) => b.at - a.at, power: (a, b) => L.itemScore(b.item) - L.itemScore(a.item), level: (a, b) => a.item.ilvl - b.item.ilvl };
    return list.slice().sort(by[trade.sort] || by.cheap);
  }
  // How a listed item compares with what your best-fitting character of that class wears now.
  function marketOwner(it) { const ids = S.unlocked.filter(id => { const m = L.memberById(id); return m && !m.guest && m.cls === it.cls; }); return ids.includes('you') ? 'you' : ids[0] || null; }
  function marketCmp(it) {
    const id = marketOwner(it); if (!id) return '';
    const d = Math.round((L.itemScore(it) - L.replaces(S, id, it).reduce((a, x) => a + L.itemScore(x), 0)) * 100);
    return d > 0 ? '<span class="cmp up">&#9650; ' + d + '%</span>' : d < 0 ? '<span class="cmp down">&#9660; ' + (-d) + '%</span>' : '<span class="cmp eq">Same</span>';
  }
  function paintTrade() {
    const box = $('tradebox'); if (!box) return;
    const n = trade.mail ? trade.mail.inbox.length : 0; $('mailn').textContent = n ? n : '';
    let h = '';
    if (!CL) h = '<p class="note">The Trading Post is not available right now. Try again later.</p>';
    else if (!signedIn()) h = '<div class="mkempty">' + icon('lock') + '<b>Sign in to trade</b><small>The market and mailbox need a free account so other players can see your listings.</small><button class="btn small" id="t-signin">Sign in</button></div>';
    else if (trade.view === 'sigils') h += sigilsView();
    else if (trade.view === 'shards') h += shardsView();
    else if (trade.view === 'market') {
      h += '<div class="whoseg tradecls">' + L.CLASS_ORDER.map(c => '<button class="whochip c-' + c + (!trade.mine && trade.cls === c ? ' on' : '') + '" data-tc="' + c + '"><img src="' + SP.spriteURL(c, 2) + '" alt=""><span>' + L.CLASSES[c].name + '</span></button>').join('') +
        '<button class="whochip' + (trade.mine ? ' on' : '') + '" data-tc="mine"><span>My listings</span></button></div>';
      const sel = (id, opts, v) => '<select id="' + id + '">' + opts.map(([k, t]) => '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
      h += '<div class="mkfilters">' + sel('tf-slot', SLOT_FILTER, trade.slot) + sel('tf-rar', RAR_FILTER, trade.rar) + sel('tf-sort', [['cheap', 'Cheapest first'], ['new', 'Newest first'], ['power', 'Strongest first'], ['level', 'Lowest level first']], trade.sort) + '</div>';
      if (trade.msg) h += '<p class="note">' + esc(trade.msg) + '</p>';
      if (trade.list) {
        const list = shownListings();
        h += list.length ? '<div class="mkgrid">' + list.map(l => {
          const it = l.item, mine = trade.mine || l.seller === trade.me, rar = L.RARITY.find(r => r.id === it.rar);
          return '<button class="mkcard r-' + it.rar + '" data-tview="' + l.id + '">' + tradeTile(it) +
            '<span class="mkname r-' + it.rar + '">' + tradeName(it) + '</span>' +
            '<span class="mkmeta">' + rar.name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; power level ' + L.reqLevel(it) + '</span>' +
            '<span class="mkfoot"><span class="price">' + icon('coin') + fmt(l.price) + '</span>' + (mine ? '<span class="mkmine">Yours</span>' : marketCmp(it)) + '</span></button>';
        }).join('') + '</div>' : '<div class="mkempty">' + icon('bag') + '<b>' + (trade.mine ? 'Nothing for sale yet' : 'No matching ' + L.CLASSES[trade.cls].name.toLowerCase() + ' gear') + '</b><small>' + (trade.mine ? 'Tap an item in your Gear tab and choose Sell to list it here.' : (trade.list.length ? 'Try a wider filter.' : 'Check back later, or list something of your own.')) + '</small></div>';
      }
    } else {
      if (trade.msg) h += '<p class="note">' + esc(trade.msg) + '</p>';
      const mb = trade.mail;
      if (mb) {
        const letters = mb.inbox.filter(l => l.type !== 'offer'), offers = mb.inbox.filter(l => l.type === 'offer');
        if (!mb.inbox.length) h += '<div class="mkempty">' + icon('chat') + '<b>No new mail</b><small>Players can send you gear as a gift, or with a price you can accept or decline.</small></div>';
        if (letters.length > 1) h += '<div class="row"><button class="btn small" id="t-claimall">Collect all (' + letters.length + ')</button></div>';
        h += '<div class="tlist">' + letters.map(l => {
          const what = l.type === 'sale' ? esc(l.fromName) + ' bought your ' + tradeName(l.item) + '.'
            : l.type === 'payment' ? esc(l.fromName) + ' accepted your offer and paid for ' + tradeName(l.item) + '.'
            : esc(l.fromName) + ' declined your offer. Your ' + tradeName(l.item) + ' came back.';
          return '<div class="trow">' + tradeTile(l.item) + '<div class="tinfo"><b>' + (l.type === 'return' ? 'Returned' : 'Gold for you') + '</b><small>' + what + '</small></div><div class="tact">' + (l.gold ? '<span class="price">' + icon('coin') + fmt(nowGold(l.gold, l.at)) + '</span>' : '') + '<button class="btn small" data-tclaim="' + l.id + '">Collect</button></div></div>';
        }).join('') + offers.map(l => '<div class="trow">' + tradeTile(l.item) + '<div class="tinfo"><b class="r-' + l.item.rar + '">' + tradeName(l.item) + '</b><small>' + tradeSub(l.item) + '</small><small>From ' + esc(l.fromName) + (l.note ? ': “' + esc(l.note) + '”' : '') + '</small></div><div class="tact">' +
          (l.price ? '<span class="price">' + icon('coin') + fmt(l.price) + '</span>' : '<span class="gift">Gift</span>') +
          '<button class="btn small" data-taccept="' + l.id + '"' + (l.price > S.gold ? ' disabled title="Not enough gold"' : '') + '>' + (l.price ? 'Pay and take' : 'Accept') + '</button><button class="btn ghost small" data-tdecline="' + l.id + '">Decline</button></div></div>').join('') + '</div>';
        if (mb.outbox.length) h += '<h3 class="sub">Waiting for an answer</h3><div class="tlist">' + mb.outbox.map(l => '<div class="trow">' + tradeTile(l.item) + '<div class="tinfo"><b class="r-' + l.item.rar + '">' + tradeName(l.item) + '</b><small>To ' + esc(l.toName) + (l.price ? ' for ' + fmt(l.price) + ' gold' : ' as a gift') + '</small></div><div class="tact"><button class="btn ghost small" data-trecall="' + l.id + '">Take back</button></div></div>').join('') + '</div>';
      }
    }
    h += '<p class="note small mknote">To sell or send gear, tap it in your Gear tab. Gold and gear are in-game only and have no real-money value.</p>';
    box.innerHTML = h;
  }
  // A listing up close: stats, how it compares, and Buy.
  function listingModal(id) {
    const l = (trade.list || []).find(x => x.id === id); if (!l) return;
    const it = L.normItem(l.item), rar = L.RARITY.find(r => r.id === it.rar), mine = trade.mine || l.seller === trade.me;
    const owner = marketOwner(it), reps = owner ? L.replaces(S, owner, it) : [], cur = {};
    for (const r of reps) for (const [k, v] of L.itemStats(r)) cur[k] = (cur[k] || 0) + v;
    const pc = v => '+' + Math.round(v * 100) + '%';
    const stats = L.itemStats(it).map(([k, v]) => { const d = owner ? Math.round((v - (cur[k] || 0)) * 100) : 0;
      return '<div class="ist"><span>' + k + '</span><b>' + pc(v) + '</b>' + (owner ? '<em class="' + (d > 0 ? 'up' : d < 0 ? 'down' : 'eq') + '">' + (d > 0 ? '&#9650; ' + d + '%' : d < 0 ? '&#9660; ' + (-d) + '%' : 'same') + '</em>' : '') + '</div>'; }).join('');
    const om = owner && L.memberById(owner);
    const set = it.set && L.SETS.find(x => x.id === it.set), js = it.jset && L.JOB_SETS[it.jset];
    modal('<div class="icard r-' + it.rar + '"><button class="iconbtn icx" id="l-x" aria-label="Close">&times;</button>' +
      '<div class="ihero">' + tradeTile(it).replace('class="tile', 'class="tile big') + '<div class="ititle"><span class="irar">' + rar.name + ' ' + L.CLASSES[it.cls].name + ' ' + L.SLOT_NAME[it.slot] + '</span><h2>' + tradeName(it) + '</h2><small>Requires power level <b class="' + (om && !L.canWear(S, owner, it) ? 'bad' : '') + '">' + L.reqLevel(it) + '</b> &middot; found on floor ' + it.ilvl + '</small></div></div>' +
      '<div class="istats">' + stats + '</div>' +
      (om ? '<p class="icmp">' + (reps.length ? 'Compared with ' + esc(om.name) + '’s ' + reps.map(r => esc(L.gearName(r))).join(' and ') + '.' : esc(om.name) + ' has an open ' + L.SLOT_NAME[it.slot].toLowerCase() + ' slot.') + '</p>' : '<p class="icmp">You have no ' + L.CLASSES[it.cls].name.toLowerCase() + ' yet to wear this.</p>') +
      (it.aff ? '<div class="iaff">' + icon('flame') + '<span><b>+' + Math.round(it.aff.v * (1 + 0.1 * it.up) * 100) + '% ' + (L.JOBS.find(j => j.id === it.aff.j) || {}).name + ' job</b><small>Counts while the wearer works that job at the campfire.</small></span></div>' : '') +
      (js ? '<div class="iset"><b>' + js.name + '</b><small><em>2 pieces</em> +' + Math.round(L.JOB_SET_TWO * 100) + '% job output</small><small><em>3 pieces</em> +' + Math.round(L.JOB_SET_THREE * 100) + '% job output</small></div>' : '') +
      (set ? '<div class="iset"><b>' + set.name + '</b><small><em>2 pieces</em> ' + set.two + '</small><small><em>3 pieces</em> ' + set.three + '</small></div>' : '') +
      '<div class="mkseller"><span>' + (mine ? 'Your listing' : 'Sold by <b>' + esc(l.name) + '</b>') + '</span><span class="price big">' + icon('coin') + fmt(l.price) + '</span></div>' +
      '<div class="iacts">' + (mine ? '<button class="btn ghost" id="l-down">Take it down</button>' : '<button class="btn" id="l-buy"' + (l.price > S.gold ? ' disabled' : '') + '>' + (l.price > S.gold ? 'Not enough gold' : 'Buy for ' + fmt(l.price) + ' gold') + '</button>') + '<button class="btn ghost" id="l-close">Back to market</button></div></div>', md => {
        md.querySelector('#l-x').onclick = closeModal; md.querySelector('#l-close').onclick = closeModal;
        const b = md.querySelector('#l-buy'); if (b) b.onclick = () => { closeModal(); doBuy(l.id); };
        const d = md.querySelector('#l-down'); if (d) d.onclick = () => { closeModal(); doCancel(l.id, l.cls); };
      });
  }
  const doBuy = id => tradeAct(async () => {
    const l = trade.list.find(x => x.id === id); if (!l) return;
    if (bagFull()) { toast('bag', 'Your pack is full', 'Salvage something first.', 'warn'); return; }
    if (l.price > S.gold) return;
    const r = await chatCall('POST', '/market/buy', { id: l.id, cls: l.cls, name: S.hero.name });
    S.gold -= r.price; S.bag.push(fromServer(r.item)); afterTrade(); sfx.coin();
    toast('bag', 'Bought ' + L.gearName(L.normItem(r.item)), 'It is in your pack now.', 'feat'); loadMarket();
  });
  const doCancel = (id, cls) => tradeAct(async () => {
    if (bagFull()) { toast('bag', 'Your pack is full', 'Salvage something first, then take your listing down.', 'warn'); return; }
    const r = await chatCall('POST', '/market/cancel', { id, cls });
    S.bag.push(fromServer(r.item)); afterTrade(); toast('bag', 'Listing taken down', 'The item is back in your pack.', ''); loadMarket();
  });
  async function tradeAct(fn, what) {
    if (trade.busy) return; trade.busy = true;
    try { await fn(); } catch (e) { toast('lock', 'Trade did not go through', tradeErr(e, what), 'warn'); }
    trade.busy = false;
  }
  $('mktseg').addEventListener('click', e => { const b = e.target.closest('[data-mv]'); if (!b) return; trade.view = b.dataset.mv; trade.msg = ''; showMarketView(); });
  $('tradebox').addEventListener('change', e => {
    const id = e.target.id; if (!id || id.slice(0, 3) !== 'tf-') return;
    trade[id.slice(3)] = e.target.value; paintTrade();
  });
  $('tradebox').addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (t.id === 't-signin') { authForm('in'); return; }
    if (t.id === 's-get') { getSigils(); return; }
    if (t.id === 's-boh') { openBoh(); return; }
    if (t.id === 's-list') tradeAct(async () => {
      const n = Math.floor(+$('s-n').value), p = Math.floor(+$('s-p').value);
      if (!(n >= 1) || !(p >= 1)) { toast('lock', 'Check the numbers', 'Enter how many Sigils to sell and a total price in gold.', 'warn'); return; }
      if (prof && n > prof.bal) { toast('lock', 'Not enough Sigils', 'You have ' + prof.bal.toLocaleString() + ' ' + TOKEN + '.', 'warn'); return; }
      await chatCall('POST', '/sigils/list', { n, price: p, name: S.hero.name });
      if (prof) prof.bal -= n; sfx.coin(); toast('coin', 'Listed', n.toLocaleString() + ' ' + TOKEN + ' for ' + fmt(p) + ' gold.', ''); loadSigils();
    }, 'sig');
    if (d.sbuy) tradeAct(async () => {
      const l = trade.sig && trade.sig.listings.find(x => x.id === d.sbuy); if (!l || l.price > S.gold) return;
      const r = await chatCall('POST', '/sigils/buy', { id: l.id, name: S.hero.name });
      S.gold -= r.price; if (prof) prof.bal = r.bal; afterTrade(); sfx.coin();
      toast('coin', 'Sigils bought', '+' + r.n.toLocaleString() + ' ' + TOKEN + ' for ' + fmt(r.price) + ' gold.', 'feat'); loadSigils();
    }, 'sig');
    if (d.scancel) tradeAct(async () => {
      const r = await chatCall('POST', '/sigils/cancel', { id: d.scancel });
      if (prof) prof.bal = r.bal; toast('coin', 'Listing taken down', r.n.toLocaleString() + ' ' + TOKEN + ' are back in your account.', ''); loadSigils();
    }, 'sig');
    if (t.id === 'h-list') tradeAct(async () => {
      const k = +$('h-k').value, n = Math.floor(+$('h-n').value), p = Math.floor(+$('h-p').value), have = L.shardsOf(S);
      if (!(n >= 1 && n <= 99) || !(p >= 1)) { toast('lock', 'Check the numbers', 'Enter how many shards to sell (up to 99) and a total price in gold.', 'warn'); return; }
      if ((have[k] || 0) < n) { toast('lock', 'Not enough shards', 'You have ' + shName(k, have[k] || 0) + '.', 'warn'); return; }
      await chatCall('POST', '/shards/list', { k, n, price: p, name: S.hero.name });
      have[k] -= n; afterTrade(); sfx.coin(); toast('coin', 'Listed', shName(k, n) + ' for ' + fmt(p) + ' gold.', ''); loadShards();
    });
    if (d.hbuy) tradeAct(async () => {
      const l = trade.sh && trade.sh.l.find(x => x.id === d.hbuy); if (!l || l.price > S.gold) return;
      const r = await chatCall('POST', '/shards/buy', { id: l.id, name: S.hero.name });
      S.gold -= r.price; L.shardsOf(S)[r.k] = (L.shardsOf(S)[r.k] || 0) + r.n; afterTrade(); sfx.coin();
      toast('relic', 'Shards bought', '+' + shName(r.k, r.n) + ' for ' + fmt(r.price) + ' gold.', 'feat'); loadShards();
    });
    if (d.hcancel) tradeAct(async () => {
      const r = await chatCall('POST', '/shards/cancel', { id: d.hcancel });
      L.shardsOf(S)[r.k] = (L.shardsOf(S)[r.k] || 0) + r.n; afterTrade(); toast('relic', 'Listing taken down', shName(r.k, r.n) + ' are back in your stash.', ''); loadShards();
    });
    if (d.tview) { listingModal(d.tview); return; }
    if (d.tc) { if (d.tc === 'mine') trade.mine = true; else { trade.mine = false; trade.cls = d.tc; } loadMarket(); return; }
    if (d.tclaim || t.id === 't-claimall') tradeAct(async () => {
      const ids = d.tclaim ? [d.tclaim] : trade.mail.inbox.filter(l => l.type !== 'offer').map(l => l.id);
      let gold = 0, items = 0;
      for (const id of ids) {
        const l = trade.mail.inbox.find(x => x.id === id);
        if (l.type === 'return' && bagFull()) { toast('bag', 'Your pack is full', 'Salvage something to collect returned gear.', 'warn'); break; }
        const r = await chatCall('POST', '/mail/claim', { id });
        const L2 = r.letter;
        if (L2.type === 'return') { S.bag.push(fromServer(L2.item)); items++; } else { const g2 = nowGold(L2.gold, L2.at); S.gold += g2; S.stats.goldEarned += g2; gold += g2; }
      }
      afterTrade(); sfx.coin();
      toast('coin', 'Collected', [gold ? '+' + fmt(gold) + ' gold' : '', items ? items + (items === 1 ? ' item' : ' items') + ' back in your pack' : ''].filter(Boolean).join(', ') || 'Done.', 'feat');
      loadMail();
    });
    if (d.taccept) tradeAct(async () => {
      const l = trade.mail.inbox.find(x => x.id === d.taccept); if (!l) return;
      if (bagFull()) { toast('bag', 'Your pack is full', 'Salvage something first.', 'warn'); return; }
      if (l.price > S.gold) return;
      await chatCall('POST', '/mail/accept', { id: l.id });
      S.gold -= l.price; S.bag.push(fromServer(l.item)); afterTrade(); sfx.coin();
      toast('bag', L.gearName(l.item) + ' is yours', l.price ? 'You paid ' + fmt(l.price) + ' gold.' : 'A gift from ' + l.fromName + '.', 'feat'); loadMail();
    });
    if (d.tdecline) tradeAct(async () => { await chatCall('POST', '/mail/decline', { id: d.tdecline }); toast('bag', 'Offer declined', 'The item goes back to its sender.', ''); loadMail(); });
    if (d.trecall) tradeAct(async () => {
      if (bagFull()) { toast('bag', 'Your pack is full', 'Salvage something first.', 'warn'); return; }
      const r = await chatCall('POST', '/mail/recall', { id: d.trecall });
      S.bag.push(fromServer(r.letter.item)); afterTrade(); toast('bag', 'Offer taken back', 'The item is back in your pack.', ''); loadMail();
    });
  });

  // Sell or send, from the item window
  function sellItem(uid) {
    const it = L.itemOf(S, uid); if (!it) return;
    const sug = Math.max(10, Math.round(L.salvageValue(it) * 3));
    modal('<div class="itemhead r-' + it.rar + '">' + tradeTile(it) + '<div><h2>Sell ' + tradeName(it) + '</h2><small>' + tradeSub(it) + '</small></div></div>' +
      '<p>Set a price in gold. Other players can buy it for a week. If nobody does, take it down from the market to get it back.</p>' +
      '<label class="field">Price<input id="t-price" type="number" min="1" step="1" inputmode="numeric" value="' + sug + '"></label><small class="note">Salvage value is ' + fmt(L.salvageValue(it)) + ' gold.</small>' +
      (L.wearer(S, uid) ? '<p class="note">' + esc(L.memberById(L.wearer(S, uid)).name) + ' will take it off.</p>' : '') +
      '<div class="row"><button class="btn" id="t-sell">List for sale</button><button class="btn ghost" id="t-cancel">Cancel</button></div>', md => {
        md.querySelector('#t-cancel').onclick = () => itemModal(uid);
        md.querySelector('#t-sell').onclick = () => tradeAct(async () => {
          const price = Math.floor(+md.querySelector('#t-price').value);
          if (!(price >= 1)) { md.querySelector('#t-price').focus(); return; }
          await chatCall('POST', '/market/list', { item: tradeItem(it), price, name: S.hero.name });
          takeFromBag(uid); afterTrade(); closeModal(); sfx.buy();
          toast('coin', 'Listed for ' + fmt(price) + ' gold', 'You will get mail when it sells.', 'feat');
        }, 'list');
      });
  }
  function sendItem(uid) {
    const it = L.itemOf(S, uid); if (!it) return;
    const people = new Map();
    for (const g of S.guests || []) people.set(g.id.slice(2), g.name);
    for (const k in chat.msgs) for (const m of chat.msgs[k] || []) if (m.from && m.from !== chat.me && !chat.muted.has(m.from)) people.set(m.from, m.name);
    const list = [...people].slice(-12).reverse();
    let to = list.length ? list[0][0] : null;
    modal('<div class="itemhead r-' + it.rar + '">' + tradeTile(it) + '<div><h2>Send ' + tradeName(it) + '</h2><small>' + tradeSub(it) + '</small></div></div>' +
      (list.length ? '<p>Send it to a player you have recruited or chatted with. Leave the price at 0 to make it a gift. With a price, they pay it if they accept.</p><div class="choice" id="t-to">' + list.map(([pid, nm], i) => '<button class="pick' + (i ? '' : ' on') + '" data-to="' + pid + '"><b>' + esc(nm) + '</b></button>').join('') + '</div>' +
        '<label class="field">Price in gold<input id="t-price" type="number" min="0" step="1" inputmode="numeric" value="0"></label><label class="field">Note (optional)<input id="t-note" maxlength="80" placeholder="Thanks for the run!"></label>' +
        '<div class="row"><button class="btn" id="t-send">Send</button><button class="btn ghost" id="t-cancel">Cancel</button></div>'
        : '<p>You can send gear to players you have recruited from the Players Guild or chatted with. Say hello in chat first, then try again.</p><div class="row"><button class="btn ghost" id="t-cancel">Back</button></div>'), md => {
        md.querySelector('#t-cancel').onclick = () => itemModal(uid);
        const tb = md.querySelector('#t-to'); if (tb) tb.onclick = e => { const b = e.target.closest('[data-to]'); if (!b) return; to = b.dataset.to; tb.querySelectorAll('.pick').forEach(x => x.classList.toggle('on', x === b)); };
        const sb = md.querySelector('#t-send'); if (sb) sb.onclick = () => tradeAct(async () => {
          const price = Math.max(0, Math.floor(+md.querySelector('#t-price').value || 0));
          const r = await chatCall('POST', '/mail/send', { to, item: tradeItem(it), price, note: md.querySelector('#t-note').value.trim() });
          takeFromBag(uid); afterTrade(); closeModal(); sfx.buy();
          toast('bag', 'Sent to ' + r.toName, price ? 'They can pay ' + fmt(price) + ' gold to take it, or send it back.' : 'A gift. It is theirs as soon as they accept.', 'feat');
        }, 'send');
      });
  }
  // ---------- mass sell: list many pack items on the market in one go ----------
  const MKT_CAP = 25, sellOpts = { common: false, fine: true, rare: true, epic: false, set: false, keepBest: true, keepUp: true };
  async function openMassSell() {
    if (!CL) return;
    if (!signedIn()) { toast('lock', 'Sign in to trade', 'The market needs a free account.', 'warn'); authForm('in'); return; }
    let used = null;
    // Each piece is listed at its current value: the same price the Sell button suggests for it.
    const unit = it => Math.max(10, Math.round(L.salvageValue(it) * 3));
    const draw = () => {
      const free = used === null ? 0 : Math.max(0, MKT_CAP - used);
      const all = bulkList(sellOpts).filter(it => !bound(it)).sort((a, b) => unit(b) - unit(a)), list = all.slice(0, free), gold = list.reduce((a, it) => a + unit(it), 0);
      const chk = (k, label, sub) => '<label class="chk"><input type="checkbox" data-opt="' + k + '"' + (sellOpts[k] ? ' checked' : '') + '><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
      modal('<h2>Mass sell</h2><p>List many pieces on the market at once, each at its current value. Other players can buy them for a week, and you get mail with the gold when each one sells. Worn and locked items are never listed.</p>' +
        '<div class="scrapgrid">' + L.RARITY.filter(r => r.id !== 'goblin').map(r => chk(r.id, '<span class="r-' + r.id + '" style="color:var(--rc)">' + r.name + '</span>', S.bag.filter(x => x.rar === r.id && !x.lk && !L.wearer(S, x.uid)).length + ' to sell')).join('') + '</div>' +
        chk('keepBest', 'Keep the best of each kind', 'Saves your strongest spare piece for every class and slot.') +
        chk('keepUp', 'Keep upgraded pieces', 'Anything you have spent gold upgrading stays.') +
        '<p class="scrapsum">' + (used === null ? 'Checking your market slots…' : !free ? 'All ' + MKT_CAP + ' of your market slots are in use. Take something down under My listings first.' : list.length ? 'Lists <b>' + list.length + '</b> ' + (list.length === 1 ? 'piece' : 'pieces') + ' for <b>' + fmt(gold) + ' gold</b> in total.' + (all.length > list.length ? ' ' + (all.length - list.length) + ' more will not fit.' : '') + ' <small>' + free + ' of ' + MKT_CAP + ' market slots free.</small>' : 'Nothing matches. Tick more rarities above.') + '</p>' +
        '<div class="row"><button class="btn" id="ms-go"' + (list.length ? '' : ' disabled') + '>List ' + list.length + '</button><button class="btn ghost" id="ms-x">Cancel</button></div>', md => {
          md.querySelectorAll('[data-opt]').forEach(c => c.onchange = () => { sellOpts[c.dataset.opt] = c.checked; draw(); });
          md.querySelector('#ms-x').onclick = closeModal;
          md.querySelector('#ms-go').onclick = () => tradeAct(async () => {
            const go = md.querySelector('#ms-go'); go.disabled = true;
            let n = 0, g = 0;
            try {
              for (const it of list) {
                if (!L.itemOf(S, it.uid) || it.lk || L.wearer(S, it.uid)) continue;
                go.textContent = 'Listing ' + (n + 1) + ' of ' + list.length + '…';
                await chatCall('POST', '/market/list', { item: tradeItem(it), price: unit(it), name: S.hero.name });
                takeFromBag(it.uid); n++; g += unit(it);
              }
            } finally {
              if (n) { afterTrade(); sfx.buy(); }
              closeModal();
              if (n) toast('coin', 'Listed ' + n + (n === 1 ? ' piece' : ' pieces'), 'Worth ' + fmt(g) + ' gold in total. You will get mail as they sell.', 'feat');
            }
          }, 'list');
        });
    };
    draw();
    try { const r = await chatCall('GET', '/market?mine=1'); used = (r.listings || []).length; } catch (e) { used = MKT_CAP; toast('lock', 'Could not reach the market', 'Try again in a moment.', 'warn'); }
    if (!$('modal').hidden && $('ms-go')) draw();
  }
  if ($('g-msell')) { $('g-msell').hidden = !CL; $('g-msell').addEventListener('click', openMassSell); }
  if (CL) {
    setInterval(() => { if (signedIn() && !document.hidden) loadMail(true); }, 90000);
    setTimeout(() => { if (signedIn()) loadMail(true); }, 4000);
  }
  // ---------- World boss weekends ----------
  // Every weekend one huge Rift boss attacks the Hold. Signed-in players send 2-minute assaults; the server adds
  // everyone's damage into one shared health bar with phases, and pays Sigils once the weekend is over.
  const wb = { st: null, at: 0, busy: false, key: '' };
  const wbDur = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + ':' + String(x).padStart(2, '0'); };
  async function loadBoss() {
    if (!CL || !signedIn()) { wb.st = null; return; }
    try { const r = await api('GET', null, '/boss'); if (r && r.w && r.me) { wb.st = r; wb.at = Date.now(); } } catch (e) {}
  }
  // What the player can do right now: join, wait for the cooldown, claim, or wait for the next weekend.
  function wbState() {
    const now = Date.now(), w = L.wbWindow(now), live = now >= w.start && now < w.end, st = wb.st;
    const name = L.wbName(w.id);
    const me = st && st.w && st.w.id === w.id ? st.me : null;
    const ready = me ? Math.max(0, me.last + L.WB_COOL * 1000 - now) : 0;
    let claim = null;
    if (st) {
      if (!st.w.live && st.me.score > 0 && !st.me.cl) claim = st.w.id;
      else if (st.prev && st.prev.score > 0 && !st.prev.cl) claim = st.prev.id;
      const lw = S.wbLoot || {};
      if (!claim && !st.w.live && st.me.score > 0 && !lw[st.w.id]) claim = st.w.id;
      else if (!claim && st.prev && st.prev.score > 0 && !lw[st.prev.id]) claim = st.prev.id;
    }
    const next = live ? 0 : (now < w.start ? w.start : w.start + 7 * 864e5);
    return { now, w, live, name, me, ready, claim, next, total: st && st.w.id === w.id ? st.total : 0 };
  }
  function paintBoss() {
    const el = $('wbbar'), x = wbState(), inA = S.wb && S.wb.until > x.now;
    let h = '';
    if (inA) h = icon('skull') + '<span><b>Assault on ' + esc(S.wb.name) + '</b> · ' + wbDur(S.wb.until - x.now) + ' left · your damage <b>' + Math.floor(S.wb.score * 10) / 10 + '</b></span>';
    else if (x.claim) h = icon('crown') + '<span><b>The world boss has fallen back.</b> Your reward is waiting.</span><em>Claim</em>';
    else if (x.live) {
      const ph = L.wbPhase(x.total);
      h = icon('skull') + '<span><b>World boss: ' + esc(x.name) + '</b> · phase ' + (ph.broken + 1) + ' · ' + Math.floor(ph.into / ph.need * 100) + '% · ends in ' + wbDur(x.w.end - x.now) + '</span>' +
        (!CL || !signedIn() ? '<em>Sign in to fight</em>' : x.ready > 0 ? '<em class="wait">Next assault ' + wbDur(x.ready) + '</em>' : '<em>Join the assault</em>');
    } else if (x.next - x.now < 2 * 864e5) h = icon('skull') + '<span><b>' + esc(L.wbName(L.wbWindow(x.next).id)) + '</b> attacks the Hold in ' + wbDur(x.next - x.now) + '</span><em class="wait">Details</em>';
    if (h !== wb.key) { wb.key = h; el.innerHTML = h; el.hidden = !h; el.classList.toggle('on', !!inA); }
  }
  function openBoss() {
    if (!gateUse('boss')) return;
    const x = wbState(), st = wb.st, ph = L.wbPhase(x.total), pct = Math.floor(ph.into / ph.need * 100);
    const top = st && st.w.id === x.w.id ? st.top : [];
    const rank = x.me && x.me.score > 0 ? top.findIndex(t => t.score <= x.me.score) + 1 : 0;
    modal('<div class="maphead"><div><h2>' + esc(x.name) + '</h2><small>World boss · ' + (x.live ? 'ends in ' + wbDur(x.w.end - x.now) : 'next attack in ' + wbDur(x.next - x.now)) + '</small></div><button class="iconbtn" id="wb-x" aria-label="Close">&times;</button></div>' +
      '<div class="wbhero"><img src="' + SP.spriteURL('colossus', 3, 0) + '" alt=""><div>' +
      '<p>A giant of void crystal has torn through the Nyx Rift beneath the Hold. Every delver fights the same monster: each assault you make chips at one shared health bar.</p>' +
      '<div class="wbphase"><div class="wbph"><b>Phase ' + (ph.broken + 1) + '</b><span>' + pct + '%</span></div><div class="bar wbbar2"><i style="width:' + pct + '%"></i></div><small>' + ph.broken + (ph.broken === 1 ? ' phase' : ' phases') + ' broken so far · ' + (st ? st.n : 0) + (st && st.n === 1 ? ' delver has' : ' delvers have') + ' joined</small></div></div></div>' +
      '<ul class="passfx"><li><b>Assaults</b><span>Two minutes against the boss at the strength of your deepest floor. One every 15 minutes. Strike and use your abilities for more damage.</span></li>' +
      '<li><b>Rewards</b><span>After the weekend: 3 Sigils for taking part, 1 more for every phase the server breaks (up to 5), and 5 more for the top three. Plus a big purse of gold.</span></li>' +
      '<li><b>Legendary loot</b><span>' + (() => { const k = Math.floor(Date.parse(x.w.id + 'T00:00:00Z') / 6048e5) % 4, s2 = L.WB_SETS[k]; return 'Each phase broken adds a 12% chance (up to 75%) that ' + esc(x.name) + ' drops a piece of <b>' + esc(s2.name) + '</b>. One winner is drawn from everyone who fought: every whole point of your damage is one ticket. ' + esc(s2.word) + ' shards (5, plus 3 per phase) are drawn the same way. They upgrade the set and trade in the Market.'; })() + '</span></li>' +
      '<li><b>When</b><span>Every weekend, Friday to Sunday (all times UTC).' + (x.w.id === '2026-11-23' ? ' This first one is a preview and runs until Friday.' : '') + '</span></li></ul>' +
      (top.length ? '<h3 class="sub">Top delvers</h3><ol class="wbtop">' + top.map(t => '<li><span class="c-' + esc(t.cls) + '">' + esc(t.name) + '</span><b>' + Math.floor(t.score).toLocaleString('en-US') + '</b></li>').join('') + '</ol>' : '') +
      (x.me && x.me.score > 0 ? '<p class="passstate">Your damage this event: <b>' + Math.floor(x.me.score).toLocaleString('en-US') + '</b>' + (rank ? ', rank ' + rank : '') + '.</p>' : '') +
      '<div class="row">' + (x.claim ? '<button class="btn" id="wb-claim">Claim your reward</button>' : !CL || !signedIn() ? '<button class="btn" id="wb-in">Sign in to fight</button>' : x.live ? (x.ready > 0 ? '<button class="btn" disabled>Next assault in ' + wbDur(x.ready) + '</button>' : '<button class="btn" id="wb-go">Join the assault</button>') : '') + '<button class="btn ghost" id="wb-no">Close</button></div>', md => {
      md.querySelector('#wb-x').onclick = closeModal; md.querySelector('#wb-no').onclick = closeModal;
      const go = md.querySelector('#wb-go'); if (go) go.onclick = () => { closeModal(); joinAssault(); };
      const cl = md.querySelector('#wb-claim'); if (cl) cl.onclick = () => { const st2 = wb.st, done = st2 && ((st2.w.id === x.claim && st2.me.cl) || (st2.prev && st2.prev.id === x.claim && st2.prev.cl)); if (done) { closeModal(); lootBoss(x.claim).then(() => { loadBoss().then(paintBoss); }); } else claimBoss(x.claim, cl); };
      const si = md.querySelector('#wb-in'); if (si) si.onclick = () => { closeModal(); authForm('in'); };
    });
  }
  function joinAssault() {
    if (!gateUse('boss')) return;
    const x = wbState();
    if (!x.live || x.ready > 0 || !signedIn()) return openBoss();
    if (L.resting(S, Date.now())) { toast('flame', 'Your party is resting', 'Head back into the deep first, then join the assault.', 'warn'); return; }
    if (!L.startAssault(S, Date.now(), x.name)) return;
    sfx.boss(); toast('skull', 'Assault!', 'Two minutes against ' + x.name + '. Strike and use your abilities!', 'feat');
    updateStage && updateStage(); paintBoss();
  }
  async function sendAssault(score, fell, ck, iv) {
    if (!(score > 0)) { toast('skull', 'Assault over', fell ? 'Your party fell before landing a blow.' : 'No damage this time.', ''); return; }
    try {
      const r = await api('POST', { score, ck: ck || 0, iv: iv || [] }, '/boss/hit');
      if (wb.st && r) { wb.st.total = r.total; wb.st.me.score += r.add; wb.st.me.last = Date.now(); }
      toast('skull', fell ? 'Your party fell back' : 'Assault over', 'You dealt ' + score + ' damage to ' + wbState().name + '. Every assault counts toward the next phase.', 'feat');
    } catch (e) { toast('lock', 'The assault did not count', 'The server could not record it. Try again in a moment.', 'warn'); }
    loadBoss().then(paintBoss);
  }
  async function claimBoss(id, btn) {
    if (wb.busy) return; wb.busy = true; if (btn) btn.disabled = true;
    try {
      const r = await api('POST', { id }, '/boss/claim');
      if (!r) throw 0;
      const g = Math.max(2000, L.offlineGoldPerSec(S) * 1800 * (1 + r.phases));
      S.gold += g; S.stats.goldEarned += g; if (typeof prof !== 'undefined' && prof) prof.bal = r.bal; save();
      closeModal(); sfx.relic();
      toast('crown', 'World boss reward', '+' + r.sig + ' Sigils and ' + fmt(g) + ' gold. You ranked ' + r.rank + ' of ' + r.n + '.', 'feat');
    } catch (e) { if (btn) btn.disabled = false; toast('lock', 'Could not claim yet', 'Try again in a moment.', 'warn'); }
    wb.busy = false; await lootBoss(id); loadBoss().then(paintBoss); updatePanel(true);
  }
  // The boss's loot (v105): the server's seeded draw says whether you won the Legendary and how many shards you drew.
  async function lootBoss(id) {
    S.wbLoot = S.wbLoot || {}; if (S.wbLoot[id]) return;
    let r; try { r = await chatCall('POST', '/boss/loot', { id }); } catch (e) { if (e && (e.code === 'claimed' || e.code === 'none')) { S.wbLoot[id] = 1; save(); } return; }
    if (!r || !r.ok) return;
    S.wbLoot[id] = 1; const b = L.WB_SETS[r.boss] ? r.boss : 0, set = L.WB_SETS[b], sh = L.shardsOf(S);
    sh[b] = (sh[b] || 0) + (r.sh || 0);
    let it = null; if (r.leg) { it = L.makeLegend(S, b); S.bag.push(it); S.stats.legends = (S.stats.legends || 0) + 1; }
    save(); try { pushCloud(true); } catch (e) {} updateGear(true);
    const odds = Math.round(r.tk / Math.max(1, r.all) * 1000) / 10;
    if (it) { sfx.boss && sfx.boss(); toast('crown', 'LEGENDARY: ' + L.gearName(it), 'You won the draw for ' + set.name + ' with ' + fmt(r.tk) + ' of ' + fmt(r.all) + ' tickets (' + odds + '%).' + (r.sh ? ' Plus ' + shName(b, r.sh) + '.' : ''), 'feat'); }
    else toast('relic', set.word + ' loot', (r.sh ? 'You drew ' + shName(b, r.sh) + '. ' : 'No shards this time. ') + (r.who ? r.who + ' won the Legendary.' : 'No Legendary dropped this time.') + ' Your tickets: ' + fmt(r.tk) + ' of ' + fmt(r.all) + ' (' + odds + '%).', '');
  }
  $('wbbar').addEventListener('click', () => {
    const x = wbState();
    if (S.wb && S.wb.until > x.now) return;
    if (x.live && !x.claim && x.ready <= 0 && signedIn()) joinAssault(); else openBoss();
  });
  setTimeout(() => loadBoss().then(paintBoss), 3000);
  setInterval(() => { if (!document.hidden) loadBoss().then(paintBoss); }, 120000);
  setInterval(paintBoss, 1000);
  // ---------- The Ember Ring (PvP) ----------
  // Only the player's own hero fights here, one on one, against the saved build of another player's hero.
  // The server fights the duel (infra/ring/index.js); this part sends our build, shows challengers and class
  // matchups, sells Ring skills and Ringwarden kit ranks for Laurels, keeps the skill loadout, plays the duel back
  // and shows the Ring standings. No Sigils, no tonics. The skill list and matchups come from the server.
  // Keep RING_KIT, ringGate, ringCost and the stat formula in step with infra/ring/index.js.
  const RING_KIT = [
    { id: 'helm', name: 'Helm', slot: 'head', R: 5, E: 0, hp: .02, at: 0 },
    { id: 'hauberk', name: 'Hauberk', slot: 'chest', R: 7, E: 0, hp: .015, at: 0 },
    { id: 'signet', name: 'Signet', slot: 'ring', R: 0, E: 5, hp: 0, at: .015 },
    { id: 'greaves', name: 'Greaves', slot: 'legs', R: 3, E: 3, hp: .01, at: .01 },
    { id: 'arms', name: 'Arms', slot: 'main', R: 0, E: 7, hp: 0, at: .02 },
  ];
  const RING_ARMS = { tank: 'Warhammer', healer: 'Censer', rogue: 'Twin Fangs', mage: 'Focus Rod', necro: 'Grave Scythe' };
  const RING_MAX = 15, RING_EMAX = 10, RING_EINT = 30 * 6e4;
  const ringGate = r => r >= 10 ? 1600 : r >= 5 ? 1300 : 0, ringCost = r => 60 + 30 * r;
  const RING_TIER = r => r <= 0 ? ['Plain', 'common'] : r <= 5 ? ['Ironbound', 'rare'] : r <= 10 ? ['Emberforged', 'epic'] : ['Starwrought', 'set'];
  const RING_TITLES = [[1900, 'Riftbreaker'], [1700, 'Lanternsworn'], [1500, 'Gilded'], [1300, 'Emberborn'], [1100, 'Ironclad'], [0, 'Ashen']];
  const ringTitle = r => RING_TITLES.find(t => r >= t[0])[1];
  // A rough strength score for "even match" hints: damage per hit times health, Edge and Resolve included.
  const ringPower = s => s.at * (1 + s.E / (s.E + 300)) * s.hp / (1 - .5 * s.R / (s.R + 300));
  const rg = { st: null, at: 0, view: 'foes', busy: false, err: '', sent: 0 };
  // ---- Ring skills and class matchups (the data comes with GET /arena) ----
  const CLS_NAME = c => L.CLASSES[c].name;
  const ringPc = x => Math.round(x * 1000) / 10 + '%';
  const ringSkill = id => (rg.st && rg.st.skills || []).find(s => s.id === id);
  function ringSkillText(s, r) {
    const v = s.v[Math.max(0, (r || 1) - 1)];
    return ({
      hit: 'Strikes for ' + ringPc(v) + ' damage.', pierce: 'A radiant strike for ' + ringPc(v) + ' damage that never misses and ignores Resolve and armor.',
      stun: 'Hits for ' + ringPc(v) + ' damage and stuns: the foe loses its next turn.', heal: 'Restores ' + ringPc(v) + ' of max health. Used once you drop below 70%.',
      shield: 'Raises a shield that absorbs ' + ringPc(v) + ' of max health, with a light blow.', dot: 'Deals ' + ringPc(v) + ' of your attack on each of the foe\u2019s next 3 turns.',
      drain: 'Hits for ' + ringPc(v) + ' damage and heals you for all of it.', weaken: 'The foe deals ' + ringPc(v) + ' less damage for 4 turns.',
      ward: 'Take ' + ringPc(v) + ' less damage from the next 3 hits, with a light blow.', evade: 'Dodge the next ' + (v === 1 ? 'attack' : v + ' attacks') + ', with a light blow.',
      armor: 'Take ' + ringPc(v) + ' less damage.', reflect: 'Return ' + ringPc(v) + ' of the damage you take.', regen: 'Heal ' + ringPc(v) + ' of max health every turn.',
      crit: '+' + ringPc(v) + ' critical hit chance.', dodge: '+' + ringPc(v) + ' chance that attacks miss you.', power: 'Abilities hit and heal ' + ringPc(v) + ' harder.',
      leech: 'Heal ' + ringPc(v) + ' of the damage you deal.', undying: 'Once per duel, survive a killing blow with ' + ringPc(v) + ' health.', execute: '+' + ringPc(v) + ' damage to foes under 30% health.',
    })[s.fx] + (s.cd ? ' Every ' + s.cd + ' turns.' : '');
  }
  const NATURE_TEXT = { tank: 'Sturdy: takes 10% less damage.', healer: 'Blessed: heals 1% each turn and takes 6% less damage.', rogue: 'Deadly: +8% critical chance, and crits hit harder.', mage: 'Arcane: abilities hit 10% harder.', necro: 'Hungry: heals 12% of the damage it deals.' };
  // 1 if a has the edge on b, -1 if b counters a, 0 otherwise.
  const ringEdge = (a, b) => { const m = rg.st && rg.st.match; if (!m) return 0; return m.beats[a].includes(b) ? 1 : m.beats[b].includes(a) ? -1 : 0; };
  const ringWhy = (a, b) => (rg.st && rg.st.match.why[a + '>' + b]) || '';
  const laurel = n => '<span class="laurel">' + icon('crown') + Number(n).toLocaleString('en-US') + '</span>';
  // Our build: the log of the hero's own damage and health, with no tonics, abilities or knocked-out state.
  function ringBuild() {
    const keep = { t: S.tonic, d: S.down, a: S.abil, f: S.fx };
    let dps = 0, hp = 0;
    try { S.tonic = {}; S.down = {}; S.abil = {}; S.fx = {}; dps = L.memberDps(S, 'you', Date.now()); hp = L.maxHpOf(S, 'you'); }
    catch (e) {} finally { S.tonic = keep.t; S.down = keep.d; S.abil = keep.a; S.fx = keep.f; }
    const lg = x => Math.round(Math.log(1 + Math.max(0, x || 0)) * 10) / 10;
    return { m: lg(dps), v: lg(hp) };
  }
  const ringEnergy = me => me ? Math.max(0, RING_EMAX - Math.ceil(Math.max(0, me.et - Date.now()) / RING_EINT)) : 0;
  const ringIn = ms => { const m = Math.max(1, Math.ceil(ms / 6e4)); return m >= 60 ? Math.ceil(m / 60) + 'h' : m + 'm'; };
  async function loadRing(force) {
    if (!CL || !signedIn() || !S.hero || rg.busy) return;
    if (!force && rg.st && Date.now() - rg.at < 60000) return;
    rg.busy = true; rg.err = '';
    try {
      // The hero board row must exist first (it holds the name); publishing is quick and harmless.
      if (Date.now() - rg.sent > 5 * 6e4) { try { await api('PUT', { name: S.hero.name, cls: S.hero.cls, side: S.hero.side, level: L.lvl(S, 'you'), floor: S.maxFloorEver, ref: '' }, '/hero'); } catch (e) {} await api('PUT', ringBuild(), '/arena'); rg.sent = Date.now(); }
      const st = await api('GET', null, '/arena'); if (!st) throw 0; rg.st = st; rg.at = Date.now();
      fetchLooks((st.foes || []).map(f => f.id).concat((st.top || []).map(t => t.id))).then(n => { if (n) paintRing(); });
      ringDefenseNews();
    } catch (e) { rg.err = 'The Ring could not be reached right now. Try again in a minute.'; }
    rg.busy = false; paintRing();
  }
  // Tell the player how their hero did while others challenged it.
  function ringDefenseNews() {
    const me = rg.st && rg.st.me; if (!me) return;
    let old = null; try { old = JSON.parse(localStorage.getItem('lh_ringdef') || 'null'); } catch (e) {}
    try { localStorage.setItem('lh_ringdef', JSON.stringify({ dw: me.dw, dl: me.dl })); } catch (e) {}
    if (!old) return;
    const w = me.dw - old.dw, l = me.dl - old.dl;
    if (w > 0 || l > 0) toast('shield', 'Your hero held the Ring', (w ? w + (w === 1 ? ' challenger beaten' : ' challengers beaten') : '') + (w && l ? ', ' : '') + (l ? l + ' lost' : '') + ' while you were away.' + (w ? ' +' + (w * 2) + ' Laurels.' : ''), w >= l ? 'feat' : '');
  }
  function ringFig(cls, hue, size) { return '<img class="ringspr" src="' + SP.spriteURL(cls, size || 3, hue || 0) + '" alt="">'; }
  function ringStatLine(s) { return fmt(s.hp) + ' health &middot; ' + fmt(s.at) + ' attack' + (s.E ? ' &middot; Edge ' + s.E : '') + (s.R ? ' &middot; Resolve ' + s.R : ''); }
  function paintRing() {
    const box = $('ringbox'); if (!box || typeof tab === 'undefined' || tab !== 'ring') return;
    const intro = '<p class="note">Duel other players’ heroes one on one. Only your own hero steps into the Ring: no companions, tonics or Sigils. Win Laurels and climb the standings.</p>';
    if (!CL) { box.innerHTML = '<div class="ringempty"><h3>The Ember Ring</h3>' + intro + '<p class="note">The Ring needs the online server.</p></div>'; return; }
    if (!signedIn() || !S.hero) { box.innerHTML = '<div class="ringempty"><h3>The Ember Ring</h3>' + intro + '<button class="btn" id="ring-in">Sign in to enter the Ring</button></div>'; $('ring-in').onclick = () => authForm('in'); return; }
    const st = rg.st;
    if (!st || !st.me) { box.innerHTML = '<div class="ringempty"><h3>The Ember Ring</h3>' + intro + '<p class="note">' + (rg.err || 'Stepping into the Ring…') + '</p>' + (rg.err ? '<button class="btn small" id="ring-retry">Try again</button>' : '') + '</div>'; const b = $('ring-retry'); if (b) b.onclick = () => loadRing(true); return; }
    const me = st.me, you = L.memberById('you'), en = ringEnergy(me), nextIn = me.et - Date.now() - (RING_EMAX - en - 1) * RING_EINT;
    let h = '<div class="ringhead' + (myBanner() ? ' hasban' : '') + '">' + (myBanner() ? '<div class="rhban">' + bannerSVG(myBanner()) + '</div>' : '') + '<div class="rhfig">' + ringFig(you.cls, lookHue(you), 3) + '</div><div class="rhinfo"><div class="rhtop"><h3>The Ember Ring</h3><span class="rtitle rt-' + ringTitle(me.r).toLowerCase() + '">' + ringTitle(me.r) + '</span></div>' +
      '<div class="rhrate"><b>' + me.r.toLocaleString('en-US') + '</b> rating' + (st.rank ? ' &middot; rank ' + st.rank + ' of ' + st.n : '') + (me.pk > me.r ? ' &middot; best ' + me.pk.toLocaleString('en-US') : '') + '</div>' +
      '<div class="rhchips"><span title="Wins and losses">' + icon('sword') + me.w + '&ndash;' + me.l + '</span>' + '<span title="Laurels, spent on Ring skills and the Ringwarden kit">' + laurel(me.ll) + '</span>' +
      '<span title="Challenges refill one every 30 minutes, up to 10" class="' + (en ? '' : 'out') + '">' + icon('flame') + en + '/' + RING_EMAX + (en < RING_EMAX ? ' <small>+1 in ' + fmtTime(Math.max(1, Math.ceil(nextIn / 1000))) + '</small>' : '') + '</span></div></div></div>' +
      '<div class="seg ringseg">' + [['foes', 'Challengers'], ['skills', 'Skills'], ['kit', 'Kit'], ['top', 'Standings']].map(v => '<button data-rv="' + v[0] + '"' + (rg.view === v[0] ? ' class="on"' : '') + '>' + v[1] + '</button>').join('') + '</div>';
    if (rg.view === 'foes') {
      const ms = me.s, mp = ringPower(ms);
      h += '<p class="note small ringbuild"><b>Your hero in the Ring:</b> ' + ringStatLine(ms) + '. Deeper delving helps a little; the Ringwarden kit helps a lot.</p>';
      h += st.foes.length ? '<div class="ringfoes">' + st.foes.map(f => {
        const q = ringPower(f.s) / mp, odd = q > 1.35 ? ['tough', 'Tough fight'] : q < 0.75 ? ['easy', 'You are favored'] : ['even', 'Even match'];
        const ed = ringEdge(you.cls, f.c), mu = ed > 0 ? '<span class="mu good" title="' + esc(ringWhy(you.cls, f.c)) + '">' + icon('star') + 'Your ' + CLS_NAME(you.cls).toLowerCase() + ' has the edge</span>' : ed < 0 ? '<span class="mu bad" title="' + esc(ringWhy(f.c, you.cls)) + '">' + icon('shield') + 'Counters your ' + CLS_NAME(you.cls).toLowerCase() + '</span>' : '';
        const rc = me.rc && me.rc[f.id], rq = rc ? (me.rep || [1, .5, .25, 0])[Math.min(rc[0], 3)] : 1;
        const rm = !rc ? '' : rq > 0 ? '<span class="mu rep">' + icon('refresh') + 'Rematch: ' + Math.round(rq * 100) + '% rating and Laurels</span>' : '<span class="mu bad">' + icon('refresh') + 'Rematch pays nothing for ' + ringIn(rc[1] - Date.now()) + '</span>';
        const brings = (f.lo ? f.lo.a.concat(f.lo.p) : []).map(id => { const k = ringSkill(id); return k ? k.n : ''; }).filter(Boolean);
        return '<div class="ringfoe"><div class="rffig">' + (theirBanner(f.id) ? bannerSVG(theirBanner(f.id), 'rfban') : '') + ringFig(f.c, outfitHue((looksCache[f.id] || {}).k), 2) + '</div><div class="rfinfo"><div class="nm">' + esc(f.n) + ' ' + classTag(f.c) + '</div><small><span class="rtitle sm rt-' + ringTitle(f.r).toLowerCase() + '">' + ringTitle(f.r) + '</span> ' + f.r.toLocaleString('en-US') + ' &middot; ' + f.w + '&ndash;' + f.l + ' &middot; <i class="odds ' + odd[0] + '">' + odd[1] + '</i></small>' + (mu ? '<small>' + mu + '</small>' : '') + (rm ? '<small>' + rm + '</small>' : '') + (brings.length ? '<small class="brings">Brings ' + brings.map(esc).join(' &middot; ') + '</small>' : '') + '<small class="dim">' + ringStatLine(f.s) + '</small></div>' +
          '<button class="btn small" data-duel="' + f.id + '"' + (en ? '' : ' disabled title="No challenges left. One returns every 30 minutes."') + '>Duel</button></div>';
      }).join('') + '</div>' : '<p class="note">No other heroes have entered the Ring yet. Check back soon, or tell a friend to bring their hero.</p>';
      h += '<div class="row"><button class="btn ghost small" id="ring-ref">' + icon('refresh') + ' New challengers</button></div>';
    } else if (rg.view === 'skills') {
      h += ringSkillsView(me, you.cls);
    } else if (rg.view === 'kit') {
      h += '<p class="note small">Ringwarden gear is separate from your dungeon gear and works only in the Ring. <b>Edge</b> adds damage against heroes; <b>Resolve</b> softens their blows. Each piece has ' + RING_MAX + ' ranks: Ironbound, then Emberforged (needs a best rating of 1,300), then Starwrought (1,600).</p><div class="ringkit">';
      h += RING_KIT.map((p, i) => {
        const r = me.k[i] || 0, t = RING_TIER(r), nt = RING_TIER(r + 1), g = ringGate(r), cost = ringCost(r);
        const nm = (r ? t[0] + ' ' : 'Ringwarden ') + (p.id === 'arms' ? RING_ARMS[you.cls] : p.name) + (r ? ' <em>+' + r + '</em>' : '');
        const fx = x => [p.R ? 'Resolve +' + p.R * x : '', p.E ? 'Edge +' + p.E * x : '', p.hp ? 'health +' + Math.round(p.hp * x * 1000) / 10 + '%' : '', p.at ? 'attack +' + Math.round(p.at * x * 1000) / 10 + '%' : ''].filter(Boolean).join(' &middot; ');
        let act;
        if (r >= RING_MAX) act = '<span class="rkmax">Mastered</span>';
        else if (me.pk < g) act = '<span class="rklock" title="Reach a rating of ' + g.toLocaleString('en-US') + ' once to unlock ' + nt[0] + ' ranks">' + icon('lock') + g.toLocaleString('en-US') + ' rating</span>';
        else act = '<button class="btn small" data-kit="' + i + '"' + (me.ll < cost ? ' disabled title="Not enough Laurels"' : '') + '>' + (r ? 'Upgrade' : 'Claim') + ' ' + laurel(cost) + '</button>';
        return '<div class="ringpiece r-' + t[1] + '"><div class="tile r-' + t[1] + (r ? '' : ' ghost') + '"><img class="iimg" src="' + SP.itemIcon(you.cls, p.slot, r ? t[1] : 'common') + '" alt=""></div><div class="rpinfo"><b>' + nm + '</b><small>' + (r ? fx(r) : 'Not claimed yet') + '</small>' + (r < RING_MAX ? '<small class="dim">Next rank: ' + fx(1) + '</small>' : '') + '</div><div class="rpact">' + act + '</div></div>';
      }).join('') + '</div>';
    } else {
      h += st.top.length ? '<ol class="ringtop">' + st.top.map((t, i) => '<li class="' + (t.id === me.id ? 'me' : '') + '"><span class="rk">' + (i + 1) + '</span>' + ((t.id === me.id ? myBanner() : theirBanner(t.id)) ? bannerSVG(t.id === me.id ? myBanner() : theirBanner(t.id), 'tban') : '') + ringFig(t.c, outfitHue((looksCache[t.id] || {}).k), 1) + '<span class="nm c-' + esc(t.c) + '">' + esc(t.n) + '</span><span class="rtitle sm rt-' + ringTitle(t.r).toLowerCase() + '">' + ringTitle(t.r) + '</span><b>' + t.r.toLocaleString('en-US') + '</b><small>' + t.w + '&ndash;' + t.l + '</small></li>').join('') + '</ol>' : '<p class="note">Nobody has fought yet. The first win puts you on top.</p>';
      h += '<p class="note small">Everyone starts at 1,000. Beating a higher-rated hero is worth more. Heroes that defend well while their owner is away climb too.</p>';
    }
    box.innerHTML = h;
  }
  // The Skills view: what the class is good and bad at, the skills to learn and rank up, and the loadout.
  function ringSkillsView(me, cls) {
    const st = rg.st, m = st.match, own = me.sk || {}, lo = me.lo || { a: [], p: [] }, sl = st.slots || [2, 2];
    const beats = m.beats[cls], weak = Object.keys(m.beats).filter(c => m.beats[c].includes(cls));
    let h = '<div class="rmatch"><div><b>' + CLS_NAME(cls) + '</b> <small>' + NATURE_TEXT[cls] + '</small></div>' +
      '<div class="rmrow"><span class="mu good">' + icon('star') + 'Strong against</span>' + beats.map(c => '<span class="rmc c-' + c + '" title="' + esc(ringWhy(cls, c)) + '">' + CLS_NAME(c) + '</span>').join('') + '</div>' +
      '<div class="rmrow"><span class="mu bad">' + icon('shield') + 'Weak against</span>' + weak.map(c => '<span class="rmc c-' + c + '" title="' + esc(ringWhy(c, cls)) + '">' + CLS_NAME(c) + '</span>').join('') + '</div>' +
      '<small class="dim">With the edge you deal 4% more damage; against a counter, 4% less.</small></div>';
    h += '<p class="note small">Learn skills with Laurels and choose what your hero brings: ' + sl[0] + ' abilities, used in the order you set whenever they make sense, and ' + sl[1] + ' passives. Your loadout also defends while you are away.</p>';
    const list = st.skills.filter(s => s.c === cls);
    const card = s => {
      const r = own[s.id] || 0, inA = lo.a.indexOf(s.id), inP = lo.p.indexOf(s.id), on = s.k === 'a' ? inA >= 0 : inP >= 0, cost = st.skcost[r];
      const full = s.k === 'a' ? lo.a.length >= sl[0] : lo.p.length >= sl[1];
      return '<div class="rskill' + (on ? ' on' : '') + (r ? '' : ' locked') + '"><div class="rsk-top"><b>' + esc(s.n) + '</b>' + (on && s.k === 'a' ? '<em class="rslot">' + (inA === 0 ? '1st' : '2nd') + '</em>' : on ? '<em class="rslot">Equipped</em>' : '') +
        '<span class="pips">' + [1, 2, 3].map(k => '<i class="' + (k <= r ? 'on' : '') + '"></i>').join('') + '</span></div>' +
        '<small>' + ringSkillText(s, r || 1) + '</small>' + (r && r < 3 ? '<small class="dim">Rank ' + (r + 1) + ': ' + ringSkillText(s, r + 1) + '</small>' : '') +
        '<div class="rsk-act">' + (r < 3 ? '<button class="btn small' + (r ? ' ghost' : '') + '" data-skl="' + s.id + '"' + (me.ll < cost ? ' disabled title="Not enough Laurels"' : '') + '>' + (r ? 'Rank up' : 'Learn') + ' ' + laurel(cost) + '</button>' : '<span class="rkmax">Mastered</span>') +
        (r ? (on ? (s.k === 'a' && lo.a.length > 1 && inA === 1 ? '<button class="btn ghost small" data-lofirst="' + s.id + '">Use first</button>' : '') + '<button class="btn ghost small" data-looff="' + s.id + '">Unequip</button>' : '<button class="btn ghost small" data-loon="' + s.id + '"' + (full ? ' disabled title="Unequip one first"' : '') + '>Equip</button>') : '') + '</div></div>';
    };
    h += '<h3 class="sub">Abilities</h3><div class="rskills">' + list.filter(s => s.k === 'a').map(card).join('') + '</div>';
    h += '<h3 class="sub">Passives</h3><div class="rskills">' + list.filter(s => s.k === 'p').map(card).join('') + '</div>';
    return h;
  }
  async function ringLearn(id, btn) {
    if (rg.busy) return; rg.busy = true; if (btn) btn.disabled = true;
    try {
      const r = await api('POST', { id }, '/arena/skill'); if (!r || !r.me) throw 0;
      const was = (rg.st.me.sk || {})[id] || 0; rg.st.me = r.me; sfx.buy();
      const s = ringSkill(id), lo = r.me.lo;
      toast('star', s.n + (was ? ' rank ' + (was + 1) : ' learned'), was ? 'Stronger in every duel it is equipped for.' : 'Equip it in your loadout to take it into duels.', 'feat');
      // A first ability or passive goes straight into an empty slot.
      if (!was && s && lo && (s.k === 'a' ? lo.a.length < rg.st.slots[0] : lo.p.length < rg.st.slots[1])) { rg.busy = false; return ringSetLoadout(s.k === 'a' ? lo.a.concat(id) : lo.a, s.k === 'p' ? lo.p.concat(id) : lo.p); }
    } catch (e) { toast('lock', 'Could not learn that', 'Check your Laurels and try again in a moment.', 'warn'); }
    rg.busy = false; paintRing();
  }
  async function ringSetLoadout(a, p) {
    if (rg.busy) return; rg.busy = true;
    try { const r = await api('POST', { a, p }, '/arena/loadout'); if (!r || !r.me) throw 0; rg.st.me = r.me; sfx.buy(); }
    catch (e) { toast('lock', 'Loadout not saved', 'Try again in a moment.', 'warn'); }
    rg.busy = false; paintRing();
  }
  function ringLoadoutClick(e) {
    const lo = rg.st && rg.st.me && rg.st.me.lo; if (!lo) return false;
    const on = e.target.closest('[data-loon]'), off = e.target.closest('[data-looff]'), fst = e.target.closest('[data-lofirst]');
    const id = (on || off || fst || {}).dataset; if (!id) return false;
    const k = id.loon || id.looff || id.lofirst, s = ringSkill(k); if (!s) return true;
    let a = lo.a.slice(), p = lo.p.slice();
    const list = s.k === 'a' ? a : p;
    if (on && !list.includes(k)) list.push(k);
    if (off) list.splice(list.indexOf(k), 1);
    if (fst) { list.splice(list.indexOf(k), 1); list.unshift(k); }
    ringSetLoadout(a, p); return true;
  }
  async function ringKit(i, btn) {
    if (rg.busy) return; rg.busy = true; if (btn) btn.disabled = true;
    try {
      const r = await api('POST', { p: i }, '/arena/kit');
      if (!r || !r.me) throw 0;
      rg.st.me = r.me; sfx.buy();
      const p = RING_KIT[i], k = r.me.k[i];
      toast('shield', RING_TIER(k)[0] + ' ' + (p.id === 'arms' ? RING_ARMS[L.memberById('you').cls] : p.name) + ' +' + k, 'Your Ringwarden kit grows stronger. It only counts in the Ring.', 'feat');
    } catch (e) { toast('lock', 'Could not upgrade', 'Check your Laurels and try again in a moment.', 'warn'); }
    rg.busy = false; paintRing();
  }
  // ---- the duel itself, played back from the server's log ----
  async function ringDuel(id, btn) {
    if (rg.busy) return;
    const me = rg.st && rg.st.me; if (!me || !ringEnergy(me)) return;
    rg.busy = true; if (btn) btn.disabled = true;
    let r;
    try { if (Date.now() - rg.sent > 5 * 6e4) { await api('PUT', ringBuild(), '/arena'); rg.sent = Date.now(); } r = await api('POST', { id }, '/arena/fight'); if (!r || !r.log) throw 0; }
    catch (e) { rg.busy = false; if (btn) btn.disabled = false; toast('lock', 'The duel did not start', 'The Ring could not be reached. Your challenge was not spent.', 'warn'); return; }
    rg.st.me = r.me; rg.busy = false;
    playDuel(r);
  }
  function playDuel(r) {
    const you = L.memberById('you'), A = r.a, B = r.b, hp = [A.s.hp, B.s.hp];
    const sname = id => { const k = ringSkill(id); return k ? k.n : ''; };
    const kit = x => (x.lo ? x.lo.a.concat(x.lo.p) : []).map(sname).filter(Boolean);
    const ed = ringEdge(A.c, B.c), edl = ed ? '<div class="rdedge ' + (ed > 0 ? 'good' : 'bad') + '">' + esc(ed > 0 ? ringWhy(A.c, B.c) : ringWhy(B.c, A.c)) + ': ' + esc(ed > 0 ? A.n : B.n) + ' has the edge</div>' : '';
    const side = (x, i, hue) => '<div class="rdside s' + i + '"><div class="rdname"><b>' + esc(x.n) + '</b>' + classTag(x.c) + '</div><small class="rdkit">' + kit(x).map(esc).join(' &middot; ') + '</small><div class="rdfig"><img src="' + SP.spriteURL(x.c, 5, hue || 0) + '" alt=""><div class="rdpop" id="rd-pop' + i + '"></div></div>' +
      '<div class="bar rdhp"><i id="rd-hp' + i + '" style="width:100%"></i><span id="rd-ht' + i + '">' + fmt(hp[i]) + '</span></div><small>' + ringTitle(x.r) + ' &middot; ' + x.r.toLocaleString('en-US') + '</small></div>';
    modal('<div class="maphead"><div><h2>The Ember Ring</h2><small>' + esc(A.n) + ' challenges ' + esc(B.n) + '</small></div><button class="iconbtn" id="rd-x" aria-label="Close">&times;</button></div>' +
      edl + '<div class="ringduel">' + side(A, 0, lookHue(you)) + '<div class="rdvs">VS</div>' + side(B, 1, outfitHue((looksCache[B.id] || {}).k)) + '</div><div class="rdlog" id="rd-log"></div><div class="rdres" id="rd-res" hidden></div>' +
      '<div class="row"><button class="btn ghost" id="rd-skip">Skip to the end</button></div>', md => {
      $('modal').dataset.lock = '1';
      const cur = hp.slice(), lines = [];
      let i = 0, timer = 0, done = false;
      const nm = [A.n, B.n];
      const pop = (k, txt, cls) => { const p = md.querySelector('#rd-pop' + k); if (!p) return; const s = document.createElement('span'); s.className = cls; s.textContent = txt; p.appendChild(s); setTimeout(() => s.remove(), 900); };
      const paint = () => { for (const k of [0, 1]) { const w = Math.max(0, cur[k] / hp[k] * 100); md.querySelector('#rd-hp' + k).style.width = w + '%'; md.querySelector('#rd-ht' + k).textContent = fmt(Math.max(0, cur[k])); } md.querySelector('#rd-log').innerHTML = lines.slice(-3).map(l => '<p>' + l + '</p>').join(''); };
      // Log entries: [actor, damage, flag, heal, tag, health 0, health 1]. Flags: 0 hit, 1 crit, 2 miss,
      // 3 stunned (loses the turn), 4 poison or plague ticking, 5 survives a killing blow. Tag: the ability used.
      const step = quiet => {
        const e = r.log[i++]; if (!e) return false;
        const [a, d, c, hl, tag, h0, h1] = e, t = 1 - a;
        cur[0] = h0; cur[1] = h1;
        if (!quiet) {
          const fig = md.querySelector('.rdside.s' + a + ' .rdfig'), tf = md.querySelector('.rdside.s' + t + ' .rdfig');
          const an = tag && tag !== 'dot' && tag !== 'stun' && tag !== 'und' ? sname(tag) : '';
          if (c === 3) { pop(a, 'Stunned', 'miss'); sfx.thud(); lines.push('<b>' + esc(nm[a]) + '</b> is stunned and loses the turn.'); return true; }
          if (c === 5) { pop(a, 'Survives!', 'crit'); sfx.relic(); lines.push('<b>' + esc(nm[a]) + '</b> refuses to fall!'); return true; }
          if (c === 4) { pop(t, '-' + fmt(d), 'dot'); lines.push('<b>' + esc(nm[t]) + '</b> suffers ' + fmt(d) + ' from the lingering wound.'); return true; }
          fig.classList.remove('lunge'); void fig.offsetWidth; fig.classList.add('lunge');
          if (an) pop(a, an, 'abil');
          if (d > 0 || c === 1) { tf.classList.remove('struck'); void tf.offsetWidth; tf.classList.add('struck'); }
          if (c === 2) pop(t, 'Miss', 'miss'); else if (d > 0) pop(t, '-' + fmt(d), c ? 'crit' : 'dmg');
          if (hl) pop(a, '+' + fmt(hl), 'heal');
          c === 2 ? sfx.thud() : d > 0 ? sfx.hit(c === 1) : sfx.buy();
          const what = an ? 'uses <em class="ab">' + esc(an) + '</em>' + (c === 2 ? ' but misses' : d > 0 ? ' for ' + fmt(d) + (c ? ' (critical)' : '') : '') : c === 2 ? 'misses' : (c ? 'lands a <em>critical</em> blow for ' : 'hits for ') + fmt(d);
          lines.push('<b>' + esc(nm[a]) + '</b> ' + what + (hl ? ' and recovers ' + fmt(hl) : '') + '.');
        }
        return true;
      };
      const finish = () => {
        if (done) return; done = true; clearInterval(timer);
        while (step(true)); paint();
        md.querySelector('.rdside.s' + (r.win ? 1 : 0)).classList.add('fallen');
        const res = md.querySelector('#rd-res'); res.hidden = false; res.className = 'rdres ' + (r.win ? 'won' : 'lost');
        res.innerHTML = '<h3>' + (r.win ? 'Victory' : 'Defeat') + '</h3><p>' + (r.dr >= 0 ? '+' : '') + r.dr + ' rating &middot; +' + r.ll + ' Laurels' + (r.fw ? ' (first win of the day bonus)' : '') + '</p>' + (r.q < 1 ? '<p class="note small">' + (r.q > 0 ? 'Rematch: ' + Math.round(r.q * 100) + '% of the usual rating and Laurels.' : 'You have fought this hero too often today, so this duel paid nothing. Try another challenger.') + '</p>' : '');
        r.win ? sfx.relic() : sfx.fail();
        const sk = md.querySelector('#rd-skip'); sk.textContent = 'Back to the Ring'; sk.className = 'btn'; sk.onclick = close;
        rg.at = 0; loadRing(true);
      };
      const close = () => { clearInterval(timer); delete $('modal').dataset.lock; closeModal(); paintRing(); };
      md.querySelector('#rd-x').onclick = () => { finish(); close(); };
      md.querySelector('#rd-skip').onclick = finish;
      paint(); sfx.boss();
      timer = setInterval(() => { if (!step(false)) return finish(); paint(); }, 420);
    });
  }
  if ($('ringbox')) $('ringbox').addEventListener('click', e => {
    const v = e.target.closest('[data-rv]'); if (v) { rg.view = v.dataset.rv; paintRing(); if (v.dataset.rv === 'foes' || v.dataset.rv === 'top') loadRing(); return; }
    const d = e.target.closest('[data-duel]'); if (d) { ringDuel(d.dataset.duel, d); return; }
    const k = e.target.closest('[data-kit]'); if (k) { ringKit(+k.dataset.kit, k); return; }
    const sk = e.target.closest('[data-skl]'); if (sk) { ringLearn(sk.dataset.skl, sk); return; }
    if (ringLoadoutClick(e)) return;
    if (e.target.closest('#ring-ref')) { rg.sent = 0; loadRing(true); }
  });
  document.querySelectorAll('.tabs [data-tab="ring"]').forEach(b => b.addEventListener('click', () => { paintRing(); loadRing(); }));
  // Keep the challenge timer fresh while the tab is open.
  setInterval(() => { if (typeof tab !== 'undefined' && tab === 'ring' && !document.hidden && !$('modal').dataset.lock) { const a = document.activeElement; if (!a || !$('ringbox') || !$('ringbox').contains(a)) paintRing(); } }, 30000);

  // ---------- the Wardrobe: outfits and lantern styles ----------
  // Looks only: nothing here changes power. Bought with Sigils on the server (infra/lambda/looks.js);
  // keep ids and prices in step with its CAT. The art lives in vector.js (OUTFITS, LANTERNS).
  const WARDROBE = {
    k: { label: 'Outfits', items: [
      ['none', 'Field Colours', 0, 'The colours each hero carried down the stair.'],
      ['ember', 'Emberforged', 250, 'Forge-red cloth and brass, warm as the Cinder Forges.'],
      ['frost', 'Hoarfrost', 250, 'Ice-blue cloth and pale silver, cut for the cold vaults.'],
      ['wild', 'Wildwood', 250, 'Moss greens and bronze from the Hollow Roots.'],
      ['dusk', 'Duskweave', 250, 'Violet and silver, woven in the Starless Vault.'],
      ['ivory', 'Ivory Vigil', 300, 'Cream, gold and a little crimson, for ceremonies under the Hold.'],
      ['obsidian', 'Obsidian Oath', 400, 'Black steel, blood-red cloth and a drifting cinder haze.'],
      ['gilded', 'Gilded Regalia', 600, 'Gold plate and white silk, trailed by glittering motes.'],
      ['rift', 'Riftborn', 800, 'Violet and teal, with Rift light curling around the wearer.'],
      ['sworn', 'Lanternsworn', 1200, 'The bearer’s own regalia: white-gold, flame-orange and a halo of embers.']] },
    l: { label: 'Lanterns', items: [
      ['ember', 'Hearth Ember', 0, 'The lantern Old Thessaly handed you. Warm orange light.'],
      ['moon', 'Moonlit', 150, 'Silver frame, cold blue-white flame.'],
      ['wisp', 'Marsh Wisp', 150, 'A green swamp-light that never quite goes out.'],
      ['rose', 'Rosefire', 150, 'Pink flame in a copper cage.'],
      ['rift', 'Riftglass', 300, 'Violet light bent through a shard of the Rift.'],
      ['sun', 'Sunforged', 400, 'Gold frame and a flame as bright as noon.'],
      ['soul', 'Soulflame', 500, 'A teal flame that the dead are said to follow.'],
      ['void', 'Starless', 600, 'Dark glass holding a small, cold star.']] },
  };
  const wardItem = (k, id) => WARDROBE[k].items.find(x => x[0] === id) || WARDROBE[k].items[0];
  // Other players' looks (name color, title, outfit, lantern), cached by player id for chat and the Ring.
  const looksCache = {}, looksAt = {};
  // The Wardrobe shows once its server answers (signed-out players see it and are asked to sign in).
  var wardOK = false, wardV = 1;
  const wardOn = () => !!CL && (!signedIn() || wardOK);
  async function fetchLooks(ids) {
    if (!CL || !signedIn()) return false;
    const now = Date.now(), want = [...new Set(ids)].filter(x => /^[0-9a-f]{16}$/.test(x) && !(now - (looksAt[x] || 0) < 3e5)).slice(0, 40);
    if (!want.length) return false;
    want.forEach(x => looksAt[x] = now);
    try { const r = await papi('GET', '/looks?ids=' + want.join(',')); Object.assign(looksCache, r.l || {}); return true; } catch (e) { return false; }
  }
  function outfitOf(id) {
    id = String(id || '');
    if (id.startsWith('p_')) { const g = (S.guests || []).find(x => x.id === id); return (g && g.wd && g.wd.k && g.wd.k.you) || ''; }
    return (S.wd && S.wd.k && S.wd.k[id]) || '';
  }
  // The hue argument for a member's sprite: their outfit if they wear one, else their own tint.
  function lookHue(m) {
    if (!m) return 0;
    const o = outfitOf(m.id);
    return o && SP.OUTFITS && SP.OUTFITS[o] ? '0~' + o : (m.hue || 0);
  }
  const outfitHue = o => o && SP.OUTFITS && SP.OUTFITS[o] ? '0~' + o : 0;
  // ---- war banners (b.*): drawn as inline SVG; keep ids and prices in step with CAT in infra/lambda/looks.js ----
  // [name, price, description, shape, field top, field bottom, trim, charge (emblem), charge colour, effect]
  const BANNERS = {
    delver:   ['Delver’s Pennant', 0, 'A plain pennant for anyone who has gone down the stair.', 'point', '#4a5063', '#23262f', '#b8a27a', 'lantern', '#f3d9a0', ''],
    covenant: ['Iron Covenant', 200, 'Steel and slate for those who hold the line.', 'swallow', '#56698a', '#232e44', '#d4dde8', 'shield', '#eef3f8', ''],
    radiant:  ['Radiant Ascendancy', 200, 'Sun-gold silk for scholars who rise beyond.', 'point', '#f0c75e', '#9c6a14', '#fff3c4', 'sun', '#fffaf0', ''],
    tide:     ['Devouring Tide', 200, 'Deep violet, worn by those who feed the Tide.', 'swallow', '#7a3aa0', '#2a0f3e', '#d9b8ff', 'wave', '#efe0ff', ''],
    mercy:    ['Mercy Corps', 200, 'White linen and a red rose, for those who leave no one in the dark.', 'point', '#f2f5f6', '#b3c1c6', '#c23a3a', 'rose', '#c23a3a', ''],
    unsworn:  ['The Unsworn', 200, 'Weathered leather and a raven. No masters.', 'swallow', '#6a5440', '#2a1e14', '#b8a07a', 'raven', '#e8dcc4', ''],
    ember:    ['Emberfall', 350, 'Forge-red cloth that sheds sparks in the dark.', 'swallow', '#d4522a', '#5a140c', '#ffbf5a', 'flame', '#ffe3a0', 'sparks'],
    frost:    ['Wintermark', 350, 'Ice-blue silk with a frozen star, glittering as it moves.', 'point', '#a8dcf0', '#24527e', '#f0fbff', 'star', '#ffffff', 'glint'],
    rift:     ['Riftbreaker', 500, 'Torn from the Rift itself. Its charge glows with teal light.', 'swallow', '#5a30a0', '#120624', '#7affe8', 'rift', '#a8fff0', 'glow'],
    crown:    ['Crown of the Deep', 750, 'Royal crimson, gold fringe and a crown that catches every light.', 'square', '#9a1e30', '#3a0810', '#f5c242', 'crown', '#ffe08a', 'glint'],
    lantern:  ['The Last Lantern', 1000, 'Night-black silk around a burning lantern. Embers drift from it.', 'point', '#1e2a42', '#05070d', '#f5c242', 'lantern', '#ffd27a', 'embers'],
  };
  let banN = 0;
  function bannerSVG(id, cls) {
    const B = BANNERS[id]; if (!B) return '';
    const [, , , shape, c1, c2, trim, ch, cc, fx] = B, n = 'bn' + (++banN);
    const cloth = shape === 'swallow' ? 'M9 9H39V64L24 55L9 64Z' : shape === 'square' ? 'M9 9H39V60H9Z' : 'M9 9H39V57L24 67L9 57Z';
    const inner = shape === 'swallow' ? 'M12 15H36V58.5L24 51.5L12 58.5Z' : shape === 'square' ? 'M12 15H36V57H12Z' : 'M12 15H36V55.4L24 63.4L12 55.4Z';
    const glow = fx === 'glow' || fx === 'embers';
    const motes = fx === 'sparks' || fx === 'embers' ? [[17, 50, 0], [30, 46, 0.8], [24, 40, 1.6]].map(([x, y, d]) =>
      '<circle cx="' + x + '" cy="' + y + '" r="1.1" fill="' + cc + '"><animate attributeName="cy" values="' + y + ';' + (y - 30) + '" dur="2.6s" begin="' + d + 's" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="2.6s" begin="' + d + 's" repeatCount="indefinite"/></circle>').join('') : '';
    const glint = fx === 'glint' ? '<rect x="-20" y="9" width="10" height="60" fill="url(#' + n + 'g)" transform="skewX(-18)"><animate attributeName="x" values="-20;60;60" dur="4.5s" repeatCount="indefinite"/></rect>' : '';
    return '<svg class="ban' + (cls ? ' ' + cls : '') + '" viewBox="0 0 48 72" aria-hidden="true"><defs>' +
      '<linearGradient id="' + n + 'f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient>' +
      '<linearGradient id="' + n + 's" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".3" stop-color="#fff" stop-opacity=".1"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></linearGradient>' +
      '<linearGradient id="' + n + 'g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<clipPath id="' + n + 'c"><path d="' + cloth + '"/></clipPath>' +
      (glow ? '<filter id="' + n + 'b" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="1.6"/></filter>' : '') + '</defs>' +
      '<path d="M15 9L19 3M33 9L29 3" stroke="' + trim + '" stroke-width="1" fill="none" opacity=".8"/>' +
      '<path d="' + cloth + '" fill="url(#' + n + 'f)" stroke="#0b0d14" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<g clip-path="url(#' + n + 'c)"><rect x="9" y="9" width="30" height="60" fill="url(#' + n + 's)"/>' + glint + '</g>' +
      '<path d="' + inner + '" fill="none" stroke="' + trim + '" stroke-width="1.1" opacity=".9"/>' +
      '<rect x="9" y="9" width="30" height="4.5" fill="' + trim + '" opacity=".85"/>' +
      (glow ? '<g transform="translate(12 21)" filter="url(#' + n + 'b)"><path d="' + EMB[ch] + '" fill="none" stroke="' + cc + '" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/></g>' : '') +
      '<g transform="translate(12 21)"><path d="' + EMB[ch] + '" fill="none" stroke="' + cc + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></g>' + motes +
      (shape === 'square' ? '<path d="M10 60.5V64M13 60.5V64M16 60.5V64M19 60.5V64M22 60.5V64M25 60.5V64M28 60.5V64M31 60.5V64M34 60.5V64M37 60.5V64" stroke="' + trim + '" stroke-width="1.2"/>' : '') +
      '<rect x="3" y="6.5" width="42" height="3.4" rx="1.7" fill="#6a4a2c" stroke="#0b0d14" stroke-width="1"/><circle cx="3.5" cy="8.2" r="2.3" fill="' + trim + '" stroke="#0b0d14" stroke-width=".8"/><circle cx="44.5" cy="8.2" r="2.3" fill="' + trim + '" stroke="#0b0d14" stroke-width=".8"/>' +
      '</svg>';
  }
  // The banner a player shows: yours from your wardrobe, others' from their looks.
  const myBanner = () => (S.wd && S.wd.b && BANNERS[S.wd.b]) ? S.wd.b : '';
  const theirBanner = id => { const l = looksCache[id]; return l && l.b && BANNERS[l.b] ? l.b : ''; };
  WARDROBE.b = { label: 'Banners', items: [['none', 'No banner', 0, 'Fly no banner.']].concat(Object.keys(BANNERS).map(id => [id, BANNERS[id][0], BANNERS[id][1], BANNERS[id][2]])) };
  const banImgs = {};
  function banImg(id) {
    const o = banImgs[id]; if (o) return o.complete && o.naturalWidth ? o : null;
    const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bannerSVG(id).replace('<svg class', '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="144" class')); banImgs[id] = im; return null;
  }
  const lanternOf = () => (S.wd && S.wd.l && SP.LANTERNS && SP.LANTERNS[S.wd.l]) ? S.wd.l : 'ember';
  async function loadWardrobe() {
    if (!CL || !signedIn()) return null;
    try {
      const r = await papi('GET', '/wardrobe');
      if (!wardOK) { wardOK = true; try { updateGear(true); } catch (e) {} }
      wardV = r.v || 1;
      if (prof) { prof.bal = r.bal; prof.own = r.own; }
      syncRoster(r.own);
      const was = JSON.stringify(S.wd || {}); S.wd = r.wd || {};
      if (JSON.stringify(S.wd) !== was) { save(); wardRefresh(); }
      return r;
    } catch (e) { return null; }
  }
  function wardRefresh() {
    for (const k in spriteCache) delete spriteCache[k];
    try { updatePanel(true); updateSeats(true); updateGear(true); } catch (e) {}
  }
  // ---- the Wardrobe window ----
  let wd = null, wdTab = 'k', wdWho = 'you', wdDraft = null;
  const wardMembers = () => [...new Set(['you'].concat(S.party.filter(Boolean), S.unlocked || []))].filter(id => !String(id).startsWith('p_') && L.memberById(id));
  async function openWardrobe(tab, who) {
    if (tab) wdTab = tab; if (who && !String(who).startsWith('p_')) wdWho = who;
    if (!CL || !signedIn()) {
      modal('<div class="center"><h2>The Wardrobe</h2><p>Outfits for every hero and new lanterns for the party, bought with ' + TOKEN + '. Sign in so your looks stay with your account on every device.</p><div class="row"><button class="btn ghost" id="wd-x">Close</button></div></div>', md => md.querySelector('#wd-x').onclick = closeModal);
      return;
    }
    modal('<div class="center"><p class="note">Opening the Wardrobe…</p></div>');
    const [r] = await Promise.all([loadWardrobe(), prof ? null : loadProfile()]);
    if (!r) { modal('<div class="center"><h2>The Wardrobe</h2><p>The Wardrobe could not be reached. Try again in a minute.</p><div class="row"><button class="btn ghost" id="wd-x">Close</button></div></div>', md => md.querySelector('#wd-x').onclick = closeModal); return; }
    wd = r;
    wdDraft = { k: Object.assign({}, (S.wd && S.wd.k) || {}), l: (S.wd && S.wd.l) || 'ember', b: (S.wd && S.wd.b) || '' };
    if (!wardMembers().includes(wdWho)) wdWho = 'you';
    // warm the art for this hero in every outfit so the grid shows finished sprites
    const m0 = L.memberById(wdWho); WARDROBE.k.items.forEach(([id]) => { try { SP.render(m0.cls, 1, outfitHue(id)); } catch (e) {} });
    paintWardrobe();
  }
  const wardOwns = (k, id, price) => !price || (wd && wd.own.includes(k + '.' + id));
  function wardPreview() {
    const m = L.memberById(wdWho), o = wdDraft.k[wdWho] || 'none', it = wardItem('k', o), ln = wardItem('l', wdDraft.l);
    return '<div class="wdstage ln-' + ln[0] + '">' + (wdDraft.b && BANNERS[wdDraft.b] ? '<div class="wdban">' + bannerSVG(wdDraft.b) + '</div>' : '') + '<div class="wdfig"><img src="' + SP.spriteURL(m.cls, 5, outfitHue(o) || (o === 'none' ? m.hue || 0 : 0)) + '" alt=""></div>' +
      '<img class="wdlamp" src="' + SP.spriteURL('lantern', 3, '0~' + ln[0]) + '" alt="">' +
      '<div class="wdcap"><b>' + esc(m.name) + '</b><small>' + esc(it[1]) + ' &middot; ' + esc(ln[1]) + ' lantern</small></div></div>';
  }
  function paintWardrobe() {
    if (!wd) return;
    const tabs = Object.keys(WARDROBE).filter(k => k !== 'b' || wardV >= 2).map(k => '<button class="' + (wdTab === k ? 'on' : '') + '" data-wt="' + k + '">' + WARDROBE[k].label + '</button>').join('');
    let body = '';
    if (wdTab === 'k') {
      const m = L.memberById(wdWho), cur = wdDraft.k[wdWho] || 'none';
      body = '<div class="whoseg wdwho">' + wardMembers().map(id => { const x = L.memberById(id); return '<button class="whochip c-' + x.cls + (id === wdWho ? ' on' : '') + '" data-ww="' + id + '"><img src="' + SP.spriteURL(x.cls, 2, outfitHue(wdDraft.k[id]) || x.hue || 0) + '" alt=""><span>' + esc(x.name) + '</span></button>'; }).join('') + '</div>' +
        '<div class="cosgrid wdgrid">' + WARDROBE.k.items.map(([id, name, price]) => {
          const have = wardOwns('k', id, price), on = cur === id;
          return '<button class="cos wdcos' + (on ? ' on' : '') + (have ? '' : ' locked') + (price >= 600 ? ' rare' : '') + '" data-wk="' + id + '"><img src="' + SP.spriteURL(m.cls, 2, id === 'none' ? m.hue || 0 : outfitHue(id)) + '" alt=""><b>' + esc(name) + '</b><small>' + (have ? (on ? 'Wearing' : 'Owned') : sigil + price) + '</small></button>';
        }).join('') + '</div>' +
        '<p class="note">An outfit is bought once and every hero in your company can wear it.' + (wardOwns('k', cur, wardItem('k', cur)[2]) && cur !== 'none' ? ' <button class="linkbtn" id="wd-all">Dress the whole party in ' + esc(wardItem('k', cur)[1]) + '</button>' : '') + '</p>';
    } else if (wdTab === 'b' && wardV >= 2) {
      body = '<div class="cosgrid wdgrid">' + WARDROBE.b.items.map(([id, name, price]) => {
        const have = wardOwns('b', id, price), on = (wdDraft.b || 'none') === id;
        return '<button class="cos wdcos wdbn' + (on ? ' on' : '') + (have ? '' : ' locked') + (price >= 500 ? ' rare' : '') + '" data-wb="' + id + '">' + (id === 'none' ? '<span class="nobn">None</span>' : bannerSVG(id)) + '<b>' + esc(name) + '</b><small>' + (have ? (on ? 'Flying' : 'Owned') : sigil + price) + '</small></button>';
      }).join('') + '</div><p class="note">Your banner flies behind your party and shows on your hero in the Ember Ring, the Players Guild and chat.</p>';
    } else {
      body = '<div class="cosgrid wdgrid">' + WARDROBE.l.items.map(([id, name, price]) => {
        const have = wardOwns('l', id, price), on = wdDraft.l === id;
        return '<button class="cos wdcos' + (on ? ' on' : '') + (have ? '' : ' locked') + (price >= 500 ? ' rare' : '') + '" data-wl="' + id + '"><img class="lamp" src="' + SP.spriteURL('lantern', 2, '0~' + id) + '" alt=""><b>' + esc(name) + '</b><small>' + (have ? (on ? 'Carried' : 'Owned') : sigil + price) + '</small></button>';
      }).join('') + '</div><p class="note">Your lantern lights the Deep around your party and hangs beside your lead hero.</p>';
    }
    modal('<div class="maphead"><div><h2>The Wardrobe</h2><small>Looks only. Nothing here changes your party’s power. Other players see your hero’s outfit, lantern and banner in chat, the Players Guild and the Ember Ring.</small></div><button class="iconbtn" id="wd-x" aria-label="Close">&times;</button></div>' +
      wardPreview() +
      '<div class="pfbal"><span>' + sigil + '<b>' + fmt(wd.bal) + '</b> ' + TOKEN + '</span><button class="btn small ghost" id="wd-get">Get ' + TOKEN + '</button></div>' +
      '<div class="seg pfseg">' + tabs + '</div><div class="pfbody">' + body + '</div>' +
      '<div class="row"><button class="btn ghost" id="wd-cancel">Cancel</button><button class="btn" id="wd-save">Save looks</button></div>', md => {
        md.className = 'sheet wide';
        md.querySelector('#wd-x').onclick = closeModal; md.querySelector('#wd-cancel').onclick = closeModal;
        md.querySelector('#wd-get').onclick = () => getSigils(paintWardrobe);
        md.querySelectorAll('[data-wt]').forEach(b => b.onclick = () => { wdTab = b.dataset.wt; paintWardrobe(); });
        md.querySelectorAll('[data-ww]').forEach(b => b.onclick = () => { wdWho = b.dataset.ww; const x = L.memberById(wdWho); WARDROBE.k.items.forEach(([id]) => { try { SP.render(x.cls, 1, outfitHue(id)); } catch (e) {} }); paintWardrobe(); });
        md.querySelectorAll('[data-wk]').forEach(b => b.onclick = () => wardPick('k', b.dataset.wk));
        md.querySelectorAll('[data-wl]').forEach(b => b.onclick = () => wardPick('l', b.dataset.wl));
        md.querySelectorAll('[data-wb]').forEach(b => b.onclick = () => wardPick('b', b.dataset.wb));
        const all = md.querySelector('#wd-all'); if (all) all.onclick = () => { const o = wdDraft.k[wdWho]; S.party.filter(Boolean).forEach(id => { if (!String(id).startsWith('p_')) wdDraft.k[id] = o; }); paintWardrobe(); };
        md.querySelector('#wd-save').onclick = wardSave;
      });
  }
  function wardPick(k, id) {
    const it = wardItem(k, id);
    if (!wardOwns(k, id, it[2])) return wardBuy(k, it);
    if (k === 'k') { if (id === 'none') delete wdDraft.k[wdWho]; else wdDraft.k[wdWho] = id; } else if (k === 'b') wdDraft.b = id === 'none' ? '' : id; else wdDraft.l = id;
    paintWardrobe();
  }
  let wdBuyArgs = null;
  function wardBuy(k, it) {
    wdBuyArgs = [k, it];
    if (k === 'k') ['tank', 'healer', 'rogue', 'mage', 'necro'].forEach(c => { try { SP.render(c, 1, outfitHue(it[0])); } catch (e) {} });
    const [id, name, price, desc] = it, can = wd.bal >= price, m = L.memberById(wdWho);
    const pic = k === 'k' ? '<div class="wdbuy">' + ['tank', 'healer', 'rogue', 'mage', 'necro'].map(c => '<img src="' + SP.spriteURL(c, 3, outfitHue(id)) + '" alt="">').join('') + '</div>'
      : k === 'b' ? '<div class="wdbuy banner">' + bannerSVG(id) + '</div>'
      : '<div class="wdbuy lamp"><img src="' + SP.spriteURL('lantern', 4, '0~' + id) + '" alt=""></div>';
    modal('<div class="center">' + pic + '<h2>' + esc(name) + '</h2><p>' + esc(desc) + '</p><p class="note">' + (k === 'k' ? 'An outfit for every hero in your company, owned forever.' : k === 'b' ? 'A war banner for your hero, owned forever.' : 'A lantern for your party, owned forever.') + ' Looks only. ' + sigil + '<b>' + price + '</b> ' + TOKEN + '. You have ' + fmt(wd.bal) + '.</p>' +
      '<div class="row"><button class="btn ghost" id="wb-no">Back</button>' + (can ? '<button class="btn" id="wb-yes">Buy for ' + price + '</button>' : '<button class="btn" id="wb-get">Get ' + TOKEN + '</button>') + '</div></div>', md => {
        md.querySelector('#wb-no').onclick = paintWardrobe;
        const g = md.querySelector('#wb-get'); if (g) g.onclick = () => getSigils(paintWardrobe);
        const y = md.querySelector('#wb-yes'); if (y) y.onclick = async () => {
          y.disabled = true;
          try {
            const r = await papi('POST', '/wardrobe', { buy: k + '.' + id }); wd.bal = r.bal; wd.own = r.own; if (prof) { prof.bal = r.bal; prof.own = r.own; }
            try { localStorage.setItem('lh_bal', String(r.bal)); } catch (e) {}
            sfx.buy(); if (k === 'k') wdDraft.k[wdWho] = id; else if (k === 'b') wdDraft.b = id; else wdDraft.l = id;
            toast('star', name + ' is yours', 'Press Save looks to wear it' + (k === 'k' ? ' on ' + m.name : '') + '.', 'feat');
          } catch (e) { toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : e.code === 'owned' ? 'You already own it.' : 'Try again in a moment.', 'warn'); }
          paintWardrobe();
        };
      });
  }
  async function wardSave() {
    const b = $('modalbody').querySelector('#wd-save'); if (b) b.disabled = true;
    try {
      const r = await papi('POST', '/wardrobe', Object.assign({ k: wdDraft.k, l: wdDraft.l === 'ember' ? '' : wdDraft.l }, wardV >= 2 ? { b: wdDraft.b || '' } : {}));
      S.wd = r.wd; save(); try { pushCloud(true); } catch (e) {} wardRefresh(); closeModal(); sfx.buy();
      toast('star', 'Looking sharp', 'Your party wears its new looks.', 'feat');
    } catch (e) { if (b) b.disabled = false; toast('lock', 'Could not save your looks', e.code === 'item' ? 'Buy an item before you wear it.' : 'Try again in a moment.', 'warn'); }
  }
  window.addEventListener('lhsprites', () => {
    if (!wd || $('modal').hidden) return;
    const mb = $('modalbody');
    if (mb.querySelector('#wd-save')) paintWardrobe();
    else if (wdBuyArgs && mb.querySelector('#wb-no') && !mb.querySelector('#wb-yes[disabled]')) wardBuy.apply(null, wdBuyArgs);
  });
  // ---------- boot ----------
  checkEpoch(); wipedNotice(); paintAdminTab(); if (signedIn()) idToken().then(paintAdminTab);
  resize();
  window.addEventListener('resize', resize);
  syncBuySeg();
  if (!S.hero) setup(S.migratedFromV1 ? 'Lanternhold has grown. You now lead a party of five, the story has begun, and monsters fight back. Your Embers and relics carried over.' : '');
  else grantOffline((Date.now() - (S.lastSeen || Date.now())) / 1000, true);
  updateStage(); updatePanel(true); updateAbilities(true);
  setInterval(logic, 100);
  requestAnimationFrame(render);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
  window.LHDebug = { get S() { return S; }, save, L, events, lootBoss };
})();
