import { GoogleIdentityAuthorization } from '../auth/GoogleIdentityAuthorization'
import type { AuthorizationProvider } from '../auth/AuthorizationProvider'
import { DemoSyncAdapter, demoSyncDescriptor } from './DemoSyncAdapter'
import { GoogleDriveAdapter, googleDriveDescriptor } from './GoogleDriveAdapter'
import {
  SyncProviderError,
  type SyncAdapter,
  type SyncProviderDefinition,
  type SyncProviderRuntime,
} from './SyncAdapter'
import { SyncProviderRegistry } from './SyncProviderRegistry'

class ImplicitSyncRuntime implements SyncProviderRuntime {
  constructor(private readonly adapter: SyncAdapter) {}

  async acquireAdapter(): Promise<SyncAdapter> {
    return this.adapter
  }

  async disconnect(): Promise<void> {}
}

class GoogleDriveSyncRuntime implements SyncProviderRuntime {
  private authorization?: AuthorizationProvider
  private adapter?: { accessToken: string; value: SyncAdapter }

  constructor(
    private readonly clientId: string,
    private readonly createAuthorization: (clientId: string) => AuthorizationProvider,
    private readonly createAdapter: (accessToken: string) => SyncAdapter,
  ) {}

  async acquireAdapter({ interactive, resume }: { interactive: boolean; resume: boolean }): Promise<SyncAdapter> {
    const clientId = this.clientId.trim()
    if (!clientId) {
      throw new SyncProviderError(
        'unavailable',
        'Вход через Google не настроен в этой сборке Focus Flow. Обратитесь к разработчику приложения.',
      )
    }
    this.authorization ??= this.createAuthorization(clientId)
    let session = this.authorization.getSession()
    if (!session) {
      if (!interactive) throw new SyncProviderError('auth-required', 'Продолжите вход в Google для синхронизации')
      session = await this.authorization.connect({ prompt: resume ? '' : 'select_account' })
    }
    if (this.adapter?.accessToken === session.accessToken) return this.adapter.value
    const value = this.createAdapter(session.accessToken)
    this.adapter = { accessToken: session.accessToken, value }
    return value
  }

  async disconnect(): Promise<void> {
    this.adapter = undefined
    await this.authorization?.disconnect()
  }
}

function configuredGoogleClientId() {
  const environment = (import.meta as ImportMeta & { env?: { VITE_GOOGLE_CLIENT_ID?: string } }).env
  return environment?.VITE_GOOGLE_CLIENT_ID?.trim() ?? ''
}

export interface GoogleDriveProviderOptions {
  defaultClientId?: string
  createAuthorization?: (clientId: string) => AuthorizationProvider
  createAdapter?: (accessToken: string) => SyncAdapter
}

export function createGoogleDriveProviderDefinition(
  options: GoogleDriveProviderOptions = {},
): SyncProviderDefinition {
  const defaultClientId = options.defaultClientId ?? configuredGoogleClientId()
  return {
    descriptor: googleDriveDescriptor,
    createRuntime: () => new GoogleDriveSyncRuntime(
      defaultClientId.trim(),
      options.createAuthorization ?? ((clientId) => new GoogleIdentityAuthorization(clientId)),
      options.createAdapter ?? ((accessToken) => new GoogleDriveAdapter(accessToken)),
    ),
  }
}

export const defaultSyncProviderDefinitions: SyncProviderDefinition[] = [
  {
    descriptor: demoSyncDescriptor,
    createRuntime: () => new ImplicitSyncRuntime(new DemoSyncAdapter()),
  },
  createGoogleDriveProviderDefinition(),
]

export function createDefaultSyncProviderRegistry() {
  return new SyncProviderRegistry(defaultSyncProviderDefinitions)
}
