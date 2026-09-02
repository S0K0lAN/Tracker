import { isTauri } from '@tauri-apps/api/core'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import type { StorageAdapter } from './StorageAdapter'
import { TauriJsonStorageAdapter } from './TauriJsonStorageAdapter'

/** Selects native private-file storage only inside a real Tauri runtime. */
export function createDefaultStorageAdapter(tauriRuntime = isTauri()): StorageAdapter {
  return tauriRuntime ? new TauriJsonStorageAdapter() : new LocalStorageAdapter()
}
