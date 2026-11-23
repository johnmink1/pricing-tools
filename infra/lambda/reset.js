// Lanternhold admin server wipe and player reset (John, 2026-11-23): wipes one player back to a brand-new start.
// Admins only (Cognito group "admins"). The admin must type the hero's name. Paid Sigils, owned looks and the
// wallet stay unless "sigils" is ticked. Every reset leaves an audit row (trade table, pk audit#).
// The save row keeps an rst stamp: the save API refuses uploads from games created before it, and the
// game reads it to start the player over on every device.
const D = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');
const db = new D.DynamoDBClient({});
const { SAVES, HEROES, TRADE, WALLETS, ARENA, BOSS } = process.env;
const res = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
const send = c => db.send(c);
async function query(pk) {
  const out = []; let k;
  do {
    const r = await send(new D.QueryCommand({ TableName: TRADE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S(pk) }, ExclusiveStartKey: k }));
    out.push(...(r.Items || [])); k = r.LastEvaluatedKey;
  } while (k);
  return out;
}
const del = (T, Key) => send(new D.DeleteItemCommand({ TableName: T, Key }));
// delete every row under pk; pair(it) names the twin row (e.g. the public market copy) to delete too
async function dropAll(pk, pair) {
  const rows = await query(pk);
  for (const it of rows) { await del(TRADE, { pk: it.pk, sk: it.sk }); const p = pair && pair(it); if (p) await del(TRADE, { pk: S(p), sk: it.sk }); }
  return rows.length;
}
async function clear(T, keys, keep) {
  const items = []; let k;
  do { const r = await send(new D.ScanCommand({ TableName: T, ExclusiveStartKey: k })); for (const i of r.Items || []) if (!keep(i)) items.push(i); k = r.LastEvaluatedKey; } while (k);
  for (let i = 0; i < items.length; i += 25) {
    let req = { [T]: items.slice(i, i + 25).map(it => ({ DeleteRequest: { Key: Object.fromEntries(keys.map(x => [x, it[x]])) } })) };
    for (let n = 0; n < 6 && req && Object.keys(req).length; n++) {
      req = (await send(new D.BatchWriteItemCommand({ RequestItems: req }))).UnprocessedItems;
      if (req && Object.keys(req).length) await new Promise(z => setTimeout(z, 200 * (n + 1)));
    }
  }
  return items.length;
}
const audit = (cl, now, x) => send(new D.PutItemCommand({ TableName: TRADE, Item: { pk: S('audit#'), sk: S(now.toString(36) + crypto.randomBytes(3).toString('hex')),
  at: N(now), by: S(cl.email || cl.sub), ttl: N(Math.floor(now / 1000) + 365 * 86400), ...x } }));
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !String(cl['cognito:groups'] || '').includes('admins')) return res(403, { error: 'admin only' });
  if (e.routeKey === 'GET /admin/audit') {
    const r = await send(new D.QueryCommand({ TableName: TRADE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S('audit#') }, ScanIndexForward: false, Limit: 20 }));
    return res(200, { log: (r.Items || []).map(i => ({ at: +i.at.N, by: i.by.S, act: i.act.S, name: i.name ? i.name.S : '', sigils: !!i.sig, self: !!i.self })) });
  }
  let b = {};
  try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 'json' }); }
  const now = Date.now();
  // Server wipe. Store links, credited orders, Sigil market listings (escrowed Sigils) and the audit trail survive it.
  if (e.routeKey === 'POST /admin/wipe') {
    if (b.confirm !== 'WIPE') return res(400, { error: 'confirm' });
    const saves = await clear(SAVES, ['userId'], i => i.userId.S === '#epoch');
    const heroes = await clear(HEROES, ['pid'], i => !!i.ban);
    const trade = await clear(TRADE, ['pk', 'sk'], i => /^(audit|wix|wixord|sig|sigsell)#/.test(i.pk.S));
    await send(new D.PutItemCommand({ TableName: SAVES, Item: { userId: S('#epoch'), data: S(''), updated: N(now) } }));
    await audit(cl, now, { act: S('wipe') });
    return res(200, { ok: true, epoch: now, saves, heroes, trade });
  }
  const id = String(b.id || '');
  if (!/^[0-9a-f]{16}$/.test(id)) return res(400, { error: 'id' });
  const h = (await send(new D.GetItemCommand({ TableName: HEROES, Key: { pid: S(id) } }))).Item;
  if (!h || !h.u) return res(404, { error: 'player' });
  const name = h.name ? h.name.S : h.bn ? h.bn.S : '', sub = h.u.S, wipeSig = b.sigils === true, me = sub === cl.sub;
  if (!name || String(b.name || '').trim().toLowerCase() !== name.toLowerCase()) return res(400, { error: 'name' });
  // 1. the save: an empty row stamped with the reset time
  await send(new D.PutItemCommand({ TableName: SAVES, Item: { userId: S(sub), data: S(''), updated: N(now), floor: N(0), rst: N(now) } }));
  // 2. the guild board hero: keep only the account link, the name for the admin list, a ban marker and the Grand War link
  const keep = { pid: S(id), u: h.u, bn: S(name) };
  for (const k of ['ban', 'wl', 'wv']) if (h[k]) keep[k] = h[k];
  await send(new D.PutItemCommand({ TableName: HEROES, Item: keep }));
  // 3. market listings and letters
  const n = { listings: await dropAll('sell#' + id, it => it.cls && 'mkt#' + it.cls.S), letters: (await dropAll('inbox#' + id)) + (await dropAll('out#' + id)) };
  // 4. Ember Ring standing and world boss scores
  await del(ARENA, { pid: S(id) });
  let k;
  do {
    const r = await send(new D.ScanCommand({ TableName: BOSS, FilterExpression: 's = :p', ExpressionAttributeValues: { ':p': S(id) }, ExclusiveStartKey: k }));
    for (const it of r.Items || []) await del(BOSS, { w: it.w, s: it.s });
    k = r.LastEvaluatedKey;
  } while (k);
  // 5. Sigils, owned looks, passes and Sigil market listings, only when asked. The Grand War link stays.
  if (wipeSig) {
    n.sigilListings = await dropAll('sigsell#' + id, () => 'sig#');
    const w = (await send(new D.GetItemCommand({ TableName: WALLETS, Key: { userId: S(sub) } }))).Item;
    if (w) {
      const wk = { userId: S(sub) };
      for (const f of ['wl', 'wv']) if (w[f]) wk[f] = w[f];
      await send(new D.PutItemCommand({ TableName: WALLETS, Item: wk }));
    }
  }
  // 6. audit trail, kept a year
  await audit(cl, now, { act: S('reset'), pid: S(id), name: S(name), ...(wipeSig && { sig: N(1) }), ...(me && { self: N(1) }) });
  return res(200, { ok: true, name, self: me, sigils: wipeSig, ...n });
};
