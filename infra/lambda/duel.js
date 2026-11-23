// The Ember Ring duels (POST /arena/fight). The rest of the Ring (builds, kit, leaderboard) is in arena.js.
// The Ember Ring: Lanternhold's dueling pit. Only each player's own hero fights, one on one, against the saved
// build of another player's hero (async, like the rest of the multiplayer). The duel is fought here on the server.
// Wins earn Laurels and rating; Laurels buy ranks in the Ringwarden kit, gear that works only in the Ring
// (Edge: more damage to heroes, Resolve: less damage from heroes). Sigils and real money never touch any of it.
const D = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');
const db = new D.DynamoDBClient({}), { ARENA: T, HEROES: H } = process.env;
const res = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
const pidOf = sub => crypto.createHash('sha256').update('lh:' + sub).digest('hex').slice(0, 16);
// Keep KIT, the rank gates, the cost and stats() in step with the Ember Ring part of the game (v_pvp.js).
// Per rank: [Resolve, Edge, +hp share, +attack share]. Ranks 6-10 need a peak rating of 1300, 11-15 need 1600.
const KIT = [[5, 0, .02, 0], [7, 0, .015, 0], [0, 5, 0, .015], [3, 3, .01, .01], [0, 7, 0, .02]];
const gate = r => r >= 10 ? 1600 : r >= 5 ? 1300 : 0, cost = r => 60 + 30 * r;
const EMAX = 10, EINT = 30 * 6e4, START = 1000;
function stats(x) {
  let R = 0, E = 0, hp = 1, at = 1;
  x.k.forEach((r, i) => { const p = KIT[i]; R += p[0] * r; E += p[1] * r; hp += p[2] * r; at += p[3] * r; });
  return { hp: Math.round((800 + 28 * x.v) * hp), at: Math.round((100 + 4 * x.m) * at), E, R, c: x.c };
}
const n = (i, k, d) => i && i[k] ? +i[k].N : d;
const row = i => ({ id: i.pid.S, n: i.n.S, c: i.c.S, sd: i.sd.S, lv: n(i, 'lv', 1), m: n(i, 'm', 0), v: n(i, 'v', 0), k: (i.k ? i.k.S : '0.0.0.0.0').split('.').map(Number),
  r: n(i, 'r', START), pk: n(i, 'pk', START), w: n(i, 'w', 0), l: n(i, 'l', 0), dw: n(i, 'dw', 0), dl: n(i, 'dl', 0), ll: n(i, 'll', 0), et: n(i, 'et', 0), fd: i.fd ? i.fd.S : '' });
const pub = x => ({ id: x.id, n: x.n, c: x.c, sd: x.sd, lv: x.lv, r: x.r, w: x.w, l: x.l, k: x.k, s: stats(x) });
// One duel, 80 actions at most. Either hero may open. If both stand at the end, the healthier one wins.
function duel(A, B, rnd) {
  const f = [stats(A), stats(B)], log = [], o = rnd() < .5 ? 0 : 1;
  f.forEach(x => x.h = x.hp);
  for (let t = 0; t < 80 && f[0].h > 0 && f[1].h > 0; t++) {
    const i = (t + o) % 2, a = f[i], d = f[1 - i], r0 = rnd(), cr = r0 < (a.c === 'rogue' ? .25 : .12), ms = r0 > .9;
    const dmg = ms ? 0 : Math.round(a.at * (.7 + .6 * rnd()) * (cr ? (a.c === 'rogue' ? 2 : 1.7) : 1) * (1 + a.E / (a.E + 300)) * (1 - .5 * d.R / (d.R + 300)) *
      (d.c === 'tank' ? .85 : 1) * (a.c === 'mage' && t < 4 ? 1.7 : 1) * (t >= 40 ? 1.5 : 1));
    d.h -= dmg;
    const hl = Math.max(0, Math.min(a.hp - a.h, Math.round(a.c === 'healer' ? a.hp * .025 : a.c === 'necro' ? dmg * .2 : 0)));
    a.h += hl; log.push([i, dmg, ms ? 2 : cr ? 1 : 0, hl]);
  }
  return { win: f[1].h <= 0 || (f[0].h > 0 && f[0].h / f[0].hp >= f[1].h / f[1].hp), log, first: o };
}
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 1 });
  const me = pidOf(cl.sub), now = Date.now(), rk = e.routeKey, K = p => ({ pid: S(p) });
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 1 }); }
  const get = async (t, p) => (await db.send(new D.GetItemCommand({ TableName: t, Key: K(p), ConsistentRead: true }))).Item;
  const up = (p, x, v, c) => db.send(new D.UpdateItemCommand(Object.assign({ TableName: T, Key: K(p), UpdateExpression: x, ExpressionAttributeValues: v, ReturnValues: 'ALL_NEW' }, c ? { ConditionExpression: c } : {})));
  const mine = x => x && Object.assign(pub(x), { pk: x.pk, dw: x.dw, dl: x.dl, ll: x.ll, en: Math.max(0, EMAX - Math.ceil(Math.max(0, x.et - now) / EINT)), et: x.et });
  try {
    const x = await get(T, me), my = x && row(x);
    if (!my) return res(409, { error: 'build' });
    if (rk === 'POST /arena/fight') {
      const id = String(b.id || ''), y = /^[0-9a-f]{16}$/.test(id) && id !== me && await get(T, id), fo = y && row(y);
      if (!fo) return res(404, { error: 'foe' });
      if (my.et > now + (EMAX - 1) * EINT) return res(429, { error: 'tired' });
      let s = crypto.randomBytes(4).readUInt32LE(0);
      const rnd = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const d = duel(my, fo, rnd), w = d.win ? 1 : 0, ex = 1 / (1 + Math.pow(10, (fo.r - my.r) / 400));
      const dr = Math.round(32 * (w - ex)), fr = Math.round(16 * (w - ex)), day = new Date(now).toISOString().slice(0, 10), fw = w && my.fd !== day;
      // Laurels are a grind on purpose (John): a win is 8, up to 12 against a stronger hero, a loss 3, the day's first win +10.
      const ll = w ? 8 + Math.min(4, Math.max(0, Math.round((fo.r - my.r) / 50))) + (fw ? 10 : 0) : 3;
      const a = await up(me, 'SET r = :r, pk = :pk, et = :et, fd = :fd ADD ' + (w ? 'w' : 'l') + ' :one, ll :ll',
        { ':r': N(Math.max(0, my.r + dr)), ':pk': N(Math.max(my.pk, my.r + dr)), ':et': N(Math.max(my.et, now) + EINT), ':fd': S(fw ? day : my.fd || '-'), ':one': N(1), ':ll': N(ll), ':o': N(my.et) }, 'et = :o OR attribute_not_exists(et)');
      await up(id, 'SET r = :r ADD ' + (w ? 'dl :one' : 'dw :one, ll :d'), Object.assign({ ':r': N(Math.max(0, fo.r - fr)), ':one': N(1) }, w ? {} : { ':d': N(2) }));
      return res(200, { win: !!w, log: d.log, first: d.first, dr, ll, fw: !!fw, a: pub(my), b: pub(fo), me: mine(row(a.Attributes)) });
    }
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
  return res(404, { error: 1 });
};
