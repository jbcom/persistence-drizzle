/**
 * The device and web driver: Drizzle over the one connection `@arcade-cabinet/persistence-save` opens.
 *
 * persistence-save's `createPersistence` already owns the hard parts (the `<jeep-sqlite>` element and its WASM assets on
 * the web, the Capacitor connection manager, SQLCipher on native, the web store's flush) and exposes `withConnection` and
 * `flush` as the seam for adjacent tables. This driver runs Drizzle's statements through that seam, so a game has one
 * connection manager and one flush path whether it keeps snapshot saves, Drizzle tables or both.
 *
 * Both writers share one connection, so they must share one lock: wrap the facade with `guardSnapshots(facade, database)`
 * and use only the wrapped one. A snapshot save then waits for an open transaction instead of landing inside it.
 *
 * The types here are structural, so the package carries no Capacitor or persistence-save version: any connection with
 * `run` and `query` and any host with `withConnection`, `flush` and `close` fits.
 */
import { PersistenceUnavailableError, type SqlDriver, type SqlParam } from './driver.js'

/** The part of `SQLiteDBConnection` (@capacitor-community/sqlite) the driver uses. */
export interface CapacitorConnection {
  run(
    statement: string,
    values?: unknown[],
    transaction?: boolean,
    returnMode?: string,
  ): Promise<unknown>
  query(statement: string, values?: unknown[]): Promise<{ values?: unknown[] }>
}

/** The part of persistence-save's `Persistence` the driver uses. */
export interface ConnectionHost {
  withConnection<T>(
    operation: (connection: CapacitorConnection) => Promise<T>,
    fallback: T,
  ): Promise<T>
  flush(): Promise<void>
  close(): Promise<void>
}

const UNAVAILABLE = Symbol('unavailable')

/**
 * Capacitor SQLite returns rows as objects keyed by column name; on iOS the first row is `{ ios_columns: [...] }`, the
 * column order. With that order the row maps exactly; without it, a row's own key order is the statement's column order.
 * Two result columns with one name collapse into one key, so a query that joins tables must alias clashing columns.
 */
export function rowsToArrays(values: readonly unknown[] | undefined): unknown[][] {
  if (!values || values.length === 0) return []
  let rows = values
  let columns: readonly string[] | null = null
  const first = values[0]
  if (first !== null && typeof first === 'object' && 'ios_columns' in first) {
    columns = (first as { ios_columns: string[] }).ios_columns
    rows = values.slice(1)
  }
  return rows.map((row) => {
    if (Array.isArray(row)) return row
    const record = row as Record<string, unknown>
    return columns ? columns.map((column) => record[column]) : Object.values(record)
  })
}

export function createCapacitorDriver(host: ConnectionHost): SqlDriver {
  const name = 'capacitor-sqlite'
  const withConnection = async <T>(operation: (connection: CapacitorConnection) => Promise<T>) => {
    const result = await host.withConnection<T | typeof UNAVAILABLE>(operation, UNAVAILABLE)
    if (result === UNAVAILABLE) throw new PersistenceUnavailableError(name)
    return result
  }
  return {
    name,
    async run(sql: string, params: readonly SqlParam[]): Promise<void> {
      // `transaction: false`: the plugin would otherwise wrap each statement in a transaction of its own, which breaks
      // the database's explicit BEGIN / COMMIT.
      await withConnection((connection) => connection.run(sql, [...params], false, 'no'))
    },
    async query(sql: string, params: readonly SqlParam[]): Promise<unknown[][]> {
      const result = await withConnection((connection) => connection.query(sql, [...params]))
      return rowsToArrays(result.values)
    },
    flush: () => host.flush(),
    close: () => host.close(),
  }
}

/** The snapshot facade's operations that touch the connection. */
type SnapshotMethod = 'save' | 'load' | 'list' | 'delete' | 'withConnection' | 'flush'

/**
 * persistence-save's snapshot facade with every operation run under the database's lock, so snapshot saves (and its
 * autosave scheduler, which calls `save`) are serialised with Drizzle's statements and transactions on the shared
 * connection. `close` is left to the database, which closes the shared connection once.
 */
export function guardSnapshots<
  TFacade extends { [K in SnapshotMethod]: (...args: never[]) => Promise<unknown> },
>(
  facade: TFacade,
  database: { exclusive<T>(fn: () => Promise<T>): Promise<T> },
): Omit<TFacade, 'close'> {
  const guarded: Record<string, unknown> = { ...facade }
  for (const method of ['save', 'load', 'list', 'delete', 'withConnection', 'flush'] as const) {
    const original = facade[method] as (...args: unknown[]) => Promise<unknown>
    guarded[method] = (...args: unknown[]) => database.exclusive(() => original.apply(facade, args))
  }
  delete guarded.close
  return guarded as Omit<TFacade, 'close'>
}
