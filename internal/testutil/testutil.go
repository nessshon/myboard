package testutil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/nessshon/myboard/config"
	"github.com/nessshon/myboard/internal/apitoken"
	"github.com/nessshon/myboard/internal/auth"
	"github.com/nessshon/myboard/internal/guard"
	_ "github.com/nessshon/myboard/internal/migrations"
	"github.com/nessshon/myboard/internal/realip"
	"github.com/nessshon/myboard/internal/tasks"
	"github.com/nessshon/myboard/internal/users"
)

const OwnerTgID = "100000001"

var Config = &config.Config{
	PublicURL:        "http://127.0.0.1:8090",
	AdminTelegramID:  OwnerTgID,
	TelegramClientID: "test-client",
	TelegramSecret:   "test-secret",
	TrustedProxies:   []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("172.16.0.0/12")},
}

func NewApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	auth.Register(app, Config)
	users.Register(app, Config)
	tasks.Register(app)
	apitoken.Register(app)
	guard.Register(app)
	realip.Register(app, Config)
	return app
}

func User(t testing.TB, app core.App, tgID, role string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	u := core.NewRecord(collection)
	u.Set("tg_id", tgID)
	u.Set("name", "user "+tgID)
	u.Set("role", role)
	u.SetRandomPassword()
	if err := app.Save(u); err != nil {
		t.Fatal(err)
	}
	return u
}

func Project(t testing.TB, app core.App, key string, members ...*core.Record) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("projects")
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.Id
	}
	p := core.NewRecord(collection)
	p.Set("name", key+" project")
	p.Set("key", key)
	p.Set("members", ids)
	if err := app.Save(p); err != nil {
		t.Fatal(err)
	}
	return p
}

func Record(t testing.TB, app core.App, collectionName string, data map[string]any) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(collection)
	r.Load(data)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func Token(t testing.TB, user *core.Record) string {
	t.Helper()
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func Handler(t testing.TB, app core.App) http.Handler {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	var handler http.Handler
	se := &core.ServeEvent{App: app, Router: router}
	err = app.OnServe().Trigger(se, func(e *core.ServeEvent) error {
		handler, err = e.Router.BuildMux()
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func Do(t testing.TB, h http.Handler, token, method, url, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}
