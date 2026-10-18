package tasks_test

import (
	"net/http"
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
		{"assignee outside the project", `{"assignee":"` + stranger.Id + `"}`},
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
		`{"assignee":"`+alice.Id+`","status":"done","due":"2026-10-20"}`); status != 200 {
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

func TestTaskOfAnAssigneeWhoLeft(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "300000011", "member")
	bob := testutil.User(t, app, "300000012", "member")
	p := testutil.Project(t, app, "LFT", alice, bob)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t", "assignee": bob.Id})
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
	if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+task.Id, `{"assignee":"`+bob.Id+`","title":"again"}`); status != 200 {
		t.Fatalf("resending the same assignee: %d %v", status, body)
	}
	other := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "u"})
	if status, body := testutil.Do(t, h, tok, http.MethodPatch, "/api/collections/tasks/records/"+other.Id, `{"assignee":"`+bob.Id+`"}`); status != 400 {
		t.Fatalf("assigning a non-member: %d, want 400 (%v)", status, body)
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
