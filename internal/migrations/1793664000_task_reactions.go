package migrations

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// A reaction is on a comment or on the task itself, one of the two; those on comments keep their shape, so scripts
// that react to a comment go on as before. A rollback drops the task's own reactions: they have nowhere to be.
func init() {
	m.Register(func(app core.App) error {
		tasks, err := app.FindCollectionByNameOrId("tasks")
		if err != nil {
			return err
		}
		reactions, err := setReactionComment(app, false)
		if err != nil {
			return err
		}
		reactions.Fields.Add(&core.RelationField{Name: "task", CollectionId: tasks.Id, MaxSelect: 1, CascadeDelete: true})
		visible := `comment.task.project.members.id ?= @request.auth.id || task.project.members.id ?= @request.auth.id || ` + ruleAdmin
		setReactionRules(reactions, visible, `(`+visible+`) && ((comment != "" && task = "") || (comment = "" && task != ""))`)
		// A task's reactions all have an empty comment; the task tells them apart.
		reactions.RemoveIndex("idx_reactions_once")
		reactions.AddIndex("idx_reactions_once", true, "`comment`, `task`, `author`, `emoji`", "")
		return app.Save(reactions)
	}, func(app core.App) error {
		if _, err := app.DB().Delete("reactions", dbx.Not(dbx.HashExp{"task": ""})).Execute(); err != nil {
			return fmt.Errorf("drop the tasks' reactions: %w", err)
		}
		reactions, err := setReactionComment(app, true)
		if err != nil {
			return err
		}
		reactions.Fields.RemoveByName("task")
		visible := `comment.task.project.members.id ?= @request.auth.id || ` + ruleAdmin
		setReactionRules(reactions, visible, visible)
		reactions.RemoveIndex("idx_reactions_once")
		reactions.AddIndex("idx_reactions_once", true, "`comment`, `author`, `emoji`", "")
		return app.Save(reactions)
	})
}

func setReactionComment(app core.App, required bool) (*core.Collection, error) {
	reactions, err := app.FindCollectionByNameOrId("reactions")
	if err != nil {
		return nil, err
	}
	comment, ok := reactions.Fields.GetByName("comment").(*core.RelationField)
	if !ok {
		return nil, fmt.Errorf("reactions has no relation field %q", "comment")
	}
	comment.Required = required
	return reactions, nil
}

func setReactionRules(reactions *core.Collection, visible, create string) {
	reactions.ListRule = types.Pointer(visible)
	reactions.ViewRule = types.Pointer(visible)
	reactions.CreateRule = types.Pointer(create)
	reactions.DeleteRule = types.Pointer(`(` + visible + `) && author = @request.auth.id`)
}
