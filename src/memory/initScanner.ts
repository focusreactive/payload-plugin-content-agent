import type { SchemaCollection, SchemaContext, SchemaGlobal } from "../types.js";
import type { MemoryService } from "./index.js";
import type { DocumentIO } from "../agent/content/documentIo.js";
import { SHARED_USER_ID } from "./storage/ltm.js";
import { quiet } from "../promises.js";

export interface InitResult {
  ok: boolean;
  collections: number;
  globals: number;
  error?: string;
}

// On globalThis so a dev module reload keeps track of a running scan. Keyed per plugin instance.
const IN_FLIGHT_KEY = Symbol.for("payload-content-agent.init-scanner-inflight");

function inFlightRegistry(): Map<string, Promise<InitResult>> {
  const globalStore = globalThis as Record<symbol, unknown>;

  if (!globalStore[IN_FLIGHT_KEY])
    globalStore[IN_FLIGHT_KEY] = new Map<string, Promise<InitResult>>();

  return globalStore[IN_FLIGHT_KEY] as Map<string, Promise<InitResult>>;
}

/** A stored content map is a finished scan: a collection the person cannot read is a fact in it. */
export async function isInitialized(memory: MemoryService): Promise<boolean> {
  return !!(await memory.ltm.read(SHARED_USER_ID, "content-map"));
}

interface InitScan {
  io: DocumentIO;
  memory: MemoryService;
  createdSlugs: Set<string>;
  /** The day of the scan: a count is true for that day only. */
  scannedOn: string;
  collectionSummaries: string[];
  globalSummaries: string[];
}

async function scanCollection(col: SchemaCollection, scan: InitScan): Promise<void> {
  const { io, memory, createdSlugs, collectionSummaries, scannedOn } = scan;
  let count: number | string;

  if (!io.transports({ collection: col.slug }).read) {
    count = "(no access)";
  } else {
    const listed = await io.list(col.slug, { limit: 1, callId: "init" });

    count = listed.error ? "(inaccessible)" : listed.totalDocs;
  }

  const fields = col.fields
    .map((field) => {
      let desc = `${field.name} (${field.type})`;

      if (field.relationTo)
        desc += ` -> ${Array.isArray(field.relationTo) ? field.relationTo.join("|") : field.relationTo}`;
      if (field.required) desc += " [required]";

      return desc;
    })
    .join(", ");

  const colSlug = `content-map-${col.slug}`;
  const colTitle = `${col.labels?.plural || col.slug} collection`;
  const counted =
    typeof count === "number"
      ? `${count} documents on ${scannedOn}, the day of the scan (the number may have changed since)`
      : `${count} documents`;
  const colBody = `${counted}. Fields: ${fields}.${col.hasDrafts ? " Has drafts." : ""}`;

  await memory.ltm.create({
    slug: colSlug,
    userId: SHARED_USER_ID,
    parentSlug: "content-map",
    path: `/content-map/${col.slug}`,
    title: colTitle,
    body: colBody,
    createdBy: "init-scanner",
  });

  // The upsert in `ltm.create` leaves `embedding` untouched, so re-embed on every scan.
  if (memory.embeddings) {
    void quiet(memory.embeddings.embedLtmEntry(SHARED_USER_ID, colSlug, `${colTitle}\n${colBody}`));
  }

  createdSlugs.add(colSlug);
  collectionSummaries.push(`${col.slug}: ${count}`);
}

async function scanGlobal(global: SchemaGlobal, scan: InitScan): Promise<void> {
  const { io, memory, createdSlugs, globalSummaries, scannedOn } = scan;
  let hasData = false;

  if (io.transports({ global: global.slug }).read) {
    const result = await io.read({ global: global.slug }, { callId: "init" });
    const { doc } = result;

    if (!result.error && doc) {
      hasData = Object.keys(doc).some(
        (key) =>
          !["id", "createdAt", "updatedAt", "globalType", "_status"].includes(key) &&
          doc[key] != null &&
          doc[key] !== ""
      );
    }
  }

  const fields = global.fields.map((field) => `${field.name} (${field.type})`).join(", ");
  const globalSlug = `content-map-global-${global.slug}`;
  const globalTitle = `${global.label || global.slug} global`;
  const globalBody = `Fields: ${fields}. ${hasData ? "Has data" : "Empty"} on ${scannedOn}, the day of the scan.`;

  await memory.ltm.create({
    slug: globalSlug,
    userId: SHARED_USER_ID,
    parentSlug: "content-map",
    path: `/content-map/globals/${global.slug}`,
    title: globalTitle,
    body: globalBody,
    createdBy: "init-scanner",
  });

  if (memory.embeddings) {
    void quiet(
      memory.embeddings.embedLtmEntry(SHARED_USER_ID, globalSlug, `${globalTitle}\n${globalBody}`)
    );
  }

  createdSlugs.add(globalSlug);
  globalSummaries.push(global.slug);
}

async function writeContentMap(scan: InitScan): Promise<void> {
  const { memory, collectionSummaries, globalSummaries, scannedOn } = scan;
  const contentMapTitle = "Content Map";
  const contentMapBody = `Collections, with the number of documents on ${scannedOn} (the day of the scan): ${collectionSummaries.join("; ")}. Globals: ${globalSummaries.join(", ")}.`;

  await memory.ltm.create({
    slug: "content-map",
    userId: SHARED_USER_ID,
    path: "/content-map",
    title: contentMapTitle,
    body: contentMapBody,
    createdBy: "init-scanner",
  });

  if (memory.embeddings) {
    void quiet(
      memory.embeddings.embedLtmEntry(
        SHARED_USER_ID,
        "content-map",
        `${contentMapTitle}\n${contentMapBody}`
      )
    );
  }
}

async function writeIdentity(schema: SchemaContext, memory: MemoryService): Promise<void> {
  const collectionNames = schema.collections
    .map((collection) => collection.labels?.singular || collection.slug)
    .join(", ");
  const globalNames = schema.globals.map((global) => global.label || global.slug).join(", ");
  const identityTitle = "Agent Identity";
  const identityBody = `I am a Content Agent for a Payload CMS project with collections: ${collectionNames}${globalNames ? `. Globals: ${globalNames}` : ""}.`;

  await memory.ltm.create({
    slug: "identity",
    userId: SHARED_USER_ID,
    path: "/identity",
    title: identityTitle,
    body: identityBody,
    createdBy: "init-scanner",
  });

  if (memory.embeddings) {
    void quiet(
      memory.embeddings.embedLtmEntry(
        SHARED_USER_ID,
        "identity",
        `${identityTitle}\n${identityBody}`
      )
    );
  }
}

async function archiveStaleEntries(scan: InitScan): Promise<void> {
  const { memory, createdSlugs } = scan;
  // Archive stale entries only after the rebuild succeeded,
  // so a failed scan keeps the previous knowledge base.
  const old = await memory.ltm.listAllWithShared(SHARED_USER_ID);

  for (const entry of old) {
    if (entry.createdBy === "init-scanner" && !createdSlugs.has(entry.slug)) {
      await memory.ltm.archive(SHARED_USER_ID, entry.slug, "init-scanner");
    }
  }
}

async function doInitScan(
  io: DocumentIO,
  schema: SchemaContext,
  memory: MemoryService
): Promise<InitResult> {
  console.log("[Content Agent] Init scan (via MCP) starting...");
  const worker = await memory.backgroundReports.startWorkerIfNotRunning("init-scanner");

  if (!worker) {
    console.warn("[Content Agent] Init scan already running (another instance) - skipping");

    return {
      ok: false,
      collections: 0,
      globals: 0,
      error: "Init scan already running on another instance - try again shortly.",
    };
  }

  const scan: InitScan = {
    io,
    memory,
    createdSlugs: new Set<string>(),
    scannedOn: new Date().toISOString().slice(0, 10),
    collectionSummaries: [],
    globalSummaries: [],
  };

  try {
    for (const col of schema.collections) {
      await scanCollection(col, scan);
    }

    for (const global of schema.globals) {
      await scanGlobal(global, scan);
    }

    await writeContentMap(scan);
    await writeIdentity(schema, memory);
    // No behavior entry: the rules of the agent are in its prompt and in the code, and a scan
    // finds no rule of its own.
    scan.createdSlugs.add("content-map").add("identity");

    await archiveStaleEntries(scan);

    await memory.backgroundReports.completeWorker(worker.id);
    console.log("[Content Agent] Init scan complete");

    return {
      ok: true,
      collections: scan.collectionSummaries.length,
      globals: scan.globalSummaries.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    console.error("[Content Agent] Init scan failed:", msg);
    await memory.backgroundReports.failWorker(worker.id, msg);

    return { ok: false, collections: 0, globals: 0, error: msg };
  }
}

// Runs on demand, not at onInit: the MCP endpoint is not listening yet at onInit.
export function runInitScanner(
  io: DocumentIO,
  schema: SchemaContext,
  memory: MemoryService,
  instanceKey: string
): Promise<InitResult> {
  const registry = inFlightRegistry();
  const existing = registry.get(instanceKey);

  if (existing) return existing;
  const own: { scan?: Promise<InitResult> } = {};
  const scan = (async () => {
    try {
      return await doInitScan(io, schema, memory);
    } finally {
      if (registry.get(instanceKey) === own.scan) registry.delete(instanceKey);
    }
  })();

  own.scan = scan;

  registry.set(instanceKey, scan);

  return scan;
}
