import { useId, type ReactNode } from "react";
import s from "./Section.module.css";

export function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={s.sec} aria-labelledby={id}>
      <div className={s.head}>
        <h2 id={id} className="heading">
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
