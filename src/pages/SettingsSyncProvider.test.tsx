import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationProvider } from '../core/auth/AuthorizationProvider'
import { createRemoteEnvelope } from '../core/sync/RemoteSnapshot'
import { createGoogleDriveProviderDefinition } from '../core/sync/providers'
import type { SyncAdapter, SyncProviderDefinition } from '../core/sync/SyncAdapter'
import { SyncProviderRegistry } from '../core/sync/SyncProviderRegistry'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { SettingsPage } from './SettingsPage'

const STORAGE_KEY = 'focus-flow.state.v1'

describe('Settings sync provider extension point', () => {
  it('shows one Google authorization button without exposing a client ID field', async () => {
    const definition = createGoogleDriveProviderDefinition({
      defaultClientId: 'build-client.apps.googleusercontent.com',
      createAuthorization: vi.fn(),
      createAdapter: vi.fn(),
    })
    const persisted = createSeedState()
    persisted.settings.syncProvider = 'google-drive'
    persisted.settings.syncProviderConfigs = {
      'google-drive': { clientId: 'legacy-client.apps.googleusercontent.com' },
    }
    persisted.sync = {
      status: 'idle',
      connectionStatus: 'disconnected',
      connectionMode: 'interactive',
      providerId: 'google-drive',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SettingsPage />
      </AppProvider>,
    )

    expect(screen.queryByLabelText('Google OAuth Client ID')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Войти через Google' })).toBeEnabled()
  })

  it('explains a missing build configuration without asking the user for a client ID', async () => {
    const createAuthorization = vi.fn((): AuthorizationProvider => ({
      connect: vi.fn(),
      getSession: vi.fn().mockReturnValue(null),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }))
    const definition = createGoogleDriveProviderDefinition({
      defaultClientId: '',
      createAuthorization,
      createAdapter: vi.fn(),
    })
    const persisted = createSeedState()
    persisted.settings.syncProvider = 'google-drive'
    persisted.sync = {
      status: 'idle',
      connectionStatus: 'disconnected',
      connectionMode: 'interactive',
      providerId: 'google-drive',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SettingsPage />
      </AppProvider>,
    )

    expect(screen.queryByLabelText('Google OAuth Client ID')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Войти через Google' }))

    expect(await screen.findByText(/Вход через Google не настроен в этой сборке/)).toBeVisible()
    expect(createAuthorization).not.toHaveBeenCalled()
  })

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
    await screen.findByText(/Выберите действие с данными/)
    expect(adapter.head).not.toHaveBeenCalled()
    expect(adapter.download).not.toHaveBeenCalled()
    expect(adapter.upload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Синхронизировать данные с Acme Cloud' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Получить данные из Acme Cloud' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить локальные данные в Acme Cloud' }))
    await screen.findByText('Защищённая копия создана в хранилище')
    expect(adapter.upload).toHaveBeenCalledWith(expect.anything(), { expectedRevision: null })
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

  it('offers three accessible actions and blocks them while a conflict awaits a decision', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'three-actions-cloud',
      name: 'Three Actions Cloud',
      description: 'Provider with independent actions',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const persisted = createSeedState()
    persisted.settings.syncProvider = descriptor.id
    persisted.settings.autoSync = false
    persisted.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: descriptor.id,
    }
    const remote = createSeedState()
    remote.tasks[0].title = 'Другая копия в облаке'
    const head = { id: 'three-actions-file', revision: '1' }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(head),
      download: vi.fn().mockResolvedValue({ head, payload: createRemoteEnvelope(remote) }),
      upload: vi.fn(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SettingsPage />
      </AppProvider>,
    )

    const reconcile = await screen.findByRole('button', { name: 'Синхронизировать данные с Three Actions Cloud' })
    const pull = screen.getByRole('button', { name: 'Получить данные из Three Actions Cloud' })
    const push = screen.getByRole('button', { name: 'Отправить локальные данные в Three Actions Cloud' })
    expect(reconcile).toBeEnabled()
    expect(pull).toBeEnabled()
    expect(push).toBeEnabled()

    fireEvent.click(pull)
    expect(await screen.findByRole('alert', { name: 'Конфликт синхронизации' })).toBeVisible()
    expect(reconcile).toBeDisabled()
    expect(pull).toBeDisabled()
    expect(push).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Получить копию из хранилища' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Заменить копию локальными данными' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(reconcile).toBeEnabled())

    fireEvent.click(push)
    expect(await screen.findByRole('alert', { name: 'Конфликт синхронизации' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Получить копию из хранилища' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Заменить копию локальными данными' })).toBeVisible()
  })
})
