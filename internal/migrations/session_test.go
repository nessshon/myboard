package migrations_test

import (
	"testing"

	"github.com/nessshon/myboard/internal/testutil"
)

func TestSessionLastsThirtyDays(t *testing.T) {
	app := testutil.NewApp(t)
	defer app.Cleanup()

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	if got := users.AuthToken.Duration; got != 30*24*60*60 {
		t.Fatalf("session lasts %d s, want 30 days", got)
	}
}
