package config

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strings"
)

type Config struct {
	PublicURL        string
	AdminTelegramID  string
	TelegramClientID string
	TelegramSecret   string
	TelegramBotToken string
	TrustedProxies   []netip.Prefix
}

const defaultTrustedProxies = "127.0.0.1,::1,172.16.0.0/12"
const TelegramIDPattern = `^[1-9][0-9]{0,15}$`

var TelegramID = regexp.MustCompile(TelegramIDPattern)

func Load() (*Config, error) {
	cfg := &Config{
		PublicURL:        strings.TrimRight(os.Getenv("MYBOARD_PUBLIC_URL"), "/"),
		AdminTelegramID:  os.Getenv("MYBOARD_ADMIN_TG_ID"),
		TelegramClientID: os.Getenv("MYBOARD_TG_CLIENT_ID"),
		TelegramSecret:   os.Getenv("MYBOARD_TG_CLIENT_SECRET"),
		TelegramBotToken: strings.TrimSpace(os.Getenv("MYBOARD_TG_BOT_TOKEN")),
	}

	var errs []error
	if u, err := url.Parse(cfg.PublicURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		errs = append(errs, fmt.Errorf("MYBOARD_PUBLIC_URL must be an absolute http(s) URL, got %q", cfg.PublicURL))
	}
	if !TelegramID.MatchString(cfg.AdminTelegramID) {
		errs = append(errs, fmt.Errorf("MYBOARD_ADMIN_TG_ID must be a numeric Telegram user id, got %q", cfg.AdminTelegramID))
	}
	if cfg.TelegramClientID == "" {
		errs = append(errs, errors.New("MYBOARD_TG_CLIENT_ID is required"))
	}
	if cfg.TelegramSecret == "" {
		errs = append(errs, errors.New("MYBOARD_TG_CLIENT_SECRET is required"))
	}
	proxies := os.Getenv("MYBOARD_TRUSTED_PROXIES")
	if proxies == "" {
		proxies = defaultTrustedProxies
	}
	for _, s := range strings.Split(proxies, ",") {
		s = strings.TrimSpace(s)
		prefix, err := netip.ParsePrefix(s)
		if addr, aerr := netip.ParseAddr(s); err != nil && aerr == nil {
			prefix, err = addr.Prefix(addr.BitLen())
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("MYBOARD_TRUSTED_PROXIES must list IP addresses or CIDR ranges, got %q", s))
			continue
		}
		cfg.TrustedProxies = append(cfg.TrustedProxies, prefix)
	}

	return cfg, errors.Join(errs...)
}
