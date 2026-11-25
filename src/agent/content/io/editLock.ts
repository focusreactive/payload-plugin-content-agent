import { isRecord } from "../../../borders.js";
import type { DocId, Where } from "../../../borders.js";
import type { DocTarget } from "../documentIo.js";
import { unknownTargetError } from "../../toolErrors.js";
import { collectionOf, globalOf, targetLabel } from "./context.js";
import type { IoContext, LocalApi } from "./context.js";

const LOCKS_COLLECTION = "payload-locked-documents";
const DEFAULT_LOCK_SECONDS = 300;

function lockSetting({ payload }: LocalApi, target: DocTarget): unknown {
  return target.global
    ? payload.config?.globals?.find((global) => global.slug === target.global)?.lockDocuments
    : payload.collections?.[target.collection ?? ""]?.config.lockDocuments;
}

function lockQuery(target: DocTarget, id?: DocId): Where {
  return target.global
    ? { globalSlug: { equals: target.global } }
    : {
        and: [
          { "document.relationTo": { equals: target.collection } },
          { "document.value": { equals: id } },
        ],
      };
}

function heldByAnotherUser(lock: Record<string, unknown>, { user }: LocalApi): boolean {
  const holder = isRecord(lock.user) ? lock.user : {};
  const holderId = isRecord(holder.value) ? holder.value.id : holder.value;

  if (String(holderId) !== String(user.id)) return true;

  return (
    typeof holder.relationTo === "string" &&
    typeof user.collection === "string" &&
    holder.relationTo !== user.collection
  );
}

const lockedMessage = (target: DocTarget, id: DocId | undefined, minutesLeft: number) =>
  `${target.global ? `Global "${target.global}"` : `Document ${id} in ${targetLabel(target)}`} is open in the admin panel of another person, so the agent did not write to it. Nothing was written. Do not retry in this turn and do not write the change to another document. Tell the person the two ways out: ask the colleague to save and close the document, or wait until the lock ends (about ${minutesLeft} min with no edits from them), then ask again.`;

/** The same rule as Payload's own lock check, made by the plugin: a write through the MCP
 *  server runs as the API key's user, so Payload cannot tell the chat user's own lock from
 *  another person's. */
export async function lockRefusal(
  io: IoContext,
  target: DocTarget,
  id?: DocId
): Promise<string | null> {
  const { local } = io;
  const known = target.global ? globalOf(io, target.global) : collectionOf(io, target.collection);

  // A lock query on a slug that the schema does not have fails in Payload with another reason.
  if (!known) return unknownTargetError(io.schema, target);
  if (!local || !local.payload.collections?.[LOCKS_COLLECTION]) return null;
  if (!target.global && id === undefined) return null;
  const setting = lockSetting(local, target);

  if (setting === false) return null;
  const seconds =
    isRecord(setting) && typeof setting.duration === "number"
      ? setting.duration
      : DEFAULT_LOCK_SECONDS;

  try {
    const { docs } = await local.payload.find({
      collection: LOCKS_COLLECTION,
      where: lockQuery(target, id),
      sort: "-updatedAt",
      limit: 1,
      depth: 0,
      pagination: false,
    });
    const lock: unknown = docs[0];

    if (!isRecord(lock) || !heldByAnotherUser(lock, local)) return null;
    const msLeft = new Date(String(lock.updatedAt)).getTime() + seconds * 1000 - Date.now();

    return msLeft >= 0 ? lockedMessage(target, id, Math.max(1, Math.ceil(msLeft / 60_000))) : null;
  } catch (err) {
    return `The agent could not check whether another person has ${targetLabel(target)} open (${err instanceof Error ? err.message : String(err)}), so it did not write. Nothing was written. Try again in a moment; if it repeats, tell the person to report it to a developer.`;
  }
}
