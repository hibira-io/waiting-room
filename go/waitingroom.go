// Package waitingroom checks Hibira waiting room passes in Go and puts a
// net/http middleware in front of the pages a room protects.
//
// It behaves like @hibira-io/waiting-room/server and the framework
// packages: a visitor without a valid pass is redirected to the hosted
// waiting page (a request other than GET or HEAD gets a 403), and the
// ?hibira_pass=... a visitor brings back from the queue is checked, stored
// in the HttpOnly cookie hibira_wr_<room> and removed from the URL.
//
//	room := waitingroom.Guard{AppKey: "YOUR_APP_KEY", Secret: []string{os.Getenv("HIBIRA_SECRET")}, Room: "presale"}
//	http.Handle("/drop/", room.Middleware(dropHandler))
//
// Inside the handler, waitingroom.FromContext(r.Context()) returns the pass.
package waitingroom

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultHost serves the hosted waiting page.
const DefaultHost = "https://ws.hibira.io"

const (
	passPurpose = "hibira-waitroom-pass."
	userPurpose = "hibira-waitroom-user."
	param       = "hibira_pass"
	maxPassLen  = 1024
)

// Pass is a verified waiting room pass.
type Pass struct {
	AppID string `json:"app_id"`
	Room  string `json:"room"`
	// Number is the visitor's queue number.
	Number int64 `json:"number"`
	// TicketID is the queue ticket's ID: record it to allow one checkout per number.
	TicketID string `json:"ticket_id"`
	// UserID is the signed user ID, in rooms with one place per signed-in customer.
	UserID    string `json:"user_id,omitempty"`
	IssuedAt  int64  `json:"issued_at"`
	ExpiresAt int64  `json:"expires_at"`
}

// VerifyOptions narrow which passes Verify accepts.
type VerifyOptions struct {
	// Secret is the app secret; give the old and the new one during a rotation.
	Secret []string
	// Room and AppID, when set, must match the pass.
	Room  string
	AppID string
	// Now defaults to time.Now.
	Now time.Time
}

type claims struct {
	V   int     `json:"v"`
	App string  `json:"app"`
	Rm  string  `json:"room"`
	N   int64   `json:"n"`
	Tid string  `json:"tid"`
	Sub *string `json:"sub"`
	Iat int64   `json:"iat"`
	Exp *int64  `json:"exp"`
}

// Verify checks a pass. It returns nil when the pass is missing, forged,
// expired, or for another room or app.
func Verify(pass string, o VerifyOptions) *Pass {
	if len(o.Secret) == 0 || pass == "" || len(pass) > maxPassLen {
		return nil
	}
	dot := strings.IndexByte(pass, '.')
	if dot < 1 {
		return nil
	}
	payload := pass[:dot]
	sig, err := base64.RawURLEncoding.DecodeString(pass[dot+1:])
	if err != nil || len(sig) != sha256.Size {
		return nil
	}
	ok := false
	for _, s := range o.Secret {
		if s == "" {
			continue
		}
		m := hmac.New(sha256.New, []byte(s))
		m.Write([]byte(passPurpose + payload))
		if hmac.Equal(m.Sum(nil), sig) {
			ok = true
			break
		}
	}
	if !ok {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil
	}
	var c claims
	if json.Unmarshal(raw, &c) != nil || c.V != 1 || c.Exp == nil {
		return nil
	}
	now := o.Now
	if now.IsZero() {
		now = time.Now()
	}
	if now.Unix() >= *c.Exp {
		return nil
	}
	if o.Room != "" && c.Rm != o.Room {
		return nil
	}
	if o.AppID != "" && c.App != o.AppID {
		return nil
	}
	p := &Pass{AppID: c.App, Room: c.Rm, Number: c.N, TicketID: c.Tid, IssuedAt: c.Iat, ExpiresAt: *c.Exp}
	if c.Sub != nil {
		p.UserID = *c.Sub
	}
	return p
}

// SignUser signs a user token for rooms with one place per signed-in
// customer: the same userID gets the same place in every browser. userID is
// 1 to 128 characters without "."; ttl is capped at 7 days (default 1 hour).
func SignUser(secret, room, userID string, ttl time.Duration, now time.Time) (string, error) {
	if userID == "" || len(userID) > 128 || strings.Contains(userID, ".") {
		return "", errors.New(`waitingroom: userID must be 1 to 128 characters without "."`)
	}
	if now.IsZero() {
		now = time.Now()
	}
	secs := int64(ttl / time.Second)
	if secs <= 0 {
		secs = 3600
	}
	if secs > 7*24*3600 {
		secs = 7 * 24 * 3600
	}
	exp := strconv.FormatInt(now.Unix()+secs, 10)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(userPurpose + room + "." + userID + "." + exp))
	return userID + "." + exp + "." + hex.EncodeToString(m.Sum(nil)), nil
}

// URLOptions describe the hosted waiting page.
type URLOptions struct {
	AppKey    string
	Room      string
	ReturnURL string
	// Host defaults to DefaultHost.
	Host string
	// Lang is en, zh-TW, zh-CN, ja, ko, th, vi, it or fr.
	Lang string
	// User is a token from SignUser.
	User string
}

// WaitingRoomURL is the hosted waiting page address for a room.
func WaitingRoomURL(o URLOptions) string {
	host := strings.TrimRight(o.Host, "/")
	if host == "" {
		host = DefaultHost
	}
	q := url.Values{}
	if o.ReturnURL != "" {
		q.Set("return", o.ReturnURL)
	}
	if o.Lang != "" {
		q.Set("lang", o.Lang)
	}
	if o.User != "" {
		q.Set("user", o.User)
	}
	u := host + "/wait/" + url.PathEscape(o.AppKey) + "/" + url.PathEscape(o.Room)
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

// Guard protects pages with one waiting room.
type Guard struct {
	AppKey string
	// Secret is the app secret; give the old and the new one during a rotation.
	Secret []string
	Room   string
	// AppID, when set, must match the pass.
	AppID string
	// Host defaults to DefaultHost.
	Host string
	Lang string
	// CookieName defaults to hibira_wr_<room>.
	CookieName string
	// User, when set, returns a token from SignUser for the request's
	// signed-in customer (rooms with one place per user), or "".
	User func(*http.Request) string
	// Now defaults to time.Now.
	Now func() time.Time
}

// Action is what a Decision asks for.
type Action int

const (
	// Allow serves the page.
	Allow Action = iota
	// Redirect sends the visitor to Location, setting Cookie when it is not nil.
	Redirect
	// Deny answers 403: a request other than GET or HEAD without a pass.
	Deny
)

// Decision is the outcome of Guard.Decide.
type Decision struct {
	Action   Action
	Location string
	Cookie   *http.Cookie
	Pass     *Pass
}

func (g Guard) cookieName() string {
	if g.CookieName != "" {
		return g.CookieName
	}
	return "hibira_wr_" + g.Room
}

func (g Guard) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

func requestURL(r *http.Request) url.URL {
	u := *r.URL
	u.Host = r.Host
	u.Scheme = "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		u.Scheme = "https"
	}
	return u
}

// Decide works out what to do with a request without writing a response,
// for frameworks that are not net/http.
func (g Guard) Decide(r *http.Request) Decision {
	vo := VerifyOptions{Secret: g.Secret, Room: g.Room, AppID: g.AppID, Now: g.now()}
	u := requestURL(r)
	q := u.Query()
	if fromQueue := q.Get(param); fromQueue != "" {
		q.Del(param)
		u.RawQuery = q.Encode()
		if p := Verify(fromQueue, vo); p != nil {
			maxAge := int(p.ExpiresAt - vo.Now.Unix())
			if maxAge < 1 {
				maxAge = 1
			}
			return Decision{Action: Redirect, Location: u.String(), Pass: p, Cookie: &http.Cookie{
				Name: g.cookieName(), Value: fromQueue, Path: "/", MaxAge: maxAge,
				HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: u.Scheme == "https",
			}}
		}
	}
	if c, err := r.Cookie(g.cookieName()); err == nil {
		if p := Verify(c.Value, vo); p != nil {
			return Decision{Action: Allow, Pass: p}
		}
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return Decision{Action: Deny}
	}
	user := ""
	if g.User != nil {
		user = g.User(r)
	}
	return Decision{Action: Redirect, Location: WaitingRoomURL(URLOptions{
		AppKey: g.AppKey, Room: g.Room, Host: g.Host, Lang: g.Lang, User: user, ReturnURL: u.String(),
	})}
}

type ctxKey struct{}

// FromContext returns the pass Middleware let through, or nil.
func FromContext(ctx context.Context) *Pass {
	p, _ := ctx.Value(ctxKey{}).(*Pass)
	return p
}

// Middleware protects next: only visitors with a valid pass reach it.
func (g Guard) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d := g.Decide(r)
		switch d.Action {
		case Allow:
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, d.Pass)))
		case Deny:
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"waiting_room","message":"join the waiting room first"}`))
		default:
			w.Header().Set("Cache-Control", "no-store")
			if d.Cookie != nil {
				http.SetCookie(w, d.Cookie)
			}
			w.Header().Set("Location", d.Location)
			w.WriteHeader(http.StatusFound)
		}
	})
}
