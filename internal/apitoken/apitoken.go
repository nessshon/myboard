package apitoken

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/types"
)

const Prefix = "mbt_"
const lastUsedEvery = 10 * time.Minute
const viaToken = "myboardViaApiToken"

func ViaToken(e *core.RequestEvent) bool {
	return e.Get(viaToken) != nil
}

func Register(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Runs before PocketBase's own token loader, which then sees e.Auth set and skips
		// (apis/middlewares.go), so collection rules treat the request as the token's user.
		// It also runs before the rate limiter (-1000), so a rejected token is not counted; accepted,
		// as with PocketBase's own loader: a 256-bit random token cannot be guessed.
		se.Router.Bind(&hook.Handler[*core.RequestEvent]{
			Id:       "myboardApiToken",
			Priority: apis.DefaultLoadAuthTokenMiddlewarePriority - 1,
			Func:     authenticate,
		})

		se.Router.POST("/api/myboard/tokens", func(e *core.RequestEvent) error {
			if ViaToken(e) {
				return e.ForbiddenError("API tokens are issued from a signed-in session only.", nil)
			}
			var body struct {
				Name string `json:"name"`
			}
			if err := e.BindBody(&body); err != nil {
				return e.BadRequestError("invalid body", err)
			}
			collection, err := e.App.FindCollectionByNameOrId("api_tokens")
			if err != nil {
				return e.InternalServerError("", fmt.Errorf("find api_tokens collection: %w", err))
			}
			token := Prefix + security.RandomString(43)
			record := core.NewRecord(collection)
			record.Set("user", e.Auth.Id)
			record.Set("name", strings.TrimSpace(body.Name))
			record.Set("hash", security.SHA256(token))
			record.Set("hint", token[len(token)-4:])
			if err := e.App.Save(record); err != nil {
				return err
			}
			return e.JSON(200, map[string]any{
				"id":    record.Id,
				"name":  record.GetString("name"),
				"hint":  record.GetString("hint"),
				"token": token,
			})
		}).Bind(apis.RequireAuth("users"))

		return se.Next()
	})

	app.OnRecordDeleteRequest("api_tokens").BindFunc(func(e *core.RecordRequestEvent) error {
		if ViaToken(e.RequestEvent) {
			return e.ForbiddenError("API tokens are revoked from a signed-in session only.", nil)
		}
		return e.Next()
	})
}

func authenticate(e *core.RequestEvent) error {
	token, ok := strings.CutPrefix(e.Request.Header.Get("Authorization"), "Bearer ")
	if !ok || !strings.HasPrefix(token, Prefix) {
		return e.Next()
	}

	record, err := e.App.FindFirstRecordByData("api_tokens", "hash", security.SHA256(token))
	if errors.Is(err, sql.ErrNoRows) {
		return e.UnauthorizedError("Invalid API token.", nil)
	}
	if err != nil {
		return e.InternalServerError("", fmt.Errorf("find api token: %w", err))
	}
	user, err := e.App.FindRecordById("users", record.GetString("user"))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return e.InternalServerError("", fmt.Errorf("find api token user: %w", err))
	}
	if err != nil || user.GetBool("deleted") {
		return e.UnauthorizedError("Invalid API token.", nil)
	}
	e.Auth = user
	e.Set(viaToken, true)

	if time.Since(record.GetDateTime("last_used").Time()) > lastUsedEvery {
		record.Set("last_used", types.NowDateTime())
		if err := e.App.Save(record); err != nil {
			e.App.Logger().Warn("failed to update api token last_used", "error", err)
		}
	}
	return e.Next()
}
