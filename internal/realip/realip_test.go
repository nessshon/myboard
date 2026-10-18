package realip_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/realip"
	"github.com/nessshon/myboard/internal/testutil"
)

func TestHeaderIsBelievedOnlyFromTrustedProxies(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/test/ip", func(e *core.RequestEvent) error { return e.String(200, e.RealIP()) })
		return se.Next()
	})
	h := testutil.Handler(t, app)

	cases := []struct{ name, remote, header, want string }{
		{"nginx on the same host passes the client", "127.0.0.1:41000", "203.0.113.7", "203.0.113.7"},
		{"a proxy in a Docker network passes the client", "172.18.0.5:41000", "203.0.113.8", "203.0.113.8"},
		{"a direct client cannot pose as another", "198.51.100.4:41000", "203.0.113.9", "198.51.100.4"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/test/ip", nil)
		req.RemoteAddr = c.remote
		req.Header.Set(realip.Header, c.header)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if got := rec.Body.String(); got != c.want {
			t.Errorf("%s: RealIP %q, want %q", c.name, got, c.want)
		}
	}
}
