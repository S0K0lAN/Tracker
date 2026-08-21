export const TASK_DRAFT_STORAGE_PREFIX = 'focus-flow.task-draft.v1'

export function taskDraftStorageKey(taskId?: string) {
  return taskId
    ? `${TASK_DRAFT_STORAGE_PREFIX}:task:${encodeURIComponent(taskId)}`
    : `${TASK_DRAFT_STORAGE_PREFIX}:create`
}

export function clearTaskDraftStorage(taskId?: string): boolean {
  try {
    localStorage.removeItem(taskDraftStorageKey(taskId))
    return true
  } catch {
    return false
  }
}

export function clearAllTaskDraftStorage(): number {
  let storage: Storage
  try {
    storage = localStorage
  } catch {
    return 0
  }

  const keys: string[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(`${TASK_DRAFT_STORAGE_PREFIX}:`)) keys.push(key)
    }
  } catch {
    return 0
  }

  let removed = 0
  keys.forEach((key) => {
    try {
      storage.removeItem(key)
      removed += 1
    } catch {
      // Reset remains usable even when browser storage is partially blocked.
    }
  })
  return removed
}
