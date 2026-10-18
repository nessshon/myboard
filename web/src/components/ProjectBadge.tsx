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

export function ProjectBadge({
  name,
  projectKey,
  color,
  size = 20,
}: {
  name: string;
  projectKey: string;
  color?: string;
  size?: number;
}) {
  return (
    <span
      className={s.badge}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.round(size * 0.5),
        background: projectColor(projectKey, color),
      }}
    >
      <span className="letter">{(name.trim()[0] ?? "?").toUpperCase()}</span>
    </span>
  );
}
