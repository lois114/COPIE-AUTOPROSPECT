// Attaque les handlers serverless directement, avec des req/res mockés —
// pas besoin de `vercel dev`. Lancer : node scripts/auth-test.mjs

import assert from 'node:assert/strict';
import authHandler from '../api/auth.js';
import searchHandler from '../api/search.js';
import generateHandler from '../api/generate.js';
import sendHandler from '../api/send.js';
import statusHandler from '../api/status.js';

const REAL_PASSWORD = 'mdp-de-test-correct-42';
process.env.SITE_PASSWORD = REAL_PASSWORD;

// Clés bidons :

process.env.APOLLO_API_KEY = 'fake';
process.env.GROQ_API_KEY = 'fake';
process.env.RESEND_API_KEY = 'fake';
process.env.RESEND_FROM = 'test@example.com';

// req/res Vercel réduits au strict utile.
function mockReqRes({ method = 'POST', headers = {}, body = {} } = {}) {
  const res = {
    statusCode: 200,
    _headers: {},
    _body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    setHeader(k, v) { this._headers[k] = v; },
    end() { return this; },
  };
  const req = { method, headers: { 'content-type': 'application/json', ...headers }, body };
  return { req, res };
}

async function run(handler, opts) {
  const { req, res } = mockReqRes(opts);
  await handler(req, res);
  return { status: res.statusCode, body: res._body, headers: res._headers };
}

let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${label} — ${err.message}`);
  }
}

console.log('\nTest 1: /api/send sans aucun header — DOIT bloquer');
{
  const r = await run(sendHandler, { body: { to: 'victim@x.com', subject: 'pwn', body: 'hack' } });
  check('status = 401', () => assert.equal(r.status, 401));
  check('erreur explicite', () => assert.ok(r.body?.error?.includes('authentifié')));
  check('pas de Access-Control-Allow-Origin: *', () => assert.notEqual(r.headers['Access-Control-Allow-Origin'], '*'));
}

console.log('\nTest 2: /api/send avec mauvais token — DOIT bloquer');
{
  const r = await run(sendHandler, {
    headers: { authorization: 'Bearer mauvais-mdp' },
    body: { to: 'victim@x.com', subject: 'pwn', body: 'hack' },
  });
  check('status = 401', () => assert.equal(r.status, 401));
}

console.log('\nTest 3: /api/send avec Basic au lieu de Bearer — DOIT bloquer');
{
  const r = await run(sendHandler, {
    headers: { authorization: 'Basic ' + Buffer.from('admin:admin').toString('base64') },
    body: { to: 'victim@x.com', subject: 'pwn', body: 'hack' },
  });
  check('status = 401', () => assert.equal(r.status, 401));
}

console.log('\nTest 4: /api/search sans auth — DOIT bloquer');
{
  const r = await run(searchHandler, { body: { action: 'fetch', payload: { limit: 1 } } });
  check('status = 401', () => assert.equal(r.status, 401));
}

console.log('\nTest 5: /api/generate sans auth — DOIT bloquer');
{
  const r = await run(generateHandler, { body: { prospect: {}, template: {} } });
  check('status = 401', () => assert.equal(r.status, 401));
}

console.log('\nTest 6: /api/status sans auth — DOIT bloquer');
{
  const r = await run(statusHandler, { body: { messageIds: ['a'] } });
  check('status = 401', () => assert.equal(r.status, 401));
}

console.log('\nTest 7: /api/auth avec mauvais mdp — DOIT retourner 401');
{
  const r = await run(authHandler, { body: { password: 'pas-le-bon' } });
  check('status = 401', () => assert.equal(r.status, 401));
  check('pas de success:true', () => assert.ok(!r.body?.success));
}

console.log('\nTest 8: /api/auth avec bon mdp — DOIT retourner 200');
{
  const r = await run(authHandler, { body: { password: REAL_PASSWORD } });
  check('status = 200', () => assert.equal(r.status, 200));
  check('success = true', () => assert.equal(r.body?.success, true));
}

console.log('\nTest 9: /api/send avec BON token — auth passe (mais Resend fail)');
{
  const r = await run(sendHandler, {
    headers: { authorization: 'Bearer ' + REAL_PASSWORD },
    body: { to: 'x@x.com', subject: 's', body: 'b' },
  });
  check('status != 401 (auth OK)', () => assert.notEqual(r.status, 401));
}

console.log('\nTest 10: timing attack — comparaisons constantes');
{

  const r1 = await run(sendHandler, { headers: { authorization: 'Bearer ' + 'x'.repeat(REAL_PASSWORD.length) }, body: {} });
  const r2 = await run(sendHandler, { headers: { authorization: 'Bearer x' }, body: {} });
  check('long mais faux → 401', () => assert.equal(r1.status, 401));
  check('court → 401', () => assert.equal(r2.status, 401));
}

console.log(`\n${failed} test(s) en échec`);
if (failed > 0) process.exit(1);
