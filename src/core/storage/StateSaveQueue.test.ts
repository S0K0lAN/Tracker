import { describe, expect, it, vi } from 'vitest'
import { createSeedState } from '../../domain/seed'
import type { AppState } from '../../domain/models'
import type { StorageAdapter } from './StorageAdapter'
import { StateSaveQueue } from './StateSaveQueue'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function snapshot(title: string): AppState {
  const state = createSeedState()
  return {
    ...state,
    tasks: [{ ...state.tasks[0], title }],
  }
}

function adapterWith(overrides: Partial<StorageAdapter>): StorageAdapter {
  return {
    load: async () => null,
    loadImportBackup: async () => null,
    save: async () => undefined,
    replaceWithBackup: async () => undefined,
    restoreImportBackup: async () => null,
    clear: async () => undefined,
    ...overrides,
  }
}

describe('StateSaveQueue', () => {
  it('serializes writes and coalesces waiting normal saves to the newest snapshot', async () => {
    const firstWrite = deferred<void>()
    const save = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined)
    const queue = new StateSaveQueue(adapterWith({ save }))

    const first = queue.save(snapshot('revision 1'))
    const second = queue.save(snapshot('revision 2'))
    const third = queue.save(snapshot('revision 3'))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].tasks[0].title).toBe('revision 1')

    firstWrite.resolve(undefined)
    await Promise.all([first, second, third])

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].tasks[0].title).toBe('revision 3')
  })

  it('keeps explicit persistence as a FIFO barrier between normal saves', async () => {
    const firstWrite = deferred<void>()
    const events: string[] = []
    const adapter = adapterWith({
      save: vi.fn(async (state) => {
        events.push(`save:${state.tasks[0].title}`)
        if (state.tasks[0].title === 'before') await firstWrite.promise
      }),
      replaceWithBackup: vi.fn(async (state) => {
        events.push(`replace:${state.tasks[0].title}`)
      }),
    })
    const queue = new StateSaveQueue(adapter)

    const before = queue.save(snapshot('before'))
    const replacement = queue.runExclusive((storage) => storage.replaceWithBackup(snapshot('replacement')))
    const after = queue.save(snapshot('after'))

    expect(events).toEqual(['save:before'])
    firstWrite.resolve(undefined)
    await Promise.all([before, replacement, after])

    expect(events).toEqual(['save:before', 'replace:replacement', 'save:after'])
  })

  it('finishes a waiting older save before replacement so it cannot overwrite the replacement later', async () => {
    const firstWrite = deferred<void>()
    const events: string[] = []
    let persistedTitle = ''
    const adapter = adapterWith({
      save: vi.fn(async (state) => {
        events.push(`save:${state.tasks[0].title}`)
        if (state.tasks[0].title === 'in flight') await firstWrite.promise
        persistedTitle = state.tasks[0].title
      }),
      replaceWithBackup: vi.fn(async (state) => {
        events.push(`replace:${state.tasks[0].title}`)
        persistedTitle = state.tasks[0].title
      }),
    })
    const queue = new StateSaveQueue(adapter)

    const inFlight = queue.save(snapshot('in flight'))
    const waiting = queue.save(snapshot('waiting older revision'))
    const replacement = queue.runExclusive((storage) => storage.replaceWithBackup(snapshot('replacement')))

    expect(events).toEqual(['save:in flight'])
    firstWrite.resolve(undefined)
    await Promise.all([inFlight, waiting, replacement])

    expect(events).toEqual([
      'save:in flight',
      'save:waiting older revision',
      'replace:replacement',
    ])
    expect(persistedTitle).toBe('replacement')
  })

  it('supersedes saves captured during a successful authoritative replacement', async () => {
    const replacementWrite = deferred<void>()
    const events: string[] = []
    let persistedTitle = ''
    const adapter = adapterWith({
      save: vi.fn(async (state) => {
        events.push(`save:${state.tasks[0].title}`)
        persistedTitle = state.tasks[0].title
      }),
      replaceWithBackup: vi.fn(async (state) => {
        events.push(`replace:${state.tasks[0].title}`)
        await replacementWrite.promise
        persistedTitle = state.tasks[0].title
      }),
    })
    const queue = new StateSaveQueue(adapter)

    const replacement = queue.runAuthoritative((storage) => storage.replaceWithBackup(snapshot('replacement')))
    const transientSave = queue.save(snapshot('transient UI edit'))

    expect(events).toEqual(['replace:replacement'])
    replacementWrite.resolve(undefined)
    await Promise.all([replacement, transientSave])

    expect(events).toEqual(['replace:replacement'])
    expect(persistedTitle).toBe('replacement')
  })

  it('flushes the newest captured save when an authoritative replacement fails', async () => {
    const replacementWrite = deferred<void>()
    const events: string[] = []
    let persistedTitle = ''
    const adapter = adapterWith({
      save: vi.fn(async (state) => {
        events.push(`save:${state.tasks[0].title}`)
        persistedTitle = state.tasks[0].title
      }),
      replaceWithBackup: vi.fn(async () => {
        events.push('replace:failed')
        await replacementWrite.promise
      }),
    })
    const queue = new StateSaveQueue(adapter)

    const replacement = queue.runAuthoritative((storage) => storage.replaceWithBackup(snapshot('replacement')))
    const olderEdit = queue.save(snapshot('older UI edit'))
    const latestEdit = queue.save(snapshot('latest UI edit'))
    const rejectedReplacement = expect(replacement).rejects.toThrow('replace failed')

    replacementWrite.reject(new Error('replace failed'))
    await Promise.all([rejectedReplacement, olderEdit, latestEdit])

    expect(events).toEqual(['replace:failed', 'save:latest UI edit'])
    expect(persistedTitle).toBe('latest UI edit')
  })

  it('restores captured state when a completed replacement fails its authoritative postcondition', async () => {
    const replacementWrite = deferred<void>()
    const events: string[] = []
    let persistedTitle = ''
    let stillAuthoritative = true
    const adapter = adapterWith({
      save: vi.fn(async (state) => {
        events.push(`save:${state.tasks[0].title}`)
        persistedTitle = state.tasks[0].title
      }),
      replaceWithBackup: vi.fn(async (state) => {
        events.push(`replace:${state.tasks[0].title}`)
        await replacementWrite.promise
        persistedTitle = state.tasks[0].title
      }),
    })
    const queue = new StateSaveQueue(adapter)

    const replacement = queue.runAuthoritative(
      (storage) => storage.replaceWithBackup(snapshot('stale remote replacement')),
      () => stillAuthoritative,
    )
    const currentStateSave = queue.save(snapshot('current local state'))
    stillAuthoritative = false
    replacementWrite.resolve(undefined)
    await Promise.all([replacement, currentStateSave])

    expect(events).toEqual([
      'replace:stale remote replacement',
      'save:current local state',
    ])
    expect(persistedTitle).toBe('current local state')
  })

  it('does not strand a save queued in the recovery microtask gap', async () => {
    const events: string[] = []
    const adapter = adapterWith({
      save: vi.fn(async (state) => {
        events.push(`save:${state.tasks[0].title}`)
      }),
      replaceWithBackup: vi.fn(async (state) => {
        events.push(`replace:${state.tasks[0].title}`)
      }),
    })
    const queue = new StateSaveQueue(adapter)
    let lateSave: Promise<void> | undefined

    const replacement = queue.runAuthoritative(
      (storage) => storage.replaceWithBackup(snapshot('stale replacement')),
      () => {
        queueMicrotask(() => {
          lateSave = queue.save(snapshot('late local edit'))
        })
        return false
      },
    )

    await replacement
    await Promise.resolve()
    await lateSave

    expect(events).toEqual([
      'replace:stale replacement',
      'save:late local edit',
    ])
  })

  it('continues with newer work after a failed write', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValueOnce(undefined)
    const queue = new StateSaveQueue(adapterWith({ save }))

    await expect(queue.save(snapshot('failed'))).rejects.toThrow('quota')
    await expect(queue.save(snapshot('recovered'))).resolves.toBeUndefined()

    expect(save).toHaveBeenCalledTimes(2)
  })
})
