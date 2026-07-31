import type { AppState } from '../../domain/models'

export interface SyncResult {
  state: AppState
  remoteId?: string
  message: string
}

export interface SyncAdapter {
  readonly id: string
  readonly name: string
  testConnection(): Promise<boolean>
  sync(localState: AppState): Promise<SyncResult>
}
