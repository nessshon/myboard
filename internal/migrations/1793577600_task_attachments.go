package migrations

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// What a person may attach; PocketBase tells the type by the content, not by the name. No HTML, SVG or
// programs: a colleague opens these. The same list is in web/src/limits.ts.
var attachmentTypes = []string{
	"image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif",
	"application/pdf", "text/plain", "text/csv", "application/json",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
	"application/zip", "application/gzip",
	"video/mp4", "video/quicktime", "video/webm",
	"audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a",
}

// A comment may be files alone, so its text becomes optional; a rollback gives such comments a paperclip,
// or their next save would be refused.
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
		comments, err := app.FindCollectionByNameOrId("comments")
		if err != nil {
			return err
		}
		if err := setCommentRequired(app, comments, false); err != nil {
			return err
		}

		attachments := core.NewBaseCollection("attachments")
		visible := `task.project.members.id ?= @request.auth.id || ` + ruleAdmin
		attachments.ListRule = types.Pointer(visible)
		attachments.ViewRule = types.Pointer(visible)
		// Only the author adds to a comment, and only to one of the same task.
		attachments.CreateRule = types.Pointer(`(` + visible + `) && (comment = "" ||` +
			` (comment.author = @request.auth.id && comment.task = task))`)
		attachments.DeleteRule = types.Pointer(`(` + visible + `) && (author = @request.auth.id || ` + ruleAdmin + `)`)
		attachments.Fields.Add(
			&core.RelationField{Name: "task", CollectionId: tasks.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "comment", CollectionId: comments.Id, MaxSelect: 1, CascadeDelete: true},
			// 50 MB, as much as a Telegram bot sends as a file (core.telegram.org/bots/api#senddocument).
			&core.FileField{
				Name: "file", Required: true, MaxSelect: 1, MaxSize: 50 << 20, Protected: true,
				Thumbs: []string{"0x192"}, MimeTypes: attachmentTypes,
			},
			// Both set by the server from the uploaded file (internal/tasks/attachments.go).
			&core.TextField{Name: "name", Required: true, Max: 255},
			&core.NumberField{Name: "size", OnlyInt: true, Min: types.Pointer(0.0)},
			&core.RelationField{Name: "author", CollectionId: users.Id, MaxSelect: 1},
		)
		addTimestamps(attachments)
		attachments.AddIndex("idx_attachments_task", false, "`task`, `created`", "")
		return app.Save(attachments)
	}, func(app core.App) error {
		attachments, err := app.FindCollectionByNameOrId("attachments")
		if err != nil {
			return err
		}
		if err := app.Delete(attachments); err != nil {
			return err
		}
		if _, err := app.DB().Update("comments", dbx.Params{"body": "📎"}, dbx.HashExp{"body": ""}).Execute(); err != nil {
			return fmt.Errorf("fill comments without text: %w", err)
		}
		comments, err := app.FindCollectionByNameOrId("comments")
		if err != nil {
			return err
		}
		return setCommentRequired(app, comments, true)
	})
}

func setCommentRequired(app core.App, comments *core.Collection, required bool) error {
	body, ok := comments.Fields.GetByName("body").(*core.TextField)
	if !ok {
		return fmt.Errorf("comments has no text field %q", "body")
	}
	body.Required = required
	return app.Save(comments)
}
