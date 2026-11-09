// CloudFront Function (runtime cloudfront-js-2.0, viewer request): a Hibira
// waiting room in front of the paths of the cache behavior you attach it to.
// Visitors without a valid pass go to the hosted queue page; when it's their
// turn they come back with ?hibira_pass=..., which is checked here and kept
// in an HttpOnly cookie.
//
// The app secret lives in a CloudFront KeyValueStore associated with this
// function (key "hibira_secret", and "hibira_previous_secret" during a
// rotation), never in the code. Fill in the four constants below.
import cf from 'cloudfront';
import crypto from 'crypto';

const KVS_ID = 'REPLACE_WITH_KEY_VALUE_STORE_ID';
const APP_KEY = 'REPLACE_WITH_APP_KEY';
const ROOM = 'presale';
const WAIT_HOST = 'https://ws.hibira.io';
const LANG = ''; // for example 'ja'; empty follows the browser

const PURPOSE = 'hibira-waitroom-pass.';
const COOKIE = 'hibira_wr_' + ROOM;

function b64url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function verify(token, secrets, now) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !/^[A-Za-z0-9_-]+$/.test(parts[0] + parts[1])) return null;
  let ok = false;
  for (let i = 0; i < secrets.length; i++) {
    if (!secrets[i]) continue;
    const want = b64url(crypto.createHmac('sha256', secrets[i]).update(PURPOSE + parts[0]).digest('base64'));
    // Compare without stopping at the first difference.
    let diff = want.length === parts[1].length ? 0 : 1;
    for (let j = 0; j < want.length; j++) diff |= want.charCodeAt(j) ^ (parts[1].charCodeAt(j) || 0);
    if (diff === 0) ok = true;
  }
  if (!ok) return null;
  let claims;
  try {
    const b64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(Buffer.from(b64 + '==='.slice((b64.length + 3) % 4), 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!claims || claims.v !== 1 || typeof claims.exp !== 'number' || now >= claims.exp || claims.room !== ROOM) return null;
  return claims;
}

function query(qs, skip) {
  const out = [];
  for (const name in qs) {
    if (name === skip) continue;
    const p = qs[name];
    const values = p.multiValue ? p.multiValue.map((m) => m.value) : [p.value];
    for (let i = 0; i < values.length; i++) out.push(encodeURIComponent(name) + (values[i] === '' ? '' : '=' + encodeURIComponent(values[i])));
  }
  return out.length ? '?' + out.join('&') : '';
}

async function handler(event) {
  const req = event.request;
  const kvs = cf.kvs(KVS_ID);
  const secrets = [await kvs.get('hibira_secret')];
  try {
    secrets.push(await kvs.get('hibira_previous_secret'));
  } catch (e) {
    // Not set: no rotation in progress.
  }
  const now = Math.floor(Date.now() / 1000);
  const here = 'https://' + req.headers.host.value + req.uri + query(req.querystring, 'hibira_pass');
  const noStore = { 'cache-control': { value: 'no-store' } };

  const fresh = req.querystring.hibira_pass && req.querystring.hibira_pass.value;
  const fromQueue = fresh ? verify(fresh, secrets, now) : null;
  if (fromQueue) {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: here }, 'cache-control': { value: 'no-store' } },
      cookies: { [COOKIE]: { value: fresh, attributes: 'Path=/; Max-Age=' + Math.max(0, fromQueue.exp - now) + '; HttpOnly; SameSite=Lax; Secure' } },
    };
  }
  const cookie = req.cookies[COOKIE];
  if (cookie && verify(cookie.value, secrets, now)) return req;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { statusCode: 403, statusDescription: 'Forbidden', headers: noStore };
  }
  let wait = WAIT_HOST + '/wait/' + encodeURIComponent(APP_KEY) + '/' + encodeURIComponent(ROOM) + '?return=' + encodeURIComponent(here);
  if (LANG) wait += '&lang=' + encodeURIComponent(LANG);
  return { statusCode: 302, statusDescription: 'Found', headers: { location: { value: wait }, 'cache-control': { value: 'no-store' } } };
}
