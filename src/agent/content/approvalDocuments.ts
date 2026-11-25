import { APPROVAL_DOCUMENTS_SHOWN, approvalReason } from "../../approvalRequest.js";
import type { ApprovalDocument } from "../../approvalRequest.js";
import { titleFieldOf } from "../../schema/titleField.js";
import type { SchemaContext } from "../../types.js";
import type { DocumentIO } from "./documentIo.js";

const titleFieldName = (schema: SchemaContext, collection: string): string | undefined => {
  const entry = schema.collections.find((candidate) => candidate.slug === collection);

  return entry ? titleFieldOf(entry) : undefined;
};

const titleOfDocument = (
  schema: SchemaContext,
  collection: string,
  doc: Record<string, unknown> | null | undefined
): string | undefined => {
  const field = titleFieldName(schema, collection);
  const title = field && doc ? doc[field] : undefined;

  return typeof title === "string" && title.trim() ? title.trim() : undefined;
};

interface ShownDocuments {
  io: DocumentIO;
  schema: SchemaContext;
  collection: string;
  ids: (string | number)[];
  locale?: string;
}

/** The first documents of a run with their titles. A failed read leaves the ids. */
export async function shownDocuments({
  io,
  schema,
  collection,
  ids,
  locale,
}: ShownDocuments): Promise<ApprovalDocument[]> {
  const shown = ids.slice(0, APPROVAL_DOCUMENTS_SHOWN);
  const field = titleFieldName(schema, collection);
  const listed = await io
    .list(collection, {
      where: { id: { in: shown } },
      limit: shown.length,
      locale,
      select: field ? { [field]: true } : { id: true },
    })
    .catch(() => null);
  const titles = new Map(
    (listed?.docs ?? []).map((doc) => [String(doc.id), titleOfDocument(schema, collection, doc)])
  );

  return shown.map((id) => {
    const title = titles.get(String(id));

    return title ? { id, title } : { id };
  });
}

interface RiskyUpdate {
  collection?: string;
  global?: string;
  id: unknown;
  before: Record<string, unknown>;
  effects: string[];
}

export function riskyUpdateReason(
  schema: SchemaContext,
  { collection, global, id, before, effects }: RiskyUpdate
): string {
  if (global || !collection) return approvalReason({ kind: "risky-update", global, effects });

  return approvalReason({
    kind: "risky-update",
    collection,
    document: {
      id: typeof id === "number" ? id : String(id),
      title: titleOfDocument(schema, collection, before),
    },
    effects,
  });
}
