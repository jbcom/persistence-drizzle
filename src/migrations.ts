/**
 * Schema migrations: the SQL files `drizzle-kit generate` writes, applied in journal order when the database opens.
 *
 * - A migration is `{ tag, sql }`; `tag` is drizzle-kit's file name without `.sql` (`0000_first_light`). The list is the
 *   journal's order (`meta/_journal.json`), which `migrationsFromJournal` reads from bundled files (Vite's
 *   `import.meta.glob(..., { query: '?raw' })`) and `readMigrationsFolder` (`./node`) reads from disk.
 * - Each migration runs in its own transaction with its bookkeeping row, so a failure leaves the database exactly at the
 *   previous version.
 * - The bookkeeping table records each applied tag and a hash of its SQL. Opening refuses, rather than writing, when the
 *   database holds a migration this build does not know (it was written by a newer build) or when a shipped migration's
 *   SQL has changed since it was applied (drift); both would otherwise corrupt the player's save quietly.
 */
import type { SqlDriver } from './driver.js'

export interface Migration {
  readonly tag: string
  readonly sql: string
}

/** The part of drizzle-kit's `meta/_journal.json` the runner reads. */
export interface DrizzleJournal {
  readonly entries: readonly { readonly idx: number; readonly tag: string }[]
}

export const MIGRATIONS_TABLE = '__arcade_migrations'

export type MigrationFailure = 'invalid-list' | 'unknown-applied' | 'drift' | 'failed'

export class MigrationError extends Error {
  constructor(
    readonly reason: MigrationFailure,
    message: string,
    readonly tag?: string,
  ) {
    super(message)
    this.name = 'MigrationError'
  }
}

const BREAKPOINT = '--> statement-breakpoint'

/** The statements of one migration file, split on drizzle-kit's breakpoints. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

/** FNV-1a over the normalised SQL: enough to notice an edited migration, not a security boundary. */
export function migrationHash(sql: string): string {
  const text = sql.replace(/\r\n/g, '\n').trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const baseName = (path: string): string => {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.endsWith('.sql') ? file.slice(0, -4) : file
}

/**
 * The migrations in journal order. `files` maps a path or a tag to the file's SQL text (the shape
 * `import.meta.glob('./drizzle/*.sql', { query: '?raw', import: 'default', eager: true })` returns); a journal entry
 * without its file is an error, as is a file the journal does not list.
 */
export function migrationsFromJournal(
  journal: DrizzleJournal,
  files: Readonly<Record<string, string>>,
): Migration[] {
  const byTag = new Map<string, string>()
  for (const [path, sql] of Object.entries(files)) byTag.set(baseName(path), sql)
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)
  const migrations = entries.map((entry) => {
    const sql = byTag.get(entry.tag)
    if (sql === undefined) {
      throw new MigrationError(
        'invalid-list',
        `migration ${entry.tag} is in the journal but its file is missing`,
        entry.tag,
      )
    }
    byTag.delete(entry.tag)
    return { tag: entry.tag, sql }
  })
  const stray = [...byTag.keys()]
  if (stray.length > 0) {
    throw new MigrationError(
      'invalid-list',
      `migration files not in the journal: ${stray.join(', ')}`,
    )
  }
  return migrations
}

function validateList(migrations: readonly Migration[]): void {
  const seen = new Set<string>()
  for (const migration of migrations) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(migration.tag)) {
      throw new MigrationError(
        'invalid-list',
        `invalid migration tag ${JSON.stringify(migration.tag)}`,
      )
    }
    if (seen.has(migration.tag)) {
      throw new MigrationError(
        'invalid-list',
        `migration ${migration.tag} is listed twice`,
        migration.tag,
      )
    }
    seen.add(migration.tag)
    if (splitStatements(migration.sql).length === 0) {
      throw new MigrationError(
        'invalid-list',
        `migration ${migration.tag} has no statements`,
        migration.tag,
      )
    }
  }
}

export interface MigrationReport {
  /** Every tag the database holds after opening, oldest first. */
  readonly applied: readonly string[]
  /** The tags this open applied (empty when the database was already current). */
  readonly ran: readonly string[]
}

/**
 * Bring the database up to the last migration. The caller holds the connection's lock and flushes afterwards; the
 * runner issues its own `begin` / `commit` per migration.
 */
export async function applyMigrations(
  driver: SqlDriver,
  migrations: readonly Migration[],
  now: () => number,
): Promise<MigrationReport> {
  validateList(migrations)
  await driver.run(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
       "idx" INTEGER PRIMARY KEY NOT NULL,
       "tag" TEXT NOT NULL UNIQUE,
       "hash" TEXT NOT NULL,
       "applied_at" INTEGER NOT NULL
     )`,
    [],
  )
  const rows = await driver.query(
    `SELECT "idx", "tag", "hash" FROM "${MIGRATIONS_TABLE}" ORDER BY "idx"`,
    [],
  )
  const applied: string[] = []
  for (const [position, row] of rows.entries()) {
    const [idx, tag, hash] = row as [number, string, string]
    const known = migrations[position]
    if (idx !== position || !known || known.tag !== tag) {
      throw new MigrationError(
        'unknown-applied',
        `the database holds migration ${tag}, which this build does not know (written by a newer build?)`,
        tag,
      )
    }
    if (migrationHash(known.sql) !== hash) {
      throw new MigrationError(
        'drift',
        `migration ${tag} changed after it was applied; ship a new migration instead`,
        tag,
      )
    }
    applied.push(tag)
  }
  const ran: string[] = []
  for (let idx = applied.length; idx < migrations.length; idx += 1) {
    const migration = migrations[idx] as Migration
    await driver.run('BEGIN IMMEDIATE', [])
    try {
      for (const statement of splitStatements(migration.sql)) await driver.run(statement, [])
      await driver.run(
        `INSERT INTO "${MIGRATIONS_TABLE}" ("idx", "tag", "hash", "applied_at") VALUES (?, ?, ?, ?)`,
        [idx, migration.tag, migrationHash(migration.sql), now()],
      )
      await driver.run('COMMIT', [])
    } catch (error) {
      await driver.run('ROLLBACK', []).catch(() => undefined)
      throw new MigrationError(
        'failed',
        `migration ${migration.tag} failed: ${error instanceof Error ? error.message : String(error)}`,
        migration.tag,
      )
    }
    applied.push(migration.tag)
    ran.push(migration.tag)
  }
  return { applied, ran }
}
