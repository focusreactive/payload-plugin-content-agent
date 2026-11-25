# Evals: requests through the chat, proof from the document

Each scenario sends a request that an editor would type to a running lab host. The grader then reads the document and decides. The reply of the agent is never the proof.

## Run

```
node lab/start.mjs --schema blog --model openai
node evals/run.mjs --schema blog --k 3 --label my-run
```

Run every eval on a host with the knowledge base built, as a real site has it: start the lab without `--no-init`. A report from a host with an empty base is not a baseline. The baselines of the `agency` schema with the knowledge base are `agency-free2-terra-init.json` for the OpenAI pair and `agency-free2-sonnet-init.json` for the Anthropic pair, in `evals/baselines/`. A package of modules keeps the baselines of a host that loads it in its own repo. The baselines of `blog` and `docs` are `<schema>-b8-terra.json` and `<schema>-b8-sonnet.json` in `evals/baselines/`. Compare a run with the baseline of the same provider.

| Option | Meaning |
|---|---|
| `--schema` | The lab schema. The scenarios are in `evals/scenarios/<schema>.mjs`. |
| `--scenarios <file>` | Another scenario file. |
| `--state-dir <dir>` | The folder with `host.json` and `seed.json`. Default: `lab/.state/<schema>`. With it the runner works on a host that is not the lab. |
| `--k <n>` | Runs per scenario. Default: 3. A scenario passes only when every run passes. |
| `--only id,id` | Run only these scenarios. |
| `--label <name>` | Name of the report file in `evals/results/`. |
| `--baseline <file>` | Compare with an earlier report (`evals/baselines/`). A scenario that passed every run there and does not pass here is a regression, and the command exits with code 2. |
| `--prices <file>` | A price file. The report then has the cost of each run and of the session. The file is JSON: `{ "<model id>": { "input": 2, "cachedInput": 0.2, "output": 8 } }`, the price of a million tokens. The model id is the one the telemetry rows hold. |
| `--max-input-tokens <n>` | Stop when the run has used this many input tokens. Default: 20,000,000. Cached tokens count in full, so a run of 12 scenarios uses about 4,000,000. A scenario that did not get its k runs is listed as not run to the end: it is not counted as failed and not as a regression. |

The runner restores the seed state of every document a scenario uses before each run, in every locale that `seed.json` names under `localization` (the lab writes it). Each locale other than the default one is read without the fallback locale, so a field that has no translation stays empty. It keeps the live version apart from the draft: a document that was published is published again from its live version, and gets a draft over it only when the seed had one. The snapshots of an older run of the runner have the default locale only: delete `snapshots.json` of the host, or start the host with `--fresh`. It reads the numbers of a run from the telemetry table of the plugin, by conversation id: steps, input and output tokens, the share read from the cache, seconds, tool calls and failed tool calls.

Two facts about the numbers. The input tokens already include the tokens read from the cache. The seconds are the time of the main agent; its time contains the time of the sub-agents.

## An agent outside the admin

`--agent outside` runs the scenarios of `evals/scenarios/<schema>.outside.mjs`. The request does not go to the chat. A model gets the tools of the MCP endpoint of the lab host and nothing else, with the instructions of the server in its system prompt, as an MCP client outside the admin does. The host needs no model of its own:

```
node lab/start.mjs --schema blog --model scripted --fresh --no-init
node evals/run.mjs --schema blog --agent outside --outside-model <model id> --env-file <file> --api-key-var <NAME> --label my-run
```

| Option | Meaning |
|---|---|
| `--outside-model <id>` | The model of the outside agent. Required. |
| `--outside-provider openai\|anthropic` | Default: `openai`. |
| `--env-file <path>`, `--api-key-var <NAME>` | Where the key of the provider is. Default variable: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. |

Start the host with `LAB_DEFAULT_TOOLS=read` or `none` to run the same scenarios without the default tools of the MCP plugin. The report lists the tools the endpoint gave (`endpointTools`).

A scenario of this kind returns `lines`: `Expect` lines that must hold and `Never` lines that must not happen. A run passes when every line holds, and the runner prints each line that failed. A line that fails is a reason to change a tool text or the code, never the line. The report keeps every tool call of a run with its input and its error (`calls`), so a failed call reads as "tried this, got that". The numbers of a run come from the model calls of the runner, not from the telemetry of the plugin. `call(name, input)` in the scenario context makes one tool call with no model.

## Write a scenario

A scenario is an object in the list of its schema file:

```js
{
  id: 'edit-plain-field',
  title: 'Set one plain field to an exact value',
  uses: ['guide'],                       // seed documents the scenario may change
  async run({ api, docs, read, send }) {
    const before = await read('guide')
    const turn = await send('Change the excerpt to exactly: "..."', { pageContext: { collection: 'posts', documentId: String(docs.guide.id) } })
    const after = await read('guide')
    return { ok: after.excerpt === '...', details: { excerpt: after.excerpt }, turn }
  },
}
```

Rules for a grader:

- Decide from the document. Use the reply only for what cannot be in the document, for example "the reply names every link".
- Check what must change and what must stay. Most damage is in the part nobody asked to change.
- Write `details` so a failed run explains itself without a second run.
- Every incident becomes a scenario before its fix is called done.

The readers for rich text are in `evals/lib/lexical.mjs`. The readers for a reply are in `evals/lib/reply.mjs`: `named` gives the documents that a reply names, by title or by slug. `asksPerson` takes a question or a request to the person ("Please share the URL.") as an ask. `holdsWord` takes a word only as a whole, alone or with a plural "s", so "graph" is not in "photograph". Both have unit tests in `tests/evalGraders.test.ts`. A table that the chat shows is a part of the answer: `turn.shown` holds its texts, next to `turn.text`.

A question scenario checks the reply against an exact set: every document of the set is named, and no other document of the collection is. A document of the set is named by any spelling of its title or slug. Another document is named only by a narrow reading (`named` with `setOff: true`): a name of one word counts only where the reply sets it off, with emphasis, code or quote marks, in a table cell or alone on a line. So a word like "about" in a sentence names no page. With `addresses: false` a name inside a quoted address is not a name either: the scenarios about links use it, because an address there is the target of a link.

The rule stays strict on purpose: a reply that also lists the documents it ruled out fails. Some models answer with the result only, others add the candidates they checked and rejected. The set is then right and the run still fails, and the baseline of that model records it. In `agency-free2-sonnet-init.json` three question scenarios fail for this reason: `q-links-to-target`, `q-meta-audit` and `q-duplicate-slugs`. The reply holds the right set and adds rejected candidates and side findings.

`faults` in the context of `run` is the list of the faults that the seed put in on purpose (`seed.json`, key `faults`). A grader reads the expected set from it. Only the `agency` schema has one: `lab/README.md` lists its keys.

## A host that is not the lab

`--state-dir` names a folder with two files that you write by hand:

- `host.json`: `{ "base": "<address of the host>", "model": "<model id>", "databaseUrl": "<Postgres with the tables of the plugin>" }`.
- `seed.json`: `{ "user": { "email": "...", "password": "..." }, "documents": { "<name>": { "collection": "...", "id": 1 } } }`. On a site with locales add `"localization": { "locales": ["en", "es"], "defaultLocale": "en" }`: the runner then keeps and restores every locale.

The runner writes `snapshots.json` into the same folder. It restores the documents that the scenarios use before each run, so run it on a copy of a site, never on the live one.

## Rules that the code enforces

`no-drafts-collection` (schemas `docs` and `shop`): a change in a collection without drafts is live at once, so the code lets it run only after the person confirms it in the chat. The client of the evals clicks Confirm by itself. The scenario passes when the chat showed the card, the field has the new value and nothing else changed. In the baselines recorded before 2026-11-19 the rule was a refusal, so the scenario has another result there.

The `agency` schema has the same rule for a bulk write: `live-bulk-replace`, `live-bulk-edit`, `live-bulk-locale-field` and `live-bulk-translate` change several records of a collection without drafts, and `live-bulk-declined` answers No on the card. These collections have no seed names, so each scenario reads the collection, grades every record, puts back the old value of every field the run changed, in both locales, and deletes a record the run created.
