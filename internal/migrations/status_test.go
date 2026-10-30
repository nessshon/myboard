package migrations_test

import (
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestReviewReplacesCancelled(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "230000005", "member")
	p := testutil.Project(t, app, "REV", alice)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t", "status": "review"})
	status := func() string {
		r, err := app.FindRecordById("tasks", task.Id)
		if err != nil {
			t.Fatal(err)
		}
		return r.GetString("status")
	}

	items := core.AppMigrations.Items()
	back := 0
	for i, m := range items {
		if m.File == "1793318400_task_review.go" {
			back = len(items) - i
		}
	}
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := runner.Down(back); err != nil {
		t.Fatal(err)
	}
	if got := status(); got != "in_progress" {
		t.Fatalf("rolled back, a task in review is %q, want in_progress", got)
	}
	if _, err := app.DB().Update("tasks", dbx.Params{"status": "cancelled"}, dbx.HashExp{"id": task.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	if got := status(); got != "done" {
		t.Fatalf("a cancelled task becomes %q, want done", got)
	}
}
