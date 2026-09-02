import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileSaverMocks = vi.hoisted(() => ({
  saveUserFile: vi.fn(),
}))

vi.mock('../core/files/UserFileSaver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/files/UserFileSaver')>()
  return { ...actual, saveUserFile: fileSaverMocks.saveUserFile }
})

import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { SettingsPage } from './SettingsPage'

const STORAGE_KEY = 'focus-flow.state.v1'

beforeEach(() => {
  fileSaverMocks.saveUserFile.mockReset()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createSeedState()))
})

describe('Settings native backup export', () => {
  it('routes the portable JSON through the user-file saver and reports completion only after success', async () => {
    const user = userEvent.setup()
    fileSaverMocks.saveUserFile.mockResolvedValue({ status: 'saved', destination: 'native' })
    render(<AppProvider><SettingsPage /></AppProvider>)

    await user.click(await screen.findByRole('button', { name: 'Скачать JSON' }))
    await waitFor(() => expect(fileSaverMocks.saveUserFile).toHaveBeenCalledTimes(1))

    const payload = fileSaverMocks.saveUserFile.mock.calls[0][0]
    expect(payload.fileName).toMatch(/^focus-flow-backup-.*\.json$/)
    expect(payload.mimeType).toBe('application/json')
    const backup = JSON.parse(new TextDecoder().decode(payload.bytes))
    expect(backup.format).toBe('focus-flow')
    expect(backup.data.tasks.length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent('Резервная копия сохранена')
  })

  it('treats closing the Android picker as cancellation rather than a false success', async () => {
    const user = userEvent.setup()
    fileSaverMocks.saveUserFile.mockResolvedValue({ status: 'cancelled', destination: 'native' })
    render(<AppProvider><SettingsPage /></AppProvider>)

    await user.click(await screen.findByRole('button', { name: 'Скачать JSON' }))
    await waitFor(() => expect(fileSaverMocks.saveUserFile).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Резервная копия сохранена')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать JSON' })).toBeEnabled()
  })
})
