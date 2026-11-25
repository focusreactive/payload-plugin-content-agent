import type { PayloadRequest } from "payload";
import { isRecord } from "../borders.js";

/** The JSON object of a request. A missing body, broken JSON or a non-object reads as empty. */
export async function readJsonBody(req: PayloadRequest): Promise<Record<string, unknown>> {
  let body: unknown = req.data;

  if (body == null && typeof req.json === "function") {
    try {
      body = await req.json();
    } catch {
      return {};
    }
  }

  return isRecord(body) ? body : {};
}
