import type { AppState } from '../../domain/models'

export interface StorageAdapter {
  load(): Promise<AppState | null>
  loadImportBackup(): Promise<AppState | null>
  save(state: AppState): Promise<void>
  replaceWithBackup(state: AppState): Promise<void>
  restoreImportBackup(): Promise<AppState | null>
  clear(): Promise<void>
}
