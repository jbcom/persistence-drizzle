import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { openDatabase } from 'persistence-drizzle'
import { createNodeSqliteDriver } from 'persistence-drizzle/node'

const players = sqliteTable('players', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
})

const database = await openDatabase({
  driver: createNodeSqliteDriver(),
  schema: { players },
  migrations: [
    {
      tag: '0000_players',
      sql: 'CREATE TABLE players (id integer PRIMARY KEY NOT NULL, name text NOT NULL);',
    },
  ],
})

await database.transaction(async (tx) => {
  await tx.insert(players).values({ id: 1, name: 'Player One' })
})
console.log(await database.db.select().from(players))
await database.close()
