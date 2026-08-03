import { describe, expect, it } from 'vitest'
import { DemoSyncAdapter } from './DemoSyncAdapter'

describe('DemoSyncAdapter revision contract', () => {
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
