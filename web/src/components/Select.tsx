import type { SelectHTMLAttributes } from "react";
import { Icon } from "./Icon";
import s from "./Select.module.css";

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`${s.wrap} ${className ?? ""}`}>
      <select className={s.select} {...rest} />
      <Icon name="chevronDown" size={14} className={s.chev} />
    </span>
  );
}
