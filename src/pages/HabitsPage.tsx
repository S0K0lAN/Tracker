import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Check, Flame, Plus, X } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import type { Habit, Task } from '../domain/models'
import { useApp } from '../state/AppContext'
import './habits.css'

export const HABIT_ICONS = [
  { value: '✨', label: 'Искры' },
  { value: '💧', label: 'Вода' },
  { value: '📚', label: 'Книга' },
  { value: '🌿', label: 'Природа' },
  { value: '🏃', label: 'Бег' },
  { value: '🧘', label: 'Медитация' },
  { value: '🥗', label: 'Питание' },
  { value: '😴', label: 'Сон' },
  { value: '🎯', label: 'Цель' },
  { value: '☀️', label: 'Солнце' },
] as const

export const toDateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

function atStartOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function getCurrentStreak(habit: Habit, now: Date) {
  const cursor = atStartOfDay(now)
  let streak = 0

  for (let offset = 0; offset < 366; offset += 1) {
    const isScheduled = habit.targetDays.includes(cursor.getDay())
    if (isScheduled) {
      const isDone = habit.completions.includes(toDateKey(cursor))
      const isToday = offset === 0

      if (isDone) streak += 1
      else if (!isToday) break
    }
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

export interface HabitRhythm {
  scheduled: number
  completed: number
  progress: number
  streak: number
  isScheduledToday: boolean
  isCompletedToday: boolean
}

export function getHabitRhythm(habit: Habit, days: Date[], now = new Date()): HabitRhythm {
  const today = atStartOfDay(now)
  const elapsedScheduledDays = days.filter((day) => {
    const normalizedDay = atStartOfDay(day)
    return normalizedDay <= today && habit.targetDays.includes(normalizedDay.getDay())
  })
  const completed = elapsedScheduledDays.filter((day) => habit.completions.includes(toDateKey(day))).length
  const scheduled = elapsedScheduledDays.length

  return {
    scheduled,
    completed,
    progress: scheduled ? Math.round((completed / scheduled) * 100) : 0,
    streak: getCurrentStreak(habit, today),
    isScheduledToday: habit.targetDays.includes(today.getDay()),
    isCompletedToday: habit.completions.includes(toDateKey(today)),
  }
}

export interface CompletionTrendPoint {
  date: Date
  dateKey: string
  habits: number
  tasks: number
}

export function getCompletionTrend(habits: Habit[], tasks: Task[], days: Date[]): CompletionTrendPoint[] {
  return days.map((date) => {
    const dateKey = toDateKey(date)
    return {
      date,
      dateKey,
      habits: habits.filter((habit) => habit.completions.includes(dateKey)).length,
      tasks: tasks.filter((task) => task.completedAt && toDateKey(new Date(task.completedAt)) === dateKey).length,
    }
  })
}

function getTodayStatus(rhythm: HabitRhythm) {
  if (!rhythm.isScheduledToday) return 'Сегодня день отдыха'
  return rhythm.isCompletedToday ? 'Выполнено сегодня' : 'Ждёт отметки сегодня'
}

export function HabitsPage() {
  const { state, toggleHabit, addHabit } = useApp()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<(typeof HABIT_ICONS)[number]['value']>('✨')
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = atStartOfDay(new Date())
    date.setDate(date.getDate() - 6 + index)
    return date
  }), [])
  const trendDays = useMemo(() => Array.from({ length: 14 }, (_, index) => {
    const date = atStartOfDay(new Date())
    date.setDate(date.getDate() - 13 + index)
    return date
  }), [])

  const rhythms = useMemo(
    () => new Map(state.habits.map((habit) => [habit.id, getHabitRhythm(habit, days)])),
    [days, state.habits],
  )
  const completionTrend = useMemo(
    () => getCompletionTrend(state.habits, state.tasks, trendDays),
    [state.habits, state.tasks, trendDays],
  )
  const trendMaximum = Math.max(1, ...completionTrend.flatMap((point) => [point.habits, point.tasks]))

  const closeForm = () => {
    setAdding(false)
    setName('')
    setDescription('')
    setIcon('✨')
  }

  const createHabit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!name.trim()) return
    addHabit({
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      icon,
      targetDays: [1, 2, 3, 4, 5, 6, 0],
      completions: [],
      color: '#d78b69',
    })
    closeForm()
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Маленькие шаги"
        title="Трекер привычек"
        description="Последовательность важнее идеальности"
        actions={<button className="button button--primary" onClick={() => setAdding(true)}><Plus size={18} /> Новая привычка</button>}
      />

      <section className="habit-rhythm" aria-labelledby="habit-rhythm-title">
        <div className="habit-rhythm__heading">
          <div>
            <span className="eyebrow">Ваш ритм</span>
            <h2 id="habit-rhythm-title">Каждая привычка — в своём темпе</h2>
          </div>
          <p>Прогресс считается только по плановым дням конкретной привычки за последние семь дней.</p>
          <button className="button button--primary habit-rhythm__mobile-add" onClick={() => setAdding(true)}>
            <Plus size={16} /> Добавить привычку
          </button>
        </div>
        <div className="habit-rhythm__grid">
          {state.habits.map((habit) => {
            const rhythm = rhythms.get(habit.id) ?? getHabitRhythm(habit, days)
            return (
              <article className="habit-rhythm-card" key={habit.id} aria-label={`Ритм привычки ${habit.name}`}>
                <span className="habit-rhythm-card__icon" style={{ background: `${habit.color}22`, color: habit.color }} aria-hidden="true"><span className="habit-emoji">{habit.icon}</span></span>
                <div className="habit-rhythm-card__copy">
                  <h3>{habit.name}</h3>
                  <p>{getTodayStatus(rhythm)}</p>
                </div>
                <div
                  className="habit-rhythm-card__ring"
                  style={{ '--habit-progress': `${rhythm.progress * 3.6}deg` } as CSSProperties}
                  aria-label={`${rhythm.progress}% за семь дней`}
                >
                  <strong>{rhythm.progress}%</strong>
                </div>
                <div className="habit-rhythm-card__stats">
                  <span>{rhythm.completed} из {rhythm.scheduled} плановых дней</span>
                  <span><Flame size={14} aria-hidden="true" /> Серия: {rhythm.streak}</span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="habit-trend" aria-labelledby="habit-trend-title">
        <header>
          <div><span className="eyebrow">Последние 14 дней</span><h2 id="habit-trend-title">Выполнения по дням</h2></div>
          <div className="habit-trend__legend" aria-label="Легенда графика"><span><i className="is-habit" /> Привычки</span><span><i className="is-task" /> Задачи</span></div>
        </header>
        <div className="habit-trend__chart" role="img" aria-label="График выполненных привычек и задач за последние четырнадцать дней">
          {completionTrend.map((point) => (
            <div
              className={`habit-trend__day ${point.dateKey === toDateKey(new Date()) ? 'is-today' : ''}`}
              key={point.dateKey}
              aria-label={`${point.date.toLocaleDateString('ru-RU')}: привычек ${point.habits}, задач ${point.tasks}`}
            >
              <span className="habit-trend__values" aria-hidden="true">
                <i className="is-habit" style={{ '--bar-height': `${Math.max(point.habits ? 10 : 2, (point.habits / trendMaximum) * 100)}%` } as CSSProperties}><em>{point.habits || ''}</em></i>
                <i className="is-task" style={{ '--bar-height': `${Math.max(point.tasks ? 10 : 2, (point.tasks / trendMaximum) * 100)}%` } as CSSProperties}><em>{point.tasks || ''}</em></i>
              </span>
              <small>{point.date.toLocaleDateString('ru-RU', { weekday: 'short' })}<strong>{point.date.getDate()}</strong></small>
            </div>
          ))}
        </div>
      </section>

      {adding && (
        <form className="inline-form inline-form--habit" onSubmit={createHabit}>
          <span className="inline-form__icon" aria-hidden="true"><span className="habit-emoji">{icon}</span></span>
          <div className="habit-form__fields">
            <label>
              <span>Название привычки</span>
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, утренняя зарядка" />
            </label>
            <label>
              <span>Описание <small>необязательно</small></span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Зачем эта привычка и что считается выполнением" rows={2} />
            </label>
          </div>
          <fieldset className="habit-icon-picker">
            <legend>Иконка привычки</legend>
            <div>
              {HABIT_ICONS.map((item) => (
                <label key={item.value} className={icon === item.value ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="habit-icon"
                    value={item.value}
                    checked={icon === item.value}
                    onChange={() => setIcon(item.value)}
                    aria-label={item.label}
                  />
                  <span className="habit-emoji" aria-hidden="true">{item.value}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="habit-form__actions">
            <button className="button button--primary" type="submit">Создать</button>
            <button className="icon-button" type="button" onClick={closeForm} aria-label="Отменить добавление"><X /></button>
          </div>
        </form>
      )}

      <section className="habit-list" aria-labelledby="habit-week-title">
        <div className="habit-list__header">
          <div><h2 id="habit-week-title">Эта неделя</h2><p>Отмечайте выполнение отдельно для каждой привычки</p></div>
          <div className="week-labels">
            {days.map((day) => <span key={toDateKey(day)}>{day.toLocaleDateString('ru-RU', { weekday: 'short' })}<strong>{day.getDate()}</strong></span>)}
          </div>
          <span className="habit-list__streak-label">Серия</span>
        </div>
        {state.habits.map((habit) => {
          const rhythm = rhythms.get(habit.id) ?? getHabitRhythm(habit, days)
          return (
            <article className="habit-row" key={habit.id} aria-label={`Привычка ${habit.name}`}>
              <div className="habit-row__identity">
                <span className="habit-row__icon" style={{ background: `${habit.color}22`, color: habit.color }} aria-hidden="true"><span className="habit-emoji">{habit.icon}</span></span>
                <div className="habit-row__title">
                  <strong>{habit.name}</strong>
                  {habit.description && <p>{habit.description}</p>}
                  <small>{rhythm.completed} из {rhythm.scheduled} плановых дней</small>
                </div>
              </div>
              <div className="habit-checks">
                {days.map((day) => {
                  const key = toDateKey(day)
                  const done = habit.completions.includes(key)
                  const scheduled = habit.targetDays.includes(day.getDay())
                  const future = atStartOfDay(day) > atStartOfDay(new Date())
                  const disabled = future || (!scheduled && !done)
                  const dayLabel = day.toLocaleDateString('ru-RU')
                  const actionLabel = scheduled || done
                    ? `${done ? 'Отменить' : 'Отметить'} ${habit.name} ${dayLabel}`
                    : `${habit.name} не запланирована ${dayLabel}`
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={disabled}
                      className={`${done ? 'is-done' : ''} ${!scheduled ? 'is-rest' : ''}`}
                      onClick={() => toggleHabit(habit.id, key)}
                      aria-label={actionLabel}
                    >{done ? <Check size={16} strokeWidth={3} /> : <span />}</button>
                  )
                })}
              </div>
              <span className="habit-row__streak" aria-label={`Текущая серия ${rhythm.streak}`}>
                <Flame size={16} aria-hidden="true" /> {rhythm.streak}
              </span>
            </article>
          )
        })}
      </section>
    </main>
  )
}
