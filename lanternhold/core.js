/* Lanternhold: An Idle Descent — game rules and state (no DOM). v2: party of five, foes strike back, story. */
(function (root) {
  'use strict';

  const VERSION = 2;
  const FOES_PER_FLOOR = 8;
  const BOSS_EVERY = 5;
  const BASE_LANTERN = 30;
  const COST_GROWTH = 1.07;
  const REKINDLE_FLOOR = 25;
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
  const sidePerk = (s, k) => { const d = sideOf(s); if (!d) return 1;
    if (d === 'unsworn') return k === 'heal' ? 1 : 1.05;
    return ({ covenant: { hp: 1.15 }, radiant: { dps: 1.12 }, tide: { gold: 1.15 }, mercy: { heal: 1.15 } }[d][k]) || 1; };
  const TIER = [{ cost: 10, stat: 1 }, { cost: 2e6, stat: 2.6e4 }];
  const NPC_POWER = 0.7;   // story companions are always weaker than real players' heroes
  const GUEST_SLOTS_SOLO = 0;
  // Dynamic members: your own hero ('you') and other players' heroes recruited from the board.
  const dyn = {};
  function registerHero(s) {
    if (s.hero) dyn.you = { id: 'you', name: s.hero.name, title: (SIDES[s.hero.side] ? SIDES[s.hero.side].name + ' ' : '') + 'Lantern-bearer', cls: s.hero.cls, tier: 0, hue: 0, player: true, line: 'That\u2019s you.' };
    for (const g of s.guests || []) dyn[g.id] = { id: g.id, name: g.name, title: 'Recruited player', cls: g.cls, tier: 0, hue: 0, player: true, guest: true, line: 'Another delver, lending you their strength.' };
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
  ];
  const ELITE_CHANCE = 0.12;
  const FOES = [
    { id: 'slime', name: 'Gloop' }, { id: 'rat', name: 'Gnawer' }, { id: 'bat', name: 'Flitterwing' },
    { id: 'skeleton', name: 'Rattlebones' }, { id: 'eye', name: 'Watcher' }, { id: 'shroom', name: 'Capling' }, { id: 'ghost', name: 'Wisp' },
  ];
  const BOSS_SPRITES = ['golem', 'wyrm', 'lich'];

  const RELICS = [
    { id: 'locket',   name: "Miner's Locket",          desc: '+15% gold per level',                    per: 0.15 },
    { id: 'crown',    name: 'Ashen Circlet',           desc: '+10% party damage per level',            per: 0.10 },
    { id: 'whet',     name: 'Grim Whetstone',          desc: '+25% strike damage per level',           per: 0.25 },
    { id: 'hourglass',name: 'Cracked Hourglass',       desc: '+10% ability duration per level',        per: 0.10 },
    { id: 'lamp',     name: 'Lamp of the First Delve', desc: '+3s lantern time per level',             per: 3 },
    { id: 'moth',     name: 'Moth-wing Charm',         desc: '+1% treasure chest chance per level',    per: 0.01 },
    { id: 'ledger',   name: 'Ledger of Old Debts',     desc: '-2% training costs per level (max 50%)', per: 0.02 },
    { id: 'dice',     name: 'Bone Dice',               desc: '+2% critical strike chance per level',   per: 0.02 },
    { id: 'lens',     name: 'Deepglass Lens',          desc: '+15% damage to guardians per level',     per: 0.15 },
    { id: 'heart',    name: 'Ember Heart',             desc: '+5% Embers on rekindle per level',       per: 0.05 },
    { id: 'bell',     name: "Sleepwalker's Bell",      desc: '+20% gold while away per level',         per: 0.20 },
    { id: 'tooth',    name: 'Gilded Rat Tooth',        desc: '+30% gold from chests per level',        per: 0.30 },
    { id: 'ward',     name: 'Wardstone Shard',         desc: '+10% party health per level',            per: 0.10 },
    { id: 'censer',   name: 'Chapel Censer',           desc: '+12% healing per level',                 per: 0.12 },
  ];

  const FEATS = [
    { id: 'f5',    name: 'First Steps',       desc: 'Reach floor 5',              test: s => s.maxFloorEver >= 5 },
    { id: 'f10',   name: 'Below the Cellars', desc: 'Reach floor 10',             test: s => s.maxFloorEver >= 10 },
    { id: 'f25',   name: 'Spore Season',      desc: 'Reach floor 25',             test: s => s.maxFloorEver >= 25 },
    { id: 'f50',   name: 'Through the Fire',  desc: 'Reach floor 50',             test: s => s.maxFloorEver >= 50 },
    { id: 'f81',   name: 'The Lantern’s Secret', desc: 'Finish the story of Act One', test: s => !!s.story.seen.end },
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
    { id: 'gold',  name: 'Hoarder',           desc: 'Earn 1 million gold in total', test: s => s.stats.goldEarned >= 1e6 },
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
        ['Narrator', 'lamp', 'End of Act One. The lantern is yours now, and every alliance in the Reach knows it. Rekindle it, grow stronger, and see what waits below floor 80.'],
      ], goal: 'Keep descending. Act Two is coming in a future update.' },
  ];

  function newState() {
    return {
      v: VERSION,
      gold: 0, floor: 1, foeIdx: 0, maxFloor: 1, maxFloorEver: 1,
      mode: null, hero: null, guests: [],
      unlocked: [], levels: {}, party: [null, null, null, null, null],
      hp: {}, down: {}, abil: {}, minions: [],
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
  function baseHp(f) {
    let hp = 10 * Math.pow(1.22, f - 1);
    if (f > 60) hp *= Math.pow(1.03, f - 60);
    if (f > 140) hp *= Math.pow(1.04, f - 140);
    return hp;
  }
  const foeHp = (f, boss) => baseHp(f) * (boss ? 9 : 1);
  const foeGold = (f, boss) => (1 + baseHp(f) / 40) * (boss ? 5 : 1);
  // Foe damage per second. Grows a little slower than foe health, so a well-kept party can hold.
  const foeDps = (f, boss) => 1.1 * Math.pow(1.205, f - 1) * (f > 60 ? Math.pow(1.025, f - 60) : 1) * (boss ? 2.2 : 1);
  const FOE_SWING = 1.6;

  function relicVal(s, id) { const r = RELICS.find(x => x.id === id); return (s.relics[id] || 0) * r.per; }
  function milestoneMult(lvl) { let m = 1; for (const t of MILESTONES) if (lvl >= t) m *= (t >= 200 ? 3 : 2); return m; }
  function nextMilestone(lvl) { return MILESTONES.find(t => t > lvl) || null; }

  const lvl = (s, id) => { if (isGuest(s, id)) { const g = s.guests.find(x => x.id === id); return g ? g.level : 0; } return s.levels[id] || 0; };
  function costDiscount(s) { return Math.min(0.5, relicVal(s, 'ledger')); }
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
  function emberMult(s) { return 1 + 0.1 * s.embers; }
  function abilityActive(s, id, now) { const a = s.abil[id]; return !!(a && a.until > now); }
  const scale = (s, id) => { const m = memberById(id), L = lvl(s, id); return L * milestoneMult(L) * TIER[m.tier].stat * (m.player ? 1 : NPC_POWER); };

  function maxHpOf(s, id) {
    const m = memberById(id);
    return Math.max(1, CLASSES[m.cls].hp * scale(s, id) * (1 + relicVal(s, 'ward')) * (1 + 0.04 * s.embers) * gearMult(s, id, 'hp') * sidePerk(s, 'hp'));
  }
  function partyMult(s) { return emberMult(s) * (1 + 0.02 * featCount(s)) * (1 + relicVal(s, 'crown')) * sidePerk(s, 'dps'); }
  function memberDps(s, id, now) {
    if (!id || s.down[id] || !lvl(s, id)) return 0;
    const m = memberById(id), c = CLASSES[m.cls];
    let d = c.dps * scale(s, id) * partyMult(s) * gearMult(s, id, 'dps');
    if (m.cls === 'mage' && abilityActive(s, id, now)) d *= setBonus(s, id) >= 3 ? 6 : 4;
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
    return CLASSES.healer.heal * scale(s, id) * gearMult(s, id, 'heal') * (1 + relicVal(s, 'censer')) * (1 + 0.04 * s.embers) * (1 + 0.02 * featCount(s)) * sidePerk(s, 'heal');
  }
  function clickDamage(s, now) { return (1 + totalDps(s, now) * 0.05) * (1 + relicVal(s, 'whet')); }
  function goldMult(s) { return emberMult(s) * (1 + relicVal(s, 'locket')) * sidePerk(s, 'gold'); }
  function critChance(s) { return 0.04 + relicVal(s, 'dice'); }
  function lanternTime(s) { return BASE_LANTERN + relicVal(s, 'lamp'); }
  function chestChance(s) { return 0.03 + relicVal(s, 'moth'); }
  function abilityDuration(s, ab) { return ab.dur * (1 + relicVal(s, 'hourglass')); }

  function embersFor(s) {
    const f = s.maxFloor;
    if (f < REKINDLE_FLOOR) return 0;
    return Math.floor(Math.pow(f - 20, 1.3) / 8 * (1 + relicVal(s, 'heart')));
  }


  // ---------- gear ----------
  const SLOTS = ['weapon', 'armor', 'trinket'];
  const SLOT_NAME = { weapon: 'Weapon', armor: 'Armor', trinket: 'Trinket' };
  const BASES = {
    tank:   { weapon: "Warden's Mace",  armor: 'Bulwark Plate',     trinket: 'Tower Sigil' },
    healer: { weapon: 'Willow Staff',   armor: 'Mossweave Robe',    trinket: 'Censer Charm' },
    rogue:  { weapon: 'Twin Fangs',     armor: 'Shadowhide Jerkin', trinket: 'Loaded Dice' },
    mage:   { weapon: 'Emberwood Wand', armor: 'Cinderweave Robe',  trinket: 'Focus Prism' },
    necro:  { weapon: 'Bone Scepter',   armor: 'Gravecloth Shroud', trinket: 'Cracked Phylactery' },
  };
  const RARITY = [
    { id: 'common', name: 'Common', pct: 0.10, w: 60, prefix: '' },
    { id: 'fine',   name: 'Fine',   pct: 0.20, w: 28, prefix: 'Keen ' },
    { id: 'rare',   name: 'Rare',   pct: 0.35, w: 10, prefix: 'Runed ' },
    { id: 'epic',   name: 'Epic',   pct: 0.60, w: 2,  prefix: 'Lantern-blessed ' },
    { id: 'set',    name: 'Set',    pct: 0.45, w: 0,  prefix: '' },
  ];
  const SETS = [
    { id: 'vigil',  cls: 'tank',   name: "Gravewarden's Vigil", pieces: { weapon: 'Vigil Hammer', armor: 'Vigil Mail', trinket: 'Vigil Lantern' },
      two: '+20% health', three: 'Shield Wall lasts twice as long', lore: 'Forged for the first Gravewarden, who swore no one would be left behind in the dark.' },
    { id: 'grace',  cls: 'healer', name: "Rootmother's Grace", pieces: { weapon: 'Grace Bough', armor: 'Grace Bark Robe', trinket: 'Grace Seed' },
      two: '+25% healing', three: 'Lantern Hymn lifts every fallen ally', lore: 'Before the roots went sour, the Root Mother mended anything that bled. Some of her kindness stayed in the wood.' },
    { id: 'night',  cls: 'rogue',  name: "Kestrel's Night", pieces: { weapon: 'Nightfang', armor: 'Night Cowl', trinket: 'Night Coin' },
      two: '+10% dodge', three: 'Backstab recovers 40% faster', lore: 'Kestrel swears she did not steal these. Varga swears she did.' },
    { id: 'regalia',cls: 'mage',   name: 'Ashcombe Regalia', pieces: { weapon: 'Ashcombe Rod', armor: 'Ashcombe Mantle', trinket: 'Ashcombe Ember' },
      two: '+25% damage', three: 'Ember Storm burns at 6x instead of 4x', lore: 'The robes of the Ashcombe line of fire-scholars. Wren’s master wore them last.' },
    { id: 'crown',  cls: 'necro',  name: 'The Hollow Crown', pieces: { weapon: 'Hollow Scepter', armor: 'Hollow Regalia', trinket: 'Hollow Crown' },
      two: '+30% skeleton damage', three: 'Raise Dead calls 5 skeletons', lore: 'A king’s regalia, left in the Vault when its owner was fed to the lantern.' },
  ];
  const GEAR_CAP = 40;
  let uidSeq = 0;
  const gearPct = it => RARITY.find(r => r.id === it.rar).pct * (1 + 0.03 * it.ilvl) * (1 + 0.2 * it.up);
  function gearName(it) {
    if (it.set) return SETS.find(x => x.id === it.set).pieces[it.slot];
    return RARITY.find(r => r.id === it.rar).prefix + BASES[it.cls][it.slot];
  }
  function rollGear(s, f, opts, rng) {
    const r = rng || Math.random;
    const classes = Array.from(new Set(s.party.filter(Boolean).map(id => memberById(id).cls)));
    const cls = classes.length ? classes[Math.floor(r() * classes.length)] : CLASS_ORDER[Math.floor(r() * 5)];
    const slot = SLOTS[Math.floor(r() * 3)];
    let rar;
    if (opts && opts.set) {
      const set = SETS.find(x => x.cls === cls);
      return { uid: Date.now().toString(36) + (uidSeq++), cls, slot, rar: 'set', set: set.id, ilvl: f, up: 0 };
    }
    const boost = (opts && opts.boost) || 0;
    const p = r() + boost * 0.25;
    rar = p > 0.985 ? 'epic' : p > 0.88 ? 'rare' : p > 0.6 ? 'fine' : 'common';
    return { uid: Date.now().toString(36) + (uidSeq++), cls, slot, rar, ilvl: f, up: 0 };
  }
  function dropGear(s, foe, rng, events) {
    const r = rng || Math.random, f = s.floor;
    let it = null;
    if (foe.boss) {
      if (f >= 15 && r() < 0.14) it = rollGear(s, f, { set: true }, r);
      else it = rollGear(s, f, { boost: 1 }, r);
    } else if (foe.chest) { if (r() < 0.6) it = rollGear(s, f, { boost: 0.5 }, r); }
    else if (foe.elite) { if (r() < 0.3) it = rollGear(s, f, { boost: 0.5 }, r); }
    else if (r() < 0.025) it = rollGear(s, f, null, r);
    if (!it) return;
    if (s.bag.length >= GEAR_CAP) {
      // full bag: the lowest value common item gets sold automatically
      const worst = s.bag.filter(x => x.rar === 'common').sort((a, b) => gearPct(a) - gearPct(b))[0];
      if (worst && gearPct(worst) < gearPct(it)) { s.bag = s.bag.filter(x => x !== worst); s.gold += salvageValue(worst); }
      else { s.gold += salvageValue(it); events && events.push({ type: 'autosell', item: it }); return; }
    }
    s.bag.push(it);
    if (it.set) { s.lore['set_' + it.set] = Date.now(); }
    events && events.push({ type: 'loot', item: it });
  }
  function equipped(s, id) { return (s.gear[id] || {}); }
  function itemOf(s, uid) { return s.bag.find(x => x.uid === uid); }
  function wearer(s, uid) { for (const id in s.gear) for (const sl of SLOTS) if (s.gear[id][sl] === uid) return id; return null; }
  function equip(s, id, uid) {
    const it = itemOf(s, uid); if (!it) return false;
    const m = memberById(id); if (!m || m.guest || m.cls !== it.cls) return false;
    const prev = wearer(s, uid); if (prev) delete s.gear[prev][it.slot];
    s.gear[id] = s.gear[id] || {};
    const before = maxHpOf(s, id);
    s.gear[id][it.slot] = uid;
    if (s.hp[id] != null && !s.down[id]) s.hp[id] = Math.max(1, s.hp[id] + maxHpOf(s, id) - before);
    return true;
  }
  function unequip(s, id, slot) { if (s.gear[id]) delete s.gear[id][slot]; }
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
    const w = wearer(s, uid); if (w) delete s.gear[w][it.slot];
    s.bag = s.bag.filter(x => x !== it);
    const v = salvageValue(it); s.gold += v; return v;
  }
  // Best unworn-or-own item per slot for a member, if it beats what they wear.
  function betterFor(s, id) {
    const m = memberById(id); if (!m || m.guest) return {};
    const g = equipped(s, id), out = {};
    for (const sl of SLOTS) {
      const cur = g[sl] && itemOf(s, g[sl]); let best = null, bp = cur ? gearPct(cur) : 0;
      for (const it of s.bag) if (it.cls === m.cls && it.slot === sl && !wearer(s, it.uid) && gearPct(it) > bp) { best = it; bp = gearPct(it); }
      if (best) out[sl] = best;
    }
    return out;
  }
  function equipBest(s, id) { const b = betterFor(s, id); let n = 0; for (const sl in b) if (equip(s, id, b[sl].uid)) n++; return n; }
  function setCount(s, id, setId) { const g = equipped(s, id); let n = 0; for (const sl of SLOTS) { const it = g[sl] && itemOf(s, g[sl]); if (it && it.set === setId) n++; } return n; }
  function setBonus(s, id) {
    const m = memberById(id); if (!m) return 0;
    const set = SETS.find(x => x.cls === m.cls); if (!set) return 0;
    return setCount(s, id, set.id);
  }
  function gearMult(s, id, kind) {
    const g = equipped(s, id); let pct = 0;
    for (const sl of SLOTS) {
      const it = g[sl] && itemOf(s, g[sl]); if (!it) continue;
      if (kind === 'dps' && (sl === 'weapon' || sl === 'trinket')) pct += gearPct(it) * (sl === 'trinket' ? 0.5 : 1);
      if (kind === 'hp' && (sl === 'armor' || sl === 'trinket')) pct += gearPct(it) * (sl === 'trinket' ? 0.5 : 1);
      if (kind === 'heal' && sl !== 'armor') pct += gearPct(it);
    }
    const n = setBonus(s, id), cls = memberById(id).cls;
    if (n >= 2) {
      if (kind === 'hp' && cls === 'tank') pct += 0.2;
      if (kind === 'heal' && cls === 'healer') pct += 0.25;
      if (kind === 'dps' && cls === 'mage') pct += 0.25;
    }
    return 1 + pct;
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
    { id: 'g0', title: 'The Cellar Glutton', group: 'Guardians', text: 'A Tide war-beast left to guard the stair. It ate the oil, the barrels, and a courier carrying orders. Everything feeds the Tide, and the Glutton took that personally.' },
    { id: 'g1', title: 'Grandmother Rot', group: 'Guardians', text: 'Once the Mercy Corps healer of this front. The Tide did not kill her. It convinced her that rot was just another kind of mending.' },
    { id: 'g2', title: 'The Mycelial Choir', group: 'Guardians', text: 'An Ascendancy experiment: teach the Rift-fed spores to sing in unison, and see if the song opens doors. It did. Just not the right ones.' },
    { id: 'g3', title: 'Ossuary Prime', group: 'Guardians', text: 'The Covenant captain who held the Saltbone Galleries. Still holding them. Still does not know the war moved on.' },
    { id: 'g4', title: 'Furnace-Heart', group: 'Guardians', text: 'The greatest Ascendancy war-engine ever built, abandoned when it would not stop burning. Sir Ashe fought it for forty years without winning or losing.' },
    { id: 'g5', title: 'The Sunken Bishop', group: 'Guardians', text: 'He drowned his own chapel to reach the Rift. He is still praying. The water carries the words a long way down.' },
    { id: 'g6', title: 'The Root Mother', group: 'Guardians', text: 'Before the Tide reached her she mended anything that bled. Now she feeds the dark with whatever wanders into her roots.' },
    { id: 'g7', title: 'The Unlit', group: 'Guardians', text: 'The Nyx Rift’s breath, held under the lantern. It does not hate the light. It has simply never been allowed any.' },
    { id: 'foe_slime', title: 'Gloops', group: 'Bestiary', text: 'Lamp oil left too long near the Rift grows hungry. Gloops are what it becomes. Harmless alone, ruinous in barrels.' },
    { id: 'foe_rat', title: 'Gnawers', group: 'Bestiary', text: 'The Hold’s rats went down for the oil and came back up bigger. The Tide uses them as scouts now.' },
    { id: 'foe_bat', title: 'Flitterwings', group: 'Bestiary', text: 'Drawn to any light. A lantern-bearer learns to love them, because they always fly toward the way out.' },
    { id: 'foe_skeleton', title: 'Rattlebones', group: 'Bestiary', text: 'Most wear the tatters of lantern-bearer coats or Covenant iron. Vael says they are not angry. They are lost.' },
    { id: 'foe_eye', title: 'Watchers', group: 'Bestiary', text: 'Nobody has seen a Watcher blink. Moss thinks they report to the Ascendancy. Kestrel thinks Moss worries too much.' },
    { id: 'foe_shroom', title: 'Caplings', group: 'Bestiary', text: 'They walk on their roots and sing in a pitch only the dead can hear. The Choir is what happens when enough of them agree.' },
    { id: 'foe_ghost', title: 'Wisps', group: 'Bestiary', text: 'A wisp is the warmth a person leaves behind. The Pale Oracle says she can tell whose by the colour.' },
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
    s.guests.push({ id: g.id, name: g.name, cls: g.cls, level: Math.max(1, Math.floor(g.level)), at: Date.now() });
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
  function makeFoe(s, rng) {
    const f = s.floor, boss = isBossFloor(f), r = rng || Math.random;
    const chest = !boss && r() < chestChance(s);
    const b = biomeOf(f);
    let sprite, name;
    if (boss) {
      sprite = BOSS_SPRITES[Math.floor(f / BOSS_EVERY) % BOSS_SPRITES.length];
      name = (f % 10 === 0) ? b.boss : ['Stone Sentinel', 'Tunnel Wyrm', 'Bone Hierarch'][BOSS_SPRITES.indexOf(sprite)];
    } else if (chest) { sprite = 'chest'; name = 'Treasure Chest'; }
    else { const fo = FOES[Math.floor(r() * FOES.length)]; sprite = fo.id; name = b.adj[Math.floor(r() * b.adj.length)] + ' ' + fo.name; }
    // Grand War warbands: soldiers of the alliances fighting over the Rift.
    const elite = !boss && !chest && f >= 4 && r() < ELITE_CHANCE;
    let side = null;
    if (elite) { side = b.war.side; name = b.war.units[Math.floor(r() * b.war.units.length)]; sprite = ['skeleton', 'ghost', 'eye'][Math.floor(r() * 3)]; }
    const hp = foeHp(f, boss) * (chest ? 0.5 : elite ? 2.5 : 1);
    // Some foes sneak up and hit the back of the line first.
    const ambush = !boss && !chest && f >= 6 && r() < (elite ? 0.3 : 0.1) ? 2 : 0;
    return { name, sprite, boss, chest, elite, side, ambush, hp, max: hp, hue: elite ? b.hue + 40 : b.hue, atk: chest ? 0 : foeDps(f, boss) * FOE_SWING * (elite ? 1.3 : 1) };
  }

  function damageFoe(s, amount, now, rng, events) {
    let guard = 0;
    while (amount > 0 && guard++ < 60) {
      if (!s.foe) s.foe = makeFoe(s, rng);
      const foe = s.foe, mult = foe.boss ? 1 + relicVal(s, 'lens') : 1;
      const dmg = amount * mult;
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

  function killFoe(s, now, rng, events) {
    const foe = s.foe, f = s.floor;
    let g = foeGold(f, foe.boss) * goldMult(s);
    if (foe.chest) { g *= 10 * (1 + relicVal(s, 'tooth')); s.stats.chests++; }
    if (foe.elite) { g *= 3; unlockLore(s, 'war_' + foe.side, events); }
    s.gold += g; s.stats.goldEarned += g; s.stats.kills++;
    events && events.push({ type: 'kill', gold: g, foe });
    unlockLore(s, foe.boss ? 'boss' : 'foe_' + foe.sprite, events);
    if (foe.boss && f % 10 === 0) unlockLore(s, 'g' + (Math.floor((f - 1) / 10) % BIOMES.length), events);
    dropGear(s, foe, rng, events);
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
    f = Math.max(1, Math.min(s.maxFloor, f));
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
    if (c.dodge && (rng || Math.random)() < c.dodge + (setBonus(s, t) >= 2 ? 0.1 : 0)) { events && events.push({ type: 'dodge', target: t }); return; }
    if (c.armor) dmg *= 1 - c.armor;
    if (m.cls === 'tank' && abilityActive(s, t, now)) dmg *= 0.3;
    s.hp[t] = (s.hp[t] == null ? maxHpOf(s, t) : s.hp[t]) - dmg;
    events && events.push({ type: 'foehit', target: t, dmg, behind: !!pick.behind });
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
    const sb = setBonus(s, id);
    st.readyAt = now + ab.cd * 1000 * (m.cls === 'rogue' && sb >= 3 ? 0.6 : 1);
    st.until = now + abilityDuration(s, ab) * 1000 * (m.cls === 'tank' && sb >= 3 ? 2 : 1);
    s.abil[id] = st;
    if (m.cls === 'healer') {
      healParty(s, 0.45, true);
      const fallen = s.party.filter(x => x && s.down[x]).slice(0, sb >= 3 ? 5 : 1);
      for (const f of fallen) { delete s.down[f]; s.hp[f] = maxHpOf(s, f) * 0.5; s.stats.revives++; events && events.push({ type: 'revive', id: f }); }
    } else if (m.cls === 'rogue') {
      const d = c.dps * scale(s, id) * partyMult(s) * gearMult(s, id, 'dps') * 12;
      events && events.push({ type: 'ability', id, cls: m.cls, dmg: d });
      damageFoe(s, d, now, null, events);
      return true;
    } else if (m.cls === 'necro') {
      const each = c.dps * scale(s, id) * partyMult(s) * gearMult(s, id, 'dps') * 0.6 * (sb >= 2 ? 1.3 : 1);
      const hp = maxHpOf(s, id) * 0.5;
      s.minions = Array.from({ length: sb >= 3 ? 5 : 3 }, () => ({ dps: each, hp, max: hp, until: st.until }));
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

  function tick(s, dt, now, rng, events) {
    s.stats.playTime += dt;
    // story recruits and revivals
    for (const id of s.party) if (id && s.down[id] && s.down[id] <= now) { delete s.down[id]; s.hp[id] = maxHpOf(s, id) * 0.4; }
    s.minions = s.minions.filter(m => m.until > now && m.hp > 0);
    if (!alive(s).length) return; // nobody to fight
    if (!s.foe) s.foe = makeFoe(s, rng);
    if (s.retryAt && !s.autoAdvance && now >= s.retryAt) { s.autoAdvance = true; s.retryAt = 0; events && events.push({ type: 'retry' }); }
    if (s.foe.boss) {
      s.lantern += dt;
      if (s.lantern >= lanternTime(s)) {
        events && events.push({ type: 'bossfail', name: s.foe.name });
        s.autoAdvance = false; s.retryAt = now + RETRY_AFTER * 1000;
        gotoFloor(s, s.floor - 1);
        return;
      }
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
    // foe swings
    if (s.foe && s.foe.atk) {
      s.foeSwing += dt;
      while (s.foeSwing >= FOE_SWING && s.foe) { s.foeSwing -= FOE_SWING; foeAttack(s, now, rng, events); if (!alive(s).length) return; }
    }
    damageFoe(s, totalDps(s, now) * dt, now, rng, events);
  }

  function strike(s, now, rng, events, auto) {
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
    s.settings = Object.assign(newState().settings, o.settings || {});
    s.story = Object.assign({ seen: {}, queue: [] }, o.story || {});
    s.party = (o.party || []).concat([null, null, null, null, null]).slice(0, PARTY_SIZE);
    if (!o.formation) { registerHero(s); try { autoFormation(s); } catch (e) {} }
    s.formation = 1;
    s.foe = null; s.lantern = 0; s.minions = []; s.abil = {}; s.down = {};
    s.guests = o.guests || [];
    if (s.hero) s.mode = 'multi'; // every game is multiplayer now; story companions stay at camp
    s.bag = o.bag || []; s.gear = o.gear || {}; s.lore = Object.assign({ hold: 1 }, o.lore || {});
    registerHero(s);
    for (const id of s.party) if (id && (s.hp[id] == null || s.hp[id] <= 0)) s.hp[id] = maxHpOf(s, id);
    return s;
  }

  const api = {
    VERSION, CLASSES, CLASS_ORDER, MEMBERS, SIDES, FORMATION, POS_NAME, moveMember, autoFormation, formationNotes, healReach, betterFor, equipBest, SIDE_ORDER, sideOf, BIOMES, FOES, RELICS, FEATS, STORY, FOES_PER_FLOOR, BOSS_EVERY, REKINDLE_FLOOR, MILESTONES, PARTY_SIZE, REVIVE_TIME,
    newState, migrate, isBossFloor, biomeOf, depthCycle, foeHp, foeGold, foeDps, memberById, trainCost, maxAffordable, memberDps, totalDps, maxHpOf, healPerSec,
    clickDamage, lanternTime, embersFor, tick, strike, train, recruit, seat, unseat, castAbility, rekindle, checkFeats, gotoFloor, nextStory, currentGoal, chapterOf,
    offlineGoldPerSec, SLOTS, SLOT_NAME, RARITY, SETS, LORE, GEAR_CAP, UP_MAX, gearName, gearPct, equip, unequip, upgrade, upgradeCost, salvage, salvageValue, wearer, itemOf, setCount, setBonus, gearMult, startGame, addGuest, dismissGuest, registerHero, isGuest, NPC_POWER, milestoneMult, nextMilestone, abilityActive, abilityDuration, featCount, critChance, partyMult, lvl, alive,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LH = api;
})(this);
