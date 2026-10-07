/**
 * The one seam between the Drizzle layer and a SQLite engine. A driver runs single statements with bound parameters and
 * returns rows as arrays in column order, which is what Drizzle's sqlite-proxy maps onto the schema. Two ship with the
 * package: `createCapacitorDriver` (`./capacitor`, over persistence-save's connection: native SQLite or jeep-sqlite on the
 * web) and `createNodeSqliteDriver` (`./node`, `node:sqlite` for tests and tools). Every driver goes through the same
 * Drizzle path, so a Node test exercises the code the device runs.
 */

/** A value SQLite can bind. Drizzle has already turned booleans and dates into numbers by the time a driver sees them. */
export type SqlParam = string | number | bigint | null | Uint8Array

export interface SqlDriver {
  /** A short name for errors and logs (`capacitor`, `node:sqlite`). */
  readonly name: string
  /** Run one statement that returns no rows. Never wraps it in a transaction of its own. */
  run(sql: string, params: readonly SqlParam[]): Promise<void>
  /** Run one statement and return its rows as arrays, in the statement's column order. */
  query(sql: string, params: readonly SqlParam[]): Promise<unknown[][]>
  /** Make every write so far durable (the web store's export to IndexedDB). A no-op where writes already are. */
  flush(): Promise<void>
  /** Close the connection. */
  close(): Promise<void>
}

/** Thrown when the driver's engine cannot be opened in this environment (no WASM, blocked storage). */
export class PersistenceUnavailableError extends Error {
  constructor(driver: string, cause?: unknown) {
    super(
      `${driver}: SQLite is unavailable here${cause instanceof Error ? `: ${cause.message}` : ''}`,
    )
    this.name = 'PersistenceUnavailableError'
  }
}
