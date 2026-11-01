// Needs a running server: WR_E2E_HOST (http://localhost:8099), WR_E2E_KEY,
// WR_E2E_APP_ID, WR_E2E_SECRET and WR_E2E_ROOM (created by the test).
import { test } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { joinWaitingRoom } from '../../index.js';
import { verifyPass } from '../../server.js';

const env = process.env;
const skip = !env.WR_E2E_HOST && 'set WR_E2E_* to run';

async function signed(method, path, body) {
  const b = JSON.stringify(body);
  const q = { auth_key: env.WR_E2E_KEY, auth_timestamp: String(Math.floor(Date.now() / 1000)), auth_version: '1.0', body_md5: createHash('md5').update(b).digest('hex') };
  const qs = Object.keys(q).sort().map((k) => k + '=' + q[k]).join('&');
  const sig = createHmac('sha256', env.WR_E2E_SECRET).update(method + '\n' + path + '\n' + qs).digest('hex');
  const r = await fetch(env.WR_E2E_HOST + path + '?' + qs + '&auth_signature=' + sig, { method, body: b, headers: { 'content-type': 'application/json' } });
  return r.json();
}

test('two visitors queue, get pushed updates and passes in order', { skip, timeout: 30000 }, async () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  await signed('POST', '/apps/' + env.WR_E2E_APP_ID + '/waiting_rooms/' + env.WR_E2E_ROOM, { admit_per_minute: 60, state: 'paused', return_urls: ['https://shop.example.com/'] });
  const turns = [];
  const updates = [[], []];
  const done = new Promise((resolve) => {
    for (const i of [0, 1]) {
      joinWaitingRoom({
        key: env.WR_E2E_KEY, room: env.WR_E2E_ROOM, host: env.WR_E2E_HOST, storage: mem(),
        onUpdate: (u) => updates[i].push(u.position),
        onTurn: (t) => { turns.push({ i, ...t }); if (turns.length === 2) resolve(); },
        onError: (e) => console.error(e),
      });
    }
  });
  await new Promise((r) => setTimeout(r, 1500));
  await signed('POST', '/apps/' + env.WR_E2E_APP_ID + '/waiting_rooms/' + env.WR_E2E_ROOM, { state: 'open' });
  await done;
  assert.deepEqual(turns.map((t) => t.number).sort(), [1, 2]);
  for (const t of turns) {
    const c = await verifyPass(t.pass, { secret: env.WR_E2E_SECRET, room: env.WR_E2E_ROOM, appId: env.WR_E2E_APP_ID });
    assert.equal(c.number, t.number);
  }
  assert.ok(updates.flat().includes(2), 'the second visitor saw position 2');
});
