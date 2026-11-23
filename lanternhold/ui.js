/* lh-build 202611231442 */
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
  function save() {
    S.lastSeen = Date.now();
    const o = Object.assign({}, S); delete o.foe;
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
  function leaveArena(id) { const a = memberAnim[id], m = L.memberById(id); if (a && m) leavers.push({ cls: m.cls, hue: m.hue || 0, x: a.x - 12, y: a.y - 8, t: tAnim }); }
  const mAnim = id => (memberAnim[id] = memberAnim[id] || { hit: 0, lunge: 0, x: 0, y: 0 });
  const FRONT = { tank: 0, rogue: 1, mage: 2, necro: 3, healer: 4 };
  function partyLayout() {
    const floorY = Math.round(H * 0.7);
    const seated = S.party.filter(Boolean);
    const order = seated; // marching order: first seat stands nearest the foe
    const front = Math.round(W * FOE_X) - 58;
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
    for (const p of lay) {
      const m = L.memberById(p.id), a = mAnim(p.id), down = !!S.down[p.id];
      const flash = tAnim < a.hit;
      const spr = sprite(m.cls, m.hue || 0, flash);
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
      if (p.id === 'you') { ctx.fillStyle = '#f5c242'; ctx.beginPath(); ctx.moveTo(p.x + 10, p.y - 5.5); ctx.lineTo(p.x + 14, p.y - 5.5); ctx.lineTo(p.x + 12, p.y - 3); ctx.fill(); }
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
      const spr = sprite(m.cls, m.hue || 0, false), w2 = spr.lw * 2, h2 = spr.lh * 2;
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

  function render(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; tAnim += dt;
    ctx.setTransform(R, 0, 0, R, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const nowMs = Date.now();
    document.body.classList.toggle('resting', L.resting(S, nowMs));
    if (L.resting(S, nowMs)) { drawCamp(nowMs); requestAnimationFrame(render); return; }
    const b = L.biomeOf(S.floor);
    const key = b.name + W + 'x' + H;
    if (key !== bgKey) { bgCanvas = buildBackground(b, Math.floor((S.floor - 1) / 10) + 3); bgKey = key; }
    ctx.drawImage(bgCanvas, 0, 0, W, H);
    const floorY = Math.round(H * 0.7);

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
    pool.addColorStop(0, 'rgba(255,190,110,0.24)'); pool.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pool; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';

    // foe
    const foe = S.foe, fxC = Math.round(W * FOE_X);
    if (foe) {
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
      // foes face left, toward the party
      ctx.save(); ctx.translate(fx + sw, fy); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0, sw, sh); ctx.restore();
      ctx.globalAlpha = 1;
      foeAnim.cx = fxC; foeAnim.cy = fy + sh / 2; foeAnim.w = sw; foeAnim.h = sh;
    }
    if (foeAnim.dying) {
      const d = foeAnim.dying, a = 0.7 * (1 - (tAnim - d.t) / 0.25);
      if (a <= 0) foeAnim.dying = null;
      else { ctx.globalAlpha = a; ctx.drawImage(d.spr, d.x - (1 - a) * 4, d.y + (1 - a) * 6, d.w * (1 + (1 - a) * 0.15), d.h * (1 - (1 - a) * 0.3)); ctx.globalAlpha = 1; }
    }

    const lay = drawParty(nowMs);

    // party attacks: a member lunges and a slash in their colour lands on the foe
    if (foe && lay.length) {
      slashTimer -= dt;
      if (slashTimer <= 0) {
        slashTimer = 0.3 + Math.random() * 0.3;
        const fighters = lay.filter(p => !S.down[p.id]);
        const p = fighters[Math.floor(Math.random() * fighters.length)];
        if (p) {
          const m = L.memberById(p.id);
          mAnim(p.id).lunge = tAnim + 0.12;
          if (m.cls === 'mage' || m.cls === 'necro' || m.cls === 'healer') {
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
  function floatText(text, cls, xFrac, yFrac) {
    if (floaters > 26) return;
    const el = document.createElement('div');
    el.className = 'float ' + (cls || '');
    el.textContent = text;
    el.style.left = (xFrac * 100) + '%'; el.style.top = (yFrac * 100) + '%';
    arena.appendChild(el); floaters++;
    setTimeout(() => { el.remove(); floaters--; }, 900);
  }
  const fl = document.createElement('style');
  fl.textContent = '.float{position:absolute;transform:translate(-50%,-50%);font-weight:800;font-size:18px;color:#fff3dc;text-shadow:0 2px 0 #000,0 0 6px rgba(0,0,0,.8);pointer-events:none;animation:fl .9s ease-out forwards;font-variant-numeric:tabular-nums;white-space:nowrap}.float.crit{color:#ffcf3a;font-size:24px}.float.gold{color:#f2c14e;font-size:16px}.float.auto{font-size:14px;color:#e7d6b8}.float.hurt{color:#ff8a78;font-size:14px}.float.heal{color:#9be87a;font-size:14px}.float.skill{color:#fff1c2;font-size:13px;letter-spacing:.06em;text-transform:uppercase}.float.dodge{color:#c9d6e0;font-size:13px}@keyframes fl{0%{opacity:0;margin-top:6px}15%{opacity:1}100%{opacity:0;margin-top:-46px}}';
  document.head.appendChild(fl);

  // ---------- events ----------
  let pendingGold = 0, lastGoldFloat = 0, sealedToast = false;
  const RARITY_COLOR = { common: '#d8cfb8', fine: '#8fcf6a', rare: '#6cc4e8', epic: '#c78bff', set: '#f2c14e' };
  function handleEvents() {
    let kills = 0, gold = 0;
    for (const e of events) {
      if (e.type === 'hit') {
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
      } else if (e.type === 'dodge') {
        const a = mAnim(e.target); floatText('Dodge', 'dodge', a.x / W, (a.y - 6) / H);
      } else if (e.type === 'fall') {
        const a = mAnim(e.id); floatText(L.memberById(e.id).name + ' falls', 'hurt', a.x / W, (a.y - 10) / H);
      } else if (e.type === 'poison') {
        const a = mAnim(e.id); if (Math.random() < 0.5) floatText('Poisoned', 'heal', a.x / W, (a.y - 12) / H);
      } else if (e.type === 'ward') {
        floatText('Ward', 'skill', FOE_X, 0.3); burst(foeAnim.cx, foeAnim.cy, 18, ['#bfe6ff', '#ffffff', '#7fb8e8'], 35);
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
        if (f.boss) { sfx.boss(); toast('crown', f.name + ' defeated', 'The way down is open.', ''); }
      } else if (e.type === 'loot') {
        const it = e.item;
        if (it.rar !== 'common') { toast('gear-trinket', L.gearName(it), L.RARITY.find(r => r.id === it.rar).name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' for a ' + L.CLASSES[it.cls].name, 'loot ' + it.rar); sfx.relic(); }
        floatText(L.gearName(it), 'skill', FOE_X, 0.2);
      } else if (e.type === 'sigil') {
        sfx.relic(); floatText('+' + e.n + ' Sigils', 'skill', FOE_X, 0.15);
        toast('star', 'Sigils found!', (e.chest ? 'A chest' : 'The guardian') + ' held ' + e.n + (e.n === 1 ? ' Sigil' : ' Sigils') + '. ' + (signedIn() ? 'They go straight to your wallet.' : 'Sign in to keep them in your wallet.'), 'relic');
        claimFound();
      } else if (e.type === 'lore') {
        const lo = L.LORE.find(x => x.id === e.id); toast('book', 'New journal entry', lo.title, 'feat');
      } else if (e.type === 'wbend') {
        sendAssault(e.score, e.fell);
      } else if (e.type === 'goblinflee') {
        sfx.fail(); floatText(e.item ? 'Stolen!' : 'Escaped!', 'crit', 0.5, 0.3);
        if (e.item) toast('bag', e.again ? 'He got away again' : 'The Loot Goblin stole ' + L.gearName(e.item), (e.again ? 'He still has ' + L.gearName(e.item) + ' and' : 'He') + ' fled to floor ' + e.floor + '. Find him there and kill him to get it back.', 'warn');
      } else if (e.type === 'goblinkill') {
        sfx.relic(); floatText(e.item ? 'Got it back!' : 'Goblin slain!', 'skill', FOE_X, 0.2);
        toast('bag', e.item ? 'You got it back' : 'Loot Goblin slain', e.item ? L.gearName(e.item) + ' is back in your pack, and the goblin dropped a fat purse of gold.' : 'It dropped a fat purse of gold. Your pack is safe.', 'feat');
      } else if (e.type === 'pack') {
        floatText('Ambush!', 'crit', 0.5, 0.3);
        if (!(S.stats.packs > 0)) toast('sword', 'Ambush!', e.n + ' monsters have teamed up to jump your party. They hit harder and strike the back first, but they pay ' + (e.n * L.PACK_GOLD) + ' times the gold and often drop gear.', 'feat');
      } else if (e.type === 'herolevel') {
        sfx.relic(); floatText('Level ' + e.lv + '!', 'crit', 0.5, 0.25);
        toast('star', L.memberById('you').name + ' reached level ' + e.lv, (e.pts === 1 ? 'A new stat point' : e.pts + ' new stat points') + ' to spend on the character sheet in the Skills tab.', 'feat');
        if (tab === 'rekindle') updateSkills(); else { const hp = L.heroPoints(S); if (!S.kindling && hp) $('kindcount').textContent = '+' + hp; }
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
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 4200);
  }
  function modal(html, onMount) {
    $('modalbody').className = 'sheet'; $('modalbody').innerHTML = html; $('modal').hidden = false;
    onMount && onMount($('modalbody'));
  }
  function closeModal() { $('modal').hidden = true; }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('modal').dataset.lock) closeModal(); });

  // ---------- panel: party ----------
  const seatLeft = {};
  function sendOff(i, id, title, text) { seatLeft[i] = L.memberById(id).name; try { leaveArena(id); } catch (e) {} toast('flame', title, text, ''); }
  // ---------- camp: party changes happen at the top of the stair ----------
  // camp(): any camp, where gear can change (main camp or a Draught). mainCamp(): floor 1, where everything can change.
  const camp = () => L.atCamp(S, Date.now());
  const mainCamp = () => L.atMainCamp(S);
  function campGate(full) { if (full ? mainCamp() : camp()) return true; campModal(full); return false; }
  // Where Descend takes you: the top of the region you climbed up from.
  const backTo = () => Math.min(S.maxFloor, L.regionTop(S.campReturn || S.maxFloor));
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
  function campBarHtml() {
    const n = (S.items && S.items.draught) || 0, left = L.campLeft(S, Date.now());
    if (S.floor <= L.CAMP_FLOOR) return '<div class="campbar on"><span class="cb-ic">' + icon('flame') + '</span><div><b>At the main camp</b><small>Swap companions, recruit, train and change gear.</small></div>' + (S.maxFloor > 1 ? '<button class="btn small" data-camp="down">Descend to floor ' + backTo() + '</button>' : '') + '<button class="btn ghost small" data-camp="store">Store</button></div>';
    if (left > 0) return '<div class="campbar on"><span class="cb-ic">' + icon('flame') + '</span><div><b>Field camp: ' + Math.ceil(left) + 's</b><small>Change your party\'s gear now. You carry on from floor ' + S.floor + ' when it burns out.</small></div><button class="btn ghost small" data-camp="store">Store</button></div>';
    return '<div class="campbar"><span class="cb-ic">' + icon('lock') + '</span><div><b>In the Deep</b><small>Draught: change gear here and keep going. Main camp: change everything, then restart at floor ' + Math.min(S.maxFloor, L.regionTop(S.floor)) + '.</small></div><button class="btn small" data-camp="go">Return to camp</button><button class="btn ghost small" data-camp="drink"' + (n ? '' : ' disabled') + '>Draught (' + n + ')</button><button class="btn ghost small" data-camp="store">Store</button></div>';
  }
  let campWas = null;
  function paintCamp() {
    const h = campBarHtml();
    for (const id of ['campbar', 'campbar2', 'gearcamp']) { const el = $(id); if (el && el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; } }
    const c = camp(), cw = c + '|' + mainCamp(); if (campWas !== null && cw !== campWas) { campWas = cw; updateSeats(true); paintBoard(); updateGear(true); } campWas = cw;
    document.body.classList.toggle('incamp', mainCamp()); document.body.classList.toggle('gearok', c);
    const rc = $('restcard');
    if (rc) {
      const left = L.campLeft(S, Date.now());
      const r = left > 0 && S.floor > L.CAMP_FLOOR ? '<div><b>Resting by the fire, ' + Math.ceil(left) + 's</b><small>The party heals up. The fight waits until the draught burns out.</small></div>'
        : '<div><b>Resting at camp</b><small>The party heals by the fire. Nobody fights while you rest.</small></div>' + (S.maxFloor > 1 ? '<button class="btn small" data-camp="down">Descend to floor ' + backTo() + '</button>' : '');
      if (rc.dataset.h !== r) { rc.innerHTML = r; rc.dataset.h = r; }
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-camp]'); if (!b) return;
    const a = b.dataset.camp;
    if (a === 'go') goCamp(); else if (a === 'down') descend(); else if (a === 'drink') drinkDraught(); else if (a === 'store') openStore(); else campModal();
  });
  setInterval(paintCamp, 500);

  // ---------- store: supplies and tonics, for gold or Sigils ----------
  let qmBusy = false;
  function openStore() {
    const now = Date.now();
    const row = it => {
      const p = L.shopPrice(S, it.id), have = (S.items && S.items[it.id]) || 0, sg = L.ITEM_SIGILS[it.id], t = L.tonicById(it.id), left = t ? L.tonicLeft(S, it.id, now) : 0;
      const full = t && left + t.min * 60 > L.TONIC_CAP + 1;
      return '<div class="trow"><div class="tile r-' + (t ? 'fine' : it.id === 'draught' ? 'epic' : 'rare') + '">' + icon(it.icon) + '</div><div class="tinfo"><b>' + it.name + '</b><small>' + it.desc + '</small><small>You have ' + have + '.' + (left ? ' <span class="tleft">Active, ' + fmtTime(left) + ' left</span>' : '') + '</small></div>' +
        '<div class="tact">' + (t && have ? '<button class="btn small" data-drink="' + it.id + '"' + (full ? ' disabled title="Already at the 60 minute limit"' : '') + '>Drink</button>' : '') +
        '<button class="btn small ghost" data-buy="' + it.id + '"' + (p > S.gold ? ' disabled' : '') + '>' + icon('coin') + fmt(p) + '</button>' +
        (sg && CL && signedIn() ? '<button class="btn small ghost sigbuy" data-sbuy="' + it.id + '"' + (typeof prof !== 'undefined' && prof && prof.bal < sg ? ' disabled' : '') + '>' + sigil + sg + '</button>' : '') + '</div></div>';
    };
    const sup = L.SHOP.filter(x => !L.tonicById(x.id)), ton = L.TONICS;
    const bal = typeof prof !== 'undefined' && prof ? '<span class="stbal">' + sigil + fmt(prof.bal) + ' ' + TOKEN + '</span>' : '';
    modal('<div class="maphead"><div><h2>The Quartermaster</h2><small>Old Thessaly keeps a stall by the campfire. Everything costs gold. Speed-ups can also be bought with ' + TOKEN + '.</small></div>' + bal + '<button class="iconbtn" id="st-x" aria-label="Close">&times;</button></div>' +
      '<h3 class="sub">Tonics</h3><div class="tlist store">' + ton.map(row).join('') + '</div>' +
      '<p class="note small">Each tonic is a small boost for a short time. Different tonics stack, and drinking the same one again adds time, up to 60 minutes.</p>' +
      '<h3 class="sub">Supplies</h3><div class="tlist store">' + sup.map(row).join('') + '</div>' +
      '<p class="note small">Gold prices follow how much gold you earn. Use a Campfire Draught from the camp bar in the Party or Gear tab. Lantern Oil appears under the lantern during guardian fights.</p>', md => {
        md.className = 'sheet wide';
        md.querySelector('#st-x').onclick = closeModal;
        md.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { if (L.buyShop(S, b.dataset.buy, 1)) { sfx.coin(); save(); openStore(); paintCamp(); paintTonics(); } });
        md.querySelectorAll('[data-drink]').forEach(b => b.onclick = () => drink(b.dataset.drink, true));
        md.querySelectorAll('[data-sbuy]').forEach(b => b.onclick = async () => {
          if (qmBusy) return; qmBusy = true; b.disabled = true;
          const id = b.dataset.sbuy;
          try { const r = await papi('POST', '/store/pass', { what: 'item', id, n: 1 }); prof.bal = r.bal; S.items[id] = (S.items[id] || 0) + 1; save(); try { pushCloud(true); } catch (e) {} sfx.buy(); openStore(); paintCamp(); paintTonics(); }
          catch (e) { b.disabled = false; toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : 'Try again in a moment.', 'warn'); }
          qmBusy = false;
        });
      });
    if (CL && signedIn() && typeof prof !== 'undefined' && !prof) loadProfile().then(() => { if (!$('modal').hidden && $('modalbody').querySelector('#st-x')) openStore(); });
  }
  function drink(id, fromStore) {
    const t = L.tonicById(id);
    if (!L.drinkTonic(S, id, Date.now())) return;
    sfx.relic(); save(); toast(t.icon, t.name, t.desc.replace(/ for .*$/, '') + ' for ' + fmtTime(L.tonicLeft(S, id)) + '.', 'feat');
    if (fromStore) openStore(); paintTonics();
  }
  // Active tonics show as small timers above the ability bar; tap one you carry to drink it again.
  let tonicKey = '';
  function paintTonics() {
    const now = Date.now(), box = $('tonicbar');
    const act = L.TONICS.filter(t => L.tonicLeft(S, t.id, now) > 0), carry = L.TONICS.filter(t => !L.tonicLeft(S, t.id, now) && (S.items[t.id] || 0) > 0);
    const key = act.map(t => t.id).join() + '|' + carry.map(t => t.id + S.items[t.id]).join();
    box.hidden = !act.length && !carry.length;
    if (key !== tonicKey) {
      tonicKey = key;
      box.innerHTML = act.map(t => '<button class="tonic on" data-tonic="' + t.id + '" title="' + esc(t.name + ': ' + t.desc) + '">' + icon(t.icon) + '<span></span></button>').join('') +
        carry.map(t => '<button class="tonic" data-tonic="' + t.id + '" title="Drink ' + esc(t.name) + ': ' + esc(t.desc) + '">' + icon(t.icon) + '<span>&times;' + S.items[t.id] + '</span></button>').join('');
    }
    box.querySelectorAll('.tonic.on').forEach(b => { b.querySelector('span').textContent = fmtTime(L.tonicLeft(S, b.dataset.tonic, now)); });
  }
  $('tonicbar').addEventListener('click', e => { const b = e.target.closest('[data-tonic]'); if (b) drink(b.dataset.tonic); });
  setInterval(paintTonics, 1000);

  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const buyN = () => S.settings.buy === 'max' ? 'max' : +S.settings.buy;
  function classTag(cls) { return '<span class="ctag c-' + cls + '">' + L.CLASSES[cls].name + '</span>'; }
  function portrait(id) {
    const m = L.memberById(id);
    return '<div class="ic c-' + m.cls + (m.player ? ' player' : '') + '" data-prof="' + id + '" role="button" tabindex="0" title="About ' + esc(m.name) + '"><img src="' + SP.spriteURL(m.cls, 2, m.hue || 0) + '" alt=""></div>';
  }
  function memberStatsLine(id, now) {
    const m = L.memberById(id), L_ = L.lvl(S, id);
    const parts = ['Level <b>' + L_ + '</b>'];
    if (m.cls === 'healer') parts.push(fmt(L.healPerSec(S, id)) + ' heal/s');
    parts.push(fmt(L.memberDps(S, id, now) || 0) + ' dmg/s');
    parts.push(fmt(L.maxHpOf(S, id)) + ' hp');
    return parts.join(' &middot; ');
  }

  let seatsHtml = '', seatsAt = 0;
  function paintHp() {
    document.querySelectorAll('#seats [data-hp]').forEach(i => { const id = i.dataset.hp; i.style.width = Math.max(0, (S.hp[id] || 0) / L.maxHpOf(S, id) * 100) + '%'; });
  }
  // Companion traits: position, kinship and camp. Working ones glow.
  function traitChips(id) {
    const st = L.traitState(S, id); if (!st) return '';
    const t = st.t, chip = (kind, on) => { const x = L.traitText(kind, t[kind]), w = kind === 'pos' ? L.POS_NAME[t.pos.at].toLowerCase() + ' seat' : kind === 'kin' ? 'with a ' + L.CLASSES[t.kin.cls].name.toLowerCase() : 'at camp';
      return '<span class="trait g' + t[kind].g + (on ? ' on' : '') + '" title="' + esc(x.name + ' (' + x.grade + '). ' + x.when + ': ' + x.fx + '.') + '"><b>' + esc(x.name) + '</b> ' + esc(x.fx) + ' <i>' + esc(w) + '</i></span>'; };
    return '<div class="traits">' + chip('pos', st.pos) + chip('kin', st.kin) + chip('camp', st.camp) + '</div>';
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
        btn = '<button class="buy anywhere" data-train="' + id + '"' + (cost > S.gold ? ' disabled' : '') + '><b>Train +' + n + '</b><span>' + coin + '<em>' + fmt(cost) + '</em></span></button>' + '<button class="autot' + ((S.autoTrain || {})[id] && L.passOn(S) ? ' on' : '') + (L.passOn(S) ? '' : ' locked') + '" data-autot="' + id + '" title="Auto-train: spend gold on this character automatically" aria-pressed="' + !!(S.autoTrain || {})[id] + '">' + icon('refresh') + 'Auto</button>';
      } else btn = '<button class="btn ghost small" data-dismiss="' + id + '">Dismiss</button>';
      const mv = '<div class="mv"><button class="mini up" data-move="' + i + ':-1"' + (i === 0 ? ' disabled' : '') + ' title="Move forward" aria-label="Move ' + esc(m.name) + ' forward">&#9650;</button><button class="mini dn" data-move="' + i + ':1"' + (i === L.PARTY_SIZE - 1 ? ' disabled' : '') + ' title="Move back" aria-label="Move ' + esc(m.name) + ' back">&#9660;</button></div>';
      html += '<div class="seat' + (down ? ' down' : '') + (m.player ? ' mine' : '') + '"><span class="pos">' + (i + 1) + '<small>' + L.POS_NAME[i] + '</small></span>' + mv + portrait(id) +
        '<div class="info"><div class="nm"><a class="pname" data-prof="' + id + '">' + esc(m.name) + '</a> ' + classTag(m.cls) + (id === 'you' ? '<span class="you">You</span>' : guest ? '<span class="you guest">Player</span>' : '') + '</div>' +
        '<div class="lv">' + (down ? 'Fallen. Back up in ' + Math.ceil((down - now) / 1000) + 's' : memberStatsLine(id, now)) + '</div>' +
        traitChips(id) +
        '<div class="hpbar"><i data-hp="' + id + '"></i></div></div><div class="acts">' + btn +
        (id !== 'you' && !guest ? '<button class="rest" data-unseat="' + i + '" title="Send ' + esc(m.name) + ' to the campfire to free this seat">To campfire</button>' : '') + '</div></div>';
    }
    if (html !== seatsHtml) {
      box.innerHTML = html; seatsHtml = html;
      const fns = L.formationNotes(S), nw = fns.filter(n => n.warn).length;
      $('fsum').innerHTML = nw ? 'Formation tips: <b>' + nw + (nw === 1 ? ' warning' : ' warnings') + '</b>' : 'Formation tips: looking good';
      $('fnotes').innerHTML = fns.map(n => '<li class="' + (n.warn ? 'warn' : 'ok') + '">' + esc(n.text) + '</li>').join('') + '<li class="tip">Healers heal less the farther they stand from who they heal. Some monsters ambush from behind and hit the rear first; a tank at the back guards it.</li>';
    }
    paintHp();
    const bench = S.unlocked.filter(x => !S.party.includes(x));
    const jobsHtml = '<div class="jobs">' + L.JOBS.map(j => {
      const id = S.jobs && S.jobs[j.id], on = L.jobFree(S, id), m = on && L.memberById(id);
      return '<button class="job' + (on ? ' on' : '') + '" data-job="' + j.id + '" title="' + esc(j.desc) + '"><span class="jic">' + icon(j.icon) + '</span><b>' + j.name + '</b>' +
        (on ? '<small><img src="' + SP.spriteURL(m.cls, 2, m.hue || 0) + '" alt="">' + esc(m.name) + '</small><em>' + L.jobText(j, L.jobValue(S, j, id)) + '</em>' : '<small class="none">Nobody yet</small><em>' + j.fmt + '</em>') + '</button>';
    }).join('') + '</div>';
    let benchHtml = jobsHtml + bench.map(id => {
      const m = L.memberById(id), job = L.jobOf(S, id);
      const n = buyN() === 'max' ? Math.max(1, L.maxAffordable(S, id)) : buyN(), cost = L.trainCost(S, id, n);
      return '<div class="seat bench">' + portrait(id) + '<div class="info"><div class="nm"><a class="pname" data-prof="' + id + '">' + esc(m.name) + '</a> ' + classTag(m.cls) + '</div><div class="lv">Level ' + L.lvl(S, id) + ' &middot; ' + esc(m.title) + '</div>' +
        '<div class="jobline' + (job ? ' on' : '') + '">' + (job ? icon(job.icon) + '<b>' + job.name + '</b> ' + L.jobText(job, L.jobValue(S, job, id)) : 'No camp job. Give them one to help the party.') + '</div>' + traitChips(id) + '</div>' +
        '<div class="acts"><button class="buy" data-train="' + id + '"' + (cost > S.gold ? ' disabled' : '') + '><b>Train +' + n + '</b><span>' + coin + '<em>' + fmt(cost) + '</em></span></button>' + '<button class="autot' + ((S.autoTrain || {})[id] && L.passOn(S) ? ' on' : '') + (L.passOn(S) ? '' : ' locked') + '" data-autot="' + id + '" title="Auto-train: spend gold on this character automatically" aria-pressed="' + !!(S.autoTrain || {})[id] + '">' + icon('refresh') + 'Auto</button>' +
        '<button class="rest" data-jobfor="' + id + '">' + (job ? 'Change job' : 'Give a job') + '</button><button class="rest" data-seat="' + id + '">Bring along</button></div></div>';
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
  ['tab-party', 'tab-camp', 'tab-market'].forEach(id => $(id).addEventListener('click', partyClick));
  // camp jobs: pick who does a job, or which job someone does
  function jobModal(jid) {
    const j = L.JOBS.find(x => x.id === jid), cur = S.jobs && S.jobs[jid];
    const free = S.unlocked.filter(id => L.jobFree(S, id)).sort((a, b) => L.jobValue(S, j, b) - L.jobValue(S, j, a));
    modal('<div class="maphead"><div><h2>' + j.name + '</h2><small>' + esc(j.desc) + ' Gives ' + j.fmt + '. Higher level companions do it better' + ', and a ' + L.CLASSES[j.aff].name.toLowerCase() + ' does it half again as well.</small></div><button class="iconbtn" id="j-x" aria-label="Close">&times;</button></div>' +
      (free.length ? '<div class="choice">' + free.map(id => { const m = L.memberById(id), o = L.jobOf(S, id); return '<button class="pick jpick' + (cur === id ? ' on' : '') + '" data-pick="' + id + '"><img src="' + SP.spriteURL(m.cls, 2, m.hue || 0) + '" alt=""><span><b>' + esc(m.name) + (m.cls === j.aff ? ' <i class="aff">&#9733; ' + L.CLASSES[m.cls].name + '</i>' : '') + '</b><small>Level ' + L.lvl(S, id) + (o && o.id !== jid ? ' &middot; now ' + o.name : '') + '</small></span><em>' + L.jobText(j, L.jobValue(S, j, id)) + '</em></button>'; }).join('') + '</div>'
        : '<p class="note">Nobody is resting at the campfire. Send a companion back from your party to give them a job.</p>') +
      '<div class="row">' + (cur && L.jobFree(S, cur) ? '<button class="btn ghost" id="j-clear">Leave the job empty</button>' : '') + '<button class="btn ghost" id="j-close">Close</button></div>', md => {
        md.className = 'sheet wide';
        const done = () => { save(); closeModal(); updateSeats(true); updatePanel(true); };
        md.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { L.assignJob(S, b.dataset.pick, jid); sfx.buy(); toast(j.icon, L.memberById(b.dataset.pick).name + ' is the ' + j.name, L.jobText(j, L.jobValue(S, j, b.dataset.pick)) + ' while they rest at camp.', 'feat'); done(); });
        const c = md.querySelector('#j-clear'); if (c) c.onclick = () => { L.assignJob(S, cur, null); done(); };
        md.querySelector('#j-x').onclick = closeModal; md.querySelector('#j-close').onclick = closeModal;
      });
  }
  function jobForModal(id) {
    const m = L.memberById(id), cur = L.jobOf(S, id);
    modal('<div class="maphead"><div><h2>A job for ' + esc(m.name) + '</h2><small>Level ' + L.lvl(S, id) + ' ' + L.CLASSES[m.cls].name.toLowerCase() + '. Train them to make their job count for more.</small></div><button class="iconbtn" id="j-x" aria-label="Close">&times;</button></div>' +
      '<div class="choice">' + L.JOBS.map(j => { const h = S.jobs && S.jobs[j.id], taken = h && h !== id && L.jobFree(S, h); return '<button class="pick jpick' + (cur && cur.id === j.id ? ' on' : '') + '" data-pj="' + j.id + '"><span class="jic">' + icon(j.icon) + '</span><span><b>' + j.name + (m.cls === j.aff ? ' <i class="aff">&#9733; suits them</i>' : '') + '</b><small>' + (taken ? 'Replaces ' + esc(L.memberById(h).name) : esc(j.desc)) + '</small></span><em>' + L.jobText(j, L.jobValue(S, j, id)) + '</em></button>'; }).join('') + '</div>' +
      '<div class="row">' + (cur ? '<button class="btn ghost" id="j-clear">No job</button>' : '') + '<button class="btn ghost" id="j-close">Close</button></div>', md => {
        md.className = 'sheet wide';
        const done = () => { save(); closeModal(); updateSeats(true); updatePanel(true); };
        md.querySelectorAll('[data-pj]').forEach(b => b.onclick = () => { const j = L.JOBS.find(x => x.id === b.dataset.pj); L.assignJob(S, id, j.id); sfx.buy(); toast(j.icon, m.name + ' is the ' + j.name, L.jobText(j, L.jobValue(S, j, id)) + ' while they rest at camp.', 'feat'); done(); });
        const c = md.querySelector('#j-clear'); if (c) c.onclick = () => { L.assignJob(S, id, null); done(); };
        md.querySelector('#j-x').onclick = closeModal; md.querySelector('#j-close').onclick = closeModal;
      });
  }
  function pickSeat(id) {
    const empty = S.party.indexOf(null);
    if (empty >= 0) { L.seat(S, id, empty); updateSeats(true); updateAbilities(true); return; }
    const m = L.memberById(id);
    modal('<h2>Who goes back to the campfire?</h2><p>' + esc(m.name) + ' takes their seat.</p><div class="choice">' +
      S.party.map((x, i) => x === 'you' || !x ? '' : '<button class="pick" data-slot="' + i + '"><b>' + esc(L.memberById(x).name) + '</b><small>' + L.CLASSES[L.memberById(x).cls].name + ', level ' + L.lvl(S, x) + '</small></button>').join('') +
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
      if (boardList) h += '<div class="board">' + boardList.map(g => { const pf = g.pf || {}; return '<div class="seat bench gboard"><div class="pfava sm fr-' + cosOf('f', pf.f)[0] + '"><div class="ic c-' + g.cls + ' player">' + icon(CLASS_ICON[g.cls]) + '</div></div><div class="info"><div class="nm"><button class="linkname nc-' + cosOf('c', pf.c)[0] + '" data-gprof="' + g.id + '">' + esc(g.name) + '</button> ' + classTag(g.cls) + (pf.t ? ' <small class="pftitle">' + esc(cosOf('t', pf.t)[1]) + '</small>' : '') + (g.w ? ' ' + warBadge(g.w) : '') + '</div><div class="lv">' + (g.on ? '<span class="online">Online now</span> &middot; ' : '') + 'Level ' + g.level + ' &middot; reached floor ' + g.floor + '</div></div>' +
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
    if (a.length) h += '<div class="invites"><h4>Party invitations</h4>' + a.map(g => '<div class="seat bench gboard"><div class="ic c-' + g.cls + ' player">' + icon(CLASS_ICON[g.cls]) + '</div><div class="info"><div class="nm">' + esc(g.name) + ' ' + classTag(g.cls) + '</div><div class="lv">' + (g.on ? '<span class="online">Online now</span> &middot; ' : '') + 'Level ' + g.level + ' &middot; wants your hero in their party</div></div><span class="invact"><button class="btn small" data-invyes="' + g.id + '">Accept</button><button class="btn ghost small" data-invno="' + g.id + '">Decline</button></span></div>').join('') +
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
      const gg = (S.guests || []).find(x => x.id === 'p_' + g.id); if (gg) { gg.pf = g.pf || null; gg.w = g.w || ''; }
      sfx.buy(); toast('users', g.name + ' joins your party', 'They accepted your invite. A ' + L.CLASSES[g.cls].name + ' at level ' + g.level + '.', 'feat');
      updateSeats(true); updateAbilities(true); paintBoard();
    };
    if (S.party.includes(null)) return join();
    modal('<h2>Make room for ' + esc(g.name) + '</h2><p>' + esc(g.name) + ' accepted your invite, and your party is full. Who should step out? Story companions go back to the campfire, and players’ heroes are dismissed.</p><div class="choice">' +
      S.party.map((x, i) => x === 'you' || !x ? '' : '<button class="pick" data-out="' + i + '"><b>' + esc(L.memberById(x).name) + '</b><small>' + L.CLASSES[L.memberById(x).cls].name + ', level ' + L.lvl(S, x) + (L.isGuest(S, x) ? ' &middot; player' : '') + '</small></button>').join('') +
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
      b.classList.toggle('active', !!active); b.classList.toggle('ready', !cd && !down); b.disabled = down;
      b.querySelector('small').textContent = down ? 'Your hero has fallen' : active ? 'Active ' + fmtTime((st.until - now) / 1000) : cd ? 'Ready in ' + fmtTime(cd) : 'Ready';
      b.querySelector('.cd').style.transform = 'scaleX(' + (cd && !active ? cd / ab.cd : 0) + ')';
    });
    box.querySelectorAll('[data-cast]').forEach(b => {
      const id = b.dataset.cast, m = L.memberById(id), ab = L.CLASSES[m.cls].ability, st = S.abil[id];
      const active = st && st.until > now && ab.dur > 0, cd = st && st.readyAt > now ? (st.readyAt - now) / 1000 : 0;
      const down = !!S.down[id];
      b.classList.toggle('active', !!active); b.classList.toggle('ready', !cd && !down); b.disabled = down;
      const sm = b.querySelector('small'), ov = b.querySelector('.cd');
      sm.textContent = down ? m.name + ' has fallen' : active ? 'Active ' + fmtTime((st.until - now) / 1000) : cd ? 'Ready in ' + fmtTime(cd) : m.name + ' · Ready';
      ov.style.transform = 'scaleX(' + (cd && !active ? cd / ab.cd : 0) + ')';
    });
  }
  $('abilities').addEventListener('click', e => { const sp = e.target.closest('[data-spec]'); if (sp) { if (L.castSpec(S, sp.dataset.spec, Date.now(), events)) { handleEvents(); updateAbilities(); } return; } const b = e.target.closest('[data-cast]'); if (b) { if (L.castAbility(S, b.dataset.cast, Date.now(), events)) { handleEvents(); updateAbilities(); } } });

  // ---------- gear ----------
  let gearWho = 'you', gearKey = '';
  const SLOT_ICON = { weapon: 'sword', armor: 'gear-armor', trinket: 'gear-trinket' };
  const jobName = jid => (L.JOBS.find(j => j.id === jid) || {}).name || '';
  const affText = it => '+' + Math.round(it.aff.v * (1 + 0.1 * it.up) * 100) + '% ' + jobName(it.aff.j) + ' job';
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
        return '<button class="whochip c-' + m.cls + (id === gearWho ? ' on' : '') + '" data-who="' + id + '"><img src="' + SP.spriteURL(m.cls, 2, m.hue || 0) + '" alt=""><span>' + esc(m.name) + '</span>' + (n ? '<em title="Better gear in your pack">' + n + '</em>' : '') + '</button>';
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
      return '<div class="dslot ds-' + sl + '"><div class="tile r-' + it.rar + '" data-pos="' + sl + '" role="button" tabindex="0" title="' + esc(L.gearName(it)) + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + up + '</div><span>' + name + '</span></div>';
    };
    // totals from worn gear
    const dmg = L.gearPctOf(S, gearWho, 'dps'), hp = L.gearPctOf(S, gearWho, 'hp');
    const pc = v => '+' + Math.round(v * 100) + '%';
    const totals = [m.cls === 'healer' ? ['Healing', dmg] : ['Damage', dmg], ['Health', hp]].map(([k, v]) => '<div><small>' + k + '</small><b>' + pc(v) + '</b></div>').join('');
    let h = '<div class="doll">' +
      '<div class="dcol">' + ['head', 'neck', 'chest', 'legs'].map(slotTile).join('') + '</div>' +
      '<div class="dmid"><div class="dfig" data-prof="' + gearWho + '" role="button" tabindex="0" title="About ' + esc(m.name) + '"><img src="' + SP.spriteURL(m.cls, 5, m.hue || 0) + '" alt=""><b>' + esc(m.name) + '</b>' + classTag(m.cls) + '</div>' +
      '<div class="dstats">' + totals + '</div></div>' +
      '<div class="dcol">' + ['main', 'off', 'neck2', 'feet'].map(slotTile).join('') + '</div>' +
      '<div class="drings">' + ['ring1', 'ring2', 'ring3', 'ring4', 'ring5'].map(slotTile).join('') + '</div></div>' +
      '<div class="setinfo' + (sc ? ' on' : '') + '"><b>' + set.name + '</b> <span class="pips">' + [0, 1, 2].map(i => '<i class="' + (i < sc ? 'on' : '') + '"></i>').join('') + '</span><small>2 pieces: ' + set.two + '. 3 pieces: ' + set.three + '.</small></div>' +
      '<div class="dollbar"><small>' + cname + ' gear only. Tap a slot to change it. Worn gear stays on the character, not in the pack.</small><button class="btn small" id="g-best"' + (nb ? '' : ' disabled') + '>' + (nb ? 'Equip best (' + nb + ')' : 'Best gear on') + '</button></div>';
    $('gearslots').innerHTML = h;
    $('bagcount').textContent = S.boh ? L.packCount(S) + ' · Bag of Holding' : L.packCount(S) + '/' + L.bagCap(S); $('g-boh').hidden = !!S.boh || !CL;
    const tile = (it, dim) => {
      const w = L.wearer(S, it.uid), fit = it.cls === m.cls;
      const d = fit && !w ? Math.round((L.itemScore(it) - L.replaces(S, gearWho, it).reduce((a, x) => a + L.itemScore(x), 0)) * 100) : 0;
      return '<div class="tile r-' + it.rar + (dim ? ' dim' : '') + (w ? ' worn' : '') + '" data-item="' + it.uid + '" role="button" tabindex="0" title="' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + ' (' + itemEffect(it) + ')' + (w ? ', worn by ' + esc(L.memberById(w).name) : '') + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' +
        '<i class="lvb' + (fit && !L.canWear(S, gearWho, it) ? ' no' : '') + '" title="Needs level ' + L.reqLevel(it) + '">Lv ' + L.reqLevel(it) + '</i>' + (it.aff || it.jset ? '<i class="affb" title="Helps a camp job"></i>' : '') + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + (d > 0 && L.canWear(S, gearWho, it) ? '<i class="upb">&#9650;</i>' : '') + (w ? '<i class="wb" title="Worn">' + esc(L.memberById(w).name.charAt(0)) + '</i>' : '') + (it.lk ? '<i class="lkb" title="Locked">' + icon('lock') + '</i>' : '') + '</div>';
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
    if (e.target.closest('#g-best')) { const n = L.equipBest(S, gearWho); if (n) { sfx.buy(); toast('gear-armor', 'Best gear on', n + (n === 1 ? ' piece' : ' pieces') + ' equipped on ' + L.memberById(gearWho).name + '.', ''); updateGear(true); updateSeats(true); } return; }
    const ul = e.target.closest('[data-unlock]'); if (ul) { unlockModal(gearWho, ul.dataset.unlock); return; }
    const ps = e.target.closest('[data-pos]'); if (ps) { slotPicker(gearWho, ps.dataset.pos); return; }
    if (e.target.closest('.dfig')) { profileModal(gearWho); return; }
    const it = e.target.closest('[data-item]'); if (it) { if ((e.ctrlKey || e.metaKey) && linkItem(L.itemOf(S, it.dataset.item))) return; itemModal(it.dataset.item); }
  });
  ['tab-gear', 'tab-party', 'tab-camp', 'tab-market'].forEach(t => $(t).addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-item],[data-prof],[data-pos],[data-unlock]')) { e.preventDefault(); e.target.click(); } }));
  const itemStats = it => L.itemStats(it);
  function itemModal(uid) {
    const it = L.itemOf(S, uid); if (!it) return;
    let m = L.memberById(gearWho), w = L.wearer(S, uid);
    if (m.cls !== it.cls) { const o = gearOwners().find(id => L.memberById(id).cls === it.cls); if (o) { gearWho = o; m = L.memberById(o); } }
    const set = it.set && L.SETS.find(x => x.id === it.set);
    const fits = m.cls === it.cls, rar = L.RARITY.find(r => r.id === it.rar);
    const cost = L.upgradeCost(it), maxed = it.up >= L.UP_MAX;
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
      '<div class="ititle"><span class="irar">' + rar.name + ' ' + L.CLASSES[it.cls].name + ' ' + L.SLOT_NAME[it.slot] + '</span><h2>' + esc(L.gearName(it)) + '</h2>' + pips + '<small>Requires level <b class="' + (fits && !w && !L.canWear(S, gearWho, it) ? 'bad' : '') + '">' + L.reqLevel(it) + '</b> &middot; found on floor ' + it.ilvl + '</small></div></div>' +
      '<div class="istats">' + stats + '</div>' +
      (fits && !w ? '<p class="icmp">' + (ci ? 'Compared with ' + esc(m.name) + '’s ' + reps.map(r => esc(L.gearName(r)) + (r.up ? ' +' + r.up : '')).join(' and ') + '.' : esc(m.name) + ' has an open ' + L.SLOT_NAME[it.slot].toLowerCase() + ' slot.') + (it.slot === 'robe' ? ' A robe covers the chest and legs.' : '') + '</p>' : '') +
      (it.aff ? '<div class="iaff">' + icon('flame') + '<span><b>' + affText(it) + '</b><small>Counts while the wearer works the ' + jobName(it.aff.j) + ' job at the campfire.</small></span></div>' : '') +
      (it.jset ? (() => { const js = L.JOB_SETS[it.jset], n = wearer ? L.jobSetCount(S, w, it.jset) : 0; return '<div class="iset"><b>' + js.name + (wearer ? ' <em>' + n + '/3 worn</em>' : '') + '</b><small>A job set for the ' + jobName(it.jset) + '. It helps whoever wears it while they work that job at camp.</small><small><em>2 pieces</em> +' + Math.round(L.JOB_SET_TWO * 100) + '% ' + jobName(it.jset) + ' output</small><small><em>3 pieces</em> +' + Math.round(L.JOB_SET_THREE * 100) + '% ' + jobName(it.jset) + ' output</small></div>'; })() : '') +
      (set ? '<div class="iset"><b>' + set.name + '</b><small><em>2 pieces</em> ' + set.two + '</small><small><em>3 pieces</em> ' + set.three + '</small><small class="lore">' + esc(set.lore) + '</small></div>' : '') +
      (wearer ? '<div class="iworn"><img src="' + SP.spriteURL(wearer.cls, 2, wearer.hue || 0) + '" alt="">Worn by <b>' + esc(wearer.name) + '</b></div>' : '') +
      '<div class="iacts">' +
      (w ? '<button class="btn ghost" id="i-off">Take off</button>' : fits ? (L.canWear(S, gearWho, it) ? '<button class="btn" id="i-on">Equip on ' + esc(m.name) + '</button>' : '<button class="btn" disabled>' + esc(m.name) + ' needs level ' + L.reqLevel(it) + '</button>') : '<button class="btn" disabled>No ' + L.CLASSES[it.cls].name + ' in your roster yet</button>') +
      (maxed ? '<button class="btn ghost" disabled>Fully upgraded</button>' : '<button class="btn ghost iup" id="i-up"' + (cost > S.gold ? ' disabled' : '') + '><span>Upgrade to +' + (it.up + 1) + '</span><small>' + icon('coin') + fmt(cost) + ' &middot; ' + Object.entries(nextStats).map(([k, v]) => k.toLowerCase() + ' ' + pc(v)).join(', ') + '</small></button>') +
      '</div><div class="itools">' +
      tool('i-lk', 'lock', it.lk ? 'Unlock' : 'Lock', it.lk ? 'on' : '') +
      (CL ? tool('i-mkt', 'coin', 'Sell', it.lk ? 'off' : '') + tool('i-send', 'users', 'Send', it.lk ? 'off' : '') + tool('i-link', 'chat', 'Link') : '') +
      tool('i-sell', 'flame', 'Salvage ' + fmt(L.salvageValue(it)), 'danger' + (it.lk ? ' off' : '')) + '</div>' +
      (it.lk ? '<p class="note ilocked">' + icon('lock') + 'Locked. Mass scrap, a full pack and the Loot Goblin all leave it alone. Unlock it to sell, send or salvage.</p>' : '') + '</div>', md => {
        const locked = () => { toast('lock', 'This item is locked', 'Unlock it first to sell, send or salvage it.', 'warn'); };
        md.querySelector('#i-lk').onclick = () => { const on = L.toggleLock(S, uid); sfx.buy(); save(); updateGear(true); itemModal(uid); toast('lock', on ? 'Item locked' : 'Item unlocked', on ? L.gearName(it) + ' is safe from mass scrap, auto-sell and the Loot Goblin.' : L.gearName(it) + ' can be scrapped and sold again.', ''); };
        const gate = f => () => { if (it.lk) return locked(); if (!signedIn()) { closeModal(); toast('lock', 'Sign in to trade', 'The market and mail need a free account.', 'warn'); authForm('in'); return; } f(uid); };
        const mk = md.querySelector('#i-mkt'); if (mk) mk.onclick = gate(sellItem);
        const sd = md.querySelector('#i-send'); if (sd) sd.onclick = gate(sendItem);
        const lk = md.querySelector('#i-link'); if (lk) lk.onclick = () => { closeModal(); linkItem(it); };
        const re = () => { updateGear(true); updateSeats(true); itemModal(uid); };
        const on = md.querySelector('#i-on'); if (on) on.onclick = () => { if (!campGate()) return; L.equip(S, gearWho, uid); sfx.buy(); re(); };
        const off = md.querySelector('#i-off'); if (off) off.onclick = () => { if (!campGate()) return; L.unequip(S, w, L.wornPos(S, uid)); re(); };
        const up = md.querySelector('#i-up'); if (up) up.onclick = () => { if (!campGate()) return; if (L.upgrade(S, uid)) { sfx.relic(); re(); } };
        const sv = md.querySelector('#i-sell');
        sv.onclick = () => {
          if (it.lk) return locked();
          if (!sv.classList.contains('confirm') && (it.rar === 'epic' || it.rar === 'set' || it.up || w)) { sv.classList.add('confirm'); sv.querySelector('span').textContent = 'Tap again to salvage'; return; }
          const v = L.salvage(S, uid); sfx.coin(); closeModal(); updateGear(true); updateSeats(true); toast('coin', 'Salvaged', '+' + fmt(v) + ' gold', '');
        };
        md.querySelector('#i-close').onclick = closeModal;
      });
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
    const row = x => {
      const it = x.it, wn = x.w ? L.memberById(x.w).name : '';
      const tag = !x.ok ? '<span class="cmp down">Needs level ' + L.reqLevel(it) + '</span>' : x.d > 0 ? '<span class="cmp up">&#9650; ' + x.d + '%</span>' : x.d < 0 ? '<span class="cmp down">&#9660; ' + (-x.d) + '%</span>' : '<span class="cmp eq">Same</span>';
      return '<div class="pkrow r-' + it.rar + (x.ok ? '' : ' no') + '"><div class="tile r-' + it.rar + '" data-info="' + it.uid + '" role="button" tabindex="0" title="Details"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + '</div>' +
        '<span class="pkt"><b>' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</b><small>' + L.RARITY.find(r => r.id === it.rar).name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; ' + itemEffect(it) + (wn ? ' &middot; <i class="worn">worn by ' + esc(wn) + '</i>' : '') + '</small></span>' + tag +
        '<button class="btn small" data-pick="' + it.uid + '"' + (x.ok ? '' : ' disabled') + '>Equip</button></div>';
    };
    const head = cur ? '<div class="pkcur"><small>Wearing now</small><div class="pkrow r-' + cur.rar + '"><div class="tile r-' + cur.rar + '" data-info="' + cur.uid + '" role="button" tabindex="0"><img class="iimg" src="' + SP.itemIcon(cur.cls, cur.slot, cur.rar) + '" alt="">' + (cur.up ? '<i class="upn">+' + cur.up + '</i>' : '') + '</div><span class="pkt"><b>' + esc(L.gearName(cur)) + (cur.up ? ' +' + cur.up : '') + '</b><small>' + itemEffect(cur) + '</small></span><button class="btn small ghost" id="pk-info">Details</button><button class="btn small ghost" id="pk-off">Take off</button></div></div>'
      : robeNow ? '<p class="note">' + esc(L.gearName(robeNow)) + ' covers the legs. Leggings here will take the robe off.</p>' : '';
    modal('<div class="picker"><div class="maphead"><div><h2>' + esc(m.name) + '’s ' + name.toLowerCase() + '</h2><small>' + (camp() ? 'Pick a piece to wear here.' : 'You can look now. Changing gear happens at camp.') + '</small></div><button class="iconbtn" id="pk-x" aria-label="Close">&times;</button></div>' + head +
      (list.length ? '<div class="pklist">' + list.map(row).join('') + '</div>' : '<p class="note">No ' + L.CLASSES[m.cls].name.toLowerCase() + ' ' + (type === 'chest' ? 'chest pieces or robes' : name.toLowerCase().replace(/ \d$/, '') + 's') + ' in your pack' + (cur ? ' to swap in' : '') + ' yet. They drop from monsters, chests and guardians, and you can buy them on the Market.</p>') + '</div>', md => {
      const re = () => { updateGear(true); updateSeats(true); };
      md.querySelector('#pk-x').onclick = closeModal;
      const off = md.querySelector('#pk-off'); if (off) off.onclick = () => { if (!campGate()) return; L.unequip(S, id, pos); sfx.buy(); re(); slotPicker(id, pos); };
      const inf = md.querySelector('#pk-info'); if (inf) inf.onclick = () => itemModal(cur.uid);
      md.querySelector('.picker').onclick = e => {
        const pk = e.target.closest('[data-pick]');
        if (pk) { if (!campGate()) return; const w = L.wearer(S, pk.dataset.pick); if (w) L.unequip(S, w, L.wornPos(S, pk.dataset.pick)); if (L.equip(S, id, pk.dataset.pick, pos)) { sfx.buy(); re(); closeModal(); toast('gear-armor', 'Equipped', L.gearName(L.itemOf(S, pk.dataset.pick)) + ' on ' + m.name + '.', ''); } else re(); return; }
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
    stats.push(['Power', m.player ? 'Full (player hero)' : Math.round(L.NPC_POWER * 100) + '% (story companion)']);
    const gear = S.gear[id] || {};
    const gearList = L.openPos(S, id).filter(sl => !(sl === 'legs' && L.robeOn(S, id))).map(sl => { const it = gear[sl] && L.itemOf(S, gear[sl]); return '<li><span>' + L.SLOT_NAME[sl] + '</span>' + (it ? '<b class="r-' + it.rar + '">' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</b>' : '<i>Empty</i>') + '</li>'; }).join('');
    const bio = id === 'you' ? 'That is you. You took the lantern from Old Thessaly and carried it down the stair' + (sd ? ', under the banner of the ' + sd.name : '') + '.'
      : guest ? 'Another player’s hero, lent to your party. They fight at the level their owner trained them to. You cannot change their gear or train them.'
      : (m.bio || m.line);
    modal('<div class="prof"><div class="profhead"><div class="profspr c-' + m.cls + '"></div><div><h2>' + esc(m.name) + '</h2><small>' + esc(m.title) + '</small><div class="tags">' + classTag(m.cls) + (sd ? '<span class="sidetag" style="--side:' + sd.color + '">' + sd.name + '</span>' : '') + (guest ? '<span class="you guest">Player</span>' : '') + '</div></div></div>' +
      '<p class="bio">' + esc(bio) + '</p>' + (m.line && !guest && id !== 'you' ? '<p class="quote">“' + esc(m.line) + '”</p>' : '') +
      (id === 'you' && L.warAura(S) ? '<h3 class="sub">Grand War aura</h3><div id="p-aura">' + auraBox() + '</div>' : id === 'you' && CL ? '<div id="p-aura"></div>' : '') +
      (id === 'you' && CL ? '<h3 class="sub">Profile card</h3><p class="note">What other players see in the Players Guild.</p><div class="pfwrap" id="p-card">' + looksCard({ name: m.name, cls: m.cls, level: lv, floor: S.maxFloorEver, pf: prof && prof.pf, w: prof && prof.wv ? prof.wl : '' }) + '</div><button class="btn small" id="p-looks">Customize profile</button>' : '') +
      (guest && g0 && (g0.pf || g0.w) ? '<div class="pfwrap">' + looksCard(Object.assign({}, g0, { name: m.name, cls: m.cls })) + '</div>' : '') +
      '<h3 class="sub">' + c.name + '</h3><p class="note">' + esc(CLASS_BLURB[m.cls]) + '</p>' +
      '<div class="ability"><b>' + c.ability.name + '</b> <span>every ' + c.ability.cd + 's</span><small>' + esc(c.ability.desc) + '</small></div>' +
      '<div class="pstats">' + stats.map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('') + '</div>' +
      (sd ? '<p class="note">' + sd.name + ': “' + sd.motto + '” ' + esc(sd.desc) + '</p>' : '') +
      (guest ? '' : '<h3 class="sub">Gear</h3><ul class="pgear">' + gearList + '</ul>') +
      '<div class="row">' + (guest ? '' : '<button class="btn ghost" id="p-gear">Manage gear</button>') + (!inParty && !guest ? '<button class="btn" id="p-seat">Bring along</button>' : '') + '<button class="btn ghost" id="p-close">Close</button></div></div>', md => {
        const box = md.querySelector('.profspr'); try { const img = SP.render(m.cls, 5, m.hue || 0); if (img) box.appendChild(img); } catch (e) {}
        const g = md.querySelector('#p-gear'); if (g) g.onclick = () => { closeModal(); gearWho = id; switchTab('gear'); };
        const st = md.querySelector('#p-seat'); if (st) st.onclick = () => { closeModal(); if (campGate(true)) pickSeat(id); };
        md.querySelector('#p-close').onclick = closeModal;
        const lk = md.querySelector('#p-looks'); if (lk) lk.onclick = openProfileEditor;
        if (id === 'you' && CL && signedIn() && !prof) Promise.all([loadProfile(), loadWar()]).then(() => { const c = md.querySelector('#p-card'); if (c && prof) c.innerHTML = looksCard({ name: m.name, cls: m.cls, level: lv, floor: S.maxFloorEver, pf: prof.pf, w: prof.wv ? prof.wl : '' }); const au = md.querySelector('#p-aura'); if (au && !au.innerHTML && L.warAura(S)) au.innerHTML = '<h3 class="sub">Grand War aura</h3>' + auraBox(); });
      });
  }

  // ---------- journal: story and lore ----------
  function updateJournal() {
    const seen = L.STORY.filter(b => S.story.seen[b.id]);
    let h = '<h3 class="sub">The story so far</h3><div class="scenes">' +
      seen.map(b => '<button class="scene" data-scene="' + b.id + '"><span>Chapter ' + b.ch + '</span><b>' + esc(b.title) + '</b></button>').join('') +
      (seen.length < L.STORY.length ? '<div class="scene locked"><span>Next</span><b>' + esc(L.currentGoal(S)) + '</b></div>' : '') + '</div>';
    const groups = {};
    for (const lo of L.LORE) (groups[lo.group] = groups[lo.group] || []).push(lo);
    for (const g in groups) {
      h += '<h3 class="sub">' + g + '</h3><div class="lore">' + groups[g].map(lo => S.lore[lo.id]
        ? '<details><summary>' + esc(lo.title) + '</summary><p>' + esc(lo.text) + '</p></details>'
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
      modal('<h2>Mass scrap</h2><p>Salvage many pieces at once for gold. Gear someone is wearing and items you have locked are never scrapped.' + (S.bag.some(x => x.lk) ? ' You have <b>' + S.bag.filter(x => x.lk).length + '</b> locked.' : '') + '</p>' +
        '<div class="scrapgrid">' + L.RARITY.map(r => chk(r.id, '<span class="r-' + r.id + '" style="color:var(--rc)">' + r.name + '</span>', S.bag.filter(x => x.rar === r.id && !L.wearer(S, x.uid)).length + ' unworn')).join('') + '</div>' +
        chk('keepBest', 'Keep the best of each kind', 'Saves your strongest spare piece for every class and slot.') +
        chk('keepUp', 'Keep upgraded pieces', 'Anything you have spent gold upgrading stays.') +
        '<p class="scrapsum">' + (list.length ? 'Scraps <b>' + list.length + '</b> ' + (list.length === 1 ? 'piece' : 'pieces') + ' for <b>' + fmt(gold) + ' gold</b>.' : 'Nothing matches. Tick more rarities above.') + '</p>' +
        '<div class="row"><button class="btn danger" id="s-go"' + (list.length ? '' : ' disabled') + '>Scrap ' + list.length + '</button><button class="btn ghost" id="s-x">Cancel</button></div>', md => {
          md.querySelectorAll('[data-opt]').forEach(c => c.onchange = () => { scrapOpts[c.dataset.opt] = c.checked; draw(); });
          md.querySelector('#s-x').onclick = closeModal;
          md.querySelector('#s-go').onclick = () => {
            const l = scrapList(); let g = 0; for (const it of l) g += L.salvage(S, it.uid);
            closeModal(); sfx.coin(); updateGear(true); save();
            toast('coin', 'Scrapped ' + l.length + (l.length === 1 ? ' piece' : ' pieces'), '+' + fmt(g) + ' gold', 'feat');
          };
        });
    };
    draw();
  }
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
    $('btn-rekindle').disabled = e <= 0;
    $('rekindlenote').textContent = S.maxFloor < L.REKINDLE_FLOOR ? 'Reach floor ' + L.REKINDLE_FLOOR + ' on this descent to rekindle. You are on floor ' + S.maxFloor + '.'
      : 'Deeper floors give more Embers. Most delvers rekindle when progress slows down.';
  }
  $('btn-rekindle').addEventListener('click', () => {
    const e = L.embersFor(S); if (e <= 0) return;
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
    box.innerHTML = '<div class="khead"><div><h3>' + esc(L.memberById('you').name) + '’s ' + c.name + ' skills</h3><small>Your hero’s skills work while they are in the party. Kindling comes from rekindling.</small></div>' +
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
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tabbody').forEach(b => b.hidden = b.id !== 'tab-' + t);
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
    $('gold').textContent = fmt(S.gold);
    { const sg = $('sigils'); if (sg) { let bal = typeof prof !== 'undefined' && prof ? prof.bal : null; if (!(bal >= 0)) { bal = null; try { const c = localStorage.getItem('lh_bal'); if (c != null && +c >= 0) bal = +c; } catch (e) {} } const on = bal != null && signedIn(); if (sg.hidden === on) sg.hidden = !on; if (on) { const t = bal.toLocaleString(); if ($('sigilct').textContent !== t) { $('sigilct').textContent = t; try { localStorage.setItem('lh_bal', String(bal)); } catch (e) {} } } } }
    $('dps').textContent = fmt(L.totalDps(S, now));
    $('embers').textContent = fmt(S.embers); { const hp = S.hero ? L.heroPoints(S) : 0; $('kindcount').textContent = S.kindling ? S.kindling : hp > 0 ? '+' + hp : ''; }
    if (tab === 'party' || tab === 'camp') updateSeats(force);
    if (tab === 'market' && force) showMarketView();
    if (tab === 'guild' && force) { if (!boardList && CL && signedIn() && !boardMsg) findHeroes(); else paintBoard(); }
    if (tab === 'gear') updateGear(force);
    if (tab === 'codex') {
      if (cx === 'journal' && force) updateJournal();
      if (cx === 'war' && force) paintWarRoom();
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
      $('foename').textContent = f.pack ? f.name + ' and ' + (f.pack - 1) + ' more' : f.name;
      if (f.goblin && !f.seen) { f.seen = 1; goblinArrives(f); }
      const tag = $('foetag'); tag.textContent = f.world ? 'World boss' : f.goblin ? 'Thief' : f.pack ? 'Ambush ×' + f.pack : f.boss ? 'Guardian' : f.chest ? 'Treasure' : f.elite ? L.SIDES[f.side].name : ''; tag.className = 'tag' + (f.world ? ' world' : '') + (f.goblin ? ' thief' : '') + (f.chest ? ' chest' : '') + (f.pack ? ' ambush' : f.elite ? ' war w-' + f.side : '');
      { const mk = (f.mods || []).join(','); if (mk !== lastModKey) { lastModKey = mk; $('foemods').innerHTML = (f.mods || []).map(m => '<span class="mod m-' + m + '" title="' + esc(L.MODS[m].desc) + '">' + esc(L.MODS[m].name) + '</span>').join(''); } }
      if (f.world && S.wb) {
        const ph = L.wbPhase(wbState().total + S.wb.score), pct = ph.into / ph.need * 100;
        $('hpbar').style.width = Math.max(0, 100 - pct) + '%'; $('wardbar').style.width = '0%';
        $('hptext').textContent = 'Phase ' + (ph.broken + 1) + ' · ' + Math.floor(100 - pct) + '% left · your damage ' + (Math.floor(S.wb.score * 10) / 10);
      } else {
        $('hpbar').style.width = Math.max(0, f.hp / f.max * 100) + '%';
        $('wardbar').style.width = Math.min(100, (f.ward || 0) / f.max * 100) + '%';
        $('hptext').textContent = fmt(Math.max(0, f.hp)) + ' / ' + fmt(f.max) + (f.ward > 0 ? ' + ' + fmt(f.ward) + ' ward' : '');
      }
      $('lanternwrap').hidden = !f.boss && !f.goblin && !f.world; $('lanternwrap').classList.toggle('flee', !!f.goblin); $('lanternwrap').classList.toggle('wb', !!f.world); $('hpbar').parentNode.classList.toggle('wb', !!f.world);
      { const n = (S.items && S.items.oil) || 0; $('b-oil').hidden = !f.boss || !n || S.lantern <= 0; $('b-oil').textContent = 'Pour lantern oil (' + n + ')'; }
      if (f.world && S.wb) {
        const left = Math.max(0, (S.wb.until - Date.now()) / 1000);
        $('lanternbar').style.width = (left / L.WB_TIME * 100) + '%';
        $('lanterntext').textContent = 'Assault ends in ' + left.toFixed(0) + 's';
      } else if (f.goblin) {
        const left = Math.max(0, L.GOBLIN_TIME - f.flee);
        $('lanternbar').style.width = (left / L.GOBLIN_TIME * 100) + '%';
        $('lanterntext').textContent = 'Runs off in ' + left.toFixed(1) + 's';
      } else if (f.boss) {
        const lt = L.lanternTime(S), left = Math.max(0, lt - S.lantern);
        $('lanternbar').style.width = (left / lt * 100) + '%';
        $('lanterntext').textContent = 'Lantern oil ' + left.toFixed(1) + 's';
      }
    } else if (!L.alive(S).length) { $('foename').textContent = 'Your party is resting'; }
    if ($('auto').checked !== S.autoAdvance) $('auto').checked = S.autoAdvance;
    if ($('autocast').checked !== S.autoCast) $('autocast').checked = S.autoCast;
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
    if (ev && ev.clientX != null) {
      const r = arena.getBoundingClientRect();
      slashes.push({ x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H, a: Math.random() * Math.PI, t: tAnim, c: '#fff3dc', big: true });
    }
    handleEvents(); updateStage();
  }
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
      const joined = last && b.join && !replay ? L.memberById(b.join) : null;
      modal('<div class="scene-head"><span>Chapter ' + b.ch + '</span><h2>' + esc(b.title) + '</h2></div>' +
        '<div class="line-box"><div class="spk k-' + kind + '">' + icon(SPEAKER_ICON[kind] || 'user') + '</div><div><b>' + esc(who) + '</b><p>' + esc(text) + '</p></div></div>' +
        (joined ? '<div class="joined">' + icon(CLASS_ICON[joined.cls]) + '<span><b>' + esc(joined.name) + '</b> the ' + L.CLASSES[joined.cls].name + ' joins you.' + (S.party.includes(joined.id) ? '' : ' They wait at camp until you make room.') + '</span></div>' : '') +
        '<div class="row" style="justify-content:space-between;align-items:center"><small class="muted">' + (i + 1) + ' / ' + b.lines.length + '</small><button class="btn" id="s-next">' + (last ? (replay ? 'Close' : 'Onward') : 'Continue') + '</button></div>', md => {
          const go = () => { if (last) { delete $('modal').dataset.lock; closeModal(); sceneOpen = false; if (!replay) { save(); updateSeats(true); updateAbilities(true); updateJournal(); } } else { i++; show(); } };
          md.querySelector('#s-next').onclick = go; md.querySelector('#s-next').focus();
        });
    };
    show();
  }
  function checkStory() {
    if (sceneOpen || !$('modal').hidden || !S.hero) return;
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
    const draw = () => modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Lanternhold</h2></div>' +
      (note ? '<p class="center">' + note + '</p>' : '<p class="center">The Grand War burns across the Shattered Reach. Beneath a forgotten Hold, a single lantern keeps a tear in the Nyx Rift shut, and every alliance wants what lies under it. Take the lantern down.</p>') +
      '<h3 class="sub">Choose your class</h3><div class="classes">' + L.CLASS_ORDER.map(c => '<button class="pick cls' + (cls === c ? ' on' : '') + '" data-cls="' + c + '"><span class="ic c-' + c + '">' + icon(CLASS_ICON[c]) + '</span><b>' + L.CLASSES[c].name + '</b><small>' + CLASS_BLURB[c] + '</small></button>').join('') + '</div>' +
      '<h3 class="sub">Pledge your banner</h3><div class="sides">' + L.SIDE_ORDER.map(k => { const d = L.SIDES[k]; return '<button class="pick side' + (side === k ? ' on' : '') + (WAR_ART[k] ? ' art' : '') + '" data-side="' + k + '" style="--side:' + d.color + (WAR_ART[k] ? ';--art:url(' + WAR_ART[k] + ')' : '') + '"><b>' + d.name + '</b><i>\u201c' + d.motto + '\u201d</i><small>' + d.desc + '</small><em>' + d.perk + '</em></button>'; }).join('') + '</div>' +
      '<h3 class="sub">Name your hero</h3><input id="h-name" maxlength="16" placeholder="2 to 16 letters" autocomplete="off"><div class="err" id="h-err"></div>' +
      '<div class="row" style="justify-content:center"><button class="btn big" id="h-go">Begin the descent</button></div>', md => {
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
    try { const r = await fetch(CL.api.replace(/\/$/, '') + '/leaderboard'); if (!r.ok) return; const j = await r.json(); if (typeof j.online !== 'number') return; $('onlinect').textContent = Math.max(j.online, signedIn() && S.hero ? 1 : 0).toLocaleString('en-US'); $('online').hidden = false; } catch (e) {}
  }
  $('online').addEventListener('click', () => switchTab('guild'));
  setTimeout(loadOnline, 2000); setInterval(loadOnline, 60000);
  // ---------- settings ----------
  $('btn-settings').addEventListener('click', openSettings);
  function openSettings() {
    modal('<h2>Settings</h2>' +
      '<label class="setrow"><span>Sound effects</span><input type="checkbox" id="s-sound"' + (S.settings.sound ? ' checked' : '') + '></label>' +
      '<p style="margin-top:16px">Your progress saves automatically in this browser. Copy a backup to move it to another device.</p>' +
      '<div class="row"><button class="btn ghost" id="s-export">Copy backup</button><button class="btn ghost" id="s-import">Load backup</button><button class="btn danger" id="s-reset">Erase progress</button></div>' +
      '<div id="s-extra"></div>' +
      (window.LH_SUPPORT_URL ? '<p style="margin-top:16px">Lanternhold is free with no ads. If you enjoy it, you can <a style="color:var(--gold)" target="_blank" rel="noopener" href="' + window.LH_SUPPORT_URL + '">buy the developer a coffee</a>. Thank you.</p>' : '') +
      '<p class="credits">Lanternhold &middot; A Grand War game by Born 2 Game, LLC. &copy; 2026 Born 2 Game, LLC. Made with care, no ads, no tracking.</p>' +
      '<div class="row"><button class="btn" id="s-close">Done</button></div>', m => {
        m.querySelector('#s-sound').onchange = e => { S.settings.sound = e.target.checked; };
        m.querySelector('#s-close').onclick = () => { save(); closeModal(); };
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
  function saveObj() { S.lastSeen = Date.now(); const o = Object.assign({}, S); delete o.foe; delete o._frenzyAcc; return o; }
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
    if (!r.ok) throw new Error('cloud ' + r.status);
    return r.json();
  }
  async function pushCloud(quiet) {
    if (!CL || !signedIn()) return;
    try {
      const o = saveObj();
      await api('PUT', { data: JSON.stringify(o), floor: o.maxFloorEver });
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
    let rec; try { rec = await api('GET'); } catch (e) { return; }
    const local = saveObj();
    if (!rec) { await pushCloud(false); return; }
    let cloud; try { cloud = JSON.parse(rec.data); } catch (e) { await pushCloud(true); return; }
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
    UsernameExistsException: 'There is already an account with that email. Try signing in.', CodeMismatchException: 'That code isn’t right. Check the email and try again.',
    ExpiredCodeException: 'That code has expired. Ask for a new one.', InvalidPasswordException: 'Please use a password of at least 8 characters.',
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
      confirm: 'We sent a code to <b class="em"></b>. Enter it below.',
      forgot: 'Enter your email and we will send you a code.',
      reset: 'We sent a code to <b class="em"></b>.',
    }[mode];
    const btn = { in: 'Sign in', up: 'Create account', confirm: 'Confirm', forgot: 'Send code', reset: 'Save password' }[mode];
    const links = {
      in: '<button type="button" class="link" data-go="up">Create an account</button><button type="button" class="link" data-go="forgot">Forgot password?</button>',
      up: '<button type="button" class="link" data-go="in">I already have an account</button>',
      confirm: '<button type="button" class="link" id="f-resend">Send a new code</button>',
      forgot: '<button type="button" class="link" data-go="in">Back to sign in</button>', reset: '',
    }[mode];
    modal('<form class="auth" novalidate><h2>' + titles[mode] + '</h2><p>' + lead + '</p>' + (mode === 'in' || mode === 'up' ? '<button type="button" class="btn b2g" id="f-b2g">Continue with Born 2 Game</button><div class="or"><span>or use your email</span></div>' : '') + f +
      '<div class="err" id="f-err"></div><button class="btn" type="submit" id="f-go">' + btn + '</button><div class="links">' + links + '</div>' +
      '<p class="credits">We only keep your email and game save. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p></form>', m => {
        m.querySelectorAll('.em').forEach(x => x.textContent = email || '');
        const em = m.querySelector('#f-email'); if (em && email) em.value = email;
        const err = m.querySelector('#f-err'); if (note) { err.textContent = note; err.classList.add('ok'); }
        m.querySelectorAll('[data-go]').forEach(x => x.onclick = () => authForm(x.dataset.go, em ? em.value.trim() : email));
        const bg = m.querySelector('#f-b2g'); if (bg) bg.onclick = async () => { bg.disabled = true; try { await storeSignIn(); } catch (e) { bg.disabled = false; err.textContent = 'Could not reach the Born 2 Game store. Please try again.'; } };
        const rs = m.querySelector('#f-resend'); if (rs) rs.onclick = async () => { try { await cognito('ResendConfirmationCode', { Username: email }); err.textContent = 'New code sent.'; err.classList.add('ok'); } catch (e) { err.textContent = friendly(e); } };
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
              catch (e) { if (e.code === 'UserNotConfirmedException') { await cognito('ResendConfirmationCode', { Username: mail }); pendingPass = pass; return authForm('confirm', mail); } throw e; }
              closeModal(); toast('user', 'Signed in', 'Your progress will sync to your account.', 'feat'); reconcile();
            } else if (mode === 'up') {
              await cognito('SignUp', { Username: mail, Password: pass, UserAttributes: [{ Name: 'email', Value: mail }] });
              pendingPass = pass; authForm('confirm', mail);
            } else if (mode === 'confirm') {
              await cognito('ConfirmSignUp', { Username: email, ConfirmationCode: v('#f-code') });
              if (pendingPass) {
                takeTokens(await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: pendingPass } }), email);
                pendingPass = ''; closeModal(); toast('user', 'Account ready', 'Your progress now syncs to your account.', 'feat'); reconcile();
              } else authForm('in', email, 'Email confirmed. Sign in to continue.');
            } else if (mode === 'forgot') {
              await cognito('ForgotPassword', { Username: mail }); authForm('reset', mail);
            } else if (mode === 'reset') {
              await cognito('ConfirmForgotPassword', { Username: email, ConfirmationCode: v('#f-code'), Password: pass });
              authForm('in', email, 'Password changed. Sign in with your new password.');
            }
          } catch (e) { err.textContent = friendly(e); }
          finally { go.disabled = false; }
        };
      });
  }
  let pendingPass = '';
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
    // A verified commander link turns on the hero's Grand War aura.
    const had = JSON.stringify(S.war || null);
    if (prof.wv && prof.wl) { await loadWar(); const c = commander(prof.wl); if (c) S.war = { n: c.n, lv: c.lv | 0, h: c.h.slice(0, 12) }; }
    else delete S.war;
    if (JSON.stringify(S.war || null) !== had) { save(); updatePanel(true); }
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
    const pf = o.pf || {}, fr = cosOf('f', pf.f)[0], bn = cosOf('g', pf.g)[0], nc = cosOf('c', pf.c)[0], tt = pf.t ? cosOf('t', pf.t)[1] : '';
    return '<div class="pfcard bn-' + bn + '"><div class="pfava fr-' + fr + '"><div class="ic c-' + o.cls + ' player">' + icon(CLASS_ICON[o.cls]) + '</div></div>' +
      '<div class="pfmain"><b class="pfname nc-' + nc + '">' + esc(o.name) + '</b>' + (tt ? '<small class="pftitle">' + esc(tt) + '</small>' : '') +
      '<div class="pftags">' + classTag(o.cls) + (o.level ? '<span class="pflv">Level ' + o.level + (o.floor ? ' · floor ' + o.floor : '') + '</span>' : '') + '</div>' +
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
    const me = { name: S.hero ? S.hero.name : 'You', cls: S.hero ? S.hero.cls : 'tank', level: L.lvl(S, 'you'), floor: S.maxFloorEver, pf: draft, w: prof.wv ? prof.wl : '' };
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
      '<div class="pfbal"><span>' + sigil + '<b>' + prof.bal + '</b> ' + TOKEN + '</span><button class="btn small ghost" id="pe-get">Get Sigils</button></div>' +
      (subOn() ? '<div class="pfbal pass"><span>Lanternholder: <b>active</b>, renews ' + subDate() + '</span><button class="btn small ghost" id="pe-pass">Perks</button></div>' :
        '<div class="pfbal pass"><span>Lantern Pass: <b>' + (passLeft() || 'none') + '</b></span><button class="btn small ghost" id="pe-pass">' + (passLeft() ? 'Extend' : 'Get the pass') + '</button></div>') +
      '<div class="pfbal pass"><span>Bag of Holding: <b>' + (S.boh ? 'owned' : 'none') + '</b></span>' + (S.boh ? '' : '<button class="btn small ghost" id="pe-boh">See it</button>') + '</div>' +
      '<div class="seg pfseg">' + tabs + '</div><div class="pfbody">' + body + '</div>' +
      '<div class="row"><button class="btn ghost" id="pe-cancel">Cancel</button><button class="btn" id="pe-save">Save profile</button></div>', md => {
        md.querySelector('#pe-x').onclick = closeModal; md.querySelector('#pe-cancel').onclick = closeModal;
        md.querySelector('#pe-get').onclick = () => getSigils(paintEditor); md.querySelector('#pe-pass').onclick = openPass; const bo = md.querySelector('#pe-boh'); if (bo) bo.onclick = () => openBoh();
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
      if (r.added) { sfx.buy(); toast('star', '+' + r.added.toLocaleString() + ' ' + TOKEN, 'Your store purchase is in your wallet. Thank you for supporting Lanternhold!', 'feat'); }
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
    const w = wixGet(), linked = !!(w && (w.a || w.r)), member = subOn();
    const tiles = PACKS.map(p => '<button class="pack" data-pack="' + p[0] + '">' + sigil + '<b>' + p[1].toLocaleString() + '</b><small>' + TOKEN + '</small>' + (p[3] ? '<em>' + p[3] + '</em>' : '') + '<span>' + p[2] + '</span></button>').join('');
    modal('<div class="maphead"><div><h2>Get ' + TOKEN + '</h2><small>Looks for your profile, speed-ups, or sell them to other players for gold.</small></div><button class="iconbtn" id="gs-x" aria-label="Close">&times;</button></div>' +
      '<div class="shopsec"><h3>Sigil packs <span class="tag once">One-time purchase</span></h3><p class="shopsub">Pay once and the ' + TOKEN + ' are yours. Not a subscription: nothing renews and you are never charged again.</p></div>' +
      '<div class="packs">' + tiles + '</div>' +
      '<div class="shopsec subbox"><h3>Lanternholder <span class="tag renew">Monthly subscription</span></h3>' +
      '<p class="shopsub">' + SUB_PRICE + ' a month for the automation perks, on for as long as you stay a member.</p>' +
      '<ul class="passfx"><li><b>Auto-train</b><span>Every character trains themselves whenever you have the gold.</span></li>' +
      '<li><b>+' + L.PASS_BAG + ' bag slots</b><span>More room for loot between trips to the forge.</span></li>' +
      '<li><b>+' + L.PASS_OFFLINE / 3600 + ' hours away</b><span>Your party keeps earning offline for longer.</span></li></ul>' +
      (member ? '<p class="passstate">You are a Lanternholder. Your membership renews on <b>' + subDate() + '</b>.</p><div class="row"><a class="btn ghost" href="' + SUB_MANAGE + '" target="_blank" rel="noopener">Manage or cancel</a></div>'
        : '<div class="row"><button class="btn" id="gs-sub">Subscribe for ' + SUB_PRICE + ' / month</button></div>') +
      '<p class="note renewnote"><b>This renews automatically.</b> You are charged ' + SUB_PRICE + ' every month until you cancel. Cancel any time under My Subscriptions in your Born 2 Game account; the perks stay on until the end of the month you paid for.</p></div>' +
      (!signedIn() ? '<p class="note">Sign in to the game first so we know which hero gets the ' + TOKEN + '.</p>' :
        linked ? '<div class="storelink"><span>Store account: <b>' + esc(w.n || 'linked') + '</b></span><button class="btn small ghost" id="gs-sync">Check for purchases</button><button class="btn small ghost" id="gs-out">Unlink</button></div>' :
        '<div class="storelink"><span>Packs and memberships are sold in the Born 2 Game store. Sign in there once and every purchase lands on this hero.</span><button class="btn small" id="gs-in">Sign in with Born 2 Game</button></div>') +
      '<p class="note">Payment is handled by the Born 2 Game store at born2gamellc.com. Every account also starts with 100 ' + TOKEN + ', and the team hands more out at Grand War events.</p>' +
      '<div class="row"><button class="btn ghost" id="gs-ok">Back</button></div>', md => {
        md.querySelector('#gs-x').onclick = closeModal; md.querySelector('#gs-ok').onclick = () => back();
        const go = async (b, f) => { b.disabled = true; try { await f(); } catch (e) { b.disabled = false; toast('lock', 'Could not reach the store', 'Check your connection and try again.', 'warn'); } };
        const need = () => { if (signedIn()) return true; toast('user', 'Sign in first', 'Make a free game account so your purchase has a home.', 'warn'); return false; };
        md.querySelectorAll('[data-pack]').forEach(b => b.onclick = () => { if (need()) go(b, () => buyPack(b.dataset.pack)); });
        const sb = md.querySelector('#gs-sub'); if (sb) sb.onclick = () => { if (need()) go(sb, () => buyPack(SUB_PLAN)); };
        const i = md.querySelector('#gs-in'); if (i) i.onclick = () => go(i, storeSignIn);
        const sy = md.querySelector('#gs-sync'); if (sy) sy.onclick = async () => { sy.disabled = true; await storeSync(true); getSigils(back); };
        const o = md.querySelector('#gs-out'); if (o) o.onclick = () => { wixPut(null); toast('user', 'Store account unlinked', 'This device no longer checks it for purchases.', ''); getSigils(back); };
      });
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
  // Fetch the Sigil balance as soon as the game opens (the cached last value shows until it arrives).
  if (CL && signedIn()) loadProfile();
  setTimeout(loadMercy, 2500); setInterval(loadMercy, 3e5); setInterval(paintMercy, 3e4);
  // ---------- Lantern Pass: 30 days of convenience for 500 Sigils (auto-train, +10 bag slots, +4 h offline) ----------
  if (!S.passTrialGiven) { S.passTrialGiven = 1; S.passTrial = Date.now() + 3 * 864e5; save(); }
  const passLeft = () => { const ms = Math.max(S.pass || 0, S.passTrial || 0) - Date.now(); if (ms <= 0) return ''; const d = Math.floor(ms / 864e5); return d >= 1 ? d + (d === 1 ? ' day' : ' days') : Math.max(1, Math.ceil(ms / 36e5)) + ' h'; };
  async function openPass() {
    if (CL && signedIn() && !prof) await loadProfile();
    const left = passLeft(), trial = left && !(S.pass > Date.now()), can = prof && prof.bal >= L.PASS_COST;
    modal('<div class="maphead"><div><h2>Lantern Pass</h2><small>Convenience for 30 days. Never power.</small></div><button class="iconbtn" id="lp-x" aria-label="Close">&times;</button></div>' +
      '<ul class="passfx"><li><b>Auto-train</b><span>The Auto button under each Train button: characters train themselves whenever you have the gold.</span></li>' +
      '<li><b>+' + L.PASS_BAG + ' bag slots</b><span>More room for loot between trips to the forge.</span></li>' +
      '<li><b>+' + L.PASS_OFFLINE / 3600 + ' hours away</b><span>Your party keeps earning offline for longer.</span></li></ul>' +
      (subOn() ? '<p class="passstate">You are a <b>Lanternholder</b>: these perks are on while your membership is active (renews ' + subDate() + ').</p>' : '') +
      '<p class="passstate">' + (left ? (trial ? 'Your free trial has <b>' + left + '</b> left.' : 'Your pass has <b>' + left + '</b> left. Buying again adds 30 days.') : 'You do not have a pass right now.') + '</p>' +
      (!signedIn() ? '<p class="note">Sign in to the game to buy a pass with ' + TOKEN + '.</p>' : '') +
      (subOn() ? '' : '<p class="note">Prefer not to top up every month? The <b>Lanternholder</b> membership (' + SUB_PRICE + ' a month, renews until you cancel) keeps these perks on. Find it under Get ' + TOKEN + '.</p>') +
      '<div class="row"><button class="btn ghost" id="lp-no">Not now</button>' + (signedIn() ? (can ? '<button class="btn" id="lp-buy">' + sigil + ' ' + L.PASS_COST + ' ' + TOKEN + ' for 30 days</button>' : '<button class="btn" id="lp-get">Get ' + TOKEN + '</button>') : '') + '</div>', md => {
        md.querySelector('#lp-x').onclick = closeModal; md.querySelector('#lp-no').onclick = closeModal;
        const g = md.querySelector('#lp-get'); if (g) g.onclick = () => getSigils(openPass);
        const y = md.querySelector('#lp-buy'); if (y) y.onclick = async () => {
          y.disabled = true;
          try { const r = await papi('POST', '/store/pass'); S.pass = r.pass; prof.bal = r.bal; prof.pass = r.pass; save(); sfx.buy(); updatePanel(true); updateSeats(true); toast('star', 'Lantern Pass active', 'Auto-train, extra bag slots and longer offline time for ' + passLeft() + '.', 'feat'); closeModal(); }
          catch (e) { y.disabled = false; toast('lock', 'That did not go through', e.code === 'funds' ? 'Not enough ' + TOKEN + '.' : 'Try again in a moment.', 'warn'); }
        };
      });
  }
  // ---------- Bag of Holding: endless pack space, bought once for 6,500 Sigils ----------
  async function openBoh() {
    if (CL && signedIn() && !prof) await loadProfile();
    const can = prof && prof.bal >= L.BOH_COST;
    modal('<div class="maphead"><div><h2>Bag of Holding</h2><small>Bought once, yours for good. Never power.</small></div><button class="iconbtn" id="bh-x" aria-label="Close">&times;</button></div>' +
      '<div class="bohart">' + icon('bag') + '</div>' +
      '<p>A satchel stitched from Rift-silk by the Hold’s quartermasters. Whatever goes in finds room, and nothing is ever sold off because your pack was full.</p>' +
      '<ul class="passfx"><li><b>Endless pack</b><span>No item limit. Keep every set piece and job item you find.</span></li>' +
      '<li><b>No more auto-selling</b><span>Loot is never sold off for lack of space, and market returns and mail always fit.</span></li></ul>' +
      (S.boh ? '<p class="passstate">You own the Bag of Holding.</p>' : '<p class="passstate">Costs <b>' + fmt(L.BOH_COST) + ' ' + TOKEN + '</b>, once. ' + (prof ? 'You have ' + fmt(prof.bal) + '.' : '') + '</p>') +
      (!signedIn() ? '<p class="note">Sign in to the game to buy it with ' + TOKEN + '.</p>' : '') +
      '<div class="row"><button class="btn ghost" id="bh-no">' + (S.boh ? 'Close' : 'Not now') + '</button>' + (signedIn() && !S.boh ? (can ? '<button class="btn" id="bh-buy">' + sigil + ' Buy for ' + fmt(L.BOH_COST) + ' ' + TOKEN + '</button>' : '<button class="btn" id="bh-get">Get ' + TOKEN + '</button>') : '') + '</div>', md => {
        md.querySelector('#bh-x').onclick = closeModal; md.querySelector('#bh-no').onclick = closeModal;
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
  const questsReady = () => { const q = L.questState(S); const got = S.daily.got; return q.filter(x => x.done && !x.got).length + (q.every(x => x.got) && !(got & 8) ? 1 : 0); };
  function paintQuests() {
    const q = L.questState(S), b = $('quests'); if (!b) return;
    const n = q.filter(x => x.got).length, rd = questsReady(), all = n === 3 && (S.daily.got & 8);
    $('questct').textContent = rd ? 'Claim ' + rd : all ? 'Quests done' : 'Quests ' + n + '/3';
    b.classList.toggle('ready', rd > 0); b.classList.toggle('done', !rd && !!all);
    b.title = rd ? 'Daily quests: ' + rd + (rd === 1 ? ' reward' : ' rewards') + ' ready to claim' : all ? 'Daily quests: all done for today' : 'Daily quests: ' + n + ' of 3 done';
  }
  function openQuests() {
    const q = L.questState(S), got = S.daily.got, allGot = q.every(x => x.got), msLeft = Date.parse(L.questDay() + 'T00:00:00Z') + 864e5 - Date.now();
    const pct = v => (Math.round(v * 10000) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
    const row = x => '<li class="quest' + (x.got ? ' got' : x.done ? ' done' : '') + '"><div><b>' + esc(x.text) + '</b><div class="qbar"><i style="width:' + Math.round(x.have / x.n * 100) + '%"></i></div><small>' + x.have.toLocaleString('en-US') + ' / ' + x.n.toLocaleString('en-US') + '</small></div>' +
      (x.got ? '<span class="qok">' + sigil + '+' + L.QUEST_REWARD + '</span>' : '<button class="btn small" data-q="' + x.i + '"' + (x.done ? '' : ' disabled') + '>' + sigil + ' Claim ' + L.QUEST_REWARD + '</button>') + '</li>';
    modal('<div class="maphead"><div><h2>Daily quests</h2><small>New quests in ' + Math.max(1, Math.floor(msLeft / 36e5)) + 'h ' + Math.floor(msLeft % 36e5 / 6e4) + 'm. Same quests for every hero.</small></div><button class="iconbtn" id="dq-x" aria-label="Close">&times;</button></div>' +
      '<ul class="quests">' + q.map(row).join('') +
      '<li class="quest bonus' + (got & 8 ? ' got' : allGot ? ' done' : '') + '"><div><b>Finish all three</b><small>A bonus for clearing the day.</small></div>' + (got & 8 ? '<span class="qok">' + sigil + '+' + L.QUEST_BONUS + '</span>' : '<button class="btn small" data-q="3"' + (allGot ? '' : ' disabled') + '>' + sigil + ' Claim ' + L.QUEST_BONUS + '</button>') + '</li></ul>' +
      (signedIn() ? '' : '<p class="note">Sign in to claim quest rewards. Your progress still counts.</p>') +
      '<h3 class="sub">Finding Sigils</h3><p class="note">Now and then a treasure chest or a guardian holds 1 to 3 Sigils. Your odds: <b>' + pct(L.sigilChance(S, 'chest')) + '</b> per chest and <b>' + pct(L.sigilChance(S, 'boss')) + '</b> per guardian. Every 30 floors of your deepest descent adds 0.01%, up to 0.05%, and the Kindling upgrade Sigil Sense adds 0.01% per rank. You can bank up to ' + L.SIGIL_DROP_DAY + ' found Sigils a day.</p>' +
      '<div class="row"><button class="btn ghost" id="dq-ok">Close</button></div>', md => {
        md.querySelector('#dq-x').onclick = closeModal; md.querySelector('#dq-ok').onclick = closeModal;
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
    el.innerHTML = n ? '<b>Banner kin ×' + n + '</b>: ' + n + (n === 1 ? ' ally marches' : ' allies march') + ' under ' + esc(d.name) + ', so your banner perk (' + esc(d.perk) + ') is <b>' + Math.round(L.KIN_AMP * n * 100) + '% stronger</b>.'
      : 'Recruit companions or players who fly the banner of <b>' + esc(d.name) + '</b>. Each one makes your banner perk (' + esc(d.perk) + ') 40% stronger.';
  }
  setInterval(paintKin, 2000); setTimeout(paintKin, 600);
  // ---------- Character sheet: hero level, XP and stats ----------
  const STAT_LBL = { pdps: 'party damage', crit: 'crit chance', dodge: 'dodge', php: 'party health', power: 'ability power', pheal: 'party healing', cd: 'faster abilities', gold: 'gold', loot: 'loot', chest: 'chest chance', sig: 'Sigil odds', spoils: 'ambush spoils' };
  const pctTxt = v => { const p = v * 100; return '+' + (p >= 1 ? Math.round(p * 10) / 10 : p >= 0.01 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000) + '%'; };
  const statMod = sc => { const m = Math.floor((sc - 10) / 2); return (m >= 0 ? '+' : '') + m; };
  function paintSheet() {
    const box = $('charsheet'); if (!box) return;
    const cls = L.heroCls(S);
    if (!cls) { box.innerHTML = ''; return; }
    const h = L.heroLevel(S), pts = L.heroPoints(S), pri = L.STAT_CLASS[cls] || [], c = L.CLASSES[cls];
    const row = st => {
      const n = (S.attr || {})[st.id] || 0, sc = L.statScore(S, st.id), fav = pri.includes(st.id), mult = fav ? L.STAT_AFFINITY : 1;
      const fx = Object.keys(st.fx).map(k => pctTxt(st.fx[k] * Math.max(n, 0) * mult) + ' ' + STAT_LBL[k]).join(', ');
      return '<div class="cstat' + (fav ? ' fav' : '') + '"><div class="cscore"><b>' + sc + '</b><small>' + statMod(sc) + '</small></div>' +
        '<div class="ctx"><b>' + st.name + (fav ? ' <span class="cfav">' + c.name + ' favoured</span>' : '') + '</b><small>' + (n ? fx : 'Raises ' + st.desc + '.') + '</small></div>' +
        '<div class="cbtns"><button class="btn small" data-stat="' + st.id + '"' + (pts > 0 && sc < L.STAT_MAX ? '' : ' disabled') + ' aria-label="Add a point to ' + st.name + '">+1</button>' +
        (pts >= 5 ? '<button class="btn small ghost" data-stat5="' + st.id + '"' + (sc + 5 <= L.STAT_MAX ? '' : ' disabled') + '>+5</button>' : '') + '</div></div>';
    };
    box.innerHTML = '<div class="chead"><div><h3>' + esc(L.memberById('you').name) + ', level ' + h.lv + ' ' + c.name + '</h3><small>Your hero earns XP from every fight, even when they sit out. Bigger foes give more.</small></div>' +
      '<div class="kbal cpts' + (pts ? ' on' : '') + '">' + icon('star') + '<b>' + pts + '</b><small>' + (pts === 1 ? 'Point' : 'Points') + '</small></div></div>' +
      '<div class="cxp"><i style="width:' + Math.min(100, h.xp / h.need * 100).toFixed(1) + '%"></i><span>' + fmt(Math.floor(h.xp)) + ' / ' + fmt(h.need) + ' XP to level ' + (h.lv + 1) + '</span></div>' +
      '<div class="cgrid">' + L.STATS.map(row).join('') + '</div>' +
      '<div class="kfoot"><span>Favoured stats count half again. Stats work while your hero is in the party. A reset costs ' + L.RESPEC_COST + ' ' + TOKEN + '.</span>' + ((S.attr && Object.keys(S.attr).length) ? '<button class="btn ghost small" id="c-reset">Reset stats</button>' : '') + '</div>';
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
    if (w) setTimeout(() => toast('flame', 'A fresh start', 'The Deep has been reset for everyone. Every delver starts again from the top of the stair.', 'feat'), 1500);
  }
  function isAdmin() { return !!(sess && sess.id && String(claims(sess.id)['cognito:groups'] || '').includes('admins')); }
  async function adminApi(method, path, body) {
    const tok = await idToken(); if (!tok) throw new Error('Sign in first.');
    const r = await fetch(CL.api.replace(/\/$/, '') + path, { method, headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 403 ? 'This account is not an admin.' : j.error === 'self' ? 'You cannot ban yourself.' : j.error === 'player' ? 'That player has not played since bans were added, so their account cannot be found yet.' : 'The server said no (' + r.status + ').');
    return j;
  }
  let adminList = null, adminQ = '', adminBusy = false, adminLinks = [];
  function paintAdminTab() { const t = $('tabadmin'); if (t) t.hidden = !isAdmin(); }
  async function loadAdmin() {
    $('adminbox').innerHTML = '<p class="note">Loading players…</p>';
    try { adminList = await adminApi('GET', '/admin/players'); } catch (e) { $('adminbox').innerHTML = '<p class="note">' + esc(e.message) + '</p>'; return; }
    try { adminLinks = (await adminApi('GET', '/admin/links')).links || []; await loadWar(); } catch (e) { adminLinks = []; }
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
      '<div class="adm-list">' + (list.length ? list.map(p => '<div class="adm-row' + (p.banned ? ' banned' : '') + '"><span class="adm-n"><b>' + esc(p.name || 'Unnamed') + '</b>' + (p.cls ? ' ' + classTag(p.cls) : '') + '<small>' + (p.banned ? 'Banned' : (p.on ? '<span class="online">Online now</span> &middot; ' : 'Seen ' + ago(p.seen) + ' &middot; ') + 'level ' + p.level + ', floor ' + p.floor) + '</small></span>' +
        (p.canBan ? '<button class="btn small ghost" data-grant="' + p.id + '">Sigils</button>' : '') + (p.banned ? '<button class="btn small ghost" data-unban="' + p.id + '">Unban</button>' : '<button class="btn small danger" data-ban="' + p.id + '"' + (p.canBan ? '' : ' disabled title="They need to play once more before they can be banned"') + '>Ban</button>') + '</div>').join('') : '<p class="note">No players match.</p>') + '</div>' +
      '<h3 class="sub">Grand War links</h3>' + (adminLinks.length ? '<p class="note">Players asking to show their Grand War commander badges. Approve only when you know the player is that commander, for example from Discord.</p><div class="adm-list">' + adminLinks.sort((a, c) => a.wv - c.wv).map(l => '<div class="adm-row"><span class="adm-n"><b>' + esc(l.name || 'Unnamed') + '</b> wants to be <b>' + esc(l.wl) + '</b><small>' + (commander(l.wl) ? warBadge(l.wl) : 'Not on the war ladder right now') + (l.wv ? ' &middot; <span class="online">Verified</span>' : ' &middot; Waiting') + '</small></span>' + (l.wv ? '' : '<button class="btn small" data-lok="' + l.id + '">Approve</button>') + '<button class="btn small ghost" data-lno="' + l.id + '">' + (l.wv ? 'Remove' : 'Reject') + '</button></div>').join('') + '</div>' : '<p class="note">No players have asked to link a Grand War commander yet.</p>') +
      '<div class="adm-danger"><h3 class="sub">Wipe the server</h3><p class="note">Deletes every cloud save, every hero on the guild board and every market listing and letter. Everyone, signed in or not, starts over from a new game the next time they open Lanternhold. Bans, Sigils, bought looks and Grand War links stay in place. This cannot be undone.</p><button class="btn danger" id="adm-wipe">Wipe the server…</button></div>';
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
  document.querySelector('.tabs [data-tab="admin"]').addEventListener('click', () => loadAdmin());

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
        (top.length ? '<ol class="lboard">' + top.map((p, i) => '<li class="' + (i < 3 ? 'top' + (i + 1) : '') + (p.name === me ? ' me' : '') + '"><span class="lbr">' + (i + 1) + '</span><span class="lbn"><b>' + esc(p.name) + '</b> ' + classTag(p.cls) + (L.SIDES[p.side] ? '<small>' + esc(L.SIDES[p.side].name) + '</small>' : '') + '</span><span class="lbf"><b>Floor ' + p.floor + '</b><small>level ' + p.level + '</small></span></li>').join('') + '</ol>' : '<p class="note">Nobody is on the board yet. Be the first.</p>');
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
  const chat = { ch: 'global', leader: null, open: false, msgs: {}, since: {}, timer: 0, me: null, rooms: [], muted: new Set() };
  try { JSON.parse(localStorage.getItem('lanternhold.muted') || '[]').forEach(x => chat.muted.add(x)); } catch (e) {}
  const roomKey = () => chat.ch + (chat.ch === 'party' ? ':' + (chat.leader || 'mine') : '');
  async function chatCall(method, path, body) {
    const tok = await idToken(); if (!tok) throw Object.assign(new Error('signed out'), { status: 401 });
    const r = await fetch(CL.api.replace(/\/$/, '') + path, { method, headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'chat'), { status: r.status, code: j.error });
    return j;
  }
  function chatNote(t, warn) { const n = $('chatnote'); n.textContent = t || 'Be kind. No web links. Ctrl+click an item to link it. Tap a name to mute or report.'; n.classList.toggle('warn', !!warn); }
  // Item links: Ctrl/Cmd+click an item (or use Link in chat) to drop it into the message.
  const ITEM_TOKEN = /\[\[i:(tank|healer|rogue|mage|necro),(weapon|armor|trinket|main|off|head|neck|chest|robe|legs|feet|ring),(common|fine|rare|epic|set),([a-z]{0,8}),(\d{1,6}),(\d{1,2})\]\]/g;
  const tokenOf = it => '[[i:' + it.cls + ',' + it.slot + ',' + it.rar + ',' + (it.set || '') + ',' + it.ilvl + ',' + (it.up || 0) + ']]';
  const itemLabel = it => L.gearName(it) + (it.up ? ' +' + it.up : '');
  function itemFromToken(m) {
    const it = L.normItem({ cls: m[1], slot: m[2], rar: m[3], set: m[4] || undefined, ilvl: +m[5], up: Math.min(+m[6], L.UP_MAX) });
    if (it.set && !L.SETS.some(x => x.id === it.set && x.cls === it.cls)) return null;
    if (it.rar === 'set' && !it.set) return null;
    try { L.gearName(it); return it; } catch (e) { return null; }
  }
  chat.links = [];
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
  function paintChat() {
    const log = $('chatlog'), k = roomKey(), list = (chat.msgs[k] || []).filter(m => !chat.muted.has(m.from));
    if (!signedIn()) { log.innerHTML = '<div class="chatempty"><p>Sign in to chat with other delvers.</p><button class="btn small" id="chat-in">Sign in</button></div>'; $('chatform').hidden = true; return; }
    if (!S.hero) { log.innerHTML = '<div class="chatempty"><p>Create your hero first.</p></div>'; $('chatform').hidden = true; return; }
    $('chatform').hidden = false;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = list.length ? list.map(m => m.from === 'sys' ? '<div class="msg sys ' + esc(m.cls) + '">' + icon('flame') + '<span>' + esc(m.text) + '</span></div>' : '<div class="msg' + (m.from === chat.me ? ' mine' : '') + '"><button class="who c-' + esc(m.cls) + '" data-from="' + esc(m.from) + '" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">' + esc(m.name) + '</button><span>' + renderText(m.text) + '</span></div>').join('')
      : '<div class="chatempty"><p>' + (chat.ch === 'trade' ? 'Nobody is trading yet. Post what you have or what you need.' : chat.ch === 'banner' ? 'Banner chat. Only heroes who march under ' + ((L.SIDES[S.hero.side] || {}).name || 'your banner') + ' can read this.' : chat.ch === 'party' ? 'Your party chat. Players whose heroes you recruit, or who recruit yours, can talk here.' : 'Quiet down here. Say hello.') + '</p></div>';
    if (atBottom || list.length < 25) log.scrollTop = log.scrollHeight;
  }
  async function pollChat() {
    clearTimeout(chat.timer);
    if (!chat.open || !signedIn() || !S.hero || document.hidden) { if (chat.open) chat.timer = setTimeout(pollChat, CHAT_POLL_OPEN); return; }
    const k = roomKey();
    try {
      const q = '?ch=' + chat.ch + (chat.ch === 'party' && chat.leader ? '&leader=' + chat.leader : '') + '&since=' + encodeURIComponent(chat.since[k] || '0');
      const r = await chatCall('GET', '/chat' + q);
      chat.me = r.me;
      if (r.msgs.length) {
        const cur = chat.msgs[k] || [], seen = new Set(cur.map(m => m.id));
        chat.msgs[k] = cur.concat(r.msgs.filter(m => !seen.has(m.id))).slice(-120);
        chat.since[k] = chat.msgs[k][chat.msgs[k].length - 1].id;
      } else chat.msgs[k] = chat.msgs[k] || [];
      if (k === roomKey()) paintChat();
    } catch (e) { if (e.status === 403) { chatNote('You are no longer in that party.', true); } }
    chat.timer = setTimeout(pollChat, CHAT_POLL_OPEN);
  }
  async function loadRooms() {
    try { const r = await chatCall('GET', '/parties'); chat.me = r.me; chat.rooms = r.parties || []; } catch (e) { chat.rooms = []; }
    const sel = $('chatroom');
    sel.innerHTML = '<option value="">My party</option>' + chat.rooms.map(p => '<option value="' + esc(p.leader) + '">' + esc(p.name) + '’s party</option>').join('');
    sel.value = chat.leader || ''; sel.hidden = chat.ch !== 'party' || !chat.rooms.length;
  }
  function setChannel(ch) {
    chat.ch = ch; document.querySelectorAll('#chatch button').forEach(b => b.classList.toggle('on', b.dataset.ch === ch));
    $('chatin').placeholder = ch === 'trade' ? 'Looking for, or offering...' : ch === 'banner' ? 'Talk to your banner' : ch === 'party' ? 'Talk to your party' : 'Say something';
    if (ch === 'party') loadRooms(); else $('chatroom').hidden = true;
    chatNote(); paintChat(); pollChat();
  }
  function openChat(open) {
    chat.open = open; $('chat').hidden = !open; $('btn-chat').hidden = open; $('chatdot').hidden = true;
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
      const w = e.target.closest('[data-from]'); if (!w || w.dataset.from === chat.me) return;
      const from = w.dataset.from, id = w.dataset.id, name = w.dataset.name;
      modal('<h2>' + esc(name) + '</h2><p>Mute hides everything this player says, on this device. Report flags this message for review; messages with several reports are hidden for everyone.</p><div class="row"><button class="btn ghost" id="c-mute">Mute ' + esc(name) + '</button><button class="btn danger" id="c-rep">Report message</button><button class="btn ghost" id="c-x">Cancel</button></div>', md => {
        md.querySelector('#c-mute').onclick = () => { chat.muted.add(from); try { localStorage.setItem('lanternhold.muted', JSON.stringify([...chat.muted])); } catch (e) {} closeModal(); paintChat(); toast('lock', 'Muted', 'You won’t see messages from ' + name + '.', ''); };
        md.querySelector('#c-rep').onclick = async () => { closeModal(); try { await chatCall('POST', '/report', { ch: chat.ch, leader: chat.leader || undefined, id }); } catch (e) {} toast('lock', 'Reported', 'Thanks. We’ll keep an eye on it.', ''); };
        md.querySelector('#c-x').onclick = closeModal;
      });
    });
    $('chatform').addEventListener('submit', async e => {
      e.preventDefault();
      const inp = $('chatin'); let text = inp.value.trim(); if (!text || !S.hero) return;
      for (const l of chat.links) text = text.replace(l.label, l.token);
      text = text.replace(/\[\[(?!i:)/g, '[');
      inp.disabled = true;
      try {
        await chatCall('POST', '/chat', { ch: chat.ch, leader: chat.leader || undefined, text, name: S.hero.name, cls: S.hero.cls });
        inp.value = ''; chat.links = []; chatNote(); pollChat();
      } catch (err) {
        chatNote({ slow: 'Easy there. One message every few seconds.', links: 'Links aren’t allowed in chat.', name: 'Your hero’s name can’t be used in chat. Start a new hero with a different name.', room: 'You can’t post in that party.' }[err.code] || 'Message not sent. Try again in a moment.', true);
      }
      inp.disabled = false; inp.focus();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && chat.open) pollChat(); });
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
      '<div class="dos-go"><button class="btn small" data-go="' + to + '">Travel to floor ' + to + '</button>' + (to > x.first ? '<button class="btn small ghost" data-go="' + x.first + '">Region entrance</button>' : '') + '</div></div>';
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
      '<text x="108" y="38" class="wt">The Hold</text><text x="108" y="54" class="ws">Iron Covenant fortress above the tear</text>';
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
      const col = (L.SIDES[q.side] || L.SIDES.unsworn).color; s += '<g><title>' + esc(q.name + ', level ' + q.level + ', deepest floor ' + q.floor) + '</title><circle cx="' + (p.x - 9 - (st - 1) * 8) + '" cy="' + (p.y - 13) + '" r="4" fill="' + col + '" stroke="#04070d" stroke-width="1.3"/></g>';
    }
    if (cur >= x.first && cur <= x.last) { const p = pts[cur - x.first]; s += '<g class="youhere"><path d="M' + p.x + ' ' + (p.y - 13) + 'l-6 -11h12z" fill="#f5c242" stroke="#1a120b"/><text x="' + p.x + '" y="' + (p.y - 28) + '" class="mh">' + esc(me || 'You') + '</text></g>'; }
    return s + '</svg>';
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
        const travel = f => { closeMap(); if (f !== S.floor) { L.gotoFloor(S, f); S.autoAdvance = f >= S.maxFloor; updateStage(); toast('map', 'Travelled to floor ' + f, L.biomeOf(f).name + (f < S.maxFloor ? '. Descend automatically is off so you stay here. Turn it back on to push deeper.' : '.'), ''); } };
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
    for (const f of ['./', 'ui.js', 'core.js', 'sprites.js', 'vector.js', 'style.css']) if (!(await hasMark(f, b))) return false;
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
        'Each floor has <b>8 monsters</b>. Clear them to go deeper.',
        'Monsters drop <b>gold</b>. Spend it to <b>train</b> your party in the Party tab.',
        'Every <b>25 levels</b> a companion gets a big power jump.']],
      ['While you are away', 'i:refresh', 'The game keeps earning when you close it.', [
        'You earn <b>a quarter</b> of your usual gold for up to <b>8 hours</b>.',
        '<b>Night Watch</b> (Skills tab) stretches that up to 3 days.',
        'The <b>Lantern Pass</b> adds 4 more hours.']],
      ['The side panel', 'i:map', 'Seven tabs, each with one job.', [
        '<b>Party</b>: who fights, and in what order.',
        '<b>Camp</b>: resting companions, camp jobs and training.',
        '<b>Gear</b>: dress your characters.',
        '<b>Skills</b>: your character sheet, skill tree and rekindling.',
        '<b>Market</b>: buy and sell gear, mail and the Sigil exchange.',
        '<b>Guild</b>: invite other players’ heroes into your party.',
        '<b>Codex</b>: journal, relics and records.']],
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
      ['Guardians', 's:golem,wyrm,lich', 'Every 5th floor has a guardian. Beat it before the lantern oil runs out.', [
        'Guardians drop better gear and, from floor 10, sometimes a relic.',
        '<b>Lantern Oil</b> from the Store buys 15 more seconds.',
        'Act One ends with the Lampmother on floor <b>150</b>. Act Two opens with Grand War Season 2.']],
      ['Monster tricks', 's:eye,thorn', 'Deeper foes have tricks, shown as tags under their name.', [
        '<b>Enraged</b>: hits harder when hurt. <b>Warded</b>: a shield soaks damage first.',
        '<b>Regenerating</b>: heals over time. <b>Venomous</b>: poisons its target.',
        '<b>Cleaving</b>: also hits whoever stands behind. <b>Swift</b>: attacks faster.']],
      ['Ambushes', 's:hound,bat,riftling', 'Sometimes 2 to 4 monsters team up and jump the party.', [
        'Shown as <b>Ambush ×2</b> to <b>×4</b>. More health, harder hits, rear first.',
        'Pays several times the gold, better gear odds and extra XP. Luck makes it bigger.']],
      ['Loot Goblin', 's:goblin', 'A rare thief that turns up from floor 8. Kill it within 20 seconds.', [
        'It fights back. Strike fast and fire your abilities: idle damage alone barely gets there.',
        'If it escapes it steals one item from your pack and hides a few floors deeper. <b>Gear you wear is never taken.</b>',
        'A green note under the chapter goal shows where it hides. Reach that floor and kill it to get the item back.',
        'Every goblin you kill drops six times the gold.']],
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
        'You can still equip and upgrade a locked item. Unlock it to sell, send or salvage it.']],
      ['Mass scrap and Mass sell', 'i:coin', 'Clear out your pack in one go from the Gear tab.', [
        '<b>Mass scrap</b> turns the rarities you tick into gold right away.',
        '<b>Mass sell</b> lists them on the market at their current value, up to 25 listings at a time. You get mail with the gold as each one sells.',
        'Worn and locked items are never touched by either.']],
      ['Gear basics', 's:chest', 'Gear drops from monsters, chests and guardians. Each piece fits one class and slot.', [
        'Slots: main hand, offhand, helmet, trinket, chest, legs, feet, ring. Robes cover chest and legs.',
        'Change gear at <b>camp</b>. <b>Equip best</b> does it in one tap.',
        'A <b>green arrow</b> marks an upgrade. The corner number is the level needed.',
        'Upgrade with gold, or salvage what you do not need.']],
      ['Rarity and sets', 'i:crown', 'Rare and epic gear is a real find, and gets likelier deeper down.', [
        'From floor 15, guardians can drop <b>set pieces</b>. Two or three of a set add bonuses.',
        'A <b>Forager</b> at camp improves all drops.']],
      ['Job gear', 'i:hammer', 'Some pieces boost a camp job (orange dot).', [
        'Fine 2%, rare 6%, epic 15% chance to roll one.',
        'Each job has a 3-piece job set from floor 20: <b>2 pieces +40%</b>, <b>3 pieces +100%</b>.']],
      ['Your pack', 'i:bag', 'The pack holds 40 items to start.', [
        'Kindling adds <b>+10 slots</b> up to six times. The Lantern Pass adds 10.',
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
      ['Camp jobs', 'i:hammer', 'Resting companions can take a job that helps the whole party.', [
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
      ['Rekindling', 'i:lantern', 'From floor 50, start again from floor 1 for permanent Embers.', [
        'Each <b>Ember</b> adds 4% damage and gold forever.',
        'Companions, gear, relics and your character stay; levels reset.',
        'Rekindle when progress slows down.']],
      ['Story, journal and map', 'i:book', 'The story unfolds as you descend.', [
        'Replay scenes in the <b>Journal</b>.',
        'The <b>Map of the Deep</b> shows every region and lets you travel to floors you have reached.']],
    ] },
    { id: 'sigils', name: 'Sigils and perks', icon: 'star', topics: [
      ['Earning Sigils', 'i:star', 'You can earn Sigils without spending money.', [
        '<b>Daily quests</b> (top bar): 1 Sigil each, 2 more for all three.',
        'Chests and guardians sometimes hold 1 to 3.',
        'Trade gold for Sigils with other players on the exchange.']],
      ['What Sigils buy', 'i:crown', 'Looks, convenience and speed-ups. Never combat power.', [
        '<b>Lantern Pass</b> (500, 30 days): Auto-train, +10 bag slots, +4 h away. Free 3-day trial.',
        '<b>Bag of Holding</b> (6,500, once): an endless pack.',
        '<b>Speed-up tonics</b> and Campfire Draughts. Profile frames, titles and colors.',
        'Buy packs with <b>Get Sigils</b> after signing in with your Born 2 Game store account. Packs are one-time purchases and never renew.',
        '<b>Lanternholder</b> ($4.99 a month, renews until you cancel): the Lantern Pass perks for as long as you are a member.']],
      ['Mercy’s Blessing', 'i:cross', 'Real donations to the Grand War’s Mercy Corps bless every player.', [
        '<b>+10% gold</b>, <b>+10% health</b>, <b>+20% healing</b> while it burns.',
        'Each $10, 5 food items or toy adds 2 hours, up to 7 days.']],
      ['Grand War aura', 'i:shield', 'Verified Grand War commanders carry a class aura.', [
        '2% to 10% by war rank. Honors add more.',
        'Set your commander name on your profile’s Grand War tab. Auras are earned, never bought.']],
    ] },
    { id: 'social', name: 'Playing together', icon: 'chat', topics: [
      ['Accounts', 'i:user', 'A free account saves your progress online, on any device.', [
        '<b>Continue with Born 2 Game</b> signs you in with your store account.']],
      ['Chat', 'i:chat', 'Global, Trade, Party and Banner channels.', [
        'Press <b>Chat</b> at the bottom right to open the window, and the dash to tuck it away again.',
        'Banner chat reaches only players under your banner.',
        'Ctrl+click an item to link it. Tap a name to mute or report. No links, and be kind.']],
      ['Trading Post', 'i:bag', 'Buy and sell gear for gold, or mail it to a player.', [
        '<b>Sell</b>: tap an item in Gear, choose <b>Sell on market</b>. Listings last a week.',
        '<b>Mail</b>: send to someone you recruited or chatted with, as a gift or for a price.',
        'Gold and gear have no real-money value.']],
      ['The Ember Ring (PvP)', 'i:sword', 'Duel other players\u2019 heroes for Laurels and rating.', [
        'Open the <b>PvP</b> tab and press <b>Duel</b>. Only your own hero fights; companions, tonics and Sigils never count.',
        '10 challenges, one back every 30 minutes. Wins give Laurels and rating; your hero also defends while you are away.',
        'Laurels buy the <b>Ringwarden kit</b>: PvP gear with <b>Edge</b> (more damage to heroes) and <b>Resolve</b> (less damage from heroes). It works only in the Ring.']],
      ['Your profile', 'i:user', 'The card other players see.', [
        'Tap your portrait, then <b>Customize profile</b>: frame, title, color, banner, emblems and a bio.']],
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
      '<div class="row"><button class="btn ghost" id="g-notes">What’s new</button><button class="btn ghost" id="g-tut">Replay the tutorial</button><button class="btn" id="g-ok">Close</button></div>', md => {
        md.className = 'sheet wide guidesheet';
        md.querySelectorAll('[data-gcat]').forEach(b => b.onclick = () => { openGuide(b.dataset.gcat); const gb = $('modalbody').querySelector('.gbody'); if (gb) gb.scrollTop = 0; });
        md.querySelector('#g-notes').onclick = openNotes;
        md.querySelector('#g-x').onclick = closeModal; md.querySelector('#g-ok').onclick = closeModal;
        md.querySelector('#g-tut').onclick = () => { S.tut = { i: 0, done: false }; coachCtx = null; closeModal(); switchTab('party'); save(); };
      });
  }
  $('btn-guide').addEventListener('click', () => openGuide());

  // ---------- patch notes ----------
  // Newest first. Bump `v` for each release; players see the notes once after updating.
  const PATCH_NOTES = [
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
      'The Map of the Deep is redrawn. Every region has its own painted scenery: lamp-lit cellars, glowing fungus, a lava river in the Cinder Forges, the drowned chapel window, the Bastion walls, lightning on the Stormglass Spire and the Rift itself.',
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
  const tradeItem = it => L.normItem({ cls: it.cls, slot: it.slot, rar: it.rar, set: it.set || undefined, jset: it.jset || undefined, aff: it.aff || undefined, ilvl: it.ilvl, up: it.up || 0 });
  const fromServer = it => Object.assign(tradeItem(it), { uid: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
  // Letters and listings from before the gold rescale are shown and paid in today's gold.
  const nowGold = (g, at) => at && at < L.ECON_AT ? Math.max(1, Math.round(L.regold(g, L.lvl(S, 'you')))) : g;
  const bagFull = () => L.packCount(S) >= L.bagCap(S);
  const tradeTile = it => it.sig ? '<div class="tile sigtile">' + sigil + '</div>' : (L.normItem(it), '<div class="tile r-' + it.rar + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + '</div>');
  const tradeName = it => it.sig ? it.sig.toLocaleString() + ' ' + TOKEN : esc(L.gearName(it)) + (it.up ? ' +' + it.up : '');
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
    if (trade.view === 'market') loadMarket(); else if (trade.view === 'sigils') loadSigils(); else loadMail();
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
            '<span class="mkmeta">' + rar.name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; lvl ' + L.reqLevel(it) + '</span>' +
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
      '<div class="ihero">' + tradeTile(it).replace('class="tile', 'class="tile big') + '<div class="ititle"><span class="irar">' + rar.name + ' ' + L.CLASSES[it.cls].name + ' ' + L.SLOT_NAME[it.slot] + '</span><h2>' + tradeName(it) + '</h2><small>Requires level <b class="' + (om && !L.canWear(S, owner, it) ? 'bad' : '') + '">' + L.reqLevel(it) + '</b> &middot; found on floor ' + it.ilvl + '</small></div></div>' +
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
      const all = bulkList(sellOpts).sort((a, b) => unit(b) - unit(a)), list = all.slice(0, free), gold = list.reduce((a, it) => a + unit(it), 0);
      const chk = (k, label, sub) => '<label class="chk"><input type="checkbox" data-opt="' + k + '"' + (sellOpts[k] ? ' checked' : '') + '><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
      modal('<h2>Mass sell</h2><p>List many pieces on the market at once, each at its current value. Other players can buy them for a week, and you get mail with the gold when each one sells. Worn and locked items are never listed.</p>' +
        '<div class="scrapgrid">' + L.RARITY.map(r => chk(r.id, '<span class="r-' + r.id + '" style="color:var(--rc)">' + r.name + '</span>', S.bag.filter(x => x.rar === r.id && !x.lk && !L.wearer(S, x.uid)).length + ' to sell')).join('') + '</div>' +
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
    const x = wbState(), st = wb.st, ph = L.wbPhase(x.total), pct = Math.floor(ph.into / ph.need * 100);
    const top = st && st.w.id === x.w.id ? st.top : [];
    const rank = x.me && x.me.score > 0 ? top.findIndex(t => t.score <= x.me.score) + 1 : 0;
    modal('<div class="maphead"><div><h2>' + esc(x.name) + '</h2><small>World boss · ' + (x.live ? 'ends in ' + wbDur(x.w.end - x.now) : 'next attack in ' + wbDur(x.next - x.now)) + '</small></div><button class="iconbtn" id="wb-x" aria-label="Close">&times;</button></div>' +
      '<div class="wbhero"><img src="' + SP.spriteURL('colossus', 3, 0) + '" alt=""><div>' +
      '<p>A giant of void crystal has torn through the Nyx Rift beneath the Hold. Every delver fights the same monster: each assault you make chips at one shared health bar.</p>' +
      '<div class="wbphase"><div class="wbph"><b>Phase ' + (ph.broken + 1) + '</b><span>' + pct + '%</span></div><div class="bar wbbar2"><i style="width:' + pct + '%"></i></div><small>' + ph.broken + (ph.broken === 1 ? ' phase' : ' phases') + ' broken so far · ' + (st ? st.n : 0) + (st && st.n === 1 ? ' delver has' : ' delvers have') + ' joined</small></div></div></div>' +
      '<ul class="passfx"><li><b>Assaults</b><span>Two minutes against the boss at the strength of your deepest floor. One every 15 minutes. Strike and use your abilities for more damage.</span></li>' +
      '<li><b>Rewards</b><span>After the weekend: 3 Sigils for taking part, 1 more for every phase the server breaks (up to 5), and 5 more for the top three. Plus a big purse of gold.</span></li>' +
      '<li><b>When</b><span>Every weekend, Friday to Sunday (all times UTC).' + (x.w.id === '2026-11-23' ? ' This first one is a preview and runs until Friday.' : '') + '</span></li></ul>' +
      (top.length ? '<h3 class="sub">Top delvers</h3><ol class="wbtop">' + top.map(t => '<li><span class="c-' + esc(t.cls) + '">' + esc(t.name) + '</span><b>' + Math.floor(t.score).toLocaleString('en-US') + '</b></li>').join('') + '</ol>' : '') +
      (x.me && x.me.score > 0 ? '<p class="passstate">Your damage this event: <b>' + Math.floor(x.me.score).toLocaleString('en-US') + '</b>' + (rank ? ', rank ' + rank : '') + '.</p>' : '') +
      '<div class="row">' + (x.claim ? '<button class="btn" id="wb-claim">Claim your reward</button>' : !CL || !signedIn() ? '<button class="btn" id="wb-in">Sign in to fight</button>' : x.live ? (x.ready > 0 ? '<button class="btn" disabled>Next assault in ' + wbDur(x.ready) + '</button>' : '<button class="btn" id="wb-go">Join the assault</button>') : '') + '<button class="btn ghost" id="wb-no">Close</button></div>', md => {
      md.querySelector('#wb-x').onclick = closeModal; md.querySelector('#wb-no').onclick = closeModal;
      const go = md.querySelector('#wb-go'); if (go) go.onclick = () => { closeModal(); joinAssault(); };
      const cl = md.querySelector('#wb-claim'); if (cl) cl.onclick = () => claimBoss(x.claim, cl);
      const si = md.querySelector('#wb-in'); if (si) si.onclick = () => { closeModal(); authForm('in'); };
    });
  }
  function joinAssault() {
    const x = wbState();
    if (!x.live || x.ready > 0 || !signedIn()) return openBoss();
    if (L.resting(S, Date.now())) { toast('flame', 'Your party is resting', 'Head back into the deep first, then join the assault.', 'warn'); return; }
    if (!L.startAssault(S, Date.now(), x.name)) return;
    sfx.boss(); toast('skull', 'Assault!', 'Two minutes against ' + x.name + '. Strike and use your abilities!', 'feat');
    updateStage && updateStage(); paintBoss();
  }
  async function sendAssault(score, fell) {
    if (!(score > 0)) { toast('skull', 'Assault over', fell ? 'Your party fell before landing a blow.' : 'No damage this time.', ''); return; }
    try {
      const r = await api('POST', { score }, '/boss/hit');
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
    wb.busy = false; loadBoss().then(paintBoss); updatePanel(true);
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
  // The server fights the duel (infra/lambda/duel.js); this part sends our build, shows challengers, plays the
  // duel back, sells Ringwarden kit ranks for Laurels and shows the Ring standings. No Sigils, no tonics.
  // Keep RING_KIT, ringGate, ringCost and the stat formula in step with infra/lambda/arena.js and duel.js.
  const RING_KIT = [
    { id: 'helm', name: 'Helm', slot: 'head', R: 5, E: 0, hp: .02, at: 0 },
    { id: 'hauberk', name: 'Hauberk', slot: 'chest', R: 7, E: 0, hp: .015, at: 0 },
    { id: 'signet', name: 'Signet', slot: 'ring', R: 0, E: 5, hp: 0, at: .015 },
    { id: 'greaves', name: 'Greaves', slot: 'legs', R: 3, E: 3, hp: .01, at: .01 },
    { id: 'arms', name: 'Arms', slot: 'main', R: 0, E: 7, hp: 0, at: .02 },
  ];
  const RING_ARMS = { tank: 'Warhammer', healer: 'Censer', rogue: 'Twin Fangs', mage: 'Focus Rod', necro: 'Grave Scythe' };
  const RING_MAX = 15, RING_EMAX = 10, RING_EINT = 30 * 6e4;
  const ringGate = r => r >= 10 ? 1600 : r >= 5 ? 1300 : 0, ringCost = r => 40 + 25 * r;
  const RING_TIER = r => r <= 0 ? ['Plain', 'common'] : r <= 5 ? ['Ironbound', 'rare'] : r <= 10 ? ['Emberforged', 'epic'] : ['Starwrought', 'set'];
  const RING_TITLES = [[1900, 'Riftbreaker'], [1700, 'Lanternsworn'], [1500, 'Gilded'], [1300, 'Emberborn'], [1100, 'Ironclad'], [0, 'Ashen']];
  const ringTitle = r => RING_TITLES.find(t => r >= t[0])[1];
  // A rough strength score for "even match" hints: damage per hit times health, Edge and Resolve included.
  const ringPower = s => s.at * (1 + s.E / (s.E + 300)) * s.hp / (1 - .5 * s.R / (s.R + 300));
  const rg = { st: null, at: 0, view: 'foes', busy: false, err: '', sent: 0 };
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
  async function loadRing(force) {
    if (!CL || !signedIn() || !S.hero || rg.busy) return;
    if (!force && rg.st && Date.now() - rg.at < 60000) return;
    rg.busy = true; rg.err = '';
    try {
      // The hero board row must exist first (it holds the name); publishing is quick and harmless.
      if (Date.now() - rg.sent > 5 * 6e4) { try { await api('PUT', { name: S.hero.name, cls: S.hero.cls, side: S.hero.side, level: L.lvl(S, 'you'), floor: S.maxFloorEver }, '/hero'); } catch (e) {} await api('PUT', ringBuild(), '/arena'); rg.sent = Date.now(); }
      const st = await api('GET', null, '/arena'); if (!st) throw 0; rg.st = st; rg.at = Date.now();
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
    if (w > 0 || l > 0) toast('shield', 'Your hero held the Ring', (w ? w + (w === 1 ? ' challenger beaten' : ' challengers beaten') : '') + (w && l ? ', ' : '') + (l ? l + ' lost' : '') + ' while you were away.' + (w ? ' +' + (w * 4) + ' Laurels.' : ''), w >= l ? 'feat' : '');
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
    let h = '<div class="ringhead"><div class="rhfig">' + ringFig(you.cls, you.hue, 3) + '</div><div class="rhinfo"><div class="rhtop"><h3>The Ember Ring</h3><span class="rtitle rt-' + ringTitle(me.r).toLowerCase() + '">' + ringTitle(me.r) + '</span></div>' +
      '<div class="rhrate"><b>' + me.r.toLocaleString('en-US') + '</b> rating' + (st.rank ? ' &middot; rank ' + st.rank + ' of ' + st.n : '') + (me.pk > me.r ? ' &middot; best ' + me.pk.toLocaleString('en-US') : '') + '</div>' +
      '<div class="rhchips"><span title="Wins and losses">' + icon('sword') + me.w + '&ndash;' + me.l + '</span>' + '<span title="Laurels, spent on the Ringwarden kit">' + laurel(me.ll) + '</span>' +
      '<span title="Challenges refill one every 30 minutes, up to 10" class="' + (en ? '' : 'out') + '">' + icon('flame') + en + '/' + RING_EMAX + (en < RING_EMAX ? ' <small>+1 in ' + fmtTime(Math.max(1, Math.ceil(nextIn / 1000))) + '</small>' : '') + '</span></div></div></div>' +
      '<div class="seg ringseg">' + [['foes', 'Challengers'], ['kit', 'Ringwarden kit'], ['top', 'Standings']].map(v => '<button data-rv="' + v[0] + '"' + (rg.view === v[0] ? ' class="on"' : '') + '>' + v[1] + '</button>').join('') + '</div>';
    if (rg.view === 'foes') {
      const ms = me.s, mp = ringPower(ms);
      h += '<p class="note small ringbuild"><b>Your hero in the Ring:</b> ' + ringStatLine(ms) + '. Deeper delving helps a little; the Ringwarden kit helps a lot.</p>';
      h += st.foes.length ? '<div class="ringfoes">' + st.foes.map(f => {
        const q = ringPower(f.s) / mp, odd = q > 1.35 ? ['tough', 'Tough fight'] : q < 0.75 ? ['easy', 'You are favored'] : ['even', 'Even match'];
        return '<div class="ringfoe"><div class="rffig">' + ringFig(f.c, 0, 2) + '</div><div class="rfinfo"><div class="nm">' + esc(f.n) + ' ' + classTag(f.c) + '</div><small><span class="rtitle sm rt-' + ringTitle(f.r).toLowerCase() + '">' + ringTitle(f.r) + '</span> ' + f.r.toLocaleString('en-US') + ' &middot; ' + f.w + '&ndash;' + f.l + ' &middot; <i class="odds ' + odd[0] + '">' + odd[1] + '</i></small><small class="dim">' + ringStatLine(f.s) + '</small></div>' +
          '<button class="btn small" data-duel="' + f.id + '"' + (en ? '' : ' disabled title="No challenges left. One returns every 30 minutes."') + '>Duel</button></div>';
      }).join('') + '</div>' : '<p class="note">No other heroes have entered the Ring yet. Check back soon, or tell a friend to bring their hero.</p>';
      h += '<div class="row"><button class="btn ghost small" id="ring-ref">' + icon('refresh') + ' New challengers</button></div>';
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
      h += st.top.length ? '<ol class="ringtop">' + st.top.map((t, i) => '<li class="' + (t.id === me.id ? 'me' : '') + '"><span class="rk">' + (i + 1) + '</span>' + ringFig(t.c, 0, 1) + '<span class="nm c-' + esc(t.c) + '">' + esc(t.n) + '</span><span class="rtitle sm rt-' + ringTitle(t.r).toLowerCase() + '">' + ringTitle(t.r) + '</span><b>' + t.r.toLocaleString('en-US') + '</b><small>' + t.w + '&ndash;' + t.l + '</small></li>').join('') + '</ol>' : '<p class="note">Nobody has fought yet. The first win puts you on top.</p>';
      h += '<p class="note small">Everyone starts at 1,000. Beating a higher-rated hero is worth more. Heroes that defend well while their owner is away climb too.</p>';
    }
    box.innerHTML = h;
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
    const side = (x, i, hue) => '<div class="rdside s' + i + '"><div class="rdname"><b>' + esc(x.n) + '</b>' + classTag(x.c) + '</div><div class="rdfig"><img src="' + SP.spriteURL(x.c, 5, hue || 0) + '" alt=""><div class="rdpop" id="rd-pop' + i + '"></div></div>' +
      '<div class="bar rdhp"><i id="rd-hp' + i + '" style="width:100%"></i><span id="rd-ht' + i + '">' + fmt(hp[i]) + '</span></div><small>' + ringTitle(x.r) + ' &middot; ' + x.r.toLocaleString('en-US') + '</small></div>';
    modal('<div class="maphead"><div><h2>The Ember Ring</h2><small>' + esc(A.n) + ' challenges ' + esc(B.n) + '</small></div><button class="iconbtn" id="rd-x" aria-label="Close">&times;</button></div>' +
      '<div class="ringduel">' + side(A, 0, you.hue) + '<div class="rdvs">VS</div>' + side(B, 1, 0) + '</div><div class="rdlog" id="rd-log"></div><div class="rdres" id="rd-res" hidden></div>' +
      '<div class="row"><button class="btn ghost" id="rd-skip">Skip to the end</button></div>', md => {
      $('modal').dataset.lock = '1';
      const cur = hp.slice(), lines = [];
      let i = 0, timer = 0, done = false;
      const nm = [A.n, B.n];
      const pop = (k, txt, cls) => { const p = md.querySelector('#rd-pop' + k); if (!p) return; const s = document.createElement('span'); s.className = cls; s.textContent = txt; p.appendChild(s); setTimeout(() => s.remove(), 900); };
      const paint = () => { for (const k of [0, 1]) { const w = Math.max(0, cur[k] / hp[k] * 100); md.querySelector('#rd-hp' + k).style.width = w + '%'; md.querySelector('#rd-ht' + k).textContent = fmt(Math.max(0, cur[k])); } md.querySelector('#rd-log').innerHTML = lines.slice(-3).map(l => '<p>' + l + '</p>').join(''); };
      const step = quiet => {
        const e = r.log[i++]; if (!e) return false;
        const [a, d, c, hl] = e, t = 1 - a;
        cur[t] -= d; cur[a] = Math.min(hp[a], cur[a] + hl);
        if (!quiet) {
          const fig = md.querySelector('.rdside.s' + a + ' .rdfig'), tf = md.querySelector('.rdside.s' + t + ' .rdfig');
          fig.classList.remove('lunge'); void fig.offsetWidth; fig.classList.add('lunge');
          if (c !== 2) { tf.classList.remove('struck'); void tf.offsetWidth; tf.classList.add('struck'); }
          pop(t, c === 2 ? 'Miss' : '-' + fmt(d), c === 2 ? 'miss' : c ? 'crit' : 'dmg'); if (hl) pop(a, '+' + fmt(hl), 'heal');
          c === 2 ? sfx.thud() : sfx.hit(c === 1);
          lines.push('<b>' + esc(nm[a]) + '</b> ' + (c === 2 ? 'misses.' : (c ? 'lands a <em>critical</em> blow for ' : 'hits for ') + fmt(d) + (hl ? ' and recovers ' + fmt(hl) : '') + '.'));
        }
        return true;
      };
      const finish = () => {
        if (done) return; done = true; clearInterval(timer);
        while (step(true)); paint();
        md.querySelector('.rdside.s' + (r.win ? 1 : 0)).classList.add('fallen');
        const res = md.querySelector('#rd-res'); res.hidden = false; res.className = 'rdres ' + (r.win ? 'won' : 'lost');
        res.innerHTML = '<h3>' + (r.win ? 'Victory' : 'Defeat') + '</h3><p>' + (r.dr >= 0 ? '+' : '') + r.dr + ' rating &middot; +' + r.ll + ' Laurels' + (r.fw ? ' (first win of the day bonus)' : '') + '</p>';
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
    const v = e.target.closest('[data-rv]'); if (v) { rg.view = v.dataset.rv; paintRing(); if (v.dataset.rv !== 'kit') loadRing(); return; }
    const d = e.target.closest('[data-duel]'); if (d) { ringDuel(d.dataset.duel, d); return; }
    const k = e.target.closest('[data-kit]'); if (k) { ringKit(+k.dataset.kit, k); return; }
    if (e.target.closest('#ring-ref')) { rg.sent = 0; loadRing(true); }
  });
  document.querySelectorAll('.tabs [data-tab="ring"]').forEach(b => b.addEventListener('click', () => { paintRing(); loadRing(); }));
  // Keep the challenge timer fresh while the tab is open.
  setInterval(() => { if (typeof tab !== 'undefined' && tab === 'ring' && !document.hidden && !$('modal').dataset.lock) { const a = document.activeElement; if (!a || !$('ringbox') || !$('ringbox').contains(a)) paintRing(); } }, 30000);
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
  window.LHDebug = { get S() { return S; }, save, L, events };
})();
