import { describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from './AuthorizationProvider'
import {
  AndroidGoogleAuthorization,
  type AndroidGoogleAuthorizationBridge,
} from './AndroidGoogleAuthorization'

function bridge(overrides: Partial<AndroidGoogleAuthorizationBridge> = {}): AndroidGoogleAuthorizationBridge {
  return {
    authorize: vi.fn().mockResolvedValue({ accessToken: 'native-token', expiresAt: 1_060_000 }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('AndroidGoogleAuthorization', () => {
  it('keeps a valid native token only in its in-memory session', async () => {
    const native = bridge()
    const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)

    await expect(authorization.connect({ prompt: 'select_account' })).resolves.toEqual({
      accessToken: 'native-token',
      expiresAt: 1_060_000,
    })
    expect(authorization.getSession()).toEqual({ accessToken: 'native-token', expiresAt: 1_060_000 })
    expect(native.authorize).toHaveBeenCalledOnce()
  })

  it('expires the in-memory session using the native expiry timestamp', async () => {
    let now = 1_000_000
    const authorization = new AndroidGoogleAuthorization(bridge(), () => now)
    await authorization.connect()

    now = 1_060_000

    expect(authorization.getSession()).toBeNull()
  })

  it('coalesces concurrent connects into one native authorization request', async () => {
    let resolveAuthorization!: (session: { accessToken: string; expiresAt: number }) => void
    const native = bridge({
      authorize: vi.fn(() => new Promise((resolve) => { resolveAuthorization = resolve })),
    })
    const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)

    const first = authorization.connect({ prompt: 'select_account' })
    const second = authorization.connect({ prompt: 'consent' })
    resolveAuthorization({ accessToken: 'shared-token', expiresAt: 1_060_000 })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { accessToken: 'shared-token', expiresAt: 1_060_000 },
      { accessToken: 'shared-token', expiresAt: 1_060_000 },
    ])
    expect(native.authorize).toHaveBeenCalledOnce()
  })

  it('clears the native token and local session on disconnect', async () => {
    const native = bridge()
    const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)
    await authorization.connect()

    await authorization.disconnect()

    expect(authorization.getSession()).toBeNull()
    expect(native.disconnect).toHaveBeenCalledWith('native-token')
  })

  it('waits for native token cleanup before reconnecting', async () => {
    let finishDisconnect!: () => void
    const native = bridge({
      authorize: vi.fn()
        .mockResolvedValueOnce({ accessToken: 'old-token', expiresAt: 1_060_000 })
        .mockResolvedValueOnce({ accessToken: 'fresh-token', expiresAt: 1_060_000 }),
      disconnect: vi.fn(() => new Promise<void>((resolve) => { finishDisconnect = resolve })),
    })
    const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)
    await authorization.connect()

    const disconnecting = authorization.disconnect()
    const reconnecting = authorization.connect()
    expect(native.authorize).toHaveBeenCalledOnce()

    finishDisconnect()
    await disconnecting
    await expect(reconnecting).resolves.toEqual({
      accessToken: 'fresh-token',
      expiresAt: 1_060_000,
    })
    expect(native.authorize).toHaveBeenCalledTimes(2)
  })

  it('lets a later disconnect cancel a reconnect queued behind token cleanup', async () => {
    let finishDisconnect!: () => void
    const native = bridge({
      authorize: vi.fn().mockResolvedValue({ accessToken: 'old-token', expiresAt: 1_060_000 }),
      disconnect: vi.fn(() => new Promise<void>((resolve) => { finishDisconnect = resolve })),
    })
    const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)
    await authorization.connect()

    const firstDisconnect = authorization.disconnect()
    const queuedConnect = authorization.connect()
    const laterDisconnect = authorization.disconnect()
    finishDisconnect()

    await Promise.all([firstDisconnect, laterDisconnect])
    await expect(queuedConnect).rejects.toMatchObject({ code: 'cancel' })
    expect(native.authorize).toHaveBeenCalledOnce()
    expect(authorization.getSession()).toBeNull()
  })

  it('does not block reconnect forever when native token cleanup never settles', async () => {
    vi.useFakeTimers()
    try {
      const native = bridge({
        authorize: vi.fn()
          .mockResolvedValueOnce({ accessToken: 'old-token', expiresAt: 1_060_000 })
          .mockResolvedValueOnce({ accessToken: 'fresh-token', expiresAt: 1_060_000 }),
        disconnect: vi.fn(() => new Promise<void>(() => undefined)),
      })
      const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)
      await authorization.connect()

      const disconnecting = authorization.disconnect()
      const reconnecting = authorization.connect()
      await vi.advanceTimersByTimeAsync(10_000)

      await disconnecting
      await expect(reconnecting).resolves.toMatchObject({ accessToken: 'fresh-token' })
      expect(native.authorize).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps structured native errors to the shared authorization contract', async () => {
    const authorization = new AndroidGoogleAuthorization(bridge({
      authorize: vi.fn().mockRejectedValue(JSON.stringify({
        code: 'access-denied',
        message: 'Account denied the Drive scope',
      })),
    }))

    await expect(authorization.connect()).rejects.toEqual(expect.objectContaining({
      name: 'AuthorizationError',
      code: 'access-denied',
      message: 'Account denied the Drive scope',
    }))
  })

  it('rejects malformed or expired sessions and clears a returned token', async () => {
    const native = bridge({
      authorize: vi.fn().mockResolvedValue({ accessToken: 'expired-token', expiresAt: 999_999 }),
    })
    const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)

    await expect(authorization.connect()).rejects.toBeInstanceOf(AuthorizationError)
    expect(native.disconnect).toHaveBeenCalledWith('expired-token')
    expect(authorization.getSession()).toBeNull()
  })

  it('maps a null IPC response to AuthorizationError instead of leaking a TypeError', async () => {
    const authorization = new AndroidGoogleAuthorization(bridge({
      authorize: vi.fn().mockResolvedValue(null),
    }))

    await expect(authorization.connect()).rejects.toMatchObject({
      name: 'AuthorizationError',
      code: 'unavailable',
    })
  })

  it('clears a late token when disconnect wins a pending authorization', async () => {
    let resolveAuthorization!: (session: { accessToken: string; expiresAt: number }) => void
    const native = bridge({
      authorize: vi.fn(() => new Promise((resolve) => { resolveAuthorization = resolve })),
    })
    const authorization = new AndroidGoogleAuthorization(native, () => 1_000_000)
    const pending = authorization.connect()

    await authorization.disconnect()
    resolveAuthorization({ accessToken: 'late-token', expiresAt: 1_060_000 })

    await expect(pending).rejects.toMatchObject({ code: 'cancel' })
    expect(native.disconnect).toHaveBeenCalledWith('late-token')
    expect(authorization.getSession()).toBeNull()
  })
})
