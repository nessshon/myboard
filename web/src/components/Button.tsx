import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import s from "./Button.module.css";

type Look = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  icon?: IconName;
};

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  Look & {
    compact?: boolean;
  } & ({ children: ReactNode } | { children?: undefined; icon: IconName; "aria-label": string });

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  compact,
  className,
  children,
  ...rest
}: Props) {
  const iconOnly = children === undefined;
  return (
    <button
      type="button"
      className={classes(iconOnly, variant, size, className, compact)}
      title={rest["aria-label"]}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize(iconOnly, size)} />}
      {compact ? <span className={s.label}>{children}</span> : children}
    </button>
  );
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> &
  Look &
  ({ children: ReactNode } | { children?: undefined; icon: IconName; "aria-label": string })) {
  const iconOnly = children === undefined;
  return (
    <a className={classes(iconOnly, variant, size, className)} title={rest["aria-label"]} {...rest}>
      {icon && <Icon name={icon} size={iconSize(iconOnly, size)} />}
      {children}
    </a>
  );
}

function classes(
  iconOnly: boolean,
  variant: NonNullable<Look["variant"]>,
  size: Look["size"],
  className?: string,
  compact?: boolean,
) {
  return [
    iconOnly ? s.icon : s.btn,
    !iconOnly && s[variant],
    size === "sm" && s.sm,
    compact && s.compact,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

const iconSize = (iconOnly: boolean, size: Look["size"]) =>
  size === "sm" ? 14 : iconOnly ? 18 : 16;
