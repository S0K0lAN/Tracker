export type SyncConnectionMode = 'implicit' | 'interactive'
export type SyncConsistency = 'atomic' | 'best-effort'

export type SyncProviderConfig = Readonly<Record<string, string>>

export interface SyncProviderConfigField {
  key: string
  label: string
  persistence: 'public' | 'secret'
  description?: string
  placeholder?: string
  required?: boolean
  defaultValue?: string
}

export interface SyncProviderDescriptor {
  id: string
  name: string
  description: string
  connection: SyncConnectionMode
  consistency: SyncConsistency
  privacyNote?: string
  configFields?: readonly SyncProviderConfigField[]
  capabilities: {
    download: boolean
    upload: boolean
  }
}

export interface RemoteHead {
  id: string
  revision: string
  modifiedAt?: string
  size?: number
}

export interface RemoteSnapshot {
  head: RemoteHead
  payload: unknown
}

export interface UploadOptions {
  expectedRevision?: string
}

export interface SyncAdapter {
  readonly descriptor: SyncProviderDescriptor
  head(): Promise<RemoteHead | null>
  download(head?: RemoteHead): Promise<RemoteSnapshot | null>
  upload(payload: unknown, options?: UploadOptions): Promise<RemoteHead>
}

export interface SyncProviderRuntime {
  acquireAdapter(options: { interactive: boolean; resume: boolean }): Promise<SyncAdapter>
  disconnect(): Promise<void>
}

export type SyncProviderErrorCode =
  | 'auth-required'
  | 'conflict'
  | 'forbidden'
  | 'invalid-remote'
  | 'offline'
  | 'rate-limited'
  | 'unavailable'

export class SyncProviderError extends Error {
  constructor(
    readonly code: SyncProviderErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SyncProviderError'
  }
}

export interface SyncProviderDefinition {
  descriptor: SyncProviderDescriptor
  createRuntime(config: SyncProviderConfig): SyncProviderRuntime
}
