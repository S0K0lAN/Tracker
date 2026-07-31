import { useMemo, useState } from 'react'
import { ArrowLeft, CalendarClock, Folder, FolderPlus, Plus, X } from 'lucide-react'
import type { Task } from '../domain/models'
import { PageHeader } from '../components/PageHeader'
import { TaskCard } from '../components/TaskCard'
import { useApp } from '../state/AppContext'
import './workspace-pages.css'

const projectColors = ['#778c70', '#9b7fbd', '#d78b69', '#5d88a3', '#c18b46', '#b76565', '#6f8f86', '#8472a7']

export function ProjectsPage({ onEditTask }: { onEditTask: (task: Task | null) => void }) {
  const { state, addProject } = useApp()
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(projectColors[0])
  const selected = state.projects.find((project) => project.id === selectedId)
  const projectTasks = useMemo(
    () => state.tasks.filter((task) => task.projectId === selectedId && (task.status === 'active' || task.status === 'completed')),
    [selectedId, state.tasks],
  )

  const createProject = () => {
    if (!name.trim()) return
    const id = crypto.randomUUID()
    addProject({
      id,
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      createdAt: new Date().toISOString(),
    })
    setName('')
    setDescription('')
    setColor(projectColors[0])
    setCreating(false)
    setSelectedId(id)
  }

  if (selected) {
    const active = projectTasks.filter((task) => task.status === 'active')
    return (
      <main className="page">
        <button className="workspace-back" onClick={() => setSelectedId(null)}><ArrowLeft size={17} /> Все проекты</button>
        <PageHeader
          eyebrow="Проект"
          title={selected.name}
          description={selected.description ?? `${active.length} активных задач`}
          actions={<button className="button button--primary" onClick={() => onEditTask(null)}><Plus size={18} /> Задача</button>}
        />
        <section className="project-detail-heading">
          <span style={{ background: selected.color }}><Folder size={18} /></span>
          <div><strong>{active.length} активных</strong><small>{projectTasks.filter((task) => task.status === 'completed').length} выполнено</small></div>
        </section>
        <section className="task-list">
          {projectTasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onEditTask} />)}
          {projectTasks.length === 0 && <div className="empty-state"><span><Folder /></span><h3>Проект пока пуст</h3><p>Добавьте первую задачу и выберите этот проект в редакторе.</p></div>}
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
        actions={<button className="button button--primary" onClick={() => setCreating(true)}><FolderPlus size={18} /> Новый проект</button>}
      />

      {creating && (
        <section className="project-creator" aria-label="Создание проекта">
          <header><div><span className="eyebrow">Новый проект</span><h2>Как назовём направление?</h2></div><button className="icon-button" onClick={() => setCreating(false)} aria-label="Закрыть создание проекта"><X /></button></header>
          <div className="project-creator__fields">
            <label className="field"><span>Название</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Запуск продукта" /></label>
            <label className="field"><span>Описание</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Коротко о результате проекта" /></label>
          </div>
          <fieldset className="project-color-picker">
            <legend>Цвет проекта</legend>
            {projectColors.map((item) => (
              <button key={item} type="button" className={color === item ? 'is-selected' : ''} onClick={() => setColor(item)} aria-label={`Цвет проекта ${item}`}>
                <span style={{ background: item }} />
              </button>
            ))}
          </fieldset>
          <footer><button className="button button--ghost" onClick={() => setCreating(false)}>Отмена</button><button className="button button--primary" disabled={!name.trim()} onClick={createProject}>Создать проект</button></footer>
        </section>
      )}

      <section className="project-grid">
        {state.projects.map((project) => {
          const tasks = state.tasks.filter((task) => task.projectId === project.id && task.status === 'active')
          const nearest = tasks.filter((task) => task.deadline).sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())[0]
          return (
            <button className="project-card" key={project.id} onClick={() => setSelectedId(project.id)}>
              <span className="project-card__icon" style={{ color: project.color, background: `color-mix(in srgb, ${project.color} 16%, var(--surface))` }}><Folder size={21} /></span>
              <span className="project-card__content">
                <strong>{project.name}</strong>
                <small>{project.description ?? (project.id === 'inbox' ? 'Задачи без проекта' : 'Без описания')}</small>
              </span>
              <span className="project-card__stats"><em>{tasks.length}</em><small>активных</small></span>
              <span className="project-card__deadline">{nearest ? <><CalendarClock size={13} /> {new Date(nearest.deadline!).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</> : 'Нет ближайших сроков'}</span>
            </button>
          )
        })}
        <button className="project-card project-card--new" onClick={() => setCreating(true)}><FolderPlus /><strong>Создать проект</strong><small>Добавьте новое направление</small></button>
      </section>
    </main>
  )
}
