package migrations

import (
	"github.com/nessshon/myboard/config"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	ruleAuthed = `@request.auth.id != ""`
	ruleAdmin  = `@request.auth.role = "admin"`
	ruleMember = `project.members.id ?= @request.auth.id || @request.auth.role = "admin"`
)

func init() {
	// Text limits are repeated in web/src/limits.ts for the counters.
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if err := setupUsers(app, users); err != nil {
			return err
		}

		projects := core.NewBaseCollection("projects")
		projects.ListRule = types.Pointer(`members.id ?= @request.auth.id || ` + ruleAdmin)
		projects.ViewRule = projects.ListRule
		projects.CreateRule = types.Pointer(ruleAdmin)
		projects.UpdateRule = types.Pointer(ruleAdmin)
		projects.DeleteRule = types.Pointer(ruleAdmin)
		projects.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 60, Presentable: true},
			&core.TextField{Name: "description", Max: 500},
			&core.TextField{Name: "key", Required: true, Max: 10, Pattern: `^[A-Z][A-Z0-9]{1,9}$`},
			&core.RelationField{Name: "members", CollectionId: users.Id, MaxSelect: 1000},
			&core.BoolField{Name: "archived"},
			&core.NumberField{Name: "seq", Hidden: true, OnlyInt: true},
			&core.TextField{Name: "color", Pattern: `^#[0-9a-f]{6}$`},
		)
		addTimestamps(projects)
		projects.AddIndex("idx_projects_key", true, "`key`", "")
		if err := app.Save(projects); err != nil {
			return err
		}

		labels := core.NewBaseCollection("labels")
		setRules(labels, ruleMember)
		// The rule is checked against the stored label, so without this a member could move a label
		// into a project they are not in.
		labels.UpdateRule = types.Pointer(`(` + ruleMember + `) && @request.body.project:isset = false`)
		labels.Fields.Add(
			&core.RelationField{Name: "project", CollectionId: projects.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "name", Required: true, Max: 24, Presentable: true},
			&core.TextField{Name: "color", Required: true, Pattern: `^#[0-9a-f]{6}$`},
		)
		addTimestamps(labels)
		labels.AddIndex("idx_labels_project_name", true, "`project`, `name`", "")
		if err := app.Save(labels); err != nil {
			return err
		}

		tasks := core.NewBaseCollection("tasks")
		setRules(tasks, ruleMember)
		tasks.UpdateRule = types.Pointer(`(` + ruleMember + `) && @request.body.author:isset = false`)
		tasks.Fields.Add(
			&core.RelationField{Name: "project", CollectionId: projects.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.NumberField{Name: "number", OnlyInt: true},
			&core.TextField{Name: "title", Required: true, Max: 200, Presentable: true},
			// Explicit max: a text field with Max 0 falls back to a 5000 chars limit (core/field_text.go).
			&core.TextField{Name: "description", Max: 20000},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"backlog", "todo", "in_progress", "done", "cancelled"}},
			&core.SelectField{Name: "priority", Required: true, MaxSelect: 1, Values: []string{"normal", "high", "urgent"}},
			&core.RelationField{Name: "labels", CollectionId: labels.Id, MaxSelect: 100},
			&core.RelationField{Name: "assignee", CollectionId: users.Id, MaxSelect: 1},
			// A calendar day, not an instant: stored as text so time zones never shift it.
			&core.TextField{Name: "due", Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.NumberField{Name: "position"},
			&core.RelationField{Name: "author", CollectionId: users.Id, MaxSelect: 1},
			&core.DateField{Name: "edited"},
		)
		addTimestamps(tasks)
		tasks.AddIndex("idx_tasks_project_number", true, "`project`, `number`", "")
		tasks.AddIndex("idx_tasks_board", false, "`project`, `status`, `position`", "")
		tasks.AddIndex("idx_tasks_assignee", false, "`assignee`, `status`", "")
		if err := app.Save(tasks); err != nil {
			return err
		}

		notes := core.NewBaseCollection("notes")
		visible := `(` + ruleMember + `) && (shared = true || author = @request.auth.id)`
		notes.ListRule = types.Pointer(visible)
		notes.ViewRule = types.Pointer(visible)
		notes.CreateRule = types.Pointer(ruleMember)
		// Ownership and the project are fixed: whoever could rewrite the author of a shared note
		// could make it personal and hide it from everyone else.
		notes.UpdateRule = types.Pointer(visible +
			` && @request.body.author:isset = false && @request.body.project:isset = false` +
			` && (@request.body.shared:isset = false || author = @request.auth.id || ` + ruleAdmin + `)`)
		notes.DeleteRule = types.Pointer(`(` + ruleMember + `) && (author = @request.auth.id || (` + ruleAdmin + ` && shared = true))`)
		notes.Fields.Add(
			&core.RelationField{Name: "project", CollectionId: projects.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "title", Required: true, Max: 120, Presentable: true},
			&core.TextField{Name: "body", Max: 50000},
			&core.BoolField{Name: "shared"},
			&core.NumberField{Name: "position"},
			&core.RelationField{Name: "author", CollectionId: users.Id, MaxSelect: 1},
			&core.DateField{Name: "edited"},
		)
		addTimestamps(notes)
		notes.AddIndex("idx_notes_project_position", false, "`project`, `position`", "")
		if err := app.Save(notes); err != nil {
			return err
		}

		tokens := core.NewBaseCollection("api_tokens")
		tokens.ListRule = types.Pointer("user = @request.auth.id")
		tokens.ViewRule = tokens.ListRule
		tokens.DeleteRule = tokens.ListRule
		tokens.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "name", Required: true, Max: 40, Presentable: true},
			&core.TextField{Name: "hash", Required: true, Hidden: true},
			&core.TextField{Name: "hint", Max: 4},
			&core.DateField{Name: "last_used"},
		)
		addTimestamps(tokens)
		tokens.AddIndex("idx_api_tokens_hash", true, "`hash`", "")
		return app.Save(tokens)
	}, nil)
}

func setupUsers(app core.App, users *core.Collection) error {
	users.ListRule = types.Pointer(ruleAuthed)
	users.ViewRule = types.Pointer(ruleAuthed)
	users.CreateRule = nil
	users.UpdateRule = types.Pointer(`@request.auth.id = id || ` + ruleAdmin)
	users.DeleteRule = nil
	// Checked when a session is issued (login, refresh), so a removed person gets no new one; the ones
	// they had die with the token key internal/users refreshes.
	users.AuthRule = types.Pointer("deleted = false")

	users.Fields.RemoveByName("avatar")
	users.Fields.Add(
		&core.TextField{Name: "tg_id", Required: true, Hidden: true, Pattern: config.TelegramIDPattern},
		&core.TextField{Name: "username", Max: 64},
		&core.URLField{Name: "avatar_url"},
		&core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"admin", "member"}},
		&core.BoolField{Name: "deleted"},
		&core.DateField{Name: "last_login", Hidden: true},
		// The person's own order of projects in the menu: project ids; the rest follow by name. Not
		// Hidden: PocketBase drops hidden fields from non-superuser bodies (apis/record_crud.go), so the
		// person could not save it; internal/users hides it from everyone else instead.
		&core.JSONField{Name: "project_order", MaxSize: 20000},
		&core.JSONField{Name: "notify_off", MaxSize: 2000},
		// Set when Telegram refuses a message (blocked bot, no permission); a login clears it. Hidden, so no
		// filter tells who blocked the bot; the site never reads it.
		&core.BoolField{Name: "bot_blocked", Hidden: true},
		&core.SelectField{Name: "lang", MaxSelect: 1, Values: []string{"ru", "en"}},
	)
	// Telegram gives no email; the unique email index already skips empty values (core/collection_model.go).
	if email, ok := users.Fields.GetByName(core.FieldNameEmail).(*core.EmailField); ok {
		email.Required = false
	}
	users.AddIndex("idx_users_tg_id", true, "`tg_id`", "")

	users.PasswordAuth.Enabled = false
	users.OAuth2.Enabled = true
	users.OAuth2.MappedFields = core.OAuth2KnownFields{}

	return app.Save(users)
}

func setRules(c *core.Collection, rule string) {
	c.ListRule = types.Pointer(rule)
	c.ViewRule = types.Pointer(rule)
	c.CreateRule = types.Pointer(rule)
	c.UpdateRule = types.Pointer(rule)
	c.DeleteRule = types.Pointer(rule)
}

func addTimestamps(c *core.Collection) {
	c.Fields.Add(
		&core.AutodateField{Name: "created", OnCreate: true},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
}
