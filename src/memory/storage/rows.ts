import { isRecord } from "../../borders.js";

export type Row = Record<string, unknown>;

export const rowOf = (value: unknown): Row => (isRecord(value) ? value : {});

export const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

export const dateOf = (value: unknown): Date =>
  value instanceof Date
    ? value
    : new Date(typeof value === "string" || typeof value === "number" ? value : Number.NaN);

export const nullableDateOf = (value: unknown): Date | null =>
  value == null ? null : dateOf(value);
