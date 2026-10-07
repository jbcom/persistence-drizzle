# @arcade-cabinet/persistence-drizzle

A typed Drizzle ORM layer for arcade-cabinet saves, composed over the one SQLite connection that
[`@arcade-cabinet/persistence-save`](https://github.com/jbcom/Aethelgard-Chronicles-of-Strata/src/branch/main/packages/persistence-save)
opens. persistence-save owns the connection (native SQLite through `@capacitor-community/sqlite`, SQLCipher if asked,
`jeep-sqlite` with its package-owned sql.js WASM on the web, the web store's flush) and a snapshot save facade; this
package adds what a relational save needs on top of that one connection:

- a typed Drizzle database (`drizzle-orm/sqlite-proxy`) whose every statement is serialised through one lock;
- `drizzle-kit` migrations applied at open, each in its own transaction, refusing a database from a newer build and a
  shipped migration edited after it ran;
- transactions that hold the lock throughout, so no other writer (persistence-save's autosave included, through
  `guardSnapshots`) can land inside one;
- a `node:sqlite` driver, so unit tests run the same Drizzle path in Node with no native addon;
- typed Preferences for small settings, over persistence-save's `createPreferencesKv`;
- a hardened envelope for exporting and importing a save as text.

Provenance: the Drizzle-over-Capacitor proxy comes from grailguard (`src/db/client.ts`) and concrete-vermin
(`src/platform/persistence/client.ts`); the explicit web flush and the jeep element from persistence-save; drizzle-kit
schemas and migrations from a-good-old-fashioned-adventure and kings-road. It is incubated in curse-of-the-mummy
(`packages/persistence-drizzle`), the way `@arcade-cabinet/mobile` was.

## API

| Export | What it does |
| --- | --- |
| `openDatabase({ driver, schema, migrations, now? })` | Applies the migrations, then returns `{ db, transaction, exclusive, migrations, close }` |
| `db` | A Drizzle `SqliteRemoteDatabase<schema>`. Each statement takes the lock; a write is flushed before it resolves. `db.transaction()` is refused (`TransactionMisuseError`) |
| `transaction(fn)` | `BEGIN IMMEDIATE` … `COMMIT`, or `ROLLBACK` on a throw, with the lock held; one flush on commit. Use the `tx` given to `fn` (nested `tx.transaction` is a savepoint) |
| `exclusive(fn)` | Holds the lock for a writer outside Drizzle on the same connection, then flushes |
| `migrationsFromJournal(journal, files)` | The migrations in journal order from bundled files (`import.meta.glob('./drizzle/*.sql', { query: '?raw', import: 'default', eager: true })`) |
| `MigrationError` | `reason`: `invalid-list`, `unknown-applied` (a newer build wrote this database), `drift` (an applied migration changed), `failed` (rolled back whole) |
| `createEnvelope(target, version, data, exportedAt)` / `parseEnvelope(text, target)` | Export and import of a game's domain value. Reading is bounded, strips `__proto__` / `constructor` / `prototype` at every depth, refuses other games, other kinds and newer versions, and never throws |
| `parseUntrustedJson`, `stripForbiddenKeys` | The same hygiene for any stored or imported JSON |
| `createTypedPreference({ kv, key, parse, defaults })` | `load` (defaults on anything unusable), `save` (refuses what `parse` rejects), `clear`. `createMemoryKv()` for tests and labs |
| `./capacitor`: `createCapacitorDriver(persistence)` | The device and web driver over persistence-save's `withConnection` / `flush` / `close` |
| `./capacitor`: `guardSnapshots(persistence, database)` | persistence-save's facade with every call under the database's lock; use it instead of the raw facade |
| `./node`: `createNodeSqliteDriver(location?)`, `readMigrationsFolder(dir)` | `node:sqlite` for tests and tools; the drizzle-kit output folder from disk |

## Use

```ts
import { createPersistence, createPreferencesKv } from '@arcade-cabinet/persistence-save'
import { openDatabase, migrationsFromJournal } from '@arcade-cabinet/persistence-drizzle'
import { createCapacitorDriver } from '@arcade-cabinet/persistence-drizzle/capacitor'
import journal from './drizzle/meta/_journal.json'
import * as schema from './schema'

const connection = createPersistence({
  dbName: 'com.example.game_v1',
  wasmAssetsPath: `${import.meta.env.BASE_URL}assets`,
  snapshotVersion: 1,
  serialize: (state) => ({ version: 1, ...state }),
  deserialize: (snapshot) => snapshot,
  migrations: {},
})
const database = await openDatabase({
  driver: createCapacitorDriver(connection),
  schema,
  migrations: migrationsFromJournal(
    journal,
    import.meta.glob('./drizzle/*.sql', { query: '?raw', import: 'default', eager: true }),
  ),
})
await database.transaction(async (tx) => {
  await tx.insert(schema.profile).values({ id: 1, marks: 0 })
})
```

Serve persistence-save's two exported WASM assets (`@arcade-cabinet/persistence-save/assets/sql-wasm.wasm` and
`sql-wasm-browser.wasm`) at `wasmAssetsPath`; a Vite plugin that emits them in the build and serves them in dev is
enough.

## Rules

- **One connection, one lock.** Every writer on the connection goes through the database: Drizzle through `db` or
  `transaction`, persistence-save's snapshots through `guardSnapshots`, anything else through `exclusive`.
- **Inside `transaction(fn)`, use `tx`.** `db` would wait for the lock `fn` holds.
- **Alias clashing column names in joins.** Capacitor SQLite returns rows as objects, so two result columns with one
  name collapse into one key (iOS's `ios_columns` keeps the order but not duplicates).
- **No `RETURNING` on the device.** The plugin's `query` is for reads; insert, then select.
- **Never edit a shipped migration.** Generate a new one; the runner refuses drift.
- **Export the domain value, not rows.** Rows change shape with every migration; the domain value carries its own
  version and the game's migration table.

## Verification

```text
pnpm verify   # typecheck, the node:sqlite suite, the dual build, and the packed-tarball consumer smoke (ESM + CJS)
```

curse-of-the-mummy's browser layer runs the web path for real: jeep-sqlite through persistence-save, a save and reload
round trip, and a guarded snapshot save racing a Drizzle transaction on the shared connection.
