import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import {
  Activity,
  Apple,
  BookOpen,
  Brain,
  Check,
  Droplets,
  Flame,
  Leaf,
  Moon,
  Pencil,
  Plus,
  Sparkles,
  Sun,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import type { Habit, Task } from '../domain/models'
import { INPUT_LIMITS } from '../domain/inputLimits'
import { useApp } from '../state/AppContext'
import { useNow } from '../hooks/useNow'
import {
  HABIT_TREND_MAX_DAYS,
  HABIT_TREND_PRESETS,
  getInclusiveDays,
  getRollingDays,
  parseDateKey,
  shiftLocalDate,
} from './habitTrendRange'
import './habits.css'

export const HABIT_ICONS = [
  { value: 'sparkles', label: 'Искры', Icon: Sparkles },
  { value: 'water', label: 'Вода', Icon: Droplets },
  { value: 'book', label: 'Книга', Icon: BookOpen },
  { value: 'nature', label: 'Природа', Icon: Leaf },
  { value: 'activity', label: 'Движение', Icon: Activity },
  { value: 'mindfulness', label: 'Медитация', Icon: Brain },
  { value: 'nutrition', label: 'Питание', Icon: Apple },
  { value: 'sleep', label: 'Сон', Icon: Moon },
  { value: 'target', label: 'Цель', Icon: Target },
  { value: 'sun', label: 'Солнце', Icon: Sun },
] as const satisfies ReadonlyArray<{ value: string; label: string; Icon: LucideIcon }>

export const HABIT_CHECK_DAYS = 14

const LEGACY_HABIT_ICONS: Record<string, (typeof HABIT_ICONS)[number]['value']> = {
  '✨': 'sparkles',
  '💧': 'water',
  '📚': 'book',
  '🌿': 'nature',
  '🏃': 'activity',
  '🧘': 'mindfulness',
  '🥗': 'nutrition',
  '😴': 'sleep',
  '🎯': 'target',
  '☀️': 'sun',
}

export function normalizeHabitIcon(value: string) {
  const normalized = LEGACY_HABIT_ICONS[value] ?? value
  return HABIT_ICONS.some((item) => item.value === normalized) ? normalized : 'sparkles'
}

function HabitIcon({ value, size = 19 }: { value: string; size?: number }) {
  const normalized = normalizeHabitIcon(value)
  const Icon = HABIT_ICONS.find((item) => item.value === normalized)?.Icon ?? Sparkles
  return <Icon size={size} strokeWidth={2} data-habit-icon={normalized} aria-hidden="true" />
}

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

type HabitTrendPreset = (typeof HABIT_TREND_PRESETS)[number] | 'custom'

function formatTrendRange(days: Date[]) {
  if (!days.length) return ''
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  return `${days[0].toLocaleDateString('ru-RU', options)} — ${days[days.length - 1].toLocaleDateString('ru-RU', options)}`
}

function getDayNoun(count: number) {
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  return lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'дней'
    : lastDigit === 1
      ? 'день'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'дня'
        : 'дней'
}

function formatDayCount(count: number) {
  return `${count} ${getDayNoun(count)}`
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
  const { state, toggleHabit, addHabit, updateHabit } = useApp()
  const now = useNow()
  const todayKey = toDateKey(now)
  const today = useMemo(() => atStartOfDay(now), [todayKey])
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<(typeof HABIT_ICONS)[number]['value']>('sparkles')
  const [trendPreset, setTrendPreset] = useState<HabitTrendPreset>(30)
  const [customTrendStart, setCustomTrendStart] = useState(() => toDateKey(shiftLocalDate(atStartOfDay(new Date()), -29)))
  const [customTrendEnd, setCustomTrendEnd] = useState(() => toDateKey(atStartOfDay(new Date())))
  const trendViewportRef = useRef<HTMLDivElement>(null)
  const days = useMemo(() => getRollingDays(today, HABIT_CHECK_DAYS), [today])
  const trendDays = useMemo(
    () => trendPreset === 'custom'
      ? getInclusiveDays(customTrendStart, customTrendEnd)
      : getRollingDays(today, trendPreset),
    [customTrendEnd, customTrendStart, today, trendPreset],
  )
  const trendStartKey = toDateKey(trendDays[0])
  const trendEndKey = toDateKey(trendDays.at(-1) ?? today)

  const rhythms = useMemo(
    () => new Map(state.habits.map((habit) => [habit.id, getHabitRhythm(habit, days, today)])),
    [days, state.habits, today],
  )
  const completionTrend = useMemo(
    () => getCompletionTrend(state.habits, state.tasks, trendDays),
    [state.habits, state.tasks, trendDays],
  )
  const trendMaximum = Math.max(1, ...completionTrend.flatMap((point) => [point.habits, point.tasks]))
  const trendTotals = completionTrend.reduce(
    (totals, point) => ({ habits: totals.habits + point.habits, tasks: totals.tasks + point.tasks }),
    { habits: 0, tasks: 0 },
  )
  const trendRangeLabel = formatTrendRange(trendDays)
  const trendDayCountLabel = formatDayCount(trendDays.length)
  const trendChartLabel = `График выполненных привычек и задач за период ${trendRangeLabel}, ${trendDayCountLabel}. Подробные значения приведены в таблице после графика.`

  useEffect(() => {
    const viewport = trendViewportRef.current
    if (viewport) viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth
  }, [trendEndKey, trendStartKey])

  const selectTrendPreset = (preset: (typeof HABIT_TREND_PRESETS)[number]) => {
    setTrendPreset(preset)
  }

  const changeTrendStart = (value: string) => {
    const requestedStart = parseDateKey(value)
    const currentEnd = parseDateKey(trendEndKey) ?? today
    if (!requestedStart) return
    const nextStart = requestedStart > today ? today : requestedStart
    const latestEnd = shiftLocalDate(nextStart, HABIT_TREND_MAX_DAYS - 1)
    const nextEnd = currentEnd < nextStart
      ? nextStart
      : currentEnd > latestEnd
        ? latestEnd
        : currentEnd
    setCustomTrendStart(toDateKey(nextStart))
    setCustomTrendEnd(toDateKey(nextEnd > today ? today : nextEnd))
    setTrendPreset('custom')
  }

  const changeTrendEnd = (value: string) => {
    const requestedEnd = parseDateKey(value)
    const currentStart = parseDateKey(trendStartKey) ?? today
    if (!requestedEnd) return
    const nextEnd = requestedEnd > today ? today : requestedEnd
    const earliestStart = shiftLocalDate(nextEnd, -(HABIT_TREND_MAX_DAYS - 1))
    const nextStart = currentStart > nextEnd ? nextEnd : currentStart < earliestStart ? earliestStart : currentStart
    setCustomTrendStart(toDateKey(nextStart))
    setCustomTrendEnd(toDateKey(nextEnd))
    setTrendPreset('custom')
  }

  const closeForm = () => {
    setAdding(false)
    setEditingId(undefined)
    setName('')
    setDescription('')
    setIcon('sparkles')
  }

  const openCreate = () => {
    closeForm()
    setAdding(true)
  }

  const openEdit = (habit: Habit) => {
    setAdding(false)
    setEditingId(habit.id)
    setName(habit.name)
    setDescription(habit.description ?? '')
    setIcon(normalizeHabitIcon(habit.icon))
  }

  const saveHabit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!name.trim()) return
    const existing = state.habits.find((habit) => habit.id === editingId)
    const habit: Habit = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      icon,
      targetDays: existing?.targetDays ?? [1, 2, 3, 4, 5, 6, 0],
      completions: existing?.completions ?? [],
      color: existing?.color ?? '#d78b69',
    }
    if (existing) updateHabit(habit)
    else addHabit(habit)
    closeForm()
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Маленькие шаги"
        title="Трекер привычек"
        description="Последовательность важнее идеальности"
      />

      <section className="habit-rhythm" aria-labelledby="habit-rhythm-title">
        <div className="habit-rhythm__heading">
          <div>
            <span className="eyebrow">Ваш ритм</span>
            <h2 id="habit-rhythm-title">Каждая привычка — в своём темпе</h2>
          </div>
          <p>Прогресс считается только по плановым дням конкретной привычки за последние 14 дней.</p>
          <button className="button button--primary habit-rhythm__add" onClick={openCreate}>
            <Plus size={16} /> Новая привычка
          </button>
        </div>
        <div className="habit-rhythm__grid">
          {state.habits.map((habit) => {
            const rhythm = rhythms.get(habit.id) ?? getHabitRhythm(habit, days)
            return (
              <article className="habit-rhythm-card" key={habit.id} aria-label={`Ритм привычки ${habit.name}`}>
                <span className="habit-rhythm-card__icon" style={{ background: `${habit.color}22`, color: habit.color }}><HabitIcon value={habit.icon} /></span>
                <div className="habit-rhythm-card__copy">
                  <h3>{habit.name}</h3>
                  <p>{getTodayStatus(rhythm)}</p>
                </div>
                <div
                  className="habit-rhythm-card__ring"
                  style={{ '--habit-progress': `${rhythm.progress * 3.6}deg` } as CSSProperties}
                  aria-label={`${rhythm.progress}% за последние 14 дней`}
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
          <div className="habit-trend__header-copy">
            <span className="eyebrow">{trendRangeLabel}</span>
            <h2 id="habit-trend-title">Выполнения по дням</h2>
          </div>
          <div className="habit-trend__toolbar">
            <div className="habit-trend__presets" role="group" aria-label="Быстрый диапазон диаграммы">
              {HABIT_TREND_PRESETS.map((preset) => (
                <button
                  type="button"
                  className="habit-trend__preset"
                  aria-pressed={trendPreset === preset}
                  key={preset}
                  onClick={() => selectTrendPreset(preset)}
                >
                  {preset} дней
                </button>
              ))}
            </div>
            <div className="habit-trend__dates">
              <label className="habit-trend__date-field">
                <span>Начало периода</span>
                <input
                  type="date"
                  value={trendStartKey}
                  max={todayKey}
                  onChange={(event) => changeTrendStart(event.target.value)}
                />
              </label>
              <label className="habit-trend__date-field">
                <span>Конец периода</span>
                <input
                  type="date"
                  value={trendEndKey}
                  max={todayKey}
                  onChange={(event) => changeTrendEnd(event.target.value)}
                />
              </label>
            </div>
          </div>
        </header>
        <div className="habit-trend__summary" aria-live="polite">
          <span><strong>{trendDays.length}</strong> {getDayNoun(trendDays.length)}</span>
          <span><i className="is-habit" aria-hidden="true" /><strong>{trendTotals.habits}</strong> выполнений привычек</span>
          <span><i className="is-task" aria-hidden="true" /><strong>{trendTotals.tasks}</strong> выполненных задач</span>
          <div className="habit-trend__legend" aria-label="Легенда графика"><span><i className="is-habit" /> Привычки</span><span><i className="is-task" /> Задачи</span></div>
          <span className="habit-trend__scroll-hint" id="habit-trend-scroll-hint">Прокрутите график по горизонтали</span>
        </div>
        <div ref={trendViewportRef} className="habit-trend__viewport" role="region" aria-label="Прокручиваемая диаграмма выполнений по дням" aria-describedby="habit-trend-scroll-hint" tabIndex={0}>
          <div
            className="habit-trend__chart"
            role="img"
            aria-label={trendChartLabel}
            style={{ '--trend-day-count': completionTrend.length } as CSSProperties}
          >
            {completionTrend.map((point) => (
              <div
                className={`habit-trend__day ${point.dateKey === todayKey ? 'is-today' : ''}`}
                key={point.dateKey}
                title={`${point.date.toLocaleDateString('ru-RU')}: привычки — ${point.habits}, задачи — ${point.tasks}`}
              >
                <span className="habit-trend__values" aria-hidden="true">
                  <i className="is-habit" style={{ '--bar-height': `${Math.max(point.habits ? 10 : 2, (point.habits / trendMaximum) * 100)}%` } as CSSProperties}><em>{point.habits || ''}</em></i>
                  <i className="is-task" style={{ '--bar-height': `${Math.max(point.tasks ? 10 : 2, (point.tasks / trendMaximum) * 100)}%` } as CSSProperties}><em>{point.tasks || ''}</em></i>
                </span>
                <small>{point.date.toLocaleDateString('ru-RU', { weekday: 'short' })}<strong>{point.date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</strong></small>
              </div>
            ))}
          </div>
        </div>
        <div className="visually-hidden">
          <table>
            <caption>Выполнения привычек и задач за период {trendRangeLabel} ({trendDayCountLabel})</caption>
            <thead><tr><th scope="col">Дата</th><th scope="col">Привычки</th><th scope="col">Задачи</th></tr></thead>
            <tbody>
              {completionTrend.map((point) => (
                <tr key={point.dateKey}>
                  <th scope="row">{point.date.toLocaleDateString('ru-RU')}</th>
                  <td>{point.habits}</td>
                  <td>{point.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(adding || editingId) && (
        <form className="inline-form inline-form--habit" onSubmit={saveHabit} aria-label={editingId ? 'Редактирование привычки' : 'Создание привычки'}>
          <span className="inline-form__icon"><HabitIcon value={icon} size={22} /></span>
          <div className="habit-form__fields">
            <label>
              <span>Название привычки</span>
              <input autoFocus maxLength={INPUT_LIMITS.habitName} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, утренняя зарядка" />
            </label>
            <label>
              <span>Описание <small>необязательно</small></span>
              <textarea maxLength={INPUT_LIMITS.habitDescription} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Зачем эта привычка и что считается выполнением" rows={2} />
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
                  <item.Icon size={20} aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="habit-form__actions">
            <button className="button button--primary" type="submit">{editingId ? 'Сохранить' : 'Создать'}</button>
            <button className="icon-button" type="button" onClick={closeForm} aria-label={editingId ? 'Отменить редактирование' : 'Отменить добавление'}><X /></button>
          </div>
        </form>
      )}

      <section className="habit-list" aria-labelledby="habit-week-title">
        <div className="habit-list__header">
          <div><h2 id="habit-week-title">Последние 14 дней</h2><p>Отмечайте выполнение отдельно для каждой привычки</p></div>
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
                <span className="habit-row__icon" style={{ background: `${habit.color}22`, color: habit.color }}><HabitIcon value={habit.icon} /></span>
                <div className="habit-row__title">
                  <strong>{habit.name}</strong>
                  {habit.description && <p>{habit.description}</p>}
                  <small>{rhythm.completed} из {rhythm.scheduled} плановых дней</small>
                </div>
                <button type="button" className="icon-button habit-row__edit" onClick={() => openEdit(habit)} aria-label={`Редактировать привычку ${habit.name}`}>
                  <Pencil size={16} />
                </button>
              </div>
              <div className="habit-checks">
                {days.map((day) => {
                  const key = toDateKey(day)
                  const done = habit.completions.includes(key)
                  const scheduled = habit.targetDays.includes(day.getDay())
                  const future = atStartOfDay(day) > today
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
