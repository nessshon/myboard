package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// PocketBase turns stored ids into one-element lists itself (core/collection_record_table_sync.go).
func init() {
	m.Register(func(app core.App) error {
		return assignees(app, "assignee", "assignees", 10, func(tasks *core.Collection) {
			tasks.RemoveIndex("idx_tasks_assignee")
		})
	}, func(app core.App) error {
		return assignees(app, "assignees", "assignee", 1, func(tasks *core.Collection) {
			tasks.AddIndex("idx_tasks_assignee", false, "`assignee`, `status`", "")
		})
	})
}

func assignees(app core.App, from, to string, maxSelect int, indexes func(*core.Collection)) error {
	tasks, err := app.FindCollectionByNameOrId("tasks")
	if err != nil {
		return err
	}
	field, ok := tasks.Fields.GetByName(from).(*core.RelationField)
	if !ok {
		return fmt.Errorf("tasks has no relation field %q", from)
	}
	field.Name = to
	field.MaxSelect = maxSelect
	indexes(tasks)
	return app.Save(tasks)
}
