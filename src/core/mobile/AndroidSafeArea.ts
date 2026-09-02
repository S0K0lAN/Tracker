import { isTauri } from '@tauri-apps/api/core'

const SAFE_AREA_COMMAND = 'plugin:android-window|safe_area_insets'
const MAX_SAFE_AREA_CSS_PIXELS = 1_000

export interface AndroidSafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface AndroidSafeAreaBridge {
  readInsets(): Promise<unknown>
}

interface AndroidSafeAreaDependencies {
  nativeAndroid?: boolean
  bridge?: AndroidSafeAreaBridge
  root?: HTMLElement
  runtimeWindow?: Window
  runtimeDocument?: Document
}

export function installAndroidSafeAreaFallback(
  dependencies: AndroidSafeAreaDependencies = {},
): () => void {
  const nativeAndroid = dependencies.nativeAndroid ?? isNativeAndroidSafeArea()
  if (!nativeAndroid || typeof window === 'undefined' || typeof document === 'undefined') return () => undefined

  const runtimeWindow = dependencies.runtimeWindow ?? window
  const runtimeDocument = dependencies.runtimeDocument ?? document
  const root = dependencies.root ?? runtimeDocument.documentElement
  const bridge = dependencies.bridge ?? new InvokeAndroidSafeAreaBridge()
  let disposed = false
  let generation = 0
  let animationFrame = 0

  const refresh = () => {
    const requestGeneration = ++generation
    void bridge.readInsets().then((value) => {
      if (disposed || requestGeneration !== generation) return
      applyAndroidSafeAreaInsets(root, parseInsets(value))
    }).catch(() => {
      // env(safe-area-inset-*) remains active. Resize/visibility and delayed
      // retries cover the short interval before WindowInsets is attached.
    })
  }
  const scheduleRefresh = () => {
    runtimeWindow.cancelAnimationFrame(animationFrame)
    animationFrame = runtimeWindow.requestAnimationFrame(refresh)
  }
  const refreshWhenVisible = () => {
    if (runtimeDocument.visibilityState === 'visible') scheduleRefresh()
  }

  runtimeWindow.addEventListener('resize', scheduleRefresh)
  runtimeWindow.addEventListener('orientationchange', scheduleRefresh)
  runtimeWindow.visualViewport?.addEventListener('resize', scheduleRefresh)
  runtimeDocument.addEventListener('visibilitychange', refreshWhenVisible)
  const retryTimers = [250, 1_000].map((delay) => runtimeWindow.setTimeout(refresh, delay))
  refresh()

  return () => {
    disposed = true
    generation += 1
    runtimeWindow.cancelAnimationFrame(animationFrame)
    retryTimers.forEach((timer) => runtimeWindow.clearTimeout(timer))
    runtimeWindow.removeEventListener('resize', scheduleRefresh)
    runtimeWindow.removeEventListener('orientationchange', scheduleRefresh)
    runtimeWindow.visualViewport?.removeEventListener('resize', scheduleRefresh)
    runtimeDocument.removeEventListener('visibilitychange', refreshWhenVisible)
  }
}

export function applyAndroidSafeAreaInsets(root: HTMLElement, insets: AndroidSafeAreaInsets) {
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = Math.round(insets[side] * 100) / 100
    root.style.setProperty(
      `--safe-area-${side}`,
      `max(env(safe-area-inset-${side}, 0px), ${value}px)`,
    )
  }
}

export function isNativeAndroidSafeArea(
  tauriRuntime = isTauri(),
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return tauriRuntime && /Android/i.test(userAgent)
}

class InvokeAndroidSafeAreaBridge implements AndroidSafeAreaBridge {
  async readInsets(): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<unknown>(SAFE_AREA_COMMAND)
  }
}

function parseInsets(value: unknown): AndroidSafeAreaInsets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Android insets')
  const candidate = value as Partial<Record<keyof AndroidSafeAreaInsets, unknown>>
  const parsed = {} as AndroidSafeAreaInsets
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const inset = candidate[side]
    if (typeof inset !== 'number' || !Number.isFinite(inset) || inset < 0 || inset > MAX_SAFE_AREA_CSS_PIXELS) {
      throw new Error('Invalid Android insets')
    }
    parsed[side] = inset
  }
  return parsed
}
