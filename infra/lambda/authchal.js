// Cognito custom sign-in for "Continue with Born 2 Game". wixlogin.js stores a one-time code under otp#<user>
// after checking the player's store account with Wix; these triggers let Cognito accept exactly that code once.
const D = require('@aws-sdk/client-dynamodb');
const db = new D.DynamoDBClient({}), { TABLE: T } = process.env;
exports.handler = async (e) => {
  const r = e.request, t = e.triggerSource;
  if (t === 'DefineAuthChallenge_Authentication') {
    const s = r.session || [], last = s[s.length - 1];
    if (last && last.challengeName === 'CUSTOM_CHALLENGE' && last.challengeResult) { e.response.issueTokens = true; e.response.failAuthentication = false; }
    else if (s.length >= 2) { e.response.issueTokens = false; e.response.failAuthentication = true; }
    else { e.response.issueTokens = false; e.response.failAuthentication = false; e.response.challengeName = 'CUSTOM_CHALLENGE'; }
  } else if (t === 'CreateAuthChallenge_Authentication') {
    e.response.publicChallengeParameters = { kind: 'store' }; e.response.privateChallengeParameters = {}; e.response.challengeMetadata = 'STORE';
  } else if (t === 'VerifyAuthChallengeResponse_Authentication') {
    const K = { pk: { S: 'otp#' + e.userName }, sk: { S: '-' } };
    const g = await db.send(new D.GetItemCommand({ TableName: T, Key: K, ConsistentRead: true }));
    const ok = !!(g.Item && g.Item.c.S === String(r.challengeAnswer) && +g.Item.exp.N > Date.now());
    if (g.Item) await db.send(new D.DeleteItemCommand({ TableName: T, Key: K }));
    e.response.answerCorrect = ok;
  }
  return e;
};
