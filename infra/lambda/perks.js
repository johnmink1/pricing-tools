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
  // Lantern Pass: 500 Sigils for 30 days of convenience perks, stacking onto any time left.
  if (e.routeKey === 'POST /store/pass') {
    const K = { userId: S(cl.sub) }, w = (await db.send(new D.GetItemCommand({ TableName: W, Key: K }))).Item;
    const bal = w && w.bal ? +w.bal.N : 100, was = w && w.pass ? +w.pass.N : 0, until = Math.max(Date.now(), was) + 2592e6;
    if (bal < 500) return res(400, { error: 'funds' });
    try {
      await db.send(new D.UpdateItemCommand({ TableName: W, Key: K, UpdateExpression: 'SET bal = if_not_exists(bal, :g) - :c, pass = :p, own = if_not_exists(own, :o)',
        ConditionExpression: (was ? 'pass = :w' : 'attribute_not_exists(pass)') + ' AND (attribute_not_exists(bal) OR bal >= :c)',
        ExpressionAttributeValues: Object.assign({ ':g': N(100), ':c': N(500), ':p': N(until), ':o': { SS: ['f.plain'] } }, was ? { ':w': N(was) } : {}) }));
    } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
    return res(200, { ok: true, pass: until, bal: bal - 500 });
  }
  return res(404, { error: 1 });
};
