/* Lanternhold pixel sprites. Each sprite is a grid of palette keys; '.' is empty. */
(function (root) {
  'use strict';
  const S = {};

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

  root.LHSprites = { render, list: Object.keys(S) };
})(this);
