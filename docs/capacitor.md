---
title: The Capacitor driver
description: Run the database over a Capacitor SQLite connection on a device or in the browser.
---

`persistence-drizzle/capacitor` drives a Capacitor SQLite connection through a small host:

```ts
interface ConnectionHost {
  withConnection<T>(operation: (connection: CapacitorConnection) => Promise<T>, fallback: T): Promise<T>
  flush(): Promise<void>
  close(): Promise<void>
}
```

`CapacitorConnection` is the `run` and `query` of `SQLiteDBConnection` from `@capacitor-community/sqlite`. The types are
structural, so the package depends on neither the plugin nor any particular connection manager; any object with those
methods fits. When `withConnection` returns the `fallback` (the connection is unavailable), the driver throws
`PersistenceUnavailableError`.

```ts
import { openDatabase } from 'persistence-drizzle'
import { createCapacitorDriver, guardSnapshots } from 'persistence-drizzle/capacitor'

const database = await openDatabase({ driver: createCapacitorDriver(host), schema, migrations })
const snapshots = guardSnapshots(snapshotFacade, database)
```

## Behaviors to know

- Statements run with `transaction: false`, so the plugin does not wrap each in a transaction that would break the
  database's own `BEGIN` and `COMMIT`.
- The plugin returns rows as objects keyed by column name; on iOS the first row is `{ ios_columns: [...] }`. The
  driver turns both into arrays in column order (`rowsToArrays`). Two result columns with one name collapse into one
  key, so alias clashing columns in joins.
- No `RETURNING`: the plugin's `query` is for reads. Insert, then select.
- `flush` is the host's: on the web it exports the in-memory database to durable storage.

## Tests

Run the same Drizzle path in Node with `createNodeSqliteDriver` from `persistence-drizzle/node`; there is no native
addon.
