import { useEffect, useRef, useState } from "react";
import s from "./Toast.module.css";

const listeners = new Set<(text: string) => void>();

export function toast(text: string) {
  listeners.forEach((f) => f(text));
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // An open <dialog> sits in the top layer above any z-index; a popover shown after it lands above
  // it, so every new toast re-shows the stack.
  useEffect(() => {
    const el = ref.current!;
    if (el.matches(":popover-open")) el.hidePopover();
    if (items.length) el.showPopover();
  }, [items.length]);

  useEffect(() => {
    let seq = 0;
    const add = (text: string) => {
      const id = ++seq;
      setItems((xs) => [...xs, { id, text }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  return (
    <div ref={ref} className={s.stack} role="status" popover="manual">
      {items.map((x) => (
        <div key={x.id} className={s.toast}>
          {x.text}
        </div>
      ))}
    </div>
  );
}
