import { SyncProviderError, type RemoteHead, type RemoteSnapshot, type SyncAdapter, type SyncProviderDescriptor, type UploadOptions } from './SyncAdapter'

export const demoSyncDescriptor: SyncProviderDescriptor = {
  id: 'demo',
  name: 'Демо-хранилище',
  description: 'Локальная имитация облака без аккаунта',
  connection: 'implicit',
  consistency: 'atomic',
  privacyNote: 'Работает только в памяти вкладки и предназначено для проверки интерфейса.',
  capabilities: { download: true, upload: true },
}

export class DemoSyncAdapter implements SyncAdapter {
  readonly descriptor = demoSyncDescriptor
  private payload?: unknown
  private revision = 0

  async head(): Promise<RemoteHead | null> {
    return this.payload === undefined ? null : this.createHead()
  }

  async download(): Promise<RemoteSnapshot | null> {
    if (this.payload === undefined) return null
    return { head: this.createHead(), payload: structuredClone(this.payload) }
  }

  async upload(payload: unknown, options: UploadOptions = {}): Promise<RemoteHead> {
    await new Promise((resolve) => setTimeout(resolve, 120))
    const remoteExists = this.payload !== undefined
    const expectsRemoteToBeAbsent = options.expectedRevision === null
    const expectsExactRevision = typeof options.expectedRevision === 'string'
    if (
      (expectsRemoteToBeAbsent && remoteExists)
      || (expectsExactRevision && (!remoteExists || options.expectedRevision !== String(this.revision)))
    ) {
      throw new SyncProviderError('conflict', 'Демо-копия изменилась')
    }
    this.payload = structuredClone(payload)
    this.revision += 1
    return this.createHead()
  }

  private createHead(): RemoteHead {
    return {
      id: 'demo-focus-flow-data',
      revision: String(this.revision),
      modifiedAt: new Date().toISOString(),
    }
  }
}
