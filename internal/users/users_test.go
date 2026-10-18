package users_test

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestUsers(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	owner := testutil.User(t, app, testutil.OwnerTgID, "admin")
	admin := testutil.User(t, app, "400000001", "admin")
	member := testutil.User(t, app, "400000002", "member")
	p := testutil.Project(t, app, "USR", member, admin)
	testutil.Record(t, app, "api_tokens", map[string]any{"user": member.Id, "name": "t", "hash": "member-hash"})
	h := testutil.Handler(t, app)
	asAdmin, asMember := testutil.Token(t, admin), testutil.Token(t, member)

	cases := []struct {
		name, token, method, url, body string
		status                         int
	}{
		{"me needs a signed-in user", "", http.MethodGet, "/api/myboard/me", "", 401},
		{"me answers for the caller", asMember, http.MethodGet, "/api/myboard/me", "", 200},
		{"member cannot add users", asMember, http.MethodPost, "/api/myboard/users", `{"tg_id":"400000009"}`, 403},
		{"member cannot remove users", asMember, http.MethodPost, "/api/myboard/users/" + admin.Id + "/remove", "", 403},
		{"tg_id must be numeric", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"@nick"}`, 400},
		{"tg_id has no leading zero", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"0123456"}`, 400},
		{"tg_id has at most 16 digits", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"12345678901234567"}`, 400},
		{"an old one-digit tg_id", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"7"}`, 200},
		{"a 16-digit tg_id", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"4503599627370495"}`, 200},
		{"unknown role", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"400000008","role":"superadmin"}`, 400},
		{"admin adds a user by tg_id", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"400000009"}`, 200},
		{"the same tg_id twice", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"400000009"}`, 409},
		{"admin changes a role", asAdmin, http.MethodPatch, "/api/collections/users/records/" + member.Id, `{"role":"admin"}`, 200},
		{"admin cannot edit the profile", asAdmin, http.MethodPatch, "/api/collections/users/records/" + member.Id, `{"name":"x"}`, 400},
		{"admin cannot change own role", asAdmin, http.MethodPatch, "/api/collections/users/records/" + admin.Id, `{"role":"member"}`, 400},
		{"nobody changes the owner's role", asAdmin, http.MethodPatch, "/api/collections/users/records/" + owner.Id, `{"role":"member"}`, 400},
		{"the owner cannot be removed", asAdmin, http.MethodPost, "/api/myboard/users/" + owner.Id + "/remove", "", 400},
		{"admin cannot remove themselves", asAdmin, http.MethodPost, "/api/myboard/users/" + admin.Id + "/remove", "", 400},
		{"removing an unknown id", asAdmin, http.MethodPost, "/api/myboard/users/nosuchuser0000/remove", "", 404},
		{"admin removes a member", asAdmin, http.MethodPost, "/api/myboard/users/" + member.Id + "/remove", "", 204},
		{"the removed user's session stops working", asMember, http.MethodPost, "/api/collections/users/auth-refresh", "", 401},
		{"a removed user cannot rejoin a project", asAdmin, http.MethodPatch, "/api/collections/projects/records/" + p.Id, `{"members":["` + admin.Id + `","` + member.Id + `"]}`, 400},
		{"a removed user's role is locked", asAdmin, http.MethodPatch, "/api/collections/users/records/" + member.Id, `{"role":"member"}`, 400},
		{"re-adding restores the same record", asAdmin, http.MethodPost, "/api/myboard/users", `{"tg_id":"400000002"}`, 200},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, c.token, c.method, c.url, c.body); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}

	restored, err := app.FindRecordById("users", member.Id)
	if err != nil {
		t.Fatalf("removed user must keep the same record: %v", err)
	}
	if restored.GetBool("deleted") || restored.GetString("role") != "member" {
		t.Errorf("restored user: deleted=%v role=%q", restored.GetBool("deleted"), restored.GetString("role"))
	}
	project, _ := app.FindRecordById("projects", p.Id)
	if len(project.GetStringSlice("members")) != 1 {
		t.Errorf("removed user must leave project members, got %v", project.GetStringSlice("members"))
	}
	if n, _ := app.CountRecords("api_tokens", nil); n != 0 {
		t.Errorf("removed user's api tokens must be deleted, %d left", n)
	}
}

func TestOthersSeeNoTelegramID(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	admin := testutil.User(t, app, "400000011", "admin")
	member := testutil.User(t, app, "400000012", "member")
	h := testutil.Handler(t, app)

	cases := []struct {
		name, token, id string
		visible         bool
	}{
		{"member sees another user", testutil.Token(t, member), admin.Id, false},
		{"member sees themselves", testutil.Token(t, member), member.Id, true},
		{"admin sees another user", testutil.Token(t, admin), member.Id, true},
	}
	for _, c := range cases {
		status, body := testutil.Do(t, h, c.token, http.MethodGet, "/api/collections/users/records/"+c.id, "")
		if status != 200 || body["name"] == nil {
			t.Fatalf("%s: %d %v", c.name, status, body)
		}
		_, tg := body["tg_id"]
		_, login := body["last_login"]
		if tg != c.visible || login != c.visible {
			t.Errorf("%s: tg_id shown %v, last_login shown %v, want %v", c.name, tg, login, c.visible)
		}
	}

	owner, err := app.FindFirstRecordByData("users", "tg_id", testutil.OwnerTgID)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		token string
		want  bool
	}{{testutil.Token(t, admin), true}, {testutil.Token(t, member), false}} {
		_, body := testutil.Do(t, h, c.token, http.MethodGet, "/api/collections/users/records/"+owner.Id, "")
		if got := body["owner"] == true; got != c.want {
			t.Errorf("owner mark shown %v, want %v", got, c.want)
		}
	}

	list := "/api/collections/users/records?filter=" + url.QueryEscape(`tg_id = "400000011"`)
	if status, body := testutil.Do(t, h, testutil.Token(t, member), http.MethodGet, list, ""); status != 400 {
		t.Errorf("member filters by tg_id: status %d, want 400 (%v)", status, body)
	}
}

// A leaked admin API token must not reach people management: it could add its owner's successor
// as an admin, and revoking the token would not undo that.
func TestPeopleAreManagedFromASessionOnly(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	admin := testutil.User(t, app, "410000001", "admin")
	member := testutil.User(t, app, "410000002", "member")
	h := testutil.Handler(t, app)

	status, created := testutil.Do(t, h, testutil.Token(t, admin), http.MethodPost, "/api/myboard/tokens", `{"name":"ci"}`)
	if status != 200 {
		t.Fatalf("create token: %d %v", status, created)
	}
	bearer := "Bearer " + created["token"].(string)

	cases := []struct {
		name, method, url, body string
		status                  int
	}{
		{"token cannot add a user", http.MethodPost, "/api/myboard/users", `{"tg_id":"410000009","role":"admin"}`, 403},
		{"token cannot remove a user", http.MethodPost, "/api/myboard/users/" + member.Id + "/remove", "", 403},
		{"token cannot change a role", http.MethodPatch, "/api/collections/users/records/" + member.Id, `{"role":"admin"}`, 403},
		{"token still reads people", http.MethodGet, "/api/collections/users/records", "", 200},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, bearer, c.method, c.url, c.body); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}
}
