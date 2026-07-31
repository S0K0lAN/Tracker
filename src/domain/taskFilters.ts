import type { InboxSort, SavedFilter, Task } from './models'
import { getTaskUrgency } from './models'

export function matchesSavedFilter(task: Task, filter: SavedFilter, projectName = ''): boolean {
  if (task.status === 'archived' || task.status === 'deleted') return false
  if (filter.status !== 'all' && task.status !== filter.status) return false
  if (filter.projectId && task.projectId !== filter.projectId) return false
  if (filter.importance && task.importance !== filter.importance) return false
  if (filter.urgency && getTaskUrgency(task) !== filter.urgency) return false
  if (filter.tags.length > 0) {
    const matchesTags = filter.tagMode === 'all'
      ? filter.tags.every((tag) => task.tags.includes(tag))
      : filter.tags.some((tag) => task.tags.includes(tag))
    if (!matchesTags) return false
  }
  const query = filter.query.trim().toLowerCase()
  if (query && !`${task.title} ${task.description} ${task.tags.join(' ')} ${projectName}`.toLowerCase().includes(query)) return false
  return true
}

export function sortTasks(tasks: Task[], sort: InboxSort): Task[] {
  const prepared = tasks.map((task, index) => ({
    task,
    index,
    createdAt: Date.parse(task.createdAt) || 0,
    deadline: task.deadline ? Date.parse(task.deadline) || 0 : undefined,
  }))

  prepared.sort((left, right) => {
    if (sort === 'deadline-asc') {
      if (left.deadline === undefined && right.deadline === undefined) return newestFirst(left, right)
      if (left.deadline === undefined) return 1
      if (right.deadline === undefined) return -1
      return left.deadline - right.deadline || left.index - right.index
    }
    if (sort === 'importance-desc') {
      const difference = Number(right.task.importance === 'high') - Number(left.task.importance === 'high')
      return difference || newestFirst(left, right)
    }
    if (sort === 'title-asc') return left.task.title.localeCompare(right.task.title, 'ru') || left.index - right.index
    return newestFirst(left, right)
  })

  return prepared.map((item) => item.task)
}

function newestFirst(left: { createdAt: number; index: number }, right: { createdAt: number; index: number }) {
  return right.createdAt - left.createdAt || left.index - right.index
}
