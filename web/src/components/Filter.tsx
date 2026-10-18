import type { ReactNode } from "react";
import { useT } from "../i18n";
import { Icon } from "./Icon";
import { Menu, MenuCheck } from "./Menu";
import s from "./Filter.module.css";

export type FilterOption = { id: string; name: string; icon?: ReactNode; count: number };

type Props = {
  title: string;
  options: FilterOption[];
  chosen: string[];
  onChange: (chosen: string[]) => void;
  children?: ReactNode;
};

export function Filter({ title, options, chosen, onChange, children }: Props) {
  const picked = options.filter((o) => chosen.includes(o.id));
  const label = picked.length ? `${title}: ${picked.map((o) => o.name).join(", ")}` : title;
  return (
    <div className={chosen.length ? `${s.filter} ${s.on}` : s.filter}>
      <Menu
        label={label}
        align="left"
        triggerClass={s.trigger}
        trigger={
          <>
            <span className={s.label}>{title}</span>
            {picked.length ? (
              <span className={s.marks}>
                {picked.slice(0, 3).map((o) => (
                  <span key={o.id}>{o.icon}</span>
                ))}
                {picked.length > 3 && <span className={s.more}>+{picked.length - 3}</span>}
              </span>
            ) : (
              <Icon name="chevronDown" size={14} className={s.chev} />
            )}
          </>
        }
      >
        {options.map((o) => (
          <MenuCheck
            key={o.id}
            checked={chosen.includes(o.id)}
            icon={o.icon}
            count={o.count}
            onClick={() =>
              onChange(chosen.includes(o.id) ? chosen.filter((x) => x !== o.id) : [...chosen, o.id])
            }
          >
            {o.name}
          </MenuCheck>
        ))}
        {children}
      </Menu>
    </div>
  );
}

export function FilterReset({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className={s.reset} aria-label={t("filter.reset")} onClick={onClick}>
      <Icon name="x" size={14} />
      <span className={s.resetText}>{t("filter.reset")}</span>
    </button>
  );
}
