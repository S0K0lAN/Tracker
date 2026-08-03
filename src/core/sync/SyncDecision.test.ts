import { describe, expect, it } from 'vitest'
import type { RemoteHead } from './SyncAdapter'
import { decideSync } from './SyncDecision'

const remoteHead = (revision: string): RemoteHead => ({
  id: 'remote-snapshot',
  revision,
})

describe('decideSync', () => {
  it('creates the remote snapshot when none exists', () => {
    expect(decideSync('local', {}, null)).toBe('create-remote')
  })

  it.each([
    { metadata: {}, missing: 'id, revision and hash' },
    { metadata: { remoteId: 'remote-snapshot', remoteRevision: 'r1' }, missing: 'last synced hash' },
    { metadata: { remoteId: 'remote-snapshot', lastSyncedHash: 'base' }, missing: 'remote revision' },
    { metadata: { remoteRevision: 'r1', lastSyncedHash: 'base' }, missing: 'remote id' },
  ])('reports a conflict when the sync base is missing: $missing', ({ metadata }) => {
    expect(decideSync('local', metadata, remoteHead('r1'))).toBe('conflict')
  })

  it('uploads a dirty local snapshot when the remote revision is unchanged', () => {
    expect(
      decideSync(
        'changed-local',
        { remoteId: 'remote-snapshot', remoteRevision: 'r1', lastSyncedHash: 'base' },
        remoteHead('r1'),
      ),
    ).toBe('upload-local')
  })

  it('does nothing when local and remote still match the sync base', () => {
    expect(
      decideSync('base', { remoteId: 'remote-snapshot', remoteRevision: 'r1', lastSyncedHash: 'base' }, remoteHead('r1')),
    ).toBe('noop')
  })

  it('downloads a changed remote snapshot when the local snapshot is clean', () => {
    expect(
      decideSync('base', { remoteId: 'remote-snapshot', remoteRevision: 'r1', lastSyncedHash: 'base' }, remoteHead('r2')),
    ).toBe('download-remote')
  })

  it('reports a conflict when local and remote both changed', () => {
    expect(
      decideSync(
        'changed-local',
        { remoteId: 'remote-snapshot', remoteRevision: 'r1', lastSyncedHash: 'base' },
        remoteHead('r2'),
      ),
    ).toBe('conflict')
  })

  it('reports a conflict when the provider returns another remote file', () => {
    expect(
      decideSync(
        'base',
        { remoteId: 'previous-file', remoteRevision: 'r1', lastSyncedHash: 'base' },
        remoteHead('r1'),
      ),
    ).toBe('conflict')
  })
})
