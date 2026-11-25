import type { CollectionConfig, GlobalConfig, Payload } from "payload";

export interface LabSchema {
  name: string;
  collections: CollectionConfig[];
  globals: GlobalConfig[];
  localization?: { locales: string[]; defaultLocale: string };
  // Returns logical names mapped to collection and id, so a scenario never holds a database id.
  // `faults` lists what the seed broke on purpose; the graders read it from `seed.json`.
  seed: (payload: Payload) => Promise<{
    documents: Record<string, { collection: string; id: string | number }>;
    faults?: unknown;
  }>;
}
