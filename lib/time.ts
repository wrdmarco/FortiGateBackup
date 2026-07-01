export const defaultTimeZone = "Europe/Amsterdam";

export const commonTimeZones = [
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Berlin",
  "Europe/London",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney"
] as const;

export function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat("nl-NL", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value?: string | null) {
  const timeZone = value?.trim() || defaultTimeZone;
  return isValidTimeZone(timeZone) ? timeZone : defaultTimeZone;
}

export function formatDateTime(value: Date | string | number | null | undefined, timeZone?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: normalizeTimeZone(timeZone)
  }).format(new Date(value));
}

export function formatDateOnly(value: Date | string | number | null | undefined, timeZone?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "short",
    timeZone: normalizeTimeZone(timeZone)
  }).format(new Date(value));
}
