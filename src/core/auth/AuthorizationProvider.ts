export interface AuthorizationSession {
  accessToken: string
  expiresAt: number
}

export type AuthorizationPrompt = '' | 'select_account' | 'consent'

export interface AuthorizationConnectOptions {
  prompt?: AuthorizationPrompt
}

export interface AuthorizationProvider {
  connect(options?: AuthorizationConnectOptions): Promise<AuthorizationSession>
  getSession(): AuthorizationSession | null
  disconnect(): Promise<void>
}

export type AuthorizationErrorCode = 'cancel' | 'config' | 'unavailable'

export class AuthorizationError extends Error {
  constructor(
    readonly code: AuthorizationErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AuthorizationError'
  }
}
