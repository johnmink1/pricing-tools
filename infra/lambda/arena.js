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
const gate = r => r >= 10 ? 1600 : r >= 5 ? 1300 : 0, cost = r => 40 + 25 * r;
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
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 1 });
  const me = pidOf(cl.sub), now = Date.now(), rk = e.routeKey, K = p => ({ pid: S(p) });
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 1 }); }
  const get = async (t, p) => (await db.send(new D.GetItemCommand({ TableName: t, Key: K(p), ConsistentRead: true }))).Item;
  const up = (p, x, v, c) => db.send(new D.UpdateItemCommand(Object.assign({ TableName: T, Key: K(p), UpdateExpression: x, ExpressionAttributeValues: v, ReturnValues: 'ALL_NEW' }, c ? { ConditionExpression: c } : {})));
  const mine = x => x && Object.assign(pub(x), { pk: x.pk, dw: x.dw, dl: x.dl, ll: x.ll, en: Math.max(0, EMAX - Math.ceil(Math.max(0, x.et - now) / EINT)), et: x.et });
  try {
    if (rk === 'GET /arena') {
      const all = [];
      let k; do { const r = await db.send(new D.ScanCommand({ TableName: T, ExclusiveStartKey: k })); all.push(...(r.Items || []).filter(i => i.n).map(row)); k = r.LastEvaluatedKey; } while (k);
      const m = all.find(x => x.id === me), r0 = m ? m.r : START;
      const top = all.slice().sort((x, y) => y.r - x.r || y.w - x.w), foes = all.filter(x => x.id !== me).sort((x, y) => Math.abs(x.r - r0) - Math.abs(y.r - r0)).slice(0, 8);
      for (let i = foes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [foes[i], foes[j]] = [foes[j], foes[i]]; }
      return res(200, { me: mine(m), rank: m ? top.indexOf(m) + 1 : 0, n: all.length, top: top.slice(0, 25).map(pub), foes: foes.slice(0, 4).map(pub) });
    }
    if (rk === 'PUT /arena') {
      // The build: the hero's name, class and banner come from the hero board; m and v are the log of the
      // hero's PvE damage and health without tonics, so deeper delvers are tougher, but only a little.
      const h = await get(H, me), c = x => Math.max(0, Math.min(60, Math.round((+x || 0) * 10) / 10));
      if (!h || !h.name || h.ban) return res(403, { error: 'hero' });
      const r = await up(me, 'SET n = :n, c = :c, sd = :s, lv = :l, m = :m, v = :v, t = :t, r = if_not_exists(r, :r), pk = if_not_exists(pk, :r)', { ':n': h.name, ':c': h.cls, ':s': h.sd || S('unsworn'), ':l': h.lv, ':m': N(c(b.m)), ':v': N(c(b.v)), ':t': N(now), ':r': N(START) });
      return res(200, { me: mine(row(r.Attributes)) });
    }
    const x = await get(T, me), my = x && row(x);
    if (!my) return res(409, { error: 'build' });
    if (rk === 'POST /arena/kit') {
      const p = Math.floor(b.p), r = my.k[p];
      if (!(p >= 0 && p < 5) || r >= 15) return res(400, { error: 'piece' });
      if (my.pk < gate(r)) return res(409, { error: 'rating', need: gate(r) });
      if (my.ll < cost(r)) return res(409, { error: 'laurels' });
      const k = my.k.slice(); k[p]++;
      const a = await up(me, 'SET k = :k, ll = ll - :c', { ':k': S(k.join('.')), ':c': N(cost(r)), ':o': S(my.k.join('.')) }, 'll >= :c AND (k = :o OR attribute_not_exists(k))');
      return res(200, { me: mine(row(a.Attributes)) });
    }
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
  return res(404, { error: 1 });
};
