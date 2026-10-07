import { describe, expect, it } from 'vitest'
import {
  type CapacitorConnection,
  type ConnectionHost,
  createCapacitorDriver,
  guardSnapshots,
  rowsToArrays,
} from '../src/capacitor.js'
import { openDatabase } from '../src/database.js'
import { PersistenceUnavailableError } from '../src/driver.js'
import { createNodeSqliteDriver } from '../src/node.js'
import { items, MIGRATIONS, players, schema } from './fixtures/schema.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

/**
 * persistence-save's facade, reduced to what matters here and run on node:sqlite: one shared connection behind
 * `withConnection`, and a snapshot `save` that, like the real one, is a DELETE then an INSERT with awaits between.
 * Calls are recorded so a test can see what the plugin was asked to do.
 */
function fakePersistenceSave() {
  const engine = createNodeSqliteDriver()
  engine.raw.exec(
    `CREATE TABLE saves (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, snapshot TEXT NOT NULL)`,
  )
  const calls: { op: string; transaction?: boolean | undefined }[] = []
  const connection: CapacitorConnection = {
    async run(statement, values = [], transaction) {
      calls.push({ op: 'run', transaction })
      await tick()
      engine.raw.prepare(statement).run(...(values as never[]))
      return { changes: { changes: 1 } }
    },
    async query(statement, values = []) {
      calls.push({ op: 'query' })
      await tick()
      // The plugin's shape: objects keyed by column name.
      return { values: engine.raw.prepare(statement).all(...(values as never[])) }
    },
  }
  let available = true
  let flushes = 0
  const facade = {
    async save(name: string, state: unknown) {
      await connection.run('DELETE FROM saves WHERE name = ?', [name], false)
      await tick()
      await connection.run(
        'INSERT INTO saves (name, snapshot) VALUES (?, ?)',
        [name, JSON.stringify(state)],
        false,
      )
      flushes += 1
    },
    async load(id: number) {
      return (await connection.query('SELECT * FROM saves WHERE id = ?', [id])).values?.[0] ?? null
    },
    async list() {
      return (await connection.query('SELECT * FROM saves', [])).values ?? []
    },
    async delete(id: number) {
      await connection.run('DELETE FROM saves WHERE id = ?', [id], false)
    },
    async withConnection<T>(operation: (c: CapacitorConnection) => Promise<T>, fallback: T) {
      return available ? operation(connection) : fallback
    },
    async flush() {
      flushes += 1
    },
    async close() {
      await engine.close()
    },
  }
  return {
    facade,
    engine,
    calls,
    get flushes() {
      return flushes
    },
    setAvailable(value: boolean) {
      available = value
    },
  }
}

describe('rows from the Capacitor plugin', () => {
  it('maps object rows to arrays in column order, honouring iOS column lists', () => {
    expect(rowsToArrays(undefined)).toEqual([])
    expect(rowsToArrays([{ a: 1, b: 'x' }])).toEqual([[1, 'x']])
    expect(rowsToArrays([{ ios_columns: ['b', 'a'] }, { a: 1, b: 'x' }])).toEqual([['x', 1]])
    expect(rowsToArrays([{ ios_columns: ['a'] }])).toEqual([])
    expect(rowsToArrays([[1, 2]])).toEqual([[1, 2]])
  })
})

describe('the Capacitor driver over persistence-save', () => {
  it('runs Drizzle through the facade, never letting the plugin wrap statements in transactions', async () => {
    const host = fakePersistenceSave()
    const database = await openDatabase({
      driver: createCapacitorDriver(host.facade as ConnectionHost),
      schema,
      migrations: MIGRATIONS,
    })
    await database.transaction(async (tx) => {
      await tx.insert(players).values({ id: 1, name: 'a', coins: 2 })
    })
    expect(await database.db.select().from(players)).toEqual([{ id: 1, name: 'a', coins: 2 }])
    expect(host.calls.filter((c) => c.op === 'run').every((c) => c.transaction === false)).toBe(
      true,
    )
    expect(host.flushes).toBeGreaterThan(0)
    await database.close()
  })

  it('reports an engine that cannot open as unavailable', async () => {
    const host = fakePersistenceSave()
    host.setAvailable(false)
    await expect(
      openDatabase({
        driver: createCapacitorDriver(host.facade as ConnectionHost),
        schema,
        migrations: MIGRATIONS,
      }),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError)
  })

  it('serialises a guarded snapshot save with a Drizzle transaction on the shared connection', async () => {
    const host = fakePersistenceSave()
    const database = await openDatabase({
      driver: createCapacitorDriver(host.facade as ConnectionHost),
      schema,
      migrations: MIGRATIONS,
    })
    const snapshots = guardSnapshots(host.facade, database)
    expect('close' in snapshots).toBe(false)
    await database.db.insert(players).values({ id: 1, name: 'p' })

    // A transaction that writes, waits and then fails, with an autosave issued while it is open.
    const failing = database.transaction(async (tx) => {
      await tx.insert(items).values({ playerId: 1, kind: 'doomed' })
      await new Promise((resolve) => setTimeout(resolve, 15))
      throw new Error('abandon the climb')
    })
    await tick()
    const autosave = snapshots.save('active-run', { level: 3 })
    await expect(failing).rejects.toThrow('abandon the climb')
    await autosave

    // The rollback took the transaction's row and nothing else: the snapshot, saved after it, survives.
    expect(await database.db.select().from(items)).toEqual([])
    const saved = (await snapshots.list()) as { name: string; snapshot: string }[]
    expect(saved.map((row) => [row.name, row.snapshot])).toEqual([['active-run', '{"level":3}']])
    await database.close()
  })
})
