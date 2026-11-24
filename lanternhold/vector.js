/* lh-build 202611241521 */
/* Lanternhold illustrated sprites. Each sprite is drawn as layered SVG (outline, shading, rim light, detail),
   tinted per companion or biome, rendered once to an image and then drawn on the arena canvas. */
(function (root) {
  'use strict';
  const PX = root.LHSprites; if (!PX) return;
  // --- colour helpers ---
  function hsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; }
    return [h, s, l];
  }
  function hex(h, s, l) {
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  }
  const rot = (c, deg) => { if (!deg) return c; const [h, s, l] = hsl(c); return hex((h + deg + 360) % 360, s, l); };
  const lit = (c, dl) => { const [h, s, l] = hsl(c); return hex(h, s, Math.max(0, Math.min(1, l + dl))); };
  // --- svg helpers ---
  let gid = 0;
  function Ctx(hue) { this.hue = hue || 0; this.defs = []; }
  Ctx.prototype.t = function (c) { return rot(c, this.hue); };           // tinted colour
  Ctx.prototype.lg = function (stops, x1, y1, x2, y2) {                    // linear gradient, returns url()
    const id = 'g' + (++gid);
    this.defs.push('<linearGradient id="' + id + '" x1="' + (x1 == null ? 0 : x1) + '" y1="' + (y1 == null ? 0 : y1) + '" x2="' + (x2 == null ? 1 : x2) + '" y2="' + (y2 == null ? 1 : y2) + '">' +
      stops.map((c, i) => { const [col, op] = Array.isArray(c) ? c : [c, 1]; return '<stop offset="' + (i / Math.max(1, stops.length - 1)).toFixed(3) + '" stop-color="' + col + '"' + (op < 1 ? ' stop-opacity="' + op + '"' : '') + '/>'; }).join('') + '</linearGradient>');
    return 'url(#' + id + ')';
  };
  Ctx.prototype.rg = function (stops, cx, cy, r) {
    const id = 'g' + (++gid);
    this.defs.push('<radialGradient id="' + id + '" cx="' + (cx == null ? 0.5 : cx) + '" cy="' + (cy == null ? 0.5 : cy) + '" r="' + (r == null ? 0.5 : r) + '">' +
      stops.map((c, i) => { const [col, op] = Array.isArray(c) ? c : [c, 1]; return '<stop offset="' + (i / Math.max(1, stops.length - 1)).toFixed(3) + '" stop-color="' + col + '"' + (op < 1 ? ' stop-opacity="' + op + '"' : '') + '/>'; }).join('') + '</radialGradient>');
    return 'url(#' + id + ')';
  };
  // A material: body gradient from a base colour, lit from the upper left.
  Ctx.prototype.mat = function (c, tint) { c = tint === false ? c : this.t(c); return this.lg([lit(c, 0.16), c, lit(c, -0.2)], 0.15, 0, 0.85, 1); };
  Ctx.prototype.glowF = function (sd) { const id = 'f' + (++gid); this.defs.push('<filter id="' + id + '" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="' + sd + '"/></filter>'); return 'url(#' + id + ')'; };
  const OUT = '#0b0d14';
  // Shape with outline: p(d, fill, extra)
  // Outline defaults give way to any stroke settings passed in x (SVG images must be strict XML: no repeated attributes).
  const P = (d, fill, x) => { x = x || ''; return '<path d="' + d + '" fill="' + fill + '"' + (/ stroke=/.test(x) ? '' : ' stroke="' + OUT + '"') + (/stroke-width=/.test(x) ? '' : ' stroke-width="2.4"') + ' stroke-linejoin="round"' + x + '/>'; };
  const Pn = (d, fill, x) => '<path d="' + d + '" fill="' + fill + '"' + (x || '') + '/>';             // no outline
  const L_ = (d, col, w, x) => '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (w || 1.5) + '" stroke-linecap="round" stroke-linejoin="round"' + (x || '') + '/>';
  const E = (cx, cy, rx, ry, fill, x) => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' + (x || '') + '/>';
  const Eo = (cx, cy, rx, ry, fill, x) => { x = x || ''; return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' + (/ stroke=/.test(x) ? '' : ' stroke="' + OUT + '"') + (/stroke-width=/.test(x) ? '' : ' stroke-width="2.4"') + x + '/>'; };
  const C = (cx, cy, r, fill, x) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"' + (x || '') + '/>';
  const G = (inner, tf, x) => '<g' + (tf ? ' transform="' + tf + '"' : '') + (x || '') + '>' + inner + '</g>';
  // Glowing eye: bright core with a soft halo.
  const eye = (c, x, y, r, col) => E(x, y, r * 2.6, r * 2.2, col, ' opacity=".45" filter="' + c.glowF(r * 0.9) + '"') + E(x, y, r, r * 0.8, lit(col, 0.25)) + E(x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.3, '#ffffff');
  const SK = { light: '#f3c9a4', mid: '#d79b74', dark: '#a8684a' };
  const ART = {};
  // ---------------- heroes: 120 x 160, standing on y = 156, facing right ----------------
  ART.tank = { w: 120, h: 160, draw(c) {
    const steel = c.lg(['#f4f8fc', '#b9c6d4', '#7c8b9e', '#4a5566'], 0.1, 0, 0.9, 1), steelD = c.lg(['#c9d3df', '#7b889a', '#3c4554'], 0, 0, 1, 1);
    const gold = c.lg(['#fff0b8', '#f5c242', '#a87418'], 0, 0, 1, 1), cloth = c.mat('#3a5fa8'), clothD = c.t('#22396b'), plume = c.mat('#d0362c');
    const leather = c.lg(['#7a5536', '#4a3020'], 0, 0, 0, 1);
    return [
      // sword held back over the shoulder
      G(P('M-3 -64 L3 -64 L4 0 L0 7 L-4 0Z', c.lg(['#ffffff', '#c3cfdc', '#6d7b8c'], 0, 0, 1, 0)) + L_('M0 -60 V2', '#ffffff', 0.8, ' opacity=".7"') +
        P('M-11 0 H11 V5 H-11Z', gold) + P('M-2.5 5 H2.5 V18 H-2.5Z', leather) + C(0, 21, 3.6, gold, ' stroke="' + OUT + '" stroke-width="2"'), 'translate(30 92) rotate(-28)'),
      // cape
      P('M36 64 Q26 100 30 140 Q44 146 52 138 L56 70Z', c.lg([lit(c.t('#8a2a2a'), 0.05), c.t('#5a1a1c')], 0, 0, 1, 1)),
      // legs: greaves and boots
      P('M44 112 L56 112 L55 140 L43 140Z', steelD), P('M60 112 L72 112 L73 140 L61 140Z', steel),
      E(49, 126, 6, 3, '#ffffff', ' opacity=".25"'), E(66, 126, 6, 3, '#ffffff', ' opacity=".35"'),
      P('M40 138 H57 Q58 150 56 155 H38 Q37 146 40 138Z', leather), P('M59 138 H76 Q80 146 80 155 H60 Q59 148 59 138Z', leather),
      L_('M40 146 H56 M60 146 H78', '#2a1a10', 1.2),
      // mail skirt
      P('M38 100 H80 L84 118 Q60 124 34 118Z', c.lg(['#9aa6b4', '#5d6878'], 0, 0, 0, 1)),
      L_('M38 106 H80 M37 112 H82', OUT, 0.8, ' opacity=".55" stroke-dasharray="2 2"'),
      // tabard
      P('M48 74 H70 L72 120 L59 126 L46 120Z', cloth), L_('M48 76 L46 118 M70 76 L72 118', gold, 1.4),
      P('M55 92 L59 86 L63 92 L59 104Z', gold),
      // breastplate
      P('M38 66 Q58 56 80 66 L78 98 Q58 106 40 98Z', steel), L_('M59 62 V102', '#ffffff', 1, ' opacity=".5"'),
      L_('M42 70 Q58 62 76 70', '#ffffff', 1.4, ' opacity=".55"'), L_('M40 96 Q58 104 78 96', gold, 1.6),
      P('M50 78 H68 V86 H50Z', clothD, ' opacity=".9"'), P('M56 76 L59 72 L62 76 L62 90 L59 94 L56 90Z', gold),
      C(44, 72, 1.3, '#e8eef6'), C(74, 72, 1.3, '#e8eef6'), C(44, 92, 1.3, '#e8eef6'), C(74, 92, 1.3, '#e8eef6'),
      // belt
      P('M40 98 H78 V104 H40Z', leather), P('M55 97 H63 V105 H55Z', gold), Pn('M57.5 99 H60.5 V103 H57.5Z', leather),
      // back arm (sword arm)
      P('M34 70 Q26 84 30 98 L38 96 Q36 84 40 74Z', steelD), Eo(32, 99, 5, 5, steelD),
      // pauldrons
      P('M30 60 Q36 50 48 56 Q50 66 42 72 Q32 74 30 60Z', steel), L_('M33 63 Q40 56 47 60', gold, 1.4),
      P('M70 56 Q84 50 90 60 Q90 74 78 72 Q70 66 70 56Z', steel), L_('M73 60 Q82 55 88 62', gold, 1.4), L_('M75 66 Q82 63 87 68', '#ffffff', 1, ' opacity=".5"'),
      // helm with visor and plume
      P('M60 22 Q68 6 58 0 Q74 4 76 20 Q70 28 60 22Z', plume), L_('M63 8 Q70 12 71 20', '#ff9a8a', 1, ' opacity=".7"'),
      P('M42 36 Q42 14 59 12 Q76 14 76 36 L76 50 Q59 58 42 50Z', steel),
      L_('M59 13 V52', '#2a3240', 1.4), L_('M46 22 Q52 16 58 15', '#ffffff', 1.6, ' opacity=".7"'),
      P('M45 34 H74 V40 H45Z', '#10141c'), Pn('M61 35.5 H72 V38.5 H61Z', '#ffcf6a', ' opacity=".85"'),
      L_('M48 44 H56 M48 47.5 H56 M63 44 H71 M63 47.5 H71', '#2a3240', 1.1),
      L_('M42 50 Q59 58 76 50', gold, 1.6),
      // kite shield in front
      G(P('M0 0 H34 V20 Q34 44 17 56 Q0 44 0 20Z', c.lg([lit(c.t('#2c4b8e'), 0.08), c.t('#1b2f5e')], 0, 0, 1, 1)) +
        L_('M3 3 H31 V20 Q31 42 17 52 Q3 42 3 20Z', gold, 2.2) +
        P('M5 33 L17 24 L29 33 V39 L17 30 L5 39Z', gold) + P('M17 8 Q23 15 17 21 Q11 15 17 8Z', '#f5c242', ' stroke="' + OUT + '" stroke-width="1.2"') +
        L_('M6 6 Q12 5 16 6', '#ffffff', 1.2, ' opacity=".5"'), 'translate(74 70) rotate(4)'),
      // shield hand
      Eo(80, 92, 5, 4.5, steelD),
    ].join('');
  } };

  ART.healer = { w: 120, h: 160, draw(c) {
    const robe = c.mat('#5aa04e'), robeD = c.t('#2e5a2c'), trim = c.lg(['#fff7dc', '#e8d6a0', '#b8a066']), wood = c.lg(['#b78a52', '#7a5530', '#4a321c'], 0, 0, 1, 0);
    const skin = c.lg([SK.light, SK.mid], 0, 0, 1, 1), hair = c.lg(['#e3b46a', '#a8742e']);
    return [
      // staff with lantern-star
      G(P('M-2.5 0 H2.5 V132 H-2.5Z', wood) + L_('M-1 4 V128', '#e6c08a', 0.8, ' opacity=".6"') + P('M-4 26 H4 V30 H-4Z', trim) +
        C(0, -8, 22, c.rg([['#fff6cf', 0.9], ['#f5c242', 0.35], ['#f5c242', 0]]), '') +
        P('M0 -22 L4 -12 L14 -8 L4 -4 L0 6 L-4 -4 L-14 -8 L-4 -12Z', c.lg(['#ffffff', '#ffe58a', '#e0a628'])) + C(0, -8, 3, '#ffffff'), 'translate(90 26)'),
      // robe body (bell shape)
      P('M38 70 Q30 110 26 152 Q58 160 90 152 Q86 110 80 70 Q60 62 38 70Z', robe),
      Pn('M60 70 Q66 110 70 154 Q80 156 90 152 Q86 110 80 70Z', robeD, ' opacity=".35"'),
      L_('M44 90 Q42 120 38 150 M52 96 Q52 124 50 154', '#ffffff', 1, ' opacity=".18"'),
      // front panel and hem trim
      P('M53 72 H65 L70 154 Q59 157 48 154Z', trim), L_('M59 80 V150', '#b8a066', 1),
      P('M26 148 Q58 158 90 148 L90 154 Q58 162 26 154Z', trim),
      // sash and pouch
      P('M38 100 Q60 108 82 100 L82 107 Q60 115 38 107Z', c.mat('#8a2f6a')), Eo(42, 112, 6, 7, c.lg(['#9a6a3a', '#5a3a1c']), ''),
      // sleeves and hands
      P('M38 72 Q26 90 28 112 L40 112 Q40 92 46 80Z', robe), Eo(34, 114, 5, 4.5, skin),
      P('M78 72 Q92 82 92 98 L84 104 Q80 90 72 84Z', robe), Eo(90, 100, 5, 4.5, skin),
      // hood and face
      P('M36 52 Q34 18 59 14 Q84 18 82 52 Q80 70 59 74 Q38 70 36 52Z', c.mat('#4c8c44')),
      Pn('M70 20 Q84 30 82 52 Q80 66 66 72 Q78 50 70 20Z', robeD, ' opacity=".4"'),
      P('M44 44 Q44 28 59 26 Q74 28 74 44 Q74 62 59 66 Q44 62 44 44Z', skin),
      Pn('M44 40 Q48 26 60 26 Q72 26 74 38 Q66 32 58 34 Q50 34 44 40Z', hair),
      E(53, 46, 2.2, 2.8, '#2a2018'), E(66, 46, 2.2, 2.8, '#2a2018'), C(53.7, 45, 0.8, '#ffffff'), C(66.7, 45, 0.8, '#ffffff'),
      L_('M50 41 Q53 39.5 56 41 M63 41 Q66 39.5 69 41', '#7a4a2a', 1), L_('M55 55 Q59.5 58 64 55', '#9a4a3a', 1.4),
      E(50, 52, 3, 1.8, '#ff8a7a', ' opacity=".35"'), E(69, 52, 3, 1.8, '#ff8a7a', ' opacity=".35"'),
      L_('M38 52 Q38 22 59 18', '#ffffff', 1.2, ' opacity=".25"'),
      // little Mercy cross on the hood
      P('M57 16 H61 V10 H65 V6 H61 V2 H57 V6 H53 V10 H57Z', trim, ' transform="translate(0 4) scale(1)"'),
    ].join('');
  } };

  ART.rogue = { w: 120, h: 160, draw(c) {
    const leather = c.mat('#3c4558'), leatherD = c.t('#20263a'), scarf = c.mat('#a33232'), hood = c.mat('#2e3546');
    const blade = c.lg(['#ffffff', '#c6d1dc', '#6a7889'], 0, 0, 1, 0), brass = c.lg(['#ffe3a0', '#c99a3a', '#7a5a1a']), skin = c.lg([SK.light, SK.mid]);
    const dagger = (tf, flip) => G(P('M-2.6 -34 L2.6 -34 L3 0 L-3 0Z' + (flip ? '' : ''), blade) + L_('M0 -30 V-2', '#ffffff', 0.7, ' opacity=".8"') +
      P('M-8 0 H8 V3.5 H-8Z', brass) + P('M-2 3.5 H2 V14 H-2Z', '#3a2418') + C(0, 16, 2.4, brass, ' stroke="' + OUT + '" stroke-width="1.4"'), tf);
    return [
      dagger('translate(30 98) rotate(-150)'),
      // legs in a crouch
      P('M46 110 L56 112 L50 140 L40 138Z', leatherD), P('M62 112 L72 110 L80 136 L70 140Z', leather),
      P('M36 136 H52 Q54 148 52 154 H32 Q31 144 36 136Z', c.lg(['#4a3424', '#22160e'])), P('M68 136 H82 Q88 146 88 154 H68 Q66 146 68 136Z', c.lg(['#5a4030', '#2a1a10'])),
      L_('M37 142 H51 M69 142 H83', '#6a4a30', 1),
      // torso: leather jerkin with straps
      P('M42 70 Q58 62 76 70 L78 112 Q60 118 42 112Z', leather),
      Pn('M60 66 Q70 66 76 70 L78 112 Q70 115 62 116Z', leatherD, ' opacity=".45"'),
      L_('M46 74 L74 108', '#5a3a24', 4), L_('M46 74 L74 108', '#8a5a34', 1.2),
      C(52, 81, 1.6, brass), C(60, 91, 1.6, brass), C(68, 101, 1.6, brass),
      P('M42 104 H78 V110 H42Z', '#2a1c14'), P('M56 103 H64 V111 H56Z', brass),
      L_('M45 78 V100 M75 78 V100', '#ffffff', 0.8, ' opacity=".15"'),
      // arms
      P('M42 72 Q30 82 30 98 L38 100 Q40 86 48 80Z', leather), Eo(32, 100, 5, 4.5, '#2a2a34'),
      P('M76 72 Q90 80 92 94 L84 98 Q80 86 72 82Z', leather), Eo(89, 97, 5, 4.5, '#2a2a34'),
      // scarf
      P('M44 62 Q59 70 74 62 L74 72 Q59 80 44 72Z', scarf), P('M46 68 Q38 80 34 92 L40 94 Q44 82 52 72Z', scarf),
      // hood
      P('M38 50 Q36 16 58 10 Q72 12 82 30 Q86 44 80 62 Q60 70 40 62Z', hood),
      Pn('M66 14 Q82 24 82 44 Q82 56 78 62 Q74 40 66 14Z', '#000000', ' opacity=".3"'),
      L_('M41 50 Q40 22 58 14', '#ffffff', 1.2, ' opacity=".2"'),
      // shadowed face with mask
      P('M46 46 Q47 30 60 28 Q74 30 75 46 Q74 58 60 62 Q47 58 46 46Z', '#151924'),
      Pn('M50 40 Q60 36 72 40 L72 46 Q60 43 50 46Z', skin, ' opacity=".95"'),
      eye(c, 56, 43.5, 1.6, '#f5c242'), eye(c, 67, 43.5, 1.6, '#f5c242'),
      P('M47 49 Q60 54 75 49 L74 58 Q60 64 47 58Z', scarf),
      dagger('translate(92 96) rotate(30)'),
    ].join('');
  } };

  ART.mage = { w: 120, h: 160, draw(c) { return G(ART.mage.body(c), 'translate(2.4 7) scale(0.95)'); }, body(c) {
    const robe = c.mat('#3762c4'), robeD = c.t('#1d2f6e'), trim = c.lg(['#fff0b8', '#f5c242', '#a87418']), skin = c.lg([SK.light, SK.mid]);
    const wood = c.lg(['#6a4a2c', '#3a2616'], 0, 0, 1, 0), beard = c.lg(['#ffffff', '#d4dbe6', '#9aa6b8'], 0, 0, 0, 1);
    return [
      // staff with crystal
      G(P('M-2.5 0 H2.5 V126 H-2.5Z', wood) + L_('M-1 4 V122', '#b48a5a', 0.8, ' opacity=".6"') +
        P('M-6 -2 Q0 -10 6 -2 L4 4 H-4Z', trim) +
        C(0, -16, 24, c.rg([['#e9fdff', 0.9], ['#7fd6e8', 0.4], ['#7fd6e8', 0]]), '') +
        P('M0 -32 L8 -16 L0 -2 L-8 -16Z', c.lg(['#ffffff', '#a8f0ff', '#3aa8c8'])) + L_('M0 -30 L-4 -16 L0 -4', '#ffffff', 1, ' opacity=".8"'), 'translate(24 34)'),
      // robe
      P('M40 70 Q32 112 28 152 Q60 160 92 152 Q88 112 80 70 Q60 62 40 70Z', robe),
      Pn('M62 70 Q68 112 72 154 Q82 156 92 152 Q88 112 80 70Z', robeD, ' opacity=".4"'),
      P('M28 146 Q60 156 92 146 L92 153 Q60 162 28 153Z', trim),
      L_('M44 94 Q40 124 36 150', '#ffffff', 1, ' opacity=".18"'),
      // stars on the robe
      ...[[48, 120], [70, 132], [56, 140], [76, 110]].map(([x, y]) => P('M' + x + ' ' + (y - 4) + ' L' + (x + 1.2) + ' ' + (y - 1.2) + ' L' + (x + 4) + ' ' + y + ' L' + (x + 1.2) + ' ' + (y + 1.2) + ' L' + x + ' ' + (y + 4) + ' L' + (x - 1.2) + ' ' + (y + 1.2) + ' L' + (x - 4) + ' ' + y + ' L' + (x - 1.2) + ' ' + (y - 1.2) + 'Z', '#f5c242', ' stroke-width="0.6"')),
      // belt with gem
      P('M40 98 Q60 106 80 98 L80 105 Q60 113 40 105Z', trim), Eo(60, 106, 4, 4, c.lg(['#ff9ad0', '#c02a7a'])),
      // sleeves and hands
      P('M40 72 Q26 84 22 100 L34 104 Q38 90 48 82Z', robe), Eo(26, 103, 5, 4.5, skin),
      P('M78 72 Q94 82 94 98 L84 102 Q80 88 72 82Z', robe), Eo(90, 100, 5, 4.5, skin),
      // spell spark in the free hand
      C(96, 92, 10, c.rg([['#ffffff', 0.9], ['#7fd6e8', 0.5], ['#7fd6e8', 0]])),
      // head: face and long beard
      P('M46 46 Q46 32 60 30 Q74 32 74 46 Q74 58 60 62 Q46 58 46 46Z', skin),
      E(54, 46, 2, 2.4, '#1a2440'), E(66, 46, 2, 2.4, '#1a2440'), C(54.6, 45.2, 0.7, '#ffffff'), C(66.6, 45.2, 0.7, '#ffffff'),
      L_('M50 41 Q54 39 57 41 M63 41 Q66 39 70 41', '#e8eef6', 2),
      P('M46 50 Q48 60 52 56 Q56 62 60 58 Q64 62 68 56 Q72 60 74 50 Q76 72 66 88 Q60 96 54 88 Q44 72 46 50Z', beard),
      L_('M56 66 Q58 78 60 88 M64 66 Q63 76 62 84', '#9aa6b8', 0.9),
      P('M52 54 Q60 50 68 54 Q60 58 52 54Z', '#e8eef6'),
      // wide hat
      P('M28 34 Q60 22 94 34 Q86 40 60 38 Q34 40 28 34Z', c.lg([lit(c.t('#2a4ea6'), 0.05), c.t('#16285c')])),
      P('M44 34 Q44 14 56 4 Q66 -6 78 -4 Q66 4 68 14 L74 34 Q60 38 44 34Z', robe),
      Pn('M62 6 Q70 10 70 20 L74 34 Q68 36 64 36 Q66 18 62 6Z', robeD, ' opacity=".45"'),
      P('M44 28 Q60 34 74 28 L75 34 Q60 40 44 34Z', trim),
      P('M58 16 L59.4 19.6 L63 21 L59.4 22.4 L58 26 L56.6 22.4 L53 21 L56.6 19.6Z', '#fff0b8', ' stroke-width="0.8"'),
    ].join('');
  } };

  // The Enchanter (John, 2026-11-24): the old shopkeeper behind the counter, hooded, half-moon spectacles,
  // a long braided beard, a rune stole and a crystal held in both hands. Faces right like the heroes; the shop flips him.
  ART.enchanter = { w: 120, h: 160, draw(c) {
    const robe = c.mat('#5b2f8f'), robeD = c.t('#2a1450'), lining = c.mat('#1f8a86'), trim = c.lg(['#fff0b8', '#f5c242', '#a87418']);
    const skin = c.lg([SK.light, SK.mid], 0, 0, 1, 1), beard = c.lg(['#ffffff', '#dfe5ee', '#a3aec0'], 0, 0, 0, 1);
    const star = (x, y, r, col) => P('M' + x + ' ' + (y - r) + ' L' + (x + r * 0.3) + ' ' + (y - r * 0.3) + ' L' + (x + r) + ' ' + y + ' L' + (x + r * 0.3) + ' ' + (y + r * 0.3) + ' L' + x + ' ' + (y + r) + ' L' + (x - r * 0.3) + ' ' + (y + r * 0.3) + ' L' + (x - r) + ' ' + y + ' L' + (x - r * 0.3) + ' ' + (y - r * 0.3) + 'Z', col, ' stroke-width="0.6"');
    return [
      // robe, wide at the hem
      P('M36 66 Q26 110 20 152 Q60 162 100 152 Q94 110 84 66 Q60 56 36 66Z', robe),
      Pn('M64 66 Q72 110 78 156 Q90 156 100 152 Q94 110 84 66Z', robeD, ' opacity=".45"'),
      L_('M42 84 Q36 120 30 150', '#ffffff', 1.2, ' opacity=".16"'),
      P('M20 146 Q60 157 100 146 L100 153 Q60 164 20 153Z', trim),
      ...[[34, 138], [52, 146], [72, 146], [88, 138]].map(([x, y]) => star(x, y, 3, '#fff0b8')),
      // rune stole hanging from the shoulders
      P('M46 66 L52 66 L54 140 L44 142Z', lining), P('M68 66 L74 66 L76 142 L66 140Z', lining),
      ...[[49, 92], [49, 112], [49, 130], [71, 92], [71, 112], [71, 130]].map(([x, y]) => L_('M' + (x - 2) + ' ' + (y - 3) + ' L' + (x + 2) + ' ' + (y - 3) + ' L' + x + ' ' + (y + 3) + 'Z', '#a8fff4', 1, ' opacity=".9"')),
      P('M43 140 L55 138 L56 146 L42 148Z', trim), P('M65 138 L77 140 L78 148 L64 146Z', trim),
      // belt of little vials
      P('M36 100 Q60 108 84 100 L84 107 Q60 115 36 107Z', c.mat('#6a3f1e')),
      ...[[40, '#f472b6'], [79, '#34d399'], [85, '#60a5fa']].map(([x, col]) => P('M' + (x - 2.5) + ' 106 H' + (x + 2.5) + ' V114 Q' + x + ' 118 ' + (x - 2.5) + ' 114Z', col, ' stroke-width="1.2"')),
      // the crystal, held out in both hands
      C(86, 84, 26, c.rg([['#f5e9ff', 0.85], ['#c084fc', 0.45], ['#7c3aed', 0]]), ''),
      P('M36 70 Q22 82 30 96 Q50 102 76 94 L72 86 Q52 90 44 84Z', robe),
      P('M82 70 Q98 80 92 96 L78 98 Q80 88 74 82Z', robe),
      Eo(78, 96, 5.5, 4.5, skin), Eo(93, 95, 5, 4.5, skin),
      P('M86 66 L97 84 L86 100 L75 84Z', c.lg(['#ffffff', '#e9d5ff', '#a855f7', '#6d28d9'], 0, 0, 1, 1), ' stroke-width="1.6"'),
      L_('M86 70 L80 84 L86 96', '#ffffff', 1.1, ' opacity=".85"'), L_('M86 66 V100 M75 84 H97', '#f5e9ff', 0.6, ' opacity=".6"'),
      // hood: violet outside, teal lining around the face
      P('M32 62 Q28 30 46 12 Q58 0 70 4 Q90 12 90 46 Q92 62 84 70 Q60 60 36 70Z', robe),
      Pn('M72 8 Q90 16 90 46 Q90 60 84 70 Q80 40 72 8Z', robeD, ' opacity=".5"'),
      P('M42 60 Q40 32 60 24 Q80 30 78 60 Q60 68 42 60Z', lining),
      // face, bushy brows, half-moon spectacles
      P('M47 44 Q47 31 60 30 Q73 31 73 44 Q73 56 60 60 Q47 56 47 44Z', skin),
      E(55, 45, 1.9, 2.2, '#1a2440'), E(66, 45, 1.9, 2.2, '#1a2440'), C(55.6, 44.3, 0.7, '#ffffff'), C(66.6, 44.3, 0.7, '#ffffff'),
      P('M49 40 Q54 36 58 39 Q54 39 49 41Z', '#eef2f7', ' stroke-width="1"'), P('M63 39 Q67 36 72 40 L72 41 Q67 39 63 39Z', '#eef2f7', ' stroke-width="1"'),
      L_('M51 46 Q55 50 59 46 M62 46 Q66 50 70 46 M59 46 H62', '#f5c242', 1.1),
      E(52, 51, 2.6, 1.5, '#ff8a7a', ' opacity=".3"'), E(69, 51, 2.6, 1.5, '#ff8a7a', ' opacity=".3"'),
      // long beard, braided at the tip with a gold ring
      P('M47 48 Q49 58 54 55 Q57 60 60 57 Q63 60 66 55 Q71 58 73 48 Q76 66 68 80 Q64 86 62 96 L58 96 Q56 86 52 80 Q44 66 47 48Z', beard),
      P('M56.5 52 Q60 49 63.5 52 Q60 55 56.5 52Z', '#eef2f7', ' stroke-width="1"'),
      L_('M56 64 Q58 74 59 86 M64 64 Q63 74 61 86', '#a3aec0', 0.9),
      P('M57 94 H63 V99 H57Z', trim, ' stroke-width="1.2"'), P('M58 99 Q60 108 62 99Z', beard, ' stroke-width="1.2"'),
      // a gold rim on the hood
      
      L_('M42 60 Q40 32 60 24 Q80 30 78 60', '#f5c242', 1.2, ' opacity=".75"'),
    ].join('');
  } };
  // The Armorer (John, 2026-11-24): a broad smith with a braided red beard, leather apron and a hammer on his shoulder.
  ART.armorer = { w: 120, h: 160, draw(c) {
    const shirt = c.mat('#c8b48a'), apron = c.mat('#6b4426'), apronD = c.t('#3a2414'), skin = c.lg([SK.mid, SK.dark], 0, 0, 1, 1);
    const beard = c.lg(['#e0703a', '#b8461e', '#7a2a10'], 0, 0, 0, 1), iron = c.lg(['#e6edf5', '#9aa6b8', '#5a6478'], 0, 0, 1, 1), wood = c.lg(['#9a6a3a', '#5a3a1c'], 0, 0, 1, 0);
    return [
      // legs and boots
      P('M44 120 H58 V150 H44Z', c.mat('#4a3a2a')), P('M62 120 H76 V150 H62Z', c.mat('#4a3a2a')),
      P('M40 146 H60 V156 H38Z', c.mat('#2a1e14')), P('M60 146 H80 L82 156 H60Z', c.mat('#2a1e14')),
      // broad torso in a work shirt
      P('M30 70 Q28 100 36 124 H84 Q92 100 90 70 Q60 58 30 70Z', shirt),
      // leather apron with a pocket and rivets
      P('M38 78 H82 L86 140 Q60 146 34 140Z', apron), Pn('M62 78 H82 L86 140 Q74 144 64 144Z', apronD, ' opacity=".4"'),
      P('M48 108 H72 V122 H48Z', c.mat('#5a3820'), ' stroke-width="1.6"'), C(50, 110, 1.2, '#f5c242'), C(70, 110, 1.2, '#f5c242'),
      L_('M38 80 Q60 72 82 80', '#3a2414', 2.2),
      // big forearms, sleeves rolled
      P('M30 72 Q18 86 20 104 L32 106 Q34 92 40 84Z', shirt), Eo(24, 108, 7, 6, skin),
      P('M90 72 Q102 80 100 96 L90 100 Q88 88 82 82Z', shirt), Eo(96, 98, 7, 6, skin),
      L_('M20 98 Q26 96 32 99 M90 92 Q96 90 100 93', '#a8946a', 1.4),
      // a hammer in his fist
      G(P('M-2 0 H2 V38 H-2Z', wood) + P('M-10 36 H10 V48 H-10Z', iron) + L_('M-8 38 H8', '#ffffff', 1, ' opacity=".6"'), 'translate(97 100) rotate(-12)'),
      // head: bald, bushy brows, a braided red beard
      P('M44 42 Q44 24 60 22 Q76 24 76 42 Q76 56 60 60 Q44 56 44 42Z', skin),
      Pn('M50 26 Q60 22 70 26 Q66 24 60 24 Q54 24 50 26Z', '#ffffff', ' opacity=".35"'),
      Eo(43, 44, 3.4, 4.6, skin, ' stroke-width="1.6"'), Eo(77, 44, 3.4, 4.6, skin, ' stroke-width="1.6"'),
      P('M48 36 Q53 32 58 35 L58 37 Q53 35 48 38Z', '#b8461e', ' stroke-width="1"'), P('M62 35 Q67 32 72 36 L72 38 Q67 35 62 37Z', '#b8461e', ' stroke-width="1"'),
      E(53, 41, 1.9, 2.2, '#1a2440'), E(67, 41, 1.9, 2.2, '#1a2440'), C(53.6, 40.3, 0.7, '#ffffff'), C(67.6, 40.3, 0.7, '#ffffff'),
      P('M57 44 Q60 50 63 44Z', SK.dark, ' stroke-width="1"'),
      P('M44 44 Q46 56 52 54 Q56 58 60 55 Q64 58 68 54 Q74 56 76 44 Q80 62 72 76 Q66 84 62 98 L58 98 Q54 84 48 76 Q40 62 44 44Z', beard),
      P('M52 50 Q60 46 68 50 Q60 55 52 50Z', '#e0703a', ' stroke-width="1"'),
      L_('M54 62 Q58 70 59 80 M66 62 Q63 70 61 80', '#7a2a10', 1),
      P('M57 82 H63 V86 H57Z', iron, ' stroke-width="1"'), P('M57 90 H63 V94 H57Z', iron, ' stroke-width="1"'),
      // soot smudge
      E(70, 48, 3, 1.6, '#3a2a20', ' opacity=".35"'),
    ].join('');
  } };
  // The Quartermaster, Old Thessaly (John, 2026-11-24, v107): keeps the Store. Grey hair in a bun, a green shawl over a
  // russet dress, an apron with a ledger pencil, and a tonic held up for the party to see.
  ART.quartermaster = { w: 120, h: 160, draw(c) {
    const dress = c.mat('#8a3b2a'), dressD = c.t('#4a1a12'), shawl = c.mat('#2f7d55'), shawlD = c.t('#14432c'), apron = c.lg(['#f6efe0', '#d9cdb4'], 0, 0, 1, 1);
    const skin = c.lg([SK.light, SK.mid], 0, 0, 1, 1), hair = c.lg(['#f4f4f6', '#c9ccd6', '#8e93a3'], 0, 0, 0, 1), glass = c.lg(['#ffffff', '#bff3d4', '#22c55e'], 0, 0, 1, 1);
    return [
      // long dress to the floor
      P('M38 70 Q30 110 26 152 Q60 160 94 152 Q90 110 82 70 Q60 60 38 70Z', dress),
      Pn('M64 70 Q72 110 76 156 Q86 156 94 152 Q90 110 82 70Z', dressD, ' opacity=".45"'),
      // apron with a pocket and a pencil
      P('M44 84 H76 L80 146 Q60 152 40 146Z', apron),
      P('M50 112 H70 V126 H50Z', c.mat('#e8dcc0'), ' stroke-width="1.4"'), P('M64 104 L66 104 L66 116 L64 116Z', '#f5c242', ' stroke-width="0.8"'),
      L_('M44 86 Q60 80 76 86', '#a8946a', 1.6),
      // shawl over the shoulders, knotted at the chest
      P('M30 72 Q60 56 90 72 Q86 92 60 96 Q34 92 30 72Z', shawl), Pn('M60 60 Q86 64 90 72 Q86 90 64 95Z', shawlD, ' opacity=".4"'),
      ...[[36, 86], [44, 91], [52, 94], [68, 94], [76, 91], [84, 86]].map(([x, y]) => L_('M' + x + ' ' + y + ' L' + x + ' ' + (y + 6), '#1f5c3c', 1.2)),
      P('M56 88 Q60 84 64 88 Q60 92 56 88Z', shawlD),
      // arms: one at her side, one raising a green tonic
      P('M30 74 Q22 96 28 112 L38 110 Q36 96 40 86Z', dress), Eo(32, 114, 5.5, 5, skin),
      P('M86 74 Q100 78 98 92 L90 96 Q88 86 82 82Z', dress), Eo(95, 92, 5.5, 5, skin),
      C(96, 78, 16, c.rg([['#d9ffe9', 0.7], ['#4ade80', 0.3], ['#16a34a', 0]]), ''),
      P('M92 66 H100 V72 Q106 76 106 82 Q106 90 96 90 Q86 90 86 82 Q86 76 92 72Z', glass, ' stroke-width="1.4"'),
      P('M91 62 H101 V66 H91Z', c.mat('#8a5a2a'), ' stroke-width="1"'), L_('M90 80 Q96 84 102 80', '#ffffff', 1, ' opacity=".7"'),
      // head, grey bun, kind face, round spectacles
      C(60, 22, 9, hair), L_('M53 20 Q60 16 67 20', '#8e93a3', 1),
      P('M46 42 Q46 26 60 25 Q74 26 74 42 Q74 56 60 60 Q46 56 46 42Z', skin),
      P('M45 42 Q44 24 60 23 Q76 24 75 42 Q72 32 60 31 Q48 32 45 42Z', hair),
      E(54, 44, 1.8, 2.1, '#1a2440'), E(66, 44, 1.8, 2.1, '#1a2440'), C(54.6, 43.3, 0.7, '#ffffff'), C(66.6, 43.3, 0.7, '#ffffff'),
      L_('M50.5 44 A3.6 3.6 0 1 0 57.5 44 A3.6 3.6 0 1 0 50.5 44 M62.5 44 A3.6 3.6 0 1 0 69.5 44 A3.6 3.6 0 1 0 62.5 44 M57.5 43.5 H62.5', '#b08a3a', 1),
      P('M55 51 Q60 55 65 51', 'none', ' stroke-width="1.3"'),
      E(51, 50, 2.6, 1.5, '#ff8a7a', ' opacity=".35"'), E(69, 50, 2.6, 1.5, '#ff8a7a', ' opacity=".35"'),
      L_('M49 38 Q53 36 57 38 M63 38 Q67 36 71 38', '#a3a8b6', 1.1),
    ].join('');
  } };
  ART.necro = { w: 120, h: 160, draw(c) {
    const robe = c.mat('#4c3280'), robeD = c.t('#1e1236'), trim = c.lg(['#c9c2d8', '#8a7fa8']), bone = c.lg(['#fffaf0', '#e8dfc8', '#a89c80']);
    const wood = c.lg(['#4a3a2a', '#1e140c'], 0, 0, 1, 0), green = '#7affc8';
    return [
      // scythe-staff with skull
      G(P('M-2.5 0 H2.5 V132 H-2.5Z', wood) + L_('M-1 6 V126', '#6a5a48', 0.8) +
        P('M2 6 Q36 -4 52 22 Q34 8 4 16Z', c.lg(['#e6edf5', '#8a98aa', '#3a4454'], 0, 0, 1, 1)) + L_('M6 9 Q32 2 48 18', '#ffffff', 0.8, ' opacity=".7"') +
        C(0, -6, 20, c.rg([[green, 0.55], [green, 0.15], [green, 0]])) +
        P('M-9 -6 Q-10 -20 0 -21 Q10 -20 9 -6 Q9 0 5 2 L5 5 H-5 L-5 2 Q-9 0 -9 -6Z', bone) +
        E(-3.6, -9, 2.6, 3, '#14101c') + E(3.6, -9, 2.6, 3, '#14101c') + C(-3.6, -9, 1.1, green) + C(3.6, -9, 1.1, green) +
        L_('M-3 3 V5 M0 3 V5 M3 3 V5', '#14101c', 0.9), 'translate(88 26)'),
      // robe with tattered hem
      P('M38 70 Q30 112 26 148 L32 154 L38 148 L44 156 L52 150 L60 158 L68 150 L76 156 L84 148 L90 154 Q88 112 80 70 Q60 62 38 70Z', robe),
      Pn('M62 70 Q68 112 72 152 L76 156 L84 148 L90 154 Q88 112 80 70Z', robeD, ' opacity=".5"'),
      L_('M44 92 Q40 120 36 146', '#ffffff', 1, ' opacity=".14"'),
      // bone clasp chain and rune belt
      P('M40 100 Q60 108 80 100 L80 106 Q60 114 40 106Z', '#20142e'),
      ...[46, 54, 62, 70, 76].map((x, i) => E(x, 104 + (i % 2), 2.4, 1.8, '#e8dfc8', ' stroke="' + OUT + '" stroke-width="0.8"')),
      L_('M52 118 L56 126 L52 134 M66 120 L62 128 L66 136', green, 1.2, ' opacity=".65"'),
      // sleeves with bony hands
      P('M40 72 Q28 86 30 104 L40 104 Q40 90 48 80Z', robe), P('M30 102 L28 110 M33 104 L32 112 M36 104 L37 111', 'none', ' stroke="#e8dfc8" stroke-width="2" stroke-linecap="round"'),
      P('M78 72 Q92 82 92 96 L84 100 Q80 88 72 82Z', robe), Eo(88, 98, 4.5, 4, '#cfc6b0'),
      // cowl with skull mantle
      P('M34 54 Q32 14 59 8 Q86 14 84 54 Q80 72 59 76 Q38 72 34 54Z', c.mat('#3b2563')),
      Pn('M68 14 Q86 24 84 52 Q80 68 68 74 Q80 48 68 14Z', '#000000', ' opacity=".3"'),
      L_('M37 52 Q36 20 59 12', '#ffffff', 1.2, ' opacity=".18"'),
      P('M44 46 Q44 28 59 26 Q74 28 74 46 Q72 62 59 66 Q46 62 44 46Z', '#0e0a18'),
      eye(c, 53, 44, 2.2, green), eye(c, 66, 44, 2.2, green),
      // shoulder skull mantle
      P('M30 64 Q38 58 46 64 Q44 74 36 74 Q28 72 30 64Z', bone), E(35, 66, 1.6, 2, '#14101c'), E(41, 66, 1.6, 2, '#14101c'),
      P('M72 64 Q80 58 88 64 Q90 72 82 74 Q74 74 72 64Z', bone), E(77, 66, 1.6, 2, '#14101c'), E(83, 66, 1.6, 2, '#14101c'),
      // floating souls
      C(22, 70, 4, c.rg([[green, 0.8], [green, 0]])), C(100, 60, 3, c.rg([[green, 0.8], [green, 0]])),
    ].join('');
  } };

  // skeleton raised by the necromancer: 80 x 90, standing on y = 88, facing right
  ART.minion = { w: 80, h: 90, draw(c) {
    const bone = c.lg(['#fffaf0', '#e2d8c0', '#9c9078']), green = '#7affc8';
    return [
      C(40, 50, 34, c.rg([[green, 0.18], [green, 0]])),
      L_('M34 64 L30 86 M46 64 L50 86', '#e2d8c0', 4.5), L_('M34 64 L30 86 M46 64 L50 86', OUT, 0.8, ' opacity=".5"'),
      E(28, 87, 6, 2.5, '#d8cfb8', ' stroke="' + OUT + '" stroke-width="1.6"'), E(52, 87, 6, 2.5, '#d8cfb8', ' stroke="' + OUT + '" stroke-width="1.6"'),
      P('M32 60 Q40 56 48 60 L46 68 H34Z', bone),
      L_('M40 34 V60', '#d8cfb8', 3.5),
      ...[38, 44, 50].map(y => L_('M30 ' + y + ' Q40 ' + (y + 4) + ' 50 ' + y, '#e2d8c0', 2.6)),
      L_('M30 36 L22 50 L28 60 M50 36 L60 46 L68 40', '#e2d8c0', 3.4),
      P('M66 30 L72 42 L64 40Z', c.lg(['#ffffff', '#8a98aa']), ''),
      P('M28 22 Q26 6 40 4 Q54 6 52 22 Q52 28 46 30 L46 34 H34 L34 30 Q28 28 28 22Z', bone),
      E(34, 18, 4, 4.6, '#14101c'), E(46, 18, 4, 4.6, '#14101c'), eye(c, 34, 18, 1.6, green), eye(c, 46, 18, 1.6, green),
      L_('M36 30 V33 M40 30 V33 M44 30 V33', '#14101c', 1),
      Pn('M30 12 Q34 6 40 6', 'none', ' stroke="#ffffff" stroke-width="1.4" opacity=".7"'),
    ].join('');
  } };
  // ---------------- monsters: 160 x 160 on y = 156, facing right (the arena flips them) ----------------
  const F = (draw, w, h) => ({ w: w || 160, h: h || 160, draw });
  const spikes = (cx, cy, r, n, len, fill) => { let d = ''; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.35, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; d += P('M' + (x - 3) + ' ' + (y + 2) + ' L' + (cx + Math.cos(a) * (r + len)) + ' ' + (cy + Math.sin(a) * (r + len)) + ' L' + (x + 3) + ' ' + (y + 2) + 'Z', fill); } return d; };

  ART.slime = F(c => {
    const g = c.t('#5fbf5a'), body = c.rg([[lit(g, 0.25), 0.95], [g, 0.92], [lit(g, -0.22), 0.95]], 0.38, 0.32, 0.75);
    return [
      E(80, 152, 54, 6, lit(g, -0.3), ' opacity=".5"'),
      P('M24 150 Q14 120 34 96 Q50 70 80 66 Q112 68 128 96 Q146 122 136 150 Q122 158 108 150 Q100 158 92 151 Q82 158 70 151 Q58 158 48 150 Q36 158 24 150Z', body),
      C(56, 120, 6, lit(g, 0.3), ' opacity=".45"'), C(104, 128, 4, lit(g, 0.3), ' opacity=".45"'), C(90, 140, 3, lit(g, 0.35), ' opacity=".5"'), C(66, 138, 2.5, lit(g, 0.35), ' opacity=".5"'),
      C(118, 108, 7, c.rg([['#fff6c0', 0.9], ['#d8a83a', 0.6]]), ' stroke="' + OUT + '" stroke-width="1.2" opacity=".85"'),
      Pn('M40 96 Q52 74 76 72 Q56 82 48 100Z', '#ffffff', ' opacity=".55"'), E(46, 106, 3, 4, '#ffffff', ' opacity=".6"'),
      Eo(66, 102, 11, 13, '#f4fbe8'), Eo(98, 102, 11, 13, '#f4fbe8'),
      E(70, 104, 5.5, 7, '#14200f'), E(102, 104, 5.5, 7, '#14200f'), C(72, 101, 2, '#ffffff'), C(104, 101, 2, '#ffffff'),
      P('M68 124 Q84 136 100 124 Q96 132 84 134 Q72 132 68 124Z', lit(g, -0.35)),
      Pn('M120 148 Q122 156 120 160 Q118 156 118 150Z', g, ' opacity=".9"'),
    ].join('');
  });

  ART.shard = F(c => {
    const cr = c.t('#7fd6e8'), face = (d, k) => P(d, c.lg([lit(cr, 0.3 - k), lit(cr, -k), lit(cr, -0.25 - k)], 0, 0, 1, 1));
    const leg = (x, y, dx, flip) => P('M' + x + ' ' + y + ' L' + (x + dx * 0.6) + ' ' + (y - 22) + ' L' + (x + dx) + ' ' + (y + 30) + ' L' + (x + dx * 0.9) + ' ' + (y + 31) + ' L' + (x + dx * 0.45) + ' ' + (y - 14) + ' L' + (x + (flip ? -4 : 4)) + ' ' + (y + 4) + 'Z', c.lg([lit(cr, 0.15), lit(cr, -0.3)]));
    return [
      E(80, 152, 60, 6, '#000', ' opacity=".35"'),
      leg(52, 116, -30, 1), leg(60, 120, -18, 1), leg(104, 116, 30), leg(96, 120, 18),
      face('M80 60 L118 92 L106 132 L80 140 L54 132 L42 92Z', 0),
      face('M80 60 L118 92 L92 100Z', -0.12), face('M80 60 L42 92 L68 100Z', 0.08), face('M68 100 L92 100 L80 140Z', 0.14),
      face('M42 92 L54 132 L68 100Z', 0.2), face('M118 92 L106 132 L92 100Z', 0.05),
      L_('M80 64 L80 96 M50 94 L76 98', '#ffffff', 1.2, ' opacity=".7"'),
      face('M66 60 L72 34 L78 62Z', -0.1), face('M86 58 L96 28 L98 64Z', 0.02), face('M104 72 L122 50 L114 82Z', 0.08),
      eye(c, 72, 108, 3.5, '#ff5ad0'), eye(c, 92, 106, 4.5, '#ff5ad0'), eye(c, 82, 120, 2.6, '#ff5ad0'),
      C(80, 100, 44, c.rg([['#d6fbff', 0.15], ['#d6fbff', 0]])),
    ].join('');
  });

  ART.sentinel = F(c => {
    const iron = c.lg(['#c2ad8e', '#8a7458', '#4a3c2c'], 0, 0, 1, 1), ironD = c.lg(['#8a7458', '#3a2e22']), rust = c.t('#9a4a2a');
    const rivet = (x, y) => C(x, y, 1.8, '#e0caa0', ' stroke="' + OUT + '" stroke-width=".8"');
    return [
      E(80, 152, 50, 6, '#000', ' opacity=".4"'),
      P('M56 118 H72 V150 H52Z', ironD), P('M88 118 H104 L108 150 H88Z', iron),
      P('M48 146 H76 V156 H46Z', ironD), P('M86 146 H112 L114 156 H86Z', ironD),
      P('M46 60 Q80 46 114 60 L110 120 Q80 130 50 120Z', iron),
      Pn('M86 52 Q104 54 114 60 L110 120 Q98 125 86 126Z', '#000', ' opacity=".25"'),
      L_('M50 76 H110 M52 100 H108', OUT, 1.6), ...[56, 70, 90, 104].map(x => rivet(x, 70) + rivet(x, 94) + rivet(x, 116)),
      Pn('M60 104 Q66 98 74 106 Q68 112 60 104Z', rust, ' opacity=".7"'), Pn('M96 80 Q104 76 106 86 Q100 90 96 80Z', rust, ' opacity=".7"'),
      C(80, 88, 12, '#1a120c', ' stroke="' + OUT + '" stroke-width="2"'), C(80, 88, 7, c.rg([['#fff0b0'], ['#ff8a3d'], ['#a8300c']])), C(80, 88, 20, c.rg([['#ff8a3d', 0.5], ['#ff8a3d', 0]])),
      // arms
      P('M44 62 Q28 70 26 96 L32 118 L44 114 L40 94 Q48 80 52 70Z', iron), P('M22 114 H46 L44 130 H24Z', ironD),
      P('M116 62 Q132 70 134 96 L128 118 L116 114 L120 94 Q112 80 108 70Z', iron), P('M114 114 H138 L136 130 H116Z', ironD),
      // head
      P('M62 34 Q80 20 98 34 L96 56 Q80 62 64 56Z', iron), P('M66 40 H94 V48 H66Z', '#1a120c'),
      eye(c, 82, 44, 3.2, '#ff8a3d'), rivet(68, 52), rivet(92, 52), L_('M70 30 L66 18 M90 30 L94 18', '#4a3c2c', 2.4),
      L_('M50 64 Q80 52 110 64', '#ffffff', 1.2, ' opacity=".35"'),
    ].join('');
  });

  ART.eel = F(c => {
    const sk = c.t('#3a8aa8'), body = c.lg([lit(sk, 0.18), sk, lit(sk, -0.25)], 0, 0, 1, 0), belly = c.lg(['#f0e6c0', '#c0b088']);
    return [
      E(80, 148, 66, 10, c.t('#1a4a5a'), ' opacity=".8" stroke="' + OUT + '" stroke-width="2"'), E(80, 146, 56, 6, c.t('#4aa8c0'), ' opacity=".5"'),
      L_('M34 146 Q44 142 52 146 M100 148 Q110 144 120 148', '#d6fbff', 1.2, ' opacity=".7"'),
      P('M54 148 Q40 110 60 84 Q80 58 104 52 Q124 50 130 64 Q120 60 108 66 Q86 80 80 104 Q76 126 92 148Z', body),
      Pn('M60 144 Q52 110 66 88 Q76 76 86 72 Q72 92 70 110 Q68 128 76 146Z', belly, ' opacity=".9"'),
      P('M84 66 L90 44 L98 58 L104 40 L110 54 L118 42 L120 58Z', c.lg([lit(sk, 0.3), c.t('#e8604a')], 0, 0, 0, 1)),
      // head
      P('M96 54 Q118 40 142 52 Q152 60 148 70 Q132 82 112 80 Q100 76 96 54Z', body),
      P('M118 70 Q132 78 148 70 Q144 82 126 84 Q116 82 118 70Z', '#3a0e14'),
      ...[122, 128, 134, 140].map(x => P('M' + x + ' 71 L' + (x + 2) + ' 77 L' + (x + 4) + ' 71Z', '#ffffff', ' stroke-width="1"')),
      eye(c, 124, 58, 3.4, '#ffd84a'), L_('M114 52 Q124 48 132 52', '#ffffff', 1.4, ' opacity=".5"'),
      ...[[70, 100], [78, 88], [66, 120]].map(([x, y]) => E(x, y, 3, 2, lit(sk, 0.3), ' opacity=".6"')),
    ].join('');
  });

  ART.thorn = F(c => {
    const vine = c.lg([c.t('#6a9a3a'), c.t('#2e4a1a')], 0, 0, 1, 1), bark = c.lg([c.t('#7a5a34'), c.t('#3a2614')]), leaf = c.mat('#5aa83a');
    const thorn = (x, y, a) => P('M' + x + ' ' + y + ' l' + (Math.cos(a) * 12) + ' ' + (Math.sin(a) * 12) + ' l' + (Math.cos(a + 1.6) * 5) + ' ' + (Math.sin(a + 1.6) * 5) + 'Z', '#e8d8a8', ' stroke-width="1.2"');
    return [
      E(80, 152, 54, 6, '#000', ' opacity=".4"'),
      P('M46 150 Q44 120 56 104 L62 112 Q56 130 60 150Z', bark), P('M104 150 Q110 124 100 104 L94 112 Q100 130 96 150Z', bark),
      P('M36 106 Q30 70 56 52 Q80 38 104 52 Q130 70 124 106 Q110 126 80 128 Q50 126 36 106Z', vine),
      L_('M44 90 Q64 70 84 80 Q104 90 118 72 M46 108 Q70 96 92 108 Q108 116 120 104 M60 60 Q74 74 70 96', c.t('#2a3e14'), 4),
      L_('M44 90 Q64 70 84 80 Q104 90 118 72', lit(c.t('#8aba4a'), 0.05), 1.4),
      thorn(40, 80, -2.6), thorn(56, 54, -2), thorn(100, 50, -1.1), thorn(124, 86, -0.4), thorn(116, 114, 0.5), thorn(44, 116, 2.6), thorn(80, 44, -1.6),
      P('M70 40 Q60 20 74 10 Q78 26 76 40Z', leaf), P('M88 40 Q104 22 118 28 Q104 36 92 44Z', leaf),
      P('M60 88 Q80 80 100 88 Q98 106 80 108 Q62 106 60 88Z', '#1a2410'),
      eye(c, 70, 94, 3.4, '#ff4a3a'), eye(c, 92, 94, 3.4, '#ff4a3a'),
      P('M68 104 L72 100 L76 104 L80 100 L84 104 L88 100 L92 104', 'none', ' stroke="#e8d8a8" stroke-width="1.6"'),
      ...[[52, 72], [112, 98]].map(([x, y]) => C(x, y, 5, c.lg(['#ff9ac0', '#c02a6a']), ' stroke="' + OUT + '" stroke-width="1.4"')),
    ].join('');
  });

  ART.prism = F(c => {
    const gl = c.t('#9fb4ff'), facet = k => c.lg([lit(gl, 0.25 - k), lit(gl, -k), lit(gl, -0.3 - k)], 0, 0, 1, 1);
    return [
      E(80, 150, 34, 4, '#000', ' opacity=".35"'),
      C(80, 78, 64, c.rg([[lit(gl, 0.2), 0.35], [gl, 0]])),
      L_('M40 40 L52 60 L44 66 L58 86 M122 34 L110 56 L120 60 L104 84 M36 118 L54 108 L50 98 L66 94 M126 120 L110 108 L114 98 L98 92', '#e9fdff', 2.2, ' filter="' + c.glowF(1.6) + '"'),
      L_('M40 40 L52 60 L44 66 L58 86 M122 34 L110 56 L120 60 L104 84', '#ffffff', 1),
      P('M80 26 L116 66 L102 118 L80 132 L58 118 L44 66Z', facet(0)),
      P('M80 26 L116 66 L80 74Z', facet(-0.1)), P('M80 26 L44 66 L80 74Z', facet(0.08)), P('M44 66 L58 118 L80 74Z', facet(0.18)), P('M116 66 L102 118 L80 74Z', facet(0.04)), P('M58 118 L80 132 L102 118 L80 74Z', facet(0.12)),
      C(80, 80, 16, '#0e1430', ' stroke="' + OUT + '" stroke-width="2"'), C(80, 80, 11, c.rg([['#ffffff'], ['#bfe8ff'], ['#4a78ff']])), C(80, 80, 4, '#0a0e20'), C(77, 77, 2, '#ffffff'),
      L_('M78 30 L60 64', '#ffffff', 1.4, ' opacity=".8"'),
      ...[[34, 74], [128, 82], [80, 14]].map(([x, y]) => P('M' + x + ' ' + (y - 7) + ' L' + (x + 4) + ' ' + y + ' L' + x + ' ' + (y + 7) + ' L' + (x - 4) + ' ' + y + 'Z', facet(0.05))),
    ].join('');
  });

  ART.hound = F(c => {
    const fur = c.lg([c.t('#4a4a66'), c.t('#24243a'), c.t('#12121e')], 0, 0, 1, 1), rift = '#c07aff';
    return [
      E(80, 152, 62, 6, '#000', ' opacity=".45"'),
      P('M34 104 Q20 96 14 76 Q26 86 38 88Z', fur),
      P('M44 120 L40 150 L52 150 L56 122Z', fur), P('M64 122 L64 150 L76 150 L74 120Z', fur),
      P('M30 96 Q40 74 76 72 Q104 70 112 84 L108 112 Q90 126 60 124 Q36 122 30 96Z', fur),
      P('M98 118 L100 150 L112 150 L110 116Z', fur), P('M112 112 L120 150 L132 150 L122 108Z', fur),
      ...[[38, 150], [62, 150], [98, 150], [118, 150]].map(([x, y]) => L_('M' + (x + 2) + ' ' + y + ' l-2 4 M' + (x + 7) + ' ' + y + ' l-1 4 M' + (x + 12) + ' ' + y + ' l0 4', '#e8e0d0', 1.4)),
      L_('M50 84 L58 96 L52 104 L62 112 M80 80 L76 94 L86 100', rift, 2.2, ' filter="' + c.glowF(1.4) + '"'), L_('M50 84 L58 96 L52 104 L62 112 M80 80 L76 94 L86 100', '#f3d0ff', 1),
      P('M44 78 L48 62 L56 76 L62 60 L68 74 L74 58 L80 72Z', fur),
      // head
      P('M100 70 Q112 52 132 56 Q150 62 154 76 Q150 88 136 90 Q118 98 104 92Z', fur),
      P('M108 58 L106 36 L120 54Z', fur), P('M120 56 L124 34 L132 56Z', fur), Pn('M110 54 L108 42 L117 53Z', '#6a3a8a'),
      P('M132 84 Q144 92 154 78 Q150 96 136 98 Q126 96 132 84Z', '#2a0a18'),
      ...[136, 142, 148].map(x => P('M' + x + ' 84 L' + (x + 2) + ' 90 L' + (x + 4) + ' 83Z', '#ffffff', ' stroke-width="1"')),
      C(154, 75, 2.4, '#0a0a12'), eye(c, 128, 68, 3.6, '#d06bff'),
      L_('M104 64 Q118 54 136 58', '#9a9ac0', 1.2, ' opacity=".5"'),
    ].join('');
  });

  ART.riftling = F(c => {
    const v = c.t('#6a3ab0'), body = c.rg([[lit(v, 0.2)], [v], [lit(v, -0.3)]], 0.4, 0.35, 0.7);
    return [
      E(80, 152, 40, 5, '#000', ' opacity=".4"'),
      C(80, 96, 58, c.rg([['#c07aff', 0.35], ['#c07aff', 0]])),
      P('M58 120 L52 150 L64 150 L68 124Z', body), P('M92 124 L96 150 L108 150 L102 120Z', body),
      P('M48 96 Q44 64 80 58 Q116 64 112 96 Q110 126 80 130 Q50 126 48 96Z', body),
      P('M52 66 Q36 46 40 26 Q50 46 62 58Z', c.lg(['#2a1a3a', '#0a0612'])), P('M108 66 Q124 46 120 26 Q110 46 98 58Z', c.lg(['#2a1a3a', '#0a0612'])),
      P('M48 92 Q30 96 22 114 L32 116 Q38 104 50 102Z', body), P('M112 92 Q130 96 138 114 L128 116 Q122 104 110 102Z', body),
      L_('M22 114 l-4 6 M26 116 l-1 7 M30 116 l2 6 M138 114 l4 6 M134 116 l1 7 M130 116 l-2 6', '#e8d8ff', 1.6),
      Pn('M60 70 Q74 62 90 64 Q70 70 62 84Z', '#ffffff', ' opacity=".3"'),
      eye(c, 68, 88, 4.2, '#ffe14a'), eye(c, 92, 88, 4.2, '#ffe14a'),
      P('M66 106 Q80 116 94 106 Q90 114 80 116 Q70 114 66 106Z', '#14081e'),
      P('M70 108 L72 112 L74 108Z M86 108 L88 112 L90 108Z', '#ffffff', ' stroke-width=".8"'),
      L_('M64 96 L58 110 L66 118 M98 98 L104 112', '#e9c8ff', 1.4, ' opacity=".8"'),
      P('M108 120 Q130 130 128 150 Q122 136 104 130Z', body),
    ].join('');
  });

  ART.rat = F(c => {
    const fur = c.lg([c.t('#8a7a6a'), c.t('#5a4a3a'), c.t('#2e241a')], 0, 0, 1, 1), pink = '#e89a9a';
    return [
      E(80, 152, 58, 6, '#000', ' opacity=".4"'),
      L_('M30 130 Q4 120 10 96 Q14 84 24 82', pink, 4), L_('M30 130 Q4 120 10 96 Q14 84 24 82', OUT, 0.8, ' opacity=".4"'),
      P('M28 128 Q22 100 46 86 Q74 72 104 82 Q124 92 124 116 Q118 140 84 142 Q46 144 28 128Z', fur),
      L_('M44 96 Q48 104 44 112 M58 90 Q62 100 58 108 M72 88 Q76 98 72 106', OUT, 1, ' opacity=".4"'),
      P('M44 136 L40 150 L56 150 L56 138Z', fur), P('M96 136 L96 150 L112 150 L108 134Z', fur),
      L_('M40 150 l-2 4 M46 150 l0 4 M52 150 l2 4 M96 150 l-2 4 M102 150 l0 4 M108 150 l2 4', pink, 1.6),
      // head
      P('M100 84 Q116 70 136 82 Q154 96 154 108 Q148 116 132 116 Q112 116 100 104Z', fur),
      Eo(108, 76, 10, 12, fur), E(108, 77, 6, 8, pink),
      C(154, 106, 4, '#2a1214', ' stroke="' + OUT + '" stroke-width="1.6"'),
      P('M140 114 H146 V124 H140Z', '#fff6d8', ' stroke-width="1.4"'), L_('M143 114 V123', '#d8c8a0', 0.8),
      L_('M146 104 L164 98 M146 108 L166 108 M146 112 L162 118', '#e8e0d0', 0.9),
      eye(c, 128, 94, 3.2, '#ff3a3a'),
      L_('M104 86 Q118 76 134 84', '#c8b8a8', 1.2, ' opacity=".5"'),
    ].join('');
  });

  ART.bat = F(c => {
    const wing = c.lg([c.t('#5a3a6a'), c.t('#2a1638')], 0, 0, 0, 1), fur = c.mat('#4a3a5a');
    const membrane = (s) => '<g transform="translate(80 0) scale(' + s + ' 1) translate(-80 0)">' +
      P('M76 84 Q60 50 20 44 Q26 58 18 66 Q32 66 30 80 Q44 76 46 90 Q58 86 62 100 Q70 92 76 98Z', wing) +
      L_('M74 86 L24 48 M70 88 L28 74 M68 92 L46 88', '#7a5a8a', 1.4) + '</g>';
    return [
      E(80, 150, 30, 4, '#000', ' opacity=".3"'),
      membrane(1), membrane(-1),
      Eo(80, 92, 20, 24, fur), Pn('M68 80 Q76 72 86 74 Q74 80 70 94Z', '#ffffff', ' opacity=".25"'),
      P('M64 74 L60 52 L74 68Z', fur), P('M96 74 L100 52 L86 68Z', fur), Pn('M65 68 L63 58 L70 66Z', '#c07a9a'), Pn('M95 68 L97 58 L90 66Z', '#c07a9a'),
      eye(c, 72, 88, 3.4, '#ff4a4a'), eye(c, 88, 88, 3.4, '#ff4a4a'),
      P('M74 100 Q80 106 86 100', 'none'), P('M74 100 L76 107 L78 100Z M82 100 L84 107 L86 100Z', '#ffffff', ' stroke-width="1"'),
      L_('M72 114 l-3 8 M88 114 l3 8', '#2a1638', 2.4),
    ].join('');
  });

  ART.skeleton = F(c => {
    const bone = c.lg(['#fffaf0', '#e2d8c0', '#9c9078']), rustS = c.lg(['#d8dee6', '#8a96a6', '#5a4a3a'], 0, 0, 1, 0), wood = c.lg([c.t('#8a5a34'), c.t('#4a2e18')]);
    return [
      E(80, 152, 44, 5, '#000', ' opacity=".4"'),
      L_('M70 112 L64 150 M90 112 L96 150', '#e2d8c0', 5), L_('M70 112 L64 150 M90 112 L96 150', OUT, 1, ' opacity=".35"'),
      E(60, 152, 9, 3.5, '#d8cfb8', ' stroke="' + OUT + '" stroke-width="1.6"'), E(100, 152, 9, 3.5, '#d8cfb8', ' stroke="' + OUT + '" stroke-width="1.6"'),
      P('M64 106 Q80 100 96 106 L94 118 H66Z', bone), L_('M80 62 V106', '#d8cfb8', 4.5),
      ...[70, 78, 86, 94].map(y => L_('M64 ' + y + ' Q80 ' + (y + 6) + ' 96 ' + y, '#e2d8c0', 3)),
      P('M60 64 Q80 56 100 64 L98 70 Q80 64 62 70Z', bone),
      // rusty sword arm
      L_('M98 66 L112 84 L120 70', '#e2d8c0', 4.5), G(P('M-3 -46 L3 -46 L3.5 0 L-3.5 0Z', rustS) + P('M-9 0 H9 V4 H-9Z', '#6a4a2a') + P('M-2 4 H2 V14 H-2Z', '#3a2418'), 'translate(122 68) rotate(20)'),
      Pn('M120 40 Q124 46 122 52', '#9a4a2a', ' opacity=".8"'),
      // shield arm
      L_('M62 66 L50 84 L56 98', '#e2d8c0', 4.5),
      G(Eo(0, 0, 20, 22, wood) + L_('M-14 -10 H14 M-16 6 H16', '#2a1a0e', 1.4) + Eo(0, -2, 6, 6, '#9aa6b4') + Pn('M-10 12 Q0 22 10 12', '#000', ' opacity=".25"'), 'translate(44 94)'),
      // skull with helm
      P('M64 40 Q62 18 80 16 Q98 18 96 40 Q96 50 88 52 L88 58 H72 L72 52 Q64 50 64 40Z', bone),
      P('M62 30 Q64 10 80 10 Q96 10 98 30 Q80 22 62 30Z', c.lg(['#b8c2ce', '#6a7686']), ''), L_('M80 10 V26', OUT, 1.2),
      E(73, 36, 5, 6, '#14101c'), E(88, 36, 5, 6, '#14101c'), eye(c, 74, 37, 1.6, '#ff6a3a'), eye(c, 88, 37, 1.6, '#ff6a3a'),
      L_('M74 52 V56 M78 52 V56 M82 52 V56 M86 52 V56', '#14101c', 1.1),
    ].join('');
  });

  ART.eye = F(c => {
    const fl = c.t('#a84a6a'), flesh = c.rg([[lit(fl, 0.2)], [fl], [lit(fl, -0.28)]], 0.4, 0.35, 0.7);
    const tent = (d) => L_(d, c.t('#7a2a4a'), 6) + L_(d, lit(fl, 0.1), 2.4);
    return [
      E(80, 150, 32, 4, '#000', ' opacity=".3"'),
      tent('M64 104 Q56 126 66 140 Q72 148 64 154'), tent('M80 108 Q84 130 76 146'), tent('M96 104 Q108 124 98 138 Q92 146 100 152'), tent('M54 96 Q36 110 34 130'), tent('M106 96 Q124 108 128 128'),
      C(80, 76, 38, flesh, ' stroke="' + OUT + '" stroke-width="2.4"'),
      L_('M50 66 Q58 70 60 78 M110 64 Q100 70 102 80 M70 106 Q74 98 80 100', c.t('#e86a8a'), 1.2, ' opacity=".8"'),
      Eo(84, 74, 24, 22, c.rg([['#ffffff'], ['#f0e6e0'], ['#c8b0b0']], 0.4, 0.4, 0.7)),
      L_('M62 70 Q66 74 64 80 M104 66 Q100 72 104 76 M70 88 Q74 86 76 90', '#d04a5a', 0.9),
      C(88, 74, 12, c.rg([['#ffe14a'], ['#e8a028'], ['#8a4a10']])), E(89, 74, 3.4, 10, '#0a0608'),
      C(84, 68, 3.6, '#ffffff', ' opacity=".9"'),
      Pn('M50 54 Q64 40 84 40 Q62 48 54 64Z', '#ffffff', ' opacity=".3"'),
    ].join('');
  });

  ART.shroom = F(c => {
    const cap = c.mat('#c0402e'), stem = c.lg(['#fff6e0', '#e8d8b0', '#b0a078']);
    return [
      E(80, 152, 46, 5, '#000', ' opacity=".4"'),
      P('M60 150 Q56 132 62 112 H98 Q104 132 100 150 Q80 156 60 150Z', stem),
      P('M62 112 Q80 118 98 112 L98 118 Q80 126 62 118Z', '#d8c8a0'),
      L_('M66 120 Q64 136 66 148 M76 122 V150', '#c8b890', 1),
      P('M58 128 Q44 130 40 142 L48 144 Q52 136 62 134Z', stem), P('M102 128 Q116 130 120 142 L112 144 Q108 136 98 134Z', stem),
      P('M24 100 Q20 58 80 46 Q140 58 136 100 Q120 116 80 116 Q40 116 24 100Z', cap),
      Pn('M30 100 Q40 112 80 112 Q120 112 130 100 Q118 120 80 120 Q42 120 30 100Z', '#3a1010', ' opacity=".35"'),
      ...[[48, 74, 8], [80, 60, 7], [110, 72, 9], [64, 94, 6], [100, 98, 5], [124, 90, 4]].map(([x, y, r]) => Eo(x, y, r, r * 0.8, '#fff4dc')),
      Pn('M40 74 Q54 54 78 50 Q56 62 48 80Z', '#ffffff', ' opacity=".35"'),
      E(72, 132, 3, 4, '#1a120c'), E(90, 132, 3, 4, '#1a120c'), C(73, 131, 1, '#ffffff'), C(91, 131, 1, '#ffffff'),
      L_('M76 140 Q81 144 86 140', '#7a4a3a', 1.6),
      ...[[30, 136], [130, 130], [118, 56]].map(([x, y]) => C(x, y, 2.4, c.rg([['#fff6c0', 0.9], ['#ffd84a', 0]]))),
    ].join('');
  });

  ART.ghost = F(c => {
    const gh = c.t('#a8d8ff'), body = c.lg([[lit(gh, 0.15), 0.95], [gh, 0.75], [lit(gh, -0.2), 0.25]], 0, 0, 0.4, 1);
    return [
      C(80, 80, 66, c.rg([[gh, 0.3], [gh, 0]])),
      P('M40 80 Q40 30 80 28 Q120 30 120 80 L122 124 Q112 116 106 132 Q98 118 90 140 Q82 120 74 138 Q66 118 58 134 Q50 116 38 128Z', body, ' stroke="' + lit(gh, -0.3) + '" stroke-width="2"'),
      Pn('M50 60 Q56 38 78 34 Q60 46 56 70Z', '#ffffff', ' opacity=".55"'),
      E(66, 72, 8, 11, '#10182a'), E(94, 72, 8, 11, '#10182a'), eye(c, 67, 74, 2.6, '#e9fdff'), eye(c, 95, 74, 2.6, '#e9fdff'),
      E(80, 98, 7, 9, '#10182a', ' opacity=".9"'),
      P('M40 88 Q26 94 20 108 Q32 104 40 104Z', body), P('M120 88 Q134 92 140 106 Q128 102 120 104Z', body),
      ...[[30, 44], [132, 60], [26, 130], [134, 136]].map(([x, y]) => C(x, y, 2.2, '#e9fdff', ' opacity=".8"')),
    ].join('');
  });

  ART.chest = F(c => {
    const wood = c.lg(['#a8703a', '#7a4a22', '#4a2c12'], 0, 0, 0, 1), gold = c.lg(['#fff0b8', '#f5c242', '#a87418']), dark = '#2a1608';
    return [
      E(80, 152, 60, 6, '#000', ' opacity=".45"'),
      C(80, 96, 70, c.rg([['#f5c242', 0.28], ['#f5c242', 0]])),
      P('M30 96 H130 V146 Q80 152 30 146Z', wood),
      L_('M30 112 H130 M30 128 H130', dark, 1.4, ' opacity=".7"'), L_('M34 100 Q50 98 60 100', '#d89a5a', 1.2, ' opacity=".6"'),
      P('M24 96 Q24 56 80 52 Q136 56 136 96Z', wood), L_('M28 84 Q80 72 132 84 M30 70 Q80 58 130 70', dark, 1.4, ' opacity=".7"'),
      Pn('M32 88 Q36 62 72 56 Q48 66 42 86Z', '#ffd090', ' opacity=".35"'),
      P('M22 92 H138 V102 H22Z', gold),
      P('M38 54 Q40 52 46 54 V148 H38Z', gold), P('M114 54 Q120 52 122 54 V148 H114Z', gold),
      ...[[42, 62], [42, 120], [42, 140], [118, 62], [118, 120], [118, 140]].map(([x, y]) => C(x, y, 1.8, '#fff6d0', ' stroke="' + OUT + '" stroke-width=".8"')),
      P('M70 92 H90 V116 Q80 122 70 116Z', gold), C(80, 102, 4, dark), P('M78 104 H82 L83 112 H77Z', dark),
      L_('M28 94 H132', '#ffffff', 1, ' opacity=".55"'),
      ...[[64, 50, 3], [100, 46, 2.2], [84, 40, 2.6]].map(([x, y, r]) => P('M' + x + ' ' + (y - r * 2) + ' L' + (x + r * 0.6) + ' ' + (y - r * 0.6) + ' L' + (x + r * 2) + ' ' + y + ' L' + (x + r * 0.6) + ' ' + (y + r * 0.6) + ' L' + x + ' ' + (y + r * 2) + ' L' + (x - r * 0.6) + ' ' + (y + r * 0.6) + ' L' + (x - r * 2) + ' ' + y + ' L' + (x - r * 0.6) + ' ' + (y - r * 0.6) + 'Z', '#fff6d0', ' stroke-width=".6"')),
    ].join('');
  });

  // ---------------- guardians: 200 x 200 ----------------
  ART.goblin = F(c => {
    const skin = c.lg(['#8fd16a', '#5aa042', '#2f6a2a'], 0.1, 0, 0.9, 1), sack = c.lg(['#c9a36a', '#8c6a3a', '#5a4022'], 0.1, 0, 0.9, 1),
      vest = c.lg(['#7a4a3a', '#53302a', '#321a16'], 0, 0, 1, 1), gold = c.lg(['#fff1a8', '#f2c14e', '#a8761e']), steel = c.lg(['#ffffff', '#b8c4d4', '#5a6578']);
    return [
      E(80, 152, 56, 6, '#000', ' opacity=".45"'),
      // loot sack slung over the back, coins spilling out
      P('M22 100 Q10 70 34 52 Q54 40 70 56 Q82 72 74 98 Q66 120 44 120 Q28 118 22 100Z', sack),
      L_('M30 62 Q40 70 36 86 M50 54 Q58 66 56 82', '#4a3218', 1.4, ' opacity=".6"'),
      P('M58 52 Q66 44 74 46 L70 56Z', sack), L_('M60 54 Q66 52 72 52', '#3a2410', 2.2),
      Eo(66, 44, 5, 3.4, gold, ' stroke-width="1.4"'), Eo(74, 40, 4.4, 3, gold, ' stroke-width="1.4"'), Eo(60, 40, 4, 2.8, gold, ' stroke-width="1.4"'),
      C(68, 34, 3, c.lg(['#c8f0ff', '#3aa0e8']), ' stroke="' + OUT + '" stroke-width="1.2"'),
      Pn('M28 70 Q32 58 44 54', 'none', ' stroke="#ffffff" stroke-width="1.6" opacity=".35"'),
      // legs and big feet
      P('M70 124 L64 146 L52 150 L54 156 L76 156 L80 128Z', skin), P('M98 124 L104 146 L116 150 L116 156 L94 156 L90 128Z', skin),
      // body and vest
      P('M62 128 Q56 98 72 84 Q88 74 104 84 Q118 98 110 128 Q86 138 62 128Z', skin),
      P('M64 124 Q60 100 74 88 Q86 82 98 86 L94 126 Q80 132 64 124Z', vest),
      P('M62 122 Q86 134 110 122 L110 130 Q86 140 62 130Z', '#3a2410', ' stroke-width="1.6"'), Eo(86, 129, 4, 3.4, gold, ' stroke-width="1.2"'),
      // strap of the sack across the chest
      L_('M66 88 L104 122', '#3a2410', 4.5), L_('M66 88 L104 122', '#8c6a3a', 2.4),
      // arm holding the sack strap
      P('M70 92 Q58 96 54 84 Q52 74 60 70 L66 78 Q64 86 72 86Z', skin),
      // arm with dagger, reaching forward
      P('M104 94 Q118 98 126 108 L120 114 Q112 106 102 104Z', skin),
      G(P('M0 -2 L26 -4 L30 0 L26 4 L0 2Z', steel, ' stroke-width="1.6"') + P('M-3 -6 H2 V6 H-3Z', '#3a2410', ' stroke-width="1.4"') + P('M-12 -2.5 H-3 V2.5 H-12Z', '#6a4a2a', ' stroke-width="1.4"'), 'translate(126 112) rotate(-28)'),
      Eo(124, 111, 6, 6, skin, ' stroke-width="2"'),
      // head
      P('M78 52 L50 34 L58 52 L66 58Z', skin), P('M60 42 L70 52', '#2f6a2a', ' stroke-width="1"'),
      P('M118 50 L148 30 L140 52 L128 58Z', skin), P('M140 38 L130 50', '#2f6a2a', ' stroke-width="1"'),
      P('M70 60 Q68 34 96 32 Q124 34 124 60 Q124 80 98 84 Q72 82 70 60Z', skin),
      P('M72 52 Q74 30 98 28 Q122 30 124 50 Q112 40 98 40 Q82 40 72 52Z', vest),
      Eo(88, 58, 7, 6, '#fff6c0', ' stroke-width="1.6"'), Eo(110, 58, 7, 6, '#fff6c0', ' stroke-width="1.6"'),
      eye(c, 90, 58, 2.6, '#ffb020'), eye(c, 112, 58, 2.6, '#ffb020'),
      L_('M80 49 L94 53 M118 49 L104 53', '#1d3a1a', 2.6),
      P('M110 64 Q116 66 114 72 Q108 70 106 66Z', '#4a8a34', ' stroke-width="1.4"'),
      P('M82 72 Q98 82 116 72 Q112 80 98 82 Q86 80 82 72Z', '#2a0e12', ' stroke-width="1.6"'),
      P('M86 73 L89 78 L92 74.5 L95 79 L98 75 L101 79 L104 74.5 L107 78 L110 73.5Z', '#fff6d8', ' stroke-width="0.9"'),
      Pn('M78 56 Q80 42 94 38', 'none', ' stroke="#ffffff" stroke-width="1.5" opacity=".4"'),
    ].join('');
  });
  // World boss: the Rift Colossus, a giant of void crystal with the Nyx Rift burning through its chest.
  ART.colossus = F(c => {
    const body = c.lg(['#4a3a6e', '#2a1f45', '#150f26'], 0.1, 0, 0.9, 1), plate = c.lg(['#6a58a0', '#3c2f66', '#1f1838'], 0.15, 0, 0.85, 1),
      xtal = c.lg(['#ffd6ff', '#d76bff', '#7a2ab8'], 0.2, 0, 0.8, 1), rift = '#ff5ad0', glow = c.glowF(3);
    const shard = (x, y, h, r) => G(P('M0 0 L' + (h * 0.22) + ' ' + (-h * 0.75) + ' L0 ' + (-h) + ' L' + (-h * 0.22) + ' ' + (-h * 0.75) + 'Z', xtal, ' stroke-width="1.8"') + Pn('M0 -2 L0 ' + (-h * 0.9), 'none', ' stroke="#ffffff" stroke-width="1.2" opacity=".6"'), 'translate(' + x + ' ' + y + ') rotate(' + r + ')');
    return [
      E(120, 234, 92, 7, '#000', ' opacity=".5"'),
      E(120, 120, 100, 96, '#b44aff', ' opacity=".12" filter="' + c.glowF(14) + '"'),
      // floating shards
      shard(26, 70, 18, -20), shard(210, 52, 16, 18), shard(40, 150, 12, -40), shard(222, 140, 14, 30),
      // legs
      P('M78 168 L68 222 L52 232 L98 234 L102 172Z', body), P('M138 172 L142 232 L188 234 L172 222 L162 168Z', body),
      P('M62 216 L100 216 L100 234 L52 234Z', plate), P('M140 216 L178 216 L188 234 L140 234Z', plate),
      // torso
      P('M60 92 Q56 60 92 50 L148 50 Q184 60 180 92 L172 168 Q120 186 68 168Z', body),
      P('M74 70 Q120 58 166 70 L160 100 Q120 92 80 100Z', plate),
      // the rift in the chest
      Pn('M120 96 L112 116 L124 124 L108 150 L132 128 L120 120 L130 102Z', rift, ' filter="' + glow + '"'),
      P('M120 96 L112 116 L124 124 L108 150 L132 128 L120 120 L130 102Z', '#ffe0f6', ' stroke="' + rift + '" stroke-width="1.6"'),
      L_('M86 120 L100 128 L94 144 M154 118 L142 128 L150 146', rift, 1.6, ' opacity=".8"'),
      // shoulders with crystal growths
      P('M40 74 Q44 50 72 50 L84 60 L76 96 Q52 100 40 88Z', plate), P('M200 74 Q196 50 168 50 L156 60 L164 96 Q188 100 200 88Z', plate),
      shard(52, 56, 30, -18), shard(66, 52, 22, 6), shard(188, 56, 30, 18), shard(174, 52, 22, -6),
      // arms and fists
      P('M44 90 L30 150 L40 156 L62 100Z', body), P('M196 90 L210 150 L200 156 L178 100Z', body),
      P('M20 148 Q18 132 34 130 L50 134 Q58 150 48 166 L28 168 Q18 162 20 148Z', plate),
      P('M220 148 Q222 132 206 130 L190 134 Q182 150 192 166 L212 168 Q222 162 220 148Z', plate),
      shard(30, 132, 12, -30), shard(212, 132, 12, 30),
      // hooded head and the single eye
      P('M92 52 Q90 20 120 14 Q150 20 148 52 Q136 60 120 60 Q104 60 92 52Z', body),
      P('M98 46 Q120 30 142 46 Q132 54 120 54 Q108 54 98 46Z', '#0a0614', ' stroke-width="1.6"'),
      E(120, 45, 9, 6, rift, ' opacity=".7" filter="' + c.glowF(4) + '"'), E(120, 45, 5, 3.6, '#ffe8fb'), E(121, 45, 2, 2.6, '#3a0a30'),
      shard(108, 20, 16, -14), shard(120, 16, 20, 0), shard(132, 20, 16, 14),
      Pn('M70 66 Q90 56 110 56', 'none', ' stroke="#ffffff" stroke-width="1.5" opacity=".25"'),
    ].join('');
  }, 240, 240);
  ART.golem = F(c => {
    const st = c.t('#7b8698'), stone = c.lg([lit(st, 0.2), st, lit(st, -0.25)], 0.1, 0, 0.9, 1), stoneD = c.lg([lit(st, 0.02), lit(st, -0.3)]);
    const moss = c.t('#4a7a3a'), rune = '#7fd6e8';
    const crack = d => L_(d, '#20262f', 2.4) + L_(d, rune, 1, ' opacity=".8"');
    return [
      E(100, 194, 80, 7, '#000', ' opacity=".5"'),
      P('M62 160 L58 194 H90 L88 158Z', stoneD), P('M112 158 L110 194 H142 L138 160Z', stoneD),
      L_('M62 178 H88 M112 178 H140', '#20262f', 1.6),
      P('M42 92 Q36 44 100 32 Q164 44 158 92 L150 150 Q100 172 50 150Z', stone),
      Pn('M110 34 Q160 48 158 92 L150 150 Q130 160 112 164 Q130 100 110 34Z', '#000', ' opacity=".2"'),
      crack('M70 60 L84 84 L76 104 L90 124 M128 56 L118 80 L132 100 L122 126'), crack('M84 84 L100 92 L118 80'),
      C(100, 92, 10, c.rg([['#ffffff'], [rune], [rune, 0]])), C(100, 92, 24, c.rg([[rune, 0.4], [rune, 0]])),
      Pn('M48 74 Q60 64 76 70 Q64 78 52 86Z', moss, ' opacity=".85"'), Pn('M130 140 Q144 136 150 128 Q148 146 132 150Z', moss, ' opacity=".8"'),
      L_('M48 68 Q100 40 152 68', '#ffffff', 1.4, ' opacity=".35"'),
      // arms
      P('M42 60 Q14 70 12 112 Q12 140 22 152 L46 148 Q40 122 46 98 Q54 76 60 66Z', stoneD), Eo(32, 156, 24, 18, stone), L_('M18 152 Q32 146 46 152', '#20262f', 1.4),
      P('M158 60 Q186 70 188 112 Q188 140 178 152 L154 148 Q160 122 154 98 Q146 76 140 66Z', stoneD), Eo(168, 156, 24, 18, stone), L_('M154 152 Q168 146 182 152', '#20262f', 1.4),
      Eo(40, 58, 30, 22, stone), Eo(160, 58, 30, 22, stone), Pn('M22 54 Q34 40 54 44 Q38 48 30 60Z', '#ffffff', ' opacity=".3"'),
      // head
      P('M74 34 Q70 4 100 0 Q130 4 126 34 Q100 46 74 34Z', stone), P('M80 16 H96 L94 24 H82Z M104 16 H120 L118 24 H106Z', '#0d1420'),
      eye(c, 89, 20, 3.4, '#bff6ff'), eye(c, 111, 20, 3.4, '#bff6ff'), L_('M84 32 Q100 38 116 32', '#20262f', 2),
      ...[[60, 110], [140, 80], [96, 140]].map(([x, y]) => P('M' + x + ' ' + y + ' l5 -9 l4 11Z', '#b56bff', ' stroke-width="1"')),
    ].join('');
  }, 200, 200);

  ART.wyrm = F(c => {
    const sc = c.t('#8a5a3a'), plate = c.lg([lit(sc, 0.18), sc, lit(sc, -0.25)], 0, 0, 1, 1), bellyC = c.lg(['#e8d0a0', '#a88a5a']);
    const seg = (x, y, r) => Eo(x, y, r, r * 0.9, plate) + L_('M' + (x - r * 0.7) + ' ' + (y - r * 0.4) + ' Q' + x + ' ' + (y - r) + ' ' + (x + r * 0.7) + ' ' + (y - r * 0.4), '#ffffff', 1.2, ' opacity=".35"') + P('M' + (x - 4) + ' ' + (y - r * 0.85) + ' L' + x + ' ' + (y - r - 10) + ' L' + (x + 4) + ' ' + (y - r * 0.85) + 'Z', c.lg(['#f0e0c0', '#8a7a5a']), ' stroke-width="1.4"');
    return [
      E(100, 192, 90, 8, '#000', ' opacity=".5"'),
      P('M10 194 Q30 170 60 176 Q90 170 120 180 Q160 170 190 194Z', c.lg(['#4a3a2a', '#1e160e'])),
      ...[[18, 186], [44, 178], [150, 182], [176, 188]].map(([x, y]) => Eo(x, y, 8, 5, '#5a4a3a')),
      seg(40, 168, 20), seg(62, 150, 22), seg(84, 128, 24), seg(104, 104, 25),
      Pn('M56 162 Q74 144 92 120 Q100 112 108 110 Q96 130 80 150 Q66 166 58 170Z', bellyC, ' opacity=".7"'),
      // head with jaw open
      P('M106 92 Q118 56 152 50 Q184 52 194 76 Q186 88 168 88 Q150 90 130 106Z', plate),
      P('M130 104 Q156 100 170 92 Q186 92 192 100 Q184 120 160 122 Q140 122 130 104Z', plate),
      P('M140 90 Q164 86 190 82 Q186 96 168 98 Q150 102 140 98Z', '#3a0a0a'),
      ...[150, 160, 170, 180].map(x => P('M' + x + ' 86 L' + (x + 3) + ' 94 L' + (x + 6) + ' 85Z', '#fffaf0', ' stroke-width="1"') + P('M' + (x - 2) + ' 99 L' + (x + 1) + ' 91 L' + (x + 4) + ' 99Z', '#fffaf0', ' stroke-width="1"')),
      C(176, 92, 16, c.rg([['#ff8a3d', 0.55], ['#ff8a3d', 0]])),
      P('M128 58 L118 30 L140 52Z', c.lg(['#f0e0c0', '#8a7a5a'])), P('M146 52 L146 22 L160 50Z', c.lg(['#f0e0c0', '#8a7a5a'])),
      eye(c, 160, 66, 4.6, '#ffb03a'), L_('M140 58 Q160 50 182 60', '#ffffff', 1.4, ' opacity=".4"'),
    ].join('');
  }, 200, 200);

  ART.lich = F(c => {
    const robe = c.mat('#3a2a5a'), robeD = c.t('#160e26'), bone = c.lg(['#fffaf0', '#e2d8c0', '#9c9078']), gold = c.lg(['#fff0b8', '#f5c242', '#a87418']), soul = '#7affc8';
    return [
      E(100, 194, 66, 7, '#000', ' opacity=".5"'),
      C(100, 100, 96, c.rg([[soul, 0.18], [soul, 0]])),
      // staff
      G(P('M-3 0 H3 V170 H-3Z', c.lg(['#3a2a1a', '#140c06'], 0, 0, 1, 0)) + C(0, -16, 30, c.rg([[soul, 0.7], [soul, 0.2], [soul, 0]])) +
        P('M-14 -4 Q-18 -30 0 -40 Q18 -30 14 -4 L8 -10 L0 0 L-8 -10Z', gold) + C(0, -20, 7, c.rg([['#ffffff'], [soul]])), 'translate(166 30)'),
      // robe
      P('M58 92 Q44 150 36 192 L56 186 L70 194 L86 186 L100 194 L114 186 L130 194 L146 186 L164 192 Q156 150 142 92 Q100 80 58 92Z', robe),
      Pn('M108 86 Q140 90 142 92 Q156 150 164 192 L146 186 L130 194 Q128 140 108 86Z', robeD, ' opacity=".5"'),
      P('M90 92 H110 L116 190 Q100 194 84 190Z', c.lg(['#5a3a8a', '#2a1a46'])), L_('M100 100 V186', gold, 1.4),
      ...[120, 140, 160].map(y => L_('M92 ' + y + ' L100 ' + (y + 6) + ' L108 ' + y, soul, 1.2, ' opacity=".7"')),
      // ribcage peeking
      ...[100, 108, 116].map(y => L_('M78 ' + y + ' Q90 ' + (y + 4) + ' 94 ' + y + ' M106 ' + y + ' Q110 ' + (y + 4) + ' 122 ' + y, '#e2d8c0', 2)),
      // mantle and arms
      P('M50 86 Q100 66 150 86 L146 104 Q100 92 54 104Z', gold),
      P('M54 94 Q34 110 32 134 L46 136 Q50 116 64 106Z', robe), L_('M34 136 l-2 8 M38 137 l0 8 M42 137 l2 7', '#e2d8c0', 2.2),
      P('M146 94 Q160 104 162 120 L152 124 Q148 110 138 106Z', robe), Eo(160, 124, 6, 5, '#d8cfb8'),
      // skull and crown
      P('M80 58 Q78 30 100 28 Q122 30 120 58 Q120 70 110 72 L110 80 H90 L90 72 Q80 70 80 58Z', bone),
      E(91, 52, 6, 7, '#14101c'), E(109, 52, 6, 7, '#14101c'), eye(c, 91, 53, 2.4, soul), eye(c, 109, 53, 2.4, soul),
      P('M97 62 L100 56 L103 62Z', '#14101c'), L_('M92 72 V77 M97 72 V78 M103 72 V78 M108 72 V77', '#14101c', 1.2),
      P('M78 34 L80 12 L88 24 L94 6 L100 20 L106 6 L112 24 L120 12 L122 34 Q100 26 78 34Z', gold),
      C(100, 22, 3, c.lg(['#ff9ad0', '#c02a7a']), ' stroke="' + OUT + '" stroke-width="1"'),
      Pn('M84 40 Q90 32 100 31', 'none', ' stroke="#ffffff" stroke-width="1.4" opacity=".6"'),
    ].join('');
  }, 200, 200);
  // ---------------- wardrobe: outfits and lantern styles (looks only, bought with Sigils) ----------------
  // An outfit recolours a hero sprite by material: metal (low saturation), trim (gold), main cloth (cool hues)
  // and accent cloth (warm hues). Skin, hair, eyes and outlines keep their colours. Some outfits add an aura.
  // Each part is [hue, saturation, lightness scale, lightness shift]; hue null keeps the original hue.
  const OUTFITS = {
    ember:    { m: [22, 0.1, 0.95, 0], g: [38, 0.9, 1, 0.02], p: [6, 0.72, 0.95, 0], a: [28, 0.85, 1, 0.04] },
    frost:    { m: [205, 0.22, 1.02, 0.04], g: [200, 0.25, 1.05, 0.08], p: [204, 0.6, 1, 0.04], a: [186, 0.55, 1.05, 0.06] },
    wild:     { m: [95, 0.1, 0.92, 0], g: [32, 0.62, 0.9, -0.02], p: [118, 0.45, 0.88, 0], a: [42, 0.6, 0.95, 0] },
    dusk:     { m: [262, 0.14, 0.9, 0], g: [220, 0.18, 1.05, 0.06], p: [272, 0.5, 0.9, 0], a: [318, 0.55, 0.95, 0] },
    ivory:    { m: [42, 0.18, 1.08, 0.1], g: [42, 0.86, 1, 0.02], p: [40, 0.32, 1.25, 0.12], a: [8, 0.6, 0.95, 0] },
    obsidian: { m: [240, 0.1, 0.5, -0.02], g: [44, 0.9, 1, 0.02], p: [356, 0.7, 0.8, 0], a: [356, 0.75, 0.85, 0], aura: 'smoke' },
    gilded:   { m: [44, 0.75, 1, 0.02], g: [0, 0, 1.12, 0.1], p: [44, 0.2, 1.3, 0.12], a: [200, 0.55, 1, 0.02], aura: 'gold' },
    rift:     { m: [268, 0.3, 0.75, 0], g: [178, 0.8, 1, 0.06], p: [272, 0.62, 0.85, 0], a: [180, 0.7, 0.95, 0.04], aura: 'rift' },
    sworn:    { m: [40, 0.28, 1.1, 0.1], g: [46, 1, 1.05, 0.06], p: [28, 0.82, 1, 0.04], a: [10, 0.8, 1, 0.02], aura: 'lantern' },
  };
  function recolor(svg, o) {
    const memo = {};
    return svg.replace(/#[0-9a-fA-F]{6}\b/g, x => {
      x = x.toLowerCase(); if (memo[x]) return memo[x];
      const [h, s, l] = hsl(x); let part = null;
      if (l < 0.13 || l > 0.97) part = null;                                  // outlines, eyes, highlights
      else if (h >= 12 && h <= 36 && s > 0.35 && s < 0.8 && l > 0.5 && l < 0.9) part = null; // skin and hair
      else if (s < 0.3) part = o.m;
      else if (h >= 36 && h <= 56 && s > 0.5 && l > 0.3) part = o.g;
      else if (h >= 70 && h < 300) part = o.p;
      else part = o.a;
      if (!part) return memo[x] = x;
      const [th, ts, k, dl] = part, nl = Math.max(0.04, Math.min(0.96, l * k + dl));
      return memo[x] = hex(th == null ? h : th, ts, nl);
    });
  }
  // Aura layers drawn behind (under) and in front of (over) the sprite, inside the 120 x 160 hero frame.
  function aura(kind, c) {
    const A = { smoke: ['#3a2c3e', '#c23a3a'], gold: ['#ffe9a0', '#fff6d8'], rift: ['#7a3cff', '#7affe8'], lantern: ['#ffb64a', '#fff1b8'] }[kind];
    if (!A) return ['', ''];
    const glow = c.glowF(6), soft = c.glowF(2.2);
    const under = E(60, 150, 46, 9, A[0], ' opacity=".55" filter="' + glow + '"') + E(60, 92, 44, 64, c.rg([[A[0], 0.42], [A[0], 0.12], [A[0], 0]]), '');
    const pts = [[18, 120, 2.2], [100, 104, 1.8], [26, 62, 1.6], [96, 46, 2.4], [12, 88, 1.4], [106, 136, 1.6], [40, 24, 1.3], [84, 22, 1.5]];
    let over = '';
    if (kind === 'smoke') over = L_('M16 150 Q8 120 20 96 Q30 76 18 56', A[0], 3, ' opacity=".35" filter="' + soft + '"') + L_('M104 150 Q112 124 100 100 Q92 80 104 60', A[0], 3, ' opacity=".35" filter="' + soft + '"') + pts.slice(0, 5).map(p => C(p[0], p[1], p[2] * 0.8, A[1], ' opacity=".8"')).join('');
    else over = pts.map(p => C(p[0], p[1], p[2] * 2.4, A[1], ' opacity=".45" filter="' + soft + '"') + C(p[0], p[1], p[2], '#ffffff', ' opacity=".9"')).join('') +
      (kind === 'gold' || kind === 'lantern' ? Pn('M60 2 L62 8 L68 10 L62 12 L60 18 L58 12 L52 10 L58 8Z', A[1], ' opacity=".85"') : '') +
      (kind === 'rift' ? L_('M8 70 Q20 66 24 76 M98 30 Q108 26 112 36 M92 130 Q104 126 108 136', A[1], 1.4, ' opacity=".7"') : '');
    return [under, over];
  }
  // Lantern styles: the colour of the party's carried lantern and its light in the Deep.
  const LANTERNS = {
    ember: { flame: ['#fff3c4', '#ffb347', '#e0622a'], glow: [255, 180, 90], metal: '#8a6a3a', name: 'Hearth Ember' },
    moon:  { flame: ['#ffffff', '#cfe2ff', '#7a9ad8'], glow: [170, 200, 255], metal: '#9aa6b8', name: 'Moonlit' },
    wisp:  { flame: ['#f4ffe0', '#9cf27a', '#3aa84a'], glow: [140, 240, 140], metal: '#5a6a3a', name: 'Marsh Wisp' },
    rose:  { flame: ['#fff0f4', '#ff8fb4', '#d03a6a'], glow: [255, 140, 180], metal: '#8a4a5a', name: 'Rosefire' },
    rift:  { flame: ['#f4eaff', '#b98aff', '#6a3ae0'], glow: [180, 130, 255], metal: '#4a3a6a', name: 'Riftglass' },
    sun:   { flame: ['#ffffff', '#fff1a0', '#f5c242'], glow: [255, 236, 160], metal: '#c99a3a', name: 'Sunforged' },
    soul:  { flame: ['#eafffb', '#7affe0', '#2aa89a'], glow: [120, 255, 225], metal: '#3a5a5a', name: 'Soulflame' },
    void:  { flame: ['#ffffff', '#9aa6ff', '#2a2266'], glow: [140, 150, 255], metal: '#2a2a3a', name: 'Starless' },
  };
  ART.lantern = { w: 40, h: 60, draw(c) {
    const L0 = LANTERNS[c.lant] || LANTERNS.ember, mt = c.lg([lit(L0.metal, 0.25), L0.metal, lit(L0.metal, -0.2)], 0, 0, 1, 1);
    return [
      C(20, 34, 19, c.rg([[L0.flame[1], 0.5], [L0.flame[1], 0.15], [L0.flame[1], 0]]), ''),
      L_('M14 6 Q20 -2 26 6', L0.metal, 2.4), P('M10 10 H30 L28 16 H12Z', mt, ' stroke-width="1.8"'),
      P('M12 16 H28 L30 46 H10Z', c.lg([[L0.flame[0], 0.55], [L0.flame[1], 0.4], [L0.flame[2], 0.5]], 0, 0, 0, 1), ' stroke-width="1.8"'),
      P('M20 22 Q27 32 24 40 Q20 44 16 40 Q13 32 20 22Z', c.lg([L0.flame[0], L0.flame[1], L0.flame[2]], 0, 0, 0, 1), ' stroke="none"'),
      E(20, 37, 2.4, 3, '#ffffff', ' opacity=".9"'),
      L_('M15 17 V45 M25 17 V45', L0.metal, 1.6), P('M8 46 H32 L30 52 H10Z', mt, ' stroke-width="1.8"'),
      L_('M13 19 L13 40', '#ffffff', 1, ' opacity=".5"'),
    ].join('');
  } };
  // ---------------- build, load and draw ----------------
  // hue is a number, or 'hue~outfit' for a hero in an outfit; the lantern sprite takes '~style'.
  function svgOf(name, hue) {
    const a = ART[name]; if (!a) return null;
    const sp = String(hue || 0).split('~'), o = OUTFITS[sp[1]];
    const c = new Ctx(o ? 0 : +sp[0] || 0); c.lant = sp[1];
    let inner = '<defs>' + c.defs.join('') + '</defs>', body = a.draw(c);
    inner = '<defs>' + c.defs.join('') + '</defs>' + body;
    if (o) {
      inner = recolor(inner, o);
      if (o.aura && a.w === 120) { const c2 = new Ctx(0), au = aura(o.aura, c2); inner = '<defs>' + c2.defs.join('') + '</defs>' + au[0] + inner + au[1]; }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + a.w + ' ' + a.h + '" width="' + a.w * 4 + '" height="' + a.h * 4 + '">' + inner + '</svg>';
  }
  const imgs = {}, pend = {};
  let waiting = 0;
  function load(name, hue) {
    const k = name + '|' + (hue || 0);
    if (imgs[k] || pend[k] || !ART[name] || typeof Image === 'undefined') return;
    const im = new Image(); pend[k] = 1; waiting++;
    im.onload = () => { imgs[k] = im; delete pend[k]; if (--waiting === 0) setTimeout(() => { try { root.dispatchEvent(new Event('lhsprites')); } catch (e) {} }, 0); };
    im.onerror = () => { delete pend[k]; waiting--; };
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgOf(name, hue));
  }
  const pxRender = PX.render;
  // Same footprint as the pixel sprite (grid units x scale), so the game's layout code is unchanged.
  function render(name, scale, hue) {
    const a = ART[name]; if (!a) return pxRender(name, scale, +String(hue || 0).split('~')[0] || 0);
    const k = name + '|' + (hue || 0), im = imgs[k];
    if (!im) {
      load(name, hue);
      const pc = pxRender(name, scale, +String(hue || 0).split('~')[0] || 0); if (pc) return pc;
      const e = document.createElement('canvas'); e.width = Math.max(1, Math.round(a.w / 10 * scale)); e.height = Math.max(1, Math.round(a.h / 10 * scale)); return e;
    }
    const gw = a.w / 10 * (a.unit || 1), gh = a.h / 10 * (a.unit || 1);
    const cv = document.createElement('canvas'); cv.width = Math.round(gw * scale); cv.height = Math.round(gh * scale);
    const x = cv.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(im, 0, 0, cv.width, cv.height); cv.vector = true;
    return cv;
  }
  const urlCache = {};
  function spriteURL(name, scale, hue) {
    const k = name + scale + '|' + (hue || 0);
    if (urlCache[k]) return urlCache[k];
    const c = render(name, scale * 3, hue); if (!c) return '';
    if (c.vector) urlCache[k] = c.toDataURL();
    return c.toDataURL();
  }
  for (const n in ART) load(n, 0);
  root.LHSprites = Object.assign({}, PX, { render, spriteURL, svgOf, OUTFITS, LANTERNS, vector: true, ready: () => waiting === 0 });
})(this);
