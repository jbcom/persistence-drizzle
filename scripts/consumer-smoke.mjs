#!/usr/bin/env node
// Built-tarball consumer smoke (fleet package contract): pack the package, install the tarball and its drizzle-orm peer
// into a clean scratch consumer, then load every entry point through both ESM import and CommonJS require and run a real
// migrate, write and read on node:sqlite. Proves the exports map, the .cjs rewrite, the files list and the peer range.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const scratch = mkdtempSync(path.join(tmpdir(), 'arcade-persistence-drizzle-smoke-'))
const drizzleVersion = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
  .devDependencies['drizzle-orm']

try {
  execFileSync('npm', ['pack', '--pack-destination', scratch], { cwd: pkgRoot, stdio: 'inherit' })
  const tarball = readdirSync(scratch).find((file) => file.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack produced no tarball')

  const consumer = path.join(scratch, 'consumer')
  execFileSync('mkdir', ['-p', consumer])
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'persistence-drizzle-smoke-consumer', private: true, type: 'module' }),
  )
  execFileSync(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--legacy-peer-deps',
      path.join(scratch, tarball),
      `drizzle-orm@${drizzleVersion}`,
    ],
    { cwd: consumer, stdio: 'inherit' },
  )

  const esm = `
    import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
    import { openDatabase, createEnvelope, parseEnvelope, createTypedPreference, createMemoryKv } from '@arcade-cabinet/persistence-drizzle'
    import { createNodeSqliteDriver } from '@arcade-cabinet/persistence-drizzle/node'
    import { createCapacitorDriver, guardSnapshots, rowsToArrays } from '@arcade-cabinet/persistence-drizzle/capacitor'
    const notes = sqliteTable('notes', { id: integer('id').primaryKey(), body: text('body').notNull() })
    const database = await openDatabase({
      driver: createNodeSqliteDriver(),
      schema: { notes },
      migrations: [{ tag: '0000_notes', sql: 'CREATE TABLE notes (id integer PRIMARY KEY, body text NOT NULL);' }],
    })
    await database.transaction(async (tx) => { await tx.insert(notes).values({ id: 1, body: 'ka' }) })
    const rows = await database.db.select().from(notes)
    if (rows.length !== 1 || rows[0].body !== 'ka') throw new Error('ESM round trip: ' + JSON.stringify(rows))
    await database.close()
    const target = { app: 'smoke', kind: 'profile', currentVersion: 1 }
    if (!parseEnvelope(createEnvelope(target, 1, { a: 1 }, 0), target).ok) throw new Error('ESM envelope')
    const pref = createTypedPreference({ kv: createMemoryKv(), key: 'k', parse: (v) => v, defaults: 1 })
    if ((await pref.load()) !== 1) throw new Error('ESM preference')
    if (typeof createCapacitorDriver !== 'function' || typeof guardSnapshots !== 'function') throw new Error('ESM capacitor exports')
    if (rowsToArrays([{ ios_columns: ['b', 'a'] }, { a: 1, b: 2 }])[0][0] !== 2) throw new Error('ESM rowsToArrays')
    console.log('esm ok')
  `
  const cjs = `
    const { openDatabase, parseUntrustedJson } = require('@arcade-cabinet/persistence-drizzle')
    const { createNodeSqliteDriver } = require('@arcade-cabinet/persistence-drizzle/node')
    const { createCapacitorDriver } = require('@arcade-cabinet/persistence-drizzle/capacitor')
    if (typeof openDatabase !== 'function' || typeof createCapacitorDriver !== 'function') throw new Error('CJS exports')
    if (!parseUntrustedJson('{"a":1}').ok) throw new Error('CJS parse')
    const driver = createNodeSqliteDriver()
    driver.query('select 1 as one', []).then((rows) => {
      if (rows[0][0] !== 1) throw new Error('CJS node driver')
      return driver.close()
    }).then(() => console.log('cjs ok'))
  `
  writeFileSync(path.join(consumer, 'esm.mjs'), esm)
  writeFileSync(path.join(consumer, 'cjs.cjs'), cjs)
  execFileSync(process.execPath, ['esm.mjs'], { cwd: consumer, stdio: 'inherit' })
  execFileSync(process.execPath, ['cjs.cjs'], { cwd: consumer, stdio: 'inherit' })
  console.info('@arcade-cabinet/persistence-drizzle: tarball consumer smoke passed (ESM + CJS)')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
