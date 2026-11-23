// Party invites. Recruiting a player's hero sends them an invite; they accept or decline it in their own game.
// On the hero row: req = leaders asking for me, sent = heroes I invited, acc / dec = answers waiting for me to read.
// Accepting does what the old instant recruit did: gold for the owner (recruits), party chat ties (pin / inv).
const D = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');
const db = new D.DynamoDBClient({}), T = process.env.TABLE;
const res = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const pidOf = sub => crypto.createHash('sha256').update('lh:' + sub).digest('hex').slice(0, 16);
const SS = a => ({ SS: a }), K = p => ({ pid: { S: p } });
const up = (p, x, v, c) => db.send(new D.UpdateItemCommand(Object.assign({ TableName: T, Key: K(p), UpdateExpression: x, ExpressionAttributeValues: v }, c ? { ConditionExpression: c } : {})));
const set = i => (i && i.SS) || [];
async function heroes(ids) {
  if (!ids.length) return {};
  const r = await db.send(new D.BatchGetItemCommand({ RequestItems: { [T]: { Keys: ids.slice(0, 50).map(K), ProjectionExpression: 'pid, #n, cls, lv, sd, pf, wl, wv, seen', ExpressionAttributeNames: { '#n': 'name' } } } }));
  const o = {};
  for (const i of r.Responses[T] || []) if (i.name) o[i.pid.S] = { id: i.pid.S, name: i.name.S, cls: i.cls.S, level: +i.lv.N, side: i.sd ? i.sd.S : 'unsworn', on: Date.now() - +(i.seen || { N: 0 }).N < 18e4, pf: i.pf ? JSON.parse(i.pf.S) : null, w: i.wv && i.wv.N === '1' ? i.wl.S : '' };
  return o;
}
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 1 });
  const me = pidOf(cl.sub);
  if (e.routeKey === 'GET /invites') {
    const r = (await db.send(new D.GetItemCommand({ TableName: T, Key: K(me), ProjectionExpression: 'req, sent, acc, dec' }))).Item || {};
    const req = set(r.req), acc = set(r.acc), dec = set(r.dec), h = await heroes([...new Set([...req, ...acc, ...dec])]);
    // Answers are read once: take away exactly what we are about to report.
    if (acc.length || dec.length) {
      const x = [], v = {};
      if (acc.length) { x.push('acc :a'); v[':a'] = SS(acc); }
      if (dec.length) { x.push('dec :d'); v[':d'] = SS(dec); }
      await up(me, 'DELETE ' + x.join(', '), v);
    }
    return res(200, { asks: req.map(p => h[p]).filter(Boolean), acc: acc.map(p => h[p]).filter(Boolean), dec: dec.map(p => (h[p] || { id: p, name: 'A player' })), sent: set(r.sent) });
  }
  if (e.routeKey !== 'POST /invite') return res(404, { error: 1 });
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 1 }); }
  const id = String(b.id || ''), a = b.act, mine = SS([me]), them = SS([id]);
  if (!/^[0-9a-f]{16}$/.test(id) || id === me) return res(400, { error: 'hero' });
  try {
    if (a === 'ask') {
      await up(id, 'ADD req :m', { ':m': mine }, 'attribute_exists(cls) AND attribute_not_exists(ban)');
      await up(me, 'ADD sent :i', { ':i': them });
    } else if (a === 'cancel') {
      await up(id, 'DELETE req :m', { ':m': mine });
      await up(me, 'DELETE sent :i', { ':i': them });
    } else if (a === 'yes' || a === 'no') {
      // Only an invite that is really waiting can be answered.
      const y = a === 'yes';
      await up(me, 'DELETE req :i' + (y ? ' ADD recruits :one, pin :i' : ''), Object.assign({ ':i': them, ':s': { S: id } }, y ? { ':one': { N: '1' } } : {}), 'contains(req, :s)');
      await up(id, 'DELETE sent :m ADD ' + (y ? 'inv :m, acc :m' : 'dec :m'), { ':m': mine });
    } else return res(400, { error: 'act' });
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(404, { error: 'gone' }); throw x; }
  return res(200, { ok: true });
};
