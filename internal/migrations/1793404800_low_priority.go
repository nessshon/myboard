package migrations

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A rollback lifts low tasks to normal first: their next save would refuse a value the field no longer has.
func init() {
	m.Register(func(app core.App) error {
		return setPriorities(app, []string{"low", "normal", "high", "urgent"})
	}, func(app core.App) error {
		if _, err := app.DB().Update("tasks", dbx.Params{"priority": "normal"}, dbx.HashExp{"priority": "low"}).Execute(); err != nil {
			return fmt.Errorf("lift low tasks to normal: %w", err)
		}
		return setPriorities(app, []string{"normal", "high", "urgent"})
	})
}

func setPriorities(app core.App, values []string) error {
	tasks, err := app.FindCollectionByNameOrId("tasks")
	if err != nil {
		return err
	}
	field, ok := tasks.Fields.GetByName("priority").(*core.SelectField)
	if !ok {
		return fmt.Errorf("tasks has no select field %q", "priority")
	}
	field.Values = values
	return app.Save(tasks)
}
