package migrations_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func upload(t *testing.T, h http.Handler, token string, fields map[string]string, filename string, content []byte) (int, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(content)
	_ = w.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/collections/attachments/records", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestAttachmentRules(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "240000001", "member")
	bob := testutil.User(t, app, "240000002", "member")
	stranger := testutil.User(t, app, "240000003", "member")
	admin := testutil.User(t, app, "240000004", "admin")
	p := testutil.Project(t, app, "ATT", alice, bob)
	task := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "t"})
	other := testutil.Record(t, app, "tasks", map[string]any{"project": p.Id, "title": "other"})
	said := testutil.Record(t, app, "comments", map[string]any{"task": task.Id, "body": "hi", "author": alice.Id})
	elsewhere := testutil.Record(t, app, "comments", map[string]any{"task": other.Id, "body": "hi", "author": alice.Id})
	h := testutil.Handler(t, app)
	asAlice, asBob, asStranger, asAdmin := testutil.Token(t, alice), testutil.Token(t, bob), testutil.Token(t, stranger), testutil.Token(t, admin)

	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	shot := picture.Bytes()
	toTask := map[string]string{"task": task.Id}

	status, made := upload(t, h, asBob, map[string]string{"task": task.Id, "author": alice.Id, "name": "x", "size": "1"}, "Скриншот 29 октября.png", shot)
	if status != 200 || made["author"] != bob.Id || made["name"] != "Скриншот 29 октября.png" || made["size"] != float64(len(shot)) {
		t.Fatalf("a member attaches a file and the server sets author, name and size: %d %v", status, made)
	}
	records := "/api/collections/attachments/records"
	bobs := records + "/" + made["id"].(string)

	uploads := []struct {
		name, token string
		fields      map[string]string
		filename    string
		content     []byte
		status      int
	}{
		{"a stranger cannot attach", asStranger, toTask, "a.png", shot, 400},
		{"a page is not a file one may attach", asAlice, toTask, "page.html", []byte("<!doctype html><script>alert(1)</script>"), 400},
		{"a text file is fine", asAlice, toTask, "логи.txt", []byte("started\nstopped\n"), 200},
		{"not to someone else's comment", asBob, map[string]string{"task": task.Id, "comment": said.Id}, "a.png", shot, 400},
		{"not to a comment of another task", asAlice, map[string]string{"task": task.Id, "comment": elsewhere.Id}, "a.png", shot, 400},
		{"the author attaches to their comment", asAlice, map[string]string{"task": task.Id, "comment": said.Id}, "a.png", shot, 200},
	}
	for _, c := range uploads {
		if status, body := upload(t, h, c.token, c.fields, c.filename, c.content); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}

	cases := []struct {
		name, token, method, url, body string
		status                         int
	}{
		{"a stranger cannot see it", asStranger, http.MethodGet, bobs, "", 404},
		{"nobody changes it", asBob, http.MethodPatch, bobs, `{"name":"other.png"}`, 403},
		{"another member cannot delete it", asAlice, http.MethodDelete, bobs, "", 404},
		{"other file paths stay closed", asAlice, http.MethodGet, "/api/files/users/" + alice.Id + "/x.png", "", 404},
	}
	for _, c := range cases {
		if status, body := testutil.Do(t, h, c.token, c.method, c.url, c.body); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}

	fileURL := "/api/files/attachments/" + made["id"].(string) + "/" + made["file"].(string)
	get := func(token, url string) *httptest.ResponseRecorder {
		_, issued := testutil.Do(t, h, token, http.MethodPost, "/api/files/token", "")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url+"?thumb=0x192&token="+issued["token"].(string), nil))
		return rec
	}
	if rec := get(asAlice, fileURL); rec.Code != 200 {
		t.Errorf("a member gets the thumb: %d", rec.Code)
	}
	if rec := get(asStranger, fileURL); rec.Code != 404 {
		t.Errorf("a stranger's file token opens the file: %d", rec.Code)
	}
	_, issued := testutil.Do(t, h, asAlice, http.MethodPost, "/api/files/token", "")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, fileURL+"?download=1&token="+issued["token"].(string), nil))
	if got := rec.Header().Get("Content-Disposition"); rec.Code != 200 || !strings.Contains(got, "Скриншот 29 октября.png") {
		t.Errorf("a download keeps the original name: %d %q", rec.Code, got)
	}

	if status, own := upload(t, h, asBob, toTask, "draft.txt", []byte("draft")); status == 200 {
		if status, body := testutil.Do(t, h, asBob, http.MethodDelete, records+"/"+own["id"].(string), ""); status != 204 {
			t.Errorf("the uploader deletes it: %d %v", status, body)
		}
	} else {
		t.Errorf("a member attaches a text file: %d %v", status, own)
	}
	if status, body := testutil.Do(t, h, asAdmin, http.MethodDelete, bobs, ""); status != 204 {
		t.Errorf("an admin deletes it: %d %v", status, body)
	}
	if err := app.Delete(said); err != nil {
		t.Fatal(err)
	}
	if left, err := app.CountRecords("attachments"); err != nil || left != 1 {
		t.Fatalf("deleting a comment leaves its files: %d left (%v)", left, err)
	}
	if err := app.Delete(task); err != nil {
		t.Fatal(err)
	}
	if left, err := app.CountRecords("attachments"); err != nil || left != 0 {
		t.Fatalf("deleting the task leaves %d files (%v)", left, err)
	}
}
