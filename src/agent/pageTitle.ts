import type { BasePayload, TypedUser } from "payload";
import { titleFieldOf } from "../schema/titleField.js";
import type { SchemaContext } from "../types.js";
import type { PageContext } from "./index.js";

const MAX_TITLE_CHARS = 120;

/**
 * The title of the document the person has open, read as that person. It lets the agent name
 * the document in its reply without a read of its own.
 */
export async function pageTitleOf(
  {
    payload,
    user,
    schema,
    mcpOnly,
  }: { payload: BasePayload; user: TypedUser; schema: SchemaContext; mcpOnly?: boolean },
  pageContext: PageContext | undefined
): Promise<string | undefined> {
  // With mcpOnly the agent reads nothing through the Local API.
  if (mcpOnly) return undefined;
  const { collection: slug, documentId } = pageContext ?? {};
  const collection = schema.collections.find((entry) => entry.slug === slug);
  const titleField = collection ? titleFieldOf(collection) : undefined;

  if (!collection || !titleField || !documentId) return undefined;

  try {
    const doc: Record<string, unknown> = await payload.findByID({
      collection: collection.slug,
      id: documentId,
      depth: 0,
      draft: true,
      overrideAccess: false,
      user,
      select: { [titleField]: true },
    });
    const title = doc[titleField];

    if (typeof title !== "string") return undefined;
    const oneLine = title.replace(/\s+/gu, " ").trim();

    return oneLine ? oneLine.slice(0, MAX_TITLE_CHARS) : undefined;
  } catch {
    return undefined;
  }
}
