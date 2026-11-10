package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A listed type is matched exactly, and the type comes from the first bytes: a Python script with #! is
// text/x-python, a README opening with a tag text/html, and the list refused both. internal/tasks/attachments.go
// checks instead.
func init() {
	m.Register(func(app core.App) error {
		return setAttachmentTypes(app, nil)
	}, func(app core.App) error {
		return setAttachmentTypes(app, attachmentTypes)
	})
}

func setAttachmentTypes(app core.App, mimeTypes []string) error {
	attachments, err := app.FindCollectionByNameOrId("attachments")
	if err != nil {
		return err
	}
	field, ok := attachments.Fields.GetByName("file").(*core.FileField)
	if !ok {
		return fmt.Errorf("attachments has no file field %q", "file")
	}
	field.MimeTypes = mimeTypes
	return app.Save(attachments)
}
