import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationProvider } from '../auth/AuthorizationProvider'
import type { SyncAdapter } from './SyncAdapter'
import { googleDriveDescriptor } from './GoogleDriveAdapter'
import { createGoogleDriveProviderDefinition } from './providers'

function authorization(accessToken = 'memory-only-token'): AuthorizationProvider {
  return {
    connect: vi.fn().mockResolvedValue({ accessToken, expiresAt: Date.now() + 60_000 }),
    getSession: vi.fn().mockReturnValue(null),
    disconnect: vi.fn().mockResolvedValue(undefined),
  }
}

function adapter(): SyncAdapter {
  return {
    descriptor: googleDriveDescriptor,
    head: vi.fn().mockResolvedValue(null),
    download: vi.fn().mockResolvedValue(null),
    upload: vi.fn().mockResolvedValue({ id: 'remote-id', revision: '1' }),
  }
}

describe('Google Drive provider configuration', () => {
  it('keeps the OAuth client configuration out of the user-facing descriptor', () => {
    const definition = createGoogleDriveProviderDefinition({ defaultClientId: 'build-client-id' })

    expect(definition.descriptor.configFields).toBeUndefined()
    expect(definition.descriptor.connectLabel).toBe('Войти через Google')
    expect(definition.descriptor.resumeLabel).toBe('Продолжить с Google')
  })

  it('uses the build client ID instead of a stale locally saved value', async () => {
    const auth = authorization()
    const createAuthorization = vi.fn(() => auth)
    const createAdapter = vi.fn(() => adapter())
    const definition = createGoogleDriveProviderDefinition({
      defaultClientId: 'build-client.apps.googleusercontent.com',
      createAuthorization,
      createAdapter,
    })

    const runtime = definition.createRuntime({ clientId: 'stale-client.apps.googleusercontent.com' })
    await expect(runtime.acquireAdapter({ interactive: true, resume: false })).resolves.toMatchObject({
      descriptor: { id: 'google-drive' },
    })

    expect(createAuthorization).toHaveBeenCalledWith('build-client.apps.googleusercontent.com')
    expect(auth.connect).toHaveBeenCalledWith({ prompt: 'select_account' })
    expect(createAdapter).toHaveBeenCalledWith('memory-only-token')
  })

  it('ignores a legacy local ID and reports a build error before opening Google', async () => {
    const createAuthorization = vi.fn(() => authorization())
    const definition = createGoogleDriveProviderDefinition({
      defaultClientId: '',
      createAuthorization,
      createAdapter: () => adapter(),
    })

    await expect(
      definition.createRuntime({ clientId: 'legacy-client.apps.googleusercontent.com' })
        .acquireAdapter({ interactive: true, resume: false }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('Вход через Google не настроен'),
    })
    expect(createAuthorization).not.toHaveBeenCalled()
  })
})
