export const HABIT_TREND_PRESETS = [14, 30, 90, 365] as const

export const HABIT_TREND_MAX_DAYS = 365

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function assertValidDate(date: Date, label: string) {
  if (Number.isNaN(date.getTime())) throw new RangeError(`${label} must be a valid Date`)
}

function assertDayCount(count: number, label: string, maximum = HABIT_TREND_MAX_DAYS) {
  if (!Number.isInteger(count) || count < 1 || count > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`)
  }
}

/** Parses a strict YYYY-MM-DD key without passing through UTC. */
export function parseDateKey(key: string): Date | undefined {
  const match = DATE_KEY_PATTERN.exec(key)
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const result = new Date(0)
  result.setHours(0, 0, 0, 0)
  result.setFullYear(year, month - 1, day)

  if (
    result.getFullYear() !== year
    || result.getMonth() !== month - 1
    || result.getDate() !== day
  ) return undefined

  return result
}

/** Moves by local calendar days and always returns a new local-midnight Date. */
export function shiftLocalDate(date: Date, delta: number): Date {
  assertValidDate(date, 'date')
  if (!Number.isInteger(delta)) throw new RangeError('delta must be an integer')

  const result = new Date(date.getTime())
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() + delta)
  return result
}

/** Returns `count` ascending local dates, including `end` as the last day. */
export function getRollingDays(end: Date, count: number): Date[] {
  assertValidDate(end, 'end')
  assertDayCount(count, 'count')

  const lastDay = shiftLocalDate(end, 0)
  return Array.from(
    { length: count },
    (_, index) => shiftLocalDate(lastDay, index - count + 1),
  )
}

/** Returns an inclusive ascending range of strict local date keys. */
export function getInclusiveDays(
  startKey: string,
  endKey: string,
  maxDays = HABIT_TREND_MAX_DAYS,
): Date[] {
  assertDayCount(maxDays, 'maxDays')

  const start = parseDateKey(startKey)
  const end = parseDateKey(endKey)
  if (!start) throw new Error(`Invalid start date key: ${startKey}`)
  if (!end) throw new Error(`Invalid end date key: ${endKey}`)
  if (start.getTime() > end.getTime()) throw new Error('Start date must not be after end date')

  const days: Date[] = []
  let cursor = start
  while (cursor.getTime() <= end.getTime()) {
    if (days.length >= maxDays) {
      throw new RangeError(`Date range must not exceed ${maxDays} days`)
    }
    days.push(cursor)
    cursor = shiftLocalDate(cursor, 1)
  }
  return days
}
