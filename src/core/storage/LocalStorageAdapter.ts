import type { AppState } from '../../domain/models'
import { parseStoredAppState, UnsupportedSchemaVersionError } from '../../domain/migrations'
import type { StorageAdapter } from './StorageAdapter'

const STORAGE_KEY = 'focus-flow.state.v1'
const BACKUP_KEY = 'focus-flow.state.v1.backup'
const IMPORT_BACKUP_KEY = 'focus-flow.state.v1.import-backup'
const CORRUPT_KEY = 'focus-flow.state.v1.corrupt'
const BACKUP_CORRUPT_KEY = 'focus-flow.state.v1.backup.corrupt'
const IMPORT_CORRUPT_KEY = 'focus-flow.state.v1.import-backup.corrupt'

function quarantine(raw: string, key: string): boolean {
  try {
    localStorage.setItem(key, raw)
    return true
  } catch {
    // Quarantine is diagnostic and must never block recovery from a valid backup.
    return false
  }
}

function quarantineFailedError() {
  return new Error('Не удалось сохранить повреждённый snapshot для ручного восстановления')
}

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<AppState | null> {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    try {
      return parseStoredAppState(JSON.parse(raw))
    } catch (primaryError) {
      if (primaryError instanceof UnsupportedSchemaVersionError) throw primaryError
      const primaryQuarantined = quarantine(raw, CORRUPT_KEY)
      const backup = localStorage.getItem(BACKUP_KEY)
      if (backup) {
        let recovered: AppState
        try {
          recovered = parseStoredAppState(JSON.parse(backup))
        } catch (backupError) {
          if (backupError instanceof UnsupportedSchemaVersionError) throw backupError
          const backupQuarantined = quarantine(backup, BACKUP_CORRUPT_KEY)
          if (!primaryQuarantined || !backupQuarantined) throw quarantineFailedError()
          localStorage.removeItem(BACKUP_KEY)
          localStorage.removeItem(STORAGE_KEY)
          return null
        }

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(recovered))
        } catch (writeError) {
          throw new Error('Не удалось восстановить snapshot из резервной копии', { cause: writeError })
        }
        return recovered
      }
      if (!primaryQuarantined) throw quarantineFailedError()
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
      if (!quarantine(raw, IMPORT_CORRUPT_KEY)) throw quarantineFailedError()
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
    if (!previous) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      return
    }
    const previousBackup = localStorage.getItem(BACKUP_KEY)
    const previousImportBackup = localStorage.getItem(IMPORT_BACKUP_KEY)
    try {
      localStorage.setItem(BACKUP_KEY, previous)
      localStorage.setItem(IMPORT_BACKUP_KEY, previous)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      restoreStorageValue(BACKUP_KEY, previousBackup)
      restoreStorageValue(IMPORT_BACKUP_KEY, previousImportBackup)
      throw error
    }
  }

  async restoreImportBackup(): Promise<AppState | null> {
    const restored = await this.loadImportBackup()
    if (!restored) return null
    await this.replaceWithBackup(restored)
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

function restoreStorageValue(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // The primary snapshot is still untouched and remains the authoritative recovery source.
  }
}
