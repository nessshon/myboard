import { useState } from "react";
import { flushSync } from "react-dom";
import { useT } from "../i18n";
import { save } from "../browser";
import { Icon } from "./Icon";
import s from "./ThemeSwitch.module.css";

export function ThemeSwitch() {
  const t = useT();
  const root = document.documentElement;
  const [dark, setDark] = useState(root.dataset.theme === "dark");

  // Buttons and cards ease their colours on hover; left on during a theme switch they lag behind
  // the rest of the page and flicker. Transitions are cut for the switch, and where the browser
  // has view transitions the whole page cross-fades instead.
  function toggle() {
    const next = dark ? "light" : "dark";
    const apply = () => {
      root.dataset.switching = "";
      root.dataset.theme = next;
      flushSync(() => setDark(!dark));
      requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.switching));
    };
    save("mb.theme", next);
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }

  return (
    <button
      type="button"
      className={`${s.sw} ${dark ? s.on : ""}`}
      aria-label={t("header.toggleTheme")}
      title={t("header.toggleTheme")}
      onClick={toggle}
    >
      <span className={s.knob}>
        {dark ? (
          <Icon name="moon" size={13} className={s.moon} />
        ) : (
          <Icon name="sun" size={14} strokeWidth={2.5} className={s.sun} />
        )}
      </span>
    </button>
  );
}
