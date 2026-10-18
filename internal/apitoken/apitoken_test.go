package apitoken_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/nessshon/myboard/internal/apitoken"
	"github.com/nessshon/myboard/internal/testutil"
)

func TestTokens(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	alice := testutil.User(t, app, "500000001", "member")
	testutil.Project(t, app, "TOK", alice)
	h := testutil.Handler(t, app)

	if status, _ := testutil.Do(t, h, "", http.MethodPost, "/api/myboard/tokens", `{"name":"x"}`); status != 401 {
		t.Fatalf("anonymous token creation: %d, want 401", status)
	}

	status, created := testutil.Do(t, h, testutil.Token(t, alice), http.MethodPost, "/api/myboard/tokens", `{"name":"claude"}`)
	if status != 200 {
		t.Fatalf("create: %d %v", status, created)
	}
	token := created["token"].(string)
	if !strings.HasPrefix(token, apitoken.Prefix) || created["hint"] != token[len(token)-4:] {
		t.Fatalf("unexpected token shape: %v", created)
	}

	stored, err := app.FindRecordById("api_tokens", created["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.GetString("hash"), token) {
		t.Fatal("the raw token must not be stored")
	}

	bearer := "Bearer " + token
	if status, body := testutil.Do(t, h, bearer, http.MethodGet, "/api/collections/projects/records", ""); status != 200 || body["totalItems"] != float64(1) {
		t.Fatalf("token must act as its user: %d %v", status, body)
	}
	status, list := testutil.Do(t, h, bearer, http.MethodGet, "/api/collections/api_tokens/records", "")
	items, _ := list["items"].([]any)
	if status != 200 || len(items) != 1 {
		t.Fatalf("own token list: %d %v", status, list)
	}
	if _, exposed := items[0].(map[string]any)["hash"]; exposed {
		t.Fatal("token list must not expose hashes")
	}
	if status, body := testutil.Do(t, h, bearer, http.MethodPost, "/api/myboard/tokens", `{"name":"more"}`); status != 403 {
		t.Fatalf("a token minting a token: %d, want 403 (%v)", status, body)
	}
	if status, _ := testutil.Do(t, h, "Bearer mbt_wrong", http.MethodGet, "/api/collections/projects/records", ""); status != 401 {
		t.Fatalf("unknown token: %d, want 401", status)
	}

	own := "/api/collections/api_tokens/records/" + stored.Id
	if status, body := testutil.Do(t, h, bearer, http.MethodDelete, own, ""); status != 403 {
		t.Fatalf("a token revoking a token: %d, want 403 (%v)", status, body)
	}
	if status, body := testutil.Do(t, h, testutil.Token(t, alice), http.MethodDelete, own, ""); status != 204 {
		t.Fatalf("revoking from a session: %d, want 204 (%v)", status, body)
	}
	if status, _ := testutil.Do(t, h, bearer, http.MethodGet, "/api/collections/projects/records", ""); status != 401 {
		t.Fatalf("revoked token: %d, want 401", status)
	}
}
