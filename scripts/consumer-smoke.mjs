#!/usr/bin/env node
// Built-tarball consumer smoke: pack the package, install the tarball and its drizzle-orm peer into
// a clean scratch consumer against npmjs only (no scoped registry, no token), then load every entry
// point through both ESM import and CommonJS require and run a real migrate, write and read on
// node:sqlite. Proves the exports map, the .cjs rewrite, the files list and the peer range.
// With PERSISTENCE_DRIZZLE_CONSUMER_SOURCE=persistence-drizzle@<version> it installs that published
// version from npmjs instead: the cold-install proof after a release.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const scratch = mkdtempSync(path.join(tmpdir(), 'persistence-drizzle-smoke-'))
const registrySource = process.env.PERSISTENCE_DRIZZLE_CONSUMER_SOURCE
const drizzleVersion = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
  .devDependencies['drizzle-orm']

// Anonymous: no inherited npm_config_* (pnpm run exports them into scripts) and no
// credential-looking variables, so no token on the machine can authenticate any npm call here.
const anonymousEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^npm_config_/i.test(key) && !/auth|token|secret|password|credential/i.test(key),
    ),
  ),
  // `npm pack` runs the package's own `prepare` (the git-hook installer); hooks are irrelevant here.
  SKIP_INSTALL_SIMPLE_GIT_HOOKS: '1',
}

try {
  if (
    registrySource &&
    !/^persistence-drizzle@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(registrySource)
  ) {
    throw new Error(
      'PERSISTENCE_DRIZZLE_CONSUMER_SOURCE must be an exact persistence-drizzle@<version> spec',
    )
  }
  let source = registrySource
  if (!source) {
    execFileSync('npm', ['pack', '--pack-destination', scratch], {
      cwd: pkgRoot,
      stdio: 'inherit',
      env: anonymousEnv,
    })
    const tarball = readdirSync(scratch).find((file) => file.endsWith('.tgz'))
    if (!tarball) throw new Error('npm pack produced no tarball')
    source = path.join(scratch, tarball)
  }

  const consumer = path.join(scratch, 'consumer')
  mkdirSync(consumer, { recursive: true })
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'persistence-drizzle-smoke-consumer', private: true, type: 'module' }),
  )
  const userConfig = path.join(scratch, 'anonymous.npmrc')
  const globalConfig = path.join(scratch, 'empty-global.npmrc')
  writeFileSync(userConfig, 'registry=https://registry.npmjs.org/\n')
  writeFileSync(globalConfig, '')
  execFileSync(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--userconfig',
      userConfig,
      '--globalconfig',
      globalConfig,
      source,
      `drizzle-orm@${drizzleVersion}`,
    ],
    { cwd: consumer, stdio: 'inherit', env: anonymousEnv },
  )

  const esm = `
    import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
    import { openDatabase, createEnvelope, parseEnvelope, createTypedPreference, createMemoryKv } from 'persistence-drizzle'
    import { createNodeSqliteDriver } from 'persistence-drizzle/node'
    import { createCapacitorDriver, guardSnapshots, rowsToArrays } from 'persistence-drizzle/capacitor'
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
    const { openDatabase, parseUntrustedJson } = require('persistence-drizzle')
    const { createNodeSqliteDriver } = require('persistence-drizzle/node')
    const { createCapacitorDriver } = require('persistence-drizzle/capacitor')
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
  console.info(
    `persistence-drizzle: consumer smoke passed (ESM + CJS) from ${registrySource ?? 'the packed tarball'}`,
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
