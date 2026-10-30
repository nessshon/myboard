package migrations

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// The review status before done, with reviewers next to assignees, and a date for every column but the backlog, which
// has the creation date. The dates are set by the server on a status change (internal/tasks); tasks moved before this
// stay without dates. The first schema (init) had a "cancelled" status; such a task now counts as done.
func init() {
	m.Register(func(app core.App) error {
		if _, err := app.DB().Update("tasks", dbx.Params{"status": "done"}, dbx.HashExp{"status": "cancelled"}).Execute(); err != nil {
			return fmt.Errorf("close the cancelled tasks: %w", err)
		}
		tasks, err := setStatuses(app, []string{"backlog", "todo", "in_progress", "review", "done"})
		if err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		tasks.Fields.Add(
			&core.RelationField{Name: "reviewers", CollectionId: users.Id, MaxSelect: 10},
			&core.DateField{Name: "planned"},
			&core.DateField{Name: "started"},
			&core.DateField{Name: "submitted"},
			&core.DateField{Name: "closed"},
		)
		return app.Save(tasks)
	}, func(app core.App) error {
		if _, err := app.DB().Update("tasks", dbx.Params{"status": "in_progress"}, dbx.HashExp{"status": "review"}).Execute(); err != nil {
			return fmt.Errorf("take the tasks out of review: %w", err)
		}
		tasks, err := setStatuses(app, []string{"backlog", "todo", "in_progress", "done", "cancelled"})
		if err != nil {
			return err
		}
		tasks.Fields.RemoveByName("reviewers")
		tasks.Fields.RemoveByName("planned")
		tasks.Fields.RemoveByName("started")
		tasks.Fields.RemoveByName("submitted")
		tasks.Fields.RemoveByName("closed")
		return app.Save(tasks)
	})
}

func setStatuses(app core.App, values []string) (*core.Collection, error) {
	tasks, err := app.FindCollectionByNameOrId("tasks")
	if err != nil {
		return nil, err
	}
	field, ok := tasks.Fields.GetByName("status").(*core.SelectField)
	if !ok {
		return nil, fmt.Errorf("tasks has no select field %q", "status")
	}
	field.Values = values
	return tasks, nil
}
