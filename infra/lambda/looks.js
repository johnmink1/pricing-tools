// Lanternhold wardrobe: outfits (recolors for the hero and companions) and lantern styles, bought with Sigils.
// Looks only, never stats. Owned ids share the wallet's own set with the profile cosmetics (profile.js).
// Banners (b.*) are war banners shown on the hero's cards, in the Ember Ring and in chat.
// GET /looks?ids=a,b lets other players see a hero's outfit, lantern, banner, name color and title (chat, PvP, guests).
const D = require('@aws-sdk/client-dynamodb'), crypto = require('crypto');
const db = new D.DynamoDBClient({}), { HEROES: H, WALLETS: W } = process.env;
// Keep in step with WARDROBE in the game's ui (u_looks part). Price 0 means everyone owns it.
// r.a, r.b and r.c are the three extra campfire spots (L.ROSTER_ITEMS, L.ROSTER_COST in core.js), bought once each.
const CAT = Object.fromEntries(('k.none0 k.ember250 k.frost250 k.wild250 k.dusk250 k.ivory300 k.obsidian400 k.gilded600 k.rift800 k.sworn1200 ' +
  'l.ember0 l.moon150 l.wisp150 l.rose150 l.rift300 l.sun400 l.soul500 l.void600 r.a300 r.b300 r.c300 ' +
  'b.none0 b.delver0 b.covenant200 b.radiant200 b.tide200 b.mercy200 b.unsworn200 b.ember350 b.frost350 b.rift500 b.crown750 b.lantern1000').split(' ').map(x => { const m = x.match(/^(.+?)(\d+)$/); return [m[1], +m[2]]; }));
const res = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const S = v => ({ S: String(v) }), PID = /^[0-9a-f]{16}$/, MID = /^([a-z]{2,10}|[0-9a-f]{16})$/;
const pidOf = s => crypto.createHash('sha256').update('lh:' + s).digest('hex').slice(0, 16);
const js = (x, d) => { try { return x ? JSON.parse(x.S) : d; } catch (e) { return d; } };
exports.handler = async (e) => {
  const cl = e.requestContext.authorizer && e.requestContext.authorizer.jwt && e.requestContext.authorizer.jwt.claims;
  if (!cl || !cl.sub) return res(401, { error: 'auth' });
  const rk = e.routeKey, me = pidOf(cl.sub), wk = { userId: S(cl.sub) }, q = e.queryStringParameters || {};
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 'json' }); }
  if (rk === 'GET /looks') {
    const ids = [...new Set(String(q.ids || '').split(','))].filter(x => PID.test(x)).slice(0, 40), out = {};
    if (ids.length) {
      const r = await db.send(new D.BatchGetItemCommand({ RequestItems: { [H]: { Keys: ids.map(i => ({ pid: S(i) })), ProjectionExpression: 'pid, pf, wd' } } }));
      for (const i of r.Responses[H] || []) { const p = js(i.pf, {}), w = js(i.wd, {}); out[i.pid.S] = { c: p.c || '', t: p.t || '', k: (w.k || {}).you || '', l: w.l || '', b: w.b || '' }; }
    }
    return Object.assign(res(200, { l: out }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=60' } });
  }
  const wallet = async () => (await db.send(new D.UpdateItemCommand({ TableName: W, Key: wk, ReturnValues: 'ALL_NEW',
    UpdateExpression: 'SET bal = if_not_exists(bal, :g), own = if_not_exists(own, :o)', ExpressionAttributeValues: { ':g': { N: '100' }, ':o': { SS: ['f.plain'] } } }))).Attributes;
  const mirror = v => db.send(new D.UpdateItemCommand({ TableName: H, Key: { pid: S(me) }, UpdateExpression: 'SET wd = :w', ConditionExpression: 'attribute_exists(pid) AND attribute_not_exists(ban)', ExpressionAttributeValues: { ':w': v } })).catch(() => 0);
  const out = w => res(200, { v: 2, bal: +w.bal.N, own: w.own.SS, wd: js(w.wd, {}) });
  try {
    if (rk === 'GET /wardrobe') { const w = await wallet(); if (w.wd) await mirror(w.wd); return out(w); }
    if (rk === 'POST /wardrobe' && b.buy) {
      const id = String(b.buy), p = CAT[id];
      if (!p) return res(400, { error: 'item' });
      const w = await wallet();
      if (w.own.SS.includes(id)) return res(409, { error: 'owned' });
      if (+w.bal.N < p) return res(409, { error: 'funds' });
      return out((await db.send(new D.UpdateItemCommand({ TableName: W, Key: wk, ReturnValues: 'ALL_NEW', UpdateExpression: 'SET bal = bal - :p ADD own :s',
        ConditionExpression: 'bal >= :p AND NOT contains(own, :i)', ExpressionAttributeValues: { ':p': { N: String(p) }, ':s': { SS: [id] }, ':i': S(id) } }))).Attributes);
    }
    if (rk === 'POST /wardrobe') {
      const w = await wallet(), own = new Set(w.own.SS), ok = id => CAT[id] === 0 || own.has(id), k = {}, src = b.k && typeof b.k === 'object' ? b.k : {};
      for (const m of Object.keys(src).slice(0, 24)) { const v = String(src[m] || ''); if (!MID.test(m) || (v && !ok('k.' + v))) return res(400, { error: 'item' }); if (v && v !== 'none') k[m] = v; }
      const l = String(b.l || '');
      const bn = String(b.b || '');
      if ((l && !ok('l.' + l)) || (bn && !ok('b.' + bn))) return res(400, { error: 'item' });
      const v = S(JSON.stringify({ k, l, b: bn }));
      await db.send(new D.UpdateItemCommand({ TableName: W, Key: wk, UpdateExpression: 'SET wd = :w', ExpressionAttributeValues: { ':w': v } }));
      await mirror(v);
      return res(200, { ok: true, wd: { k, l, b: bn } });
    }
  } catch (x) { if (x.name === 'ConditionalCheckFailedException') return res(409, { error: 'state' }); throw x; }
  return res(404, { error: 'not found' });
};
