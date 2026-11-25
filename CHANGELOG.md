# Changelog

## Unreleased

- The Go package moved to [hibira-io/go](https://github.com/hibira-io/go) as `github.com/hibira-io/go/waitingroom`, released with plain `vX.Y.Z` tags. The untagged `go/` folder here is removed.

## 0.3.0

- `fastifyWaitingRoom()` (an `onRequest` hook) and `koaWaitingRoom()` in `@hibira-io/waiting-room/server`.
- README recipes for Hono, SvelteKit, Astro, Nuxt/Nitro, Remix and React Router with `protect()`.
- Go: `github.com/hibira-io/waiting-room/go`, the pass check, `SignUser` and a `net/http` middleware with the same behaviour (tagged `go/v0.1.0`).
- The `lang` option's type accepts `'it'` and `'fr'`: the hosted waiting page now speaks Italian and French.

## 0.2.0

- `signUser()` and `waitingRoomUrl({ user })` for rooms with one place per signed-in customer; `verifyPass` returns `userId` from such passes.
- `joinWaitingRoom({ user })`, and support for rooms that draw places for early arrivals: `onUpdate` reports `drawPending`, and the client asks for its drawn place once the line starts.
- A refused join (sign-in required, bot check failed) stops the client and reports the error code through `onError`.
- `joinWaitingRoom` connects its WebSocket through the edge (`wss://ws-edge.hibira.io`) by default, so queued visitors share edge shards and use the waiting room's own connection pool instead of the app's plan. New `wsHost` option to override it; a custom `host` keeps using that host.

## 0.1.0

- `verifyPass`, `protect` (Cloudflare Workers, Next.js middleware, Deno, Bun), `expressWaitingRoom` and `waitingRoomUrl` in `@hibira-io/waiting-room/server`.
- `joinWaitingRoom` browser client for custom waiting pages, with WebSocket updates and polling fallback.
