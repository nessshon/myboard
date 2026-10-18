package users_test

import (
	"net/http"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestProjectOrderIsPersonal(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	admin := testutil.User(t, app, "450000001", "admin")
	alice := testutil.User(t, app, "450000002", "member")
	bob := testutil.User(t, app, "450000003", "member")
	h := testutil.Handler(t, app)
	asAdmin, asAlice, asBob := testutil.Token(t, admin), testutil.Token(t, alice), testutil.Token(t, bob)
	me := func(u string) string { return "/api/collections/users/records/" + u }

	cases := []struct {
		name, token, method, url, body string
		status                         int
	}{
		{"a member sets their own order", asAlice, http.MethodPatch, me(alice.Id), `{"project_order":["p1","p2"]}`, 200},
		{"a member cannot change their own role", asAlice, http.MethodPatch, me(alice.Id), `{"role":"admin"}`, 400},
		{"a member cannot change their own name", asAlice, http.MethodPatch, me(alice.Id), `{"name":"x"}`, 400},
		{"a member cannot change someone else's order", asBob, http.MethodPatch, me(alice.Id), `{"project_order":[]}`, 404},
		{"an admin cannot change someone else's order", asAdmin, http.MethodPatch, me(alice.Id), `{"project_order":[]}`, 400},
		{"an admin still changes a role", asAdmin, http.MethodPatch, me(bob.Id), `{"role":"admin"}`, 200},
		{"an admin sets their own order", asAdmin, http.MethodPatch, me(admin.Id), `{"project_order":["p1"]}`, 200},
		{"a member turns a notification off", asAlice, http.MethodPatch, me(alice.Id), `{"notify_off":["status"],"lang":"en"}`, 200},
		{"an admin cannot change someone else's notifications", asAdmin, http.MethodPatch, me(alice.Id), `{"notify_off":[]}`, 400},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, c.token, c.method, c.url, c.body); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}

	if _, body := testutil.Do(t, h, asAlice, http.MethodGet, me(alice.Id), ""); body["project_order"] == nil {
		t.Errorf("one sees one's own order: %v", body)
	}
	alice.Set("bot_blocked", true)
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}
	testutil.Do(t, h, asAlice, http.MethodPatch, me(alice.Id), `{"bot_blocked":false}`)
	if fresh, err := app.FindRecordById("users", alice.Id); err != nil || !fresh.GetBool("bot_blocked") {
		t.Errorf("a member cleared the bot mark (%v)", err)
	}

	for _, key := range []string{"project_order", "notify_off", "bot_blocked", "lang"} {
		if _, body := testutil.Do(t, h, asBob, http.MethodGet, me(alice.Id), ""); body[key] != nil {
			t.Errorf("others must not see %s: %v", key, body)
		}
	}
}
