import type { RemoteHead } from './SyncAdapter'

export type SyncDecision =
  | 'create-remote'
  | 'upload-local'
  | 'download-remote'
  | 'conflict'
  | 'noop'

export interface SyncMetadata {
  remoteId?: string
  remoteRevision?: string
  lastSyncedHash?: string
}

export function decideSync(
  localHash: string,
  metadata: SyncMetadata,
  remoteHead: RemoteHead | null,
): SyncDecision {
  if (remoteHead === null) return 'create-remote'

  if (!metadata.remoteId || !metadata.remoteRevision || !metadata.lastSyncedHash) return 'conflict'
  if (remoteHead.id !== metadata.remoteId) return 'conflict'

  const localChanged = localHash !== metadata.lastSyncedHash
  const remoteChanged = remoteHead.revision !== metadata.remoteRevision

  if (!remoteChanged) return localChanged ? 'upload-local' : 'noop'
  return localChanged ? 'conflict' : 'download-remote'
}
