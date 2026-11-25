package waitingroom

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The shared test vector of test/server.test.mjs: signed by the Hibira
// server (internal/waitroom NewPass) at 1800000000, ttl 30 minutes.
const (
	secret = "wr-secret-0123456789"
	pass   = "eyJ2IjoxLCJhcHAiOiJ3ci1hcHAiLCJyb29tIjoicHJlc2FsZSIsIm4iOjQyLCJ0aWQiOiJkNzlmZTc4OWEzOGI4NjMxYjUiLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDAwMTgwMH0.q7Uc_O6XKwNA_LVLQITlgv_YtDi9dIwiRzUUUSsGa08"
	ticket = "eyJ2IjoxLCJhcHAiOiJ3ci1hcHAiLCJyb29tIjoicHJlc2FsZSIsIm4iOjQyLCJ0aWQiOiJkNzlmZTc4OWEzOGI4NjMxYjUiLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDA4NjQwMH0.l-KNMOVwV_xJJCQaQ-JXQKsrj-XlEdsTxG7X4Kp_2ck"
)

var now = time.Unix(1800000100, 0)

func opts() VerifyOptions {
	return VerifyOptions{Secret: []string{secret}, Room: "presale", AppID: "wr-app", Now: now}
}

func TestVerify(t *testing.T) {
	p := Verify(pass, opts())
	want := Pass{AppID: "wr-app", Room: "presale", Number: 42, TicketID: "d79fe789a38b8631b5", IssuedAt: 1800000000, ExpiresAt: 1800001800}
	if p == nil || *p != want {
		t.Fatalf("Verify = %+v, want %+v", p, want)
	}
	if Verify(pass, VerifyOptions{Secret: []string{"old-secret", secret}, Now: now}) == nil {
		t.Fatal("rotation: any secret should do")
	}
}

func TestVerifyRejects(t *testing.T) {
	cases := map[string]func() *Pass{
		"wrong secret": func() *Pass { o := opts(); o.Secret = []string{"wrong"}; return Verify(pass, o) },
		"other room":   func() *Pass { o := opts(); o.Room = "other"; return Verify(pass, o) },
		"other app":    func() *Pass { o := opts(); o.AppID = "other"; return Verify(pass, o) },
		"expired":      func() *Pass { o := opts(); o.Now = time.Unix(1800001800, 0); return Verify(pass, o) },
		"ticket":       func() *Pass { return Verify(ticket, opts()) },
		"tampered":     func() *Pass { return Verify(pass[:len(pass)-3]+"AAA", opts()) },
		"empty":        func() *Pass { return Verify("", opts()) },
		"no secret":    func() *Pass { o := opts(); o.Secret = nil; return Verify(pass, o) },
		"garbage":      func() *Pass { return Verify("a.b.c", opts()) },
		"too long":     func() *Pass { return Verify(strings.Repeat("a", 1025), opts()) },
	}
	for name, f := range cases {
		if p := f(); p != nil {
			t.Errorf("%s: got %+v, want nil", name, p)
		}
	}
}

func TestSignUser(t *testing.T) {
	tok, err := SignUser(secret, "presale", "cust_42", 600*time.Second, time.Unix(1800000000, 0))
	if err != nil {
		t.Fatal(err)
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("hibira-waitroom-user.presale.cust_42.1800000600"))
	if want := "cust_42.1800000600." + hex.EncodeToString(m.Sum(nil)); tok != want {
		t.Fatalf("SignUser = %s, want %s", tok, want)
	}
	if _, err := SignUser(secret, "presale", "a.b", 0, now); err == nil {
		t.Fatal("a dot in userID should fail")
	}
	tok, _ = SignUser(secret, "presale", "u", 30*24*time.Hour, time.Unix(1800000000, 0))
	if !strings.HasPrefix(tok, "u.1800604800.") {
		t.Fatalf("ttl should be capped at 7 days: %s", tok)
	}
}

func TestWaitingRoomURL(t *testing.T) {
	got := WaitingRoomURL(URLOptions{AppKey: "key", Room: "presale", ReturnURL: "https://shop.test/drop?a=1", Lang: "ja"})
	want := "https://ws.hibira.io/wait/key/presale?lang=ja&return=https%3A%2F%2Fshop.test%2Fdrop%3Fa%3D1"
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func guard() Guard {
	return Guard{AppKey: "key", Secret: []string{secret}, Room: "presale", Now: func() time.Time { return now }}
}

func serve(g Guard, r *http.Request) (*httptest.ResponseRecorder, *Pass) {
	var seen *Pass
	h := g.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = FromContext(r.Context())
		_, _ = w.Write([]byte("page"))
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w, seen
}

func TestMiddlewareNoPass(t *testing.T) {
	w, _ := serve(guard(), httptest.NewRequest("GET", "https://shop.test/drop", nil))
	if w.Code != 302 || w.Header().Get("Location") != "https://ws.hibira.io/wait/key/presale?return=https%3A%2F%2Fshop.test%2Fdrop" {
		t.Fatalf("got %d %s", w.Code, w.Header().Get("Location"))
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("redirect must not be cached")
	}
	w, _ = serve(guard(), httptest.NewRequest("POST", "https://shop.test/drop", nil))
	if w.Code != 403 || !strings.Contains(w.Body.String(), "waiting_room") {
		t.Fatalf("POST without pass: %d %s", w.Code, w.Body.String())
	}
}

func TestMiddlewareFromQueue(t *testing.T) {
	r := httptest.NewRequest("GET", "/drop?item=7&hibira_pass="+pass, nil)
	r.Header.Set("X-Forwarded-Proto", "https")
	w, _ := serve(guard(), r)
	if w.Code != 302 || w.Header().Get("Location") != "https://example.com/drop?item=7" {
		t.Fatalf("got %d %s", w.Code, w.Header().Get("Location"))
	}
	c := w.Result().Cookies()
	if len(c) != 1 || c[0].Name != "hibira_wr_presale" || c[0].Value != pass || !c[0].HttpOnly || !c[0].Secure || c[0].MaxAge != 1700 {
		t.Fatalf("cookie %+v", c)
	}
	r = httptest.NewRequest("GET", "/drop?hibira_pass=forged", nil)
	w, _ = serve(guard(), r)
	if w.Code != 302 || !strings.HasPrefix(w.Header().Get("Location"), "https://ws.hibira.io/wait/key/presale") || len(w.Result().Cookies()) != 0 {
		t.Fatalf("forged pass should go to the queue: %d %s", w.Code, w.Header().Get("Location"))
	}
}

func TestMiddlewareCookie(t *testing.T) {
	r := httptest.NewRequest("POST", "/drop", nil)
	r.AddCookie(&http.Cookie{Name: "hibira_wr_presale", Value: pass})
	w, p := serve(guard(), r)
	if w.Code != 200 || p == nil || p.Number != 42 {
		t.Fatalf("got %d %+v", w.Code, p)
	}
}

func TestMiddlewareUser(t *testing.T) {
	g := guard()
	g.User = func(*http.Request) string { return "u.1.sig" }
	w, _ := serve(g, httptest.NewRequest("GET", "/drop", nil))
	if !strings.Contains(w.Header().Get("Location"), "user=u.1.sig") {
		t.Fatalf("user token missing: %s", w.Header().Get("Location"))
	}
}
