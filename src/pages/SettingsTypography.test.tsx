import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { AppProvider } from '../state/AppContext'

const STORAGE_KEY = 'focus-flow.state.v1'

function renderSettings() {
  return render(
    <RouterProvider initialPath="/settings">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

describe('application typography settings', () => {
  it('applies a safe font stack and text scale globally and restores them after reload', async () => {
    const user = userEvent.setup()
    const firstRender = renderSettings()
    await screen.findByRole('heading', { name: 'Настройки', level: 1 })

    await user.selectOptions(screen.getByLabelText('Шрифт интерфейса'), 'readable')
    await user.click(screen.getByRole('button', { name: 'Размер текста 120%' }))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-font-family', 'readable')
      expect(document.documentElement).toHaveAttribute('data-font-scale', '120')
      expect(document.documentElement.style.getPropertyValue('--app-font-family')).toContain('Verdana')
      expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.2')
    })
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      expect(stored.settings).toMatchObject({ fontFamily: 'readable', fontScale: 120 })
    })

    firstRender.unmount()
    renderSettings()

    expect(await screen.findByLabelText('Шрифт интерфейса')).toHaveValue('readable')
    expect(screen.getByRole('button', { name: 'Размер текста 120%' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement).toHaveAttribute('data-font-family', 'readable')
    expect(document.documentElement).toHaveAttribute('data-font-scale', '120')
  })
})
