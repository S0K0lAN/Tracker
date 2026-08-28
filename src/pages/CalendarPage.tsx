import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Flag, Plus, X, Zap } from 'lucide-react'
import type { Task } from '../domain/models'
import { getTaskUrgency, isOverdue, isSameLocalDay } from '../domain/models'
import { useApp } from '../state/AppContext'
import { useNow } from '../hooks/useNow'
import { PageHeader } from '../components/PageHeader'
import { trapTabKey } from '../components/focusTrap'
import {
  addLocalDays,
  getTaskPlannedDurationMinutes,
  layoutDeadlineRanges,
  layoutTimedDayTasks,
  sameLocalDate,
  startOfLocalDay,
  startOfWeek,
  tasksForLocalDate,
  tasksForMonthDate,
  type PositionedTimedTask,
} from './calendarLayout'
import './calendar-deadlines.css'

type CalendarMode = 'year' | 'month' | 'week' | 'three-days' | 'day'

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
const MONTH_DEADLINE_LANE_LIMIT = 3
const ALL_DAY_OVERFLOW_LANE_HEIGHT = 26

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
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + getTaskPlannedDurationMinutes(task))
  const nextDay = addLocalDays(startOfLocalDay(start), 1)
  return `${timeLabel.format(start)} — ${timeLabel.format(end > nextDay ? nextDay : end)}`
}

function taskDateRangeLabel(task: Task) {
  const start = task.startAt ? new Date(task.startAt) : null
  const deadline = task.deadline ? new Date(task.deadline) : null
  if (start && !Number.isNaN(start.getTime()) && deadline && !Number.isNaN(deadline.getTime()) && deadline.getTime() >= start.getTime()) {
    return sameLocalDate(start, deadline)
      ? shortDate.format(deadline)
      : `${shortDate.format(start)} — ${shortDate.format(deadline)}`
  }
  const point = deadline && !Number.isNaN(deadline.getTime()) ? deadline : start
  return point && !Number.isNaN(point.getTime()) ? shortDate.format(point) : ''
}

function taskTimingForDay(task: Task, date: Date) {
  const labels: string[] = []
  if (task.startAt && isSameLocalDay(task.startAt, date)) labels.push(taskTimeRange(task))
  if (task.deadline && isSameLocalDay(task.deadline, date)) {
    const deadline = new Date(task.deadline)
    if (!Number.isNaN(deadline.getTime())) labels.push(`Дедлайн ${timeLabel.format(deadline)}`)
  }
  return labels.filter(Boolean).join(' · ') || taskDateRangeLabel(task) || 'Без времени'
}

function taskSignalLabels(task: Task, isUrgent: boolean) {
  return [
    task.importance === 'high' ? 'Важная задача' : '',
    isUrgent ? 'Срочная задача' : '',
  ].filter(Boolean)
}

function taskAccessibleName(label: string, task: Task, isUrgent: boolean) {
  return [label, ...taskSignalLabels(task, isUrgent)].join(', ')
}

function TaskSignals({ task, isUrgent }: { task: Task; isUrgent: boolean }) {
  if (task.importance !== 'high' && !isUrgent) return null

  return (
    <span className="calendar-task-signals" aria-hidden="true">
      {task.importance === 'high' && (
        <span className="calendar-task-signal calendar-task-signal--importance" title="Важная задача">
          <Flag size={12} fill="currentColor" aria-hidden="true" />
        </span>
      )}
      {isUrgent && (
        <span className="calendar-task-signal calendar-task-signal--urgency" title="Срочная задача">
          <Zap size={12} fill="currentColor" aria-hidden="true" />
        </span>
      )}
    </span>
  )
}

function taskDeadlineAriaLabel(task: Task, isUrgent: boolean) {
  const rangeLabel = taskDateRangeLabel(task)
  return taskAccessibleName(`Дедлайн: ${task.title}${rangeLabel ? `, ${rangeLabel}` : ''}`, task, isUrgent)
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
  urgentTaskIds,
}: {
  date: Date
  tasks: Task[]
  onClose: () => void
  onCreate: () => void
  onEdit: (task: Task) => void
  urgentTaskIds: ReadonlySet<string>
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
          {tasks.map((task) => {
            const isUrgent = urgentTaskIds.has(task.id)
            const timingLabel = taskTimingForDay(task, date)
            return (
              <button
                className="calendar-day-dialog__task"
                key={task.id}
                onClick={() => onEdit(task)}
                aria-label={taskAccessibleName(`${task.title}, ${timingLabel}`, task, isUrgent)}
                data-importance={task.importance}
                data-urgency={isUrgent ? 'high' : 'low'}
              >
                <span className="calendar-day-dialog__task-marker" aria-hidden="true" />
                <strong><TaskSignals task={task} isUrgent={isUrgent} /><span>{task.title}</span></strong>
                <small>{timingLabel}</small>
              </button>
            )
          })}
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
  onOpenDay,
  today,
  urgentTaskIds,
}: {
  days: Date[]
  tasks: Task[]
  mode: 'week' | 'three-days' | 'day'
  onCreate: (date: Date) => void
  onEdit: (task: Task) => void
  onOpenDay: (date: Date, opener?: HTMLElement) => void
  today: Date
  urgentTaskIds: ReadonlySet<string>
}) {
  const hourHeight = mode === 'day' ? DAY_HOUR_HEIGHT : mode === 'three-days' ? THREE_DAY_HOUR_HEIGHT : WEEK_HOUR_HEIGHT
  const allDayDeadlinesByDay = days.map((day) => tasks
    .filter((task) => task.deadline && isSameLocalDay(task.deadline, day))
    .sort((left, right) => new Date(left.deadline!).getTime() - new Date(right.deadline!).getTime()))
  const mostAllDayItemsInDay = Math.max(0, ...allDayDeadlinesByDay.map((items) => items.length))
  const visibleAllDayLanes = Math.max(1, Math.min(mode === 'day' ? 5 : 3, mostAllDayItemsInDay))
  const allDayLaneHeight = 10
    + visibleAllDayLanes * 26
    + (mostAllDayItemsInDay > visibleAllDayLanes ? ALL_DAY_OVERFLOW_LANE_HEIGHT : 0)
  const gridHeight = (ALL_DAY_END_HOUR - ALL_DAY_START_HOUR) * hourHeight
  const calendarStyle = {
    '--calendar-day-count': days.length,
    '--calendar-hour-height': `${hourHeight}px`,
    '--calendar-grid-height': `${gridHeight}px`,
    '--week-all-day-height': `${allDayLaneHeight}px`,
  } as CSSProperties

  return (
    <section
      className={`week-calendar time-calendar time-calendar--${mode}`}
      style={calendarStyle}
      aria-label={days.length === 1 ? fullDate.format(days[0]) : `${shortDate.format(days[0])} — ${shortDate.format(days[days.length - 1])}`}
    >
      <div className="week-calendar__times" aria-hidden="true">
        <span className="week-calendar__corner" />
        <span className="week-calendar__all-day-label"><CalendarDays size={12} /><span>Весь день</span></span>
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
        const dayDeadlines = allDayDeadlinesByDay[dayIndex]
        const isToday = sameLocalDate(day, today)
        const deadlineLimit = mode === 'day' ? 5 : 3
        return (
          <div className={`week-day ${isToday ? 'is-today' : ''}`} key={day.toISOString()}>
            <button className={`week-day__header ${isToday ? 'is-today' : ''}`} onClick={() => onCreate(day)} aria-label={`Запланировать на ${dateForAria(day)}`} aria-current={isToday ? 'date' : undefined}>
              <span>{dayLabel.format(day)}</span><strong>{day.getDate()}</strong>
            </button>
            <div className="week-day__all-day" role="group" aria-label={`Весь день, дедлайны на ${dateForAria(day)}`}>
              {dayDeadlines.slice(0, deadlineLimit).map((task) => {
                const isUrgent = urgentTaskIds.has(task.id)
                const deadlineTime = timeLabel.format(new Date(task.deadline!))
                return (
                  <button
                    className="calendar-deadline-strip"
                    key={task.id}
                    onClick={() => onEdit(task)}
                    title={`Дедлайн: ${task.title} · до ${deadlineTime}`}
                    aria-label={taskAccessibleName(`Дедлайн: ${task.title}, до ${deadlineTime}`, task, isUrgent)}
                    data-importance={task.importance}
                    data-urgency={isUrgent ? 'high' : 'low'}
                  >
                    <Clock3 className="calendar-deadline-strip__glyph" size={12} aria-hidden="true" />
                    <TaskSignals task={task} isUrgent={isUrgent} />
                    <span className="calendar-deadline-strip__title">{task.title}</span>
                    <time className="calendar-deadline-strip__time" dateTime={task.deadline}>до {deadlineTime}</time>
                  </button>
                )
              })}
              {dayDeadlines.length > deadlineLimit && (
                <button
                  type="button"
                  className="week-day__all-day-more"
                  onClick={(event) => onOpenDay(day, event.currentTarget)}
                  aria-label={`Показать все задачи и дедлайны на ${dateForAria(day)}, скрыто ${dayDeadlines.length - deadlineLimit}`}
                >
                  Ещё {dayDeadlines.length - deadlineLimit}
                </button>
              )}
              {dayDeadlines.length === 0 && <span className="week-day__all-day-empty" aria-hidden="true" />}
            </div>
            <div className="week-day__grid">
              {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
              {positionedTasks.map(({ task, top, height, column, columnCount, durationMinutes }) => {
                const isUrgent = urgentTaskIds.has(task.id)
                const timeRange = taskTimeRange(task)
                return (
                  <button
                    className="calendar-task"
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                      '--calendar-task-lines': calendarTaskLineLimit(height, mode),
                      ...eventHorizontalStyle(column, columnCount),
                    } as CSSProperties}
                    onClick={() => onEdit(task)}
                    key={task.id}
                    aria-label={taskAccessibleName(`${task.title}, ${timeRange}`, task, isUrgent)}
                    title={`${task.title} · ${timeRange}`}
                    data-overlap-column={`${column + 1}/${columnCount}`}
                    data-duration-minutes={durationMinutes}
                    data-importance={task.importance}
                    data-urgency={isUrgent ? 'high' : 'low'}
                  >
                    <span className="calendar-task__content"><TaskSignals task={task} isUrgent={isUrgent} /><strong>{task.title}</strong></span>
                  </button>
                )
              })}
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

interface MonthDeadlineSegment {
  task: Task
  columnStart: number
  columnSpan: number
  lane: number
  startsBeforeWeek: boolean
  endsAfterWeek: boolean
}

interface MonthDeadlineWeek {
  days: Date[]
  ranges: MonthDeadlineSegment[]
  laneCount: number
  hiddenDeadlineCounts: number[]
}

function layoutMonthDeadlineWeeks(tasks: Task[], days: Date[]): MonthDeadlineWeek[] {
  if (days.length === 0) return []
  const ranges = layoutDeadlineRanges(
    tasks.filter((task) => task.deadline),
    days[0],
    days[days.length - 1],
  )

  return Array.from({ length: Math.ceil(days.length / 7) }, (_, weekIndex) => {
    const weekStart = weekIndex * 7
    const weekEnd = Math.min(days.length - 1, weekStart + 6)
    const weekDays = days.slice(weekStart, weekEnd + 1)
    const weekRanges = ranges.flatMap((range): MonthDeadlineSegment[] => {
      const rangeStart = range.columnStart
      const rangeEnd = range.columnStart + range.columnSpan - 1
      if (rangeEnd < weekStart || rangeStart > weekEnd) return []
      const segmentStart = Math.max(rangeStart, weekStart)
      const segmentEnd = Math.min(rangeEnd, weekEnd)
      return [{
        task: range.task,
        columnStart: segmentStart - weekStart,
        columnSpan: segmentEnd - segmentStart + 1,
        lane: range.lane,
        startsBeforeWeek: range.startsBeforeView || rangeStart < weekStart,
        endsAfterWeek: range.endsAfterView || rangeEnd > weekEnd,
      }]
    })
    const visibleRanges = weekRanges.filter((range) => range.lane < MONTH_DEADLINE_LANE_LIMIT)
    const hiddenDeadlineCounts = Array.from({ length: weekDays.length }, () => 0)

    weekRanges.forEach((range) => {
      if (range.lane < MONTH_DEADLINE_LANE_LIMIT) return
      const rangeEnd = Math.min(weekDays.length - 1, range.columnStart + range.columnSpan - 1)
      for (let dayIndex = range.columnStart; dayIndex <= rangeEnd; dayIndex += 1) {
        hiddenDeadlineCounts[dayIndex] += 1
      }
    })

    return {
      days: weekDays,
      ranges: visibleRanges,
      laneCount: visibleRanges.reduce((count, range) => Math.max(count, range.lane + 1), 0),
      hiddenDeadlineCounts,
    }
  })
}

function MonthCalendar({
  anchor,
  tasks,
  onOpenDay,
  onEdit,
  today,
  urgentTaskIds,
}: {
  anchor: Date
  tasks: Task[]
  onOpenDay: (date: Date, opener?: HTMLElement) => void
  onEdit: (task: Task) => void
  today: Date
  urgentTaskIds: ReadonlySet<string>
}) {
  const days = monthGridDays(anchor)
  const weeks = layoutMonthDeadlineWeeks(tasks, days)

  const openCell = (event: MouseEvent<HTMLElement>, date: Date) => {
    if ((event.target as HTMLElement).closest('button')) return
    onOpenDay(date, event.currentTarget.querySelector('button') ?? undefined)
  }

  return (
    <section className="month-calendar" aria-label={monthLabel.format(anchor)}>
      {weekdayLabels.map((label) => <span className="month-weekday" key={label}>{label}</span>)}
      {weeks.map(({ days: weekDays, ranges, laneCount, hiddenDeadlineCounts }, weekIndex) => (
        <div
          className="month-calendar__week"
          key={weekDays[0].toISOString()}
          style={{ '--month-range-lanes': laneCount } as CSSProperties}
          data-range-lanes={laneCount}
        >
          {weekDays.map((date, dayIndex) => {
            const dayTasks = sortTasksForDay(tasksForMonthDate(tasks, date), date)
            const scheduledTasks = dayTasks.filter((task) => task.startAt && !task.deadline && isSameLocalDay(task.startAt, date))
            const visibleTasks = scheduledTasks.slice(0, MONTH_CELL_LIMIT)
            const hiddenScheduledCount = scheduledTasks.length - visibleTasks.length
            const hiddenDeadlineCount = hiddenDeadlineCounts[dayIndex]
            const isToday = sameLocalDate(date, today)
            return (
              <article
                className={`month-day ${isToday ? 'is-today' : ''} ${date.getMonth() !== anchor.getMonth() ? 'month-day--muted' : ''}`}
                key={date.toISOString()}
                onClick={(event) => openCell(event, date)}
                data-task-count={dayTasks.length}
              >
                <button className="month-day__number" type="button" onClick={(event) => onOpenDay(date, event.currentTarget)} aria-label={`Показать задачи на ${dateForAria(date)}`} aria-current={isToday ? 'date' : undefined}>
                  {date.getDate()}
                </button>
                {laneCount > 0 && <span className="month-day__range-space" aria-hidden="true" />}
                <div className="month-day__items">
                  {hiddenDeadlineCount > 0 && (
                    <button
                      type="button"
                      className="month-day__more month-day__deadline-more"
                      onClick={(event) => onOpenDay(date, event.currentTarget)}
                      aria-label={`Показать все задачи и дедлайны на ${dateForAria(date)}, скрытых сроков ${hiddenDeadlineCount}`}
                    >
                      Ещё {hiddenDeadlineCount}
                    </button>
                  )}
                  {visibleTasks.map((task) => {
                    const isUrgent = urgentTaskIds.has(task.id)
                    return (
                      <button
                        type="button"
                        className="month-day__task"
                        key={task.id}
                        onClick={() => onEdit(task)}
                        aria-label={taskAccessibleName(`Запланировано: ${task.title}`, task, isUrgent)}
                        title={`Запланировано: ${task.title}`}
                        data-importance={task.importance}
                        data-urgency={isUrgent ? 'high' : 'low'}
                      >
                        <Clock3 className="month-day__task-clock" size={11} aria-hidden="true" />
                        <TaskSignals task={task} isUrgent={isUrgent} />
                        <span>{task.title}</span>
                      </button>
                    )
                  })}
                  {hiddenScheduledCount > 0 && (
                    <button
                      type="button"
                      className="month-day__more"
                      onClick={(event) => onOpenDay(date, event.currentTarget)}
                      aria-label={`Показать все задачи на ${dateForAria(date)}, скрыто ${hiddenScheduledCount}`}
                    >
                      Ещё {hiddenScheduledCount}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
          {ranges.length > 0 && (
            <div
              className="month-calendar__ranges"
              role="group"
              aria-label={`Сроки ${dateForAria(weekDays[0])} — ${dateForAria(weekDays[6])}`}
              style={{
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gridTemplateRows: `repeat(${laneCount}, 22px)`,
              }}
            >
              {ranges.map(({ task, columnStart, columnSpan, lane, startsBeforeWeek, endsAfterWeek }) => {
                const isUrgent = urgentTaskIds.has(task.id)
                return (
                  <button
                    type="button"
                    className={`deadline-range month-calendar__range month-day__deadline ${startsBeforeWeek ? 'continues-before' : ''} ${endsAfterWeek ? 'continues-after' : ''} ${isOverdue(task, today) ? 'is-overdue' : ''}`}
                    style={{ gridColumn: `${columnStart + 1} / span ${columnSpan}`, gridRow: lane + 1 }}
                    key={`${task.id}-${weekIndex}`}
                    onClick={() => onEdit(task)}
                    title={`${task.title}: ${taskDateRangeLabel(task)}`}
                    aria-label={taskDeadlineAriaLabel(task, isUrgent)}
                    data-task-id={task.id}
                    data-range-lane={lane}
                    data-range-span={columnSpan}
                    data-importance={task.importance}
                    data-urgency={isUrgent ? 'high' : 'low'}
                  >
                    <CalendarDays className="month-calendar__deadline-glyph" size={11} aria-hidden="true" />
                    <TaskSignals task={task} isUrgent={isUrgent} /><span>{task.title}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function YearCalendar({
  anchor,
  tasks,
  onOpenDay,
  onOpenMonth,
  today,
}: {
  anchor: Date
  tasks: Task[]
  onOpenDay: (date: Date, opener?: HTMLElement) => void
  onOpenMonth: (date: Date) => void
  today: Date
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
                const isToday = sameLocalDate(date, today)
                return (
                  <button
                    className={`${isToday ? 'is-today' : ''} ${count ? 'has-tasks' : ''}`}
                    key={index + 1}
                    onClick={(event) => onOpenDay(date, event.currentTarget)}
                    aria-label={`${dateForAria(date)}${count ? `, задач: ${count}` : ', задач нет'}`}
                    aria-current={isToday ? 'date' : undefined}
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

function periodTitle(mode: CalendarMode, anchor: Date) {
  if (mode === 'year') return String(anchor.getFullYear())
  if (mode === 'month') return monthLabel.format(anchor)
  if (mode === 'day') return fullDate.format(anchor)
  const count = mode === 'three-days' ? 3 : 7
  const start = mode === 'week' ? startOfWeek(anchor) : startOfLocalDay(anchor)
  return `${shortDate.format(start)} — ${shortDate.format(addLocalDays(start, count - 1))}`
}

export function CalendarPage({ onEditTask }: { onEditTask: (task: Task | null, defaults?: Partial<Pick<Task, 'startAt' | 'deadline'>>) => void }) {
  const { state } = useApp()
  const now = useNow()
  const [mode, setMode] = useState<CalendarMode>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [openDay, setOpenDay] = useState<Date | null>(null)
  const dayDialogOpener = useRef<HTMLElement | null>(null)
  const activeTasks = useMemo(() => state.tasks.filter((task) => task.status === 'active'), [state.tasks])
  const projectUrgencyThresholds = useMemo(
    () => new Map(state.projects.map((project) => [project.id, project.urgencyThresholdHours])),
    [state.projects],
  )
  const urgentTaskIds = useMemo(
    () => new Set(activeTasks
      .filter((task) => getTaskUrgency(task, now, projectUrgencyThresholds.get(task.projectId)) === 'high')
      .map((task) => task.id)),
    [activeTasks, now, projectUrgencyThresholds],
  )

  const showDay = (date: Date, opener?: HTMLElement) => {
    dayDialogOpener.current = opener ?? null
    setOpenDay(new Date(date))
  }

  const closeDay = () => {
    setOpenDay(null)
    requestAnimationFrame(() => dayDialogOpener.current?.focus())
  }

  const createForDay = (date: Date) => {
    if (dayDialogOpener.current?.isConnected) dayDialogOpener.current.focus()
    setOpenDay(null)
    onEditTask(null, { startAt: plannedDate(date) })
  }

  const editFromDialog = (task: Task) => {
    if (dayDialogOpener.current?.isConnected) dayDialogOpener.current.focus()
    setOpenDay(null)
    onEditTask(task)
  }

  const openMonth = (date: Date) => {
    setAnchor(new Date(date))
    setMode('month')
  }

  const move = (direction: number) => {
    if (mode === 'year') {
      setAnchor(new Date(anchor.getFullYear() + direction, anchor.getMonth(), 1))
      return
    }
    if (mode === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1))
      return
    }
    const dayStep = mode === 'week' ? 7 : mode === 'three-days' ? 3 : 1
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
        </div>
        <div className="date-navigation">
          <button className="button button--ghost button--icon" onClick={() => move(-1)} aria-label="Предыдущий период"><ChevronLeft size={18} /></button>
          <button className="button button--ghost" onClick={() => setAnchor(new Date())}>Сегодня</button>
          <button className="button button--ghost button--icon" onClick={() => move(1)} aria-label="Следующий период"><ChevronRight size={18} /></button>
          <strong>{periodTitle(mode, anchor)}</strong>
        </div>
      </section>

      <CalendarSwipeSurface onMove={move}>
        {mode === 'year' && <YearCalendar anchor={anchor} tasks={activeTasks} onOpenDay={showDay} onOpenMonth={openMonth} today={now} />}
        {mode === 'month' && <MonthCalendar anchor={anchor} tasks={activeTasks} onOpenDay={showDay} onEdit={onEditTask} today={now} urgentTaskIds={urgentTaskIds} />}
        {(mode === 'week' || mode === 'three-days' || mode === 'day') && (
          <TimeCalendar
            days={timeDays}
            tasks={activeTasks}
            mode={mode}
            onCreate={(date) => onEditTask(null, { startAt: plannedDate(date) })}
            onEdit={onEditTask}
            onOpenDay={showDay}
            today={now}
            urgentTaskIds={urgentTaskIds}
          />
        )}
      </CalendarSwipeSurface>

      <p className="calendar-note"><CalendarDays size={15} /> Листайте периоды горизонтальным свайпом или перетаскиванием мышью. Высота события соответствует длительности задачи, а дедлайн отображается отдельно от временного блока.</p>

      {openDay && (
        <DayTasksDialog
          date={openDay}
          tasks={sortTasksForDay(
            mode === 'month'
              ? tasksForMonthDate(activeTasks, openDay)
              : tasksForLocalDate(activeTasks, openDay),
            openDay,
          )}
          onClose={closeDay}
          onCreate={() => createForDay(openDay)}
          onEdit={editFromDialog}
          urgentTaskIds={urgentTaskIds}
        />
      )}
    </main>
  )
}
