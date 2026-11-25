import type { PayloadDoc } from "../borders.js";
import type { SchemaContext, SchemaField } from "../types.js";
import type { DocTarget, DocumentIO } from "../agent/content/documentIo.js";
import { keyExists } from "../agent/content/editor/checks.js";
import {
  SHRINK_RATIO,
  findLostProtectedValues,
  findNewDuplicates,
  findShrunkFields,
} from "../agent/content/guards.js";
import { describeLink, findUnresolvedNewLinks } from "../agent/content/links.js";
import type { LinkProbe } from "../agent/content/links.js";
import { findEmptyNewSections } from "../agent/content/structureChecks.js";
import { describeTableIssue, findTableIssuesOfEdit } from "../agent/content/tables.js";
import { describeLeftover, findIncompleteRename } from "../agent/content/topicRename.js";
import { buildChangedFields } from "../agent/content/schemaValues.js";
import { fieldsForTarget } from "../agent/content/workspaceTools.js";
import { assessUpdateRisk } from "../agent/tools/review.js";
import type { ToolSurface } from "../agent/toolSurface.js";

export interface EditCheckInput {
  schema: SchemaContext;
  io: DocumentIO;
  fields: SchemaField[];
  before: unknown;
  after: unknown;
  probeLink?: LinkProbe;
}

export interface EditVerdict {
  /** The document is not saved with one of these. */
  blocking: string[];
  /** Saved, and reported with the draft for a person to check. */
  issues: string[];
}

const shrunkText = (shrunk: { ref: string; from: number; to: number }[]): string =>
  `${shrunk.length} field(s) would lose most of their text: ${shrunk.map((field) => `${field.ref} ${field.from} to ${field.to} characters`).join("; ")}. The content agent tools do not shorten a text this much.`;

interface RemovalContext {
  schema: SchemaContext;
  surface: ToolSurface;
  target: DocTarget;
  tool: string;
}

/** A change that removes or empties what the document holds, or cuts most of a text. */
export function removalRefusal(
  { schema, surface, target, tool }: RemovalContext,
  before: PayloadDoc,
  after: PayloadDoc
): string | null {
  const fields = fieldsForTarget(schema, target);
  const { patch } = buildChangedFields(before, after);
  const hasAuth = schema.collections.find((entry) => entry.slug === target.collection)?.hasAuth;
  const risks = assessUpdateRisk(fields, before, patch, hasAuth);

  if (risks.length)
    return surface.destructiveRefusal(risks.map((risk) => risk.reason).join(" "), tool);
  const shrunk = findShrunkFields(fields, before, after, SHRINK_RATIO);

  return shrunk.length ? `Nothing was written. ${shrunkText(shrunk)}` : null;
}

function contentChecks({ fields, before, after }: EditCheckInput, verdict: EditVerdict): void {
  const empty = findEmptyNewSections(fields, before, after);

  if (empty.length)
    verdict.blocking.push(
      `${empty.length} new item(s) would be empty shells: ${empty.map((section) => `${section.blockType} (${section.empty.join(", ")} with no rows)`).join("; ")}. Send the rows in \`fields\` of the insertItem operation, or leave the item out.`
    );
  const shrunk = findShrunkFields(fields, before, after, SHRINK_RATIO);

  if (shrunk.length) verdict.blocking.push(shrunkText(shrunk));
  const lost = findLostProtectedValues(before, after, "");

  if (lost.length)
    verdict.issues.push(
      `These values were in the document and are gone: ${lost.map((value) => `"${value}"`).join(", ")}. Check that each of them was meant to change.`
    );
  const duplicates = findNewDuplicates(before, after);

  if (duplicates.length)
    verdict.issues.push(
      `The same passage now appears more than once: ${duplicates.map((passage) => `"${passage}…"`).join("; ")}.`
    );
  const tables = findTableIssuesOfEdit(fields, before, after);

  if (tables.length)
    verdict.issues.push(
      `${tables.length} table row(s) are malformed: ${tables.map(describeTableIssue).join("; ")}. The header, the delimiter row and every row need the same number of cells.`
    );
  const rename = findIncompleteRename(before, after);

  if (rename)
    verdict.issues.push(
      `The edit changes "${rename.from}" to "${rename.to}", and "${rename.from}" still appears in ${rename.leftovers.length} place(s): ${rename.leftovers.slice(0, 20).map(describeLeftover).join("; ")}.`
    );
}

async function linkChecks(input: EditCheckInput, verdict: EditVerdict): Promise<void> {
  const { schema, io, fields, before, after, probeLink } = input;
  const unresolved = await findUnresolvedNewLinks(fields, before, after, {
    lookup: (candidates) => keyExists({ schema, io }, candidates),
    probe: probeLink,
  }).catch(() => []);
  const missing = unresolved.filter((link) => link.verdict === "missing");
  const unverified = unresolved.filter((link) => link.verdict === "unverified");

  if (missing.length)
    verdict.blocking.push(
      `${missing.length} new link(s) point at pages this site does not have: ${missing.map((link) => `${describeLink(link.link)}, the site answers 404`).join("; ")}. Find the real page with lookupDocuments, or send the text without the link.`
    );
  if (unverified.length)
    verdict.issues.push(
      `${unverified.length} new link(s) could not be verified: ${unverified.map((link) => `${describeLink(link.link)}, no document has the slug "${link.slug}"`).join("; ")}.`
    );
}

/** What the checked edit of the chat verifies in code, without the parts that need a model. */
export async function checkEdit(input: EditCheckInput): Promise<EditVerdict> {
  const verdict: EditVerdict = { blocking: [], issues: [] };

  contentChecks(input, verdict);
  await linkChecks(input, verdict);

  return verdict;
}
