import { isRecord } from "../borders.js";

export function plainText(value: unknown, language: string): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!isRecord(value)) return undefined;
  const preferred = value[language];

  if (typeof preferred === "string" && preferred) return preferred;

  return Object.values(value).find(
    (entry): entry is string => typeof entry === "string" && entry !== ""
  );
}
