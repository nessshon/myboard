package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Not protected: a logo is no secret, and a link without a file token stays the same, so the browser keeps it.
// A rollback clears the pictures first: PocketBase deletes a cleared file but leaves a dropped field's on disk.
func init() {
	m.Register(func(app core.App) error {
		projects, err := app.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}
		projects.Fields.Add(&core.FileField{
			// A phone's photo is 2–5 MB; only the thumb is ever shown.
			Name: "icon", MaxSelect: 1, MaxSize: 5 << 20,
			// The largest badge is 32px (web/src/pages/HomePage.tsx) three times over, cut from the centre.
			Thumbs: []string{"96x96"},
			// No SVG (opened by its link, it runs a script), HEIC (no thumb, and only Safari shows the original) or
			// GIF (its thumb keeps one frame). The same list is in web/src/limits.ts.
			MimeTypes: []string{"image/png", "image/jpeg", "image/webp"},
		})
		return app.Save(projects)
	}, func(app core.App) error {
		withIcon, err := app.FindRecordsByFilter("projects", "icon != ''", "", 0, 0)
		if err != nil {
			return err
		}
		for _, p := range withIcon {
			p.Set("icon", "")
			if err := app.Save(p); err != nil {
				return fmt.Errorf("clear the icon of project %s: %w", p.Id, err)
			}
		}
		projects, err := app.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}
		projects.Fields.RemoveByName("icon")
		return app.Save(projects)
	})
}
