/* Lanternhold — browser front end. */
(function () {
  'use strict';
  const L = window.LH, SP = window.LHSprites;
  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'lanternhold.save.v1';
  const OFFLINE_CAP = 12 * 3600;

  // ---------- state ----------
  let S = load() || L.newState();
  let firstRun = !S.stats.kills && !S.heroes.some(Boolean);
  const events = [];

  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (raw) return L.migrate(JSON.parse(raw)); } catch (e) {}
    return null;
  }
  function save() {
    S.lastSeen = Date.now();
    const o = Object.assign({}, S); delete o.foe; delete o._frenzyAcc;
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
  let lastHitSound = 0;
  const sfx = {
    hit(crit) { const n = performance.now(); if (n - lastHitSound < 45) return; lastHitSound = n; tone(crit ? 220 : 150 + Math.random() * 40, 0.07, 'square', crit ? 0.05 : 0.03, 60); },
    coin() { tone(988, 0.06, 'square', 0.025); setTimeout(() => tone(1318, 0.09, 'square', 0.025), 55); },
    boss() { tone(110, 0.5, 'sawtooth', 0.05, 55); },
    relic() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.05), i * 90)); },
    fail() { tone(196, 0.3, 'triangle', 0.05, 98); },
    buy() { tone(660, 0.05, 'square', 0.02, 880); },
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
    const ax = W / 2, aw = 54, ah = Math.round(floorY * 0.78);
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
  function render(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; tAnim += dt;
    const b = L.biomeOf(S.floor);
    const key = b.name + W + 'x' + H;
    if (key !== bgKey) { bgCanvas = buildBackground(b, Math.floor((S.floor - 1) / 10) + 3); bgKey = key; }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bgCanvas, 0, 0);
    const floorY = Math.round(H * 0.7);

    // torch flames and glow
    [W * 0.17, W * 0.83].forEach((tx, i) => {
      tx = Math.round(tx); const ty = Math.round(floorY * 0.42) - 3;
      const fl = Math.sin(tAnim * 13 + i * 2) + Math.sin(tAnim * 7.3 + i);
      const gr = ctx.createRadialGradient(tx, ty, 1, tx, ty, 34 + fl * 2);
      gr.addColorStop(0, 'rgba(255,170,70,0.32)'); gr.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(tx - 40, ty - 40, 80, 80); ctx.globalCompositeOperation = 'source-over';
      const h = 5 + (fl > 0.6 ? 1 : 0);
      ctx.fillStyle = '#ff7a2a'; ctx.fillRect(tx - 1, ty - h + 2, 3, h);
      ctx.fillStyle = '#ffc04a'; ctx.fillRect(tx, ty - h + 3, 1, h - 2);
      if (fl > 0) { ctx.fillStyle = '#ff7a2a'; ctx.fillRect(tx + (fl > 1 ? 1 : -1), ty - h + 1, 1, 1); }
    });

    // warm pool of lantern light where the party stands
    const pool = ctx.createRadialGradient(W / 2, floorY + 6, 4, W / 2, floorY + 6, W * 0.38);
    pool.addColorStop(0, 'rgba(255,190,110,0.20)'); pool.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pool; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';

    // foe
    const foe = S.foe;
    if (foe) {
      const fk = foe.name + foe.max + S.floor + S.foeIdx;
      if (foeAnim.key !== fk) { foeAnim.key = fk; foeAnim.born = tAnim; }
      const big = foe.boss;
      const scale = 3;
      const spr = sprite(foe.sprite, foe.chest ? 0 : foe.hue, tAnim < foeAnim.flash);
      const sw = spr.width * scale, sh = spr.height * scale;
      const age = tAnim - foeAnim.born;
      const drop = age < 0.25 ? (1 - age / 0.25) * -12 : 0;
      const bob = Math.round(Math.sin(tAnim * 2.4) * (foe.sprite === 'bat' || foe.sprite === 'ghost' ? 2 : 0.6));
      const shake = tAnim < foeAnim.shake ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const fx = Math.round(W / 2 - sw / 2 + shake), fy = Math.round(floorY + 4 - sh + bob + drop) - (foe.sprite === 'bat' || foe.sprite === 'ghost' ? 10 : 0);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(W / 2, floorY + 4, sw * 0.42, 3, 0, 0, Math.PI * 2); ctx.fill();
      if (big) {
        const gg = ctx.createRadialGradient(W / 2, fy + sh / 2, 4, W / 2, fy + sh / 2, sw);
        gg.addColorStop(0, 'rgba(255,80,40,0.18)'); gg.addColorStop(1, 'rgba(255,80,40,0)');
        ctx.fillStyle = gg; ctx.fillRect(W / 2 - sw, fy - 10, sw * 2, sh + 20);
      }
      ctx.globalAlpha = Math.min(1, age / 0.15);
      ctx.drawImage(spr, fx, fy, sw, sh);
      ctx.globalAlpha = 1;
      foeAnim.cx = W / 2; foeAnim.cy = fy + sh / 2; foeAnim.w = sw; foeAnim.h = sh;
    }
    // dying ghost image
    if (foeAnim.dying) {
      const d = foeAnim.dying, a = 0.7 * (1 - (tAnim - d.t) / 0.25);
      if (a <= 0) foeAnim.dying = null;
      else { ctx.globalAlpha = a; ctx.drawImage(d.spr, d.x - (1 - a) * 4, d.y + (1 - a) * 6, d.w * (1 + (1 - a) * 0.15), d.h * (1 - (1 - a) * 0.3)); ctx.globalAlpha = 1; }
    }

    // party auto-attacks: slashes
    const dps = L.totalDps(S, Date.now());
    if (dps > 0 && foe) {
      slashTimer -= dt;
      if (slashTimer <= 0) {
        slashTimer = 0.35 + Math.random() * 0.25;
        const owned = S.heroes.map((l, i) => l ? i : -1).filter(i => i >= 0);
        const hi = owned[Math.floor(Math.random() * owned.length)];
        const cols = ['#ffd27a', '#e8dfc8', '#8fcf6a', '#9fd6ec', '#c8e86a', '#ffb347', '#c78bff', '#ff7a3d', '#6cc4e8', '#fff1c2', '#9aa6ff', '#f2c14e'];
        slashes.push({ x: foeAnim.cx + (Math.random() - 0.5) * foeAnim.w * 0.6, y: foeAnim.cy + (Math.random() - 0.5) * foeAnim.h * 0.5, a: Math.random() * Math.PI, t: tAnim, c: cols[hi % cols.length] });
      }
    }
    for (let i = slashes.length - 1; i >= 0; i--) {
      const s = slashes[i], k = (tAnim - s.t) / 0.18;
      if (k >= 1) { slashes.splice(i, 1); continue; }
      const len = 10 + k * 6, dx = Math.cos(s.a) * len, dy = Math.sin(s.a) * len;
      ctx.strokeStyle = s.c; ctx.globalAlpha = 1 - k; ctx.lineWidth = s.big ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(Math.round(s.x - dx), Math.round(s.y - dy)); ctx.lineTo(Math.round(s.x + dx), Math.round(s.y + dy)); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt;
      if (p.age > p.life) { particles.splice(i, 1); continue; }
      p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > floorY + 6) { p.y = floorY + 6; p.vy *= -0.35; p.vx *= 0.6; }
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 3); ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;

    // dust motes
    for (let i = 0; i < 14; i++) {
      const px = (i * 53 + tAnim * (4 + i % 3)) % W, py = (i * 37 + Math.sin(tAnim * 0.5 + i) * 6 + 20) % (floorY);
      ctx.fillStyle = 'rgba(255,220,160,' + (0.12 + 0.1 * Math.sin(tAnim + i)) + ')'; ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }

    // lantern dimming as the guardian timer runs down
    if (foe && foe.boss) {
      const left = 1 - S.lantern / L.lanternTime(S);
      if (left < 0.5) { ctx.fillStyle = 'rgba(0,0,0,' + ((0.5 - left) * 0.9) + ')'; ctx.fillRect(0, 0, W, H); }
    }
    requestAnimationFrame(render);
  }

  // floating numbers (DOM, crisp text)
  let floaters = 0;
  function floatText(text, cls, xFrac, yFrac) {
    if (floaters > 24) return;
    const el = document.createElement('div');
    el.className = 'float ' + (cls || '');
    el.textContent = text;
    el.style.left = (xFrac * 100) + '%'; el.style.top = (yFrac * 100) + '%';
    arena.appendChild(el); floaters++;
    setTimeout(() => { el.remove(); floaters--; }, 900);
  }
  const fl = document.createElement('style');
  fl.textContent = '.float{position:absolute;transform:translate(-50%,-50%);font-weight:800;font-size:18px;color:#fff3dc;text-shadow:0 2px 0 #000,0 0 6px rgba(0,0,0,.8);pointer-events:none;animation:fl .9s ease-out forwards;font-variant-numeric:tabular-nums;white-space:nowrap}.float.crit{color:#ffcf3a;font-size:24px}.float.gold{color:#f2c14e;font-size:16px}.float.auto{font-size:14px;color:#e7d6b8}@keyframes fl{0%{opacity:0;margin-top:6px}15%{opacity:1}100%{opacity:0;margin-top:-46px}}';
  document.head.appendChild(fl);

  // ---------- events ----------
  let pendingGold = 0, lastGoldFloat = 0;
  function handleEvents() {
    let kills = 0, gold = 0;
    for (const e of events) {
      if (e.type === 'hit') {
        if (!e.auto || Math.random() < 0.4) floatText(fmt(e.dmg), e.crit ? 'crit' : e.auto ? 'auto' : '', 0.5 + (Math.random() - 0.5) * 0.3, 0.42 + (Math.random() - 0.5) * 0.2);
        foeAnim.flash = tAnim + 0.06; foeAnim.shake = tAnim + 0.08;
        sfx.hit(e.crit);
      } else if (e.type === 'kill') {
        kills++; gold += e.gold;
        const f = e.foe, spr = sprite(f.sprite, f.chest ? 0 : f.hue, true);
        foeAnim.dying = { spr, t: tAnim, x: foeAnim.cx - foeAnim.w / 2, y: foeAnim.cy - foeAnim.h / 2, w: foeAnim.w, h: foeAnim.h };
        burst(foeAnim.cx, foeAnim.cy, f.boss ? 50 : f.chest ? 40 : 14, f.chest || f.boss ? ['#f2c14e', '#fff0a0', '#c8952a'] : ['#f2c14e', '#fff0a0', '#9b8a70'], f.boss ? 70 : 45);
        if (f.boss) { sfx.boss(); toast('crown', f.name + ' defeated', 'The way down is open.', ''); }
      } else if (e.type === 'relic') {
        sfx.relic();
        toast('relic', e.level > 1 ? e.relic.name + ' grows stronger' : 'Relic found: ' + e.relic.name, e.relic.desc + (e.level > 1 ? ' (level ' + e.level + ')' : ''), 'relic');
      } else if (e.type === 'retry') {
        toast('sword', 'Ready for another try', 'Your party is strong enough now and heads back down.', 'feat');
      } else if (e.type === 'bossfail') {
        sfx.fail();
        toast('lock', 'The lantern guttered out', e.name + ' held the stairs. Your party fell back a floor to train, and will try again once they are strong enough.', 'warn');
        $('auto').checked = false;
      }
    }
    if (kills) { pendingGold += gold; }
    const tnow = performance.now();
    if (pendingGold > 0 && tnow - lastGoldFloat > 450) {
      floatText('+' + fmt(pendingGold), 'gold', 0.5, 0.24);
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

  // ---------- panel: heroes ----------
  const heroEls = [];
  function buildHeroes() {
    const box = $('heroes'); box.innerHTML = '';
    L.HEROES.forEach((h, i) => {
      const el = document.createElement('div'); el.className = 'hero';
      el.innerHTML = '<div class="ic">' + icon(h.icon) + '</div><div class="info"><div class="nm"></div><div class="lv"></div><div class="ms"><i></i></div><div class="line"></div></div><button class="buy"><b></b><span>' + coin + '<em></em></span></button>';
      el.querySelector('.buy').addEventListener('click', () => {
        const n = S.settings.buy === 'max' ? 'max' : +S.settings.buy;
        if (L.buyHero(S, i, n)) { sfx.buy(); updatePanel(true); }
      });
      box.appendChild(el); heroEls.push(el);
    });
  }
  function updateHeroes() {
    const now = Date.now();
    L.HEROES.forEach((h, i) => {
      const el = heroEls[i], lvl = S.heroes[i];
      const visible = i < S.seenHeroes, mystery = i === S.seenHeroes;
      el.hidden = !(visible || mystery);
      if (el.hidden) return;
      el.classList.toggle('mystery', mystery);
      el.classList.toggle('owned', lvl > 0);
      const nm = el.querySelector('.nm'), lv = el.querySelector('.lv'), line = el.querySelector('.line'), btn = el.querySelector('.buy');
      if (mystery) {
        nm.innerHTML = 'An unknown delver';
        lv.textContent = 'Hire ' + L.HEROES[i - 1].name + ' to meet them.';
        line.textContent = ''; btn.hidden = true; el.querySelector('.ms').hidden = true;
        el.querySelector('.ic').innerHTML = icon('lock');
        return;
      }
      if (el.dataset.known !== '1') { el.querySelector('.ic').innerHTML = icon(h.icon); el.dataset.known = '1'; }
      btn.hidden = false; el.querySelector('.ms').hidden = lvl === 0;
      nm.innerHTML = h.name + ' <small>' + h.title + '</small>';
      const dps = L.heroDps(S, i) * L.globalMult(S, now);
      const nextMs = L.nextMilestone(lvl);
      lv.innerHTML = lvl ? 'Level <b>' + lvl + '</b> &middot; ' + fmt(dps) + ' dmg/s' + (nextMs ? ' &middot; x' + (nextMs >= 200 ? 3 : 2) + ' at ' + nextMs : '') : 'Deals ' + fmt(h.dps * L.globalMult(S, now)) + ' dmg/s per level';
      if (lvl) { const prev = [0].concat(L.MILESTONES).filter(t => t <= lvl).pop(); el.querySelector('.ms i').style.width = nextMs ? ((lvl - prev) / (nextMs - prev) * 100) + '%' : '100%'; }
      line.textContent = h.line;
      let n = S.settings.buy === 'max' ? Math.max(1, L.maxAffordable(S, i)) : +S.settings.buy;
      const cost = L.heroCost(S, i, n);
      btn.querySelector('b').textContent = lvl ? 'Level +' + n : (n > 1 ? 'Hire +' + n : 'Hire');
      btn.querySelector('em').textContent = fmt(cost);
      btn.disabled = cost > S.gold;
    });
  }
  document.querySelectorAll('#buyseg button').forEach(b => b.addEventListener('click', () => {
    S.settings.buy = b.dataset.n === 'max' ? 'max' : +b.dataset.n;
    document.querySelectorAll('#buyseg button').forEach(x => x.classList.toggle('on', x === b));
    updateHeroes();
  }));
  function syncBuySeg() { document.querySelectorAll('#buyseg button').forEach(x => x.classList.toggle('on', String(S.settings.buy) === x.dataset.n)); }

  // ---------- panel: skills ----------
  const SKICON = { flare: 'flare', plunder: 'bag', frenzy: 'fist', reserve: 'oil' };
  const skillEls = {};
  function buildSkills() {
    const box = $('skills'); box.innerHTML = '';
    L.SKILLS.forEach((k, idx) => {
      const b = document.createElement('button'); b.className = 'skill'; b.title = k.desc;
      b.innerHTML = '<div class="cd"></div>' + icon(SKICON[k.id]) + '<div><b>' + k.name + '</b><small></small></div><kbd>' + (idx + 1) + '</kbd>';
      b.addEventListener('click', () => activateSkill(k.id));
      box.appendChild(b); skillEls[k.id] = b;
    });
  }
  function activateSkill(id) {
    if (L.useSkill(S, id, Date.now())) { tone(440, 0.12, 'triangle', 0.05, 880); updateSkills(); }
  }
  function updateSkills() {
    const now = Date.now();
    L.SKILLS.forEach(k => {
      const b = skillEls[k.id], st = S.skills[k.id];
      const locked = S.maxFloorEver < k.unlock;
      const active = st && st.until > now && k.dur > 0;
      const cd = st && st.readyAt > now ? (st.readyAt - now) / 1000 : 0;
      b.classList.toggle('locked', locked); b.classList.toggle('active', !!active); b.classList.toggle('ready', !locked && !cd);
      b.disabled = locked;
      const sm = b.querySelector('small'), ov = b.querySelector('.cd');
      if (locked) { sm.textContent = 'Unlocks on floor ' + k.unlock; ov.style.transform = 'scaleX(0)'; }
      else if (active) { sm.textContent = 'Active ' + fmtTime((st.until - now) / 1000); ov.style.transform = 'scaleX(0)'; }
      else if (cd) { sm.textContent = 'Ready in ' + fmtTime(cd); ov.style.transform = 'scaleX(' + (cd / k.cd) + ')'; }
      else { sm.textContent = 'Ready'; ov.style.transform = 'scaleX(0)'; }
    });
  }

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
    modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Rekindle now?</h2><p>Your heroes, gold and floor reset to the start. You keep relics and feats, and gain <b style="color:var(--ember)">' + fmt(e) + ' Embers</b> for +' + fmt(e * 10) + '% damage and gold.</p><div class="row" style="justify-content:center"><button class="btn ghost" id="m-no">Not yet</button><button class="btn" id="m-yes">Rekindle</button></div></div>', m => {
      m.querySelector('#m-no').onclick = closeModal;
      m.querySelector('#m-yes').onclick = () => {
        const got = L.rekindle(S); closeModal(); sfx.relic(); save();
        toast('flame', 'The lantern burns brighter', '+' + fmt(got) + ' Embers. The descent begins again.', 'feat');
        $('auto').checked = true; switchTab('party'); updatePanel(true);
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
  let lastRelicCount = -1, lastFeatCount = -1;
  function updatePanel(force) {
    const now = Date.now();
    $('gold').textContent = fmt(S.gold);
    $('dps').textContent = fmt(L.totalDps(S, now));
    $('embers').textContent = fmt(S.embers);
    if (tab === 'party') updateHeroes();
    if (tab === 'relics' && (force || lastRelicCount !== Object.keys(S.relics).length)) updateRelics();
    if (tab === 'feats' && (force || lastFeatCount !== L.featCount(S))) updateFeats();
    if (tab === 'stats') updateLedger();
    if (tab === 'rekindle') updateRekindle();
    lastRelicCount = Object.keys(S.relics).length; lastFeatCount = L.featCount(S);
    $('relcount').textContent = lastRelicCount + '/' + L.RELICS.length;
    $('featcount').textContent = lastFeatCount + '/' + L.FEATS.length;
    updateSkills();
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
    const f = S.foe;
    if (f) {
      $('foename').textContent = f.name;
      const tag = $('foetag'); tag.textContent = f.boss ? 'Guardian' : f.chest ? 'Treasure' : ''; tag.className = 'tag' + (f.chest ? ' chest' : '');
      $('hpbar').style.width = Math.max(0, f.hp / f.max * 100) + '%';
      $('hptext').textContent = fmt(Math.max(0, f.hp)) + ' / ' + fmt(f.max);
      $('lanternwrap').hidden = !f.boss;
      if (f.boss) {
        const lt = L.lanternTime(S), left = Math.max(0, lt - S.lantern);
        $('lanternbar').style.width = (left / lt * 100) + '%';
        $('lanterntext').textContent = 'Lantern oil ' + left.toFixed(1) + 's';
      }
    }
    if ($('auto').checked !== S.autoAdvance) $('auto').checked = S.autoAdvance;
  }
  $('auto').addEventListener('change', e => { S.autoAdvance = e.target.checked; S.retryBoss = 0; });
  $('prev').addEventListener('click', () => { L.gotoFloor(S, S.floor - 1); S.autoAdvance = false; updateStage(); });
  $('next').addEventListener('click', () => { L.gotoFloor(S, S.floor + 1); updateStage(); });

  let strikesThisSession = 0;
  function doStrike(ev) {
    if (!S.foe) return;
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
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const i = +e.key; if (i >= 1 && i <= L.SKILLS.length) activateSkill(L.SKILLS[i - 1].id);
  });

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
      '<p class="credits">Lanternhold v0.1 &middot; An original game by Born2Develop. Made with care, no ads, no tracking.</p>' +
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
          m.querySelector('#s-extra').innerHTML = '<p style="color:#ff9c88">This erases everything, including Embers and relics' + (user ? ' and the save stored with your account' : '') + '. It cannot be undone.</p><div class="row"><button class="btn danger" id="s-doreset">Yes, erase it all</button></div>';
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
    if (dt > 5) grantOffline(dt, false);
    else if (dt > 0) L.tick(S, dt, now, null, events);
    handleEvents();
    updateStage();
    if (now - lastSlow > 250) {
      lastSlow = now; updatePanel(false);
      const got = L.checkFeats(S);
      got.forEach(f => toast('star', 'Feat earned: ' + f.name, f.desc + ' (+2% party damage)', 'feat'));
    }
    if (now - lastSave > 10000) { lastSave = now; save(); }
  }

  // ---------- optional sign-in and cloud saves (Firebase) ----------
  // Switched on by window.LH_FIREBASE in index.html. Guests can always play without signing in.
  const FB_VER = '10.14.1';
  let fb = null, user = null, lastCloud = 0;
  function saveObj() { S.lastSeen = Date.now(); const o = Object.assign({}, S); delete o.foe; delete o._frenzyAcc; return o; }
  function summary(o) {
    return 'Floor ' + (o.maxFloorEver || 1) + ', ' + fmt(o.embers || 0) + ' Embers, ' + fmtTime((o.stats && o.stats.playTime) || 0) + ' played';
  }
  async function fbInit() {
    const cfg = window.LH_FIREBASE;
    if (!cfg || !cfg.apiKey) return;
    const base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
    try {
      const [appM, authM, fsM] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
      const app = appM.initializeApp(cfg);
      fb = { auth: authM.getAuth(app), db: fsM.getFirestore(app), authM, fsM };
    } catch (e) { console.warn('Cloud saves unavailable', e); return; }
    $('btn-account').hidden = false;
    fb.authM.onAuthStateChanged(fb.auth, async u => {
      user = u; paintAccount();
      if (u) await reconcile();
    });
  }
  function paintAccount() {
    const b = $('btn-account');
    if (user) {
      const initial = (user.displayName || user.email || '?').trim()[0].toUpperCase();
      b.innerHTML = '<span class="avatar">' + initial + '</span>'; b.setAttribute('aria-label', 'Account'); b.title = 'Signed in. Progress syncs.';
    } else { b.innerHTML = icon('user') + '<span>Sign in</span>'; b.setAttribute('aria-label', 'Sign in'); b.title = 'Sign in to sync your progress'; }
  }
  const cloudRef = () => fb.fsM.doc(fb.db, 'saves', user.uid);
  async function pushCloud(quiet) {
    if (!fb || !user) return;
    try {
      const o = saveObj();
      await fb.fsM.setDoc(cloudRef(), { data: JSON.stringify(o), floor: o.maxFloorEver, embers: o.embers, updated: Date.now(), v: L.VERSION });
      lastCloud = Date.now();
      if (!quiet) toast('star', 'Progress synced', 'Your save is stored with your account.', 'feat');
    } catch (e) { if (!quiet) toast('lock', 'Could not sync right now', 'Your progress is still saved on this device.', 'warn'); }
  }
  async function reconcile() {
    let snap;
    try { snap = await fb.fsM.getDoc(cloudRef()); } catch (e) { return; }
    const local = saveObj();
    const fresh = !local.stats.kills && !local.embers;
    if (!snap.exists()) { await pushCloud(false); return; }
    let cloud; try { cloud = JSON.parse(snap.data().data); } catch (e) { await pushCloud(true); return; }
    const same = Math.abs(((cloud.stats && cloud.stats.playTime) || 0) - local.stats.playTime) < 5;
    if (same) return;
    if (fresh) { useSave(cloud); return; }
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
  function openAccount() {
    if (!fb) return;
    if (!user) {
      modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Keep your progress safe</h2><p>Sign in to store your save with your account and play on any device. It is optional, and the game works the same without it.</p>' +
        '<div class="row" style="justify-content:center"><button class="btn gbtn" id="a-google">' + icon('google') + 'Continue with Google</button></div>' +
        '<p class="credits">We only keep your name, email and game save. <a href="privacy.html" target="_blank" rel="noopener" style="color:var(--muted)">Privacy</a></p></div>', m => {
          m.querySelector('#a-google').onclick = async () => {
            try { await fb.authM.signInWithPopup(fb.auth, new fb.authM.GoogleAuthProvider()); closeModal(); }
            catch (e) { if (e && e.code !== 'auth/popup-closed-by-user') toast('lock', 'Sign-in did not finish', 'Please try again.', 'warn'); }
          };
        });
      return;
    }
    modal('<h2>Your account</h2><p>Signed in as <b style="color:var(--text)"></b>. Your progress syncs every minute and whenever you leave the game.</p>' +
      '<div class="row"><button class="btn" id="a-sync">Sync now</button><button class="btn ghost" id="a-out">Sign out</button></div>' +
      '<p class="credits"><a href="privacy.html" target="_blank" rel="noopener" style="color:var(--muted)">Privacy</a> &middot; To delete your account data, use Erase progress in Settings while signed in.</p>' +
      '<div class="row"><button class="btn ghost" id="a-close">Done</button></div>', m => {
        m.querySelector('b').textContent = user.displayName || user.email;
        m.querySelector('#a-sync').onclick = () => pushCloud(false);
        m.querySelector('#a-out').onclick = async () => { await pushCloud(true); await fb.authM.signOut(fb.auth); closeModal(); toast('user', 'Signed out', 'Your progress stays on this device too.', ''); };
        m.querySelector('#a-close').onclick = closeModal;
      });
  }
  async function eraseCloud() { if (fb && user) { try { await fb.fsM.deleteDoc(cloudRef()); } catch (e) {} } }
  $('btn-account').addEventListener('click', openAccount);
  setInterval(() => { if (user && Date.now() - lastCloud > 60000) pushCloud(true); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && user) pushCloud(true); });

  // ---------- support link ----------
  if (window.LH_SUPPORT_URL) { const a = $('support'); a.href = window.LH_SUPPORT_URL; a.hidden = false; a.title = 'Buy the developer a coffee'; }

  // ---------- boot ----------
  function intro() {
    $('modal').dataset.lock = '1';
    modal('<div class="center"><svg class="lantern-hero" viewBox="0 0 32 32"><use href="#i-lantern"/></svg><h2>Lanternhold</h2><p>Beneath the old hold, a stair winds down forever. Each floor is darker than the last, and something waits at every fifth landing.</p><p>Tap the dark to strike. Spend the gold you find to hire delvers who fight for you, even while you are away. When the going slows, rekindle the lantern and come back stronger.</p><div class="row" style="justify-content:center"><button class="btn big" id="m-begin">Begin the descent</button></div></div>', m => {
      m.querySelector('#m-begin').onclick = () => { delete $('modal').dataset.lock; audio(); closeModal(); arena.focus(); };
    });
  }

  resize();
  window.addEventListener('resize', resize);
  buildHeroes(); buildSkills(); syncBuySeg();
  if (!S.foe) S.foe = null;
  if (firstRun) intro();
  else grantOffline((Date.now() - (S.lastSeen || Date.now())) / 1000, true);
  updateStage(); updatePanel(true);
  setInterval(logic, 100);
  requestAnimationFrame(render);
  fbInit();
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
  window.LHDebug = { get S() { return S; }, save, L };
})();
