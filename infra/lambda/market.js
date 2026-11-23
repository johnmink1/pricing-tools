// Market: list an item for gold, browse by class, buy, cancel. Listings live under mkt#<cls> with a
// pointer under sell#<seller>, written and removed together in transactions. Gold is paid into the
// seller's mailbox (inbox#<seller>) as a 'sale' letter they claim.
const D = require('@aws-sdk/client-dynamodb'), crypto = require('crypto');
const db = new D.DynamoDBClient({}), T = process.env.TABLE;
const CLS = ['tank', 'healer', 'rogue', 'mage', 'necro'], SLOT = ['main', 'off', 'head', 'neck', 'chest', 'robe', 'legs', 'feet', 'ring'], RAR = ['common', 'fine', 'rare', 'epic', 'set'], JOB = ['forage', 'smith', 'herb', 'armor', 'prospect', 'lamp'];
const SET = { vigil: 'tank', grace: 'healer', night: 'rogue', regalia: 'mage', crown: 'necro' };
const BAD = /(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|bitch|whore|dick|cock|puss|slut|porn|retard)/i;
const WEEK = 7 * 864e5;
const res = (c, b) => ({ statusCode: c, body: JSON.stringify(b) }), E = { error: 1 };
const pidOf = s => crypto.createHash('sha256').update('lh:' + s).digest('hex').slice(0, 16);
const S = v => ({ S: String(v) });
function item(i) {
  if (!i || !CLS.includes(i.cls) || !SLOT.includes(i.slot) || !RAR.includes(i.rar)) return null;
  const set = i.set || '', js = i.jset || '', a = i.aff || 0;
  if (set ? SET[set] !== i.cls || i.rar !== 'set' : js ? !JOB.includes(js) || i.rar !== 'set' : i.rar === 'set') return null;
  const ilvl = Math.floor(+i.ilvl), up = Math.floor(+i.up || 0);
  if (!(ilvl >= 1 && ilvl <= 1e6 && up >= 0 && up <= 10)) return null;
  return { cls: i.cls, slot: i.slot, rar: i.rar, set: set || undefined, jset: js || undefined, aff: JOB.includes(a.j) && a.v > 0 && a.v <= 0.5 ? { j: a.j, v: +a.v } : undefined, ilvl, up };
}
const okName = n => /^[A-Za-z][A-Za-z '\-]{1,15}$/.test(n) && !BAD.test(n.replace(/[^a-z]/gi, ''));
const price = p => { p = Math.floor(+p); return p >= 1 && p < 1e60 ? p : 0; };
const newId = () => Date.now().toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex');
const row = i => ({ id: i.sk.S, cls: i.cls.S, seller: i.seller.S, name: i.name.S, item: JSON.parse(i.item.S), price: +i.price.S, at: +i.at.N });
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, E);
  const me = pidOf(cl.sub), rk = e.routeKey, q = e.queryStringParameters || {};
  let b = {}; if (e.body) { try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body); } catch (x) { return res(400, E); } }
  if (rk === 'GET /market') {
    if (q.mine) {
      const r = await db.send(new D.QueryCommand({ TableName: T, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S('sell#' + me) } }));
      return res(200, { me, listings: (r.Items || []).map(row) });
    }
    if (!CLS.includes(q.cls)) return res(400, E);
    const r = await db.send(new D.QueryCommand({ TableName: T, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S('mkt#' + q.cls) }, ScanIndexForward: false, Limit: 80 }));
    const cut = Date.now() - WEEK;
    return res(200, { me, listings: (r.Items || []).map(row).filter(x => x.at > cut) });
  }
  if (rk === 'POST /market/list') {
    const it = item(b.item), p = price(b.price);
    if (!it || !p) return res(400, E);
    if (!okName(String(b.name || ''))) return res(400, { error: 'name' });
    const mine = await db.send(new D.QueryCommand({ TableName: T, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S('sell#' + me) }, Select: 'COUNT' }));
    if (mine.Count >= 25) return res(400, { error: 'full' });
    const id = newId(), body = { cls: S(it.cls), seller: S(me), name: S(b.name), item: S(JSON.stringify(it)), price: S(p), at: { N: String(Date.now()) } };
    await db.send(new D.TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: T, Item: Object.assign({ pk: S('mkt#' + it.cls), sk: S(id) }, body) } },
      { Put: { TableName: T, Item: Object.assign({ pk: S('sell#' + me), sk: S(id) }, body) } }] }));
    return res(200, { ok: true, id });
  }
  if (rk === 'POST /market/buy' || rk === 'POST /market/cancel') {
    const id = String(b.id || ''), cls = String(b.cls || '');
    if (!/^[0-9a-z]{15}$/.test(id) || !CLS.includes(cls)) return res(400, E);
    const g = await db.send(new D.GetItemCommand({ TableName: T, Key: { pk: S('mkt#' + cls), sk: S(id) } }));
    if (!g.Item) return res(404, { error: 'gone' });
    const L = row(g.Item), buy = rk === 'POST /market/buy';
    if (buy ? L.seller === me || L.at < Date.now() - WEEK : L.seller !== me) return res(403, E);
    if (buy && !okName(String(b.name || ''))) return res(400, { error: 'name' });
    const ops = [
      { Delete: { TableName: T, Key: { pk: S('mkt#' + cls), sk: S(id) }, ConditionExpression: 'attribute_exists(sk)' } },
      { Delete: { TableName: T, Key: { pk: S('sell#' + L.seller), sk: S(id) } } }];
    if (buy) ops.push({ Put: { TableName: T, Item: { pk: S('inbox#' + L.seller), sk: S(newId()), type: S('sale'), from: S(me), fromName: S(b.name), item: S(JSON.stringify(L.item)), gold: S(L.price), at: { N: String(Date.now()) } } } });
    try { await db.send(new D.TransactWriteItemsCommand({ TransactItems: ops })); }
    catch (x) { if (x.name === 'TransactionCanceledException') return res(404, { error: 'gone' }); throw x; }
    return res(200, { ok: true, item: L.item, price: L.price });
  }
  return res(404, E);
};
