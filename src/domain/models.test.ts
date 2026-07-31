import { describe, expect, it } from 'vitest'
import type { Task } from './models'
import { getTaskUrgency, isOverdue } from './models'

const baseTask: Task = {
  id: 'task',
  title: 'Проверить срочность',
  description: '',
  projectId: 'inbox',
  urgencyThresholdHours: 72,
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

  it('becomes high three days before the deadline', () => {
    const task = { ...baseTask, deadline: '2026-08-02T12:00:00.000Z' }
    expect(getTaskUrgency(task, now)).toBe('high')
  })

  it('stays low before the configured threshold', () => {
    const task = { ...baseTask, deadline: '2026-08-03T12:00:00.000Z' }
    expect(getTaskUrgency(task, now)).toBe('low')
  })

  it('manual override wins over automatic urgency', () => {
    const task = { ...baseTask, deadline: '2026-07-30T13:00:00.000Z', urgencyOverride: 'low' as const }
    expect(getTaskUrgency(task, now)).toBe('low')
  })

  it('detects overdue active tasks but not completed tasks', () => {
    const task = { ...baseTask, deadline: '2026-07-29T12:00:00.000Z' }
    expect(isOverdue(task, now)).toBe(true)
    expect(isOverdue({ ...task, status: 'completed' }, now)).toBe(false)
  })
})
