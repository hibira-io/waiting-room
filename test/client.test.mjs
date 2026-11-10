import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinWaitingRoom } from '../index.js';

function sockets() {
  const urls = [];
  class WS { constructor(u) { urls.push(u); } send() {} close() {} }
  return { urls, WS };
}

const fetch = async () => new Response(JSON.stringify({}), { status: 503 });

test('the default host sends the socket through the edge', async () => {
  const { urls, WS } = sockets();
  const r = joinWaitingRoom({ key: 'k1', room: 'drop', storage: null, WebSocket: WS, fetch });
  await new Promise((res) => setTimeout(res, 10));
  r.leave();
  assert.ok(urls[0].startsWith('wss://ws-edge.hibira.io/app/k1?'), urls[0]);
  assert.match(urls[0], /client=hibira-waiting-room/);
});

test('a custom host keeps its own socket host', async () => {
  const { urls, WS } = sockets();
  const r = joinWaitingRoom({ key: 'k1', room: 'drop', host: 'http://localhost:8080', storage: null, WebSocket: WS, fetch });
  await new Promise((res) => setTimeout(res, 10));
  r.leave();
  assert.ok(urls[0].startsWith('ws://localhost:8080/app/k1?'), urls[0]);
});
