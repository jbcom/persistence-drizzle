import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readRepositoryFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('published compatibility contract', () => {
  it('declares the first Node version that supports the node:sqlite adapter API', () => {
    const manifest = JSON.parse(readRepositoryFile('package.json')) as {
      engines: { node: string }
    }
    const nodeAdapter = readRepositoryFile('src/node.ts')

    expect(manifest.engines.node).toBe('>=22.16.0')
    expect(nodeAdapter).toContain('statement.setReturnArrays(true)')
  })

  it('keeps the root and Capacitor entry points free of Node engine imports', () => {
    expect(readRepositoryFile('src/index.ts')).not.toMatch(/from ['"]node:/)
    expect(readRepositoryFile('src/capacitor.ts')).not.toMatch(/from ['"]node:/)
  })
})

describe('ruleset ownership guard', () => {
  it('selects only repository-owned rulesets before any mutation endpoint', () => {
    const script = readRepositoryFile('scripts/apply-branch-ruleset.mjs')

    expect(script).toContain('usage: node $' + '{process.argv[1]}')
    expect(script).toContain('rulesets?includes_parents=false')
    expect(script).toContain("ruleset.source_type === 'Repository'")
  })
})
