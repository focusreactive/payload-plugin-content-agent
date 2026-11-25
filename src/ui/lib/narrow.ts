// The chat runs in the browser: these checks stay free of server imports.

export type Text = string | number;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isText = (value: unknown): value is Text =>
  typeof value === "string" || typeof value === "number";

export const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

export const textOf = (value: unknown): Text | undefined => (isText(value) ? value : undefined);

export const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const recordsOf = (value: unknown): Record<string, unknown>[] =>
  listOf(value).filter(isRecord);
