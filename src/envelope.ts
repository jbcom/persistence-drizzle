/**
 * Export and import of a save as text a player can copy between devices.
 *
 * What travels is the game's domain value (its profile, say), not table rows: rows change shape with every schema
 * migration, while the domain value carries its own version and the game's migration table. The envelope names the
 * format, the game and the kind of save, so a file from another game or another kind is refused before the game's own
 * validation sees it.
 *
 * Reading never throws on hostile text: it is bounded in size, parsed, stripped of `__proto__`, `constructor` and
 * `prototype` keys at every depth, and checked for a version newer than this build. The game then migrates and
 * validates `data` and writes it in one transaction, so an import that fails changes nothing.
 */

export const ENVELOPE_FORMAT = 'arcade-cabinet.save'

export interface SaveEnvelope<T> {
  readonly format: typeof ENVELOPE_FORMAT
  readonly app: string
  readonly kind: string
  readonly version: number
  readonly exportedAt: number
  readonly data: T
}

/** Largest text accepted, in characters. */
export const DEFAULT_MAX_CHARS = 2_000_000

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_DEPTH = 32

/** A deep copy of JSON-shaped data without the keys that can pollute prototypes. Throws past 32 levels of nesting. */
export function stripForbiddenKeys(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new RangeError('save data nested too deeply')
  if (Array.isArray(value)) return value.map((item) => stripForbiddenKeys(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue
      out[key] = stripForbiddenKeys((value as Record<string, unknown>)[key], depth + 1)
    }
    return out
  }
  return value
}

export type JsonFailure = 'too-large' | 'not-json' | 'too-deep'

export type JsonResult = { ok: true; value: unknown } | { ok: false; reason: JsonFailure }

/** Parse untrusted JSON text: bounded, sanitised, never throws. */
export function parseUntrustedJson(text: string, maxChars = DEFAULT_MAX_CHARS): JsonResult {
  if (text.length > maxChars) return { ok: false, reason: 'too-large' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not-json' }
  }
  try {
    return { ok: true, value: stripForbiddenKeys(raw) }
  } catch {
    return { ok: false, reason: 'too-deep' }
  }
}

export interface EnvelopeTarget {
  readonly app: string
  readonly kind: string
}

export function createEnvelope<T>(
  target: EnvelopeTarget,
  version: number,
  data: T,
  exportedAt: number,
): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RangeError(`envelope version must be a positive integer, got ${version}`)
  }
  const envelope: SaveEnvelope<T> = {
    format: ENVELOPE_FORMAT,
    app: target.app,
    kind: target.kind,
    version,
    exportedAt,
    data,
  }
  return JSON.stringify(envelope)
}

export type EnvelopeFailure =
  | JsonFailure
  | 'not-envelope'
  | 'wrong-app'
  | 'wrong-kind'
  | 'invalid-version'
  | 'future-version'

export type EnvelopeResult =
  | { ok: true; version: number; exportedAt: number; data: unknown }
  | { ok: false; reason: EnvelopeFailure }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Read an envelope written by `createEnvelope`. `data` is sanitised but not validated: that is the game's schema's job. */
export function parseEnvelope(
  text: string,
  target: EnvelopeTarget & { readonly currentVersion: number; readonly maxChars?: number },
): EnvelopeResult {
  const parsed = parseUntrustedJson(text, target.maxChars)
  if (!parsed.ok) return parsed
  const value = parsed.value
  if (!isRecord(value) || value.format !== ENVELOPE_FORMAT || !('data' in value)) {
    return { ok: false, reason: 'not-envelope' }
  }
  if (value.app !== target.app) return { ok: false, reason: 'wrong-app' }
  if (value.kind !== target.kind) return { ok: false, reason: 'wrong-kind' }
  const { version } = value
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return { ok: false, reason: 'invalid-version' }
  }
  if (version > target.currentVersion) return { ok: false, reason: 'future-version' }
  const exportedAt =
    typeof value.exportedAt === 'number' && Number.isFinite(value.exportedAt) ? value.exportedAt : 0
  return { ok: true, version, exportedAt, data: value.data }
}
