import {
  assertCurrentAppState,
  assertSnapshotStateShape,
  CURRENT_SCHEMA_VERSION,
  normalizeAppState,
  parseStoredAppState,
} from '../../domain/migrations'
import type { AppSettings, AppState } from '../../domain/models'
import { SyncProviderError } from './SyncAdapter'

export const REMOTE_SNAPSHOT_FORMAT = 'focus-flow' as const
export const REMOTE_SNAPSHOT_FORMAT_VERSION = 1 as const

type LocalOnlySetting = 'autoSync' | 'syncProvider' | 'syncProviderConfigs'

export type RemoteSnapshotData = Omit<AppState, 'schemaVersion' | 'settings' | 'sync'> & {
  settings: Omit<AppSettings, LocalOnlySetting>
}

export interface RemoteSnapshotEnvelope {
  format: typeof REMOTE_SNAPSHOT_FORMAT
  formatVersion: typeof REMOTE_SNAPSHOT_FORMAT_VERSION
  schemaVersion: number
  generatedAt: string
  data: RemoteSnapshotData
}

export interface SnapshotSummary {
  tasks: number
  projects: number
  habits: number
  savedFilters: number
  recentTaskTitles: string[]
}

export function createRemoteEnvelope(state: AppState, generatedAt = new Date().toISOString()): RemoteSnapshotEnvelope {
  try {
    assertCurrentAppState(state)
    if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Generated date is invalid')
  } catch (error) {
    throw invalidRemote('Локальные данные повреждены и не могут быть отправлены', error)
  }
  return {
    format: REMOTE_SNAPSHOT_FORMAT,
    formatVersion: REMOTE_SNAPSHOT_FORMAT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt,
    data: getSyncableData(state),
  }
}

export function decodeRemoteSnapshot(payload: unknown): AppState {
  try {
    if (!isRecord(payload)) {
      throw invalidRemote('Удалённый snapshot должен быть JSON-объектом')
    }

    if ('format' in payload || 'formatVersion' in payload || 'data' in payload) {
      return decodeEnvelope(payload)
    }

    return decodeLegacyState(payload)
  } catch (error) {
    if (error instanceof SyncProviderError) throw error
    throw invalidRemote('Не удалось прочитать удалённый snapshot', error)
  }
}

export function mergeRemoteState(local: AppState, remote: AppState): AppState {
  const settings: AppSettings = {
    ...remote.settings,
    autoSync: local.settings.autoSync,
    syncProvider: local.settings.syncProvider,
    syncProviderConfigs: structuredClone(local.settings.syncProviderConfigs),
  }

  return {
    ...remote,
    settings,
    sync: local.sync,
  }
}

export function syncableHash(state: AppState): string {
  try {
    assertCurrentAppState(state)
  } catch (error) {
    throw invalidRemote('Локальные данные повреждены и не могут быть хешированы', error)
  }
  const canonical = canonicalJson({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    data: getSyncableData(state),
  })
  const bytes = new TextEncoder().encode(canonical)
  let hash = 0xcbf29ce484222325n

  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }

  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function summarizeSnapshot(state: AppState): SnapshotSummary {
  return {
    tasks: state.tasks.length,
    projects: state.projects.length,
    habits: state.habits.length,
    savedFilters: state.savedFilters.length,
    recentTaskTitles: [...state.tasks]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 3)
      .map((task) => task.title),
  }
}

function getSyncableData(state: AppState): RemoteSnapshotData {
  const {
    schemaVersion: _schemaVersion,
    sync: _sync,
    settings,
    ...data
  } = state
  const {
    autoSync: _autoSync,
    syncProvider: _syncProvider,
    syncProviderConfigs: _syncProviderConfigs,
    ...syncableSettings
  } = settings

  return {
    ...data,
    settings: syncableSettings,
  }
}

function decodeEnvelope(envelope: Record<string, unknown>): AppState {
  if (envelope.format !== REMOTE_SNAPSHOT_FORMAT) {
    throw invalidRemote('Неизвестный формат удалённого snapshot')
  }
  if (envelope.formatVersion !== REMOTE_SNAPSHOT_FORMAT_VERSION) {
    throw invalidRemote('Версия формата удалённого snapshot не поддерживается')
  }

  const schemaVersion = readSchemaVersion(envelope.schemaVersion)
  if (typeof envelope.generatedAt !== 'string' || Number.isNaN(Date.parse(envelope.generatedAt))) {
    throw invalidRemote('Удалённый snapshot содержит некорректную дату создания')
  }
  if (!isRecord(envelope.data)) {
    throw invalidRemote('Удалённый snapshot не содержит данных приложения')
  }
  if ('schemaVersion' in envelope.data || 'sync' in envelope.data) {
    throw invalidRemote('Удалённый snapshot содержит недопустимые служебные поля')
  }
  if (isRecord(envelope.data.settings) && hasLocalOnlySettings(envelope.data.settings)) {
    throw invalidRemote('Удалённый snapshot содержит локальные настройки синхронизации')
  }

  assertSnapshotStateShape(envelope.data, schemaVersion)
  return normalizeSafely({ ...envelope.data, schemaVersion })
}

function decodeLegacyState(payload: Record<string, unknown>): AppState {
  readSchemaVersion(payload.schemaVersion)
  try {
    return parseStoredAppState(payload)
  } catch (error) {
    throw invalidRemote('Legacy snapshot содержит повреждённые данные', error)
  }
}

function normalizeSafely(value: unknown): AppState {
  try {
    return normalizeAppState(value)
  } catch (error) {
    throw invalidRemote('Удалённый snapshot содержит повреждённые данные', error)
  }
}

function readSchemaVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidRemote('Удалённый snapshot содержит некорректную версию схемы')
  }
  if ((value as number) > CURRENT_SCHEMA_VERSION) {
    throw invalidRemote('Схема удалённого snapshot новее поддерживаемой')
  }
  return value as number
}

function hasLocalOnlySettings(settings: Record<string, unknown>): boolean {
  return 'autoSync' in settings
    || 'syncProvider' in settings
    || 'syncProviderConfigs' in settings
    || 'googleDriveClientId' in settings
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidRemote(message: string, cause?: unknown): SyncProviderError {
  return new SyncProviderError('invalid-remote', message, cause)
}
