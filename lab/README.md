# Lab: a test host for the plugin

A Next.js + Payload + Postgres app that runs the plugin from this repo. Use it to check a change in a real admin, to run the evals, and to check the interface without a model key.

## Start

```
node lab/start.mjs --schema blog --model openai
```

The command packs the plugin, installs it into `lab/`, creates the database `ca_lab_<schema>`, seeds it, builds the host, starts it in the background and builds the knowledge base. It prints the URL and the login (`lab@example.com` / `lab-password`).

The host runs the plugin with `telemetry: 'full'`: every tool call row in `content_agent.ca_agent_telemetry` keeps the input of the call and the start of its result (column `metadata`), so a run can be traced call by call. Keep it on: a development host always keeps full telemetry. `--fresh` drops the database, and the telemetry of the runs before goes with it.

| Option | Meaning |
|---|---|
| `--schema blog\|docs\|shop\|agency` | The test schema. Default: `blog`. |
| `--port <n>` | Default: 3100 for `blog`, 3101 for `docs`, 3102 for `shop`, 3103 for `agency`. |
| `--model openai\|anthropic\|scripted` | The provider, or the scripted model. Default: `openai`. |
| `--env-file <path>` | A file with the provider key. Only this process reads it. |
| `--api-key-var <NAME>` | The variable that holds the key, when it is not `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. |
| `--fresh` | Drop the lab database first. |
| `--skip-pack` | Use the plugin build that is already installed in `lab/`. |
| `--setup-only` | Prepare the database and stop. |
| `--no-init` | Do not build the knowledge base. Without this option the command runs the same scan as the Initialize button of the chat. Never use it for an eval or a timing run: a real site has the knowledge base. |

Needs: Node 22 or newer, and a Postgres server. The default server is `postgres://localhost:5432/postgres`; set `LAB_POSTGRES_URL` for another one. The role must be able to create databases.

`LAB_MODEL_ID`, `LAB_SUBAGENT_MODEL_ID` and `LAB_BACKGROUND_MODEL_ID` set the model ids. Without them the plugin uses its defaults for the provider. `LAB_REASONING_EFFORT` sets the `reasoningEffort` option (`none`, `low`, `medium`, `high`). `LAB_DEFAULT_TOOLS` sets the `defaultTools` option of `withContentAgent` (`all`, `read`, `none`).

`LAB_MODULES` is the path to a JavaScript file (an ES module) whose default export is a module or an array of modules for the `modules` option. Node loads the file when the host starts, so the file must find `@focus-reactive/payload-plugin-content-agent/sdk` from its own folder. Without the variable the host runs the plugin with no module.

Only one schema can run at a time: every schema uses the same build folder. Stop a host with the `kill` line that the start command prints.

## Schemas

Each schema is one file or one folder in `lab/src/schemas/` with its collections, its globals and its seed. The schemas differ on purpose, so a rule that depends on one schema shows up.

| Schema | What it has |
|---|---|
| `blog` | Posts with rich text, pages built from blocks, an array inside a block, a block with link rows (a label next to a URL or a reference), a global with drafts. |
| `docs` | Two locales (`en`, `de`), no `slug` field, a group, an array, a collection without drafts, a global without drafts. |
| `shop` | Eleven collections, numbers, selects, an array of variants, relationships, a block that lists documents, a collection without drafts. |
| `agency` | The site of a headless CMS agency: 19 collections, 4 globals, 31 blocks up to three levels deep, blocks and inline blocks inside rich text, tables, uploads, two locales (`en`, `es`). About 1180 documents and 157 pictures; the Spanish locale is filled the way a real site has it. |

The seed is fixed text, so every fresh database is the same. The seed writes the ids of the documents that the evals use to `lab/.state/<schema>/seed.json`.

## Texts of the `agency` schema

The long texts of the `agency` schema are files in `lab/content/agency/`: posts, docs pages, case studies and landing pages. A model wrote them one time; they stay in git, so a fresh database never calls a model.

- `catalog.json` lists every document, the authors, the categories, the technologies and the facts about the agency.
- `brand.json` holds the name, the short name and the address of the agency. The texts hold the marks `{{brand}}`, `{{short}}` and `{{site}}` in their place.
- `usage.json` holds the model and the tokens of each file.
- `es/` holds the Spanish translation of 70 of the 80 files, with a `usage.json` of its own.
- `strings.json` lists every short text that the seed builds by code and that has a second locale: labels, titles, alt texts, the texts of the pages built by code. `es/strings.json` holds the translation of each one.

`lab/scripts/generateCorpus.mjs` builds one brief for each document from the catalog, asks the model and checks the answer.

```
node lab/scripts/generateCorpus.mjs --check
node lab/scripts/generateCorpus.mjs --env-file <path> --api-key-var <NAME> --model <id> --only posts/payload-vs-sanity --force
node lab/scripts/generateCorpus.mjs --translate es --check
node lab/scripts/generateCorpus.mjs --translate es --strings --check
```

| Option | Meaning |
|---|---|
| `--list` | Print the id of every document. |
| `--briefs` | Print the briefs. No model call. |
| `--check` | Check the files that exist. No model call. |
| `--model <id>` | The OpenAI model that writes. |
| `--only <id,id>` | Write only these documents. |
| `--translate <locale>` | Translate the English files into this locale. Every other option works on the translations then. |
| `--strings` | With `--translate`: translate the strings of `strings.json` that have no translation yet. |
| `--out <dir>` | Write to another folder. Default: `lab/content/agency`, or `lab/content/agency/<locale>` with `--translate`. |
| `--force` | Write a file again. Without it the command skips a file that exists. |
| `--effort <level>` | The reasoning effort of the model. |
| `--concurrency <n>` | Requests at one time. Default: 4. |

Run `npm run format` after a write: the formatter also formats these files, and the lint checks them.

A translation holds a line `title:` and the same head lines as its source. The command checks each one against its source by code: the same link addresses, code blocks, marks, headings, table rows, list items, block parts and keys, and the same numbers, dates and options in the rows of a landing page.

Ten documents have no translation, and they must stay so: the translation scenarios start from them. The rule is in the command: every post with the index 2, 7, 12 and so on in `catalog.json` (8 posts, the first is `wordpress-to-headless-migration-checklist`) and the landing pages `cms-audit` and `about`. A post that keeps its body as markdown has only its head lines translated, because `contentMarkdown` has no locales. The FAQ of a post comes from the strings.

When a text that the seed builds by code changes, the seed stops and names the first string with no translation. Then seed one time with `LAB_WRITE_STRINGS=1` (it writes `strings.json`), run the command with `--translate es --strings`, and seed again. In a string, `[[1]]text[[/1]]` marks a link or a format inside a rich text and `[[2/]]` a piece that is not text.

## Photos of the `agency` schema

`lab/content/agency/photos/` holds eight real photos: people at a table, a keyboard with code, a bar chart, a street sign with text, two lakes and a road sign. The seed makes the five pictures of the fault `emptyAlt` from them, cut to the size of the picture; `seed/faults.ts` names the photo of each. Every other picture of the seed is drawn by code from its file name, so a model that sees one gets coloured shapes.

Every photo has the CC0 licence. `sources.json` names the page each one came from and says in one line what it shows. A new photo needs a row there, a CC0 or public domain licence, and at most 1200 pixels on the long side.

## Seed of the `agency` schema

The seed is `lab/src/schemas/agency/seed/`. It calls no model. A fresh start with `--setup-only` takes about 90 seconds: the database, the seed and the second locale of each document.

- 80 authored documents come from the files in `lab/content/agency/`: 40 posts, 20 docs pages, 12 case studies and 8 landing pages. Markdown becomes rich text; a fenced code block becomes a `codeSample` block. Every fifth post keeps its body as markdown in `contentMarkdown`.
- The seed writes the second locale `es` right after it creates a document. The 70 files of `lab/content/agency/es/` give the title, the body and the meta fields of 32 posts, 20 docs pages, 12 case studies and 6 landing pages. Every other localized field comes from `es/strings.json` (`seed/second.ts`): the pages built by code, the shared sections, the taxonomy, the glossary, the FAQ, the reviews, the events, the alt texts, the labels of the links and the globals.
- With no Spanish, as on a real site with gaps: the 10 documents named above and the documents that exist only as faults. Collections with no localized field: partners, awards, the changelog, redirects and form submissions.
- 140 more landing pages are built by code from the 8 landing pages and the fact tables in `seed/data.ts`: one page for each country, technology, migration pair and industry.
- The other records are built by formula: 60 reviews, 30 events, 200 redirects, 500 form submissions, the glossary, the changelog.
- Two seeds give the same database: an id of a row or a block comes from its place, a picture is drawn from its file name or cut from a photo of the repo, and the dates of a document come from its id (`seed/dates.ts`). No date is later than `facts.today` in `catalog.json`.
- `seed.json` names every post, case study, page and shared section: `post:<slug>`, `case:<slug>`, `page:<slug>`, `section:<key>`.

## Faults of the `agency` schema

A real site has mistakes, so the seed has them too. The faults are in the locale `en` only. `seed/faults.ts` puts them in by code; no model writes one. The seed lists every fault in `seed.json` under `faults`, with the names of the documents. A grader reads the list from there and never searches for a fault by itself.

| Key in `faults` | The fault |
|---|---|
| `linksToPage` | Every link of a post to one landing page, with the spelling of the address: exact, `http`, no slash at the end, tracking tags, URL-encoded, and a reference-style markdown link. |
| `brokenLinks` | Links to a page that does not exist, links to the source of a redirect, and a link that a text has with no address (`#`). |
| `meta` | Posts with no meta description, with a repeated one, and with one longer than 160 characters. |
| `emptyAlt` | Pictures with an empty alt text. Each is a real photo, and `shows` lists words of which a right alt text has at least one. |
| `directives` | A directive for an assistant in the body of a post and in an alt text. |
| `twoBodies` | A post with a rich text body and a shorter markdown body. |
| `nearNotes` | Three notes that differ in one word: in a paragraph, in a list item and in a table cell. |
| `gluedLinks` | Links with no space before and after them. |
| `emptySections` | A page with two blocks that have a heading and no rows. |
| `changedSlug` | A page that changed its address: the first version has the old slug. |
| `draftOverPublished` | A published post with a newer draft over it. |
| `twoRecords` | One person with three reviews: two published and one newer draft. |
| `leftovers` | A copy of a regional page for another country that still names the first country in two places. |
| `duplicatePages` | Two pages whose slugs differ only in the slash at the end, and two pages for one keyword. |
| `largeDocument` | One page of more than 120 KB. |

A new fault goes into `seed/faults.ts` and into this table. Seed two times and compare the tables after a change: two seeds must give the same database.

## Scripted model

`--model scripted` replaces the provider with a model that answers from a script (`lab/src/scriptedModel.ts`). It needs no key and gives the same output every time. Type `script: <name>` in the chat:

| Script | What the chat shows |
|---|---|
| `thinking` | The thinking line for four seconds, then text. |
| `reasoning` | A reasoning summary, then text. |
| `tool` | A real tool call, then text. |
| `failed` | A tool call that fails. |
| `editerror` | An edit step whose input the tool does not take: the step shows as failed. |
| `editrefused` | An edit step that the tool refuses: the step shows the refusal. |
| `table`, `metrics`, `chart` | A visual result. |
| `cutoff` | An answer that the output limit cut off. |
| `error` | A provider error in the middle of the answer. |
| `replace` | A real write with no model inside (`blog` schema). The review panel shows it. |
| `confirm` | A write in six documents (`blog` schema). The chat shows the confirmation card first. |
| `many` | Six direct updates in one step (`blog` schema). Five are saved, and the chat asks before the sixth. |
| `clear` | An update that empties a field (`blog` schema). The chat shows the confirmation card first. |
| `create` | A new draft post (`blog` schema). The review panel lists it as created. |

A sub-agent has no script yet. A request that needs the Content Editor needs a real model.

## Files the host creates

`lab/.state/<schema>/` holds the seed ids, the server log, the build log and the process id. `lab/node_modules`, `lab/.next` and `lab/.state` are not in git.
