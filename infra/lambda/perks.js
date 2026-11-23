// Shared perks: Mercy's Blessing (public clock fed by real Mercy Corps donations) and the Lantern Pass (bought with Sigils).
const D = require('@aws-sdk/client-dynamodb');
const db = new D.DynamoDBClient({}), { WALLETS: W } = process.env;
const res = (c, b) => ({ statusCode: c, body: JSON.stringify(b) });
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
// Mercy's Blessing: every $10, 5 food items or toy given to the Grand War's Mercy Corps adds 2 hours for all
// players, up to 7 days ahead. GET /mercy (public) reads the war site's totals and keeps the clock in the wallets table.
let mercy = null, mercyAt = 0;
async function getMercy() {
  if (mercy && Date.now() - mercyAt < 3e5) return mercy;
  const m = await fetch('https://war.born2gamellc.com/api/mercy.json').then(x => x.json()), f = m.food || {}, t = m.toys || {};
  const pts = Math.floor((m.total || 0) / 10) + Math.floor((f.items || 0) / 5) + Math.floor((f.dollars || 0) / 10) + (t.items || 0) + Math.floor((t.dollars || 0) / 10);
  const now = Date.now(), K = { userId: S('#mercy') }, r = (await db.send(new D.GetItemCommand({ TableName: W, Key: K }))).Item;
  const old = r ? +r.pts.N : -1, was = r ? +r.until.N : 0;
  let until = was, at = r ? +r.at.N : 0;
  if (!r) { until = now + 864e5; at = now; }
  else if (pts > old) { until = Math.min(Math.max(now, was) + (pts - old) * 72e5, now + 6048e5); at = now; }
  if (pts !== old) {
    try {
      await db.send(new D.UpdateItemCommand({ TableName: W, Key: K, UpdateExpression: 'SET pts = :p, #u = :u, #a = :a', ConditionExpression: r ? 'pts = :o' : 'attribute_not_exists(userId)',
        ExpressionAttributeNames: { '#u': 'until', '#a': 'at' }, ExpressionAttributeValues: Object.assign({ ':p': N(pts), ':u': N(until), ':a': N(at) }, r ? { ':o': r.pts } : {}) }));
    } catch (x) { if (x.name !== 'ConditionalCheckFailedException') throw x; return { until: was, at }; }
  }
  mercy = { until, at, pts }; mercyAt = now;
  return mercy;
}
exports.handler = async (e) => {
  if (e.routeKey === 'GET /mercy') { try { return Object.assign(res(200, await getMercy()), { headers: { 'cache-control': 'public, max-age=120' } }); } catch (x) { return res(502, { error: 'mercy' }); } }
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 1 });
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 1 }); }
  // Sigils earned in play: daily quests (1 each, 2 more for all three) and rare finds, at most 15 found per UTC day.
  if (e.routeKey === 'POST /sigils/earn') {
    const K = { userId: S(cl.sub) }, w = (await db.send(new D.GetItemCommand({ TableName: W, Key: K, ConsistentRead: true }))).Item, day = new Date().toISOString().slice(0, 10);
    const same = !!(w && w.ed && w.ed.S === day), mask = same ? +w.eq.N : 0, dn = same ? +w.en.N : 0, bal = w && w.bal ? +w.bal.N : 100;
    let add = 0, nm = mask, nd = dn;
    if (b.kind === 'quest') {
      const i = b.i | 0;
      if (i < 0 || i > 3 || (i === 3 && (mask & 7) !== 7)) return res(400, { error: 1 });
      if (mask & (1 << i)) return res(409, { error: 'claimed', bal, mask });
      add = i === 3 ? 2 : 1; nm = mask | (1 << i);
    } else if (b.kind === 'drop') {
      add = Math.max(0, Math.min(b.n | 0, 15 - dn)); nd = dn + add;
      if (!add) return res(200, { ok: true, add: 0, bal, mask });
    } else return res(400, { error: 1 });
    try {
      await db.send(new D.UpdateItemCommand({ TableName: W, Key: K, UpdateExpression: 'SET bal = if_not_exists(bal, :g) + :a, ed = :d, eq = :m, en = :n, own = if_not_exists(own, :o)',
        ConditionExpression: same ? 'ed = :d AND eq = :om AND en = :on' : 'attribute_not_exists(ed) OR ed <> :d',
        ExpressionAttributeValues: Object.assign({ ':g': N(100), ':a': N(add), ':d': S(day), ':m': N(nm), ':n': N(nd), ':o': { SS: ['f.plain'] } }, same ? { ':om': N(mask), ':on': N(dn) } : {}) }));
    } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
    return res(200, { ok: true, add, bal: bal + add, mask: nm });
  }
  // Lantern Pass: 500 Sigils for 30 days of convenience perks, stacking onto any time left.
  // The same route sells a stat reset ({ what: 'respec' }) for 50 Sigils and the Bag of Holding ({ what: 'boh' }), once, for 6,500.
  if (e.routeKey === 'POST /store/pass') {
    const K = { userId: S(cl.sub) }, w = (await db.send(new D.GetItemCommand({ TableName: W, Key: K }))).Item, bh = b.what === 'boh', rs = bh || b.what === 'respec', c = bh ? 6500 : rs ? 50 : 500;
    const bal = w && w.bal ? +w.bal.N : 100, was = w && w.pass ? +w.pass.N : 0, until = Math.max(Date.now(), was) + 2592e6;
    if (bal < c) return res(400, { error: 'funds' });
    const v = { ':g': N(100), ':c': N(c), ':o': { SS: ['f.plain'] } };
    if (!rs) { v[':p'] = N(until); if (was) v[':w'] = N(was); }
    try {
      await db.send(new D.UpdateItemCommand({ TableName: W, Key: K, UpdateExpression: 'SET bal = if_not_exists(bal, :g) - :c, own = if_not_exists(own, :o)' + (bh ? ', boh = :c' : rs ? '' : ', pass = :p'),
        ConditionExpression: (bh ? 'attribute_not_exists(boh) AND ' : rs ? '' : (was ? 'pass = :w' : 'attribute_not_exists(pass)') + ' AND ') + '(attribute_not_exists(bal) OR bal >= :c)', ExpressionAttributeValues: v }));
    } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
    return res(200, rs ? { ok: true, bal: bal - c, boh: bh || undefined } : { ok: true, pass: until, bal: bal - c });
  }
  return res(404, { error: 1 });
};
