import type { AppState } from '../../domain/models'
import type { StorageAdapter } from './StorageAdapter'

interface Waiter<T> {
  resolve(value: T | PromiseLike<T>): void
  reject(reason?: unknown): void
}

interface SaveJob {
  kind: 'save'
  state: AppState
  waiters: Array<Waiter<void>>
}

interface ExclusiveJob {
  kind: 'exclusive'
  operation: (adapter: StorageAdapter) => Promise<unknown>
  waiter: Waiter<unknown>
}

interface AuthoritativeJob {
  kind: 'authoritative'
  operation: (adapter: StorageAdapter) => Promise<unknown>
  shouldSupersedeCaptured: () => boolean
  waiter: Waiter<unknown>
  capturedSave?: SaveJob
}

type QueueJob = SaveJob | ExclusiveJob | AuthoritativeJob

/**
 * Serializes every write made through a StorageAdapter. Consecutive normal
 * saves that have not started yet are collapsed to the newest snapshot.
 * Explicit operations remain FIFO barriers and are never coalesced.
 */
export class StateSaveQueue {
  private readonly jobs: QueueJob[] = []
  private readonly authoritativeCaptures: AuthoritativeJob[] = []
  private running = false
  private activeSave?: SaveJob

  constructor(private readonly adapter: StorageAdapter) {}

  save(state: AppState): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const authoritative = this.authoritativeCaptures.at(-1)
      if (authoritative) {
        if (authoritative.capturedSave) {
          authoritative.capturedSave.state = state
          authoritative.capturedSave.waiters.push({ resolve, reject })
        } else {
          authoritative.capturedSave = {
            kind: 'save',
            state,
            waiters: [{ resolve, reject }],
          }
        }
        return
      }
      if (this.jobs.length === 0 && this.activeSave?.state === state) {
        this.activeSave.waiters.push({ resolve, reject })
        return
      }
      const tail = this.jobs.at(-1)
      if (tail?.kind === 'save') {
        tail.state = state
        tail.waiters.push({ resolve, reject })
      } else {
        this.jobs.push({
          kind: 'save',
          state,
          waiters: [{ resolve, reject }],
        })
      }
      void this.drain()
    })
  }

  runExclusive<T>(operation: (adapter: StorageAdapter) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({
        kind: 'exclusive',
        operation,
        waiter: {
          resolve: (value) => resolve(value as T),
          reject,
        },
      })
      void this.drain()
    })
  }

  /**
   * Runs a replacement that becomes the authoritative local snapshot.
   * Normal saves requested from enqueue until completion are held aside:
   * accepted success supersedes them, while failure or a false postcondition
   * flushes the newest captured state.
   */
  runAuthoritative<T>(
    operation: (adapter: StorageAdapter) => Promise<T>,
    shouldSupersedeCaptured: () => boolean = () => true,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: AuthoritativeJob = {
        kind: 'authoritative',
        operation,
        shouldSupersedeCaptured,
        waiter: {
          resolve: (value) => resolve(value as T),
          reject,
        },
      }
      this.authoritativeCaptures.push(job)
      this.jobs.push(job)
      void this.drain()
    })
  }

  private async drain() {
    if (this.running) return
    this.running = true
    try {
      let job = this.jobs.shift()
      while (job) {
        if (job.kind === 'save') {
          this.activeSave = job
          try {
            await this.adapter.save(job.state)
            job.waiters.forEach(({ resolve }) => resolve(undefined))
          } catch (error) {
            job.waiters.forEach(({ reject }) => reject(error))
          } finally {
            this.activeSave = undefined
          }
        } else if (job.kind === 'exclusive') {
          try {
            job.waiter.resolve(await job.operation(this.adapter))
          } catch (error) {
            job.waiter.reject(error)
          }
        } else {
          await this.runAuthoritativeJob(job)
        }
        job = this.jobs.shift()
      }
    } finally {
      this.running = false
      // A job can be appended after the final shift and before `running` is
      // cleared. Make sure that narrow timing window cannot strand it.
      if (this.jobs.length > 0) void this.drain()
    }
  }

  private async runAuthoritativeJob(job: AuthoritativeJob) {
    try {
      const result = await job.operation(this.adapter)
      if (!job.shouldSupersedeCaptured()) {
        // Stop accepting new captures before the first await. Otherwise a
        // save queued in the microtask gap after the final recovery write can
        // be attached to this job after it has already been drained.
        this.removeAuthoritativeCapture(job)
        const recoveryError = await this.flushCapturedSaves(job)
        if (recoveryError) job.waiter.reject(recoveryError)
        else job.waiter.resolve(result)
        return
      }
      this.removeAuthoritativeCapture(job)
      const supersededSave = job.capturedSave
      job.capturedSave = undefined
      supersededSave?.waiters.forEach(({ resolve }) => resolve(undefined))
      job.waiter.resolve(result)
    } catch (operationError) {
      // A failed replacement must not lose edits made while it was pending.
      // New saves join the normal queue while the already captured snapshot
      // is recovered, so none can arrive after the capture has been drained.
      this.removeAuthoritativeCapture(job)
      await this.flushCapturedSaves(job)
      job.waiter.reject(operationError)
    }
  }

  private async flushCapturedSaves(job: AuthoritativeJob) {
    let latestSaveError: unknown
    let fallback = job.capturedSave
    job.capturedSave = undefined
    while (fallback) {
      try {
        await this.adapter.save(fallback.state)
        fallback.waiters.forEach(({ resolve }) => resolve(undefined))
        latestSaveError = undefined
      } catch (saveError) {
        fallback.waiters.forEach(({ reject }) => reject(saveError))
        latestSaveError = saveError
      }
      fallback = job.capturedSave
      job.capturedSave = undefined
    }
    return latestSaveError
  }

  private removeAuthoritativeCapture(job: AuthoritativeJob) {
    const index = this.authoritativeCaptures.indexOf(job)
    if (index >= 0) this.authoritativeCaptures.splice(index, 1)
  }
}
