import { describe, expect, it } from 'vitest'
import {
  getInclusiveDays,
  getRollingDays,
  HABIT_TREND_MAX_DAYS,
  HABIT_TREND_PRESETS,
  parseDateKey,
  shiftLocalDate,
} from './habitTrendRange'

function keys(days: Date[]) {
  return days.map((date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-'))
}

describe('habit trend date ranges', () => {
  it('publishes the supported presets and hard limit', () => {
    expect(HABIT_TREND_PRESETS).toEqual([14, 30, 90, 365])
    expect(HABIT_TREND_MAX_DAYS).toBe(365)
  })

  it('parses only real strict date keys as local midnight', () => {
    const leapDay = parseDateKey('2024-02-29')

    expect(leapDay).toBeDefined()
    expect(keys([leapDay!])).toEqual(['2024-02-29'])
    expect(leapDay?.getHours()).toBe(0)
    expect(leapDay?.getMinutes()).toBe(0)
    expect(parseDateKey('2023-02-29')).toBeUndefined()
    expect(parseDateKey('2024-2-09')).toBeUndefined()
    expect(parseDateKey('not-a-date')).toBeUndefined()
  })

  it('shifts by local calendar day without mutating the source date', () => {
    const beforeDst = parseDateKey('2024-03-10')!
    const afterDst = shiftLocalDate(beforeDst, 1)

    expect(keys([beforeDst, afterDst])).toEqual(['2024-03-10', '2024-03-11'])
    expect(afterDst.getHours()).toBe(0)
    expect(keys([beforeDst])).toEqual(['2024-03-10'])
  })

  it('returns an ascending rolling window ending on the requested local day', () => {
    const end = new Date(2026, 7, 21, 18, 45)
    const days = getRollingDays(end, 3)

    expect(keys(days)).toEqual(['2026-08-19', '2026-08-20', '2026-08-21'])
    expect(days.every((date) => date.getHours() === 0 && date.getMinutes() === 0)).toBe(true)
    expect(end.getHours()).toBe(18)
  })

  it('rejects rolling counts outside 1 through 365', () => {
    const end = new Date(2026, 7, 21)

    for (const count of [0, -1, 1.5, HABIT_TREND_MAX_DAYS + 1]) {
      expect(() => getRollingDays(end, count)).toThrow(RangeError)
    }
  })

  it('returns inclusive ascending custom ranges', () => {
    expect(keys(getInclusiveDays('2026-08-19', '2026-08-21'))).toEqual([
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
    ])
    expect(keys(getInclusiveDays('2026-08-21', '2026-08-21'))).toEqual(['2026-08-21'])
  })

  it('rejects invalid and reversed custom ranges clearly', () => {
    expect(() => getInclusiveDays('2026-02-30', '2026-03-01')).toThrow('Invalid start date key')
    expect(() => getInclusiveDays('2026-03-01', 'bad')).toThrow('Invalid end date key')
    expect(() => getInclusiveDays('2026-03-02', '2026-03-01')).toThrow('Start date must not be after end date')
  })

  it('accepts 365 days and rejects longer or caller-limited ranges', () => {
    expect(getInclusiveDays('2025-01-01', '2025-12-31')).toHaveLength(365)
    expect(() => getInclusiveDays('2024-01-01', '2024-12-31')).toThrow(RangeError)
    expect(() => getInclusiveDays('2026-08-19', '2026-08-21', 2)).toThrow(RangeError)
    expect(() => getInclusiveDays('2026-08-19', '2026-08-21', 366)).toThrow(RangeError)
  })
})
