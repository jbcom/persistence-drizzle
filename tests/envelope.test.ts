import { describe, expect, it } from 'vitest'
import {
  createEnvelope,
  parseEnvelope,
  parseUntrustedJson,
  stripForbiddenKeys,
} from '../src/envelope.js'
import { createMemoryKv, createTypedPreference } from '../src/preferences.js'

const target = { app: 'game', kind: 'profile', currentVersion: 2 }

describe('the save envelope', () => {
  it('round-trips data with its version and export time', () => {
    const text = createEnvelope(target, 2, { marks: 3 }, 99)
    expect(parseEnvelope(text, target)).toEqual({
      ok: true,
      version: 2,
      exportedAt: 99,
      data: { marks: 3 },
    })
  })

  it('accepts an older version for the game to migrate, and refuses a newer one', () => {
    expect(parseEnvelope(createEnvelope(target, 1, {}, 0), target)).toMatchObject({
      ok: true,
      version: 1,
    })
    expect(parseEnvelope(createEnvelope(target, 3, {}, 0), target)).toEqual({
      ok: false,
      reason: 'future-version',
    })
    expect(() => createEnvelope(target, 0, {}, 0)).toThrow(RangeError)
  })

  it('refuses other games, other kinds, non-envelopes and bad versions without throwing', () => {
    const other = createEnvelope({ app: 'other', kind: 'profile' }, 1, {}, 0)
    expect(parseEnvelope(other, target)).toEqual({ ok: false, reason: 'wrong-app' })
    const kind = createEnvelope({ app: 'game', kind: 'settings' }, 1, {}, 0)
    expect(parseEnvelope(kind, target)).toEqual({ ok: false, reason: 'wrong-kind' })
    for (const text of ['{}', '[]', 'null', '"x"', '{"format":"arcade-cabinet.save"}']) {
      expect(parseEnvelope(text, target)).toEqual({ ok: false, reason: 'not-envelope' })
    }
    const bad = JSON.stringify({
      format: 'arcade-cabinet.save',
      app: 'game',
      kind: 'profile',
      version: 1.5,
      data: {},
    })
    expect(parseEnvelope(bad, target)).toEqual({ ok: false, reason: 'invalid-version' })
    expect(parseEnvelope('{nope', target)).toEqual({ ok: false, reason: 'not-json' })
    expect(parseEnvelope(' '.repeat(11), { ...target, maxChars: 10 })).toEqual({
      ok: false,
      reason: 'too-large',
    })
  })

  it('strips prototype-polluting keys at every depth and bounds nesting', () => {
    const hostile = '{"a":{"__proto__":{"polluted":1},"b":[{"constructor":{"prototype":{}}}]}}'
    const parsed = parseUntrustedJson(hostile)
    expect(parsed).toEqual({ ok: true, value: { a: { b: [{}] } } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    let deep: unknown = 1
    for (let i = 0; i < 40; i += 1) deep = [deep]
    expect(() => stripForbiddenKeys(deep)).toThrow(RangeError)
    expect(parseUntrustedJson(JSON.stringify(deep))).toEqual({ ok: false, reason: 'too-deep' })
  })
})

describe('typed preferences', () => {
  type Settings = { volume: number; muted: boolean }
  const parse = (raw: unknown): Settings | null => {
    const value = raw as Partial<Settings> | null
    return value &&
      typeof value.volume === 'number' &&
      value.volume >= 0 &&
      value.volume <= 1 &&
      typeof value.muted === 'boolean'
      ? { volume: value.volume, muted: value.muted }
      : null
  }
  const defaults: Settings = { volume: 0.8, muted: false }

  it('gives the defaults until saved, then the saved value', async () => {
    const kv = createMemoryKv()
    const pref = createTypedPreference({ kv, key: 'settings', parse, defaults })
    expect(await pref.load()).toEqual(defaults)
    expect(await pref.save({ volume: 0.2, muted: true })).toEqual({ ok: true })
    expect(await pref.load()).toEqual({ volume: 0.2, muted: true })
    await pref.clear()
    expect(await pref.load()).toEqual(defaults)
  })

  it('refuses to store an invalid value and reads invalid, hostile or oversized text as the defaults', async () => {
    const kv = createMemoryKv()
    const pref = createTypedPreference({ kv, key: 'settings', parse, defaults, maxChars: 100 })
    expect(await pref.save({ volume: 2, muted: false })).toMatchObject({ ok: false })
    expect(kv.entries.size).toBe(0)
    for (const text of ['{bad', '{"volume":5,"muted":true}', 'x'.repeat(101)]) {
      kv.entries.set('settings', text)
      expect(await pref.load()).toEqual(defaults)
    }
    const failing = { ...kv, get: async () => Promise.reject(new Error('blocked')) }
    expect(await createTypedPreference({ kv: failing, key: 'k', parse, defaults }).load()).toEqual(
      defaults,
    )
    const quota = { ...kv, set: async () => Promise.reject(new Error('quota')) }
    expect(
      await createTypedPreference({ kv: quota, key: 'k', parse, defaults }).save(defaults),
    ).toEqual({ ok: false, error: 'quota' })
  })
})
