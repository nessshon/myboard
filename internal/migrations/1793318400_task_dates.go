package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Set by the server on a status change (internal/tasks); tasks closed before this stay without dates.
func init() {
	m.Register(func(app core.App) error {
		tasks, err := app.FindCollectionByNameOrId("tasks")
		if err != nil {
			return err
		}
		tasks.Fields.Add(
			&core.DateField{Name: "started"},
			&core.DateField{Name: "closed"},
		)
		return app.Save(tasks)
	}, func(app core.App) error {
		tasks, err := app.FindCollectionByNameOrId("tasks")
		if err != nil {
			return err
		}
		tasks.Fields.RemoveByName("started")
		tasks.Fields.RemoveByName("closed")
		return app.Save(tasks)
	})
}
