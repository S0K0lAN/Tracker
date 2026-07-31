import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  CircleUserRound,
  Command,
  FolderKanban,
  Grid2X2,
  Inbox,
  Leaf,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  SunMedium,
  Trash2,
  X,
} from 'lucide-react'
import { NavLink, useRouter } from './core/router/Router'
import type { Task } from './domain/models'
import { TaskEditor } from './components/TaskEditor'
import { InboxPage } from './pages/InboxPage'
import { CalendarPage } from './pages/CalendarPage'
import { MatrixPage } from './pages/MatrixPage'
import { HabitsPage } from './pages/HabitsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TodayPage } from './pages/TodayPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SearchPage } from './pages/SearchPage'
import { TrashPage } from './pages/TrashPage'
import { PomodoroTimer } from './components/PomodoroTimer'
import { setInert, trapTabKey } from './components/focusTrap'
import { useApp } from './state/AppContext'

const navigation = [
  { to: '/today', label: 'Сегодня', icon: SunMedium },
  { to: '/inbox', label: 'Входящие', icon: Inbox },
  { to: '/projects', label: 'Проекты', icon: FolderKanban },
  { to: '/calendar', label: 'Календарь', icon: CalendarDays },
  { to: '/matrix', label: 'Матрица', icon: Grid2X2 },
  { to: '/search', label: 'Поиск', icon: Search },
  { to: '/habits', label: 'Привычки', icon: Leaf },
  { to: '/trash', label: 'Корзина', icon: Trash2 },
  { to: '/settings', label: 'Настройки', icon: Settings },
]

const bottomNavigation = navigation.filter((item) => ['/today', '/inbox', '/calendar', '/search', '/settings'].includes(item.to))

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useApp()
  const { navigate } = useRouter()
  const asideRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [drawerMode, setDrawerMode] = useState(() => window.matchMedia?.('(max-width: 1100px)').matches ?? false)
  const activeCount = state.tasks.filter((task) => task.status === 'active').length

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1100px)')
    if (!media) return
    const update = () => setDrawerMode(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    const aside = asideRef.current
    if (!aside) return
    setInert([aside], drawerMode && !open)
    return () => setInert([aside], false)
  }, [drawerMode, open])

  useEffect(() => {
    if (!drawerMode || !open) return
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => closeRef.current?.focus())
    return () => {
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus()
      })
    }
  }, [drawerMode, open])

  return (
    <>
      {open && <button className="sidebar-overlay" onClick={onClose} aria-label="Закрыть меню" />}
      <aside
        ref={asideRef}
        className={`sidebar ${open ? 'sidebar--open' : ''}`}
        role={drawerMode && open ? 'dialog' : undefined}
        aria-modal={drawerMode && open ? true : undefined}
        aria-label={drawerMode && open ? 'Меню приложения' : undefined}
        tabIndex={drawerMode && open ? -1 : undefined}
        onKeyDown={(event) => {
          if (!drawerMode || !open) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }
          trapTabKey(event, asideRef.current)
        }}
      >
        <div className="brand">
          <span className="brand__mark"><Sparkles size={20} /></span>
          <span><strong>Focus Flow</strong><small>пространство ясности</small></span>
          <button ref={closeRef} className="icon-button sidebar__close" onClick={onClose} aria-label="Закрыть меню"><X size={20} /></button>
        </div>
        <nav className="main-nav" aria-label="Основная навигация">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={onClose} className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}>
              <Icon size={20} />
              <span>{label}</span>
              {to === '/inbox' && <em>{activeCount}</em>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="focus-card">
            <span className="focus-card__icon"><CheckCircle2 size={18} /></span>
            <div><strong>{state.tasks.filter((task) => task.status === 'completed').length} выполнено</strong><small>Продолжайте в своём ритме</small></div>
          </div>
          <button className="profile-button" onClick={() => { navigate('/settings'); onClose() }}>
            <CircleUserRound size={30} />
            <span><strong>Моё пространство</strong><small>Данные сохранены локально</small></span>
          </button>
        </div>
      </aside>
    </>
  )
}

function NotFoundPage() {
  return (
    <main className="empty-page">
      <span className="empty-page__icon"><Search /></span>
      <h1>Страница не найдена</h1>
      <p>Похоже, такой страницы пока нет.</p>
      <NavLink className="button button--primary" to="/inbox"><ChevronLeft size={17} /> Вернуться во входящие</NavLink>
    </main>
  )
}

export function App() {
  const [editorTask, setEditorTask] = useState<Task | null | undefined>(undefined)
  const [editorDefaults, setEditorDefaults] = useState<Partial<Pick<Task, 'startAt' | 'deadline'>> | undefined>()
  const [menuOpen, setMenuOpen] = useState(false)
  const { path, navigate } = useRouter()
  const openEditor = (task: Task | null, defaults?: Partial<Pick<Task, 'startAt' | 'deadline'>>) => {
    setEditorDefaults(task ? undefined : defaults)
    setEditorTask(task)
  }
  const closeEditor = () => {
    setEditorTask(undefined)
    setEditorDefaults(undefined)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openEditor(null)
      }
      if (event.key === 'Escape' && editorTask !== undefined) closeEditor()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editorTask])

  useEffect(() => {
    if (path === '/') navigate('/inbox', { replace: true })
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [navigate, path])

  useEffect(() => {
    const selectors = editorTask !== undefined
      ? ['.sidebar', '.workspace', '.global-add', '.bottom-nav', '.pomodoro-dock']
      : menuOpen
        ? ['.workspace', '.global-add', '.bottom-nav', '.pomodoro-dock']
        : []
    const elements = selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
    setInert(elements, true)
    return () => setInert(elements, false)
  }, [editorTask, menuOpen])

  const page =
    path === '/' || path === '/inbox' ? <InboxPage onEditTask={openEditor} />
    : path === '/today' ? <TodayPage onEditTask={openEditor} />
    : path === '/projects' ? <ProjectsPage onEditTask={openEditor} />
    : path === '/calendar' ? <CalendarPage onEditTask={openEditor} />
    : path === '/matrix' ? <MatrixPage onEditTask={openEditor} />
    : path === '/search' ? <SearchPage onEditTask={openEditor} />
    : path === '/habits' ? <HabitsPage />
    : path === '/trash' ? <TrashPage />
    : path === '/settings' ? <SettingsPage />
    : <NotFoundPage />

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="workspace">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Открыть меню"><Menu /></button>
          <span className="mobile-header__brand"><Sparkles size={18} /> Focus Flow</span>
          <button className="icon-button icon-button--accent" onClick={() => openEditor(null)} aria-label="Быстро создать задачу"><Plus /></button>
        </header>
        {page}
      </div>
      <button className="global-add" onClick={() => openEditor(null)} aria-label="Создать новую задачу">
        <Plus size={22} />
        <span>Новая задача</span>
        <kbd><Command size={12} /> K</kbd>
      </button>
      <nav className="bottom-nav" aria-label="Мобильная навигация">
        {bottomNavigation.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `bottom-nav__item ${isActive ? 'bottom-nav__item--active' : ''}`}>
            <Icon size={20} /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <PomodoroTimer />
      {editorTask !== undefined && <TaskEditor task={editorTask ?? undefined} defaults={editorDefaults} onClose={closeEditor} />}
    </div>
  )
}
