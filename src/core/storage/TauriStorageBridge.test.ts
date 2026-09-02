import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  isTauri: () => false,
}))

import { InvokeTauriStorageBridge, TauriStorageBridgeError } from './TauriStorageBridge'

describe('InvokeTauriStorageBridge', () => {
  beforeEach(() => invoke.mockReset())

  it('uses fixed commands and passes only typed slots, modes and snapshot JSON', async () => {
    invoke
      .mockResolvedValueOnce('{"schemaVersion":10}')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined)
    const bridge = new InvokeTauriStorageBridge()

    await expect(bridge.read('primary')).resolves.toBe('{"schemaVersion":10}')
    await bridge.commit('save', '{"schemaVersion":10}')
    await bridge.recoverPrimaryFromBackup()
    await expect(bridge.quarantine('backup')).resolves.toBe(true)
    await bridge.clear()

    expect(invoke.mock.calls).toEqual([
      ['focus_flow_storage_read', { slot: 'primary' }],
      ['focus_flow_storage_commit', { mode: 'save', stateJson: '{"schemaVersion":10}' }],
      ['focus_flow_storage_recover_primary', undefined],
      ['focus_flow_storage_quarantine', { slot: 'backup' }],
      ['focus_flow_storage_clear', undefined],
    ])
  })

  it('preserves structured native error codes', async () => {
    invoke.mockRejectedValueOnce({ code: 'invalid-data', message: 'blob is missing' })

    await expect(new InvokeTauriStorageBridge().read('primary')).rejects.toEqual(
      expect.objectContaining<TauriStorageBridgeError>({
        name: 'TauriStorageBridgeError',
        code: 'invalid-data',
        message: 'blob is missing',
      }),
    )
  })

  it('normalizes plain and JSON-encoded command rejections', async () => {
    invoke.mockRejectedValueOnce(JSON.stringify({ code: 'too-large', message: 'limit' }))
    await expect(new InvokeTauriStorageBridge().read('backup')).rejects.toMatchObject({
      code: 'too-large',
      message: 'limit',
    })

    invoke.mockRejectedValueOnce('permission denied')
    await expect(new InvokeTauriStorageBridge().clear()).rejects.toMatchObject({
      code: 'io',
      message: 'permission denied',
    })
  })
})
