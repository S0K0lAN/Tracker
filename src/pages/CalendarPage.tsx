import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, Rows3, X } from 'lucide-react'
import type { Task } from '../domain/models'
import { isOverdue, isSameLocalDay } from '../domain/models'
import { useApp } from '../state/AppContext'
import { PageHeader } from '../components/PageHeader'
import { trapTabKey } from '../components/focusTrap'
import {
  addLocalDays,
  differenceInLocalDays,
  layoutDeadlineRanges,
  layoutTimedDayTasks,
  sameLocalDate,
  startOfLocalDay,
  startOfWeek,
  tasksForLocalDate,
  type PositionedTimedTask,
} from './calendarLayout'
import './calendar-deadlines.css'

type CalendarMode = 'year' | 'month' | 'week' | 'three-days' | 'day' | 'deadlines'
type DeadlineScale = 'year' | 'month' | 'week'

const dayLabel = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const monthOnlyLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long' })
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeLabel = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const weekdayLabels = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const ALL_DAY_START_HOUR = 0
const ALL_DAY_END_HOUR = 24
const WEEK_HOUR_HEIGHT = 34
const THREE_DAY_HOUR_HEIGHT = 38
const DAY_HOUR_HEIGHT = 44
const MONTH_CELL_LIMIT = 3

function plannedDate(day: Date, hours = 9, minutes = 0) {
  const date = new Date(day)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function daysFrom(start: Date, count: number) {
  return Array.from({ length: count }, (_, index) => addLocalDays(start, index))
}

function CalendarSwipeSurface({ children, onMove }: { children: ReactNode; onMove(direction: number): void }) {
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const suppressClick = useRef(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    if (!start || start.pointerId !== event.pointerId) return
    dragStart.current = null
    const distance = event.clientX - start.x
    const changePeriod = Math.abs(distance) >= 64
    suppressClick.current = Math.abs(distance) >= 8
    setDragging(false)
    setDragOffset(0)
    if (changePeriod) onMove(distance < 0 ? 1 : -1)
    window.setTimeout(() => { suppressClick.current = false }, 0)
  }

  return (
    <div className="calendar-swipe-viewport">
      <div
        className={`calendar-swipe-surface ${dragging ? 'is-dragging' : ''}`}
        style={{ transform: `translate3d(${dragOffset}px, 0, 0)` }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return
          dragStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
        }}
        onPointerMove={(event) => {
          const start = dragStart.current
          if (!start || start.pointerId !== event.pointerId) return
          const horizontal = event.clientX - start.x
          const vertical = event.clientY - start.y
          if (Math.abs(horizontal) < 7 || Math.abs(horizontal) <= Math.abs(vertical)) return
          event.preventDefault()
          if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.setPointerCapture?.(event.pointerId)
          }
          setDragging(true)
          setDragOffset(Math.max(-150, Math.min(150, horizontal * 0.35)))
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClickCapture={(event) => {
          if (!suppressClick.current) return
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {children}
      </div>
    </div>
  )
}

function monthGridDays(anchor: Date) {
  return daysFrom(startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), 42)
}

function taskTimeRange(task: Task) {
  if (!task.startAt) return ''
  const start = new Date(task.startAt)
  if (Number.isNaN(start.getTime())) return ''
  const deadline = task.deadline ? new Date(task.deadline) : null
  if (deadline && !Number.isNaN(deadline.getTime()) && deadline.getTime() > start.getTime()) {
    const end = sameLocalDate(start, deadline)
      ? timeLabel.format(deadline)
      : `${shortDate.format(deadline)}, ${timeLabel.format(deadline)}`
    return `${timeLabel.format(start)} — ${end}`
  }
  const defaultEnd = new Date(start.getTime() + 60 * 60_000)
  return `${timeLabel.format(start)} — ${timeLabel.format(defaultEnd)}`
}

function taskDateRangeLabel(task: Task) {
  const start = task.startAt ? new Date(task.startAt) : null
  const deadline = task.deadline ? new Date(task.deadline) : null
  if (start && !Number.isNaN(start.getTime()) && deadline && !Number.isNaN(deadline.getTime()) && deadline.getTime() >= start.getTime()) {
    return `${shortDate.format(start)} — ${shortDate.format(deadline)}`
  }
  const point = deadline ?? start
  return point && !Number.isNaN(point.getTime()) ? shortDate.format(point) : ''
}

function sortTasksForDay(tasks: Task[], date: Date) {
  const momentOnDay = (task: Task) => {
    if (task.startAt && isSameLocalDay(task.startAt, date)) return new Date(task.startAt).getTime()
    if (task.deadline && isSameLocalDay(task.deadline, date)) return new Date(task.deadline).getTime()
    return startOfLocalDay(date).getTime()
  }
  return [...tasks].sort((left, right) => momentOnDay(left) - momentOnDay(right) || left.title.localeCompare(right.title, 'ru'))
}

export type PositionedWeekTask = PositionedTimedTask

export function layoutWeekDayTasks(tasks: Task[]): PositionedWeekTask[] {
  return layoutTimedDayTasks(tasks, {
    startHour: 8,
    endHour: 22,
    hourHeight: 38,
  })
}

function eventHorizontalStyle(column: number, columnCount: number) {
  const leftPercent = (column / columnCount) * 100
  const leftPixelCorrection = 4 - (8 * column) / columnCount
  const widthPercent = 100 / columnCount
  const widthPixelCorrection = 8 / columnCount + 3
  return {
    left: `calc(${leftPercent}% + ${leftPixelCorrection}px)`,
    width: `calc(${widthPercent}% - ${widthPixelCorrection}px)`,
    right: 'auto',
  }
}

export function calendarTaskLineLimit(height: number, mode: 'week' | 'three-days' | 'day') {
  const renderedHeight = Math.max(34, height)
  const verticalInsets = mode === 'week' ? 12 : 16
  const lineHeight = mode === 'week' ? 15.6 : 16.9
  return Math.max(1, Math.floor((renderedHeight - verticalInsets) / lineHeight))
}

function DayTasksDialog({
  date,
  tasks,
  onClose,
  onCreate,
  onEdit,
}: {
  date: Date
  tasks: Task[]
  onClose: () => void
  onCreate: () => void
  onEdit: (task: Task) => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  return (
    <div
      className="calendar-day-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="calendar-day-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Все задачи дня: ${fullDate.format(date)}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          } else {
            trapTabKey(event, dialogRef.current)
          }
        }}
      >
        <header>
          <div>
            <span className="eyebrow">Все задачи дня</span>
            <h2 id="calendar-day-dialog-title">{fullDate.format(date)}</h2>
          </div>
          <button ref={closeRef} className="button button--ghost button--icon" onClick={onClose} aria-label="Закрыть список задач"><X size={18} /></button>
        </header>
        <div className="calendar-day-dialog__list">
          {tasks.map((task) => (
            <button className="calendar-day-dialog__task" key={task.id} onClick={() => onEdit(task)}>
              <span className={task.deadline && isSameLocalDay(task.deadline, date) ? 'is-deadline' : ''} aria-hidden="true" />
              <strong>{task.title}</strong>
              <small>{taskTimeRange(task) || taskDateRangeLabel(task) || 'Без времени'}</small>
            </button>
          ))}
          {tasks.length === 0 && (
            <div className="calendar-day-dialog__empty">
              <CalendarDays size={24} />
              <strong>На этот день задач нет</strong>
              <span>Можно сразу запланировать первую.</span>
            </div>
          )}
        </div>
        <footer>
          <span>{tasks.length} {tasks.length === 1 ? 'задача' : tasks.length > 1 && tasks.length < 5 ? 'задачи' : 'задач'}</span>
          <button className="button button--primary" onClick={onCreate}><Plus size={17} /> Добавить задачу</button>
        </footer>
      </section>
    </div>
  )
}

function TimeCalendar({
  days,
  tasks,
  mode,
  onCreate,
  onEdit,
}: {
  days: Date[]
  tasks: Task[]
  mode: 'week' | 'three-days' | 'day'
  onCreate: (date: Date) => void
  onEdit: (task: Task) => void
}) {
  const hourHeight = mode === 'day' ? DAY_HOUR_HEIGHT : mode === 'three-days' ? THREE_DAY_HOUR_HEIGHT : WEEK_HOUR_HEIGHT
  const deadlinesByDay = days.map((day) => tasks.filter((task) => task.deadline && isSameLocalDay(task.deadline, day)))
  const mostDeadlinesInDay = Math.max(0, ...deadlinesByDay.map((items) => items.length))
  const visibleDeadlineLanes = Math.max(1, Math.min(mode === 'day' ? 5 : 3, mostDeadlinesInDay))
  const deadlineLaneHeight = 10 + visibleDeadlineLanes * 23 + (mostDeadlinesInDay > visibleDeadlineLanes ? 14 : 0)
  const gridHeight = (ALL_DAY_END_HOUR - ALL_DAY_START_HOUR) * hourHeight
  const calendarStyle = {
    '--calendar-day-count': days.length,
    '--calendar-hour-height': `${hourHeight}px`,
    '--calendar-grid-height': `${gridHeight}px`,
    '--week-deadline-height': `${deadlineLaneHeight}px`,
  } as CSSProperties

  return (
    <section
      className={`week-calendar time-calendar time-calendar--${mode}`}
      style={calendarStyle}
      aria-label={days.length === 1 ? fullDate.format(days[0]) : `${shortDate.format(days[0])} — ${shortDate.format(days[days.length - 1])}`}
    >
      <div className="week-calendar__times" aria-hidden="true">
        <span className="week-calendar__corner" />
        <span className="week-calendar__deadline-label"><CalendarDays size={12} /> Сроки</span>
        <div className="time-calendar__axis">
          {Array.from({ length: 12 }, (_, index) => index * 2).map((hour) => (
            <time key={hour} style={{ top: `${hour * hourHeight}px` }}>{String(hour).padStart(2, '0')}:00</time>
          ))}
        </div>
      </div>
      {days.map((day, dayIndex) => {
        const scheduledTasks = tasks.filter((task) => task.startAt && isSameLocalDay(task.startAt, day))
        const positionedTasks = layoutTimedDayTasks(scheduledTasks, {
          startHour: ALL_DAY_START_HOUR,
          endHour: ALL_DAY_END_HOUR,
          hourHeight,
        })
        const dayDeadlines = deadlinesByDay[dayIndex]
        const isToday = sameLocalDate(day, new Date())
        const deadlineLimit = mode === 'day' ? 5 : 3
        return (
          <div className="week-day" key={day.toISOString()}>
            <button className={`week-day__header ${isToday ? 'is-today' : ''}`} onClick={() => onCreate(day)} aria-label={`Запланировать на ${dateForAria(day)}`}>
              <span>{dayLabel.format(day)}</span><strong>{day.getDate()}</strong>
            </button>
            <div className="week-day__deadlines" role="group" aria-label={`Дедлайны ${dateForAria(day)}`}>
              {dayDeadlines.slice(0, deadlineLimit).map((task) => (
                <button
                  className={`calendar-deadline-strip ${task.importance === 'high' ? 'calendar-deadline-strip--important' : ''}`}
                  key={task.id}
                  onClick={() => onEdit(task)}
                  title={`Дедлайн: ${task.title}`}
                  data-importance={task.importance}
                >
                  <i aria-hidden="true" /><span>{task.title}</span>
                </button>
              ))}
              {dayDeadlines.length > deadlineLimit && <small>Ещё {dayDeadlines.length - deadlineLimit}</small>}
              {dayDeadlines.length === 0 && <span className="week-day__deadlines-empty" aria-hidden="true" />}
            </div>
            <div className="week-day__grid">
              {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
              {positionedTasks.map(({ task, top, height, column, columnCount, durationMinutes }) => (
                <button
                  className={`calendar-task ${task.importance === 'high' ? 'calendar-task--important' : ''}`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    '--calendar-task-lines': calendarTaskLineLimit(height, mode),
                    ...eventHorizontalStyle(column, columnCount),
                  } as CSSProperties}
                  onClick={() => onEdit(task)}
                  key={task.id}
                  aria-label={`${task.title}, ${taskTimeRange(task)}`}
                  title={`${task.title} · ${taskTimeRange(task)}`}
                  data-overlap-column={`${column + 1}/${columnCount}`}
                  data-duration-minutes={durationMinutes}
                  data-importance={task.importance}
                >
                  <strong>{task.title}</strong>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

function dateForAria(date: Date) {
  return date.toLocaleDateString('ru-RU')
}

function MonthCalendar({
  anchor,
  tasks,
  onOpenDay,
  onEdit,
}: {
  anchor: Date
  tasks: Task[]
  onOpenDay: (date: Date, opener?: HTMLElement) => void
  onEdit: (task: Task) => void
}) {
  const days = monthGridDays(anchor)

  const openCell = (event: MouseEvent<HTMLElement>, date: Date) => {
    if ((event.target as HTMLElement).closest('button')) return
    onOpenDay(date, event.currentTarget.querySelector('button') ?? undefined)
  }

  return (
    <section className="month-calendar" aria-label={monthLabel.format(anchor)}>
      {weekdayLabels.map((label) => <span className="month-weekday" key={label}>{label}</span>)}
      {days.map((date) => {
        const dayTasks = sortTasksForDay(tasksForLocalDate(tasks, date), date)
        const visibleTasks = dayTasks.slice(0, MONTH_CELL_LIMIT)
        const hiddenCount = dayTasks.length - visibleTasks.length
        return (
          <article
            className={`month-day ${date.getMonth() !== anchor.getMonth() ? 'month-day--muted' : ''}`}
            key={date.toISOString()}
            onClick={(event) => openCell(event, date)}
            data-task-count={dayTasks.length}
          >
            <button className="month-day__number" type="button" onClick={(event) => onOpenDay(date, event.currentTarget)} aria-label={`Показать задачи на ${dateForAria(date)}`}>
              {date.getDate()}
            </button>
            <div className="month-day__items">
              {visibleTasks.map((task) => {
                const deadlineOnDay = task.deadline && isSameLocalDay(task.deadline, date)
                const startsOnDay = task.startAt && isSameLocalDay(task.startAt, date)
                return (
                  <button
                    type="button"
                    className={`month-day__task ${deadlineOnDay ? 'month-day__deadline calendar-deadline-strip' : ''} ${!deadlineOnDay && !startsOnDay ? 'month-day__ongoing' : ''} ${task.importance === 'high' ? 'calendar-deadline-strip--important' : ''}`}
                    key={task.id}
                    onClick={() => onEdit(task)}
                    aria-label={`${deadlineOnDay ? 'Дедлайн' : startsOnDay ? 'Запланировано' : 'Продолжается'}: ${task.title}`}
                    title={`${deadlineOnDay ? 'Дедлайн' : startsOnDay ? 'Запланировано' : 'Продолжается'}: ${task.title}`}
                    data-importance={task.importance}
                  >
                    {deadlineOnDay ? <i aria-hidden="true" /> : startsOnDay ? <Clock3 size={11} /> : <Rows3 size={11} />}
                    <span>{task.title}</span>
                  </button>
                )
              })}
              {hiddenCount > 0 && <button className="month-day__more" onClick={(event) => onOpenDay(date, event.currentTarget)}>Ещё {hiddenCount}</button>}
            </div>
          </article>
        )
      })}
    </section>
  )
}

function YearCalendar({
  anchor,
  tasks,
  onOpenDay,
  onOpenMonth,
}: {
  anchor: Date
  tasks: Task[]
  onOpenDay: (date: Date, opener?: HTMLElement) => void
  onOpenMonth: (date: Date) => void
}) {
  const months = Array.from({ length: 12 }, (_, month) => new Date(anchor.getFullYear(), month, 1))

  return (
    <section className="year-calendar" aria-label={`Календарь на ${anchor.getFullYear()} год`}>
      {months.map((month) => {
        const offset = (month.getDay() + 6) % 7
        const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
        return (
          <article className="year-month" key={month.getMonth()}>
            <button className="year-month__title" onClick={() => onOpenMonth(month)}>{monthOnlyLabel.format(month)}</button>
            <div className="year-month__weekdays" aria-hidden="true">
              {weekdayLabels.map((label) => <span key={label}>{label.slice(0, 1)}</span>)}
            </div>
            <div className="year-month__days">
              {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const date = new Date(month.getFullYear(), month.getMonth(), index + 1)
                const count = tasksForLocalDate(tasks, date).length
                return (
                  <button
                    className={`${sameLocalDate(date, new Date()) ? 'is-today' : ''} ${count ? 'has-tasks' : ''}`}
                    key={index + 1}
                    onClick={(event) => onOpenDay(date, event.currentTarget)}
                    aria-label={`${dateForAria(date)}${count ? `, задач: ${count}` : ', задач нет'}`}
                  >
                    {index + 1}
                    {count > 0 && <i aria-hidden="true">{count > 9 ? '9+' : count}</i>}
                  </button>
                )
              })}
            </div>
          </article>
        )
      })}
    </section>
  )
}

function DeadlineRangeBars({
  tasks,
  start,
  dayCount,
  onEdit,
}: {
  tasks: Task[]
  start: Date
  dayCount: number
  onEdit: (task: Task) => void
}) {
  const end = addLocalDays(start, dayCount - 1)
  const ranges = layoutDeadlineRanges(tasks, start, end)
  const laneCount = Math.max(1, ...ranges.map((range) => range.laneCount))
  return (
    <div
      className="deadline-range-bars"
      style={{
        gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${laneCount}, 24px)`,
      }}
      data-range-lanes={ranges.length ? laneCount : 0}
    >
      {ranges.map(({ task, columnStart, columnSpan, lane, startsBeforeView, endsAfterView }) => (
        <button
          className={`deadline-range ${task.importance === 'high' ? 'is-important' : ''} ${startsBeforeView ? 'continues-before' : ''} ${endsAfterView ? 'continues-after' : ''} ${isOverdue(task) ? 'is-overdue' : ''}`}
          style={{ gridColumn: `${columnStart + 1} / span ${columnSpan}`, gridRow: lane + 1 }}
          key={task.id}
          onClick={() => onEdit(task)}
          title={`${task.title}: ${taskDateRangeLabel(task)}`}
          aria-label={`${task.title}: ${taskDateRangeLabel(task)}`}
          data-range-span={columnSpan}
          data-importance={task.importance}
        >
          <i aria-hidden="true" /><span>{task.title}</span>
        </button>
      ))}
      {ranges.length === 0 && <span className="deadline-range-bars__empty" aria-hidden="true" />}
    </div>
  )
}

function DeadlineWeekRow({
  start,
  tasks,
  mutedMonth,
  onOpenDay,
  onEdit,
}: {
  start: Date
  tasks: Task[]
  mutedMonth?: number
  onOpenDay: (date: Date, opener?: HTMLElement) => void
  onEdit: (task: Task) => void
}) {
  const days = daysFrom(start, 7)
  return (
    <div className="deadline-calendar__week">
      <div className="deadline-calendar__days">
        {days.map((date) => {
          const count = tasksForLocalDate(tasks, date).length
          return (
            <button
              className={`${mutedMonth !== undefined && date.getMonth() !== mutedMonth ? 'is-muted' : ''} ${sameLocalDate(date, new Date()) ? 'is-today' : ''}`}
              key={date.toISOString()}
              onClick={(event) => onOpenDay(date, event.currentTarget)}
              aria-label={`Показать задачи на ${dateForAria(date)}`}
            >
              <span>{dayLabel.format(date)}</span><strong>{date.getDate()}</strong>{count > 0 && <i>{count}</i>}
            </button>
          )
        })}
      </div>
      <DeadlineRangeBars tasks={tasks} start={start} dayCount={7} onEdit={onEdit} />
    </div>
  )
}

function DeadlineCalendar({
  anchor,
  scale,
  tasks,
  onScaleChange,
  onOpenDay,
  onOpenMonth,
  onEdit,
}: {
  anchor: Date
  scale: DeadlineScale
  tasks: Task[]
  onScaleChange: (scale: DeadlineScale) => void
  onOpenDay: (date: Date, opener?: HTMLElement) => void
  onOpenMonth: (date: Date) => void
  onEdit: (task: Task) => void
}) {
  const deadlineTasks = tasks.filter((task) => task.deadline)
  const weekStart = startOfWeek(anchor)
  const monthDays = monthGridDays(anchor)
  const yearStart = new Date(anchor.getFullYear(), 0, 1)
  const yearEnd = new Date(anchor.getFullYear(), 11, 31)
  const yearDayCount = differenceInLocalDays(yearEnd, yearStart) + 1
  const yearMonths = Array.from({ length: 12 }, (_, month) => {
    const start = new Date(anchor.getFullYear(), month, 1)
    return {
      start,
      offset: differenceInLocalDays(start, yearStart),
      days: new Date(anchor.getFullYear(), month + 1, 0).getDate(),
    }
  })

  return (
    <section className="deadline-view">
      <div className="deadline-view__header">
        <div><span className="eyebrow">Диаграмма дедлайнов</span><h2>Ближайшие сроки</h2></div>
        <span className="count-badge">{deadlineTasks.length} задач</span>
      </div>
      <div className="deadline-view__toolbar">
        <span>Масштаб</span>
        <div className="segmented" aria-label="Масштаб диаграммы дедлайнов">
          <button aria-label="Дедлайны: неделя" className={scale === 'week' ? 'is-selected' : ''} onClick={() => onScaleChange('week')}>Неделя</button>
          <button aria-label="Дедлайны: месяц" className={scale === 'month' ? 'is-selected' : ''} onClick={() => onScaleChange('month')}>Месяц</button>
          <button aria-label="Дедлайны: год" className={scale === 'year' ? 'is-selected' : ''} onClick={() => onScaleChange('year')}>Год</button>
        </div>
      </div>

      {scale === 'week' && (
        <div className="deadline-week-calendar" aria-label={`Дедлайны ${shortDate.format(weekStart)} — ${shortDate.format(addLocalDays(weekStart, 6))}`}>
          <DeadlineWeekRow start={weekStart} tasks={deadlineTasks} onOpenDay={onOpenDay} onEdit={onEdit} />
        </div>
      )}

      {scale === 'month' && (
        <div className="deadline-month-calendar" aria-label={`Дедлайны, ${monthLabel.format(anchor)}`}>
          <div className="deadline-month-calendar__weekdays" aria-hidden="true">
            {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
          {Array.from({ length: 6 }, (_, index) => (
            <DeadlineWeekRow
              key={index}
              start={monthDays[index * 7]}
              tasks={deadlineTasks}
              mutedMonth={anchor.getMonth()}
              onOpenDay={onOpenDay}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}

      {scale === 'year' && (
        <div className="deadline-year-calendar" aria-label={`Дедлайны на ${anchor.getFullYear()} год`}>
          <div className="deadline-year-calendar__months" style={{ gridTemplateColumns: `repeat(${yearDayCount}, minmax(0, 1fr))` }}>
            {yearMonths.map((month) => (
              <button
                key={month.start.getMonth()}
                style={{ gridColumn: `${month.offset + 1} / span ${month.days}` }}
                onClick={() => onOpenMonth(month.start)}
                aria-label={`Открыть дедлайны за ${monthOnlyLabel.format(month.start)}`}
              >
                {monthOnlyLabel.format(month.start).slice(0, 3)}
              </button>
            ))}
          </div>
          <DeadlineRangeBars tasks={deadlineTasks} start={yearStart} dayCount={yearDayCount} onEdit={onEdit} />
        </div>
      )}

      {deadlineTasks.length === 0 && <div className="empty-state"><span><Rows3 /></span><h3>Нет дедлайнов</h3><p>Добавьте дедлайн в редакторе задачи.</p></div>}
    </section>
  )
}

function periodTitle(mode: CalendarMode, deadlineScale: DeadlineScale, anchor: Date) {
  const effectiveMode = mode === 'deadlines' ? deadlineScale : mode
  if (effectiveMode === 'year') return String(anchor.getFullYear())
  if (effectiveMode === 'month') return monthLabel.format(anchor)
  if (effectiveMode === 'day') return fullDate.format(anchor)
  const count = effectiveMode === 'three-days' ? 3 : 7
  const start = effectiveMode === 'week' ? startOfWeek(anchor) : startOfLocalDay(anchor)
  return `${shortDate.format(start)} — ${shortDate.format(addLocalDays(start, count - 1))}`
}

export function CalendarPage({ onEditTask }: { onEditTask: (task: Task | null, defaults?: Partial<Pick<Task, 'startAt' | 'deadline'>>) => void }) {
  const { state } = useApp()
  const [mode, setMode] = useState<CalendarMode>('week')
  const [deadlineScale, setDeadlineScale] = useState<DeadlineScale>('month')
  const [anchor, setAnchor] = useState(new Date())
  const [openDay, setOpenDay] = useState<Date | null>(null)
  const dayDialogOpener = useRef<HTMLElement | null>(null)
  const activeTasks = useMemo(() => state.tasks.filter((task) => task.status === 'active'), [state.tasks])

  const showDay = (date: Date, opener?: HTMLElement) => {
    dayDialogOpener.current = opener ?? null
    setOpenDay(new Date(date))
  }

  const closeDay = () => {
    setOpenDay(null)
    requestAnimationFrame(() => dayDialogOpener.current?.focus())
  }

  const createForDay = (date: Date) => {
    setOpenDay(null)
    onEditTask(null, { startAt: plannedDate(date) })
  }

  const editFromDialog = (task: Task) => {
    setOpenDay(null)
    onEditTask(task)
  }

  const openMonth = (date: Date) => {
    setAnchor(new Date(date))
    if (mode === 'deadlines') setDeadlineScale('month')
    else setMode('month')
  }

  const move = (direction: number) => {
    const effectiveMode = mode === 'deadlines' ? deadlineScale : mode
    if (effectiveMode === 'year') {
      setAnchor(new Date(anchor.getFullYear() + direction, anchor.getMonth(), 1))
      return
    }
    if (effectiveMode === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1))
      return
    }
    const dayStep = effectiveMode === 'week' ? 7 : effectiveMode === 'three-days' ? 3 : 1
    setAnchor(addLocalDays(anchor, direction * dayStep))
  }

  const timeDays = mode === 'week'
    ? daysFrom(startOfWeek(anchor), 7)
    : mode === 'three-days'
      ? daysFrom(startOfLocalDay(anchor), 3)
      : [startOfLocalDay(anchor)]

  return (
    <main className="page">
      <PageHeader
        eyebrow="Планирование времени"
        title="Календарь"
        description="Распределяйте фокус и следите за крайними сроками"
        actions={<button className="button button--primary" onClick={() => onEditTask(null)}><Plus size={18} /> Запланировать</button>}
      />

      <section className="calendar-controls">
        <div className="segmented calendar-view-switcher" aria-label="Режим календаря">
          <button className={mode === 'year' ? 'is-selected' : ''} onClick={() => setMode('year')}>Год</button>
          <button className={mode === 'month' ? 'is-selected' : ''} onClick={() => setMode('month')}>Месяц</button>
          <button className={mode === 'week' ? 'is-selected' : ''} onClick={() => setMode('week')}>Неделя</button>
          <button className={mode === 'three-days' ? 'is-selected' : ''} onClick={() => setMode('three-days')}>3 дня</button>
          <button className={mode === 'day' ? 'is-selected' : ''} onClick={() => setMode('day')}>День</button>
          <button className={mode === 'deadlines' ? 'is-selected' : ''} onClick={() => setMode('deadlines')}>Дедлайны</button>
        </div>
        <div className="date-navigation">
          <button className="button button--ghost button--icon" onClick={() => move(-1)} aria-label="Предыдущий период"><ChevronLeft size={18} /></button>
          <button className="button button--ghost" onClick={() => setAnchor(new Date())}>Сегодня</button>
          <button className="button button--ghost button--icon" onClick={() => move(1)} aria-label="Следующий период"><ChevronRight size={18} /></button>
          <strong>{periodTitle(mode, deadlineScale, anchor)}</strong>
        </div>
      </section>

      <CalendarSwipeSurface onMove={move}>
        {mode === 'year' && <YearCalendar anchor={anchor} tasks={activeTasks} onOpenDay={showDay} onOpenMonth={openMonth} />}
        {mode === 'month' && <MonthCalendar anchor={anchor} tasks={activeTasks} onOpenDay={showDay} onEdit={onEditTask} />}
        {(mode === 'week' || mode === 'three-days' || mode === 'day') && (
          <TimeCalendar
            days={timeDays}
            tasks={activeTasks}
            mode={mode}
            onCreate={(date) => onEditTask(null, { startAt: plannedDate(date) })}
            onEdit={onEditTask}
          />
        )}
        {mode === 'deadlines' && (
          <DeadlineCalendar
            anchor={anchor}
            scale={deadlineScale}
            tasks={activeTasks}
            onScaleChange={setDeadlineScale}
            onOpenDay={showDay}
            onOpenMonth={openMonth}
            onEdit={onEditTask}
          />
        )}
      </CalendarSwipeSurface>

      <p className="calendar-note"><CalendarDays size={15} /> Листайте периоды горизонтальным свайпом или перетаскиванием мышью. Высота события соответствует времени от начала до дедлайна.</p>

      {openDay && (
        <DayTasksDialog
          date={openDay}
          tasks={sortTasksForDay(tasksForLocalDate(activeTasks, openDay), openDay)}
          onClose={closeDay}
          onCreate={() => createForDay(openDay)}
          onEdit={editFromDialog}
        />
      )}
    </main>
  )
}
