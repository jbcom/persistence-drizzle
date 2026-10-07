---
title: Architecture
description: The lock, the transaction rules, the migration runner and the module boundaries of persistence-drizzle.
---

## Modules

| Module | Responsibility |
| --- | --- |
| `lock` | A first-in, first-out async lock. |
| `driver` | The `SqlDriver` seam and `PersistenceUnavailableError`. |
| `database` | `openDatabase`: Drizzle `sqlite-proxy` over a driver, behind the lock. |
| `migrations` | drizzle-kit migrations, bookkeeping table, refusal of unknown and drifted state. |
| `envelope` | Bounded, sanitised export and import of a domain value as text. |
| `preferences` | Typed settings over a string key-value store. |
| `capacitor` | A driver over a `withConnection` / `flush` / `close` host; the snapshot lock guard. |
| `node` | A driver over `node:sqlite`; reading a drizzle-kit folder from disk. |

The root entry point imports no engine. `./capacitor` is structural: it declares the parts of a host and of a Capacitor
connection it uses and depends on neither package. `./node` is the only module that imports `node:sqlite`.

## Invariants

1. **One lock per database.** Every statement, every transaction and every `exclusive` task takes the same lock, in
   arrival order. Nothing is interleaved on the connection.
2. **A transaction holds the lock for its whole body.** `transaction(fn)` runs `BEGIN IMMEDIATE` inside the lock,
   `fn(tx)`, then `COMMIT` or `ROLLBACK`. The `tx` handed to `fn` goes straight to the driver, because the lock is
   already held; using `db` inside would wait on it forever.
3. **`db.transaction` is refused.** Over a proxy, Drizzle issues `begin` as a plain statement and lets other writers
   run between the statements that follow. The proxy rejects `begin`, `commit`, `end`, `rollback`, `savepoint` and
   `release` on `db` with `TransactionMisuseError`.
4. **A leaked `tx` is refused.** A `tx` that outlives its transaction would bypass the lock, so it rejects once the
   transaction has ended.
5. **A resolved write is durable.** A write on `db` is flushed before its promise resolves; a transaction flushes once
   after commit. Where the engine's storage is an export (a browser SQLite in memory), this is what makes a saved game
   survive a reload.
6. **Migrations never half-apply.** Each runs in its own `BEGIN IMMEDIATE` transaction together with its bookkeeping
   row. A failure rolls back and raises `MigrationError('failed')`.
7. **Opening refuses before writing.** A database holding a migration this build does not know is refused as
   `unknown-applied`; one whose applied migration has a different hash than the shipped SQL is refused as `drift`.
8. **Reading hostile text never throws.** Envelope and preference reads bound the size, parse, strip prototype-polluting
   keys at every depth and report failure as a value.

## Statement flow

`db.select()` becomes a proxy call `(sql, params, method)`. The proxy rejects transaction-control statements, takes the
lock, asserts the database is open, runs the statement through the driver (`run` for `method === 'run'`, `query`
otherwise; `get` takes the first row) and flushes after a write. `transaction(fn)` bypasses the per-statement lock
for `tx` because it already holds it.

## Hashing

`migrationHash` is FNV-1a over the SQL with line endings normalised and surrounding whitespace trimmed. It detects an
edited migration; it is not a security boundary.

## Intentional limits

- No `RETURNING` through the Capacitor driver: the plugin's `query` is for reads. Insert, then select.
- Two result columns with the same name collapse into one key in the Capacitor plugin's row objects. Alias them.
- One connection per database. The package serializes access to a connection; it does not pool.
