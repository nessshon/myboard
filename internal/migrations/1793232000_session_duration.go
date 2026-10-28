package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	// The site extends a session only when it is opened (web/src/api.ts, restoreSession), so with
	// PocketBase's 5 days a person away for a week had to sign in again.
	m.Register(func(app core.App) error {
		return setSessionDuration(app, 30*24*60*60)
	}, func(app core.App) error {
		return setSessionDuration(app, 5*24*60*60)
	})
}

func setSessionDuration(app core.App, seconds int64) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.AuthToken.Duration = seconds
	return app.Save(users)
}
