import { describe, expect, it, vi } from 'vitest'
import {
  applyAndroidSafeAreaInsets,
  installAndroidSafeAreaFallback,
  isNativeAndroidSafeArea,
} from './AndroidSafeArea'

describe('Android safe-area fallback', () => {
  it('combines native insets with CSS env through max rather than double-padding', () => {
    const root = document.createElement('div')
    applyAndroidSafeAreaInsets(root, { top: 28.125, right: 0, bottom: 24, left: 3 })
    expect(root.style.getPropertyValue('--safe-area-top')).toBe('max(env(safe-area-inset-top, 0px), 28.13px)')
    expect(root.style.getPropertyValue('--safe-area-right')).toBe('max(env(safe-area-inset-right, 0px), 0px)')
    expect(root.style.getPropertyValue('--safe-area-bottom')).toBe('max(env(safe-area-inset-bottom, 0px), 24px)')
    expect(root.style.getPropertyValue('--safe-area-left')).toBe('max(env(safe-area-inset-left, 0px), 3px)')
  })

  it('reads native insets on install and after an Android viewport resize', async () => {
    const root = document.createElement('div')
    const readInsets = vi.fn()
      .mockResolvedValueOnce({ top: 28, right: 0, bottom: 24, left: 0 })
      .mockResolvedValue({ top: 0, right: 28, bottom: 20, left: 28 })
    const dispose = installAndroidSafeAreaFallback({
      nativeAndroid: true,
      bridge: { readInsets },
      root,
    })

    await vi.waitFor(() => expect(root.style.getPropertyValue('--safe-area-top')).toContain('28px'))
    window.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(root.style.getPropertyValue('--safe-area-left')).toContain('28px'))
    expect(readInsets).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('ignores an unavailable or malformed response and keeps CSS env untouched', async () => {
    const root = document.createElement('div')
    root.style.setProperty('--safe-area-top', 'env(safe-area-inset-top, 0px)')
    const dispose = installAndroidSafeAreaFallback({
      nativeAndroid: true,
      bridge: { readInsets: vi.fn().mockResolvedValue({ top: -1, right: 0, bottom: 0, left: 0 }) },
      root,
    })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(root.style.getPropertyValue('--safe-area-top')).toBe('env(safe-area-inset-top, 0px)')
    dispose()
  })

  it('runs only in Tauri Android', () => {
    expect(isNativeAndroidSafeArea(true, 'Mozilla/5.0 (Linux; Android 13; PHK110)')).toBe(true)
    expect(isNativeAndroidSafeArea(false, 'Mozilla/5.0 (Linux; Android 13; PHK110)')).toBe(false)
    expect(isNativeAndroidSafeArea(true, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })
})
