# Changelog

## Unreleased

- `joinWaitingRoom` connects its WebSocket through the edge (`wss://ws-edge.hibira.io`) by default, so queued visitors share edge shards and use the waiting room's own connection pool instead of the app's plan. New `wsHost` option to override it; a custom `host` keeps using that host.

## 0.1.0

- `verifyPass`, `protect` (Cloudflare Workers, Next.js middleware, Deno, Bun), `expressWaitingRoom` and `waitingRoomUrl` in `@hibira-io/waiting-room/server`.
- `joinWaitingRoom` browser client for custom waiting pages, with WebSocket updates and polling fallback.
