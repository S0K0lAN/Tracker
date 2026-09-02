import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../../domain/migrations'
import type { AppState } from '../../domain/models'
import { createSeedState } from '../../domain/seed'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { TauriJsonStorageAdapter } from './TauriJsonStorageAdapter'
import {
  TauriStorageBridgeError,
  type TauriStorageBridge,
  type TauriStorageCommitMode,
  type TauriStorageSlot,
} from './TauriStorageBridge'
import { createDefaultStorageAdapter } from './createDefaultStorageAdapter'

class MemoryTauriStorageBridge implements TauriStorageBridge {
  readonly slots: Record<TauriStorageSlot, string | null> = {
    primary: null,
    backup: null,
    importBackup: null,
  }
  readonly commits: Array<{ mode: TauriStorageCommitMode; stateJson: string }> = []
  readonly quarantined: TauriStorageSlot[] = []
  readonly readErrors = new Map<TauriStorageSlot, unknown>()
  readonly quarantineFailures = new Set<TauriStorageSlot>()
  recoverCalls = 0
  clearCalls = 0

  async read(slot: TauriStorageSlot) {
    const error = this.readErrors.get(slot)
    if (error) throw error
    return this.slots[slot]
  }

  async commit(mode: TauriStorageCommitMode, stateJson: string) {
    this.commits.push({ mode, stateJson })
    const previous = this.slots.primary
    if (previous !== null) {
      this.slots.backup = previous
      if (mode === 'replaceWithBackup') this.slots.importBackup = previous
    }
    this.slots.primary = stateJson
  }

  async recoverPrimaryFromBackup() {
    this.recoverCalls += 1
    if (this.slots.backup === null) throw new Error('backup missing')
    this.slots.primary = this.slots.backup
  }

  async quarantine(slot: TauriStorageSlot) {
    if (this.quarantineFailures.has(slot)) return false
    if (this.slots[slot] === null && !this.readErrors.has(slot)) return false
    this.quarantined.push(slot)
    this.slots[slot] = null
    this.readErrors.delete(slot)
    return true
  }

  async clear() {
    this.clearCalls += 1
    this.slots.primary = null
    this.slots.backup = null
    this.slots.importBackup = null
  }
}

function serializedState(title = 'Локальная версия') {
  const state = createSeedState()
  state.tasks[0].title = title
  return JSON.stringify(state)
}

describe('TauriJsonStorageAdapter', () => {
  it('loads, validates and migrates a hydrated native snapshot at the TypeScript boundary', async () => {
    const bridge = new MemoryTauriStorageBridge()
    const legacy = createSeedState() as AppState & { schemaVersion: number }
    legacy.schemaVersion = 9
    delete legacy.tasks[0].allDayDate
    bridge.slots.primary = JSON.stringify(legacy)

    const loaded = await new TauriJsonStorageAdapter(bridge).load()

    expect(loaded?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(bridge.commits).toHaveLength(0)
  })

  it('validates before IPC and sends an immutable JSON snapshot with the requested commit mode', async () => {
    const bridge = new MemoryTauriStorageBridge()
    const adapter = new TauriJsonStorageAdapter(bridge)
    const state = createSeedState()

    await adapter.save(state)
    state.tasks[0].title = 'Изменено после вызова'
    await adapter.replaceWithBackup(createSeedState())

    expect(bridge.commits.map(({ mode }) => mode)).toEqual(['save', 'replaceWithBackup'])
    expect(JSON.parse(bridge.commits[0].stateJson).tasks[0].title).not.toBe('Изменено после вызова')
  })

  it('rejects an invalid current state without invoking native storage', async () => {
    const bridge = new MemoryTauriStorageBridge()
    const damaged = createSeedState()
    ;(damaged.tasks[0] as unknown as { attachments: string }).attachments = 'broken'

    await expect(new TauriJsonStorageAdapter(bridge).save(damaged)).rejects.toThrow(/attachments/)
    expect(bridge.commits).toHaveLength(0)
  })

  it('quarantines a corrupt primary and restores a valid regular backup', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = '{broken'
    bridge.slots.backup = serializedState('Восстановлено')

    const loaded = await new TauriJsonStorageAdapter(bridge).load()

    expect(loaded?.tasks[0].title).toBe('Восстановлено')
    expect(bridge.quarantined).toContain('primary')
    expect(bridge.recoverCalls).toBe(1)
    expect(JSON.parse(bridge.slots.primary!).tasks[0].title).toBe('Восстановлено')
  })

  it('recovers from a valid backup even if diagnostic quarantine is unavailable', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = '{broken'
    bridge.slots.backup = serializedState('Без quarantine')
    bridge.quarantineFailures.add('primary')

    const loaded = await new TauriJsonStorageAdapter(bridge).load()

    expect(loaded?.tasks[0].title).toBe('Без quarantine')
    expect(bridge.recoverCalls).toBe(1)
  })

  it('quarantines both corrupt snapshots only after neither can be recovered', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = '{broken-primary'
    bridge.slots.backup = '{broken-backup'

    await expect(new TauriJsonStorageAdapter(bridge).load()).resolves.toBeNull()
    expect(bridge.quarantined).toEqual(expect.arrayContaining(['primary', 'backup']))
    expect(bridge.recoverCalls).toBe(0)
  })

  it('preserves corrupt sources when either quarantine cannot be completed', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = '{broken-primary'
    bridge.slots.backup = '{broken-backup'
    bridge.quarantineFailures.add('backup')

    await expect(new TauriJsonStorageAdapter(bridge).load()).rejects.toThrow(/повреждённый snapshot/)
  })

  it('does not quarantine or downgrade a future application schema', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = JSON.stringify({ ...createSeedState(), schemaVersion: 999 })
    bridge.slots.backup = serializedState('Старая резервная копия')

    await expect(new TauriJsonStorageAdapter(bridge).load()).rejects.toThrow(/newer than supported/)
    expect(bridge.quarantined).toHaveLength(0)
    expect(bridge.recoverCalls).toBe(0)
  })

  it('does not treat unsupported native formats or I/O errors as recoverable corruption', async () => {
    for (const error of [
      new TauriStorageBridgeError('unsupported-version', 'new native format'),
      new TauriStorageBridgeError('io', 'permission denied'),
    ]) {
      const bridge = new MemoryTauriStorageBridge()
      bridge.readErrors.set('primary', error)
      bridge.slots.backup = serializedState('Не использовать')

      await expect(new TauriJsonStorageAdapter(bridge).load()).rejects.toBe(error)
      expect(bridge.quarantined).toHaveLength(0)
      expect(bridge.recoverCalls).toBe(0)
    }
  })

  it('recovers when native hydration reports corrupt attachment data', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.readErrors.set('primary', new TauriStorageBridgeError('invalid-data', 'blob hash mismatch'))
    bridge.slots.backup = serializedState('Вложение из backup')

    const loaded = await new TauriJsonStorageAdapter(bridge).load()

    expect(loaded?.tasks[0].title).toBe('Вложение из backup')
    expect(bridge.recoverCalls).toBe(1)
  })

  it('quarantines an invalid import backup and never changes the primary', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = serializedState('Основная')
    bridge.slots.importBackup = '{broken-import'

    await expect(new TauriJsonStorageAdapter(bridge).loadImportBackup()).resolves.toBeNull()
    expect(bridge.quarantined).toEqual(['importBackup'])
    expect(JSON.parse(bridge.slots.primary!).tasks[0].title).toBe('Основная')
  })

  it('restores an import backup through the same replacement transaction', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = serializedState('После импорта')
    bridge.slots.importBackup = serializedState('До импорта')
    const adapter = new TauriJsonStorageAdapter(bridge)

    const restored = await adapter.restoreImportBackup()

    expect(restored?.tasks[0].title).toBe('До импорта')
    expect(JSON.parse(bridge.slots.primary!).tasks[0].title).toBe('До импорта')
    expect(JSON.parse(bridge.slots.importBackup!).tasks[0].title).toBe('После импорта')
  })

  it('clears through the native bridge', async () => {
    const bridge = new MemoryTauriStorageBridge()
    bridge.slots.primary = serializedState()

    await new TauriJsonStorageAdapter(bridge).clear()

    expect(bridge.clearCalls).toBe(1)
    expect(bridge.slots.primary).toBeNull()
  })
})

describe('createDefaultStorageAdapter', () => {
  it('keeps browser storage as the default outside Tauri', () => {
    expect(createDefaultStorageAdapter(false)).toBeInstanceOf(LocalStorageAdapter)
  })

  it('selects private JSON storage inside Tauri', () => {
    expect(createDefaultStorageAdapter(true)).toBeInstanceOf(TauriJsonStorageAdapter)
  })
})
