// Sigil exchange: players sell Sigils to each other for gold. A listing holds its Sigils in escrow
// (taken from the seller's wallet when listed). Listings live under sig# sorted by gold per Sigil, with a
// pointer under sigsell#<seller>. The buyer's Sigils go straight to their wallet, and the gold reaches
// the seller's mailbox as a 'sale' letter, like a gear sale. Gold itself is kept by the game client.
const D = require('@aws-sdk/client-dynamodb'), crypto = require('crypto');
const db = new D.DynamoDBClient({}), { TABLE: T, WALLETS: W } = process.env;
const BAD = /(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|bitch|whore|dick|cock|puss|slut|porn|retard)/i;
const res = (c, b) => ({ statusCode: c, body: JSON.stringify(b) }), E = { error: 1 };
const pidOf = s => crypto.createHash('sha256').update('lh:' + s).digest('hex').slice(0, 16);
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
const okName = n => /^[A-Za-z][A-Za-z '\-]{1,15}$/.test(n) && !BAD.test(n.replace(/[^a-z]/gi, ''));
const newId = () => Date.now().toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex');
const row = i => ({ id: i.sk.S, seller: i.seller.S, name: i.name.S, n: +i.n.N, price: +i.price.N, at: +i.at.N });
const q = (pk, o) => db.send(new D.QueryCommand(Object.assign({ TableName: T, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S(pk) } }, o)));
const credit = (sub, n) => ({ Update: { TableName: W, Key: { userId: S(sub) }, UpdateExpression: 'SET bal = if_not_exists(bal, :g) + :n, own = if_not_exists(own, :o)',
  ExpressionAttributeValues: { ':g': N(100), ':n': N(n), ':o': { SS: ['f.plain'] } } } });
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, E);
  const me = pidOf(cl.sub), rk = e.routeKey;
  let b = {}; if (e.body) { try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body); } catch (x) { return res(400, E); } }
  try {
    if (rk === 'GET /sigils') {
      const [all, mine] = await Promise.all([q('sig#', { Limit: 60 }), q('sigsell#' + me)]);
      return res(200, { me, listings: (all.Items || []).map(row), mine: (mine.Items || []).map(row) });
    }
    if (rk === 'POST /sigils/list') {
      const n = Math.floor(+b.n), p = Math.floor(+b.price);
      if (!(n >= 1 && n <= 1e5 && p >= 1 && p < 1e15)) return res(400, E);
      if (!okName(String(b.name || ''))) return res(400, { error: 'name' });
      if ((await q('sigsell#' + me, { Select: 'COUNT' })).Count >= 5) return res(400, { error: 'full' });
      const id = String(Math.round(p / n * 1000)).padStart(18, '0') + '-' + newId();
      const body = { seller: S(me), u: S(cl.sub), name: S(b.name), n: N(n), price: N(p), at: N(Date.now()) };
      await db.send(new D.TransactWriteItemsCommand({ TransactItems: [
        { Update: { TableName: W, Key: { userId: S(cl.sub) }, UpdateExpression: 'SET bal = bal - :n', ConditionExpression: 'bal >= :n', ExpressionAttributeValues: { ':n': N(n) } } },
        { Put: { TableName: T, Item: Object.assign({ pk: S('sig#'), sk: S(id) }, body) } },
        { Put: { TableName: T, Item: Object.assign({ pk: S('sigsell#' + me), sk: S(id) }, body) } }] }));
      return res(200, { ok: true, id });
    }
    if (rk === 'POST /sigils/buy' || rk === 'POST /sigils/cancel') {
      const id = String(b.id || ''), buy = rk === 'POST /sigils/buy';
      if (!/^\d{18}-[0-9a-z]{15}$/.test(id)) return res(400, E);
      const g = await db.send(new D.GetItemCommand({ TableName: T, Key: { pk: S('sig#'), sk: S(id) } }));
      if (!g.Item) return res(404, { error: 'gone' });
      const L = row(g.Item);
      if (buy ? L.seller === me : L.seller !== me) return res(403, E);
      if (buy && !okName(String(b.name || ''))) return res(400, { error: 'name' });
      const ops = [
        { Delete: { TableName: T, Key: { pk: S('sig#'), sk: S(id) }, ConditionExpression: 'attribute_exists(sk)' } },
        { Delete: { TableName: T, Key: { pk: S('sigsell#' + L.seller), sk: S(id) } } },
        credit(buy ? cl.sub : g.Item.u.S, L.n)];
      if (buy) ops.push({ Put: { TableName: T, Item: { pk: S('inbox#' + L.seller), sk: S(newId()), type: S('sale'), from: S(me), fromName: S(b.name),
        item: S(JSON.stringify({ sig: L.n })), gold: S(L.price), at: N(Date.now()), ttl: N(Math.floor(Date.now() / 1000) + 5184000) } } });
      await db.send(new D.TransactWriteItemsCommand({ TransactItems: ops }));
      const w = await db.send(new D.GetItemCommand({ TableName: W, Key: { userId: S(cl.sub) } }));
      return res(200, { ok: true, n: L.n, price: L.price, bal: w.Item ? +w.Item.bal.N : 0 });
    }
  } catch (x) { if (x.name === 'TransactionCanceledException') return res(409, { error: 'state' }); throw x; }
  return res(404, E);
};
