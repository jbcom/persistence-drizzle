#!/usr/bin/env node
// Package contract gate (run after `pnpm build`): the packed file list is exactly what ships, and
// the built ESM and CommonJS entry points export the same runtime surface with the same behavior.
// Registry-only install proof lives in consumer-smoke.mjs; this gate inspects the pack itself.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// pnpm forwards its own npm_config_* settings to child processes; newer npm versions warn about
// pnpm-only keys, so this read-only pack inspection gets a clean npm configuration. npm always runs
// `prepare` for `npm pack`, which would print the git-hook installer's [INFO] line into the --json
// stream, so hook installation is skipped for this dry run.
const npmEnvironment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
  ),
  SKIP_INSTALL_SIMPLE_GIT_HOOKS: '1',
}

const scratch = mkdtempSync(path.join(tmpdir(), 'persistence-drizzle-package-'))

try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--pack-destination', scratch, '--ignore-scripts', '--json'],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: npmEnvironment,
      shell: process.platform === 'win32',
    },
  )
  // Any other lifecycle script writing text around the JSON array must not break parsing: try each
  // line-leading "[" until one parses.
  const jsonEnd = packOutput.lastIndexOf(']')
  assert(jsonEnd !== -1, `npm pack produced no JSON array:\n${packOutput}`)
  let pack
  for (const match of packOutput.matchAll(/^\[/gm)) {
    try {
      ;[pack] = JSON.parse(packOutput.slice(match.index, jsonEnd + 1))
      break
    } catch {
      // Not the real array start (for example an "[INFO] ..." line): try the next "[".
    }
  }
  assert(pack, `npm pack did not return a parseable package manifest:\n${packOutput}`)

  const packedPaths = new Set(pack.files.map((file) => file.path))
  for (const required of [
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'package.json',
    'docs/API.md',
    'docs/ARCHITECTURE.md',
    'examples/basic.mjs',
    'examples/commonjs.cjs',
    'dist/esm/index.js',
    'dist/esm/index.d.ts',
    'dist/esm/capacitor.js',
    'dist/esm/capacitor.d.ts',
    'dist/esm/node.js',
    'dist/esm/node.d.ts',
    'dist/cjs/index.cjs',
    'dist/cjs/index.d.cts',
    'dist/cjs/capacitor.cjs',
    'dist/cjs/capacitor.d.cts',
    'dist/cjs/node.cjs',
    'dist/cjs/node.d.cts',
    'dist/cjs/package.json',
  ]) {
    assert(packedPaths.has(required), `packed artifact is missing ${required}`)
  }
  for (const forbiddenPrefix of ['src/', 'tests/', 'coverage/', 'scripts/', '.github/']) {
    assert(
      [...packedPaths].every((file) => !file.startsWith(forbiddenPrefix)),
      `packed artifact unexpectedly contains ${forbiddenPrefix}`,
    )
  }

  const require = createRequire(import.meta.url)
  const entries = [
    {
      name: 'index',
      functions: [
        'applyMigrations',
        'createEnvelope',
        'createLock',
        'createMemoryKv',
        'createTypedPreference',
        'migrationHash',
        'migrationsFromJournal',
        'openDatabase',
        'parseEnvelope',
        'parseUntrustedJson',
        'splitStatements',
        'stripForbiddenKeys',
      ],
      classes: ['MigrationError', 'PersistenceUnavailableError', 'TransactionMisuseError'],
    },
    {
      name: 'capacitor',
      functions: ['createCapacitorDriver', 'guardSnapshots', 'rowsToArrays'],
      classes: [],
    },
    { name: 'node', functions: ['createNodeSqliteDriver', 'readMigrationsFolder'], classes: [] },
  ]
  for (const entry of entries) {
    const esm = await import(
      pathToFileURL(path.join(packageRoot, `dist/esm/${entry.name}.js`)).href
    )
    const cjs = require(path.join(packageRoot, `dist/cjs/${entry.name}.cjs`))
    for (const name of [...entry.functions, ...entry.classes]) {
      assert.equal(typeof esm[name], 'function', `ESM ${entry.name} export ${name} is missing`)
      assert.equal(typeof cjs[name], 'function', `CommonJS ${entry.name} export ${name} is missing`)
    }
  }

  // Both builds hash a migration identically: the bookkeeping value written to a database.
  const esmCore = await import(pathToFileURL(path.join(packageRoot, 'dist/esm/index.js')).href)
  const cjsCore = require(path.join(packageRoot, 'dist/cjs/index.cjs'))
  const sample =
    'CREATE TABLE a (id integer);\n--> statement-breakpoint\nCREATE TABLE b (id integer);'
  assert.equal(
    esmCore.migrationHash(sample),
    cjsCore.migrationHash(sample),
    'ESM and CommonJS builds hash a migration differently',
  )
  assert.equal(esmCore.ENVELOPE_FORMAT, cjsCore.ENVELOPE_FORMAT, 'ENVELOPE_FORMAT differs')

  console.info(
    `persistence-drizzle: ${pack.entryCount} intentional files packed; ESM and CommonJS APIs agree`,
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
