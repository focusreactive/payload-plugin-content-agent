// Run through `payload run` with NODE_ENV unset, so Payload creates its tables first.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPayload } from "payload";
import config from "../src/payload.config";
import { activeSchema } from "../src/schemas";

const camel = (slug: string) => slug.replace(/[-_]+(.)/gu, (_, c: string) => c.toUpperCase());

const schema = activeSchema();
const payload = await getPayload({ config });
const stateFile = path.resolve(process.cwd(), ".state", schema.name, "seed.json");

const existing = await payload.count({ collection: "users" });

// The user comes before the seed, and seed.json after it: a user without seed.json is a seed
// that stopped before its end.
if (existing.totalDocs > 0 && !existsSync(stateFile)) {
  console.error(
    `[lab] ${schema.name}: the database has a user but no ${stateFile}, so an earlier seed stopped before its end. Start again with --fresh.`
  );
  process.exit(1);
}

if (existing.totalDocs > 0) {
  console.log(`[lab] ${schema.name}: the database is already set up`);
} else {
  const email = process.env.LAB_USER_EMAIL || "lab@example.com";
  const password = process.env.LAB_USER_PASSWORD || "lab-password";
  const user = await payload.create({ collection: "users", data: { email, password } });

  // One permission group per collection and global, named by its camelCased slug.
  const all = { find: true, create: true, update: true, delete: true };
  const permissions = Object.fromEntries([
    ...schema.collections.map((c) => [camel(c.slug), all]),
    ...schema.globals.map((g) => [camel(g.slug), { find: true, update: true }]),
  ]);

  await payload.create({
    collection: "payload-mcp-api-keys" as never,
    data: {
      user: user.id,
      label: "lab",
      enableAPIKey: true,
      apiKey: process.env.LAB_MCP_API_KEY || "lab-mcp-key-0000-0000",
      ...permissions,
    } as never,
  });

  const { documents, faults } = await schema.seed(payload);

  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schema: schema.name,
        user: { email, password },
        documents,
        faults,
        ...(schema.localization ? { localization: schema.localization } : {}),
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `[lab] ${schema.name}: seeded ${Object.keys(documents).length} named documents -> ${stateFile}`
  );
}

process.exit(0);
