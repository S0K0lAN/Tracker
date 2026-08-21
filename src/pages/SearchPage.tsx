import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bookmark, Filter, Folder, Hash, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { Importance, SavedFilter, Task, Urgency } from '../domain/models'
import { INPUT_LIMITS } from '../domain/inputLimits'
import { matchesSavedFilter } from '../domain/taskFilters'
import { PageHeader } from '../components/PageHeader'
import { SelectMenu } from '../components/SelectMenu'
import { TaskCard } from '../components/TaskCard'
import { useApp } from '../state/AppContext'
import { NavLink, useRouter } from '../core/router/Router'
import { projectPath } from '../core/router/projectRoute'
import './search-page.css'

type SearchTab = 'all' | 'tasks' | 'projects' | 'tags' | 'filters'

export function SearchPage({ onEditTask }: { onEditTask: (task: Task | null) => void }) {
  const { state, addSavedFilter, removeSavedFilter } = useApp()
  const { search, navigate } = useRouter()
  const [query, setQuery] = useState(() => new URLSearchParams(search).get('q') ?? '')
  const [tab, setTab] = useState<SearchTab>(() => searchTabFrom(new URLSearchParams(search).get('tab')))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [importance, setImportance] = useState<Importance | ''>('')
  const [urgency, setUrgency] = useState<Urgency | ''>('')
  const [status, setStatus] = useState<SavedFilter['status']>('active')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagMode, setTagMode] = useState<SavedFilter['tagMode']>('any')
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const allTags = useMemo(() => [...new Set(state.tasks.flatMap((task) => task.tags))].sort(), [state.tasks])
  const projectsById = useMemo(
    () => new Map(state.projects.map((project) => [project.id, project])),
    [state.projects],
  )
  const draftFilter: SavedFilter = {
    id: 'draft',
    name: '',
    query,
    projectId: projectId || undefined,
    tags: selectedTags,
    tagMode,
    importance: importance || undefined,
    urgency: urgency || undefined,
    status,
    createdAt: '',
  }
  const hasCriteria = Boolean(query.trim() || projectId || importance || urgency || selectedTags.length || status !== 'active')
  const tasks = hasCriteria
    ? state.tasks.filter((task) => matchesSavedFilter(task, draftFilter, projectsById.get(task.projectId)))
    : []
  const projects = query.trim()
    ? state.projects.filter((project) => `${project.name} ${project.description ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    : []
  const tags = query.trim() ? allTags.filter((tag) => tag.toLowerCase().includes(query.toLowerCase().replace(/^#/, ''))) : []
  const savedFilters = query.trim()
    ? state.savedFilters.filter((filter) => filter.name.toLowerCase().includes(query.toLowerCase()))
    : state.savedFilters
  const activeFilterCount = [projectId, importance, urgency, status !== 'active' ? status : '', ...selectedTags].filter(Boolean).length

  useEffect(() => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (tab !== 'all') params.set('tab', tab)
    const encoded = params.toString()
    const nextLocation = `/search${encoded ? `?${encoded}` : ''}`
    if (`/search${search}` !== nextLocation) navigate(nextLocation, { replace: true })
  }, [navigate, query, search, tab])

  const reset = () => {
    setProjectId('')
    setImportance('')
    setUrgency('')
    setStatus('active')
    setSelectedTags([])
    setTagMode('any')
  }

  const saveFilter = () => {
    if (!saveName.trim()) return
    addSavedFilter({
      ...draftFilter,
      id: crypto.randomUUID(),
      name: saveName.trim(),
      createdAt: new Date().toISOString(),
    })
    setSaveName('')
    setSaving(false)
  }

  const applyFilter = (filter: SavedFilter) => {
    setQuery(filter.query)
    setProjectId(filter.projectId ?? '')
    setSelectedTags(filter.tags)
    setTagMode(filter.tagMode)
    setImportance(filter.importance ?? '')
    setUrgency(filter.urgency ?? '')
    setStatus(filter.status)
    setTab('tasks')
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Найдите в своём пространстве"
        title="Поиск"
        description="Задачи, проекты, теги и сохранённые фильтры в одном месте"
        actions={<button className="button button--primary" onClick={() => onEditTask(null)}><Plus size={17} /> Новая задача</button>}
      />

      <section className="global-search">
        <Search size={21} />
        <input autoFocus maxLength={INPUT_LIMITS.searchQuery} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Что вы ищете?" aria-label="Глобальный поиск" />
        {query && <button className="icon-button" onClick={() => setQuery('')} aria-label="Очистить глобальный поиск"><X size={17} /></button>}
        <button className={`button button--ghost ${filtersOpen ? 'is-active' : ''}`} onClick={() => setFiltersOpen((current) => !current)}>
          <SlidersHorizontal size={17} /> Фильтры {activeFilterCount > 0 && <em>{activeFilterCount}</em>}
        </button>
      </section>

      {filtersOpen && (
        <section className="search-filters">
          <div className="search-filters__grid">
            <div className="field"><span>Проект</span><SelectMenu<string> label="Фильтр по проекту" value={projectId} onChange={setProjectId} searchable options={[{ value: '', label: 'Все проекты', icon: <Folder /> }, ...state.projects.map((project) => ({ value: project.id, label: project.name, color: project.color, icon: <Folder /> }))]} /></div>
            <div className="field"><span>Важность</span><SelectMenu<Importance | ''> label="Фильтр по важности" value={importance} onChange={setImportance} options={[{ value: '', label: 'Любая' }, { value: 'low', label: 'Обычная' }, { value: 'high', label: 'Важная' }]} /></div>
            <div className="field"><span>Срочность</span><SelectMenu<Urgency | ''> label="Фильтр по срочности" value={urgency} onChange={setUrgency} options={[{ value: '', label: 'Любая' }, { value: 'low', label: 'Не срочно' }, { value: 'high', label: 'Срочно' }]} /></div>
            <div className="field"><span>Статус</span><SelectMenu<SavedFilter['status']> label="Фильтр по статусу" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Активные' }, { value: 'completed', label: 'Выполненные' }, { value: 'all', label: 'Все' }]} /></div>
          </div>
          <div className="search-filter-tags">
            <span><Hash size={15} /> Теги</span>
            <div>{allTags.map((tag) => <button className={`tag tag--button ${selectedTags.includes(tag) ? 'tag--selected' : ''}`} key={tag} onClick={() => setSelectedTags(selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag])}>#{tag}</button>)}</div>
            {selectedTags.length > 1 && <span className="tag-mode"><button className={tagMode === 'any' ? 'is-selected' : ''} onClick={() => setTagMode('any')}>любой</button><button className={tagMode === 'all' ? 'is-selected' : ''} onClick={() => setTagMode('all')}>все</button></span>}
          </div>
          <footer>
            <button className="text-button" onClick={reset}><X size={15} /> Сбросить</button>
            {saving ? (
              <span className="save-filter"><input autoFocus maxLength={INPUT_LIMITS.savedFilterName} value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Название фильтра" aria-label="Название фильтра" /><button className="button button--primary" onClick={saveFilter}>Сохранить</button></span>
            ) : <button className="button button--ghost" disabled={!hasCriteria} onClick={() => setSaving(true)}><Bookmark size={15} /> Сохранить фильтр</button>}
          </footer>
        </section>
      )}

      <nav className="search-tabs" aria-label="Тип результатов">
        {([
          ['all', 'Все', tasks.length + projects.length + tags.length + savedFilters.length],
          ['tasks', 'Задачи', tasks.length],
          ['projects', 'Проекты', projects.length],
          ['tags', 'Теги', tags.length],
          ['filters', 'Фильтры', savedFilters.length],
        ] as const).map(([value, label, count]) => <button key={value} className={tab === value ? 'is-selected' : ''} onClick={() => setTab(value)}>{label}<em>{count}</em></button>)}
      </nav>

      <div className="search-results">
        {(tab === 'all' || tab === 'tasks') && tasks.length > 0 && <ResultSection title="Задачи" icon={<Search />}>{tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onEditTask} />)}</ResultSection>}
        {(tab === 'all' || tab === 'projects') && projects.length > 0 && <ResultSection title="Проекты" icon={<Folder />}>{projects.map((project) => <NavLink className="search-entity search-entity--link" to={projectPath(project.id)} key={project.id} aria-label={`Открыть проект ${project.name}`}><span style={{ color: project.color }}><Folder /></span><div><strong>{project.name}</strong><small>{project.description ?? 'Без описания'}</small></div><em>{state.tasks.filter((task) => task.projectId === project.id && task.status === 'active').length} задач</em></NavLink>)}</ResultSection>}
        {(tab === 'all' || tab === 'tags') && tags.length > 0 && <ResultSection title="Теги" icon={<Hash />}><div className="search-tag-cloud">{tags.map((tag) => <button className="tag tag--button" key={tag} onClick={() => { setSelectedTags([tag]); setTab('tasks') }}>#{tag}<em>{state.tasks.filter((task) => task.tags.includes(tag)).length}</em></button>)}</div></ResultSection>}
        {(tab === 'all' || tab === 'filters') && savedFilters.length > 0 && <ResultSection title="Сохранённые фильтры" icon={<Filter />}>{savedFilters.map((filter) => <article className="search-entity" key={filter.id}><button className="search-entity__main" onClick={() => applyFilter(filter)}><Bookmark /><span><strong>{filter.name}</strong><small>{[filter.query, filter.tags.map((tag) => `#${tag}`).join(' ')].filter(Boolean).join(' · ') || 'Набор условий'}</small></span></button><button className="icon-button" onClick={() => removeSavedFilter(filter.id)} aria-label={`Удалить фильтр ${filter.name}`}><Trash2 size={15} /></button></article>)}</ResultSection>}

        {!hasCriteria && state.savedFilters.length === 0 && <div className="empty-state workspace-empty"><span><Search /></span><h2>Начните поиск</h2><p>Введите название задачи, проекта или тег — либо откройте фильтры.</p></div>}
        {hasCriteria && tasks.length + projects.length + tags.length + savedFilters.length === 0 && <div className="empty-state workspace-empty"><span><Search /></span><h2>Ничего не найдено</h2><p>Попробуйте изменить запрос или сбросить часть условий.</p></div>}
      </div>

    </main>
  )
}

function ResultSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="search-result-section"><header><span>{icon}</span><h2>{title}</h2></header><div>{children}</div></section>
}

function searchTabFrom(value: string | null): SearchTab {
  return value === 'tasks' || value === 'projects' || value === 'tags' || value === 'filters'
    ? value
    : 'all'
}
