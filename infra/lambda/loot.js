// World boss loot (John, 2026-11-24): after an event, a seeded draw decides who gets the boss's Legendary (if one
// drops) and who gets each of its boss shards. Tickets = whole points of boss score (monsters' worth of damage, so
// every depth counts), at least one for anyone who hit. The seed is the event id, so every claim sees the same draw.
// Boss shards trade on their own market (pk sh# for listings, ss#<seller> for the seller's pointers); the gold
// goes to the seller's mailbox as a 'sale' letter, like the gear market.
const D = require('@aws-sdk/client-dynamodb'), crypto = require('crypto');
const db = new D.DynamoDBClient({}), { BOSS: B, TRADE: T } = process.env;
const res = (c, b) => ({ statusCode: c, body: JSON.stringify(b || { error: 1 }) });
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
const pid = s => crypto.createHash('sha256').update('lh:' + s).digest('hex').slice(0, 16);
const rnd = (id, k) => parseInt(crypto.createHash('sha256').update(id + '#' + k).digest('hex').slice(0, 8), 16) / 4294967296;
const LEG = 0.12, LEGMAX = 0.75, SH0 = 5, SH1 = 3, WEEK = 6048e5;
const phases = t => { let k = 0, n = 1e3; while (t >= n && k < 30) { t -= n; n *= 2; k++; } return k; };
const end = id => Date.parse(id + 'T00:00:00Z') + (id === '2026-11-23' ? 4 : 3) * 864e5;
const boss = id => Math.floor(Date.parse(id + 'T00:00:00Z') / WEEK) % 4;
const ok = n => /^[A-Za-z][A-Za-z '-]{1,15}$/.test(n);
const nid = () => Date.now().toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex');
const q = async (t, k, v) => (await db.send(new D.QueryCommand({ TableName: t, KeyConditionExpression: k + '=:p', ExpressionAttributeValues: { ':p': S(v) } }))).Items || [];
const row = i => ({ id: i.sk.S, seller: i.seller.S, name: i.name.S, k: +i.k.N, n: +i.n.N, price: +i.price.N, at: +i.at.N });
// The whole draw for one event: { leg: pid or '', sh: { pid: shards }, tk: { pid: tickets }, all, ph }
function draw(id, rows) {
  const g = rows.find(i => i.s.S === '#'), ps = rows.filter(i => i.s.S !== '#' && +i.score.N > 0).sort((a, b) => a.s.S < b.s.S ? -1 : 1);
  const tk = {}; let all = 0; for (const p of ps) all += tk[p.s.S] = Math.max(1, Math.floor(+p.score.N));
  const pick = r => { let x = r * all; for (const p of ps) if ((x -= tk[p.s.S]) < 0) return p.s.S; return ps.length ? ps[ps.length - 1].s.S : ''; };
  const ph = phases(g ? +g.total.N : 0), sh = {};
  const leg = all && rnd(id, 'leg') < Math.min(LEGMAX, LEG * ph) ? pick(rnd(id, 'who')) : '';
  if (all) for (let i = 0; i < SH0 + SH1 * Math.min(ph, 10); i++) { const w = pick(rnd(id, 's' + i)); sh[w] = (sh[w] || 0) + 1; }
  return { leg, sh, tk, all, ph };
}
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401);
  const me = pid(cl.sub), now = Date.now(), rk = e.routeKey;
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400); }
  if (rk === 'POST /boss/loot') {
    const id = String(b.id || '');
    if (!/^\d{4}-\d\d-\d\d$/.test(id) || now < end(id)) return res(409, { error: 'open' });
    const rows = await q(B, 'w', id), d = draw(id, rows);
    if (!d.tk[me]) return res(404, { error: 'none' });
    try {
      await db.send(new D.UpdateItemCommand({ TableName: B, Key: { w: S(id), s: S(me) }, UpdateExpression: 'SET lc=:t', ConditionExpression: 'attribute_not_exists(lc)', ExpressionAttributeValues: { ':t': N(now) } }));
    } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'claimed' }); throw x; }
    const w = d.leg && rows.find(i => i.s.S === d.leg);
    return res(200, { ok: true, boss: boss(id), leg: d.leg === me, who: w && w.nm ? w.nm.S : '', sh: d.sh[me] || 0, tk: d.tk[me], all: d.all, ph: d.ph });
  }
  if (rk === 'GET /shards') {
    const l = (await q(T, 'pk', (e.queryStringParameters || {}).mine ? 'ss#' + me : 'sh#')).map(row);
    return res(200, { me, l });
  }
  if (rk === 'POST /shards/list') {
    const k = Math.floor(+b.k), n = Math.floor(+b.n), p = Math.floor(+b.price);
    if (!(k >= 0 && k < 4 && n >= 1 && n <= 99 && p >= 1 && p < 1e60) || !ok(String(b.name || ''))) return res(400);
    if ((await q(T, 'pk', 'ss#' + me)).length >= 10) return res(400, { error: 'full' });
    const id = nid(), it = { seller: S(me), name: S(b.name), k: N(k), n: N(n), price: N(p), at: N(now) };
    await db.send(new D.TransactWriteItemsCommand({ TransactItems: [{ Put: { TableName: T, Item: Object.assign({ pk: S('sh#'), sk: S(id) }, it) } }, { Put: { TableName: T, Item: Object.assign({ pk: S('ss#' + me), sk: S(id) }, it) } }] }));
    return res(200, { ok: true, id });
  }
  if (rk === 'POST /shards/buy' || rk === 'POST /shards/cancel') {
    const id = String(b.id || ''), buy = rk === 'POST /shards/buy';
    if (!/^[0-9a-z]{15}$/.test(id)) return res(400);
    const g = (await db.send(new D.GetItemCommand({ TableName: T, Key: { pk: S('sh#'), sk: S(id) } }))).Item;
    if (!g) return res(404, { error: 'gone' });
    const L = row(g);
    if (buy ? L.seller === me || !ok(String(b.name || '')) : L.seller !== me) return res(403);
    const ops = [{ Delete: { TableName: T, Key: { pk: S('sh#'), sk: S(id) }, ConditionExpression: 'attribute_exists(sk)' } }, { Delete: { TableName: T, Key: { pk: S('ss#' + L.seller), sk: S(id) } } }];
    if (buy) ops.push({ Put: { TableName: T, Item: { pk: S('inbox#' + L.seller), sk: S(nid()), type: S('sale'), from: S(me), fromName: S(b.name), item: S(JSON.stringify({ shard: L.k, n: L.n })), gold: S(L.price), at: N(now) } } });
    try { await db.send(new D.TransactWriteItemsCommand({ TransactItems: ops })); } catch (x) { if (x.name === 'TransactionCanceledException') return res(404, { error: 'gone' }); throw x; }
    return res(200, { ok: true, k: L.k, n: L.n, price: L.price });
  }
  return res(404);
};
