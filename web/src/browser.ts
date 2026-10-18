import { useSyncExternalStore } from "react";

const phone = matchMedia("(max-width: 640px)");
const subscribe = (f: () => void) => {
  phone.addEventListener("change", f);
  return () => phone.removeEventListener("change", f);
};

export const usePhone = () => useSyncExternalStore(subscribe, () => phone.matches);

export const copyText = (text: string) => navigator.clipboard?.writeText(text) ?? Promise.reject();

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
