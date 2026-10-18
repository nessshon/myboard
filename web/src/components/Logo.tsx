export function Logo({ className }: { className?: string }) {
  const bar = { fill: "var(--accent-text)" };
  return (
    <svg className={className} viewBox="0 0 22 22" aria-hidden="true">
      <rect width="22" height="22" rx="6" style={{ fill: "var(--accent)" }} />
      <rect x="5" y="5" width="3" height="12" rx="1.5" style={bar} />
      <rect x="9.5" y="5" width="3" height="7" rx="1.5" style={bar} />
      <rect x="14" y="5" width="3" height="10" rx="1.5" style={bar} />
    </svg>
  );
}
