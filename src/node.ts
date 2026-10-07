/**
 * The Node driver: `node:sqlite` (built into Node 24), for unit tests, tools and scripts. No native addon and no install
 * script, so it runs wherever the fleet's Node does. It goes through the same Drizzle path as the device driver.
 *
 * `readMigrationsFolder` reads the folder `drizzle-kit generate` writes (`meta/_journal.json` plus one `.sql` per tag).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { SqlDriver, SqlParam } from './driver.js'
import { type DrizzleJournal, type Migration, migrationsFromJournal } from './migrations.js'

export interface NodeSqliteDriver extends SqlDriver {
  /** The underlying database, for test assertions that read below Drizzle. */
  readonly raw: DatabaseSync
}

/** A driver over a file, or over a private in-memory database when `location` is `:memory:` (the default). */
export function createNodeSqliteDriver(location = ':memory:'): NodeSqliteDriver {
  const raw = new DatabaseSync(location)
  raw.exec('PRAGMA foreign_keys = ON')
  const bind = (params: readonly SqlParam[]) => params as SQLInputValue[]
  return {
    name: 'node:sqlite',
    raw,
    async run(sql, params) {
      raw.prepare(sql).run(...bind(params))
    },
    async query(sql, params) {
      const statement = raw.prepare(sql)
      statement.setReturnArrays(true)
      return statement.all(...bind(params)) as unknown as unknown[][]
    },
    async flush() {},
    async close() {
      if (raw.isOpen) raw.close()
    },
  }
}

/** The migrations in a drizzle-kit output folder, in journal order. */
export function readMigrationsFolder(folder: string): Migration[] {
  const journal = JSON.parse(
    readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'),
  ) as DrizzleJournal
  const files: Record<string, string> = {}
  for (const file of readdirSync(folder)) {
    if (file.endsWith('.sql')) files[file] = readFileSync(join(folder, file), 'utf8')
  }
  return migrationsFromJournal(journal, files)
}
