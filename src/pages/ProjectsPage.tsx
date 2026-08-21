import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeft, CalendarClock, Folder, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Project, Task } from '../domain/models'
import { INPUT_LIMITS } from '../domain/inputLimits'
import { PageHeader } from '../components/PageHeader'
import { TaskCard } from '../components/TaskCard'
import { useApp } from '../state/AppContext'
import './workspace-pages.css'

const projectColors = ['#778c70', '#9b7fbd', '#d78b69', '#5d88a3', '#c18b46', '#b76565', '#6f8f86', '#8472a7']

const urgencyThresholdOptions = [
  { value: 1, label: '1 час' },
  { value: 24, label: '1 день' },
  { value: 72, label: '3 дня' },
  { value: 168, label: '7 дней' },
  { value: 336, label: '14 дней' },
]

const formatUrgencyThreshold = (hours: number) => (
  urgencyThresholdOptions.find((option) => option.value === hours)?.label ?? `${hours} ч`
)

export function ProjectsPage({
  onEditTask,
  selectedProjectId,
  onSelectProject,
}: {
  onEditTask: (task: Task | null, defaults?: Partial<Pick<Task, 'projectId'>>) => void
  selectedProjectId?: string | null
  onSelectProject?: (projectId: string | null) => void
}) {
  const { state, addProject, updateProject, removeProject } = useApp()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(projectColors[0])
  const [urgencyThresholdHours, setUrgencyThresholdHours] = useState(state.settings.defaultUrgencyThresholdHours)
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout>>()
  const newProjectTriggerRef = useRef<HTMLButtonElement>(null)
  const projectFormReturnFocusRef = useRef<HTMLElement | null>(null)
  const controlledSelection = selectedProjectId !== undefined
  const selectedId = controlledSelection ? selectedProjectId : localSelectedId
  const selectProject = (projectId: string | null) => {
    onSelectProject?.(projectId)
    if (!controlledSelection) setLocalSelectedId(projectId)
  }
  const selected = state.projects.find((project) => project.id === selectedId)
  const projectTasks = useMemo(
    () => state.tasks.filter((task) => task.projectId === selectedId && (task.status === 'active' || task.status === 'completed')),
    [selectedId, state.tasks],
  )

  useEffect(() => () => {
    if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current)
  }, [])

  const resetProjectForm = () => {
    setCreating(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setColor(projectColors[0])
    setUrgencyThresholdHours(state.settings.defaultUrgencyThresholdHours)
  }

  const closeProjectForm = () => {
    resetProjectForm()
    requestAnimationFrame(() => {
      const target = projectFormReturnFocusRef.current?.isConnected
        ? projectFormReturnFocusRef.current
        : document.querySelector<HTMLElement>('.workspace main h1')
      projectFormReturnFocusRef.current = null
      if (!target) return
      if (!target.matches('button, a, [tabindex]')) target.tabIndex = -1
      target.focus()
    })
  }

  const openProjectCreator = () => {
    resetProjectForm()
    projectFormReturnFocusRef.current = newProjectTriggerRef.current
    setCreating(true)
  }

  const openProjectEditor = (project: Project) => {
    if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current)
    const activeElement = document.activeElement as HTMLElement | null
    projectFormReturnFocusRef.current = activeElement?.closest('.project-card__actions')
      ?.querySelector<HTMLElement>('.project-card__more') ?? activeElement
    setEditingId(project.id)
    setName(project.name)
    setDescription(project.description ?? '')
    setColor(project.color)
    setUrgencyThresholdHours(project.urgencyThresholdHours)
    setCreating(true)
    setOpenMenuId(null)
    setDeleteConfirmId(null)
  }

  const saveProject = () => {
    if (!name.trim()) return
    const existing = state.projects.find((project) => project.id === editingId)
    const project: Project = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      urgencyThresholdHours,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    if (existing) updateProject(project)
    else addProject(project)
    closeProjectForm()
    if (!existing) selectProject(project.id)
  }

  const deleteProject = (projectId: string, trigger?: HTMLElement) => {
    if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current)
    const card = trigger?.closest<HTMLElement>('.project-card')
    const cards = card?.parentElement ? [...card.parentElement.querySelectorAll<HTMLElement>('.project-card')] : []
    const index = card ? cards.indexOf(card) : -1
    const adjacent = index >= 0
      ? cards[index + 1]?.querySelector<HTMLElement>('.project-card__open')
        ?? cards[index - 1]?.querySelector<HTMLElement>('.project-card__open')
      : null
    const pageHeading = card?.closest('main')?.querySelector<HTMLElement>('h1')
    removeProject(projectId)
    setOpenMenuId(null)
    setDeleteConfirmId(null)
    if (selectedId === projectId) selectProject(null)
    if (editingId === projectId) closeProjectForm()
    requestAnimationFrame(() => {
      const target = adjacent?.isConnected ? adjacent : pageHeading?.isConnected ? pageHeading : null
      if (!target) return
      if (!target.matches('button, a, [tabindex]')) target.tabIndex = -1
      target.focus()
    })
  }

  const openProjectMenu = (projectId: string) => {
    if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current)
    setOpenMenuId(projectId)
  }

  const closeProjectMenuSoon = (projectId: string) => {
    if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current)
    menuCloseTimer.current = setTimeout(() => {
      setOpenMenuId((current) => current === projectId ? null : current)
      setDeleteConfirmId((current) => current === projectId ? null : current)
    }, 120)
  }

  const onProjectMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpenMenuId(null)
      setDeleteConfirmId(null)
      event.currentTarget.querySelector<HTMLButtonElement>('.project-card__more')?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (Math.max(0, current) + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  if (selected) {
    const active = projectTasks.filter((task) => task.status === 'active')
    return (
      <main className="page">
        <button className="workspace-back" onClick={() => selectProject(null)}><ArrowLeft size={17} /> Все проекты</button>
        <PageHeader
          eyebrow="Проект"
          title={selected.name}
          description={selected.description ?? `${active.length} активных задач`}
          actions={<button className="button button--primary" onClick={() => onEditTask(null, { projectId: selected.id })}><Plus size={18} /> Задача</button>}
        />
        <button
          className="button button--primary project-detail-mobile-action"
          onClick={() => onEditTask(null, { projectId: selected.id })}
          aria-label={`Задача в проект «${selected.name}»`}
        >
          <Plus size={18} /> Задача в проект
        </button>
        <section className="project-detail-heading">
          <span style={{ background: selected.color }}><Folder size={18} /></span>
          <div>
            <strong>{active.length} активных</strong>
            <small>{projectTasks.filter((task) => task.status === 'completed').length} выполнено</small>
            <small>Срочность за {formatUrgencyThreshold(selected.urgencyThresholdHours)} до дедлайна</small>
          </div>
        </section>
        <section className="task-list">
          {projectTasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onEditTask} />)}
          {projectTasks.length === 0 && <div className="empty-state"><span><Folder /></span><h3>Проект пока пуст</h3><p>Добавьте первую задачу — проект подставится в редактор автоматически.</p></div>}
        </section>
      </main>
    )
  }

  return (
    <main className="page page--wide">
      <PageHeader
        eyebrow="Контекст и направления"
        title="Проекты"
        description="Собирайте связанные задачи в спокойные рабочие пространства"
        actions={<button ref={newProjectTriggerRef} className="button button--primary" onClick={openProjectCreator}><FolderPlus size={18} /> Новый проект</button>}
      />

      {creating && (
        <section className="project-creator" aria-label={editingId ? 'Редактирование проекта' : 'Создание проекта'}>
          <header>
            <div>
              <span className="eyebrow">{editingId ? 'Редактирование проекта' : 'Новый проект'}</span>
              <h2>{editingId ? 'Обновите детали проекта' : 'Как назовём направление?'}</h2>
            </div>
            <button className="icon-button" onClick={closeProjectForm} aria-label={editingId ? 'Закрыть редактирование проекта' : 'Закрыть создание проекта'}><X /></button>
          </header>
          <div className="project-creator__fields">
            <label className="field"><span>Название</span><input autoFocus maxLength={INPUT_LIMITS.projectName} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Запуск продукта" /></label>
            <label className="field"><span>Описание</span><input maxLength={INPUT_LIMITS.projectDescription} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Коротко о результате проекта" /></label>
            <label className="field">
              <span>Задачи становятся срочными за</span>
              <select value={urgencyThresholdHours} onChange={(event) => setUrgencyThresholdHours(Number(event.target.value))}>
                {!urgencyThresholdOptions.some((option) => option.value === urgencyThresholdHours) && (
                  <option value={urgencyThresholdHours}>{formatUrgencyThreshold(urgencyThresholdHours)}</option>
                )}
                {urgencyThresholdOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="project-color-picker">
            <legend>Цвет проекта</legend>
            {projectColors.map((item) => (
              <button key={item} type="button" className={color === item ? 'is-selected' : ''} onClick={() => setColor(item)} aria-label={`Цвет проекта ${item}`}>
                <span style={{ background: item }} />
              </button>
            ))}
          </fieldset>
          <footer><button className="button button--ghost" onClick={closeProjectForm}>Отмена</button><button className="button button--primary" disabled={!name.trim()} onClick={saveProject}>{editingId ? 'Сохранить изменения' : 'Создать проект'}</button></footer>
        </section>
      )}

      <section className="project-grid">
        {state.projects.map((project) => {
          const tasks = state.tasks.filter((task) => task.projectId === project.id && task.status === 'active')
          const nearest = tasks.filter((task) => task.deadline).sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())[0]
          return (
            <article className={`project-card ${openMenuId === project.id ? 'project-card--menu-open' : ''}`} key={project.id}>
              <button className="project-card__open" onClick={() => selectProject(project.id)} aria-label={`Открыть проект ${project.name}`}>
                <span className="project-card__icon" style={{ color: project.color, background: `color-mix(in srgb, ${project.color} 16%, var(--surface))` }}><Folder size={21} /></span>
                <span className="project-card__content">
                  <strong>{project.name}</strong>
                  <small>{project.description ?? (project.id === 'inbox' ? 'Задачи без проекта' : 'Без описания')}</small>
                </span>
                <span className="project-card__stats"><em>{tasks.length}</em><small>активных</small></span>
                <span className="project-card__deadline">{nearest ? <><CalendarClock size={13} /> {new Date(nearest.deadline!).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</> : 'Нет ближайших сроков'}</span>
              </button>
              <div
                className="project-card__actions"
                onPointerEnter={() => openProjectMenu(project.id)}
                onPointerLeave={() => closeProjectMenuSoon(project.id)}
                onFocus={() => openProjectMenu(project.id)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setOpenMenuId(null)
                    setDeleteConfirmId(null)
                  }
                }}
                onKeyDown={onProjectMenuKeyDown}
              >
                <button
                  className="project-card__more"
                  type="button"
                  aria-label={`Действия проекта ${project.name}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === project.id}
                  onClick={() => openProjectMenu(project.id)}
                >
                  <MoreHorizontal size={20} aria-hidden="true" />
                </button>
                {openMenuId === project.id && (
                  <div className="project-card__menu" role="menu" aria-label={`Действия проекта ${project.name}`}>
                    <button type="button" role="menuitem" onClick={() => openProjectEditor(project)}>
                      <Pencil size={16} aria-hidden="true" /> Редактировать проект
                    </button>
                    {project.id !== 'inbox' && (
                      <button
                        type="button"
                        role="menuitem"
                        className="project-card__menu-danger"
                        onClick={(event) => {
                          if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current)
                          if (deleteConfirmId === project.id) deleteProject(project.id, event.currentTarget)
                          else setDeleteConfirmId(project.id)
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" /> {deleteConfirmId === project.id ? 'Подтвердить удаление' : 'Удалить проект'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          )
        })}
        <button className="project-card project-card--new" onClick={openProjectCreator}><FolderPlus /><strong>Создать проект</strong><small>Добавьте новое направление</small></button>
      </section>
    </main>
  )
}
