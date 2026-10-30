package tasks

import (
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"slices"

	"github.com/pocketbase/dbx"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/list"
	"github.com/pocketbase/pocketbase/tools/types"
)

var editedFields = map[string][]string{
	"tasks": {"title", "description", "status", "priority", "labels", "assignees", "due"},
	"notes": {"title", "body", "shared"},
}

const positionStep = 1024

func Register(app core.App) {
	app.OnRecordCreate("tasks").BindFunc(func(e *core.RecordEvent) error {
		r := e.Record
		if r.GetString("status") == "" {
			r.Set("status", "todo")
		}
		if r.GetString("priority") == "" {
			r.Set("priority", "normal")
		}

		top, err := edgePosition(e.App, "MIN", "tasks", r.GetString("project"), r.GetString("status"))
		if err != nil {
			return fmt.Errorf("find the top of the column: %w", err)
		}
		r.Set("position", top-positionStep)
		stampStatus(r, "")
		return e.Next()
	})

	app.OnRecordUpdate("tasks").BindFunc(func(e *core.RecordEvent) error {
		stampStatus(e.Record, e.Record.Original().GetString("status"))
		return e.Next()
	})

	app.OnRecordCreateExecute("tasks").BindFunc(func(e *core.RecordEvent) error {
		// One UPDATE … RETURNING is atomic in SQLite, so concurrent creates never share a number.
		var seq int
		err := e.App.DB().
			NewQuery("UPDATE projects SET seq = seq + 1 WHERE id = {:id} RETURNING seq").
			Bind(dbx.Params{"id": e.Record.GetString("project")}).
			Row(&seq)
		if errors.Is(err, sql.ErrNoRows) {
			return validation.Errors{"project": validation.NewError("validation_invalid_project", "Unknown project.")}
		}
		if err != nil {
			return fmt.Errorf("take the next task number: %w", err)
		}
		e.Record.Set("number", seq)
		return e.Next()
	})

	app.OnRecordCreate("notes").BindFunc(func(e *core.RecordEvent) error {
		last, err := edgePosition(e.App, "MAX", "notes", e.Record.GetString("project"), "")
		if err != nil {
			return fmt.Errorf("find the end of the notes: %w", err)
		}
		e.Record.Set("position", last+positionStep)
		return e.Next()
	})

	app.OnRecordCreateRequest("tasks", "notes", "comments", "reactions", "attachments").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("author", "")
		if e.Auth != nil && e.Auth.Collection().Name == "users" {
			e.Record.Set("author", e.Auth.Id)
		}
		return e.Next()
	})

	app.OnRecordCreateRequest("tasks", "notes").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("edited", "")
		return e.Next()
	})

	app.OnRecordCreateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("started", "")
		e.Record.Set("submitted", "")
		e.Record.Set("closed", "")
		return e.Next()
	})

	app.OnRecordUpdateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		e.Record.Set("started", original.Get("started"))
		e.Record.Set("submitted", original.Get("submitted"))
		e.Record.Set("closed", original.Get("closed"))
		return e.Next()
	})

	// The request's values are already on the record here (apis/record_crud.go loads the form before this
	// hook), so they compare with the stored ones. Labels dropped by deleting a label come without a
	// request, so they leave edited alone.
	app.OnRecordUpdateRequest("tasks", "notes").BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		e.Record.Set("edited", original.Get("edited"))
		for _, f := range editedFields[e.Collection.Name] {
			if !reflect.DeepEqual(e.Record.Get(f), original.Get(f)) {
				e.Record.Set("edited", types.NowDateTime())
				break
			}
		}
		return e.Next()
	})

	app.OnRecordValidate("tasks").BindFunc(func(e *core.RecordEvent) error {
		if err := validateTask(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})

	registerAttachments(app)
}

// Each date is when the task last entered that state; moving back clears it (docs/plan-task-dates.md).
func stampStatus(task *core.Record, was string) {
	status := task.GetString("status")
	if status == was {
		return
	}
	switch status {
	case "in_progress":
		task.Set("started", types.NowDateTime())
		task.Set("submitted", "")
		task.Set("closed", "")
	case "review":
		task.Set("submitted", types.NowDateTime())
		task.Set("closed", "")
	case "done":
		task.Set("closed", types.NowDateTime())
	default:
		task.Set("started", "")
		task.Set("submitted", "")
		task.Set("closed", "")
	}
}

func validateTask(app core.App, task *core.Record) error {
	original := task.Original()
	if !task.IsNew() {
		if task.GetString("project") != original.GetString("project") {
			return validation.Errors{"project": validation.NewError("validation_immutable", "A task cannot move to another project.")}
		}
		if task.GetInt("number") != original.GetInt("number") {
			return validation.Errors{"number": validation.NewError("validation_immutable", "The task number is assigned by the server.")}
		}
	}

	project, err := app.FindRecordById("projects", task.GetString("project"))
	if err != nil {
		return validation.Errors{"project": validation.NewError("validation_invalid_project", "Unknown project.")}
	}

	// Only newly added people are checked: a task stays editable after one of its assignees leaves the project.
	var kept []string
	if !task.IsNew() {
		kept = original.GetStringSlice("assignees")
	}
	for _, id := range task.GetStringSlice("assignees") {
		if !slices.Contains(kept, id) && !slices.Contains(project.GetStringSlice("members"), id) {
			return validation.Errors{"assignees": validation.NewError("assignee_not_member", "Every assignee must be a member of the project.")}
		}
	}

	if labels := task.GetStringSlice("labels"); len(labels) > 0 && (task.IsNew() || !slices.Equal(labels, original.GetStringSlice("labels"))) {
		var inProject int
		err := app.DB().
			Select("COUNT(*)").
			From("labels").
			Where(dbx.In("id", list.ToInterfaceSlice(labels)...)).
			AndWhere(dbx.HashExp{"project": project.Id}).
			Row(&inProject)
		if err != nil {
			return fmt.Errorf("count the task's labels: %w", err)
		}
		if inProject != len(labels) {
			return validation.Errors{"labels": validation.NewError("label_not_in_project", "Labels must belong to the task's project.")}
		}
	}

	return nil
}

func edgePosition(app core.App, fn, table, project, status string) (float64, error) {
	where := dbx.HashExp{"project": project}
	if status != "" {
		where["status"] = status
	}
	var edge sql.NullFloat64
	err := app.DB().Select(fn + "(position)").From(table).Where(where).Row(&edge)
	return edge.Float64, err
}
