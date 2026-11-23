const { DynamoDBClient, UpdateItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');
const db = new DynamoDBClient({});
const T = process.env.TABLE;
const CLS = ['tank', 'healer', 'rogue', 'mage', 'necro'];
const SIDES = ['covenant', 'radiant', 'tide', 'mercy', 'unsworn'];
const BAD = /(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|bitch|whore|dick|cock|puss|slut|porn)/i;
const res = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const pidOf = sub => crypto.createHash('sha256').update('lh:' + sub).digest('hex').slice(0, 16);
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 'not signed in' });
  const me = pidOf(cl.sub), rk = e.routeKey;
  let b = {};
  if (e.body) { try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body); } catch (x) { return res(400, { error: 'bad json' }); } }
  if (rk === 'PUT /hero') {
    const name = String(b.name || '').trim();
    if (!/^[A-Za-z][A-Za-z '\-]{1,15}$/.test(name) || BAD.test(name.replace(/[^a-z]/gi, ''))) return res(400, { error: 'name' });
    if (!CLS.includes(b.cls)) return res(400, { error: 'class' });
    const floor = Math.max(1, Math.min(100000, Math.floor(Number(b.floor) || 1)));
    const level = Math.max(1, Math.min(50 + floor * 8, Math.floor(Number(b.level) || 1)));
    const side = SIDES.includes(b.side) ? b.side : 'unsworn';
    const r = await db.send(new UpdateItemCommand({ TableName: T, Key: { pid: { S: me } },
      UpdateExpression: 'SET #n = :n, cls = :c, lv = :l, fl = :f, sd = :s, seen = :t, recruits = :z',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': { S: name }, ':c': { S: b.cls }, ':l': { N: String(level) }, ':f': { N: String(floor) }, ':s': { S: side }, ':t': { N: String(Date.now()) }, ':z': { N: '0' } },
      ReturnValues: 'UPDATED_OLD' }));
    const old = r.Attributes && r.Attributes.recruits;
    return res(200, { ok: true, id: me, recruits: old ? Number(old.N) : 0 });
  }
  if (rk === 'GET /heroes') {
    const r = await db.send(new ScanCommand({ TableName: T, Limit: 300 }));
    const cut = Date.now() - 30 * 864e5;
    let list = (r.Items || []).filter(i => i.pid.S !== me && i.name && i.seen && Number(i.seen.N) > cut)
      .map(i => ({ id: i.pid.S, name: i.name.S, cls: i.cls.S, level: Number(i.lv.N), floor: Number(i.fl.N), side: i.sd ? i.sd.S : 'unsworn' }));
    for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [list[k], list[j]] = [list[j], list[k]]; }
    return res(200, { heroes: list.slice(0, 8) });
  }
  if (rk === 'POST /recruit') {
    const id = String(b.heroId || '');
    if (!/^[0-9a-f]{16}$/.test(id) || id === me) return res(400, { error: 'hero' });
    try {
      await db.send(new UpdateItemCommand({ TableName: T, Key: { pid: { S: id } }, UpdateExpression: 'ADD recruits :one',
        ConditionExpression: 'attribute_exists(pid)', ExpressionAttributeValues: { ':one': { N: '1' } } }));
    } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(404, { error: 'no hero' }); throw x; }
    // party ties for party chat: the leader's room admits the hero's owner, and the owner can find the room
    await db.send(new UpdateItemCommand({ TableName: T, Key: { pid: { S: id } }, UpdateExpression: 'ADD pin :me', ExpressionAttributeValues: { ':me': { SS: [me] } } }));
    await db.send(new UpdateItemCommand({ TableName: T, Key: { pid: { S: me } }, UpdateExpression: 'ADD inv :id', ExpressionAttributeValues: { ':id': { SS: [id] } } }));
    return res(200, { ok: true });
  }
  return res(404, { error: 'not found' });
};