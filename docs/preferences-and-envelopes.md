---
title: Preferences and envelopes
description: Typed settings over a key-value store, and a hardened text format for exporting and importing saves.
---

## Typed preferences

Small, device-level settings that are read at boot belong in a key-value store, not in SQLite. A preference is one key
holding JSON, validated by your `parse` function (a zod `safeParse` result, for instance):

```ts
import { createMemoryKv, createTypedPreference } from 'persistence-drizzle'

const volume = createTypedPreference({
  kv: createMemoryKv(), // any { get, set, remove } over strings
  key: 'settings.volume',
  parse: (raw) =>
    typeof raw === 'number' && raw >= 0 && raw <= 1 ? raw : null,
  defaults: 0.8,
})

await volume.save(0.5) // { ok: true }
await volume.save(7) // { ok: false, error: 'settings.volume: the value does not validate' }
await volume.load() // 0.5, or 0.8 for anything missing, unparseable or invalid
```

`load` never throws. `save` validates the JSON round trip of the value, so the store only holds what a read accepts.

## Envelopes

An envelope moves a save between devices as text. What travels is your domain value, not table rows: rows change with
every migration, while the domain value carries its own version.

```ts
import { createEnvelope, parseEnvelope } from 'persistence-drizzle'

const target = { app: 'com.example.game', kind: 'profile', currentVersion: 3 }
const text = createEnvelope(target, 3, { name: 'Player One', coins: 12 }, Date.now())

const result = parseEnvelope(text, target)
if (result.ok) {
  // result.data is sanitised, not validated: run it through your own schema and migrations,
  // then write it in one transaction so a failed import changes nothing.
} else {
  // result.reason: too-large, not-json, too-deep, not-envelope, wrong-app,
  // wrong-kind, invalid-version or future-version
}
```

Reading is bounded (2,000,000 characters by default), strips `__proto__`, `constructor` and `prototype` at every depth,
limits nesting to 32 levels, refuses another app's or kind's envelope, and refuses a version newer than
`currentVersion`. It never throws. `parseUntrustedJson` and `stripForbiddenKeys` give the same hygiene for any stored or
imported JSON.
