package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/osutils"

	"github.com/nessshon/myboard/config"
	"github.com/nessshon/myboard/internal/apitoken"
	"github.com/nessshon/myboard/internal/auth"
	"github.com/nessshon/myboard/internal/bot"
	"github.com/nessshon/myboard/internal/guard"
	_ "github.com/nessshon/myboard/internal/migrations"
	"github.com/nessshon/myboard/internal/realip"
	"github.com/nessshon/myboard/internal/tasks"
	"github.com/nessshon/myboard/internal/users"
	"github.com/nessshon/myboard/web"
)

var Version = "dev"

func main() {
	// The data lives where PocketBase would put its pb_data (pocketbase.go, inspectRuntime): next to
	// the binary, or in the working directory under `go run`. The name is the app's, not the library's.
	base := filepath.Dir(os.Args[0])
	if osutils.IsProbablyGoRun() {
		base, _ = os.Getwd()
	}
	// pocketbase.New() turns dev mode on for `go run`; dev mode enables the passwordless dev login,
	// so it must come only from an explicit --dev flag.
	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDev:     false,
		DefaultDataDir: filepath.Join(base, "myboard_data"),
	})
	app.RootCmd.Version = Version

	cfg, cfgErr := config.Load()
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if cfgErr != nil {
			return fmt.Errorf("load config: %w", cfgErr)
		}
		return se.Next()
	})

	auth.Register(app, cfg)
	users.Register(app, cfg)
	tasks.Register(app)
	apitoken.Register(app)
	guard.Register(app)
	realip.Register(app, cfg)
	notifier := bot.Register(app, cfg)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		settings := se.App.Settings()
		settings.Batch.Enabled = true
		settings.Batch.MaxRequests = 1000
		settings.Batch.MaxBodySize = 1 << 20
		settings.RateLimits.Enabled = true
		if err := se.App.Save(settings); err != nil {
			return fmt.Errorf("save settings: %w", err)
		}
		// People sign in with Telegram and there is no /_/ dashboard (internal/guard), so no superuser is
		// needed; PocketBase would otherwise create an installer superuser and open its page on every start.
		se.InstallerFunc = nil

		if se.App.IsDev() {
			auth.RegisterDevLogin(se)
		}
		serveFrontend(se, web.Dist(), cfg.PublicURL, func() boot {
			name := notifier.Username()
			if name == "" && se.App.IsDev() {
				// Shows the notification settings without a bot token; a hyphen is not allowed in
				// Telegram usernames, so "Open the bot" cannot lead to someone's real bot.
				name = "no-bot-token"
			}
			return boot{Version: Version, Dev: se.App.IsDev(), Bot: name}
		})
		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

var inlineScript = regexp.MustCompile(`(?s)<script>(.*?)</script>`)

func contentSecurityPolicy(dist fs.FS) string {
	scripts := "'self'"
	if page, err := fs.ReadFile(dist, "index.html"); err == nil {
		for _, m := range inlineScript.FindAllSubmatch(page, -1) {
			sum := sha256.Sum256(m[1])
			scripts += " 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
		}
	}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src " + scripts,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https:",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}, "; ")
}

const exampleOrigin = "https://example.com"

func withOrigin(dist fs.FS, name, publicURL string) []byte {
	data, err := fs.ReadFile(dist, name)
	if err != nil {
		return nil
	}
	return bytes.ReplaceAll(data, []byte(exampleOrigin), []byte(publicURL))
}

type boot struct {
	Version string `json:"version"`
	Dev     bool   `json:"dev"`
	Bot     string `json:"bot,omitempty"`
}

func withBoot(page []byte, state boot) string {
	data, _ := json.Marshal(state)
	tag := `<script type="application/json" id="boot">` + string(data) + "</script></head>"
	return strings.Replace(string(page), "</head>", tag, 1)
}

func serveFrontend(se *core.ServeEvent, dist fs.FS, publicURL string, state func() boot) {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	csp := contentSecurityPolicy(dist)
	page := withOrigin(dist, "index.html", publicURL)
	guide := withOrigin(dist, "llms.txt", publicURL)
	static := apis.Static(dist, false)
	se.Router.GET("/{path...}", func(e *core.RequestEvent) error {
		path := e.Request.URL.Path
		if strings.HasPrefix(path, "/api/") {
			return e.NotFoundError("", nil)
		}
		h := e.Response.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if strings.HasPrefix(path, "/assets/") {
			h.Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			h.Set("Cache-Control", "no-cache")
		}

		switch {
		case path == "/llms.txt" && guide != nil:
			return e.Blob(200, "text/plain; charset=utf-8", guide)
		case path != "/index.html" && isFile(dist, path):
			return static(e)
		case page != nil:
			return e.HTML(200, withBoot(page, state()))
		}
		return e.NotFoundError("", nil)
	}).Bind(apis.Gzip())
}

func isFile(dist fs.FS, path string) bool {
	info, err := fs.Stat(dist, strings.TrimPrefix(path, "/"))
	return err == nil && !info.IsDir()
}
