import {
  AuthorizationError,
  type AuthorizationConnectOptions,
  type AuthorizationProvider,
  type AuthorizationSession,
} from './AuthorizationProvider'

const AUTHORIZE_COMMAND = 'plugin:google-authorization|authorize'
const DISCONNECT_COMMAND = 'plugin:google-authorization|disconnect'
const NATIVE_TOKEN_CLEAR_TIMEOUT_MS = 10_000

interface NativeAuthorizationSession {
  accessToken?: unknown
  expiresAt?: unknown
}

export interface AndroidGoogleAuthorizationBridge {
  authorize(): Promise<unknown>
  disconnect(accessToken: string): Promise<void>
}

/**
 * Android Google authorization stays outside the WebView. The access token is
 * held only by this in-memory session and is sent back through IPC solely for
 * best-effort cleanup when the user disconnects.
 */
export class AndroidGoogleAuthorization implements AuthorizationProvider {
  private session: AuthorizationSession | null = null
  private connectionGeneration = 0
  private pendingConnection?: {
    generation: number
    promise: Promise<AuthorizationSession>
  }
  private pendingDisconnect?: Promise<void>

  constructor(
    private readonly bridge: AndroidGoogleAuthorizationBridge = new InvokeAndroidGoogleAuthorizationBridge(),
    private readonly now: () => number = Date.now,
  ) {}

  connect(options: AuthorizationConnectOptions = {}): Promise<AuthorizationSession> {
    const prompt = options.prompt ?? ''
    if (prompt !== '' && prompt !== 'select_account' && prompt !== 'consent') {
      return Promise.reject(new AuthorizationError(
        'config',
        `Unsupported Google OAuth prompt: ${String(prompt)}`,
      ))
    }

    const pending = this.pendingConnection
    if (pending?.generation === this.connectionGeneration) {
      return pending.promise.then((session) => ({ ...session }))
    }

    const generation = ++this.connectionGeneration
    const barriers: Promise<unknown>[] = []
    if (this.pendingDisconnect) barriers.push(this.pendingDisconnect)
    if (pending?.promise) barriers.push(pending.promise)

    const operation = barriers.length === 0
      ? this.authorize(generation)
      : Promise.allSettled(barriers).then(() => {
          if (generation !== this.connectionGeneration) {
            throw new AuthorizationError('cancel', 'Google authorization was cancelled')
          }
          return this.authorize(generation)
        })
    let promise!: Promise<AuthorizationSession>
    promise = operation.finally(() => {
      if (this.pendingConnection?.promise === promise) this.pendingConnection = undefined
    })
    this.pendingConnection = { generation, promise }
    return promise.then((session) => ({ ...session }))
  }

  private async authorize(generation: number): Promise<AuthorizationSession> {
    let response: unknown
    try {
      response = await this.bridge.authorize()
    } catch (error) {
      throw normalizeNativeAuthorizationError(error)
    }

    if (!isNativeAuthorizationSession(response)) {
      throw new AuthorizationError('unavailable', 'Google returned an invalid Android authorization session')
    }
    const accessToken = typeof response.accessToken === 'string' ? response.accessToken.trim() : ''
    const expiresAt = Number(response.expiresAt)
    if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      if (accessToken) await this.clearTokenBestEffort(accessToken)
      throw new AuthorizationError('unavailable', 'Google returned an invalid Android authorization session')
    }

    if (generation !== this.connectionGeneration) {
      await this.clearTokenBestEffort(accessToken)
      throw new AuthorizationError('cancel', 'Google authorization was cancelled')
    }

    this.session = { accessToken, expiresAt }
    return { ...this.session }
  }

  getSession(): AuthorizationSession | null {
    if (!this.session) return null
    if (this.session.expiresAt <= this.now()) {
      this.session = null
      return null
    }
    return { ...this.session }
  }

  async disconnect(): Promise<void> {
    this.connectionGeneration += 1
    const accessToken = this.session?.accessToken
    this.session = null
    if (this.pendingDisconnect) return this.pendingDisconnect
    if (!accessToken) return

    let pending!: Promise<void>
    pending = this.clearTokenBestEffort(accessToken).finally(() => {
      if (this.pendingDisconnect === pending) this.pendingDisconnect = undefined
    })
    this.pendingDisconnect = pending
    await pending
  }

  private async clearTokenBestEffort(accessToken: string): Promise<void> {
    const cleanup = this.bridge.disconnect(accessToken).catch(() => undefined)
    let timeout: number | undefined
    try {
      await Promise.race([
        cleanup,
        new Promise<void>((resolve) => {
          timeout = window.setTimeout(resolve, NATIVE_TOKEN_CLEAR_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
    // The credential is already gone from application memory. Google Play
    // Services cleanup is deliberately bounded and best effort, matching
    // browser revoke without blocking a future login indefinitely.
  }
}

class InvokeAndroidGoogleAuthorizationBridge implements AndroidGoogleAuthorizationBridge {
  async authorize(): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<unknown>(AUTHORIZE_COMMAND)
  }

  async disconnect(accessToken: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke(DISCONNECT_COMMAND, { accessToken })
  }
}

const AUTHORIZATION_ERROR_CODES = new Set<AuthorizationError['code']>([
  'access-denied',
  'cancel',
  'config',
  'unavailable',
])

function normalizeNativeAuthorizationError(error: unknown): AuthorizationError {
  if (error instanceof AuthorizationError) return error
  const payload = parseErrorPayload(error)
  if (payload && AUTHORIZATION_ERROR_CODES.has(payload.code as AuthorizationError['code'])) {
    return new AuthorizationError(payload.code as AuthorizationError['code'], payload.message, error)
  }
  return new AuthorizationError(
    'unavailable',
    error instanceof Error && error.message
      ? error.message
      : 'Native Google authorization is unavailable',
    error,
  )
}

function parseErrorPayload(error: unknown): { code: string; message: string } | null {
  if (isErrorPayload(error)) return error
  if (typeof error !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(error)
    return isErrorPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isErrorPayload(value: unknown): value is { code: string; message: string } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { message?: unknown }).message === 'string'
}

function isNativeAuthorizationSession(value: unknown): value is NativeAuthorizationSession {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
