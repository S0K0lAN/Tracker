import {
  assertCurrentAppState,
  parseStoredAppState,
  UnsupportedSchemaVersionError,
} from '../../domain/migrations'
import type { AppState } from '../../domain/models'
import type { StorageAdapter } from './StorageAdapter'
import {
  InvokeTauriStorageBridge,
  TauriStorageBridgeError,
  type TauriStorageBridge,
  type TauriStorageSlot,
} from './TauriStorageBridge'

class NativeSnapshotValidationError extends Error {
  constructor(readonly cause: unknown) {
    super('Native snapshot is invalid')
    this.name = 'NativeSnapshotValidationError'
  }
}

function quarantineFailedError() {
  return new Error('Не удалось сохранить повреждённый snapshot для ручного восстановления')
}

export class TauriJsonStorageAdapter implements StorageAdapter {
  constructor(private readonly bridge: TauriStorageBridge = new InvokeTauriStorageBridge()) {}

  async load(): Promise<AppState | null> {
    try {
      return await this.readSlot('primary')
    } catch (primaryError) {
      if (isUnsupportedVersion(primaryError) || !isRecoverableCorruption(primaryError)) {
        throw primaryError
      }

      let backup: AppState | null
      try {
        backup = await this.readSlot('backup')
      } catch (backupError) {
        if (isUnsupportedVersion(backupError) || !isRecoverableCorruption(backupError)) {
          throw backupError
        }
        const [primaryQuarantined, backupQuarantined] = await Promise.all([
          this.tryQuarantine('primary'),
          this.tryQuarantine('backup'),
        ])
        if (!primaryQuarantined || !backupQuarantined) throw quarantineFailedError()
        return null
      }

      if (!backup) {
        if (!await this.tryQuarantine('primary')) throw quarantineFailedError()
        return null
      }

      // A valid backup is authoritative recovery material. Diagnostic
      // quarantine is best-effort and must not prevent restoring it.
      await this.tryQuarantine('primary')
      await this.bridge.recoverPrimaryFromBackup()
      return backup
    }
  }

  async loadImportBackup(): Promise<AppState | null> {
    try {
      return await this.readSlot('importBackup')
    } catch (error) {
      if (isUnsupportedVersion(error) || !isRecoverableCorruption(error)) throw error
      if (!await this.tryQuarantine('importBackup')) throw quarantineFailedError()
      return null
    }
  }

  async save(state: AppState): Promise<void> {
    await this.commit('save', state)
  }

  async replaceWithBackup(state: AppState): Promise<void> {
    await this.commit('replaceWithBackup', state)
  }

  async restoreImportBackup(): Promise<AppState | null> {
    const restored = await this.loadImportBackup()
    if (!restored) return null
    await this.replaceWithBackup(restored)
    return restored
  }

  async clear(): Promise<void> {
    await this.bridge.clear()
  }

  private async commit(mode: 'save' | 'replaceWithBackup', state: AppState): Promise<void> {
    // Validate before crossing IPC, then stringify immediately so subsequent
    // caller mutations cannot alter the snapshot being written.
    assertCurrentAppState(state)
    const stateJson = JSON.stringify(state)
    await this.bridge.commit(mode, stateJson)
  }

  private async readSlot(slot: TauriStorageSlot): Promise<AppState | null> {
    let raw: string | null
    try {
      raw = await this.bridge.read(slot)
    } catch (error) {
      throw error
    }
    if (raw === null) return null
    try {
      return parseStoredAppState(JSON.parse(raw))
    } catch (error) {
      if (error instanceof UnsupportedSchemaVersionError) throw error
      throw new NativeSnapshotValidationError(error)
    }
  }

  private async tryQuarantine(slot: TauriStorageSlot): Promise<boolean> {
    try {
      return await this.bridge.quarantine(slot)
    } catch {
      return false
    }
  }
}

function isUnsupportedVersion(error: unknown) {
  return error instanceof UnsupportedSchemaVersionError
    || (error instanceof TauriStorageBridgeError && error.code === 'unsupported-version')
}

function isRecoverableCorruption(error: unknown) {
  return error instanceof NativeSnapshotValidationError
    || (error instanceof TauriStorageBridgeError
      && (error.code === 'invalid-data' || error.code === 'too-large'))
}
