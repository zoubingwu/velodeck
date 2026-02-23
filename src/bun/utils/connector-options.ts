export function readStringOption(
  options: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const value = options[key];
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

export function readBooleanOption(
  options: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const value = options[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

export function ensureRequiredString(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

export function normalizeOptionalString(value: string): string {
  const trimmed = value.trim();
  return trimmed;
}
