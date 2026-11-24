#!/usr/bin/env node
/* Lanternhold Wiki generator.
   Builds the public player wiki straight from the game's own files (core.js data, the in-game Guide,
   patch notes and the Ember Ring tables in ui.js, sprites from vector.js, icons from index.html),
   so every publish of the game ships a wiki that matches it.

   Usage: node lanternhold-wiki/build.js <gameDir> <siteDir> [siteUrl]
   Writes <siteDir>/wiki/** and <siteDir>/sitemap.xml. No dependencies. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const GAME = path.resolve(process.argv[2] || path.join(__dirname, '..', 'lanternhold'));
const SITE = path.resolve(process.argv[3] || path.join(__dirname, 'out'));
const BASE = (process.argv[4] || 'https://lanternhold.born2gamellc.com').replace(/\/$/, '');
const OUT = path.join(SITE, 'wiki');
const DISCORD = 'https://discord.gg/6G7E7rhGFu';
const PRESS = 'https://lanternhold.born2gamellc.com/press/';
const OG_IMG = 'https://lanternhold.born2gamellc.com/press/img/og-1200x630.png';
const HERE = __dirname;

// ---------- load the game ----------
const CORE_API = require(path.join(GAME, 'core.js'));
const CORE_SRC = fs.readFileSync(path.join(GAME, 'core.js'), 'utf8');
// A few data tables are private to core.js; read them from its source (they are plain literals).
function coreConst(name) {
  const m = CORE_SRC.match(new RegExp('const ' + name + ' = ([\\s\\S]*?);\\n'));
  if (!m) { const n = CORE_SRC.match(new RegExp('[ ,]' + name + ' = (-?[\\d.e]+)[,;]')); return n ? +n[1] : undefined; }
  try { return new Function('return (' + m[1] + ');')(); } catch (e) { return undefined; }
}
const L = Object.assign({}, CORE_API);
for (const k of ['BASES', 'BOSS_SPRITES', 'PACK_FLOOR', 'AFFIX_CHANCE', 'POS_TRAIT_NAME', 'KIN_TRAIT_NAME', 'CAMP_TRAIT_NAME', 'WB_NAMES', 'DUST', 'SOCK_BASE', 'STAT_CLASS', 'MILESTONES', 'LORE', 'FOES', 'ELITE_CHANCE', 'GOBLIN_FLOOR', 'GOBLIN_TIME', 'GOBLIN_GOLD', 'WB_TIME', 'WB_COOL'])
  if (L[k] === undefined) { const v = coreConst(k); if (v !== undefined) L[k] = v; }
const UI = fs.readFileSync(path.join(GAME, 'ui.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');

// Pull a `const NAME = [ ... ];` block out of ui.js and evaluate it with the core API in scope.
function uiConst(name, close) {
  const at = UI.indexOf('const ' + name + ' = ');
  if (at < 0) return null;
  const end = UI.indexOf(close || '\n  ];', at);
  if (end < 0) return null;
  const src = UI.slice(at + ('const ' + name + ' = ').length, end + (close || '\n  ];').length).replace(/;\s*$/, '');
  try { return new Function('L', 'return (' + src + ');')(L); } catch (e) { console.warn('wiki: could not read ' + name + ' from ui.js: ' + e.message); return null; }
}
const GUIDE = uiConst('GUIDE') || [];
const NOTES = uiConst('PATCH_NOTES') || [];
const RING_KIT = uiConst('RING_KIT') || [];
const RING_ARMS = uiConst('RING_ARMS', '};') || {};
const RING_TITLES = uiConst('RING_TITLES', ']];') || [];
const RING_MAX = +(UI.match(/const RING_MAX = (\d+)/) || [])[1] || 15;
const RING_EMAX = +(UI.match(/RING_EMAX = (\d+)/) || [])[1] || 10;

// Sprites: run the game's sprite files in a sandbox and ask for each SVG.
const SP = (() => {
  const root = { Image: function () {}, dispatchEvent() {}, Event: function () {}, document: { createElement() { return { getContext() { return {}; } }; } } };
  root.window = root; vm.createContext(root);
  try {
    for (const f of ['sprites.js', 'vector.js']) vm.runInContext(fs.readFileSync(path.join(GAME, f), 'utf8').replace(/\}\)\(this\);\s*$/, '})(globalThis);'), root);
    return root.LHSprites && root.LHSprites.svgOf ? root.LHSprites : null;
  } catch (e) { console.warn('wiki: sprites unavailable: ' + e.message); return null; }
})();
const SYMBOLS = (INDEX.match(/<symbol id="i-[\s\S]*?<\/symbol>/g) || []).join('\n');

// ---------- helpers ----------
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = s => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&times;/g, '×').replace(/&sup2;/g, '²').replace(/&ndash;/g, '–').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const slug = s => String(s).toLowerCase().replace(/[’'"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pct = (v, plus) => (plus && v > 0 ? '+' : '') + (Math.round(v * 1000) / 10) + '%';
const num = n => Number(n).toLocaleString('en-US');
const icon = (id, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="/wiki/icons.svg#i-' + id + '"/></svg>';
const CLS = L.CLASSES, CO = L.CLASS_ORDER;
const clsName = c => (CLS[c] || {}).name || c;

const written = new Set();
function sprite(name, hue) {
  if (!SP) return '';
  hue = Math.round(hue || 0);
  const file = name + (hue ? '-h' + (hue < 0 ? 'm' + -hue : hue) : '') + '.svg';
  if (!written.has(file)) {
    let svg; try { svg = SP.svgOf(name, hue); } catch (e) { svg = null; }
    if (!svg) return '';
    fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'img', file), svg); written.add(file);
  }
  return '/wiki/img/' + file;
}
const pic = (name, hue, alt, cls) => { const u = sprite(name, hue); return u ? '<img class="spr' + (cls ? ' ' + cls : '') + '" src="' + u + '" alt="' + esc(alt || '') + '" loading="lazy" width="96" height="96">' : ''; };

// ---------- page registry ----------
// Every page: { slug, title, nav, group, icon, desc, body(), search: [{t, a, x}] }
const pages = [];
const search = [];
const addSearch = (page, title, anchor, text, kind) => search.push({ t: strip(title), u: '/wiki/' + (page ? page + '/' : '') + (anchor ? '#' + anchor : ''), k: kind || '', x: strip(text || '').slice(0, 240) });

function card(id, title, opts) {
  opts = opts || {};
  return '<article class="card' + (opts.cls ? ' ' + opts.cls : '') + '" id="' + id + '"' + (opts.style ? ' style="' + opts.style + '"' : '') + '>' +
    (opts.pic ? '<div class="cpic">' + opts.pic + '</div>' : '') +
    '<div class="cbody"><h3><a class="anchor" href="#' + id + '">' + title + '</a></h3>' + (opts.sub ? '<p class="sub">' + opts.sub + '</p>' : '') + (opts.body || '') + '</div></article>';
}
const table = (head, rows, cls) => '<div class="tablewrap"><table' + (cls ? ' class="' + cls + '"' : '') + '><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
  rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
const chip = (t, cls) => '<span class="chip' + (cls ? ' ' + cls : '') + '">' + t + '</span>';
const kv = pairs => '<dl class="kv">' + pairs.filter(Boolean).map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>';

// ================= Guide pages (from the in-game Delver's Guide) =================
const GUIDE_SLUG = { start: 'getting-started', party: 'your-party', fight: 'combat', gear: 'gear-and-loot', camp: 'camp', grow: 'getting-stronger', sigils: 'sigils-and-perks', social: 'playing-together' };
const GUIDE_REL = {
  start: ['classes', 'regions'], party: ['classes', 'companions', 'banners'], fight: ['bestiary', 'regions', 'world-boss'],
  gear: ['gear', 'sets', 'enchantments'], camp: ['camp-and-jobs'], grow: ['progression', 'classes'], sigils: ['store-items'], social: ['ember-ring', 'world-boss'],
};
function guidePic(p, title) {
  if (!p) return '';
  if (p.startsWith('s:')) return '<div class="gpics">' + p.slice(2).split(',').slice(0, 5).map(n => pic(n.trim(), 0, '')).join('') + '</div>';
  return '<div class="gicon">' + icon(p.slice(2)) + '</div>';
}
for (const c of GUIDE) {
  const s = GUIDE_SLUG[c.id] || slug(c.name);
  pages.push({
    slug: s, title: c.name, nav: c.name, group: 'Guide', icon: c.icon,
    desc: 'Lanternhold guide: ' + c.name.toLowerCase() + '. ' + c.topics.slice(0, 4).map(t => strip(t[2])).join(' ').slice(0, 130),
    lede: 'From the Delver’s Guide inside the game. ' + c.topics.length + ' topics.',
    body: () => '<div class="toc">' + c.topics.map(t => '<a href="#' + slug(t[0]) + '">' + esc(t[0]) + '</a>').join('') + '</div>' +
      '<div class="guide">' + c.topics.map(([t, p, sum, pts]) => card(slug(t), esc(t), {
        cls: 'gcard', pic: guidePic(p, t), sub: sum, body: '<ul>' + pts.map(x => '<li>' + x + '</li>').join('') + '</ul>' })).join('') + '</div>' +
      related(GUIDE_REL[c.id]),
  });
  for (const [t, , sum, pts] of c.topics) addSearch(s, t, slug(t), sum + ' ' + pts.join(' '), c.name);
}
function related(list) {
  if (!list || !list.length) return '';
  return '<section class="related"><h2>Look it up</h2><div class="rel">' + list.map(r => {
    const p = pages.find(x => x.slug === r) || REF.find(x => x.slug === r);
    return p ? '<a href="/wiki/' + p.slug + '/">' + icon(p.icon) + '<span>' + esc(p.title) + '</span></a>' : '';
  }).join('') + '</div></section>';
}

// ================= Reference pages (from the game's data tables) =================
const REF = [];
function ref(p) { p.group = 'Reference'; REF.push(p); pages.push(p); }

// ---- Classes ----
ref({
  slug: 'classes', title: 'Classes', icon: 'sword',
  desc: 'The five Lanternhold classes: Tank, Healer, Rogue, Mage and Necromancer. Abilities, skill trees, hero specializations, auras and favoured stats.',
  lede: 'Five seats, five roles. Every hero and companion belongs to one class, and each class has its own ability, skill tree and gear.',
  body: () => {
    const nav = '<div class="toc">' + CO.map(c => '<a href="#' + c + '">' + esc(clsName(c)) + '</a>').join('') + '</div>';
    return nav + CO.map(c => {
      const k = CLS[c], extras = [];
      if (k.armor) extras.push(['Armor', pct(k.armor) + ' less damage taken']);
      if (k.heal) extras.push(['Healing', k.heal + ' per second at level 1']);
      if (k.dodge) extras.push(['Dodge', pct(k.dodge) + ' of attacks']);
      if (k.drain) extras.push(['Life drain', pct(k.drain) + ' of damage dealt']);
      const fav = (L.STAT_CLASS[c] || []).map(id => (L.STATS.find(x => x.id === id) || {}).name).filter(Boolean);
      const aura = L.AURAS[c];
      const tree = L.SKILL_TREES[c] || [];
      const specs = L.SPECS[c] || [];
      const seat = L.POS_NAME[L.FORMATION[c]];
      const base = (L.BASES || {})[c];
      const treeHtml = '<div class="tree">' + tree.map(b => '<div class="branch"><h4>' + esc(b.b) + '</h4><ol>' + b.s.map(s =>
        '<li><b>' + esc(s.n) + '</b><span class="tier">Tier ' + (s.tier + 1) + ' · ' + s.r + (s.r > 1 ? ' ranks' : ' rank') + ' · ' + L.skillCost(s) + ' Kindling each</span><small>' + esc(L.skillText(s, s.r)) + (s.r > 1 ? ' (at ' + s.r + ' ranks)' : '') + '</small></li>').join('') + '</ol></div>').join('') + '</div>';
      return '<section class="block cls" id="' + c + '" style="--acc:' + k.color + '">' +
        '<div class="clshead">' + pic(c, 0, k.name, 'big') + '<div><h2><a class="anchor" href="#' + c + '">' + esc(k.name) + '</a></h2>' +
        '<p class="sub">Ability: <b>' + esc(k.ability.name) + '</b>. ' + esc(k.ability.desc) + ' Cooldown ' + k.ability.cd + 's.</p>' +
        kv([['Health', k.hp + ' at level 1'], ['Damage', k.dps + ' per second at level 1']].concat(extras).concat([
          ['Favoured stats', fav.join(' and ') + ' (×' + L.STAT_AFFINITY + ')'], L.RES_KIND && L.RES_KIND[c] ? ['Resource', (L.RES_KIND[c] === 'mana' ? 'Mana' : 'Stamina') + ' (' + L.RES_MAX + ', refills ' + L.RES_REGEN[L.RES_KIND[c]] + '/s). Ability costs ' + L.AB_COST + (L.RES_KIND[c] === 'mana' && c === 'healer' ? '; healing drains mana too, and Lantern Hymn uses whatever is left up to the cost' : '')] : null, ['Default seat', seat], RING_ARMS[c] ? ['Ember Ring arms', esc(RING_ARMS[c])] : null])) + '</div></div>' +
        (specs.length ? '<h3>Hero specializations</h3><p class="note">Your own hero learns these from the last tier of each skill branch. Keys 6 to 8.</p><div class="grid3">' + specs.map(a =>
          '<div class="mini"><b>' + esc(a.name) + '</b><small>' + esc(a.desc) + '</small><span class="tier">Cooldown ' + a.cd + 's' + (a.dur ? ' · lasts ' + a.dur + 's' : '') + '</span></div>').join('') + '</div>' : '') +
        '<h3>Skill tree</h3><p class="note">Three branches of four skills, paid for with Kindling. A skill needs the one above it first. Reset free at camp.</p>' + treeHtml +
        (aura ? '<h3>' + esc(aura.name) + '</h3><p class="note">Verified Grand War commanders carry this aura. It grows with war rank (' + pct(L.AURA_TIER[0]) + ' to ' + pct(L.AURA_TIER[L.AURA_TIER.length - 1]) + ' base).</p><ul>' +
          aura.fx.map(([, m, d]) => '<li>' + pct(L.AURA_TIER[0] * m, 1) + ' to ' + pct(L.AURA_TIER[L.AURA_TIER.length - 1] * m, 1) + ' ' + esc(d) + '</li>').join('') + '</ul>' : '') +
        (base ? '<h3>Class gear</h3><div class="chips">' + Object.entries(base).map(([sl, n]) => chip('<small>' + esc(L.SLOT_NAME[sl] || sl) + '</small> ' + esc(n))).join('') + '</div>' : '') +
        '</section>';
    }).join('');
  },
  index: () => {
    for (const c of CO) {
      const k = CLS[c];
      addSearch('classes', k.name, c, k.ability.name + ': ' + k.ability.desc, 'Class');
      for (const b of L.SKILL_TREES[c] || []) for (const s of b.s) addSearch('classes', s.n, c, k.name + ' skill (' + b.b + '): ' + L.skillText(s, s.r), 'Skill');
      for (const a of L.SPECS[c] || []) addSearch('classes', a.name, c, k.name + ' specialization: ' + a.desc, 'Ability');
    }
  },
});

// ---- Companions ----
ref({
  slug: 'companions', title: 'Companions', icon: 'users',
  desc: 'Every Lanternhold story companion: who they are, their class, banner and when they matter. Plus how companion traits work.',
  lede: 'Story companions join as you go deeper and rest by the campfire until you bring them along. They are a little weaker than other players’ heroes, by design.',
  body: () => {
    const tiers = [[0, 'The first five'], [1, 'Met deeper down']];
    return tiers.map(([t, h]) => '<h2>' + h + '</h2><div class="grid2">' + L.MEMBERS.filter(m => m.tier === t).map(m => {
      const side = L.SIDES[m.side];
      return card(m.id, esc(m.name), { pic: pic(m.cls, m.hue, m.name), style: '--acc:' + CLS[m.cls].color,
        sub: esc(m.title) + ' · ' + chip(esc(clsName(m.cls)), 'c') + (side ? ' ' + chip(esc(side.name), 's') : ''),
        body: '<p>' + esc(m.bio) + '</p>' + (m.line ? '<p class="quote">' + esc(m.line) + '</p>' : '') });
    }).join('') + '</div>').join('') +
      '<h2 id="traits">Companion traits</h2><p>Every story companion rolls three traits when they join: one for a seat, one for a class they fight beside, and one for camp. Traits come in Common, Fine and Rare grades.</p>' +
      table(['Kind', 'Names', 'What it can give'], [
        ['Position', L.POS_TRAIT_NAME.map((n, i) => esc(n) + ' <small>(' + L.POS_NAME[i] + ')</small>').join(', '), Object.values(L.TRAIT_FX).map(f => pct(f.lo, 1) + ' to ' + pct(f.hi, 1) + ' ' + f.n).join('; ')],
        ['Kinship', Object.entries(L.KIN_TRAIT_NAME).map(([c, n]) => esc(n) + ' <small>(' + clsName(c) + ')</small>').join(', '), 'Same range as position traits, while that class is in the party'],
        ['Camp', Object.entries(L.CAMP_TRAIT_NAME).map(([k, n]) => esc(n)).join(', '), Object.values(L.CAMP_TRAITS).map(f => pct(f.lo) + ' to ' + pct(f.hi) + ' ' + f.n).join('; ')],
      ]) + related(['camp-and-jobs', 'classes', 'banners']);
  },
  index: () => { for (const m of L.MEMBERS) addSearch('companions', m.name, m.id, m.title + '. ' + clsName(m.cls) + '. ' + m.bio, 'Companion'); addSearch('companions', 'Companion traits', 'traits', 'Position, kinship and camp traits. ' + L.POS_TRAIT_NAME.join(', ') + ', ' + Object.values(L.KIN_TRAIT_NAME).join(', ') + ', ' + Object.values(L.CAMP_TRAIT_NAME).join(', '), 'Traits'); },
});

// ---- Banners ----
ref({
  slug: 'banners', title: 'Banners and alliances', nav: 'Banners', icon: 'flare',
  desc: 'The five Grand War banners in Lanternhold: Iron Covenant, Radiant Ascendancy, Devouring Tide, Mercy Corps and Unsworn. Perks, banner kin and Grand War auras.',
  lede: 'Your hero flies one banner, picked when you start. Lanternhold is the quietest front of the Grand War, and every warband down here answers to one of these alliances.',
  body: () => '<div class="grid2">' + L.SIDE_ORDER.map(id => { const s = L.SIDES[id];
    return card(id, esc(s.name), { style: '--acc:' + s.color, cls: 'banner', sub: '<i>“' + esc(s.motto) + '”</i>', body: '<p>' + esc(s.desc) + '</p>' + kv([['Perk', esc(s.perk)], ['Companions', L.MEMBERS.filter(m => m.side === id).map(m => '<a href="/wiki/companions/#' + m.id + '">' + esc(m.name) + '</a>').join(', ') || 'None']]) }); }).join('') + '</div>' +
    '<h2 id="kin">Banner kin</h2><p>Each other party member who marches under your banner makes your perk <b>' + pct(L.KIN_AMP) + ' stronger</b>. A Covenant hero with two Covenant companions gets ' + pct(0.15 * (1 + 2 * L.KIN_AMP), 1) + ' party health instead of +15%.</p>' +
    '<h2 id="mercy">Mercy’s Blessing</h2><p>When the Grand War’s Mercy Corps receives donations, every player gets ' + Object.entries(L.MERCY_FX).map(([k, v]) => pct(v, 1) + ' ' + ({ gold: 'gold', hp: 'health', heal: 'healing' }[k] || k)).join(', ') + ' while it burns.</p>' +
    '<h2 id="honors">Grand War honors</h2>' + table(['Honor', 'Bonus'], L.HONOR_FX.map(([h, n, , v, d]) => [esc(h), esc(n) + ': ' + pct(v, 1) + ' ' + esc(d)])) + related(['companions', 'classes']),
  index: () => { for (const id of L.SIDE_ORDER) { const s = L.SIDES[id]; addSearch('banners', s.name, id, s.motto + ' ' + s.perk + '. ' + s.desc, 'Banner'); } addSearch('banners', 'Banner kin', 'kin', 'Party members under your banner amplify your banner perk', 'Banner'); },
});

// ---- Regions ----
const regionFloors = i => [i * 10 + 1, i * 10 + 10];
const loreBy = id => L.LORE.find(x => x.id === id);
ref({
  slug: 'regions', title: 'Regions of the Deep', nav: 'Regions', icon: 'map',
  desc: 'All ' + L.BIOMES.length + ' regions of the Lantern Deep in Lanternhold Act One: floors, guardians, Grand War warbands, signature monsters and tricks.',
  lede: 'Act One runs from the Lamplit Cellars to the Rift Threshold, ' + L.BIOMES.length + ' regions of ten floors each, ending on floor ' + L.ACT_ONE_END + '. Act Two opens with Grand War Season 2.',
  body: () => '<ol class="regions">' + L.BIOMES.map((b, i) => {
    const [a, z] = regionFloors(i), side = L.SIDES[b.war.side], gl = loreBy('g' + i), pl = loreBy('biome' + i);
    const boss = L.BOSS_SPRITES ? null : null;
    const bossSpr = ['golem', 'wyrm', 'lich'][Math.floor(z / L.BOSS_EVERY) % 3];
    return '<li class="region" id="' + slug(b.name) + '" style="--acc:' + b.accent + ';--bg1:' + b.bg[0] + ';--bg2:' + b.bg[1] + '">' +
      '<div class="rhead"><span class="floors">Floors ' + a + '–' + z + '</span><h2><a class="anchor" href="#' + slug(b.name) + '">' + esc(b.name) + '</a></h2></div>' +
      (pl ? '<p>' + esc(pl.text) + '</p>' : '') +
      '<div class="rgrid"><div class="rcell">' + pic(bossSpr, b.hue, b.boss, 'mid') + '<div><small>Region guardian</small><b>' + esc(b.boss) + '</b>' + (gl ? '<p>' + esc(gl.text) + '</p>' : '') + '</div></div>' +
      '<div class="rcell"><div class="facts">' + kv([
        ['Warband', side ? '<span style="color:' + side.color + '">' + esc(side.name) + '</span>' : ''],
        ['Soldiers', b.war.units.map(esc).join(', ')],
        b.foe ? ['Native monster', '<a href="/wiki/bestiary/#' + b.foe.id + '">' + esc(b.foe.name) + '</a>'] : null,
        b.mod ? ['Signature trick', esc(L.MODS[b.mod].name) + ' <small>' + esc(L.MODS[b.mod].desc) + '</small>'] : null,
        L.BOSS_SPECIAL && L.SPECIALS[L.BOSS_SPECIAL[i]] ? ['Guardian attack', esc(L.SPECIALS[L.BOSS_SPECIAL[i]].name) + ' <small>' + esc(L.SPECIALS[L.BOSS_SPECIAL[i]].desc) + '</small>'] : null,
        (L.REGION_SETS || [])[i] ? ['Region set', '<a href="/wiki/sets/#rset-' + i + '">' + esc(L.REGION_SETS[i].name) + '</a>'] : null,
      ]) + '</div></div></div></li>';
  }).join('') + '</ol>' + related(['bestiary', 'world-boss']),
  index: () => L.BIOMES.forEach((b, i) => { const [a, z] = regionFloors(i), pl = loreBy('biome' + i); addSearch('regions', b.name, slug(b.name), 'Floors ' + a + '-' + z + '. Guardian: ' + b.boss + '. ' + (pl ? pl.text : ''), 'Region'); addSearch('regions', b.boss, slug(b.name), 'Guardian of ' + b.name + ', floor ' + z + '. ' + ((loreBy('g' + i) || {}).text || ''), 'Guardian'); }),
});

// ---- Bestiary ----
ref({
  slug: 'bestiary', title: 'Bestiary', icon: 'skull',
  desc: 'Lanternhold monsters: common foes, region monsters, guardians, the Loot Goblin, ambush packs and every monster trick (enrage, ward, regen, venom, cleave, swift).',
  lede: 'Monsters hit back. Each floor holds ' + L.FOES_PER_FLOOR + ', every ' + L.BOSS_EVERY + 'th floor has a guardian, and ' + pct(L.ELITE_CHANCE) + ' of foes are Grand War warband soldiers.',
  body: () => {
    const foe = (id, name, hue, extra) => { const lo = loreBy('foe_' + id); return card(id, esc(name), { pic: pic(id, hue || 0, name), body: (lo ? '<p>' + esc(lo.text) + '</p>' : '') + (extra || '') }); };
    const regional = L.BIOMES.map((b, i) => b.foe ? foe(b.foe.id, b.foe.name, b.hue, kv([['Found in', '<a href="/wiki/regions/#' + slug(b.name) + '">' + esc(b.name) + '</a> (floors ' + regionFloors(i).join('–') + ')'], b.mod ? ['Trick', esc(L.MODS[b.mod].name)] : null])) : '').join('');
    const bl = loreBy('boss'), cl = loreBy('foe_chest');
    return '<h2>Common foes</h2><p class="note">Found everywhere, tinted by the region they live in.</p><div class="grid3">' + L.FOES.map(f => foe(f.id, f.name)).join('') + '</div>' +
      '<h2>Region monsters</h2><div class="grid3">' + regional + '</div>' +
      '<h2 id="guardians">Guardians</h2>' + (bl ? '<p>' + esc(bl.text) + '</p>' : '') + '<div class="grid3">' + ['golem', 'wyrm', 'lich'].map(s => '<div class="mini center">' + pic(s, 0, s) + '</div>').join('') + '</div>' +
      '<p>Beat a guardian before the lantern runs out (' + 30 + ' seconds to start). Each region guardian is listed on <a href="/wiki/regions/">Regions</a>.</p>' +
      '<h2 id="tricks">Monster tricks</h2>' + table(['Trick', 'What it does'], Object.values(L.MODS).map(m => ['<b>' + esc(m.name) + '</b>', esc(m.desc)])) +
      '<h2 id="ghost-lantern">Ghost Lantern</h2><p>From floor ' + L.GHOST_FLOOR + ', and only while you are playing, a Ghost Lantern sometimes drifts into the fight. It slowly saps party damage or healing, up to ' + pct(L.GHOST_MAX) + '. Tap it to shatter it for a burst of gold, some Dust or a free tonic. Left alone it fades after ' + L.GHOST_LIFE + ' seconds and nothing is lost.</p>' +
      '<h2 id="specials">Special attacks</h2><p>Every guardian, and about ' + pct(L.SPECIAL_CHANCE || 0.3) + ' of monsters from floor ' + L.SPECIAL_FLOOR + ', winds up a special attack every 10 to 12 seconds. A red banner and a red ring under the target give you ' + L.SPECIAL_WARN + ' seconds of warning. Burns and poison keep ticking for ' + L.DOT_FIGHTS + ' fights; a healer\u2019s ability, Purify or the campfire clears them. One special never takes more than 35% of a hero\u2019s health (20% each when it hits the whole party).</p>' +
        table(['Attack', 'Used by', 'What it does'], Object.entries(L.SPECIALS).map(([id, sp]) => { const by = [];
          L.BOSS_SPECIAL.forEach((x, i) => { if (x === id) by.push(L.BIOMES[i].boss); });
          for (const [b, x] of Object.entries(L.BODY_SPECIAL)) if (x === id) by.push({ golem: 'Stone Sentinel', wyrm: 'Tunnel Wyrm', lich: 'Bone Hierarch' }[b]);
          for (const [f, x] of Object.entries(L.FOE_SPECIAL)) if (x === id) { const fo = L.FOES.find(q => q.id === f) || (L.BIOMES.find(q => q.foe && q.foe.id === f) || {}).foe; if (fo) by.push(fo.name); }
          if (id === 'volley') by.push('Grand War soldiers');
          return ['<b>' + esc(sp.name) + '</b>', esc([...new Set(by)].join(', ')), esc(sp.desc) + (sp.dot ? ' (' + (sp.dot === 'burn' ? 'burn' : 'poison') + ', ' + L.DOT_FIGHTS + ' fights)' : '')]; })) +
      '<h2 id="ambush">Ambushes</h2><p>From floor ' + L.PACK_FLOOR + ', ' + pct(L.PACK_CHANCE) + ' of fights are ambush packs of 2 to 4 monsters. They hit the rear of your marching order first and pay ' + L.PACK_GOLD + '× gold each.</p>' +
      '<h2 id="loot-goblin">Loot Goblin</h2><div class="grid2">' + card('goblin-card', 'Loot Goblin', { pic: pic('goblin', 0, 'Loot Goblin'), body: kv([['Appears from', 'Floor ' + L.GOBLIN_FLOOR], ['Time to kill', L.GOBLIN_TIME + ' seconds'], ['Reward', L.GOBLIN_GOLD + '× gold']]) + '<p>If it escapes it steals one item from your pack (never worn or locked gear) and hides a few floors deeper.</p>' }) +
      card('chest', 'Treasure chests', { pic: pic('chest', 0, 'Treasure chest'), body: (cl ? '<p>' + esc(cl.text) + '</p>' : '') }) + '</div>' + related(['regions', 'world-boss']);
  },
  index: () => { for (const f of L.FOES) addSearch('bestiary', f.name, f.id, (loreBy('foe_' + f.id) || {}).text, 'Monster'); for (const b of L.BIOMES) if (b.foe) addSearch('bestiary', b.foe.name, b.foe.id, 'Native to ' + b.name + '. ' + ((loreBy('foe_' + b.foe.id) || {}).text || ''), 'Monster');
    for (const m of Object.values(L.MODS)) addSearch('bestiary', m.name, 'tricks', 'Monster trick: ' + m.desc, 'Trick'); for (const sp of Object.values(L.SPECIALS || {})) addSearch('bestiary', sp.name, 'specials', 'Special attack: ' + sp.desc, 'Attack'); addSearch('bestiary', 'Loot Goblin', 'loot-goblin', 'A rare thief from floor ' + L.GOBLIN_FLOOR + '. Kill it within ' + L.GOBLIN_TIME + ' seconds.', 'Monster'); addSearch('bestiary', 'Ambushes', 'ambush', 'Packs of 2 to 4 monsters', 'Combat'); },
});

// ---- Gear ----
ref({
  slug: 'gear', title: 'Gear', icon: 'gear-armor',
  desc: 'Lanternhold gear reference: slots, rarities, level requirements, upgrades, merging risk, salvage, Dust and pack space.',
  lede: 'Gear drops from monsters, chests and guardians. Each piece fits one class and one slot, and needs a hero level of ' + 1.5 + '× its item level.',
  body: () => {
    const totW = L.RARITY.reduce((a, r) => a + r.w, 0);
    const slots = ['main', 'off', 'head', 'neck', 'chest', 'robe', 'legs', 'feet', 'ring'];
    const ups = []; for (let u = 1; u <= L.UP_MAX; u++) ups.push(u);
    return '<h2 id="slots">Slots</h2><p>Main hand, offhand, helmet, trinket (a second one unlocks with Kindling), chest, legs, feet and up to five rings. Robes are for Healers, Mages and Necromancers and cover the chest and legs.</p>' +
      table(['Class'].concat(slots.map(s => esc(L.SLOT_NAME[s]))), CO.map(c => ['<b>' + clsName(c) + '</b>'].concat(slots.map(s => esc((L.BASES || {})[c] && L.BASES[c][s] || '–')))), 'small') +
      '<h2 id="rarity">Rarity</h2>' + table(['Rarity', 'Drop share', 'Power', 'Enchant sockets', 'Dust when scrapped'], L.RARITY.map(r => [
        '<span class="rar r-' + r.id + '">' + r.name + '</span>', r.w ? pct(r.w / totW) : r.id === 'goblin' ? 'Loot Goblin only' : 'Guardians and chests', pct(r.pct, 1) + ' per item level step', String(((L.SOCK_BASE) || { common: 0, fine: 1, rare: 2, epic: 3, set: 2 })[r.id] || 0), String(((L.DUST) || { common: 1, fine: 3, rare: 8, epic: 20, set: 15 })[r.id] || '–') + '+'])) +
      '<p class="note">Power grows 3% per item level and 20% per upgrade. Items from floor 30 and floor 80 get one more socket each, up to ' + 4 + '.</p>' +
      '<h2 id="upgrades">Upgrades and merging</h2><p>Upgrade a piece with gold up to +' + L.UP_MAX + ', or merge two copies of the same item into one at one level higher. A failed merge destroys both pieces. Luck and Intelligence cut the risk, up to half.</p>' +
      table(['Merge to', 'Base risk', 'With 40 Luck and 25 Intelligence'], ups.map(u => { const r = L.mergeRisk({ attr: { lck: 40, int: 25 } }, { up: u - 1 }, { up: 0 }); return ['+' + u, pct(r.base), pct(r.risk)]; }), 'small') +
      '<h2 id="pack">Your pack</h2>' + kv([['Starting space', L.GEAR_CAP + ' items'], ['Kindling', '+' + L.BAG_STEP + ' slots, up to ' + L.BAG_UPS_MAX + ' times'], ['Lantern Pass', '+' + L.PASS_BAG + ' slots'], ['Bag of Holding', 'Endless, ' + num(L.BOH_COST) + ' Sigils once']]) +
      related(['sets', 'enchantments', 'gear-and-loot']);
  },
  index: () => { addSearch('gear', 'Gear slots', 'slots', 'Main hand, offhand, helmet, trinket, chest, robe, legs, feet, rings', 'Gear'); addSearch('gear', 'Rarity', 'rarity', L.RARITY.map(r => r.name).join(', '), 'Gear'); addSearch('gear', 'Upgrades and merging', 'upgrades', 'Merge risk table, upgrade to +' + L.UP_MAX, 'Gear'); addSearch('gear', 'Pack space', 'pack', 'Bag of Holding, Kindling bag slots', 'Gear');
    for (const c of CO) for (const [sl, n] of Object.entries((L.BASES || {})[c] || {})) addSearch('gear', n, 'slots', clsName(c) + ' ' + (L.SLOT_NAME[sl] || sl), 'Item'); },
});

// ---- Sets ----
ref({
  slug: 'sets', title: 'Item sets', nav: 'Sets', icon: 'crown',
  desc: 'Every Lanternhold item set: the fifteen region sets, the Loot Goblin’s Sack, class sets with their bonuses and lore, and the six camp job sets.',
  lede: 'Every region of the Deep has its own four-piece set, each class has a three-piece set from guardians, and each camp job has a set too.',
  body: () => {
    const sets = L.SETS.map(s => {
      const lo = loreBy('set_' + s.id), extra = [];
      if (s.region != null || s.biome != null) { const b = L.BIOMES[s.region != null ? s.region : s.biome]; if (b) extra.push(['Drops in', '<a href="/wiki/regions/#' + slug(b.name) + '">' + esc(b.name) + '</a>']); }
      if (s.four) extra.push(['4 pieces', esc(s.four)]);
      return card('set-' + s.id, esc(s.name), { style: '--acc:' + (CLS[s.cls] || {}).color, sub: chip(esc(clsName(s.cls)), 'c'),
        body: '<div class="chips">' + Object.entries(s.pieces).map(([sl, n]) => chip('<small>' + esc(L.SLOT_NAME[sl] || sl) + '</small> ' + esc(n), 'set')).join('') + '</div>' +
          kv([['2 pieces', esc(s.two)], ['3 pieces', esc(s.three)]].concat(extra)) + ((s.lore || lo) ? '<p class="quote">' + esc(s.lore || lo.text) + '</p>' : '') });
    }).join('');
    const jobs = Object.entries(L.JOB_SETS).map(([id, s]) => { const j = L.JOBS.find(x => x.id === id) || {};
      return card('job-' + id, esc(s.name), { sub: 'For the ' + esc(j.name || id) + ' camp job', body: '<div class="chips">' + Object.entries(s.pieces).map(([sl, n]) => chip('<small>' + esc(L.SLOT_NAME[sl] || sl) + '</small> ' + esc(n), 'job')).join('') + '</div>' +
        kv([['2 pieces', pct(L.JOB_SET_TWO, 1) + ' to the job'], ['3 pieces', pct(L.JOB_SET_THREE, 1) + ' to the job']]) }); }).join('');
    const RS = L.REGION_SETS || [];
    const KN = { dps: 'damage', hp: 'health', heal: 'healing (health for non-healers)', gold: 'gold for the whole party' };
    const regionSets = RS.length ? '<h2 id="region-sets">Region sets</h2><p>Every region of the Deep drops its own four-piece armor set (head, chest, legs and feet) for any class. Pieces drop only on that region’s floors, and guardians are the best bet' +
      (L.RSET_DROP ? ' (' + pct(L.RSET_DROP.boss) + ' a guardian, ' + pct(L.RSET_DROP.chest) + ' a chest)' : '') + '. Two pieces boost one stat. Four pieces add damage and health that multiply all of that hero’s gear, and the bonuses never fall behind item level, so a finished set lasts through rekindles. Region pieces are bound to the Hold: they cannot be sold or sent.</p>' +
      '<div class="toc">' + RS.map((r, i) => '<a href="#rset-' + i + '">' + esc(r.name) + '</a>').join('') + '</div><div class="grid3">' + RS.map((r, i) => {
        const b = L.BIOMES[i] || {}, two = L.rsetTwo ? L.rsetTwo(i) : 0, four = L.rsetFour ? L.rsetFour(i) : 0, fl = regionFloors(i);
        return card('rset-' + i, esc(r.name), { style: '--acc:' + (b.accent || 'var(--gold)'), pic: pic('chest', b.hue || 0, ''), sub: '<a href="/wiki/regions/#' + slug(b.name || '') + '">' + esc(b.name || '') + '</a> · floors ' + fl[0] + '–' + fl[1],
          body: '<div class="chips">' + ['Head', 'Chest', 'Legs', 'Feet'].map(n => chip(n, 'set')).join('') + '</div>' +
            kv([['2 pieces', pct(two, 1) + ' ' + esc(KN[r.k] || r.k)], ['4 pieces', pct(four, 1) + ' damage and health']]) + (r.lore ? '<p class="quote">' + esc(r.lore) + '</p>' : '') });
      }).join('') + '</div><p class="note">Piece names follow the wearer: plate for Tanks (Helm, Hauberk, Greaves, Sabatons), leather for Rogues (Hood, Jerkin, Breeches, Boots) and cloth for everyone else (Cowl, Vestment, Leggings, Slippers).</p>' : '';
    const sack = L.GOBLIN_SACK_GOLD ? '<h2 id="goblin-sack">The Loot Goblin’s Sack</h2><div class="grid2">' + card('goblin-sack-card', 'Loot Goblin’s Sack', { pic: pic('goblin', 0, 'Loot Goblin'), sub: 'Trinket · one of the rarest finds in the Deep',
      body: kv([['While worn', pct(L.GOBLIN_SACK_GOLD, 1) + ' gold for the whole party'], ['Drop chance', 'About one <a href="/wiki/bestiary/#loot-goblin">Loot Goblin</a> kill in ' + num(Math.round(1 / L.GOBLIN_SACK_CHANCE))], ['Sockets', '3 enchant sockets']]) }) + '</div>' : '';
    return regionSets + sack + '<h2>Class sets</h2><div class="grid2">' + sets + '</div><h2 id="job-sets">Job sets</h2><p>From floor 20, guardians (3%) and chests (0.8%) can drop job set pieces. Any class can wear them, and they boost the camp job of whoever wears them.</p><div class="grid3">' + jobs + '</div>' +
      '<h2 id="job-affixes">Job affixes</h2><p>Some ordinary pieces roll a job affix instead (an orange dot in game): ' + Object.entries(L.AFFIX_CHANCE || {}).map(([r, v]) => r + ' ' + pct(v)).join(', ') + '.</p>' + related(['gear', 'camp-and-jobs']);
  },
  index: () => { for (const s of L.SETS) addSearch('sets', s.name, 'set-' + s.id, clsName(s.cls) + ' set. ' + Object.values(s.pieces).join(', ') + '. 2 pieces: ' + s.two + '. 3 pieces: ' + s.three, 'Set');
    for (const [id, s] of Object.entries(L.JOB_SETS)) addSearch('sets', s.name, 'job-' + id, 'Job set: ' + Object.values(s.pieces).join(', '), 'Set');
    (L.REGION_SETS || []).forEach((r, i) => addSearch('sets', r.name, 'rset-' + i, 'Region set from ' + ((L.BIOMES[i] || {}).name || '') + '. ' + r.word + ' pieces. 2 pieces: ' + pct(L.rsetTwo(i), 1) + ' ' + r.k + '. 4 pieces: ' + pct(L.rsetFour(i), 1) + ' damage and health. ' + (r.lore || ''), 'Region set'));
    if (L.GOBLIN_SACK_GOLD) addSearch('sets', 'Loot Goblin’s Sack', 'goblin-sack', 'Rare trinket from the Loot Goblin: ' + pct(L.GOBLIN_SACK_GOLD, 1) + ' party gold while worn', 'Item'); },
});

// ---- Enchantments ----
ref({
  slug: 'enchantments', title: 'Enchantments and Dust', nav: 'Enchantments', icon: 'star',
  desc: 'Lanternhold enchantments: every enchant, what each tier gives, caps, sockets, disenchanting and Dust costs.',
  lede: 'Sockets on gear hold enchants. Most help the whole party while anyone in it wears the item; four help only the wearer. Sigils never buy enchants.',
  body: () => {
    const fmt = (e, v) => e.fmt === 's' ? '+' + (Math.round(v * 10) / 10) + 's' : pct(v, 1);
    return '<h2 id="list">Enchants</h2>' + table(['Enchant', 'Gives', 'Helps', 'Per tier', 'Tier V', 'Cap'], Object.values(L.ENCH).map(e => ['<b>' + esc(e.name) + '</b>', esc(e.what), e.per ? 'Wearer only' : 'Whole party', fmt(e, e.v), fmt(e, e.v * 5), fmt(e, e.cap)])) + '<p>Flow, Leech, Bulwark and Plating help only the hero wearing the item. Rings and trinkets roll Flow and Leech more often, armor and shields roll Bulwark and Plating, and weapons roll Leech. Flow speeds mana regen for healers, mages and necromancers, and stamina regen for rogues and tanks.</p>' +
      '<h2 id="sockets">Sockets</h2><p>Fine items have 1 socket, rare 2, epic 3 and set pieces 2. Items from floor 30 and floor 80 on get one more each, up to 4. Common items get sockets from floor 30. Higher item levels roll higher tiers.</p>' +
      '<h2 id="disenchant">Disenchanting</h2><p>Disenchant destroys an item and moves one of its enchants into a socket on another item, of any class. Moving an enchant costs Dust: 5 × tier².</p>' +
      table(['Tier', 'I', 'II', 'III', 'IV', 'V', 'VI'], [['Dust'].concat([1, 2, 3, 4, 5, 6].map(t => String(L.enchCost({ t }))))], 'small') +
      '<h2 id="dust">Dust</h2><p>Every item you salvage, mass scrap or auto-scrap gives Dust as well as gold. Rarer, deeper and upgraded pieces give more. Rekindling keeps it.</p>' + related(['gear', 'sets']);
  },
  index: () => { for (const e of Object.values(L.ENCH)) addSearch('enchantments', e.name + ' enchant', 'list', '+' + e.what + ' for the party', 'Enchant'); addSearch('enchantments', 'Dust', 'dust', 'Scrap gear for Dust to move enchants', 'Gear'); addSearch('enchantments', 'Disenchanting', 'disenchant', 'Move an enchant to another item for Dust', 'Gear'); },
});

// ---- Camp and jobs ----
ref({
  slug: 'camp-and-jobs', title: 'Camp and jobs', nav: 'Camp and jobs', icon: 'flame',
  desc: 'Lanternhold camp: the main camp, Campfire Draughts, and all six camp jobs with their bonuses and best classes.',
  lede: 'Companions resting at camp can work a job that helps the whole party. Output grows with their power level and is 50% higher when the job suits their class.',
  body: () => '<div class="grid3">' + L.JOBS.map(j => card('job-' + j.id, esc(j.name), { pic: '<div class="gicon">' + icon(j.icon) + '</div>', sub: esc(j.desc),
      body: kv([['Gives', esc(j.fmt)], ['Best class', clsName(j.aff)], ['Job set', L.JOB_SETS[j.id] ? '<a href="/wiki/sets/#job-' + j.id + '">' + esc(L.JOB_SETS[j.id].name) + '</a>' : '–']]) })).join('') + '</div>' +
    '<h2 id="main-camp">Main camp</h2><p>Floor ' + L.CAMP_FLOOR + '. Swap companions, recruit, train camp companions and change gear. Descending again restarts you at the top of the region you left, so floor 99 becomes 91.</p>' +
    '<h2 id="draught">Campfire Draught</h2><p>A field camp for ' + 60 + ' seconds wherever you are: change gear and keep your floor. No companion swaps. Kindling’s Slow-burning Draught makes it last longer.</p>' + related(['companions', 'sets', 'store-items']),
  index: () => { for (const j of L.JOBS) addSearch('camp-and-jobs', j.name, 'job-' + j.id, 'Camp job: ' + j.fmt + '. Best for ' + clsName(j.aff) + '. ' + j.desc, 'Camp job'); addSearch('camp-and-jobs', 'Campfire Draught', 'draught', 'Field camp for 60 seconds', 'Camp'); },
});

// ---- Progression ----
ref({
  slug: 'progression', title: 'Progression', icon: 'star',
  desc: 'Lanternhold progression: hero stats, rekindling and Kindling upgrades, relics, records, daily quests and training milestones.',
  lede: 'Train your party with gold, level your hero, rekindle the lantern for Kindling, collect relics and chase records.',
  body: () => '<h2 id="two-levels">Power level and hero level</h2><p>Lanternhold has two kinds of level. <b>Power level</b> belongs to every character in your party, your hero included: you raise it with gold using Train on the Party tab, it sets their damage and health, and gear needs a certain power level to wear. Rekindling resets it. <b>Hero level</b> is your own hero\'s experience level: it rises from fighting, gives stat points, opens new parts of the game and lets you into deeper regions. It is never reset. So a hero can be hero level 11 with a power level of 142.</p>' +
    '<h2 id="stats">Hero stats</h2><p>Your hero earns XP from every fight and gains hero levels. Each hero level gives a stat point, two every fifth level. Stats start at ' + L.STAT_BASE + ' and cap at ' + L.STAT_MAX + '. Each class favours two stats, which count ×' + L.STAT_AFFINITY + '.</p>' +
    table(['Stat', 'Helps', 'Favoured by'], L.STATS.map(s => ['<b>' + esc(s.name) + '</b> <small>' + s.short + '</small>', esc(s.desc), CO.filter(c => (L.STAT_CLASS[c] || []).includes(s.id)).map(clsName).join(', ') || '–'])) +
    '<h2 id="unlocks">Hero level unlocks</h2><p>New parts of the game open as your hero levels up. Hero level carries over through rekindling.</p>' +
    table(['Hero level', 'Unlocks', 'What it does'], L.UNLOCKS.map(u => [String(u.lv), '<b>' + esc(u.name) + '</b>', esc(u.desc)])) +
    '<h2 id="regions">Region trials</h2><p>Each region has a trial that opens the way to the next one: defeat ' + L.TRIAL_ELITES + ' alliance elites in the region (the bannered warband foes) and beat its guardian. Until then the party keeps working the region it is in. Floors you have already reached stay open.</p>' +
    '<h2 id="roster">Campfire roster</h2><p>The campfire holds ' + L.ROSTER_BASE + ' companions, plus one more at hero levels ' + L.ROSTER_LV.join(', ') + '. When a new companion arrives and it is full, dismiss someone for good to keep them, or turn them away. Up to ' + L.ROSTER_BUY_MAX + ' more spots cost ' + L.ROSTER_COST + ' Sigils each. Camp job slots open at hero levels ' + L.JOB_SLOT_LV.join(', ') + '.</p>' +
    '<h2 id="mastery">Region mastery</h2><p>Every region has three goals. Each one finished adds ' + Math.round(L.MASTERY_PER * 100) + '% to a party stat for good.</p>' + table(['Goal', 'How', 'Bonus'], L.MASTERY.map(g => ['<b>' + esc(g.name) + '</b>', esc(g.desc), '+' + Math.round(L.MASTERY_PER * 100) + '% ' + esc(g.fx)])) +
    '<h2 id="rekindle">Rekindling</h2><p>At hero level ' + L.unlockOf('rekindle').lv + ', from floor ' + L.REKINDLE_FLOOR + ' or deeper, you can rekindle: start again from the top with Embers (a permanent bonus) and Kindling. Embers count from floor 60, so deeper descents pay far more. You get 2 Kindling, plus 1 for every 10 floors deeper. Your hero level, relics, Dust and Kindling upgrades stay.</p>' +
    '<h2 id="kindling">Kindling upgrades</h2>' + table(['Upgrade', 'Effect', 'Ranks', 'First rank'], L.KINDLE_UPS.map(u => ['<b>' + esc(u.name) + '</b>', esc(u.desc), String(u.max), u.base + ' Kindling'])) +
    '<p class="note">Kindling also buys skill tree ranks, +' + L.BAG_STEP + ' pack slots and extra ring and trinket slots. Changing class costs ' + L.CLASS_CHANGE_COST + ' Kindling.</p>' +
    '<h2 id="relics">Relics</h2><p>Guardians from floor 10 sometimes drop a relic. Duplicates level it up, and relics stay through rekindling.</p>' + table(['Relic', 'Bonus'], L.RELICS.map(r => ['<b>' + esc(r.name) + '</b>', esc(r.desc)])) +
    '<h2 id="records">Records</h2><p>Each record you earn adds ' + 1 + '% to party damage, permanently.</p><div class="grid3 tight">' + L.FEATS.map(f => '<div class="mini" id="feat-' + f.id + '">' + icon('cup') + '<b>' + esc(f.name) + '</b><small>' + esc(f.desc) + '</small></div>').join('') + '</div>' +
    '<h2 id="quests">Daily quests</h2><p>Three a day, picked from the list below. Each pays ' + L.QUEST_REWARD + ' Sigil, and finishing all three pays ' + L.QUEST_BONUS + ' more.</p><ul>' + L.QUESTS.map(q => '<li>' + esc(q.text.replace('{n}', num(q.n))) + '</li>').join('') + '</ul>' +
    '<h2 id="milestones">Training milestones</h2><p>Companions get a big power jump at power levels ' + L.MILESTONES.slice(0, 8).join(', ') + ' and on up to ' + num(L.MILESTONES[L.MILESTONES.length - 1]) + '.</p>' +
    '<h2 id="offline">While you are away</h2><p>Your party earns 25% of its gold for ' + (L.OFFLINE_BASE / 3600) + ' hours while the game is closed. Night Watch adds 16 hours a rank, up to ' + (L.OFFLINE_MAX / 3600) + ' hours.</p>' + related(['classes', 'getting-stronger']),
  index: () => { for (const s of L.STATS) addSearch('progression', s.name, 'stats', 'Hero stat: ' + s.desc, 'Stat'); for (const u of L.KINDLE_UPS) addSearch('progression', u.name, 'kindling', 'Kindling upgrade: ' + u.desc, 'Kindling'); for (const r of L.RELICS) addSearch('progression', r.name, 'relics', 'Relic: ' + r.desc, 'Relic');
    for (const f of L.FEATS) addSearch('progression', f.name, 'feat-' + f.id, 'Record: ' + f.desc, 'Record'); addSearch('progression', 'Rekindling', 'rekindle', 'Restart for Embers and Kindling from floor ' + L.REKINDLE_FLOOR, 'Progression'); addSearch('progression', 'Daily quests', 'quests', L.QUESTS.map(q => q.text.replace('{n}', q.n)).join('. '), 'Quests'); },
});

// ---- Store items ----
ref({
  slug: 'store-items', title: 'Camp store and tonics', nav: 'Store and tonics', icon: 'bag',
  desc: 'Lanternhold camp store: Campfire Draught, Lantern Oil and every tonic, what it does and how long it lasts. Plus Sigils, the Lantern Pass and Lantern Surge.',
  lede: 'The camp store sells consumables for gold, priced from what your party earns. Tonics stack time up to an hour.',
  body: () => '<div class="grid3">' + L.SHOP.map(s => card('item-' + s.id, esc(s.name), { pic: '<div class="gicon">' + icon(s.icon) + '</div>', body: '<p>' + esc(s.desc) + '</p>' })).join('') + '</div>' +
    '<h2 id="sigils">Sigils</h2><p>Sigils are the premium token. They drop very rarely in game (chests, guardians and daily quests) and can be bought in packs. They buy convenience and perks such as the Lantern Pass (' + L.PASS_COST + ' Sigils for ' + L.PASS_DAYS + ' days: +' + L.PASS_BAG + ' pack slots and 4 more offline hours), a stat respec (' + L.RESPEC_COST + ') and the Bag of Holding (' + num(L.BOH_COST) + '). Enchants, Ember Ring gear and auras can never be bought.</p>' +
    '<h2 id="surge">Lantern Surge</h2><p>Whenever any player buys a Sigil pack, every hero in the game gets ' + pct(L.SURGE_FX.gold, 1) + ' gold and ' + pct(L.SURGE_FX.xp, 1) + ' XP for a while.</p>' + related(['sigils-and-perks', 'camp-and-jobs']),
  index: () => { for (const s of L.SHOP) addSearch('store-items', s.name, 'item-' + s.id, s.desc, 'Item'); addSearch('store-items', 'Sigils', 'sigils', 'Premium token, Lantern Pass, Bag of Holding', 'Sigils'); addSearch('store-items', 'Lantern Surge', 'surge', 'Server-wide gold and XP boost', 'Sigils'); },
});

// ---- Ember Ring ----
ref({
  slug: 'ember-ring', title: 'The Ember Ring (PvP)', nav: 'Ember Ring (PvP)', icon: 'fist',
  desc: 'Lanternhold PvP: Ember Ring duels, rating titles, Laurels and every piece of the Ringwarden kit with its Edge and Resolve per rank.',
  lede: 'Duel other players’ heroes for rating and Laurels. Only your own hero fights, and companions, tonics and Sigils never count.',
  body: () => '<p>You hold up to ' + RING_EMAX + ' challenges, and one comes back every 30 minutes. Wins pay Laurels and rating; losses still pay a few Laurels. Your hero also defends while you are away.</p>' +
    (RING_KIT.length ? '<h2 id="kit">Ringwarden kit</h2><p>PvP gear bought with Laurels, ' + RING_MAX + ' ranks per piece. <b>Edge</b> is more damage to heroes, <b>Resolve</b> is less damage from heroes. It works only in the Ring.</p>' +
      table(['Piece', 'Slot', 'Edge per rank', 'Resolve per rank', 'Health per rank', 'Attack per rank'], RING_KIT.map(k => ['<b>' + esc(k.name) + '</b>', esc(L.SLOT_NAME[k.slot] || k.slot), String(k.E), String(k.R), k.hp ? pct(k.hp, 1) : '–', k.at ? pct(k.at, 1) : '–'])) +
      '<p class="note">Ranks cost 60 Laurels, then 30 more for each rank after. Kit tiers: Plain, Ironbound (ranks 1 to 5), Emberforged (6 to 10) and Starwrought (11 to 15). Higher ranks need a higher rating.</p>' : '') +
    (RING_TITLES.length ? '<h2 id="titles">Rating titles</h2>' + table(['Title', 'Rating'], RING_TITLES.map(([r, t]) => ['<b>' + esc(t) + '</b>', r ? num(r) + '+' : 'Starting'])) : '') + related(['playing-together', 'classes']),
  index: () => { addSearch('ember-ring', 'Ember Ring', '', 'PvP duels, Laurels, rating', 'PvP'); addSearch('ember-ring', 'Ringwarden kit', 'kit', 'PvP gear with Edge and Resolve. ' + RING_KIT.map(k => k.name).join(', '), 'PvP'); addSearch('ember-ring', 'Laurels', 'kit', 'Earned from duels, spent on the Ringwarden kit', 'PvP'); for (const [, t] of RING_TITLES) addSearch('ember-ring', t, 'titles', 'Ember Ring rating title', 'PvP'); },
});

// ---- World boss ----
ref({
  slug: 'world-boss', title: 'World boss weekends', nav: 'World boss', icon: 'crown',
  desc: 'Lanternhold world boss weekends: the shared Rift boss every Friday to Sunday, two-minute assaults, phases and Sigil rewards.',
  lede: 'One giant Rift boss every weekend that all signed-in players fight together, Friday to Sunday (UTC).',
  body: () => '<div class="grid2">' + card('boss', 'The Rift bosses', { pic: pic('colossus', 0, 'World boss'), body: '<p>The boss changes each weekend:</p><ul>' + L.WB_NAMES.map(n => '<li><b>' + esc(n) + '</b></li>').join('') + '</ul>' }) +
    card('assault', 'Assaults', { body: kv([['Length', (L.WB_TIME / 60) + ' minutes'], ['Cooldown', (L.WB_COOL / 60) + ' minutes'], ['Your damage', 'Counts at the strength of your deepest floor']]) + '<p>Everyone fills one shared health bar. Each phase broken makes the next one twice as tough.</p>' }) + '</div>' +
    '<h2 id="rewards">Rewards</h2><p>After the weekend, tap <b>Claim</b>: 3 Sigils for taking part, 1 more per phase broken (up to 5), 5 more for the top three, and a purse of gold.</p>' + related(['bestiary', 'combat']),
  index: () => { addSearch('world-boss', 'World boss weekends', '', 'Shared Rift boss Friday to Sunday. ' + L.WB_NAMES.join(', '), 'Event'); for (const n of L.WB_NAMES) addSearch('world-boss', n, 'boss', 'World boss', 'Event'); },
});

// ---- Lore ----
ref({
  slug: 'lore', title: 'Lore and journal', nav: 'Lore', icon: 'book',
  desc: 'The Lanternhold journal: the Hold, the Shattered Reach, the Nyx Rift and the Grand War, plus every place, guardian and relic entry.',
  lede: 'Journal entries unlock as you play. Places, guardians and the bearers’ relics can hint at the story, so they open on a tap.',
  body: () => {
    const groups = []; for (const x of L.LORE) { let g = groups.find(y => y.n === x.group); if (!g) groups.push(g = { n: x.group, e: [] }); g.e.push(x); }
    const open = { 'The Grand War': 1, People: 1 };
    return '<div class="toc">' + groups.map(g => '<a href="#' + slug(g.n) + '">' + esc(g.n) + '</a>').join('') + '</div>' + groups.map(g => '<h2 id="' + slug(g.n) + '">' + esc(g.n) + '</h2>' +
      (open[g.n] ? '<div class="grid2">' + g.e.map(x => card('lore-' + x.id, esc(x.title), { body: '<p>' + esc(x.text) + '</p>' })).join('') + '</div>'
        : '<div class="spoil">' + g.e.map(x => '<details id="lore-' + x.id + '"><summary>' + esc(x.title) + '</summary><p>' + esc(x.text) + '</p></details>').join('') + '</div>')).join('');
  },
  index: () => { for (const x of L.LORE) addSearch('lore', x.title, 'lore-' + x.id, x.group + '. ' + x.text, 'Lore'); },
});

// ---- Patch notes ----
if (NOTES.length) ref({
  slug: 'patch-notes', title: 'Patch notes', icon: 'refresh',
  desc: 'Every Lanternhold update, newest first: new systems, balance changes and fixes.',
  lede: 'Every update, newest first. The game shows these once after it updates.',
  body: () => NOTES.map(n => '<section class="note-entry" id="v' + n.v + '"><h3><a class="anchor" href="#v' + n.v + '">' + esc(n.title) + '</a></h3><p class="sub">Update ' + n.v + (n.date ? ' · ' + esc(n.date) : '') + '</p><ul>' + n.items.map(i => '<li>' + i + '</li>').join('') + '</ul></section>').join(''),
  index: () => { for (const n of NOTES.slice(0, 40)) addSearch('patch-notes', n.title, 'v' + n.v, (n.date || '') + '. ' + n.items.join(' '), 'Update'); },
});

// ================= rendering =================
const NAV_GROUPS = [['Guide', pages.filter(p => p.group === 'Guide')], ['Reference', REF]];
function shell(p, inner) {
  const url = BASE + '/wiki/' + (p.slug ? p.slug + '/' : '');
  const title = p.slug ? p.title + ' | Lanternhold Wiki' : 'Lanternhold Wiki: the player guide';
  const crumbs = p.slug ? [{ n: 'Wiki', u: BASE + '/wiki/' }, { n: p.title, u: url }] : [{ n: 'Wiki', u: BASE + '/wiki/' }];
  const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.n, item: c.u })) }];
  if (!p.slug) ld.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Lanternhold Wiki', url, publisher: { '@type': 'Organization', name: 'Born 2 Game, LLC' }, about: { '@type': 'VideoGame', name: 'Lanternhold', url: BASE + '/', genre: ['Idle', 'RPG', 'Dungeon crawler'], gamePlatform: 'Web browser', applicationCategory: 'Game', operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } } });
  else ld.push({ '@context': 'https://schema.org', '@type': 'Article', headline: p.title + ' (Lanternhold)', description: p.desc, mainEntityOfPage: url, publisher: { '@type': 'Organization', name: 'Born 2 Game, LLC' }, dateModified: new Date().toISOString().slice(0, 10), image: OG_IMG });
  const nav = NAV_GROUPS.map(([g, list]) => '<div class="ng"><h4>' + g + '</h4>' + list.map(x => '<a href="/wiki/' + x.slug + '/"' + (x === p ? ' aria-current="page"' : '') + '>' + icon(x.icon) + '<span>' + esc(x.nav || x.title) + '</span></a>').join('') + '</div>').join('');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title><meta name="description" content="' + esc(p.desc) + '"><link rel="canonical" href="' + url + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Lanternhold"><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(p.desc) + '"><meta property="og:url" content="' + url + '"><meta property="og:image" content="' + OG_IMG + '"><meta name="twitter:card" content="summary_large_image">' +
    '<meta name="theme-color" content="#04070d"><link rel="icon" href="/icon.svg" type="image/svg+xml">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<link rel="stylesheet" href="/wiki/wiki.css?v=' + STAMP + '">' +
    ld.map(x => '<script type="application/ld+json">' + JSON.stringify(x).replace(/</g, '\\u003c') + '</script>').join('') + '</head><body>' +
    '<a class="skip" href="#main">Skip to content</a>' +
    '<header class="top"><a class="brand" href="/wiki/"><img src="/icon.svg" alt="" width="32" height="32"><span><b>Lanternhold</b><small>Player wiki</small></span></a>' +
    '<div class="search" role="search"><label class="sr" for="q">Search the wiki</label>' + '<svg class="ic si" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' + '<input id="q" type="search" placeholder="Search classes, gear, monsters…" autocomplete="off" spellcheck="false"><kbd>/</kbd><div id="results" class="results" hidden></div></div>' +
    '<a class="play" href="/?ref=wiki">Play free</a></header>' +
    '<div class="shell"><nav class="side" aria-label="Wiki pages"><details class="navd"><summary>All pages</summary>' + nav + '</details><div class="navs">' + nav + '</div></nav>' +
    '<main id="main">' + (p.slug ? '<p class="crumb"><a href="/wiki/">Wiki</a> <span>/</span> ' + esc(p.group) + '</p><h1>' + esc(p.title) + '</h1>' + (p.lede ? '<p class="lede">' + p.lede + '</p>' : '') : '') + inner + '</main></div>' +
    '<footer class="foot"><div><b>Lanternhold</b> is made by Born 2 Game, LLC. This wiki is built from the game’s own data every time the game updates.</div>' +
    '<div class="flinks"><a href="/?ref=wiki">Play</a><a href="' + DISCORD + '" rel="noopener">Discord</a><a href="' + PRESS + '">Press kit</a><a href="/privacy.html">Privacy</a></div></footer>' +
    '<script src="/wiki/wiki.js?v=' + STAMP + '" defer></script></body></html>\n';
}

function homeBody() {
  const guide = pages.filter(p => p.group === 'Guide');
  const heroes = CO.map(c => pic(c, 0, clsName(c))).join('');
  const counts = [[L.BIOMES.length, 'regions'], [L.FOES.length + L.BIOMES.filter(b => b.foe).length, 'monsters'], [L.SETS.length + Object.keys(L.JOB_SETS).length, 'item sets'], [L.RELICS.length, 'relics'], [L.LORE.length, 'lore entries']];
  return '<section class="hero"><div class="htext"><p class="eyebrow">The Lantern Deep · A Grand War front</p><h1>Lanternhold Wiki</h1>' +
    '<p class="lede">Everything you need to carry the lantern down to the Nyx Rift: classes and skill trees, companions, gear and sets, every region and monster, and how each system works.</p>' +
    '<div class="hbtns"><a class="btn gold" href="/wiki/getting-started/">New here? Start with the basics</a><a class="btn" href="/?ref=wiki">Play Lanternhold free</a></div>' +
    '<ul class="counts">' + counts.map(([n, t]) => '<li><b>' + n + '</b><span>' + t + '</span></li>').join('') + '</ul></div><div class="hparty" aria-hidden="true">' + heroes + '</div></section>' +
    '<h2 class="sect">Guide</h2><div class="tiles">' + guide.map(p => '<a class="tile" href="/wiki/' + p.slug + '/">' + icon(p.icon) + '<b>' + esc(p.title) + '</b><small>' + esc(strip(GUIDE.find(g => (GUIDE_SLUG[g.id] || slug(g.name)) === p.slug).topics.map(t => t[0]).slice(0, 4).join(', '))) + '</small></a>').join('') + '</div>' +
    '<h2 class="sect">Reference</h2><div class="tiles">' + REF.map(p => '<a class="tile" href="/wiki/' + p.slug + '/">' + icon(p.icon) + '<b>' + esc(p.title) + '</b><small>' + esc(p.desc.split(': ').pop().split('. ')[0].slice(0, 110)) + '</small></a>').join('') + '</div>' +
    (NOTES[0] ? '<h2 class="sect">Latest update</h2><a class="latest" href="/wiki/patch-notes/#v' + NOTES[0].v + '"><b>' + esc(NOTES[0].title) + '</b><small>Update ' + NOTES[0].v + (NOTES[0].date ? ' · ' + esc(NOTES[0].date) : '') + '</small><span>' + esc(strip(NOTES[0].items[0])).slice(0, 180) + '</span></a>' : '') +
    '<section class="cta"><div><h2>Questions the wiki does not answer?</h2><p>Ask other delvers in #lanternhold-chat on the Grand War Discord, or report a bug in #lanternhold-bugs.</p></div><a class="btn" href="' + DISCORD + '" rel="noopener">' + icon('discord') + ' Join the Discord</a></section>';
}

// ---------- write ----------
const STAMP = (() => { try { return JSON.parse(fs.readFileSync(path.join(GAME, 'version.json'), 'utf8')).build; } catch (e) { return String(Date.now()); } })();
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const p of pages) if (p.index) p.index();
for (const p of pages) {
  const dir = path.join(OUT, p.slug); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), shell(p, p.body()));
  addSearch(p.slug, p.title, '', p.desc, p.group);
}
fs.writeFileSync(path.join(OUT, 'index.html'), shell({ slug: '', title: 'Lanternhold Wiki', desc: 'The Lanternhold player wiki: classes, skill trees, companions, gear and sets, enchantments, regions, monsters, PvP and world bosses, built from the game itself.', icon: 'lantern' }, homeBody()));
fs.writeFileSync(path.join(OUT, '404.html'), shell({ slug: '', title: 'Not found', desc: 'Page not found', icon: 'lantern' }, '<h1>Lost in the Deep</h1><p class="lede">That page is not here. Try the search above, or head back to the <a href="/wiki/">wiki home</a>.</p>'));
fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify(search));
fs.writeFileSync(path.join(OUT, 'icons.svg'), '<svg xmlns="http://www.w3.org/2000/svg">' + SYMBOLS + '</svg>');
fs.copyFileSync(path.join(HERE, 'wiki.css'), path.join(OUT, 'wiki.css'));
fs.copyFileSync(path.join(HERE, 'wiki.js'), path.join(OUT, 'wiki.js'));
const today = new Date().toISOString().slice(0, 10);
const urls = [BASE + '/', BASE + '/wiki/', BASE + '/press/'].concat(pages.map(p => BASE + '/wiki/' + p.slug + '/'));
fs.writeFileSync(path.join(SITE, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map(u => '<url><loc>' + u + '</loc><lastmod>' + today + '</lastmod></url>').join('\n') + '\n</urlset>\n');
console.log('wiki: ' + (pages.length + 1) + ' pages, ' + search.length + ' search entries, ' + written.size + ' images -> ' + OUT);
