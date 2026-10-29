// A due date is a calendar day (YYYY-MM-DD), not an instant: format it in UTC so no time zone shifts it.
export function formatDue(due: string, lang: string, month: "short" | "long" = "short") {
  const [y, m, d] = due.split("-").map(Number);
  return new Intl.DateTimeFormat(lang, { day: "numeric", month, timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function isOverdue(due: string) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return due !== "" && due < today;
}

// A PocketBase timestamp ("2026-10-15 19:35:21.181Z"); the space separator is not accepted by every
// engine's Date parser.
const parseDate = (timestamp: string) => new Date(timestamp.replace(" ", "T"));

export function formatDate(timestamp: string, lang: string, month: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(lang, { day: "numeric", month }).format(parseDate(timestamp));
}

export function formatDay(timestamp: string, lang: string) {
  return parseDate(timestamp).toLocaleDateString(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatMoment(timestamp: string, lang: string) {
  return new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseDate(timestamp));
}

export function formatSize(bytes: number, lang: string) {
  const [value, unit] =
    bytes < 1024 * 1024 ? [bytes / 1024, "kilobyte"] : [bytes / 1024 / 1024, "megabyte"];
  return new Intl.NumberFormat(lang, {
    style: "unit",
    unit,
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(Math.max(value, 0.1));
}
