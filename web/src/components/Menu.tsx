import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import s from "./Menu.module.css";

type Props = {
  label: string;
  trigger: ReactNode;
  triggerClass?: string;
  align?: "left" | "right";
  children: ReactNode;
};

export function Menu({ label, trigger, triggerClass, align = "right", children }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const items = () => [
    ...menu.current!.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'),
  ];
  function walk(e: KeyEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    list[(next + list.length) % list.length]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const top = menu.current!.getBoundingClientRect().top;
    menu.current!.style.maxHeight = `${Math.max(160, innerHeight - top - 12)}px`;
    items()[0]?.focus();
    const away = (e: PointerEvent) => {
      if (!wrap.current!.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current!.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={wrap} className={s.wrap}>
      <button
        ref={button}
        type="button"
        className={triggerClass}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className={`${s.menu} ${align === "left" ? s.left : ""}`}
          onClick={(e) => {
            if (!(e.target as Element).closest('[role="menuitemcheckbox"]')) setOpen(false);
          }}
          onKeyDown={walk}
        >
          {children}
        </div>
      )}
    </div>
  );
}

type ItemProps = {
  icon: IconName;
  onClick?: () => void;
  danger?: boolean;
  children: ReactNode;
};

export function MenuItem({ icon, onClick, danger, children }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${s.item} ${danger ? s.danger : ""}`}
      onClick={onClick}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}

type CheckProps = {
  checked: boolean;
  onClick: () => void;
  icon?: ReactNode;
  count?: number;
  children: ReactNode;
};

export function MenuCheck({ checked, onClick, icon, count, children }: CheckProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={s.item}
      onClick={onClick}
    >
      <span className="tick" aria-hidden="true">
        <Icon name="check" size={12} strokeWidth={3} />
      </span>
      {icon}
      <span className={`ellipsis ${s.text}`}>{children}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className={s.sep} />;
}
