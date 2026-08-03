import type { AppState } from '../../domain/models'
import { parseStoredAppState, UnsupportedSchemaVersionError } from '../../domain/migrations'
import type { StorageAdapter } from './StorageAdapter'

const STORAGE_KEY = 'focus-flow.state.v1'
const BACKUP_KEY = 'focus-flow.state.v1.backup'
const IMPORT_BACKUP_KEY = 'focus-flow.state.v1.import-backup'
const CORRUPT_KEY = 'focus-flow.state.v1.corrupt'
const BACKUP_CORRUPT_KEY = 'focus-flow.state.v1.backup.corrupt'
const IMPORT_CORRUPT_KEY = 'focus-flow.state.v1.import-backup.corrupt'

function quarantine(raw: string, key: string) {
  try {
    localStorage.setItem(key, raw)
  } catch (error) {
    throw new Error('Не удалось сохранить повреждённый snapshot для ручного восстановления', { cause: error })
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<AppState | null> {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    try {
      return parseStoredAppState(JSON.parse(raw))
    } catch (primaryError) {
      if (primaryError instanceof UnsupportedSchemaVersionError) throw primaryError
      quarantine(raw, CORRUPT_KEY)
      const backup = localStorage.getItem(BACKUP_KEY)
      if (backup) {
        try {
          const recovered = parseStoredAppState(JSON.parse(backup))
          localStorage.setItem(STORAGE_KEY, JSON.stringify(recovered))
          return recovered
        } catch (backupError) {
          if (backupError instanceof UnsupportedSchemaVersionError) throw backupError
          quarantine(backup, BACKUP_CORRUPT_KEY)
          localStorage.removeItem(BACKUP_KEY)
        }
      }
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
  }

  async loadImportBackup(): Promise<AppState | null> {
    const raw = localStorage.getItem(IMPORT_BACKUP_KEY)
    if (!raw) return null
    try {
      return parseStoredAppState(JSON.parse(raw))
    } catch (error) {
      if (error instanceof UnsupportedSchemaVersionError) throw error
      quarantine(raw, IMPORT_CORRUPT_KEY)
      localStorage.removeItem(IMPORT_BACKUP_KEY)
      return null
    }
  }

  async save(state: AppState): Promise<void> {
    const previous = localStorage.getItem(STORAGE_KEY)
    if (previous) localStorage.setItem(BACKUP_KEY, previous)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  async replaceWithBackup(state: AppState): Promise<void> {
    const previous = localStorage.getItem(STORAGE_KEY)
    if (previous) {
      localStorage.setItem(BACKUP_KEY, previous)
      localStorage.setItem(IMPORT_BACKUP_KEY, previous)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  async restoreImportBackup(): Promise<AppState | null> {
    const restored = await this.loadImportBackup()
    if (!restored) return null
    const current = localStorage.getItem(STORAGE_KEY)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restored))
      if (current) {
        localStorage.setItem(BACKUP_KEY, current)
        localStorage.setItem(IMPORT_BACKUP_KEY, current)
      }
    } catch (error) {
      if (current) {
        try { localStorage.setItem(STORAGE_KEY, current) } catch { /* Keep the untouched import backup as the final recovery source. */ }
      }
      throw error
    }
    return restored
  }

  async clear(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(BACKUP_KEY)
    localStorage.removeItem(IMPORT_BACKUP_KEY)
    localStorage.removeItem(CORRUPT_KEY)
    localStorage.removeItem(BACKUP_CORRUPT_KEY)
    localStorage.removeItem(IMPORT_CORRUPT_KEY)
  }
}
