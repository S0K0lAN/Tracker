import { useEffect, useRef } from 'react'
import { isTauri } from '@tauri-apps/api/core'

interface AndroidBackButtonOptions {
  path: string
  hasOverlay: boolean
  dismissOverlay(): void
  navigate(path: string): void
}

/**
 * Maps the Android system Back gesture to the same close/navigation order as
 * keyboard Escape. Browser builds never register a native listener.
 */
export function useAndroidBackButton(options: AndroidBackButtonOptions) {
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    if (!isTauri()) return

    let active = true
    let unregister: (() => Promise<void>) | undefined

    void import('@tauri-apps/api/app')
      .then(({ onBackButtonPress }) => onBackButtonPress(async ({ canGoBack }) => {
        const target = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : document.body
        const escape = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
        target.dispatchEvent(escape)
        if (escape.defaultPrevented) return

        const current = latest.current
        if (current.hasOverlay) {
          current.dismissOverlay()
          return
        }
        if (canGoBack) {
          window.history.back()
          return
        }
        if (current.path !== '/today') {
          current.navigate('/today')
          return
        }

        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        await getCurrentWindow().close()
      }))
      .then((listener) => {
        if (!active) {
          void listener.unregister()
          return
        }
        unregister = () => listener.unregister()
      })
      .catch(() => {
        // A missing Android app plugin must not affect browser or desktop use.
      })

    return () => {
      active = false
      void unregister?.()
    }
  }, [])
}
