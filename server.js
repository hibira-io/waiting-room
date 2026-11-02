// Server side of Hibira waiting rooms: check the pass a visitor brings back
// from the waiting room, and send visitors without one to the queue.
// Uses only Web Crypto and URL, so it runs in Cloudflare Workers, Vercel and
// Next.js middleware, Deno, Bun and Node 18+.

const enc = new TextEncoder();
const PURPOSE = 'hibira-waitroom-pass';
const DEFAULT_HOST = 'https://ws.hibira.io';
const keys = new Map();

function b64urlToBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  try {
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hmacKey(secret) {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (keys.size > 16) keys.clear();
    keys.set(secret, k);
  }
  return k;
}

/**
 * Verifies a waiting room pass. Returns its claims, or null when the pass
 * is missing, forged, expired, or for another room or app.
 */
export async function verifyPass(pass, { secret, room, appId, now = Date.now() } = {}) {
  if (!secret) throw new Error('verifyPass: secret is required');
  if (typeof pass !== 'string' || pass.length > 1024) return null;
  const dot = pass.indexOf('.');
  if (dot < 1) return null;
  const payload = pass.slice(0, dot);
  const sig = b64urlToBytes(pass.slice(dot + 1));
  if (!sig || sig.length !== 32) return null;
  const secrets = Array.isArray(secret) ? secret : [secret];
  let ok = false;
  for (const s of secrets) {
    if (await crypto.subtle.verify('HMAC', await hmacKey(s), sig, enc.encode(PURPOSE + '.' + payload))) {
      ok = true;
      break;
    }
  }
  if (!ok) return null;
  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
  if (!claims || claims.v !== 1 || typeof claims.exp !== 'number') return null;
  if (now / 1000 >= claims.exp) return null;
  if (room !== undefined && claims.room !== room) return null;
  if (appId !== undefined && claims.app !== appId) return null;
  return { appId: claims.app, room: claims.room, number: claims.n, ticketId: claims.tid, issuedAt: claims.iat, expiresAt: claims.exp };
}

/** The hosted waiting page address for a room. */
export function waitingRoomUrl({ appKey, room, returnUrl, host = DEFAULT_HOST, lang } = {}) {
  const u = new URL('/wait/' + encodeURIComponent(appKey) + '/' + encodeURIComponent(room), host);
  if (returnUrl) u.searchParams.set('return', String(returnUrl));
  if (lang) u.searchParams.set('lang', lang);
  return u.toString();
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Decides what to do with a request, independent of the framework.
 * Returns { action: 'allow', claims } | { action: 'redirect', location, setCookie? } | { action: 'deny' }.
 */
export async function decide({ url, method = 'GET', cookie }, opts) {
  const { appKey, room, host, lang, cookieName = 'hibira_wr_' + opts.room } = opts;
  const u = new URL(url);
  const fromQueue = u.searchParams.get('hibira_pass');
  if (fromQueue) {
    u.searchParams.delete('hibira_pass');
    const claims = await verifyPass(fromQueue, opts);
    if (claims) {
      const maxAge = Math.max(0, Math.floor(claims.expiresAt - Date.now() / 1000));
      const secure = u.protocol === 'https:' ? '; Secure' : '';
      return {
        action: 'redirect',
        location: u.toString(),
        setCookie: `${cookieName}=${fromQueue}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`,
        claims,
      };
    }
  }
  const claims = await verifyPass(readCookie(cookie, cookieName), opts);
  if (claims) return { action: 'allow', claims };
  if (method !== 'GET' && method !== 'HEAD') return { action: 'deny' };
  return { action: 'redirect', location: waitingRoomUrl({ appKey, room, host, lang, returnUrl: u.toString() }) };
}

/**
 * Fetch-style guard for Cloudflare Workers, Vercel/Next.js middleware, Deno
 * and Bun. Returns null to let the request through, or a Response
 * (redirect to the queue, or 403 for a non-GET without a pass).
 */
export async function protect(request, opts) {
  const d = await decide({ url: request.url, method: request.method, cookie: request.headers.get('cookie') }, opts);
  if (d.action === 'allow') return null;
  if (d.action === 'deny') {
    return new Response(JSON.stringify({ error: 'waiting_room', message: 'join the waiting room first' }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  const headers = new Headers({ location: d.location, 'cache-control': 'no-store' });
  if (d.setCookie) headers.append('set-cookie', d.setCookie);
  return new Response(null, { status: 302, headers });
}

/** Express / Connect middleware. */
export function expressWaitingRoom(opts) {
  return function hibiraWaitingRoom(req, res, next) {
    const proto = req.protocol || (req.socket && req.socket.encrypted ? 'https' : 'http');
    const url = proto + '://' + req.headers.host + (req.originalUrl || req.url);
    decide({ url, method: req.method, cookie: req.headers.cookie }, opts).then((d) => {
      if (d.action === 'allow') {
        req.hibiraPass = d.claims;
        return next();
      }
      res.setHeader('Cache-Control', 'no-store');
      if (d.action === 'deny') {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'waiting_room', message: 'join the waiting room first' }));
      }
      if (d.setCookie) res.setHeader('Set-Cookie', d.setCookie);
      res.statusCode = 302;
      res.setHeader('Location', d.location);
      res.end();
    }, next);
  };
}
