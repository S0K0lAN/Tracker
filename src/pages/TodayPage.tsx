import { AlertTriangle, CalendarCheck2, CalendarClock, Plus, Sunrise } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Task } from '../domain/models'
import { isOverdue, isSameLocalDay } from '../domain/models'
import { PageHeader } from '../components/PageHeader'
import { TaskCard } from '../components/TaskCard'
import { useApp } from '../state/AppContext'
import './workspace-pages.css'

export function TodayPage({ onEditTask }: { onEditTask: (task: Task | null) => void }) {
  const { state } = useApp()
  const now = new Date()
  const active = state.tasks.filter((task) => task.status === 'active')
  const overdue = active.filter((task) => isOverdue(task, now) && !isSameLocalDay(task.deadline, now))
  const scheduled = active.filter((task) => isSameLocalDay(task.startAt, now))
  const scheduledIds = new Set(scheduled.map((task) => task.id))
  const deadlines = active.filter((task) => isSameLocalDay(task.deadline, now) && !scheduledIds.has(task.id))
  const total = new Set([...scheduled, ...deadlines].map((task) => task.id)).size

  return (
    <main className="page">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}
        title="Сегодня"
        description={`${total} ${taskWord(total)} на сегодня${overdue.length ? ` · ${overdue.length} просрочено` : ''}`}
        actions={<button className="button button--primary" onClick={() => onEditTask(null)}><Plus size={18} /> Добавить</button>}
      />

      <section className="today-focus">
        <span><Sunrise size={21} /></span>
        <div><strong>Спокойный план на день</strong><p>Начните с просроченного, затем выберите одну важную задачу и оставьте место для неожиданного.</p></div>
        <em>{active.filter((task) => task.importance === 'high' && (isSameLocalDay(task.startAt, now) || isSameLocalDay(task.deadline, now))).length} важных</em>
      </section>

      {overdue.length > 0 && (
        <TaskSection icon={<AlertTriangle />} title="Просрочено" tone="danger" tasks={overdue} onEditTask={onEditTask} />
      )}
      <TaskSection icon={<CalendarCheck2 />} title="Запланировано сегодня" tasks={scheduled} onEditTask={onEditTask} />
      <TaskSection icon={<CalendarClock />} title="Дедлайны сегодня" tasks={deadlines} onEditTask={onEditTask} />

      {total === 0 && overdue.length === 0 && (
        <div className="empty-state workspace-empty">
          <span><Sunrise /></span>
          <h3>День свободен</h3>
          <p>Можно запланировать задачу или оставить пространство для отдыха.</p>
          <button className="button button--primary" onClick={() => onEditTask(null)}><Plus size={17} /> Добавить задачу</button>
        </div>
      )}
    </main>
  )
}

function TaskSection({
  icon,
  title,
  tone,
  tasks,
  onEditTask,
}: {
  icon: ReactNode
  title: string
  tone?: 'danger'
  tasks: Task[]
  onEditTask(task: Task): void
}) {
  return (
    <section className={`workspace-section ${tone ? `workspace-section--${tone}` : ''}`}>
      <header><span>{icon}</span><h2>{title}</h2><em>{tasks.length}</em></header>
      {tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onEditTask} />)}
      {tasks.length === 0 && <p className="workspace-section__empty">Задач в этом разделе нет.</p>}
    </section>
  )
}

function taskWord(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return 'задача'
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'задачи'
  return 'задач'
}
