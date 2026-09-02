import { describe, expect, it, vi } from 'vitest'
import {
  AndroidSpeechRecognitionError,
  isNativeAndroidSpeechRecognition,
  recognizeWithAndroid,
} from './AndroidSpeechRecognition'

describe('Android speech recognition bridge', () => {
  it('returns a trimmed recognized transcript with the requested Russian locale', async () => {
    const recognize = vi.fn().mockResolvedValue({ status: 'recognized', transcript: '  купить молоко завтра  ' })
    await expect(recognizeWithAndroid('ru-RU', { bridge: { recognize } })).resolves.toEqual({
      status: 'recognized',
      transcript: 'купить молоко завтра',
    })
    expect(recognize).toHaveBeenCalledWith('ru-RU')
  })

  it('preserves a user cancellation without inventing a failure', async () => {
    await expect(recognizeWithAndroid('ru-RU', {
      bridge: { recognize: vi.fn().mockResolvedValue({ status: 'cancelled' }) },
    })).resolves.toEqual({ status: 'cancelled' })
  })

  it('normalizes typed native errors and unknown responses', async () => {
    await expect(recognizeWithAndroid('ru-RU', {
      bridge: { recognize: vi.fn().mockRejectedValue(JSON.stringify({ code: 'no-activity', message: 'Нет сервиса распознавания' })) },
    })).rejects.toMatchObject({ code: 'no-activity', message: 'Нет сервиса распознавания' })

    await expect(recognizeWithAndroid('ru-RU', {
      bridge: { recognize: vi.fn().mockResolvedValue({ status: 'recognized', transcript: '   ' }) },
    })).rejects.toMatchObject({ code: 'no-match' })
  })

  it('rejects an invalid locale before invoking the bridge', async () => {
    const recognize = vi.fn()
    await expect(recognizeWithAndroid('../ru', { bridge: { recognize } })).rejects.toBeInstanceOf(AndroidSpeechRecognitionError)
    expect(recognize).not.toHaveBeenCalled()
  })

  it('selects native recognition only inside Tauri Android', () => {
    expect(isNativeAndroidSpeechRecognition(true, 'Mozilla/5.0 (Linux; Android 13; PHK110)')).toBe(true)
    expect(isNativeAndroidSpeechRecognition(false, 'Mozilla/5.0 (Linux; Android 13; PHK110)')).toBe(false)
    expect(isNativeAndroidSpeechRecognition(true, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })
})
