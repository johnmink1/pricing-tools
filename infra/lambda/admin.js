// Lanternhold admin: player list and bans (the server wipe and player reset live in reset.js). Only members of the Cognito "admins" group get in.
// GET /epoch is public: clients compare it with their save and start over after a wipe.
const D = require('@aws-sdk/client-dynamodb');
const C = require('@aws-sdk/client-cognito-identity-provider');
const db = new D.DynamoDBClient({}), idp = new C.CognitoIdentityProviderClient({});
const { SAVES, HEROES, TRADE, POOL } = process.env;
const res = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const S = v => ({ S: String(v) });
async function getEpoch() {
  const r = await db.send(new D.GetItemCommand({ TableName: SAVES, Key: { userId: S('#epoch') } }));
  return r.Item ? Number(r.Item.updated.N) : 0;
}
async function scanAll(T, keep) {
  const out = []; let k;
  do {
    const r = await db.send(new D.ScanCommand({ TableName: T, ExclusiveStartKey: k }));
    for (const i of r.Items || []) if (!keep || !keep(i)) out.push(i);
    k = r.LastEvaluatedKey;
  } while (k);
  return out;
}
exports.handler = async (e) => {
  const rk = e.routeKey;
  if (rk === 'GET /epoch') return res(200, { epoch: await getEpoch() });
  if (rk === 'GET /leaderboard') {
    const all = await scanAll(HEROES), online = all.filter(i => i.name && !i.ban && i.seen && Date.now() - i.seen.N < 18e4).length;
    const top = all.filter(i => i.name && i.fl && !i.ban)
      .map(i => ({ name: i.name.S, cls: i.cls.S, level: +i.lv.N, floor: +i.fl.N, side: i.sd ? i.sd.S : 'unsworn' }))
      .sort((a, c) => c.floor - a.floor || c.level - a.level).slice(0, 50);
    return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }, body: JSON.stringify({ top, online }) };
  }
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !String(cl['cognito:groups'] || '').includes('admins')) return res(403, { error: 'admin only' });
  let b = {};
  if (e.body) { try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body); } catch (x) { return res(400, { error: 'bad json' }); } }
  if (rk === 'GET /admin/players') {
    const now = Date.now();
    const list = (await scanAll(HEROES)).map(i => ({
      id: i.pid.S, name: i.name ? i.name.S : (i.bn ? i.bn.S : ''), cls: i.cls ? i.cls.S : '', level: i.lv ? +i.lv.N : 0, floor: i.fl ? +i.fl.N : 0,
      seen: i.seen ? +i.seen.N : 0, on: i.seen ? now - i.seen.N < 18e4 : false, banned: !!i.ban, canBan: !!i.u,
    })).sort((a, c) => c.seen - a.seen);
    return res(200, { players: list, epoch: await getEpoch() });
  }
  if (rk === 'POST /admin/ban' || rk === 'POST /admin/unban') {
    const id = String(b.id || '');
    if (!/^[0-9a-f]{16}$/.test(id)) return res(400, { error: 'id' });
    const r = await db.send(new D.GetItemCommand({ TableName: HEROES, Key: { pid: S(id) } }));
    if (!r.Item || !r.Item.u) return res(404, { error: 'player' });
    const user = r.Item.u.S;
    if (user === cl.sub) return res(400, { error: 'self' });
    if (rk === 'POST /admin/unban') {
      await idp.send(new C.AdminEnableUserCommand({ UserPoolId: POOL, Username: user }));
      await db.send(new D.UpdateItemCommand({ TableName: HEROES, Key: { pid: S(id) }, UpdateExpression: 'REMOVE ban' }));
      return res(200, { ok: true });
    }
    await idp.send(new C.AdminDisableUserCommand({ UserPoolId: POOL, Username: user }));
    await idp.send(new C.AdminUserGlobalSignOutCommand({ UserPoolId: POOL, Username: user }));
    // keep a small ban marker: hidden from the guild board, and the hero cannot be registered again
    const name = r.Item.name ? r.Item.name.S : (r.Item.bn ? r.Item.bn.S : '');
    await db.send(new D.PutItemCommand({ TableName: HEROES, Item: { pid: S(id), u: S(user), bn: S(name), ban: { N: String(Date.now()) } } }));
    // take down their market listings
    let k, n = 0;
    do {
      const q = await db.send(new D.QueryCommand({ TableName: TRADE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S('sell#' + id) }, ExclusiveStartKey: k }));
      for (const it of q.Items || []) {
        const cls = it.cls ? it.cls.S : '';
        await db.send(new D.DeleteItemCommand({ TableName: TRADE, Key: { pk: it.pk, sk: it.sk } }));
        if (cls) await db.send(new D.DeleteItemCommand({ TableName: TRADE, Key: { pk: S('mkt#' + cls), sk: it.sk } }));
        n++;
      }
      k = q.LastEvaluatedKey;
    } while (k);
    return res(200, { ok: true, listings: n });
  }
  return res(404, { error: 'not found' });
};
