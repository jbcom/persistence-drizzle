---
title: Getting started
description: Install persistence-drizzle, open a database with migrations, write in a transaction and read it back.
---

## Install

```sh
npm install persistence-drizzle drizzle-orm
```

Node.js 22, 24 and 26 are supported. `drizzle-orm` (`>=0.45.2 <1`) is the only peer dependency.

## Open a database

```ts
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
    { tag: '0000_players', sql: 'CREATE TABLE players (id integer PRIMARY KEY NOT NULL, name text NOT NULL);' },
  ],
})
```

`createNodeSqliteDriver()` is an in-memory database; pass a file path to keep it. On a device, use
[`createCapacitorDriver`](../capacitor/).

## Write and read

```ts
await database.transaction(async (tx) => {
  await tx.insert(players).values({ id: 1, name: 'Player One' })
})

const rows = await database.db.select().from(players)
await database.close()
```

Inside `transaction`, use the `tx` it gives you. `database.db` takes the lock for each statement, and the lock is
already held by the transaction.

## Use drizzle-kit migrations

Generate migrations with `drizzle-kit generate`, then hand them to `openDatabase`:

```ts
import { readMigrationsFolder } from 'persistence-drizzle/node'

const migrations = readMigrationsFolder('./drizzle') // Node: from disk
```

In a bundled app, import the journal and the `.sql` files and call `migrationsFromJournal`; see
[migrations](../migrations/).
