package main

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"testing/fstest"
)

func TestPolicyAllowsOnlyTheInlineThemeScript(t *testing.T) {
	script := `document.documentElement.dataset.theme = "dark";`
	dist := fstest.MapFS{"index.html": {Data: []byte("<head><script>" + script + "</script></head>")}}
	sum := sha256.Sum256([]byte(script))

	csp := contentSecurityPolicy(dist)
	if !strings.Contains(csp, "script-src 'self' 'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'") {
		t.Errorf("the theme script must be allowed by its hash: %s", csp)
	}
	if script := strings.Split(strings.Split(csp, "script-src ")[1], ";")[0]; strings.Contains(script, "unsafe-inline") {
		t.Errorf("scripts must not allow unsafe-inline: %s", script)
	}
}

func TestBuiltFilesPointAtThisInstance(t *testing.T) {
	dist := fstest.MapFS{
		"index.html": {Data: []byte(`<meta property="og:image" content="https://example.com/og.png" />`)},
		"llms.txt":   {Data: []byte("MB=https://example.com")},
	}
	if got := string(withOrigin(dist, "index.html", "https://tasks.example.org")); got != `<meta property="og:image" content="https://tasks.example.org/og.png" />` {
		t.Errorf("index.html: %s", got)
	}
	if got := string(withOrigin(dist, "llms.txt", "https://tasks.example.org")); got != "MB=https://tasks.example.org" {
		t.Errorf("llms.txt: %s", got)
	}
	if withOrigin(dist, "missing.txt", "https://x") != nil {
		t.Error("a missing file must give nil")
	}
	if !isFile(dist, "/llms.txt") || isFile(dist, "/") || isFile(dist, "/p/app") {
		t.Error("isFile must match only files in the build")
	}
}

func TestBootStateStaysData(t *testing.T) {
	got := withBoot([]byte("<head><title>x</title></head><body></body>"), boot{Version: "v1", Bot: "</script><script>alert(1)</script>"})
	want := `<head><title>x</title><script type="application/json" id="boot">{"version":"v1","dev":false,"bot":"\u003c/script\u003e\u003cscript\u003ealert(1)\u003c/script\u003e"}</script></head><body></body>`
	if got != want {
		t.Errorf("page:\n%s\nwant:\n%s", got, want)
	}
}
