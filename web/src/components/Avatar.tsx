import { useState } from "react";
import { initial, projectColor } from "./ProjectBadge";
import s from "./Avatar.module.css";

type Props = { name: string; src?: string; size?: number };

export function Avatar({ name, src, size = 32 }: Props) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (src && !broken) {
    return <img className={s.ava} style={style} src={src} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className={s.ava} style={{ ...style, background: projectColor(name) }} aria-hidden="true">
      <span className="letter">{initial(name)}</span>
    </span>
  );
}
