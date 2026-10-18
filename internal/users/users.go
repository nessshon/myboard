package users

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"

	"github.com/pocketbase/dbx"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/config"
	"github.com/nessshon/myboard/internal/apitoken"
)

func Register(app core.App, cfg *config.Config) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/myboard/users", func(e *core.RequestEvent) error {
			if denied := manageable(e); denied != nil {
				return denied
			}
			var body struct {
				TgID string `json:"tg_id"`
				Role string `json:"role"`
			}
			if err := e.BindBody(&body); err != nil {
				return e.BadRequestError("invalid body", err)
			}
			if !config.TelegramID.MatchString(body.TgID) {
				return e.BadRequestError("", validation.Errors{"tg_id": validation.NewError("validation_invalid_tg_id", "A Telegram ID is a whole number of up to 16 digits.")})
			}
			switch body.Role {
			case "":
				body.Role = "member"
			case "admin", "member":
			default:
				return e.BadRequestError("", validation.Errors{"role": validation.NewError("validation_invalid_role", "The role is admin or member.")})
			}

			user, err := e.App.FindFirstRecordByData("users", "tg_id", body.TgID)
			switch {
			case errors.Is(err, sql.ErrNoRows):
				collection, err := e.App.FindCollectionByNameOrId("users")
				if err != nil {
					return e.InternalServerError("", fmt.Errorf("find users collection: %w", err))
				}
				user = core.NewRecord(collection)
				user.Set("tg_id", body.TgID)
				user.SetRandomPassword()
			case err != nil:
				return e.InternalServerError("", fmt.Errorf("find user by tg_id: %w", err))
			case !user.GetBool("deleted"):
				return e.Error(409, "", validation.Errors{"tg_id": validation.NewError("validation_user_exists", "This user is already added.")})
			}
			user.Set("deleted", false)
			user.Set("role", body.Role)
			if err := e.App.Save(user); err != nil {
				return err
			}
			return e.JSON(200, user)
		})

		se.Router.POST("/api/myboard/users/{id}/remove", func(e *core.RequestEvent) error {
			if denied := manageable(e); denied != nil {
				return denied
			}
			user, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
			if err != nil {
				return e.NotFoundError("", err)
			}
			if user.Id == e.Auth.Id || user.GetString("tg_id") == cfg.AdminTelegramID {
				return e.BadRequestError("The instance owner and yourself cannot be removed.", nil)
			}
			if err := remove(e.App, user); err != nil {
				return e.InternalServerError("", fmt.Errorf("remove user %s: %w", user.Id, err))
			}
			return e.NoContent(204)
		})

		// Who the request acts as. PocketBase allows @request.auth in list filters to superusers only,
		// so scripts and agents look up their own id here.
		se.Router.GET("/api/myboard/me", func(e *core.RequestEvent) error {
			if e.Auth == nil || e.Auth.Collection().Name != "users" {
				return e.UnauthorizedError("", nil)
			}
			return e.JSON(200, map[string]any{
				"id":       e.Auth.Id,
				"name":     e.Auth.GetString("name"),
				"username": e.Auth.GetString("username"),
				"role":     e.Auth.GetString("role"),
			})
		})

		return se.Next()
	})

	// Admins may change only the role through the regular API; the profile belongs to the login
	// hook and tg_id/deleted to the routes above. Superusers are not restricted.
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if apitoken.ViaToken(e.RequestEvent) {
			return e.ForbiddenError("People are changed from a signed-in session only.", nil)
		}
		info, err := e.RequestInfo()
		if err != nil {
			return fmt.Errorf("read request info: %w", err)
		}
		self := e.Record.Id == e.Auth.Id
		for key := range info.Body {
			own := key == "project_order" || key == "notify_off" || key == "lang"
			if (own && self) || (key == "role" && isAdmin(e.Auth)) {
				continue
			}
			return e.BadRequestError("", validation.Errors{key: validation.NewError("validation_read_only", "This field cannot be changed here.")})
		}
		if _, role := info.Body["role"]; role && e.Record.GetBool("deleted") {
			return e.BadRequestError("", validation.Errors{"role": validation.NewError("validation_user_removed", "A removed user's role cannot be changed.")})
		}
		if e.Record.GetString("role") != e.Record.Original().GetString("role") &&
			(e.Record.Id == e.Auth.Id || e.Record.GetString("tg_id") == cfg.AdminTelegramID) {
			return e.BadRequestError("", validation.Errors{"role": validation.NewError("validation_role_locked", "The instance owner's role and your own role cannot be changed.")})
		}
		return e.Next()
	})

	// tg_id and last_login are hidden in the schema, which also keeps them out of filters and sorts
	// (a filter would confirm anyone's Telegram id); the person themselves and admins see them.
	app.OnRecordEnrich("users").BindFunc(func(e *core.RecordEnrichEvent) error {
		if e.RequestInfo != nil {
			auth := e.RequestInfo.Auth
			self := auth != nil && auth.Id == e.Record.Id
			if self || isAdmin(auth) {
				e.Record.Unhide("tg_id", "last_login")
			}
			if isAdmin(auth) && e.Record.GetString("tg_id") == cfg.AdminTelegramID {
				e.Record.WithCustomData(true)
				e.Record.Set("owner", true)
			}
			if !self {
				e.Record.Hide("project_order", "notify_off", "lang")
			}
		}
		return e.Next()
	})

	app.OnRecordValidate("projects").BindFunc(func(e *core.RecordEvent) error {
		added := e.Record.GetStringSlice("members")
		if !e.Record.IsNew() {
			before := e.Record.Original().GetStringSlice("members")
			added = slices.DeleteFunc(added, func(id string) bool { return slices.Contains(before, id) })
		}
		for _, id := range added {
			user, err := e.App.FindRecordById("users", id)
			if errors.Is(err, sql.ErrNoRows) || (err == nil && user.GetBool("deleted")) {
				return validation.Errors{"members": validation.NewError("validation_user_removed", "A removed user cannot be a project member.")}
			}
			if err != nil {
				return fmt.Errorf("find member %s: %w", id, err)
			}
		}
		return e.Next()
	})
}

func remove(app core.App, user *core.Record) error {
	return app.RunInTransaction(func(tx core.App) error {
		user.Set("deleted", true)
		// Session tokens are signed with this key, so all of them stop working (core/record_tokens.go).
		user.RefreshTokenKey()
		if err := tx.Save(user); err != nil {
			return fmt.Errorf("mark deleted: %w", err)
		}

		tokens, err := tx.FindAllRecords("api_tokens", dbx.HashExp{"user": user.Id})
		if err != nil {
			return fmt.Errorf("find api tokens: %w", err)
		}
		for _, t := range tokens {
			if err := tx.Delete(t); err != nil {
				return fmt.Errorf("delete api token %s: %w", t.Id, err)
			}
		}

		projects, err := tx.FindRecordsByFilter("projects", "members.id ?= {:id}", "", 0, 0, dbx.Params{"id": user.Id})
		if err != nil {
			return fmt.Errorf("find projects: %w", err)
		}
		for _, p := range projects {
			p.Set("members-", user.Id)
			if err := tx.Save(p); err != nil {
				return fmt.Errorf("leave project %s: %w", p.Id, err)
			}
		}
		return nil
	})
}

func isAdmin(auth *core.Record) bool {
	return auth != nil && auth.Collection().Name == "users" && auth.GetString("role") == "admin"
}

// manageable refuses people management to anyone but an admin in a signed-in session: a leaked API
// token must not be able to make its owner's successor or remove people.
func manageable(e *core.RequestEvent) error {
	if !isAdmin(e.Auth) {
		return e.ForbiddenError("", nil)
	}
	if apitoken.ViaToken(e) {
		return e.ForbiddenError("Users are managed from a signed-in session only.", nil)
	}
	return nil
}
