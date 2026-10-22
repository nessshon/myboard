package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		tasks, err := app.FindCollectionByNameOrId("tasks")
		if err != nil {
			return err
		}

		comments := core.NewBaseCollection("comments")
		visible := `task.project.members.id ?= @request.auth.id || ` + ruleAdmin
		comments.ListRule = types.Pointer(visible)
		comments.ViewRule = types.Pointer(visible)
		comments.CreateRule = types.Pointer(visible)
		comments.UpdateRule = types.Pointer(`(` + visible + `) && author = @request.auth.id` +
			` && @request.body.author:isset = false && @request.body.task:isset = false`)
		comments.DeleteRule = types.Pointer(`(` + visible + `) && (author = @request.auth.id || ` + ruleAdmin + `)`)
		comments.Fields.Add(
			&core.RelationField{Name: "task", CollectionId: tasks.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "author", CollectionId: users.Id, MaxSelect: 1},
			&core.TextField{Name: "body", Required: true, Max: 5000, Pattern: `\S`},
		)
		addTimestamps(comments)
		comments.AddIndex("idx_comments_task", false, "`task`, `created`", "")
		return app.Save(comments)
	}, func(app core.App) error {
		comments, err := app.FindCollectionByNameOrId("comments")
		if err != nil {
			return err
		}
		return app.Delete(comments)
	})
}
