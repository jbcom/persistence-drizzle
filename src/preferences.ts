/**
 * Typed settings over a string key-value store. Settings are small, device-level and read at boot, so they live in
 * Preferences (persistence-save's `createPreferencesKv`: native key-value storage on a device, localStorage on the web),
 * never in the SQLite save.
 *
 * A preference is one key holding JSON. `parse` is the game's validator (a zod `safeParse`, say): it returns the value or
 * `null`. Reading never throws: a missing, unparseable or invalid value gives the defaults. Writing refuses a value
 * `parse` rejects, so the store only ever holds what a read accepts.
 */
import { parseUntrustedJson } from './envelope.js'

/** The part of persistence-save's `PreferencesKv` a preference uses. */
export interface StringKv {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export type WriteResult = { ok: true } | { ok: false; error: string }

export interface TypedPreference<T> {
  readonly key: string
  load(): Promise<T>
  save(value: T): Promise<WriteResult>
  clear(): Promise<void>
}

export interface TypedPreferenceOptions<T> {
  readonly kv: StringKv
  readonly key: string
  readonly parse: (raw: unknown) => T | null
  readonly defaults: T
  /** Largest stored text read back, in characters. Default 64 KiB. */
  readonly maxChars?: number
}

export function createTypedPreference<T>(options: TypedPreferenceOptions<T>): TypedPreference<T> {
  const { kv, key, parse, defaults, maxChars = 65_536 } = options
  return {
    key,
    async load(): Promise<T> {
      let text: string | null
      try {
        text = await kv.get(key)
      } catch {
        return defaults
      }
      if (text === null) return defaults
      const parsed = parseUntrustedJson(text, maxChars)
      if (!parsed.ok) return defaults
      return parse(parsed.value) ?? defaults
    },
    async save(value: T): Promise<WriteResult> {
      try {
        // Validate exactly what will be stored: the JSON round trip, not the live object.
        const checked = parse(JSON.parse(JSON.stringify(value)) as unknown)
        if (checked === null) return { ok: false, error: `${key}: the value does not validate` }
        await kv.set(key, JSON.stringify(checked))
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async clear(): Promise<void> {
      await kv.remove(key)
    },
  }
}

/** An in-memory `StringKv`, for tests, labs and hosts without Preferences. */
export function createMemoryKv(): StringKv & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    async get(key) {
      return entries.get(key) ?? null
    },
    async set(key, value) {
      entries.set(key, value)
    },
    async remove(key) {
      entries.delete(key)
    },
  }
}
