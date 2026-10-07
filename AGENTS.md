# Agent notes

This file is for an autonomous coding agent working in this repository. It covers what isn't obvious from reading the
code alone.

## Toolchain

- Supported runtimes: Node.js 22, 24 and 26. Local development defaults to Node 26; no exact patch is required.
- Package manager: pnpm, pinned in `package.json#packageManager`. Use `mise install` (reads `mise.toml`) for a matching
  local Node/pnpm toolchain, or `corepack enable` if mise isn't available.
- This is a pnpm workspace with two members: `.` (the published library) and `docs/` (the private Sourcey
  documentation site). Root-level scripts operate on the library; `pnpm docs:*` delegates to `docs/`.
- `pnpm verify` is the single gate CI runs: Biome lint, markdownlint on the docs, strict TypeScript, the full test suite
  at 100% coverage thresholds, both dual-format builds, both runnable examples, `publint`, Are The Types Wrong, a
  packed-tarball content and runtime check, and a consumer smoke that installs the tarball from npmjs only. A change is
  not done while any part of it is red. CI's `docs` job separately runs `pnpm docs:build`.

## Core invariants: do not violate these when editing `src/`

Full detail in `docs/ARCHITECTURE.md`.

1. Every statement, transaction and `exclusive` task takes the one lock. Nothing writes to the driver outside it,
   except the `tx` of a transaction that already holds it.
2. `db.transaction` is refused; transaction control statements on `db` throw `TransactionMisuseError`.
3. A `tx` used after its transaction ended must reject.
4. Opening refuses (`unknown-applied`, `drift`) before it writes; a failing migration rolls back whole.
5. Reading untrusted text (envelopes, preferences) never throws, is size-bounded, and strips prototype-polluting keys.
6. `MIGRATIONS_TABLE` and `ENVELOPE_FORMAT` are persisted names. Changing them is a breaking change.
7. `./capacitor` stays structural: no import of Capacitor or of any connection manager.

## Keeping docs and tests in sync

A change to `src/*.ts`'s public surface needs matching updates in all of:

- `tests/*.test.ts`: the coverage gate is 100%.
- `docs/API.md` and `docs/ARCHITECTURE.md`, the authored Sourcey pages, plus the README table when an export changes.
- Examples and test fixtures use only neutral names written for this package.
