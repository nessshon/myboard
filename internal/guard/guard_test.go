package guard_test

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/testutil"
)

// A negated condition over a back-relation skips the joined collection's rule in PocketBase, so it
// could tell whether someone's personal note contains a word; such filters are refused.
func TestBackRelationFiltersAreRefused(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "440000001", "member")
	bob := testutil.User(t, app, "440000002", "member")
	p := testutil.Project(t, app, "VIA", alice, bob)
	testutil.Record(t, app, "notes", map[string]any{"project": p.Id, "title": "diary", "body": "pin 4711", "author": bob.Id})
	h := testutil.Handler(t, app)
	asAlice := testutil.Token(t, alice)

	projects := "/api/collections/projects/records?"
	cases := []struct {
		name, query string
		status      int
	}{
		{"filter through a back-relation", "filter=" + url.QueryEscape(`notes_via_project.body !~ "4711"`), 400},
		{"sort through a back-relation", "sort=" + url.QueryEscape("notes_via_project.title"), 400},
		{"an ordinary filter still works", "filter=" + url.QueryEscape(`key = "VIA"`), 200},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, asAlice, http.MethodGet, projects+c.query, ""); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}
}

// PocketBase decodes a subscription's options after the hook sees them, so escapes must not hide a
// back-relation.
func TestEncodedBackRelationSubscriptionsAreRefused(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	subscribe := func(sub string) error {
		e := &core.RealtimeSubscribeRequestEvent{RequestEvent: &core.RequestEvent{App: app}, Subscriptions: []string{sub}}
		return app.OnRealtimeSubscribeRequest().Trigger(e, func(*core.RealtimeSubscribeRequestEvent) error { return nil })
	}
	for _, sub := range []string{
		`projects/*?options={"query":{"filter":"notes_via_project.body ~ 'x'"}}`,
		"projects/*?options={\"query\":{\"filter\":\"notes\\u005fvia\\u005fproject.body ~ 'x'\"}}",
		`projects/*?options=%7B%22query%22%3A%7B%22sort%22%3A%22notes%5Fvia%5Fproject.title%22%7D%7D`,
	} {
		if err := subscribe(sub); err == nil {
			t.Errorf("subscription %q was allowed", sub)
		}
	}
	if err := subscribe(`projects/*?options={"query":{"filter":"key = 'VIA'"}}`); err != nil {
		t.Errorf("an ordinary subscription was refused: %v", err)
	}
}

func TestOwnSettingsFiltersAreRefused(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "450000001", "member")
	h := testutil.Handler(t, app)
	asAlice := testutil.Token(t, alice)

	cases := []struct {
		name, path string
		status     int
	}{
		{"filter by notifications", "/api/collections/users/records?filter=" + url.QueryEscape(`notify_off ~ "status"`), 400},
		{"filter by language", "/api/collections/users/records?filter=" + url.QueryEscape(`lang = "en"`), 400},
		{"sort by project order", "/api/collections/users/records?sort=project_order", 400},
		{"filter through a relation", "/api/collections/tasks/records?filter=" + url.QueryEscape(`assignee.lang = "en"`), 400},
		{"the word in a value", "/api/collections/users/records?filter=" + url.QueryEscape(`name ~ "lang"`), 200},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, asAlice, http.MethodGet, c.path, ""); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}
}

func TestOnlyUsedRoutesAnswer(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()
	h := testutil.Handler(t, app)
	asAlice := testutil.Token(t, testutil.User(t, app, "440000003", "member"))

	for _, path := range []string{
		"/_/", "/api/settings", "/api/logs", "/api/backups", "/api/crons", "/api/sql", "/api/files/token",
		"/api/collections", "/api/collections/tasks", "/api/collections/_superusers/auth-with-password",
		"/api/collections/users/request-email-change", "/api/collections/users/request-password-reset",
		"/api/collections/users/request-otp", "/api/collections/users/impersonate/x", "/api/oauth2-redirect",
	} {
		if status, _ := testutil.Do(t, h, asAlice, http.MethodPost, path, "{}"); status != 404 {
			t.Errorf("POST %s: %d, want 404", path, status)
		}
	}
	for _, path := range []string{
		"/api/health", "/api/myboard/me", "/api/collections/users/auth-methods", "/api/collections/tasks/records",
	} {
		if status, body := testutil.Do(t, h, asAlice, http.MethodGet, path, ""); status != 200 {
			t.Errorf("GET %s: %d, want 200 (%v)", path, status, body)
		}
	}
}

func TestBatchOnlyReorders(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()
	app.Settings().Batch.Enabled = true
	app.Settings().Batch.MaxRequests = 10

	alice := testutil.User(t, app, "440000004", "member")
	p := testutil.Project(t, app, "BAT", alice)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "one"})
	h := testutil.Handler(t, app)
	asAlice := testutil.Token(t, alice)
	records := "/api/collections/tasks/records"

	batch := func(method, url, body string) int {
		status, _ := testutil.Do(t, h, asAlice, http.MethodPost, "/api/batch",
			`{"requests":[{"method":"`+method+`","url":"`+url+`","body":`+body+`}]}`)
		return status
	}
	cases := []struct {
		name, method, url, body string
		status                  int
	}{
		{"reorder", "PATCH", records + "/" + task.Id, `{"position":5}`, 200},
		{"status change", "PATCH", records + "/" + task.Id, `{"status":"done"}`, 400},
		{"position with more", "PATCH", records + "/" + task.Id, `{"position":6,"assignee":""}`, 400},
		{"query string", "PATCH", records + "/" + task.Id + "?expand=project", `{"position":7}`, 400},
		{"create", "POST", records, `{"project":"` + p.Id + `","title":"x"}`, 400},
		{"delete", "DELETE", records + "/" + task.Id, `{}`, 400},
		{"another collection", "PATCH", "/api/collections/projects/records/" + p.Id, `{"position":1}`, 400},
	}
	for _, c := range cases {
		if status := batch(c.method, c.url, c.body); status != c.status {
			t.Errorf("%s: %d, want %d", c.name, status, c.status)
		}
	}
}
