/* Lanternhold: An Idle Descent — game rules and state (no DOM). v2: party of five, foes strike back, story. */
(function (root) {
  'use strict';

  const VERSION = 2;
  const FOES_PER_FLOOR = 8;
  const BOSS_EVERY = 5;
  const BASE_LANTERN = 30;
  const COST_GROWTH = Math.pow(1.07, 0.4);
  const REKINDLE_FLOOR = 50;
  const PARTY_SIZE = 5;
  const REVIVE_TIME = 15;
  const RETRY_AFTER = 75;

  // ---------- classes ----------
  const CLASSES = {
    tank:   { name: 'Tank',        hp: 40, dps: 0.6, armor: 0.35, color: '#9fb6c8',
              ability: { id: 'wall',  name: 'Shield Wall',  cd: 30, dur: 8,  desc: 'Takes 70% less damage for 8s and holds the foe’s attention.' } },
    healer: { name: 'Healer',      hp: 24, dps: 0.3, heal: 1.1, color: '#8fcf6a',
              ability: { id: 'hymn',  name: 'Lantern Hymn', cd: 28, dur: 0,  desc: 'Heals the whole party for 45% and lifts one fallen ally back up.' } },
    rogue:  { name: 'Rogue',       hp: 20, dps: 2.2, dodge: 0.25, color: '#e2c36a',
              ability: { id: 'stab',  name: 'Backstab',     cd: 12, dur: 0,  desc: 'Strikes for 12 seconds’ worth of damage at once.' } },
    mage:   { name: 'Mage',        hp: 16, dps: 1.7, color: '#ff8a5a',
              ability: { id: 'storm', name: 'Ember Storm',  cd: 22, dur: 6,  desc: 'Calls down fire: the Mage deals 4x damage for 6s.' } },
    necro:  { name: 'Necromancer', hp: 20, dps: 1.0, drain: 0.12, color: '#b58cff',
              ability: { id: 'raise', name: 'Raise Dead',   cd: 30, dur: 20, desc: 'Raises 3 skeletons for 20s. They fight and soak up blows.' } },
  };
  const CLASS_ORDER = ['tank', 'healer', 'rogue', 'mage', 'necro'];

  // ---------- recruits ----------
  // tier scales stats and cost; later recruits are stronger alternatives.
  const MEMBERS = [
    { id: 'oduya',   name: 'Oduya',     title: 'Covenant Gravewarden', side: 'covenant', cls: 'tank',   tier: 0, hue: 0,    bio: 'Oduya was posted to the Hold by the Iron Covenant twenty years ago and told to hold the stair. Nobody ever came to relieve her, so she never left. She speaks rarely, and only in short orders.', line: 'Iron Covenant to the bone. Has held worse lines than this. Twice.' },
    { id: 'moss',    name: 'Moss',      title: 'Mercy Corps Medic',    side: 'mercy',    cls: 'healer', tier: 0, hue: 0,    bio: 'A Mercy Corps field medic who followed the war underground because that was where people were bleeding. She is kind, stubborn and a little bit frightening with a needle.', line: 'Mercy Corps patches up anyone who bleeds. Even you.' },
    { id: 'kestrel', name: 'Kestrel',   title: 'Unsworn Cutpurse',     side: 'unsworn',  cls: 'rogue',  tier: 0, hue: 0,    bio: "An Unsworn thief from the Hold's lower streets. She came down for the lantern's price and stayed because, for once, nobody was paying her to leave.", line: 'Sworn to no alliance. Loyal to whoever is paying today.' },
    { id: 'wren',    name: 'Wren',      title: 'Ascendancy Apprentice', side: 'radiant', cls: 'mage',   tier: 0, hue: 0,    bio: 'A third-circle scholar of the Radiant Ascendancy, chasing a master who went down a year ago. She is brilliant, impatient, and sets things on fire when she is nervous.', line: 'Radiant Ascendancy scholar. Looking for her master. Burning things meanwhile.' },
    { id: 'vael',    name: 'Vael',      title: 'Tide Deserter',        side: 'tide',     cls: 'necro',  tier: 0, hue: 0,    bio: "Once Wren's master and an Ascendancy researcher. The Rift changed him, the Devouring Tide recruited him, and he walked away from both. The dead listen to him now.", line: 'Walked out of the Devouring Tide. Nobody walks out of the Tide.' },
    { id: 'ashe',    name: 'Sir Ashe',  title: 'Covenant Cinder Knight', side: 'covenant', cls: 'tank', tier: 1, hue: -30,  bio: 'A Covenant knight of the Forge Garrison who held the Cinder Forges alone for forty years. His armour never cooled. Neither did his temper.', line: 'Held the Forges for the Covenant for forty years. Still burning.' },
    { id: 'oracle',  name: 'The Pale Oracle', title: 'Ascendancy Seer', side: 'radiant', cls: 'healer', tier: 1, hue: 160, bio: 'An Ascendancy seer who stayed in the drowned chapel to watch the Rift. She has seen most of the ways this ends and chooses to help anyway.', line: 'Has watched the Rift for the Ascendancy since before the war. Knows how this ends.' },
    { id: 'varga',   name: 'Varga',     title: 'Tide Knife for Hire',  side: 'tide',     cls: 'rogue',  tier: 1, hue: 150,  bio: "Kestrel's older sister and a knife for hire who took Tide coin and Thessaly's coin at the same time. Family won in the end, narrowly.", line: 'Kestrel’s sister. Took Tide coin. Charges double for family.' },
    { id: 'brann',   name: 'Brann',     title: 'Covenant Runesmith',   side: 'covenant', cls: 'mage',   tier: 1, hue: 180,  bio: 'The Covenant runesmith who carved the seal-wards around the lantern. He knows exactly what they hold in and is trying to make up for it.', line: 'Carved the seal-wards that keep the Rift shut. Regrets some of them.' },
    { id: 'hollow',  name: 'The Hollow King', title: 'The First Bearer', side: 'unsworn', cls: 'necro', tier: 1, hue: 60, bio: 'The very first lantern-bearer, fed to the seal before the Grand War had a name. He came back hollow and crowned. He wants his name back.', line: 'The first lantern-bearer. Fed to the seal. Came back anyway.' },
  ];
  // The Grand War alliances, as they appear on the Lantern Deep front.
  const SIDES = {
    covenant: { name: 'Iron Covenant',       motto: 'Hold the line.',            color: '#9fb4c8', perk: '+15% party health',  desc: 'Seal the Rift at any cost. The Hold was a Covenant fortress once.' },
    radiant:  { name: 'Radiant Ascendancy',  motto: 'Rise beyond.',              color: '#ffd36b', perk: '+12% party damage',  desc: 'Harness the Rift’s light and climb past what mortals were meant to be.' },
    tide:     { name: 'Devouring Tide',      motto: 'Everything feeds the Tide.', color: '#d06bff', perk: '+15% gold',          desc: 'Open the Rift and let it swallow the Reach. Their warbands own the deep.' },
    mercy:    { name: 'Mercy Corps',         motto: 'No one left in the dark.',  color: '#8fcf6a', perk: '+15% healing',       desc: 'Medics who cross every line of the war. Nobody shoots at the Corps. Mostly.' },
    unsworn:  { name: 'Unsworn',             motto: 'My own banner.',            color: '#c9b38a', perk: '+5% health, damage and gold', desc: 'No alliance, no orders. The Rift does not care whose side you are on.' },
  };
  const SIDE_ORDER = ['covenant', 'radiant', 'tide', 'mercy', 'unsworn'];
  const sideOf = s => (s.hero && s.hero.side) || null;
  // Mercy's Blessing: real-world donations to the Grand War's Mercy Corps light it for every player (the server keeps the clock).
  const MERCY_FX = { gold: 0.10, hp: 0.10, heal: 0.20 };
  const mercyOn = s => !!(s && s.mercy && s.mercy > Date.now());
  const sidePerk = (s, k) => sidePerk0(s, k) * (mercyOn(s) ? 1 + (MERCY_FX[k] || 0) : 1);
  // Banner kin: every other party member who marches under your banner amplifies your banner perk by 40%.
  const KIN_AMP = 0.4;
  const bannerKin = s => { const d = sideOf(s); if (!d || !s.party) return 0; let n = 0; for (const id of s.party) { if (!id || id === 'you') continue; const m = memberById(id); if (m && m.side === d) n++; } return n; };
  const sidePerk0 = (s, k) => { const d = sideOf(s); if (!d) return 1;
    const v = d === 'unsworn' ? (k === 'heal' ? 1 : 1.05) : (({ covenant: { hp: 1.15 }, radiant: { dps: 1.12 }, tide: { gold: 1.15 }, mercy: { heal: 1.15 } }[d][k]) || 1);
    return 1 + (v - 1) * (1 + KIN_AMP * bannerKin(s)); };
  const TIER = [{ cost: 10, stat: 1 }, { cost: 1320, stat: 2.6e4 }];
  const NPC_POWER = 0.7;   // story companions are always weaker than real players' heroes
  const GUEST_SLOTS_SOLO = 0;
  // Dynamic members: your own hero ('you') and other players' heroes recruited from the board.
  const dyn = {};
  function registerHero(s) {
    if (s.hero) dyn.you = { id: 'you', name: s.hero.name, title: (SIDES[s.hero.side] ? SIDES[s.hero.side].name + ' ' : '') + 'Lantern-bearer', cls: s.hero.cls, tier: 0, hue: 0, player: true, line: 'That\u2019s you.' };
    for (const g of s.guests || []) dyn[g.id] = { id: g.id, name: g.name, title: 'Recruited player', cls: g.cls, side: g.side || null, tier: 0, hue: 0, player: true, guest: true, line: 'Another delver, lending you their strength.' };
  }
  const memberById = id => dyn[id] || MEMBERS.find(m => m.id === id);
  const isGuest = (s, id) => !!(dyn[id] && dyn[id].guest);
  const MILESTONES = [10, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000];

  const BIOMES = [
    { name: 'The Lamplit Cellars',     adj: ['Cellar', 'Dusty', 'Damp'],             hue: 0,   bg: ['#2a1d14', '#120c08'], accent: '#e9a447', boss: 'The Cellar Glutton',
      war: { side: 'tide', units: ['Tide Scavenger', 'Tide Looter'] } },
    { name: 'Mosswater Crypts',        adj: ['Mossy', 'Sodden', 'Rotting'],          hue: 70,  bg: ['#16261b', '#080f0a'], accent: '#8fcf6a', boss: 'Grandmother Rot',
      war: { side: 'tide', units: ['Tide Gravehound', 'Rot Acolyte'] } },
    { name: 'The Glimmer Fungus Deep', adj: ['Glowcap', 'Sporeling', 'Lurid'],       hue: 220, bg: ['#1f1530', '#0b0714'], accent: '#c78bff', boss: 'The Mycelial Choir',
      war: { side: 'radiant', units: ['Ascendant Sporecaller', 'Radiant Prospector'] } },
    { name: 'Saltbone Galleries',      adj: ['Salt-crusted', 'Bleached', 'Brittle'], hue: 170, bg: ['#20272b', '#0b0f12'], accent: '#b9d6de', boss: 'Ossuary Prime',
      war: { side: 'covenant', units: ['Lost Covenant Sentry', 'Hollow Warden'] } },
    { name: 'The Cinder Forges',       adj: ['Smouldering', 'Ashen', 'Slag'],        hue: -25, bg: ['#33140c', '#140604'], accent: '#ff7a3d', boss: 'Furnace-Heart',
      war: { side: 'radiant', units: ['Ascendant Forgeborn', 'Radiant War-Engine'] } },
    { name: 'The Drowned Chapel',      adj: ['Drowned', 'Brine', 'Pallid'],          hue: 160, bg: ['#0f2130', '#050c14'], accent: '#6cc4e8', boss: 'The Sunken Bishop',
      war: { side: 'radiant', units: ['Drowned Zealot', 'Ascendant Chorister'] } },
    { name: 'Hollow Roots',            adj: ['Rootbound', 'Barkskin', 'Gnarled'],    hue: 40,  bg: ['#22200f', '#0d0c05'], accent: '#d8c26a', boss: 'The Root Mother',
      war: { side: 'tide', units: ['Tide Rootfiend', 'Devourer Brood'] } },
    { name: 'The Starless Vault',      adj: ['Void-touched', 'Starless', 'Umbral'],  hue: 250, bg: ['#141022', '#05040b'], accent: '#9aa6ff', boss: 'The Unlit',
      war: { side: 'tide', units: ['Riftspawn', 'Nyxborn Herald'] } },
    // Below the Vault: the second half of Act One. Each region has its own monster and a signature trick.
    { name: 'The Glass Wastes',       adj: ['Glassy', 'Prismatic', 'Shard-backed'], hue: 190, bg: ['#1a2830', '#070d12'], accent: '#7fd6e8', boss: 'The Glass Regent',
      war: { side: 'radiant', units: ['Radiant Glass-Reaper', 'Ascendant Lens-Mage'] }, foe: { id: 'shard', name: 'Glass Crawler' }, mod: 'ward' },
    { name: 'The Ironbound Bastion',  adj: ['Rusted', 'Iron-sworn', 'Riveted'],     hue: 0,   bg: ['#26241f', '#0c0b09'], accent: '#c9b38a', boss: 'Marshal Ironvow',
      war: { side: 'covenant', units: ['Covenant Holdout', 'Bastion Gunner'] }, foe: { id: 'sentinel', name: 'Iron Husk' }, mod: 'cleave' },
    { name: 'The Weeping Aqueduct',   adj: ['Weeping', 'Silted', 'Brackish'],       hue: 150, bg: ['#10242a', '#050d10'], accent: '#5fd0c0', boss: 'The Brine Matriarch',
      war: { side: 'tide', units: ['Tide Drinker', 'Devourer Leech'] }, foe: { id: 'eel', name: 'Sluice Eel' }, mod: 'regen' },
    { name: 'The Bone Orchard',       adj: ['Pale', 'Root-white', 'Marrow'],        hue: 30,  bg: ['#2a2620', '#0f0d0a'], accent: '#e8dcc0', boss: 'The Orchard Keeper',
      war: { side: 'tide', units: ['Tide Gravepicker', 'Marrow Brood'] }, foe: { id: 'thorn', name: 'Thornling' }, mod: 'venom' },
    { name: 'Stormglass Spire',       adj: ['Charged', 'Stormlit', 'Humming'],      hue: 210, bg: ['#151a33', '#060813'], accent: '#9ab8ff', boss: 'The Ascendant Prism',
      war: { side: 'radiant', units: ['Ascendant Stormcaller', 'Radiant Spire-Guard'] }, foe: { id: 'prism', name: 'Storm Lens' }, mod: 'swift' },
    { name: 'The Nexus Scar',         adj: ['Scarred', 'Warborn', 'Tri-banner'],    hue: -40, bg: ['#2b1420', '#10060b'], accent: '#ff6a8a', boss: 'The Threefold Warhost',
      war: { side: 'covenant', units: ['Covenant Breacher', 'Bastion Deserter'] }, foe: { id: 'hound', name: 'Rift Hound' }, mod: 'enrage' },
    { name: 'The Rift Threshold',     adj: ['Unmade', 'Starborn', 'Hollow-lit'],    hue: 260, bg: ['#0e0a1f', '#030208'], accent: '#c9a6ff', boss: 'The Lampmother',
      war: { side: 'tide', units: ['Nyxborn Reaver', 'Rift Herald'] }, foe: { id: 'riftling', name: 'Riftling' }, mod: 'ward' },
  ];
  // Act One ends with the guardian on this floor. Act Two opens with Season 2 of the Grand War.
  const ACT_ONE_END = 150, ACT_TWO_AT = Date.UTC(2027, 0, 25, 5);
  const actTwoOpen = now => (now || Date.now()) >= ACT_TWO_AT;
  // Monster tricks. Deeper foes carry more of them, and guardians always do past floor 20.
  const MODS = {
    enrage: { name: 'Enrages', desc: 'Hits much harder below 30% health' },
    ward:   { name: 'Warded', desc: 'Raises a magic ward every 12 seconds that soaks up damage' },
    regen:  { name: 'Regenerates', desc: 'Heals itself over time' },
    venom:  { name: 'Venomous', desc: 'Its hits poison, dealing damage over time' },
    cleave: { name: 'Cleaves', desc: 'Its hits also strike the next hero in line' },
    swift:  { name: 'Swift', desc: 'Attacks harder and faster' },
  };
  const MOD_KEYS = Object.keys(MODS);
  const ELITE_CHANCE = 0.12;
  const FOES = [
    { id: 'slime', name: 'Gloop' }, { id: 'rat', name: 'Gnawer' }, { id: 'bat', name: 'Flitterwing' },
    { id: 'skeleton', name: 'Rattlebones' }, { id: 'eye', name: 'Watcher' }, { id: 'shroom', name: 'Capling' }, { id: 'ghost', name: 'Wisp' },
  ];
  const BOSS_SPRITES = ['golem', 'wyrm', 'lich'];

  const RELICS = [
    { id: 'locket',   name: "Miner's Locket",          desc: '+6% gold per level',                    per: 0.06 },
    { id: 'crown',    name: 'Ashen Circlet',           desc: '+4% party damage per level',            per: 0.04 },
    { id: 'whet',     name: 'Grim Whetstone',          desc: '+25% strike damage per level',           per: 0.25 },
    { id: 'hourglass',name: 'Cracked Hourglass',       desc: '+10% ability duration per level',        per: 0.10 },
    { id: 'lamp',     name: 'Lamp of the First Delve', desc: '+3s lantern time per level',             per: 3 },
    { id: 'moth',     name: 'Moth-wing Charm',         desc: '+1% treasure chest chance per level',    per: 0.01 },
    { id: 'ledger',   name: 'Ledger of Old Debts',     desc: '-1% training costs per level (max 25%)', per: 0.01 },
    { id: 'dice',     name: 'Bone Dice',               desc: '+2% critical strike chance per level',   per: 0.02 },
    { id: 'lens',     name: 'Deepglass Lens',          desc: '+6% damage to guardians per level',     per: 0.06 },
    { id: 'heart',    name: 'Ember Heart',             desc: '+5% Embers on rekindle per level',       per: 0.05 },
    { id: 'bell',     name: "Sleepwalker's Bell",      desc: '+8% gold while away per level',         per: 0.08 },
    { id: 'tooth',    name: 'Gilded Rat Tooth',        desc: '+12% gold from chests per level',        per: 0.12 },
    { id: 'ward',     name: 'Wardstone Shard',         desc: '+4% party health per level',            per: 0.04 },
    { id: 'censer',   name: 'Chapel Censer',           desc: '+5% healing per level',                 per: 0.05 },
  ];

  const FEATS = [
    { id: 'f5',    name: 'First Steps',       desc: 'Reach floor 5',              test: s => s.maxFloorEver >= 5 },
    { id: 'f10',   name: 'Below the Cellars', desc: 'Reach floor 10',             test: s => s.maxFloorEver >= 10 },
    { id: 'f25',   name: 'Spore Season',      desc: 'Reach floor 25',             test: s => s.maxFloorEver >= 25 },
    { id: 'f50',   name: 'Through the Fire',  desc: 'Reach floor 50',             test: s => s.maxFloorEver >= 50 },
    { id: 'f81',   name: 'The Lantern’s Secret', desc: 'Reach the Unlit below the Vault', test: s => !!s.story.seen.end },
    { id: 'act1',  name: 'Lampbreaker', desc: 'Finish Act One', test: s => !!s.story.seen.act1 },
    { id: 'f100',  name: 'Iron and Oath', desc: 'Reach floor 100', test: s => s.maxFloorEver >= 100 },
    { id: 'f120',  name: 'Deeper Than Maps',  desc: 'Reach floor 120',            test: s => s.maxFloorEver >= 120 },
    { id: 'k100',  name: 'Pest Control',      desc: 'Defeat 100 foes',            test: s => s.stats.kills >= 100 },
    { id: 'k5k',   name: 'Monster Ledger',    desc: 'Defeat 5,000 foes',          test: s => s.stats.kills >= 5000 },
    { id: 'b10',   name: 'Giant Slayer',      desc: 'Defeat 10 guardians',        test: s => s.stats.bossKills >= 10 },
    { id: 'c500',  name: 'Busy Hands',        desc: 'Strike 500 times',           test: s => s.stats.clicks >= 500 },
    { id: 'full',  name: 'A Full Table',      desc: 'Fill all five party seats',  test: s => s.party.filter(Boolean).length >= 5 },
    { id: 'h100',  name: 'Veteran',           desc: 'Train a companion to level 100', test: s => Object.values(s.levels).some(l => l >= 100) },
    { id: 'hall',  name: 'Full Roster',       desc: 'Meet all ten companions',    test: s => s.unlocked.length >= MEMBERS.length },
    { id: 'guest', name: 'Strength in Numbers', desc: 'Recruit another player\u2019s hero', test: s => (s.guests || []).length >= 1 },
    { id: 'heal',  name: 'Not Today',         desc: 'Lift 25 fallen allies with the Lantern Hymn', test: s => s.stats.revives >= 25 },
    { id: 'r1',    name: 'Relighting',        desc: 'Rekindle the lantern once',  test: s => s.stats.rekindles >= 1 },
    { id: 'rel5',  name: 'Curio Cabinet',     desc: 'Find 5 different relics',    test: s => Object.keys(s.relics).length >= 5 },
    { id: 'chest', name: 'Lucky Find',        desc: 'Open 25 treasure chests',    test: s => s.stats.chests >= 25 },
    { id: 'gold',  name: 'Hoarder',           desc: 'Earn 100,000 gold in total', test: s => s.stats.goldEarned >= 1e5 },
  ];

  // ---------- story ----------
  // Each beat fires once when its condition holds. `join` adds a recruit (and seats them if there is room).
  const STORY = [
    { id: 'intro', ch: 1, when: s => true, title: 'The Last Lantern',
      lines: [
        ['Narrator', 'lamp', 'The Grand War rages across the Shattered Reach. Thirteen sectors burn while the alliances fight over the Nexus. Nobody remembers the Hold.'],
        ['Narrator', 'lamp', 'But under the Hold, the Nyx Rift bled through the stone long ago. A single lantern has kept that wound shut ever since.'],
        ['Old Thessaly', 'lamp', 'The lantern is guttering, child. When it goes out, the Rift opens, and every warband in the Reach will come down my stair to claim it.'],
        ['Old Thessaly', 'lamp', 'Carry this light down. Find what feeds the flame. And take Oduya. The Iron Covenant left her here to hold the line, and she has never once stepped back.'],
        ['Oduya', 'tank', 'Stay behind my shield. Strike when they look at me. Hold the line.'],
      ], join: 'oduya', goal: 'Descend into the Lamplit Cellars' },
    { id: 'moss', ch: 1, when: s => s.maxFloorEver >= 3, title: 'A Voice in the Barrels',
      lines: [
        ['Moss', 'healer', 'Oh, thank the roots. A Tide scavenger chased me into this barrel two days ago. The rats have opinions about me.'],
        ['Moss', 'healer', 'Mercy Corps, field medic. We go wherever the war bleeds, and it is bleeding down here. So are you, by the way. Hold still.'],
      ], join: 'moss', goal: 'Reach floor 5 and face what guards the stair' },
    { id: 'kestrel', ch: 1, when: s => s.maxFloorEver >= 6, title: 'Light Fingers',
      lines: [
        ['Kestrel', 'rogue', 'Lovely lantern. A Tide quartermaster would pay a fortune for it. Shame if someone already had their hand on it.'],
        ['Oduya', 'tank', 'Put it back.'],
        ['Kestrel', 'rogue', 'Fine, fine. I am Unsworn, I go where the coin is. And right now the coin is wherever you lot are going.'],
      ], join: 'kestrel', goal: 'Defeat the Cellar Glutton on floor 10' },
    { id: 'glutton', ch: 1, when: s => s.maxFloorEver >= 11, title: 'What the Glutton Swallowed',
      lines: [
        ['Kestrel', 'rogue', 'Something in its belly... a Tide war-order. "The Hold’s seal weakens. Everything feeds the Tide." They know.'],
        ['Kestrel', 'rogue', 'And this. An old map, signed by a lantern-bearer from forty years ago.'],
        ['Moss', 'healer', 'That name is on the memorial in the Hold. They went down and never came back.'],
        ['Oduya', 'tank', 'Then we are not the first, and the Tide is already below us. Keep moving.'],
      ], goal: 'Push into the Mosswater Crypts' },
    { id: 'wren', ch: 2, when: s => s.maxFloorEver >= 13, title: 'The Apprentice',
      lines: [
        ['Wren', 'mage', 'Do NOT step on the glowing tiles. I spent all morning on those wards.'],
        ['Wren', 'mage', 'Radiant Ascendancy, third circle. My master came down here to study the Rift’s light a year ago. The Ascendancy says the Rift can lift us beyond mortal. I just want him back.'],
        ['Oduya', 'tank', 'The Ascendancy wants the Rift open. The Covenant wants it shut.'],
        ['Kestrel', 'rogue', 'And she sets things on fire, which is the bit that matters. She is coming with us.'],
      ], join: 'wren', goal: 'Reach Grandmother Rot on floor 20' },
    { id: 'rot', ch: 2, when: s => s.maxFloorEver >= 21, title: 'Grandmother Rot',
      lines: [
        ['Moss', 'healer', 'I knew her. She ran the first Mercy Corps tent on this front, before the Tide got to her. She taught me every remedy I know.'],
        ['Moss', 'healer', 'She said the Hold sends people down to keep the lantern lit. I thought she meant they carried oil.'],
        ['Oduya', 'tank', 'What else would they carry?'],
      ], goal: 'Find a way through the Glimmer Fungus Deep' },
    { id: 'vael', ch: 3, when: s => s.maxFloorEver >= 24, title: 'The Starless Walker',
      lines: [
        ['Vael', 'necro', 'You walk loudly for people who want to live. I can help. The dead down here owe me favours.'],
        ['Moss', 'healer', 'That is a Devouring Tide sigil on your cloak. Absolutely not.'],
        ['Vael', 'necro', 'Was. I tore it off once I saw what the Tide does with the Rift. Everything feeds the Tide. I decided I would rather not.'],
        ['Wren', 'mage', '...Master?'],
        ['Vael', 'necro', 'Hello, Wren. You grew up. The Ascendancy sent me to study the Rift. It studied me back. I am sorry I did not write.'],
      ], join: 'vael', goal: 'Silence the Mycelial Choir on floor 30' },
    { id: 'choir', ch: 3, when: s => s.maxFloorEver >= 31, title: 'What the Choir Sang',
      lines: [
        ['Vael', 'necro', 'The spores grow on Rift-light. They remember everyone who passed. They sang the names of the lantern-bearers. All of them.'],
        ['Vael', 'necro', 'None of the names came back up. Not one.'],
        ['Kestrel', 'rogue', 'I liked this job better when it was about gold.'],
      ], goal: 'Cross the Saltbone Galleries' },
    { id: 'bones', ch: 4, when: s => s.maxFloorEver >= 36, title: 'Bones That Speak',
      lines: [
        ['Oduya', 'tank', 'Covenant armour. An entire company of it. They held this gallery to the last soldier.'],
        ['Vael', 'necro', 'Let me ask the bones. Quietly now.'],
        ['A lantern-bearer’s skull', 'necro', 'The lantern is not a light. It is a seal on the Rift. It burns on what is given to it.'],
        ['Oduya', 'tank', 'Given. Or who.'],
      ], goal: 'Defeat Ossuary Prime on floor 40' },
    { id: 'ashe', ch: 5, when: s => s.maxFloorEver >= 42, title: 'The Burning Knight',
      lines: [
        ['Sir Ashe', 'tank', 'Iron Covenant, Forge Garrison. Forty years I have held these forges against Ascendancy war-engines. Thessaly sent me down with a lantern too.'],
        ['Sir Ashe', 'tank', 'She told me I was the last bearer she would ever need. I will walk with you. If she lied to me, I would like to hear her say it.'],
      ], join: 'ashe', goal: 'Put out Furnace-Heart on floor 50' },
    { id: 'oracle', ch: 6, when: s => s.maxFloorEver >= 52, title: 'The Drowned Seer',
      lines: [
        ['The Pale Oracle', 'healer', 'The Ascendancy flooded this chapel trying to pry the Rift open from below. I stayed to watch what came through.'],
        ['The Pale Oracle', 'healer', 'I have seen you arrive a hundred times. In most of them you turn back here. In the rest, the one who carries the lantern sits on a throne in the dark.'],
        ['The Pale Oracle', 'healer', 'I will heal you either way. Rise beyond, little bearer.'],
      ], join: 'oracle', goal: 'Face the Sunken Bishop on floor 60' },
    { id: 'varga', ch: 7, when: s => s.maxFloorEver >= 63, title: 'Family Business',
      lines: [
        ['Varga', 'rogue', 'Little sister. The Tide paid me to make sure you never reached the Vault. Thessaly paid me to make sure you did.'],
        ['Kestrel', 'rogue', 'And?'],
        ['Varga', 'rogue', 'And they both pay badly. I am switching to family. Mind the roots, they bite.'],
      ], join: 'varga', goal: 'Cut down the Root Mother on floor 70' },
    { id: 'brann', ch: 7, when: s => s.maxFloorEver >= 68, title: 'Runes on the Roots',
      lines: [
        ['Brann', 'mage', 'These seal-wards are mine. The Covenant sent me to carve them for Thessaly before I understood what they hold in, and what they eat.'],
        ['Brann', 'mage', 'Let me help you read them. It is the least I owe.'],
      ], join: 'brann', goal: 'Enter the Starless Vault' },
    { id: 'king', ch: 8, when: s => s.maxFloorEver >= 74, title: 'The Hollow King',
      lines: [
        ['The Hollow King', 'necro', 'So the Lampmother sent another one. Did she tell you I was the monster?'],
        ['The Hollow King', 'necro', 'Every bearer she sends down feeds the seal. Every one keeps the Rift shut, and keeps her young. I was the first she fed it, before the Grand War had a name.'],
        ['Oduya', 'tank', '...Then we have been carrying our own pyre. Holding the line with our own bodies.'],
        ['The Hollow King', 'necro', 'Let me come with you. I want my name back, and she has it.'],
      ], join: 'hollow', goal: 'Reach the Unlit on floor 80' },
    { id: 'end', ch: 8, when: s => s.maxFloorEver >= 81, title: 'The Lantern’s Secret',
      lines: [
        ['The Unlit', 'boss', 'You are the first to reach me with your own light still burning. I am the Nyx Rift’s breath. The Tide wants to drink me. The Ascendancy wants to wear me.'],
        ['Old Thessaly', 'lamp', 'You were not supposed to come this far, child. The seal needs feeding. If it fails, this front falls, and the war comes through the Rift into every sector of the Reach.'],
        ['Wren', 'mage', 'Then we will find it something else to burn.'],
        ['The Unlit', 'boss', 'The seal has a root, far below the Vault. Follow it, and you will find where she plants her bearers.'],
      ], goal: 'Cross the Glass Wastes to floor 90' },
    { id: 'glass', ch: 9, when: s => s.maxFloorEver >= 83, title: 'Below the Bottom of the Map',
      lines: [
        ['Brann', 'mage', 'No map goes below the Vault. Then again, no map admitted the Vault was there.'],
        ['Brann', 'mage', 'This glass is the Rift, cooled. The Ascendancy grinds it into lenses. Whoever rules here sees every sector at once.'],
        ['Kestrel', 'rogue', 'Then let us break the glasses.'],
      ], goal: 'Shatter the Glass Regent on floor 90' },
    { id: 'bastion', ch: 10, when: s => s.maxFloorEver >= 92, title: 'The Iron Covenant Holds',
      lines: [
        ['Oduya', 'tank', 'That is a Covenant banner. The Ironbound Bastion. It fell into the Rift in the first year of the war, and they never stopped holding it.'],
        ['Oduya', 'tank', 'Marshal Ironvow sealed the gates from the inside. Hold the line, he said. He never said for how long.'],
      ], goal: 'Relieve Marshal Ironvow on floor 100' },
    { id: 'aqueduct', ch: 11, when: s => s.maxFloorEver >= 102, title: 'Where the Tide Drinks',
      lines: [
        ['Varga', 'rogue', 'The Tide built this aqueduct to drink the Rift dry. Every drop that runs here was somebody’s warmth.'],
        ['Moss', 'healer', 'Mercy Corps markers on the walls. Someone was still triaging the wounded down here. They held out longer than anyone should have.'],
      ], goal: 'Drain the Brine Matriarch on floor 110' },
    { id: 'orchard', ch: 12, when: s => s.maxFloorEver >= 112, title: 'The Bone Orchard',
      lines: [
        ['The Hollow King', 'necro', 'These trees grow from the bearers she fed. I can hear every one of them.'],
        ['The Hollow King', 'necro', 'Corvane. That was my name. It is carved into the third root. Thank you, bearer. I will carry it the rest of the way.'],
      ], goal: 'Lay the Orchard Keeper to rest on floor 120' },
    { id: 'spire', ch: 13, when: s => s.maxFloorEver >= 122, title: 'Stormglass',
      lines: [
        ['Wren', 'mage', 'My master’s spire. The Radiant Ascendancy has pulled light out of the Rift from up here for years.'],
        ['Wren', 'mage', 'If they master the Rift, they rule every sector of the Reach. I used to think that was the whole point of the war.'],
      ], goal: 'Break the Ascendant Prism on floor 130' },
    { id: 'scar', ch: 14, when: s => s.maxFloorEver >= 132, title: 'The Nexus Scar',
      lines: [
        ['Narrator', 'lamp', 'Here the Nexus runs close enough to touch. All three alliances have warbands in the scar, and none of them is winning.'],
        ['The Pale Oracle', 'healer', 'This is the moment I saw. One road ends on a throne in the dark. The other ends with the lantern breaking.'],
      ], goal: 'Survive the Threefold Warhost on floor 140' },
    { id: 'threshold', ch: 15, when: s => s.maxFloorEver >= 142, title: 'The Rift Threshold',
      lines: [
        ['Old Thessaly', 'lamp', 'You should have stayed in the cellars, child. Every seal needs a keeper. I was going to let you choose to become one.'],
        ['Kestrel', 'rogue', 'We are choosing. Just not the way you hoped.'],
      ], goal: 'Face the Lampmother on floor 150' },
    { id: 'act1', ch: 15, when: s => s.maxFloorEver >= 151, title: 'The Lampmother Falls',
      lines: [
        ['The Lampmother', 'lamp', 'Without me the seal breaks at the next surge. The Rift will open into every sector of the Reach. Is that what you wanted?'],
        ['The Unlit', 'boss', 'It wanted to breathe. Now it will.'],
        ['Narrator', 'lamp', 'End of Act One. When the Rift surges at the end of the season, the alliance holding the Nexus decides what comes through. Act Two opens with Season 2 of the Grand War.'],
      ], goal: 'Act Two opens with Season 2 of the Grand War' },
  ];

  function newState() {
    return {
      v: VERSION,
      econ: 2, gold: 0, floor: 1, foeIdx: 0, maxFloor: 1, maxFloorEver: 1,
      mode: null, hero: null, guests: [],
      unlocked: [], levels: {}, party: [null, null, null, null, null],
      hp: {}, down: {}, abil: {}, minions: [], items: { draught: 1, oil: 0 }, campUntil: 0, jobs: {},
      skills: {}, kindling: 0, bagUps: 0, unlocks: {}, kup: {}, autoTrain: {},
      relics: {}, embers: 0, feats: {},
      bag: [], gear: {}, lore: { hold: 1 },
      story: { seen: {}, queue: [] },
      autoAdvance: true, autoCast: true, retryAt: 0, formation: 1, formationManual: false,
      foe: null, lantern: 0, foeSwing: 0,
      stats: { kills: 0, bossKills: 0, clicks: 0, chests: 0, goldEarned: 0, rekindles: 0, playTime: 0, crits: 0, wipes: 0, revives: 0 },
      settings: { sound: true, buy: 1, notation: 'short' },
      lastSeen: Date.now(), created: Date.now(),
    };
  }

  // ---------- formulas ----------
  const isBossFloor = f => f % BOSS_EVERY === 0;
  const biomeOf = f => BIOMES[Math.floor((f - 1) / 10) % BIOMES.length];
  const depthCycle = f => Math.floor((f - 1) / (10 * BIOMES.length));
  // Economy scale: every power curve is the old curve raised to POW, which keeps the same pacing
  // with much smaller numbers (floor 45 gold drops in the tens instead of tens of thousands).
  const ECON_AT = Date.UTC(2026, 10, 23, 5);  // letters and listings older than this were priced in old gold
  const POW = 0.4, TOUGH_POW = 0.9;  // difficulty past floor 15 keeps more of its old bite so the pace matches the old curve
  const EMBER_PER = 0.04, EMBER_HP = 0.016, FEAT_PER = 0.01;
  function rawHp(f) {
    let hp = Math.pow(1.22, f - 1);
    if (f > 60) hp *= Math.pow(1.03, f - 60);
    if (f > 140) hp *= Math.pow(1.04, f - 140);
    return hp;
  }
  const baseHp = f => 10 * Math.pow(rawHp(f), POW);
  // Converts gold saved before the rescale into today's gold: the same number of training levels for a hero of level L.
  const regold = (g, L) => g * Math.pow(COST_GROWTH / 1.07, Math.max(0, L || 0));
  // Difficulty curve: the first floors are gentle, then monsters toughen faster than the gold they drop.
  const rawTough = f => (f <= 10 ? 0.8 + 0.02 * f : 1) * (f > 15 ? Math.pow(1.012, f - 15) : 1) * (f > 40 ? Math.pow(1.012, f - 40) : 1);
  const tough = f => Math.pow(rawTough(f), TOUGH_POW);
  const foeHp = (f, boss) => baseHp(f) * tough(f) * (boss ? 9 : 1);
  const foeGold = (f, boss) => (1 + baseHp(f) / 40) * (boss ? 5 : 1);
  // Foe damage per second. Grows a little slower than foe health, so a well-kept party can hold.
  const foeDps = (f, boss) => 1.1 * Math.pow(Math.pow(1.205, f - 1) * (f > 60 ? Math.pow(1.025, f - 60) : 1) * Math.sqrt(rawTough(f)), POW) * (boss ? 2.2 : 1);
  const FOE_SWING = 1.6;

  function relicVal(s, id) { const r = RELICS.find(x => x.id === id); return (s.relics[id] || 0) * r.per; }
  function milestoneMult(lvl) { let m = 1; for (const t of MILESTONES) if (lvl >= t) m *= (t >= 200 ? 3 : 2); return m; }
  function nextMilestone(lvl) { return MILESTONES.find(t => t > lvl) || null; }

  const lvl = (s, id) => { if (isGuest(s, id)) { const g = s.guests.find(x => x.id === id); return g ? g.level : 0; } return s.levels[id] || 0; };
  function costDiscount(s) { return Math.min(0.25, relicVal(s, 'ledger')) + Math.min(0.15, campTrait(s, 'train')); }
  function memberBaseCost(m) { return m.id === 'you' ? 8 : TIER[m.tier].cost * (1 + CLASS_ORDER.indexOf(m.cls) * 0.6); }
  function trainCost(s, id, n) {
    const m = memberById(id), L = lvl(s, id), r = COST_GROWTH;
    return memberBaseCost(m) * Math.pow(r, L) * (Math.pow(r, n) - 1) / (r - 1) * (1 - costDiscount(s));
  }
  function maxAffordable(s, id) {
    const m = memberById(id), L = lvl(s, id), r = COST_GROWTH;
    const unit = memberBaseCost(m) * Math.pow(r, L) * (1 - costDiscount(s));
    if (s.gold < unit) return 0;
    return Math.max(0, Math.floor(Math.log(s.gold * (r - 1) / unit + 1) / Math.log(r)));
  }

  function featCount(s) { return Object.keys(s.feats).length; }
  function emberMult(s) { return 1 + EMBER_PER * s.embers; }
  function abilityActive(s, id, now) { const a = s.abil[id]; return !!(a && a.until > now); }
  const scale = (s, id) => { const m = memberById(id), L = lvl(s, id); return Math.pow(L * milestoneMult(L) * TIER[m.tier].stat * (m.player ? 1 : NPC_POWER), POW); };

  function maxHpOf(s, id) {
    const m = memberById(id);
    return Math.max(1, CLASSES[m.cls].hp * scale(s, id) * (1 + relicVal(s, 'ward')) * (1 + EMBER_HP * s.embers) * gearMult(s, id, 'hp') * sidePerk(s, 'hp') * (1 + campBonus(s, 'hp')) * (1 + sk(s, 'php') + (id === 'you' ? sk(s, 'hp') : 0)));
  }
  function partyMult(s) { return emberMult(s) * (1 + kup(s, 'edge')) * (1 + FEAT_PER * featCount(s)) * (1 + relicVal(s, 'crown')) * sidePerk(s, 'dps') * (1 + campBonus(s, 'dps')) * (1 + sk(s, 'pdps')); }
  function memberDps(s, id, now) {
    if (!id || s.down[id] || !lvl(s, id)) return 0;
    const m = memberById(id), c = CLASSES[m.cls];
    let d = c.dps * scale(s, id) * partyMult(s) * gearMult(s, id, 'dps');
    if (id === 'you') { d *= 1 + sk(s, 'dps'); const fu = fxOn(s, 'fury', now); if (fu) d *= fu; }
    if (m.cls === 'mage' && abilityActive(s, id, now)) d *= (setBonus(s, id) >= 3 ? 6 : 4) * (id === 'you' ? 1 + sk(s, 'power') : 1);
    return d;
  }
  function minionDps(s, now) {
    const live = s.minions.filter(x => x.until > now && x.hp > 0);
    return live.reduce((a, x) => a + x.dps, 0);
  }
  function totalDps(s, now) {
    let d = 0; for (const id of s.party) d += memberDps(s, id, now);
    return d + minionDps(s, now);
  }
  function healPerSec(s, id) {
    if (!id || s.down[id] || !lvl(s, id)) return 0;
    const m = memberById(id); if (m.cls !== 'healer') return 0;
    return CLASSES.healer.heal * scale(s, id) * gearMult(s, id, 'heal') * (1 + relicVal(s, 'censer')) * (1 + EMBER_HP * s.embers) * (1 + FEAT_PER * featCount(s)) * sidePerk(s, 'heal') * (1 + campBonus(s, 'heal')) * (1 + sk(s, 'pheal') + (id === 'you' ? sk(s, 'heal') : 0));
  }
  function clickDamage(s, now) { return (1 + totalDps(s, now) * 0.05) * (1 + relicVal(s, 'whet')); }
  function goldMult(s) { return emberMult(s) * (1 + kup(s, 'purse')) * (1 + relicVal(s, 'locket')) * sidePerk(s, 'gold') * (1 + campBonus(s, 'gold')) * (1 + sk(s, 'gold')); }
  function critChance(s) { return 0.04 + relicVal(s, 'dice') + sk(s, 'crit'); }
  function lanternTime(s) { return BASE_LANTERN + kup(s, 'oil') + relicVal(s, 'lamp') + campBonus(s, 'lamp') + sk(s, 'lantern'); }
  function chestChance(s) { return 0.03 + relicVal(s, 'moth') + sk(s, 'chest'); }
  function abilityDuration(s, ab) { return ab.dur * (1 + relicVal(s, 'hourglass')); }

  // ---------- Skill trees ----------
  // Each class has three branches of four skills; the fourth teaches a new ability. Your own hero uses the tree for their class.
  // Kindling comes only from rekindling. Ranks cost 1, 2 and 3 points by tier, and a skill
  // needs the one above it in its branch first. A full tree costs 48 points.
  // n: name, k: effect, v: per rank, r: max ranks, d: description ({v} is the rank total).
  const SK = (n, k, v, r, d) => ({ n, k, v, r, d });
  const SKILL_TREES = {
    tank: [
      { b: 'Bastion', s: [SK('Iron Hide', 'hp', 0.10, 3, '+{v} health for your hero'), SK('Hold the Line', 'guard', 0.04, 3, 'Party takes {v} less damage'), SK('Unbreakable', 'power', 0.5, 1, 'Shield Wall blocks 85% of damage instead of 70%')] },
      { b: 'Vanguard', s: [SK('Shield Bash', 'dps', 0.15, 3, '+{v} damage for your hero'), SK('Rallying Cry', 'pdps', 0.05, 3, '+{v} party damage'), SK('Bulwark Charge', 'cd', 0.3, 1, 'Shield Wall comes back 30% sooner')] },
      { b: 'Warden', s: [SK('Stalwart Company', 'php', 0.05, 3, '+{v} party health'), SK('Lantern Bearer', 'lantern', 2, 3, '+{v}s lantern time on guardians'), SK('Long Watch', 'dur', 0.5, 1, 'Shield Wall lasts 50% longer')] },
    ],
    healer: [
      { b: 'Grace', s: [SK('Gentle Hands', 'heal', 0.10, 3, '+{v} healing from your hero'), SK('Mending Light', 'pheal', 0.05, 3, '+{v} party healing'), SK('Second Dawn', 'revive', 2, 1, 'Lantern Hymn lifts two more fallen allies')] },
      { b: 'Vigil', s: [SK('Blessed Ward', 'php', 0.05, 3, '+{v} party health'), SK('Sanctuary', 'guard', 0.03, 3, 'Party takes {v} less damage'), SK('Swelling Hymn', 'power', 0.5, 1, 'Lantern Hymn heals 50% more')] },
      { b: 'Pilgrim', s: [SK('Alms', 'gold', 0.08, 3, '+{v} gold'), SK('Lamplight Psalm', 'lantern', 2, 3, '+{v}s lantern time on guardians'), SK('Quick Prayer', 'cd', 0.3, 1, 'Lantern Hymn comes back 30% sooner')] },
    ],
    rogue: [
      { b: 'Shadow', s: [SK('Light Feet', 'dodge', 0.03, 3, '+{v} dodge chance for your hero'), SK('Quick Hands', 'dps', 0.15, 3, '+{v} damage for your hero'), SK('Vanish', 'cd', 0.35, 1, 'Backstab comes back 35% sooner')] },
      { b: 'Fortune', s: [SK('Sticky Fingers', 'gold', 0.08, 3, '+{v} gold'), SK('Keen Eye', 'loot', 0.06, 3, '+{v} gear drop chance'), SK('Lockpick', 'chest', 0.02, 1, '+2% treasure chest chance')] },
      { b: 'Edge', s: [SK('Find the Gap', 'crit', 0.02, 3, '+{v} critical strike chance'), SK('Coordinated Strike', 'pdps', 0.04, 3, '+{v} party damage'), SK('Killing Blow', 'power', 1, 1, 'Backstab hits twice as hard')] },
    ],
    mage: [
      { b: 'Fire', s: [SK('Kindle', 'dps', 0.15, 3, '+{v} damage for your hero'), SK('Fan the Flames', 'pdps', 0.05, 3, '+{v} party damage'), SK('Inferno', 'power', 0.5, 1, 'Ember Storm burns 50% hotter')] },
      { b: 'Arcane', s: [SK('Flowing Mana', 'cd', 0.08, 3, 'Ember Storm comes back {v} sooner'), SK('Lingering Fire', 'dur', 0.15, 3, 'Ember Storm lasts {v} longer'), SK('Overcharge', 'crit', 0.05, 1, '+5% critical strike chance')] },
      { b: 'Ward', s: [SK('Glyph of Warding', 'php', 0.05, 3, '+{v} party health'), SK('Runic Shield', 'guard', 0.03, 3, 'Party takes {v} less damage'), SK('Lantern Sigil', 'lantern', 4, 1, '+4s lantern time on guardians')] },
    ],
    necro: [
      { b: 'Grave', s: [SK('Bone Craft', 'power', 0.15, 3, 'Skeletons hit {v} harder'), SK('Restless Dead', 'dur', 0.15, 3, 'Skeletons last {v} longer'), SK('Ossuary', 'minion', 2, 1, 'Raise Dead calls two more skeletons')] },
      { b: 'Blight', s: [SK('Rot', 'dps', 0.15, 3, '+{v} damage for your hero'), SK('Withering Curse', 'pdps', 0.05, 3, '+{v} party damage'), SK('Soul Harvest', 'cd', 0.3, 1, 'Raise Dead comes back 30% sooner')] },
      { b: 'Pact', s: [SK('Grave Gold', 'gold', 0.08, 3, '+{v} gold'), SK('Death’s Ledger', 'loot', 0.06, 3, '+{v} gear drop chance'), SK('Deathless', 'php', 0.10, 1, '+10% party health')] },
    ],
  };
  // Specializations: the fourth skill of each branch teaches your hero a new active ability.
  // fx: burst (seconds of the hero's damage at once), shield (party takes less damage), vuln (foe takes more damage),
  // fury (hero damage multiplier), heal (party heal), cleanse (cures poison), strip (breaks wards).
  const AB = (id, name, cd, dur, desc, fx) => ({ id, name, cd, dur, desc, fx });
  const SPECS = {
    tank: [AB('roar', 'Taunting Roar', 40, 10, 'The party takes 40% less damage for 10s.', { shield: 0.4 }),
      AB('slam', 'Shield Slam', 18, 0, 'Strikes for 10 seconds of damage and shatters any ward.', { burst: 10, strip: 1 }),
      AB('bastion', 'Last Bastion', 60, 6, 'Heals the party for 30% and blocks 60% of damage for 6s.', { heal: 0.3, shield: 0.6 })],
    healer: [AB('purify', 'Purify', 15, 0, 'Cures all poison and heals the party for 25%.', { cleanse: 1, heal: 0.25 }),
      AB('sanctum', 'Sanctified Ground', 45, 12, 'The party takes 30% less damage for 12s.', { shield: 0.3 }),
      AB('smite', 'Radiant Smite', 25, 8, 'The foe takes 30% more damage for 8s.', { vuln: 0.3 })],
    rogue: [AB('flurry', 'Shadow Flurry', 25, 6, 'Your hero deals triple damage for 6s.', { fury: 3 }),
      AB('venomblade', 'Envenomed Blade', 30, 10, 'The foe takes 25% more damage for 10s.', { vuln: 0.25 }),
      AB('smoke', 'Smoke Bomb', 40, 6, 'The party takes 50% less damage for 6s.', { shield: 0.5 })],
    mage: [AB('barrage', 'Arcane Barrage', 20, 0, 'Strikes for 15 seconds of damage at once.', { burst: 15 }),
      AB('frost', 'Frost Nova', 35, 8, 'Slows the foe: the party takes 50% less damage for 8s.', { shield: 0.5 }),
      AB('lance', 'Rift Lance', 25, 0, 'Shatters any ward and strikes for 8 seconds of damage.', { burst: 8, strip: 1 })],
    necro: [AB('bonewall', 'Bone Wall', 35, 10, 'The party takes 35% less damage for 10s.', { shield: 0.35 }),
      AB('harvest', 'Soul Reap', 30, 0, 'Strikes for 6 seconds of damage and heals the party for 20%.', { burst: 6, heal: 0.2 }),
      AB('curse', 'Grave Curse', 30, 8, 'The foe takes 30% more damage for 8s.', { vuln: 0.3 })],
  };
  for (const c in SKILL_TREES) SKILL_TREES[c].forEach((br, bi) => { const a = SPECS[c][bi]; br.s.push(Object.assign(SK(a.name, 'abil', 0, 1, 'New ability: ' + a.desc), { ab: a })); });
  // Give every skill a stable id like 'tank.1.2' (branch 1, tier 2).
  for (const c in SKILL_TREES) SKILL_TREES[c].forEach((br, bi) => br.s.forEach((k, ti) => { k.id = c + '.' + bi + '.' + ti; k.tier = ti; k.cls = c; k.branch = bi; }));
  const skillById = id => { const [c, b, t] = (id || '').split('.'); const br = SKILL_TREES[c] && SKILL_TREES[c][+b]; return br && br.s[+t]; };
  const heroCls = s => { const h = s.hero && memberById('you'); return h ? h.cls : null; };
  const skillCost = k => k.tier + 1;
  function skillText(k, rank) {
    const v = k.v * Math.max(1, rank);
    return k.d.replace('{v}', k.k === 'lantern' ? v : Math.round(v * 100) + '%');
  }
  // ---------- Grand War auras ----------
  // A verified Grand War commander's hero carries an aura for their class. Its strength follows their war rank
  // (0 Recruit .. 6, the top of the alliance ladder), and war honors add to it. Earned in the war, never bought.
  const AURA_TIER = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10];
  const AURAS = {
    tank:   { name: 'Bulwark Aura',  fx: [['guard', 0.5, 'less damage taken by the party'], ['php', 1, 'party health']] },
    healer: { name: 'Mending Aura',  fx: [['pheal', 1.5, 'party healing'], ['php', 0.5, 'party health']] },
    rogue:  { name: 'Shadow Aura',   fx: [['gold', 1.5, 'gold'], ['crit', 0.25, 'critical strike chance']] },
    mage:   { name: 'Ember Aura',    fx: [['pdps', 1, 'party damage'], ['crit', 0.25, 'critical strike chance']] },
    necro:  { name: 'Grave Aura',    fx: [['pdps', 0.75, 'party damage'], ['loot', 1, 'gear drop chance']] },
  };
  const HONOR_FX = [
    ['Grand Marshal', 'Marshal’s Banner', 'pdps', 0.05, 'party damage'],
    ['Alliance Champion', 'Champion’s Mantle', 'php', 0.05, 'party health'],
    ['Nexus Holder', 'Nexus Tithe', 'gold', 0.10, 'gold'],
  ];
  // s.war: { lv, h: [honor names] } for a verified commander, otherwise absent.
  function warAura(s) {
    const w = s.war, c = heroCls(s);
    if (!w || !c || !AURAS[c]) return null;
    const lv = Math.max(0, Math.min(6, w.lv | 0)), h = Array.isArray(w.h) ? w.h.map(String) : [];
    const vets = h.filter(x => /Season/.test(x)).length, base = AURA_TIER[lv] * (1 + 0.25 * Math.min(4, vets));
    const fx = {}, lines = [];
    for (const [k, m, d] of AURAS[c].fx) { fx[k] = (fx[k] || 0) + base * m; lines.push(fmtPct(base * m) + ' ' + d); }
    for (const [hn, name, k, v, d] of HONOR_FX) if (h.includes(hn)) { fx[k] = (fx[k] || 0) + v; lines.push(name + ': ' + fmtPct(v) + ' ' + d); }
    if (vets) lines.push('Veteran of ' + vets + (vets === 1 ? ' season' : ' seasons') + ': aura ' + fmtPct(0.25 * Math.min(4, vets)) + ' stronger');
    return { name: AURAS[c].name, cls: c, lv, fx, lines };
  }
  const fmtPct = v => '+' + (Math.round(v * 1000) / 10) + '%';
  function auraVal(s, key) { const a = warAura(s); return a && a.fx[key] || 0; }
  // Character sheet: your hero earns XP from every fight and levels up. Each level gives a stat point
  // (two every fifth level). Stats start at 10 like a tabletop character; each point above 10 adds a small
  // party bonus, and the two stats your class favours count half again. Luck touches everything a little.
  const STATS = [
    { id: 'str', name: 'Strength',     short: 'STR', desc: 'party damage',                fx: { pdps: 0.006 } },
    { id: 'dex', name: 'Dexterity',    short: 'DEX', desc: 'critical hits and dodging',   fx: { crit: 0.001, dodge: 0.001 } },
    { id: 'con', name: 'Constitution', short: 'CON', desc: 'party health',                fx: { php: 0.008 } },
    { id: 'int', name: 'Intelligence', short: 'INT', desc: 'ability power and damage',    fx: { power: 0.01, pdps: 0.002 } },
    { id: 'wis', name: 'Wisdom',       short: 'WIS', desc: 'healing and ability cooldowns', fx: { pheal: 0.008, cd: 0.003 } },
    { id: 'cha', name: 'Charisma',     short: 'CHA', desc: 'gold from every fight',       fx: { gold: 0.008 } },
    { id: 'lck', name: 'Luck',         short: 'LCK', desc: 'a little of everything: loot, chests, crits, gold, Sigils and ambush spoils', fx: { loot: 0.005, chest: 0.0002, crit: 0.0005, gold: 0.003, sig: 0.000002, spoils: 0.01 } },
  ];
  const STAT_CLASS = { tank: ['str', 'con'], healer: ['wis', 'cha'], rogue: ['dex', 'lck'], mage: ['int', 'wis'], necro: ['int', 'con'] };
  const STAT_BASE = 10, STAT_AFFINITY = 1.5, STAT_MAX = 99;
  const xpNeed = lv => Math.round(12 * lv * lv + 20);
  function heroLevel(s) {
    // Heroes from before the character sheet start with XP for half their past fights.
    if (s.hxp == null && s.hero) s.hxp = Math.floor(((s.stats && s.stats.kills) || 0) * (1 + (s.maxFloorEver || 1) / 25) * 0.5);
    let lv = 1, x = s.hxp || 0;
    while (x >= xpNeed(lv)) { x -= xpNeed(lv); lv++; }
    return { lv, xp: x, need: xpNeed(lv) };
  }
  const pointsFor = lv => (lv - 1) + Math.floor(lv / 5);
  const statSpent = s => Object.values(s.attr || {}).reduce((a, b) => a + b, 0);
  const heroPoints = s => pointsFor(heroLevel(s).lv) - statSpent(s);
  const statScore = (s, id) => STAT_BASE + ((s.attr || {})[id] || 0);
  function addStat(s, id, n) {
    n = n || 1;
    if (!STATS.some(x => x.id === id) || heroPoints(s) < n || statScore(s, id) + n > STAT_MAX) return false;
    s.attr = s.attr || {}; s.attr[id] = (s.attr[id] || 0) + n; return true;
  }
  const RESPEC_COST = 50; // Sigils, paid on the server before the client calls resetStats
  function resetStats(s) { s.attr = {}; return true; }
  function statVal(s, key) {
    const c = heroCls(s), pri = STAT_CLASS[c] || [];
    let t = 0;
    for (const st of STATS) { const v = st.fx[key], n = (s.attr || {})[st.id]; if (v && n) t += v * n * (pri.includes(st.id) ? STAT_AFFINITY : 1); }
    return t;
  }
  function gainXp(s, foe, events) {
    if (!s.hero) return;
    const base = (1 + s.floor / 25) * (foe.boss ? 15 : foe.chest ? 2 : foe.elite ? 4 : 1) * (foe.pack ? foe.pack * 2 : 1);
    const before = heroLevel(s).lv;
    s.hxp += base * (1 + sk(s, 'xp'));
    const after = heroLevel(s).lv;
    if (after > before && events) events.push({ type: 'herolevel', lv: after, pts: pointsFor(after) - pointsFor(before) });
  }
  // Total of one effect from your hero's tree, Grand War aura and character stats. It only counts while your hero is in the party.
  // Tonics from the Quartermaster: small timed buffs, one of each at a time; drinking again adds time up to an hour.
  const TONIC_CAP = 3600;
  // Sigils buy speed-ups only (John, 2026-11-23); combat tonics and Lantern Oil are gold only. perks.js IP charges the same.
  const ITEM_SIGILS = { draught: 10, t_gold: 20, t_loot: 20, t_xp: 15 };
  const TONICS = [
    { id: 't_fury',   name: 'Draught of Fury',     icon: 'sword',  k: 'pdps',  v: 0.15, min: 10, mult: 3,   desc: '+15% party damage for 10 minutes.' },
    { id: 't_bark',   name: 'Ironbark Tonic',      icon: 'shield', k: 'php',   v: 0.15, min: 10, mult: 3,   desc: '+15% party health for 10 minutes.' },
    { id: 't_mend',   name: 'Mender’s Brew',       icon: 'leaf',   k: 'pheal', v: 0.20, min: 10, mult: 2.5, desc: '+20% healing for 10 minutes.' },
    { id: 't_keen',   name: 'Keen-Eye Elixir',     icon: 'eye',    k: 'crit',  v: 0.05, min: 10, mult: 2.5, desc: '+5% critical hit chance for 10 minutes.' },
    { id: 't_gold',   name: 'Prospector’s Luck',   icon: 'coin',   k: 'gold',  v: 0.15, min: 15, mult: 4,   desc: '+15% gold for 15 minutes.' },
    { id: 't_loot',   name: 'Seeker’s Charm',      icon: 'key',    k: 'loot',  v: 0.15, min: 15, mult: 4,   desc: '+15% gear drops for 15 minutes.' },
    { id: 't_xp',     name: 'Scholar’s Ink',       icon: 'book',   k: 'xp',    v: 0.25, min: 15, mult: 3,   desc: '+25% hero XP for 15 minutes.' },
  ];
  const tonicById = id => TONICS.find(t => t.id === id);
  const tonicLeft = (s, id, now) => Math.max(0, (((s.tonic || {})[id] || 0) - (now || Date.now())) / 1000);
  function tonicVal(s, key) {
    if (!s.tonic) return 0;
    const now = Date.now(); let t = 0;
    for (const x of TONICS) if (x.k === key && (s.tonic[x.id] || 0) > now) t += x.v;
    return t;
  }
  function drinkTonic(s, id, now) {
    now = now || Date.now(); const t = tonicById(id);
    if (!t || !s.items || !(s.items[id] > 0)) return false;
    if (tonicLeft(s, id, now) + t.min * 60 > TONIC_CAP + 1) return false;
    s.items[id]--; s.tonic = s.tonic || {};
    s.tonic[id] = Math.max(now, s.tonic[id] || 0) + t.min * 60000; return true;
  }
  // ---------- Companion traits ----------
  // Every story companion rolls three traits the first time they join (kept for good):
  //   a position trait (works while they march in one seat), a kinship trait (works while a given class is in the party),
  //   and a camp trait (works while they rest at the campfire). Rolls have three grades; values stay small.
  const TRAIT_FX = {
    pdps:  { n: 'party damage',  lo: 0.04, hi: 0.10 },
    php:   { n: 'party health',  lo: 0.04, hi: 0.10 },
    pheal: { n: 'healing',       lo: 0.05, hi: 0.12 },
    crit:  { n: 'crit chance',   lo: 0.01, hi: 0.03 },
    gold:  { n: 'gold',          lo: 0.04, hi: 0.10 },
    loot:  { n: 'gear drops',    lo: 0.04, hi: 0.10 },
  };
  const CAMP_TRAITS = {
    job:   { n: 'to their camp job', lo: 0.15, hi: 0.40 },
    train: { n: 'off training costs', lo: 0.02, hi: 0.05 },
    gold:  { n: 'gold',               lo: 0.03, hi: 0.06 },
    rest:  { n: 'faster healing at camp', lo: 0.20, hi: 0.50 },
  };
  const TRAIT_GRADE = ['Common', 'Fine', 'Rare'];
  const POS_TRAIT_NAME = ['Vanguard', 'Shieldmate', 'Anchor', 'Flanker', 'Rearguard'];
  const KIN_TRAIT_NAME = { tank: 'Shield-sworn', healer: 'Mercy-bound', rogue: 'Knife-friend', mage: 'Spell-touched', necro: 'Bone-kin' };
  const CAMP_TRAIT_NAME = { job: 'Hard worker', train: 'Drillmaster', gold: 'Haggler', rest: 'Fire-tender' };
  function rollTrait(table, keys, r) {
    const k = keys[Math.floor(r() * keys.length)], g = r() < 0.6 ? 0 : r() < 0.75 ? 1 : 2, t = table[k];
    const v = t.lo + (t.hi - t.lo) * ((g + r()) / 3);
    return { k, g, v: Math.round(v * 1000) / 1000 };
  }
  function traitsOf(s, id, r) {
    if (!id || id === 'you' || isGuest(s, id) || !s.unlocked.includes(id)) return null;
    s.traits = s.traits || {};
    if (!s.traits[id]) {
      r = r || Math.random;
      const m = memberById(id);
      const pos = Object.assign(rollTrait(TRAIT_FX, Object.keys(TRAIT_FX), r), { at: Math.floor(r() * PARTY_SIZE) });
      const kin = Object.assign(rollTrait(TRAIT_FX, Object.keys(TRAIT_FX), r), { cls: CLASS_ORDER[Math.floor(r() * CLASS_ORDER.length)] });
      // healers get healing kinship, everyone else something they can use
      if (kin.k === 'pheal' && m.cls !== 'healer' && r() < 0.5) kin.k = 'php';
      s.traits[id] = { pos, kin, camp: rollTrait(CAMP_TRAITS, Object.keys(CAMP_TRAITS), r) };
    }
    return s.traits[id];
  }
  // Is each trait working right now?
  function traitState(s, id) {
    const t = traitsOf(s, id); if (!t) return null;
    const i = s.party.indexOf(id), seated = i >= 0;
    const kinOn = seated && s.party.some(x => x && x !== id && memberById(x).cls === t.kin.cls);
    return { t, pos: seated && i === t.pos.at, kin: kinOn, camp: !seated };
  }
  function traitVal(s, key) {
    if (!s.traits) return 0;
    let v = 0;
    for (const id of s.unlocked) {
      const t = s.traits[id]; if (!t) continue;
      const i = s.party.indexOf(id);
      if (i >= 0) {
        if (t.pos.k === key && i === t.pos.at) v += t.pos.v;
        if (t.kin.k === key && s.party.some(x => x && x !== id && memberById(x) && memberById(x).cls === t.kin.cls)) v += t.kin.v;
      } else if (key === 'gold' && t.camp.k === 'gold') v += t.camp.v;
    }
    return v;
  }
  // Camp traits that are not plain stats: training discount (party-wide) and job output / rest speed (own).
  function campTrait(s, k) { let v = 0; if (!s.traits) return 0; for (const id of s.unlocked) { const t = s.traits[id]; if (t && t.camp.k === k && !s.party.includes(id)) v += t.camp.v; } return v; }
  function traitText(kind, t) {
    const fx = (kind === 'camp' ? CAMP_TRAITS : TRAIT_FX)[t.k], pct = t.k === 'crit' ? '+' + (t.v * 100).toFixed(1) + '% ' : '+' + Math.round(t.v * 100) + '% ';
    if (kind === 'pos') return { name: POS_TRAIT_NAME[t.at], when: 'In the ' + POS_NAME[t.at].toLowerCase() + ' seat', fx: pct + fx.n, grade: TRAIT_GRADE[t.g] };
    if (kind === 'kin') return { name: KIN_TRAIT_NAME[t.cls], when: 'With a ' + CLASSES[t.cls].name.toLowerCase() + ' in the party', fx: pct + fx.n, grade: TRAIT_GRADE[t.g] };
    return { name: CAMP_TRAIT_NAME[t.k], when: 'Resting at camp', fx: (t.k === 'train' ? Math.round(t.v * 100) + '% ' : pct) + fx.n, grade: TRAIT_GRADE[t.g] };
  }
  function sk(s, key) { return skBase(s, key) + tonicVal(s, key) + traitVal(s, key); }
  function skBase(s, key) {
    if (!s.party.includes('you')) return 0;
    if (!s.skills) return auraVal(s, key) + statVal(s, key);
    let t = auraVal(s, key) + statVal(s, key);
    for (const id in s.skills) { const k = skillById(id); if (k && k.k === key && k.cls === heroCls(s)) t += k.v * s.skills[id]; }
    return t;
  }
  // Specialization abilities your hero has learned (only while your hero is in the party).
  function heroSpecs(s) {
    if (!s.skills || !s.party.includes('you')) return [];
    const c = heroCls(s); if (!c) return [];
    return SKILL_TREES[c].map(br => br.s[3]).filter(k => k && s.skills[k.id]).map(k => k.ab);
  }
  const fxOn = (s, k, now) => { const f = s.fx && s.fx[k]; return f && f.until > now ? f.v : 0; };
  function castSpec(s, abId, now, events) {
    if (s.down.you || !lvl(s, 'you')) return false;
    const ab = heroSpecs(s).find(a => a.id === abId); if (!ab) return false;
    const key = 'you:' + ab.id, st = s.abil[key] || { readyAt: 0, until: 0 };
    if (st.readyAt > now) return false;
    st.readyAt = now + ab.cd * 1000 * (1 - Math.min(0.5, sk(s, 'cd')) * 0.5);
    st.until = now + abilityDuration(s, ab) * 1000; s.abil[key] = st;
    const fx = ab.fx; s.fx = s.fx || {};
    for (const k of ['shield', 'vuln', 'fury']) if (fx[k]) s.fx[k] = { v: fx[k], until: st.until };
    if (fx.heal) healParty(s, fx.heal, true);
    if (fx.cleanse) s.poison = {};
    if (fx.strip && s.foe) s.foe.ward = 0;
    let d = 0;
    if (fx.burst) { const c = CLASSES[heroCls(s)]; d = Math.max(c.dps, 1) * scale(s, 'you') * partyMult(s) * gearMult(s, 'you', 'dps') * (1 + sk(s, 'dps')) * fx.burst; }
    events && events.push({ type: 'ability', id: 'you', cls: heroCls(s), name: ab.name, dmg: d || undefined });
    if (d) damageFoe(s, d, now, null, events);
    return true;
  }
  function wantsSpec(s, ab, now) {
    const foe = s.foe; if (!foe || foe.chest) return false;
    const fx = ab.fx;
    if (fx.cleanse) return !!(s.poison && Object.keys(s.poison).length) || s.party.some(x => x && (s.hp[x] || 0) < maxHpOf(s, x) * 0.5);
    if (fx.strip) return foe.ward > 0 || foe.boss;
    if (fx.shield) return foe.boss || s.party.some(x => x && (s.hp[x] || 0) < maxHpOf(s, x) * 0.6);
    if (fx.heal) return s.party.some(x => x && (s.hp[x] || 0) < maxHpOf(s, x) * 0.6);
    return foe.boss || foe.hp > totalDps(s, now) * 3;
  }
  function skillSpent(s) { let t = 0; for (const id in (s.skills || {})) { const k = skillById(id); if (k) t += skillCost(k) * s.skills[id]; } return t; }
  function canLearn(s, id) {
    const k = skillById(id); if (!k || k.cls !== heroCls(s)) return 'not';
    const r = (s.skills || {})[id] || 0;
    if (r >= k.r) return 'max';
    if (k.tier > 0 && !((s.skills || {})[k.cls + '.' + k.branch + '.' + (k.tier - 1)])) return 'locked';
    if ((s.kindling || 0) < skillCost(k)) return 'points';
    return 'ok';
  }
  function learnSkill(s, id) {
    if (canLearn(s, id) !== 'ok') return false;
    const k = skillById(id); s.kindling -= skillCost(k); s.skills[id] = (s.skills[id] || 0) + 1; return true;
  }
  // Items in the pack. Gear someone is wearing lives on them, not in the pack.
  function packCount(s) { let n = 0; for (const it of s.bag) if (!wearer(s, it.uid)) n++; return n; }
  function resetSkills(s) { s.kindling = (s.kindling || 0) + skillSpent(s); s.skills = {}; }
  // Kindling earned by rekindling now: 2 at floor 50, plus 1 for every 10 floors deeper.
  function skillPointsFor(s) { return s.maxFloor < REKINDLE_FLOOR ? 0 : 2 + Math.floor((s.maxFloor - REKINDLE_FLOOR) / 10); }

  function embersFor(s) {
    const f = s.maxFloor;
    if (f < REKINDLE_FLOOR) return 0;
    return Math.floor(Math.pow(f - 40, 1.25) / 10 * (1 + relicVal(s, 'heart')));
  }


  // ---------- gear ----------
  // Item types. A robe is a chest piece that also covers the legs.
  const SLOTS = ['main', 'off', 'head', 'neck', 'chest', 'robe', 'legs', 'feet', 'ring'];
  // Where gear is worn. The second trinket and rings 2 to 5 are unlocked per character with Kindling.
  const POS = ['main', 'off', 'head', 'neck', 'neck2', 'chest', 'legs', 'feet', 'ring1', 'ring2', 'ring3', 'ring4', 'ring5'];
  const SLOT_NAME = { main: 'Main hand', off: 'Offhand', head: 'Helmet', neck: 'Trinket', neck2: 'Trinket', chest: 'Chest', robe: 'Robe', legs: 'Legs', feet: 'Feet', ring: 'Ring', ring1: 'Ring', ring2: 'Ring', ring3: 'Ring', ring4: 'Ring', ring5: 'Ring' };
  const CLOTH = { healer: 1, mage: 1, necro: 1 };
  const posType = p => p === 'neck2' ? 'neck' : p.slice(0, 4) === 'ring' ? 'ring' : p;
  const fitsPos = (type, pos) => type === posType(pos) || (type === 'robe' && pos === 'chest');
  const BASES = {
    tank:   { main: "Warden's Mace",  off: 'Tower Shield',  head: 'Iron Helm',          neck: 'Tower Sigil',        chest: 'Bulwark Plate',     legs: 'Plated Greaves',     feet: 'Ironshod Boots',    ring: 'Signet of the Hold' },
    healer: { main: 'Willow Staff',   off: 'Psalter of Light', head: 'Pilgrim Circlet', neck: 'Censer Charm',       chest: 'Linen Vestment',    robe: 'Mossweave Robe',     legs: 'Linen Leggings',    feet: 'Pilgrim Sandals',   ring: 'Mossstone Ring' },
    rogue:  { main: 'Twin Fangs',     off: 'Parrying Dagger', head: 'Shadow Hood',      neck: 'Lucky Coin Chain',   chest: 'Shadowhide Jerkin', legs: 'Quiet Breeches',     feet: 'Soft Boots',        ring: 'Cutpurse Ring' },
    mage:   { main: 'Emberwood Wand', off: 'Focus Orb',     head: 'Scholar Circlet',    neck: 'Focus Prism',        chest: 'Cinder Vest',       robe: 'Cinderweave Robe',   legs: 'Ashen Leggings',    feet: 'Ember-step Slippers', ring: 'Spark Ring' },
    necro:  { main: 'Bone Scepter',   off: 'Grim Tome',     head: 'Skull Cowl',         neck: 'Cracked Phylactery', chest: 'Grave Harness',     robe: 'Gravecloth Shroud',  legs: 'Bone-laced Leggings', feet: 'Grave Walkers',   ring: 'Bone Ring' },
  };
  // How much of an item's power goes to damage and to health. Healers turn their damage share into healing too.
  const WEIGHT = { main: { dps: 1, hp: 0 }, off: { dps: 0.4, hp: 0 }, head: { dps: 0, hp: 0.4 }, neck: { dps: 0.5, hp: 0.5 }, chest: { dps: 0, hp: 1 }, robe: { dps: 0.2, hp: 1.5 }, legs: { dps: 0, hp: 0.5 }, feet: { dps: 0.2, hp: 0.2 }, ring: { dps: 0.25, hp: 0 } };
  const weightOf = it => it.slot === 'off' && it.cls === 'tank' ? { dps: 0, hp: 0.5 } : WEIGHT[it.slot];
  // Old saves used weapon, armor and trinket.
  function normItem(it) {
    if (!it) return it;
    if (it.slot === 'weapon') it.slot = 'main';
    else if (it.slot === 'armor') it.slot = CLOTH[it.cls] && !it.set ? 'robe' : 'chest';
    else if (it.slot === 'trinket') it.slot = 'neck';
    return it;
  }
  const RARITY = [
    { id: 'common', name: 'Common', pct: 0.04, w: 60, prefix: '' },
    { id: 'fine',   name: 'Fine',   pct: 0.08, w: 28, prefix: 'Keen ' },
    { id: 'rare',   name: 'Rare',   pct: 0.14, w: 10, prefix: 'Runed ' },
    { id: 'epic',   name: 'Epic',   pct: 0.24, w: 2,  prefix: 'Lantern-blessed ' },
    { id: 'set',    name: 'Set',    pct: 0.18, w: 0,  prefix: '' },
  ];
  const SETS = [
    { id: 'vigil',  cls: 'tank',   name: "Gravewarden's Vigil", pieces: { main: 'Vigil Hammer', chest: 'Vigil Mail', neck: 'Vigil Lantern' },
      two: '+20% health', three: 'Shield Wall lasts twice as long', lore: 'Forged for the first Gravewarden, who swore no one would be left behind in the dark.' },
    { id: 'grace',  cls: 'healer', name: "Rootmother's Grace", pieces: { main: 'Grace Bough', chest: 'Grace Bark Robe', neck: 'Grace Seed' },
      two: '+25% healing', three: 'Lantern Hymn lifts every fallen ally', lore: 'Before the roots went sour, the Root Mother mended anything that bled. Some of her kindness stayed in the wood.' },
    { id: 'night',  cls: 'rogue',  name: "Kestrel's Night", pieces: { main: 'Nightfang', chest: 'Night Cowl', neck: 'Night Coin' },
      two: '+10% dodge', three: 'Backstab recovers 40% faster', lore: 'Kestrel swears she did not steal these. Varga swears she did.' },
    { id: 'regalia',cls: 'mage',   name: 'Ashcombe Regalia', pieces: { main: 'Ashcombe Rod', chest: 'Ashcombe Mantle', neck: 'Ashcombe Ember' },
      two: '+25% damage', three: 'Ember Storm burns at 6x instead of 4x', lore: 'The robes of the Ashcombe line of fire-scholars. Wren’s master wore them last.' },
    { id: 'crown',  cls: 'necro',  name: 'The Hollow Crown', pieces: { main: 'Hollow Scepter', chest: 'Hollow Regalia', neck: 'Hollow Crown' },
      two: '+30% skeleton damage', three: 'Raise Dead calls 5 skeletons', lore: 'A king’s regalia, left in the Vault when its owner was fed to the lantern.' },
  ];
  // Job sets help a companion's camp job. They drop rarely from guardians and chests from floor 20.
  const JOB_SETS = {
    forage:   { name: 'The Forager’s Kit',       pieces: { head: 'Forager’s Wide Hat',       feet: 'Forager’s Trail Boots',  ring: 'Forager’s Acorn Ring' } },
    smith:    { name: 'Runesmith’s Regalia',     pieces: { head: 'Runesmith’s Glass Visor',  feet: 'Runesmith’s Forge Boots', ring: 'Runesmith’s Etched Band' } },
    herb:     { name: 'The Herbalist’s Satchel', pieces: { head: 'Herbalist’s Sunhat',       feet: 'Mossfoot Sandals',       ring: 'Sprig of Rue Ring' } },
    armor:    { name: 'The Armorer’s Bench',     pieces: { head: 'Armorer’s Leather Cap',    feet: 'Hobnail Boots',          ring: 'Armorer’s Thimble' } },
    prospect: { name: 'Prospector’s Luck',       pieces: { head: 'Prospector’s Candle Cap',  feet: 'Streamwader Boots',      ring: 'Gold-dust Ring' } },
    lamp:     { name: 'The Lamplighter’s Vigil', pieces: { head: 'Lamplighter’s Hood',       feet: 'Wickwalker Slippers',    ring: 'Ember Wick Ring' } },
  };
  const JOB_SET_TWO = 0.4, JOB_SET_THREE = 1.0;
  // Rare job affixes: a few pieces of gear also help one camp job when the wearer works it.
  const AFFIX_CHANCE = { fine: 0.02, rare: 0.06, epic: 0.15 };
  const GEAR_CAP = 40, BAG_STEP = 10, BAG_UPS_MAX = 6;
  let uidSeq = 0;
  const gearPct = it => RARITY.find(r => r.id === it.rar).pct * (1 + 0.03 * it.ilvl) * (1 + 0.2 * it.up);
  // What an item adds, as [label, fraction] pairs.
  function itemStats(it) {
    const p = gearPct(it), w = weightOf(it), out = [];
    if (w.dps) { out.push(['Damage', p * w.dps]); if (it.cls === 'healer') out.push(['Healing', p * w.dps]); }
    if (w.hp) out.push(['Health', p * w.hp]);
    return out;
  }
  const itemScore = it => { const w = weightOf(it); return gearPct(it) * (w.dps + w.hp); };
  function gearName(it) {
    if (it.jset) return JOB_SETS[it.jset].pieces[it.slot];
    if (it.set) return SETS.find(x => x.id === it.set).pieces[it.slot];
    return RARITY.find(r => r.id === it.rar).prefix + BASES[it.cls][it.slot];
  }
  const DROP_W = [['main', 2], ['off', 1.5], ['head', 1.5], ['neck', 1], ['chest', 1.5], ['legs', 1.5], ['feet', 1.5], ['ring', 1.5]];
  function rollSlot(cls, r) {
    let x = r() * 12;
    for (const [t, w] of DROP_W) { x -= w; if (x < 0) return t === 'chest' && CLOTH[cls] && r() < 0.5 ? 'robe' : t; }
    return 'ring';
  }
  function rollGear(s, f, opts, rng) {
    const r = rng || Math.random;
    const classes = Array.from(new Set(s.party.filter(Boolean).map(id => memberById(id).cls)));
    const cls = classes.length ? classes[Math.floor(r() * classes.length)] : CLASS_ORDER[Math.floor(r() * 5)];
    let rar;
    if (opts && opts.set) {
      const set = SETS.find(x => x.cls === cls);
      return { uid: Date.now().toString(36) + (uidSeq++), cls, slot: ['main', 'chest', 'neck'][Math.floor(r() * 3)], rar: 'set', set: set.id, ilvl: f, up: 0 };
    }
    const slot = rollSlot(cls, r);
    // Rarity odds start stingy and open up with depth (d reaches 1 at floor 80).
    const boost = (opts && opts.boost) || 0, d = Math.min(1, f / 80);
    const p = r() + boost * 0.15 * d;
    rar = p > 0.995 - 0.03 * d ? 'epic' : p > 0.94 - 0.08 * d ? 'rare' : p > 0.7 - 0.12 * d ? 'fine' : 'common';
    const it = { uid: Date.now().toString(36) + (uidSeq++), cls, slot, rar, ilvl: f, up: 0 };
    if (r() < (AFFIX_CHANCE[rar] || 0)) it.aff = { j: JOB_KEYS[Math.floor(r() * JOB_KEYS.length)], v: Math.round((0.1 + r() * 0.2) * (rar === 'epic' ? 1.5 : 1) * 100) / 100 };
    return it;
  }
  const JOB_KEYS = Object.keys(JOB_SETS);
  function rollJobSet(s, f, r) {
    const classes = Array.from(new Set(s.party.filter(Boolean).map(id => memberById(id).cls)));
    const cls = classes.length ? classes[Math.floor(r() * classes.length)] : CLASS_ORDER[Math.floor(r() * 5)];
    return { uid: Date.now().toString(36) + (uidSeq++), cls, slot: ['head', 'feet', 'ring'][Math.floor(r() * 3)], rar: 'set', jset: JOB_KEYS[Math.floor(r() * JOB_KEYS.length)], ilvl: f, up: 0 };
  }
  // Lantern Pass: a 30-day convenience pass bought with Sigils. Auto-train, +10 bag slots, +4 hours of offline time. No power.
  const PASS_COST = 500, PASS_DAYS = 30, PASS_BAG = 10, PASS_OFFLINE = 4 * 3600;
  // Lanternholder: the $4.99/month store subscription turns on the same perks for as long as it is paid (s.sub, from the server).
  const passOn = s => !!(s && ((s.pass && s.pass > Date.now()) || (s.passTrial && s.passTrial > Date.now()) || (s.sub && s.sub > Date.now())));
  // Bag of Holding: a one-time 6,500 Sigil buy that removes the pack limit. Convenience only, never power.
  const BOH_COST = 6500;
  const bagCap = s => s.boh ? Infinity : GEAR_CAP + BAG_STEP * (s.bagUps || 0) + (passOn(s) ? PASS_BAG : 0);
  function dropGear(s, foe, rng, events) {
    const r = rng || Math.random, f = s.floor, loot = 1 + campBonus(s, 'loot') + sk(s, 'loot');
    let it = null;
    if (f >= 20 && (foe.boss ? r() < 0.03 * loot : foe.chest ? r() < 0.008 * loot : false)) it = rollJobSet(s, f, r);
    else if (foe.boss) {
      if (f >= 15 && r() < 0.06 * loot) it = rollGear(s, f, { set: true }, r);
      else if (r() < 0.6 * loot) it = rollGear(s, f, { boost: 1 }, r);
    } else if (foe.chest) { if (r() < 0.4 * loot) it = rollGear(s, f, { boost: 0.5 }, r); }
    else if (foe.pack) { if (r() < (foe.elite ? 0.4 : 0.25) * loot) it = rollGear(s, f, { boost: 0.5 }, r); }
    else if (foe.elite) { if (r() < 0.15 * loot) it = rollGear(s, f, { boost: 0.5 }, r); }
    else if (r() < 0.012 * loot) it = rollGear(s, f, null, r);
    if (!it) return;
    if (packCount(s) >= bagCap(s)) {
      // full bag: the lowest value common item gets sold automatically
      const worst = s.bag.filter(x => x.rar === 'common' && !wearer(s, x.uid)).sort((a, b) => gearPct(a) - gearPct(b))[0];
      if (worst && gearPct(worst) < gearPct(it)) { s.bag = s.bag.filter(x => x !== worst); s.gold += salvageValue(worst); }
      else { s.gold += salvageValue(it); events && events.push({ type: 'autosell', item: it }); return; }
    }
    s.bag.push(it);
    if (it.set) { s.lore['set_' + it.set] = Date.now(); }
    events && events.push({ type: 'loot', item: it });
  }
  function equipped(s, id) { return (s.gear[id] || {}); }
  function itemOf(s, uid) { return s.bag.find(x => x.uid === uid); }
  function wornAt(s, uid) { for (const id in s.gear) for (const p in s.gear[id]) if (s.gear[id][p] === uid) return [id, p]; return null; }
  function wearer(s, uid) { const w = wornAt(s, uid); return w ? w[0] : null; }
  const wornPos = (s, uid) => { const w = wornAt(s, uid); return w ? w[1] : null; };
  const reqLevel = it => Math.max(1, Math.floor(it.ilvl * 1.5));
  const canWear = (s, id, it) => lvl(s, id) >= reqLevel(it);
  // Kindling unlocks, per character.
  const unlocksOf = (s, id) => (s.unlocks && s.unlocks[id]) || { rings: 0, neck2: 0 };
  function openPos(s, id) {
    const u = unlocksOf(s, id);
    return POS.filter(p => p === 'neck2' ? u.neck2 : p.slice(0, 4) === 'ring' ? +p[4] <= 1 + u.rings : true);
  }
  const robeOn = (s, id) => { const c = equipped(s, id).chest, it = c && itemOf(s, c); return !!(it && it.slot === 'robe'); };
  function equip(s, id, uid, pos) {
    const it = itemOf(s, uid); if (!it) return false;
    const m = memberById(id); if (!m || m.guest || m.cls !== it.cls || !canWear(s, id, it)) return false;
    const open = openPos(s, id).filter(p => fitsPos(it.slot, p));
    if (pos && !open.includes(pos)) return false;
    const g = s.gear[id] = s.gear[id] || {};
    if (!pos) {
      const cur = wornAt(s, uid); if (cur && cur[0] === id) return true;
      pos = open.find(p => !g[p]) || open.slice().sort((a, b) => gearPct(itemOf(s, g[a])) - gearPct(itemOf(s, g[b])))[0];
    }
    if (!pos) return false;
    const before = maxHpOf(s, id);
    const prev = wornAt(s, uid); if (prev) delete s.gear[prev[0]][prev[1]];
    g[pos] = uid;
    if (it.slot === 'robe') delete g.legs;
    if (it.slot === 'legs' && robeOn(s, id)) delete g.chest;
    if (s.hp[id] != null && !s.down[id]) s.hp[id] = Math.max(1, s.hp[id] + maxHpOf(s, id) - before);
    return true;
  }
  // What equipping this item would take off (for comparisons).
  function replaces(s, id, it) {
    const g = equipped(s, id), open = openPos(s, id).filter(p => fitsPos(it.slot, p));
    if (it.slot === 'robe') return ['chest', 'legs'].map(p => g[p] && itemOf(s, g[p])).filter(Boolean);
    if (it.slot === 'legs' && robeOn(s, id)) return [itemOf(s, g.chest)];
    if (open.some(p => !g[p])) return [];
    const worst = open.map(p => itemOf(s, g[p])).filter(Boolean).sort((a, b) => gearPct(a) - gearPct(b))[0];
    return worst ? [worst] : [];
  }
  function unequip(s, id, pos) { if (s.gear[id]) delete s.gear[id][pos]; }
  const upgradeCost = it => foeGold(Math.max(1, it.ilvl), false) * 25 * Math.pow(1.7, it.up) * (it.rar === 'set' ? 2 : 1);
  const UP_MAX = 10;
  function upgrade(s, uid) {
    const it = itemOf(s, uid); if (!it || it.up >= UP_MAX) return false;
    const c = upgradeCost(it); if (c > s.gold) return false;
    s.gold -= c; it.up++; return true;
  }
  const salvageValue = it => foeGold(Math.max(1, it.ilvl), false) * 3 * (1 + RARITY.findIndex(r => r.id === it.rar)) * (1 + it.up);
  function salvage(s, uid) {
    const it = itemOf(s, uid); if (!it) return 0;
    const w = wornAt(s, uid); if (w) delete s.gear[w[0]][w[1]];
    s.bag = s.bag.filter(x => x !== it);
    const v = salvageValue(it); s.gold += v; return v;
  }
  // The best kit a member could wear from their own gear and unworn pack items: { pos: item }.
  function bestKit(s, id) {
    const m = memberById(id); if (!m || m.guest) return {};
    const pool = s.bag.filter(it => it.cls === m.cls && canWear(s, id, it) && (!wearer(s, it.uid) || wearer(s, it.uid) === id));
    const open = openPos(s, id), kit = {}, job = jobFree(s, id) && jobOf(s, id), jid = job && job.id;
    // a companion working a camp job keeps gear that helps that job
    const score = it => itemScore(it) + (jid && (it.jset === jid || (it.aff && it.aff.j === jid)) ? 10 : 0);
    const top = (type, n) => pool.filter(it => it.slot === type).sort((a, b) => score(b) - score(a)).slice(0, n);
    for (const t of ['main', 'off', 'head', 'feet', 'neck', 'ring']) {
      const ps = open.filter(p => posType(p) === t), best = top(t, ps.length), g = equipped(s, id);
      // keep items already in place where they stay in the top picks, fill the rest
      const keep = ps.filter(p => g[p] && best.some(b => b.uid === g[p]));
      const rest = best.filter(b => !keep.some(p => g[p] === b.uid));
      for (const p of keep) kit[p] = itemOf(s, g[p]);
      for (const p of ps) if (!kit[p] && rest.length) kit[p] = rest.shift();
    }
    const robe = top('robe', 1)[0], chest = top('chest', 1)[0], legs = top('legs', 1)[0];
    const split = (chest ? score(chest) : 0) + (legs ? score(legs) : 0);
    if (robe && score(robe) > split) kit.chest = robe; else { if (chest) kit.chest = chest; if (legs) kit.legs = legs; }
    return kit;
  }
  // Positions where the best kit differs from what is worn now.
  function betterFor(s, id) {
    const g = equipped(s, id), kit = bestKit(s, id), out = {};
    for (const p in kit) if (g[p] !== kit[p].uid) out[p] = kit[p];
    return out;
  }
  function equipBest(s, id) { const b = betterFor(s, id); let n = 0; for (const p in b) if (equip(s, id, b[p].uid, p)) n++; return n; }
  function setCount(s, id, setId) { const g = equipped(s, id); let n = 0; for (const p in g) { const it = itemOf(s, g[p]); if (it && it.set === setId) n++; } return n; }
  function setBonus(s, id) {
    const m = memberById(id); if (!m) return 0;
    const set = SETS.find(x => x.cls === m.cls); if (!set) return 0;
    return setCount(s, id, set.id);
  }
  // Total gear bonus for one stat, as a fraction (0.5 = +50%).
  function gearPctOf(s, id, kind) {
    const g = equipped(s, id), robe = robeOn(s, id); let pct = 0;
    for (const p in g) {
      if (p === 'legs' && robe) continue;
      const it = itemOf(s, g[p]); if (!it) continue;
      const w = weightOf(it);
      pct += gearPct(it) * (kind === 'hp' ? w.hp : w.dps);
    }
    return pct;
  }
  function gearMult(s, id, kind) {
    let pct = gearPctOf(s, id, kind);
    const n = setBonus(s, id), cls = memberById(id).cls;
    if (n >= 2) {
      if (kind === 'hp' && cls === 'tank') pct += 0.2;
      if (kind === 'heal' && cls === 'healer') pct += 0.25;
      if (kind === 'dps' && cls === 'mage') pct += 0.25;
    }
    return 1 + pct;
  }
  // ---------- Kindling ----------
  // Earned only by rekindling. Spent on the skill tree, bag space and extra gear slots.
  const bagUpCost = s => 1 + (s.bagUps || 0);
  function buyBag(s) {
    if ((s.bagUps || 0) >= BAG_UPS_MAX || s.kindling < bagUpCost(s)) return false;
    s.kindling -= bagUpCost(s); s.bagUps = (s.bagUps || 0) + 1; return true;
  }
  // Kindling upgrades: permanent account bonuses bought with Kindling. They are never refunded.
  const KINDLE_UPS = [
    { id: 'edge',    name: 'Lantern Edge',        desc: '+3% party damage per rank',                     per: 0.03, max: 5, base: 2, icon: 'sword' },
    { id: 'purse',   name: 'Ember Purse',         desc: '+5% gold per rank',                             per: 0.05, max: 5, base: 2, icon: 'coin' },
    { id: 'oil',     name: 'Deep Reservoir',      desc: '+3s lantern time against guardians per rank',   per: 3,    max: 5, base: 2, icon: 'lantern' },
    { id: 'watch',   name: 'Night Watch',         desc: 'Your party keeps earning 16 hours longer while you are away, per rank', per: 16 * 3600, max: 4, base: 2, icon: 'lantern' },
    { id: 'draught', name: 'Slow-burning Draught', desc: 'Campfire Draughts last 20s longer per rank',   per: 20,   max: 3, base: 1, icon: 'flame' },
    { id: 'sense',   name: 'Sigil Sense',         desc: '+0.01% chance per rank to find Sigils in chests and on guardians', per: 0.0001, max: 5, base: 3, icon: 'star' },
  ];
  const kup = (s, id) => { const u = KINDLE_UPS.find(x => x.id === id); return ((s.kup || {})[id] || 0) * u.per; };
  const kupCost = (s, id) => { const u = KINDLE_UPS.find(x => x.id === id), r = (s.kup || {})[id] || 0; return r >= u.max ? 0 : u.base + r * 2; };
  function buyKup(s, id) {
    const c = kupCost(s, id); if (!c || (s.kindling || 0) < c) return false;
    s.kindling -= c; s.kup = s.kup || {}; s.kup[id] = (s.kup[id] || 0) + 1; return true;
  }
  // Class change: a costly respec. Kindling spent on the skill tree comes back; everything else stays spent.
  const CLASS_CHANGE_COST = 15;
  function changeClass(s, cls) {
    if (!s.hero || !CLASSES[cls] || cls === s.hero.cls) return false;
    const pool = (s.kindling || 0) + skillSpent(s);
    if (pool < CLASS_CHANGE_COST) return false;
    s.kindling = pool - CLASS_CHANGE_COST; s.skills = {};
    s.gear.you = {}; // old-class gear goes back to the pack
    for (const k in s.abil) if (k === 'you' || k.startsWith('you:')) delete s.abil[k];
    s.hero.cls = cls; registerHero(s);
    s.hp.you = maxHpOf(s, 'you'); delete s.down.you;
    return true;
  }
  // kind 'ring' opens the next ring (2 to 5), 'neck2' opens the second trinket.
  function unlockCost(s, id, kind) { const u = unlocksOf(s, id); return kind === 'neck2' ? (u.neck2 ? 0 : 3) : u.rings >= 4 ? 0 : u.rings + 1; }
  function unlockSlot(s, id, kind) {
    const m = memberById(id); if (!m || m.guest) return false;
    const c = unlockCost(s, id, kind); if (!c || s.kindling < c) return false;
    s.unlocks = s.unlocks || {}; const u = s.unlocks[id] = Object.assign({ rings: 0, neck2: 0 }, s.unlocks[id] || {});
    s.kindling -= c; if (kind === 'neck2') u.neck2 = 1; else u.rings++;
    return true;
  }

  // ---------- lore ----------
  const LORE = [
    { id: 'hold', title: 'The Hold', group: 'Places', text: 'An Iron Covenant fortress on a forgotten edge of the Shattered Reach, built around a lantern that has never gone out. The town calls its keepers Lampmothers. There has only ever been one.' },
    { id: 'reach', title: 'The Shattered Reach', group: 'The Grand War', text: 'Thirteen sectors broken apart when the Nyx Rift tore open. The Grand War is fought across all of them, sector by sector, for control of the Nexus at their heart.' },
    { id: 'rift', title: 'The Nyx Rift', group: 'The Grand War', text: 'The wound in the world that started the war. It bleeds a dark light that changes whatever it touches. One thin tear runs under the Hold, and the lantern sits on top of it like a cork.' },
    { id: 'nexus', title: 'The Nexus', group: 'The Grand War', text: 'The centre of the Reach, where the Rift’s power pools. Whoever holds the Nexus holds the war. Every alliance believes the Lantern Deep is a back door to it.' },
    { id: 'front', title: 'The Lantern Deep Front', group: 'The Grand War', text: 'The quietest front of the Grand War, because it is underground and nobody up top believes in it. The warbands down here know better.' },
    { id: 'war_covenant', title: 'The Iron Covenant', group: 'The Grand War', text: '"Hold the line." Soldiers who would seal the Rift forever, whatever it costs. Thessaly’s lantern is the most Covenant thing in the Reach. So is its price.' },
    { id: 'war_radiant', title: 'The Radiant Ascendancy', group: 'The Grand War', text: '"Rise beyond." Scholars and zealots who believe the Rift is a ladder. Their war-engines and choirs dig toward it from every side.' },
    { id: 'war_tide', title: 'The Devouring Tide', group: 'The Grand War', text: '"Everything feeds the Tide." Warbands that want the Rift wide open, so the dark can swallow the Reach and remake it. Most of what you fight down here once answered to them.' },
    { id: 'mercy', title: 'The Mercy Corps', group: 'The Grand War', text: 'Medics who cross every line in the war and fly no alliance’s banner. Moss wears their green. So did Grandmother Rot, once.' },
    { id: 'biome0', title: 'The Lamplit Cellars', group: 'Places', text: 'Once the Hold’s storerooms. Barrels of lamp oil still line the walls, though nobody remembers who keeps filling them. Tide scavengers have started to.' },
    { id: 'biome1', title: 'Mosswater Crypts', group: 'Places', text: 'The Hold buried its healers here, close to the lantern’s warmth. The moss grows thickest over the oldest graves, and Tide gravehounds dig them up.' },
    { id: 'biome2', title: 'The Glimmer Fungus Deep', group: 'Places', text: 'The fungus glows with stolen Rift-light. Spores carry memories: breathe deep and you may hear a stranger’s last thoughts. The Ascendancy harvests them.' },
    { id: 'biome3', title: 'Saltbone Galleries', group: 'Places', text: 'An underground sea dried here long ago. A Covenant company held the galleries to the last soldier. The salt kept them, standing at their posts.' },
    { id: 'biome4', title: 'The Cinder Forges', group: 'Places', text: 'Where the lantern’s glass and iron were made. The Ascendancy built war-engines in the same fires. The fires were never banked, only fed.' },
    { id: 'biome5', title: 'The Drowned Chapel', group: 'Places', text: 'An Ascendancy chapel to a god of thresholds, flooded when its bishop tried to pry the Rift open from below.' },
    { id: 'biome6', title: 'Hollow Roots', group: 'Places', text: 'The roots of a tree that grew downward toward the Rift, as if something below was the sun. The Tide nests in them.' },
    { id: 'biome7', title: 'The Starless Vault', group: 'Places', text: 'The bottom of every map, and the edge of the Rift itself. The maps are wrong.' },
    { id: 'biome8', title: 'The Glass Wastes', group: 'Places', text: 'Below the Vault the Rift-light cooled into glass, mile after mile of it. The Ascendancy calls it a mirror of heaven. Walk on it barefoot and it remembers your name.' },
    { id: 'biome9', title: 'The Ironbound Bastion', group: 'Places', text: 'A Covenant fortress sunk whole into the deep when the Rift opened, with its garrison still inside. The gates are shut from the inside. Someone is still bolting them.' },
    { id: 'biome10', title: 'The Weeping Aqueduct', group: 'Places', text: 'Covenant engineers built it to carry clean water to the Hold. The Tide reversed the flow. Now it carries everything that drowned upward, toward the light.' },
    { id: 'biome11', title: 'The Bone Orchard', group: 'Places', text: 'Trees grown from the Hollow Roots, fed on battlefields. Their fruit is pale and hard and hums when you hold it. Nobody who has tasted it says what it tastes like.' },
    { id: 'biome12', title: 'The Stormglass Spire', group: 'Places', text: 'An Ascendancy tower built downward, floor by floor, toward the Rift. Lightning runs up it instead of down. The choir at the top has not stopped singing in a century.' },
    { id: 'biome13', title: 'The Nexus Scar', group: 'Places', text: 'Where the three alliances first broke through to the Rift together, and turned on each other. The walls still carry the marks. So do the soldiers who never left.' },
    { id: 'biome14', title: 'The Rift Threshold', group: 'Places', text: 'The last landing before the Rift itself. The lantern’s light reaches this far and no further. Past here, the war does not have names for things.' },
    { id: 'g0', title: 'The Cellar Glutton', group: 'Guardians', text: 'A Tide war-beast left to guard the stair. It ate the oil, the barrels, and a courier carrying orders. Everything feeds the Tide, and the Glutton took that personally.' },
    { id: 'g1', title: 'Grandmother Rot', group: 'Guardians', text: 'Once the Mercy Corps healer of this front. The Tide did not kill her. It convinced her that rot was just another kind of mending.' },
    { id: 'g2', title: 'The Mycelial Choir', group: 'Guardians', text: 'An Ascendancy experiment: teach the Rift-fed spores to sing in unison, and see if the song opens doors. It did. Just not the right ones.' },
    { id: 'g3', title: 'Ossuary Prime', group: 'Guardians', text: 'The Covenant captain who held the Saltbone Galleries. Still holding them. Still does not know the war moved on.' },
    { id: 'g4', title: 'Furnace-Heart', group: 'Guardians', text: 'The greatest Ascendancy war-engine ever built, abandoned when it would not stop burning. Sir Ashe fought it for forty years without winning or losing.' },
    { id: 'g5', title: 'The Sunken Bishop', group: 'Guardians', text: 'He drowned his own chapel to reach the Rift. He is still praying. The water carries the words a long way down.' },
    { id: 'g6', title: 'The Root Mother', group: 'Guardians', text: 'Before the Tide reached her she mended anything that bled. Now she feeds the dark with whatever wanders into her roots.' },
    { id: 'g7', title: 'The Unlit', group: 'Guardians', text: 'The Nyx Rift’s breath, held under the lantern. It does not hate the light. It has simply never been allowed any.' },
    { id: 'g8', title: 'The Glass Regent', group: 'Guardians', text: 'The Ascendancy’s first saint, who walked into the Rift-glass to become a window. He became a wall instead, and every ward he raises is a prayer that did not land.' },
    { id: 'g9', title: 'Marshal Ironvow', group: 'Guardians', text: 'He swore the Bastion would never fall. It did not fall. It sank, and he held it all the way down. His blade still swings at whoever stands behind you.' },
    { id: 'g10', title: 'The Brine Matriarch', group: 'Guardians', text: 'Mother of every eel in the aqueduct, and most of the things that eat them. Cut her and the water closes the wound.' },
    { id: 'g11', title: 'The Orchard Keeper', group: 'Guardians', text: 'The first bearer Thessaly ever planted, grown into the trees he was buried under. He tends the others now. His shears are coated in sap that does not wash off.' },
    { id: 'g12', title: 'The Ascendant Prism', group: 'Guardians', text: 'What the Spire’s choir sings to. A living lens that splits a single strike into a dozen. It is very fast, and it is very proud of it.' },
    { id: 'g13', title: 'The Threefold Warhost', group: 'Guardians', text: 'A Covenant shield, a Radiant lance and a Tide maw, fused at the Scar into one soldier. It fights harder the closer it comes to losing, because it has lost before.' },
    { id: 'g14', title: 'The Lampmother', group: 'Guardians', text: 'Old Thessaly, at the root of her own seal, younger than she has looked in a hundred years. There has only ever been one Lampmother. She fed every bearer before you to keep it that way.' },
    { id: 'foe_slime', title: 'Gloops', group: 'Bestiary', text: 'Lamp oil left too long near the Rift grows hungry. Gloops are what it becomes. Harmless alone, ruinous in barrels.' },
    { id: 'foe_rat', title: 'Gnawers', group: 'Bestiary', text: 'The Hold’s rats went down for the oil and came back up bigger. The Tide uses them as scouts now.' },
    { id: 'foe_bat', title: 'Flitterwings', group: 'Bestiary', text: 'Drawn to any light. A lantern-bearer learns to love them, because they always fly toward the way out.' },
    { id: 'foe_skeleton', title: 'Rattlebones', group: 'Bestiary', text: 'Most wear the tatters of lantern-bearer coats or Covenant iron. Vael says they are not angry. They are lost.' },
    { id: 'foe_eye', title: 'Watchers', group: 'Bestiary', text: 'Nobody has seen a Watcher blink. Moss thinks they report to the Ascendancy. Kestrel thinks Moss worries too much.' },
    { id: 'foe_shroom', title: 'Caplings', group: 'Bestiary', text: 'They walk on their roots and sing in a pitch only the dead can hear. The Choir is what happens when enough of them agree.' },
    { id: 'foe_ghost', title: 'Wisps', group: 'Bestiary', text: 'A wisp is the warmth a person leaves behind. The Pale Oracle says she can tell whose by the colour.' },
    { id: 'foe_shard', title: 'Glass Crawlers', group: 'Bestiary', text: 'Splinters of Rift-glass that learned to walk. They reflect the light you carry and throw it back as a ward.' },
    { id: 'foe_sentinel', title: 'Iron Husks', group: 'Bestiary', text: 'Empty Covenant armour, still on patrol. They swing wide, as they were drilled to, and hit whoever stands beside you too.' },
    { id: 'foe_eel', title: 'Sluice Eels', group: 'Bestiary', text: 'They swim up the aqueduct against the current. A cut eel knits itself shut if you let it rest.' },
    { id: 'foe_thorn', title: 'Thornlings', group: 'Bestiary', text: 'Seedlings of the Bone Orchard that walked away from their trees. Their barbs carry a slow venom that keeps working after the fight.' },
    { id: 'foe_prism', title: 'Storm Lenses', group: 'Bestiary', text: 'Shards of the Spire that caught a lightning stroke and kept it. They strike before you see them move.' },
    { id: 'foe_hound', title: 'Rift Hounds', group: 'Bestiary', text: 'Bred by no alliance, followed by all of them. Wounding one only makes it angry.' },
    { id: 'foe_riftling', title: 'Riftlings', group: 'Bestiary', text: 'Small pieces of the Rift that wandered up toward the lantern. They are curious. They are also very hard to hurt.' },
    { id: 'foe_chest', title: 'Treasure Chests', group: 'Bestiary', text: 'Lantern-bearers stashed supplies for whoever came next. Some chests are still waiting for the right hands.' },
    { id: 'boss', title: 'Guardians', group: 'Bestiary', text: 'Every fifth landing has something that will not move. The old maps call them guardians. The bones call them jailers.' },
    { id: 'set_vigil', title: "Gravewarden's Vigil", group: 'Relics of the Bearers', text: SETS[0].lore },
    { id: 'set_grace', title: "Rootmother's Grace", group: 'Relics of the Bearers', text: SETS[1].lore },
    { id: 'set_night', title: "Kestrel's Night", group: 'Relics of the Bearers', text: SETS[2].lore },
    { id: 'set_regalia', title: 'Ashcombe Regalia', group: 'Relics of the Bearers', text: SETS[3].lore },
    { id: 'set_crown', title: 'The Hollow Crown', group: 'Relics of the Bearers', text: SETS[4].lore },
    { id: 'thessaly', title: 'Old Thessaly', group: 'People', text: 'Lampmother of the Hold and the Iron Covenant’s oldest warden, for as long as anyone can remember. Longer, if you check the records.' },
  ];
  // Story beats that also open journal pages.
  const STORY_LORE = { intro: ['thessaly', 'biome0', 'reach', 'rift', 'front'], moss: ['mercy'], glutton: ['war_tide'], wren: ['war_radiant', 'nexus'], bones: ['war_covenant'] };
  function unlockLore(s, id, events) {
    if (!LORE.find(l => l.id === id) || s.lore[id]) return;
    s.lore[id] = Date.now();
    events && events.push({ type: 'lore', id });
  }

  // ---------- party management ----------
  function recruit(s, id) {
    if (s.unlocked.includes(id)) return false;
    s.unlocked.push(id);
    if (!s.levels[id]) s.levels[id] = 1;
    const slot = s.party.indexOf(null);
    if (slot >= 0) { s.party[slot] = id; if (!s.formationManual) autoFormation(s); }
    s.hp[id] = maxHpOf(s, id);
    return true;
  }
  function seat(s, id, slot) {
    if (!s.unlocked.includes(id) && !isGuest(s, id)) return false;
    if (s.jobs) for (const k in s.jobs) if (s.jobs[k] === id) delete s.jobs[k]; // leaves their camp job
    if (s.party[slot] === 'you' && id !== 'you') return false; // your hero is never benched
    const cur = s.party.indexOf(id);
    if (cur >= 0) s.party[cur] = s.party[slot];
    s.party[slot] = id;
    if (s.hp[id] == null) s.hp[id] = maxHpOf(s, id);
    return true;
  }
  function unseat(s, slot) { if (s.party[slot] !== 'you') s.party[slot] = null; }
  // ---------- formation ----------
  // Seat order is the marching order: slot 0 stands at the front, nearest the foe; slot 4 is the rear.
  const FORMATION = { tank: 0, rogue: 1, healer: 2, mage: 3, necro: 4 };
  const POS_NAME = ['Front', 'Second', 'Middle', 'Fourth', 'Rear'];
  function moveMember(s, from, to) {
    if (to < 0 || to >= PARTY_SIZE || from === to) return false;
    const t = s.party[to]; s.party[to] = s.party[from]; s.party[from] = t; s.formationManual = true; return true;
  }
  function autoFormation(s) {
    const seated = s.party.filter(Boolean).sort((a, b) => FORMATION[memberById(a).cls] - FORMATION[memberById(b).cls]);
    s.party = seated.concat(Array(PARTY_SIZE - seated.length).fill(null));
  }
  // Healing falls off with distance between healer and patient: 15% per step, never below 40%.
  const healReach = (s, a, b) => Math.max(0.4, 1 - 0.15 * Math.abs(s.party.indexOf(a) - s.party.indexOf(b)));
  function formationNotes(s) {
    const live = s.party.map((id, i) => id && { id, i, cls: memberById(id).cls }).filter(Boolean);
    const out = [];
    const tank = live.find(x => x.cls === 'tank');
    if (!tank) out.push({ warn: true, text: 'No tank: monsters hit whoever stands in front.' });
    else if (live.indexOf(tank) > 1) out.push({ warn: true, text: memberById(tank.id).name + ' is too far back to hold the monsters’ attention. Move your tank to the front.' });
    else out.push({ text: memberById(tank.id).name + ' holds the front and draws the attacks.' });
    for (const h of live.filter(x => x.cls === 'healer')) {
      const far = Math.max(...live.map(x => Math.abs(x.i - h.i)));
      out.push({ warn: far >= 4, text: memberById(h.id).name + (far >= 3 ? ' is far from part of the line. Heals on the far end drop to ' + Math.round(Math.max(0.4, 1 - 0.15 * far) * 100) + '%.' : ' can reach everyone in the line well.') });
    }
    const rear = live[live.length - 1];
    if (rear && live.length > 1) out.push(rear.cls === 'tank' ? { text: memberById(rear.id).name + ' guards the rear against ambushes.' } : { warn: rear.cls === 'healer' || rear.cls === 'mage', text: memberById(rear.id).name + ' takes the first blows when monsters ambush from behind.' });
    return out;
  }



  // ---------- camp jobs ----------
  // Companions resting at the campfire can take a job that helps the whole party. The bonus grows
  // with the companion's level (square root), and half again when the job suits their class.
  const JOBS = [
    { id: 'forage', name: 'Forager', stat: 'loot', aff: 'rogue', base: 0.03, icon: 'bag', fmt: 'more gear drops', desc: 'Scours the floors behind the party for anything worth carrying.' },
    { id: 'smith', name: 'Runesmith', stat: 'dps', aff: 'mage', base: 0.02, icon: 'hammer', fmt: 'party damage', desc: 'Etches the party’s weapons with Rift-glass runes.' },
    { id: 'herb', name: 'Herbalist', stat: 'heal', aff: 'healer', base: 0.02, icon: 'leaf', fmt: 'healing', desc: 'Brews poultices from the cavern moss.' },
    { id: 'armor', name: 'Armorer', stat: 'hp', aff: 'tank', base: 0.02, icon: 'shield', fmt: 'party health', desc: 'Hammers dents out of shields and straps on spare plate.' },
    { id: 'prospect', name: 'Prospector', stat: 'gold', aff: 'rogue', base: 0.025, icon: 'coin', fmt: 'gold', desc: 'Pans the underground streams for coin the dead left behind.' },
    { id: 'lamp', name: 'Lamplighter', stat: 'lamp', aff: 'necro', base: 0.35, icon: 'lamp', fmt: 'lantern oil per guardian', desc: 'Trims the wick and rations the oil.' },
  ];
  // Extra job output from what a companion wears: job affixes plus a job set.
  function jobGear(s, id, jid) {
    const g = equipped(s, id); let v = 0, n = 0;
    for (const p in g) { const it = itemOf(s, g[p]); if (!it) continue; if (it.aff && it.aff.j === jid) v += it.aff.v * (1 + 0.1 * it.up); if (it.jset === jid) n++; }
    return v + (n >= 3 ? JOB_SET_THREE : n >= 2 ? JOB_SET_TWO : 0);
  }
  const jobSetCount = (s, id, jid) => { const g = equipped(s, id); let n = 0; for (const p in g) { const it = itemOf(s, g[p]); if (it && it.jset === jid) n++; } return n; };
  function jobValue(s, job, id) {
    const m = memberById(id); if (!m) return 0;
    const tr = s.traits && s.traits[id] && s.traits[id].camp.k === 'job' ? s.traits[id].camp.v : 0;
    return job.base * Math.sqrt(Math.max(1, lvl(s, id))) * (m.cls === job.aff ? 1.5 : 1) * (1 + (m.tier || 0)) * (1 + jobGear(s, id, job.id)) * (1 + tr);
  }
  const jobFree = (s, id) => id && id !== 'you' && s.unlocked.includes(id) && !s.party.includes(id) && !isGuest(s, id);
  function campBonus(s, stat) {
    if (!s.jobs) return 0;
    let v = 0;
    for (const j of JOBS) if (j.stat === stat) { const id = s.jobs[j.id]; if (jobFree(s, id)) v += jobValue(s, j, id); }
    return v;
  }
  function jobOf(s, id) { for (const k in (s.jobs || {})) if (s.jobs[k] === id) return JOBS.find(j => j.id === k); return null; }
  function assignJob(s, id, jobId) {
    s.jobs = s.jobs || {};
    for (const k in s.jobs) if (s.jobs[k] === id) delete s.jobs[k];
    if (!jobId) return true;
    if (!JOBS.some(j => j.id === jobId) || !jobFree(s, id)) return false;
    s.jobs[jobId] = id; return true;
  }
  const jobText = (job, v) => job.stat === 'lamp' ? '+' + v.toFixed(1) + 's ' + job.fmt : '+' + Math.round(v * 100) + '% ' + job.fmt;

  // ---------- camp, store and consumables ----------
  // Party changes (swapping, recruiting, training companions, gear) only happen at camp: floor 1,
  // or anywhere while a Campfire Draught burns.
  const CAMP_FLOOR = 1, DRAUGHT_TIME = 60, OIL_TIME = 15;
  const atCamp = (s, now) => s.floor <= CAMP_FLOOR || (s.campUntil || 0) > (now || Date.now());
  const campLeft = (s, now) => Math.max(0, ((s.campUntil || 0) - (now || Date.now())) / 1000);
  const SHOP = [
    { id: 'draught', name: 'Campfire Draught', icon: 'flame', desc: 'Drink it anywhere to make camp for ' + DRAUGHT_TIME + ' seconds. Swap companions, recruit players, train and change gear without the walk back up.' },
    { id: 'oil', name: 'Flask of Lantern Oil', icon: 'oil', desc: 'Pour it during a guardian fight for ' + OIL_TIME + ' more seconds before the lantern gutters.' },
  ].concat(TONICS);
  function shopPrice(s, id) {
    const income = offlineGoldPerSec(s) * 60;
    const t = tonicById(id);
    if (t) return Math.max(60, Math.round(income * t.mult));
    return Math.max(id === 'draught' ? 40 : 25, Math.round(income * (id === 'draught' ? 2 : 1.5)));
  }
  // The walk back up to camp has a price: free in the first ten floors, then a few minutes of income that grows with depth.
  const CAMP_FREE_FLOOR = 10;
  function campCost(s) {
    if (s.floor <= CAMP_FREE_FLOOR) return 0;
    return Math.max(30, Math.round(offlineGoldPerSec(s) * 60 * (2.5 + s.floor / 60)));
  }
  function buyShop(s, id, n) {
    n = n || 1; const c = shopPrice(s, id) * n;
    if (!SHOP.some(x => x.id === id) || c > s.gold) return false;
    s.gold -= c; s.items = s.items || {}; s.items[id] = (s.items[id] || 0) + n; return true;
  }
  function useDraught(s, now) {
    now = now || Date.now();
    if (!s.items || !(s.items.draught > 0)) return false;
    s.items.draught--; s.campUntil = Math.max(now, s.campUntil || 0) + (DRAUGHT_TIME + kup(s, 'draught')) * 1000; return true;
  }
  function useOil(s) {
    if (!s.foe || !isBossFloor(s.floor) || !s.items || !(s.items.oil > 0) || s.lantern <= 0) return false;
    s.items.oil--; s.lantern = Math.max(0, s.lantern - OIL_TIME); return true;
  }

  // ---------- setup and guests ----------
  function startGame(s, mode, cls, name, side) {
    s.mode = 'multi'; s.hero = { cls, name, side: SIDES[side] ? side : 'unsworn' };
    if (s.hero.side !== 'unsworn' && s.hero.side !== 'mercy') s.lore['war_' + s.hero.side] = Date.now();
    if (s.hero.side === 'mercy') s.lore.mercy = Date.now();
    registerHero(s);
    s.levels.you = 1; s.party[0] = 'you'; if (!s.unlocked.includes('you')) s.unlocked.unshift('you'); s.hp.you = maxHpOf(s, 'you');
  }
  function addGuest(s, g) {
    // g: { id, name, cls, level } from the hero board
    if (s.mode !== 'multi') return false;
    s.guests = (s.guests || []).filter(x => x.id !== g.id);
    s.guests.push({ id: g.id, name: g.name, cls: g.cls, side: SIDES[g.side] ? g.side : null, level: Math.max(1, Math.floor(g.level)), at: Date.now() });
    registerHero(s);
    const slot = s.party.indexOf(null);
    if (slot >= 0) s.party[slot] = g.id;
    s.hp[g.id] = maxHpOf(s, g.id);
    return true;
  }
  function dismissGuest(s, id) {
    s.guests = (s.guests || []).filter(x => x.id !== id);
    s.party = s.party.map(x => x === id ? null : x);
    delete s.hp[id]; delete dyn[id];
  }
  function train(s, id, n) {
    if (!s.unlocked.includes(id) || isGuest(s, id)) return false;
    if (n === 'max') n = maxAffordable(s, id);
    if (n <= 0) return false;
    const c = trainCost(s, id, n);
    if (c > s.gold) return false;
    const before = maxHpOf(s, id);
    s.gold -= c; s.levels[id] = lvl(s, id) + n;
    if (!s.down[id]) s.hp[id] = Math.min(maxHpOf(s, id), (s.hp[id] || before) + (maxHpOf(s, id) - before));
    return true;
  }
  const alive = s => s.party.filter(id => id && !s.down[id] && lvl(s, id));

  // ---------- foes ----------
  const PACK_CHANCE = 0.03, PACK_FLOOR = 3, PACK_GOLD = 2;
  function makeFoe(s, rng) {
    const f = s.floor, boss = isBossFloor(f), r = rng || Math.random;
    if (!boss) {
      if (s.goblin && s.goblin.item && f >= s.goblin.floor) return goblinFoe(s, true);
      if (!s.goblin && f >= GOBLIN_FLOOR && r() < GOBLIN_CHANCE && s.bag.some(it => !wearer(s, it.uid))) return goblinFoe(s, false);
    }
    const chest = !boss && r() < chestChance(s);
    const b = biomeOf(f);
    let sprite, name;
    if (boss) {
      sprite = BOSS_SPRITES[Math.floor(f / BOSS_EVERY) % BOSS_SPRITES.length];
      name = (f % 10 === 0) ? b.boss : ['Stone Sentinel', 'Tunnel Wyrm', 'Bone Hierarch'][BOSS_SPRITES.indexOf(sprite)];
    } else if (chest) { sprite = 'chest'; name = 'Treasure Chest'; }
    else { const fo = b.foe && r() < 0.55 ? b.foe : FOES[Math.floor(r() * FOES.length)]; sprite = fo.id; name = b.adj[Math.floor(r() * b.adj.length)] + ' ' + fo.name; }
    // Grand War warbands: soldiers of the alliances fighting over the Rift.
    const elite = !boss && !chest && f >= 4 && r() < ELITE_CHANCE;
    let side = null;
    if (elite) { side = b.war.side; name = b.war.units[Math.floor(r() * b.war.units.length)]; sprite = ['skeleton', 'ghost', 'eye'][Math.floor(r() * 3)]; }
    const hp = foeHp(f, boss) * (chest ? 0.5 : elite ? 2.5 : 1);
    // Some foes sneak up and hit the back of the line first.
    let ambush = !boss && !chest && f >= 6 && r() < (elite ? 0.3 : 0.1) ? 2 : 0;
    // Ambush encounter: now and then a few monsters team up and jump the party. Tougher, but the spoils are rich.
    const pack = !boss && !chest && f >= PACK_FLOOR && r() < PACK_CHANCE ? 2 + Math.floor(r() * 3) : 0;
    let hpx = hp;
    if (pack) { hpx = hp * pack * 0.85; ambush = 2; }
    const mods = chest ? [] : rollMods(f, boss, elite, b, r);
    return { name, sprite, boss, chest, elite, side, ambush, pack, hp: hpx, max: hpx, hue: elite ? b.hue + 40 : b.hue, atk: chest ? 0 : foeDps(f, boss) * FOE_SWING * (elite ? 1.3 : 1) * (pack ? 1 + 0.3 * (pack - 1) : 1) * (mods.includes('swift') ? 1.35 : 1), mods, ward: 0, wardAt: 0 };
  }
  // Loot Goblin: a rare thief that fights back. Kill it before it flees, or it runs off with one unworn item from the pack
  // and hides a few floors deeper. Find it there and kill it to win the item back. Worn gear is never taken.
  const GOBLIN_FLOOR = 8, GOBLIN_CHANCE = 0.006, GOBLIN_TIME = 20, GOBLIN_GOLD = 6;
  const goblinHide = (s, r) => { const f = s.floor + 2 + Math.floor(r() * 4); return actTwoOpen() ? f : Math.min(ACT_ONE_END, f); };
  function goblinFoe(s, carrying) {
    // Tough enough that idle damage alone barely gets there in time: strikes and abilities make the difference.
    const f = s.floor, hp = Math.max(foeHp(f, false) * 3, totalDps(s, s.clock || Date.now()) * GOBLIN_TIME * 1.9);
    return { name: 'Loot Goblin', sprite: 'goblin', goblin: carrying ? 2 : 1, boss: false, chest: false, elite: false, side: null, ambush: 0, pack: 0, hp, max: hp, hue: 0, atk: foeDps(f, false) * FOE_SWING * 0.7, mods: [], ward: 0, wardAt: 0, flee: 0 };
  }
  // Picks what the goblin grabs: any unworn item, better ones more likely.
  function goblinGrab(s, r) {
    const pool = s.bag.filter(it => !wearer(s, it.uid)); if (!pool.length) return null;
    const w = pool.map(it => 1 + 2 * Math.max(0, RARITY.findIndex(x => x.id === it.rar)));
    let x = r() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function goblinFlee(s, rng, events) {
    const r = rng || Math.random, foe = s.foe;
    let it = s.goblin && s.goblin.item;
    if (!it) { it = goblinGrab(s, r); if (it) s.bag = s.bag.filter(x => x !== it); }
    s.foe = null; s.foeSwing = 0;
    if (!it) { events && events.push({ type: 'goblinflee', item: null }); return; }
    s.goblin = { item: it, floor: goblinHide(s, r), at: Date.now() };
    s.stats.goblinRuns = (s.stats.goblinRuns || 0) + 1;
    events && events.push({ type: 'goblinflee', item: it, floor: s.goblin.floor, again: foe && foe.goblin === 2 });
  }
  function rollMods(f, boss, elite, b, r) {
    let n = boss ? (f >= 20 ? 1 : 0) + (f >= 60 ? 1 : 0) + (f >= 110 ? 1 : 0) : elite ? (f >= 30 ? 1 : 0) + (f >= 100 ? 1 : 0) : (f >= 40 && r() < Math.min(0.4, 0.08 + (f - 40) / 300) ? 1 : 0);
    const out = [];
    if (n && b.mod && r() < 0.6) { out.push(b.mod); n--; }
    while (n-- > 0) { const k = MOD_KEYS[Math.floor(r() * MOD_KEYS.length)]; if (!out.includes(k)) out.push(k); }
    return out;
  }

  function damageFoe(s, amount, now, rng, events) {
    let guard = 0;
    while (amount > 0 && guard++ < 60) {
      if (!s.foe) s.foe = makeFoe(s, rng);
      const foe = s.foe, mult = (foe.boss ? 1 + relicVal(s, 'lens') : 1) * (1 + fxOn(s, 'vuln', now || Date.now()));
      let dmg = amount * mult;
      if (foe.ward > 0) { const soak = Math.min(foe.ward, dmg); foe.ward -= soak; dmg -= soak; amount = dmg / mult; if (dmg <= 0) return; }
      if (dmg < foe.hp) { foe.hp -= dmg; drain(s, dmg); return; }
      amount -= foe.hp / mult; drain(s, foe.hp);
      killFoe(s, now, rng, events);
      if (s.foe && s.foe.boss) return;
    }
  }
  function drain(s, dmg) {
    // Necromancers turn a sliver of the party's damage into healing.
    const n = s.party.find(id => id && !s.down[id] && memberById(id).cls === 'necro');
    if (!n) return;
    healParty(s, dmg * CLASSES.necro.drain * 0.05, false);
  }

  // Sigils found in play: very rare, from treasure chests and guardians only. Sigil Sense and depth raise the odds a little.
  // The server caps how many found Sigils a player can bank per day (perks.js), so this stays a slow trickle.
  const SIGIL_CHEST = 0.0005, SIGIL_BOSS = 0.001, SIGIL_DEPTH = 0.0001, SIGIL_DROP_DAY = 15;
  const sigilLuck = s => kup(s, 'sense') + SIGIL_DEPTH * Math.min(5, Math.floor((s.maxFloorEver || 0) / 30));
  const sigilChance = (s, kind) => (kind === 'boss' ? SIGIL_BOSS : SIGIL_CHEST) + sigilLuck(s) + sk(s, 'sig');
  function dropSigils(s, foe, rng, events) {
    if (!foe.chest && !foe.boss) return;
    const r = rng || Math.random;
    if (r() >= sigilChance(s, foe.boss ? 'boss' : 'chest')) return;
    const n = 1 + Math.floor(r() * 3);
    s.sigPend = (s.sigPend || 0) + n; s.stats.sigils = (s.stats.sigils || 0) + n;
    events && events.push({ type: 'sigil', n, chest: !!foe.chest });
  }
  // Daily quests: three a day, the same for everyone, picked from the UTC date. Progress counts stats since the day began.
  const QUESTS = [
    { id: 'kills',  stat: 'kills',     n: 400, text: 'Defeat {n} monsters' },
    { id: 'boss',   stat: 'bossKills', n: 12,  text: 'Defeat {n} guardians' },
    { id: 'chests', stat: 'chests',    n: 10,  text: 'Open {n} treasure chests' },
    { id: 'crits',  stat: 'crits',     n: 150, text: 'Land {n} critical hits' },
    { id: 'clicks', stat: 'clicks',    n: 250, text: 'Strike {n} times with your lantern' },
  ];
  const QUEST_REWARD = 1, QUEST_BONUS = 2;
  const questDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
  function dailyQuests(day) {
    let h = 0; for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pool = QUESTS.slice(), out = [];
    for (let i = 0; i < 3; i++) { h = (h * 1103515245 + 12345) >>> 0; out.push(pool.splice(h % pool.length, 1)[0]); }
    return out;
  }
  // Rolls the quest log over at UTC midnight and returns today's quests with progress.
  function questState(s) {
    const day = questDay();
    if (!s.daily || s.daily.day !== day) s.daily = { day, base: Object.assign({}, s.stats), got: 0 };
    return dailyQuests(day).map((q, i) => { const have = Math.max(0, (s.stats[q.stat] || 0) - (s.daily.base[q.stat] || 0)); return { i, id: q.id, text: q.text.replace('{n}', q.n.toLocaleString('en-US')), have: Math.min(have, q.n), n: q.n, done: have >= q.n, got: !!(s.daily.got & (1 << i)) }; });
  }
  function killFoe(s, now, rng, events) {
    const foe = s.foe, f = s.floor;
    let g = foeGold(f, foe.boss) * goldMult(s);
    if (foe.chest) { g *= 10 * (1 + relicVal(s, 'tooth')); s.stats.chests++; }
    if (foe.elite) { g *= 3; unlockLore(s, 'war_' + foe.side, events); }
    if (foe.pack) { g *= foe.pack * PACK_GOLD * (1 + sk(s, 'spoils')); s.stats.packs = (s.stats.packs || 0) + 1; s.stats.kills += foe.pack - 1; }
    if (foe.goblin) {
      g *= GOBLIN_GOLD; s.stats.goblins = (s.stats.goblins || 0) + 1;
      const back = foe.goblin === 2 && s.goblin && s.goblin.item;
      if (back) { s.bag.push(back); s.goblin = null; }
      events && events.push({ type: 'goblinkill', item: back || null });
    }
    s.gold += g; s.stats.goldEarned += g; s.stats.kills++;
    gainXp(s, foe, events);
    events && events.push({ type: 'kill', gold: g, foe });
    unlockLore(s, foe.boss ? 'boss' : 'foe_' + foe.sprite, events);
    if (foe.boss && f % 10 === 0) unlockLore(s, 'g' + (Math.floor((f - 1) / 10) % BIOMES.length), events);
    dropGear(s, foe, rng, events);
    dropSigils(s, foe, rng, events);
    s.foe = null; s.foeSwing = 0;
    if (foe.boss) {
      s.stats.bossKills++;
      const firstClear = f >= s.maxFloorEver - 1;
      const chance = f < 10 ? 0 : (firstClear ? 0.35 : 0.03);
      const r = rng || Math.random;
      if (r() < chance) {
        const rel = RELICS[Math.floor(r() * RELICS.length)];
        s.relics[rel.id] = (s.relics[rel.id] || 0) + 1;
        events && events.push({ type: 'relic', relic: rel, level: s.relics[rel.id] });
      }
      clearFloor(s, events, true);
    } else {
      s.foeIdx++;
      if (s.foeIdx >= FOES_PER_FLOOR) clearFloor(s, events, false);
    }
  }

  function clearFloor(s, events, boss) {
    // Past the end of Act One the way is sealed until Season 2.
    if (s.floor >= ACT_ONE_END && !actTwoOpen()) {
      if (s.floor >= s.maxFloor) { s.maxFloor = Math.max(s.maxFloor, ACT_ONE_END + 1); if (s.maxFloor > s.maxFloorEver) { s.maxFloorEver = s.maxFloor; events && events.push({ type: 'newfloor', floor: s.maxFloor }); } }
      s.lantern = 0; s.foeIdx = 0; healParty(s, 0.3, true); events && events.push({ type: 'sealed' });
      return;
    }
    if (s.floor >= s.maxFloor) {
      s.maxFloor = s.floor + 1;
      if (s.maxFloor > s.maxFloorEver) { s.maxFloorEver = s.maxFloor; events && events.push({ type: 'newfloor', floor: s.maxFloor }); }
      unlockLore(s, 'biome' + (Math.floor((s.maxFloor - 1) / 10) % BIOMES.length), events);
    }
    s.lantern = 0; s.foeIdx = 0;
    healParty(s, 0.3, true); // a breather between floors
    if (s.autoAdvance || boss) s.floor++;
  }

  function gotoFloor(s, f) {
    f = Math.max(1, Math.min(s.maxFloor, f, actTwoOpen() ? Infinity : ACT_ONE_END));
    s.floor = f; s.foeIdx = 0; s.foe = null; s.lantern = 0; s.foeSwing = 0;
  }

  function healParty(s, amount, isFraction) {
    for (const id of s.party) {
      if (!id || s.down[id]) continue;
      const mx = maxHpOf(s, id);
      s.hp[id] = Math.min(mx, (s.hp[id] || 0) + (isFraction ? mx * amount : amount));
    }
  }

  function pickTarget(s, rng) {
    const live = s.party.filter(id => id && !s.down[id]);   // in marching order, front first
    if (!live.length) return null;
    const r = rng || Math.random, foe = s.foe;
    // Ambush: the first blows land on the back of the line.
    if (foe && foe.ambush > 0) return { id: live[live.length - 1], behind: true };
    // A tank in the front two holds the monsters' attention.
    const ti = live.findIndex(id => memberById(id).cls === 'tank');
    if (ti >= 0 && ti <= 1) return { id: live[ti] };
    if (s.minions.some(m => m.hp > 0)) return { id: 'minion' };
    // Otherwise the front of the line takes most of the hits.
    const W = [0.5, 0.25, 0.13, 0.08, 0.04], w = live.map((_, i) => W[i]), tot = w.reduce((x, y) => x + y, 0);
    let x = r() * tot; for (let i = 0; i < live.length; i++) { x -= w[i]; if (x <= 0) return { id: live[i] }; }
    return { id: live[0] };
  }

  function foeAttack(s, now, rng, events) {
    const foe = s.foe; if (!foe || !foe.atk) return;
    const pick = pickTarget(s, rng);
    if (!pick) return;
    const t = pick.id;
    let dmg = foe.atk;
    const mods = foe.mods || [];
    if (mods.includes('enrage') && foe.hp < foe.max * 0.3) dmg *= 1.8;
    if (pick.behind) {
      foe.ambush--;
      const guard = memberById(t).cls === 'tank';
      if (!guard) dmg *= 1.6;
      events && events.push({ type: 'ambush', target: t, guarded: guard, first: foe.ambush === 1 });
    }
    if (t === 'minion') {
      const m = s.minions.find(x => x.hp > 0); m.hp -= dmg;
      events && events.push({ type: 'foehit', target: 'minion', dmg });
      return;
    }
    const m = memberById(t), c = CLASSES[m.cls];
    if (c.dodge && (rng || Math.random)() < c.dodge + (setBonus(s, t) >= 2 ? 0.1 : 0) + (t === 'you' ? sk(s, 'dodge') : 0)) { events && events.push({ type: 'dodge', target: t }); return; }
    if (c.armor) dmg *= 1 - c.armor;
    if (m.cls === 'tank' && abilityActive(s, t, now)) dmg *= 0.3 * (t === 'you' ? 1 - sk(s, 'power') : 1);
    dmg *= 1 - Math.min(0.5, sk(s, 'guard'));
    dmg *= 1 - fxOn(s, 'shield', now);
    s.hp[t] = (s.hp[t] == null ? maxHpOf(s, t) : s.hp[t]) - dmg;
    events && events.push({ type: 'foehit', target: t, dmg, behind: !!pick.behind });
    if (mods.includes('venom')) { s.poison = s.poison || {}; s.poison[t] = { dps: dmg * 0.12, until: now + 5000 }; events && events.push({ type: 'poison', id: t }); }
    if (mods.includes('cleave')) {
      const live = s.party.filter(id => id && !s.down[id]), nx = live[live.indexOf(t) + 1];
      if (nx) { s.hp[nx] = (s.hp[nx] == null ? maxHpOf(s, nx) : s.hp[nx]) - dmg * 0.4; if (s.hp[nx] <= 0) { s.hp[nx] = 0; s.down[nx] = now + REVIVE_TIME * 1000; events && events.push({ type: 'fall', id: nx }); } }
    }
    if (s.hp[t] <= 0) {
      s.hp[t] = 0; s.down[t] = now + REVIVE_TIME * 1000;
      events && events.push({ type: 'fall', id: t });
      if (!alive(s).length) wipe(s, now, events);
    }
  }

  function wipe(s, now, events) {
    s.stats.wipes++;
    events && events.push({ type: 'wipe', name: s.foe ? s.foe.name : '' });
    for (const id of s.party) if (id) { delete s.down[id]; s.hp[id] = maxHpOf(s, id) * 0.6; }
    s.minions = [];
    s.autoAdvance = false; s.retryAt = now + RETRY_AFTER * 1000;
    gotoFloor(s, Math.max(1, s.floor - 1));
  }

  function castAbility(s, id, now, events) {
    if (!id || s.down[id] || !lvl(s, id)) return false;
    const m = memberById(id), c = CLASSES[m.cls], ab = c.ability;
    const st = s.abil[id] || { readyAt: 0, until: 0 };
    if (st.readyAt > now) return false;
    const sb = setBonus(s, id), me = id === 'you', pw = me ? 1 + sk(s, 'power') : 1;
    st.readyAt = now + ab.cd * 1000 * (m.cls === 'rogue' && sb >= 3 ? 0.6 : 1) * (me ? 1 - Math.min(0.5, sk(s, 'cd')) : 1);
    st.until = now + abilityDuration(s, ab) * 1000 * (m.cls === 'tank' && sb >= 3 ? 2 : 1) * (me ? 1 + sk(s, 'dur') : 1);
    s.abil[id] = st;
    if (m.cls === 'healer') {
      healParty(s, 0.45 * pw, true);
      const fallen = s.party.filter(x => x && s.down[x]).slice(0, (sb >= 3 ? 5 : 1) + (me ? sk(s, 'revive') : 0));
      for (const f of fallen) { delete s.down[f]; s.hp[f] = maxHpOf(s, f) * 0.5; s.stats.revives++; events && events.push({ type: 'revive', id: f }); }
    } else if (m.cls === 'rogue') {
      const d = c.dps * scale(s, id) * partyMult(s) * gearMult(s, id, 'dps') * 12 * pw;
      events && events.push({ type: 'ability', id, cls: m.cls, dmg: d });
      damageFoe(s, d, now, null, events);
      return true;
    } else if (m.cls === 'necro') {
      const each = c.dps * scale(s, id) * partyMult(s) * gearMult(s, id, 'dps') * 0.6 * (sb >= 2 ? 1.3 : 1) * pw;
      const hp = maxHpOf(s, id) * 0.5;
      s.minions = Array.from({ length: (sb >= 3 ? 5 : 3) + (me ? sk(s, 'minion') : 0) }, () => ({ dps: each, hp, max: hp, until: st.until }));
    }
    events && events.push({ type: 'ability', id, cls: m.cls });
    return true;
  }

  // Should an ability fire on its own right now?
  function wantsCast(s, id, now) {
    const m = memberById(id), foe = s.foe;
    if (!foe) return false;
    switch (m.cls) {
      case 'tank': return !foe.chest && (foe.boss || (s.hp[id] || 0) < maxHpOf(s, id) * 0.6);
      case 'healer': return s.party.some(x => x && (s.down[x] || (s.hp[x] || 0) < maxHpOf(s, x) * 0.5));
      case 'rogue': return true;
      case 'mage': return foe.boss || foe.hp > totalDps(s, now) * 3;
      case 'necro': return !foe.chest;
    }
    return false;
  }

  // Resting at camp: after Return to camp (floor 1) or under a Campfire Draught. Nobody fights; everyone heals up.
  const resting = (s, now) => !!((s.campReturn && s.floor <= CAMP_FLOOR) || s.campUntil > now);
  function tick(s, dt, now, rng, events) {
    s.stats.playTime += dt; s.clock = now;
    if (s.unlocked.length && !(s.traits && s.unlocked.every(id => s.traits[id]))) for (const id of s.unlocked) traitsOf(s, id);
    if (resting(s, now)) {
      for (const id of s.party) if (id) { delete s.down[id]; const mx = maxHpOf(s, id); s.hp[id] = Math.min(mx, (s.hp[id] || 0) + mx * 0.25 * (1 + campTrait(s, 'rest')) * dt); }
      s.minions = []; s.lantern = 0;
      return;
    }
    // story recruits and revivals
    for (const id of s.party) if (id && s.down[id] && s.down[id] <= now) { delete s.down[id]; s.hp[id] = maxHpOf(s, id) * 0.4; }
    s.minions = s.minions.filter(m => m.until > now && m.hp > 0);
    if (!alive(s).length) return; // nobody to fight
    if (!s.foe) { s.foe = makeFoe(s, rng); if (s.foe.pack) events && events.push({ type: 'pack', n: s.foe.pack, name: s.foe.name }); }
    if (s.retryAt && !s.autoAdvance && now >= s.retryAt) { s.autoAdvance = true; s.retryAt = 0; events && events.push({ type: 'retry' }); }
    if (s.foe.goblin) {
      s.foe.flee += dt;
      if (s.foe.flee >= GOBLIN_TIME) { goblinFlee(s, rng, events); return; }
    }
    if (s.foe.boss) {
      s.lantern += dt;
      if (s.lantern >= lanternTime(s)) {
        events && events.push({ type: 'bossfail', name: s.foe.name });
        s.autoAdvance = false; s.retryAt = now + RETRY_AFTER * 1000;
        gotoFloor(s, s.floor - 1);
        return;
      }
    }
    // monster tricks: wards, regeneration and poison
    const fm = s.foe.mods || [];
    if (fm.includes('regen') && s.foe.hp < s.foe.max) s.foe.hp = Math.min(s.foe.max, s.foe.hp + s.foe.max * (s.foe.boss ? 0.004 : 0.012) * dt);
    if (fm.includes('ward') && now >= (s.foe.wardAt || 0)) { s.foe.ward = s.foe.max * (s.foe.boss ? 0.05 : 0.15); s.foe.wardAt = now + 12000; events && events.push({ type: 'ward' }); }
    if (s.poison) for (const id in s.poison) {
      const p = s.poison[id]; if (p.until <= now || s.down[id] || !s.party.includes(id)) { delete s.poison[id]; continue; }
      s.hp[id] -= p.dps * dt;
      if (s.hp[id] <= 0) { s.hp[id] = 0; s.down[id] = now + REVIVE_TIME * 1000; delete s.poison[id]; events && events.push({ type: 'fall', id }); if (!alive(s).length) { wipe(s, now, events); return; } }
    }
    // healing
    for (const hid of s.party) {
      const hps = healPerSec(s, hid); if (!(hps > 0)) continue;
      // each healer tends the most hurt first; the farther away, the weaker the heal
      let need = hps * dt;
      const order = alive(s).sort((a, b) => s.hp[a] / maxHpOf(s, a) - s.hp[b] / maxHpOf(s, b));
      for (const id of order) { const eff = healReach(s, hid, id), gap = maxHpOf(s, id) - s.hp[id]; if (gap <= 0) continue; const h = Math.min(gap, need * eff); s.hp[id] += h; need -= h / eff; if (need <= 1e-9) break; }
    }
    // abilities
    if (s.autoCast) for (const id of s.party) if (id && !s.down[id]) { const st = s.abil[id]; if ((!st || st.readyAt <= now) && wantsCast(s, id, now)) castAbility(s, id, now, events); }
    if (s.autoCast && !s.down.you) for (const ab of heroSpecs(s)) { const st = s.abil['you:' + ab.id]; if ((!st || st.readyAt <= now) && wantsSpec(s, ab, now)) castSpec(s, ab.id, now, events); }
    // foe swings
    if (s.foe && s.foe.atk) {
      s.foeSwing += dt;
      while (s.foeSwing >= FOE_SWING && s.foe) { s.foeSwing -= FOE_SWING; foeAttack(s, now, rng, events); if (!alive(s).length) return; }
    }
    damageFoe(s, totalDps(s, now) * dt, now, rng, events);
  }

  function strike(s, now, rng, events, auto) {
    if (resting(s, now)) return 0;
    if (!s.foe) s.foe = makeFoe(s, rng);
    let dmg = clickDamage(s, now);
    const crit = (rng || Math.random)() < critChance(s);
    if (crit) { dmg *= 5; s.stats.crits++; }
    if (!auto) s.stats.clicks++;
    events && events.push({ type: 'hit', dmg, crit, auto });
    damageFoe(s, dmg, now, rng, events);
    return { dmg, crit };
  }

  function rekindle(s) {
    const e = embersFor(s);
    if (e <= 0) return 0;
    s.kindling = (s.kindling || 0) + skillPointsFor(s);
    s.embers += e; s.stats.rekindles++;
    s.gold = 0; s.floor = 1; s.foeIdx = 0; s.maxFloor = 1; s.foe = null; s.lantern = 0;
    for (const id of s.unlocked) s.levels[id] = 1;
    if (s.hero) s.levels.you = 1;
    s.hp = {}; s.down = {}; s.abil = {}; s.minions = []; s.autoAdvance = true; s.retryAt = 0;
    for (const id of s.party) if (id) s.hp[id] = maxHpOf(s, id);
    return e;
  }

  // Story: returns the next beat to show (and applies it), or null.
  function nextStory(s) {
    for (const b of STORY) {
      if (s.story.seen[b.id]) continue;
      if (!b.when(s)) return null; // beats play in order
      s.story.seen[b.id] = Date.now();
      if (b.join) recruit(s, b.join);
      for (const id of STORY_LORE[b.id] || []) if (!s.lore[id]) s.lore[id] = Date.now();
      if (b.id === 'end') s.lore.g7 = Date.now();
      return b;
    }
    return null;
  }
  function currentGoal(s) {
    let g = STORY[0].goal;
    for (const b of STORY) if (s.story.seen[b.id]) g = b.goal;
    return g;
  }
  function chapterOf(s) { let c = 1; for (const b of STORY) if (s.story.seen[b.id]) c = b.ch; return c; }

  function checkFeats(s) {
    const got = [];
    for (const f of FEATS) if (!s.feats[f.id] && f.test(s)) { s.feats[f.id] = Date.now(); got.push(f); }
    return got;
  }

  // Away from the game the party earns a quarter of its active gold, for a limited time.
  // The base window is 8 hours; Night Watch (Kindling) extends it, up to 3 days at most.
  const OFFLINE_BASE = 8 * 3600, OFFLINE_MAX = 72 * 3600;
  const offlineWindow = s => Math.min(OFFLINE_MAX, OFFLINE_BASE + kup(s, 'watch') + (passOn(s) ? PASS_OFFLINE : 0));
  const offlineEarnPerSec = s => offlineGoldPerSec(s) * 0.5;
  // Auto-train: spend gold on the members who have it switched on, cheapest level first.
  function autoTrain(s, inCamp) {
    if (!passOn(s)) return 0;
    const on = Object.keys(s.autoTrain || {}).filter(id => s.autoTrain[id] && s.unlocked.includes(id) && !isGuest(s, id) && (inCamp || s.party.includes(id)));
    let n = 0;
    while (on.length && n < 200) {
      let best = null, bc = Infinity;
      for (const id of on) { const c = trainCost(s, id, 1); if (c < bc) { bc = c; best = id; } }
      if (!best || bc > s.gold) break;
      train(s, best, 1); n++;
    }
    return n;
  }
  function offlineGoldPerSec(s) {
    const d = totalDps(s, 0);
    if (d <= 0) return 0;
    let f = Math.max(1, s.maxFloor - 1);
    if (isBossFloor(f)) f = Math.max(1, f - 1);
    const killsPerSec = Math.min(4, d / foeHp(f, false));
    return killsPerSec * foeGold(f, false) * goldMult(s) * 0.5 * (1 + relicVal(s, 'bell'));
  }

  function migrate(o) {
    const s = newState();
    if (!o || typeof o !== 'object') return s;
    if ((o.v || 1) < 2) {
      // v1 saves: keep long-term progress, start the new party story fresh.
      s.embers = o.embers || 0; s.relics = o.relics || {}; s.feats = {};
      s.maxFloorEver = 1; s.settings = Object.assign(s.settings, o.settings || {});
      s.stats = Object.assign(s.stats, o.stats || {}); s.stats.playTime = (o.stats && o.stats.playTime) || 0;
      s.migratedFromV1 = true;
      return s;
    }
    Object.assign(s, o);
    s.stats = Object.assign(newState().stats, o.stats || {});
    if ((o.econ || 1) < 2) { const L = (o.levels && o.levels.you) || 0; s.gold = regold(o.gold || 0, L); s.stats.goldEarned = regold(s.stats.goldEarned || 0, L); s.econ = 2; }
    s.settings = Object.assign(newState().settings, o.settings || {});
    s.story = Object.assign({ seen: {}, queue: [] }, o.story || {});
    s.party = (o.party || []).concat([null, null, null, null, null]).slice(0, PARTY_SIZE);
    if (!o.formation) { registerHero(s); try { autoFormation(s); } catch (e) {} }
    s.formation = 1;
    s.foe = null; s.lantern = 0; s.minions = []; s.abil = {}; s.down = {};
    s.guests = o.guests || [];
    s.items = Object.assign({ draught: 1, oil: 0 }, o.items || {}); s.tonic = o.tonic || {}; s.campUntil = o.campUntil || 0; s.jobs = o.jobs || {};
    // Skill trees arrived after some players had already rekindled: 2 points for each past rekindle.
    s.kup = o.kup || {}; s.autoTrain = o.autoTrain || {}; s.skills = o.skills || {}; s.kindling = o.kindling != null ? o.kindling : 2 * ((o.stats && o.stats.rekindles) || 0);
    s.bagUps = o.bagUps || 0; s.boh = !!o.boh; s.traits = o.traits || {}; s.goblin = o.goblin && o.goblin.item ? { item: normItem(o.goblin.item), floor: o.goblin.floor || 1, at: o.goblin.at || 0 } : null; s.unlocks = o.unlocks || {}; s.campReturn = o.campReturn || 0;
    if (s.hero) s.mode = 'multi'; // every game is multiplayer now; story companions stay at camp
    s.bag = (o.bag || []).map(normItem); s.gear = o.gear || {};
    const OLD = { weapon: 'main', armor: 'chest', trinket: 'neck' };
    for (const id in s.gear) for (const k in OLD) if (s.gear[id][k]) { s.gear[id][OLD[k]] = s.gear[id][k]; delete s.gear[id][k]; } s.lore = Object.assign({ hold: 1 }, o.lore || {});
    registerHero(s);
    for (const id of s.party) if (id && (s.hp[id] == null || s.hp[id] <= 0)) s.hp[id] = maxHpOf(s, id);
    return s;
  }

  const api = {
    reqLevel, canWear, JOBS, jobValue, jobFree, campBonus, jobOf, assignJob, jobText,
    CAMP_FLOOR, atCamp, campLeft, SHOP, shopPrice, buyShop, useDraught, useOil, TONICS, TONIC_CAP, ITEM_SIGILS, TRAIT_FX, CAMP_TRAITS, traitsOf, traitState, traitVal, traitText, campTrait, tonicById, tonicLeft, tonicVal, drinkTonic,
    STATS, STAT_CLASS, STAT_BASE, STAT_AFFINITY, STAT_MAX, RESPEC_COST, statSpent, xpNeed, heroLevel, pointsFor, heroPoints, statScore, addStat, resetStats, statVal, PACK_CHANCE, PACK_GOLD,
    VERSION, CLASSES, CLASS_ORDER, MEMBERS, SIDES, FORMATION, POS_NAME, moveMember, autoFormation, formationNotes, healReach, betterFor, equipBest, SIDE_ORDER, sideOf, BIOMES, FOES, RELICS, FEATS, STORY, FOES_PER_FLOOR, BOSS_EVERY, REKINDLE_FLOOR, MILESTONES, PARTY_SIZE, REVIVE_TIME,
    newState, migrate, isBossFloor, biomeOf, depthCycle, foeHp, foeGold, foeDps, memberById, trainCost, maxAffordable, memberDps, totalDps, maxHpOf, healPerSec,
    clickDamage, lanternTime, embersFor, SPECS, heroSpecs, castSpec, fxOn, packCount, OFFLINE_BASE, OFFLINE_MAX, offlineWindow, offlineEarnPerSec, autoTrain, KINDLE_UPS, kup, kupCost, buyKup, CLASS_CHANGE_COST, changeClass, SKILL_TREES, skillById, skillCost, skillText, sk, AURAS, AURA_TIER, HONOR_FX, warAura, MERCY_FX, mercyOn, KIN_AMP, bannerKin, SIGIL_CHEST, SIGIL_BOSS, SIGIL_DROP_DAY, sigilLuck, sigilChance, QUESTS, QUEST_REWARD, QUEST_BONUS, questDay, dailyQuests, questState, PASS_COST, PASS_DAYS, PASS_BAG, BOH_COST, PASS_OFFLINE, passOn, skillSpent, canLearn, learnSkill, resetSkills, skillPointsFor, heroCls, tick, strike, train, recruit, seat, unseat, castAbility, rekindle, checkFeats, gotoFloor, nextStory, currentGoal, chapterOf,
    offlineGoldPerSec, regold, GOBLIN_FLOOR, GOBLIN_CHANCE, GOBLIN_TIME, GOBLIN_GOLD, ECON_AT, campCost, CAMP_FREE_FLOOR, resting, MODS, ACT_ONE_END, ACT_TWO_AT, actTwoOpen, JOB_SETS, JOB_SET_TWO, JOB_SET_THREE, jobGear, jobSetCount, rollJobSet, rollGear, SLOTS, POS, SLOT_NAME, posType, fitsPos, normItem, itemStats, itemScore, weightOf, wornAt, wornPos, openPos, replaces, robeOn, bestKit, gearPctOf, bagCap, BAG_STEP, BAG_UPS_MAX, bagUpCost, buyBag, unlockCost, unlockSlot, unlocksOf, CLOTH, RARITY, SETS, LORE, GEAR_CAP, UP_MAX, gearName, gearPct, equip, unequip, upgrade, upgradeCost, salvage, salvageValue, wearer, itemOf, setCount, setBonus, gearMult, startGame, addGuest, dismissGuest, registerHero, isGuest, NPC_POWER, milestoneMult, nextMilestone, abilityActive, abilityDuration, featCount, critChance, partyMult, lvl, alive,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LH = api;
})(this);
