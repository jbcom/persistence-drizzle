/**
 * The typed database: Drizzle's sqlite-proxy over a `SqlDriver`, with every statement serialised through one lock.
 *
 * - `db` is a full Drizzle database. Each statement takes the lock on its own; a write is flushed (the web store's export)
 *   before its promise resolves, so a save that resolved survives a reload.
 * - `transaction(fn)` holds the lock for the whole of `fn`, runs `BEGIN IMMEDIATE` / `COMMIT` (or `ROLLBACK` on a throw)
 *   and flushes once at the end. Inside `fn`, use the `tx` it is given: `db` would wait for the lock `fn` holds.
 *   Drizzle's own `db.transaction` is refused, because over a proxy it issues `begin` as a statement and lets other
 *   writers interleave between the statements that follow.
 * - `exclusive(fn)` holds the same lock for a writer outside Drizzle on the same connection (persistence-save's snapshot
 *   saves, see `guardSnapshots` in `./capacitor`), so it can never land inside a transaction.
 * - Migrations run before the database is handed back.
 */
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { SqlDriver, SqlParam } from './driver.js'
import { createLock } from './lock.js'
import { applyMigrations, type Migration, type MigrationReport } from './migrations.js'

export type Schema = Record<string, unknown>
export type Db<TSchema extends Schema> = SqliteRemoteDatabase<TSchema>

export interface OpenDatabaseOptions<TSchema extends Schema> {
  readonly driver: SqlDriver
  readonly schema: TSchema
  readonly migrations: readonly Migration[]
  /** The clock stamped on applied migrations. Defaults to `Date.now`. */
  readonly now?: () => number
}

export interface PersistenceDatabase<TSchema extends Schema> {
  /** Drizzle, one serialised statement at a time. */
  readonly db: Db<TSchema>
  /** Run `fn` atomically with the lock held throughout; the result is flushed once it commits. */
  transaction<T>(fn: (tx: Db<TSchema>) => Promise<T>): Promise<T>
  /** Hold the connection's lock for a writer outside Drizzle; flushed afterwards. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>
  /** What opening did to the schema. */
  readonly migrations: MigrationReport
  /** The driver's name, for diagnostics. */
  readonly driverName: string
  /** Wait for pending work, then close the connection. Further calls reject. */
  close(): Promise<void>
}

/** Thrown when Drizzle's own transaction API is used instead of `PersistenceDatabase.transaction`. */
export class TransactionMisuseError extends Error {
  constructor() {
    super(
      'use PersistenceDatabase.transaction(fn), not db.transaction(): over a proxy it lets writers interleave',
    )
    this.name = 'TransactionMisuseError'
  }
}

const CONTROL = /^\s*(begin|commit|end|rollback|savepoint|release)\b/i
const WRITE = /^\s*(insert|update|delete|replace|create|drop|alter)\b/i

type Method = 'run' | 'all' | 'values' | 'get'

async function execute(
  driver: SqlDriver,
  sql: string,
  params: readonly unknown[],
  method: Method,
): Promise<{ rows: unknown[] }> {
  const bound = params as readonly SqlParam[]
  if (method === 'run') {
    await driver.run(sql, bound)
    return { rows: [] }
  }
  const rows = await driver.query(sql, bound)
  // sqlite-proxy expects one row for `get` and a list of rows otherwise. Its type says an array for both, but a missing
  // row must be `undefined`, which it returns as "no result"; an empty array would map to a row of undefined columns.
  return { rows: (method === 'get' ? rows[0] : rows) as unknown[] }
}

export async function openDatabase<TSchema extends Schema>(
  options: OpenDatabaseOptions<TSchema>,
): Promise<PersistenceDatabase<TSchema>> {
  const { driver, schema, migrations, now = Date.now } = options
  const lock = createLock()
  let closed = false

  const assertOpen = () => {
    if (closed) throw new Error(`${driver.name}: the database is closed`)
  }

  const db = drizzle(
    async (sql, params, method) => {
      if (CONTROL.test(sql)) throw new TransactionMisuseError()
      return lock.run(async () => {
        assertOpen()
        const result = await execute(driver, sql, params, method)
        if (method === 'run' || WRITE.test(sql)) await driver.flush()
        return result
      })
    },
    { schema },
  )

  // Bound to the lock the transaction already holds: its statements, savepoints included, go straight to the driver.
  // A `tx` kept past its transaction would bypass the lock, so it refuses to run outside one.
  let inTransaction = false
  const txDb = drizzle(
    async (sql, params, method) => {
      if (!inTransaction)
        throw new Error(`${driver.name}: a transaction's tx was used after it ended`)
      return execute(driver, sql, params, method)
    },
    { schema },
  )

  const report = await lock.run(async () => {
    const result = await applyMigrations(driver, migrations, now)
    await driver.flush()
    return result
  })

  return {
    db,
    migrations: report,
    driverName: driver.name,
    transaction<T>(fn: (tx: Db<TSchema>) => Promise<T>): Promise<T> {
      return lock.run(async () => {
        assertOpen()
        await driver.run('BEGIN IMMEDIATE', [])
        inTransaction = true
        let result: T
        try {
          result = await fn(txDb)
          await driver.run('COMMIT', [])
        } catch (error) {
          await driver.run('ROLLBACK', []).catch(() => undefined)
          throw error
        } finally {
          inTransaction = false
        }
        await driver.flush()
        return result
      })
    },
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
      return lock.run(async () => {
        assertOpen()
        const result = await fn()
        await driver.flush()
        return result
      })
    },
    close(): Promise<void> {
      return lock.run(async () => {
        if (closed) return
        closed = true
        await driver.close()
      })
    },
  }
}
