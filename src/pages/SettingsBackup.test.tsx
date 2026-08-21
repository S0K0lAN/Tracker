import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPortableBackup } from '../core/storage/PortableBackup'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { SettingsPage } from './SettingsPage'

const STORAGE_KEY = 'focus-flow.state.v1'
const IMPORT_BACKUP_KEY = 'focus-flow.state.v1.import-backup'
const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

afterEach(() => {
  vi.restoreAllMocks()
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl })
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl })
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('Settings portable backup', () => {
  it('downloads a timestamped JSON file through an observable browser download', async () => {
    const state = createSeedState()
    state.tasks[0].title = 'Задача для скачивания'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const createObjectUrl = vi.fn(() => 'blob:focus-flow-backup')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    let downloadedName = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download
    })

    render(<AppProvider><SettingsPage /></AppProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Скачать JSON' }))

    expect(createObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/json;charset=utf-8' }))
    expect(downloadedName).toMatch(/^focus-flow-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/)
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:focus-flow-backup'))
    expect(screen.getByRole('status')).toHaveTextContent('Резервная копия скачана')
  })

  it('previews without mutation, supports cancel/reselect, imports, and restores the prior copy', async () => {
    const local = createSeedState()
    local.tasks[0].title = 'Локальная задача до импорта'
    const imported = createSeedState()
    imported.tasks[0].title = 'Задача из выбранного файла'
    imported.tasks[0].updatedAt = '2099-08-07T09:10:11.000Z'
    imported.tasks[1].title = 'Задача из выбранного файла'
    imported.tasks[1].updatedAt = '2098-08-07T09:10:11.000Z'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    const backup = createPortableBackup(imported, new Date('2026-08-07T09:10:11.000Z'))
    const file = new File([backup.contents], 'my-focus-flow.json', { type: 'application/json' })

    render(<AppProvider><SettingsPage /></AppProvider>)
    const trigger = await screen.findByRole('button', { name: 'Выбрать JSON-файл' })
    const input = screen.getByLabelText('Файл резервной копии') as HTMLInputElement
    const primaryBeforePreview = localStorage.getItem(STORAGE_KEY)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    fireEvent.change(input, { target: { files: [file] } })
    let dialog = await screen.findByRole('dialog', { name: 'Импортировать резервную копию?' })
    expect(dialog).toHaveTextContent('my-focus-flow.json')
    expect(dialog).toHaveTextContent(`${imported.tasks.length} задач`)
    expect(within(dialog).getAllByText('Задача из выбранного файла')).toHaveLength(2)
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(primaryBeforePreview)
    expect(input.value).toBe('')
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(localStorage.getItem(STORAGE_KEY)).toBe(primaryBeforePreview)

    fireEvent.change(input, { target: { files: [file] } })
    dialog = await screen.findByRole('dialog', { name: 'Импортировать резервную копию?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Импортировать и заменить' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Задача из выбранного файла')
    })
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('Локальная задача до импорта')
    expect(screen.getByRole('status')).toHaveTextContent('Резервная копия импортирована')
    expect(screen.getByText('Предыдущая локальная копия')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }))
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Локальная задача до импорта')
    })
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('Задача из выбранного файла')
  })

  it('rejects malformed JSON without opening confirmation or mutating either copy', async () => {
    const local = createSeedState()
    const rollback = createSeedState()
    rollback.tasks[0].title = 'Существующая rollback-копия'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(rollback))
    const originalPrimary = localStorage.getItem(STORAGE_KEY)
    const originalRollback = localStorage.getItem(IMPORT_BACKUP_KEY)

    render(<AppProvider><SettingsPage /></AppProvider>)
    const input = await screen.findByLabelText('Файл резервной копии')
    fireEvent.change(input, {
      target: { files: [new File(['{broken'], 'broken.json', { type: 'application/json' })] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Файл содержит некорректный JSON')
    expect(screen.queryByRole('dialog', { name: 'Импортировать резервную копию?' })).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(originalPrimary)
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBe(originalRollback)
  })

  it('closes the preview with Escape and returns focus to the file button', async () => {
    const backup = createPortableBackup(createSeedState())
    render(<AppProvider><SettingsPage /></AppProvider>)
    const trigger = await screen.findByRole('button', { name: 'Выбрать JSON-файл' })
    fireEvent.change(screen.getByLabelText('Файл резервной копии'), {
      target: { files: [new File([backup.contents], 'backup.json', { type: 'application/json' })] },
    })
    const dialog = await screen.findByRole('dialog', { name: 'Импортировать резервную копию?' })

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('requires an explicit reset confirmation and offers undo from the preserved local copy', async () => {
    const user = userEvent.setup()
    const local = createSeedState()
    local.tasks[0].title = 'Личные данные перед сбросом'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(<AppProvider><SettingsPage /></AppProvider>)
    const reset = await screen.findByRole('button', { name: 'Сбросить' })
    await user.click(reset)

    expect(screen.getByRole('group', { name: 'Подтверждение сброса демо-данных' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Личные данные перед сбросом')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Точно сбросить' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сбросить' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сбросить' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Сбросить' }))
    await user.click(screen.getByRole('button', { name: 'Точно сбросить' }))

    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Подготовить план недели'))
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('Личные данные перед сбросом')
    expect(screen.getByRole('status')).toHaveTextContent('Предыдущие локальные данные сохранены')

    fireEvent.click(screen.getByRole('button', { name: 'Отменить сброс' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Личные данные перед сбросом'))
  })

  it.each(['light', 'dark'] as const)('enforces the safe custom-background overlay in the %s theme', async (theme) => {
    const state = createSeedState()
    state.settings.theme = theme
    state.settings.backgroundPreset = 'custom'
    state.settings.customBackgroundDataUrl = 'data:image/png;base64,AAAA'
    state.settings.backgroundDim = 10
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<AppProvider><SettingsPage /></AppProvider>)
    const dim = await screen.findByRole('slider', { name: 'Затемнение фона' })

    expect(dim).toHaveAttribute('min', '65')
    expect(dim).toHaveValue('65')
    expect(document.documentElement.style.getPropertyValue('--background-dim')).toBe('0.65')
  })

  it('describes plugins as a disabled experimental in-process scaffold', async () => {
    render(<AppProvider><SettingsPage /></AppProvider>)
    await screen.findByRole('heading', { name: 'Расширения' })

    expect(screen.getByText('Сторонние расширения отключены')).toBeInTheDocument()
    expect(screen.queryByText('API v1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Контракты \(внутренние\)/ }))
    expect(screen.getByText(/Это внутренние экспериментальные slots, а не публичный API/)).toBeInTheDocument()
  })
})
