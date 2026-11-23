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
    $('modalbody').innerHTML = html; $('modal').hidden = false;
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
        html += '<div class="seat empty"><span class="pos">' + (i + 1) + '<small>' + L.POS_NAME[i] + '</small></span><div class="ic">' + icon('user') + '</div><div class="info"><div class="nm">Empty seat</div><div class="lv">' + (canFill ? 'Pick a companion below to fill it.' : (S.mode === 'multi' ? 'Recruit a player or meet more companions in the story.' : 'You will meet more companions as the story goes on.')) + '</div></div></div>';
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
    else if (t.dataset.unseat) { L.unseat(S, +t.dataset.unseat); updateSeats(true); updateAbilities(true); }
    else if (t.dataset.seat) pickSeat(t.dataset.seat);
    else if (t.dataset.dismiss) { L.dismissGuest(S, t.dataset.dismiss); updateSeats(true); updateAbilities(true); }
    else if (t.dataset.recruit) recruitPlayer(t.dataset.recruit);
    else if (t.id === 'b-find') findHeroes();
    else if (t.id === 'b-signin') openAccount();
  });
  function pickSeat(id) {
    const empty = S.party.indexOf(null);
    if (empty >= 0) { L.seat(S, id, empty); updateSeats(true); updateAbilities(true); return; }
    const m = L.memberById(id);
    modal('<h2>Who stays at camp?</h2><p>' + esc(m.name) + ' takes their seat.</p><div class="choice">' +
      S.party.map((x, i) => x === 'you' || !x ? '' : '<button class="pick" data-slot="' + i + '"><b>' + esc(L.memberById(x).name) + '</b><small>' + L.CLASSES[L.memberById(x).cls].name + ', level ' + L.lvl(S, x) + '</small></button>').join('') +
      '</div><div class="row"><button class="btn ghost" id="m-cancel">Cancel</button></div>', md => {
        md.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => { L.seat(S, id, +b.dataset.slot); closeModal(); updateSeats(true); updateAbilities(true); });
        md.querySelector('#m-cancel').onclick = closeModal;
      });
  }

  // ---------- multiplayer hero board ----------
  let boardList = null, boardMsg = '';
  function paintBoard() {
    const w = $('boardwrap');
    if (S.mode !== 'multi') { w.innerHTML = ''; return; }
    let h = '<h3 class="sub">Recruit other players</h3>';
    if (!CL) h += '<p class="note">The hero board is not available right now.</p>';
    else if (!signedIn()) h += '<p class="note">Sign in to publish your hero and recruit other players’ heroes. Player heroes are stronger than story companions.</p><button class="btn small" id="b-signin">Sign in</button>';
    else {
      h += '<p class="note">Player heroes fight at the level their owner has trained them to. Their owner earns gold every time someone recruits them.</p><button class="btn small" id="b-find">' + (boardList ? 'Find different heroes' : 'Find heroes') + '</button>';
      if (boardMsg) h += '<p class="note">' + esc(boardMsg) + '</p>';
      if (boardList) h += '<div class="board">' + boardList.map(g => '<div class="seat bench"><div class="ic c-' + g.cls + ' player">' + icon(CLASS_ICON[g.cls]) + '</div><div class="info"><div class="nm">' + esc(g.name) + ' ' + classTag(g.cls) + '</div><div class="lv">Level ' + g.level + ' &middot; reached floor ' + g.floor + '</div></div>' +
        ((S.guests || []).some(x => x.id === 'p_' + g.id) ? '<span class="muted">In party</span>' : '<button class="btn small" data-recruit="' + g.id + '">Recruit</button>') + '</div>').join('') + '</div>';
    }
    w.innerHTML = h;
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
    updateSeats(true); updateAbilities(true);
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
    const it = e.target.closest('[data-item]'); if (it) itemModal(it.dataset.item);
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
      '<div class="row"><button class="btn ghost" id="i-close">Close</button></div>', md => {
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
