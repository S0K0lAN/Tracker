import { describe, expect, it } from 'vitest'
import { DemoSyncAdapter } from './DemoSyncAdapter'

describe('DemoSyncAdapter revision contract', () => {
  it('allows only one concurrent create guarded by the absence precondition', async () => {
    const adapter = new DemoSyncAdapter()

    const results = await Promise.allSettled([
      adapter.upload({ title: 'first' }, { expectedRevision: null }),
      adapter.upload({ title: 'second' }, { expectedRevision: null }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'conflict' },
    })
  })

  it('refuses to create when a remote payload appeared after the absence check', async () => {
    const adapter = new DemoSyncAdapter()
    await adapter.upload({ title: 'remote' })

    await expect(adapter.upload({ title: 'local' }, { expectedRevision: null })).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(adapter.download()).resolves.toMatchObject({ payload: { title: 'remote' } })
  })

  it('refuses to update a remote payload that no longer exists', async () => {
    const adapter = new DemoSyncAdapter()

    await expect(adapter.upload({ title: 'local' }, { expectedRevision: '1' })).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(adapter.head()).resolves.toBeNull()
  })

  it('rejects a stale revision without changing the remote payload', async () => {
    const adapter = new DemoSyncAdapter()
    await adapter.upload({ title: 'base' })

    await expect(adapter.upload({ title: 'stale write' }, { expectedRevision: '0' })).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(adapter.download()).resolves.toMatchObject({ payload: { title: 'base' } })
  })

  it('updates when the expected revision matches', async () => {
    const adapter = new DemoSyncAdapter()
    await adapter.upload({ title: 'base' })

    await expect(adapter.upload({ title: 'next' }, { expectedRevision: '1' })).resolves.toMatchObject({
      revision: '2',
    })
    await expect(adapter.download()).resolves.toMatchObject({ payload: { title: 'next' } })
  })
})
