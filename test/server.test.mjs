import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyPass, protect, decide, waitingRoomUrl, expressWaitingRoom } from '../server.js';

// Signed by the Hibira server (internal/waitroom NewPass) at 1800000000, ttl 30 min.
const SECRET = 'wr-secret-0123456789';
const PASS = 'eyJ2IjoxLCJhcHAiOiJ3ci1hcHAiLCJyb29tIjoicHJlc2FsZSIsIm4iOjQyLCJ0aWQiOiJkNzlmZTc4OWEzOGI4NjMxYjUiLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDAwMTgwMH0.q7Uc_O6XKwNA_LVLQITlgv_YtDi9dIwiRzUUUSsGa08';
const TICKET = 'eyJ2IjoxLCJhcHAiOiJ3ci1hcHAiLCJyb29tIjoicHJlc2FsZSIsIm4iOjQyLCJ0aWQiOiJkNzlmZTc4OWEzOGI4NjMxYjUiLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDA4NjQwMH0.l-KNMOVwV_xJJCQaQ-JXQKsrj-XlEdsTxG7X4Kp_2ck';
const NOW = 1800000100 * 1000;

function sign(claims, secret = SECRET) {
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return p + '.' + createHmac('sha256', secret).update('hibira-waitroom-pass.' + p).digest('base64url');
}

test('verifies a pass signed by the server', async () => {
  const c = await verifyPass(PASS, { secret: SECRET, room: 'presale', appId: 'wr-app', now: NOW });
  assert.deepEqual(c, { appId: 'wr-app', room: 'presale', number: 42, ticketId: 'd79fe789a38b8631b5', issuedAt: 1800000000, expiresAt: 1800001800 });
  assert.ok(await verifyPass(PASS, { secret: ['old-secret', SECRET], now: NOW }), 'rotation: any secret');
});

test('rejects forged, expired, foreign and ticket tokens', async () => {
  const o = { secret: SECRET, room: 'presale', now: NOW };
  assert.equal(await verifyPass(PASS, { ...o, secret: 'wrong' }), null);
  assert.equal(await verifyPass(PASS, { ...o, room: 'other' }), null);
  assert.equal(await verifyPass(PASS, { ...o, appId: 'other' }), null);
  assert.equal(await verifyPass(PASS, { ...o, now: 1800001800 * 1000 }), null);
  assert.equal(await verifyPass(TICKET, o), null, 'a ticket is not a pass');
  assert.equal(await verifyPass(PASS.slice(0, -3) + 'AAA', o), null);
  assert.equal(await verifyPass('', o), null);
  assert.equal(await verifyPass(null, o), null);
  assert.equal(await verifyPass('a.b.c', o), null);
  assert.equal(await verifyPass(sign({ v: 2, app: 'a', room: 'presale', exp: 1900000000 }), o), null);
});

const opts = { appKey: 'wr-key', room: 'presale', secret: SECRET, host: 'https://ws.example.com' };
const fresh = () => sign({ v: 1, app: 'wr-app', room: 'presale', n: 7, tid: 't7', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });

test('protect sends visitors without a pass to the queue', async () => {
  const res = await protect(new Request('https://shop.example.com/drop?id=1'), opts);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), waitingRoomUrl({ ...opts, returnUrl: 'https://shop.example.com/drop?id=1' }));
  assert.equal(res.headers.get('location'), 'https://ws.example.com/wait/wr-key/presale?return=https%3A%2F%2Fshop.example.com%2Fdrop%3Fid%3D1');
  const post = await protect(new Request('https://shop.example.com/checkout', { method: 'POST' }), opts);
  assert.equal(post.status, 403);
});

test('protect turns ?hibira_pass into a cookie, then lets the visitor through', async () => {
  const pass = fresh();
  const res = await protect(new Request('https://shop.example.com/drop?id=1&hibira_pass=' + pass), opts);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://shop.example.com/drop?id=1');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^hibira_wr_presale=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
  const ok = await protect(new Request('https://shop.example.com/drop?id=1', { headers: { cookie: 'a=b; ' + cookie.split(';')[0] } }), opts);
  assert.equal(ok, null);
  const d = await decide({ url: 'https://shop.example.com/x', cookie: cookie.split(';')[0] }, opts);
  assert.equal(d.action, 'allow');
  assert.equal(d.claims.number, 7);
});

test('a bad ?hibira_pass goes back to the queue', async () => {
  const res = await protect(new Request('https://shop.example.com/drop?hibira_pass=' + sign({ v: 1, app: 'x', room: 'presale', exp: 9e9 }, 'nope')), opts);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^https:\/\/ws\.example\.com\/wait\/wr-key\/presale\?return=https%3A%2F%2Fshop\.example\.com%2Fdrop$/);
});

test('express middleware', async () => {
  const mw = expressWaitingRoom(opts);
  const run = (req) => new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() { resolve({ res: this }); } };
    mw({ protocol: 'https', headers: { host: 'shop.example.com', cookie: req.cookie }, originalUrl: req.url, method: req.method || 'GET' }, res, () => resolve({ next: true, req }));
  });
  const a = await run({ url: '/drop' });
  assert.equal(a.res.statusCode, 302);
  const b = await run({ url: '/drop', cookie: 'hibira_wr_presale=' + fresh() });
  assert.equal(b.next, true);
});

test('signUser matches the server format', async () => {
  const { signUser } = await import('../server.js');
  const { createHmac } = await import('node:crypto');
  const tok = await signUser({ secret: 'wr-secret-0123456789', room: 'presale', userId: 'cust_42', ttlSeconds: 600, now: 1800000000000 });
  const want = createHmac('sha256', 'wr-secret-0123456789').update('hibira-waitroom-user.presale.cust_42.1800000600').digest('hex');
  assert.equal(tok, 'cust_42.1800000600.' + want);
  await assert.rejects(signUser({ secret: 's', room: 'r', userId: 'a.b' }));
});
