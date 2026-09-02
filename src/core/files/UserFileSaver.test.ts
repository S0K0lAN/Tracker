import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeBase64DataUrl,
  isNativeAndroidFileSave,
  MAX_USER_FILE_BYTES,
  openUserFile,
  saveUserFile,
  UserFileSaveError,
} from './UserFileSaver'

const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

afterEach(() => {
  vi.restoreAllMocks()
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl })
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl })
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('user file saving', () => {
  it('downloads through the browser and cleans up its object URL', async () => {
    const createObjectUrl = vi.fn(() => 'blob:user-file')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    let downloadedName = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download
    })

    await expect(saveUserFile({
      fileName: 'report/September.json',
      mimeType: 'application/json',
      bytes: new TextEncoder().encode('{"ok":true}'),
    }, { nativeAndroid: false })).resolves.toEqual({ status: 'saved', destination: 'browser' })

    expect(downloadedName).toBe('report_September.json')
    expect(createObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/json' }))
    await vi.waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:user-file'))
  })

  it('passes a bounded base64 payload to Android and preserves cancellation', async () => {
    const saveFile = vi.fn().mockResolvedValue({ status: 'cancelled' })

    await expect(saveUserFile({
      fileName: 'note.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('hello'),
    }, { nativeAndroid: true, nativeBridge: { saveFile } })).resolves.toEqual({
      status: 'cancelled',
      destination: 'native',
    })

    expect(saveFile).toHaveBeenCalledWith({
      fileName: 'note.txt',
      mimeType: 'text/plain',
      base64Data: 'aGVsbG8=',
    })
  })

  it('rejects oversized input before invoking Android', async () => {
    const saveFile = vi.fn()
    await expect(saveUserFile({
      fileName: 'large.bin',
      mimeType: 'application/octet-stream',
      bytes: new Uint8Array(MAX_USER_FILE_BYTES + 1),
    }, { nativeAndroid: true, nativeBridge: { saveFile } })).rejects.toMatchObject({ code: 'too-large' })
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('normalizes typed Android failures and rejects malformed success responses', async () => {
    await expect(saveUserFile({
      fileName: 'backup.json',
      mimeType: 'application/json',
      bytes: new Uint8Array([1]),
    }, {
      nativeAndroid: true,
      nativeBridge: { saveFile: vi.fn().mockRejectedValue(JSON.stringify({ code: 'unavailable', message: 'Нет приложения для выбора файла' })) },
    })).rejects.toMatchObject({ code: 'unavailable', message: 'Нет приложения для выбора файла' })

    await expect(saveUserFile({
      fileName: 'backup.json',
      mimeType: 'application/json',
      bytes: new Uint8Array([1]),
    }, {
      nativeAndroid: true,
      nativeBridge: { saveFile: vi.fn().mockResolvedValue({ ok: true }) },
    })).rejects.toBeInstanceOf(UserFileSaveError)
  })

  it('opens only a validated PDF through the Android bridge', async () => {
    const openFile = vi.fn().mockResolvedValue({ status: 'opened' })
    await expect(openUserFile({
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    }, { nativeAndroid: true, nativeBridge: { openFile } })).resolves.toEqual({ status: 'opened' })
    expect(openFile).toHaveBeenCalledWith({
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      base64Data: 'JVBERg==',
    })

    await expect(openUserFile({
      fileName: 'note.txt',
      mimeType: 'text/plain',
      bytes: new Uint8Array([1]),
    }, { nativeAndroid: true, nativeBridge: { openFile } })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('decodes validated base64 data URLs and rejects other schemes', () => {
    expect([...decodeBase64DataUrl('data:text/plain;base64,aGVsbG8=')]).toEqual([104, 101, 108, 108, 111])
    expect(() => decodeBase64DataUrl('javascript:alert(1)')).toThrow(UserFileSaveError)
    expect(() => decodeBase64DataUrl('data:text/plain,hello')).toThrow(UserFileSaveError)
  })

  it('uses the native bridge only for Tauri on Android', () => {
    expect(isNativeAndroidFileSave(true, 'Mozilla/5.0 (Linux; Android 13; PHK110)')).toBe(true)
    expect(isNativeAndroidFileSave(false, 'Mozilla/5.0 (Linux; Android 13; PHK110)')).toBe(false)
    expect(isNativeAndroidFileSave(true, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })
})
