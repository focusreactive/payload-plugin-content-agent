# Contributing

Thank you for your help. This file tells you how to set up the repository, check a change and send it.

## Set up

You need Node.js 22 or newer and a PostgreSQL server.

```bash
npm ci --legacy-peer-deps
```

The install also sets up the Git hooks (lefthook): they format the staged files, check the commit message and run the type check before a push.

## Check a change

Run one command before you send a change:

```bash
npm run validate
```

It runs the lint, the format check, the type check, the tests, a clean build, a check that the generated files match the source, and a check of the module SDK against `api/sdk.api.md`.

- `npm run format` formats the code. Fix what `npm run lint` reports by hand.
- The migration tests need Postgres. Without `CA_TEST_DATABASE_URL` they are skipped on your computer and fail in CI:

  ```bash
  CA_TEST_DATABASE_URL=postgres://localhost:5432/postgres npm test
  ```

- A change of the public module SDK changes `api/sdk.api.md`. Run `npm run api` and commit the new report with the change.
- A change in `src/` can change the generated files `src/ui/generatedStyles.ts` and `src/buildInfo.ts`. Run `npm run build` and commit them with the change.

## Test in a real admin

The `lab/` folder holds a test host: Next.js, Payload and Postgres with four test schemas. It runs the plugin from this repository. [`lab/README.md`](lab/README.md) tells you how to start it.

The evals send editor requests to a running lab host and check the documents after the run. [`evals/README.md`](evals/README.md) tells you how to run them and how to compare a run with a baseline.

## Rules for the code

[`AGENTS.md`](AGENTS.md) lists the rules of this repository. The most important ones:

- A change works with any model, any Payload schema and any language. The code names no collection, field or block of one project.
- A rule that must always hold goes into code and gets a test.
- A new database migration goes to the end of its list. Never edit a released migration.

[`DOCS.md`](DOCS.md) describes how the plugin works.

## Commit messages and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), for example `fix: ...`, `feat: ...` or `docs: ...`. A Git hook checks each message. The release job reads the messages to choose the next version and to write [`CHANGELOG.md`](CHANGELOG.md).

Open a pull request against `main`. CI runs `npm run validate` on Node.js 22 and 24.
