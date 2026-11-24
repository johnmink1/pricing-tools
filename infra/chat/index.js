const D = require('@aws-sdk/client-dynamodb'), crypto = require('crypto');
const db = new D.DynamoDBClient({}), T = process.env.TABLE, H = process.env.HEROES;
const BAD = /(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|bitch|whore|dick|cock|puss|slut|porn|retard)/gi;
const LINK = /(https?:|www\.|\.(com|net|org|gg|io|ly|xyz)\b|discord)/i;
const res = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const pidOf = s => crypto.createHash('sha256').update('lh:' + s).digest('hex').slice(0, 16);
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
async function canParty(me, leader) {
  if (me === leader) return true;
  const r = await db.send(new D.GetItemCommand({ TableName: H, Key: { pid: S(leader) }, ProjectionExpression: 'inv' }));
  return !!(r.Item && r.Item.inv && r.Item.inv.SS.includes(me));
}
async function room(me, q) {
  const ch = q.ch;
  if (ch === 'global' || ch === 'trade' || ch === 'help') return ch;
  if (ch === 'banner') { const r = await db.send(new D.GetItemCommand({ TableName: H, Key: { pid: S(me) }, ProjectionExpression: 'sd' })); return r.Item && r.Item.sd ? 'banner#' + r.Item.sd.S : null; }
  // Whispers: each player reads only their own inbox, which holds what they sent and what they got.
  if (ch === 'dm') return 'dm#' + me;
  if (ch === 'party') { const L = /^[0-9a-f]{16}$/.test(q.leader || '') ? q.leader : me; return (await canParty(me, L)) ? 'party#' + L : null; }
  return null;
}
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 'auth' });
  const me = pidOf(cl.sub), rk = e.routeKey, q = e.queryStringParameters || {};
  let b = {}; if (e.body) { try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body); } catch (x) { return res(400, { error: 'json' }); } }
  if (rk === 'GET /chat') {
    const pk = await room(me, q); if (!pk) return res(403, { error: 'room' });
    const r = await db.send(new D.QueryCommand({ TableName: T, KeyConditionExpression: 'pk = :p AND sk > :s', ExpressionAttributeValues: { ':p': S(pk), ':s': S(q.since || '0') }, ScanIndexForward: false, Limit: 60 }));
    return res(200, { me, msgs: (r.Items || []).filter(i => !i.hid).reverse().map(i => Object.assign({ id: i.sk.S, from: i.from.S, name: i.name.S, cls: i.cls.S, text: i.text.S }, i.to ? { to: i.to.S, toName: i.toName ? i.toName.S : '' } : {})) });
  }
  if (rk === 'POST /chat') {
    const pk = await room(me, b); if (!pk) return res(403, { error: 'room' });
    let to = null;
    if (b.ch === 'dm') {
      if (!/^[0-9a-f]{16}$/.test(b.to || '') || b.to === me) return res(400, { error: 'to' });
      const h = await db.send(new D.GetItemCommand({ TableName: H, Key: { pid: S(b.to) }, ProjectionExpression: '#n', ExpressionAttributeNames: { '#n': 'name' } }));
      if (!h.Item || !h.Item.name) return res(404, { error: 'to' });
      to = { pid: b.to, name: h.Item.name.S };
    }
    let text = String(b.text || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const name = String(b.name || '').trim();
    if (!text) return res(400, { error: 'empty' });
    if (!/^[A-Za-z][A-Za-z '\-]{1,15}$/.test(name) || BAD.test(name.replace(/[^a-z]/gi, ''))) return res(400, { error: 'name' });
    BAD.lastIndex = 0;
    if (LINK.test(text)) return res(400, { error: 'links' });
    text = text.replace(BAD, w => '*'.repeat(w.length));
    const now = Date.now();
    try { await db.send(new D.PutItemCommand({ TableName: T, Item: { pk: S('rate#' + me), sk: S('0'), t: N(now), ttl: N(Math.floor(now / 1000) + 3600) }, ConditionExpression: 'attribute_not_exists(t) OR t < :c', ExpressionAttributeValues: { ':c': N(now - 3000) } })); }
    catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(429, { error: 'slow' }); throw x; }
    const sk = now.toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex');
    const item = { sk: S(sk), from: S(me), name: S(name), cls: S(/^(tank|healer|rogue|mage|necro)$/.test(b.cls) ? b.cls : 'rogue'), text: S(text), ttl: N(Math.floor(now / 1000) + 7 * 86400) };
    if (to) {
      // one copy in each inbox, so both sides see the conversation
      Object.assign(item, { to: S(to.pid), toName: S(to.name) });
      await db.send(new D.PutItemCommand({ TableName: T, Item: Object.assign({ pk: S('dm#' + to.pid) }, item) }));
      await db.send(new D.PutItemCommand({ TableName: T, Item: Object.assign({ pk: S('dm#' + me) }, item) }));
    } else await db.send(new D.PutItemCommand({ TableName: T, Item: Object.assign({ pk: S(pk) }, item) }));
    return res(200, { ok: true, id: sk });
  }
  if (rk === 'POST /report') {
    const pk = await room(me, b); if (!pk || !/^[0-9a-z]{15}$/.test(b.id || '')) return res(400, { error: 'bad' });
    try {
      const r = await db.send(new D.UpdateItemCommand({ TableName: T, Key: { pk: S(pk), sk: S(b.id) }, UpdateExpression: 'ADD rep :m', ConditionExpression: 'attribute_exists(sk)', ExpressionAttributeValues: { ':m': { SS: [me] } }, ReturnValues: 'ALL_NEW' }));
      if (r.Attributes.rep.SS.length >= 3) await db.send(new D.UpdateItemCommand({ TableName: T, Key: { pk: S(pk), sk: S(b.id) }, UpdateExpression: 'SET hid = :t', ExpressionAttributeValues: { ':t': { BOOL: true } } }));
    } catch (x) { if (x.name !== 'ConditionalCheckFailedException') throw x; }
    return res(200, { ok: true });
  }
  if (rk === 'GET /parties') {
    const r = await db.send(new D.GetItemCommand({ TableName: H, Key: { pid: S(me) }, ProjectionExpression: 'pin' }));
    const ids = (r.Item && r.Item.pin ? r.Item.pin.SS : []).slice(0, 20), out = [];
    for (const id of ids) { const h = await db.send(new D.GetItemCommand({ TableName: H, Key: { pid: S(id) }, ProjectionExpression: '#n', ExpressionAttributeNames: { '#n': 'name' } })); if (h.Item && h.Item.name) out.push({ leader: id, name: h.Item.name.S }); }
    return res(200, { me, parties: out });
  }
  return res(404, { error: 'route' });
};
