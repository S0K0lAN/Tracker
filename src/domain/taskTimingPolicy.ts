import type { Task } from './models'

type TaskTiming = Pick<Task, 'startAt' | 'deadline'>

function representsSameInstant(left: string | undefined, right: string | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime
}

function representsValidInstant(value: string | undefined) {
  return Boolean(value && Number.isFinite(Date.parse(value)))
}

/**
 * New or changed deadlines require a planned start. Existing deadline-only
 * records remain editable so loading legacy snapshots never forces data loss.
 */
export function taskTimingMutationRequiresStart(
  previous: TaskTiming | undefined,
  next: TaskTiming,
) {
  if (!next.deadline || representsValidInstant(next.startAt)) return false
  return !(
    previous
    && !previous.startAt
    && !next.startAt
    && representsSameInstant(previous.deadline, next.deadline)
  )
}
