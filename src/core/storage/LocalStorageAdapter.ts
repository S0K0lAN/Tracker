import type { AppState } from '../../domain/models'
import { normalizeAppState } from '../../domain/migrations'
import type { StorageAdapter } from './StorageAdapter'

const STORAGE_KEY = 'focus-flow.state.v1'
const BACKUP_KEY = 'focus-flow.state.v1.backup'

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<AppState | null> {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    try {
      return normalizeAppState(JSON.parse(raw))
    } catch {
      const backup = localStorage.getItem(BACKUP_KEY)
      if (backup) {
        try {
          const recovered = normalizeAppState(JSON.parse(backup))
          localStorage.setItem(STORAGE_KEY, JSON.stringify(recovered))
          return recovered
        } catch {
          localStorage.removeItem(BACKUP_KEY)
        }
      }
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
  }

  async save(state: AppState): Promise<void> {
    const previous = localStorage.getItem(STORAGE_KEY)
    if (previous) localStorage.setItem(BACKUP_KEY, previous)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  async clear(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(BACKUP_KEY)
  }
}
