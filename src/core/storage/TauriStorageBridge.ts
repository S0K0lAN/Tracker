export type TauriStorageSlot = 'primary' | 'backup' | 'importBackup'
export type TauriStorageCommitMode = 'save' | 'replaceWithBackup'

export interface TauriStorageBridge {
  read(slot: TauriStorageSlot): Promise<string | null>
  commit(mode: TauriStorageCommitMode, stateJson: string): Promise<void>
  recoverPrimaryFromBackup(): Promise<void>
  quarantine(slot: TauriStorageSlot): Promise<boolean>
  clear(): Promise<void>
}

export class TauriStorageBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'TauriStorageBridgeError'
  }
}

/**
 * Keeps the Tauri IPC implementation behind the storage contract. The dynamic
 * import means browser builds can instantiate their LocalStorage adapter
 * without touching Tauri globals at module evaluation time.
 */
export class InvokeTauriStorageBridge implements TauriStorageBridge {
  async read(slot: TauriStorageSlot): Promise<string | null> {
    return invokeStorageCommand('focus_flow_storage_read', { slot })
  }

  async commit(mode: TauriStorageCommitMode, stateJson: string): Promise<void> {
    await invokeStorageCommand('focus_flow_storage_commit', { mode, stateJson })
  }

  async recoverPrimaryFromBackup(): Promise<void> {
    await invokeStorageCommand('focus_flow_storage_recover_primary')
  }

  async quarantine(slot: TauriStorageSlot): Promise<boolean> {
    return invokeStorageCommand('focus_flow_storage_quarantine', { slot })
  }

  async clear(): Promise<void> {
    await invokeStorageCommand('focus_flow_storage_clear')
  }
}

async function invokeStorageCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<T>(command, args)
  } catch (error) {
    throw normalizeInvokeError(error)
  }
}

function normalizeInvokeError(error: unknown): TauriStorageBridgeError {
  if (error instanceof TauriStorageBridgeError) return error
  if (isErrorPayload(error)) {
    return new TauriStorageBridgeError(error.code, error.message, error)
  }
  if (typeof error === 'string') {
    try {
      const payload: unknown = JSON.parse(error)
      if (isErrorPayload(payload)) {
        return new TauriStorageBridgeError(payload.code, payload.message, error)
      }
    } catch {
      // Plain string rejections are still useful as a diagnostic message.
    }
    return new TauriStorageBridgeError('io', error, error)
  }
  return new TauriStorageBridgeError(
    'io',
    error instanceof Error ? error.message : 'Native storage command failed',
    error,
  )
}

function isErrorPayload(value: unknown): value is { code: string; message: string } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { message?: unknown }).message === 'string'
}
