export function convertLegacyValue(value: unknown, targetType: string | undefined, location: string) {
  if (value === null || value === undefined) return null;
  if (targetType === "boolean") return value === 1 || value === "1" || value === true;
  if (!targetType?.includes("timestamp")) return value;

  const timestamp = legacyTimestamp(value);
  if (!timestamp || Number.isNaN(timestamp.getTime())) throw new Error(`INVALID_LEGACY_TIMESTAMP:${location}`);
  return timestamp;
}

function legacyTimestamp(value: unknown) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return new Date(Number(trimmed));
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }
  return new Date(trimmed);
}
