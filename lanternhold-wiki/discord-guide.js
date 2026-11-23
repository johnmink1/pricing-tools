#!/usr/bin/env node
/* Export the in-game Delver's Guide (GUIDE in lanternhold/ui.js) as Discord markdown, for the bot's
   #lanternhold-guide channel (born2game-bot data/lanternhold_guide.json).

     node lanternhold-wiki/discord-guide.js lanternhold > ../born2game-bot/data/lanternhold_guide.json

   The bot reposts the guide by itself when this file changes. No dependencies. */
'use strict';
const fs = require('fs'), path = require('path');
const GAME = path.resolve(process.argv[2] || path.join(__dirname, '..', 'lanternhold'));
const L = require(path.join(GAME, 'core.js'));
const UI = fs.readFileSync(path.join(GAME, 'ui.js'), 'utf8');
const at = UI.indexOf('const GUIDE = '), end = UI.indexOf('\n  ];', at);
if (at < 0 || end < 0) { console.error('GUIDE not found in ui.js'); process.exit(1); }
const GUIDE = new Function('L', 'return (' + UI.slice(at + 'const GUIDE = '.length, end + 4) + ');')(L);

const ENT = { '&times;': '×', '&sup2;': '²', '&middot;': '·', '&amp;': '&', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘', '&nbsp;': ' ' };
const md = h => h
  .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (m, u, t) => t === 'join here' ? 'join here: ' + u : t + ' (' + u + ')')
  .replace(/<\/?b>/g, '**').replace(/<\/?i>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&[a-z0-9#]+;/gi, e => ENT[e] || e);

const out = GUIDE.map(c => ({
  title: c.name,
  text: c.topics.map(([t, , sum, pts]) => '**' + md(t) + '**: ' + md(sum) + '\n' + pts.map(p => '• ' + md(p)).join('\n')).join('\n\n'),
}));
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
