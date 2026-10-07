# persistence-drizzle

[![CI](https://github.com/jbcom/persistence-drizzle/actions/workflows/ci.yml/badge.svg)](https://github.com/jbcom/persistence-drizzle/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/persistence-drizzle)](https://www.npmjs.com/package/persistence-drizzle)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A typed [Drizzle ORM](https://orm.drizzle.team) database over any SQLite driver, built for an app that owns one
SQLite connection and several writers: a Capacitor app on a phone, a browser app on `sql.js`, a Node test suite.

One SQLite connection runs one statement stream. This package puts a first-in, first-out lock in front of it so that
every statement, every transaction and every foreign writer is serialized, and adds what a relational save needs on top:

- a Drizzle `sqlite-proxy` database whose every statement takes the lock, and whose writes are flushed before they
  resolve;
- `BEGIN IMMEDIATE` transactions that hold the lock throughout, so nothing can land inside one;
- [drizzle-kit](https://orm.drizzle.team/docs/kit-overview) migrations applied at open, each in its own transaction,
  with tag and hash bookkeeping that refuses a database written by a newer build and a shipped migration edited after
  it ran;
- typed Preferences for small settings over any string key-value store;
- a hardened export envelope for moving a save between devices as text;
- drivers for Capacitor SQLite (`persistence-drizzle/capacitor`) and `node:sqlite` (`persistence-drizzle/node`), over a
  one-method-per-operation `SqlDriver` seam you can implement for any other engine.

## Install

```sh
npm install persistence-drizzle drizzle-orm
```

`drizzle-orm` (`>=0.45.2 <1`) is the only peer dependency. Node 24 or later.

## Quick start

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { openDatabase } from 'persistence-drizzle'
import { createNodeSqliteDriver } from 'persistence-drizzle/node'

const players = sqliteTable('players', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
})

const database = await openDatabase({
  driver: createNodeSqliteDriver(), // in memory; pass a file path to persist
  schema: { players },
  migrations: [
    { tag: '0000_players', sql: 'CREATE TABLE players (id integer PRIMARY KEY NOT NULL, name text NOT NULL);' },
  ],
})

await database.transaction(async (tx) => {
  await tx.insert(players).values({ id: 1, name: 'Player One' })
})
console.log(await database.db.select().from(players))
await database.close()
```

With a drizzle-kit output folder, read the migrations from disk in Node, or bundle the `.sql` files and the journal
with your build tool:

```ts
import { migrationsFromJournal } from 'persistence-drizzle'
import journal from './drizzle/meta/_journal.json'

const migrations = migrationsFromJournal(
  journal,
  import.meta.glob('./drizzle/*.sql', { query: '?raw', import: 'default', eager: true }),
)
```

## On a device or the web

`persistence-drizzle/capacitor` drives any host shaped like the `persistence-save` connection manager: it provides
`withConnection(operation, fallback)`, `flush()` and `close()`, where `operation` receives a Capacitor SQLite connection.
The package depends on neither, so a host from any version that has those three methods fits.

```ts
import { openDatabase } from 'persistence-drizzle'
import { createCapacitorDriver, guardSnapshots } from 'persistence-drizzle/capacitor'

const database = await openDatabase({ driver: createCapacitorDriver(host), schema, migrations })
// Snapshot saves go through the same lock, so they never land inside a transaction.
const snapshots = guardSnapshots(snapshotFacade, database)
```

## API

| Export | What it does |
| --- | --- |
| `openDatabase({ driver, schema, migrations, now? })` | Applies the migrations, then returns `{ db, transaction, exclusive, migrations, driverName, close }` |
| `db` | A Drizzle `SqliteRemoteDatabase<schema>`. Each statement takes the lock; a write is flushed before it resolves. `db.transaction()` is refused (`TransactionMisuseError`) |
| `transaction(fn)` | `BEGIN IMMEDIATE`, then `COMMIT`, or `ROLLBACK` on a throw, with the lock held; one flush on commit. Use the `tx` given to `fn`. A `tx` kept past its transaction refuses to run |
| `exclusive(fn)` | Holds the lock for a writer outside Drizzle on the same connection, then flushes |
| `migrationsFromJournal(journal, files)` | The migrations in journal order from bundled files |
| `MigrationError` | `reason`: `invalid-list`, `unknown-applied` (a newer build wrote this database), `drift` (an applied migration changed), `failed` (rolled back whole) |
| `createEnvelope(target, version, data, exportedAt)` and `parseEnvelope(text, target)` | Export and import of a domain value. Reading is bounded, strips `__proto__`, `constructor` and `prototype` at every depth, refuses other apps, other kinds and newer versions, and never throws |
| `parseUntrustedJson`, `stripForbiddenKeys` | The same hygiene for any stored or imported JSON |
| `createTypedPreference({ kv, key, parse, defaults })` | `load` (defaults on anything unusable), `save` (refuses what `parse` rejects), `clear`. `createMemoryKv()` for tests |
| `persistence-drizzle/capacitor`: `createCapacitorDriver(host)` | The device and web driver over a `withConnection` / `flush` / `close` host |
| `persistence-drizzle/capacitor`: `guardSnapshots(facade, database)` | A snapshot facade with every call under the database's lock |
| `persistence-drizzle/node`: `createNodeSqliteDriver(location?)`, `readMigrationsFolder(dir)` | `node:sqlite` for tests and tools; a drizzle-kit output folder from disk |

Full signatures are in [docs/API.md](docs/API.md), the invariants in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Rules

- **One connection, one lock.** Every writer on the connection goes through the database: Drizzle through `db` or
  `transaction`, snapshot saves through `guardSnapshots`, anything else through `exclusive`.
- **Inside `transaction(fn)`, use `tx`.** `db` would wait for the lock `fn` holds.
- **Alias clashing column names in joins.** Capacitor SQLite returns rows as objects, so two result columns with one
  name collapse into one key.
- **No `RETURNING` on the device.** The plugin's `query` is for reads; insert, then select.
- **Never edit a shipped migration.** Generate a new one; the runner refuses drift.
- **Export the domain value, not rows.** Rows change shape with every migration; the domain value carries its own
  version.

## Compatibility

| | |
| --- | --- |
| Node | 24 and later (`node:sqlite`); CI runs 24 and 26 on Linux and 26 on Windows |
| `drizzle-orm` | `>=0.45.2 <1` |
| Module formats | ESM and CommonJS, with types for both |

## Links

- [Documentation](https://jonbogaty.com/persistence-drizzle/)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md) and [security policy](SECURITY.md)

## License

[MIT](LICENSE)
