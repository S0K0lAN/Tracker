import { describe, expect, it } from 'vitest'
import {
  assertTaskTimingMutation,
  getTaskTimingMutationError,
  isValidLocalDateKey,
  taskHasAllDayTimingConflict,
  taskHasDurationDeadlineConflict,
  taskTimingMutationRequiresStart,
} from './taskTimingPolicy'

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

describe('task duration/deadline policy', () => {
  it('rejects any task that has both a duration and a deadline', () => {
    expect(taskHasDurationDeadlineConflict({
      plannedDurationMinutes: 60,
      deadline: '2026-08-31T15:00:00.000Z',
    })).toBe(true)
  })

  it('accepts a duration or a deadline on its own', () => {
    expect(taskHasDurationDeadlineConflict({ plannedDurationMinutes: 60 })).toBe(false)
    expect(taskHasDurationDeadlineConflict({ deadline: '2026-08-31T15:00:00.000Z' })).toBe(false)
    expect(taskHasDurationDeadlineConflict({})).toBe(false)
  })

  it('does not classify an empty deadline input as a stored deadline', () => {
    expect(taskHasDurationDeadlineConflict({ plannedDurationMinutes: 60, deadline: '  ' })).toBe(false)
  })
})

describe('all-day timing policy', () => {
  it.each(['2026-01-01', '2024-02-29', '9999-12-31'])(
    'accepts the canonical local date key %s',
    (value) => expect(isValidLocalDateKey(value)).toBe(true),
  )

  it.each(['', '2026-1-01', '2026-02-29', '2026-13-01', 'not-a-date'])(
    'rejects the invalid local date key %s',
    (value) => expect(isValidLocalDateKey(value)).toBe(false),
  )

  it('keeps an all-day task exclusive from every timed mode', () => {
    expect(taskHasAllDayTimingConflict({ allDayDate: '2026-09-01' })).toBe(false)
    expect(taskHasAllDayTimingConflict({
      allDayDate: '2026-09-01',
      startAt: '2026-09-01T09:00:00.000Z',
    })).toBe(true)
    expect(taskHasAllDayTimingConflict({
      allDayDate: '2026-09-01',
      plannedDurationMinutes: 60,
    })).toBe(true)
    expect(taskHasAllDayTimingConflict({
      allDayDate: '2026-09-01',
      deadline: '2026-09-01T18:00:00.000Z',
    })).toBe(true)
  })

  it('returns one central validation error for all timing mutations', () => {
    expect(getTaskTimingMutationError(undefined, { allDayDate: '2026-02-29' }))
      .toBe('Task allDayDate must be a valid YYYY-MM-DD date')
    expect(getTaskTimingMutationError(undefined, {
      allDayDate: '2026-09-01',
      plannedDurationMinutes: 60,
    })).toBe('Task all-day date is mutually exclusive with start, duration, and deadline')
    expect(getTaskTimingMutationError(undefined, {
      plannedDurationMinutes: 60,
      deadline: '2026-09-01T18:00:00.000Z',
    })).toBe('Task duration and deadline are mutually exclusive')
    expect(getTaskTimingMutationError(undefined, {
      deadline: '2026-09-01T18:00:00.000Z',
    })).toBe('Task deadline requires startAt')
    expect(getTaskTimingMutationError(undefined, { allDayDate: '2026-09-01' })).toBeUndefined()
  })

  it('throws before an invalid timing mutation reaches state', () => {
    expect(() => assertTaskTimingMutation(undefined, {
      allDayDate: '2026-09-01',
      deadline: '2026-09-01T18:00:00.000Z',
    })).toThrow('Task all-day date is mutually exclusive with start, duration, and deadline')
  })
})
