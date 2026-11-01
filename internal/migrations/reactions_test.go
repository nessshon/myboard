package migrations_test

import (
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

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
		{"a later emoji is taken", asAlice, http.MethodPost, records, `{"comment":"` + comment.Id + `","emoji":"thinking"}`, 200},
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

func TestTaskReactionRules(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "230000011", "member")
	bob := testutil.User(t, app, "230000012", "member")
	stranger := testutil.User(t, app, "230000013", "member")
	admin := testutil.User(t, app, "230000014", "admin")
	p := testutil.Project(t, app, "TRC", alice, bob)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t"})
	other := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "u"})
	comment := testutil.Record(t, app, "comments", map[string]any{"task": task.Id, "body": "hi", "author": alice.Id})
	h := testutil.Handler(t, app)
	asAlice, asBob, asStranger, asAdmin := testutil.Token(t, alice), testutil.Token(t, bob), testutil.Token(t, stranger), testutil.Token(t, admin)
	records := "/api/collections/reactions/records"
	thumbs := `{"task":"` + task.Id + `","emoji":"+1"}`

	status, made := testutil.Do(t, h, asBob, http.MethodPost, records, thumbs)
	if status != 200 || made["author"] != bob.Id || made["comment"] != "" {
		t.Fatalf("a member reacts to the task: %d %v", status, made)
	}
	one := records + "/" + made["id"].(string)

	cases := []struct {
		name, token, method, url, body string
		status                         int
	}{
		{"a stranger cannot see it", asStranger, http.MethodGet, one, "", 404},
		{"a stranger cannot react", asStranger, http.MethodPost, records, thumbs, 400},
		{"the same reaction twice is refused", asBob, http.MethodPost, records, thumbs, 400},
		{"the same on another task is taken", asBob, http.MethodPost, records, `{"task":"` + other.Id + `","emoji":"+1"}`, 200},
		{"the same on a comment is taken", asBob, http.MethodPost, records, `{"comment":"` + comment.Id + `","emoji":"+1"}`, 200},
		{"a task and a comment at once are refused", asAlice, http.MethodPost, records, `{"task":"` + task.Id + `","comment":"` + comment.Id + `","emoji":"heart"}`, 400},
		{"neither is refused, even to an admin", asAdmin, http.MethodPost, records, `{"emoji":"heart"}`, 400},
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
	if left, err := app.CountRecords("reactions", dbx.HashExp{"task": task.Id}); err != nil || left != 0 {
		t.Fatalf("deleting the task leaves %d of its reactions (%v)", left, err)
	}
}

func TestTaskReactionsRollBack(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "230000021", "member")
	p := testutil.Project(t, app, "TRB", alice)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t"})
	comment := testutil.Record(t, app, "comments", map[string]any{"task": task.Id, "body": "hi", "author": alice.Id})
	onComment := testutil.Record(t, app, "reactions", map[string]any{"comment": comment.Id, "author": alice.Id, "emoji": "+1"})
	testutil.Record(t, app, "reactions", map[string]any{"task": task.Id, "author": alice.Id, "emoji": "+1"})

	items := core.AppMigrations.Items()
	back := 0
	for i, m := range items {
		if m.File == "1793664000_task_reactions.go" {
			back = len(items) - i
		}
	}
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := runner.Down(back); err != nil {
		t.Fatal(err)
	}
	if left, err := app.CountRecords("reactions"); err != nil || left != 1 {
		t.Fatalf("after the rollback %d reactions are left, want the comment's one (%v)", left, err)
	}
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("reactions", onComment.Id); err != nil {
		t.Fatalf("the comment's reaction is lost: %v", err)
	}
}
