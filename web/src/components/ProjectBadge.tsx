import { useState } from "react";
import s from "./ProjectBadge.module.css";

// White initials stay ≥ 4.5:1 on every colour below (the lowest, slate, is 4.76); admins pick from all
// sixteen. The colour derived from a key uses the first eight only, so adding colours never changed
// the badge of an existing project or a person's avatar.
export const PROJECT_COLORS = [
  "#3b5bdb",
  "#0f7a5f",
  "#b4530f",
  "#7c3aed",
  "#be185d",
  "#0e7490",
  "#4d7c0f",
  "#64748b",
  "#c42b2b",
  "#92400e",
  "#15803d",
  "#0369a1",
  "#4338ca",
  "#9333ea",
  "#a21caf",
  "#57534e",
];
const DERIVED = 8;

export function projectColor(key: string, color?: string) {
  if (color) return color;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[hash % DERIVED];
}

// By grapheme, so an emoji, a flag or a family of emoji stays whole; Firefox before 125 has no Intl.Segmenter
// and gets the first code point, which still keeps a plain emoji whole.
export function initial(name: string) {
  const text = name.trim();
  const first = Intl.Segmenter
    ? [...new Intl.Segmenter().segment(text)][0]?.segment
    : Array.from(text)[0];
  return (first ?? "?").toUpperCase();
}

export function ProjectBadge({
  name,
  projectKey,
  color,
  src,
  size = 20,
}: {
  name: string;
  projectKey: string;
  color?: string;
  src?: string;
  size?: number;
}) {
  // The picture that failed, so a new one gets its own try.
  const [broken, setBroken] = useState<string>();
  const shape = { width: size, height: size, borderRadius: Math.round(size * 0.3) };
  if (src && src !== broken) {
    return (
      <img
        className={s.badge}
        style={shape}
        src={src}
        alt=""
        draggable={false}
        onError={() => setBroken(src)}
      />
    );
  }
  return (
    <span
      className={s.badge}
      aria-hidden="true"
      style={{
        ...shape,
        fontSize: Math.round(size * 0.5),
        background: projectColor(projectKey, color),
      }}
    >
      <span className="letter">{initial(name)}</span>
    </span>
  );
}
