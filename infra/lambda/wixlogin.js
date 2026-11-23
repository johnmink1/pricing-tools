// "Continue with Born 2 Game": sign in to Lanternhold with a Born 2 Game store (Wix) account.
// We ask Wix who the member is. A member linked to a game account signs into that account; a new member gets
// the game account that already uses the same verified email, or else a fresh game account under a private placeholder address (no email is ever sent). Tokens come from Cognito's
// custom sign-in, answered with a one-time code that only this function can write (see authchal.js).
const D = require('@aws-sdk/client-dynamodb'), C = require('@aws-sdk/client-cognito-identity-provider'), crypto = require('crypto');
const db = new D.DynamoDBClient({}), idp = new C.CognitoIdentityProviderClient({}), { TABLE: T, POOL: P, CLIENT: CI } = process.env;
const res = (c, b) => ({ statusCode: c, body: JSON.stringify(b) });
const S = v => ({ S: String(v) }), N = v => ({ N: String(v) });
const userBy = async f => ((await idp.send(new C.ListUsersCommand({ UserPoolId: P, Filter: f, Limit: 1 }))).Users || [])[0];
exports.handler = async (e) => {
  let b = {}; try { b = JSON.parse(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || '{}'); } catch (x) { return res(400, { error: 1 }); }
  const tok = String(b.token || '');
  if (tok.length < 20 || tok.length > 4000) return res(400, { error: 1 });
  const r = await fetch('https://www.wixapis.com/members/v1/members/my?fieldsets=FULL', { headers: { Authorization: tok } });
  const m = r.ok && (await r.json()).member;
  if (!m || !m.id) return res(401, { error: 'wix' });
  const mid = m.id, name = String((m.profile && m.profile.nickname) || 'Store account').slice(0, 40), L = { pk: S('wix#' + mid), sk: S('link') };
  const link = (await db.send(new D.GetItemCommand({ TableName: T, Key: L, ConsistentRead: true }))).Item;
  let user, created = false;
  if (link) user = await userBy('sub = "' + link.u.S.replace(/[^0-9a-f-]/g, '') + '"');
  // Same verified email on both sides: this store member already plays Lanternhold, so use that account.
  const em = String(m.loginEmail || '').toLowerCase();
  if (!user && m.loginEmailVerified === true && /^[^"\\\s]+@[^"\\\s]+$/.test(em)) {
    const u = await userBy('email = "' + em + '"');
    if (u && u.Enabled !== false && (u.Attributes || []).some(a => a.Name === 'email_verified' && a.Value === 'true')) user = u;
  }
  if (!user) {
    const mail = 'store-' + mid.replace(/[^0-9a-f-]/g, '') + '@players.born2gamellc.com';
    user = await userBy('email = "' + mail + '"');
    if (!user) {
      user = (await idp.send(new C.AdminCreateUserCommand({ UserPoolId: P, Username: mail, MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'email', Value: mail }, { Name: 'email_verified', Value: 'true' }] }))).User;
      await idp.send(new C.AdminSetUserPasswordCommand({ UserPoolId: P, Username: user.Username, Password: crypto.randomBytes(24).toString('base64') + 'aA1!', Permanent: true }));
      created = true;
    }
    const sub = user.Attributes.find(a => a.Name === 'sub').Value;
    try { await db.send(new D.PutItemCommand({ TableName: T, Item: Object.assign({}, L, { u: S(sub), name: S(name), at: N(Date.now()) }), ConditionExpression: 'attribute_not_exists(pk)' })); }
    catch (x) { if (x.name !== 'ConditionalCheckFailedException') throw x; return res(409, { error: 'state' }); }
  }
  const code = crypto.randomBytes(18).toString('hex');
  await db.send(new D.PutItemCommand({ TableName: T, Item: { pk: S('otp#' + user.Username), sk: S('-'), c: S(code), exp: N(Date.now() + 6e4), ttl: N(Math.floor(Date.now() / 1000) + 600) } }));
  const a = await idp.send(new C.AdminInitiateAuthCommand({ UserPoolId: P, ClientId: CI, AuthFlow: 'CUSTOM_AUTH', AuthParameters: { USERNAME: user.Username } }));
  const t = await idp.send(new C.AdminRespondToAuthChallengeCommand({ UserPoolId: P, ClientId: CI, ChallengeName: 'CUSTOM_CHALLENGE', Session: a.Session,
    ChallengeResponses: { USERNAME: user.Username, ANSWER: code } }));
  if (!t.AuthenticationResult) return res(401, { error: 'auth' });
  return res(200, { AuthenticationResult: t.AuthenticationResult, name, created });
};
