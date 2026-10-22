package bot

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nessshon/myboard/internal/testutil"
)

type fakeTelegram struct {
	mu     sync.Mutex
	sent   map[string][]string
	refuse map[string]bool
	busy   map[string]bool
}

func (f *fakeTelegram) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChatID string `json:"chat_id"`
		Text   string `json:"text"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case !strings.HasSuffix(r.URL.Path, "/sendMessage"):
		_, _ = w.Write([]byte(`{"ok":true,"result":{"username":"myboard_test_bot"}}`))
	case f.refuse[body.ChatID]:
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"ok":false,"error_code":403,"description":"Forbidden: bot was blocked by the user"}`))
	case f.busy[body.ChatID]:
		delete(f.busy, body.ChatID)
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"ok":false,"error_code":429,"description":"Too Many Requests","parameters":{"retry_after":1}}`))
	default:
		f.sent[body.ChatID] = append(f.sent[body.ChatID], body.Text)
		_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
	}
}

func (f *fakeTelegram) texts(chat string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.sent[chat]...)
}

func (f *fakeTelegram) waitFor(t *testing.T, chat string, n int) []string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if got := f.texts(chat); len(got) >= n {
			return got
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("chat %s: want %d messages, got %v", chat, n, f.texts(chat))
	return nil
}

func TestNotifications(t *testing.T) {
	fake := &fakeTelegram{sent: map[string][]string{}, refuse: map[string]bool{"300000005": true}, busy: map[string]bool{"300000002": true}}
	server := httptest.NewServer(fake)
	defer server.Close()
	apiBase = server.URL

	app := testutil.NewApp(t)
	defer app.Cleanup()
	cfg := *testutil.Config
	cfg.TelegramBotToken = "123:test"
	Register(app, &cfg)
	h := testutil.Handler(t, app)

	alice := testutil.User(t, app, "300000001", "member")
	bob := testutil.User(t, app, "300000002", "member")
	carol := testutil.User(t, app, "300000003", "member")
	dave := testutil.User(t, app, "300000004", "member")
	erin := testutil.User(t, app, "300000005", "member")
	admin := testutil.User(t, app, "300000009", "admin")
	dave.Set("notify_off", []string{kindAssigned})
	if err := app.Save(dave); err != nil {
		t.Fatal(err)
	}
	p := testutil.Project(t, app, "NTF", alice, bob, dave, erin)
	aliceTok, bobTok := testutil.Token(t, alice), testutil.Token(t, bob)

	status, body := testutil.Do(t, h, aliceTok, http.MethodPost, "/api/collections/tasks/records",
		`{"project":"`+p.Id+`","title":"Fix <login>","assignees":["`+bob.Id+`"],"due":"2026-10-20"}`)
	if status != 200 {
		t.Fatalf("create: %d %v", status, body)
	}
	task := "/api/collections/tasks/records/" + body["id"].(string)
	got := fake.waitFor(t, "300000002", 1)
	for _, want := range []string{"Вам назначена задача", "Fix &lt;login&gt;", "/p/ntf/1", "NTF-1", "20 октября", "Кто:"} {
		if !strings.Contains(got[0], want) {
			t.Fatalf("assigned message lacks %q:\n%s", want, got[0])
		}
	}

	testutil.Do(t, h, aliceTok, http.MethodPatch, task, `{"position":-1}`)
	if status, body := testutil.Do(t, h, bobTok, http.MethodPatch, task, `{"status":"done"}`); status != 200 {
		t.Fatalf("status: %d %v", status, body)
	}
	got = fake.waitFor(t, "300000001", 1)
	if !strings.Contains(got[0], "Задача выполнена") || !strings.Contains(got[0], "К работе → Готово") {
		t.Fatalf("status message:\n%s", got[0])
	}

	testutil.Do(t, h, aliceTok, http.MethodPatch, task, `{"assignees":["`+dave.Id+`"]}`)
	testutil.Do(t, h, aliceTok, http.MethodPatch, task, `{"assignees":["`+erin.Id+`"]}`)
	deadline := time.Now().Add(5 * time.Second)
	for {
		fresh, err := app.FindRecordById("users", erin.Id)
		if err != nil {
			t.Fatal(err)
		}
		if fresh.GetBool("bot_blocked") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("a refused message did not mark the user")
		}
		time.Sleep(20 * time.Millisecond)
	}

	members := `{"members":["` + alice.Id + `","` + bob.Id + `","` + dave.Id + `","` + erin.Id + `","` + carol.Id + `"]}`
	if status, body := testutil.Do(t, h, testutil.Token(t, admin), http.MethodPatch, "/api/collections/projects/records/"+p.Id, members); status != 200 {
		t.Fatalf("add member: %d %v", status, body)
	}
	if got := fake.waitFor(t, "300000003", 1); !strings.Contains(got[0], "Вас добавили в проект") {
		t.Fatalf("added message:\n%s", got[0])
	}

	_, shared := testutil.Do(t, h, aliceTok, http.MethodPost, "/api/collections/tasks/records",
		`{"project":"`+p.Id+`","title":"Pair","assignees":["`+bob.Id+`","`+carol.Id+`"]}`)
	testutil.Do(t, h, aliceTok, http.MethodPatch, "/api/collections/tasks/records/"+shared["id"].(string), `{"status":"in_progress"}`)
	for _, chat := range []string{"300000002", "300000003"} {
		got := fake.waitFor(t, chat, 3)
		if !strings.Contains(got[1], "Вам назначена задача") || !strings.Contains(got[2], "Задача взята в работу") {
			t.Fatalf("each assignee hears both:\n%s", strings.Join(got, "\n---\n"))
		}
	}

	alice.Set("lang", "en")
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}
	_, created := testutil.Do(t, h, bobTok, http.MethodPost, "/api/myboard/tokens", `{"name":"agent"}`)
	if status, body := testutil.Do(t, h, "Bearer "+created["token"].(string), http.MethodPatch, task, `{"status":"cancelled"}`); status != 200 {
		t.Fatalf("status via token: %d %v", status, body)
	}
	got = fake.waitFor(t, "300000001", 2)
	if !strings.Contains(got[1], "Task cancelled") || !strings.Contains(got[1], "Done → Cancelled") || !strings.Contains(got[1], "(API)") {
		t.Fatalf("agent's status message in English:\n%s", got[1])
	}

	if n := len(fake.texts("300000001")); n != 2 {
		t.Fatalf("alice got %d messages, want 2 (her own actions and the reorder send nothing)", n)
	}
	if n := len(fake.texts("300000004")); n != 0 {
		t.Fatalf("dave turned assignments off but got %d messages", n)
	}
	if n := len(fake.texts("300000002")); n != 3 {
		t.Fatalf("bob got %d messages, want 3 (the status he set himself is not sent)", n)
	}
}

func TestCommentNotifications(t *testing.T) {
	fake := &fakeTelegram{sent: map[string][]string{}}
	server := httptest.NewServer(fake)
	defer server.Close()
	apiBase = server.URL

	app := testutil.NewApp(t)
	defer app.Cleanup()
	cfg := *testutil.Config
	cfg.TelegramBotToken = "123:test"
	Register(app, &cfg)
	h := testutil.Handler(t, app)

	alice := testutil.User(t, app, "310000001", "member")
	bob := testutil.User(t, app, "310000002", "member")
	carol := testutil.User(t, app, "310000003", "member")
	dave := testutil.User(t, app, "310000004", "member")
	p := testutil.Project(t, app, "CMT", alice, bob, carol, dave)
	aliceTok, carolTok, daveTok := testutil.Token(t, alice), testutil.Token(t, carol), testutil.Token(t, dave)

	_, task := testutil.Do(t, h, aliceTok, http.MethodPost, "/api/collections/tasks/records",
		`{"project":"`+p.Id+`","title":"Login","assignees":["`+bob.Id+`"]}`)
	fake.waitFor(t, "310000002", 1)
	comment := func(tok, body string) {
		if status, got := testutil.Do(t, h, tok, http.MethodPost, "/api/collections/comments/records",
			`{"task":"`+task["id"].(string)+`","body":"`+body+`"}`); status != 200 {
			t.Fatalf("comment: %d %v", status, got)
		}
	}

	comment(daveTok, "Is **this** <done>?")
	alicesFirst := fake.waitFor(t, "310000001", 1)[0]
	for _, want := range []string{"Новый комментарий", "/p/cmt/1", "<b>user 310000004:</b>", "<blockquote>Is this &lt;done&gt;?</blockquote>"} {
		if !strings.Contains(alicesFirst, want) {
			t.Fatalf("comment message lacks %q:\n%s", want, alicesFirst)
		}
	}
	fake.waitFor(t, "310000002", 2)

	comment(carolTok, "Yes")
	fake.waitFor(t, "310000004", 1)
	fake.waitFor(t, "310000001", 2)
	fake.waitFor(t, "310000002", 3)
	if n := len(fake.texts("310000003")); n != 0 {
		t.Fatalf("carol got %d messages about her own comment", n)
	}
	if n := len(fake.texts("310000004")); n != 1 {
		t.Fatalf("dave got %d messages, want 1 (his own comment is not sent)", n)
	}
}

func TestCommentQuote(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"**bold**, `code` and [a link](https://x) ![pic](https://y)", "bold, code and a link pic"},
		{"- [ ] first\n+ second\n\n\n\nnext", "first\nsecond\n\nnext"},
		{"# Title\n> quoted\nissue #12, a > b, <tag>", "Title\nquoted\nissue #12, a > b, <tag>"},
		{"snake_case stays, _em_ and __init__ go", "snake_case stays, em and init go"},
	} {
		if got := plain(c.in); got != c.want {
			t.Errorf("plain(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	long := strings.Repeat("word ", 100)
	if got := cut(long, quoteLen); !strings.HasSuffix(got, "word…") || len([]rune(got)) > quoteLen+1 {
		t.Errorf("cut: %q", got)
	}
	if got := cut("short", quoteLen); got != "short" {
		t.Errorf("cut of a short text: %q", got)
	}
}
