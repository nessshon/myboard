package migrations_test

import (
	"net/http"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestMemberManagesLabels(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "200000002", "member")
	stranger := testutil.User(t, app, "200000003", "member")
	proj := testutil.Project(t, app, "AAA", alice)
	other := testutil.Project(t, app, "AAB", stranger)
	keep := testutil.Record(t, app, "labels", map[string]any{"project": proj.Id, "name": "keep", "color": "#3b5bdb"})
	gone := testutil.Record(t, app, "labels", map[string]any{"project": proj.Id, "name": "gone", "color": "#0f7a5f"})
	task := testutil.Record(t, app, "tasks", map[string]any{"project": proj.Id, "title": "t", "labels": []string{keep.Id, gone.Id}})

	h := testutil.Handler(t, app)
	label := func(id string) string { return "/api/collections/labels/records/" + id }

	if status, _ := testutil.Do(t, h, testutil.Token(t, stranger), http.MethodDelete, label(gone.Id), ""); status != 404 {
		t.Fatalf("an outsider deletes a label: %d, want 404", status)
	}
	if status, body := testutil.Do(t, h, testutil.Token(t, alice), http.MethodPatch, label(keep.Id), `{"project":"`+other.Id+`"}`); status != 404 {
		t.Fatalf("member moves a label to another project: %d, want 404 (%v)", status, body)
	}
	if status, body := testutil.Do(t, h, testutil.Token(t, alice), http.MethodPatch, label(keep.Id), `{"name":"kept","color":"#c42b2b"}`); status != 200 || body["name"] != "kept" || body["project"] != proj.Id {
		t.Fatalf("member renames a label: %d %v", status, body)
	}
	if status, body := testutil.Do(t, h, testutil.Token(t, alice), http.MethodDelete, label(gone.Id), ""); status != 204 {
		t.Fatalf("member deletes a label: %d %v", status, body)
	}

	fresh, err := app.FindRecordById("tasks", task.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := fresh.GetStringSlice("labels"); len(got) != 1 || got[0] != keep.Id {
		t.Fatalf("task labels after delete: %v, want only %s", got, keep.Id)
	}
}
