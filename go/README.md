# Hibira waiting room for Go

Check [Hibira waiting room](https://hibira.io/waiting-room) passes in Go, and
put the queue in front of any `net/http` handler. No dependencies; Go 1.21+.

```sh
go get github.com/hibira-io/waiting-room/go
```

```go
import waitingroom "github.com/hibira-io/waiting-room/go"

room := waitingroom.Guard{
	AppKey: os.Getenv("HIBIRA_KEY"),
	Secret: []string{os.Getenv("HIBIRA_SECRET")}, // add the old secret during a rotation
	Room:   "presale",
}
http.Handle("/drop/", room.Middleware(dropHandler))

func dropHandler(w http.ResponseWriter, r *http.Request) {
	pass := waitingroom.FromContext(r.Context())
	// pass.Number, pass.TicketID (record it to allow one checkout per number)
}
```

The middleware behaves like `@hibira-io/waiting-room/server` and the other
framework packages:

1. A request without a valid pass is redirected to the hosted waiting page.
   Requests other than GET and HEAD get a `403` instead.
2. When it's their turn, the page sends the visitor back with `?hibira_pass=...`.
   The pass is checked, stored in the HttpOnly cookie `hibira_wr_<room>`, and
   the visitor is redirected to the same URL without the parameter.
3. While the cookie holds a valid pass, requests reach your handler.

Behind a proxy that ends TLS, the `X-Forwarded-Proto: https` header makes the
cookie `Secure` and the return URL `https`.

Other routers:

- chi, gorilla/mux: `r.Use(room.Middleware)`.
- Echo: `e.Group("/drop", echo.WrapMiddleware(room.Middleware))`.
- Gin, Fiber or anything else: call `room.Decide(r)` and act on its `Action`
  (`Allow`, `Redirect` with `Location` and `Cookie`, or `Deny`).

Rooms with one place per signed-in customer: set `Guard.User` to a function
that returns `waitingroom.SignUser(secret, room, customerID, time.Hour, time.Time{})`
for the signed-in customer, and compare `pass.UserID` at checkout.

To check a pass anywhere else: `waitingroom.Verify(token, waitingroom.VerifyOptions{Secret: []string{secret}, Room: "presale"})`
returns the pass, or `nil` when it is missing, forged, expired or for another room.

Releases are tagged `go/vX.Y.Z`.

## 中文摘要

Go 版 Hibira 等候室：`Guard.Middleware` 可包住任何 `net/http` handler（chi、Echo、Gin 等也能用）。沒有有效 pass 的訪客會被導到託管等候頁（非 GET 回 403）；輪到時帶 `?hibira_pass=` 回來，驗證後存進 HttpOnly cookie `hibira_wr_<room>` 並移除參數。`Verify` 可在任何地方驗證 pass，`SignUser` 用於「每位登入顧客一個位置」的房間。無外部依賴，Go 1.21 以上。
