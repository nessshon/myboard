package config

import (
	"strings"
	"testing"
)

func TestLoadReportsEveryProblem(t *testing.T) {
	t.Setenv("MYBOARD_PUBLIC_URL", "example.com")
	t.Setenv("MYBOARD_ADMIN_TG_ID", "@ness")
	t.Setenv("MYBOARD_TG_CLIENT_ID", "")
	t.Setenv("MYBOARD_TG_CLIENT_SECRET", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, name := range []string{"MYBOARD_PUBLIC_URL", "MYBOARD_ADMIN_TG_ID", "MYBOARD_TG_CLIENT_ID", "MYBOARD_TG_CLIENT_SECRET"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error must name %s: %v", name, err)
		}
	}
}

func TestLoad(t *testing.T) {
	t.Setenv("MYBOARD_PUBLIC_URL", "https://example.com/")
	t.Setenv("MYBOARD_ADMIN_TG_ID", "123456789")
	t.Setenv("MYBOARD_TG_CLIENT_ID", "client")
	t.Setenv("MYBOARD_TG_CLIENT_SECRET", "secret")

	cfg, err := Load()
	if err != nil || cfg.PublicURL != "https://example.com" {
		t.Fatalf("the trailing slash must be trimmed: %q %v", cfg.PublicURL, err)
	}
	if len(cfg.TrustedProxies) != 3 {
		t.Fatalf("the default must trust the host and Docker networks: %v %v", cfg.TrustedProxies, err)
	}

	t.Setenv("MYBOARD_TRUSTED_PROXIES", "10.0.0.2, 192.168.1.0/24")
	if cfg, err = Load(); err != nil || len(cfg.TrustedProxies) != 2 || cfg.TrustedProxies[0].Bits() != 32 {
		t.Fatalf("addresses and ranges: %v %v", cfg.TrustedProxies, err)
	}

	t.Setenv("MYBOARD_TRUSTED_PROXIES", "nginx")
	if _, err = Load(); err == nil || !strings.Contains(err.Error(), "MYBOARD_TRUSTED_PROXIES") {
		t.Fatalf("a name instead of an address must be refused: %v", err)
	}
}
