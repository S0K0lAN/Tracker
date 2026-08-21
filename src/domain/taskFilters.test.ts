import { describe, expect, it } from 'vitest'
import { createSeedState } from './seed'
import { isInboxTask } from './taskFilters'

describe('isInboxTask', () => {
  const makeTask = () => ({
    ...createSeedState().tasks[0],
    projectId: 'inbox',
    startAt: undefined,
    deadline: undefined,
  })

  it('accepts only tasks in the canonical inbox without a start or deadline', () => {
    expect(isInboxTask(makeTask())).toBe(true)
    expect(isInboxTask({ ...makeTask(), projectId: 'work' })).toBe(false)
    expect(isInboxTask({ ...makeTask(), startAt: '2026-08-21T09:00:00.000+03:00' })).toBe(false)
    expect(isInboxTask({ ...makeTask(), deadline: '2026-08-21T18:00:00.000+03:00' })).toBe(false)
  })
})
