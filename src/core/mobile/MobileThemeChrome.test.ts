import { describe, expect, it, vi } from 'vitest'
import {
  installMobileThemeChrome,
  isNativeAndroidRuntime,
  resolveDarkTheme,
  syncThemeColorMetadata,
} from './MobileThemeChrome'

function createColorSchemeQuery(matches: boolean) {
  const listeners = new Set<() => void>()
  return {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
    emit() {
      listeners.forEach((listener) => listener())
    },
  } as unknown as MediaQueryList & { matches: boolean; emit(): void }
}

describe('mobile theme chrome', () => {
  it('resolves explicit themes before the operating-system preference', () => {
    expect(resolveDarkTheme('dark', false)).toBe(true)
    expect(resolveDarkTheme('light', true)).toBe(false)
    expect(resolveDarkTheme('system', true)).toBe(true)
    expect(resolveDarkTheme(undefined, false)).toBe(false)
  })

  it('keeps theme-color metadata aligned with the resolved app theme', () => {
    const runtimeDocument = document.implementation.createHTMLDocument()
    runtimeDocument.head.innerHTML = [
      '<meta name="theme-color" content="#f5f7f4" data-focus-flow-theme-color="light">',
      '<meta name="theme-color" content="#171c18" data-focus-flow-theme-color="dark">',
    ].join('')

    syncThemeColorMetadata(runtimeDocument, true)
    expect(runtimeDocument.querySelector('[data-focus-flow-theme-color="light"]')?.getAttribute('media')).toBe('not all')
    expect(runtimeDocument.querySelector('[data-focus-flow-theme-color="dark"]')?.getAttribute('media')).toBe('all')
  })

  it('updates native system-bar appearance for manual and system theme changes', async () => {
    const root = document.createElement('html')
    root.dataset.theme = 'light'
    const colorSchemeQuery = createColorSchemeQuery(false)
    const setDarkTheme = vi.fn().mockResolvedValue(undefined)
    const dispose = installMobileThemeChrome({
      nativeAndroid: true,
      bridge: { setDarkTheme },
      root,
      colorSchemeQuery,
    })

    expect(setDarkTheme).toHaveBeenLastCalledWith(false)
    root.dataset.theme = 'dark'
    await vi.waitFor(() => expect(setDarkTheme).toHaveBeenLastCalledWith(true))
    root.dataset.theme = 'system'
    colorSchemeQuery.matches = false
    colorSchemeQuery.emit()
    await vi.waitFor(() => expect(setDarkTheme).toHaveBeenLastCalledWith(false))
    dispose()
  })

  it('does not invoke the native bridge outside Tauri Android', () => {
    const setDarkTheme = vi.fn()
    const dispose = installMobileThemeChrome({
      nativeAndroid: false,
      bridge: { setDarkTheme },
      root: document.createElement('html'),
      colorSchemeQuery: createColorSchemeQuery(false),
    })
    expect(setDarkTheme).not.toHaveBeenCalled()
    dispose()

    expect(isNativeAndroidRuntime(true, 'Mozilla/5.0 (Linux; Android 16; PHK110)')).toBe(true)
    expect(isNativeAndroidRuntime(false, 'Mozilla/5.0 (Linux; Android 16; PHK110)')).toBe(false)
    expect(isNativeAndroidRuntime(true, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })
})
