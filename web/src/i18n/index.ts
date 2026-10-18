import { useSyncExternalStore } from "react";
import en from "./en.json";
import ru from "./ru.json";
import { load, save } from "../browser";

type Lang = "ru" | "en";
export type Key = keyof typeof ru;
type Text = string | (Partial<Record<Intl.LDMLPluralRule, string>> & { other: string });

const dicts: Record<Lang, Record<Key, Text>> = { ru, en };
const listeners = new Set<() => void>();

function initial(): Lang {
  const saved = load("mb.lang");
  if (saved === "ru" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let lang = initial();
document.documentElement.lang = lang;

export function setLang(next: Lang) {
  lang = next;
  save("mb.lang", next);
  document.documentElement.lang = next;
  listeners.forEach((f) => f());
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function useLang() {
  return useSyncExternalStore(subscribe, () => lang);
}

export function useT() {
  const l = useLang();
  return (key: Key, vars: Record<string, string | number> = {}) => {
    const v = dicts[l][key];
    const text =
      typeof v === "string"
        ? v
        : (v[new Intl.PluralRules(l).select(Number(vars.count))] ?? v.other);
    return text.replace(/\{(\w+)\}/g, (m, name: string) => String(vars[name] ?? m));
  };
}
