import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../../domain/migrations'
import { createSeedState } from '../../domain/seed'
import {
  assertPortableBackupFile,
  createPortableBackup,
  MAX_PORTABLE_BACKUP_BYTES,
  parsePortableBackup,
  PortableBackupError,
} from './PortableBackup'

describe('portable Focus Flow backup', () => {
  it('creates a deterministic versioned JSON file without device-local sync settings', () => {
    const state = createSeedState()
    state.tasks[0].title = 'Уникальная задача из backup'
    state.settings.autoSync = true
    state.settings.syncProvider = 'google-drive'
    state.settings.syncProviderConfigs = { 'google-drive': { endpoint: 'local-only' } }
    state.sync.remoteRevision = 'device-only-revision'

    const backup = createPortableBackup(state, new Date('2026-08-07T09:10:11.000Z'))
    const payload = JSON.parse(backup.contents)

    expect(backup.fileName).toBe('focus-flow-backup-2026-08-07T09-10-11.json')
    expect(payload).toMatchObject({
      format: 'focus-flow',
      formatVersion: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      generatedAt: '2026-08-07T09:10:11.000Z',
    })
    expect(payload.data.tasks[0].title).toBe('Уникальная задача из backup')
    expect(payload.data.tasks.some((task: { attachments: unknown[] }) => task.attachments.length > 0)).toBe(true)
    expect(payload.data).not.toHaveProperty('sync')
    expect(payload.data.settings).not.toHaveProperty('autoSync')
    expect(payload.data.settings).not.toHaveProperty('syncProvider')
    expect(payload.data.settings).not.toHaveProperty('syncProviderConfigs')
  })

  it('reads its envelope and keeps portable application data', () => {
    const state = createSeedState()
    state.settings.theme = 'dark'
    const backup = createPortableBackup(state, new Date('2026-08-07T09:10:11.000Z'))

    const parsed = parsePortableBackup(backup.contents)

    expect(parsed.generatedAt).toBe('2026-08-07T09:10:11.000Z')
    expect(parsed.state.tasks).toEqual(state.tasks)
    expect(parsed.state.projects).toEqual(state.projects)
    expect(parsed.state.habits).toEqual(state.habits)
    expect(parsed.state.settings.theme).toBe('dark')
  })

  it('accepts and migrates a legacy full-state JSON backup', () => {
    const legacy = createSeedState()
    legacy.schemaVersion = 2
    const legacySettings = legacy.settings as unknown as Record<string, unknown>
    delete legacySettings.fontFamily
    delete legacySettings.fontScale

    const parsed = parsePortableBackup(JSON.stringify(legacy))

    expect(parsed.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(parsed.state.settings.fontFamily).toBe('system')
    expect(parsed.state.settings.fontScale).toBe(100)
  })

  it.each([
    ['empty', '   ', 'empty'],
    ['broken JSON', '{broken', 'invalid-json'],
    ['wrong shape', JSON.stringify({ hello: 'world' }), 'invalid-backup'],
    ['future schema', JSON.stringify({ ...createSeedState(), schemaVersion: 99 }), 'newer-version'],
  ])('rejects %s before it can be applied', (_label, contents, code) => {
    expect(() => parsePortableBackup(contents)).toThrow(expect.objectContaining({
      name: 'PortableBackupError',
      code,
    }))
  })

  it('rejects a remote background URL instead of loading it from an imported file', () => {
    const backup = createPortableBackup(createSeedState())
    const payload = JSON.parse(backup.contents)
    payload.data.settings.backgroundPreset = 'custom'
    payload.data.settings.customBackgroundDataUrl = 'https://tracking.example/background.png'

    expect(() => parsePortableBackup(JSON.stringify(payload))).toThrow(expect.objectContaining({
      code: 'invalid-backup',
    }))
  })

  it('checks extension and byte limit before reading a selected file', () => {
    expect(() => assertPortableBackupFile({ name: 'backup.txt', size: 10 })).toThrow(expect.objectContaining({
      code: 'wrong-file-type',
    }))
    expect(() => assertPortableBackupFile({ name: 'backup.json', size: MAX_PORTABLE_BACKUP_BYTES + 1 })).toThrow(
      expect.objectContaining({ code: 'too-large' }),
    )
    expect(() => assertPortableBackupFile({ name: 'BACKUP.JSON', size: MAX_PORTABLE_BACKUP_BYTES })).not.toThrow()
  })

  it('does not download a file that would exceed its own import limit', () => {
    const state = createSeedState()
    state.tasks[0].description = 'x'.repeat(MAX_PORTABLE_BACKUP_BYTES)

    expect(() => createPortableBackup(state)).toThrow(expect.objectContaining({ code: 'too-large' }))
  })

  it('exposes typed, user-safe validation errors', () => {
    try {
      parsePortableBackup('{')
      throw new Error('Expected parsing to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PortableBackupError)
      expect((error as PortableBackupError).message).not.toContain('SyntaxError')
    }
  })
})
