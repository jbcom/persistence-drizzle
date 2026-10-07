---
title: persistence-drizzle
description: A typed Drizzle ORM database over any SQLite driver, with one lock, safe transactions and checked migrations.
---

persistence-drizzle is a [Drizzle ORM](https://orm.drizzle.team) database over any SQLite driver, for an app that owns
one SQLite connection and has more than one writer: a Capacitor app on a phone, a browser app on `sql.js`, a Node test
suite.

## Why use it?

| Problem | What persistence-drizzle does |
| --- | --- |
| Two writers interleave statements on one connection | One first-in, first-out lock in front of every statement |
| Drizzle's `db.transaction` over a proxy lets other writers run inside it | It is refused; `transaction(fn)` holds the lock from `BEGIN IMMEDIATE` to `COMMIT` |
| A transaction handle kept after commit writes outside the lock | The handle rejects once its transaction has ended |
| A newer build wrote the database, or a shipped migration was edited | Opening refuses (`unknown-applied`, `drift`) instead of corrupting data |
| A resolved write is lost on reload where storage is an export | Writes are flushed before they resolve |
| Importing a pasted save can pollute prototypes or exhaust memory | A bounded, sanitised envelope reader that never throws |
| Unit tests need a different database path than the app | The same Drizzle path runs on `node:sqlite` |

Start with [Getting started](./getting-started/), then read the guides on [migrations](./migrations/),
[transactions](./transactions/) and [the Capacitor driver](./capacitor/). The [API reference](./API/) has the
signatures and the [architecture notes](./ARCHITECTURE/) the invariants behind them.
