# @focus-reactive/payload-plugin-content-agent

An AI content agent for Payload CMS 3. The plugin adds a chat panel to the Payload admin. Editors ask the agent in plain language to find, write, edit and translate content. The agent reads your Payload schema, so it works with your own collections, globals, blocks and rich text fields.

What the agent can do:

- Find documents and read their content, including blocks and Lexical rich text.
- Create documents and edit fields, rich text, blocks and arrays.
- Apply one change to many documents at once (bulk edit, find and replace, translation).
- Search the web and import an article from a URL.
- Remember facts about your project between conversations (optional, needs Postgres).

All writes go to drafts. A person reviews the diff in the chat and publishes the change. A collection or global without drafts has no draft: the agent changes a document there only after the person confirms in the chat that the change is live at once, and it creates no document there. Enable `versions.drafts` on what the agent should edit as drafts.

## Requirements

- Payload 3 with the Lexical rich text editor.
- Node.js 22 or newer.
- [`@payloadcms/plugin-mcp`](https://www.npmjs.com/package/@payloadcms/plugin-mcp). The agent reads and writes content through the MCP tools of this plugin.
- An API key for Anthropic or OpenAI.
- Optional: PostgreSQL for memory and chat history. The `pgvector` extension adds vector search. Without `pgvector`, memory uses full text search.

## Installation

```bash
npm install @focus-reactive/payload-plugin-content-agent @payloadcms/plugin-mcp ai @ai-sdk/anthropic
```

Install `@ai-sdk/openai` instead of `@ai-sdk/anthropic` if you use OpenAI.

## Minimal configuration

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { contentAgentPlugin } from '@focus-reactive/payload-plugin-content-agent'

export default buildConfig({
  // ... your config
  plugins: [
    mcpPlugin({
      collections: {
        posts: { enabled: true },
        pages: { enabled: true },
      },
    }),
    contentAgentPlugin({
      provider: 'anthropic', // reads ANTHROPIC_API_KEY
      // The plugin stops at startup if mcpApiKey is empty. Keep the agent disabled
      // until you have created the MCP API key (see the next section).
      disabled: !process.env.MCP_API_KEY,
      mcpApiKey: process.env.MCP_API_KEY ?? '',
      memoryDatabaseUrl: process.env.DATABASE_URI, // optional
    }),
  ],
})
```

The plugin adds a provider component to the admin and one component to the edit view of each collection and global. Generate the import map after you add or update the plugin:

```bash
npx payload generate:importmap
```

### Create the MCP API key

1. Start Payload and open the admin.
2. Go to **MCP API Keys** and create a key.
3. Give the key access to the collections and globals that the agent may use (see [The MCP API key is the permission boundary](#the-mcp-api-key-is-the-permission-boundary)).
4. Put the key in the `MCP_API_KEY` environment variable and restart Payload.

The chat panel is now available in the admin.

## The MCP API key is the permission boundary

Read this section before you give the agent to editors.

- **Every chat user acts with the scope of the one MCP API key.** The scope does not depend on the Payload role of the person who chats. If the key can update `pages`, every person who can open the chat can update `pages` through the agent.
- **The agent receives every tool that the MCP server gives for the key.** The plugin does not filter tools by name. This includes the collection and config tools of `@payloadcms/plugin-mcp`.
- **The agent never deletes documents.** The agent does not get a `delete*` tool of the key. A person deletes a document in the admin.
- **The plugin adds safety checks only to `find`, `create` and `update` tools.** These tools always use drafts, and the plugin refuses an update that removes content the agent did not review. Other tools run without these checks.

Recommended scope for the key:

- Give `find`, `create` and `update` for the collections and globals that editors work with.
- Do not give `delete`. The agent refuses these tools, and without them the tool list is shorter.
- Do not enable the collection or config tools of `@payloadcms/plugin-mcp` on a server that the agent uses.
- When you add a new collection, add it to the key. Existing keys do not get new collections automatically.

Only users of the admin auth collection (`config.admin.user`) can use the agent by default. Use the `access` option to change this:

```ts
contentAgentPlugin({
  // ...
  access: ({ req }) => ['users', 'editors'].includes(req.user?.collection),
})
```

## Content tools for other agents

The plugin can also give its checked content tools to an agent outside the admin, for example a coding agent or a desktop assistant that connects to the MCP endpoint of your site. No model runs inside these tools. Wrap the options of the MCP plugin:

```ts
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { withContentAgent } from '@focus-reactive/payload-plugin-content-agent'

mcpPlugin(
  withContentAgent({
    collections: {
      posts: { enabled: true },
      pages: { enabled: true },
    },
  }),
)
```

The endpoint then has nine more tools next to the default tools of the MCP plugin:

- `getSchemaInfo`, `listDocuments`, `lookupDocuments`, `searchContent`, `checkLinks` and `readDocument` read the content.
- `patchDocument`, `addDocument`, `editDocument` and `replaceText` change it.

Every write of these tools is a draft, is checked before the save, and is refused when it removes or empties content. An API key reads and writes what its `find`, `create` and `update` flags allow. A new key has the nine tools on. On a key that you made before, turn them on in the admin. Give an outside agent a key of its own, not the key in `mcpApiKey`.

The wrap adds one checkbox for each tool to the **MCP API Keys** collection. If your database uses migrations, create and run a Payload migration after you add it.

The second argument selects which default tools of the MCP plugin stay on the endpoint:

```ts
withContentAgent(options, { defaultTools: 'read' })
```

| `defaultTools` | The endpoint has |
|---|---|
| `'all'` (default) | The default tools and the content tools. |
| `'read'` | The default `find` tools and the content tools. |
| `'none'` | Only the content tools. |

With `'read'` and `'none'`, every write through MCP is a checked draft, and a collection or global without drafts takes no write through MCP.

`contentAgentPlugin` is not required for these tools. With it and with memory, a person sees the writes of an outside agent in the chat history, in a conversation named "MCP: <key name>", and reviews them there. See [DOCS.md](DOCS.md#content-tools-on-the-mcp-endpoint).

## Memory

Set `memoryDatabaseUrl` to a Postgres connection string to keep chat history and project memory. This can be the database of Payload or a separate database. The plugin creates its tables in the `content_agent` schema and runs its own migrations at startup. Without `memoryDatabaseUrl`, the agent works without history.

Vector search needs an embedding model. With `provider: 'openai'`, the plugin uses `text-embedding-3-small`. With `provider: 'anthropic'`, pass an embedding model in `embeddingModel`.

### Delete old telemetry

The plugin stores telemetry for every agent run. Call `pruneContentAgentData` from your own scheduled job to delete old rows:

```ts
import { pruneContentAgentData } from '@focus-reactive/payload-plugin-content-agent'

await pruneContentAgentData(process.env.DATABASE_URI!, { olderThanDays: 90 })
```

The function deletes telemetry, background reports and worker rows that are older than `olderThanDays` (default 90). It does not delete conversations or memory.

## Deploy to Vercel

The AI SDK packages load at runtime. Add them to `next.config` so that Vercel includes them in the server functions:

```js
// next.config.mjs
const nextConfig = {
  serverExternalPackages: ['@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/mcp'],
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@ai-sdk/anthropic/**/*',
      './node_modules/@ai-sdk/openai/**/*',
      './node_modules/@ai-sdk/mcp/**/*',
    ],
  },
}
```

Set `serverURL` in the Payload config to the public URL of the site. The agent calls the MCP endpoint of the same site through this URL. Without `serverURL`, the agent uses `http://localhost:<PORT>`. On a host where the site does not answer on localhost, such as a serverless deployment, `serverURL` is required (or a full URL in `mcpUrl`).

## Options

| Option | Default | Description |
|---|---|---|
| `mcpApiKey` | required | MCP API key. See [The MCP API key is the permission boundary](#the-mcp-api-key-is-the-permission-boundary). |
| `provider` | - | `'anthropic'` or `'openai'`. Selects default models. You must set `provider` or `model`. |
| `model` | per provider | Main model. A model id (needs `provider`) or an AI SDK `LanguageModel`. |
| `backgroundModel`, `subagentModel` | per provider | Models for memory tasks and sub-agents. |
| `apiKey` | env var | Provider API key. Overrides `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. |
| `memoryDatabaseUrl` | - | Postgres connection string. Turns on memory and chat history. |
| `reasoningEffort` | `'none'` | How much the main model reasons before it answers: `'none'`, `'low'`, `'medium'` or `'high'`. More is slower. |
| `ltmCurator` | `false` | Lets a background model save preferences to long-term memory by itself after a turn. |
| `turnTokenBudget` | `3000000` | The most tokens one chat request may use, all agents together. The agent then stops and says so. `0` disables. |
| `telemetry` | `'usage'` | What a telemetry row keeps. `'usage'`: steps, tool names, timings, tokens and errors. `'full'` also keeps the input of every tool call and the start of its result. |
| `embeddingModel` | per provider | AI SDK embedding model for vector search. |
| `collections`, `globals` | all | Limit the collections and globals that the agent sees. |
| `access` | admin users | Function that decides who can use the agent. |
| `customInstructions` | - | Text that the plugin adds to the system prompt. |
| `instructions` | off | Editable instructions in the admin. Adds a global. |
| `chatRating` | `false` | Shows a 1-5 star rating under the chat. |
| `mcpOnly` | `false` | The agent uses the MCP tools only, with no Local API behind them. Globals are then out of its reach. |
| `imageInput` | `true` | The agent can look at a picture of an upload collection, for example to write its alt text. Set `false` for a model that takes no picture. |
| `bulkConcurrency` | `5` | Number of documents that a bulk edit processes in parallel. |
| `mcpUrl` | `<routes.api>/mcp` | Path or full URL of the MCP endpoint. |
| `apiRoute` | `'/content-agent/chat'` | Path of the chat endpoint. |
| `disabled` | `false` | Turns the plugin off without removing it from the config. |

[DOCS.md](DOCS.md) describes every option and the internals of the plugin.

## License

MIT
