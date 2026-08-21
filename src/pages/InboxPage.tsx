import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CheckCircle2, Columns3, Filter, LayoutList, ListFilter, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { InboxSort, InboxView, Task } from '../domain/models'
import { getTaskUrgency, isSameLocalDay } from '../domain/models'
import { sortTasks } from '../domain/taskFilters'
import { useApp } from '../state/AppContext'
import { PageHeader } from '../components/PageHeader'
import { SelectMenu } from '../components/SelectMenu'
import { TaskCard } from '../components/TaskCard'
import { useNow } from '../hooks/useNow'
import './inbox-layouts.css'

type FilterMode = 'all' | 'today' | 'important' | 'urgent'
const VIRTUAL_LIST_THRESHOLD = 150

export function InboxPage({ onEditTask }: { onEditTask: (task: Task | null) => void }) {
  const { state, updateSettings, archiveCompletedTasks } = useApp()
  const now = useNow()
  const [query, setQuery] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [projectId, setProjectId] = useState('')

  const tags = useMemo(() => [...new Set(state.tasks.flatMap((task) => task.tags))].sort(), [state.tasks])
  const visibleTasks = useMemo(
    () =>
      sortTasks(state.tasks.filter((task) => {
        if (task.status === 'archived' || task.status === 'deleted') return false
        if (!showCompleted && task.status === 'completed') return false
        if (query && !`${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())) return false
        if (filter === 'today' && !isSameLocalDay(task.startAt, now) && !isSameLocalDay(task.deadline, now)) return false
        if (filter === 'important' && task.importance !== 'high') return false
        if (filter === 'urgent' && getTaskUrgency(task, now) !== 'high') return false
        if (projectId && task.projectId !== projectId) return false
        if (selectedTags.length > 0) {
          const tagMatch = tagMode === 'all'
            ? selectedTags.every((tag) => task.tags.includes(tag))
            : selectedTags.some((tag) => task.tags.includes(tag))
          if (!tagMatch) return false
        }
        return true
      }), state.settings.inboxSort),
    [filter, now, projectId, query, selectedTags, showCompleted, state.settings.inboxSort, state.tasks, tagMode],
  )

  const summary = useMemo(() => {
    const result = { active: 0, completed: 0, today: 0, urgent: 0, important: 0 }
    for (const task of state.tasks) {
      if (task.status === 'completed') {
        result.completed += 1
        continue
      }
      if (task.status !== 'active') continue
      result.active += 1
      if (isSameLocalDay(task.startAt, now) || isSameLocalDay(task.deadline, now)) result.today += 1
      if (getTaskUrgency(task, now) === 'high') result.urgent += 1
      if (task.importance === 'high') result.important += 1
    }
    return result
  }, [now, state.tasks])
  const activeCount = summary.active
  const completedCount = summary.completed
  const view = state.settings.inboxView

  return (
    <main className="page">
      <PageHeader
        eyebrow={`${capitalize(now.toLocaleDateString('ru-RU', { weekday: 'long' }))} · обзор дня`}
        title="Входящие"
        description={`${activeCount} активных задач во всех проектах`}
        actions={<button className="button button--primary header-add" onClick={() => onEditTask(null)}><Plus size={18} /> Добавить задачу</button>}
      />

      <section className="overview-strip" aria-label="Сводка">
        <div><span>На сегодня</span><strong>{summary.today}</strong></div>
        <div><span>Срочные</span><strong>{summary.urgent}</strong></div>
        <div><span>Важные</span><strong>{summary.important}</strong></div>
        <div><span>Завершено</span><strong>{summary.completed}</strong></div>
      </section>

      <section className="toolbar">
        <label className="search-field">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по задачам и тегам" aria-label="Поиск задач" />
          {query && <button className="icon-button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={15} /></button>}
        </label>
        <button className={`button button--ghost ${filtersOpen ? 'is-active' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)}>
          <SlidersHorizontal size={17} /> Фильтры
          {(selectedTags.length > 0 || filter !== 'all' || projectId) && <span className="filter-count">{selectedTags.length + (filter === 'all' ? 0 : 1) + (projectId ? 1 : 0)}</span>}
        </button>
        <button className={`button button--ghost ${showCompleted ? 'is-active' : ''}`} onClick={() => setShowCompleted(!showCompleted)}>
          <CheckCircle2 size={17} /> {showCompleted ? 'Скрыть завершённые' : 'Показать завершённые'}
        </button>
        {showCompleted && completedCount > 0 && <button className="button button--ghost" onClick={archiveCompletedTasks}><Archive size={17} /> Архивировать</button>}
        <SelectMenu<InboxSort>
          className="inbox-sort"
          label="Сортировка входящих"
          value={state.settings.inboxSort}
          onChange={(inboxSort) => updateSettings({ inboxSort })}
          options={[
            { value: 'created-desc', label: 'Сначала новые' },
            { value: 'deadline-asc', label: 'По ближайшему дедлайну' },
            { value: 'importance-desc', label: 'Сначала важные' },
            { value: 'title-asc', label: 'По названию' },
          ]}
        />
      </section>

      {filtersOpen && (
        <section className="filter-panel">
          <div>
            <span className="filter-panel__label"><Filter size={15} /> Быстрый фильтр</span>
            <div className="segmented">
              {([
                ['all', 'Все'],
                ['today', 'Сегодня'],
                ['important', 'Важные'],
                ['urgent', 'Срочные'],
              ] as const).map(([value, label]) => (
                <button key={value} className={filter === value ? 'is-selected' : ''} onClick={() => setFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="filter-panel__label"><ListFilter size={15} /> Теги</span>
            <div className="tag-filter-row">
              {tags.map((tag) => (
                <button
                  className={`tag tag--button ${selectedTags.includes(tag) ? 'tag--selected' : ''}`}
                  onClick={() => setSelectedTags(selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag])}
                  key={tag}
                >#{tag}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="filter-panel__label"><Filter size={15} /> Проект</span>
            <SelectMenu<string>
              label="Фильтр по проекту во входящих"
              value={projectId}
              onChange={setProjectId}
              searchable
              options={[
                { value: '', label: 'Все проекты' },
                ...state.projects.map((project) => ({ value: project.id, label: project.name, color: project.color })),
              ]}
            />
          </div>
          {selectedTags.length > 1 && (
            <div className="tag-mode">
              <span>Совпадение:</span>
              <button className={tagMode === 'any' ? 'is-selected' : ''} onClick={() => setTagMode('any')}>любой тег</button>
              <button className={tagMode === 'all' ? 'is-selected' : ''} onClick={() => setTagMode('all')}>все теги</button>
            </div>
          )}
          {(selectedTags.length > 0 || filter !== 'all' || projectId) && (
            <button className="text-button filter-reset" onClick={() => { setSelectedTags([]); setFilter('all'); setProjectId('') }}>
              <X size={15} /> Сбросить всё
            </button>
          )}
        </section>
      )}

      <section className="inbox-viewbar">
        <div className="view-switcher" aria-label="Вид входящих">
          {([
            ['list', 'Список', LayoutList],
            ['board', 'Доска', Columns3],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} className={view === value ? 'is-selected' : ''} onClick={() => updateSettings({ inboxView: value as InboxView })} aria-label={`Вид: ${label}`} title={label}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={`task-list task-list--${view}`}>
        <div className="section-heading"><h2>{view === 'list' ? 'Все задачи' : 'Доска по проектам'}</h2><span>{visibleTasks.length}</span></div>
        {view === 'list' && visibleTasks.length < VIRTUAL_LIST_THRESHOLD && visibleTasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onEditTask} />)}
        {view === 'list' && visibleTasks.length >= VIRTUAL_LIST_THRESHOLD && <VirtualTaskList tasks={visibleTasks} onOpen={onEditTask} />}
        {view === 'board' && <InboxBoard tasks={visibleTasks} onEditTask={onEditTask} />}
        {visibleTasks.length === 0 && (
          <div className="empty-state">
            <span><Search /></span>
            <h3>Ничего не найдено</h3>
            <p>Измените фильтры или добавьте новую задачу.</p>
            <button className="button button--primary" onClick={() => onEditTask(null)}><Plus size={17} /> Добавить задачу</button>
          </div>
        )}
      </section>
    </main>
  )
}

function capitalize(value: string) {
  return value ? `${value[0].toLocaleUpperCase('ru-RU')}${value.slice(1)}` : value
}

function VirtualTaskList({ tasks, onOpen }: { tasks: Task[]; onOpen(task: Task): void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [windowState, setWindowState] = useState({ start: 0, end: 16, rowHeight: 152 })

  useEffect(() => {
    let frame = 0
    const updateWindow = () => {
      frame = 0
      const container = containerRef.current
      if (!container) return
      const rowHeight = window.innerWidth <= 600 ? 210 : 152
      const containerTop = container.getBoundingClientRect().top + window.scrollY
      const relativeScroll = Math.max(0, window.scrollY - containerTop)
      const overscan = 3
      const start = Math.max(0, Math.floor(relativeScroll / rowHeight) - overscan)
      const visibleRows = Math.ceil(window.innerHeight / rowHeight) + overscan * 2
      const end = Math.min(tasks.length, start + visibleRows)
      setWindowState((current) => (
        current.start === start && current.end === end && current.rowHeight === rowHeight
          ? current
          : { start, end, rowHeight }
      ))
    }
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateWindow)
    }
    updateWindow()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [tasks.length])

  return (
    <div
      ref={containerRef}
      className="virtual-task-list"
      style={{ height: tasks.length * windowState.rowHeight }}
      role="list"
      aria-label={`${tasks.length} задач`}
    >
      {tasks.slice(windowState.start, windowState.end).map((task, offset) => {
        const index = windowState.start + offset
        return (
          <div
            className="virtual-task-list__row"
            style={{ height: windowState.rowHeight, transform: `translateY(${index * windowState.rowHeight}px)` }}
            key={task.id}
            role="listitem"
          >
            <TaskCard task={task} onOpen={onOpen} />
          </div>
        )
      })}
    </div>
  )
}

function InboxBoard({ tasks, onEditTask }: { tasks: Task[]; onEditTask(task: Task): void }) {
  const { state } = useApp()
  const projects = state.projects.filter((project) => tasks.some((task) => task.projectId === project.id))
  return (
    <div className="inbox-board">
      {projects.map((project) => {
        const projectTasks = tasks.filter((task) => task.projectId === project.id)
        return (
          <section className="board-column" key={project.id}>
            <header><i style={{ background: project.color }} /><strong>{project.name}</strong><em>{projectTasks.length}</em></header>
            <div>{projectTasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onEditTask} />)}</div>
          </section>
        )
      })}
    </div>
  )
}
