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
  const memberAnim = {};
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
    S.minions.forEach((m, i) => {
      const spr = sprite('minion', 0, false), x = Math.round(W * FOE_X) - 34 - i * 7, y = floorY - 16 + (i % 2) * 3;
      ctx.globalAlpha = 0.9; ctx.drawImage(spr, x, y, spr.width * 2, spr.height * 2); ctx.globalAlpha = 1;
    });
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

  function render(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; tAnim += dt;
    const nowMs = Date.now();
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
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const buyN = () => S.settings.buy === 'max' ? 'max' : +S.settings.buy;
  function classTag(cls) { return '<span class="ctag c-' + cls + '">' + L.CLASSES[cls].name + '</span>'; }
  function portrait(id) {
    const m = L.memberById(id);
    return '<div class="ic c-' + m.cls + (m.player ? ' player' : '') + '" data-prof="' + id + '" role="button" tabindex="0" title="About ' + esc(m.name) + '">' + icon(CLASS_ICON[m.cls]) + '</div>';
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
      if (!id) {
        const canFill = S.unlocked.some(x => !S.party.includes(x)) || (S.guests || []).some(g => !S.party.includes(g.id));
        html += '<div class="seat empty"><span class="pos">' + (i + 1) + '<small>' + L.POS_NAME[i] + '</small></span><div class="ic">' + icon('user') + '</div><div class="info"><div class="nm">Empty seat</div><div class="lv">' + (canFill ? 'Pick a companion below to fill it.' : 'Recruit a player or meet more companions in the story. See <b>Grow your party</b> below.') + '</div></div></div>';
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
        '<div class="hpbar"><i data-hp="' + id + '"></i></div></div>' + btn +
        (id !== 'you' && !guest ? '<button class="mini x" data-unseat="' + i + '" title="Send to camp" aria-label="Send to camp">&times;</button>' : '') + '</div>';
    }
    if (html !== seatsHtml) {
      box.innerHTML = html; seatsHtml = html;
      $('fnotes').innerHTML = L.formationNotes(S).map(n => '<li class="' + (n.warn ? 'warn' : 'ok') + '">' + esc(n.text) + '</li>').join('') + '<li class="tip">Healers heal less the farther they stand from who they heal. Some monsters ambush from behind and hit the rear first; a tank at the back guards it.</li>';
    }
    paintHp();
    const bench = S.unlocked.filter(x => !S.party.includes(x));
    $('benchwrap').hidden = !bench.length;
    const benchHtml = bench.map(id => {
      const m = L.memberById(id);
      return '<div class="seat bench">' + portrait(id) + '<div class="info"><div class="nm"><a class="pname" data-prof="' + id + '">' + esc(m.name) + '</a> ' + classTag(m.cls) + '</div><div class="lv">' + esc(m.title) + ' &middot; Level ' + L.lvl(S, id) + '</div><div class="line">' + esc(m.line) + '</div></div><button class="btn small" data-seat="' + id + '">Bring along</button></div>';
    }).join('');
    if ($('bench').dataset.h !== benchHtml) { $('bench').innerHTML = benchHtml; $('bench').dataset.h = benchHtml; }
  }
  $('tab-party').addEventListener('click', e => {
    const pf = e.target.closest('[data-prof]'); if (pf) { profileModal(pf.dataset.prof); return; }
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.move) { const [i, d] = t.dataset.move.split(':').map(Number); if (L.moveMember(S, i, i + d)) { sfx.buy(); updateSeats(true); updateAbilities(true); } return; }
    if (t.id === 'f-auto') { L.autoFormation(S); S.formationManual = false; sfx.buy(); updateSeats(true); updateAbilities(true); toast('shield', 'Party arranged', 'Tank in front, rogue behind it, healers in the middle where they reach everyone, casters at the back.', ''); return; }
    if (t.dataset.train) { if (L.train(S, t.dataset.train, buyN())) { sfx.buy(); updateSeats(true); } }
    else if (t.dataset.unseat) { L.unseat(S, +t.dataset.unseat); updateSeats(true); updateAbilities(true); paintBoard(); }
    else if (t.dataset.seat) pickSeat(t.dataset.seat);
    else if (t.dataset.dismiss) { L.dismissGuest(S, t.dataset.dismiss); updateSeats(true); updateAbilities(true); paintBoard(); }
    else if (t.dataset.recruit) recruitPlayer(t.dataset.recruit);
    else if (t.id === 'b-find') findHeroes();
    else if (t.id === 'b-signin') openAccount();
    else if (t.id === 'b-gomulti') goMulti();
    else if (t.id === 'f-recruit') { const g = $('grow'); g && g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  function pickSeat(id) {
    const empty = S.party.indexOf(null);
    if (empty >= 0) { L.seat(S, id, empty); updateSeats(true); updateAbilities(true); return; }
    const m = L.memberById(id);
    modal('<h2>Who stays at camp?</h2><p>' + esc(m.name) + ' takes their seat.</p><div class="choice">' +
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
    const met = S.unlocked.filter(id => id !== 'you' && !L.isGuest(S, id)).length;
    const nc = nextCompanion();
    let h = '<h3 class="sub" id="grow">Grow your party</h3><div class="grow">';
    // Story companions
    h += '<div class="growcard"><div class="gh">' + icon('user') + '<b>Story companions</b></div>' +
      '<p>Companions join on their own as the story moves forward. You have met <b>' + met + '</b> so far. Anyone not in a seat waits at camp above, and you can swap them in any time.</p>' +
      (nc ? '<p class="next">Next to join: <b>' + esc(nc.name) + '</b> ' + classTag(nc.cls) + '<br><small>Keep following your goal: ' + esc(L.currentGoal(S)) + '.</small></p>' : '<p class="next">You have met every story companion.</p>') + '</div>';
    // Other players
    h += '<div class="growcard"><div class="gh">' + icon('users') + '<b>Recruit other players</b></div>';
    if (S.mode !== 'multi') {
      h += '<p>Other players’ heroes are stronger than story companions. To recruit them, switch this game to <b>Multiplayer</b> and sign in with a free account. Your progress, gear and companions all stay.</p>' +
        '<button class="btn small" id="b-gomulti">Switch to Multiplayer</button>';
    } else if (!CL) {
      h += '<p>The hero board is not available right now. Try again later.</p>';
    } else if (!signedIn()) {
      h += '<ol class="steps"><li><b>Sign in</b> with a free account.</li><li>Press <b>Find heroes</b> to see players you can recruit.</li><li>Press <b>Recruit</b> to put one in an empty seat.</li></ol>' +
        '<button class="btn small" id="b-signin">Sign in to recruit</button>';
    } else {
      h += '<ol class="steps"><li>Press <b>Find heroes</b> to see players you can recruit.</li><li>Press <b>Recruit</b> to put one in an empty seat. They fight at the level their owner trained them to.</li><li>Your own hero is on the board too, and you earn gold each time someone recruits it.</li></ol>' +
        (open ? '<p class="note">' + open + (open === 1 ? ' seat is' : ' seats are') + ' open.</p>' : '<p class="note warnline">All five seats are full. Press &times; on a companion to send them to camp and make room.</p>') +
        '<button class="btn small" id="b-find">' + (boardList ? 'Find different heroes' : 'Find heroes') + '</button>';
      if (boardMsg) h += '<p class="note">' + esc(boardMsg) + '</p>';
      if (boardList) h += '<div class="board">' + boardList.map(g => '<div class="seat bench"><div class="ic c-' + g.cls + ' player">' + icon(CLASS_ICON[g.cls]) + '</div><div class="info"><div class="nm">' + esc(g.name) + ' ' + classTag(g.cls) + '</div><div class="lv">Level ' + g.level + ' &middot; reached floor ' + g.floor + '</div></div>' +
        ((S.guests || []).some(x => x.id === 'p_' + g.id) ? '<span class="muted">In party</span>' : '<button class="btn small" data-recruit="' + g.id + '">Recruit</button>') + '</div>').join('') + '</div>';
      if ((S.guests || []).length) h += '<p class="note">To let a player’s hero go, press Dismiss on their seat.</p>';
    }
    w.innerHTML = h + '</div></div>';
  }
  function goMulti() {
    modal('<h2>Switch to Multiplayer?</h2><p>Your hero joins the board where other players can recruit it, and you can recruit theirs. Everything you have now stays: floors, gold, gear and companions.</p><p class="note">This needs a free account. You can play on without one, but recruiting needs sign-in.</p><div class="row"><button class="btn" id="m-yes">Switch</button><button class="btn ghost" id="m-no">Not now</button></div>', md => {
      md.querySelector('#m-no').onclick = closeModal;
      md.querySelector('#m-yes').onclick = () => {
        S.mode = 'multi'; save();
        closeModal(); sfx.buy();
        toast('users', 'Multiplayer on', signedIn() ? 'Press Find heroes to recruit other players.' : 'Sign in to start recruiting other players.', 'feat');
        if (signedIn()) publishHero(); else if (CL) setTimeout(() => authForm('in'), 300);
        paintBoard();
      };
    });
  }
  async function findHeroes() {
    boardMsg = 'Looking for heroes…'; paintBoard();
    try { const r = await api('GET', null, '/heroes'); boardList = (r && r.heroes) || []; boardMsg = boardList.length ? '' : 'No other heroes yet. Check back soon.'; }
    catch (e) { boardMsg = 'Could not reach the hero board. Try again in a moment.'; }
    paintBoard();
  }
  async function recruitPlayer(gid) {
    const g = (boardList || []).find(x => x.id === gid); if (!g) return;
    if (!S.party.includes(null)) { toast('user', 'No empty seat', 'Send a companion to camp first, then recruit.', 'warn'); return; }
    L.addGuest(S, { id: 'p_' + g.id, name: g.name, cls: g.cls, level: g.level });
    try { await api('POST', { heroId: g.id }, '/recruit'); } catch (e) {}
    toast('user', g.name + ' joins your party', 'A ' + L.CLASSES[g.cls].name + ' at level ' + g.level + '.', 'feat');
    updateSeats(true); updateAbilities(true); paintBoard();
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
  function itemEffect(it) {
    const p = L.gearPct(it), pct = v => '+' + Math.round(v * 100) + '%';
    if (it.slot === 'weapon') return pct(p) + ' damage' + (it.cls === 'healer' ? ' and healing' : '');
    if (it.slot === 'armor') return pct(p) + ' health';
    return it.cls === 'healer' ? pct(p) + ' healing, ' + pct(p / 2) + ' health' : pct(p / 2) + ' damage and health';
  }
  function itemChip(it, extra, cls) {
    const w = L.wearer(S, it.uid);
    return '<div class="item r-' + it.rar + (cls ? ' ' + cls : '') + '" data-item="' + it.uid + '" role="button" tabindex="0">' + icon(SLOT_ICON[it.slot]) + '<span><b>' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</b><small>' + L.SLOT_NAME[it.slot] + ' &middot; ' + itemEffect(it) + (w ? ' &middot; <i class="worn">worn by ' + esc(L.memberById(w).name) + '</i>' : '') + '</small></span>' + (extra || '') + '</div>';
  }
  // How an item compares to what this member wears in that slot, in gear percent.
  function compareTag(it, id) {
    const cur = (S.gear[id] || {})[it.slot], ci = cur && L.itemOf(S, cur);
    if (ci && ci.uid === it.uid) return '<span class="cmp eq">Equipped</span>';
    const d = Math.round((L.gearPct(it) - (ci ? L.gearPct(ci) : 0)) * 100);
    return d > 0 ? '<span class="cmp up">&#9650; ' + d + '% better</span>' : d < 0 ? '<span class="cmp down">&#9660; ' + (-d) + '% worse</span>' : '<span class="cmp eq">Same</span>';
  }
  const gearOwners = () => S.unlocked.filter(id => { const m = L.memberById(id); return m && !m.guest; });
  function updateGear(force) {
    const who = gearOwners();
    if (!who.includes(gearWho)) gearWho = who[0];
    $('gearcount').textContent = S.bag.length ? S.bag.length : '';
    if (!gearWho) return;
    const key = gearWho + '|' + S.bag.length + '|' + JSON.stringify(S.gear) + '|' + S.bag.map(x => x.up).join('') + '|' + S.unlocked.length + '|' + Math.floor(S.gold);
    if (!force && key === gearKey) return; gearKey = key;
    $('gearwho').innerHTML = who.map(id => {
      const m = L.memberById(id), n = Object.keys(L.betterFor(S, id)).length;
      return '<button class="whochip c-' + m.cls + (id === gearWho ? ' on' : '') + '" data-who="' + id + '">' + icon(CLASS_ICON[m.cls]) + '<span>' + esc(m.name) + '</span>' + (n ? '<em title="Better gear in your pack">' + n + '</em>' : '') + '</button>';
    }).join('');
    const m = L.memberById(gearWho), g = S.gear[gearWho] || {}, cname = L.CLASSES[m.cls].name;
    const set = L.SETS.find(x => x.cls === m.cls), sc = L.setCount(S, gearWho, set.id);
    const better = L.betterFor(S, gearWho), nb = Object.keys(better).length;
    let h = '<div class="gearhead">' + portrait(gearWho) + '<div><b>' + esc(m.name) + '</b> ' + classTag(m.cls) + '<small>Can wear <b>' + cname + '</b> gear only. Tap any piece for details.</small></div>' +
      '<button class="btn small" id="g-best"' + (nb ? '' : ' disabled') + '>' + (nb ? 'Equip best (' + nb + ')' : 'Best gear on') + '</button></div>';
    h += L.SLOTS.map(sl => {
      const it = g[sl] && L.itemOf(S, g[sl]);
      const hint = better[sl] ? '<span class="cmp up">Upgrade in pack</span>' : '';
      return '<div class="slot"><span class="slab">' + L.SLOT_NAME[sl] + '</span>' + (it ? itemChip(it, hint) : '<div class="item none">' + icon(SLOT_ICON[sl]) + '<span><b>Empty</b><small>' + (better[sl] ? 'You have one in your pack.' : 'No ' + cname.toLowerCase() + ' ' + L.SLOT_NAME[sl].toLowerCase() + ' found yet.') + '</small></span>' + hint + '</div>') + '</div>';
    }).join('') + '<div class="setinfo' + (sc ? ' on' : '') + '"><b>' + set.name + '</b> <span>' + sc + '/3</span><small>' + cname + ' set. 2 pieces: ' + set.two + '. 3 pieces: ' + set.three + '.</small></div>';
    $('gearslots').innerHTML = h;
    $('bagcount').textContent = S.bag.length + '/' + L.GEAR_CAP;
    const fits = S.bag.filter(it => it.cls === m.cls).sort((a, b) => L.gearPct(b) - L.gearPct(a));
    const others = S.bag.filter(it => it.cls !== m.cls);
    let bh = '<h4 class="packh">Fits ' + esc(m.name) + ' <em>' + fits.length + '</em></h4>';
    bh += fits.length ? fits.map(it => {
      const mine = L.wearer(S, it.uid) === gearWho;
      return itemChip(it, compareTag(it, gearWho) + (mine ? '' : '<button class="btn small" data-equip="' + it.uid + '">Equip</button>'), mine ? 'mine' : '');
    }).join('') : '<p class="note">No ' + cname.toLowerCase() + ' gear in your pack yet.</p>';
    if (others.length) {
      bh += '<details class="others"><summary>Other classes <em>' + others.length + '</em> <small>Gear for the rest of your roster. Pick that companion above to equip it.</small></summary>';
      for (const c of L.CLASS_ORDER) {
        const list = others.filter(it => it.cls === c); if (!list.length) continue;
        const owners = who.filter(id => L.memberById(id).cls === c).map(id => esc(L.memberById(id).name));
        bh += '<div class="ogroup"><span class="slab">' + L.CLASSES[c].name + ' gear' + (owners.length ? ' &middot; for ' + owners.join(', ') : ' &middot; nobody can wear this yet') + '</span>' + list.map(it => itemChip(it, '', 'dim')).join('') + '</div>';
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
    const eq = e.target.closest('[data-equip]'); if (eq) { if (L.equip(S, gearWho, eq.dataset.equip)) { sfx.buy(); updateGear(true); updateSeats(true); } return; }
    if (e.target.closest('#g-best')) { const n = L.equipBest(S, gearWho); if (n) { sfx.buy(); toast('gear-armor', 'Best gear on', n + (n === 1 ? ' piece' : ' pieces') + ' equipped on ' + L.memberById(gearWho).name + '.', ''); updateGear(true); updateSeats(true); } return; }
    if (e.target.closest('.gearhead .ic')) { profileModal(gearWho); return; }
    const it = e.target.closest('[data-item]'); if (it) { if ((e.ctrlKey || e.metaKey) && linkItem(L.itemOf(S, it.dataset.item))) return; itemModal(it.dataset.item); }
  });
  ['tab-gear', 'tab-party'].forEach(t => $(t).addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-item],[data-prof]')) { e.preventDefault(); e.target.click(); } }));
  function itemModal(uid) {
    const it = L.itemOf(S, uid); if (!it) return;
    let m = L.memberById(gearWho), w = L.wearer(S, uid);
    if (m.cls !== it.cls) { const o = gearOwners().find(id => L.memberById(id).cls === it.cls); if (o) { gearWho = o; m = L.memberById(o); } }
    const set = it.set && L.SETS.find(x => x.id === it.set);
    const fits = m.cls === it.cls;
    const cost = L.upgradeCost(it), maxed = it.up >= L.UP_MAX;
    modal('<div class="itemhead r-' + it.rar + '">' + icon(SLOT_ICON[it.slot]) + '<div><h2>' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</h2><small>' + L.RARITY.find(r => r.id === it.rar).name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; ' + L.CLASSES[it.cls].name + ' only &middot; found on floor ' + it.ilvl + '</small></div></div>' +
      '<p class="effect">' + itemEffect(it) + '</p>' +
      (set ? '<div class="setinfo on"><b>' + set.name + '</b><small>2 pieces: ' + set.two + '. 3 pieces: ' + set.three + '.</small><small class="lore">' + esc(set.lore) + '</small></div>' : '') +
      (w ? '<p>Worn by ' + esc(L.memberById(w).name) + '.</p>' : fits ? '<p>' + compareTag(it, gearWho) + ' than what ' + esc(m.name) + ' wears now.</p>' : '') +
      '<div class="row">' +
      (w ? '<button class="btn ghost" id="i-off">Take off</button>' : fits ? '<button class="btn" id="i-on">Equip on ' + esc(m.name) + '</button>' : '<button class="btn" disabled>No ' + L.CLASSES[it.cls].name + ' in your roster yet</button>') +
      '<button class="btn ghost" id="i-up"' + (maxed || cost > S.gold ? ' disabled' : '') + '>' + (maxed ? 'Fully upgraded' : 'Upgrade for ' + fmt(cost) + ' gold') + '</button>' +
      '<button class="btn danger" id="i-sell">Salvage for ' + fmt(L.salvageValue(it)) + '</button></div>' +
      '<div class="row">' + (CL ? '<button class="btn ghost" id="i-link">Link in chat</button>' : '') + '<button class="btn ghost" id="i-close">Close</button></div>', md => {
        const lk = md.querySelector('#i-link'); if (lk) lk.onclick = () => { closeModal(); linkItem(it); };
        const re = () => { updateGear(true); updateSeats(true); itemModal(uid); };
        const on = md.querySelector('#i-on'); if (on) on.onclick = () => { L.equip(S, gearWho, uid); sfx.buy(); re(); };
        const off = md.querySelector('#i-off'); if (off) off.onclick = () => { L.unequip(S, w, it.slot); re(); };
        md.querySelector('#i-up').onclick = () => { if (L.upgrade(S, uid)) { sfx.relic(); re(); } };
        md.querySelector('#i-sell').onclick = () => { const v = L.salvage(S, uid); sfx.coin(); closeModal(); updateGear(true); toast('coin', 'Salvaged', '+' + fmt(v) + ' gold', ''); };
        md.querySelector('#i-close').onclick = closeModal;
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
    const gearList = L.SLOTS.map(sl => { const it = gear[sl] && L.itemOf(S, gear[sl]); return '<li><span>' + L.SLOT_NAME[sl] + '</span>' + (it ? '<b class="r-' + it.rar + '">' + esc(L.gearName(it)) + (it.up ? ' +' + it.up : '') + '</b>' : '<i>Empty</i>') + '</li>'; }).join('');
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
        const st = md.querySelector('#p-seat'); if (st) st.onclick = () => { closeModal(); pickSeat(id); };
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
    $('btn-rekindle').disabled = e <= 0;
    $('rekindlenote').textContent = S.maxFloor < L.REKINDLE_FLOOR ? 'Reach floor ' + L.REKINDLE_FLOOR + ' on this descent to rekindle. You are on floor ' + S.maxFloor + '.'
      : 'Deeper floors give more Embers. Most delvers rekindle when progress slows down.';
  }
  $('btn-rekindle').addEventListener('click', () => {
    const e = L.embersFor(S); if (e <= 0) return;
    modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Rekindle now?</h2><p>Gold, floors and training reset to the start. You keep your companions, gear, relics, story and feats, and gain <b style="color:var(--ember)">' + fmt(e) + ' Embers</b> for +' + fmt(e * 10) + '% damage and gold.</p><div class="row" style="justify-content:center"><button class="btn ghost" id="m-no">Not yet</button><button class="btn" id="m-yes">Rekindle</button></div></div>', m => {
      m.querySelector('#m-no').onclick = closeModal;
      m.querySelector('#m-yes').onclick = () => {
        const got = L.rekindle(S); closeModal(); sfx.relic(); save();
        toast('flame', 'The lantern burns brighter', '+' + fmt(got) + ' Embers. The descent begins again.', 'feat');
        $('auto').checked = true; switchTab('party'); updatePanel(true); updateAbilities(true);
      };
    });
  });

  // ---------- tabs ----------
  let tab = 'party';
  function switchTab(t) {
    tab = t;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tabbody').forEach(b => b.hidden = b.id !== 'tab-' + t);
    updatePanel(true);
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // ---------- header & stage ----------
  let lastRelicCount = -1, lastFeatCount = -1, slowTick = 0;
  function updatePanel(force) {
    const now = Date.now();
    $('gold').textContent = fmt(S.gold);
    $('dps').textContent = fmt(L.totalDps(S, now));
    $('embers').textContent = fmt(S.embers);
    if (tab === 'party') { updateSeats(force); if (force) paintBoard(); }
    if (tab === 'gear') updateGear(force);
    if (tab === 'journal' && force) updateJournal();
    if (tab === 'relics' && (force || lastRelicCount !== Object.keys(S.relics).length)) updateRelics();
    if (tab === 'stats') { if (force || lastFeatCount !== L.featCount(S)) updateFeats(); updateLedger(); }
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
    let mode = 'solo', cls = 'rogue', side = 'covenant';
    $('modal').dataset.lock = '1';
    const draw = () => modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Lanternhold</h2></div>' +
      (note ? '<p class="center">' + note + '</p>' : '<p class="center">The Grand War burns across the Shattered Reach. Beneath a forgotten Hold, a single lantern keeps a tear in the Nyx Rift shut, and every alliance wants what lies under it. Take the lantern down.</p>') +
      '<h3 class="sub">How do you want to play?</h3><div class="modes">' +
      '<button class="pick' + (mode === 'solo' ? ' on' : '') + '" data-mode="solo"><b>Solo</b><small>Your hero and the companions you meet in the story.</small></button>' +
      '<button class="pick' + (mode === 'multi' ? ' on' : '') + '" data-mode="multi"><b>Multiplayer</b><small>Also recruit other players’ heroes, who are stronger than story companions. Needs a free account.</small></button></div>' +
      '<h3 class="sub">Choose your class</h3><div class="classes">' + L.CLASS_ORDER.map(c => '<button class="pick cls' + (cls === c ? ' on' : '') + '" data-cls="' + c + '"><span class="ic c-' + c + '">' + icon(CLASS_ICON[c]) + '</span><b>' + L.CLASSES[c].name + '</b><small>' + CLASS_BLURB[c] + '</small></button>').join('') + '</div>' +
      '<h3 class="sub">Pledge your banner</h3><div class="sides">' + L.SIDE_ORDER.map(k => { const d = L.SIDES[k]; return '<button class="pick side' + (side === k ? ' on' : '') + '" data-side="' + k + '" style="--side:' + d.color + '"><b>' + d.name + '</b><i>\u201c' + d.motto + '\u201d</i><small>' + d.desc + '</small><em>' + d.perk + '</em></button>'; }).join('') + '</div>' +
      '<h3 class="sub">Name your hero</h3><input id="h-name" maxlength="16" placeholder="2 to 16 letters" autocomplete="off"><div class="err" id="h-err"></div>' +
      '<div class="row" style="justify-content:center"><button class="btn big" id="h-go">Begin the descent</button></div>', md => {
        const nm = md.querySelector('#h-name'); nm.value = setup.heroName || '';
        nm.oninput = () => { setup.heroName = nm.value; };
        md.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; draw(); });
        md.querySelectorAll('[data-cls]').forEach(b => b.onclick = () => { cls = b.dataset.cls; draw(); });
        md.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { side = b.dataset.side; draw(); });
        md.querySelector('#h-go').onclick = () => {
          const name = nm.value.trim().replace(/\s+/g, ' ');
          if (!/^[A-Za-z][A-Za-z '\-]{1,15}$/.test(name)) { md.querySelector('#h-err').textContent = 'Use 2 to 16 letters. Spaces, hyphens and apostrophes are fine.'; return; }
          L.startGame(S, mode, cls, name, side);
          delete $('modal').dataset.lock; closeModal(); audio(); save();
          updateSeats(true); updateAbilities(true); updatePanel(true);
          if (mode === 'multi' && CL && !signedIn()) setTimeout(() => authForm('up'), 300);
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
  const ITEM_TOKEN = /\[\[i:(tank|healer|rogue|mage|necro),(weapon|armor|trinket),(common|fine|rare|epic|set),([a-z]{0,8}),(\d{1,6}),(\d{1,2})\]\]/g;
  const tokenOf = it => '[[i:' + it.cls + ',' + it.slot + ',' + it.rar + ',' + (it.set || '') + ',' + it.ilvl + ',' + (it.up || 0) + ']]';
  const itemLabel = it => L.gearName(it) + (it.up ? ' +' + it.up : '');
  function itemFromToken(m) {
    const it = { cls: m[1], slot: m[2], rar: m[3], set: m[4] || undefined, ilvl: +m[5], up: Math.min(+m[6], L.UP_MAX) };
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
    modal('<div class="itemhead r-' + it.rar + '">' + icon(SLOT_ICON[it.slot]) + '<div><h2>' + esc(itemLabel(it)) + '</h2><small>' + rar.name + ' ' + L.SLOT_NAME[it.slot].toLowerCase() + ' &middot; ' + L.CLASSES[it.cls].name + ' only &middot; found on floor ' + it.ilvl + '</small></div></div>' +
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
    { id: 'train', title: 'Train your party', text: 'Spend gold to train a companion. Higher levels mean more damage, health and healing. Train whoever is cheapest to start.', target: '#seats .buy:not([disabled])', tab: 'party', ready: () => S.gold >= 10, done: c => sumLevels() > c.levels, noNext: true },
    { id: 'abil', title: 'Abilities', text: 'Each class has a special move. They fire by themselves, or press keys 1 to 5 (or tap them) to use one right when you need it.', target: '#abilities', ready: () => true },
    { id: 'order', title: 'Marching order', text: 'The top of this list stands at the front. Keep your tank up front, healers in the middle so they reach everyone, and watch the back for ambushes.', target: '.formhead', tab: 'party', ready: () => S.party.filter(Boolean).length >= 2 },
    { id: 'boss', title: 'Guardians', text: 'Every fifth floor has a guardian. Beat it before the lantern oil runs out, or your party falls back to train and try again.', target: '#lanternwrap', ready: () => S.foe && S.foe.boss },
    { id: 'gear', title: 'You found gear', text: 'Monsters drop weapons, armor and trinkets. Open Gear to put them on. Each piece fits one class, and green tags show upgrades.', target: '.tabs [data-tab="gear"]', ready: () => S.bag.length > 0, done: () => tab === 'gear', noNext: true },
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
    ['Gear and sets', '<p>Gear drops from monsters, chests and guardians. Each piece fits one class and goes in a weapon, armor or trinket slot.</p><p>In the Gear tab, pick a companion to see what fits them. Green tags mean an upgrade, and <b>Equip best</b> does it all at once. Upgrade pieces with gold, or salvage what you do not need.</p><p>From floor 15, guardians can drop <b>set pieces</b>. Two or three pieces of a class set give extra bonuses.</p>'],
    ['Story, journal and map', '<p>The story unfolds as you go deeper, and new companions join along the way. Replay scenes and read everything you have learned in the <b>Journal</b>.</p><p>The <b>Map of the Deep</b> (under the floor number) shows every region, the guardians you have beaten and where you are. Tap a floor you have reached to travel there.</p>'],
    ['Relics and rekindling', '<p><b>Relics</b> are permanent bonuses that guardians sometimes drop. Duplicates level them up.</p><p>From floor 25 you can <b>rekindle</b> the lantern: start again from floor 1 and earn <b>Embers</b>. Each Ember adds 10% damage and gold forever. Your companions, gear, relics and lore stay; levels reset. Rekindle when progress slows down.</p>'],
    ['Growing your party', '<p>Your party has five seats. Press <b>Recruit</b> in the Party tab to jump to <b>Grow your party</b>.</p><p><b>Story companions</b> join on their own as the story moves forward. It shows who joins next and the goal that leads there. Companions not in a seat wait at camp, and you can swap them in any time.</p><p><b>Other players</b>: switch to Multiplayer (you keep all progress) and sign in. Press <b>Find heroes</b>, then <b>Recruit</b> to put one in an empty seat. They are stronger than story companions. Press <b>Dismiss</b> on their seat to let them go.</p>'],
    ['Multiplayer and chat', '<p>With a free account your progress is saved online and works on any device.</p><p>In <b>Multiplayer</b>, your hero appears on a board where other players can recruit it, and you earn gold each time. You can recruit their heroes too. Player heroes are stronger than story companions.</p><p><b>Chat</b> (the speech bubble) has Global, Trade and Party channels. Ctrl+click an item to link it. Tap a name to mute or report. No web links, and be kind.</p>'],
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
    { v: 7, date: 'November 22, 2026', title: 'Grow your party', items: [
      'A new Recruit button in the Party tab takes you to Grow your party.',
      'See which story companion joins next and the goal that leads to them.',
      'Solo games can switch to Multiplayer at any time without losing progress, so you can recruit other players’ heroes.',
      'Clear steps for finding and recruiting other players, and how many seats you have open.'] },
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
