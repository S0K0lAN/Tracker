import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Archive, CalendarClock, CalendarDays, Check, Clock3, FileText, Flag, MoreHorizontal, Paperclip, Play, Timer, Trash2 } from 'lucide-react'
import type { Task } from '../domain/models'
import { getTaskUrgencySignal } from '../domain/models'
import { useApp } from '../state/AppContext'
import { startPomodoroForTask } from './PomodoroTimer'
import './task-card-actions.css'

const taskDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatTaskDate = (value: string) => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? taskDateFormatter.format(timestamp) : 'Некорректная дата'
}

const allDayDateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

export const formatAllDayTaskDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return 'Некорректная дата'
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? allDayDateFormatter.format(date)
    : 'Некорректная дата'
}

export function TaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const { state, toggleTask, archiveTask, removeTask, updatePomodoro } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const project = state.projects.find((item) => item.id === task.projectId)
  const urgencySignal = getTaskUrgencySignal(task, undefined, project?.urgencyThresholdHours)
  const doneCount = task.subtasks.filter((item) => item.completed).length

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const toggleMenu = () => {
    const opening = !menuOpen
    setMenuOpen(opening)
    if (opening) requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
      requestAnimationFrame(() => menuTriggerRef.current?.focus())
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (Math.max(0, current) + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  const runRemovingAction = (action: () => void) => {
    const card = cardRef.current
    const activeElement = document.activeElement as HTMLElement | null
    const cardContainer = card?.closest<HTMLElement>('.virtual-task-list, .board-column, .workspace-section, .search-result-section, .task-list')
      ?? card?.parentElement
    const cards = cardContainer ? [...cardContainer.querySelectorAll<HTMLElement>('.task-card')] : []
    const index = card ? cards.indexOf(card) : -1
    const adjacent = index >= 0
      ? cards[index + 1]?.querySelector<HTMLElement>('.task-card__body, .task-check')
        ?? cards[index - 1]?.querySelector<HTMLElement>('.task-card__body, .task-check')
      : null
    const sectionHeading = card?.closest('section')?.querySelector<HTMLElement>('h2, h3')
    const pageHeading = card?.closest('main')?.querySelector<HTMLElement>('h1')
    action()
    requestAnimationFrame(() => {
      if (activeElement?.isConnected) return
      const trigger = menuTriggerRef.current
      const target = trigger?.isConnected
        ? trigger
          : adjacent?.isConnected
          ? adjacent
          : sectionHeading?.isConnected
            ? sectionHeading
            : pageHeading?.isConnected
              ? pageHeading
            : null
      if (!target) return
      if (!target.matches('button, a, input, select, textarea, [tabindex]')) target.tabIndex = -1
      target.focus()
    })
  }

  return (
    <article ref={cardRef} className={`task-card ${task.status === 'completed' ? 'task-card--done' : ''} ${menuOpen ? 'task-card--menu-open' : ''}`}>
      <button
        className={`task-check ${task.status === 'completed' ? 'task-check--done' : ''}`}
        onClick={() => runRemovingAction(() => toggleTask(task.id))}
        aria-label={task.status === 'completed' ? `Вернуть задачу ${task.title}` : `Завершить задачу ${task.title}`}
      >
        {task.status === 'completed' && <Check size={15} strokeWidth={3} />}
      </button>
      <button className="task-card__body" onClick={() => onOpen(task)}>
        <span className="task-card__title">{task.title}</span>
        {task.description && <span className="task-card__description">{task.description}</span>}
        <span className="task-card__meta">
          {project && (
            <span className="meta-item">
              <i style={{ background: project.color }} /> {project.name}
            </span>
          )}
          {task.deadline && (
            <span className="meta-item">
              <CalendarClock size={13} /> {formatTaskDate(task.deadline)}
            </span>
          )}
          {task.allDayDate && (
            <span className="meta-item">
              <CalendarDays size={13} /> {formatAllDayTaskDate(task.allDayDate)} · весь день
            </span>
          )}
          {task.deadline && (urgencySignal === 'high' || task.urgencyOverride === 'low') && (
            <span className={`meta-item urgency urgency--${urgencySignal === 'high' ? 'high' : 'low'}`}>
              <Clock3 size={13} /> {urgencySignal === 'high' ? 'Срочно' : 'Не срочно'}
            </span>
          )}
          <span className={`meta-item importance importance--${task.importance}`}>
            <Flag size={13} fill={task.importance === 'high' ? 'currentColor' : 'none'} /> {task.importance === 'high' ? 'Важно' : 'Обычно'}
          </span>
          {task.subtasks.length > 0 && (
            <span className="meta-item">
              <FileText size={13} /> {doneCount}/{task.subtasks.length}
            </span>
          )}
          {task.attachments.length > 0 && (
            <span className="meta-item">
              <Paperclip size={13} /> {task.attachments.length}
            </span>
          )}
          {task.focusMinutes > 0 && (
            <span className="meta-item">
              <Timer size={13} /> {task.focusMinutes} мин фокуса
            </span>
          )}
        </span>
        {task.tags.length > 0 && (
          <span className="tag-row">
            {task.tags.map((tag) => (
              <span className="tag" key={tag}>
                #{tag}
              </span>
            ))}
          </span>
        )}
      </button>
      <div
        className="task-card__actions"
        ref={menuRef}
        onKeyDown={onMenuKeyDown}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false)
        }}
      >
        <button
          ref={menuTriggerRef}
          className="icon-button task-card__more"
          onClick={toggleMenu}
          onKeyDown={(event) => {
            if (!menuOpen && event.key === 'ArrowDown') {
              event.preventDefault()
              setMenuOpen(true)
            }
          }}
          aria-label={`Действия задачи ${task.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={18} />
        </button>
        {menuOpen && (
          <div className="task-card__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { menuTriggerRef.current?.focus(); onOpen(task); setMenuOpen(false) }}>
              <FileText size={16} /> Открыть
            </button>
            {task.status === 'active' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  startPomodoroForTask(task.id, updatePomodoro)
                  setMenuOpen(false)
                  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.pomodoro-dock__main')?.focus())
                }}
              >
                <Play size={16} /> Таймер фокуса · 25 минут
              </button>
            )}
            {task.status === 'active' && (
              <button type="button" role="menuitem" onClick={() => runRemovingAction(() => { toggleTask(task.id); setMenuOpen(false) })}>
                <Check size={16} /> Завершить
              </button>
            )}
            {task.status === 'completed' && (
              <button type="button" role="menuitem" onClick={() => runRemovingAction(() => { archiveTask(task.id); setMenuOpen(false) })}>
                <Archive size={16} /> Архивировать
              </button>
            )}
            <button type="button" role="menuitem" className="task-card__menu-danger" onClick={() => runRemovingAction(() => { removeTask(task.id); setMenuOpen(false) })}>
              <Trash2 size={16} /> В корзину
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
