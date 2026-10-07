---
title: Migrations
description: How drizzle-kit migrations are applied at open, and when opening refuses.
---

A migration is `{ tag, sql }`: drizzle-kit's file name without `.sql` (`0000_add_coins`) and the file's SQL. The list
is applied in order when the database opens, before `openDatabase` resolves.

## Supplying the list

- Node, from the folder drizzle-kit writes: `readMigrationsFolder('./drizzle')` from `persistence-drizzle/node`.
- Bundled, from the journal and the raw SQL files:

  ```ts
  import { migrationsFromJournal } from 'persistence-drizzle'
  import journal from './drizzle/meta/_journal.json'

  const migrations = migrationsFromJournal(
    journal,
    import.meta.glob('./drizzle/*.sql', { query: '?raw', import: 'default', eager: true }),
  )
  ```

  A journal entry without its file, or a file the journal does not list, throws
  `MigrationError` with `reason: 'invalid-list'`.

Tags must match `^[A-Za-z0-9_-]{1,128}$`, be unique, and contain at least one statement. Statements are split on
drizzle-kit's `--> statement-breakpoint` marker.

## What opening does

1. Creates the bookkeeping table `__persistence_drizzle_migrations` if it is missing.
2. Reads the applied rows. Each must match, by position and tag, the migration list you supplied, and its stored hash
   must equal the hash of the shipped SQL.
3. Applies the rest, each in its own `BEGIN IMMEDIATE` transaction together with its bookkeeping row.

`database.migrations` reports `applied` (every tag the database holds) and `ran` (the tags this open applied).

## When opening refuses

| `MigrationError.reason` | Meaning | What to do |
| --- | --- | --- |
| `unknown-applied` | The database holds a migration this build does not know: a newer build wrote it. | Update the app, or ask the user to. Nothing was written. |
| `drift` | A migration that was already applied has different SQL now. | Restore the file and ship a new migration. Never edit a shipped one. |
| `failed` | A migration threw. It was rolled back whole. | Fix the SQL; the database is at the previous version. |
| `invalid-list` | The list or the journal is malformed. | Fix the list. |
