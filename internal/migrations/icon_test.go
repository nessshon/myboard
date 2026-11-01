package migrations_test

import (
	"bytes"
	"image"
	"image/gif"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

func TestProjectIcon(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "250000001", "member")
	admin := testutil.User(t, app, "250000002", "admin")
	p := testutil.Project(t, app, "ICO", alice)
	h := testutil.Handler(t, app)
	asAlice, asAdmin := testutil.Token(t, alice), testutil.Token(t, admin)
	url := "/api/collections/projects/records/" + p.Id

	var picture, animation bytes.Buffer
	frame := image.NewRGBA(image.Rect(0, 0, 8, 4))
	if err := png.Encode(&picture, frame); err != nil {
		t.Fatal(err)
	}
	if err := gif.Encode(&animation, frame, nil); err != nil {
		t.Fatal(err)
	}
	logo := picture.Bytes()

	refused := []struct {
		name, token, filename string
		content               []byte
		status                int
	}{
		{"a member cannot set it", asAlice, "logo.png", logo, 404},
		{"no SVG", asAdmin, "logo.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), 400},
		{"no GIF", asAdmin, "logo.gif", animation.Bytes(), 400},
		{"not over 5 MB", asAdmin, "big.png", append(logo, make([]byte, 5<<20)...), 400},
	}
	for _, c := range refused {
		if status, body := form(t, h, http.MethodPatch, url, c.token, nil, "icon", c.filename, c.content); status != c.status {
			t.Errorf("%s: status %d, want %d (%v)", c.name, status, c.status, body)
		}
	}

	status, set := form(t, h, http.MethodPatch, url, asAdmin, nil, "icon", "logo.png", logo)
	if status != 200 || set["icon"] == "" {
		t.Fatalf("an admin sets it: %d %v", status, set)
	}
	// Open: no file token, as a browser asks for it in an <img>.
	file := "/api/files/projects/" + p.Id + "/" + set["icon"].(string)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, file+"?thumb=96x96", nil))
	if got, _, err := image.DecodeConfig(rec.Body); rec.Code != 200 || err != nil || got.Width != 96 || got.Height != 96 {
		t.Fatalf("a wide picture's thumb is a 96px square: %d %v %v", rec.Code, got, err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, file, nil))
	if rec.Code != 404 {
		t.Errorf("the original, which may carry a photo's EXIF, is served: %d", rec.Code)
	}

	if status, body := testutil.Do(t, h, asAdmin, http.MethodPatch, url, `{"icon":""}`); status != 200 || body["icon"] != "" {
		t.Fatalf("an admin clears it: %d %v", status, body)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, file+"?thumb=96x96", nil))
	if rec.Code != 404 {
		t.Errorf("a cleared icon's file is still served: %d", rec.Code)
	}

	made := map[string]string{"name": "New", "key": "NEW"}
	if status, body := form(t, h, http.MethodPost, "/api/collections/projects/records", asAdmin, made, "icon", "logo.png", logo); status != 200 || body["icon"] == "" {
		t.Errorf("a project is made with its icon in one request: %d %v", status, body)
	}
}

func TestProjectIconRollBack(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	p := testutil.Project(t, app, "IRB")
	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	logo, err := filesystem.NewFileFromBytes(picture.Bytes(), "logo.png")
	if err != nil {
		t.Fatal(err)
	}
	p.Set("icon", logo)
	if err := app.Save(p); err != nil {
		t.Fatal(err)
	}
	path := p.BaseFilesPath() + "/" + p.GetString("icon")

	items := core.AppMigrations.Items()
	back := 0
	for i, m := range items {
		if m.File == "1793750400_project_icon.go" {
			back = len(items) - i
		}
	}
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := runner.Down(back); err != nil {
		t.Fatal(err)
	}
	fsys, err := app.NewFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer fsys.Close()
	if left, err := fsys.Exists(path); err != nil || left {
		t.Fatalf("the rollback leaves the icon's file on disk (%v)", err)
	}
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
}
