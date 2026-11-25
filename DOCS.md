# @focus-reactive/payload-plugin-content-agent: reference

This document describes every option of the plugin and how the plugin works inside. For installation, start with the [README](README.md).

All endpoint paths in this document are relative to the Payload API route (default `/api`). For example, `/content-agent/chat` is served at `/api/content-agent/chat`.

## Contents

- [How the plugin works](#how-the-plugin-works)
- [Options](#options)
- [Safety and security](#safety-and-security)
- [One chat turn](#one-chat-turn)
- [Schema introspection](#schema-introspection)
- [Reading and writing documents](#reading-and-writing-documents)
- [Tools](#tools)
- [The Content Editor and its checks](#the-content-editor-and-its-checks)
- [Bulk edits](#bulk-edits)
- [Review and publish](#review-and-publish)
- [Content tools on the MCP endpoint](#content-tools-on-the-mcp-endpoint)
- [Writing a module](#writing-a-module)
- [Editable instructions](#editable-instructions)
- [Chat attachments](#chat-attachments)
- [Memory](#memory)
- [HTTP endpoints](#http-endpoints)
- [Admin UI](#admin-ui)
- [Telemetry](#telemetry)
- [Limits and known limitations](#limits-and-known-limitations)
- [Source map](#source-map)

## How the plugin works

The plugin has five parts:

1. **Schema introspection.** At the first request, the plugin reads your Payload config and builds a description of your collections, globals, fields and blocks. The agent gets this description in its system prompt.
2. **The orchestrator.** The main agent talks with the editor, reads content and decides what to do. It runs as an AI SDK `ToolLoopAgent`.
3. **Sub-agents.** The orchestrator gives content changes to the Content Editor. The Content Editor writes plain fields, structure and rich text itself. A Reviewer checks the result before the save.
4. **Document access.** All reads and writes go through one layer (`DocumentIO`). It uses the MCP tools of `@payloadcms/plugin-mcp` when they exist and the Payload Local API when they do not.
5. **Memory (optional).** With a Postgres database, the plugin stores chat history, long-term memory, telemetry and the changes of each conversation.

All agent writes are drafts where the target has drafts. A person reviews the change in the chat panel and publishes it. A target without drafts is written only after the person confirms the live change in the chat.

## Options

Pass the options to `contentAgentPlugin()`. Only `mcpApiKey` is required, plus `provider` or `model`.

### Models and provider

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | `'anthropic' \| 'openai'` | none | Selects the default models and the provider client. |
| `model` | `string \| LanguageModel` | see below | Main model (the orchestrator). A string needs `provider`. |
| `subagentModel` | `string \| LanguageModel` | see below | Model for the Content Editor and the Reviewer. A string needs `provider`. Without `provider`, falls back to `model`. |
| `backgroundModel` | `string \| LanguageModel` | see below | Model for memory tasks: distillation, long-term memory curation and `reflect`. A string needs `provider`. Falls back to `model`. |
| `reasoningEffort` | `'none' \| 'low' \| 'medium' \| 'high'` | `'none'` | How much the main model reasons before it answers. See below. |
| `embeddingModel` | `EmbeddingModel` | see below | Embedding model for vector search in memory. A string needs `provider`. The embedding columns take the size of its vectors. |
| `apiKey` | `string` | env var | Provider API key. Overrides `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Not used for models that you pass as instances. |

The plugin stops at startup if neither `provider` nor `model` is set, or if `model` is a string and `provider` is not set.

Default models:

| | Anthropic | OpenAI |
|---|---|---|
| `model` | `claude-sonnet-5-5` | `gpt-6.1-terra` |
| `subagentModel` | `claude-haiku-5-5` | `gpt-6-luna` |
| `backgroundModel` | `claude-haiku-5-5` | `gpt-6-luna` |
| `embeddingModel` | none | `text-embedding-3-small` |

The plugin loads the provider package (`@ai-sdk/anthropic` or `@ai-sdk/openai`) at the first request. If the import fails, the next request tries again.

`reasoningEffort` sets how much the main model reasons before it answers: `'none'` (the default), `'low'`, `'medium'` or `'high'`. It applies to the main agent on both providers; the sub-agents use the default of their provider. A model that cannot turn reasoning off gets its lowest level for `'none'`. With OpenAI, the plugin asks for a reasoning summary (`reasoningSummary: 'auto'`), and the chat shows it; with `'none'` there is nothing to show. Reasoning makes each turn slower: on a test project, a turn took about 7 seconds with `low` and 22-36 seconds with `medium`, and only `medium` returned summary text.

### Access and scope

| Option | Type | Default | Description |
|---|---|---|---|
| `mcpApiKey` | `string` | required | API key of `@payloadcms/plugin-mcp`. The plugin stops at startup if it is empty. See [Safety and security](#safety-and-security). |
| `mcpUrl` | `string` | `<routes.api>/mcp` | Path or full URL of the MCP endpoint. The default follows `routes.api` of your Payload config (`/api/mcp` when you did not change it). A path is resolved against `serverURL`, then `http://localhost:<PORT>` (default port 3000). The address of the request is never used: the call carries the MCP key. A site that is not reached on localhost, such as a serverless deployment, needs `serverURL` or a full URL here. When the endpoint cannot be reached, the chat answers with status 503 and a message that names the URL. |
| `access` | `({ req }) => boolean \| Promise<boolean>` | admin users | Decides who can use the agent endpoints. By default, only users of the admin auth collection (`config.admin.user`). If the function throws, access is denied. |
| `mcpOnly` | `boolean` | `false` | The agent reads and writes content through the MCP tools only, with no Local API behind them. See [The Local API path](#the-local-api-path). |
| `imageInput` | `boolean` | `true` | The agent gets the tool `viewImage` when the schema has an upload collection. The tool loads a png, jpeg, webp or gif file by its address (a stored size of at least 768 pixels when Payload made one, at most 5 MB) and gives it to the model with the result. A picture of another type (avif, svg, tiff and others) with no such stored size is converted to WebP of at most 1568 pixels with the `sharp` of the Payload config; without `sharp` the tool says that it cannot show the file. A relative address of a file is resolved against `serverURL`, else against the origin of the MCP endpoint (`mcpUrl`), never against the origin of the request. The request goes to the address of the file with the login of the person who chats, so the person's read access applies; the login is sent only to the host of the site and to no host that it redirects to. Set `false` when the model takes no picture as input: the tool is then not there. |
| `collections` | `string[]` | all | Collections that the agent sees. Modules read the list too (`ConfigContext`). |
| `globals` | `string[]` | all | Globals that the agent sees. |
| `disabled` | `boolean` | `false` | Returns the Payload config unchanged. |

### Prompt and behaviour

| Option | Type | Default | Description |
|---|---|---|---|
| `customInstructions` | `string` | none | Text added to the system prompt under "Additional Instructions". |
| `instructions` | `boolean \| object` | off | Instructions that editors maintain in the admin. See [Editable instructions](#editable-instructions). |
| `schemaPromptMode` | `'full' \| 'compact' \| 'auto'` | `'auto'` | How the schema appears in the system prompt. See [Schema introspection](#schema-introspection). |
| `modules` | `Array<ContentAgentModule \| ContentAgentModule[]>` | none | Extensions built on the module SDK (`@focus-reactive/payload-plugin-content-agent/sdk`). They run in array order, after the plugin's own changes. An entry can be an array of modules, for a package that ships several: `modules: [somePackage(), myModule]`. |
| `chatRating` | `boolean` | `false` | Shows a 1-5 star rating under the chat and adds the `/content-agent/rating` endpoints. Needs memory. |
| `apiRoute` | `string` | `'/content-agent/chat'` | Path of the chat endpoint. The admin UI reads it from the config, so a custom path works without other changes. |

### Bulk edits

| Option | Type | Default | Description |
|---|---|---|---|
| `bulkConcurrency` | `number` | `5` | Documents that `editContent` and `translateContent` process in parallel. |
| `findReplaceConcurrency` | `number` | `min(max(bulkConcurrency * 2, 10), 25)` | Documents that `findReplaceContent` processes in parallel. It uses no model, so it can run higher. |
| `bulkTimeBudgetMs` | `number` | `180000` | Time from the start of the chat request after which a bulk edit starts no new documents. The rest come back as `remaining` for the next turn. `0` turns the budget off. |

### Memory

| Option | Type | Default | Description |
|---|---|---|---|
| `memoryDatabaseUrl` | `string` | none | Postgres connection string. Turns on memory, chat history, telemetry and the tables of the modules. |
| `ltmCurator` | `boolean` | `false` | After a turn, a background model reads the conversation and saves the user's preferences and patterns to long-term memory by itself. Off: nothing is saved to long-term memory after a turn. |
| `turnTokenBudget` | `number` | `3000000` | The most tokens one chat request may use: input and output of every agent together, cached input counted in full. When it is reached, the agent stops after its current step and says so, and a bulk run starts no new documents (the rest continues with the next message). `0` disables. |
| `telemetry` | `'usage'` or `'full'` | `'usage'` | What a telemetry row keeps. See [Telemetry](#telemetry). |
| `contextBudget.compactionThreshold` | `number` | `30000` | Token size of the conversation view above which the plugin summarizes older messages. |
| `contextBudget.compactionHardLimit` | `number` | `60000` | Token size above which the oldest messages that no summary covers are left out of the prompt. |
| `contextBudget.recencyBufferMessages` | `number` | `6` | Newest messages that are never summarized or left out. |
| `contextBudget.compactionTarget` | `number` | `20000` | Accepted, but not used at the moment. |

## Safety and security

### Access control on the MCP path

The agent reads and writes collections through the MCP endpoint of the same site, with the one `mcpApiKey`. This has three consequences:

- **Every chat user acts with the scope of the key.** The scope does not depend on the Payload role of the person in the chat. If the key can update `pages`, every person who can open the chat can update `pages` through the agent.
- **The agent can use every tool that the MCP server gives for the key, except `delete*` tools.** The plugin does not filter tools by name. The model calls the `find`, `create` and `update` tools of your collections and globals through five document tools that take the collection as a parameter (`listDocuments`, `readDocument`, `findDocuments`, `createDocument`, `updateDocument`), so its tool list does not grow with the schema. Every other tool of the server goes to the model under its own name. This includes the config tools of `@payloadcms/plugin-mcp`.
- **The agent never deletes documents.** A tool whose name starts with `delete` does not reach the agent. The server log names these tools at start.
- **Only `find`, `create` and `update` tools for your collections and globals get the safety wrappers** (drafts, the destructive-update gate, change recording). Other tools run as the MCP server defines them.

For this reason, the default `access` option allows only users of the admin auth collection. Widen it on purpose only.

The plugin prints a warning about the shared scope once per MCP URL.

### The Local API path

Globals, and collections for which the key has no MCP tool, go through the Payload Local API with `overrideAccess: false` and the calling user. Here the normal Payload access control of that user applies.

A write also goes this way when the MCP update tool of the collection cannot take the document: a field with the name of a control parameter of the tool, or a `null` in a field for which the tool takes no `null` (an empty optional select in a row of a block). This path does not pass the flags of the MCP key.

With `mcpOnly: true` the agent has no Local API path. Every read and write of content goes through an MCP tool of the key, so the flags of the key are the whole access of the agent. The cost:

- A collection without an MCP tool for the operation is out of reach, and the tool error says so.
- Every global is out of reach: the agent reads and writes globals through the Local API only.
- A document with a `null` that the update tool refuses is sent without that `null` when it is inside a row or a group. On the first level the tool refuses the write, so the agent cannot empty such a field.
- The scan of the Initialize button follows the same rule.

`POST /content-agent/publish` and `GET /content-agent/diff` (without a session snapshot) also use the Local API as the calling user. A user who cannot publish a collection in the admin cannot publish it through the chat either.

### Drafts

- The agent writes drafts where the target has drafts. A collection or global without drafts has no draft state, so a change there is live at once. In the chat, `updateDocument`, `editContent`, `findReplaceContent` and `translateContent` run on such a target only after the person confirms a card that says the change is live. The card comes with every such tool call, also for one document. The confirmation opens only the documents that the confirmed call named, or its one global, until the request ends: the saves inside the call pass, and a write to another document of the same collection needs a card of its own. The agent creates no document in a collection without drafts: the tool refuses and names the admin and `versions.drafts`. An agent outside the admin gets no card, so the tools of the MCP endpoint refuse every write to such a target. The server log lists these targets once at start. The schema text marks them for the model.
- Agent writes through MCP always send `draft: true` and `_status: 'draft'`.

### Document locks

- The agent does not write to a document or global that another person has open in the admin. The plugin reads Payload's lock (`payload-locked-documents`) with the same rule as Payload: a lock of another user that is younger than `lockDocuments.duration` (default 300 seconds) stops the write. The chat user's own lock does not.
- The check runs when the Content Editor opens the document and again before every write, on the MCP path and on the Local API path. The refusal tells the person to ask the colleague to close the document or to wait until the lock ends.
- With `lockDocuments: false` on a collection or global there is no check for it. When the lock cannot be read, the agent does not write.
- Reads get `draft: true` as a default, so the agent reads the latest draft.
- A reader tool that has no `draft` parameter gets a note in its description that it returns published content only.
- `filePath` and `overwriteExistingFiles` are removed from every write.

The agent cannot publish. Only a person can, from the review panel.

### Destructive-update gate

Before an `updateDocument` call, the plugin reads the current document and checks the change:

- **Refused without override:** writes to read-only fields and to field types that the plugin does not model.
- **Confirmed by the person:** a cleared reference, rich text that is replaced or shrinks below half of its nodes, a filled field that becomes empty, removed array items, and every change to a document of an auth collection (an account). The update does not run when the agent calls it. The chat shows a card that names what will be removed, with Confirm and Cancel. The update runs only after the person confirms. One click allows one tool call. The agent has no parameter or tool that replaces the click.
- **Refused:** an update with a multi-document `where` and no `id`.
- If the plugin cannot read the current document, it refuses the write, unless every value in the write is a non-empty scalar.

`createDocument`, `updateDocument` and every `create*` and `update*` tool that the agent sees also refuse parameters that contain arrays of blocks. The agent changes blocks through the block tools of the Content Editor instead.

### Untrusted input

The output of `web`, `importArticle` and every module tool wrapped in `markUntrusted` counts as untrusted. After a turn has used one of these tools, `proposeGlossaryEntry` refuses to propose a glossary line for the rest of the turn. This stops a web page from planting a line that a person would then add for every user.

### Schema disclosure

The schema description is the same for every user. It ignores field-level and collection-level read access, because those are functions of a request and a document. A user of the chat can learn the shape of a collection that they cannot read.

### Rate limit

The chat endpoint allows 20 requests per minute per user, counted in the memory of each server process.

## One chat turn

1. `POST /content-agent/chat` passes the access check, introspects the schema (first request only) and connects memory.
2. The handler checks the request size and starts `runAgent`.
3. Attachments are converted (see [Chat attachments](#chat-attachments)).
4. With memory, the plugin checks that the conversation belongs to the user (another user's conversation returns 404), saves the user message and builds the context from summaries, recent messages, long-term memory and background reports.
5. The plugin connects to the MCP endpoint and runs the `turn` of each module in parallel.
6. It loads the editable instructions and builds the system prompt in two parts:
   - a **stable** part (persona, rules, schema, rich text format, custom instructions, `always` instructions), sent with Anthropic prompt caching;
   - a **volatile** part (memory, tool availability, the notes of the modules, the page that the editor has open).
7. It builds the tool set and starts a `ToolLoopAgent` with a limit of 30 steps and 16000 output tokens. The response is an AI SDK UI message stream.
8. If the final answer claims a write but no write happened, the plugin adds a warning to the answer. If the model stops before it finishes (a finish reason other than `stop` or `tool-calls`, for example `length` or `other`), the plugin adds a note that nothing more was done, to the live answer and to the saved answer.
9. At the end, the plugin writes telemetry, saves the answer, sets the conversation title from the first message and starts background memory tasks.

The Stop button in the chat aborts the request. The plugin then saves `[response stopped by user]` as the answer.

The plugin sends earlier answers back to the model as plain text. It does not send the model's reasoning from earlier turns, and it removes the OpenAI item ids from earlier answers: OpenAI rejects an answer item that comes without its reasoning item.

If a step or the provider fails, the plugin logs the full error on the server, and the chat shows the reason (for example, "The AI provider rejected the request (400): …"). Without this, the AI SDK shows "An error occurred." for every error.

## Schema introspection

The plugin reads the sanitized Payload config once, at the first request, and keeps the result for the life of the process.

What it captures:

- Collections and globals, except collections whose slug starts with `payload-` and collections with `admin.hidden: true`. The `collections` and `globals` options limit the set further.
- For each collection: labels, description, versions, drafts, auth, timestamps, upload, `useAsTitle`.
- Localization: the locales and the default locale. Localized fields are marked.
- Fields: text, number, textarea, email, code, date, json, point, richText, checkbox, select, radio, relationship, upload, array, blocks, group and join (read only). Other named field types are shown and marked unsupported. The agent cannot write them.
- `ui` fields are dropped. Tabs, collapsibles, rows and unnamed groups are flattened. A named tab becomes a group.
- For each field: required, localized, description, read only (`admin.readOnly`), conditional (`admin.condition`), primitive default values, min and max rows.
- Rich text: the plugin detects Lexical. Slate and other editors are marked unsupported. Blocks and inline blocks inside Lexical (`BlocksFeature`) are included, also when they are block references. Each rich text field carries the node types and the text formats of its own editor. A write that adds another one is refused and the refusal lists what the editor has. `importArticle` does not refuse: it drops markup the editor does not have and keeps the text.

### `schemaPromptMode`

- `full`: every collection, global and block with all fields.
- `compact`: blocks by slug and label only. The agent asks for details with `getSchemaInfo`.
- `auto` (default): `full`, unless the result is longer than 24000 characters. Then `compact`.

## Reading and writing documents

`DocumentIO` is the one layer for reads and writes:

- **Collections:** MCP when the key has `find`, `create` or `update` for the slug. Otherwise the Local API as the calling user. If neither is available, the agent has no access.
- **Globals:** always the Local API as the calling user.
- **Reads** use `draft: true` and `depth: 0`.
- **Locale** is passed through when the agent sets it.
- **Field names that clash with MCP parameters** (for example a field called `where`) are written through the Local API.

### MCP client

- Sends `Authorization: Bearer <mcpApiKey>`.
- Connect and tool listing time out after 15 seconds.
- A tool call times out after 60 seconds, also on a server that a module connects with `getMcpServerTools`. The agent is told that the call did not answer. For a call that writes, it is told to read the result before it calls again.
- One client per URL is kept for the life of the process and shared by concurrent requests. A new key closes the old client.
- Tool names follow the plugin-mcp convention `find<Slug>`, `create<Slug>`, `update<Slug>`, `delete<Slug>`. The plugin compares names without case, `-`, `_` or spaces.
- Every other tool of the site's MCP server reaches the model as it is. When such a tool fails, its error says that the failure is in the site's tool and names `readDocument`, `updateDocument` and `editContent`, which do the same work without it.

## Tools

The orchestrator receives these tools:

### Read

| Tool | What it does | Present |
|---|---|---|
| `readDocument` | Reads one document or global: a summary of fields, the section structure without rich text bodies (`view: "outline"`), the full text in pages (`view: "text"`), every link (`view: "links"`), the saved versions with their dates and what each changed (`view: "history"`, through the Local API), or one raw field (`path`). | always |
| `listDocuments` | Lists documents with a `where` filter and the exact total. | always |
| `findDocuments` | Finds documents by name across all collections. | always |
| `searchContent` | Searches text inside content fields on the server. It also finds an address that a field stores percent-encoded (`a%2Db` for `a-b`). | always |
| `checkLinks` | Checks every link of one collection in one call. It groups the links by target and gives the state of each target: a published document, a document that was never published, an address that no document has, an address that another document holds as its key, no address, another site. | always |
| `viewImage` | Shows the model the file of one document of an upload collection (png, jpeg, webp, gif; another type is converted with the `sharp` of the Payload config), so it can write an alt text or a caption from what the picture shows. | the schema has an upload collection and `imageInput` is not `false` |
| `getSchemaInfo` | Shows the schema of a collection, global or block. | always |

### Write

| Tool | What it does | Present |
|---|---|---|
| `editContent` | Gives a change to the Content Editor: one document, a global, or many documents by `ids` or `where`. | always |
| `translateContent` | Same pipeline, writes to a target locale. | always; refuses when the project has no locales |
| `findReplaceContent` | Literal find and replace across documents, no model. | always |
| `createDocument` | Creates a draft document. | always |
| `updateDocument` | Sets fields of one document or global, saved as a draft. A field with many values (`hasMany`) takes `add` and `remove`: the tool reads the current list of the draft and changes only the named entries, so the agent never types the list again. With `preview: true` it shows the diff and the warnings of the planned update. A preview writes nothing and unlocks nothing. After a write the answer has the saved document and the length in characters of each text value that the update stored, so the agent checks a length limit against the saved value. | always |
| `cloneDocument` | Copies an existing document into a new draft. | always |
| `getBlockLibrary` | Lists block types, how often each is used and example documents. | always |
| `copyBlock` | Copies blocks unchanged from one document to another. | always |
| MCP tools | All tools of the Payload MCP server for the key. | when the server has them |

Every result of a write tool carries `writeStatus`. The chat cards and the check for a turn that saved nothing read this field. They do not read the words of a result or of the reply.

| `writeStatus` | Meaning |
|---|---|
| `done` | The change is saved as a draft. |
| `needs-confirmation` | The call needs the person's click and did not have it. Nothing was written. |
| `needs-input` | The editor stopped with a question for the person. Nothing was written. |
| `nothing-changed` | The document already has the value, or the selection matched no document. |
| `live-write` | A tool with no `draft` parameter wrote to the live site. Only a tool outside the agent's schema can do this. |
| `failed` | The call was refused or failed. Nothing was written. |

For one document, the edit card in the chat shows the status, the list of changes, the open issues and the question of the editor. The list comes from the diff of the document, not from the model.

### Web

| Tool | What it does | Present |
|---|---|---|
| `web` | `search` (DuckDuckGo) or `fetch` (a page as Markdown, up to 12000 characters). `fetch` takes only an address the agent found: in the conversation, in a search result or in a tool result. Any page of the site itself and of a site the person named is also allowed. | always |
| `importArticle` | Imports an article from a URL as a draft with Lexical content. | always |

### Memory and history

| Tool | What it does | Present |
|---|---|---|
| `reflect` | Searches past conversations and long-term memory, and answers from them. | with memory |
| `proposeGlossaryEntry` | Proposes one glossary line after a person explains what a block, a collection or a term means. It saves nothing. A person adds the line to the instructions. | with `instructions` |
| `present_progress` | Keeps the goal, status and task list of the conversation. | with memory |

### Showing data

`present_table`, `present_metrics` and `present_chart` return a description that the chat UI draws as a table, metric tiles or a chart. They are always present.

The chat draws any tool result that carries the visual marker, whatever the tool's name. A module gets the same cards by returning `visualResult('table' | 'metrics' | 'chart', spec)` from the SDK. A drawn result is saved with the message and drawn again when the conversation is reopened.

### Other tools

- Tools of the modules in `modules` (see [Writing a module](#writing-a-module)).

If a module tool has the same name as a built-in tool, the plugin skips it with a warning.

### Output size

Results of Payload MCP tools, `readDocument` and `listDocuments` are capped at 40000 characters. A module caps the results of its own tools with `capMcpToolOutput`. For JSON results, the plugin drops rows from the largest array, so the result stays valid JSON and says how many rows it dropped.

## The Content Editor and its checks

`editContent` and `translateContent` start the Content Editor, a sub-agent with its own tools for blocks, arrays, fields and rich text. The editor runs up to 80 steps for one document and 60 steps per document in a bulk edit. It can run at most two sessions per document in one request. Each session starts with the list of the fields and the structure of the document (`getEditableContent`) already in the conversation: the plugin makes this first read, so the editor spends no model step on it.

How one edit works:

1. The editor declares the expected outcome as criteria (`declareOutcome`), before it changes anything. Criteria types: `absent`, `present`, `nonEmpty`, `unchanged`, `changed`, `countAtMost`, `judgement`.
2. It makes the changes. For prose in rich text it works on a keyed Markdown view of the Lexical tree and changes only the parts it must change. A named phrase, sentence or list item is removed by its text (`removeText`): a whole list item goes when its list keeps another item, and the list is numbered again. A surgical `remove` takes a whole node, so it is refused when its anchor is in only some entries of the node, for example one item of a list. A field with many values (`hasMany`) takes `add` and `remove` in `setValues`: they name only the entries that change, and every other entry stays, so the editor never types the list again.
3. It calls `finishEdit` with its summary of the work. The plugin checks the criteria against the document and runs the write checks below. For up to three rounds, a failed check sends the editor back to fix it. When the checks accept a changed document, the session ends with this call: the editor writes no separate final text.
4. The code reads the kind of change from the two versions of the document. A change is `text` when only values inside existing fields changed and every rich text kept its nodes, links and embedded items. Every other change is `structure`: a reference, the set or order of rows or blocks, a node, a link.
5. The Reviewer (one model call) reads the task, the diff and the open questions and gives a verdict. It runs for a `structure` change, for a translation, for a question the editor left to a reader, and for an edit with no declared outcome that the code checked. A `text` change with a checked outcome gets no Reviewer: the checks and the list of changes are the evidence. A rejection does not stop the save, so the Reviewer reads while the draft is written. The rejection is shown to the person with the draft. The telemetry has a `review_skipped` row for each edit without the Reviewer.
6. The plugin saves the draft.

When one document is edited and the task needs a fact that only the person has, the editor can stop with a question (`askPerson`). Nothing is saved then. The chat shows the question, and the edit starts again with the answer.

### Write checks

| Check | What it refuses |
|---|---|
| Shrink | A field of 300 or more characters that becomes shorter than half (a fifth for translations), unless the task asks to shorten. |
| Protected values | Times, emails, measures and amounts of money that disappear without the task naming them. |
| Remove | When the task names items to remove, removal of other items. |
| Add a section | An "add a section" task that ends with no more blocks than before. |
| Neighbour overlap | A text segment that copies 12 or more characters of the segment next to it. |
| Empty segment | A text segment that becomes empty is removed when its paragraph, list item or table cell keeps other text. The only text of one, and the text of a link, cannot become empty: the editor removes the whole paragraph or the link by its own operation. |
| Shifted entry | A new value that equals or contains the text of another entry. |
| Duplicates | A passage that the document already has somewhere else. |
| Links | Links that remain when the task asked to remove them. |
| New internal links | A new link that matches no document. If the site returns 404 for it, the link is removed and its text is kept. If the plugin cannot check it, the link stays and is reported. Links that the person wrote in the task are never checked. |
| Link labels | A label next to a link that loses the words naming the page the link opens, while the target stays. A link that is repointed at the document it is in. What the editor does not fix is put back as it was before the save and reported. A label that the person names with its old and new text is left alone. |
| Unchanged with work left | A session that ends with an unchanged document while a declared `absent`, `countAtMost` or `itemRemoved` criterion fails. The editor is sent back two times at most. |
| Empty sections | A section that ends with no content. Always blocks the save. |

## Bulk edits

- `editContent` and `translateContent` accept many documents by `ids` or by `where`. A `where` selection is capped at 1000 documents.
- One request changes at most 5 documents without the person's click, whatever tool writes them. The plugin counts the documents in the write layer, so a model cannot pass the limit with single updates: from the sixth document on, the chat asks about each one, and a write with no click is refused. A request that goes on after a click keeps its count. New documents do not count. Writes of a module and of the site's own MCP tools do not pass the write layer and are not counted.
- A run on more than 5 documents (`editContent`, `translateContent`, `findReplaceContent`) needs the person's click. A run on fewer documents also needs it when the request reaches more than 5 with it. The chat shows a card with the count and the change, with Confirm and Cancel. The plugin fixes the list of documents when it shows the card: the run after the click covers exactly that list. The agent has no parameter that replaces the click.
- A run on a collection without drafts needs the click for any number of documents, also for one. The card then says that the change is live at once. See [Drafts](#drafts).
- The server signs each confirmation request with a key derived from the Payload secret. A request with an approval that the server did not sign is refused.
- A confirmation card is not stored in the chat history. After a page reload the person asks again.
- Documents run in parallel up to `bulkConcurrency`. Each document has a timeout of 120 seconds.
- When `bulkTimeBudgetMs` runs out, the edit finishes the documents in progress and stops. The rest is stored on the server (in the database with memory, in process memory without it) and continues with `continue: true` on the next turn. Stored work expires after 24 hours.
- The Stop button skips documents that have not started.
- `findReplaceContent` uses `findReplaceConcurrency` and is not limited by `bulkTimeBudgetMs`.

## Review and publish

The plugin records every document that the agent changed in a conversation (a changeset). It stores the document as it was before the first change and after the last change. This needs memory.

The review panel in the chat:

1. Lists the changed documents (`GET /content-agent/changes`).
2. Shows a summary above the list when two or more documents changed. The server builds it from the stored versions, not from the model: the number of documents by kind of change (text only, structure, new), the fields that most documents of a collection changed, and how many documents differ from that. Documents with open issues come first in the list, then the documents that differ.
3. Shows for an opened document the diff of its content and nothing else (`GET /content-agent/diff`). With a stored snapshot, the diff covers the changes of this conversation. Without one, it compares the published version with the current draft.
4. Publishes the selected documents (`POST /content-agent/publish`). The plugin sets `_status: 'published'` through the Local API as the person who clicks. Errors, for example a required field that is empty, are reported per document.
5. Discards the changes of the selected documents (`POST /content-agent/discard`), after a second click.

Globals appear as `global:<slug>`.

### Bring a document back

A discard puts a document back to its state from before the conversation changed it. The plugin reads that state from the changeset and writes it through the Local API as the person who clicks, as a draft. Access rules apply, and a document that another person has locked is refused.

- Only the fields that the conversation changed are written. The other fields stay as they are now.
- A field that someone changed after the agent is kept, and the panel says so. A second click ("Discard those too") writes the stored value over it.
- A document changed in several locales has one stored state per locale. Each locale goes back to its own values. A value that was empty in a locale is empty again: nothing is taken from another locale.
- A document that the conversation created stays. The agent removes nothing: delete it in the admin.
- When the changes were already published, the discard makes a draft with the old values. Publish it to put the old values live.
- The row stays in the list, marked "discarded". A later change in the same conversation is compared with the same first state.

To do the same without the panel: `POST /content-agent/discard` with `{ conversationId, documents: [{ collection, id }], force? }`. The answer has one result per document and locale: `restored`, `unchanged`, `changed-since` (with the fields that were kept; send `force: true` to write them too), `created`, `no-snapshot` or `failed`.

## Content tools on the MCP endpoint

`withContentAgent` adds the checked content tools of the plugin to the MCP endpoint of the site. An agent outside the admin connects to the endpoint with an MCP API key and uses them. No model runs inside these tools, and every limit is in code.

```ts
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { withContentAgent } from '@focus-reactive/payload-plugin-content-agent'

mcpPlugin(
  withContentAgent(
    {
      collections: { posts: { enabled: true }, pages: { enabled: true } },
      globals: { 'site-settings': { enabled: true } },
    },
    { defaultTools: 'all' },
  ),
)
```

- Pass the final options of the MCP plugin. `withContentAgent` adds its tools to `mcp.tools`, adds its text to `mcp.serverOptions.instructions` after your own, and wraps `overrideAuth` to read the settings of the key of each request. Your own `overrideAuth` still runs first.
- `contentAgentPlugin` is not required. The tools work on a site that has only the MCP plugin.
- A tool of your own in `mcp.tools` with the name of a content tool stops the start with an error.
- The MCP plugin adds one checkbox for each tool to the **MCP API Keys** collection, under **Tools**. This changes the database schema of that collection. A new key has every tool on. A key from before has them off until a person turns them on.

### The tools

| Tool | What it does | Key flag |
|---|---|---|
| `getSchemaInfo` | Returns the collections, globals, fields, field types and locales that the key can read. With `target`: the full schema of one collection, global or block. | `find` |
| `listDocuments` | Lists the documents of one collection with a `where` filter and the exact total. | `find` |
| `lookupDocuments` | Finds documents by name across the collections. | `find` |
| `searchContent` | Searches a text inside the content of one collection. | `find` |
| `checkLinks` | Checks every link of one collection in one call and gives the state of each target, from the documents of the site. It sends no request to the live site. | `find` |
| `readDocument` | Reads one document or global: a summary, the section structure (`view: "outline"`), the full text in pages (`view: "text"`), every link (`view: "links"`), the saved versions (`view: "history"`) or one raw field (`path`). | `find` |
| `patchDocument` | Sets fields of one document or global. `add` puts entries into a field with many values (`hasMany`) and keeps every entry the field holds. With `preview: true` it writes nothing and returns the diff and the warnings. | `update` |
| `addDocument` | Creates a document. | `create` |
| `editDocument` | Changes rich text, blocks and array rows of one document or global with a list of operations: `set`, `insertItem`, `moveItem`, `replaceText`, `insertText`, `replacePart`. `set` with `add` puts entries into a field with many values (`hasMany`) and keeps every entry the field holds. All operations apply, or nothing is written. With `preview: true` it writes nothing. | `update` |
| `replaceText` | Replaces one exact string in the documents that the call names. | `update` |

The description of each tool on the endpoint ends with the list of its parameters.

### Access

- A tool works on a collection or global when the options enable the operation for the slug and the key has the flag of that operation. A write tool does not need the `find` flag.
- All reads and writes go through the Local API with `overrideAccess: false`, as the user of the key. The access control of that user applies.
- The `collections` and `globals` options of `contentAgentPlugin` do not limit these tools. The flags of the key do.
- An error for a target that the key cannot use lists what the key can use.

### Write rules

- Every write is a draft. Nothing is published. A collection or global without drafts is refused.
- An update that removes or empties content is always refused. There is no confirmation and no flag that allows it. The refusal names what would be lost, so the outside agent can tell the person. No tool deletes a document.
- A document that a person has open in the admin is refused (see [Document locks](#document-locks)).
- `patchDocument` and `addDocument` refuse a blocks field. `editDocument` changes blocks.
- `editDocument` checks the result before the save. It blocks an edit that leaves a new section empty, that cuts most of the text of a field, or that adds a link to a page of the site that answers 404. It asks only the host of `serverURL`: a link to another host is not checked and is reported as not verified. It saves and reports other findings in `issues` with the status `savedWithIssues`: links that it could not verify, lost values such as times, prices and URLs, new duplicates, malformed tables and an unfinished rename.
- `replaceText` takes any number of ids. It works on five documents at a time. The handler of the MCP plugin stops after 60 seconds by default, so set `mcp.handlerOptions.maxDuration` for long lists on a serverless platform. Documents that were saved before the stop stay saved as drafts.

### The `defaultTools` option

The MCP plugin registers its own tools (`find*`, `create*`, `update*`, `delete*`) for each collection and global from the flags of the key. `defaultTools` selects which of them stay on the endpoint.

| Value | The endpoint has | Server instructions |
|---|---|---|
| `'all'` (default) | The default tools and the content tools. | Describe both sets and tell the agent to prefer the content tools for work on content. |
| `'read'` | The default `find*` tools and the content tools. | Say that every change goes through the content tools. |
| `'none'` | Only the content tools. | Describe the content tools only. |

- The flags of the key stay the permissions of the content tools in every mode.
- The option covers the collections and globals in the options of the MCP plugin. Other tools of the MCP plugin and your own tools in `mcp.tools` are not changed.
- With `'all'`, a default `update*` tool can make an update that a content tool refuses, and a default `delete*` tool can delete. Use `'read'` or `'none'` when every write through MCP must be a checked draft.
- With `'read'` and `'none'`, a collection or global without drafts takes no write through MCP.
- The option limits the other clients of the endpoint only. The chat in the admin keeps every default tool in each mode: it reads and writes through them, with the key in `mcpApiKey`.

### The chat and these tools

The chat in the admin does not get the content tools of the endpoint. It has the same tools in its own form, tied to its conversation. A request counts as a request of the chat when it has the header of the chat and the key in `mcpApiKey`. `withContentAgent` leaves its tools out of such a request.

Give an outside agent a key of its own, not the key of the chat.

### History and review

With `contentAgentPlugin` and memory on the same site, a write of a content tool is kept like a write of the chat:

- The plugin keeps one conversation for each key, user and day (UTC), with the title "MCP: <label of the key>". The owner is the user of the key. The conversation starts with the first write, not with a read.
- The user of the key sees the conversation in the chat history. The review panel lists the changes, and a person publishes or discards them (see [Review and publish](#review-and-publish)).
- Modules get the change through `onEdits`, like a write of the chat.
- The tool answers after the change is stored.
- Without `contentAgentPlugin` or without memory, the write is saved and no history is kept.

The review panel works with the schema of `contentAgentPlugin`. A discard of a change in a collection that the `collections` option of `contentAgentPlugin` leaves out fails.

## Writing a module

A module adds tools, prompt text, endpoints, database tables and Payload config changes to the agent. It is a plain object. Pass it in the `modules` option. A module imports only from `@focus-reactive/payload-plugin-content-agent/sdk`. Everything else in the package is internal and can change in any release.

```ts
import { tool } from 'ai'
import { z } from 'zod'
import { SDK_VERSION, defineModule, table } from '@focus-reactive/payload-plugin-content-agent/sdk'

export const notesModule = defineModule({
  name: 'notes',
  sdkVersion: SDK_VERSION,
  migrations: [
    {
      name: '001-notes',
      sql: 'CREATE TABLE IF NOT EXISTS notes (id serial PRIMARY KEY, user_id text NOT NULL, body text NOT NULL)',
    },
  ],
  turn: ({ db, userId }) => {
    if (!db) return

    return {
      tools: {
        saveNote: tool({
          description: 'Save a note for the person.',
          inputSchema: z.object({ body: z.string() }),
          execute: async ({ body }) => {
            await db.query(`INSERT INTO ${table('notes')} (user_id, body) VALUES ($1, $2)`, [userId, body])

            return { saved: true }
          },
        }),
      },
      prompt: 'Use saveNote when the person asks you to keep a note.',
    }
  },
})
```

### The contract

| Member | When it runs | What it does |
|---|---|---|
| `name` | | Unique name: lowercase letters, digits and single dashes. Used in logs and in the names of migrations. |
| `sdkVersion` | | Set it to `SDK_VERSION`. The plugin refuses a module built for another version. |
| `validate(ctx)` | Config time | Checks the options of the module. A throw fails the build. |
| `extendConfig(config, ctx)` | Config time, after the plugin's own changes | Returns the changed Payload config: hooks, collections, globals, jobs, admin views. |
| `endpoints(ctx)` | Config time | Returns REST endpoints. Each one is behind the `access` check of the plugin. A route that is already taken fails the build. |
| `migrations` | At the start, when memory is configured | SQL that runs once, in array order, recorded as `<module name>:<name>`. Make each one safe to run twice. A failure rolls back the migrations of this module only. |
| `turn(ctx)` | Once per chat turn, before the agent starts | Returns `{ tools, prompt, note }`. `prompt` goes to the cached part of the system prompt, `note` to the part of this turn. |
| `onEdits(edits, ctx)` | After every agent write | Receives the documents that the agent wrote. |

Rules:

- A throw at config time fails the build. A throw in `turn` or `onEdits` is logged, and the module is skipped.
- A `turn` that takes more than 20 seconds is skipped for that turn. The agent is told that the module is unavailable.
- A tool is skipped with a warning when the AI SDK cannot read it: it is not an object, it has no `execute` function, its `description` is not text, or its `inputSchema` cannot become a JSON Schema. Pass a zod schema, or wrap a JSON Schema object in `jsonSchema()` from `ai`. A zod type with no JSON form, such as `z.date()`, does not work.
- A tool result must fit in JSON. A result that does not (a circular object, a BigInt) becomes an error of that tool call.
- `tools` that is not a record by name, and a `prompt` or a `note` that is not text, are ignored with a warning.
- On a tool name clash the core tool keeps the name. Between two modules, the earlier one keeps it.
- A tool that writes a document calls `recordEdits` of the turn context. Without it, the agent warns the person that nothing was saved.
- A tool that brings text from outside the CMS is wrapped in `markUntrusted`.
- Build every table name with `table()`.

### The exports

| Export | Content |
|---|---|
| `defineModule`, `SDK_VERSION` | The module object with its type checks, and the version of the contract. |
| `ContentAgentModule`, `ConfigContext`, `TurnContext`, `TurnContribution`, `EditsContext`, `ModuleDb`, `ModuleEndpoint`, `ModuleMigration` | The types of the contract. |
| `SchemaContext`, `SchemaCollection`, `SchemaGlobal`, `SchemaField` | The schema of the site, as the agent reads it. |
| `EditRecordRef`, `EditReport`, `CriterionReport`, `PayloadDoc`, `DocFields`, `DocId` | The shape of an agent write, as `recordEdits` and `onEdits` use it. |
| `markUntrusted(tool)` | Marks a tool whose output comes from outside the CMS. After it runs, the agent saves no shared memory in that turn. |
| `visualResult(kind, spec)` | Makes a tool result that the chat draws as a table, number cards or a chart. Types: `VisualKind`, `VisualResult`, `VisualSpecs`, `TableSpec`, `MetricsSpec`, `ChartSpec`. |
| `getMcpServerTools(url, options)` | The tools of a streamable HTTP MCP server, over one cached connection per URL and headers. Type: `McpServerTools`. |
| `getMcpServerInstructions(url, options)` | The instructions that the server sent when it connected. |
| `table(name)` | The name of a plugin table with its schema. |
| `principalOf(user, payload)` | The stable id of a user, as stored with conversations and edits. |
| `requestOrigin(req)` | Who sent a request that reaches a hook: the chat (`chat`), another MCP client (`mcp`) or anything else (`other`). Types: `RequestOrigin`, `OriginSource`. |
| `capMcpToolOutput(result)` | Beta. Keeps the result of an MCP tool under the size the agent can hold. |
| `richTextToText(value)` | Beta. The plain text of a Lexical rich text value. |
| `wordsOf(text)` | Beta. The units a text is compared by. |
| `docLabel(doc, collection)` | Beta. The title of a document. |

### Versions

- The public exports follow semantic versioning. A breaking change to one of them is a new major version of the package and a new `SDK_VERSION`.
- A new major version of the `ai` package in the plugin is a new `SDK_VERSION` too, because the contract uses its `ToolSet` type.
- An export marked beta can change in a minor release.
- `api/sdk.api.md` is the exact public surface. `npm run validate` fails when the built SDK does not match it. After an intended change, run `npm run build` and `npm run api`, and commit the report with the change.

## Editable instructions

`instructions` lets editors maintain rules for the agent in the admin, for example a brand voice, a review checklist or a translation glossary.

```ts
contentAgentPlugin({
  // ...
  instructions: {
    access: { update: ({ req }) => req.user?.role === 'admin' },
  },
})
```

- `true` or an object without `source` registers a global `content-agent-instructions` (label "Agent Instructions", admin group "Content Agent"). **The global adds a table, so it needs a migration.**
- Object fields: `slug`, `adminGroup`, `access`, `versions` (default: versions with a maximum of 20, no drafts; `false` turns them off), `source`.
- `source: ({ payload }) => AgentInstruction[]` reads the instructions from your own data. The plugin then registers no global.

Restrict `access.update`. The instructions change how the agent writes for every user.

### Glossary

The glossary is one instruction block with the scope "Always". It holds what the project's blocks, collections and terms mean, one line each. The agent never writes to it. When a person explains a term in the chat, the agent uses the explanation in that conversation and proposes a ready line (`proposeGlossaryEntry`). A person with the right to edit the instructions adds the line. To correct a line, edit it in the block.

Each instruction has a label (never sent to the model), a scope, the text (up to 16000 characters) and an enabled flag. The total is capped at 48000 characters. The plugin reads the instructions at the start of every turn.

| Scope | Where it goes |
|---|---|
| `always` | The system prompt of the orchestrator, and the Content Editor and the Reviewer. |
| `writing` (default) | The Content Editor. |
| `review` | The Reviewer. |
| `translation` | The translation step. |

The plugin tells the model that instructions cannot widen its permissions.

## Chat attachments

Editors can attach files to a message.

- Up to 5 files per message and 5 MB per file at the endpoint.
- The chat keeps the files of one request at 3 MB in total, because the files travel inside the request body and a host may refuse a body of a few megabytes (some serverless hosts stop at 4.5 MB). The composer refuses a file over this limit before the send and names the limit.
- The browser scales a PNG, JPEG or WebP picture over 400 KB down to 2048 pixels on the long side and sends it as JPEG.
- The chat sends the whole conversation with each request. When the files of earlier messages no longer fit in the 3 MB, the chat sends the older ones without their bytes, and the agent learns that they are gone.
- When a host still answers 413, the chat shows a plain message, not the page of the host.
- Images and PDF files go to the model as files. Inline images and PDFs are capped at 12 MB per request. When the cap is reached, older attachments are dropped first.
- Text formats (`text/*`, JSON, XML, `.md`, `.csv`, `.tsv`, `.yaml`, `.log`) become text.
- `.docx` needs the optional package `mammoth`. `.xlsx` needs the optional package `xlsx` 0.20.2 or newer and becomes CSV per sheet. These versions are published on the SheetJS CDN, not on npm (npm stops at 0.18.5, which has known security advisories): `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Extracted text is capped at 40000 characters.
- A file that the plugin cannot read becomes a note to the agent, which tells the person.
- The plugin does not store attached files. The saved message contains only `[attached: <name>]`.

## Memory

Memory needs `memoryDatabaseUrl`. Without it, the agent works without history, and the memory and history tools are not present.

### Database

- All tables are in the Postgres schema `content_agent`. Queries always name the schema, so the plugin works behind a pooler in transaction mode.
- Postgres 13 or newer (for `gen_random_uuid()`).
- `pgvector` is optional. The plugin finds the schema that has the `vector` type, so Supabase's `extensions` schema works.
- One connection pool per connection string. The size comes from the `CONTENT_AGENT_DB_POOL_MAX` environment variable (default 5). Connect timeout is 10 seconds.

### Migrations

The plugin runs its migrations at startup, in one transaction under an advisory lock, and records them in `content_agent.ca_migrations`. A failed run rolls back and runs again at the next start. You do not need to run anything yourself.

When `pgvector` is available, the plugin also adds the `embedding` columns and HNSW indexes at every start. The columns take the size of the vectors of the embedding model. When you change to a model of another size, the plugin resizes the columns, removes the stored vectors and computes them again from the stored text in the background. pgvector cannot index a vector of more than 2000 dimensions: the search then scans the table.

If memory fails to start, the agent runs without memory and tries again after 60 seconds at the earliest. A memory failure never stops Payload from starting.

### Tables

| Table | Content | Growth |
|---|---|---|
| `ca_conversations` | One row per chat. | Not deleted by the plugin. |
| `ca_temporal_messages` | Every user and assistant message. | Not deleted by the plugin. |
| `ca_temporal_summaries` | Summaries of older messages. | Not deleted by the plugin. |
| `ca_present_state` | Goal, status and tasks per conversation. | One row per conversation. |
| `ca_ltm_entries` | Long-term memory. | Archived, not deleted. |
| `ca_background_reports` | Notes from background tasks, shown at the next turn. | Deleted by `pruneContentAgentData`. |
| `ca_workers` | Locks and status of background tasks. | Deleted by `pruneContentAgentData`. |
| `ca_agent_telemetry` | Steps, tool calls, timings and tokens. | Deleted by `pruneContentAgentData`. |
| `ca_changesets` | Documents changed per conversation, with before and after snapshots, the state a discard brings back, and the report of the editor (open issues, declared criteria). | One row per document and locale per conversation. |
| `ca_pending_bulk` | Bulk edits that continue at the next turn. | Ignored after 24 hours. |
| `ca_chat_ratings` | Chat ratings (`chatRating`). | One row per conversation. |

A module adds its own tables through its `migrations` (see [Writing a module](#writing-a-module)).

### Context

The prompt contains the summaries of older messages, the messages that no summary covers, the long-term memory entries `/identity` and `/behavior`, unread background reports, and the documents that the conversation changed (up to 40, from `ca_changesets`: the collection, the id, the title, the written locales, and whether the agent created the document or a person discarded the changes). The list keeps the agent aware of its own earlier writes after a page reload or a summary.

- When the conversation view is larger than `compactionThreshold`, a background task summarizes older messages, but never the newest `recencyBufferMessages`.
- When the view is larger than `compactionHardLimit`, the oldest uncovered messages are left out of the prompt.

### Long-term memory

- Entries belong to a user or are shared. Shared entries come from the init scan only.
- With `ltmCurator: true`: after a turn with at least 5 messages, a background task (the curator) creates, updates or archives the user's own entries. It cannot change shared entries. The curator is off by default.
- `reflect` searches the user's messages, summaries and entries, and answers with `backgroundModel`.
- Every entry the model sees carries its author and the day of its last update: the identity and behaviour entries in the prompt, and each entry that `reflect` finds. When two entries disagree, `reflect` takes the later one.

### Init scan

The chat shows a button at first use. It calls `POST /content-agent/init`, which reads your content and stores shared entries: a content map per collection and global (the fields, and the document counts with the day of the scan), an identity entry and a behaviour entry. A new scan is possible 5 minutes after the last one.

### Embeddings

With an embedding model and `pgvector`, the plugin embeds long-term memory entries and summaries. Messages use full text search only. Search combines full text and vector results.

The plugin turns embeddings off when `pgvector` is missing or the embedding model does not answer. Search then uses full text only.

### Background tasks

Distillation, the conversation summary and the curator run after the response. On Next.js and Vercel, the plugin passes this work to `waitUntil` from the request context, so the function stays alive until it ends. On a platform without `waitUntil`, the work can be cut off when the response ends. A background task that stays "running" for more than 10 minutes counts as expired.

### Delete old telemetry

```ts
import { pruneContentAgentData } from '@focus-reactive/payload-plugin-content-agent'

const result = await pruneContentAgentData(process.env.DATABASE_URI!, { olderThanDays: 90 })
// { telemetry, backgroundReports, workers }: counts of deleted rows
```

The function deletes rows from `ca_agent_telemetry`, `ca_background_reports` and `ca_workers` that are older than `olderThanDays` (default 90, whole number of 1 or more). It keeps everything else. The plugin has no scheduler. Call the function from your own scheduled job.

## HTTP endpoints

All endpoints need a logged-in user who passes the `access` option. Otherwise they return 401 or 403.

| Method and path | Input | Response | Memory |
|---|---|---|---|
| `POST /content-agent/chat` (`apiRoute`) | `{ messages, conversationId?, pageContext? }` | AI SDK UI message stream | optional |
| `GET /content-agent/conversations` | `limit` (1-50, default 10), `cursor` | `{ conversations, nextCursor, memoryEnabled }` | optional |
| `GET /content-agent/messages` | `conversationId` | `{ messages }` | optional |
| `GET /content-agent/init` | none | `{ initialized, memoryEnabled, build: { version, sourceHash }, modules, migrations }`. `sourceHash` names the exact source of the running build, `migrations` lists the applied migrations in order. Read it after an upgrade to check what runs. | optional |
| `POST /content-agent/init` | none | scan result | required |
| `GET /content-agent/changes` | `conversationId` | `{ refs, summary }` | required |
| `GET /content-agent/diff` | `collection`, `id`, `conversationId?`, `locale?` | `{ scope, diff }` | optional |
| `POST /content-agent/publish` | `{ collection, ids }` (1-100 ids) | `{ collection, published, failed, results }` | no |
| `POST /content-agent/discard` | `{ conversationId, documents: [{ collection, id }], force? }` (1-100 documents) | `{ results }`, one per document and locale | required |
| `GET`, `POST /content-agent/rating` | `conversationId`; POST also `rating` (1-5), `comment` (up to 2000 characters) | the rating | required, only with `chatRating` |

### Chat request limits

- `messages`: only `user` and `assistant` roles, up to 200 messages and 300000 characters of text (attachments not counted). Above the limit, the endpoint returns 400 and asks to start a new chat.
- The whole request body is capped. Above the cap, the endpoint returns 413.
- `conversationId`: the UI creates it and keeps it in session storage. A conversation of another user returns 404.
- `pageContext`: `{ collection?, documentId?, global? }`, the document that the editor has open. Unknown slugs are ignored.

The plugin sets no `maxDuration`. On serverless platforms, set it on your route config if the platform default is too short, and keep `bulkTimeBudgetMs` below it.

## Admin UI

The plugin registers one admin provider, `@focus-reactive/payload-plugin-content-agent/client#ContentAgentProvider`. Run `npx payload generate:importmap` after you add the plugin. It also adds `@focus-reactive/payload-plugin-content-agent/client#DocumentFormBridge` to the edit view of each collection and global. This component shows nothing. It tells the chat when the form has unsaved edits. After the agent writes to the open document, the chat loads a form with no unsaved edits again. When the form has unsaved edits, the chat shows a reload link and says that a reload discards them. Run the import map command again after an update of the plugin.

- A button at the bottom right opens a floating chat window. The window can be moved, resized and minimized. Its position is stored in local storage.
- The chat sends the open document as page context with every message.
- Chat history, the review panel, the init button and the rating (with `chatRating`) are part of the window.
- Enter sends, Shift+Enter adds a line, Escape stops the answer while the input has focus.
- While a turn runs, the reply shows what the agent does. The last line of the reply says "Thinking…" while the model decides what to do next. A running step shows in plain words with a timer, for example "Updating posts… 3s", and names the collection or the global it works on, so two steps of one tool at the same time read as two steps. The line "Thinking…" does not show after the last text of a reply or under a card that waits for the person. The loader is Tail Chase from [ldrs](https://uiball.com/ldrs/) (MIT).
- The model's reasoning summary is one line: "Thinking…" with the current step of the model while it streams, and "Thought for N seconds" after. A click opens the full summary.
- A step without a result after the turn ends shows "stopped before it finished, nothing was done". A failed step is one line with a "failed" badge, and a click shows the reason.
- The agent reply has the full width of the chat, so it does not change width while steps appear and fold.
- The UI renders in a shadow root, so its styles do not affect the admin. It follows the admin theme (light or dark).

The client entry `@focus-reactive/payload-plugin-content-agent/client` also exports `ContentAgentChat`, `ContentAgentPanel` and `ChatHistory`.

## Telemetry

With memory, the plugin records in `ca_agent_telemetry`:

- every model step: duration, input, output and cache tokens, finish reason, tools called, the model;
- every tool call: the tool name, the time the call took, success or the error text;
- every run: total duration and step count, the model, and the tool call of the agent above that started it (`parentToolCallId`). A Reviewer row names the editor run it belongs to (`parentRunId`).

The rows stay in your database. The plugin sends them nowhere.

With `telemetry: 'full'` a tool call row also keeps the input of the call (up to 8000 characters) and the start of its result (up to 2000 characters). Both hold content of your site. Turn it on to look into a problem, then set it back.

Telemetry writes never delay the answer. Use `pruneContentAgentData` to delete old rows.

## Limits and known limitations

- **`contextBudget.compactionTarget` is not used.**
- **A model call of a sub-agent or a background task stops after 180 seconds without an answer.** The document then gets an error, and nothing is saved for it. The streamed answer of the main agent has no such limit.
- **The plugin never deletes conversations, messages or summaries.** Plan for their growth.
- **Background memory work needs `waitUntil` on serverless platforms.** Without it, summaries and memory updates can be lost.
- **The rate limit is per process.** On serverless platforms, each instance counts separately.
- **Schema introspection runs once per process.** Restart the server after you change the Payload config.
- **New collections need a new MCP key scope.** Existing MCP API keys do not get access to new collections automatically.
- **Only Lexical rich text is supported.** Slate fields are visible to the agent but read only.
- **`getMcpServerTools` connects to streamable HTTP MCP servers only.**

## Source map

| Path | Content |
|---|---|
| `src/plugin.ts` | Plugin entry: options, endpoints, hooks, admin provider. |
| `src/types.ts` | Option and schema types. |
| `src/models.ts` | Default models per provider. |
| `src/maintenance.ts` | `pruneContentAgentData`. |
| `src/schema/introspector.ts` | Schema introspection and the schema prompt. |
| `src/agent/index.ts` | `runAgent`: one chat turn. |
| `src/agent/systemPrompt.ts` | The system prompt. |
| `src/agent/mcpClient.ts` | MCP client. |
| `src/agent/tools/` | Orchestrator tools and the tool factory (`index.ts`). |
| `src/agent/content/` | `DocumentIO`, the Content Editor, rich text engine, block tools and write checks. |
| `src/agent/subAgents/` | Reviewer prompt and Lexical conversion helpers. |
| `src/agent/instructions.ts` | Editable instructions. |
| `src/mcpLayer/` | `withContentAgent`: the content tools on the MCP endpoint, their access, history and server instructions. |
| `src/requestOrigin.ts` | Tells a request of the chat from a request of another MCP client. |
| `src/agent/attachments.ts` | Chat attachments. |
| `src/api/` | HTTP endpoints. |
| `src/memory/` | Memory: database, migrations, storage, context, background tasks. |
| `src/sdk/` | The module SDK: the module contract and the helpers that modules may use. |
| `api/sdk.api.md` | The API report of the module SDK, made by API Extractor. |
| `src/moduleHost.ts` | Runs the modules: config checks, chat turns, `onEdits`. |
| `src/ui/` | Admin UI components. |
