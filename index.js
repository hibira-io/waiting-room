// Browser client for Hibira waiting rooms, for sites that design their own
// waiting page instead of using the hosted one. Speaks the Pusher protocol
// directly (no pusher-js needed) and falls back to polling.

const DEFAULT_HOST = 'https://ws.hibira.io';
const STATUS_EVENT = 'hibira:waitroom-status';

/**
 * Joins a room and follows the line.
 * Callbacks: onUpdate({ number, position, ahead, etaMinutes, status }),
 * onTurn({ pass, number, expiresAt, redirect(url) }), onClosed(status), onError(err).
 * Returns { leave() }.
 */
export function joinWaitingRoom({
  key,
  room,
  host = DEFAULT_HOST,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  onUpdate,
  onTurn,
  onClosed,
  onError,
  WebSocket: WS = typeof WebSocket !== 'undefined' ? WebSocket : null,
  fetch: f = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
} = {}) {
  if (!key || !room) throw new Error('joinWaitingRoom: key and room are required');
  const base = new URL('/waitroom/' + encodeURIComponent(key) + '/' + encodeURIComponent(room), host).toString();
  const storeKey = 'hibira-waitroom:' + key + ':' + room;
  let ticket = null;
  let number = 0;
  let status = null;
  let stopped = false;
  let turn = false;
  let ws = null;
  let live = false;
  let last = 0;
  let backoff = 1000;
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms);
    timers.add(t);
  };
  try { ticket = storage && JSON.parse(storage.getItem(storeKey) || 'null')?.ticket; } catch { /* storage blocked */ }
  const save = () => { try { storage && storage.setItem(storeKey, JSON.stringify({ ticket })); } catch { /* ignore */ } };
  const forget = () => { ticket = null; number = 0; try { storage && storage.removeItem(storeKey); } catch { /* ignore */ } };
  const retry = (fn, err) => {
    if (err && onError) onError(err);
    later(fn, backoff + Math.random() * backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
  const post = async (path, body) => {
    const r = await f(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    let j = {};
    try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status, j };
  };

  function update(s) {
    if (!s || typeof s.admitted !== 'number' || stopped) return;
    if (status && s.at && status.at && s.at < status.at) return;
    status = s;
    last = Date.now();
    if (s.state === 'closed' && (!number || number > s.admitted)) {
      if (onClosed) onClosed(s);
      return;
    }
    if (!number) return;
    if (number <= s.admitted) return takeTurn();
    const position = number - s.admitted;
    const moving = s.state === 'open' && s.admit_per_minute > 0 && !(s.starts_at && Date.parse(s.starts_at) > Date.now());
    if (onUpdate) onUpdate({ number, position, ahead: position - 1, etaMinutes: moving ? position / s.admit_per_minute : null, status: s });
  }

  async function join() {
    try {
      const res = await post('/join', ticket ? { ticket } : {});
      if (res.status === 200 || res.status === 201) {
        ticket = res.j.ticket;
        number = res.j.number;
        backoff = 1000;
        save();
        update(res.j);
      } else if (res.status === 409 && res.j.status) {
        update(res.j.status);
      } else if (res.status === 404) {
        if (onError) onError(new Error('waiting room not found'));
      } else {
        throw new Error('join failed: ' + res.status);
      }
    } catch (err) {
      retry(join, err);
    }
  }

  async function takeTurn() {
    if (turn) return;
    turn = true;
    try {
      const res = await post('/pass', { ticket });
      if (res.status === 200 && res.j.pass) {
        stop();
        const pass = res.j.pass;
        if (onTurn) {
          onTurn({
            pass,
            number: res.j.number,
            expiresAt: res.j.expires_at,
            redirect(url) {
              const u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
              u.searchParams.set('hibira_pass', pass);
              location.replace(u.toString());
            },
          });
        }
      } else if (res.status === 403) {
        turn = false;
        forget();
        join();
      } else if (res.status === 409 && res.j.status) {
        turn = false;
        update(res.j.status);
      } else {
        throw new Error('pass failed: ' + res.status);
      }
    } catch (err) {
      turn = false;
      retry(takeTurn, err);
    }
  }

  function connect() {
    if (!WS || stopped) return;
    const u = new URL('/app/' + encodeURIComponent(key), host);
    u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
    u.search = 'protocol=7&client=hibira-waiting-room&version=0.1.0';
    try { ws = new WS(u.toString()); } catch { ws = null; return; }
    ws.onmessage = (m) => {
      let fr;
      try { fr = JSON.parse(m.data); } catch { return; }
      if (fr.event === 'pusher:connection_established') {
        ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: 'cache-waitroom-' + room } }));
      } else if (fr.event === 'pusher_internal:subscription_succeeded') {
        live = true;
      } else if (fr.event === 'pusher:ping') {
        ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      } else if (fr.event === STATUS_EVENT) {
        try { update(typeof fr.data === 'string' ? JSON.parse(fr.data) : fr.data); } catch { /* ignore */ }
      }
    };
    ws.onclose = () => {
      live = false;
      ws = null;
      later(connect, 15000 + Math.random() * 15000);
    };
  }

  async function poll() {
    try {
      const r = await f(base);
      if (r.ok) update(await r.json());
    } catch { /* next round */ }
  }

  const watchdog = setInterval(() => {
    if (stopped || turn || !number) return;
    if (Date.now() - last > (live ? 25000 : 5000 + Math.random() * 3000)) {
      last = Date.now();
      poll();
    }
  }, 1000);

  function stop() {
    stopped = true;
    clearInterval(watchdog);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (ws) { try { ws.onclose = null; ws.close(); } catch { /* ignore */ } }
  }

  join();
  connect();
  return {
    leave: stop,
    get number() { return number; },
    get status() { return status; },
  };
}
