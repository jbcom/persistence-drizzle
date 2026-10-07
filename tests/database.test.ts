import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { openDatabase, TransactionMisuseError } from '../src/database.js'
import type { SqlDriver } from '../src/driver.js'
import { createNodeSqliteDriver } from '../src/node.js'
import { items, MIGRATIONS, players, schema } from './fixtures/schema.js'

/** A node:sqlite driver that counts flushes and lets a test slow every statement down. */
function instrumented() {
  const inner = createNodeSqliteDriver()
  const log: string[] = []
  const driver: SqlDriver & { flushes: number; log: string[] } = {
    name: 'instrumented',
    flushes: 0,
    log,
    async run(text, params) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      log.push(text.trim().split(/\s+/)[0]?.toUpperCase() ?? '')
      return inner.run(text, params)
    },
    async query(text, params) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return inner.query(text, params)
    },
    async flush() {
      driver.flushes += 1
    },
    close: () => inner.close(),
  }
  return { driver, inner }
}

const openWith = (driver: SqlDriver) => openDatabase({ driver, schema, migrations: MIGRATIONS })

/** Drizzle wraps what the proxy throws in its query error; the cause is the database's own. */
async function causeOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return (error as { cause?: unknown }).cause ?? error
  }
  throw new Error('expected a rejection')
}

describe('the typed database', () => {
  it('maps rows, nulls, defaults and joins through the proxy', async () => {
    const database = await openWith(createNodeSqliteDriver())
    const { db } = database
    await db.insert(players).values([
      { id: 1, name: 'a' },
      { id: 2, name: 'b', coins: 5 },
    ])
    await db.insert(items).values({ playerId: 2, kind: 'lamp' })
    expect(await db.select().from(players).where(eq(players.id, 2)).get()).toEqual({
      id: 2,
      name: 'b',
      coins: 5,
    })
    expect(await db.select().from(players).where(eq(players.id, 9)).get()).toBeUndefined()
    const joined = await db
      .select({ name: players.name, kind: items.kind })
      .from(items)
      .innerJoin(players, eq(items.playerId, players.id))
    expect(joined).toEqual([{ name: 'b', kind: 'lamp' }])
    expect(await db.query.players.findMany({ orderBy: (p, { asc }) => [asc(p.id)] })).toHaveLength(
      2,
    )
    await database.close()
  })

  it('flushes after every write and after a commit, not after reads', async () => {
    const { driver } = instrumented()
    const database = await openWith(driver)
    const base = driver.flushes
    await database.db.select().from(players)
    expect(driver.flushes).toBe(base)
    await database.db.insert(players).values({ id: 1, name: 'a' })
    expect(driver.flushes).toBe(base + 1)
    await database.transaction(async (tx) => {
      await tx.insert(players).values({ id: 2, name: 'b' })
      await tx.update(players).set({ coins: 1 })
    })
    expect(driver.flushes).toBe(base + 2)
    await database.close()
  })

  it('commits a transaction whole, or rolls it back whole on a throw', async () => {
    const database = await openWith(createNodeSqliteDriver())
    await database.transaction(async (tx) => {
      await tx.insert(players).values({ id: 1, name: 'kept' })
    })
    await expect(
      database.transaction(async (tx) => {
        await tx.insert(players).values({ id: 2, name: 'lost' })
        throw new Error('the door shut')
      }),
    ).rejects.toThrow('the door shut')
    expect((await database.db.select().from(players)).map((p) => p.name)).toEqual(['kept'])
    await database.close()
  })

  it('supports nested transactions as savepoints', async () => {
    const database = await openWith(createNodeSqliteDriver())
    await database.transaction(async (tx) => {
      await tx.insert(players).values({ id: 1, name: 'outer' })
      await tx
        .transaction(async (inner) => {
          await inner.insert(players).values({ id: 2, name: 'inner' })
          throw new Error('inner fails')
        })
        .catch(() => undefined)
    })
    expect((await database.db.select().from(players)).map((p) => p.name)).toEqual(['outer'])
    await database.close()
  })

  it("serialises concurrent writers: nothing lands inside another's transaction", async () => {
    const { driver } = instrumented()
    const database = await openWith(driver)
    await database.db.insert(players).values({ id: 1, name: 'p' })
    const rolledBack = database.transaction(async (tx) => {
      await tx.insert(items).values({ playerId: 1, kind: 'tx-1' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      await tx.insert(items).values({ playerId: 1, kind: 'tx-2' })
      throw new Error('abandon')
    })
    // Issued while the transaction is open; each must wait for it, not join it.
    const outside = Promise.all([
      database.db.insert(items).values({ playerId: 1, kind: 'plain' }),
      database.exclusive(async () => {
        await driver.run(`INSERT INTO items (player_id, kind) VALUES (1, 'foreign')`, [])
      }),
    ])
    await expect(rolledBack).rejects.toThrow('abandon')
    await outside
    const kinds = (await database.db.select().from(items)).map((i) => i.kind).sort()
    expect(kinds).toEqual(['foreign', 'plain'])
    const begin = driver.log.lastIndexOf('BEGIN')
    expect(driver.log.slice(begin, begin + 4)).toEqual(['BEGIN', 'INSERT', 'INSERT', 'ROLLBACK'])
    await database.close()
  })

  it("refuses Drizzle's own transaction API and a tx used after its transaction", async () => {
    const database = await openWith(createNodeSqliteDriver())
    expect(await causeOf(database.db.transaction(async () => undefined))).toBeInstanceOf(
      TransactionMisuseError,
    )
    expect(await causeOf(database.db.run(sql`begin`))).toBeInstanceOf(TransactionMisuseError)
    let leaked: Parameters<Parameters<typeof database.transaction>[0]>[0] | null = null
    await database.transaction(async (tx) => {
      leaked = tx
    })
    expect(
      String(await causeOf((leaked as unknown as typeof database.db).select().from(players))),
    ).toMatch(/after it ended/)
    await database.close()
  })

  it('rejects work after close', async () => {
    const database = await openWith(createNodeSqliteDriver())
    await database.close()
    expect(String(await causeOf(database.db.select().from(players)))).toMatch(/closed/)
    await database.close()
  })
})
