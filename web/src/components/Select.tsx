import type { SelectHTMLAttributes } from "react";
import { Icon } from "./Icon";
import s from "./Select.module.css";

export function Select({
  plain,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { plain?: boolean }) {
  return (
    <span className={[s.wrap, plain && s.plain, className].filter(Boolean).join(" ")}>
      <select className={s.select} {...rest} />
      <Icon name="chevronDown" size={14} className={s.chev} />
    </span>
  );
}
