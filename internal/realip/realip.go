package realip

import (
	"net"
	"net/netip"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"

	"github.com/nessshon/myboard/config"
)

const Header = "X-Real-IP"

func Register(app core.App, cfg *config.Config) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// PocketBase believes the header from anyone (core/event_request.go, RealIP), so the
		// middleware below decides who may send it.
		se.App.Settings().TrustedProxy.Headers = []string{Header}
		se.Router.Bind(&hook.Handler[*core.RequestEvent]{
			Id:       "myboardRealIP",
			Priority: apis.DefaultRateLimitMiddlewarePriority - 1, // before the rate limiter reads the address
			Func: func(e *core.RequestEvent) error {
				if !trusted(e.Request.RemoteAddr, cfg.TrustedProxies) {
					e.Request.Header.Del(Header)
				}
				return e.Next()
			},
		})
		return se.Next()
	})
}

func trusted(remoteAddr string, proxies []netip.Prefix) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	for _, p := range proxies {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
