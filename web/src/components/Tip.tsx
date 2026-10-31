import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import s from "./Tip.module.css";

type Props = {
  tip: ReactNode;
  children: (describedBy: string) => ReactNode;
};

export function Tip({ tip, children }: Props) {
  const id = useId();
  // A phone has no hover: a long press shows the tip, the next touch anywhere hides it, and the press does not count
  // as a tap on what was held.
  const [held, setHeld] = useState(false);
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; held: boolean }>({ held: false });
  useEffect(() => {
    if (!held) return;
    const hide = () => setHeld(false);
    const later = setTimeout(() => document.addEventListener("touchstart", hide, { once: true }));
    return () => {
      clearTimeout(later);
      document.removeEventListener("touchstart", hide);
    };
  }, [held]);
  const release = () => clearTimeout(press.current.timer);
  // The tip moves left just enough for the widest it can be (the .tip max-width) to stay 8px off the right edge, and
  // opens below when the window it scrolls in has no room for it above.
  const place = (e: { currentTarget: HTMLElement }) => {
    const wrap = e.currentTarget;
    const widest = Math.min(240, innerWidth - 16);
    const { left, top } = wrap.getBoundingClientRect();
    wrap.style.setProperty("--shift", `${Math.min(0, innerWidth - 8 - widest - left)}px`);
    const tip = wrap.lastElementChild as HTMLElement;
    tip.style.display = "flex";
    const room = top - (wrap.closest("dialog")?.getBoundingClientRect().top ?? 0);
    wrap.toggleAttribute("data-below", room < tip.offsetHeight + 6);
    tip.style.display = "";
  };
  return (
    <span
      className={s.wrap}
      data-held={held || undefined}
      onPointerEnter={place}
      onFocus={place}
      onTouchStart={() => {
        press.current.held = false;
        press.current.timer = setTimeout(() => {
          press.current.held = true;
          setHeld(true);
        }, 400);
      }}
      // Cancelling the touch's end cancels the click it would make.
      onTouchEnd={(e) => {
        release();
        if (press.current.held) e.preventDefault();
      }}
      onTouchMove={release}
      onTouchCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children(id)}
      <span id={id} role="tooltip" className={s.tip}>
        {tip}
      </span>
    </span>
  );
}
