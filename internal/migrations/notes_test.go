package migrations_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestNoteSharing(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	admin := testutil.User(t, app, "200000001", "admin")
	alice := testutil.User(t, app, "200000002", "member")
	bob := testutil.User(t, app, "200000003", "member")
	proj := testutil.Project(t, app, "AAA", alice, bob)
	mine := testutil.Record(t, app, "notes", map[string]any{"project": proj.Id, "title": "alice only", "author": alice.Id})
	shared := testutil.Record(t, app, "notes", map[string]any{"project": proj.Id, "title": "for all", "author": alice.Id, "shared": true})
	other := testutil.Record(t, app, "notes", map[string]any{"project": proj.Id, "title": "also for all", "author": alice.Id, "shared": true})
	task := testutil.Record(t, app, "tasks", map[string]any{"project": proj.Id, "title": "t", "author": alice.Id})

	h := testutil.Handler(t, app)
	asAlice, asBob, asAdmin := testutil.Token(t, alice), testutil.Token(t, bob), testutil.Token(t, admin)
	note := func(id string) string { return "/api/collections/notes/records/" + id }

	cases := []struct {
		name, token, method, url, body string
		status                         int
		total                          float64
	}{
		{"author lists own personal and shared notes", asAlice, http.MethodGet, "/api/collections/notes/records", "", 200, 3},
		{"member lists only shared notes", asBob, http.MethodGet, "/api/collections/notes/records", "", 200, 2},
		{"admin does not see personal notes either", asAdmin, http.MethodGet, "/api/collections/notes/records", "", 200, 2},
		{"member cannot open a personal note", asBob, http.MethodGet, note(mine.Id), "", 404, -1},
		{"member cannot change a personal note", asBob, http.MethodPatch, note(mine.Id), `{"title":"x"}`, 404, -1},
		{"member edits a shared note", asBob, http.MethodPatch, note(shared.Id), `{"title":"edited by bob"}`, 200, -1},
		{"member cannot make a shared note personal", asBob, http.MethodPatch, note(shared.Id), `{"shared":false}`, 404, -1},
		{"member cannot take over a shared note", asBob, http.MethodPatch, note(shared.Id), `{"author":"` + bob.Id + `"}`, 404, -1},
		{"member cannot delete a shared note", asBob, http.MethodDelete, note(shared.Id), "", 404, -1},
		{"admin cannot delete a personal note", asAdmin, http.MethodDelete, note(mine.Id), "", 404, -1},
		{"admin makes a shared note personal", asAdmin, http.MethodPatch, note(other.Id), `{"shared":false}`, 200, -1},
		{"author shares a personal note", asAlice, http.MethodPatch, note(mine.Id), `{"shared":true}`, 200, -1},
		{"admin deletes a shared note", asAdmin, http.MethodDelete, note(shared.Id), "", 204, -1},
		{"member cannot rewrite a task's author", asBob, http.MethodPatch, "/api/collections/tasks/records/" + task.Id, `{"author":"` + bob.Id + `"}`, 404, -1},
		{"task title is limited to 200", asBob, http.MethodPatch, "/api/collections/tasks/records/" + task.Id, `{"title":"` + strings.Repeat("a", 201) + `"}`, 400, -1},
	}
	for _, c := range cases {
		status, body := testutil.Do(t, h, c.token, c.method, c.url, c.body)
		if status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
			continue
		}
		if c.total >= 0 && body["totalItems"] != c.total {
			t.Errorf("%s: totalItems %v, want %v", c.name, body["totalItems"], c.total)
		}
	}

	if status, _ := testutil.Do(t, h, asBob, http.MethodGet, note(other.Id), ""); status != 404 {
		t.Errorf("unshared note: member gets %d, want 404", status)
	}
	if status, _ := testutil.Do(t, h, asAlice, http.MethodGet, note(other.Id), ""); status != 200 {
		t.Errorf("unshared note: author gets %d, want 200", status)
	}
}
