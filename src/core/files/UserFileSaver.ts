import { isTauri } from '@tauri-apps/api/core'

const SAVE_FILE_COMMAND = 'plugin:file-export|save_file'
const OPEN_FILE_COMMAND = 'plugin:file-export|open_file'
export const MAX_USER_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILE_NAME_UTF8_BYTES = 240
const DEFAULT_MIME_TYPE = 'application/octet-stream'

export interface UserFilePayload {
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export interface NativeUserFileRequest extends Record<string, unknown> {
  fileName: string
  mimeType: string
  base64Data: string
}

export interface NativeUserFileBridge {
  saveFile(request: NativeUserFileRequest): Promise<unknown>
}

export interface NativeUserFileOpenBridge {
  openFile(request: NativeUserFileRequest): Promise<unknown>
}

export interface UserFileSaveResult {
  status: 'saved' | 'cancelled'
  destination: 'browser' | 'native'
}

export type UserFileSaveErrorCode = 'invalid' | 'too-large' | 'unavailable' | 'failed'

export class UserFileSaveError extends Error {
  constructor(
    public readonly code: UserFileSaveErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'UserFileSaveError'
  }
}

interface UserFileSaverDependencies {
  nativeAndroid?: boolean
  nativeBridge?: NativeUserFileBridge
}

interface UserFileOpenDependencies {
  nativeAndroid?: boolean
  nativeBridge?: NativeUserFileOpenBridge
}

export async function saveUserFile(
  payload: UserFilePayload,
  dependencies: UserFileSaverDependencies = {},
): Promise<UserFileSaveResult> {
  const normalized = normalizePayload(payload)
  const nativeAndroid = dependencies.nativeAndroid ?? isNativeAndroidFileSave()

  if (nativeAndroid) {
    const bridge = dependencies.nativeBridge ?? new InvokeNativeUserFileBridge()
    let response: unknown
    try {
      response = await bridge.saveFile({
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
        base64Data: encodeBase64(normalized.bytes),
      })
    } catch (error) {
      throw normalizeNativeSaveError(error)
    }

    if (!isNativeSaveResult(response)) {
      throw new UserFileSaveError('failed', 'Android вернул некорректный результат сохранения')
    }
    return { status: response.status, destination: 'native' }
  }

  try {
    const bytes = normalized.bytes.slice().buffer
    const url = URL.createObjectURL(new Blob([bytes], { type: normalized.mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = normalized.fileName
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    return { status: 'saved', destination: 'browser' }
  } catch (error) {
    throw new UserFileSaveError('failed', 'Не удалось сохранить файл', error)
  }
}

export async function openUserFile(
  payload: UserFilePayload,
  dependencies: UserFileOpenDependencies = {},
): Promise<{ status: 'opened' }> {
  const normalized = normalizePayload(payload)
  if (normalized.mimeType !== 'application/pdf') {
    throw new UserFileSaveError('invalid', 'Внешний просмотр разрешён только для PDF')
  }
  const nativeAndroid = dependencies.nativeAndroid ?? isNativeAndroidFileSave()
  if (!nativeAndroid) {
    throw new UserFileSaveError('unavailable', 'Системный просмотр файла доступен только на Android')
  }

  let response: unknown
  try {
    response = await (dependencies.nativeBridge ?? new InvokeNativeUserFileOpenBridge()).openFile({
      fileName: normalized.fileName,
      mimeType: normalized.mimeType,
      base64Data: encodeBase64(normalized.bytes),
    })
  } catch (error) {
    throw normalizeNativeSaveError(error)
  }
  if (!response || typeof response !== 'object' || Array.isArray(response) || (response as { status?: unknown }).status !== 'opened') {
    throw new UserFileSaveError('failed', 'Android вернул некорректный результат открытия файла')
  }
  return { status: 'opened' }
}

export function isNativeAndroidFileSave(
  tauriRuntime = isTauri(),
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return tauriRuntime && /Android/i.test(userAgent)
}

export function decodeBase64DataUrl(dataUrl: string): Uint8Array {
  const separator = dataUrl.indexOf(',')
  const header = separator >= 0 ? dataUrl.slice(0, separator) : ''
  if (!/^data:[^;,]+;base64$/i.test(header)) {
    throw new UserFileSaveError('invalid', 'Некорректные данные вложения')
  }

  try {
    const encoded = dataUrl.slice(separator + 1)
    if (encoded.length > Math.ceil(MAX_USER_FILE_BYTES / 3) * 4 + 4) {
      throw new UserFileSaveError('too-large', 'Файл слишком большой для сохранения')
    }
    const binary = atob(encoded)
    if (binary.length > MAX_USER_FILE_BYTES) {
      throw new UserFileSaveError('too-large', 'Файл слишком большой для сохранения')
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch (error) {
    if (error instanceof UserFileSaveError) throw error
    throw new UserFileSaveError('invalid', 'Некорректные данные вложения', error)
  }
}

class InvokeNativeUserFileBridge implements NativeUserFileBridge {
  async saveFile(request: NativeUserFileRequest): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<unknown>(SAVE_FILE_COMMAND, request)
  }
}

class InvokeNativeUserFileOpenBridge implements NativeUserFileOpenBridge {
  async openFile(request: NativeUserFileRequest): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<unknown>(OPEN_FILE_COMMAND, request)
  }
}

function normalizePayload(payload: UserFilePayload): UserFilePayload {
  if (!ArrayBuffer.isView(payload.bytes) || Object.prototype.toString.call(payload.bytes) !== '[object Uint8Array]') {
    throw new UserFileSaveError('invalid', 'Некорректное содержимое файла')
  }
  if (payload.bytes.byteLength > MAX_USER_FILE_BYTES) {
    throw new UserFileSaveError('too-large', 'Файл слишком большой для сохранения')
  }

  const fileName = normalizeFileName(payload.fileName)
  const mimeType = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(payload.mimeType)
    ? payload.mimeType.toLowerCase()
    : DEFAULT_MIME_TYPE
  return { fileName, mimeType, bytes: payload.bytes }
}

function normalizeFileName(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim()
  if (!cleaned || /^\.+$/.test(cleaned)) {
    throw new UserFileSaveError('invalid', 'У файла должно быть корректное имя')
  }
  const encoder = new TextEncoder()
  let normalized = ''
  let byteLength = 0
  for (const character of cleaned) {
    const characterBytes = encoder.encode(character).byteLength
    if (byteLength + characterBytes > MAX_FILE_NAME_UTF8_BYTES) break
    normalized += character
    byteLength += characterBytes
  }
  if (!normalized) throw new UserFileSaveError('invalid', 'У файла должно быть корректное имя')
  return normalized
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
  }
  return btoa(chunks.join(''))
}

function isNativeSaveResult(value: unknown): value is { status: 'saved' | 'cancelled' } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && ((value as { status?: unknown }).status === 'saved' || (value as { status?: unknown }).status === 'cancelled')
}

function normalizeNativeSaveError(error: unknown): UserFileSaveError {
  if (error instanceof UserFileSaveError) return error
  const payload = parseErrorPayload(error)
  if (payload) {
    const code: UserFileSaveErrorCode = payload.code === 'invalid'
      || payload.code === 'invalid-base64'
      || payload.code === 'invalid-file-name'
      || payload.code === 'invalid-mime-type'
      ? 'invalid'
      : payload.code === 'too-large' || payload.code === 'payload-too-large'
        ? 'too-large'
        : payload.code === 'unavailable' || payload.code === 'no-activity'
          ? 'unavailable'
          : 'failed'
    return new UserFileSaveError(code, payload.message, error)
  }
  return new UserFileSaveError('failed', 'Не удалось сохранить файл на устройстве', error)
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
