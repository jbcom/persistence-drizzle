---
title: Transactions and the lock
description: How the single lock, transaction, exclusive and the tx handle fit together.
---

One SQLite connection runs one statement stream. persistence-drizzle puts one first-in, first-out lock in front of it.

## Per-statement

Every statement on `database.db` takes the lock for its own duration. A write is flushed before its promise resolves.

## Transactions

```ts
const total = await database.transaction(async (tx) => {
  await tx.insert(items).values({ playerId: 1, kind: 'key' })
  const [row] = await tx.select({ n: count() }).from(items)
  return row?.n ?? 0
})
```

`transaction(fn)` takes the lock, runs `BEGIN IMMEDIATE`, calls `fn(tx)`, then `COMMIT`. If `fn` throws, it runs
`ROLLBACK` and rethrows. The lock is released after the commit is flushed. Rules:

- Use `tx`, never `database.db`, inside `fn`: `db` would wait on the lock `fn` holds.
- `tx.transaction(...)` inside is a savepoint.
- A `tx` kept past its transaction rejects instead of writing outside the lock.
- `database.db.transaction(...)` is refused with `TransactionMisuseError`. Over a proxy it would issue `begin` as an
  ordinary statement and let other writers run between the statements that follow.

## Writers outside Drizzle

Anything else that writes to the same connection must take the same lock, or it can land inside a transaction:

```ts
await database.exclusive(async () => {
  await legacyWriter.save('slot-1', state)
})
```

For a snapshot facade that exposes `save`, `load`, `list`, `delete`, `withConnection` and `flush`, wrap it once with
`guardSnapshots(facade, database)` from `persistence-drizzle/capacitor` and use only the wrapped one.
