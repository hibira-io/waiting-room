// Runs the edge templates against stand-ins for their platforms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as nodeCrypto from 'node:crypto';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SECRET = 'app-secret';
function sign(claims, secret = SECRET) {
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return p + '.' + createHmac('sha256', secret).update('hibira-waitroom-pass.' + p).digest('base64url');
}
const fresh = (room = 'presale') => {
  const now = Math.floor(Date.now() / 1000);
  return sign({ v: 1, app: '1', room, n: 7, tid: 't7', iat: now, exp: now + 600 });
};

async function loadCloudFront(kv) {
  let src = await readFile(new URL('../templates/cloudfront/waiting-room.js', import.meta.url), 'utf8');
  src = src.replace("import cf from 'cloudfront';", '').replace("import crypto from 'crypto';", '');
  src = src.replace("'REPLACE_WITH_KEY_VALUE_STORE_ID'", "'kvs-1'").replace("'REPLACE_WITH_APP_KEY'", "'app-key'");
  const cf = { kvs: (id) => ({ get: async (k) => { assert.equal(id, 'kvs-1'); if (!(k in kv)) throw new Error('key not found'); return kv[k]; } }) };
  return new Function('cf', 'crypto', 'Buffer', src + '\nreturn handler;')(cf, nodeCrypto, Buffer);
}

function cfEvent({ uri = '/drop/1', qs = {}, cookies = {}, method = 'GET' } = {}) {
  const querystring = {};
  for (const [k, v] of Object.entries(qs)) querystring[k] = { value: v };
  const c = {};
  for (const [k, v] of Object.entries(cookies)) c[k] = { value: v };
  return { request: { method, uri, querystring, headers: { host: { value: 'shop.example.com' } }, cookies: c } };
}

test('cloudfront function', async () => {
  const handler = await loadCloudFront({ hibira_secret: SECRET });
  const none = await handler(cfEvent({ qs: { a: 'b' } }));
  assert.equal(none.statusCode, 302);
  assert.equal(none.headers.location.value, 'https://ws.hibira.io/wait/app-key/presale?return=https%3A%2F%2Fshop.example.com%2Fdrop%2F1%3Fa%3Db');
  assert.equal((await handler(cfEvent({ method: 'POST' }))).statusCode, 403);

  const pass = fresh();
  const back = await handler(cfEvent({ qs: { a: 'b', hibira_pass: pass } }));
  assert.equal(back.statusCode, 302);
  assert.equal(back.headers.location.value, 'https://shop.example.com/drop/1?a=b');
  assert.equal(back.cookies.hibira_wr_presale.value, pass);
  assert.match(back.cookies.hibira_wr_presale.attributes, /^Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);

  const req = cfEvent({ cookies: { hibira_wr_presale: pass } });
  assert.equal(await handler(req), req.request);
  for (const bad of [fresh('other'), sign({ v: 1, room: 'presale', exp: 9e9 }, 'nope'), 'a.b.c', pass.slice(0, -2)]) {
    assert.equal((await handler(cfEvent({ cookies: { hibira_wr_presale: bad } }))).statusCode, 302, bad);
  }

  const rotated = await loadCloudFront({ hibira_secret: 'new-secret', hibira_previous_secret: SECRET });
  const r = cfEvent({ cookies: { hibira_wr_presale: pass } });
  assert.equal(await rotated(r), r.request);
});

test('netlify edge function', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wr-netlify-'));
  const src = (await readFile(new URL('../templates/netlify/netlify/edge-functions/waiting-room.js', import.meta.url), 'utf8'))
    .replace("'@hibira-io/waiting-room/server'", JSON.stringify(new URL('../server.js', import.meta.url).href));
  await writeFile(join(dir, 'fn.mjs'), src);
  const env = { HIBIRA_KEY: 'app-key', HIBIRA_SECRET: SECRET, HIBIRA_ROOM: 'presale' };
  globalThis.Netlify = { env: { get: (k) => env[k] } };
  const { default: fn, config } = await import(pathToFileURL(join(dir, 'fn.mjs')).href);
  assert.deepEqual(config.path, ['/drop', '/drop/*']);
  const context = { next: () => 'origin' };

  const none = await fn(new Request('https://shop.example.com/drop/1'), context);
  assert.equal(none.status, 302);
  assert.match(none.headers.get('location'), /^https:\/\/ws\.hibira\.io\/wait\/app-key\/presale\?return=/);
  const pass = fresh();
  const back = await fn(new Request('https://shop.example.com/drop/1?hibira_pass=' + pass), context);
  assert.equal(back.headers.get('location'), 'https://shop.example.com/drop/1');
  assert.equal(await fn(new Request('https://shop.example.com/drop/1', { headers: { cookie: 'hibira_wr_presale=' + pass } }), context), 'origin');
});
