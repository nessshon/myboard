package tasks_test

import (
	"net/http"
	"net/url"
	"sort"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestNumbersAreSequentialUnderConcurrency(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()
	p := testutil.Project(t, app, "NUM")

	collection, err := app.FindCollectionByNameOrId("tasks")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for range 20 {
		wg.Go(func() {
			r := core.NewRecord(collection)
			r.Load(map[string]any{"project": p.Id, "title": "t"})
			errs <- app.Save(r)
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	tasks, err := app.FindAllRecords("tasks")
	if err != nil {
		t.Fatal(err)
	}
	numbers := make([]int, 0, len(tasks))
	for _, r := range tasks {
		numbers = append(numbers, r.GetInt("number"))
	}
	sort.Ints(numbers)
	for i, n := range numbers {
		if n != i+1 {
			t.Fatalf("numbers %v, want 1..20 without gaps or repeats", numbers)
		}
	}
}

func TestTaskRules(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "300000001", "member")
	stranger := testutil.User(t, app, "300000002", "member")
	p := testutil.Project(t, app, "TSK", alice)
	other := testutil.Project(t, app, "OTH", alice)
	foreignLabel := testutil.Record(t, app, "labels", map[string]any{"project": other.Id, "name": "x", "color": "#000000"})
	ownLabel := testutil.Record(t, app, "labels", map[string]any{"project": p.Id, "name": "y", "color": "#000000"})
	h := testutil.Handler(t, app)
	tok := testutil.Token(t, alice)

	status, first := testutil.Do(t, h, tok, http.MethodPost, "/api/collections/tasks/records",
		`{"project":"`+p.Id+`","title":"first","number":999,"author":"`+stranger.Id+`","labels":["`+ownLabel.Id+`"]}`)
	if status != 200 {
		t.Fatalf("create: %d %v", status, first)
	}
	if first["number"] != float64(1) || first["status"] != "todo" || first["priority"] != "normal" || first["author"] != alice.Id {
		t.Fatalf("defaults/number/author not applied: %v", first)
	}

	if status, body := testutil.Do(t, h, tok, http.MethodPost, "/api/collections/tasks/records",
		`{"project":"`+p.Id+`","title":"x","status":"doing"}`); status != 400 {
		t.Fatalf("invalid create: %d, want 400 (%v)", status, body)
	}
	_, second := testutil.Do(t, h, tok, http.MethodPost, "/api/collections/tasks/records", `{"project":"`+p.Id+`","title":"second"}`)
	if second["number"] != float64(2) {
		t.Fatalf("a rejected create must not take a number: %v", second)
	}
	if second["position"].(float64) >= first["position"].(float64) {
		t.Fatalf("a new task must go above existing ones: %v < %v", second["position"], first["position"])
	}

	id := first["id"].(string)
	bad := []struct{ name, body string }{
		{"assignee outside the project", `{"assignees":["` + alice.Id + `","` + stranger.Id + `"]}`},
		{"label from another project", `{"labels":["` + foreignLabel.Id + `"]}`},
		{"moving to another project", `{"project":"` + other.Id + `"}`},
		{"changing the number", `{"number":5}`},
		{"unknown status", `{"status":"doing"}`},
		{"due is not a day", `{"due":"2026-10-15T10:00:00Z"}`},
	}
	for _, c := range bad {
		if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+id, c.body); status != 400 {
			t.Errorf("%s: status %d, want 400 (%v)", c.name, status, body)
		}
	}

	if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+id,
		`{"assignees":["`+alice.Id+`"],"status":"done","due":"2026-10-20"}`); status != 200 {
		t.Fatalf("valid update: %d %v", status, body)
	}
}

func TestNotesGoToTheEnd(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()
	p := testutil.Project(t, app, "NOT")
	a := testutil.Record(t, app, "notes", map[string]any{"project": p.Id, "title": "a"})
	b := testutil.Record(t, app, "notes", map[string]any{"project": p.Id, "title": "b"})
	if b.GetFloat("position") <= a.GetFloat("position") {
		t.Fatalf("positions %v, %v: new note must go last", a.GetFloat("position"), b.GetFloat("position"))
	}
}

// The same for both lists of people: only members may be added, and one who left keeps the task editable.
func TestTaskOfSomeoneWhoLeft(t *testing.T) {
	for _, field := range []string{"assignees", "reviewers"} {
		t.Run(field, func(t *testing.T) {
			app := testutil.NewApp(t)
			defer app.Cleanup()

			alice := testutil.User(t, app, "300000011", "member")
			bob := testutil.User(t, app, "300000012", "member")
			p := testutil.Project(t, app, "LFT", alice, bob)
			task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t", field: []string{bob.Id}})
			p, err := app.FindRecordById("projects", p.Id)
			if err != nil {
				t.Fatal(err)
			}
			p.Set("members-", bob.Id)
			if err := app.Save(p); err != nil {
				t.Fatal(err)
			}
			h := testutil.Handler(t, app)
			tok := testutil.Token(t, alice)

			if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+task.Id, `{"title":"renamed"}`); status != 200 {
				t.Fatalf("edit title: %d %v", status, body)
			}
			if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+task.Id, `{"`+field+`":["`+bob.Id+`"],"title":"again"}`); status != 200 {
				t.Fatalf("resending the same person: %d %v", status, body)
			}
			if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+task.Id, `{"`+field+`":["`+bob.Id+`","`+alice.Id+`"]}`); status != 200 {
				t.Fatalf("adding a member next to one who left: %d %v", status, body)
			}
			other := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "u"})
			if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+other.Id, `{"`+field+`":["`+bob.Id+`"]}`); status != 400 {
				t.Fatalf("setting a non-member: %d, want 400 (%v)", status, body)
			}
			if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+other.Id, `{"`+field+`+":"`+bob.Id+`"}`); status != 400 {
				t.Fatalf("adding a non-member with +: %d, want 400 (%v)", status, body)
			}
			if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+other.Id, `{"`+field+`+":"`+alice.Id+`"}`); status != 200 {
				t.Fatalf("adding a member with +: %d %v", status, body)
			}
			if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+task.Id, `{"`+field+`-":"`+alice.Id+`"}`); status != 200 || len(body[field].([]any)) != 1 {
				t.Fatalf("removing one with -: %d %v", status, body)
			}
		})
	}
}

func TestEditedFollowsContentOnly(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "300000021", "member")
	p := testutil.Project(t, app, "EDT", alice)
	h := testutil.Handler(t, app)
	tok := testutil.Token(t, alice)

	for _, c := range []struct{ collection, create, content string }{
		{"tasks", `{"project":"` + p.Id + `","title":"t","edited":"2020-01-01 00:00:00.000Z"}`, `{"title":"renamed"}`},
		{"notes", `{"project":"` + p.Id + `","title":"n","edited":"2020-01-01 00:00:00.000Z"}`, `{"body":"text"}`},
	} {
		url := "/api/collections/" + c.collection + "/records"
		status, body := testutil.Do(t, h, tok, http.MethodPost, url, c.create)
		if status != 200 || body["edited"] != "" {
			t.Fatalf("%s create: %d, edited %q, want empty", c.collection, status, body["edited"])
		}
		url += "/" + body["id"].(string)
		if _, body := testutil.Do(t, h, tok, http.MethodPatch, url, `{"position":-5000}`); body["edited"] != "" {
			t.Fatalf("%s reorder set edited: %q", c.collection, body["edited"])
		}
		_, body = testutil.Do(t, h, tok, http.MethodPatch, url, c.content)
		edited, _ := body["edited"].(string)
		if edited == "" {
			t.Fatalf("%s content edit left edited empty", c.collection)
		}
		if _, body := testutil.Do(t, h, tok, http.MethodPatch, url, `{"position":7,"edited":"2020-01-01 00:00:00.000Z"}`); body["edited"] != edited {
			t.Fatalf("%s reorder with a forged date: edited %q, want %q", c.collection, body["edited"], edited)
		}
	}
}

func TestFindTasksByAssignee(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "300000021", "member")
	bob := testutil.User(t, app, "300000022", "member")
	p := testutil.Project(t, app, "FND", alice, bob)
	testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "both", "assignees": []string{alice.Id, bob.Id}})
	testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "alice", "assignees": []string{alice.Id}})
	h := testutil.Handler(t, app)

	filter := url.QueryEscape(`assignees.id ?= "` + bob.Id + `"`)
	status, body := testutil.Do(t, h, testutil.Token(t, bob), http.MethodGet, "/api/collections/tasks/records?filter="+filter, "")
	items, _ := body["items"].([]any)
	if status != 200 || len(items) != 1 || items[0].(map[string]any)["title"] != "both" {
		t.Fatalf("bob's tasks: %d %v", status, body)
	}
}

func TestDatesFollowStatus(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "300000031", "member")
	p := testutil.Project(t, app, "DAT", alice)
	h := testutil.Handler(t, app)
	tok := testutil.Token(t, alice)
	const forged = "2020-01-01 00:00:00.000Z"

	url := "/api/collections/tasks/records"
	_, body := testutil.Do(t, h, tok, http.MethodPost, url,
		`{"project":"`+p.Id+`","title":"t","status":"done","started":"`+forged+`","planned":"`+forged+`"}`)
	if body["closed"] == "" || body["closed"] == forged || body["planned"] != body["closed"] || body["started"] != body["closed"] || body["submitted"] != body["closed"] {
		t.Fatalf("created closed, every column dated at once: %q %q %q %q", body["planned"], body["started"], body["submitted"], body["closed"])
	}

	_, body = testutil.Do(t, h, tok, http.MethodPost, url,
		`{"project":"`+p.Id+`","title":"t","status":"in_progress","closed":"`+forged+`"}`)
	url += "/" + body["id"].(string)
	started, _ := body["started"].(string)
	if started == "" || started == forged || body["planned"] != started || body["submitted"] != "" || body["closed"] != "" {
		t.Fatalf("created in progress: planned %q, started %q, closed %q", body["planned"], started, body["closed"])
	}

	for _, step := range []struct {
		patch                               string
		planned, started, submitted, closed string // "kept", "set", or "" for cleared
	}{
		{`{"status":"done"}`, "kept", "kept", "set", "set"},
		{`{"status":"review"}`, "kept", "kept", "kept", ""},
		{`{"title":"renamed","planned":"` + forged + `","started":"` + forged + `","submitted":"` + forged + `","closed":"` + forged + `"}`, "kept", "kept", "kept", "kept"},
		{`{"status":"done"}`, "kept", "kept", "kept", "set"},
		{`{"status":"in_progress"}`, "kept", "kept", "", ""},
		{`{"status":"review"}`, "kept", "kept", "set", ""},
		{`{"status":"in_progress"}`, "kept", "kept", "", ""},
		{`{"status":"todo"}`, "kept", "", "", ""},
		{`{"status":"backlog"}`, "", "", "", ""},
		{`{"status":"review"}`, "set", "set", "set", ""},
	} {
		before := body
		_, body = testutil.Do(t, h, tok, http.MethodPatch, url, step.patch)
		for field, want := range map[string]string{"planned": step.planned, "started": step.started, "submitted": step.submitted, "closed": step.closed} {
			got, _ := body[field].(string)
			ok := map[string]bool{
				"kept": got == before[field],
				"set":  got != "" && got != forged && got >= before[field].(string),
				"":     got == "",
			}[want]
			if !ok {
				t.Fatalf("%s: %s %q, want %q (was %q)", step.patch, field, got, want, before[field])
			}
		}
	}
}
