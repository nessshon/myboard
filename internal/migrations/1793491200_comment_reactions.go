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
		comments, err := app.FindCollectionByNameOrId("comments")
		if err != nil {
			return err
		}

		reactions := core.NewBaseCollection("reactions")
		visible := `comment.task.project.members.id ?= @request.auth.id || ` + ruleAdmin
		reactions.ListRule = types.Pointer(visible)
		reactions.ViewRule = types.Pointer(visible)
		reactions.CreateRule = types.Pointer(visible)
		reactions.DeleteRule = types.Pointer(`(` + visible + `) && author = @request.auth.id`)
		reactions.Fields.Add(
			&core.RelationField{Name: "comment", CollectionId: comments.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "author", CollectionId: users.Id, MaxSelect: 1},
			// Keys, not the emoji themselves: the site draws them (web/src/api.ts, REACTIONS).
			&core.SelectField{Name: "emoji", Required: true, MaxSelect: 1, Values: []string{
				"+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes", "done", "thanks", "fire", "clap", "hundred", "thinking",
			}},
		)
		addTimestamps(reactions)
		reactions.AddIndex("idx_reactions_once", true, "`comment`, `author`, `emoji`", "")
		return app.Save(reactions)
	}, func(app core.App) error {
		reactions, err := app.FindCollectionByNameOrId("reactions")
		if err != nil {
			return err
		}
		return app.Delete(reactions)
	})
}
