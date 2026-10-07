---
title: Contributing
description: Set up persistence-drizzle, validate a change, and contribute through the protected workflow.
---

## Local workflow

```sh
mise install
pnpm install --frozen-lockfile
pnpm verify
pnpm docs:build
```

`pnpm verify` is the library gate: Biome, Markdown linting, strict TypeScript, 100% coverage, dual-format builds,
runnable examples, package validation (`publint`, Are The Types Wrong) and a clean-consumer install of the packed
tarball. `pnpm docs:build` validates and renders the Sourcey site.

Branch from `main`, make a focused Conventional Commit, open a pull request, and keep the branch current by merging
`main` into it when necessary. Do not hand-edit versions or `CHANGELOG.md`: Release Please owns them.

Read the repository [contribution guide](https://github.com/jbcom/persistence-drizzle/blob/main/CONTRIBUTING.md) and
[agent instructions](https://github.com/jbcom/persistence-drizzle/blob/main/AGENTS.md) before changing public APIs.
