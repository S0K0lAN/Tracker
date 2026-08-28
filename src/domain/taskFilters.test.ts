import { describe, expect, it } from 'vitest'
import type { Project, SavedFilter, Task } from './models'
import { createSeedState } from './seed'
import { isInboxTask, matchesSavedFilter } from './taskFilters'

const now = new Date('2026-08-21T09:00:00.000Z')

const task: Task = {
  id: 'task-filter-threshold',
  title: 'Одинаковый дедлайн',
  description: '',
  projectId: 'work',
  deadline: '2026-08-22T09:00:00.000Z',
  plannedDurationMinutes: 60,
  importance: 'low',
  tags: [],
  subtasks: [],
  attachments: [],
  reminders: [],
  status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
  focusMinutes: 0,
}

const urgentFilter: SavedFilter = {
  id: 'urgent-filter',
  name: 'Срочные',
  query: '',
  tags: [],
  tagMode: 'any',
  urgency: 'high',
  status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z',
}

const project = (urgencyThresholdHours: number): Project => ({
  id: 'work',
  name: 'Работа',
  color: '#778c70',
  urgencyThresholdHours,
  createdAt: '2026-08-01T09:00:00.000Z',
})

describe('matchesSavedFilter', () => {
  it('matches urgency using the task project threshold', () => {
    expect(matchesSavedFilter(task, urgentFilter, project(48), now)).toBe(true)
    expect(matchesSavedFilter(task, urgentFilter, project(12), now)).toBe(false)
  })

  it('keeps task threshold and manual urgency overrides authoritative', () => {
    expect(matchesSavedFilter({ ...task, urgencyThresholdOverrideHours: 6 }, urgentFilter, project(48), now)).toBe(false)
    expect(matchesSavedFilter({ ...task, urgencyOverride: 'high' }, urgentFilter, project(12), now)).toBe(true)
  })
})

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
