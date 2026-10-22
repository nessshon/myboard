package migrations_test

import (
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestAssigneeBecomesList(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	bob := testutil.User(t, app, "210000001", "member")
	p := testutil.Project(t, app, "ASG", bob)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t", "assignees": []string{bob.Id}})

	items := core.AppMigrations.Items()
	back := 0
	for i, m := range items {
		if m.File == "1792627200_task_assignees.go" {
			back = len(items) - i
		}
	}
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := runner.Down(back); err != nil {
		t.Fatal(err)
	}
	old, err := app.FindRecordById("tasks", task.Id)
	if err != nil || old.GetString("assignee") != bob.Id {
		t.Fatalf("before the change: %v %v", old, err)
	}
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	now, err := app.FindRecordById("tasks", task.Id)
	if err != nil || !slices.Equal(now.GetStringSlice("assignees"), []string{bob.Id}) {
		t.Fatalf("after the change: %v %v", now, err)
	}
}
