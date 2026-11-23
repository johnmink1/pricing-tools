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
  const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 1000) return n < 10 && n % 1 > 0.05 ? n.toFixed(1) : Math.floor(n).toLocaleString('en-US');
    const e = Math.floor(Math.log10(n) / 3);
    if (S.settings.notation === 'short' && e < SUF.length) {
      const v = n / Math.pow(1000, e);
      return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v)) + SUF[e];
    }
    return n.toExponential(2).replace('e+', 'e');
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
  const particles = [];
  const slashes = [];
  let foeAnim = { key: null, born: 0, flash: 0, shake: 0, dying: null };

  function resize() {
    const r = arena.getBoundingClientRect();
    W = 240; H = Math.round(240 * r.height / Math.max(1, r.width));
    cv.width = W; cv.height = H; bgKey = '';
  }

  function rngFrom(seed) { let x = seed * 9301 + 49297; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }

  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',') + ')'; }

  function buildBackground(b, seed) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), r = rngFrom(seed);
    const floorY = Math.round(H * 0.7);
    const wallA = b.bg[0], wallB = b.bg[1];
    // wall bricks
    x.fillStyle = wallB; x.fillRect(0, 0, W, H);
    for (let row = 0; row * 8 < floorY; row++) {
      const off = row % 2 ? 8 : 0;
      for (let col = -1; col * 16 < W; col++) {
        const bx = col * 16 + off, by = row * 8;
        const t = 0.25 + r() * 0.35 - (row * 8 / floorY) * 0.1;
        x.fillStyle = mix(wallB, wallA, t + 0.35);
        x.fillRect(bx + 1, by + 1, 15, 7);
        x.fillStyle = mix(wallB, wallA, t + 0.6);
        x.fillRect(bx + 1, by + 1, 15, 1);
        if (r() < 0.12) { x.fillStyle = mix(wallB, '#000000', 0.3); x.fillRect(bx + 3 + Math.floor(r() * 9), by + 3, 2, 1); }
      }
    }
    // biome dressing on the wall
    for (let i = 0; i < 60; i++) {
      x.fillStyle = mix(b.accent, wallB, 0.45 + r() * 0.4);
      const px = Math.floor(r() * W), py = Math.floor(r() * floorY);
      x.fillRect(px, py, 1 + Math.floor(r() * 2), 1);
    }
    // doorway arch
    const ax = Math.round(W * FOE_X), aw = 54, ah = Math.round(floorY * 0.78);
    x.fillStyle = '#050403';
    x.beginPath(); x.moveTo(ax - aw / 2, floorY); x.lineTo(ax - aw / 2, floorY - ah + aw / 2);
    x.arc(ax, floorY - ah + aw / 2, aw / 2, Math.PI, 0); x.lineTo(ax + aw / 2, floorY); x.fill();
    x.strokeStyle = mix(wallA, '#ffffff', 0.08); x.lineWidth = 3;
    x.beginPath(); x.moveTo(ax - aw / 2 - 1.5, floorY); x.lineTo(ax - aw / 2 - 1.5, floorY - ah + aw / 2);
    x.arc(ax, floorY - ah + aw / 2, aw / 2 + 1.5, Math.PI, 0); x.lineTo(ax + aw / 2 + 1.5, floorY); x.stroke();
    // stairs fading into the dark
    for (let i = 0; i < 5; i++) {
      x.fillStyle = mix('#050403', wallA, 0.12 + i * 0.07);
      const sw = aw - 10 - i * 6; x.fillRect(ax - sw / 2, floorY - 6 - i * 6, sw, 2);
    }
    // floor
    for (let row = 0; floorY + row * 6 < H; row++) {
      const y = floorY + row * 6, w = 20 + row * 6, off = (row % 2) * w / 2;
      for (let col = -1; col * w < W + w; col++) {
        const t = 0.35 + r() * 0.25 + row * 0.03;
        x.fillStyle = mix(wallB, wallA, t);
        x.fillRect(col * w + off + 1, y + 1, w - 1, 5);
      }
    }
    x.fillStyle = mix(wallB, '#000000', 0.4); x.fillRect(0, floorY, W, 1);
    // sconces
    [W * 0.17, W * 0.83].forEach(tx => {
      tx = Math.round(tx); const ty = Math.round(floorY * 0.42);
      x.fillStyle = '#2a1d12'; x.fillRect(tx - 1, ty, 3, 10); x.fillStyle = '#5a3d22'; x.fillRect(tx - 3, ty, 7, 2); x.fillRect(tx - 2, ty - 2, 5, 2);
    });
    // vignette
    const g = x.createRadialGradient(W / 2, H * 0.55, H * 0.25, W / 2, H * 0.55, W * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.78)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    return c;
  }

  function sprite(name, hue, flash) {
    const k = name + '|' + hue + '|' + (flash ? 1 : 0);
    if (!spriteCache[k]) {
      let c = SP.render(name, 1, hue);
      if (flash) { const f = document.createElement('canvas'); f.width = c.width; f.height = c.height; const fx = f.getContext('2d'); fx.drawImage(c, 0, 0); fx.globalCompositeOperation = 'source-in'; fx.fillStyle = '#fff6e0'; fx.fillRect(0, 0, f.width, f.height); c = f; }
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
      const w2 = spr.width * 2, h2 = spr.height * 2, cx = bx + dx + w2 / 2, cy = by + dy + h2;
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
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(Math.round(o.x - k * 90) + spr.width * 2, Math.round(o.y + Math.abs(Math.sin(k * 18)) * -2)); ctx.scale(-1, 1);
      ctx.drawImage(spr, 0, 0, spr.width * 2, spr.height * 2); ctx.restore();
    }
    for (const p of lay) {
      const m = L.memberById(p.id), a = mAnim(p.id), down = !!S.down[p.id];
      const flash = tAnim < a.hit;
      const spr = sprite(m.cls, m.hue || 0, flash);
      const lunge = tAnim < a.lunge ? 3 : 0;
      const bob = down ? 0 : Math.round(Math.sin(tAnim * 3 + p.x) * 0.6);
      const x = p.x + lunge, y = p.y + bob + (down ? 6 : 0);
      a.x = x + 12; a.y = y + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(p.x + 12, p.y + 32, 9, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = down ? 0.35 : 1;
      ctx.drawImage(spr, x, y, spr.width * 2, spr.height * 2);
      ctx.globalAlpha = 1;
      // shield wall
      if (m.cls === 'tank' && L.abilityActive(S, p.id, now)) { ctx.strokeStyle = 'rgba(159,214,236,' + (0.5 + 0.3 * Math.sin(tAnim * 8)) + ')'; ctx.strokeRect(x - 2, y - 2, 28, 36); }
      // health bar
      const hp = Math.max(0, S.hp[p.id] || 0) / L.maxHpOf(S, p.id);
      ctx.fillStyle = '#120d0a'; ctx.fillRect(p.x + 2, p.y + 35, 20, 3);
      ctx.fillStyle = down ? '#555' : hp > 0.5 ? '#8fcf6a' : hp > 0.25 ? '#e9c34a' : '#e8604a';
      ctx.fillRect(p.x + 3, p.y + 36, Math.round(18 * hp), 1);
      if (p.id === 'you') { ctx.fillStyle = '#f2c14e'; ctx.fillRect(p.x + 11, p.y - 5, 3, 1); ctx.fillRect(p.x + 12, p.y - 4, 1, 1); }
    }
    return lay;
  }

  // ---------- camp: the party rests around a campfire at the top of the stair ----------
  let campBg = null, campKey = '';
  function buildCamp() {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), r = rngFrom(7), floorY = Math.round(H * 0.7);
    const sky = x.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, '#070912'); sky.addColorStop(0.7, '#141526'); sky.addColorStop(1, '#231a22');
    x.fillStyle = sky; x.fillRect(0, 0, W, floorY);
    for (let i = 0; i < 90; i++) { x.fillStyle = 'rgba(230,225,255,' + (0.25 + r() * 0.6) + ')'; x.fillRect(Math.floor(r() * W), Math.floor(r() * floorY * 0.7), 1, 1); }
    // moon
    x.fillStyle = '#e9e3cf'; x.beginPath(); x.arc(Math.round(W * 0.82), Math.round(H * 0.16), 9, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#141526'; x.beginPath(); x.arc(Math.round(W * 0.82) + 4, Math.round(H * 0.16) - 2, 8, 0, Math.PI * 2); x.fill();
    // far hills and the ruined Hold
    x.fillStyle = '#16131c';
    for (let i = 0; i <= W; i += 2) { const h = 14 + Math.sin(i * 0.02) * 8 + Math.sin(i * 0.051) * 5; x.fillRect(i, floorY - h - 18, 2, h + 18); }
    x.fillStyle = '#0f0d13';
    const hx = Math.round(W * 0.14); x.fillRect(hx, floorY - 62, 22, 62); x.fillRect(hx - 3, floorY - 66, 28, 5);
    for (let i = 0; i < 4; i++) x.fillRect(hx - 3 + i * 8, floorY - 70, 4, 4);
    x.fillRect(hx + 22, floorY - 38, 40, 38); x.fillStyle = '#2a1d14'; x.fillRect(hx + 8, floorY - 50, 5, 7);
    // pines
    x.fillStyle = '#0c0f10';
    for (let i = 0; i < 9; i++) { const px = Math.round(W * (0.3 + i * 0.085) + r() * 14), ph = 26 + Math.floor(r() * 18);
      for (let j = 0; j < ph; j++) { const w = Math.max(1, Math.round((j / ph) * 9)); x.fillRect(px - w, floorY - 14 - ph + j, w * 2, 1); } x.fillRect(px - 1, floorY - 14, 2, 4); }
    // ground
    const g = x.createLinearGradient(0, floorY - 12, 0, H);
    g.addColorStop(0, '#1d1a14'); g.addColorStop(1, '#0d0b08');
    x.fillStyle = g; x.fillRect(0, floorY - 12, W, H - floorY + 12);
    for (let i = 0; i < 160; i++) { x.fillStyle = r() < 0.5 ? '#2a2a1a' : '#151309'; x.fillRect(Math.floor(r() * W), floorY - 10 + Math.floor(r() * (H - floorY + 10)), 1 + Math.floor(r() * 2), 1); }
    for (let i = 0; i < 40; i++) { const gx = Math.floor(r() * W), gy = floorY - 10 + Math.floor(r() * 8); x.fillStyle = '#26301a'; x.fillRect(gx, gy, 1, 2); x.fillRect(gx + 2, gy + 1, 1, 1); }
    // the stair back down, a dark mouth in the rock
    const sx = Math.round(W * 0.9); x.fillStyle = '#1a1612'; x.fillRect(sx - 18, floorY - 26, 36, 30); x.fillStyle = '#050403'; x.fillRect(sx - 12, floorY - 20, 24, 24);
    x.fillStyle = '#2a241c'; for (let i = 0; i < 4; i++) x.fillRect(sx - 10 + i, floorY - 2 - i * 4, 20 - i * 2, 2);
    return c;
  }
  // seats around the fire: dx, dy from the fire, and whether the sitter faces left
  const CAMP_SEATS = [[-46, 4, 0], [46, 4, 1], [-30, -12, 0], [30, -12, 1], [-62, -6, 0], [62, -6, 1], [-12, -20, 0], [14, -20, 1]];
  function drawCamp(now) {
    if (campKey !== W + 'x' + H) { campBg = buildCamp(); campKey = W + 'x' + H; }
    ctx.imageSmoothingEnabled = false; ctx.drawImage(campBg, 0, 0);
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
      const spr = sprite(m.cls, m.hue || 0, false), w2 = spr.width * 2, h2 = spr.height * 2;
      const breathe = Math.round(Math.sin(tAnim * 1.6 + p.x) * 0.5);
      const bx = p.x - w2 / 2, by = p.y - h2 + 6 + breathe;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 5, 11, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      // sitting: the lower legs are hidden behind a log seat
      ctx.save(); ctx.beginPath(); ctx.rect(bx - 2, by - 2, w2 + 4, h2 - 6); ctx.clip();
      if (p.flip) { ctx.translate(bx + w2, by); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0, w2, h2); } else ctx.drawImage(spr, bx, by, w2, h2);
      ctx.restore();
      ctx.fillStyle = '#3b2616'; ctx.fillRect(p.x - 11, p.y - 2, 22, 5); ctx.fillStyle = '#5a3a20'; ctx.fillRect(p.x - 11, p.y - 2, 22, 1); ctx.fillStyle = '#2a1a0e'; ctx.fillRect(p.x - 11, p.y + 2, 22, 1);
      // firelight on the side facing the fire
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,140,60,' + (0.07 + fl * 0.015) + ')'; ctx.fillRect(p.flip ? bx : bx + w2 / 2, by, w2 / 2, h2 - 6); ctx.globalCompositeOperation = 'source-over';
      if (p.id === 'you') { ctx.fillStyle = '#f2c14e'; ctx.fillRect(p.x - 1, by - 5, 3, 1); ctx.fillRect(p.x, by - 4, 1, 1); }
    };
    seats.filter(p => p.y < fy).sort((a, b) => a.y - b.y).forEach(sitter);
    // the fire: stones, crossed logs, flames and sparks
    ctx.fillStyle = '#4a4440'; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx.fillRect(Math.round(fx + Math.cos(a) * 13) - 2, Math.round(fy + Math.sin(a) * 4) - 1, 4, 3); }
    ctx.fillStyle = '#4b2e18'; ctx.fillRect(fx - 11, fy - 3, 22, 3); ctx.fillStyle = '#6a4224'; ctx.fillRect(fx - 9, fy - 5, 6, 3); ctx.fillRect(fx + 3, fy - 5, 6, 3);
    for (let i = 0; i < 7; i++) {
      const ph = tAnim * (2.2 + i * 0.31) + i * 1.7, h = 9 + Math.sin(ph) * 3 + (i % 3) * 3, ox = (i - 3) * 2 + Math.round(Math.sin(ph * 1.3) * 1);
      ctx.fillStyle = i % 2 ? '#ff6a1f' : '#ff8f2a'; ctx.fillRect(fx + ox - 1, fy - 4 - h, 3, h);
    }
    for (let i = 0; i < 4; i++) { const ph = tAnim * (3 + i * 0.4) + i, h = 5 + Math.sin(ph) * 2; ctx.fillStyle = '#ffd25a'; ctx.fillRect(fx - 3 + i * 2, fy - 4 - h, 1 + (i % 2), h); }
    ctx.fillStyle = '#fff2b0'; ctx.fillRect(fx - 1, fy - 7, 2, 3);
    if (Math.random() < 0.35) particles.push({ x: fx + (Math.random() - 0.5) * 8, y: fy - 12, vx: (Math.random() - 0.5) * 8, vy: -22 - Math.random() * 18, life: 1 + Math.random(), age: 0, c: Math.random() < 0.5 ? '#ffb04a' : '#ff7a2a', s: 1, float: true });
    seats.filter(p => p.y >= fy).forEach(sitter);
    const dt = 1 / 60;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt; if (p.age > p.life) { particles.splice(i, 1); continue; }
      p.x += (p.vx + Math.sin(tAnim * 3 + i) * 4) * dt; p.y += p.vy * dt;
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 1.5); ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;
    // fireflies
    for (let i = 0; i < 8; i++) {
      const px = (i * 97 + Math.sin(tAnim * 0.4 + i) * 30 + W) % W, py = floorY - 30 + Math.sin(tAnim * 0.7 + i * 2) * 18;
      ctx.fillStyle = 'rgba(200,255,140,' + (0.25 + 0.25 * Math.sin(tAnim * 2 + i)) + ')'; ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
  }

  function render(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; tAnim += dt;
    const nowMs = Date.now();
    document.body.classList.toggle('resting', L.resting(S, nowMs));
    if (L.resting(S, nowMs)) { drawCamp(nowMs); requestAnimationFrame(render); return; }
    const b = L.biomeOf(S.floor);
    const key = b.name + W + 'x' + H;
    if (key !== bgKey) { bgCanvas = buildBackground(b, Math.floor((S.floor - 1) / 10) + 3); bgKey = key; }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bgCanvas, 0, 0);
    const floorY = Math.round(H * 0.7);

    [W * 0.17, W * 0.83].forEach((tx, i) => {
      tx = Math.round(tx); const ty = Math.round(floorY * 0.42) - 3;
      const fl = Math.sin(tAnim * 13 + i * 2) + Math.sin(tAnim * 7.3 + i);
      const gr = ctx.createRadialGradient(tx, ty, 1, tx, ty, 34 + fl * 2);
      gr.addColorStop(0, 'rgba(255,170,70,0.32)'); gr.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(tx - 40, ty - 40, 80, 80); ctx.globalCompositeOperation = 'source-over';
      const h = 5 + (fl > 0.6 ? 1 : 0);
      ctx.fillStyle = '#ff7a2a'; ctx.fillRect(tx - 1, ty - h + 2, 3, h);
      ctx.fillStyle = '#ffc04a'; ctx.fillRect(tx, ty - h + 3, 1, h - 2);
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
      const sw = spr.width * 3, sh = spr.height * 3;
      const age = tAnim - foeAnim.born;
      const drop = age < 0.25 ? (1 - age / 0.25) * -12 : 0;
      const flier = foe.sprite === 'bat' || foe.sprite === 'ghost';
      const bob = Math.round(Math.sin(tAnim * 2.4) * (flier ? 2 : 0.6));
      const shake = tAnim < foeAnim.shake ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const lungeF = tAnim < foeAnim.lunge ? -4 : 0;
      const fx = Math.round(fxC - sw / 2 + shake + lungeF), fy = Math.round(floorY + 4 - sh + bob + drop) - (flier ? 10 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(fxC, floorY + 4, sw * 0.42, 3, 0, 0, Math.PI * 2); ctx.fill();
      if (foe.boss) {
        const gg = ctx.createRadialGradient(fxC, fy + sh / 2, 4, fxC, fy + sh / 2, sw);
        gg.addColorStop(0, 'rgba(255,80,40,0.18)'); gg.addColorStop(1, 'rgba(255,80,40,0)');
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
      ctx.fillStyle = o.c; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
      ctx.fillStyle = '#fff6e0'; ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    for (let i = slashes.length - 1; i >= 0; i--) {
      const s = slashes[i], k = (tAnim - s.t) / 0.18;
      if (k >= 1) { slashes.splice(i, 1); continue; }
      const len = 10 + k * 6, dx = Math.cos(s.a) * len, dy = Math.sin(s.a) * len;
      ctx.strokeStyle = s.c; ctx.globalAlpha = 1 - k; ctx.lineWidth = s.big ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(Math.round(s.x - dx), Math.round(s.y - dy)); ctx.lineTo(Math.round(s.x + dx), Math.round(s.y + dy)); ctx.stroke();
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
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < 14; i++) {
      const px = (i * 53 + tAnim * (4 + i % 3)) % W, py = (i * 37 + Math.sin(tAnim * 0.5 + i) * 6 + 20) % (floorY);
      ctx.fillStyle = 'rgba(255,220,160,' + (0.12 + 0.1 * Math.sin(tAnim + i)) + ')'; ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
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
  let pendingGold = 0, lastGoldFloat = 0;
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
      } else if (e.type === 'revive') {
        const a = mAnim(e.id); floatText('Back up', 'heal', a.x / W, (a.y - 10) / H);
      } else if (e.type === 'ability') {
        const a = mAnim(e.id), ab = L.CLASSES[e.cls].ability;
        floatText(ab.name, 'skill', a.x / W, (a.y - 14) / H);
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
      } else if (e.type === 'lore') {
        const lo = L.LORE.find(x => x.id === e.id); toast('book', 'New journal entry', lo.title, 'feat');
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
  const camp = () => L.atCamp(S, Date.now());
  function campGate() { if (camp()) return true; campModal(); return false; }
  function goCamp() {
    S.campReturn = Math.max(S.campReturn || 0, S.floor);
    L.gotoFloor(S, L.CAMP_FLOOR); S.autoAdvance = false; $('auto').checked = false;
    closeModal(); save(); updateStage(); updatePanel(true); sfx.buy();
    toast('flame', 'Back at camp', 'Change your party, train and gear up. Then press Descend to head back down.', 'feat');
  }
  function descend() {
    const f = Math.min(S.maxFloor, Math.max(2, S.campReturn || S.maxFloor));
    L.gotoFloor(S, f); S.autoAdvance = f >= S.maxFloor; $('auto').checked = S.autoAdvance; S.campReturn = 0;
    save(); updateStage(); updatePanel(true);
    toast('map', 'Down to floor ' + f, L.biomeOf(f).name + '.', '');
  }
  function drinkDraught() {
    if (!L.useDraught(S, Date.now())) { openStore(); return; }
    closeModal(); sfx.relic(); save(); updatePanel(true);
    toast('flame', 'You make camp', 'For 60 seconds the party rests and heals, and you can swap companions, recruit, train and change gear right here.', 'feat');
  }
  function campModal() {
    const n = (S.items && S.items.draught) || 0;
    modal('<div class="center"><div class="campfire-ic">' + icon('flame') + '</div><h2>That happens at camp</h2><p>Swapping companions, recruiting players, training companions and changing gear all happen at camp, at the top of the stair.</p></div>' +
      '<div class="choice"><button class="pick" id="c-go"><b>Return to camp</b><small>Travel up to floor 1. You can head straight back down to floor ' + S.floor + ' afterwards.</small></button>' +
      '<button class="pick" id="c-drink"' + (n ? '' : ' disabled') + '><b>Drink a Campfire Draught (' + n + ' left)</b><small>Make camp right here for 60 seconds.</small></button>' +
      '<button class="pick" id="c-store"><b>Visit the store</b><small>Buy Campfire Draughts and Lantern Oil.</small></button></div>' +
      '<div class="row"><button class="btn ghost" id="c-x">Not now</button></div>', md => {
        md.querySelector('#c-go').onclick = goCamp; md.querySelector('#c-drink').onclick = drinkDraught;
        md.querySelector('#c-store').onclick = openStore; md.querySelector('#c-x').onclick = closeModal;
      });
  }
  function campBarHtml() {
    const n = (S.items && S.items.draught) || 0, left = L.campLeft(S, Date.now());
    if (S.floor <= L.CAMP_FLOOR) return '<div class="campbar on"><span class="cb-ic">' + icon('flame') + '</span><div><b>At camp</b><small>Swap companions, recruit, train and change gear.</small></div>' + (S.maxFloor > 1 ? '<button class="btn small" data-camp="down">Descend to floor ' + Math.min(S.maxFloor, Math.max(2, S.campReturn || S.maxFloor)) + '</button>' : '') + '<button class="btn ghost small" data-camp="store">Store</button></div>';
    if (left > 0) return '<div class="campbar on"><span class="cb-ic">' + icon('flame') + '</span><div><b>Camp made: ' + Math.ceil(left) + 's</b><small>A Campfire Draught is burning. Make your changes now.</small></div><button class="btn ghost small" data-camp="store">Store</button></div>';
    return '<div class="campbar"><span class="cb-ic">' + icon('lock') + '</span><div><b>In the Deep</b><small>Party changes, companion training and gear happen at camp.</small></div><button class="btn small" data-camp="go">Return to camp</button><button class="btn ghost small" data-camp="drink"' + (n ? '' : ' disabled') + '>Draught (' + n + ')</button><button class="btn ghost small" data-camp="store">Store</button></div>';
  }
  let campWas = null;
  function paintCamp() {
    const h = campBarHtml();
    for (const id of ['campbar', 'campbar2', 'gearcamp']) { const el = $(id); if (el && el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; } }
    const c = camp(); if (campWas !== null && c !== campWas) { campWas = c; updateSeats(true); paintBoard(); updateGear(true); } campWas = c;
    document.body.classList.toggle('incamp', c);
    const rc = $('restcard');
    if (rc) {
      const left = L.campLeft(S, Date.now());
      const r = left > 0 && S.floor > L.CAMP_FLOOR ? '<div><b>Resting by the fire, ' + Math.ceil(left) + 's</b><small>The party heals up. The fight waits until the draught burns out.</small></div>'
        : '<div><b>Resting at camp</b><small>The party heals by the fire. Nobody fights while you rest.</small></div>' + (S.maxFloor > 1 ? '<button class="btn small" data-camp="down">Descend to floor ' + Math.min(S.maxFloor, Math.max(2, S.campReturn || S.maxFloor)) + '</button>' : '');
      if (rc.dataset.h !== r) { rc.innerHTML = r; rc.dataset.h = r; }
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-camp]'); if (!b) return;
    const a = b.dataset.camp;
    if (a === 'go') goCamp(); else if (a === 'down') descend(); else if (a === 'drink') drinkDraught(); else if (a === 'store') openStore(); else campModal();
  });
  setInterval(paintCamp, 500);

  // ---------- store ----------
  function openStore() {
    const row = it => {
      const p = L.shopPrice(S, it.id), have = (S.items && S.items[it.id]) || 0;
      return '<div class="trow"><div class="tile r-' + (it.id === 'draught' ? 'epic' : 'rare') + '">' + icon(it.icon) + '</div><div class="tinfo"><b>' + it.name + '</b><small>' + it.desc + '</small><small>You have ' + have + '.</small></div><div class="tact"><span class="price">' + icon('coin') + fmt(p) + '</span><button class="btn small" data-buy="' + it.id + '"' + (p > S.gold ? ' disabled' : '') + '>Buy</button></div></div>';
    };
    modal('<div class="maphead"><div><h2>The Quartermaster</h2><small>Old Thessaly keeps a stall by the campfire. Prices follow how much gold you earn.</small></div><button class="iconbtn" id="st-x" aria-label="Close">&times;</button></div><div class="tlist store">' + L.SHOP.map(row).join('') + '</div>' +
      '<p class="note small">Use a Campfire Draught from the camp bar in the Party or Gear tab. Lantern Oil appears under the lantern during guardian fights.</p>', md => {
        md.className = 'sheet wide';
        md.querySelector('#st-x').onclick = closeModal;
        md.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { if (L.buyShop(S, b.dataset.buy, 1)) { sfx.coin(); save(); openStore(); paintCamp(); } });
      });
  }

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
        btn = '<button class="buy" data-train="' + id + '"' + (cost > S.gold ? ' disabled' : '') + '><b>Train +' + n + '</b><span>' + coin + '<em>' + fmt(cost) + '</em></span></button>';
      } else btn = '<button class="btn ghost small" data-dismiss="' + id + '">Dismiss</button>';
      const mv = '<div class="mv"><button class="mini up" data-move="' + i + ':-1"' + (i === 0 ? ' disabled' : '') + ' title="Move forward" aria-label="Move ' + esc(m.name) + ' forward">&#9650;</button><button class="mini dn" data-move="' + i + ':1"' + (i === L.PARTY_SIZE - 1 ? ' disabled' : '') + ' title="Move back" aria-label="Move ' + esc(m.name) + ' back">&#9660;</button></div>';
      html += '<div class="seat' + (down ? ' down' : '') + (m.player ? ' mine' : '') + '"><span class="pos">' + (i + 1) + '<small>' + L.POS_NAME[i] + '</small></span>' + mv + portrait(id) +
        '<div class="info"><div class="nm"><a class="pname" data-prof="' + id + '">' + esc(m.name) + '</a> ' + classTag(m.cls) + (id === 'you' ? '<span class="you">You</span>' : guest ? '<span class="you guest">Player</span>' : '') + '</div>' +
        '<div class="lv">' + (down ? 'Fallen. Back up in ' + Math.ceil((down - now) / 1000) + 's' : memberStatsLine(id, now)) + '</div>' +
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
        '<div class="jobline' + (job ? ' on' : '') + '">' + (job ? icon(job.icon) + '<b>' + job.name + '</b> ' + L.jobText(job, L.jobValue(S, job, id)) : 'No camp job. Give them one to help the party.') + '</div></div>' +
        '<div class="acts"><button class="buy" data-train="' + id + '"' + (cost > S.gold ? ' disabled' : '') + '><b>Train +' + n + '</b><span>' + coin + '<em>' + fmt(cost) + '</em></span></button>' +
        '<button class="rest" data-jobfor="' + id + '">' + (job ? 'Change job' : 'Give a job') + '</button><button class="rest" data-seat="' + id + '">Bring along</button></div></div>';
    }).join('');
    if (!bench.length) benchHtml = jobsHtml + '<p class="note">No one is at the fire. Companions who rest here can take a job that helps the whole party.</p>';
    if ($('bench').dataset.h !== benchHtml) { $('bench').innerHTML = benchHtml; $('bench').dataset.h = benchHtml; }
  }
  const partyClick = e => {
    const pf = e.target.closest('[data-prof]'); if (pf) { profileModal(pf.dataset.prof); return; }
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.move) { const [i, d] = t.dataset.move.split(':').map(Number); if (L.moveMember(S, i, i + d)) { sfx.buy(); updateSeats(true); updateAbilities(true); } return; }
    if (t.id === 'f-auto') { L.autoFormation(S); S.formationManual = false; sfx.buy(); updateSeats(true); updateAbilities(true); toast('shield', 'Party arranged', 'Tank in front, rogue behind it, healers in the middle where they reach everyone, casters at the back.', ''); return; }
    if ((t.dataset.train && t.dataset.train !== 'you') || t.dataset.unseat || t.dataset.seat || t.dataset.dismiss || t.dataset.recruit || t.dataset.job || t.dataset.jobfor) { if (!campGate()) return; }
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
    else if (t.id === 'b-find') findHeroes();
    else if (t.id === 'b-signin') openAccount();
    else if (t.id === 'f-recruit') switchTab('market');
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
      h += '<ol class="steps"><li><b>Sign in</b> with a free account.</li><li>Press <b>Browse the guild</b> to see players’ heroes.</li><li>Press <b>Recruit</b> to put one in an empty seat.</li></ol>' +
        '<button class="btn small" id="b-signin">Sign in to recruit</button>';
    } else {
      h += (open ? '<p class="note">' + open + (open === 1 ? ' seat is' : ' seats are') + ' open.</p>' : '<p class="note">Your party is full. When you recruit, you choose who steps out.</p>') +
        '<button class="btn small" id="b-find">' + (boardList ? 'Show other heroes' : 'Browse the guild') + '</button>';
      if (boardMsg) h += '<p class="note">' + esc(boardMsg) + '</p>';
      if (boardList) h += '<div class="board">' + boardList.map(g => '<div class="seat bench"><div class="ic c-' + g.cls + ' player">' + icon(CLASS_ICON[g.cls]) + '</div><div class="info"><div class="nm">' + esc(g.name) + ' ' + classTag(g.cls) + '</div><div class="lv">' + (g.on ? '<span class="online">Online now</span> &middot; ' : '') + 'Level ' + g.level + ' &middot; reached floor ' + g.floor + '</div></div>' +
        ((S.guests || []).some(x => x.id === 'p_' + g.id) ? '<span class="muted">In party</span>' : '<button class="btn small" data-recruit="' + g.id + '">Recruit</button>') + '</div>').join('') + '</div>';
      if ((S.guests || []).length) h += '<p class="note">To let a player’s hero go, press Dismiss on their seat.</p>';
    }
    w.innerHTML = h + '</div>';
  }
  async function findHeroes() {
    boardMsg = 'Searching the guild…'; paintBoard();
    try { const r = await api('GET', null, '/heroes'); boardList = (r && r.heroes) || []; boardMsg = boardList.length ? '' : 'The guild hall is quiet right now. Check back soon.'; }
    catch (e) { boardMsg = 'Could not reach the Players Guild. Try again in a moment.'; }
    paintBoard();
  }
  async function recruitPlayer(gid) {
    const g = (boardList || []).find(x => x.id === gid); if (!g) return;
    const join = async () => {
      L.addGuest(S, { id: 'p_' + g.id, name: g.name, cls: g.cls, level: g.level });
      try { await api('POST', { heroId: g.id }, '/recruit'); } catch (e) {}
      sfx.buy(); toast('users', g.name + ' joins your party', 'A ' + L.CLASSES[g.cls].name + ' at level ' + g.level + '.', 'feat');
      updateSeats(true); updateAbilities(true); paintBoard();
    };
    if (S.party.includes(null)) return join();
    modal('<h2>Make room for ' + esc(g.name) + '</h2><p>Your party is full. Who should step out? Story companions go back to the campfire, and players’ heroes are dismissed.</p><div class="choice">' +
      S.party.map((x, i) => x === 'you' || !x ? '' : '<button class="pick" data-out="' + i + '"><b>' + esc(L.memberById(x).name) + '</b><small>' + L.CLASSES[L.memberById(x).cls].name + ', level ' + L.lvl(S, x) + (L.isGuest(S, x) ? ' &middot; player' : '') + '</small></button>').join('') +
      '</div><div class="row"><button class="btn ghost" id="m-cancel">Cancel</button></div>', md => {
        md.querySelectorAll('[data-out]').forEach(b => b.onclick = () => {
          const i = +b.dataset.out, x = S.party[i];
          if (L.isGuest(S, x)) L.dismissGuest(S, x); else L.unseat(S, i);
          closeModal(); join();
        });
        md.querySelector('#m-cancel').onclick = closeModal;
      });
  }

  // ---------- abilities bar ----------
  let abilKey = '';
  function updateAbilities(force) {
    const now = Date.now(), box = $('abilities');
    const key = S.party.join(',');
    if (force || key !== abilKey) {
      abilKey = key;
      box.innerHTML = S.party.map((id, i) => {
        if (!id) return '<div class="skill locked"><svg viewBox="0 0 24 24"><use href="#i-user"/></svg><div><b>Empty seat</b><small>&nbsp;</small></div><kbd>' + (i + 1) + '</kbd></div>';
        const m = L.memberById(id), ab = L.CLASSES[m.cls].ability;
        return '<button class="skill c-' + m.cls + '" data-cast="' + id + '" title="' + esc(ab.desc) + '"><div class="cd"></div>' + icon(CLASS_ICON[m.cls]) + '<div><b>' + ab.name + '</b><small></small></div><kbd>' + (i + 1) + '</kbd></button>';
      }).join('');
    }
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
  $('abilities').addEventListener('click', e => { const b = e.target.closest('[data-cast]'); if (b) { if (L.castAbility(S, b.dataset.cast, Date.now(), events)) { handleEvents(); updateAbilities(); } } });

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
  const gearOwners = () => { const inCamp = camp(); return S.unlocked.filter(id => { const m = L.memberById(id); return m && !m.guest && (inCamp || S.party.includes(id)); }); };
  function updateGear(force) {
    const who = gearOwners();
    if (!who.includes(gearWho)) gearWho = who[0];
    $('gearcount').textContent = S.bag.length ? S.bag.length : '';
    if (!gearWho) return;
    const key = gearWho + '|' + camp() + '|' + S.party.join() + '|' + S.bag.length + '|' + JSON.stringify(S.gear) + '|' + S.bag.map(x => x.up).join('') + '|' + S.unlocked.length + '|' + Math.floor(S.gold);
    if (!force && key === gearKey) return; gearKey = key;
    $('gearwho').innerHTML = who.map(id => {
      const m = L.memberById(id), n = Object.keys(L.betterFor(S, id)).length;
      return '<button class="whochip c-' + m.cls + (id === gearWho ? ' on' : '') + '" data-who="' + id + '"><img src="' + SP.spriteURL(m.cls, 2, m.hue || 0) + '" alt=""><span>' + esc(m.name) + '</span>' + (n ? '<em title="Better gear in your pack">' + n + '</em>' : '') + '</button>';
    }).join('');
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
      if (sl === 'legs' && robe) return '<div class="dslot ds-legs covered" title="The robe covers the legs"><div class="tile ghost"><img class="iimg" src="' + SP.itemIcon(m.cls, 'legs', 'common') + '" alt=""></div><span>Robe</span></div>';
      const it = g[sl] && L.itemOf(S, g[sl]);
      const up = better[sl] ? '<i class="upb" title="Better one in your pack">&#9650;</i>' : '';
      if (!it) return '<div class="dslot ds-' + sl + ' empty" title="Empty ' + name.toLowerCase() + ' slot"><div class="tile ghost"><img class="iimg" src="' + SP.itemIcon(m.cls, type, 'common') + '" alt="">' + up + '</div><span>' + name + '</span></div>';
      return '<div class="dslot ds-' + sl + '"><div class="tile r-' + it.rar + '" data-item="' + it.uid + '" role="button" tabindex="0" title="' + esc(L.gearName(it)) + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + up + '</div><span>' + name + '</span></div>';
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
      '<div class="dollbar"><small>' + cname + ' gear only. Tap a piece for details.</small><button class="btn small" id="g-best"' + (nb ? '' : ' disabled') + '>' + (nb ? 'Equip best (' + nb + ')' : 'Best gear on') + '</button></div>';
    $('gearslots').innerHTML = h;
    $('bagcount').textContent = S.bag.length + '/' + L.bagCap(S);
    const tile = (it, dim) => {
      const w = L.wearer(S, it.uid), fit = it.cls === m.cls;
      const d = fit && !w ? Math.round((L.itemScore(it) - L.replaces(S, gearWho, it).reduce((a, x) => a + L.itemScore(x), 0)) * 100) : 0;
      return '<div class="tile r-' + it.rar + (dim ? ' dim' : '') + (w ? ' worn' : '') + '" data-item="' + it.uid + '" role="button" tabindex="0" title="' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + ' (' + itemEffect(it) + ')' + (w ? ', worn by ' + esc(L.memberById(w).name) : '') + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' +
        '<i class="lvb' + (fit && !L.canWear(S, gearWho, it) ? ' no' : '') + '">' + L.reqLevel(it) + '</i>' + (it.aff || it.jset ? '<i class="affb" title="Helps a camp job"></i>' : '') + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + (d > 0 && L.canWear(S, gearWho, it) ? '<i class="upb">&#9650;</i>' : '') + (w ? '<i class="wb" title="Worn">' + esc(L.memberById(w).name.charAt(0)) + '</i>' : '') + '</div>';
    };
    const fits = S.bag.filter(it => it.cls === m.cls).sort((a, b) => L.gearPct(b) - L.gearPct(a));
    const others = S.bag.filter(it => it.cls !== m.cls);
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
    if (!S.bag.length) bh = '<p class="note">Your pack is empty. Gear drops from foes, chests and guardians.</p>';
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
    if (e.target.closest('.dfig')) { profileModal(gearWho); return; }
    const it = e.target.closest('[data-item]'); if (it) { if ((e.ctrlKey || e.metaKey) && linkItem(L.itemOf(S, it.dataset.item))) return; itemModal(it.dataset.item); }
  });
  ['tab-gear', 'tab-party', 'tab-camp', 'tab-market'].forEach(t => $(t).addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-item],[data-prof]')) { e.preventDefault(); e.target.click(); } }));
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
      (CL ? tool('i-mkt', 'coin', 'Sell') + tool('i-send', 'users', 'Send') + tool('i-link', 'chat', 'Link') : '') +
      tool('i-sell', 'flame', 'Salvage ' + fmt(L.salvageValue(it)), 'danger') + '</div></div>', md => {
        const gate = f => () => { if (!signedIn()) { closeModal(); toast('lock', 'Sign in to trade', 'The market and mail need a free account.', 'warn'); authForm('in'); return; } f(uid); };
        const mk = md.querySelector('#i-mkt'); if (mk) mk.onclick = gate(sellItem);
        const sd = md.querySelector('#i-send'); if (sd) sd.onclick = gate(sendItem);
        const lk = md.querySelector('#i-link'); if (lk) lk.onclick = () => { closeModal(); linkItem(it); };
        const re = () => { updateGear(true); updateSeats(true); itemModal(uid); };
        const on = md.querySelector('#i-on'); if (on) on.onclick = () => { if (!campGate()) return; L.equip(S, gearWho, uid); sfx.buy(); re(); };
        const off = md.querySelector('#i-off'); if (off) off.onclick = () => { if (!campGate()) return; L.unequip(S, w, L.wornPos(S, uid)); re(); };
        const up = md.querySelector('#i-up'); if (up) up.onclick = () => { if (!campGate()) return; if (L.upgrade(S, uid)) { sfx.relic(); re(); } };
        const sv = md.querySelector('#i-sell');
        sv.onclick = () => {
          if (!sv.classList.contains('confirm') && (it.rar === 'epic' || it.rar === 'set' || it.up || w)) { sv.classList.add('confirm'); sv.querySelector('span').textContent = 'Tap again to salvage'; return; }
          const v = L.salvage(S, uid); sfx.coin(); closeModal(); updateGear(true); updateSeats(true); toast('coin', 'Salvaged', '+' + fmt(v) + ' gold', '');
        };
        md.querySelector('#i-close').onclick = closeModal;
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
    const guest = L.isGuest(S, id), lv = L.lvl(S, id) || 1, inParty = S.party.includes(id);
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
      '<h3 class="sub">' + c.name + '</h3><p class="note">' + esc(CLASS_BLURB[m.cls]) + '</p>' +
      '<div class="ability"><b>' + c.ability.name + '</b> <span>every ' + c.ability.cd + 's</span><small>' + esc(c.ability.desc) + '</small></div>' +
      '<div class="pstats">' + stats.map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('') + '</div>' +
      (sd ? '<p class="note">' + sd.name + ': “' + sd.motto + '” ' + esc(sd.desc) + '</p>' : '') +
      (guest ? '' : '<h3 class="sub">Gear</h3><ul class="pgear">' + gearList + '</ul>') +
      '<div class="row">' + (guest ? '' : '<button class="btn ghost" id="p-gear">Manage gear</button>') + (!inParty && !guest ? '<button class="btn" id="p-seat">Bring along</button>' : '') + '<button class="btn ghost" id="p-close">Close</button></div></div>', md => {
        const box = md.querySelector('.profspr'); try { const img = SP.render(m.cls, 5, m.hue || 0); if (img) box.appendChild(img); } catch (e) {}
        const g = md.querySelector('#p-gear'); if (g) g.onclick = () => { closeModal(); gearWho = id; switchTab('gear'); };
        const st = md.querySelector('#p-seat'); if (st) st.onclick = () => { closeModal(); if (campGate()) pickSeat(id); };
        md.querySelector('#p-close').onclick = closeModal;
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
  function scrapList() {
    const best = new Set();
    if (scrapOpts.keepBest) {
      const top = {};
      for (const it of S.bag) { const k = it.cls + it.slot; if (!top[k] || L.gearPct(it) > L.gearPct(top[k])) top[k] = it; }
      Object.values(top).forEach(it => best.add(it.uid));
    }
    return S.bag.filter(it => scrapOpts[it.rar] && !L.wearer(S, it.uid) && !best.has(it.uid) && !(scrapOpts.keepUp && it.up > 0));
  }
  function openScrap() {
    const draw = () => {
      const list = scrapList(), gold = list.reduce((a, it) => a + L.salvageValue(it), 0);
      const chk = (k, label, sub) => '<label class="chk"><input type="checkbox" data-opt="' + k + '"' + (scrapOpts[k] ? ' checked' : '') + '><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
      modal('<h2>Mass scrap</h2><p>Salvage many pieces at once for gold. Gear someone is wearing is never scrapped.</p>' +
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
      ['Embers', fmt(S.embers) + ' (+' + fmt(S.embers * 10) + '%)'], ['Times rekindled', st.rekindles], ['Time played', fmtTime(st.playTime)],
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
    modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Rekindle now?</h2><p>Gold, floors and training reset to the start. You keep your companions, gear, relics, story and feats, and gain <b style="color:var(--ember)">' + fmt(e) + ' Embers</b> for +' + fmt(e * 10) + '% damage and gold.</p><div class="row" style="justify-content:center"><button class="btn ghost" id="m-no">Not yet</button><button class="btn" id="m-yes">Rekindle</button></div></div>', m => {
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
    $('kindcount').textContent = k ? k : '';
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
      '<div class="kfoot"><span>Spent ' + L.skillSpent(S) + ' of 36</span>' + (L.skillSpent(S) ? '<button class="btn ghost small" id="k-reset">Reset tree</button>' : '') + '</div>' +
      '<h3 class="sub">Spend Kindling</h3><div class="kshop">' +
      '<div class="kitem"><div class="kic">' + icon('bag') + '</div><div><b>Bigger pack</b><small>+' + L.BAG_STEP + ' bag slots. You have ' + L.bagCap(S) + '.</small></div>' +
      (capNext > 0 ? '<button class="btn small" id="k-bag"' + (k >= bc ? '' : ' disabled') + '>' + bc + ' Kindling</button>' : '<em class="kmax">Full size</em>') + '</div>' +
      '<div class="kitem"><div class="kic">' + icon('gear-trinket') + '</div><div><b>Rings and a second trinket</b><small>Every character can open rings 2 to 5 and a second trinket slot. Tap a locked slot on the Gear tab.</small></div><button class="btn ghost small" id="k-gear">Open Gear</button></div></div>';
  }
  $('skills') && $('skills').addEventListener('click', e => {
    const b = e.target.closest('[data-learn]');
    if (b) { if (L.learnSkill(S, b.dataset.learn)) { sfx.buy(); save(); updateSkills(); updateAbilities(true); } return; }
    if (e.target.closest('#k-bag')) { if (L.buyBag(S)) { sfx.relic(); save(); toast('bag', 'Bigger pack', 'Your pack now holds ' + L.bagCap(S) + ' items.', ''); updateSkills(); } return; }
    if (e.target.closest('#k-gear')) { switchTab('gear'); return; }
    if (e.target.closest('#k-reset')) {
      if (!campGate()) return;
      modal('<div class="center"><h2>Reset your skill tree?</h2><p>All ' + L.skillSpent(S) + ' Kindling comes back to you so you can choose again. You can only do this at camp.</p><div class="row"><button class="btn ghost" id="r-no">Keep it</button><button class="btn" id="r-yes">Reset</button></div></div>', md => {
        md.querySelector('#r-no').onclick = closeModal;
        md.querySelector('#r-yes').onclick = () => { L.resetSkills(S); save(); closeModal(); updateSkills(); };
      });
    }
  });

  // ---------- tabs ----------
  let tab = 'party', cx = 'journal';
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
    $('dps').textContent = fmt(L.totalDps(S, now));
    $('embers').textContent = fmt(S.embers); $('kindcount').textContent = S.kindling ? S.kindling : '';
    if (tab === 'party' || tab === 'camp') updateSeats(force);
    if (tab === 'market' && force) paintBoard();
    if (tab === 'gear') updateGear(force);
    if (tab === 'codex') {
      if (cx === 'journal' && force) updateJournal();
      if (cx === 'relics' && (force || lastRelicCount !== Object.keys(S.relics).length)) updateRelics();
      if (cx === 'stats') { if (force || lastFeatCount !== L.featCount(S)) updateFeats(); updateLedger(); }
    }
    if (tab === 'rekindle') updateRekindle();
    lastRelicCount = Object.keys(S.relics).length; lastFeatCount = L.featCount(S);
    $('relcount').textContent = lastRelicCount + '/' + L.RELICS.length;
    $('featcount').textContent = lastFeatCount + '/' + L.FEATS.length;
    $('gearcount').textContent = S.bag.length || '';
    $('lorecount').textContent = Object.keys(S.lore).filter(k => L.LORE.find(l => l.id === k)).length + '/' + L.LORE.length;
    updateAbilities();
  }

  let lastPipKey = '';
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
    $('goaltext').textContent = L.currentGoal(S);
    const f = S.foe;
    if (f) {
      $('foename').textContent = f.name;
      const tag = $('foetag'); tag.textContent = f.boss ? 'Guardian' : f.chest ? 'Treasure' : f.elite ? L.SIDES[f.side].name : ''; tag.className = 'tag' + (f.chest ? ' chest' : '') + (f.elite ? ' war w-' + f.side : '');
      $('hpbar').style.width = Math.max(0, f.hp / f.max * 100) + '%';
      $('hptext').textContent = fmt(Math.max(0, f.hp)) + ' / ' + fmt(f.max);
      $('lanternwrap').hidden = !f.boss;
      { const n = (S.items && S.items.oil) || 0; $('b-oil').hidden = !f.boss || !n || S.lantern <= 0; $('b-oil').textContent = 'Pour lantern oil (' + n + ')'; }
      if (f.boss) {
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
      '<h3 class="sub">Pledge your banner</h3><div class="sides">' + L.SIDE_ORDER.map(k => { const d = L.SIDES[k]; return '<button class="pick side' + (side === k ? ' on' : '') + '" data-side="' + k + '" style="--side:' + d.color + '"><b>' + d.name + '</b><i>\u201c' + d.motto + '\u201d</i><small>' + d.desc + '</small><em>' + d.perk + '</em></button>'; }).join('') + '</div>' +
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

  // ---------- settings ----------
  $('btn-settings').addEventListener('click', openSettings);
  function openSettings() {
    modal('<h2>Settings</h2>' +
      '<label class="setrow"><span>Sound effects</span><input type="checkbox" id="s-sound"' + (S.settings.sound ? ' checked' : '') + '></label>' +
      '<label class="setrow"><span>Scientific notation for big numbers</span><input type="checkbox" id="s-sci"' + (S.settings.notation === 'sci' ? ' checked' : '') + '></label>' +
      '<p style="margin-top:16px">Your progress saves automatically in this browser. Copy a backup to move it to another device.</p>' +
      '<div class="row"><button class="btn ghost" id="s-export">Copy backup</button><button class="btn ghost" id="s-import">Load backup</button><button class="btn danger" id="s-reset">Erase progress</button></div>' +
      '<div id="s-extra"></div>' +
      (window.LH_SUPPORT_URL ? '<p style="margin-top:16px">Lanternhold is free with no ads. If you enjoy it, you can <a style="color:var(--gold)" target="_blank" rel="noopener" href="' + window.LH_SUPPORT_URL + '">buy the developer a coffee</a>. Thank you.</p>' : '') +
      '<p class="credits">Lanternhold v0.2 &middot; An original game by Born2Develop. Made with care, no ads, no tracking.</p>' +
      '<div class="row"><button class="btn" id="s-close">Done</button></div>', m => {
        m.querySelector('#s-sound').onchange = e => { S.settings.sound = e.target.checked; };
        m.querySelector('#s-sci').onchange = e => { S.settings.notation = e.target.checked ? 'sci' : 'short'; updatePanel(true); };
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
    sec = Math.min(OFFLINE_CAP, sec);
    const g = L.offlineGoldPerSec(S) * sec;
    if (g > 0) { S.gold += g; S.stats.goldEarned += g; }
    if (fromLoad && sec >= 60 && g > 0) {
      modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Welcome back</h2><p>Your party kept delving for ' + fmtTime(sec) + ' while you were away and brought home</p><div class="big">' + fmt(g) + ' gold</div><div class="row" style="justify-content:center"><button class="btn" id="m-ok">Collect</button></div></div>', m => { m.querySelector('#m-ok').onclick = () => { sfx.coin(); closeModal(); }; });
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
      lastSlow = now; updatePanel(false);
      const got = L.checkFeats(S);
      got.forEach(f => toast('star', 'Feat earned: ' + f.name, f.desc + ' (+2% party damage)', 'feat'));
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
      const r = await api('PUT', { name: S.hero.name, cls: S.hero.cls, side: S.hero.side, level: L.lvl(S, 'you'), floor: S.maxFloorEver }, '/hero');
      const n = r && r.recruits;
      if (n > 0) {
        const g = Math.max(100, L.offlineGoldPerSec(S) * 600) * n;
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
    modal('<form class="auth" novalidate><h2>' + titles[mode] + '</h2><p>' + lead + '</p>' + f +
      '<div class="err" id="f-err"></div><button class="btn" type="submit" id="f-go">' + btn + '</button><div class="links">' + links + '</div>' +
      '<p class="credits">We only keep your email and game save. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p></form>', m => {
        m.querySelectorAll('.em').forEach(x => x.textContent = email || '');
        const em = m.querySelector('#f-email'); if (em && email) em.value = email;
        const err = m.querySelector('#f-err'); if (note) { err.textContent = note; err.classList.add('ok'); }
        m.querySelectorAll('[data-go]').forEach(x => x.onclick = () => authForm(x.dataset.go, em ? em.value.trim() : email));
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
          sess = null; storeSess(); paintAccount(); closeModal(); toast('user', 'Signed out', 'Your progress stays on this device too.', '');
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
    document.addEventListener('visibilitychange', () => { if (document.hidden && signedIn()) pushCloud(true); });
  }

  // ---------- support link ----------
  if (window.LH_SUPPORT_URL) { const a = $('support'); a.href = window.LH_SUPPORT_URL; a.hidden = false; a.title = 'Buy the developer a coffee'; }


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
    log.innerHTML = list.length ? list.map(m => '<div class="msg' + (m.from === chat.me ? ' mine' : '') + '"><button class="who c-' + esc(m.cls) + '" data-from="' + esc(m.from) + '" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">' + esc(m.name) + '</button><span>' + renderText(m.text) + '</span></div>').join('')
      : '<div class="chatempty"><p>' + (chat.ch === 'trade' ? 'Nobody is trading yet. Post what you have or what you need.' : chat.ch === 'party' ? 'Your party chat. Players whose heroes you recruit, or who recruit yours, can talk here.' : 'Quiet down here. Say hello.') + '</p></div>';
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
    $('chatin').placeholder = ch === 'trade' ? 'Looking for, or offering...' : ch === 'party' ? 'Talk to your party' : 'Say something';
    if (ch === 'party') loadRooms(); else $('chatroom').hidden = true;
    chatNote(); paintChat(); pollChat();
  }
  function openChat(open) {
    chat.open = open; $('chat').hidden = !open; $('chatdot').hidden = true;
    if (open) { paintChat(); pollChat(); if (signedIn()) setTimeout(() => $('chatin').focus(), 50); } else clearTimeout(chat.timer);
  }
  if (CL) {
    $('btn-chat').hidden = false;
    $('btn-chat').addEventListener('click', () => openChat($('chat').hidden));
    $('chatx').addEventListener('click', () => openChat(false));
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
  // A cut-away of the descent: the Hold on top, one band per region, a winding trail of floors.
  const MAP_W = 360, BAND = 168, TOP = 96;
  function storyFloor(b) { const m = String(b.when).match(/maxFloorEver >= (\d+)/); return m ? +m[1] : 1; }
  function mapNode(f) {
    const r = Math.floor((f - 1) / 10), i = (f - 1) % 10, ltr = r % 2 === 0;
    const col = ltr ? i : 9 - i;
    const x = 34 + col * 32.4, y = TOP + r * BAND + 76 + Math.sin(i * 1.3 + r) * 12 + (i % 2 ? 18 : 0);
    return { x: Math.round(x), y: Math.round(y) };
  }
  function openMap() {
    const cyc = L.depthCycle(S.floor), base = cyc * 10 * L.BIOMES.length;
    const reached = S.maxFloor, cur = S.floor;
    const H_ = TOP + L.BIOMES.length * BAND + 70;
    let svg = '<svg class="deepmap" viewBox="0 0 ' + MAP_W + ' ' + H_ + '" role="img" aria-label="Map of the Lantern Deep">';
    svg += '<defs>' + L.BIOMES.map((b, r) => '<linearGradient id="mg' + r + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + b.bg[0] + '"/><stop offset="1" stop-color="' + b.bg[1] + '"/></linearGradient>').join('') +
      '<radialGradient id="mglow"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".9"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient></defs>';
    // the Hold, on the surface
    svg += '<rect x="0" y="0" width="' + MAP_W + '" height="' + TOP + '" fill="#2a2015"/><path d="M0 ' + (TOP - 8) + ' Q 90 ' + (TOP - 22) + ' 180 ' + (TOP - 10) + ' T 360 ' + (TOP - 12) + ' V ' + TOP + ' H 0 Z" fill="#1a130c"/>' +
      '<g transform="translate(272 14)" fill="#c9a46a"><rect x="0" y="26" width="60" height="34" rx="2"/><rect x="8" y="10" width="14" height="18"/><rect x="38" y="10" width="14" height="18"/><rect x="24" y="0" width="12" height="28"/><circle cx="30" cy="40" r="7" fill="#ffd27a"/></g>' +
      '<circle cx="302" cy="54" r="26" fill="url(#mglow)"/><text x="16" y="30" class="mt">The Hold</text><text x="16" y="46" class="ms">Iron Covenant fortress, Shattered Reach</text>';
    L.BIOMES.forEach((b, r) => {
      const y0 = TOP + r * BAND, first = base + r * 10 + 1, known = first <= reached || (cyc === 0 && r === 0);
      svg += '<rect x="0" y="' + y0 + '" width="' + MAP_W + '" height="' + BAND + '" fill="url(#mg' + r + ')"/>';
      svg += '<path d="M0 ' + (y0 + 2) + ' Q 120 ' + (y0 + 10 + (r % 2) * 8) + ' 240 ' + (y0 + 4) + ' T 360 ' + (y0 + 6) + '" stroke="rgba(0,0,0,.45)" stroke-width="3" fill="none"/>';
      const sd = L.SIDES[b.war.side];
      svg += '<text x="14" y="' + (y0 + 22) + '" class="mt" fill="' + b.accent + '">' + esc(known ? b.name : 'Unexplored') + '</text>';
      svg += '<text x="14" y="' + (y0 + 37) + '" class="ms">Floors ' + first + '–' + (first + 9) + (known ? ' · ' + sd.name + ' warbands' : '') + '</text>';
      if (!known) svg += '<rect x="0" y="' + (y0 + 44) + '" width="' + MAP_W + '" height="' + (BAND - 44) + '" fill="rgba(5,4,3,.55)"/>';
    });
    // the trail
    const nodes = []; for (let k = 1; k <= 10 * L.BIOMES.length; k++) nodes.push(Object.assign({ f: base + k }, mapNode(k)));
    const path = nodes.map((n, i) => (i ? 'L' : 'M') + n.x + ' ' + n.y).join(' ');
    svg += '<path d="' + path + '" stroke="#000" stroke-opacity=".5" stroke-width="5" fill="none" stroke-linejoin="round"/>';
    const lastIdx = Math.max(0, Math.min(nodes.length - 1, reached - base - 1));
    svg += '<path d="' + nodes.slice(0, lastIdx + 1).map((n, i) => (i ? 'L' : 'M') + n.x + ' ' + n.y).join(' ') + '" stroke="#e9c98a" stroke-width="2" stroke-dasharray="1 4" stroke-linecap="round" fill="none"/>';
    // story moments
    const beats = cyc === 0 ? L.STORY.filter(b => S.story.seen[b.id] && b.id !== 'intro') : [];
    for (const b of beats) { const f = Math.min(storyFloor(b), 80), n = nodes[f - 1]; if (!n) continue; svg += '<g class="mbeat" data-scene="' + b.id + '"><title>' + esc('Chapter ' + b.ch + ': ' + b.title) + '</title><circle cx="' + (n.x + 9) + '" cy="' + (n.y - 12) + '" r="6" fill="#1b140d" stroke="#e9c98a"/><text x="' + (n.x + 9) + '" y="' + (n.y - 9.5) + '" class="mb">' + b.ch + '</text></g>'; }
    for (const n of nodes) {
      const boss = L.isBossFloor(n.f), big = n.f % 10 === 0, ok = n.f <= reached, here = n.f === cur;
      const b = L.BIOMES[Math.floor((n.f - base - 1) / 10)];
      const r = big ? 9 : boss ? 6.5 : 3.6;
      svg += '<g class="mnode' + (ok ? ' ok' : '') + (here ? ' here' : '') + '" data-floor="' + n.f + '"><title>' + (boss ? (big ? b.boss : 'Guardian') + ', floor ' + n.f : 'Floor ' + n.f) + (ok ? '' : ' (not reached)') + '</title>' +
        (here ? '<circle cx="' + n.x + '" cy="' + n.y + '" r="16" fill="url(#mglow)" class="pulse"/>' : '') +
        '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (r + 6) + '" fill="transparent"/>' +
        '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="' + (ok ? (boss ? b.accent : '#e9c98a') : '#2b241c') + '" stroke="' + (boss ? '#1a120b' : 'rgba(0,0,0,.6)') + '" stroke-width="' + (boss ? 2 : 1) + '"/>' +
        (big ? '<text x="' + n.x + '" y="' + (n.y + 3.5) + '" class="mk">' + (n.f < reached ? '✓' : '!') + '</text>' : '') +
        (big && ok ? '<text x="' + n.x + '" y="' + (n.y + 24) + '" class="mg">' + esc(b.boss) + '</text>' : '') + '</g>';
    }
    // you are here
    const hn = nodes[cur - base - 1];
    if (hn) svg += '<g class="youhere"><path d="M' + hn.x + ' ' + (hn.y - 12) + ' l-6 -11 h12 z" fill="#f2c14e" stroke="#1a120b"/><text x="' + hn.x + '" y="' + (hn.y - 27) + '" class="mh">You</text></g>';
    // the Rift below
    const yb = TOP + L.BIOMES.length * BAND;
    svg += '<rect x="0" y="' + yb + '" width="' + MAP_W + '" height="70" fill="#07050d"/><path d="M150 ' + (yb + 14) + ' l12 18 l-8 4 l16 22 l-22 -18 l8 -4 z" fill="#9a7cff" opacity=".8"/><text x="' + MAP_W / 2 + '" y="' + (yb + 64) + '" class="mr">' + (S.story.seen.end ? 'The Nyx Rift. The stair keeps going.' : 'Something waits below.') + '</text>';
    svg += '</svg>';
    const depthName = cyc ? ' · Depth ' + ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][Math.min(cyc, 7)] : '';
    modal('<div class="maphead"><div><h2>The Lantern Deep' + depthName + '</h2><small>Deepest floor reached: <b>' + reached + '</b>. Tap a lit floor to travel there, or a numbered marker to replay that chapter.</small></div><button class="iconbtn" id="map-x" aria-label="Close map">&times;</button></div><div class="mapscroll">' + svg + '</div>' +
      '<div class="maplegend"><span><i class="lg-f"></i>Floor</span><span><i class="lg-g"></i>Guardian</span><span><i class="lg-s">3</i>Story chapter</span><span><i class="lg-y"></i>You</span></div>', md => {
        md.closest('.sheet') && md.closest('.sheet').classList.add('mapsheet');
        const sc = md.querySelector('.mapscroll'), here = md.querySelector('.mnode.here');
        if (here && sc) { const svgEl = md.querySelector('svg'), k = svgEl.getBoundingClientRect().height / H_; sc.scrollTop = Math.max(0, (hn ? hn.y : 0) * k - sc.clientHeight / 2); }
        md.querySelector('#map-x').onclick = closeMap;
        md.querySelector('svg').addEventListener('click', e => {
          const bt = e.target.closest('.mbeat'); if (bt) { const b = L.STORY.find(x => x.id === bt.dataset.scene); closeMap(); if (b) playScene(b, true); return; }
          const g = e.target.closest('.mnode.ok'); if (!g) return;
          const f = +g.dataset.floor; closeMap();
          if (f !== S.floor) { L.gotoFloor(S, f); S.autoAdvance = f >= S.maxFloor; updateStage(); toast('map', 'Travelled to floor ' + f, L.biomeOf(f).name + (f < S.maxFloor ? '. Descend automatically is off so you stay here. Turn it back on to push deeper.' : '.'), ''); }
        });
      });
  }
  function closeMap() { const sh = document.querySelector('.modal .sheet.mapsheet'); if (sh) sh.classList.remove('mapsheet'); closeModal(); }
  $('btn-map').addEventListener('click', openMap);

  // ---------- update available ----------
  // version.json is stamped on every release; if it differs from this page's build, offer a refresh.
  async function checkUpdate() {
    if (!window.LH_BUILD) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.build && j.build !== window.LH_BUILD && $('btn-update').hidden) {
        $('btn-update').hidden = false;
        toast('refresh', 'A new update is ready', 'Tap Update ready at the top to load it. Your progress is saved first, and the patch notes show what changed.', 'feat');
      }
    } catch (e) {}
  }
  $('btn-update').addEventListener('click', () => { try { save(); } catch (e) {} try { pushCloud && pushCloud(true); } catch (e) {} setTimeout(() => location.reload(), 300); });
  setInterval(checkUpdate, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  setTimeout(checkUpdate, 20000);

  // ---------- tutorial (coach marks) and the Guide ----------
  // Steps show one at a time, point at the real control, and wait for the player to do the thing.
  const sumLevels = () => Object.keys(S.levels).reduce((a, k) => a + (S.levels[k] || 0), 0);
  const TUT = [
    { id: 'strike', title: 'Strike!', text: 'Tap the monster to hit it yourself. Your party fights on its own too, but every tap helps. Try a few.', target: '#arena', tab: null, ready: () => true, done: c => S.stats.clicks >= c.clicks + 5, noNext: true },
    { id: 'gold', title: 'Gold', text: 'Every monster drops gold, even while you are away. Gold is how your party grows stronger.', target: '.stat.gold', ready: () => true },
    { id: 'train', title: 'Train your party', text: 'Spend gold to train. Higher levels mean more damage, health and healing. You can train your own hero anywhere, and your companions at camp on floor 1, where you are now.', target: '#seats .buy:not([disabled])', tab: 'party', ready: () => S.gold >= 10, done: c => sumLevels() > c.levels, noNext: true },
    { id: 'abil', title: 'Abilities', text: 'Each class has a special move. They fire by themselves, or press keys 1 to 5 (or tap them) to use one right when you need it.', target: '#abilities', ready: () => true },
    { id: 'order', title: 'Marching order', text: 'The top of this list stands at the front. Keep your tank up front, healers in the middle so they reach everyone, and watch the back for ambushes.', target: '.formhead', tab: 'party', ready: () => S.party.filter(Boolean).length >= 2 },
    { id: 'boss', title: 'Guardians', text: 'Every fifth floor has a guardian. Beat it before the lantern oil runs out, or your party falls back to train and try again.', target: '#lanternwrap', ready: () => S.foe && S.foe.boss },
    { id: 'gear', title: 'You found gear', text: 'Monsters drop weapons, armor, trinkets and rings. Open Gear to see them. You put gear on at camp, at the top of the stair, or anywhere with a Campfire Draught. A green arrow marks an upgrade.', target: '.tabs [data-tab="gear"]', ready: () => S.bag.length > 0, done: () => tab === 'gear', noNext: true },
    { id: 'camp', title: 'Camp', text: 'Swapping companions, training them and changing gear happen at camp. This bar takes you back up and down again, and its Store sells Campfire Draughts that make camp anywhere.', target: '#campbar', tab: 'party', ready: () => S.floor > 1 && S.maxFloorEver >= 4 },
    { id: 'map', title: 'Map of the Deep', text: 'See how far you have come, which guardians you have beaten, and travel back to any floor you have reached.', target: '#btn-map', ready: () => S.maxFloorEver >= 8 },
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

  const GUIDE = [
    ['The basics', '<p>Your party fights the monster in the arena on its own. Tap the arena (or press Space) to strike as well. Each floor has 8 monsters; clear them to go deeper.</p><p>Monsters drop <b>gold</b>. Spend it in the Party tab to <b>train</b> your companions. Every 25 levels a companion gets a big power boost.</p><p>The game keeps going while you are away. When you come back, your party brings home the gold it earned.</p>'],
    ['Your party and classes', '<p>You lead a party of five. You meet companions in the story; tap any portrait to read about them.</p><ul><li><b>Tank</b>: takes the hits. Shield Wall cuts damage by 70%.</li><li><b>Healer</b>: keeps everyone standing. Lantern Hymn heals the party and lifts a fallen ally.</li><li><b>Rogue</b>: the most damage, and dodges a quarter of attacks. Backstab hits for 12 seconds of damage at once.</li><li><b>Mage</b>: Ember Storm quadruples damage for a few seconds. Save it for guardians.</li><li><b>Necromancer</b>: raises skeletons that fight and soak up blows, and heals the party as it hits.</li></ul><p>Abilities fire by themselves. Turn that off under the arena and press 1 to 5 to time them yourself.</p>'],
    ['Marching order', '<p>The Party list is your marching order. The top member stands at the front, nearest the monster. Use the arrows to move people, or Auto-arrange.</p><ul><li>A <b>tank</b> in the front two draws the attacks. Without one, whoever is in front gets hit most.</li><li>Heals get <b>15% weaker per step</b> between healer and patient, so healers belong in the middle.</li><li>Some monsters <b>ambush</b> from behind and hit the rear member hard. A tank at the back guards against it.</li></ul><p>The notes under the list tell you how your current order is doing.</p>'],
    ['Monsters and guardians', '<p>Monsters hit back. If your whole party falls, it retreats a floor, rests, and tries again in a little over a minute. Use that time to train and check gear.</p><p>Every 5th floor has a <b>guardian</b>. You must beat it before the lantern oil runs out. Guardians drop better gear and, from floor 10, sometimes a relic.</p><p>Soldiers from the Grand War alliances (marked with their banner) are tougher than normal monsters and drop more.</p>'],
    ['The side panel', '<p><b>Party</b> is your marching order for the fight. <b>Camp</b> is the campfire: resting companions, camp jobs and training. <b>Gear</b> dresses your characters. <b>Skills</b> holds your hero’s skill tree and rekindling. <b>Market</b> has the Trading Post and the Players Guild. <b>Codex</b> keeps your journal, relics and records.</p>'],
    ['Skills and Kindling', '<p>Every rekindle gives you <b>Kindling</b>: 2 at floor 50, plus 1 for every 10 floors deeper. Spend it in the Skills tab on your hero’s class tree. Each class has three branches of three skills, and a skill needs the one above it first.</p><p>Kindling also buys a bigger pack (+10 slots) and opens extra gear slots for any character: rings 2 to 5 and a second trinket. Tap a locked slot on the Gear tab. You can reset the skill tree for free at camp.</p>'],
    ['Job gear', '<p>A few pieces of gear carry a camp-job bonus, shown by an orange dot. It counts while the wearer works that job at the campfire. Fine gear has about a 2% chance, rare 6% and epic 15%.</p><p>Each job also has its own three-piece job set (helmet, feet and ring). These drop very rarely from guardians and chests from floor 20. Two pieces add +40% to that job and all three add +100%.</p>'],
    ['Resting at camp', '<p>When you return to camp, or drink a Campfire Draught, the party sits down around the fire. Nobody fights while you rest, and everyone heals up. Press Descend to head back down.</p>'],
    ['Gear and sets', '<p>Gear drops from monsters, chests and guardians. Each piece fits one class and one slot: main hand, offhand, helmet, trinket, chest, legs, feet or ring. Robes cover the chest and the legs together. Every character starts with one trinket slot and one ring slot. Spend Kindling to open a second trinket slot and up to five rings.</p><p>In the Gear tab, pick a companion to see their three gear slots and the pieces in your pack that fit them. A green arrow marks an upgrade, a gold letter shows who is wearing a piece, and +N shows its upgrade level. Tap any piece for details. and <b>Equip best</b> does it all at once. Upgrade pieces with gold, or salvage what you do not need.</p><p>Every piece has a <b>level requirement</b> (the number in its corner). A companion must reach that level to wear it, so keep training.</p><p><b>Rarity</b> is hard to come by. Near the top of the stair almost everything is common, and a rare or epic piece is a real find. The deeper you go, the better the odds. Guardians drop gear more than half the time, chests often, war elites sometimes and ordinary monsters rarely. A <b>Forager</b> at camp improves all of it.</p><p>From floor 15, guardians can drop <b>set pieces</b>. Two or three pieces of a class set give extra bonuses.</p>'],
    ['Story, journal and map', '<p>The story unfolds as you go deeper, and new companions join along the way. Replay scenes and read everything you have learned in the <b>Journal</b>.</p><p>The <b>Map of the Deep</b> (under the floor number) shows every region, the guardians you have beaten and where you are. Tap a floor you have reached to travel there.</p>'],
    ['Relics and rekindling', '<p><b>Relics</b> are permanent bonuses that guardians sometimes drop. Duplicates level them up.</p><p>From floor 50 you can <b>rekindle</b> the lantern: start again from floor 1 and earn <b>Embers</b>. Each Ember adds 10% damage and gold forever. Your companions, gear, relics and lore stay; levels reset. Rekindle when progress slows down.</p>'],
    ['Camp and the store', '<p>Party changes happen at <b>camp</b>, at the top of the stair on floor 1. That means swapping companions, recruiting players, training companions and changing or upgrading gear. Your own hero can train anywhere, and you can rearrange the marching order at any time.</p><p>The camp bar at the top of the Party and Gear tabs has <b>Return to camp</b>. When you are done, press <b>Descend</b> to go straight back to the floor you left.</p><p>A <b>Campfire Draught</b> makes camp wherever you are for 60 seconds. <b>Lantern Oil</b> gives you 15 more seconds against a guardian. Buy both from the <b>Store</b> on the camp bar. Prices follow how much gold you earn.</p>'],
    ['Camp jobs', '<p>Companions resting at the campfire can each take a <b>camp job</b> that helps the whole party all the time, even deep below:</p><ul><li><b>Forager</b>: more gear drops (rogues are best)</li><li><b>Runesmith</b>: party damage (mages)</li><li><b>Herbalist</b>: healing (healers)</li><li><b>Armorer</b>: party health (tanks)</li><li><b>Prospector</b>: gold (rogues)</li><li><b>Lamplighter</b>: more lantern oil against guardians (necromancers)</li></ul><p>The bonus grows with the companion’s level, and is half again bigger when the job suits their class. Train them at camp now and then to keep it climbing. A companion who joins your party leaves their job.</p>'],
    ['Campfire and Players Guild', '<p>Your party has five seats, and there are two ways to fill them, both in the Party tab.</p><p><b>Campfire</b>: story companions join you as the story moves forward and rest by the fire. Press <b>Bring along</b> to seat one, or <b>To campfire</b> on a seat to send them back. The Campfire also shows who joins next.</p><p><b>Players Guild</b>: heroes made by other players, stronger than story companions. Sign in with a free account, press <b>Browse the guild</b>, then <b>Recruit</b> to fill an empty seat. Heroes marked <b>Online now</b> belong to players who are playing right now. Press <b>Dismiss</b> on their seat to let them go. Your own hero is in the guild too, and you earn gold each time someone recruits it.</p>'],
    ['Trading Post: market and mail', '<p>Open the <b>Trading Post</b> (the bag button at the top) to trade gear with other players. It needs a free account.</p><p><b>Market</b>: browse gear by class and buy it for gold. To sell, tap an item in your Gear tab and choose <b>Sell on market</b>. Listings last a week, and you can take yours down any time. When something sells, the gold arrives in your mailbox.</p><p><b>Mail</b>: tap an item and choose <b>Send to a player</b> to send it to someone you have recruited or chatted with. Leave the price at 0 for a gift, or set a price they pay if they accept. They can decline, and you can take an offer back until they answer.</p><p>Gold and gear are in-game only and have no real-money value.</p>'],
    ['Multiplayer and chat', '<p>With a free account your progress is saved online and works on any device.</p><p>Once you sign in, your hero appears on a board where other players can recruit it, and you earn gold each time. You can recruit their heroes too. Player heroes are stronger than story companions.</p><p><b>Chat</b> (the speech bubble) has Global, Trade and Party channels. Ctrl+click an item to link it. Tap a name to mute or report. No web links, and be kind.</p>'],
    ['Controls', '<ul><li><b>Tap the arena, Space or Enter</b>: strike</li><li><b>1 to 5</b>: use an ability</li><li><b>Ctrl+click an item</b>: link it in chat</li><li><b>Arrows on the floor header</b>: move between floors you have reached</li></ul>'],
  ];
  function openGuide() {
    modal('<div class="maphead"><div><h2>Delver’s Guide</h2><small>Everything you need to know about the descent.</small></div><button class="iconbtn" id="g-x" aria-label="Close guide">&times;</button></div>' +
      '<div class="guide">' + GUIDE.map(([t, h], i) => '<details' + (i === 0 ? ' open' : '') + '><summary>' + t + '</summary><div>' + h + '</div></details>').join('') + '</div>' +
      '<div class="row"><button class="btn ghost" id="g-notes">What\u2019s new</button><button class="btn ghost" id="g-tut">Replay the tutorial</button><button class="btn" id="g-ok">Close</button></div>', md => {
        md.querySelector('#g-notes').onclick = openNotes;
        md.querySelector('#g-x').onclick = closeModal; md.querySelector('#g-ok').onclick = closeModal;
        md.querySelector('#g-tut').onclick = () => { S.tut = { i: 0, done: false }; coachCtx = null; closeModal(); switchTab('party'); save(); };
      });
  }
  $('btn-guide').addEventListener('click', openGuide);

  // ---------- patch notes ----------
  // Newest first. Bump `v` for each release; players see the notes once after updating.
  const PATCH_NOTES = [
    { v: 12, date: 'November 22, 2026', title: 'Skill trees, Kindling and a full set of gear slots', items: [
      'Every class now has a skill tree for your hero, with three branches of three skills each.',
      'Rekindling gives Kindling: 2 at floor 50, plus 1 for every 10 floors deeper. If you rekindled before today, you already have 2 for each time.',
      'Spend Kindling on skills, a bigger pack, extra rings (up to 5) and a second trinket slot for any character.',
      'Gear now has real slots: main hand, offhand, helmet, trinket, chest, legs, feet and rings. Robes cover the chest and legs together. Your old weapons, armor and trinkets moved into their new slots.',
      'At camp the party sits around a campfire. Nobody fights while you rest, and everyone heals up.',
      'The side panel is split into Party, Camp, Gear, Skills, Market and Codex, so there is far less scrolling.',
      'Rare gear can carry a camp-job bonus, marked with an orange dot. It boosts that job while the wearer works it at the campfire.',
      'Six new job sets, one for each camp job, drop very rarely from guardians and chests from floor 20. Two pieces give +40% to that job, three give +100%.'] },
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
  const trade = { view: 'market', cls: null, mine: false, list: null, mail: null, msg: '', busy: false };
  const tradeItem = it => L.normItem({ cls: it.cls, slot: it.slot, rar: it.rar, set: it.set || undefined, jset: it.jset || undefined, aff: it.aff || undefined, ilvl: it.ilvl, up: it.up || 0 });
  const fromServer = it => Object.assign(tradeItem(it), { uid: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
  const bagFull = () => S.bag.length >= L.bagCap(S);
  const tradeTile = it => (L.normItem(it), '<div class="tile r-' + it.rar + '"><img class="iimg" src="' + SP.itemIcon(it.cls, it.slot, it.rar) + '" alt="">' + (it.up ? '<i class="upn">+' + it.up + '</i>' : '') + '</div>');
  const tradeName = it => esc(L.gearName(it)) + (it.up ? ' +' + it.up : '');
  const tradeSub = it => (L.normItem(it), 0) || L.RARITY.find(r => r.id === it.rar).name + ' ' + L.CLASSES[it.cls].name.toLowerCase() + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; ' + itemEffect(it);
  const tradeErr = (e, what) => {
    const c = e && e.code;
    if (what === 'send' && e && e.status === 404) return 'That player could not be found. They may need to sign in again.';
    if (what === 'send' && e && e.status === 400) return 'That offer could not be sent. You may have 20 offers waiting already.';
    return c === 'full' ? (what === 'list' ? 'You have 10 items listed already. Cancel one first.' : 'You have 20 offers waiting already. Recall one first.')
      : c === 'gone' || (e && e.status === 404) ? 'That is no longer available.'
      : c === 'nobody' ? 'That player has not published a hero yet.'
      : e && e.status === 401 ? 'Sign in again to trade.' : 'The Trading Post could not be reached. Try again in a moment.';
  };
  function takeFromBag(uid) {
    const it = L.itemOf(S, uid); if (!it) return null;
    const w = L.wearer(S, uid); if (w) L.unequip(S, w, it.slot);
    S.bag = S.bag.filter(x => x.uid !== uid);
    return it;
  }
  function afterTrade() { save(); try { pushCloud(true); } catch (e) {} updateGear(true); updateSeats(true); }

  async function loadMarket() {
    trade.list = null; trade.msg = 'Opening the stalls…'; paintTrade();
    try { const r = await chatCall('GET', '/market?' + (trade.mine ? 'mine=1' : 'cls=' + trade.cls)); trade.list = r.listings || []; trade.me = r.me; trade.msg = ''; }
    catch (e) { trade.msg = tradeErr(e); }
    paintTrade();
  }
  async function loadMail(quiet) {
    if (!quiet) { trade.msg = 'Checking your mail…'; paintTrade(); }
    try { trade.mail = await chatCall('GET', '/mail'); trade.msg = ''; } catch (e) { if (!quiet) trade.msg = tradeErr(e); }
    const n = trade.mail ? trade.mail.inbox.length : 0;
    $('tradedot').hidden = !n; $('tradedot').textContent = n > 9 ? '9+' : n;
    if (!quiet) paintTrade();
  }

  function openTrade(view) {
    if (!CL) return;
    if (!signedIn()) { toast('lock', 'Sign in to trade', 'The market and mail need a free account.', 'warn'); authForm('in'); return; }
    if (view) trade.view = view;
    if (!trade.cls) { const m = L.memberById(gearWho || 'you'); trade.cls = m ? m.cls : 'tank'; }
    paintTrade();
    if (trade.view === 'market') loadMarket(); else loadMail();
  }
  function paintTrade() {
    const seg = '<div class="seg tradeseg"><button data-tv="market"' + (trade.view === 'market' ? ' class="on"' : '') + '>Market</button><button data-tv="mail"' + (trade.view === 'mail' ? ' class="on"' : '') + '>Mailbox' + (trade.mail && trade.mail.inbox.length ? ' <em>' + trade.mail.inbox.length + '</em>' : '') + '</button></div>';
    let h = '<div class="maphead"><div><h2>Trading Post</h2><small>Trade gear with other players for gold. To sell or send something, tap it in your Gear tab.</small></div><button class="iconbtn" id="t-x" aria-label="Close">&times;</button></div>' + seg;
    if (trade.view === 'market') {
      h += '<div class="whoseg tradecls">' + L.CLASS_ORDER.map(c => '<button class="whochip c-' + c + (!trade.mine && trade.cls === c ? ' on' : '') + '" data-tc="' + c + '"><img src="' + SP.spriteURL(c, 2) + '" alt=""><span>' + L.CLASSES[c].name + '</span></button>').join('') +
        '<button class="whochip' + (trade.mine ? ' on' : '') + '" data-tc="mine"><span>My listings</span></button></div>';
      if (trade.msg) h += '<p class="note">' + esc(trade.msg) + '</p>';
      if (trade.list) {
        h += trade.list.length ? '<div class="tlist">' + trade.list.map(l => {
          const mine = trade.mine || l.seller === trade.me;
          return '<div class="trow">' + tradeTile(l.item) + '<div class="tinfo"><b class="r-' + l.item.rar + '">' + tradeName(l.item) + '</b><small>' + tradeSub(l.item) + '</small><small>' + (mine ? 'Your listing' : 'Sold by ' + esc(l.name)) + '</small></div>' +
            '<div class="tact"><span class="price">' + icon('coin') + fmt(l.price) + '</span>' +
            (mine ? '<button class="btn ghost small" data-tcancel="' + l.id + '" data-tcls="' + l.cls + '">Take down</button>' : '<button class="btn small" data-tbuy="' + l.id + '" data-tcls="' + l.cls + '"' + (l.price > S.gold ? ' disabled title="Not enough gold"' : '') + '>Buy</button>') + '</div></div>';
        }).join('') + '</div>' : '<p class="note">' + (trade.mine ? 'You have nothing for sale. Tap an item in your Gear tab and choose Sell on market.' : 'No ' + L.CLASSES[trade.cls].name.toLowerCase() + ' gear for sale right now.') + '</p>';
      }
    } else {
      if (trade.msg) h += '<p class="note">' + esc(trade.msg) + '</p>';
      const mb = trade.mail;
      if (mb) {
        const letters = mb.inbox.filter(l => l.type !== 'offer'), offers = mb.inbox.filter(l => l.type === 'offer');
        h += '<h3 class="sub">Inbox</h3>';
        if (!mb.inbox.length) h += '<p class="note">Nothing new. Players can send you gear as a gift or with a price you can accept.</p>';
        if (letters.length > 1) h += '<div class="row"><button class="btn small" id="t-claimall">Collect all (' + letters.length + ')</button></div>';
        h += '<div class="tlist">' + letters.map(l => {
          const what = l.type === 'sale' ? esc(l.fromName) + ' bought your ' + tradeName(l.item) + '.'
            : l.type === 'payment' ? esc(l.fromName) + ' accepted your offer and paid for ' + tradeName(l.item) + '.'
            : esc(l.fromName) + ' declined your offer. Your ' + tradeName(l.item) + ' came back.';
          return '<div class="trow">' + tradeTile(l.item) + '<div class="tinfo"><b>' + (l.type === 'return' ? 'Returned' : 'Gold for you') + '</b><small>' + what + '</small></div><div class="tact">' + (l.gold ? '<span class="price">' + icon('coin') + fmt(l.gold) + '</span>' : '') + '<button class="btn small" data-tclaim="' + l.id + '">Collect</button></div></div>';
        }).join('') + offers.map(l => '<div class="trow">' + tradeTile(l.item) + '<div class="tinfo"><b class="r-' + l.item.rar + '">' + tradeName(l.item) + '</b><small>' + tradeSub(l.item) + '</small><small>From ' + esc(l.fromName) + (l.note ? ': “' + esc(l.note) + '”' : '') + '</small></div><div class="tact">' +
          (l.price ? '<span class="price">' + icon('coin') + fmt(l.price) + '</span>' : '<span class="gift">Gift</span>') +
          '<button class="btn small" data-taccept="' + l.id + '"' + (l.price > S.gold ? ' disabled title="Not enough gold"' : '') + '>' + (l.price ? 'Pay and take' : 'Accept') + '</button><button class="btn ghost small" data-tdecline="' + l.id + '">Decline</button></div></div>').join('') + '</div>';
        if (mb.outbox.length) h += '<h3 class="sub">Waiting for an answer</h3><div class="tlist">' + mb.outbox.map(l => '<div class="trow">' + tradeTile(l.item) + '<div class="tinfo"><b class="r-' + l.item.rar + '">' + tradeName(l.item) + '</b><small>To ' + esc(l.toName) + (l.price ? ' for ' + fmt(l.price) + ' gold' : ' as a gift') + '</small></div><div class="tact"><button class="btn ghost small" data-trecall="' + l.id + '">Take back</button></div></div>').join('') + '</div>';
      }
    }
    h += '<p class="note small">Trades are between players. Gold and gear are in-game only and have no real-money value.</p>';
    if ($('modal').hidden || !$('modalbody').querySelector('.tradepost')) modal('<div class="tradepost"></div>', md => md.className = 'sheet wide');
    const box = $('modalbody').querySelector('.tradepost'); if (box) box.innerHTML = h;
  }
  async function tradeAct(fn, what) {
    if (trade.busy) return; trade.busy = true;
    try { await fn(); } catch (e) { toast('lock', 'Trade did not go through', tradeErr(e, what), 'warn'); }
    trade.busy = false;
  }
  $('modalbody').addEventListener('click', e => {
    if (!$('modalbody').querySelector('.tradepost')) return;
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (t.id === 't-x') { closeModal(); return; }
    if (d.tv) { trade.view = d.tv; trade.msg = ''; paintTrade(); d.tv === 'market' ? loadMarket() : loadMail(); return; }
    if (d.tc) { if (d.tc === 'mine') trade.mine = true; else { trade.mine = false; trade.cls = d.tc; } loadMarket(); return; }
    if (d.tbuy) tradeAct(async () => {
      const l = trade.list.find(x => x.id === d.tbuy); if (!l) return;
      if (bagFull()) { toast('bag', 'Your pack is full', 'Salvage something first.', 'warn'); return; }
      if (l.price > S.gold) return;
      const r = await chatCall('POST', '/market/buy', { id: l.id, cls: l.cls, name: S.hero.name });
      S.gold -= r.price; S.bag.push(fromServer(r.item)); afterTrade(); sfx.coin();
      toast('bag', 'Bought ' + L.gearName(r.item), 'It is in your pack now.', 'feat'); loadMarket();
    });
    if (d.tcancel) tradeAct(async () => {
      if (bagFull()) { toast('bag', 'Your pack is full', 'Salvage something first, then take your listing down.', 'warn'); return; }
      const r = await chatCall('POST', '/market/cancel', { id: d.tcancel, cls: d.tcls });
      S.bag.push(fromServer(r.item)); afterTrade(); toast('bag', 'Listing taken down', 'The item is back in your pack.', ''); loadMarket();
    });
    if (d.tclaim || t.id === 't-claimall') tradeAct(async () => {
      const ids = d.tclaim ? [d.tclaim] : trade.mail.inbox.filter(l => l.type !== 'offer').map(l => l.id);
      let gold = 0, items = 0;
      for (const id of ids) {
        const l = trade.mail.inbox.find(x => x.id === id);
        if (l.type === 'return' && bagFull()) { toast('bag', 'Your pack is full', 'Salvage something to collect returned gear.', 'warn'); break; }
        const r = await chatCall('POST', '/mail/claim', { id });
        const L2 = r.letter;
        if (L2.type === 'return') { S.bag.push(fromServer(L2.item)); items++; } else { S.gold += L2.gold; S.stats.goldEarned += L2.gold; gold += L2.gold; }
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
  if (CL) {
    $('btn-trade').hidden = false;
    $('btn-trade').addEventListener('click', () => openTrade());
    setInterval(() => { if (signedIn() && !document.hidden) loadMail(true); }, 90000);
    setTimeout(() => { if (signedIn()) loadMail(true); }, 4000);
  }
  // ---------- boot ----------
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
