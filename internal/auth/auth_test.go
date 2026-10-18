package auth_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbauth "github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/nessshon/myboard/internal/auth"
	"github.com/nessshon/myboard/internal/testutil"
)

func TestOwnerIsEnsuredOnServe(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	testutil.Handler(t, app)
	owner, err := app.FindFirstRecordByData("users", "tg_id", testutil.OwnerTgID)
	if err != nil {
		t.Fatalf("owner must be created: %v", err)
	}

	owner.Set("role", "member")
	owner.Set("deleted", true)
	if err := app.Save(owner); err != nil {
		t.Fatal(err)
	}
	testutil.Handler(t, app)
	owner, _ = app.FindRecordById("users", owner.Id)
	if owner.GetString("role") != "admin" || owner.GetBool("deleted") {
		t.Fatalf("owner must be restored to an active admin, got role=%q deleted=%v", owner.GetString("role"), owner.GetBool("deleted"))
	}

	users, _ := app.FindCollectionByNameOrId("users")
	if len(users.OAuth2.Providers) != 1 || users.OAuth2.Providers[0].Name != auth.ProviderName || users.PasswordAuth.Enabled {
		t.Fatalf("users must allow Telegram login only: %+v", users.OAuth2.Providers)
	}
	provider, err := users.OAuth2.Providers[0].InitProvider()
	if err != nil {
		t.Fatal(err)
	}
	if got := provider.Scopes(); len(got) != 2 || got[0] != "openid" || got[1] != "profile" {
		t.Fatalf("telegram scopes: %v", got)
	}
}

func TestLoginHook(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "600000001", "member")
	gone := testutil.User(t, app, "600000002", "member")
	gone.Set("deleted", true)
	if err := app.Save(gone); err != nil {
		t.Fatal(err)
	}
	users, _ := app.FindCollectionByNameOrId("users")

	login := func(id any) (*core.RecordAuthWithOAuth2RequestEvent, error) {
		e := &core.RecordAuthWithOAuth2RequestEvent{
			RequestEvent: &core.RequestEvent{App: app, Event: router.Event{Request: httptest.NewRequest(http.MethodPost, "/", nil), Response: httptest.NewRecorder()}},
			Collection:   users,
			OAuth2User:   &pbauth.AuthUser{Id: "sub-new", Name: "Alice A", Username: "alice", AvatarURL: "https://t.me/i/userpic/320/a.svg", RawUser: map[string]any{"id": id}},
			IsNewRecord:  true,
		}
		err := app.OnRecordAuthWithOAuth2Request().Trigger(e, func(*core.RecordAuthWithOAuth2RequestEvent) error { return nil })
		return e, err
	}

	link := func(sub string) {
		l := core.NewExternalAuth(app)
		l.SetCollectionRef(users.Id)
		l.SetRecordRef(alice.Id)
		l.SetProvider(auth.ProviderName)
		l.SetProviderId(sub)
		if err := app.Save(l); err != nil {
			t.Fatal(err)
		}
	}
	link("sub-old")

	e, err := login(float64(600000001))
	if err != nil {
		t.Fatalf("known user must log in: %v", err)
	}
	if e.Record == nil || e.Record.Id != alice.Id || e.IsNewRecord {
		t.Fatalf("the hook must preselect the existing record, got %+v", e.Record)
	}
	saved, _ := app.FindRecordById("users", alice.Id)
	if saved.GetString("username") != "alice" || saved.GetString("avatar_url") == "" || saved.GetDateTime("last_login").IsZero() {
		t.Fatalf("profile must be refreshed on login: %v", saved.PublicExport())
	}
	if links, _ := app.FindAllExternalAuthsByRecord(alice); len(links) != 0 {
		t.Fatalf("the link of another bot must be dropped, got %d", len(links))
	}

	link("sub-new")
	if _, err := login(float64(600000001)); err != nil {
		t.Fatal(err)
	}
	if links, _ := app.FindAllExternalAuthsByRecord(alice); len(links) != 1 {
		t.Fatalf("the current link must stay, got %d", len(links))
	}

	for _, id := range []any{float64(600000002), float64(999999999), nil} {
		_, err := login(id)
		var apiErr *router.ApiError
		if !errors.As(err, &apiErr) || apiErr.Status != 403 {
			t.Fatalf("id %v must be refused with 403, got %v", id, err)
		}
	}
}
