import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/database.js'
import {
  MIGRATIONS_TABLE,
  MigrationError,
  migrationHash,
  migrationsFromJournal,
  splitStatements,
} from '../src/migrations.js'
import { createNodeSqliteDriver } from '../src/node.js'
import { items, MIGRATIONS, players, schema } from './fixtures/schema.js'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'persistence-drizzle-'))
  file = path.join(dir, 'save.sqlite')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const open = (migrations = MIGRATIONS, location = file) =>
  openDatabase({ driver: createNodeSqliteDriver(location), schema, migrations, now: () => 42 })

const tables = (driver: ReturnType<typeof createNodeSqliteDriver>) =>
  (
    driver.raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((row) => row.name)

describe('migrations from the drizzle-kit folder', () => {
  it('reads the journal in order and splits on statement breakpoints', () => {
    expect(MIGRATIONS.map((m) => m.tag)).toEqual(['0000_first_save', '0001_coins_and_items'])
    expect(splitStatements((MIGRATIONS[1] as { sql: string }).sql)).toHaveLength(3)
  })

  it('upgrades an empty database to the latest schema', async () => {
    const database = await open()
    expect(database.migrations).toEqual({
      applied: ['0000_first_save', '0001_coins_and_items'],
      ran: ['0000_first_save', '0001_coins_and_items'],
    })
    await database.db.insert(players).values({ id: 1, name: 'Nakhtmin', coins: 3 })
    await database.db.insert(items).values({ playerId: 1, kind: 'khopesh' })
    expect(await database.db.select().from(players)).toEqual([
      { id: 1, name: 'Nakhtmin', coins: 3 },
    ])
    await database.close()
  })

  it('upgrades a database written at each previous version, keeping its data', async () => {
    for (let version = 1; version < MIGRATIONS.length; version += 1) {
      const location = path.join(dir, `v${version}.sqlite`)
      const old = await open(MIGRATIONS.slice(0, version), location)
      expect(old.migrations.applied).toHaveLength(version)
      // Data as that version's schema wrote it, below Drizzle's latest types.
      await old.exclusive(async () => {
        const driver = createNodeSqliteDriver(location)
        await driver.run(`INSERT INTO players (id, name) VALUES (?, ?)`, [7, 'scribe'])
        await driver.close()
      })
      await old.close()

      const current = await open(MIGRATIONS, location)
      expect(current.migrations.ran).toEqual(MIGRATIONS.slice(version).map((m) => m.tag))
      expect(await current.db.select().from(players).where(eq(players.id, 7))).toEqual([
        { id: 7, name: 'scribe', coins: 0 },
      ])
      await current.db.insert(items).values({ playerId: 7, kind: 'lamp' })
      expect(await current.db.select().from(items)).toHaveLength(1)
      await current.close()
    }
  })

  it('is a no-op on a current database', async () => {
    await (await open()).close()
    const again = await open()
    expect(again.migrations.ran).toEqual([])
    await again.close()
  })

  it('refuses a database written by a newer build, and writes nothing', async () => {
    await (await open()).close()
    const driver = createNodeSqliteDriver(file)
    const before = tables(driver)
    await expect(
      openDatabase({ driver, schema, migrations: MIGRATIONS.slice(0, 1) }),
    ).rejects.toMatchObject({ name: 'MigrationError', reason: 'unknown-applied' })
    expect(tables(driver)).toEqual(before)
    await driver.close()
  })

  it('refuses a shipped migration whose SQL changed after it was applied', async () => {
    await (await open()).close()
    const edited = MIGRATIONS.map((m, i) =>
      i === 0 ? { ...m, sql: `${m.sql}\nCREATE TABLE extra (id integer);` } : m,
    )
    await expect(open(edited)).rejects.toMatchObject({ reason: 'drift', tag: '0000_first_save' })
  })

  it('rolls a failing migration back whole, leaving the previous version intact', async () => {
    await (await open(MIGRATIONS.slice(0, 1))).close()
    const broken = [
      ...MIGRATIONS.slice(0, 1),
      {
        tag: '0001_broken',
        sql: 'CREATE TABLE half (id integer);--> statement-breakpoint\nNOT SQL;',
      },
    ]
    await expect(open(broken)).rejects.toMatchObject({ reason: 'failed', tag: '0001_broken' })
    const driver = createNodeSqliteDriver(file)
    expect(tables(driver)).not.toContain('half')
    expect(
      driver.raw
        .prepare(`SELECT tag FROM "${MIGRATIONS_TABLE}"`)
        .all()
        .map((r) => r.tag),
    ).toEqual(['0000_first_save'])
    await driver.close()
  })

  it('rejects a journal and file set that disagree, and duplicate or empty migrations', () => {
    const journal = { entries: [{ idx: 0, tag: '0000_a' }] }
    expect(() => migrationsFromJournal(journal, {})).toThrow(MigrationError)
    expect(() =>
      migrationsFromJournal(journal, { './0000_a.sql': 'select 1', './0001_b.sql': 'select 1' }),
    ).toThrow(/not in the journal/)
    expect(migrationsFromJournal(journal, { './drizzle/0000_a.sql': 'select 1' })).toEqual([
      { tag: '0000_a', sql: 'select 1' },
    ])
    const dup = [
      { tag: 'a', sql: 'select 1' },
      { tag: 'a', sql: 'select 2' },
    ]
    return Promise.all([
      expect(open(dup, ':memory:')).rejects.toMatchObject({ reason: 'invalid-list' }),
      expect(open([{ tag: 'a', sql: '  ' }], ':memory:')).rejects.toMatchObject({
        reason: 'invalid-list',
      }),
    ])
  })

  it('hashes SQL independent of line endings', () => {
    expect(migrationHash('a\r\nb')).toBe(migrationHash('a\nb'))
    expect(migrationHash('a')).not.toBe(migrationHash('b'))
  })
})
