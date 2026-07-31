import type { AppState } from '../../domain/models'
import type { SyncAdapter, SyncResult } from './SyncAdapter'

export class DemoSyncAdapter implements SyncAdapter {
  readonly id = 'demo'
  readonly name = 'Демо-хранилище'

  async testConnection(): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 350))
    return true
  }

  async sync(localState: AppState): Promise<SyncResult> {
    await new Promise((resolve) => setTimeout(resolve, 650))
    return {
      state: localState,
      remoteId: 'demo-focus-flow-data',
      message: 'Демо-синхронизация завершена',
    }
  }
}
