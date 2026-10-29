package guard

import (
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

// PocketBase does not apply the joined collection's list rule to multi-match conditions over a
// back-relation, such as `notes_via_project.body !~ "x"` (core/record_field_resolver.go, UpdateQuery),
// so such a filter answers yes/no about records the user cannot see. The web app and the agent guide
// never filter or sort through back-relations; only superusers keep them.
const backRelation = "_via_"

// A person's own settings are shown only to them (internal/users) but are not Hidden, so that they can save
// them; PocketBase would let anyone filter by such a field and learn the value from yes/no answers.
var ownSettings = regexp.MustCompile(`\b(project_order|notify_off|lang)\b`)

// Quoted values are data, not fields: a search for the word "lang" is fine.
var quoted = regexp.MustCompile(`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`)

var allowedAPI = regexp.MustCompile(`^/api/(` +
	`health|realtime|batch|myboard/.+|` +
	`collections/(users|projects|labels|tasks|notes|comments|reactions|attachments|api_tokens)/records(/[^/]+)?|` +
	`collections/users/(auth-methods|auth-refresh|auth-with-oauth2)|` +
	`files/token|files/attachments/[^/]+/[^/]+` +
	`)$`)

// A batch may only reorder: the site sends nothing else in one (web/src/api.ts, renumber). Hooks inside a
// batch run before it commits, so anything more would notify about changes a failed batch rolls back.
var reorder = regexp.MustCompile(`^/api/collections/(tasks|notes)/records/[^/?]+$`)

func Register(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			path := e.Request.URL.Path
			if path == "/_" || strings.HasPrefix(path, "/_/") || (strings.HasPrefix(path, "/api/") && !allowedAPI.MatchString(path)) {
				return e.NotFoundError("", nil)
			}
			if !e.HasSuperuserAuth() && strings.HasPrefix(path, "/api/") {
				q := e.Request.URL.Query()
				if refers(q.Get("filter"), q.Get("sort")) {
					return e.BadRequestError("This filter or sort is not allowed.", nil)
				}
			}
			return e.Next()
		})
		return se.Next()
	})

	app.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		if !e.HasSuperuserAuth() {
			// Parsed the way PocketBase will parse them, so escapes like \u005f or %5F are decoded first.
			parsed := subscriptions.NewDefaultClient()
			parsed.Subscribe(e.Subscriptions...)
			for _, sub := range parsed.Subscriptions() {
				if refers(sub.Query["filter"], sub.Query["sort"]) {
					return e.BadRequestError("This filter or sort is not allowed.", nil)
				}
			}
		}
		return e.Next()
	})

	app.OnBatchRequest().BindFunc(func(e *core.BatchRequestEvent) error {
		for _, r := range e.Batch {
			_, position := r.Body["position"]
			if r.Method != "PATCH" || !reorder.MatchString(r.URL) || len(r.Body) != 1 || !position {
				return e.BadRequestError("A batch may only change the position of tasks and notes.", nil)
			}
		}
		return e.Next()
	})
}

func refers(values ...string) bool {
	for _, v := range values {
		if strings.Contains(v, backRelation) || ownSettings.MatchString(quoted.ReplaceAllString(v, "")) {
			return true
		}
	}
	return false
}
