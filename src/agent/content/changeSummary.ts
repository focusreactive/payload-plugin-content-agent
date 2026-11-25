import { isRecord } from "../../borders.js";
import type { SchemaContext, SchemaField } from "../../types.js";
import { classifyChange } from "./changeClass.js";
import type { ChangeClass } from "./changeClass.js";

export interface ChangedDocument {
  collection: string;
  id: string;
  /** `created`: the conversation has no version of the document from before the change. */
  kind: ChangeClass | "created";
  /** Top-level fields whose value differs between the two versions. */
  fields: string[];
  /** The set of changed fields is not the one most documents of the collection share. */
  differs: boolean;
  issues: string[];
}

export interface ChangeSummary {
  total: number;
  counts: Record<ChangedDocument["kind"], number>;
  withIssues: number;
  /** Per collection with more than one document: the fields most of them changed. */
  patterns: { collection: string; fields: string[]; documents: number; differ: number }[];
  /** Documents with open issues first, then the ones that differ from the pattern. */
  documents: ChangedDocument[];
}

export interface ChangeInput {
  collection: string;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  report: unknown;
}

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const issuesOf = (report: unknown): string[] => (isRecord(report) ? texts(report.issues) : []);

function fieldsOf(schema: SchemaContext, collection: string): SchemaField[] {
  const globalSlug = collection.startsWith("global:") ? collection.slice("global:".length) : null;

  return (
    (globalSlug
      ? schema.globals.find((entry) => entry.slug === globalSlug)?.fields
      : schema.collections.find((entry) => entry.slug === collection)?.fields) ?? []
  );
}

const differ = (before: unknown, after: unknown): boolean =>
  JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);

function describeDocument(schema: SchemaContext, change: ChangeInput): ChangedDocument {
  const { collection, id, before, after } = change;
  const fields = fieldsOf(schema, collection);
  const changed =
    before && after
      ? fields
          .filter((field) => field.name && differ(before[field.name], after[field.name]))
          .map((field) => field.name)
      : [];

  return {
    collection,
    id,
    kind: before && after ? classifyChange(fields, before, after) : "created",
    fields: changed,
    differs: false,
    issues: issuesOf(change.report),
  };
}

const signature = (document: ChangedDocument): string =>
  `${document.kind}|${document.fields.join(",")}`;

function patternOf(collection: string, documents: ChangedDocument[]) {
  const sizes = new Map<string, number>();

  for (const document of documents)
    sizes.set(signature(document), (sizes.get(signature(document)) ?? 0) + 1);
  const [common] = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
  const sample = documents.find((document) => signature(document) === common[0])!;

  for (const document of documents) document.differs = signature(document) !== common[0];

  return {
    collection,
    fields: sample.fields,
    documents: documents.length,
    differ: documents.length - common[1],
  };
}

const rank = (document: ChangedDocument): number =>
  document.issues.length ? 0 : document.differs ? 1 : 2;

const KIND_WEIGHT: Record<ChangedDocument["kind"], number> = { text: 0, structure: 1, created: 2 };

/** A document changed in several locales is one document, with the changes of all of them. */
function mergeLocales(documents: ChangedDocument[]): ChangedDocument[] {
  const merged = new Map<string, ChangedDocument>();

  for (const document of documents) {
    const key = `${document.collection}:${document.id}`;
    const seen = merged.get(key);

    merged.set(
      key,
      seen
        ? {
            ...seen,
            kind: KIND_WEIGHT[document.kind] > KIND_WEIGHT[seen.kind] ? document.kind : seen.kind,
            fields: [...new Set([...seen.fields, ...document.fields])],
            issues: [...seen.issues, ...document.issues],
          }
        : document
    );
  }

  return [...merged.values()];
}

/** The broad view of what a conversation changed, built from the stored versions. */
export function summarizeChanges(schema: SchemaContext, changes: ChangeInput[]): ChangeSummary {
  const documents = mergeLocales(changes.map((change) => describeDocument(schema, change)));
  const byCollection = new Map<string, ChangedDocument[]>();

  for (const document of documents)
    byCollection.set(document.collection, [
      ...(byCollection.get(document.collection) ?? []),
      document,
    ]);
  const patterns = [...byCollection.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([collection, list]) => patternOf(collection, list));
  const counts = { text: 0, structure: 0, created: 0 };

  for (const document of documents) counts[document.kind] += 1;

  return {
    total: documents.length,
    counts,
    withIssues: documents.filter((document) => document.issues.length > 0).length,
    patterns,
    documents: documents
      .map((document, index) => ({ document, index }))
      .sort((a, b) => rank(a.document) - rank(b.document) || a.index - b.index)
      .map(({ document }) => document),
  };
}
