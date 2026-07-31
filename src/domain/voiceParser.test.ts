import { describe, expect, it } from 'vitest'
import { parseVoiceTask } from './voiceParser'

function expectLocalDate(
  value: string | undefined,
  expected: { year: number; month: number; day: number; hours: number; minutes: number },
) {
  expect(value).toBeDefined()
  const date = new Date(value!)
  expect({
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hours: date.getHours(),
    minutes: date.getMinutes(),
  }).toEqual(expected)
}

describe('voice task parser', () => {
  const now = new Date(2026, 6, 30, 8, 15)

  it('keeps an ordinary phrase as the task title', () => {
    expect(parseVoiceTask('  Купить   молоко  ', now)).toEqual({
      title: 'Купить молоко',
      deadline: undefined,
      importance: undefined,
      tags: [],
      projectHint: undefined,
    })
  })

  it('extracts a relative deadline, time, importance, unique tags and project', () => {
    const parsed = parseVoiceTask(
      'Подготовить отчёт в проект Альфа завтра в 10:30 важно #Работа #работа',
      now,
    )

    expect(parsed).toMatchObject({
      title: 'Подготовить отчёт',
      importance: 'high',
      tags: ['работа'],
      projectHint: 'Альфа',
    })
    expectLocalDate(parsed.deadline, {
      year: 2026,
      month: 6,
      day: 31,
      hours: 10,
      minutes: 30,
    })
  })

  it('understands a weekday with a spoken deadline time', () => {
    const parsed = parseVoiceTask('Позвонить врачу в пятницу до 14 #здоровье', now)

    expect(parsed.title).toBe('Позвонить врачу')
    expect(parsed.tags).toEqual(['здоровье'])
    expectLocalDate(parsed.deadline, {
      year: 2026,
      month: 6,
      day: 31,
      hours: 14,
      minutes: 0,
    })
  })

  it('moves the same named weekday to the following week', () => {
    const friday = new Date(2026, 6, 31, 12)
    const parsed = parseVoiceTask('Провести ревью в пятницу', friday)

    expect(parsed.title).toBe('Провести ревью')
    expectLocalDate(parsed.deadline, {
      year: 2026,
      month: 7,
      day: 7,
      hours: 18,
      minutes: 0,
    })
  })

  it('uses the default 18:00 time for a date without a spoken time', () => {
    const parsed = parseVoiceTask('Отправить документы послезавтра', now)

    expect(parsed.title).toBe('Отправить документы')
    expectLocalDate(parsed.deadline, {
      year: 2026,
      month: 7,
      day: 1,
      hours: 18,
      minutes: 0,
    })
  })
})
