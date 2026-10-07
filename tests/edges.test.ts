import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/database.js'
import { PersistenceUnavailableError, type SqlDriver } from '../src/driver.js'
import { parseEnvelope } from '../src/envelope.js'
import { createLock } from '../src/lock.js'
import { applyMigrations, MigrationError, migrationsFromJournal } from '../src/migrations.js'
import { createNodeSqliteDriver } from '../src/node.js'
import { createMemoryKv, createTypedPreference } from '../src/preferences.js'

/** A node:sqlite driver whose ROLLBACK itself fails, as a connection that died mid-transaction would. */
function brokenRollback(): SqlDriver {
  const inner = createNodeSqliteDriver()
  return {
    ...inner,
    name: 'broken-rollback',
    async run(sql, params) {
      if (sql.trim().toUpperCase() === 'ROLLBACK') throw new Error('connection lost')
      return inner.run(sql, params)
    },
    query: inner.query,
    flush: inner.flush,
    close: inner.close,
  }
}

describe('failure paths', () => {
  it('reports the original error when a transaction body throws and the rollback fails too', async () => {
    const database = await openDatabase({
      driver: brokenRollback(),
      schema: {},
      migrations: [{ tag: '0000_notes', sql: 'CREATE TABLE notes (id integer PRIMARY KEY);' }],
    })
    await expect(
      database.transaction(async () => {
        throw new Error('body failed')
      }),
    ).rejects.toThrow('body failed')
  })

  it('reports a migration failure when the rollback fails too', async () => {
    const driver = brokenRollback()
    const error = await applyMigrations(
      driver,
      [{ tag: '0000_bad', sql: 'NOT SQL AT ALL;' }],
      () => 0,
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MigrationError)
    expect((error as MigrationError).reason).toBe('failed')
  })

  it('describes a migration failure that threw something other than an Error', async () => {
    const driver = createNodeSqliteDriver()
    const failing: SqlDriver = {
      ...driver,
      name: 'string-thrower',
      async run(sql, params) {
        if (sql.startsWith('CREATE TABLE notes')) throw 'plain string'
        return driver.run(sql, params)
      },
      query: driver.query,
      flush: driver.flush,
      close: driver.close,
    }
    await expect(
      applyMigrations(
        failing,
        [{ tag: '0000_notes', sql: 'CREATE TABLE notes (id integer);' }],
        () => 0,
      ),
    ).rejects.toThrow('migration 0000_notes failed: plain string')
  })

  it('rejects a tag that is not a safe identifier', async () => {
    const driver = createNodeSqliteDriver()
    await expect(
      applyMigrations(driver, [{ tag: 'no spaces allowed', sql: 'SELECT 1;' }], () => 0),
    ).rejects.toMatchObject({ reason: 'invalid-list' })
  })

  it('finds journal files by bare tag as well as by path', () => {
    const journal = { entries: [{ idx: 0, tag: '0000_notes' }] }
    expect(migrationsFromJournal(journal, { '0000_notes': 'SELECT 1;' })).toEqual([
      { tag: '0000_notes', sql: 'SELECT 1;' },
    ])
  })

  it('names the driver when its engine is unavailable, with or without a cause', () => {
    expect(new PersistenceUnavailableError('engine').message).toBe(
      'engine: SQLite is unavailable here',
    )
    expect(new PersistenceUnavailableError('engine', new Error('no wasm')).message).toBe(
      'engine: SQLite is unavailable here: no wasm',
    )
    expect(new PersistenceUnavailableError('engine', 'text').message).toBe(
      'engine: SQLite is unavailable here',
    )
  })

  it('reads a missing or invalid exportedAt as zero', () => {
    const target = { app: 'game', kind: 'profile', currentVersion: 1 }
    const text = JSON.stringify({
      format: 'persistence-drizzle.save',
      app: 'game',
      kind: 'profile',
      version: 1,
      exportedAt: 'yesterday',
      data: {},
    })
    expect(parseEnvelope(text, target)).toEqual({ ok: true, version: 1, exportedAt: 0, data: {} })
  })

  it('refuses a value whose save throws a non-Error', async () => {
    const kv = createMemoryKv()
    const preference = createTypedPreference({
      kv: {
        ...kv,
        async set() {
          throw 'disk full'
        },
      },
      key: 'k',
      parse: (raw) => raw,
      defaults: 1,
    })
    expect(await preference.save(2)).toEqual({ ok: false, error: 'disk full' })
  })

  it('closes a node:sqlite driver twice without error', async () => {
    const driver = createNodeSqliteDriver()
    await driver.close()
    await expect(driver.close()).resolves.toBeUndefined()
  })
})

describe('lock', () => {
  it('reports whether a task holds it', async () => {
    const lock = createLock()
    expect(lock.held).toBe(false)
    let during = false
    await lock.run(async () => {
      during = lock.held
    })
    expect(during).toBe(true)
    expect(lock.held).toBe(false)
  })

  it('keeps serving after a task rejects', async () => {
    const lock = createLock()
    await expect(lock.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(lock.run(async () => 'next')).resolves.toBe('next')
  })
})
