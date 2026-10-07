---
title: API reference
description: Every export of persistence-drizzle, its signature and its failure behavior.
---

The package has three entry points: `persistence-drizzle` (engine-free), `persistence-drizzle/capacitor` and
`persistence-drizzle/node`.

## `persistence-drizzle`

### `openDatabase(options)`

```ts
function openDatabase<TSchema extends Schema>(
  options: OpenDatabaseOptions<TSchema>,
): Promise<PersistenceDatabase<TSchema>>
```

| Option | Type | Meaning |
| --- | --- | --- |
| `driver` | `SqlDriver` | The SQLite engine. |
| `schema` | `TSchema` | The Drizzle schema (tables and relations), as passed to `drizzle()`. |
| `migrations` | `readonly Migration[]` | The migrations in order. |
| `now` | `() => number` | Clock stamped on applied migrations. Default `Date.now`. |

Migrations run under the lock before the promise resolves. A failure rejects with `MigrationError` and the database is
left at the last good migration.

`PersistenceDatabase<TSchema>`:

| Member | Meaning |
| --- | --- |
| `db` | A Drizzle `SqliteRemoteDatabase<TSchema>`. Each statement takes the lock; a write (`run`, or any `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `CREATE`, `DROP`, `ALTER`) is flushed before it resolves. `db.transaction()` and any raw `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` or `RELEASE` reject with `TransactionMisuseError`. |
| `transaction(fn)` | Runs `BEGIN IMMEDIATE`, then `fn(tx)`, then `COMMIT`; on a throw it runs `ROLLBACK` and rethrows. The lock is held throughout and the result is flushed once. `tx.transaction` inside is a savepoint. A `tx` used after its transaction ended rejects. |
| `exclusive(fn)` | Runs `fn` with the lock held, then flushes. For a writer outside Drizzle on the same connection. |
| `migrations` | `MigrationReport`: `applied` (every tag the database holds) and `ran` (the tags this open applied). |
| `driverName` | The driver's name, for diagnostics. |
| `close()` | Waits for pending work, then closes the driver. Later calls reject. Closing twice is a no-op. |

### `SqlDriver`

The seam between the Drizzle layer and a SQLite engine.

```ts
interface SqlDriver {
  readonly name: string
  run(sql: string, params: readonly SqlParam[]): Promise<void>
  query(sql: string, params: readonly SqlParam[]): Promise<unknown[][]>
  flush(): Promise<void>
  close(): Promise<void>
}
type SqlParam = string | number | bigint | null | Uint8Array
```

`query` returns rows as arrays in column order. `flush` makes writes durable (a no-op where they already are). A driver
never wraps a statement in a transaction of its own. `PersistenceUnavailableError` is thrown when a driver's engine
cannot be opened in the current environment.

### Migrations

```ts
interface Migration { readonly tag: string; readonly sql: string }
function migrationsFromJournal(journal: DrizzleJournal, files: Record<string, string>): Migration[]
function applyMigrations(driver: SqlDriver, migrations: readonly Migration[], now: () => number): Promise<MigrationReport>
function splitStatements(sql: string): string[]
function migrationHash(sql: string): string
const MIGRATIONS_TABLE: string
```

`tag` matches `^[A-Za-z0-9_-]{1,128}$`. `files` maps a path or a tag to the SQL text; the base name without `.sql` is
matched against the journal. A journal entry without a file, or a file the journal does not list, throws
`MigrationError('invalid-list')`. `applyMigrations` expects the caller to hold the connection's lock;
`openDatabase` does.

`MigrationError.reason` is one of `invalid-list`, `unknown-applied`, `drift`, `failed`; `tag` names the migration
involved when there is one.

### Envelope

```ts
function createEnvelope<T>(target: EnvelopeTarget, version: number, data: T, exportedAt: number): string
function parseEnvelope(text: string, target: EnvelopeTarget & { currentVersion: number; maxChars?: number }): EnvelopeResult
function parseUntrustedJson(text: string, maxChars?: number): JsonResult
function stripForbiddenKeys(value: unknown): unknown
const ENVELOPE_FORMAT: 'persistence-drizzle.save'
const DEFAULT_MAX_CHARS: 2_000_000
```

`EnvelopeTarget` is `{ app: string; kind: string }`. `createEnvelope` throws `RangeError` for a version that is not a
positive safe integer. `parseEnvelope` never throws; failures are `{ ok: false, reason }` with `reason` one of
`too-large`, `not-json`, `too-deep`, `not-envelope`, `wrong-app`, `wrong-kind`, `invalid-version`, `future-version`.
`stripForbiddenKeys` throws `RangeError` past 32 levels of nesting.

### Preferences

```ts
function createTypedPreference<T>(options: { kv: StringKv; key: string; parse: (raw: unknown) => T | null; defaults: T; maxChars?: number }): TypedPreference<T>
function createMemoryKv(): StringKv & { readonly entries: Map<string, string> }
```

`StringKv` is `{ get(key): Promise<string | null>; set(key, value): Promise<void>; remove(key): Promise<void> }`.
`TypedPreference<T>` has `load()`, `save(value)` (returns `{ ok: true }` or `{ ok: false, error }`) and `clear()`.

### Lock

`createLock()` returns `{ run(task), held }`: a first-in, first-out async lock. A rejection passes through to the caller
and releases the lock.

## `persistence-drizzle/capacitor`

```ts
function createCapacitorDriver(host: ConnectionHost): SqlDriver
function guardSnapshots<TFacade>(facade: TFacade, database: { exclusive }): Omit<TFacade, 'close'>
function rowsToArrays(values: readonly unknown[] | undefined): unknown[][]
```

`ConnectionHost` is `{ withConnection(operation, fallback), flush(), close() }`; `operation` receives a
`CapacitorConnection` (`run` and `query` of a Capacitor SQLite connection). `rowsToArrays` turns the plugin's
keyed-object rows, including iOS's leading `{ ios_columns }` row, into arrays in column order.

`guardSnapshots` wraps `save`, `load`, `list`, `delete`, `withConnection` and `flush` of a snapshot facade so each runs
under the database's lock. `close` is removed from the result: the database closes the shared connection once.

## `persistence-drizzle/node`

```ts
function createNodeSqliteDriver(location?: string): NodeSqliteDriver
function readMigrationsFolder(folder: string): Migration[]
```

`location` is a file path or `:memory:` (the default). The returned driver exposes `raw`, the underlying `DatabaseSync`,
for assertions below Drizzle. `readMigrationsFolder` reads `meta/_journal.json` and every `.sql` file of a drizzle-kit
output folder.
