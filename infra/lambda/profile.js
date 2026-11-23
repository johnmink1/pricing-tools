// Lanternhold profiles: the Sigil wallet, the cosmetics shop, profile looks, and Grand War commander links.
// Commander links are stored as requested and shown only once an admin verifies them (warden.js).
const D = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');
const db = new D.DynamoDBClient({});
const { HEROES: H, WALLETS: W } = process.env;
// Every cosmetic and its price in Sigils. Price 0 means everyone owns it. Keep in step with COSMETICS in lanternhold/core.js.
const CAT = Object.fromEntries(('f.plain0 f.iron150 f.radiant150 f.tide150 f.mercy150 f.ember250 f.rift400 f.nexus600 ' +
  't.delver0 t.lampbearer80 t.ashborn120 t.nightwatch120 t.riftwalker200 t.warden200 t.stormcaller200 t.oathkeeper250 t.heir400 ' +
  'c.none0 c.gold100 c.violet100 c.ember100 c.frost100 c.verdant100 c.rift300 ' +
  'g.night0 g.forge150 g.crypt150 g.glass150 g.storm200 g.rift350 g.nexus500 ' +
  'e.lantern0 e.shield0 e.sword0 e.skull40 e.flame40 e.wave40 e.sun40 e.moon40 e.star40 e.key40 e.anvil40 e.crown60 e.eye60 e.rose60 e.raven80 e.rift100')
  .split(' ').map(x => { const m = x.match(/^(.+?)(\d+)$/); return [m[1], +m[2]]; }));
const BAD = /(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|bitch|whore|dick|cock|puss|slut|porn|http|www\.|\.com)/i;
const res = (c, b, h) => ({ statusCode: c, headers: Object.assign({ 'content-type': 'application/json' }, h), body: JSON.stringify(b) });
const S = v => ({ S: String(v) });
const pidOf = sub => crypto.createHash('sha256').update('lh:' + sub).digest('hex').slice(0, 16);
exports.handler = async (e) => {
  const rk = e.routeKey;
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 'auth' });
  let b = {};
  if (e.body) { try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString() : e.body); } catch (x) { return res(400, { error: 'json' }); } }
  const me = pidOf(cl.sub), wk = { userId: S(cl.sub) }, hk = { pid: S(me) };
  const wallet = async () => (await db.send(new D.UpdateItemCommand({ TableName: W, Key: wk, ReturnValues: 'ALL_NEW',
    UpdateExpression: 'SET bal = if_not_exists(bal, :g), own = if_not_exists(own, :o)', ExpressionAttributeValues: { ':g': { N: '100' }, ':o': { SS: ['f.plain'] } } }))).Attributes;
  const hero = async id => (await db.send(new D.GetItemCommand({ TableName: H, Key: { pid: S(id) } }))).Item;
  // Looks and links live on the wallet, which survives a server wipe, and are mirrored onto the hero so others can see them.
  const both = async (x, v) => {
    await db.send(new D.UpdateItemCommand({ TableName: H, Key: hk, UpdateExpression: x, ConditionExpression: 'attribute_exists(pid) AND attribute_not_exists(ban)', ...(v && { ExpressionAttributeValues: v }) }));
    await db.send(new D.UpdateItemCommand({ TableName: W, Key: wk, UpdateExpression: x, ...(v && { ExpressionAttributeValues: v }) }));
  };
  const out = w => ({ bal: +w.bal.N, own: w.own.SS, pf: w.pf ? JSON.parse(w.pf.S) : null, wl: w.wl ? w.wl.S : '', wv: !!(w.wv && w.wv.N === '1'), pass: w.pass ? +w.pass.N : 0, sub: w.sub ? +w.sub.N : 0, boh: !!w.boh });
  try {
    if (rk === 'GET /profile') {
      const w = await wallet(), h = await hero(me);
      if (h && !h.ban && ((w.pf && !h.pf) || (w.wl && !h.wl))) {
        const v = {}, x = [];
        for (const k of ['pf', 'wl', 'wv']) if (w[k]) { v[':' + k] = w[k]; x.push(k + ' = :' + k); }
        await db.send(new D.UpdateItemCommand({ TableName: H, Key: hk, UpdateExpression: 'SET ' + x.join(', '), ExpressionAttributeValues: v }));
      }
      return res(200, out(w));
    }
    if (rk === 'PUT /profile') {
      const own = new Set((await wallet()).own.SS);
      const ok = (k, id) => id === '' || CAT[k + '.' + id] === 0 || own.has(k + '.' + id);
      const p = { b: String(b.b || '').replace(/\s+/g, ' ').trim(), t: String(b.t || ''), f: String(b.f || ''), c: String(b.c || ''), g: String(b.g || ''), e: [...new Set(Array.isArray(b.e) ? b.e.map(String) : [])] };
      if (p.b.length > 140 || BAD.test(p.b.replace(/[^a-z.\/]/gi, ''))) return res(400, { error: 'bio' });
      if (!ok('t', p.t) || !ok('f', p.f) || !ok('c', p.c) || !ok('g', p.g) || p.e.length > 6 || !p.e.every(x => x && ok('e', x))) return res(400, { error: 'item' });
      await both('SET pf = :p', { ':p': S(JSON.stringify(p)) });
      return res(200, { ok: true, pf: p });
    }
    if (rk === 'POST /shop') {
      const id = String(b.id || ''), price = CAT[id];
      if (!price) return res(400, { error: 'item' });
      const w = await wallet();
      if (w.own.SS.includes(id)) return res(409, { error: 'owned' });
      if (+w.bal.N < price) return res(409, { error: 'funds' });
      const r = await db.send(new D.UpdateItemCommand({ TableName: W, Key: wk, ReturnValues: 'ALL_NEW', UpdateExpression: 'SET bal = bal - :p ADD own :s',
        ConditionExpression: 'bal >= :p AND NOT contains(own, :i)', ExpressionAttributeValues: { ':p': { N: String(price) }, ':s': { SS: [id] }, ':i': S(id) } }));
      return res(200, out(r.Attributes));
    }
    if (rk === 'POST /warlink') {
      const n = String(b.name || '').trim();
      if (n.length > 40) return res(400, { error: 'commander' });
      await (n ? both('SET wl = :n, wv = :z', { ':n': S(n), ':z': { N: '0' } }) : both('REMOVE wl, wv'));
      return res(200, { ok: true, wl: n });
    }
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
  return res(404, { error: 'not found' });
};
