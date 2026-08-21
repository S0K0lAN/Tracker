import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_DRIVE_APPDATA_SCOPE,
  GOOGLE_IDENTITY_SCRIPT_URL,
  GoogleIdentityAuthorization,
} from './GoogleIdentityAuthorization'

interface FakeTokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}

interface FakeOAuthError {
  type?: string
  message?: string
}

interface FakeTokenConfig {
  client_id: string
  scope: string
  callback: (response: FakeTokenResponse) => void
  error_callback: (error: FakeOAuthError) => void
}

type TestWindow = Window & {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: ReturnType<typeof vi.fn>
        revoke?: ReturnType<typeof vi.fn>
      }
    }
  }
}

const testWindow = window as TestWindow

function installGoogle() {
  let config: FakeTokenConfig | undefined
  const requestAccessToken = vi.fn()
  const initTokenClient = vi.fn((nextConfig: FakeTokenConfig) => {
    config = nextConfig
    return { requestAccessToken }
  })
  const revoke = vi.fn((_token: string, callback?: () => void) => callback?.())

  testWindow.google = { accounts: { oauth2: { initTokenClient, revoke } } }
  return {
    config: () => config,
    initTokenClient,
    requestAccessToken,
    revoke,
  }
}

describe('GoogleIdentityAuthorization', () => {
  beforeEach(() => {
    delete testWindow.google
    document.querySelectorAll(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`).forEach((script) => script.remove())
  })

  it('loads GIS and requests only the appDataFolder scope with an empty prompt by default', async () => {
    const google = installGoogle()
    const loadScript = vi.fn().mockResolvedValue(undefined)
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript,
      now: () => 10_000,
    })

    const connecting = authorization.connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    google.config()?.callback({ access_token: 'access-token', expires_in: 3_600 })

    await expect(connecting).resolves.toEqual({
      accessToken: 'access-token',
      expiresAt: 3_610_000,
    })
    expect(loadScript).toHaveBeenCalledWith(GOOGLE_IDENTITY_SCRIPT_URL)
    expect(google.initTokenClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-id',
      scope: GOOGLE_DRIVE_APPDATA_SCOPE,
    }))
    expect(google.requestAccessToken).toHaveBeenCalledWith({ prompt: '' })
  })

  it.each(['select_account', 'consent'] as const)('supports the %s prompt', async (prompt) => {
    const google = installGoogle()
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript: async () => undefined,
    })

    const connecting = authorization.connect({ prompt })
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalledWith({ prompt }))
    google.config()?.callback({ access_token: 'token', expires_in: 60 })

    await expect(connecting).resolves.toEqual(expect.objectContaining({ accessToken: 'token' }))
  })

  it('keeps a session in memory only while the token is unexpired', async () => {
    const google = installGoogle()
    let now = 1_000
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript: async () => undefined,
      now: () => now,
    })

    const connecting = authorization.connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    google.config()?.callback({ access_token: 'short-lived', expires_in: '2' })
    await connecting

    expect(authorization.getSession()).toEqual({
      accessToken: 'short-lived',
      expiresAt: 3_000,
    })
    now = 3_000
    expect(authorization.getSession()).toBeNull()
  })

  it('revokes a token from an invalid response without retaining the response as an error cause', async () => {
    const google = installGoogle()
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript: async () => undefined,
    })

    const connecting = authorization.connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    google.config()?.callback({ access_token: 'orphaned-token', expires_in: 0 })
    const error = await connecting.catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'AuthorizationError',
      code: 'unavailable',
      cause: undefined,
    })
    expect(google.revoke).toHaveBeenCalledWith('orphaned-token', expect.any(Function))
    expect(authorization.getSession()).toBeNull()
  })

  it('maps a closed OAuth popup to a typed cancellation error', async () => {
    const google = installGoogle()
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript: async () => undefined,
    })

    const connecting = authorization.connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    google.config()?.error_callback({ type: 'popup_closed' })

    await expect(connecting).rejects.toMatchObject({
      name: 'AuthorizationError',
      code: 'cancel',
    })
  })

  it('reports Google access denial separately from a user-cancelled popup', async () => {
    const google = installGoogle()
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript: async () => undefined,
    })

    const connecting = authorization.connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    google.config()?.callback({ error: 'access_denied' })

    await expect(connecting).rejects.toMatchObject({
      name: 'AuthorizationError',
      code: 'access-denied',
    })
  })

  it('reports missing configuration and GIS load failures with typed errors', async () => {
    const loadScript = vi.fn().mockRejectedValue(new Error('network error'))

    await expect(new GoogleIdentityAuthorization('', { loadScript }).connect()).rejects.toMatchObject({
      code: 'config',
    })
    expect(loadScript).not.toHaveBeenCalled()

    await expect(new GoogleIdentityAuthorization('client-id', { loadScript }).connect()).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('revokes the token when possible and always clears the local session', async () => {
    const google = installGoogle()
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript: async () => undefined,
      now: () => 0,
    })

    const connecting = authorization.connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    google.config()?.callback({ access_token: 'revoke-me', expires_in: 60 })
    await connecting

    google.revoke.mockImplementationOnce(() => {
      throw new Error('revocation failed')
    })
    await expect(authorization.disconnect()).resolves.toBeUndefined()

    expect(google.revoke).toHaveBeenCalledWith('revoke-me', expect.any(Function))
    expect(authorization.getSession()).toBeNull()
  })

  it('cancels a pending connection and ignores a late token callback', async () => {
    const google = installGoogle()
    const authorization = new GoogleIdentityAuthorization('client-id', {
      loadScript: async () => undefined,
    })

    const connecting = authorization.connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    await authorization.disconnect()
    await expect(connecting).rejects.toMatchObject({ code: 'cancel' })

    google.config()?.callback({ access_token: 'late-token', expires_in: 60 })
    expect(authorization.getSession()).toBeNull()
    expect(google.revoke).toHaveBeenCalledWith('late-token', expect.any(Function))
  })

  it('removes a failed GIS script so a later connection can retry', async () => {
    const first = new GoogleIdentityAuthorization('client-id')
    const connecting = first.connect()
    await vi.waitFor(() => expect(document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`)).not.toBeNull())
    const failedScript = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`)!
    failedScript.dispatchEvent(new Event('error'))
    await expect(connecting).rejects.toMatchObject({ code: 'unavailable' })
    expect(document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`)).toBeNull()

    const google = installGoogle()
    const retry = new GoogleIdentityAuthorization('client-id').connect()
    await vi.waitFor(() => expect(google.requestAccessToken).toHaveBeenCalled())
    google.config()?.callback({ access_token: 'retried', expires_in: 60 })
    await expect(retry).resolves.toMatchObject({ accessToken: 'retried' })
  })
})
