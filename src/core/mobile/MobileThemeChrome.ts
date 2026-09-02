import { isTauri } from '@tauri-apps/api/core'

const SYSTEM_BAR_APPEARANCE_COMMAND = 'plugin:android-window|set_system_bar_appearance'
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export interface AndroidSystemBarBridge {
  setDarkTheme(darkTheme: boolean): Promise<void>
}

interface MobileThemeChromeDependencies {
  nativeAndroid?: boolean
  bridge?: AndroidSystemBarBridge
  root?: HTMLElement
  runtimeWindow?: Window
  runtimeDocument?: Document
  colorSchemeQuery?: MediaQueryList
}

export function installMobileThemeChrome(
  dependencies: MobileThemeChromeDependencies = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined

  const runtimeWindow = dependencies.runtimeWindow ?? window
  const runtimeDocument = dependencies.runtimeDocument ?? document
  const root = dependencies.root ?? runtimeDocument.documentElement
  const colorSchemeQuery = dependencies.colorSchemeQuery ?? runtimeWindow.matchMedia(DARK_SCHEME_QUERY)
  const nativeAndroid = dependencies.nativeAndroid ?? isNativeAndroidRuntime()
  const bridge = dependencies.bridge ?? new InvokeAndroidSystemBarBridge()
  let disposed = false
  let requestedNativeTheme: boolean | undefined
  let generation = 0

  const refresh = () => {
    const darkTheme = resolveDarkTheme(root.dataset.theme, colorSchemeQuery.matches)
    syncThemeColorMetadata(runtimeDocument, darkTheme)
    if (!nativeAndroid || requestedNativeTheme === darkTheme) return

    requestedNativeTheme = darkTheme
    const requestGeneration = ++generation
    void bridge.setDarkTheme(darkTheme).catch(() => {
      if (!disposed && requestGeneration === generation) requestedNativeTheme = undefined
    })
  }

  const observer = new MutationObserver(refresh)
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  colorSchemeQuery.addEventListener('change', refresh)
  refresh()

  return () => {
    disposed = true
    generation += 1
    observer.disconnect()
    colorSchemeQuery.removeEventListener('change', refresh)
  }
}

export function resolveDarkTheme(theme: string | undefined, prefersDark: boolean): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return prefersDark
}

export function syncThemeColorMetadata(runtimeDocument: Document, darkTheme: boolean): void {
  const lightMeta = runtimeDocument.querySelector<HTMLMetaElement>('meta[data-focus-flow-theme-color="light"]')
  const darkMeta = runtimeDocument.querySelector<HTMLMetaElement>('meta[data-focus-flow-theme-color="dark"]')
  lightMeta?.setAttribute('media', darkTheme ? 'not all' : 'all')
  darkMeta?.setAttribute('media', darkTheme ? 'all' : 'not all')
}

export function isNativeAndroidRuntime(
  tauriRuntime = isTauri(),
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return tauriRuntime && /Android/i.test(userAgent)
}

class InvokeAndroidSystemBarBridge implements AndroidSystemBarBridge {
  async setDarkTheme(darkTheme: boolean): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<void>(SYSTEM_BAR_APPEARANCE_COMMAND, { darkTheme })
  }
}
