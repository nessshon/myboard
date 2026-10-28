package migrations_test

import (
	"net/http"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestReactionRules(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "230000001", "member")
	bob := testutil.User(t, app, "230000002", "member")
	stranger := testutil.User(t, app, "230000003", "member")
	p := testutil.Project(t, app, "RCT", alice, bob)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t"})
	comment := testutil.Record(t, app, "comments", map[string]any{"task": task.Id, "body": "hi", "author": alice.Id})
	h := testutil.Handler(t, app)
	asAlice, asBob, asStranger := testutil.Token(t, alice), testutil.Token(t, bob), testutil.Token(t, stranger)
	records := "/api/collections/reactions/records"
	thumbs := `{"comment":"` + comment.Id + `","emoji":"+1"}`

	status, made := testutil.Do(t, h, asBob, http.MethodPost, records, `{"comment":"`+comment.Id+`","emoji":"+1","author":"`+alice.Id+`"}`)
	if status != 200 || made["author"] != bob.Id {
		t.Fatalf("a member reacts and the server sets the author: %d %v", status, made)
	}
	one := records + "/" + made["id"].(string)

	cases := []struct {
		name, token, method, url, body string
		status                         int
	}{
		{"a stranger cannot see it", asStranger, http.MethodGet, one, "", 404},
		{"a stranger cannot react", asStranger, http.MethodPost, records, thumbs, 400},
		{"the same reaction twice is refused", asBob, http.MethodPost, records, thumbs, 400},
		{"an unknown emoji is refused", asAlice, http.MethodPost, records, `{"comment":"` + comment.Id + `","emoji":"poop"}`, 400},
		{"another member reacts the same way", asAlice, http.MethodPost, records, thumbs, 200},
		{"nobody changes a reaction", asBob, http.MethodPatch, one, `{"emoji":"heart"}`, 403},
		{"another member cannot take it off", asAlice, http.MethodDelete, one, "", 404},
		{"the author takes it off", asBob, http.MethodDelete, one, "", 204},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, c.token, c.method, c.url, c.body); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}

	if err := app.Delete(task); err != nil {
		t.Fatal(err)
	}
	if left, err := app.CountRecords("reactions", nil); err != nil || left != 0 {
		t.Fatalf("deleting the task leaves %d reactions (%v)", left, err)
	}
}
