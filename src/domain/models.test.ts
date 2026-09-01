import { describe, expect, it } from 'vitest'
import type { Task } from './models'
import { getEffectiveUrgencyThreshold, getTaskTiming, getTaskUrgency } from './models'

const baseTask: Task = {
  id: 'task',
  title: 'Проверить срочность',
  description: '',
  projectId: 'inbox',
  importance: 'low',
  tags: [],
  subtasks: [],
  attachments: [],
  reminders: [],
  status: 'active',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  focusMinutes: 0,
}

describe('task urgency', () => {
  const now = new Date('2026-07-30T12:00:00.000Z')

  it('is low without a deadline', () => {
    expect(getTaskUrgency(baseTask, now)).toBe('low')
  })

  it('ignores a stale manual override without a valid deadline', () => {
    expect(getTaskUrgency({ ...baseTask, urgencyOverride: 'high' }, now)).toBe('low')
    expect(getTaskUrgency({ ...baseTask, deadline: 'not-a-date', urgencyOverride: 'high' }, now)).toBe('low')
  })

  it('becomes high three days before the deadline', () => {
    const task = { ...baseTask, deadline: '2026-08-02T12:00:00.000Z' }
    expect(getTaskUrgency(task, now)).toBe('high')
  })

  it('uses the safe 72-hour fallback without task or project settings', () => {
    const task = { ...baseTask, deadline: '2026-08-03T12:00:00.000Z' }

    expect(getEffectiveUrgencyThreshold(task)).toBe(72)
    expect(getTaskUrgency(task, now)).toBe('low')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to 72 hours for invalid task and project thresholds (%s)',
    (invalidThreshold) => {
      const task = {
        ...baseTask,
        deadline: '2026-08-01T12:00:00.000Z',
        urgencyThresholdOverrideHours: invalidThreshold,
      }

      expect(getEffectiveUrgencyThreshold(task, invalidThreshold)).toBe(72)
      expect(getTaskUrgency(task, now, invalidThreshold)).toBe('high')
    },
  )

  it('inherits the project urgency threshold', () => {
    const task = { ...baseTask, deadline: '2026-08-03T12:00:00.000Z' }

    expect(getEffectiveUrgencyThreshold(task, 120)).toBe(120)
    expect(getTaskTiming(task, now, 120).urgency).toBe('high')
  })

  it('uses an explicit task threshold instead of the project threshold', () => {
    const task = {
      ...baseTask,
      deadline: '2026-08-01T12:00:00.000Z',
      urgencyThresholdOverrideHours: 24,
    }

    expect(getEffectiveUrgencyThreshold(task, 120)).toBe(24)
    expect(getTaskUrgency(task, now, 120)).toBe('low')
  })

  it('treats an unparseable deadline as absent instead of urgent', () => {
    const task = { ...baseTask, deadline: 'not-a-date' }

    expect(getTaskUrgency(task, now)).toBe('low')
  })

  it('manual override wins over automatic urgency', () => {
    const task = {
      ...baseTask,
      deadline: '2026-07-30T13:00:00.000Z',
      urgencyThresholdOverrideHours: 1,
      urgencyOverride: 'low' as const,
    }

    expect(getTaskUrgency(task, now, 168)).toBe('low')
  })

  it('keeps a past deadline urgent without a separate overdue classification', () => {
    const task = { ...baseTask, deadline: '2026-07-29T12:00:00.000Z' }
    expect(getTaskTiming(task, now)).toEqual({ urgency: 'high' })
  })
})
