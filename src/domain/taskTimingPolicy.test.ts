import { describe, expect, it } from 'vitest'
import { taskTimingMutationRequiresStart } from './taskTimingPolicy'

describe('task timing mutation policy', () => {
  const legacyDeadline = '2026-08-31T15:00:00.000Z'

  it('rejects a new deadline without a start', () => {
    expect(taskTimingMutationRequiresStart(undefined, { deadline: legacyDeadline })).toBe(true)
  })

  it('accepts a deadline when a start exists', () => {
    expect(taskTimingMutationRequiresStart(undefined, {
      startAt: '2026-08-31T09:00:00.000Z',
      deadline: legacyDeadline,
    })).toBe(false)
  })

  it('rejects an unparseable start', () => {
    expect(taskTimingMutationRequiresStart(undefined, {
      startAt: 'not-a-date',
      deadline: legacyDeadline,
    })).toBe(true)
  })

  it('rejects removing the start while retaining a deadline', () => {
    expect(taskTimingMutationRequiresStart(
      { startAt: '2026-08-31T09:00:00.000Z', deadline: legacyDeadline },
      { deadline: legacyDeadline },
    )).toBe(true)
  })

  it('allows an unchanged legacy deadline-only task to be edited', () => {
    expect(taskTimingMutationRequiresStart(
      { deadline: '2026-08-31T18:00:00+03:00' },
      { deadline: legacyDeadline },
    )).toBe(false)
  })

  it('requires a start before changing a legacy deadline', () => {
    expect(taskTimingMutationRequiresStart(
      { deadline: legacyDeadline },
      { deadline: '2026-09-01T15:00:00.000Z' },
    )).toBe(true)
  })

  it('allows a legacy task to add a start or remove its deadline', () => {
    expect(taskTimingMutationRequiresStart(
      { deadline: legacyDeadline },
      { startAt: '2026-08-31T09:00:00.000Z', deadline: legacyDeadline },
    )).toBe(false)
    expect(taskTimingMutationRequiresStart(
      { deadline: legacyDeadline },
      {},
    )).toBe(false)
  })
})
