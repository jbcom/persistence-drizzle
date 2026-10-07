#!/usr/bin/env node
// Dual-format build without a bundler (the r3f-mount pattern): tsc emits ESM plus declarations and
// CommonJS from two tsconfigs. CommonJS files are renamed to .cjs, and their relative require()
// specifiers rewritten to match, so Node resolves them as CommonJS under "type": "module".
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tscBin = path.join(pkgRoot, 'node_modules', '.bin', 'tsc')

function run(args) {
  execFileSync(tscBin, args, { cwd: pkgRoot, stdio: 'inherit' })
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, visit)
    else visit(full)
  }
}

rmSync(path.join(pkgRoot, 'dist'), { recursive: true, force: true })
run(['-p', 'tsconfig.esm.json'])
run(['-p', 'tsconfig.cjs.json'])

const cjsDir = path.join(pkgRoot, 'dist', 'cjs')
walk(cjsDir, (file) => {
  if (file.endsWith('.js')) renameSync(file, file.replace(/\.js$/, '.cjs'))
})
walk(cjsDir, (file) => {
  if (!file.endsWith('.cjs')) return
  const source = readFileSync(file, 'utf8')
  const fixed = source.replace(/require\((["'])(\.[^"']+)\.js\1\)/g, 'require($1$2.cjs$1)')
  if (fixed !== source) writeFileSync(file, fixed)
})

console.info(
  '@arcade-cabinet/persistence-drizzle: built dist/esm (ESM + types) and dist/cjs (CommonJS)',
)
