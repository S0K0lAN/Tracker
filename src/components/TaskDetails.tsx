import { useLayoutEffect, useRef, useState } from 'react'
import {
  Archive,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileImage,
  Flag,
  Folder,
  Paperclip,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import type { Attachment, Task } from '../domain/models'
import { getEffectiveUrgencyThreshold, getTaskTiming } from '../domain/models'
import { useApp } from '../state/AppContext'
import { AttachmentViewer } from './AttachmentViewer'
import { setInert, trapTabKey } from './focusTrap'
import { startPomodoroForTask } from './PomodoroTimer'
import './task-details.css'

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDateTime = (value?: string) => {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : dateTimeFormatter.format(timestamp)
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} Б`
  return `${Math.max(0.1, bytes / 1024).toFixed(1)} КБ`
}

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return `${hours} ч ${remainder} мин`
  if (hours) return `${hours} ч`
  return `${remainder} мин`
}

export function TaskDetails({
  task,
  onClose,
  onEdit,
  returnFocusTo,
}: {
  task: Task
  onClose: () => void
  onEdit: (task: Task) => void
  returnFocusTo?: HTMLElement | null
}) {
  const { state, archiveTask, removeTask, toggleTask, updatePomodoro, updateTask } = useApp()
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(returnFocusTo ?? (document.activeElement as HTMLElement | null))
  const restoreFocusRef = useRef(true)
  const project = state.projects.find((item) => item.id === task.projectId)
  const timing = getTaskTiming(task, new Date(), project?.urgencyThresholdHours)
  const effectiveUrgencyThreshold = getEffectiveUrgencyThreshold(task, project?.urgencyThresholdHours)
  const hasIndividualUrgencyThreshold = task.urgencyThresholdOverrideHours !== undefined
  const completedSubtasks = task.subtasks.filter((item) => item.completed).length
  const startAt = formatDateTime(task.startAt)
  const deadline = formatDateTime(task.deadline)

  useLayoutEffect(() => {
    closeRef.current?.focus()
    return () => {
      if (!restoreFocusRef.current) return
      requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus()
          return
        }
        const fallback = document.querySelector<HTMLElement>('.workspace main h1, .workspace main h2')
        if (fallback) {
          fallback.tabIndex = -1
          fallback.focus()
        }
      })
    }
  }, [])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    setInert([dialog], Boolean(previewAttachment))
    return () => setInert([dialog], false)
  }, [previewAttachment])

  const launchTimer = () => {
    restoreFocusRef.current = false
    startPomodoroForTask(task.id, updatePomodoro)
    onClose()
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.pomodoro-dock__main')?.focus()
    })
  }

  const edit = () => {
    restoreFocusRef.current = false
    onEdit(task)
  }

  const toggleSubtask = (subtaskId: string) => {
    updateTask({
      ...task,
      subtasks: task.subtasks.map((subtask) => (
        subtask.id === subtaskId ? { ...subtask, completed: !subtask.completed } : subtask
      )),
      updatedAt: new Date().toISOString(),
    })
  }

  const moveToTrash = () => {
    removeTask(task.id)
    onClose()
  }

  const archive = () => {
    archiveTask(task.id)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className="task-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-details-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
          }
          trapTabKey(event, dialogRef.current)
        }}
      >
        <header className="task-details__header">
          <div className="task-details__heading">
            <div className="task-details__context">
              <span className="task-details__project-dot" style={{ background: project?.color }} />
              <span>{project?.name ?? 'Без проекта'}</span>
              <span aria-hidden="true">/</span>
              <span>{task.status === 'completed' ? 'Выполнена' : 'Активная задача'}</span>
            </div>
            <h2 id="task-details-title">{task.title}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Закрыть задачу">
            <X />
          </button>
        </header>

        <div className="task-details__toolbar" aria-label="Действия задачи">
          {task.status === 'active' && (
            <button type="button" className="button button--primary" onClick={launchTimer}>
              <Play size={17} fill="currentColor" /> Таймер · 25 минут
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={edit}>
            <Pencil size={17} /> Редактировать
          </button>
          {(task.status === 'active' || task.status === 'completed') && (
            <button type="button" className="button button--ghost" onClick={() => toggleTask(task.id)}>
              {task.status === 'completed' ? <RotateCcw size={17} /> : <CheckCircle2 size={17} />}
              {task.status === 'completed' ? 'Вернуть в работу' : 'Завершить'}
            </button>
          )}
        </div>

        <div className="task-details__content">
          <section className="task-details__description" aria-labelledby="task-details-description">
            <h3 id="task-details-description">Описание</h3>
            <p className={task.description ? undefined : 'task-details__empty'}>
              {task.description || 'Дополнительный текст не добавлен.'}
            </p>
          </section>

          <dl className="task-details__facts">
            <div>
              <dt><Folder size={16} /> Проект</dt>
              <dd><i style={{ background: project?.color }} />{project?.name ?? 'Без проекта'}</dd>
            </div>
            <div>
              <dt><Flag size={16} /> Важность</dt>
              <dd className={`importance importance--${task.importance}`}>{task.importance === 'high' ? 'Важная' : 'Обычная'}</dd>
            </div>
            <div>
              <dt><Clock3 size={16} /> Срочность</dt>
              <dd className={timing.urgency === 'high' ? 'task-details__urgent' : undefined}>
                {timing.urgency === 'high' ? 'Срочная' : 'Не срочная'}
                {timing.overdue && <small>Просрочена</small>}
              </dd>
            </div>
            <div>
              <dt><CalendarClock size={16} /> Начало</dt>
              <dd>{startAt ?? 'Не задано'}</dd>
            </div>
            <div>
              <dt><Clock3 size={16} /> Длительность</dt>
              <dd>{formatDuration(task.plannedDurationMinutes)}</dd>
            </div>
            <div>
              <dt><CalendarClock size={16} /> Дедлайн</dt>
              <dd>{deadline ?? 'Без дедлайна'}</dd>
            </div>
            <div>
              <dt><Clock3 size={16} /> Порог срочности</dt>
              <dd>
                {effectiveUrgencyThreshold} ч до дедлайна
                <small>
                  {hasIndividualUrgencyThreshold
                    ? 'Индивидуальный для задачи'
                    : project
                      ? `Наследуется из проекта «${project.name}»`
                      : 'Системное значение'}
                </small>
              </dd>
            </div>
          </dl>

          {task.tags.length > 0 && (
            <section className="task-details__section" aria-labelledby="task-details-tags">
              <h3 id="task-details-tags">Теги</h3>
              <div className="task-details__tags">
                {task.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
              </div>
            </section>
          )}

          <section className="task-details__section" aria-labelledby="task-details-subtasks">
            <div className="task-details__section-title">
              <h3 id="task-details-subtasks">Подзадачи</h3>
              <span>{completedSubtasks}/{task.subtasks.length}</span>
            </div>
            {task.subtasks.length === 0 && <p className="task-details__empty">Подзадач нет.</p>}
            <div className="task-details__subtasks">
              {task.subtasks.map((subtask) => (
                <label key={subtask.id}>
                  <input type="checkbox" checked={subtask.completed} onChange={() => toggleSubtask(subtask.id)} />
                  <span>{subtask.title}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="task-details__section" aria-labelledby="task-details-reminders">
            <div className="task-details__section-title">
              <h3 id="task-details-reminders"><Bell size={16} /> Напоминания</h3>
              <span>{task.reminders.length}</span>
            </div>
            {task.reminders.length === 0 && <p className="task-details__empty">Напоминаний нет.</p>}
            <ul className="task-details__list">
              {task.reminders.map((reminder) => <li key={reminder.id}>{formatDateTime(reminder.at) ?? 'Некорректная дата'}</li>)}
            </ul>
          </section>

          <section className="task-details__section task-details__section--wide" aria-labelledby="task-details-attachments">
            <div className="task-details__section-title">
              <h3 id="task-details-attachments"><Paperclip size={16} /> Файлы и изображения</h3>
              <span>{task.attachments.length}</span>
            </div>
            {task.attachments.length === 0 && <p className="task-details__empty">Вложений нет.</p>}
            <div className="task-details__attachments">
              {task.attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => setPreviewAttachment(attachment)}
                  aria-label={`Просмотреть ${attachment.name}`}
                >
                  {attachment.type.startsWith('image/') && attachment.dataUrl
                    ? <img src={attachment.dataUrl} alt="" />
                    : <FileImage size={21} />}
                  <span><strong>{attachment.name}</strong><small>{formatFileSize(attachment.size)}</small></span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="task-details__footer">
          <button type="button" className="button button--danger-ghost" onClick={moveToTrash}>
            <Trash2 size={17} /> В корзину
          </button>
          {task.status === 'completed' && (
            <button type="button" className="button button--ghost" onClick={archive}>
              <Archive size={17} /> Архивировать
            </button>
          )}
        </footer>
      </section>
      {previewAttachment && <AttachmentViewer attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}
    </div>
  )
}
