# Contributing

Thanks for taking the time to contribute.

## Getting set up

With [mise](https://mise.jdx.dev) (recommended; installs the Node and pnpm versions pinned in `mise.toml`):

```sh
mise install
pnpm install
pnpm verify   # lint, typecheck, test with coverage, build, examples, package checks, consumer smoke
```

Without mise, use `corepack` so pnpm matches the version pinned in `package.json#packageManager`, on Node 22.16.0 or
later. CI verifies the maintained 22, 24 and 26 major lines:

```sh
corepack enable
pnpm install
pnpm verify
```

## Making a change

1. Branch off `main`.
2. Write the test first. A bug fix should come with a test that fails without it.
3. Run `pnpm verify`. A change is not ready while any part of that is red.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org): `fix:`, `feat:`, `docs:`, `refactor:`,
   `test:`, `chore:`. Release Please uses these commits to drive the changelog and next version number.
5. Open a pull request describing what changed and why.

## What gets reviewed

- Does it do what it says, and is there a test proving it?
- Does it keep the lock invariants in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)? Nothing may write to the connection
  outside the lock.
- Does it keep the public API honest? A breaking change needs a `!` or a `BREAKING CHANGE:` footer. The migrations table
  name and the envelope format are persisted, so changing them is breaking.
- Are the types right for consumers? CI runs `publint` and `arethetypeswrong` because broken types only surface at
  integration time.

## Releases

Releases are automated. Merging a conventional commit to `main` opens a release pull request; merging that publishes to
npm with provenance. Do not hand-edit versions or the changelog.
