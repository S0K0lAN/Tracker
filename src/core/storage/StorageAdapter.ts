import type { AppState } from '../../domain/models'

export interface StorageAdapter {
  load(): Promise<AppState | null>
  save(state: AppState): Promise<void>
  clear(): Promise<void>
}
