// Lanternhold war desk: the public Grand War commander list, and admin tools for commander links and Sigils.
// GET /war reads the Grand War site's public ranks and honors.
const D = require('@aws-sdk/client-dynamodb');
const db = new D.DynamoDBClient({});
const { HEROES: H, WALLETS: W } = process.env;
const res = (c, b, h) => ({ statusCode: c, headers: Object.assign({ 'content-type': 'application/json' }, h), body: JSON.stringify(b) });
const S = v => ({ S: String(v) });
const AL = { covenant: 'covenant', ascendancy: 'radiant', tide: 'tide' };
let war = null, warAt = 0;
async function getWar() {
  if (war && Date.now() - warAt < 6e5) return war;
  const [r, h] = await Promise.all(['ranks', 'heroes'].map(n => fetch('https://war.born2gamellc.com/api/' + n + '.json').then(x => x.json())));
  const m = {}, add = (n, a, rank, lv) => m[n.toLowerCase()] || (m[n.toLowerCase()] = { n, a: AL[a] || a, r: rank, lv, h: [] });
  for (const [k, a] of Object.entries(r.alliances || {})) for (const g of a.by_rank || []) for (const n of g.names || []) add(n, k, g.title, g.level);
  const hon = (p, t) => { if (p && p.name) add(p.name, p.alliance, 'Veteran', 0).h.push(t); };
  const live = h.live || {};
  hon(live.marshal, 'Grand Marshal'); for (const c of Object.values(live.champions || {})) hon(c, 'Alliance Champion');
  for (const c of Object.values(m)) if (c.a === AL[live.nexus] && c.lv >= 2) c.h.push('Nexus Holder');
  for (const s of (h.hall || []).filter(s => !s.replay)) { hon(s.marshal, 'Grand Marshal, Season ' + s.season); for (const c of Object.values(s.champions || {})) hon(c, 'Champion, Season ' + s.season); }
  war = Object.values(m); warAt = Date.now();
  return war;
}
exports.handler = async (e) => {
  const rk = e.routeKey;
  if (rk === 'GET /war') { try { return res(200, { c: await getWar() }, { 'cache-control': 'public, max-age=300' }); } catch (x) { return res(502, { error: 'war' }); } }
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !String(cl['cognito:groups'] || '').includes('admins')) return res(403, { error: 'admin only' });
  let b = {};
  if (e.body) { try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body); } catch (x) { return res(400, { error: 'json' }); } }
  const hero = async id => (await db.send(new D.GetItemCommand({ TableName: H, Key: { pid: S(id) } }))).Item;
  try {
    if (rk === 'GET /admin/links') {
      const r = await db.send(new D.ScanCommand({ TableName: H, FilterExpression: 'attribute_exists(wl)' }));
      return res(200, { links: (r.Items || []).map(i => ({ id: i.pid.S, name: i.name ? i.name.S : '', wl: i.wl.S, wv: !!(i.wv && i.wv.N === '1') })) });
    }
    const id = String(b.id || '');
    if (!/^[0-9a-f]{16}$/.test(id)) return res(400, { error: 'id' });
    if (rk === 'POST /admin/verify') {
      const h = await hero(id); if (!h || !h.u || !h.wl) return res(404, { error: 'link' });
      const u = b.ok ? { UpdateExpression: 'SET wv = :one', ExpressionAttributeValues: { ':one': { N: '1' } } } : { UpdateExpression: 'REMOVE wl, wv' };
      await db.send(new D.UpdateItemCommand({ TableName: H, Key: { pid: S(id) }, ...u }));
      await db.send(new D.UpdateItemCommand({ TableName: W, Key: { userId: h.u }, ...u }));
      return res(200, { ok: true });
    }
    if (rk === 'POST /admin/grant') {
      const n = Math.trunc(Number(b.n) || 0), h = await hero(id);
      if (!n || Math.abs(n) > 1e5) return res(400, { error: 'amount' });
      if (!h || !h.u) return res(404, { error: 'player' });
      const r = await db.send(new D.UpdateItemCommand({ TableName: W, Key: { userId: h.u }, ReturnValues: 'ALL_NEW',
        UpdateExpression: 'SET bal = if_not_exists(bal, :g) + :n, own = if_not_exists(own, :o)', ExpressionAttributeValues: { ':g': { N: '100' }, ':n': { N: String(n) }, ':o': { SS: ['f.plain'] } } }));
      return res(200, { ok: true, bal: +r.Attributes.bal.N });
    }
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
  return res(404, { error: 'not found' });
};
