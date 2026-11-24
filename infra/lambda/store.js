// Sigil packs bought in the Born 2 Game store (Wix Pricing Plans). The game sends the player's Wix member
// token; we ask Wix who that member is and which plans they paid for, so nothing the client says is trusted.
// Each store account links to one game account (wix#<member>), and each paid order is credited once
// (wixord#<order>). No admin key is needed: a member token can read that member's own orders.
const D = require('@aws-sdk/client-dynamodb');
const db = new D.DynamoDBClient({}), { TABLE: T, WALLETS: W, PACKS, SUB } = process.env;
const PACK = Object.fromEntries(PACKS.split(',').map(p => p.split(':')).map(([k, n]) => [k, +n]));
const res = (c, b) => ({ statusCode: c, body: JSON.stringify(b) });
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
const wix = async (path, tok) => {
  const r = await fetch('https://www.wixapis.com' + path, { headers: { Authorization: tok } });
  if (!r.ok) throw Object.assign(new Error('wix ' + r.status), { st: r.status });
  return r.json();
};
// Lantern Surge: each credited pack lights a shared buff for every player (+25% gold and XP), 30 minutes per
// 500 Sigils, added to the time left and capped at 24 hours ahead. The clock is '#surge' in the wallets table.
const SK = { userId: S('#surge') };
exports.handler = async (e) => {
  if (e.routeKey === 'GET /surge') {
    const r = (await db.send(new D.GetItemCommand({ TableName: W, Key: SK }))).Item;
    return Object.assign(res(200, { until: r ? +r.until.N : 0, at: r ? +r.at.N : 0 }), { headers: { 'cache-control': 'public, max-age=30' } });
  }
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 1 });
  if (e.routeKey !== 'POST /store/sync') return res(404, { error: 1 });
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 1 }); }
  const tok = String(b.token || '');
  if (tok.length < 20 || tok.length > 4000) return res(400, { error: 1 });
  let m;
  try { m = (await wix('/members/v1/members/my', tok)).member; } catch (x) { console.log('me', x.st || x.message); return res(401, { error: 'wix' }); }
  if (!m || !m.id) return res(401, { error: 'wix' });
  const mid = m.id, name = String((m.profile && m.profile.nickname) || (m.loginEmail || '').replace(/@.*/, '') || 'Store account').slice(0, 40);
  // Claim the link, or confirm it is already ours.
  try {
    await db.send(new D.PutItemCommand({ TableName: T, Item: { pk: S('wix#' + mid), sk: S('link'), u: S(cl.sub), name: S(name), at: N(Date.now()) },
      ConditionExpression: 'attribute_not_exists(pk) OR u = :u', ExpressionAttributeValues: { ':u': S(cl.sub) } }));
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') { console.log('taken', mid); return res(409, { error: 'taken' }); } throw x; }
  // Wix caps this list at 50 a page (limit=100 is a 400, which broke every sync until 24 Nov 2026), so page through.
  let orders = [];
  try {
    for (let off = 0; off < 500; off += 50) {
      const pg = (await wix('/pricing-plans/v2/member/orders?limit=50&offset=' + off, tok)).orders || [];
      orders = orders.concat(pg); if (pg.length < 50) break;
    }
  } catch (x) { console.log('orders', x.st || x.message); return res(502, { error: 'orders' }); }
  console.log('sync', mid, orders.length, orders.map(o => o.planId.slice(0, 8) + ':' + o.lastPaymentStatus + ':' + (o.buyer && o.buyer.memberId === mid)).join(' '));
  let added = 0;
  for (const o of orders) {
    const n = PACK[o.planId];
    if (!n || o.lastPaymentStatus !== 'PAID' || (o.buyer && o.buyer.memberId !== mid)) continue;
    try {
      await db.send(new D.TransactWriteItemsCommand({ TransactItems: [
        { Put: { TableName: T, Item: { pk: S('wixord#' + o.id), sk: S('-'), u: S(cl.sub), m: S(mid), n: N(n), at: N(Date.now()) }, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Update: { TableName: W, Key: { userId: S(cl.sub) }, UpdateExpression: 'SET bal = if_not_exists(bal, :g) + :n, own = if_not_exists(own, :o)',
          ExpressionAttributeValues: { ':g': N(100), ':n': N(n), ':o': { SS: ['f.plain'] } } } }] }));
      added += n;
    } catch (x) { if (x.name !== 'TransactionCanceledException') throw x; }
  }
  if (added) {
    const now = Date.now(), r = (await db.send(new D.GetItemCommand({ TableName: W, Key: SK }))).Item;
    const until = Math.min(Math.max(now, r ? +r.until.N : 0) + added * 3600, now + 864e5);
    await db.send(new D.PutItemCommand({ TableName: W, Item: { userId: S('#surge'), until: N(until), at: N(now) } }));
  }
  // Lanternholder: the recurring monthly plan. Its perks last to the end of the paid cycle plus a day of grace,
  // and each sync (the game runs one on every load) moves that date with the renewals.
  let sub = 0;
  for (const o of orders) {
    if (o.planId !== SUB || o.status !== 'ACTIVE' || o.lastPaymentStatus !== 'PAID' || (o.buyer && o.buyer.memberId !== mid)) continue;
    const end = Date.parse((o.currentCycle && o.currentCycle.endedDate) || o.endDate || '') || Date.now() + 2592e6;
    sub = Math.max(sub, end + 864e5);
  }
  const w = (await db.send(new D.UpdateItemCommand({ TableName: W, Key: { userId: S(cl.sub) }, ReturnValues: 'ALL_NEW',
    UpdateExpression: 'SET bal = if_not_exists(bal, :g), #s = :s', ExpressionAttributeNames: { '#s': 'sub' }, ExpressionAttributeValues: { ':g': N(100), ':s': N(sub) } }))).Attributes;
  return res(200, { ok: true, name, added, bal: +w.bal.N, sub });
};
