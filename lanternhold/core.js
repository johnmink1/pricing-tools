/* Lanternhold: An Idle Descent — game rules and state (no DOM). */
(function (root) {
  'use strict';

  const VERSION = 1;
  const FOES_PER_FLOOR = 8;
  const BOSS_EVERY = 5;
  const BASE_LANTERN = 30; // seconds to beat a guardian
  const COST_GROWTH = 1.07;
  const REKINDLE_FLOOR = 25;

  const HEROES = [
    { id: 'pell',    name: 'Pell',          title: 'Torchbearer',     cost: 10,     dps: 1,      icon: 'torch',  line: 'Holds the light. Every level also sharpens your own strikes.' },
    { id: 'varga',   name: 'Varga',         title: 'Sellsword',       cost: 60,     dps: 5,      icon: 'sword',  line: 'Paid by the floor, and worth every coin.' },
    { id: 'moss',    name: 'Moss',          title: 'Hedge-Witch',     cost: 450,    dps: 24,     icon: 'leaf',   line: 'Brews things the crypt would rather not drink.' },
    { id: 'oduya',   name: 'Oduya',         title: 'Gravewarden',     cost: 4e3,    dps: 110,    icon: 'shield', line: 'Has buried worse than this. Twice.' },
    { id: 'kestrel', name: 'Kestrel',       title: 'Cave Ranger',     cost: 4e4,    dps: 520,    icon: 'bow',    line: 'Never misses in the dark. Rarely misses in the light.' },
    { id: 'brann',   name: 'Brann',         title: 'Runesmith',       cost: 4.5e5,  dps: 2600,   icon: 'hammer', line: 'Carves wards into anything that stands still.' },
    { id: 'oracle',  name: 'The Pale Oracle', title: 'Seer of Depths', cost: 6e6,   dps: 13000,  icon: 'eye',    line: 'Already knows how this fight ends.' },
    { id: 'ashe',    name: 'Sir Ashe',      title: 'Cinder Knight',   cost: 9e7,    dps: 7e4,    icon: 'helm',   line: 'Walked out of the Forges still burning.' },
    { id: 'yrsa',    name: 'Yrsa',          title: 'Deep Warden',     cost: 1.5e9,  dps: 4e5,    icon: 'key',    line: 'Keeps the keys to doors that should stay shut.' },
    { id: 'thess',   name: 'Old Thessaly',  title: 'Lampmother',      cost: 3e10,   dps: 2.5e6,  icon: 'lamp',   line: 'Lit the first lantern of the Hold. Still tends it.' },
    { id: 'vael',    name: 'Vael',          title: 'Starless Walker', cost: 8e11,   dps: 1.8e7,  icon: 'star',   line: 'Came up from below. Nobody asked how.' },
    { id: 'hollow',  name: 'The Hollow King', title: 'Reformed Tyrant', cost: 3e13, dps: 1.4e8,  icon: 'crown',  line: 'Once ruled the Vault. Now works for wages.' },
  ];

  const MILESTONES = [10, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000];

  const BIOMES = [
    { name: 'The Lamplit Cellars',   adj: ['Cellar', 'Dusty', 'Damp'],          hue: 0,    bg: ['#2a1d14', '#120c08'], accent: '#e9a447', boss: 'The Cellar Glutton' },
    { name: 'Mosswater Crypts',      adj: ['Mossy', 'Sodden', 'Rotting'],       hue: 70,   bg: ['#16261b', '#080f0a'], accent: '#8fcf6a', boss: 'Grandmother Rot' },
    { name: 'The Glimmer Fungus Deep', adj: ['Glowcap', 'Sporeling', 'Lurid'],  hue: 220,  bg: ['#1f1530', '#0b0714'], accent: '#c78bff', boss: 'The Mycelial Choir' },
    { name: 'Saltbone Galleries',    adj: ['Salt-crusted', 'Bleached', 'Brittle'], hue: 170, bg: ['#20272b', '#0b0f12'], accent: '#b9d6de', boss: 'Ossuary Prime' },
    { name: 'The Cinder Forges',     adj: ['Smouldering', 'Ashen', 'Slag'],     hue: -25,  bg: ['#33140c', '#140604'], accent: '#ff7a3d', boss: 'Furnace-Heart' },
    { name: 'The Drowned Chapel',    adj: ['Drowned', 'Brine', 'Pallid'],       hue: 160,  bg: ['#0f2130', '#050c14'], accent: '#6cc4e8', boss: 'The Sunken Bishop' },
    { name: 'Hollow Roots',          adj: ['Rootbound', 'Barkskin', 'Gnarled'], hue: 40,   bg: ['#22200f', '#0d0c05'], accent: '#d8c26a', boss: 'The Root Mother' },
    { name: 'The Starless Vault',    adj: ['Void-touched', 'Starless', 'Umbral'], hue: 250, bg: ['#141022', '#05040b'], accent: '#9aa6ff', boss: 'The Unlit' },
  ];

  const FOES = [
    { id: 'slime',    name: 'Gloop' },
    { id: 'rat',      name: 'Gnawer' },
    { id: 'bat',      name: 'Flitterwing' },
    { id: 'skeleton', name: 'Rattlebones' },
    { id: 'eye',      name: 'Watcher' },
    { id: 'shroom',   name: 'Capling' },
    { id: 'ghost',    name: 'Wisp' },
  ];
  const BOSS_SPRITES = ['golem', 'wyrm', 'lich'];

  const SKILLS = [
    { id: 'flare',   name: 'Flare',    unlock: 5,  dur: 30, cd: 180, desc: 'Your party deals double damage for 30s.' },
    { id: 'plunder', name: 'Plunder',  unlock: 15, dur: 30, cd: 300, desc: 'Foes drop double gold for 30s.' },
    { id: 'frenzy',  name: 'Frenzy',   unlock: 25, dur: 20, cd: 240, desc: 'Strike 12 times a second for 20s.' },
    { id: 'reserve', name: 'Oil Reserve', unlock: 40, dur: 0, cd: 600, desc: 'Refill the lantern and reset Flare.' },
  ];

  const RELICS = [
    { id: 'locket',   name: "Miner's Locket",      desc: '+15% gold per level',              per: 0.15 },
    { id: 'crown',    name: 'Ashen Circlet',       desc: '+10% party damage per level',      per: 0.10 },
    { id: 'whet',     name: 'Grim Whetstone',      desc: '+25% strike damage per level',     per: 0.25 },
    { id: 'hourglass',name: 'Cracked Hourglass',   desc: '+10% skill duration per level',    per: 0.10 },
    { id: 'lamp',     name: 'Lamp of the First Delve', desc: '+3s lantern time per level',   per: 3 },
    { id: 'moth',     name: 'Moth-wing Charm',     desc: '+1% treasure chest chance per level', per: 0.01 },
    { id: 'ledger',   name: 'Ledger of Old Debts', desc: '-2% hero costs per level (max 50%)', per: 0.02 },
    { id: 'dice',     name: 'Bone Dice',           desc: '+2% critical strike chance per level', per: 0.02 },
    { id: 'lens',     name: 'Deepglass Lens',      desc: '+15% damage to guardians per level', per: 0.15 },
    { id: 'heart',    name: 'Ember Heart',         desc: '+5% Embers on rekindle per level', per: 0.05 },
    { id: 'bell',     name: "Sleepwalker's Bell",  desc: '+20% gold while away per level',   per: 0.20 },
    { id: 'tooth',    name: 'Gilded Rat Tooth',    desc: '+30% gold from chests per level',  per: 0.30 },
  ];

  const FEATS = [
    { id: 'f5',    name: 'First Steps',       desc: 'Reach floor 5',           test: s => s.maxFloorEver >= 5 },
    { id: 'f10',   name: 'Below the Cellars', desc: 'Reach floor 10',          test: s => s.maxFloorEver >= 10 },
    { id: 'f25',   name: 'Spore Season',      desc: 'Reach floor 25',          test: s => s.maxFloorEver >= 25 },
    { id: 'f50',   name: 'Through the Fire',  desc: 'Reach floor 50',          test: s => s.maxFloorEver >= 50 },
    { id: 'f80',   name: 'Starless',          desc: 'Reach floor 80',          test: s => s.maxFloorEver >= 80 },
    { id: 'f120',  name: 'Deeper Than Maps',  desc: 'Reach floor 120',         test: s => s.maxFloorEver >= 120 },
    { id: 'k100',  name: 'Pest Control',      desc: 'Defeat 100 foes',         test: s => s.stats.kills >= 100 },
    { id: 'k5k',   name: 'Monster Ledger',    desc: 'Defeat 5,000 foes',       test: s => s.stats.kills >= 5000 },
    { id: 'b10',   name: 'Giant Slayer',      desc: 'Defeat 10 guardians',     test: s => s.stats.bossKills >= 10 },
    { id: 'c500',  name: 'Busy Hands',        desc: 'Strike 500 times',        test: s => s.stats.clicks >= 500 },
    { id: 'h100',  name: 'Veteran',           desc: 'Raise a hero to level 100', test: s => s.heroes.some(l => l >= 100) },
    { id: 'hall',  name: 'Full Roster',       desc: 'Hire every hero',         test: s => s.heroes.every(l => l > 0) },
    { id: 'r1',    name: 'Relighting',        desc: 'Rekindle the lantern once', test: s => s.stats.rekindles >= 1 },
    { id: 'r5',    name: 'Eternal Flame',     desc: 'Rekindle 5 times',        test: s => s.stats.rekindles >= 5 },
    { id: 'rel5',  name: 'Curio Cabinet',     desc: 'Find 5 different relics', test: s => Object.keys(s.relics).length >= 5 },
    { id: 'chest', name: 'Lucky Find',        desc: 'Open 25 treasure chests', test: s => s.stats.chests >= 25 },
    { id: 'gold',  name: 'Hoarder',           desc: 'Earn 1 million gold in total', test: s => s.stats.goldEarned >= 1e6 },
    { id: 'goldb', name: 'Dragon’s Share', desc: 'Earn 1 trillion gold in total', test: s => s.stats.goldEarned >= 1e12 },
  ];

  function newState() {
    return {
      v: VERSION,
      gold: 0,
      floor: 1,
      foeIdx: 0,
      maxFloor: 1,       // this run
      maxFloorEver: 1,
      heroes: HEROES.map(() => 0),
      relics: {},
      embers: 0,
      feats: {},
      autoAdvance: true,
      skills: {},        // id -> {readyAt, until}
      foe: null,
      lantern: 0,
      stats: { kills: 0, bossKills: 0, clicks: 0, chests: 0, goldEarned: 0, rekindles: 0, playTime: 0, crits: 0 },
      settings: { sound: true, buy: 1, notation: 'short' },
      lastSeen: Date.now(),
      created: Date.now(),
      seenHeroes: 1,
    };
  }

  // ---------- formulas ----------
  const isBossFloor = f => f % BOSS_EVERY === 0;
  const biomeOf = f => BIOMES[Math.floor((f - 1) / 10) % BIOMES.length];
  const depthCycle = f => Math.floor((f - 1) / (10 * BIOMES.length));

  function baseHp(f) {
    let hp = 10 * Math.pow(1.19, f - 1);
    if (f > 60) hp *= Math.pow(1.03, f - 60);
    if (f > 140) hp *= Math.pow(1.04, f - 140);
    return hp;
  }
  const foeHp = (f, boss) => baseHp(f) * (boss ? 9 : 1);
  const foeGold = (f, boss) => (1 + baseHp(f) / 14) * (boss ? 5 : 1);

  function relicLvl(s, id) { return s.relics[id] || 0; }
  function relicVal(s, id) { const r = RELICS.find(x => x.id === id); return relicLvl(s, id) * r.per; }

  function milestoneMult(lvl) {
    let m = 1;
    for (const t of MILESTONES) if (lvl >= t) m *= (t >= 200 ? 3 : 2);
    return m;
  }
  function nextMilestone(lvl) { return MILESTONES.find(t => t > lvl) || null; }

  function costDiscount(s) { return Math.min(0.5, relicVal(s, 'ledger')); }
  function heroCost(s, i, n) {
    const h = HEROES[i], L = s.heroes[i], r = COST_GROWTH;
    return h.cost * Math.pow(r, L) * (Math.pow(r, n) - 1) / (r - 1) * (1 - costDiscount(s));
  }
  function maxAffordable(s, i) {
    const h = HEROES[i], L = s.heroes[i], r = COST_GROWTH;
    const unit = h.cost * Math.pow(r, L) * (1 - costDiscount(s));
    if (s.gold < unit) return 0;
    return Math.max(0, Math.floor(Math.log(s.gold * (r - 1) / unit + 1) / Math.log(r)));
  }

  function featCount(s) { return Object.keys(s.feats).length; }
  function emberMult(s) { return 1 + 0.1 * s.embers; }
  function skillActive(s, id, now) { const k = s.skills[id]; return !!(k && k.until > now); }

  function heroDps(s, i) { const L = s.heroes[i]; return L ? HEROES[i].dps * L * milestoneMult(L) : 0; }
  function globalMult(s, now) {
    return emberMult(s) * (1 + 0.02 * featCount(s)) * (1 + relicVal(s, 'crown')) * (skillActive(s, 'flare', now) ? 2 : 1);
  }
  function totalDps(s, now) {
    let d = 0; for (let i = 0; i < HEROES.length; i++) d += heroDps(s, i);
    return d * globalMult(s, now);
  }
  function clickDamage(s, now) {
    const base = 1 + s.heroes[0] * 1.5;
    return (base + totalDps(s, now) * 0.04) * (1 + relicVal(s, 'whet'));
  }
  function goldMult(s, now) {
    return emberMult(s) * (1 + relicVal(s, 'locket')) * (skillActive(s, 'plunder', now) ? 2 : 1);
  }
  function critChance(s) { return 0.04 + relicVal(s, 'dice'); }
  function lanternTime(s) { return BASE_LANTERN + relicVal(s, 'lamp'); }
  function chestChance(s) { return 0.03 + relicVal(s, 'moth'); }
  function skillDuration(s, sk) { return sk.dur * (1 + relicVal(s, 'hourglass')); }

  function embersFor(s) {
    const f = s.maxFloor;
    if (f < REKINDLE_FLOOR) return 0;
    return Math.floor(Math.pow(f - 20, 1.3) / 8 * (1 + relicVal(s, 'heart')));
  }

  function makeFoe(s, rng) {
    const f = s.floor, boss = isBossFloor(f);
    const r = rng || Math.random;
    const chest = !boss && r() < chestChance(s);
    const b = biomeOf(f);
    let sprite, name;
    if (boss) {
      sprite = BOSS_SPRITES[Math.floor((f / BOSS_EVERY)) % BOSS_SPRITES.length];
      name = (f % 10 === 0) ? b.boss : ['Stone Sentinel', 'Tunnel Wyrm', 'Bone Hierarch'][BOSS_SPRITES.indexOf(sprite)];
    } else if (chest) {
      sprite = 'chest'; name = 'Treasure Chest';
    } else {
      const fo = FOES[Math.floor(r() * FOES.length)];
      sprite = fo.id; name = b.adj[Math.floor(r() * b.adj.length)] + ' ' + fo.name;
    }
    const hp = foeHp(f, boss) * (chest ? 0.5 : 1);
    return { name, sprite, boss, chest, hp, max: hp, hue: b.hue };
  }

  // Returns list of events for UI (kills, relic drops, boss fail)
  function damageFoe(s, amount, now, rng, events) {
    let guard = 0;
    while (amount > 0 && guard++ < 60) {
      if (!s.foe) s.foe = makeFoe(s, rng);
      const foe = s.foe;
      let dmg = amount;
      if (foe.boss) dmg *= 1 + relicVal(s, 'lens');
      if (dmg < foe.hp) { foe.hp -= dmg; return; }
      // kill
      const used = foe.boss ? foe.hp / (1 + relicVal(s, 'lens')) : foe.hp;
      amount -= used;
      killFoe(s, now, rng, events);
      if (s.foe && s.foe.boss) return; // overflow doesn't carry into guardians
    }
  }

  function killFoe(s, now, rng, events) {
    const foe = s.foe, f = s.floor;
    let g = foeGold(f, foe.boss) * goldMult(s, now);
    if (foe.chest) { g *= 10 * (1 + relicVal(s, 'tooth')); s.stats.chests++; }
    s.gold += g; s.stats.goldEarned += g; s.stats.kills++;
    events && events.push({ type: 'kill', gold: g, foe });
    s.foe = null;
    if (foe.boss) {
      s.stats.bossKills++;
      const firstClear = f >= s.maxFloorEver - 1;
      const chance = f < 10 ? 0 : (firstClear ? 0.35 : 0.03);
      if ((rng || Math.random)() < chance) {
        const r = RELICS[Math.floor((rng || Math.random)() * RELICS.length)];
        s.relics[r.id] = (s.relics[r.id] || 0) + 1;
        events && events.push({ type: 'relic', relic: r, level: s.relics[r.id] });
      }
      clearFloor(s, events, true);
    } else {
      s.foeIdx++;
      if (s.foeIdx >= FOES_PER_FLOOR) clearFloor(s, events, false);
    }
  }

  function clearFloor(s, events, boss) {
    if (s.floor >= s.maxFloor) {
      s.maxFloor = s.floor + 1;
      if (s.maxFloor > s.maxFloorEver) { s.maxFloorEver = s.maxFloor; events && events.push({ type: 'newfloor', floor: s.maxFloor }); }
    }
    s.lantern = 0; s.foeIdx = 0;
    if (s.autoAdvance || boss) s.floor++;
  }

  function gotoFloor(s, f) {
    f = Math.max(1, Math.min(s.maxFloor, f));
    s.floor = f; s.foeIdx = 0; s.foe = null; s.lantern = 0;
  }

  function tick(s, dt, now, rng, events) {
    s.stats.playTime += dt;
    if (!s.foe) s.foe = makeFoe(s, rng);
    if (s.foe.boss) {
      s.lantern += dt;
      if (s.lantern >= lanternTime(s)) {
        events && events.push({ type: 'bossfail', name: s.foe.name });
        s.autoAdvance = false;
        s.retryBoss = s.floor;
        gotoFloor(s, s.floor - 1);
        return;
      }
    }
    if (skillActive(s, 'frenzy', now)) {
      s._frenzyAcc = (s._frenzyAcc || 0) + dt * 12;
      while (s._frenzyAcc >= 1) { s._frenzyAcc -= 1; strike(s, now, rng, events, true); }
    }
    const dps = totalDps(s, now);
    // Idle-friendly: once the party could beat the guardian that stopped them, try again on its own.
    if (s.retryBoss && !s.autoAdvance && dps * lanternTime(s) * 0.9 * (1 + relicVal(s, 'lens')) >= foeHp(s.retryBoss, true)) {
      s.autoAdvance = true; s.retryBoss = 0;
      events && events.push({ type: 'retry' });
    }
    damageFoe(s, dps * dt, now, rng, events);
  }

  function strike(s, now, rng, events, auto) {
    let dmg = clickDamage(s, now);
    const crit = (rng || Math.random)() < critChance(s);
    if (crit) { dmg *= 5; s.stats.crits++; }
    if (!auto) s.stats.clicks++;
    events && events.push({ type: 'hit', dmg, crit, auto });
    damageFoe(s, dmg, now, rng, events);
    return { dmg, crit };
  }

  function buyHero(s, i, n) {
    if (n === 'max') n = maxAffordable(s, i);
    if (n <= 0) return false;
    const c = heroCost(s, i, n);
    if (c > s.gold) return false;
    s.gold -= c; s.heroes[i] += n;
    if (i + 2 > s.seenHeroes) s.seenHeroes = Math.min(HEROES.length, i + 2);
    return true;
  }

  function useSkill(s, id, now) {
    const sk = SKILLS.find(k => k.id === id);
    if (!sk || s.maxFloorEver < sk.unlock) return false;
    const st = s.skills[id] || { readyAt: 0, until: 0 };
    if (st.readyAt > now) return false;
    st.until = now + skillDuration(s, sk) * 1000;
    st.readyAt = now + sk.cd * 1000;
    s.skills[id] = st;
    if (id === 'reserve') {
      s.lantern = 0;
      if (s.skills.flare) s.skills.flare.readyAt = 0;
    }
    return true;
  }

  function rekindle(s) {
    const e = embersFor(s);
    if (e <= 0) return 0;
    s.embers += e;
    s.stats.rekindles++;
    s.gold = 0; s.floor = 1; s.foeIdx = 0; s.maxFloor = 1; s.foe = null; s.lantern = 0;
    s.heroes = HEROES.map(() => 0); s.seenHeroes = 1; s.autoAdvance = true; s.skills = {};
    return e;
  }

  function checkFeats(s) {
    const got = [];
    for (const f of FEATS) if (!s.feats[f.id] && f.test(s)) { s.feats[f.id] = Date.now(); got.push(f); }
    return got;
  }

  // Estimated gold per second while away, at the deepest floor the party farms comfortably.
  function offlineGoldPerSec(s) {
    const d = totalDps(s, 0);
    if (d <= 0) return 0;
    let f = Math.max(1, s.maxFloor - 1);
    if (isBossFloor(f)) f = Math.max(1, f - 1);
    const killsPerSec = Math.min(4, d / foeHp(f, false));
    return killsPerSec * foeGold(f, false) * emberMult(s) * (1 + relicVal(s, 'locket')) * 0.5 * (1 + relicVal(s, 'bell'));
  }

  function migrate(o) {
    const s = newState();
    if (!o || typeof o !== 'object') return s;
    Object.assign(s, o);
    s.stats = Object.assign(newState().stats, o.stats || {});
    s.settings = Object.assign(newState().settings, o.settings || {});
    s.heroes = HEROES.map((_, i) => (o.heroes && o.heroes[i]) || 0);
    s.foe = null; s.lantern = 0;
    return s;
  }

  const api = {
    VERSION, HEROES, BIOMES, FOES, SKILLS, RELICS, FEATS, FOES_PER_FLOOR, BOSS_EVERY, REKINDLE_FLOOR, MILESTONES,
    newState, migrate, isBossFloor, biomeOf, depthCycle, foeHp, foeGold, heroCost, maxAffordable, heroDps, totalDps,
    clickDamage, goldMult, lanternTime, embersFor, tick, strike, buyHero, useSkill, rekindle, checkFeats, gotoFloor,
    offlineGoldPerSec, milestoneMult, nextMilestone, skillActive, skillDuration, relicLvl, featCount, critChance, globalMult,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LH = api;
})(this);
