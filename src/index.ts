/**
 * @arcade-cabinet/persistence-drizzle: a typed Drizzle layer for arcade-cabinet saves, composed over the one SQLite
 * connection @arcade-cabinet/persistence-save opens. The root export is engine-free; drivers live in `./capacitor`
 * (device and web, over persistence-save) and `./node` (`node:sqlite`).
 */
export {
  type Db,
  type OpenDatabaseOptions,
  openDatabase,
  type PersistenceDatabase,
  type Schema,
  TransactionMisuseError,
} from './database.js'
export { PersistenceUnavailableError, type SqlDriver, type SqlParam } from './driver.js'
export {
  createEnvelope,
  DEFAULT_MAX_CHARS,
  ENVELOPE_FORMAT,
  type EnvelopeFailure,
  type EnvelopeResult,
  type EnvelopeTarget,
  type JsonFailure,
  type JsonResult,
  parseEnvelope,
  parseUntrustedJson,
  type SaveEnvelope,
  stripForbiddenKeys,
} from './envelope.js'
export { createLock, type Lock } from './lock.js'
export {
  applyMigrations,
  type DrizzleJournal,
  MIGRATIONS_TABLE,
  type Migration,
  MigrationError,
  type MigrationFailure,
  type MigrationReport,
  migrationHash,
  migrationsFromJournal,
  splitStatements,
} from './migrations.js'
export {
  createMemoryKv,
  createTypedPreference,
  type StringKv,
  type TypedPreference,
  type TypedPreferenceOptions,
  type WriteResult,
} from './preferences.js'
