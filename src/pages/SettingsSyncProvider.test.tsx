import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SyncAdapter, SyncProviderDefinition } from '../core/sync/SyncAdapter'
import { SyncProviderRegistry } from '../core/sync/SyncProviderRegistry'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { SettingsPage } from './SettingsPage'

const STORAGE_KEY = 'focus-flow.state.v1'

describe('Settings sync provider extension point', () => {
  it('renders and connects a configurable interactive provider using only its registry definition', async () => {
    const adapter: SyncAdapter = {
      descriptor: {
        id: 'acme-cloud',
        name: 'Acme Cloud',
        description: 'Second test storage',
        connection: 'interactive',
        consistency: 'atomic',
        configFields: [
          { key: 'endpoint', label: 'Адрес Acme', persistence: 'public', required: true },
          { key: 'region', label: 'Регион Acme', persistence: 'public', defaultValue: 'eu-central' },
        ],
        capabilities: { download: true, upload: true },
      },
      head: vi.fn().mockResolvedValue(null),
      download: vi.fn().mockResolvedValue(null),
      upload: vi.fn().mockResolvedValue({ id: 'acme-file', revision: '1' }),
    }
    const acquireAdapter = vi.fn().mockResolvedValue(adapter)
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const createRuntime = vi.fn(() => ({ acquireAdapter, disconnect }))
    const definition: SyncProviderDefinition = { descriptor: adapter.descriptor, createRuntime }
    const persisted = createSeedState()
    persisted.settings.syncProvider = 'acme-cloud'
    persisted.settings.syncProviderConfigs = { 'acme-cloud': { endpoint: 'https://old.example.test' } }
    persisted.sync = {
      status: 'idle',
      connectionStatus: 'disconnected',
      connectionMode: 'interactive',
      providerId: 'acme-cloud',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SettingsPage />
      </AppProvider>,
    )

    const config = await screen.findByLabelText('Адрес Acme')
    expect(config).toHaveValue('https://old.example.test')
    expect(screen.getByLabelText('Регион Acme')).toHaveValue('eu-central')
    fireEvent.change(config, { target: { value: 'https://new.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Подключить Acme Cloud' }))

    await waitFor(() => expect(createRuntime).toHaveBeenCalledWith({ endpoint: 'https://new.example.test', region: 'eu-central' }))
    expect(acquireAdapter).toHaveBeenCalledWith({ interactive: true, resume: false })
    await screen.findByText('Защищённая копия создана в хранилище')
  })

  it('keeps an interactive provider disconnected until every required field is filled', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'required-cloud',
      name: 'Required Cloud',
      description: 'Provider with required public configuration',
      connection: 'interactive',
      consistency: 'atomic',
      configFields: [{ key: 'endpoint', label: 'Обязательный адрес', persistence: 'public', required: true }],
      capabilities: { download: true, upload: true },
    }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(null),
      download: vi.fn().mockResolvedValue(null),
      upload: vi.fn().mockResolvedValue({ id: 'required-file', revision: '1' }),
    }
    const acquireAdapter = vi.fn().mockResolvedValue(adapter)
    const persisted = createSeedState()
    persisted.settings.syncProvider = descriptor.id
    persisted.settings.syncProviderConfigs = {}
    persisted.sync = {
      status: 'idle',
      connectionStatus: 'disconnected',
      connectionMode: 'interactive',
      providerId: descriptor.id,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter, disconnect: async () => undefined }),
      }])}>
        <SettingsPage />
      </AppProvider>,
    )

    const connect = await screen.findByRole('button', { name: 'Подключить Required Cloud' })
    expect(connect).toBeDisabled()
    expect(screen.getByText('Заполните обязательные параметры хранилища.')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Обязательный адрес'), { target: { value: 'https://required.example.test' } })
    expect(connect).toBeEnabled()
    expect(acquireAdapter).not.toHaveBeenCalled()
  })
})
