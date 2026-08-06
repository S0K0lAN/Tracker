import { describe, expect, it, vi } from 'vitest'
import { createSeedState } from '../../domain/seed'
import { LocalStorageAdapter } from './LocalStorageAdapter'

const STORAGE_KEY = 'focus-flow.state.v1'
const BACKUP_KEY = 'focus-flow.state.v1.backup'
const IMPORT_BACKUP_KEY = 'focus-flow.state.v1.import-backup'
const CORRUPT_KEY = 'focus-flow.state.v1.corrupt'

describe('LocalStorageAdapter remote import safety', () => {
  it('keeps a dedicated recoverable copy before replacing local data', async () => {
    const adapter = new LocalStorageAdapter()
    const local = createSeedState()
    const remote = createSeedState()
    local.tasks[0].title = 'Локальная версия'
    remote.tasks[0].title = 'Удалённая версия'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    await adapter.replaceWithBackup(remote)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Удалённая версия')
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!).tasks[0].title).toBe('Локальная версия')
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('Локальная версия')
  })

  it('leaves the primary and prior rollback copy intact when an imported snapshot cannot be saved', async () => {
    const adapter = new LocalStorageAdapter()
    const local = createSeedState()
    const priorRollback = createSeedState()
    const imported = createSeedState()
    local.tasks[0].title = 'Текущая версия'
    priorRollback.tasks[0].title = 'Прежняя rollback-копия'
    imported.tasks[0].title = 'Новый импорт'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(priorRollback))
    const originalPrimary = localStorage.getItem(STORAGE_KEY)
    const originalRollback = localStorage.getItem(IMPORT_BACKUP_KEY)
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === STORAGE_KEY && value.includes('Новый импорт')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    })

    await expect(adapter.replaceWithBackup(imported)).rejects.toThrow('Quota exceeded')
    setItem.mockRestore()

    expect(localStorage.getItem(STORAGE_KEY)).toBe(originalPrimary)
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBe(originalRollback)
  })

  it('restores the pre-import copy and keeps the replaced state available for undo', async () => {
    const adapter = new LocalStorageAdapter()
    const local = createSeedState()
    const remote = createSeedState()
    local.tasks[0].title = 'До импорта'
    remote.tasks[0].title = 'После импорта'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    await adapter.replaceWithBackup(remote)

    const restored = await adapter.restoreImportBackup()

    expect(restored?.tasks[0].title).toBe('До импорта')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('До импорта')
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('После импорта')
  })

  it('recovers a damaged primary snapshot from the regular backup', async () => {
    const adapter = new LocalStorageAdapter()
    const backup = createSeedState()
    backup.tasks[0].title = 'Восстановлено'
    localStorage.setItem(STORAGE_KEY, '{broken')
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup))

    const loaded = await adapter.load()

    expect(loaded?.tasks[0].title).toBe('Восстановлено')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Восстановлено')
    expect(localStorage.getItem(CORRUPT_KEY)).toBe('{broken')
  })

  it('recovers semantic corruption instead of replacing it with demo data', async () => {
    const adapter = new LocalStorageAdapter()
    const backup = createSeedState()
    backup.tasks[0].title = 'Безопасная копия'
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, tasks: 'broken' }))
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup))

    const loaded = await adapter.load()

    expect(loaded?.tasks[0].title).toBe('Безопасная копия')
  })

  it('does not downgrade or overwrite a snapshot from a newer app version', async () => {
    const adapter = new LocalStorageAdapter()
    const future = { ...createSeedState(), schemaVersion: 99 }
    const serialized = JSON.stringify(future)
    localStorage.setItem(STORAGE_KEY, serialized)
    localStorage.setItem(BACKUP_KEY, JSON.stringify(createSeedState()))

    await expect(adapter.load()).rejects.toThrow(/newer than supported/)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(serialized)
  })

  it('uses backup when a current-schema snapshot would silently drop nested data', async () => {
    const adapter = new LocalStorageAdapter()
    const damaged = createSeedState()
    ;(damaged.tasks[0] as unknown as { attachments: string }).attachments = 'not-an-array'
    const backup = createSeedState()
    backup.tasks[0].title = 'Структурно целая копия'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(damaged))
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup))

    const loaded = await adapter.load()

    expect(loaded?.tasks[0].title).toBe('Структурно целая копия')
    expect(localStorage.getItem(CORRUPT_KEY)).toContain('not-an-array')
  })

  it('quarantines invalid nested collection elements before they can replace a good backup', async () => {
    const adapter = new LocalStorageAdapter()
    const damaged = createSeedState()
    damaged.savedFilters.push({
      id: 'damaged-filter',
      name: 'Повреждённый фильтр',
      query: '',
      tags: ['до повреждения'],
      tagMode: 'any',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    ;(damaged.savedFilters[0] as unknown as { tags: string }).tags = 'broken'
    const backup = createSeedState()
    backup.tasks[0].title = 'Глубоко проверенная копия'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(damaged))
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup))

    const loaded = await adapter.load()

    expect(loaded?.tasks[0].title).toBe('Глубоко проверенная копия')
    expect(localStorage.getItem(CORRUPT_KEY)).toContain('Повреждённый фильтр')
  })

  it('keeps the rollback source intact when restoring the import backup fails', async () => {
    const adapter = new LocalStorageAdapter()
    const beforeImport = createSeedState()
    const afterImport = createSeedState()
    beforeImport.tasks[0].title = 'До импорта'
    afterImport.tasks[0].title = 'После импорта'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beforeImport))
    await adapter.replaceWithBackup(afterImport)
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === STORAGE_KEY && value.includes('До импорта')) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })

    await expect(adapter.restoreImportBackup()).rejects.toThrow('Quota exceeded')
    setItem.mockRestore()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('После импорта')
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('До импорта')
  })

  it('does not change the primary when the rollback swap fails on an auxiliary copy', async () => {
    const adapter = new LocalStorageAdapter()
    const beforeImport = createSeedState()
    const afterImport = createSeedState()
    beforeImport.tasks[0].title = 'До импорта'
    afterImport.tasks[0].title = 'После импорта'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beforeImport))
    await adapter.replaceWithBackup(afterImport)
    const primaryBeforeRestore = localStorage.getItem(STORAGE_KEY)
    const backupBeforeRestore = localStorage.getItem(BACKUP_KEY)
    const importBeforeRestore = localStorage.getItem(IMPORT_BACKUP_KEY)
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === IMPORT_BACKUP_KEY && value.includes('После импорта')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    })

    await expect(adapter.restoreImportBackup()).rejects.toThrow('Quota exceeded')
    setItem.mockRestore()

    expect(localStorage.getItem(STORAGE_KEY)).toBe(primaryBeforeRestore)
    expect(localStorage.getItem(BACKUP_KEY)).toBe(backupBeforeRestore)
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBe(importBeforeRestore)
  })

  it('clears primary and both backup snapshots', async () => {
    const adapter = new LocalStorageAdapter()
    localStorage.setItem(STORAGE_KEY, '{}')
    localStorage.setItem(BACKUP_KEY, '{}')
    localStorage.setItem(IMPORT_BACKUP_KEY, '{}')

    await adapter.clear()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBeNull()
  })
})
