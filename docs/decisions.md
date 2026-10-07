---
title: Decisions
description: Why persistence-drizzle is shaped the way it is.
---

## One lock, owned by the database

A SQLite connection runs one statement stream, and an app on a device often has more than one writer. The lock lives
in `openDatabase` rather than in each driver so that every driver gets the same guarantee and a foreign writer can join
it through `exclusive`.

## `db.transaction` is refused, not emulated

Over `sqlite-proxy`, Drizzle's transaction issues `begin` as an ordinary statement and releases the lock between the
statements that follow. Making that safe would mean intercepting Drizzle's internals; refusing it with a clear error and
offering `transaction(fn)` keeps the guarantee visible in the types and in the failure.

## `BEGIN IMMEDIATE`

A write transaction takes the write lock when it starts, so a transaction cannot fail halfway with `SQLITE_BUSY`
because another connection to the same file wrote first.

## Structural Capacitor types

`persistence-drizzle/capacitor` declares the shape of the connection host and the Capacitor connection it uses instead of
importing them. The package then carries no Capacitor version, and any host with `withConnection`, `flush` and `close`
fits, including a connection manager from a different package or a test double.

## Refusing before writing

Opening a database written by a newer build, or one whose applied migration was edited, is refused rather than repaired.
Both would otherwise corrupt a user's data quietly; a refusal is recoverable by updating the app.

## Neutral wire names

The migrations table is `__persistence_drizzle_migrations` and the envelope format is `persistence-drizzle.save`. Both
are persisted, so renaming them is a breaking change.

## Dependencies

The only peer dependency is `drizzle-orm`. `node:sqlite` is used through the built-in module, so the Node driver needs no
native addon.
