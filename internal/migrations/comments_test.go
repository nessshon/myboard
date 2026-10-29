package migrations_test

import (
	"net/http"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestCommentRules(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	admin := testutil.User(t, app, "220000001", "admin")
	alice := testutil.User(t, app, "220000002", "member")
	bob := testutil.User(t, app, "220000003", "member")
	stranger := testutil.User(t, app, "220000004", "member")
	p := testutil.Project(t, app, "CMR", alice, bob)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t"})
	other := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "u"})
	h := testutil.Handler(t, app)
	asAlice, asBob, asStranger, asAdmin := testutil.Token(t, alice), testutil.Token(t, bob), testutil.Token(t, stranger), testutil.Token(t, admin)
	records := "/api/collections/comments/records"

	status, made := testutil.Do(t, h, asAlice, http.MethodPost, records, `{"task":"`+task.Id+`","body":"hi","author":"`+bob.Id+`"}`)
	if status != 200 || made["author"] != alice.Id {
		t.Fatalf("a member comments and the server sets the author: %d %v", status, made)
	}
	one := records + "/" + made["id"].(string)

	cases := []struct {
		name, token, method, url, body string
		status                         int
	}{
		{"a stranger cannot read it", asStranger, http.MethodGet, one, "", 404},
		{"a stranger cannot comment", asStranger, http.MethodPost, records, `{"task":"` + task.Id + `","body":"x"}`, 400},
		{"a comment without text is fine: its files follow", asBob, http.MethodPost, records, `{"task":"` + task.Id + `","body":""}`, 200},
		{"a comment of spaces is refused", asBob, http.MethodPost, records, `{"task":"` + task.Id + `","body":" \n "}`, 400},
		{"another member cannot edit it", asBob, http.MethodPatch, one, `{"body":"x"}`, 404},
		{"another member cannot delete it", asBob, http.MethodDelete, one, "", 404},
		{"the author cannot move it to another task", asAlice, http.MethodPatch, one, `{"task":"` + other.Id + `"}`, 404},
		{"the author cannot hand it to someone else", asAlice, http.MethodPatch, one, `{"author":"` + bob.Id + `"}`, 404},
		{"the author edits it", asAlice, http.MethodPatch, one, `{"body":"hello"}`, 200},
		{"an admin deletes it", asAdmin, http.MethodDelete, one, "", 204},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, c.token, c.method, c.url, c.body); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}

	testutil.Record(t, app, "comments", map[string]any{"task": task.Id, "body": "stays until the task goes", "author": bob.Id})
	if err := app.Delete(task); err != nil {
		t.Fatal(err)
	}
	if left, err := app.CountRecords("comments", nil); err != nil || left != 0 {
		t.Fatalf("deleting the task leaves %d comments (%v)", left, err)
	}
}
