import { useLang } from "../i18n";

export function Counter({ value, max }: { value: string; max: number }) {
  const lang = useLang();
  if (value.length < max * 0.8) return null;
  const n = new Intl.NumberFormat(lang);
  return (
    <span className={value.length >= max ? "counter full" : "counter"}>
      {n.format(value.length)} / {n.format(max)}
    </span>
  );
}
