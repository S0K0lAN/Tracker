import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAndroidBackButton } from './useAndroidBackButton'

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  onBackButtonPress: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocks.isTauri }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: mocks.onBackButtonPress }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: mocks.close }),
}))

type BackHandler = (payload: { canGoBack: boolean }) => Promise<void>

function Harness({
  path = '/inbox',
  hasOverlay = false,
  dismissOverlay = vi.fn(),
  navigate = vi.fn(),
}: {
  path?: string
  hasOverlay?: boolean
  dismissOverlay?: () => void
  navigate?: (path: string) => void
}) {
  useAndroidBackButton({ path, hasOverlay, dismissOverlay, navigate })
  return <button type="button">Тест</button>
}

async function registeredHandler() {
  await act(async () => undefined)
  return mocks.onBackButtonPress.mock.calls[0][0] as BackHandler
}

describe('useAndroidBackButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isTauri.mockReturnValue(true)
    mocks.onBackButtonPress.mockResolvedValue({ unregister: vi.fn().mockResolvedValue(undefined) })
  })

  it('does not register native events in the browser', () => {
    mocks.isTauri.mockReturnValue(false)
    render(<Harness />)
    expect(mocks.onBackButtonPress).not.toHaveBeenCalled()
  })

  it('lets the focused dialog consume Back as Escape', async () => {
    const dismissOverlay = vi.fn()
    render(
      <div onKeyDown={(event) => event.key === 'Escape' && event.preventDefault()}>
        <Harness hasOverlay dismissOverlay={dismissOverlay} />
      </div>,
    )
    document.querySelector('button')?.focus()
    const handler = await registeredHandler()

    await act(() => handler({ canGoBack: false }))

    expect(dismissOverlay).not.toHaveBeenCalled()
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('dismisses an app overlay when Escape was not consumed', async () => {
    const dismissOverlay = vi.fn()
    render(<Harness hasOverlay dismissOverlay={dismissOverlay} />)
    const handler = await registeredHandler()

    await act(() => handler({ canGoBack: false }))

    expect(dismissOverlay).toHaveBeenCalledOnce()
  })

  it('uses browser history before app-level navigation', async () => {
    const navigate = vi.fn()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    render(<Harness navigate={navigate} />)
    const handler = await registeredHandler()

    await act(() => handler({ canGoBack: true }))

    expect(back).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('returns to Today before closing from a root history entry', async () => {
    const navigate = vi.fn()
    render(<Harness path="/settings" navigate={navigate} />)
    const handler = await registeredHandler()

    await act(() => handler({ canGoBack: false }))

    expect(navigate).toHaveBeenCalledWith('/today')
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('closes the native window from Today with no history', async () => {
    render(<Harness path="/today" />)
    const handler = await registeredHandler()

    await act(() => handler({ canGoBack: false }))

    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
