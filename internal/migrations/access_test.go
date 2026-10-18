package migrations_test

import (
	"net/http"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestAccessRules(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	admin := testutil.User(t, app, "200000001", "admin")
	alice := testutil.User(t, app, "200000002", "member")
	bob := testutil.User(t, app, "200000003", "member")
	projA := testutil.Project(t, app, "AAA", alice)
	projB := testutil.Project(t, app, "BBB", bob)
	labelB := testutil.Record(t, app, "labels", map[string]any{"project": projB.Id, "name": "ui", "color": "#3b82f6"})
	taskB := testutil.Record(t, app, "tasks", map[string]any{"project": projB.Id, "title": "secret task"})
	noteB := testutil.Record(t, app, "notes", map[string]any{"project": projB.Id, "title": "secret note"})
	testutil.Record(t, app, "tasks", map[string]any{"project": projA.Id, "title": "alice task"})
	bobToken := testutil.Record(t, app, "api_tokens", map[string]any{"user": bob.Id, "name": "bob", "hash": "h"})

	h := testutil.Handler(t, app)
	asAlice, asAdmin := testutil.Token(t, alice), testutil.Token(t, admin)

	cases := []struct {
		name, token, method, url, body string
		status                         int
		total                          float64
	}{
		{"member lists only own projects", asAlice, http.MethodGet, "/api/collections/projects/records", "", 200, 1},
		{"member lists only own tasks", asAlice, http.MethodGet, "/api/collections/tasks/records", "", 200, 1},
		{"member sees no foreign notes", asAlice, http.MethodGet, "/api/collections/notes/records", "", 200, 0},
		{"member sees no foreign labels", asAlice, http.MethodGet, "/api/collections/labels/records", "", 200, 0},
		{"member cannot open a foreign task", asAlice, http.MethodGet, "/api/collections/tasks/records/" + taskB.Id, "", 404, -1},
		{"member cannot change a foreign note", asAlice, http.MethodPatch, "/api/collections/notes/records/" + noteB.Id, `{"title":"x"}`, 404, -1},
		{"member cannot delete a foreign label", asAlice, http.MethodDelete, "/api/collections/labels/records/" + labelB.Id, "", 404, -1},
		{"member cannot add a task to a foreign project", asAlice, http.MethodPost, "/api/collections/tasks/records", `{"project":"` + projB.Id + `","title":"x"}`, 400, -1},
		{"member cannot create a project", asAlice, http.MethodPost, "/api/collections/projects/records", `{"name":"x","key":"XYZ"}`, 400, -1},
		{"member cannot rename own project", asAlice, http.MethodPatch, "/api/collections/projects/records/" + projA.Id, `{"name":"x"}`, 404, -1},
		{"member cannot delete own project", asAlice, http.MethodDelete, "/api/collections/projects/records/" + projA.Id, "", 404, -1},
		{"member cannot change users", asAlice, http.MethodPatch, "/api/collections/users/records/" + bob.Id, `{"role":"admin"}`, 404, -1},
		{"member does not see others' api tokens", asAlice, http.MethodGet, "/api/collections/api_tokens/records/" + bobToken.Id, "", 404, -1},
		{"anonymous sees nothing", "", http.MethodGet, "/api/collections/projects/records", "", 200, 0},
		{"admin lists every project", asAdmin, http.MethodGet, "/api/collections/projects/records", "", 200, 2},
		{"admin sees every task", asAdmin, http.MethodGet, "/api/collections/tasks/records", "", 200, 2},
		{"admin creates a project", asAdmin, http.MethodPost, "/api/collections/projects/records", `{"name":"New","key":"NEW"}`, 200, -1},
		{"project key must be uppercase", asAdmin, http.MethodPost, "/api/collections/projects/records", `{"name":"x","key":"low"}`, 400, -1},
		{"project colour must be a hex value", asAdmin, http.MethodPost, "/api/collections/projects/records", `{"name":"x","key":"COL","color":"red"}`, 400, -1},
		{"admin sets a project colour", asAdmin, http.MethodPatch, "/api/collections/projects/records/" + projA.Id, `{"color":"#0f7a5f"}`, 200, -1},
		{"admin deletes a project", asAdmin, http.MethodDelete, "/api/collections/projects/records/" + projB.Id, "", 204, -1},
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

	for _, collection := range []string{"tasks", "notes", "labels"} {
		left, err := app.CountRecords(collection, nil)
		if err != nil {
			t.Fatal(err)
		}
		if collection == "tasks" && left != 1 || collection != "tasks" && left != 0 {
			t.Errorf("after deleting BBB: %d %s left", left, collection)
		}
	}
}
