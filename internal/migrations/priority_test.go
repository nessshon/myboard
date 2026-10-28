package migrations_test

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestLowPriorityRollsBackToNormal(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	p := testutil.Project(t, app, "LOW")
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t", "priority": "low"})

	items := core.AppMigrations.Items()
	back := 0
	for i, m := range items {
		if m.File == "1793404800_low_priority.go" {
			back = len(items) - i
		}
	}
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := runner.Down(back); err != nil {
		t.Fatal(err)
	}
	old, err := app.FindRecordById("tasks", task.Id)
	if err != nil || old.GetString("priority") != "normal" {
		t.Fatalf("after the rollback: %v %v", old, err)
	}
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
}
