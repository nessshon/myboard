package auth

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"

	"github.com/pocketbase/dbx"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	pbauth "github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/nessshon/myboard/config"
)

const ProviderName = "telegram"

func Register(app core.App, cfg *config.Config) {
	scopes := []string{"openid", "profile"}
	if cfg.TelegramBotToken != "" {
		scopes = append(scopes, "telegram:bot_access")
	}
	// Telegram Login is plain OIDC, but it has no "email" scope that PocketBase's built-in OIDC
	// provider always requests (tools/auth/oidc.go), so we register a copy with Telegram's scopes.
	pbauth.Providers[ProviderName] = func() pbauth.Provider {
		p := pbauth.NewOIDCProvider()
		p.SetScopes(scopes)
		p.SetDisplayName("Telegram")
		return p
	}
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := configureProvider(se.App, cfg); err != nil {
			return fmt.Errorf("configure telegram login: %w", err)
		}
		if err := ensureOwner(se.App, cfg.AdminTelegramID); err != nil {
			return fmt.Errorf("ensure instance owner: %w", err)
		}
		return se.Next()
	})

	app.OnRecordAuthWithOAuth2Request("users").BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		tgID := telegramID(e.OAuth2User.RawUser["id"])
		user, err := activeUser(e.RequestEvent, tgID)
		if err != nil {
			return err
		}

		user.Set("name", e.OAuth2User.Name)
		user.Set("username", e.OAuth2User.Username)
		user.Set("avatar_url", e.OAuth2User.AvatarURL)
		user.Set("last_login", types.NowDateTime())
		user.Set("bot_blocked", false)
		if err := e.App.Save(user); err != nil {
			return err
		}

		// Telegram gives each bot its own "sub" for a person, and PocketBase keeps one link per provider
		// and record, so after a bot change the old link would block the new one. The person is found by
		// the signed "id" claim above, so the old link is stale.
		links, err := e.App.FindAllExternalAuthsByRecord(user)
		if err != nil {
			return e.InternalServerError("", fmt.Errorf("find links: %w", err))
		}
		for _, link := range links {
			if link.Provider() == ProviderName && link.ProviderId() != e.OAuth2User.Id {
				if err := e.App.Delete(link); err != nil {
					return err
				}
			}
		}

		e.Record = user
		e.IsNewRecord = false
		return e.Next()
	})
}

func RegisterDevLogin(se *core.ServeEvent) {
	se.Router.POST("/api/myboard/dev/login", func(e *core.RequestEvent) error {
		var body struct {
			TgID string `json:"tg_id"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("invalid body", err)
		}
		user, err := activeUser(e, body.TgID)
		if err != nil {
			return err
		}
		user.Set("last_login", types.NowDateTime())
		if err := e.App.Save(user); err != nil {
			return err
		}
		return apis.RecordAuthResponse(e, user, "dev", nil)
	})

	se.Router.GET("/api/myboard/dev/users", func(e *core.RequestEvent) error {
		users, err := e.App.FindRecordsByFilter("users", "deleted = false", "-role,name", 0, 0)
		if err != nil {
			return e.InternalServerError("", fmt.Errorf("list users: %w", err))
		}
		out := make([]map[string]string, len(users))
		for i, u := range users {
			out[i] = map[string]string{"tg_id": u.GetString("tg_id"), "name": u.GetString("name"), "role": u.GetString("role")}
		}
		return e.JSON(200, out)
	})
}

func configureProvider(app core.App, cfg *config.Config) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return fmt.Errorf("find users collection: %w", err)
	}
	provider := core.OAuth2ProviderConfig{
		Name:         ProviderName,
		DisplayName:  "Telegram",
		ClientId:     cfg.TelegramClientID,
		ClientSecret: cfg.TelegramSecret,
		AuthURL:      "https://oauth.telegram.org/auth",
		TokenURL:     "https://oauth.telegram.org/token",
		PKCE:         types.Pointer(true),
		Extra: map[string]any{
			"jwksURL": "https://oauth.telegram.org/.well-known/jwks.json",
			"issuers": []string{"https://oauth.telegram.org"},
		},
	}
	users.OAuth2.Enabled = true
	users.OAuth2.Providers = []core.OAuth2ProviderConfig{provider}
	return app.Save(users)
}

func ensureOwner(app core.App, tgID string) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return fmt.Errorf("find users collection: %w", err)
	}
	owner, err := app.FindFirstRecordByData(users, "tg_id", tgID)
	if errors.Is(err, sql.ErrNoRows) {
		owner = core.NewRecord(users)
		owner.Set("tg_id", tgID)
		owner.SetRandomPassword()
	} else if err != nil {
		return fmt.Errorf("find owner: %w", err)
	}
	if owner.GetString("role") == "admin" && !owner.GetBool("deleted") && !owner.IsNew() {
		return nil
	}
	owner.Set("role", "admin")
	owner.Set("deleted", false)
	return app.Save(owner)
}

func activeUser(e *core.RequestEvent, tgID string) (*core.Record, error) {
	user, err := e.App.FindFirstRecordByFilter("users", "tg_id = {:id} && deleted = false", dbx.Params{"id": tgID})
	if tgID == "" || errors.Is(err, sql.ErrNoRows) {
		return nil, e.ForbiddenError("No access.", map[string]any{"tg_id": validation.NewError("no_access", tgID)})
	}
	if err != nil {
		return nil, e.InternalServerError("", fmt.Errorf("find user: %w", err))
	}
	return user, nil
}

func telegramID(v any) string {
	switch id := v.(type) {
	case float64:
		return strconv.FormatFloat(id, 'f', -1, 64)
	case string:
		return id
	default:
		return ""
	}
}
