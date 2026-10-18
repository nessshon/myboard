import { useMemo, useSyncExternalStore } from "react";

type Route =
  | { name: "login" | "home" | "my" | "users" | "integrations" | "notFound" }
  | { name: "my" | "home"; task: { key: string; number: number } }
  | { name: "project"; key: string }
  | { name: "task"; key: string; number: number };

const fixed = new Map<string, Route>([
  ["/login", { name: "login" }],
  ["/", { name: "home" }],
  ["/tasks", { name: "my" }],
  ["/users", { name: "users" }],
  ["/integrations", { name: "integrations" }],
]);

function parse(path: string): Route {
  const route = fixed.get(path);
  if (route) return route;
  const my = /^\/tasks\/([a-z][a-z0-9]{1,9})-(\d+)$/.exec(path);
  if (my) return { name: "my", task: { key: my[1], number: Number(my[2]) } };
  const home = /^\/([a-z][a-z0-9]{1,9})-(\d+)$/.exec(path);
  if (home) return { name: "home", task: { key: home[1], number: Number(home[2]) } };
  const m = /^\/p\/([a-z][a-z0-9]{1,9})(?:\/(\d+))?$/.exec(path);
  if (!m) return { name: "notFound" };
  return m[2] ? { name: "task", key: m[1], number: Number(m[2]) } : { name: "project", key: m[1] };
}

function lowerPath(href: string) {
  const url = new URL(href, location.href);
  url.pathname = url.pathname.toLowerCase().replace(/(.)\/+$/, "$1");
  return url.pathname + url.search + url.hash;
}

history.replaceState(history.state, "", lowerPath(location.href));

export function navigate(to: string, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", lowerPath(to));
  dispatchEvent(new PopStateEvent("popstate"));
}

function subscribe(f: () => void) {
  addEventListener("popstate", f);
  return () => removeEventListener("popstate", f);
}

export function useRoute() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  return useMemo(() => parse(path), [path]);
}

document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest("a");
  if (
    !a ||
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    a.target ||
    a.hasAttribute("download") ||
    a.origin !== location.origin ||
    parse(new URL(lowerPath(a.href), location.href).pathname).name === "notFound"
  )
    return;
  e.preventDefault();
  navigate(a.href);
});
