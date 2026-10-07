import path from 'node:path'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { readMigrationsFolder } from '../../src/node.js'

/** The fixture schema at its latest migration (0001). */
export const players = sqliteTable('players', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  coins: integer('coins').notNull().default(0),
})

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playerId: integer('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
})

export const schema = { players, items }

export const MIGRATIONS = readMigrationsFolder(path.join(import.meta.dirname, 'drizzle'))
