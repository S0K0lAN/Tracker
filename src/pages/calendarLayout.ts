import {
  DEFAULT_PLANNED_DURATION_MINUTES,
  MAX_PLANNED_DURATION_MINUTES,
  type Task,
} from '../domain/models'

export const MINUTES_IN_DAY = 24 * 60
export const DEFAULT_EVENT_DURATION_MINUTES = DEFAULT_PLANNED_DURATION_MINUTES
const EVENT_GAP_PX = 4
const MIN_EVENT_HEIGHT_PX = 24

export function startOfLocalDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function startOfWeek(date: Date) {
  const first = startOfLocalDay(date)
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  return first
}

export function addLocalDays(value: Date, amount: number) {
  const date = new Date(value)
  date.setDate(date.getDate() + amount)
  return date
}

export function localDayNumber(value: Date) {
  return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000)
}

export function differenceInLocalDays(left: Date, right: Date) {
  return localDayNumber(left) - localDayNumber(right)
}

export function sameLocalDate(left: Date, right: Date) {
  return differenceInLocalDays(left, right) === 0
}

function validDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function getTaskPlannedDurationMinutes(task: Task) {
  const duration = task.plannedDurationMinutes
  return Number.isInteger(duration) && duration >= 1 && duration <= MAX_PLANNED_DURATION_MINUTES
    ? duration
    : DEFAULT_EVENT_DURATION_MINUTES
}

export interface TaskDateRange {
  start: Date
  end: Date
}

export function getTaskDateRange(task: Task): TaskDateRange | null {
  const plannedStart = validDate(task.startAt)
  const deadline = validDate(task.deadline)
  if (!plannedStart && !deadline) return null

  const end = startOfLocalDay(deadline ?? plannedStart!)
  const proposedStart = startOfLocalDay(plannedStart ?? deadline!)
  return {
    start: proposedStart.getTime() <= end.getTime() ? proposedStart : end,
    end,
  }
}

export function tasksForLocalDate(tasks: Task[], date: Date) {
  return tasks.filter((task) => {
    const plannedStart = validDate(task.startAt)
    const deadline = validDate(task.deadline)
    return Boolean(
      (plannedStart && sameLocalDate(plannedStart, date))
      || (deadline && sameLocalDate(deadline, date)),
    )
  })
}

export function tasksForMonthDate(tasks: Task[], date: Date) {
  const day = localDayNumber(date)
  return tasks.filter((task) => {
    const range = getTaskDateRange(task)
    return range
      ? localDayNumber(range.start) <= day && day <= localDayNumber(range.end)
      : false
  })
}

export interface PositionedTimedTask {
  task: Task
  top: number
  height: number
  column: number
  columnCount: number
  startMinute: number
  endMinute: number
  durationMinutes: number
}

interface TimedLayoutOptions {
  startHour?: number
  endHour?: number
  hourHeight?: number
}

export function layoutTimedDayTasks(
  tasks: Task[],
  { startHour = 0, endHour = 24, hourHeight = 36 }: TimedLayoutOptions = {},
): PositionedTimedTask[] {
  const visibleStart = startHour * 60
  const visibleEnd = endHour * 60
  const pixelsPerMinute = hourHeight / 60
  const minimumVisualMinutes = MIN_EVENT_HEIGHT_PX / pixelsPerMinute
  const sorted = tasks
    .map((task, index) => {
      const startAt = validDate(task.startAt)
      if (!startAt) return null
      const rawStart = startAt.getHours() * 60 + startAt.getMinutes()
      const rawEnd = Math.min(
        MINUTES_IN_DAY,
        rawStart + getTaskPlannedDurationMinutes(task),
      )
      if (rawStart >= visibleEnd || rawEnd <= visibleStart) return null
      const start = Math.max(visibleStart, rawStart)
      const end = Math.min(visibleEnd, rawEnd)
      return {
        task,
        index,
        start,
        end,
        layoutEnd: Math.min(visibleEnd, Math.max(end, start + minimumVisualMinutes)),
        durationMinutes: rawEnd - rawStart,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.start - right.start || left.layoutEnd - right.layoutEnd || left.index - right.index)

  const result: PositionedTimedTask[] = []
  let cluster: typeof sorted = []
  let clusterEnd = -1

  const flushCluster = () => {
    if (!cluster.length) return
    const columnEnds: number[] = []
    const placed = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.start)
      if (column === -1) column = columnEnds.length
      columnEnds[column] = item.layoutEnd
      return { ...item, column }
    })
    const columnCount = Math.max(1, columnEnds.length)
    placed.forEach((item) => result.push({
      task: item.task,
      top: (item.start - visibleStart) * pixelsPerMinute,
      height: Math.max(MIN_EVENT_HEIGHT_PX, (item.end - item.start) * pixelsPerMinute - EVENT_GAP_PX),
      column: item.column,
      columnCount,
      startMinute: item.start,
      endMinute: item.end,
      durationMinutes: item.durationMinutes,
    }))
    cluster = []
    clusterEnd = -1
  }

  sorted.forEach((item) => {
    if (cluster.length && item.start >= clusterEnd) flushCluster()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.layoutEnd)
  })
  flushCluster()
  return result
}

export interface PositionedDeadlineRange {
  task: Task
  columnStart: number
  columnSpan: number
  lane: number
  laneCount: number
  startsBeforeView: boolean
  endsAfterView: boolean
  range: TaskDateRange
}

export function layoutDeadlineRanges(tasks: Task[], visibleStartValue: Date, visibleEndValue: Date): PositionedDeadlineRange[] {
  const visibleStart = startOfLocalDay(visibleStartValue)
  const visibleEnd = startOfLocalDay(visibleEndValue)
  const visibleDayCount = differenceInLocalDays(visibleEnd, visibleStart) + 1
  const candidates = tasks
    .map((task, index) => {
      const range = validDate(task.deadline) ? getTaskDateRange(task) : null
      if (!range || differenceInLocalDays(range.end, visibleStart) < 0 || differenceInLocalDays(range.start, visibleEnd) > 0) return null
      const columnStart = Math.max(0, differenceInLocalDays(range.start, visibleStart))
      const columnEnd = Math.min(visibleDayCount - 1, differenceInLocalDays(range.end, visibleStart))
      return {
        task,
        index,
        range,
        columnStart,
        columnEnd,
        startsBeforeView: differenceInLocalDays(range.start, visibleStart) < 0,
        endsAfterView: differenceInLocalDays(range.end, visibleEnd) > 0,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.columnStart - right.columnStart || left.columnEnd - right.columnEnd || left.index - right.index)

  const laneEnds: number[] = []
  const placed = candidates.map((item) => {
    let lane = laneEnds.findIndex((end) => end < item.columnStart)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = item.columnEnd
    return { ...item, lane }
  })
  const laneCount = Math.max(1, laneEnds.length)

  return placed.map((item) => ({
    task: item.task,
    columnStart: item.columnStart,
    columnSpan: item.columnEnd - item.columnStart + 1,
    lane: item.lane,
    laneCount,
    startsBeforeView: item.startsBeforeView,
    endsAfterView: item.endsAfterView,
    range: item.range,
  }))
}
