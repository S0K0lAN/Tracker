import { isTauri } from '@tauri-apps/api/core'

const RECOGNIZE_COMMAND = 'plugin:speech-recognition|recognize'
const MAX_TRANSCRIPT_LENGTH = 10_000

export type AndroidSpeechRecognitionResult =
  | { status: 'recognized'; transcript: string }
  | { status: 'cancelled' }

export type AndroidSpeechRecognitionErrorCode =
  | 'busy'
  | 'cancel'
  | 'invalid'
  | 'network'
  | 'no-activity'
  | 'no-match'
  | 'permission-denied'
  | 'unavailable'

export class AndroidSpeechRecognitionError extends Error {
  constructor(
    public readonly code: AndroidSpeechRecognitionErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AndroidSpeechRecognitionError'
  }
}

export interface AndroidSpeechRecognitionBridge {
  recognize(locale: string): Promise<unknown>
}

interface AndroidSpeechRecognitionDependencies {
  bridge?: AndroidSpeechRecognitionBridge
}

export async function recognizeWithAndroid(
  locale = 'ru-RU',
  dependencies: AndroidSpeechRecognitionDependencies = {},
): Promise<AndroidSpeechRecognitionResult> {
  if (locale.length > 35 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(locale)) {
    throw new AndroidSpeechRecognitionError('invalid', 'Некорректная локаль распознавания речи')
  }

  let response: unknown
  try {
    response = await (dependencies.bridge ?? new InvokeAndroidSpeechRecognitionBridge()).recognize(locale)
  } catch (error) {
    throw normalizeNativeSpeechError(error)
  }

  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new AndroidSpeechRecognitionError('unavailable', 'Android вернул некорректный результат диктовки')
  }
  const status = (response as { status?: unknown }).status
  if (status === 'cancelled') return { status }
  const transcript = (response as { transcript?: unknown }).transcript
  if (status !== 'recognized' || typeof transcript !== 'string') {
    throw new AndroidSpeechRecognitionError('unavailable', 'Android вернул некорректный результат диктовки')
  }
  const normalized = transcript.trim()
  if (!normalized || normalized.length > MAX_TRANSCRIPT_LENGTH) {
    throw new AndroidSpeechRecognitionError('no-match', 'Речь не распознана')
  }
  return { status, transcript: normalized }
}

export function isNativeAndroidSpeechRecognition(
  tauriRuntime = isTauri(),
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return tauriRuntime && /Android/i.test(userAgent)
}

class InvokeAndroidSpeechRecognitionBridge implements AndroidSpeechRecognitionBridge {
  async recognize(locale: string): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<unknown>(RECOGNIZE_COMMAND, { locale })
  }
}

function normalizeNativeSpeechError(error: unknown): AndroidSpeechRecognitionError {
  if (error instanceof AndroidSpeechRecognitionError) return error
  const payload = parseErrorPayload(error)
  if (payload) {
    const supportedCodes = new Set<AndroidSpeechRecognitionErrorCode>([
      'busy',
      'cancel',
      'invalid',
      'network',
      'no-activity',
      'no-match',
      'permission-denied',
      'unavailable',
    ])
    const code = supportedCodes.has(payload.code as AndroidSpeechRecognitionErrorCode)
      ? payload.code as AndroidSpeechRecognitionErrorCode
      : 'unavailable'
    return new AndroidSpeechRecognitionError(code, payload.message, error)
  }
  return new AndroidSpeechRecognitionError('unavailable', 'Системная диктовка Android недоступна', error)
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
