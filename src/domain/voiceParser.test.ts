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
      startAt: undefined,
      deadline: undefined,
      importance: undefined,
      tags: [],
      projectHint: undefined,
    })
  })

  it('uses an unmarked relative date and time as the planned start', () => {
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
    expect(parsed.deadline).toBeUndefined()
    expectLocalDate(parsed.startAt, {
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
    expect(parsed.startAt).toBeUndefined()
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
    expect(parsed.deadline).toBeUndefined()
    expectLocalDate(parsed.startAt, {
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
    expect(parsed.deadline).toBeUndefined()
    expectLocalDate(parsed.startAt, {
      year: 2026,
      month: 7,
      day: 1,
      hours: 18,
      minutes: 0,
    })
  })

  it.each([
    'Подготовить презентацию дедлайн завтра в 12:15',
    'Подготовить презентацию срок завтра в 12:15',
    'Подготовить презентацию до завтра в 12:15',
  ])('routes a date to the deadline for an explicit marker: %s', (transcript) => {
    const parsed = parseVoiceTask(transcript, now)

    expect(parsed.title).toBe('Подготовить презентацию')
    expect(parsed.startAt).toBeUndefined()
    expectLocalDate(parsed.deadline, {
      year: 2026,
      month: 6,
      day: 31,
      hours: 12,
      minutes: 15,
    })
  })

  it('understands a genitive weekday after «до» without treating an ordinary «до» as a deadline marker', () => {
    const deadline = parseVoiceTask('Закончить макет до пятницы в 14', now)
    const planned = parseVoiceTask('Дойти до магазина завтра в 14', now)

    expect(deadline.title).toBe('Закончить макет')
    expect(deadline.startAt).toBeUndefined()
    expectLocalDate(deadline.deadline, {
      year: 2026,
      month: 6,
      day: 31,
      hours: 14,
      minutes: 0,
    })
    expect(planned.title).toBe('Дойти до магазина')
    expect(planned.deadline).toBeUndefined()
    expectLocalDate(planned.startAt, {
      year: 2026,
      month: 6,
      day: 31,
      hours: 14,
      minutes: 0,
    })
  })
})
