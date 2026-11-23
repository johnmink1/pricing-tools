/* Lanternhold pixel sprites. Each sprite is a grid of palette keys; '.' is empty. */
(function (root) {
  'use strict';
  const S = {};

  S.goblin = { pal: { k: '#14120f', g: '#5aa042', l: '#8fd16a', s: '#8c6a3a', y: '#f2c14e', e: '#ffb020', v: '#53302a' }, px: [
    '................',
    '..kk.......kk...',
    '.kssk.kkkkklgk..',
    'kssssklllllgk...',
    'ksyssklekleglk..',
    'ksssskllllllk...',
    'kssssklkyykk....',
    '.kssssklllk.....',
    '..kssskvvvlk....',
    '...kssvvvvglk...',
    '....kkvvvvgk....',
    '.....kvvvvk.....',
    '.....kggkggk....',
    '.....kgk.kgk....',
    '....kggk.kggk...',
    '....kkkk.kkkk...',
  ] };
  S.colossus = { pal: { k: '#0a0614', b: '#2a1f45', p: '#4a3a6e', x: '#d76bff', r: '#ff5ad0', w: '#ffe8fb' }, px: [
    '......kxk.......',
    '....kkbbbkk.....',
    '...kbbrwrbbk....',
    'kxk.kbbbbbk.kxk.',
    'kppkkpppppkkppk.',
    'kppbbbbrbbbbppk.',
    '.kpbbbrrrbbbpk..',
    '.kpbbbbrbbbbpk..',
    'kpp.kbbrbbbk.ppk',
    'kpk.kbbbbbbk.kpk',
    '.k..kbbbbbbk..k.',
    '....kbbk.kbbk...',
    '....kbbk.kbbk...',
    '...kpppk.kpppk..',
    '...kkkkk.kkkkk..',
    '................',
  ] };
  S.slime = { pal: { k: '#1b1020', g: '#5fbf5a', l: '#a6ea7e', d: '#327a3e', w: '#f4fbe8', e: '#14200f' }, px: [
    '................',
    '................',
    '................',
    '.......kk.......',
    '......kllk......',
    '.....kglggk.....',
    '....kgglgggk....',
    '...kggggggggk...',
    '..kgggwwggwwgk..',
    '..kgggweggwegk..',
    '.kggggggggggggk.',
    '.kgdggggkkgggdk.',
    'kgddgggggggggddk',
    'kgdddddddddddddk',
    '.kkddddddddddkk.',
    '...kkkkkkkkkk...',
  ] };

  S.shard = { pal: {'k':  '#0e1418',  'c':  '#7fd6e8',  'l':  '#d6fbff',  'd':  '#3a7f92',  'e':  '#ff5ad0'}, px: [
    '................',
    '................',
    '.......kk.......',
    '......kclk......',
    '.....kclllk.....',
    '....kcclccck....',
    '...kcdcllcdck...',
    'k.kccceccecck.k.',
    '.kkcccccccccckk.',
    '..kdcccccccccdk.',
    '.kkddcccccccddkk',
    'k..kdddddddddk.k',
    '..k.kk.kk.kk.k..',
    '.k..k..k..k...k.',
    'k...k..k..k....k',
    '................'
  ] };

  S.sentinel = { pal: {'k':  '#14120f',  'm':  '#7a6a55',  'l':  '#b8a688',  'd':  '#4a3f33',  'e':  '#ff8a3d',  'r':  '#8a3a2a'}, px: [
    '................',
    '.....kkkkkk.....',
    '....kllmmmmk....',
    '....kmkkkkmk....',
    '....kmkeekmk....',
    '....kmmkkmmk....',
    '..kkkmmmmmmkkk..',
    '.klmmkmrrmkmmlk.',
    '.kmmdkmrrmkdmmk.',
    '.kmk.kmmmmk.kmk.',
    '.kmk.kmmmmk.kmk.',
    '..k..kddddk..k..',
    '.....kmkkmk.....',
    '.....kmk.kmk....',
    '....kddk.kddk...',
    '....kkk...kkk...'
  ] };

  S.eel = { pal: {'k':  '#0a1816',  'g':  '#3fa898',  'l':  '#8fe8d8',  'd':  '#1f5a52',  'e':  '#f2f26a',  'w':  '#eafff8'}, px: [
    '................',
    '................',
    '.........kkk....',
    '........kgggk...',
    '.......kglgegk..',
    '.......kgggggwk.',
    '......kgggdkkk..',
    '.....kggddk.....',
    '....kggdk.......',
    '...kgglk........',
    '..kgglk...kk....',
    '..kgldk..kgdk...',
    '..kggdkkkggdk...',
    '...kdddgggddk...',
    '....kkddddkk....',
    '......kkkk......'
  ] };

  S.thorn = { pal: {'k':  '#1a1612',  'b':  '#e8dcc0',  'd':  '#a89878',  'g':  '#6a7a3a',  'e':  '#ff4a4a'}, px: [
    '................',
    '..k....kk....k..',
    '..bk..kbbk..kb..',
    '...bk.kbbk.kb...',
    '....bkkbbkkb....',
    '.....kbbbbk.....',
    '....kbebbebk....',
    '....kbbbbbbk....',
    '...kdbbkkbbdk...',
    '..kbkdbbbbdkbk..',
    '..b.kdbbbbdk.b..',
    '....kddbbddk....',
    '.....kdddddk....',
    '....kgk..kgk....',
    '...kgk....kgk...',
    '...kk......kk...'
  ] };

  S.prism = { pal: {'k':  '#0c0e1c',  'c':  '#9ab8ff',  'l':  '#e8f0ff',  'd':  '#4a5aa8',  'e':  '#fff27a'}, px: [
    '................',
    '.......kk.......',
    '......kclk......',
    '.....kcllck.....',
    '....kccllcck....',
    '...kcccllccck...',
    '..kccckeekccck..',
    '..kcccekkeccck..',
    '..kccckeekccck..',
    '...kcccddccck...',
    '....kccddcck....',
    '.....kcddck.....',
    '......kddk......',
    '.l.....kk.....l.',
    '..l..........l..',
    '................'
  ] };

  S.hound = { pal: {'k':  '#180a10',  'b':  '#7a2a3a',  'l':  '#c4506a',  'd':  '#4a1422',  'e':  '#ffd24a',  'w':  '#f2ead8'}, px: [
    '................',
    '................',
    '..kk........kk..',
    '..kbk......kbk..',
    '..kbbkkkkkkbbk..',
    '.kbbbbbbbbbbbbk.',
    '.kbebbbbbbbbebk.',
    '.kbbbbllllbbbbk.',
    '..kbwkbbbbkwbk..',
    '...kkwbbbbwkk...',
    '....kbbbbbbk....',
    '...kdbbbbbbdk...',
    '..kddkbbbbkddk..',
    '..kdk.kddk.kdk..',
    '..kk..kk.kk.kk..',
    '................'
  ] };

  S.riftling = { pal: {'k':  '#06040e',  'v':  '#4a2a8a',  'l':  '#9a6aff',  'd':  '#22124a',  'e':  '#ffffff',  's':  '#c9a6ff'}, px: [
    '................',
    '....s......s....',
    '.....kkkkkk.....',
    '....kvvvvvvk....',
    '...kvvlvvlvvk...',
    '..kvvkekkekvvk..',
    '..kvvvvvvvvvvk..',
    '..kvdvvkkvvdvk..',
    '...kdvvvvvvdk...',
    '..s.kdvvvvdk.s..',
    '....kvdvvdvk....',
    '...kv.kddk.vk...',
    '..kv..kddk..vk..',
    '..k...kvvk...k..',
    '.....kv..vk.....',
    '.....k....k.....'
  ] };

  S.rat = { pal: { k: '#1a1212', b: '#8a6a58', l: '#b8957c', d: '#5a4034', p: '#e8a0a0', e: '#ffdf6b', w: '#f2ead8' }, px: [
    '................',
    '................',
    '................',
    '...kk...........',
    '..kppk..kk......',
    '..kpbkkkbbk.....',
    '...kbbbbbbbk....',
    '..kbebbbbbbbkk..',
    '.kbbbbbllbbbbbk.',
    'kpbbbbllllbbbbk.',
    '.kwkbbbllbbbbbdk',
    '..k.kbbbbbbbbddk',
    '.....kddkkddkkk.',
    '.....kk..kk..kk.',
    '.............kpk',
    '..............k.',
  ] };

  S.bat = { pal: { k: '#140d1a', b: '#5b4470', l: '#8a6aa8', d: '#3a2a4a', e: '#ff5a4a', w: '#f2ead8' }, px: [
    '................',
    '................',
    '................',
    'k..............k',
    'kk....k..k....kk',
    'kdk...kkkk...kdk',
    'kddk.kbbbbk.kddk',
    'kdbbkbebbebkbbdk',
    'kdlbbbbbbbbbblbk',
    '.kdllbbwwbbllbk.',
    '.kddlbbbbbbldk..',
    '..kddkbbbbkddk..',
    '...kk.kbbk.kk...',
    '.......kk.......',
    '................',
    '................',
  ] };

  S.skeleton = { pal: { k: '#18140f', b: '#e8dfc8', d: '#a89c80', e: '#ff8a3d', r: '#6a5a44' }, px: [
    '................',
    '.....kkkkk......',
    '....kbbbbbk.....',
    '...kbbbbbbbk....',
    '...kbkekbekb....',
    '...kbbbbbbbk....',
    '....kbkbkbk.....',
    '.....kkkkk...k..',
    '...kkbbbbbkk.kr.',
    '..kbkdbdbdkbkkr.',
    '..kbkbbbbbkbkr..',
    '...k.kdbdk.kkr..',
    '.....kbbbk...r..',
    '....kbk.kbk.....',
    '....kbk.kbk.....',
    '...kkk...kkk....',
  ] };

  S.eye = { pal: { k: '#1a0f14', b: '#c25a6a', l: '#e88a96', d: '#7a2a3a', w: '#f6efe4', i: '#3fa7c9', p: '#0a0a12' }, px: [
    '................',
    '.k....k...k...k.',
    '..k...k...k..k..',
    '...kkkkkkkkkk...',
    '..kbllbbbbbbdk..',
    '.kblwwwwwwwwbdk.',
    'kblwwwwiiwwwwbdk',
    'kbwwwwiippiwwwdk',
    'kbwwwwiippiwwwdk',
    'kbdwwwwiiwwwwddk',
    '.kbdwwwwwwwwddk.',
    '..kddbbbbbbddk..',
    '...kkkkkkkkkk...',
    '...k..k..k..k...',
    '..k...k...k..k..',
    '................',
  ] };

  S.shroom = { pal: { k: '#1a1010', r: '#c8453a', l: '#ee7a5a', w: '#f6efe0', s: '#e6d8b8', d: '#a89470', e: '#1a1010' }, px: [
    '................',
    '................',
    '.....kkkkkk.....',
    '...kkrrwwrrkk...',
    '..krrrrwwrrrrk..',
    '.krwwrrrrrlwwrk.',
    '.krwwrrrrrrwwrk.',
    'krrrrrrwwrrrrrrk',
    'kkkkkkkkkkkkkkkk',
    '....kssssssk....',
    '....ksekseks....',
    '....kssssssk....',
    '....ksskkssk....',
    '....kdsssssk....',
    '...kkdddddkkk...',
    '...kkk....kkk...',
  ] };

  S.ghost = { pal: { k: '#141828', w: '#dfe8f6', l: '#ffffff', d: '#9fb0cc', e: '#1a2240' }, px: [
    '................',
    '.....kkkkkk.....',
    '....kwwwwwwk....',
    '...kwlwwwwwwk...',
    '..kwlwwwwwwwwk..',
    '..kwwekwwekwwk..',
    '..kwweewweewwk..',
    '..kwwwwwwwwwwk..',
    '..kwwwwkkwwwwk..',
    '..kwwwwwwwwwwk..',
    '..kdwwwwwwwwdk..',
    '..kddwwwwwwddk..',
    '..kdddwwwwdddk..',
    '..kdkddkkddkdk..',
    '..kk.kk..kk.kk..',
    '................',
  ] };

  S.chest = { pal: { k: '#1a120a', w: '#8a5a2e', l: '#b07a40', d: '#5a3a1a', g: '#f2c14e', y: '#fff0a0' }, px: [
    '................',
    '................',
    '................',
    '................',
    '...kkkkkkkkkk...',
    '..kllllllllllk..',
    '.klwwwwwwwwwwlk.',
    '.kgggggggggggggk',
    '.kwwwwwkyykwwwwk',
    '.kkkkkkgyygkkkkk',
    '.kwwwwwkggkwwwwk',
    '.kgwwwwwwwwwwwgk',
    '.kgwwwwwwwwwwwgk',
    '.kgddddddddddgk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ] };

  // Guardians are 20x20.
  S.golem = { pal: { k: '#14110e', s: '#7d7466', l: '#a49a88', d: '#4f483e', e: '#6ff0ff', m: '#4f8a46' }, px: [
    '....................',
    '.......kkkkkk.......',
    '......kllsssskk.....',
    '.....klsssssssdk....',
    '.....ksekssseksk....',
    '.....kssssssssdk....',
    '..kkkkkdsskkssdkkkk.',
    '.klssskkkddddkkssdk.',
    'klsssssmssssssssssdk',
    'ksssssmmsssssssssddk',
    'ksddssssllsssssddsdk',
    'kssdkksssssssskkssdk',
    'kssdkksssmssssk.kssk',
    '.kkk.ksssmmsssk..kk.',
    '.....kssssssssk.....',
    '.....ksssddsssk.....',
    '....kssdk..kdssk....',
    '....ksddk..kddsk....',
    '...kkkkkk..kkkkkk...',
    '....................',
  ] };

  S.wyrm = { pal: { k: '#10140e', g: '#3f8a5a', l: '#6fc08a', d: '#265a3a', b: '#e6d49a', e: '#ffcf3a', w: '#f6efe0', r: '#c8453a' }, px: [
    '....................',
    '..........kk..kk....',
    '.........klk.klk....',
    '........kggkkggk....',
    '.......kgggggggk....',
    '......kgegggegggk...',
    '......kgggggggggk...',
    '.....kggkggggggbk...',
    '....kgwkwkggggbbk...',
    '....krrrrrkggbbbk...',
    '.....kkkkkgggbbk....',
    '..kk....kgggbbk.....',
    '.kgdk..kggggbk......',
    '.kgdk.kgggggbk......',
    '.kggkkgggdggbk......',
    '..kgggggddgbbk......',
    '...kggggdgbbk.......',
    '....kkggggkk........',
    '......kkkk..........',
    '....................',
  ] };

  S.lich = { pal: { k: '#100c16', r: '#4a2a6a', l: '#7a4aa8', d: '#2a1a3e', b: '#e8dfc8', e: '#7affc8', g: '#f2c14e' }, px: [
    '....................',
    '......k.k..k.k......',
    '......kgkkkkgk......',
    '......kggggggk......',
    '.....kbbbbbbbbk.....',
    '.....kbkekkekbk.....',
    '.....kbbbbbbbbk.....',
    '......kbkbkbkk..k...',
    '....kkrkkkkkkrkkek..',
    '...krrrlrrrrrlrrkek.',
    '..krrrrlrrrrrrlrrkk.',
    '..krkrrrlrrrrlrrkbk.',
    '..kbkrrrrlrrlrrrkk..',
    '...k.krrrrllrrrk.k..',
    '.....krrrrrrrrrk.k..',
    '.....krrdrrrrdrk.k..',
    '....krrddrrrrddrkk..',
    '....krdddrrrrdddrk..',
    '....kkkkkkkkkkkkkk..',
    '....................',
  ] };


  // Party classes, 12x16, facing right.
  S.tank = { pal: { k: '#14110e', a: '#8fa3b5', l: '#c9d6e0', d: '#5b6b7a', s: '#8a5a2e', y: '#f2c14e', f: '#e8b48a', r: '#c8453a' }, px: [
    '.....rr.....',
    '....kkkk....',
    '...klaaak...',
    '...kaaaak...',
    '...kafafk...',
    '...kaaaak...',
    '..kkdaadkk..',
    '.kaalaaaakk.',
    'kssskaaaayk.',
    'ksyyskaaayk.',
    'ksyyskaaak..',
    'kssskdaadk..',
    '.kkk.kaaak..',
    '....kak.kak.',
    '....kdk.kdk.',
    '...kkk..kkk.',
  ] };
  S.healer = { pal: { k: '#10140e', g: '#5f9a54', l: '#8fcf6a', d: '#3a6234', f: '#e8b48a', w: '#8a5a2e', y: '#fff0a0', e: '#2a1d14' }, px: [
    '..........y.',
    '....kkk..yyy',
    '...kgggk..y.',
    '..kgllggk.w.',
    '..kgfefgk.w.',
    '..kgffffk.w.',
    '...kgggkk.w.',
    '..kgglggfkw.',
    '.kgggllgkkw.',
    '.kggggggk.w.',
    '.kdgggggk.w.',
    '.kdggggdk.w.',
    '.kddggddk.w.',
    '.kdddddddk..',
    '..kkkkkkkk..',
    '............',
  ] };
  S.rogue = { pal: { k: '#0e0d10', c: '#3a3446', l: '#5e5470', d: '#24202c', f: '#e8b48a', e: '#ffdf6b', b: '#c9d6e0', r: '#8a2a2a' }, px: [
    '............',
    '....kkkk....',
    '...kccclk...',
    '..kcccccck..',
    '..kcfefeck..',
    '..kcffffck..',
    '...krrrrk...',
    '..kccllcck.b',
    '.kcccllcckbk',
    'bkfcccccfk..',
    'kbkcccccck..',
    '...kccdcck..',
    '...kck.kck..',
    '...kck.kck..',
    '..kkdk.kdkk.',
    '............',
  ] };
  S.mage = { pal: { k: '#140c0a', h: '#c8453a', l: '#ee7a5a', d: '#8a2a1f', f: '#e8b48a', y: '#f2c14e', w: '#8a5a2e', o: '#ffd27a', e: '#2a1d14' }, px: [
    '.....k......',
    '....khk..ko.',
    '....khhk.oo.',
    '...khhlhk.w.',
    '..kkyyyykkw.',
    '...kfefek.w.',
    '...kffffk.w.',
    '..khhlhhhkw.',
    '.khhhlhhhkf.',
    '.khhhhhhhkw.',
    '.kdhhyhhhkw.',
    '.kdhhyhhdkw.',
    '.kddhhhhddk.',
    '.kdddddddk..',
    '..kkkkkkkk..',
    '............',
  ] };
  S.necro = { pal: { k: '#0c0a10', p: '#5a3a7a', l: '#8a6aa8', d: '#2e1f40', b: '#e8dfc8', e: '#7affc8', w: '#5a4a3a' }, px: [
    '.........bb.',
    '....kkk.kbeb',
    '...kpppk.bb.',
    '..kpplppk.w.',
    '..kpdedek.w.',
    '..kpddddk.w.',
    '...kpppkk.w.',
    '..kpplpppkw.',
    '.kppplppkbw.',
    '.kpppppppkw.',
    '.kdpppppdkw.',
    '.kdppbppdkw.',
    '.kddpppddk..',
    '.kdddddddk..',
    '..kkkkkkkk..',
    '............',
  ] };
  S.minion = { pal: { k: '#18140f', b: '#d8cfb8', d: '#a89c80', e: '#7affc8' }, px: [
    '..kkkk..',
    '.kbbbbk.',
    '.kekekk.',
    '.kbbbbk.',
    '..kbbk..',
    '.kbdbdk.',
    '..kbbk..',
    '.kb..bk.',
    '.kk..kk.',
  ] };

  function render(name, scale, hue) {
    const sp = S[name];
    if (!sp) return null;
    const h = sp.px.length, w = Math.max(...sp.px.map(r => r.length));
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const x = c.getContext('2d');
    for (let j = 0; j < h; j++) {
      const row = sp.px[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        let col = sp.pal[ch];
        if (!col) continue;
        if (hue && ch !== 'k' && ch !== 'e' && ch !== 'w' && ch !== 'p' && ch !== 'i' && ch !== 'y') col = shift(col, hue);
        x.fillStyle = col;
        x.fillRect(i * scale, j * scale, scale, scale);
      }
    }
    return c;
  }

  function shift(hex, deg) {
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    h = (h + deg + 360) % 360;
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return 'rgb(' + f(0) + ',' + f(8) + ',' + f(4) + ')';
  }


  // ---------- item icons (12x12): one per class and slot; 'a' takes the rarity colour ----------
  const ICONS = {"shield": [".kkkkkkkkkk.", "klllmmmmmmdk", "klmmmaammmdk", "kmmmmaammmdk", "kmmaaaaaammk", "kmmaaaaaammk", "kmmmmaammmdk", ".kmmmaammdk.", ".kmmmaammdk.", "..kmmmmmdk..", "...kmmmdk...", "....kkkk...."], "orb": ["....kkkk....", "...kllaak...", "..klaaaaak..", "..kaaaaaak..", "..kaaaaaak..", "...kaaaak...", "....kkkk....", "...kmmmmk...", "..kmllmmmk..", "..kmmmmmdk..", "...kkkkkk...", "............"], "tome": ["............", ".kkkkkkkkkk.", ".kmmmmmmmmlk", ".kmmaaaammlk", ".kmmalaammlk", ".kmmaaaammlk", ".kmmmmmmmmlk", ".kmmmmmmmmlk", ".kddddddddlk", ".kkkkkkkkkkk", "............", "............"], "helm": ["............", "....kkkk....", "...kllmmk...", "..klmmmmmk..", "..kmmmmmmk..", "..kmkkkkmk..", "..kmkaakmk..", "..kmkkkkmk..", "..kmmmmmmk..", "..kdmkkmdk..", "..kkk..kkk..", "............"], "circlet": ["............", "............", ".....kk.....", "....kaak....", "..kk.kk.kk..", ".kalkmmkalk.", ".kmmmmmmmmk.", ".kdmmmmmmdk.", "..kkkkkkkk..", "............", "............", "............"], "pants": ["............", "..kkkkkkkk..", "..kaaaaaak..", "..kmmllmmk..", "..kmmllmmk..", "..kmmkkmmk..", "..kmmkkmmk..", "..kmmkkmmk..", "..kmmkkmmk..", "..kdmkkmdk..", "..kkk..kkk..", "............"], "boots": ["............", "...kkkkk....", "...kmllk....", "...kmllk....", "...kaaak....", "...kmllk....", "...kmllk....", "...kmllkkk..", "..kmmmmmmlk.", "..kmmmmmmmk.", "..kdddddddk.", "..kkkkkkkkk."],"sword":["..........kk",".........klk","........klmk",".......klmk.","......klmk..",".....klmk...",".kk.klmk....",".kakmmk.....","..kaak......","..kwkak.....",".kwk.kk.....",".kk........."],"staff":["....kkkk....","...kallak...","...kaalak...","...kaaaak...","....kkkk....","....kggk....",".....kwk....",".....kwk....",".....kwk....",".....kwk....",".....kwk....",".....kkk...."],"dagger":["............","..........k.",".........klk","........klk.",".......klk..","......klk...","....kkmk....","....kakk....","...kwkak....","..kwk..k....","..kk........","............"],"wand":[".......kkk..","......kaalk.",".....kalaak.",".....kaaaak.","......kaak..","......kwk...",".....kwk....","....kwk.....","...kwk......","..kwk.......",".kak........",".kk........."],"scythe":[".kkkkkk.....","klllmmmkk...","kmkkkkkmwk..","kk....kwk...","......kwk...",".....kwk....",".....kwk....","....kwk.....","....kwk.....","...kak......","...kwk......","...kk......."],"plate":[".kkk....kkk.","klmmkkkkmmlk","kmmmllllmmmk","kmmmmllmmmmk",".kkmmllmmkk.","..kmmllmmk..","..kaaaaaak..","..kmmmmmmk..","..kmmmmmmk..","..kdmmmmdk..","..kkkkkkkk..","............"],"robe":["...kk..kk...","..kmmkkmmk..",".kmmmlammmk.","kmmmmlammmmk","kkkmmlammkkk","..kmmlammk..","..kaaaaaak..","..kmmlammk..",".kmmmlammmk.",".kmmmlammmk.","kdmmmlammmdk","kkkkkkkkkkkk"],"hood":["....kkkk....","...kmmmmk...","..kmmllmmk..","..kmkkkkmk..",".kmkdddddmk.",".kmmkkkkmmk.","kmmmmaammmmk","kmmmmlammmmk","kkmmmlammmkk",".kmmmlammmk.",".kdmmlammdk.",".kkkkkkkkkk."],"badge":[".kkkkkkkkkk.",".kmllmmmmmk.",".kmaaaaaamk.",".kmaalaaamk.",".kmaalaaamk.",".kmaaaaaamk.","..kmaaaamk..","..kmaaaamk..","...kmaamk...","....kmmk....",".....kk.....","............"],"amulet":["...kkkkkk...","..kd....dk..",".kd......dk.",".kd......dk.","..kd....dk..","...kd..dk...","....kkkk....","...kmaamk...","..kmaalamk..","..kmaaaamk..","...kmaamk...","....kkkk...."],"ring":["....kkkk....","...kaalak...","...kaaaak...","....kkkk....","...kmllmk...","..kmkkkkmk..",".kmk....kmk.",".kmk....kmk.",".kdk....kdk.","..kdkkkkdk..","...kddddk...","....kkkk...."],"crystal":[".....kk.....","....kalk....","...kaalak...","...kaalak...","..kaaalaak..","..kaaalaak..","..kaaalaak..","...kaalak...","...kaaaak...","....kaak....",".....kk.....","............"],"skull":["...kkkkkk...","..kmmmmmmk..",".kmllmmmmmk.",".kmkkmmkkmk.",".kmkakmkakk.",".kmkkmmkkmk.",".kmmmkkmmmk.","..kmmmmmmk..","...kmkmkmk..","...kkkkkkk..","....kaak....",".....kk....."]};
  const ITEM_SHAPE = {
    main: { tank: 'sword', healer: 'staff', rogue: 'dagger', mage: 'wand', necro: 'scythe' },
    off: { tank: 'shield', healer: 'tome', rogue: 'dagger', mage: 'orb', necro: 'tome' },
    head: { tank: 'helm', healer: 'circlet', rogue: 'hood', mage: 'circlet', necro: 'hood' },
    neck: { tank: 'badge', healer: 'amulet', rogue: 'amulet', mage: 'crystal', necro: 'skull' },
    chest: { tank: 'plate', healer: 'plate', rogue: 'plate', mage: 'plate', necro: 'plate' },
    robe: { tank: 'robe', healer: 'robe', rogue: 'robe', mage: 'robe', necro: 'robe' },
    legs: { tank: 'pants', healer: 'pants', rogue: 'pants', mage: 'pants', necro: 'pants' },
    feet: { tank: 'boots', healer: 'boots', rogue: 'boots', mage: 'boots', necro: 'boots' },
    ring: { tank: 'ring', healer: 'ring', rogue: 'ring', mage: 'ring', necro: 'ring' },
  };
  ITEM_SHAPE.weapon = ITEM_SHAPE.main; ITEM_SHAPE.armor = ITEM_SHAPE.chest; ITEM_SHAPE.trinket = ITEM_SHAPE.neck;
  const KIND = { main: 'weapon', weapon: 'weapon', neck: 'trinket', trinket: 'trinket', ring: 'trinket' };
  const CLS_CLOTH = { tank: ['#8fa3b5', '#c9d6e0', '#5b6b7a'], healer: ['#5f9a54', '#8fcf6a', '#3a6234'], rogue: ['#4a4258', '#6e6484', '#2a2533'], mage: ['#b8443a', '#ee7a5a', '#7a2a1f'], necro: ['#5a3a7a', '#8a6aa8', '#2e1f40'] };
  const RAR_COL = { common: '#d8cfb8', fine: '#8fcf6a', rare: '#6cc4e8', epic: '#c78bff', set: '#f2c14e' };
  const iconCache = {};
  function itemIcon(cls, slot, rar, scale) {
    scale = scale || 4;
    const key = cls + slot + rar + scale;
    if (iconCache[key]) return iconCache[key];
    const shape = ICONS[(ITEM_SHAPE[slot] || ITEM_SHAPE.ring)[cls]];
    const cloth = CLS_CLOTH[cls], a = RAR_COL[rar] || RAR_COL.common;
    const kind = slot === 'off' && cls === 'rogue' ? 'weapon' : KIND[slot] || 'armor';
    const pal = kind === 'armor' ? { k: '#120d0a', m: cloth[0], l: cloth[1], d: cloth[2], a }
      : kind === 'weapon' ? { k: '#120d0a', m: '#9aa8b6', l: '#eef3f7', d: '#5b6b7a', w: '#8a5a2e', g: cloth[1], a }
      : { k: '#120d0a', m: cls === 'necro' ? '#e8dfc8' : '#d9a441', l: cls === 'necro' ? '#ffffff' : '#ffe7a0', d: cls === 'necro' ? '#a89c80' : '#8a6420', a };
    const c = document.createElement('canvas'); c.width = c.height = 12 * scale;
    const x = c.getContext('2d');
    shape.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const col = pal[row[i]]; if (col) { x.fillStyle = col; x.fillRect(i * scale, j * scale, scale, scale); } } });
    return (iconCache[key] = c.toDataURL());
  }
  const spriteCache = {};
  function spriteURL(name, scale, hue) {
    const key = name + scale + (hue || 0);
    if (!spriteCache[key]) { const c = render(name, scale, hue); spriteCache[key] = c ? c.toDataURL() : ''; }
    return spriteCache[key];
  }

  root.LHSprites = { render, itemIcon, spriteURL, list: Object.keys(S) };
})(this);
