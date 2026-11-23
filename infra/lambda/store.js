// Sigil packs bought in the Born 2 Game store (Wix Pricing Plans). The game sends the player's Wix member
// token; we ask Wix who that member is and which plans they paid for, so nothing the client says is trusted.
// Each store account links to one game account (wix#<member>), and each paid order is credited once
// (wixord#<order>). No admin key is needed: a member token can read that member's own orders.
const D = require('@aws-sdk/client-dynamodb');
const db = new D.DynamoDBClient({}), { TABLE: T, WALLETS: W, PACKS } = process.env;
const PACK = Object.fromEntries(PACKS.split(',').map(p => p.split(':')).map(([k, n]) => [k, +n]));
const res = (c, b) => ({ statusCode: c, body: JSON.stringify(b) });
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
const wix = async (path, tok) => {
  const r = await fetch('https://www.wixapis.com' + path, { headers: { Authorization: tok } });
  if (!r.ok) throw Object.assign(new Error('wix ' + r.status), { st: r.status });
  return r.json();
};
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 1 });
  if (e.routeKey !== 'POST /store/sync') return res(404, { error: 1 });
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 1 }); }
  const tok = String(b.token || '');
  if (tok.length < 20 || tok.length > 4000) return res(400, { error: 1 });
  let m;
  try { m = (await wix('/members/v1/members/my', tok)).member; } catch (x) { return res(401, { error: 'wix' }); }
  if (!m || !m.id) return res(401, { error: 'wix' });
  const mid = m.id, name = String((m.profile && m.profile.nickname) || (m.loginEmail || '').replace(/@.*/, '') || 'Store account').slice(0, 40);
  // Claim the link, or confirm it is already ours.
  try {
    await db.send(new D.PutItemCommand({ TableName: T, Item: { pk: S('wix#' + mid), sk: S('link'), u: S(cl.sub), name: S(name), at: N(Date.now()) },
      ConditionExpression: 'attribute_not_exists(pk) OR u = :u', ExpressionAttributeValues: { ':u': S(cl.sub) } }));
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'taken' }); throw x; }
  let orders = [];
  try { orders = (await wix('/pricing-plans/v2/member/orders?limit=100', tok)).orders || []; } catch (x) { return res(502, { error: 'orders' }); }
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
  const w = await db.send(new D.GetItemCommand({ TableName: W, Key: { userId: S(cl.sub) } }));
  return res(200, { ok: true, name, added, bal: w.Item && w.Item.bal ? +w.Item.bal.N : 100 });
};
