# AGENTS.md

AI content agent plugin for Payload CMS 3: a chat in the admin that reads and edits content through checked tools.

- First rule: every change works with any model, any CMS schema and any language. The code and the text the model reads name no model or provider, no collection, field or block of one project, and no words of one language. Read the schema at run time. When one model or one project fails, fix the general cause. The evals prove a general fix; they do not choose what to fix.
- One check before you say a change is done: `npm run validate` (lint, format, type check, tests, clean build, the generated files match the source, the module SDK matches `api/sdk.api.md`).
- `npm run format` formats. The linter never fixes code by itself: fix what `npm run lint` reports by hand.
- `dist/` is not in git. The build writes `src/ui/generatedStyles.ts` and `src/buildInfo.ts`, which are: after a source change, run `npm run build` and commit them with it.
- The migration tests need Postgres: `CA_TEST_DATABASE_URL=postgres://localhost:5432/postgres npm test`. Without it they are skipped locally and fail in CI.
- A new migration goes to the end of its list. Then update the lock: `UPDATE_MIGRATION_LOCK=1 npx vitest run tests/migrationLock.test.ts`. Never edit a released migration.
- The plugin must not name a feature of a module: modules live in their own packages and use only the module SDK (`src/sdk/`). `tests/moduleBoundary.test.ts` and `tests/freeBuild.test.ts` enforce it.
- A rule that must always hold goes into code and gets a test. The system prompt is for judgement only.
- A tool error names the next call or the valid values.
- Every development host runs the plugin with `telemetry: 'full'`, so each tool call keeps its input and the start of its result. The lab sets it (`lab/src/payload.config.ts`); set it on any other host you test on, such as a local copy of a site. Read what a run did from `content_agent.ca_agent_telemetry` before you say why it passed or failed.
- Check interface changes on two hosts: one without Tailwind and one with it. The test host and the evals: `lab/README.md`, `evals/README.md`.
- How the plugin works: `DOCS.md`. Install and options: `README.md`.
- Text for people (docs, commit messages, pull requests): short sentences, active voice, no long dashes.
