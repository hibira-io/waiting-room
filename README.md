# @hibira-io/waiting-room

A virtual waiting room for ticket drops, flash sales and launches, built on
[Hibira](https://hibira.io). When too many people arrive at once, visitors take
a queue number, watch the line move live, and are let in at the rate you
choose. When it's their turn they get a signed pass, and your edge or server
checks it before serving the protected page.

This package has two parts:

- `@hibira-io/waiting-room/server`: checks the pass in **Cloudflare Workers,
  Next.js / Vercel middleware, Deno, Bun or Express**, and sends visitors
  without a valid pass to the queue.
- `@hibira-io/waiting-room`: a small browser client for building your own
  waiting page. Most sites use the hosted page and don't need it.

```sh
npm install @hibira-io/waiting-room
```

## 1. Create a room

Create the room with a signed request to the Hibira HTTP API, signed the same
way as `POST /apps/APP_ID/events` (any Pusher server library can produce the
signature).

```http
POST /apps/APP_ID/waiting_rooms/presale
{
  "admit_per_minute": 300,
  "state": "paused",
  "starts_at": "2026-12-04T12:00:00+09:00",
  "title": "Winter tour presale",
  "return_urls": ["https://shop.example.com/"]
}
```

Use `"state": "open"` to start admitting, `"paused"` to hold the line and
`"closed"` when you're sold out. `POST .../presale/admit {"count": 500}` lets
the next 500 in right away. The full API is in the
[waiting rooms docs](https://github.com/hibira-io/pusher-server/blob/master/docs/waiting-rooms.md).

## 2. Protect the page at the edge

### Cloudflare Workers

```js
import { protect } from '@hibira-io/waiting-room/server';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/drop')) {
      const blocked = await protect(request, {
        appKey: env.HIBIRA_KEY,
        secret: env.HIBIRA_SECRET,
        room: 'presale',
      });
      if (blocked) return blocked;
    }
    return fetch(request);
  },
};
```

### Next.js middleware

```js
// middleware.js
import { NextResponse } from 'next/server';
import { protect } from '@hibira-io/waiting-room/server';

export async function middleware(request) {
  const blocked = await protect(request, {
    appKey: process.env.HIBIRA_KEY,
    secret: process.env.HIBIRA_SECRET,
    room: 'presale',
  });
  return blocked ?? NextResponse.next();
}

export const config = { matcher: ['/drop/:path*'] };
```

### Express

```js
import { expressWaitingRoom } from '@hibira-io/waiting-room/server';

app.use('/drop', expressWaitingRoom({ appKey: process.env.HIBIRA_KEY, secret: process.env.HIBIRA_SECRET, room: 'presale' }));
app.post('/checkout', (req, res) => {
  // req.hibiraPass = { number, ticketId, expiresAt, ... }
});
```

What `protect` does:

1. A request without a valid pass is redirected to the hosted waiting page,
   `https://ws.hibira.io/wait/APP_KEY/ROOM?return=<this URL>`. POST and
   other non-GET requests get a `403` instead.
2. When it's their turn, the waiting page sends the visitor back with
   `?hibira_pass=...`. `protect` checks the pass, stores it in an HttpOnly
   cookie (`hibira_wr_<room>`), and redirects to the same URL without the
   parameter.
3. While the cookie holds a valid pass, requests go through (`protect`
   returns `null`).

Passes expire after `pass_ttl_seconds` (30 minutes by default). A pass works
in any browser while it's valid. If each queue number may check out only
once, record `ticketId` at checkout and refuse a repeat. During a secret
rotation, pass `secret: [newSecret, oldSecret]`.

### Verify anywhere

```js
import { verifyPass } from '@hibira-io/waiting-room/server';

const claims = await verifyPass(token, { secret, room: 'presale' });
// null, or { appId, room, number, ticketId, issuedAt, expiresAt }
```

The format is `base64url(JSON).base64url(HMAC-SHA256(secret, "hibira-waitroom-pass." + payload))`,
so you can check it in any language. If you'd rather not, call
`POST /apps/APP_ID/waiting_rooms/ROOM/verify` with `{"pass": "..."}`.

## Your own waiting page (optional)

```js
import { joinWaitingRoom } from '@hibira-io/waiting-room';

joinWaitingRoom({
  key: 'APP_KEY',
  room: 'presale',
  onUpdate: ({ position, ahead, etaMinutes, status }) => render(position, etaMinutes),
  onTurn: (turn) => turn.redirect('https://shop.example.com/drop'),
  onClosed: () => showSoldOut(),
});
```

Updates arrive over a WebSocket on the room's cache channel. If the
connection can't be opened (for example, the app is at its connection
limit), the client polls the status endpoint instead. The ticket is saved in
`localStorage`, so a refresh keeps the visitor's place.

## Notes

- Waiting visitors use one connection each, which counts toward your plan's
  connection limit. If the limit is reached, nobody is locked out: the page
  switches to polling.
- Numbers are handed out in order of arrival, including to visitors who
  arrive before `starts_at`. More tabs don't move anyone forward.
- Tests: `npm test`. A live test against a server: `WR_E2E_HOST=http://localhost:8080 WR_E2E_KEY=... WR_E2E_APP_ID=... WR_E2E_SECRET=... WR_E2E_ROOM=e2e npm run test:e2e`.

## 中文摘要

`@hibira-io/waiting-room` 是建立在 Hibira 上的排隊等候室（類似 Queue-it），適合搶票、限量開賣和新品上市。在 Hibira API 建立房間並設定每分鐘放行人數後，在 Cloudflare Workers、Next.js middleware 或 Express 呼叫 `protect()`。沒有通行證（pass）的訪客會被導到 Hibira 託管的等候頁（支援 7 種語言），輪到時會帶著簽名 pass 回到你的網站，並存進 HttpOnly cookie。想自己設計等候頁的話，可以用 `joinWaitingRoom()`。等候中的訪客會佔用連線數；連線數滿了，頁面會自動改成輪詢，不會有人被擋在外面。
