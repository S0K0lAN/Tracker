import {
  AuthorizationError,
  type AuthorizationConnectOptions,
  type AuthorizationPrompt,
  type AuthorizationProvider,
  type AuthorizationSession,
} from './AuthorizationProvider'

export const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client'
export const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}

interface GoogleOAuthError {
  type?: string
  message?: string
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: AuthorizationPrompt }): void
}

interface GoogleOAuth2Api {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
    error_callback: (error: GoogleOAuthError) => void
  }): GoogleTokenClient
  revoke?: (accessToken: string, callback?: () => void) => void
}

interface GoogleIdentityServices {
  accounts?: {
    oauth2?: GoogleOAuth2Api
  }
}

type GoogleWindow = Window & { google?: GoogleIdentityServices }

export type GoogleIdentityScriptLoader = (source: string) => Promise<void>

export interface GoogleIdentityAuthorizationDependencies {
  loadScript?: GoogleIdentityScriptLoader
  now?: () => number
}

let defaultScriptLoad: Promise<void> | null = null
const GOOGLE_IDENTITY_LOAD_TIMEOUT_MS = 15_000

function googleOAuth2(): GoogleOAuth2Api | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as GoogleWindow).google?.accounts?.oauth2
}

function defaultLoadScript(source: string): Promise<void> {
  if (googleOAuth2()) return Promise.resolve()
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Google Identity Services requires a browser environment'))
  }
  if (defaultScriptLoad) return defaultScriptLoad

  defaultScriptLoad = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${source}"]`)
    existing?.remove()
    const script = document.createElement('script')
    let settled = false

    const onLoad = () => {
      if (googleOAuth2()) finish(resolve)
      else finish(() => reject(new Error('Google Identity Services did not expose the OAuth API')), true)
    }
    const onError = () => {
      finish(() => reject(new Error('Unable to load Google Identity Services')), true)
    }
    const cleanup = () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      window.clearTimeout(timeout)
    }
    const finish = (complete: () => void, remove = false) => {
      if (settled) return
      settled = true
      cleanup()
      if (remove) script.remove()
      complete()
    }
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('Google Identity Services loading timed out')), true),
      GOOGLE_IDENTITY_LOAD_TIMEOUT_MS,
    )

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    script.src = source
    script.async = true
    script.defer = true
    document.head.append(script)
  }).catch((error: unknown) => {
    defaultScriptLoad = null
    throw error
  })

  return defaultScriptLoad
}

function oauthErrorCode(reason?: string): AuthorizationError['code'] {
  if (reason === 'access_denied') return 'access-denied'
  if (reason === 'popup_closed' || reason === 'user_cancel') {
    return 'cancel'
  }
  if (
    reason === 'invalid_client' ||
    reason === 'invalid_request' ||
    reason === 'invalid_scope' ||
    reason === 'unauthorized_client'
  ) {
    return 'config'
  }
  return 'unavailable'
}

function oauthError(reason: string | undefined, message: string | undefined, cause?: unknown) {
  const code = oauthErrorCode(reason)
  const fallback = code === 'cancel'
    ? 'Google authorization was cancelled'
    : code === 'access-denied'
      ? 'Google denied access to this application'
      : code === 'config'
        ? 'Google OAuth is not configured correctly'
        : 'Google authorization is unavailable'
  return new AuthorizationError(code, message || fallback, cause)
}

export class GoogleIdentityAuthorization implements AuthorizationProvider {
  private readonly loadScript: GoogleIdentityScriptLoader
  private readonly now: () => number
  private session: AuthorizationSession | null = null
  private connectionGeneration = 0
  private cancelPending?: () => void

  constructor(
    private readonly clientId: string,
    dependencies: GoogleIdentityAuthorizationDependencies = {},
  ) {
    this.loadScript = dependencies.loadScript ?? defaultLoadScript
    this.now = dependencies.now ?? Date.now
  }

  async connect(options: AuthorizationConnectOptions = {}): Promise<AuthorizationSession> {
    this.cancelPending?.()
    const generation = ++this.connectionGeneration
    const clientId = this.clientId.trim()
    if (!clientId) {
      throw new AuthorizationError('config', 'Google OAuth client ID is not configured')
    }

    const prompt = options.prompt ?? ''
    if (prompt !== '' && prompt !== 'select_account' && prompt !== 'consent') {
      throw new AuthorizationError('config', `Unsupported Google OAuth prompt: ${String(prompt)}`)
    }

    try {
      await this.loadScript(GOOGLE_IDENTITY_SCRIPT_URL)
    } catch (error) {
      if (error instanceof AuthorizationError) throw error
      throw new AuthorizationError(
        'unavailable',
        'Unable to load Google Identity Services',
        error,
      )
    }

    if (generation !== this.connectionGeneration) {
      throw new AuthorizationError('cancel', 'Google authorization was cancelled')
    }

    const oauth2 = googleOAuth2()
    if (!oauth2) {
      throw new AuthorizationError(
        'unavailable',
        'Google Identity Services OAuth API is unavailable',
      )
    }

    return new Promise<AuthorizationSession>((resolve, reject) => {
      let settled = false
      const finish = (complete: () => void) => {
        if (settled) return
        settled = true
        if (this.cancelPending === cancel) this.cancelPending = undefined
        complete()
      }
      const cancel = () => finish(() => reject(new AuthorizationError('cancel', 'Google authorization was cancelled')))
      this.cancelPending = cancel
      const callback = (response: GoogleTokenResponse) => {
        const revokeOrphanToken = () => {
          if (!response.access_token) return
          try { oauth2.revoke?.(response.access_token, () => undefined) } catch { /* best effort */ }
        }
        if (generation !== this.connectionGeneration) {
          revokeOrphanToken()
          cancel()
          return
        }
        if (response.error) {
          revokeOrphanToken()
          finish(() => reject(oauthError(response.error, response.error_description)))
          return
        }

        const lifetimeSeconds = Number(response.expires_in)
        if (!response.access_token || !Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) {
          revokeOrphanToken()
          finish(() => reject(new AuthorizationError(
            'unavailable',
            'Google returned an invalid access token response',
          )))
          return
        }

        this.session = {
          accessToken: response.access_token,
          expiresAt: this.now() + lifetimeSeconds * 1_000,
        }
        finish(() => resolve({ ...this.session! }))
      }

      const errorCallback = (error: GoogleOAuthError) => {
        finish(() => reject(oauthError(error.type, error.message, error)))
      }

      try {
        const client = oauth2.initTokenClient({
          client_id: clientId,
          scope: GOOGLE_DRIVE_APPDATA_SCOPE,
          callback,
          error_callback: errorCallback,
        })
        client.requestAccessToken({ prompt })
      } catch (error) {
        finish(() => reject(new AuthorizationError(
          'config',
          'Unable to initialize Google OAuth',
          error,
        )))
      }
    })
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
    this.cancelPending?.()
    this.cancelPending = undefined
    const accessToken = this.session?.accessToken
    this.session = null
    if (!accessToken) return

    try {
      googleOAuth2()?.revoke?.(accessToken, () => undefined)
    } catch {
      // Revocation is best effort; local credentials are already cleared.
    }
  }
}
