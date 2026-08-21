import { describe, expect, it, vi } from 'vitest'
import {
  clearTaskDraft,
  clearTaskDraftIfMatches,
  getTaskDraftStorageKey,
  readTaskDraft,
  TASK_DRAFT_MAX_BYTES,
  writeTaskDraft,
  type TaskDraftData,
} from './taskDraftJournal'

const draft: TaskDraftData = {
  title: 'Подготовить отчёт',
  description: 'Сверить цифры',
  projectId: 'work',
  startAt: '2026-08-21T09:00',
  deadline: '2026-08-21T18:00',
  importance: 'high',
  urgencyThresholdHours: 24,
  urgencyOverride: 'high',
  tags: 'работа, отчёт',
  subtasks: [{ id: 'subtask-1', title: 'Проверить таблицу', completed: false }],
  pendingSubtaskTitle: 'Отправить руководителю',
  reminders: [{ id: 'reminder-1', at: '2026-08-21T17:00:00.000Z' }],
}

describe('task draft recovery journal', () => {
  it('uses separate keys for creation and each existing task', () => {
    expect(getTaskDraftStorageKey()).not.toBe(getTaskDraftStorageKey('task-1'))
    expect(getTaskDraftStorageKey('task-1')).not.toBe(getTaskDraftStorageKey('task-2'))
    expect(getTaskDraftStorageKey('task/id')).toContain('task%2Fid')
  })

  it('round-trips the supported fields without adding attachments', () => {
    expect(writeTaskDraft(draft, 'task-1', '2026-08-20T10:00:00.000Z', Date.parse('2026-08-21T10:00:00.000Z')).status).toBe('saved')

    const loaded = readTaskDraft('task-1', '2026-08-20T10:00:00.000Z')
    expect(loaded?.data).toEqual(draft)
    expect(loaded?.data).not.toHaveProperty('attachments')
    expect(loaded?.savedTaskChanged).toBe(false)
  })

  it('rejects and removes corrupt, oversized and stale journals', () => {
    const key = getTaskDraftStorageKey('task-1')
    localStorage.setItem(key, '{broken')
    expect(readTaskDraft('task-1', '2026-08-20T10:00:00.000Z')).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()

    localStorage.setItem(key, 'x'.repeat(TASK_DRAFT_MAX_BYTES + 1))
    expect(readTaskDraft('task-1', '2026-08-20T10:00:00.000Z')).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()

    expect(writeTaskDraft(draft, 'task-1', '2026-08-20T10:00:00.000Z', Date.parse('2026-08-21T10:00:00.000Z')).status).toBe('saved')
    expect(readTaskDraft('task-1', '2026-08-22T10:00:00.000Z')).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('flags a journal based on an older saved task without applying it', () => {
    expect(writeTaskDraft(draft, 'task-1', '2026-08-20T10:00:00.000Z', Date.parse('2026-08-23T10:00:00.000Z')).status).toBe('saved')

    expect(readTaskDraft('task-1', '2026-08-22T10:00:00.000Z')?.savedTaskChanged).toBe(true)
  })

  it('does not overwrite the last valid journal when a later draft is too large', () => {
    expect(writeTaskDraft(draft).status).toBe('saved')
    const previous = localStorage.getItem(getTaskDraftStorageKey())
    const manySubtasks = Array.from({ length: 1_000 }, (_, index) => ({
      id: `subtask-${index}`,
      title: 'я'.repeat(200),
      completed: false,
    }))

    expect(writeTaskDraft({ ...draft, subtasks: manySubtasks }).status).toBe('too-large')
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBe(previous)
  })

  it('does not throw when browser storage rejects writes or removals', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    expect(writeTaskDraft(draft).status).toBe('unavailable')
    setItem.mockRestore()

    localStorage.setItem(getTaskDraftStorageKey(), JSON.stringify({ invalid: true }))
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    expect(() => readTaskDraft()).not.toThrow()
    removeItem.mockRestore()
    expect(() => clearTaskDraft()).not.toThrow()
  })

  it('uses compare-and-swap so a late success cannot clear a newer revision', () => {
    const first = writeTaskDraft(draft)
    const second = writeTaskDraft({ ...draft, title: 'Более новый черновик' })
    if (first.status !== 'saved' || second.status !== 'saved') throw new Error('journal write failed')

    expect(second.token.revision).toBeGreaterThan(first.token.revision)
    expect(clearTaskDraftIfMatches(first.token)).toBe(false)
    expect(readTaskDraft()?.data.title).toBe('Более новый черновик')
    expect(clearTaskDraftIfMatches(second.token)).toBe(true)
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
  })

  it('rejects six reminders and drops deeply nested unknown data without re-stringifying it', () => {
    const reminders = Array.from({ length: 6 }, (_, index) => ({
      id: `reminder-${index}`,
      at: '2026-08-21T17:00:00.000Z',
    }))
    expect(writeTaskDraft({ ...draft, reminders }).status).toBe('invalid')

    expect(writeTaskDraft(draft).status).toBe('saved')
    const key = getTaskDraftStorageKey()
    const valid = localStorage.getItem(key)!
    const nested = `${'['.repeat(5_000)}0${']'.repeat(5_000)}`
    localStorage.setItem(key, valid.replace('"data":{', `"data":{"unknown":${nested},`))

    expect(() => readTaskDraft()).not.toThrow()
    const loaded = readTaskDraft()
    expect(loaded?.data).toEqual(draft)
    expect(loaded?.data).not.toHaveProperty('unknown')
  })
})
