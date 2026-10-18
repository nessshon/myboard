package bot

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync/atomic"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/config"
)

var apiBase = "https://api.telegram.org"

const (
	sendInterval = time.Second / 30
	maxAttempts  = 7
	maxBackoff   = 30 * time.Second
)

type Bot struct {
	app       core.App
	token     string
	publicURL string
	client    *http.Client
	queue     chan outgoing
	username  atomic.Value
}

type outgoing struct {
	userID, chatID, text string
}

func Register(app core.App, cfg *config.Config) *Bot {
	if cfg.TelegramBotToken == "" {
		return nil
	}
	b := &Bot{
		app:       app,
		token:     cfg.TelegramBotToken,
		publicURL: cfg.PublicURL,
		client:    &http.Client{Timeout: 10 * time.Second},
		queue:     make(chan outgoing, 1000),
	}
	go b.run()
	b.bindEvents()

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		go b.loadUsername()
		return se.Next()
	})
	return b
}

func (b *Bot) Username() string {
	if b == nil {
		return ""
	}
	name, _ := b.username.Load().(string)
	return name
}

func (b *Bot) loadUsername() {
	var me struct {
		Username string `json:"username"`
	}
	for {
		res, err := b.call("getMe", nil, &me)
		if err == nil {
			b.username.Store(me.Username)
			return
		}
		if res.ErrorCode == http.StatusUnauthorized {
			b.app.Logger().Error("telegram rejected MYBOARD_TG_BOT_TOKEN", "error", err)
			return
		}
		b.app.Logger().Warn("telegram getMe failed", "error", err)
		time.Sleep(time.Minute)
	}
}

func (b *Bot) enqueue(user *core.Record, text string) {
	select {
	case b.queue <- outgoing{userID: user.Id, chatID: user.GetString("tg_id"), text: text}:
	default:
		b.app.Logger().Warn("telegram queue is full, a notification is dropped", "user", user.Id)
	}
}

func (b *Bot) run() {
	tick := time.NewTicker(sendInterval)
	defer tick.Stop()
	for m := range b.queue {
		<-tick.C
		if err := b.deliver(m); err != nil {
			b.app.Logger().Warn("telegram notification failed", "user", m.userID, "error", err)
		}
	}
}

// A 403 (bot blocked or never allowed) marks the person so nothing more is sent.
func (b *Bot) deliver(m outgoing) error {
	body := map[string]any{
		"chat_id":              m.chatID,
		"text":                 m.text,
		"parse_mode":           "HTML",
		"link_preview_options": map[string]bool{"is_disabled": true},
	}
	var err error
	for attempt := range maxAttempts {
		var res response
		res, err = b.call("sendMessage", body, nil)
		switch {
		case err == nil:
			return nil
		case res.ErrorCode == http.StatusForbidden:
			return b.markBlocked(m.userID)
		case res.ErrorCode != 0 && res.ErrorCode < 500 && res.ErrorCode != http.StatusTooManyRequests:
			return err // a bad request will not get better
		case attempt == maxAttempts-1:
			// no wait after the last try
		case res.ErrorCode == http.StatusTooManyRequests:
			time.Sleep(retryAfter(res))
		default:
			time.Sleep(backoff(attempt))
		}
	}
	return err
}

func backoff(attempt int) time.Duration {
	return min(time.Duration(1<<attempt)*time.Second, maxBackoff)
}

// retryAfter is Telegram's wait for a 429, a second when it names none.
func retryAfter(res response) time.Duration {
	if res.Parameters.RetryAfter > 0 {
		return min(time.Duration(res.Parameters.RetryAfter)*time.Second, maxBackoff)
	}
	return time.Second
}

func (b *Bot) markBlocked(userID string) error {
	_, err := b.app.DB().NewQuery("UPDATE users SET bot_blocked = TRUE WHERE id = {:id}").
		Bind(dbx.Params{"id": userID}).Execute()
	if err != nil {
		return fmt.Errorf("mark user %s: %w", userID, err)
	}
	return nil
}

type response struct {
	OK          bool            `json:"ok"`
	Result      json.RawMessage `json:"result"`
	ErrorCode   int             `json:"error_code"`
	Description string          `json:"description"`
	Parameters  struct {
		RetryAfter int `json:"retry_after"`
	} `json:"parameters"`
}

func (b *Bot) call(method string, body any, result any) (response, error) {
	var res response
	payload, err := json.Marshal(body)
	if err != nil {
		return res, fmt.Errorf("encode %s: %w", method, err)
	}
	req, err := http.NewRequest(http.MethodPost, apiBase+"/bot"+b.token+"/"+method, bytes.NewReader(payload))
	if err != nil {
		return res, fmt.Errorf("build %s: bad bot token or API address", method) // the error would carry the URL
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		// The URL carries the token: keep the cause, drop the URL.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return res, fmt.Errorf("%s: %w", method, err)
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		// A proxy's HTML error page: the HTTP status still tells a 429 or a 5xx apart.
		res.ErrorCode = resp.StatusCode
		return res, fmt.Errorf("%s: decode reply (HTTP %d): %w", method, resp.StatusCode, err)
	}
	if !res.OK {
		if res.ErrorCode == 0 {
			res.ErrorCode = resp.StatusCode
		}
		return res, fmt.Errorf("%s: %d %s", method, res.ErrorCode, res.Description)
	}
	if result != nil {
		if err := json.Unmarshal(res.Result, result); err != nil {
			return res, fmt.Errorf("%s: decode result: %w", method, err)
		}
	}
	return res, nil
}
