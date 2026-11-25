The {{short}} Starter CLI creates a [Next.js](https://nextjs.org) App Router project with [Payload](https://payloadcms.com), TypeScript and a library of page blocks. Use it to scaffold a project or add a block to an existing starter. For the prerequisites and first-run setup, follow the guide to [install the starter]({{site}}/docs/getting-started/installation/).

## Usage

Run the CLI with `npx create-headless-starter` followed by a command. The `init` command creates a project in a new directory; `add-block` generates files inside an existing project. Run `add-block` from the project root, where `starter.config.ts` is located.

```bash
npx create-headless-starter init my-site --package-manager npm --skip-install
cd my-site
npm install
npm run dev
```

The first command creates `my-site` without installing dependencies. The remaining commands enter the directory, install dependencies and start the development server. Omit `--skip-install` to have the CLI install dependencies as part of project creation.

Run the CLI without a command to see the available commands. Add `--help` after a command to see its arguments and options. The `init` command requires a directory name, and `add-block` requires a block name.

The CLI does not overwrite an existing project directory during initialization. Choose an empty destination name or move the existing directory before running `init` again.

## Options

Options follow the command and its required argument. The CLI reports an error for an unknown option rather than ignoring it.

| Option | Commands | Effect |
| --- | --- | --- |
| `--package-manager <name>` | `init` | Selects `npm`, `pnpm` or `yarn` for dependency installation and generated instructions. Defaults to `npm`. |
| `--skip-install` | `init` | Creates the project files without installing dependencies. |
| `--dry-run` | `add-block` | Shows the files the command would create or replace without writing them. |
| `--force` | `add-block` | Replaces generated files that already exist at the destination. |
| `--help` | All commands | Prints command-specific usage without changing files. |

The selected package manager must be available on your machine if installation is enabled. With `--skip-install`, the selection is still saved in `starter.config.ts` for use in CLI output.

`--force` applies only to the files generated for the named block. It does not register the block or update other project files. Review a dry run first if you are unsure which files would be replaced.

## Configuration

The CLI writes `starter.config.ts` at the project root during initialization. It reads this file when you run `add-block`. A default configuration looks like this:

```ts
export default {
  blocksDir: 'src/blocks',
  packageManager: 'npm',
} as const
```

`blocksDir` is the path, relative to the project root, where block directories are generated. Keep it inside the project. Changing it affects future generation; the CLI does not move blocks that already exist.

`packageManager` records the project’s package manager. Set it to `npm`, `pnpm` or `yarn` if you change tools after initialization. It affects instructions printed by the CLI, not the contents of your lockfile. Update your dependencies and lockfile separately when switching package managers.

If the configuration file is missing or contains an unsupported value, `add-block` stops without writing files. Correct the file and run the command again.

## Add a block

Use `add-block` to create a Payload block configuration and a matching frontend component. Block names must start with a letter and contain only letters and numbers. Use a descriptive name such as `Callout`; the CLI uses it for the generated directory and TypeScript identifiers.

```bash
npx create-headless-starter add-block Callout --dry-run
npx create-headless-starter add-block Callout
```

The first command previews the output. The second writes `src/blocks/Callout/config.ts` and `src/blocks/Callout/Component.tsx`, assuming the default `blocksDir`.

1. Run the dry command and check the destination paths.
2. Run the command without `--dry-run` to create the files.
3. Add the generated Payload block configuration to the page layout field.
4. Add the component to the frontend block renderer, then start the project and test the block in a page.

The generated files provide a starting point, not a fully registered page block. Edit the Payload fields and component together so the component uses the data your editors can enter.

> **Note:** If either generated file already exists, the command stops without changing either file. Use `--force` only when you intend to replace both generated files.

## Exit behavior and related configuration

A successful command exits with code `0`. Invalid arguments, configuration errors, existing destination files and failed dependency installation produce a nonzero exit code. In automated scripts, check the exit code before running commands that depend on the generated project.

The CLI does not configure redirects or change API access rules. After creating a project, you can [set up redirects]({{site}}/docs/guides/redirects/) separately and consult the guide to [access content through the REST API]({{site}}/docs/reference/rest-api/) when integrating a client.
